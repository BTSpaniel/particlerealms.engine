// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkLoadingZone.js - Virtual Buffer Wall System
 * 
 * Prevents players from advancing past unloaded terrain.
 * Creates an invisible barrier at the edge of generated chunks.
 * 
 * Benefits:
 * - Players never see unloaded terrain
 * - Prevents falling through world
 * - Smooth loading experience
 * - Configurable buffer distance
 * 
 * Zones:
 * - SAFE: Fully loaded, player can move freely
 * - BUFFER: Loading in progress, soft warning
 * - BARRIER: Not yet loaded, cannot pass
 */

export const ZONE_STATE = {
    SAFE: 0,      // Fully loaded and meshed
    BUFFER: 1,    // Loading/meshing in progress
    BARRIER: 2,   // Not yet generated
};

/**
 * ChunkLoadingZone - Manages player movement boundaries
 */
export class ChunkLoadingZone {
    constructor() {
        this.enabled = true;
        
        // Zone configuration
        this.safeRadius = 4;      // Chunks that are fully loaded
        this.bufferRadius = 6;    // Chunks being loaded (soft warning)
        this.barrierRadius = 8;   // Hard barrier - cannot pass
        
        // Chunk tracking
        this.loadedChunks = new Set();     // Fully meshed
        this.loadingChunks = new Set();    // Currently loading
        this.pendingChunks = new Set();    // Queued for load
        
        // Player state
        this.playerChunkX = 0;
        this.playerChunkZ = 0;
        this.playerWorldPos = [0, 0, 0];
        
        // Barrier state
        this.barrierActive = false;
        this.barrierDirection = [0, 0, 0];  // Direction player is blocked
        this.barrierDistance = 0;
        
        // Callbacks
        this.onBarrierHit = null;
        this.onZoneChange = null;
        
        // Visual feedback
        this.showDebugZones = false;
        this.zoneColors = {
            [ZONE_STATE.SAFE]: [0, 1, 0, 0.1],     // Green
            [ZONE_STATE.BUFFER]: [1, 1, 0, 0.2],   // Yellow
            [ZONE_STATE.BARRIER]: [1, 0, 0, 0.3],  // Red
        };
        
        // Stats
        this.stats = {
            barrierHits: 0,
            zoneTransitions: 0,
        };
    }
    
    /**
     * Update player position and check zones
     * @param {Array} worldPos - [x, y, z] world position
     * @param {number} chunkSize - Size of chunks (default 32)
     * @returns {Object} - { zone, canMove, blockedDirection }
     */
    updatePlayerPosition(worldPos, chunkSize = 32) {
        this.playerWorldPos = worldPos;
        
        const newChunkX = Math.floor(worldPos[0] / chunkSize);
        const newChunkZ = Math.floor(worldPos[2] / chunkSize);
        
        // Check if player moved to new chunk
        if (newChunkX !== this.playerChunkX || newChunkZ !== this.playerChunkZ) {
            const oldZone = this.getZoneAt(this.playerChunkX, this.playerChunkZ);
            this.playerChunkX = newChunkX;
            this.playerChunkZ = newChunkZ;
            const newZone = this.getZoneAt(newChunkX, newChunkZ);
            
            if (oldZone !== newZone && this.onZoneChange) {
                this.onZoneChange(oldZone, newZone);
                this.stats.zoneTransitions++;
            }
        }
        
        return this.checkMovement(worldPos, chunkSize);
    }
    
    /**
     * Check if player can move to position
     * @param {Array} worldPos 
     * @param {number} chunkSize 
     * @returns {Object}
     */
    checkMovement(worldPos, chunkSize = 32) {
        if (!this.enabled) {
            return { zone: ZONE_STATE.SAFE, canMove: true, blockedDirection: null };
        }
        
        const chunkX = Math.floor(worldPos[0] / chunkSize);
        const chunkZ = Math.floor(worldPos[2] / chunkSize);
        
        const zone = this.getZoneAt(chunkX, chunkZ);
        
        if (zone === ZONE_STATE.BARRIER) {
            // Calculate blocked direction
            const dx = chunkX - this.playerChunkX;
            const dz = chunkZ - this.playerChunkZ;
            const blockedDirection = this.normalizeDirection(dx, 0, dz);
            
            this.barrierActive = true;
            this.barrierDirection = blockedDirection;
            this.stats.barrierHits++;
            
            if (this.onBarrierHit) {
                this.onBarrierHit(worldPos, blockedDirection);
            }
            
            return {
                zone,
                canMove: false,
                blockedDirection,
                message: 'Waiting for terrain to generate...',
            };
        }
        
        this.barrierActive = false;
        
        return {
            zone,
            canMove: true,
            blockedDirection: null,
            message: zone === ZONE_STATE.BUFFER ? 'Approaching unloaded area' : null,
        };
    }
    
    /**
     * Get zone state at chunk position
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @returns {number} - ZONE_STATE
     */
    getZoneAt(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        
        // Check if chunk is loaded
        if (this.loadedChunks.has(key)) {
            // Check neighbors for safe zone
            const allNeighborsLoaded = this.checkNeighborsLoaded(chunkX, chunkZ, 1);
            if (allNeighborsLoaded) {
                return ZONE_STATE.SAFE;
            }
            return ZONE_STATE.BUFFER;
        }
        
        // Check if loading
        if (this.loadingChunks.has(key) || this.pendingChunks.has(key)) {
            return ZONE_STATE.BUFFER;
        }
        
        return ZONE_STATE.BARRIER;
    }
    
