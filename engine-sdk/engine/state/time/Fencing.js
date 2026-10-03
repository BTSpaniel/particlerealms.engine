// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/time/Fencing.js — monotonic fencing tokens (spec §9, rule 12).
//
// A lease optimizes liveness; it is NOT final authority. A paused client may
// resume after its lease expired. Correctness-critical resources therefore
// require a monotonically increasing fencing token that the PROTECTED RESOURCE
// itself verifies: a stale token can never mutate protected state (safety
// invariant, spec §19). Each commit domain issues strictly increasing tokens;
// the domain rejects any token <= the last one it accepted.

export class FencingDomain {
  constructor(name = 'default') {
    this.name = String(name);
    this._next = 1;        // next token to issue
    this._accepted = 0;    // highest token the resource has accepted
  }

  /** Issue the next strictly-increasing fencing token. */
  issue() { return this._next++; }

  /** The highest token accepted by the protected resource so far. */
  get accepted() { return this._accepted; }

  /**
   * Validate a token against the protected resource WITHOUT accepting it.
   * @returns {{ ok:boolean, reason:string|null }}
   */
  check(token) {
    const t = Number(token);
    if (!Number.isFinite(t)) return { ok: false, reason: 'invalid-token' };
    if (t <= this._accepted) return { ok: false, reason: 'stale-fencing-token' };
    return { ok: true, reason: null };
  }

  /** Accept a token (called only after a successful commit). Monotonic. */
  accept(token) {
    const verdict = this.check(token);
    if (!verdict.ok) return verdict;
    this._accepted = Number(token);
    return { ok: true, reason: null };
  }
}
