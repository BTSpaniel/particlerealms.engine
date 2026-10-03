// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VariationGenerator.js — Automatic Sound Variation System
 * 
 * Takes any parametric sound definition and generates N unique variations
 * by randomizing parameters within user-defined ranges. Works with:
 *   - SfxGenerator params
 *   - FM synthesis configs
 *   - Karplus-Strong configs
 *   - Any flat parameter object
 *
 * Also provides batch rendering to AudioBuffer arrays and
 * a sound palette system for saving/loading favorites.
 *
 * Usage:
 *   import { createVariationConfig, generateVariations, renderVariationBatch } from './VariationGenerator.js';
 *   const vc = createVariationConfig(baseParams, { startFrequency: 0.1, decayTime: 0.05 });
 *   const variations = generateVariations(vc, 20);
 *   const buffers = await renderVariationBatch(ctx, variations, renderFn);
 */

import { byteSignature } from '../../core/math/FormatMath.js';
import { uniformDistribution } from '../../core/math/MathRandom.js';
import { createBrowserRecordContract } from '../../core/schema/BrowserRecordContract.js';

// ============================================================================
// VARIATION CONFIG
// ============================================================================

/**
 * Create a variation configuration.
 * @param {Object} baseParams - Base parameter object (e.g., from createSfxParams)
 * @param {Object} ranges - Per-key random range amounts (absolute ±). Keys must match baseParams.
 * @param {Object} options
 * @param {boolean} options.clampToBase - If true, variations stay within [base-range, base+range]. Otherwise unclamped.
 * @param {Object} options.limits - Per-key [min, max] clamp limits
 * @returns {Object} Variation config
 */
export function createVariationConfig(baseParams, ranges = {}, options = {}) {
    return {
        base: { ...baseParams },
        ranges: { ...ranges },
        clampToBase: options.clampToBase ?? true,
        limits: options.limits || {},
        lockedKeys: new Set(options.lockedKeys || []), // keys that won't be varied
    };
}

/**
 * Create a variation config from a SoundSchema.
 * Auto-derives ranges and limits from the schema definition.
 * @param {Object} baseParams - Base parameter object
 * @param {Object} schema - Schema from SoundSchema.js (e.g., SFX_SCHEMA)
 * @param {number} proportion - Fraction of full range to vary (default 0.1 = 10%)
 * @param {Object} options - { lockedKeys }
 * @returns {Object} Variation config
 */
export function createVariationConfigFromSchema(baseParams, schema, proportion = 0.1, options = {}) {
    const ranges = {};
    const limits = {};

    for (const [key, def] of Object.entries(schema)) {
        if (key === '_meta') continue;
        if (def.type === 'float' || def.type === 'int') {
            ranges[key] = (def.max - def.min) * proportion;
            limits[key] = [def.min, def.max];
        }
        // enums, bools, strings are not varied by default
    }

    return {
        base: { ...baseParams },
        ranges,
        clampToBase: false, // use schema limits instead
        limits,
        lockedKeys: new Set(options.lockedKeys || []),
    };
}

/**
 * Lock a parameter so it won't be varied.
 * @param {Object} vc - Variation config
 * @param {string} key
 */
export function lockParam(vc, key) {
    vc.lockedKeys.add(key);
}

/**
 * Unlock a parameter for variation.
 * @param {Object} vc - Variation config
 * @param {string} key
 */
export function unlockParam(vc, key) {
    vc.lockedKeys.delete(key);
}

/**
 * Set the random range for a specific parameter.
 * @param {Object} vc
 * @param {string} key
 * @param {number} range - Absolute ± range
 */
export function setRange(vc, key, range) {
    vc.ranges[key] = range;
}

/**
 * Set per-key min/max limits.
 * @param {Object} vc
 * @param {string} key
 * @param {number} min
 * @param {number} max
 */
export function setLimits(vc, key, min, max) {
    vc.limits[key] = [min, max];
}

// ============================================================================
// GENERATION
// ============================================================================

/**
 * Generate N parameter variations from a variation config.
 * @param {Object} vc - Variation config from createVariationConfig
 * @param {number} count - Number of variations to generate
 * @returns {Object[]} Array of parameter objects
 */
export function generateVariations(vc, count = 10) {
    const results = [];
    for (let i = 0; i < count; i++) {
        results.push(_generateOne(vc));
    }
    return results;
}

function _generateOne(vc) {
    const result = { ...vc.base };

    for (const key of Object.keys(vc.ranges)) {
        if (vc.lockedKeys.has(key)) continue;
        if (!(key in result)) continue;

        const base = vc.base[key];
        const range = vc.ranges[key];

        // Skip non-numeric
        if (typeof base !== 'number') continue;

        let value = uniformDistribution(base - range, base + range, Math.random);

        // Apply limits
        if (vc.limits[key]) {
            const [min, max] = vc.limits[key];
            value = Math.max(min, Math.min(max, value));
        } else if (vc.clampToBase) {
            value = Math.max(base - range, Math.min(base + range, value));
        }

        result[key] = value;
    }

    return result;
}

/**
 * Generate a single variation.
 * @param {Object} vc
 * @returns {Object}
 */
export function generateOneVariation(vc) {
    return _generateOne(vc);
}

// ============================================================================
// BATCH RENDER
// ============================================================================

/**
 * Render an array of parameter variations to AudioBuffers.
 * @param {AudioContext} ctx
 * @param {Object[]} paramsList - Array of parameter objects
 * @param {Function} renderFn - Render function: (ctx, params) => AudioBuffer
 * @returns {AudioBuffer[]}
 */
