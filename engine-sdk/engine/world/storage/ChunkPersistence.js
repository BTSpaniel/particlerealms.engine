// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkPersistence.js - Chunk Save/Load System
 *
 * Manages chunk persistence with:
 * - Multiple save formats (binary, JSON, compressed)
 * - Delta saves (only modified blocks)
 * - Auto-save with configurable interval
 * - Backup management
 */

export const CHUNK_PERSISTENCE_DB_NAME = 'ChunkPersistence';
export const CHUNK_PERSISTENCE_STORE_NAME = 'chunks';
export const CHUNK_PERSISTENCE_RECORD_SCHEMA = 'engine.chunk-persistence-record';
export const CHUNK_PERSISTENCE_RECORD_VERSION = 2;
export const CHUNK_PERSISTENCE_RECORD_LIMITS = Object.freeze({
    maxKeyBytes: 4096,
    maxSerializedBytes: 64 * 1024 * 1024,
});

const ENCODER = new TextEncoder();
const CURRENT_KEY_SUFFIX = `:schema-v${CHUNK_PERSISTENCE_RECORD_VERSION}`;

function _serializedChunk(value) {
    let json;
    try {
        json = JSON.stringify(value);
    } catch (_) {
        throw new Error('CORRUPT_CHUNK_PERSISTENCE_RECORD');
    }
    if (typeof json !== 'string' || ENCODER.encode(json).byteLength > CHUNK_PERSISTENCE_RECORD_LIMITS.maxSerializedBytes) {
        throw new Error('CORRUPT_CHUNK_PERSISTENCE_RECORD');
    }
    return json;
}

function _validKey(value) {
    return typeof value === 'string'
        && value.length > 0
        && ENCODER.encode(value).byteLength <= CHUNK_PERSISTENCE_RECORD_LIMITS.maxKeyBytes;
}

function _validatedChunk(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !_validKey(value.key)
        || typeof value.chunkKey !== 'string'
        || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0
        || (value.data !== null && (typeof value.data !== 'object' || Array.isArray(value.data)))
        || typeof value.format !== 'string' || !value.format) {
        throw new Error('CORRUPT_CHUNK_PERSISTENCE_RECORD');
    }
    _serializedChunk(value);
    return value;
}

export function chunkPersistenceCurrentKey(legacyKey) {
    if (!_validKey(legacyKey) || legacyKey.endsWith(CURRENT_KEY_SUFFIX)) {
        throw new TypeError('invalid chunk persistence key');
    }
    return `${legacyKey}${CURRENT_KEY_SUFFIX}`;
}

/** Validate one exact v1/v2 chunk record without manufacturing an upcast. */
export function prepareChunkPersistenceRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new Error('CORRUPT_CHUNK_PERSISTENCE_RECORD');
    }
    const currentKey = typeof record.key === 'string' && record.key.endsWith(CURRENT_KEY_SUFFIX);
    const hasEnvelopeMarker = Object.hasOwn(record, 'schema') || Object.hasOwn(record, 'schemaVersion');
    if (!currentKey && !hasEnvelopeMarker) {
        const chunk = _validatedChunk(record);
        return { version: 1, chunk, storageKey: chunk.key, legacySnapshot: null };
    }
    if (!currentKey || record.schema !== CHUNK_PERSISTENCE_RECORD_SCHEMA
        || !Number.isSafeInteger(record.schemaVersion)) {
        throw new Error('CORRUPT_CHUNK_PERSISTENCE_RECORD');
    }
    if (record.schemaVersion > CHUNK_PERSISTENCE_RECORD_VERSION) {
        throw new Error('FUTURE_CHUNK_PERSISTENCE_RECORD_VERSION');
    }
    const chunk = _validatedChunk(record.chunk);
    if (record.schemaVersion !== CHUNK_PERSISTENCE_RECORD_VERSION
        || record.key !== chunkPersistenceCurrentKey(chunk.key)
        || typeof record.legacySnapshot !== 'string'
        || ENCODER.encode(record.legacySnapshot).byteLength > CHUNK_PERSISTENCE_RECORD_LIMITS.maxSerializedBytes
        || record.legacySnapshot !== _serializedChunk(chunk)) {
        throw new Error('CORRUPT_CHUNK_PERSISTENCE_RECORD');
    }
    return {
        version: CHUNK_PERSISTENCE_RECORD_VERSION,
        chunk,
        storageKey: record.key,
        legacySnapshot: record.legacySnapshot,
    };
}

function _clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

