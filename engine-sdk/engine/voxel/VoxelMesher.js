// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelMesher.js - Binary Greedy Meshing for Voxel Chunks
 * 
 * Implements optimized greedy meshing with:
 * - Face culling (hidden face removal)
 * - Greedy quad merging
 * - Compact vertex format
 * 
 * Target: 50-200μs per chunk (CPU), even faster on GPU
 */

import { CHUNK_SIZE, CHUNK_SIZE_SQ, CHUNK_VOLUME } from './VoxelConstants.js';
import { MATERIAL, MATERIAL_COLORS } from './MaterialSchema.js';

// ============================================================================
// GPU BUFFER POOL - Prevents per-chunk buffer creation stalls
// ============================================================================

/**
 * GPUBufferPool - StagingBelt-style buffer pool with frame tracking
 * 
 * Best practices implemented:
 * - Power-of-2 bucket sizes for efficient pooling
 * - Frame-based recycling (buffers return to pool after N frames)
 * - Deferred release to avoid GPU stalls
 * - Per-bucket statistics for tuning
 */
class GPUBufferPool {
    constructor() {
        this.device = null;
        this.vertexPools = new Map();  // size -> [buffer, buffer, ...]
        this.indexPools = new Map();
        
        // Frame tracking for deferred release
        this.currentFrame = 0;
        this.pendingRelease = [];  // { buffer, poolSize, type, releaseFrame }
        this.framesToWait = 2;     // Wait 2 frames before recycling (reduced for faster reuse)
        
        // Enhanced statistics
        this.stats = { 
            hits: 0, 
            misses: 0, 
            created: 0,
            recycled: 0,
            totalAllocatedBytes: 0,
            peakAllocatedBytes: 0,
        };
        
        // Per-bucket stats for tuning
        this.bucketStats = new Map();  // size -> { hits, misses, pooled, inUse }
    }
    
    init(device) {
        this.device = device;
        
        // Pre-allocate common sizes (in bytes)
        // MEMORY OPTIMIZED: Reduced pre-allocation, rely more on on-demand allocation
        // Previous: ~122MB pre-allocated, now: ~15MB pre-allocated
        const commonSizes = [
            { size: 4096, count: 8 },       // Tiny chunks (mostly air)
            { size: 8192, count: 8 },
            { size: 16384, count: 16 },
            { size: 32768, count: 32 },     // Most common chunk mesh size
            { size: 65536, count: 32 },     // Large chunks
            { size: 131072, count: 16 },    // Very large chunks
            { size: 262144, count: 8 },
            { size: 524288, count: 4 },
            { size: 1048576, count: 2 },    // 1MB - dense chunks
            { size: 2097152, count: 1 },    // 2MB - very dense underground
            { size: 4194304, count: 0 },    // 4MB - allocate on demand only
        ];
        
        for (const { size, count } of commonSizes) {
            this._initBucketStats(size);
            this._preAllocate(size, count);
        }
        
        console.log(`[GPUBufferPool] Initialized with ${commonSizes.length} bucket sizes, ${this.stats.created} buffers pre-allocated`);
    }
    
    _initBucketStats(size) {
        if (!this.bucketStats.has(size)) {
            this.bucketStats.set(size, { hits: 0, misses: 0, pooled: 0, inUse: 0, created: 0 });
        }
    }
    
