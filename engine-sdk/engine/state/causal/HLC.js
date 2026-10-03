// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/causal/HLC.js — Hybrid Logical Clock (spec §9 "Operational time",
// rule 11).
//
// An HLC (Kulkarni et al.) combines a logical clock's causal guarantees with a
// timestamp that stays close to physical time. Each timestamp is (l, c): `l`
// tracks the max physical time observed, `c` is a bounded counter that breaks
// ties when events share the same `l`. HLC gives a total order consistent with
// causality (if A → B then ts(A) < ts(B)) while remaining readable as wall time.
//
// IMPORTANT (rule 11): a timestamp NEVER establishes authority, ownership, or
// uniqueness on its own — HLC orders events; the commit protocol decides truth.

/** Compare two HLC timestamps {l,c}. Returns -1, 0, or 1. */
export function compareHLC(a, b) {
  if (a.l !== b.l) return a.l < b.l ? -1 : 1;
  if (a.c !== b.c) return a.c < b.c ? -1 : 1;
  return 0;
}

export class HLC {
  /**
   * @param {() => number} [physicalNow] monotonic-ish wall clock (ms). Injectable
   *        for deterministic tests.
   */
  constructor(physicalNow = () => Date.now()) {
    this._now = physicalNow;
    this._l = 0; // last logical time (physical component)
    this._c = 0; // counter
  }

  /** Current timestamp without advancing. */
  peek() { return { l: this._l, c: this._c }; }

  /**
   * Generate a timestamp for a LOCAL event (send / new commit). Ensures
   * monotonicity even if the physical clock has not advanced.
   */
  now() {
    const pt = this._now();
    const lPrev = this._l;
    this._l = Math.max(lPrev, pt);
    this._c = this._l === lPrev ? this._c + 1 : 0;
    return this.peek();
  }

  /**
   * Update on RECEIVING a remote timestamp, merging causal information so the
   * local clock never goes backwards relative to a cause.
   * @param {{l:number, c:number}} remote
   */
  update(remote) {
    const pt = this._now();
    const lPrev = this._l;
    this._l = Math.max(lPrev, remote.l, pt);
    if (this._l === lPrev && this._l === remote.l) this._c = Math.max(this._c, remote.c) + 1;
    else if (this._l === lPrev) this._c = this._c + 1;
    else if (this._l === remote.l) this._c = remote.c + 1;
    else this._c = 0;
    return this.peek();
  }
}
