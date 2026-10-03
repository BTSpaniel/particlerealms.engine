// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/audio/core/index.js — Barrel export for core audio engine.
 */
export {
  createAudioEngine,
  initAudioEngine,
  resumeAudioEngine,
  tickAudioEngine,
  triggerAudioEvent,
  playSound,
  playBuffer,
  stopSource,
  stopAllSources,
  registerAudioEvent,
  unregisterAudioEvent,
  setMasterVolume,
  setBusVolumeByName,
  destroyAudioEngine,
} from './AudioEngine.js';

export {
  createAudioListener,
  updateAudioListener,
  getListenerPosition,
  getListenerVelocity,
  destroyAudioListener,
} from './AudioListener.js';

export {
  createAudioBus,
  setBusVolume,
  setBusMute,
  setBusDuck,
  getBusOutput,
  destroyAudioBus,
} from './AudioBus.js';

export {
  createAudioSource,
  tickAudioSource,
  setSourcePosition,
  setSourceVolume,
  setSourcePitch,
  stopAudioSource,
  isSourceDone,
  getSourceEffectiveVolume,
  destroyAudioSource,
} from './AudioSource.js';

export {
  createAudioAssetManager,
  loadAudioAsset,
  preloadAudioAssets,
  registerAudioBuffer,
  getAudioBuffer,
  hasAudioBuffer,
  unloadAudioAsset,
  clearAudioCache,
  setAudioBaseUrl,
  destroyAudioAssetManager,
} from './AudioAssetManager.js';

export {
  resolveAudioEvent,
  createAudioEventDescriptor,
} from './AudioEvent.js';

export {
  createAudioConcurrency,
  tickConcurrency,
  canAddVoice,
  destroyAudioConcurrency,
} from './AudioConcurrency.js';

export {
  createAudioOcclusion,
  addOccluder,
  removeOccluder,
  clearOccluders,
  tickOcclusion,
  destroyAudioOcclusion,
} from './AudioOcclusion.js';

export {
  REVERB_PRESETS,
  createReverbZoneSystem,
  addReverbZone,
  removeReverbZone,
  tickReverbZones,
  connectSourceToReverb,
  destroyReverbZoneSystem,
} from './AudioReverbZone.js';

export {
  createAudioDoppler,
  tickDoppler,
  destroyAudioDoppler,
} from './AudioDoppler.js';

export {
  registerFootstepEvents,
  unregisterFootstepEvents,
} from './FootstepEvents.js';

export {
  resolveFootstepMaterial,
  getFootstepConfig,
  getAllFootstepMaterials,
  FOOTSTEP_MATERIALS,
  PHYSICS_TO_FOOTSTEP,
  VOXEL_TO_FOOTSTEP,
} from './FootstepMaterials.js';
