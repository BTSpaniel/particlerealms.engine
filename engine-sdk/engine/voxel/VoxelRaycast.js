// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelRaycast.js - Amanatides & Woo DDA Voxel Ray Traversal
 * 
 * Based on "A Fast Voxel Traversal Algorithm for Ray Tracing" (1987)
 * 
 * Features:
 * - CPU DDA for single raycasts (picking, quick LOS)
 * - GPU compute shader for batch raycasts (AI mass LOS checks)
 * - Block picking with face normal detection
 * - Line-of-sight with early termination
 * - Configurable solid/transparent material checks
 * 
 * Performance:
 * - CPU: O(n) where n = voxels crossed (typically 10-100 for gameplay ranges)
 * - GPU: Parallel processing of 1000+ rays per dispatch
 */

import { MATERIAL } from './MaterialSchema.js';
import { CHUNK_SIZE } from './VoxelConstants.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
let _rayDataCapacity = 64;
let _rayData = new Float32Array(_rayDataCapacity * 8);
let _voxelDataCapacity = 1024;
let _voxelData = new Uint32Array(_voxelDataCapacity);

function ensureRayDataCapacity(count) {
    if (count <= _rayDataCapacity) return;
    while (_rayDataCapacity < count) _rayDataCapacity *= 2;
    _rayData = new Float32Array(_rayDataCapacity * 8);
}

function ensureVoxelDataCapacity(count) {
    if (count <= _voxelDataCapacity) return;
    while (_voxelDataCapacity < count) _voxelDataCapacity *= 2;
    _voxelData = new Uint32Array(_voxelDataCapacity);
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum ray distance in voxels */
const MAX_RAY_DISTANCE = 500;

/** Axis indices for normal calculation */
const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;

/** Face normals indexed by axis and sign */
const FACE_NORMALS = [
    [[1, 0, 0], [-1, 0, 0]],   // X axis: +X, -X
    [[0, 1, 0], [0, -1, 0]],   // Y axis: +Y, -Y
    [[0, 0, 1], [0, 0, -1]],   // Z axis: +Z, -Z
];

// ============================================================================
// CPU DDA - SINGLE RAY TRAVERSAL
// ============================================================================

/**
 * Raycast through voxel world using DDA algorithm
 * Returns first solid voxel hit along ray
 * 
 * @param {number[]} origin - [x, y, z] ray origin in world coords
 * @param {number[]} direction - [x, y, z] normalized direction
 * @param {Function} getVoxel - (x, y, z) => material ID or null if unloaded
 * @param {Object} options - Raycast options
 * @param {number} options.maxDistance - Maximum ray distance (default 100)
 * @param {Function} options.isSolid - (material) => boolean (default: !== AIR)
 * @param {Set} options.ignoreMaterials - Materials to treat as transparent
 * @returns {Object|null} {position, normal, distance, material, voxelCoord} or null
 */
export function raycastVoxels(origin, direction, getVoxel, options = {}) {
    const maxDistance = options.maxDistance ?? 100;
    const isSolid = options.isSolid ?? ((mat) => mat !== MATERIAL.AIR && mat !== null);
    const ignoreMaterials = options.ignoreMaterials ?? new Set([MATERIAL.WATER]);
    
    // Handle zero direction components
    const EPSILON = 1e-10;
    const dir = [
        Math.abs(direction[0]) < EPSILON ? EPSILON : direction[0],
        Math.abs(direction[1]) < EPSILON ? EPSILON : direction[1],
        Math.abs(direction[2]) < EPSILON ? EPSILON : direction[2],
    ];
    
    // Inverse direction for t calculations
    const invDir = [1 / dir[0], 1 / dir[1], 1 / dir[2]];
    
    // Step direction (+1 or -1) per axis
    const step = [
        dir[0] > 0 ? 1 : -1,
        dir[1] > 0 ? 1 : -1,
        dir[2] > 0 ? 1 : -1,
    ];
    
    // Current voxel coordinate
    const voxel = [
        Math.floor(origin[0]),
        Math.floor(origin[1]),
        Math.floor(origin[2]),
    ];
    
    // Distance to next voxel boundary per axis (parametric t)
    // t = (boundary - origin) / direction
    const tMax = [
        (voxel[0] + (step[0] > 0 ? 1 : 0) - origin[0]) * invDir[0],
        (voxel[1] + (step[1] > 0 ? 1 : 0) - origin[1]) * invDir[1],
        (voxel[2] + (step[2] > 0 ? 1 : 0) - origin[2]) * invDir[2],
    ];
    
    // Distance to traverse one voxel per axis
    const tDelta = [
        Math.abs(invDir[0]),
        Math.abs(invDir[1]),
        Math.abs(invDir[2]),
    ];
    
    // Track which axis we stepped on (for normal calculation)
    let steppedAxis = -1;
    let distance = 0;
    
    // Check starting voxel (might be inside solid)
    const startMat = getVoxel(voxel[0], voxel[1], voxel[2]);
    if (startMat !== null && isSolid(startMat) && !ignoreMaterials.has(startMat)) {
        return {
            position: [...origin],
            normal: [0, 1, 0], // Default up if starting inside
            distance: 0,
            material: startMat,
            voxelCoord: [...voxel],
        };
    }
    
    // DDA traversal loop
    while (distance < maxDistance) {
        // Find axis with smallest tMax (next boundary)
        if (tMax[0] < tMax[1]) {
            if (tMax[0] < tMax[2]) {
                steppedAxis = AXIS_X;
                distance = tMax[0];
                voxel[0] += step[0];
                tMax[0] += tDelta[0];
            } else {
                steppedAxis = AXIS_Z;
                distance = tMax[2];
                voxel[2] += step[2];
                tMax[2] += tDelta[2];
            }
        } else {
            if (tMax[1] < tMax[2]) {
                steppedAxis = AXIS_Y;
                distance = tMax[1];
                voxel[1] += step[1];
                tMax[1] += tDelta[1];
            } else {
                steppedAxis = AXIS_Z;
                distance = tMax[2];
                voxel[2] += step[2];
                tMax[2] += tDelta[2];
            }
        }
        
        // Check if past max distance
        if (distance > maxDistance) {
            break;
        }
        
        // Sample voxel at current position
        const material = getVoxel(voxel[0], voxel[1], voxel[2]);
        
        // Skip unloaded chunks (treat as air)
        if (material === null) {
            continue;
        }
        
        // Skip ignored materials (water, etc.)
        if (ignoreMaterials.has(material)) {
            continue;
        }
        
        // Check if solid
        if (isSolid(material)) {
            // Calculate hit position
            const hitPos = [
                origin[0] + dir[0] * distance,
                origin[1] + dir[1] * distance,
                origin[2] + dir[2] * distance,
            ];
            
            // Normal points opposite to step direction on stepped axis
            const normalIdx = step[steppedAxis] > 0 ? 1 : 0;
            const normal = [...FACE_NORMALS[steppedAxis][normalIdx]];
            
            return {
                position: hitPos,
                normal,
                distance,
                material,
                voxelCoord: [...voxel],
            };
        }
    }
    
    // No hit
    return null;
}

/**
 * Check line of sight between two points through voxels
 * Returns true if no solid voxels block the path
 * 
 * @param {number[]} from - [x, y, z] start position
 * @param {number[]} to - [x, y, z] end position
 * @param {Function} getVoxel - (x, y, z) => material ID
 * @param {Object} options - Same as raycastVoxels
 * @returns {boolean} True if line of sight is clear
 */
export function hasVoxelLineOfSight(from, to, getVoxel, options = {}) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (distance < 0.001) {
        return true; // Same point
    }
    
    const direction = [dx / distance, dy / distance, dz / distance];
    
    const hit = raycastVoxels(from, direction, getVoxel, {
        ...options,
        maxDistance: distance,
    });
    
    return hit === null;
}

