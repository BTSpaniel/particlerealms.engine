/**
 * GPUBroadphase.js — GPU Compute Spatial Hash Broadphase
 *
 * Spatial hash broad-phase collision detection on GPU.
 * Computes AABBs from collider shapes + world transforms,
 * inserts into spatial hash grid, finds candidate collision pairs.
 *
 * Based on:
 * - GPU Gems 3 Ch.32: Broad-Phase Collision Detection with CUDA
 * - GPU Gems 3 Ch.29: Uniform grid with 27-neighbor cell queries
 * - Existing GPUSpatialHash.js patterns (morton codes, hash primes)
 *
 * Uses atomicAdd for pair output (modern WebGPU, no multi-pass needed).
 * Collision layer/mask filtering happens during pair generation.
 */

import {
    MAX_BODIES, MAX_PAIRS,
    SHAPE_SPHERE, SHAPE_BOX, SHAPE_CAPSULE, SHAPE_CONVEX,
} from './GPURigidBodyWorld.js';
import { LEGACY_PRIME_COORDINATE_SIGNED_ADD_ABS_BUCKET3D_WGSL } from '../../../core/math/MathBits.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const DEFAULT_CELL_SIZE = 2.0; // world units per cell
export const HASH_TABLE_SIZE   = 16384; // must be power of 2
export const MAX_BODIES_PER_CELL = 8;

// ============================================================================
// WGSL SHADERS
// ============================================================================

const COMPUTE_AABB_SHADER = /* wgsl */`
// Compute AABB from collider shape + world position/rotation
// Output: aabbBuffer[id] = vec4(minX, minY, minZ, 0), vec4(maxX, maxY, maxZ, 0)

struct Collider {
    shapeType: u32,
    halfExtentX: f32, halfExtentY: f32, halfExtentZ: f32,
    radius: f32, halfHeight: f32,
    localOffsetX: f32, localOffsetY: f32, localOffsetZ: f32,
    friction: f32, restitution: f32,
    _pad0: f32, _pad1: f32, _pad2: f32, _pad3: f32, _pad4: f32,
}

struct Params {
    bodyCount: u32,
    contactOffset: f32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> rotations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> colliders: array<Collider>;
@group(0) @binding(3) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(4) var<storage, read_write> aabbMins: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> aabbMaxs: array<vec4<f32>>;
@group(0) @binding(6) var<uniform> params: Params;

fn rotateVec3ByQuat(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let pos = positions[id].xyz;
    let q = rotations[id];
    let col = colliders[id];
    let offset = params.contactOffset;

    var halfSize: vec3<f32>;

    switch col.shapeType {
        case 0u: { // SPHERE
            halfSize = vec3<f32>(col.radius);
        }
        case 1u: { // BOX
            // Rotated box AABB: take abs of each rotated axis * half extents
            let he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ);
            let ax = abs(rotateVec3ByQuat(vec3<f32>(he.x, 0.0, 0.0), q));
            let ay = abs(rotateVec3ByQuat(vec3<f32>(0.0, he.y, 0.0), q));
            let az = abs(rotateVec3ByQuat(vec3<f32>(0.0, 0.0, he.z), q));
            halfSize = ax + ay + az;
        }
        case 2u: { // CAPSULE (axis-aligned Y)
            let r = col.radius;
            let hh = col.halfHeight;
            // Rotate capsule axis
            let axis = rotateVec3ByQuat(vec3<f32>(0.0, hh, 0.0), q);
            halfSize = abs(axis) + vec3<f32>(r);
        }
        default: { // CONVEX — use halfExtents as conservative AABB
            let he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ);
            let ax = abs(rotateVec3ByQuat(vec3<f32>(he.x, 0.0, 0.0), q));
            let ay = abs(rotateVec3ByQuat(vec3<f32>(0.0, he.y, 0.0), q));
            let az = abs(rotateVec3ByQuat(vec3<f32>(0.0, 0.0, he.z), q));
            halfSize = ax + ay + az;
        }
    }

    // Add contact offset margin
    halfSize += vec3<f32>(offset);

    // Apply local offset (rotated)
    let localOff = vec3<f32>(col.localOffsetX, col.localOffsetY, col.localOffsetZ);
    let worldCenter = pos + rotateVec3ByQuat(localOff, q);

    aabbMins[id] = vec4<f32>(worldCenter - halfSize, 0.0);
    aabbMaxs[id] = vec4<f32>(worldCenter + halfSize, 0.0);
}
`;

