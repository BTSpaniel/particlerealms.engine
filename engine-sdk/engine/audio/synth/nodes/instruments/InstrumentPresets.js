// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../../../core/math/MathRandom.js';

/**
 * InstrumentPresets.js — Pre-built Instrument Macro Nodes
 * 
 * High-level instrument generators that combine multiple synthesis techniques:
 * - PianoInstrument: Physical modeling + FM for piano/keys
 * - StringsInstrument: Additive/subtractive for ensemble strings
 * - BrassInstrument: Subtractive + waveshaping for brass
 * - PadSynth: Detuned oscillators for lush pads
 * - LeadSynth: Mono synth with filter envelope
 * - BassSynth: Sub bass with drive
 * - DrumSynth: Analog-style drum synthesis
 *
 * Usage:
 *   import { createPianoInstrument, createDrumSynth } from './InstrumentPresets.js';
 *   const piano = createPianoInstrument(audioCtx, { type: 'grand' });
 *   piano.noteOn(60, 0.8); // MIDI note 60, velocity 0.8
 */

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Convert MIDI note number to frequency.
 * @param {number} note - MIDI note (0-127)
 * @returns {number} Frequency in Hz
 */
export function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Convert frequency to MIDI note number.
 * @param {number} freq - Frequency in Hz
 * @returns {number} MIDI note (fractional)
 */
export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

// ============================================================================
// PIANO INSTRUMENT
// ============================================================================

const PIANO_TYPES = ['grand', 'upright', 'electric', 'honky'];

/**
 * Create a piano instrument using Karplus-Strong + FM.
 */
export function createPianoInstrument(ctx, config = {}) {
  const type = config.type ?? 'grand';
  const brightness = config.brightness ?? 0.5;
  const hardness = config.hardness ?? 0.5;
  const resonance = config.resonance ?? 0.3;
  const volume = config.volume ?? 0.8;

  const output = ctx.createGain();
  output.gain.value = volume;

  // Type-specific parameters
  const typeParams = {
    grand: { decay: 3.0, inharmonicity: 0.0005, stereoWidth: 0.5 },
    upright: { decay: 2.0, inharmonicity: 0.001, stereoWidth: 0.3 },
    electric: { decay: 1.5, inharmonicity: 0.0001, stereoWidth: 0.2 },
    honky: { decay: 1.0, inharmonicity: 0.003, stereoWidth: 0.4 },
  }[type] || typeParams.grand;

  const activeVoices = new Map();

  return {
    ctx,
    output,
    config: { type, brightness, hardness, resonance, volume },
    activeVoices,

    /**
     * Trigger a note.
     * @param {number} note - MIDI note number
     * @param {number} velocity - 0-1 velocity
     * @param {number} when - Start time
     */
    noteOn(note, velocity = 0.8, when = 0) {
      const startAt = when || ctx.currentTime;
      const freq = midiToFreq(note);

      // Create string model using delay line
      const delayTime = 1 / freq;
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = delayTime;

      // Excitation: noise burst shaped by hardness
      const exciteLen = 0.002 + (1 - hardness) * 0.008;
      const exciteBuffer = _createExcitationBuffer(ctx, exciteLen, brightness);
      const exciteSource = ctx.createBufferSource();
      exciteSource.buffer = exciteBuffer;

      // Feedback filter (brightness)
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1000 + brightness * 8000;
      filter.Q.value = 0.5;

      // Feedback gain (decay)
      const feedbackGain = ctx.createGain();
      const decayFactor = 0.99 - (1 - typeParams.decay / 5) * 0.02;
      feedbackGain.gain.value = -decayFactor; // Negative for string

      // Velocity envelope
      const velocityGain = ctx.createGain();
      velocityGain.gain.value = velocity * 0.5;

      // Connect
      exciteSource.connect(delay);
      delay.connect(filter);
      filter.connect(velocityGain);
      filter.connect(feedbackGain);
      feedbackGain.connect(delay);
      velocityGain.connect(output);

      exciteSource.start(startAt);

      // Store voice for noteOff
      activeVoices.set(note, {
        exciteSource,
        velocityGain,
        feedbackGain,
        startTime: startAt,
      });

      // Auto-cleanup after decay
      const cleanupTime = (typeParams.decay * 2) * 1000;
      setTimeout(() => {
        if (activeVoices.has(note)) {
          this.noteOff(note);
        }
      }, cleanupTime);
    },

    /**
     * Release a note.
     * @param {number} note - MIDI note number
     * @param {number} when - Release time
     */
    noteOff(note, when = 0) {
      const voice = activeVoices.get(note);
      if (!voice) return;

      const releaseAt = when || ctx.currentTime;

      // Quick damping
      voice.feedbackGain.gain.linearRampToValueAtTime(0, releaseAt + 0.1);
      voice.velocityGain.gain.linearRampToValueAtTime(0, releaseAt + 0.15);

      activeVoices.delete(note);
    },

    destroy() {
      for (const [note] of activeVoices) {
        this.noteOff(note);
      }
      output.disconnect();
    },
  };
}

