// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkSorter.js - Front-to-Back Chunk Sorting and Back-Face Culling
 * 
 * Optimizations:
 * 1. Front-to-Back Sorting: Render nearest chunks first for early-Z rejection
 * 2. True Back-Face Culling: Skip entire face directions that point away from camera
 * 3. Distance Culling: Skip chunks beyond render distance
 */

import { FACE_NORMALS } from './VoxelConstants.js';

export const FACE_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

/**
 * ChunkSorter - Manages chunk draw order and visibility
 */
export class ChunkSorter {
    constructor() {
        // Sorted chunk list
        this.sortedChunks = [];
        
        // Visible face mask (6 bits, one per face direction)
        this.visibleFaces = 0b111111;
        
        // Camera state
        this.cameraPos = [0, 0, 0];
        this.cameraForward = [0, 0, -1];
        
        // Configuration
        this.maxRenderDistance = 0;  // 0 = unlimited
        this.enableBackFaceCull = true;
        this.enableDistanceCull = true;
        
        // Statistics
        this.stats = {
            totalChunks: 0,
            visibleChunks: 0,
            backFaceCulled: 0,
            distanceCulled: 0,
            sortTimeMs: 0,
        };
    }
    
    /**
     * Update camera state
     * @param {Array} position - Camera position [x, y, z]
     * @param {Array} forward - Camera forward direction [x, y, z]
     */
    updateCamera(position, forward) {
        this.cameraPos = position;
        this.cameraForward = forward;
        
        // Update visible faces based on camera direction
        if (this.enableBackFaceCull) {
            this.visibleFaces = this.calculateVisibleFaces(forward);
        } else {
            this.visibleFaces = 0b111111;  // All faces visible
        }
    }
    
    /**
     * Calculate which face directions are visible from camera
     * A face is visible if it points toward the camera (dot product with -forward > 0)
     * @param {Array} forward - Camera forward direction
     * @returns {number} - 6-bit mask
     */
    calculateVisibleFaces(forward) {
        let mask = 0;
        
        for (let i = 0; i < 6; i++) {
            const normal = FACE_NORMALS[i];
            // Face is visible if its normal points toward camera
            // (opposite of camera forward direction)
            const dot = normal[0] * (-forward[0]) +
                       normal[1] * (-forward[1]) +
                       normal[2] * (-forward[2]);
            
            if (dot > -0.1) {  // Small threshold for edge cases
                mask |= (1 << i);
            }
        }
        
        return mask;
    }
    
    /**
     * Check if a specific face direction is visible
     * @param {number} faceIndex - Face direction (0-5)
     * @returns {boolean}
     */
    isFaceVisible(faceIndex) {
        return (this.visibleFaces & (1 << faceIndex)) !== 0;
    }
    
