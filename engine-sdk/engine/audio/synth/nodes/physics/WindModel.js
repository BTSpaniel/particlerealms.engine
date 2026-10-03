// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WindModel.js - Wind Synthesis Model
 * 
 * Combines Whoosh + Rumble, with gust modulation from WindSystem.
 * Driven by: windSpeed, gustiness
 */

/**
 * Generate a Wind model patch descriptor.
 * @param {Object} config
 * @param {number} config.speed - Wind speed, affects center frequency (default 5)
 * @param {number} config.gustiness - Gust modulation depth 0-1 (default 0.3)
 * @param {number} config.volume - Output volume (default 0.4)
 * @returns {Object} Patch JSON
 */
let _windPatchSequence = 0;
function _newWindPatchId() { return `wind_${Date.now()}_${++_windPatchSequence}`; }

export function createWindPatch(config = {}) {
  const speed = config.speed ?? 5;
  const gustiness = config.gustiness ?? 0.3;
  const volume = config.volume ?? 0.4;

  // Map wind speed to frequency range (200-3000 Hz)
  const centerFreq = 200 + Math.min(speed, 30) * 90;

  return {
    id: _newWindPatchId(),
    name: 'Wind Model',
    nodes: [
      // Whoosh layer — filtered noise
      { id: 'noise', type: 'NoiseGenerator', params: { color: 'pink' } },
      { id: 'bp', type: 'Filter', params: { type: 'bandpass', frequency: centerFreq, Q: 1.5 } },
      { id: 'whoosh_gain', type: 'Gain', params: { volume: 0.5 } },

      // Rumble layer — low sub
      { id: 'sub_noise', type: 'NoiseGenerator', params: { color: 'brown' } },
      { id: 'sub_lp', type: 'Filter', params: { type: 'lowpass', frequency: 60, Q: 1.0 } },
      { id: 'sub_gain', type: 'Gain', params: { volume: 0.2 } },

      // Gust modulation — slow LFO
      { id: 'gust_lfo', type: 'LFO', params: { rate: 0.3, depth: gustiness, shape: 'sine' } },
      { id: 'gust_bias', type: 'MathOp', params: { operation: 'add', operand: 1.0 } },

      // Mix whoosh + rumble
      { id: 'sum', type: 'MathOp', params: { operation: 'add' } },

      // Apply gust modulation
      { id: 'gust_mul', type: 'MathOp', params: { operation: 'mul' } },

      // Output
      { id: 'outGain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      // Whoosh
      { from: 'noise:out', to: 'bp:in' },
      { from: 'bp:out', to: 'whoosh_gain:in' },

      // Rumble
      { from: 'sub_noise:out', to: 'sub_lp:in' },
      { from: 'sub_lp:out', to: 'sub_gain:in' },

      // Sum
      { from: 'whoosh_gain:out', to: 'sum:a' },
      { from: 'sub_gain:out', to: 'sum:b' },

      // Gust modulation
      { from: 'gust_lfo:out', to: 'gust_bias:a' },
      { from: 'sum:out', to: 'gust_mul:a' },
      { from: 'gust_bias:out', to: 'gust_mul:b' },

      // Output
      { from: 'gust_mul:out', to: 'outGain:in' },
      { from: 'outGain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'bp.frequency', name: 'wind.centerFreq', range: [100, 5000] },
      { param: 'gust_lfo.depth', name: 'wind.gustiness', range: [0, 1] },
      { param: 'gust_lfo.rate', name: 'wind.gustRate', range: [0.05, 2] },
      { param: 'outGain.volume', name: 'wind.volume', range: [0, 2] },
    ],
  };
}
