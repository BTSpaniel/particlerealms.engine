// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/time/SimulationClock.js — simulation time (spec §9 "Simulation time").
//
// Simulation time is a domain-specific relationship between simulated changes
// (physics steps, biological cycles, world epochs, oscillator phases). There may
// be MANY simulation clocks and NO universal model clock — each advances
// independently. Simulation clocks are distinct from causal time (dependencies)
// and operational time (deadlines/leases); they never establish authority.
//
// Advancing is deterministic: the same sequence of steps yields the same tick,
// which is required for deterministic replay (rule 66/68).

export class SimulationClock {
  /**
   * @param {string} name      domain label, e.g. 'physics' | 'biology' | 'epoch'
   * @param {object} [opts]
   * @param {number} [opts.rate] sim-units advanced per step (default 1)
   */
  constructor(name, opts = {}) {
    this._name = String(name);
    this._rate = opts.rate ?? 1;
    this._tick = 0;
    this._steps = 0;
  }

  get name() { return this._name; }
  now() { return this._tick; }
  steps() { return this._steps; }

  /** Advance the clock by `n` steps (deterministic). Returns the new tick. */
  step(n = 1) {
    if (!Number.isFinite(n) || n < 0) throw new RangeError('step count must be ≥ 0');
    this._tick += this._rate * n;
    this._steps += n;
    return this._tick;
  }

  reset() { this._tick = 0; this._steps = 0; return this; }
}

/**
 * A set of independent simulation clocks. Each domain advances on its own; there
 * is deliberately no method to advance them all in lockstep to a global time.
 */
export class SimulationClockSet {
  constructor() { this._clocks = new Map(); }

  /** Create or fetch a clock for a domain. */
  clock(name, opts) {
    const key = String(name);
    if (!this._clocks.has(key)) this._clocks.set(key, new SimulationClock(key, opts));
    return this._clocks.get(key);
  }

  /** Snapshot of every clock's current tick — clocks may differ; that's expected. */
  snapshot() {
    const out = {};
    for (const [name, c] of this._clocks) out[name] = c.now();
    return out;
  }

  get size() { return this._clocks.size; }
}
