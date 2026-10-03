// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/integrity/StateRoot.js — Merkle-style canonical state root (spec §13,§19).
//
// A state root is the hash of the canonical, ORDER-INDEPENDENT summary of the
// authoritative state: the live fact set, the unspent-output id set, and the
// entity head version ids. The committed state root must exactly match the
// committed outputs (safety invariant). A hash proves exact content only — not
// correctness — so the root is used for integrity/restoration, never as a
// semantic-truth or authority claim (spec rule 52).

import { hashIdFast } from '../util/canonical.js';

/**
 * Compute a state root from the authoritative components. Any iterable is
 * accepted; members are sorted for order-independence.
 * @param {object} parts
 * @param {Iterable<string>} [parts.facts]      live fact strings
 * @param {Iterable<string>} [parts.unspent]    unspent USO ids
 * @param {Iterable<string>} [parts.entityHeads] entity head version ids
 * @returns {string} tagged state-root id
 */
export function computeStateRoot({ facts = [], unspent = [], entityHeads = [] } = {}) {
  const summary = {
    facts: [...new Set(Array.from(facts, String))].sort(),
    unspent: [...new Set(Array.from(unspent, String))].sort(),
    entityHeads: [...new Set(Array.from(entityHeads, String))].sort(),
  };
  return hashIdFast(summary, { schemaVersion: 'state-root-v1' });
}

/** Convenience: derive a state root from live engine registries. */
export function rootFromStores({ factStore = null, usoRegistry = null, entityRegistry = null } = {}) {
  return computeStateRoot({
    facts: factStore ? factStore.live() : [],
    unspent: usoRegistry ? usoRegistry.unspentIds() : [],
    entityHeads: entityRegistry ? entityRegistry.headIds() : [],
  });
}