    _preAllocate(size, count) {
        if (!this.device) return;
        
        for (let i = 0; i < count; i++) {
            // Vertex buffer
            const vb = this.device.createBuffer({
                label: `PooledVertex_${size}`,
                size,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            if (!this.vertexPools.has(size)) this.vertexPools.set(size, []);
            this.vertexPools.get(size).push(vb);
            
            // Index buffer
            const ib = this.device.createBuffer({
                label: `PooledIndex_${size}`,
                size,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            });
            if (!this.indexPools.has(size)) this.indexPools.set(size, []);
            this.indexPools.get(size).push(ib);
        }
        
        this.stats.created += count * 2;
        this.stats.totalAllocatedBytes += size * count * 2;
        this.stats.peakAllocatedBytes = Math.max(this.stats.peakAllocatedBytes, this.stats.totalAllocatedBytes);
        
        const bs = this.bucketStats.get(size);
        if (bs) {
            bs.pooled += count * 2;
            bs.created += count * 2;
        }
    }
    
    _roundUpSize(size) {
        // Round up to power of 2 for better pooling
        // Max 4MB for extreme cases
        let s = 4096;
        while (s < size && s < 4194304) s *= 2;
        return s;
    }
    
    /**
     * Begin a new frame - process deferred releases
     */
    beginFrame() {
        this.currentFrame++;
        this._processPendingReleases();
    }
    
    /**
     * Process buffers that are safe to recycle
     */
    _processPendingReleases() {
        for (let i = this.pendingRelease.length - 1; i >= 0; i--) {
            const pending = this.pendingRelease[i];
            if (this.currentFrame >= pending.releaseFrame) {
                // Safe to recycle
                if (pending.type === 'vertex') {
                    this._returnToPool(this.vertexPools, pending.buffer, pending.poolSize);
                } else {
                    this._returnToPool(this.indexPools, pending.buffer, pending.poolSize);
                }
                this.pendingRelease.splice(i, 1);
                this.stats.recycled++;
                
                const bs = this.bucketStats.get(pending.poolSize);
                if (bs) {
                    bs.pooled++;
                    bs.inUse--;
                }
            }
        }
    }
    
    _returnToPool(pools, buffer, poolSize) {
        if (!pools.has(poolSize)) pools.set(poolSize, []);
        pools.get(poolSize).push(buffer);
    }
    
    acquireVertex(size) {
        const poolSize = this._roundUpSize(size);
        this._initBucketStats(poolSize);
        const pool = this.vertexPools.get(poolSize);
        const bs = this.bucketStats.get(poolSize);
        
        if (pool && pool.length > 0) {
            this.stats.hits++;
            if (bs) { bs.hits++; bs.pooled--; bs.inUse++; }
            return { buffer: pool.pop(), poolSize, fromPool: true };
        }
        
        this.stats.misses++;
        if (bs) { bs.misses++; bs.inUse++; bs.created++; }
        
        // Create new buffer if pool empty
        const buffer = this.device.createBuffer({
            label: `PooledVertex_${poolSize}_dyn`,
            size: poolSize,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.stats.created++;
        this.stats.totalAllocatedBytes += poolSize;
        this.stats.peakAllocatedBytes = Math.max(this.stats.peakAllocatedBytes, this.stats.totalAllocatedBytes);
        
        return { buffer, poolSize, fromPool: false };
    }
    
    acquireIndex(size) {
        const poolSize = this._roundUpSize(size);
        this._initBucketStats(poolSize);
        const pool = this.indexPools.get(poolSize);
        const bs = this.bucketStats.get(poolSize);
        
        if (pool && pool.length > 0) {
            this.stats.hits++;
            if (bs) { bs.hits++; bs.pooled--; bs.inUse++; }
            return { buffer: pool.pop(), poolSize, fromPool: true };
        }
        
        this.stats.misses++;
        if (bs) { bs.misses++; bs.inUse++; bs.created++; }
        
        const buffer = this.device.createBuffer({
            label: `PooledIndex_${poolSize}_dyn`,
            size: poolSize,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.stats.created++;
        this.stats.totalAllocatedBytes += poolSize;
        this.stats.peakAllocatedBytes = Math.max(this.stats.peakAllocatedBytes, this.stats.totalAllocatedBytes);
        
        return { buffer, poolSize, fromPool: false };
    }
    
    /**
     * Release vertex buffer (deferred for GPU safety)
     */
    releaseVertex(buffer, poolSize) {
        if (!buffer || !poolSize) return;
        this.pendingRelease.push({
            buffer,
            poolSize,
            type: 'vertex',
            releaseFrame: this.currentFrame + this.framesToWait,
        });
    }
    
    /**
     * Release index buffer (deferred for GPU safety)
     */
    releaseIndex(buffer, poolSize) {
        if (!buffer || !poolSize) return;
        this.pendingRelease.push({
            buffer,
            poolSize,
            type: 'index',
            releaseFrame: this.currentFrame + this.framesToWait,
        });
    }
    
    /**
     * Immediate release (use only when certain GPU is done)
     */
    releaseVertexImmediate(buffer, poolSize) {
        if (!buffer || !poolSize) return;
        this._returnToPool(this.vertexPools, buffer, poolSize);
        const bs = this.bucketStats.get(poolSize);
        if (bs) { bs.pooled++; bs.inUse--; }
    }
    
    releaseIndexImmediate(buffer, poolSize) {
        if (!buffer || !poolSize) return;
        this._returnToPool(this.indexPools, buffer, poolSize);
        const bs = this.bucketStats.get(poolSize);
        if (bs) { bs.pooled++; bs.inUse--; }
    }
    
    /**
     * Set memory limits based on detected VRAM
     * @param {number} detectedVRAM - Total detected VRAM in bytes
     * @param {number} reservePercent - Percentage to use (0.0-1.0), default 0.6
     */
    setMemoryLimits(detectedVRAM, reservePercent = 0.6) {
        this.detectedVRAM = detectedVRAM;
        this.softLimit = Math.floor(detectedVRAM * reservePercent);
        this.hardLimit = Math.floor(detectedVRAM * 0.85); // Never exceed 85%
        this.memoryLimitSet = true;
        
        console.log(`[GPUBufferPool] Memory limits set:`);
        console.log(`  Detected VRAM: ${(detectedVRAM / 1024 / 1024).toFixed(0)}MB`);
        console.log(`  Soft limit: ${(this.softLimit / 1024 / 1024).toFixed(0)}MB (${(reservePercent * 100).toFixed(0)}%)`);
        console.log(`  Hard limit: ${(this.hardLimit / 1024 / 1024).toFixed(0)}MB (85%)`);
    }
    
    /**
     * Check if we're approaching memory limits
     * @returns {{ canAllocate: boolean, pressure: number, atLimit: boolean }}
     */
    getMemoryPressure() {
        const used = this.stats.totalAllocatedBytes;
        
        if (!this.memoryLimitSet) {
            return { canAllocate: true, pressure: 0, atLimit: false, usedMB: used / 1024 / 1024 };
        }
        
        const pressure = used / this.softLimit; // 0.0 to 1.0+ 
        const atHardLimit = used >= this.hardLimit;
        const atSoftLimit = used >= this.softLimit;
        
        return {
            canAllocate: !atHardLimit,
            pressure: Math.min(pressure, 2.0), // Cap at 200%
            atLimit: atHardLimit,
            atSoftLimit,
            usedMB: used / 1024 / 1024,
            softLimitMB: this.softLimit / 1024 / 1024,
            hardLimitMB: this.hardLimit / 1024 / 1024,
        };
    }
    
    /**
     * Get pool statistics
     */
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0 
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1)
            : 0;
        
        const pressure = this.getMemoryPressure();
        
        return {
            ...this.stats,
            hitRate: `${hitRate}%`,
            pendingReleases: this.pendingRelease.length,
            totalPooledVertex: Array.from(this.vertexPools.values()).reduce((sum, arr) => sum + arr.length, 0),
            totalPooledIndex: Array.from(this.indexPools.values()).reduce((sum, arr) => sum + arr.length, 0),
            peakMemoryMB: (this.stats.peakAllocatedBytes / 1024 / 1024).toFixed(1),
            currentMemoryMB: (this.stats.totalAllocatedBytes / 1024 / 1024).toFixed(1),
            memoryPressure: pressure.pressure,
            atLimit: pressure.atLimit,
        };
    }
    
    /**
     * Get per-bucket statistics for tuning
     */
    getBucketStats() {
        const result = [];
        for (const [size, bs] of this.bucketStats) {
            const hitRate = bs.hits + bs.misses > 0 
                ? (bs.hits / (bs.hits + bs.misses) * 100).toFixed(0)
                : 100;
            result.push({
                size: size >= 1048576 ? `${size / 1048576}MB` : `${size / 1024}KB`,
                bytes: size,
                ...bs,
                hitRate: `${hitRate}%`,
            });
        }
        return result.sort((a, b) => a.bytes - b.bytes);
    }
}

// Global buffer pool instance
export const gpuBufferPool = new GPUBufferPool();

// ============================================================================
// CONSTANTS
// ============================================================================

// Face directions
const FACE_RIGHT  = 0;  // +X
const FACE_LEFT   = 1;  // -X
const FACE_TOP    = 2;  // +Y
const FACE_BOTTOM = 3;  // -Y
const FACE_FRONT  = 4;  // +Z
const FACE_BACK   = 5;  // -Z

// Face normals
const FACE_NORMALS = [
    [1, 0, 0],   // +X
    [-1, 0, 0],  // -X
    [0, 1, 0],   // +Y
    [0, -1, 0],  // -Y
    [0, 0, 1],   // +Z
    [0, 0, -1],  // -Z
];

// Vertex stride: position (3) + normal (3) + color (4) = 10 floats
export const VERTEX_STRIDE = 10;

// ============================================================================
// AMBIENT OCCLUSION
// ============================================================================

/**
 * Calculate vertex AO based on 3 neighbors (side1, side2, corner)
 * Returns 0 (darkest) to 3 (brightest)
 * Standard voxel AO algorithm
 */
function calcVertexAO(side1, side2, corner) {
    if (side1 && side2) {
        return 0;  // Both sides solid = darkest corner
    }
    return 3 - (side1 + side2 + corner);
}

/**
 * Convert AO value (0-3) to light multiplier (0.0-1.0)
 */
function aoToLight(ao) {
    // 0 -> 0.4 (dark), 3 -> 1.0 (bright)
    const aoValues = [0.4, 0.6, 0.8, 1.0];
    return aoValues[ao] || 1.0;
}

/**
 * Get AO values for all 4 vertices of a face
 * @param {Function} isSolid - Function to check if position is solid
 * @param {number} x - Face position X
 * @param {number} y - Face position Y
 * @param {number} z - Face position Z
 * @param {number} face - Face direction
 * @returns {number[]} Array of 4 AO values (0-3) for each vertex
 */
function getFaceAO(isSolid, x, y, z, face) {
    // For each face, we need to check neighbors in the plane perpendicular to the face normal
    // Each vertex has 2 side neighbors and 1 corner neighbor
    
    switch (face) {
        case FACE_TOP: { // +Y - check in XZ plane at y+1
            const s = (dx, dz) => isSolid(x + dx, y, z + dz) ? 1 : 0;
            return [
                calcVertexAO(s(-1, 0), s(0, -1), s(-1, -1)),  // v0: corner (0,0)
                calcVertexAO(s(-1, 0), s(0, 1), s(-1, 1)),    // v1: corner (0,h)
                calcVertexAO(s(1, 0), s(0, 1), s(1, 1)),      // v2: corner (w,h)
                calcVertexAO(s(1, 0), s(0, -1), s(1, -1)),    // v3: corner (w,0)
            ];
        }
        case FACE_BOTTOM: { // -Y - check in XZ plane at y-1
            const s = (dx, dz) => isSolid(x + dx, y - 1, z + dz) ? 1 : 0;
            return [
                calcVertexAO(s(-1, 0), s(0, 1), s(-1, 1)),
                calcVertexAO(s(-1, 0), s(0, -1), s(-1, -1)),
                calcVertexAO(s(1, 0), s(0, -1), s(1, -1)),
                calcVertexAO(s(1, 0), s(0, 1), s(1, 1)),
            ];
        }
        case FACE_RIGHT: { // +X - check in YZ plane at x+1
            const s = (dy, dz) => isSolid(x, y + dy, z + dz) ? 1 : 0;
            return [
                calcVertexAO(s(-1, 0), s(0, -1), s(-1, -1)),
                calcVertexAO(s(1, 0), s(0, -1), s(1, -1)),
                calcVertexAO(s(1, 0), s(0, 1), s(1, 1)),
                calcVertexAO(s(-1, 0), s(0, 1), s(-1, 1)),
            ];
        }
        case FACE_LEFT: { // -X - check in YZ plane at x-1
            const s = (dy, dz) => isSolid(x - 1, y + dy, z + dz) ? 1 : 0;
            return [
                calcVertexAO(s(-1, 0), s(0, 1), s(-1, 1)),
                calcVertexAO(s(1, 0), s(0, 1), s(1, 1)),
                calcVertexAO(s(1, 0), s(0, -1), s(1, -1)),
                calcVertexAO(s(-1, 0), s(0, -1), s(-1, -1)),
            ];
        }
        case FACE_FRONT: { // +Z - check in XY plane at z+1
            const s = (dx, dy) => isSolid(x + dx, y + dy, z) ? 1 : 0;
            return [
                calcVertexAO(s(1, 0), s(0, -1), s(1, -1)),
                calcVertexAO(s(1, 0), s(0, 1), s(1, 1)),
                calcVertexAO(s(-1, 0), s(0, 1), s(-1, 1)),
                calcVertexAO(s(-1, 0), s(0, -1), s(-1, -1)),
            ];
        }
        case FACE_BACK: { // -Z - check in XY plane at z-1
            const s = (dx, dy) => isSolid(x + dx, y + dy, z - 1) ? 1 : 0;
            return [
                calcVertexAO(s(-1, 0), s(0, -1), s(-1, -1)),
                calcVertexAO(s(-1, 0), s(0, 1), s(-1, 1)),
                calcVertexAO(s(1, 0), s(0, 1), s(1, 1)),
                calcVertexAO(s(1, 0), s(0, -1), s(1, -1)),
            ];
        }
    }
    return [3, 3, 3, 3];  // Default: no occlusion
}

// ============================================================================
// MESH BUILDER
// ============================================================================

class MeshBuilder {
    constructor(initialCapacity = 4096) {
        this.vertices = new Float32Array(initialCapacity * VERTEX_STRIDE);
        this.indices = new Uint32Array(initialCapacity * 6);
        this.vertexCount = 0;
        this.indexCount = 0;
    }
    
    /** Ensure capacity for vertices */
    ensureVertexCapacity(count) {
        const needed = (this.vertexCount + count) * VERTEX_STRIDE;
        if (needed > this.vertices.length) {
            const newSize = Math.max(needed, this.vertices.length * 2);
            const newVerts = new Float32Array(newSize);
            newVerts.set(this.vertices);
            this.vertices = newVerts;
        }
    }
    
    /** Ensure capacity for indices */
    ensureIndexCapacity(count) {
        const needed = this.indexCount + count;
        if (needed > this.indices.length) {
            const newSize = Math.max(needed, this.indices.length * 2);
            const newInds = new Uint32Array(newSize);
            newInds.set(this.indices);
            this.indices = newInds;
        }
    }
    
    /** Add a quad face with optional AO values */
    addQuad(x, y, z, w, h, face, material, ao = null) {
        this.ensureVertexCapacity(4);
        this.ensureIndexCapacity(6);
        
        const normal = FACE_NORMALS[face];
        const color = MATERIAL_COLORS[material] || MATERIAL_COLORS[MATERIAL.STONE];
        const r = color[0] / 255;
        const g = color[1] / 255;
        const b = color[2] / 255;
        const a = color[3] / 255;
        
        // AO light multipliers (default to 1.0 if no AO provided)
        const ao0 = ao ? aoToLight(ao[0]) : 1.0;
        const ao1 = ao ? aoToLight(ao[1]) : 1.0;
        const ao2 = ao ? aoToLight(ao[2]) : 1.0;
        const ao3 = ao ? aoToLight(ao[3]) : 1.0;
        
        const baseVertex = this.vertexCount;
        const vi = baseVertex * VERTEX_STRIDE;
        
        // Generate 4 vertices based on face direction
        let v0, v1, v2, v3;
        
        // Note: x,y,z is the face position, w,h are the quad dimensions
        // The face position is already correct from the mesher
        switch (face) {
            case FACE_RIGHT: // +X face at x position
                v0 = [x, y, z];
                v1 = [x, y + h, z];
                v2 = [x, y + h, z + w];
                v3 = [x, y, z + w];
                break;
            case FACE_LEFT: // -X face at x position
                v0 = [x, y, z + w];
                v1 = [x, y + h, z + w];
                v2 = [x, y + h, z];
                v3 = [x, y, z];
                break;
            case FACE_TOP: // +Y face at y position
                v0 = [x, y, z];
                v1 = [x, y, z + h];
                v2 = [x + w, y, z + h];
                v3 = [x + w, y, z];
                break;
            case FACE_BOTTOM: // -Y face at y position
                v0 = [x, y, z + h];
                v1 = [x, y, z];
                v2 = [x + w, y, z];
                v3 = [x + w, y, z + h];
                break;
            case FACE_FRONT: // +Z face at z position
                v0 = [x + w, y, z];
                v1 = [x + w, y + h, z];
                v2 = [x, y + h, z];
                v3 = [x, y, z];
                break;
            case FACE_BACK: // -Z face at z position
                v0 = [x, y, z];
                v1 = [x, y + h, z];
                v2 = [x + w, y + h, z];
                v3 = [x + w, y, z];
                break;
        }
        
        // Write vertices: position (3) + normal (3) + color (4) with AO baked into color
        const writeVertex = (v, offset, aoMult) => {
            this.vertices[offset + 0] = v[0];
            this.vertices[offset + 1] = v[1];
            this.vertices[offset + 2] = v[2];
            this.vertices[offset + 3] = normal[0];
            this.vertices[offset + 4] = normal[1];
            this.vertices[offset + 5] = normal[2];
            // Apply AO to color (darken corners)
            this.vertices[offset + 6] = r * aoMult;
            this.vertices[offset + 7] = g * aoMult;
            this.vertices[offset + 8] = b * aoMult;
            this.vertices[offset + 9] = a;
        };
        
        writeVertex(v0, vi, ao0);
        writeVertex(v1, vi + VERTEX_STRIDE, ao1);
        writeVertex(v2, vi + 2 * VERTEX_STRIDE, ao2);
        writeVertex(v3, vi + 3 * VERTEX_STRIDE, ao3);
        
        // Write indices (two triangles)
        // Use flipped triangulation when AO requires it to avoid interpolation artifacts
        const ii = this.indexCount;
        
        // Check if we need to flip triangulation for better AO interpolation
        // Flip if ao0 + ao2 > ao1 + ao3 (anisotropy fix)
        const shouldFlip = ao && (ao[0] + ao[2] > ao[1] + ao[3]);
        
        if (shouldFlip) {
            // Flipped triangulation: 0-1-3, 1-2-3
            this.indices[ii + 0] = baseVertex + 0;
            this.indices[ii + 1] = baseVertex + 1;
            this.indices[ii + 2] = baseVertex + 3;
            this.indices[ii + 3] = baseVertex + 1;
            this.indices[ii + 4] = baseVertex + 2;
            this.indices[ii + 5] = baseVertex + 3;
        } else {
            // Normal triangulation: 0-1-2, 0-2-3
            this.indices[ii + 0] = baseVertex + 0;
            this.indices[ii + 1] = baseVertex + 1;
            this.indices[ii + 2] = baseVertex + 2;
            this.indices[ii + 3] = baseVertex + 0;
            this.indices[ii + 4] = baseVertex + 2;
            this.indices[ii + 5] = baseVertex + 3;
        }
        
        this.vertexCount += 4;
        this.indexCount += 6;
    }
    
    /** Get trimmed arrays */
    getArrays() {
        return {
            vertices: this.vertices.slice(0, this.vertexCount * VERTEX_STRIDE),
            indices: this.indices.slice(0, this.indexCount),
            vertexCount: this.vertexCount,
            indexCount: this.indexCount,
        };
    }
    
    /** Reset for reuse */
    reset() {
        this.vertexCount = 0;
        this.indexCount = 0;
    }
}

// ============================================================================
// TRANSPARENT MATERIALS
// ============================================================================

// Materials that should be rendered in the water/transparent pass
const TRANSPARENT_MATERIALS = new Set([
    MATERIAL.WATER,
    // Add other transparent materials here (e.g., glass, ice)
]);

/** Check if a material is transparent */
export function isTransparentMaterial(material) {
    return TRANSPARENT_MATERIALS.has(material);
}

// ============================================================================
// CHUNK-LEVEL FACE CULLING
// ============================================================================

/**
 * Check if a chunk's boundary face is fully solid (all voxels on that face are non-air)
 * Used to skip meshing faces that are completely hidden by a solid neighbor
 * @param {VoxelChunk} chunk
 * @param {number} face - FACE_RIGHT, FACE_LEFT, etc.
 * @returns {boolean} true if the entire boundary face is solid
 */
export function isChunkFaceSolid(chunk, face) {
    if (!chunk || !chunk.voxels) return false;
    
    // Homogeneous solid chunk = all faces are solid
    if (chunk.isHomogeneous) {
        return chunk.homogeneousMaterial !== MATERIAL.AIR;
    }
    
    const voxels = chunk.voxels;
    const S = CHUNK_SIZE;
    const S2 = CHUNK_SIZE_SQ;
    
    switch (face) {
        case FACE_RIGHT: // +X boundary (x = CHUNK_SIZE-1)
            for (let z = 0; z < S; z++) {
                for (let y = 0; y < S; y++) {
                    if (voxels[(S - 1) + y * S + z * S2] === MATERIAL.AIR) return false;
                }
            }
            return true;
        case FACE_LEFT: // -X boundary (x = 0)
            for (let z = 0; z < S; z++) {
                for (let y = 0; y < S; y++) {
                    if (voxels[0 + y * S + z * S2] === MATERIAL.AIR) return false;
                }
            }
            return true;
        case FACE_TOP: // +Y boundary (y = CHUNK_SIZE-1)
            for (let z = 0; z < S; z++) {
                for (let x = 0; x < S; x++) {
                    if (voxels[x + (S - 1) * S + z * S2] === MATERIAL.AIR) return false;
                }
            }
            return true;
        case FACE_BOTTOM: // -Y boundary (y = 0)
            for (let z = 0; z < S; z++) {
                for (let x = 0; x < S; x++) {
                    if (voxels[x + 0 * S + z * S2] === MATERIAL.AIR) return false;
                }
            }
            return true;
        case FACE_FRONT: // +Z boundary (z = CHUNK_SIZE-1)
            for (let y = 0; y < S; y++) {
                for (let x = 0; x < S; x++) {
                    if (voxels[x + y * S + (S - 1) * S2] === MATERIAL.AIR) return false;
                }
            }
            return true;
        case FACE_BACK: // -Z boundary (z = 0)
            for (let y = 0; y < S; y++) {
                for (let x = 0; x < S; x++) {
                    if (voxels[x + y * S + 0 * S2] === MATERIAL.AIR) return false;
                }
            }
            return true;
    }
    return false;
}

/**
 * Get occlusion mask for a chunk based on neighbor chunk boundaries
 * Returns a bitmask where bit N is set if face N is fully occluded
 * @param {Function} getNeighborChunk - Function(cx, cy, cz) returning neighbor chunk
 * @param {number} cx - Chunk X coordinate
 * @param {number} cy - Chunk Y coordinate  
 * @param {number} cz - Chunk Z coordinate
 * @returns {number} Bitmask of occluded faces
 */
export function getChunkOcclusionMask(getNeighborChunk, cx, cy, cz) {
    let mask = 0;
    
    // Check +X neighbor's -X face
    const posX = getNeighborChunk(cx + 1, cy, cz);
    if (posX && isChunkFaceSolid(posX, FACE_LEFT)) mask |= (1 << FACE_RIGHT);
    
    // Check -X neighbor's +X face
    const negX = getNeighborChunk(cx - 1, cy, cz);
    if (negX && isChunkFaceSolid(negX, FACE_RIGHT)) mask |= (1 << FACE_LEFT);
    
    // Check +Y neighbor's -Y face
    const posY = getNeighborChunk(cx, cy + 1, cz);
    if (posY && isChunkFaceSolid(posY, FACE_BOTTOM)) mask |= (1 << FACE_TOP);
    
    // Check -Y neighbor's +Y face
    const negY = getNeighborChunk(cx, cy - 1, cz);
    if (negY && isChunkFaceSolid(negY, FACE_TOP)) mask |= (1 << FACE_BOTTOM);
    
    // Check +Z neighbor's -Z face
    const posZ = getNeighborChunk(cx, cy, cz + 1);
    if (posZ && isChunkFaceSolid(posZ, FACE_BACK)) mask |= (1 << FACE_FRONT);
    
    // Check -Z neighbor's +Z face
    const negZ = getNeighborChunk(cx, cy, cz - 1);
    if (negZ && isChunkFaceSolid(negZ, FACE_FRONT)) mask |= (1 << FACE_BACK);
    
    return mask;
}

/**
 * Get view-dependent face culling mask
 * Skips chunk faces that face away from camera (backface culling at chunk level)
 * @param {number} cx - Chunk X coordinate
 * @param {number} cy - Chunk Y coordinate
 * @param {number} cz - Chunk Z coordinate
 * @param {number[]} cameraPos - Camera world position [x, y, z]
 * @returns {number} Bitmask of faces to skip (facing away from camera)
 */
export function getViewCullingMask(cx, cy, cz, cameraPos) {
    let mask = 0;
    
    // Chunk center in world coordinates
    const chunkCenterX = (cx + 0.5) * CHUNK_SIZE;
    const chunkCenterY = (cy + 0.5) * CHUNK_SIZE;
    const chunkCenterZ = (cz + 0.5) * CHUNK_SIZE;
    
    // Direction from chunk center to camera
    const toCamX = cameraPos[0] - chunkCenterX;
    const toCamY = cameraPos[1] - chunkCenterY;
    const toCamZ = cameraPos[2] - chunkCenterZ;
    
    // Skip faces that face away from camera (dot product < 0)
    // +X face: normal is [1,0,0], skip if camera is in -X direction
    if (toCamX < 0) mask |= (1 << FACE_RIGHT);
    // -X face: normal is [-1,0,0], skip if camera is in +X direction  
    if (toCamX > 0) mask |= (1 << FACE_LEFT);
    // +Y face: normal is [0,1,0], skip if camera is in -Y direction
    if (toCamY < 0) mask |= (1 << FACE_TOP);
    // -Y face: normal is [0,-1,0], skip if camera is in +Y direction
    if (toCamY > 0) mask |= (1 << FACE_BOTTOM);
    // +Z face: normal is [0,0,1], skip if camera is in -Z direction
    if (toCamZ < 0) mask |= (1 << FACE_FRONT);
    // -Z face: normal is [0,0,-1], skip if camera is in +Z direction
    if (toCamZ > 0) mask |= (1 << FACE_BACK);
    
    return mask;
}

// ============================================================================
// GREEDY MESHER
// ============================================================================

// Reusable mesh builders (larger capacity for non-greedy meshing)
const meshBuilder = new MeshBuilder(65536);
const waterMeshBuilder = new MeshBuilder(16384);  // Separate builder for water

/**
 * Generate mesh for a voxel chunk using simple per-face meshing with AO
 * Returns separate meshes for opaque and transparent (water) geometry
 * @param {VoxelChunk} chunk 
 * @param {Function} getNeighborVoxel - Function to get voxel from neighbor chunks
 * @param {number} occludedFaces - Bitmask of faces to skip (from getChunkOcclusionMask)
 * @returns {{ 
 *   vertices: Float32Array, indices: Uint32Array, vertexCount: number, indexCount: number,
 *   waterVertices: Float32Array, waterIndices: Uint32Array, waterVertexCount: number, waterIndexCount: number
 * }}
 */
export function meshChunk(chunk, getNeighborVoxel = null, occludedFaces = 0) {
    meshBuilder.reset();
    waterMeshBuilder.reset();
    
    // Fast path: homogeneous AIR chunks need no mesh
    if (chunk.isHomogeneous && chunk.homogeneousMaterial === MATERIAL.AIR) {
        return {
            vertices: new Float32Array(0),
            indices: new Uint32Array(0),
            vertexCount: 0,
            indexCount: 0,
            waterVertices: new Float32Array(0),
            waterIndices: new Uint32Array(0),
            waterVertexCount: 0,
            waterIndexCount: 0,
        };
    }
    
    // Use chunk.get() for homogeneous chunk support
    const getLocalVoxel = chunk.isHomogeneous
        ? () => chunk.homogeneousMaterial  // All same material
        : (lx, ly, lz) => chunk.voxels[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ];
    
    // Helper to get voxel (handles chunk boundaries)
    // Returns the voxel material, or MATERIAL.AIR if outside and no neighbor lookup
    const getVoxel = (lx, ly, lz) => {
        if (lx >= 0 && lx < CHUNK_SIZE &&
            ly >= 0 && ly < CHUNK_SIZE &&
            lz >= 0 && lz < CHUNK_SIZE) {
            return getLocalVoxel(lx, ly, lz);
        }
        
        // Check neighbor chunk
        if (getNeighborVoxel) {
            const [originX, originY, originZ] = chunk.getWorldOrigin();
            return getNeighborVoxel(originX + lx, originY + ly, originZ + lz);
        }
        
        return MATERIAL.AIR;
    };
    
    // Helper to check if position is inside chunk bounds
    const isInsideChunk = (lx, ly, lz) => {
        return lx >= 0 && lx < CHUNK_SIZE &&
               ly >= 0 && ly < CHUNK_SIZE &&
               lz >= 0 && lz < CHUNK_SIZE;
    };
    
    // For water at chunk boundaries, we need to check if neighbor lookup is reliable
    // Returns true if we should definitely generate a face (neighbor is confirmed AIR)
    const shouldShowWaterFace = (lx, ly, lz, neighborMat) => {
        // If neighbor is inside the chunk, we know for sure it's AIR
        if (isInsideChunk(lx, ly, lz)) {
            return neighborMat === MATERIAL.AIR;
        }
        // For chunk boundary checks: only show face if neighbor confirmed as AIR
        // and getNeighborVoxel was provided (meaning neighbor chunk exists)
        return getNeighborVoxel && neighborMat === MATERIAL.AIR;
    };
    
    // Helper to check if voxel is solid (for AO)
    const isSolid = (lx, ly, lz) => getVoxel(lx, ly, lz) !== MATERIAL.AIR;
    
    // Helper to check if a face should be visible
    // Opaque blocks: visible if neighbor is air OR transparent
    // Transparent blocks: visible if neighbor is air (not other transparent)
    const shouldShowFace = (material, neighborMat) => {
        if (neighborMat === MATERIAL.AIR) return true;
        
        const isTransparent = TRANSPARENT_MATERIALS.has(material);
        const neighborTransparent = TRANSPARENT_MATERIALS.has(neighborMat);
        
        // Opaque sees through transparent
        if (!isTransparent && neighborTransparent) return true;
        
        // Transparent doesn't render internal faces (same type)
        // But renders faces against opaque
        if (isTransparent && !neighborTransparent) return true;
        
        return false;
    };
    
    // Simple per-voxel face generation with AO
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const material = getVoxel(lx, ly, lz);
                if (material === MATERIAL.AIR) continue;
                
                // Choose the appropriate mesh builder
                const isTransparent = TRANSPARENT_MATERIALS.has(material);
                const builder = isTransparent ? waterMeshBuilder : meshBuilder;
                
                // For water: render TOP surface and SIDE faces where water meets air
                // Skip internal water-water faces and water-solid faces (seen through transparency)
                // Use shouldShowWaterFace to avoid generating faces at uncertain chunk boundaries
                if (isTransparent) {
                    // Top face (water surface where it meets air)
                    // Always check top face - most important for water surface visibility
                    const py = getVoxel(lx, ly + 1, lz);
                    if (shouldShowWaterFace(lx, ly + 1, lz, py)) {
                        builder.addQuad(lx, ly + 1, lz, 1, 1, FACE_TOP, material, [1,1,1,1]);
                    }
                    // Side faces only where water DEFINITELY meets air (visible water edges)
                    // Conservative at chunk boundaries to avoid Z-fighting with neighbor chunks
                    const nx = getVoxel(lx + 1, ly, lz);
                    if (shouldShowWaterFace(lx + 1, ly, lz, nx)) {
                        builder.addQuad(lx + 1, ly, lz, 1, 1, FACE_RIGHT, material, [1,1,1,1]);
                    }
                    const nnx = getVoxel(lx - 1, ly, lz);
                    if (shouldShowWaterFace(lx - 1, ly, lz, nnx)) {
                        builder.addQuad(lx, ly, lz, 1, 1, FACE_LEFT, material, [1,1,1,1]);
                    }
                    const pz = getVoxel(lx, ly, lz + 1);
                    if (shouldShowWaterFace(lx, ly, lz + 1, pz)) {
                        builder.addQuad(lx, ly, lz + 1, 1, 1, FACE_FRONT, material, [1,1,1,1]);
                    }
                    const nz = getVoxel(lx, ly, lz - 1);
                    if (shouldShowWaterFace(lx, ly, lz - 1, nz)) {
                        builder.addQuad(lx, ly, lz, 1, 1, FACE_BACK, material, [1,1,1,1]);
                    }
                    // Skip bottom face (not usually visible)
                    continue;
                }
                
                // Check each face and calculate AO (opaque materials only)
                // Skip boundary faces if neighbor chunk face is fully solid (occluded)
                const lastIdx = CHUNK_SIZE - 1;
                
                // +X face (skip if at boundary and +X direction is occluded)
                if (!(lx === lastIdx && (occludedFaces & (1 << FACE_RIGHT)))) {
                    const nx = getVoxel(lx + 1, ly, lz);
                    if (shouldShowFace(material, nx)) {
                        const ao = getFaceAO(isSolid, lx + 1, ly, lz, FACE_RIGHT);
                        builder.addQuad(lx + 1, ly, lz, 1, 1, FACE_RIGHT, material, ao);
                    }
                }
                // -X face (skip if at boundary and -X direction is occluded)
                if (!(lx === 0 && (occludedFaces & (1 << FACE_LEFT)))) {
                    const nnx = getVoxel(lx - 1, ly, lz);
                    if (shouldShowFace(material, nnx)) {
                        const ao = getFaceAO(isSolid, lx, ly, lz, FACE_LEFT);
                        builder.addQuad(lx, ly, lz, 1, 1, FACE_LEFT, material, ao);
                    }
                }
                // +Y face (skip if at boundary and +Y direction is occluded)
                if (!(ly === lastIdx && (occludedFaces & (1 << FACE_TOP)))) {
                    const py = getVoxel(lx, ly + 1, lz);
                    if (shouldShowFace(material, py)) {
                        const ao = getFaceAO(isSolid, lx, ly + 1, lz, FACE_TOP);
                        builder.addQuad(lx, ly + 1, lz, 1, 1, FACE_TOP, material, ao);
                    }
                }
                // -Y face (skip if at boundary and -Y direction is occluded)
                if (!(ly === 0 && (occludedFaces & (1 << FACE_BOTTOM)))) {
                    const ny = getVoxel(lx, ly - 1, lz);
                    if (shouldShowFace(material, ny)) {
                        const ao = getFaceAO(isSolid, lx, ly, lz, FACE_BOTTOM);
                        builder.addQuad(lx, ly, lz, 1, 1, FACE_BOTTOM, material, ao);
                    }
                }
                // +Z face (skip if at boundary and +Z direction is occluded)
                if (!(lz === lastIdx && (occludedFaces & (1 << FACE_FRONT)))) {
                    const pz = getVoxel(lx, ly, lz + 1);
                    if (shouldShowFace(material, pz)) {
                        const ao = getFaceAO(isSolid, lx, ly, lz + 1, FACE_FRONT);
                        builder.addQuad(lx, ly, lz + 1, 1, 1, FACE_FRONT, material, ao);
                    }
                }
                // -Z face (skip if at boundary and -Z direction is occluded)
                if (!(lz === 0 && (occludedFaces & (1 << FACE_BACK)))) {
                    const nz = getVoxel(lx, ly, lz - 1);
                    if (shouldShowFace(material, nz)) {
                        const ao = getFaceAO(isSolid, lx, ly, lz, FACE_BACK);
                        builder.addQuad(lx, ly, lz, 1, 1, FACE_BACK, material, ao);
                    }
                }
            }
        }
    }
    
    // Get both opaque and water mesh data
    const opaqueMesh = meshBuilder.getArrays();
    const waterMesh = waterMeshBuilder.getArrays();
    
    return {
        vertices: opaqueMesh.vertices,
        indices: opaqueMesh.indices,
        vertexCount: opaqueMesh.vertexCount,
        indexCount: opaqueMesh.indexCount,
        waterVertices: waterMesh.vertices,
        waterIndices: waterMesh.indices,
        waterVertexCount: waterMesh.vertexCount,
        waterIndexCount: waterMesh.indexCount,
    };
}

/**
 * Generate LOD mesh with reduced detail and proper transition geometry
 * @param {VoxelChunk} chunk 
 * @param {number} lodLevel - 0-9, gradual detail reduction
 *   LOD 0-1: step 1 (32 blocks/axis, full detail)
 *   LOD 2-3: step 2 (16 blocks/axis)
 *   LOD 4-5: step 3 (10 blocks/axis)
 *   LOD 6:   step 4 (8 blocks/axis)
 *   LOD 7:   step 5 (6 blocks/axis)
 *   LOD 8:   step 6 (5 blocks/axis)
 *   LOD 9:   step 8 (4 blocks/axis)
 * @param {Function} getNeighborVoxel - Function to get voxel from neighbor chunks
 * @param {Object} neighborLODs - LOD levels of neighbor chunks: { posX, negX, posY, negY, posZ, negZ }
 * @returns {{ vertices: Float32Array, indices: Uint32Array, vertexCount: number, indexCount: number }}
 */

// 10-level LOD step sizes for gradual detail reduction
const LOD_STEP_SIZES = [1, 1, 2, 2, 3, 3, 4, 5, 6, 8];

export function meshChunkLOD(chunk, lodLevel = 0, getNeighborVoxel = null, neighborLODs = null) {
    // LOD 0 and 1 use full detail meshing
    if (lodLevel <= 1) {
        return meshChunk(chunk, getNeighborVoxel);
    }
    
    meshBuilder.reset();
    
    // Fast path: homogeneous AIR chunks need no mesh
    if (chunk.isHomogeneous && chunk.homogeneousMaterial === MATERIAL.AIR) {
        return {
            vertices: new Float32Array(0),
            indices: new Uint32Array(0),
            vertexCount: 0,
            indexCount: 0,
        };
    }
    
    // Handle homogeneous chunks - use function to get material
    const getLocalVoxel = chunk.isHomogeneous
        ? () => chunk.homogeneousMaterial
        : (lx, ly, lz) => chunk.voxels[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ];
    
    // Get step size for this LOD level (clamped to valid range)
    const step = LOD_STEP_SIZES[Math.min(lodLevel, 9)] || 1;
    const lodSize = Math.floor(CHUNK_SIZE / step);
    
    // Determine which boundaries need transition geometry
    // Transition is needed when neighbor has finer detail (lower LOD number)
    const needsTransition = {
        posX: neighborLODs && neighborLODs.posX !== null && neighborLODs.posX < lodLevel,
        negX: neighborLODs && neighborLODs.negX !== null && neighborLODs.negX < lodLevel,
        posY: neighborLODs && neighborLODs.posY !== null && neighborLODs.posY < lodLevel,
        negY: neighborLODs && neighborLODs.negY !== null && neighborLODs.negY < lodLevel,
        posZ: neighborLODs && neighborLODs.posZ !== null && neighborLODs.posZ < lodLevel,
        negZ: neighborLODs && neighborLODs.negZ !== null && neighborLODs.negZ < lodLevel,
    };
    
    // Helper to get voxel (handles chunk boundaries)
    const getVoxel = (lx, ly, lz) => {
        if (lx >= 0 && lx < CHUNK_SIZE &&
            ly >= 0 && ly < CHUNK_SIZE &&
            lz >= 0 && lz < CHUNK_SIZE) {
            return getLocalVoxel(lx, ly, lz);
        }
        if (getNeighborVoxel) {
            const [originX, originY, originZ] = chunk.getWorldOrigin();
            return getNeighborVoxel(originX + lx, originY + ly, originZ + lz);
        }
        return MATERIAL.AIR;
    };
    
    // Sample dominant material in each LOD block
    const getDominantMaterial = (bx, by, bz) => {
        const counts = {};
        let maxCount = 0;
        let dominant = MATERIAL.AIR;
        
        for (let dz = 0; dz < step; dz++) {
            for (let dy = 0; dy < step; dy++) {
                for (let dx = 0; dx < step; dx++) {
                    const mat = getVoxel(bx * step + dx, by * step + dy, bz * step + dz);
                    if (mat !== MATERIAL.AIR) {
                        counts[mat] = (counts[mat] || 0) + 1;
                        if (counts[mat] > maxCount) {
                            maxCount = counts[mat];
                            dominant = mat;
                        }
                    }
                }
            }
        }
        return dominant;
    };
    
    // Check if LOD block is solid (any voxel solid)
    const isBlockSolid = (bx, by, bz) => {
        for (let dz = 0; dz < step; dz++) {
            for (let dy = 0; dy < step; dy++) {
                for (let dx = 0; dx < step; dx++) {
                    if (getVoxel(bx * step + dx, by * step + dy, bz * step + dz) !== MATERIAL.AIR) {
                        return true;
                    }
                }
            }
        }
        return false;
    };
    
    // Check if neighbor LOD block is solid
    // For boundary cells, we let through to generate faces but handle transitions separately
    const isNeighborSolid = (bx, by, bz) => {
        if (bx < 0 || bx >= lodSize || by < 0 || by >= lodSize || bz < 0 || bz >= lodSize) {
            return false; // Out of bounds = not solid, will generate boundary face
        }
        return isBlockSolid(bx, by, bz);
    };
    
    // Generate faces for LOD blocks (interior cells)
    for (let bz = 0; bz < lodSize; bz++) {
        for (let by = 0; by < lodSize; by++) {
            for (let bx = 0; bx < lodSize; bx++) {
                if (!isBlockSolid(bx, by, bz)) continue;
                
                const material = getDominantMaterial(bx, by, bz);
                const x = bx * step;
                const y = by * step;
                const z = bz * step;
                
                // +X face
                if (!isNeighborSolid(bx + 1, by, bz)) {
                    if (bx === lodSize - 1 && needsTransition.posX) {
                        // Transition: generate fine-resolution faces on boundary
                        generateTransitionFaces(meshBuilder, getVoxel, x + step, y, z, step, FACE_RIGHT, material, lodLevel);
                    } else {
                        meshBuilder.addQuad(x + step, y, z, step, step, FACE_RIGHT, material);
                    }
                }
                // -X face
                if (!isNeighborSolid(bx - 1, by, bz)) {
                    if (bx === 0 && needsTransition.negX) {
                        generateTransitionFaces(meshBuilder, getVoxel, x, y, z, step, FACE_LEFT, material, lodLevel);
                    } else {
                        meshBuilder.addQuad(x, y, z, step, step, FACE_LEFT, material);
                    }
                }
                // +Y face (top)
                if (!isNeighborSolid(bx, by + 1, bz)) {
                    if (by === lodSize - 1 && needsTransition.posY) {
                        generateTransitionFaces(meshBuilder, getVoxel, x, y + step, z, step, FACE_TOP, material, lodLevel);
                    } else {
                        meshBuilder.addQuad(x, y + step, z, step, step, FACE_TOP, material);
                    }
                }
                // -Y face (bottom)
                if (!isNeighborSolid(bx, by - 1, bz)) {
                    if (by === 0 && needsTransition.negY) {
                        generateTransitionFaces(meshBuilder, getVoxel, x, y, z, step, FACE_BOTTOM, material, lodLevel);
                    } else {
                        meshBuilder.addQuad(x, y, z, step, step, FACE_BOTTOM, material);
                    }
                }
                // +Z face
                if (!isNeighborSolid(bx, by, bz + 1)) {
                    if (bz === lodSize - 1 && needsTransition.posZ) {
                        generateTransitionFaces(meshBuilder, getVoxel, x, y, z + step, step, FACE_FRONT, material, lodLevel);
                    } else {
                        meshBuilder.addQuad(x, y, z + step, step, step, FACE_FRONT, material);
                    }
                }
                // -Z face
                if (!isNeighborSolid(bx, by, bz - 1)) {
                    if (bz === 0 && needsTransition.negZ) {
                        generateTransitionFaces(meshBuilder, getVoxel, x, y, z, step, FACE_BACK, material, lodLevel);
                    } else {
                        meshBuilder.addQuad(x, y, z, step, step, FACE_BACK, material);
                    }
                }
            }
        }
    }
    
    return meshBuilder.getArrays();
}

/**
 * Generate transition faces that connect coarse LOD cells to fine-resolution boundary.
 * Instead of one large quad, generates multiple smaller quads matching the finer LOD.
 * @param {MeshBuilder} builder
 * @param {Function} getVoxel - Function to sample voxels at full resolution
 * @param {number} x - World-space X of the face
 * @param {number} y - World-space Y of the face
 * @param {number} z - World-space Z of the face
 * @param {number} step - LOD step size (2 for LOD1, 4 for LOD2)
 * @param {number} face - Face direction constant
 * @param {number} fallbackMaterial - Material to use if voxel lookup fails
 * @param {number} lodLevel - Current LOD level (1 or 2)
 */
function generateTransitionFaces(builder, getVoxel, x, y, z, step, face, fallbackMaterial, lodLevel) {
    // For transition, we subdivide the coarse cell into fine cells matching the neighbor
    // LOD1 (step=2) -> subdivide into 2x2 = 4 faces
    // LOD2 (step=4) -> subdivide into 4x4 = 16 faces
    const subdivisions = step; // Match the step size for full resolution boundary
    const subSize = 1; // Each sub-face is 1x1 voxel
    
    // Determine which axes to iterate based on face direction
    switch (face) {
        case FACE_RIGHT: // +X - iterate over Y and Z
        case FACE_LEFT:  // -X
            for (let dy = 0; dy < subdivisions; dy++) {
                for (let dz = 0; dz < subdivisions; dz++) {
                    // Sample the actual voxel at this fine position
                    const sampleX = face === FACE_RIGHT ? x - 1 : x;
                    const voxel = getVoxel(sampleX, y + dy, z + dz);
                    const mat = voxel !== 0 ? voxel : fallbackMaterial;
                    builder.addQuad(x, y + dy, z + dz, subSize, subSize, face, mat);
                }
            }
            break;
            
        case FACE_TOP:    // +Y - iterate over X and Z
        case FACE_BOTTOM: // -Y
            for (let dx = 0; dx < subdivisions; dx++) {
                for (let dz = 0; dz < subdivisions; dz++) {
                    const sampleY = face === FACE_TOP ? y - 1 : y;
                    const voxel = getVoxel(x + dx, sampleY, z + dz);
                    const mat = voxel !== 0 ? voxel : fallbackMaterial;
                    builder.addQuad(x + dx, y, z + dz, subSize, subSize, face, mat);
                }
            }
            break;
            
        case FACE_FRONT: // +Z - iterate over X and Y
        case FACE_BACK:  // -Z
            for (let dx = 0; dx < subdivisions; dx++) {
                for (let dy = 0; dy < subdivisions; dy++) {
                    const sampleZ = face === FACE_FRONT ? z - 1 : z;
                    const voxel = getVoxel(x + dx, y + dy, sampleZ);
                    const mat = voxel !== 0 ? voxel : fallbackMaterial;
                    builder.addQuad(x + dx, y + dy, z, subSize, subSize, face, mat);
                }
            }
            break;
    }
}

/**
 * Generate mesh using greedy meshing (fewer quads, better performance)
 * Note: Currently does not separate water - falls back to simple meshing for chunks with water
 * @param {VoxelChunk} chunk 
 * @param {Function} getNeighborVoxel - Function to get voxel from neighbor chunks
 * @returns {{ vertices: Float32Array, indices: Uint32Array, vertexCount: number, indexCount: number, waterVertices: Float32Array, waterIndices: Uint32Array, waterVertexCount: number, waterIndexCount: number }}
 */
export function meshChunkGreedy(chunk, getNeighborVoxel = null) {
    // Check if chunk has water - if so, use simple meshing for proper water separation
    // TODO: Implement greedy meshing with water separation
    if (!chunk.isHomogeneous && chunk.voxels) {
        for (let i = 0; i < chunk.voxels.length; i++) {
            if (TRANSPARENT_MATERIALS.has(chunk.voxels[i])) {
                // Fall back to simple meshing for water separation
                return meshChunk(chunk, getNeighborVoxel);
            }
        }
    }
    
    meshBuilder.reset();
    
    // Fast path: homogeneous AIR chunks need no mesh
    if (chunk.isHomogeneous && chunk.homogeneousMaterial === MATERIAL.AIR) {
        return {
            vertices: new Float32Array(0),
            indices: new Uint32Array(0),
            vertexCount: 0,
            indexCount: 0,
            waterVertices: new Float32Array(0),
            waterIndices: new Uint32Array(0),
            waterVertexCount: 0,
            waterIndexCount: 0,
        };
    }
    
    // For greedy meshing, we need voxels array - expand if homogeneous
    if (chunk.isHomogeneous) {
        chunk.expand();
    }
    
    const voxels = chunk.voxels;
    
    // Helper to get voxel (handles chunk boundaries)
    const getVoxel = (lx, ly, lz) => {
        if (lx >= 0 && lx < CHUNK_SIZE &&
            ly >= 0 && ly < CHUNK_SIZE &&
            lz >= 0 && lz < CHUNK_SIZE) {
            return voxels[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ];
        }
        
        // Check neighbor chunk
        if (getNeighborVoxel) {
            const [originX, originY, originZ] = chunk.getWorldOrigin();
            return getNeighborVoxel(originX + lx, originY + ly, originZ + lz);
        }
        
        return MATERIAL.AIR;
    };
    
    // Process each axis direction with greedy meshing
    meshAxisY(meshBuilder, voxels, getVoxel);
    meshAxisX(meshBuilder, voxels, getVoxel);
    meshAxisZ(meshBuilder, voxels, getVoxel);
    
    // Return with empty water arrays (greedy meshing doesn't handle water - we fall back above)
    const opaqueMesh = meshBuilder.getArrays();
    return {
        vertices: opaqueMesh.vertices,
        indices: opaqueMesh.indices,
        vertexCount: opaqueMesh.vertexCount,
        indexCount: opaqueMesh.indexCount,
        waterVertices: new Float32Array(0),
        waterIndices: new Uint32Array(0),
        waterVertexCount: 0,
        waterIndexCount: 0,
    };
}

/**
 * Check if a material is "see-through" (air or transparent)
 * Used by greedy meshing to determine when opaque faces should be generated
 */
function isSeeThrough(material) {
    return material === MATERIAL.AIR || TRANSPARENT_MATERIALS.has(material);
}

/**
 * Check if we should generate a face between two materials
 * Face is generated when: opaque solid meets air/transparent
 */
function shouldGenerateFace(solidMat, neighborMat) {
    // Solid must be opaque (not air, not transparent)
    if (solidMat === MATERIAL.AIR || TRANSPARENT_MATERIALS.has(solidMat)) {
        return false;
    }
    // Neighbor must be see-through (air or transparent)
    return isSeeThrough(neighborMat);
}

/**
 * Mesh Y-axis faces (top/bottom) with per-vertex AO
 */
function meshAxisY(builder, voxels, getVoxel) {
    // Mask for greedy meshing (stores material or 0)
    const mask = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    
    // Helper to check if solid (for AO calculation)
    const isSolid = (x, y, z) => {
        const mat = getVoxel(x, y, z);
        return mat !== MATERIAL.AIR && !TRANSPARENT_MATERIALS.has(mat);
    };
    
    for (let y = 0; y <= CHUNK_SIZE; y++) {
        // Build mask for this slice
        let maskIdx = 0;
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                // Use getVoxel for boundary lookups - handles neighbor chunks (including water)
                const current = getVoxel(x, y, z);
                const below = getVoxel(x, y - 1, z);
                
                // Top face: opaque solid below, air/transparent above
                if (shouldGenerateFace(below, current)) {
                    mask[maskIdx] = below; // Store material for top face
                }
                // Bottom face: opaque solid above, air/transparent below
                else if (shouldGenerateFace(current, below)) {
                    mask[maskIdx] = -current; // Negative = bottom face
                } else {
                    mask[maskIdx] = 0;
                }
                maskIdx++;
            }
        }
        
