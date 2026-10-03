// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * OscillatorNode.js — Advanced Oscillator Synthesis
 * 
 * Supports multiple waveform types beyond Web Audio defaults:
 * - sine, square, sawtooth, triangle (native)
 * - pulse (variable duty cycle via PeriodicWave)
 * - supersaw (multiple detuned sawtooths)
 * - custom (user-defined wavetable)
 *
 * Additional features:
 * - Sub-oscillator (-1 or -2 octaves)
 * - Unison/supersaw with configurable voice count and spread
 * - Pulse width modulation
 *
 * Usage:
 *   import { createOscillator, createSupersawOscillator } from './OscillatorNode.js';
 *   const osc = createOscillator(audioCtx, { shape: 'pulse', frequency: 440, pulseWidth: 0.3 });
 *   osc.output.connect(destination);
 *   osc.start();
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const NATIVE_SHAPES = ['sine', 'square', 'sawtooth', 'triangle'];
const EXTENDED_SHAPES = ['pulse', 'supersaw', 'custom'];
const ALL_SHAPES = [...NATIVE_SHAPES, ...EXTENDED_SHAPES];

// Pre-computed pulse wave tables for different duty cycles
const PULSE_WAVE_CACHE = new Map();
const PULSE_HARMONICS = 64;

// ============================================================================
// OSCILLATOR CREATION
// ============================================================================

/**
 * Create an advanced oscillator node.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @param {number} config.frequency - Base frequency in Hz
 * @param {number} config.detune - Detune in cents
 * @param {string} config.shape - Waveform shape
 * @param {number} config.pulseWidth - Duty cycle for pulse wave (0-1)
 * @param {number} config.unisonVoices - Number of unison voices for supersaw
 * @param {number} config.unisonDetune - Detune spread in cents for supersaw
 * @param {number} config.subOctave - Sub-oscillator: 0=off, 1=-1oct, 2=-2oct
 * @param {number} config.subMix - Sub-oscillator mix level (0-1)
 * @param {Float32Array} config.wavetable - Custom wavetable harmonics
 * @returns {Object} Oscillator instance
 */
export function createOscillator(ctx, config = {}) {
  const frequency = config.frequency ?? 440;
  const detune = config.detune ?? 0;
  const shape = config.shape ?? 'sine';
  const pulseWidth = config.pulseWidth ?? 0.5;
  const unisonVoices = Math.max(1, Math.min(8, config.unisonVoices ?? 1));
  const unisonDetune = config.unisonDetune ?? 10;
  const subOctave = config.subOctave ?? 0;
  const subMix = config.subMix ?? 0.5;
  const wavetable = config.wavetable ?? null;

  const output = ctx.createGain();
  output.gain.value = 1.0;

  const oscillators = [];
  let subOsc = null;
  let subGain = null;

  // Handle different shapes
  if (shape === 'supersaw' || unisonVoices > 1) {
    // Supersaw: multiple detuned oscillators
    const voices = Math.max(1, unisonVoices);
    const mainGain = ctx.createGain();
    mainGain.gain.value = 1.0 / Math.sqrt(voices); // Equal-power normalization

    for (let i = 0; i < voices; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = frequency;

      // Spread detune across voices
      const spread = (i / (voices - 1 || 1)) * 2 - 1; // -1 to +1
      osc.detune.value = detune + spread * unisonDetune;

      osc.connect(mainGain);
      oscillators.push(osc);
    }

    mainGain.connect(output);
  } else if (shape === 'pulse') {
    // Pulse wave via PeriodicWave
    const osc = ctx.createOscillator();
    const periodicWave = _getPulseWave(ctx, pulseWidth);
    osc.setPeriodicWave(periodicWave);
    osc.frequency.value = frequency;
    osc.detune.value = detune;
    osc.connect(output);
    oscillators.push(osc);
  } else if (shape === 'custom' && wavetable) {
    // Custom wavetable
    const osc = ctx.createOscillator();
    const periodicWave = _createWavetable(ctx, wavetable);
    osc.setPeriodicWave(periodicWave);
    osc.frequency.value = frequency;
    osc.detune.value = detune;
    osc.connect(output);
    oscillators.push(osc);
  } else {
    // Native waveforms
    const osc = ctx.createOscillator();
    osc.type = NATIVE_SHAPES.includes(shape) ? shape : 'sine';
    osc.frequency.value = frequency;
    osc.detune.value = detune;
    osc.connect(output);
    oscillators.push(osc);
  }

  // Sub-oscillator
  if (subOctave > 0 && subMix > 0) {
    const subFreq = frequency / Math.pow(2, subOctave);
    subOsc = ctx.createOscillator();
    subOsc.type = shape === 'pulse' || shape === 'supersaw' ? 'sawtooth' : (NATIVE_SHAPES.includes(shape) ? shape : 'sine');
    subOsc.frequency.value = subFreq;
    subOsc.detune.value = detune;

    subGain = ctx.createGain();
    subGain.gain.value = subMix;

    subOsc.connect(subGain);
    subGain.connect(output);
  }

  return {
    ctx,
    output,
    oscillators,
    subOsc,
    subGain,
    config: { frequency, detune, shape, pulseWidth, unisonVoices, unisonDetune, subOctave, subMix },

    start(when = 0) {
      for (const osc of oscillators) {
        osc.start(when);
      }
      if (subOsc) subOsc.start(when);
    },

    stop(when = 0) {
      for (const osc of oscillators) {
        osc.stop(when);
      }
      if (subOsc) subOsc.stop(when);
    },

    setFrequency(freq, rampTime = 0) {
      const now = ctx.currentTime;
      for (const osc of oscillators) {
        if (rampTime > 0) {
          osc.frequency.linearRampToValueAtTime(freq, now + rampTime);
        } else {
          osc.frequency.setValueAtTime(freq, now);
        }
      }
      if (subOsc) {
        const subFreq = freq / Math.pow(2, subOctave);
        if (rampTime > 0) {
          subOsc.frequency.linearRampToValueAtTime(subFreq, now + rampTime);
        } else {
          subOsc.frequency.setValueAtTime(subFreq, now);
        }
      }
    },

    setDetune(cents) {
      // For supersaw, we need to preserve the spread
      if (oscillators.length > 1) {
        const voices = oscillators.length;
        for (let i = 0; i < voices; i++) {
          const spread = (i / (voices - 1 || 1)) * 2 - 1;
          oscillators[i].detune.value = cents + spread * unisonDetune;
        }
      } else {
        for (const osc of oscillators) {
          osc.detune.value = cents;
        }
      }
      if (subOsc) subOsc.detune.value = cents;
    },

    setPulseWidth(pw) {
      if (shape !== 'pulse' || oscillators.length === 0) return;
      const periodicWave = _getPulseWave(ctx, pw);
      oscillators[0].setPeriodicWave(periodicWave);
    },

    setSubMix(mix) {
      if (subGain) subGain.gain.value = mix;
    },
  };
}

