// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * ThemeLoader - File-Based Theme Discovery and Loading
 * ============================================================================
 *
 * ThemeLoader is a file-based theme system inspired by WordPress but modernized.
 * It loads themes from plauna/themes/{id}/theme.json and applies CSS variables.
 *
 * THEME STRUCTURE:
 * plauna/themes/
 * ├── _base/              # Base theme with all token defaults (required)
 * │   └── theme.json      # Defines every possible CSS variable
 * ├── dark/               # Dark theme (extends _base)
 * │   └── theme.json      # Only overrides what's different from _base
 * ├── light/              # Light theme (extends _base)
 * │   └── theme.json
 * ├── high-contrast/      # High contrast theme (extends dark)
 * │   └── theme.json
 * ├── custom/             # User starter template (extends dark)
 * │   └── theme.json
 * └── index.json          # Registry of discoverable themes
 *
 * THEME MANIFEST (theme.json):
 * {
 *   "name": "Theme Name",
 *   "description": "Theme description",
 *   "extends": "parent-theme-id",  // Optional: parent theme to inherit from
 *   "variables": {
 *     "color-primary": "#3b82f6",  // CSS variable name → value
 *     "spacing-md": "16px",
 *     // null or omitted values inherit from parent
 *   }
 * }
 *
 * THEME RESOLUTION CASCADE (highest priority wins):
 * 1. _base theme defaults (all variables defined)
 * 2. Parent theme variables (if extends is set)
 * 3. Current theme variables (overrides parent)
 * 4. Runtime overrides (applyOverrides() - per-session changes)
 *
 * CSS VARIABLE APPLICATION:
 * - Variables are written to <style data-plauna-theme="1"> tag on :root
 * - Format: --variable-name: value;
 * - Overrides use separate <style data-plauna-overrides="1"> tag
 *
 * REGISTRY (themes/index.json):
 * {
 *   "themes": ["dark", "light", "high-contrast", "custom"]
 * }
 * Add your theme folder name here to make it discoverable without code changes.
 *
 * METHODS:
 * - discover(): Load themes/index.json and return available theme IDs
 * - load(id): Load raw theme.json without resolving parent chain
 * - resolve(id): Resolve full theme with parent chain merged
 * - apply(id): Apply theme CSS variables to DOM
 * - applyOverrides(vars): Apply per-session variable overrides
 * - clearOverrides(): Remove runtime overrides
 * - listThemes(): Return theme metadata for all discoverable themes
 */

import {
    prepareThemeManifest,
    prepareThemeRegistry,
    prepareThemeVariables,
    validateThemeId,
} from './ThemeContracts.js';

const BASE_URL = new URL('./', import.meta.url).href;

/**
 * ThemeLoader - File-based theme discovery and loading.
 *
 * Theme loading pattern:
 * - Loads themes from plauna/themes/{id}/theme.json
 * - Supports theme extension via "extends" property
 * - Resolves parent chain with cascading variable inheritance
 * - Applies CSS variables to :root via style tags
 * - Caches resolved themes for performance
 *
 * Architecture:
 * - _cache: Resolved theme manifests (parent chain merged)
 * - _rawCache: Raw theme.json files
 * - _registry: Discoverable theme IDs from index.json
 * - _styleEl: CSS variable style tag
 * - _overrideEl: Runtime override style tag
 */
export class ThemeLoader {
    constructor() {
        this._cache = new Map();         // id → resolved manifest
        this._rawCache = new Map();      // id → raw manifest JSON
        this._registry = null;           // null until discover() is called
        this._styleEl = null;
        this._overrideEl = null;
    }

    // ── Discovery ─────────────────────────────────────────────────

/**
 * Discover available themes from themes/index.json.
 *
 * Discovery pattern:
 * - Loads themes/index.json registry
 * - Returns list of discoverable theme IDs
 * - Filters out _base (internal theme)
 * - Falls back to ['dark', 'light'] on error
 * - Caches registry for subsequent calls
 *
 * @returns {Promise<string[]>} Array of discoverable theme IDs
 */
async discover() {
        if (this._registry) return this._registry;
        try {
            const res = await fetch(`${BASE_URL}index.json`);
            if (!res.ok) throw new Error(`themes/index.json HTTP ${res.status}`);
            const data = prepareThemeRegistry(await res.json());
            this._registry = (data.themes || []).filter(id => id !== '_base');
        } catch (err) {
            console.warn('[ThemeLoader] Could not load themes/index.json:', err.message);
            this._registry = ['dark', 'light'];
        }
        return this._registry;
    }