        // Greedy mesh the mask with AO using direct neighbor sampling
        // For each corner of merged quad, sample the 3 neighbors that affect that corner
        greedyMeshMask(builder, mask, CHUNK_SIZE, CHUNK_SIZE, 
            (x, z, w, h, material) => {
                // Sample neighbors at face level (y for top, y-1 for bottom)
                const s = (px, pz, py) => isSolid(px, py, pz) ? 1 : 0;
                
                if (material > 0) {
                    // Top face - check neighbors at y level (above solid voxels at y-1)
                    // v0 at (x, z): check -X, -Z neighbors
                    // v1 at (x, z+h): check -X, +Z neighbors  
                    // v2 at (x+w, z+h): check +X, +Z neighbors
                    // v3 at (x+w, z): check +X, -Z neighbors
                    const ao = [
                        calcVertexAO(s(x-1, z, y), s(x, z-1, y), s(x-1, z-1, y)),       // v0
                        calcVertexAO(s(x-1, z+h, y), s(x, z+h+1, y), s(x-1, z+h+1, y)), // v1 (check +Z direction)
                        calcVertexAO(s(x+w, z+h, y), s(x+w-1, z+h+1, y), s(x+w, z+h+1, y)), // v2 (check +X, +Z)
                        calcVertexAO(s(x+w, z, y), s(x+w-1, z-1, y), s(x+w, z-1, y)),   // v3 (check +X, -Z)
                    ];
                    builder.addQuad(x, y, z, w, h, FACE_TOP, material, ao);
                } else {
                    // Bottom face - check neighbors at y-1 level
                    const ao = [
                        calcVertexAO(s(x-1, z+h, y-1), s(x, z+h+1, y-1), s(x-1, z+h+1, y-1)),
                        calcVertexAO(s(x-1, z, y-1), s(x, z-1, y-1), s(x-1, z-1, y-1)),
                        calcVertexAO(s(x+w, z, y-1), s(x+w-1, z-1, y-1), s(x+w, z-1, y-1)),
                        calcVertexAO(s(x+w, z+h, y-1), s(x+w-1, z+h+1, y-1), s(x+w, z+h+1, y-1)),
                    ];
                    builder.addQuad(x, y, z, w, h, FACE_BOTTOM, -material, ao);
                }
            }
        );
    }
}

