// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/integrity/GarbageCollector.js — Integrity-plane garbage collection
// (spec §3 plane 8, rule 61; liveness "GC never removes pinned authoritative
// state").
//
// GC reclaims storage by collecting objects that are no longer reachable from a
// set of SIGNED ROOTS (latest checkpoint, unspent outputs, retained branches)
// and not protected by a retention policy. It is mark-and-sweep over the
// reference graph: anything reachable from a root — or explicitly pinned — is
// retained; everything else is eligible. The hard invariant is that GC can NEVER
// remove pinned authoritative state, even if it looks unreferenced.

export class GarbageCollector {
  constructor() {
    this._objects = new Map(); // id → { id, refs:Set<string>, pinned:boolean }
    this._roots = new Set();   // signed roots GC marks from
  }

  /** Register an object and the ids it references. */
  register(id, refs = [], { pinned = false } = {}) {
    this._objects.set(String(id), { id: String(id), refs: new Set(refs.map(String)), pinned: !!pinned });
    return this;
  }

  /** Add/remove a signed root (checkpoint, unspent set, retained branch tip). */
  addRoot(id) { this._roots.add(String(id)); return this; }
  removeRoot(id) { return this._roots.delete(String(id)); }

  /** Pin authoritative state so GC can never collect it (rule 61 invariant). */
  pin(id) { const o = this._objects.get(String(id)); if (o) o.pinned = true; return !!o; }
  unpin(id) { const o = this._objects.get(String(id)); if (o) o.pinned = false; return !!o; }

  /** Mark: ids reachable from any root, transitively (cycle-safe). */
  reachable() {
    const live = new Set();
    const stack = [...this._roots];
    while (stack.length) {
      const id = stack.pop();
      if (live.has(id)) continue;
      live.add(id);
      const obj = this._objects.get(id);
      if (obj) for (const r of obj.refs) if (!live.has(r)) stack.push(r);
    }
    return live;
  }

  /** Objects eligible for collection: unreachable AND not pinned. */
  collectable() {
    const live = this.reachable();
    return [...this._objects.values()].filter((o) => !live.has(o.id) && !o.pinned).map((o) => o.id).sort();
  }

  /**
   * Sweep: remove collectable objects. Pinned and root-reachable objects are
   * always retained. Returns the ids actually collected.
   */
  sweep() {
    const dead = this.collectable();
    for (const id of dead) this._objects.delete(id);
    return dead;
  }

  has(id) { return this._objects.has(String(id)); }
  get size() { return this._objects.size; }
}
