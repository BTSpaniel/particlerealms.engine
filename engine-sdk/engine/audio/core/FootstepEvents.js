// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FootstepEvents.js - Footstep Audio Event Registration
 * 
 * Registers all footstep and land audio events with the AudioEngine.
 * Called during engine initialization.
 */

import { registerAudioEvent } from './AudioEngine.js';
import { createAudioEventDescriptor } from './AudioEvent.js';
import { FOOTSTEP_MATERIALS } from './FootstepMaterials.js';

// ============================================================================
// EVENT REGISTRATION
// ============================================================================

/**
 * Register all footstep audio events with the AudioEngine.
 * Should be called once during engine initialization.
 * 
 * @param {Object} audioEngine - AudioEngine instance
 */
export function registerFootstepEvents(audioEngine) {
  if (!audioEngine) return;
  
  // Register footstep events for each material
  for (const [materialKey, config] of Object.entries(FOOTSTEP_MATERIALS)) {
    const eventId = `footstep_${materialKey}`;
    
    const descriptor = createAudioEventDescriptor({
      type: 'oneshot',
      sounds: [], // No samples, uses procedural patch
      proceduralPatch: config.patch,
      volume: [0.9, 1.1],
      pitch: [0.95, 1.05],
      bus: 'sfx',
      priority: 1,
      maxInstances: 8, // Max 8 simultaneous footsteps (4 characters × 2 feet)
      cooldown: 0, // No cooldown (handled by CharacterAudioBridge cadence)
    });
    
    registerAudioEvent(audioEngine, eventId, descriptor);
  }
  
  // Register land events for each material
  for (const materialKey of Object.keys(FOOTSTEP_MATERIALS)) {
    const eventId = `land_${materialKey}`;
    
    const descriptor = createAudioEventDescriptor({
      type: 'oneshot',
      sounds: [],
      proceduralPatch: 'land_generic', // Generic land uses footstep patches with heavier params
      volume: [0.8, 1.2],
      pitch: [0.9, 1.1],
      bus: 'sfx',
      priority: 2, // Higher priority than footsteps
      maxInstances: 4,
      cooldown: 0.1, // Small cooldown to prevent spam
    });
    
    registerAudioEvent(audioEngine, eventId, descriptor);
  }
  
  // Register jump effort sound (body foley)
  const jumpDescriptor = createAudioEventDescriptor({
    type: 'oneshot',
    sounds: [],
    proceduralPatch: 'body_jump_effort',
    volume: [0.3, 0.4],
    pitch: [0.95, 1.05],
    bus: 'sfx',
    priority: 1,
    maxInstances: 4,
    cooldown: 0.2,
  });
  registerAudioEvent(audioEngine, 'jump', jumpDescriptor);
  
  console.log(`[FootstepEvents] Registered ${Object.keys(FOOTSTEP_MATERIALS).length * 2 + 1} footstep/land/jump events`);
}

/**
 * Unregister all footstep events (for cleanup).
 * @param {Object} audioEngine
 */
export function unregisterFootstepEvents(audioEngine) {
  if (!audioEngine) return;
  
  for (const materialKey of Object.keys(FOOTSTEP_MATERIALS)) {
    audioEngine.events.delete(`footstep_${materialKey}`);
    audioEngine.events.delete(`land_${materialKey}`);
  }
  audioEngine.events.delete('jump');
}
