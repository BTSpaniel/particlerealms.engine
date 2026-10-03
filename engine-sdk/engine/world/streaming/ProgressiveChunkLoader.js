// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { statsMean } from '../../core/math/MathStatistics.js';

/**
 * ProgressiveChunkLoader.js - Progressive LOD Chunk Loading
 * 
 * Loads chunks progressively from low to high detail:
 * 32³ (coarse) → 16³ → 8³ → 4³ (fine detail)
 * 
 * Benefits:
 * - Instant visual feedback (coarse mesh appears in <5ms)
 * - Smooth detail pop-in as player approaches
 * - Prioritizes visible chunks first
 * - Cancels in-progress refinement for chunks moving away
 * 
 * Algorithm:
 * 1. Generate 32³ mesh immediately (LOD 0)
 * 2. Queue progressive refinement based on distance
 * 3. Refine visible sub-chunks first (frustum priority)
 * 4. Cancel refinement for chunks beyond threshold
 */

import { CHUNK_SIZE } from '../../voxel/VoxelConstants.js';

// Progressive LOD levels
const PROGRESSIVE_LEVELS = [
    { size: 32, name: 'COARSE', subChunks: 1, priority: 0 },     // Full chunk
    { size: 16, name: 'MEDIUM', subChunks: 8, priority: 1 },     // 2³ = 8 sub-chunks
    { size: 8, name: 'FINE', subChunks: 64, priority: 2 },       // 4³ = 64 sub-chunks
    { size: 4, name: 'ULTRA', subChunks: 512, priority: 3 },     // 8³ = 512 sub-chunks
];

// Distance thresholds for each refinement level
const REFINEMENT_DISTANCES = {
    MEDIUM: 128,  // Refine to 16³ within 128 blocks
    FINE: 64,     // Refine to 8³ within 64 blocks
    ULTRA: 32,    // Refine to 4³ within 32 blocks
};

// Max refinements per frame
const MAX_REFINEMENTS_PER_FRAME = 4;

/**
 * ChunkRefinementState - Tracks progressive loading state for a chunk
 */
class ChunkRefinementState {
    constructor(chunkKey, cx, cy, cz) {
        this.chunkKey = chunkKey;
        this.cx = cx;
        this.cy = cy;
        this.cz = cz;
        
        // Current refinement level (0 = coarse, 3 = ultra)
        this.currentLevel = 0;
        
        // Target refinement level based on distance
        this.targetLevel = 0;
        
        // Sub-chunk meshes for each level
        this.subMeshes = new Map(); // level → Map<subKey → mesh>
        
        // Pending refinement requests
        this.pendingRefinements = [];
        
        // Last update time
        this.lastUpdateTime = 0;
        
        // Distance from camera (updated each frame)
        this.distance = Infinity;
        
        // Visibility (frustum culled or not)
        this.visible = false;
    }
    
    /**
     * Get sub-chunk key
     */
    static subKey(sx, sy, sz) {
        return `${sx},${sy},${sz}`;
    }
    
    /**
     * Update target level based on distance
     */
    updateTargetLevel(distance) {
        this.distance = distance;
        
        if (distance < REFINEMENT_DISTANCES.ULTRA) {
            this.targetLevel = 3;
        } else if (distance < REFINEMENT_DISTANCES.FINE) {
            this.targetLevel = 2;
        } else if (distance < REFINEMENT_DISTANCES.MEDIUM) {
            this.targetLevel = 1;
        } else {
            this.targetLevel = 0;
        }
    }
    
    /**
     * Check if needs refinement
     */
    needsRefinement() {
        return this.currentLevel < this.targetLevel;
    }
    
    /**
     * Check if can downgrade (chunk moved away)
     */
    canDowngrade() {
        return this.currentLevel > this.targetLevel;
    }
}

/**
 * ProgressiveChunkLoader - Manages progressive LOD loading
 */
