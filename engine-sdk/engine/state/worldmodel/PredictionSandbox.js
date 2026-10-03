// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/worldmodel/PredictionSandbox.js — isolated counterfactual rollouts
// (spec §15 "Prediction sandbox", rules 18, 47, 48).
//
// The model proposes multiple futures WITHOUT modifying canonical state. Every
// produced state is a prediction (`canonical:false`, `isTruth:false`) — it can
// only become real by being turned into a transaction and passing the commit
// gate. The sandbox enforces the §18 / §15 disciplines: short receding-horizon
// rollouts, branch budgets (width × depth), and uncertainty that grows with the
// horizon. To guarantee non-mutation it deep-clones the state before every
// transition, so even a transition that mutates its argument cannot touch the
// caller's canonical snapshot.

const deepClone = (s) => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

export class PredictionSandbox {
  /**
   * @param {object} cfg
   * @param {(state:*, action:*)=>*} cfg.transition pure-ish transition (cloned input)
   * @param {(state:*)=>number} [cfg.score]   value of a predicted state
   * @param {number} [cfg.decay]   per-depth confidence decay (uncertainty growth)
   * @param {number} [cfg.maxDepth] receding horizon cap
   * @param {number} [cfg.maxNodes] hard branch budget (state-space control, §18)
   */
  constructor(cfg = {}) {
    if (typeof cfg.transition !== 'function') throw new TypeError('PredictionSandbox requires a transition');
    this._transition = cfg.transition;
    this._score = cfg.score ?? (() => 0);
    this._decay = cfg.decay ?? 0.7;
    this._maxDepth = cfg.maxDepth ?? 3;
    this._maxNodes = cfg.maxNodes ?? 256;
  }

  /**
   * Explore futures from `initialState` by applying `actions` up to the horizon.
   * Never mutates `initialState`. Returns prediction branches; confidence decays
   * with depth (rule 48). Stops when the node budget is exhausted (rule 18).
   * @returns {{ branches:Array, truncated:boolean, canonical:false }}
   */
  rollout(initialState, actions = [], { depth = this._maxDepth } = {}) {
    const horizon = Math.min(depth, this._maxDepth);
    const branches = [];
    let nodes = 0;
    let truncated = false;

    const expand = (state, trace, d) => {
      if (d >= horizon || nodes >= this._maxNodes) { if (nodes >= this._maxNodes) truncated = true; return; }
      for (const action of actions) {
        if (nodes >= this._maxNodes) { truncated = true; return; }
        nodes++;
        const next = this._transition(deepClone(state), action); // clone → no mutation of canonical
        const confidence = Math.pow(this._decay, d + 1);
        const branch = {
          trace: [...trace, action], state: next, depth: d + 1, confidence,
          score: this._score(next), canonical: false, isTruth: false,
        };
        branches.push(branch);
        expand(next, branch.trace, d + 1);
      }
    };

    expand(initialState, [], 0);
    return { branches, truncated, canonical: false };
  }

  /**
   * Pick the best predicted branch by risk-adjusted value (score × confidence).
   * The winner is a PROPOSAL, not truth — committing it requires the commit gate.
   * @returns {{ best:object|null, considered:number }}
   */
  plan(initialState, actions = [], opts = {}) {
    const { branches } = this.rollout(initialState, actions, opts);
    let best = null;
    for (const b of branches) {
      const utility = b.score * b.confidence; // risk-sensitive: discount uncertain futures
      if (!best || utility > best.utility) best = { ...b, utility };
    }
    return { best, considered: branches.length };
  }
}
