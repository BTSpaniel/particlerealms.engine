// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CombustionModel.js - Fire/Combustion Synthesis Model
 * 
 * Combines Crackle + Hiss + Rumble atoms mixed by intensity.
 * Low intensity = gentle crackle. High intensity = roaring fire with rumble.
 * Driven by: emitRate, temperature
 */

/**
 * Generate a Combustion model patch descriptor.
 * @param {Object} config
 * @param {number} config.intensity - Fire intensity 0-1 (default 0.5)
 * @param {number} config.volume - Output volume (default 0.6)
 * @returns {Object} Patch JSON
 */
let _combustionPatchSequence = 0;
function _newCombustionPatchId() { return `combustion_${Date.now()}_${++_combustionPatchSequence}`; }

export function createCombustionPatch(config = {}) {
  const intensity = config.intensity ?? 0.5;
  const volume = config.volume ?? 0.6;

  // Scale sub-component volumes by intensity
  const crackleVol = 0.3 + intensity * 0.4;
  const hissVol = intensity * 0.3;
  const rumbleVol = Math.max(0, (intensity - 0.3) * 0.5);

  return {
    id: _newCombustionPatchId(),
    name: 'Combustion Model',
    nodes: [
      // Crackle layer
      { id: 'crk_imp', type: 'Impulse', params: { rate: 20 + intensity * 80, jitter: 0.8 } },
      { id: 'crk_bp', type: 'Filter', params: { type: 'bandpass', frequency: 800 + intensity * 3000, Q: 2.0 } },
      { id: 'crk_gain', type: 'Gain', params: { volume: crackleVol } },

      // Hiss layer
      { id: 'hiss_noise', type: 'NoiseGenerator', params: { color: 'white' } },
      { id: 'hiss_hp', type: 'Filter', params: { type: 'highpass', frequency: 1500 + intensity * 2000, Q: 0.7 } },
      { id: 'hiss_gain', type: 'Gain', params: { volume: hissVol } },

      // Rumble layer
      { id: 'rum_noise', type: 'NoiseGenerator', params: { color: 'brown' } },
      { id: 'rum_lp', type: 'Filter', params: { type: 'lowpass', frequency: 60 + intensity * 40, Q: 1.0 } },
      { id: 'rum_gain', type: 'Gain', params: { volume: rumbleVol } },

      // Modulation — LFO flicker
      { id: 'lfo', type: 'LFO', params: { rate: 3 + intensity * 5, depth: 0.15, shape: 'sine' } },

      // Mix
      { id: 'sum1', type: 'MathOp', params: { operation: 'add' } },
      { id: 'sum2', type: 'MathOp', params: { operation: 'add' } },

      // Flicker modulation
      { id: 'flickerBias', type: 'MathOp', params: { operation: 'add', operand: 1.0 } },
      { id: 'flickerMul', type: 'MathOp', params: { operation: 'mul' } },

      // Output
      { id: 'outGain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      // Crackle chain
      { from: 'crk_imp:out', to: 'crk_bp:in' },
      { from: 'crk_bp:out', to: 'crk_gain:in' },

      // Hiss chain
      { from: 'hiss_noise:out', to: 'hiss_hp:in' },
      { from: 'hiss_hp:out', to: 'hiss_gain:in' },

      // Rumble chain
      { from: 'rum_noise:out', to: 'rum_lp:in' },
      { from: 'rum_lp:out', to: 'rum_gain:in' },

      // Sum layers
      { from: 'crk_gain:out', to: 'sum1:a' },
      { from: 'hiss_gain:out', to: 'sum1:b' },
      { from: 'sum1:out', to: 'sum2:a' },
      { from: 'rum_gain:out', to: 'sum2:b' },

      // Flicker: LFO + 1.0 bias → multiply with sum
      { from: 'lfo:out', to: 'flickerBias:a' },
      { from: 'sum2:out', to: 'flickerMul:a' },
      { from: 'flickerBias:out', to: 'flickerMul:b' },

      // Output
      { from: 'flickerMul:out', to: 'outGain:in' },
      { from: 'outGain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'crk_imp.rate', name: 'combustion.crackleRate', range: [5, 200] },
      { param: 'crk_bp.frequency', name: 'combustion.brightness', range: [500, 6000] },
      { param: 'hiss_gain.volume', name: 'combustion.hissLevel', range: [0, 1] },
      { param: 'rum_gain.volume', name: 'combustion.rumbleLevel', range: [0, 1] },
      { param: 'outGain.volume', name: 'combustion.volume', range: [0, 2] },
    ],
  };
}
