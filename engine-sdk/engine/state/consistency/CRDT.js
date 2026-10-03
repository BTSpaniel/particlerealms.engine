// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/consistency/CRDT.js — approved mergeable types (spec §4 "Mergeable
// state", rule 14/36).
//
// State-based CRDTs (CvRDTs): every type exposes a `merge(other)` that is a
// least-upper-bound join — associative, commutative, and idempotent — so
// replicas that exchange state in any order/any number of times converge to the
// same value WITHOUT coordination (CALM / coordination-avoidance). Each merge is
// non-mutating and returns a NEW instance so the join algebra is easy to test.
//
// IMPORTANT (rule 36): CRDT convergence is NOT proof of application validity. A
// CRDT may only be used for a value after `InvariantConfluence` confirms its
// operations preserve the relevant invariants. These types are the approved
// building blocks, not a license to make any value mergeable.

import { byteSignature } from '../../core/math/FormatMath.js';
import { canonicalize } from '../util/canonical.js';

let _orsetReplicaSequence = 0;

function _newORSetReplicaId() {
  const cryptoApi = globalThis.crypto;
  try {
    if (typeof cryptoApi?.randomUUID === 'function') {
      return `r${cryptoApi.randomUUID().replace(/-/g, '')}`;
    }
    if (typeof cryptoApi?.getRandomValues === 'function') {
      const bytes = new Uint8Array(12);
      cryptoApi.getRandomValues(bytes);
      return `r${byteSignature(bytes)}`;
    }
  } catch {
    // The deterministic fallback below still guarantees uniqueness in-process.
  }
  _orsetReplicaSequence += 1;
  return `r${Date.now().toString(36)}-${_orsetReplicaSequence.toString(36)}`;
}

// ── Grow-only counter ─────────────────────────────────────────────────────────
export class GCounter {
  /** @param {Object<string,number>} [state] per-node counts */
  constructor(state = {}) { this._c = { ...state }; }
  clone() { return new GCounter(this._c); }
  /** Increment this node's count (monotonic, n ≥ 0). */
  increment(node, n = 1) {
    if (n < 0) throw new RangeError('GCounter increments must be ≥ 0');
    const next = { ...this._c }; next[node] = (next[node] ?? 0) + n; return new GCounter(next);
  }
  value() { return Object.values(this._c).reduce((a, b) => a + b, 0); }
  /** Join: take the max observed count per node. */
  merge(other) {
    const out = { ...this._c };
    for (const [k, v] of Object.entries(other._c)) out[k] = Math.max(out[k] ?? 0, v);
    return new GCounter(out);
  }
  equals(other) { return canonicalize(this._c) === canonicalize(other._c); }
  state() { return { ...this._c }; }
}

// ── Positive-negative counter ───────────────────────────────────────────────
export class PNCounter {
  constructor(p = {}, n = {}) { this._p = new GCounter(p); this._n = new GCounter(n); }
  clone() { return new PNCounter(this._p.state(), this._n.state()); }
  increment(node, amt = 1) { const c = this.clone(); c._p = c._p.increment(node, amt); return c; }
  decrement(node, amt = 1) { const c = this.clone(); c._n = c._n.increment(node, amt); return c; }
  value() { return this._p.value() - this._n.value(); }
  merge(other) { return new PNCounter(this._p.merge(other._p).state(), this._n.merge(other._n).state()); }
  equals(other) { return this._p.equals(other._p) && this._n.equals(other._n); }
}

// ── Grow-only set ─────────────────────────────────────────────────────────────
export class GSet {
  constructor(iterable = []) { this._s = new Set(iterable); }
  clone() { return new GSet(this._s); }
  add(el) { const s = new Set(this._s); s.add(el); return new GSet(s); }
  has(el) { return this._s.has(el); }
  value() { return [...this._s].sort(); }
  merge(other) { return new GSet([...this._s, ...other._s]); }
  equals(other) { return canonicalize(this.value()) === canonicalize(other.value()); }
}

// ── Observed-remove set (add-wins) ────────────────────────────────────────────
// Each add stamps the element with a unique tag; remove records the tags it
// observed. An element is present iff it has at least one add-tag not yet
// removed. Concurrent add+remove resolves add-wins (the concurrent add carries a
// tag the remove never saw), which is the standard OR-Set semantics.
export class ORSet {
  /** @param {Map<string,Set<string>>} [adds] el→tags  @param {Set<string>} [removes] */
  constructor(adds = new Map(), removes = new Set()) {
    this._adds = new Map([...adds].map(([k, v]) => [k, new Set(v)]));
    this._removes = new Set(removes);
    this._replicaId = _newORSetReplicaId();
    this._seq = 0;
  }
  clone() { return new ORSet(this._adds, this._removes); }
  /** Add an element with a unique tag (auto-generated if omitted). */
  add(el, tag) {
    const c = this.clone();
    const t = tag ?? `${el}:${c._replicaId}:${c._seq++}`;
    const tags = c._adds.get(el) ?? new Set();
    tags.add(t); c._adds.set(el, tags);
    return c;
  }
  /** Remove an element by tombstoning every tag currently observed for it. */
  remove(el) {
    const c = this.clone();
    const tags = c._adds.get(el);
    if (tags) for (const t of tags) c._removes.add(t);
    return c;
  }
  has(el) {
    const tags = this._adds.get(el);
    if (!tags) return false;
    for (const t of tags) if (!this._removes.has(t)) return true;
    return false;
  }
  value() { return [...this._adds.keys()].filter((el) => this.has(el)).sort(); }
  /** Join: union add-tags per element and union the remove-tombstones. */
  merge(other) {
    const adds = new Map();
    for (const [el, tags] of this._adds) adds.set(el, new Set(tags));
    for (const [el, tags] of other._adds) {
      const cur = adds.get(el) ?? new Set(); for (const t of tags) cur.add(t); adds.set(el, cur);
    }
    return new ORSet(adds, new Set([...this._removes, ...other._removes]));
  }
  equals(other) { return canonicalize(this.value()) === canonicalize(other.value()); }
}

// ── Last-writer-wins register ─────────────────────────────────────────────────
// Conflicts resolve by (timestamp, node) — higher timestamp wins, node id breaks
// ties deterministically so all replicas pick the same winner.
export class LWWRegister {
  constructor(value = null, ts = 0, node = '') { this._v = value; this._ts = ts; this._node = node; }
  clone() { return new LWWRegister(this._v, this._ts, this._node); }
  set(value, ts, node = '') { return new LWWRegister(value, ts, node); }
  value() { return this._v; }
  timestamp() { return this._ts; }
  merge(other) {
    if (other._ts > this._ts) return other.clone();
    if (other._ts < this._ts) return this.clone();
    return String(other._node) > String(this._node) ? other.clone() : this.clone(); // tie-break
  }
  equals(other) { return this._v === other._v && this._ts === other._ts && this._node === other._node; }
}
