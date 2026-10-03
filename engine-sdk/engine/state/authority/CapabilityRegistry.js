// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/authority/CapabilityRegistry.js — registry + revocation (spec §6,§12).
//
// Holds issued capabilities and a revocation set. A revoked critical capability
// can never commit (safety invariant, spec §19). Revocation-sensitive
// capabilities require an online status check at commit, so the coordinator
// asks the registry — not a cached plan — whether a capability is still valid.

import { authorizes } from './Capability.js';

export class CapabilityRegistry {
  constructor() {
    this._caps = new Map();      // id → capability
    this._revoked = new Set();   // revoked capability ids
    this._consumed = new Set();  // single-use caps already spent
  }

  /** Issue (store) a capability. Returns its id. */
  issue(cap) {
    if (!cap?.id) throw new TypeError('CapabilityRegistry.issue: missing capability id');
    this._caps.set(cap.id, cap);
    return cap.id;
  }

  /** Look up a capability by id, or null. */
  get(id) { return this._caps.get(String(id)) ?? null; }

  /** Revoke a capability (online status — checked at commit). */
  revoke(id) { this._revoked.add(String(id)); return this; }

  isRevoked(id) { return this._revoked.has(String(id)); }
  isConsumed(id) { return this._consumed.has(String(id)); }

  /**
   * Authorize a request against a stored capability id, applying revocation and
   * single-use checks. Does NOT consume — the coordinator consumes only after a
   * successful atomic commit (single-use caps are USOs).
   * @returns {{ ok:boolean, reason:string|null, cap:object|null }}
   */
  check(id, request) {
    const cap = this.get(id);
    if (!cap) return { ok: false, reason: 'unknown-capability', cap: null };
    if (this._revoked.has(cap.id)) return { ok: false, reason: 'revoked', cap };
    if (cap.singleUse && this._consumed.has(cap.id)) return { ok: false, reason: 'already-consumed', cap };
    const verdict = authorizes(cap, request);
    return { ok: verdict.ok, reason: verdict.reason, cap: verdict.ok ? cap : null };
  }

  /** Mark a single-use capability consumed (called by coordinator post-commit). */
  consume(id) { this._consumed.add(String(id)); return this; }

  get size() { return this._caps.size; }
}
