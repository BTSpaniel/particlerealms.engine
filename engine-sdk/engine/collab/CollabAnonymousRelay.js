// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabAnonymousRelay.js
 * Anonymous peer mapping and routing for P2P collab channels.
 *
 * Inspired by Tor onion routing, I2P garlic routing, and AP3 pseudonymous
 * overlays — adapted for real-time game networking where latency matters.
 *
 * Three layers of anonymity:
 *   1. Pseudonymous IDs — each peer gets a random session token (anonId).
 *      All ops use anonIds instead of real selfIds. Peers never see each
 *      other's real identity. Different anonId each session prevents
 *      cross-session correlation.
 *
 *   2. TURN-only relay — forces iceTransportPolicy:'relay' so WebRTC ICE
 *      candidates never leak real IP addresses between peers.
 *
 *   3. Garlic encryption — each message payload is encrypted with the
 *      recipient's ECDH public key before being sent through the relay.
 *      The relay host can route messages (via anonId headers) but cannot
 *      read the encrypted payload. Only the intended recipient can decrypt.
 *
 * Architecture:
 *   - The host acts as an anonymizing relay (already in relay mode)
 *   - Peers send messages to the host with a destination anonId
 *   - The host maps anonId → realPeerId, forwards the message
 *   - The forwarded message has the sender's anonId (not real ID)
 *   - Result: no peer knows any other peer's real identity or IP
 *
 * Flow:
 *   1. createAnonymousRelay() → relay state with self anonId
 *   2. Host: registerPeer(realPeerId) → assigns anonId, stores mapping
 *   3. Outgoing: sanitizeOp(op) → replaces peerId with anonId
 *   4. Host routing: resolveAnonToReal(anonId) → realPeerId for delivery
 *   5. Incoming: the op already has sender's anonId (safe to process)
 *   6. Garlic: wrapGarlic(op, recipientEcdhPub) → encrypted payload
 *   7. Garlic: unwrapGarlic(op, ownEcdhPrivate) → decrypted payload
 */

import { contentHashHex } from '../core/math/ChecksumMath.js';
import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { byteSignature } from '../core/math/FormatMath.js';
import { shuffleInPlace } from '../core/math/MathRandom.js';
import { finiteNumberReport } from '../core/math/MathValidation.js';
import { collabIdentityPayloadReport } from './CollabIdentity.js';

const subtle = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
const encoder = new TextEncoder();

export const COLLAB_ANON_RELAY_LIMITS = Object.freeze({
    anonIdHexChars: 16,
    maxPeerIdBytes: 256,
    publicKeyBytes: 65,
    sessionSeedBytes: 32,
    ivBytes: 12,
    minSignatureBytes: 64,
    maxSignatureBytes: 80,
    maxPeers: 256,
    maxCertifiedKeys: 256,
    maxPayloadBytes: 1024 * 1024,
    maxCiphertextBytes: 1024 * 1024 + 16,
    maxSeenCriticalOps: 4096,
    maxAgeMs: 60000,
    maxFutureSkewMs: 10000,
});

function _textReport(value, allowEmpty = false) {
    const bytes = typeof value === 'string' ? encoder.encode(value).byteLength : 0;
    const valid = typeof value === 'string' && (allowEmpty || value.length > 0)
        && bytes <= COLLAB_ANON_RELAY_LIMITS.maxPeerIdBytes;
    return { valid, value: valid ? value : '', bytes, reason: valid ? 'valid' : 'invalid-text' };
}

function _bytesReport(value, min, max = min) {
    const arrayLike = value instanceof Uint8Array || Array.isArray(value) || ArrayBuffer.isView(value);
    const length = arrayLike ? value.length : 0;
    if (!arrayLike || !Number.isSafeInteger(length) || length < min || length > max) {
        return { valid: false, bytes: new Uint8Array(0), length, reason: 'invalid-length' };
    }
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        if (!Number.isInteger(value[i]) || value[i] < 0 || value[i] > 255) {
            return { valid: false, bytes: new Uint8Array(0), length, reason: 'invalid-byte' };
        }
        bytes[i] = value[i];
    }
    return { valid: true, bytes, length, reason: 'valid' };
}

function _publicKeyReport(value) {
    const report = _bytesReport(value, COLLAB_ANON_RELAY_LIMITS.publicKeyBytes);
    return report.valid && report.bytes[0] !== 0x04
        ? { ...report, valid: false, reason: 'invalid-uncompressed-point' }
        : report;
}

function _signatureReport(value) {
    return _bytesReport(value, COLLAB_ANON_RELAY_LIMITS.minSignatureBytes, COLLAB_ANON_RELAY_LIMITS.maxSignatureBytes);
}

export function collabAnonTimestampReport(timestamp, nowMs = Date.now()) {
    const value = finiteNumberReport(timestamp, { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER });
    const now = finiteNumberReport(nowMs, { min: 0, max: Number.MAX_SAFE_INTEGER });
    if (!value.valid || !now.valid) return { valid: false, timestamp, ageMs: Infinity, reason: 'invalid-clock' };
    const ageMs = now.value - value.value;
    const valid = ageMs <= COLLAB_ANON_RELAY_LIMITS.maxAgeMs && ageMs >= -COLLAB_ANON_RELAY_LIMITS.maxFutureSkewMs;
    return { valid, timestamp: value.value, ageMs, reason: valid ? 'valid' : 'timestamp-stale' };
}

export function collabAnonScoreReport(scoreData, nowMs = Date.now()) {
    const reporter = _textReport(scoreData?.anonId);
    const target = _textReport(scoreData?.targetAnonId);
    const score = finiteNumberReport(scoreData?.score, { integer: true, min: 0, max: 1000 });
    const timestamp = collabAnonTimestampReport(scoreData?.timestamp, nowMs);
    const valid = reporter.valid && target.valid && score.valid && timestamp.valid;
    return { valid, anonId: reporter.value, targetAnonId: target.value, score: score.value, timestamp: timestamp.timestamp,
        reason: valid ? 'valid' : (!reporter.valid ? 'invalid-reporter' : (!target.valid ? 'invalid-target' : (!score.valid ? 'invalid-score' : timestamp.reason))) };
}

