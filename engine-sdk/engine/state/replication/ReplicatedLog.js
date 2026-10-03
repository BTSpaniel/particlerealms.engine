// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/replication/ReplicatedLog.js — a single replica's replicated commit log
// (spec §8 "Replication", §11 consensus-backed commit record).
//
// Implements the Raft log model: each entry is { index, term, command }. The
// LOG-MATCHING property is enforced on replication — an AppendEntries is rejected
// unless the follower's entry at prevIndex has prevTerm; conflicting suffixes are
// truncated before appending. Consequently, if two logs hold an entry with the
// same index and term, the logs are identical up to that index. `commitIndex`
// only advances over entries known durable on a quorum (the RaftAdapter drives
// that), so a committed entry is never lost under the declared crash-fault model.

export class ReplicatedLog {
  constructor() {
    this._entries = []; // 1-indexed conceptually; _entries[0] is index 1
    this._commitIndex = 0;
  }

  get length() { return this._entries.length; }
  get commitIndex() { return this._commitIndex; }
  /** Entry at a 1-based index, or null. */
  at(index) { return this._entries[index - 1] ?? null; }
  termAt(index) { return index === 0 ? 0 : (this.at(index)?.term ?? -1); }
  lastIndex() { return this._entries.length; }
  lastTerm() { return this.termAt(this._entries.length); }
  /** Committed commands in order (the applied state machine input). */
  committed() { return this._entries.slice(0, this._commitIndex).map((e) => e.command); }

  /** Leader-side: append a new command under the current term. */
  leaderAppend(term, command) {
    const entry = { index: this._entries.length + 1, term, command };
    this._entries.push(entry);
    return entry;
  }

  /**
   * Follower-side AppendEntries with the Raft log-matching check.
   * @param {number} prevIndex  index immediately preceding new entries
   * @param {number} prevTerm   term of the entry at prevIndex
   * @param {Array<{term:number, command:*}>} entries new entries to append
   * @param {number} leaderCommit leader's commitIndex
   * @returns {{ ok:boolean, reason?:string, matchIndex?:number }}
   */
  appendEntries(prevIndex, prevTerm, entries = [], leaderCommit = 0) {
    // Consistency check: our entry at prevIndex must have prevTerm.
    if (prevIndex > 0 && this.termAt(prevIndex) !== prevTerm) {
      return { ok: false, reason: 'log-mismatch' };
    }
    // Append/overwrite, truncating any conflicting suffix (different term).
    let idx = prevIndex;
    for (const e of entries) {
      idx += 1;
      const existing = this.at(idx);
      if (existing && existing.term !== e.term) {
        this._entries.length = idx - 1; // truncate conflicting suffix
      }
      if (!this.at(idx)) this._entries.push({ index: idx, term: e.term, command: e.command });
    }
    // Advance commit index (never past what we actually hold).
    if (leaderCommit > this._commitIndex) {
      this._commitIndex = Math.min(leaderCommit, this._entries.length);
    }
    return { ok: true, matchIndex: idx };
  }

  /** Directly set commit index (leader, after quorum); clamped to length. */
  setCommitIndex(n) { this._commitIndex = Math.max(this._commitIndex, Math.min(n, this._entries.length)); }
}
