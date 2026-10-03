// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WorldStorage.js - Unified World Save/Load API
 * 
 * High-level interface combining:
 * - RegionFile for chunk storage
 * - ChunkSerializer for compression
 * - ChunkHistory for undo/redo
 * - OPFS for browser file system access
 * 
 * Features:
 * - Async save/load operations
 * - Automatic region management
 * - Background autosave
 * - Crash recovery via journal
 * - World metadata persistence
 */

import { RegionFile, RegionManager, REGION_SIZE } from './RegionFile.js';
import { serializeChunk, deserializeChunk, chunkKey, parseChunkKey } from './ChunkSerializer.js';
import { HistoryManager } from '../streaming/ChunkHistory.js';
import { crc32 } from './VoxelCompression.js';
import { checksumHex32 } from '../../core/math/ChecksumMath.js';
import { byteSignature } from '../../core/math/FormatMath.js';
import { WorldMapGenerator } from '../generation/WorldMapGenerator.js';

// Import storage backends from dedicated module
import { OPFSBackend, IndexedDBBackend, FileSystemBackend } from './StorageBackends.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const WORLD_META_FILE = 'world.json';
const WORLD_PREVIEW_FILE = 'preview.png';
const WAL_FILE = 'world.wal';
const REGIONS_DIR = 'regions';

const AUTOSAVE_INTERVAL_MS = 60000;  // 60 seconds for auto-save (deferred during loading)
const MAX_DIRTY_CHUNKS_BEFORE_SAVE = 5000;  // Buffer up to 5000 chunks before forced flush
const SAVE_BATCH_FLUSH_MS = 60000;  // Flush save queue every 60 seconds (saves deferred during loading)
const LOG_BATCH_FLUSH_MS = 5000;  // Batch logs for 5 seconds

export const WORLD_METADATA_VERSION = 1;

// ============================================================================
// WRITE-AHEAD LOG (WAL) CONSTANTS
// ============================================================================

// WAL file magic number and version
const WAL_MAGIC = 0x57414C31;  // "WAL1"
export const WORLD_WAL_VERSION = 1;
const WAL_VERSION = WORLD_WAL_VERSION;
const WAL_HEADER_SIZE = 24;  // magic(4) + version(4) + lsn(8) + checkpointLsn(8)

// WAL entry types
const WAL_ENTRY_CHUNK_WRITE = 0x01;
const WAL_ENTRY_CHUNK_DELETE = 0x02;
const WAL_ENTRY_CHECKPOINT = 0xFF;

// WAL thresholds (optimized for voxel game workload - deferred during loading)
const WAL_MAX_SIZE_BYTES = 50 * 1024 * 1024;  // 50MB - trigger checkpoint (larger buffer)
const WAL_BATCH_FLUSH_MS = 5000;  // Flush WAL buffer every 5 seconds (reduced I/O during loading)
const WAL_IDLE_CHECKPOINT_MS = 30000;  // Checkpoint after 30s idle

function worldFormatError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** Validate decoded world metadata without mutating it. */
export function validateWorldMetadata(metadata) {
    if (!isPlainRecord(metadata)) {
        throw worldFormatError('INVALID_WORLD_METADATA', 'World metadata must be a plain object');
    }
    if (metadata.version !== WORLD_METADATA_VERSION) {
        throw worldFormatError(
            'UNSUPPORTED_WORLD_METADATA_VERSION',
            `Unsupported world metadata version: ${String(metadata.version)}`
        );
    }
    for (const field of ['created', 'lastSaved', 'playTime']) {
        if (metadata[field] !== undefined && (!Number.isFinite(metadata[field]) || metadata[field] < 0)) {
            throw worldFormatError('INVALID_WORLD_METADATA', `World metadata ${field} must be a non-negative finite number`);
        }
    }
    if (metadata.worldName !== undefined && typeof metadata.worldName !== 'string') {
        throw worldFormatError('INVALID_WORLD_METADATA', 'World metadata worldName must be a string');
    }
    if (metadata.seed !== undefined && typeof metadata.seed !== 'string' && !Number.isFinite(metadata.seed)) {
        throw worldFormatError('INVALID_WORLD_METADATA', 'World metadata seed must be a string or finite number');
    }
    for (const field of ['playerPosition', 'worldTime', 'stats']) {
        if (metadata[field] !== undefined && metadata[field] !== null && !isPlainRecord(metadata[field])) {
            throw worldFormatError('INVALID_WORLD_METADATA', `World metadata ${field} must be an object or null`);
        }
    }
    if (metadata.regions !== undefined && (!Array.isArray(metadata.regions)
        || metadata.regions.some(region => !isPlainRecord(region)))) {
        throw worldFormatError('INVALID_WORLD_METADATA', 'World metadata regions must be an array of objects');
    }
    return metadata;
}

