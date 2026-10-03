// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PriorityChunkLoader.js - Distance-Based Chunk Loading
 * 
 * Loads chunks in order from closest to player outward.
 * Uses spiral/ring pattern for optimal loading experience.
 * 
 * Benefits:
 * - Player sees nearby terrain first
 * - Smooth loading experience
 * - Efficient resource usage
 * - Integrates with ChunkLoadingZone
 * 
 * Patterns:
 * - SPIRAL: Classic spiral from center
 * - RINGS: Concentric rings outward
 * - DIRECTIONAL: Prioritize direction player is facing
 */

import { degreesToRadians } from '../../core/math/UnitMath.js';
import { statsMean } from '../../core/math/MathStatistics.js';

export const LOAD_PATTERN = {
    SPIRAL: 'spiral',
    RINGS: 'rings',
    DIRECTIONAL: 'directional',
};

/**
 * Generate spiral order coordinates
 * @param {number} radius - Max radius in chunks
 * @returns {Array} - [{x, z, distance}]
 */
function generateSpiralOrder(radius) {
    const result = [];
    let x = 0, z = 0;
    let dx = 0, dz = -1;
    const size = radius * 2 + 1;
    const maxSteps = size * size;
    
    for (let i = 0; i < maxSteps; i++) {
        if (-radius <= x && x <= radius && -radius <= z && z <= radius) {
            result.push({
                x,
                z,
                distance: Math.sqrt(x * x + z * z),
            });
        }
        
        // Spiral logic
        if (x === z || (x < 0 && x === -z) || (x > 0 && x === 1 - z)) {
            const temp = dx;
            dx = -dz;
            dz = temp;
        }
        x += dx;
        z += dz;
    }
    
    // Sort by distance (spiral isn't perfectly distance-sorted)
    result.sort((a, b) => a.distance - b.distance);
    
    return result;
}

/**
 * Generate ring order coordinates (true distance-based)
 * @param {number} radius 
 * @returns {Array}
 */
function generateRingOrder(radius) {
    const result = [];
    
    for (let r = 0; r <= radius; r++) {
        if (r === 0) {
            result.push({ x: 0, z: 0, distance: 0 });
            continue;
        }
        
        // Get all chunks at this ring distance
        const ring = [];
        for (let x = -r; x <= r; x++) {
            for (let z = -r; z <= r; z++) {
                // Only edge of ring
                if (Math.abs(x) === r || Math.abs(z) === r) {
                    ring.push({
                        x,
                        z,
                        distance: Math.sqrt(x * x + z * z),
                    });
                }
            }
        }
        
        // Sort ring by angle for smooth visual loading
        ring.sort((a, b) => {
            const angleA = Math.atan2(a.z, a.x);
            const angleB = Math.atan2(b.z, b.x);
            return angleA - angleB;
        });
        
        result.push(...ring);
    }
    
    return result;
}

/**
 * PriorityChunkLoader - Manages chunk load ordering
 */
