// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AudioBus.js - Audio Category Bus
 * 
 * A bus is a GainNode chain representing an audio category (sfx, music, ambient, voice, ui).
 * Supports volume, mute, solo, and ducking (automatic volume reduction when another bus plays).
 */

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create an audio bus.
 * @param {AudioContext} context
 * @param {AudioNode} destination - Parent node to connect to (usually masterGain)
 * @param {Object} config
 * @param {number} config.volume - Initial volume 0-1 (default 1.0)
 * @returns {Object} Bus instance
 */
export function createAudioBus(context, destination, config = {}) {
  if (!context || !destination) return null;

  const gainNode = context.createGain();
  gainNode.gain.value = config.volume ?? 1.0;
  gainNode.connect(destination);

  return {
    gainNode,
    context,
    destination,
    volume: config.volume ?? 1.0,
    muted: false,
    solo: false,
    duckAmount: 0, // 0 = no ducking, 1 = fully ducked
    _preMuteVolume: config.volume ?? 1.0,
  };
}

// ============================================================================
// CONTROLS
// ============================================================================

/**
 * Set bus volume.
 * @param {Object} bus
 * @param {number} volume - 0 to 1
 * @param {number} currentTime - AudioContext.currentTime
 */
export function setBusVolume(bus, volume, currentTime) {
  if (!bus) return;
  bus.volume = Math.max(0, Math.min(1, volume));
  if (!bus.muted) {
    const effective = bus.volume * (1 - bus.duckAmount);
    bus.gainNode.gain.setTargetAtTime(effective, currentTime || 0, 0.02);
  }
}

/**
 * Mute/unmute the bus.
 * @param {Object} bus
 * @param {boolean} muted
 */
export function setBusMute(bus, muted) {
  if (!bus) return;
  bus.muted = muted;
  if (muted) {
    bus._preMuteVolume = bus.volume;
    bus.gainNode.gain.setTargetAtTime(0, bus.context.currentTime, 0.02);
  } else {
    const effective = bus.volume * (1 - bus.duckAmount);
    bus.gainNode.gain.setTargetAtTime(effective, bus.context.currentTime, 0.02);
  }
}

/**
 * Set duck amount (used for automatic ducking, e.g. voice ducks music).
 * @param {Object} bus
 * @param {number} amount - 0 (no duck) to 1 (fully ducked)
 */
export function setBusDuck(bus, amount) {
  if (!bus || bus.muted) return;
  bus.duckAmount = Math.max(0, Math.min(1, amount));
  const effective = bus.volume * (1 - bus.duckAmount);
  bus.gainNode.gain.setTargetAtTime(effective, bus.context.currentTime, 0.05);
}

/**
 * Get the bus's output node (for sources to connect to).
 * @param {Object} bus
 * @returns {GainNode|null}
 */
export function getBusOutput(bus) {
  return bus ? bus.gainNode : null;
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy a bus and disconnect it.
 * @param {Object} bus
 */
export function destroyAudioBus(bus) {
  if (!bus) return;
  try {
    bus.gainNode.disconnect();
  } catch (_) { /* ignore */ }
  bus.gainNode = null;
  bus.context = null;
  bus.destination = null;
}
