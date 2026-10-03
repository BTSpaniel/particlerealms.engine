// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../../core/math/MathRandom.js';

/**
 * SequencerNode.js — Step Sequencer and Arpeggiator
 * 
 * Pattern-based note generation:
 * - StepSequencer: Programmable step patterns with gate, note, velocity
 * - Arpeggiator: Chord-based arpeggiation with multiple modes
 * - Clock: Master timing source with BPM, time signature, swing
 *
 * Usage:
 *   import { createClock, createStepSequencer, createArpeggiator } from './SequencerNode.js';
 *   const clock = createClock(audioCtx, { bpm: 120 });
 *   const seq = createStepSequencer(audioCtx, { steps: 16 });
 *   seq.onStep = (gate, note, vel) => synth.trigger(note, vel);
 *   clock.connect(seq);
 *   clock.start();
 */

// ============================================================================
// CLOCK
// ============================================================================

/**
 * Create a master clock with BPM and time signature.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object}
 */
export function createClock(ctx, config = {}) {
  let bpm = config.bpm ?? 120;
  const timeSignature = config.timeSignature ?? '4/4';
  let swing = config.swing ?? 0;
  let running = config.running ?? false;

  let tickCount = 0;
  let beatCount = 0;
  let barCount = 0;
  let lastTickTime = 0;
  let intervalId = null;

  const [beatsPerBar] = timeSignature.split('/').map(Number);
  const ticksPerBeat = 24; // Standard MIDI resolution

  const listeners = {
    tick: [],
    beat: [],
    bar: [],
  };

  const clock = {
    ctx,
    config: { bpm, timeSignature, swing },

    get bpm() { return bpm; },
    set bpm(v) { bpm = Math.max(20, Math.min(300, v)); },

    get swing() { return swing; },
    set swing(v) { swing = Math.max(0, Math.min(1, v)); },

    get running() { return running; },
    get tick() { return tickCount; },
    get beat() { return beatCount; },
    get bar() { return barCount; },

    /**
     * Add listener for clock events.
     * @param {'tick'|'beat'|'bar'} event
     * @param {Function} callback
     */
    on(event, callback) {
      if (listeners[event]) {
        listeners[event].push(callback);
      }
    },

    off(event, callback) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(cb => cb !== callback);
      }
    },

    /**
     * Start the clock.
     */
    start() {
      if (running) return;
      running = true;
      lastTickTime = ctx.currentTime;
      _scheduleTicks(clock, listeners, ctx, ticksPerBeat, beatsPerBar);
    },

    /**
     * Stop the clock.
     */
    stop() {
      running = false;
      if (intervalId) {
        clearTimeout(intervalId);
        intervalId = null;
      }
    },

    /**
     * Reset to beginning.
     */
    reset() {
      tickCount = 0;
      beatCount = 0;
      barCount = 0;
    },

    /**
     * Get time until next beat in seconds.
     */
    getTimeToNextBeat() {
      const tickDuration = 60 / (bpm * ticksPerBeat);
      const ticksUntilBeat = ticksPerBeat - (tickCount % ticksPerBeat);
      return ticksUntilBeat * tickDuration;
    },

    destroy() {
      this.stop();
      listeners.tick = [];
      listeners.beat = [];
      listeners.bar = [];
    },
  };

  // Internal refs
  clock._tickCount = () => tickCount;
  clock._setTickCount = (v) => { tickCount = v; };
  clock._setBeatCount = (v) => { beatCount = v; };
  clock._setBarCount = (v) => { barCount = v; };
  clock._setIntervalId = (v) => { intervalId = v; };
  clock._getIntervalId = () => intervalId;

  return clock;
}

