// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkJobCoordinator.js - Central Job Assignment for Chunk Loading
 * 
 * Prevents duplicate chunk loads across multiple systems:
 * - PriorityChunkLoader
 * - ChunkStreaming  
 * - ChunkStreamingCompute
 * - ChunkManager.updateStreaming
 * 
 * Single source of truth for chunk job state.
 */

export const JOB_STATE = {
    NONE: 0,
    QUEUED: 1,
    LOADING: 2,
    GENERATING: 3,
    MESHING: 4,
    READY: 5,
    UNLOADING: 6,
};

export const JOB_SOURCE = {
    PRIORITY_LOADER: 'priority',
    STREAMING: 'streaming',
    GPU_COMPUTE: 'gpu',
    CHUNK_MANAGER: 'manager',
};

// ============================================================================
// MORTON CODE UTILITIES (Z-Order Curve for cache-friendly spatial indexing)
// ============================================================================

/**
 * Spread bits of a 21-bit integer for Morton encoding
 * Interleaves zeros between bits: 0b111 -> 0b001001001
 */
function spreadBits3D(v) {
    v = (v | (v << 16)) & 0x030000FF;
    v = (v | (v << 8)) & 0x0300F00F;
    v = (v | (v << 4)) & 0x030C30C3;
    v = (v | (v << 2)) & 0x09249249;
    return v;
}

/**
 * Compact bits from Morton code back to coordinate
 */
function compactBits3D(v) {
    v &= 0x09249249;
    v = (v | (v >> 2)) & 0x030C30C3;
    v = (v | (v >> 4)) & 0x0300F00F;
    v = (v | (v >> 8)) & 0x030000FF;
    v = (v | (v >> 16)) & 0x000003FF;
    return v;
}

/**
 * Encode 3D coordinates to Morton code (Z-order curve)
 * Preserves spatial locality for cache-friendly iteration
 * @param {number} x - X coordinate (0 to 1023)
 * @param {number} y - Y coordinate (0 to 1023)
 * @param {number} z - Z coordinate (0 to 1023)
 * @returns {number} - Morton code
 */
export function encodeMorton3D(x, y, z) {
    // Offset to handle negative coords (shift to positive space)
    const ox = (x + 512) & 0x3FF;
    const oy = (y + 512) & 0x3FF;
    const oz = (z + 512) & 0x3FF;
    return spreadBits3D(ox) | (spreadBits3D(oy) << 1) | (spreadBits3D(oz) << 2);
}

/**
 * Decode Morton code back to 3D coordinates
 * @param {number} morton - Morton code
 * @returns {{x: number, y: number, z: number}}
 */
export function decodeMorton3D(morton) {
    const x = compactBits3D(morton) - 512;
    const y = compactBits3D(morton >> 1) - 512;
    const z = compactBits3D(morton >> 2) - 512;
    return { x, y, z };
}

/**
 * BIGMIN optimization: Find next Morton code inside query box
 * Skips irrelevant ranges when iterating Morton-ordered data
 * @param {number} current - Current Morton code
 * @param {number} minMorton - Min corner Morton code
 * @param {number} maxMorton - Max corner Morton code
 * @returns {number} - Next valid Morton code or -1 if none
 */
export function mortonBigmin(current, minMorton, maxMorton) {
    if (current >= maxMorton) return -1;
    if (current >= minMorton) return current;
    
    // Simple advancement - could be optimized further with bit manipulation
    let next = current + 1;
    while (next < maxMorton) {
        const { x, y, z } = decodeMorton3D(next);
        const minCoords = decodeMorton3D(minMorton);
        const maxCoords = decodeMorton3D(maxMorton);
        
        if (x >= minCoords.x && x <= maxCoords.x &&
            y >= minCoords.y && y <= maxCoords.y &&
            z >= minCoords.z && z <= maxCoords.z) {
            return next;
        }
        next++;
    }
    return -1;
}

