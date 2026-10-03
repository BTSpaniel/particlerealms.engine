// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabSignal.js
 * 4-tier signaling abstraction for WebRTC peer discovery.
 *
 * Tier 1: BroadcastChannel     — same machine, instant, offline
 * Tier 2: SharedWorker         — same machine multi-tab relay
 * Tier 4: Particle Masterserver — PRIMARY cross-internet signaling relay.
 *         Pinned V2 endpoints use the shared ParticleNetworkDaemon; legacy
 *         V1 is accepted only when that endpoint explicitly opts in.
 *         Uses the same room/route-scoped HELLO/OFFER/ANSWER/CANDIDATE dispatch
 *         as Tiers 1/2 (see _handleSignalMessage) rather than a binary swarm
 *         protocol — the Masterserver just fans opaque JSON out to every other
 *         session attached to the same locally-derived opaque route. This is
 *         server-mediated, so it works across NATs/networks without any
 *         third-party dependency. Server-configured via localStorage
 *         'os.network.masterServers' (same list the Particle Network control
 *         panel app manages); falls back to the pinned production bootstrap if unset.
 * Tier 3: BitTorrent WSS       — EXPLICIT FALLBACK ONLY. It remains off by
 *         default and can run only after the user opts in. A V2 integrity
 *         failure always fails closed and suppresses legacy/BitTorrent downgrade.
 *
 * Tiers 1/2/4 start immediately; Tier 3 is deferred/conditional (see above).
 * First tier to form a WebRTC connection to a given peer wins — after that,
 * signaling is no longer needed for that peer.
 */

import { encode as msgpackEncode, decode as msgpackDecode } from './CollabCodec.js';
import { legacySha1Hex } from '../core/math/ChecksumMath.js';
import { byteSignature, hexToBytes as formatHexToBytes } from '../core/math/FormatMath.js';
import { finiteNumberReport } from '../core/math/MathValidation.js';
import { createReconnectBackoff, nextBackoffDelay } from '../network/routes/ReconnectBackoff.js';
import { loadParticleMasterServers } from '../network/routes/MasterServerList.js';

// Public WebTorrent WSS trackers (verified working as of 2025)
// Source: https://github.com/ngosang/trackerslist (trackers_all_ws.txt)
// btorrent.xyz + files.fm:7073 are dead — removed (they failed on every connect,
// spamming retries and wasting a rendezvous slot). Keep only currently-working WSS.
const BT_TRACKERS = [
    'wss://tracker.openwebtorrent.com',        // openwebtorrent.com project — most reliable
    'wss://tracker.webtorrent.dev',            // webtorrent official
];

const APP_PREFIX = 'particle-engine-collab-v1:';
const BC_CHANNEL = 'collab-signal-v1';
// Resolved at runtime relative to this module file using import.meta.url
// engine/collab/ → ../../editor/js/workers/CollabSignalWorker.js
const SW_WORKER_URL = new URL('../../editor/js/workers/CollabSignalWorker.js', import.meta.url).href;

/**
 * Create a signal channel.
 * config: { projectId, selfId, username, onOffer, onAnswer, onCandidate, onPeerJoin, onPeerLeave }
 * Negotiation callbacks receive (peerId, payload, offerId). Generic signaling
 * is deliberately strict: every OFFER/ANSWER/CANDIDATE is addressed to one
 * peer and correlated to one offer generation. The WebTorrent tier retains its
 * independent tracker offer_id lifecycle and does not use these envelopes.
 */
export function createSignalChannel(config) {
    if (!config || typeof config !== 'object') {
        throw new TypeError('createSignalChannel requires a configuration object');
    }
    const projectId = config.projectId ?? 'default';
    const username = config.username ?? 'Anonymous';
    if (!collabSignalTextReport(projectId, MAX_SIGNAL_PEER_ID_BYTES).valid
        || !collabSignalTextReport(config.selfId, MAX_SIGNAL_PEER_ID_BYTES).valid
        || !collabSignalTextReport(username, MAX_SIGNAL_USERNAME_BYTES, { allowEmpty: true }).valid) {
        throw new RangeError('createSignalChannel requires bounded project, peer, and username text');
    }
    const channel = {
        projectId,
        routeSecret: config.routeSecret ?? null,
        selfId: config.selfId,
        username: username || 'Anonymous',
        // Cryptographic identity (ECDSA P-256) — included in hello for peer verification
        publicKeyRaw: config.publicKeyRaw || null,   // Uint8Array(65) or null
        identityProof: config.identityProof || null,  // Uint8Array(~70) or null
        // Ephemeral ECDH P-256 public key — for deriving shared AES-256-GCM encryption key
        ecdhPublicKeyRaw: config.ecdhPublicKeyRaw || null, // Uint8Array(65) or null
        onOffer: config.onOffer || (() => {}),
        onAnswer: config.onAnswer || (() => {}),
        onCandidate: config.onCandidate || (() => {}),
        onPeerJoin: config.onPeerJoin || (() => {}),
        onPeerLeave: config.onPeerLeave || (() => {}),
        // BT transport callbacks — routed when BT WebRTC data channels are ready
        onOp: config.onOp || (() => {}),
        onPresence: config.onPresence || (() => {}),
        onBTChannels: config.onBTChannels || (() => {}),
        onIceRestartNeeded: config.onIceRestartNeeded || (() => {}),

        // Tier 1
        _bc: null,
        // Tier 2
        _sw: null,
        _swPort: null,
        // Tier 3
        _btSockets: [],
        _btPeerConnections: new Set(),
        _btHandshakeTimers: new Map(),
        _btReconnectTimers: new Set(),
        _btBurstTimers: new Set(),
        _btAnnounceTimers: new Set(),
        _btIceWaits: new Set(),
        _btOffersInFlight: 0,
        _btInfoHash: null,
        _btPeerId: null,
        _btOfferIds: new Map(), // offerId -> peerId
        _btManagedPeers: new Set(),    // UUIDs of peers connected via BT transport
        _btConnectedUUIDs: new Set(), // UUIDs that have already fired onBTChannels (dedup across multi-PC)
        _btActivePCs: new Map(),      // UUID -> primary RTCPeerConnection (only this PC fires onPeerLeave)
        // Tier 4
        _particleClients: [],
        _particleRouteId: null,
        _particleServerQueue: [],
        _particleServerCursor: 0,
        _particleConnectModules: null,
        _particleIntegrityFailure: false,
        _particleFallbackStarted: false,
        _particleFallbackTimer: null,
        _turnPromise: null,
        _generation: 0,
        _destroyed: false,
        _active: false,
    };

    return channel;
}

// Free STUN servers — no data cost, just NAT discovery (~100 bytes per query).
// Multiple servers for redundancy and better symmetric NAT coverage.
// These are all free, public, and operated by major providers.
const FREE_STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
];

/**
 * Fetch TURN relay credentials from Cloudflare Pages Function.
 * ONLY called as a fallback when STUN-only P2P connection fails.
 * TURN relays ALL traffic through Cloudflare = expensive. Avoid unless necessary.
 * @param {Object} channel
 * @returns {Promise<boolean>} true if TURN credentials were obtained
 */
export async function fetchTurnCredentials(channel) {
    if (!channel || channel._destroyed || !channel._active) return false;
    if (channel._turnPromise) return channel._turnPromise;
    if (channel._turnFetched) return channel._hasTurn;
    channel._turnFetched = true;
    const generation = channel._generation;
    channel._turnPromise = (async () => {
        try {
            for (const entry of channel._particleClients || []) {
                if (entry.kind !== 'v2' || typeof entry.client?.getTurnCredentials !== 'function') continue;
                const data = await entry.client.getTurnCredentials();
                const report = collabIceServerListReport(data?.iceServers);
                if (report.valid && channel._active && !channel._destroyed && channel._generation === generation) {
                    channel._iceServers = [...FREE_STUN_SERVERS, ...report.value];
                    channel._hasTurn = data?.relayAvailable !== false && report.hasRelay;
                    channel._turnFetched = true;
                    channel._turnExpiresAt = data.expiresAt;
                    if (data?.mode === 'direct' && data?.relayAvailable === false) return false;
                    if (channel._hasTurn) return true;
                }
            }
            console.log('[CollabSignal] STUN-only failed — fetching TURN relay credentials (fallback)');
            const resp = await fetch('/api/turn/credentials', { cache: 'no-store' });
            if (resp.ok) {
                const data = await resp.json();
                const report = collabIceServerListReport(data?.iceServers);
                if (report.valid && channel._active && !channel._destroyed && channel._generation === generation) {
                    channel._iceServers = [...FREE_STUN_SERVERS, ...report.value];
                    channel._hasTurn = report.hasRelay;
                    if (channel._hasTurn) {
                        console.log('[CollabSignal] TURN credentials obtained — relay available as fallback');
                        return true;
                    }
                }
            }
        } catch (_) {}
        if (channel._generation === generation) channel._hasTurn = false;
        console.warn('[CollabSignal] TURN credentials unavailable — P2P only (no relay fallback)');
        return false;
    })();
    try {
        return await channel._turnPromise;
    } finally {
        if (channel._generation === generation) {
            channel._turnPromise = null;
        }
    }
}

