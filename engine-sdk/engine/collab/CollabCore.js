// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabCore.js
 * WebRTC peer connection management.
 * Manages RTCPeerConnection instances, data channels, and reconnection.
 *
 * Two data channels per peer:
 *   'ops'      — reliable, ordered (scene operations)
 *   'presence' — unreliable, unordered (camera/selection at 10Hz)
 */

import {
    createSignalChannel,
    startSignaling,
    forceAnnounce,
    sendOffer,
    sendAnswer,
    sendCandidate,
    destroySignalChannel,
    fetchTurnCredentials,
} from './CollabSignal.js';

import {
    COLLAB_CODEC_LIMITS,
    codecEncodeReport,
    encode as msgpackEncode,
    decode as msgpackDecode,
} from './CollabCodec.js';
import {
    fastChannelSendOp,
    fastChannelSendPresence,
    fastChannelSendToPeer,
    isFastPeer,
} from './CollabFastChannel.js';
import {
    shouldGossip,
    gossipWrap,
    gossipReceive,
    getNeighborIds,
} from './CollabMeshTopology.js';
import {
    createPeerCryptoState, initPeerCrypto, completePeerCrypto,
    encrypt as aesEncrypt, decrypt as aesDecrypt,
    signChallenge, verifyChallenge, isCryptoAvailable,
    importPublicKey, deriveSharedKey,
    nextCryptoSendCounter, resetCryptoCounters,
} from './CollabCrypto.js';
import { checksumHex64, contentHashBytes, fnv1a64 } from '../core/math/ChecksumMath.js';
import { byteSignature } from '../core/math/FormatMath.js';
import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { finiteNumberReport } from '../core/math/MathValidation.js';
import { createReconnectBackoff, nextBackoffDelay } from '../network/routes/ReconnectBackoff.js';

// Default ICE servers — Cloudflare STUN is free, privacy-respecting, and global
const ICE_SERVERS_DEFAULT = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
];


const HEARTBEAT_INTERVAL_MS = 5000;
const DEAD_PEER_TIMEOUT_MS  = 15000; // declare peer dead after 15s of no pong
const ICE_RESTART_TIMEOUT_MS = 10000; // try ICE restart at 10s before declaring dead
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 8;

// ── Dynamic peer capacity ────────────────────────────────────────────────────
// Full mesh is O(N²) connections. With fast channels and reputation scoring
// we can be smarter about when to switch to relay mode.
//
// Base: 4 WebRTC peers in full mesh (original limit)
// Fast channel peers are FREE — BroadcastChannel costs nothing
// Trusted peers (score ≥ 700) add +1 to mesh capacity each
// Max mesh cap: 8 WebRTC peers (beyond that, relay regardless)
const BASE_MESH_CAPACITY    = 4;   // base WebRTC full-mesh peer limit
const MAX_MESH_CAPACITY     = 8;   // absolute max full-mesh WebRTC peers
const TRUSTED_MESH_BONUS    = 1;   // each trusted peer adds this to capacity
const FAST_PEER_UNLIMITED   = true; // fast channel peers never count toward mesh limit

// Hard ceiling on unsolicited-offer admission (security, not topology). Any
// signaling tier (BroadcastChannel/SharedWorker/BitTorrent/Masterserver relay,
// see CollabSignal.js) can deliver an OFFER claiming to be from any peerId —
// nothing upstream authenticates a peerId before the WebRTC handshake starts.
// Without a cap, a flood of spoofed offers on a shared room/route would spin
// up unbounded RTCPeerConnections (memory/CPU DoS). Set well above
// CollabMeshTopology's own K_SUPERNODE=10 direct-neighbor cap so it never
// interferes with any legitimate topology mode — it only rejects offers once
// something is clearly abusive.
const MAX_UNSOLICITED_PEERS = 32;
const MAX_SDP_BYTES = 256 * 1024;
const MAX_OFFER_ID_BYTES = 128;
const MAX_CANDIDATE_BYTES = 16 * 1024;
const MAX_PENDING_CANDIDATES = 128;
const MAX_PENDING_CANDIDATE_BYTES = 256 * 1024;
const MAX_NEGOTIATION_QUEUE_DEPTH = 128;
const MAX_SEEN_SDP_GENERATIONS = 32;
const MAX_SEEN_CANDIDATES = 512;
const _negotiationTextEncoder = new TextEncoder();
let _collabIdSequence = 0;
let _peerGenerationSequence = 0;

/**
 * Create a collab core instance.
 * config: { projectId, selfId, username, onOp, onPresence, onPeerDiscovered,
 *           shouldConnectPeer, onPeerJoin, onPeerLeave }
 */
export function createCollabCore(config) {
    if (!config || typeof config !== 'object') throw new TypeError('CollabCore config is required');
    const core = {
        projectId: config.projectId || 'default',
        selfId: config.selfId || _genId(),
        username: config.username || 'Anonymous',
        roomPassword: config.roomPassword || null, // mixed into HKDF for peer auth
        onOp: config.onOp || (() => {}),
        onPresence: config.onPresence || (() => {}),
        onPeerDiscovered: config.onPeerDiscovered || (() => {}),
        shouldConnectPeer: config.shouldConnectPeer || (() => true),
        onPeerJoin: config.onPeerJoin || (() => {}),
        onPeerLeave: config.onPeerLeave || (() => {}),
        onPeerIdentity: config.onPeerIdentity || (() => {}), // fired when DC hello delivers identity data

        peers: new Map(),       // peerId -> PeerState
        signal: null,
        _heartbeatTimer: null,
        _started: false,
        _destroyed: false,
        _clockMs: 0,
        _chunkBuffers: new Map(),
        _cryptoEnabled: isCryptoAvailable() && (config.encrypt !== false),

        // ── Cryptographic identity (ECDSA P-256 from CollabIdentity) ──
        _publicKeyRaw: config.publicKeyRaw || null,
        _identityProof: config.identityProof || null,
        // ── Ephemeral ECDH (for per-peer AES-256-GCM encryption) ──
        _ecdhPublicKeyRaw: config.ecdhPublicKeyRaw || null,
        _ecdhPrivateKey: config.ecdhPrivateKey || null,
        _roomPassword: config.roomPassword || null,

        // ── Anonymous mode ──
        _anonMode: config.anonMode || false,

        // ── Relay topology (Phase 6: spatial mesh scaling) ──
        _relayMode: false,         // true when peer count >= RELAY_THRESHOLD
        _isHost: config.isHost || false,
        _hostPeerId: config.hostPeerId || null,  // peerId of the host (for non-host peers)
        _spatialAuth: null,        // reference to CollabSpatialAuthority state (set externally)
        _relayThreshold: 4,        // switch to relay at this many peers

        // ── Fast channel (same-origin BroadcastChannel transport) ──
        _fastChannel: null,        // set externally via setCoreFastChannel()

        // ── Mesh topology (partial mesh + gossip + supernode) ──
        _topology: null,           // set externally via setCoreTopology()
    };

    // Create signaling channel
    core.signal = createSignalChannel({
        projectId: core.projectId,
        routeSecret: core._roomPassword,
        selfId: core.selfId,
        username: core.username,
        publicKeyRaw: core._publicKeyRaw,
        identityProof: core._identityProof,
        ecdhPublicKeyRaw: core._ecdhPublicKeyRaw,
        onOffer: (peerId, sdpOffer, offerId) => _handleRemoteOffer(core, peerId, sdpOffer, offerId),
        onAnswer: (peerId, sdpAnswer, offerId) => _handleRemoteAnswer(core, peerId, sdpAnswer, offerId),
        onCandidate: (peerId, candidate, offerId) => _handleRemoteCandidate(core, peerId, candidate, offerId),
        onPeerJoin: (peerId, username) => _handleDiscoveredPeer(core, peerId, username),
        onPeerLeave: (peerId) => _handlePeerLeave(core, peerId),
        // BT transport: direct data channel messages bypass the offer/answer flow
        onOp: (peerId, op) => core.onOp(peerId, op),
        onPresence: (peerId, packet) => core.onPresence(peerId, packet),
        onBTChannels: (peerId, opsChannel, presChannel, identityData) => _adoptBTChannels(core, peerId, opsChannel, presChannel, identityData),
        onIceRestartNeeded: () => {
            for (const [peerId, peer] of core.peers) {
                try { peer.pc?.setConfiguration({ iceServers: core.signal._iceServers }); } catch (_) {}
                void _attemptIceRestart(core, peerId, peer);
            }
        },
    });

    return core;
}

/**
 * Start signaling and begin peer discovery.
 */
export function startCollab(core) {
    if (!core || core._destroyed) return false;
    if (core._started) return true;
    core._started = true;
    startSignaling(core.signal);
    _startHeartbeat(core);
    return true;
}

/**
 * Force an immediate discovery pass: re-announce on all signaling tiers right now.
 * Lets an app-layer "Connect now" find a known contact
 * without waiting for the periodic announce cycle. Does not tear down existing peers.
 */
export function forceDiscovery(core) {
    if (!core || core._destroyed || !core.signal) return false;
    try { forceAnnounce(core.signal); } catch (_) {}
    return true;
}

/**
 * Broadcast an op to all connected peers.
 * Transport priority:
 *   1. FastChannel (same-origin BroadcastChannel) — <1ms
 *   2. Gossip mesh (partial mesh / supernode mode) — K neighbors, O(log N) delivery
 *   3. Full mesh WebRTC — direct to all (≤6 peers)
 */