const HASH_CLEAR_SHADER = /* wgsl */`
// Clear the hash table cell counts to zero

struct Params {
    tableSize: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> cellBodies: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.tableSize) { return; }
    atomicStore(&cellCounts[id], 0u);
    // Clear all body slots for this cell
    let base = id * ${MAX_BODIES_PER_CELL}u;
    for (var i = 0u; i < ${MAX_BODIES_PER_CELL}u; i++) {
        cellBodies[base + i] = 0xFFFFFFFFu; // sentinel
    }
}
`;

const HASH_INSERT_SHADER = /* wgsl */`
// Insert each body's AABB into spatial hash cells
// Bodies spanning multiple cells are inserted into each overlapping cell

struct Params {
    bodyCount: u32,
    invCellSize: f32,
    tableSize: u32,
    _pad0: u32,
}

@group(0) @binding(0) var<storage, read> aabbMins: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> aabbMaxs: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(3) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cellBodies: array<u32>;
@group(0) @binding(5) var<uniform> params: Params;

${LEGACY_PRIME_COORDINATE_SIGNED_ADD_ABS_BUCKET3D_WGSL}

fn hashCell3(cx: i32, cy: i32, cz: i32, tableSize: u32) -> u32 {
    return legacyPrimeCoordinateSignedAddAbsBucket3D(cx, cy, cz, tableSize);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let flags = bodyFlags[id];
    // Skip sleeping bodies (bit 2)
    if ((flags & 4u) != 0u) { return; }

    let aabbMin = aabbMins[id].xyz;
    let aabbMax = aabbMaxs[id].xyz;

    let minCX = i32(floor(aabbMin.x * params.invCellSize));
    let minCY = i32(floor(aabbMin.y * params.invCellSize));
    let minCZ = i32(floor(aabbMin.z * params.invCellSize));
    let maxCX = i32(floor(aabbMax.x * params.invCellSize));
    let maxCY = i32(floor(aabbMax.y * params.invCellSize));
    let maxCZ = i32(floor(aabbMax.z * params.invCellSize));

    // Insert into all overlapping cells (clamped to prevent huge body explosion)
    let maxCells = 4; // max 4 cells per axis to prevent runaway
    let clampMaxCX = min(maxCX, minCX + maxCells);
    let clampMaxCY = min(maxCY, minCY + maxCells);
    let clampMaxCZ = min(maxCZ, minCZ + maxCells);

    for (var cz = minCZ; cz <= clampMaxCZ; cz++) {
        for (var cy = minCY; cy <= clampMaxCY; cy++) {
            for (var cx = minCX; cx <= clampMaxCX; cx++) {
                let hash = hashCell3(cx, cy, cz, params.tableSize);
                let slot = atomicAdd(&cellCounts[hash], 1u);
                if (slot < ${MAX_BODIES_PER_CELL}u) {
                    cellBodies[hash * ${MAX_BODIES_PER_CELL}u + slot] = id;
                }
            }
        }
    }
}
`;

