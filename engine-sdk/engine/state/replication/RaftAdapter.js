// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/replication/RaftAdapter.js — crash-fault replicated authority
// (spec §8 Replication, rules 37–39).
//
// An in-memory Raft cluster used where authority is genuinely SHARED. It manages
// leader election (with the Raft up-to-date restriction so a leader never lacks a
// committed entry) and quorum commit: a command is committed only once it lives
// on a majority of the cluster, so it survives any minority of crashes. The
// failure model is explicitly CRASH-FAULT (not Byzantine), and progress requires
// a quorum — when too many nodes are down the cluster correctly STALLS rather
// than risking divergence (rule 38/39: declare the failure model; partitions
// force an availability/consistency choice).

import { ReplicatedLog } from './ReplicatedLog.js';

export class RaftAdapter {
  /** @param {string[]} nodeIds cluster membership (fixed) */
  constructor(nodeIds = ['n0', 'n1', 'n2']) {
    if (nodeIds.length < 1) throw new TypeError('RaftAdapter needs ≥1 node');
    this._nodes = nodeIds.map((id) => ({ id, alive: true, term: 0, log: new ReplicatedLog() }));
    this._leaderId = null;
    this._term = 0;
  }

  get size() { return this._nodes.length; }
  /** Majority needed for election and commit. */
  quorum() { return Math.floor(this._nodes.length / 2) + 1; }
  aliveCount() { return this._nodes.filter((n) => n.alive).length; }
  get leader() { return this._leaderId; }
  _node(id) { return this._nodes.find((n) => n.id === id) ?? null; }

  crash(id) { const n = this._node(id); if (n) n.alive = false; if (id === this._leaderId) this._leaderId = null; return this; }
  recover(id) { const n = this._node(id); if (n) { n.alive = true; if (this._leaderId) this._syncFollower(n); } return this; }

  /**
   * Elect a leader. Succeeds only with a live quorum, and only a node whose log
   * is at least as up-to-date as a voting majority can win (Raft restriction).
   * @returns {{ ok:boolean, leader?:string, term?:number, reason?:string }}
   */
  electLeader() {
    const alive = this._nodes.filter((n) => n.alive);
    if (alive.length < this.quorum()) return { ok: false, reason: 'no-quorum' };
    // Candidate = most up-to-date live log (lastTerm, then lastIndex).
    const candidate = alive.reduce((best, n) =>
      (n.log.lastTerm() > best.log.lastTerm() ||
       (n.log.lastTerm() === best.log.lastTerm() && n.log.lastIndex() > best.log.lastIndex())) ? n : best, alive[0]);
    const newTerm = Math.max(...this._nodes.map((n) => n.term)) + 1;
    // Grant votes: a node votes for the candidate iff candidate's log is at least
    // as up-to-date as its own.
    const votes = alive.filter((voter) =>
      candidate.log.lastTerm() > voter.log.lastTerm() ||
      (candidate.log.lastTerm() === voter.log.lastTerm() && candidate.log.lastIndex() >= voter.log.lastIndex())).length;
    if (votes < this.quorum()) return { ok: false, reason: 'split-vote' };
    this._leaderId = candidate.id;
    this._term = newTerm;
    for (const n of alive) n.term = newTerm;
    return { ok: true, leader: candidate.id, term: newTerm };
  }

  /**
   * Propose a command. The leader appends it, replicates to live followers, and
   * commits iff a quorum holds the entry. Returns committed:false (not an error)
   * when the entry replicated but lacks quorum.
   * @returns {{ ok:boolean, committed?:boolean, index?:number, reason?:string }}
   */
  propose(command) {
    const leader = this._node(this._leaderId);
    if (!leader || !leader.alive) return { ok: false, reason: 'no-leader' };
    const entry = leader.log.leaderAppend(this._term, command);
    // Replicate to every live follower (log repair handles divergence).
    for (const n of this._nodes) if (n.alive && n.id !== leader.id) this._syncFollower(n);
    // Count replicas (incl. leader) that hold this entry at the leader's term.
    const holders = this._nodes.filter((n) => n.alive && n.log.termAt(entry.index) === this._term).length;
    if (holders >= this.quorum()) {
      leader.log.setCommitIndex(entry.index);
      for (const n of this._nodes) if (n.alive && n.id !== leader.id) this._syncFollower(n); // propagate commitIndex
      return { ok: true, committed: true, index: entry.index };
    }
    return { ok: true, committed: false, index: entry.index, reason: 'no-quorum-replication' };
  }

  /** Bring a follower's log into agreement with the leader (Raft backtracking). */
  _syncFollower(follower) {
    const leader = this._node(this._leaderId);
    if (!leader) return false;
    for (let prevIndex = leader.log.lastIndex(); prevIndex >= 0; prevIndex--) {
      const prevTerm = leader.log.termAt(prevIndex);
      const entries = [];
      for (let i = prevIndex + 1; i <= leader.log.lastIndex(); i++) {
        const e = leader.log.at(i); entries.push({ term: e.term, command: e.command });
      }
      const res = follower.log.appendEntries(prevIndex, prevTerm, entries, leader.log.commitIndex);
      if (res.ok) return true;
    }
    return false;
  }

  /** Committed commands as seen by a node. */
  committedOn(id) { return this._node(id)?.log.committed() ?? []; }

  /** True if the entry at `index` is committed on a quorum at the leader's term. */
  isCommittedQuorum(index) {
    const holders = this._nodes.filter((n) => n.log.commitIndex >= index).length;
    return holders >= this.quorum();
  }
}
