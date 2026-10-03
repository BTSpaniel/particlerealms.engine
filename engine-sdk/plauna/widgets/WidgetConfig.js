// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Widget Configuration System
 * 
 * Manages widget configurations, presets, and user preferences
 * Following the same pattern as the editor's theme system
 */

import { getAllWidgets, getWidget } from './index.js';

// ============================================================================
// CONFIGURATION STORAGE
// ============================================================================

const CONFIG_STORAGE_KEY = 'plauna_widget_config';
const USER_PRESETS_KEY = 'plauna_widget_presets';
export const WIDGET_CONFIG_SCHEMA = 'plauna.widget-config.v1';
export const WIDGET_CONFIG_SCHEMA_VERSION = 1;
const UNSAFE_COLLECTION_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export class UnsupportedWidgetConfigVersionError extends Error {
    constructor(kind) {
        super(`Unsupported widget ${kind} schema`);
        this.name = 'UnsupportedWidgetConfigVersionError';
    }
}

function assertObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
}

function prepareCollection(input, kind) {
    assertObject(input, `Widget ${kind}`);
    let entries = input;
    if (input.schema !== undefined) {
        if (input.schema !== WIDGET_CONFIG_SCHEMA || input.schemaVersion !== WIDGET_CONFIG_SCHEMA_VERSION) {
            throw new UnsupportedWidgetConfigVersionError(kind);
        }
        if (input.kind !== kind) throw new Error(`Expected widget ${kind}, received ${input.kind}`);
        entries = input.entries;
        assertObject(entries, `Widget ${kind} entries`);
    }
    const normalized = {};
    for (const [id, value] of Object.entries(entries)) {
        if (!id) throw new TypeError(`Widget ${kind} contains an empty id`);
        if (UNSAFE_COLLECTION_IDS.has(id)) throw new TypeError(`Widget ${kind} contains unsafe id: ${id}`);
        assertObject(value, `Widget ${kind} ${id}`);
        if (kind === 'configs' && value.widgetId !== undefined && value.widgetId !== id) {
            throw new Error(`Widget config id mismatch: ${id} != ${value.widgetId}`);
        }
        if (kind === 'presets' && value.id !== undefined && value.id !== id) {
            throw new Error(`Widget preset id mismatch: ${id} != ${value.id}`);
        }
        normalized[id] = { ...value };
    }
    return normalized;
}

function storageEnvelope(kind, entries) {
    return {
        schema: WIDGET_CONFIG_SCHEMA,
        schemaVersion: WIDGET_CONFIG_SCHEMA_VERSION,
        kind,
        entries: prepareCollection(entries, kind),
    };
}

export function prepareWidgetConfigImport(input) {
    assertObject(input, 'Widget config import');
    if (input.schema !== undefined &&
        (input.schema !== WIDGET_CONFIG_SCHEMA || input.schemaVersion !== WIDGET_CONFIG_SCHEMA_VERSION)) {
        throw new UnsupportedWidgetConfigVersionError('config import');
    }
    return {
        schema: WIDGET_CONFIG_SCHEMA,
        schemaVersion: WIDGET_CONFIG_SCHEMA_VERSION,
        configs: prepareCollection(input.configs ?? {}, 'configs'),
        presets: prepareCollection(input.presets ?? {}, 'presets'),
    };
}

// ============================================================================
// WIDGET CONFIG MANAGER
// ============================================================================

/**
 * WidgetConfigManager - Centralized configuration management for widgets.
 *
 * Architecture pattern:
 * - Singleton pattern ensures single source of truth for widget configs
 * - Map-based storage for O(1) lookup by widget ID
 * - localStorage persistence for user preferences across sessions
 * - Event listener pattern for reactive updates
 * - Preset system for reusable widget configurations
 *
 * Use cases:
 * - Store user-customized widget settings
 * - Share configurations across the application
 * - Export/import configurations for backup or sharing
 * - Provide preset configurations for common widget patterns
 */
class WidgetConfigManager {
    constructor() {
        this.configs = new Map();
        this.presets = new Map();
        this.listeners = new Set();
        this._suspendPersistence = false;
        this.loadFromStorage();
    }
    
    // ============================================================================
    // CONFIGURATION MANAGEMENT
    // ============================================================================
    
    /**
     * Register a widget configuration
     * @param {string} widgetId - Widget identifier
     * @param {Object} config - Configuration object
     */
    registerConfig(widgetId, config) {
        if (!getWidget(widgetId)) {
            console.warn(`[WidgetConfigManager] Unknown widget: ${widgetId}`);
            return false;
        }
        
        this.configs.set(widgetId, {
            ...config,
            widgetId,
            updatedAt: new Date().toISOString()
        });
        
        this.saveToStorage();
        this.notifyListeners('config-registered', { widgetId, config });
        return true;
    }
    
    /**
     * Get widget configuration
     * @param {string} widgetId - Widget identifier
     * @returns {Object|null} Configuration object
     */
    getConfig(widgetId) {
        return this.configs.get(widgetId) || null;
    }
    