function _createExcitationBuffer(ctx, duration, brightness) {
  const length = Math.ceil(duration * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const env = 1 - i / length;
    // Mix noise with a bit of sine for tonal attack
    const noise = uniformDistribution(-1, 1, Math.random) * env;
    const tone = Math.sin(2 * Math.PI * 2000 * i / ctx.sampleRate) * env * brightness * 0.3;
    data[i] = noise + tone;
  }

  return buffer;
}

// ============================================================================
// STRINGS INSTRUMENT
// ============================================================================

const STRING_TYPES = ['ensemble', 'solo', 'pizzicato', 'tremolo'];

/**
 * Create a string ensemble instrument.
 */
export function createStringsInstrument(ctx, config = {}) {
  const type = config.type ?? 'ensemble';
  const attack = config.attack ?? 0.3;
  const vibrato = config.vibrato ?? 0.3;
  const brightness = config.brightness ?? 0.5;
  const volume = config.volume ?? 0.8;

  const output = ctx.createGain();
  output.gain.value = volume;

  const activeVoices = new Map();

  return {
    ctx,
    output,
    config: { type, attack, vibrato, brightness, volume },
    activeVoices,

    noteOn(note, velocity = 0.8, when = 0) {
      const startAt = when || ctx.currentTime;
      const freq = midiToFreq(note);

      // Multiple detuned oscillators for ensemble
      const voiceCount = type === 'ensemble' ? 4 : 2;
      const oscs = [];
      const gains = [];

      for (let i = 0; i < voiceCount; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        // Detune for chorus effect
        osc.detune.value = (i - voiceCount / 2) * 8;

        const gain = ctx.createGain();
        gain.gain.value = 0;

        osc.connect(gain);
        gains.push(gain);
        oscs.push(osc);
      }

      // Vibrato LFO
      const vibratoLFO = ctx.createOscillator();
      vibratoLFO.type = 'sine';
      vibratoLFO.frequency.value = 5;
      const vibratoGain = ctx.createGain();
      vibratoGain.gain.value = vibrato * 10; // cents

      vibratoLFO.connect(vibratoGain);
      for (const osc of oscs) {
        vibratoGain.connect(osc.detune);
      }

      // Filter for brightness
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500 + brightness * 4000;

      // Mix and connect
      const mixGain = ctx.createGain();
      mixGain.gain.value = velocity / voiceCount;

      for (const gain of gains) {
        gain.connect(filter);
      }
      filter.connect(mixGain);
      mixGain.connect(output);

      // Attack envelope
      for (const gain of gains) {
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(1, startAt + attack);
      }

      // Start oscillators
      for (const osc of oscs) {
        osc.start(startAt);
      }
      vibratoLFO.start(startAt);

      activeVoices.set(note, { oscs, gains, filter, mixGain, vibratoLFO, vibratoGain });
    },

    noteOff(note, when = 0) {
      const voice = activeVoices.get(note);
      if (!voice) return;

      const releaseAt = when || ctx.currentTime;
      const releaseTime = 0.5;

      for (const gain of voice.gains) {
        gain.gain.cancelScheduledValues(releaseAt);
        gain.gain.setValueAtTime(gain.gain.value, releaseAt);
        gain.gain.linearRampToValueAtTime(0, releaseAt + releaseTime);
      }

      // Stop after release
      setTimeout(() => {
        for (const osc of voice.oscs) {
          try { osc.stop(); osc.disconnect(); } catch { /* */ }
        }
        try { voice.vibratoLFO.stop(); voice.vibratoLFO.disconnect(); } catch { /* */ }
        try { voice.filter.disconnect(); } catch { /* */ }
        try { voice.mixGain.disconnect(); } catch { /* */ }
      }, (releaseTime + 0.1) * 1000);

      activeVoices.delete(note);
    },

    destroy() {
      for (const [note] of activeVoices) {
        this.noteOff(note);
      }
      output.disconnect();
    },
  };
}

