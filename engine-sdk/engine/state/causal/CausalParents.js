// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/causal/CausalParents.js — partial order over committed events (spec §2,§9).
//
// Lamport's happened-before: causal relationships establish a partial order;
// concurrent events need not have a global order. This Causal Plane tracks the
// DAG of committed ids (commits, observations) so a new transaction can declare
// `causalParents` and the coordinator can verify those parents are known before
// committing. It reuses the partial-order toposort from facts/Causality.js for
// deterministic projection of the known causal graph.

import { link, toposort, dependsOn } from '../facts/Causality.js';

export class CausalGraph {
  constructor() {
    this._nodes = new Set();   // known event ids
    this._links = [];          // {cause, effect}
  }

  /** Register a known event id (commit, observation, fact). */
  addNode(id) { this._nodes.add(String(id)); return this; }

  /** True if an event id is known to the graph. */
  has(id) { return this._nodes.has(String(id)); }

  /**
   * Record a new event with explicit causal parents. Parents must already be
   * known (else the relationship is dangling). Returns the unknown parents.
   * @returns {string[]} unknown parent ids (empty when all are known)
   */
  record(id, parents = []) {
    const eid = String(id);
    const unknown = [];
    for (const p of parents) {
      const pid = String(p);
      if (!this._nodes.has(pid)) unknown.push(pid);
      this._links.push(link(pid, eid));
    }
    this._nodes.add(eid);
    return unknown;
  }

  /**
   * Verify causal parents for a proposed transaction WITHOUT mutating the graph.
   * @returns {{ ok:boolean, unknown:string[] }}
   */
  verifyParents(parents = []) {
    const unknown = parents.map(String).filter((p) => !this._nodes.has(p));
    return { ok: unknown.length === 0, unknown };
  }

  /** Deterministic partial-order projection of all known events. */
  order() { return toposort(this._nodes, this._links); }

  /** Does `effect` (transitively) causally depend on `cause`? */
  dependsOn(effect, cause) { return dependsOn(String(effect), String(cause), this._links); }

  get size() { return this._nodes.size; }
}