/**
 * Mesh X-axis faces (left/right) with per-vertex AO
 */
function meshAxisX(builder, voxels, getVoxel) {
    const mask = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    
    const isSolid = (x, y, z) => {
        const mat = getVoxel(x, y, z);
        return mat !== MATERIAL.AIR && !TRANSPARENT_MATERIALS.has(mat);
    };
    
    for (let x = 0; x <= CHUNK_SIZE; x++) {
        let maskIdx = 0;
        for (let z = 0; z < CHUNK_SIZE; z++) {
            for (let y = 0; y < CHUNK_SIZE; y++) {
                // Use getVoxel for boundary lookups - handles neighbor chunks (including water)
                const current = getVoxel(x, y, z);
                const left = getVoxel(x - 1, y, z);
                
                // Right face (+X): opaque solid to left, air/transparent to right
                if (shouldGenerateFace(left, current)) {
                    mask[maskIdx] = left;
                }
                // Left face (-X): opaque solid to right, air/transparent to left
                else if (shouldGenerateFace(current, left)) {
                    mask[maskIdx] = -current;
                } else {
                    mask[maskIdx] = 0;
                }
                maskIdx++;
            }
        }
        
        // Greedy mesh with direct neighbor sampling for AO
        greedyMeshMask(builder, mask, CHUNK_SIZE, CHUNK_SIZE,
            (y, z, h, w, material) => {
                const s = (px, py, pz) => isSolid(px, py, pz) ? 1 : 0;
                
                if (material > 0) {
                    // Right face (+X) - check neighbors at x level
                    // v0 at (x, y, z), v1 at (x, y+h, z), v2 at (x, y+h, z+w), v3 at (x, y, z+w)
                    const ao = [
                        calcVertexAO(s(x, y-1, z), s(x, y, z-1), s(x, y-1, z-1)),       // v0: -Y, -Z
                        calcVertexAO(s(x, y+h, z), s(x, y+h-1, z-1), s(x, y+h, z-1)),   // v1: +Y, -Z
                        calcVertexAO(s(x, y+h, z+w), s(x, y+h-1, z+w+1), s(x, y+h, z+w+1)), // v2: +Y, +Z
                        calcVertexAO(s(x, y-1, z+w), s(x, y, z+w+1), s(x, y-1, z+w+1)), // v3: -Y, +Z
                    ];
                    builder.addQuad(x, y, z, w, h, FACE_RIGHT, material, ao);
                } else {
                    // Left face (-X) - check neighbors at x-1 level
                    const ao = [
                        calcVertexAO(s(x-1, y-1, z+w), s(x-1, y, z+w+1), s(x-1, y-1, z+w+1)),
                        calcVertexAO(s(x-1, y+h, z+w), s(x-1, y+h-1, z+w+1), s(x-1, y+h, z+w+1)),
                        calcVertexAO(s(x-1, y+h, z), s(x-1, y+h-1, z-1), s(x-1, y+h, z-1)),
                        calcVertexAO(s(x-1, y-1, z), s(x-1, y, z-1), s(x-1, y-1, z-1)),
                    ];
                    builder.addQuad(x, y, z, w, h, FACE_LEFT, -material, ao);
                }
            }
        );
    }
}