export class PriorityChunkLoader {
    constructor() {
        this.enabled = true;
        
        // Configuration - AGGRESSIVE for fast loading
        this.loadRadius = 12;          // Max load radius in chunks (increased)
        this.maxLoadsPerFrame = 48;    // Chunks to load per frame (3x)
        this.maxMeshesPerFrame = 32;   // Chunks to mesh per frame (4x)
        this.pattern = LOAD_PATTERN.RINGS;
        
        // Per-frame tracking for profiler (avg/min/max)
        this.lastLoadsThisFrame = 0;
        this.lastMeshesThisFrame = 0;
        
        // Adaptive FPS-based loading
        this.adaptiveLoading = true;   // Enable FPS-based throttling
        this.targetFPS = 60;           // Target minimum FPS
        this.currentFPS = 60;          // Current measured FPS
        this.fpsHistory = [];          // Rolling FPS samples
        this.maxFPSSamples = 10;       // Samples for averaging
        this.lastFrameTime = 0;        // For FPS calculation
        
        // Adaptive load limits (dynamically adjusted)
        this.adaptiveLoads = 16;       // Current loads per frame
        this.adaptiveMeshes = 8;       // Current meshes per frame
        this.minLoadsPerFrame = 4;     // Never go below this
        this.minMeshesPerFrame = 2;    // Never go below this
        this.maxLoadsLimit = 32;       // Upper limit when FPS is great
        this.maxMeshesLimit = 16;      // Upper limit when FPS is great
        
        // LOD configuration - distance thresholds in chunks
        this.lodEnabled = true;
        this.lod0Distance = 4;         // Full detail within 4 chunks
        this.lod1Distance = 7;         // Medium detail 4-7 chunks
        this.lod2Distance = 12;        // Low detail 7-12 chunks (beyond is LOD 2)
        
        // Player state
        this.playerChunkX = 0;
        this.playerChunkY = 0;  // Y position in chunks for vertical prioritization
        this.playerChunkZ = 0;
        this.playerDirection = [0, 0, 1];  // Facing direction (x, y, z)
        this.playerLookingDown = false;    // True if looking downward (pitch < -30°)
        
        // Velocity-based prediction (from streaming architecture doc)
        this.playerVelocity = [0, 0, 0];   // Smoothed velocity vector
        this.lastPlayerPos = [0, 0, 0];    // Last position for velocity calc
        this.velocitySmoothing = 0.85;     // EMA smoothing factor
        this.velocityPriorityBoost = 30;   // Max priority boost for chunks ahead
        this.useVelocityPrediction = true; // Enable velocity-based priority
        
        // FOV-based priority with buffer zone
        this.useFOVPriority = true;        // Enable FOV-based chunk priority
        this.fovAngle = 90;                // Camera FOV in degrees
        this.fovCosHalf = Math.cos(degreesToRadians(90 / 2));  // cos(45°) ≈ 0.707
        this.fovBufferAngle = 30;          // Buffer zone beyond FOV (degrees)
        this.fovBufferCos = Math.cos(degreesToRadians((90 + 30) / 2));  // cos(60°) ≈ 0.5
        this.fovPriorityBoost = 40;        // Boost for chunks in FOV
        this.fovBufferBoost = 15;          // Boost for chunks in buffer zone
        this.behindPenalty = 30;           // Penalty for chunks behind player
        
        // Vertical loading priorities
        this.verticalLoadRadius = 4;       // Load chunks this many levels above/below
        this.prioritizeSameLevel = true;   // Give bonus to chunks on same Y level
        this.unloadBelowWhenNotLooking = true;  // Unload chunks below when not looking down
        this.minHeightToLoadBelow = 300;   // Only load chunks below player when above this Y level
        this.playerWorldY = 0;             // Actual world Y position (not chunk Y)
        
        // Precomputed load orders
        this.spiralOrder = [];
        this.ringOrder = [];
        
        // Chunk state tracking
        this.chunkStates = new Map();  // key -> { state, priority, distance, lod }
        
        // Queues
        this.loadQueue = [];     // Chunks to generate
        this.meshQueue = [];     // Chunks to mesh
        this.unloadQueue = [];   // Chunks to unload
        this.lodUpgradeQueue = [];   // Chunks to upgrade LOD (closer now)
        this.lodDowngradeQueue = []; // Chunks to downgrade LOD (farther now)
        
        // Callbacks
        this.onLoadChunk = null;    // (chunkX, chunkZ, lod) => void
        this.onMeshChunk = null;    // (chunkX, chunkZ, lod) => void
        this.onUnloadChunk = null;  // (chunkX, chunkZ) => void
        this.onLODChange = null;    // (chunkX, chunkZ, newLOD, oldLOD) => void
        
        // WorldStorage reference for distance-based loading priority
        this.worldStorage = null;
        
        // Stats
        this.stats = {
            chunksLoaded: 0,
            chunksMeshed: 0,
            chunksUnloaded: 0,
            chunksCancelled: 0,  // Chunks removed from queue (player moved away)
            avgLoadTimeMs: 0,
            velocityPredictions: 0,  // Times velocity affected priority
            chunksInFOV: 0,       // Chunks prioritized in FOV
            chunksInBuffer: 0,    // Chunks in peripheral buffer zone
            chunksBehind: 0,      // Chunks penalized (behind player)
        };
        
        // Timing
        this.loadTimes = [];
        this.maxLoadTimeSamples = 30;
        
        // Initialize load orders
        this.rebuildLoadOrder();
    }
    
    /**
     * Rebuild the precomputed load orders
     */
    rebuildLoadOrder() {
        this.spiralOrder = generateSpiralOrder(this.loadRadius);
        this.ringOrder = generateRingOrder(this.loadRadius);
    }
    
    /**
     * Set load radius and rebuild orders
     * @param {number} radius 
     */
    setLoadRadius(radius) {
        if (radius !== this.loadRadius) {
            this.loadRadius = radius;
            this.rebuildLoadOrder();
        }
    }
    
