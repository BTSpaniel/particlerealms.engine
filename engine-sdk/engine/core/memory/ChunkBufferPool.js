// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkBufferPool.js - Object Pool for Chunk Buffers
 * 
 * Reduces GC pressure by reusing Uint8Array buffers instead of
 * allocating new ones for each chunk generation.
 * 
 * Based on: Vercidium's voxel optimization research
 * Impact: ~10% speed increase from reduced GC pauses
 */

const CHUNK_SIZE = 32;
const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;  // 32768

export class ChunkBufferPool {
    constructor(options = {}) {
        // Pool settings
        this.maxPoolSize = options.maxPoolSize || 64;
        this.preAllocate = options.preAllocate || 8;
        
        // Buffer pools by size
        this.voxelBuffers = [];      // Uint8Array(32768) for voxel data
        this.meshVertexBuffers = []; // Float32Array for mesh vertices
        this.meshIndexBuffers = [];  // Uint32Array for mesh indices
        
        // Stats
        this.stats = {
            voxelAllocations: 0,
            voxelReuses: 0,
            meshAllocations: 0,
            meshReuses: 0,
            poolSize: 0,
        };
        
        // Pre-allocate some buffers
        this.warmUp();
    }
    
    /**
     * Pre-allocate buffers to avoid cold-start allocations
     */
    warmUp() {
        for (let i = 0; i < this.preAllocate; i++) {
            this.voxelBuffers.push(new Uint8Array(CHUNK_VOLUME));
        }
        this.stats.poolSize = this.voxelBuffers.length;
    }
    
    /**
     * Get a voxel buffer (reused or new)
     * @returns {Uint8Array}
     */
    getVoxelBuffer() {
        if (this.voxelBuffers.length > 0) {
            this.stats.voxelReuses++;
            const buffer = this.voxelBuffers.pop();
            this.stats.poolSize = this.voxelBuffers.length;
            return buffer;
        }
        
        this.stats.voxelAllocations++;
        return new Uint8Array(CHUNK_VOLUME);
    }
    
    /**
     * Return a voxel buffer to the pool
     * @param {Uint8Array} buffer 
     */
    returnVoxelBuffer(buffer) {
        if (!buffer || buffer.length !== CHUNK_VOLUME) return;
        
        if (this.voxelBuffers.length < this.maxPoolSize) {
            // Clear buffer efficiently using fill
            buffer.fill(0);
            this.voxelBuffers.push(buffer);
            this.stats.poolSize = this.voxelBuffers.length;
        }
        // If pool is full, let GC collect it
    }
    
    /**
     * Get a mesh vertex buffer (Float32Array)
     * @param {number} size - Required size
     * @returns {Float32Array}
     */
    getMeshVertexBuffer(size) {
        // Find a buffer that's large enough
        for (let i = 0; i < this.meshVertexBuffers.length; i++) {
            if (this.meshVertexBuffers[i].length >= size) {
                this.stats.meshReuses++;
                return this.meshVertexBuffers.splice(i, 1)[0];
            }
        }
        
        this.stats.meshAllocations++;
        // Allocate with some headroom to reduce future allocations
        return new Float32Array(Math.max(size, 4096));
    }
    
    /**
     * Return a mesh vertex buffer to the pool
     * @param {Float32Array} buffer 
     */
    returnMeshVertexBuffer(buffer) {
        if (!buffer) return;
        
        if (this.meshVertexBuffers.length < this.maxPoolSize) {
            this.meshVertexBuffers.push(buffer);
        }
    }
    
    /**
     * Get a mesh index buffer (Uint32Array)
     * @param {number} size - Required size
     * @returns {Uint32Array}
     */
    getMeshIndexBuffer(size) {
        for (let i = 0; i < this.meshIndexBuffers.length; i++) {
            if (this.meshIndexBuffers[i].length >= size) {
                this.stats.meshReuses++;
                return this.meshIndexBuffers.splice(i, 1)[0];
            }
        }
        
        this.stats.meshAllocations++;
        return new Uint32Array(Math.max(size, 6144));
    }
    
    /**
     * Return a mesh index buffer to the pool
     * @param {Uint32Array} buffer 
     */
    returnMeshIndexBuffer(buffer) {
        if (!buffer) return;
        
        if (this.meshIndexBuffers.length < this.maxPoolSize) {
            this.meshIndexBuffers.push(buffer);
        }
    }
    
    /**
     * Clear all pools (for memory pressure situations)
     */
    clear() {
        this.voxelBuffers = [];
        this.meshVertexBuffers = [];
        this.meshIndexBuffers = [];
        this.stats.poolSize = 0;
    }
    
    /**
     * Get pool statistics
     */
    getStats() {
        const reuseRate = this.stats.voxelReuses / 
            (this.stats.voxelReuses + this.stats.voxelAllocations) * 100 || 0;
        
        return {
            ...this.stats,
            reuseRate: reuseRate.toFixed(1) + '%',
        };
    }
}

// Singleton instance for global use
let globalPool = null;

export function getChunkBufferPool() {
    if (!globalPool) {
        globalPool = new ChunkBufferPool();
    }
    return globalPool;
}

export default ChunkBufferPool;