/**
 * Mesh Z-axis faces (front/back) with per-vertex AO
 */
function meshAxisZ(builder, voxels, getVoxel) {
    const mask = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    
    const isSolid = (x, y, z) => {
        const mat = getVoxel(x, y, z);
        return mat !== MATERIAL.AIR && !TRANSPARENT_MATERIALS.has(mat);
    };
    
    for (let z = 0; z <= CHUNK_SIZE; z++) {
        let maskIdx = 0;
        for (let y = 0; y < CHUNK_SIZE; y++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                // Use getVoxel for boundary lookups - handles neighbor chunks (including water)
                const current = getVoxel(x, y, z);
                const back = getVoxel(x, y, z - 1);
                
                // Front face (+Z): opaque solid behind, air/transparent in front
                if (shouldGenerateFace(back, current)) {
                    mask[maskIdx] = back;
                }
                // Back face (-Z): opaque solid in front, air/transparent behind  
                else if (shouldGenerateFace(current, back)) {
                    mask[maskIdx] = -current;
                } else {
                    mask[maskIdx] = 0;
                }
                maskIdx++;
            }
        }
        
        // Greedy mesh with direct neighbor sampling for AO
        greedyMeshMask(builder, mask, CHUNK_SIZE, CHUNK_SIZE,
            (x, y, w, h, material) => {
                const s = (px, py, pz) => isSolid(px, py, pz) ? 1 : 0;
                
                if (material > 0) {
                    // Front face (+Z) - check neighbors at z level
                    // v0 at (x+w, y, z), v1 at (x+w, y+h, z), v2 at (x, y+h, z), v3 at (x, y, z)
                    const ao = [
                        calcVertexAO(s(x+w, y-1, z), s(x+w+1, y, z), s(x+w+1, y-1, z)), // v0: +X, -Y
                        calcVertexAO(s(x+w, y+h, z), s(x+w+1, y+h-1, z), s(x+w+1, y+h, z)), // v1: +X, +Y
                        calcVertexAO(s(x-1, y+h, z), s(x, y+h-1, z), s(x-1, y+h, z)),   // v2: -X, +Y
                        calcVertexAO(s(x-1, y-1, z), s(x, y, z), s(x-1, y, z)),         // v3: -X, -Y
                    ];
                    builder.addQuad(x, y, z, w, h, FACE_FRONT, material, ao);
                } else {
                    // Back face (-Z) - check neighbors at z-1 level
                    const ao = [
                        calcVertexAO(s(x-1, y-1, z-1), s(x, y, z-1), s(x-1, y, z-1)),
                        calcVertexAO(s(x-1, y+h, z-1), s(x, y+h-1, z-1), s(x-1, y+h-1, z-1)),
                        calcVertexAO(s(x+w, y+h, z-1), s(x+w+1, y+h-1, z-1), s(x+w+1, y+h, z-1)),
                        calcVertexAO(s(x+w, y-1, z-1), s(x+w+1, y, z-1), s(x+w+1, y-1, z-1)),
                    ];
                    builder.addQuad(x, y, z, w, h, FACE_BACK, -material, ao);
                }
            }
        );
    }
}

