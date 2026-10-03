// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkRegistry.js - Central Chunk Existence and Integrity Registry
 * 
 * Solves:
 * 1. Duplicate generation - fast O(1) existence check before generating
 * 2. Corruption detection - content hash verification
 * 3. Race conditions - atomic claim/release for chunk operations
 * 4. Missing chunks - tracks all known chunks with metadata
 * 
 * Uses:
 * - In-memory Map for fast lookups
 * - Content hashing (xxHash) for integrity verification
 * - Temp file staging for atomic saves
 * - Persistent index file for cross-session awareness
 */

import {
    fnv1aInt32Sequence32,
    xxHash32 as checksumXxHash32,
} from '../core/math/ChecksumMath.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const REGISTRY_VERSION = 1;
const REGISTRY_MAGIC = 0x52454743;  // "CREG" - Chunk Registry
const INDEX_FILENAME = 'chunk_index.bin';
const TEMP_SUFFIX = '.tmp';

// Chunk states in registry
export const ChunkStatus = {
    UNKNOWN: 0,       // Not in registry
    GENERATING: 1,    // Currently being generated (claimed)
    LOADING: 2,       // Currently being loaded from disk
    READY: 3,         // Exists and ready
    SAVING: 4,        // Currently being saved
    DIRTY: 5,         // Modified, needs save
    CORRUPTED: 6,     // Failed integrity check
};

// ============================================================================
// FAST HASH FUNCTION (xxHash-inspired, 32-bit)
// ============================================================================

/**
 * Fast 32-bit hash for chunk content verification
 * @param {Uint8Array|Uint32Array} data 
 * @param {number} seed 
 * @returns {number} - 32-bit hash
 */
export function xxHash32(data, seed = 0) {
    return checksumXxHash32(data, seed);
}

/**
 * Hash voxel data for quick integrity check
 * Uses sampling for very large arrays (faster)
 * @param {Uint8Array} voxels 
 * @returns {number}
 */
export function hashVoxels(voxels) {
    if (!voxels || voxels.length === 0) return 0;
    
    // For full 32³ chunks, use full hash
    if (voxels.length <= 32768) {
        return xxHash32(voxels);
    }
    
    // For larger data, sample every 4th byte
    const sampled = new Uint8Array(voxels.length >> 2);
    for (let i = 0; i < sampled.length; i++) {
        sampled[i] = voxels[i << 2];
    }
    return xxHash32(sampled);
}

// ============================================================================
// BLOOM FILTER - Ultra-fast O(1) existence check (~2% memory of Set)
// Based on: https://systemdesign.one/bloom-filters-explained/
// ============================================================================

const BLOOM_SIZE = 65536;  // 64KB bit array = 524288 bits
const BLOOM_HASH_COUNT = 7;  // Optimal for ~0.8% false positive rate

export function chunkRegistryBloomCoordinateHash(cx, cy, cz) {
    return fnv1aInt32Sequence32([cx, cy, cz]);
}

/**
 * Bloom Filter for ultra-fast chunk existence checks
 * - O(1) time for add/check
 * - No false negatives (if says "no", definitely doesn't exist)
 * - Small false positive rate (~0.8%)
 * - Uses ~2% memory of equivalent Set
 */
export class BloomFilter {
    constructor(size = BLOOM_SIZE) {
        this.bits = new Uint8Array(size);
        this.size = size * 8;  // Total bits
        this.count = 0;
    }
    
    /**
     * Generate k hash indices from chunk coordinates
     * Uses double hashing: h(i) = h1 + i*h2
     */
    _getIndices(cx, cy, cz) {
        const h1 = chunkRegistryBloomCoordinateHash(cx, cy, cz);
        // Historical secondary hash used the same seed and mixing as h1; keep it for index compatibility.
        const h2 = h1;
        
        const indices = new Uint32Array(BLOOM_HASH_COUNT);
        for (let i = 0; i < BLOOM_HASH_COUNT; i++) {
            indices[i] = ((h1 + i * h2) >>> 0) % this.size;
        }
        return indices;
    }
    
