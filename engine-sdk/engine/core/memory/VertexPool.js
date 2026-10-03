// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VertexPool.js - Persistent Vertex Buffer Pool
 * 
 * High-performance vertex memory management system that:
 * 1. Allocates a single large persistent buffer
 * 2. Divides it into fixed-size buckets for chunks
 * 3. Supports instant allocation/deallocation without GPU buffer creation
 * 4. Enables single-draw-call rendering of all chunks
 * 
 * Based on Nick McDonald's vertex pooling technique:
 * https://nickmcd.me/2021/04/04/high-performance-voxel-engine/
 */

// Default configuration
// MAXED for 8GB VRAM systems with huge render distance (24+ chunks)
const DEFAULT_CONFIG = {
    bucketSize: 65536,       // Vertices per bucket (enough for most chunks)
    numBuckets: 512,         // Total buckets (512 chunks = 128 MB) - maxed for 8GB VRAM
    bytesPerVertex: 4,       // Compact vertex format (1 u32)
    indicesPerFace: 6,       // 2 triangles per face
    verticesPerFace: 4,      // 4 corners per face
};

/**
 * VertexPool - Manages a large persistent vertex buffer with bucket allocation
 */
export class VertexPool {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        
        this.device = null;
        this.initialized = false;
        
        // Main buffers
        this.vertexBuffer = null;      // Persistent vertex storage
        this.indexBuffer = null;       // Shared index buffer (all chunks use same pattern)
        
        // Bucket management
        this.freeBuckets = [];         // Stack of available bucket indices
        this.usedBuckets = new Map();  // chunkKey -> BucketInfo
        this.bucketCount = 0;
        
        // Draw command management (for multiDrawIndirect)
        this.drawCommandBuffer = null;
        this.drawCommandData = null;   // CPU-side mirror for sorting
        