// ============================================================================
// BRASS INSTRUMENT
// ============================================================================

const BRASS_TYPES = ['trumpet', 'trombone', 'horn', 'tuba'];

/**
 * Create a brass instrument with growl and brightness.
 */
export function createBrassInstrument(ctx, config = {}) {
  const type = config.type ?? 'trumpet';
  const brightness = config.brightness ?? 0.6;
  const growl = config.growl ?? 0.2;
  const attack = config.attack ?? 0.05;
  const volume = config.volume ?? 0.8;

  const output = ctx.createGain();
  output.gain.value = volume;

  const activeVoices = new Map();

  return {
    ctx,
    output,
    config: { type, brightness, growl, attack, volume },
    activeVoices,

    noteOn(note, velocity = 0.8, when = 0) {
      const startAt = when || ctx.currentTime;
      const freq = midiToFreq(note);

      // Main oscillator (sawtooth for brass)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;

      // Growl modulator
      const growlOsc = ctx.createOscillator();
      growlOsc.type = 'sine';
      growlOsc.frequency.value = 30;
      const growlGain = ctx.createGain();
      growlGain.gain.value = growl * freq * 0.02;
      growlOsc.connect(growlGain);
      growlGain.connect(osc.frequency);

      // Filter with envelope
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2;

      // Filter envelope: closed to open
      const baseFreq = 200 + brightness * 500;
      const peakFreq = 1000 + brightness * 6000;
      filter.frequency.setValueAtTime(baseFreq, startAt);
      filter.frequency.linearRampToValueAtTime(peakFreq, startAt + attack);

      // Amplitude envelope
      const ampGain = ctx.createGain();
      ampGain.gain.setValueAtTime(0, startAt);
      ampGain.gain.linearRampToValueAtTime(velocity, startAt + attack);

      // Waveshaper for bite
      const shaper = ctx.createWaveShaper();
      shaper.curve = _createBrassDistortionCurve(brightness * 0.3);

      osc.connect(filter);
      filter.connect(shaper);
      shaper.connect(ampGain);
      ampGain.connect(output);

      osc.start(startAt);
      growlOsc.start(startAt);

      activeVoices.set(note, { osc, growlOsc, growlGain, filter, ampGain, shaper });
    },

    noteOff(note, when = 0) {
      const voice = activeVoices.get(note);
      if (!voice) return;

      const releaseAt = when || ctx.currentTime;
      const releaseTime = 0.15;

      voice.ampGain.gain.cancelScheduledValues(releaseAt);
      voice.ampGain.gain.setValueAtTime(voice.ampGain.gain.value, releaseAt);
      voice.ampGain.gain.linearRampToValueAtTime(0, releaseAt + releaseTime);

      setTimeout(() => {
        try { voice.osc.stop(); voice.osc.disconnect(); } catch { /* */ }
        try { voice.growlOsc.stop(); voice.growlOsc.disconnect(); } catch { /* */ }
        try { voice.filter.disconnect(); } catch { /* */ }
        try { voice.ampGain.disconnect(); } catch { /* */ }
      }, (releaseTime + 0.1) * 1000);

      activeVoices.delete(note);
    },

    destroy() {
      for (const [note] of activeVoices) {
        this.noteOff(note);
      }
      output.disconnect();
    },
  };
}