    /**
     * Check if all neighbors within radius are loaded
     */
    checkNeighborsLoaded(chunkX, chunkZ, radius) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const key = `${chunkX + dx},${chunkZ + dz}`;
                if (!this.loadedChunks.has(key)) {
                    return false;
                }
            }
        }
        return true;
    }
    
    /**
     * Mark chunk as loaded
     * @param {number} chunkX 
     * @param {number} chunkZ 
     */
    markLoaded(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        this.loadedChunks.add(key);
        this.loadingChunks.delete(key);
        this.pendingChunks.delete(key);
    }
    
    /**
     * Mark chunk as loading
     */
    markLoading(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        this.loadingChunks.add(key);
        this.pendingChunks.delete(key);
    }
    
    /**
     * Mark chunk as pending
     */
    markPending(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        if (!this.loadedChunks.has(key) && !this.loadingChunks.has(key)) {
            this.pendingChunks.add(key);
        }
    }
    
    /**
     * Mark chunk as unloaded
     */
    markUnloaded(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        this.loadedChunks.delete(key);
        this.loadingChunks.delete(key);
        this.pendingChunks.delete(key);
    }
    
    /**
     * Get corrected position that respects barriers
     * @param {Array} currentPos - Current position
     * @param {Array} desiredPos - Desired position
     * @param {number} chunkSize 
     * @returns {Array} - Corrected position
     */
    getClampedPosition(currentPos, desiredPos, chunkSize = 32) {
        const result = this.checkMovement(desiredPos, chunkSize);
        
        if (result.canMove) {
            return desiredPos;
        }
        
        // Slide along barrier
        const corrected = [...desiredPos];
        
        if (result.blockedDirection) {
            const dx = desiredPos[0] - currentPos[0];
            const dz = desiredPos[2] - currentPos[2];
            
            // Remove movement component in blocked direction
            if (Math.abs(result.blockedDirection[0]) > 0.5) {
                corrected[0] = currentPos[0];
            }
            if (Math.abs(result.blockedDirection[2]) > 0.5) {
                corrected[2] = currentPos[2];
            }
        }
        
        // Verify corrected position is valid
        const verifyResult = this.checkMovement(corrected, chunkSize);
        if (verifyResult.canMove) {
            return corrected;
        }
        
        // Fall back to current position
        return currentPos;
    }
    
    /**
     * Get distance to nearest barrier
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @returns {number} - Distance in chunks (-1 if no barrier nearby)
     */
    getBarrierDistance(chunkX, chunkZ) {
        let minDist = Infinity;
        
        // Check in expanding rings
        for (let r = 1; r <= this.barrierRadius; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.abs(dx) === r || Math.abs(dz) === r) {
                        const zone = this.getZoneAt(chunkX + dx, chunkZ + dz);
                        if (zone === ZONE_STATE.BARRIER) {
                            const dist = Math.sqrt(dx * dx + dz * dz);
                            minDist = Math.min(minDist, dist);
                        }
                    }
                }
            }
        }
        
        return minDist === Infinity ? -1 : minDist;
    }
    
    /**
     * Get all chunks in each zone around player
     * @param {number} radius 
     * @returns {Object} - { safe: [], buffer: [], barrier: [] }
     */
    getZoneChunks(radius = 8) {
        const result = {
            safe: [],
            buffer: [],
            barrier: [],
        };
        
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const cx = this.playerChunkX + dx;
                const cz = this.playerChunkZ + dz;
                const zone = this.getZoneAt(cx, cz);
                
                const entry = { x: cx, z: cz, distance: Math.sqrt(dx * dx + dz * dz) };
                
                switch (zone) {
                    case ZONE_STATE.SAFE:
                        result.safe.push(entry);
                        break;
                    case ZONE_STATE.BUFFER:
                        result.buffer.push(entry);
                        break;
                    case ZONE_STATE.BARRIER:
                        result.barrier.push(entry);
                        break;
                }
            }
        }
        
        return result;
    }
    
    /**
     * Normalize direction vector
     */
    normalizeDirection(dx, dy, dz) {
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len === 0) return [0, 0, 0];
        return [dx / len, dy / len, dz / len];
    }
    
    /**
     * Clear all chunk tracking
     */
    clear() {
        this.loadedChunks.clear();
        this.loadingChunks.clear();
        this.pendingChunks.clear();
        this.barrierActive = false;
    }
    
    /**
     * Get stats
     */
    getStats() {
        return {
            ...this.stats,
            loadedCount: this.loadedChunks.size,
            loadingCount: this.loadingChunks.size,
            pendingCount: this.pendingChunks.size,
            currentZone: this.getZoneAt(this.playerChunkX, this.playerChunkZ),
            barrierDistance: this.getBarrierDistance(this.playerChunkX, this.playerChunkZ),
        };
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [chunk_loading] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.safeRadius = parseInt(cfg.render_distance) || 8;
        this.bufferRadius = parseInt(cfg.buffer_distance) || 2;
        this.barrierRadius = this.safeRadius + this.bufferRadius;
    }
}

export default ChunkLoadingZone;
