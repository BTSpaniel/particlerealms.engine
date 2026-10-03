// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/replication/ShardRouter.js — deterministic key→shard routing and
// commit-domain boundaries (spec §10, rule 1 of cross-domain preference order).
//
// A shard is a commit domain: state strongly related to an invariant should land
// in ONE shard so its commit is local and atomic. The router maps a logical key
// to a shard deterministically (same key → same shard on every node) using the
// engine's canonical fast hash, so routing needs no coordination. Transactions
// touching more than one shard are flagged as cross-shard (handled by the
// CrossShardCoordinator) — the router never silently spans domains.

import { hashIdFast } from '../util/canonical.js';
import { hashIdTailUint32 } from '../util/hashing.js';

export class ShardRouter {
  /**
   * @param {string[]} shards ordered list of shard ids (the commit domains)
   */
  constructor(shards = ['shard-0']) {
    if (!Array.isArray(shards) || shards.length === 0) throw new TypeError('ShardRouter needs ≥1 shard');
    this._shards = [...shards];
  }

  get shards() { return [...this._shards]; }
  get count() { return this._shards.length; }

  /** Deterministically route a logical key to its shard (commit domain). */
  route(key) {
    const idx = hashIdTailUint32(hashIdFast(String(key))) % this._shards.length;
    return this._shards[idx];
  }

  /** True if two keys live in the same commit domain (single-shard atomic commit). */
  sameShard(a, b) { return this.route(a) === this.route(b); }

  /** The distinct set of shards a set of keys touches. */
  shardsFor(keys = []) {
    return [...new Set(keys.map((k) => this.route(k)))].sort();
  }

  /**
   * Classify a transaction's footprint.
   * @param {string[]} keys all keys the tx reads/consumes/creates
   * @returns {{ crossShard:boolean, shards:string[], primary:string }}
   */
  classify(keys = []) {
    const shards = this.shardsFor(keys);
    return { crossShard: shards.length > 1, shards, primary: shards[0] ?? this._shards[0] };
  }
}