export function broadcastOp(core, op) {
    if (!op) return;

    // Try fast channel first — covers all same-origin peers in one shot
    fastChannelSendOp(core._fastChannel, op);

    // ── Gossip mesh mode: wrap op and send to K neighbors only ──
    if (core._topology && shouldGossip(core._topology)) {
        const wrapped = gossipWrap(core._topology, op);
        const neighborIds = getNeighborIds(core._topology);
        for (const peerId of neighborIds) {
            if (isFastPeer(core._fastChannel, peerId)) continue; // already via BC
            const peer = core.peers.get(peerId);
            if (peer?.opsChannel?.readyState === 'open') {
                _sendBinary(peer, 'ops', { ch: 'ops', data: wrapped });
            }
        }
        return;
    }

    // ── Full mesh mode: send to all connected WebRTC peers ──
    for (const [peerId, peer] of core.peers) {
        if (isFastPeer(core._fastChannel, peerId)) continue;
        if (peer.opsChannel?.readyState === 'open') {
            _sendBinary(peer, 'ops', { ch: 'ops', data: op });
        }
    }
}

/**
 * Broadcast presence data to all connected peers (unreliable channel).
 * Prefers fast channel for same-origin peers.
 */
export function broadcastPresence(core, presenceData) {
    if (!presenceData) return;
    // Fast channel: covers all same-origin peers
    fastChannelSendPresence(core._fastChannel, presenceData);
    // WebRTC: only for peers not reachable via fast channel
    for (const [peerId, peer] of core.peers) {
        if (isFastPeer(core._fastChannel, peerId)) continue;
        if (peer.presenceChannel?.readyState === 'open') {
            _sendBinary(peer, 'presence', { ch: 'presence', data: presenceData });
        } else if (peer.opsChannel?.readyState === 'open') {
            _sendBinary(peer, 'ops', { ch: 'presence', data: presenceData });
        }
    }
}

// Max safe message size for cross-browser WebRTC data channels.
// Firefox↔Chrome interop can fail above 64KB (SCTP fragmentation).
// We chunk anything larger and reassemble on the receive side.
const CHUNK_SIZE = 60000; // ~60KB per chunk (leave room for msgpack overhead)
const MAX_CHUNK_COUNT = Math.ceil(COLLAB_CODEC_LIMITS.maxBytes / CHUNK_SIZE);
const MAX_CHUNK_TRANSFERS = 32;
let _chunkSeq = 0;

export function collabChunkEnvelopeReport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { valid: false, reason: 'not-object', value: null };
    }
    const chunkId = typeof data.chunkId === 'string' ? data.chunkId.trim() : '';
    if (!chunkId || chunkId.length > 128) return { valid: false, reason: 'invalid-chunk-id', value: null };
    if (!Number.isSafeInteger(data.total) || data.total < 1 || data.total > MAX_CHUNK_COUNT) {
        return { valid: false, reason: 'invalid-total', value: null };
    }
    if (!Number.isSafeInteger(data.index) || data.index < 0 || data.index >= data.total) {
        return { valid: false, reason: 'invalid-index', value: null };
    }
    let payload;
    if (data.payload instanceof Uint8Array) {
        payload = data.payload.slice();
    } else if (Array.isArray(data.payload) && data.payload.length <= CHUNK_SIZE
        && data.payload.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
        payload = Uint8Array.from(data.payload);
    } else {
        return { valid: false, reason: 'invalid-payload', value: null };
    }
    if (payload.byteLength < 1 || payload.byteLength > CHUNK_SIZE) {
        return { valid: false, reason: 'invalid-payload-length', value: null };
    }
    return {
        valid: true,
        reason: 'valid',
        value: { chunkId, index: data.index, total: data.total, payload },
    };
}

/**
 * Send data to a specific peer only.
 * Prefers fast channel for same-origin peers.
 * Auto-chunks large messages to avoid SCTP size limits.
 */
export function sendToPeer(core, peerId, data) {
    // Try fast channel first
    if (fastChannelSendToPeer(core._fastChannel, peerId, data)) return true;
    // Fall back to WebRTC
    const peer = core.peers.get(peerId);
    if (!peer) return false;
    if (peer.opsChannel?.readyState !== 'open') return false;

    // Check if message needs chunking by doing a trial encode
    const report = codecEncodeReport({ ch: 'ops', data });
    if (!report.valid) return false;
    const encoded = report.bytes;
    if (encoded.byteLength <= CHUNK_SIZE) {
        // Small enough — send directly
        try {
            peer.opsChannel.send(encoded.buffer);
            return true;
        } catch (_) {
            return false;
        }
    }

    // Chunk the encoded data
    const chunkId = `${core.selfId.slice(0, 8)}-${_chunkSeq++}`;
    const totalChunks = Math.ceil(encoded.byteLength / CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
        const slice = encoded.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkMsg = {
            ch: 'ops',
            data: {
                type: '__chunk__',
                chunkId,
                index: i,
                total: totalChunks,
                payload: slice,
            },
        };
        _sendBinary(peer, 'ops', chunkMsg);
    }
    return true;
}

/**
 * Relay an op from one peer to all other peers (host-only, relay mode).
 * Optionally filters by spatial interest set.
 * @param {Object} core
 * @param {string} fromPeerId - peer who sent the op
 * @param {Object} op - the op to relay
 */
export function relayOp(core, fromPeerId, op) {
    if (!core._isHost || !op) return;
    const relayedOp = op.type === 'play_grab_force'
        ? { ...op, _relayFrom: fromPeerId }
        : op;
    for (const [peerId, peer] of core.peers) {
        if (peerId === fromPeerId) continue; // don't echo back to sender
        if (peer.opsChannel?.readyState === 'open') {
            _sendBinary(peer, 'ops', { ch: 'ops', data: relayedOp });
        }
    }
}

/**
 * Compute the dynamic peer capacity based on connection quality.
 * Fast channel peers are free. Trusted peers expand the mesh limit.
 * @param {Object} core
 * @param {Object} [peerReputation] - reputation state for score lookups
 * @returns {{ totalPeers, webrtcPeers, fastPeers, meshCapacity, shouldRelay }}
 */
export function computeDynamicCapacity(core, peerReputation) {
    const peers = core?.peers instanceof Map ? core.peers : new Map();
    const totalPeers = peers.size;
    let fastPeers = 0;
    let trustedCount = 0;

    for (const [peerId] of peers) {
        if (isFastPeer(core?._fastChannel, peerId)) {
            fastPeers++;
        }
        // Count trusted peers from reputation
        if (peerReputation) {
            const m = peerReputation._peers?.get(peerId);
            if (m && collabPeerScoreReport(m.score).trusted) {
                trustedCount++;
            }
        }
    }

    const webrtcPeers = totalPeers - fastPeers;

    // Dynamic mesh capacity: base + bonus from trusted peers, capped
    const threshold = collabRelayThresholdReport(core?._relayThreshold);
    const meshCapacity = Math.min(
        MAX_MESH_CAPACITY,
        threshold.value + trustedCount * TRUSTED_MESH_BONUS
    );

    // Only WebRTC peers count toward the relay threshold
    const shouldRelay = webrtcPeers >= meshCapacity;

    return {
        totalPeers,
        webrtcPeers,
        fastPeers,
        trustedCount,
        baseCapacity: threshold.value,
        meshCapacity,
        shouldRelay,
    };
}

export function collabRelayThresholdReport(value) {
    const report = finiteNumberReport(value, {
        integer: true,
        min: 1,
        max: MAX_MESH_CAPACITY,
        allowNegativeZero: false,
    });
    return report.valid
        ? { valid: true, reason: 'valid', value: report.value }
        : { valid: false, reason: report.reason, value: BASE_MESH_CAPACITY };
}

export function collabPeerScoreReport(value) {
    const report = finiteNumberReport(value, {
        integer: true,
        min: 0,
        max: 1000,
        allowNegativeZero: false,
    });
    return {
        valid: report.valid,
        reason: report.reason,
        value: report.valid ? report.value : 0,
        trusted: report.valid && report.value >= TRUSTED_PEER_THRESHOLD,
    };
}

/**
 * Check peer count and toggle relay mode if threshold is crossed.
 * Now uses dynamic capacity — fast peers don't count, trusted peers expand the limit.
 * @param {Object} core
 * @param {Object} [peerReputation] - optional reputation state
 * @returns {boolean} true if relay mode changed
 */
export function checkRelayMode(core, peerReputation) {
    const cap = computeDynamicCapacity(core, peerReputation);
    if (cap.shouldRelay !== core._relayMode) {
        core._relayMode = cap.shouldRelay;
        console.log(
            `[CollabCore] Relay mode ${cap.shouldRelay ? 'ENABLED' : 'DISABLED'}`
            + ` (${cap.totalPeers} total: ${cap.webrtcPeers} WebRTC + ${cap.fastPeers} fast`
            + ` | capacity: ${cap.meshCapacity} | trusted: ${cap.trustedCount})`
        );
        return true;
    }
    return false;
}

/**
 * Set the spatial authority reference for interest-filtered relay.
 */
export function setCoreRelayConfig(core, opts) {
    if (!core || core._destroyed || !opts || typeof opts !== 'object') return false;
    if (opts.isHost != null && typeof opts.isHost !== 'boolean') return false;
    let relayThreshold = core._relayThreshold;
    if (opts.relayThreshold != null) {
        const threshold = collabRelayThresholdReport(opts.relayThreshold);
        if (!threshold.valid) return false;
        relayThreshold = threshold.value;
    }
    if (opts.isHost != null) core._isHost = opts.isHost;
    if (opts.hostPeerId != null) core._hostPeerId = opts.hostPeerId;
    if (opts.spatialAuth != null) core._spatialAuth = opts.spatialAuth;
    core._relayThreshold = relayThreshold;
    return true;
}

