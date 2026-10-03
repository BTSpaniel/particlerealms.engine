// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkCullCompute.js - GPU-Driven Chunk Culling System
 * Now powered by vGPU driver
 * 
 * Implements all culling on the GPU for maximum performance:
 * 1. Frustum Culling - Test chunk AABB against 6 frustum planes
 * 2. Hi-Z Occlusion Culling - Test against depth pyramid  
 * 3. Distance LOD - Select mesh detail level based on distance
 * 4. Batched Indirect Output - Write visible chunks directly to indirect buffer
 * 
 * This eliminates CPU readback and allows the GPU to drive rendering entirely.
 */

import { initVGPU } from '../core/gpu/VirtualGPU.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
let _chunkCullDataCapacity = 256;
let _chunkCullData = new Float32Array(_chunkCullDataCapacity * 12);

function ensureChunkCullCapacity(count) {
    if (count <= _chunkCullDataCapacity) return;
    while (_chunkCullDataCapacity < count) {
        _chunkCullDataCapacity *= 2;
    }
    _chunkCullData = new Float32Array(_chunkCullDataCapacity * 12);
}

// ============================================================================
// FRUSTUM + OCCLUSION + LOD CULL SHADER
// ============================================================================
const CHUNK_CULL_SHADER = /* wgsl */ `
struct CullParams {
    viewProj: mat4x4<f32>,           // View-projection matrix
    cameraPos: vec3<f32>,            // Camera world position
    _pad0: f32,
    frustumPlanes: array<vec4<f32>, 6>,  // Frustum planes (normal.xyz, distance.w)
    screenSize: vec2<f32>,           // Screen dimensions
    nearPlane: f32,
    farPlane: f32,
    lodDistances0: vec4<f32>,        // LOD thresholds 0-3 (for 10-level system)
    lodDistances1: vec4<f32>,        // LOD thresholds 4-7
    lodDistances2: vec4<f32>,        // LOD thresholds 8-9 + hysteresis + lodLevels
    maxRenderDistance: f32,          // Max render distance (0 = unlimited)
    enableOcclusion: u32,            // Enable Hi-Z occlusion culling
    enableFrustum: u32,              // Enable frustum culling
    enableLOD: u32,                  // Enable distance LOD
}

struct ChunkInfo {
    aabbMin: vec3<f32>,              // Chunk AABB minimum
    indexCount: u32,                 // Number of indices
    aabbMax: vec3<f32>,              // Chunk AABB maximum
    vertexOffset: u32,               // Offset in vertex buffer
    indexOffset: u32,                // Offset in index buffer  
    chunkKey: u32,                   // Chunk identifier
    lodLevel: u32,                   // Current LOD level
    _pad: u32,
}

struct DrawIndexedIndirect {
    indexCount: u32,
    instanceCount: u32,
    firstIndex: u32,
    baseVertex: i32,
    firstInstance: u32,
}

struct CullStats {
    totalChunks: atomic<u32>,
    visibleChunks: atomic<u32>,
    frustumCulled: atomic<u32>,
    occlusionCulled: atomic<u32>,
    distanceCulled: atomic<u32>,
    lodCounts: array<atomic<u32>, 10>,  // 10-level LOD distribution
}

@group(0) @binding(0) var<uniform> params: CullParams;
@group(0) @binding(1) var<storage, read> chunks: array<ChunkInfo>;
@group(0) @binding(2) var<storage, read_write> drawCommands: array<DrawIndexedIndirect>;
@group(0) @binding(3) var<storage, read_write> visibleCount: atomic<u32>;
@group(0) @binding(4) var<storage, read_write> stats: CullStats;
@group(0) @binding(5) var hiZTexture: texture_2d<f32>;
@group(0) @binding(6) var hiZSampler: sampler;

// Test AABB against frustum planes
fn frustumCull(aabbMin: vec3<f32>, aabbMax: vec3<f32>) -> bool {
    for (var i = 0u; i < 6u; i++) {
        let plane = params.frustumPlanes[i];
        
        // Find the positive vertex (furthest along plane normal)
        let p = vec3<f32>(
            select(aabbMin.x, aabbMax.x, plane.x > 0.0),
            select(aabbMin.y, aabbMax.y, plane.y > 0.0),
            select(aabbMin.z, aabbMax.z, plane.z > 0.0)
        );
        
        // If positive vertex is behind plane, AABB is completely outside
        if (dot(plane.xyz, p) + plane.w < 0.0) {
            return false;  // Culled
        }
    }
    return true;  // Visible
}

// Project AABB to screen space and get bounds
fn projectAABB(aabbMin: vec3<f32>, aabbMax: vec3<f32>) -> vec4<f32> {
    // 8 corners of AABB
    var minScreen = vec2<f32>(1.0, 1.0);
    var maxScreen = vec2<f32>(0.0, 0.0);
    var minDepth = 1.0;
    
    for (var i = 0u; i < 8u; i++) {
        let corner = vec3<f32>(
            select(aabbMin.x, aabbMax.x, (i & 1u) != 0u),
            select(aabbMin.y, aabbMax.y, (i & 2u) != 0u),
            select(aabbMin.z, aabbMax.z, (i & 4u) != 0u)
        );
        
        let clip = params.viewProj * vec4<f32>(corner, 1.0);
        
        // Skip if behind camera
        if (clip.w <= 0.0) {
            continue;
        }
        
        let ndc = clip.xyz / clip.w;
        let screen = ndc.xy * 0.5 + 0.5;
        
        minScreen = min(minScreen, screen);
        maxScreen = max(maxScreen, screen);
        minDepth = min(minDepth, ndc.z);
    }
    
    // Clamp to screen
    minScreen = clamp(minScreen, vec2<f32>(0.0), vec2<f32>(1.0));
    maxScreen = clamp(maxScreen, vec2<f32>(0.0), vec2<f32>(1.0));
    
    return vec4<f32>(minScreen, maxScreen.x - minScreen.x, minDepth);
}

// Hi-Z occlusion test
fn occlusionCull(aabbMin: vec3<f32>, aabbMax: vec3<f32>) -> bool {
    let projected = projectAABB(aabbMin, aabbMax);
    let screenMin = projected.xy;
    let screenSize = projected.z;
    let objectDepth = projected.w;
    
    // Object is behind camera or off-screen
    if (screenSize <= 0.0) {
        return true;  // Visible (conservative)
    }
    
    // Select mip level based on projected size
    let pixelSize = screenSize * max(params.screenSize.x, params.screenSize.y);
    let mipLevel = clamp(u32(log2(pixelSize)), 0u, 9u);
    
    // Sample Hi-Z at center of projected bounds
    let samplePos = screenMin + vec2<f32>(screenSize * 0.5);
    let hiZDepth = textureSampleLevel(hiZTexture, hiZSampler, samplePos, f32(mipLevel)).r;
    
    // If object's nearest depth is greater than Hi-Z (further away), it's occluded
    // WebGPU uses [0,1] depth where 0=near, 1=far
    if (objectDepth > hiZDepth + 0.001) {
        return false;  // Occluded
    }
    
    return true;  // Visible
}

// Calculate 10-level distance-based LOD with hysteresis
fn calculateLOD(aabbMin: vec3<f32>, aabbMax: vec3<f32>, currentLOD: u32) -> u32 {
    let center = (aabbMin + aabbMax) * 0.5;
    let distance = length(center - params.cameraPos);
    let hysteresis = params.lodDistances2.z;  // 10% band
    let lodLevels = u32(params.lodDistances2.w);  // Number of LOD levels (10)
    
    // Get all 9 thresholds for 10-level LOD
    var thresholds: array<f32, 9>;
    thresholds[0] = params.lodDistances0.x;
    thresholds[1] = params.lodDistances0.y;
    thresholds[2] = params.lodDistances0.z;
    thresholds[3] = params.lodDistances0.w;
    thresholds[4] = params.lodDistances1.x;
    thresholds[5] = params.lodDistances1.y;
    thresholds[6] = params.lodDistances1.z;
    thresholds[7] = params.lodDistances1.w;
    thresholds[8] = params.lodDistances2.x;
    
    // Calculate new LOD based on distance
    var newLOD = 0u;
    for (var i = 0u; i < 9u; i++) {
        if (distance >= thresholds[i]) {
            newLOD = i + 1u;
        }
    }
    newLOD = min(newLOD, lodLevels - 1u);
    
    // Apply hysteresis: require crossing threshold by extra margin
    if (newLOD != currentLOD && hysteresis > 0.0) {
        if (newLOD > currentLOD) {
            // Switching to lower detail - require being past threshold + hysteresis
            let threshold = thresholds[currentLOD];
            let hysteresisMargin = threshold * hysteresis;
            if (distance < threshold + hysteresisMargin) {
                return currentLOD;  // Stay at current LOD
            }
        } else {
            // Switching to higher detail - require being before threshold - hysteresis
            let threshold = thresholds[newLOD];
            let hysteresisMargin = threshold * hysteresis;
            if (distance > threshold - hysteresisMargin) {
                return currentLOD;  // Stay at current LOD
            }
        }
    }
    
    return newLOD;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let chunkIndex = gid.x;
    
    // Bounds check
    if (chunkIndex >= arrayLength(&chunks)) {
        return;
    }
    
    atomicAdd(&stats.totalChunks, 1u);
    
    let chunk = chunks[chunkIndex];
    let aabbMin = chunk.aabbMin;
    let aabbMax = chunk.aabbMax;
    
    // Skip empty chunks
    if (chunk.indexCount == 0u) {
        return;
    }
    
    // Distance culling
    if (params.maxRenderDistance > 0.0) {
        let center = (aabbMin + aabbMax) * 0.5;
        let distance = length(center - params.cameraPos);
        if (distance > params.maxRenderDistance) {
            atomicAdd(&stats.distanceCulled, 1u);
            return;
        }
    }
    
    // Frustum culling
    if (params.enableFrustum != 0u) {
        if (!frustumCull(aabbMin, aabbMax)) {
            atomicAdd(&stats.frustumCulled, 1u);
            return;
        }
    }
    
    // Hi-Z occlusion culling
    if (params.enableOcclusion != 0u) {
        if (!occlusionCull(aabbMin, aabbMax)) {
            atomicAdd(&stats.occlusionCulled, 1u);
            return;
        }
    }
    
    // Calculate LOD level with hysteresis
    var lodLevel = chunk.lodLevel;  // Use current LOD from chunk for hysteresis
    if (params.enableLOD != 0u) {
        lodLevel = calculateLOD(aabbMin, aabbMax, chunk.lodLevel);
        
        // Track LOD distribution (10 levels)
        if (lodLevel < 10u) {
            atomicAdd(&stats.lodCounts[lodLevel], 1u);
        }
    }
    
    // Chunk is visible! Add to draw commands
    let drawIndex = atomicAdd(&visibleCount, 1u);
    
    // Write indirect draw command
    drawCommands[drawIndex].indexCount = chunk.indexCount;
    drawCommands[drawIndex].instanceCount = 1u;
    drawCommands[drawIndex].firstIndex = chunk.indexOffset;
    drawCommands[drawIndex].baseVertex = i32(chunk.vertexOffset);
    drawCommands[drawIndex].firstInstance = chunkIndex;  // Pass chunk index for instancing
    
    atomicAdd(&stats.visibleChunks, 1u);
}
`;

