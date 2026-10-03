// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../../core/math/MathRandom.js';

/**
 * NoiseGeneratorNode.js — Advanced Noise Generation
 * 
 * Supports 8 noise colors with distinct spectral characteristics:
 * - white:   Flat spectrum (0 dB/oct)
 * - pink:    -3 dB/oct slope (natural, organic)
 * - brown:   -6 dB/oct slope (rumble, thunder)
 * - blue:    +3 dB/oct slope (bright, airy)
 * - violet:  +6 dB/oct slope (high-frequency emphasis)
 * - grey:    Perceptually flat (A-weighted)
 * - velvet:  Sparse random impulses
 * - crackle: Dense random impulse train
 *
 * Usage:
 *   import { createNoiseBuffer, createNoiseSource } from './NoiseGeneratorNode.js';
 *   const buffer = createNoiseBuffer(audioCtx, 'pink', 2.0);
 *   const source = createNoiseSource(audioCtx, 'brown', { bandwidth: 200 });
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const NOISE_COLORS = ['white', 'pink', 'brown', 'blue', 'violet', 'grey', 'velvet', 'crackle'];
const DEFAULT_DURATION = 2.0;
const DEFAULT_SAMPLE_RATE = 44100;

// Precomputed A-weighting filter coefficients (for grey noise)
// Approximation of ISO 226 equal-loudness contour
const A_WEIGHT_BANDS = [
  { freq: 31.5, gain: -39.4 },
  { freq: 63, gain: -26.2 },
  { freq: 125, gain: -16.1 },
  { freq: 250, gain: -8.6 },
  { freq: 500, gain: -3.2 },
  { freq: 1000, gain: 0 },
  { freq: 2000, gain: 1.2 },
  { freq: 4000, gain: 1.0 },
  { freq: 8000, gain: -1.1 },
  { freq: 16000, gain: -6.6 },
];

// ============================================================================
// BUFFER GENERATION
// ============================================================================

/**
 * Create a noise AudioBuffer of the specified color.
 * @param {AudioContext} ctx
 * @param {string} color - Noise color (white|pink|brown|blue|violet|grey|velvet|crackle)
 * @param {number} duration - Buffer duration in seconds
 * @param {Object} options
 * @param {number} options.density - Impulses/sec for velvet/crackle (default 100)
 * @param {boolean} options.stereo - Generate stereo buffer (default false)
 * @returns {AudioBuffer}
 */
export function createNoiseBuffer(ctx, color = 'white', duration = DEFAULT_DURATION, options = {}) {
  const sampleRate = ctx.sampleRate;
  const length = Math.ceil(duration * sampleRate);
  const channels = options.stereo ? 2 : 1;
  const buffer = ctx.createBuffer(channels, length, sampleRate);

  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    _fillNoiseBuffer(data, color, sampleRate, options);
  }

  return buffer;
}

/**
 * Fill a Float32Array with noise of the specified color.
 * @param {Float32Array} output
 * @param {string} color
 * @param {number} sampleRate
 * @param {Object} options
 */
function _fillNoiseBuffer(output, color, sampleRate, options = {}) {
  const length = output.length;

  switch (color) {
    case 'white':
      _generateWhite(output);
      break;
    case 'pink':
      _generatePink(output);
      break;
    case 'brown':
    case 'red':
      _generateBrown(output);
      break;
    case 'blue':
      _generateBlue(output);
      break;
    case 'violet':
    case 'purple':
      _generateViolet(output);
      break;
    case 'grey':
    case 'gray':
      _generateGrey(output, sampleRate);
      break;
    case 'velvet':
      _generateVelvet(output, sampleRate, options.density || 100);
      break;
    case 'crackle':
      _generateCrackle(output, sampleRate, options.density || 500);
      break;
    default:
      _generateWhite(output);
  }
}

// ============================================================================
// NOISE GENERATION ALGORITHMS
// ============================================================================

/**
 * White noise — flat spectrum, uniform random samples.
 */
function _generateWhite(output) {
  for (let i = 0; i < output.length; i++) {
    output[i] = uniformDistribution(-1, 1, Math.random);
  }
}

/**
 * Pink noise — -3 dB/oct slope using Voss-McCartney algorithm.
 * Uses octave-band summation for efficient generation.
 */