function _relayClock(relay, nowMs = Date.now()) {
    const step = runtimeMonotonicClockStep(nowMs, relay?._clockMs || 0);
    if (relay) relay._clockMs = step.timestampMs;
    return step.timestampMs;
}

// ─── Anonymous ID Generation ────────────────────────────────────────────────

/**
 * Generate a random anonymous ID (16 hex chars = 64 bits of entropy).
 * Different every session — prevents cross-session correlation.
 * @returns {string}
 */
function _generateAnonId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return byteSignature(bytes);
}

/**
 * Generate an anonymous username from an anonId.
 * Format: "Anon-XXXX" where XXXX is first 4 chars of the anonId.
 * @param {string} anonId
 * @returns {string}
 */
export function getAnonUsername(anonId) {
    return `Anon-${(anonId || '').slice(0, 4).toUpperCase()}`;
}

// ─── Relay State ────────────────────────────────────────────────────────────

/**
 * Create an anonymous relay state.
 * @param {Object} config
 * @param {string} config.selfId - our real peer ID
 * @param {boolean} [config.isHost=false] - host maintains full mapping
 * @param {boolean} [config.garlicEnabled=false] - enable garlic encryption
 * @returns {Object} relay state
 */
export function createAnonymousRelay(config) {
    const selfId = _textReport(config?.selfId);
    if (!selfId.valid) throw new TypeError('config.selfId must be a bounded non-empty string');
    const selfAnonId = _generateAnonId();

    return {
        selfId: selfId.value,
        selfAnonId,
        isHost: config.isHost || false,
        garlicEnabled: config.garlicEnabled || false,
        enabled: true,
        _destroyed: false,
        _generation: 1,
        _clockMs: 0,
        _seenCriticalSignatures: new Map(),
        _pendingCriticalSignatures: new Set(),

        // Mapping tables (host maintains both directions)
        _realToAnon: new Map(),   // realPeerId → anonId
        _anonToReal: new Map(),   // anonId → realPeerId (host only)

        // Per-peer ECDH public keys for garlic encryption (anonId → ecdhPubKey)
        _peerEcdhKeys: new Map(),

        // Anonymous username assignments (anonId → "Anon-XXXX")
        _anonUsernames: new Map(),

        // Track which real fields were stripped for each op (for debugging)
        _stats: {
            opsSanitized: 0,
            opsDeAnonymized: 0,
            garlicWrapped: 0,
            garlicUnwrapped: 0,
            garlicFailed: 0,
            peersRegistered: 0,
        },
    };
}

// ─── Peer Registration ──────────────────────────────────────────────────────

/**
 * Register a peer and assign them an anonymous ID.
 * On the host: stores both directions of the mapping.
 * On non-host: only stores our own mapping (we know our own anonId).
 *
 * @param {Object} relay
 * @param {string} realPeerId
 * @param {Uint8Array|number[]} [ecdhPublicKey] - peer's ECDH key for garlic
 * @returns {string} the assigned anonId
 */
export function registerAnonPeer(relay, realPeerId, ecdhPublicKey) {
    if (!relay || relay._destroyed || !_textReport(realPeerId).valid) return null;
    // Check if already registered
    let anonId = relay._realToAnon.get(realPeerId);
    if (anonId) {
        // Update ECDH key if provided
        if (ecdhPublicKey) {
            const key = _publicKeyReport(ecdhPublicKey);
            if (!key.valid) return null;
            relay._peerEcdhKeys.set(anonId, key.bytes);
        }
        return anonId;
    }

    if (relay._realToAnon.size >= COLLAB_ANON_RELAY_LIMITS.maxPeers) {
        relay._stats.capacityRejected = (relay._stats.capacityRejected || 0) + 1;
        return null;
    }

    // Generate new anonId
    anonId = _generateAnonId();
    relay._realToAnon.set(realPeerId, anonId);
    relay._anonUsernames.set(anonId, getAnonUsername(anonId));

    // Host stores reverse mapping for routing
    if (relay.isHost) {
        relay._anonToReal.set(anonId, realPeerId);
    }

    // Store ECDH key for garlic encryption
    if (ecdhPublicKey) {
        const key = _publicKeyReport(ecdhPublicKey);
        if (!key.valid) {
            removeAnonPeer(relay, realPeerId);
            return null;
        }
        relay._peerEcdhKeys.set(anonId, key.bytes);
    }

    relay._stats.peersRegistered++;
    return anonId;
}

/**
 * Remove a peer from the anonymous mapping.
 * @param {Object} relay
 * @param {string} realPeerId
 */
export function removeAnonPeer(relay, realPeerId) {
    const anonId = relay._realToAnon.get(realPeerId);
    if (!anonId) return;

    relay._realToAnon.delete(realPeerId);
    relay._anonToReal.delete(anonId);
    relay._anonUsernames.delete(anonId);
    relay._peerEcdhKeys.delete(anonId);
}

// ─── ID Resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a real peer ID to its anonymous ID.
 * @param {Object} relay
 * @param {string} realPeerId
 * @returns {string|null} anonId or null if not registered
 */
export function resolveRealToAnon(relay, realPeerId) {
    if (realPeerId === relay.selfId) return relay.selfAnonId;
    return relay._realToAnon.get(realPeerId) || null;
}

/**
 * Resolve an anonymous ID back to the real peer ID.
 * HOST ONLY — non-host peers cannot resolve other peers' anonIds.
 * @param {Object} relay
 * @param {string} anonId
 * @returns {string|null} realPeerId or null
 */
export function resolveAnonToReal(relay, anonId) {
    if (anonId === relay.selfAnonId) return relay.selfId;
    if (!relay.isHost) return null; // non-host cannot resolve others
    return relay._anonToReal.get(anonId) || null;
}

/**
 * Get the anonymous username for a peer.
 * @param {Object} relay
 * @param {string} anonIdOrRealId
 * @returns {string}
 */
