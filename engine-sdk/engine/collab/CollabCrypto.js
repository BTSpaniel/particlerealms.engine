// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabCrypto.js
 * ECDH P-256 key exchange + AES-256-GCM encryption for P2P collab channels.
 * Uses the SubtleCrypto API with shared finite-number admission.
 *
 * Flow:
 *   1. Each peer calls generateKeyPair() on connect
 *   2. Peers exchange public keys during hello handshake
 *   3. deriveSharedKey() produces an AES-256-GCM key via ECDH + HKDF
 *   4. All subsequent messages: encrypt() before send, decrypt() on receive
 *   5. HMAC for challenge-response authentication during handshake
 *
 * Nonce scheme: 12 bytes = [8-byte channelId | 4-byte monotonic counter]
 * Counter MUST never repeat for a given key.
 */

import { finiteNumberReport } from '../core/math/MathValidation.js';

const cryptoApi = globalThis.crypto ?? null;
const subtle = cryptoApi?.subtle ?? null;
const TEXT_ENCODER = new TextEncoder();
const DEFAULT_KDF_SALT = 'particle-engine-collab-v1';

export const COLLAB_CRYPTO_LIMITS = Object.freeze({
    maxPlaintextBytes: 64 * 1024 * 1024,
    maxCiphertextBytes: 64 * 1024 * 1024 + 16,
    maxSaltBytes: 4096,
    replayWindow: 1024,
    maxPendingDecrypts: 128,
});

function _bytes(value, name, minBytes, maxBytes) {
    let view;
    if (value instanceof ArrayBuffer) view = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else throw new TypeError(`${name} must be an ArrayBuffer or typed-array view`);
    if (view.byteLength < minBytes || view.byteLength > maxBytes) {
        throw new RangeError(`${name} must contain ${minBytes === maxBytes ? minBytes : `${minBytes}..${maxBytes}`} bytes`);
    }
    return view.slice();
}

function _saltBytes(salt) {
    if (salt != null && typeof salt !== 'string') throw new TypeError('KDF salt must be a string');
    const bytes = TEXT_ENCODER.encode(salt || DEFAULT_KDF_SALT);
    if (bytes.byteLength > COLLAB_CRYPTO_LIMITS.maxSaltBytes) throw new RangeError('KDF salt is too large');
    return bytes;
}

// ─── Key Generation ───────────────────────────────────────────────────────────

/**
 * Generate an ECDH P-256 key pair for key exchange.
 * @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey, publicKeyRaw: ArrayBuffer}>}
 */
export async function generateKeyPair() {
    if (!subtle) throw new Error('SubtleCrypto not available');
    const keyPair = await subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true, // extractable — needed to export public key
        ['deriveKey', 'deriveBits']
    );
    const publicKeyRaw = await subtle.exportKey('raw', keyPair.publicKey);
    return {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
        publicKeyRaw, // 65 bytes uncompressed P-256 point
    };
}

/**
 * Import a raw public key (65 bytes) received from a remote peer.
 * @param {ArrayBuffer|Uint8Array} rawKey
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(rawKey) {
    if (!subtle) throw new Error('SubtleCrypto not available');
    const bytes = _bytes(rawKey, 'P-256 public key', 65, 65);
    if (bytes[0] !== 0x04) throw new RangeError('P-256 public key must use uncompressed point format');
    return subtle.importKey(
        'raw', bytes,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
    );
}

// ─── Key Derivation ───────────────────────────────────────────────────────────

/**
 * Derive a shared AES-256-GCM key from our private key + remote public key.
 * Optionally mixes in a room password for authentication.
 * @param {CryptoKey} privateKey - Our ECDH private key
 * @param {CryptoKey} remotePublicKey - Remote peer's imported public key
 * @param {string} [salt] - Optional room password / salt for HKDF
 * @returns {Promise<CryptoKey>} AES-256-GCM key
 */
