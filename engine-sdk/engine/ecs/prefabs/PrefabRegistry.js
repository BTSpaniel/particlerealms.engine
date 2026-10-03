// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PrefabRegistry - Runtime prefab system for entity templates
 * 
 * Prefabs define reusable entity configurations including:
 * - Default components
 * - Geometry data
 * - Collider configuration
 * - Visual properties
 * 
 * The editor uses spawnables which extend this with spawn UI logic.
 * Runtime uses prefabs directly for instantiation.
 */

// Prefab storage
const prefabs = new Map();

/**
 * Register a prefab
 * @param {string} id - Unique prefab ID
 * @param {Object} definition - Prefab definition
 */
export function registerPrefab(id, definition) {
    prefabs.set(id, {
        id,
        name: definition.name || id,
        category: definition.category || 'misc',
        components: definition.components || {},
        geometry: definition.geometry || null,
        collider: definition.collider || null,
        color: definition.color || [1, 1, 1, 1],
        sdf: definition.sdf || null,
        ...definition,
    });
}

/**
 * Get a prefab by ID
 * @param {string} id - Prefab ID
 * @returns {Object|null} Prefab definition
 */
export function getPrefab(id) {
    return prefabs.get(id) || null;
}

/**
 * Get all registered prefabs
 * @returns {Map} All prefabs
 */
export function getAllPrefabs() {
    return prefabs;
}

/**
 * Get prefabs by category
 * @param {string} category - Category name
 * @returns {Array} Prefabs in category
 */
export function getPrefabsByCategory(category) {
    const result = [];
    for (const [id, prefab] of prefabs) {
        if (prefab.category === category) {
            result.push(prefab);
        }
    }
    return result;
}

/**
 * Instantiate a prefab into components
 * @param {string} id - Prefab ID
 * @param {Object} overrides - Component overrides
 * @returns {Object} Component map ready for entity creation
 */
export function instantiatePrefab(id, overrides = {}) {
    const prefab = prefabs.get(id);
    if (!prefab) {
        console.warn(`[PrefabRegistry] Unknown prefab: ${id}`);
        return null;
    }
    
    // Deep clone default components
    const components = JSON.parse(JSON.stringify(prefab.components));
    
    // Apply overrides
    for (const [key, value] of Object.entries(overrides)) {
        if (components[key]) {
            Object.assign(components[key], value);
        } else {
            components[key] = value;
        }
    }
    
    return {
        prefabId: id,
        name: prefab.name,
        components,
        geometry: prefab.geometry,
        collider: prefab.collider,
        color: prefab.color,
    };
}

/**
 * Clear all prefabs (for testing)
 */
export function clearPrefabs() {
    prefabs.clear();
}

// ============================================================================
// PRIMITIVE PREFAB DEFINITIONS
// ============================================================================

import * as PrimitiveGeometry from '../../render/geometry/PrimitiveGeometry.js';

// Cube prefab
registerPrefab('cube', {
    name: 'Cube',
    category: 'primitives',
    components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        PhysicsBody: { simMode: 'dynamic' },
    },
    geometry: () => ({ ...PrimitiveGeometry.createCubeGeometry(1), halfExtents: [0.5, 0.5, 0.5] }),
    collider: { shape: 'box', halfExtents: [0.5, 0.5, 0.5] },
    color: [0.3, 0.6, 0.9, 1.0],
    sdfShape: 'box',
    sdfParams: [0.5, 0.5, 0.5, 0],
});

// Sphere prefab
registerPrefab('sphere', {
    name: 'Sphere',
    category: 'primitives',
    components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        PhysicsBody: { simMode: 'dynamic' },
    },
    geometry: () => PrimitiveGeometry.createSphereGeometry(0.5, 32, 24),
    collider: { shape: 'sphere', radius: 0.5 },
    color: [0.9, 0.4, 0.4, 1.0],
    sdfShape: 'sphere',
    sdfParams: [0.5, 0, 0, 0],
});

// Capsule prefab
registerPrefab('capsule', {
    name: 'Capsule',
    category: 'primitives',
    components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        PhysicsBody: { simMode: 'dynamic' },
    },
    geometry: () => PrimitiveGeometry.createCapsuleGeometry(0.3, 1.0, 24, 12),
    collider: { shape: 'capsule', radius: 0.3, halfHeight: 0.5 },
    color: [0.4, 0.9, 0.4, 1.0],
    sdfShape: 'capsule',
    sdfParams: [0.3, 0.5, 0, 0],
});

// Cylinder prefab
registerPrefab('cylinder', {
    name: 'Cylinder',
    category: 'primitives',
    components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        PhysicsBody: { simMode: 'dynamic' },
    },
    geometry: () => PrimitiveGeometry.createCylinderGeometry(0.5, 1.0, 24),
    collider: { shape: 'cylinder', radius: 0.5, halfHeight: 0.5 },
    color: [0.9, 0.9, 0.4, 1.0],
    sdfShape: 'cylinder',
    sdfParams: [0.5, 0.5, 0, 0],
});

// Plane prefab
registerPrefab('plane', {
    name: 'Plane',
    category: 'primitives',
    components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        PhysicsBody: { simMode: 'static' },
    },
    geometry: () => PrimitiveGeometry.createPlaneGeometry(10, 10),
    collider: { shape: 'box', halfExtents: [5, 0.01, 5] },
    color: [0.6, 0.6, 0.6, 1.0],
    sdfShape: 'box',
    sdfParams: [5, 0.01, 5, 0],
});

// Torus prefab
registerPrefab('torus', {
    name: 'Torus',
    category: 'primitives',
    components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        PhysicsBody: { simMode: 'dynamic' },
    },
    geometry: () => PrimitiveGeometry.createTorusGeometry(0.5, 0.2, 32, 16),
    collider: { shape: 'convexMesh' }, // Complex shape needs mesh collider
    color: [0.9, 0.5, 0.9, 1.0],
    sdfShape: 'torus',
    sdfParams: [0.5, 0.2, 0, 0],
});

// Cone prefab
registerPrefab('cone', {
    name: 'Cone',
    category: 'primitives',
    components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        PhysicsBody: { simMode: 'dynamic' },
    },
    geometry: () => PrimitiveGeometry.createConeGeometry(0.5, 1.0, 24),
    collider: { shape: 'convexMesh' }, // Cone needs convex mesh
    color: [0.4, 0.7, 0.9, 1.0],
    sdfShape: 'cone',
    sdfParams: [0.5, 1.0, 0, 0],
});
