// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EmitterAmbientBridge.js - Active Emitters → Continuous Ambient Loops
 * 
 * When a substance emitter is active and has an ambientLoop defined,
 * this bridge manages a looping spatial audio source at the emitter position.
 * Sources are created when emitters start and removed when they stop.
 */

import { resolveSubstanceAudio } from './SubstanceAudioResolver.js';

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create an emitter ambient bridge.
 * @param {Object} config
 * @param {number} config.maxAmbients - Max simultaneous ambient loops (default 8)
 * @param {number} config.fadeIn - Fade-in time in seconds (default 0.5)
 * @param {number} config.fadeOut - Fade-out time in seconds (default 1.0)
 * @returns {Object}
 */
export function createEmitterAmbientBridge(config = {}) {
  return {
    maxAmbients: config.maxAmbients ?? 8,
    fadeIn: config.fadeIn ?? 0.5,
    fadeOut: config.fadeOut ?? 1.0,
    activeLoops: new Map(), // emitterId → { sourceId, substanceId, position }
    pending: [],            // Trigger configs to send to AudioEngine
  };
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Sync active emitters with ambient audio loops.
 * Call each frame with the current list of active emitters.
 * @param {Object} bridge
 * @param {Object[]} emitters - Array of active emitter objects
 *   Each: { id, substance, position: [x,y,z], active: bool }
 * @returns {Object[]} Array of actions: { action: 'start'|'stop'|'update', ... }
 */
export function syncEmitterAmbients(bridge, emitters) {
  if (!bridge || !emitters) return [];

  const actions = [];
  const seenIds = new Set();

  for (const emitter of emitters) {
    if (!emitter.active || !emitter.substance) continue;

    seenIds.add(emitter.id);

    const existing = bridge.activeLoops.get(emitter.id);
    if (existing) {
      // Update position if changed
      if (emitter.position) {
        actions.push({
          action: 'update',
          sourceId: existing.sourceId,
          position: emitter.position,
        });
        existing.position = emitter.position;
      }
      continue;
    }

    // Check if this substance has an ambient loop
    const audio = resolveSubstanceAudio(emitter.substance);
    if (!audio || !audio.ambientLoop) continue;

    // Check limit
    if (bridge.activeLoops.size >= bridge.maxAmbients) continue;

    // Queue start
    actions.push({
      action: 'start',
      emitterId: emitter.id,
      eventId: audio.ambientLoop,
      position: emitter.position || [0, 0, 0],
      volume: audio.volume ?? 0.5,
      bus: 'ambient',
      loop: true,
      fadeIn: bridge.fadeIn,
      priority: 1,
      substanceId: emitter.substance,
    });
  }

  // Stop loops for emitters that are no longer active
  for (const [emitterId, loop] of bridge.activeLoops) {
    if (!seenIds.has(emitterId)) {
      actions.push({
        action: 'stop',
        sourceId: loop.sourceId,
        fadeOut: bridge.fadeOut,
      });
      bridge.activeLoops.delete(emitterId);
    }
  }

  return actions;
}

/**
 * Register that a loop was started (store sourceId).
 * @param {Object} bridge
 * @param {number|string} emitterId
 * @param {number} sourceId - AudioEngine source ID
 * @param {string} substanceId
 * @param {number[]} position
 */
export function registerEmitterLoop(bridge, emitterId, sourceId, substanceId, position) {
  if (!bridge) return;
  bridge.activeLoops.set(emitterId, { sourceId, substanceId, position: position ? [...position] : [0, 0, 0] });
}

/**
 * Stop all active ambient loops.
 * @param {Object} bridge
 * @returns {Object[]} Stop actions
 */
export function stopAllEmitterAmbients(bridge) {
  if (!bridge) return [];
  const actions = [];
  for (const [emitterId, loop] of bridge.activeLoops) {
    actions.push({
      action: 'stop',
      sourceId: loop.sourceId,
      fadeOut: bridge.fadeOut,
    });
  }
  bridge.activeLoops.clear();
  return actions;
}

// ============================================================================
// DESTROY
// ============================================================================

export function destroyEmitterAmbientBridge(bridge) {
  if (!bridge) return;
  bridge.activeLoops.clear();
  bridge.pending.length = 0;
}
