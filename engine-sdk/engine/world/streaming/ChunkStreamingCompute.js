// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkStreamingCompute.js - GPU-Accelerated Chunk Streaming
 * 
 * Uses compute shaders to:
 * 1. Calculate which chunks need loading/unloading in parallel
 * 2. Generate terrain data (noise functions) on GPU
 * 3. Batch process multiple chunks per frame
 * 
 * The actual chunk object management remains on CPU (JavaScript requirement),
 * but all heavy computation is offloaded to GPU.
 * 
 * Can optionally use GPUWorldGenerator for advanced terrain (biomes, caves, structures).
 */

import { GPUWorldGenerator } from '../generation/GPUWorldGenerator.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _chunkUnloadCountReset = new Uint32Array([0]);
const _chunkTerrainParamsF32 = new Float32Array(16);
const _chunkSolidCountReset = new Uint32Array([0]);

// ============================================================================
// SHADER SOURCES
// ============================================================================

// Compute shader to determine which chunk positions need loading
const CHUNK_DISTANCE_SHADER = /* wgsl */ `
struct Params {
    playerChunkX: i32,
    playerChunkY: i32,
    playerChunkZ: i32,
    loadRadiusSq: f32,
    unloadRadiusSq: f32,
    minY: i32,
    maxY: i32,
    maxResults: u32,
}

struct ChunkCandidate {
    cx: i32,
    cy: i32,
    cz: i32,
    distSq: f32,
    action: u32,  // 0 = none, 1 = load, 2 = unload
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> existingChunks: array<vec4<i32>>;  // cx, cy, cz, exists
@group(0) @binding(2) var<storage, read_write> loadCandidates: array<ChunkCandidate>;
@group(0) @binding(3) var<storage, read_write> unloadCandidates: array<ChunkCandidate>;
@group(0) @binding(4) var<storage, read_write> loadCount: atomic<u32>;
@group(0) @binding(5) var<storage, read_write> unloadCount: atomic<u32>;

@compute @workgroup_size(64)
fn checkUnload(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    let chunkData = existingChunks[idx];
    
    // Skip if no chunk at this slot
    if (chunkData.w == 0) {
        return;
    }
    
    let cx = chunkData.x;
    let cy = chunkData.y;
    let cz = chunkData.z;
    
    let dx = f32(cx - params.playerChunkX);
    let dy = f32(cy - params.playerChunkY);
    let dz = f32(cz - params.playerChunkZ);
    let distSq = dx * dx + dy * dy + dz * dz;
    
    if (distSq > params.unloadRadiusSq) {
        let resultIdx = atomicAdd(&unloadCount, 1u);
        if (resultIdx < params.maxResults) {
            unloadCandidates[resultIdx] = ChunkCandidate(cx, cy, cz, distSq, 2u);
        }
    }
}

@compute @workgroup_size(4, 4, 4)
fn checkLoad(@builtin(global_invocation_id) gid: vec3<u32>) {
    // gid represents offset from player chunk
    let radius = gid.x;
    if (radius == 0u && gid.y == 0u && gid.z == 0u) {
        return;  // Skip center (already processed differently)
    }
    
    // Convert to signed offset
    let maxRadius = 16;  // Max radius we check
    let ox = i32(gid.x) - maxRadius;
    let oy = i32(gid.y) - maxRadius;
    let oz = i32(gid.z) - maxRadius;
    
    let cx = params.playerChunkX + ox;
    let cy = params.playerChunkY + oy;
    let cz = params.playerChunkZ + oz;
    
    // Y bounds check
    if (cy < params.minY || cy > params.maxY) {
        return;
    }
    
    // Distance check
    let dx = f32(ox);
    let dy = f32(oy);
    let dz = f32(oz);
    let distSq = dx * dx + dy * dy + dz * dz;
    
    if (distSq > params.loadRadiusSq) {
        return;
    }
    
    // Check if chunk already exists (linear search through existing)
    // Note: In production, use a spatial hash lookup
    let resultIdx = atomicAdd(&loadCount, 1u);
    if (resultIdx < params.maxResults) {
        loadCandidates[resultIdx] = ChunkCandidate(cx, cy, cz, distSq, 1u);
    }
}
`;

// GPU terrain generation using 3D noise - BATCH VERSION (8 chunks per dispatch)
const BATCH_CHUNKS = 8;  // Generate 8 chunks per dispatch

