// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/facts/FactStore.js — the unordered, monotonic fact set.
//
// No sequence is stored. `id()` is the order-independent hash of ALL facts
// (history identity); `liveId()` is the hash of the currently-valid projection
// (tombstones applied). Merge is a set union — naturally commutative and
// idempotent (a CRDT-style anti-entropy merge), so two peers that saw events in
// different orders converge to the same id.

import { revoke, isTombstone } from './Fact.js';
import { canonicalSetHash } from '../util/hashing.js';

export class FactStore {
  constructor(initial = []) {
    this._set = new Set();
    for (const f of initial) this._set.add(f);
  }

  /** Add a fact (monotonic — never removes). Returns this. */
  add(f) { this._set.add(f); return this; }

  /** Revoke a fact by adding its tombstone (never deletes). Returns this. */
  revoke(f) { this._set.add(revoke(f)); return this; }

  /** Raw membership (includes tombstones). */
  has(f) { return this._set.has(f); }

  /** All raw facts including tombstones (canonical history). */
  rawFacts() { return new Set(this._set); }

  /** Currently-valid facts: non-tombstone facts whose tombstone is absent. */
  live() {
    const out = new Set();
    for (const f of this._set) {
      if (isTombstone(f)) continue;
      if (this._set.has(revoke(f))) continue;
      out.add(f);
    }
    return out;
  }

  /** State id = order-independent hash of the full canonical fact set. */
  id() { return canonicalSetHash(this._set); }

  /** Projection id = hash of the live (valid) facts only. */
  liveId() { return canonicalSetHash(this.live()); }

  /** Deep copy. */
  clone() { const s = new FactStore(); for (const f of this._set) s._set.add(f); return s; }

  /** Commutative, idempotent union merge (anti-entropy). Returns this. */
  merge(other) {
    const src = other instanceof FactStore ? other._set : other;
    for (const f of src) this._set.add(f);
    return this;
  }

  get size() { return this._set.size; }
}
