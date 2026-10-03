// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// RFC 9180 base mode: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256,
// AES-128-GCM or AES-256-GCM. Signaling uses a fresh encapsulation for every
// message, so the AEAD sequence number is always zero and the base nonce is
// used directly. Existing callers remain on AES-128-GCM unless they opt into
// the exported AES-256 suite.

const KEM_ID = 0x0010;
const KDF_ID = 0x0001;
const AEAD_AES_128_GCM_ID = 0x0001;
const AEAD_AES_256_GCM_ID = 0x0002;
const VERSION = new TextEncoder().encode('HPKE-v1');
const KEM_SUITE_ID = concat(new TextEncoder().encode('KEM'), i2osp(KEM_ID, 2));

export const HPKE_AES_128_GCM = 'AES-128-GCM';
export const HPKE_AES_256_GCM = 'AES-256-GCM';

function aeadSuite(name = HPKE_AES_128_GCM) {
    if (name === HPKE_AES_128_GCM) return { id: AEAD_AES_128_GCM_ID, keyLength: 16 };
    if (name === HPKE_AES_256_GCM) return { id: AEAD_AES_256_GCM_ID, keyLength: 32 };
    throw new RangeError('unsupported HPKE AEAD suite');
}

function hpkeSuiteId(aeadId) {
    return concat(
        new TextEncoder().encode('HPKE'),
        i2osp(KEM_ID, 2), i2osp(KDF_ID, 2), i2osp(aeadId, 2),
    );
}

function bytes(value, name = 'bytes') {
    if (value instanceof Uint8Array) return value.slice();
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    throw new TypeError(`${name} must be binary data`);
}

function concat(...parts) {
    const normalized = parts.map((part) => bytes(part));
    const output = new Uint8Array(normalized.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of normalized) { output.set(part, offset); offset += part.length; }
    return output;
}

function i2osp(value, length) {
    const output = new Uint8Array(length);
    let remaining = value;
    for (let index = length - 1; index >= 0; index--) {
        output[index] = remaining & 0xff;
        remaining = Math.floor(remaining / 256);
    }
    if (remaining !== 0) throw new RangeError('integer does not fit output length');
    return output;
}

function hexToBytes(value, expectedLength = null) {
    if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
        throw new TypeError('hex value is malformed');
    }
    const output = new Uint8Array(value.length / 2);
    for (let i = 0; i < output.length; i++) output[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
    if (expectedLength !== null && output.length !== expectedLength) throw new RangeError(`hex value must encode ${expectedLength} bytes`);
    return output;
}