const TERRAIN_GEN_SHADER = /* wgsl */ `
const CHUNK_SIZE: u32 = 32u;
const CHUNK_SIZE_SQ: u32 = 1024u;
const CHUNK_VOLUME: u32 = 32768u;
const BATCH_SIZE: u32 = 8u;  // 8 chunks per dispatch

struct TerrainParams {
    chunkWorldX: f32,
    chunkWorldY: f32,
    chunkWorldZ: f32,
    seed: u32,
    // Noise parameters
    baseFreq: f32,
    amplitude: f32,
    octaves: u32,
    lacunarity: f32,
    persistence: f32,
    // Terrain thresholds
    surfaceLevel: f32,
    caveThreshold: f32,
    oreThreshold: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

// Batch params - 8 chunk positions
struct BatchParams {
    seed: u32,
    numChunks: u32,
    baseFreq: f32,
    amplitude: f32,
    octaves: u32,
    lacunarity: f32,
    persistence: f32,
    caveThreshold: f32,
    // Chunk world positions (8 chunks max)
    chunk0: vec4<f32>,  // x, y, z, unused
    chunk1: vec4<f32>,
    chunk2: vec4<f32>,
    chunk3: vec4<f32>,
    chunk4: vec4<f32>,
    chunk5: vec4<f32>,
    chunk6: vec4<f32>,
    chunk7: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: TerrainParams;
@group(0) @binding(1) var<storage, read_write> voxels: array<u32>;  // Material IDs
@group(0) @binding(2) var<storage, read_write> solidCount: atomic<u32>;

// Permutation table for noise (simplified)
fn hash(n: u32) -> u32 {
    var x = n;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = (x >> 16u) ^ x;
    return x;
}

fn hashFloat(n: u32) -> f32 {
    return f32(hash(n) & 0x7FFFFFu) / f32(0x7FFFFF);
}

fn hash3D(x: i32, y: i32, z: i32, seed: u32) -> f32 {
    let n = u32(x) + u32(y) * 374761393u + u32(z) * 668265263u + seed;
    return hashFloat(n) * 2.0 - 1.0;
}

// Simple 3D value noise
fn noise3D(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    let ix = i32(floor(x));
    let iy = i32(floor(y));
    let iz = i32(floor(z));
    
    let fx = x - f32(ix);
    let fy = y - f32(iy);
    let fz = z - f32(iz);
    
    // Smoothstep
    let ux = fx * fx * (3.0 - 2.0 * fx);
    let uy = fy * fy * (3.0 - 2.0 * fy);
    let uz = fz * fz * (3.0 - 2.0 * fz);
    
    // 8 corners
    let c000 = hash3D(ix, iy, iz, seed);
    let c100 = hash3D(ix + 1, iy, iz, seed);
    let c010 = hash3D(ix, iy + 1, iz, seed);
    let c110 = hash3D(ix + 1, iy + 1, iz, seed);
    let c001 = hash3D(ix, iy, iz + 1, seed);
    let c101 = hash3D(ix + 1, iy, iz + 1, seed);
    let c011 = hash3D(ix, iy + 1, iz + 1, seed);
    let c111 = hash3D(ix + 1, iy + 1, iz + 1, seed);
    
    // Trilinear interpolation
    let c00 = mix(c000, c100, ux);
    let c10 = mix(c010, c110, ux);
    let c01 = mix(c001, c101, ux);
    let c11 = mix(c011, c111, ux);
    
    let c0 = mix(c00, c10, uy);
    let c1 = mix(c01, c11, uy);
    
    return mix(c0, c1, uz);
}

// Fractal Brownian Motion
fn fbm(x: f32, y: f32, z: f32, seed: u32, octaves: u32, lacunarity: f32, persistence: f32) -> f32 {
    var total = 0.0;
    var frequency = 1.0;
    var amplitude = 1.0;
    var maxValue = 0.0;
    
    for (var i = 0u; i < octaves; i++) {
        total += noise3D(x * frequency, y * frequency, z * frequency, seed + i) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    
    return total / maxValue;
}

// Ridged noise for caves
fn ridgedNoise(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    return 1.0 - abs(noise3D(x, y, z, seed));
}

// Material constants
const MAT_AIR: u32 = 0u;
const MAT_STONE: u32 = 1u;
const MAT_DIRT: u32 = 2u;
const MAT_GRASS: u32 = 3u;
const MAT_SAND: u32 = 4u;
const MAT_DEEPSTONE: u32 = 9u;

@compute @workgroup_size(4, 4, 4)
fn generateTerrain(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= CHUNK_SIZE || gid.y >= CHUNK_SIZE || gid.z >= CHUNK_SIZE) {
        return;
    }
    
    let idx = gid.x + gid.y * CHUNK_SIZE + gid.z * CHUNK_SIZE_SQ;
    
    // World position
    let wx = params.chunkWorldX + f32(gid.x);
    let wy = params.chunkWorldY + f32(gid.y);
    let wz = params.chunkWorldZ + f32(gid.z);
    
    // Height-based density (denser below surface)
    let baseDensity = -wy / 32.0;  // Positive below y=0
    
    // 3D noise for terrain variation
    let terrainNoise = fbm(
        wx * params.baseFreq,
        wy * params.baseFreq,
        wz * params.baseFreq,
        params.seed,
        params.octaves,
        params.lacunarity,
        params.persistence
    ) * params.amplitude;
    
    // Combined density
    var density = baseDensity + terrainNoise;
    
    // Cave carving using ridged noise
    let caveNoise1 = ridgedNoise(wx * 0.03, wy * 0.03, wz * 0.03, params.seed + 100u);
    let caveNoise2 = ridgedNoise(wx * 0.05, wy * 0.05, wz * 0.05, params.seed + 200u);
    let caveFactor = caveNoise1 * caveNoise2;
    
    // Carve caves
    if (caveFactor > params.caveThreshold && wy < 0.0) {
        density = -1.0;  // Force air
    }
    
    // Determine material
    var material = MAT_AIR;
    
    if (density > 0.0) {
        // Solid voxel
        if (wy < -50.0) {
            material = MAT_DEEPSTONE;
        } else if (wy < -10.0) {
            material = MAT_STONE;
        } else if (wy < -1.0) {
            material = MAT_DIRT;
        } else {
            // Surface - check if exposed
            let aboveDensity = baseDensity - 1.0/32.0 + fbm(
                wx * params.baseFreq,
                (wy + 1.0) * params.baseFreq,
                wz * params.baseFreq,
                params.seed,
                params.octaves,
                params.lacunarity,
                params.persistence
            ) * params.amplitude;
            
            if (aboveDensity <= 0.0) {
                material = MAT_GRASS;
            } else {
                material = MAT_DIRT;
            }
        }
        
        atomicAdd(&solidCount, 1u);
    }
    
    voxels[idx] = material;
}
`;