    /**
     * Update player position and rebuild queues
     * @param {number} worldX 
     * @param {number} worldY - Player Y position for vertical prioritization
     * @param {number} worldZ 
     * @param {number} chunkSize 
     * @param {Array} direction - Optional facing direction [x, y, z]
     */
    updatePlayerPosition(worldX, worldY = 0, worldZ, chunkSize = 32, direction = null, dt = 0.016) {
        // Handle old API: updatePlayerPosition(x, z, chunkSize, direction)
        if (typeof worldY !== 'number' || worldY > 1000) {
            // Old API detected - worldY is actually worldZ
            worldZ = worldY;
            worldY = 0;
        }
        
        const newChunkX = Math.floor(worldX / chunkSize);
        const newChunkY = Math.floor(worldY / chunkSize);
        const newChunkZ = Math.floor(worldZ / chunkSize);
        
        // Store actual world Y for height-based decisions
        this.playerWorldY = worldY;
        
        // Update velocity for predictive loading
        if (this.useVelocityPrediction && dt > 0) {
            const vx = (worldX - this.lastPlayerPos[0]) / dt;
            const vy = (worldY - this.lastPlayerPos[1]) / dt;
            const vz = (worldZ - this.lastPlayerPos[2]) / dt;
            
            // EMA smoothing
            const s = this.velocitySmoothing;
            this.playerVelocity[0] = s * this.playerVelocity[0] + (1 - s) * vx;
            this.playerVelocity[1] = s * this.playerVelocity[1] + (1 - s) * vy;
            this.playerVelocity[2] = s * this.playerVelocity[2] + (1 - s) * vz;
            
            this.lastPlayerPos = [worldX, worldY, worldZ];
        }
        
        if (direction) {
            this.playerDirection = direction;
            // Check if looking down (Y component < -0.5, roughly -30° pitch)
            this.playerLookingDown = direction[1] < -0.5;
        }
        
        // Always prune queues even if player hasn't moved chunks
        // This cancels loads for chunks that are now too far
        this.pruneQueues(newChunkX, newChunkZ);
        
        // Only fully rebuild if chunk changed
        if (newChunkX !== this.playerChunkX || newChunkZ !== this.playerChunkZ || newChunkY !== this.playerChunkY) {
            this.playerChunkX = newChunkX;
            this.playerChunkY = newChunkY;
            this.playerChunkZ = newChunkZ;
            
            // Update WorldStorage player position for distance-based loading priority
            if (this.worldStorage && this.worldStorage.setPlayerPosition) {
                this.worldStorage.setPlayerPosition(newChunkX, newChunkY, newChunkZ);
            }
            
            this.rebuildQueues();
        } else {
            // Re-sort existing queues by new distances
            this.resortQueues();
        }
    }
    
    /**
     * Prune queues - remove chunks that are now too far away
     * Called every position update to cancel unnecessary loads
     * @param {number} playerChunkX 
     * @param {number} playerChunkZ 
     */
    pruneQueues(playerChunkX, playerChunkZ) {
        const maxDistSq = (this.loadRadius + 1) * (this.loadRadius + 1);
        let pruned = 0;
        
        // Prune load queue - don't load chunks that are now too far
        const beforeLoad = this.loadQueue.length;
        this.loadQueue = this.loadQueue.filter(chunk => {
            const dx = chunk.x - playerChunkX;
            const dz = chunk.z - playerChunkZ;
            const distSq = dx * dx + dz * dz;
            return distSq <= maxDistSq;
        });
        pruned += beforeLoad - this.loadQueue.length;
        
        // Prune mesh queue - don't mesh chunks that are now too far
        const beforeMesh = this.meshQueue.length;
        this.meshQueue = this.meshQueue.filter(chunk => {
            const dx = chunk.x - playerChunkX;
            const dz = chunk.z - playerChunkZ;
            const distSq = dx * dx + dz * dz;
            return distSq <= maxDistSq;
        });
        pruned += beforeMesh - this.meshQueue.length;
        
        if (pruned > 0) {
            this.stats.chunksCancelled = (this.stats.chunksCancelled || 0) + pruned;
        }
    }
    
    /**
     * Re-sort queues by distance without full rebuild
     * More efficient when player moves within same chunk
     */
    resortQueues() {
        // Update distances and priorities
        for (const chunk of this.loadQueue) {
            const dx = chunk.x - this.playerChunkX;
            const dz = chunk.z - this.playerChunkZ;
            chunk.distance = Math.sqrt(dx * dx + dz * dz);
            chunk.priority = this.calculatePriority({ x: dx, z: dz, distance: chunk.distance });
        }
        
        for (const chunk of this.meshQueue) {
            const dx = chunk.x - this.playerChunkX;
            const dz = chunk.z - this.playerChunkZ;
            chunk.distance = Math.sqrt(dx * dx + dz * dz);
            chunk.priority = this.calculatePriority({ x: dx, z: dz, distance: chunk.distance });
        }
        
        // Re-sort by priority (higher = more important)
        this.loadQueue.sort((a, b) => b.priority - a.priority);
        this.meshQueue.sort((a, b) => b.priority - a.priority);
    }
    