export function resolveAnonUsername(relay, anonIdOrRealId) {
    // Try direct anonId lookup
    const direct = relay._anonUsernames.get(anonIdOrRealId);
    if (direct) return direct;

    // Try resolving realPeerId → anonId → username
    const anonId = relay._realToAnon.get(anonIdOrRealId);
    if (anonId) return relay._anonUsernames.get(anonId) || getAnonUsername(anonId);

    return getAnonUsername(anonIdOrRealId);
}

// ─── Op Sanitization ────────────────────────────────────────────────────────

// Fields that contain real peer identity and must be anonymized
const IDENTITY_FIELDS = ['peerId', 'senderId', 'reporterId', 'targetPeerId', 'hostId'];

/**
 * Sanitize an outgoing op: replace all real peer IDs with anonymous IDs.
 * This is called before broadcasting — peers only see anonIds.
 *
 * @param {Object} relay
 * @param {Object} op - the op to sanitize (will be shallow-cloned)
 * @returns {Object} sanitized op with anonIds
 */
export function sanitizeOutgoingOp(relay, op) {
    if (!relay.enabled || !op) return op;

    const sanitized = { ...op };

    // Replace identity fields in the op root
    for (const field of IDENTITY_FIELDS) {
        if (sanitized[field]) {
            const anonId = resolveRealToAnon(relay, sanitized[field]);
            if (anonId) sanitized[field] = anonId;
        }
    }

    // Replace identity fields in the payload
    if (sanitized.payload && typeof sanitized.payload === 'object') {
        sanitized.payload = { ...sanitized.payload };
        for (const field of IDENTITY_FIELDS) {
            if (sanitized.payload[field]) {
                const anonId = resolveRealToAnon(relay, sanitized.payload[field]);
                if (anonId) sanitized.payload[field] = anonId;
            }
        }
    }

    // Mark as anonymized (so the receiver knows not to de-anonymize again)
    sanitized._anon = true;

    relay._stats.opsSanitized++;
    return sanitized;
}

/**
 * De-anonymize an incoming op: resolve anonIds back to real peer IDs.
 * HOST ONLY — used for internal routing decisions. The forwarded copy
 * to other peers keeps the anonIds intact.
 *
 * @param {Object} relay
 * @param {Object} op
 * @returns {Object} op with real peer IDs restored (or anonIds if non-host)
 */
export function deanonymizeIncomingOp(relay, op) {
    if (!relay.enabled || !relay.isHost || !op?._anon) return op;

    const resolved = { ...op };

    for (const field of IDENTITY_FIELDS) {
        if (resolved[field]) {
            const real = resolveAnonToReal(relay, resolved[field]);
            if (real) resolved[field] = real;
        }
    }

    if (resolved.payload && typeof resolved.payload === 'object') {
        resolved.payload = { ...resolved.payload };
        for (const field of IDENTITY_FIELDS) {
            if (resolved.payload[field]) {
                const real = resolveAnonToReal(relay, resolved.payload[field]);
                if (real) resolved.payload[field] = real;
            }
        }
    }

    relay._stats.opsDeAnonymized++;
    return resolved;
}

/**
 * Re-anonymize an op for forwarding to another peer.
 * The host de-anonymizes for routing, then this re-anonymizes for delivery.
 * This ensures the recipient only sees the sender's anonId.
 *
 * @param {Object} relay
 * @param {Object} op - de-anonymized op
 * @param {string} senderRealPeerId - real sender ID
 * @returns {Object} re-anonymized op
 */
export function reanonymizeForForward(relay, op, senderRealPeerId) {
    if (!relay.enabled || !op) return op;

    const forwarded = { ...op };
    const senderAnon = resolveRealToAnon(relay, senderRealPeerId);

    // Ensure the sender's identity uses their anonId
    if (forwarded.peerId && senderAnon) forwarded.peerId = senderAnon;
    forwarded._anon = true;

    return forwarded;
}

// ─── Garlic Encryption ──────────────────────────────────────────────────────
//
// Garlic encryption ensures the relay host can see the routing envelope
// (sender anonId, recipient anonId) but CANNOT read the message payload.
// Only the intended recipient can decrypt the payload with their ECDH key.
//
// Structure of a garlic-wrapped message:
//   {
//     type: '__garlic__',
//     from: senderAnonId,
//     to: recipientAnonId,       // host uses this for routing
//     iv: Uint8Array(12),        // AES-GCM nonce
//     ct: Uint8Array,            // encrypted payload (AES-GCM ciphertext + tag)
//     _anon: true,
//   }

/**
 * Wrap an op in garlic encryption for a specific recipient.
 * The payload is encrypted with a shared key derived from our ECDH private key
 * + the recipient's ECDH public key. The relay host can route (via 'to' field)
 * but cannot read the encrypted payload.
 *
 * @param {Object} relay
 * @param {Object} op - the op to encrypt
 * @param {string} recipientAnonId - who this message is for
 * @param {CryptoKey} ownEcdhPrivateKey - our ECDH private key
 * @returns {Promise<Object|null>} garlic-wrapped op, or null if encryption failed
 */
