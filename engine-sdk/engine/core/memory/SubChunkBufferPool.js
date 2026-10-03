// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SubChunkBufferPool.js - GPU Buffer Pooling for Sub-Chunk Meshes
 * 
 * Reduces GPU memory allocation overhead by reusing buffers.
 * Implements tiered pooling with size buckets for optimal reuse.
 * 
 * Performance benefits:
 * - Eliminates buffer creation latency (~0.1-0.5ms per buffer)
 * - Reduces GPU memory fragmentation
 * - Enables predictable memory usage
 * 
 * Bucket sizes (vertices, 8 bytes each):
 * - Tiny:   256 verts (2KB) - 4³ sub-chunks with few faces
 * - Small:  1024 verts (8KB) - 4³ sub-chunks, dense
 * - Medium: 4096 verts (32KB) - 8³ sub-chunks
 * - Large:  16384 verts (128KB) - 16³ sub-chunks
 * - XLarge: 65536 verts (512KB) - 32³ full chunks
 */

// Buffer size buckets (in vertices, 8 bytes each for packed format)
const BUCKET_SIZES = {
    TINY: 256,      // 2KB - minimal 4³
    SMALL: 1024,    // 8KB - dense 4³
    MEDIUM: 4096,   // 32KB - 8³
    LARGE: 16384,   // 128KB - 16³
    XLARGE: 65536,  // 512KB - 32³
};

const BUCKET_NAMES = ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'XLARGE'];
const BUCKET_VALUES = [256, 1024, 4096, 16384, 65536];

// Max buffers per bucket
const MAX_POOL_SIZE = 64;

/**
 * Get bucket index for a given size
 */
function getBucketIndex(vertexCount) {
    for (let i = 0; i < BUCKET_VALUES.length; i++) {
        if (vertexCount <= BUCKET_VALUES[i]) {
            return i;
        }
    }
    return BUCKET_VALUES.length - 1; // XLarge
}

/**
 * SubChunkBufferPool - Manages GPU buffer reuse for sub-chunk meshes
 */
export class SubChunkBufferPool {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // Vertex buffer pools (one per bucket)
        this.vertexPools = [[], [], [], [], []];
        
        // Index buffer pools (same buckets, 4 bytes per index)
        this.indexPools = [[], [], [], [], []];
        
        // Indirect draw buffer pool (fixed size, 20 bytes)
        this.indirectPool = [];
        
        // Statistics
        this.stats = {
            allocations: 0,
            reuses: 0,
            returns: 0,
            currentPooled: 0,
            peakPooled: 0,
            totalBytesPooled: 0,
            hitRate: 0,
        };
        