function _generatePink(output) {
  const OCTAVES = 16;
  const octaves = new Float32Array(OCTAVES);
  const maxKey = 0xFFFF;
  let key = 0;

  // Initialize octave values
  for (let i = 0; i < OCTAVES; i++) {
    octaves[i] = uniformDistribution(-1, 1, Math.random);
  }

  for (let i = 0; i < output.length; i++) {
    // Find changed octaves using XOR of sequential keys
    const lastKey = key;
    key++;
    if (key > maxKey) key = 0;
    const diff = lastKey ^ key;

    // Update changed octave bands
    for (let j = 0; j < OCTAVES; j++) {
      if (diff & (1 << j)) {
        octaves[j] = uniformDistribution(-1, 1, Math.random);
      }
    }

    // Sum all octaves
    let sum = 0;
    for (let j = 0; j < OCTAVES; j++) {
      sum += octaves[j];
    }

    // Normalize and add white noise component for high frequencies
    output[i] = (sum / OCTAVES) * 0.8 + uniformDistribution(-1, 1, Math.random) * 0.2;
  }

  _normalize(output);
}

/**
 * Brown (Brownian/Red) noise — -6 dB/oct slope using integration.
 * Random walk with leaky integrator to prevent DC drift.
 */
function _generateBrown(output) {
  let brown = 0;
  const leak = 0.995; // Leaky integrator coefficient

  for (let i = 0; i < output.length; i++) {
    const white = uniformDistribution(-1, 1, Math.random);
    brown = brown * leak + white * 0.02;
    output[i] = brown;
  }

  _normalize(output);
}

/**
 * Blue noise — +3 dB/oct slope using differentiation.
 * First derivative of white noise.
 */
function _generateBlue(output) {
  let prev = uniformDistribution(-1, 1, Math.random);

  for (let i = 0; i < output.length; i++) {
    const current = uniformDistribution(-1, 1, Math.random);
    output[i] = current - prev;
    prev = current;
  }

  _normalize(output);
}

/**
 * Violet noise — +6 dB/oct slope using second derivative.
 * Differentiation of blue noise.
 */
function _generateViolet(output) {
  let prev1 = uniformDistribution(-1, 1, Math.random);
  let prev2 = uniformDistribution(-1, 1, Math.random);

  for (let i = 0; i < output.length; i++) {
    const current = uniformDistribution(-1, 1, Math.random);
    // Second derivative: f''(x) ≈ f(x) - 2*f(x-1) + f(x-2)
    output[i] = current - 2 * prev1 + prev2;
    prev2 = prev1;
    prev1 = current;
  }

  _normalize(output);
}

/**
 * Grey noise — perceptually flat using A-weighting approximation.
 * Generates white noise and applies inverse A-weighting curve.
 */
function _generateGrey(output, sampleRate) {
  // Generate white noise first
  _generateWhite(output);

  // Apply multi-band EQ to approximate inverse A-weighting
  // This is a simplified approach using cascaded biquad-like processing
  const nyquist = sampleRate / 2;

  // Apply gentle boost to low and high frequencies
  // to compensate for ear's reduced sensitivity
  _applySpectralShape(output, sampleRate, [
    { freq: 100, gain: 0.3 },
    { freq: 500, gain: 0.05 },
    { freq: 1000, gain: 0 },
    { freq: 4000, gain: -0.05 },
    { freq: 10000, gain: 0.1 },
  ]);

  _normalize(output);
}

/**
 * Velvet noise — sparse random impulses.
 * Used for efficient reverb excitation and soft textures.
 * @param {Float32Array} output
 * @param {number} sampleRate
 * @param {number} density - Average impulses per second
 */
function _generateVelvet(output, sampleRate, density) {
  // Clear buffer
  output.fill(0);

  const avgInterval = sampleRate / density;
  let nextImpulse = uniformDistribution(0, avgInterval, Math.random);

  for (let i = 0; i < output.length; i++) {
    if (i >= nextImpulse) {
      // Random polarity impulse
      output[i] = Math.random() > 0.5 ? 1 : -1;
      // Randomized interval (0.5x to 1.5x average)
      nextImpulse += avgInterval * uniformDistribution(0.5, 1.5, Math.random);
    }
  }
}

/**
 * Crackle noise — dense impulse train with random amplitudes.
 * Useful for fire, static, vinyl simulation.
 * @param {Float32Array} output
 * @param {number} sampleRate
 * @param {number} density - Average impulses per second
 */