    /**
     * Add chunk to bloom filter
     */
    add(cx, cy, cz) {
        const indices = this._getIndices(cx, cy, cz);
        for (const idx of indices) {
            const byteIdx = idx >>> 3;
            const bitIdx = idx & 7;
            this.bits[byteIdx] |= (1 << bitIdx);
        }
        this.count++;
    }
    
    /**
     * Check if chunk might exist (no false negatives)
     * @returns {boolean} - false = definitely doesn't exist, true = probably exists
     */
    mightExist(cx, cy, cz) {
        const indices = this._getIndices(cx, cy, cz);
        for (const idx of indices) {
            const byteIdx = idx >>> 3;
            const bitIdx = idx & 7;
            if ((this.bits[byteIdx] & (1 << bitIdx)) === 0) {
                return false;  // Definitely doesn't exist
            }
        }
        return true;  // Probably exists (check full registry to confirm)
    }
    
    /**
     * Clear the bloom filter
     */
    clear() {
        this.bits.fill(0);
        this.count = 0;
    }
    
    /**
     * Get estimated false positive rate
     */
    getFalsePositiveRate() {
        const m = this.size;
        const k = BLOOM_HASH_COUNT;
        const n = this.count;
        return Math.pow(1 - Math.exp(-k * n / m), k);
    }
}

// ============================================================================
// MORTON/Z-ORDER ENCODING - Better spatial locality for chunk lookups
// Based on: https://en.wikipedia.org/wiki/Z-order_curve
// ============================================================================

/**
 * Encode 3D chunk coordinates to Morton code (Z-order)
 * Interleaves bits for better cache locality in spatial queries
 * @param {number} x - Chunk X (-1024 to 1023)
 * @param {number} y - Chunk Y (-1024 to 1023) 
 * @param {number} z - Chunk Z (-1024 to 1023)
 * @returns {number} - 32-bit Morton code
 */
export function encodeMorton3D(x, y, z) {
    // Offset to handle negative coordinates
    const ux = (x + 512) & 0x3FF;  // 10 bits
    const uy = (y + 512) & 0x3FF;
    const uz = (z + 512) & 0x3FF;
    
    return interleave3(ux, uy, uz);
}

/**
 * Decode Morton code back to 3D coordinates
 */
export function decodeMorton3D(morton) {
    const [ux, uy, uz] = deinterleave3(morton);
    return [ux - 512, uy - 512, uz - 512];
}

// Bit interleaving helpers (magic number method)
function interleave3(x, y, z) {
    x = (x | (x << 16)) & 0x030000FF;
    x = (x | (x << 8)) & 0x0300F00F;
    x = (x | (x << 4)) & 0x030C30C3;
    x = (x | (x << 2)) & 0x09249249;
    
    y = (y | (y << 16)) & 0x030000FF;
    y = (y | (y << 8)) & 0x0300F00F;
    y = (y | (y << 4)) & 0x030C30C3;
    y = (y | (y << 2)) & 0x09249249;
    
    z = (z | (z << 16)) & 0x030000FF;
    z = (z | (z << 8)) & 0x0300F00F;
    z = (z | (z << 4)) & 0x030C30C3;
    z = (z | (z << 2)) & 0x09249249;
    
    return (x | (y << 1) | (z << 2)) >>> 0;
}

function deinterleave3(morton) {
    let x = morton & 0x09249249;
    let y = (morton >> 1) & 0x09249249;
    let z = (morton >> 2) & 0x09249249;
    
    x = (x | (x >> 2)) & 0x030C30C3;
    x = (x | (x >> 4)) & 0x0300F00F;
    x = (x | (x >> 8)) & 0x030000FF;
    x = (x | (x >> 16)) & 0x000003FF;
    
    y = (y | (y >> 2)) & 0x030C30C3;
    y = (y | (y >> 4)) & 0x0300F00F;
    y = (y | (y >> 8)) & 0x030000FF;
    y = (y | (y >> 16)) & 0x000003FF;
    
    z = (z | (z >> 2)) & 0x030C30C3;
    z = (z | (z >> 4)) & 0x0300F00F;
    z = (z | (z >> 8)) & 0x030000FF;
    z = (z | (z >> 16)) & 0x000003FF;
    
    return [x, y, z];
}

