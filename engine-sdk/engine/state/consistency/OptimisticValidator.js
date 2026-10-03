// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/consistency/OptimisticValidator.js — optimistic read-set / predicate
// validation and write-skew detection (spec §6, §8, rule 22/24).
//
// The "Optimistic" consistency profile reads versions, proposes a replacement,
// and commits only if every read remained current (MVCC validation). Checking
// only WRITTEN objects is insufficient: snapshot execution can admit write-skew
// anomalies involving predicates or separately-read objects. So validation must
// cover the full declared read-set AND predicates, and a serializability check
// must detect dangerous rw-antidependency structures between concurrent
// transactions.

/**
 * Validate a transaction's declared read-set and predicates against the current
 * state. Used standalone or alongside the CommitCoordinator's version check.
 */
export class OptimisticValidator {
  /**
   * @param {object} cfg
   * @param {(entity:string)=>*} cfg.versionOf   current version id for an entity
   * @param {(predicate:string)=>boolean} [cfg.evaluate] re-evaluate a named predicate
   */
  constructor(cfg = {}) {
    if (typeof cfg.versionOf !== 'function') throw new TypeError('OptimisticValidator requires versionOf');
    this._versionOf = cfg.versionOf;
    this._evaluate = cfg.evaluate ?? (() => true);
  }

  /**
   * @param {Array<{entity:string, expectedVersion:*}>} readSet
   * @param {string[]} [predicateSet]
   * @returns {{ ok:boolean, conflicts:Array, failedPredicates:string[] }}
   */
  validate(readSet = [], predicateSet = []) {
    const conflicts = [];
    for (const r of readSet) {
      const actual = this._versionOf(r.entity);
      if (actual !== r.expectedVersion) {
        conflicts.push({ entity: r.entity, expected: r.expectedVersion, actual });
      }
    }
    const failedPredicates = predicateSet.filter((p) => !this._evaluate(p));
    return { ok: conflicts.length === 0 && failedPredicates.length === 0, conflicts, failedPredicates };
  }
}

const intersects = (a, b) => { const s = new Set(b); return [...a].some((x) => s.has(x)); };

/**
 * Detect a write-skew (non-serializable) hazard between two CONCURRENT
 * transactions. Write-skew occurs when each transaction reads data the other
 * writes — two rw-antidependency edges — so both can pass snapshot validation
 * yet jointly violate an invariant coupling the items.
 * @param {{readSet:Iterable, writeSet:Iterable}} a
 * @param {{readSet:Iterable, writeSet:Iterable}} b
 * @returns {{ writeSkew:boolean, rwAtoB:boolean, rwBtoA:boolean }}
 */
export function detectWriteSkew(a, b) {
  const rwAtoB = intersects(a.readSet ?? [], b.writeSet ?? []); // A read what B wrote
  const rwBtoA = intersects(b.readSet ?? [], a.writeSet ?? []); // B read what A wrote
  return { writeSkew: rwAtoB && rwBtoA, rwAtoB, rwBtoA };
}
