// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkUpdater.js - Block Update Queue Manager
 * 
 * Manages block updates with:
 * - Rate-limited updates per frame
 * - Propagation for lighting/physics
 * - Lazy update batching
 * - Update coalescing
 */

export class ChunkUpdater {
    constructor() {
        this.enabled = true;
        
        // Update limits
        this.maxUpdatesPerFrame = 1000;
        this.propagationDistance = 16;
        this.lazyUpdates = true;
        this.lazyDelayMs = 50;
        this.coalesceUpdates = true;
        this.remeshDelayMs = 16;
        
        // Queues
        this.updateQueue = [];
        this.pendingRemesh = new Set();
        this.coalescedUpdates = new Map(); // key -> {updates: [], timer}
        
        // Statistics
        this.stats = {
            updatesThisFrame: 0,
            totalUpdates: 0,
            coalescedCount: 0,
            pendingCount: 0,
        };
        
        // Callbacks
        this.onBlockUpdate = null;
        this.onChunkRemesh = null;
    }
    
    /**
     * Queue a block update
     * @param {number} x - World X
     * @param {number} y - World Y
     * @param {number} z - World Z
     * @param {number} oldMaterial - Previous material
     * @param {number} newMaterial - New material
     * @param {Object} options - Extra options
     */
    queueUpdate(x, y, z, oldMaterial, newMaterial, options = {}) {
        const update = {
            x, y, z,
            oldMaterial,
            newMaterial,
            time: performance.now(),
            propagate: options.propagate !== false,
            priority: options.priority || 0,
        };
        
        if (this.coalesceUpdates) {
            this._coalesceUpdate(update);
        } else {
            this.updateQueue.push(update);
        }
    }
    
    /**
     * Coalesce nearby updates
     */
    _coalesceUpdate(update) {
        const chunkKey = `${Math.floor(update.x / 32)},${Math.floor(update.y / 32)},${Math.floor(update.z / 32)}`;
        
        if (!this.coalescedUpdates.has(chunkKey)) {
            this.coalescedUpdates.set(chunkKey, {
                updates: [],
                timer: null,
            });
        }
        
        const bucket = this.coalescedUpdates.get(chunkKey);
        bucket.updates.push(update);
        
        // Reset timer
        if (bucket.timer) {
            clearTimeout(bucket.timer);
        }
        
        if (this.lazyUpdates) {
            bucket.timer = setTimeout(() => {
                this._flushBucket(chunkKey);
            }, this.lazyDelayMs);
        } else {
            this._flushBucket(chunkKey);
        }
    }
    
    /**
     * Flush coalesced updates for a chunk
     */
    _flushBucket(chunkKey) {
        const bucket = this.coalescedUpdates.get(chunkKey);
        if (!bucket) return;
        
        this.updateQueue.push(...bucket.updates);
        this.stats.coalescedCount += bucket.updates.length;
        this.coalescedUpdates.delete(chunkKey);
    }
    
    /**
     * Process updates for this frame
     * @param {ChunkManager} chunkManager 
     * @returns {number} - Number of updates processed
     */
    processUpdates(chunkManager) {
        if (!this.enabled) return 0;
        
        this.stats.updatesThisFrame = 0;
        const chunksToRemesh = new Set();
        
        // Sort by priority
        this.updateQueue.sort((a, b) => b.priority - a.priority);
        
        // Process up to limit
        while (this.updateQueue.length > 0 && this.stats.updatesThisFrame < this.maxUpdatesPerFrame) {
            const update = this.updateQueue.shift();
            
            // Apply update
            if (chunkManager) {
                chunkManager.setVoxel(update.x, update.y, update.z, update.newMaterial);
            }
            
            // Track chunk for remesh
            const cx = Math.floor(update.x / 32);
            const cy = Math.floor(update.y / 32);
            const cz = Math.floor(update.z / 32);
            chunksToRemesh.add(`${cx},${cy},${cz}`);
            
            // Propagate to neighbors if at edge
            if (update.propagate) {
                const lx = update.x - cx * 32;
                const ly = update.y - cy * 32;
                const lz = update.z - cz * 32;
                
                if (lx === 0) chunksToRemesh.add(`${cx-1},${cy},${cz}`);
                if (lx === 31) chunksToRemesh.add(`${cx+1},${cy},${cz}`);
                if (ly === 0) chunksToRemesh.add(`${cx},${cy-1},${cz}`);
                if (ly === 31) chunksToRemesh.add(`${cx},${cy+1},${cz}`);
                if (lz === 0) chunksToRemesh.add(`${cx},${cy},${cz-1}`);
                if (lz === 31) chunksToRemesh.add(`${cx},${cy},${cz+1}`);
            }
            
            // Callback
            if (this.onBlockUpdate) {
                this.onBlockUpdate(update);
            }
            
            this.stats.updatesThisFrame++;
            this.stats.totalUpdates++;
        }
        
        // Queue remeshes
        for (const key of chunksToRemesh) {
            this.pendingRemesh.add(key);
        }
        
        // Process remeshes after delay
        if (this.pendingRemesh.size > 0 && this.onChunkRemesh) {
            setTimeout(() => {
                for (const key of this.pendingRemesh) {
                    this.onChunkRemesh(key);
                }
                this.pendingRemesh.clear();
            }, this.remeshDelayMs);
        }
        
        this.stats.pendingCount = this.updateQueue.length;
        return this.stats.updatesThisFrame;
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Clear all pending updates
     */
    clear() {
        this.updateQueue = [];
        this.pendingRemesh.clear();
        for (const bucket of this.coalescedUpdates.values()) {
            if (bucket.timer) clearTimeout(bucket.timer);
        }
        this.coalescedUpdates.clear();
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [chunk_updates] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.maxUpdatesPerFrame = parseInt(cfg.max_updates_per_frame) || 1000;
        this.propagationDistance = parseInt(cfg.propagation_distance) || 16;
        this.lazyUpdates = cfg.lazy_updates !== false;
        this.lazyDelayMs = parseInt(cfg.lazy_delay_ms) || 50;
        this.coalesceUpdates = cfg.coalesce_updates !== false;
        this.remeshDelayMs = parseInt(cfg.remesh_delay_ms) || 16;
    }
}

export default ChunkUpdater;