// ============================================================================
// TRAILER CANARY - Detect torn/partial writes
// Based on: UnisonDB WAL design
// ============================================================================

const TRAILER_CANARY = 0xDEADBEEF;  // Magic value to detect complete writes
const RECORD_ALIGNMENT = 8;  // 8-byte alignment prevents torn headers

/**
 * Append trailer canary to data for torn write detection
 */
export function appendTrailer(data) {
    const aligned = alignTo(data.length + 4, RECORD_ALIGNMENT);
    const result = new Uint8Array(aligned);
    result.set(data);
    
    // Write canary at end
    const view = new DataView(result.buffer);
    view.setUint32(aligned - 4, TRAILER_CANARY, true);
    
    return result;
}

/**
 * Verify trailer canary is present (write was complete)
 */
export function verifyTrailer(data) {
    if (data.length < 4) return false;
    
    const view = new DataView(data.buffer, data.byteOffset);
    const canary = view.getUint32(data.length - 4, true);
    
    return canary === TRAILER_CANARY;
}

function alignTo(size, alignment) {
    return Math.ceil(size / alignment) * alignment;
}

// ============================================================================
// CHUNK ENTRY
// ============================================================================

class ChunkRegistryEntry {
    constructor(cx, cy, cz) {
        this.cx = cx;
        this.cy = cy;
        this.cz = cz;
        this.key = `${cx},${cy},${cz}`;
        
        // Status
        this.status = ChunkStatus.UNKNOWN;
        
        // Integrity
        this.contentHash = 0;           // xxHash32 of voxel data
        this.voxelCount = 0;            // Non-air voxel count
        this.byteSize = 0;              // Serialized size
        
        // Timestamps
        this.createdAt = 0;
        this.modifiedAt = 0;
        this.lastAccessAt = 0;
        this.lastVerifiedAt = 0;        // Last integrity check
        
        // Source tracking
        this.source = 'unknown';        // 'generated', 'loaded', 'modified'
        this.generation = 0;            // Incremented on each save
        
        // Lock for atomic operations
        this.lockedBy = null;           // Source that has exclusive access
        this.lockTime = 0;
    }
    
    /**
     * Try to acquire exclusive lock
     * @param {string} source 
     * @param {number} timeoutMs 
     * @returns {boolean}
     */
    tryLock(source, timeoutMs = 5000) {
        const now = Date.now();
        
        // Check for stale lock (>5s = assume dead)
        if (this.lockedBy && (now - this.lockTime) > timeoutMs) {
            console.warn(`[ChunkRegistry] Stale lock on ${this.key} by ${this.lockedBy}, forcing unlock`);
            this.lockedBy = null;
        }
        
        if (this.lockedBy && this.lockedBy !== source) {
            return false;
        }
        
        this.lockedBy = source;
        this.lockTime = now;
        return true;
    }
    
    /**
     * Release lock
     * @param {string} source 
     */
    unlock(source) {
        if (this.lockedBy === source) {
            this.lockedBy = null;
            this.lockTime = 0;
        }
    }
    
    /**
     * Check if locked by someone else
     */
    isLocked(excludeSource = null) {
        if (!this.lockedBy) return false;
        if (excludeSource && this.lockedBy === excludeSource) return false;
        
        // Check for stale
        if ((Date.now() - this.lockTime) > 5000) {
            this.lockedBy = null;
            return false;
        }
        
        return true;
    }
    