export async function wrapGarlic(relay, op, recipientAnonId, ownEcdhPrivateKey) {
    if (!subtle || !relay?.garlicEnabled || relay._destroyed || !_textReport(recipientAnonId).valid || !ownEcdhPrivateKey) return null;

    const recipientPubRaw = relay._peerEcdhKeys.get(recipientAnonId);
    if (!recipientPubRaw || recipientPubRaw.length === 0) return null;

    try {
        // Import recipient's ECDH public key
        const recipientPub = await subtle.importKey(
            'raw', recipientPubRaw,
            { name: 'ECDH', namedCurve: 'P-256' },
            false, []
        );

        // Derive shared AES key via ECDH + HKDF
        const sharedBits = await subtle.deriveBits(
            { name: 'ECDH', public: recipientPub },
            ownEcdhPrivateKey,
            256
        );
        const hkdfKey = await subtle.importKey('raw', sharedBits, { name: 'HKDF' }, false, ['deriveKey']);
        const aesKey = await subtle.deriveKey(
            {
                name: 'HKDF', hash: 'SHA-256',
                salt: new TextEncoder().encode('garlic-v1'),
                info: new TextEncoder().encode('collab-garlic-aes'),
            },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        // Serialize and encrypt the op payload
        const payload = collabIdentityPayloadReport(op);
        if (!payload.valid || payload.bytes > COLLAB_ANON_RELAY_LIMITS.maxPayloadBytes) return null;
        const plaintext = encoder.encode(payload.canonical);
        const iv = new Uint8Array(12);
        crypto.getRandomValues(iv);

        const ciphertext = await subtle.encrypt(
            { name: 'AES-GCM', iv, tagLength: 128 },
            aesKey,
            plaintext
        );

        relay._stats.garlicWrapped++;

        return {
            type: '__garlic__',
            from: relay.selfAnonId,
            to: recipientAnonId,
            iv: Array.from(iv),
            ct: Array.from(new Uint8Array(ciphertext)),
            _anon: true,
        };
    } catch (_) {
        relay._stats.garlicFailed++;
        return null;
    }
}

/**
 * Unwrap a garlic-encrypted message using our ECDH private key.
 * @param {Object} relay
 * @param {Object} garlicOp - the garlic-wrapped op
 * @param {CryptoKey} ownEcdhPrivateKey - our ECDH private key
 * @returns {Promise<Object|null>} decrypted op, or null if decryption failed
 */
export async function unwrapGarlic(relay, garlicOp, ownEcdhPrivateKey) {
    if (!subtle || !relay || relay._destroyed || !garlicOp || garlicOp.type !== '__garlic__' || !ownEcdhPrivateKey) return null;
    if (garlicOp.to !== relay.selfAnonId || !_textReport(garlicOp.from).valid) return null;
    const ivReport = _bytesReport(garlicOp.iv, COLLAB_ANON_RELAY_LIMITS.ivBytes);
    const ctReport = _bytesReport(garlicOp.ct, 16, COLLAB_ANON_RELAY_LIMITS.maxCiphertextBytes);
    if (!ivReport.valid || !ctReport.valid) return null;

    const senderAnonId = garlicOp.from;
    const senderPubRaw = relay._peerEcdhKeys.get(senderAnonId);
    if (!senderPubRaw || senderPubRaw.length === 0) return null;

    try {
        // Import sender's ECDH public key
        const senderPub = await subtle.importKey(
            'raw', senderPubRaw,
            { name: 'ECDH', namedCurve: 'P-256' },
            false, []
        );

        // Derive the same shared AES key (ECDH is symmetric in this regard)
        const sharedBits = await subtle.deriveBits(
            { name: 'ECDH', public: senderPub },
            ownEcdhPrivateKey,
            256
        );
        const hkdfKey = await subtle.importKey('raw', sharedBits, { name: 'HKDF' }, false, ['deriveKey']);
        const aesKey = await subtle.deriveKey(
            {
                name: 'HKDF', hash: 'SHA-256',
                salt: new TextEncoder().encode('garlic-v1'),
                info: new TextEncoder().encode('collab-garlic-aes'),
            },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        // Decrypt
        const iv = ivReport.bytes;
        const ct = ctReport.bytes;
        const plaintext = await subtle.decrypt(
            { name: 'AES-GCM', iv, tagLength: 128 },
            aesKey,
            ct
        );

        if (plaintext.byteLength > COLLAB_ANON_RELAY_LIMITS.maxPayloadBytes) return null;
        const decoded = JSON.parse(new TextDecoder().decode(plaintext));
        if (!collabIdentityPayloadReport(decoded).valid) return null;
        relay._stats.garlicUnwrapped++;
        return decoded;
    } catch (_) {
        relay._stats.garlicFailed++;
        return null;
    }
}

// ─── Anonymous Hello ────────────────────────────────────────────────────────

/**
 * Build an anonymous hello payload.
 * Replaces the real selfId/username with anonymous versions.
 * The ECDH public key is still included (needed for garlic encryption)
 * but it's an ephemeral session key, not tied to persistent identity.
 *
 * @param {Object} relay
 * @param {Object} realHello - the normal hello payload
 * @returns {Object} anonymized hello
 */
export function buildAnonHello(relay, realHello) {
    if (!relay.enabled) return realHello;

    return {
        ...realHello,
        type: '__hello__',
        selfId: relay.selfAnonId,            // anonymous session ID
        username: getAnonUsername(relay.selfAnonId), // anonymous username
        _realIdEncrypted: null,               // placeholder — host decrypts
        _anonMode: true,                      // signal that this is anonymous
        // ECDH key still included (ephemeral, not identifying)
        // ECDSA identity proof is STRIPPED — it's tied to persistent identity
        publicKey: null,
        identityProof: null,
    };
}

/**
 * Process an anonymous hello on the host side.
 * The host needs to map the anonymous selfId to the real peer connection.
 *
 * @param {Object} relay
 * @param {string} realPeerId - the real peerId from the WebRTC connection
 * @param {Object} anonHello - the anonymous hello payload
 * @returns {{ anonId: string, username: string }}
 */
export function processAnonHello(relay, realPeerId, anonHello) {
    if (!relay?.isHost || relay._destroyed || !_textReport(realPeerId).valid || !anonHello?._anonMode) return null;
    const anonId = anonHello.selfId;
    if (typeof anonId !== 'string' || !/^[0-9a-f]{16}$/i.test(anonId)) return null;
    const existingReal = relay._anonToReal.get(anonId);
    const existingAnon = relay._realToAnon.get(realPeerId);
    if ((existingReal && existingReal !== realPeerId) || (existingAnon && existingAnon !== anonId)) return null;
    if (!existingAnon && relay._realToAnon.size >= COLLAB_ANON_RELAY_LIMITS.maxPeers) return null;
    const ecdhKey = anonHello.ecdhKey ? _publicKeyReport(anonHello.ecdhKey) : null;
    if (ecdhKey && !ecdhKey.valid) return null;

    // Host registers the mapping: real ↔ anon
    relay._realToAnon.set(realPeerId, anonId);
    relay._anonToReal.set(anonId, realPeerId);
    relay._anonUsernames.set(anonId, getAnonUsername(anonId));

    // Store ECDH key for garlic encryption (if provided)
    if (ecdhKey) relay._peerEcdhKeys.set(anonId, ecdhKey.bytes);

    if (!existingAnon) relay._stats.peersRegistered++;
    return {
        anonId,
        username: relay._anonUsernames.get(anonId),
    };
}

// ─── TURN-Only Enforcement ──────────────────────────────────────────────────

/**
 * Get ICE configuration for anonymous mode.
 * Forces TURN-only relay to prevent IP address leakage.
 * @param {Object[]} iceServers - base ICE servers config
 * @returns {Object} RTCConfiguration with relay-only transport policy
 */
export function getAnonIceConfig(iceServers) {
    return {
        iceServers: iceServers || [],
        iceTransportPolicy: 'relay', // CRITICAL: only use TURN relay, never STUN/direct
    };
}

/**
 * Check if a peer list entry should be visible to other peers.
 * In anonymous mode, strip real identifiers from presence data.
 * @param {Object} relay
 * @param {Object} presenceEntry - { peerId, username, color, ... }
 * @returns {Object} sanitized presence entry
 */
export function sanitizePresence(relay, presenceEntry) {
    if (!relay.enabled || !presenceEntry) return presenceEntry;

    const anonId = resolveRealToAnon(relay, presenceEntry.peerId);
    if (!anonId) return presenceEntry;

    return {
        ...presenceEntry,
        peerId: anonId,
        username: relay._anonUsernames.get(anonId) || getAnonUsername(anonId),
        // Keep non-identifying fields: color, selection, camera, etc.
    };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

/**
 * Get anonymous relay stats for UI display.
 * @param {Object} relay
 * @returns {Object}
 */
export function getAnonRelayStats(relay) {
    return {
        enabled: relay.enabled,
        selfAnonId: relay.selfAnonId,
        isHost: relay.isHost,
        garlicEnabled: relay.garlicEnabled,
        mappedPeers: relay._realToAnon.size,
        stats: { ...relay._stats },
        // Anonymous credentials
        credentialsReady: !!relay._credentialsReady,
        certifiedKeys: relay._certifiedSessionKeys?.length || 0,
        // List of anonymous peer info (safe to expose — only anonIds)
        peers: Array.from(relay._anonUsernames.entries()).map(([anonId, username]) => ({
            anonId,
            username,
            hasEcdhKey: relay._peerEcdhKeys.has(anonId),
        })),
    };
}

/**
 * Check if anonymous mode is active on a relay.
 * @param {Object} relay
 * @returns {boolean}
 */
export function isAnonEnabled(relay) {
    return relay?.enabled === true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANONYMOUS CREDENTIALS — Host-Certified Anonymous Session Keys
// ═══════════════════════════════════════════════════════════════════════════════
//
// Inspired by Signal's Keyed-Verification Anonymous Credentials (KVACs) and
// Tor's anonymous token system. Adapted for real-time P2P games.
//
// Problem: In anonymous mode, score receipts and critical ops need signing,
//          but ECDSA persistent keys leak identity (fingerprint = permanent ID).
//
// Solution: Each peer generates a FRESH session ECDSA key pair.
//           The host certifies each session key belongs to a legitimate peer.
//           All peers get a shuffled list of certified session keys.
//           Receipts signed with session keys are verifiable but anonymous.
//
// Flow:
//   1. Host generates sessionSeed (random 32 bytes) and shares via E2E channel
//   2. Each peer generates a fresh session ECDSA P-256 key pair
//   3. Peer proves legitimacy: signs sessionSeed with persistent key
//   4. Peer sends to host: { credential, sessionPubKeyRaw }
//   5. Host verifies credential against peer's known persistent pubkey
//   6. Host adds sessionPubKey to the certified list
//   7. Host broadcasts shuffled list of ALL certified session pubkeys
//   8. Any peer can verify score receipts against the session key list
//   9. Nobody (except host) knows which session key maps to which identity
//
// Properties:
//   - Anonymous: session keys are fresh, not linked to persistent fingerprint
//   - Verified: host certified each key belongs to a legitimate registered peer
//   - Unlinkable: different session key each session, no cross-session correlation
//   - Standard crypto: ECDSA P-256 sign/verify, entirely WebCrypto API
//

/**
 * Generate a session seed (host only).
 * Shared with all peers so they can build their credential proof.
 * @returns {Uint8Array} 32 random bytes
 */
export function generateSessionSeed() {
    const seed = new Uint8Array(32);
    crypto.getRandomValues(seed);
    return seed;
}

/**
 * Generate a fresh session ECDSA P-256 key pair for anonymous signing.
 * This key is ephemeral — different every session, never persisted.
 * @returns {Promise<{ keyPair: CryptoKeyPair, publicKeyRaw: Uint8Array }|null>}
 */
export async function generateAnonSigningKey() {
    if (!subtle) return null;
    try {
        const keyPair = await subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            false, // not extractable — private key stays in secure store
            ['sign', 'verify']
        );
        const publicKeyRaw = new Uint8Array(
            await subtle.exportKey('raw', keyPair.publicKey)
        );
        return { keyPair, publicKeyRaw };
    } catch (_) {
        return null;
    }
}

/**
 * Build an anonymous credential: prove we're a legitimate peer by signing
 * the sessionSeed with our persistent ECDSA key.
 *
 * The credential proves: "I possess the private key for a registered identity"
 * without revealing WHICH identity (the credential is sent only to the host
 * via E2E encrypted channel, and the host discards the mapping after verification).
 *
 * @param {Object} persistentIdentity - from createIdentity() (CollabIdentity)
 * @param {Uint8Array} sessionSeed - from generateSessionSeed()
 * @returns {Promise<Uint8Array>} credential signature
 */
export async function buildAnonCredential(persistentIdentity, sessionSeed) {
    if (!subtle || !persistentIdentity?._available) return new Uint8Array(0);
    const seed = _bytesReport(sessionSeed, COLLAB_ANON_RELAY_LIMITS.sessionSeedBytes);
    if (!seed.valid) return new Uint8Array(0);
    try {
        const canonical = new Uint8Array(seed.length + 16);
        const prefix = encoder.encode('anon-credential:');
        canonical.set(prefix, 0);
        canonical.set(seed.bytes, prefix.length);

        const sig = await subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            persistentIdentity.privateKey,
            canonical
        );
        return new Uint8Array(sig);
    } catch (_) {
        return new Uint8Array(0);
    }
}

/**
 * Verify an anonymous credential (HOST ONLY).
 * Confirms the credential was signed by the persistent key we know for this peer.
 *
 * @param {Uint8Array} persistentPubKeyRaw - the peer's known persistent ECDSA pubkey
 * @param {Uint8Array} sessionSeed
 * @param {Uint8Array} credential - the signature to verify
 * @returns {Promise<boolean>}
 */
export async function verifyAnonCredential(persistentPubKeyRaw, sessionSeed, credential) {
    if (!subtle) return false;
    try {
        const key = _publicKeyReport(persistentPubKeyRaw);
        const seed = _bytesReport(sessionSeed, COLLAB_ANON_RELAY_LIMITS.sessionSeedBytes);
        const signature = _signatureReport(credential);
        if (!key.valid || !seed.valid || !signature.valid) return false;

        const importedKey = await subtle.importKey(
            'raw', key.bytes,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false, ['verify']
        );

        const canonical = new Uint8Array(seed.length + 16);
        const prefix = encoder.encode('anon-credential:');
        canonical.set(prefix, 0);
        canonical.set(seed.bytes, prefix.length);

        return await subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            importedKey, signature.bytes, canonical
        );
    } catch (_) {
        return false;
    }
}

/**
 * Sign a score receipt with the anonymous session key.
 * Uses the same canonical format as signScoreReceipt but with the session key.
 * The anonId is used instead of the real selfId in the signed data.
 *
 * @param {CryptoKeyPair} sessionKeyPair - from generateAnonSigningKey()
 * @param {Object} scoreData - { anonId, targetAnonId, score, timestamp }
 * @returns {Promise<Uint8Array>}
 */
export async function signAnonScoreReceipt(sessionKeyPair, scoreData) {
    if (!subtle || !sessionKeyPair?.privateKey) return new Uint8Array(0);
    const report = collabAnonScoreReport(scoreData, scoreData?.timestamp);
    if (!report.valid) return new Uint8Array(0);
    try {
        const canonical = `anon-score:${report.anonId}:${report.targetAnonId}:${report.score}:${report.timestamp}`;
        const data = encoder.encode(canonical);
        const sig = await subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            sessionKeyPair.privateKey,
            data
        );
        return new Uint8Array(sig);
    } catch (_) {
        return new Uint8Array(0);
    }
}

