// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/worldmodel/UntrustedBoundary.js — the prompt-injection boundary
// (spec §15 "Prompt-injection boundary", rules 33, 50).
//
// All webpages, files, emails, tool outputs, other agents, and generated text
// are UNTRUSTED OBSERVATIONS — never authority instructions. This boundary is
// the single chokepoint where such content enters the world model: it wraps the
// content as an untrusted observation (CERTAINTY.UNTRUSTED) and makes it
// structurally impossible to treat as policy or to mint authority from it.
//
// The model MAY observe broadly, infer cautiously, propose actions, and simulate
// futures. It MAY NOT mint authority, bypass capabilities, declare its prediction
// canonical, or treat retrieved text as trusted policy. Authority decisions live
// OUTSIDE the model (capability + commit), so this module deliberately exposes no
// path from untrusted content to a capability or a canonical write.

import { CERTAINTY, makeProvenance } from '../entity/ProvenanceStore.js';

/**
 * Ingest external/tool/model content as an untrusted observation. The returned
 * record is explicitly non-authoritative and carries untrusted provenance.
 * @param {string} content
 * @param {object} [meta] @param {string} [meta.source] @param {number} [meta.freshnessEpoch]
 * @returns {object} frozen untrusted observation record
 */
export function ingestUntrusted(content, meta = {}) {
  return Object.freeze({
    content: String(content),
    isAuthority: false,           // hard invariant — never authority (rule 50)
    isPolicy: false,
    canCommit: false,             // cannot directly drive a canonical write (rule 47)
    provenance: makeProvenance({
      source: meta.source ?? 'external',
      kind: CERTAINTY.UNTRUSTED,
      certainty: 0,
      freshnessEpoch: meta.freshnessEpoch ?? null,
    }),
  });
}

/** True only for records that may carry authority. Untrusted records: always false. */
export function canAuthorize(record) {
  return !!record && record.isAuthority === true && record?.provenance?.kind !== CERTAINTY.UNTRUSTED;
}

export class UntrustedBoundary {
  constructor() { this._records = []; }

  /** Wrap and retain a piece of untrusted content; returns the observation. */
  observe(content, meta = {}) { const r = ingestUntrusted(content, meta); this._records.push(r); return r; }

  get size() { return this._records.length; }

  /**
   * Attempt to derive a capability from untrusted content. This ALWAYS refuses —
   * models/agents cannot mint their own authority (rule 33). Encoded as a method
   * so the refusal is explicit and testable, not merely an absent feature.
   * @returns {{ minted:false, reason:string }}
   */
  mintCapabilityFrom(_record) {
    return { minted: false, reason: 'untrusted-content-cannot-mint-authority' };
  }

  /**
   * Convert untrusted content into a belief-layer observation for the world
   * model. It enters as an uncertain OBSERVATION the planner may reason about —
   * never as policy or canonical state.
   */
  toObservation(record) {
    return Object.freeze({
      value: record.content,
      kind: CERTAINTY.UNTRUSTED,
      confidence: 0,
      trustedAsAuthority: false,
    });
  }
}
