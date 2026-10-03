// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/facts/Branch.js — split non-commuting possibilities; merge equivalent;
// prune invalid.
//
// Core law: "If A + B = B + A, merge them. If A + B != B + A, branch them."
// An operation is a pure function (store) => void that adds facts / tombstones.

import { validateFacts, SCOPE_COMMIT } from './Constraints.js';

/** Apply a sequence of operations to a (cloned) store. Returns the store. */
export function applySequence(store, ops) {
  for (const op of ops) op(store);
  return store;
}

/**
 * Does applying opA then opB yield the same projection as opB then opA?
 * @returns {{ commutes:boolean, ab:FactStore, ba:FactStore }}
 */
export function commutes(base, opA, opB) {
  const ab = applySequence(base.clone(), [opA, opB]);
  const ba = applySequence(base.clone(), [opB, opA]);
  return { commutes: ab.liveId() === ba.liveId(), ab, ba };
}

/** Produce both order-branches [A→B, B→A] from a base store. */
export function branchOrders(base, opA, opB) {
  return [applySequence(base.clone(), [opA, opB]), applySequence(base.clone(), [opB, opA])];
}

/** Collapse branches with identical projections (merge equivalent). */
export function mergeEquivalent(stores) {
  const byId = new Map();
  for (const s of stores) { const k = s.liveId(); if (!byId.has(k)) byId.set(k, s); }
  return [...byId.values()];
}

/** Drop branches that fail commit-strength constraints (prune invalid). */
export function prune(stores, constraints) {
  return stores.filter((s) => validateFacts(s.live(), constraints, { phase: SCOPE_COMMIT }).ok);
}
