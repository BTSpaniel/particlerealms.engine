// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/commit/CommitGate.js — only commit gates decide FINAL truth.
//
// Core law: "Similarity may suggest. Facts may branch. Constraints may reject.
// But only commit gates decide final truth." Used for the orderless-unsafe
// things: inventory, permissions, ownership, money, save overwrite, security,
// multiplayer hit-confirm, choosing a canonical branch.
//
// A commit applies a delta (adds + tombstones) to a CLONE of the base store,
// runs COMMIT-strength constraints, then an optional authority check. It never
// mutates the base — truth is the returned store, with a witness either way.

import { validateFacts, SCOPE_COMMIT } from '../facts/Constraints.js';
import { makeWitness } from '../witness/Witness.js';

/**
 * @param {object} cfg
 * @param {Array} [cfg.constraints]  commit-strength constraints
 * @param {(context:object)=>boolean} [cfg.authority]  e.g. signature / ownership check
 */
export function createCommitGate({ constraints = [], authority = null } = {}) {
  return {
    /**
     * @param {FactStore} base
     * @param {{ add?:string[], revoke?:string[], rule?:string }} [delta]
     * @param {{ reason?:string, context?:object }} [opts]
     * @returns {{ ok:boolean, committed:FactStore|null, rejection:string|null, violations?:Array, witness:object }}
     */
    commit(base, delta = {}, opts = {}) {
      const next = base.clone();
      for (const f of (delta.add || [])) next.add(f);
      for (const f of (delta.revoke || [])) next.revoke(f);

      const liveArr = [...base.live()];
      const check = validateFacts(next.live(), constraints, { phase: SCOPE_COMMIT });
      if (!check.ok) {
        return {
          ok: false, committed: null, rejection: 'constraint', violations: check.violations,
          witness: makeWitness({
            inputFacts: liveArr, commitReason: null,
            rejectedBranches: check.violations.map((v) => ({ id: v.id, reason: v.message })),
          }),
        };
      }
      if (authority && !authority(opts.context ?? {})) {
        return {
          ok: false, committed: null, rejection: 'authority',
          witness: makeWitness({
            inputFacts: liveArr, commitReason: null,
            rejectedBranches: [{ id: 'authority', reason: 'authority denied' }],
          }),
        };
      }
      return {
        ok: true, committed: next, rejection: null,
        witness: makeWitness({
          inputFacts: liveArr,
          rulesUsed: delta.rule ? [delta.rule] : [],
          constraintsPassed: constraints.map((c) => c.id),
          chosenProjection: next.liveId(),
          commitReason: opts.reason ?? 'commit',
        }),
      };
    },
  };
}