/**
 * Block picking - raycast from camera with face/placement info
 * Returns both the hit block and the adjacent empty block for placement
 * 
 * @param {number[]} origin - Camera/eye position
 * @param {number[]} direction - Look direction (normalized)
 * @param {Function} getVoxel - (x, y, z) => material ID
 * @param {number} maxDistance - Max pick distance (default 10)
 * @returns {Object|null} {block: voxelCoord, face: normal, placeAt: voxelCoord, distance}
 */
export function pickBlock(origin, direction, getVoxel, maxDistance = 10) {
    const hit = raycastVoxels(origin, direction, getVoxel, { maxDistance });
    
    if (!hit) {
        return null;
    }
    
    // Calculate placement position (adjacent block in normal direction)
    const placeAt = [
        hit.voxelCoord[0] + hit.normal[0],
        hit.voxelCoord[1] + hit.normal[1],
        hit.voxelCoord[2] + hit.normal[2],
    ];
    
    return {
        block: hit.voxelCoord,
        face: hit.normal,
        placeAt,
        distance: hit.distance,
        material: hit.material,
        hitPosition: hit.position,
    };
}

/**
 * Trace ray through voxels collecting all intersected voxels
 * Useful for beam weapons, explosion rays, etc.
 * 
 * @param {number[]} origin - Ray origin
 * @param {number[]} direction - Normalized direction
 * @param {Function} getVoxel - (x, y, z) => material ID
 * @param {number} maxDistance - Max trace distance
 * @param {Object} options - Additional options
 * @returns {Array} Array of {voxelCoord, material, distance, entryPoint}
 */
export function traceVoxelPath(origin, direction, getVoxel, maxDistance = 50, options = {}) {
    const stopOnSolid = options.stopOnSolid ?? false;
    const isSolid = options.isSolid ?? ((mat) => mat !== MATERIAL.AIR && mat !== null);
    
    const results = [];
    
    // Handle zero direction components
    const EPSILON = 1e-10;
    const dir = [
        Math.abs(direction[0]) < EPSILON ? EPSILON : direction[0],
        Math.abs(direction[1]) < EPSILON ? EPSILON : direction[1],
        Math.abs(direction[2]) < EPSILON ? EPSILON : direction[2],
    ];
    
    const invDir = [1 / dir[0], 1 / dir[1], 1 / dir[2]];
    const step = [
        dir[0] > 0 ? 1 : -1,
        dir[1] > 0 ? 1 : -1,
        dir[2] > 0 ? 1 : -1,
    ];
    
    const voxel = [
        Math.floor(origin[0]),
        Math.floor(origin[1]),
        Math.floor(origin[2]),
    ];
    
    const tMax = [
        (voxel[0] + (step[0] > 0 ? 1 : 0) - origin[0]) * invDir[0],
        (voxel[1] + (step[1] > 0 ? 1 : 0) - origin[1]) * invDir[1],
        (voxel[2] + (step[2] > 0 ? 1 : 0) - origin[2]) * invDir[2],
    ];
    
    const tDelta = [
        Math.abs(invDir[0]),
        Math.abs(invDir[1]),
        Math.abs(invDir[2]),
    ];
    
    let distance = 0;
    let prevDistance = 0;
    
    // Add starting voxel
    const startMat = getVoxel(voxel[0], voxel[1], voxel[2]);
    if (startMat !== null) {
        results.push({
            voxelCoord: [...voxel],
            material: startMat,
            distance: 0,
            entryPoint: [...origin],
        });
        if (stopOnSolid && isSolid(startMat)) {
            return results;
        }
    }
    
    while (distance < maxDistance) {
        prevDistance = distance;
        
        // Step to next voxel
        if (tMax[0] < tMax[1]) {
            if (tMax[0] < tMax[2]) {
                distance = tMax[0];
                voxel[0] += step[0];
                tMax[0] += tDelta[0];
            } else {
                distance = tMax[2];
                voxel[2] += step[2];
                tMax[2] += tDelta[2];
            }
        } else {
            if (tMax[1] < tMax[2]) {
                distance = tMax[1];
                voxel[1] += step[1];
                tMax[1] += tDelta[1];
            } else {
                distance = tMax[2];
                voxel[2] += step[2];
                tMax[2] += tDelta[2];
            }
        }
        
        if (distance > maxDistance) break;
        
        const material = getVoxel(voxel[0], voxel[1], voxel[2]);
        if (material === null) continue;
        
        const entryPoint = [
            origin[0] + dir[0] * distance,
            origin[1] + dir[1] * distance,
            origin[2] + dir[2] * distance,
        ];
        
        results.push({
            voxelCoord: [...voxel],
            material,
            distance,
            entryPoint,
        });
        
        if (stopOnSolid && isSolid(material)) {
            break;
        }
    }
    
    return results;
}