/**
 * Verify an anonymous score receipt against the list of certified session keys.
 * Returns true if ANY certified session key validates the signature.
 * This is the key anonymity property: verifier confirms the receipt is from
 * a legitimate peer without learning WHICH peer.
 *
 * @param {Uint8Array[]} certifiedSessionKeys - list of raw session pubkeys
 * @param {Object} scoreData - { anonId, targetAnonId, score, timestamp }
 * @param {Uint8Array} signature
 * @returns {Promise<boolean>}
 */
export async function verifyAnonScoreReceipt(certifiedSessionKeys, scoreData, signature, signerPublicKey = null, nowMs = Date.now()) {
    if (!subtle || !certifiedSessionKeys || certifiedSessionKeys.length === 0) return false;
    try {
        const report = collabAnonScoreReport(scoreData, nowMs);
        const sig = _signatureReport(signature);
        if (!report.valid || !sig.valid || certifiedSessionKeys.length > COLLAB_ANON_RELAY_LIMITS.maxCertifiedKeys) return false;
        const canonical = `anon-score:${report.anonId}:${report.targetAnonId}:${report.score}:${report.timestamp}`;
        const data = encoder.encode(canonical);
        const signer = signerPublicKey ? _publicKeyReport(signerPublicKey) : null;
        if (signer && !signer.valid) return false;

        // Try each certified session key — if ANY matches, the receipt is valid
        // This is O(n) in the number of peers, but n is small (<20 in practice)
        for (const pubRaw of certifiedSessionKeys) {
            try {
                const publicKey = _publicKeyReport(pubRaw);
                if (!publicKey.valid) continue;
                if (signer && byteSignature(publicKey.bytes) !== byteSignature(signer.bytes)) continue;
                const key = await subtle.importKey(
                    'raw', publicKey.bytes,
                    { name: 'ECDSA', namedCurve: 'P-256' },
                    false, ['verify']
                );
                const valid = await subtle.verify(
                    { name: 'ECDSA', hash: 'SHA-256' },
                    key, sig.bytes, data
                );
                if (valid) return true;
            } catch (_) { continue; }
        }
        return false;
    } catch (_) {
        return false;
    }
}