function bytesToHex(value) {
    return [...bytes(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmac(keyBytes, data, cryptoImpl) {
    const key = await cryptoImpl.subtle.importKey('raw', bytes(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await cryptoImpl.subtle.sign('HMAC', key, bytes(data)));
}

async function extract(salt, ikm, cryptoImpl) {
    const normalizedSalt = bytes(salt);
    return hmac(normalizedSalt.length ? normalizedSalt : new Uint8Array(32), ikm, cryptoImpl);
}

async function expand(prk, info, length, cryptoImpl) {
    const blocks = [];
    let previous = new Uint8Array();
    for (let counter = 1; blocks.reduce((sum, block) => sum + block.length, 0) < length; counter++) {
        previous = await hmac(prk, concat(previous, info, Uint8Array.of(counter)), cryptoImpl);
        blocks.push(previous);
    }
    return concat(...blocks).slice(0, length);
}

async function labeledExtract(salt, suiteId, label, ikm, cryptoImpl) {
    return extract(salt, concat(VERSION, suiteId, new TextEncoder().encode(label), ikm), cryptoImpl);
}

async function labeledExpand(prk, suiteId, label, info, length, cryptoImpl) {
    return expand(prk, concat(i2osp(length, 2), VERSION, suiteId, new TextEncoder().encode(label), info), length, cryptoImpl);
}

async function dhkemSharedSecret(dh, enc, recipientPublicRaw, cryptoImpl) {
    const context = concat(enc, recipientPublicRaw);
    const eaePrk = await labeledExtract(new Uint8Array(), KEM_SUITE_ID, 'eae_prk', dh, cryptoImpl);
    return labeledExpand(eaePrk, KEM_SUITE_ID, 'shared_secret', context, 32, cryptoImpl);
}

async function keySchedule(sharedSecret, info, suite, cryptoImpl) {
    const empty = new Uint8Array();
    const suiteId = hpkeSuiteId(suite.id);
    const pskIdHash = await labeledExtract(empty, suiteId, 'psk_id_hash', empty, cryptoImpl);
    const infoHash = await labeledExtract(empty, suiteId, 'info_hash', info, cryptoImpl);
    const context = concat(Uint8Array.of(0), pskIdHash, infoHash);
    const secret = await labeledExtract(sharedSecret, suiteId, 'secret', empty, cryptoImpl);
    return {
        key: await labeledExpand(secret, suiteId, 'key', context, suite.keyLength, cryptoImpl),
        nonce: await labeledExpand(secret, suiteId, 'base_nonce', context, 12, cryptoImpl),
    };
}

async function importPublic(raw, cryptoImpl) {
    const normalized = bytes(raw, 'P-256 public key');
    if (normalized.length !== 65 || normalized[0] !== 4) throw new RangeError('P-256 public key must be an uncompressed 65-byte point');
    return cryptoImpl.subtle.importKey('raw', normalized, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

export async function generateHpkeKeyPair({ cryptoImpl = globalThis.crypto } = {}) {
    if (!cryptoImpl?.subtle) throw new Error('WebCrypto is unavailable');
    const keyPair = await cryptoImpl.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKeyRaw = new Uint8Array(await cryptoImpl.subtle.exportKey('raw', keyPair.publicKey));
    return { ...keyPair, publicKeyRaw, publicKeyHex: bytesToHex(publicKeyRaw) };
}

export async function hpkeSeal(recipientPublicKeyHex, plaintext, options = {}) {
    const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
    if (!cryptoImpl?.subtle) throw new Error('WebCrypto is unavailable');
    const suite = aeadSuite(options.aead);
    const recipientPublicRaw = hexToBytes(recipientPublicKeyHex, 65);
    const recipientPublic = await importPublic(recipientPublicRaw, cryptoImpl);
    const ephemeral = await generateHpkeKeyPair({ cryptoImpl });
    const dh = new Uint8Array(await cryptoImpl.subtle.deriveBits(
        { name: 'ECDH', public: recipientPublic }, ephemeral.privateKey, 256,
    ));
    const sharedSecret = await dhkemSharedSecret(dh, ephemeral.publicKeyRaw, recipientPublicRaw, cryptoImpl);
    const info = bytes(options.info ?? new TextEncoder().encode('particle-signal/2'));
    const aad = bytes(options.aad ?? new Uint8Array());
    const schedule = await keySchedule(sharedSecret, info, suite, cryptoImpl);
    const key = await cryptoImpl.subtle.importKey('raw', schedule.key, { name: 'AES-GCM' }, false, ['encrypt']);
    const ciphertext = new Uint8Array(await cryptoImpl.subtle.encrypt(
        { name: 'AES-GCM', iv: schedule.nonce, additionalData: aad, tagLength: 128 }, key, bytes(plaintext),
    ));
    return { encHex: ephemeral.publicKeyHex, ciphertextHex: bytesToHex(ciphertext) };
}

export async function hpkeOpen(recipientPrivateKey, encHex, ciphertextHex, options = {}) {
    const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
    if (!cryptoImpl?.subtle) throw new Error('WebCrypto is unavailable');
    const suite = aeadSuite(options.aead);
    const enc = hexToBytes(encHex, 65);
    const ephemeralPublic = await importPublic(enc, cryptoImpl);
    const recipientPublic = await cryptoImpl.subtle.exportKey('raw', options.recipientPublicKey);
    const dh = new Uint8Array(await cryptoImpl.subtle.deriveBits(
        { name: 'ECDH', public: ephemeralPublic }, recipientPrivateKey, 256,
    ));
    const sharedSecret = await dhkemSharedSecret(dh, enc, new Uint8Array(recipientPublic), cryptoImpl);
    const info = bytes(options.info ?? new TextEncoder().encode('particle-signal/2'));
    const aad = bytes(options.aad ?? new Uint8Array());
    const schedule = await keySchedule(sharedSecret, info, suite, cryptoImpl);
    const key = await cryptoImpl.subtle.importKey('raw', schedule.key, { name: 'AES-GCM' }, false, ['decrypt']);
    return new Uint8Array(await cryptoImpl.subtle.decrypt(
        { name: 'AES-GCM', iv: schedule.nonce, additionalData: aad, tagLength: 128 }, key, hexToBytes(ciphertextHex),
    ));
}

/** RFC 9180 base mode using DHKEM(P-256), HKDF-SHA256, and AES-256-GCM. */
export function hpkeSealAes256(recipientPublicKeyHex, plaintext, options = {}) {
    return hpkeSeal(recipientPublicKeyHex, plaintext, { ...options, aead: HPKE_AES_256_GCM });
}

/** Open an AES-256-GCM RFC 9180 base-mode encapsulation. */
export function hpkeOpenAes256(recipientPrivateKey, encHex, ciphertextHex, options = {}) {
    return hpkeOpen(recipientPrivateKey, encHex, ciphertextHex, { ...options, aead: HPKE_AES_256_GCM });
}

export { bytesToHex as hpkeBytesToHex, hexToBytes as hpkeHexToBytes };
