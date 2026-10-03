// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabIdentity.js
 * Cryptographic peer identity using ECDSA P-256 (Web Crypto API).
 *
 * Each peer generates an ECDSA key pair on init. The public key's SHA-256
 * fingerprint becomes the peer's verified identity — unforgeable without the
 * private key. During the hello handshake, peers exchange public keys and a
 * signed proof (signature of their selfId). The remote side verifies the
 * signature, confirming the peer truly owns the claimed public key.
 *
 * Host verification: the host's fingerprint is embedded in the invite code.
 * Joiners verify the host's fingerprint matches the one in the invite code,
 * preventing host impersonation.
 *
 * Reputation receipts: peers sign their score reports. Others verify the
 * signature before trusting the score, preventing score tampering.
 *
 * Flow:
 *   1. createIdentity() → ECDSA P-256 key pair + fingerprint
 *   2. buildIdentityProof(identity, selfId) → signed selfId (for hello)
 *   3. Remote receives proof → verifyIdentityProof(publicKey, selfId, proof)
 *   4. If host: fingerprint embedded in invite code → joiner checks match
 *   5. signScoreReceipt(identity, scoreData) → signed score for reputation
 *   6. verifyScoreReceipt(publicKey, scoreData, signature) → boolean
 */

import { contentHashHex } from '../core/math/ChecksumMath.js';
import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { byteSignature } from '../core/math/FormatMath.js';
import { statsMedian } from '../core/math/MathStatistics.js';
import { finiteNumberReport } from '../core/math/MathValidation.js';

const subtle = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;

export const COLLAB_IDENTITY_DB_NAME = 'collab-identity';
export const COLLAB_IDENTITY_STORE_NAME = 'keys';
export const COLLAB_IDENTITY_KEY_ID = 'ecdsa-p256-identity';
export const COLLAB_IDENTITY_RECORD_SCHEMA = 'engine.collab-identity-keypair';
export const COLLAB_IDENTITY_RECORD_VERSION = 2;

export const COLLAB_IDENTITY_LIMITS = Object.freeze({
    publicKeyBytes: 65,
    minSignatureBytes: 64,
    maxSignatureBytes: 80,
    maxPeerIdBytes: 256,
    maxKeyIdBytes: 256,
    maxSignedTextBytes: 1024 * 1024,
    maxPayloadDepth: 32,
    maxPayloadNodes: 100000,
    maxPayloadArrayLength: 10000,
    maxPayloadObjectKeys: 256,
    maxPeers: 256,
    maxReceiptTargets: 256,
    maxReceiptsPerTarget: 256,
    maxSeenCriticalOps: 4096,
    maxReceiptAgeMs: 60000,
    maxCriticalOpAgeMs: 60000,
    maxFutureSkewMs: 10000,
});

const _encoder = new TextEncoder();
const _dangerousKeys = new Set(['__proto__', 'prototype', 'constructor']);
let _fallbackIdentitySequence = 0;

function _textReport(value, maxBytes = COLLAB_IDENTITY_LIMITS.maxPeerIdBytes, allowEmpty = false) {
    if (typeof value !== 'string') return { valid: false, value: '', bytes: 0, reason: 'not-string' };
    const bytes = _encoder.encode(value).byteLength;
    const valid = (allowEmpty || value.length > 0) && bytes <= maxBytes;
    return { valid, value, bytes, reason: valid ? 'valid' : (value.length === 0 ? 'empty' : 'too-large') };
}

function _bytesReport(value, options = {}) {
    const arrayLike = value instanceof Uint8Array || Array.isArray(value) || ArrayBuffer.isView(value);
    if (!arrayLike) return { valid: false, bytes: new Uint8Array(0), length: 0, reason: 'not-byte-array' };
    const length = value.length;
    const exact = options.exact ?? null;
    const min = options.min ?? 0;
    const max = options.max ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(length) || length < min || length > max || (exact !== null && length !== exact)) {
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
    const report = _bytesReport(value, { exact: COLLAB_IDENTITY_LIMITS.publicKeyBytes });
    if (report.valid && report.bytes[0] !== 0x04) {
        return { ...report, valid: false, reason: 'invalid-uncompressed-point' };
    }
    return report;
}

function _signatureReport(value) {
    return _bytesReport(value, {
        min: COLLAB_IDENTITY_LIMITS.minSignatureBytes,
        max: COLLAB_IDENTITY_LIMITS.maxSignatureBytes,
    });
}

export function collabIdentityTimestampReport(timestamp, nowMs = Date.now(), options = {}) {
    const value = finiteNumberReport(timestamp, { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER });
    const now = finiteNumberReport(nowMs, { min: 0, max: Number.MAX_SAFE_INTEGER });
    if (!value.valid || !now.valid) {
        return { valid: false, timestamp, nowMs, ageMs: Infinity, reason: 'invalid-clock' };
    }
    const ageMs = now.value - value.value;
    const maxAgeMs = options.maxAgeMs ?? COLLAB_IDENTITY_LIMITS.maxCriticalOpAgeMs;
    const maxFutureSkewMs = options.maxFutureSkewMs ?? COLLAB_IDENTITY_LIMITS.maxFutureSkewMs;
    const valid = ageMs <= maxAgeMs && ageMs >= -maxFutureSkewMs;
    return { valid, timestamp: value.value, nowMs: now.value, ageMs, reason: valid ? 'valid' : 'timestamp-stale' };
}