export class ProgressiveChunkLoader {
    constructor() {
        this.enabled = true;
        
        // Chunk refinement states
        this.chunkStates = new Map(); // chunkKey → ChunkRefinementState
        
        // Refinement queue (priority sorted)
        this.refinementQueue = [];
        
        // Camera state
        this.cameraPos = [0, 0, 0];
        this.cameraForward = [0, 0, -1];
        this.frustumPlanes = null;
        
        // Callbacks
        this.onMeshReady = null;      // (chunkKey, level, mesh) => void
        this.onMeshRemoved = null;    // (chunkKey, level) => void
        this.meshChunkFn = null;      // (chunk, size, sx, sy, sz) => mesh
        this.getChunkFn = null;       // (cx, cy, cz) => chunk
        
        // Statistics
        this.stats = {
            chunksTracked: 0,
            refinementsQueued: 0,
            refinementsCompleted: 0,
            downgrades: 0,
            avgRefinementTimeMs: 0,
            frameTimeMs: 0,
        };
        
        // Timing
        this.refinementTimes = [];
        this.maxTimingSamples = 100;
    }
    
    /**
     * Set callback functions
     */
    setCallbacks({ onMeshReady, onMeshRemoved, meshChunkFn, getChunkFn }) {
        this.onMeshReady = onMeshReady;
        this.onMeshRemoved = onMeshRemoved;
        this.meshChunkFn = meshChunkFn;
        this.getChunkFn = getChunkFn;
    }
    
    /**
     * Update camera state
     */
    updateCamera(position, forward, frustumPlanes = null) {
        this.cameraPos = position;
        this.cameraForward = forward;
        this.frustumPlanes = frustumPlanes;
    }
    
    /**
     * Register a chunk for progressive loading
     */
    registerChunk(chunkKey, cx, cy, cz) {
        if (this.chunkStates.has(chunkKey)) return;
        
        const state = new ChunkRefinementState(chunkKey, cx, cy, cz);
        this.chunkStates.set(chunkKey, state);
        this.stats.chunksTracked = this.chunkStates.size;
    }
    
    /**
     * Unregister a chunk
     */
    unregisterChunk(chunkKey) {
        const state = this.chunkStates.get(chunkKey);
        if (!state) return;
        
        // Notify removal of all sub-meshes
        if (this.onMeshRemoved) {
            for (const [level, subMeshes] of state.subMeshes) {
                for (const [subKey, mesh] of subMeshes) {
                    this.onMeshRemoved(chunkKey, level, subKey, mesh);
                }
            }
        }
        
        this.chunkStates.delete(chunkKey);
        this.stats.chunksTracked = this.chunkStates.size;
    }
    
    /**
     * Update all chunk distances and queue refinements
     */
    update() {
        if (!this.enabled) return;
        
        const startTime = performance.now();
        
        // Update distances and visibility
        for (const [chunkKey, state] of this.chunkStates) {
            const worldX = state.cx * CHUNK_SIZE + CHUNK_SIZE / 2;
            const worldY = state.cy * CHUNK_SIZE + CHUNK_SIZE / 2;
            const worldZ = state.cz * CHUNK_SIZE + CHUNK_SIZE / 2;
            
            const dx = worldX - this.cameraPos[0];
            const dy = worldY - this.cameraPos[1];
            const dz = worldZ - this.cameraPos[2];
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            state.updateTargetLevel(distance);
            state.visible = this._isVisible(worldX, worldY, worldZ);
        }
        
        // Build refinement queue
        this._buildRefinementQueue();
        
        // Process refinements
        this._processRefinements();
        
        // Process downgrades
        this._processDowngrades();
        
        this.stats.frameTimeMs = performance.now() - startTime;
    }
    
    /**
     * Check if a point is visible (basic frustum check)
     */
    _isVisible(x, y, z) {
        if (!this.frustumPlanes) return true;
        
        // Simple sphere-frustum test
        const radius = CHUNK_SIZE * 0.866; // Half diagonal
        
        for (const plane of this.frustumPlanes) {
            const dist = plane[0] * x + plane[1] * y + plane[2] * z + plane[3];
            if (dist < -radius) return false;
        }
        return true;
    }
    
    /**
     * Build priority-sorted refinement queue
     */
    _buildRefinementQueue() {
        this.refinementQueue = [];
        
        for (const [chunkKey, state] of this.chunkStates) {
            if (!state.needsRefinement()) continue;
            
            // Priority: visible + close = highest
            const visibilityBoost = state.visible ? 1000 : 0;
            const distancePriority = 10000 - state.distance;
            const levelPriority = (state.targetLevel - state.currentLevel) * 100;
            
            this.refinementQueue.push({
                chunkKey,
                state,
                priority: visibilityBoost + distancePriority + levelPriority,
            });
        }
        
        // Sort by priority (highest first)
        this.refinementQueue.sort((a, b) => b.priority - a.priority);
        this.stats.refinementsQueued = this.refinementQueue.length;
    }
    
