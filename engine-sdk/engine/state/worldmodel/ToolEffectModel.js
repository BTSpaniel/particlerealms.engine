// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/worldmodel/ToolEffectModel.js — expected-vs-observed tool consequences
// and a discrepancy learner (spec §15 "Tool effect model" + "Discrepancy
// learner", rule 49/51).
//
// For each tool the model records what it EXPECTED to happen; after the action
// the actual result is observed and compared. The discrepancy updates a running
// calibration score so the planner learns which tools are reliable. World-model
// quality is judged by action outcomes and calibration — not appearance (rule
// 51). The agent re-observes after acting (rule 49); this is where that loop is
// closed.

/** Distance between an expected and an observed effect map (0 = exact match). */
function discrepancy(expected = {}, observed = {}) {
  const keys = new Set([...Object.keys(expected), ...Object.keys(observed)]);
  if (keys.size === 0) return 0;
  let mismatches = 0;
  for (const k of keys) {
    const e = expected[k], o = observed[k];
    if (typeof e === 'number' && typeof o === 'number') {
      const denom = Math.max(1, Math.abs(e), Math.abs(o));
      mismatches += Math.min(1, Math.abs(e - o) / denom);
    } else if (JSON.stringify(e) !== JSON.stringify(o)) {
      mismatches += 1;
    }
  }
  return mismatches / keys.size; // 0..1
}

export class ToolEffectModel {
  constructor() {
    this._tools = new Map(); // tool → { trials, totalError, lastError, history:[] }
  }

  /** Declare the expected effects of invoking a tool (before acting). */
  expect(tool, expectedEffects = {}) {
    const t = this._tool(String(tool));
    t.pendingExpected = { ...expectedEffects };
    return this;
  }

  /**
   * Observe the actual effects after acting. Compares against the last declared
   * expectation, updates calibration, and returns the discrepancy in [0,1].
   * Re-observation (rule 49) — never assume the action did what was predicted.
   */
  observe(tool, observedEffects = {}) {
    const t = this._tool(String(tool));
    const expected = t.pendingExpected ?? {};
    const err = discrepancy(expected, observedEffects);
    t.trials += 1;
    t.totalError += err;
    t.lastError = err;
    t.history.push({ expected, observed: { ...observedEffects }, error: err });
    t.pendingExpected = null;
    return err;
  }

  /** Calibration summary for a tool: trials, average error, last error. */
  calibration(tool) {
    const t = this._tools.get(String(tool));
    if (!t || t.trials === 0) return { trials: 0, avgError: null, lastError: null, reliability: null };
    const avgError = t.totalError / t.trials;
    return { trials: t.trials, avgError, lastError: t.lastError, reliability: 1 - avgError };
  }

  _tool(tool) {
    if (!this._tools.has(tool)) this._tools.set(tool, { trials: 0, totalError: 0, lastError: null, pendingExpected: null, history: [] });
    return this._tools.get(tool);
  }
}