/**
 * Start all 3 signaling tiers simultaneously.
 * Uses FREE STUN servers only — no Cloudflare data cost.
 * TURN relay is only fetched on-demand when a direct P2P connection fails.
 */
export function startSignaling(channel) {
    if (!channel || channel._destroyed || channel._active) return false;
    channel._active = true;
    channel._generation += 1;
    channel._iceServers = FREE_STUN_SERVERS; // free STUN only — zero Cloudflare cost
    channel._turnFetched = false;
    channel._hasTurn = false;
    channel._turnExpiresAt = null;

    _startBroadcastChannel(channel);
    _startSharedWorker(channel);
    _startParticleSignaling(channel); // primary cross-internet tier
    _scheduleBitTorrentFallback(channel); // fallback only — see module doc comment
    return true;
}

/**
 * Force an immediate discovery re-announce across all active tiers, bypassing the
 * periodic announce timers. Used by app-layer "Connect now" so a known contact is
 * found without waiting for the next BC hello / tracker announce cycle.
 */
export function forceAnnounce(channel) {
    if (!channel || !channel._active || channel._destroyed) return false;
    // Tier 1 — BroadcastChannel hello (same-origin tabs).
    if (channel._bc) {
        try { channel._bc.postMessage({ type: 'HELLO', from: channel.selfId, username: channel.username }); } catch (_) {}
    }
    // Tier 3 — re-announce fresh WebRTC offers on every open tracker socket right now.
    for (const ws of channel._btSockets || []) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try { _btAnnounceWithOffers(channel, ws); } catch (_) {}
        }
    }
    // Tier 4 — re-announce HELLO on every connected Particle Masterserver client.
    for (const entry of channel._particleClients || []) {
        try { _particleAnnounce(channel, entry); } catch (_) {}
    }
    return true;
}

const MAX_SIGNAL_PEER_ID_BYTES = 256;
const MAX_SIGNAL_OFFER_ID_BYTES = 128;
const MAX_SIGNAL_USERNAME_BYTES = 256;
const MAX_SIGNAL_PAYLOAD_BYTES = 1024 * 1024;
const MAX_ICE_SERVERS = 16;
const MAX_ICE_URLS_PER_SERVER = 8;
const MAX_ICE_FIELD_BYTES = 2048;
const _signalTextEncoder = new TextEncoder();

export function collabSignalTextReport(value, maxBytes, options = {}) {
    const limit = finiteNumberReport(maxBytes, { integer: true, min: 1, max: MAX_SIGNAL_PAYLOAD_BYTES });
    const isString = typeof value === 'string';
    const byteLength = isString ? _signalTextEncoder.encode(value).byteLength : 0;
    const nonempty = options.allowEmpty === true || (isString && value.length > 0);
    const valid = limit.valid && isString && nonempty && byteLength <= limit.value;
    return { valid, value, byteLength, maxBytes: limit.valid ? limit.value : 0 };
}

export function collabSignalPayloadReport(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { valid: false, value: null, byteLength: 0, reason: 'not-object' };
    }
    try {
        const encoded = _signalTextEncoder.encode(JSON.stringify(payload));
        const valid = encoded.byteLength > 0 && encoded.byteLength <= MAX_SIGNAL_PAYLOAD_BYTES;
        return { valid, value: payload, byteLength: encoded.byteLength, reason: valid ? 'valid' : 'out-of-range' };
    } catch (_) {
        return { valid: false, value: null, byteLength: 0, reason: 'not-serializable' };
    }
}

export function collabIceServerListReport(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ICE_SERVERS) {
        return { valid: false, value: [], count: 0, hasRelay: false, hasStun: false };
    }
    const admitted = [];
    let hasRelay = false;
    let hasStun = false;
    for (const server of value) {
        if (!server || typeof server !== 'object' || Array.isArray(server)) {
            return { valid: false, value: [], count: 0, hasRelay: false, hasStun: false };
        }
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        if (urls.length < 1 || urls.length > MAX_ICE_URLS_PER_SERVER
            || !urls.every((url) => collabSignalTextReport(url, MAX_ICE_FIELD_BYTES).valid)) {
            return { valid: false, value: [], count: 0, hasRelay: false, hasStun: false };
        }
        const schemes = urls.map((url) => url.slice(0, url.indexOf(':') + 1));
        if (!schemes.every((scheme) => ['stun:', 'turn:', 'turns:'].includes(scheme))) {
            return { valid: false, value: [], count: 0, hasRelay: false, hasStun: false };
        }
        if (server.username !== undefined && !collabSignalTextReport(server.username, MAX_ICE_FIELD_BYTES, { allowEmpty: true }).valid) {
            return { valid: false, value: [], count: 0, hasRelay: false, hasStun: false };
        }
        if (server.credential !== undefined && !collabSignalTextReport(server.credential, MAX_ICE_FIELD_BYTES, { allowEmpty: true }).valid) {
            return { valid: false, value: [], count: 0, hasRelay: false, hasStun: false };
        }
        const serverHasRelay = schemes.some((scheme) => scheme === 'turn:' || scheme === 'turns:');
        if (serverHasRelay && (
            !collabSignalTextReport(server.username, MAX_ICE_FIELD_BYTES).valid
            || !collabSignalTextReport(server.credential, MAX_ICE_FIELD_BYTES).valid
        )) {
            return { valid: false, value: [], count: 0, hasRelay: false, hasStun: false };
        }
        hasRelay ||= serverHasRelay;
        hasStun ||= schemes.includes('stun:');
        admitted.push({ ...server, urls: Array.isArray(server.urls) ? [...urls] : urls[0] });
    }
    return { valid: true, value: admitted, count: admitted.length, hasRelay, hasStun };
}

function _validSignalId(value, maxBytes) {
    return collabSignalTextReport(value, maxBytes).valid;
}

function _sendNegotiationSignal(channel, type, peerId, payload, offerId) {
    if (!channel || channel._destroyed || !_validSignalId(channel.selfId, MAX_SIGNAL_PEER_ID_BYTES)) {
        console.warn(`[CollabSignal] Rejecting ${type}: invalid local peer ID`);
        return false;
    }
    if (!_validSignalId(peerId, MAX_SIGNAL_PEER_ID_BYTES) || peerId === channel.selfId) {
        console.warn(`[CollabSignal] Rejecting ${type}: invalid target peer ID`);
        return false;
    }
    if (!_validSignalId(offerId, MAX_SIGNAL_OFFER_ID_BYTES)) {
        console.warn(`[CollabSignal] Rejecting ${type} for ${peerId}: missing or oversized offerId`);
        return false;
    }
    if (!collabSignalPayloadReport(payload).valid) {
        console.warn(`[CollabSignal] Rejecting ${type} for ${peerId}: invalid payload`);
        return false;
    }

    const msg = { type, from: channel.selfId, to: peerId, offerId, payload };

    // Tier 1 is physically broadcast, while strict receive-side addressing
    // prevents any non-target peer from observing the negotiation payload.
    if (channel._bc) {
        try { channel._bc.postMessage(msg); } catch (error) {
            console.warn(`[CollabSignal] BroadcastChannel ${type} send failed:`, error?.message || error);
        }
    }

    // Tier 2's SharedWorker already has a peer map, so route directly.
    if (channel._swPort) {
        try { channel._swPort.postMessage(msg); } catch (error) {
            console.warn(`[CollabSignal] SharedWorker ${type} send failed:`, error?.message || error);
        }
    }

    // Tier 3 manages its own WebTorrent offer_id and pending-PC lifecycle.

    // Tier 4 relays opaquely to the route; receivers enforce `to` below.
    _particleSignalAll(channel, msg);
    return true;
}