const FIND_PAIRS_SHADER = /* wgsl */`
// For each body, query its cell + 26 neighbors, output unique collision pairs
// Uses atomicAdd to append pairs to pairBuffer
// Filters by collision layer/mask and AABB overlap

struct Pair {
    bodyA: u32,
    bodyB: u32,
}

struct Params {
    bodyCount: u32,
    invCellSize: f32,
    tableSize: u32,
    maxPairs: u32,
}

@group(0) @binding(0) var<storage, read> aabbMins: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> aabbMaxs: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(3) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(4) var<storage, read> cellBodies: array<u32>;
@group(0) @binding(5) var<storage, read_write> pairBuffer: array<Pair>;
@group(0) @binding(6) var<storage, read_write> pairCount: atomic<u32>;
@group(0) @binding(7) var<uniform> params: Params;

${LEGACY_PRIME_COORDINATE_SIGNED_ADD_ABS_BUCKET3D_WGSL}

fn hashCell3(cx: i32, cy: i32, cz: i32, tableSize: u32) -> u32 {
    return legacyPrimeCoordinateSignedAddAbsBucket3D(cx, cy, cz, tableSize);
}

fn aabbOverlap(minA: vec3<f32>, maxA: vec3<f32>, minB: vec3<f32>, maxB: vec3<f32>) -> bool {
    return minA.x <= maxB.x && maxA.x >= minB.x
        && minA.y <= maxB.y && maxA.y >= minB.y
        && minA.z <= maxB.z && maxA.z >= minB.z;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let flagsA = bodyFlags[id];
    let simModeA = flagsA & 3u;
    // Skip sleeping
    if ((flagsA & 4u) != 0u) { return; }

    let layerA = (flagsA >> 8u) & 0xFFu;
    let maskA = (flagsA >> 16u) & 0xFFu;

    let minA = aabbMins[id].xyz;
    let maxA = aabbMaxs[id].xyz;

    // Body center cell
    let center = (minA + maxA) * 0.5;
    let baseCX = i32(floor(center.x * params.invCellSize));
    let baseCY = i32(floor(center.y * params.invCellSize));
    let baseCZ = i32(floor(center.z * params.invCellSize));

    // Query 27 neighbor cells
    for (var dz = -1; dz <= 1; dz++) {
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                let hash = hashCell3(baseCX + dx, baseCY + dy, baseCZ + dz, params.tableSize);
                let count = min(cellCounts[hash], ${MAX_BODIES_PER_CELL}u);
                let base = hash * ${MAX_BODIES_PER_CELL}u;

                for (var s = 0u; s < count; s++) {
                    let other = cellBodies[base + s];
                    if (other == 0xFFFFFFFFu) { continue; }
                    // Only generate pair once: bodyA < bodyB
                    if (other <= id) { continue; }

                    let flagsB = bodyFlags[other];
                    let simModeB = flagsB & 3u;

                    // Skip static-static pairs
                    if (simModeA == 2u && simModeB == 2u) { continue; }

                    // Layer/mask filtering (bidirectional)
                    let layerB = (flagsB >> 8u) & 0xFFu;
                    let maskB = (flagsB >> 16u) & 0xFFu;
                    if ((maskA & layerB) == 0u || (maskB & layerA) == 0u) { continue; }

                    // AABB overlap test
                    let minB = aabbMins[other].xyz;
                    let maxB = aabbMaxs[other].xyz;
                    if (!aabbOverlap(minA, maxA, minB, maxB)) { continue; }

                    // Output pair
                    let pairIdx = atomicAdd(&pairCount, 1u);
                    if (pairIdx < params.maxPairs) {
                        pairBuffer[pairIdx] = Pair(id, other);
                    }
                }
            }
        }
    }
}
`;

// ============================================================================
// BROADPHASE CLASS
// ============================================================================

export class GPUBroadphase {
    /**
     * @param {GPUDevice} device
     * @param {Object} options
     */
    constructor(device, options = {}) {
        this.device = device;
        this.maxBodies = options.maxBodies ?? MAX_BODIES;
        this.maxPairs = options.maxPairs ?? MAX_PAIRS;
        this.cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
        this.invCellSize = 1.0 / this.cellSize;
        this.tableSize = options.tableSize ?? HASH_TABLE_SIZE;
        this.contactOffset = options.contactOffset ?? 0.02;

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this._paramsF32 = new Float32Array(4);
        this._paramsU32 = new Uint32Array(this._paramsF32.buffer);

        this.pairCount = 0; // CPU-side pair count (after readback)
    }

    async init(worldBuffers) {
        this._createBuffers();
        await this._createPipelines(worldBuffers);
        console.log(`[GPUBroadphase] Initialized — cellSize=${this.cellSize}, tableSize=${this.tableSize}`);
    }