export class ChunkJobCoordinator {
    constructor() {
        // Job tracking: key -> { state, source, priority, timestamp, data, morton }
        this.jobs = new Map();
        
        // Morton-indexed jobs for cache-friendly spatial queries
        this.mortonIndex = new Map();  // morton -> key
        
        // Reverse lookup: which jobs each source owns
        this.sourceJobs = new Map([
            [JOB_SOURCE.PRIORITY_LOADER, new Set()],
            [JOB_SOURCE.STREAMING, new Set()],
            [JOB_SOURCE.GPU_COMPUTE, new Set()],
            [JOB_SOURCE.CHUNK_MANAGER, new Set()],
        ]);
        
        // Completed chunks (for deduplication)
        this.completedChunks = new Set();
        this.completedMortons = new Set();  // Morton codes of completed chunks
        
        // Limits per source to balance load (high for fast loading)
        this.sourceLimits = new Map([
            [JOB_SOURCE.PRIORITY_LOADER, 64],
            [JOB_SOURCE.STREAMING, 64],
            [JOB_SOURCE.GPU_COMPUTE, 64],
            [JOB_SOURCE.CHUNK_MANAGER, 32],
        ]);
        
        // Velocity prediction for predictive loading
        this.playerVelocity = [0, 0, 0];
        this.lastPlayerPos = [0, 0, 0];
        this.velocitySmoothing = 0.8;  // EMA smoothing factor
        this.lookaheadTime = 2.0;      // Seconds to predict ahead
        
        // Hysteresis thresholds to prevent thrashing
        this.loadRadius = 8;           // Distance to start loading
        this.unloadRadius = 12;        // Distance to unload (must be > loadRadius)
        this.hysteresisBuffer = 4;     // Buffer zone size
        
        // Stats
        this.stats = {
            totalJobs: 0,
            duplicatesPrevented: 0,
            jobsCompleted: 0,
            jobsCancelled: 0,
            velocityPredictions: 0,
            hysteresisBlocks: 0,
        };
        
        // Cleanup interval
        this._cleanupCounter = 0;
        this._cleanupInterval = 60;  // frames
        this._lastUpdateTime = 0;
    }
    
    /**
     * Generate chunk key
     */
    static key(cx, cy, cz) {
        return `${cx},${cy},${cz}`;
    }
    
    /**
     * Parse chunk key
     */
    static parseKey(key) {
        const parts = key.split(',').map(Number);
        return { cx: parts[0], cy: parts[1] || 0, cz: parts[2] || parts[1] };
    }
    
    /**
     * Get Morton code for chunk coordinates
     */
    static morton(cx, cy, cz) {
        return encodeMorton3D(cx, cy, cz);
    }
    
    /**
     * Update player velocity for predictive loading
     * @param {number} px - Player X position
     * @param {number} py - Player Y position  
     * @param {number} pz - Player Z position
     * @param {number} dt - Delta time in seconds
     */
    updateVelocity(px, py, pz, dt) {
        if (dt <= 0 || this._lastUpdateTime === 0) {
            this.lastPlayerPos = [px, py, pz];
            this._lastUpdateTime = performance.now();
            return;
        }
        
        // Calculate instantaneous velocity
        const vx = (px - this.lastPlayerPos[0]) / dt;
        const vy = (py - this.lastPlayerPos[1]) / dt;
        const vz = (pz - this.lastPlayerPos[2]) / dt;
        
        // EMA smoothing
        const s = this.velocitySmoothing;
        this.playerVelocity[0] = s * this.playerVelocity[0] + (1 - s) * vx;
        this.playerVelocity[1] = s * this.playerVelocity[1] + (1 - s) * vy;
        this.playerVelocity[2] = s * this.playerVelocity[2] + (1 - s) * vz;
        
        this.lastPlayerPos = [px, py, pz];
        this._lastUpdateTime = performance.now();
    }
    
    /**
     * Get predicted player position for lookahead loading
     * @returns {{x: number, y: number, z: number}}
     */
    getPredictedPosition() {
        return {
            x: this.lastPlayerPos[0] + this.playerVelocity[0] * this.lookaheadTime,
            y: this.lastPlayerPos[1] + this.playerVelocity[1] * this.lookaheadTime,
            z: this.lastPlayerPos[2] + this.playerVelocity[2] * this.lookaheadTime,
        };
    }
    