export function renderVariationBatch(ctx, paramsList, renderFn) {
    return paramsList.map(params => renderFn(ctx, params));
}

/**
 * Render variations async (yields between each to avoid blocking).
 * @param {AudioContext} ctx
 * @param {Object[]} paramsList
 * @param {Function} renderFn
 * @param {Function} onProgress - (index, total) callback
 * @returns {Promise<AudioBuffer[]>}
 */
export async function renderVariationBatchAsync(ctx, paramsList, renderFn, onProgress = null) {
    const results = [];
    for (let i = 0; i < paramsList.length; i++) {
        results.push(renderFn(ctx, paramsList[i]));
        if (onProgress) onProgress(i + 1, paramsList.length);
        // Yield to main thread every 5 renders
        if (i % 5 === 4) {
            await new Promise(r => setTimeout(r, 0));
        }
    }
    return results;
}

// ============================================================================
// SOUND PALETTE (save/load favorites)
// ============================================================================

const PALETTE_STORAGE_KEY = 'engine_sound_palette';
export const SOUND_PALETTE_SCHEMA = 'engine.sound-palette';
export const SOUND_PALETTE_SCHEMA_VERSION = 2;

const soundPaletteStorage = createBrowserRecordContract({
    schema: SOUND_PALETTE_SCHEMA,
    legacyKey: PALETTE_STORAGE_KEY,
    currentKey: `${PALETTE_STORAGE_KEY}.v2`,
    payloadKey: 'palette',
    maxBytes: 4 * 1024 * 1024,
    validate: value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        && Array.isArray(value.entries) && value.entries.length <= 10000,
});

export function readSoundPaletteRecord(storage = globalThis.localStorage) {
    return soundPaletteStorage.read(storage);
}

export function writeSoundPaletteRecord(palette, storage = globalThis.localStorage) {
    return soundPaletteStorage.write(palette, storage);
}
let _paletteEntrySequence = 0;

function _newPaletteEntryId() {
    const cryptoApi = globalThis.crypto;
    let randomPart = '';
    try {
        if (typeof cryptoApi?.randomUUID === 'function') {
            randomPart = cryptoApi.randomUUID().replace(/-/g, '').slice(0, 12);
        } else if (typeof cryptoApi?.getRandomValues === 'function') {
            const bytes = new Uint8Array(6);
            cryptoApi.getRandomValues(bytes);
            randomPart = byteSignature(bytes);
        }
    } catch { /* use the deterministic local fallback below */ }
    if (!randomPart) {
        randomPart = `${Date.now().toString(36)}-${(++_paletteEntrySequence).toString(36)}`;
    }
    return `snd_${Date.now()}_${randomPart}`;
}

/**
 * Create a sound palette for organizing favorite sounds.
 * @returns {Object}
 */
export function createSoundPalette() {
    return {
        entries: [], // { id, name, category, params, tags, createdAt }
    };
}

/**
 * Add a sound to the palette.
 * @param {Object} palette
 * @param {Object} entry
 * @param {string} entry.name
 * @param {string} entry.category - e.g., 'sfx', 'fm', 'karplus', 'blend'
 * @param {Object} entry.params - The parameter object
 * @param {string[]} entry.tags - Optional tags
 * @returns {string} Entry ID
 */
export function addToPalette(palette, entry) {
    const id = _newPaletteEntryId();
    palette.entries.push({
        id,
        name: entry.name || 'Untitled',
        category: entry.category || 'sfx',
        params: { ...entry.params },
        tags: entry.tags || [],
        createdAt: Date.now(),
    });
    return id;
}

/**
 * Remove a sound from the palette.
 * @param {Object} palette
 * @param {string} id
 */
export function removeFromPalette(palette, id) {
    palette.entries = palette.entries.filter(e => e.id !== id);
}

/**
 * Find sounds in the palette by category or tag.
 * @param {Object} palette
 * @param {Object} query - { category?, tag?, name? }
 * @returns {Object[]}
 */
export function searchPalette(palette, query = {}) {
    return palette.entries.filter(e => {
        if (query.category && e.category !== query.category) return false;
        if (query.tag && !e.tags.includes(query.tag)) return false;
        if (query.name && !e.name.toLowerCase().includes(query.name.toLowerCase())) return false;
        return true;
    });
}

/**
 * Save palette to localStorage.
 * @param {Object} palette
 */
export function savePalette(palette, storage = globalThis.localStorage) {
    try {
        writeSoundPaletteRecord(palette, storage);
        return true;
    } catch (e) {
        console.warn('[SoundPalette] Save blocked:', e?.code || e);
        return false;
    }
}

/**
 * Load palette from localStorage.
 * @returns {Object}
 */
export function loadPalette(storage = globalThis.localStorage) {
    try {
        return readSoundPaletteRecord(storage) || createSoundPalette();
    } catch (e) {
        console.warn('[SoundPalette] Load failed:', e?.code || e);
    }
    return createSoundPalette();
}

/**
 * Export palette as JSON string (for sharing/backup).
 * @param {Object} palette
 * @returns {string}
 */
export function exportPalette(palette) {
    return JSON.stringify(palette, null, 2);
}

/**
 * Import palette from JSON string.
 * @param {string} json
 * @returns {Object}
 */
export function importPalette(json) {
    try {
        const data = JSON.parse(json);
        if (data.entries && Array.isArray(data.entries)) return data;
    } catch { /* */ }
    return createSoundPalette();
}