        // Statistics
        this.stats = {
            allocations: 0,
            deallocations: 0,
            peakUsage: 0,
            currentUsage: 0,
        };
    }
    
    /**
     * Initialize the vertex pool
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.device = device;
        
        const { bucketSize, numBuckets, bytesPerVertex, indicesPerFace, verticesPerFace } = this.config;
        
        // Calculate buffer sizes
        const vertexBufferSize = numBuckets * bucketSize * bytesPerVertex;
        const maxFacesPerBucket = Math.floor(bucketSize / verticesPerFace);
        const indexBufferSize = maxFacesPerBucket * indicesPerFace * 4;  // u32 indices
        
        // Create persistent vertex buffer
        this.vertexBuffer = device.createBuffer({
            label: 'Vertex Pool Buffer',
            size: vertexBufferSize,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Create shared index buffer (same pattern for all quads)
        // Pattern: 0,1,2, 2,3,0 for each face
        const indexData = new Uint32Array(maxFacesPerBucket * indicesPerFace);
        for (let face = 0; face < maxFacesPerBucket; face++) {
            const base = face * 4;  // 4 vertices per face
            const idx = face * 6;   // 6 indices per face
            indexData[idx + 0] = base + 0;
            indexData[idx + 1] = base + 1;
            indexData[idx + 2] = base + 2;
            indexData[idx + 3] = base + 2;
            indexData[idx + 4] = base + 3;
            indexData[idx + 5] = base + 0;
        }
        
        this.indexBuffer = device.createBuffer({
            label: 'Vertex Pool Index Buffer',
            size: indexBufferSize,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.indexBuffer, 0, indexData);
        
        // Create draw command buffer for multiDrawIndirect
        // Each command: indexCount, instanceCount, firstIndex, baseVertex, firstInstance
        const drawCommandSize = numBuckets * 20;  // 5 u32s per command
        this.drawCommandBuffer = device.createBuffer({
            label: 'Vertex Pool Draw Commands',
            size: drawCommandSize,
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // CPU-side draw command data for sorting
        this.drawCommandData = new Array(numBuckets).fill(null).map(() => ({
            indexCount: 0,
            instanceCount: 0,
            firstIndex: 0,
            baseVertex: 0,
            firstInstance: 0,
            chunkKey: null,
            distance: 0,
            visible: false,
            faceMask: 0b111111,  // Which faces to draw (for back-face culling)
        }));
        
        // Initialize free bucket stack
        for (let i = numBuckets - 1; i >= 0; i--) {
            this.freeBuckets.push(i);
        }
        
        this.bucketCount = numBuckets;
        this.initialized = true;
        
        console.log('[VertexPool] Initialized:');
        console.log(`  - ${numBuckets} buckets × ${bucketSize} vertices = ${(vertexBufferSize / 1024 / 1024).toFixed(1)} MB`);
        console.log(`  - Bucket size: ${bucketSize} vertices (${(bucketSize * bytesPerVertex / 1024).toFixed(1)} KB each)`);
    }
    
    /**
     * Allocate a bucket for a chunk
     * @param {string} chunkKey - Unique chunk identifier
     * @returns {BucketInfo|null} - Bucket info or null if pool is full
     */
    allocate(chunkKey) {
        if (!this.initialized) return null;
        
        // Check if already allocated
        if (this.usedBuckets.has(chunkKey)) {
            return this.usedBuckets.get(chunkKey);
        }
        
        // Check for available buckets
        if (this.freeBuckets.length === 0) {
            console.warn('[VertexPool] No free buckets available!');
            return null;
        }
        
        const bucketIndex = this.freeBuckets.pop();
        const { bucketSize, bytesPerVertex, verticesPerFace, indicesPerFace } = this.config;
        
        const info = {
            bucketIndex,
            chunkKey,
            vertexOffset: bucketIndex * bucketSize,
            byteOffset: bucketIndex * bucketSize * bytesPerVertex,
            maxVertices: bucketSize,
            maxFaces: Math.floor(bucketSize / verticesPerFace),
            vertexCount: 0,
            indexCount: 0,
            faceCount: 0,
            center: [0, 0, 0],  // For distance sorting
        };
        
        this.usedBuckets.set(chunkKey, info);
        this.stats.allocations++;
        this.stats.currentUsage++;
        this.stats.peakUsage = Math.max(this.stats.peakUsage, this.stats.currentUsage);
        
        // Update draw command data
        this.drawCommandData[bucketIndex].chunkKey = chunkKey;
        this.drawCommandData[bucketIndex].visible = true;
        
        return info;
    }
    
    /**
     * Free a bucket
     * @param {string} chunkKey 
     */
    free(chunkKey) {
        if (!this.usedBuckets.has(chunkKey)) return;
        
        const info = this.usedBuckets.get(chunkKey);
        const bucketIndex = info.bucketIndex;
        
        // Clear draw command
        this.drawCommandData[bucketIndex].indexCount = 0;
        this.drawCommandData[bucketIndex].chunkKey = null;
        this.drawCommandData[bucketIndex].visible = false;
        
        // Return bucket to free list
        this.freeBuckets.push(bucketIndex);
        this.usedBuckets.delete(chunkKey);
        
        this.stats.deallocations++;
        this.stats.currentUsage--;
    }
    
    /**
     * Update vertex data for a bucket
     * @param {string} chunkKey 
     * @param {ArrayBuffer} vertexData 
     * @param {number} faceCount 
     * @param {Array} center - [x, y, z] center position
     */
    updateBucket(chunkKey, vertexData, faceCount, center = [0, 0, 0]) {
        const info = this.usedBuckets.get(chunkKey);
        if (!info) {
            console.warn(`[VertexPool] Bucket not found for ${chunkKey}`);
            return;
        }
        
        const { verticesPerFace, indicesPerFace } = this.config;
        
        // Update bucket info
        info.faceCount = faceCount;
        info.vertexCount = faceCount * verticesPerFace;
        info.indexCount = faceCount * indicesPerFace;
        info.center = center;
        
        // Upload vertex data
        this.device.queue.writeBuffer(this.vertexBuffer, info.byteOffset, vertexData);
        
        // Update draw command
        const cmd = this.drawCommandData[info.bucketIndex];
        cmd.indexCount = info.indexCount;
        cmd.instanceCount = 1;
        cmd.firstIndex = 0;
        cmd.baseVertex = info.vertexOffset;
        cmd.firstInstance = info.bucketIndex;
    }
    
    /**
     * Sort chunks front-to-back for early-Z optimization
     * @param {Array} cameraPos - Camera position [x, y, z]
     */
    sortFrontToBack(cameraPos) {
        // Calculate distances
        for (const [chunkKey, info] of this.usedBuckets) {
            const cmd = this.drawCommandData[info.bucketIndex];
            const dx = info.center[0] - cameraPos[0];
            const dy = info.center[1] - cameraPos[1];
            const dz = info.center[2] - cameraPos[2];
            cmd.distance = dx * dx + dy * dy + dz * dz;
        }
        
        // Sort draw commands by distance (front to back)
        // Note: We don't actually reorder the buffer, just track order for CPU iteration
        // For true GPU sorting, we'd need a separate pass
    }
    
    /**
     * Apply back-face culling based on camera direction
     * Masks out faces that point away from camera
     * @param {Array} cameraForward - Camera forward direction [x, y, z]
     */
    applyBackFaceCulling(cameraForward) {
        // Face normals: +X, -X, +Y, -Y, +Z, -Z
        const normals = [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1],
        ];
        
        // Calculate which faces are visible (dot product > 0 means facing camera)
        let faceMask = 0;
        for (let i = 0; i < 6; i++) {
            const dot = normals[i][0] * (-cameraForward[0]) +
                       normals[i][1] * (-cameraForward[1]) +
                       normals[i][2] * (-cameraForward[2]);
            if (dot > 0) {
                faceMask |= (1 << i);
            }
        }
        
        // Apply mask to all chunks
        for (const cmd of this.drawCommandData) {
            if (cmd.visible) {
                cmd.faceMask = faceMask;
            }
        }
        
        return faceMask;
    }
    
    /**
     * Upload draw commands to GPU
     */
    uploadDrawCommands() {
        if (!this.initialized) return;
        
        const data = new Uint32Array(this.bucketCount * 5);
        
        for (let i = 0; i < this.bucketCount; i++) {
            const cmd = this.drawCommandData[i];
            const offset = i * 5;
            data[offset + 0] = cmd.indexCount;
            data[offset + 1] = cmd.instanceCount;
            data[offset + 2] = cmd.firstIndex;
            data[offset + 3] = cmd.baseVertex;
            data[offset + 4] = cmd.firstInstance;
        }
        
        this.device.queue.writeBuffer(this.drawCommandBuffer, 0, data);
    }
    
    /**
     * Get visible bucket count for rendering
     * @returns {number}
     */
    getVisibleCount() {
        let count = 0;
        for (const cmd of this.drawCommandData) {
            if (cmd.visible && cmd.indexCount > 0) count++;
        }
        return count;
    }
    
    /**
     * Get bucket info for a chunk
     * @param {string} chunkKey 
     * @returns {BucketInfo|null}
     */
    getBucket(chunkKey) {
        return this.usedBuckets.get(chunkKey) || null;
    }
    
    /**
     * Iterate over visible buckets for rendering
     * @param {function} callback - Called with (bucketInfo, drawCommand)
     */
    forEachVisible(callback) {
        for (const [chunkKey, info] of this.usedBuckets) {
            const cmd = this.drawCommandData[info.bucketIndex];
            if (cmd.visible && cmd.indexCount > 0) {
                callback(info, cmd);
            }
        }
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            freeCount: this.freeBuckets.length,
            usedCount: this.usedBuckets.size,
            utilization: (this.usedBuckets.size / this.bucketCount * 100).toFixed(1) + '%',
        };
    }
    
    /**
     * Destroy the vertex pool
     */
    destroy() {
        this.vertexBuffer?.destroy();
        this.indexBuffer?.destroy();
        this.drawCommandBuffer?.destroy();
        this.freeBuckets = [];
        this.usedBuckets.clear();
        this.initialized = false;
    }
}

