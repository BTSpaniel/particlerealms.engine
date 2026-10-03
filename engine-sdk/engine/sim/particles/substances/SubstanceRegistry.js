// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SubstanceRegistry.js — Central registry for all substance definitions.
 *
 * Provides a unified API to:
 *   - Register/unregister substance definitions
 *   - Look up substances by id, materialId, category, or tag
 *   - Derive physics profiles, phase state, thermal presets, SSFR tint, etc.
 *
 * Each substance is a plain object assembled from per-substance sub-files:
 *   { id, materialId, label, icon, category, tags, chemistry, thermal, physics,
 *     sph, visual, emitter, audio, decals, reactions, spell }
 *
 * Replaces scattered lookups across ParticleEmitterSystem, ParticleConstraints,
 * ParticleReactionTable, EditorParticles, and ParticleElementRegistry.
 */

import {
  PHASE_SOLID, PHASE_LIQUID, PHASE_GAS, PHASE_PLASMA,
  MATERIAL, getMaterialName,
} from './SubstanceSchema.js';

// ============================================================================
// INTERNAL STORAGE
// ============================================================================

/** @type {Map<string, Object>} id → substance definition */
const _byId = new Map();

/** @type {Map<number, Object>} materialId → substance definition */
const _byMaterialId = new Map();

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Register a substance definition. Overwrites if id already exists.
 * @param {Object} def — substance definition (must have `id` and `materialId`)
 */
export function registerSubstance(def) {
  if (!def || !def.id) {
    console.warn('[SubstanceRegistry] Cannot register substance without id');
    return;
  }
  _byId.set(def.id, def);
  if (def.materialId != null) {
    _byMaterialId.set(def.materialId, def);
  }
}

/**
 * Unregister a substance by id.
 * @param {string} id
 */
export function unregisterSubstance(id) {
  const def = _byId.get(id);
  if (def) {
    _byId.delete(id);
    if (def.materialId != null) {
      _byMaterialId.delete(def.materialId);
    }
  }
}

// ============================================================================
// LOOKUPS
// ============================================================================

/**
 * Get substance by id (e.g. 'water', 'lava', 'fire').
 * @param {string} id
 * @returns {Object|null}
 */
export function getSubstance(id) {
  return _byId.get(id) || null;
}

/**
 * Get substance by material ID number.
 * @param {number} matId
 * @returns {Object|null}
 */
export function getSubstanceByMaterialId(matId) {
  return _byMaterialId.get(matId) || null;
}

/**
 * Get all registered substances.
 * @returns {Object[]}
 */
export function getAllSubstances() {
  return Array.from(_byId.values());
}

/**
 * Get substances filtered by category.
 * @param {string} category
 * @returns {Object[]}
 */
export function getSubstancesByCategory(category) {
  const cat = category?.toLowerCase();
  return getAllSubstances().filter(s => s.category?.toLowerCase() === cat);
}

/**
 * Get substances filtered by tag.
 * @param {string} tag
 * @returns {Object[]}
 */
export function getSubstancesByTag(tag) {
  const t = tag?.toLowerCase();
  return getAllSubstances().filter(s => s.tags?.some(st => st.toLowerCase() === t));
}

/**
 * Get substance IDs as an array.
 * @returns {string[]}
 */
export function getSubstanceIds() {
  return Array.from(_byId.keys());
}

// ============================================================================
// DERIVATION — replaces scattered functions
// ============================================================================

/**
 * Resolve a substance key (preset name, element symbol, compound) to a substance definition.
 * Falls back to partial matching.
 * @param {string} key
 * @returns {Object|null}
 */
export function resolveSubstance(key) {
  if (!key) return null;
  const k = key.toLowerCase();
  // Exact match
  if (_byId.has(k)) return _byId.get(k);
  // Try case-insensitive
  for (const [id, def] of _byId) {
    if (id.toLowerCase() === k) return def;
  }
  // Partial match
  for (const [id, def] of _byId) {
    if (k.includes(id) || id.includes(k)) return def;
  }
  return null;
}

/**
 * Derive the phase of matter for a substance at a given temperature.
 * @param {string} substanceId
 * @param {number} temperature — Kelvin
 * @returns {{ phase: number, phaseName: string }}
 */