// ============================================================================
// FRUSTUM PLANE EXTRACTION SHADER (runs once per frame)
// ============================================================================
const EXTRACT_FRUSTUM_SHADER = /* wgsl */ `
struct FrustumOutput {
    planes: array<vec4<f32>, 6>,
}

@group(0) @binding(0) var<uniform> viewProj: mat4x4<f32>;
@group(0) @binding(1) var<storage, read_write> frustum: FrustumOutput;

@compute @workgroup_size(1)
fn main() {
    // Extract frustum planes from view-projection matrix
    // Left plane
    frustum.planes[0] = vec4<f32>(
        viewProj[0][3] + viewProj[0][0],
        viewProj[1][3] + viewProj[1][0],
        viewProj[2][3] + viewProj[2][0],
        viewProj[3][3] + viewProj[3][0]
    );
    
    // Right plane
    frustum.planes[1] = vec4<f32>(
        viewProj[0][3] - viewProj[0][0],
        viewProj[1][3] - viewProj[1][0],
        viewProj[2][3] - viewProj[2][0],
        viewProj[3][3] - viewProj[3][0]
    );
    
    // Bottom plane
    frustum.planes[2] = vec4<f32>(
        viewProj[0][3] + viewProj[0][1],
        viewProj[1][3] + viewProj[1][1],
        viewProj[2][3] + viewProj[2][1],
        viewProj[3][3] + viewProj[3][1]
    );
    
    // Top plane
    frustum.planes[3] = vec4<f32>(
        viewProj[0][3] - viewProj[0][1],
        viewProj[1][3] - viewProj[1][1],
        viewProj[2][3] - viewProj[2][1],
        viewProj[3][3] - viewProj[3][1]
    );
    
    // Near plane
    frustum.planes[4] = vec4<f32>(
        viewProj[0][2],
        viewProj[1][2],
        viewProj[2][2],
        viewProj[3][2]
    );
    
    // Far plane
    frustum.planes[5] = vec4<f32>(
        viewProj[0][3] - viewProj[0][2],
        viewProj[1][3] - viewProj[1][2],
        viewProj[2][3] - viewProj[2][2],
        viewProj[3][3] - viewProj[3][2]
    );
    
    // Normalize all planes
    for (var i = 0u; i < 6u; i++) {
        let len = length(frustum.planes[i].xyz);
        if (len > 0.0) {
            frustum.planes[i] = frustum.planes[i] / len;
        }
    }
}
`;

