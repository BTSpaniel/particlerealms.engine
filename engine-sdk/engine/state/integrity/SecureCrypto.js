// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/integrity/SecureCrypto.js — production-grade authenticated encryption
// (spec §13 privacy, §17 deterministic-core boundary).
//
// Real AEAD via Web Crypto AES-256-GCM. Used by SecureRetention for sensitive
// payloads so that destroying the key (cryptographic erase) renders ciphertext
// infeasible to recover, and any tampering with ciphertext/AAD fails the GCM
// authentication tag. This is the production swap-in for the model-grade keyed
// stream used elsewhere. All operations are async (SubtleCrypto); callers that
// need a sync path keep the deterministic fallback in RetentionManager.

import { byteSignature, hexToBytes as formatHexToBytes } from '../../core/math/FormatMath.js';

const subtle = globalThis.crypto?.subtle ?? null;

export function secureCryptoAvailable() { return !!subtle; }

export function bytesToHex(bytes) {
  return byteSignature(bytes);
}

export function hexToBytes(hex) {
  return formatHexToBytes(hex);
}

/** Generate a fresh AES-256-GCM key (extractable, for raw export/erase tests). */
export async function generateAesKey() {
  if (!subtle) throw new Error('SecureCrypto: SubtleCrypto unavailable');
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKeyRaw(key) { return new Uint8Array(await subtle.exportKey('raw', key)); }
export async function importAesKey(raw) {
  return subtle.importKey('raw', raw instanceof Uint8Array ? raw : hexToBytes(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

/**
 * AEAD-seal a plaintext string. `aad` (additional authenticated data) binds the
 * ciphertext to a context (e.g. the scope id) without encrypting it.
 * @returns {Promise<{iv:string, ciphertext:string}>}
 */
export async function aeadSeal(key, plaintext, aad = '') {
  if (!subtle) throw new Error('SecureCrypto: SubtleCrypto unavailable');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = new TextEncoder().encode(String(aad));
  const ct = new Uint8Array(await subtle.encrypt(params, key, new TextEncoder().encode(String(plaintext))));
  return { iv: bytesToHex(iv), ciphertext: bytesToHex(ct) };
}

/**
 * AEAD-open an envelope. Returns plaintext, or null if the key is wrong/erased
 * or the ciphertext/AAD was tampered with (GCM tag check fails).
 * @returns {Promise<string|null>}
 */
export async function aeadOpen(key, envelope, aad = '') {
  if (!subtle || !key || !envelope) return null;
  try {
    const params = { name: 'AES-GCM', iv: hexToBytes(envelope.iv) };
    if (aad) params.additionalData = new TextEncoder().encode(String(aad));
    const pt = await subtle.decrypt(params, key, hexToBytes(envelope.ciphertext));
    return new TextDecoder().decode(pt);
  } catch (_) {
    return null; // authentication failure or wrong/destroyed key
  }
}