    /**
     * Serialize entry for index file
     */
    serialize() {
        const buffer = new ArrayBuffer(48);
        const view = new DataView(buffer);
        let offset = 0;
        
        view.setInt32(offset, this.cx, true); offset += 4;
        view.setInt32(offset, this.cy, true); offset += 4;
        view.setInt32(offset, this.cz, true); offset += 4;
        view.setUint8(offset, this.status); offset += 1;
        view.setUint32(offset, this.contentHash, true); offset += 4;
        view.setUint32(offset, this.voxelCount, true); offset += 4;
        view.setUint32(offset, this.byteSize, true); offset += 4;
        view.setFloat64(offset, this.createdAt, true); offset += 8;
        view.setFloat64(offset, this.modifiedAt, true); offset += 8;
        view.setUint16(offset, this.generation, true); offset += 2;
        // 5 bytes padding for alignment
        
        return new Uint8Array(buffer);
    }
    
    /**
     * Deserialize from buffer
     */
    static deserialize(buffer, offset = 0) {
        const view = new DataView(buffer, offset);
        let off = 0;
        
        const cx = view.getInt32(off, true); off += 4;
        const cy = view.getInt32(off, true); off += 4;
        const cz = view.getInt32(off, true); off += 4;
        
        const entry = new ChunkRegistryEntry(cx, cy, cz);
        
        entry.status = view.getUint8(off); off += 1;
        entry.contentHash = view.getUint32(off, true); off += 4;
        entry.voxelCount = view.getUint32(off, true); off += 4;
        entry.byteSize = view.getUint32(off, true); off += 4;
        entry.createdAt = view.getFloat64(off, true); off += 8;
        entry.modifiedAt = view.getFloat64(off, true); off += 8;
        entry.generation = view.getUint16(off, true); off += 2;
        
        return entry;
    }
}

// ============================================================================
// CHUNK REGISTRY
// ============================================================================

export class ChunkRegistry {
    constructor() {
        // Main storage: key → ChunkRegistryEntry
        this.entries = new Map();
        
        // Fast existence check set (just keys)
        this.existsOnDisk = new Set();
        
        // Bloom filter for ultra-fast existence pre-check (~0.8% false positive)
        this.bloomFilter = new BloomFilter();
        
        // Morton-indexed spatial lookup (for range queries)
        this.mortonIndex = new Map();  // morton → key
        
        // Pending operations (for deduplication)
        this.pendingLoads = new Map();   // key → Promise
        this.pendingGens = new Map();    // key → Promise
        this.pendingSaves = new Map();   // key → Promise
        
        // Stats
        this.stats = {
            totalEntries: 0,
            onDisk: 0,
            inMemory: 0,
            corrupted: 0,
            duplicatesPrevented: 0,
            lockConflicts: 0,
            integrityChecks: 0,
            integrityFailures: 0,
            bloomHits: 0,           // Bloom filter said "probably exists"
            bloomMisses: 0,         // Bloom filter said "definitely doesn't exist"
            bloomFalsePositives: 0, // Bloom said yes, but actually no
        };
        
        // Config
        this.verifyOnLoad = true;        // Verify hash on load
        this.trackAllLoads = true;       // Track even non-modified chunks
        this.useBloomFilter = true;      // Use bloom filter for fast negative checks
        
        // Persistence
        this.backend = null;             // Storage backend reference
        this.dirty = false;              // Index needs saving
        this.lastSaveTime = 0;
        
        this.initialized = false;
    }
    
    /**
     * Initialize registry, optionally loading existing index
     * @param {Object} backend - Storage backend with readFile/writeFile
     */
    async init(backend = null) {
        this.backend = backend;
        
        if (backend) {
            await this._loadIndex();
        }
        
        this.initialized = true;
        console.log(`[ChunkRegistry] Initialized: ${this.entries.size} entries, ${this.existsOnDisk.size} on disk`);
    }
    
    // ========================================================================
    // EXISTENCE CHECKS (Fast path - no disk I/O)
    // ========================================================================
    
