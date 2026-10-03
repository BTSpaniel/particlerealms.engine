// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/entity/ProvenanceStore.js — every observation, inference, prediction,
// and commit carries provenance (spec §14, rule 4). Vocabulary follows W3C PROV
// (entities, activities, agents, generation, derivation). Provenance lets the
// engine distinguish directly-observed vs inferred vs model-predicted vs stale
// vs untrusted data — crucial for the prompt-injection boundary (spec §15):
// retrieved/tool/model content is recorded as untrusted observation, never as
// authority.

export const CERTAINTY = Object.freeze({
  OBSERVED: 'observed',           // directly sensed / retrieved
  AUTHORITY_CONFIRMED: 'authority-confirmed',
  INFERRED: 'inferred',
  MODEL_PREDICTED: 'model-predicted',
  USER_ASSERTED: 'user-asserted',
  UNTRUSTED: 'untrusted',         // external/tool/model text — NOT policy
});

/**
 * Build a provenance record for a subject (a fact, version, or transaction).
 * @param {object} p
 * @param {string} p.source        e.g. 'tool:file-reader'
 * @param {string} [p.sourceEntity]
 * @param {string} [p.generatedBy] activity id
 * @param {string} [p.attributedTo] agent id
 * @param {number} [p.certainty]   0..1 confidence
 * @param {string} [p.kind]        one of CERTAINTY
 * @param {number} [p.freshnessEpoch]
 * @param {string[]} [p.derivations]
 */
export function makeProvenance(p = {}) {
  return Object.freeze({
    source: String(p.source ?? 'unknown'),
    sourceEntity: p.sourceEntity ?? null,
    generatedBy: p.generatedBy ?? null,
    attributedTo: p.attributedTo ?? null,
    certainty: typeof p.certainty === 'number' ? Math.max(0, Math.min(1, p.certainty)) : 1.0,
    kind: p.kind ?? CERTAINTY.OBSERVED,
    freshnessEpoch: p.freshnessEpoch ?? null,
    derivations: Object.freeze([...(p.derivations ?? [])].map(String)),
  });
}

/** True if a provenance record came from an untrusted external source. */
export function isUntrusted(prov) {
  return !prov || prov.kind === CERTAINTY.UNTRUSTED;
}

export class ProvenanceStore {
  constructor() { this._bySubject = new Map(); }

  /** Attach provenance to a subject id (appends — provenance is append-only). */
  record(subjectId, prov) {
    const id = String(subjectId);
    if (!this._bySubject.has(id)) this._bySubject.set(id, []);
    this._bySubject.get(id).push(makeProvenance(prov));
    return this;
  }

  /** All provenance records for a subject (frozen copy). */
  get(subjectId) { return Object.freeze([...(this._bySubject.get(String(subjectId)) ?? [])]); }

  get size() { return this._bySubject.size; }
}