/** Send one SDP offer to one discovered peer on the generic signaling tiers. */
export function sendOffer(channel, peerId, sdpOffer, offerId) {
    return _sendNegotiationSignal(channel, 'OFFER', peerId, sdpOffer, offerId);
}

/**
 * Retained as a strict compatibility symbol. Untargeted offers are unsafe in a
 * multi-peer room, so callers must now supply the target and offer generation.
 */
export function broadcastOffer(channel, peerId, sdpOffer, offerId) {
    return sendOffer(channel, peerId, sdpOffer, offerId);
}

/**
 * Send an SDP answer to a specific peer.
 */
export function sendAnswer(channel, peerId, sdpAnswer, offerId) {
    return _sendNegotiationSignal(channel, 'ANSWER', peerId, sdpAnswer, offerId);
}

/**
 * Send an ICE candidate to a specific peer.
 */
export function sendCandidate(channel, peerId, candidate, offerId) {
    return _sendNegotiationSignal(channel, 'CANDIDATE', peerId, candidate, offerId);
}

/**
 * Destroy all signaling resources.
 */
export function destroySignalChannel(channel) {
    if (!channel || channel._destroyed) return false;
    channel._destroyed = true;
    channel._active = false;
    channel._generation += 1;

    if (channel._bcHelloTimer != null) {
        clearInterval(channel._bcHelloTimer);
        channel._bcHelloTimer = null;
    }
    if (channel._bc) {
        try { channel._bc.close(); } catch (_) {}
        channel._bc = null;
    }

    if (channel._swPort) {
        try {
            channel._swPort.postMessage({ type: 'LEAVE', peerId: channel.selfId });
            channel._swPort.close();
        } catch (_) {}
        channel._swPort = null;
    }

    const peerConnectionsToClose = new Set(channel._btPeerConnections || []);

    // Clean up BT pending offers (each holds an RTCPeerConnection)
    if (channel._btPendingOffers) {
        for (const [, pending] of channel._btPendingOffers) {
            clearTimeout(pending.timer);
            peerConnectionsToClose.add(pending.pc);
        }
        channel._btPendingOffers.clear();
    }

    // Clean up BT active peer connections
    if (channel._btActivePCs) {
        for (const [, pc] of channel._btActivePCs) {
            peerConnectionsToClose.add(pc);
        }
        channel._btActivePCs.clear();
    }
    channel._btConnectedUUIDs?.clear();
    channel._btManagedPeers?.clear();
    for (const pc of peerConnectionsToClose) {
        try { pc.close(); } catch (_) {}
    }
    for (const timer of channel._btHandshakeTimers?.values() || []) clearTimeout(timer);
    channel._btHandshakeTimers?.clear();
    channel._btPeerConnections?.clear();
    channel._btOffersInFlight = 0;

    for (const timer of channel._btReconnectTimers || []) clearTimeout(timer);
    for (const timer of channel._btBurstTimers || []) clearTimeout(timer);
    for (const timer of channel._btAnnounceTimers || []) clearInterval(timer);
    for (const wait of channel._btIceWaits || []) wait.finish();
    channel._btReconnectTimers?.clear();
    channel._btBurstTimers?.clear();
    channel._btAnnounceTimers?.clear();
    channel._btIceWaits?.clear();

    for (const ws of channel._btSockets) {
        try { ws.close(); } catch (_) {}
    }
    channel._btSockets = [];

    // Tier 4 — release every shared Particle signaling client. The V2 daemon
    // registry and explicit V1 compatibility registry disconnect only after
    // every consumer releases its reference. Stop each route lease timer too.
    for (const entry of channel._particleClients || []) {
        if (entry.helloTimer != null) clearInterval(entry.helloTimer);
        try { if (entry.routeId) entry.client.detachRoute(entry.routeId); } catch (_) {}
        try { entry.release ? entry.release() : entry.client.disconnect(); } catch (_) {}
        entry.helloTimer = null;
    }
    channel._particleClients = [];
    channel._particleServerQueue = [];
    channel._particleServerCursor = 0;
    channel._particleConnectModules = null;
    if (channel._particleFallbackTimer != null) {
        clearTimeout(channel._particleFallbackTimer);
        channel._particleFallbackTimer = null;
    }
    channel._turnPromise = null;
    channel._iceServers = [];
    channel._hasTurn = false;
    channel._turnExpiresAt = null;
    channel._bcHelloTimer = null;
    channel._sw = null;
    const inert = () => {};
    channel.onOffer = inert;
    channel.onAnswer = inert;
    channel.onCandidate = inert;
    channel.onPeerJoin = inert;
    channel.onPeerLeave = inert;
    channel.onOp = inert;
    channel.onPresence = inert;
    channel.onBTChannels = inert;
    channel.onIceRestartNeeded = inert;
    return true;
}

// ─── Tier 1: BroadcastChannel ────────────────────────────────────────────────

const BC_HELLO_INTERVAL_MS = 3000; // Re-announce every 3s so late-joining tabs find us

function _startBroadcastChannel(channel) {
    if (typeof BroadcastChannel === 'undefined') return;

    try {
        const bc = new BroadcastChannel(BC_CHANNEL + ':' + channel.projectId);
        channel._bc = bc;

        bc.onmessage = (evt) => {
            const msg = evt.data;
            if (!msg || !msg.from || msg.from === channel.selfId) return;

            // When we see a HELLO from someone, reply with our own HELLO so they know we exist
            if (msg.type === 'HELLO' && collabSignalHelloReport(msg, channel.selfId).valid) {
                try {
                    bc.postMessage({ type: 'HELLO', from: channel.selfId, username: channel.username });
                } catch (_) {}
            }

            _handleSignalMessage(channel, msg);
        };

        // Announce presence immediately
        bc.postMessage({ type: 'HELLO', from: channel.selfId, username: channel.username });

        // Re-announce periodically so late-joining tabs discover us
        channel._bcHelloTimer = setInterval(() => {
            if (!channel._active) { clearInterval(channel._bcHelloTimer); return; }
            try {
                bc.postMessage({ type: 'HELLO', from: channel.selfId, username: channel.username });
            } catch (_) {}
        }, BC_HELLO_INTERVAL_MS);
    } catch (err) {
        console.warn('[CollabSignal] BroadcastChannel unavailable:', err.message);
    }
}

// ─── Tier 2: SharedWorker ────────────────────────────────────────────────────

function _startSharedWorker(channel) {
    if (typeof SharedWorker === 'undefined') return;

    try {
        const worker = new SharedWorker(SW_WORKER_URL, { name: 'collab-signal' });
        worker.onerror = (err) => {
            console.warn('[CollabSignal] SharedWorker error (non-fatal, Tier 2 disabled):', err.message || err);
            channel._sw = null;
            channel._swPort = null;
        };
        const port = worker.port;
        channel._sw = worker;
        channel._swPort = port;

        port.onmessage = (evt) => {
            if (!channel._active || channel._destroyed) return;
            const msg = evt.data;
            if (!msg) return;

            switch (msg.type) {
                case 'HELLO_ACK':
                    // Existing peers — initiate connections
                    for (const peer of (msg.peers || [])) {
                        const hello = collabSignalHelloReport({ type: 'HELLO', from: peer?.peerId, username: peer?.username }, channel.selfId);
                        if (hello.valid) channel.onPeerJoin(hello.peerId, hello.username);
                    }
                    break;
                case 'PEER_JOINED':
                    {
                        const hello = collabSignalHelloReport({ type: 'HELLO', from: msg.peerId, username: msg.username }, channel.selfId);
                        if (hello.valid) channel.onPeerJoin(hello.peerId, hello.username);
                    }
                    break;
                case 'PEER_LEFT':
                    if (_validSignalId(msg.peerId, MAX_SIGNAL_PEER_ID_BYTES) && msg.peerId !== channel.selfId) {
                        channel.onPeerLeave(msg.peerId);
                    }
                    break;
                case 'OFFER':
                case 'ANSWER':
                case 'CANDIDATE':
                    if (msg.from !== channel.selfId) {
                        _handleSignalMessage(channel, msg);
                    }
                    break;
            }
        };

        port.start();
        port.postMessage({ type: 'HELLO', peerId: channel.selfId, username: channel.username });
    } catch (err) {
        console.warn('[CollabSignal] SharedWorker unavailable:', err.message);
    }
}