    /**
     * Check if chunk exists (in memory or on disk)
     * O(1) lookup - use this before generating!
     * Uses bloom filter for fast negative check first
     * @param {number} cx 
     * @param {number} cy 
     * @param {number} cz 
     * @returns {boolean}
     */
    exists(cx, cy, cz) {
        // Fast path: bloom filter says definitely doesn't exist
        if (this.useBloomFilter && !this.bloomFilter.mightExist(cx, cy, cz)) {
            this.stats.bloomMisses++;
            return false;
        }
        
        // Bloom filter says might exist - verify with full check
        const key = `${cx},${cy},${cz}`;
        const reallyExists = this.entries.has(key) || this.existsOnDisk.has(key);
        
        if (this.useBloomFilter) {
            if (reallyExists) {
                this.stats.bloomHits++;
            } else {
                this.stats.bloomFalsePositives++;
            }
        }
        
        return reallyExists;
    }
    
    /**
     * Check if chunk exists on disk specifically
     */
    existsOnDiskOnly(cx, cy, cz) {
        return this.existsOnDisk.has(`${cx},${cy},${cz}`);
    }
    
    /**
     * Check if chunk is currently being processed
     */
    isPending(cx, cy, cz) {
        const key = `${cx},${cy},${cz}`;
        return this.pendingLoads.has(key) || 
               this.pendingGens.has(key) || 
               this.pendingSaves.has(key);
    }
    
    /**
     * Get existing pending promise for deduplication
     */
    getPendingPromise(cx, cy, cz) {
        const key = `${cx},${cy},${cz}`;
        return this.pendingLoads.get(key) || 
               this.pendingGens.get(key) || 
               this.pendingSaves.get(key);
    }
    
    // ========================================================================
    // CLAIM/RELEASE (Prevents duplicate work)
    // ========================================================================
    
    /**
     * Claim a chunk for generation (prevents duplicates)
     * @param {number} cx 
     * @param {number} cy 
     * @param {number} cz 
     * @param {string} source - Who is claiming
     * @returns {{ claimed: boolean, reason?: string, entry?: ChunkRegistryEntry }}
     */
    claimForGeneration(cx, cy, cz, source = 'generator') {
        const key = `${cx},${cy},${cz}`;
        
        // Already exists - don't regenerate!
        if (this.exists(cx, cy, cz)) {
            this.stats.duplicatesPrevented++;
            return { claimed: false, reason: 'exists' };
        }
        
        // Check pending
        if (this.pendingGens.has(key)) {
            this.stats.duplicatesPrevented++;
            return { claimed: false, reason: 'pending_generation', promise: this.pendingGens.get(key) };
        }
        
        if (this.pendingLoads.has(key)) {
            this.stats.duplicatesPrevented++;
            return { claimed: false, reason: 'pending_load', promise: this.pendingLoads.get(key) };
        }
        
        // Create entry and lock
        let entry = this.entries.get(key);
        if (!entry) {
            entry = new ChunkRegistryEntry(cx, cy, cz);
            this.entries.set(key, entry);
            this.stats.totalEntries++;
        }
        
        if (!entry.tryLock(source)) {
            this.stats.lockConflicts++;
            return { claimed: false, reason: 'locked', lockedBy: entry.lockedBy };
        }
        
        entry.status = ChunkStatus.GENERATING;
        entry.source = 'generated';
        
        return { claimed: true, entry };
    }
    
    /**
     * Claim a chunk for loading
     */
    claimForLoading(cx, cy, cz, source = 'loader') {
        const key = `${cx},${cy},${cz}`;
        
        // Check pending
        if (this.pendingLoads.has(key)) {
            this.stats.duplicatesPrevented++;
            return { claimed: false, reason: 'pending_load', promise: this.pendingLoads.get(key) };
        }
        
        let entry = this.entries.get(key);
        if (!entry) {
            entry = new ChunkRegistryEntry(cx, cy, cz);
            this.entries.set(key, entry);
            this.stats.totalEntries++;
        }
        
        if (!entry.tryLock(source)) {
            this.stats.lockConflicts++;
            return { claimed: false, reason: 'locked', lockedBy: entry.lockedBy };
        }
        
        entry.status = ChunkStatus.LOADING;
        
        return { claimed: true, entry };
    }
    
