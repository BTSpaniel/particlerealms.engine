// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/transaction/ProposalPool.js — Transaction-plane proposal pool
// (spec §3 plane 5, rules 27–28).
//
// Before a transaction reaches the CommitCoordinator it is a PROPOSAL: a
// candidate that has not yet won its conflict domain. Two proposals that consume
// the same USO conflict — they must COMPETE, never silently overwrite (rule 27).
// The pool groups proposals by the exclusive inputs they contend for, picks at
// most one winner per conflict set (deterministically), and marks the losers as
// `superseded` so they re-observe and re-plan (rule 28). The pool decides only
// candidacy; the commit gate still establishes truth.

export const PROPOSAL_STATUS = Object.freeze({
  PENDING: 'pending', WINNER: 'winner', SUPERSEDED: 'superseded', WITHDRAWN: 'withdrawn',
});

export class ProposalPool {
  /**
   * @param {object} [opts]
   * @param {(a:object, b:object)=>number} [opts.priority] tie-break ordering for
   *        competing proposals (default: lexicographic transactionID — stable and
   *        independent of arrival order, so machine order never decides, rule 10).
   */
  constructor(opts = {}) {
    this._proposals = new Map(); // transactionID → { env, status }
    this._priority = opts.priority ?? ((a, b) => String(a.env.transactionID).localeCompare(String(b.env.transactionID)));
  }

  get size() { return this._proposals.size; }

  /** Submit a proposal envelope (must carry transactionID + consumeSet). */
  submit(env) {
    if (!env?.transactionID) throw new TypeError('ProposalPool.submit: env needs a transactionID');
    if (!this._proposals.has(env.transactionID)) {
      this._proposals.set(env.transactionID, { env, status: PROPOSAL_STATUS.PENDING });
    }
    return env.transactionID;
  }

  status(txId) { return this._proposals.get(String(txId))?.status ?? null; }
  withdraw(txId) { const p = this._proposals.get(String(txId)); if (p) p.status = PROPOSAL_STATUS.WITHDRAWN; return !!p; }

  /** Pending proposals grouped by each exclusive input they contend for. */
  _conflictSets() {
    const byInput = new Map(); // usoId → [proposal]
    for (const p of this._proposals.values()) {
      if (p.status !== PROPOSAL_STATUS.PENDING) continue;
      for (const input of p.env.consumeSet ?? []) {
        if (!byInput.has(input)) byInput.set(input, []);
        byInput.get(input).push(p);
      }
    }
    return byInput;
  }

  /**
   * Resolve contention: for every contended input, choose one winner by the
   * priority order and mark the rest superseded. A proposal wins only if it wins
   * EVERY input it touches (so it can actually commit atomically). Returns the
   * winners that are clear to hand to the CommitCoordinator.
   * @returns {{ winners:object[], superseded:object[] }}
   */
  resolve() {
    const conflicts = this._conflictSets();
    const losers = new Set();
    // First pass: per-input winner.
    const inputWinner = new Map();
    for (const [input, contenders] of conflicts) {
      const sorted = [...contenders].sort(this._priority);
      inputWinner.set(input, sorted[0].env.transactionID);
      for (let i = 1; i < sorted.length; i++) losers.add(sorted[i].env.transactionID);
    }
    // Second pass: a proposal must win ALL of its inputs to be a real winner.
    const winners = [];
    for (const p of this._proposals.values()) {
      if (p.status !== PROPOSAL_STATUS.PENDING || losers.has(p.env.transactionID)) continue;
      const wonAll = (p.env.consumeSet ?? []).every((i) => inputWinner.get(i) === p.env.transactionID);
      if (wonAll) { p.status = PROPOSAL_STATUS.WINNER; winners.push(p.env); }
      else losers.add(p.env.transactionID);
    }
    const superseded = [];
    for (const txId of losers) {
      const p = this._proposals.get(txId);
      if (p && p.status === PROPOSAL_STATUS.PENDING) { p.status = PROPOSAL_STATUS.SUPERSEDED; superseded.push(p.env); }
    }
    return { winners, superseded };
  }
}