/**
 * Set the fast channel reference on the core.
 * Called by EditorCollab after creating the fast channel.
 */
export function setCoreFastChannel(core, fastChannel) {
    if (!core || core._destroyed) return false;
    core._fastChannel = fastChannel;
    return true;
}

/**
 * Set the mesh topology reference on the core.
 * Called by EditorCollab after creating the topology manager.
 */
export function setCoreTopology(core, topology) {
    if (!core || core._destroyed) return false;
    core._topology = topology;
    return true;
}

// ── Reputation-based connection tiers ────────────────────────────────────────

const TRUSTED_PEER_THRESHOLD = 700; // score >= 700 = trusted → direct P2P in relay mode

/**
 * Check if a peer is trusted (high reputation) and should get a direct connection
 * even in relay mode. Trusted peers bypass the relay host for lower latency.
 * @param {Object} core
 * @param {string} peerId
 * @param {number} peerScore - reputation score 0-1000
 * @returns {boolean} true if peer is trusted
 */
export function isPeerTrusted(core, peerId, peerScore) {
    return collabPeerScoreReport(peerScore).trusted;
}

/**
 * Get the connection tier label for a peer.
 * @param {Object} core
 * @param {string} peerId
 * @param {number} peerScore
 * @param {Object} [fastChannel]
 * @returns {{ tier: string, label: string, color: string }}
 */
export function getPeerConnectionTier(core, peerId, peerScore, fastChannel) {
    if (isFastPeer(fastChannel, peerId)) {
        return { tier: 'fast', label: 'Fast (BC)', color: '#22c55e' };
    }
    if (collabPeerScoreReport(peerScore).trusted) {
        return { tier: 'direct', label: 'Direct P2P', color: '#6b8afd' };
    }
    if (core._relayMode) {
        return { tier: 'relay', label: 'Relay', color: '#f59e0b' };
    }
    return { tier: 'p2p', label: 'P2P', color: '#a78bfa' };
}

/**
 * Get the maximum bufferedAmount across all peer ops channels.
 * Used by CollabMessageRouter for backpressure detection.
 */
export function getMaxBufferedAmount(core) {
    let max = 0;
    for (const [, peer] of core?.peers ?? []) {
        if (peer.opsChannel?.readyState === 'open') {
            const report = collabBufferedAmountReport(peer.opsChannel.bufferedAmount);
            max = Math.max(max, report.value);
        }
    }
    return max;
}

export function collabBufferedAmountReport(value) {
    const report = finiteNumberReport(value, {
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        allowNegativeZero: false,
    });
    return report.valid
        ? { valid: true, reason: 'valid', value: report.value }
        : { valid: false, reason: report.reason, value: MAX_BUFFERED_AMOUNT + 1 };
}

/**
 * Get the local peer ID.
 */
export function getSelfId(core) {
    return core.selfId;
}

/**
 * Get all connected peers.
 */
export function getPeers(core) {
    const result = new Map();
    for (const [peerId, peer] of core.peers) {
        result.set(peerId, {
            username: peer.username,
            color: peer.color,
            connected: peer.opsChannel?.readyState === 'open',
            encrypted: !!peer._encrypted,
        });
    }
    return result;
}

/** Begin a targeted WebRTC connection to an already-discovered peer. */
export function connectCollabPeer(core, peerId, username = 'Remote') {
    if (!core || core._destroyed || typeof peerId !== 'string' || !peerId) return Promise.resolve(false);
    return _initiateConnection(core, peerId, username);
}

/** Close one direct peer connection without tearing down discovery. */
export function disconnectCollabPeer(core, peerId) {
    if (!core || core._destroyed || typeof peerId !== 'string' || !peerId) return false;
    const peer = core.peers.get(peerId);
    const closed = _closePeer(core, peerId, peer || null);
    if (closed && peer) _notifyPeerLeave(core, peer);
    return closed;
}

/**
 * Collect locally observed transport quality. Remote peers cannot supply or
 * inflate these values, which makes them suitable input for topology roles.
 */
export async function observeCollabPeerMetrics(core, peerId) {
    const peer = core?.peers?.get(peerId);
    const connected = peer?.opsChannel?.readyState === 'open';
    let latency = 999;
    let relayed = false;
    if (peer?.pc && typeof peer.pc.getStats === 'function') {
        try {
            const stats = await peer.pc.getStats();
            for (const [, report] of stats) {
                if (report.type !== 'candidate-pair' || report.state !== 'succeeded' || report.nominated === false) continue;
                if (Number.isFinite(report.currentRoundTripTime)) latency = Math.max(0, report.currentRoundTripTime * 1000);
                const local = stats.get?.(report.localCandidateId);
                const remote = stats.get?.(report.remoteCandidateId);
                relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
                break;
            }
        } catch (_) { /* metrics are best-effort */ }
    }
    const connectedAt = Number.isFinite(peer?._connectedAt) ? peer._connectedAt : Date.now();
    const uptime = connected ? Math.max(0, Date.now() - connectedAt) : 0;
    const reconnects = Number.isSafeInteger(peer?._totalReconnects) ? peer._totalReconnects : 0;
    const latencyScore = Math.max(0, 350 - Math.min(350, latency));
    const uptimeScore = Math.min(250, Math.floor(uptime / 120000) * 25);
    const score = connected
        ? Math.max(0, Math.min(1000, 400 + latencyScore + uptimeScore - Math.min(250, reconnects * 25) - (relayed ? 25 : 0)))
        : 0;
    return Object.freeze({ peerId, connected, latency, uptime, reconnects, relayed, score });
}

/**
 * Destroy all connections and signaling.
 */
export function destroyCollabCore(core) {
    if (!core || core._destroyed) return false;
    core._destroyed = true;
    core._started = false;
    _stopHeartbeat(core);

    // Clear any pending reconnect timers before closing peers
    for (const [, peer] of core.peers) {
        if (peer._reconnectTimerId != null) {
            clearTimeout(peer._reconnectTimerId);
            peer._reconnectTimerId = null;
        }
    }

    for (const [peerId] of core.peers) {
        _closePeer(core, peerId);
    }
    core.peers.clear();

    if (core.signal) {
        destroySignalChannel(core.signal);
        core.signal = null;
    }
    for (const buffer of core._chunkBuffers.values()) {
        if (buffer.timerId != null) clearTimeout(buffer.timerId);
    }
    core._chunkBuffers.clear();
    core._fastChannel = null;
    core._topology = null;
    core._spatialAuth = null;
    core._publicKeyRaw = null;
    core._identityProof = null;
    core._ecdhPublicKeyRaw = null;
    core._ecdhPrivateKey = null;
    core._roomPassword = null;
    core._clockMs = 0;
    core.onOp = () => {};
    core.onPresence = () => {};
    core.onPeerDiscovered = () => {};
    core.shouldConnectPeer = () => false;
    core.onPeerJoin = () => {};
    core.onPeerLeave = () => {};
    core.onPeerIdentity = () => {};
    return true;
}

// ─── Connection lifecycle ─────────────────────────────────────────────────────

function _handleDiscoveredPeer(core, peerId, username) {
    if (core._destroyed || peerId === core.selfId) return Promise.resolve(false);
    try { core.onPeerDiscovered(peerId, username); } catch (_) { /* observer isolation */ }
    let shouldConnect = false;
    try { shouldConnect = core.shouldConnectPeer(peerId, username) !== false; } catch (_) { shouldConnect = false; }
    return shouldConnect ? _initiateConnection(core, peerId, username) : Promise.resolve(false);
}

function _adoptBTChannels(core, peerId, opsChannel, presChannel, identityData) {
    if (core._destroyed) return;
    let peer = core.peers.get(peerId);
    if (!peer) {
        peer = _createPeerState(peerId, 'Remote', _coreNow(core));
        core.peers.set(peerId, peer);
    }
    peer.opsChannel = opsChannel;
    peer.presenceChannel = presChannel;
    peer._connectedAt = _coreNow(core);

    // Store cryptographic identity from the hello handshake (if provided)
    if (identityData) {
        peer._remotePublicKey = identityData.publicKey || null;
        peer._remoteIdentityProof = identityData.identityProof || null;
    }

    // Derive shared AES-256-GCM key via ECDH if both peers have ECDH keys
    if (core._cryptoEnabled && core._ecdhPrivateKey && identityData?.ecdhKey) {
        _deriveSharedKey(core, peer, identityData.ecdhKey).catch((err) => {
            console.warn('[CollabCore] ECDH key derivation failed:', err.message);
        });
    }

    // Override the signal layer's onmessage so ALL messages (including __ping__/__pong__)
    // route through _handleIncoming. The hello exchange is already complete by this point.
    // Without this, BT channels bypass ping/pong handling → peers declared dead → reconnect loop.
    opsChannel.onmessage = (evt) => _handleIncoming(core, peerId, evt.data);
    if (presChannel) {
        presChannel.onmessage = (evt) => _handleIncoming(core, peerId, evt.data);
    }

    peer._joinNotified = true;
    console.log('[CollabCore] BT peer connected:', peerId);
    core.onPeerJoin(peerId, peer.username);
}

/**
 * Derive a shared AES-256-GCM key from ECDH key exchange.
 * Called after hello handshake when both peers have ECDH public keys.
 */