    /**
     * Update widget configuration
     * @param {string} widgetId - Widget identifier
     * @param {Object} updates - Configuration updates
     */
    updateConfig(widgetId, updates) {
        const current = this.configs.get(widgetId) || {};
        const updated = {
            ...current,
            ...updates,
            widgetId,
            updatedAt: new Date().toISOString()
        };
        
        this.configs.set(widgetId, updated);
        this.saveToStorage();
        this.notifyListeners('config-updated', { widgetId, config: updated });
    }
    
    /**
     * Remove widget configuration
     * @param {string} widgetId - Widget identifier
     */
    removeConfig(widgetId) {
        const deleted = this.configs.delete(widgetId);
        if (deleted) {
            this.saveToStorage();
            this.notifyListeners('config-removed', { widgetId });
        }
        return deleted;
    }
    
    // ============================================================================
    // PRESET MANAGEMENT
    // ============================================================================
    
    /**
     * Create a widget preset
     * @param {string} presetId - Preset identifier
     * @param {Object} preset - Preset configuration
     */
    createPreset(presetId, preset) {
        this.presets.set(presetId, {
            ...preset,
            id: presetId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        
        this.saveToStorage();
        this.notifyListeners('preset-created', { presetId, preset });
    }
    
    /**
     * Get widget preset
     * @param {string} presetId - Preset identifier
     * @returns {Object|null} Preset configuration
     */
    getPreset(presetId) {
        return this.presets.get(presetId) || null;
    }
    
    /**
     * Get all presets for a widget
     * @param {string} widgetId - Widget identifier
     * @returns {Array} Array of presets
     */
    getWidgetPresets(widgetId) {
        return Array.from(this.presets.values())
            .filter(preset => preset.widgetId === widgetId);
    }
    
    /**
     * Get all presets
     * @returns {Array} Array of all presets
     */
    getAllPresets() {
        return Array.from(this.presets.values());
    }
    
    /**
     * Update preset
     * @param {string} presetId - Preset identifier
     * @param {Object} updates - Preset updates
     */
    updatePreset(presetId, updates) {
        const current = this.presets.get(presetId);
        if (!current) {
            console.warn(`[WidgetConfigManager] Unknown preset: ${presetId}`);
            return false;
        }
        
        const updated = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        
        this.presets.set(presetId, updated);
        this.saveToStorage();
        this.notifyListeners('preset-updated', { presetId, preset: updated });
        return true;
    }
    
    /**
     * Delete preset
     * @param {string} presetId - Preset identifier
     */
    deletePreset(presetId) {
        const deleted = this.presets.delete(presetId);
        if (deleted) {
            this.saveToStorage();
            this.notifyListeners('preset-deleted', { presetId });
        }
        return deleted;
    }
    
    // ============================================================================
    // BUILT-IN PRESETS
    // ============================================================================
    
    /**
     * Initialize built-in presets
     */
    initializeBuiltInPresets() {
        // Input widget presets
        this.createPreset('search-compact', {
            widgetId: 'search',
            name: 'Compact Search',
            description: 'Minimal search bar for tight spaces',
            config: {
                size: 'small',
                showIcon: true,
                showButton: false,
                placeholder: 'Search...'
            }
        });
        
        this.createPreset('search-full', {
            widgetId: 'search',
            name: 'Full Search',
            description: 'Complete search with suggestions and button',
            config: {
                size: 'medium',
                showIcon: true,
                showButton: true,
                showSuggestions: true,
                placeholder: 'Search widgets...',
                maxSuggestions: 8
            }
        });
        
        // Button presets
        this.createPreset('button-primary', {
            widgetId: 'button',
            name: 'Primary Button',
            description: 'Main action button with primary styling',
            config: {
                variant: 'primary',
                size: 'medium',
                fullWidth: false
            }
        });
        
        this.createPreset('button-danger', {
            widgetId: 'button',
            name: 'Danger Button',
            description: 'Destructive action button',
            config: {
                variant: 'danger',
                size: 'medium',
                fullWidth: false
            }
        });
        
        // Form presets
        this.createPreset('form-compact', {
            widgetId: 'checkbox',
            name: 'Compact Form',
            description: 'Space-efficient form controls',
            config: {
                size: 'small',
                compact: true
            }
        });
    }
    
    // ============================================================================
    // STORAGE MANAGEMENT
    // ============================================================================

    /**
     * Storage persistence pattern for widget configurations.
     *
     * Uses localStorage to persist user preferences:
     * - Configs: Individual widget settings (keyed by widget ID)
     * - Presets: Reusable configuration templates (keyed by preset ID)
     * - Automatic serialization/deserialization of Map objects
     * - Error handling for quota exceeded or corrupted data
     *
     * Storage keys:
     * - plauna_widget_config: Stores widget configurations
     * - plauna_widget_presets: Stores user-created presets
     */

    /**
     * Save configurations to localStorage.
     *
     * Persistence pattern:
     * - Converts Maps to plain objects for JSON serialization
     * - Separate storage keys for configs and presets
     * - Error handling for storage quota or serialization failures
     */
    saveToStorage(configs = this.configs, presets = this.presets) {
        if (this._suspendPersistence) return true;
        let previousConfigs = null;
        let previousPresets = null;
        try {
            const data = {
                configs: Object.fromEntries(configs),
                presets: Object.fromEntries(presets)
            };

            previousConfigs = localStorage.getItem(CONFIG_STORAGE_KEY);
            previousPresets = localStorage.getItem(USER_PRESETS_KEY);
            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(storageEnvelope('configs', data.configs)));
            localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(storageEnvelope('presets', data.presets)));
            return true;
        } catch (error) {
            try {
                if (previousConfigs === null) localStorage.removeItem(CONFIG_STORAGE_KEY);
                else localStorage.setItem(CONFIG_STORAGE_KEY, previousConfigs);
                if (previousPresets === null) localStorage.removeItem(USER_PRESETS_KEY);
                else localStorage.setItem(USER_PRESETS_KEY, previousPresets);
            } catch (_) {}
            console.error('[WidgetConfigManager] Failed to save to storage:', error);
            return false;
        }
    }
    
