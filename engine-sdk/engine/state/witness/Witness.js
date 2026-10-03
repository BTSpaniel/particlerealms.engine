// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/witness/Witness.js — debug proof for every projection / commit.
//
// Replaces "1 happened, 2 happened, 3 happened" timelines with:
//   these facts existed · these rules fired · these branches were possible ·
//   this projection was shown · this commit was chosen.

import { urcVersionStamp } from '../version.js';

/**
 * @param {object} w
 * @param {string[]} [w.inputFacts]
 * @param {string[]} [w.rulesUsed]
 * @param {string[]} [w.constraintsPassed]
 * @param {Array<{id?:string, reason?:string}>} [w.rejectedBranches]
 * @param {*} [w.chosenProjection]
 * @param {string|null} [w.commitReason]
 * @param {Array<number|string>} [w.codebookEntriesUsed]
 */
export function makeWitness(w = {}) {
  return Object.freeze({
    inputFacts: Object.freeze([...(w.inputFacts ?? [])]),
    rulesUsed: Object.freeze([...(w.rulesUsed ?? [])]),
    constraintsPassed: Object.freeze([...(w.constraintsPassed ?? [])]),
    rejectedBranches: Object.freeze([...(w.rejectedBranches ?? [])]),
    chosenProjection: w.chosenProjection ?? null,
    commitReason: w.commitReason ?? null,
    codebookEntriesUsed: Object.freeze([...(w.codebookEntriesUsed ?? [])]),
    version: urcVersionStamp(),
    at: w.at ?? null, // OPTIONAL observer timestamp — never canonical truth
  });
}

/**
 * Build a full CSE witness receipt for a transaction commit decision (spec §7).
 * The receipt proves WHAT was checked and WHAT the engine decided — it does not
 * claim the input observations were objectively true. Every committed
 * transition has exactly one receipt (safety invariant, spec §19).
 *
 * @param {object} r
 * @param {'committed'|'rejected'} r.decision
 * @param {string}   r.transactionID
 * @param {string}   [r.authority]            authority that decided
 * @param {string}   [r.preStateRoot]
 * @param {string}   [r.postStateRoot]
 * @param {string[]} [r.consumed]             USO ids consumed
 * @param {string[]} [r.created]              USO ids created
 * @param {string[]} [r.invariantsChecked]
 * @param {string}   [r.policyVersion]
 * @param {string}   [r.validatorVersion]
 * @param {string[]} [r.causalParents]
 * @param {string[]} [r.externalEffectsPending]
 * @param {string}   [r.rejection]            reason when decision === 'rejected'
 * @param {Array}    [r.violations]
 * @param {string|null} [r.signature]         authority signature over the receipt id
 */
export function makeReceipt(r = {}) {
  return Object.freeze({
    decision: r.decision === 'committed' ? 'committed' : 'rejected',
    transactionID: r.transactionID ?? null,
    authority: r.authority ?? null,
    preStateRoot: r.preStateRoot ?? null,
    postStateRoot: r.postStateRoot ?? null,
    consumed: Object.freeze([...(r.consumed ?? [])]),
    created: Object.freeze([...(r.created ?? [])]),
    invariantsChecked: Object.freeze([...(r.invariantsChecked ?? [])]),
    policyVersion: r.policyVersion ?? null,
    validatorVersion: r.validatorVersion ?? null,
    causalParents: Object.freeze([...(r.causalParents ?? [])]),
    externalEffectsPending: Object.freeze([...(r.externalEffectsPending ?? [])]),
    rejection: r.rejection ?? null,
    violations: Object.freeze([...(r.violations ?? [])]),
    signature: r.signature ?? null,
    version: urcVersionStamp(),
    at: r.at ?? null, // OPTIONAL operational timestamp — never canonical truth
  });
}