export async function deriveSharedKey(privateKey, remotePublicKey, salt) {
    if (!subtle) throw new Error('SubtleCrypto not available');

    // Step 1: ECDH → shared secret bits
    const sharedBits = await subtle.deriveBits(
        { name: 'ECDH', public: remotePublicKey },
        privateKey,
        256
    );

    // Step 2: Import shared bits as HKDF key material
    const hkdfKey = await subtle.importKey(
        'raw', sharedBits,
        { name: 'HKDF' },
        false,
        ['deriveKey']
    );

    // Step 3: HKDF → AES-256-GCM key
    const saltBytes = _saltBytes(salt);
    const info = TEXT_ENCODER.encode('collab-aes-gcm');

    return subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Derive an HMAC-SHA256 key from ECDH shared bits for challenge-response auth.
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} remotePublicKey
 * @param {string} [salt]
 * @returns {Promise<CryptoKey>}
 */
export async function deriveHmacKey(privateKey, remotePublicKey, salt) {
    if (!subtle) throw new Error('SubtleCrypto not available');

    const sharedBits = await subtle.deriveBits(
        { name: 'ECDH', public: remotePublicKey },
        privateKey,
        256
    );

    const hkdfKey = await subtle.importKey(
        'raw', sharedBits,
        { name: 'HKDF' },
        false,
        ['deriveKey']
    );

    const saltBytes = _saltBytes(salt);
    const info = TEXT_ENCODER.encode('collab-hmac');

    return subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info },
        hkdfKey,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign', 'verify']
    );
}

// ─── Encryption / Decryption ──────────────────────────────────────────────────

export function cryptoNonceReport(counter, channelId = null) {
    const counterReport = finiteNumberReport(counter, {
        integer: true,
        min: 0,
        max: 0xffffffff,
        allowNegativeZero: false,
    });
    if (!counterReport.valid) {
        return { valid: false, reason: 'invalid-counter', counter: 0, channelId: null, iv: null };
    }
    let normalizedChannelId;
    try {
        normalizedChannelId = channelId == null
            ? new Uint8Array(8)
            : _bytes(channelId, 'channelId', 8, 8);
    } catch (error) {
        return { valid: false, reason: error.message, counter: 0, channelId: null, iv: null };
    }
    const iv = new Uint8Array(12);
    iv.set(normalizedChannelId, 0);
    new DataView(iv.buffer).setUint32(8, counter, false);
    return { valid: true, reason: 'valid', counter, channelId: normalizedChannelId, iv };
}

export function encryptedMessageReport(message, channelId = null) {
    let bytes;
    try {
        bytes = _bytes(message, 'encrypted message', 20, COLLAB_CRYPTO_LIMITS.maxCiphertextBytes + 4);
    } catch (error) {
        return { valid: false, reason: error.message, bytes: null, counter: 0, ciphertext: null, iv: null };
    }
    const counter = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
    const nonce = cryptoNonceReport(counter, channelId);
    if (!nonce.valid) {
        return { valid: false, reason: nonce.reason, bytes: null, counter: 0, ciphertext: null, iv: null };
    }
    return {
        valid: true,
        reason: 'valid',
        bytes,
        counter,
        ciphertext: bytes.subarray(4),
        iv: nonce.iv,
    };
}

export function nextCryptoSendCounter(state) {
    if (!state || typeof state !== 'object') throw new TypeError('crypto state is required');
    const report = finiteNumberReport(state.sendCounter, {
        integer: true,
        min: 0,
        max: 0xffffffff,
        allowNegativeZero: false,
    });
    if (!report.valid) throw new RangeError('AES-GCM send counter exhausted or invalid');
    const counter = report.value;
    state.sendCounter = counter + 1;
    return counter;
}

export function resetCryptoCounters(state) {
    if (!state || typeof state !== 'object') return false;
    state.sendCounter = 0;
    state.recvCounterMax = -1;
    state.recvCounters = new Set();
    state.pendingRecvCounters = new Set();
    return true;
}

