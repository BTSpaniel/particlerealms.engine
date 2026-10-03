// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/audio/index.js — Top-level barrel export for the complete audio system.
 * 
 * Exports: Core engine, Spatial pipeline, Bridges, Synth kernel, Sound atoms, Physics models.
 */

// Core Audio Engine (Phase 1 + 2)
export * from './core/index.js';

// Audio Bridges (Phase 3)
export * from './bridge/index.js';

// Procedural Synthesis Engine (Phase 4)
export * from './synth/index.js';

// Shared Parameter Buffer (Phase 6-7)
export {
  PARAM_LAYOUT,
  PARAMS_PER_EMITTER,
  MAX_EMITTERS,
  TOTAL_FLOAT_COUNT,
  createSharedParamBuffer,
  writeEmitterStats,
  clearAllEmitterStats,
  clearEmitterStats,
  readEmitterParam,
} from './synth/SharedParamBuffer.js';

// Sound Atoms (Phase 5)
export { createCrackleAtomPatch } from './synth/nodes/atoms/CrackleAtom.js';
export { createWhooshAtomPatch } from './synth/nodes/atoms/WhooshAtom.js';
export { createDropAtomPatch } from './synth/nodes/atoms/DropAtom.js';
export { createHissAtomPatch } from './synth/nodes/atoms/HissAtom.js';
export { createRumbleAtomPatch } from './synth/nodes/atoms/RumbleAtom.js';

// Physics Models (Phase 6)
export { createModalImpactPatch, getModalPreset, getModalMaterials } from './synth/nodes/physics/ModalImpactModel.js';
export { createCombustionPatch } from './synth/nodes/physics/CombustionModel.js';
export { createFluidPatch } from './synth/nodes/physics/FluidModel.js';
export { createWindPatch } from './synth/nodes/physics/WindModel.js';
export { createWeatherPatch } from './synth/nodes/physics/WeatherModel.js';
