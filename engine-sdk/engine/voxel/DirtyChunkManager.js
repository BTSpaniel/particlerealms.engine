// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DirtyChunkManager.js - Conditional Execution Infrastructure
 * 
 * Problem: Processing all chunks every frame is wasteful.
 * Most chunks don't change between frames - only those affected
 * by player actions, physics, or lighting propagation need updates.
 * 
 * Solution: Track "dirty" state per chunk with fine-grained flags.
 * Only dispatch GPU work for chunks that actually need it.
 * 
 * Dirty Flags:
 * - GEOMETRY: Voxels changed, need mesh rebuild + JFA + DDGI
 * - LIGHTING: Light sources changed, DDGI probes need update
 * - BOUNDARY: Neighbor chunk changed, need seam handling
 * 
 * Features:
 * - Bitmask flags for multiple dirty types
 * - Boundary dilation (mark 26 neighbors when chunk changes)
 * - Double-buffered update queues (current frame vs next frame)
 * - Deduplication before GPU upload
 * - Priority sorting (closer chunks first)
 */

import { DIRTY_FLAGS } from '../core/gpu/BufferLayouts.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Re-export dirty flags for convenience */
export { DIRTY_FLAGS };

/** Maximum chunks that can be processed per frame */
export const MAX_DIRTY_PER_FRAME = 256;

/** Chunk states */
export const ChunkState = {
    CLEAN: 0,
    PENDING: 1,      // Marked dirty, waiting in queue
    PROCESSING: 2,   // Currently being processed on GPU
};

// ============================================================================
// DIRTY CHUNK ENTRY
// ============================================================================

/**
 * Represents a dirty chunk entry
 */
export class DirtyChunkEntry {
    /**
     * @param {number} x - Chunk X coordinate
     * @param {number} y - Chunk Y coordinate
     * @param {number} z - Chunk Z coordinate
     * @param {number} flags - Dirty flags bitmask
     * @param {number} priority - Processing priority (lower = higher priority)
     */
    constructor(x, y, z, flags = DIRTY_FLAGS.ALL, priority = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.flags = flags;
        this.priority = priority;
        this.frameMarked = 0;
        this.state = ChunkState.PENDING;
    }
    
    /**
     * Get unique key for this chunk
     * @returns {string}
     */
    getKey() {
        return `${this.x},${this.y},${this.z}`;
    }
    
    /**
     * Add additional flags
     * @param {number} newFlags 
     */
    addFlags(newFlags) {
        this.flags |= newFlags;
    }
    
    /**
     * Check if specific flag is set
     * @param {number} flag 
     * @returns {boolean}
     */
    hasFlag(flag) {
        return (this.flags & flag) !== 0;
    }
    
    /**
     * Serialize for GPU upload (16 bytes aligned)
     * @returns {Int32Array}
     */
    toGPUData() {
        return new Int32Array([this.x, this.y, this.z, this.flags]);
    }
}

// ============================================================================
// DIRTY CHUNK MANAGER
// ============================================================================

export class DirtyChunkManager {
    /**
     * @param {Object} options - Configuration
     */
    constructor(options = {}) {
        this.maxPerFrame = options.maxPerFrame ?? MAX_DIRTY_PER_FRAME;
        this.enableBoundaryDilation = options.boundaryDilation !== false;
        this.priorityFunction = options.priorityFunction ?? this._defaultPriority.bind(this);
        
        // Current frame's dirty chunks (being processed)
        this.currentQueue = new Map();
        
        // Next frame's dirty chunks (accumulating)
        this.nextQueue = new Map();
        
        // All dirty chunks by key for fast lookup
        this.dirtyLookup = new Map();
        
        // Camera position for priority calculation
        this.cameraX = 0;
        this.cameraY = 0;
        this.cameraZ = 0;
        
        // Frame counter
        this.frameNumber = 0;
        
        // Stats
        this.stats = {
            markedThisFrame: 0,
            processedThisFrame: 0,
            totalPending: 0,
            dilatedCount: 0,
        };
    }
    
    /**
     * Update camera position for priority calculation
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     */
    setCameraPosition(x, y, z) {
        this.cameraX = x;
        this.cameraY = y;
        this.cameraZ = z;
    }
    
    /**
     * Default priority function (damage first, then distance to camera)
     * @param {DirtyChunkEntry} entry 
     * @returns {number}
     */
    _defaultPriority(entry) {
        const dx = entry.x - this.cameraX;
        const dy = entry.y - this.cameraY;
        const dz = entry.z - this.cameraZ;
        const distSq = dx * dx + dy * dy + dz * dz;
        
        // DAMAGE chunks get absolute highest priority (negative priority)
        if (entry.flags & DIRTY_FLAGS.DAMAGE) {
            return -1000000 + distSq * 0.001; // Damage first, then by distance
        }
        
        return distSq;
    }
    