export function collabIdentityPayloadReport(payload) {
    if (payload === undefined || payload === null) {
        return { valid: true, canonical: '', bytes: 0, nodes: 0, reason: 'valid' };
    }
    const seen = new Set();
    let nodes = 0;
    let invalidReason = '';

    function visit(value, depth) {
        nodes += 1;
        if (nodes > COLLAB_IDENTITY_LIMITS.maxPayloadNodes) return 'too-many-nodes';
        if (depth > COLLAB_IDENTITY_LIMITS.maxPayloadDepth) return 'too-deep';
        if (value === null || typeof value === 'boolean' || typeof value === 'string') return '';
        if (typeof value === 'number') return Number.isFinite(value) ? '' : 'non-finite-number';
        if (typeof value !== 'object') return 'unsupported-value';
        if (seen.has(value)) return 'cyclic-value';
        seen.add(value);
        if (Array.isArray(value)) {
            if (value.length > COLLAB_IDENTITY_LIMITS.maxPayloadArrayLength) return 'array-too-large';
            for (let i = 0; i < value.length; i++) {
                const reason = visit(value[i], depth + 1);
                if (reason) return reason;
            }
        } else {
            const proto = Object.getPrototypeOf(value);
            if (proto !== Object.prototype && proto !== null) return 'non-plain-object';
            const keys = Object.keys(value);
            if (keys.length > COLLAB_IDENTITY_LIMITS.maxPayloadObjectKeys) return 'object-too-large';
            for (const key of keys) {
                if (_dangerousKeys.has(key)) return 'dangerous-key';
                const keyReport = _textReport(key, COLLAB_IDENTITY_LIMITS.maxPeerIdBytes, true);
                if (!keyReport.valid) return 'key-too-large';
                const reason = visit(value[key], depth + 1);
                if (reason) return reason;
            }
        }
        seen.delete(value);
        return '';
    }

    invalidReason = visit(payload, 0);
    if (invalidReason) return { valid: false, canonical: '', bytes: 0, nodes, reason: invalidReason };
    try {
        const canonical = JSON.stringify(payload);
        const bytes = _encoder.encode(canonical).byteLength;
        const valid = bytes <= COLLAB_IDENTITY_LIMITS.maxSignedTextBytes;
        return { valid, canonical: valid ? canonical : '', bytes, nodes, reason: valid ? 'valid' : 'payload-too-large' };
    } catch (_) {
        return { valid: false, canonical: '', bytes: 0, nodes, reason: 'serialization-failed' };
    }
}

// Trust levels based on identity verification + reputation
export const TRUST_LEVEL = {
    UNKNOWN: 'unknown',       // No identity data received
    UNVERIFIED: 'unverified', // Identity proof failed or not available
    VERIFIED: 'verified',     // Identity proof cryptographically verified
    TRUSTED: 'trusted',       // Verified + reputation score >= 700
};

// ─── IndexedDB Persistence ───────────────────────────────────────────────────────

function _isIdentityKey(key, type, usage) {
    return Boolean(key)
        && typeof key === 'object'
        && key.type === type
        && key.algorithm?.name === 'ECDSA'
        && key.algorithm?.namedCurve === 'P-256'
        && Array.isArray(key.usages)
        && key.usages.includes(usage);
}

function _validatePersistedKeyPair(value) {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && _isIdentityKey(value.publicKey, 'public', 'verify')
        && _isIdentityKey(value.privateKey, 'private', 'sign')
        && (value.createdAt === undefined
            || (Number.isSafeInteger(value.createdAt) && value.createdAt >= 0));
}

/** Validate one bounded v1/v2 identity record without guessing future shapes. */
export function prepareCollabIdentityRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('CORRUPT_COLLAB_IDENTITY_RECORD');
    }

    const hasEnvelopeMarker = Object.hasOwn(record, 'schema') || Object.hasOwn(record, 'schemaVersion');
    if (!hasEnvelopeMarker) {
        if (!_validatePersistedKeyPair(record)) throw new Error('CORRUPT_COLLAB_IDENTITY_RECORD');
        return { version: 1, value: record, legacyCreatedAt: record.createdAt ?? null };
    }

    if (record.schema !== COLLAB_IDENTITY_RECORD_SCHEMA || !Number.isSafeInteger(record.schemaVersion)) {
        throw new Error('CORRUPT_COLLAB_IDENTITY_RECORD');
    }
    if (record.schemaVersion > COLLAB_IDENTITY_RECORD_VERSION) {
        throw new Error('FUTURE_COLLAB_IDENTITY_RECORD_VERSION');
    }
    if (record.schemaVersion !== COLLAB_IDENTITY_RECORD_VERSION
        || !_validatePersistedKeyPair(record.keyPair)
        || (record.legacyCreatedAt !== null
            && (!Number.isSafeInteger(record.legacyCreatedAt) || record.legacyCreatedAt < 0))
        || record.legacyCreatedAt !== (record.keyPair.createdAt ?? null)) {
        throw new Error('CORRUPT_COLLAB_IDENTITY_RECORD');
    }
    return {
        version: COLLAB_IDENTITY_RECORD_VERSION,
        value: record.keyPair,
        legacyCreatedAt: record.legacyCreatedAt,
    };
}

export function collabIdentityCurrentKey(keyId = COLLAB_IDENTITY_KEY_ID) {
    return `${keyId}:v${COLLAB_IDENTITY_RECORD_VERSION}`;
}

function _openIDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('COLLAB_IDENTITY_STORAGE_UNAVAILABLE'));
            return;
        }
        const req = indexedDB.open(COLLAB_IDENTITY_DB_NAME, 1);
        let blocked = false;
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(COLLAB_IDENTITY_STORE_NAME)) {
                db.createObjectStore(COLLAB_IDENTITY_STORE_NAME);
            }
        };
        req.onblocked = () => {
            blocked = true;
            reject(new Error('COLLAB_IDENTITY_DATABASE_BLOCKED'));
        };
        req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => db.close();
            if (blocked) {
                db.close();
                return;
            }
            resolve(db);
        };
        req.onerror = () => reject(req.error);
    });
}

async function _loadKeyPairFromIDB(keyId) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(COLLAB_IDENTITY_STORE_NAME, 'readonly');
        const store = tx.objectStore(COLLAB_IDENTITY_STORE_NAME);
        const legacyRequest = store.get(keyId);
        const currentRequest = store.get(collabIdentityCurrentKey(keyId));
        let legacyResult;
        let currentResult;
        let selected = null;
        let preparationError = null;
        let pending = 2;

        const prepare = () => {
            pending -= 1;
            if (pending !== 0) return;
            try {
                const legacy = legacyResult === undefined ? null : prepareCollabIdentityRecord(legacyResult);
                const current = currentResult === undefined ? null : prepareCollabIdentityRecord(currentResult);
                if (current && current.version !== COLLAB_IDENTITY_RECORD_VERSION) {
                    throw new Error('CORRUPT_COLLAB_IDENTITY_RECORD');
                }
                const legacyChanged = Boolean(current && legacy)
                    && current.legacyCreatedAt !== (legacy.value.createdAt ?? null);
                selected = legacyChanged ? legacy.value : (current?.value ?? legacy?.value ?? null);
            } catch (error) {
                preparationError = error;
                tx.abort();
            }
        };

        legacyRequest.onsuccess = () => { legacyResult = legacyRequest.result; prepare(); };
        currentRequest.onsuccess = () => { currentResult = currentRequest.result; prepare(); };
        legacyRequest.onerror = () => { preparationError = legacyRequest.error; };
        currentRequest.onerror = () => { preparationError = currentRequest.error; };
        tx.oncomplete = () => { db.close(); resolve(selected); };
        tx.onabort = () => { db.close(); reject(preparationError || tx.error || new Error('COLLAB_IDENTITY_READ_ABORTED')); };
        tx.onerror = () => {};
    });
}

