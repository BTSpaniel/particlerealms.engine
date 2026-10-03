// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/observer/Projection.js — the observer creates EXPERIENCED order.
//
// Core truth may be unordered or branched. An observer sees one path, but that
// is only a projection: render order is not truth, UI order is not truth,
// debug order is not truth. Only committed facts are canonical — so every
// projection here carries `isTruth: false` and a witness. Turning a projection
// into truth requires a CommitGate.

import { toposort } from '../facts/Causality.js';
import { makeWitness } from '../witness/Witness.js';

/**
 * Project one experienced sequence from a fact store. Independent facts stay
 * deterministically ordered (reproducible), causal links force precedence.
 * @returns {Readonly<{ sequence:string[], isTruth:false, witness:object }>}
 */
export function projectSequence(store, links = []) {
  const live = [...store.live()];
  const sequence = toposort(live, links);
  return Object.freeze({
    sequence,
    isTruth: false,
    witness: makeWitness({ inputFacts: live, chosenProjection: 'observer-sequence' }),
  });
}

/**
 * Choose one branch for an observer to experience. Does NOT commit — the other
 * branches remain possible (recorded as "rejected/not observed" in the witness)
 * until a CommitGate finalizes one as canonical.
 * @param {FactStore[]} branches
 * @param {(branches:FactStore[])=>number} [selector] returns chosen index
 * @returns {Readonly<{ index:number, branch:FactStore, isTruth:false, witness:object }>}
 */
export function chooseBranch(branches, selector = () => 0) {
  if (!branches.length) throw new Error('chooseBranch: no branches');
  const index = Math.max(0, Math.min(branches.length - 1, selector(branches) | 0));
  const chosen = branches[index];
  const rejected = branches
    .map((b, i) => (i === index ? null : { id: `branch[${i}]`, reason: 'not observed (still possible)' }))
    .filter(Boolean);
  return Object.freeze({
    index,
    branch: chosen,
    isTruth: false,
    witness: makeWitness({ chosenProjection: chosen.liveId(), rejectedBranches: rejected, commitReason: null }),
  });
}
