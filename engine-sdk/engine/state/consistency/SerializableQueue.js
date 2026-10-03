// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/consistency/SerializableQueue.js — Consistency-plane serializable commit
// queue (spec §3 plane 3, §6, §8 "Serializable", rule 24).
//
// The "Exclusive"/serializable consistency profile needs commits to be applied
// in an order equivalent to some serial schedule. This queue admits transactions
// (each declaring a read-set and write-set), assigns a monotonic commit sequence,
// and detects when admitting a transaction would create a non-serializable
// schedule against already-queued/committed transactions (a read-write or
// write-write conflict on overlapping items). Conflicting transactions are not
// silently interleaved — the queue rejects them for retry, preserving
// serializability for the invariants that require it.

const set = (xs) => new Set((xs ?? []).map(String));
const overlaps = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };

export class SerializableQueue {
  constructor() {
    this._seq = 0;
    this._active = new Map(); // txId → { readSet:Set, writeSet:Set, seq }
    this._committed = [];     // ordered { txId, writeSet, seq }
  }

  get length() { return this._active.size; }
  get committedCount() { return this._committed.length; }

  /**
   * Try to admit a transaction into the serial order.
   * @param {string} txId
   * @param {Iterable<string>} readSet
   * @param {Iterable<string>} writeSet
   * @returns {{ ok:boolean, seq?:number, reason?:string, conflictsWith?:string }}
   */
  admit(txId, readSet = [], writeSet = []) {
    const r = set(readSet), w = set(writeSet);
    // Conflict if another ACTIVE tx writes what we read/write, or reads what we
    // write (read-write / write-write antidependency on overlapping items).
    for (const [otherId, o] of this._active) {
      if (otherId === String(txId)) continue;
      if (overlaps(w, o.writeSet) || overlaps(w, o.readSet) || overlaps(r, o.writeSet)) {
        return { ok: false, reason: 'serialization-conflict', conflictsWith: otherId };
      }
    }
    const seq = ++this._seq;
    this._active.set(String(txId), { readSet: r, writeSet: w, seq });
    return { ok: true, seq };
  }

  /** Finalize an admitted transaction at its assigned sequence (serial order). */
  commit(txId) {
    const tx = this._active.get(String(txId));
    if (!tx) return { ok: false, reason: 'not-admitted' };
    this._active.delete(String(txId));
    this._committed.push({ txId: String(txId), writeSet: tx.writeSet, seq: tx.seq });
    return { ok: true, seq: tx.seq };
  }

  /** Drop an admitted-but-aborted transaction, freeing its conflict claims. */
  abort(txId) { return this._active.delete(String(txId)); }

  /** The serial schedule actually committed, in sequence order. */
  schedule() { return this._committed.slice().sort((a, b) => a.seq - b.seq).map((c) => c.txId); }
}
