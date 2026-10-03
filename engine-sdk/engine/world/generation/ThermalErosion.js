// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ThermalErosion.js - GPU Material-Specific Talus Angle Erosion
 * 
 * Implements thermal erosion (slippage) with:
 * - Per-material talus angles (angle of repose)
 * - Mass-conserving material transfer between cells
 * - Support for LayerMap stratigraphy
 * 
 * Based on: SoilMachine thermal erosion
 * 
 * Key concept: If slope > tan(θ_material), mass transfers downhill
 * - Sand: ~30° (gentle slopes)
 * - Rock: ~85° (near-vertical cliffs)
 */

import { degreesToRadians } from '../../core/math/UnitMath.js';

// ============================================================================
// CONSTANTS
// ============================================================================

// Talus angles in degrees for different materials
export const TALUS_ANGLES = {
    BEDROCK: 85,
    GRAVEL: 45,
    SAND: 30,
    TOPSOIL: 35,
    CLAY: 40,
    LIMESTONE: 70,
    GRANITE: 80,
    OBSIDIAN: 88,
    ICE: 60,
};

// Convert degrees to slope threshold
const toSlopeThreshold = (deg) => Math.tan(degreesToRadians(deg));

// ============================================================================
// SHADER SOURCES
// ============================================================================

const THERMAL_PARAMS = /* wgsl */ `
struct ThermalParams {
    grid_size: u32,
    grid_scale: f32,
    transfer_rate: f32,     // How much material moves per step (0-1)
    iterations: u32,        // Iterations per frame
    
    origin_x: f32,
    origin_z: f32,
    dt: f32,
    _pad: f32,
}

// Material talus slopes (pre-converted from angles)
const TALUS_SLOPES: array<f32, 16> = array<f32, 16>(
    0.0,    // AIR (unused)
    11.43,  // BEDROCK (tan 85°)
    1.0,    // GRAVEL (tan 45°)
    0.577,  // SAND (tan 30°)
    0.700,  // TOPSOIL (tan 35°)
    0.0,    // WATER (fluid)
    0.087,  // MAGMA (tan 5°)
    0.839,  // CLAY (tan 40°)
    2.747,  // LIMESTONE (tan 70°)
    5.671,  // GRANITE (tan 80°)
    28.64,  // OBSIDIAN (tan 88°)
    1.732,  // ICE (tan 60°)
    1.0,    // placeholder
    1.0,
    1.0,
    1.0,
);
`;

// Thermal erosion on heightmap
const THERMAL_HEIGHTMAP_SHADER = /* wgsl */ `
${THERMAL_PARAMS}

@group(0) @binding(0) var heightmap_in: texture_2d<f32>;
@group(0) @binding(1) var heightmap_out: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var material_map: texture_2d<u32>;
@group(0) @binding(3) var<uniform> params: ThermalParams;

fn getTalusSlope(materialId: u32) -> f32 {
    if (materialId < 16u) {
        return TALUS_SLOPES[materialId];
    }
    return 1.0;  // Default to 45°
}

@compute @workgroup_size(8, 8)
fn thermal_erode(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = i32(gid.x);
    let z = i32(gid.y);
    
    if (gid.x >= params.grid_size || gid.y >= params.grid_size) {
        return;
    }
    
    let centerH = textureLoad(heightmap_in, vec2<i32>(x, z), 0).r;
    let centerMat = textureLoad(material_map, vec2<i32>(x, z), 0).r;
    let talusSlope = getTalusSlope(centerMat);
    
    // Find steepest downhill neighbor
    var maxDiff = 0.0;
    var totalTransfer = 0.0;
    var neighborCount = 0.0;
    
    // Check 4 cardinal neighbors
    let offsets = array<vec2<i32>, 4>(
        vec2<i32>(1, 0),
        vec2<i32>(-1, 0),
        vec2<i32>(0, 1),
        vec2<i32>(0, -1),
    );
    
    for (var i = 0u; i < 4u; i++) {
        let nx = x + offsets[i].x;
        let nz = z + offsets[i].y;
        
        // Bounds check
        if (nx < 0 || nx >= i32(params.grid_size) || 
            nz < 0 || nz >= i32(params.grid_size)) {
            continue;
        }
        
        let neighborH = textureLoad(heightmap_in, vec2<i32>(nx, nz), 0).r;
        let diff = centerH - neighborH;
        
        // Calculate slope
        let slope = diff / params.grid_scale;
        
        // If slope exceeds talus angle, material should transfer
        if (slope > talusSlope) {
            let excess = (slope - talusSlope) * params.grid_scale;
            totalTransfer += excess * params.transfer_rate;
            neighborCount += 1.0;
            maxDiff = max(maxDiff, diff);
        }
    }
    
    // Calculate new height (material moves out to steeper neighbors)
    var newH = centerH;
    if (neighborCount > 0.0) {
        // Transfer material out (divided among steep neighbors)
        newH -= totalTransfer / neighborCount;
    }
    
    // Also receive material from higher neighbors
    // (This is handled implicitly since we process all cells)
    
    textureStore(heightmap_out, vec2<i32>(x, z), vec4<f32>(newH, 0.0, 0.0, 1.0));
}
`;