    /**
     * Sort chunks front-to-back by distance from camera
     * Uses cascaded bucket sort for O(n) performance instead of O(n log n)
     * @param {Map|Array} chunks - ChunkManager.chunks or array of chunk objects
     * @returns {Array} - Sorted array of {chunk, distance, visible}
     */
    sortChunks(chunks) {
        const startTime = performance.now();
        
        // Convert to array if Map
        const chunkArray = chunks instanceof Map ? 
            Array.from(chunks.values()) : chunks;
        
        this.stats.totalChunks = chunkArray.length;
        this.stats.backFaceCulled = 0;
        this.stats.distanceCulled = 0;
        
        // === CASCADED BUCKET SORT ===
        // Use distance buckets for O(n) sorting instead of O(n log n)
        // Buckets: 0-32, 32-64, 64-128, 128-256, 256+ (5 tiers)
        const buckets = [[], [], [], [], []];
        const bucketThresholds = [32*32, 64*64, 128*128, 256*256]; // squared
        
        for (const chunk of chunkArray) {
            // Skip empty chunks (no mesh data)
            // Check for both traditional (vertexBuffer/indexCount) and face-pull (opaqueFaceBuffer/opaqueFaceCount)
            const hasTraditionalMesh = chunk.vertexBuffer && chunk.indexCount;
            const hasFacePullMesh = chunk.opaqueFaceBuffer && chunk.opaqueFaceCount > 0;
            if (!hasTraditionalMesh && !hasFacePullMesh) {
                continue;
            }
            
            // Calculate chunk center (use cx/cy/cz - chunk coordinates)
            const cx = chunk.cx * 32 + 16;
            const cy = chunk.cy * 32 + 16;
            const cz = chunk.cz * 32 + 16;
            
            // Calculate squared distance (OPTIMIZATION: avoid sqrt when possible)
            const dx = cx - this.cameraPos[0];
            const dy = cy - this.cameraPos[1];
            const dz = cz - this.cameraPos[2];
            const distanceSq = dx * dx + dy * dy + dz * dz;
            
            // Distance culling (use squared comparison to avoid sqrt)
            if (this.enableDistanceCull && this.maxRenderDistance > 0) {
                const maxDistSq = this.maxRenderDistance * this.maxRenderDistance;
                if (distanceSq > maxDistSq) {
                    this.stats.distanceCulled++;
                    continue;
                }
            }
            
            // Assign to bucket based on distance
            let bucket = 4; // Default to farthest
            for (let i = 0; i < 4; i++) {
                if (distanceSq < bucketThresholds[i]) {
                    bucket = i;
                    break;
                }
            }
            
            buckets[bucket].push({
                chunk,
                distanceSq,
                center: [cx, cy, cz],
            });
        }
        
        // Sort within each bucket (smaller arrays = faster)
        // Near buckets get full sort, far buckets can skip (order matters less)
        buckets[0].sort((a, b) => a.distanceSq - b.distanceSq); // Full sort for near
        buckets[1].sort((a, b) => a.distanceSq - b.distanceSq); // Full sort
        // Buckets 2-4: partial sort or no sort (order matters less for far chunks)
        if (buckets[2].length < 100) buckets[2].sort((a, b) => a.distanceSq - b.distanceSq);
        // Far buckets don't need sorting - they're all similarly distant
        
        // Concatenate buckets in order
        this.sortedChunks = buckets[0].concat(buckets[1], buckets[2], buckets[3], buckets[4]);
        
        this.stats.visibleChunks = this.sortedChunks.length;
        this.stats.sortTimeMs = performance.now() - startTime;
        
        return this.sortedChunks;
    }
    
    /**
     * Get sorted chunks iterator
     * @yields {Object} - {chunk, distance, center}
     */
    *iterate() {
        for (const entry of this.sortedChunks) {
            yield entry;
        }
    }
    
    /**
     * Get visible face count (for statistics)
     * @returns {number}
     */
    getVisibleFaceCount() {
        let count = 0;
        for (let i = 0; i < 6; i++) {
            if (this.visibleFaces & (1 << i)) count++;
        }
        return count;
    }
    
    /**
     * Get visible face names
     * @returns {Array}
     */
    getVisibleFaceNames() {
        const names = [];
        for (let i = 0; i < 6; i++) {
            if (this.visibleFaces & (1 << i)) {
                names.push(FACE_NAMES[i]);
            }
        }
        return names;
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            visibleFaces: this.getVisibleFaceCount(),
            visibleFaceNames: this.getVisibleFaceNames().join(', '),
        };
    }
}

/**
 * Utility function to extract camera forward from view matrix
 * @param {Float32Array} viewMatrix - 4x4 view matrix
 * @returns {Array} - Forward direction [x, y, z]
 */
export function getCameraForward(viewMatrix) {
    // View matrix forward is -Z axis (third column negated)
    return [
        -viewMatrix[2],
        -viewMatrix[6],
        -viewMatrix[10],
    ];
}

/**
 * Utility function to extract camera position from inverse view matrix
 * @param {Float32Array} invViewMatrix - Inverse 4x4 view matrix
 * @returns {Array} - Position [x, y, z]
 */
export function getCameraPosition(invViewMatrix) {
    return [
        invViewMatrix[12],
        invViewMatrix[13],
        invViewMatrix[14],
    ];
}

export default ChunkSorter;