function _scheduleTicks(clock, listeners, ctx, ticksPerBeat, beatsPerBar) {
  if (!clock.running) return;

  const tickDuration = 60 / (clock.bpm * ticksPerBeat);

  // Apply swing to even ticks
  let swingOffset = 0;
  if (clock._tickCount() % 2 === 1) {
    swingOffset = clock.swing * tickDuration * 0.5;
  }

  // Fire tick
  const tickTime = ctx.currentTime;
  for (const cb of listeners.tick) {
    try { cb(clock._tickCount(), tickTime); } catch { /* */ }
  }

  // Check for beat
  if (clock._tickCount() % ticksPerBeat === 0) {
    for (const cb of listeners.beat) {
      try { cb(clock.beat, tickTime); } catch { /* */ }
    }

    // Check for bar
    if (clock.beat % beatsPerBar === 0) {
      for (const cb of listeners.bar) {
        try { cb(clock.bar, tickTime); } catch { /* */ }
      }
      clock._setBarCount(clock.bar + 1);
    }

    clock._setBeatCount(clock.beat + 1);
  }

  clock._setTickCount(clock._tickCount() + 1);

  // Schedule next tick
  const nextTickDelay = (tickDuration + swingOffset) * 1000;
  clock._setIntervalId(setTimeout(() => _scheduleTicks(clock, listeners, ctx, ticksPerBeat, beatsPerBar), nextTickDelay));
}

// ============================================================================
// STEP SEQUENCER
// ============================================================================

const RATE_DIVISIONS = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32'];

/**
 * Create a step sequencer.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object}
 */
export function createStepSequencer(ctx, config = {}) {
  const steps = config.steps ?? 16;
  const rate = config.rate ?? '1/16';
  let swing = config.swing ?? 0;

  // Patterns: arrays of values per step
  let pattern = config.pattern ?? new Array(steps).fill(true); // gate on/off
  let notePattern = config.notePattern ?? new Array(steps).fill(60); // MIDI notes
  let velocityPattern = config.velocityPattern ?? new Array(steps).fill(0.8);

  let currentStep = 0;
  let ticksPerStep = _rateToTicks(rate);
  let tickCounter = 0;

  const seq = {
    ctx,
    config: { steps, rate, swing },

    // Callbacks
    onStep: null, // (gate, note, velocity, stepIndex) => void
    onReset: null,

    get currentStep() { return currentStep; },
    get pattern() { return pattern; },
    get notePattern() { return notePattern; },
    get velocityPattern() { return velocityPattern; },

    /**
     * Set gate pattern.
     * @param {boolean[]} newPattern
     */
    setPattern(newPattern) {
      pattern = newPattern.slice(0, steps);
      while (pattern.length < steps) pattern.push(false);
    },

    /**
     * Set note pattern.
     * @param {number[]} newPattern
     */
    setNotePattern(newPattern) {
      notePattern = newPattern.slice(0, steps);
      while (notePattern.length < steps) notePattern.push(60);
    },

    /**
     * Set velocity pattern.
     * @param {number[]} newPattern
     */
    setVelocityPattern(newPattern) {
      velocityPattern = newPattern.slice(0, steps);
      while (velocityPattern.length < steps) velocityPattern.push(0.8);
    },

    /**
     * Set individual step.
     */
    setStep(index, gate, note, velocity) {
      if (index >= 0 && index < steps) {
        if (gate !== undefined) pattern[index] = gate;
        if (note !== undefined) notePattern[index] = note;
        if (velocity !== undefined) velocityPattern[index] = velocity;
      }
    },

    /**
     * Process a clock tick. Call this from clock.on('tick').
     */
    tick(tickNumber, tickTime) {
      tickCounter++;
      if (tickCounter >= ticksPerStep) {
        tickCounter = 0;
        _triggerStep(seq);
      }
    },

    /**
     * Reset to step 0.
     */
    reset() {
      currentStep = 0;
      tickCounter = 0;
      if (seq.onReset) seq.onReset();
    },

    /**
     * Set rate division.
     */
    setRate(newRate) {
      seq.config.rate = newRate;
      ticksPerStep = _rateToTicks(newRate);
    },

    destroy() {
      seq.onStep = null;
      seq.onReset = null;
    },
  };

  seq._setCurrentStep = (v) => { currentStep = v; };

  return seq;
}

function _rateToTicks(rate) {
  // Assuming 24 ticks per beat (quarter note)
  const divisions = {
    '1/1': 96,   // whole note
    '1/2': 48,   // half note
    '1/4': 24,   // quarter note
    '1/8': 12,   // eighth note
    '1/16': 6,   // sixteenth note
    '1/32': 3,   // thirty-second note
  };
  return divisions[rate] || 6;
}