    /**
     * Rebuild load/mesh/unload queues based on player position
     */
    rebuildQueues() {
        const loadOrder = this.getLoadOrder();
        
        // Clear queues
        this.loadQueue = [];
        this.meshQueue = [];
        this.unloadQueue = [];
        this.lodUpgradeQueue = [];
        this.lodDowngradeQueue = [];
        
        // Build new load queue and check LOD changes
        for (const offset of loadOrder) {
            const cx = this.playerChunkX + offset.x;
            const cz = this.playerChunkZ + offset.z;
            const key = `${cx},${cz}`;
            
            const state = this.chunkStates.get(key);
            const newLOD = this.calculateLOD(offset.distance);
            
            if (!state || state.state === 'unloaded') {
                this.loadQueue.push({
                    x: cx,
                    z: cz,
                    distance: offset.distance,
                    priority: this.calculatePriority(offset),
                    lod: newLOD,
                });
            } else if (state.state === 'loaded') {
                this.meshQueue.push({
                    x: cx,
                    z: cz,
                    distance: offset.distance,
                    priority: this.calculatePriority(offset),
                    lod: newLOD,
                });
            } else if (state.state === 'meshed' && this.lodEnabled) {
                // Check if LOD needs to change
                const currentLOD = state.lod !== undefined ? state.lod : 0;
                if (newLOD !== currentLOD) {
                    const lodChange = {
                        x: cx,
                        z: cz,
                        distance: offset.distance,
                        currentLOD,
                        newLOD,
                    };
                    
                    if (newLOD < currentLOD) {
                        // Closer now - upgrade (higher priority)
                        this.lodUpgradeQueue.push(lodChange);
                    } else {
                        // Farther now - downgrade (lower priority)
                        this.lodDowngradeQueue.push(lodChange);
                    }
                }
            }
        }
        
        // Find chunks to unload (outside load radius OR below player when not looking)
        for (const [key, state] of this.chunkStates) {
            const parts = key.split(',').map(Number);
            const cx = parts[0];
            const cy = parts.length > 2 ? parts[1] : 0;  // Support 3D keys: "x,y,z" or 2D: "x,z"
            const cz = parts.length > 2 ? parts[2] : parts[1];
            
            const dx = cx - this.playerChunkX;
            const dy = cy - this.playerChunkY;
            const dz = cz - this.playerChunkZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            let shouldUnload = false;
            let unloadPriority = dist;
            
            // Unload if outside horizontal radius
            if (dist > this.loadRadius + 2) {
                shouldUnload = true;
            }
            
            // Unload chunks far below player when not looking down
            if (this.unloadBelowWhenNotLooking && !this.playerLookingDown) {
                if (dy < -this.verticalLoadRadius) {
                    shouldUnload = true;
                    unloadPriority = -dy;  // Prioritize unloading deeper chunks first
                }
            }
            
            // Always unload chunks below if player is below minHeightToLoadBelow (e.g., 300)
            // Only load underground when high enough to see down
            if (this.playerWorldY < this.minHeightToLoadBelow && dy < 0) {
                shouldUnload = true;
                unloadPriority = Math.max(unloadPriority, -dy + 10);  // Higher priority to clear underground
            }
            
            // Unload chunks far above player when looking down
            if (this.playerLookingDown && dy > this.verticalLoadRadius) {
                shouldUnload = true;
                unloadPriority = dy;
            }
            
            if (shouldUnload) {
                this.unloadQueue.push({ x: cx, y: cy, z: cz, distance: dist, unloadPriority });
            }
        }
        
        // Sort by priority
        this.loadQueue.sort((a, b) => b.priority - a.priority);
        this.meshQueue.sort((a, b) => b.priority - a.priority);
        this.unloadQueue.sort((a, b) => b.unloadPriority - a.unloadPriority);  // Highest priority first
        this.lodUpgradeQueue.sort((a, b) => a.distance - b.distance);  // Upgrade closest first
        this.lodDowngradeQueue.sort((a, b) => b.distance - a.distance);  // Downgrade farthest first
    }
    
    /**
     * Get load order based on current pattern
     * @returns {Array}
     */
    getLoadOrder() {
        switch (this.pattern) {
            case LOAD_PATTERN.SPIRAL:
                return this.spiralOrder;
            case LOAD_PATTERN.RINGS:
                return this.ringOrder;
            case LOAD_PATTERN.DIRECTIONAL:
                return this.getDirectionalOrder();
            default:
                return this.ringOrder;
        }
    }
    
    /**
     * Get directional load order (prioritize facing direction)
     * @returns {Array}
     */
    getDirectionalOrder() {
        const order = [...this.ringOrder];
        
        // Calculate direction weight
        const dirX = this.playerDirection[0];
        const dirZ = this.playerDirection[2];
        
        order.sort((a, b) => {
            // Distance factor (closer = higher priority)
            const distA = a.distance;
            const distB = b.distance;
            
            // Direction factor (in front = higher priority)
            const dotA = (a.x * dirX + a.z * dirZ) / (a.distance || 1);
            const dotB = (b.x * dirX + b.z * dirZ) / (b.distance || 1);
            
            // Combined score (lower = higher priority)
            const scoreA = distA - dotA * 2;  // Direction bonus
            const scoreB = distB - dotB * 2;
            
            return scoreA - scoreB;
        });
        
        return order;
    }
    