// ============================================================================
// GPU COMPUTE SHADER - BATCH VOXEL RAYCAST
// ============================================================================

/**
 * WGSL compute shader for parallel DDA voxel raycasting
 * Processes hundreds of rays in parallel for AI LOS checks
 */
const VOXEL_RAYCAST_SHADER = /* wgsl */ `
const CHUNK_SIZE: u32 = 32u;
const CHUNK_SIZE_SQ: u32 = 1024u;
const MATERIAL_AIR: u32 = 0u;
const MAX_STEPS: u32 = 500u;

struct Ray {
    origin: vec3<f32>,
    entityId: u32,        // Source entity ID (for filtering)
    direction: vec3<f32>,
    maxDistance: f32,
}

struct RayResult {
    hit: u32,             // 1 = hit, 0 = no hit
    distance: f32,
    hitPos: vec3<f32>,
    normal: vec3<f32>,
    material: u32,
    voxelCoord: vec3<i32>,
    _pad: u32,
}

struct ChunkInfo {
    worldX: i32,
    worldY: i32,
    worldZ: i32,
    dataOffset: u32,      // Offset into voxelData array
}

struct RaycastParams {
    chunkCount: u32,
    rayCount: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<uniform> params: RaycastParams;
@group(0) @binding(1) var<storage, read> rays: array<Ray>;
@group(0) @binding(2) var<storage, read_write> results: array<RayResult>;
@group(0) @binding(3) var<storage, read> chunks: array<ChunkInfo>;
@group(0) @binding(4) var<storage, read> voxelData: array<u32>;

// Find chunk containing world position
fn findChunk(worldX: i32, worldY: i32, worldZ: i32) -> i32 {
    let chunkX = worldX >> 5; // Divide by 32
    let chunkY = worldY >> 5;
    let chunkZ = worldZ >> 5;
    
    // Linear search (could optimize with spatial hash)
    for (var i = 0u; i < params.chunkCount; i++) {
        let chunk = chunks[i];
        if (chunk.worldX == chunkX && chunk.worldY == chunkY && chunk.worldZ == chunkZ) {
            return i32(i);
        }
    }
    return -1;
}

// Get voxel material at world position
fn getVoxel(worldX: i32, worldY: i32, worldZ: i32) -> u32 {
    let chunkIdx = findChunk(worldX, worldY, worldZ);
    if (chunkIdx < 0) {
        return MATERIAL_AIR; // Unloaded = air
    }
    
    let chunk = chunks[u32(chunkIdx)];
    let localX = u32(worldX) & 31u; // Modulo 32
    let localY = u32(worldY) & 31u;
    let localZ = u32(worldZ) & 31u;
    
    let localIdx = localX + localY * CHUNK_SIZE + localZ * CHUNK_SIZE_SQ;
    return voxelData[chunk.dataOffset + localIdx];
}

// Check if material blocks LOS
fn isSolid(mat: u32) -> bool {
    // Air and water are transparent
    return mat != MATERIAL_AIR && mat != 5u;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let rayIdx = gid.x;
    if (rayIdx >= params.rayCount) {
        return;
    }
    
    let ray = rays[rayIdx];
    var result: RayResult;
    result.hit = 0u;
    result.distance = ray.maxDistance;
    
    // Handle near-zero direction components
    let EPSILON = 1e-10;
    var dir = ray.direction;
    dir.x = select(dir.x, EPSILON, abs(dir.x) < EPSILON);
    dir.y = select(dir.y, EPSILON, abs(dir.y) < EPSILON);
    dir.z = select(dir.z, EPSILON, abs(dir.z) < EPSILON);
    
    let invDir = 1.0 / dir;
    let step = vec3<i32>(
        select(-1, 1, dir.x > 0.0),
        select(-1, 1, dir.y > 0.0),
        select(-1, 1, dir.z > 0.0)
    );
    
    var voxel = vec3<i32>(
        i32(floor(ray.origin.x)),
        i32(floor(ray.origin.y)),
        i32(floor(ray.origin.z))
    );
    
    var tMax = vec3<f32>(
        (f32(voxel.x + select(0, 1, step.x > 0)) - ray.origin.x) * invDir.x,
        (f32(voxel.y + select(0, 1, step.y > 0)) - ray.origin.y) * invDir.y,
        (f32(voxel.z + select(0, 1, step.z > 0)) - ray.origin.z) * invDir.z
    );
    
    let tDelta = abs(invDir);
    
    var distance = 0.0;
    var steppedAxis = 0u;
    
    // DDA loop
    for (var i = 0u; i < MAX_STEPS; i++) {
        // Find next boundary
        if (tMax.x < tMax.y) {
            if (tMax.x < tMax.z) {
                steppedAxis = 0u;
                distance = tMax.x;
                voxel.x += step.x;
                tMax.x += tDelta.x;
            } else {
                steppedAxis = 2u;
                distance = tMax.z;
                voxel.z += step.z;
                tMax.z += tDelta.z;
            }
        } else {
            if (tMax.y < tMax.z) {
                steppedAxis = 1u;
                distance = tMax.y;
                voxel.y += step.y;
                tMax.y += tDelta.y;
            } else {
                steppedAxis = 2u;
                distance = tMax.z;
                voxel.z += step.z;
                tMax.z += tDelta.z;
            }
        }
        
        if (distance > ray.maxDistance) {
            break;
        }
        
        let material = getVoxel(voxel.x, voxel.y, voxel.z);
        
        if (isSolid(material)) {
            result.hit = 1u;
            result.distance = distance;
            result.hitPos = ray.origin + dir * distance;
            result.material = material;
            result.voxelCoord = voxel;
            
            // Calculate normal
            var normal = vec3<f32>(0.0);
            if (steppedAxis == 0u) {
                normal.x = -f32(step.x);
            } else if (steppedAxis == 1u) {
                normal.y = -f32(step.y);
            } else {
                normal.z = -f32(step.z);
            }
            result.normal = normal;
            
            break;
        }
    }
    
    results[rayIdx] = result;
}
`;