function _generateCrackle(output, sampleRate, density) {
  // Clear buffer
  output.fill(0);

  const avgInterval = sampleRate / density;
  let nextImpulse = uniformDistribution(0, avgInterval * 0.5, Math.random);

  for (let i = 0; i < output.length; i++) {
    if (i >= nextImpulse) {
      // Variable amplitude and polarity
      const amp = uniformDistribution(0.3, 1, Math.random);
      output[i] = (Math.random() > 0.5 ? 1 : -1) * amp;

      // Sometimes add short burst (2-5 samples)
      if (Math.random() > 0.7) {
        const burstLen = Math.floor(uniformDistribution(2, 6, Math.random));
        for (let j = 1; j < burstLen && i + j < output.length; j++) {
          output[i + j] = output[i] * (1 - j / burstLen) * uniformDistribution(0.5, 1, Math.random);
        }
      }

      // Highly randomized interval for organic feel
      nextImpulse += avgInterval * uniformDistribution(0.2, 1.8, Math.random);
    }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize audio buffer to -1 to 1 range.
 */
function _normalize(output, targetPeak = 0.95) {
  let max = 0;
  for (let i = 0; i < output.length; i++) {
    const abs = Math.abs(output[i]);
    if (abs > max) max = abs;
  }
  if (max > 0) {
    const scale = targetPeak / max;
    for (let i = 0; i < output.length; i++) {
      output[i] *= scale;
    }
  }
}

/**
 * Apply simple spectral shaping using time-domain approximation.
 * This is a basic multi-band approach for grey noise.
 */
function _applySpectralShape(output, sampleRate, bands) {
  // Simple approach: mix original with filtered versions
  // This is approximate but avoids FFT complexity
  const temp = new Float32Array(output.length);

  for (const band of bands) {
    if (Math.abs(band.gain) < 0.01) continue;

    // Simple one-pole filter targeting the band frequency
    const omega = (2 * Math.PI * band.freq) / sampleRate;
    const coeff = Math.exp(-omega);

    let filtered = 0;
    for (let i = 0; i < output.length; i++) {
      filtered = output[i] * (1 - coeff) + filtered * coeff;
      temp[i] = filtered;
    }

    // Mix filtered signal with gain
    const gainLinear = band.gain;
    for (let i = 0; i < output.length; i++) {
      output[i] += temp[i] * gainLinear;
    }
  }
}

// ============================================================================
// REAL-TIME SOURCE CREATION
// ============================================================================

/**
 * Create a looping noise source node.
 * @param {AudioContext} ctx
 * @param {string} color - Noise color
 * @param {Object} options
 * @param {number} options.duration - Buffer duration (default 2s)
 * @param {number} options.density - For velvet/crackle
 * @param {number} options.bandwidth - LP filter cutoff (null = no filter)
 * @param {boolean} options.stereo - Stereo decorrelation
 * @returns {{ source: AudioBufferSourceNode, output: GainNode, filter?: BiquadFilterNode }}
 */
export function createNoiseSource(ctx, color = 'white', options = {}) {
  const duration = options.duration || DEFAULT_DURATION;
  const buffer = createNoiseBuffer(ctx, color, duration, {
    density: options.density,
    stereo: options.stereo,
  });

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const output = ctx.createGain();
  output.gain.value = 1.0;

  let lastNode = source;

  // Optional bandwidth limiting
  if (options.bandwidth && options.bandwidth < 20000) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = options.bandwidth;
    filter.Q.value = 0.7;
    lastNode.connect(filter);
    lastNode = filter;
  }

  lastNode.connect(output);

  return {
    source,
    output,
    start: (when = 0) => source.start(when),
    stop: (when = 0) => source.stop(when),
  };
}

/**
 * Create stereo noise with decorrelated channels.
 * @param {AudioContext} ctx
 * @param {string} color
 * @param {Object} options
 * @returns {{ left: AudioBufferSourceNode, right: AudioBufferSourceNode, output: GainNode }}
 */
export function createStereoNoiseSource(ctx, color = 'white', options = {}) {
  const duration = options.duration || DEFAULT_DURATION;

  // Create two independent mono buffers
  const leftBuffer = createNoiseBuffer(ctx, color, duration, { ...options, stereo: false });
  const rightBuffer = createNoiseBuffer(ctx, color, duration, { ...options, stereo: false });

  const leftSource = ctx.createBufferSource();
  leftSource.buffer = leftBuffer;
  leftSource.loop = true;

  const rightSource = ctx.createBufferSource();
  rightSource.buffer = rightBuffer;
  rightSource.loop = true;

  // Pan left and right
  const leftPan = ctx.createStereoPanner();
  leftPan.pan.value = -1;

  const rightPan = ctx.createStereoPanner();
  rightPan.pan.value = 1;

  const output = ctx.createGain();
  output.gain.value = 0.5; // -6dB to compensate for summing

  leftSource.connect(leftPan);
  rightSource.connect(rightPan);
  leftPan.connect(output);
  rightPan.connect(output);

  return {
    left: leftSource,
    right: rightSource,
    output,
    start: (when = 0) => {
      leftSource.start(when);
      rightSource.start(when);
    },
    stop: (when = 0) => {
      leftSource.stop(when);
      rightSource.stop(when);
    },
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export const NOISE_COLOR_OPTIONS = NOISE_COLORS;

export function isValidNoiseColor(color) {
  return NOISE_COLORS.includes(color) || color === 'red' || color === 'gray' || color === 'purple';
}