    /**
     * Calculate priority for a chunk offset
     * @param {Object} offset - { x, y, z, distance } - y is optional for vertical chunks
     * @returns {number} - Higher = more important
     */
    calculatePriority(offset) {
        // Base priority: inverse distance
        let priority = 100 - offset.distance * 10;
        
        // Direction bonus (chunks in view direction)
        const dirX = this.playerDirection[0];
        const dirY = this.playerDirection[1] || 0;
        const dirZ = this.playerDirection[2];
        
        // FOV-based priority with buffer zone
        if (this.useFOVPriority && offset.distance > 0) {
            // Calculate direction to chunk (horizontal)
            const dist = offset.distance;
            const toChunkX = offset.x / dist;
            const toChunkZ = offset.z / dist;
            
            // Dot product with camera direction (horizontal only for FOV)
            const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
            const dirNormX = dirX / dirLen;
            const dirNormZ = dirZ / dirLen;
            const fovDot = toChunkX * dirNormX + toChunkZ * dirNormZ;
            
            // Check if in FOV, buffer zone, or behind
            if (fovDot >= this.fovCosHalf) {
                // Inside FOV - highest priority boost
                priority += this.fovPriorityBoost;
            } else if (fovDot >= this.fovBufferCos) {
                // In buffer zone - medium boost (peripheral vision)
                const bufferFactor = (fovDot - this.fovBufferCos) / (this.fovCosHalf - this.fovBufferCos);
                priority += this.fovBufferBoost + bufferFactor * (this.fovPriorityBoost - this.fovBufferBoost);
            } else if (fovDot < 0) {
                // Behind player - penalty (but don't completely ignore)
                priority -= this.behindPenalty * Math.abs(fovDot);
            }
        } else {
            // Fallback: simple horizontal direction bonus
            const horizDot = (offset.x * dirX + offset.z * dirZ) / (offset.distance || 1);
            priority += horizDot * 15;
        }
        
        // Velocity-based priority boost (chunks in movement direction)
        if (this.useVelocityPrediction) {
            const speed = Math.sqrt(
                this.playerVelocity[0] ** 2 +
                this.playerVelocity[1] ** 2 +
                this.playerVelocity[2] ** 2
            );
            
            if (speed > 1) {  // Only if moving at reasonable speed
                // Normalize velocity
                const vnx = this.playerVelocity[0] / speed;
                const vny = this.playerVelocity[1] / speed;
                const vnz = this.playerVelocity[2] / speed;
                
                // Direction to chunk offset (normalized)
                const dist = offset.distance || 1;
                const dnx = offset.x / dist;
                const dny = (offset.y || 0) / dist;
                const dnz = offset.z / dist;
                
                // Dot product: 1.0 = directly ahead, -1.0 = behind
                const dot = vnx * dnx + vny * dny + vnz * dnz;
                
                // Boost priority for chunks in movement direction
                priority += dot * this.velocityPriorityBoost;
                
                if (dot > 0.5) {
                    this.stats.velocityPredictions++;
                }
            }
        }
        
        // Y-level bonus: prioritize chunks on same plane as player
        if (this.prioritizeSameLevel && offset.y !== undefined) {
            const yDiff = Math.abs(offset.y);
            if (yDiff === 0) {
                priority += 30;  // Strong bonus for same level
            } else if (yDiff === 1) {
                priority += 15;  // Medium bonus for adjacent levels
            } else {
                priority -= yDiff * 5;  // Penalty for distant vertical chunks
            }
            
            // If looking down, boost chunks below
            if (this.playerLookingDown && offset.y < 0) {
                priority += 20;
            }
            // If looking up, boost chunks above
            if (dirY > 0.5 && offset.y > 0) {
                priority += 20;
            }
        }
        
        // Penalize chunks below when not looking down
        if (this.unloadBelowWhenNotLooking && offset.y !== undefined && offset.y < -1 && !this.playerLookingDown) {
            priority -= 25;  // Strong penalty for chunks below when looking forward/up
        }
        
        // Don't load chunks below at all when player is below minHeightToLoadBelow (300)
        if (this.playerWorldY < this.minHeightToLoadBelow && offset.y !== undefined && offset.y < 0) {
            priority = -100;  // Effectively skip loading chunks below
        }
        
        return Math.max(-100, priority);  // Allow negative to signal "don't load"
    }
    
    /**
     * Calculate LOD level for a chunk based on distance
     * @param {number} distance - Distance in chunks
     * @returns {number} - LOD level (0 = full detail, 1 = medium, 2 = low)
     */
    calculateLOD(distance) {
        if (!this.lodEnabled) return 0;
        
        if (distance <= this.lod0Distance) return 0;  // Full detail
        if (distance <= this.lod1Distance) return 1;  // Medium detail
        return 2;  // Low detail
    }
    