export async function anonRelayPayloadHash(payloadStr) {
    return contentHashHex(String(payloadStr), 'SHA-256');
}

/**
 * Sign a critical op with the anonymous session key.
 * Same canonical format as signCriticalOp but uses session key + anonId.
 *
 * @param {CryptoKeyPair} sessionKeyPair
 * @param {Uint8Array} sessionPubKeyRaw - our session public key (included in op)
 * @param {Object} op
 * @param {string} anonId - our anonymous session ID
 * @returns {Promise<Object>} the op with _sig, _anonPub, _sigTs fields
 */
export async function signAnonCriticalOp(sessionKeyPair, sessionPubKeyRaw, op, anonId) {
    if (!subtle || !sessionKeyPair?.privateKey || !op?.type) return op;
    try {
        const timestamp = Date.now();
        const publicKey = _publicKeyReport(sessionPubKeyRaw);
        const sender = _textReport(anonId);
        const envelope = Object.create(null);
        for (const key of Object.keys(op).sort()) {
            if (!['_sig', '_anonPub', '_sigTs', '_sigV'].includes(key)) envelope[key] = op[key];
        }
        const payload = collabIdentityPayloadReport(envelope);
        if (!publicKey.valid || !sender.valid || !payload.valid) return op;
        const payloadHash = await anonRelayPayloadHash(payload.canonical);

        const canonical = `anon-op-sig-v2:${sender.value}:${timestamp}:${payloadHash}`;
        const data = encoder.encode(canonical);
        const sig = await subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            sessionKeyPair.privateKey,
            data
        );

        return {
            ...op,
            _sig: Array.from(new Uint8Array(sig)),
            _anonPub: Array.from(publicKey.bytes), // session key, NOT persistent
            _sigTs: timestamp,
            _sigV: 2,
        };
    } catch (_) {
        return op;
    }
}