async function _saveKeyPairToIDB(record, keyId) {
    if (!_validatePersistedKeyPair(record)) throw new Error('CORRUPT_COLLAB_IDENTITY_RECORD');
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(COLLAB_IDENTITY_STORE_NAME, 'readwrite');
        const store = tx.objectStore(COLLAB_IDENTITY_STORE_NAME);
        const legacyRequest = store.get(keyId);
        const currentKey = collabIdentityCurrentKey(keyId);
        const currentRequest = store.get(currentKey);
        let legacyResult;
        let currentResult;
        let preflightError = null;
        let pending = 2;

        const preflightAndWrite = () => {
            pending -= 1;
            if (pending !== 0) return;
            try {
                if (legacyResult !== undefined) prepareCollabIdentityRecord(legacyResult);
                if (currentResult !== undefined) {
                    const current = prepareCollabIdentityRecord(currentResult);
                    if (current.version !== COLLAB_IDENTITY_RECORD_VERSION) {
                        throw new Error('CORRUPT_COLLAB_IDENTITY_RECORD');
                    }
                }
                store.put(record, keyId);
                store.put({
                    schema: COLLAB_IDENTITY_RECORD_SCHEMA,
                    schemaVersion: COLLAB_IDENTITY_RECORD_VERSION,
                    keyPair: record,
                    legacyCreatedAt: record.createdAt ?? null,
                }, currentKey);
            } catch (error) {
                preflightError = error;
                tx.abort();
            }
        };

        legacyRequest.onsuccess = () => { legacyResult = legacyRequest.result; preflightAndWrite(); };
        currentRequest.onsuccess = () => { currentResult = currentRequest.result; preflightAndWrite(); };
        legacyRequest.onerror = () => { preflightError = legacyRequest.error; };
        currentRequest.onerror = () => { preflightError = currentRequest.error; };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(preflightError || tx.error || new Error('COLLAB_IDENTITY_WRITE_ABORTED')); };
        tx.onerror = () => {};
    });
}

// ─── Identity Creation ──────────────────────────────────────────────────────────────

/**
 * Generate or load an ECDSA P-256 key pair.
 * Tries IndexedDB first for persistent identity across sessions.
 * If not found, generates a new key pair and stores it.
 * The fingerprint (SHA-256 of public key) stays the same across sessions,
 * enabling long-term reputation tracking.
 * @returns {Promise<Object>} identity state
 */
export async function createIdentity(keyId = COLLAB_IDENTITY_KEY_ID, options = {}) {
    const keyIdReport = _textReport(keyId, COLLAB_IDENTITY_LIMITS.maxKeyIdBytes);
    if (!keyIdReport.valid) throw new TypeError(`invalid identity key ID: ${keyIdReport.reason}`);
    if (!subtle) {
        console.warn('[CollabIdentity] SubtleCrypto not available — identity disabled');
        return _createFallbackIdentity();
    }

    // Browser guests can explicitly request memory-only keys without probing or
    // modifying IndexedDB. Existing callers retain persisted identities.
    let persistenceWritable = options.persistent !== false;
    try {
        // Try loading persisted key pair from IndexedDB
        const stored = persistenceWritable ? await _loadKeyPairFromIDB(keyId) : null;
        if (stored && stored.publicKey && stored.privateKey) {
            const publicKeyRaw = new Uint8Array(await subtle.exportKey('raw', stored.publicKey));
            const fingerprint = await _computeFingerprint(publicKeyRaw);
            console.log('[CollabIdentity] Loaded persistent identity from IndexedDB');
            // Generate ephemeral ECDH key pair for this session (perfect forward secrecy)
            const ecdh = await _generateECDH();
            return {
                keyPair: { publicKey: stored.publicKey, privateKey: stored.privateKey },
                publicKey: stored.publicKey,
                privateKey: stored.privateKey,
                publicKeyRaw,
                fingerprint,
                ecdhKeyPair: ecdh?.keyPair || null,
                ecdhPublicKeyRaw: ecdh?.publicKeyRaw || new Uint8Array(0),
                _available: true,
                _persistent: true,
            };
        }
    } catch (err) {
        console.warn('[CollabIdentity] IndexedDB load failed, generating ephemeral identity:', err.message);
        persistenceWritable = false;
    }

    try {
        // Generate fresh key pair (non-extractable for IndexedDB storage)
        const keyPair = await subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            false, // non-extractable: private key stays in secure key store
            ['sign', 'verify']
        );

        // We need an extractable copy for publicKeyRaw export
        const publicKeyRaw = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
        const fingerprint = await _computeFingerprint(publicKeyRaw);

        const persistedRecord = {
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey,
            createdAt: Date.now(),
        };
        let persisted = false;
        if (persistenceWritable) {
            try {
                await _saveKeyPairToIDB(persistedRecord, keyId);
                persisted = true;
                console.log(`[CollabIdentity] Generated and persisted new identity (${keyId})`);
            } catch (error) {
                console.warn('[CollabIdentity] Identity persistence failed; using an ephemeral identity:', error.message);
            }
        }

        // Generate ephemeral ECDH key pair for this session
        const ecdh = await _generateECDH();
        return {
            keyPair,
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey,
            publicKeyRaw,
            fingerprint,
            ecdhKeyPair: ecdh?.keyPair || null,
            ecdhPublicKeyRaw: ecdh?.publicKeyRaw || new Uint8Array(0),
            _available: true,
            _persistent: persisted,
        };
    } catch (err) {
        console.warn('[CollabIdentity] Key generation failed:', err.message);
        return _createFallbackIdentity();
    }
}

/**
 * Fallback identity when SubtleCrypto is unavailable.
 * Uses a random fingerprint — no cryptographic guarantees, but allows
 * the system to function in insecure contexts (localhost dev, etc).
 */
function _createFallbackIdentity() {
    const bytes = new Uint8Array(8);
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (typeof cryptoApi?.getRandomValues === 'function') {
        cryptoApi.getRandomValues(bytes);
    } else {
        const seed = Date.now() + (++_fallbackIdentitySequence);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (seed >>> ((i % 4) * 8)) & 0xff;
    }
    const fingerprint = byteSignature(bytes);
    return {
        keyPair: null,
        publicKey: null,
        privateKey: null,
        publicKeyRaw: new Uint8Array(0),
        fingerprint,
        ecdhKeyPair: null,
        ecdhPublicKeyRaw: new Uint8Array(0),
        _available: false,
        _persistent: false,
    };
}

