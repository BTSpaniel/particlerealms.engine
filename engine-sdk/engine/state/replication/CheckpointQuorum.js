// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/replication/CheckpointQuorum.js — quorum-signed checkpoint proofs
// (spec §13 checkpoints + §8 replication, rule 64).
//
// A checkpoint summarizes history with a canonical state root. In a replicated
// deployment a checkpoint becomes authoritative only when a QUORUM of members
// attest to the SAME state root — this is the proof a restored node verifies
// before accepting commits (rule 64). Members that attest a different root are
// recorded as DIVERGENT and never counted toward the quorum, so a minority of
// faulty/forked replicas cannot finalize a bad checkpoint.

export class CheckpointQuorum {
  /**
   * @param {object} cfg
   * @param {string[]} cfg.members cluster members allowed to attest
   * @param {number} [cfg.quorum]  attestations required (default majority)
   */
  constructor(cfg = {}) {
    this._members = new Set(cfg.members ?? []);
    this._quorum = cfg.quorum ?? (Math.floor(this._members.size / 2) + 1);
    this._proposals = new Map(); // checkpointId → { root, attestations:Map(node→root) }
  }

  get quorum() { return this._quorum; }

  /** Propose a checkpoint (must expose `id` and `stateRoot`). */
  propose(checkpoint) {
    if (!checkpoint?.id || !checkpoint?.stateRoot) throw new TypeError('checkpoint needs id + stateRoot');
    if (!this._proposals.has(checkpoint.id)) {
      this._proposals.set(checkpoint.id, { root: checkpoint.stateRoot, attestations: new Map() });
    }
    return checkpoint.id;
  }

  /**
   * A member attests to a state root for a proposed checkpoint. Only members may
   * attest, and only one (latest) attestation per member counts.
   * @returns {{ ok:boolean, agrees?:boolean, reason?:string }}
   */
  attest(checkpointId, nodeId, stateRoot) {
    const p = this._proposals.get(checkpointId);
    if (!p) return { ok: false, reason: 'unknown-checkpoint' };
    if (!this._members.has(nodeId)) return { ok: false, reason: 'not-a-member' };
    p.attestations.set(nodeId, stateRoot);
    return { ok: true, agrees: stateRoot === p.root };
  }

  /** Members whose attestation matches the proposed root. */
  agreeing(checkpointId) {
    const p = this._proposals.get(checkpointId);
    if (!p) return [];
    return [...p.attestations.entries()].filter(([, r]) => r === p.root).map(([n]) => n).sort();
  }

  /** Members whose attestation diverges from the proposed root. */
  divergent(checkpointId) {
    const p = this._proposals.get(checkpointId);
    if (!p) return [];
    return [...p.attestations.entries()].filter(([, r]) => r !== p.root).map(([n]) => n).sort();
  }

  /** Finalized iff a quorum of members agree on the proposed root. */
  isFinalized(checkpointId) { return this.agreeing(checkpointId).length >= this._quorum; }

  /** The quorum proof for a checkpoint. */
  proof(checkpointId) {
    const p = this._proposals.get(checkpointId);
    if (!p) return null;
    const attestors = this.agreeing(checkpointId);
    return Object.freeze({
      checkpointId, root: p.root, attestors, divergent: this.divergent(checkpointId),
      quorum: this._quorum, finalized: attestors.length >= this._quorum,
    });
  }
}
