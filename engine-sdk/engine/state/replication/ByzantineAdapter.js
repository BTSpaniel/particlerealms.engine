// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/replication/ByzantineAdapter.js — optional Byzantine-fault-tolerant
// authority (spec §8 hostile peer-to-peer profile, rule 38).
//
// This is the explicitly-separate hostile-P2P profile, NOT implied by the
// default crash-fault deployment. It tolerates up to f Byzantine (arbitrary /
// malicious) nodes given n ≥ 3f+1 members, committing a value only when at least
// a 2f+1 quorum cast MATCHING votes for it. Two safety mechanisms:
//
//   • Equivocation detection — a node that votes for two different values in the
//     same round is provably faulty; it is marked Byzantine and ALL its votes
//     are discarded, so a double-voter cannot help two values reach quorum.
//   • 2f+1 quorum — with n ≥ 3f+1 and ≤ f faulty nodes, any value with 2f+1
//     votes has ≥ f+1 honest votes, so two conflicting values can never both
//     commit (their honest supporters would have to overlap).
//
// Votes are expected to be signed; an optional verifier rejects unsigned/forged
// votes. Membership/Sybil control is a deployment policy declared separately.

export class ByzantineAdapter {
  /**
   * @param {string[]} nodeIds cluster membership
   * @param {number} f max Byzantine faults to tolerate (requires n ≥ 3f+1)
   * @param {(vote:object)=>boolean} [verify] optional signature verifier
   */
  constructor(nodeIds = [], f = 1, verify = null) {
    if (nodeIds.length < 3 * f + 1) throw new RangeError(`BFT needs n ≥ 3f+1 (got n=${nodeIds.length}, f=${f})`);
    this._members = new Set(nodeIds.map(String));
    this._f = f;
    this._verify = verify;
    this._rounds = new Map();   // round → Map(nodeId → value)
    this._byzantine = new Set(); // nodes caught equivocating / forging
  }

  /** Votes required to commit a value (Byzantine quorum). */
  quorum() { return 2 * this._f + 1; }
  byzantineNodes() { return [...this._byzantine].sort(); }

  _round(r) { const k = String(r); if (!this._rounds.has(k)) this._rounds.set(k, new Map()); return this._rounds.get(k); }

  /**
   * Cast a (signed) vote for `value` in `round` by `nodeId`.
   * @returns {{ ok:boolean, reason?:string, equivocation?:boolean }}
   */
  vote(round, nodeId, value, signature = null) {
    const node = String(nodeId);
    if (!this._members.has(node)) return { ok: false, reason: 'not-a-member' };
    if (this._verify && !this._verify({ round, nodeId: node, value, signature })) {
      this._byzantine.add(node); // forged/invalid signature ⇒ treat as faulty
      return { ok: false, reason: 'bad-signature' };
    }
    const votes = this._round(round);
    const prior = votes.get(node);
    if (prior !== undefined && prior !== value) {
      // Equivocation: same node, same round, conflicting values ⇒ provably faulty.
      this._byzantine.add(node);
      votes.delete(node);
      return { ok: false, reason: 'equivocation', equivocation: true };
    }
    votes.set(node, value);
    return { ok: true };
  }

  /** Count of HONEST (non-Byzantine) votes for a value in a round. */
  tally(round, value) {
    let n = 0;
    for (const [node, v] of this._round(round)) if (v === value && !this._byzantine.has(node)) n++;
    return n;
  }

  /** True if `value` reached a Byzantine quorum (2f+1 honest matching votes). */
  isCommitted(round, value) { return this.tally(round, value) >= this.quorum(); }

  /** The committed value for a round, or null if none reached quorum. */
  committedValue(round) {
    const counts = new Map();
    for (const [node, v] of this._round(round)) {
      if (this._byzantine.has(node)) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    for (const [v, n] of counts) if (n >= this.quorum()) return v;
    return null;
  }
}
