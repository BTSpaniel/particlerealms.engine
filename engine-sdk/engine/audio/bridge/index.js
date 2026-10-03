// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/audio/bridge/index.js — Barrel export for audio bridges.
 */
export {
  resolveSubstanceAudio,
  getSubstanceImpactSound,
  getSubstanceAmbientLoop,
  getSubstanceCollisionSound,
  getSubstanceProceduralPatch,
  getSubstanceParamMap,
  buildSubstanceTriggerConfig,
} from './SubstanceAudioResolver.js';

export {
  createPhysicsAudioBridge,
  processPhysicsContact,
  flushPhysicsAudio,
  setPhysicsAudioListenerPos,
  destroyPhysicsAudioBridge,
} from './PhysicsAudioBridge.js';

export {
  createSpellAudioBridge,
  buildSpellAudioTrigger,
  buildSoundHintTrigger,
  destroySpellAudioBridge,
} from './SpellAudioBridge.js';

export {
  createWeatherAudioBridge,
  tickWeatherAudio,
  destroyWeatherAudioBridge,
} from './WeatherAudioBridge.js';

export {
  createDestructionAudioBridge,
  processDamageAudioEvent,
  processFractureAudioEvent,
  processSeismicAudioEvent,
  flushDestructionAudio,
  setDestructionAudioListenerPos,
  destroyDestructionAudioBridge,
} from './DestructionAudioBridge.js';

export {
  createFluidAudioBridge,
  processFluidSplash,
  processPhaseChangeAudio,
  flushFluidAudio,
  setFluidAudioListenerPos,
  destroyFluidAudioBridge,
} from './FluidAudioBridge.js';

export {
  createEmitterAmbientBridge,
  syncEmitterAmbients,
  registerEmitterLoop,
  stopAllEmitterAmbients,
  destroyEmitterAmbientBridge,
} from './EmitterAmbientBridge.js';

export {
  createCharacterAudioBridge,
  tickCharacterAudio,
  removeCharacter,
  destroyCharacterAudioBridge,
} from './CharacterAudioBridge.js';