export async function deriveCollabChannelId(selfId, peerId) {
    // Deterministic channelId from sorted peer IDs.
    // CRITICAL: XOR first byte with 0x80 for the higher-ID peer so that
    // each direction uses different nonces. Without this, both peers would
    // encrypt with identical [channelId | counter] nonces, breaking AES-GCM.
    const ids = [selfId, peerId].sort();
    const hash = await contentHashBytes(ids.join(':'), 'SHA-256');
    const channelId = hash.slice(0, 8);
    const isHigher = selfId > peerId;
    if (isHigher) channelId[0] ^= 0x80;
    return channelId;
}

async function _deriveSharedKey(core, peer, remoteEcdhKeyRaw) {
    if (peer._aesKey) return peer._aesKey;
    if (peer._keyDerivationPromise) return peer._keyDerivationPromise;
    const derivation = (async () => {
        const remoteBytes = remoteEcdhKeyRaw instanceof Uint8Array
            ? remoteEcdhKeyRaw
            : new Uint8Array(remoteEcdhKeyRaw);
        const remotePub = await importPublicKey(remoteBytes);
        const aesKey = await deriveSharedKey(core._ecdhPrivateKey, remotePub, core._roomPassword);
        const channelId = await deriveCollabChannelId(core.selfId, peer.peerId);
        if (!_isCurrentPeer(core, peer)) throw new Error('stale peer key derivation');

        peer._aesKey = aesKey;
        peer._channelId = channelId;           // nonce prefix for OUR outgoing messages
        peer._recvChannelId = new Uint8Array(channelId); // nonce prefix for THEIR incoming messages
        peer._recvChannelId[0] ^= 0x80;       // flip direction bit to match sender's nonce
        resetCryptoCounters(peer.crypto);
        peer._encrypted = true;
        console.log(`[CollabCore] E2E encryption active with peer ${peer.peerId.slice(0, 8)}`);
        return aesKey;
    })();
    peer._keyDerivationPromise = derivation;
    try {
        return await derivation;
    } finally {
        if (peer._keyDerivationPromise === derivation) peer._keyDerivationPromise = null;
    }
}

function _utf8ByteLength(value) {
    return _negotiationTextEncoder.encode(String(value ?? '')).byteLength;
}

function _validOfferId(offerId) {
    return typeof offerId === 'string'
        && /^[A-Za-z0-9._:-]+$/.test(offerId)
        && _utf8ByteLength(offerId) <= MAX_OFFER_ID_BYTES;
}

function _descriptionRecord(description, expectedType, offerId) {
    if (!_validOfferId(offerId)) throw new TypeError('missing or invalid offerId');
    if (!description || description.type !== expectedType || typeof description.sdp !== 'string' || !description.sdp) {
        throw new TypeError(`expected a non-empty SDP ${expectedType}`);
    }
    const bytes = _utf8ByteLength(description.sdp);
    if (bytes > MAX_SDP_BYTES) throw new RangeError(`SDP exceeds ${MAX_SDP_BYTES} bytes`);
    const normalized = { type: expectedType, sdp: description.sdp };
    return {
        description: normalized,
        bytes,
        fingerprint: checksumHex64(fnv1a64(`${expectedType}\n${description.sdp}`)),
    };
}

function _candidateRecord(candidate, offerId) {
    if (!_validOfferId(offerId)) throw new TypeError('missing or invalid candidate offerId');
    if (!candidate || typeof candidate !== 'object') throw new TypeError('candidate must be an object');
    const serialized = JSON.stringify(candidate);
    if (!serialized) throw new TypeError('candidate must be JSON serializable');
    const bytes = _utf8ByteLength(serialized);
    if (bytes > MAX_CANDIDATE_BYTES) throw new RangeError(`candidate exceeds ${MAX_CANDIDATE_BYTES} bytes`);
    const fingerprint = checksumHex64(fnv1a64(serialized));
    return { candidate, offerId, bytes, fingerprint, key: `${offerId}:${fingerprint}` };
}

function _fingerprintState(map, id, fingerprint) {
    if (!map.has(id)) return 'new';
    return map.get(id) === fingerprint ? 'duplicate' : 'conflict';
}

function _rememberFingerprint(map, id, fingerprint, limit) {
    map.set(id, fingerprint);
    while (map.size > limit) map.delete(map.keys().next().value);
}

function _isCurrentPeer(core, peer, generation = peer?._generation) {
    return !!peer
        && !core._destroyed
        && !peer._closed
        && peer._generation === generation
        && core.peers.get(peer.peerId) === peer;
}

function _ownsPeerConnection(core, peer, pc, pcGeneration = pc?._collabPcGeneration) {
    return _isCurrentPeer(core, peer)
        && !!pc
        && peer.pc === pc
        && pc._collabPcGeneration === pcGeneration;
}

function _isCurrentPc(core, peer, pc, pcGeneration = pc?._collabPcGeneration) {
    return _ownsPeerConnection(core, peer, pc, pcGeneration)
        && pc.connectionState !== 'closed';
}

function _enqueueNegotiation(core, peer, label, operation) {
    if (!_isCurrentPeer(core, peer)) return Promise.resolve(false);
    if (peer._negotiationQueueDepth >= MAX_NEGOTIATION_QUEUE_DEPTH) {
        console.warn(`[CollabCore] Rejecting ${label} for ${peer.peerId}: negotiation queue limit reached`);
        return Promise.resolve(false);
    }
    const generation = peer._generation;
    peer._negotiationQueueDepth++;
    const run = async () => {
        if (!_isCurrentPeer(core, peer, generation)) {
            console.debug(`[CollabCore] Dropping stale ${label} for ${peer.peerId}`);
            return false;
        }
        try {
            return await operation();
        } catch (error) {
            console.warn(`[CollabCore] ${label} failed for ${peer.peerId}:`, error?.message || error);
            return false;
        }
    };
    const result = peer._negotiationTail.then(run, run);
    peer._negotiationTail = result.then(() => undefined, () => undefined);
    return result.finally(() => {
        peer._negotiationQueueDepth = Math.max(0, peer._negotiationQueueDepth - 1);
    });
}

function _newOfferId() {
    return `offer-${_genId()}`;
}

function _discardPendingCandidateGenerations(peer, retainedOfferId) {
    for (const [offerId, bucket] of peer._pendingCandidates) {
        if (offerId === retainedOfferId) continue;
        peer._pendingCandidateCount -= bucket.records.length;
        peer._pendingCandidateBytes -= bucket.bytes;
        peer._pendingCandidates.delete(offerId);
    }
    peer._pendingCandidateCount = Math.max(0, peer._pendingCandidateCount);
    peer._pendingCandidateBytes = Math.max(0, peer._pendingCandidateBytes);
}

function _storePendingCandidate(peer, record) {
    if (peer._pendingCandidateCount >= MAX_PENDING_CANDIDATES
        || peer._pendingCandidateBytes + record.bytes > MAX_PENDING_CANDIDATE_BYTES) {
        console.warn(`[CollabCore] Rejecting candidate for ${peer.peerId}: pending candidate budget exceeded`);
        return false;
    }
    let bucket = peer._pendingCandidates.get(record.offerId);
    if (!bucket) {
        bucket = { records: [], bytes: 0 };
        peer._pendingCandidates.set(record.offerId, bucket);
    }
    bucket.records.push(record);
    bucket.bytes += record.bytes;
    peer._pendingCandidateCount++;
    peer._pendingCandidateBytes += record.bytes;
    return true;
}

async function _drainPendingCandidates(core, peer, pc, offerId) {
    const bucket = peer._pendingCandidates.get(offerId);
    if (!bucket) return;
    peer._pendingCandidates.delete(offerId);
    peer._pendingCandidateCount = Math.max(0, peer._pendingCandidateCount - bucket.records.length);
    peer._pendingCandidateBytes = Math.max(0, peer._pendingCandidateBytes - bucket.bytes);
    for (const record of bucket.records) {
        if (!_isCurrentPc(core, peer, pc)) return;
        try {
            await pc.addIceCandidate(new RTCIceCandidate(record.candidate));
        } catch (error) {
            peer._seenRemoteCandidates.delete(record.key);
            console.warn(`[CollabCore] Queued candidate failed for ${peer.peerId}:`, error?.message || error);
        }
    }
}

function _wireIncomingDataChannels(core, peer, pc) {
    pc.ondatachannel = (evt) => {
        if (!_isCurrentPc(core, peer, pc)) return;
        const channel = evt.channel;
        if (channel.label === 'ops') {
            peer.opsChannel = channel;
            _wireDataChannel(core, peer.peerId, channel, 'ops');
        } else if (channel.label === 'presence') {
            peer.presenceChannel = channel;
            _wireDataChannel(core, peer.peerId, channel, 'presence');
        }
    };
}

