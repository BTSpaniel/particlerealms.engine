// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/worldmodel/ObjectGraph.js — object identity + relationship graph
// (spec §15 "Object identity graph" + "Spatial and relationship graph").
//
// Tracks objects with STABLE logical ids (independent of their content version)
// and typed directed relations between them: inside, near, connected-to, blocks,
// contains, reachable-from, visible-from, depends-on. Relations support
// reachability queries (e.g. "is room A reachable from room B over `connected`?")
// which the planner uses without ever asserting canonical truth.

export const RELATION = Object.freeze({
  INSIDE: 'inside', NEAR: 'near', CONNECTED: 'connected', BLOCKS: 'blocks',
  CONTAINS: 'contains', REACHABLE: 'reachable', VISIBLE: 'visible', DEPENDS_ON: 'depends-on',
});

export class ObjectGraph {
  constructor() {
    this._objects = new Map();              // id → { id, type, attrs }
    this._edges = new Map();                // "rel" → Map(from → Set(to))
  }

  get objectCount() { return this._objects.size; }

  /** Add or update an object by its stable logical id. */
  addObject(id, type = 'object', attrs = {}) {
    const key = String(id);
    this._objects.set(key, { id: key, type: String(type), attrs: { ...attrs } });
    return this;
  }

  has(id) { return this._objects.has(String(id)); }
  get(id) { const o = this._objects.get(String(id)); return o ? { ...o, attrs: { ...o.attrs } } : null; }

  /** Add a directed relation `from --rel--> to`. */
  addRelation(from, rel, to) {
    const r = String(rel);
    if (!this._edges.has(r)) this._edges.set(r, new Map());
    const m = this._edges.get(r);
    if (!m.has(String(from))) m.set(String(from), new Set());
    m.get(String(from)).add(String(to));
    return this;
  }

  /** Direct neighbors of `id` over a relation. */
  neighbors(id, rel) {
    return [...(this._edges.get(String(rel))?.get(String(id)) ?? [])].sort();
  }

  /** All relations involving `id` as the source: { rel: [to,...] }. */
  relationsOf(id) {
    const out = {};
    for (const [rel, m] of this._edges) {
      const tos = m.get(String(id));
      if (tos && tos.size) out[rel] = [...tos].sort();
    }
    return out;
  }

  /**
   * Is `to` reachable from `from` following `rel` edges (transitively)?
   * BFS over the relation; cycle-safe.
   */
  reachable(from, to, rel = RELATION.CONNECTED) {
    const start = String(from), goal = String(to);
    const m = this._edges.get(String(rel));
    if (!m) return false;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of m.get(cur) ?? []) {
        if (next === goal) return true;
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    return false;
  }
}