// BATCH terrain generation - 8 chunks in single dispatch for 4-8x speedup
const BATCH_TERRAIN_SHADER = /* wgsl */ `
const CHUNK_SIZE: u32 = 32u;
const CHUNK_SIZE_SQ: u32 = 1024u;
const CHUNK_VOLUME: u32 = 32768u;
const BATCH_SIZE: u32 = 8u;

struct BatchParams {
    seed: u32,
    numChunks: u32,
    baseFreq: f32,
    amplitude: f32,
    octaves: u32,
    lacunarity: f32,
    persistence: f32,
    caveThreshold: f32,
    // Chunk world positions (8 chunks) - packed as vec4 (x,y,z,0)
    chunks: array<vec4<f32>, 8>,
}

@group(0) @binding(0) var<uniform> params: BatchParams;
@group(0) @binding(1) var<storage, read_write> voxels: array<u32>;  // 8 chunks * 32768 voxels
@group(0) @binding(2) var<storage, read_write> solidCounts: array<atomic<u32>, 8>;  // Per-chunk counts

fn hash(n: u32) -> u32 {
    var x = n;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = (x >> 16u) ^ x;
    return x;
}

fn hashFloat(n: u32) -> f32 {
    return f32(hash(n) & 0x7FFFFFu) / f32(0x7FFFFF);
}

fn hash3D(x: i32, y: i32, z: i32, seed: u32) -> f32 {
    let n = u32(x) + u32(y) * 374761393u + u32(z) * 668265263u + seed;
    return hashFloat(n) * 2.0 - 1.0;
}

fn noise3D(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    let ix = i32(floor(x));
    let iy = i32(floor(y));
    let iz = i32(floor(z));
    
    let fx = x - f32(ix);
    let fy = y - f32(iy);
    let fz = z - f32(iz);
    
    let ux = fx * fx * (3.0 - 2.0 * fx);
    let uy = fy * fy * (3.0 - 2.0 * fy);
    let uz = fz * fz * (3.0 - 2.0 * fz);
    
    let c000 = hash3D(ix, iy, iz, seed);
    let c100 = hash3D(ix + 1, iy, iz, seed);
    let c010 = hash3D(ix, iy + 1, iz, seed);
    let c110 = hash3D(ix + 1, iy + 1, iz, seed);
    let c001 = hash3D(ix, iy, iz + 1, seed);
    let c101 = hash3D(ix + 1, iy, iz + 1, seed);
    let c011 = hash3D(ix, iy + 1, iz + 1, seed);
    let c111 = hash3D(ix + 1, iy + 1, iz + 1, seed);
    
    let c00 = mix(c000, c100, ux);
    let c10 = mix(c010, c110, ux);
    let c01 = mix(c001, c101, ux);
    let c11 = mix(c011, c111, ux);
    
    let c0 = mix(c00, c10, uy);
    let c1 = mix(c01, c11, uy);
    
    return mix(c0, c1, uz);
}

fn fbm(x: f32, y: f32, z: f32, seed: u32, octaves: u32, lacunarity: f32, persistence: f32) -> f32 {
    var total = 0.0;
    var frequency = 1.0;
    var amplitude = 1.0;
    var maxValue = 0.0;
    
    for (var i = 0u; i < octaves; i++) {
        total += noise3D(x * frequency, y * frequency, z * frequency, seed + i) * amplitude;
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    
    return total / maxValue;
}

fn ridgedNoise(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    return 1.0 - abs(noise3D(x, y, z, seed));
}

const MAT_AIR: u32 = 0u;
const MAT_STONE: u32 = 1u;
const MAT_DIRT: u32 = 2u;
const MAT_GRASS: u32 = 3u;
const MAT_DEEPSTONE: u32 = 9u;

// Workgroup: 4x4x4 voxels, dispatch 8x8x8 per chunk, 8 chunks via Z batching
@compute @workgroup_size(4, 4, 4)
fn generateBatchTerrain(@builtin(global_invocation_id) gid: vec3<u32>) {
    // gid.z encodes both chunk index and local z
    // Total Z dispatch = 8 chunks * 8 workgroups = 64
    let chunkIdx = gid.z / CHUNK_SIZE;
    let localZ = gid.z % CHUNK_SIZE;
    
    if (chunkIdx >= params.numChunks || gid.x >= CHUNK_SIZE || gid.y >= CHUNK_SIZE) {
        return;
    }
    
    // Get chunk world position
    let chunkWorld = params.chunks[chunkIdx];
    
    // Calculate voxel index in the big buffer
    // Each chunk is CHUNK_VOLUME apart
    let localIdx = gid.x + gid.y * CHUNK_SIZE + localZ * CHUNK_SIZE_SQ;
    let globalIdx = chunkIdx * CHUNK_VOLUME + localIdx;
    
    // World position
    let wx = chunkWorld.x + f32(gid.x);
    let wy = chunkWorld.y + f32(gid.y);
    let wz = chunkWorld.z + f32(localZ);
    
    // Height-based density
    let baseDensity = -wy / 32.0;
    
    // 3D noise for terrain variation
    let terrainNoise = fbm(
        wx * params.baseFreq,
        wy * params.baseFreq,
        wz * params.baseFreq,
        params.seed,
        params.octaves,
        params.lacunarity,
        params.persistence
    ) * params.amplitude;
    
    var density = baseDensity + terrainNoise;
    
    // Cave carving
    let caveNoise1 = ridgedNoise(wx * 0.03, wy * 0.03, wz * 0.03, params.seed + 100u);
    let caveNoise2 = ridgedNoise(wx * 0.05, wy * 0.05, wz * 0.05, params.seed + 200u);
    let caveFactor = caveNoise1 * caveNoise2;
    
    if (caveFactor > params.caveThreshold && wy < 0.0) {
        density = -1.0;
    }
    
    var material = MAT_AIR;
    
    if (density > 0.0) {
        if (wy < -50.0) {
            material = MAT_DEEPSTONE;
        } else if (wy < -10.0) {
            material = MAT_STONE;
        } else if (wy < -1.0) {
            material = MAT_DIRT;
        } else {
            let aboveDensity = baseDensity - 1.0/32.0 + fbm(
                wx * params.baseFreq,
                (wy + 1.0) * params.baseFreq,
                wz * params.baseFreq,
                params.seed,
                params.octaves,
                params.lacunarity,
                params.persistence
            ) * params.amplitude;
            
            if (aboveDensity <= 0.0) {
                material = MAT_GRASS;
            } else {
                material = MAT_DIRT;
            }
        }
        
        atomicAdd(&solidCounts[chunkIdx], 1u);
    }
    
    voxels[globalIdx] = material;
}
`;