async function _createAndSendLocalOffer(core, peer, { iceRestart = false } = {}) {
    const pc = peer.pc;
    const pcGeneration = pc?._collabPcGeneration;
    if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
    if (pc.signalingState !== 'stable') {
        console.warn(`[CollabCore] Cannot create ${iceRestart ? 'restart ' : ''}offer for ${peer.peerId}: signaling state ${pc.signalingState}`);
        return false;
    }

    const offerId = _newOfferId();
    peer._makingOffer = true;
    peer._pendingLocalOfferId = offerId;
    peer._localOfferId = offerId;
    peer._remoteOfferId = null;
    peer._candidateOfferId = offerId;
    _discardPendingCandidateGenerations(peer, offerId);

    try {
        if (iceRestart) pc.restartIce();
        const offer = iceRestart ? await pc.createOffer({ iceRestart: true }) : await pc.createOffer();
        if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
        await pc.setLocalDescription(offer);
        if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
        // Signal the SDP immediately and trickle every ICE candidate through the
        // same offerId. Waiting for gathering here lets early candidate events
        // fill the per-peer queue ahead of the offer on real multi-peer rooms.
        const record = _descriptionRecord(pc.localDescription, 'offer', offerId);
        if (!sendOffer(core.signal, peer.peerId, record.description, offerId)) {
            throw new Error('targeted offer signaling rejected');
        }
        console.log(`[CollabCore] Sent ${iceRestart ? 'ICE restart' : 'initial'} offer ${offerId} to ${peer.peerId}`);
        return true;
    } catch (error) {
        if (_isCurrentPeer(core, peer) && peer._pendingLocalOfferId === offerId) {
            peer._pendingLocalOfferId = null;
            peer._localOfferId = null;
            peer._candidateOfferId = null;
        }
        throw error;
    } finally {
        peer._makingOffer = false;
    }
}

function _initiateConnection(core, peerId, username) {
    if (core._destroyed || core.peers.has(peerId) || peerId === core.selfId) return Promise.resolve(false);
    if (core.signal?._btManagedPeers?.has(peerId)) return Promise.resolve(false);
    if (core.peers.size >= MAX_UNSOLICITED_PEERS) {
        console.warn(`[CollabCore] Ignoring peer-join for ${peerId}: peer cap (${MAX_UNSOLICITED_PEERS}) reached`);
        return Promise.resolve(false);
    }

    const peer = _createPeerState(peerId, username, _coreNow(core));
    core.peers.set(peerId, peer);
    if (core.selfId < peerId) {
        console.log('[CollabCore] Waiting for targeted offer from', peerId, '(they have higher id)');
        return Promise.resolve(true);
    }

    console.log('[CollabCore] Initiating targeted connection to', peerId);
    const pc = _createPeerConnection(core, peerId, peer, true);
    peer.pc = pc;
    peer.opsChannel = pc.createDataChannel('ops', { ordered: true });
    peer.presenceChannel = pc.createDataChannel('presence', { ordered: false, maxRetransmits: 0 });
    _wireDataChannel(core, peerId, peer.opsChannel, 'ops');
    _wireDataChannel(core, peerId, peer.presenceChannel, 'presence');

    return _enqueueNegotiation(core, peer, 'initial offer', async () => {
        try {
            const sent = await _createAndSendLocalOffer(core, peer);
            if (!sent && _isCurrentPeer(core, peer)) _closePeer(core, peerId, peer);
            return sent;
        } catch (error) {
            console.warn('[CollabCore] Failed to create initial offer for', peerId, error?.message || error);
            if (_isCurrentPeer(core, peer)) _closePeer(core, peerId, peer);
            return false;
        }
    });
}

function _handleRemoteOffer(core, peerId, sdpOffer, offerId) {
    if (core._destroyed || peerId === core.selfId) return Promise.resolve(false);
    if (!core.peers.has(peerId)) {
        try { core.onPeerDiscovered(peerId, 'Unknown'); } catch (_) { /* observer isolation */ }
        try {
            if (core.shouldConnectPeer(peerId, 'Unknown') === false) return Promise.resolve(false);
        } catch (_) {
            return Promise.resolve(false);
        }
    }
    let record;
    try {
        record = _descriptionRecord(sdpOffer, 'offer', offerId);
    } catch (error) {
        console.warn(`[CollabCore] Rejecting offer from ${peerId}:`, error.message);
        return Promise.resolve(false);
    }

    let peer = core.peers.get(peerId);
    if (!peer && core.peers.size >= MAX_UNSOLICITED_PEERS) {
        console.warn(`[CollabCore] Rejecting offer from ${peerId}: peer cap (${MAX_UNSOLICITED_PEERS}) reached`);
        return Promise.resolve(false);
    }
    if (!peer) {
        peer = _createPeerState(peerId, 'Unknown', _coreNow(core));
        core.peers.set(peerId, peer);
    }
    if (!peer.pc || peer.pc.connectionState === 'closed' || peer.pc.connectionState === 'failed') {
        peer.pc = _createPeerConnection(core, peerId, peer, false);
    }
    _wireIncomingDataChannels(core, peer, peer.pc);

    return _enqueueNegotiation(core, peer, `remote offer ${offerId}`, async () => {
        const fingerprintState = _fingerprintState(peer._seenRemoteOffers, offerId, record.fingerprint);
        if (fingerprintState === 'duplicate') {
            console.debug(`[CollabCore] Ignoring duplicate offer ${offerId} from ${peerId}`);
            return true;
        }
        if (fingerprintState === 'conflict') {
            console.warn(`[CollabCore] Rejecting offer ${offerId} from ${peerId}: offerId reused with different SDP`);
            return false;
        }

        const pc = peer.pc;
        const pcGeneration = pc?._collabPcGeneration;
        if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
        if (pc.signalingState === 'have-local-offer') {
            const weArePolite = core.selfId < peerId;
            if (!weArePolite) {
                console.log(`[CollabCore] Glare: ignoring offer ${offerId} from ${peerId} (impolite peer)`);
                _rememberFingerprint(peer._seenRemoteOffers, offerId, record.fingerprint, MAX_SEEN_SDP_GENERATIONS);
                _rememberFingerprint(peer._ignoredRemoteOffers, offerId, record.fingerprint, MAX_SEEN_SDP_GENERATIONS);
                return true;
            }
            console.log(`[CollabCore] Glare: rolling back ${peer._pendingLocalOfferId || 'local offer'} for ${offerId} from ${peerId}`);
            await pc.setLocalDescription({ type: 'rollback' });
            if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
            peer._pendingLocalOfferId = null;
            peer._localOfferId = null;
        } else if (pc.signalingState !== 'stable') {
            console.warn(`[CollabCore] Rejecting offer ${offerId} from ${peerId}: signaling state ${pc.signalingState}`);
            return false;
        }

        peer._remoteOfferId = offerId;
        peer._pendingLocalOfferId = null;
        peer._localOfferId = null;
        peer._candidateOfferId = offerId;
        peer._ignoredRemoteOffers.delete(offerId);
        _discardPendingCandidateGenerations(peer, offerId);
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(record.description));
            if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
            const answer = await pc.createAnswer();
            if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
            await pc.setLocalDescription(answer);
            if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
            // The correlated candidate stream completes this description. Do
            // not hold the negotiation queue open for ICE gathering.
            const answerRecord = _descriptionRecord(pc.localDescription, 'answer', offerId);
            if (!sendAnswer(core.signal, peerId, answerRecord.description, offerId)) {
                throw new Error('targeted answer signaling rejected');
            }
            await _drainPendingCandidates(core, peer, pc, offerId);
            _rememberFingerprint(peer._seenRemoteOffers, offerId, record.fingerprint, MAX_SEEN_SDP_GENERATIONS);
            console.log(`[CollabCore] Applied offer ${offerId} and sent correlated answer to ${peerId}`);
            return true;
        } catch (error) {
            if (_isCurrentPeer(core, peer) && peer._remoteOfferId === offerId) {
                peer._remoteOfferId = null;
                peer._candidateOfferId = null;
            }
            throw error;
        }
    });
}

function _handleRemoteAnswer(core, peerId, sdpAnswer, offerId) {
    if (core._destroyed) return Promise.resolve(false);
    let record;
    try {
        record = _descriptionRecord(sdpAnswer, 'answer', offerId);
    } catch (error) {
        console.warn(`[CollabCore] Rejecting answer from ${peerId}:`, error.message);
        return Promise.resolve(false);
    }
    const peer = core.peers.get(peerId);
    if (!peer?.pc) {
        console.warn(`[CollabCore] Rejecting answer ${offerId} from unknown peer ${peerId}`);
        return Promise.resolve(false);
    }

    return _enqueueNegotiation(core, peer, `remote answer ${offerId}`, async () => {
        const fingerprintState = _fingerprintState(peer._seenRemoteAnswers, offerId, record.fingerprint);
        if (fingerprintState === 'duplicate') {
            console.debug(`[CollabCore] Ignoring duplicate answer ${offerId} from ${peerId}`);
            return true;
        }
        if (fingerprintState === 'conflict') {
            console.warn(`[CollabCore] Rejecting answer ${offerId} from ${peerId}: offerId reused with different SDP`);
            return false;
        }
        if (peer._pendingLocalOfferId !== offerId) {
            console.warn(`[CollabCore] Rejecting stale or mismatched answer ${offerId} from ${peerId}; pending ${peer._pendingLocalOfferId || 'none'}`);
            _rememberFingerprint(peer._seenRemoteAnswers, offerId, record.fingerprint, MAX_SEEN_SDP_GENERATIONS);
            return false;
        }

        const pc = peer.pc;
        const pcGeneration = pc?._collabPcGeneration;
        if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
        if (pc.signalingState !== 'have-local-offer') {
            console.warn(`[CollabCore] Rejecting answer ${offerId} from ${peerId}: signaling state ${pc.signalingState}`);
            return false;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(record.description));
        if (!_isCurrentPc(core, peer, pc, pcGeneration)) return false;
        peer._pendingLocalOfferId = null;
        peer._localOfferId = offerId;
        peer._candidateOfferId = offerId;
        await _drainPendingCandidates(core, peer, pc, offerId);
        _rememberFingerprint(peer._seenRemoteAnswers, offerId, record.fingerprint, MAX_SEEN_SDP_GENERATIONS);
        console.log(`[CollabCore] Applied correlated answer ${offerId} from ${peerId}`);
        return true;
    });
}