// ============================================================================
// GPU RAYCAST SYSTEM
// ============================================================================

/**
 * GPU-accelerated batch voxel raycasting system
 * Use when processing 100+ rays per frame
 */
export class VoxelRaycastGPU {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // GPU resources
        this.pipeline = null;
        this.bindGroupLayout = null;
        
        // Buffers
        this.rayBuffer = null;
        this.resultBuffer = null;
        this.readbackBuffer = null;
        this.chunkBuffer = null;
        this.voxelDataBuffer = null;
        this.paramsBuffer = null;
        
        // Capacity
        this.maxRays = 0;
        this.maxChunks = 0;
        this.maxVoxelData = 0;
        
        // Pre-allocated typed arrays to avoid per-batch allocations
        this._paramsData = new Uint32Array(4);
    }
    
    /**
     * Initialize GPU raycast system
     * @param {GPUDevice} device - WebGPU device
     * @param {Object} options - Configuration
     */
    async init(device, options = {}) {
        this.device = device;
        // MEMORY OPTIMIZED: Reduced defaults to save GPU memory
        this.maxRays = options.maxRays ?? 512;       // Was 1024
        this.maxChunks = options.maxChunks ?? 64;    // Was 256 (saves ~25MB voxel data buffer)
        this.maxVoxelData = options.maxVoxelData ?? (this.maxChunks * 32 * 32 * 32);
        
        // Create shader module
        const shaderModule = device.createShaderModule({
            label: 'VoxelRaycast',
            code: VOXEL_RAYCAST_SHADER,
        });
        
        // Create bind group layout
        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'VoxelRaycast BindGroupLayout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });
        
        // Create pipeline
        this.pipeline = device.createComputePipeline({
            label: 'VoxelRaycast Pipeline',
            layout: device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            compute: {
                module: shaderModule,
                entryPoint: 'main',
            },
        });
        
        // Create buffers
        // Params: 4 u32s
        this.paramsBuffer = device.createBuffer({
            label: 'VoxelRaycast Params',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Ray buffer: origin(3f) + entityId(1u) + direction(3f) + maxDistance(1f) = 32 bytes
        this.rayBuffer = device.createBuffer({
            label: 'VoxelRaycast Rays',
            size: this.maxRays * 32,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Result buffer: hit(1u) + distance(1f) + hitPos(3f) + normal(3f) + material(1u) + voxelCoord(3i) + pad(1u) = 56 bytes
        // Align to 64 for safety
        this.resultBuffer = device.createBuffer({
            label: 'VoxelRaycast Results',
            size: this.maxRays * 64,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        // Readback buffer
        this.readbackBuffer = device.createBuffer({
            label: 'VoxelRaycast Readback',
            size: this.maxRays * 64,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        // Chunk info buffer: worldXYZ(3i) + dataOffset(1u) = 16 bytes
        this.chunkBuffer = device.createBuffer({
            label: 'VoxelRaycast Chunks',
            size: this.maxChunks * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Voxel data buffer
        this.voxelDataBuffer = device.createBuffer({
            label: 'VoxelRaycast VoxelData',
            size: this.maxVoxelData * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.initialized = true;
    }
    
    /**
     * Perform batch raycast
     * @param {Array} rays - Array of {origin: [x,y,z], direction: [x,y,z], maxDistance, entityId}
     * @param {Map} loadedChunks - Map of "x,y,z" -> VoxelChunk
     * @returns {Promise<Array>} Array of results per ray
     */
    async raycastBatch(rays, loadedChunks) {
        if (!this.initialized || rays.length === 0) {
            return [];
        }
        
        const rayCount = Math.min(rays.length, this.maxRays);
        
        // Prepare ray data - reuse dynamic buffer
        ensureRayDataCapacity(rayCount);
        const rayData = _rayData;
        for (let i = 0; i < rayCount; i++) {
            const ray = rays[i];
            const offset = i * 8;
            rayData[offset + 0] = ray.origin[0];
            rayData[offset + 1] = ray.origin[1];
            rayData[offset + 2] = ray.origin[2];
            // entityId as float bits
            const view = new DataView(rayData.buffer);
            view.setUint32((offset + 3) * 4, ray.entityId ?? 0, true);
            rayData[offset + 4] = ray.direction[0];
            rayData[offset + 5] = ray.direction[1];
            rayData[offset + 6] = ray.direction[2];
            rayData[offset + 7] = ray.maxDistance ?? 100;
        }
        
        // Prepare chunk data
        const chunkArray = Array.from(loadedChunks.entries());
        const chunkCount = Math.min(chunkArray.length, this.maxChunks);
        const chunkData = new Int32Array(chunkCount * 4);
        
        let voxelOffset = 0;
        const voxelDataArrays = [];
        
        for (let i = 0; i < chunkCount; i++) {
            const [key, chunk] = chunkArray[i];
            const [cx, cy, cz] = key.split(',').map(Number);
            
            chunkData[i * 4 + 0] = cx;
            chunkData[i * 4 + 1] = cy;
            chunkData[i * 4 + 2] = cz;
            chunkData[i * 4 + 3] = voxelOffset;
            
            // Copy voxel data
            if (chunk.voxels) {
                voxelDataArrays.push(chunk.voxels);
                voxelOffset += chunk.voxels.length;
            }
        }
        
        // Combine voxel data - reuse dynamic buffer
        const totalVoxels = Math.min(voxelOffset, this.maxVoxelData);
        ensureVoxelDataCapacity(totalVoxels);
        const voxelData = _voxelData;
        let writeOffset = 0;
        for (const arr of voxelDataArrays) {
            const copyLen = Math.min(arr.length, totalVoxels - writeOffset);
            if (copyLen <= 0) break;
            voxelData.set(arr.subarray(0, copyLen), writeOffset);
            writeOffset += copyLen;
        }
        
        // Upload data (use pre-allocated buffer)
        this._paramsData[0] = chunkCount; this._paramsData[1] = rayCount; this._paramsData[2] = 0; this._paramsData[3] = 0;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, this._paramsData);
        this.device.queue.writeBuffer(this.rayBuffer, 0, rayData);
        this.device.queue.writeBuffer(this.chunkBuffer, 0, chunkData);
        if (voxelData.length > 0) {
            this.device.queue.writeBuffer(this.voxelDataBuffer, 0, voxelData);
        }
        
        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.rayBuffer } },
                { binding: 2, resource: { buffer: this.resultBuffer } },
                { binding: 3, resource: { buffer: this.chunkBuffer } },
                { binding: 4, resource: { buffer: this.voxelDataBuffer } },
            ],
        });
        
        // Dispatch compute
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(rayCount / 64));
        pass.end();
        
        // Copy results to readback
        encoder.copyBufferToBuffer(this.resultBuffer, 0, this.readbackBuffer, 0, rayCount * 64);
        
        this.device.queue.submit([encoder.finish()]);
        
        // Read back results
        await this.readbackBuffer.mapAsync(GPUMapMode.READ);
        const resultData = new Float32Array(this.readbackBuffer.getMappedRange().slice(0));
        this.readbackBuffer.unmap();
        
        // Parse results
        const results = [];
        for (let i = 0; i < rayCount; i++) {
            const offset = i * 16; // 64 bytes / 4 = 16 floats
            const view = new DataView(resultData.buffer);
            
            const hit = view.getUint32(offset * 4, true);
            
            if (hit) {
                results.push({
                    hit: true,
                    distance: resultData[offset + 1],
                    hitPos: [resultData[offset + 2], resultData[offset + 3], resultData[offset + 4]],
                    normal: [resultData[offset + 5], resultData[offset + 6], resultData[offset + 7]],
                    material: view.getUint32((offset + 8) * 4, true),
                    voxelCoord: [
                        view.getInt32((offset + 9) * 4, true),
                        view.getInt32((offset + 10) * 4, true),
                        view.getInt32((offset + 11) * 4, true),
                    ],
                });
            } else {
                results.push({ hit: false });
            }
        }
        
        return results;
    }
    
    /**
     * Cleanup GPU resources
     */
    destroy() {
        this.rayBuffer?.destroy();
        this.resultBuffer?.destroy();
        this.readbackBuffer?.destroy();
        this.chunkBuffer?.destroy();
        this.voxelDataBuffer?.destroy();
        this.paramsBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// INTEGRATION HELPERS
// ============================================================================

/**
 * Create a voxel getter function from ChunkManager
 * @param {ChunkManager} chunkManager - The chunk manager instance
 * @returns {Function} (x, y, z) => material ID or null
 */
export function createVoxelGetter(chunkManager) {
    return (x, y, z) => {
        const cx = Math.floor(x / CHUNK_SIZE);
        const cy = Math.floor(y / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        
        const chunk = chunkManager.getChunk(cx, cy, cz);
        if (!chunk || !chunk.voxels) {
            return null; // Unloaded
        }
        
        const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        
        const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
        return chunk.voxels[idx];
    };
}

/**
 * Combined LOS check - uses voxels AND AABB obstacles
 * Drop-in replacement for AIAiming.hasLineOfSight
 * 
 * @param {number[]} from - Start position
 * @param {number[]} to - End position
 * @param {Array} obstacles - AABB obstacles array
 * @param {Function} getVoxel - Voxel getter function
 * @param {Object} options - Additional options
 * @returns {boolean} True if line of sight is clear
 */
export function hasLineOfSightCombined(from, to, obstacles, getVoxel, options = {}) {
    // First check voxels (usually faster for terrain)
    if (getVoxel && !hasVoxelLineOfSight(from, to, getVoxel, options)) {
        return false;
    }
    
    // Then check AABB obstacles (entities, etc.)
    if (obstacles && obstacles.length > 0) {
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        const dz = to[2] - from[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (distance < 0.001) return true;
        
        const direction = [dx / distance, dy / distance, dz / distance];
        const EPSILON = 1e-10;
        const invDir = [
            1 / (Math.abs(direction[0]) < EPSILON ? EPSILON : direction[0]),
            1 / (Math.abs(direction[1]) < EPSILON ? EPSILON : direction[1]),
            1 / (Math.abs(direction[2]) < EPSILON ? EPSILON : direction[2]),
        ];
        
        for (const obs of obstacles) {
            // Slab method ray-AABB
            const t1x = (obs.min[0] - from[0]) * invDir[0];
            const t2x = (obs.max[0] - from[0]) * invDir[0];
            let tmin = Math.min(t1x, t2x);
            let tmax = Math.max(t1x, t2x);
            
            const t1y = (obs.min[1] - from[1]) * invDir[1];
            const t2y = (obs.max[1] - from[1]) * invDir[1];
            tmin = Math.max(tmin, Math.min(t1y, t2y));
            tmax = Math.min(tmax, Math.max(t1y, t2y));
            
            const t1z = (obs.min[2] - from[2]) * invDir[2];
            const t2z = (obs.max[2] - from[2]) * invDir[2];
            tmin = Math.max(tmin, Math.min(t1z, t2z));
            tmax = Math.min(tmax, Math.max(t1z, t2z));
            
            if (tmax >= Math.max(tmin, 0) && tmin < distance) {
                return false;
            }
        }
    }
    
    return true;
}

// ============================================================================
// PIXEL-TO-RAY MATRIX (DeadlockCode optimization)
// ============================================================================

/**
 * Compute a single matrix that transforms screen pixel coords to world-space ray directions.
 * This avoids per-pixel matrix multiplications in shaders.
 * 
 * Usage: rayDir = normalize((pixelToRay * vec4(pixelX, pixelY, 1, 1)).xyz - cameraPos)
 * 
 * @param {number[]} cameraPos - Camera world position [x, y, z]
 * @param {number[]} cameraRotation - Euler angles [pitch, yaw, roll] in radians
 * @param {number} fovRad - Field of view in radians
 * @param {number} screenWidth - Screen width in pixels
 * @param {number} screenHeight - Screen height in pixels
 * @returns {Float32Array} 4x4 matrix (column-major)
 */
export function computePixelToRayMatrix(cameraPos, cameraRotation, fovRad, screenWidth, screenHeight) {
    const aspect = screenWidth / screenHeight;
    const tanFov = Math.tan(fovRad * 0.5);
    
    // Center pixel offset (0.5 for pixel center)
    // Pixel to UV: map [0, width] → [-1, 1]
    const pixelToUvScaleX = 2.0 / screenWidth;
    const pixelToUvScaleY = -2.0 / screenHeight; // Flip Y
    const pixelToUvOffsetX = -1.0;
    const pixelToUvOffsetY = 1.0;
    
    // UV to view: apply FOV and aspect
    const uvToViewX = tanFov * Math.max(aspect, 1.0);
    const uvToViewY = tanFov / Math.min(aspect, 1.0);
    
    // Rotation matrix (pitch around X, yaw around Y, roll around Z)
    const [pitch, yaw, roll] = cameraRotation;
    const cx = Math.cos(pitch), sx = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cz = Math.cos(roll), sz = Math.sin(roll);
    
    // Combined rotation: Z * X * Y
    const r00 = cy * cz + sy * sx * sz;
    const r01 = -cy * sz + sy * sx * cz;
    const r02 = sy * cx;
    const r10 = cx * sz;
    const r11 = cx * cz;
    const r12 = -sx;
    const r20 = -sy * cz + cy * sx * sz;
    const r21 = sy * sz + cy * sx * cz;
    const r22 = cy * cx;
    
    // Build combined matrix: Translation * Rotation * UvToView * PixelToUv
    // Simplified: just combine scale/offset for final matrix
    const scaleX = pixelToUvScaleX * uvToViewX;
    const scaleY = pixelToUvScaleY * uvToViewY;
    const offsetX = (pixelToUvOffsetX + 0.5 * pixelToUvScaleX) * uvToViewX;
    const offsetY = (pixelToUvOffsetY + 0.5 * pixelToUvScaleY) * uvToViewY;
    
    // Column-major 4x4 matrix
    return new Float32Array([
        r00 * scaleX, r10 * scaleX, r20 * scaleX, 0,
        r01 * scaleY, r11 * scaleY, r21 * scaleY, 0,
        r02, r12, r22, 0,
        cameraPos[0] + r00 * offsetX + r01 * offsetY,
        cameraPos[1] + r10 * offsetX + r11 * offsetY,
        cameraPos[2] + r20 * offsetX + r21 * offsetY,
        1
    ]);
}

/**
 * Generate ray from screen pixel using precomputed pixel-to-ray matrix
 * @param {number} pixelX - Screen X coordinate
 * @param {number} pixelY - Screen Y coordinate
 * @param {Float32Array} pixelToRay - 4x4 matrix from computePixelToRayMatrix
 * @param {number[]} cameraPos - Camera position for ray origin
 * @returns {Object} {origin, direction}
 */
export function screenPixelToRay(pixelX, pixelY, pixelToRay, cameraPos) {
    // Transform pixel to world point on far plane
    const farX = pixelToRay[0] * pixelX + pixelToRay[4] * pixelY + pixelToRay[8] + pixelToRay[12];
    const farY = pixelToRay[1] * pixelX + pixelToRay[5] * pixelY + pixelToRay[9] + pixelToRay[13];
    const farZ = pixelToRay[2] * pixelX + pixelToRay[6] * pixelY + pixelToRay[10] + pixelToRay[14];
    
    // Direction from camera to far point
    const dx = farX - cameraPos[0];
    const dy = farY - cameraPos[1];
    const dz = farZ - cameraPos[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    return {
        origin: [...cameraPos],
        direction: [dx / len, dy / len, dz / len],
    };
}

// ============================================================================
// DEBUG VISUALIZATION MODES
// ============================================================================

/** Debug render modes for raycast visualization */
export const RAYCAST_DEBUG_MODE = {
    NONE: 0,      // Normal rendering
    STEPS: 1,     // Heat map of ray steps (performance)
    NORMAL: 2,    // Surface normal visualization
    DEPTH: 3,     // Depth buffer visualization
    MATERIAL: 4,  // Material ID coloring
};

/**
 * Raycast with step counting for performance debugging
 * @param {number[]} origin - Ray origin
 * @param {number[]} direction - Normalized direction
 * @param {Function} getVoxel - Voxel getter
 * @param {number} maxDistance - Max distance
 * @returns {Object} {hit, steps, distance, ...}
 */
export function raycastVoxelsDebug(origin, direction, getVoxel, maxDistance = 100) {
    let steps = 0;
    const EPSILON = 1e-10;
    const dir = [
        Math.abs(direction[0]) < EPSILON ? EPSILON : direction[0],
        Math.abs(direction[1]) < EPSILON ? EPSILON : direction[1],
        Math.abs(direction[2]) < EPSILON ? EPSILON : direction[2],
    ];
    
    const invDir = [1 / dir[0], 1 / dir[1], 1 / dir[2]];
    const step = [dir[0] > 0 ? 1 : -1, dir[1] > 0 ? 1 : -1, dir[2] > 0 ? 1 : -1];
    const voxel = [Math.floor(origin[0]), Math.floor(origin[1]), Math.floor(origin[2])];
    
    const tMax = [
        (voxel[0] + (step[0] > 0 ? 1 : 0) - origin[0]) * invDir[0],
        (voxel[1] + (step[1] > 0 ? 1 : 0) - origin[1]) * invDir[1],
        (voxel[2] + (step[2] > 0 ? 1 : 0) - origin[2]) * invDir[2],
    ];
    const tDelta = [Math.abs(invDir[0]), Math.abs(invDir[1]), Math.abs(invDir[2])];
    
    let distance = 0;
    let steppedAxis = -1;
    
    while (distance < maxDistance) {
        steps++;
        
        if (tMax[0] < tMax[1]) {
            if (tMax[0] < tMax[2]) {
                steppedAxis = 0; distance = tMax[0]; voxel[0] += step[0]; tMax[0] += tDelta[0];
            } else {
                steppedAxis = 2; distance = tMax[2]; voxel[2] += step[2]; tMax[2] += tDelta[2];
            }
        } else {
            if (tMax[1] < tMax[2]) {
                steppedAxis = 1; distance = tMax[1]; voxel[1] += step[1]; tMax[1] += tDelta[1];
            } else {
                steppedAxis = 2; distance = tMax[2]; voxel[2] += step[2]; tMax[2] += tDelta[2];
            }
        }
        
        if (distance > maxDistance) break;
        
        const material = getVoxel(voxel[0], voxel[1], voxel[2]);
        if (material !== null && material !== MATERIAL.AIR && material !== MATERIAL.WATER) {
            const normal = [0, 0, 0];
            normal[steppedAxis] = -step[steppedAxis];
            
            return {
                hit: true,
                steps,
                distance,
                voxelCoord: [...voxel],
                material,
                normal,
                position: [
                    origin[0] + dir[0] * distance,
                    origin[1] + dir[1] * distance,
                    origin[2] + dir[2] * distance,
                ],
            };
        }
    }
    
    return { hit: false, steps, distance: maxDistance };
}

/**
 * Convert step count to heat map color (inferno palette)
 * @param {number} steps - Number of ray steps
 * @param {number} maxSteps - Maximum expected steps (for normalization)
 * @returns {number[]} [r, g, b] in 0-1 range
 */
export function stepsToHeatColor(steps, maxSteps = 300) {
    const t = Math.min(1, steps / maxSteps);
    
    // Inferno color palette coefficients (from DeadlockCode)
    const c0 = [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184];
    const c1 = [0.1065134194856116, 0.5639564367884091, 3.932712388889277];
    const c2 = [11.60249308247187, -3.972853965665698, -15.9423941062914];
    const c3 = [-41.70399613139459, 17.43639888205313, 44.35414519872813];
    const c4 = [77.162935699427, -33.40235894210092, -81.80730925738993];
    const c5 = [-71.31942824499214, 32.62606426397723, 73.20951985803202];
    const c6 = [25.13112622477341, -12.24266895238567, -23.07032500287172];
    
    // Horner's method polynomial evaluation
    const r = c0[0] + t * (c1[0] + t * (c2[0] + t * (c3[0] + t * (c4[0] + t * (c5[0] + t * c6[0])))));
    const g = c0[1] + t * (c1[1] + t * (c2[1] + t * (c3[1] + t * (c4[1] + t * (c5[1] + t * c6[1])))));
    const b = c0[2] + t * (c1[2] + t * (c2[2] + t * (c3[2] + t * (c4[2] + t * (c5[2] + t * c6[2])))));
    
    return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}

// ============================================================================
// TRIANGLE-VOXEL INTERSECTION (for mesh voxelization)
// ============================================================================

/**
 * Check if a triangle intersects a voxel using separating axis theorem.
 * Based on DeadlockCode's implementation.
 * 
 * @param {number[]} a - Triangle vertex A [x, y, z]
 * @param {number[]} b - Triangle vertex B [x, y, z]
 * @param {number[]} c - Triangle vertex C [x, y, z]
 * @param {number[]} voxelMin - Voxel minimum corner [x, y, z]
 * @param {number[]} voxelMax - Voxel maximum corner [x, y, z]
 * @returns {boolean} True if triangle intersects voxel
 */
export function triangleVoxelIntersect(a, b, c, voxelMin, voxelMax) {
    // Triangle normal
    const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0],
    ];
    
    // Voxel center and half-size
    const center = [
        (voxelMin[0] + voxelMax[0]) * 0.5,
        (voxelMin[1] + voxelMax[1]) * 0.5,
        (voxelMin[2] + voxelMax[2]) * 0.5,
    ];
    const half = [
        (voxelMax[0] - voxelMin[0]) * 0.5,
        (voxelMax[1] - voxelMin[1]) * 0.5,
        (voxelMax[2] - voxelMin[2]) * 0.5,
    ];
    
    // Translate triangle relative to voxel center
    const v0 = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
    const v1 = [b[0] - center[0], b[1] - center[1], b[2] - center[2]];
    const v2 = [c[0] - center[0], c[1] - center[1], c[2] - center[2]];
    
    // Test AABB axes (X, Y, Z)
    for (let i = 0; i < 3; i++) {
        const min = Math.min(v0[i], v1[i], v2[i]);
        const max = Math.max(v0[i], v1[i], v2[i]);
        if (min > half[i] || max < -half[i]) return false;
    }
    
    // Test triangle normal axis
    const d = n[0] * v0[0] + n[1] * v0[1] + n[2] * v0[2];
    const r = half[0] * Math.abs(n[0]) + half[1] * Math.abs(n[1]) + half[2] * Math.abs(n[2]);
    if (Math.abs(d) > r) return false;
    
    // Test 9 edge cross products (3 edges × 3 axes)
    const edges = [
        [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]],
        [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]],
        [v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]],
    ];
    const verts = [v0, v1, v2];
    
    for (let i = 0; i < 3; i++) {
        const e = edges[i];
        for (let j = 0; j < 3; j++) {
            // Cross product of edge with axis j
            const axis = [0, 0, 0];
            axis[(j + 1) % 3] = -e[(j + 2) % 3];
            axis[(j + 2) % 3] = e[(j + 1) % 3];
            
            const p0 = axis[0] * verts[0][0] + axis[1] * verts[0][1] + axis[2] * verts[0][2];
            const p1 = axis[0] * verts[1][0] + axis[1] * verts[1][1] + axis[2] * verts[1][2];
            const p2 = axis[0] * verts[2][0] + axis[1] * verts[2][1] + axis[2] * verts[2][2];
            
            const r = half[0] * Math.abs(axis[0]) + half[1] * Math.abs(axis[1]) + half[2] * Math.abs(axis[2]);
            if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false;
        }
    }
    
    return true;
}

/**
 * Voxelize a triangle mesh into a voxel grid
 * @param {Array} vertices - Array of [x, y, z] vertices
 * @param {Array} triangles - Array of [i0, i1, i2] index triplets
 * @param {number} resolution - Grid resolution per axis
 * @param {number[]} boundsMin - Bounding box minimum
 * @param {number[]} boundsMax - Bounding box maximum
 * @returns {Uint8Array} Voxel grid (1 = solid, 0 = empty)
 */
export function voxelizeMesh(vertices, triangles, resolution, boundsMin, boundsMax) {
    const voxels = new Uint8Array(resolution * resolution * resolution);
    const scale = [
        resolution / (boundsMax[0] - boundsMin[0]),
        resolution / (boundsMax[1] - boundsMin[1]),
        resolution / (boundsMax[2] - boundsMin[2]),
    ];
    
    // Transform vertices to grid space
    const gridVerts = vertices.map(v => [
        (v[0] - boundsMin[0]) * scale[0],
        (v[1] - boundsMin[1]) * scale[1],
        (v[2] - boundsMin[2]) * scale[2],
    ]);
    
    for (const tri of triangles) {
        const a = gridVerts[tri[0]];
        const b = gridVerts[tri[1]];
        const c = gridVerts[tri[2]];
        
        // Triangle bounding box in grid coords
        const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
        const maxX = Math.min(resolution - 1, Math.floor(Math.max(a[0], b[0], c[0])));
        const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
        const maxY = Math.min(resolution - 1, Math.floor(Math.max(a[1], b[1], c[1])));
        const minZ = Math.max(0, Math.floor(Math.min(a[2], b[2], c[2])));
        const maxZ = Math.min(resolution - 1, Math.floor(Math.max(a[2], b[2], c[2])));
        
        // Check each voxel in bounding box
        for (let z = minZ; z <= maxZ; z++) {
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    if (triangleVoxelIntersect(a, b, c, [x, y, z], [x + 1, y + 1, z + 1])) {
                        voxels[x + y * resolution + z * resolution * resolution] = 1;
                    }
                }
            }
        }
    }
    
    return voxels;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
    VOXEL_RAYCAST_SHADER,
    MAX_RAY_DISTANCE,
};