function _createBrassDistortionCurve(amount) {
  const samples = 256;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * (1 + amount * 3));
  }
  return curve;
}

// ============================================================================
// PAD SYNTH
// ============================================================================

const PAD_TYPES = ['warm', 'bright', 'dark', 'evolving', 'shimmer'];

/**
 * Create a lush pad synthesizer.
 */
export function createPadSynth(ctx, config = {}) {
  const type = config.type ?? 'warm';
  const attack = config.attack ?? 0.5;
  const release = config.release ?? 1.0;
  const detune = config.detune ?? 10;
  const brightness = config.brightness ?? 0.4;
  const volume = config.volume ?? 0.7;

  const output = ctx.createGain();
  output.gain.value = volume;

  const activeVoices = new Map();

  return {
    ctx,
    output,
    config: { type, attack, release, detune, brightness, volume },
    activeVoices,

    noteOn(note, velocity = 0.8, when = 0) {
      const startAt = when || ctx.currentTime;
      const freq = midiToFreq(note);

      // Multiple detuned oscillators
      const voiceCount = 6;
      const oscs = [];
      const gains = [];

      const shapes = type === 'bright' ? ['sawtooth', 'square'] :
                     type === 'dark' ? ['triangle', 'sine'] :
                     ['sawtooth', 'triangle'];

      for (let i = 0; i < voiceCount; i++) {
        const osc = ctx.createOscillator();
        osc.type = shapes[i % shapes.length];
        osc.frequency.value = freq;
        osc.detune.value = (i - voiceCount / 2) * detune;

        const gain = ctx.createGain();
        gain.gain.value = 0;

        osc.connect(gain);
        oscs.push(osc);
        gains.push(gain);
      }

      // Slow LFO for movement
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = uniformDistribution(0.2, 0.5, Math.random);
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = detune * 0.5;
      lfo.connect(lfoGain);
      for (const osc of oscs) {
        lfoGain.connect(osc.detune);
      }

      // Filter
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300 + brightness * 3000;
      filter.Q.value = 1;

      // Mix
      const mixGain = ctx.createGain();
      mixGain.gain.value = velocity / voiceCount;

      for (const gain of gains) {
        gain.connect(filter);
      }
      filter.connect(mixGain);
      mixGain.connect(output);

      // Envelope
      for (const gain of gains) {
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(1, startAt + attack);
      }

      for (const osc of oscs) {
        osc.start(startAt);
      }
      lfo.start(startAt);

      activeVoices.set(note, { oscs, gains, filter, mixGain, lfo, lfoGain });
    },

    noteOff(note, when = 0) {
      const voice = activeVoices.get(note);
      if (!voice) return;

      const releaseAt = when || ctx.currentTime;

      for (const gain of voice.gains) {
        gain.gain.cancelScheduledValues(releaseAt);
        gain.gain.setValueAtTime(gain.gain.value, releaseAt);
        gain.gain.linearRampToValueAtTime(0, releaseAt + release);
      }

      setTimeout(() => {
        for (const osc of voice.oscs) {
          try { osc.stop(); osc.disconnect(); } catch { /* */ }
        }
        try { voice.lfo.stop(); voice.lfo.disconnect(); } catch { /* */ }
        try { voice.filter.disconnect(); } catch { /* */ }
        try { voice.mixGain.disconnect(); } catch { /* */ }
      }, (release + 0.1) * 1000);

      activeVoices.delete(note);
    },

    destroy() {
      for (const [note] of activeVoices) {
        this.noteOff(note);
      }
      output.disconnect();
    },
  };
}

