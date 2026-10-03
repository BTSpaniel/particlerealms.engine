// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/integrity/SecureRetention.js — production AES-256-GCM retention manager
// (spec §13, rule 62). The cryptographic counterpart of RetentionManager.
//
// Sensitive payloads are sealed under a per-scope AES-GCM key held only in
// memory as a non-extractable-by-policy CryptoKey reference. Cryptographic erase
// drops that reference, after which the ciphertext is infeasible to recover
// (NIST crypto-erase), while non-sensitive audit metadata on the envelope
// survives. GCM's authentication tag also makes any tampering with the
// ciphertext or the scope-bound AAD fail closed (open → null).

import { secureCryptoAvailable, generateAesKey, aeadSeal, aeadOpen } from './SecureCrypto.js';

export class SecureRetentionManager {
  constructor() {
    this._keys = new Map();   // scopeId → CryptoKey (dropping it = crypto-erase)
    this._erased = new Set();
    this._seq = 0;
    this.secure = secureCryptoAvailable();
  }

  /** Create a scope backed by a fresh AES-256-GCM key. */
  async createScope(scopeId) {
    if (!this.secure) throw new Error('SecureRetention: WebCrypto unavailable (use RetentionManager fallback)');
    const id = String(scopeId);
    this._keys.set(id, await generateAesKey());
    this._erased.delete(id);
    return id;
  }

  hasKey(scopeId) { return this._keys.has(String(scopeId)) && !this._erased.has(String(scopeId)); }
  isErased(scopeId) { return this._erased.has(String(scopeId)); }

  /**
   * AEAD-seal a payload under a scope. The scope id is the AAD, binding the
   * ciphertext to its scope. Audit metadata is retained in the clear.
   * @returns {Promise<{scopeId:string, iv:string, ciphertext:string, audit:object, sealedAt:number}>}
   */
  async seal(scopeId, plaintext, audit = {}) {
    const id = String(scopeId);
    const key = this._keys.get(id);
    if (!key || this._erased.has(id)) throw new Error(`seal: scope ${id} has no live key`);
    const { iv, ciphertext } = await aeadSeal(key, plaintext, id);
    return Object.freeze({ scopeId: id, iv, ciphertext, audit: Object.freeze({ ...audit }), sealedAt: ++this._seq });
  }

  /** AEAD-open an envelope; null if key erased or ciphertext/AAD tampered. */
  async open(envelope) {
    const key = this._keys.get(envelope?.scopeId);
    if (!key || this._erased.has(envelope?.scopeId)) return null;
    return aeadOpen(key, envelope, envelope.scopeId);
  }

  /** Cryptographic erase: drop the scope key; ciphertext becomes unrecoverable. */
  cryptoErase(scopeId) {
    const id = String(scopeId);
    const existed = this._keys.delete(id);
    this._erased.add(id);
    return existed;
  }
}