// ─── Tier 3: WebTorrent WebSocket Tracker ────────────────────────────────────
// Implements the exact WebTorrent tracker wire protocol:
//   https://github.com/webtorrent/bittorrent-tracker
//
// Key protocol rules:
//   - info_hash: 20-byte binary string (escape-encoded JSON)
//   - peer_id:   20-byte binary string
//   - offer_id:  20-byte binary string (in offers array AND in answer)
//   - to_peer_id: 20-byte binary string (in answer)
//   - offers: array of { offer: {type,sdp}, offer_id: <binary> }
//   - Tracker routes offer → all peers, answer → specific peer via to_peer_id

const BT_RECONNECT_BASE_MS    = 15000;
const BT_RECONNECT_MAX_MS     = 300000; // 5 min cap
const BT_RECONNECT_MAX_ATTEMPTS = 8;
const BT_OFFER_TIMEOUT_MS     = 50000;
const BT_NUMWANT              = 10;     // 10 parallel offers — enough for multi-peer swarms
const BT_MAX_PEER_CONNECTIONS = 32;
const BT_ANNOUNCE_INTERVAL_MS = 10000;  // 10s re-announce (was 30s — too slow for late joiners)
const BT_ICE_TIMEOUT_MS       = 3000;  // per-offer ICE gather timeout

export function collabSignalReconnectPlanReport(attempt) {
    const admitted = finiteNumberReport(attempt, {
        integer: true,
        min: 0,
        max: BT_RECONNECT_MAX_ATTEMPTS,
        allowNegativeZero: false,
    });
    if (!admitted.valid || admitted.value >= BT_RECONNECT_MAX_ATTEMPTS) {
        return { valid: admitted.valid, attempt: admitted.valid ? admitted.value : 0, nextAttempt: null, delayMs: 0, exhausted: true };
    }
    const backoff = createReconnectBackoff({
        baseMs: BT_RECONNECT_BASE_MS,
        maxMs: BT_RECONNECT_MAX_MS,
        maxAttempts: BT_RECONNECT_MAX_ATTEMPTS,
        jitterRatio: 0,
    });
    backoff.attempts = admitted.value;
    const next = nextBackoffDelay(backoff);
    return { valid: true, attempt: admitted.value, nextAttempt: next.attempt, delayMs: next.delayMs, exhausted: next.exhausted };
}

export function collabSignalOfferPlanReport(pendingCount, inFlightCount = 0) {
    const pending = finiteNumberReport(pendingCount, { integer: true, min: 0, max: BT_NUMWANT });
    const inFlight = finiteNumberReport(inFlightCount, { integer: true, min: 0, max: BT_NUMWANT });
    if (!pending.valid || !inFlight.valid) {
        return { valid: false, pending: 0, inFlight: 0, occupied: BT_NUMWANT, createCount: 0, capacity: BT_NUMWANT };
    }
    const occupied = Math.min(BT_NUMWANT, pending.value + inFlight.value);
    return {
        valid: true,
        pending: pending.value,
        inFlight: inFlight.value,
        occupied,
        createCount: BT_NUMWANT - occupied,
        capacity: BT_NUMWANT,
    };
}

export function collabSignalPeerCapacityReport(connectionCount) {
    const admitted = finiteNumberReport(connectionCount, {
        integer: true,
        min: 0,
        max: BT_MAX_PEER_CONNECTIONS,
        allowNegativeZero: false,
    });
    const count = admitted.valid ? admitted.value : BT_MAX_PEER_CONNECTIONS;
    return {
        valid: admitted.valid,
        count,
        capacity: BT_MAX_PEER_CONNECTIONS,
        available: BT_MAX_PEER_CONNECTIONS - count,
        canCreate: admitted.valid && count < BT_MAX_PEER_CONNECTIONS,
    };
}

function _clearBTHandshakeTimer(channel, pc) {
    const timer = channel._btHandshakeTimers.get(pc);
    if (timer != null) clearTimeout(timer);
    channel._btHandshakeTimers.delete(pc);
}

function _armBTHandshakeTimer(channel, pc) {
    _clearBTHandshakeTimer(channel, pc);
    const timer = setTimeout(() => {
        channel._btHandshakeTimers.delete(pc);
        channel._btPeerConnections.delete(pc);
        try { pc.close(); } catch (_) {}
    }, BT_OFFER_TIMEOUT_MS);
    channel._btHandshakeTimers.set(pc, timer);
}

export function collabSignalTrackerIdHex(value) {
    return legacySha1Hex(String(value)).slice(0, 40);
}

export function collabSignalTrackerBinaryReport(value) {
    if (typeof value !== 'string' || value.length !== 20) {
        return { valid: false, value: '', byteLength: 0, hex: '' };
    }
    for (let i = 0; i < value.length; i++) {
        if (value.charCodeAt(i) > 0xff) return { valid: false, value: '', byteLength: 0, hex: '' };
    }
    return { valid: true, value, byteLength: 20, hex: _binToHex(value) };
}

export function collabSignalHelloReport(message, selfId = '') {
    if (!message || message.type !== 'HELLO'
        || !_validSignalId(message.from, MAX_SIGNAL_PEER_ID_BYTES)
        || message.from === selfId) {
        return { valid: false, peerId: '', username: '' };
    }
    const username = message.username ?? 'Anonymous';
    if (!collabSignalTextReport(username, MAX_SIGNAL_USERNAME_BYTES, { allowEmpty: true }).valid) {
        return { valid: false, peerId: '', username: '' };
    }
    return { valid: true, peerId: message.from, username: username || 'Anonymous' };
}

function _signalByteArray(value, minBytes, maxBytes) {
    if (value == null) return null;
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return false;
    if (value.length < minBytes || value.length > maxBytes) return false;
    const bytes = Array.from(value);
    return bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? bytes : false;
}

export function collabSignalPeerHelloReport(message, selfId = '') {
    if (!message || message.type !== '__hello__'
        || !_validSignalId(message.selfId, MAX_SIGNAL_PEER_ID_BYTES)
        || message.selfId === selfId) {
        return { valid: false, peerId: '', username: '', publicKey: null, identityProof: null, ecdhKey: null };
    }
    const username = message.username ?? 'Remote';
    if (!collabSignalTextReport(username, MAX_SIGNAL_USERNAME_BYTES, { allowEmpty: true }).valid) {
        return { valid: false, peerId: '', username: '', publicKey: null, identityProof: null, ecdhKey: null };
    }
    const publicKey = _signalByteArray(message.publicKey, 65, 65);
    const identityProof = _signalByteArray(message.identityProof, 64, 80);
    const ecdhKey = _signalByteArray(message.ecdhKey, 65, 65);
    if (publicKey === false || identityProof === false || ecdhKey === false) {
        return { valid: false, peerId: '', username: '', publicKey: null, identityProof: null, ecdhKey: null };
    }
    return {
        valid: true,
        peerId: message.selfId,
        username: username || 'Remote',
        publicKey,
        identityProof,
        ecdhKey,
    };
}

function _startBitTorrentSignaling(channel) {
    // Derive 20-byte binary info_hash from project name via SHA-1
    const infoHashHex = collabSignalTrackerIdHex(APP_PREFIX + channel.projectId);
    channel._btInfoHashBin = _hexToBin(infoHashHex);

    // Derive 20-byte binary peer_id from selfId via SHA-1
    const peerIdHex = collabSignalTrackerIdHex(channel.selfId);
    channel._btPeerIdBin = _hexToBin(peerIdHex);
    channel._btPeerIdHex = peerIdHex;

    // Map: offerIdHex -> { pc, remotePeerIdHex, timer }
    channel._btPendingOffers = new Map();
    // Map: uuid -> RTCPeerConnection (the primary/active PC per remote peer)
    channel._btActivePCs = new Map();

    for (const trackerUrl of BT_TRACKERS) {
        _connectTracker(channel, trackerUrl);
    }
}

