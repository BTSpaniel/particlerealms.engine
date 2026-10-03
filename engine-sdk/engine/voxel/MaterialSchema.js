// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MaterialSchema.js - Single Source of Truth for Material Definitions
 * 
 * ALL material IDs, colors, and properties MUST be defined here.
 * Other files should import from this schema - do NOT duplicate definitions.
 * 
 * To add a new material:
 * 1. Add entry to MATERIAL_DEFINITIONS array (ID is auto-assigned by index)
 * 2. Run validateSchema() to check for errors
 * 3. All dependent systems will automatically pick up the new material
 */

// Schema version - increment when making breaking changes
export const SCHEMA_VERSION = 1;

/**
 * Material definition schema
 * Each material has:
 * - name: Unique identifier (used as enum key)
 * - color: RGBA array [0-255, 0-255, 0-255, 0-255]
 * - colorNormalized: RGBA array [0-1, 0-1, 0-1, 0-1] (auto-generated)
 * - properties: Material behavior flags
 */
export const MATERIAL_DEFINITIONS = [
    // ID 0: Air (must always be first)
    {
        name: 'AIR',
        color: [0, 0, 0, 0],
        properties: { transparent: true, solid: false, fluid: false, emissive: false }
    },
    // ID 1: Stone
    {
        name: 'STONE',
        color: [128, 128, 140, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 2: Dirt
    {
        name: 'DIRT',
        color: [139, 90, 43, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 3: Grass
    {
        name: 'GRASS',
        color: [86, 152, 59, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 4: Sand
    {
        name: 'SAND',
        color: [237, 201, 175, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false, gravity: true }
    },
    // ID 5: Water
    {
        name: 'WATER',
        color: [30, 120, 200, 180],
        properties: { transparent: true, solid: false, fluid: true, emissive: false }
    },
    // ID 6: Wood
    {
        name: 'WOOD',
        color: [160, 120, 80, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 7: Leaves
    {
        name: 'LEAVES',
        color: [45, 90, 45, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 8: Snow
    {
        name: 'SNOW',
        color: [245, 245, 255, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 9: Ice
    {
        name: 'ICE',
        color: [160, 212, 232, 200],
        properties: { transparent: true, solid: true, fluid: false, emissive: false }
    },
    // ID 10: Lava
    {
        name: 'LAVA',
        color: [255, 80, 20, 255],
        properties: { transparent: false, solid: false, fluid: true, emissive: true }
    },
    // ID 11: Cactus
    {
        name: 'CACTUS',
        color: [60, 140, 60, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 12: Deepstone
    {
        name: 'DEEPSTONE',
        color: [70, 70, 85, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 13: Obsidian
    {
        name: 'OBSIDIAN',
        color: [30, 25, 40, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 14: Magma
    {
        name: 'MAGMA',
        color: [255, 100, 30, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: true }
    },
    // ID 15: Crystal
    {
        name: 'CRYSTAL',
        color: [180, 120, 255, 200],
        properties: { transparent: true, solid: true, fluid: false, emissive: true }
    },
    // ID 16: Voidstone
    {
        name: 'VOIDSTONE',
        color: [15, 10, 25, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 17: Fungus
    {
        name: 'FUNGUS',
        color: [140, 90, 180, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 18: Mycelium
    {
        name: 'MYCELIUM',
        color: [100, 70, 120, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 19: Steam
    {
        name: 'STEAM',
        color: [200, 200, 220, 100],
        properties: { transparent: true, solid: false, fluid: true, emissive: false, gas: true }
    },
    // ID 20: Oil
    {
        name: 'OIL',
        color: [40, 35, 30, 200],
        properties: { transparent: true, solid: false, fluid: true, emissive: false }
    },
    // ID 21: Acid
    {
        name: 'ACID',
        color: [120, 255, 80, 180],
        properties: { transparent: true, solid: false, fluid: true, emissive: false }
    },
    // ID 22: Gravel
    {
        name: 'GRAVEL',
        color: [100, 95, 90, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false, gravity: true }
    },
    // ID 23: Metal
    {
        name: 'METAL',
        color: [180, 180, 195, 255],
        properties: { transparent: false, solid: true, fluid: false, emissive: false }
    },
    // ID 24: Energy
    {
        name: 'ENERGY',
        color: [233, 69, 96, 255],
        properties: { transparent: true, solid: false, fluid: false, emissive: true }
    },
];

// Auto-generate MATERIAL enum from definitions
export const MATERIAL = Object.fromEntries(
    MATERIAL_DEFINITIONS.map((def, idx) => [def.name, idx])
);

// Auto-generate color arrays
export const MATERIAL_COLORS = Object.fromEntries(
    MATERIAL_DEFINITIONS.map((def, idx) => [idx, def.color])
);

// Normalized colors [0-1] for shaders
export const MATERIAL_COLORS_NORMALIZED = MATERIAL_DEFINITIONS.map(def => 
    def.color.map(c => c / 255)
);

// Properties lookup
export const MATERIAL_PROPERTIES = Object.fromEntries(
    MATERIAL_DEFINITIONS.map((def, idx) => [idx, def.properties])
);

// Name lookup by ID
export const MATERIAL_NAMES = Object.fromEntries(
    MATERIAL_DEFINITIONS.map((def, idx) => [idx, def.name])
);

// ID lookup by name
export const MATERIAL_IDS = Object.fromEntries(
    MATERIAL_DEFINITIONS.map((def, idx) => [def.name, idx])
);

// Total material count
export const MATERIAL_COUNT = MATERIAL_DEFINITIONS.length;

/**
 * Get material ID by name (safe lookup)
 * @param {string} name - Material name (e.g., 'STONE', 'LEAVES')
 * @returns {number} Material ID, or 0 (AIR) if not found
 */
export function getMaterialId(name) {
    const id = MATERIAL_IDS[name];
    if (id === undefined) {
        console.warn(`[MaterialSchema] Unknown material: ${name}, defaulting to AIR`);
        return 0;
    }
    return id;
}

/**
 * Get material name by ID (safe lookup)
 * @param {number} id - Material ID
 * @returns {string} Material name, or 'UNKNOWN' if not found
 */
export function getMaterialName(id) {
    return MATERIAL_NAMES[id] || 'UNKNOWN';
}

/**
 * Get material color by ID
 * @param {number} id - Material ID
 * @returns {Array} RGBA color array [0-255]
 */
export function getMaterialColor(id) {
    return MATERIAL_COLORS[id] || [255, 0, 255, 255]; // Magenta for unknown
}

/**
 * Get material properties by ID
 * @param {number} id - Material ID
 * @returns {Object} Properties object
 */
export function getMaterialProperties(id) {
    return MATERIAL_PROPERTIES[id] || { transparent: false, solid: true, fluid: false, emissive: false };
}

/**
 * Check if material is transparent
 * @param {number} id - Material ID
 * @returns {boolean}
 */
export function isTransparent(id) {
    return MATERIAL_PROPERTIES[id]?.transparent ?? false;
}

/**
 * Check if material is solid
 * @param {number} id - Material ID
 * @returns {boolean}
 */
export function isSolid(id) {
    return MATERIAL_PROPERTIES[id]?.solid ?? true;
}

/**
 * Check if material is fluid
 * @param {number} id - Material ID
 * @returns {boolean}
 */
export function isFluid(id) {
    return MATERIAL_PROPERTIES[id]?.fluid ?? false;
}

/**
 * Check if material is emissive
 * @param {number} id - Material ID
 * @returns {boolean}
 */
export function isEmissive(id) {
    return MATERIAL_PROPERTIES[id]?.emissive ?? false;
}

/**
 * Validate schema integrity
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateSchema() {
    const errors = [];
    const names = new Set();
    
    // Check AIR is ID 0
    if (MATERIAL_DEFINITIONS[0]?.name !== 'AIR') {
        errors.push('AIR must be material ID 0');
    }
    
    // Check for duplicate names
    for (const def of MATERIAL_DEFINITIONS) {
        if (names.has(def.name)) {
            errors.push(`Duplicate material name: ${def.name}`);
        }
        names.add(def.name);
        
        // Validate color array
        if (!Array.isArray(def.color) || def.color.length !== 4) {
            errors.push(`Invalid color for ${def.name}: must be [R, G, B, A]`);
        }
        
        // Validate color values
        for (const c of def.color) {
            if (c < 0 || c > 255) {
                errors.push(`Invalid color value for ${def.name}: ${c} (must be 0-255)`);
            }
        }
    }
    
    return { valid: errors.length === 0, errors };
}

// Run validation on load (development check)
if (typeof window !== 'undefined') {
    const result = validateSchema();
    if (!result.valid) {
        console.error('[MaterialSchema] Validation failed:', result.errors);
    } else {
        console.log(`[MaterialSchema] Validated ${MATERIAL_COUNT} materials (v${SCHEMA_VERSION})`);
    }
}

export default {
    SCHEMA_VERSION,
    MATERIAL_DEFINITIONS,
    MATERIAL,
    MATERIAL_COLORS,
    MATERIAL_COLORS_NORMALIZED,
    MATERIAL_PROPERTIES,
    MATERIAL_NAMES,
    MATERIAL_IDS,
    MATERIAL_COUNT,
    getMaterialId,
    getMaterialName,
    getMaterialColor,
    getMaterialProperties,
    isTransparent,
    isSolid,
    isFluid,
    isEmissive,
    validateSchema,
};