/**
 * Greedy mesh a 2D mask
 * @param {MeshBuilder} builder 
 * @param {Int32Array} mask - 2D mask (width * height)
 * @param {number} width 
 * @param {number} height 
 * @param {Function} emitQuad - (x, y, w, h, material) => void
 */
function greedyMeshMask(builder, mask, width, height, emitQuad) {
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; ) {
            const idx = i + j * width;
            const material = mask[idx];
            
            if (material === 0) {
                i++;
                continue;
            }
            
            // Find width of quad (same material in row)
            let w = 1;
            while (i + w < width && mask[idx + w] === material) {
                w++;
            }
            
            // Find height of quad (same material in column)
            let h = 1;
            let done = false;
            while (j + h < height && !done) {
                for (let k = 0; k < w; k++) {
                    if (mask[i + k + (j + h) * width] !== material) {
                        done = true;
                        break;
                    }
                }
                if (!done) h++;
            }
            
            // Emit the quad
            emitQuad(i, j, w, h, material);
            
            // Clear the mask region
            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    mask[i + dx + (j + dy) * width] = 0;
                }
            }
            
            i += w;
        }
    }
}

// ============================================================================
// GPU BUFFER CREATION
// ============================================================================

/**
 * Create GPU buffers for chunk mesh (both opaque and water)
 * @param {GPUDevice} device 
 * @param {VoxelChunk} chunk 
 * @param {{ vertices: Float32Array, indices: Uint32Array, waterVertices?: Float32Array, waterIndices?: Uint32Array }} meshData 
 */
