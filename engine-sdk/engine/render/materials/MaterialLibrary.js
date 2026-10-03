// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MaterialLibrary.js - Material CRUD & Persistence
 * 
 * Manages a collection of PBR material definitions. Each material has:
 * - PBR scalar properties (metallic, roughness, emissive intensity)
 * - Color values (baseColor, emissiveColor)
 * - Texture slot paths (albedo, normal, metallicRoughness, emissive, ao)
 * - Metadata (id, label, tags)
 * 
 * Persists to localStorage and can export/import JSON.
 */

import { createBrowserRecordContract } from '../../core/schema/BrowserRecordContract.js';

const STORAGE_KEY = 'editor_material_library';
export const MATERIAL_LIBRARY_SCHEMA = 'engine.material-library';
export const MATERIAL_LIBRARY_SCHEMA_VERSION = 2;

const materialLibraryStorage = createBrowserRecordContract({
    schema: MATERIAL_LIBRARY_SCHEMA,
    legacyKey: STORAGE_KEY,
    currentKey: `${STORAGE_KEY}.v2`,
    payloadKey: 'materials',
    maxBytes: 16 * 1024 * 1024,
    validate: value => Array.isArray(value) && value.length <= 10000
        && value.every(item => Boolean(item) && typeof item === 'object' && !Array.isArray(item)),
});

export function readMaterialLibraryRecord(storage = globalThis.localStorage) {
    return materialLibraryStorage.read(storage);
}

export function writeMaterialLibraryRecord(materials, storage = globalThis.localStorage) {
    return materialLibraryStorage.write(materials, storage);
}

let _nextId = 1;

// ============================================================================
// DEFAULT MATERIAL DESCRIPTOR
// ============================================================================

const DEFAULT_MATERIAL = {
    id: '',
    label: 'New Material',
    type: 'pbr',            // 'pbr' | 'unlit'
    baseColor: [0.6, 0.6, 0.6, 1.0],
    emissiveColor: [0, 0, 0],
    emissiveIntensity: 0,
    metallic: 0.0,
    roughness: 0.6,
    // Texture paths (null = no texture, uses scalar/color value)
    texAlbedo: null,
    texNormal: null,
    normalScale: 1.0,
    normalGreenChannel: 'up',
    texMetallicRoughness: null,
    texEmissive: null,
    texAO: null,
    // UV tiling
    uvScale: [1, 1],
    uvOffset: [0, 0],
    // Rendering
    alphaMode: 'opaque',    // 'opaque' | 'blend' | 'mask'
    alphaCutoff: 0.5,
    doubleSided: false,
    // Node graph (Phase 4 — null until user creates one)
    nodeGraph: null,
    // Metadata
    tags: [],
    createdAt: 0,
    modifiedAt: 0,
};

// ============================================================================
// BUILT-IN PRESETS
// ============================================================================