function _connectTracker(channel, trackerUrl, attempt) {
    if (!channel._active) return;
    const attemptReport = finiteNumberReport(attempt ?? 0, {
        integer: true,
        min: 0,
        max: BT_RECONNECT_MAX_ATTEMPTS,
        allowNegativeZero: false,
    });
    if (!attemptReport.valid) return;
    const _attempt = attemptReport.value;

    let ws;
    try {
        ws = new WebSocket(trackerUrl);
    } catch (_) {
        return;
    }

    channel._btSockets.push(ws);
    let announceTimer = null;
    let burstTimers = [];
    let opened = false;

    ws.onopen = () => {
        if (!channel._active) { ws.close(); return; }
        opened = true;
        console.log('[CollabSignal] Tracker connected:', trackerUrl);
        // Announce with pre-generated offers so remote peers can connect to us
        _btAnnounceWithOffers(channel, ws);
        // Rapid initial burst: re-announce at 2s, 5s, 10s so late-joining peers are found fast
        // (in case first announce went out before the other peer connected to this tracker)
        const burstDelays = [2000, 5000, 10000];
        burstTimers = burstDelays.map((delay) => {
            let timer = null;
            timer = setTimeout(() => {
                channel._btBurstTimers.delete(timer);
                if (channel._active && ws.readyState === WebSocket.OPEN) {
                    _btAnnounceWithOffers(channel, ws);
                }
            }, delay);
            channel._btBurstTimers.add(timer);
            return timer;
        });
        // Re-announce periodically
        announceTimer = setInterval(() => {
            if (!channel._active || ws.readyState !== WebSocket.OPEN) {
                clearInterval(announceTimer);
                channel._btAnnounceTimers.delete(announceTimer);
                burstTimers.forEach(t => clearTimeout(t));
                burstTimers.forEach(t => channel._btBurstTimers.delete(t));
                return;
            }
            _btAnnounceWithOffers(channel, ws);
        }, BT_ANNOUNCE_INTERVAL_MS);
        channel._btAnnounceTimers.add(announceTimer);
    };

    ws.onmessage = (evt) => {
        if (!channel._active || channel._destroyed) return;
        try {
            if (typeof evt.data !== 'string'
                || _signalTextEncoder.encode(evt.data).byteLength > MAX_SIGNAL_PAYLOAD_BYTES) return;
            const data = JSON.parse(evt.data);
            if (data.offer) {
                console.log('[CollabSignal] Tracker received OFFER from remote peer (tracker:', trackerUrl, ')');
            } else if (data.answer) {
                console.log('[CollabSignal] Tracker received ANSWER from remote peer (tracker:', trackerUrl, ')');
            } else if (data.info_hash) {
                console.log('[CollabSignal] Tracker announce ACK (tracker:', trackerUrl, ')');
            }
            _handleTrackerMessage(channel, ws, data);
        } catch (_) {}
    };

    ws.onerror = () => {};

    ws.onclose = () => {
        clearInterval(announceTimer);
        channel._btAnnounceTimers.delete(announceTimer);
        burstTimers.forEach((timer) => clearTimeout(timer));
        burstTimers.forEach((timer) => channel._btBurstTimers.delete(timer));
        burstTimers = [];
        channel._btSockets = channel._btSockets.filter(s => s !== ws);
        if (!channel._active) return;
        const plan = collabSignalReconnectPlanReport(opened ? 0 : _attempt);
        if (!plan.valid || plan.exhausted) return;
        let timer = null;
        timer = setTimeout(() => {
            channel._btReconnectTimers.delete(timer);
            _connectTracker(channel, trackerUrl, plan.nextAttempt);
        }, plan.delayMs);
        channel._btReconnectTimers.add(timer);
    };
}

/**
 * Generate N RTCPeerConnection offers and announce them to the tracker.
 * The tracker will forward each offer to a different remote peer.
 * When a remote peer answers, we complete the connection.
 */
async function _btAnnounceWithOffers(channel, ws) {
    if (!channel._active || ws.readyState !== WebSocket.OPEN) return;

    // Also clean up any stale pending offers to prevent PC accumulation
    for (const [offerId, pending] of channel._btPendingOffers) {
        try {
            if (pending.pc.connectionState === 'closed' || pending.pc.connectionState === 'failed') {
                clearTimeout(pending.timer);
                channel._btPendingOffers.delete(offerId);
                channel._btPeerConnections.delete(pending.pc);
            }
        } catch (_) {
            clearTimeout(pending.timer);
            channel._btPendingOffers.delete(offerId);
            channel._btPeerConnections.delete(pending.pc);
        }
    }

    const plan = collabSignalOfferPlanReport(channel._btPendingOffers.size, channel._btOffersInFlight);
    if (!plan.valid || plan.createCount === 0) return;
    channel._btOffersInFlight += plan.createCount;

    let results;
    try {
        // Generate only the unreserved capacity in parallel. Reservations are
        // synchronous so overlapping burst/interval announces cannot exceed 10.
        const offerPromises = [];
        for (let i = 0; i < plan.createCount; i++) {
            offerPromises.push(_btMakeOffer(channel));
        }
        results = await Promise.all(offerPromises);
    } finally {
        channel._btOffersInFlight = Math.max(0, channel._btOffersInFlight - plan.createCount);
    }
    const offers = results.filter(Boolean); // remove nulls from failed offers

    if (!channel._active || ws.readyState !== WebSocket.OPEN) return;
    if (offers.length === 0) {
        console.warn('[CollabSignal] All', plan.createCount, 'offers failed — nothing to announce');
        return;
    }

    console.log('[CollabSignal] Announcing', offers.length, 'offers to tracker');

    const msg = {
        action: 'announce',
        info_hash: channel._btInfoHashBin,
        peer_id: channel._btPeerIdBin,
        numwant: BT_NUMWANT,
        uploaded: 0,
        downloaded: 0,
        left: 0,
        offers,
    };

    try { ws.send(JSON.stringify(msg)); } catch (_) {}
}

async function _btMakeOffer(channel) {
    let pc = null;
    try {
        if (!collabSignalPeerCapacityReport(channel._btPeerConnections.size).canCreate) return null;
        const offerIdHex = _randomHex(40); // 20 bytes = 40 hex chars
        const offerIdBin = _hexToBin(offerIdHex);

        pc = new RTCPeerConnection({ iceServers: channel._iceServers || FREE_STUN_SERVERS });
        channel._btPeerConnections.add(pc);

        // Initiator creates the data channels — wire them immediately
        const opsOut = pc.createDataChannel('ops', { ordered: true });
        const presOut = pc.createDataChannel('presence', { ordered: false, maxRetransmits: 0 });
        _wireTrackerDataChannel(channel, pc, opsOut);
        _wireTrackerDataChannel(channel, pc, presOut);

        const sdpOffer = await pc.createOffer();
        await pc.setLocalDescription(sdpOffer);

        // Wait for ICE gathering (trickle=false, max BT_ICE_TIMEOUT_MS)
        await _waitForIce(channel, pc, BT_ICE_TIMEOUT_MS);

        if (!channel._active || channel._destroyed || channel._btPendingOffers.has(offerIdHex)) {
            channel._btPeerConnections.delete(pc);
            try { pc.close(); } catch (_) {}
            return null;
        }

        // Store pending offer so we can complete it when the tracker routes an answer back
        const timer = setTimeout(() => {
            if (channel._btPendingOffers.get(offerIdHex)?.pc === pc) {
                channel._btPendingOffers.delete(offerIdHex);
            }
            channel._btPeerConnections.delete(pc);
            try { pc.close(); } catch (_) {}
        }, BT_OFFER_TIMEOUT_MS);

        channel._btPendingOffers.set(offerIdHex, { pc, timer });

        // ondatachannel not needed for initiator — channels were created above

        return {
            offer_id: offerIdBin,
            offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        };
    } catch (_) {
        if (pc) {
            channel._btPeerConnections.delete(pc);
            try { pc.close(); } catch (_) {}
        }
        return null;
    }
}

