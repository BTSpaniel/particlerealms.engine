// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/consistency/InvariantConfluence.js — coordination-avoidance classifier
// (spec §4, §8 "Consistency Plane", rule 35/36).
//
// Invariant confluence (Bailis et al.) is the precise test for whether a set of
// operations can run WITHOUT coordination: a set of operations is I-confluent
// with respect to an invariant I if, for any I-valid states reachable from a
// common ancestor, their merge is also I-valid. If so, replicas may diverge and
// merge freely (CALM); if not, those operations need a coordinating commit
// (Exclusive/serializable profile).
//
// This is a BOUNDED, honest classifier (a finite-model property check, in the
// spirit of §19) — it explores states reachable within `depth` operations and
// reports a concrete counterexample when it finds one. A "confluent" result is
// evidence within the explored bound, not a closed-form proof.

/**
 * Enumerate the states reachable by applying up to `depth` operations in
 * sequence from `initial`. Operations are pure: `(state) => newState`.
 * @returns {Array<{ state:*, trace:string[] }>}
 */
function reachable(initial, operations, depth) {
  const out = [{ state: initial, trace: [] }];
  let frontier = [{ state: initial, trace: [] }];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const node of frontier) {
      for (const op of operations) {
        const state = op.apply(node.state);
        const entry = { state, trace: [...node.trace, op.name] };
        out.push(entry); next.push(entry);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Classify a set of operations for invariant confluence.
 * @param {object} cfg
 * @param {*} cfg.initial         a valid starting state (CRDT instance or value)
 * @param {(a:*, b:*)=>*} cfg.merge      least-upper-bound join of two states
 * @param {(s:*)=>boolean} cfg.invariant the application invariant I
 * @param {Array<{name:string, apply:(s:*)=>*}>} cfg.operations  pure operations
 * @param {number} [cfg.depth]    branch exploration depth (default 2)
 * @returns {{ iConfluent:boolean, checked:number, counterexample:object|null }}
 */
export function classifyConfluence({ initial, merge, invariant, operations, depth = 2 }) {
  if (typeof merge !== 'function') throw new TypeError('classifyConfluence: merge required');
  if (typeof invariant !== 'function') throw new TypeError('classifyConfluence: invariant required');
  if (!invariant(initial)) {
    return { iConfluent: false, checked: 0, counterexample: { reason: 'initial-state-invalid' } };
  }
  // Only I-valid reachable states are admissible branch endpoints (the model
  // only merges states the system would actually have allowed to exist).
  const valid = reachable(initial, operations, depth).filter((b) => invariant(b.state));
  let checked = 0;
  for (const a of valid) {
    for (const b of valid) {
      checked++;
      const merged = merge(a.state, b.state);
      if (!invariant(merged)) {
        return {
          iConfluent: false, checked,
          counterexample: { left: a.trace, right: b.trace, merged },
        };
      }
    }
  }
  return { iConfluent: true, checked, counterexample: null };
}
