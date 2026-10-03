/**
 * PhysicalMaterialPresets.js — Real-world material property presets
 *
 * Each preset defines how a shape behaves physically: density for mass,
 * elasticity for springback, hardness for deformation resistance,
 * brittleness for shatter vs bend, and fracture configuration.
 *
 * Used by the PhysicalMaterial ECS component and EditorPhysicalMaterial bridge.
 */

// ============================================================================
// PRESET DEFINITIONS
// ============================================================================

/**
 * @typedef {Object} PhysicalMaterialDef
 * @property {string}  name            - Display name
 * @property {number}  density         - kg/m³
 * @property {number}  elasticity      - 0-1 (springback / Young's modulus simplified)
 * @property {number}  hardness        - 0-1 (resistance to surface deformation)
 * @property {number}  tensileStrength - 0-1 (normalized force before breaking)
 * @property {number}  brittleness     - 0-1 (0=ductile bends, 1=brittle shatters)
 * @property {number}  friction        - 0-1 surface friction coefficient
 * @property {number}  restitution     - 0-1 bounciness
 * @property {boolean} deformable      - Can flex/bend under force?
 * @property {boolean} breakable       - Can fracture into pieces?
 * @property {string}  fracturePattern - 'SHATTER'|'RADIAL'|'COLUMNAR'|'BRICK'
 * @property {number}  maxFragments    - Piece count when broken
 * @property {number}  damageThreshold - 0-1 normalized force to start taking damage
 */

export const MATERIAL_PRESETS = {
    steel: {
        name: 'Steel',
        density: 7800,
        elasticity: 0.30,
        hardness: 0.95,
        tensileStrength: 0.95,
        brittleness: 0.15,
        friction: 0.60,
        restitution: 0.20,
        deformable: true,
        breakable: true,
        fracturePattern: 'SHATTER',
        maxFragments: 6,
        damageThreshold: 0.85,
    },
    iron: {
        name: 'Iron',
        density: 7200,
        elasticity: 0.25,
        hardness: 0.85,
        tensileStrength: 0.80,
        brittleness: 0.30,
        friction: 0.55,
        restitution: 0.15,
        deformable: true,
        breakable: true,
        fracturePattern: 'SHATTER',
        maxFragments: 8,
        damageThreshold: 0.75,
    },
    aluminum: {
        name: 'Aluminum',
        density: 2700,
        elasticity: 0.35,
        hardness: 0.60,
        tensileStrength: 0.55,
        brittleness: 0.10,
        friction: 0.45,
        restitution: 0.25,
        deformable: true,
        breakable: true,
        fracturePattern: 'RADIAL',
        maxFragments: 8,
        damageThreshold: 0.55,
    },
    wood: {
        name: 'Wood',
        density: 600,
        elasticity: 0.40,
        hardness: 0.40,
        tensileStrength: 0.35,
        brittleness: 0.55,
        friction: 0.50,
        restitution: 0.15,
        deformable: true,
        breakable: true,
        fracturePattern: 'COLUMNAR',
        maxFragments: 6,
        damageThreshold: 0.40,
    },
    rubber: {
        name: 'Rubber',
        density: 1100,
        elasticity: 0.95,
        hardness: 0.10,
        tensileStrength: 0.30,
        brittleness: 0.0,
        friction: 0.90,
        restitution: 0.80,
        deformable: true,
        breakable: false,
        fracturePattern: 'RADIAL',
        maxFragments: 4,
        damageThreshold: 0.90,
    },
    glass: {
        name: 'Glass',
        density: 2500,
        elasticity: 0.05,
        hardness: 0.70,
        tensileStrength: 0.15,
        brittleness: 0.95,
        friction: 0.40,
        restitution: 0.10,
        deformable: false,
        breakable: true,
        fracturePattern: 'SHATTER',
        maxFragments: 16,
        damageThreshold: 0.15,
    },
    stone: {
        name: 'Stone',
        density: 2500,
        elasticity: 0.08,
        hardness: 0.80,
        tensileStrength: 0.50,
        brittleness: 0.75,
        friction: 0.65,
        restitution: 0.10,
        deformable: false,
        breakable: true,
        fracturePattern: 'RADIAL',
        maxFragments: 10,
        damageThreshold: 0.50,
    },
    concrete: {
        name: 'Concrete',
        density: 2400,
        elasticity: 0.05,
        hardness: 0.75,
        tensileStrength: 0.40,
        brittleness: 0.80,
        friction: 0.70,
        restitution: 0.08,
        deformable: false,
        breakable: true,
        fracturePattern: 'BRICK',
        maxFragments: 12,
        damageThreshold: 0.40,
    },
    plastic: {
        name: 'Plastic',
        density: 1200,
        elasticity: 0.50,
        hardness: 0.35,
        tensileStrength: 0.40,
        brittleness: 0.35,
        friction: 0.40,
        restitution: 0.35,
        deformable: true,
        breakable: true,
        fracturePattern: 'RADIAL',
        maxFragments: 6,
        damageThreshold: 0.50,
    },
    foam: {
        name: 'Foam',
        density: 50,
        elasticity: 0.90,
        hardness: 0.05,
        tensileStrength: 0.05,
        brittleness: 0.0,
        friction: 0.60,
        restitution: 0.40,
        deformable: true,
        breakable: false,
        fracturePattern: 'RADIAL',
        maxFragments: 4,
        damageThreshold: 0.95,
    },
    ice: {
        name: 'Ice',
        density: 917,
        elasticity: 0.03,
        hardness: 0.50,
        tensileStrength: 0.10,
        brittleness: 0.90,
        friction: 0.05,
        restitution: 0.15,
        deformable: false,
        breakable: true,
        fracturePattern: 'SHATTER',
        maxFragments: 12,
        damageThreshold: 0.10,
    },
    ceramic: {
        name: 'Ceramic',
        density: 2300,
        elasticity: 0.04,
        hardness: 0.85,
        tensileStrength: 0.20,
        brittleness: 0.90,
        friction: 0.50,
        restitution: 0.08,
        deformable: false,
        breakable: true,
        fracturePattern: 'SHATTER',
        maxFragments: 14,
        damageThreshold: 0.20,
    },
};