function _handleTrackerMessage(channel, ws, data) {
    if (!data) return;

    // Tracker forwarded an offer from a remote peer → we answer it
    if (data.offer && data.peer_id && data.offer_id) {
        const remotePeer = collabSignalTrackerBinaryReport(data.peer_id);
        const offerId = collabSignalTrackerBinaryReport(data.offer_id);
        if (!remotePeer.valid || !offerId.valid || !collabSignalPayloadReport(data.offer).valid) return;
        const remotePeerIdHex = remotePeer.hex;
        // Don't connect to ourselves
        if (remotePeerIdHex === channel._btPeerIdHex) return;
        // Already connected to this specific BT peer — don't create duplicate PCs
        if (channel._btManagedPeers.has(remotePeerIdHex)) return;

        _btAnswerOffer(channel, ws, data);
        return;
    }

    // Tracker forwarded our answer back to the offering peer
    if (data.answer && data.peer_id && data.offer_id) {
        const remotePeer = collabSignalTrackerBinaryReport(data.peer_id);
        const offerId = collabSignalTrackerBinaryReport(data.offer_id);
        if (!remotePeer.valid || !offerId.valid || !collabSignalPayloadReport(data.answer).valid) return;
        const offerIdHex = offerId.hex;
        const pending = channel._btPendingOffers.get(offerIdHex);
        if (!pending) return;


        clearTimeout(pending.timer);
        channel._btPendingOffers.delete(offerIdHex);
        _armBTHandshakeTimer(channel, pending.pc);

        const remotePeerIdHex = remotePeer.hex;

        pending.pc.ondatachannel = (evt) => {
            _wireTrackerDataChannel(channel, pending.pc, evt.channel);
        };

        pending.pc.onconnectionstatechange = () => {
            if (pending.pc.connectionState === 'failed' || pending.pc.connectionState === 'closed') {
                _clearBTHandshakeTimer(channel, pending.pc);
                channel._btPeerConnections.delete(pending.pc);
                const uuid = pending.pc._collabPeerId || remotePeerIdHex;
                // Only fire peer leave if this is the active primary PC for this UUID
                if (channel._btActivePCs?.get(uuid) === pending.pc) {
                    channel._btActivePCs.delete(uuid);
                    channel._btManagedPeers.delete(uuid);
                    channel._btConnectedUUIDs.delete(uuid);
                    channel.onPeerLeave(uuid);
                }
            }
        };

        try {
            pending.pc.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(() => {
                _clearBTHandshakeTimer(channel, pending.pc);
                channel._btPeerConnections.delete(pending.pc);
                try { pending.pc.close(); } catch (_) {}
            });
        } catch (_) {
            _clearBTHandshakeTimer(channel, pending.pc);
            channel._btPeerConnections.delete(pending.pc);
            try { pending.pc.close(); } catch (_) {}
        }
    }
}

async function _btAnswerOffer(channel, ws, data) {
    const remotePeer = collabSignalTrackerBinaryReport(data.peer_id);
    const offerId = collabSignalTrackerBinaryReport(data.offer_id);
    if (!remotePeer.valid || !offerId.valid || !collabSignalPayloadReport(data.offer).valid) return;
    const remotePeerIdHex = remotePeer.hex;
    const offerIdBin = data.offer_id;

    let pc = null;
    try {
        if (!collabSignalPeerCapacityReport(channel._btPeerConnections.size).canCreate) return;
        pc = new RTCPeerConnection({ iceServers: channel._iceServers || FREE_STUN_SERVERS });
        channel._btPeerConnections.add(pc);

        // Wire incoming data channels ('ops' and 'presence' from the initiator)
        pc.ondatachannel = (evt) => {
            _wireTrackerDataChannel(channel, pc, evt.channel);
        };

        // onPeerJoin fires after __hello__ exchange inside _wireTrackerDataChannel
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                _clearBTHandshakeTimer(channel, pc);
                channel._btPeerConnections.delete(pc);
                const uuid = pc._collabPeerId || remotePeerIdHex;
                // Only fire peer leave if this is the active primary PC for this UUID
                if (channel._btActivePCs?.get(uuid) === pc) {
                    channel._btActivePCs.delete(uuid);
                    channel._btManagedPeers.delete(uuid);
                    channel._btConnectedUUIDs.delete(uuid);
                    channel.onPeerLeave(uuid);
                }
            }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await _waitForIce(channel, pc, BT_ICE_TIMEOUT_MS);

        if (!channel._active || channel._destroyed) {
            channel._btPeerConnections.delete(pc);
            try { pc.close(); } catch (_) {}
            return;
        }


        const msg = {
            action: 'announce',
            info_hash: channel._btInfoHashBin,
            peer_id: channel._btPeerIdBin,
            to_peer_id: data.peer_id,
            offer_id: offerIdBin,
            answer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        };

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
            _armBTHandshakeTimer(channel, pc);
        } else {
            channel._btPeerConnections.delete(pc);
            try { pc.close(); } catch (_) {}
        }
    } catch (_) {
        if (pc) {
            _clearBTHandshakeTimer(channel, pc);
            channel._btPeerConnections.delete(pc);
            try { pc.close(); } catch (_) {}
        }
    }
}

function _wireTrackerDataChannel(channel, pc, dataChannel) {
    const label = dataChannel.label;
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => {
        if (label === 'ops') {
            pc._opsChannel = dataChannel;
            // Send __hello__ as binary msgpack so remote learns our UUID selfId
            try {
                const helloPayload = {
                    type: '__hello__',
                    selfId: channel.selfId,
                    username: channel.username,
                };
                // Include cryptographic identity if available
                const publicKey = _signalByteArray(channel.publicKeyRaw, 65, 65);
                const identityProof = _signalByteArray(channel.identityProof, 64, 80);
                const ecdhKey = _signalByteArray(channel.ecdhPublicKeyRaw, 65, 65);
                if (publicKey) helloPayload.publicKey = publicKey;
                if (identityProof) helloPayload.identityProof = identityProof;
                // Include ephemeral ECDH public key for encryption
                if (ecdhKey) helloPayload.ecdhKey = ecdhKey;
                const hello = msgpackEncode(helloPayload);
                dataChannel.send(hello.buffer);
            } catch (_) {}
        } else if (label === 'presence') {
            pc._presChannel = dataChannel;
        }
        // Notify CollabCore when both channels are open
        if (pc._opsChannel && pc._presChannel && pc._collabPeerId) {
            _notifyBTConnect(channel, pc);
        }
    };

    dataChannel.onmessage = (evt) => {
        try {
            // Decode binary msgpack or fallback to JSON for backward compat
            let raw;
            if (evt.data instanceof ArrayBuffer) {
                raw = msgpackDecode(new Uint8Array(evt.data));
            } else if (typeof evt.data === 'string') {
                raw = JSON.parse(evt.data);
            } else {
                return;
            }
            if (raw.type === '__hello__') {
                const hello = collabSignalPeerHelloReport(raw, channel.selfId);
                if (!hello.valid) return;
                // Exchange complete — we now know the remote UUID and username
                pc._collabPeerId = hello.peerId;
                pc._collabUsername = hello.username;
                // Store cryptographic identity for verification by CollabCore
                if (hello.publicKey) pc._remotePublicKey = hello.publicKey;
                if (hello.identityProof) pc._remoteIdentityProof = hello.identityProof;
                if (hello.ecdhKey) pc._remoteEcdhKey = hello.ecdhKey;
                channel._btManagedPeers.add(hello.peerId);
                // If channels already open, notify now; else wait for onopen
                if (pc._opsChannel && pc._presChannel) {
                    _notifyBTConnect(channel, pc);
                }
                return;
            }
            const peerId = pc._collabPeerId;
            if (!peerId) return;
            // Route by channel wrapper ({ch, data}) or by type directly
            if (raw.ch === 'ops' || label === 'ops') {
                channel.onOp(peerId, raw.data ?? raw);
            } else if (raw.ch === 'presence' || label === 'presence') {
                channel.onPresence(peerId, raw.data ?? raw);
            }
        } catch (_) {}
    };

    dataChannel.onclose = () => {
        // Only fire onPeerLeave once (the ops channel is authoritative)
        if (label !== 'ops') return;
        const uuid = pc._collabPeerId;
        if (!uuid) return;
        // Only the primary PC for this UUID triggers peer leave.
        // Duplicate PCs (closed in _notifyBTConnect) must not interfere.
        if (channel._btActivePCs?.get(uuid) !== pc) return;
        _clearBTHandshakeTimer(channel, pc);
        channel._btPeerConnections.delete(pc);
        channel._btActivePCs.delete(uuid);
        channel._btManagedPeers.delete(uuid);
        channel._btConnectedUUIDs.delete(uuid);
        channel.onPeerLeave(uuid);
    };
}