/**
 * Generate an ephemeral ECDH P-256 key pair for session encryption.
 * New key each session = perfect forward secrecy.
 */
async function _generateECDH() {
    try {
        const keyPair = await subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey', 'deriveBits']
        );
        const publicKeyRaw = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
        return { keyPair, publicKeyRaw };
    } catch (_) {
        return null;
    }
}

// ─── Fingerprinting ─────────────────────────────────────────────────────────

/**
 * Compute a 16-hex-char fingerprint from a raw public key.
 * @param {Uint8Array} publicKeyRaw - 65-byte raw ECDSA P-256 public key
 * @returns {Promise<string>} 16 hex chars
 */
async function _computeFingerprint(publicKeyRaw) {
    return (await contentHashHex(publicKeyRaw, 'SHA-256')).slice(0, 16);
}

/**
 * Compute fingerprint from a raw public key (public API for verification).
 * @param {Uint8Array|number[]} publicKeyRaw
 * @returns {Promise<string>} 16 hex chars
 */
export async function computeFingerprint(publicKeyRaw) {
    if (!subtle) return '';
    const report = _publicKeyReport(publicKeyRaw);
    return report.valid ? _computeFingerprint(report.bytes) : '';
}

// ─── Identity Proofs ────────────────────────────────────────────────────────

/**
 * Build an identity proof: sign our selfId with our private key.
 * The remote peer verifies this signature to confirm we own the public key.
 * @param {Object} identity - from createIdentity()
 * @param {string} selfId - our peer UUID
 * @returns {Promise<Uint8Array>} signature bytes (DER-encoded, ~70 bytes)
 */
export async function buildIdentityProof(identity, selfId) {
    const id = _textReport(selfId);
    if (!identity?._available || !id.valid) return new Uint8Array(0);
    const data = _encoder.encode(`identity-proof:${id.value}`);
    const sig = await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        identity.privateKey,
        data
    );
    return new Uint8Array(sig);
}

/**
 * Verify an identity proof from a remote peer.
 * @param {Uint8Array|number[]} publicKeyRaw - remote peer's raw public key (65 bytes)
 * @param {string} selfId - the selfId the remote peer claims
 * @param {Uint8Array|number[]} signature - the identity proof bytes
 * @returns {Promise<boolean>} true if the signature is valid
 */
export async function verifyIdentityProof(publicKeyRaw, selfId, signature) {
    if (!subtle) return false;
    try {
        const key = _publicKeyReport(publicKeyRaw);
        const sig = _signatureReport(signature);
        const id = _textReport(selfId);
        if (!key.valid || !sig.valid || !id.valid) return false;

        const importedKey = await subtle.importKey(
            'raw', key.bytes,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );
        const data = _encoder.encode(`identity-proof:${id.value}`);
        return subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            importedKey,
            sig.bytes,
            data
        );
    } catch (_) {
        return false;
    }
}

// ─── Score Receipts ─────────────────────────────────────────────────────────

export function collabIdentityScoreReceiptReport(scoreData, nowMs = Date.now()) {
    if (!scoreData || typeof scoreData !== 'object') {
        return { valid: false, reason: 'invalid-score-data' };
    }
    const selfId = _textReport(scoreData.selfId);
    const targetPeerId = _textReport(scoreData.targetPeerId);
    const score = finiteNumberReport(scoreData.score, { integer: true, min: 0, max: 1000 });
    const timestamp = collabIdentityTimestampReport(scoreData.timestamp, nowMs, {
        maxAgeMs: COLLAB_IDENTITY_LIMITS.maxReceiptAgeMs,
    });
    const valid = selfId.valid && targetPeerId.valid && score.valid && timestamp.valid;
    return {
        valid,
        selfId: selfId.value,
        targetPeerId: targetPeerId.value,
        score: score.value,
        timestamp: timestamp.timestamp,
        reason: valid ? 'valid' : (!selfId.valid ? 'invalid-reporter' : (!targetPeerId.valid ? 'invalid-target' : (!score.valid ? 'invalid-score' : timestamp.reason))),
    };
}

/**
 * Sign a reputation score receipt.
 * The receipt proves that this peer calculated and reported a specific score
 * for a target peer at a specific time. Other peers verify the signature
 * to prevent score tampering.
 *
 * @param {Object} identity - from createIdentity()
 * @param {Object} scoreData - { targetPeerId, score, timestamp, selfId }
 * @returns {Promise<Uint8Array>} signature bytes
 */
export async function signScoreReceipt(identity, scoreData) {
    const report = collabIdentityScoreReceiptReport(scoreData);
    if (!identity?._available || !report.valid) return new Uint8Array(0);
    const canonical = `score-receipt:${report.selfId}:${report.targetPeerId}:${report.score}:${report.timestamp}`;
    const data = _encoder.encode(canonical);
    const sig = await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        identity.privateKey,
        data
    );
    return new Uint8Array(sig);
}

/**
 * Verify a reputation score receipt from a remote peer.
 * @param {Uint8Array|number[]} publicKeyRaw - the reporter's raw public key
 * @param {Object} scoreData - { targetPeerId, score, timestamp, selfId }
 * @param {Uint8Array|number[]} signature
 * @returns {Promise<boolean>}
 */
export async function verifyScoreReceipt(publicKeyRaw, scoreData, signature, nowMs = Date.now()) {
    if (!subtle) return false;
    try {
        const key = _publicKeyReport(publicKeyRaw);
        const sig = _signatureReport(signature);
        const report = collabIdentityScoreReceiptReport(scoreData, nowMs);
        if (!key.valid || !sig.valid || !report.valid) return false;

        const importedKey = await subtle.importKey(
            'raw', key.bytes,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );
        const canonical = `score-receipt:${report.selfId}:${report.targetPeerId}:${report.score}:${report.timestamp}`;
        const data = _encoder.encode(canonical);
        return subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            importedKey,
            sig.bytes,
            data
        );
    } catch (_) {
        return false;
    }
}

// ─── Generic Data Signing ───────────────────────────────────────────────────

/**
 * Sign arbitrary string data with our identity.
 * @param {Object} identity
 * @param {string} data - string to sign
 * @returns {Promise<Uint8Array>}
 */
export async function signData(identity, data) {
    const text = _textReport(data, COLLAB_IDENTITY_LIMITS.maxSignedTextBytes, true);
    if (!identity?._available || !text.valid) return new Uint8Array(0);
    const bytes = _encoder.encode(text.value);
    const sig = await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        identity.privateKey,
        bytes
    );
    return new Uint8Array(sig);
}