function _handleRemoteCandidate(core, peerId, candidate, offerId) {
    if (core._destroyed) return Promise.resolve(false);
    let record;
    try {
        record = _candidateRecord(candidate, offerId);
    } catch (error) {
        console.warn(`[CollabCore] Rejecting candidate from ${peerId}:`, error.message);
        return Promise.resolve(false);
    }
    const peer = core.peers.get(peerId);
    if (!peer) {
        console.warn(`[CollabCore] Rejecting candidate ${offerId} from unknown peer ${peerId}`);
        return Promise.resolve(false);
    }

    return _enqueueNegotiation(core, peer, `candidate ${offerId}`, async () => {
        if (peer._seenRemoteCandidates.has(record.key)) {
            console.debug(`[CollabCore] Ignoring duplicate candidate ${record.fingerprint} from ${peerId}`);
            return true;
        }
        _rememberFingerprint(peer._seenRemoteCandidates, record.key, record.fingerprint, MAX_SEEN_CANDIDATES);
        if (peer._ignoredRemoteOffers.has(offerId)) {
            console.debug(`[CollabCore] Ignoring candidate for glare-rejected offer ${offerId} from ${peerId}`);
            return true;
        }

        const active = offerId === peer._localOfferId || offerId === peer._remoteOfferId;
        const pc = peer.pc;
        if (!active || !pc?.remoteDescription) return _storePendingCandidate(peer, record);
        if (!_isCurrentPc(core, peer, pc)) return false;
        try {
            await pc.addIceCandidate(new RTCIceCandidate(record.candidate));
            return true;
        } catch (error) {
            peer._seenRemoteCandidates.delete(record.key);
            throw error;
        }
    });
}

function _notifyPeerLeave(core, peer) {
    if (!peer || peer._leaveNotified || core._destroyed) return;
    peer._leaveNotified = true;
    core.onPeerLeave(peer.peerId);
}

function _handlePeerLeave(core, peerId) {
    if (core._destroyed) return;
    const peer = core.peers.get(peerId);
    if (!peer) return;
    _closePeer(core, peerId, peer);
    _notifyPeerLeave(core, peer);
}

// ─── RTCPeerConnection factory ────────────────────────────────────────────────

function _createPeerConnection(core, peerId, peer, isInitiator) {
    const iceServers = core.signal?._iceServers || ICE_SERVERS_DEFAULT;
    // Anonymous mode: force TURN-only to prevent IP address leakage between peers
    const iceConfig = core._anonMode
        ? { iceServers, iceTransportPolicy: 'relay' }
        : { iceServers };
    const pc = new RTCPeerConnection(iceConfig);
    const pcGeneration = ++peer._pcGeneration;
    pc._collabPcGeneration = pcGeneration;
    pc._collabInitiator = !!isInitiator;

    pc.onicecandidate = (evt) => {
        if (!evt.candidate || !_isCurrentPc(core, peer, pc, pcGeneration)) return;
        const offerId = peer._candidateOfferId;
        if (!_validOfferId(offerId)) {
            console.debug(`[CollabCore] Dropping uncorrelated local candidate for ${peerId}`);
            return;
        }
        const payload = typeof evt.candidate.toJSON === 'function' ? evt.candidate.toJSON() : evt.candidate;
        if (!sendCandidate(core.signal, peerId, payload, offerId)) {
            console.warn(`[CollabCore] Failed to signal candidate ${offerId} to ${peerId}`);
        }
    };

    pc.onconnectionstatechange = () => {
        if (!_ownsPeerConnection(core, peer, pc, pcGeneration)) return;
        const state = pc.connectionState;
        console.log(`[CollabCore] Peer ${peerId} state: ${state}`);

        if (state === 'connected') {
            if (peer._reconnectTimerId != null) {
                clearTimeout(peer._reconnectTimerId);
                peer._reconnectTimerId = null;
            }
            peer.reconnectAttempts = 0;
            if (!Number.isFinite(peer._connectedAt)) peer._connectedAt = _coreNow(core);
            peer._iceRestarting = false;
            _logConnectionType(pc, peerId);
            // Guard: BT channels already fire onPeerJoin via _adoptBTChannels.
            // Only fire if this is the first connected notification for this peer.
            if (!peer._joinNotified) {
                peer._joinNotified = true;
                core.onPeerJoin(peerId, peer.username);
            }
        } else if (state === 'failed') {
            // STUN-only failed — try fetching TURN credentials as fallback
            // This is the ONLY time we hit Cloudflare for TURN relay data
            if (!peer._turnRetried && core.signal) {
                peer._turnRetried = true;
                fetchTurnCredentials(core.signal).then((hasTurn) => {
                    if (!_ownsPeerConnection(core, peer, pc, pcGeneration)) return;
                    if (hasTurn) {
                        console.log('[CollabCore] Retrying with TURN relay for', peerId);
                        const attempts = peer.reconnectAttempts;
                        _closePeer(core, peerId, peer);
                        const reconnect = _initiateConnection(core, peerId, peer.username);
                        const fresh = core.peers.get(peerId);
                        if (fresh) fresh.reconnectAttempts = attempts;
                        void reconnect;
                    } else {
                        _scheduleReconnect(core, peerId, peer);
                    }
                });
            } else {
                _scheduleReconnect(core, peerId, peer);
            }
        } else if (state === 'disconnected') {
            _scheduleReconnect(core, peerId, peer);
        } else if (state === 'closed') {
            peer._closed = true;
            if (core.peers.get(peerId) === peer) core.peers.delete(peerId);
            _notifyPeerLeave(core, peer);
        }
    };

    return pc;
}

/**
 * Log whether the connection is direct P2P or relayed through TURN.
 * Uses getStats() to inspect the active ICE candidate pair.
 */
async function _logConnectionType(pc, peerId) {
    try {
        const stats = await pc.getStats();
        for (const [, report] of stats) {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                const localId = report.localCandidateId;
                const remoteId = report.remoteCandidateId;
                let localType = '?', remoteType = '?';
                for (const [, r] of stats) {
                    if (r.id === localId) localType = r.candidateType || '?';
                    if (r.id === remoteId) remoteType = r.candidateType || '?';
                }
                const isRelay = localType === 'relay' || remoteType === 'relay';
                if (isRelay) {
                    console.warn(`[CollabCore] ⚠ Peer ${peerId}: RELAY connection (TURN) — Cloudflare bandwidth used`);
                } else {
                    console.log(`[CollabCore] ✓ Peer ${peerId}: DIRECT P2P (${localType}↔${remoteType}) — zero server cost`);
                }
                break;
            }
        }
    } catch (_) {}
}

// ─── Data channel wiring ──────────────────────────────────────────────────────

function _wireDataChannel(core, peerId, channel, type) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
        console.log(`[CollabCore] DataChannel '${type}' open with ${peerId}`);
        // Send DC hello on ops channel so the remote peer gets our identity data
        // (BT-adopted peers already exchanged hellos; this covers pure-WebRTC peers)
        if (type === 'ops' && channel.readyState === 'open') {
            const hello = { ch: 'ops', data: { type: '__dc_hello__' } };
            if (core._publicKeyRaw) hello.data.publicKey = Array.from(core._publicKeyRaw);
            if (core._identityProof) hello.data.identityProof = Array.from(core._identityProof);
            if (core._ecdhPublicKeyRaw) hello.data.ecdhKey = Array.from(core._ecdhPublicKeyRaw);
            try {
                channel.send(msgpackEncode(hello).buffer);
            } catch (_) {}
        }
    };

    channel.onmessage = (evt) => {
        _handleIncoming(core, peerId, evt.data);
    };

    channel.onerror = (err) => {
        const peer = core.peers.get(peerId);
        const isCurrentChannel = peer
            && !peer._closed
            && (peer.opsChannel === channel || peer.presenceChannel === channel);
        if (core._destroyed || !isCurrentChannel || channel.readyState === 'closed') return;
        console.warn(`[CollabCore] DataChannel '${type}' error with ${peerId}:`, err);
    };
}

// ─── Reconnection ─────────────────────────────────────────────────────────────

function _scheduleReconnect(core, peerId, peer) {
    if (!_isCurrentPeer(core, peer) || peer._reconnectTimerId != null) return;
    const plan = collabReconnectPlanReport(peer.reconnectAttempts);
    if (!plan.valid || plan.exhausted) {
        console.warn('[CollabCore] Max reconnect attempts reached for', peerId);
        _closePeer(core, peerId, peer);
        _notifyPeerLeave(core, peer);
        return;
    }

    const delay = plan.delayMs;
    peer.reconnectAttempts = plan.attempt;
    peer._totalReconnects++;

    console.log(`[CollabCore] Reconnecting to ${peerId} in ${delay}ms (attempt ${peer.reconnectAttempts})`);
    const savedUsername = peer.username;
    const savedAttempts = peer.reconnectAttempts;
    const savedTotalReconnects = peer._totalReconnects;
    peer._reconnectTimerId = setTimeout(() => {
        peer._reconnectTimerId = null;
        if (!_isCurrentPeer(core, peer)) return;
        _closePeer(core, peerId, peer);
        const reconnect = _initiateConnection(core, peerId, savedUsername);
        const fresh = core.peers.get(peerId);
        if (fresh) {
            fresh.reconnectAttempts = savedAttempts;
            fresh._totalReconnects = savedTotalReconnects;
        }
        void reconnect.then(() => {
            if (!core._destroyed) forceDiscovery(core);
        });
    }, delay);
}

