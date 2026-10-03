// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/sim/WorldDynamics.js — deterministic stepped world dynamics over
// simulation time (spec §17 CPU deterministic core, rules 66/68 deterministic
// replay).
//
// World dynamics advance simulated state one tick at a time. To keep canonical
// state reproducible (and replayable for verification), any randomness comes
// from a SEEDED deterministic PRNG — never Math.random or wall-clock. Running the
// same dynamics from the same seed and inputs always yields byte-identical
// results, which deterministic replay and fault-injection testing depend on.

import { hashIdFast } from '../util/canonical.js';
import { hashIdTailUint32 } from '../util/hashing.js';

const deepClone = (s) => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

/** mulberry32 — a small, fast, fully deterministic PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a 32-bit numeric seed from any seed value via the canonical fast hash. */
function seedToInt(seed) {
  return hashIdTailUint32(hashIdFast(seed ?? 'seed'));
}

export class WorldDynamics {
  /**
   * @param {object} cfg
   * @param {(state:*, ctx:{dt:number, tick:number, rand:()=>number})=>*} cfg.step
   * @param {*} [cfg.seed] deterministic seed (any canonicalizable value)
   */
  constructor(cfg = {}) {
    if (typeof cfg.step !== 'function') throw new TypeError('WorldDynamics requires a step function');
    this._step = cfg.step;
    this._seed = cfg.seed ?? 'world';
  }

  /**
   * Advance `initialState` for `steps` ticks on `clock`, deterministically. Never
   * mutates the input. The PRNG is re-seeded from the configured seed on every
   * run, so `run` is referentially transparent for the same arguments.
   * @param {*} initialState
   * @param {import('../time/SimulationClock.js').SimulationClock} clock
   * @param {{ steps?:number, dt?:number }} [opts]
   * @returns {{ state:*, ticks:number[] }}
   */
  run(initialState, clock, { steps = 1, dt = 1 } = {}) {
    const rand = mulberry32(seedToInt(this._seed));
    let state = deepClone(initialState);
    const ticks = [];
    for (let i = 0; i < steps; i++) {
      const tick = clock.step(1);
      ticks.push(tick);
      state = this._step(deepClone(state), { dt, tick, rand });
    }
    return { state, ticks };
  }
}