    /**
     * Calculate priority with velocity weighting
     * Chunks in player's path get higher priority
     * @param {number} cx - Chunk X
     * @param {number} cy - Chunk Y
     * @param {number} cz - Chunk Z
     * @param {number} pcx - Player chunk X
     * @param {number} pcy - Player chunk Y
     * @param {number} pcz - Player chunk Z
     * @param {number} chunkSize - Size of chunks in world units
     * @returns {number} - Priority score (higher = more important)
     */
    calculateVelocityPriority(cx, cy, cz, pcx, pcy, pcz, chunkSize = 32) {
        const dx = cx - pcx;
        const dy = cy - pcy;
        const dz = cz - pcz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        // Base priority: closer = higher
        let priority = 100 - dist * 10;
        
        // Velocity dot product: prioritize chunks in movement direction
        const speed = Math.sqrt(
            this.playerVelocity[0] ** 2 +
            this.playerVelocity[1] ** 2 +
            this.playerVelocity[2] ** 2
        );
        
        if (speed > 0.1) {
            // Normalize velocity
            const vnx = this.playerVelocity[0] / speed;
            const vny = this.playerVelocity[1] / speed;
            const vnz = this.playerVelocity[2] / speed;
            
            // Direction to chunk (normalized)
            const dLen = dist || 1;
            const dnx = dx / dLen;
            const dny = dy / dLen;
            const dnz = dz / dLen;
            
            // Dot product: 1.0 = directly ahead, -1.0 = behind
            const dot = vnx * dnx + vny * dny + vnz * dnz;
            
            // Boost priority for chunks ahead (up to +50)
            priority += dot * 50;
            
            this.stats.velocityPredictions++;
        }
        
        return priority;
    }
    
    /**
     * Check if chunk should be loaded using hysteresis
     * Prevents thrashing at boundary distances
     * @param {number} distSq - Squared distance to chunk
     * @param {boolean} isLoaded - Is chunk currently loaded
     * @returns {boolean} - Should chunk be loaded
     */
    shouldLoad(distSq, isLoaded) {
        const loadRadiusSq = this.loadRadius * this.loadRadius;
        const unloadRadiusSq = this.unloadRadius * this.unloadRadius;
        
        if (isLoaded) {
            // Already loaded: only unload if beyond unload radius
            if (distSq > unloadRadiusSq) {
                return false;  // Should unload
            }
            return true;  // Keep loaded (in hysteresis zone)
        } else {
            // Not loaded: only load if within load radius
            if (distSq <= loadRadiusSq) {
                return true;  // Should load
            }
            // In hysteresis buffer zone - don't load
            this.stats.hysteresisBlocks++;
            return false;
        }
    }
    