/**
 * Sign raw bytes with our identity (no TextEncoder step) — needed when the
 * verifier expects a signature over an exact byte string it issued (e.g. a
 * random challenge), not over the UTF-8 encoding of some stringified form
 * of it. See signData() for the string-based counterpart.
 * @param {Object} identity
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function signRawBytes(identity, bytes) {
    const report = _bytesReport(bytes, { max: COLLAB_IDENTITY_LIMITS.maxSignedTextBytes });
    if (!identity?._available || !report.valid) return new Uint8Array(0);
    const sig = await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        identity.privateKey,
        report.bytes
    );
    return new Uint8Array(sig);
}

/**
 * Verify a signature on raw bytes. Counterpart to signRawBytes().
 * @param {Uint8Array|number[]} publicKeyRaw
 * @param {Uint8Array} bytes
 * @param {Uint8Array|number[]} signature
 * @returns {Promise<boolean>}
 */
export async function verifyRawBytes(publicKeyRaw, bytes, signature) {
    if (!subtle) return false;
    try {
        const key = _publicKeyReport(publicKeyRaw);
        const data = _bytesReport(bytes, { max: COLLAB_IDENTITY_LIMITS.maxSignedTextBytes });
        const sig = _signatureReport(signature);
        if (!key.valid || !data.valid || !sig.valid) return false;
        const importedKey = await subtle.importKey(
            'raw', key.bytes,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );
        return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, importedKey, sig.bytes, data.bytes);
    } catch (_) {
        return false;
    }
}

/**
 * Verify a signature on arbitrary string data.
 * @param {Uint8Array|number[]} publicKeyRaw
 * @param {string} data
 * @param {Uint8Array|number[]} signature
 * @returns {Promise<boolean>}
 */
export async function verifyData(publicKeyRaw, data, signature) {
    if (!subtle) return false;
    try {
        const key = _publicKeyReport(publicKeyRaw);
        const text = _textReport(data, COLLAB_IDENTITY_LIMITS.maxSignedTextBytes, true);
        const sig = _signatureReport(signature);
        if (!key.valid || !text.valid || !sig.valid) return false;

        const importedKey = await subtle.importKey(
            'raw', key.bytes,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );
        const bytes = _encoder.encode(text.value);
        return subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            importedKey,
            sig.bytes,
            bytes
        );
    } catch (_) {
        return false;
    }
}

// ─── Peer Identity Registry ─────────────────────────────────────────────────

function _registryClock(registry, timestampMs = Date.now()) {
    const previous = registry?._clockMs ?? 0;
    const step = runtimeMonotonicClockStep(timestampMs, previous);
    if (registry && !registry._destroyed) registry._clockMs = step.timestampMs;
    return step.timestampMs;
}

/**
 * Create a registry that tracks verified identities for all connected peers.
 * Each peer's identity is verified once during the hello handshake and then
 * cached. The registry also tracks cross-verified reputation scores.
 *
 * @param {string} selfId
 * @param {Object} identity - our identity from createIdentity()
 * @returns {Object} registry state
 */
export function createIdentityRegistry(selfId, identity) {
    const self = _textReport(selfId);
    return {
        selfId: self.valid ? self.value : '',
        identity,
        // peerId → { publicKeyRaw, fingerprint, verified, verifiedAt, isHost }
        _peers: new Map(),
        // peerId → Map<reporterPeerId, { score, timestamp, signature, verified }>
        _scoreReceipts: new Map(),
        // Expected host fingerprint (from invite code, null if we're the host)
        _expectedHostFingerprint: null,
        _registrationVersions: new Map(),
        _seenCriticalSignatures: new Map(),
        _pendingCriticalSignatures: new Set(),
        _disputedTargets: new Set(),
        _clockMs: 0,
        _destroyed: false,
        // Stats
        _stats: {
            identitiesVerified: 0,
            identitiesFailed: 0,
            receiptsVerified: 0,
            receiptsFailed: 0,
            scoreDisputes: 0,
            criticalReplaysRejected: 0,
            capacityRejected: 0,
        },
    };
}

/**
 * Register a peer's identity after verifying their proof.
 * Called during the enhanced hello handshake.
 *
 * @param {Object} registry
 * @param {string} peerId
 * @param {Uint8Array|number[]} publicKeyRaw - 65-byte raw ECDSA public key
 * @param {Uint8Array|number[]} identityProof - signature of peerId
 * @param {boolean} [isHost=false] - whether this peer is the host
 * @returns {Promise<{verified: boolean, fingerprint: string, hostMismatch: boolean}>}
 */
export async function registerPeerIdentity(registry, peerId, publicKeyRaw, identityProof, isHost = false) {
    const id = _textReport(peerId);
    const key = _publicKeyReport(publicKeyRaw);
    const proof = _signatureReport(identityProof);
    if (!registry || registry._destroyed || !id.valid || !key.valid || !proof.valid) {
        return { verified: false, fingerprint: '', hostMismatch: false, reason: 'invalid-identity-envelope' };
    }
    if (id.value === registry.selfId) {
        registry._stats.identitiesFailed++;
        return { verified: false, fingerprint: '', hostMismatch: false, reason: 'self-id-collision' };
    }
    const existing = registry._peers.get(id.value);
    if (existing?.verified && !_arraysEqual(existing.publicKeyRaw, key.bytes)) {
        registry._stats.identitiesFailed++;
        return { verified: false, fingerprint: '', hostMismatch: false, reason: 'identity-key-change' };
    }
    if (!existing && registry._peers.size >= COLLAB_IDENTITY_LIMITS.maxPeers) {
        registry._stats.capacityRejected++;
        return { verified: false, fingerprint: '', hostMismatch: false, reason: 'peer-capacity' };
    }
    const version = (registry._registrationVersions.get(id.value) || 0) + 1;
    registry._registrationVersions.set(id.value, version);
    const fingerprint = await computeFingerprint(key.bytes);

    // Verify the identity proof
    const proofVerified = await verifyIdentityProof(key.bytes, id.value, proof.bytes);
    if (registry._destroyed || registry._registrationVersions.get(id.value) !== version) {
        return { verified: false, fingerprint: '', hostMismatch: false, reason: 'stale-registration' };
    }

    // Check host fingerprint match (if we're a joiner and we expect a specific host)
    let hostMismatch = false;
    if (isHost && registry._expectedHostFingerprint && fingerprint) {
        hostMismatch = fingerprint !== registry._expectedHostFingerprint;
        if (hostMismatch) {
            console.warn(`[CollabIdentity] HOST FINGERPRINT MISMATCH! Expected: ${registry._expectedHostFingerprint}, got: ${fingerprint}`);
        }
    }
    const verified = proofVerified && !hostMismatch;
    if (verified) registry._stats.identitiesVerified++;
    else registry._stats.identitiesFailed++;

    registry._peers.set(id.value, {
        publicKeyRaw: key.bytes.slice(),
        fingerprint,
        verified,
        verifiedAt: verified ? _registryClock(registry) : null,
        isHost: !!isHost,
    });

    return { verified, fingerprint, hostMismatch, reason: verified ? 'verified' : (hostMismatch ? 'host-mismatch' : 'bad-proof') };
}