    /**
     * Release claim after operation completes
     */
    release(cx, cy, cz, source, success = true) {
        const key = `${cx},${cy},${cz}`;
        const entry = this.entries.get(key);
        
        if (entry) {
            entry.unlock(source);
            
            if (success) {
                entry.status = ChunkStatus.READY;
                entry.lastAccessAt = Date.now();
            }
        }
        
        // Clean up pending maps
        this.pendingLoads.delete(key);
        this.pendingGens.delete(key);
        this.pendingSaves.delete(key);
    }
    
    // ========================================================================
    // REGISTRATION (After chunk is loaded/generated)
    // ========================================================================
    
    /**
     * Register a chunk after successful load or generation
     * @param {number} cx 
     * @param {number} cy 
     * @param {number} cz 
     * @param {Uint8Array} voxels - Voxel data for hashing
     * @param {Object} metadata
     */
    register(cx, cy, cz, voxels, metadata = {}) {
        const key = `${cx},${cy},${cz}`;
        
        let entry = this.entries.get(key);
        if (!entry) {
            entry = new ChunkRegistryEntry(cx, cy, cz);
            this.entries.set(key, entry);
            this.stats.totalEntries++;
            
            // Add to bloom filter for fast existence checks
            this.bloomFilter.add(cx, cy, cz);
            
            // Add to Morton index for spatial queries
            const morton = encodeMorton3D(cx, cy, cz);
            this.mortonIndex.set(morton, key);
        }
        
        // Compute content hash
        entry.contentHash = hashVoxels(voxels);
        entry.voxelCount = this._countNonAir(voxels);
        entry.byteSize = metadata.byteSize || voxels.length;
        
        // Update timestamps
        const now = Date.now();
        if (!entry.createdAt) {
            entry.createdAt = metadata.createdAt || now;
        }
        entry.modifiedAt = metadata.modifiedAt || now;
        entry.lastAccessAt = now;
        entry.lastVerifiedAt = now;
        
        entry.source = metadata.source || 'unknown';
        entry.status = ChunkStatus.READY;
        
        // Track as existing
        this.existsOnDisk.add(key);
        this.stats.onDisk = this.existsOnDisk.size;
        
        this.dirty = true;
        
        return entry;
    }
    
    /**
     * Mark chunk as saved to disk
     */
    markSaved(cx, cy, cz, serializedSize = 0) {
        const key = `${cx},${cy},${cz}`;
        const entry = this.entries.get(key);
        
        if (entry) {
            entry.status = ChunkStatus.READY;
            entry.generation++;
            entry.byteSize = serializedSize;
            this.existsOnDisk.add(key);
            this.dirty = true;
        }
        
        this.pendingSaves.delete(key);
    }
    
    /**
     * Mark chunk as corrupted
     */
    markCorrupted(cx, cy, cz, reason = '') {
        const key = `${cx},${cy},${cz}`;
        let entry = this.entries.get(key);
        
        if (!entry) {
            entry = new ChunkRegistryEntry(cx, cy, cz);
            this.entries.set(key, entry);
        }
        
        entry.status = ChunkStatus.CORRUPTED;
        entry.source = `corrupted: ${reason}`;
        this.stats.corrupted++;
        this.dirty = true;
        
        console.warn(`[ChunkRegistry] Marked ${key} as corrupted: ${reason}`);
    }
    
    // ========================================================================
    // INTEGRITY VERIFICATION
    // ========================================================================
    