// ============================================================================
// CHUNK STREAMING COMPUTE CLASS
// ============================================================================

export class ChunkStreamingCompute {
    constructor() {
        this.device = null;
        
        // Pipelines
        this.unloadCheckPipeline = null;
        this.loadCheckPipeline = null;
        this.terrainGenPipeline = null;
        this.batchTerrainPipeline = null;  // 8-chunk batch generation
        
        // Layouts
        this.distanceLayout = null;
        this.terrainLayout = null;
        this.batchTerrainLayout = null;
        
        // Buffers
        this.paramsBuffer = null;
        this.existingChunksBuffer = null;
        this.loadCandidatesBuffer = null;
        this.unloadCandidatesBuffer = null;
        this.loadCountBuffer = null;
        this.unloadCountBuffer = null;
        this.countReadback = null;
        this.candidatesReadback = null;
        
        // Terrain generation buffers (pool for batch processing)
        this.terrainParamsBuffer = null;
        this.terrainVoxelBuffers = [];  // Pool of voxel buffers
        this.terrainSolidCountBuffers = [];
        this.terrainReadbackBuffers = [];
        this.bufferInUse = [];  // Track which buffers are currently being used
        
        // Batch terrain buffers (8 chunks per dispatch)
        this.batchParamsBuffer = null;
        this.batchVoxelBuffer = null;      // 8 chunks * 32768 voxels
        this.batchSolidCountBuffer = null; // 8 solid counts
        this.batchReadbackBuffer = null;   // For reading results
        this.batchCountReadback = null;    // For reading solid counts
        
        // Advanced terrain generator (GPUWorldGenerator with biomes, caves, structures)
        this.useAdvancedGenerator = false;
        this.advancedGenerator = null;
        this.worldGenConfig = null;
        
        // Config - AGGRESSIVE for fast loading
        this.maxExistingChunks = 8192;
        this.maxCandidates = 512;
        this.batchSize = 64;  // Generate up to 64 chunks per frame (doubled)
        
        this.initialized = false;
        this.pendingGeneration = false;  // Prevent concurrent batch calls
    }
    