function _notifyBTConnect(channel, pc) {
    if (pc._btConnectNotified) return;
    pc._btConnectNotified = true;
    _clearBTHandshakeTimer(channel, pc);
    const uuid = pc._collabPeerId;
    // Guard: BT_NUMWANT + re-announces create multiple PCs per peer.
    // Only the first PC to complete becomes the primary. Close duplicates immediately
    // so their close/fail events don't fire spurious onPeerLeave for the primary.
    if (channel._btConnectedUUIDs.has(uuid)) {
        channel._btPeerConnections.delete(pc);
        try { pc.close(); } catch (_) {}
        return;
    }
    channel._btConnectedUUIDs.add(uuid);
    channel._btActivePCs.set(uuid, pc);

    // Don't clean up remaining pending offers — other peers in the swarm
    // may still answer them, enabling multi-peer connections.
    // Stale offers self-clean via BT_OFFER_TIMEOUT_MS timers.

    channel.onPeerJoin(uuid, pc._collabUsername || 'Remote');
    channel.onBTChannels(uuid, pc._opsChannel, pc._presChannel, {
        publicKey: pc._remotePublicKey || null,
        identityProof: pc._remoteIdentityProof || null,
        ecdhKey: pc._remoteEcdhKey || null,
    });
}

function _waitForIce(channel, pc, timeoutMs) {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        let settled = false;
        let t = null;
        const wait = { finish: null };
        const finish = () => {
            if (settled) return;
            settled = true;
            channel._btIceWaits.delete(wait);
            clearTimeout(t);
            resolve();
        };
        wait.finish = finish;
        t = setTimeout(finish, timeoutMs);
        channel._btIceWaits.add(wait);
        pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') finish();
        };
    });
}

// ─── Common message handler ───────────────────────────────────────────────────

function _handleSignalMessage(channel, msg) {
    if (!channel?._active || channel._destroyed || !msg || typeof msg !== 'object') return;
    switch (msg.type) {
        case 'HELLO': {
            const hello = collabSignalHelloReport(msg, channel.selfId);
            if (!hello.valid) return;
            channel.onPeerJoin(hello.peerId, hello.username);
            break;
        }
        case 'OFFER':
        case 'ANSWER':
        case 'CANDIDATE': {
            // BroadcastChannel and Particle route signaling physically fan out.
            // A message for another peer is normal and is ignored silently.
            if (msg.to !== channel.selfId) {
                if (!msg.to) console.warn(`[CollabSignal] Rejecting untargeted ${msg.type} from ${msg.from || 'unknown'}`);
                return;
            }
            if (!_validSignalId(msg.from, MAX_SIGNAL_PEER_ID_BYTES)
                || !_validSignalId(msg.offerId, MAX_SIGNAL_OFFER_ID_BYTES)
                || !collabSignalPayloadReport(msg.payload).valid) {
                console.warn(`[CollabSignal] Rejecting malformed ${msg.type} envelope from ${msg.from || 'unknown'}`);
                return;
            }
            if (msg.type === 'OFFER') channel.onOffer(msg.from, msg.payload, msg.offerId);
            else if (msg.type === 'ANSWER') channel.onAnswer(msg.from, msg.payload, msg.offerId);
            else channel.onCandidate(msg.from, msg.payload, msg.offerId);
            break;
        }
    }
}

// ─── Tier 4: Particle Masterserver relay ─────────────────────────────────────
// Cross-internet WebRTC signaling over our own Masterserver instead of a
// third-party BitTorrent tracker. Reuses _handleSignalMessage's generic
// HELLO/OFFER/ANSWER/CANDIDATE dispatch (same as Tiers 1/2) scoped to a
// project-derived routeId, rather than the BitTorrent binary swarm protocol.

const PARTICLE_HELLO_INTERVAL_MS = 5000; // re-announce so late joiners on the route discover us
const PARTICLE_FALLBACK_TIMEOUT_MS = 6000; // give the Masterserver this long before starting BT fallback
const PARTICLE_CONNECTING_STATES = new Set(['connecting', 'admitting', 'hello_sent', 'proving']);

// BitTorrent fallback leaks your IP + a hash of the room to third-party public
// trackers (openwebtorrent.com / webtorrent.dev) — OFF by default for safety/
// privacy. Users can opt in from the Particle Network control panel app.
const BT_FALLBACK_ENABLED_KEY = 'os.network.btFallbackEnabled';

