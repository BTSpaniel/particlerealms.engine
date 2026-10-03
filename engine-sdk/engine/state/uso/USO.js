// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/uso/USO.js — Unspent State Output: the single-spend primitive (spec §5).
//
// Adapted from Bitcoin's UTXO model: an exclusive, consumable, finalizable, or
// scarce resource. A transaction consumes inputs and creates replacement
// outputs; a consumed output can never be accepted again. Spendability
// (defined here) is separate from which conflicting spend wins (decided by the
// commit coordinator), exactly as Bitcoin separates outputs from consensus.
//
// Use USOs for: exclusive ownership, scarce inventory, single-winner decisions,
// object-mutation rights, permission use, branch finalization, irreversible
// commits. Do NOT use them for hover/particles/observations/debug notes.

import { hashIdFast } from '../util/canonical.js';

export const USO_KIND = Object.freeze({
  OBJECT_VERSION: 'object-version', // mutable object's current writable version
  RESOURCE: 'resource',             // scarce/fungible quantity
  CAPABILITY: 'capability',         // single-use permission (itself a USO)
  DECISION: 'decision',             // single-winner choice / branch finalization
});

/**
 * Create an unspent state output. The id is derived from kind + entity + a
 * discriminator (e.g. version) so distinct outputs get distinct ids and equal
 * ones collapse. Payload is opaque domain data.
 *
 * @param {object} spec
 * @param {string} spec.kind        one of USO_KIND
 * @param {string} spec.entity      logical entity this output belongs to
 * @param {string|number} [spec.discriminator] version / serial / denomination
 * @param {*}      [spec.payload]   opaque domain data (quantity, owner, etc.)
 * @returns {object} frozen USO with a stable `id`
 */
export function makeUSO(spec = {}) {
  const kind = String(spec.kind ?? USO_KIND.OBJECT_VERSION);
  const entity = String(spec.entity ?? '');
  const discriminator = spec.discriminator ?? null;
  const core = { kind, entity, discriminator, payload: spec.payload ?? null };
  const id = spec.id ?? `${kind}:${entity}:${hashIdFast(core)}`;
  return Object.freeze({ id, ...core });
}

/** Convenience: an object-version output (the common mutable-object case). */
export function objectVersionOutput(entity, versionId, payload = null) {
  return makeUSO({
    kind: USO_KIND.OBJECT_VERSION,
    entity,
    discriminator: versionId,
    payload,
    id: `${USO_KIND.OBJECT_VERSION}:${entity}:${versionId}`,
  });
}

/** True if a value looks like a USO (has a string id and a kind). */
export function isUSO(v) {
  return !!v && typeof v.id === 'string' && typeof v.kind === 'string';
}