/**
 * Remove a peer's identity from the registry.
 */
export function removePeerIdentity(registry, peerId) {
    if (!registry || registry._destroyed) return false;
    registry._peers.delete(peerId);
    registry._scoreReceipts.delete(peerId);
    registry._registrationVersions.delete(peerId);
    registry._disputedTargets.delete(peerId);
    for (const [targetPeerId, receipts] of registry._scoreReceipts) {
        receipts.delete(peerId);
        if (receipts.size === 0) registry._scoreReceipts.delete(targetPeerId);
    }
    return true;
}

/**
 * Get a peer's verified identity info.
 * @returns {{ publicKeyRaw, fingerprint, verified, verifiedAt, isHost } | null}
 */
export function getPeerIdentity(registry, peerId) {
    const info = registry?._peers?.get(peerId);
    return info ? { ...info, publicKeyRaw: info.publicKeyRaw.slice() } : null;
}

/**
 * Set the expected host fingerprint (from the invite code).
 */
export function setExpectedHostFingerprint(registry, fingerprint) {
    if (!registry || registry._destroyed) return false;
    if (fingerprint === null || fingerprint === undefined || fingerprint === '') {
        registry._expectedHostFingerprint = null;
        return true;
    }
    if (typeof fingerprint !== 'string' || !/^[0-9a-f]{16}$/i.test(fingerprint)) return false;
    registry._expectedHostFingerprint = fingerprint.toLowerCase();
    return true;
}

export function resetIdentityRegistry(registry, options = {}) {
    if (!registry || registry._destroyed) return false;
    registry._peers.clear();
    registry._scoreReceipts.clear();
    registry._registrationVersions.clear();
    registry._seenCriticalSignatures.clear();
    registry._pendingCriticalSignatures.clear();
    registry._disputedTargets.clear();
    registry._clockMs = 0;
    for (const key of Object.keys(registry._stats)) registry._stats[key] = 0;
    if (!options.preserveExpectedHostFingerprint) registry._expectedHostFingerprint = null;
    return true;
}

export function destroyIdentityRegistry(registry) {
    if (!registry || registry._destroyed) return false;
    resetIdentityRegistry(registry);
    registry.identity = null;
    registry.selfId = '';
    registry._destroyed = true;
    return true;
}

// ─── Score Receipt Tracking ─────────────────────────────────────────────────

/**
 * Record a signed score receipt from a remote peer.
 * Each peer tracks what scores others have reported about them AND about other peers.
 *
 * @param {Object} registry
 * @param {string} reporterPeerId - who reported the score
 * @param {string} targetPeerId - who the score is about
 * @param {number} score - the score value (0-1000)
 * @param {number} timestamp
 * @param {Uint8Array|number[]} signature
 * @returns {Promise<boolean>} true if the receipt was verified
 */
export async function recordScoreReceipt(registry, reporterPeerId, targetPeerId, score, timestamp, signature) {
    if (!registry || registry._destroyed) return false;
    const now = _registryClock(registry);
    const report = collabIdentityScoreReceiptReport({
        selfId: reporterPeerId,
        targetPeerId,
        score,
        timestamp,
    }, now);
    const sig = _signatureReport(signature);
    if (!report.valid || !sig.valid) {
        registry._stats.receiptsFailed++;
        return false;
    }
    const reporter = registry._peers.get(reporterPeerId);
    if (!reporter || !reporter.verified || reporter.publicKeyRaw.length === 0) {
        registry._stats.receiptsFailed++;
        return false;
    }

    const scoreData = {
        selfId: report.selfId,
        targetPeerId: report.targetPeerId,
        score: report.score,
        timestamp: report.timestamp,
    };
    const verified = await verifyScoreReceipt(reporter.publicKeyRaw, scoreData, sig.bytes, now);

    if (!verified) {
        registry._stats.receiptsFailed++;
        return false;
    }

    // Store the receipt
    if (!registry._scoreReceipts.has(report.targetPeerId)) {
        if (registry._scoreReceipts.size >= COLLAB_IDENTITY_LIMITS.maxReceiptTargets) {
            registry._stats.capacityRejected++;
            return false;
        }
        registry._scoreReceipts.set(report.targetPeerId, new Map());
    }
    const targetReceipts = registry._scoreReceipts.get(report.targetPeerId);
    const previous = targetReceipts.get(report.selfId);
    if (previous && report.timestamp <= previous.timestamp) {
        registry._stats.receiptsFailed++;
        return false;
    }
    if (!previous && targetReceipts.size >= COLLAB_IDENTITY_LIMITS.maxReceiptsPerTarget) {
        registry._stats.capacityRejected++;
        return false;
    }
    targetReceipts.set(report.selfId, {
        score: report.score,
        timestamp: report.timestamp,
        signature: sig.bytes.slice(),
        verified: true,
    });
    registry._stats.receiptsVerified++;

    return true;
}

/**
 * Get the consensus score for a peer based on all verified receipts.
 * Returns the median of all verified scores reported by different peers.
 * Also detects disputes (significant score disagreements).
 *
 * @param {Object} registry
 * @param {string} peerId
 * @returns {{ consensusScore: number|null, reporters: number, dispute: boolean, scores: number[] }}
 */
export function getConsensusScore(registry, peerId) {
    const receipts = registry?._scoreReceipts?.get(peerId);
    if (!receipts || receipts.size === 0) {
        return { consensusScore: null, reporters: 0, dispute: false, scores: [] };
    }

    const scores = [];
    for (const [, receipt] of receipts) {
        if (receipt.verified) {
            scores.push(receipt.score);
        }
    }

    if (scores.length === 0) {
        return { consensusScore: null, reporters: 0, dispute: false, scores: [] };
    }

    scores.sort((a, b) => a - b);
    const median = statsMedian(scores);

    // Dispute detection: if any score differs by more than 200 from median
    const dispute = scores.some(s => Math.abs(s - median) > 200);
    if (dispute && !registry._disputedTargets.has(peerId)) {
        registry._stats.scoreDisputes++;
        registry._disputedTargets.add(peerId);
    } else if (!dispute) {
        registry._disputedTargets.delete(peerId);
    }

    return {
        consensusScore: median,
        reporters: scores.length,
        dispute,
        scores,
    };
}