// ============================================================================
// LEAD SYNTH
// ============================================================================

const LEAD_TYPES = ['square', 'saw', 'sync', 'pwm'];

/**
 * Create a mono lead synthesizer with glide.
 */
export function createLeadSynth(ctx, config = {}) {
  const type = config.type ?? 'square';
  const glide = config.glide ?? 0.05;
  const pulseWidth = config.pulseWidth ?? 0.5;
  const filterEnv = config.filterEnv ?? 0.5;
  const volume = config.volume ?? 0.8;

  const output = ctx.createGain();
  output.gain.value = volume;

  // Mono synth - single voice
  let currentVoice = null;
  let lastFreq = 440;

  return {
    ctx,
    output,
    config: { type, glide, pulseWidth, filterEnv, volume },

    noteOn(note, velocity = 0.8, when = 0) {
      const startAt = when || ctx.currentTime;
      const freq = midiToFreq(note);

      // If voice exists, glide to new note
      if (currentVoice) {
        currentVoice.osc.frequency.cancelScheduledValues(startAt);
        currentVoice.osc.frequency.setValueAtTime(lastFreq, startAt);
        currentVoice.osc.frequency.linearRampToValueAtTime(freq, startAt + glide);

        // Re-trigger filter envelope
        currentVoice.filter.frequency.cancelScheduledValues(startAt);
        currentVoice.filter.frequency.setValueAtTime(200, startAt);
        currentVoice.filter.frequency.linearRampToValueAtTime(
          200 + filterEnv * 5000, startAt + 0.1
        );

        lastFreq = freq;
        return;
      }

      // Create new voice
      const osc = ctx.createOscillator();
      osc.type = type === 'saw' ? 'sawtooth' : 'square';
      osc.frequency.value = freq;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      filter.frequency.setValueAtTime(200, startAt);
      filter.frequency.linearRampToValueAtTime(200 + filterEnv * 5000, startAt + 0.1);

      const ampGain = ctx.createGain();
      ampGain.gain.setValueAtTime(0, startAt);
      ampGain.gain.linearRampToValueAtTime(velocity, startAt + 0.01);

      osc.connect(filter);
      filter.connect(ampGain);
      ampGain.connect(output);

      osc.start(startAt);

      currentVoice = { osc, filter, ampGain };
      lastFreq = freq;
    },

    noteOff(note, when = 0) {
      if (!currentVoice) return;

      const releaseAt = when || ctx.currentTime;
      const releaseTime = 0.1;

      currentVoice.ampGain.gain.cancelScheduledValues(releaseAt);
      currentVoice.ampGain.gain.setValueAtTime(currentVoice.ampGain.gain.value, releaseAt);
      currentVoice.ampGain.gain.linearRampToValueAtTime(0, releaseAt + releaseTime);

      const voice = currentVoice;
      currentVoice = null;

      setTimeout(() => {
        try { voice.osc.stop(); voice.osc.disconnect(); } catch { /* */ }
        try { voice.filter.disconnect(); } catch { /* */ }
        try { voice.ampGain.disconnect(); } catch { /* */ }
      }, (releaseTime + 0.1) * 1000);
    },

    destroy() {
      this.noteOff();
      output.disconnect();
    },
  };
}

// ============================================================================
// BASS SYNTH
// ============================================================================

const BASS_TYPES = ['sub', 'reese', 'acid', 'fm'];

/**
 * Create a bass synthesizer.
 */