    /**
     * Check if a chunk can be claimed for loading
     * @param {string} key - Chunk key "cx,cy,cz"
     * @param {string} source - JOB_SOURCE
     * @returns {boolean}
     */
    canClaim(key, source) {
        // Already completed
        if (this.completedChunks.has(key)) {
            return false;
        }
        
        // Check existing job
        const existing = this.jobs.get(key);
        if (existing) {
            // Job exists - can't claim unless it's stale
            if (existing.state !== JOB_STATE.NONE) {
                return false;
            }
        }
        
        // Check source limit
        const sourceJobs = this.sourceJobs.get(source);
        const limit = this.sourceLimits.get(source) || 4;
        if (sourceJobs && sourceJobs.size >= limit) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Try to claim a chunk for loading (atomic operation)
     * @param {string} key - Chunk key
     * @param {string} source - JOB_SOURCE
     * @param {number} priority - Higher = more important
     * @param {Object} data - Optional job data
     * @returns {boolean} - True if claimed successfully
     */
    claim(key, source, priority = 0, data = null) {
        if (!this.canClaim(key, source)) {
            this.stats.duplicatesPrevented++;
            return false;
        }
        
        // Parse coordinates for Morton indexing
        const { cx, cy, cz } = ChunkJobCoordinator.parseKey(key);
        const morton = encodeMorton3D(cx, cy, cz);
        
        // Create or update job
        this.jobs.set(key, {
            state: JOB_STATE.QUEUED,
            source,
            priority,
            timestamp: performance.now(),
            data,
            morton,
        });
        
        // Track in Morton index for spatial queries
        this.mortonIndex.set(morton, key);
        
        // Track in source set
        const sourceJobs = this.sourceJobs.get(source);
        if (sourceJobs) {
            sourceJobs.add(key);
        }
        
        this.stats.totalJobs++;
        return true;
    }
    
    /**
     * Batch claim multiple chunks
     * @param {Array} chunks - Array of {cx, cy, cz, priority?}
     * @param {string} source - JOB_SOURCE
     * @returns {Array} - Successfully claimed chunk keys
     */
    claimBatch(chunks, source) {
        const claimed = [];
        const limit = this.sourceLimits.get(source) || 4;
        const sourceJobs = this.sourceJobs.get(source);
        const currentCount = sourceJobs ? sourceJobs.size : 0;
        const available = limit - currentCount;
        
        // Sort by priority (highest first)
        const sorted = [...chunks].sort((a, b) => (b.priority || 0) - (a.priority || 0));
        
        for (const chunk of sorted) {
            if (claimed.length >= available) break;
            
            const key = ChunkJobCoordinator.key(chunk.cx, chunk.cy, chunk.cz);
            if (this.claim(key, source, chunk.priority || 0, chunk)) {
                claimed.push(key);
            }
        }
        
        return claimed;
    }
    
    /**
     * Update job state
     * @param {string} key - Chunk key
     * @param {number} state - JOB_STATE
     */
    updateState(key, state) {
        const job = this.jobs.get(key);
        if (job) {
            job.state = state;
            job.timestamp = performance.now();
        }
    }
    
    /**
     * Mark a job as complete
     * @param {string} key - Chunk key
     */
    complete(key) {
        const job = this.jobs.get(key);
        if (job) {
            // Remove from source tracking
            const sourceJobs = this.sourceJobs.get(job.source);
            if (sourceJobs) {
                sourceJobs.delete(key);
            }
            
            // Remove from Morton index, add to completed
            if (job.morton !== undefined) {
                this.mortonIndex.delete(job.morton);
                this.completedMortons.add(job.morton);
            }
            
            // Remove job, mark as completed
            this.jobs.delete(key);
            this.completedChunks.add(key);
            this.stats.jobsCompleted++;
        }
    }
    
    /**
     * Cancel a job
     * @param {string} key - Chunk key
     */
    cancel(key) {
        const job = this.jobs.get(key);
        if (job) {
            const sourceJobs = this.sourceJobs.get(job.source);
            if (sourceJobs) {
                sourceJobs.delete(key);
            }
            // Clean up Morton index
            if (job.morton !== undefined) {
                this.mortonIndex.delete(job.morton);
            }
            this.jobs.delete(key);
            this.stats.jobsCancelled++;
        }
    }
    
    /**
     * Cancel all jobs from a source
     * @param {string} source - JOB_SOURCE
     */
    cancelSource(source) {
        const sourceJobs = this.sourceJobs.get(source);
        if (sourceJobs) {
            for (const key of sourceJobs) {
                this.jobs.delete(key);
                this.stats.jobsCancelled++;
            }
            sourceJobs.clear();
        }
    }
    
    /**
     * Release a completed chunk (allow it to be loaded again, e.g., after unload)
     * @param {string} key - Chunk key
     */
    release(key) {
        this.completedChunks.delete(key);
        const job = this.jobs.get(key);
        if (job?.morton !== undefined) {
            this.mortonIndex.delete(job.morton);
            this.completedMortons.delete(job.morton);
        } else {
            // Try to compute Morton from key
            const { cx, cy, cz } = ChunkJobCoordinator.parseKey(key);
            const morton = encodeMorton3D(cx, cy, cz);
            this.completedMortons.delete(morton);
        }
        this.jobs.delete(key);
    }
    
    /**
     * Check if chunk is being worked on
     * @param {string} key - Chunk key
     * @returns {boolean}
     */
    isActive(key) {
        const job = this.jobs.get(key);
        return job && job.state !== JOB_STATE.NONE;
    }
    
    /**
     * Check if chunk is completed
     * @param {string} key - Chunk key
     * @returns {boolean}
     */
    isCompleted(key) {
        return this.completedChunks.has(key);
    }
    
    /**
     * Get job state
     * @param {string} key - Chunk key
     * @returns {number} - JOB_STATE
     */
    getState(key) {
        const job = this.jobs.get(key);
        if (job) return job.state;
        if (this.completedChunks.has(key)) return JOB_STATE.READY;
        return JOB_STATE.NONE;
    }
    
    /**
     * Get available slots for a source
     * @param {string} source - JOB_SOURCE
     * @returns {number}
     */
    getAvailableSlots(source) {
        const sourceJobs = this.sourceJobs.get(source);
        const limit = this.sourceLimits.get(source) || 4;
        const current = sourceJobs ? sourceJobs.size : 0;
        return Math.max(0, limit - current);
    }
    
    /**
     * Get chunks that are not claimed by anyone and need loading
     * Useful for load balancing between systems
     * @param {Array} candidates - Array of {cx, cy, cz, priority}
     * @param {number} maxCount - Maximum to return
     * @returns {Array} - Unclaimed chunks sorted by priority
     */
    getUnclaimedChunks(candidates, maxCount = 10) {
        const unclaimed = [];
        
        for (const chunk of candidates) {
            const key = ChunkJobCoordinator.key(chunk.cx, chunk.cy, chunk.cz);
            
            if (!this.jobs.has(key) && !this.completedChunks.has(key)) {
                unclaimed.push({ ...chunk, key });
            }
            
            if (unclaimed.length >= maxCount * 2) break;  // Get more for sorting
        }
        
        // Sort by priority
        unclaimed.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        
        return unclaimed.slice(0, maxCount);
    }
    
    /**
     * Prune stale jobs and distant completed chunks
     * @param {number} pcx - Player chunk X
     * @param {number} pcy - Player chunk Y
     * @param {number} pcz - Player chunk Z
     * @param {number} radius - Radius to keep
     */
    prune(pcx, pcy, pcz, radius) {
        const radiusSq = radius * radius;
        const now = performance.now();
        const staleThreshold = 30000;  // 30 seconds
        
        // Prune stale jobs
        for (const [key, job] of this.jobs) {
            const { cx, cy, cz } = ChunkJobCoordinator.parseKey(key);
            const dx = cx - pcx;
            const dy = cy - pcy;
            const dz = cz - pcz;
            const distSq = dx * dx + dy * dy + dz * dz;
            
            // Cancel jobs for distant chunks
            if (distSq > radiusSq * 1.5) {
                this.cancel(key);
                continue;
            }
            
            // Cancel stale jobs
            if (now - job.timestamp > staleThreshold) {
                this.cancel(key);
            }
        }
        
        // Prune distant completed chunks
        for (const key of this.completedChunks) {
            const { cx, cy, cz } = ChunkJobCoordinator.parseKey(key);
            const dx = cx - pcx;
            const dy = cy - pcy;
            const dz = cz - pcz;
            const distSq = dx * dx + dy * dy + dz * dz;
            
            if (distSq > radiusSq * 2) {
                this.completedChunks.delete(key);
            }
        }
    }
    
    /**
     * Per-frame update
     * @param {number} pcx - Player chunk X
     * @param {number} pcy - Player chunk Y
     * @param {number} pcz - Player chunk Z
     * @param {number} radius - Load radius
     */
    update(pcx, pcy, pcz, radius) {
        this._cleanupCounter++;
        if (this._cleanupCounter >= this._cleanupInterval) {
            this._cleanupCounter = 0;
            this.prune(pcx, pcy, pcz, radius);
        }
    }
    
    /**
     * Set limit for a source
     * @param {string} source - JOB_SOURCE
     * @param {number} limit - Max concurrent jobs
     */
    setSourceLimit(source, limit) {
        this.sourceLimits.set(source, limit);
    }
    
    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        const activeBySource = {};
        for (const [source, jobs] of this.sourceJobs) {
            activeBySource[source] = jobs.size;
        }
        
        return {
            ...this.stats,
            activeJobs: this.jobs.size,
            completedChunks: this.completedChunks.size,
            activeBySource,
        };
    }
    
