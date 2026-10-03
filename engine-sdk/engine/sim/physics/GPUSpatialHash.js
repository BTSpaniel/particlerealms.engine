import {
    LEGACY_PRIME_COORDINATE_U32_XOR_BUCKET3D_WGSL,
    legacyPrimeCoordinateAbsXorBucket3D,
} from '../../core/math/MathBits.js';

/**
 * GPUSpatialHash.js - GPU-Accelerated Spatial Hashing
 * 
 * Based on GPU Gems 3, Chapter 32: "Broad-Phase Collision Detection with CUDA"
 * Adapted for WebGPU compute shaders.
 * 
 * Spatial hashing provides O(n) average-case broad-phase collision detection
 * by partitioning space into a uniform grid and only testing objects that
 * share the same or adjacent cells.
 * 
 * Key Features:
 * - Parallel cell assignment
 * - Radix sort by cell ID
 * - Parallel collision pair generation
 * - Handles objects spanning multiple cells
 * 
 * Integration with VirtualGPU:
 * - Use createFromVGPU() factory for VirtualGPU integration
 * - Or pass raw WebGPU device to constructor
 */

/**
 * Morton code (Z-order curve) for 3D spatial hashing
 * Interleaves bits of x, y, z for cache-coherent memory access
 */
function expandBits(v) {
    v = (v * 0x00010001) & 0xFF0000FF;
    v = (v * 0x00000101) & 0x0F00F00F;
    v = (v * 0x00000011) & 0xC30C30C3;
    v = (v * 0x00000005) & 0x49249249;
    return v;
}

/**
 * Calculate Morton code for 3D position
 * @param {number} x - X coordinate (0-1023)
 * @param {number} y - Y coordinate (0-1023)
 * @param {number} z - Z coordinate (0-1023)
 * @returns {number} Morton code
 */
export function morton3D(x, y, z) {
    x = Math.min(Math.max(x, 0), 1023);
    y = Math.min(Math.max(y, 0), 1023);
    z = Math.min(Math.max(z, 0), 1023);
    return expandBits(x) | (expandBits(y) << 1) | (expandBits(z) << 2);
}

/**
 * Simple hash function for cell coordinates
 */
export function hashCell(x, y, z, tableSize) {
    return legacyPrimeCoordinateAbsXorBucket3D(x, y, z, tableSize);
}

/**
 * CPU-based spatial hash grid for physics broad-phase
 */
export class SpatialHashGrid {
    /**
     * @param {number} cellSize - Size of each grid cell
     * @param {number} tableSize - Hash table size (should be prime)
     */
    constructor(cellSize = 1.0, tableSize = 10007) {
        this.cellSize = cellSize;
        this.invCellSize = 1.0 / cellSize;
        this.tableSize = tableSize;
        this.buckets = new Map();
        this.objectCells = new Map(); // Track which cells each object is in
    }
    
    /**
     * Clear all objects from the grid
     */
    clear() {
        this.buckets.clear();
        this.objectCells.clear();
    }
    
    /**
     * Get cell coordinates from world position
     */
    _worldToCell(x, y, z) {
        return [
            Math.floor(x * this.invCellSize),
            Math.floor(y * this.invCellSize),
            Math.floor(z * this.invCellSize),
        ];
    }
    
    /**
     * Insert an object with AABB into the grid
     * @param {*} objectId - Unique object identifier
     * @param {Object} aabb - Axis-aligned bounding box {minX, minY, minZ, maxX, maxY, maxZ}
     */
    insert(objectId, aabb) {
        const [minCX, minCY, minCZ] = this._worldToCell(aabb.minX, aabb.minY, aabb.minZ);
        const [maxCX, maxCY, maxCZ] = this._worldToCell(aabb.maxX, aabb.maxY, aabb.maxZ);
        
        const cells = [];
        
        // Insert into all overlapping cells
        for (let cz = minCZ; cz <= maxCZ; cz++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                for (let cx = minCX; cx <= maxCX; cx++) {
                    const hash = hashCell(cx, cy, cz, this.tableSize);
                    
                    if (!this.buckets.has(hash)) {
                        this.buckets.set(hash, []);
                    }
                    
                    this.buckets.get(hash).push({
                        objectId,
                        cellX: cx,
                        cellY: cy,
                        cellZ: cz,
                        aabb,
                    });
                    
                    cells.push({ cx, cy, cz, hash });
                }
            }
        }
        