export function createBassSynth(ctx, config = {}) {
  const type = config.type ?? 'sub';
  const drive = config.drive ?? 0.3;
  const filterFreq = config.filterFreq ?? 800;
  const filterEnv = config.filterEnv ?? 0.4;
  const volume = config.volume ?? 0.8;

  const output = ctx.createGain();
  output.gain.value = volume;

  let currentVoice = null;

  return {
    ctx,
    output,
    config: { type, drive, filterFreq, filterEnv, volume },

    noteOn(note, velocity = 0.8, when = 0) {
      const startAt = when || ctx.currentTime;
      const freq = midiToFreq(note);

      // Stop existing voice
      if (currentVoice) {
        this.noteOff(0, startAt);
      }

      // Sub oscillator (sine)
      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.value = freq;

      // Main oscillator
      const mainOsc = ctx.createOscillator();
      mainOsc.type = type === 'acid' ? 'sawtooth' : 'square';
      mainOsc.frequency.value = freq;

      // Mix
      const subGain = ctx.createGain();
      subGain.gain.value = 0.6;

      const mainGain = ctx.createGain();
      mainGain.gain.value = 0.4;

      // Filter
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = type === 'acid' ? 8 : 2;
      filter.frequency.setValueAtTime(filterFreq, startAt);
      filter.frequency.linearRampToValueAtTime(
        filterFreq + filterEnv * 3000, startAt + 0.05
      );
      filter.frequency.exponentialRampToValueAtTime(filterFreq, startAt + 0.3);

      // Drive
      const shaper = ctx.createWaveShaper();
      shaper.curve = _createBassDistortionCurve(drive);

      // Amp envelope
      const ampGain = ctx.createGain();
      ampGain.gain.setValueAtTime(0, startAt);
      ampGain.gain.linearRampToValueAtTime(velocity, startAt + 0.005);

      // Connect
      subOsc.connect(subGain);
      mainOsc.connect(mainGain);
      subGain.connect(filter);
      mainGain.connect(filter);
      filter.connect(shaper);
      shaper.connect(ampGain);
      ampGain.connect(output);

      subOsc.start(startAt);
      mainOsc.start(startAt);

      currentVoice = { subOsc, mainOsc, subGain, mainGain, filter, shaper, ampGain };
    },

    noteOff(note, when = 0) {
      if (!currentVoice) return;

      const releaseAt = when || ctx.currentTime;
      const releaseTime = 0.05;

      currentVoice.ampGain.gain.cancelScheduledValues(releaseAt);
      currentVoice.ampGain.gain.setValueAtTime(currentVoice.ampGain.gain.value, releaseAt);
      currentVoice.ampGain.gain.linearRampToValueAtTime(0, releaseAt + releaseTime);

      const voice = currentVoice;
      currentVoice = null;

      setTimeout(() => {
        try { voice.subOsc.stop(); voice.subOsc.disconnect(); } catch { /* */ }
        try { voice.mainOsc.stop(); voice.mainOsc.disconnect(); } catch { /* */ }
        try { voice.filter.disconnect(); } catch { /* */ }
        try { voice.ampGain.disconnect(); } catch { /* */ }
      }, (releaseTime + 0.1) * 1000);
    },

    destroy() {
      this.noteOff();
      output.disconnect();
    },
  };
}

function _createBassDistortionCurve(amount) {
  const samples = 256;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * (1 + amount * 5));
  }
  return curve;
}

// ============================================================================
// DRUM SYNTH
// ============================================================================

const DRUM_TYPES = ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell'];

/**
 * Create an analog-style drum synthesizer.
 */
export function createDrumSynth(ctx, config = {}) {
  const type = config.type ?? 'kick';
  const pitch = config.pitch ?? 60;
  const decay = config.decay ?? 0.3;
  const tone = config.tone ?? 0.5;
  const snap = config.snap ?? 0.5;
  const volume = config.volume ?? 0.9;

  const output = ctx.createGain();
  output.gain.value = volume;

  return {
    ctx,
    output,
    config: { type, pitch, decay, tone, snap, volume },

    /**
     * Trigger the drum sound.
     */
    trigger(velocity = 0.9, when = 0) {
      const startAt = when || ctx.currentTime;

      switch (type) {
        case 'kick':
          _triggerKick(ctx, output, startAt, pitch, decay, tone, snap, velocity);
          break;
        case 'snare':
          _triggerSnare(ctx, output, startAt, pitch, decay, tone, snap, velocity);
          break;
        case 'hihat':
          _triggerHihat(ctx, output, startAt, decay, tone, velocity);
          break;
        case 'clap':
          _triggerClap(ctx, output, startAt, decay, velocity);
          break;
        case 'tom':
          _triggerTom(ctx, output, startAt, pitch, decay, tone, velocity);
          break;
        case 'rim':
          _triggerRim(ctx, output, startAt, pitch, velocity);
          break;
        case 'cowbell':
          _triggerCowbell(ctx, output, startAt, pitch, decay, velocity);
          break;
      }
    },

    destroy() {
      output.disconnect();
    },
  };
}