function _beginReplayAdmission(state, counter) {
    if (state == null) return null;
    if (typeof state !== 'object') throw new TypeError('replay state must be an object');
    if (!(state.recvCounters instanceof Set)) state.recvCounters = new Set();
    if (!(state.pendingRecvCounters instanceof Set)) state.pendingRecvCounters = new Set();
    const max = Number.isInteger(state.recvCounterMax) ? state.recvCounterMax : -1;
    state.recvCounterMax = max;
    const floor = max < 0 ? 0 : Math.max(0, max - COLLAB_CRYPTO_LIMITS.replayWindow + 1);
    if (counter < floor || state.recvCounters.has(counter) || state.pendingRecvCounters.has(counter)) {
        throw new RangeError('encrypted message counter is replayed or outside the receive window');
    }
    if (state.pendingRecvCounters.size >= COLLAB_CRYPTO_LIMITS.maxPendingDecrypts) {
        throw new RangeError('too many pending encrypted messages');
    }
    state.pendingRecvCounters.add(counter);
    return state;
}

function _finishReplayAdmission(state, counter, authenticated) {
    if (!state) return;
    state.pendingRecvCounters.delete(counter);
    if (!authenticated) return;
    state.recvCounters.add(counter);
    state.recvCounterMax = Math.max(state.recvCounterMax, counter);
    const floor = Math.max(0, state.recvCounterMax - COLLAB_CRYPTO_LIMITS.replayWindow + 1);
    for (const seen of state.recvCounters) {
        if (seen < floor) state.recvCounters.delete(seen);
    }
}

/**
 * Encrypt a msgpack payload with AES-256-GCM.
 * @param {CryptoKey} key - AES-256-GCM key from deriveSharedKey
 * @param {Uint8Array} plaintext - Raw msgpack bytes
 * @param {number} counter - Monotonic nonce counter (must never repeat)
 * @param {Uint8Array} [channelId] - 8-byte channel identifier (default: zeros)
 * @returns {Promise<Uint8Array>} Encrypted message: [4-byte counter][N-byte ciphertext+tag]
 */
export async function encrypt(key, plaintext, counter, channelId) {
    if (!subtle) throw new Error('SubtleCrypto not available');
    const bytes = _bytes(plaintext, 'plaintext', 0, COLLAB_CRYPTO_LIMITS.maxPlaintextBytes);
    const nonce = cryptoNonceReport(counter, channelId);
    if (!nonce.valid) throw new RangeError(nonce.reason);

    const ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv: nonce.iv, tagLength: 128 },
        key,
        bytes
    );

    // Wire format: [4-byte counter BE][ciphertext+tag]
    const ct = new Uint8Array(ciphertext);
    const out = new Uint8Array(4 + ct.length);
    const outDv = new DataView(out.buffer);
    outDv.setUint32(0, counter, false);
    out.set(ct, 4);
    return out;
}

/**
 * Decrypt an AES-256-GCM encrypted message.
 * @param {CryptoKey} key - AES-256-GCM key
 * @param {Uint8Array} message - Wire format from encrypt()
 * @param {Uint8Array} [channelId] - Same channelId used during encrypt
 * @param {Object} [replayState] - Optional peer state from createPeerCryptoState()
 * @returns {Promise<Uint8Array>} Decrypted msgpack bytes
 */
export async function decrypt(key, message, channelId, replayState = null) {
    if (!subtle) throw new Error('SubtleCrypto not available');
    const report = encryptedMessageReport(message, channelId);
    if (!report.valid) throw new RangeError(report.reason);
    const admittedState = _beginReplayAdmission(replayState, report.counter);
    try {
        const plaintext = await subtle.decrypt(
            { name: 'AES-GCM', iv: report.iv, tagLength: 128 },
            key,
            report.ciphertext
        );
        _finishReplayAdmission(admittedState, report.counter, true);
        return new Uint8Array(plaintext);
    } catch (error) {
        _finishReplayAdmission(admittedState, report.counter, false);
        throw error;
    }
}

// ─── HMAC Challenge-Response ──────────────────────────────────────────────────

/**
 * Generate a random 32-byte challenge.
 * @returns {Uint8Array}
 */
export function generateChallenge() {
    if (!cryptoApi?.getRandomValues) throw new Error('secure randomness not available');
    const challenge = new Uint8Array(32);
    cryptoApi.getRandomValues(challenge);
    return challenge;
}