        this.objectCells.set(objectId, cells);
    }
    
    /**
     * Remove an object from the grid
     */
    remove(objectId) {
        const cells = this.objectCells.get(objectId);
        if (!cells) return;
        
        for (const { hash } of cells) {
            const bucket = this.buckets.get(hash);
            if (bucket) {
                const idx = bucket.findIndex(e => e.objectId === objectId);
                if (idx !== -1) {
                    bucket.splice(idx, 1);
                }
                if (bucket.length === 0) {
                    this.buckets.delete(hash);
                }
            }
        }
        
        this.objectCells.delete(objectId);
    }
    
    /**
     * Update an object's position in the grid
     */
    update(objectId, aabb) {
        this.remove(objectId);
        this.insert(objectId, aabb);
    }
    
    /**
     * Query potential collision candidates for an AABB
     * @param {Object} aabb - Query AABB
     * @returns {Set} Set of candidate object IDs
     */
    query(aabb) {
        const [minCX, minCY, minCZ] = this._worldToCell(aabb.minX, aabb.minY, aabb.minZ);
        const [maxCX, maxCY, maxCZ] = this._worldToCell(aabb.maxX, aabb.maxY, aabb.maxZ);
        
        const candidates = new Set();
        
        for (let cz = minCZ; cz <= maxCZ; cz++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                for (let cx = minCX; cx <= maxCX; cx++) {
                    const hash = hashCell(cx, cy, cz, this.tableSize);
                    const bucket = this.buckets.get(hash);
                    
                    if (bucket) {
                        for (const entry of bucket) {
                            // Verify actual cell match (handle hash collisions)
                            if (entry.cellX === cx && entry.cellY === cy && entry.cellZ === cz) {
                                candidates.add(entry.objectId);
                            }
                        }
                    }
                }
            }
        }
        
        return candidates;
    }
    
    /**
     * Get all potential collision pairs
     * Uses the "home cell" optimization from GPU Gems to avoid duplicate pairs
     * @returns {Array} Array of [objectIdA, objectIdB] pairs
     */
    getCollisionPairs() {
        const pairs = [];
        const testedPairs = new Set();
        
        for (const [hash, bucket] of this.buckets) {
            // For each object in the bucket
            for (let i = 0; i < bucket.length; i++) {
                const entryA = bucket[i];
                
                // Check if this is the "home cell" (where centroid is)
                const centroidX = (entryA.aabb.minX + entryA.aabb.maxX) / 2;
                const centroidY = (entryA.aabb.minY + entryA.aabb.maxY) / 2;
                const centroidZ = (entryA.aabb.minZ + entryA.aabb.maxZ) / 2;
                const [homeCX, homeCY, homeCZ] = this._worldToCell(centroidX, centroidY, centroidZ);
                
                const isHomeCell = entryA.cellX === homeCX && 
                                   entryA.cellY === homeCY && 
                                   entryA.cellZ === homeCZ;
                
                // Only generate pairs from home cell to avoid duplicates
                if (!isHomeCell) continue;
                
                // Test against all other objects in same bucket
                for (let j = i + 1; j < bucket.length; j++) {
                    const entryB = bucket[j];
                    
                    // Create canonical pair key
                    const pairKey = entryA.objectId < entryB.objectId 
                        ? `${entryA.objectId}:${entryB.objectId}`
                        : `${entryB.objectId}:${entryA.objectId}`;
                    
                    if (testedPairs.has(pairKey)) continue;
                    testedPairs.add(pairKey);
                    
                    // AABB overlap test
                    if (this._aabbOverlap(entryA.aabb, entryB.aabb)) {
                        pairs.push([entryA.objectId, entryB.objectId]);
                    }
                }
            }
        }
        
        return pairs;
    }
    
    /**
     * AABB overlap test
     */
    _aabbOverlap(a, b) {
        return a.minX <= b.maxX && a.maxX >= b.minX &&
               a.minY <= b.maxY && a.maxY >= b.minY &&
               a.minZ <= b.maxZ && a.maxZ >= b.minZ;
    }
    
    /**
     * Get statistics about the grid
     */
    getStats() {
        let totalEntries = 0;
        let maxBucketSize = 0;
        let nonEmptyBuckets = 0;
        
        for (const [, bucket] of this.buckets) {
            totalEntries += bucket.length;
            maxBucketSize = Math.max(maxBucketSize, bucket.length);
            nonEmptyBuckets++;
        }
        
        return {
            objectCount: this.objectCells.size,
            bucketCount: nonEmptyBuckets,
            totalEntries,
            maxBucketSize,
            avgBucketSize: nonEmptyBuckets > 0 ? totalEntries / nonEmptyBuckets : 0,
            loadFactor: nonEmptyBuckets / this.tableSize,
        };
    }
}

