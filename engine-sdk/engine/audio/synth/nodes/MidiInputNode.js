// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MidiInputNode.js — MIDI Input Integration
 * 
 * Receives MIDI input from external controllers or DAW via Web MIDI API.
 * Outputs gate, note, velocity, and CC signals for driving synth nodes.
 *
 * Usage:
 *   import { createMidiInput, requestMidiAccess } from './MidiInputNode.js';
 *   await requestMidiAccess();
 *   const midi = createMidiInput({ channel: 0 });
 *   midi.onNoteOn = (note, velocity) => synth.noteOn(note, velocity);
 */

// ============================================================================
// MIDI ACCESS
// ============================================================================

let midiAccess = null;
let midiInputs = [];

/**
 * Request MIDI access from the browser.
 * @returns {Promise<boolean>} True if access granted
 */
export async function requestMidiAccess() {
  if (midiAccess) return true;

  if (!navigator.requestMIDIAccess) {
    console.warn('[MidiInput] Web MIDI API not supported');
    return false;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    _updateInputList();

    midiAccess.onstatechange = () => {
      _updateInputList();
    };

    console.log(`[MidiInput] MIDI access granted, ${midiInputs.length} inputs found`);
    return true;
  } catch (err) {
    console.error('[MidiInput] MIDI access denied:', err);
    return false;
  }
}

function _updateInputList() {
  midiInputs = [];
  if (midiAccess) {
    for (const input of midiAccess.inputs.values()) {
      midiInputs.push({
        id: input.id,
        name: input.name,
        manufacturer: input.manufacturer,
        input,
      });
    }
  }
}

/**
 * Get list of available MIDI inputs.
 * @returns {Array<{id: string, name: string, manufacturer: string}>}
 */
export function getMidiInputs() {
  return midiInputs.map(({ id, name, manufacturer }) => ({ id, name, manufacturer }));
}

// ============================================================================
// MIDI INPUT NODE
// ============================================================================

/**
 * Create a MIDI input node that processes incoming MIDI messages.
 * @param {Object} config
 * @param {number} config.channel - MIDI channel (0-15, or -1 for omni)
 * @param {number} config.ccNumber - CC number to track
 * @param {number} config.transpose - Note transpose amount
 * @param {string} config.velocityCurve - Velocity response curve
 * @returns {Object} MIDI input instance
 */
export function createMidiInput(config = {}) {
  const channel = config.channel ?? -1; // -1 = omni
  const ccNumber = config.ccNumber ?? 1;
  const transpose = config.transpose ?? 0;
  const velocityCurve = config.velocityCurve ?? 'linear';

  // State
  let currentNote = -1;
  let currentVelocity = 0;
  let currentGate = false;
  let ccValue = 0;
  let connectedInput = null;

  // Held notes for polyphonic tracking
  const heldNotes = new Map();

  const instance = {
    config: { channel, ccNumber, transpose, velocityCurve },

    // Callbacks
    onNoteOn: null,    // (note, velocity) => void
    onNoteOff: null,   // (note) => void
    onCC: null,        // (ccNum, value) => void
    onPitchBend: null, // (value) => void  // -1 to 1
    onModWheel: null,  // (value) => void  // 0 to 1

    // Current state getters
    get gate() { return currentGate; },
    get note() { return currentNote; },
    get velocity() { return currentVelocity; },
    get cc() { return ccValue; },

    /**
     * Connect to a specific MIDI input by ID.
     * @param {string} inputId
     */
    connect(inputId) {
      this.disconnect();

      const found = midiInputs.find(i => i.id === inputId);
      if (!found) {
        console.warn(`[MidiInput] Input not found: ${inputId}`);
        return false;
      }

      connectedInput = found.input;
      connectedInput.onmidimessage = (e) => _handleMidiMessage(instance, e);
      console.log(`[MidiInput] Connected to: ${found.name}`);
      return true;
    },

    /**
     * Connect to the first available MIDI input.
     */
    connectFirst() {
      if (midiInputs.length === 0) return false;
      return this.connect(midiInputs[0].id);
    },

    /**
     * Disconnect from current input.
     */
    disconnect() {
      if (connectedInput) {
        connectedInput.onmidimessage = null;
        connectedInput = null;
      }
    },

    /**
     * Simulate a note on (for testing without MIDI hardware).
     */
    simulateNoteOn(note, velocity = 0.8) {
      _processNoteOn(instance, note, velocity);
    },

    /**
     * Simulate a note off.
     */
    simulateNoteOff(note) {
      _processNoteOff(instance, note);
    },

    /**
     * Get all currently held notes.
     * @returns {Array<{note: number, velocity: number}>}
     */
    getHeldNotes() {
      return Array.from(heldNotes.entries()).map(([note, velocity]) => ({ note, velocity }));
    },

    destroy() {
      this.disconnect();
      heldNotes.clear();
    },
  };

  // Internal state setters
  instance._setGate = (g) => { currentGate = g; };
  instance._setNote = (n) => { currentNote = n; };
  instance._setVelocity = (v) => { currentVelocity = v; };
  instance._setCC = (v) => { ccValue = v; };
  instance._heldNotes = heldNotes;

  return instance;
}