// Thermal erosion with material receiving (two-pass approach)
const THERMAL_RECEIVE_SHADER = /* wgsl */ `
${THERMAL_PARAMS}

@group(0) @binding(0) var heightmap: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> transfer_buffer: array<atomic<i32>>;
@group(0) @binding(2) var material_map: texture_2d<u32>;
@group(0) @binding(3) var<uniform> params: ThermalParams;

const FIXED_SCALE: f32 = 10000.0;
@group(0) @binding(4) var heightmap_out: texture_storage_2d<r32float, write>;

fn getTalusSlope(materialId: u32) -> f32 {
    if (materialId < 16u) {
        return TALUS_SLOPES[materialId];
    }
    return 1.0;
}

fn toIndex(x: i32, z: i32) -> u32 {
    return u32(x) + u32(z) * params.grid_size;
}

// Pass 1: Calculate transfers and write to buffer
@compute @workgroup_size(8, 8)
fn calculate_transfers(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = i32(gid.x);
    let z = i32(gid.y);
    
    if (gid.x >= params.grid_size || gid.y >= params.grid_size) {
        return;
    }
    
    let centerH = textureLoad(heightmap, vec2<i32>(x, z), 0).r;
    let centerMat = textureLoad(material_map, vec2<i32>(x, z), 0).r;
    let talusSlope = getTalusSlope(centerMat);
    
    let offsets = array<vec2<i32>, 4>(
        vec2<i32>(1, 0), vec2<i32>(-1, 0),
        vec2<i32>(0, 1), vec2<i32>(0, -1),
    );
    
    // Count valid steep neighbors
    var steepNeighbors = 0u;
    var steepIndices: array<u32, 4>;
    var steepExcess: array<f32, 4>;
    
    for (var i = 0u; i < 4u; i++) {
        let nx = x + offsets[i].x;
        let nz = z + offsets[i].y;
        
        if (nx < 0 || nx >= i32(params.grid_size) || 
            nz < 0 || nz >= i32(params.grid_size)) {
            continue;
        }
        
        let neighborH = textureLoad(heightmap, vec2<i32>(nx, nz), 0).r;
        let diff = centerH - neighborH;
        let slope = diff / params.grid_scale;
        
        if (slope > talusSlope) {
            let excess = (slope - talusSlope) * params.grid_scale * 0.5;
            steepIndices[steepNeighbors] = toIndex(nx, nz);
            steepExcess[steepNeighbors] = excess;
            steepNeighbors += 1u;
        }
    }
    
    // Distribute excess material to steep neighbors
    if (steepNeighbors > 0u) {
        let totalExcess = steepExcess[0] + steepExcess[1] + steepExcess[2] + steepExcess[3];
        let transferPerNeighbor = min(totalExcess * params.transfer_rate / f32(steepNeighbors), max(0.0, centerH) / f32(steepNeighbors));
        // Quantize once, then remove exactly the amount added to neighbours.
        let addDelta = i32(transferPerNeighbor * FIXED_SCALE);
        
        // Remove from self
        let selfIdx = toIndex(x, z);
        let removeDelta = -addDelta * i32(steepNeighbors);
        atomicAdd(&transfer_buffer[selfIdx], removeDelta);
        
        // Add to neighbors
        for (var i = 0u; i < steepNeighbors; i++) {
            atomicAdd(&transfer_buffer[steepIndices[i]], addDelta);
        }
    }
}

// Pass 2: Apply transfers
@compute @workgroup_size(8, 8)
fn apply_transfers(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = i32(gid.x);
    let z = i32(gid.y);
    
    if (gid.x >= params.grid_size || gid.y >= params.grid_size) {
        return;
    }
    
    let idx = toIndex(x, z);
    let delta = atomicExchange(&transfer_buffer[idx], 0i);
    
    let current = textureLoad(heightmap, vec2<i32>(x, z), 0).r;
    textureStore(heightmap_out, vec2<i32>(x, z), vec4<f32>(current + f32(delta) / FIXED_SCALE, 0.0, 0.0, 1.0));
}
`;