    /**
     * Mark a chunk as dirty
     * @param {number} x - Chunk X
     * @param {number} y - Chunk Y
     * @param {number} z - Chunk Z
     * @param {number} flags - Dirty flags (default: ALL)
     */
    markDirty(x, y, z, flags = DIRTY_FLAGS.ALL) {
        const key = `${x},${y},${z}`;
        
        // Check if already in queue
        let entry = this.dirtyLookup.get(key);
        
        if (entry) {
            // Add new flags to existing entry
            entry.addFlags(flags);
        } else {
            // Create new entry
            entry = new DirtyChunkEntry(x, y, z, flags);
            entry.frameMarked = this.frameNumber;
            entry.priority = this.priorityFunction(entry);
            
            // Add to BOTH queues - currentQueue for immediate processing this frame,
            // nextQueue for persistence across beginFrame() calls
            this.currentQueue.set(key, entry);
            this.nextQueue.set(key, entry);
            this.dirtyLookup.set(key, entry);
        }
        
        this.stats.markedThisFrame++;
        
        // Boundary dilation: mark neighbors with BOUNDARY flag
        if (this.enableBoundaryDilation && (flags & DIRTY_FLAGS.GEOMETRY)) {
            this._dilateToNeighbors(x, y, z);
        }
    }
    
    /**
     * Mark all 26 neighbors with BOUNDARY flag
     * @param {number} cx - Center chunk X
     * @param {number} cy - Center chunk Y
     * @param {number} cz - Center chunk Z
     */
    _dilateToNeighbors(cx, cy, cz) {
        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    
                    const nx = cx + dx;
                    const ny = cy + dy;
                    const nz = cz + dz;
                    const key = `${nx},${ny},${nz}`;
                    
                    let entry = this.dirtyLookup.get(key);
                    
                    if (entry) {
                        entry.addFlags(DIRTY_FLAGS.BOUNDARY);
                    } else {
                        entry = new DirtyChunkEntry(nx, ny, nz, DIRTY_FLAGS.BOUNDARY);
                        entry.frameMarked = this.frameNumber;
                        entry.priority = this.priorityFunction(entry);
                        
                        this.nextQueue.set(key, entry);
                        this.dirtyLookup.set(key, entry);
                        this.stats.dilatedCount++;
                    }
                }
            }
        }
    }
    
    /**
     * Mark chunk clean (processing complete)
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {number} clearedFlags - Which flags to clear (default: ALL)
     */
    markClean(x, y, z, clearedFlags = DIRTY_FLAGS.ALL) {
        const key = `${x},${y},${z}`;
        const entry = this.dirtyLookup.get(key);
        
        if (entry) {
            entry.flags &= ~clearedFlags;
            
            // If all flags cleared, remove from tracking
            if (entry.flags === 0) {
                this.currentQueue.delete(key);
                this.nextQueue.delete(key);
                this.dirtyLookup.delete(key);
            }
        }
    }
    
    /**
     * Check if chunk is dirty
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {number} flagMask - Optional flag mask to check
     * @returns {boolean}
     */
    isDirty(x, y, z, flagMask = DIRTY_FLAGS.ALL) {
        const key = `${x},${y},${z}`;
        const entry = this.dirtyLookup.get(key);
        return entry ? (entry.flags & flagMask) !== 0 : false;
    }
    
    /**
     * Get dirty flags for a chunk
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {number}
     */
    getFlags(x, y, z) {
        const key = `${x},${y},${z}`;
        const entry = this.dirtyLookup.get(key);
        return entry ? entry.flags : 0;
    }
    
    /**
     * Begin new frame - swap queues and prepare for processing
     */
    beginFrame() {
        this.frameNumber++;
        
        // Merge next queue into current (deduplicated by Map)
        for (const [key, entry] of this.nextQueue) {
            if (!this.currentQueue.has(key)) {
                this.currentQueue.set(key, entry);
            }
        }
        this.nextQueue.clear();
        
        // Reset frame stats
        this.stats.markedThisFrame = 0;
        this.stats.processedThisFrame = 0;
        this.stats.totalPending = this.currentQueue.size;
    }
    
    /**
     * Get chunks to process this frame, sorted by priority
     * @param {number} flagFilter - Only return chunks with these flags
     * @param {number} maxCount - Maximum chunks to return
     * @returns {DirtyChunkEntry[]}
     */
    getChunksToProcess(flagFilter = DIRTY_FLAGS.ALL, maxCount = this.maxPerFrame) {
        const candidates = [];
        
        for (const entry of this.currentQueue.values()) {
            if ((entry.flags & flagFilter) !== 0) {
                // Update priority
                entry.priority = this.priorityFunction(entry);
                candidates.push(entry);
            }
        }
        
        // Sort by priority (lower = higher priority)
        candidates.sort((a, b) => a.priority - b.priority);
        
        // Return limited count
        const result = candidates.slice(0, maxCount);
        
        // Mark as processing
        for (const entry of result) {
            entry.state = ChunkState.PROCESSING;
        }
        
        this.stats.processedThisFrame = result.length;
        return result;
    }
    
    /**
     * Get GPU-ready buffer data for dirty chunks
     * @param {number} flagFilter 
     * @param {number} maxCount 
     * @returns {{ data: Int32Array, count: number }}
     */
    getGPUData(flagFilter = DIRTY_FLAGS.ALL, maxCount = this.maxPerFrame) {
        const chunks = this.getChunksToProcess(flagFilter, maxCount);
        const data = new Int32Array(chunks.length * 4);
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const offset = i * 4;
            data[offset] = chunk.x;
            data[offset + 1] = chunk.y;
            data[offset + 2] = chunk.z;
            data[offset + 3] = chunk.flags;
        }
        
        return { data, count: chunks.length };
    }
    
    /**
     * End frame - clean up processed chunks
     */
    endFrame() {
        // Remove fully processed chunks
        for (const [key, entry] of this.currentQueue) {
            if (entry.state === ChunkState.PROCESSING && entry.flags === 0) {
                this.currentQueue.delete(key);
                this.dirtyLookup.delete(key);
            } else {
                // Reset state for next frame
                entry.state = ChunkState.PENDING;
            }
        }
    }
    
    /**
     * Clear all dirty state
     */
    clear() {
        this.currentQueue.clear();
        this.nextQueue.clear();
        this.dirtyLookup.clear();
        this.stats.markedThisFrame = 0;
        this.stats.processedThisFrame = 0;
        this.stats.totalPending = 0;
        this.stats.dilatedCount = 0;
    }
    
    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            ...this.stats,
            currentQueueSize: this.currentQueue.size,
            nextQueueSize: this.nextQueue.size,
            totalTracked: this.dirtyLookup.size,
        };
    }
    
    /**
     * Debug string
     * @returns {string}
     */
    toString() {
        const stats = this.getStats();
        return `DirtyChunks: ${stats.totalTracked} tracked, ${stats.processedThisFrame}/${stats.totalPending} processed`;
    }
}