// ============================================================================
// ChunkCullCompute CLASS
// ============================================================================

export class ChunkCullCompute {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        
        // Pipelines
        this.cullPipeline = null;
        this.extractFrustumPipeline = null;
        
        // Layouts
        this.cullBindGroupLayout = null;
        this.frustumBindGroupLayout = null;
        
        // Buffers
        this.paramsBuffer = null;          // CullParams uniform
        this.chunkInfoBuffer = null;       // Array of ChunkInfo
        this.drawCommandsBuffer = null;    // Indirect draw commands output
        this.visibleCountBuffer = null;    // Atomic visible count
        this.statsBuffer = null;           // Culling statistics
        this.frustumBuffer = null;         // Extracted frustum planes
        this.viewProjBuffer = null;        // View-projection matrix
        
        // Readback buffer for stats (debugging)
        this.statsReadbackBuffer = null;
        
        // Configuration
        // MEMORY OPTIMIZED: Reduced from 8192 to 4096 to match VoxelRenderer (saves ~200KB)
        this.maxChunks = 4096;
        // 10-level LOD: 9 thresholds for levels 0-9
        this.lodDistances = [51, 102, 153, 204, 256, 307, 358, 409, 460];
        this.lodLevels = 10;               // Number of LOD levels
        this.lodHysteresis = 0.1;          // 10% hysteresis band
        