export function createChunkBuffers(device, chunk, meshData) {
    // Initialize pool if needed
    if (!gpuBufferPool.device) {
        gpuBufferPool.init(device);
    }
    
    // Release old buffers back to pool
    if (chunk.vertexBuffer && chunk._vertexPoolSize) {
        gpuBufferPool.releaseVertex(chunk.vertexBuffer, chunk._vertexPoolSize);
    }
    if (chunk.indexBuffer && chunk._indexPoolSize) {
        gpuBufferPool.releaseIndex(chunk.indexBuffer, chunk._indexPoolSize);
    }
    if (chunk.waterVertexBuffer && chunk._waterVertexPoolSize) {
        gpuBufferPool.releaseVertex(chunk.waterVertexBuffer, chunk._waterVertexPoolSize);
    }
    if (chunk.waterIndexBuffer && chunk._waterIndexPoolSize) {
        gpuBufferPool.releaseIndex(chunk.waterIndexBuffer, chunk._waterIndexPoolSize);
    }
    
    // Clear references
    chunk.vertexBuffer = null;
    chunk.indexBuffer = null;
    chunk.waterVertexBuffer = null;
    chunk.waterIndexBuffer = null;
    
    // ========================================
    // OPAQUE GEOMETRY
    // ========================================
    if (meshData.vertexCount === 0) {
        chunk.vertexCount = 0;
        chunk.indexCount = 0;
        chunk._vertexPoolSize = 0;
        chunk._indexPoolSize = 0;
    } else {
        // Acquire vertex buffer from pool
        const vbResult = gpuBufferPool.acquireVertex(meshData.vertices.byteLength);
        chunk.vertexBuffer = vbResult.buffer;
        chunk._vertexPoolSize = vbResult.poolSize;
        device.queue.writeBuffer(chunk.vertexBuffer, 0, meshData.vertices);
        
        // Use 16-bit indices if vertex count fits (50% index buffer savings!)
        const canUse16Bit = meshData.vertexCount <= 65535;
        let indexData = meshData.indices;
        
        if (canUse16Bit && meshData.indices instanceof Uint32Array) {
            // Convert to 16-bit indices - halves index buffer size
            indexData = new Uint16Array(meshData.indices);
        }
        
        // Acquire index buffer from pool
        const ibResult = gpuBufferPool.acquireIndex(indexData.byteLength);
        chunk.indexBuffer = ibResult.buffer;
        chunk._indexPoolSize = ibResult.poolSize;
        chunk._uses16BitIndices = canUse16Bit;
        device.queue.writeBuffer(chunk.indexBuffer, 0, indexData);
        
        chunk.vertexCount = meshData.vertexCount;
        chunk.indexCount = meshData.indexCount;
        // DON'T store mesh data in RAM - GPU has it
    }
    
    // ========================================
    // WATER/TRANSPARENT GEOMETRY
    // ========================================
    if (meshData.waterVertexCount && meshData.waterVertexCount > 0) {
        // Acquire water vertex buffer from pool
        const wvbResult = gpuBufferPool.acquireVertex(meshData.waterVertices.byteLength);
        chunk.waterVertexBuffer = wvbResult.buffer;
        chunk._waterVertexPoolSize = wvbResult.poolSize;
        device.queue.writeBuffer(chunk.waterVertexBuffer, 0, meshData.waterVertices);
        
        // Use 16-bit indices for water if possible
        const canUse16BitWater = meshData.waterVertexCount <= 65535;
        let waterIndexData = meshData.waterIndices;
        
        if (canUse16BitWater && meshData.waterIndices instanceof Uint32Array) {
            waterIndexData = new Uint16Array(meshData.waterIndices);
        }
        
        // Acquire water index buffer from pool
        const wibResult = gpuBufferPool.acquireIndex(waterIndexData.byteLength);
        chunk.waterIndexBuffer = wibResult.buffer;
        chunk._waterIndexPoolSize = wibResult.poolSize;
        chunk._waterUses16BitIndices = canUse16BitWater;
        device.queue.writeBuffer(chunk.waterIndexBuffer, 0, waterIndexData);
        
        chunk.waterVertexCount = meshData.waterVertexCount;
        chunk.waterIndexCount = meshData.waterIndexCount;
    } else {
        chunk.waterVertexBuffer = null;
        chunk.waterIndexBuffer = null;
        chunk.waterVertexCount = 0;
        chunk.waterIndexCount = 0;
        chunk._waterVertexPoolSize = 0;
        chunk._waterIndexPoolSize = 0;
    }
}