function _triggerStep(seq) {
  const step = seq.currentStep;
  const gate = seq.pattern[step];
  const note = seq.notePattern[step];
  const velocity = seq.velocityPattern[step];

  if (seq.onStep) {
    seq.onStep(gate, note, velocity, step);
  }

  // Advance step
  seq._setCurrentStep((step + 1) % seq.config.steps);
}

// ============================================================================
// ARPEGGIATOR
// ============================================================================

const ARP_MODES = ['up', 'down', 'updown', 'downup', 'random', 'order', 'chord'];

/**
 * Create an arpeggiator.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object}
 */
export function createArpeggiator(ctx, config = {}) {
  let mode = config.mode ?? 'up';
  let octaves = config.octaves ?? 2;
  const rate = config.rate ?? '1/16';
  let swing = config.swing ?? 0;
  let gateLength = config.gateLength ?? 0.5; // 0-1, proportion of step

  // Held notes
  const heldNotes = [];
  let sortedNotes = [];
  let currentIndex = 0;
  let direction = 1;
  let ticksPerStep = _rateToTicks(rate);
  let tickCounter = 0;

  // Gate timing
  let gateActive = false;
  let gateOffTimeout = null;

  const arp = {
    ctx,
    config: { mode, octaves, rate, swing, gateLength },

    // Callbacks
    onNoteOn: null,  // (note, velocity) => void
    onNoteOff: null, // (note) => void

    get mode() { return mode; },
    set mode(v) { mode = v; _updateSortedNotes(arp); },

    get octaves() { return octaves; },
    set octaves(v) { octaves = Math.max(1, Math.min(4, v)); _updateSortedNotes(arp); },

    get gateLength() { return gateLength; },
    set gateLength(v) { gateLength = Math.max(0.1, Math.min(1, v)); },

    /**
     * Add a held note.
     */
    noteOn(note, velocity = 0.8) {
      if (!heldNotes.find(n => n.note === note)) {
        heldNotes.push({ note, velocity });
        _updateSortedNotes(arp);
      }
    },

    /**
     * Remove a held note.
     */
    noteOff(note) {
      const idx = heldNotes.findIndex(n => n.note === note);
      if (idx >= 0) {
        heldNotes.splice(idx, 1);
        _updateSortedNotes(arp);
      }

      // If no notes held, stop gate
      if (heldNotes.length === 0 && gateActive) {
        _triggerGateOff(arp);
      }
    },

    /**
     * Process a clock tick.
     */
    tick(tickNumber, tickTime) {
      if (sortedNotes.length === 0) return;

      tickCounter++;
      if (tickCounter >= ticksPerStep) {
        tickCounter = 0;
        _triggerArpStep(arp, tickTime);
      }
    },

    /**
     * Reset arpeggiator state.
     */
    reset() {
      currentIndex = 0;
      direction = 1;
      tickCounter = 0;
    },

    /**
     * Set rate division.
     */
    setRate(newRate) {
      arp.config.rate = newRate;
      ticksPerStep = _rateToTicks(newRate);
    },

    /**
     * Get current held notes.
     */
    getHeldNotes() {
      return heldNotes.slice();
    },

    destroy() {
      if (gateOffTimeout) clearTimeout(gateOffTimeout);
      arp.onNoteOn = null;
      arp.onNoteOff = null;
      heldNotes.length = 0;
      sortedNotes.length = 0;
    },
  };

  // Internal
  arp._heldNotes = heldNotes;
  arp._sortedNotes = sortedNotes;
  arp._setSortedNotes = (v) => { sortedNotes = v; };
  arp._currentIndex = () => currentIndex;
  arp._setCurrentIndex = (v) => { currentIndex = v; };
  arp._direction = () => direction;
  arp._setDirection = (v) => { direction = v; };
  arp._setGateActive = (v) => { gateActive = v; };
  arp._getGateActive = () => gateActive;
  arp._setGateOffTimeout = (v) => { gateOffTimeout = v; };
  arp._getGateOffTimeout = () => gateOffTimeout;

  return arp;
}

