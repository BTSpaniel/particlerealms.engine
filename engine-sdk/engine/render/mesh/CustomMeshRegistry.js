// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ============================================================================
// CustomMeshRegistry.js - Store imported mesh geometry for custom models
// ============================================================================

// Registry: meshKey -> geometry, including imported deformation metadata.
const _registry = new Map();

// Listeners for when new meshes are registered
const _listeners = [];

/**
 * Register a custom mesh geometry.
 * @param {string} meshKey - e.g. 'custom_<uuid>'
 * @param {{ positions: Float32Array, normals: Float32Array, uvs: Float32Array|null, uv1s?: Float32Array|null, tangents?: Float32Array|null, indices: Uint32Array, morphTargets?: object[], morphWeights?: number[] }} geo
 */
export function registerCustomMesh(meshKey, geo) {
    _registry.set(meshKey, {
        positions: geo.positions,
        normals: geo.normals,
        uvs: geo.uvs || null,
        uv1s: geo.uv1s || null,
        tangents: geo.tangents || null,
        indices: geo.indices,
        morphTargets: Array.isArray(geo.morphTargets) ? geo.morphTargets : null,
        morphWeights: geo.morphWeights ? Array.from(geo.morphWeights) : null,
        morphTargetNode: Number.isInteger(geo.morphTargetNode) ? geo.morphTargetNode : null,
        morphTargetNames: Array.isArray(geo.morphTargetNames) ? [...geo.morphTargetNames] : null,
    });
    for (const fn of _listeners) {
        try { fn(meshKey, geo); } catch (e) { console.error('[CustomMeshRegistry] Listener error:', e); }
    }
    console.log('[CustomMeshRegistry] Registered:', meshKey, 
        '(' + (geo.positions.length / 3) + ' verts, ' + (geo.indices.length / 3) + ' tris)');
}

/**
 * Unregister a custom mesh.
 */
export function unregisterCustomMesh(meshKey) {
    _registry.delete(meshKey);
}

/**
 * Get geometry data for a custom mesh.
 * @returns {{ positions, normals, uvs, uv1s, tangents, indices, morphTargets, morphWeights, morphTargetNode, morphTargetNames } | null}
 */
export function getCustomMesh(meshKey) {
    return _registry.get(meshKey) || null;
}

/**
 * Check if a meshType is a custom (imported) mesh.
 */
export function isCustomMesh(meshType) {
    return meshType && meshType.startsWith('custom_');
}

/**
 * Get all registered custom mesh keys.
 */
export function getRegisteredMeshTypes() {
    return Array.from(_registry.keys());
}

/**
 * Subscribe to mesh registration events.
 * Callback: (meshKey, geo) => void
 */
export function onMeshRegistered(fn) {
    _listeners.push(fn);
}

/**
 * Get count of registered custom meshes.
 */
export function getCustomMeshCount() {
    return _registry.size;
}
