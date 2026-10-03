// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../../core/math/MathRandom.js';

/**
 * WaveguideNode.js — Digital Waveguide Synthesis
 * 
 * Physical modeling using bidirectional delay lines with filtered reflections.
 * Models vibrating strings, tubes, and resonant bodies.
 *
 * Termination types:
 * - rigid:      Full reflection with inversion (clamped string ends)
 * - free:       Full reflection without inversion (free string ends)
 * - lossy:      Partial absorption at boundaries
 * - dispersive: Frequency-dependent propagation (stiff strings)
 *
 * Modes:
 * - string: Both ends reflect with inversion
 * - tube:   Closed-closed tube (no inversion)
 * - open:   Open-closed tube (clarinet-like, one end inverts)
 *
 * Usage:
 *   import { createWaveguide, renderWaveguide } from './WaveguideNode.js';
 *   const wg = createWaveguide(audioCtx, { frequency: 220, mode: 'string' });
 *   wg.excite(impulseBuffer);
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const TERMINATION_TYPES = ['rigid', 'free', 'lossy', 'dispersive'];
const WAVEGUIDE_MODES = ['string', 'tube', 'open'];

// ============================================================================
// OFFLINE RENDERING
// ============================================================================

/**
 * Render a waveguide to an AudioBuffer (offline).
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {AudioBuffer}
 */
export function renderWaveguide(ctx, config = {}) {
  const sampleRate = ctx.sampleRate;
  const frequency = config.frequency ?? 220;
  const damping = config.damping ?? 0.5;
  const feedback = config.feedback ?? 0.99;
  const termination = config.termination ?? 'rigid';
  const excitePos = config.excitePos ?? 0.5;
  const pickupPos = config.pickupPos ?? 0.25;
  const dispersion = config.dispersion ?? 0;
  const mode = config.mode ?? 'string';
  const brightness = config.brightness ?? 0.5;
  const duration = config.duration ?? 3.0;
  const volume = config.volume ?? 0.8;

  // Calculate delay line length from frequency
  const delayLength = Math.max(2, Math.round(sampleRate / frequency));
  const totalSamples = Math.ceil(duration * sampleRate);

  // Two delay lines for bidirectional propagation
  const delayRight = new Float32Array(delayLength);
  const delayLeft = new Float32Array(delayLength);

  // Initialize with excitation at excitePos
  const exciteIndex = Math.floor(excitePos * delayLength);
  _initializeExcitation(delayRight, delayLeft, exciteIndex, config.excitationType || 'noise');

  // LP filter coefficient from brightness (0=dark, 1=bright)
  const lpCoeff = (1 - brightness) * 0.5;

  // Reflection coefficients based on termination type
  const { reflectRight, reflectLeft } = _getReflectionCoeffs(termination, mode, feedback);

  // Allpass coefficient for dispersion
  const allpassCoeff = dispersion * 0.5;

  // Pickup position
  const pickupIndex = Math.floor(pickupPos * delayLength);

  // Process
  const output = new Float32Array(totalSamples);
  let readPosRight = 0;
  let readPosLeft = 0;
  let prevRight = 0;
  let prevLeft = 0;
  let allpassPrevRight = 0;
  let allpassPrevLeft = 0;

  for (let i = 0; i < totalSamples; i++) {
    // Read from delay lines at pickup position
    const pickupR = delayRight[(readPosRight + pickupIndex) % delayLength];
    const pickupL = delayLeft[(readPosLeft + pickupIndex) % delayLength];
    output[i] = (pickupR + pickupL) * 0.5 * volume;

    // Read from ends for reflection
    const rightEnd = delayRight[readPosRight];
    const leftEnd = delayLeft[readPosLeft];

    // Apply lowpass filter at reflections
    let filteredRight = rightEnd * (1 - lpCoeff) + prevRight * lpCoeff;
    let filteredLeft = leftEnd * (1 - lpCoeff) + prevLeft * lpCoeff;
    prevRight = filteredRight;
    prevLeft = filteredLeft;

    // Apply dispersion (allpass)
    if (allpassCoeff > 0) {
      const apOutRight = allpassCoeff * filteredRight + allpassPrevRight - allpassCoeff * allpassPrevRight;
      allpassPrevRight = filteredRight;
      filteredRight = apOutRight;

      const apOutLeft = allpassCoeff * filteredLeft + allpassPrevLeft - allpassCoeff * allpassPrevLeft;
      allpassPrevLeft = filteredLeft;
      filteredLeft = apOutLeft;
    }

    // Reflect and swap directions
    delayLeft[readPosLeft] = filteredRight * reflectRight;
    delayRight[readPosRight] = filteredLeft * reflectLeft;

    // Advance read positions
    readPosRight = (readPosRight + 1) % delayLength;
    readPosLeft = (readPosLeft + 1) % delayLength;
  }

  // Normalize
  _normalizeBuffer(output);

  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  buffer.getChannelData(0).set(output);
  return buffer;
}