// ============================================================================
// SPECIALIZED DIRTY TRACKERS
// ============================================================================

/**
 * Geometry-specific dirty tracker (for mesh rebuilds)
 */
export class GeometryDirtyTracker extends DirtyChunkManager {
    constructor(options = {}) {
        super({
            ...options,
            maxPerFrame: options.maxPerFrame ?? 64,
        });
    }
    
    markGeometryDirty(x, y, z) {
        this.markDirty(x, y, z, DIRTY_FLAGS.GEOMETRY);
    }
    
    /**
     * Mark chunk as DAMAGE priority (processes first, bypasses budget)
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     */
    markDamageDirty(x, y, z) {
        this.markDirty(x, y, z, DIRTY_FLAGS.GEOMETRY | DIRTY_FLAGS.DAMAGE);
    }
    
    getGeometryChunks(maxCount) {
        return this.getChunksToProcess(DIRTY_FLAGS.GEOMETRY, maxCount);
    }
    
    /**
     * Get damage chunks first (no limit - always process all damage)
     * @returns {DirtyChunkEntry[]}
     */
    getDamageChunks() {
        const candidates = [];
        for (const entry of this.currentQueue.values()) {
            if ((entry.flags & DIRTY_FLAGS.DAMAGE) !== 0) {
                entry.priority = this._defaultPriority(entry);
                candidates.push(entry);
            }
        }
        candidates.sort((a, b) => a.priority - b.priority);
        return candidates;
    }
    
    /**
     * Count pending damage chunks
     * @returns {number}
     */
    getDamageCount() {
        let count = 0;
        for (const entry of this.currentQueue.values()) {
            if ((entry.flags & DIRTY_FLAGS.DAMAGE) !== 0) count++;
        }
        return count;
    }
}

/**
 * Lighting-specific dirty tracker (for DDGI updates)
 */
export class LightingDirtyTracker extends DirtyChunkManager {
    constructor(options = {}) {
        super({
            ...options,
            maxPerFrame: options.maxPerFrame ?? 128,
            boundaryDilation: true, // Light always bleeds
        });
    }
    
    markLightingDirty(x, y, z) {
        this.markDirty(x, y, z, DIRTY_FLAGS.LIGHTING);
    }
    
    getLightingChunks(maxCount) {
        return this.getChunksToProcess(DIRTY_FLAGS.LIGHTING, maxCount);
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse chunk key to coordinates
 * @param {string} key 
 * @returns {[number, number, number]}
 */
export function parseChunkKey(key) {
    const parts = key.split(',');
    return [parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2])];
}

/**
 * Create chunk key from coordinates
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @returns {string}
 */
export function makeChunkKey(x, y, z) {
    return `${x},${y},${z}`;
}

export default DirtyChunkManager;
