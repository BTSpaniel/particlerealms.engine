// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AudioEvent.js - Audio Event Descriptors
 * 
 * Defines how audio events are resolved: one-shots, random containers,
 * sequences, and loops. An event maps an ID to concrete playback params.
 * 
 * Event descriptor format:
 * {
 *   type: 'oneshot' | 'random' | 'sequence' | 'loop',
 *   sounds: ['path1.ogg', 'path2.ogg'],  // Pool of sounds
 *   volume: [0.8, 1.0],       // Random range or fixed value
 *   pitch: [0.9, 1.1],        // Random range or fixed value
 *   bus: 'sfx',               // Target bus
 *   priority: 0,              // Voice stealing priority
 *   cooldown: 0,              // Min seconds between triggers
 *   maxInstances: 0,          // Max simultaneous (0 = unlimited)
 * }
 */

import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// RESOLVE
// ============================================================================

/**
 * Resolve an audio event descriptor to concrete play parameters.
 * @param {Object|null} event - Registered event descriptor (or null for direct path)
 * @param {string} eventId - The event ID (used as sound path if no descriptor)
 * @param {Object} options - Trigger options (position, volume overrides, etc.)
 * @param {number} time - Current engine time
 * @returns {Object|null} { sound, volume, pitch, loop, priority, bus }
 */
export function resolveAudioEvent(event, eventId, options, time) {
  // No registered event — treat eventId as direct sound path
  if (!event) {
    return {
      sound: eventId,
      volume: options.volume ?? 1.0,
      pitch: options.pitch ?? 1.0,
      loop: options.loop ?? false,
      priority: options.priority ?? 0,
      bus: options.bus || 'sfx',
    };
  }

  // Cooldown check
  if (event.cooldown > 0) {
    const lastTime = event._lastTriggerTime || 0;
    if (time - lastTime < event.cooldown) return null;
  }

  // Max instances check
  if (event.maxInstances > 0 && (event._activeCount || 0) >= event.maxInstances) {
    return null;
  }

  // Select sound
  let sound = null;
  const sounds = event.sounds;

  if (!sounds || sounds.length === 0) return null;

  const type = event.type || 'oneshot';

  switch (type) {
    case 'random':
      sound = sounds[Math.floor(uniformDistribution(0, sounds.length, Math.random))];
      break;

    case 'sequence': {
      const idx = (event._sequenceIndex || 0) % sounds.length;
      sound = sounds[idx];
      event._sequenceIndex = idx + 1;
      break;
    }

    case 'loop':
    case 'oneshot':
    default:
      sound = sounds[0];
      break;
  }

  if (!sound) return null;

  // Resolve volume (can be [min, max] range or fixed number)
  let volume = options.volume ?? _resolveRange(event.volume, 1.0);

  // Resolve pitch
  let pitch = options.pitch ?? _resolveRange(event.pitch, 1.0);

  // Mark trigger time
  event._lastTriggerTime = time;

  return {
    sound,
    volume,
    pitch,
    loop: type === 'loop' || (options.loop ?? false),
    priority: event.priority ?? options.priority ?? 0,
    bus: event.bus || options.bus || 'sfx',
  };
}

/**
 * Create an audio event descriptor.
 * @param {Object} config
 * @returns {Object} Event descriptor
 */
export function createAudioEventDescriptor(config = {}) {
  return {
    type: config.type || 'oneshot',
    sounds: config.sounds || [],
    volume: config.volume ?? 1.0,
    pitch: config.pitch ?? 1.0,
    bus: config.bus || 'sfx',
    priority: config.priority ?? 0,
    cooldown: config.cooldown ?? 0,
    maxInstances: config.maxInstances ?? 0,
    // Internal state
    _lastTriggerTime: 0,
    _sequenceIndex: 0,
    _activeCount: 0,
  };
}

// ============================================================================
// INTERNAL
// ============================================================================

function _resolveRange(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && value.length >= 2) {
    return uniformDistribution(value[0], value[1], Math.random);
  }
  return fallback;
}