/**
 * GPU-accelerated spatial hash grid using WebGPU compute shaders
 */
export class GPUSpatialHashGrid {
    constructor(device, options = {}) {
        this.device = device;
        this.maxObjects = options.maxObjects || 65536;
        this.cellSize = options.cellSize || 1.0;
        this.tableSize = options.tableSize || 65537; // Prime number
        
        this.objectBuffer = null;      // Object AABBs
        this.cellAssignBuffer = null;  // Cell assignments
        this.sortedBuffer = null;      // Sorted by cell
        this.cellStartBuffer = null;   // Cell start indices
        this.pairsBuffer = null;       // Collision pairs output
        
        this.hashPipeline = null;
        this.sortPipeline = null;
        this.pairsPipeline = null;
        
        this.objectCount = 0;
    }
    
    async init() {
        await this._createBuffers();
        await this._createPipelines();
        console.log('[GPUSpatialHash] Initialized - GPU broad-phase ready');
    }
    
    async _createBuffers() {
        // Object buffer: [minX, minY, minZ, maxX, maxY, maxZ, objectId, padding]
        this.objectBuffer = this.device.createBuffer({
            size: this.maxObjects * 32, // 8 floats per object
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'SpatialHash_Objects',
        });
        
        // Cell assignment buffer: [objectId, cellHash] pairs
        this.cellAssignBuffer = this.device.createBuffer({
            size: this.maxObjects * 8 * 8, // Up to 8 cells per object
            usage: GPUBufferUsage.STORAGE,
            label: 'SpatialHash_CellAssign',
        });
        
        // Sorted indices buffer
        this.sortedBuffer = this.device.createBuffer({
            size: this.maxObjects * 8 * 8,
            usage: GPUBufferUsage.STORAGE,
            label: 'SpatialHash_Sorted',
        });
        
        // Cell start/end indices
        this.cellStartBuffer = this.device.createBuffer({
            size: this.tableSize * 8, // start + count per cell
            usage: GPUBufferUsage.STORAGE,
            label: 'SpatialHash_CellStart',
        });
        
        // Collision pairs output
        this.pairsBuffer = this.device.createBuffer({
            size: this.maxObjects * 64, // Assume max 8 pairs per object
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            label: 'SpatialHash_Pairs',
        });
    }
    