const BUILTIN_PRESETS = [
    {
        id: 'mat_default',
        label: 'Default Grey',
        baseColor: [0.6, 0.6, 0.6, 1.0],
        metallic: 0.0,
        roughness: 0.6,
        tags: ['basic'],
    },
    {
        id: 'mat_red_plastic',
        label: 'Red Plastic',
        baseColor: [0.8, 0.1, 0.1, 1.0],
        metallic: 0.0,
        roughness: 0.4,
        tags: ['basic', 'plastic'],
    },
    {
        id: 'mat_blue_plastic',
        label: 'Blue Plastic',
        baseColor: [0.1, 0.3, 0.8, 1.0],
        metallic: 0.0,
        roughness: 0.4,
        tags: ['basic', 'plastic'],
    },
    {
        id: 'mat_green_plastic',
        label: 'Green Plastic',
        baseColor: [0.15, 0.65, 0.2, 1.0],
        metallic: 0.0,
        roughness: 0.45,
        tags: ['basic', 'plastic'],
    },
    {
        id: 'mat_white',
        label: 'White',
        baseColor: [0.95, 0.95, 0.95, 1.0],
        metallic: 0.0,
        roughness: 0.5,
        tags: ['basic'],
    },
    {
        id: 'mat_black',
        label: 'Black',
        baseColor: [0.05, 0.05, 0.05, 1.0],
        metallic: 0.0,
        roughness: 0.5,
        tags: ['basic'],
    },
    {
        id: 'mat_polished_steel',
        label: 'Polished Steel',
        baseColor: [0.8, 0.8, 0.82, 1.0],
        metallic: 1.0,
        roughness: 0.15,
        tags: ['metal'],
    },
    {
        id: 'mat_brushed_aluminum',
        label: 'Brushed Aluminum',
        baseColor: [0.85, 0.85, 0.87, 1.0],
        metallic: 1.0,
        roughness: 0.4,
        tags: ['metal'],
    },
    {
        id: 'mat_gold',
        label: 'Gold',
        baseColor: [1.0, 0.76, 0.33, 1.0],
        metallic: 1.0,
        roughness: 0.2,
        tags: ['metal'],
    },
    {
        id: 'mat_copper',
        label: 'Copper',
        baseColor: [0.95, 0.64, 0.54, 1.0],
        metallic: 1.0,
        roughness: 0.25,
        tags: ['metal'],
    },
    {
        id: 'mat_rubber',
        label: 'Rubber',
        baseColor: [0.15, 0.15, 0.15, 1.0],
        metallic: 0.0,
        roughness: 0.95,
        tags: ['basic'],
    },
    {
        id: 'mat_wood',
        label: 'Wood',
        baseColor: [0.55, 0.35, 0.18, 1.0],
        metallic: 0.0,
        roughness: 0.7,
        tags: ['organic'],
    },
    {
        id: 'mat_concrete',
        label: 'Concrete',
        baseColor: [0.55, 0.55, 0.52, 1.0],
        metallic: 0.0,
        roughness: 0.9,
        tags: ['stone'],
    },
    {
        id: 'mat_glass',
        label: 'Glass',
        baseColor: [0.95, 0.95, 0.98, 0.3],
        metallic: 0.0,
        roughness: 0.05,
        alphaMode: 'blend',
        tags: ['transparent'],
    },
    {
        id: 'mat_emissive_white',
        label: 'Emissive White',
        baseColor: [1.0, 1.0, 1.0, 1.0],
        emissiveColor: [1.0, 1.0, 1.0],
        emissiveIntensity: 2.0,
        metallic: 0.0,
        roughness: 0.5,
        tags: ['emissive'],
    },

    // ── Substance-Linked Materials ─────────────────────────────────
    // Sourced from SubstanceRegistry visual.js data for each substance
    {
        id: 'sub_water', label: 'Water', baseColor: [0.15, 0.4, 0.7, 0.92],
        metallic: 0.0, roughness: 0.1, alphaMode: 'blend',
        tags: ['substance', 'liquid', 'animated'],
    },
    {
        id: 'sub_lava', label: 'Lava', baseColor: [1.0, 0.3, 0.0, 1.0],
        metallic: 0.0, roughness: 0.7, emissiveColor: [1.0, 0.3, 0.0], emissiveIntensity: 3.0,
        tags: ['substance', 'liquid', 'animated', 'emissive'],
    },
    {
        id: 'sub_fire', label: 'Fire', baseColor: [1.0, 0.6, 0.1, 1.0],
        metallic: 0.0, roughness: 0.0, emissiveColor: [1.0, 0.6, 0.1], emissiveIntensity: 4.0,
        tags: ['substance', 'gas', 'emissive'],
    },
    {
        id: 'sub_smoke', label: 'Smoke', baseColor: [0.25, 0.25, 0.25, 0.6],
        metallic: 0.0, roughness: 0.9, alphaMode: 'blend',
        tags: ['substance', 'gas'],
    },
    {
        id: 'sub_ice', label: 'Ice', baseColor: [0.6, 0.8, 0.95, 0.88],
        metallic: 0.0, roughness: 0.15, alphaMode: 'blend',
        tags: ['substance', 'solid', 'animated'],
    },
    {
        id: 'sub_metal', label: 'Metal (Iron)', baseColor: [0.7, 0.7, 0.72, 1.0],
        metallic: 1.0, roughness: 0.3,
        tags: ['substance', 'solid', 'metal'],
    },
    {
        id: 'sub_plasma', label: 'Plasma', baseColor: [0.6, 0.4, 1.0, 0.7],
        metallic: 0.0, roughness: 0.0, emissiveColor: [0.6, 0.4, 1.0], emissiveIntensity: 4.0,
        alphaMode: 'blend',
        tags: ['substance', 'plasma', 'emissive'],
    },
    {
        id: 'sub_oil', label: 'Oil', baseColor: [0.15, 0.12, 0.08, 1.0],
        metallic: 0.0, roughness: 0.1,
        tags: ['substance', 'liquid'],
    },
    {
        id: 'sub_glass', label: 'Glass', baseColor: [0.85, 0.9, 0.95, 0.4],
        metallic: 0.0, roughness: 0.05, alphaMode: 'blend',
        tags: ['substance', 'solid', 'transparent'],
    },
    {
        id: 'sub_stone', label: 'Stone', baseColor: [0.5, 0.48, 0.42, 1.0],
        metallic: 0.0, roughness: 0.85,
        tags: ['substance', 'solid'],
    },
    {
        id: 'sub_wax', label: 'Wax', baseColor: [0.85, 0.78, 0.6, 1.0],
        metallic: 0.0, roughness: 0.6,
        tags: ['substance', 'solid'],
    },
    {
        id: 'sub_wood', label: 'Wood', baseColor: [0.55, 0.35, 0.18, 1.0],
        metallic: 0.0, roughness: 0.7,
        tags: ['substance', 'solid', 'organic'],
    },
    {
        id: 'sub_steam', label: 'Steam', baseColor: [0.9, 0.92, 0.95, 0.5],
        metallic: 0.0, roughness: 0.0, alphaMode: 'blend',
        tags: ['substance', 'gas'],
    },
    {
        id: 'sub_sparks', label: 'Sparks', baseColor: [1.0, 0.7, 0.2, 1.0],
        metallic: 0.8, roughness: 0.2, emissiveColor: [1.0, 0.7, 0.2], emissiveIntensity: 3.0,
        tags: ['substance', 'solid', 'emissive'],
    },
    {
        id: 'sub_debris', label: 'Debris', baseColor: [0.4, 0.35, 0.3, 1.0],
        metallic: 0.0, roughness: 0.85,
        tags: ['substance', 'solid'],
    },
    {
        id: 'sub_mercury', label: 'Mercury', baseColor: [0.75, 0.75, 0.78, 1.0],
        metallic: 1.0, roughness: 0.05,
        tags: ['substance', 'liquid', 'metal'],
    },
    {
        id: 'sub_acid', label: 'Acid', baseColor: [0.3, 0.9, 0.15, 0.85],
        metallic: 0.0, roughness: 0.15, emissiveColor: [0.3, 0.9, 0.15], emissiveIntensity: 1.0,
        alphaMode: 'blend',
        tags: ['substance', 'liquid', 'emissive'],
    },
    {
        id: 'sub_blood', label: 'Blood', baseColor: [0.5, 0.02, 0.02, 1.0],
        metallic: 0.0, roughness: 0.2,
        tags: ['substance', 'liquid'],
    },
    {
        id: 'sub_honey', label: 'Honey', baseColor: [0.85, 0.6, 0.1, 0.9],
        metallic: 0.0, roughness: 0.2, alphaMode: 'blend',
        tags: ['substance', 'liquid', 'organic'],
    },
    {
        id: 'sub_sand', label: 'Sand', baseColor: [0.82, 0.72, 0.5, 1.0],
        metallic: 0.0, roughness: 0.9,
        tags: ['substance', 'solid'],
    },
    {
        id: 'sub_snow', label: 'Snow', baseColor: [0.95, 0.96, 0.98, 1.0],
        metallic: 0.0, roughness: 0.8,
        tags: ['substance', 'solid'],
    },

    // ── Animated Effect Materials ──────────────────────────────────
    {
        id: 'sub_hologram', label: 'Hologram', baseColor: [0.1, 0.7, 1.0, 0.4],
        metallic: 0.0, roughness: 0.0, emissiveColor: [0.1, 0.7, 1.0], emissiveIntensity: 2.0,
        alphaMode: 'blend',
        tags: ['effect', 'animated', 'emissive', 'sci-fi'],
    },
    {
        id: 'sub_force_field', label: 'Force Field', baseColor: [0.2, 0.5, 1.0, 0.3],
        metallic: 0.0, roughness: 0.0, emissiveColor: [0.2, 0.5, 1.0], emissiveIntensity: 3.0,
        alphaMode: 'blend',
        tags: ['effect', 'animated', 'emissive', 'sci-fi'],
    },
    {
        id: 'sub_dissolve', label: 'Dissolve', baseColor: [0.6, 0.6, 0.6, 1.0],
        metallic: 0.0, roughness: 0.5,
        tags: ['effect', 'animated'],
    },
    {
        id: 'sub_neon', label: 'Neon Glow', baseColor: [1.0, 0.1, 0.6, 1.0],
        metallic: 0.0, roughness: 0.3, emissiveColor: [1.0, 0.1, 0.6], emissiveIntensity: 3.0,
        tags: ['effect', 'animated', 'emissive'],
    },
    {
        id: 'sub_digital', label: 'Digital Rain', baseColor: [0.0, 0.08, 0.0, 1.0],
        metallic: 0.0, roughness: 0.5, emissiveColor: [0.0, 0.8, 0.1], emissiveIntensity: 2.5,
        tags: ['effect', 'animated', 'emissive', 'sci-fi'],
    },

    // ── 3D Depth Effect Materials ──────────────────────────────────
    {
        id: 'mat_cobblestone_3d', label: 'Cobblestone (3D Depth)',
        baseColor: [0.45, 0.4, 0.35, 1.0], metallic: 0.0, roughness: 0.8,
        tags: ['depth', '3d', 'stone', 'pom'],
    },
    {
        id: 'mat_worn_metal_3d', label: 'Worn Metal (3D Depth)',
        baseColor: [0.5, 0.3, 0.2, 1.0], metallic: 0.6, roughness: 0.5,
        tags: ['depth', '3d', 'metal', 'pom', 'weathered'],
    },
];

