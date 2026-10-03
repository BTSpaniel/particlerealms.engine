// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SubstanceSchema.js — Shared constants and type definitions for the substance system.
 *
 * Single source of truth for:
 *   - Phase constants (PHASE_SOLID, PHASE_LIQUID, PHASE_GAS, PHASE_PLASMA)
 *   - Material ID enum (MATERIAL)
 *   - Reverse lookup helpers
 *
 * Replaces scattered definitions in ParticleConstraints.js and ParticleReactionTable.js.
 * Those files re-export from here for backward compatibility.
 */

// ============================================================================
// PHASE CONSTANTS
// ============================================================================

export const PHASE_SOLID  = 0;
export const PHASE_LIQUID = 1;
export const PHASE_GAS    = 2;
export const PHASE_PLASMA = 3;

export const PHASE_NAMES = ['solid', 'liquid', 'gas', 'plasma'];

/**
 * Get phase name string from phase constant.
 * @param {number} phase
 * @returns {string}
 */
export function getPhaseName(phase) {
  return PHASE_NAMES[phase] || 'unknown';
}

/**
 * Get phase constant from name string.
 * @param {string} name
 * @returns {number}
 */
export function getPhaseFromName(name) {
  const idx = PHASE_NAMES.indexOf(name?.toLowerCase());
  return idx >= 0 ? idx : -1;
}

// ============================================================================
// MATERIAL ID ENUM
// ============================================================================
// These map to the lower 8 bits of thermalData.z (materialIdx) set at spawn time.
// 0 = unassigned (no reactions), 1-255 = substance types.

export const MATERIAL = {
  NONE:     0,
  // Indices 1-10 match thermal MATERIAL_INDEX (LUT order)
  WATER:    1,   // thermal: water (boil 373K)
  ICE:      2,   // thermal: ice
  METAL:    3,   // thermal: metal
  WOOD:     4,   // thermal: wood
  WAX:      5,   // thermal: wax
  LAVA:     6,   // thermal: lava
  OIL:      7,   // thermal: oil
  GLASS:    8,   // thermal: glass
  STONE:    9,   // thermal: stone
  PLASMA:   10,  // thermal: plasma
  // Indices 11-15: reaction-identity materials (own thermal presets)
  FIRE:     11,  // heat source, no phase transitions
  SMOKE:    12,  // low conductivity gas
  STEAM:    13,  // gas-phase water
  SPARKS:   14,  // hot metal fragments
  DEBRIS:   15,  // solid fragments
  // Indices 16-21: extended substances
  MERCURY:  16,  // liquid metal
  ACID:     17,  // corrosive liquid
  BLOOD:    18,  // biological fluid
  HONEY:    19,  // viscous organic
  SAND:     20,  // granular solid
  SNOW:     21,  // frozen water crystals
};

// Reverse lookup for debug logging
const MATERIAL_NAMES = {};
for (const [k, v] of Object.entries(MATERIAL)) {
  MATERIAL_NAMES[v] = k;
}

/**
 * Get material name from material ID.
 * @param {number} materialId
 * @returns {string}
 */
export function getMaterialName(materialId) {
  return MATERIAL_NAMES[materialId] || 'UNKNOWN';
}

/**
 * Get material ID from name string.
 * @param {string} name
 * @returns {number}
 */
export function getMaterialId(name) {
  return MATERIAL[name?.toUpperCase()] ?? MATERIAL.NONE;
}
