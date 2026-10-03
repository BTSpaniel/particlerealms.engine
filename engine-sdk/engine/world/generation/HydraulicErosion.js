// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HydraulicErosion.js - GPU Momentum-Based Hydraulic Erosion
 * 
 * Implements particle-based erosion with momentum conservation for:
 * - Realistic meandering rivers (inertia causes overshoot on curves)
 * - Mass-conserving sediment transport
 * - Vegetation-constrained erosion
 * - Dynamic lake/pool formation via flood-fill
 * - Stream map for river visualization
 * 
 * INTEGRATION:
 * - Uses shared particle system (game.worldParticles)
 * - Uses SpatialHashCompute for GPU neighbor queries
 * - Uses FragmentPhysics for sediment → particle conversion
 * 
 * Based on: Nick McDonald's SimpleHydrology / Meandering Rivers / Procedural Hydrology
 * https://nickmcd.me/2020/04/15/procedural-hydrology/
 * 
 * Key insight: v_new = v_old * (1-α) - ∇h * α  (inertia blending)
 * Lake formation: Particles that stop descending trigger flood-fill
 * 
 * Uses fixed-point atomics to handle concurrent terrain modification.
 */

import { calcWGSLStructSize, getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const FIXED_POINT_SCALE = 10000.0;  // Scale for fixed-point atomic ops
const MAX_PARTICLES = 65536;
const PARTICLE_STRIDE = 32;  // 7 x f32 + one fixed-point u32 sediment ledger
const SETTLE_PAGE_SIZE = 4096; // Apply between bounded groups to avoid i32 deposit overflow

// ============================================================================
// SHADER SOURCES
// ============================================================================

const PARTICLE_STRUCT = /* wgsl */ `
struct WaterParticle {
    pos: vec2<f32>,      // World position (x, z)
    vel: vec2<f32>,      // Velocity vector
    volume: f32,         // Water volume
    sediment: u32,       // Carried material in exact 1/10000-height units
    age: f32,            // Lifetime counter
    isActive: f32,       // 1.0 = active, 0.0 = dead
}
`;

const EROSION_PARAMS = /* wgsl */ `
struct ErosionParams {
    // Terrain
    terrain_size: u32,       // Grid resolution
    terrain_scale: f32,      // World units per cell
    terrain_origin_x: f32,
    terrain_origin_z: f32,
    
    // Physics
    gravity: f32,            // Gravity strength
    inertia: f32,            // Momentum factor (0=follow gradient, 1=pure inertia)
    friction: f32,           // Velocity damping
    min_slope: f32,          // Minimum slope for erosion
    
    // Erosion
    erosion_rate: f32,       // Base erosion strength
    deposition_rate: f32,    // Sediment drop rate
    capacity_factor: f32,    // Sediment capacity multiplier
    evaporation_rate: f32,   // Water loss per step
    
    // Bounds
    max_lifetime: f32,       // Max particle age
    min_volume: f32,         // Kill particle below this
    dt: f32,                 // Time step
    
    // Hydrology (lakes/rivers)
    pool_volume_factor: f32, // How volume translates to water level
    stream_decay: f32,       // How fast stream map fades
    flood_threshold: f32,    // Min volume to trigger flood
    _pad: f32,
}
`;

// Calculate buffer size dynamically (prevents size mismatch errors)
const EROSION_PARAMS_SIZE = calcWGSLStructSize(EROSION_PARAMS);
const EROSION_PARAMS_FLOATS = getFloat32ArraySize(EROSION_PARAMS);

// Spawn water particles (rain)
const SPAWN_PARTICLES_SHADER = /* wgsl */ `
${PARTICLE_STRUCT}

struct SpawnParams {
    x: f32, z: f32, radius: f32, count: u32,
    seed: u32, _pad0: u32, _pad1: u32, _pad2: u32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<WaterParticle>;
@group(0) @binding(1) var<storage, read_write> particle_count: atomic<u32>;
@group(0) @binding(2) var<uniform> spawn_params: SpawnParams;

// Simple hash for pseudo-random
fn hash(n: u32) -> f32 {
    var x = n;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = (x >> 16u) ^ x;
    return f32(x) / f32(0xFFFFFFFFu);
}

@compute @workgroup_size(64)
fn spawn_particles(@builtin(global_invocation_id) gid: vec3<u32>) {
    let spawn_count = spawn_params.count;
    if (gid.x >= spawn_count) {
        return;
    }
    
    // Get slot
    let idx = atomicAdd(&particle_count, 1u);
    if (idx >= arrayLength(&particles)) {
        return;
    }
    
    // Random position within spawn radius
    let seed = gid.x * 1234567u + spawn_params.seed;
    let angle = hash(seed) * 6.283185;
    let radius = sqrt(hash(seed + 1u)) * spawn_params.radius;
    
    let px = spawn_params.x + cos(angle) * radius;
    let pz = spawn_params.z + sin(angle) * radius;
    
    particles[idx] = WaterParticle(
        vec2<f32>(px, pz),  // pos
        vec2<f32>(0.0, 0.0), // vel (starts stationary)
        1.0,                 // volume
        0u,                  // sediment (fixed-point units)
        0.0,                 // age
        1.0,                 // isActive
    );
}
`;

// Main erosion simulation step
const EROSION_STEP_SHADER = /* wgsl */ `
${PARTICLE_STRUCT}
${EROSION_PARAMS}

@group(0) @binding(0) var<storage, read_write> particles: array<WaterParticle>;
@group(0) @binding(1) var<uniform> params: ErosionParams;
@group(0) @binding(2) var heightmap: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> erosion_delta: array<atomic<i32>>;
@group(0) @binding(4) var vegetation_map: texture_2d<f32>;
// Cumulative particle visits, not a flow-rate or a water-depth field.
@group(0) @binding(5) var<storage, read_write> stream_visits: array<atomic<u32>>;
@group(0) @binding(6) var<uniform> settle_start: u32;

// Sample terrain height using textureLoad (no filtering required)
fn sampleHeight(pos: vec2<f32>) -> f32 {
    let px = (pos.x - params.terrain_origin_x) / params.terrain_scale;
    let pz = (pos.y - params.terrain_origin_z) / params.terrain_scale;
    let ix = i32(clamp(px, 0.0, f32(params.terrain_size - 1u)));
    let iz = i32(clamp(pz, 0.0, f32(params.terrain_size - 1u)));
    return textureLoad(heightmap, vec2<i32>(ix, iz), 0).r;
}

// Calculate gradient at position
fn calcGradient(pos: vec2<f32>) -> vec2<f32> {
    let eps = params.terrain_scale;
    let hL = sampleHeight(pos - vec2<f32>(eps, 0.0));
    let hR = sampleHeight(pos + vec2<f32>(eps, 0.0));
    let hD = sampleHeight(pos - vec2<f32>(0.0, eps));
    let hU = sampleHeight(pos + vec2<f32>(0.0, eps));
    
    return vec2<f32>(hR - hL, hU - hD) / (2.0 * eps);
}

// Sample vegetation (erosion resistance) using textureLoad
fn sampleVegetation(pos: vec2<f32>) -> f32 {
    let px = (pos.x - params.terrain_origin_x) / params.terrain_scale;
    let pz = (pos.y - params.terrain_origin_z) / params.terrain_scale;
    let ix = i32(clamp(px, 0.0, f32(params.terrain_size - 1u)));
    let iz = i32(clamp(pz, 0.0, f32(params.terrain_size - 1u)));
    return textureLoad(vegetation_map, vec2<i32>(ix, iz), 0).r;
}

// Convert world pos to grid index
fn posToIndex(pos: vec2<f32>) -> u32 {
    let gx = u32(clamp((pos.x - params.terrain_origin_x) / params.terrain_scale, 
                       0.0, f32(params.terrain_size - 1u)));
    let gz = u32(clamp((pos.y - params.terrain_origin_z) / params.terrain_scale, 
                       0.0, f32(params.terrain_size - 1u)));
    return gx + gz * params.terrain_size;
}

const SEDIMENT_SCALE: f32 = ${FIXED_POINT_SCALE};

// Every particle sees the same height texture. Atomically reserve material
// against both that height and all pickups/deposits recorded in this step.
fn reserveSediment(index: u32, requested: i32, height: f32) -> u32 {
    let base = i32(floor(max(height, 0.0) * SEDIMENT_SCALE));
    var previous = atomicLoad(&erosion_delta[index]);
    loop {
        var available = max(0i, base + min(previous, 0i));
        if (previous > 0i) { available = previous + min(base, 2147483647i - previous); }
        let accepted = min(requested, available);
        if (accepted <= 0i) { return 0u; }
        let result = atomicCompareExchangeWeak(&erosion_delta[index], previous, previous - accepted);
        if (result.exchanged) { return u32(accepted); }
        previous = result.old_value;
    }
}

// Closing a trajectory returns its entire integer ledger, including on exit
// from the finite map. Clamp to the last edge instead of exporting sediment.
fn settleSediment(index: u32, sediment: u32) -> u32 {
    var previous = atomicLoad(&erosion_delta[index]);
    loop {
        let accepted = min(sediment, 2147483647u - u32(max(previous, 0i)));
        if (accepted == 0u) { return 0u; }
        let result = atomicCompareExchangeWeak(&erosion_delta[index], previous, previous + i32(accepted));
        if (result.exchanged) { return accepted; }
        previous = result.old_value;
    }
}

@compute @workgroup_size(64)
fn erosion_step(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= arrayLength(&particles)) {
        return;
    }
    
    var p = particles[idx];
    
    // Skip inactive particles
    if (p.isActive < 0.5) {
        return;
    }

    let currentInBounds = p.pos.x >= params.terrain_origin_x &&
        p.pos.x < params.terrain_origin_x + f32(params.terrain_size) * params.terrain_scale &&
        p.pos.y >= params.terrain_origin_z &&
        p.pos.y < params.terrain_origin_z + f32(params.terrain_size) * params.terrain_scale;
    if (currentInBounds) { atomicAdd(&stream_visits[posToIndex(p.pos)], 1u); }
    
    // Get current height and gradient
    let h0 = sampleHeight(p.pos);
    let grad = calcGradient(p.pos);
    
    // === MOMENTUM-BASED VELOCITY UPDATE ===
    // Key formula: v_new = v_old * (1-α) - ∇h * α
    // Low α = high inertia = meandering
    // High α = follow slope = straight rivers
    let alpha = params.inertia;
    var gradNorm = vec2<f32>(0.0);
    if (dot(grad, grad) > 0.0000000000000001) { gradNorm = normalize(-grad); }
    
    // Blend old velocity with gradient direction
    var newVel = p.vel * (1.0 - alpha) + gradNorm * alpha * params.gravity;
    
    // Apply friction
    newVel *= (1.0 - params.friction);
    
    // Update position
    let newPos = p.pos + newVel * params.dt;
    
    // Get new height
    let h1 = sampleHeight(newPos);
    let dh = h0 - h1;  // Height difference (positive = went downhill)
    
    // === EROSION & DEPOSITION ===
    let speed = length(newVel);
    let vegetation = sampleVegetation(p.pos);
    
    // Sediment capacity: C = volume * speed * K * (1 - vegetation)
    let capacity = p.volume * speed * params.capacity_factor * (1.0 - vegetation);
    
    let carried = f32(p.sediment) / SEDIMENT_SCALE;
    let gridIdx = posToIndex(p.pos);
    if (carried < capacity && dh > params.min_slope) {
        // Erode - pick up sediment
        // Erosion reduced by vegetation
        let erodeStrength = params.erosion_rate * (1.0 - vegetation * 0.8);
        let requested = i32(floor(max(0.0, min(dh, (capacity - carried) * erodeStrength)) * SEDIMENT_SCALE));
        p.sediment += reserveSediment(gridIdx, requested, h0);
    } else if (carried > capacity) {
        // Deposit - drop sediment
        let requested = min(p.sediment, u32(floor(max(0.0, (carried - capacity) * params.deposition_rate) * SEDIMENT_SCALE)));
        let deposited = settleSediment(gridIdx, requested);
        p.sediment -= deposited;
    }
    
    // === UPDATE PARTICLE STATE ===
    p.pos = newPos;
    p.vel = newVel;
    p.age += params.dt;
    
    // Evaporation
    p.volume *= (1.0 - params.evaporation_rate * params.dt);
    
    // Check death conditions
    let inBounds = newPos.x >= params.terrain_origin_x && 
                   newPos.x < params.terrain_origin_x + f32(params.terrain_size) * params.terrain_scale &&
                   newPos.y >= params.terrain_origin_z && 
                   newPos.y < params.terrain_origin_z + f32(params.terrain_size) * params.terrain_scale;
    
    if (!inBounds || p.volume < params.min_volume || p.age > params.max_lifetime || speed < 0.001) {
        // Die and deposit remaining sediment
        p.sediment -= settleSediment(posToIndex(p.pos), p.sediment);
        p.isActive = 0.0;
    }
    
    particles[idx] = p;
}

// A bounded bake can stop before the natural lifetime. Explicit settlement
// prevents reset/final readback from silently dropping surviving material.
@compute @workgroup_size(64)
fn settle_particles(@builtin(global_invocation_id) gid: vec3<u32>) {
    let index = settle_start + gid.x;
    if (index >= arrayLength(&particles)) { return; }
    var p = particles[index];
    p.sediment -= settleSediment(posToIndex(p.pos), p.sediment);
    p.isActive = 0.0;
    particles[index] = p;
}
`;

// Apply erosion deltas to heightmap
const APPLY_EROSION_SHADER = /* wgsl */ `
${EROSION_PARAMS}

@group(0) @binding(0) var<storage, read_write> erosion_delta: array<atomic<i32>>;
@group(0) @binding(1) var heightmap_out: texture_storage_2d<r32float, read_write>;
@group(0) @binding(2) var<uniform> params: ErosionParams;

const FIXED_SCALE: f32 = ${FIXED_POINT_SCALE};

@compute @workgroup_size(8, 8)
fn apply_erosion(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let z = gid.y;
    
    if (x >= params.terrain_size || z >= params.terrain_size) {
        return;
    }
    
    let idx = x + z * params.terrain_size;
    
    // Read and clear delta
    let delta = atomicExchange(&erosion_delta[idx], 0i);
    
    if (delta != 0i) {
        // Convert from fixed-point and apply
        let change = f32(delta) / FIXED_SCALE;
        let current = textureLoad(heightmap_out, vec2<i32>(i32(x), i32(z))).r;
        let newHeight = max(0.0, current + change);
        textureStore(heightmap_out, vec2<i32>(i32(x), i32(z)), vec4<f32>(newHeight, 0.0, 0.0, 1.0));
    }
}
`;

// Compact particles (remove dead ones)
const COMPACT_PARTICLES_SHADER = /* wgsl */ `
${PARTICLE_STRUCT}

@group(0) @binding(0) var<storage, read> particles_in: array<WaterParticle>;
@group(0) @binding(1) var<storage, read_write> particles_out: array<WaterParticle>;
@group(0) @binding(2) var<storage, read_write> out_count: atomic<u32>;
@group(0) @binding(3) var<uniform> in_count: u32;

@compute @workgroup_size(64)
fn compact_particles(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= in_count) {
        return;
    }
    
    let p = particles_in[idx];
    
    // Only copy active particles
    if (p.isActive > 0.5) {
        let out_idx = atomicAdd(&out_count, 1u);
        particles_out[out_idx] = p;
    }
}
`;

// ============================================================================
// JAVASCRIPT CLASS
// ============================================================================

/**
 * HydraulicErosion - GPU particle-based erosion with momentum
 */
export class HydraulicErosion {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // Configuration
        this.config = {
            terrainSize: 256,
            terrainScale: 1.0,
            terrainOrigin: [0, 0],
            seed: 7314,
            
            gravity: 4.0,
            inertia: 0.3,         // Low = more meandering
            friction: 0.05,
            minSlope: 0.01,
            
            erosionRate: 0.3,
            depositionRate: 0.3,
            capacityFactor: 8.0,
            evaporationRate: 0.02,
            
            maxLifetime: 50.0,
            minVolume: 0.01,
            dt: 0.1,
        };
        
        // GPU resources
        this.particleBuffers = [null, null];  // Ping-pong
        this.currentBuffer = 0;
        this.particleCountBuffer = null;
        this.erosionDeltaBuffer = null;
        this.paramsBuffer = null;
        this.spawnParamsBuffer = null;
        this.spawnParameterBuffers = new Map();
        this.settleParameterBuffers = [];
        this.streamMapBuffer = null;
        this.ownsVegetationTexture = false;
        
        // External system references (set via setParticleSystem)
        this.sharedParticleSystem = null;  // game.worldParticles
        this.spatialHash = null;           // SpatialHashCompute instance
        this.physicsWorld = null;          // PhysX world for sediment physics
        
        // Callbacks for particle integration
        this.onWaterParticleSpawn = null;  // (particles) => add to worldParticles
        this.onSedimentDrop = null;        // (sediment, position) => spawn debris
        
        // Pipelines
        this.spawnPipeline = null;
        this.erosionPipeline = null;
        this.settlePipeline = null;
        this.applyPipeline = null;
        this.compactPipeline = null;
        
        // Stats
        this.stats = {
            activeParticles: 0,
            totalSpawned: 0,
            erosionSteps: 0,
        };
    }
    
    /**
     * Connect to shared particle system and physics
     * @param {Object} options - {particleSystem, spatialHash, physicsWorld}
     */
    setParticleSystem(options) {
        if (options.particleSystem) this.sharedParticleSystem = options.particleSystem;
        if (options.spatialHash) this.spatialHash = options.spatialHash;
        if (options.physicsWorld) this.physicsWorld = options.physicsWorld;
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     * @param {GPUTexture} heightmapTexture - R32Float terrain heightmap
     * @param {GPUTexture} vegetationTexture - Optional vegetation density
     */
    async init(device, heightmapTexture, vegetationTexture = null) {
        this.device = device;
        this.heightmapTexture = heightmapTexture;
        this.ownsVegetationTexture = !vegetationTexture;
        this.vegetationTexture = vegetationTexture || this._createDummyTexture();
        
        // Create particle buffers (ping-pong for compaction)
        for (let i = 0; i < 2; i++) {
            this.particleBuffers[i] = device.createBuffer({
                label: `Erosion Particles ${i}`,
                size: MAX_PARTICLES * PARTICLE_STRIDE,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        }
        
        // Particle count buffer
        this.particleCountBuffer = device.createBuffer({
            label: 'Erosion Particle Count',
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | GPUBufferUsage.UNIFORM,
        });
        
        // Erosion delta buffer (fixed-point atomics)
        const deltaSize = this.config.terrainSize * this.config.terrainSize * 4;
        this.erosionDeltaBuffer = device.createBuffer({
            label: 'Erosion Delta',
            size: deltaSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.streamMapBuffer = device.createBuffer({
            label: 'Erosion Cumulative Particle Visits',
            size: deltaSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        
        // Params buffer with dynamically calculated size (prevents size mismatch errors)
        this.paramsBuffer = device.createBuffer({
            label: 'Erosion Params',
            size: EROSION_PARAMS_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        console.log(`[HydraulicErosion] Params buffer: ${EROSION_PARAMS_SIZE} bytes (${EROSION_PARAMS_FLOATS} floats)`);
        
        // Create sampler
        this.sampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        
        // Update params
        this._updateParams();
        
        // Create pipelines
        await this._createPipelines();
        for (let start = 0; start < MAX_PARTICLES; start += SETTLE_PAGE_SIZE) {
            const buffer = device.createBuffer({ label: `Immutable Sediment Settlement ${start}`, size: 4, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
            new Uint32Array(buffer.getMappedRange())[0] = start; buffer.unmap();
            this.settleParameterBuffers.push(buffer);
        }
        
        this.initialized = true;
        console.log(`[HydraulicErosion] Initialized, max ${MAX_PARTICLES} particles`);
    }
    
    /**
     * Create dummy vegetation texture (no vegetation)
     * @private
     */
    _createDummyTexture() {
        const texture = this.device.createTexture({
            size: [1, 1],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        this.device.queue.writeTexture(
            { texture },
            new Float32Array([0.0]),
            { bytesPerRow: 4 },
            [1, 1]
        );
        return texture;
    }
    
    /**
     * Update params buffer
     * @private
     */
    _updateParams() {
        const c = this.config;
        // Use dynamically calculated buffer size to prevent mismatch errors
        const params = new Float32Array(EROSION_PARAMS_FLOATS);
        
        // Fill in all struct fields
        params[0] = c.terrainSize;  // Will be fixed as u32 below
        params[1] = c.terrainScale;
        params[2] = c.terrainOrigin[0];
        params[3] = c.terrainOrigin[1];
        params[4] = c.gravity;
        params[5] = c.inertia;
        params[6] = c.friction;
        params[7] = c.minSlope;
        params[8] = c.erosionRate;
        params[9] = c.depositionRate;
        params[10] = c.capacityFactor;
        params[11] = c.evaporationRate;
        params[12] = c.maxLifetime;
        params[13] = c.minVolume;
        params[14] = c.dt;
        params[15] = c.poolVolumeFactor ?? 0.001;
        params[16] = c.streamDecay ?? 0.99;
        params[17] = c.floodThreshold ?? 0.1;
        params[18] = 0;  // _pad
        // Remaining slots are auto-zero from Float32Array initialization
        
        // Fix terrain_size as u32
        const view = new DataView(params.buffer);
        view.setUint32(0, c.terrainSize, true);
        
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params);
    }
    
    /**
     * Create compute pipelines
     * @private
     */
    async _createPipelines() {
        // Spawn pipeline
        const spawnModule = this.device.createShaderModule({
            label: 'Spawn Particles Shader',
            code: SPAWN_PARTICLES_SHADER,
        });
        this.spawnPipeline = this.device.createComputePipeline({
            label: 'Spawn Particles Pipeline',
            layout: 'auto',
            compute: { module: spawnModule, entryPoint: 'spawn_particles' },
        });
        
        // Erosion pipeline
        const erosionModule = this.device.createShaderModule({
            label: 'Erosion Step Shader',
            code: EROSION_STEP_SHADER,
        });
        this.erosionPipeline = this.device.createComputePipeline({
            label: 'Erosion Step Pipeline',
            layout: 'auto',
            compute: { module: erosionModule, entryPoint: 'erosion_step' },
        });
        this.settlePipeline = this.device.createComputePipeline({
            label: 'Settle Erosion Particles Pipeline', layout: 'auto',
            compute: { module: erosionModule, entryPoint: 'settle_particles' },
        });
        
        // Apply pipeline
        const applyModule = this.device.createShaderModule({
            label: 'Apply Erosion Shader',
            code: APPLY_EROSION_SHADER,
        });
        this.applyPipeline = this.device.createComputePipeline({
            label: 'Apply Erosion Pipeline',
            layout: 'auto',
            compute: { module: applyModule, entryPoint: 'apply_erosion' },
        });
        
        // Compact pipeline
        const compactModule = this.device.createShaderModule({
            label: 'Compact Particles Shader',
            code: COMPACT_PARTICLES_SHADER,
        });
        this.compactPipeline = this.device.createComputePipeline({
            label: 'Compact Particles Pipeline',
            layout: 'auto',
            compute: { module: compactModule, entryPoint: 'compact_particles' },
        });
    }
    
    /**
     * Spawn water particles (rain)
     * @param {GPUCommandEncoder} encoder 
     * @param {number} x - Center X
     * @param {number} z - Center Z
     * @param {number} radius - Spawn radius
     * @param {number} count - Number to spawn
     */
    spawnParticles(encoder, x, z, radius, count, seed = this.config.seed) {
        if (!this.initialized) throw new Error('Initialize hydraulic erosion before spawning rain.');
        if (![x, z, radius].every(Number.isFinite) || radius < 0 || !Number.isInteger(count) || count < 0 || count > MAX_PARTICLES || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new TypeError('Rain requires finite bounds, a count in [0, 65536] and an unsigned seed.');
        if (count === 0) return;
        // Immutable uniforms prevent two rain batches recorded in the same
        // encoder from aliasing one queue-written parameter buffer. Repeated
        // real-time rainfall reuses its exact descriptor; memory stays bounded.
        const key = JSON.stringify([x, z, radius, count, seed]);
        let parameters = this.spawnParameterBuffers.get(key);
        if (!parameters) {
            if (this.spawnParameterBuffers.size >= 512) throw new RangeError('Rain descriptor budget reached. Destroy/recreate the bounded erosion job.');
            parameters = this.device.createBuffer({ label: 'Immutable Rain Spawn Params', size: 32, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
            const mapped = parameters.getMappedRange(), floats = new Float32Array(mapped), integers = new Uint32Array(mapped);
            floats.set([x, z, radius]); integers[3] = count; integers[4] = seed; parameters.unmap();
            this.spawnParameterBuffers.set(key, parameters);
        }
        this.spawnParamsBuffer = parameters;
        
        const bindGroup = this.device.createBindGroup({
            layout: this.spawnPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.particleBuffers[this.currentBuffer] } },
                { binding: 1, resource: { buffer: this.particleCountBuffer } },
                { binding: 2, resource: { buffer: parameters } },
            ],
        });
        
        const pass = encoder.beginComputePass({ label: 'Spawn Particles' });
        pass.setPipeline(this.spawnPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(count / 64));
        pass.end();
        
        this.stats.totalSpawned += count;
    }
    
    /**
     * Run one erosion simulation step
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUTextureView} heightmapView - Heightmap texture view
     * @param {GPUTexture} heightmapStorage - Storage texture for writing
     */
    step(encoder, heightmapView, heightmapStorage) {
        if (!this.initialized) throw new Error('Initialize hydraulic erosion before stepping.');
        // Erosion step
        const erosionBindGroup = this.device.createBindGroup({
            layout: this.erosionPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.particleBuffers[this.currentBuffer] } },
                { binding: 1, resource: { buffer: this.paramsBuffer } },
                { binding: 2, resource: heightmapView },
                { binding: 3, resource: { buffer: this.erosionDeltaBuffer } },
                { binding: 4, resource: this.vegetationTexture.createView() },
                { binding: 5, resource: { buffer: this.streamMapBuffer } },
            ],
        });
        
        const erosionPass = encoder.beginComputePass({ label: 'Erosion Step' });
        erosionPass.setPipeline(this.erosionPipeline);
        erosionPass.setBindGroup(0, erosionBindGroup);
        erosionPass.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 64));
        erosionPass.end();
        this._applyErosionDeltas(encoder, heightmapStorage);
        this.stats.erosionSteps++;
    }

    /** Return all surviving sediment to this closed terrain before reset/readback.
     * Record settlement and apply in the same encoder, then submit before reset.
     * This leaves the borrowed height texture and accumulated stream visits alive. */
    settleParticles(encoder, heightmapTexture = this.heightmapTexture) {
        if (!this.initialized) throw new Error('Initialize hydraulic erosion before settling particles.');
        if (!heightmapTexture?.createView) throw new TypeError('Settlement requires the borrowed terrain texture.');
        for (const parameters of this.settleParameterBuffers) {
            const group = this.device.createBindGroup({
                layout: this.settlePipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.particleBuffers[this.currentBuffer] } },
                    { binding: 1, resource: { buffer: this.paramsBuffer } },
                    { binding: 3, resource: { buffer: this.erosionDeltaBuffer } },
                    { binding: 6, resource: { buffer: parameters } },
                ],
            });
            const pass = encoder.beginComputePass({ label: 'Settle Erosion Particles' });
            pass.setPipeline(this.settlePipeline); pass.setBindGroup(0, group);
            pass.dispatchWorkgroups(Math.ceil(SETTLE_PAGE_SIZE / 64)); pass.end();
            this._applyErosionDeltas(encoder, heightmapTexture);
        }
        this.stats.activeParticles = 0;
        console.debug('[HydraulicErosion][settleParticles]', { terrainSize: this.config.terrainSize });
    }

    /** Apply recorded integer changes only after the particle dispatch ends. */
    _applyErosionDeltas(encoder, heightmapStorage) {
        const applyBindGroup = this.device.createBindGroup({
            layout: this.applyPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.erosionDeltaBuffer } },
                { binding: 1, resource: heightmapStorage.createView() },
                { binding: 2, resource: { buffer: this.paramsBuffer } },
            ],
        });
        
        const applyPass = encoder.beginComputePass({ label: 'Apply Erosion' });
        applyPass.setPipeline(this.applyPipeline);
        applyPass.setBindGroup(0, applyBindGroup);
        applyPass.dispatchWorkgroups(
            Math.ceil(this.config.terrainSize / 8),
            Math.ceil(this.config.terrainSize / 8)
        );
        applyPass.end();
    }
    
    /**
     * Set erosion configuration
     * @param {Object} config 
     */
    setConfig(config) {
        Object.assign(this.config, config);
        if (this.initialized) {
            this._updateParams();
        }
    }
    
    /**
     * Reset simulation
     */
    reset({ preserveFlow = false } = {}) {
        if (!this.initialized) return;
        if (typeof preserveFlow !== 'boolean') throw new TypeError('preserveFlow must be boolean.');
        
        // Clear particle count
        this.device.queue.writeBuffer(this.particleCountBuffer, 0, new Uint32Array([0]));
        
        // Clear erosion delta
        const zeros = new Int32Array(this.config.terrainSize * this.config.terrainSize);
        this.device.queue.writeBuffer(this.erosionDeltaBuffer, 0, zeros);
        // All slots execute each step. Clearing the count alone resurrects old
        // active particles when the caller starts another bounded rain batch.
        const particles = new Uint8Array(MAX_PARTICLES * PARTICLE_STRIDE);
        for (const buffer of this.particleBuffers) this.device.queue.writeBuffer(buffer, 0, particles);
        if (!preserveFlow) this.device.queue.writeBuffer(this.streamMapBuffer, 0, zeros);
        this.currentBuffer = 0;
        
        this.stats.activeParticles = 0;
    }
    
    /**
     * Get current stats
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Get stream map buffer for river visualization
     * Uint32 cumulative in-bounds particle visits per terrain cell. Consumers
     * may normalize this measured traffic for display; it is not water depth.
     */
    getStreamMapBuffer() {
        return this.streamMapBuffer;
    }
    
    /**
     * Get pool map buffer for lake visualization  
     * Pool map stores water depth at each cell
     */
    getPoolMapBuffer() {
        return this.poolMapBuffer;
    }
    
    /**
     * CPU flood-fill for lake formation (called when particle stops with volume)
     * Based on Nick McDonald's Procedural Hydrology flood algorithm
     * @param {Float32Array} heightmap - Terrain heightmap
     * @param {Float32Array} poolMap - Pool depth map (modified in place)
     * @param {number} startX - Flood start X
     * @param {number} startZ - Flood start Z  
     * @param {number} volume - Water volume to distribute
     * @param {number} gridSize - Grid resolution
     */
    floodFill(heightmap, poolMap, startX, startZ, volume, gridSize) {
        const idx = (x, z) => x * gridSize + z;
        const startIdx = idx(startX, startZ);
        
        let plane = heightmap[startIdx] + poolMap[startIdx];
        const initialPlane = plane;
        const volumeFactor = this.config.poolVolumeFactor || 100;
        
        const minVol = 0.001;
        let remainingVolume = volume;
        let iterations = 0;
        const maxIterations = 100;
        
        while (remainingVolume > minVol && iterations < maxIterations) {
            iterations++;
            const floodSet = [];
            const tried = new Set();
            let drainFound = false;
            let drainIdx = -1;
            let drainHeight = Infinity;
            
            // Recursive flood-fill
            const fill = (i) => {
                if (tried.has(i)) return;
                tried.add(i);
                
                const x = Math.floor(i / gridSize);
                const z = i % gridSize;
                if (x < 0 || x >= gridSize || z < 0 || z >= gridSize) return;
                
                const cellHeight = heightmap[i] + poolMap[i];
                
                // Wall/boundary
                if (plane < cellHeight) return;
                
                // Drainage point (lower than initial water level)
                if (initialPlane > cellHeight) {
                    if (!drainFound || cellHeight < drainHeight) {
                        drainIdx = i;
                        drainHeight = cellHeight;
                    }
                    drainFound = true;
                    return;
                }
                
                // Part of pool
                floodSet.push(i);
                
                // Fill neighbors (8-way)
                fill(i + gridSize);
                fill(i - gridSize);
                fill(i + 1);
                fill(i - 1);
                fill(i + gridSize + 1);
                fill(i - gridSize - 1);
                fill(i + gridSize - 1);
                fill(i - gridSize + 1);
            };
            
            fill(startIdx);
            
            if (drainFound) {
                // Lower water level to drain height
                plane = 0.999 * initialPlane + 0.001 * drainHeight;
                for (const s of floodSet) {
                    poolMap[s] = Math.max(0, plane - heightmap[s]);
                }
                break;
            }
            
            // No drain - raise water level
            if (floodSet.length > 0) {
                const volumePerCell = remainingVolume / (floodSet.length * volumeFactor);
                plane += volumePerCell;
                
                for (const s of floodSet) {
                    poolMap[s] = Math.max(0, plane - heightmap[s]);
                }
                
                remainingVolume -= volumePerCell * floodSet.length;
            } else {
                break;
            }
        }
        
        return poolMap;
    }
    
    /**
     * Update stream map with particle track (time-averaged river positions)
     * @param {Float32Array} streamMap - Stream intensity map
     * @param {Array} particleTrack - Array of {x, z} positions visited
     * @param {number} gridSize - Grid resolution
     * @param {number} decayRate - How fast old streams fade (0-1)
     */
    updateStreamMap(streamMap, particleTrack, gridSize, decayRate = 0.01) {
        // Decay existing streams
        for (let i = 0; i < streamMap.length; i++) {
            streamMap[i] *= (1 - decayRate);
        }
        
        // Add new particle track
        for (const pos of particleTrack) {
            const x = Math.floor(pos.x);
            const z = Math.floor(pos.z);
            if (x >= 0 && x < gridSize && z >= 0 && z < gridSize) {
                const idx = x * gridSize + z;
                streamMap[idx] = Math.min(1, streamMap[idx] + 0.1);
            }
        }
        
        return streamMap;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.particleBuffers.forEach(b => b?.destroy());
        this.particleBuffers = [null, null];
        this.particleCountBuffer?.destroy();
        this.erosionDeltaBuffer?.destroy();
        this.paramsBuffer?.destroy();
        this.streamMapBuffer?.destroy();
        this.poolMapBuffer?.destroy();
        for (const buffer of this.spawnParameterBuffers.values()) buffer.destroy();
        this.spawnParameterBuffers.clear();
        for (const buffer of this.settleParameterBuffers) buffer.destroy();
        this.settleParameterBuffers = [];
        if (this.ownsVegetationTexture) this.vegetationTexture?.destroy();
        for (const name of ['particleCountBuffer', 'erosionDeltaBuffer', 'paramsBuffer', 'spawnParamsBuffer', 'streamMapBuffer', 'poolMapBuffer', 'vegetationTexture', 'heightmapTexture']) this[name] = null;
        this.ownsVegetationTexture = false;
        this.initialized = false;
    }
}

export default HydraulicErosion;