    // ── Loading ───────────────────────────────────────────────────

/**
 * Load raw theme.json without resolving parent chain.
 *
 * Raw loading pattern:
 * - Fetches theme.json from plauna/themes/{id}/theme.json
 * - Caches raw manifest in _rawCache
 * - Returns unmodified JSON (no parent resolution)
 * - Throws error if theme not found
 *
 * @param {string} id - Theme ID
 * @returns {Promise<Object>} Raw theme manifest
 */
async _loadRaw(id) {
        validateThemeId(id);
        if (this._rawCache.has(id)) return this._rawCache.get(id);
        const url = `${BASE_URL}${id}/theme.json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Theme "${id}" not found at ${url} (HTTP ${res.status})`);
        const data = prepareThemeManifest(await res.json(), id);
        this._rawCache.set(id, data);
        return data;
    }

    /**
     * Fully resolve a theme by walking the extends chain.
     *
     * Resolution pattern:
     * - Recursively walks parent chain via "extends" property
     * - Falls back to _base if no explicit parent
     * - Merges variables with child values taking precedence
     * - Null/empty/undefined values inherit from parent
     * - Caches resolved manifest in _cache
     *
     * Cascade priority (highest wins):
     * 1. _base theme defaults
     * 2. Parent theme variables
     * 3. Current theme variables
     *
     * @param {string} id - Theme ID
     * @returns {Promise<{ meta: Object, vars: Object }>} Resolved theme with metadata and variables
     */
    async resolve(id, resolving = new Set()) {
        validateThemeId(id);
        if (this._cache.has(id)) return this._cache.get(id);
        if (resolving.has(id)) {
            throw new Error(`Theme inheritance cycle detected: ${[...resolving, id].join(' -> ')}`);
        }
        const nextResolving = new Set(resolving);
        nextResolving.add(id);

        const raw = await this._loadRaw(id);

        // Walk up the parent chain
        let parentVars = {};
        if (raw.extends) {
            const parent = await this.resolve(raw.extends, nextResolving);
            parentVars = parent.vars;
        } else if (id !== '_base') {
            // No explicit extends — fall back to _base
            const base = await this.resolve('_base', nextResolving);
            parentVars = base.vars;
        }

        // Merge: start with parent, then apply only non-null child values
        const vars = { ...parentVars };
        if (raw.vars) {
            for (const [key, value] of Object.entries(raw.vars)) {
                if (value !== null && value !== undefined && value !== '') {
                    vars[key] = value;
                }
                // null / '' / omitted → keep parent value (inherits naturally)
            }
        }

        const resolved = {
            meta: {
                id:          raw.id          || id,
                name:        raw.name        || id,
                description: raw.description || '',
                author:      raw.author      || 'Unknown',
                version:     raw.version     || '1.0.0',
                extends:     raw.extends     || null,
            },
            vars,
        };

        this._cache.set(id, resolved);
        return resolved;
    }

    // ── Application ───────────────────────────────────────────────

/**
 * Apply resolved theme variables to :root as CSS custom properties.
 *
 * CSS variable application pattern:
 * - Creates <style data-plauna-theme="1"> tag if not exists
 * - Writes variables as :root { --name: value; }
 * - Sets data-theme attribute on document.documentElement
 * - Replaces existing content on subsequent calls
 *
 * @param {Object} resolved - Resolved theme output from resolve()
 */
_applyVars(resolved) {
        if (!this._styleEl) {
            this._styleEl = document.createElement('style');
            this._styleEl.setAttribute('data-plauna-theme', '1');
            document.head.appendChild(this._styleEl);
        }
        const css = `:root {\n${
            Object.entries(resolved.vars)
                .map(([k, v]) => `  ${k}: ${v};`)
                .join('\n')
        }\n}`;
        this._styleEl.textContent = css;
        document.documentElement.setAttribute('data-theme', resolved.meta.id);
    }

    /**
 * Load, resolve, and apply a theme by ID.
 *
 * Theme application pattern:
 * - Resolves theme with parent chain
 * - Applies CSS variables to :root
 * - Sets data-theme attribute
 * - Returns resolved theme for reference
 *
 * @param {string} id - Theme ID
 * @returns {Promise<Object>} Resolved theme
 */
async apply(id) {
        const resolved = await this.resolve(id);
        this._applyVars(resolved);
        return resolved;
    }

    // ── Runtime overrides ─────────────────────────────────────────

    /**
     * Apply per-session CSS variable overrides on top of the active theme.
     *
     * Override pattern:
     * - Creates <style data-plauna-overrides="1"> tag if not exists
     * - Overrides win over all theme variables (highest priority)
     * - Useful for user customization panels and runtime adjustments
     * - Separate style tag for easy clearing
     *
     * Priority cascade (highest wins):
     * 1. Runtime overrides (applyOverrides)
     * 2. Current theme variables
     * 3. Parent theme variables
     * 4. _base theme defaults
     *
     * @param {Object} vars - CSS variable overrides { '--bg-primary': '#ff0000', ... }
     */
    applyOverrides(vars) {
        vars = prepareThemeVariables(vars, { allowNull: false });
        if (!this._overrideEl) {
            this._overrideEl = document.createElement('style');
            this._overrideEl.setAttribute('data-plauna-overrides', '1');
            document.head.appendChild(this._overrideEl);
        }
        const css = `:root {\n${
            Object.entries(vars)
                .filter(([, v]) => v !== null && v !== '')
                .map(([k, v]) => `  ${k}: ${v};`)
                .join('\n')
        }\n}`;
        this._overrideEl.textContent = css;
    }

/**
 * Clear all runtime CSS variable overrides.
 *
 * Clear pattern:
 * - Clears content of override style tag
 * - Restores theme to its original state
 * - Does not remove the style tag (for reuse)
 */
clearOverrides() {
        if (this._overrideEl) this._overrideEl.textContent = '';
    }

// ── Introspection ─────────────────────────────────────────────

/**
 * Return metadata for all registered themes.
 *
 * Introspection pattern:
 * - Discovers available themes
 * - Loads raw manifests (no parent resolution)
 * - Returns metadata without full variable resolution
 * - Useful for theme selectors and UI
 *
 * @returns {Promise<Object[]>} Array of theme metadata objects
 */
async listThemes() {
        const ids = await this.discover();
        const results = [];
        for (const id of ids) {
            try {
                const raw = await this._loadRaw(id);
                results.push({
                    id:          raw.id          || id,
                    name:        raw.name        || id,
                    description: raw.description || '',
                    author:      raw.author      || 'Unknown',
                    extends:     raw.extends     || null,
                });
            } catch {
                // Theme folder exists in index but files are missing — skip silently
            }
        }
        return results;
    }

    /**
     * Return all CSS var names defined in _base (the full variable catalogue).
     * @returns {Promise<string[]>}
     */
    async listVars() {
        const base = await this.resolve('_base');
        return Object.keys(base.vars);
    }
}

export const themeLoader = new ThemeLoader();