/**
 * Verify a critical op signed with an anonymous session key.
 * Checks the signature against ALL certified session keys.
 *
 * @param {Object} op - with _sig, _anonPub, _sigTs
 * @param {string} senderAnonId
 * @param {Uint8Array[]} certifiedSessionKeys
 * @returns {Promise<{valid: boolean, reason: string}>}
 */
export async function verifyAnonCriticalOp(op, senderAnonId, certifiedSessionKeys, relay = null, nowMs = Date.now()) {
    if (!subtle) return { valid: true, reason: 'no-crypto' };
    if (relay?._destroyed) return { valid: false, reason: 'destroyed-relay' };
    if (!op?._sig || !op._anonPub || op._sigTs === undefined) {
        return { valid: false, reason: 'missing-signature' };
    }

    let replayToken = '';
    try {
        const now = relay ? _relayClock(relay, nowMs) : runtimeMonotonicClockStep(nowMs, 0).timestampMs;
        const timestamp = collabAnonTimestampReport(op._sigTs, now);
        const signature = _signatureReport(op._sig);
        const publicKey = _publicKeyReport(op._anonPub);
        const sender = _textReport(senderAnonId);
        const version = finiteNumberReport(op._sigV ?? 1, { integer: true, min: 1, max: 2 });
        if (!timestamp.valid || !signature.valid || !publicKey.valid || !sender.valid || !version.valid) {
            return { valid: false, reason: !timestamp.valid ? timestamp.reason : 'invalid-signature-envelope' };
        }

        // The op includes its session pubkey — verify it's in the certified list
        const isCertified = certifiedSessionKeys.some(
            k => byteSignature(k) === byteSignature(publicKey.bytes)
        );
        if (!isCertified) {
            return { valid: false, reason: 'uncertified-session-key' };
        }

        // Reconstruct canonical and verify with the embedded session pubkey
        const signedValue = version.value === 2
            ? Object.fromEntries(Object.keys(op).sort().filter(k => !['_sig', '_anonPub', '_sigTs', '_sigV'].includes(k)).map(k => [k, op[k]]))
            : op.payload;
        const payload = collabIdentityPayloadReport(signedValue);
        if (!payload.valid) return { valid: false, reason: payload.reason };
        const payloadHash = await anonRelayPayloadHash(payload.canonical);
        const canonical = version.value === 2
            ? `anon-op-sig-v2:${sender.value}:${timestamp.timestamp}:${payloadHash}`
            : `anon-op-sig:${op.type}:${sender.value}:${timestamp.timestamp}:${payloadHash}`;
        const data = encoder.encode(canonical);
        replayToken = `${sender.value}:${byteSignature(signature.bytes)}`;
        if (relay) {
            for (const [token, acceptedAt] of relay._seenCriticalSignatures) {
                if (now - acceptedAt > COLLAB_ANON_RELAY_LIMITS.maxAgeMs) relay._seenCriticalSignatures.delete(token);
            }
            if (relay._seenCriticalSignatures.has(replayToken) || relay._pendingCriticalSignatures.has(replayToken)) {
                return { valid: false, reason: 'signature-replay' };
            }
            if (relay._pendingCriticalSignatures.size >= COLLAB_ANON_RELAY_LIMITS.maxSeenCriticalOps) {
                return { valid: false, reason: 'verification-capacity' };
            }
            relay._pendingCriticalSignatures.add(replayToken);
        }

        const key = await subtle.importKey(
            'raw', publicKey.bytes,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false, ['verify']
        );
        const valid = await subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key, signature.bytes, data
        );
        if (valid && relay) {
            relay._seenCriticalSignatures.set(replayToken, now);
            while (relay._seenCriticalSignatures.size > COLLAB_ANON_RELAY_LIMITS.maxSeenCriticalOps) {
                relay._seenCriticalSignatures.delete(relay._seenCriticalSignatures.keys().next().value);
            }
        }
        return { valid, reason: valid ? 'ok' : 'bad-signature' };
    } catch (_) {
        return { valid: false, reason: 'verify-error' };
    } finally {
        if (relay && replayToken) relay._pendingCriticalSignatures.delete(replayToken);
    }
}

// ─── Session Key Registry ───────────────────────────────────────────────────

/**
 * Initialize the anonymous credential state on the relay.
 * Called after the relay is created and the host generates a session seed.
 *
 * @param {Object} relay
 * @param {Uint8Array} sessionSeed - host-generated seed
 * @param {Object} ownSessionKey - { keyPair, publicKeyRaw } from generateAnonSigningKey()
 */
export function initAnonCredentials(relay, sessionSeed, ownSessionKey) {
    if (!relay || relay._destroyed) return false;
    const seed = _bytesReport(sessionSeed, relay.isHost ? COLLAB_ANON_RELAY_LIMITS.sessionSeedBytes : 0, COLLAB_ANON_RELAY_LIMITS.sessionSeedBytes);
    const publicKey = ownSessionKey?.publicKeyRaw ? _publicKeyReport(ownSessionKey.publicKeyRaw) : null;
    if (!seed.valid || (publicKey && !publicKey.valid)) return false;
    relay._sessionSeed = seed.bytes;
    relay._ownSessionKeyPair = ownSessionKey?.keyPair || null;
    relay._ownSessionPubKeyRaw = publicKey?.bytes || new Uint8Array(0);
    // Certified session keys: list of raw pubkeys verified by host
    relay._certifiedSessionKeys = [];
    // Add our own session key to the list
    if (ownSessionKey?.publicKeyRaw?.length > 0) {
        relay._certifiedSessionKeys.push(publicKey.bytes.slice());
    }
    relay._credentialsReady = !!(relay._ownSessionKeyPair && publicKey?.valid);
    return relay._credentialsReady;
}