export function collabReconnectPlanReport(attempts) {
    const report = finiteNumberReport(attempts, {
        integer: true,
        min: 0,
        max: MAX_RECONNECT_ATTEMPTS,
        allowNegativeZero: false,
    });
    if (!report.valid) {
        return { valid: false, reason: report.reason, delayMs: 0, attempt: 0, exhausted: true };
    }
    if (report.value >= MAX_RECONNECT_ATTEMPTS) {
        return { valid: true, reason: 'exhausted', delayMs: 0, attempt: report.value, exhausted: true };
    }
    const backoff = createReconnectBackoff({
        baseMs: RECONNECT_BASE_MS,
        maxMs: RECONNECT_MAX_MS,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
        jitterRatio: 0,
        random: () => 0.5,
    });
    backoff.attempts = report.value;
    const next = nextBackoffDelay(backoff);
    return { valid: true, reason: 'valid', ...next };
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

function _startHeartbeat(core) {
    _stopHeartbeat(core);
    core._heartbeatTimer = setInterval(() => {
        if (core._destroyed) { _stopHeartbeat(core); return; }
        const now = _coreNow(core);
        for (const [peerId, peer] of core.peers) {
            // Send ping
            if (peer.opsChannel?.readyState === 'open') {
                _sendBinary(peer, 'ops', { ch: 'ops', data: { type: '__ping__', ts: now } });
            }
            // ── Dead peer detection ──────────────────────────────────
            // Check how long since we last received a pong from this peer.
            // At ICE_RESTART_TIMEOUT_MS: try ICE restart (cheaper than new PC).
            // At DEAD_PEER_TIMEOUT_MS: declare peer dead.
            const liveness = collabHeartbeatReport(peer._lastPongTs, now);
            const silenceMs = liveness.silenceMs;
            if (liveness.action === 'disconnect') {
                console.warn(`[CollabCore] Peer ${peerId} dead (no pong for ${silenceMs}ms) — disconnecting`);
                _closePeer(core, peerId, peer);
                _notifyPeerLeave(core, peer);
            } else if (liveness.action === 'restart' && !peer._iceRestarting) {
                _attemptIceRestart(core, peerId, peer);
            }
        }
    }, HEARTBEAT_INTERVAL_MS);
}

function _stopHeartbeat(core) {
    if (core._heartbeatTimer != null) {
        clearInterval(core._heartbeatTimer);
        core._heartbeatTimer = null;
    }
}

export function collabHeartbeatReport(lastPongMs, timestampMs) {
    const lastReport = finiteNumberReport(lastPongMs, { min: 0, allowNegativeZero: false });
    const timestampReport = finiteNumberReport(timestampMs, { min: 0, allowNegativeZero: false });
    if (!lastReport.valid || !timestampReport.valid) {
        return { valid: false, reason: 'invalid-clock', timestampMs: 0, silenceMs: 0, action: 'healthy' };
    }
    const clock = runtimeMonotonicClockStep(timestampReport.value, lastReport.value);
    const silenceMs = clock.elapsedMs;
    const action = silenceMs >= DEAD_PEER_TIMEOUT_MS
        ? 'disconnect'
        : (silenceMs >= ICE_RESTART_TIMEOUT_MS ? 'restart' : 'healthy');
    return { valid: true, reason: 'valid', timestampMs: clock.timestampMs, silenceMs, action };
}

function _coreNow(core, timestampMs = Date.now()) {
    const clock = runtimeMonotonicClockStep(timestampMs, core._clockMs);
    core._clockMs = clock.timestampMs;
    return clock.timestampMs;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _createPeerState(peerId, username, timestampMs) {
    return {
        _generation: ++_peerGenerationSequence,
        _closed: false,
        _leaveNotified: false,
        peerId,
        username: username || 'Anonymous',
        color: null,
        pc: null,
        opsChannel: null,
        presenceChannel: null,
        reconnectAttempts: 0,
        _reconnectTimerId: null,
        _pcGeneration: 0,
        _negotiationTail: Promise.resolve(),
        _negotiationQueueDepth: 0,
        _makingOffer: false,
        _pendingLocalOfferId: null,
        _localOfferId: null,
        _remoteOfferId: null,
        _candidateOfferId: null,
        _pendingCandidates: new Map(),
        _pendingCandidateCount: 0,
        _pendingCandidateBytes: 0,
        _keyDerivationPromise: null,
        _seenRemoteOffers: new Map(),
        _seenRemoteAnswers: new Map(),
        _seenRemoteCandidates: new Map(),
        _ignoredRemoteOffers: new Map(),
        crypto: createPeerCryptoState(), // ECDH + AES-GCM state
        _lastPongTs: runtimeMonotonicClockStep(timestampMs, 0).timestampMs,
        _connectedAt: null,
        _totalReconnects: 0,
        _turnRetried: false,             // TURN fallback attempted
        _iceRestarting: false,           // ICE restart in progress
    };
}

/**
 * Attempt an ICE restart for a peer whose connection is degrading.
 * ICE restart renegotiates ICE candidates without destroying the PeerConnection,
 * which is faster and less disruptive than creating a new one.
 * Best practice from: https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce
 */
function _attemptIceRestart(core, peerId, peer) {
    if (!_isCurrentPeer(core, peer) || !peer.pc || peer.pc.connectionState === 'closed' || peer._iceRestarting) {
        return Promise.resolve(false);
    }
    peer._iceRestarting = true;
    const result = _enqueueNegotiation(core, peer, 'ICE restart', async () => {
        console.log(`[CollabCore] Attempting targeted ICE restart for ${peerId}`);
        try {
            return await _createAndSendLocalOffer(core, peer, { iceRestart: true });
        } catch (error) {
            console.warn(`[CollabCore] ICE restart failed for ${peerId}:`, error?.message || error);
            return false;
        }
    });
    return result.then((value) => {
        if (_isCurrentPeer(core, peer)) peer._iceRestarting = false;
        return value;
    });
}

/**
 * Broadcast a graceful goodbye to all peers before leaving.
 * This lets other peers immediately remove us instead of waiting for
 * heartbeat timeout or WebRTC state change.
 */
export function broadcastGoodbye(core) {
    const goodbyeOp = { type: 'peer_goodbye', payload: { peerId: core.selfId, wasHost: core._isHost } };
    for (const [, peer] of core.peers) {
        if (peer.opsChannel?.readyState === 'open') {
            try { _sendBinary(peer, 'ops', { ch: 'ops', data: goodbyeOp }); } catch (_) {}
        }
    }
    // Also via fast channel
    fastChannelSendOp(core._fastChannel, goodbyeOp);
}

function _closePeer(core, peerId, expectedPeer = null) {
    const peer = core.peers.get(peerId);
    if (!peer || (expectedPeer && peer !== expectedPeer)) return false;

    peer._closed = true;
    if (peer._reconnectTimerId != null) {
        clearTimeout(peer._reconnectTimerId);
        peer._reconnectTimerId = null;
    }
    peer._pendingCandidates.clear();
    peer._pendingCandidateCount = 0;
    peer._pendingCandidateBytes = 0;
    const chunkPrefix = `${peerId}\0`;
    for (const transferKey of core._chunkBuffers.keys()) {
        if (transferKey.startsWith(chunkPrefix)) _deleteChunkBuffer(core, transferKey);
    }

    try { peer.opsChannel?.close(); } catch (_) {}
    try { peer.presenceChannel?.close(); } catch (_) {}
    try {
        if (peer.pc) {
            peer.pc.onicecandidate = null;
            peer.pc.onconnectionstatechange = null;
            peer.pc.ondatachannel = null;
            peer.pc.close();
        }
    } catch (_) {}

    if (core.peers.get(peerId) === peer) core.peers.delete(peerId);
    return true;
}

// ─── Binary send / receive ────────────────────────────────────────────────────

/**
 * Send a message as binary msgpack (optionally encrypted) over a data channel.
 * @param {Object} peer - PeerState
 * @param {'ops'|'presence'} channelType
 * @param {Object} msg - JS object to encode
 */
// Max buffered bytes before we drop non-critical messages (64 KB).
// WebRTC SCTP has a send buffer (~256KB typically). If we let it fill,
// the channel will close with an error. Dropping presence/heartbeat is
// far better than killing the connection.
const MAX_BUFFERED_AMOUNT = 65536;

function _sendBinary(peer, channelType, msg) {
    const ch = channelType === 'presence' ? peer.presenceChannel : peer.opsChannel;
    if (!ch || ch.readyState !== 'open') return;

    // Backpressure: drop non-critical messages when buffer is filling up.
    // Critical ops (scene changes) still attempt send — they're reliable-ordered
    // and the SCTP layer will queue them. But presence/pings can be dropped.
    const buffered = collabBufferedAmountReport(ch.bufferedAmount);
    if (buffered.value > MAX_BUFFERED_AMOUNT) {
        const msgType = msg?.data?.type;
        const isCritical = msgType && msgType !== '__ping__' && msgType !== '__pong__'
            && !msgType.startsWith('__rep_');
        if (!isCritical) return; // drop non-critical when backpressured
    }

    try {
        const encoded = msgpackEncode(msg);

        // Encrypt with AES-256-GCM if shared key is derived
        if (peer._aesKey) {
            let counter;
            try {
                counter = nextCryptoSendCounter(peer.crypto);
            } catch (error) {
                console.warn(`[CollabCore] Encrypted send blocked for ${peer.peerId}:`, error.message);
                return;
            }
            aesEncrypt(peer._aesKey, encoded, counter, peer._channelId).then((encrypted) => {
                // Prefix 0x01 = encrypted, so receiver knows to decrypt
                const wire = new Uint8Array(1 + encrypted.length);
                wire[0] = 0x01;
                wire.set(encrypted, 1);
                if (ch.readyState === 'open') ch.send(wire.buffer);
            }).catch((error) => {
                console.warn(`[CollabCore] Encrypted send failed for ${peer.peerId}:`, error.message);
            });
            return;
        }

        ch.send(encoded.buffer);
    } catch (err) {
        // InvalidStateError = channel closed between our readyState check and send()
        // TypeError = data too large for SCTP (rare, >256KB)
        if (err.name !== 'InvalidStateError') {
            console.warn(`[CollabCore] Send error on ${channelType} to ${peer.peerId}:`, err.name);
        }
    }
}

/**
 * Handle an incoming data channel message.
 * Supports both binary msgpack (ArrayBuffer) and legacy JSON (string) for backward compat.
 * @param {Object} core
 * @param {string} peerId
 * @param {ArrayBuffer|string} raw
 */
function _handleIncoming(core, peerId, raw) {
    let msg;
    try {
        if (raw instanceof ArrayBuffer) {
            const bytes = new Uint8Array(raw);
            const peer = core.peers.get(peerId);
            // Check 1-byte encryption prefix: 0x01 = encrypted, 0x00 = plaintext-with-prefix
            if (bytes[0] === 0x01) {
                if (bytes.length <= 1) return;
                // Encrypted message — must decrypt asynchronously
                if (peer?._aesKey) {
                    const encrypted = bytes.subarray(1);
                    aesDecrypt(peer._aesKey, encrypted, peer._recvChannelId, peer.crypto).then((plaintext) => {
                        if (!_isCurrentPeer(core, peer)) return;
                        try {
                            const decoded = msgpackDecode(plaintext);
                            _processDecodedMessage(core, peerId, decoded);
                        } catch (_) {}
                    }).catch(() => {
                        // Decryption failed — could be nonce mismatch or corrupted
                        console.warn('[CollabCore] Decryption failed for message from', peerId);
                    });
                    return;
                }
                // No AES key yet — drop encrypted message (shouldn't happen normally)
                return;
            }
            // Once a key is active, plaintext and legacy raw MessagePack are downgrades.
            if (peer?._aesKey) return;
            // Plaintext: either 0x00 prefix (skip it) or raw msgpack (no prefix, backward compat)
            const payload = (bytes.length > 1 && bytes[0] === 0x00) ? bytes.subarray(1) : bytes;
            msg = msgpackDecode(payload);
        } else if (typeof raw === 'string') {
            // Legacy JSON fallback (interop with old peers)
            msg = JSON.parse(raw);
        } else {
            return;
        }
    } catch (_) { return; }

    if (!msg) return;
    _processDecodedMessage(core, peerId, msg);
}

/**
 * Process a decoded message (shared by plaintext and decrypted paths).
 * Handles chunk reassembly, ping/pong, gossip forwarding, and op/presence routing.
 */
function _processDecodedMessage(core, peerId, msg) {
    if (!msg) return;

    // ── Chunk reassembly (large messages split by sendToPeer) ──
    if (msg.data?.type === '__chunk__') {
        const report = collabChunkEnvelopeReport(msg.data);
        if (!report.valid) return;
        const { chunkId, index, total, payload } = report.value;
        const transferKey = `${peerId}\0${chunkId}`;
        let buf = core._chunkBuffers.get(transferKey);
        if (!buf) {
            if (core._chunkBuffers.size >= MAX_CHUNK_TRANSFERS) return;
            buf = { chunks: new Array(total), received: 0, totalBytes: 0, ts: _coreNow(core), timerId: null };
            core._chunkBuffers.set(transferKey, buf);
            // Auto-cleanup after 30s to prevent memory leaks from incomplete transfers
            buf.timerId = setTimeout(() => {
                if (core._chunkBuffers.get(transferKey) !== buf) return;
                buf.timerId = null;
                core._chunkBuffers.delete(transferKey);
            }, 30000);
        }
        if (buf.chunks.length !== total) return;
        if (!buf.chunks[index]) {
            const nextTotalBytes = buf.totalBytes + payload.byteLength;
            if (!Number.isSafeInteger(nextTotalBytes) || nextTotalBytes > COLLAB_CODEC_LIMITS.maxBytes) {
                _deleteChunkBuffer(core, transferKey);
                return;
            }
            buf.chunks[index] = payload;
            buf.received++;
            buf.totalBytes = nextTotalBytes;
        }
        if (buf.received === total) {
            _deleteChunkBuffer(core, transferKey);
            // Reassemble and decode the original message
            const assembled = new Uint8Array(buf.totalBytes);
            let offset = 0;
            for (const c of buf.chunks) { assembled.set(c, offset); offset += c.byteLength; }
            try {
                const reassembled = msgpackDecode(assembled);
                if (reassembled?.data) {
                    reassembled.data.peerId = reassembled.data.peerId || peerId;
                    core.onOp(peerId, reassembled.data);
                }
            } catch (_) {}
        }
        return;
    }

    // Route __pong__ — update last-seen timestamp
    if (msg.data?.type === '__pong__') {
        const peer = core.peers.get(peerId);
        if (peer) peer._lastPongTs = _coreNow(core);
        return;
    }

    // ── DC hello: identity exchange over WebRTC data channels ──
    // BT-adopted peers already have identity from the signal-layer hello.
    // Pure-WebRTC peers need this to get publicKey/ecdhKey for E2E + identity registry.
    if (msg.data?.type === '__dc_hello__') {
        const peer = core.peers.get(peerId);
        if (peer) {
            if (msg.data.publicKey && !peer._remotePublicKey) {
                peer._remotePublicKey = msg.data.publicKey;
            }
            if (msg.data.identityProof && !peer._remoteIdentityProof) {
                peer._remoteIdentityProof = msg.data.identityProof;
            }
            // Derive ECDH shared key if we haven't already
            if (core._cryptoEnabled && core._ecdhPrivateKey && msg.data.ecdhKey && !peer._aesKey) {
                _deriveSharedKey(core, peer, msg.data.ecdhKey).catch((err) => {
                    console.warn('[CollabCore] DC hello ECDH derivation failed:', err.message);
                });
            }
            // Notify EditorCollab so it can register identity
            core.onPeerIdentity(peerId, {
                publicKey: msg.data.publicKey || null,
                identityProof: msg.data.identityProof || null,
                ecdhKey: msg.data.ecdhKey || null,
            });
        }
        return;
    }

    // Respond to __ping__ with __pong__
    if (msg.data?.type === '__ping__') {
        const peer = core.peers.get(peerId);
        if (peer) {
            _sendBinary(peer, 'ops', { ch: 'ops', data: { type: '__pong__', ts: msg.data.ts } });
        }
        return;
    }

    if (msg.ch === 'presence') {
        core.onPresence(peerId, msg.data);
    } else {
        if (msg.data) {
            // ── Gossip forwarding ────────────────────────────────────────
            // If this op has gossip metadata and we're in gossip mode,
            // forward it to our other neighbors (minus sender + origin).
            // Dedup ensures we never process or forward the same op twice.
            if (msg.data._gossip && core._topology && shouldGossip(core._topology)) {
                const result = gossipReceive(core._topology, peerId, msg.data);
                if (!result.op) return; // deduped — already processed this op
                // Forward to other neighbors
                if (result.forward && result.targets.length > 0) {
                    for (const targetId of result.targets) {
                        if (isFastPeer(core._fastChannel, targetId)) continue;
                        const targetPeer = core.peers.get(targetId);
                        if (targetPeer?.opsChannel?.readyState === 'open') {
                            _sendBinary(targetPeer, 'ops', { ch: 'ops', data: result.forwardOp });
                        }
                    }
                }
                // Deliver locally (strip gossip metadata for clean processing)
                const cleanOp = { ...result.op };
                delete cleanOp._gossip;
                cleanOp.peerId = cleanOp.peerId || result.op._gossip?.origin || peerId;
                core.onOp(peerId, cleanOp);
                return;
            }

            msg.data.peerId = msg.data.peerId || peerId;
            core.onOp(peerId, msg.data);
        }
    }
}

function _deleteChunkBuffer(core, transferKey) {
    const buffer = core._chunkBuffers.get(transferKey);
    if (!buffer) return false;
    if (buffer.timerId != null) clearTimeout(buffer.timerId);
    buffer.timerId = null;
    core._chunkBuffers.delete(transferKey);
    return true;
}

function _genId() {
    const cryptoApi = globalThis.crypto;
    try {
        if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
        if (typeof cryptoApi?.getRandomValues === 'function') {
            const bytes = new Uint8Array(16);
            cryptoApi.getRandomValues(bytes);
            return byteSignature(bytes);
        }
    } catch (_) { /* use the deterministic local fallback below */ }
    return `${Date.now().toString(36)}-${(++_collabIdSequence).toString(36)}`;
}

// Audit gaps: heartbeat pong packets have no correlation token, and route/topology
// callbacks still do not apply connection recommendations.
// Reconnect has no measured-network jitter policy; captured multi-peer ICE failure, clock
// regression, timer, and SCTP pressure traces remain absent.
