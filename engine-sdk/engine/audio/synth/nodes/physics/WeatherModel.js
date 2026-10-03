// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WeatherModel.js - Weather Synthesis Model
 * 
 * Rain (grain cloud of drops), hail, thunder (rumble).
 * Driven by: weather type, intensity
 */

/**
 * Generate a Weather model patch descriptor.
 * @param {Object} config
 * @param {string} config.type - 'rain'|'hail'|'thunder' (default 'rain')
 * @param {number} config.intensity - 0-1 (default 0.5)
 * @param {number} config.volume - Output volume (default 0.5)
 * @returns {Object} Patch JSON
 */
let _weatherPatchSequence = 0;

function _newWeatherPatchId(type) {
  return `weather_${type}_${Date.now()}_${++_weatherPatchSequence}`;
}

export function createWeatherPatch(config = {}) {
  const type = config.type || 'rain';
  const intensity = config.intensity ?? 0.5;
  const volume = config.volume ?? 0.5;

  switch (type) {
    case 'hail':
      return _createHailPatch(intensity, volume);
    case 'thunder':
      return _createThunderPatch(intensity, volume);
    case 'rain':
    default:
      return _createRainPatch(intensity, volume);
  }
}

function _createRainPatch(intensity, volume) {
  const dropRate = 10 + intensity * 90;
  return {
    id: _newWeatherPatchId('rain'),
    name: 'Weather: Rain',
    nodes: [
      // Drop impacts — fast stochastic impulses
      { id: 'imp', type: 'Impulse', params: { rate: dropRate, jitter: 0.9 } },
      { id: 'osc', type: 'Oscillator', params: { frequency: 600, shape: 'sine' } },
      { id: 'env', type: 'Envelope', params: { attack: 0.0005, decay: 0.03, sustain: 0, release: 0.005 } },
      { id: 'mul', type: 'MathOp', params: { operation: 'mul' } },
      { id: 'drop_gain', type: 'Gain', params: { volume: 0.3 } },

      // Continuous rain wash — filtered pink noise
      { id: 'wash_noise', type: 'NoiseGenerator', params: { color: 'pink' } },
      { id: 'wash_bp', type: 'Filter', params: { type: 'bandpass', frequency: 3000, Q: 0.5 } },
      { id: 'wash_gain', type: 'Gain', params: { volume: intensity * 0.4 } },

      // Sum
      { id: 'sum', type: 'MathOp', params: { operation: 'add' } },
      { id: 'outGain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      { from: 'imp:out', to: 'env:gate' },
      { from: 'osc:out', to: 'mul:a' },
      { from: 'env:out', to: 'mul:b' },
      { from: 'mul:out', to: 'drop_gain:in' },
      { from: 'wash_noise:out', to: 'wash_bp:in' },
      { from: 'wash_bp:out', to: 'wash_gain:in' },
      { from: 'drop_gain:out', to: 'sum:a' },
      { from: 'wash_gain:out', to: 'sum:b' },
      { from: 'sum:out', to: 'outGain:in' },
      { from: 'outGain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'imp.rate', name: 'weather.dropRate', range: [5, 200] },
      { param: 'wash_gain.volume', name: 'weather.washLevel', range: [0, 1] },
      { param: 'outGain.volume', name: 'weather.volume', range: [0, 2] },
    ],
  };
}

function _createHailPatch(intensity, volume) {
  const hitRate = 5 + intensity * 40;
  return {
    id: _newWeatherPatchId('hail'),
    name: 'Weather: Hail',
    nodes: [
      { id: 'imp', type: 'Impulse', params: { rate: hitRate, jitter: 0.8 } },
      { id: 'bp', type: 'Filter', params: { type: 'bandpass', frequency: 2000, Q: 5.0 } },
      { id: 'env', type: 'Envelope', params: { attack: 0.0005, decay: 0.015, sustain: 0, release: 0.005 } },
      { id: 'mul', type: 'MathOp', params: { operation: 'mul' } },
      { id: 'outGain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      { from: 'imp:out', to: 'bp:in' },
      { from: 'imp:out', to: 'env:gate' },
      { from: 'bp:out', to: 'mul:a' },
      { from: 'env:out', to: 'mul:b' },
      { from: 'mul:out', to: 'outGain:in' },
      { from: 'outGain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'imp.rate', name: 'weather.hitRate', range: [2, 80] },
      { param: 'outGain.volume', name: 'weather.volume', range: [0, 2] },
    ],
  };
}

function _createThunderPatch(intensity, volume) {
  return {
    id: _newWeatherPatchId('thunder'),
    name: 'Weather: Thunder',
    nodes: [
      // Deep rumble
      { id: 'rum_noise', type: 'NoiseGenerator', params: { color: 'brown' } },
      { id: 'rum_lp', type: 'Filter', params: { type: 'lowpass', frequency: 50 + intensity * 30, Q: 1.0 } },
      { id: 'rum_gain', type: 'Gain', params: { volume: 0.7 } },

      // Crack component — sharp burst
      { id: 'crack_noise', type: 'NoiseGenerator', params: { color: 'white' } },
      { id: 'crack_env', type: 'Envelope', params: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.3 } },
      { id: 'crack_mul', type: 'MathOp', params: { operation: 'mul' } },
      { id: 'crack_gain', type: 'Gain', params: { volume: 0.5 } },

      // Trigger for crack
      { id: 'trig', type: 'Impulse', params: { rate: 0.2, jitter: 0.5 } },

      // Overall envelope — slow swell and decay
      { id: 'main_env', type: 'Envelope', params: { attack: 0.5, decay: 3.0, sustain: 0.2, release: 2.0 } },

      // Sum and modulate
      { id: 'sum', type: 'MathOp', params: { operation: 'add' } },
      { id: 'env_mul', type: 'MathOp', params: { operation: 'mul' } },
      { id: 'outGain', type: 'Gain', params: { volume } },
      { id: 'out', type: 'Output' },
    ],
    wires: [
      { from: 'rum_noise:out', to: 'rum_lp:in' },
      { from: 'rum_lp:out', to: 'rum_gain:in' },
      { from: 'trig:out', to: 'crack_env:gate' },
      { from: 'trig:out', to: 'main_env:gate' },
      { from: 'crack_noise:out', to: 'crack_mul:a' },
      { from: 'crack_env:out', to: 'crack_mul:b' },
      { from: 'crack_mul:out', to: 'crack_gain:in' },
      { from: 'rum_gain:out', to: 'sum:a' },
      { from: 'crack_gain:out', to: 'sum:b' },
      { from: 'sum:out', to: 'env_mul:a' },
      { from: 'main_env:out', to: 'env_mul:b' },
      { from: 'env_mul:out', to: 'outGain:in' },
      { from: 'outGain:out', to: 'out:in' },
    ],
    exposed: [
      { param: 'rum_lp.frequency', name: 'weather.rumbleCutoff', range: [20, 100] },
      { param: 'outGain.volume', name: 'weather.volume', range: [0, 2] },
    ],
  };
}
