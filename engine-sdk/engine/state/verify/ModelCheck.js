// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/verify/ModelCheck.js — browser-runnable bounded model checker for the
// CSE commit state machine (spec §19, rule 66: model-check the core protocol).
//
// This is the executable companion to verify/cse-core.tla. Where TLC would
// exhaustively explore the TLA+ model, this performs the SAME exhaustive
// exploration in JavaScript so it runs inside the verify.html harness with no
// external tooling. It enumerates every reachable state under all interleavings
// of commit actions and checks the core safety invariants on each:
//
//   • NoDoubleSpend     — an output is never simultaneously unspent and spent.
//   • SingleSpend       — no output is consumed by two committed transactions.
//   • EveryCommitWitnessed — every committed transaction has a witness.
//
// A transaction is enabled iff it is uncommitted and all of its inputs are still
// unspent; applying it consumes inputs, creates outputs, and records a witness.

const keyOf = (s) => JSON.stringify({
  u: [...s.unspent].sort(), p: [...s.spent].sort(), c: [...s.committed].sort(),
});

function checkInvariants(s) {
  for (const o of s.unspent) if (s.spent.has(o)) return 'NoDoubleSpend';
  if (s.committed.size !== s.witnessed.size) return 'EveryCommitWitnessed';
  // SingleSpend: a consumed output must never appear across two committed txns.
  const consumedSeen = new Set();
  for (const t of s.committed) {
    for (const o of (s.consume[t] ?? [])) {
      if (consumedSeen.has(o)) return 'SingleSpend';
      consumedSeen.add(o);
    }
  }
  return null;
}

/**
 * Exhaustively explore the commit state machine.
 * @param {object} cfg
 * @param {string[]} cfg.outputs   ids initially unspent
 * @param {string[]} cfg.txns      transaction ids
 * @param {Object<string,string[]>} cfg.consume  inputs each tx consumes
 * @param {Object<string,string[]>} cfg.create   outputs each tx creates
 * @param {number} [cfg.maxStates] safety cap on explored states
 * @returns {{ ok:boolean, statesExplored:number, violation:string|null, trace:string[]|null, truncated:boolean }}
 */
export function exploreCommitMachine(cfg = {}) {
  const { outputs = [], txns = [], consume = {}, create = {}, maxStates = 100000 } = cfg;

  const initial = {
    unspent: new Set(outputs.map(String)),
    spent: new Set(),
    committed: new Set(),
    witnessed: new Set(),
    consume, create,
    trace: [],
  };

  const visited = new Set();
  const stack = [initial];
  let statesExplored = 0;
  let truncated = false;

  while (stack.length) {
    const s = stack.pop();
    const k = keyOf(s);
    if (visited.has(k)) continue;
    visited.add(k);
    statesExplored++;

    const violation = checkInvariants(s);
    if (violation) return { ok: false, statesExplored, violation, trace: s.trace, truncated };
    if (statesExplored >= maxStates) { truncated = true; break; }

    // Expand: every enabled commit action.
    for (const t of txns) {
      if (s.committed.has(t)) continue;
      const ins = (consume[t] ?? []).map(String);
      if (!ins.every((o) => s.unspent.has(o))) continue; // not enabled (input not unspent)
      const unspent = new Set(s.unspent);
      const spent = new Set(s.spent);
      for (const o of ins) { unspent.delete(o); spent.add(o); }
      for (const o of (create[t] ?? []).map(String)) unspent.add(o);
      const committed = new Set(s.committed); committed.add(t);
      const witnessed = new Set(s.witnessed); witnessed.add(t); // commit ⇒ witness
      stack.push({ unspent, spent, committed, witnessed, consume, create, trace: [...s.trace, t] });
    }
  }

  return { ok: true, statesExplored, violation: null, trace: null, truncated };
}
