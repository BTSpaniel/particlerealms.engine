// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabFastChannel.js
 * Low-overhead data transport for same-origin peers via BroadcastChannel.
 *
 * Problem: WebRTC DataChannels add ~50-100ms RTT even on localhost due to
 * DTLS encryption, SCTP transport, and msgpack encode/decode overhead.
 *
 * Solution: For peers sharing the same browser origin (same-machine testing,
 * same-domain deployment), use the BroadcastChannel API which provides:
 *   - Structured clone transfer (no msgpack encode/decode)
 *   - No encryption overhead (same-origin security model)
 *   - Browser-scheduled local delivery without ICE/STUN/DTLS setup
 *   - Zero setup — no ICE/STUN/DTLS negotiation
 *
 * This module creates a dedicated data BroadcastChannel (separate from the
 * signaling channel in CollabSignal.js) that carries ops and presence.
 * CollabCore detects same-origin peers and prefers this transport.
 *
 * For cross-origin / cross-machine peers, WebRTC is still used.
 *
 * Inspired by: Meshtastic's tiered transport (LoRa → BLE → WiFi),
 * choosing the fastest available link per peer.
 */

import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';

// ── Constants ────────────────────────────────────────────────────────────────

const BC_DATA_PREFIX = 'collab-data-v1:';
const PROBE_INTERVAL_MS = 2000;   // re-probe for same-origin peers
const STALE_PEER_MS     = 10000;  // remove peer if no heartbeat for this long

// ── State ────────────────────────────────────────────────────────────────────

/**
 * Create a fast channel instance.
 * @param {string} projectId - room/project identifier
 * @param {string} selfId - this peer's unique ID
 * @param {Object} callbacks - { onOp, onPresence, onFastPeerDetected, onFastPeerLost }
 * @returns {Object|null} fast channel state, or null if BroadcastChannel unavailable
 */
export function createFastChannel(projectId, selfId, callbacks = {}) {
    if (typeof BroadcastChannel === 'undefined') return null;

    const channelName = BC_DATA_PREFIX + projectId;

    let bc;
    try {
        bc = new BroadcastChannel(channelName);
    } catch (_) {
        return null;
    }

    const state = {
        selfId,
        projectId,
        _bc: bc,
        _active: true,

        // peerId -> { lastSeen }
        _fastPeers: new Map(),

        // Callbacks
        _onOp: callbacks.onOp || (() => {}),
        _onPresence: callbacks.onPresence || (() => {}),
        _onFastPeerDetected: callbacks.onFastPeerDetected || (() => {}),
        _onFastPeerLost: callbacks.onFastPeerLost || (() => {}),

        // Timers
        _probeTimer: null,
        _lastWallClockMs: 0,

        // Stats
        _stats: {
            messagesSent: 0,
            messagesReceived: 0,
            fastPeerCount: 0,
        },
    };

    // Wire incoming messages
    bc.onmessage = (evt) => _handleMessage(state, evt.data);

    // Start probing for same-origin peers
    _startProbing(state);

    return state;
}

// ── Send ─────────────────────────────────────────────────────────────────────

/**
 * Send an op via fast channel to all same-origin peers.
 * Uses structured clone (no msgpack encode/decode).
 * @param {Object} fc - fast channel state
 * @param {Object} op - the operation to send
 * @returns {boolean} true if sent (false if no fast channel or no fast peers)
 */