/**
 * Sign a challenge with HMAC-SHA256.
 * @param {CryptoKey} hmacKey
 * @param {Uint8Array} challenge
 * @returns {Promise<Uint8Array>}
 */
export async function signChallenge(hmacKey, challenge) {
    if (!subtle) throw new Error('SubtleCrypto not available');
    const challengeBytes = _bytes(challenge, 'challenge', 32, 32);
    const sig = await subtle.sign('HMAC', hmacKey, challengeBytes);
    return new Uint8Array(sig);
}

/**
 * Verify a challenge signature.
 * @param {CryptoKey} hmacKey
 * @param {Uint8Array} challenge
 * @param {Uint8Array} signature
 * @returns {Promise<boolean>}
 */
export async function verifyChallenge(hmacKey, challenge, signature) {
    if (!subtle) throw new Error('SubtleCrypto not available');
    let challengeBytes;
    let signatureBytes;
    try {
        challengeBytes = _bytes(challenge, 'challenge', 32, 32);
        signatureBytes = _bytes(signature, 'HMAC signature', 32, 32);
    } catch (_) {
        return false;
    }
    return subtle.verify('HMAC', hmacKey, signatureBytes, challengeBytes);
}

// ─── Peer Crypto State ────────────────────────────────────────────────────────

/**
 * Create crypto state for a single peer connection.
 * @returns {Object}
 */
export function createPeerCryptoState() {
    return {
        keyPair: null,          // Our ECDH key pair
        remotePublicKey: null,  // Remote peer's public key (CryptoKey)
        aesKey: null,           // Derived AES-256-GCM key
        hmacKey: null,          // Derived HMAC key for auth
        sendCounter: 0,         // Monotonic nonce counter (send)
        recvCounterMax: -1,     // Highest authenticated counter
        recvCounters: new Set(),
        pendingRecvCounters: new Set(),
        channelId: null,        // 8-byte unique channel identifier
        handshakeComplete: false,
        challenge: null,        // Our outgoing challenge
    };
}

/**
 * Initialize crypto state with a fresh key pair.
 * @param {Object} state - From createPeerCryptoState()
 * @returns {Promise<void>}
 */
export async function initPeerCrypto(state) {
    if (!state || typeof state !== 'object') throw new TypeError('crypto state is required');
    const keyPair = await generateKeyPair();
    const challenge = generateChallenge();
    // Channel ID: random 8 bytes for nonce domain separation
    const channelId = new Uint8Array(8);
    cryptoApi.getRandomValues(channelId);
    state.keyPair = keyPair;
    state.challenge = challenge;
    state.channelId = channelId;
    state.remotePublicKey = null;
    state.aesKey = null;
    state.hmacKey = null;
    state.handshakeComplete = false;
    resetCryptoCounters(state);
}

/**
 * Complete the handshake: import remote public key, derive shared keys.
 * @param {Object} state
 * @param {Uint8Array|ArrayBuffer} remotePublicKeyRaw - 65-byte raw public key
 * @param {string} [roomPassword]
 * @returns {Promise<void>}
 */
export async function completePeerCrypto(state, remotePublicKeyRaw, roomPassword) {
    if (!state?.keyPair?.privateKey) throw new TypeError('initialized crypto state is required');
    const remotePublicKey = await importPublicKey(remotePublicKeyRaw);
    const aesKey = await deriveSharedKey(state.keyPair.privateKey, remotePublicKey, roomPassword);
    const hmacKey = await deriveHmacKey(state.keyPair.privateKey, remotePublicKey, roomPassword);
    state.remotePublicKey = remotePublicKey;
    state.aesKey = aesKey;
    state.hmacKey = hmacKey;
    state.handshakeComplete = true;
    resetCryptoCounters(state);
}

/**
 * Check if crypto is available in this environment.
 * @returns {boolean}
 */
export function isCryptoAvailable() {
    return !!subtle;
}

// Audit gaps: CollabCore does not yet bind the ephemeral ECDH key to its ECDSA
// identity proof or run these HMAC challenge helpers, automatic rekey before
// uint32 nonce exhaustion is absent, and captured cross-browser WebCrypto plus
// adversarial replay/reordering fixtures remain absent.
