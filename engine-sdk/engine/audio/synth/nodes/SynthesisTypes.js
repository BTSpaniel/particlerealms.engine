// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SynthesisTypes.js — Additional Synthesis Methods
 * 
 * Extended synthesis techniques:
 * - Additive: Harmonic/partial-based synthesis
 * - Wavetable: Morphing wavetable oscillator
 * - PhaseDistortion: CZ-style phase distortion
 * - Subtractive: Classic subtractive synth voice
 *
 * Usage:
 *   import { createAdditiveSynth, createWavetableSynth } from './SynthesisTypes.js';
 *   const add = createAdditiveSynth(audioCtx, { partialCount: 32 });
 */

import { midiToFreq } from './instruments/InstrumentPresets.js';

// ============================================================================
// ADDITIVE SYNTHESIS
// ============================================================================

/**
 * Create an additive synthesizer.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object}
 */
export function createAdditiveSynth(ctx, config = {}) {
  const frequency = config.frequency ?? 440;
  const partialCount = Math.max(1, Math.min(64, config.partialCount ?? 16));
  const spectralTilt = config.spectralTilt ?? 0; // dB/octave
  const evenOdd = config.evenOdd ?? 0.5; // 0=even only, 1=odd only, 0.5=both
  const detune = config.detune ?? 0;

  const output = ctx.createGain();
  output.gain.value = 1.0 / Math.sqrt(partialCount); // Normalize

  const oscillators = [];
  const gains = [];

  // Create partials
  for (let i = 1; i <= partialCount; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency * i;
    osc.detune.value = detune;

    const gain = ctx.createGain();

    // Calculate amplitude based on harmonic number
    let amp = 1 / i; // Default 1/n rolloff

    // Apply spectral tilt
    if (spectralTilt !== 0) {
      const octavesAbove = Math.log2(i);
      amp *= Math.pow(10, (spectralTilt * octavesAbove) / 20);
    }

    // Apply even/odd filter
    const isOdd = i % 2 === 1;
    if (isOdd) {
      amp *= evenOdd * 2; // Scale odd partials
    } else {
      amp *= (1 - evenOdd) * 2; // Scale even partials
    }

    gain.gain.value = Math.max(0, amp);

    osc.connect(gain);
    gain.connect(output);

    oscillators.push(osc);
    gains.push(gain);
  }

  return {
    ctx,
    output,
    oscillators,
    gains,
    config: { frequency, partialCount, spectralTilt, evenOdd, detune },

    start(when = 0) {
      for (const osc of oscillators) {
        osc.start(when);
      }
    },

    stop(when = 0) {
      for (const osc of oscillators) {
        osc.stop(when);
      }
    },

    setFrequency(freq) {
      for (let i = 0; i < oscillators.length; i++) {
        oscillators[i].frequency.value = freq * (i + 1);
      }
    },

    setPartialAmplitude(index, amplitude) {
      if (index >= 0 && index < gains.length) {
        gains[index].gain.value = amplitude;
      }
    },

    setSpectralTilt(tilt) {
      for (let i = 0; i < gains.length; i++) {
        const harmonic = i + 1;
        let amp = 1 / harmonic;
        const octavesAbove = Math.log2(harmonic);
        amp *= Math.pow(10, (tilt * octavesAbove) / 20);
        gains[i].gain.value = amp;
      }
    },

    destroy() {
      for (const osc of oscillators) {
        try { osc.stop(); osc.disconnect(); } catch { /* */ }
      }
      for (const gain of gains) {
        try { gain.disconnect(); } catch { /* */ }
      }
      output.disconnect();
    },
  };
}

// ============================================================================
// WAVETABLE SYNTHESIS
// ============================================================================

// Built-in wavetables
const WAVETABLES = {
  basic: _generateWavetable([1, 0.5, 0.33, 0.25, 0.2, 0.167, 0.143, 0.125]),
  saw: _generateWavetable(Array.from({ length: 32 }, (_, i) => 1 / (i + 1))),
  square: _generateWavetable(Array.from({ length: 16 }, (_, i) => i % 2 === 0 ? 1 / (i + 1) : 0)),
  pulse: _generateWavetable([1, 0.8, 0.6, 0.4, 0.2, 0.1, 0.05, 0.025]),
  organ: _generateWavetable([1, 0, 0.5, 0, 0.33, 0, 0.25, 0]),
  brass: _generateWavetable([1, 0.8, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15]),
  vocal: _generateWavetable([1, 0.3, 0.7, 0.2, 0.5, 0.1, 0.3, 0.05]),
  bell: _generateWavetable([1, 0.1, 0.6, 0.05, 0.4, 0.02, 0.3, 0.01, 0.2, 0.005]),
};