    /**
     * Update FOV angle (call when camera FOV changes)
     * @param {number} fovDegrees - Camera FOV in degrees
     * @param {number} bufferDegrees - Optional buffer zone in degrees (default: 30)
     */
    setFOV(fovDegrees, bufferDegrees = 30) {
        this.fovAngle = fovDegrees;
        this.fovBufferAngle = bufferDegrees;
        
        // Precompute cosines for fast comparison
        this.fovCosHalf = Math.cos(degreesToRadians(fovDegrees / 2));
        this.fovBufferCos = Math.cos(degreesToRadians((fovDegrees + bufferDegrees) / 2));
    }
    
    /**
     * Update FPS and adjust loading limits adaptively
     * Call this every frame with current delta time or FPS
     * @param {number} deltaOrFPS - Either delta time in ms, or FPS if > 10
     */
    updateFPS(deltaOrFPS) {
        // Determine if input is delta (ms) or FPS
        const fps = deltaOrFPS > 10 ? deltaOrFPS : 1000 / deltaOrFPS;
        
        // Add to history
        this.fpsHistory.push(fps);
        if (this.fpsHistory.length > this.maxFPSSamples) {
            this.fpsHistory.shift();
        }
        
        // Calculate average FPS
        this.currentFPS = statsMean(this.fpsHistory);
        
        // Adjust adaptive limits if enabled
        if (this.adaptiveLoading) {
            this._adjustLoadingLimits();
        }
    }
    
    /**
     * Adjust loading limits based on current FPS
     * @private
     */
    _adjustLoadingLimits() {
        const fpsDiff = this.currentFPS - this.targetFPS;
        
        if (fpsDiff < -10) {
            // FPS way below target - aggressively reduce loading
            this.adaptiveLoads = this.minLoadsPerFrame;
            this.adaptiveMeshes = this.minMeshesPerFrame;
        } else if (fpsDiff < -5) {
            // FPS significantly below target - reduce loading
            this.adaptiveLoads = Math.max(this.minLoadsPerFrame, this.adaptiveLoads - 1);
            this.adaptiveMeshes = Math.max(this.minMeshesPerFrame, this.adaptiveMeshes - 1);
        } else if (fpsDiff < 0) {
            // FPS slightly below target - reduce a bit
            this.adaptiveLoads = Math.max(this.minLoadsPerFrame, Math.floor(this.adaptiveLoads * 0.8));
            this.adaptiveMeshes = Math.max(this.minMeshesPerFrame, Math.floor(this.adaptiveMeshes * 0.8));
        } else if (fpsDiff > 20) {
            // FPS way above target - can increase loading
            this.adaptiveLoads = Math.min(this.maxLoadsLimit, this.adaptiveLoads + 1);
            this.adaptiveMeshes = Math.min(this.maxMeshesLimit, this.adaptiveMeshes + 1);
        } else if (fpsDiff > 10) {
            // FPS comfortably above target - gradually increase
            // Deterministic throttle using frame count (multiplayer sync)
            if ((this._frameCount || 0) % 5 === 0) {  // Every 5th frame to avoid oscillation
                this.adaptiveLoads = Math.min(this.maxLoadsLimit, this.adaptiveLoads + 1);
            }
        }
        // else: FPS is close to target (0-10 above), keep current limits
    }
    
    /**
     * Get current adaptive loads per frame
     * @returns {number}
     */
    getAdaptiveLoads() {
        return this.adaptiveLoading ? this.adaptiveLoads : this.maxLoadsPerFrame;
    }
    
    /**
     * Get current adaptive meshes per frame
     * @returns {number}
     */
    getAdaptiveMeshes() {
        return this.adaptiveLoading ? this.adaptiveMeshes : this.maxMeshesPerFrame;
    }
    
