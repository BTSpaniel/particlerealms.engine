// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FluidAudioBridge.js - Fluid Events → Audio
 * 
 * Hooks into fluid simulation (splashes, phase changes) and triggers
 * appropriate audio events.
 */

import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// FLUID SOUND MAP
// ============================================================================

const FLUID_SOUNDS = {
  splash_small:  { sound: 'fluid_splash_small',  volume: 0.4, pitch: [0.9, 1.2] },
  splash_medium: { sound: 'fluid_splash_medium', volume: 0.6, pitch: [0.8, 1.1] },
  splash_large:  { sound: 'fluid_splash_large',  volume: 0.9, pitch: [0.7, 1.0] },
  pour:          { sound: 'fluid_pour',           volume: 0.5, pitch: [0.9, 1.1] },
  drip:          { sound: 'fluid_drip',           volume: 0.3, pitch: [0.8, 1.3] },
  freeze:        { sound: 'fluid_freeze',         volume: 0.5, pitch: [0.9, 1.1] },
  melt:          { sound: 'fluid_melt',           volume: 0.3, pitch: [0.9, 1.1] },
  boil:          { sound: 'fluid_boil',           volume: 0.6, pitch: [0.8, 1.2] },
  crystallize:   { sound: 'fluid_crystallize',    volume: 0.4, pitch: [1.0, 1.3] },
};

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a fluid audio bridge.
 * @param {Object} config
 * @param {number} config.maxEventsPerFrame - (default 4)
 * @param {number} config.cooldown - (default 0.1)
 * @param {number} config.maxDistance - (default 100)
 * @returns {Object}
 */
export function createFluidAudioBridge(config = {}) {
  return {
    maxEventsPerFrame: config.maxEventsPerFrame ?? 4,
    cooldown: config.cooldown ?? 0.1,
    maxDistance: config.maxDistance ?? 100,
    pending: [],
    _lastTriggerTimes: new Map(), // eventType → time
    listenerPos: [0, 0, 0],
  };
}

// ============================================================================
// PROCESS
// ============================================================================

/**
 * Process a fluid splash event.
 * @param {Object} bridge
 * @param {number[]} position - [x,y,z]
 * @param {number} magnitude - Splash intensity (0-1+)
 * @param {number} currentTime
 */
export function processFluidSplash(bridge, position, magnitude, currentTime) {
  if (!bridge || bridge.pending.length >= bridge.maxEventsPerFrame) return;

  const lastTime = bridge._lastTriggerTimes.get('splash') || 0;
  if (currentTime - lastTime < bridge.cooldown) return;

  const distSq = _distSq(position, bridge.listenerPos);
  if (distSq > bridge.maxDistance * bridge.maxDistance) return;

  let snd;
  if (magnitude < 0.3) snd = FLUID_SOUNDS.splash_small;
  else if (magnitude < 0.7) snd = FLUID_SOUNDS.splash_medium;
  else snd = FLUID_SOUNDS.splash_large;

  const pitch = uniformDistribution(snd.pitch[0], snd.pitch[1], Math.random);

  bridge.pending.push({
    eventId: snd.sound,
    position,
    volume: snd.volume * Math.min(magnitude + 0.3, 1.5),
    pitch,
    bus: 'sfx',
    priority: 0,
  });

  bridge._lastTriggerTimes.set('splash', currentTime);
}

/**
 * Process a phase change event.
 * @param {Object} bridge
 * @param {string} phaseType - 'freeze'|'melt'|'boil'|'crystallize'
 * @param {number[]} position - [x,y,z]
 * @param {number} magnitude - Intensity
 * @param {number} currentTime
 */
export function processPhaseChangeAudio(bridge, phaseType, position, magnitude, currentTime) {
  if (!bridge || bridge.pending.length >= bridge.maxEventsPerFrame) return;

  const lastTime = bridge._lastTriggerTimes.get(phaseType) || 0;
  if (currentTime - lastTime < bridge.cooldown * 2) return;

  const distSq = _distSq(position, bridge.listenerPos);
  if (distSq > bridge.maxDistance * bridge.maxDistance) return;

  const snd = FLUID_SOUNDS[phaseType] || FLUID_SOUNDS.freeze;
  const pitch = uniformDistribution(snd.pitch[0], snd.pitch[1], Math.random);

  bridge.pending.push({
    eventId: snd.sound,
    position,
    volume: snd.volume * Math.min(magnitude + 0.2, 1.2),
    pitch,
    bus: 'sfx',
    priority: 0,
  });

  bridge._lastTriggerTimes.set(phaseType, currentTime);
}

/**
 * Flush pending fluid audio events.
 * @param {Object} bridge
 * @returns {Object[]}
 */
export function flushFluidAudio(bridge) {
  if (!bridge) return [];
  return bridge.pending.splice(0);
}

/**
 * Update listener position.
 * @param {Object} bridge
 * @param {number[]} pos
 */
export function setFluidAudioListenerPos(bridge, pos) {
  if (!bridge || !pos) return;
  bridge.listenerPos[0] = pos[0];
  bridge.listenerPos[1] = pos[1];
  bridge.listenerPos[2] = pos[2];
}

// ============================================================================
// DESTROY
// ============================================================================

export function destroyFluidAudioBridge(bridge) {
  if (!bridge) return;
  bridge.pending.length = 0;
  bridge._lastTriggerTimes.clear();
}

// ============================================================================
// INTERNAL
// ============================================================================

function _distSq(a, b) {
  if (!a || !b) return Infinity;
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