function _generateWavetable(harmonics) {
  const size = 2048;
  const table = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    const phase = (i / size) * 2 * Math.PI;
    let sample = 0;
    for (let h = 0; h < harmonics.length; h++) {
      sample += harmonics[h] * Math.sin(phase * (h + 1));
    }
    table[i] = sample;
  }

  // Normalize
  let max = 0;
  for (let i = 0; i < size; i++) {
    max = Math.max(max, Math.abs(table[i]));
  }
  if (max > 0) {
    for (let i = 0; i < size; i++) {
      table[i] /= max;
    }
  }

  return table;
}

/**
 * Create a wavetable synthesizer.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object}
 */
export function createWavetableSynth(ctx, config = {}) {
  const frequency = config.frequency ?? 440;
  const tableName = config.table ?? 'basic';
  let position = config.position ?? 0; // 0-1 position in multi-table
  const morph = config.morph ?? 0;
  const detune = config.detune ?? 0;

  const output = ctx.createGain();
  output.gain.value = 1.0;

  // Get wavetable
  const table = WAVETABLES[tableName] || WAVETABLES.basic;

  // Create AudioBuffer from wavetable
  const buffer = ctx.createBuffer(1, table.length, ctx.sampleRate);
  buffer.getChannelData(0).set(table);

  // Use oscillator with custom waveform
  const osc = ctx.createOscillator();

  // Convert to PeriodicWave
  const real = new Float32Array(33);
  const imag = new Float32Array(33);
  real[0] = 0;
  imag[0] = 0;

  // Extract harmonics from wavetable via simple analysis
  const harmonicAmps = _analyzeWavetable(table, 32);
  for (let i = 0; i < 32; i++) {
    real[i + 1] = 0;
    imag[i + 1] = harmonicAmps[i];
  }

  const periodicWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  osc.setPeriodicWave(periodicWave);
  osc.frequency.value = frequency;
  osc.detune.value = detune;

  osc.connect(output);

  return {
    ctx,
    output,
    osc,
    config: { frequency, table: tableName, position, morph, detune },

    start(when = 0) {
      osc.start(when);
    },

    stop(when = 0) {
      osc.stop(when);
    },

    setFrequency(freq) {
      osc.frequency.value = freq;
    },

    setTable(name) {
      const newTable = WAVETABLES[name] || WAVETABLES.basic;
      const harmonics = _analyzeWavetable(newTable, 32);

      const real = new Float32Array(33);
      const imag = new Float32Array(33);
      for (let i = 0; i < 32; i++) {
        imag[i + 1] = harmonics[i];
      }

      const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      osc.setPeriodicWave(wave);
    },

    destroy() {
      try { osc.stop(); osc.disconnect(); } catch { /* */ }
      output.disconnect();
    },
  };
}

function _analyzeWavetable(table, harmonicCount) {
  const harmonics = new Float32Array(harmonicCount);
  const size = table.length;

  for (let h = 0; h < harmonicCount; h++) {
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const phase = (i / size) * 2 * Math.PI * (h + 1);
      sum += table[i] * Math.sin(phase);
    }
    harmonics[h] = (sum / size) * 2;
  }

  return harmonics;
}

// ============================================================================
// PHASE DISTORTION SYNTHESIS
// ============================================================================

const PD_SHAPES = ['saw', 'square', 'resonant', 'sync'];

/**
 * Create a phase distortion synthesizer (CZ-style).
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object}
 */
export function createPhaseDistortionSynth(ctx, config = {}) {
  const frequency = config.frequency ?? 440;
  const shape = config.shape ?? 'saw';
  let distortion = config.distortion ?? 0.5;
  let resonance = config.resonance ?? 0.3;

  const output = ctx.createGain();
  output.gain.value = 1.0;

  // Generate phase-distorted waveform as buffer
  const duration = 2.0;
  const buffer = _generatePDBuffer(ctx, shape, distortion, resonance, duration);

  let source = null;

  return {
    ctx,
    output,
    config: { frequency, shape, distortion, resonance },

    start(when = 0) {
      if (source) {
        try { source.stop(); source.disconnect(); } catch { /* */ }
      }

      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = frequency / (ctx.sampleRate / buffer.length);
      source.connect(output);
      source.start(when);
    },

    stop(when = 0) {
      if (source) {
        source.stop(when);
      }
    },

    setFrequency(freq) {
      if (source) {
        source.playbackRate.value = freq / (ctx.sampleRate / buffer.length);
      }
    },

    setDistortion(d) {
      distortion = d;
      // Would need to regenerate buffer for real-time changes
    },

    destroy() {
      if (source) {
        try { source.stop(); source.disconnect(); } catch { /* */ }
      }
      output.disconnect();
    },
  };
}

