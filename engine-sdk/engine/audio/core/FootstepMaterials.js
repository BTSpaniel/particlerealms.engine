// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FootstepMaterials.js - Footstep Material Taxonomy & Mapping
 * 
 * Defines acoustic materials for footsteps (distinct from physics materials)
 * and provides mapping from physics/voxel materials to footstep materials.
 */

// ============================================================================
// FOOTSTEP MATERIAL DEFINITIONS
// ============================================================================

/**
 * Footstep material configurations.
 * Each defines the procedural patch to use and number of variants.
 */
export const FOOTSTEP_MATERIALS = {
  // Terrain
  dirt: { patch: 'footstep_dirt', variants: 8 },
  grass: { patch: 'footstep_grass', variants: 6 },
  sand: { patch: 'footstep_sand', variants: 6 },
  gravel: { patch: 'footstep_gravel', variants: 8 },
  mud: { patch: 'footstep_mud', variants: 6 },
  snow: { patch: 'footstep_snow', variants: 6 },
  
  // Hard surfaces
  stone: { patch: 'footstep_stone', variants: 8 },
  concrete: { patch: 'footstep_concrete', variants: 8 },
  marble: { patch: 'footstep_marble', variants: 6 },
  brick: { patch: 'footstep_brick', variants: 6 },
  
  // Wood
  wood_plank: { patch: 'footstep_wood_plank', variants: 8 },
  wood_creak: { patch: 'footstep_wood_creak', variants: 6 },
  
  // Metal
  metal_solid: { patch: 'footstep_metal_solid', variants: 6 },
  metal_grate: { patch: 'footstep_metal_grate', variants: 6 },
  
  // Liquids (shallow wading)
  water_shallow: { patch: 'footstep_water_shallow', variants: 6 },
  water_puddle: { patch: 'footstep_water_puddle', variants: 4 },
  
  // Special
  leaves: { patch: 'footstep_leaves', variants: 6 },
  glass: { patch: 'footstep_glass', variants: 4 },
  ice: { patch: 'footstep_ice', variants: 6 },
};

// ============================================================================
// PHYSICS MATERIAL → FOOTSTEP MATERIAL MAPPING
// ============================================================================

/**
 * Map physics material IDs to footstep materials.
 * Physics materials are from PhysicsAudioBridge.js MATERIAL_TO_SUBSTANCE.
 */
export const PHYSICS_TO_FOOTSTEP = {
  0: 'dirt',            // NONE (default fallback)
  1: 'water_shallow',   // water
  2: 'dirt',            // fire (shouldn't step on, fallback to dirt)
  3: 'dirt',            // smoke (gas, fallback)
  4: 'wood_plank',      // wood
  5: 'ice',             // ice
  6: 'stone',           // lava (shouldn't step on, fallback to stone)
  7: 'metal_solid',     // metal
  8: 'glass',           // glass
  9: 'stone',           // stone
  10: 'dirt',           // plasma (fallback)
  11: 'dirt',           // sparks (fallback)
  12: 'gravel',         // debris
  13: 'dirt',           // steam (fallback)
  14: 'dirt',           // oil (fallback)
  15: 'dirt',           // wax (fallback)
  16: 'metal_solid',    // mercury (liquid metal)
  17: 'dirt',           // acid (fallback)
  18: 'dirt',           // blood (fallback)
  19: 'dirt',           // honey (fallback)
  20: 'sand',           // sand
  21: 'snow',           // snow
};

/**
 * Map voxel/terrain material strings to footstep materials.
 * Used when querying terrain directly.
 */
export const VOXEL_TO_FOOTSTEP = {
  // Terrain types
  dirt: 'dirt',
  soil: 'dirt',
  earth: 'dirt',
  grass: 'grass',
  sand: 'sand',
  gravel: 'gravel',
  mud: 'mud',
  snow: 'snow',
  ice: 'ice',
  
  // Stone types
  stone: 'stone',
  rock: 'stone',
  granite: 'stone',
  marble: 'marble',
  brick: 'brick',
  concrete: 'concrete',
  
  // Wood types
  wood: 'wood_plank',
  plank: 'wood_plank',
  timber: 'wood_plank',
  
  // Metal types
  metal: 'metal_solid',
  iron: 'metal_solid',
  steel: 'metal_solid',
  grate: 'metal_grate',
  
  // Liquids
  water: 'water_shallow',
  puddle: 'water_puddle',
  
  // Special
  leaves: 'leaves',
  foliage: 'leaves',
  glass: 'glass',
};

// ============================================================================
// MATERIAL RESOLUTION
// ============================================================================

/**
 * Resolve a physics material ID to a footstep material key.
 * @param {number|string|null} material - Physics material ID or voxel material string
 * @returns {string} Footstep material key (defaults to 'dirt')
 */
export function resolveFootstepMaterial(material) {
  if (material == null) return 'dirt';
  
  // Try as physics material ID
  if (typeof material === 'number') {
    return PHYSICS_TO_FOOTSTEP[material] || 'dirt';
  }
  
  // Try as voxel material string
  if (typeof material === 'string') {
    const lower = material.toLowerCase();
    return VOXEL_TO_FOOTSTEP[lower] || 'dirt';
  }
  
  return 'dirt';
}

/**
 * Get footstep material config.
 * @param {string} materialKey - Footstep material key
 * @returns {Object} { patch, variants }
 */
export function getFootstepConfig(materialKey) {
  return FOOTSTEP_MATERIALS[materialKey] || FOOTSTEP_MATERIALS.dirt;
}

/**
 * Get all footstep material keys.
 * @returns {string[]}
 */
export function getAllFootstepMaterials() {
  return Object.keys(FOOTSTEP_MATERIALS);
}