    _createBuffers() {
        const d = this.device;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

        // AABB buffers (min/max per body)
        this._buffers.aabbMins = b('BP_AABBMins', this.maxBodies * 16, SUW);
        this._buffers.aabbMaxs = b('BP_AABBMaxs', this.maxBodies * 16, SUW);

        // Spatial hash table
        this._buffers.cellCounts = b('BP_CellCounts', this.tableSize * 4, SUW);
        this._buffers.cellBodies = b('BP_CellBodies', this.tableSize * MAX_BODIES_PER_CELL * 4, SUW);

        // Pair output
        this._buffers.pairBuffer = b('BP_Pairs', this.maxPairs * 8, SUW); // 2 u32 per pair
        this._buffers.pairCount = b('BP_PairCount', 4, SUW);

        // Param uniform buffers
        this._buffers.aabbParams = b('BP_AABBParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.clearParams = b('BP_ClearParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.insertParams = b('BP_InsertParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.findPairsParams = b('BP_FindPairsParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

        // Pair count readback
        this._buffers.pairCountReadback = b('BP_PairCountRead', 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    }

    async _createPipelines(worldBuffers) {
        const d = this.device;
        const mkModule = (label, code) => d.createShaderModule({ label, code });
        const mkPipeline = async (label, module) => d.createComputePipelineAsync({
            label, layout: 'auto', compute: { module, entryPoint: 'main' },
        });

        const aabbModule = mkModule('BP_ComputeAABB', COMPUTE_AABB_SHADER);
        const clearModule = mkModule('BP_HashClear', HASH_CLEAR_SHADER);
        const insertModule = mkModule('BP_HashInsert', HASH_INSERT_SHADER);
        const findPairsModule = mkModule('BP_FindPairs', FIND_PAIRS_SHADER);

        this._pipelines.computeAABB = await mkPipeline('BP_ComputeAABB', aabbModule);
        this._pipelines.hashClear = await mkPipeline('BP_HashClear', clearModule);
        this._pipelines.hashInsert = await mkPipeline('BP_HashInsert', insertModule);
        this._pipelines.findPairs = await mkPipeline('BP_FindPairs', findPairsModule);

        this._rebuildBindGroups(worldBuffers);
    }

    _rebuildBindGroups(wb) {
        const d = this.device;
        const B = this._buffers;
        const P = this._pipelines;

        this._bindGroups.computeAABB = d.createBindGroup({
            label: 'BP_ComputeAABB_BG',
            layout: P.computeAABB.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: wb.positions } },
                { binding: 1, resource: { buffer: wb.rotations } },
                { binding: 2, resource: { buffer: wb.colliders } },
                { binding: 3, resource: { buffer: wb.bodyFlags } },
                { binding: 4, resource: { buffer: B.aabbMins } },
                { binding: 5, resource: { buffer: B.aabbMaxs } },
                { binding: 6, resource: { buffer: B.aabbParams } },
            ],
        });

        this._bindGroups.hashClear = d.createBindGroup({
            label: 'BP_HashClear_BG',
            layout: P.hashClear.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.cellCounts } },
                { binding: 1, resource: { buffer: B.cellBodies } },
                { binding: 2, resource: { buffer: B.clearParams } },
            ],
        });

        this._bindGroups.hashInsert = d.createBindGroup({
            label: 'BP_HashInsert_BG',
            layout: P.hashInsert.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.aabbMins } },
                { binding: 1, resource: { buffer: B.aabbMaxs } },
                { binding: 2, resource: { buffer: wb.bodyFlags } },
                { binding: 3, resource: { buffer: B.cellCounts } },
                { binding: 4, resource: { buffer: B.cellBodies } },
                { binding: 5, resource: { buffer: B.insertParams } },
            ],
        });

        this._bindGroups.findPairs = d.createBindGroup({
            label: 'BP_FindPairs_BG',
            layout: P.findPairs.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.aabbMins } },
                { binding: 1, resource: { buffer: B.aabbMaxs } },
                { binding: 2, resource: { buffer: wb.bodyFlags } },
                { binding: 3, resource: { buffer: B.cellCounts } },
                { binding: 4, resource: { buffer: B.cellBodies } },
                { binding: 5, resource: { buffer: B.pairBuffer } },
                { binding: 6, resource: { buffer: B.pairCount } },
                { binding: 7, resource: { buffer: B.findPairsParams } },
            ],
        });
    }

    /**
     * Dispatch broadphase into a command encoder.
     * @param {GPUCommandEncoder} encoder
     * @param {number} bodyCount
     * @param {Object} worldBuffers - GPURigidBodyWorld._buffers
     */
    dispatch(encoder, bodyCount, worldBuffers) {
        const bodyWG = Math.ceil(bodyCount / 64);
        const tableWG = Math.ceil(this.tableSize / 64);

        // Write params
        this._writeAABBParams(bodyCount);
        this._writeClearParams();
        this._writeInsertParams(bodyCount);
        this._writeFindPairsParams(bodyCount);

        // Zero pair count
        const zeroU32 = new Uint32Array([0]);
        this.device.queue.writeBuffer(this._buffers.pairCount, 0, zeroU32);

        // 1. Compute AABBs
        const aabbPass = encoder.beginComputePass({ label: 'BP_ComputeAABB' });
        aabbPass.setPipeline(this._pipelines.computeAABB);
        aabbPass.setBindGroup(0, this._bindGroups.computeAABB);
        aabbPass.dispatchWorkgroups(bodyWG);
        aabbPass.end();

        // 2. Clear hash table
        const clearPass = encoder.beginComputePass({ label: 'BP_HashClear' });
        clearPass.setPipeline(this._pipelines.hashClear);
        clearPass.setBindGroup(0, this._bindGroups.hashClear);
        clearPass.dispatchWorkgroups(tableWG);
        clearPass.end();

        // 3. Insert bodies into hash
        const insertPass = encoder.beginComputePass({ label: 'BP_HashInsert' });
        insertPass.setPipeline(this._pipelines.hashInsert);
        insertPass.setBindGroup(0, this._bindGroups.hashInsert);
        insertPass.dispatchWorkgroups(bodyWG);
        insertPass.end();

        // 4. Find pairs
        const pairPass = encoder.beginComputePass({ label: 'BP_FindPairs' });
        pairPass.setPipeline(this._pipelines.findPairs);
        pairPass.setBindGroup(0, this._bindGroups.findPairs);
        pairPass.dispatchWorkgroups(bodyWG);
        pairPass.end();

        // Copy pair count for readback
        encoder.copyBufferToBuffer(this._buffers.pairCount, 0, this._buffers.pairCountReadback, 0, 4);
    }

    /**
     * Async readback of pair count from GPU.
     */
    async readbackPairCount() {
        try {
            await this._buffers.pairCountReadback.mapAsync(GPUMapMode.READ);
            const data = new Uint32Array(this._buffers.pairCountReadback.getMappedRange().slice(0));
            this._buffers.pairCountReadback.unmap();
            this.pairCount = Math.min(data[0], this.maxPairs);
            return this.pairCount;
        } catch (e) {
            console.warn('[GPUBroadphase] Pair count readback failed:', e.message);
            return 0;
        }
    }

    // ========================================================================
    // PARAM WRITING
    // ========================================================================

    _writeAABBParams(bodyCount) {
        this._paramsU32[0] = bodyCount;
        this._paramsF32[1] = this.contactOffset;
        this._paramsU32[2] = 0;
        this._paramsU32[3] = 0;
        this.device.queue.writeBuffer(this._buffers.aabbParams, 0, this._paramsF32);
    }

    _writeClearParams() {
        this._paramsU32[0] = this.tableSize;
        this._paramsU32[1] = 0;
        this._paramsU32[2] = 0;
        this._paramsU32[3] = 0;
        this.device.queue.writeBuffer(this._buffers.clearParams, 0, this._paramsU32);
    }

    _writeInsertParams(bodyCount) {
        this._paramsU32[0] = bodyCount;
        this._paramsF32[1] = this.invCellSize;
        this._paramsU32[2] = this.tableSize;
        this._paramsU32[3] = 0;
        this.device.queue.writeBuffer(this._buffers.insertParams, 0, this._paramsF32);
    }

    _writeFindPairsParams(bodyCount) {
        this._paramsU32[0] = bodyCount;
        this._paramsF32[1] = this.invCellSize;
        this._paramsU32[2] = this.tableSize;
        this._paramsU32[3] = this.maxPairs;
        this.device.queue.writeBuffer(this._buffers.findPairsParams, 0, this._paramsF32);
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    destroy() {
        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        this._buffers = {};
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create and initialize a GPU broadphase.
 * @param {GPUDevice} device
 * @param {Object} worldBuffers - GPURigidBodyWorld._buffers
 * @param {Object} options
 */
export async function createBroadphase(device, worldBuffers, options = {}) {
    const bp = new GPUBroadphase(device, options);
    await bp.init(worldBuffers);
    return bp;
}

export function destroyBroadphase(bp) {
    if (bp) bp.destroy();
}