function _generatePDBuffer(ctx, shape, distortion, resonance, duration) {
  const sampleRate = ctx.sampleRate;
  const length = Math.ceil(sampleRate); // 1 second of waveform cycles
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  const cycleLength = 256; // Samples per cycle

  for (let i = 0; i < length; i++) {
    const t = (i % cycleLength) / cycleLength; // 0-1 within cycle

    // Phase distortion
    let phase = _distortPhase(t, distortion, shape);

    // Generate sample
    let sample = 0;
    switch (shape) {
      case 'saw':
        sample = 2 * phase - 1;
        break;
      case 'square':
        sample = phase < 0.5 ? 1 : -1;
        break;
      case 'resonant':
        // Resonant filter simulation
        sample = Math.sin(2 * Math.PI * phase * (1 + resonance * 4));
        break;
      case 'sync':
        // Hard sync simulation
        const syncCycles = 1 + distortion * 3;
        sample = Math.sin(2 * Math.PI * phase * syncCycles);
        break;
      default:
        sample = Math.sin(2 * Math.PI * phase);
    }

    data[i] = sample;
  }

  return buffer;
}

function _distortPhase(t, amount, shape) {
  // Various phase distortion curves
  const a = amount;

  switch (shape) {
    case 'saw':
      // Accelerate then decelerate
      if (t < 0.5) {
        return t * (1 + a);
      } else {
        return 0.5 * (1 + a) + (t - 0.5) * (1 - a);
      }

    case 'square':
      // Sharp transition
      const threshold = 0.5 - a * 0.4;
      if (t < threshold) {
        return t / threshold * 0.5;
      } else {
        return 0.5 + (t - threshold) / (1 - threshold) * 0.5;
      }

    case 'resonant':
      // Cosine distortion
      return t + a * 0.2 * Math.sin(2 * Math.PI * t);

    default:
      return t;
  }
}

// ============================================================================
// SUBTRACTIVE SYNTHESIS
// ============================================================================

/**
 * Create a classic subtractive synthesizer voice.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object}
 */
export function createSubtractiveSynth(ctx, config = {}) {
  const oscShape = config.oscShape ?? 'saw';
  const filterType = config.filterType ?? 'lowpass';
  const filterFreq = config.filterFreq ?? 2000;
  const filterRes = config.filterRes ?? 0.5;
  const filterEnv = config.filterEnv ?? 0.5;
  const attack = config.attack ?? 0.01;
  const decay = config.decay ?? 0.2;
  const sustain = config.sustain ?? 0.7;
  const release = config.release ?? 0.3;

  const output = ctx.createGain();
  output.gain.value = 1.0;

  let activeVoice = null;

  return {
    ctx,
    output,
    config: { oscShape, filterType, filterFreq, filterRes, filterEnv, attack, decay, sustain, release },

    noteOn(note, velocity = 0.8, when = 0) {
      const startAt = when || ctx.currentTime;
      const freq = typeof note === 'number' && note < 128 ? midiToFreq(note) : note;

      // Stop existing
      if (activeVoice) {
        this.noteOff(0, startAt);
      }

      // Oscillator
      const osc = ctx.createOscillator();
      osc.type = oscShape === 'saw' ? 'sawtooth' : oscShape;
      osc.frequency.value = freq;

      // Filter
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.Q.value = filterRes * 20;

      // Filter envelope
      const filterPeak = filterFreq + filterEnv * 5000;
      filter.frequency.setValueAtTime(filterFreq, startAt);
      filter.frequency.linearRampToValueAtTime(filterPeak, startAt + attack);
      filter.frequency.exponentialRampToValueAtTime(
        filterFreq + (filterPeak - filterFreq) * 0.3,
        startAt + attack + decay
      );

      // Amp envelope
      const ampGain = ctx.createGain();
      ampGain.gain.setValueAtTime(0, startAt);
      ampGain.gain.linearRampToValueAtTime(velocity, startAt + attack);
      ampGain.gain.linearRampToValueAtTime(velocity * sustain, startAt + attack + decay);

      // Connect
      osc.connect(filter);
      filter.connect(ampGain);
      ampGain.connect(output);

      osc.start(startAt);

      activeVoice = { osc, filter, ampGain, startTime: startAt };
    },

    noteOff(note, when = 0) {
      if (!activeVoice) return;

      const releaseAt = when || ctx.currentTime;

      activeVoice.ampGain.gain.cancelScheduledValues(releaseAt);
      activeVoice.ampGain.gain.setValueAtTime(activeVoice.ampGain.gain.value, releaseAt);
      activeVoice.ampGain.gain.linearRampToValueAtTime(0, releaseAt + release);

      activeVoice.filter.frequency.cancelScheduledValues(releaseAt);
      activeVoice.filter.frequency.linearRampToValueAtTime(filterFreq * 0.5, releaseAt + release);

      const voice = activeVoice;
      activeVoice = null;

      setTimeout(() => {
        try { voice.osc.stop(); voice.osc.disconnect(); } catch { /* */ }
        try { voice.filter.disconnect(); } catch { /* */ }
        try { voice.ampGain.disconnect(); } catch { /* */ }
      }, (release + 0.1) * 1000);
    },

    destroy() {
      if (activeVoice) {
        this.noteOff();
      }
      output.disconnect();
    },
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export const WAVETABLE_NAMES = Object.keys(WAVETABLES);
export const PD_SHAPE_OPTIONS = PD_SHAPES;