/**
 * FaceOrientedVertexPool - Vertex pool with 6 sub-buckets per chunk for true back-face culling
 * Each chunk gets 6 smaller buckets, one per face direction
 */
export class FaceOrientedVertexPool {
    constructor(config = {}) {
        this.config = {
            bucketSize: 16384,       // Smaller buckets (1/6 of faces)
            numChunks: 512,          // Max chunks
            bytesPerVertex: 4,
            ...config,
        };
        
        this.device = null;
        this.initialized = false;
        
        // 6 vertex pools, one per face direction
        this.pools = [];
        for (let i = 0; i < 6; i++) {
            this.pools.push(new VertexPool({
                bucketSize: this.config.bucketSize,
                numBuckets: this.config.numChunks,
                bytesPerVertex: this.config.bytesPerVertex,
            }));
        }
        
        // Face visibility mask (updated by camera direction)
        this.visibleFaces = 0b111111;  // All faces visible by default
    }
    
    async init(device) {
        this.device = device;
        
        for (let i = 0; i < 6; i++) {
            await this.pools[i].init(device);
        }
        
        this.initialized = true;
        console.log('[FaceOrientedVertexPool] Initialized with 6 face pools');
    }
    
    /**
     * Allocate buckets for a chunk (one per face direction)
     * @param {string} chunkKey 
     * @returns {Array} - Array of 6 bucket infos
     */
    allocate(chunkKey) {
        const buckets = [];
        for (let face = 0; face < 6; face++) {
            buckets.push(this.pools[face].allocate(`${chunkKey}_face${face}`));
        }
        return buckets;
    }
    
