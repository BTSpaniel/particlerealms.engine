// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FluidModel.js - Fluid/Water Synthesis Model
 * 
 * Combines Drop atoms (splashes) + Hiss (flow) for liquid sounds.
 * Driven by: emitRate, velocity, splash rate
 */

/**
 * Generate a Fluid model patch descriptor.
 * @param {Object} config
 * @param {number} config.splashRate - Drops per second (default 10)
 * @param {number} config.flowLevel - Continuous flow hiss level (default 0.3)
 * @param {number} config.volume - Output volume (default 0.5)
 * @returns {Object} Patch JSON
 */
let _fluidPatchSequence = 0;
function _newFluidPatchId() { return `fluid_${Date.now()}_${++_fluidPatchSequence}`; }

export function createFluidPatch(config = {}) {
  const splashRate = config.splashRate ?? 10;
  const flowLevel = config.flowLevel ?? 0.3;
  const volume = config.volume ?? 0.5;

  return {
    id: _newFluidPatchId(),
    name: 'Fluid Model',
    nodes: [
      // Drop layer — stochastic water drops
      { id: 'drop_imp', type: 'Impulse', params: { rate: splashRate, jitter: 0.7 } },
      { id: 'drop_osc', type: 'Oscillator', params: { frequency: 400, shape: 'sine' } },
      { id: 'drop_env', type: 'Envelope', params: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.01 } },
      { id: 'drop_mul', type: 'MathOp', params: { operation: 'mul' } },
      { id: 'drop_gain', type: 'Gain', params: { volume: 0.5 } },

      // Flow layer — continuous filtered noise
      { id: 'flow_noise', type: 'NoiseGenerator', params: { color: 'pink' } },
      { id: 'flow_bp', type: 'Filter', params: { type: 'bandpass', frequency: 600, Q: 1.5 } },
      { id: 'flow_gain', type: 'Gain', params: { volume: flowLevel } },

      // Pitch variation — slow LFO on drop frequency
      { id: 'pitch_lfo', type: 'LFO', params: { rate: 0.5, depth: 100, shape: 'sine' } },
      { id: 'pitch_add', type: 'MathOp', params: { operation: 'add', operand: 400 } },

      // Mix
      { id: 'sum', type: 'MathOp', params: { operation: 'add' } },
      { id: 'outGain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      // Drop chain
      { from: 'drop_imp:out', to: 'drop_env:gate' },
      { from: 'drop_osc:out', to: 'drop_mul:a' },
      { from: 'drop_env:out', to: 'drop_mul:b' },
      { from: 'drop_mul:out', to: 'drop_gain:in' },

      // Flow chain
      { from: 'flow_noise:out', to: 'flow_bp:in' },
      { from: 'flow_bp:out', to: 'flow_gain:in' },

      // Sum
      { from: 'drop_gain:out', to: 'sum:a' },
      { from: 'flow_gain:out', to: 'sum:b' },
      { from: 'sum:out', to: 'outGain:in' },
      { from: 'outGain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'drop_imp.rate', name: 'fluid.splashRate', range: [0.5, 100] },
      { param: 'drop_osc.frequency', name: 'fluid.dropPitch', range: [100, 2000] },
      { param: 'flow_gain.volume', name: 'fluid.flowLevel', range: [0, 1] },
      { param: 'outGain.volume', name: 'fluid.volume', range: [0, 2] },
    ],
  };
}
