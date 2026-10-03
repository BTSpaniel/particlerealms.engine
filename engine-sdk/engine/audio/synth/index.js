// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/audio/synth/index.js — Barrel export for procedural synthesis engine.
 */
export {
  registerNodeType,
  getNodeTypes,
  compilePatch,
  validatePatch,
} from './PatchCompiler.js';

export {
  createSynthManager,
  initSynthManager,
  registerPatch,
  getPatch,
  createPatchInstance,
  setInstanceParam,
  setInstanceVolume,
  destroyPatchInstance,
  destroyAllInstances,
  destroySynthManager,
} from './SynthManager.js';

// SFX Generator (sfxr-style parametric sound effects)
export {
  createSfxParams,
  randomizePreset,
  randomizeFull,
  mutateSfx,
  getPresetNames,
  renderSfx,
  playSfx,
  renderAndPlay,
  encodeSfxParams,
  decodeSfxParams,
} from './SfxGenerator.js';

// Sound Blender (multi-layer mixing)
export {
  createBlendPreset,
  addLayer,
  removeLayer,
  playBlend,
  renderBlend,
  generateVariations as generateBlendVariations,
} from './SoundBlender.js';

// Variation Generator & Sound Palette
export {
  createVariationConfig,
  createVariationConfigFromSchema,
  generateVariations,
  generateOneVariation,
  renderVariationBatch,
  renderVariationBatchAsync,
  lockParam,
  unlockParam,
  setRange,
  setLimits,
  createSoundPalette,
  addToPalette,
  removeFromPalette,
  searchPalette,
  savePalette,
  loadPalette,
  exportPalette,
  importPalette,
} from './VariationGenerator.js';

// Sound Schemas (JSON definitions for all sound types)
export {
  SFX_SCHEMA,
  FM_SCHEMA,
  KARPLUS_SCHEMA,
  GRANULAR_SCHEMA,
  FORMANT_SCHEMA,
  BLEND_SCHEMA,
  BLEND_LAYER_SCHEMA,
  SOUND_SCHEMAS,
  getSchema,
  getSchemaNames,
  validateParams,
  defaultsFromSchema,
  variationRangesFromSchema,
  getParamGroups,
} from './SoundSchema.js';

// Granular Synthesis
export {
  createGranularEngine,
  startGranular,
  stopGranular,
  setGranularParam,
  setGranularBuffer,
  connectGranular,
  destroyGranular,
  createGranularPatch,
} from './nodes/GranularNode.js';

// Karplus-Strong Plucked String
export {
  renderKarplusStrong,
  playKarplusStrong,
  createKarplusStrongPatch,
} from './nodes/KarplusStrongNode.js';

// FM Synthesis
export {
  FM_PRESETS,
  renderFM,
  renderFM4,
  playFM,
  getFMPresetNames,
  createFMPatch,
} from './nodes/FMOperatorNode.js';

// Procedural Patches (real-time Web Audio patches for particle/substance audio)
export {
  IMPACT_PATCHES,
  AMBIENT_PATCHES,
  getImpactPatch,
  getAmbientPatch,
  impact_fluid,
  impact_drop,
  impact_hiss,
  impact_crackle,
  impact_metal,
  impact_glass,
  impact_stone,
  impact_wood,
  impact_ice,
  impact_combustion,
  impact_sand,
  impact_electric,
  ambient_combustion,
  ambient_fluid,
  ambient_electric,
  ambient_wind,
} from './ProceduralPatches.js';

// Formant Filter (vocal/creature sounds)
export {
  FORMANT_PRESETS,
  createFormantFilter,
  setFormantVowel,
  setFormantFrequencies,
  morphFormants,
  setFormantMorphTime,
  destroyFormantFilter,
  getFormantPresetNames,
  createFormantPatch,
} from './nodes/FormantFilterNode.js';

// Web Audio Node Factory (unified main-thread node creation)
export {
  createWebAudioNode,
  buildVoice,
  normalizeWaveShape,
} from './WebAudioNodeFactory.js';

// Waveguide Synthesis
export {
  renderWaveguide,
  createWaveguide,
  WAVEGUIDE_TERMINATIONS,
  WAVEGUIDE_MODE_OPTIONS,
} from './nodes/WaveguideNode.js';

// Modal Bank Synthesis
export {
  createModalBank,
  calculateModeFrequencies,
  calculateModeAmplitudes,
  calculateModeDecays,
  MODAL_MATERIALS,
  MATERIAL_OPTIONS,
} from './nodes/ModalBankNode.js';

// Noise Generator
export {
  createNoiseBuffer,
  createNoiseSource,
  createStereoNoiseSource,
  NOISE_COLOR_OPTIONS,
} from './nodes/NoiseGeneratorNode.js';