export function deriveState(substanceId, temperature) {
  const sub = getSubstance(substanceId);
  if (!sub || !sub.thermal) {
    return { phase: PHASE_GAS, phaseName: 'gas' };
  }
  const { meltPoint, boilPoint } = sub.thermal;
  // No phase transitions (fire, smoke, plasma)
  if (!meltPoint && !boilPoint) {
    // Guess from category
    if (sub.category?.toLowerCase().includes('gas') || sub.id === 'smoke' || sub.id === 'steam') {
      return { phase: PHASE_GAS, phaseName: 'gas' };
    }
    if (sub.category?.toLowerCase().includes('plasma') || sub.id === 'plasma') {
      return { phase: PHASE_PLASMA, phaseName: 'plasma' };
    }
    if (sub.id === 'fire') {
      return { phase: PHASE_GAS, phaseName: 'gas' };
    }
    return { phase: PHASE_SOLID, phaseName: 'solid' };
  }
  if (temperature < meltPoint) return { phase: PHASE_SOLID, phaseName: 'solid' };
  if (temperature < boilPoint) return { phase: PHASE_LIQUID, phaseName: 'liquid' };
  if (temperature > 10000) return { phase: PHASE_PLASMA, phaseName: 'plasma' };
  return { phase: PHASE_GAS, phaseName: 'gas' };
}

/**
 * Derive which physics systems to enable for a substance at a given temperature.
 * @param {string} substanceId
 * @param {number} temperature
 * @returns {Object} — { enableLJ, enableSPH, enableEM, enableNBody, enableChemistry, enableBlackbody }
 */
export function derivePhysicsProfile(substanceId, temperature) {
  const sub = getSubstance(substanceId);
  const { phase } = deriveState(substanceId, temperature);
  const phaseKey = ['solid', 'liquid', 'gas', 'plasma'][phase];

  const defaults = {
    enableLJ: false, enableSPH: false, enableEM: false,
    enableNBody: false, enableChemistry: false, enableBlackbody: false,
  };

  if (!sub?.physics?.[phaseKey]) return defaults;
  return { ...defaults, ...sub.physics[phaseKey] };
}

/**
 * Get SSFR tint for a substance.
 * @param {string} substanceId
 * @returns {number[]|null} — [r, g, b] or null
 */
export function getSSFRTint(substanceId) {
  const sub = resolveSubstance(substanceId);
  return sub?.visual?.ssfrTint || null;
}

/**
 * Get thermal preset for a substance.
 * @param {string} substanceId
 * @returns {Object|null}
 */
export function getThermalPreset(substanceId) {
  const sub = getSubstance(substanceId);
  return sub?.thermal || null;
}

/**
 * Get SPH fluid parameters for a substance.
 * @param {string} substanceId
 * @returns {Object|null}
 */
export function getSPHParams(substanceId) {
  const sub = getSubstance(substanceId);
  return sub?.sph || null;
}

/**
 * Get emitter defaults for a substance.
 * @param {string} substanceId
 * @returns {Object|null}
 */
export function getEmitterDefaults(substanceId) {
  const sub = getSubstance(substanceId);
  return sub?.emitter || null;
}

/**
 * Get audio cues for a substance.
 * @param {string} substanceId
 * @returns {Object|null}
 */
export function getAudioCues(substanceId) {
  const sub = getSubstance(substanceId);
  return sub?.audio || null;
}

/**
 * Get reactions for a substance.
 * @param {string} substanceId
 * @returns {Object|null}
 */
export function getReactions(substanceId) {
  const sub = getSubstance(substanceId);
  return sub?.reactions || null;
}

/**
 * Get material ID for a substance key (replaces SUBSTANCE_TO_MATERIAL lookup).
 * @param {string} key
 * @returns {number}
 */
export function getMaterialForSubstance(key) {
  const sub = resolveSubstance(key);
  return sub?.materialId ?? MATERIAL.NONE;
}

/**
 * Build THERMAL_MATERIAL_PRESETS-compatible object from all registered substances.
 * For backward compatibility with ParticleConstraints.js consumers.
 * @returns {Object}
 */
export function buildThermalPresets() {
  const presets = {};
  for (const [id, def] of _byId) {
    if (def.thermal) {
      presets[id] = {
        conductivity: def.thermal.conductivity ?? 0.5,
        meltPoint: def.thermal.meltPoint ?? 0,
        boilPoint: def.thermal.boilPoint ?? 0,
        latentHeat: def.thermal.latentHeat ?? 0,
      };
    }
  }
  return presets;
}

/**
 * Build SUBSTANCE_TO_MATERIAL-compatible object from all registered substances.
 * For backward compatibility with ParticleReactionTable.js consumers.
 * @returns {Object}
 */
export function buildSubstanceToMaterial() {
  const map = {};
  for (const [id, def] of _byId) {
    if (def.materialId != null) {
      map[id] = def.materialId;
    }
  }
  return map;
}

/**
 * Total number of registered substances.
 * @returns {number}
 */
export function getSubstanceCount() {
  return _byId.size;
}
