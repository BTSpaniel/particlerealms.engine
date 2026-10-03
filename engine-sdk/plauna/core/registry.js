// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlaunaRegistry - Registry for views, surfaces, and templates.
 *
 * Registry pattern:
 * - Centralized registration system for UI components
 * - Follows existing engine registry patterns
 * - Supports views, surfaces, templates, and factories
 * - Warns on duplicate registrations (overwrites)
 * - Provides getters for retrieving registered items
 *
 * Registry types:
 * - views: UI view configurations with render mode, size, closability
 * - surfaces: Surface definitions for GPU rendering (viewport, texture)
 * - templates: Reusable template configurations
 * - factories: Factory functions for component instantiation
 */
export class PlaunaRegistry {
    constructor() {
        this.views = new Map();
        this.surfaces = new Map();
        this.templates = new Map();
        this.factories = new Map();
    }

    registerView(id, config) {
        if (this.views.has(id)) {
            console.warn(`[Plauna] View ${id} already registered, overwriting`);
        }

        const viewConfig = {
            id,
            title: config.title || id,
            renderMode: config.renderMode || 'dom',
            factory: config.factory,
            closable: config.closable !== false,
            minSize: config.minSize || { w: 240, h: 120 },
            defaultSize: config.defaultSize || { w: 320, h: 240 },
            ...config
        };

        this.views.set(id, viewConfig);
        console.log(`[Plauna] Registered view: ${id} (${viewConfig.renderMode})`);
        return viewConfig;
    }

    registerSurface(id, config) {
        if (this.surfaces.has(id)) {
            console.warn(`[Plauna] Surface ${id} already registered, overwriting`);
        }

        const surfaceConfig = {
            id,
            kind: config.kind || 'viewport',
            source: config.source,
            shape: config.shape || 'rect',
            warp: config.warp || 'none',
            interactive: config.interactive !== false,
            ...config
        };

        this.surfaces.set(id, surfaceConfig);
        console.log(`[Plauna] Registered surface: ${id} (${surfaceConfig.kind})`);
        return surfaceConfig;
    }

    registerTemplate(id, template) {
        if (this.templates.has(id)) {
            console.warn(`[Plauna] Template ${id} already registered, overwriting`);
        }

        this.templates.set(id, template);
        console.log(`[Plauna] Registered template: ${id}`);
        return template;
    }

    registerFactory(id, factory) {
        if (this.factories.has(id)) {
            console.warn(`[Plauna] Factory ${id} already registered, overwriting`);
        }

        this.factories.set(id, factory);
        console.log(`[Plauna] Registered factory: ${id}`);
        return factory;
    }

    getView(id) {
        return this.views.get(id);
    }

    getSurface(id) {
        return this.surfaces.get(id);
    }

    getTemplate(id) {
        return this.templates.get(id);
    }

    getFactory(id) {
        return this.factories.get(id);
    }

    getAllViews() {
        return Array.from(this.views.values());
    }

    getAllSurfaces() {
        return Array.from(this.surfaces.values());
    }

    hasView(id) {
        return this.views.has(id);
    }

    hasSurface(id) {
        return this.surfaces.has(id);
    }

    unregisterView(id) {
        const removed = this.views.delete(id);
        if (removed) {
            console.log(`[Plauna] Unregistered view: ${id}`);
        }
        return removed;
    }

    unregisterSurface(id) {
        const removed = this.surfaces.delete(id);
        if (removed) {
            console.log(`[Plauna] Unregistered surface: ${id}`);
        }
        return removed;
    }

    clear() {
        this.views.clear();
        this.surfaces.clear();
        this.templates.clear();
        this.factories.clear();
        console.log('[Plauna] Registry cleared');
    }
}
