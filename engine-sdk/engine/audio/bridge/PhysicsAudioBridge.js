// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PhysicsAudioBridge.js - Physics Collision → Audio Events
 * 
 * Hooks into physics contact callbacks (PhysX/PBD) and triggers
 * material-aware impact sounds via the AudioEngine.
 */

import { buildSubstanceTriggerConfig } from './SubstanceAudioResolver.js';

// ============================================================================
// MATERIAL → SUBSTANCE MAP
// ============================================================================

const MATERIAL_TO_SUBSTANCE = {
  0: null,        // NONE
  1: 'water',
  2: 'fire',
  3: 'smoke',
  4: 'wood',
  5: 'ice',
  6: 'lava',
  7: 'metal',
  8: 'glass',
  9: 'stone',
  10: 'plasma',
  11: 'sparks',
  12: 'debris',
  13: 'steam',
  14: 'oil',
  15: 'wax',
  16: 'mercury',
  17: 'acid',
  18: 'blood',
  19: 'honey',
  20: 'sand',
  21: 'snow',
};

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a physics audio bridge.
 * @param {Object} config
 * @param {number} config.maxEventsPerFrame - Max audio triggers per frame (default 4)
 * @param {number} config.cooldown - Min seconds between triggers for same body pair (default 0.1)
 * @param {number} config.minImpactSpeed - Minimum collision speed to trigger audio (default 2.0)
 * @param {number} config.maxDistance - Max distance from listener (default 100)
 * @returns {Object}
 */
export function createPhysicsAudioBridge(config = {}) {
  return {
    maxEventsPerFrame: config.maxEventsPerFrame ?? 4,
    cooldown: config.cooldown ?? 0.1,
    minImpactSpeed: config.minImpactSpeed ?? 2.0,
    maxDistance: config.maxDistance ?? 100,
    pending: [],
    _lastTriggerTime: new Map(), // pairKey → time
    listenerPos: [0, 0, 0],
  };
}

// ============================================================================
// PROCESS
// ============================================================================

/**
 * Process a physics contact event.
 * @param {Object} bridge
 * @param {Object} contact
 * @param {number[]} contact.position - [x,y,z] contact point
 * @param {number[]} contact.velocity - [x,y,z] relative velocity
 * @param {number} contact.impulse - Impact impulse magnitude
 * @param {number} contact.materialA - Material ID of body A
 * @param {number} contact.materialB - Material ID of body B
 * @param {number} contact.bodyIdA - Body handle A
 * @param {number} contact.bodyIdB - Body handle B
 * @param {number} currentTime - Engine time
 */
export function processPhysicsContact(bridge, contact, currentTime) {
  if (!bridge || !contact) return;
  if (bridge.pending.length >= bridge.maxEventsPerFrame) return;

  const speed = Math.sqrt(
    contact.velocity[0] ** 2 +
    contact.velocity[1] ** 2 +
    contact.velocity[2] ** 2
  );
  if (speed < bridge.minImpactSpeed) return;

  // Distance check
  const dx = contact.position[0] - bridge.listenerPos[0];
  const dy = contact.position[1] - bridge.listenerPos[1];
  const dz = contact.position[2] - bridge.listenerPos[2];
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq > bridge.maxDistance * bridge.maxDistance) return;

  // Cooldown check
  const pairKey = Math.min(contact.bodyIdA, contact.bodyIdB) * 100000 +
                  Math.max(contact.bodyIdA, contact.bodyIdB);
  const lastTime = bridge._lastTriggerTime.get(pairKey) || 0;
  if (currentTime - lastTime < bridge.cooldown) return;

  // Determine substance from material IDs
  const substanceA = MATERIAL_TO_SUBSTANCE[contact.materialA] || 'stone';
  const substanceB = MATERIAL_TO_SUBSTANCE[contact.materialB] || 'stone';

  // Use the harder/louder material for the impact sound
  const substance = _pickImpactSubstance(substanceA, substanceB);

  const volumeScale = Math.min(speed / 20, 1.5);
  const triggerConfig = buildSubstanceTriggerConfig(substance, 'impact', {
    position: contact.position,
    velocity: contact.velocity,
    volume: volumeScale,
  });

  if (triggerConfig) {
    bridge.pending.push(triggerConfig);
    bridge._lastTriggerTime.set(pairKey, currentTime);
  }
}

/**
 * Flush pending physics audio events.
 * @param {Object} bridge
 * @returns {Object[]} Array of trigger configs
 */
export function flushPhysicsAudio(bridge) {
  if (!bridge) return [];
  return bridge.pending.splice(0);
}

/**
 * Update listener position.
 * @param {Object} bridge
 * @param {number[]} pos
 */
export function setPhysicsAudioListenerPos(bridge, pos) {
  if (!bridge || !pos) return;
  bridge.listenerPos[0] = pos[0];
  bridge.listenerPos[1] = pos[1];
  bridge.listenerPos[2] = pos[2];
}

// ============================================================================
// DESTROY
// ============================================================================

export function destroyPhysicsAudioBridge(bridge) {
  if (!bridge) return;
  bridge.pending.length = 0;
  bridge._lastTriggerTime.clear();
}

// ============================================================================
// INTERNAL
// ============================================================================

const HARDNESS = {
  metal: 5, stone: 4, glass: 4, ice: 3, wood: 2,
  debris: 2, sand: 1, snow: 0, wax: 0,
};

function _pickImpactSubstance(a, b) {
  const ha = HARDNESS[a] ?? 1;
  const hb = HARDNESS[b] ?? 1;
  return ha >= hb ? a : b;
}