// ============================================================================
// SUB-CHUNK MESHING (CASCADED CHUNK ARCHITECTURE)
// ============================================================================

// Reusable mesh builder for sub-chunks (smaller capacity)
const subMeshBuilder = new MeshBuilder(4096);

/**
 * Mesh a sub-region of a chunk (8³ or 16³)
 * Used for ultra-fast partial updates in cascaded chunk architecture
 * @param {VoxelChunk} chunk - Parent 32³ chunk
 * @param {number} subSize - Sub-chunk size (8 or 16)
 * @param {number} sx - Sub-chunk X index (0-3 for 8³, 0-1 for 16³)
 * @param {number} sy - Sub-chunk Y index
 * @param {number} sz - Sub-chunk Z index
 * @param {Function} getNeighborVoxel - Function to get voxel from neighbor chunks
 * @returns {{ vertices: Float32Array, indices: Uint32Array, vertexCount: number, indexCount: number }}
 */
export function meshSubChunk(chunk, subSize, sx, sy, sz, getNeighborVoxel = null) {
    subMeshBuilder.reset();
    
    // Calculate local bounds within the 32³ chunk
    const startX = sx * subSize;
    const startY = sy * subSize;
    const startZ = sz * subSize;
    const endX = startX + subSize;
    const endY = startY + subSize;
    const endZ = startZ + subSize;
    
    // Fast path: homogeneous AIR chunks need no mesh
    if (chunk.isHomogeneous && chunk.homogeneousMaterial === MATERIAL.AIR) {
        return {
            vertices: new Float32Array(0),
            indices: new Uint32Array(0),
            vertexCount: 0,
            indexCount: 0,
        };
    }
    
    // Handle homogeneous chunks
    const getLocalVoxel = chunk.isHomogeneous
        ? () => chunk.homogeneousMaterial
        : (lx, ly, lz) => chunk.voxels[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ];
    
    // Helper to get voxel (handles chunk boundaries)
    const getVoxel = (lx, ly, lz) => {
        if (lx >= 0 && lx < CHUNK_SIZE &&
            ly >= 0 && ly < CHUNK_SIZE &&
            lz >= 0 && lz < CHUNK_SIZE) {
            return getLocalVoxel(lx, ly, lz);
        }
        if (getNeighborVoxel) {
            const [originX, originY, originZ] = chunk.getWorldOrigin();
            return getNeighborVoxel(originX + lx, originY + ly, originZ + lz);
        }
        return MATERIAL.AIR;
    };
    
    // Helper to check if voxel is solid (for AO)
    const isSolid = (lx, ly, lz) => getVoxel(lx, ly, lz) !== MATERIAL.AIR;
    
    // Helper to check if a face should be visible
    const shouldShowFace = (material, neighborMat) => {
        if (neighborMat === MATERIAL.AIR) return true;
        const isTransparent = TRANSPARENT_MATERIALS.has(material);
        const neighborTransparent = TRANSPARENT_MATERIALS.has(neighborMat);
        if (!isTransparent && neighborTransparent) return true;
        if (isTransparent && !neighborTransparent) return true;
        return false;
    };
    
    // Iterate only the sub-chunk region
    for (let lz = startZ; lz < endZ; lz++) {
        for (let ly = startY; ly < endY; ly++) {
            for (let lx = startX; lx < endX; lx++) {
                const material = getVoxel(lx, ly, lz);
                if (material === MATERIAL.AIR) continue;
                
                // Skip transparent materials for now (handle separately)
                if (TRANSPARENT_MATERIALS.has(material)) continue;
                
                // Check each face
                // +X
                if (shouldShowFace(material, getVoxel(lx + 1, ly, lz))) {
                    const ao = getFaceAO(isSolid, lx + 1, ly, lz, FACE_RIGHT);
                    subMeshBuilder.addQuad(lx + 1, ly, lz, 1, 1, FACE_RIGHT, material, ao);
                }
                // -X
                if (shouldShowFace(material, getVoxel(lx - 1, ly, lz))) {
                    const ao = getFaceAO(isSolid, lx, ly, lz, FACE_LEFT);
                    subMeshBuilder.addQuad(lx, ly, lz, 1, 1, FACE_LEFT, material, ao);
                }
                // +Y
                if (shouldShowFace(material, getVoxel(lx, ly + 1, lz))) {
                    const ao = getFaceAO(isSolid, lx, ly + 1, lz, FACE_TOP);
                    subMeshBuilder.addQuad(lx, ly + 1, lz, 1, 1, FACE_TOP, material, ao);
                }
                // -Y
                if (shouldShowFace(material, getVoxel(lx, ly - 1, lz))) {
                    const ao = getFaceAO(isSolid, lx, ly, lz, FACE_BOTTOM);
                    subMeshBuilder.addQuad(lx, ly, lz, 1, 1, FACE_BOTTOM, material, ao);
                }
                // +Z
                if (shouldShowFace(material, getVoxel(lx, ly, lz + 1))) {
                    const ao = getFaceAO(isSolid, lx, ly, lz + 1, FACE_FRONT);
                    subMeshBuilder.addQuad(lx, ly, lz + 1, 1, 1, FACE_FRONT, material, ao);
                }
                // -Z
                if (shouldShowFace(material, getVoxel(lx, ly, lz - 1))) {
                    const ao = getFaceAO(isSolid, lx, ly, lz, FACE_BACK);
                    subMeshBuilder.addQuad(lx, ly, lz, 1, 1, FACE_BACK, material, ao);
                }
            }
        }
    }
    
    return subMeshBuilder.getArrays();
}

// ============================================================================
// GPU-ACCELERATED SUB-CHUNK MESHING
// ============================================================================

// GPU compute instance (set by initGPUSubChunkMeshing)
let gpuSubChunkMesher = null;

/**
 * Initialize GPU sub-chunk meshing
 * @param {GPUDevice} device - WebGPU device
 */
export async function initGPUSubChunkMeshing(device) {
    const { SubChunkMeshCompute } = await import('./SubChunkMeshCompute.js');
    gpuSubChunkMesher = new SubChunkMeshCompute();
    await gpuSubChunkMesher.init(device);
    console.log('[VoxelMesher] GPU sub-chunk meshing initialized');
}

/**
 * Check if GPU sub-chunk meshing is available
 */
export function hasGPUSubChunkMeshing() {
    return gpuSubChunkMesher !== null && gpuSubChunkMesher.initialized;
}

/**
 * Mesh a 4³ sub-chunk on GPU (10× faster than CPU)
 * @param {VoxelChunk} chunk - Parent chunk
 * @param {number} sx - Sub-chunk X offset (0-7)
 * @param {number} sy - Sub-chunk Y offset (0-7)
 * @param {number} sz - Sub-chunk Z offset (0-7)
 * @returns {Promise<{vertexBuffer, indexBuffer, indexCount}>}
 */
export async function meshSubChunk4GPU(chunk, sx, sy, sz) {
    if (!gpuSubChunkMesher) {
        throw new Error('GPU sub-chunk meshing not initialized');
    }
    return gpuSubChunkMesher.meshSubChunk4(chunk, sx, sy, sz);
}

/**
 * Mesh an 8³ sub-chunk on GPU (10× faster than CPU)
 * @param {VoxelChunk} chunk - Parent chunk
 * @param {number} sx - Sub-chunk X offset (0-3)
 * @param {number} sy - Sub-chunk Y offset (0-3)
 * @param {number} sz - Sub-chunk Z offset (0-3)
 * @returns {Promise<{vertexBuffer, indexBuffer, indexCount}>}
 */
export async function meshSubChunk8GPU(chunk, sx, sy, sz) {
    if (!gpuSubChunkMesher) {
        throw new Error('GPU sub-chunk meshing not initialized');
    }
    return gpuSubChunkMesher.meshSubChunk8(chunk, sx, sy, sz);
}

/** Return GPU sub-chunk output buffers to the engine pool. */
export function releaseGPUSubChunkMesh(mesh) {
    if (!gpuSubChunkMesher || !mesh) return false;
    gpuSubChunkMesher.returnBuffers(mesh.vertexBuffer, mesh.indexBuffer, mesh.indirectBuffer, mesh.vertexBucket, mesh.indexBucket);
    return true;
}

/**
 * Return GPU buffers to pool for reuse
 */
export function returnGPUBuffers(vertexBuffer, indexBuffer, indirectBuffer) {
    if (gpuSubChunkMesher) {
        gpuSubChunkMesher.returnBuffers(vertexBuffer, indexBuffer, indirectBuffer);
    }
}

/**
 * Get GPU sub-chunk meshing statistics
 */
export function getGPUSubChunkStats() {
    return gpuSubChunkMesher ? gpuSubChunkMesher.getStats() : null;
}

/**
 * Get mesh granularity based on distance from camera (4-Tier System)
 * @param {number} distance - Distance from camera in world units
 * @param {boolean} hasRecentModifications - True if chunk was recently modified
 * @param {number} modCount - Number of recent modifications
 * @returns {number} - Mesh granularity (4, 8, 16, or 32)
 */
export function getMeshGranularity(distance, hasRecentModifications = false, modCount = 0) {
    // TOUCHING: Ultra-close with few mods - use 4³ or instancing
    if (distance < 16 && hasRecentModifications) {
        // Use instancing for very few modifications
        if (modCount > 0 && modCount < 100) {
            return 0;  // 0 = instancing mode
        }
        return 4;  // 4³ micro-mesh (~0.05ms)
    }
    // CLOSE: Near player with modifications - 8³ updates
    if (distance < 32 && hasRecentModifications) {
        return 8;  // 8³ sub-mesh (~0.3ms)
    }
    // MEDIUM: Mid-range - 16³ meshing
    if (distance < 128) {
        return 16;  // 16³ sub-mesh (~1-2ms)
    }
    // DISTANT: Far away - full 32³ chunk meshing
    return 32;  // 32³ full mesh (~5ms)
}

export { FACE_NORMALS };
export default meshChunk;
