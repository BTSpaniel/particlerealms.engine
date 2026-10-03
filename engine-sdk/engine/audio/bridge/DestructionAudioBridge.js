// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DestructionAudioBridge.js - Destruction Events → Audio
 * 
 * Hooks into VoronoiFracture, UnifiedDamageSystem, SeismicSystem,
 * and ShockPropagation to trigger shattering, crumbling, rumble,
 * and explosion sounds.
 */

import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// DAMAGE TYPE → SOUND MAP
// ============================================================================

const DAMAGE_SOUNDS = {
  impact:    { sound: 'destruction_impact',    volume: 0.8, pitch: [0.8, 1.2] },
  explosion: { sound: 'destruction_explosion', volume: 1.0, pitch: [0.7, 1.0] },
  erosion:   { sound: 'destruction_crumble',   volume: 0.4, pitch: [0.9, 1.1] },
  pierce:    { sound: 'destruction_pierce',    volume: 0.6, pitch: [0.9, 1.3] },
  crush:     { sound: 'destruction_crush',     volume: 0.9, pitch: [0.6, 0.9] },
  heat:      { sound: 'destruction_sizzle',    volume: 0.5, pitch: [0.8, 1.2] },
  acid:      { sound: 'destruction_dissolve',  volume: 0.5, pitch: [0.9, 1.1] },
};

const FRACTURE_SOUNDS = {
  glass: { sound: 'fracture_glass_shatter', volume: 0.9, pitch: [0.8, 1.3] },
  stone: { sound: 'fracture_stone_crack',   volume: 0.8, pitch: [0.7, 1.0] },
  wood:  { sound: 'fracture_wood_snap',     volume: 0.7, pitch: [0.8, 1.2] },
  metal: { sound: 'fracture_metal_rend',    volume: 0.9, pitch: [0.6, 1.0] },
  default: { sound: 'fracture_generic',     volume: 0.7, pitch: [0.8, 1.2] },
};

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a destruction audio bridge.
 * @param {Object} config
 * @param {number} config.maxEventsPerFrame - (default 4)
 * @param {number} config.cooldown - Min seconds between same-position triggers (default 0.2)
 * @param {number} config.maxDistance - (default 150)
 * @returns {Object}
 */
export function createDestructionAudioBridge(config = {}) {
  return {
    maxEventsPerFrame: config.maxEventsPerFrame ?? 4,
    cooldown: config.cooldown ?? 0.2,
    maxDistance: config.maxDistance ?? 150,
    pending: [],
    _lastTriggerTime: 0,
    listenerPos: [0, 0, 0],
  };
}

// ============================================================================
// PROCESS
// ============================================================================

/**
 * Process a damage event.
 * @param {Object} bridge
 * @param {Object} event
 * @param {string} event.damageType - 'impact'|'explosion'|'erosion'|'pierce'|'crush'|'heat'|'acid'
 * @param {number[]} event.position - [x,y,z]
 * @param {number} event.magnitude - Damage magnitude (0-100+)
 * @param {string} event.material - Material name hint
 * @param {number} currentTime
 */
export function processDamageAudioEvent(bridge, event, currentTime) {
  if (!bridge || !event || bridge.pending.length >= bridge.maxEventsPerFrame) return;
  if (currentTime - bridge._lastTriggerTime < bridge.cooldown) return;

  const distSq = _distSq(event.position, bridge.listenerPos);
  if (distSq > bridge.maxDistance * bridge.maxDistance) return;

  const snd = DAMAGE_SOUNDS[event.damageType] || DAMAGE_SOUNDS.impact;
  const volumeScale = Math.min((event.magnitude || 10) / 50, 1.5);
  const pitchRange = snd.pitch;
  const pitch = uniformDistribution(pitchRange[0], pitchRange[1], Math.random);

  bridge.pending.push({
    eventId: snd.sound,
    position: event.position,
    volume: snd.volume * volumeScale,
    pitch,
    bus: 'sfx',
    priority: 1,
  });

  bridge._lastTriggerTime = currentTime;
}

/**
 * Process a fracture event (Voronoi fracture).
 * @param {Object} bridge
 * @param {Object} event
 * @param {number[]} event.position
 * @param {string} event.material - 'glass'|'stone'|'wood'|'metal'
 * @param {number} event.fragmentCount - Number of pieces
 * @param {number} currentTime
 */
export function processFractureAudioEvent(bridge, event, currentTime) {
  if (!bridge || !event || bridge.pending.length >= bridge.maxEventsPerFrame) return;
  if (currentTime - bridge._lastTriggerTime < bridge.cooldown) return;

  const distSq = _distSq(event.position, bridge.listenerPos);
  if (distSq > bridge.maxDistance * bridge.maxDistance) return;

  const mat = event.material || 'default';
  const snd = FRACTURE_SOUNDS[mat] || FRACTURE_SOUNDS.default;
  const volumeScale = Math.min((event.fragmentCount || 5) / 20, 1.5);
  const pitchRange = snd.pitch;
  const pitch = uniformDistribution(pitchRange[0], pitchRange[1], Math.random);

  bridge.pending.push({
    eventId: snd.sound,
    position: event.position,
    volume: snd.volume * volumeScale,
    pitch,
    bus: 'sfx',
    priority: 2,
  });

  bridge._lastTriggerTime = currentTime;
}

/**
 * Process a seismic event (earthquake rumble).
 * @param {Object} bridge
 * @param {Object} event
 * @param {number[]} event.position - Epicenter
 * @param {number} event.magnitude - Richter-like scale
 * @param {number} currentTime
 */
export function processSeismicAudioEvent(bridge, event, currentTime) {
  if (!bridge || !event) return;

  const volumeScale = Math.min(event.magnitude / 6, 1.5);

  bridge.pending.push({
    eventId: 'seismic_rumble',
    position: event.position,
    volume: volumeScale,
    pitch: uniformDistribution(0.5, 0.8, Math.random),
    bus: 'sfx',
    priority: 3, // Earthquakes are very important
  });
}

/**
 * Flush pending destruction audio events.
 * @param {Object} bridge
 * @returns {Object[]}
 */
export function flushDestructionAudio(bridge) {
  if (!bridge) return [];
  return bridge.pending.splice(0);
}

/**
 * Update listener position.
 * @param {Object} bridge
 * @param {number[]} pos
 */
export function setDestructionAudioListenerPos(bridge, pos) {
  if (!bridge || !pos) return;
  bridge.listenerPos[0] = pos[0];
  bridge.listenerPos[1] = pos[1];
  bridge.listenerPos[2] = pos[2];
}

// ============================================================================
// DESTROY
// ============================================================================

export function destroyDestructionAudioBridge(bridge) {
  if (!bridge) return;
  bridge.pending.length = 0;
}

// ============================================================================
// INTERNAL
// ============================================================================

function _distSq(a, b) {
  if (!a || !b) return Infinity;
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