    /**
     * Initialize the GPU streaming system
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.device = device;
        
        // Create shader modules
        const distanceModule = device.createShaderModule({
            label: 'Chunk Distance Shader',
            code: CHUNK_DISTANCE_SHADER,
        });
        
        const terrainModule = device.createShaderModule({
            label: 'Terrain Gen Shader',
            code: TERRAIN_GEN_SHADER,
        });
        
        // Create bind group layouts
        this.distanceLayout = device.createBindGroupLayout({
            label: 'Distance Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        this.terrainLayout = device.createBindGroupLayout({
            label: 'Terrain Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        // Create pipelines
        this.unloadCheckPipeline = device.createComputePipeline({
            label: 'Unload Check Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.distanceLayout] }),
            compute: { module: distanceModule, entryPoint: 'checkUnload' },
        });
        
        this.terrainGenPipeline = device.createComputePipeline({
            label: 'Terrain Gen Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.terrainLayout] }),
            compute: { module: terrainModule, entryPoint: 'generateTerrain' },
        });
        
        // Create batch terrain pipeline (8 chunks per dispatch)
        const batchTerrainModule = device.createShaderModule({
            label: 'Batch Terrain Gen Shader',
            code: BATCH_TERRAIN_SHADER,
        });
        
        this.batchTerrainLayout = device.createBindGroupLayout({
            label: 'Batch Terrain Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        this.batchTerrainPipeline = device.createComputePipeline({
            label: 'Batch Terrain Gen Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.batchTerrainLayout] }),
            compute: { module: batchTerrainModule, entryPoint: 'generateBatchTerrain' },
        });
        
        // Create batch terrain buffers (8 chunks at once)
        const BATCH_CHUNK_VOLUME = 32 * 32 * 32;
        const BATCH_BUFFER_SIZE = BATCH_CHUNKS * BATCH_CHUNK_VOLUME * 4;  // 8 chunks * 32768 voxels * 4 bytes
        
        // Params: 32 bytes header + 8 * 16 bytes for chunk positions = 160 bytes, align to 256
        this.batchParamsBuffer = device.createBuffer({
            label: 'Batch Terrain Params',
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.batchVoxelBuffer = device.createBuffer({
            label: 'Batch Voxels',
            size: BATCH_BUFFER_SIZE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.batchSolidCountBuffer = device.createBuffer({
            label: 'Batch Solid Counts',
            size: BATCH_CHUNKS * 4,  // 8 u32 counts
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        
        this.batchReadbackBuffer = device.createBuffer({
            label: 'Batch Voxels Readback',
            size: BATCH_BUFFER_SIZE,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        this.batchCountReadback = device.createBuffer({
            label: 'Batch Counts Readback',
            size: BATCH_CHUNKS * 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        // Create distance check buffers
        this.paramsBuffer = device.createBuffer({
            label: 'Streaming Params',
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.existingChunksBuffer = device.createBuffer({
            label: 'Existing Chunks',
            size: this.maxExistingChunks * 16,  // vec4<i32> per chunk
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.loadCandidatesBuffer = device.createBuffer({
            label: 'Load Candidates',
            size: this.maxCandidates * 24,  // ChunkCandidate
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.unloadCandidatesBuffer = device.createBuffer({
            label: 'Unload Candidates',
            size: this.maxCandidates * 24,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.loadCountBuffer = device.createBuffer({
            label: 'Load Count',
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        
        this.unloadCountBuffer = device.createBuffer({
            label: 'Unload Count',
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        
        this.countReadback = device.createBuffer({
            label: 'Count Readback',
            size: 8,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        this.candidatesReadback = device.createBuffer({
            label: 'Candidates Readback',
            size: this.maxCandidates * 24,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        // Create terrain generation buffer pool
        this.terrainParamsBuffer = device.createBuffer({
            label: 'Terrain Params',
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        const CHUNK_VOLUME = 32 * 32 * 32;
        for (let i = 0; i < this.batchSize; i++) {
            this.terrainVoxelBuffers.push(device.createBuffer({
                label: `Terrain Voxels ${i}`,
                size: CHUNK_VOLUME * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            }));
            
            this.terrainSolidCountBuffers.push(device.createBuffer({
                label: `Solid Count ${i}`,
                size: 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
            }));
            
            this.terrainReadbackBuffers.push(device.createBuffer({
                label: `Terrain Readback ${i}`,
                size: CHUNK_VOLUME * 4 + 4,  // voxels + solidCount
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            }));
            
            this.bufferInUse.push(false);
        }
        
        this.initialized = true;
        console.log('[ChunkStreamingCompute] Initialized with batch size', this.batchSize);
        
        // Enable advanced terrain generator by default (biomes, caves, structures)
        await this.enableAdvancedGenerator(true, 42069);
    }
    
    /**
     * Enable advanced terrain generation using GPUWorldGenerator
     * Provides biomes, climate, caves, structures, erosion-aware terrain
     * @param {boolean} enable - Whether to use advanced generator
     * @param {number} seed - World seed (optional, uses 42069 if not provided)
     */
    async enableAdvancedGenerator(enable = true, seed = 42069) {
        this.useAdvancedGenerator = enable;
        
        if (enable && !this.advancedGenerator) {
            this.advancedGenerator = new GPUWorldGenerator();
            await this.advancedGenerator.init(this.device);
            this.advancedGenerator.setSeed(seed);
            if (this.worldGenConfig) {
                this.advancedGenerator.setConfig(this.worldGenConfig);
            }
            console.log('[ChunkStreamingCompute] Advanced terrain generator enabled');
        }
        
        if (!enable && this.advancedGenerator) {
            console.log('[ChunkStreamingCompute] Switched to basic terrain generator');
        }
    }
    
    /**
     * Set world seed for terrain generation
     * @param {number} seed
     */
    setWorldSeed(seed) {
        if (this.advancedGenerator) {
            this.advancedGenerator.setSeed(seed);
        }
    }

    setWorldGenConfig(cfg = null) {
        this.worldGenConfig = cfg;
        if (cfg) {
            console.log(
                `[ChunkStreamingCompute] WorldGenConfig: ` +
                `height_scale=${cfg.height_scale ?? 'unset'}, ` +
                `base_height=${cfg.base_height ?? 'unset'}, ` +
                `sea_level=${cfg.sea_level ?? 'unset'}, ` +
                `overhang_strength=${cfg.overhang_strength ?? 'unset'}, ` +
                `caves_enabled=${cfg.caves_enabled ?? 'unset'}, ` +
                `cave_scale=${cfg.cave_scale ?? 'unset'}, ` +
                `cave_threshold=${cfg.cave_threshold ?? 'unset'}`
            );
        }
        if (this.advancedGenerator && cfg) {
            this.advancedGenerator.setConfig(cfg);
        }
    }
    