function _triggerKick(ctx, output, when, pitch, decay, tone, snap, velocity) {
  const freq = midiToFreq(pitch);

  // Pitch envelope
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq * 4, when);
  osc.frequency.exponentialRampToValueAtTime(freq, when + 0.03);

  // Click/snap
  const clickOsc = ctx.createOscillator();
  clickOsc.type = 'square';
  clickOsc.frequency.value = 1000;

  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(snap * velocity, when);
  clickGain.gain.exponentialRampToValueAtTime(0.001, when + 0.02);

  // Amp envelope
  const ampGain = ctx.createGain();
  ampGain.gain.setValueAtTime(velocity, when);
  ampGain.gain.exponentialRampToValueAtTime(0.001, when + decay);

  // Filter
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 100 + tone * 400;

  osc.connect(filter);
  filter.connect(ampGain);
  clickOsc.connect(clickGain);
  clickGain.connect(ampGain);
  ampGain.connect(output);

  osc.start(when);
  osc.stop(when + decay + 0.1);
  clickOsc.start(when);
  clickOsc.stop(when + 0.03);
}

function _triggerSnare(ctx, output, when, pitch, decay, tone, snap, velocity) {
  // Body (sine with pitch drop)
  const bodyOsc = ctx.createOscillator();
  bodyOsc.type = 'triangle';
  bodyOsc.frequency.setValueAtTime(midiToFreq(pitch), when);
  bodyOsc.frequency.exponentialRampToValueAtTime(midiToFreq(pitch) * 0.5, when + 0.1);

  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(velocity * tone, when);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, when + 0.15);

  // Snare wires (noise)
  const noiseLen = Math.ceil(decay * ctx.sampleRate);
  const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) {
    noiseData[i] = uniformDistribution(-1, 1, Math.random);
  }

  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 2000 + tone * 3000;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(velocity * snap, when);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, when + decay);

  bodyOsc.connect(bodyGain);
  bodyGain.connect(output);
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(output);

  bodyOsc.start(when);
  bodyOsc.stop(when + 0.2);
  noiseSource.start(when);
}

function _triggerHihat(ctx, output, when, decay, tone, velocity) {
  // Multiple square waves at inharmonic ratios
  const freqs = [203, 307, 425, 531, 607, 809];
  const oscs = [];

  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f + tone * 200;
    oscs.push(osc);
  }

  const mixGain = ctx.createGain();
  mixGain.gain.value = 1 / freqs.length;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7000 + tone * 3000;

  const ampGain = ctx.createGain();
  ampGain.gain.setValueAtTime(velocity * 0.3, when);
  ampGain.gain.exponentialRampToValueAtTime(0.001, when + decay);

  for (const osc of oscs) {
    osc.connect(mixGain);
  }
  mixGain.connect(filter);
  filter.connect(ampGain);
  ampGain.connect(output);

  for (const osc of oscs) {
    osc.start(when);
    osc.stop(when + decay + 0.1);
  }
}