// ============================================================================
// NORMALIZATION
// ============================================================================

function _normColor4(val, def) {
    if (!Array.isArray(val) || val.length < 3) return def.slice();
    return [
        Number.isFinite(+val[0]) ? +val[0] : def[0],
        Number.isFinite(+val[1]) ? +val[1] : def[1],
        Number.isFinite(+val[2]) ? +val[2] : def[2],
        Number.isFinite(+val[3]) ? +val[3] : (def[3] ?? 1),
    ];
}

function _normColor3(val, def) {
    if (!Array.isArray(val) || val.length < 3) return def.slice();
    return [
        Number.isFinite(+val[0]) ? +val[0] : def[0],
        Number.isFinite(+val[1]) ? +val[1] : def[1],
        Number.isFinite(+val[2]) ? +val[2] : def[2],
    ];
}

function _normVec2(val, def) {
    if (!Array.isArray(val) || val.length < 2) return def.slice();
    return [
        Number.isFinite(+val[0]) ? +val[0] : def[0],
        Number.isFinite(+val[1]) ? +val[1] : def[1],
    ];
}

function _normNum(val, def, min = -Infinity, max = Infinity) {
    const n = Number(val);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}

function _normNormalGreenChannel(val, def = 'up') {
    return val === 'down' ? 'down' : def;
}