    /**
     * Verify chunk integrity by comparing hash
     * @param {number} cx 
     * @param {number} cy 
     * @param {number} cz 
     * @param {Uint8Array} voxels 
     * @returns {{ valid: boolean, expected?: number, actual?: number }}
     */
    verifyIntegrity(cx, cy, cz, voxels) {
        const key = `${cx},${cy},${cz}`;
        const entry = this.entries.get(key);
        
        this.stats.integrityChecks++;
        
        if (!entry || entry.contentHash === 0) {
            // No hash to compare - assume valid but register
            return { valid: true, noHash: true };
        }
        
        const actualHash = hashVoxels(voxels);
        const valid = actualHash === entry.contentHash;
        
        if (!valid) {
            this.stats.integrityFailures++;
            console.warn(`[ChunkRegistry] Integrity check failed for ${key}: expected ${entry.contentHash}, got ${actualHash}`);
        }
        
        entry.lastVerifiedAt = Date.now();
        
        return {
            valid,
            expected: entry.contentHash,
            actual: actualHash,
        };
    }
    
    /**
     * Update hash after chunk modification
     */
    updateHash(cx, cy, cz, voxels) {
        const key = `${cx},${cy},${cz}`;
        const entry = this.entries.get(key);
        
        if (entry) {
            entry.contentHash = hashVoxels(voxels);
            entry.voxelCount = this._countNonAir(voxels);
            entry.modifiedAt = Date.now();
            entry.status = ChunkStatus.DIRTY;
            this.dirty = true;
        }
    }
    
    // ========================================================================
    // BULK OPERATIONS
    // ========================================================================
    
    /**
     * Register multiple chunks as existing on disk (fast bulk init)
     * @param {Array<{x, y, z}>} coords 
     */
    bulkMarkExists(coords) {
        for (const { x, y, z } of coords) {
            this.existsOnDisk.add(`${x},${y},${z}`);
        }
        this.stats.onDisk = this.existsOnDisk.size;
    }
    
    /**
     * Get all chunks needing save
     */
    getDirtyChunks() {
        const dirty = [];
        for (const [key, entry] of this.entries) {
            if (entry.status === ChunkStatus.DIRTY) {
                dirty.push(entry);
            }
        }
        return dirty;
    }
    
    /**
     * Get chunks in a region
     */
    getChunksInRegion(minX, minY, minZ, maxX, maxY, maxZ) {
        const chunks = [];
        for (const [key, entry] of this.entries) {
            if (entry.cx >= minX && entry.cx <= maxX &&
                entry.cy >= minY && entry.cy <= maxY &&
                entry.cz >= minZ && entry.cz <= maxZ) {
                chunks.push(entry);
            }
        }
        return chunks;
    }
    
    // ========================================================================
    // PERSISTENCE
    // ========================================================================
    
    /**
     * Load index from disk
     */
    async _loadIndex() {
        if (!this.backend) return;
        
        try {
            const data = await this.backend.readFile(INDEX_FILENAME);
            if (!data) return;
            
            const view = new DataView(data.buffer, data.byteOffset);
            
            // Header
            const magic = view.getUint32(0, true);
            if (magic !== REGISTRY_MAGIC) {
                console.warn('[ChunkRegistry] Invalid index magic, ignoring');
                return;
            }
            
            const version = view.getUint16(4, true);
            const entryCount = view.getUint32(6, true);
            
            console.log(`[ChunkRegistry] Loading index: ${entryCount} entries (v${version})`);
            
            // Entries (48 bytes each)
            let offset = 10;
            for (let i = 0; i < entryCount; i++) {
                const entry = ChunkRegistryEntry.deserialize(data.buffer, data.byteOffset + offset);
                this.entries.set(entry.key, entry);
                
                if (entry.status === ChunkStatus.READY || entry.status === ChunkStatus.DIRTY) {
                    this.existsOnDisk.add(entry.key);
                    
                    // Rebuild bloom filter and Morton index
                    this.bloomFilter.add(entry.cx, entry.cy, entry.cz);
                    const morton = encodeMorton3D(entry.cx, entry.cy, entry.cz);
                    this.mortonIndex.set(morton, entry.key);
                }
                
                offset += 48;
            }
            
            this.stats.totalEntries = this.entries.size;
            this.stats.onDisk = this.existsOnDisk.size;
            
            console.log(`[ChunkRegistry] Bloom filter rebuilt: ${this.bloomFilter.count} entries, ~${(this.bloomFilter.getFalsePositiveRate() * 100).toFixed(2)}% FP rate`);
            
        } catch (err) {
            console.warn('[ChunkRegistry] Failed to load index:', err.message);
        }
    }
    