// ─── Build Score Broadcast Op ───────────────────────────────────────────────

/**
 * Build a signed score report op for broadcasting to all peers.
 * @param {Object} identity - our identity
 * @param {string} selfId - our peer ID
 * @param {string} targetPeerId - who we're scoring
 * @param {number} score - 0-1000
 * @returns {Promise<Object>} op to broadcast
 */
export async function buildScoreReportOp(identity, selfId, targetPeerId, score) {
    const timestamp = Date.now();
    const scoreData = { selfId, targetPeerId, score, timestamp };
    const report = collabIdentityScoreReceiptReport(scoreData, timestamp);
    if (!identity?._available || !report.valid) return null;
    const signature = await signScoreReceipt(identity, scoreData);
    if (signature.length === 0) return null;

    return {
        type: '__score_report__',
        payload: {
            reporterId: report.selfId,
            targetPeerId: report.targetPeerId,
            score: report.score,
            timestamp: report.timestamp,
            signature: Array.from(signature),
            publicKey: Array.from(identity.publicKeyRaw),
        },
    };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

/**
 * Get identity system stats for UI display.
 * @param {Object} registry
 * @param {Map<string, number>} [reputationScores] - peerId → score (0-1000) for trust level calc
 */
export function getIdentityStats(registry, reputationScores) {
    if (!registry || registry._destroyed) {
        return {
            selfFingerprint: '', selfPersistent: false, expectedHostFingerprint: null,
            peers: [], stats: {},
        };
    }
    const peerIdentities = [];
    for (const [peerId, info] of registry._peers) {
        const consensus = getConsensusScore(registry, peerId);
        const repScore = reputationScores?.get(peerId) ?? null;
        const trustLevel = computeTrustLevel(registry, peerId, repScore);
        peerIdentities.push({
            peerId,
            fingerprint: info.fingerprint,
            verified: info.verified,
            isHost: info.isHost,
            consensusScore: consensus.consensusScore,
            reporters: consensus.reporters,
            dispute: consensus.dispute,
            trustLevel,
            trustColor: getTrustColor(trustLevel),
            trustLabel: getTrustLabel(trustLevel),
        });
    }

    return {
        selfFingerprint: registry.identity?.fingerprint || '',
        selfPersistent: registry.identity?._persistent || false,
        expectedHostFingerprint: registry._expectedHostFingerprint,
        peers: peerIdentities,
        stats: {
            ...registry._stats,
            signedOpsVerified: registry._stats.signedOpsVerified || 0,
            signedOpsRejected: registry._stats.signedOpsRejected || 0,
        },
    };
}

/**
 * Check if crypto identity is available.
 */
export function isIdentityAvailable() {
    return !!subtle;
}

// ─── Signed Critical Ops ────────────────────────────────────────────────────

// Op types that MUST be signed when identity is available.
// Unsigned critical ops from verified peers are rejected.
const CRITICAL_OP_TYPES = new Set([
    '__kick__',
    'entity_authority',
    'create',
    'delete',
    'host_election',
]);

/**
 * Check if an op type requires a signature.
 */
export function isCriticalOp(opType) {
    return CRITICAL_OP_TYPES.has(opType);
}

function _criticalEnvelopeReport(op) {
    const envelope = Object.create(null);
    const excluded = new Set(['_sig', '_pub', '_sigTs', '_sigV']);
    for (const key of Object.keys(op).sort()) {
        if (!excluded.has(key)) envelope[key] = op[key];
    }
    return collabIdentityPayloadReport(envelope);
}

export function collabIdentityCriticalOpReport(op, senderPeerId, nowMs = Date.now(), options = {}) {
    if (!op || typeof op !== 'object') return { valid: false, reason: 'invalid-op' };
    const type = _textReport(op.type, 128);
    const sender = _textReport(senderPeerId);
    const payload = collabIdentityPayloadReport(op.payload);
    const envelope = _criticalEnvelopeReport(op);
    const requireSignature = options.requireSignature !== false;
    const signature = requireSignature ? _signatureReport(op._sig) : { valid: true, bytes: new Uint8Array(0) };
    const publicKey = requireSignature ? _publicKeyReport(op._pub) : { valid: true, bytes: new Uint8Array(0) };
    const timestamp = requireSignature
        ? collabIdentityTimestampReport(op._sigTs, nowMs)
        : { valid: true, timestamp: op._sigTs ?? null, reason: 'valid' };
    const signatureVersion = op._sigV === undefined ? 1 : op._sigV;
    const version = finiteNumberReport(signatureVersion, { integer: true, min: 1, max: 2 });
    const valid = type.valid && isCriticalOp(type.value) && sender.valid && payload.valid && envelope.valid && version.valid
        && signature.valid && publicKey.valid && timestamp.valid;
    let reason = 'valid';
    if (!type.valid || !isCriticalOp(type.value)) reason = 'invalid-type';
    else if (!sender.valid) reason = 'invalid-sender';
    else if (!payload.valid) reason = payload.reason;
    else if (!envelope.valid) reason = envelope.reason;
    else if (!version.valid) reason = 'invalid-signature-version';
    else if (!signature.valid) reason = 'invalid-signature';
    else if (!publicKey.valid) reason = 'invalid-public-key';
    else if (!timestamp.valid) reason = timestamp.reason;
    return {
        valid,
        type: type.value,
        senderPeerId: sender.value,
        payloadCanonical: payload.canonical,
        envelopeCanonical: envelope.canonical,
        signatureVersion: version.value,
        signature: signature.bytes,
        publicKey: publicKey.bytes,
        timestamp: timestamp.timestamp,
        reason,
    };
}

/**
 * Sign a critical op with our ECDSA identity.
 * Appends `_sig` (signature) and `_pub` (public key) fields to the op.
 * The canonical signed data is: `op-sig:type:senderId:timestamp:payloadHash`
 *
 * @param {Object} identity - from createIdentity()
 * @param {Object} op - the op to sign (must have .type)
 * @param {string} selfId - our peer ID
 * @returns {Promise<Object>} the op with _sig and _pub fields added
 */
export async function signCriticalOp(identity, op, selfId) {
    const timestamp = Date.now();
    const report = collabIdentityCriticalOpReport(op, selfId, timestamp, { requireSignature: false });
    const publicKey = _publicKeyReport(identity?.publicKeyRaw);
    if (!identity?._available || !report.valid || !publicKey.valid) return op;

    // Hash the payload to keep the signed data small and canonical
    const envelopeHash = await collabIdentityPayloadHash(report.envelopeCanonical);
    const canonical = `op-sig-v2:${report.senderPeerId}:${timestamp}:${envelopeHash}`;
    const data = _encoder.encode(canonical);

    try {
        const sig = await subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            identity.privateKey,
            data
        );

        return {
            ...op,
            _sig: Array.from(new Uint8Array(sig)),
            _pub: Array.from(publicKey.bytes),
            _sigTs: timestamp,
            _sigV: 2,
        };
    } catch (_) {
        return op;
    }
}