export function isBitTorrentFallbackEnabled() {
    try {
        if (typeof localStorage === 'undefined') return false;
        return localStorage.getItem(BT_FALLBACK_ENABLED_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

export function setBitTorrentFallbackEnabled(enabled) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(BT_FALLBACK_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch (_) {}
}

/**
 * Start the BitTorrent fallback tier only if the user has opted in (off by
 * default — see isBitTorrentFallbackEnabled) AND no Particle Masterserver is
 * configured/enabled, or none manage to connect within the timeout. Also
 * called reactively (see _onParticleEvent) when a client errors/closes, so a
 * fast, definitive failure (e.g. bad URL) doesn't wait out the full timeout
 * if every other configured server is already dead too.
 */
function _scheduleBitTorrentFallback(channel) {
    if (!isBitTorrentFallbackEnabled()) return;
    const servers = _loadParticleMasterServers().filter((s) => s && s.url && s.enabled !== false);
    if (!servers.length) {
        _maybeFallbackToBitTorrent(channel, { deadlinePassed: true });
        return;
    }
    channel._particleFallbackTimer = setTimeout(() => {
        channel._particleFallbackTimer = null;
        _maybeFallbackToBitTorrent(channel, { deadlinePassed: true });
    }, PARTICLE_FALLBACK_TIMEOUT_MS);
}

/**
 * @param {object} channel
 * @param {{deadlinePassed?: boolean}} [opts]  deadlinePassed=true means the
 *   full grace period has elapsed (called from the scheduled timeout, or
 *   because no servers exist at all) — decide now regardless of any client
 *   still mid-handshake. Otherwise (reactive call from a client error/close)
 *   only fall back early if EVERY configured client has already failed.
 */
function _maybeFallbackToBitTorrent(channel, { deadlinePassed = false } = {}) {
    if (!channel._active || channel._particleIntegrityFailure
        || channel._particleFallbackStarted || !isBitTorrentFallbackEnabled()) return;
    const entries = channel._particleClients || [];
    const anyConnected = entries.some((e) => e.client?.getState()?.state === 'connected');
    if (anyConnected) return; // Masterserver is up — no fallback needed
    const anyStillTrying = entries.some((e) => PARTICLE_CONNECTING_STATES.has(e.client?.getState()?.state));
    if (anyStillTrying && !deadlinePassed) return; // another server might still succeed — give it the full grace period
    channel._particleFallbackStarted = true;
    console.warn('[CollabSignal] Particle Masterserver signaling unavailable — falling back to BitTorrent trackers');
    _startBitTorrentSignaling(channel);
}

function _loadParticleMasterServers() {
    return loadParticleMasterServers(typeof localStorage === 'undefined' ? null : localStorage);
}

let _particleDeviceSignerPromise = null;
function _getParticleDeviceSigner() {
    if (!_particleDeviceSignerPromise) {
        _particleDeviceSignerPromise = import('../network/identity/NetworkIdentity.js')
            .then((m) => m.createDeviceIdentity())
            .catch(() => null);
    }
    return _particleDeviceSignerPromise;
}

function _startParticleSignaling(channel) {
    const servers = _loadParticleMasterServers()
        .filter((s) => s && s.url && s.enabled !== false)
        .sort((left, right) => (Number(left.priority) || 999) - (Number(right.priority) || 999));
    if (!servers.length) return;

    Promise.all([
        _getParticleDeviceSigner(),
        import('../network/transport/MasterServerRegistry.js'),
        import('../network/daemon/ParticleNetworkDaemonRegistry.js'),
    ])
        .then(([deviceSigner, legacyMod, daemonMod]) => {
            if (!channel._active) return;
            channel._particleServerQueue = servers;
            channel._particleServerCursor = 0;
            channel._particleConnectModules = { deviceSigner, legacyMod, daemonMod };
            _connectNextParticleServer(channel);
        })
        .catch(() => {});
}

function _connectNextParticleServer(channel) {
    if (!channel._active || channel._destroyed || channel._particleClients.some((entry) => (
        PARTICLE_CONNECTING_STATES.has(entry.client?.getState()?.state)
        || entry.client?.getState()?.state === 'connected'
    ))) return;
    const server = channel._particleServerQueue[channel._particleServerCursor++];
    if (!server) {
        _maybeFallbackToBitTorrent(channel);
        return;
    }
    const { deviceSigner, legacyMod, daemonMod } = channel._particleConnectModules || {};
    const serverKeyPin = server.serverKeyPin ?? server.server_key_pin ?? null;
    const serverKeyPins = server.serverKeyPins ?? server.server_key_pins ?? [];
    try {
        if ((serverKeyPin || serverKeyPins.length) && daemonMod?.acquireParticleNetworkDaemon) {
            _connectParticleV2(
                channel,
                { ...server, serverKeyPin, serverKeyPins },
                deviceSigner,
                daemonMod.acquireParticleNetworkDaemon,
            );
        } else if (!channel._particleIntegrityFailure
            && (server.allowLegacyV1 ?? server.allow_legacy_v1) === true
            && legacyMod?.acquireSharedMasterServerClient) {
            _connectParticleV1(channel, server.url, deviceSigner, legacyMod.acquireSharedMasterServerClient);
        } else {
            _connectNextParticleServer(channel);
        }
    } catch (_) {
        _connectNextParticleServer(channel);
    }
}

function _releaseFailedParticleEntry(channel, entry) {
    if (entry.helloTimer != null) clearInterval(entry.helloTimer);
    entry.helloTimer = null;
    try { entry.release?.(); } catch (_) {}
    const index = channel._particleClients.indexOf(entry);
    if (index >= 0) channel._particleClients.splice(index, 1);
}

// Acquires a SHARED session per url (engine/network/transport/MasterServerRegistry.js)
// rather than opening a private WebSocket — other OS consumers (e.g. the
// Particle Network control panel's inspector) may already have, or later
// open, a session to the same Masterserver; one proven connection is reused
// for all of them instead of each opening its own redundant socket.
function _connectParticleV1(channel, url, deviceSigner, acquireSharedMasterServerClient) {
    if (!channel._active) return;
    const entry = {
        kind: 'v1',
        client: null,
        release: null,
        helloTimer: null,
        routeId: collabSignalTrackerIdHex(APP_PREFIX + channel.projectId),
    };
    const listener = (evt) => _onParticleEvent(channel, entry, evt);
    const { client, release } = acquireSharedMasterServerClient({ url, deviceSigner, onEvent: listener });
    entry.client = client;
    entry.release = release;
    channel._particleClients.push(entry);
    // Shared client may already be connected (another consumer got there first) —
    // synthesize a 'connected' kickoff so this consumer still attaches its route/announces.
    const state = client.getState();
    if (state.state === 'connected') _onParticleEvent(channel, entry, { type: 'connected', ...state });
}

function _connectParticleV2(channel, server, deviceSigner, acquireParticleNetworkDaemon) {
    if (!channel._active) return;
    const entry = { kind: 'v2', client: null, release: null, helloTimer: null, routeId: null };
    const listener = (evt) => _onParticleEvent(channel, entry, evt);
    const { daemon, release } = acquireParticleNetworkDaemon({ server, deviceSigner, onEvent: listener, preferV3: true });
    entry.client = daemon;
    entry.release = release;
    channel._particleClients.push(entry);
    const state = daemon.getState();
    if (state.state === 'connected') _onParticleEvent(channel, entry, { type: 'connected', ...state });
}

function _onParticleEvent(channel, entry, evt) {
    if (!channel._active) return;
    if (evt.type === 'connected') {
        if (entry.kind === 'v2') {
            void entry.client.attachRoute(channel.routeSecret, channel.projectId).then((route) => {
                if (!channel._active || channel._destroyed) return;
                entry.routeId = route.routeTag;
                channel._particleRouteId = route.routeTag;
                entry.client.discover(entry.routeId);
                _particleAnnounce(channel, entry);
                _startParticleLeaseTimer(channel, entry);
            }).catch(() => {});
            return;
        }
        channel._particleRouteId = entry.routeId;
        entry.client.attachRoute(entry.routeId);
        _particleAnnounce(channel, entry);
        _startParticleLeaseTimer(channel, entry);
    } else if (evt.type === 'turn-credentials' || evt.type === 'ice-configuration') {
        const report = collabIceServerListReport(evt.iceServers);
        if (report.valid) {
            channel._iceServers = [...FREE_STUN_SERVERS, ...report.value];
            channel._hasTurn = evt.relayAvailable !== false && report.hasRelay;
            channel._turnFetched = true;
            channel._turnExpiresAt = evt.expiresAt;
        }
    } else if (evt.type === 'ice-restart-needed') {
        try { channel.onIceRestartNeeded(evt.reason); } catch (_) {}
    } else if (evt.type === 'integrity-error') {
        if (entry.helloTimer != null) { clearInterval(entry.helloTimer); entry.helloTimer = null; }
        console.error('[CollabSignal] Particle v2 integrity failure; legacy downgrade is forbidden for this server');
        channel._particleIntegrityFailure = true;
        _releaseFailedParticleEntry(channel, entry);
        _connectNextParticleServer(channel);
    } else if (evt.type === 'signal') {
        if ((evt.routeTag ?? evt.routeId) !== entry.routeId) return;
        const msg = evt.message;
        if (!msg || msg.from === channel.selfId) return;
        if (msg.type === 'HELLO') {
            if (collabSignalHelloReport(msg, channel.selfId).valid) {
                try { entry.client.signal(entry.routeId, { type: 'HELLO', from: channel.selfId, username: channel.username }); } catch (_) {}
            }
        }
        _handleSignalMessage(channel, msg);
    } else if (evt.type === 'closed' || evt.type === 'error') {
        if (entry.helloTimer != null) { clearInterval(entry.helloTimer); entry.helloTimer = null; }
        if (channel._particleServerCursor < channel._particleServerQueue.length) {
            _releaseFailedParticleEntry(channel, entry);
            _connectNextParticleServer(channel);
        } else {
            _maybeFallbackToBitTorrent(channel);
        }
    }
}

function _startParticleLeaseTimer(channel, entry) {
    if (entry.helloTimer != null) clearInterval(entry.helloTimer);
    entry.helloTimer = setInterval(() => {
        if (!channel._active || channel._destroyed) {
            clearInterval(entry.helloTimer);
            entry.helloTimer = null;
            return;
        }
        if (entry.kind === 'v2') entry.client.renewRoute(entry.routeId);
        else entry.client.attachRoute(entry.routeId);
        entry.client.discover?.(entry.routeId);
        _particleAnnounce(channel, entry);
    }, PARTICLE_HELLO_INTERVAL_MS);
}

function _particleAnnounce(channel, entry) {
    if (!entry.routeId) return;
    try { entry.client.signal(entry.routeId, { type: 'HELLO', from: channel.selfId, username: channel.username }); } catch (_) {}
}

function _particleSignalAll(channel, msg) {
    for (const entry of channel._particleClients || []) {
        if (!entry.routeId) continue;
        try { entry.client.signal(entry.routeId, msg); } catch (_) {}
    }
}

let _randomHexSequence = 0;

function _randomHex(len) {
    const requestedLength = Math.max(0, Math.floor(Number(len) || 0));
    if (!requestedLength) return '';
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (typeof cryptoApi?.getRandomValues === 'function') {
        try {
            const bytes = cryptoApi.getRandomValues(new Uint8Array(Math.ceil(requestedLength / 2)));
            return byteSignature(bytes).slice(0, requestedLength);
        } catch (_) {}
    }
    const fallbackSeed = `${Date.now().toString(16)}${(++_randomHexSequence).toString(16)}`;
    let s = '';
    while (s.length < requestedLength) s += fallbackSeed;
    return s.slice(0, requestedLength);
}

/**
 * Convert a hex string to a binary string (each pair of hex chars → one char).
 * WebTorrent tracker protocol requires 20-byte binary strings for info_hash/peer_id.
 */
function _hexToBin(hex) {
    const bytes = formatHexToBytes(hex);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return bin;
}

/**
 * Convert a binary string back to hex.
 * Used to identify peers from tracker responses.
 */
function _binToHex(bin) {
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return byteSignature(bytes);
}

// Audit gaps: signaling HELLO envelopes have no freshness sequence or direct sender authentication.
// TURN credentials have no expiry-driven refresh policy after successful acquisition.
// BitTorrent reconnect has no measured-network jitter policy, and captured tracker/masterserver
// failover, concurrent-offer, stale-async, and multi-peer churn traces remain absent.