// ============================================================================
// MIDI MESSAGE HANDLING
// ============================================================================

function _handleMidiMessage(instance, event) {
  const data = event.data;
  if (!data || data.length < 2) return;

  const status = data[0];
  const msgChannel = status & 0x0F;
  const msgType = status & 0xF0;

  // Channel filter
  if (instance.config.channel >= 0 && msgChannel !== instance.config.channel) {
    return;
  }

  switch (msgType) {
    case 0x90: // Note On
      if (data[2] > 0) {
        _processNoteOn(instance, data[1], data[2] / 127);
      } else {
        _processNoteOff(instance, data[1]);
      }
      break;

    case 0x80: // Note Off
      _processNoteOff(instance, data[1]);
      break;

    case 0xB0: // Control Change
      _processCC(instance, data[1], data[2] / 127);
      break;

    case 0xE0: // Pitch Bend
      const bend = ((data[2] << 7) | data[1]) - 8192;
      const normalizedBend = bend / 8192; // -1 to 1
      if (instance.onPitchBend) {
        instance.onPitchBend(normalizedBend);
      }
      break;
  }
}

function _processNoteOn(instance, rawNote, velocity) {
  const note = rawNote + instance.config.transpose;
  const scaledVelocity = _applyVelocityCurve(velocity, instance.config.velocityCurve);

  instance._heldNotes.set(note, scaledVelocity);
  instance._setNote(note);
  instance._setVelocity(scaledVelocity);
  instance._setGate(true);

  if (instance.onNoteOn) {
    instance.onNoteOn(note, scaledVelocity);
  }
}

function _processNoteOff(instance, rawNote) {
  const note = rawNote + instance.config.transpose;

  instance._heldNotes.delete(note);

  // If this was the current note, find next held note or close gate
  if (note === instance.note) {
    if (instance._heldNotes.size > 0) {
      // Get most recent held note
      const entries = Array.from(instance._heldNotes.entries());
      const [nextNote, nextVel] = entries[entries.length - 1];
      instance._setNote(nextNote);
      instance._setVelocity(nextVel);
    } else {
      instance._setGate(false);
    }
  }

  if (instance.onNoteOff) {
    instance.onNoteOff(note);
  }
}

function _processCC(instance, ccNum, value) {
  // Track the configured CC number
  if (ccNum === instance.config.ccNumber) {
    instance._setCC(value);
  }

  // Mod wheel (CC 1)
  if (ccNum === 1 && instance.onModWheel) {
    instance.onModWheel(value);
  }

  // Generic CC callback
  if (instance.onCC) {
    instance.onCC(ccNum, value);
  }
}

function _applyVelocityCurve(velocity, curve) {
  switch (curve) {
    case 'soft':
      return Math.sqrt(velocity);
    case 'hard':
      return velocity * velocity;
    case 'fixed':
      return 1.0;
    case 'linear':
    default:
      return velocity;
  }
}

// ============================================================================
// MIDI CC MAP NODE
// ============================================================================

/**
 * Create a CC mapper that scales CC values to a target range.
 * @param {Object} config
 * @returns {Object}
 */
export function createMidiCCMap(config = {}) {
  const ccNumber = config.ccNumber ?? 1;
  const min = config.min ?? 0;
  const max = config.max ?? 1;
  const curve = config.curve ?? 'linear';

  let currentValue = min;

  return {
    config: { ccNumber, min, max, curve },

    get value() { return currentValue; },

    /**
     * Process incoming CC value (0-1).
     * @param {number} ccNum
     * @param {number} rawValue - 0-1 normalized value
     * @returns {number|null} Mapped value if this CC, null otherwise
     */
    process(ccNum, rawValue) {
      if (ccNum !== ccNumber) return null;

      let scaled = rawValue;

      // Apply curve
      switch (curve) {
        case 'exponential':
          scaled = rawValue * rawValue;
          break;
        case 'logarithmic':
          scaled = Math.sqrt(rawValue);
          break;
        case 'scurve':
          scaled = rawValue < 0.5
            ? 2 * rawValue * rawValue
            : 1 - 2 * (1 - rawValue) * (1 - rawValue);
          break;
      }

      // Map to range
      currentValue = min + scaled * (max - min);
      return currentValue;
    },
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export const VELOCITY_CURVES = ['linear', 'soft', 'hard', 'fixed'];
export const CC_CURVES = ['linear', 'exponential', 'logarithmic', 'scurve'];
