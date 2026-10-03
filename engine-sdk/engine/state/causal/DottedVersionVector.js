// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/causal/DottedVersionVector.js — precise concurrent-version causality
// (spec §9 "Causal time", rule 8/9).
//
// A VersionVector summarizes "what I have seen" per node and gives a partial
// order: equal / before / after / concurrent. Dotted version vectors (Preguiça
// et al.) add the ability to track each write as an isolated event (a "dot") so
// concurrent writes are kept as explicit SIBLINGS instead of being silently lost
// or forcing per-client metadata to grow without bound. This is the causality
// backbone the Causal Plane uses to decide when order is genuinely required.

export const ORDER = Object.freeze({ EQUAL: 'equal', BEFORE: 'before', AFTER: 'after', CONCURRENT: 'concurrent' });

export class VersionVector {
  /** @param {Object<string,number>} [state] node→counter */
  constructor(state = {}) { this._v = { ...state }; }
  clone() { return new VersionVector(this._v); }
  get(node) { return this._v[node] ?? 0; }
  state() { return { ...this._v }; }
  /** Record a local event for `node`, returning a new vector. */
  increment(node) { const v = { ...this._v }; v[node] = (v[node] ?? 0) + 1; return new VersionVector(v); }
  /** Join: max per node (everything either side has seen). */
  merge(other) {
    const v = { ...this._v };
    for (const [k, c] of Object.entries(other._v)) v[k] = Math.max(v[k] ?? 0, c);
    return new VersionVector(v);
  }
  /** True if this vector dominates (has seen everything in) `other`. */
  descends(other) {
    for (const [k, c] of Object.entries(other._v)) if ((this._v[k] ?? 0) < c) return false;
    return true;
  }
  /** Partial-order comparison against another vector. */
  compare(other) {
    const a = this.descends(other);
    const b = other.descends(this);
    if (a && b) return ORDER.EQUAL;
    if (a) return ORDER.AFTER;
    if (b) return ORDER.BEFORE;
    return ORDER.CONCURRENT;
  }
  concurrentWith(other) { return this.compare(other) === ORDER.CONCURRENT; }
}

/**
 * A dotted-version-vector set for ONE logical key: stores the current value(s)
 * plus the causal history at which each was written. Concurrent writes survive
 * as siblings; a write that causally dominates a value replaces it.
 */
export class DVVSet {
  constructor() {
    this._values = []; // [{ value, vv:VersionVector }]
  }

  /** Read all current sibling values + the causal context to write back with. */
  read() {
    let ctx = new VersionVector();
    for (const e of this._values) ctx = ctx.merge(e.vv);
    return { values: this._values.map((e) => e.value), context: ctx };
  }

  /** Number of concurrent siblings currently held (1 = no conflict). */
  get siblingCount() { return this._values.length; }

  /**
   * Write `value` on behalf of `node`, having observed `context`. Values the
   * writer's context dominates are causally superseded and dropped; values
   * concurrent with the context are retained as siblings.
   * @param {*} value
   * @param {VersionVector} [context] what the writer last read (default empty)
   * @param {string} node
   */
  update(value, context = new VersionVector(), node) {
    if (!node) throw new TypeError('DVVSet.update requires a node id');
    // Highest counter seen for this node across all siblings + the context.
    let maxForNode = context.get(node);
    for (const e of this._values) maxForNode = Math.max(maxForNode, e.vv.get(node));
    const newVV = context.merge(new VersionVector({ [node]: maxForNode + 1 }));
    // Keep only siblings the writer did NOT causally cover (true concurrency).
    const kept = this._values.filter((e) => !context.descends(e.vv));
    kept.push({ value, vv: newVV });
    this._values = kept;
    return this;
  }
}