function _updateSortedNotes(arp) {
  const { mode, octaves } = arp.config;
  const heldNotes = arp._heldNotes;

  if (heldNotes.length === 0) {
    arp._setSortedNotes([]);
    return;
  }

  // Sort by pitch
  const sorted = heldNotes.slice().sort((a, b) => a.note - b.note);

  // Expand across octaves
  const expanded = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const { note, velocity } of sorted) {
      expanded.push({ note: note + oct * 12, velocity });
    }
  }

  // Apply mode ordering
  let ordered;
  switch (mode) {
    case 'down':
      ordered = expanded.slice().reverse();
      break;
    case 'updown':
    case 'downup':
      // Will be handled dynamically
      ordered = expanded;
      break;
    case 'random':
      ordered = expanded; // Randomized per step
      break;
    case 'order':
      // Input order (not sorted by pitch)
      ordered = [];
      for (let oct = 0; oct < octaves; oct++) {
        for (const { note, velocity } of heldNotes) {
          ordered.push({ note: note + oct * 12, velocity });
        }
      }
      break;
    case 'chord':
      ordered = expanded; // All at once
      break;
    case 'up':
    default:
      ordered = expanded;
      break;
  }

  arp._setSortedNotes(ordered);

  // Reset index if needed
  if (arp._currentIndex() >= ordered.length) {
    arp._setCurrentIndex(0);
  }
}

function _triggerArpStep(arp, tickTime) {
  const sorted = arp._sortedNotes;
  if (sorted.length === 0) return;

  const mode = arp.config.mode;

  // Turn off previous note
  if (arp._getGateActive()) {
    _triggerGateOff(arp);
  }

  // Get current note
  let idx = arp._currentIndex();

  if (mode === 'random') {
    idx = Math.floor(uniformDistribution(0, sorted.length, Math.random));
  } else if (mode === 'chord') {
    // Trigger all notes
    for (const { note, velocity } of sorted) {
      if (arp.onNoteOn) arp.onNoteOn(note, velocity);
    }
    arp._setGateActive(true);

    // Schedule gate off
    const stepDuration = 60 / (120 * _rateToTicks(arp.config.rate) / 24) * 1000; // Approximate
    const gateOffDelay = stepDuration * arp.gateLength;
    arp._setGateOffTimeout(setTimeout(() => _triggerGateOff(arp), gateOffDelay));
    return;
  }

  const { note, velocity } = sorted[idx];

  // Trigger note
  if (arp.onNoteOn) arp.onNoteOn(note, velocity);
  arp._setGateActive(true);

  // Schedule gate off
  const stepDuration = 60 / (120 * _rateToTicks(arp.config.rate) / 24) * 1000;
  const gateOffDelay = stepDuration * arp.gateLength;
  arp._setGateOffTimeout(setTimeout(() => _triggerGateOff(arp), gateOffDelay));

  // Advance index
  let dir = arp._direction();
  if (mode === 'updown') {
    if (dir === 1 && idx >= sorted.length - 1) {
      dir = -1;
    } else if (dir === -1 && idx <= 0) {
      dir = 1;
    }
    arp._setDirection(dir);
  } else if (mode === 'downup') {
    if (dir === -1 && idx <= 0) {
      dir = 1;
    } else if (dir === 1 && idx >= sorted.length - 1) {
      dir = -1;
    }
    arp._setDirection(dir);
  }

  idx += dir;
  if (idx < 0) idx = sorted.length - 1;
  if (idx >= sorted.length) idx = 0;
  arp._setCurrentIndex(idx);
}

function _triggerGateOff(arp) {
  if (arp._getGateOffTimeout()) {
    clearTimeout(arp._getGateOffTimeout());
    arp._setGateOffTimeout(null);
  }

  if (arp.onNoteOff) {
    // For chord mode, turn off all notes
    if (arp.config.mode === 'chord') {
      for (const { note } of arp._sortedNotes) {
        arp.onNoteOff(note);
      }
    } else {
      // Turn off current note
      const idx = (arp._currentIndex() - arp._direction() + arp._sortedNotes.length) % arp._sortedNotes.length;
      if (arp._sortedNotes[idx]) {
        arp.onNoteOff(arp._sortedNotes[idx].note);
      }
    }
  }

  arp._setGateActive(false);
}

// ============================================================================
// EXPORTS
// ============================================================================

export const SEQUENCER_RATES = RATE_DIVISIONS;
export const ARPEGGIATOR_MODES = ARP_MODES;
