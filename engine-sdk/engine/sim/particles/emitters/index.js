// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * emitters/index.js — Organized re-exports for emitter creation, presets, and lifecycle.
 * New code should import from here. Original files remain in parent directory.
 */

export {
  SUBSTANCE_PRESETS, EMITTER_PRESETS, EMITTER_TYPES, STATES,
  resolveSubstance, deriveState, derivePhysicsProfile,
  getStates, getEmitterTypes, getEmitterPreset,
  applyPreset, createEmitter, destroyEmitter,
  syncWorldSystemsToEmitters,
  hasLiquidEmitters,
} from '../ParticleEmitterSystem.js';

export { default as EmitterLOD } from '../ParticleEmitterLOD.js';
export * from '../ParticleSpawnShapes.js';
export * from '../ParticleEventSpawn.js';
export * from '../ParticleFxApi.js';
