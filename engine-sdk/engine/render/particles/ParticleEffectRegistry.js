// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleEffectRegistry.js - Custom Particle Effect Storage & Management
 * 
 * Features:
 * - IndexedDB persistence across sessions
 * - Import/export as JSON files
 * - Built-in presets always available
 * - Version tracking for effect updates
 * - Event-based notifications for changes
 */

import { EFFECT_PRESETS, validateEffect, createEffect, cloneEffect, createImportedEffectId } from './CustomParticleEffect.js';

// ============================================================================
// INDEXEDDB CONFIGURATION
// ============================================================================

export const PARTICLE_EFFECT_DB_NAME = 'ParticleEffectRegistry';
const DB_VERSION = 1;
export const PARTICLE_EFFECT_STORE_NAME = 'effects';
export const PARTICLE_EFFECT_RECORD_SCHEMA = 'engine.particle-effect-record';
export const PARTICLE_EFFECT_RECORD_VERSION = 2;
export const PARTICLE_EFFECT_RECORD_LIMITS = Object.freeze({ maxRecords: 10000, maxBytes: 4 * 1024 * 1024 });

const CURRENT_ID_PREFIX = '__particle_effect_schema_v2__:';
const ENCODER = new TextEncoder();

function _serializedEffect(effect) {
  let json;
  try {
    json = JSON.stringify(effect);
  } catch (_) {
    throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
  }
  if (typeof json !== 'string' || ENCODER.encode(json).byteLength > PARTICLE_EFFECT_RECORD_LIMITS.maxBytes) {
    throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
  }
  return json;
}

function _validatedEffect(effect) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)
    || typeof effect.id !== 'string' || !effect.id
    || effect.id.startsWith(CURRENT_ID_PREFIX)
    || !validateEffect(effect).valid) {
    throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
  }
  _serializedEffect(effect);
  return effect;
}

export function particleEffectCurrentId(effectId) {
  if (typeof effectId !== 'string' || !effectId || effectId.startsWith(CURRENT_ID_PREFIX)) {
    throw new TypeError('invalid particle effect ID');
  }
  return `${CURRENT_ID_PREFIX}${effectId}`;
}

/** Validate one exact v1/v2 record; no lossy upcasts are attempted. */
export function prepareParticleEffectRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
  }

  const currentId = typeof record.id === 'string' && record.id.startsWith(CURRENT_ID_PREFIX);
  const hasEnvelopeMarker = Object.hasOwn(record, 'schema') || Object.hasOwn(record, 'schemaVersion');
  if (!currentId && !hasEnvelopeMarker) {
    const effect = _validatedEffect(record);
    return { version: 1, effect, storageId: effect.id, legacySnapshot: null };
  }

  if (!currentId || record.schema !== PARTICLE_EFFECT_RECORD_SCHEMA || !Number.isSafeInteger(record.schemaVersion)) {
    throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
  }
  if (record.schemaVersion > PARTICLE_EFFECT_RECORD_VERSION) {
    throw new Error('FUTURE_PARTICLE_EFFECT_RECORD_VERSION');
  }
  const effect = _validatedEffect(record.effect);
  const expectedId = particleEffectCurrentId(effect.id);
  if (record.schemaVersion !== PARTICLE_EFFECT_RECORD_VERSION
    || record.id !== expectedId
    || typeof record.legacySnapshot !== 'string'
    || ENCODER.encode(record.legacySnapshot).byteLength > PARTICLE_EFFECT_RECORD_LIMITS.maxBytes
    || record.legacySnapshot !== _serializedEffect(effect)) {
    throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
  }
  return {
    version: PARTICLE_EFFECT_RECORD_VERSION,
    effect,
    storageId: record.id,
    legacySnapshot: record.legacySnapshot,
  };
}

// ============================================================================
// PARTICLE EFFECT REGISTRY
// ============================================================================

export class ParticleEffectRegistry {
  constructor() {
    this._db = null;
    this._cache = new Map();
    this._listeners = new Set();
    this._initialized = false;
  }

  /**
   * Initialize the registry (opens IndexedDB)
   */
  async initialize() {
    if (this._initialized) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PARTICLE_EFFECT_DB_NAME, DB_VERSION);
      let blocked = false;
      
