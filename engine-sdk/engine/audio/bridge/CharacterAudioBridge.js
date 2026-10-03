// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CharacterAudioBridge.js - Character Movement → Audio Events
 * 
 * Triggers footsteps, jumps, lands, and body foley based on character
 * movement state (velocity, grounded, etc).
 */

import { resolveFootstepMaterial } from '../core/FootstepMaterials.js';
import { playSound } from '../core/AudioEngine.js';
import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a character movement audio bridge.
 * @param {Object} config
 * @param {number} config.footstepCadence - Seconds between footsteps when walking (default 0.45)
 * @param {number} config.runCadenceMultiplier - Run cadence = walk cadence × this (default 0.65)
 * @param {number} config.minStepSpeed - Min m/s horizontal speed to trigger footsteps (default 0.8)
 * @param {number} config.minLandSpeed - Min m/s vertical speed to trigger land sound (default 2.0)
 * @param {number} config.runSpeedThreshold - m/s speed to consider "running" (default 3.5)
 * @param {number} config.maxDistance - Max distance from listener to play sounds (default 50)
 * @returns {Object}
 */
export function createCharacterAudioBridge(config = {}) {
  return {
    footstepCadence: config.footstepCadence ?? 0.45,
    runCadenceMultiplier: config.runCadenceMultiplier ?? 0.65,
    minStepSpeed: config.minStepSpeed ?? 0.8,
    minLandSpeed: config.minLandSpeed ?? 2.0,
    runSpeedThreshold: config.runSpeedThreshold ?? 3.5,
    maxDistance: config.maxDistance ?? 50,
    
    // Per-character state tracking
    characters: new Map(), // entityId → { lastStepTime, wasGrounded, lastPosition, ... }
  };
}

// ============================================================================
// TICK
// ============================================================================

/**
 * Tick the character audio bridge for a single character.
 * Call once per frame per character entity.
 * 
 * @param {Object} bridge - CharacterAudioBridge instance
 * @param {Object} audioEngine - AudioEngine instance
 * @param {string|number} entityId - Unique character entity ID
 * @param {Object} state - Character state
 * @param {number[]} state.position - [x, y, z] world position
 * @param {number[]} state.velocity - [x, y, z] velocity in m/s
 * @param {boolean} state.grounded - Is character on ground
 * @param {number|string|null} state.groundMaterial - Ground material ID or string
 * @param {number} state.weight - Entity weight multiplier (default 1.0)
 * @param {number} dt - Delta time in seconds
 */
export function tickCharacterAudio(bridge, audioEngine, entityId, state, dt) {
  if (!bridge || !audioEngine || !state) return;
  
  // Get or create character state
  let charState = bridge.characters.get(entityId);
  if (!charState) {
    charState = {
      lastStepTime: 0,
      wasGrounded: false,
      lastPosition: state.position ? [...state.position] : [0, 0, 0],
      isSliding: false,
    };
    bridge.characters.set(entityId, charState);
  }
  
  // Distance culling
  const listenerPos = audioEngine.listener?.position || [0, 0, 0];
  const dx = state.position[0] - listenerPos[0];
  const dy = state.position[1] - listenerPos[1];
  const dz = state.position[2] - listenerPos[2];
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq > bridge.maxDistance * bridge.maxDistance) {
    charState.wasGrounded = state.grounded;
    return;
  }
  
  // Calculate horizontal speed
  const horizSpeed = Math.sqrt(state.velocity[0] ** 2 + state.velocity[2] ** 2);
  const isRunning = horizSpeed >= bridge.runSpeedThreshold;
  
  // --- FOOTSTEP TRIGGERING ---
  if (state.grounded && horizSpeed >= bridge.minStepSpeed) {
    const cadence = bridge.footstepCadence * (isRunning ? bridge.runCadenceMultiplier : 1.0);
    const elapsed = audioEngine.time - charState.lastStepTime;
    
    if (elapsed >= cadence) {
      _triggerFootstep(bridge, audioEngine, entityId, state, isRunning);
      charState.lastStepTime = audioEngine.time;
    }
  }
  
  // --- LAND DETECTION (grounded transition) ---
  if (state.grounded && !charState.wasGrounded) {
    const landSpeed = Math.abs(state.velocity[1]); // Vertical speed
    if (landSpeed >= bridge.minLandSpeed) {
      _triggerLand(bridge, audioEngine, entityId, state, landSpeed);
    }
  }
  
  // --- JUMP DETECTION (!grounded transition with upward velocity) ---
  if (!state.grounded && charState.wasGrounded && state.velocity[1] > 1.5) {
    _triggerJump(bridge, audioEngine, entityId, state);
  }
  
  // Update state
  charState.wasGrounded = state.grounded;
  if (state.position) {
    charState.lastPosition = [...state.position];
  }
}

/**
 * Clean up character state when entity is destroyed.
 * @param {Object} bridge
 * @param {string|number} entityId
 */
export function removeCharacter(bridge, entityId) {
  if (!bridge) return;
  bridge.characters.delete(entityId);
}

/**
 * Destroy the character audio bridge and clean up all state.
 * @param {Object} bridge
 */
export function destroyCharacterAudioBridge(bridge) {
  if (!bridge) return;
  bridge.characters.clear();
}

// ============================================================================
// INTERNAL TRIGGERS
// ============================================================================

function _triggerFootstep(bridge, audioEngine, entityId, state, isRunning) {
  const material = resolveFootstepMaterial(state.groundMaterial);
  const eventId = `footstep_${material}`;
  
  playSound(audioEngine, eventId, {
    position: state.position,
    volume: 0.5 + (isRunning ? 0.2 : 0),
    pitch: uniformDistribution(0.95, 1.05, Math.random),
    speed: isRunning ? 1.5 : 0.7,
    weight: state.weight ?? 1.0,
    bus: 'sfx',
  });
}

function _triggerLand(bridge, audioEngine, entityId, state, landSpeed) {
  const material = resolveFootstepMaterial(state.groundMaterial);
  const eventId = `land_${material}`;
  
  // Scale volume/weight by land speed (harder landing = louder)
  const speedFactor = Math.min(landSpeed / 8.0, 1.5); // Cap at 1.5x
  
  playSound(audioEngine, eventId, {
    position: state.position,
    volume: 0.6 * speedFactor,
    pitch: uniformDistribution(0.9, 1.0, Math.random),
    weight: (state.weight ?? 1.0) * (1.0 + speedFactor * 0.5),
    material,
    bus: 'sfx',
  });
}

function _triggerJump(bridge, audioEngine, entityId, state) {
  // Jump effort sound (body foley)
  playSound(audioEngine, 'jump', {
    position: state.position,
    volume: 0.35,
    pitch: uniformDistribution(0.95, 1.05, Math.random),
    bus: 'sfx',
  });
}