    /**
     * Process queues - call once per frame
     * @returns {Object} - { loaded: [], meshed: [], unloaded: [], lodChanges: [] }
     */
    processFrame() {
        if (!this.enabled) return { loaded: [], meshed: [], unloaded: [], lodChanges: [] };
        
        const result = {
            loaded: [],
            meshed: [],
            unloaded: [],
            lodChanges: [],
        };
        
        const frameStart = performance.now();
        
        // Get adaptive limits based on FPS
        const loadsThisFrame = this.getAdaptiveLoads();
        const meshesThisFrame = this.getAdaptiveMeshes();
        
        // Reset per-frame tracking for profiler
        this.lastLoadsThisFrame = 0;
        this.lastMeshesThisFrame = 0;
        
        // Process load queue
        for (let i = 0; i < loadsThisFrame && this.loadQueue.length > 0; i++) {
            const chunk = this.loadQueue.shift();
            const key = `${chunk.x},${chunk.z}`;
            const lod = this.calculateLOD(chunk.distance);
            
            if (this.onLoadChunk) {
                const loadStart = performance.now();
                this.onLoadChunk(chunk.x, chunk.z, lod);
                this.trackLoadTime(performance.now() - loadStart);
            }
            
            this.chunkStates.set(key, {
                state: 'loaded',
                priority: chunk.priority,
                distance: chunk.distance,
                lod: lod,
            });
            
            chunk.lod = lod;
            result.loaded.push(chunk);
            this.stats.chunksLoaded++;
            this.lastLoadsThisFrame++;
            
            // Add to mesh queue with LOD
            this.meshQueue.push(chunk);
        }
        
        // Process mesh queue
        for (let i = 0; i < meshesThisFrame && this.meshQueue.length > 0; i++) {
            const chunk = this.meshQueue.shift();
            const key = `${chunk.x},${chunk.z}`;
            const lod = chunk.lod !== undefined ? chunk.lod : this.calculateLOD(chunk.distance);
            
            if (this.onMeshChunk) {
                this.onMeshChunk(chunk.x, chunk.z, lod);
            }
            
            const state = this.chunkStates.get(key);
            if (state) {
                state.state = 'meshed';
                state.lod = lod;
            }
            
            chunk.lod = lod;
            result.meshed.push(chunk);
            this.stats.chunksMeshed++;
            this.lastMeshesThisFrame++;
        }
        
        // Process LOD upgrade queue (chunks that are now closer)
        for (let i = 0; i < meshesThisFrame && this.lodUpgradeQueue.length > 0; i++) {
            const chunk = this.lodUpgradeQueue.shift();
            const key = `${chunk.x},${chunk.z}`;
            const state = this.chunkStates.get(key);
            
            if (state && state.state === 'meshed') {
                const oldLOD = state.lod;
                const newLOD = chunk.newLOD;
                
                if (this.onLODChange) {
                    this.onLODChange(chunk.x, chunk.z, newLOD, oldLOD);
                }
                if (this.onMeshChunk) {
                    this.onMeshChunk(chunk.x, chunk.z, newLOD);
                }
                
                state.lod = newLOD;
                result.lodChanges.push({ x: chunk.x, z: chunk.z, oldLOD, newLOD });
            }
        }
        
        // Process LOD downgrade queue (chunks that are now farther - lower priority)
        if (this.lodUpgradeQueue.length === 0) {
            for (let i = 0; i < 1 && this.lodDowngradeQueue.length > 0; i++) {
                const chunk = this.lodDowngradeQueue.shift();
                const key = `${chunk.x},${chunk.z}`;
                const state = this.chunkStates.get(key);
                
                if (state && state.state === 'meshed') {
                    const oldLOD = state.lod;
                    const newLOD = chunk.newLOD;
                    
                    if (this.onLODChange) {
                        this.onLODChange(chunk.x, chunk.z, newLOD, oldLOD);
                    }
                    if (this.onMeshChunk) {
                        this.onMeshChunk(chunk.x, chunk.z, newLOD);
                    }
                    
                    state.lod = newLOD;
                    result.lodChanges.push({ x: chunk.x, z: chunk.z, oldLOD, newLOD });
                }
            }
        }
        
        // Process unload queue (more aggressive)
        for (let i = 0; i < this.maxLoadsPerFrame * 2 && this.unloadQueue.length > 0; i++) {
            const chunk = this.unloadQueue.shift();
            const key = `${chunk.x},${chunk.z}`;
            
            if (this.onUnloadChunk) {
                this.onUnloadChunk(chunk.x, chunk.z);
            }
            
            this.chunkStates.delete(key);
            result.unloaded.push(chunk);
            this.stats.chunksUnloaded++;
        }
        
        return result;
    }
    
    /**
     * Track load time for averaging
     */
    trackLoadTime(timeMs) {
        this.loadTimes.push(timeMs);
        if (this.loadTimes.length > this.maxLoadTimeSamples) {
            this.loadTimes.shift();
        }
        this.stats.avgLoadTimeMs = statsMean(this.loadTimes);
    }
    
    /**
     * Get chunks that should be loaded but aren't
     * @returns {Array}
     */
    getMissingChunks() {
        return [...this.loadQueue];
    }
    
    /**
     * Get chunks waiting to be meshed
     * @returns {Array}
     */
    getPendingMeshes() {
        return [...this.meshQueue];
    }
    
    /**
     * Check if a specific chunk is loaded
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @returns {boolean}
     */
    isChunkLoaded(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const state = this.chunkStates.get(key);
        return state && (state.state === 'loaded' || state.state === 'meshed');
    }
    
    /**
     * Check if a specific chunk is meshed
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @returns {boolean}
     */
    isChunkMeshed(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const state = this.chunkStates.get(key);
        return state && state.state === 'meshed';
    }
    