      request.onerror = () => {
        console.error('[ParticleEffectRegistry] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onblocked = () => {
        blocked = true;
        reject(new Error('PARTICLE_EFFECT_DATABASE_BLOCKED'));
      };
      
      request.onsuccess = () => {
        this._db = request.result;
        this._db.onversionchange = () => {
          this._db?.close();
          this._db = null;
          this._initialized = false;
        };
        if (blocked) {
          this._db.close();
          this._db = null;
          return;
        }
        this._loadAllToCache().then(() => {
          this._initialized = true;
          resolve();
        }).catch(error => {
          this._db?.close();
          this._db = null;
          reject(error);
        });
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains(PARTICLE_EFFECT_STORE_NAME)) {
          const store = db.createObjectStore(PARTICLE_EFFECT_STORE_NAME, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('version', 'version', { unique: false });
          store.createIndex('isBuiltin', 'isBuiltin', { unique: false });
        }
      };
    });
  }

  /**
   * Load all effects from IndexedDB to cache
   */
  async _loadAllToCache() {
    if (!this._db) return;
    
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(PARTICLE_EFFECT_STORE_NAME, 'readonly');
      const store = tx.objectStore(PARTICLE_EFFECT_STORE_NAME);
      const request = store.getAll();
      let nextCache = null;
      let preparationError = null;

      request.onsuccess = () => {
        try {
          if (request.result.length > PARTICLE_EFFECT_RECORD_LIMITS.maxRecords) {
            throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
          }
          const legacy = new Map();
          const current = new Map();
          for (const record of request.result) {
            const prepared = prepareParticleEffectRecord(record);
            const target = prepared.version === PARTICLE_EFFECT_RECORD_VERSION ? current : legacy;
            if (target.has(prepared.effect.id)) throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
            target.set(prepared.effect.id, prepared);
          }

          nextCache = new Map();
          for (const [id, preset] of Object.entries(EFFECT_PRESETS)) {
            nextCache.set(id, { ...preset, isBuiltin: true });
          }
          for (const id of new Set([...legacy.keys(), ...current.keys()])) {
            const oldRecord = legacy.get(id) || null;
            const newRecord = current.get(id) || null;
            const oldWriterChanged = Boolean(oldRecord && newRecord)
              && newRecord.legacySnapshot !== _serializedEffect(oldRecord.effect);
            const effect = oldWriterChanged ? oldRecord.effect : (newRecord?.effect ?? oldRecord?.effect);
            nextCache.set(id, effect);
          }
        } catch (error) {
          preparationError = error;
          tx.abort();
        }
      };
      
      request.onerror = () => { preparationError = request.error; };
      tx.oncomplete = () => {
        this._cache = nextCache;
        resolve();
      };
      tx.onabort = () => reject(preparationError || tx.error || new Error('PARTICLE_EFFECT_READ_ABORTED'));
      tx.onerror = () => {};
    });
  }

  /**
   * Get all effects (built-in + custom)
   */
  getAll() {
    const all = [];
    
    // Add built-in presets
    for (const preset of Object.values(EFFECT_PRESETS)) {
      if (!this._cache.has(preset.id)) {
        all.push({ ...preset, isBuiltin: true });
      }
    }
    
    // Add cached effects
    for (const effect of this._cache.values()) {
      all.push(effect);
    }
    
    return all.sort((a, b) => {
      // Built-ins first, then alphabetical
      if (a.isBuiltin !== b.isBuiltin) return a.isBuiltin ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get built-in presets only
   */
  getPresets() {
    return Object.values(EFFECT_PRESETS);
  }

  /**
   * Get custom (user-created) effects only
   */
  getCustomEffects() {
    return this.getAll().filter(e => !e.isBuiltin);
  }

  /**
   * Get effect by ID
   */
  get(id) {
    if (this._cache.has(id)) {
      return this._cache.get(id);
    }
    
    // Fallback to built-in
    if (EFFECT_PRESETS[id]) {
      return { ...EFFECT_PRESETS[id], isBuiltin: true };
    }
    
    return null;
  }

  /**
   * Check if effect exists
   */
  has(id) {
    return this._cache.has(id) || !!EFFECT_PRESETS[id];
  }

  /**
   * Save effect to registry
   */
  async save(effect) {
    const validation = validateEffect(effect);
    if (!validation.valid) {
      throw new Error(`Invalid effect: ${validation.errors.join(', ')}`);
    }
    
    // Update version if overwriting
    const existing = this._cache.get(effect.id);
    const nextEffect = { ...effect };
    if (existing) {
      nextEffect.version = (existing.version || 0) + 1;
    } else {
      nextEffect.version = effect.version || 1;
    }
    
    nextEffect.updatedAt = Date.now();
    nextEffect.isBuiltin = false; // User-saved effects are never built-in
    
    if (this._db) {
      await this._saveToDb(nextEffect);
    }

    Object.assign(effect, nextEffect);
    this._cache.set(effect.id, effect);
    
    // Notify listeners
    this._notifyListeners('save', effect);
    
    return effect;
  }

  /**
   * Save to IndexedDB
   */
  async _saveToDb(effect) {
    _validatedEffect(effect);
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(PARTICLE_EFFECT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PARTICLE_EFFECT_STORE_NAME);
      const currentId = particleEffectCurrentId(effect.id);
      const legacyRequest = store.get(effect.id);
      const currentRequest = store.get(currentId);
      let legacyResult;
      let currentResult;
      let preflightError = null;
      let pending = 2;

      const preflightAndWrite = () => {
        pending -= 1;
        if (pending !== 0) return;
        try {
          if (legacyResult !== undefined) prepareParticleEffectRecord(legacyResult);
          if (currentResult !== undefined) {
            const current = prepareParticleEffectRecord(currentResult);
            if (current.version !== PARTICLE_EFFECT_RECORD_VERSION) {
              throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
            }
          }
          const legacySnapshot = _serializedEffect(effect);
          store.put(effect);
          store.put({
            id: currentId,
            schema: PARTICLE_EFFECT_RECORD_SCHEMA,
            schemaVersion: PARTICLE_EFFECT_RECORD_VERSION,
            effect,
            legacySnapshot,
          });
        } catch (error) {
          preflightError = error;
          tx.abort();
        }
      };

      legacyRequest.onsuccess = () => { legacyResult = legacyRequest.result; preflightAndWrite(); };
      currentRequest.onsuccess = () => { currentResult = currentRequest.result; preflightAndWrite(); };
      legacyRequest.onerror = () => { preflightError = legacyRequest.error; };
      currentRequest.onerror = () => { preflightError = currentRequest.error; };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(preflightError || tx.error || new Error('PARTICLE_EFFECT_WRITE_ABORTED'));
      tx.onerror = () => {};
    });
  }

  /**
   * Delete effect from registry
   */
  async delete(id) {
    if (this._db) {
      await this._deleteFromDb(id);
    }

    if (EFFECT_PRESETS[id]) {
      // Can't delete built-in, but can remove user override
      if (this._cache.has(id) && !this._cache.get(id).isBuiltin) {
        this._cache.delete(id);
        // Re-add the built-in
        this._cache.set(id, { ...EFFECT_PRESETS[id], isBuiltin: true });
      }
    } else {
      this._cache.delete(id);
    }
    
    // Notify listeners
    this._notifyListeners('delete', { id });
  }

  /**
   * Delete from IndexedDB
   */
  async _deleteFromDb(id) {
    const currentId = particleEffectCurrentId(id);
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(PARTICLE_EFFECT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PARTICLE_EFFECT_STORE_NAME);
      const legacyRequest = store.get(id);
      const currentRequest = store.get(currentId);
      let legacyResult;
      let currentResult;
      let preflightError = null;
      let pending = 2;

      const preflightAndDelete = () => {
        pending -= 1;
        if (pending !== 0) return;
        try {
          if (legacyResult !== undefined) prepareParticleEffectRecord(legacyResult);
          if (currentResult !== undefined) {
            const current = prepareParticleEffectRecord(currentResult);
            if (current.version !== PARTICLE_EFFECT_RECORD_VERSION) {
              throw new Error('CORRUPT_PARTICLE_EFFECT_RECORD');
            }
          }
          store.delete(id);
          store.delete(currentId);
        } catch (error) {
          preflightError = error;
          tx.abort();
        }
      };

      legacyRequest.onsuccess = () => { legacyResult = legacyRequest.result; preflightAndDelete(); };
      currentRequest.onsuccess = () => { currentResult = currentRequest.result; preflightAndDelete(); };
      legacyRequest.onerror = () => { preflightError = legacyRequest.error; };
      currentRequest.onerror = () => { preflightError = currentRequest.error; };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(preflightError || tx.error || new Error('PARTICLE_EFFECT_DELETE_ABORTED'));
      tx.onerror = () => {};
    });
  }

  /**
   * Create a new effect from scratch
   */
  create(options = {}) {
    return createEffect(options);
  }

  /**
   * Clone an existing effect
   */
  clone(id, newId) {
    const effect = this.get(id);
    if (!effect) {
      throw new Error(`Effect not found: ${id}`);
    }
    return cloneEffect(effect, newId);
  }

  /**
   * Export effect as JSON
   */
  exportJSON(id) {
    const effect = this.get(id);
    if (!effect) {
      throw new Error(`Effect not found: ${id}`);
    }
    
    return JSON.stringify({
      ...effect,
      exportedAt: Date.now(),
      exportVersion: 1,
    }, null, 2);
  }

  /**
   * Export all custom effects as JSON
   */
  exportAllJSON() {
    const effects = this.getCustomEffects();
    return JSON.stringify({
      effects,
      exportedAt: Date.now(),
      exportVersion: 1,
    }, null, 2);
  }

  /**
   * Import effect from JSON
   */
  async importJSON(json) {
    let data;
    try {
      data = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (e) {
      throw new Error(`Invalid JSON: ${e.message}`);
    }
    
    // Handle single effect or array
    const effects = data.effects || [data];
    const imported = [];
    
    for (const effect of effects) {
      // Generate new ID if collision
      let id = effect.id;
      if (this.has(id) && !this.get(id).isBuiltin) {
        id = createImportedEffectId(effect.id);
      }
      
      const newEffect = {
        ...effect,
        id,
        isBuiltin: false,
        importedAt: Date.now(),
      };
      
      await this.save(newEffect);
      imported.push(newEffect);
    }
    
    return imported;
  }

  /**
   * Reset effect to built-in default
   */
  async resetToDefault(id) {
    if (!EFFECT_PRESETS[id]) {
      throw new Error(`No built-in preset for: ${id}`);
    }
    
    await this.delete(id);
    return this.get(id);
  }

  /**
   * Clear all custom effects
   */
  async clearAll() {
    const custom = this.getCustomEffects();
    for (const effect of custom) {
      await this.delete(effect.id);
    }
  }

  /**
   * Subscribe to registry changes
   */
  subscribe(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  /**
   * Notify listeners of changes
   */
  _notifyListeners(type, data) {
    for (const listener of this._listeners) {
      try {
        listener({ type, data, timestamp: Date.now() });
      } catch (e) {
        console.error('[ParticleEffectRegistry] Listener error:', e);
      }
    }
  }

  /**
   * Search effects by name or description
   */
  search(query) {
    const q = query.toLowerCase();
    return this.getAll().filter(e => 
      e.name.toLowerCase().includes(q) ||
      (e.description && e.description.toLowerCase().includes(q))
    );
  }

  /**
   * Get effects by category (based on name/description keywords)
   */
  getByCategory(category) {
    const categories = {
      fire: ['fire', 'flame', 'burn', 'explosion', 'inferno'],
      ice: ['ice', 'frost', 'cold', 'crystal', 'freeze'],
      lightning: ['lightning', 'electric', 'spark', 'thunder', 'plasma'],
      arcane: ['arcane', 'magic', 'rune', 'mystic', 'void'],
      nature: ['nature', 'heal', 'life', 'grow', 'leaf'],
      dark: ['dark', 'shadow', 'void', 'death', 'corrupt'],
      holy: ['holy', 'light', 'divine', 'radiant', 'blessed'],
    };
    
    const keywords = categories[category.toLowerCase()] || [];
    if (keywords.length === 0) return [];
    
    return this.getAll().filter(e => {
      const text = `${e.name} ${e.description || ''}`.toLowerCase();
      return keywords.some(k => text.includes(k));
    });
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let _instance = null;

/**
 * Get the global registry instance
 */
export function getParticleEffectRegistry() {
  if (!_instance) {
    _instance = new ParticleEffectRegistry();
  }
  return _instance;
}

/**
 * Initialize the global registry
 */
export async function initParticleEffectRegistry() {
  const registry = getParticleEffectRegistry();
  await registry.initialize();
  return registry;
}

export default {
  ParticleEffectRegistry,
  getParticleEffectRegistry,
  initParticleEffectRegistry,
};