    /**
     * Load configurations from localStorage.
     *
     * Deserialization pattern:
     * - Reads from storage keys on initialization
     * - Converts plain objects back to Maps for O(1) lookup
     * - Initializes built-in presets if storage is empty
     * - Error handling for corrupted or missing data
     */
    loadFromStorage() {
        try {
            const configsData = localStorage.getItem(CONFIG_STORAGE_KEY);
            const presetsData = localStorage.getItem(USER_PRESETS_KEY);
            
            if (configsData) {
                const configs = prepareCollection(JSON.parse(configsData), 'configs');
                this.configs = new Map(Object.entries(configs));
            }
            
            if (presetsData) {
                const presets = prepareCollection(JSON.parse(presetsData), 'presets');
                this.presets = new Map(Object.entries(presets));
            }
            
            // Initialize built-in presets if empty
            if (this.presets.size === 0) {
                this.initializeBuiltInPresets();
            }
        } catch (error) {
            console.error('[WidgetConfigManager] Failed to load from storage:', error);
            this.configs = new Map();
            this.presets = new Map();
            // Keep invalid/future persisted documents intact for a newer build or recovery.
            this._suspendPersistence = true;
            try { this.initializeBuiltInPresets(); } finally { this._suspendPersistence = false; }
        }
    }
    
    // ============================================================================
    // EVENT MANAGEMENT
    // ============================================================================
    
    /**
     * Add event listener
     * @param {Function} callback - Event callback
     * @returns {Function} Remove listener function
     */
    addListener(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
    
    /**
     * Notify all listeners
     * @param {string} event - Event type
     * @param {Object} data - Event data
     */
    notifyListeners(event, data) {
        for (const listener of this.listeners) {
            try {
                listener(event, data);
            } catch (error) {
                console.error('[WidgetConfigManager] Listener error:', error);
            }
        }
    }
    
    // ============================================================================
    // UTILITY METHODS
    // ============================================================================
    
    /**
     * Get configuration statistics
     * @returns {Object} Statistics
     */
    getStats() {
        return {
            totalConfigs: this.configs.size,
            totalPresets: this.presets.size,
            presetsByWidget: (() => {
                const counts = {};
                for (const preset of this.presets.values()) {
                    counts[preset.widgetId] = (counts[preset.widgetId] || 0) + 1;
                }
                return counts;
            })()
        };
    }
    
    /**
     * Export all configurations
     * @returns {Object} Export data
     */
    exportConfigs() {
        return {
            schema: WIDGET_CONFIG_SCHEMA,
            schemaVersion: WIDGET_CONFIG_SCHEMA_VERSION,
            configs: Object.fromEntries(this.configs),
            presets: Object.fromEntries(this.presets),
            exportedAt: new Date().toISOString()
        };
    }
    
    /**
     * Import configurations
     * @param {Object} data - Import data
     */
    importConfigs(data) {
        const prepared = prepareWidgetConfigImport(data);
        const nextConfigs = new Map(this.configs);
        const nextPresets = new Map(this.presets);
        for (const [widgetId, config] of Object.entries(prepared.configs)) {
            nextConfigs.set(widgetId, config);
        }
        for (const [presetId, preset] of Object.entries(prepared.presets)) {
            nextPresets.set(presetId, preset);
        }
        if (!this.saveToStorage(nextConfigs, nextPresets)) {
            throw new Error('Widget configuration import could not be persisted');
        }
        this.configs = nextConfigs;
        this.presets = nextPresets;
        this.notifyListeners('configs-imported', prepared);
    }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

/**
 * Singleton export for WidgetConfigManager.
 *
 * Ensures a single instance is used throughout the application:
 * - Consistent configuration state across all components
 * - Single storage persistence point
 * - Centralized event notification system
 */
export const widgetConfigManager = new WidgetConfigManager();

export default widgetConfigManager;