/** Parse and validate a WAL header without mutating or persisting the input. */
export function parseWorldWalHeader(data) {
    if (!(data instanceof Uint8Array) || data.byteLength < WAL_HEADER_SIZE) {
        throw worldFormatError('INVALID_WORLD_WAL', `World WAL must contain a ${WAL_HEADER_SIZE}-byte header`);
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = view.getUint32(0, true);
    if (magic !== WAL_MAGIC) throw worldFormatError('INVALID_WORLD_WAL', 'World WAL magic is invalid');
    const version = view.getUint32(4, true);
    if (version !== WORLD_WAL_VERSION) {
        throw worldFormatError('UNSUPPORTED_WORLD_WAL_VERSION', `Unsupported world WAL version: ${version}`);
    }
    const lastHigh = view.getUint32(12, true);
    const checkpointHigh = view.getUint32(20, true);
    if (lastHigh !== 0 || checkpointHigh !== 0) {
        throw worldFormatError('UNSUPPORTED_WORLD_WAL_LSN', 'World WAL v1 only supports 32-bit LSN values');
    }
    const lastLSN = view.getUint32(8, true);
    const checkpointLSN = view.getUint32(16, true);
    if (checkpointLSN > lastLSN) {
        throw worldFormatError('INVALID_WORLD_WAL', 'World WAL checkpoint LSN exceeds its last LSN');
    }
    return Object.freeze({
        version,
        lastLSN,
        checkpointLSN
    });
}

/** Strictly parse and validate an entire WAL before any recovery mutation. */
export function parseWorldWal(data) {
    const header = parseWorldWalHeader(data);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = [];
    let offset = WAL_HEADER_SIZE;
    let previousLSN = header.checkpointLSN;

    while (offset < data.byteLength) {
        const entryOffset = offset;
        if (offset + 11 > data.byteLength) {
            throw worldFormatError('TRUNCATED_WORLD_WAL', `Truncated WAL entry header at byte ${entryOffset}`);
        }
        const lsn = view.getUint32(offset, true);
        const lsnHigh = view.getUint32(offset + 4, true);
        offset += 8;
        if (lsnHigh !== 0) {
            throw worldFormatError('UNSUPPORTED_WORLD_WAL_LSN', `WAL entry at byte ${entryOffset} uses a 64-bit LSN`);
        }
        if (lsn !== previousLSN + 1 || lsn > header.lastLSN) {
            throw worldFormatError('INVALID_WORLD_WAL_LSN', `WAL entry LSN ${lsn} is out of sequence`);
        }
        previousLSN = lsn;

        const type = data[offset++];
        if (type !== WAL_ENTRY_CHUNK_WRITE) {
            throw worldFormatError('UNKNOWN_WORLD_WAL_ENTRY', `Unsupported WAL entry type ${type} at byte ${entryOffset}`);
        }

        const keyLength = view.getUint16(offset, true);
        offset += 2;
        if (keyLength < 1 || offset + keyLength + 8 > data.byteLength) {
            throw worldFormatError('TRUNCATED_WORLD_WAL', `Invalid WAL chunk key at byte ${entryOffset}`);
        }
        let key;
        try { key = decoder.decode(data.subarray(offset, offset + keyLength)); }
        catch { throw worldFormatError('INVALID_WORLD_WAL_KEY', `WAL chunk key at byte ${entryOffset} is not valid UTF-8`); }
        offset += keyLength;
        const coordinates = key.split(',').map(value => Number(value));
        if (coordinates.length !== 3 || coordinates.some(value => !Number.isSafeInteger(value)
            || value < -2147483648 || value > 2147483647)) {
            throw worldFormatError('INVALID_WORLD_WAL_KEY', `Invalid WAL chunk key: ${key}`);
        }

        const expectedCrc = view.getUint32(offset, true);
        offset += 4;
        const dataLength = view.getUint32(offset, true);
        offset += 4;
        if (dataLength < 1 || dataLength > WAL_MAX_SIZE_BYTES || offset + dataLength > data.byteLength) {
            throw worldFormatError('TRUNCATED_WORLD_WAL', `Invalid WAL payload length at byte ${entryOffset}`);
        }
        const payload = data.slice(offset, offset + dataLength);
        offset += dataLength;
        if (crc32(payload) !== expectedCrc) {
            throw worldFormatError('INVALID_WORLD_WAL_CRC', `WAL CRC mismatch for chunk ${key}`);
        }
        entries.push(Object.freeze({
            lsn,
            type,
            key,
            x: coordinates[0],
            y: coordinates[1],
            z: coordinates[2],
            data: payload,
            byteOffset: entryOffset,
            byteLength: offset - entryOffset
        }));
    }

    if (entries.length === 0 && header.lastLSN !== header.checkpointLSN) {
        throw worldFormatError('TRUNCATED_WORLD_WAL', 'World WAL header declares entries that are missing');
    }
    if (entries.length > 0 && entries.at(-1).lsn !== header.lastLSN) {
        throw worldFormatError('TRUNCATED_WORLD_WAL', 'World WAL does not contain its declared last LSN');
    }
    return Object.freeze({ header, entries: Object.freeze(entries) });
}

let _worldRootIdSequence = 0;

function _newWorldRootId() {
    const cryptoApi = globalThis.crypto;
    let randomPart = '';
    try {
        if (typeof cryptoApi?.randomUUID === 'function') {
            randomPart = cryptoApi.randomUUID().replace(/-/g, '');
        } else if (typeof cryptoApi?.getRandomValues === 'function') {
            randomPart = byteSignature(cryptoApi.getRandomValues(new Uint8Array(16)));
        }
    } catch (_) { /* use the deterministic local fallback below */ }
    if (!randomPart) randomPart = (++_worldRootIdSequence).toString(16);
    return `${Date.now().toString(16)}-${randomPart}`;
}

// Storage backends moved to StorageBackends.js

// ============================================================================
// WORLD STORAGE CLASS
// ============================================================================

/**
 * WorldStorage - Main API for world persistence
 */
export class WorldStorage {
    constructor() {
        this.worldName = null;
        this.worldSeed = 0;
        this.backend = null;
        
        // Region management
        this.regionManager = new RegionManager();
        this.loadedRegions = new Set();
        this.loadingRegions = new Map();  // Track in-progress loads to prevent race conditions
        
        // History
        this.historyManager = new HistoryManager();
        
        // Dirty tracking
        this.dirtyChunks = new Set();
        this.dirtyRegions = new Set();
        this.dirtyRegionVersions = new Map(); // region key -> latest in-memory mutation generation
        this.dirtyRegionWalLSNs = new Map();  // region key -> WAL LSN required before its snapshot is writable
        this.regionSavePromise = null;        // Serialize region snapshots and dirty-state commits
        
        // Autosave
        this.autosaveTimer = null;
        this.autosaveEnabled = true;
        
        // Write-Ahead Log (WAL) for crash recovery
        this.walBuffer = [];           // Pending entries to write
        this.walLSN = 0;               // Current Log Sequence Number
        this.walCheckpointLSN = 0;     // Last checkpointed LSN
        this.walDurableLSN = 0;        // Highest LSN verified in the durable WAL generation
        this.walFileSize = 0;          // Current WAL file size
        this.walOperationPromise = null; // Serialize append and truncate generations
        this.walFlushTimer = null;     // Timer for periodic flush
        this.walIdleTimer = null;      // Timer for idle checkpoint
        this.walLastWrite = 0;         // Timestamp of last write
        this.walIdleCheckpointDone = false;  // Prevent repeated idle checkpoints

        // WAL error handling/backoff
        this.walDisabledUntil = 0;
        this.walLastErrorLog = 0;
        this.walBackoffMs = 30000;
        this.walMaxBackoffMs = 10 * 60 * 1000;
        
        // Neighbor boundary backup cache for slow/lost data recovery
        // Upgraded with LRU eviction, TTL, and monitoring (based on async-cache-dedupe pattern)
        this.boundaryCache = new Map();  // key -> {timestamp, faces}
        this.boundaryBackupEnabled = true;
        this.boundaryBackupMaxSize = 1000;  // Max cached boundaries
        this.boundaryTTL = 5 * 60 * 1000;       // 5 minutes
        this.boundaryStaleTTL = 60 * 1000;      // 1 minute stale-while-revalidate window

        // Trace a specific chunk/region for debug (set via setTraceChunk)
        this.traceChunk = null;  // { x, y, z }
        
        // Monitoring stats (inspired by async-cache-dedupe)
        this.cacheStats = {
            hits: 0,
            misses: 0,
            dedupes: 0,  // Number of deduplicated region loads
            evictions: 0,
            staleHits: 0,  // Stale-while-revalidate hits
        };
        
        // Callbacks for monitoring (optional, inspired by lru-cache)
        this.onCacheHit = null;   // (key, data) => {}
        this.onCacheMiss = null;  // (key) => {}
        this.onDedupe = null;     // (regionKey) => {}
        this.onDispose = null;    // (key, data, reason) => {} - cleanup when evicted
        this.onInsert = null;     // (key, data) => {} - when new item added
        
        // Async fetch method for stale-while-revalidate (inspired by lru-cache fetchMethod)
        this.boundaryFetchMethod = null;  // async (key) => boundary data
        
        // State
        this.initialized = false;
        this.closing = false;
        this.saving = false;
        this.ready = false;  // True when fully ready for save/load operations
        this.initPhase = 'pending';  // pending, initializing, verifying, ready, error
        
        // World map preview generator
        this.mapGenerator = new WorldMapGenerator();
        this.chunkManager = null;  // Set via setChunkManager()
        
        // World metadata
        this.metadata = {
            created: 0,
            lastSaved: 0,
            playTime: 0,
            playerPosition: null,
            version: WORLD_METADATA_VERSION,
            worldTime: null,  // WorldTimeSystem state for sky/time consistency
        };
        
        // Reference to WorldTimeSystem for saving time state
        this.worldTimeSystem = null;
        
        // Stats
        this.stats = {
            chunksLoaded: 0,
            chunksSaved: 0,
            bytesWritten: 0,
            bytesRead: 0,
            saveTime: 0,
            loadTime: 0,
        };
        
        // Batched operations
        this.saveQueue = new Map();  // chunkKey -> chunk
        this.saveFlushTimer = null;
        this.loadedThisFrame = [];  // Track chunks loaded this batch
        this.savedThisFrame = [];   // Track chunks saved this batch
        this.logBatchTimer = null;
        this.pendingLogs = { loaded: 0, saved: 0, generated: 0 };
        
        // Modification queue with idle-based flushing
        this.modificationQueue = new Map();  // chunkKey -> { chunk, timestamp }
        this.lastModificationTime = 0;
        this.idleFlushTimer = null;
        this.idleFlushDelayMs = 2000;  // Flush after 2 seconds of no modifications
        
        // Player position for distance-based loading priority
        this.playerChunk = { x: 0, y: 0, z: 0 };
        
        // Deferred region saves (non-blocking)
        this.deferredSaveScheduled = false;
        
        // Verbosity control (0=silent, 1=summary, 2=verbose)
        this.verbosity = 1;
        
        // Callbacks
        this.onSaveStart = null;
        this.onSaveComplete = null;
        this.onLoadComplete = null;
        this.onError = null;
        
        // File-based debug logging for diagnosing corruption
        this.fileLoggingEnabled = true;
        this.saveLogBuffer = [];
        this.loadLogBuffer = [];
        this.logFlushInterval = null;
    }
    
    /**
     * Set the ChunkManager reference for preview generation
     * @param {ChunkManager} chunkManager 
     */
    setChunkManager(chunkManager) {
        this.chunkManager = chunkManager;
    }
    
    /**
     * Generate and save world map preview image
     * @returns {Promise<boolean>} Success
     */
    async generatePreview() {
        if (!this.chunkManager?.chunks || this.chunkManager.chunks.size === 0) {
            console.log('[WorldStorage] No chunks to generate preview from');
            return false;
        }
        
        try {
            const startTime = performance.now();
            
            // Generate preview image
            const dataUrl = await this.mapGenerator.generatePreview(this.chunkManager.chunks);
            
            // Convert data URL to binary
            const base64 = dataUrl.split(',')[1];
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            
            // Save to file
            await this.backend.writeFile(WORLD_PREVIEW_FILE, bytes);
            
            console.log(`[WorldStorage] ✓ Preview generated (${bytes.length} bytes) in ${(performance.now() - startTime).toFixed(1)}ms`);
            return true;
        } catch (e) {
            console.error('[WorldStorage] Failed to delete world:', e);
            return false;
        }
    }

    /**
     * Delete ONLY the stored folder handle (when the folder is gone or permission denied)
     * @param {string} worldName
     * Initialize world storage
     * @param {string} worldName 
     * @param {number} seed 
     * @param {Object} options 
     * @param {boolean} options.useFileSystem - Use real file system (prompts for folder like src/data)
     * @param {FileSystemDirectoryHandle} options.dirHandle - Pre-selected directory handle
     * @param {boolean} options.autosave - Enable autosave (default: true)
     */
    async init(worldName, seed = Date.now(), options = {}) {
        this.closing = false;
        this.worldName = worldName;
        this.worldSeed = seed;
        this.initPhase = 'initializing';
        this.ready = false;
        
        // NOTE: Browser storage (OPFS/IndexedDB) is used to persist folder handles
        // DO NOT clear it - we need the handles to implement Continue button
        
        // FileSystem backend ONLY - NO BROWSER STORAGE AT ALL
        this.backend = new FileSystemBackend();
        const fsSuccess = await this.backend.init(worldName, options.dirHandle);
        
        if (fsSuccess) {
            console.log('[WorldStorage] Using FileSystem backend (real folder)');
            
            // Store the folder handle for Continue button on future sessions
            if (options.dirHandle && this.backend.rootDir) {
                await WorldStorage.storeWorldHandle(worldName, this.backend.rootDir);
            }
        } else {
            // NO FALLBACK - require user to select folder
            console.error('[WorldStorage] FileSystem required. User must select a folder.');
            throw new Error('FileSystem backend required. Please select a save folder.');
        }
        
        // Load world metadata if exists
        await this._loadMetadata();
        
        // Recover from WAL if needed (crash recovery)
        await this._walRecover();
        
        // Start WAL flush timer
        this._walStartFlushTimer();
        
        // Request persistent storage to prevent browser eviction
        await this._requestPersistentStorage();
        
        // Check available storage quota
        await this._checkStorageQuota();
        
        // Start autosave
        if (this.autosaveEnabled && options.autosave !== false) {
            this._startAutosave();
        }
        
        this.initialized = true;
        console.log(`[WorldStorage] Initialized world "${worldName}" with seed ${seed}`);
        
        // Start file logging for debugging
        if (this.fileLoggingEnabled) {
            this._startFileLogging();
        }
        
        return true;
    }
    
    // ========================================================================
    // FILE-BASED DEBUG LOGGING
    // ========================================================================
    
    /**
     * Start periodic file log flushing
     * @private
     */
    _startFileLogging() {
        // Flush logs every 10 seconds
        this.logFlushInterval = setInterval(() => {
            this._flushFileLogs();
        }, 10000);
        console.log('[WorldStorage] File logging enabled - logs will be written to world folder');
    }
    
    /**
     * Stop file logging
     * @private
     */
    _stopFileLogging() {
        if (this.logFlushInterval) {
            clearInterval(this.logFlushInterval);
            this.logFlushInterval = null;
        }
        // Final flush
        this._flushFileLogs();
    }
    
    /**
     * Log a save operation with detailed chunk info
     * @param {Object} chunk - Chunk being saved
     * @param {Uint8Array} serialized - Serialized data
     * @param {string} status - 'success' or 'error'
     * @param {string} error - Error message if any
     */
    _logSave(chunk, serialized, status, error = null) {
        if (!this.fileLoggingEnabled) return;
        
        const timestamp = new Date().toISOString();
        const nonAir = chunk.voxels ? chunk.voxels.filter(v => v !== 0).length : 0;
        
        // Calculate CRC on raw bytes - use simple hash for reliability
        let crc = 0;
        if (serialized && serialized.length > 0) {
            for (let i = 0; i < Math.min(serialized.length, 1000); i++) {
                crc = ((crc << 5) - crc + serialized[i]) >>> 0;
            }
        }
        
        // Sample first 10 non-air voxels for signature
        const voxelSample = [];
        if (chunk.voxels) {
            for (let i = 0; i < chunk.voxels.length && voxelSample.length < 10; i++) {
                if (chunk.voxels[i] !== 0) {
                    voxelSample.push(`[${i}]=${chunk.voxels[i]}`);
                }
            }
        }
        
        const entry = {
            timestamp,
            action: 'SAVE',
            chunk: `(${chunk.cx ?? chunk.x},${chunk.cy ?? chunk.y},${chunk.cz ?? chunk.z})`,
            status,
            nonAirVoxels: nonAir,
            serializedBytes: serialized ? serialized.length : 0,
            crc32: checksumHex32(crc),
            voxelSample: voxelSample.join(', '),
            error: error || null,
        };
        
        this.saveLogBuffer.push(entry);
        
        // RAM-first: Don't auto-flush logs - only write on save/exit
        // Logs are flushed in flushToDisk() or gracefulSave()
    }
    
    /**
     * Log a load operation with detailed chunk info
     * @param {number} x - Chunk X
     * @param {number} y - Chunk Y
     * @param {number} z - Chunk Z
     * @param {Object} chunk - Loaded chunk (or null if not found)
     * @param {Uint8Array} serialized - Raw serialized data
     * @param {string} status - 'success', 'not_found', 'error', 'corrupted'
     * @param {string} error - Error message if any
     */
    _logLoad(x, y, z, chunk, serialized, status, error = null) {
        if (!this.fileLoggingEnabled) return;
        
        // Skip logging not_found entries (reduces log noise)
        if (status === 'not_found') return;
        
        const timestamp = new Date().toISOString();
        const nonAir = chunk?.voxels ? chunk.voxels.filter(v => v !== 0).length : 0;
        
        // Calculate CRC on raw bytes - ensure we have actual data
        let crc = 0;
        if (serialized && serialized.length > 0) {
            // Use a simple checksum if crc32 is giving issues
            crc = 0;
            for (let i = 0; i < Math.min(serialized.length, 1000); i++) {
                crc = ((crc << 5) - crc + serialized[i]) >>> 0;
            }
        }
        
        // Sample first 10 non-air voxels for signature
        const voxelSample = [];
        if (chunk?.voxels) {
            for (let i = 0; i < chunk.voxels.length && voxelSample.length < 10; i++) {
                if (chunk.voxels[i] !== 0) {
                    voxelSample.push(`[${i}]=${chunk.voxels[i]}`);
                }
            }
        }
        
        const entry = {
            timestamp,
            action: 'LOAD',
            chunk: `(${x},${y},${z})`,
            status,
            nonAirVoxels: nonAir,
            serializedBytes: serialized ? serialized.length : 0,
            crc32: checksumHex32(crc),
            voxelSample: voxelSample.join(', '),
            error: error || null,
        };
        
        this.loadLogBuffer.push(entry);
        
        // RAM-first: Don't auto-flush logs - only write on save/exit
        // Logs are flushed in flushToDisk() or gracefulSave()
    }
    
    /**
     * Flush log buffers to files
     * @private
     */
    async _flushFileLogs() {
        if (!this.backend?.initialized) return;
        if (this.saveLogBuffer.length === 0 && this.loadLogBuffer.length === 0) return;
        
        try {
            // Format and write save log
            if (this.saveLogBuffer.length > 0) {
                const saveLogText = this.saveLogBuffer.map(e => 
                    `${e.timestamp} | ${e.action} ${e.chunk} | ${e.status} | ${e.nonAirVoxels} voxels | ${e.serializedBytes} bytes | CRC:${e.crc32}` +
                    (e.voxelSample ? ` | Sample: ${e.voxelSample}` : '') +
                    (e.error ? ` | ERROR: ${e.error}` : '')
                ).join('\n') + '\n';
                
                await this._appendToLogFile('chunk_saves.log', saveLogText);
                this.saveLogBuffer = [];
            }
            
            // Format and write load log
            if (this.loadLogBuffer.length > 0) {
                const loadLogText = this.loadLogBuffer.map(e => 
                    `${e.timestamp} | ${e.action} ${e.chunk} | ${e.status} | ${e.nonAirVoxels} voxels | ${e.serializedBytes} bytes | CRC:${e.crc32}` +
                    (e.voxelSample ? ` | Sample: ${e.voxelSample}` : '') +
                    (e.error ? ` | ERROR: ${e.error}` : '')
                ).join('\n') + '\n';
                
                await this._appendToLogFile('chunk_loads.log', loadLogText);
                this.loadLogBuffer = [];
            }
        } catch (err) {
            console.error('[WorldStorage] Failed to flush file logs:', err);
        }
    }
    
    /**
     * Append text to a log file in the world folder
     * Uses a write queue to prevent file contention from concurrent writes
     * @param {string} filename - Log file name
     * @param {string} text - Text to append
     * @private
     */
    async _appendToLogFile(filename, text) {
        if (!this.backend?.worldDir) return;
        
        // Initialize write queues if not present
        if (!this._logWriteQueues) {
            this._logWriteQueues = new Map();
        }
        
        // Get or create queue for this file
        if (!this._logWriteQueues.has(filename)) {
            this._logWriteQueues.set(filename, {
                pending: [],
                writing: false,
            });
        }
        
        const queue = this._logWriteQueues.get(filename);
        queue.pending.push(text);
        
        // If already writing, the pending text will be picked up
        if (queue.writing) return;
        
        // Start writing
        queue.writing = true;
        
        try {
            while (queue.pending.length > 0) {
                // Collect all pending writes
                const allText = queue.pending.join('');
                queue.pending = [];
                
                // Use efficient append - seek to end without reading entire file
                try {
                    const fileHandle = await this.backend.worldDir.getFileHandle(filename, { create: true });
                    const file = await fileHandle.getFile();
                    const writable = await fileHandle.createWritable({ keepExistingData: true });
                    await writable.seek(file.size);  // Seek to end
                    await writable.write(new TextEncoder().encode(allText));
                    await writable.close();
                } catch (e) {
                    // Fallback: just write new content if append fails
                    const encoded = new TextEncoder().encode(allText);
                    await this.backend.writeFile(filename, encoded);
                }
            }
        } catch (err) {
            // Silenced - swap file errors are common with FileSystem API
        } finally {
            queue.writing = false;
        }
    }
    
    /**
     * Clear log files (call when starting fresh debugging session)
     */
    async clearLogFiles() {
        if (!this.backend?.worldDir) return;
        
        try {
            await this.backend.deleteFile('chunk_saves.log');
            await this.backend.deleteFile('chunk_loads.log');
            console.log('[WorldStorage] Log files cleared');
        } catch (err) {
            // Files may not exist
        }
    }
    
    /**
     * Request persistent storage to prevent browser from evicting data
     * under storage pressure
     * @private
     */
    async _requestPersistentStorage() {
        if (this.isUsingFileSystem?.() === true) {
            return;
        }
        if (navigator.storage && navigator.storage.persist) {
            try {
                const isPersisted = await navigator.storage.persisted();
                if (!isPersisted) {
                    const granted = await navigator.storage.persist();
                    if (granted) {
                        console.log('[WorldStorage] Persistent storage granted - data protected from eviction');
                    } else {
                        const usingFileSystem = this.isUsingFileSystem?.() === true;
                        if (usingFileSystem) {
                            console.warn('[WorldStorage] Persistent storage denied - browser may forget saved folder handles under pressure');
                        } else {
                            console.warn('[WorldStorage] Persistent storage denied - data may be evicted under pressure');
                        }
                    }
                } else {
                    console.log('[WorldStorage] Storage already persistent');
                }
            } catch (e) {
                console.warn('[WorldStorage] Could not request persistent storage:', e);
            }
        }
    }
    
    /**
     * Check available storage quota and warn if low
     * @private
     */
    async _checkStorageQuota() {
        if (this.isUsingFileSystem?.() === true) {
            return;
        }
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                const usedMB = (estimate.usage / 1024 / 1024).toFixed(1);
                const quotaMB = (estimate.quota / 1024 / 1024).toFixed(1);
                const percentUsed = ((estimate.usage / estimate.quota) * 100).toFixed(1);
                
                console.log(`[WorldStorage] Browser storage: ${usedMB}MB / ${quotaMB}MB (${percentUsed}% used)`);
                
                // Warn if over 80% used
                if (estimate.usage / estimate.quota > 0.8) {
                    console.warn('[WorldStorage] ⚠️ Browser storage over 80% - consider cleaning old data');
                }
                
                this.storageQuota = estimate;
            } catch (e) {
                console.warn('[WorldStorage] Could not check storage quota:', e);
            }
        }
    }
    
    /**
     * Check if there's enough storage space for a write
     * @param {number} bytesNeeded - Estimated bytes to write
     * @returns {boolean} - true if space available
     */
    async hasStorageSpace(bytesNeeded = 1024 * 1024) {
        if (this.isUsingFileSystem?.() === true) {
            return true;
        }
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                const available = estimate.quota - estimate.usage;
                return available > bytesNeeded;
            } catch (e) {
                return true;  // Assume OK if can't check
            }
        }
        return true;
    }
    
    /**
     * Select storage folder (MUST be called from user gesture like button click)
     * Call this to switch from OPFS to real file system storage
     */
    async selectStorageFolder() {
        console.log(`[WorldStorage] selectStorageFolder called with worldName="${this.worldName}"`);
        const fsBackend = new FileSystemBackend();
        const success = await fsBackend.selectFolder(this.worldName);
        
        if (success) {
            this.backend = fsBackend;
            console.log(`[WorldStorage] ✓ Switched to FileSystem backend for "${this.worldName}"`);
            await this._saveMetadata();
            
            // Store the folder handle for Continue button
            if (fsBackend.rootDir) {
                await WorldStorage.storeWorldHandle(this.worldName, fsBackend.rootDir);
            }
            return true;
        }
        return false;
    }
    
    /**
     * Check if using real file system (not OPFS/IndexedDB)
     */
    isUsingFileSystem() {
        return this.backend instanceof FileSystemBackend && this.backend.initialized;
    }
    
    /**
     * Get current storage location info
     */
    getStorageInfo() {
        if (this.backend instanceof FileSystemBackend && this.backend.rootDir) {
            return {
                type: 'filesystem',
                folder: this.backend.rootDir.name,
                rootId: this.backend.rootId || null,
                path: `${this.backend.rootDir.name}/worlds/${this.worldName}`,
            };
        } else if (this.backend instanceof OPFSBackend) {
            return { type: 'opfs', folder: 'Browser Storage (OPFS)' };
        } else {
            return { type: 'indexeddb', folder: 'Browser Storage (IndexedDB)' };
        }
    }
    
    /**
     * Check if storage is fully ready for save/load operations
     * This ensures all handles are valid and buffers are clear
     */
    isReady() {
        return this.ready && this.initialized && !this.saving && this.initPhase === 'ready';
    }
    
    /**
     * Get current initialization phase
     */
    getInitPhase() {
        return this.initPhase;
    }
    
    /**
     * Wait for storage to be ready
     * @param {number} timeoutMs - Maximum time to wait
     * @returns {Promise<boolean>} - True if ready, false if timeout
     */
    async waitForReady(timeoutMs = 10000) {
        if (this.isReady()) return true;
        
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (this.isReady()) return true;
            await new Promise(r => setTimeout(r, 100));
        }
        
        console.warn(`[WorldStorage] waitForReady timeout after ${timeoutMs}ms, phase: ${this.initPhase}`);
        return false;
    }
    
    /**
     * Mark storage as ready after all initialization is complete
     * Should be called after handles are verified and buffers are clear
     */
    markReady() {
        this.ready = true;
        this.initPhase = 'ready';
        console.log('[WorldStorage] ✓ Storage marked as READY for save/load operations');
    }
    
    /**
     * Load world metadata
     * @private
     */
    async _loadMetadata() {
        try {
            const data = await this.backend.readFile(WORLD_META_FILE);
            if (data) {
                const json = new TextDecoder().decode(data);
                const meta = validateWorldMetadata(JSON.parse(json));
                this.metadata = { ...this.metadata, ...meta };
                this.worldSeed = meta.seed ?? this.worldSeed;
                
                // Restore WorldTimeSystem state for deterministic sky colors
                if (meta.worldTime && this.worldTimeSystem?.load) {
                    this.worldTimeSystem.load(meta.worldTime, true);
                    console.log('[WorldStorage] Restored world time from save');
                }
            } else {
                // New world
                this.metadata.created = Date.now();
            }
        } catch (error) {
            console.warn('[WorldStorage] Failed to load metadata:', error);
            throw error;
        }
    }
    
    /**
     * Save world metadata
     * @private
     */
    async _saveMetadata() {
        this.metadata.lastSaved = Date.now();
        this.metadata.seed = this.worldSeed;
        this.metadata.worldName = this.worldName;
        
        // Save WorldTimeSystem state for deterministic sky colors
        if (this.worldTimeSystem?.save) {
            this.metadata.worldTime = this.worldTimeSystem.save();
        }
        
        // Gather statistics
        this.metadata.stats = {
            chunksGenerated: this.stats.chunksGenerated || 0,
            chunksSaved: this.stats.chunksSaved,
            chunksLoaded: this.stats.chunksLoaded,
            bytesWritten: this.stats.bytesWritten,
            bytesRead: this.stats.bytesRead,
            regionsLoaded: this.loadedRegions.size,
        };
        
        // List all regions
        this.metadata.regions = [];
        for (const [key, region] of this.regionManager.regions) {
            this.metadata.regions.push({
                key,
                filename: region.getFilename(),
                chunksStored: region.stats.chunksStored,
                totalBytes: region.stats.totalBytes,
            });
        }
        
        validateWorldMetadata(this.metadata);
        const json = JSON.stringify(this.metadata, null, 2);
        const data = new TextEncoder().encode(json);
        await this.backend.writeFile(WORLD_META_FILE, data);
        
        // Generate world map preview (don't block on failure)
        this.generatePreview().catch(e => console.warn('[WorldStorage] Preview generation failed:', e));
        
        if (this.verbosity >= 2) {
            console.log(`[WorldStorage] ✓ Saved world metadata (${data.length} bytes)`);
        }
    }
    
    /**
     * Create an empty region file on disk
     * Use this to pre-create region files before adding chunks
     * 
     * @param {number} regionX 
     * @param {number} regionZ 
     * @param {number} regionY 
     */
    async createEmptyRegion(regionX, regionZ, regionY = 0) {
        const region = this.regionManager.getRegion(regionX, regionZ, regionY);
        const filename = region.getFilename();
        
        // Check if already exists
        const existing = await this.backend.readRegion(filename);
        if (existing) {
            console.log(`[WorldStorage] Region ${filename} already exists, skipping creation`);
            return false;
        }
        
        // Serialize empty region
        const regionData = region.serialize();
        await this.backend.writeRegion(filename, regionData);
        
        const regionKey = this.regionManager.regionKey(regionX, regionZ, regionY);
        this.loadedRegions.add(regionKey);
        
        console.log(`[WorldStorage] ✓ Created empty region ${filename}`);
        return true;
    }
    
    // ========================================================================
    // RAM-FIRST STORAGE MODE
    // ========================================================================
    // Load entire world into RAM on startup - eliminates disk I/O during gameplay
    // Disk is only used for background saves as backup
    // ========================================================================
    
    /**
     * Enable RAM-first mode - preloads all regions into memory
     * After this, chunk operations are instant (no disk I/O)
     * @returns {Promise<{regionsLoaded: number, bytesLoaded: number, timeMs: number}>}
     */
    async enableRamFirstMode() {
        const startTime = performance.now();
        console.log('[WorldStorage] Enabling RAM-first mode - loading all regions into memory...');
        
        // Get list of all region files
        const regionFiles = await this.backend.listRegionFiles?.() || [];
        console.log(`[WorldStorage] Found ${regionFiles.length} region files to preload`);
        
        let regionsLoaded = 0;
        let bytesLoaded = 0;
        
        // Load all regions in parallel batches
        const BATCH_SIZE = 32;  // Load 32 regions at a time (was 8)
        for (let i = 0; i < regionFiles.length; i += BATCH_SIZE) {
            const batch = regionFiles.slice(i, i + BATCH_SIZE);
            
            await Promise.all(batch.map(async (filename) => {
                try {
                    // Parse region coordinates from filename (r.X.Z.vreg or r.X.Y.Z.vreg)
                    const match = filename.match(/r\.(-?\d+)\.(-?\d+)(?:\.(-?\d+))?\.vreg/);
                    if (!match) return;
                    
                    const regionX = parseInt(match[1]);
                    const regionZ = parseInt(match[2]);
                    const regionY = match[3] ? parseInt(match[3]) : 0;
                    
                    // Load region into memory
                    const regionKey = this.regionManager.regionKey(regionX, regionZ, regionY);
                    if (this.loadedRegions.has(regionKey)) return;  // Already loaded
                    
                    const region = this.regionManager.getRegion(regionX, regionZ, regionY);
                    const data = await this.backend.readRegion(filename);
                    
                    if (data && data.length >= 8192) {
                        const success = region.deserialize(data);
                        if (success) {
                            this.loadedRegions.add(regionKey);
                            regionsLoaded++;
                            bytesLoaded += data.length;
                        }
                    }
                } catch (err) {
                    console.warn(`[WorldStorage] Failed to preload ${filename}:`, err.message);
                }
            }));
            
            // Progress update every 128 regions (reduced logging)
            if (regionsLoaded % 128 === 0 && regionsLoaded > 0) {
                console.log(`[WorldStorage] Preloaded ${regionsLoaded} regions (${(bytesLoaded / 1024 / 1024).toFixed(1)} MB)...`);
            }
        }
        
        this.ramFirstMode = true;
        const timeMs = performance.now() - startTime;
        
        console.log(`[WorldStorage] ✓ RAM-first mode enabled:`);
        console.log(`  - ${regionsLoaded} regions loaded`);
        console.log(`  - ${(bytesLoaded / 1024 / 1024).toFixed(1)} MB in memory`);
        console.log(`  - ${timeMs.toFixed(0)}ms load time`);
        console.log(`  - Chunk operations are now INSTANT (no disk I/O)`);
        
        // Start background save timer (saves dirty regions to disk periodically)
        this._startBackgroundSaveTimer();
        
        return { regionsLoaded, bytesLoaded, timeMs };
    }
    
    /**
     * Check if RAM-first mode is enabled
     */
    isRamFirstMode() {
        return this.ramFirstMode === true;
    }
    
    /**
     * Start background save timer - periodically flushes dirty regions to disk
     * @private
     */
    _startBackgroundSaveTimer() {
        // RAM-first mode: Background saves enabled to persist data to disk
        // Saves happen periodically (every 30 seconds) to ensure data isn't lost
        if (this.backgroundSaveTimer) {
            clearInterval(this.backgroundSaveTimer);
        }
        
        // Save dirty regions every 30 seconds during gameplay
        this.backgroundSaveTimer = setInterval(() => {
            if (this.dirtyRegions.size > 0 && !this.saving) {
                this.saveDirtyRegions().then(saved => {
                    if (!saved) console.warn('[WorldStorage] Background save retained dirty regions for retry');
                }).catch(err => console.error('[WorldStorage] Background save failed:', err.message));
            }
        }, 30000);  // 30 second interval
        
        console.log('[WorldStorage] RAM-first mode: Background saves ENABLED (every 30 seconds)');
    }
    
    /**
     * Force save all dirty regions to disk (call before exit)
     */
    async flushToDisk() {
        console.log('[WorldStorage] Flushing all data to disk...');

        for (const [key, { chunk }] of this.modificationQueue) {
            this.saveQueue.set(key, { chunk, options: {} });
        }
        this.modificationQueue.clear();
        
        // First, flush the save queue to ensure all pending chunks are processed
        if (this.saveQueue.size > 0) {
            console.log(`[WorldStorage] Flushing ${this.saveQueue.size} queued chunks before save...`);
            // Process all queued chunks synchronously
            while (this.saveQueue.size > 0) {
                const pendingBefore = this.saveQueue.size;
                await this._flushSaveQueue(pendingBefore, { reschedule: false });
                if (this.saveQueue.size >= pendingBefore) {
                    throw worldFormatError('WORLD_SAVE_QUEUE_FAILED', `${pendingBefore} queued chunk(s) could not enter the WAL`);
                }
            }
        }
        
        // Then save all dirty regions to disk
        if (!await this.saveDirtyRegions()) {
            throw worldFormatError('WORLD_REGION_SAVE_FAILED', 'Not every dirty region reached durable storage');
        }
        await this._flushFileLogs();  // Flush buffered logs to disk
        await this._saveMetadata();
        console.log('[WorldStorage] ✓ Flush complete');
        return true;
    }
    
    /**
     * Create multiple empty region files
     * @param {Array<{x, z, y?}>} regionCoords 
     */
    async createEmptyRegions(regionCoords) {
        console.log(`[WorldStorage] Creating ${regionCoords.length} empty region file(s)...`);
        
        let created = 0;
        for (const { x, z, y = 0 } of regionCoords) {
            const success = await this.createEmptyRegion(x, z, y);
            if (success) created++;
        }
        
        // Save world metadata with new regions
        await this._saveMetadata();
        
        console.log(`[WorldStorage] ✓ Created ${created} new region file(s)`);
        return created;
    }
    
    // ========================================================================
    // WRITE-AHEAD LOG (WAL) IMPLEMENTATION
    // ========================================================================
    // Based on SQLite WAL patterns, optimized for voxel game workloads:
    // - Append-only sequential writes (fast I/O)
    // - LSN (Log Sequence Numbers) for ordering
    // - Batched entries with CRC32 verification
    // - Idle-time checkpointing (doesn't block gameplay)
    // - Automatic truncation after checkpoint
    // ========================================================================
    
    /**
     * Start WAL flush timer for periodic writes
     * @private
     */
    _walStartFlushTimer() {
        if (this.walFlushTimer) clearInterval(this.walFlushTimer);
        
        this.walFlushTimer = setInterval(() => {
            // Temporary disable window after repeated permission errors
            if (this.walDisabledUntil && Date.now() < this.walDisabledUntil) {
                return;
            }
            if (this.walBuffer.length > 0) {
                this._walFlush();
            }
            
            // Schedule idle checkpoint ONCE if no recent writes
            const timeSinceWrite = Date.now() - this.walLastWrite;
            if (timeSinceWrite > WAL_IDLE_CHECKPOINT_MS && this.walFileSize > WAL_HEADER_SIZE && !this.walIdleCheckpointDone) {
                this.walIdleCheckpointDone = true;
                this._walCheckpoint();
            }
        }, WAL_BATCH_FLUSH_MS);
    }
    
    /**
     * Stop WAL timers
     * @private
     */
    _walStopTimers() {
        if (this.walFlushTimer) {
            clearInterval(this.walFlushTimer);
            this.walFlushTimer = null;
        }
        if (this.walIdleTimer) {
            clearTimeout(this.walIdleTimer);
            this.walIdleTimer = null;
        }
    }
    
    /**
     * Write a chunk modification to WAL (call BEFORE actual save)
     * @param {string} chunkKeyStr - Chunk key "x,y,z"
     * @param {Uint8Array} serializedData - Serialized chunk data
     * @private
     */
    _validateWalChunkWrite(chunkKeyStr, serializedData) {
        const coordinates = String(chunkKeyStr).split(',').map(value => Number(value));
        if (coordinates.length !== 3 || coordinates.some(value => !Number.isSafeInteger(value)
            || value < -2147483648 || value > 2147483647)) {
            throw worldFormatError('INVALID_WORLD_WAL_KEY', `Invalid WAL chunk key: ${chunkKeyStr}`);
        }
        if (!(serializedData instanceof Uint8Array)
            || serializedData.byteLength < 1
            || serializedData.byteLength > WAL_MAX_SIZE_BYTES) {
            throw worldFormatError('INVALID_WORLD_WAL_PAYLOAD', 'WAL chunk data must be a bounded Uint8Array');
        }
        const keyBytes = new TextEncoder().encode(String(chunkKeyStr));
        if (keyBytes.byteLength > 0xffff) {
            throw worldFormatError('INVALID_WORLD_WAL_KEY', 'WAL chunk key exceeds the 16-bit length limit');
        }
        if (this.walLSN >= 0xffffffff) {
            throw worldFormatError('UNSUPPORTED_WORLD_WAL_LSN', 'World WAL v1 exhausted its 32-bit LSN space');
        }
        return keyBytes;
    }

    _walWriteChunk(chunkKeyStr, serializedData) {
        const keyBytes = this._validateWalChunkWrite(chunkKeyStr, serializedData);
        this.walLSN++;
        this.walLastWrite = Date.now();
        this.walIdleCheckpointDone = false;  // Reset so checkpoint can happen again after idle
        
        // Entry format: LSN(8) + Type(1) + KeyLen(2) + Key + DataCRC(4) + DataLen(4) + Data
        const dataCrc = crc32(serializedData);
        
        const entrySize = 8 + 1 + 2 + keyBytes.length + 4 + 4 + serializedData.length;
        const entry = new Uint8Array(entrySize);
        const view = new DataView(entry.buffer);
        
        let offset = 0;
        
        // LSN (8 bytes as two 32-bit values for JS compatibility)
        view.setUint32(offset, this.walLSN >>> 0, true);
        view.setUint32(offset + 4, 0, true);  // High bits (for future >32-bit LSN)
        offset += 8;
        
        // Entry type
        entry[offset++] = WAL_ENTRY_CHUNK_WRITE;
        
        // Key length and key
        view.setUint16(offset, keyBytes.length, true);
        offset += 2;
        entry.set(keyBytes, offset);
        offset += keyBytes.length;
        
        // Data CRC for integrity verification
        view.setUint32(offset, dataCrc, true);
        offset += 4;
        
        // Data length and data
        view.setUint32(offset, serializedData.length, true);
        offset += 4;
        entry.set(serializedData, offset);
        
        this.walBuffer.push(entry);
        
        // Force flush if buffer getting large
        if (this.walBuffer.length >= 50) {
            this._walFlush();
        }
        return this.walLSN;
    }
    
    /**
     * Flush WAL buffer to disk (append-only)
     * @private
     */
    async _walFlush() {
        const previous = this.walOperationPromise;
        const run = (previous ?? Promise.resolve())
            .catch(() => false)
            .then(() => this._walFlushOnce());
        this.walOperationPromise = run;
        try {
            return await run;
        } finally {
            if (this.walOperationPromise === run) this.walOperationPromise = null;
        }
    }

    /**
     * Record a region mutation and its required durable WAL generation.
     * @private
     */
    _markRegionDirty(regionKey, walLSN = 0) {
        const version = (this.dirtyRegionVersions.get(regionKey) || 0) + 1;
        this.dirtyRegionVersions.set(regionKey, version);
        this.dirtyRegionWalLSNs.set(
            regionKey,
            Math.max(this.dirtyRegionWalLSNs.get(regionKey) || 0, walLSN)
        );
        this.dirtyRegions.add(regionKey);
        return version;
    }

    /** Clear a dirty marker only if no newer mutation replaced its snapshot. */
    _clearRegionDirtyGeneration(regionKey, version) {
        if (this.dirtyRegionVersions.get(regionKey) !== version) return false;
        this.dirtyRegions.delete(regionKey);
        this.dirtyRegionVersions.delete(regionKey);
        this.dirtyRegionWalLSNs.delete(regionKey);
        return true;
    }

    async _walFlushOnce() {
        if (this.walBuffer.length === 0) return true;

        // Temporary disable window after repeated permission errors
        if (this.walDisabledUntil && Date.now() < this.walDisabledUntil) {
            return false;
        }

        const entries = this.walBuffer;
        this.walBuffer = [];

        try {
            // Always inspect the durable generation. This makes retries
            // idempotent when createWritable().close() commits and then throws.
            const existingWal = await this.backend.readFile(WAL_FILE);
            let existing = null;
            let durableLastLSN = 0;
            let durableCheckpointLSN = 0;
            let prefix = new Uint8Array(WAL_HEADER_SIZE);

            if (existingWal !== null && existingWal !== undefined) {
                existing = parseWorldWal(existingWal);
                durableLastLSN = existing.header.lastLSN;
                durableCheckpointLSN = existing.header.checkpointLSN;
                if (durableLastLSN > this.walLSN
                    || durableLastLSN < this.walDurableLSN
                    || durableCheckpointLSN < this.walCheckpointLSN) {
                    throw worldFormatError('WORLD_WAL_LSN_DRIFT', 'Durable WAL LSN state moved outside the in-memory generation');
                }
                prefix = existingWal;

                // Entries requeued after an ambiguous commit may already be
                // durable. Drop them only after byte-for-byte verification.
                const durableEntries = new Map(existing.entries.map(entry => [entry.lsn, entry]));
                for (const bufferedEntry of entries) {
                    const bufferedView = new DataView(
                        bufferedEntry.buffer,
                        bufferedEntry.byteOffset,
                        bufferedEntry.byteLength
                    );
                    const lsn = bufferedView.getUint32(0, true);
                    if (lsn > durableLastLSN || lsn <= durableCheckpointLSN) continue;
                    const durableEntry = durableEntries.get(lsn);
                    if (!durableEntry || durableEntry.byteLength !== bufferedEntry.byteLength) {
                        throw worldFormatError('WORLD_WAL_ENTRY_DRIFT', `Durable WAL entry ${lsn} does not match its retry`);
                    }
                    const durableBytes = existingWal.subarray(
                        durableEntry.byteOffset,
                        durableEntry.byteOffset + durableEntry.byteLength
                    );
                    if (durableBytes.some((value, index) => value !== bufferedEntry[index])) {
                        throw worldFormatError('WORLD_WAL_ENTRY_DRIFT', `Durable WAL entry ${lsn} does not match its retry`);
                    }
                }
            } else if (this.walDurableLSN !== 0 || this.walCheckpointLSN !== 0 || this.walFileSize !== 0) {
                throw worldFormatError('WORLD_WAL_MISSING', 'The tracked durable WAL generation is missing');
            }

            const pendingEntries = entries.filter(entry => {
                const view = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);
                return view.getUint32(0, true) > durableLastLSN;
            });
            if (pendingEntries.length === 0) {
                this.walCheckpointLSN = durableCheckpointLSN;
                this.walDurableLSN = durableLastLSN;
                this.walFileSize = existingWal?.byteLength || 0;
                return true;
            }

            const pendingLSNs = pendingEntries.map(entry => (
                new DataView(entry.buffer, entry.byteOffset, entry.byteLength).getUint32(0, true)
            ));
            if (pendingLSNs[0] !== durableLastLSN + 1
                || pendingLSNs.some((lsn, index) => index > 0 && lsn !== pendingLSNs[index - 1] + 1)) {
                throw worldFormatError('WORLD_WAL_LSN_DRIFT', 'Buffered WAL entries are not a contiguous durable suffix');
            }

            const appendSize = pendingEntries.reduce((sum, entry) => sum + entry.byteLength, 0);
            const newWal = new Uint8Array(prefix.byteLength + appendSize);
            newWal.set(prefix, 0);
            let offset = prefix.byteLength;
            for (const entry of pendingEntries) {
                newWal.set(entry, offset);
                offset += entry.byteLength;
            }

            const committedLastLSN = pendingLSNs.at(-1);
            const headerView = new DataView(newWal.buffer);
            headerView.setUint32(0, WAL_MAGIC, true);
            headerView.setUint32(4, WAL_VERSION, true);
            headerView.setUint32(8, committedLastLSN, true);
            headerView.setUint32(12, 0, true);
            headerView.setUint32(16, durableCheckpointLSN, true);
            headerView.setUint32(20, 0, true);

            parseWorldWal(newWal);
            await this.backend.writeFile(WAL_FILE, newWal);
            this.walCheckpointLSN = durableCheckpointLSN;
            this.walDurableLSN = committedLastLSN;
            this.walFileSize = newWal.byteLength;
            this.walDisabledUntil = 0;
            this.walBackoffMs = 30000;

            // Check if checkpoint needed (WAL too large)
            if (this.walFileSize > WAL_MAX_SIZE_BYTES) {
                console.log(`[WAL] File size ${(this.walFileSize / 1024 / 1024).toFixed(1)}MB exceeds threshold, scheduling checkpoint`);
                setTimeout(() => this._walCheckpoint(), 100);
            }
            return true;
        } catch (err) {
            const msg = err?.message || String(err);
            const isPermissionError =
                err?.name === 'NotAllowedError' ||
                err?.name === 'SecurityError' ||
                msg.toLowerCase().includes('permission') ||
                msg.toLowerCase().includes('could not be read');

            // Re-add entries to buffer for retry (preserve order)
            this.walBuffer.unshift(...entries);

            if (isPermissionError) {
                // Backoff to avoid tight retry loop + main thread hitches
                const now = Date.now();
                this.walDisabledUntil = now + this.walBackoffMs;
                this.walBackoffMs = Math.min(this.walBackoffMs * 2, this.walMaxBackoffMs);

                // Log at most once per 5 seconds to prevent spam
                if (now - this.walLastErrorLog > 5000) {
                    this.walLastErrorLog = now;
                    console.warn(
                        `[WAL] Disabled for ${(this.walDisabledUntil - now) / 1000}s due to FileSystem permission/read error: ${msg}`
                    );
                }
                return false;
            }

            console.error('[WAL] Flush failed:', err);
            return false;
        }
    }
    
    /**
     * Checkpoint: Apply all WAL entries to regions and truncate WAL
     * Called during idle time or when WAL gets too large
     * @private
     */
    async _walCheckpoint() {
        const previous = this.walOperationPromise;
        const run = (previous ?? Promise.resolve())
            .catch(() => false)
            .then(() => this._walCheckpointOnce());
        this.walOperationPromise = run;
        try {
            return await run;
        } finally {
            if (this.walOperationPromise === run) this.walOperationPromise = null;
        }
    }

    async _walCheckpointOnce() {
        // Skip if nothing to checkpoint
        if (this.walBuffer.length === 0
            && this.walFileSize <= WAL_HEADER_SIZE
            && this.dirtyRegions.size === 0) {
            return true;
        }
        
        const startTime = performance.now();
        
        try {
            // Flush any pending entries first
            const flushed = await this._walFlushOnce();
            if (!flushed || this.walBuffer.length > 0) {
                throw worldFormatError('WORLD_WAL_FLUSH_FAILED', 'Cannot checkpoint while WAL entries remain unflushed');
            }
            const checkpointLSN = this.walDurableLSN;
            if (checkpointLSN !== this.walLSN) {
                throw worldFormatError('WORLD_WAL_FLUSH_FAILED', 'Cannot checkpoint an LSN that is not durable');
            }
            
            // Save all dirty regions (this applies the changes)
            const regionsSaved = await this.saveDirtyRegions({ walAlreadyFlushed: true });
            if (regionsSaved === false || this.dirtyRegions.size > 0) {
                throw worldFormatError('WORLD_WAL_REGION_SAVE_FAILED', 'Cannot checkpoint before every dirty region is durable');
            }
            if (this.walLSN !== checkpointLSN || this.walBuffer.length > 0) {
                throw worldFormatError('WORLD_WAL_CHANGED_DURING_CHECKPOINT', 'WAL changed while checkpoint regions were being persisted');
            }
            
            // Truncate WAL (write fresh header only)
            const freshWal = new Uint8Array(WAL_HEADER_SIZE);
            const headerView = new DataView(freshWal.buffer);
            
            headerView.setUint32(0, WAL_MAGIC, true);
            headerView.setUint32(4, WAL_VERSION, true);
            headerView.setUint32(8, this.walLSN >>> 0, true);
            headerView.setUint32(12, 0, true);
            headerView.setUint32(16, checkpointLSN >>> 0, true);
            headerView.setUint32(20, 0, true);
            
            await this.backend.writeFile(WAL_FILE, freshWal);
            this.walCheckpointLSN = checkpointLSN;
            this.walDurableLSN = checkpointLSN;
            this.walFileSize = WAL_HEADER_SIZE;
            
            // Only log slow checkpoints (>100ms) to reduce console spam
            const elapsed = performance.now() - startTime;
            if (elapsed > 100) {
                console.log(`[WAL] Checkpoint complete in ${elapsed.toFixed(1)}ms, LSN: ${this.walLSN}`);
            }
            return true;
        } catch (err) {
            console.error('[WAL] Checkpoint failed:', err);
            return false;
        }
    }
    
    /**
     * Recover from WAL after crash
     * Replays any entries that weren't checkpointed
     * @private
     */
    async _walRecover() {
        try {
            // Temporary disable window after repeated permission errors
            if (this.walDisabledUntil && Date.now() < this.walDisabledUntil) {
                return;
            }
            const walData = await this.backend.readFile(WAL_FILE);
            if (walData === null || walData === undefined) return;

            // Complete validation happens before regionManager or dirty-region
            // state can be touched. A partial WAL is retained for diagnosis.
            const parsedWal = parseWorldWal(walData);
            const { header, entries } = parsedWal;
            this.walLSN = header.lastLSN;
            this.walCheckpointLSN = header.checkpointLSN;
            this.walDurableLSN = header.lastLSN;
            this.walFileSize = walData.length;
            if (entries.length === 0) return;

            console.log(`[WAL] Recovering entries from LSN ${header.checkpointLSN} to ${header.lastLSN}...`);
            const replayRegions = new Map();
            for (const entry of entries) {
                const { regionX, regionZ } = this.regionManager.chunkToRegion(entry.x, entry.z);
                const regionKey = this.regionManager.regionKey(regionX, regionZ, entry.y);
                replayRegions.set(regionKey, { regionX, regionZ, regionY: entry.y });
            }
            for (const [regionKey, coordinates] of replayRegions) {
                await this._loadRegionFromDisk(
                    coordinates.regionX,
                    coordinates.regionZ,
                    coordinates.regionY,
                    regionKey,
                    true
                );
            }
            for (const entry of entries) {
                console.log(`[WAL] Recovering chunk (${entry.x},${entry.y},${entry.z}): ${entry.data.length} bytes, LSN=${entry.lsn}`);
                if (!this.regionManager.saveChunk(entry.x, entry.z, entry.data, entry.y)) {
                    throw worldFormatError('WORLD_WAL_REPLAY_FAILED', `Could not replay WAL chunk ${entry.key}`);
                }
                const { regionX, regionZ } = this.regionManager.chunkToRegion(entry.x, entry.z);
                this._markRegionDirty(this.regionManager.regionKey(regionX, regionZ, entry.y), entry.lsn);
            }

            console.log(`[WAL] Recovered ${entries.length} chunk(s), saving regions...`);
            const regionsSaved = await this.saveDirtyRegions({ walAlreadyFlushed: true });
            if (!regionsSaved || this.dirtyRegions.size > 0) {
                throw worldFormatError('WORLD_WAL_REGION_SAVE_FAILED', 'Recovered WAL regions were not fully persisted');
            }
            if (!await this._walCheckpoint()) {
                throw worldFormatError('WORLD_WAL_CHECKPOINT_FAILED', 'Recovered WAL could not be checkpointed');
            }
            console.log('[WAL] Recovery complete');
            
        } catch (error) {
            console.warn('[WAL] Recovery failed:', error);
            throw error;
        }
    }
    
    /**
     * Force WAL flush and checkpoint (call before shutdown)
     */
    async walShutdown() {
        this._walStopTimers();
        if (!await this._walFlush()) {
            throw worldFormatError('WORLD_WAL_FLUSH_FAILED', 'WAL shutdown could not flush pending entries');
        }
        if (!await this._walCheckpoint()) {
            throw worldFormatError('WORLD_WAL_CHECKPOINT_FAILED', 'WAL shutdown could not complete its checkpoint');
        }
    }
    
    /**
     * Start autosave timer
     * @private
     */
    _startAutosave() {
        if (this.autosaveTimer) {
            clearInterval(this.autosaveTimer);
        }
        
        this.autosaveTimer = setInterval(() => {
            this.saveAll().then(saved => {
                if (!saved) console.warn('[WorldStorage] Autosave retained pending data for retry');
            }).catch(error => console.error('[WorldStorage] Autosave failed:', error));
        }, AUTOSAVE_INTERVAL_MS);
    }
    
    /**
     * Stop autosave timer
     */
    stopAutosave() {
        if (this.autosaveTimer) {
            clearInterval(this.autosaveTimer);
            this.autosaveTimer = null;
        }
    }
    
    // ========================================================================
    // CHUNK OPERATIONS
    // ========================================================================
    
    /**
     * Set logging verbosity
     * @param {number} level - 0=silent, 1=summary only, 2=verbose
     */
    setVerbosity(level) {
        this.verbosity = level;
    }
    
    /**
     * Set player position for distance-based chunk loading priority
     * Chunks nearest to player will be loaded first
     * @param {number} chunkX - Player chunk X coordinate
     * @param {number} chunkY - Player chunk Y coordinate
     * @param {number} chunkZ - Player chunk Z coordinate
     */
    setPlayerPosition(chunkX, chunkY = 0, chunkZ) {
        this.playerChunk.x = chunkX;
        this.playerChunk.y = chunkY;
        this.playerChunk.z = chunkZ;
    }
    
    /**
     * Batch log helper - accumulates logs and flushes periodically
     * @private
     */
    _batchLog(type) {
        this.pendingLogs[type]++;
        
        if (!this.logBatchTimer) {
            this.logBatchTimer = setTimeout(() => {
                this._flushLogs();
            }, LOG_BATCH_FLUSH_MS);
        }
    }
    
    /**
     * Flush accumulated logs
     * @private
     */
    _flushLogs() {
        this.logBatchTimer = null;
        
        if (this.verbosity === 0) {
            this.pendingLogs = { loaded: 0, saved: 0, generated: 0 };
            return;
        }
        
        const { loaded, saved, generated } = this.pendingLogs;
        const parts = [];
        
        if (loaded > 0) parts.push(`${loaded} loaded`);
        if (saved > 0) parts.push(`${saved} saved`);
        if (generated > 0) parts.push(`${generated} generated`);
        
        // Silenced - too noisy
        // if (parts.length > 0) {
        //     console.log(`[WorldStorage] Chunks: ${parts.join(', ')}`);
        // }
        
        this.pendingLogs = { loaded: 0, saved: 0, generated: 0 };
    }
    
    /**
     * Queue chunk for batched save
     * @param {Object} chunk - Chunk with voxels, entities, coordinates
     * @param {Object} options 
     * @param {boolean} options.forceEmpty - Allow saving empty chunks (default: false)
     */
    queueSave(chunk, options = {}) {
        if (this.closing) throw worldFormatError('WORLD_STORAGE_CLOSING', 'Cannot queue a chunk while world storage is closing');
        // Block saves until storage is ready
        if (!this.isReady() && !options.force) {
            if (this.verbosity >= 2) {
                console.warn(`[WorldStorage] queueSave blocked - not ready (phase: ${this.initPhase})`);
            }
            return;
        }
        
        const key = chunkKey(chunk.cx ?? chunk.x, chunk.cy ?? chunk.y ?? 0, chunk.cz ?? chunk.z);
        
        // Count non-air voxels
        let nonAirCount = 0;
        if (chunk.voxels) {
            for (let i = 0; i < chunk.voxels.length; i++) {
                if (chunk.voxels[i] !== 0) nonAirCount++;
            }
        }
        
        // Skip saving completely empty chunks unless forced
        // This prevents overwriting terrain with empty air chunks
        if (nonAirCount === 0 && !options.forceEmpty) {
            return;
        }
        
        // CRITICAL: Copy voxels immediately to prevent corruption if chunk is
        // modified or unloaded before the save queue is flushed
        const chunkCopy = {
            x: chunk.cx ?? chunk.x,
            y: chunk.cy ?? chunk.y ?? 0,
            z: chunk.cz ?? chunk.z,
            voxels: chunk.voxels ? new Uint8Array(chunk.voxels) : null,
            entities: chunk.entities ? [...chunk.entities] : [],
            metadata: chunk.metadata ? { ...chunk.metadata } : {},
            size: chunk.size || 32,
        };
        
        this.saveQueue.set(key, { chunk: chunkCopy, options });
        
        // Start flush timer if not running
        if (!this.saveFlushTimer) {
            this.saveFlushTimer = setTimeout(() => {
                this._flushSaveQueue();
            }, SAVE_BATCH_FLUSH_MS);
        }
        
        // Force flush if queue too large
        if (this.saveQueue.size >= MAX_DIRTY_CHUNKS_BEFORE_SAVE) {
            this._flushSaveQueue();
        }
    }
    
    /**
     * Flush all queued saves at once
     * @private
     */
    async _flushSaveQueue(maxChunks = 8, { reschedule = true } = {}) {
        if (this.saveFlushTimer) {
            clearTimeout(this.saveFlushTimer);
            this.saveFlushTimer = null;
        }
        
        if (this.saveQueue.size === 0) return;
        
        const startTime = performance.now();
        const totalQueued = this.saveQueue.size;
        let count = 0;
        let totalBytes = 0;
        const FRAME_BUDGET_MS = 10;  // Stay well under 16ms frame budget
        
        // OPTIMIZATION: Limit chunks per flush to avoid blocking main thread
        // Process up to maxChunks OR until frame budget exceeded, reschedule if more remain
        for (const [key, { chunk, options }] of this.saveQueue) {
            if (count >= maxChunks) break; // Limit per flush
            
            // Check frame budget - if we're taking too long, yield to next frame
            const elapsed = performance.now() - startTime;
            if (elapsed > FRAME_BUDGET_MS && count > 0) break;
            
            let processed = false;
            try {
                const serialized = serializeChunk(chunk, {
                    chunkSize: chunk.size || 32,
                    deltaOnly: options.deltaOnly,
                });
                
                this._validateWalChunkWrite(key, serialized);
                const success = this.regionManager.saveChunk(chunk.x, chunk.z, serialized, chunk.y ?? 0);
                
                if (success) {
                    // The region file cannot be written until this WAL entry is durable.
                    const walLSN = this._walWriteChunk(key, serialized);
                    const { regionX, regionZ } = this.regionManager.chunkToRegion(chunk.x, chunk.z);
                    const regionKey = this.regionManager.regionKey(regionX, regionZ, chunk.y ?? 0);
                    this._markRegionDirty(regionKey, walLSN);
                    this.dirtyChunks.delete(key);
                    this.stats.chunksSaved++;
                    totalBytes += serialized.length;
                    
                    // Log successful save
                    this._logSave(chunk, serialized, 'success');
                    processed = true;
                } else {
                    // Log failed save
                    this._logSave(chunk, serialized, 'error', 'regionManager.saveChunk returned false');
                }
            } catch (err) {
                // Log save error
                this._logSave(chunk, null, 'error', err.message);
                console.error(`[WorldStorage] Save error for chunk (${chunk.x},${chunk.y ?? 0},${chunk.z}):`, err);
            }
            
            // Failed chunks stay queued; dropping them here loses the only
            // immutable snapshot that can be retried during shutdown.
            if (processed) this.saveQueue.delete(key);
            count++;
        }
        
        const elapsed = performance.now() - startTime;
        if (this.verbosity >= 2 && count > 0) {  // Reduced verbosity (was >= 1)
            const remaining = this.saveQueue.size;
            console.log(`[WorldStorage] Batched save: ${count}/${totalQueued} chunks (${(totalBytes/1024).toFixed(1)}KB) in ${elapsed.toFixed(1)}ms${remaining > 0 ? ` [${remaining} remaining]` : ''}`);
        }
        
        // Reschedule if more chunks remain (non-blocking)
        if (reschedule && this.saveQueue.size > 0) {
            this.saveFlushTimer = setTimeout(() => {
                this._flushSaveQueue(maxChunks);
            }, 50); // Shorter delay for faster processing
        }
        
        // Schedule deferred region save if needed (non-blocking)
        if (this.dirtyRegions.size >= 5) {
            this.scheduleDeferredSave();
        }
    }
    
    /**
     * Queue a chunk modification for idle-based saving
     * Call this when player damages/modifies terrain
     * @param {Object} chunk - Chunk that was modified
     */
    queueModification(chunk) {
        if (this.closing) throw worldFormatError('WORLD_STORAGE_CLOSING', 'Cannot queue a modification while world storage is closing');
        const key = chunkKey(chunk.cx ?? chunk.x, chunk.cy ?? chunk.y ?? 0, chunk.cz ?? chunk.z);
        
        // Copy voxels immediately to prevent data races
        const chunkCopy = {
            x: chunk.cx ?? chunk.x,
            y: chunk.cy ?? chunk.y ?? 0,
            z: chunk.cz ?? chunk.z,
            voxels: chunk.voxels ? new Uint8Array(chunk.voxels) : null,
            entities: chunk.entities ? [...chunk.entities] : [],
            metadata: chunk.metadata ? { ...chunk.metadata } : { solidCount: chunk.solidCount || 0 },
            size: chunk.size || 32,
        };
        
        this.modificationQueue.set(key, { 
            chunk: chunkCopy, 
            timestamp: Date.now() 
        });
        this.lastModificationTime = Date.now();
        
        // Reset idle timer - will flush when no modifications for idleFlushDelayMs
        this._resetIdleFlushTimer();
    }
    
    /**
     * Reset the idle flush timer
     * @private
     */
    _resetIdleFlushTimer() {
        if (this.idleFlushTimer) {
            clearTimeout(this.idleFlushTimer);
        }
        
        this.idleFlushTimer = setTimeout(() => {
            this._flushModificationQueue();
        }, this.idleFlushDelayMs);
    }
    
    /**
     * Flush all queued modifications to disk
     * Called automatically when idle detected
     * @private
     */
    async _flushModificationQueue() {
        this.idleFlushTimer = null;
        
        if (this.modificationQueue.size === 0) return;
        
        const count = this.modificationQueue.size;
        
        // Move all modifications to the save queue (quick, sync operation)
        for (const [key, { chunk }] of this.modificationQueue) {
            this.saveQueue.set(key, { chunk, options: {} });
        }
        this.modificationQueue.clear();
        
        // Flush save queue immediately (sync part)
        await this._flushSaveQueue();
        
        // Fire-and-forget the disk write - don't block main thread
        if (this.dirtyRegions.size > 0) {
            this.saveDirtyRegions().then(saved => {
                if (!saved) console.warn('[WorldStorage] Background modification save retained dirty regions');
            }).catch(err => console.warn('[WorldStorage] Background save failed:', err.message));
        }
    }
    
    /**
     * Force flush all modifications immediately
     * Call this before closing/unloading
     */
    async flushModifications() {
        if (this.idleFlushTimer) {
            clearTimeout(this.idleFlushTimer);
            this.idleFlushTimer = null;
        }
        await this._flushModificationQueue();
        return this.saveAll();
    }
    
    /**
     * Save chunk to storage (immediate - use queueSave for batching)
     * @param {Object} chunk - Chunk with voxels, entities, coordinates
     * @param {Object} options 
     */
    async saveChunk(chunk, options = {}) {
        if (this.closing) throw worldFormatError('WORLD_STORAGE_CLOSING', 'Cannot save a chunk while world storage is closing');
        const x = chunk.cx ?? chunk.x;
        const y = chunk.cy ?? chunk.y ?? 0;
        const z = chunk.cz ?? chunk.z;
        const key = chunkKey(x, y, z);
        
        // Serialize chunk
        const serialized = serializeChunk(chunk, {
            chunkSize: chunk.size || 32,
            deltaOnly: options.deltaOnly,
        });
        
        this._validateWalChunkWrite(key, serialized);
        const success = this.regionManager.saveChunk(x, z, serialized, y);
        
        if (success) {
            // The region file cannot be written until this WAL entry is durable.
            const walLSN = this._walWriteChunk(key, serialized);
            // Mark region dirty
            const { regionX, regionZ } = this.regionManager.chunkToRegion(x, z);
            const regionKey = this.regionManager.regionKey(regionX, regionZ, y);
            this._markRegionDirty(regionKey, walLSN);
            
            this.dirtyChunks.delete(key);
            this.stats.chunksSaved++;
            this._batchLog('saved');
        } else if (this.verbosity >= 2) {
            console.error(`[WorldStorage] ✗ Failed to save chunk (${x}, ${y}, ${z})`);
        }
        
        // Schedule deferred save if too many dirty regions (non-blocking)
        if (this.dirtyRegions.size >= 5) {
            this.scheduleDeferredSave();
        }
        
        return success;
    }
    
    /**
     * Load chunk from storage
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {Object} options 
     * @returns {Object|null}
     */
    async loadChunk(x, y, z, options = {}) {
        // Check if tracing this chunk
        const isTrace = this.traceChunk && this.traceChunk.x === x && this.traceChunk.y === y && this.traceChunk.z === z;
        if (isTrace) console.log(`[TraceChunk] loadChunk request (${x},${y},${z})`);
        
        // Block loads until storage is ready (unless forced)
        if (!this.isReady() && !options.force) {
            if (this.verbosity >= 2) {
                console.warn(`[WorldStorage] loadChunk blocked - not ready (phase: ${this.initPhase})`);
            }
            if (isTrace) console.log(`[TraceChunk] loadChunk BLOCKED - not ready`);
            return null;
        }
        
        const startTime = performance.now();
        
        // Ensure region is loaded
        const { regionX, regionZ } = this.regionManager.chunkToRegion(x, z);
        const regionY = y;
        if (isTrace) console.log(`[TraceChunk] chunk maps to region (${regionX},${regionZ},${regionY})`);
        await this._ensureRegionLoaded(regionX, regionZ, regionY);
        
        // Read from region
        let serialized = this.regionManager.loadChunk(x, z, y);
        if (isTrace) {
            if (!serialized) console.log(`[TraceChunk] loadChunk: NOT FOUND in region`);
            else console.log(`[TraceChunk] loadChunk: FOUND bytes=${serialized.length}`);
        }
        
        if (!serialized) {
            // Log not found
            this._logLoad(x, y, z, null, null, 'not_found');
            return null;  // Chunk doesn't exist
        }
        
        // Deserialize with data integrity verification
        let chunk;
        try {
            chunk = deserializeChunk(serialized, {
                chunkSize: options.chunkSize || 32,
            });
        } catch (error) {
            // Data corrupted - log it
            this._logLoad(x, y, z, null, serialized, 'corrupted', error.message);
            console.error(`[WorldStorage] Chunk (${x}, ${y}, ${z}) corrupted: ${error.message}`);
            
            if (this.backend.restoreFromBackup) {
                const region = this.regionManager.getRegion(regionX, regionZ, regionY);
                const filename = region.getFilename();
                
                console.log(`[WorldStorage] Attempting to restore region ${filename} from backup...`);
                const restored = await this.backend.restoreFromBackup(filename);
                
                if (restored) {
                    // Reload region and retry
                    region.deserialize(restored);
                    serialized = this.regionManager.loadChunk(x, z, y);
                    
                    if (serialized) {
                        try {
                            chunk = deserializeChunk(serialized, {
                                chunkSize: options.chunkSize || 32,
                            });
                            console.log(`[WorldStorage] ✓ Chunk (${x}, ${y}, ${z}) restored from backup`);
                            this._logLoad(x, y, z, chunk, serialized, 'restored_from_backup');
                        } catch (e) {
                            this._logLoad(x, y, z, null, serialized, 'backup_corrupted', e.message);
                            console.error(`[WorldStorage] Backup also corrupted for chunk (${x}, ${y}, ${z})`);
                            return null;
                        }
                    } else {
                        this._logLoad(x, y, z, null, null, 'backup_empty');
                        return null;
                    }
                } else {
                    this._logLoad(x, y, z, null, null, 'no_backup');
                    console.error(`[WorldStorage] No backup available for chunk (${x}, ${y}, ${z})`);
                    return null;
                }
            } else {
                return null;
            }
        }
        
        // Set coordinates
        chunk.x = x;
        chunk.y = y;
        chunk.z = z;
        
        // Log successful load
        this._logLoad(x, y, z, chunk, serialized, 'success');
        
        this.stats.chunksLoaded++;
        this.stats.loadTime += performance.now() - startTime;
        this.stats.bytesRead += serialized.length;
        this._batchLog('loaded');
        
        if (this.onLoadComplete) {
            this.onLoadComplete(chunk);
        }
        
        return chunk;
    }
    
    /**
     * Check if chunk exists in storage
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {boolean}
     */
    async hasChunk(x, y, z) {
        const { regionX, regionZ } = this.regionManager.chunkToRegion(x, z);
        const regionY = y;
        
        // Check if region is loaded
        const regionKey = this.regionManager.regionKey(regionX, regionZ, regionY);
        if (!this.loadedRegions.has(regionKey)) {
            // Try to load region
            await this._ensureRegionLoaded(regionX, regionZ, regionY);
        }
        
        return this.regionManager.hasChunk(x, z, y);
    }
    
    /**
     * Delete chunk from storage
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     */
    async deleteChunk(x, y, z) {
        if (this.closing) throw worldFormatError('WORLD_STORAGE_CLOSING', 'Cannot delete a chunk while world storage is closing');
        const success = this.regionManager.deleteChunk(x, z, y);
        
        if (success) {
            const { regionX, regionZ } = this.regionManager.chunkToRegion(x, z);
            const regionKey = this.regionManager.regionKey(regionX, regionZ, y);
            this._markRegionDirty(regionKey);
            
            // Clear history for this chunk
            this.historyManager.clearHistory(chunkKey(x, y, z));
        }
        
        return success;
    }
    
    /**
     * Mark chunk as dirty (needs saving)
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     */
    markChunkDirty(x, y, z) {
        if (this.closing) throw worldFormatError('WORLD_STORAGE_CLOSING', 'Cannot dirty a chunk while world storage is closing');
        this.dirtyChunks.add(chunkKey(x, y, z));
        
        // Auto-save if too many dirty chunks
        if (this.dirtyChunks.size >= MAX_DIRTY_CHUNKS_BEFORE_SAVE) {
            this.saveAll().then(saved => {
                if (!saved) console.warn('[WorldStorage] Dirty-chunk autosave retained pending data');
            }).catch(error => console.error('[WorldStorage] Dirty-chunk autosave failed:', error));
        }
    }
    
    // ========================================================================
    // LOAD OR GENERATE (Primary API for chunk loading)
    // ========================================================================
    
    /**
     * Load chunk if exists, otherwise generate and save it
     * This is the PRIMARY method for getting chunks - ensures no duplicate generation
     * 
     * @param {number} x - Chunk X coordinate
     * @param {number} y - Chunk Y coordinate  
     * @param {number} z - Chunk Z coordinate
     * @param {Function} generateFn - Function to generate chunk: (x, y, z) => {voxels, entities?, metadata?}
     * @param {Object} options
     * @param {boolean} options.batchSave - Use batched save instead of immediate (default: true)
     * @returns {Object} - Chunk data
     */
    async loadOrGenerate(x, y, z, generateFn, options = {}) {
        // First, try to load from storage
        const existing = await this.loadChunk(x, y, z, options);
        
        if (existing) {
            // Chunk exists - return it, don't regenerate!
            return existing;
        }
        
        // Chunk doesn't exist - generate it
        const startTime = performance.now();
        const generated = await generateFn(x, y, z);
        const genTime = performance.now() - startTime;
        
        // Build chunk object
        const chunk = {
            x,
            y,
            z,
            voxels: generated.voxels || generated,
            entities: generated.entities || [],
            metadata: generated.metadata || {},
            createdAt: Date.now(),
            modifiedAt: Date.now(),
        };
        
        this._batchLog('generated');
        
        // Save - use batched by default for better perf
        if (options.batchSave !== false) {
            this.queueSave(chunk, options);
        } else {
            await this.saveChunk(chunk, options);
            
            // Also save the region to disk right away
            const { regionX, regionZ } = this.regionManager.chunkToRegion(x, z);
            const regionY = y;
            const regionKey = this.regionManager.regionKey(regionX, regionZ, regionY);
            
            if (this.dirtyRegions.has(regionKey)
                && !await this._saveRegion(regionX, regionZ, regionY)) {
                throw worldFormatError('WORLD_REGION_SAVE_FAILED', `Generated region ${regionKey} could not be persisted`);
            }
        }
        
        this.stats.chunksGenerated = (this.stats.chunksGenerated || 0) + 1;
        
        return chunk;
    }
    
    /**
     * Batch load or generate multiple chunks
     * More efficient than calling loadOrGenerate individually
     * Chunks are sorted by distance from player position (nearest first)
     * 
     * @param {Array<{x, y, z}>} coords - Array of chunk coordinates
     * @param {Function} generateFn - Generation function
     * @param {Object} options
     * @param {Object} options.playerChunk - {x, y, z} player chunk coords for distance sorting
     * @returns {Map<string, Object>} - Map of chunkKey → chunk
     */
    async loadOrGenerateBatch(coords, generateFn, options = {}) {
        const results = new Map();
        const toGenerate = [];
        
        // Sort coords by distance from player (nearest first)
        // Uses stored player position if not explicitly provided in options
        let sortedCoords = coords;
        const playerPos = options.playerChunk || this.playerChunk;
        if (playerPos) {
            const px = playerPos.x || 0;
            const py = playerPos.y || 0;
            const pz = playerPos.z || 0;
            
            sortedCoords = [...coords].sort((a, b) => {
                const distA = (a.x - px) ** 2 + (a.y - py) ** 2 + (a.z - pz) ** 2;
                const distB = (b.x - px) ** 2 + (b.y - py) ** 2 + (b.z - pz) ** 2;
                return distA - distB;
            });
        }
        
        // First pass: check what already exists (in distance order)
        for (const { x, y, z } of sortedCoords) {
            const key = chunkKey(x, y, z);
            const existing = await this.loadChunk(x, y, z, options);
            
            if (existing) {
                results.set(key, existing);
            } else {
                toGenerate.push({ x, y, z, key });
            }
        }
        
        // Second pass: generate missing chunks
        for (const { x, y, z, key } of toGenerate) {
            const generated = await generateFn(x, y, z);
            
            const chunk = {
                x,
                y,
                z,
                voxels: generated.voxels || generated,
                entities: generated.entities || [],
                metadata: generated.metadata || {},
                createdAt: Date.now(),
                modifiedAt: Date.now(),
            };
            
            await this.saveChunk(chunk, options);
            results.set(key, chunk);
        }
        
        // Save all dirty regions
        if (!await this.saveDirtyRegions()) {
            throw worldFormatError('WORLD_REGION_SAVE_FAILED', 'Generated batch remains dirty after persistence failed');
        }
        
        return results;
    }
    
    /**
     * Check if chunk needs generation (doesn't exist in storage)
     * Use this to avoid generating chunks that already exist
     * 
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {boolean} - true if chunk needs to be generated
     */
    async needsGeneration(x, y, z) {
        return !(await this.hasChunk(x, y, z));
    }
    
    /**
     * Save a single region immediately
     * @private
     */
    async _saveRegion(regionX, regionZ, regionY = 0) {
        const regionKey = this.regionManager.regionKey(regionX, regionZ, regionY);
        const region = this.regionManager.regions.get(regionKey);
        
        if (!region) {
            console.warn(`[WorldStorage] _saveRegion: Region ${regionKey} not found in regionManager`);
            return false;
        }
        if (!this.dirtyRegions.has(regionKey)) return true;

        const saved = await this.saveDirtyRegions({ regionKeys: [regionKey] });
        if (!saved || this.dirtyRegions.has(regionKey)) {
            console.error(`[WorldStorage] _saveRegion: ✗ ${region.getFilename()} remains dirty`);
            return false;
        }
        console.log(`[WorldStorage] _saveRegion: ✓ Wrote ${region.getFilename()} successfully`);
        return true;
    }
    
    // ========================================================================
    // REGION OPERATIONS
    // ========================================================================
    
    /**
     * Set a chunk to trace for debugging load/save issues
     */
    setTraceChunk(x, y, z) {
        this.traceChunk = { x, y, z };
        console.log(`[TraceChunk] Tracking chunk (${x},${y},${z})`);
    }
    
    /**
     * Ensure region is loaded from disk
     * Uses loadingRegions Map to prevent race conditions where multiple chunks
     * request the same region simultaneously before it's loaded
     * @private
     */
    async _ensureRegionLoaded(regionX, regionZ, regionY = 0) {
        const regionKey = this.regionManager.regionKey(regionX, regionZ, regionY);
        
        // Check if tracing this region
        const isTraceRegion = this.traceChunk && (() => {
            const t = this.regionManager.chunkToRegion(this.traceChunk.x, this.traceChunk.z);
            return t.regionX === regionX && t.regionZ === regionZ && this.traceChunk.y === regionY;
        })();
        if (isTraceRegion) console.log(`[TraceChunk] _ensureRegionLoaded region=${regionKey}`);
        
        // Already fully loaded
        if (this.loadedRegions.has(regionKey)) {
            if (isTraceRegion) console.log(`[TraceChunk] region already loaded ${regionKey}`);
            return;
        }
        
        // Check if load is already in progress - await it instead of starting a new one (dedupe)
        if (this.loadingRegions.has(regionKey)) {
            this.cacheStats.dedupes++;
            this.onDedupe?.(regionKey);
            if (isTraceRegion) console.log(`[TraceChunk] await in-progress load ${regionKey}`);
            await this.loadingRegions.get(regionKey);
            return;
        }
        
        // Start loading and track the promise so concurrent requests can await it
        const loadPromise = this._loadRegionFromDisk(regionX, regionZ, regionY, regionKey);
        this.loadingRegions.set(regionKey, loadPromise);
        
        try {
            await loadPromise;
            if (isTraceRegion) console.log(`[TraceChunk] region loaded from disk ${regionKey}`);
        } finally {
            // Clean up loading tracker
            this.loadingRegions.delete(regionKey);
        }
    }
    
    /**
     * Actually load region from disk (internal helper)
     * @private
     */
    async _loadRegionFromDisk(regionX, regionZ, regionY, regionKey, strict = false) {
        const region = this.regionManager.getRegion(regionX, regionZ, regionY);
        const filename = region.getFilename();
        
        // Try to load from disk (logging disabled for performance - only log errors)
        const data = await this.backend.readRegion(filename);
        
        if (data && data.length < 8192) {
            if (strict) {
                throw worldFormatError('WORLD_WAL_REGION_CORRUPT', `Region ${filename} is too small for safe WAL replay`);
            }
            console.warn(`[WorldStorage] Region ${filename} is too small to deserialize`);
        } else if (data) {  // Minimum size for region header (2 sectors)
            const success = region.deserialize(data);
            if (success) {
                this.stats.bytesRead += data.length;
                this.stats.regionsLoaded = (this.stats.regionsLoaded || 0) + 1;
            } else {
                if (strict) {
                    throw worldFormatError('WORLD_WAL_REGION_CORRUPT', `Region ${filename} failed validation before WAL replay`);
                }
                console.warn(`[WorldStorage] ✗ Failed to deserialize region ${filename}`);
            }
        }
        // Silent for not-found - new regions are normal
        
        this.loadedRegions.add(regionKey);
    }
    
    /**
     * Schedule a deferred save (non-blocking, runs during idle time)
     * Saves ONE region per idle callback to prevent frame stalls
     */
    scheduleDeferredSave() {
        if (this.deferredSaveScheduled || this.dirtyRegions.size === 0) return;

        this.deferredSaveScheduled = true;

        const saveOneRegion = async () => {
            const regionKey = this.dirtyRegions.values().next().value;
            if (!regionKey) {
                this.deferredSaveScheduled = false;
                return;
            }
            const saved = await this.saveDirtyRegions({ regionKeys: [regionKey] });
            if (!saved) {
                console.warn(`[WorldStorage] Deferred save retained dirty region ${regionKey} for retry`);
            }

            // Schedule next region if more to save
            if (this.dirtyRegions.size > 0) {
                if (!saved) {
                    setTimeout(() => saveOneRegion(), 1000);
                } else if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(() => saveOneRegion(), { timeout: 2000 });
                } else {
                    setTimeout(() => saveOneRegion(), 100);
                }
            } else {
                this.deferredSaveScheduled = false;
                if (this.verbosity >= 1) {
                    console.log(`[WorldStorage] ✓ Incremental save complete`);
                }
            }
        };
        
        // Start the incremental save chain
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => saveOneRegion(), { timeout: 2000 });
        } else {
            setTimeout(() => saveOneRegion(), 100);
        }
    }
    
    /**
     * Save dirty regions to disk
     */
    async saveDirtyRegions(options = {}) {
        const requestedKeys = options.regionKeys ? [...new Set(options.regionKeys)] : null;
        const hasRequestedDirty = requestedKeys
            ? requestedKeys.some(regionKey => this.dirtyRegions.has(regionKey))
            : this.dirtyRegions.size > 0;
        if (!hasRequestedDirty) return true;

        // Join the WAL queue before the region queue. A checkpoint holds the WAL
        // queue while joining the region queue, so reversing this order deadlocks.
        if (!options.walAlreadyFlushed && !await this._walFlush()) return false;

        const previous = this.regionSavePromise;
        const run = (previous ?? Promise.resolve())
            .catch(() => false)
            .then(() => this._saveDirtyRegionsOnce({ ...options, regionKeys: requestedKeys }));
        this.regionSavePromise = run;
        try {
            return await run;
        } finally {
            if (this.regionSavePromise === run) this.regionSavePromise = null;
        }
    }

    async _saveDirtyRegionsOnce(options = {}) {
        const targetKeys = (options.regionKeys || [...this.dirtyRegions])
            .filter(regionKey => this.dirtyRegions.has(regionKey));
        if (targetKeys.length === 0) return true;
        const snapshots = targetKeys
            .map(regionKey => ({
                regionKey,
                version: this.dirtyRegionVersions.get(regionKey),
                requiredWalLSN: this.dirtyRegionWalLSNs.get(regionKey) || 0,
            }))
            .filter(snapshot => snapshot.version !== undefined
                && snapshot.requiredWalLSN <= this.walDurableLSN);
        if (snapshots.length === 0) return false;

        this.saving = true;
        const startTime = performance.now();
        const regionsToSave = snapshots.length;
        let allSucceeded = snapshots.length === targetKeys.length;
        
        if (this.verbosity >= 1) {
            console.log(`[WorldStorage] Saving ${regionsToSave} dirty region(s) to disk...`);
        }
        
        try { this.onSaveStart?.(); }
        catch (callbackError) { console.warn('[WorldStorage] onSaveStart callback failed:', callbackError); }
        
        try {
            // Prepare all save operations (serialize on main thread, write in parallel)
            const savePromises = [];
            
            for (const snapshot of snapshots) {
                const { regionKey } = snapshot;
                const region = this.regionManager.regions.get(regionKey);
                
                if (region) {
                    // Serialize synchronously (required for data consistency)
                    const regionData = region.serialize();
                    const filename = region.getFilename();
                    
                    // Queue async write (non-blocking)
                    savePromises.push(
                        this.backend.writeRegion(filename, regionData).then(() => ({
                            ...snapshot,
                            region,
                            filename,
                            bytes: regionData.length,
                            success: true,
                        })).catch(error => ({ ...snapshot, region, filename, success: false, error }))
                    );
                } else {
                    savePromises.push(Promise.resolve({
                        ...snapshot,
                        filename: regionKey,
                        success: false,
                        error: new Error(`Dirty region is not loaded: ${regionKey}`),
                    }));
                }
            }
            
            // Execute all writes in parallel (non-blocking)
            const results = await Promise.all(savePromises);
            for (const result of results) {
                if (!result.success) {
                    allSucceeded = false;
                    console.warn(`[WorldStorage] Failed to write ${result.filename}:`, result.error?.message || result.error);
                    continue;
                }
                this.stats.bytesWritten += result.bytes;
                if (this._clearRegionDirtyGeneration(result.regionKey, result.version)) {
                    result.region.dirty = false;
                } else {
                    // A newer mutation landed while this immutable snapshot was
                    // in flight. Its dirty marker and WAL requirement must win.
                    result.region.dirty = true;
                    allSucceeded = false;
                }
            }
            
            if (this.verbosity >= 2) {
                for (const r of results) {
                    if (r.success) {
                        console.log(`[WorldStorage] ✓ Wrote ${r.filename} (${r.bytes} bytes)`);
                    }
                }
            }
            
            // Save metadata (quick operation)
            if (allSucceeded) await this._saveMetadata();
            
        } catch (error) {
            allSucceeded = false;
            console.error('[WorldStorage] Save failed:', error);
            try { this.onError?.(error); }
            catch (callbackError) { console.warn('[WorldStorage] onError callback failed:', callbackError); }
        }
        
        const elapsed = performance.now() - startTime;
        this.stats.saveTime += elapsed;
        this.saving = false;
        
        if (this.verbosity >= 1 && allSucceeded) {
            console.log(`[WorldStorage] ✓ Save complete (${regionsToSave} regions in ${elapsed.toFixed(1)}ms)`);
        } else if (!allSucceeded) {
            console.warn(`[WorldStorage] Save incomplete; ${this.dirtyRegions.size} region(s) remain dirty`);
        }
        
        try { this.onSaveComplete?.(); }
        catch (callbackError) { console.warn('[WorldStorage] onSaveComplete callback failed:', callbackError); }
        return allSucceeded && targetKeys.every(regionKey => !this.dirtyRegions.has(regionKey));
    }
    
    /**
     * Unload region from memory
     * @param {number} regionX 
     * @param {number} regionZ 
     * @param {number} regionY 
     */
    async unloadRegion(regionX, regionZ, regionY = 0) {
        const regionKey = this.regionManager.regionKey(regionX, regionZ, regionY);
        
        // Save if dirty
        if (this.dirtyRegions.has(regionKey)) {
            const saved = await this.saveDirtyRegions({ regionKeys: [regionKey] });
            if (!saved || this.dirtyRegions.has(regionKey)) {
                console.warn(`[WorldStorage] Refusing to unload dirty region ${regionKey} after a failed save`);
                return false;
            }
        }

        const unloaded = this.regionManager.unloadRegion(regionX, regionZ, regionY);
        if (!unloaded) return false;
        this.loadedRegions.delete(regionKey);
        return true;
    }
    
    // ========================================================================
    // HISTORY OPERATIONS
    // ========================================================================
    
    /**
     * Record voxel change for undo
     */
    recordVoxelChange(chunkX, chunkY, chunkZ, voxelIndex, oldValue, newValue, playerId = 0) {
        const key = chunkKey(chunkX, chunkY, chunkZ);
        this.historyManager.recordVoxelChange(key, voxelIndex, oldValue, newValue, playerId);
    }
    
    /**
     * Record entity change for undo
     */
    recordEntitySpawn(chunkX, chunkY, chunkZ, entityId, entityData, playerId = 0) {
        const key = chunkKey(chunkX, chunkY, chunkZ);
        this.historyManager.recordEntitySpawn(key, entityId, entityData, playerId);
    }
    
    /**
     * Undo last change in chunk
     */
    undo(chunkX, chunkY, chunkZ, voxels, entities) {
        const key = chunkKey(chunkX, chunkY, chunkZ);
        return this.historyManager.undo(key, voxels, entities);
    }
    
    /**
     * Redo last undone change
     */
    redo(chunkX, chunkY, chunkZ, voxels, entities) {
        const key = chunkKey(chunkX, chunkY, chunkZ);
        return this.historyManager.redo(key, voxels, entities);
    }
    
    /**
     * Rollback chunk to timestamp
     */
    rollbackToTime(chunkX, chunkY, chunkZ, timestamp, voxels, entities) {
        const key = chunkKey(chunkX, chunkY, chunkZ);
        return this.historyManager.rollbackToTime(key, timestamp, voxels, entities);
    }
    
    // ========================================================================
    // WORLD OPERATIONS
    // ========================================================================
    
    /**
     * Save all dirty data
     */
    async saveAll() {
        for (const [key, { chunk }] of this.modificationQueue) {
            this.saveQueue.set(key, { chunk, options: {} });
        }
        this.modificationQueue.clear();
        while (this.saveQueue.size > 0) {
            const pendingBefore = this.saveQueue.size;
            await this._flushSaveQueue(pendingBefore, { reschedule: false });
            if (this.saveQueue.size >= pendingBefore) return false;
        }
        if (!await this.saveDirtyRegions()) return false;
        await this._saveMetadata();
        return true;
    }
    
    /**
     * Set player position for save
     * @param {Object} position 
     */
    setPlayerPosition(position) {
        this.metadata.playerPosition = position;
    }
    
    /**
     * Get player position from save
     * @returns {Object|null}
     */
    getPlayerPosition() {
        return this.metadata.playerPosition;
    }
    
    /**
     * Update play time
     * @param {number} deltaMs 
     */
    updatePlayTime(deltaMs) {
        this.metadata.playTime += deltaMs;
    }
    
    /**
     * Get world info
     * @returns {Object}
     */
    getWorldInfo() {
        return {
            name: this.worldName,
            seed: this.worldSeed,
            created: this.metadata.created,
            lastSaved: this.metadata.lastSaved,
            playTime: this.metadata.playTime,
        };
    }
    
    /**
     * List all saved worlds by checking IndexedDB for stored folder handles
     * @returns {Promise<string[]>}
     */
    static async listWorlds() {
        try {
            const db = await WorldStorage._openHandleDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('handles', 'readonly');
                const store = tx.objectStore('handles');
                const request = store.getAllKeys();
                request.onsuccess = () => {
                    db.close();
                    resolve(request.result || []);
                };
                request.onerror = () => {
                    db.close();
                    resolve([]);
                };
            });
        } catch (e) {
            console.warn('[WorldStorage] Could not list worlds:', e);
            return [];
        }
    }
    
    /**
     * Open IndexedDB for storing folder handles
     * @private
     */
    static _openHandleDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('WorldHandles', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('handles')) {
                    db.createObjectStore('handles', { keyPath: 'worldName' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    /**
     * Store a folder handle for a world (for Continue button)
     * @param {string} worldName
     * @param {FileSystemDirectoryHandle} handle
     */
    static async storeWorldHandle(worldName, handle) {
        try {
            const rootId = await WorldStorage._getOrCreateRootId(handle);
            const db = await WorldStorage._openHandleDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('handles', 'readwrite');
                const store = tx.objectStore('handles');
                store.put({ worldName, handle, lastAccess: Date.now(), rootId: rootId || null });
                tx.oncomplete = () => {
                    db.close();
                    console.log(`[WorldStorage] Stored handle for "${worldName}" root=${handle?.name || '?'} rootId=${rootId || 'null'}`);
                    resolve(true);
                };
                tx.onerror = () => {
                    db.close();
                    resolve(false);
                };
            });
        } catch (e) {
            console.warn('[WorldStorage] Could not store handle:', e);
            return false;
        }
    }

    static async _getOrCreateRootId(rootHandle) {
        try {
            const fileName = '.particle_realms_root_id';
            let fileHandle = await rootHandle.getFileHandle(fileName, { create: false }).catch(() => null);
            if (fileHandle) {
                const file = await fileHandle.getFile();
                const text = (await file.text()).trim();
                if (text) return text;
            }

            const id = _newWorldRootId();
            fileHandle = await rootHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(id);
            await writable.close();
            return id;
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Get stored folder handle for a world
     * @param {string} worldName
     * @returns {Promise<FileSystemDirectoryHandle|null>}
     */
    static async getWorldHandle(worldName) {
        try {
            const db = await WorldStorage._openHandleDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('handles', 'readonly');
                const store = tx.objectStore('handles');
                const request = store.get(worldName);
                request.onsuccess = async () => {
                    db.close();
                    const rec = request.result;
                    if (rec?.handle) {
                        console.log(`[WorldStorage] getWorldHandle("${worldName}") -> root=${rec.handle?.name || '?'} rootId=${rec.rootId || 'null'}`);

                        // Auto-repair legacy records (pre-rootId) so we can disambiguate folders named the same (e.g. multiple "data" dirs)
                        if (!rec.rootId) {
                            const repairedRootId = await WorldStorage._getOrCreateRootId(rec.handle);
                            if (repairedRootId) {
                                await WorldStorage.storeWorldHandle(worldName, rec.handle);
                                console.warn(`[WorldStorage] Repaired stored handle rootId for "${worldName}" -> ${repairedRootId}`);
                            }
                        }
                    } else {
                        console.log(`[WorldStorage] getWorldHandle("${worldName}") -> null`);
                    }
                    resolve(rec?.handle || null);
                };
                request.onerror = () => {
                    db.close();
                    resolve(null);
                };
            });
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Delete ONLY the stored folder handle (when the folder is gone or permission denied)
     * @param {string} worldName
     */
    static async deleteWorldHandleOnly(worldName) {
        try {
            const db = await WorldStorage._openHandleDB();
            await new Promise((resolve) => {
                const tx = db.transaction('handles', 'readwrite');
                tx.objectStore('handles').delete(worldName);
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => {
                    db.close();
                    resolve();
                };
            });
            console.warn(`[WorldStorage] Removed stored handle for "${worldName}" (handle-only purge)`);
            return true;
        } catch (e) {
            console.warn('[WorldStorage] Failed to delete handle-only entry:', e);
            return false;
        }
    }

    /**
     * Delete a saved world
     * @param {string} worldName 
     */
    static async deleteWorld(worldName) {
        try {
            const rootHandle = await WorldStorage.getWorldHandle(worldName);
            if (!rootHandle) {
                console.error(`[WorldStorage] Delete failed: no stored folder handle for "${worldName}"`);
                return false;
            }
            
            const permission = await rootHandle.queryPermission({ mode: 'readwrite' });
            if (permission !== 'granted') {
                const requested = await rootHandle.requestPermission({ mode: 'readwrite' });
                if (requested !== 'granted') {
                    console.error('[WorldStorage] Delete failed: permission denied');
                    return false;
                }
            }
            
            try {
                const worldsDir = await rootHandle.getDirectoryHandle('worlds', { create: false });
                await worldsDir.removeEntry(worldName, { recursive: true });
            } catch (e) {
                if (e?.name !== 'NotFoundError') throw e;
            }
            
            try {
                const db = await WorldStorage._openHandleDB();
                await new Promise((resolve) => {
                    const tx = db.transaction('handles', 'readwrite');
                    tx.objectStore('handles').delete(worldName);
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => {
                        db.close();
                        resolve();
                    };
                });
            } catch (e) {
            }
            
            return true;
        } catch (error) {
            console.error('[WorldStorage] Delete failed:', error);
            return false;
        }
    }
    
    /**
     * Clear all data for current world (WAL + regions)
     * Use this to fix corrupted world data
     */
    async clearWorldData() {
        console.log('[WorldStorage] Clearing all world data...');
        
        try {
            // Stop autosave and timers
            this.stopAutosave();
            if (this.walFlushTimer) clearInterval(this.walFlushTimer);
            
            // Clear WAL
            if (this.backend?.worldDir) {
                try {
                    await this.backend.worldDir.removeEntry('world.wal');
                    console.log('[WorldStorage] Deleted WAL file');
                } catch (e) { /* WAL might not exist */ }
                
                // Clear regions folder
                try {
                    await this.backend.worldDir.removeEntry('regions', { recursive: true });
                    await this.backend.worldDir.getDirectoryHandle('regions', { create: true });
                    console.log('[WorldStorage] Cleared regions folder');
                } catch (e) { /* regions might not exist */ }
                
                // Clear log files
                try {
                    await this.backend.worldDir.removeEntry('chunk_saves.log');
                    await this.backend.worldDir.removeEntry('chunk_loads.log');
                } catch (e) { /* logs might not exist */ }
            }
            
            // Reset state
            this.regionManager.regions.clear();
            this.loadedRegions.clear();
            this.dirtyChunks.clear();
            this.dirtyRegions.clear();
            this.dirtyRegionVersions.clear();
            this.dirtyRegionWalLSNs.clear();
            this.walBuffer = [];
            this.walLSN = 0;
            this.walCheckpointLSN = 0;
            this.walDurableLSN = 0;
            this.walFileSize = 0;
            
            console.log('[WorldStorage] World data cleared - reload page to regenerate terrain');
            return true;
        } catch (error) {
            console.error('[WorldStorage] Clear failed:', error);
            return false;
        }
    }
    
    /**
     * Get storage statistics
     * @returns {Object}
     */
    getStats() {
        return {
            ...this.stats,
            dirtyChunks: this.dirtyChunks.size,
            dirtyRegions: this.dirtyRegions.size,
            loadedRegions: this.loadedRegions.size,
            ...this.regionManager.getStats(),
            historyMemory: this.historyManager.getMemoryUsage(),
        };
    }
    
    /**
     * Cleanup and close
     */
    async close() {
        this.closing = true;
        this.stopAutosave();
        if (this.backgroundSaveTimer) {
            clearInterval(this.backgroundSaveTimer);
            this.backgroundSaveTimer = null;
        }
        if (this.idleFlushTimer) {
            clearTimeout(this.idleFlushTimer);
            this.idleFlushTimer = null;
        }
        if (this.saveFlushTimer) {
            clearTimeout(this.saveFlushTimer);
            this.saveFlushTimer = null;
        }

        // Preserve every queued immutable modification, not only the default
        // eight-chunk frame budget used during gameplay.
        for (const [key, { chunk }] of this.modificationQueue) {
            this.saveQueue.set(key, { chunk, options: {} });
        }
        this.modificationQueue.clear();
        await this._flushSaveQueue(Math.max(1, this.saveQueue.size), { reschedule: false });
        if (this.saveQueue.size > 0) {
            throw worldFormatError('WORLD_SAVE_QUEUE_FAILED', `${this.saveQueue.size} queued chunk(s) could not enter the WAL`);
        }
        this._flushLogs();
        
        // Shutdown WAL (flush + checkpoint)
        await this.walShutdown();
        
        // Clear timers
        if (this.logBatchTimer) clearTimeout(this.logBatchTimer);

        await this._saveMetadata();
        
        // Clear state
        this.regionManager.regions.clear();
        this.loadedRegions.clear();
        this.loadingRegions.clear();
        this.boundaryCache.clear();
        this.dirtyChunks.clear();
        this.dirtyRegions.clear();
        this.dirtyRegionVersions.clear();
        this.dirtyRegionWalLSNs.clear();
        
        this.initialized = false;
        console.log('[WorldStorage] Closed');
    }
    
    // ========================================================================
    // NEIGHBOR BOUNDARY BACKUP SYSTEM
    // ========================================================================
    
    /**
     * Cache chunk boundary data for backup/recovery
     * Uses LRU eviction with TTL support (inspired by async-cache-dedupe pattern)
     * @param {string} chunkKey - Chunk key (cx,cy,cz)
     * @param {Uint8Array} voxels - Full voxel array
     * @param {number} chunkSize - Size of chunk (default 32)
     */
    cacheBoundaryData(chunkKey, voxels, chunkSize = 32) {
        if (!this.boundaryBackupEnabled || !voxels) return;
        
        // LRU: If key exists, delete and re-add to move to end (most recent)
        if (this.boundaryCache.has(chunkKey)) {
            this.boundaryCache.delete(chunkKey);
        }
        
        // Evict oldest (LRU) entries if cache is full
        while (this.boundaryCache.size >= this.boundaryBackupMaxSize) {
            const oldestKey = this.boundaryCache.keys().next().value;
            const oldestData = this.boundaryCache.get(oldestKey);
            this.boundaryCache.delete(oldestKey);
            this.cacheStats.evictions++;
            // Call dispose callback for cleanup (inspired by lru-cache)
            this.onDispose?.(oldestKey, oldestData, 'evict');
        }
        
        // Extract boundary faces (1 voxel thick on each face)
        const boundary = {
            timestamp: Date.now(),
            // +X face (x = chunkSize-1)
            posX: new Uint8Array(chunkSize * chunkSize),
            // -X face (x = 0)
            negX: new Uint8Array(chunkSize * chunkSize),
            // +Y face (y = chunkSize-1)
            posY: new Uint8Array(chunkSize * chunkSize),
            // -Y face (y = 0)
            negY: new Uint8Array(chunkSize * chunkSize),
            // +Z face (z = chunkSize-1)
            posZ: new Uint8Array(chunkSize * chunkSize),
            // -Z face (z = 0)
            negZ: new Uint8Array(chunkSize * chunkSize),
        };
        
        for (let y = 0; y < chunkSize; y++) {
            for (let z = 0; z < chunkSize; z++) {
                // -X face (x=0)
                boundary.negX[y * chunkSize + z] = voxels[0 + y * chunkSize + z * chunkSize * chunkSize];
                // +X face (x=31)
                boundary.posX[y * chunkSize + z] = voxels[(chunkSize - 1) + y * chunkSize + z * chunkSize * chunkSize];
            }
        }
        
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                // -Y face (y=0)
                boundary.negY[x * chunkSize + z] = voxels[x + 0 * chunkSize + z * chunkSize * chunkSize];
                // +Y face (y=31)
                boundary.posY[x * chunkSize + z] = voxels[x + (chunkSize - 1) * chunkSize + z * chunkSize * chunkSize];
            }
        }
        
        for (let x = 0; x < chunkSize; x++) {
            for (let y = 0; y < chunkSize; y++) {
                // -Z face (z=0)
                boundary.negZ[x * chunkSize + y] = voxels[x + y * chunkSize + 0 * chunkSize * chunkSize];
                // +Z face (z=31)
                boundary.posZ[x * chunkSize + y] = voxels[x + y * chunkSize + (chunkSize - 1) * chunkSize * chunkSize];
            }
        }
        
        this.boundaryCache.set(chunkKey, boundary);
        
        // Call onInsert callback (inspired by lru-cache)
        this.onInsert?.(chunkKey, boundary);
    }
    
    /**
     * Async fetch with stale-while-revalidate (inspired by lru-cache fetchMethod)
     * Returns cached data immediately if fresh, or stale data while fetching fresh
     * @param {string} chunkKey
     * @param {Object} options - { forceRefresh: false }
     * @returns {Promise<Object|null>}
     */
    async fetchBoundaryData(chunkKey, options = {}) {
        // Try cache first
        const cached = this.getBoundaryData(chunkKey, { allowStale: true });
        
        if (cached && !cached._isStale && !options.forceRefresh) {
            return cached;  // Fresh data, return immediately
        }
        
        // No fetchMethod configured, just return cached (even if stale)
        if (!this.boundaryFetchMethod) {
            return cached;
        }
        
        // If stale, return stale data but trigger background refresh
        if (cached && cached._isStale) {
            // Background refresh (don't await)
            this.boundaryFetchMethod(chunkKey).then(fresh => {
                if (fresh) {
                    this.cacheBoundaryData(chunkKey, fresh.voxels);
                }
            }).catch(err => {
                console.warn(`[WorldStorage] Background fetch failed for ${chunkKey}:`, err);
            });
            
            return cached;  // Return stale immediately
        }
        
        // No cached data, must fetch synchronously
        try {
            const fresh = await this.boundaryFetchMethod(chunkKey);
            if (fresh) {
                this.cacheBoundaryData(chunkKey, fresh.voxels);
                return this.boundaryCache.get(chunkKey);
            }
        } catch (err) {
            console.warn(`[WorldStorage] Fetch failed for ${chunkKey}:`, err);
        }
        
        return null;
    }
    
    /**
     * Get cached boundary data for a chunk with TTL and stale-while-revalidate support
     * @param {string} chunkKey 
     * @param {Object} options - { allowStale: true } to return stale data
     * @returns {Object|null} Boundary data or null if not cached/expired
     */
    getBoundaryData(chunkKey, options = {}) {
        const data = this.boundaryCache.get(chunkKey);
        
        if (!data) {
            this.cacheStats.misses++;
            this.onCacheMiss?.(chunkKey);
            return null;
        }
        
        const now = Date.now();
        const age = now - data.timestamp;
        
        // Check if data is fresh (within TTL)
        if (age < this.boundaryTTL) {
            this.cacheStats.hits++;
            this.onCacheHit?.(chunkKey, data);
            
            // LRU: Move to end by delete + re-add
            this.boundaryCache.delete(chunkKey);
            this.boundaryCache.set(chunkKey, data);
            
            return data;
        }
        
        // Check if data is stale but within stale-while-revalidate window
        if (options.allowStale !== false && age < this.boundaryTTL + this.boundaryStaleTTL) {
            this.cacheStats.staleHits++;
            this.onCacheHit?.(chunkKey, data);
            
            // Return stale data - caller should trigger background refresh
            data._isStale = true;
            return data;
        }
        
        // Data is too old, remove it
        this.boundaryCache.delete(chunkKey);
        this.cacheStats.misses++;
        this.onCacheMiss?.(chunkKey);
        return null;
    }
    
    /**
     * Verify chunk boundary matches neighbor's cached boundary
     * Returns mismatches for debugging/repair
     * @param {string} chunkKey 
     * @param {Uint8Array} voxels 
     * @param {Object} neighbors - Map of direction -> neighborChunkKey
     * @param {number} chunkSize 
     * @returns {Array} Array of mismatches {dir, x, y, z, expected, actual}
     */
    verifyBoundaryConsistency(chunkKey, voxels, neighbors, chunkSize = 32) {
        const mismatches = [];
        
        // Check each neighbor's boundary against ours
        const dirChecks = [
            { dir: 'posX', neighborDir: 'negX', getOurs: (y, z) => voxels[(chunkSize - 1) + y * chunkSize + z * chunkSize * chunkSize] },
            { dir: 'negX', neighborDir: 'posX', getOurs: (y, z) => voxels[0 + y * chunkSize + z * chunkSize * chunkSize] },
            { dir: 'posY', neighborDir: 'negY', getOurs: (x, z) => voxels[x + (chunkSize - 1) * chunkSize + z * chunkSize * chunkSize] },
            { dir: 'negY', neighborDir: 'posY', getOurs: (x, z) => voxels[x + 0 * chunkSize + z * chunkSize * chunkSize] },
            { dir: 'posZ', neighborDir: 'negZ', getOurs: (x, y) => voxels[x + y * chunkSize + (chunkSize - 1) * chunkSize * chunkSize] },
            { dir: 'negZ', neighborDir: 'posZ', getOurs: (x, y) => voxels[x + y * chunkSize + 0 * chunkSize * chunkSize] },
        ];
        
        for (const check of dirChecks) {
            const neighborKey = neighbors[check.dir];
            if (!neighborKey) continue;
            
            const neighborBoundary = this.boundaryCache.get(neighborKey);
            if (!neighborBoundary) continue;
            
            const neighborFace = neighborBoundary[check.neighborDir];
            if (!neighborFace) continue;
            
            // Compare boundaries
            for (let i = 0; i < chunkSize; i++) {
                for (let j = 0; j < chunkSize; j++) {
                    const ours = check.getOurs(i, j);
                    const theirs = neighborFace[i * chunkSize + j];
                    
                    // Boundaries should be consistent (adjacent voxels)
                    // This is informational - boundaries are adjacent, not same
                    // Log if both are solid but different materials (potential issue)
                    if (ours !== 0 && theirs !== 0 && ours !== theirs) {
                        if (mismatches.length < 20) {
                            mismatches.push({
                                dir: check.dir,
                                i, j,
                                ours,
                                theirs,
                                neighborKey
                            });
                        }
                    }
                }
            }
        }
        
        return mismatches;
    }
    
    /**
     * Log chunk load/save with neighbor info for debugging
     * @param {number} cx 
     * @param {number} cy 
     * @param {number} cz 
     * @param {string} action - 'load', 'save', 'gen'
     * @param {number} voxelCount 
     */
    logChunkAction(cx, cy, cz, action, voxelCount) {
        if (this.verbosity < 2) return;
        
        const key = `${cx},${cy},${cz}`;
        const neighbors = [
            `+X:${cx + 1},${cy},${cz}`,
            `-X:${cx - 1},${cy},${cz}`,
            `+Y:${cx},${cy + 1},${cz}`,
            `-Y:${cx},${cy - 1},${cz}`,
            `+Z:${cx},${cy},${cz + 1}`,
            `-Z:${cx},${cy},${cz - 1}`,
        ];
        
        console.log(`[ChunkAction] ${action.toUpperCase()} (${key}): ${voxelCount} voxels, neighbors: ${neighbors.join(', ')}`);
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { OPFSBackend, IndexedDBBackend, FileSystemBackend };

export default WorldStorage;