export function fastChannelSendOp(fc, op) {
    if (!fc || !fc._active || !fc._bc || fc._fastPeers.size === 0) return false;
    try {
        fc._bc.postMessage({
            t: 'op',
            from: fc.selfId,
            d: op,
        });
        fc._stats.messagesSent++;
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Send presence data via fast channel.
 */
export function fastChannelSendPresence(fc, presenceData) {
    if (!fc || !fc._active || !fc._bc || fc._fastPeers.size === 0) return false;
    try {
        fc._bc.postMessage({
            t: 'pres',
            from: fc.selfId,
            d: presenceData,
        });
        fc._stats.messagesSent++;
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Send an op to a specific peer via fast channel.
 * @returns {boolean} true if the peer is a fast peer and message was sent
 */
export function fastChannelSendToPeer(fc, peerId, op) {
    if (!fc || !fc._active || !fc._bc || !fc._fastPeers.has(peerId)) return false;
    try {
        fc._bc.postMessage({
            t: 'op',
            from: fc.selfId,
            to: peerId,
            d: op,
        });
        fc._stats.messagesSent++;
        return true;
    } catch (_) {
        return false;
    }
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Check if a specific peer is reachable via fast channel.
 */
export function isFastPeer(fc, peerId) {
    if (!fc) return false;
    return fc._fastPeers.has(peerId);
}

/**
 * Get the set of all fast peer IDs.
 */
export function getFastPeerIds(fc) {
    if (!fc) return new Set();
    return new Set(fc._fastPeers.keys());
}

/**
 * Get fast channel stats.
 */
export function getFastChannelStats(fc) {
    if (!fc) return null;
    return {
        ...fc._stats,
        fastPeerCount: fc._fastPeers.size,
        available: fc._active && fc._bc != null,
    };
}

// ── Internal: Message Handling ───────────────────────────────────────────────

function _handleMessage(state, msg) {
    if (!state._active || !msg || typeof msg.from !== 'string' || msg.from.length === 0 || msg.from === state.selfId) return;
    // Filter: only accept messages for us or broadcast
    if (msg.to && msg.to !== state.selfId) return;

    switch (msg.t) {
        case 'probe':
            // Another peer is probing — respond to let them know we're here
            try {
                state._bc.postMessage({
                    t: 'probe_ack',
                    from: state.selfId,
                    to: msg.from,
                });
            } catch (_) {}
            // Also register them as a fast peer
            _registerFastPeer(state, msg.from);
            break;

        case 'probe_ack':
            // A peer responded to our probe — they're same-origin
            _registerFastPeer(state, msg.from);
            break;

        case 'op':
            state._stats.messagesReceived++;
            // Touch last-seen
            _touchPeer(state, msg.from);
            state._onOp(msg.from, msg.d);
            break;

        case 'pres':
            state._stats.messagesReceived++;
            _touchPeer(state, msg.from);
            state._onPresence(msg.from, msg.d);
            break;

        case 'bye':
            _removeFastPeer(state, msg.from);
            break;
    }
}

function _registerFastPeer(state, peerId) {
    const isNew = !state._fastPeers.has(peerId);
    state._fastPeers.set(peerId, { lastSeen: _advanceWallClock(state) });
    state._stats.fastPeerCount = state._fastPeers.size;

    if (isNew) {
        console.log(`[FastChannel] Same-origin peer detected: ${peerId}`);
        state._onFastPeerDetected(peerId);
    }
}

function _touchPeer(state, peerId) {
    const entry = state._fastPeers.get(peerId);
    if (entry) entry.lastSeen = _advanceWallClock(state);
}

function _removeFastPeer(state, peerId) {
    if (state._fastPeers.delete(peerId)) {
        state._stats.fastPeerCount = state._fastPeers.size;
        console.log(`[FastChannel] Same-origin peer lost: ${peerId}`);
        state._onFastPeerLost(peerId);
    }
}

// ── Probing ──────────────────────────────────────────────────────────────────

function _startProbing(state) {
    // Immediate first probe
    _sendProbe(state);

    // Periodic re-probe + stale peer cleanup
    state._probeTimer = setInterval(() => {
        if (!state._active) {
            clearInterval(state._probeTimer);
            return;
        }
        _sendProbe(state);
        _pruneStale(state);
    }, PROBE_INTERVAL_MS);
}

function _sendProbe(state) {
    if (!state._active || !state._bc) return;
    try {
        state._bc.postMessage({
            t: 'probe',
            from: state.selfId,
        });
    } catch (_) {}
}

function _pruneStale(state) {
    if (!state._active) return;
    const now = _advanceWallClock(state);
    for (const [peerId, entry] of state._fastPeers) {
        if (runtimeMonotonicClockStep(now, entry.lastSeen).elapsedMs > STALE_PEER_MS) {
            _removeFastPeer(state, peerId);
        }
    }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Destroy the fast channel. Sends a bye message to peers first.
 */
export function destroyFastChannel(fc) {
    if (!fc) return;
    const wasActive = fc._active;
    fc._active = false;

    // Notify peers we're leaving
    if (wasActive) {
        try { fc._bc?.postMessage({ t: 'bye', from: fc.selfId }); } catch (_) {}
    }

    if (fc._probeTimer) {
        clearInterval(fc._probeTimer);
        fc._probeTimer = null;
    }

    try { fc._bc?.close(); } catch (_) {}
    fc._bc = null;
    fc._fastPeers.clear();
    fc._stats.messagesSent = 0;
    fc._stats.messagesReceived = 0;
    fc._stats.fastPeerCount = 0;
    fc._lastWallClockMs = 0;
    fc._onOp = () => {};
    fc._onPresence = () => {};
    fc._onFastPeerDetected = () => {};
    fc._onFastPeerLost = () => {};
}

function _advanceWallClock(state) {
    const clock = runtimeMonotonicClockStep(Date.now(), state._lastWallClockMs);
    state._lastWallClockMs = clock.timestampMs;
    return clock.timestampMs;
}