/**
 * Initialize delay lines with excitation.
 */
function _initializeExcitation(delayRight, delayLeft, exciteIndex, type) {
  const len = delayRight.length;

  switch (type) {
    case 'impulse':
      delayRight[exciteIndex] = 1.0;
      delayLeft[exciteIndex] = 1.0;
      break;
    case 'sine':
      for (let i = 0; i < len; i++) {
        const val = Math.sin(2 * Math.PI * i / len);
        delayRight[i] = val;
        delayLeft[i] = val;
      }
      break;
    case 'noise':
    default:
      // Burst of noise around excitation point
      const burstLen = Math.max(4, Math.floor(len * 0.1));
      const start = Math.max(0, exciteIndex - burstLen / 2);
      for (let i = 0; i < burstLen; i++) {
        const idx = (start + i) % len;
        const val = uniformDistribution(-1, 1, Math.random) * (1 - i / burstLen);
        delayRight[idx] = val;
        delayLeft[idx] = val;
      }
      break;
  }
}

/**
 * Get reflection coefficients based on termination and mode.
 */
function _getReflectionCoeffs(termination, mode, feedback) {
  let reflectRight = feedback;
  let reflectLeft = feedback;

  // Mode affects sign of reflection
  switch (mode) {
    case 'string':
      // Both ends invert (clamped)
      reflectRight *= -1;
      reflectLeft *= -1;
      break;
    case 'tube':
      // Both ends reflect without inversion (closed-closed)
      break;
    case 'open':
      // One end inverts (open-closed, like clarinet)
      reflectRight *= -1;
      break;
  }

  // Termination affects reflection magnitude
  switch (termination) {
    case 'free':
      // No sign change for free end
      reflectRight = Math.abs(reflectRight);
      reflectLeft = Math.abs(reflectLeft);
      break;
    case 'lossy':
      // Reduce reflection
      reflectRight *= 0.9;
      reflectLeft *= 0.9;
      break;
    case 'dispersive':
      // Dispersion handled separately via allpass
      break;
    case 'rigid':
    default:
      // Full reflection with mode-determined sign
      break;
  }

  return { reflectRight, reflectLeft };
}

/**
 * Normalize buffer to peak of 0.95.
 */
function _normalizeBuffer(buffer, targetPeak = 0.95) {
  let max = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > max) max = abs;
  }
  if (max > 0) {
    const scale = targetPeak / max;
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] *= scale;
    }
  }
}

// ============================================================================
// REAL-TIME ENGINE
// ============================================================================

/**
 * Create a real-time waveguide engine using Web Audio nodes.
 * This is a simplified version using delay + filter + feedback.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object} Waveguide instance
 */
export function createWaveguide(ctx, config = {}) {
  const frequency = config.frequency ?? 220;
  const damping = config.damping ?? 0.5;
  const feedback = config.feedback ?? 0.99;
  const brightness = config.brightness ?? 0.5;

  // Calculate delay time from frequency
  const delayTime = 1 / frequency;

  // Create nodes
  const input = ctx.createGain();
  input.gain.value = 1.0;

  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = delayTime;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1000 + brightness * 10000;
  filter.Q.value = 0.5;

  const feedbackGain = ctx.createGain();
  feedbackGain.gain.value = feedback * (config.mode === 'string' ? -1 : 1);

  const output = ctx.createGain();
  output.gain.value = 1.0;

  // Connect feedback loop
  input.connect(delay);
  delay.connect(filter);
  filter.connect(output);
  filter.connect(feedbackGain);
  feedbackGain.connect(delay);

  return {
    ctx,
    input,
    output,
    delay,
    filter,
    feedbackGain,
    config: { frequency, damping, feedback, brightness },

    /**
     * Excite the waveguide with an impulse buffer.
     */
    excite(buffer, when = 0) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(input);
      source.start(when);
    },

    /**
     * Set the pitch (frequency).
     */
    setFrequency(freq) {
      delay.delayTime.value = 1 / freq;
    },

    /**
     * Set feedback amount.
     */
    setFeedback(fb) {
      feedbackGain.gain.value = fb * (config.mode === 'string' ? -1 : 1);
    },

    /**
     * Set brightness (filter cutoff).
     */
    setBrightness(b) {
      filter.frequency.value = 1000 + b * 10000;
    },

    /**
     * Disconnect and cleanup.
     */
    destroy() {
      input.disconnect();
      delay.disconnect();
      filter.disconnect();
      feedbackGain.disconnect();
      output.disconnect();
    },
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export const WAVEGUIDE_TERMINATIONS = TERMINATION_TYPES;
export const WAVEGUIDE_MODE_OPTIONS = WAVEGUIDE_MODES;

export function isValidTermination(term) {
  return TERMINATION_TYPES.includes(term);
}

export function isValidWaveguideMode(mode) {
  return WAVEGUIDE_MODES.includes(mode);
}
