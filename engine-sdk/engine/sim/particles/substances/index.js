// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * substances/index.js — Barrel export for the substance system.
 *
 * Single import point:
 *   import { getSubstance, MATERIAL, PHASE_LIQUID, ... } from './substances/index.js';
 */

// Schema: phase constants, material enum
export {
  PHASE_SOLID, PHASE_LIQUID, PHASE_GAS, PHASE_PLASMA,
  PHASE_NAMES, getPhaseName, getPhaseFromName,
  MATERIAL, getMaterialName, getMaterialId,
} from './SubstanceSchema.js';

// Registry: lookup, derive, resolve
export {
  registerSubstance, unregisterSubstance,
  getSubstance, getSubstanceByMaterialId,
  getAllSubstances, getSubstancesByCategory, getSubstancesByTag, getSubstanceIds,
  resolveSubstance, deriveState, derivePhysicsProfile,
  getSSFRTint, getThermalPreset, getSPHParams, getEmitterDefaults,
  getAudioCues, getReactions, getMaterialForSubstance,
  buildThermalPresets, buildSubstanceToMaterial,
  getSubstanceCount,
} from './SubstanceRegistry.js';

// Elements: periodic table + molecules
export {
  getElement, getElementBySymbol, getAllElements, ELEMENTS,
  ljMixingRule, createElementTable, setParticleElements, setParticleCharges,
  destroyElementTable, ELEMENT_LUT_WGSL,
} from './elements/PeriodicTable.js';

export { MOLECULE_PRESETS } from './elements/MoleculePresets.js';

// Dense cellular sandbox facade: explicit compact cell codes backed by the
// canonical element and substance registries.
export {
  SANDBOX_REFERENCE_TEMPERATURE_K,
  SANDBOX_TEMPERATURE_STEP_K,
  SANDBOX_SPECIES_CAPACITY,
  SANDBOX_SUBSTANCE_CODE_BASE,
  SANDBOX_BEHAVIOR,
  SANDBOX_PHASE,
  SANDBOX_FLAGS,
  SANDBOX_REACTION,
  SANDBOX_INTERACTION,
  SANDBOX_OBJECT,
  SANDBOX_OBJECTS,
  createSandboxMaterialCatalog,
  createSandboxSpeciesLut,
  temperatureToSandboxBucket,
  sandboxBucketToTemperature,
  packSandboxCell,
  unpackSandboxCell,
  packSandboxObject,
  unpackSandboxObject,
  sandboxSpeciesIdForSubstance,
  validateSandboxMaterialCatalog,
} from './SandboxMaterialCatalog.js';

// Mixer: multi-substance blending
export { mixSubstances, deriveFromElements } from './SubstanceMixer.js';

// Materials: auto-register all substance definitions
import './materials/index.js';