        // Per-bucket stats
        this.bucketStats = BUCKET_NAMES.map(() => ({
            allocations: 0,
            reuses: 0,
            pooled: 0,
        }));
    }
    
    /**
     * Initialize the buffer pool
     * @param {GPUDevice} device 
     */
    init(device) {
        this.device = device;
        this.initialized = true;
        console.log('[SubChunkBufferPool] Initialized with 5 size buckets');
    }
    
    /**
     * Acquire a vertex buffer of at least the specified size
     * @param {number} minVertices - Minimum vertex count needed
     * @returns {{buffer: GPUBuffer, capacity: number, bucket: number}}
     */
    acquireVertexBuffer(minVertices) {
        if (!this.initialized) {
            throw new Error('SubChunkBufferPool not initialized');
        }
        
        const bucketIdx = getBucketIndex(minVertices);
        const pool = this.vertexPools[bucketIdx];
        
        // Try to reuse from pool
        if (pool.length > 0) {
            const buffer = pool.pop();
            this.stats.reuses++;
            this.stats.currentPooled--;
            this.bucketStats[bucketIdx].reuses++;
            this.bucketStats[bucketIdx].pooled--;
            this._updateHitRate();
            return {
                buffer,
                capacity: BUCKET_VALUES[bucketIdx],
                bucket: bucketIdx,
            };
        }
        
        // Allocate new buffer
        const capacity = BUCKET_VALUES[bucketIdx];
        const size = capacity * 8; // 8 bytes per packed vertex
        
        const buffer = this.device.createBuffer({
            label: `SubChunk Vertex Pool [${BUCKET_NAMES[bucketIdx]}]`,
            size,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.stats.allocations++;
        this.bucketStats[bucketIdx].allocations++;
        this._updateHitRate();
        
        return { buffer, capacity, bucket: bucketIdx };
    }
    
    /**
     * Acquire an index buffer of at least the specified size
     * @param {number} minIndices - Minimum index count needed
     * @returns {{buffer: GPUBuffer, capacity: number, bucket: number}}
     */
    acquireIndexBuffer(minIndices) {
        if (!this.initialized) {
            throw new Error('SubChunkBufferPool not initialized');
        }
        
        // Indices are ~1.5× vertices (6 indices per 4 vertices per quad)
        const equivalentVerts = Math.ceil(minIndices / 1.5);
        const bucketIdx = getBucketIndex(equivalentVerts);
        const pool = this.indexPools[bucketIdx];
        
        if (pool.length > 0) {
            const buffer = pool.pop();
            this.stats.reuses++;
            this.stats.currentPooled--;
            this.bucketStats[bucketIdx].reuses++;
            this.bucketStats[bucketIdx].pooled--;
            return {
                buffer,
                capacity: Math.floor(BUCKET_VALUES[bucketIdx] * 1.5),
                bucket: bucketIdx,
            };
        }
        
        const capacity = Math.floor(BUCKET_VALUES[bucketIdx] * 1.5);
        const size = capacity * 4; // 4 bytes per index
        
        const buffer = this.device.createBuffer({
            label: `SubChunk Index Pool [${BUCKET_NAMES[bucketIdx]}]`,
            size,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.stats.allocations++;
        this.bucketStats[bucketIdx].allocations++;
        
        return { buffer, capacity, bucket: bucketIdx };
    }
    
    /**
     * Acquire an indirect draw buffer
     * @returns {GPUBuffer}
     */
    acquireIndirectBuffer() {
        if (this.indirectPool.length > 0) {
            this.stats.reuses++;
            this.stats.currentPooled--;
            return this.indirectPool.pop();
        }
        
        this.stats.allocations++;
        return this.device.createBuffer({
            label: 'SubChunk Indirect Pool',
            size: 20, // 5 × u32
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | 
                   GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
    }
    
    /**
     * Return a vertex buffer to the pool
     * @param {GPUBuffer} buffer 
     * @param {number} bucket - Bucket index from acquire
     */
    returnVertexBuffer(buffer, bucket) {
        if (!buffer || bucket < 0 || bucket >= this.vertexPools.length) return;
        
        const pool = this.vertexPools[bucket];
        if (pool.length < MAX_POOL_SIZE) {
            pool.push(buffer);
            this.stats.returns++;
            this.stats.currentPooled++;
            this.stats.peakPooled = Math.max(this.stats.peakPooled, this.stats.currentPooled);
            this.bucketStats[bucket].pooled++;
            this._updateTotalBytes();
        } else {
            buffer.destroy();
        }
    }
    
    /**
     * Return an index buffer to the pool
     * @param {GPUBuffer} buffer 
     * @param {number} bucket 
     */
    returnIndexBuffer(buffer, bucket) {
        if (!buffer || bucket < 0 || bucket >= this.indexPools.length) return;
        
        const pool = this.indexPools[bucket];
        if (pool.length < MAX_POOL_SIZE) {
            pool.push(buffer);
            this.stats.returns++;
            this.stats.currentPooled++;
            this.bucketStats[bucket].pooled++;
            this._updateTotalBytes();
        } else {
            buffer.destroy();
        }
    }
    
    /**
     * Return an indirect buffer to the pool
     * @param {GPUBuffer} buffer 
     */
    returnIndirectBuffer(buffer) {
        if (!buffer) return;
        
        if (this.indirectPool.length < MAX_POOL_SIZE) {
            this.indirectPool.push(buffer);
            this.stats.returns++;
            this.stats.currentPooled++;
        } else {
            buffer.destroy();
        }
    }
    
    /**
     * Return all buffers from a sub-chunk mesh result
     * @param {Object} meshResult - {vertexBuffer, indexBuffer, indirectBuffer, vertexBucket, indexBucket}
     */
    returnMeshBuffers(meshResult) {
        if (!meshResult) return;
        
        if (meshResult.vertexBuffer) {
            this.returnVertexBuffer(meshResult.vertexBuffer, meshResult.vertexBucket || 0);
        }
        if (meshResult.indexBuffer) {
            this.returnIndexBuffer(meshResult.indexBuffer, meshResult.indexBucket || 0);
        }
        if (meshResult.indirectBuffer) {
            this.returnIndirectBuffer(meshResult.indirectBuffer);
        }
    }
    
    /**
     * Update hit rate statistic
     */
    _updateHitRate() {
        const total = this.stats.allocations + this.stats.reuses;
        this.stats.hitRate = total > 0 ? (this.stats.reuses / total) * 100 : 0;
    }
    
    /**
     * Update total bytes pooled
     */
    _updateTotalBytes() {
        let total = 0;
        for (let i = 0; i < BUCKET_VALUES.length; i++) {
            const vertBytes = this.vertexPools[i].length * BUCKET_VALUES[i] * 8;
            const idxBytes = this.indexPools[i].length * Math.floor(BUCKET_VALUES[i] * 1.5) * 4;
            total += vertBytes + idxBytes;
        }
        total += this.indirectPool.length * 20;
        this.stats.totalBytesPooled = total;
    }
    
    /**
     * Clear all pooled buffers (call on context loss or cleanup)
     */
    clear() {
        for (const pool of this.vertexPools) {
            for (const buffer of pool) {
                buffer.destroy();
            }
            pool.length = 0;
        }
        
        for (const pool of this.indexPools) {
            for (const buffer of pool) {
                buffer.destroy();
            }
            pool.length = 0;
        }
        
        for (const buffer of this.indirectPool) {
            buffer.destroy();
        }
        this.indirectPool.length = 0;
        
        this.stats.currentPooled = 0;
        this.stats.totalBytesPooled = 0;
        
        for (const bs of this.bucketStats) {
            bs.pooled = 0;
        }
    }
    
    /**
     * Get pool statistics
     */
    getStats() {
        return {
            ...this.stats,
            buckets: this.bucketStats.map((bs, i) => ({
                name: BUCKET_NAMES[i],
                size: BUCKET_VALUES[i],
                ...bs,
            })),
            pooledMB: (this.stats.totalBytesPooled / (1024 * 1024)).toFixed(2),
        };
    }
}

// Singleton instance
let globalPool = null;

/**
 * Get the global buffer pool instance
 */
export function getBufferPool() {
    if (!globalPool) {
        globalPool = new SubChunkBufferPool();
    }
    return globalPool;
}

/**
 * Initialize the global buffer pool
 * @param {GPUDevice} device 
 */
export function initBufferPool(device) {
    const pool = getBufferPool();
    pool.init(device);
    return pool;
}

export { BUCKET_SIZES, BUCKET_NAMES };
export default SubChunkBufferPool;
