// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/worldmodel/CausalDynamics.js — AI World Model causal-dynamics model
// (spec §15 "Causal dynamics model", rules 47–49).
//
// Predicts how the world MAY change under an action: a registry of declared
// transition functions, each producing a predicted next state plus an effect
// summary the sandbox/planner can score. Predictions are hypotheses only — they
// never mutate canonical state (rule 47). An unknown action is reported as
// `known:false` and leaves state unchanged rather than guessing. The model also
// learns from outcomes: feeding observed effects back adjusts a per-action
// confidence so planning becomes calibrated (rule 49), pairing with
// ToolEffectModel's discrepancy tracking.

const deepClone = (s) => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

export class CausalDynamics {
  constructor() {
    this._models = new Map(); // action → { transition, effects, confidence, trials }
  }

  /**
   * Declare the dynamics of an action.
   * @param {string} action
   * @param {(state:*, params:object)=>*} transition pure next-state function
   * @param {object} [opts] @param {object} [opts.effects] declared effect summary
   *        @param {number} [opts.confidence] prior confidence (0..1)
   */
  declare(action, transition, opts = {}) {
    if (typeof transition !== 'function') throw new TypeError('declare: transition must be a function');
    this._models.set(String(action), {
      transition, effects: opts.effects ?? {}, confidence: opts.confidence ?? 0.7, trials: 0,
    });
    return this;
  }

  knows(action) { return this._models.has(String(action)); }

  /**
   * Predict the next state under an action. Never mutates `state` (clones first)
   * and never invents dynamics for an unknown action.
   * @returns {{ known:boolean, predictedState:*, effects:object, confidence:number }}
   */
  predict(state, action, params = {}) {
    const m = this._models.get(String(action));
    if (!m) return { known: false, predictedState: deepClone(state), effects: {}, confidence: 0 };
    const predictedState = m.transition(deepClone(state), params);
    return { known: true, predictedState, effects: { ...m.effects }, confidence: m.confidence };
  }

  /**
   * Calibrate an action's confidence from an observed discrepancy in [0,1]
   * (0 = perfect prediction). Confidence is the running mean accuracy.
   */
  learn(action, discrepancy) {
    const m = this._models.get(String(action));
    if (!m) return false;
    const accuracy = 1 - Math.max(0, Math.min(1, discrepancy));
    m.trials += 1;
    m.confidence = m.confidence + (accuracy - m.confidence) / m.trials; // incremental mean
    return true;
  }

  confidenceOf(action) { return this._models.get(String(action))?.confidence ?? null; }
}
