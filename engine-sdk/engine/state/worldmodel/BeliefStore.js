// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/worldmodel/BeliefStore.js — separates the AI's belief model from
// canonical state (spec §15, rules 46–48).
//
// The world model maintains five strictly-separated worlds:
//
//   CANONICAL — authoritative committed state (mirror, written ONLY by commit)
//   OBSERVED  — currently sensed / retrieved information
//   BELIEF    — inferences and uncertain interpretations
//   PREDICTED — counterfactual futures from the model/sandbox
//   PROPOSED  — the branch an agent wants to commit
//
// Hard rule (47): a prediction or belief can NEVER become canonical directly.
// This store exposes NO method to write CANONICAL except `syncCanonical`, which
// represents the commit gate mirroring an already-committed result back into the
// model. predict()/believe()/observe()/propose() can never touch it.
//
// Rule 48: uncertainty grows with prediction horizon unless new evidence reduces
// it — predict() decays confidence by horizon; observe() can restore it.

import { CERTAINTY } from '../entity/ProvenanceStore.js';
import { clamp as clampScalar } from '../../core/math/MathScalar.js';

export const WORLD = Object.freeze({
  CANONICAL: 'canonical',
  OBSERVED: 'observed',
  BELIEF: 'belief',
  PREDICTED: 'predicted',
  PROPOSED: 'proposed',
});

const clamp01 = (x) => Math.max(0, clampScalar(x, 0, 1));

export class BeliefStore {
  /** @param {object} [opts] @param {number} [opts.decay] per-horizon confidence decay (0..1) */
  constructor(opts = {}) {
    this._decay = opts.decay ?? 0.7;
    this._layers = {
      [WORLD.CANONICAL]: new Map(),
      [WORLD.OBSERVED]: new Map(),
      [WORLD.BELIEF]: new Map(),
      [WORLD.PREDICTED]: new Map(),
      [WORLD.PROPOSED]: new Map(),
    };
  }

  /** Read a belief record from a layer, or null. */
  get(subject, layer = WORLD.BELIEF) { return this._layers[layer]?.get(String(subject)) ?? null; }

  /** Current canonical value mirror (read-only here). */
  canonical(subject) { return this._layers[WORLD.CANONICAL].get(String(subject)) ?? null; }

  /**
   * Mirror an already-committed value into the canonical world. This is the ONLY
   * path to CANONICAL and is meant to be called by the commit layer after a
   * witnessed commit — never by inference or prediction.
   */
  syncCanonical(subject, value) {
    this._layers[WORLD.CANONICAL].set(String(subject), Object.freeze({
      subject: String(subject), value, kind: CERTAINTY.AUTHORITY_CONFIRMED, confidence: 1.0,
    }));
    return this;
  }

  /** Record a direct observation (high confidence, resets/raises certainty). */
  observe(subject, value, { confidence = 0.9, freshnessEpoch = null, source = 'sensor' } = {}) {
    return this._set(WORLD.OBSERVED, subject, value, {
      kind: CERTAINTY.OBSERVED, confidence: clamp01(confidence), freshnessEpoch, source, horizon: 0,
    });
  }

  /** Record an inference (belief), optionally derived from other subjects. */
  believe(subject, value, { confidence = 0.6, derivedFrom = [] } = {}) {
    return this._set(WORLD.BELIEF, subject, value, {
      kind: CERTAINTY.INFERRED, confidence: clamp01(confidence), derivedFrom: [...derivedFrom], horizon: 0,
    });
  }

  /**
   * Record a model prediction at a given horizon. Confidence decays with the
   * horizon (rule 48): further-out predictions are less certain.
   */
  predict(subject, value, { confidence = 0.8, horizon = 1 } = {}) {
    const decayed = clamp01(confidence * Math.pow(this._decay, Math.max(0, horizon)));
    return this._set(WORLD.PREDICTED, subject, value, {
      kind: CERTAINTY.MODEL_PREDICTED, confidence: decayed, horizon,
    });
  }

  /** Stage a proposed value (a commit candidate) — still NOT canonical. */
  propose(subject, value, { confidence = 0.5 } = {}) {
    return this._set(WORLD.PROPOSED, subject, value, { kind: CERTAINTY.INFERRED, confidence: clamp01(confidence), horizon: 0 });
  }

  _set(layer, subject, value, meta) {
    const rec = Object.freeze({ subject: String(subject), value, ...meta });
    this._layers[layer].set(String(subject), rec);
    return rec;
  }
}