// ============================================================================
// JAVASCRIPT CLASS
// ============================================================================

/**
 * ThermalErosion - GPU material-specific talus angle erosion
 */
export class ThermalErosion {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // Configuration
        this.config = {
            gridSize: 256,
            gridScale: 1.0,
            transferRate: 0.5,
            iterations: 4,
            origin: [0, 0],
            dt: 0.1,
        };
        
        // GPU resources
        this.paramsBuffer = null;
        this.transferBuffer = null;
        
        // Ping-pong heightmaps
        this.heightmapTextures = [null, null];
        this.currentHeightmap = 0;
        
        // Material map
        this.materialMapTexture = null;
        
        // Pipelines
        this.erodePipeline = null;
        this.transferPipeline = null;
        this.applyPipeline = null;
        
        // Stats
        this.stats = {
            iterations: 0,
            totalTransferred: 0,
        };
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     * @param {GPUTexture} initialHeightmap - Initial terrain heightmap
     * @param {GPUTexture} materialMap - Material ID per cell
     */
    async init(device, initialHeightmap = null, materialMap = null) {
        this.device = device;
        
        // Create params buffer
        this.paramsBuffer = device.createBuffer({
            label: 'Thermal Params',
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Create transfer buffer (for atomic accumulation)
        const bufferSize = this.config.gridSize * this.config.gridSize * 4;
        this.transferBuffer = device.createBuffer({
            label: 'Thermal Transfer Buffer',
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Create ping-pong heightmap textures
        for (let i = 0; i < 2; i++) {
            this.heightmapTextures[i] = device.createTexture({
                label: `Thermal Heightmap ${i}`,
                size: [this.config.gridSize, this.config.gridSize],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | 
                       GPUTextureUsage.STORAGE_BINDING | 
                       GPUTextureUsage.COPY_DST |
                       GPUTextureUsage.COPY_SRC,
            });
        }
        
        // Create default material map if not provided
        if (!materialMap) {
            this._ownsMaterialMap = true;
            this.materialMapTexture = device.createTexture({
                label: 'Material Map',
                size: [this.config.gridSize, this.config.gridSize],
                format: 'r32uint',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            // Default to bedrock
            const data = new Uint32Array(this.config.gridSize * this.config.gridSize).fill(1);
            device.queue.writeTexture(
                { texture: this.materialMapTexture },
                data,
                { bytesPerRow: this.config.gridSize * 4 },
                [this.config.gridSize, this.config.gridSize]
            );
        } else {
            this._ownsMaterialMap = false;
            this.materialMapTexture = materialMap;
        }
        
        // Copy initial heightmap if provided
        if (initialHeightmap) {
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToTexture(
                { texture: initialHeightmap },
                { texture: this.heightmapTextures[0] },
                [this.config.gridSize, this.config.gridSize]
            );
            device.queue.submit([encoder.finish()]);
        }
        
        // Update params
        this._updateParams();
        
        // Create pipelines
        await this._createPipelines();
        
        this.initialized = true;
        console.log(`[ThermalErosion] Initialized ${this.config.gridSize}x${this.config.gridSize} grid`);
    }
    
    /**
     * Update params buffer
     * @private
     */
    _updateParams() {
        const c = this.config;
        const params = new ArrayBuffer(32);
        const u32 = new Uint32Array(params);
        const f32 = new Float32Array(params);
        
        u32[0] = c.gridSize;
        f32[1] = c.gridScale;
        f32[2] = c.transferRate;
        u32[3] = c.iterations;
        f32[4] = c.origin[0];
        f32[5] = c.origin[1];
        f32[6] = c.dt;
        f32[7] = 0;
        
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params);
    }
    
    /**
     * Create compute pipelines
     * @private
     */
    async _createPipelines() {
        // The two-pass path transfers material to neighbours. The former
        // single-pass shader removed height without depositing it anywhere.
        const erodeModule = this.device.createShaderModule({
            label: 'Thermal Erode Shader',
            code: THERMAL_RECEIVE_SHADER,
        });
        
        this.erodePipeline = this.device.createComputePipeline({
            label: 'Thermal Erode Pipeline',
            layout: 'auto',
            compute: {
                module: erodeModule,
                entryPoint: 'calculate_transfers',
            },
        });
        this.applyPipeline = this.device.createComputePipeline({
            label: 'Thermal Apply Transfers Pipeline', layout: 'auto',
            compute: { module: erodeModule, entryPoint: 'apply_transfers' },
        });
    }
    
    /**
     * Run thermal erosion iterations
     * @param {GPUCommandEncoder} encoder 
     * @param {number} iterations - Override iteration count
     */
    step(encoder, iterations = null) {
        const iters = iterations ?? this.config.iterations;
        
        for (let i = 0; i < iters; i++) {
            const srcIdx = this.currentHeightmap;
            const dstIdx = 1 - srcIdx;
            
            const bindGroup = this.device.createBindGroup({
                layout: this.erodePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.heightmapTextures[srcIdx].createView() },
                    { binding: 1, resource: { buffer: this.transferBuffer } },
                    { binding: 2, resource: this.materialMapTexture.createView() },
                    { binding: 3, resource: { buffer: this.paramsBuffer } },
                ],
            });
            
            const pass = encoder.beginComputePass({ label: `Thermal Erosion ${i}` });
            pass.setPipeline(this.erodePipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(
                Math.ceil(this.config.gridSize / 8),
                Math.ceil(this.config.gridSize / 8)
            );
            pass.end();
            const applyGroup = this.device.createBindGroup({
                layout: this.applyPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.heightmapTextures[srcIdx].createView() },
                    { binding: 1, resource: { buffer: this.transferBuffer } },
                    { binding: 3, resource: { buffer: this.paramsBuffer } },
                    { binding: 4, resource: this.heightmapTextures[dstIdx].createView() },
                ],
            });
            const apply = encoder.beginComputePass({ label: `Thermal Transfer Apply ${i}` });
            apply.setPipeline(this.applyPipeline); apply.setBindGroup(0, applyGroup);
            apply.dispatchWorkgroups(Math.ceil(this.config.gridSize / 8), Math.ceil(this.config.gridSize / 8));
            apply.end();
            
            // Swap buffers
            this.currentHeightmap = dstIdx;
        }
        
        this.stats.iterations += iters;
    }
    
    /**
     * Get current heightmap texture
     */
    getHeightmapTexture() {
        return this.heightmapTextures[this.currentHeightmap];
    }
    
    /**
     * Set material at grid position
     * @param {number} x 
     * @param {number} z 
     * @param {number} materialId 
     */
    setMaterial(x, z, materialId) {
        const data = new Uint32Array([materialId]);
        this.device.queue.writeTexture(
            { texture: this.materialMapTexture, origin: [x, z] },
            data,
            { bytesPerRow: 4 },
            [1, 1]
        );
    }
    
    /**
     * Set configuration
     * @param {Object} config 
     */
    setConfig(config) {
        Object.assign(this.config, config);
        if (this.initialized) {
            this._updateParams();
        }
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.paramsBuffer?.destroy();
        this.transferBuffer?.destroy();
        this.heightmapTextures.forEach(t => t?.destroy());
        if (this._ownsMaterialMap) this.materialMapTexture?.destroy();
        this.paramsBuffer = null; this.transferBuffer = null;
        this.heightmapTextures = [null, null]; this.materialMapTexture = null;
        this.initialized = false;
    }
}

export default ThermalErosion;