function _triggerClap(ctx, output, when, decay, velocity) {
  // Multiple noise bursts with slight delays
  const burstCount = 4;
  for (let i = 0; i < burstCount; i++) {
    const burstTime = when + i * 0.01;
    const noiseLen = Math.ceil(0.02 * ctx.sampleRate);
    const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let j = 0; j < noiseLen; j++) {
      noiseData[j] = uniformDistribution(-1, 1, Math.random);
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(velocity * 0.4, burstTime);
    gain.gain.exponentialRampToValueAtTime(0.001, burstTime + 0.03);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    noiseSource.start(burstTime);
  }

  // Reverb tail (noise)
  const tailLen = Math.ceil(decay * ctx.sampleRate);
  const tailBuffer = ctx.createBuffer(1, tailLen, ctx.sampleRate);
  const tailData = tailBuffer.getChannelData(0);
  for (let i = 0; i < tailLen; i++) {
    tailData[i] = uniformDistribution(-1, 1, Math.random);
  }

  const tailSource = ctx.createBufferSource();
  tailSource.buffer = tailBuffer;

  const tailFilter = ctx.createBiquadFilter();
  tailFilter.type = 'bandpass';
  tailFilter.frequency.value = 1200;
  tailFilter.Q.value = 1;

  const tailGain = ctx.createGain();
  tailGain.gain.setValueAtTime(velocity * 0.2, when + 0.04);
  tailGain.gain.exponentialRampToValueAtTime(0.001, when + decay);

  tailSource.connect(tailFilter);
  tailFilter.connect(tailGain);
  tailGain.connect(output);
  tailSource.start(when + 0.03);
}

function _triggerTom(ctx, output, when, pitch, decay, tone, velocity) {
  const freq = midiToFreq(pitch);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq * 1.5, when);
  osc.frequency.exponentialRampToValueAtTime(freq, when + 0.05);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 200 + tone * 600;

  const ampGain = ctx.createGain();
  ampGain.gain.setValueAtTime(velocity, when);
  ampGain.gain.exponentialRampToValueAtTime(0.001, when + decay);

  osc.connect(filter);
  filter.connect(ampGain);
  ampGain.connect(output);

  osc.start(when);
  osc.stop(when + decay + 0.1);
}

function _triggerRim(ctx, output, when, pitch, velocity) {
  const freq = midiToFreq(pitch);

  // High-pitched click
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq * 4;

  const ampGain = ctx.createGain();
  ampGain.gain.setValueAtTime(velocity, when);
  ampGain.gain.exponentialRampToValueAtTime(0.001, when + 0.02);

  // Bandpass for character
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  filter.Q.value = 10;

  osc.connect(filter);
  filter.connect(ampGain);
  ampGain.connect(output);

  osc.start(when);
  osc.stop(when + 0.05);
}

function _triggerCowbell(ctx, output, when, pitch, decay, velocity) {
  const freq = midiToFreq(pitch);

  // Two oscillators at inharmonic ratio
  const osc1 = ctx.createOscillator();
  osc1.type = 'square';
  osc1.frequency.value = freq;

  const osc2 = ctx.createOscillator();
  osc2.type = 'square';
  osc2.frequency.value = freq * 1.47;

  const mixGain = ctx.createGain();
  mixGain.gain.value = 0.5;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq * 1.2;
  filter.Q.value = 5;

  const ampGain = ctx.createGain();
  ampGain.gain.setValueAtTime(velocity * 0.5, when);
  ampGain.gain.exponentialRampToValueAtTime(0.001, when + decay);

  osc1.connect(mixGain);
  osc2.connect(mixGain);
  mixGain.connect(filter);
  filter.connect(ampGain);
  ampGain.connect(output);

  osc1.start(when);
  osc1.stop(when + decay + 0.1);
  osc2.start(when);
  osc2.stop(when + decay + 0.1);
}

// ============================================================================
// EXPORTS
// ============================================================================

export const INSTRUMENT_TYPES = {
  piano: PIANO_TYPES,
  strings: STRING_TYPES,
  brass: BRASS_TYPES,
  pad: PAD_TYPES,
  lead: LEAD_TYPES,
  bass: BASS_TYPES,
  drum: DRUM_TYPES,
};