function _normStr(val, def) {
    return typeof val === 'string' ? val : def;
}

function _normTexPath(val) {
    return typeof val === 'string' && val.length > 0 ? val : null;
}

/**
 * Normalize a material descriptor, filling missing fields with defaults.
 * @param {Object} input
 * @returns {Object}
 */
export function normalizeMaterial(input) {
    const src = input && typeof input === 'object' ? input : {};
    const now = Date.now();
    return {
        id: _normStr(src.id, ''),
        label: _normStr(src.label, DEFAULT_MATERIAL.label),
        type: _normStr(src.type, DEFAULT_MATERIAL.type),
        baseColor: _normColor4(src.baseColor, DEFAULT_MATERIAL.baseColor),
        emissiveColor: _normColor3(src.emissiveColor, DEFAULT_MATERIAL.emissiveColor),
        emissiveIntensity: _normNum(src.emissiveIntensity, DEFAULT_MATERIAL.emissiveIntensity, 0, 100),
        metallic: _normNum(src.metallic, DEFAULT_MATERIAL.metallic, 0, 1),
        roughness: _normNum(src.roughness, DEFAULT_MATERIAL.roughness, 0.04, 1),
        texAlbedo: _normTexPath(src.texAlbedo),
        texNormal: _normTexPath(src.texNormal),
        normalScale: _normNum(src.normalScale ?? src.normalTextureScale, DEFAULT_MATERIAL.normalScale, 0, 8),
        normalGreenChannel: _normNormalGreenChannel(src.normalGreenChannel ?? src.normalTextureGreenChannel, DEFAULT_MATERIAL.normalGreenChannel),
        texMetallicRoughness: _normTexPath(src.texMetallicRoughness),
        texEmissive: _normTexPath(src.texEmissive),
        texAO: _normTexPath(src.texAO),
        uvScale: _normVec2(src.uvScale, DEFAULT_MATERIAL.uvScale),
        uvOffset: _normVec2(src.uvOffset, DEFAULT_MATERIAL.uvOffset),
        alphaMode: ['opaque', 'blend', 'mask'].includes(src.alphaMode) ? src.alphaMode : DEFAULT_MATERIAL.alphaMode,
        alphaCutoff: _normNum(src.alphaCutoff, DEFAULT_MATERIAL.alphaCutoff, 0, 1),
        doubleSided: typeof src.doubleSided === 'boolean' ? src.doubleSided : DEFAULT_MATERIAL.doubleSided,
        nodeGraph: src.nodeGraph || null,
        tags: Array.isArray(src.tags) ? src.tags.filter(t => typeof t === 'string') : [],
        createdAt: _normNum(src.createdAt, now),
        modifiedAt: _normNum(src.modifiedAt, now),
    };
}