    /**
     * Free all buckets for a chunk
     * @param {string} chunkKey 
     */
    free(chunkKey) {
        for (let face = 0; face < 6; face++) {
            this.pools[face].free(`${chunkKey}_face${face}`);
        }
    }
    
    /**
     * Update face data for a chunk
     * @param {string} chunkKey 
     * @param {number} faceDir - Face direction (0-5)
     * @param {ArrayBuffer} vertexData 
     * @param {number} faceCount 
     * @param {Array} center 
     */
    updateFace(chunkKey, faceDir, vertexData, faceCount, center) {
        this.pools[faceDir].updateBucket(`${chunkKey}_face${faceDir}`, vertexData, faceCount, center);
    }
    
    /**
     * Update visible faces based on camera direction (true back-face culling)
     * @param {Array} cameraForward - Camera forward direction
     */
    updateVisibleFaces(cameraForward) {
        // Face normals: +X, -X, +Y, -Y, +Z, -Z
        const normals = [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1],
        ];
        
        this.visibleFaces = 0;
        for (let i = 0; i < 6; i++) {
            // Face is visible if it points toward camera (dot with -forward > 0)
            const dot = normals[i][0] * (-cameraForward[0]) +
                       normals[i][1] * (-cameraForward[1]) +
                       normals[i][2] * (-cameraForward[2]);
            if (dot > 0) {
                this.visibleFaces |= (1 << i);
            }
        }
        
        return this.visibleFaces;
    }
    
    /**
     * Render all visible chunks with true back-face culling
     * Only renders face pools that are visible from camera direction
     * @param {GPURenderPassEncoder} pass 
     * @param {GPURenderPipeline} pipeline 
     * @param {GPUBindGroup} bindGroup 
     */
    render(pass, pipeline, bindGroup) {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        
        // Only render visible face directions
        for (let face = 0; face < 6; face++) {
            if ((this.visibleFaces & (1 << face)) === 0) {
                continue;  // Skip faces pointing away from camera
            }
            
            const pool = this.pools[face];
            pass.setVertexBuffer(0, pool.vertexBuffer);
            pass.setIndexBuffer(pool.indexBuffer, 'uint32');
            
            // Render all chunks for this face direction
            pool.forEachVisible((info, cmd) => {
                if (cmd.indexCount > 0) {
                    pass.drawIndexed(cmd.indexCount, 1, 0, info.vertexOffset, 0);
                }
            });
        }
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [vertex_pool] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.config.bucketSize = parseInt(cfg.bucket_size) || 65536;
        this.config.maxBuckets = parseInt(cfg.max_buckets) || 256;
        this.defragEnabled = cfg.defrag_enabled !== false;
    }
    
    destroy() {
        for (const pool of this.pools) {
            pool.destroy();
        }
        this.initialized = false;
    }
}

export default VertexPool;