/**
 * Add a verified session public key to the certified list (HOST).
 * Called after the host verifies a peer's anonymous credential.
 *
 * @param {Object} relay
 * @param {Uint8Array} sessionPubKeyRaw
 */
export function certifySessionKey(relay, sessionPubKeyRaw) {
    if (!relay?.isHost || relay._destroyed) return false;
    if (!relay._certifiedSessionKeys) relay._certifiedSessionKeys = [];
    const key = _publicKeyReport(sessionPubKeyRaw);
    if (!key.valid || relay._certifiedSessionKeys.length >= COLLAB_ANON_RELAY_LIMITS.maxCertifiedKeys) return false;
    // Avoid duplicates
    const exists = relay._certifiedSessionKeys.some(
        k => byteSignature(k) === byteSignature(key.bytes)
    );
    if (!exists) {
        relay._certifiedSessionKeys.push(
            key.bytes
        );
        return true;
    }
    return false;
}

/**
 * Set the full certified session key list (NON-HOST peers).
 * Called when the host broadcasts the shuffled list of all certified keys.
 *
 * @param {Object} relay
 * @param {Array<number[]|Uint8Array>} keyList - array of raw session pubkeys
 */
export function setCertifiedSessionKeys(relay, keyList) {
    if (!relay || relay._destroyed || !Array.isArray(keyList) || keyList.length > COLLAB_ANON_RELAY_LIMITS.maxCertifiedKeys) return false;
    const keys = [];
    const seen = new Set();
    for (const value of keyList) {
        const key = _publicKeyReport(value);
        if (!key.valid) return false;
        const id = byteSignature(key.bytes);
        if (seen.has(id)) return false;
        seen.add(id);
        keys.push(key.bytes);
    }
    relay._certifiedSessionKeys = keys;
    return true;
}

/**
 * Get the list of certified session keys.
 * @param {Object} relay
 * @returns {Uint8Array[]}
 */
export function getCertifiedSessionKeys(relay) {
    return (relay?._certifiedSessionKeys || []).map(key => key.slice());
}

/**
 * Build an __anon_credential__ op for the host.
 * Sent after joining to prove legitimacy and register session key.
 *
 * @param {Object} relay
 * @param {Uint8Array} credential - from buildAnonCredential()
 * @returns {Object} op to send to host
 */
export function buildAnonCredentialOp(relay, credential) {
    return {
        type: '__anon_credential__',
        payload: {
            anonId: relay.selfAnonId,
            sessionPubKey: Array.from(relay._ownSessionPubKeyRaw || []),
            credential: Array.from(credential),
        },
    };
}

/**
 * Build an __anon_keylist__ op to broadcast the certified session key list.
 * HOST ONLY — sent to all peers after verifying credentials.
 *
 * @param {Object} relay
 * @returns {Object} op to broadcast
 */
export function buildAnonKeylistOp(relay) {
    // Shuffle the key list so ordering doesn't reveal the mapping
    const shuffled = [...(relay._certifiedSessionKeys || [])].map(k => Array.from(k));
    shuffleInPlace(shuffled, Math.random);
    return {
        type: '__anon_keylist__',
        payload: { keys: shuffled },
    };
}

/**
 * Build an anonymous score report op.
 * Uses the session key for signing instead of the persistent ECDSA key.
 *
 * @param {Object} relay
 * @param {string} targetAnonId - the peer being scored (by their anonId)
 * @param {number} score - 0-1000
 * @returns {Promise<Object|null>} op to broadcast, or null if signing failed
 */
export async function buildAnonScoreReportOp(relay, targetAnonId, score) {
    if (!relay._ownSessionKeyPair || !relay._credentialsReady) return null;
    const timestamp = Date.now();
    const scoreData = {
        anonId: relay.selfAnonId,
        targetAnonId,
        score,
        timestamp,
    };
    if (!collabAnonScoreReport(scoreData, timestamp).valid) return null;
    const signature = await signAnonScoreReceipt(relay._ownSessionKeyPair, scoreData);
    if (signature.length === 0) return null;

    return {
        type: '__anon_score_report__',
        payload: {
            reporterAnonId: relay.selfAnonId,
            targetAnonId,
            score,
            timestamp,
            signature: Array.from(signature),
            sessionPubKey: Array.from(relay._ownSessionPubKeyRaw),
        },
    };
}

/**
 * Check if anonymous credentials are ready for signing/verification.
 * @param {Object} relay
 * @returns {boolean}
 */
export function isAnonCredentialsReady(relay) {
    return !!(relay?._credentialsReady && relay._ownSessionKeyPair && relay._certifiedSessionKeys?.length > 0);
}

export function resetAnonymousRelay(relay) {
    if (!relay || relay._destroyed) return false;
    relay._generation += 1;
    relay._realToAnon.clear();
    relay._anonToReal.clear();
    relay._peerEcdhKeys.clear();
    relay._anonUsernames.clear();
    relay._sessionSeed = new Uint8Array(0);
    relay._ownSessionKeyPair = null;
    relay._ownSessionPubKeyRaw = new Uint8Array(0);
    relay._certifiedSessionKeys = [];
    relay._credentialsReady = false;
    relay._seenCriticalSignatures.clear();
    relay._pendingCriticalSignatures.clear();
    relay._clockMs = 0;
    return true;
}

export function destroyAnonymousRelay(relay) {
    if (!relay || relay._destroyed) return false;
    resetAnonymousRelay(relay);
    relay.enabled = false;
    relay._destroyed = true;
    relay._generation += 1;
    return true;
}

// Remaining protocol gaps are explicit: host certification is centralized,
// anonymity is not Sybil resistance, and replay state is session-memory only.