    /**
     * Clear all state
     */
    clear() {
        this.jobs.clear();
        this.mortonIndex.clear();
        this.completedChunks.clear();
        this.completedMortons.clear();
        for (const set of this.sourceJobs.values()) {
            set.clear();
        }
    }
    
    /**
     * Load configuration from engine.cfg
     * @param {Object} cfg - Config from [chunk_streaming] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        // Velocity prediction settings
        if (cfg.velocity_smoothing !== undefined) {
            this.velocitySmoothing = parseFloat(cfg.velocity_smoothing) || 0.8;
        }
        if (cfg.lookahead_time !== undefined) {
            this.lookaheadTime = parseFloat(cfg.lookahead_time) || 2.0;
        }
        
        // Hysteresis thresholds
        if (cfg.load_radius !== undefined) {
            this.loadRadius = parseInt(cfg.load_radius) || 8;
        }
        if (cfg.unload_radius !== undefined) {
            this.unloadRadius = parseInt(cfg.unload_radius) || 12;
        }
        if (cfg.hysteresis_buffer !== undefined) {
            this.hysteresisBuffer = parseInt(cfg.hysteresis_buffer) || 4;
        }
        
        // Ensure unload > load for hysteresis to work
        if (this.unloadRadius <= this.loadRadius) {
            this.unloadRadius = this.loadRadius + this.hysteresisBuffer;
        }
        
        console.log(`[ChunkJobCoordinator] Config: load=${this.loadRadius}, unload=${this.unloadRadius}, lookahead=${this.lookaheadTime}s`);
    }
    
    // ========================================================================
    // DISTANCE-WEIGHTED EVICTION POLICY
    // ========================================================================
    
    /**
     * Get eviction candidates sorted by distance (furthest first)
     * Uses max-distance eviction instead of LRU for better spatial locality
     * 
     * @param {Map<string, any>} loadedChunks - Map of loaded chunk keys to chunk objects
     * @param {number} pcx - Player chunk X
     * @param {number} pcy - Player chunk Y
     * @param {number} pcz - Player chunk Z
     * @param {number} maxEvictions - Maximum chunks to consider for eviction
     * @returns {Array} - Sorted array of {key, chunk, distance, score}
     */
    getEvictionCandidates(loadedChunks, pcx, pcy, pcz, maxEvictions = 10) {
        const candidates = [];
        const predicted = this.getPredictedPosition();
        
        for (const [key, chunk] of loadedChunks) {
            const { cx, cy, cz } = ChunkJobCoordinator.parseKey(key);
            
            // Distance from current position
            const dx = cx - pcx;
            const dy = cy - pcy;
            const dz = cz - pcz;
            const currentDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            // Distance from predicted position (velocity-weighted)
            const pdx = cx - Math.floor(predicted.x / 32);
            const pdy = cy - Math.floor(predicted.y / 32);
            const pdz = cz - Math.floor(predicted.z / 32);
            const predictedDist = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);
            
            // Eviction score: higher = more likely to evict
            // Weight: 70% current distance, 30% predicted distance
            const score = currentDist * 0.7 + predictedDist * 0.3;
            
            // Only consider chunks outside load radius
            if (currentDist > this.loadRadius) {
                candidates.push({
                    key,
                    chunk,
                    distance: currentDist,
                    predictedDistance: predictedDist,
                    score,
                });
            }
        }
        