    /**
     * Process top refinements from queue
     */
    _processRefinements() {
        const toProcess = Math.min(MAX_REFINEMENTS_PER_FRAME, this.refinementQueue.length);
        
        for (let i = 0; i < toProcess; i++) {
            const { chunkKey, state } = this.refinementQueue[i];
            this._refineChunk(state);
        }
    }
    
    /**
     * Refine a chunk to the next level
     */
    _refineChunk(state) {
        const startTime = performance.now();
        
        const nextLevel = state.currentLevel + 1;
        const levelInfo = PROGRESSIVE_LEVELS[nextLevel];
        
        if (!levelInfo || !this.meshChunkFn || !this.getChunkFn) return;
        
        const chunk = this.getChunkFn(state.cx, state.cy, state.cz);
        if (!chunk) return;
        
        // Calculate sub-chunk grid
        const subChunksPerAxis = CHUNK_SIZE / levelInfo.size;
        const subMeshes = new Map();
        
        // Mesh each sub-chunk
        for (let sz = 0; sz < subChunksPerAxis; sz++) {
            for (let sy = 0; sy < subChunksPerAxis; sy++) {
                for (let sx = 0; sx < subChunksPerAxis; sx++) {
                    const mesh = this.meshChunkFn(chunk, levelInfo.size, sx, sy, sz);
                    if (mesh && mesh.indexCount > 0) {
                        const subKey = ChunkRefinementState.subKey(sx, sy, sz);
                        subMeshes.set(subKey, mesh);
                        
                        if (this.onMeshReady) {
                            this.onMeshReady(state.chunkKey, nextLevel, subKey, mesh);
                        }
                    }
                }
            }
        }
        
        // Store sub-meshes
        state.subMeshes.set(nextLevel, subMeshes);
        state.currentLevel = nextLevel;
        state.lastUpdateTime = performance.now();
        
        // Track timing
        const elapsed = performance.now() - startTime;
        this.refinementTimes.push(elapsed);
        if (this.refinementTimes.length > this.maxTimingSamples) {
            this.refinementTimes.shift();
        }
        this.stats.avgRefinementTimeMs = statsMean(this.refinementTimes);
        this.stats.refinementsCompleted++;
    }
    
    /**
     * Process chunks that can be downgraded (moved away)
     */
    _processDowngrades() {
        for (const [chunkKey, state] of this.chunkStates) {
            if (!state.canDowngrade()) continue;
            
            // Remove higher-detail meshes
            for (let level = state.currentLevel; level > state.targetLevel; level--) {
                const subMeshes = state.subMeshes.get(level);
                if (subMeshes && this.onMeshRemoved) {
                    for (const [subKey, mesh] of subMeshes) {
                        this.onMeshRemoved(state.chunkKey, level, subKey, mesh);
                    }
                }
                state.subMeshes.delete(level);
            }
            
            state.currentLevel = state.targetLevel;
            this.stats.downgrades++;
        }
    }
    
    /**
     * Force immediate refinement of a chunk to target level
     */
    async forceRefine(chunkKey, targetLevel) {
        const state = this.chunkStates.get(chunkKey);
        if (!state) return;
        
        while (state.currentLevel < targetLevel) {
            this._refineChunk(state);
        }
    }
    
    /**
     * Get current level for a chunk
     */
    getChunkLevel(chunkKey) {
        const state = this.chunkStates.get(chunkKey);
        return state ? state.currentLevel : 0;
    }
    
    /**
     * Get all sub-meshes for a chunk at its current level
     */
    getChunkMeshes(chunkKey) {
        const state = this.chunkStates.get(chunkKey);
        if (!state) return null;
        
        return state.subMeshes.get(state.currentLevel);
    }
    
    /**
     * Get statistics
     */
    getStats() {
        const levelCounts = [0, 0, 0, 0];
        for (const state of this.chunkStates.values()) {
            levelCounts[state.currentLevel]++;
        }
        
        return {
            ...this.stats,
            levelDistribution: levelCounts.map((count, i) => ({
                level: i,
                name: PROGRESSIVE_LEVELS[i].name,
                count,
            })),
        };
    }
}

export { PROGRESSIVE_LEVELS, REFINEMENT_DISTANCES, ChunkRefinementState };
export default ProgressiveChunkLoader;
