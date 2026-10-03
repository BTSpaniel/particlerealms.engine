// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/facts/Causality.js — partial order ONLY when a dependency forces it.
//
// Layer law: "Only causality creates before/after". Facts with no dependency
// link stay unordered; we never invent sequence. Independent nodes get a
// deterministic tie-break (canonical sort) purely for reproducibility, not as
// claimed truth.

/** A causal link: effect depends on cause (cause must precede effect). */
export function link(cause, effect) { return Object.freeze({ cause, effect }); }

/**
 * Partial-order sort. Nodes only ordered where links force it; otherwise
 * deterministic by string. Throws on a causal cycle (an impossible order).
 * @param {Iterable<string>} nodes
 * @param {Array<{cause,effect}>} links
 * @returns {string[]}
 */
export function toposort(nodes, links = []) {
  const all = [...new Set([...nodes])];
  const indeg = new Map(all.map((n) => [n, 0]));
  const adj = new Map(all.map((n) => [n, []]));
  for (const { cause, effect } of links) {
    if (!adj.has(cause) || !indeg.has(effect)) continue;
    adj.get(cause).push(effect);
    indeg.set(effect, indeg.get(effect) + 1);
  }
  // Kahn's algorithm with a deterministic (sorted) ready set.
  const ready = all.filter((n) => indeg.get(n) === 0).sort();
  const out = [];
  while (ready.length) {
    const n = ready.shift();
    out.push(n);
    const next = adj.get(n).slice().sort();
    for (const m of next) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) {
        // insert keeping `ready` sorted for determinism
        let i = 0; while (i < ready.length && ready[i] < m) i++;
        ready.splice(i, 0, m);
      }
    }
  }
  if (out.length !== all.length) throw new Error('Causality.toposort: cycle detected (impossible order)');
  return out;
}

/** Transitive dependency test: does `effect` (transitively) depend on `cause`? */
export function dependsOn(effect, cause, links = []) {
  const adj = new Map();
  for (const { cause: c, effect: e } of links) { (adj.get(c) || adj.set(c, []).get(c)).push(e); }
  const seen = new Set();
  const stack = [cause];
  while (stack.length) {
    const n = stack.pop();
    for (const m of adj.get(n) || []) {
      if (m === effect) return true;
      if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
  }
  return false;
}