// ============================================================================
// LIBRARY
// ============================================================================

/**
 * Create a MaterialLibrary instance.
 * @returns {Object} MaterialLibrary API
 */
export function createMaterialLibrary(storage = globalThis.localStorage) {
    /** @type {Map<string, Object>} */
    const materials = new Map();

    /** @type {Set<Function>} */
    const listeners = new Set();

    // ── Load from localStorage ─────────────────────────────────────

    function _load() {
        try {
            const arr = readMaterialLibraryRecord(storage);
            if (arr) {
                if (Array.isArray(arr)) {
                    for (const item of arr) {
                        const mat = normalizeMaterial(item);
                        if (mat.id) {
                            materials.set(mat.id, mat);
                            // Track highest ID for auto-increment
                            const num = parseInt(mat.id.replace('mat_', ''), 10);
                            if (Number.isFinite(num) && num >= _nextId) _nextId = num + 1;
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('[MaterialLibrary] Failed to load from localStorage:', err.message);
        }

        // Ensure built-in presets exist
        for (const preset of BUILTIN_PRESETS) {
            if (!materials.has(preset.id)) {
                materials.set(preset.id, normalizeMaterial(preset));
            }
        }
    }

    function _save() {
        try {
            const arr = Array.from(materials.values());
            writeMaterialLibraryRecord(arr, storage);
        } catch (err) {
            console.warn('[MaterialLibrary] Failed to save:', err.message);
        }
    }

    function _notify(event, matId) {
        for (const fn of listeners) {
            try { fn(event, matId); } catch (_) {}
        }
    }

    // ── Public API ─────────────────────────────────────────────────

    /**
     * Create a new material and add it to the library.
     * @param {Object} [descriptor] - Partial material descriptor
     * @returns {Object} The created material
     */
    function create(descriptor = {}) {
        const mat = normalizeMaterial(descriptor);
        if (!mat.id) {
            mat.id = `mat_${_nextId++}`;
        }
        mat.createdAt = Date.now();
        mat.modifiedAt = mat.createdAt;
        materials.set(mat.id, mat);
        _save();
        _notify('created', mat.id);
        return mat;
    }

    /**
     * Get a material by ID.
     * @param {string} id
     * @returns {Object|null}
     */
    function get(id) {
        return materials.get(id) || null;
    }

    /**
     * Update a material's properties.
     * @param {string} id
     * @param {Object} changes - Partial descriptor to merge
     * @returns {Object|null} Updated material or null if not found
     */
    function update(id, changes) {
        const existing = materials.get(id);
        if (!existing) return null;

        const merged = normalizeMaterial({ ...existing, ...changes, id });
        merged.modifiedAt = Date.now();
        merged.createdAt = existing.createdAt;
        materials.set(id, merged);
        _save();
        _notify('updated', id);
        return merged;
    }

    /**
     * Delete a material by ID.
     * Built-in presets cannot be deleted.
     * @param {string} id
     * @returns {boolean}
     */
    function remove(id) {
        if (BUILTIN_PRESETS.some(p => p.id === id)) {
            console.warn('[MaterialLibrary] Cannot delete built-in preset:', id);
            return false;
        }
        if (!materials.has(id)) return false;
        materials.delete(id);
        _save();
        _notify('deleted', id);
        return true;
    }

    /**
     * Duplicate a material.
     * @param {string} id
     * @returns {Object|null} The new material
     */
    function duplicate(id) {
        const src = materials.get(id);
        if (!src) return null;
        const copy = { ...src };
        copy.id = '';
        copy.label = src.label + ' (Copy)';
        return create(copy);
    }

    /**
     * Get all materials as an array.
     * @returns {Object[]}
     */
    function getAll() {
        return Array.from(materials.values());
    }

    /**
     * Get number of materials.
     * @returns {number}
     */
    function count() {
        return materials.size;
    }

    /**
     * Subscribe to library changes.
     * @param {Function} callback - (event: 'created'|'updated'|'deleted', materialId: string) => void
     * @returns {Function} Unsubscribe function
     */
    function subscribe(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
    }

    /**
     * Export the full library as a JSON-serializable array.
     * @returns {Object[]}
     */
    function exportJSON() {
        return Array.from(materials.values());
    }

    /**
     * Import materials from a JSON array (merges, does not replace).
     * @param {Object[]} arr
     * @returns {number} Number of materials imported
     */
    function importJSON(arr) {
        if (!Array.isArray(arr)) return 0;
        let count = 0;
        for (const item of arr) {
            const mat = normalizeMaterial(item);
            if (!mat.id) mat.id = `mat_${_nextId++}`;
            materials.set(mat.id, mat);
            count++;
        }
        _save();
        _notify('imported', null);
        return count;
    }

    /**
     * Check if an ID belongs to a built-in preset.
     * @param {string} id
     * @returns {boolean}
     */
    function isBuiltin(id) {
        return BUILTIN_PRESETS.some(p => p.id === id);
    }

    // Initialize
    _load();
    console.log(`[MaterialLibrary] Initialized with ${materials.size} materials (${BUILTIN_PRESETS.length} built-in)`);

    return {
        create,
        get,
        update,
        remove,
        duplicate,
        getAll,
        count,
        subscribe,
        exportJSON,
        importJSON,
        isBuiltin,
        normalizeMaterial,
    };
}