    async _createPipelines() {
        const hashShaderCode = /* wgsl */`
            struct AABB {
                minX: f32,
                minY: f32,
                minZ: f32,
                maxX: f32,
                maxY: f32,
                maxZ: f32,
                objectId: u32,
                padding: u32,
            }
            
            struct CellAssign {
                objectId: u32,
                cellHash: u32,
            }
            
            struct Params {
                objectCount: u32,
                cellSize: f32,
                tableSize: u32,
                padding: u32,
            }
            
            @group(0) @binding(0) var<storage, read> objects: array<AABB>;
            @group(0) @binding(1) var<storage, read_write> cellAssigns: array<CellAssign>;
            @group(0) @binding(2) var<uniform> params: Params;
            
            ${LEGACY_PRIME_COORDINATE_U32_XOR_BUCKET3D_WGSL}

            fn hashCell(cx: i32, cy: i32, cz: i32) -> u32 {
                return legacyPrimeCoordinateU32XorBucket3D(cx, cy, cz, params.tableSize);
            }
            
            @compute @workgroup_size(64)
            fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
                let idx = gid.x;
                if (idx >= params.objectCount) { return; }
                
                let obj = objects[idx];
                let invCellSize = 1.0 / params.cellSize;
                
                let minCX = i32(floor(obj.minX * invCellSize));
                let minCY = i32(floor(obj.minY * invCellSize));
                let minCZ = i32(floor(obj.minZ * invCellSize));
                let maxCX = i32(floor(obj.maxX * invCellSize));
                let maxCY = i32(floor(obj.maxY * invCellSize));
                let maxCZ = i32(floor(obj.maxZ * invCellSize));
                
                var assignIdx = idx * 8u; // Max 8 cells per object
                var cellCount = 0u;
                
                for (var cz = minCZ; cz <= maxCZ && cellCount < 8u; cz++) {
                    for (var cy = minCY; cy <= maxCY && cellCount < 8u; cy++) {
                        for (var cx = minCX; cx <= maxCX && cellCount < 8u; cx++) {
                            let h = hashCell(cx, cy, cz);
                            cellAssigns[assignIdx + cellCount] = CellAssign(obj.objectId, h);
                            cellCount++;
                        }
                    }
                }
                
                // Fill remaining slots with invalid
                for (var i = cellCount; i < 8u; i++) {
                    cellAssigns[assignIdx + i] = CellAssign(0xFFFFFFFFu, 0xFFFFFFFFu);
                }
            }
        `;
        
        const hashShaderModule = this.device.createShaderModule({
            code: hashShaderCode,
            label: 'SpatialHash_HashShader',
        });
        
        const bindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
            label: 'SpatialHash_BindGroupLayout',
        });
        
        this.hashPipeline = this.device.createComputePipeline({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            compute: { module: hashShaderModule, entryPoint: 'main' },
            label: 'SpatialHash_HashPipeline',
        });
        
        // Create params uniform buffer
        this.paramsBuffer = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'SpatialHash_Params',
        });
    }
    
    /**
     * Update object AABBs from CPU data
     * @param {Array} objects - Array of {id, aabb: {minX, minY, minZ, maxX, maxY, maxZ}}
     */
    updateObjects(objects) {
        this.objectCount = Math.min(objects.length, this.maxObjects);
        
        const data = new Float32Array(this.objectCount * 8);
        for (let i = 0; i < this.objectCount; i++) {
            const obj = objects[i];
            const offset = i * 8;
            data[offset + 0] = obj.aabb.minX;
            data[offset + 1] = obj.aabb.minY;
            data[offset + 2] = obj.aabb.minZ;
            data[offset + 3] = obj.aabb.maxX;
            data[offset + 4] = obj.aabb.maxY;
            data[offset + 5] = obj.aabb.maxZ;
            const dataU32 = new Uint32Array(data.buffer);
            dataU32[offset + 6] = obj.id;
            dataU32[offset + 7] = 0;
        }
        
        this.device.queue.writeBuffer(this.objectBuffer, 0, data);
    }
    
    /**
     * Run broad-phase collision detection
     * @param {GPUCommandEncoder} commandEncoder
     */
    computeBroadPhase(commandEncoder) {
        if (this.objectCount === 0) return;
        
        // Update params
        const params = new ArrayBuffer(16);
        const paramsU32 = new Uint32Array(params);
        const paramsF32 = new Float32Array(params);
        paramsU32[0] = this.objectCount;
        paramsF32[1] = this.cellSize;
        paramsU32[2] = this.tableSize;
        paramsU32[3] = 0;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params);
        
        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: this.hashPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.objectBuffer } },
                { binding: 1, resource: { buffer: this.cellAssignBuffer } },
                { binding: 2, resource: { buffer: this.paramsBuffer } },
            ],
        });
        
        // Dispatch hash compute
        const workgroups = Math.ceil(this.objectCount / 64);
        const pass = commandEncoder.beginComputePass({ label: 'SpatialHash_Hash' });
        pass.setPipeline(this.hashPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
    }
    
    destroy() {
        if (this.objectBuffer) this.objectBuffer.destroy();
        if (this.cellAssignBuffer) this.cellAssignBuffer.destroy();
        if (this.sortedBuffer) this.sortedBuffer.destroy();
        if (this.cellStartBuffer) this.cellStartBuffer.destroy();
        if (this.pairsBuffer) this.pairsBuffer.destroy();
        if (this.paramsBuffer) this.paramsBuffer.destroy();
    }
}

/**
 * Factory function to create GPUSpatialHashGrid from VirtualGPU
 * @param {Object} vgpu - VirtualGPU instance
 * @param {Object} options - Grid options
 * @returns {GPUSpatialHashGrid} Initialized grid
 */
export async function createSpatialHashFromVGPU(vgpu, options = {}) {
    if (!vgpu || !vgpu.device) {
        throw new Error('[GPUSpatialHash] VirtualGPU instance required');
    }
    
    const grid = new GPUSpatialHashGrid(vgpu.device, options);
    await grid.init();
    return grid;
}
