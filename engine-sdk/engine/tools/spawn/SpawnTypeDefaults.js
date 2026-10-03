// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpawnTypeDefaults.js - Default colors and mesh mappings for spawn types
 */

/**
 * Default colors for each spawn type
 */
export const SPAWN_TYPE_COLORS = {
  cube: [0.3, 0.8, 1.0],      // cyan
  sphere: [0.8, 0.3, 1.0],    // magenta
  cylinder: [0.6, 0.8, 0.4],  // greenish
  pillar: [0.6, 0.8, 0.4],    // greenish (same as cylinder)
  plane: [1.0, 0.3, 0.8],     // pink
  ball: [0.8, 0.3, 1.0],      // magenta (same as sphere)
  // New types
  box: [0.3, 0.8, 1.0],       // cyan (alias for cube)
  capsule: [1.0, 0.6, 0.2],   // orange
  cone: [0.9, 0.9, 0.2],      // yellow
  torus: [0.2, 0.9, 0.9],     // teal
  pyramid: [0.9, 0.4, 0.4],   // coral
  wall: [0.5, 0.5, 0.6],      // gray
  floor: [0.4, 0.6, 0.4],     // muted green
  ramp: [0.6, 0.5, 0.4],      // brown
  platform: [0.4, 0.5, 0.6],  // slate
  // Emitter marker (small purple cube)
  emitter_marker: [0.6, 0.2, 0.9], // purple
  default: [1.0, 0.8, 0.3],   // orange
};

/**
 * Mesh type mapping (which mesh to use for each spawn type)
 */
export const SPAWN_TYPE_MESHES = {
  cube: "cube",
  sphere: "sphere",
  cylinder: "cylinder",
  pillar: "cylinder",
  plane: "plane",
  ball: "sphere",
  // New types (mapped to available meshes)
  box: "cube",
  capsule: "cylinder",  // Uses cylinder until capsule mesh exists
  cone: "cylinder",     // Uses cylinder until cone mesh exists
  torus: "sphere",      // Uses sphere until torus mesh exists
  pyramid: "cube",      // Uses cube until pyramid mesh exists
  wall: "plane",
  floor: "plane",
  ramp: "plane",
  platform: "cube",
  // Emitter marker
  emitter_marker: "cube",
  default: "cube",
};

/**
 * Spawn type categories for UI organization
 */
export const SPAWN_TYPE_CATEGORIES = {
  primitives: ["cube", "sphere", "cylinder", "plane"],
  aliases: ["box", "ball", "pillar"],
  structures: ["wall", "floor", "ramp", "platform"],
  advanced: ["capsule", "cone", "torus", "pyramid"],
};

/**
 * Get all available spawn types.
 * @returns {string[]} Array of spawn type names
 */
export function getAvailableSpawnTypes() {
  return Object.keys(SPAWN_TYPE_COLORS).filter(t => t !== "default");
}

/**
 * Get spawn types by category.
 * @param {string} category - Category name
 * @returns {string[]} Array of spawn type names
 */
export function getSpawnTypesByCategory(category) {
  return SPAWN_TYPE_CATEGORIES[category] || [];
}

/**
 * Get the default color for a spawn type.
 * @param {string} type - Spawn type (cube, sphere, cylinder, etc.)
 * @returns {number[]} RGB color array
 */
export function getSpawnTypeColor(type) {
  return SPAWN_TYPE_COLORS[type] || SPAWN_TYPE_COLORS.default;
}

/**
 * Get the mesh type for a spawn type.
 * @param {string} type - Spawn type
 * @returns {string} Mesh type key
 */
export function getSpawnTypeMeshKey(type) {
  return SPAWN_TYPE_MESHES[type] || SPAWN_TYPE_MESHES.default;
}

/**
 * Resolve color and mesh for a spawned entity.
 * Uses spawnerProps.color if provided, otherwise falls back to type defaults.
 * @param {string} type - Spawn type
 * @param {Object} spawnerProps - Optional spawner properties with color override
 * @param {Object} meshes - Object mapping mesh keys to mesh instances
 * @returns {Object} { color: number[], mesh: Object, meshKey: string }
 */
export function resolveSpawnAppearance(type, spawnerProps, meshes) {
  // Determine color - prefer spawnerProps if valid
  let color;
  if (spawnerProps?.color?.length >= 3) {
    color = [spawnerProps.color[0], spawnerProps.color[1], spawnerProps.color[2]];
  } else {
    color = getSpawnTypeColor(type);
  }
  
  // Determine mesh
  const meshKey = getSpawnTypeMeshKey(type);
  const mesh = meshes[meshKey] || meshes.cube || meshes.default;
  
  return { color, mesh, meshKey };
}

/**
 * Create a mesh lookup object from individual mesh references.
 * @param {Object} options - Mesh references
 * @returns {Object} Mesh lookup object
 */
export function createMeshLookup(options) {
  const { cubeMesh, sphereMesh, cylinderMesh, planeMesh } = options;
  return {
    cube: cubeMesh,
    sphere: sphereMesh,
    cylinder: cylinderMesh,
    plane: planeMesh,
    default: cubeMesh,
  };
}