    /**
     * Manually mark a chunk state
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @param {string} state - 'unloaded', 'loaded', 'meshed'
     * @param {number} lod - Optional LOD level
     */
    setChunkState(chunkX, chunkZ, state, lod = 0) {
        const key = `${chunkX},${chunkZ}`;
        
        if (state === 'unloaded') {
            this.chunkStates.delete(key);
        } else {
            const dx = chunkX - this.playerChunkX;
            const dz = chunkZ - this.playerChunkZ;
            this.chunkStates.set(key, {
                state,
                priority: 0,
                distance: Math.sqrt(dx * dx + dz * dz),
                lod,
            });
        }
    }
    
    /**
     * Configure LOD distance thresholds
     * @param {number} lod0 - Distance for full detail (chunks)
     * @param {number} lod1 - Distance for medium detail (chunks)
     * @param {number} lod2 - Distance for low detail (chunks)
     */
    setLODDistances(lod0, lod1, lod2) {
        this.lod0Distance = lod0;
        this.lod1Distance = lod1;
        this.lod2Distance = lod2;
    }
    
    /**
     * Get current LOD for a chunk
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @returns {number} - LOD level or -1 if not loaded
     */
    getChunkLOD(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        const state = this.chunkStates.get(key);
        if (state && state.lod !== undefined) {
            return state.lod;
        }
        return -1;
    }
    
    /**
     * Get loading progress (0-1)
     * @returns {number}
     */
    getLoadProgress() {
        const totalExpected = this.ringOrder.length;
        let loaded = 0;
        
        for (const offset of this.ringOrder) {
            const cx = this.playerChunkX + offset.x;
            const cz = this.playerChunkZ + offset.z;
            if (this.isChunkMeshed(cx, cz)) {
                loaded++;
            }
        }
        
        return loaded / totalExpected;
    }
    
    /**
     * Get visual representation of load state
     * @param {number} radius 
     * @returns {Array<Array>} - 2D array of states
     */
    getLoadMap(radius = null) {
        const r = radius || this.loadRadius;
        const size = r * 2 + 1;
        const map = [];
        
        for (let z = -r; z <= r; z++) {
            const row = [];
            for (let x = -r; x <= r; x++) {
                const cx = this.playerChunkX + x;
                const cz = this.playerChunkZ + z;
                const key = `${cx},${cz}`;
                const state = this.chunkStates.get(key);
                
                if (!state) {
                    row.push('.');  // Unloaded
                } else if (state.state === 'loaded') {
                    row.push('L');  // Loaded
                } else if (state.state === 'meshed') {
                    row.push('M');  // Meshed
                } else {
                    row.push('?');  // Unknown
                }
            }
            map.push(row);
        }
        
        return map;
    }
    
    /**
     * Get stats
     */
    getStats() {
        return {
            ...this.stats,
            loadQueueSize: this.loadQueue.length,
            meshQueueSize: this.meshQueue.length,
            unloadQueueSize: this.unloadQueue.length,
            totalTracked: this.chunkStates.size,
            loadProgress: this.getLoadProgress(),
        };
    }
    
    /**
     * Clear all state
     */
    clear() {
        this.chunkStates.clear();
        this.loadQueue = [];
        this.meshQueue = [];
        this.unloadQueue = [];
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [chunk_loading] section
     * @param {Object} cameraCfg - Optional config from [camera] section for FOV
     */
    loadConfig(cfg, cameraCfg = null) {
        if (!cfg && !cameraCfg) return;
        
        if (cfg) {
            this.maxRenderDistance = parseInt(cfg.render_distance) || 8;
            this.loadBatchSize = parseInt(cfg.load_batch_size) || 16;
            this.meshBatchSize = parseInt(cfg.mesh_batch_size) || 8;
            
            // FOV priority settings
            if (cfg.fov_priority !== undefined) {
                this.useFOVPriority = cfg.fov_priority !== false;
            }
            if (cfg.fov_priority_boost !== undefined) {
                this.fovPriorityBoost = parseInt(cfg.fov_priority_boost) || 40;
            }
            if (cfg.fov_buffer_boost !== undefined) {
                this.fovBufferBoost = parseInt(cfg.fov_buffer_boost) || 15;
            }
            if (cfg.behind_penalty !== undefined) {
                this.behindPenalty = parseInt(cfg.behind_penalty) || 30;
            }
            if (cfg.fov_buffer_angle !== undefined) {
                this.fovBufferAngle = parseInt(cfg.fov_buffer_angle) || 30;
            }
        }
        
        // Load FOV from camera config
        if (cameraCfg && cameraCfg.fov !== undefined) {
            const fov = parseFloat(cameraCfg.fov) || 90;
            const buffer = this.fovBufferAngle || 30;
            this.setFOV(fov, buffer);
            console.log(`[PriorityChunkLoader] FOV set to ${fov}° with ${buffer}° buffer`);
        }
    }
}

export default PriorityChunkLoader;