        // Sort by score (highest = furthest = evict first)
        candidates.sort((a, b) => b.score - a.score);
        
        return candidates.slice(0, maxEvictions);
    }
    
    /**
     * Evict chunks to free memory, prioritizing furthest chunks
     * Combines distance with recency for optimal eviction
     * 
     * @param {Map<string, any>} loadedChunks - Map of loaded chunks
     * @param {number} pcx - Player chunk X
     * @param {number} pcy - Player chunk Y
     * @param {number} pcz - Player chunk Z
     * @param {number} targetFree - Number of chunks to free
     * @param {Function} onEvict - Callback for each evicted chunk: (key, chunk) => void
     * @returns {number} - Number of chunks evicted
     */
    evictChunks(loadedChunks, pcx, pcy, pcz, targetFree, onEvict) {
        const candidates = this.getEvictionCandidates(loadedChunks, pcx, pcy, pcz, targetFree * 2);
        
        let evicted = 0;
        for (const candidate of candidates) {
            if (evicted >= targetFree) break;
            
            // Skip if chunk is being actively used
            if (this.isActive(candidate.key)) continue;
            
            // Evict
            if (onEvict) {
                onEvict(candidate.key, candidate.chunk);
            }
            
            // Release from coordinator
            this.release(candidate.key);
            evicted++;
            
            this.stats.evictions = (this.stats.evictions || 0) + 1;
        }
        
        return evicted;
    }
    
    /**
     * Check if memory pressure requires eviction
     * @param {number} loadedCount - Current number of loaded chunks
     * @param {number} maxChunks - Maximum allowed chunks
     * @returns {{needsEviction: boolean, toEvict: number}}
     */
    checkMemoryPressure(loadedCount, maxChunks) {
        const headroom = Math.floor(maxChunks * 0.1);  // 10% headroom
        const threshold = maxChunks - headroom;
        
        if (loadedCount >= threshold) {
            return {
                needsEviction: true,
                toEvict: loadedCount - threshold + headroom,
            };
        }
        
        return { needsEviction: false, toEvict: 0 };
    }
    
    /**
     * Debug: Get all active jobs
     */
    getActiveJobs() {
        return Array.from(this.jobs.entries()).map(([key, job]) => ({
            key,
            ...job,
        }));
    }
    
    /**
     * Get comprehensive debug info for streaming visualization overlay
     * @returns {Object} Debug information for display
     */
    getDebugInfo() {
        const speed = Math.sqrt(
            this.playerVelocity[0] ** 2 +
            this.playerVelocity[1] ** 2 +
            this.playerVelocity[2] ** 2
        );
        
        const predicted = this.getPredictedPosition();
        
        return {
            // Velocity prediction
            velocity: {
                x: this.playerVelocity[0].toFixed(1),
                y: this.playerVelocity[1].toFixed(1),
                z: this.playerVelocity[2].toFixed(1),
                speed: speed.toFixed(1),
            },
            predicted: {
                x: predicted.x.toFixed(0),
                y: predicted.y.toFixed(0),
                z: predicted.z.toFixed(0),
            },
            
            // Hysteresis
            loadRadius: this.loadRadius,
            unloadRadius: this.unloadRadius,
            bufferZone: this.unloadRadius - this.loadRadius,
            
            // Job stats
            activeJobs: this.jobs.size,
            completedChunks: this.completedChunks.size,
            mortonIndexSize: this.mortonIndex.size,
            
            // Per-source stats
            sourceStats: {
                priority: this.sourceJobs.get(JOB_SOURCE.PRIORITY_LOADER)?.size || 0,
                streaming: this.sourceJobs.get(JOB_SOURCE.STREAMING)?.size || 0,
                gpu: this.sourceJobs.get(JOB_SOURCE.GPU_COMPUTE)?.size || 0,
                manager: this.sourceJobs.get(JOB_SOURCE.CHUNK_MANAGER)?.size || 0,
            },
            
            // Performance stats
            stats: { ...this.stats },
        };
    }
    
    /**
     * Format debug info as multi-line string for HUD display
     * @returns {string}
     */
    getDebugString() {
        const info = this.getDebugInfo();
        return [
            `[Streaming]`,
            `  Speed: ${info.velocity.speed} u/s`,
            `  Velocity: (${info.velocity.x}, ${info.velocity.y}, ${info.velocity.z})`,
            `  Predicted: (${info.predicted.x}, ${info.predicted.y}, ${info.predicted.z})`,
            `  Hysteresis: ${info.loadRadius}/${info.unloadRadius} (buffer: ${info.bufferZone})`,
            `  Jobs: ${info.activeJobs} active, ${info.completedChunks} completed`,
            `  Sources: P:${info.sourceStats.priority} S:${info.sourceStats.streaming} G:${info.sourceStats.gpu} M:${info.sourceStats.manager}`,
            `  Morton Index: ${info.mortonIndexSize}`,
            `  Predictions: ${info.stats.velocityPredictions || 0}`,
            `  Hysteresis Blocks: ${info.stats.hysteresisBlocks || 0}`,
            `  Evictions: ${info.stats.evictions || 0}`,
        ].join('\n');
    }
    
    // ========================================================================
    // CAVE VISIBILITY BFS - Portal-based visibility for underground chunks
    // ========================================================================
    
    /**
     * Compute visible chunks using BFS through open chunk faces (portal culling)
     * Uses faceOpenness bits to traverse through connected air spaces
     * 
     * @param {Map<string, VoxelChunk>} chunks - All loaded chunks
     * @param {number} pcx - Player chunk X
     * @param {number} pcy - Player chunk Y
     * @param {number} pcz - Player chunk Z
     * @param {number} maxDepth - Maximum BFS depth (default: load radius)
     * @returns {Set<string>} - Set of visible chunk keys
     */
    computeVisibleChunks(chunks, pcx, pcy, pcz, maxDepth = 12) {
        const visible = new Set();
        const visited = new Set();
        const queue = [];
        
        // Start from player's chunk
        const startKey = `${pcx},${pcy},${pcz}`;
        queue.push({ cx: pcx, cy: pcy, cz: pcz, depth: 0 });
        visited.add(startKey);
        
        // Face direction offsets: +X, -X, +Y, -Y, +Z, -Z
        const FACE_OFFSETS = [
            { dx: 1, dy: 0, dz: 0, face: 0, oppFace: 1 },  // +X
            { dx: -1, dy: 0, dz: 0, face: 1, oppFace: 0 }, // -X
            { dx: 0, dy: 1, dz: 0, face: 2, oppFace: 3 },  // +Y
            { dx: 0, dy: -1, dz: 0, face: 3, oppFace: 2 }, // -Y
            { dx: 0, dy: 0, dz: 1, face: 4, oppFace: 5 },  // +Z
            { dx: 0, dy: 0, dz: -1, face: 5, oppFace: 4 }, // -Z
        ];
        
        while (queue.length > 0) {
            const { cx, cy, cz, depth } = queue.shift();
            const key = `${cx},${cy},${cz}`;
            
            // Mark as visible
            visible.add(key);
            
            // Don't explore beyond max depth
            if (depth >= maxDepth) continue;
            
            const chunk = chunks.get(key);
            if (!chunk) continue;
            
            // Check each face for openness (can see through to neighbor)
            for (const { dx, dy, dz, face, oppFace } of FACE_OFFSETS) {
                // Check if this chunk's face is open (has air)
                const faceOpen = (chunk.faceOpenness & (1 << face)) !== 0;
                if (!faceOpen) continue;
                
                // Check neighbor
                const nx = cx + dx;
                const ny = cy + dy;
                const nz = cz + dz;
                const neighborKey = `${nx},${ny},${nz}`;
                
                if (visited.has(neighborKey)) continue;
                visited.add(neighborKey);
                
                // Check if neighbor's opposite face is also open
                const neighbor = chunks.get(neighborKey);
                if (neighbor) {
                    const neighborFaceOpen = (neighbor.faceOpenness & (1 << oppFace)) !== 0;
                    if (neighborFaceOpen) {
                        // Can see through! Add to queue
                        queue.push({ cx: nx, cy: ny, cz: nz, depth: depth + 1 });
                    }
                } else {
                    // Neighbor not loaded - assume visible (will be loaded)
                    queue.push({ cx: nx, cy: ny, cz: nz, depth: depth + 1 });
                }
            }
        }
        
        return visible;
    }
    
    /**
     * Get visibility-based priority boost for a chunk
     * Returns higher priority for chunks reachable through open faces
     * 
     * @param {string} chunkKey 
     * @param {Set<string>} visibleChunks - From computeVisibleChunks
     * @returns {number} - Priority boost (0 if not visible, 50 if visible)
     */
    getVisibilityBoost(chunkKey, visibleChunks) {
        return visibleChunks.has(chunkKey) ? 50 : 0;
    }
    
    /**
     * Get chunks in Morton order within a bounding box
     * Uses Z-order curve for cache-friendly iteration
     * @param {number} minX - Min chunk X
     * @param {number} minY - Min chunk Y
     * @param {number} minZ - Min chunk Z
     * @param {number} maxX - Max chunk X
     * @param {number} maxY - Max chunk Y
     * @param {number} maxZ - Max chunk Z
     * @returns {Array} - Chunk keys in Morton order
     */
    getChunksInMortonOrder(minX, minY, minZ, maxX, maxY, maxZ) {
        const chunks = [];
        const minMorton = encodeMorton3D(minX, minY, minZ);
        const maxMorton = encodeMorton3D(maxX, maxY, maxZ);
        
        // Collect all Morton codes in range
        const mortonCodes = [];
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    mortonCodes.push({
                        morton: encodeMorton3D(x, y, z),
                        x, y, z
                    });
                }
            }
        }
        
        // Sort by Morton code for cache-friendly access
        mortonCodes.sort((a, b) => a.morton - b.morton);
        
        return mortonCodes.map(m => ({
            key: ChunkJobCoordinator.key(m.x, m.y, m.z),
            cx: m.x, cy: m.y, cz: m.z,
            morton: m.morton
        }));
    }
}

export default ChunkJobCoordinator;