    /**
     * Save index to disk
     */
    async saveIndex() {
        if (!this.backend || !this.dirty) return;
        
        const entries = Array.from(this.entries.values()).filter(e => 
            e.status === ChunkStatus.READY || 
            e.status === ChunkStatus.DIRTY ||
            e.status === ChunkStatus.CORRUPTED
        );
        
        // Header (10 bytes) + entries (48 bytes each)
        const bufferSize = 10 + entries.length * 48;
        const buffer = new ArrayBuffer(bufferSize);
        const view = new DataView(buffer);
        const u8 = new Uint8Array(buffer);
        
        // Header
        view.setUint32(0, REGISTRY_MAGIC, true);
        view.setUint16(4, REGISTRY_VERSION, true);
        view.setUint32(6, entries.length, true);
        
        // Entries
        let offset = 10;
        for (const entry of entries) {
            u8.set(entry.serialize(), offset);
            offset += 48;
        }
        
        try {
            await this.backend.writeFile(INDEX_FILENAME, u8);
            this.dirty = false;
            this.lastSaveTime = Date.now();
            console.log(`[ChunkRegistry] Saved index: ${entries.length} entries`);
        } catch (err) {
            console.error('[ChunkRegistry] Failed to save index:', err);
        }
    }
    
    // ========================================================================
    // UTILITY
    // ========================================================================
    
    _countNonAir(voxels) {
        if (!voxels) return 0;
        let count = 0;
        for (let i = 0; i < voxels.length; i++) {
            if (voxels[i] !== 0) count++;
        }
        return count;
    }
    
    /**
     * Get entry for a chunk
     */
    getEntry(cx, cy, cz) {
        return this.entries.get(`${cx},${cy},${cz}`);
    }
    
    /**
     * Get stats including bloom filter performance
     */
    getStats() {
        const bloomFPRate = this.bloomFilter.getFalsePositiveRate();
        return {
            ...this.stats,
            totalEntries: this.entries.size,
            onDisk: this.existsOnDisk.size,
            pendingLoads: this.pendingLoads.size,
            pendingGens: this.pendingGens.size,
            pendingSaves: this.pendingSaves.size,
            // Bloom filter stats
            bloomFilterSize: this.bloomFilter.size,
            bloomFilterCount: this.bloomFilter.count,
            bloomFalsePositiveRate: `${(bloomFPRate * 100).toFixed(2)}%`,
            bloomEfficiency: this.stats.bloomMisses > 0 
                ? `${((this.stats.bloomMisses / (this.stats.bloomMisses + this.stats.bloomHits + this.stats.bloomFalsePositives)) * 100).toFixed(1)}% fast rejections`
                : 'N/A',
            // Morton index stats
            mortonIndexSize: this.mortonIndex.size,
        };
    }
    
    /**
     * Debug: dump registry state
     */
    dump() {
        const entries = Array.from(this.entries.values()).map(e => ({
            key: e.key,
            status: Object.keys(ChunkStatus).find(k => ChunkStatus[k] === e.status),
            hash: e.contentHash.toString(16),
            voxels: e.voxelCount,
            source: e.source,
        }));
        
        return {
            stats: this.getStats(),
            entries: entries.slice(0, 50),  // First 50 for debugging
        };
    }
}

// ============================================================================
// SINGLETON
// ============================================================================

let registryInstance = null;

/**
 * Get the global ChunkRegistry instance
 * @returns {ChunkRegistry}
 */
export function getChunkRegistry() {
    if (!registryInstance) {
        registryInstance = new ChunkRegistry();
    }
    return registryInstance;
}

/**
 * Initialize the global registry with a storage backend
 * @param {Object} backend 
 */
export async function initChunkRegistry(backend) {
    const registry = getChunkRegistry();
    await registry.init(backend);
    return registry;
}

export default ChunkRegistry;
