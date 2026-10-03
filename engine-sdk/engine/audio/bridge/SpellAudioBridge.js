// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpellAudioBridge.js - Spell Cast → Audio Events
 * 
 * Resolves soundHint strings from SpellGenerator and SpellElementMixer
 * into AudioEngine trigger calls.
 */

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a spell audio bridge.
 * @param {Object} config
 * @param {number} config.cooldown - Min seconds between spell sounds (default 0.05)
 * @returns {Object}
 */
export function createSpellAudioBridge(config = {}) {
  return {
    cooldown: config.cooldown ?? 0.05,
    _lastTriggerTime: 0,
  };
}

// ============================================================================
// TRIGGER
// ============================================================================

/**
 * Build audio trigger config from a spell cast.
 * @param {Object} bridge
 * @param {Object} spell - Generated spell object (from SpellGenerator)
 * @param {number[]} position - [x,y,z] cast position
 * @param {number} currentTime - Engine time
 * @returns {Object|null} Trigger config for AudioEngine
 */
export function buildSpellAudioTrigger(bridge, spell, position, currentTime) {
  if (!bridge || !spell) return null;

  // Cooldown
  if (currentTime - bridge._lastTriggerTime < bridge.cooldown) return null;

  const soundHint = spell.soundHint;
  if (!soundHint) return null;

  bridge._lastTriggerTime = currentTime;

  return {
    eventId: soundHint,
    position: position || null,
    volume: 0.8,
    pitch: 1.0,
    bus: 'sfx',
    loop: false,
    priority: 2, // Spells are important
  };
}

/**
 * Build audio trigger from a raw soundHint string.
 * @param {Object} bridge
 * @param {string} soundHint
 * @param {number[]} position
 * @param {number} currentTime
 * @returns {Object|null}
 */
export function buildSoundHintTrigger(bridge, soundHint, position, currentTime) {
  if (!bridge || !soundHint) return null;
  if (currentTime - bridge._lastTriggerTime < bridge.cooldown) return null;

  bridge._lastTriggerTime = currentTime;

  return {
    eventId: soundHint,
    position: position || null,
    volume: 0.8,
    pitch: 1.0,
    bus: 'sfx',
    loop: false,
    priority: 2,
  };
}

// ============================================================================
// DESTROY
// ============================================================================

export function destroySpellAudioBridge(bridge) {
  // Plain object — nothing to free
}