// ============================================================================
// PULSE WAVE GENERATION
// ============================================================================

/**
 * Get or create a PeriodicWave for a pulse wave with given duty cycle.
 * @param {AudioContext} ctx
 * @param {number} dutyCycle - 0 to 1 (0.5 = square wave)
 * @returns {PeriodicWave}
 */
function _getPulseWave(ctx, dutyCycle) {
  // Quantize duty cycle to reduce cache size
  const quantized = Math.round(dutyCycle * 100) / 100;
  const cacheKey = `${ctx.sampleRate}_${quantized}`;

  if (PULSE_WAVE_CACHE.has(cacheKey)) {
    return PULSE_WAVE_CACHE.get(cacheKey);
  }

  const wave = _createPulseWave(ctx, quantized);
  PULSE_WAVE_CACHE.set(cacheKey, wave);
  return wave;
}

/**
 * Create a PeriodicWave for a pulse wave using Fourier series.
 * @param {AudioContext} ctx
 * @param {number} dutyCycle - 0 to 1
 * @returns {PeriodicWave}
 */
function _createPulseWave(ctx, dutyCycle) {
  const real = new Float32Array(PULSE_HARMONICS + 1);
  const imag = new Float32Array(PULSE_HARMONICS + 1);

  // DC offset (real[0]) is zero for a centered waveform
  real[0] = 0;
  imag[0] = 0;

  // Fourier series for pulse wave:
  // b_n = (2 / (n * π)) * sin(n * π * dutyCycle)
  const d = dutyCycle;
  for (let n = 1; n <= PULSE_HARMONICS; n++) {
    real[n] = 0;
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
  }

  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/**
 * Create a custom PeriodicWave from harmonic amplitudes.
 * @param {AudioContext} ctx
 * @param {Float32Array} harmonics - Array of harmonic amplitudes
 * @returns {PeriodicWave}
 */
function _createWavetable(ctx, harmonics) {
  const count = harmonics.length + 1;
  const real = new Float32Array(count);
  const imag = new Float32Array(count);

  real[0] = 0;
  imag[0] = 0;

  for (let i = 0; i < harmonics.length; i++) {
    real[i + 1] = 0;
    imag[i + 1] = harmonics[i];
  }

  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

// ============================================================================
// PRESET WAVETABLES
// ============================================================================

export const WAVETABLE_PRESETS = {
  // Organ-like (odd harmonics only)
  organ: new Float32Array([1, 0, 0.5, 0, 0.25, 0, 0.125, 0, 0.0625]),

  // Brass-like (strong low harmonics)
  brass: new Float32Array([1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1]),

  // String-like (gradual rolloff)
  strings: new Float32Array([1, 0.5, 0.33, 0.25, 0.2, 0.167, 0.143, 0.125, 0.111]),

  // Bell-like (inharmonic partials approximation)
  bell: new Float32Array([1, 0.1, 0.6, 0.05, 0.4, 0.02, 0.3, 0.01, 0.2]),

  // Digital/harsh
  digital: new Float32Array([1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.25]),
};

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export const OSCILLATOR_SHAPES = ALL_SHAPES;

export function isValidShape(shape) {
  return ALL_SHAPES.includes(shape);
}
