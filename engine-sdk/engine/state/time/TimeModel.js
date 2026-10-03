// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/time/TimeModel.js — time is NOT a counter.
//
// A state only has "time" if it subscribes to a time source. Real time =
// change + comparison + memory + causality + irreversible direction. Different
// sources express different truths; a state can be timeless (NONE) while an
// observer experiences progression.

export const TIME_MODES = Object.freeze({
  NONE: 'none',         // no progression
  CAUSAL: 'causal',     // progresses only through dependency rules
  CLOCKED: 'clocked',   // progresses by comparing to an internal oscillator
  ENTROPIC: 'entropic', // progresses through irreversible change (monotonic)
  OBSERVER: 'observer', // progresses only when viewed / interacted with
  MEMORY: 'memory',     // progresses by distance from previous states
  HYBRID: 'hybrid',     // multiple sources
});

/**
 * Create a time source. `step(input)` advances per-mode and returns the new
 * value; the engine never does `time++` globally.
 *   CAUSAL    input.causalSteps
 *   CLOCKED   input.dt (oscillator phase)
 *   ENTROPIC  input.irreversibleChange (abs — monotonic)
 *   OBSERVER  input.observed (boolean)
 *   MEMORY    input.stateDistance (>= 0)
 *   HYBRID    any combination of the above
 */
export function createTimeSource(mode = TIME_MODES.NONE) {
  let value = 0;
  return {
    mode,
    now() { return value; },
    reset() { value = 0; return value; },
    step(input = {}) {
      switch (mode) {
        case TIME_MODES.NONE: break;
        case TIME_MODES.CAUSAL: value += (input.causalSteps | 0); break;
        case TIME_MODES.CLOCKED: value += (input.dt || 0); break;
        case TIME_MODES.ENTROPIC: value += Math.abs(input.irreversibleChange || 0); break;
        case TIME_MODES.OBSERVER: value += input.observed ? 1 : 0; break;
        case TIME_MODES.MEMORY: value += Math.max(0, input.stateDistance || 0); break;
        case TIME_MODES.HYBRID:
          value += (input.dt || 0)
            + (input.observed ? 1 : 0)
            + Math.abs(input.irreversibleChange || 0)
            + Math.max(0, input.stateDistance || 0)
            + (input.causalSteps | 0);
          break;
        default: break;
      }
      return value;
    },
  };
}