/**
 * Verify a signed critical op from a remote peer.
 * @param {Object} op - the op with _sig, _pub, _sigTs fields
 * @param {string} senderPeerId - the claimed sender
 * @param {Object} [registry] - identity registry (for fingerprint cross-check)
 * @returns {Promise<{valid: boolean, reason: string}>}
 */
export async function verifyCriticalOp(op, senderPeerId, registry) {
    if (!subtle) return { valid: true, reason: 'no-crypto' };
    if (registry?._destroyed) return { valid: false, reason: 'destroyed-registry' };
    const now = registry ? _registryClock(registry) : runtimeMonotonicClockStep(Date.now(), 0).timestampMs;
    const report = collabIdentityCriticalOpReport(op, senderPeerId, now);
    if (!report.valid) return { valid: false, reason: report.reason };

    const peerInfo = registry?._peers?.get(report.senderPeerId) || null;
    if (registry && (!peerInfo || !peerInfo.verified)) {
        return { valid: false, reason: 'unverified-peer' };
    }
    if (peerInfo && !_arraysEqual(report.publicKey, peerInfo.publicKeyRaw)) {
        return { valid: false, reason: 'pubkey-mismatch' };
    }

    const replayToken = `${report.senderPeerId}:${byteSignature(report.signature)}`;
    if (registry) {
        for (const [token, acceptedAt] of registry._seenCriticalSignatures) {
            if (now - acceptedAt > COLLAB_IDENTITY_LIMITS.maxCriticalOpAgeMs) {
                registry._seenCriticalSignatures.delete(token);
            }
        }
        if (registry._seenCriticalSignatures.has(replayToken)
            || registry._pendingCriticalSignatures.has(replayToken)) {
            registry._stats.criticalReplaysRejected++;
            return { valid: false, reason: 'signature-replay' };
        }
        if (registry._pendingCriticalSignatures.size >= COLLAB_IDENTITY_LIMITS.maxSeenCriticalOps) {
            registry._stats.capacityRejected++;
            return { valid: false, reason: 'verification-capacity' };
        }
        registry._pendingCriticalSignatures.add(replayToken);
    }

    try {
        const key = await subtle.importKey(
            'raw', report.publicKey,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );

        // Reconstruct the canonical signed data
        const signedHash = report.signatureVersion === 2
            ? await collabIdentityPayloadHash(report.envelopeCanonical)
            : await collabIdentityPayloadHash(report.payloadCanonical);
        const canonical = report.signatureVersion === 2
            ? `op-sig-v2:${report.senderPeerId}:${report.timestamp}:${signedHash}`
            : `op-sig:${report.type}:${report.senderPeerId}:${report.timestamp}:${signedHash}`;
        const data = _encoder.encode(canonical);

        const valid = await subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key,
            report.signature,
            data
        );
        if (valid && registry) {
            registry._seenCriticalSignatures.set(replayToken, now);
            while (registry._seenCriticalSignatures.size > COLLAB_IDENTITY_LIMITS.maxSeenCriticalOps) {
                registry._seenCriticalSignatures.delete(registry._seenCriticalSignatures.keys().next().value);
            }
        }
        return { valid, reason: valid ? 'ok' : 'bad-signature' };
    } catch (_) {
        return { valid: false, reason: 'verify-error' };
    } finally {
        registry?._pendingCriticalSignatures?.delete(replayToken);
    }
}

/**
 * Helper: SHA-256 hash a string to hex (for canonical op signing).
 */
export async function collabIdentityPayloadHash(str) {
    const text = _textReport(String(str), COLLAB_IDENTITY_LIMITS.maxSignedTextBytes, true);
    return text.valid ? (await contentHashHex(text.value, 'SHA-256')).slice(0, 16) : '';
}

/**
 * Helper: compare two Uint8Arrays.
 */
function _arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// ─── Trust Levels ───────────────────────────────────────────────────────────

const TRUSTED_SCORE_THRESHOLD = 700;

/**
 * Compute the trust level for a peer.
 * @param {Object} registry - identity registry
 * @param {string} peerId
 * @param {number|null} reputationScore - from CollabPeerReputation (0-1000)
 * @returns {string} one of TRUST_LEVEL values
 */
export function computeTrustLevel(registry, peerId, reputationScore) {
    if (!registry || registry._destroyed) return TRUST_LEVEL.UNKNOWN;

    const peerInfo = registry._peers.get(peerId);
    if (!peerInfo) return TRUST_LEVEL.UNKNOWN;
    if (!peerInfo.verified) return TRUST_LEVEL.UNVERIFIED;
    const score = finiteNumberReport(reputationScore, { min: 0, max: 1000 });
    if (reputationScore != null && score.valid && score.value >= TRUSTED_SCORE_THRESHOLD) {
        return TRUST_LEVEL.TRUSTED;
    }
    return TRUST_LEVEL.VERIFIED;
}

/**
 * Get the display color for a trust level.
 */
export function getTrustColor(level) {
    switch (level) {
        case TRUST_LEVEL.TRUSTED:    return '#22c55e'; // green
        case TRUST_LEVEL.VERIFIED:   return '#6b8afd'; // blue
        case TRUST_LEVEL.UNVERIFIED: return '#f59e0b'; // amber
        default:                     return '#555';     // grey
    }
}

/**
 * Get the display label for a trust level.
 */
export function getTrustLabel(level) {
    switch (level) {
        case TRUST_LEVEL.TRUSTED:    return 'Trusted';
        case TRUST_LEVEL.VERIFIED:   return 'Verified';
        case TRUST_LEVEL.UNVERIFIED: return 'Unverified';
        default:                     return 'Unknown';
    }
}

// Audit gaps: legacy v1 critical signatures authenticate payloads but not complete operation envelopes.
// Freshness uses local wall time and an in-memory replay cache; there is no signed epoch/nonce or durable replay state.
// Score receipts are pairwise self-reports without quorum, Sybil resistance, revocation, or independently trusted observations.
// Persistent browser keys lack hardware attestation, automatic rotation/recovery, and captured cross-browser adversarial fixtures.