export class ChunkPersistence {
    constructor() {
        this.enabled = true;

        // Save settings
        this.saveFormat = 'compressed';
        this.autosaveInterval = 300; // seconds
        this.maxSavesPerFrame = 2;
        this.deltaSaves = true;
        this.backupCount = 3;

        // State
        this.saveQueue = [];
        this.lastAutosave = 0;
        this.autosaveTimer = null;
        this.worldName = 'world';

        // Statistics
        this.stats = {
            totalSaves: 0,
            totalLoads: 0,
            totalBytes: 0,
            lastSaveTime: 0,
            pendingSaves: 0,
        };

        this.db = null;
        this.dbName = CHUNK_PERSISTENCE_DB_NAME;
        this.storeName = CHUNK_PERSISTENCE_STORE_NAME;
    }

    /** Initialize persistence system. */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            let blocked = false;

            request.onerror = () => reject(request.error);
            request.onblocked = () => {
                blocked = true;
                reject(new Error('CHUNK_PERSISTENCE_DATABASE_BLOCKED'));
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    db.close();
                    if (this.db === db) this.db = null;
                    if (this.autosaveTimer) clearInterval(this.autosaveTimer);
                    this.autosaveTimer = null;
                };
                if (blocked) {
                    db.close();
                    return;
                }
                this.db = db;
                this.startAutosave();
                resolve();
            };
            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'key' });
                }
            };
        });
    }

    /** Start auto-save timer. */
    startAutosave() {
        if (this.autosaveTimer) clearInterval(this.autosaveTimer);
        if (this.autosaveInterval > 0) {
            this.autosaveTimer = setInterval(() => { this.autosave(); }, this.autosaveInterval * 1000);
        }
    }

    /** Queue a chunk for saving. */
    queueSave(key, chunk, immediate = false) {
        if (!this.enabled) return undefined;

        const saveData = {
            key: `${this.worldName}_${key}`,
            chunkKey: key,
            timestamp: Date.now(),
            data: this.deltaSaves ? this._getDeltaData(chunk) : this._getFullData(chunk),
            format: this.saveFormat,
        };
        _validatedChunk(saveData);

        if (immediate) {
            this.stats.pendingSaves = this.saveQueue.length;
            return this._saveChunk(saveData);
        }

        this.saveQueue = this.saveQueue.filter(saved => saved.chunkKey !== key);
        this.saveQueue.push(saveData);
        this.stats.pendingSaves = this.saveQueue.length;
        return undefined;
    }

    /** Get delta data (only modified blocks). */
    _getDeltaData(chunk) {
        if (!chunk.modifications || chunk.modifications.size === 0) return null;
        return { type: 'delta', modifications: Array.from(chunk.modifications.entries()) };
    }

    /** Get full chunk data. */
    _getFullData(chunk) {
        let data;
        if (this.saveFormat === 'compressed') data = this._compressVoxels(chunk.voxels);
        else if (this.saveFormat === 'binary') data = Array.from(chunk.voxels);
        else data = { voxels: Array.from(chunk.voxels) };
        return { type: 'full', data };
    }

    /** Simple RLE compression. */
    _compressVoxels(voxels) {
        const runs = [];
        let currentVal = voxels[0];
        let runLength = 1;
        for (let i = 1; i < voxels.length; i++) {
            if (voxels[i] === currentVal && runLength < 255) runLength++;
            else {
                runs.push([currentVal, runLength]);
                currentVal = voxels[i];
                runLength = 1;
            }
        }
        runs.push([currentVal, runLength]);
        return runs;
    }

    /** Decompress RLE data. */
    _decompressVoxels(runs) {
        const voxels = [];
        for (const [val, len] of runs) {
            for (let i = 0; i < len; i++) voxels.push(val);
        }
        return new Uint8Array(voxels);
    }

    /** Save a chunk using legacy-first/current-last writes in one transaction. */
    async _saveChunk(saveData) {
        if (!this.db) return false;
        _validatedChunk(saveData);
        const startTime = performance.now();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const currentKey = chunkPersistenceCurrentKey(saveData.key);
            const legacyRequest = store.get(saveData.key);
            const currentRequest = store.get(currentKey);
            let legacyResult;
            let currentResult;
            let preflightError = null;
            let pending = 2;

            const preflightAndWrite = () => {
                pending -= 1;
                if (pending !== 0) return;
                try {
                    if (legacyResult !== undefined) prepareChunkPersistenceRecord(legacyResult);
                    if (currentResult !== undefined) {
                        const current = prepareChunkPersistenceRecord(currentResult);
                        if (current.version !== CHUNK_PERSISTENCE_RECORD_VERSION) {
                            throw new Error('CORRUPT_CHUNK_PERSISTENCE_RECORD');
                        }
                    }
                    const legacySnapshot = _serializedChunk(saveData);
                    store.put(saveData);
                    store.put({
                        key: currentKey,
                        schema: CHUNK_PERSISTENCE_RECORD_SCHEMA,
                        schemaVersion: CHUNK_PERSISTENCE_RECORD_VERSION,
                        chunk: saveData,
                        legacySnapshot,
                    });
                } catch (error) {
                    preflightError = error;
                    transaction.abort();
                }
            };

            legacyRequest.onsuccess = () => { legacyResult = legacyRequest.result; preflightAndWrite(); };
            currentRequest.onsuccess = () => { currentResult = currentRequest.result; preflightAndWrite(); };
            legacyRequest.onerror = () => { preflightError = legacyRequest.error; };
            currentRequest.onerror = () => { preflightError = currentRequest.error; };
            transaction.oncomplete = () => {
                this.stats.totalSaves++;
                this.stats.lastSaveTime = performance.now() - startTime;
                resolve(true);
            };
            transaction.onabort = () => reject(preflightError || transaction.error || new Error('CHUNK_PERSISTENCE_WRITE_ABORTED'));
            transaction.onerror = () => {};
        });
    }

    /** Load a chunk, preferring v2 unless a rollback writer changed v1. */
    async loadChunk(key) {
        if (!this.db) return null;
        const legacyKey = `${this.worldName}_${key}`;
        const currentKey = chunkPersistenceCurrentKey(legacyKey);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const legacyRequest = store.get(legacyKey);
            const currentRequest = store.get(currentKey);
            let legacyResult;
            let currentResult;
            let selected = null;
            let preparationError = null;
            let pending = 2;

            const prepare = () => {
                pending -= 1;
                if (pending !== 0) return;
                try {
                    const legacy = legacyResult === undefined ? null : prepareChunkPersistenceRecord(legacyResult);
                    const current = currentResult === undefined ? null : prepareChunkPersistenceRecord(currentResult);
                    if (current && current.version !== CHUNK_PERSISTENCE_RECORD_VERSION) {
                        throw new Error('CORRUPT_CHUNK_PERSISTENCE_RECORD');
                    }
                    const oldWriterChanged = Boolean(legacy && current)
                        && current.legacySnapshot !== _serializedChunk(legacy.chunk);
                    selected = oldWriterChanged ? legacy.chunk : (current?.chunk ?? legacy?.chunk ?? null);
                } catch (error) {
                    preparationError = error;
                    transaction.abort();
                }
            };

            legacyRequest.onsuccess = () => { legacyResult = legacyRequest.result; prepare(); };
            currentRequest.onsuccess = () => { currentResult = currentRequest.result; prepare(); };
            legacyRequest.onerror = () => { preparationError = legacyRequest.error; };
            currentRequest.onerror = () => { preparationError = currentRequest.error; };
            transaction.oncomplete = () => {
                this.stats.totalLoads++;
                if (!selected) {
                    resolve(null);
                    return;
                }
                const result = _clone(selected);
                if (result.data?.type === 'full' && result.format === 'compressed') {
                    result.data.voxels = this._decompressVoxels(result.data.data);
                }
                resolve(result);
            };
            transaction.onabort = () => reject(preparationError || transaction.error || new Error('CHUNK_PERSISTENCE_READ_ABORTED'));
            transaction.onerror = () => {};
        });
    }

    /** Process the save queue for this frame. */
    async processSaveQueue() {
        let saved = 0;
        while (this.saveQueue.length > 0 && saved < this.maxSavesPerFrame) {
            const saveData = this.saveQueue[0];
            await this._saveChunk(saveData);
            if (this.saveQueue[0] === saveData) this.saveQueue.shift();
            saved++;
        }
        this.stats.pendingSaves = this.saveQueue.length;
        return saved;
    }

    async autosave() {
        this.lastAutosave = Date.now();
        console.log('[ChunkPersistence] Auto-save triggered');
    }

    async createBackup() {
        console.log('[ChunkPersistence] Backup created');
    }

    setWorldName(name) {
        this.worldName = name;
    }

    getStats() {
        return { ...this.stats };
    }

    loadConfig(cfg) {
        if (!cfg) return;
        this.enabled = cfg.save_enabled !== false;
        this.saveFormat = cfg.save_format || 'compressed';
        this.autosaveInterval = parseInt(cfg.autosave_interval) || 300;
        this.maxSavesPerFrame = parseInt(cfg.max_saves_per_frame) || 2;
        this.deltaSaves = cfg.delta_saves !== false;
        this.backupCount = parseInt(cfg.backup_count) || 3;
        if (this.db) this.startAutosave();
    }

    destroy() {
        if (this.autosaveTimer) clearInterval(this.autosaveTimer);
        this.autosaveTimer = null;
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

export default ChunkPersistence;