// ============================================================================
// HELPERS
// ============================================================================

/** All preset keys. */
export const MATERIAL_KEYS = Object.keys(MATERIAL_PRESETS);

/** All preset names for dropdowns. */
export const MATERIAL_NAMES = MATERIAL_KEYS.map(k => MATERIAL_PRESETS[k].name);

/**
 * Get a full material preset by key (returns a shallow copy).
 * @param {string} key — e.g. 'steel', 'wood'
 * @returns {PhysicalMaterialDef|null}
 */
export function getMaterialPreset(key) {
    const preset = MATERIAL_PRESETS[key];
    return preset ? { ...preset, _presetKey: key } : null;
}

/**
 * Create a PhysicalMaterial component value from a preset key,
 * with optional property overrides.
 * @param {string} presetKey
 * @param {Object} overrides
 * @returns {Object}
 */
export function createPhysicalMaterial(presetKey, overrides = {}) {
    const preset = getMaterialPreset(presetKey) || getMaterialPreset('stone');
    return {
        ...preset,
        currentDamage: 0,       // Accumulated damage (0-1)
        _deformed: false,       // Has been converted to soft body
        _fractured: false,      // Has been shattered
        ...overrides,
    };
}

/**
 * Compute mass from material density and collider volume.
 * @param {Object} material — PhysicalMaterial component
 * @param {number[]} halfExtents — [hx, hy, hz] from collider
 * @param {string} colliderShape — 'box', 'sphere', 'capsule', etc.
 * @returns {number} mass in kg
 */
export function computeMassFromMaterial(material, halfExtents, colliderShape) {
    const density = material.density || 1000;
    let volume;

    switch (colliderShape) {
        case 'sphere': {
            const r = halfExtents[0];
            volume = (4 / 3) * Math.PI * r * r * r;
            break;
        }
        case 'capsule': {
            const r = halfExtents[0];
            const cylH = halfExtents[1] * 2;
            volume = Math.PI * r * r * cylH + (4 / 3) * Math.PI * r * r * r;
            break;
        }
        default: {
            // Box / fallback
            volume = halfExtents[0] * 2 * halfExtents[1] * 2 * halfExtents[2] * 2;
            break;
        }
    }

    // Clamp to reasonable range (0.01 kg — 100,000 kg)
    return Math.max(0.01, Math.min(100000, density * volume));
}
