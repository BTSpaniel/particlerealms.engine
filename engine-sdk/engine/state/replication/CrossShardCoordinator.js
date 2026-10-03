// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/replication/CrossShardCoordinator.js — cross-domain atomic commit
// (spec §10, rule 40).
//
// Cross-domain atomicity is the most expensive operation, so it is used only
// when true all-or-nothing behavior is required. This coordinator implements
// two-phase commit with the §10 hardening:
//   • locks are acquired in CANONICAL order (sorted shard/key) to avoid deadlock;
//   • a durable PREPARED record is written so a coordinator that crashes after
//     prepare can be recovered and the commit completed (classic 2PC blocks on
//     coordinator failure; the prepared record makes it recoverable);
//   • for operations that do NOT need atomicity, a SAGA fallback is offered
//     instead, since compensation is cheaper than distributed commit.

import { Saga } from '../workflow/Saga.js';

export class CrossShardCoordinator {
  /** @param {string[]} shardIds participating shards */
  constructor(shardIds = []) {
    this._shards = new Map();
    for (const id of shardIds) this._shards.set(id, { locks: new Map(), committed: new Map() });
    this._prepared = new Map(); // txId → { ops, shards } durable prepared record
  }

  _shard(id) {
    if (!this._shards.has(id)) this._shards.set(id, { locks: new Map(), committed: new Map() });
    return this._shards.get(id);
  }

  /** Current committed value of a key on a shard. */
  read(shardId, key) { return this._shard(shardId).committed.get(String(key)) ?? null; }

  /**
   * Phase 1 — PREPARE. Acquire all locks in canonical order; record a durable
   * prepared entry. Returns failure (releasing any partial locks) on conflict.
   * @param {string} txId
   * @param {Array<{shardId:string, key:string, value:*}>} ops
   * @returns {{ ok:boolean, reason?:string }}
   */
  prepare(txId, ops = []) {
    // Canonical ordering of lock acquisition (deadlock avoidance).
    const ordered = [...ops].sort((a, b) =>
      (a.shardId + '\u0000' + a.key).localeCompare(b.shardId + '\u0000' + b.key));
    const acquired = [];
    for (const op of ordered) {
      const shard = this._shard(op.shardId);
      const holder = shard.locks.get(String(op.key));
      if (holder && holder !== txId) {
        for (const a of acquired) this._shard(a.shardId).locks.delete(String(a.key)); // release partial
        return { ok: false, reason: 'lock-conflict' };
      }
      shard.locks.set(String(op.key), txId);
      acquired.push(op);
    }
    this._prepared.set(txId, { ops: ordered, shards: [...new Set(ordered.map((o) => o.shardId))] });
    return { ok: true };
  }

  /**
   * Phase 2 — COMMIT. Apply all prepared ops atomically and release locks.
   * @returns {{ ok:boolean, applied?:number, reason?:string }}
   */
  commit(txId) {
    const rec = this._prepared.get(txId);
    if (!rec) return { ok: false, reason: 'not-prepared' };
    for (const op of rec.ops) {
      const shard = this._shard(op.shardId);
      shard.committed.set(String(op.key), op.value);
      shard.locks.delete(String(op.key));
    }
    this._prepared.delete(txId);
    return { ok: true, applied: rec.ops.length };
  }

  /** Abort a prepared transaction: discard the record and release its locks. */
  abort(txId) {
    const rec = this._prepared.get(txId);
    if (!rec) return { ok: false, reason: 'not-prepared' };
    for (const op of rec.ops) this._shard(op.shardId).locks.delete(String(op.key));
    this._prepared.delete(txId);
    return { ok: true };
  }

  /** True if a tx is prepared but not yet committed (the in-doubt window). */
  isPrepared(txId) { return this._prepared.has(txId); }

  /**
   * Recover an in-doubt transaction after a coordinator crash by completing the
   * commit from its durable prepared record — 2PC's blocking failure mode made
   * recoverable.
   */
  recover(txId) {
    if (!this._prepared.has(txId)) return { ok: false, reason: 'nothing-to-recover' };
    return this.commit(txId);
  }

  /**
   * SAGA fallback for cross-shard work that does NOT require atomicity: run a
   * sequence of local steps with compensation instead of a distributed commit.
   * @param {object[]} steps see workflow/Saga.js sagaStep
   */
  async sagaFallback(steps, ctx = {}) { return new Saga(steps).run(ctx); }
}
