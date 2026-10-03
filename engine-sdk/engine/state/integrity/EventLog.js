// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/integrity/EventLog.js — append-only commit stream (spec §13).
//
// Committed changes are appended to an immutable, hash-chained event log.
// Materialized views can be rebuilt without altering history (event sourcing).
// Each entry links to the previous entry's hash, so any tampering with earlier
// history changes every subsequent link — a lightweight Merkle chain. The hash
// is the fast tagged id of the canonical entry (hot path); authority signatures
// live on the witness receipts the entries reference.

import { hashIdFast } from '../util/canonical.js';

const GENESIS = 'sha256:256:'.padEnd(11, '0') + '0'.repeat(64); // sentinel prev for entry 0

export class EventLog {
  constructor() {
    this._entries = [];      // { seq, prev, type, payload, hash }
    this._head = GENESIS;
  }

  get length() { return this._entries.length; }
  get head() { return this._head; }

  /**
   * Append an event. Returns the frozen entry (with its chained hash).
   * @param {string} type     event type (e.g. 'commit')
   * @param {object} payload   canonicalizable event body (e.g. a receipt)
   */
  append(type, payload) {
    const seq = this._entries.length;
    const body = { seq, prev: this._head, type: String(type), payload };
    const hash = hashIdFast(body, { schemaVersion: 'eventlog-v1' });
    const entry = Object.freeze({ ...body, hash });
    this._entries.push(entry);
    this._head = hash;
    return entry;
  }

  /** Entry at a sequence index, or null. */
  at(seq) { return this._entries[seq] ?? null; }

  /** All entries (frozen shallow copy). */
  entries() { return Object.freeze([...this._entries]); }

  /**
   * Verify the hash chain is intact end-to-end.
   * @returns {{ ok:boolean, brokenAt:number|null }}
   */
  verify() {
    let prev = GENESIS;
    for (let i = 0; i < this._entries.length; i++) {
      const e = this._entries[i];
      if (e.prev !== prev) return { ok: false, brokenAt: i };
      const recomputed = hashIdFast({ seq: e.seq, prev: e.prev, type: e.type, payload: e.payload }, { schemaVersion: 'eventlog-v1' });
      if (recomputed !== e.hash) return { ok: false, brokenAt: i };
      prev = e.hash;
    }
    return { ok: true, brokenAt: null };
  }
}

export { GENESIS as EVENTLOG_GENESIS };
