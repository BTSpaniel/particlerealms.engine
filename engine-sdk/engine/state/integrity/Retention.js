// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/integrity/Retention.js — Integrity-plane encryption & retention manager
// (spec §13 "Privacy and deletion", rule 62).
//
// Append-only logs conflict with deletion requirements. The resolution: store
// sensitive payloads ENCRYPTED under a scoped key, leaving only minimal,
// non-sensitive audit metadata in the permanent record. Destroying the scope key
// renders the encrypted payload infeasible to recover — NIST "cryptographic
// erase" — so the audit trail survives while the sensitive bytes are
// irrecoverable. The cipher here is a deterministic keyed stream (model-grade,
// not production crypto): the point is the KEY-LIFECYCLE invariant, i.e. erase
// the key ⇒ payload unrecoverable, metadata retained.

import { hashIdFast } from '../util/canonical.js';
import { hashIdTailUint32 } from '../util/hashing.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % 256; };
}
const seedOf = (key) => hashIdTailUint32(hashIdFast(key));

/** Reversible keyed byte-stream transform over a string (XOR with PRNG stream). */
function streamXor(text, key) {
  const rnd = mulberry32(seedOf(key));
  let out = '';
  for (let i = 0; i < text.length; i++) out += String.fromCharCode(text.charCodeAt(i) ^ rnd());
  return out;
}

export class RetentionManager {
  constructor() {
    this._keys = new Map();   // scopeId → key material (deleting this = crypto-erase)
    this._erased = new Set();
    this._seq = 0;
  }

  /** Create a scope with fresh key material; returns the scope id. */
  createScope(scopeId, keyMaterial) {
    const id = String(scopeId);
    this._keys.set(id, keyMaterial ?? `key:${id}:${hashIdFast([id, ++this._seq])}`);
    return id;
  }

  hasKey(scopeId) { return this._keys.has(String(scopeId)) && !this._erased.has(String(scopeId)); }

  /**
   * Seal a sensitive payload under a scope. Returns an envelope carrying the
   * ciphertext plus NON-sensitive audit metadata that is always retained.
   * @returns {{ scopeId:string, ciphertext:string, audit:object, sealedAt:number }}
   */
  seal(scopeId, plaintext, audit = {}) {
    const id = String(scopeId);
    const key = this._keys.get(id);
    if (!key || this._erased.has(id)) throw new Error(`seal: scope ${id} has no live key`);
    return Object.freeze({
      scopeId: id,
      ciphertext: streamXor(String(plaintext), key),
      audit: Object.freeze({ ...audit }), // non-sensitive metadata kept forever
      sealedAt: ++this._seq,
    });
  }

  /** Open an envelope — returns plaintext, or null if the key was crypto-erased. */
  open(envelope) {
    const id = envelope?.scopeId;
    const key = this._keys.get(id);
    if (!key || this._erased.has(id)) return null; // key destroyed → unrecoverable
    return streamXor(envelope.ciphertext, key);
  }

  /**
   * Cryptographic erase: destroy a scope's key so every payload sealed under it
   * becomes irrecoverable, while audit metadata in already-issued envelopes (and
   * the permanent log) remains intact (rule 62).
   */
  cryptoErase(scopeId) {
    const id = String(scopeId);
    const existed = this._keys.delete(id);
    this._erased.add(id);
    return existed;
  }

  isErased(scopeId) { return this._erased.has(String(scopeId)); }
}