        // Stats from last frame
        this.lastStats = {
            totalChunks: 0,
            visibleChunks: 0,
            frustumCulled: 0,
            occlusionCulled: 0,
            distanceCulled: 0,
            lodCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],  // 10 LOD levels
        };
        
        // Feature toggles
        this.enableFrustumCulling = true;
        this.enableOcclusionCulling = true;
        this.enableLOD = true;
        this.maxRenderDistance = 0;  // 0 = unlimited
        
        // Hi-Z texture reference (from HiZPass)
        this.hiZTexture = null;
        this.hiZSampler = null;

        this.hiZView = null;
        this._cullBindGroup = null;
        
        // Pre-allocated typed arrays to avoid per-frame allocations
        this._visibleCountReset = new Uint32Array([0]);
        this._statsReset = new Uint32Array(15);
        this._params = new ArrayBuffer(256);
        this._paramsFloats = new Float32Array(this._params);
        this._paramsView = new DataView(this._params);
    }
    
    /**
     * Initialize the GPU culling system
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create shader modules using vGPU
        const cullModule = this.vgpu.shader.compile('chunkCull', CHUNK_CULL_SHADER);
        const frustumModule = this.vgpu.shader.compile('extractFrustum', EXTRACT_FRUSTUM_SHADER);
        
        // Create Hi-Z sampler using vGPU
        this.hiZSampler = this.vgpu.texture.sampler({ filter: 'nearest', addressMode: 'clamp-to-edge' });
        
        // Create bind group layouts using vGPU
        this.cullBindGroupLayout = this.vgpu.bindings.defineLayout('chunkCull', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'read-storage', visibility: 'compute' },
            { binding: 2, type: 'storage', visibility: 'compute' },
            { binding: 3, type: 'storage', visibility: 'compute' },
            { binding: 4, type: 'storage', visibility: 'compute' },
            { binding: 5, type: 'texture', visibility: 'compute', sampleType: 'unfilterable-float' },
            { binding: 6, type: 'sampler', visibility: 'compute', samplerType: 'non-filtering' },
        ]);
        
        this.frustumBindGroupLayout = this.vgpu.bindings.defineLayout('extractFrustum', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'storage', visibility: 'compute' },
        ]);
        
        // Create pipelines using vGPU
        this.cullPipeline = this.vgpu.pipeline.compute({
            module: cullModule, entryPoint: 'main',
            layouts: [this.cullBindGroupLayout], label: 'ChunkCullPipeline'
        });
        
        this.extractFrustumPipeline = this.vgpu.pipeline.compute({
            module: frustumModule, entryPoint: 'main',
            layouts: [this.frustumBindGroupLayout], label: 'ExtractFrustumPipeline'
        });
        
        // Create buffers using vGPU
        this.paramsBuffer = this.vgpu.buffer.create({ size: 256, usage: 'uniform', label: 'CullParams' }).buffer;
        this.chunkInfoBuffer = this.vgpu.buffer.create({ size: this.maxChunks * 48, usage: 'storage', label: 'ChunkInfo' }).buffer;
        this.drawCommandsBuffer = this.vgpu.buffer.create({ size: this.maxChunks * 20, usage: 'storage|indirect|copy-dst', label: 'DrawCommands' }).buffer;
        this.visibleCountBuffer = this.vgpu.buffer.create({ size: 4, usage: 'storage|copy-src', label: 'VisibleCount' }).buffer;
        this.statsBuffer = this.vgpu.buffer.create({ size: 60, usage: 'storage|copy-src', label: 'CullStats' }).buffer;
        this.statsReadbackBuffer = this.vgpu.buffer.create({ size: 60, usage: 'map-read|copy-dst', label: 'StatsReadback' }).buffer;
        this.viewProjBuffer = this.vgpu.buffer.create({ size: 64, usage: 'uniform', label: 'ViewProjMatrix' }).buffer;
        this.frustumBuffer = this.vgpu.buffer.create({ size: 96, usage: 'storage|copy-src', label: 'FrustumPlanes' }).buffer;
        
        // Create placeholder Hi-Z texture using vGPU
        const hiZResult = this.vgpu.texture.create({ width: 1, height: 1, format: 'r32float', usage: 'texture', label: 'PlaceholderHiZ' });
        this.hiZTexture = hiZResult.texture;

        this.hiZView = this.hiZTexture.createView();
        this._cullBindGroup = null;
        
        this.initialized = true;
        console.log('[ChunkCullCompute] Initialized with:');
        console.log(`  - GPU Frustum Culling: ${this.enableFrustumCulling ? 'ON' : 'OFF'}`);
        console.log(`  - GPU Hi-Z Occlusion: ${this.enableOcclusionCulling ? 'ON' : 'OFF'}`);
        console.log(`  - Distance LOD: ${this.enableLOD ? 'ON' : 'OFF'}`);
        console.log(`  - Max chunks: ${this.maxChunks}`);
    }
    
    /**
     * Set Hi-Z texture from HiZPass
     * @param {GPUTexture} texture 
     */
    setHiZTexture(texture) {
        this.hiZTexture = texture;

        this.hiZView = this.hiZTexture?.createView?.() ?? null;
        this._cullBindGroup = null;
    }
    
    /**
     * Upload chunk data for culling
     * @param {Array} chunks - Array of {aabbMin, aabbMax, indexCount, vertexOffset, indexOffset, key}
     */
    uploadChunks(chunks) {
        if (!this.initialized || chunks.length === 0) return;
        
        const count = Math.min(chunks.length, this.maxChunks);
        ensureChunkCullCapacity(count);
        const data = _chunkCullData;  // Reuse dynamic buffer

        const view = new DataView(data.buffer);
        
        for (let i = 0; i < count; i++) {
            const c = chunks[i];
            const offset = i * 12;
            
            // aabbMin (vec3) + indexCount (u32)
            data[offset + 0] = c.aabbMin[0];
            data[offset + 1] = c.aabbMin[1];
            data[offset + 2] = c.aabbMin[2];
            // Convert indexCount to float bits
            view.setUint32((offset + 3) * 4, c.indexCount, true);
            
            // aabbMax (vec3) + vertexOffset (u32)
            data[offset + 4] = c.aabbMax[0];
            data[offset + 5] = c.aabbMax[1];
            data[offset + 6] = c.aabbMax[2];
            view.setUint32((offset + 7) * 4, c.vertexOffset || 0, true);
            
            // indexOffset, chunkKey, lodLevel, padding
            view.setUint32((offset + 8) * 4, c.indexOffset || 0, true);
            view.setUint32((offset + 9) * 4, c.key || i, true);
            view.setUint32((offset + 10) * 4, 0, true);  // lodLevel
            view.setUint32((offset + 11) * 4, 0, true);  // padding
        }
        
        this.device.queue.writeBuffer(this.chunkInfoBuffer, 0, data);
        return count;
    }
    
    /**
     * Run GPU culling
     * @param {Float32Array} viewProj - 4x4 view-projection matrix
     * @param {Array} cameraPos - Camera world position [x, y, z]
     * @param {number} screenWidth 
     * @param {number} screenHeight 
     * @param {number} chunkCount - Number of chunks uploaded
     * @returns {GPUBuffer} - Draw commands buffer for indirect rendering
     */
    cull(viewProj, cameraPos, screenWidth, screenHeight, chunkCount) {
        if (!this.initialized || chunkCount === 0) return null;
        
        const device = this.device;
        
        // Reset visible count and stats (use pre-allocated buffers)
        device.queue.writeBuffer(this.visibleCountBuffer, 0, this._visibleCountReset);
        this._statsReset.fill(0);
        device.queue.writeBuffer(this.statsBuffer, 0, this._statsReset);
        
        // Build params buffer (use pre-allocated buffers)
        const paramsFloats = this._paramsFloats;
        const paramsView = this._paramsView;
        
        // viewProj matrix (64 bytes)
        for (let i = 0; i < 16; i++) {
            paramsFloats[i] = viewProj[i];
        }
        
        // cameraPos (12 bytes) + pad (4 bytes)
        paramsFloats[16] = cameraPos[0];
        paramsFloats[17] = cameraPos[1];
        paramsFloats[18] = cameraPos[2];
        paramsFloats[19] = 0;
        
        // frustum planes - extract from viewProj on CPU (faster for small data)
        const planes = this.extractFrustumPlanes(viewProj);
        for (let i = 0; i < 6; i++) {
            paramsFloats[20 + i * 4 + 0] = planes[i][0];
            paramsFloats[20 + i * 4 + 1] = planes[i][1];
            paramsFloats[20 + i * 4 + 2] = planes[i][2];
            paramsFloats[20 + i * 4 + 3] = planes[i][3];
        }
        
        // screenSize (8 bytes) + nearPlane + farPlane
        paramsFloats[44] = screenWidth;
        paramsFloats[45] = screenHeight;
        paramsFloats[46] = 0.1;   // Near plane
        paramsFloats[47] = 1000;  // Far plane
        
        // lodDistances0 (16 bytes) - thresholds 0-3
        paramsFloats[48] = this.lodDistances[0] || 51;
        paramsFloats[49] = this.lodDistances[1] || 102;
        paramsFloats[50] = this.lodDistances[2] || 153;
        paramsFloats[51] = this.lodDistances[3] || 204;
        
        // lodDistances1 (16 bytes) - thresholds 4-7
        paramsFloats[52] = this.lodDistances[4] || 256;
        paramsFloats[53] = this.lodDistances[5] || 307;
        paramsFloats[54] = this.lodDistances[6] || 358;
        paramsFloats[55] = this.lodDistances[7] || 409;
        
        // lodDistances2 (16 bytes) - threshold 8, unused, hysteresis, lodLevels
        paramsFloats[56] = this.lodDistances[8] || 460;
        paramsFloats[57] = 0;  // unused
        paramsFloats[58] = this.lodHysteresis || 0.1;  // hysteresis band
        paramsFloats[59] = this.lodLevels || 10;       // number of LOD levels
        
        // maxRenderDistance + flags
        paramsFloats[60] = this.maxRenderDistance;
        paramsView.setUint32(61 * 4, this.enableOcclusionCulling ? 1 : 0, true);
        paramsView.setUint32(62 * 4, this.enableFrustumCulling ? 1 : 0, true);
        paramsView.setUint32(63 * 4, this.enableLOD ? 1 : 0, true);
        
        device.queue.writeBuffer(this.paramsBuffer, 0, this._params);

        // Create bind group once and reuse (resources are stable; paramsBuffer content changes via writeBuffer)
        if (!this._cullBindGroup) {
            if (!this.hiZView) {
                this.hiZView = this.hiZTexture?.createView?.() ?? null;
            }

            this._cullBindGroup = device.createBindGroup({
                layout: this.cullBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.paramsBuffer } },
                    { binding: 1, resource: { buffer: this.chunkInfoBuffer } },
                    { binding: 2, resource: { buffer: this.drawCommandsBuffer } },
                    { binding: 3, resource: { buffer: this.visibleCountBuffer } },
                    { binding: 4, resource: { buffer: this.statsBuffer } },
                    { binding: 5, resource: this.hiZView },
                    { binding: 6, resource: this.hiZSampler },
                ],
            });
        }
        
        // Run cull compute (skip if no chunks)
        if (chunkCount > 0) {
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.cullPipeline);
            pass.setBindGroup(0, this._cullBindGroup);
            pass.dispatchWorkgroups(Math.ceil(chunkCount / 64));
            pass.end();
            
            device.queue.submit([encoder.finish()]);
        }
        
        return {
            drawCommandsBuffer: this.drawCommandsBuffer,
            visibleCountBuffer: this.visibleCountBuffer,
        };
    }
    
    /**
     * Extract frustum planes from view-projection matrix (CPU)
     * @param {Float32Array} m - 4x4 matrix in column-major order
     * @returns {Array} - 6 planes as [nx, ny, nz, d]
     */
    extractFrustumPlanes(m) {
        const planes = [];
        
        // Left: row3 + row0
        planes.push(this.normalizePlane([
            m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]
        ]));
        
        // Right: row3 - row0
        planes.push(this.normalizePlane([
            m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]
        ]));
        
        // Bottom: row3 + row1
        planes.push(this.normalizePlane([
            m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]
        ]));
        
        // Top: row3 - row1
        planes.push(this.normalizePlane([
            m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]
        ]));
        
        // Near: row2
        planes.push(this.normalizePlane([
            m[2], m[6], m[10], m[14]
        ]));
        
        // Far: row3 - row2
        planes.push(this.normalizePlane([
            m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]
        ]));
        
        return planes;
    }
    
    normalizePlane(plane) {
        const len = Math.sqrt(plane[0] ** 2 + plane[1] ** 2 + plane[2] ** 2);
        if (len > 0) {
            return [plane[0] / len, plane[1] / len, plane[2] / len, plane[3] / len];
        }
        return plane;
    }
    
    /**
     * Read back culling stats (async, for debugging)
     */
    async getStats() {
        if (!this.initialized) return this.lastStats;
        
        // Stats buffer: 5 base stats + 10 LOD counts = 15 u32s = 60 bytes
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(this.statsBuffer, 0, this.statsReadbackBuffer, 0, 60);
        this.device.queue.submit([encoder.finish()]);
        
        await this.statsReadbackBuffer.mapAsync(GPUMapMode.READ);
        const data = new Uint32Array(this.statsReadbackBuffer.getMappedRange().slice(0));
        this.statsReadbackBuffer.unmap();
        
        this.lastStats = {
            totalChunks: data[0],
            visibleChunks: data[1],
            frustumCulled: data[2],
            occlusionCulled: data[3],
            distanceCulled: data[4],
            lodCounts: [data[5], data[6], data[7], data[8], data[9], 
                        data[10], data[11], data[12], data[13], data[14]],
        };
        
        return this.lastStats;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.paramsBuffer?.destroy();
        this.chunkInfoBuffer?.destroy();
        this.drawCommandsBuffer?.destroy();
        this.visibleCountBuffer?.destroy();
        this.statsBuffer?.destroy();
        this.statsReadbackBuffer?.destroy();
        this.viewProjBuffer?.destroy();
        this.frustumBuffer?.destroy();
        this.initialized = false;
    }
}

export default ChunkCullCompute;