    /**
     * Find chunks to unload based on distance (GPU accelerated)
     * @param {Map} existingChunks - Current chunk map
     * @param {number[]} playerPos - Player world position
     * @param {number} unloadDistance - Distance to unload chunks
     * @returns {Promise<Array>} Array of {cx, cy, cz} to unload
     */
    async findUnloadCandidates(existingChunks, playerPos, unloadDistance) {
        if (!this.initialized) return [];
        
        // Prevent concurrent buffer mapping operations
        if (this._unloadCheckPending) return [];
        this._unloadCheckPending = true;
        
        const device = this.device;
        const CHUNK_SIZE = 32;
        
        // Upload existing chunk positions
        const chunkArray = new Int32Array(this.maxExistingChunks * 4);
        let idx = 0;
        for (const chunk of existingChunks.values()) {
            if (idx >= this.maxExistingChunks) break;
            chunkArray[idx * 4 + 0] = chunk.cx;
            chunkArray[idx * 4 + 1] = chunk.cy;
            chunkArray[idx * 4 + 2] = chunk.cz;
            chunkArray[idx * 4 + 3] = 1;  // exists
            idx++;
        }
        device.queue.writeBuffer(this.existingChunksBuffer, 0, chunkArray);
        
        // Upload params
        const pcx = Math.floor(playerPos[0] / CHUNK_SIZE);
        const pcy = Math.floor(playerPos[1] / CHUNK_SIZE);
        const pcz = Math.floor(playerPos[2] / CHUNK_SIZE);
        const unloadRadiusSq = (unloadDistance / CHUNK_SIZE) ** 2;
        
        const params = new ArrayBuffer(32);
        const paramsView = new DataView(params);
        paramsView.setInt32(0, pcx, true);
        paramsView.setInt32(4, pcy, true);
        paramsView.setInt32(8, pcz, true);
        paramsView.setFloat32(12, 0, true);  // loadRadiusSq (not used)
        paramsView.setFloat32(16, unloadRadiusSq, true);
        paramsView.setInt32(20, -10, true);  // minY
        paramsView.setInt32(24, 3, true);    // maxY
        paramsView.setUint32(28, this.maxCandidates, true);
        device.queue.writeBuffer(this.paramsBuffer, 0, new Uint8Array(params));
        
        // Reset counts - reuse buffer
        device.queue.writeBuffer(this.unloadCountBuffer, 0, _chunkUnloadCountReset);
        
        // Create bind group
        const bindGroup = device.createBindGroup({
            layout: this.distanceLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.existingChunksBuffer } },
                { binding: 2, resource: { buffer: this.loadCandidatesBuffer } },
                { binding: 3, resource: { buffer: this.unloadCandidatesBuffer } },
                { binding: 4, resource: { buffer: this.loadCountBuffer } },
                { binding: 5, resource: { buffer: this.unloadCountBuffer } },
            ],
        });
        
        // Dispatch compute (skip if no chunks to check)
        const commandEncoder = device.createCommandEncoder();
        if (idx > 0) {
            const pass = commandEncoder.beginComputePass();
            pass.setPipeline(this.unloadCheckPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(idx / 64));
            pass.end();
        }
        
        // Copy results
        commandEncoder.copyBufferToBuffer(this.unloadCountBuffer, 0, this.countReadback, 0, 4);
        device.queue.submit([commandEncoder.finish()]);
        
        // Read back count
        try {
            await this.countReadback.mapAsync(GPUMapMode.READ);
            const count = new Uint32Array(this.countReadback.getMappedRange().slice(0, 4))[0];
            this.countReadback.unmap();
            
            if (count === 0) {
                this._unloadCheckPending = false;
                return [];
            }
            
            // Read back candidates
            const readCount = Math.min(count, this.maxCandidates);
            const encoder = device.createCommandEncoder();
            encoder.copyBufferToBuffer(this.unloadCandidatesBuffer, 0, this.candidatesReadback, 0, readCount * 24);
            device.queue.submit([encoder.finish()]);
            
            await this.candidatesReadback.mapAsync(GPUMapMode.READ);
            const candidateData = new Int32Array(this.candidatesReadback.getMappedRange().slice(0, readCount * 24));
            this.candidatesReadback.unmap();
            
            const results = [];
            for (let i = 0; i < readCount; i++) {
                results.push({
                    cx: candidateData[i * 6 + 0],
                    cy: candidateData[i * 6 + 1],
                    cz: candidateData[i * 6 + 2],
                });
            }
            
            this._unloadCheckPending = false;
            return results;
        } catch (err) {
            this._unloadCheckPending = false;
            console.warn('[ChunkStreamingCompute] findUnloadCandidates error:', err.message);
            return [];
        }
    }
    
    /**
     * Generate terrain for a chunk on GPU
     * @param {number} cx - Chunk X
     * @param {number} cy - Chunk Y
     * @param {number} cz - Chunk Z
     * @param {number} seed - World seed
     * @param {number} bufferIndex - Which buffer in pool to use
     * @returns {Promise<{voxels: Uint32Array, solidCount: number}>}
     */
    async generateTerrain(cx, cy, cz, seed, bufferIndex = 0) {
        if (!this.initialized) return null;
        
        // Use advanced GPU generator if enabled (GPUWorldGenerator with biomes, caves, etc.)
        if (this.useAdvancedGenerator && this.advancedGenerator) {
            if (this.advancedGenerator.seed !== seed) {
                this.advancedGenerator.setSeed(seed);
            }
            const result = await this.advancedGenerator.generateSingle(cx, cy, cz);
            if (result) {
                return { voxels: result.voxels, solidCount: result.solidCount };
            }
            return null;
        }
        
        // Fallback to basic terrain generator
        if (this.bufferInUse[bufferIndex]) return null;  // Buffer already in use
        
        this.bufferInUse[bufferIndex] = true;
        
        const device = this.device;
        const CHUNK_SIZE = 32;
        const CHUNK_VOLUME = CHUNK_SIZE ** 3;
        
        // Upload terrain params
        const params = new Float32Array([
            cx * CHUNK_SIZE,  // chunkWorldX
            cy * CHUNK_SIZE,  // chunkWorldY
            cz * CHUNK_SIZE,  // chunkWorldZ
            seed,             // seed (as float, will be cast to u32)
            0.02,             // baseFreq
            15.0,             // amplitude
            4,                // octaves
            2.0,              // lacunarity
            0.5,              // persistence
            0.0,              // surfaceLevel
            0.7,              // caveThreshold
            0.8,              // oreThreshold
            0, 0, 0, 0,       // padding
        ]);
        const paramsView = new DataView(params.buffer);
        paramsView.setUint32(12, seed, true);  // Proper uint32 for seed
        paramsView.setUint32(24, 4, true);     // Proper uint32 for octaves
        device.queue.writeBuffer(this.terrainParamsBuffer, 0, params);
        
        // Reset solid count - reuse buffer
        device.queue.writeBuffer(this.terrainSolidCountBuffers[bufferIndex], 0, _chunkSolidCountReset);
        
        // Create bind group
        const bindGroup = device.createBindGroup({
            layout: this.terrainLayout,
            entries: [
                { binding: 0, resource: { buffer: this.terrainParamsBuffer } },
                { binding: 1, resource: { buffer: this.terrainVoxelBuffers[bufferIndex] } },
                { binding: 2, resource: { buffer: this.terrainSolidCountBuffers[bufferIndex] } },
            ],
        });
        
        // Dispatch compute (32/4 = 8 workgroups per dimension with 4x4x4 workgroup size)
        const commandEncoder = device.createCommandEncoder();
        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(this.terrainGenPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(8, 8, 8);
        pass.end();
        
        // Copy results to readback buffer
        const readback = this.terrainReadbackBuffers[bufferIndex];
        commandEncoder.copyBufferToBuffer(
            this.terrainVoxelBuffers[bufferIndex], 0,
            readback, 0,
            CHUNK_VOLUME * 4
        );
        commandEncoder.copyBufferToBuffer(
            this.terrainSolidCountBuffers[bufferIndex], 0,
            readback, CHUNK_VOLUME * 4,
            4
        );
        device.queue.submit([commandEncoder.finish()]);
        
        // Read back
        try {
            await readback.mapAsync(GPUMapMode.READ);
            const data = readback.getMappedRange();
            const voxels = new Uint32Array(data.slice(0, CHUNK_VOLUME * 4));
            const solidCount = new Uint32Array(data.slice(CHUNK_VOLUME * 4, CHUNK_VOLUME * 4 + 4))[0];
            readback.unmap();
            return { voxels, solidCount };
        } finally {
            this.bufferInUse[bufferIndex] = false;
        }
    }
    
    /**
     * Batch generate terrain for multiple chunks - 8 chunks per GPU dispatch
     * Uses GPUWorldGenerator if advanced mode is enabled, otherwise basic terrain.
     * @param {Array} chunks - Array of {cx, cy, cz}
     * @param {number} seed - World seed
     * @returns {Promise<Map>} Map of chunkKey to {voxels, solidCount}
     */
    async batchGenerateTerrain(chunks, seed) {
        if (this.pendingGeneration) return new Map();
        if (!this.initialized || chunks.length === 0) return new Map();
        
        // Use advanced generator if enabled
        if (this.useAdvancedGenerator && this.advancedGenerator) {
            return this._batchGenerateAdvanced(chunks, seed);
        }
        
        this.pendingGeneration = true;
        const results = new Map();
        const device = this.device;
        const CHUNK_SIZE = 32;
        const CHUNK_VOLUME = CHUNK_SIZE ** 3;
        
        try {
            // Process chunks in batches of 8
            for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_CHUNKS) {
                const batchChunks = chunks.slice(batchStart, batchStart + BATCH_CHUNKS);
                const numChunks = batchChunks.length;
                
                // Build params buffer: header (32 bytes) + chunk positions (8 * 16 bytes)
                const paramsData = new ArrayBuffer(256);
                const paramsView = new DataView(paramsData);
                
                // Header
                paramsView.setUint32(0, seed, true);          // seed
                paramsView.setUint32(4, numChunks, true);     // numChunks
                paramsView.setFloat32(8, 0.02, true);         // baseFreq
                paramsView.setFloat32(12, 15.0, true);        // amplitude
                paramsView.setUint32(16, 4, true);            // octaves
                paramsView.setFloat32(20, 2.0, true);         // lacunarity
                paramsView.setFloat32(24, 0.5, true);         // persistence
                paramsView.setFloat32(28, 0.7, true);         // caveThreshold
                
                // Chunk world positions (offset 32, each vec4 is 16 bytes)
                for (let i = 0; i < BATCH_CHUNKS; i++) {
                    const offset = 32 + i * 16;
                    if (i < numChunks) {
                        const chunk = batchChunks[i];
                        paramsView.setFloat32(offset + 0, chunk.cx * CHUNK_SIZE, true);
                        paramsView.setFloat32(offset + 4, chunk.cy * CHUNK_SIZE, true);
                        paramsView.setFloat32(offset + 8, chunk.cz * CHUNK_SIZE, true);
                        paramsView.setFloat32(offset + 12, 0, true);
                    } else {
                        // Padding for unused slots
                        paramsView.setFloat32(offset + 0, 0, true);
                        paramsView.setFloat32(offset + 4, 0, true);
                        paramsView.setFloat32(offset + 8, 0, true);
                        paramsView.setFloat32(offset + 12, 0, true);
                    }
                }
                
                device.queue.writeBuffer(this.batchParamsBuffer, 0, new Uint8Array(paramsData));
                
                // Reset solid counts
                device.queue.writeBuffer(this.batchSolidCountBuffer, 0, new Uint32Array(BATCH_CHUNKS));
                
                // Create bind group
                const bindGroup = device.createBindGroup({
                    layout: this.batchTerrainLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.batchParamsBuffer } },
                        { binding: 1, resource: { buffer: this.batchVoxelBuffer } },
                        { binding: 2, resource: { buffer: this.batchSolidCountBuffer } },
                    ],
                });
                
                // Dispatch compute: 8x8 workgroups for XY, numChunks*8 for Z (each chunk needs 8 Z workgroups)
                const commandEncoder = device.createCommandEncoder();
                const pass = commandEncoder.beginComputePass();
                pass.setPipeline(this.batchTerrainPipeline);
                pass.setBindGroup(0, bindGroup);
                // Dispatch: 8 workgroups in X, 8 in Y, numChunks*8 in Z (Z encodes chunk index + local Z)
                pass.dispatchWorkgroups(8, 8, numChunks * 8);
                pass.end();
                
                // Copy results to readback buffers
                const voxelReadSize = numChunks * CHUNK_VOLUME * 4;
                commandEncoder.copyBufferToBuffer(this.batchVoxelBuffer, 0, this.batchReadbackBuffer, 0, voxelReadSize);
                commandEncoder.copyBufferToBuffer(this.batchSolidCountBuffer, 0, this.batchCountReadback, 0, numChunks * 4);
                device.queue.submit([commandEncoder.finish()]);
                
                // Read back results
                await this.batchReadbackBuffer.mapAsync(GPUMapMode.READ, 0, voxelReadSize);
                await this.batchCountReadback.mapAsync(GPUMapMode.READ, 0, numChunks * 4);
                
                const voxelData = new Uint32Array(this.batchReadbackBuffer.getMappedRange(0, voxelReadSize));
                const countData = new Uint32Array(this.batchCountReadback.getMappedRange(0, numChunks * 4));
                
                // Extract results for each chunk
                for (let i = 0; i < numChunks; i++) {
                    const chunk = batchChunks[i];
                    const key = `${chunk.cx},${chunk.cy},${chunk.cz}`;
                    const voxelStart = i * CHUNK_VOLUME;
                    const voxels = new Uint32Array(voxelData.slice(voxelStart, voxelStart + CHUNK_VOLUME));
                    const solidCount = countData[i];
                    results.set(key, { voxels, solidCount });
                }
                
                this.batchReadbackBuffer.unmap();
                this.batchCountReadback.unmap();
            }
            
            return results;
        } catch (err) {
            console.warn('[ChunkStreamingCompute] batchGenerateTerrain error:', err.message);
            return results;
        } finally {
            this.pendingGeneration = false;
        }
    }
    
    /**
     * Advanced terrain generation using GPUWorldGenerator
     * Provides biomes, climate, caves, structures, erosion-aware terrain
     * @private
     */
    async _batchGenerateAdvanced(chunks, seed) {
        this.pendingGeneration = true;
        const results = new Map();
        const CHUNK_VOLUME = 32 * 32 * 32;
        
        try {
            // Set seed if changed
            if (this.advancedGenerator.seed !== seed) {
                this.advancedGenerator.setSeed(seed);
            }
            
            // Process chunks in batches of 8 (GPUWorldGenerator batch size)
            for (let batchStart = 0; batchStart < chunks.length; batchStart += 8) {
                const batchChunks = chunks.slice(batchStart, batchStart + 8);
                
                // Use GPUWorldGenerator's batch generation
                const batchResults = await this.advancedGenerator.generateBatch(batchChunks);
                
                // Convert results to Map format
                for (let i = 0; i < batchResults.length; i++) {
                    const chunk = batchChunks[i];
                    const key = `${chunk.cx},${chunk.cy},${chunk.cz}`;
                    const result = batchResults[i];
                    
                    // Convert Uint8Array to Uint32Array if needed
                    const voxels = result.voxels instanceof Uint32Array 
                        ? result.voxels 
                        : new Uint32Array(result.voxels.buffer);
                    
                    results.set(key, { voxels, solidCount: result.solidCount });
                }
            }
            
            return results;
        } catch (err) {
            console.warn('[ChunkStreamingCompute] _batchGenerateAdvanced error:', err.message);
            return results;
        } finally {
            this.pendingGeneration = false;
        }
    }
    
    /**
     * Destroy all GPU resources
     */
    destroy() {
        this.paramsBuffer?.destroy();
        this.existingChunksBuffer?.destroy();
        this.loadCandidatesBuffer?.destroy();
        this.unloadCandidatesBuffer?.destroy();
        this.loadCountBuffer?.destroy();
        this.unloadCountBuffer?.destroy();
        this.countReadback?.destroy();
        this.candidatesReadback?.destroy();
        this.terrainParamsBuffer?.destroy();
        
        // Batch terrain buffers
        this.batchParamsBuffer?.destroy();
        this.batchVoxelBuffer?.destroy();
        this.batchSolidCountBuffer?.destroy();
        this.batchReadbackBuffer?.destroy();
        this.batchCountReadback?.destroy();
        
        for (const buf of this.terrainVoxelBuffers) buf?.destroy();
        for (const buf of this.terrainSolidCountBuffers) buf?.destroy();
        for (const buf of this.terrainReadbackBuffers) buf?.destroy();
        
        this.initialized = false;
    }
}

export default ChunkStreamingCompute;
