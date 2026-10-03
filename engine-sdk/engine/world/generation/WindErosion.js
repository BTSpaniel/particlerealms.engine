// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WindErosion.js - GPU Particle-Based Wind Erosion
 * 
 * Implements aeolian (wind) erosion using particle simulation:
 * - Wind particles fly/slide across terrain
 * - Abrasion converts rock to sediment
 * - Suspension picks up loose sediment
 * - Deposition drops sediment (dune formation)
 * - Cascade redistributes unstable sediment piles
 * 
 * Based on: Nick McDonald's Particle-Based Wind Erosion
 * https://nickmcd.me/2020/11/23/particle-based-wind-erosion/
 * 
 * Key mechanics:
 * - Flying: gravity + wind acceleration
 * - Sliding: deflection along surface normal
 * - Mass transport: abrasion, suspension, sedimentation
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_WIND_PARTICLES = 32768;
const PARTICLE_STRIDE = 32;  // 8 x f32

// ============================================================================
// SHADER SOURCES
// ============================================================================

const WIND_PARTICLE_STRUCT = /* wgsl */ `
struct WindParticle {
    pos: vec2<f32>,        // XZ position on terrain
    height: f32,           // Y height above ground
    sediment: f32,         // Carried sediment mass
    velocity: vec3<f32>,   // 3D velocity
    age: f32,              // Lifetime counter
}
`;

const WIND_EROSION_PARAMS = /* wgsl */ `
struct WindErosionParams {
    grid_size: u32,
    grid_scale: f32,
    particle_count: u32,
    max_lifetime: f32,
    
    gravity: f32,
    wind_speed_x: f32,
    wind_speed_z: f32,
    wind_acceleration: f32,
    
    abrasion_rate: f32,
    suspension_rate: f32,
    deposition_rate: f32,
    roughness: f32,
    
    settling_rate: f32,
    dt: f32,
    seed: u32,
    _pad: u32,
}
`;

const SPAWN_WIND_PARTICLES = /* wgsl */ `
${WIND_PARTICLE_STRUCT}
${WIND_EROSION_PARAMS}

@group(0) @binding(0) var<uniform> params: WindErosionParams;
@group(0) @binding(1) var<storage, read_write> particles: array<WindParticle>;
@group(0) @binding(2) var heightmap: texture_2d<f32>;

// Hash function for random numbers
fn hash(p: u32) -> f32 {
    var x = p;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = ((x >> 16u) ^ x) * 0x45d9f3bu;
    x = (x >> 16u) ^ x;
    return f32(x) / f32(0xffffffffu);
}

@compute @workgroup_size(64)
fn spawnParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particle_count) {
        return;
    }
    
    var p = particles[idx];
    
    // Respawn dead particles at boundary
    if (p.age >= params.max_lifetime || p.age < 0.0) {
        let seed = params.seed + idx * 7919u;
        let r = hash(seed);
        
        // Spawn on upwind boundary
        let boundary = hash(seed + 1u) * f32(params.grid_size);
        if (r < 0.5) {
            p.pos = vec2<f32>(0.0, boundary);
        } else {
            p.pos = vec2<f32>(boundary, 0.0);
        }
        
        // Sample terrain height at spawn
        let texCoord = vec2<i32>(i32(p.pos.x), i32(p.pos.y));
        let terrainHeight = textureLoad(heightmap, texCoord, 0).r;
        
        p.height = terrainHeight + 5.0;  // Start slightly above terrain
        p.sediment = 0.0;
        p.velocity = vec3<f32>(params.wind_speed_x, 0.0, params.wind_speed_z);
        p.age = 0.0;
    }
    
    particles[idx] = p;
}
`;

const WIND_EROSION_STEP = /* wgsl */ `
${WIND_PARTICLE_STRUCT}
${WIND_EROSION_PARAMS}

@group(0) @binding(0) var<uniform> params: WindErosionParams;
@group(0) @binding(1) var<storage, read_write> particles: array<WindParticle>;
@group(0) @binding(2) var heightmap: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> sediment_delta: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> height_delta: array<atomic<i32>>;

const FIXED_SCALE: f32 = 10000.0;

fn getSurfaceNormal(pos: vec2<f32>) -> vec3<f32> {
    let x = i32(pos.x);
    let y = i32(pos.y);
    let size = i32(params.grid_size);
    
    // Sample neighboring heights
    let hL = textureLoad(heightmap, vec2<i32>(max(x-1, 0), y), 0).r;
    let hR = textureLoad(heightmap, vec2<i32>(min(x+1, size-1), y), 0).r;
    let hD = textureLoad(heightmap, vec2<i32>(x, max(y-1, 0)), 0).r;
    let hU = textureLoad(heightmap, vec2<i32>(x, min(y+1, size-1)), 0).r;
    
    // Compute normal from gradient
    let dx = (hR - hL) / (2.0 * params.grid_scale);
    let dz = (hU - hD) / (2.0 * params.grid_scale);
    
    return normalize(vec3<f32>(-dx, 1.0, -dz));
}

@compute @workgroup_size(64)
fn windErosionStep(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particle_count) {
        return;
    }
    
    var p = particles[idx];
    
    // Skip dead particles
    if (p.age >= params.max_lifetime || p.age < 0.0) {
        return;
    }
    
    let size = i32(params.grid_size);
    let dt = params.dt;
    
    // Current grid position
    let gridPos = vec2<i32>(i32(p.pos.x), i32(p.pos.y));
    
    // Bounds check
    if (gridPos.x < 0 || gridPos.x >= size || gridPos.y < 0 || gridPos.y >= size) {
        p.age = params.max_lifetime;  // Kill particle
        particles[idx] = p;
        return;
    }
    
    let ind = u32(gridPos.x * size + gridPos.y);
    
    // Sample terrain height
    let terrainHeight = textureLoad(heightmap, gridPos, 0).r;
    
    // Movement mechanics
    if (p.height > terrainHeight + 0.1) {
        // Flying - apply gravity
        p.velocity.y -= dt * params.gravity;
    } else {
        // Sliding on surface
        let n = getSurfaceNormal(p.pos);
        
        // Deflect velocity along surface: v += cross(cross(v, n), n)
        let deflect = cross(cross(p.velocity, n), n);
        p.velocity += dt * deflect;
        
        // Clamp to surface
        p.height = terrainHeight;
    }
    
    // Accelerate by prevailing wind
    let windVel = vec3<f32>(params.wind_speed_x, 0.0, params.wind_speed_z);
    p.velocity += params.wind_acceleration * dt * (windVel - p.velocity);
    
    // Update position
    p.pos += dt * vec2<f32>(p.velocity.x, p.velocity.z);
    p.height += dt * p.velocity.y;
    
    // New grid position
    let newGridPos = vec2<i32>(i32(p.pos.x), i32(p.pos.y));
    
    // Bounds check
    if (newGridPos.x < 0 || newGridPos.x >= size || newGridPos.y < 0 || newGridPos.y >= size) {
        p.age = params.max_lifetime;
        particles[idx] = p;
        return;
    }
    
    let nind = u32(newGridPos.x * size + newGridPos.y);
    let newTerrainHeight = textureLoad(heightmap, newGridPos, 0).r;
    
    // Mass transport when on surface
    if (p.height <= newTerrainHeight + 0.5) {
        let speed = length(p.velocity);
        let heightDiff = max(0.0, newTerrainHeight - p.height);
        let force = speed * heightDiff;
        
        if (force > 0.01) {
            // Abrasion - convert rock to sediment
            let abrasionAmount = i32(dt * params.abrasion_rate * force * p.sediment * FIXED_SCALE);
            if (abrasionAmount > 0) {
                atomicSub(&height_delta[nind], abrasionAmount);
                atomicAdd(&sediment_delta[nind], abrasionAmount);
            }
            
            // Suspension - pick up loose sediment
            let suspensionAmount = i32(dt * params.suspension_rate * force * FIXED_SCALE);
            atomicSub(&sediment_delta[nind], suspensionAmount);
            p.sediment += f32(suspensionAmount) / FIXED_SCALE;
        }
    } else {
        // Flying - deposit sediment exponentially
        let depositAmount = dt * params.deposition_rate * p.sediment;
        p.sediment -= depositAmount;
        
        // Add to sediment map at current position
        let depositFixed = i32(depositAmount * FIXED_SCALE);
        atomicAdd(&sediment_delta[nind], depositFixed);
    }
    
    // Speed check - kill slow particles
    if (length(p.velocity) < 0.01) {
        p.age = params.max_lifetime;
    }
    
    p.age += dt;
    particles[idx] = p;
}
`;

const CASCADE_SHADER = /* wgsl */ `
${WIND_EROSION_PARAMS}

@group(0) @binding(0) var<uniform> params: WindErosionParams;
@group(0) @binding(1) var<storage, read> height: array<f32>;
@group(0) @binding(2) var<storage, read_write> sediment: array<f32>;

// 8-way neighbor offsets
const nx = array<i32, 8>(-1, -1, -1, 0, 0, 1, 1, 1);
const ny = array<i32, 8>(-1, 0, 1, -1, 1, -1, 0, 1);

@compute @workgroup_size(8, 8)
fn cascade(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let size = i32(params.grid_size);
    
    if (x < 0 || x >= size || y < 0 || y >= size) {
        return;
    }
    
    let i = u32(x * size + y);
    let totalHeight = height[i] + sediment[i];
    
    // Check all 8 neighbors
    for (var m: u32 = 0u; m < 8u; m++) {
        let nnx = x + nx[m];
        let nny = y + ny[m];
        
        // Bounds check
        if (nnx < 0 || nnx >= size || nny < 0 || nny >= size) {
            continue;
        }
        
        let n = u32(nnx * size + nny);
        let neighborHeight = height[n] + sediment[n];
        
        // Height difference
        let diff = totalHeight - neighborHeight;
        let excess = abs(diff) - params.roughness;
        
        // Skip stable configurations
        if (excess <= 0.0) {
            continue;
        }
        
        // Transfer sediment to equalize
        var transfer: f32;
        if (diff > 0.0) {
            transfer = min(sediment[i], excess * 0.5);
            sediment[i] -= params.settling_rate * params.dt * transfer;
            sediment[n] += params.settling_rate * params.dt * transfer;
        }
    }
}
`;

const APPLY_DELTAS_SHADER = /* wgsl */ `
${WIND_EROSION_PARAMS}

@group(0) @binding(0) var<uniform> params: WindErosionParams;
@group(0) @binding(1) var<storage, read_write> height: array<f32>;
@group(0) @binding(2) var<storage, read_write> sediment: array<f32>;
@group(0) @binding(3) var<storage, read_write> height_delta: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> sediment_delta: array<atomic<i32>>;

const FIXED_SCALE: f32 = 10000.0;

@compute @workgroup_size(64)
fn applyDeltas(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    let size = params.grid_size * params.grid_size;
    
    if (idx >= size) {
        return;
    }
    
    // Apply accumulated deltas
    let hDelta = f32(atomicExchange(&height_delta[idx], 0)) / FIXED_SCALE;
    let sDelta = f32(atomicExchange(&sediment_delta[idx], 0)) / FIXED_SCALE;
    
    height[idx] += hDelta;
    sediment[idx] = max(0.0, sediment[idx] + sDelta);
}
`;

// ============================================================================
// MAIN CLASS
// ============================================================================

export class WindErosion {
    constructor(config = {}) {
        this.config = {
            gridSize: config.gridSize || 256,
            gridScale: config.gridScale || 1.0,
            particleCount: config.particleCount || 4096,
            maxLifetime: config.maxLifetime || 100.0,
            gravity: config.gravity || 0.01,
            windSpeed: config.windSpeed || [0.1, 0.0],
            windAcceleration: config.windAcceleration || 0.1,
            abrasionRate: config.abrasionRate || 0.01,
            suspensionRate: config.suspensionRate || 0.02,
            depositionRate: config.depositionRate || 0.01,
            roughness: config.roughness || 0.5,  // Talus angle equivalent
            settlingRate: config.settlingRate || 0.5,
            dt: config.dt || 1.0,
        };
        
        this.device = null;
        this.initialized = false;
        this.stepCount = 0;
        
        // Buffers
        this.paramsBuffer = null;
        this.particleBuffer = null;
        this.heightBuffer = null;
        this.sedimentBuffer = null;
        this.heightDeltaBuffer = null;
        this.sedimentDeltaBuffer = null;
        
        // Textures
        this.heightmapTexture = null;
        
        // Pipelines
        this.spawnPipeline = null;
        this.erosionPipeline = null;
        this.cascadePipeline = null;
        this.applyDeltasPipeline = null;
    }
    
    async init(device, heightmapTexture) {
        this.device = device;
        this.heightmapTexture = heightmapTexture;
        
        const cfg = this.config;
        const gridSize = cfg.gridSize * cfg.gridSize;
        
        // Create params buffer
        this.paramsBuffer = device.createBuffer({
            label: 'Wind Erosion Params',
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Create particle buffer
        this.particleBuffer = device.createBuffer({
            label: 'Wind Particles',
            size: MAX_WIND_PARTICLES * PARTICLE_STRIDE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Height and sediment buffers
        this.heightBuffer = device.createBuffer({
            label: 'Wind Erosion Height',
            size: gridSize * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        this.sedimentBuffer = device.createBuffer({
            label: 'Wind Erosion Sediment',
            size: gridSize * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        // Delta buffers (atomic)
        this.heightDeltaBuffer = device.createBuffer({
            label: 'Height Delta',
            size: gridSize * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.sedimentDeltaBuffer = device.createBuffer({
            label: 'Sediment Delta',
            size: gridSize * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Initialize particles as dead (age = maxLifetime)
        this._initializeParticles();
        
        // Initialize deltas to zero
        this._clearDeltas();
        
        // Update params
        this._updateParams();
        
        // Create pipelines
        await this._createPipelines();
        
        this.initialized = true;
        console.log(`[WindErosion] Initialized with ${cfg.particleCount} particles on ${cfg.gridSize}×${cfg.gridSize} grid`);
    }
    
    _initializeParticles() {
        const data = new Float32Array(MAX_WIND_PARTICLES * 8);
        // Set all particles as dead
        for (let i = 0; i < MAX_WIND_PARTICLES; i++) {
            data[i * 8 + 7] = this.config.maxLifetime + 1;  // age > maxLifetime = dead
        }
        this.device.queue.writeBuffer(this.particleBuffer, 0, data);
    }
    
    _clearDeltas() {
        const size = this.config.gridSize * this.config.gridSize;
        const zeros = new Int32Array(size);
        this.device.queue.writeBuffer(this.heightDeltaBuffer, 0, zeros);
        this.device.queue.writeBuffer(this.sedimentDeltaBuffer, 0, zeros);
    }
    
    _updateParams() {
        const cfg = this.config;
        const data = new Float32Array([
            cfg.gridSize,
            cfg.gridScale,
            cfg.particleCount,
            cfg.maxLifetime,
            cfg.gravity,
            cfg.windSpeed[0],
            cfg.windSpeed[1],
            cfg.windAcceleration,
            cfg.abrasionRate,
            cfg.suspensionRate,
            cfg.depositionRate,
            cfg.roughness,
            cfg.settlingRate,
            cfg.dt,
            this.stepCount,  // seed
            0,  // padding
        ]);
        
        // Fix integer fields
        const view = new DataView(data.buffer);
        view.setUint32(0, cfg.gridSize, true);
        view.setUint32(8, cfg.particleCount, true);
        view.setUint32(56, this.stepCount, true);
        
        this.device.queue.writeBuffer(this.paramsBuffer, 0, data);
    }
    
    async _createPipelines() {
        // Spawn pipeline
        const spawnModule = this.device.createShaderModule({
            label: 'Spawn Wind Particles',
            code: SPAWN_WIND_PARTICLES,
        });
        this.spawnPipeline = this.device.createComputePipeline({
            label: 'Spawn Wind Pipeline',
            layout: 'auto',
            compute: { module: spawnModule, entryPoint: 'spawnParticles' },
        });
        
        // Erosion pipeline
        const erosionModule = this.device.createShaderModule({
            label: 'Wind Erosion Step',
            code: WIND_EROSION_STEP,
        });
        this.erosionPipeline = this.device.createComputePipeline({
            label: 'Wind Erosion Pipeline',
            layout: 'auto',
            compute: { module: erosionModule, entryPoint: 'windErosionStep' },
        });
        
        // Cascade pipeline
        const cascadeModule = this.device.createShaderModule({
            label: 'Wind Cascade',
            code: CASCADE_SHADER,
        });
        this.cascadePipeline = this.device.createComputePipeline({
            label: 'Cascade Pipeline',
            layout: 'auto',
            compute: { module: cascadeModule, entryPoint: 'cascade' },
        });
        
        // Apply deltas pipeline
        const applyModule = this.device.createShaderModule({
            label: 'Apply Deltas',
            code: APPLY_DELTAS_SHADER,
        });
        this.applyDeltasPipeline = this.device.createComputePipeline({
            label: 'Apply Deltas Pipeline',
            layout: 'auto',
            compute: { module: applyModule, entryPoint: 'applyDeltas' },
        });
    }
    
    /**
     * Set wind direction and speed
     */
    setWind(speed, angleRadians) {
        this.config.windSpeed = [
            Math.cos(angleRadians) * speed,
            Math.sin(angleRadians) * speed,
        ];
        this._updateParams();
    }
    
    /**
     * Run one erosion cycle
     * @param {GPUCommandEncoder} encoder 
     */
    step(encoder) {
        if (!this.initialized) return;
        
        this.stepCount++;
        this._updateParams();
        
        const cfg = this.config;
        const particleWorkgroups = Math.ceil(cfg.particleCount / 64);
        const gridWorkgroups = Math.ceil(cfg.gridSize / 8);
        const totalCells = cfg.gridSize * cfg.gridSize;
        
        // Create bind groups (recreate each step for updated params)
        const spawnBindGroup = this.device.createBindGroup({
            layout: this.spawnPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.particleBuffer } },
                { binding: 2, resource: this.heightmapTexture.createView() },
            ],
        });
        
        const erosionBindGroup = this.device.createBindGroup({
            layout: this.erosionPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.particleBuffer } },
                { binding: 2, resource: this.heightmapTexture.createView() },
                { binding: 3, resource: { buffer: this.sedimentDeltaBuffer } },
                { binding: 4, resource: { buffer: this.heightDeltaBuffer } },
            ],
        });
        
        const cascadeBindGroup = this.device.createBindGroup({
            layout: this.cascadePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.heightBuffer } },
                { binding: 2, resource: { buffer: this.sedimentBuffer } },
            ],
        });
        
        const applyBindGroup = this.device.createBindGroup({
            layout: this.applyDeltasPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.heightBuffer } },
                { binding: 2, resource: { buffer: this.sedimentBuffer } },
                { binding: 3, resource: { buffer: this.heightDeltaBuffer } },
                { binding: 4, resource: { buffer: this.sedimentDeltaBuffer } },
            ],
        });
        
        // Spawn new particles
        const spawnPass = encoder.beginComputePass({ label: 'Spawn Wind' });
        spawnPass.setPipeline(this.spawnPipeline);
        spawnPass.setBindGroup(0, spawnBindGroup);
        spawnPass.dispatchWorkgroups(particleWorkgroups);
        spawnPass.end();
        
        // Erosion step
        const erosionPass = encoder.beginComputePass({ label: 'Wind Erosion' });
        erosionPass.setPipeline(this.erosionPipeline);
        erosionPass.setBindGroup(0, erosionBindGroup);
        erosionPass.dispatchWorkgroups(particleWorkgroups);
        erosionPass.end();
        
        // Apply deltas
        const applyPass = encoder.beginComputePass({ label: 'Apply Deltas' });
        applyPass.setPipeline(this.applyDeltasPipeline);
        applyPass.setBindGroup(0, applyBindGroup);
        applyPass.dispatchWorkgroups(Math.ceil(totalCells / 64));
        applyPass.end();
        
        // Cascade sediment
        const cascadePass = encoder.beginComputePass({ label: 'Cascade' });
        cascadePass.setPipeline(this.cascadePipeline);
        cascadePass.setBindGroup(0, cascadeBindGroup);
        cascadePass.dispatchWorkgroups(gridWorkgroups, gridWorkgroups);
        cascadePass.end();
    }
    
    /**
     * Get sediment buffer for visualization
     */
    getSedimentBuffer() {
        return this.sedimentBuffer;
    }
    
    /**
     * Load config from object
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        if (cfg.wind_erosion_particles !== undefined) {
            this.config.particleCount = parseInt(cfg.wind_erosion_particles);
        }
        if (cfg.wind_abrasion !== undefined) {
            this.config.abrasionRate = parseFloat(cfg.wind_abrasion);
        }
        if (cfg.wind_suspension !== undefined) {
            this.config.suspensionRate = parseFloat(cfg.wind_suspension);
        }
        if (cfg.wind_deposition !== undefined) {
            this.config.depositionRate = parseFloat(cfg.wind_deposition);
        }
        if (cfg.wind_roughness !== undefined) {
            this.config.roughness = parseFloat(cfg.wind_roughness);
        }
    }
    
    destroy() {
        this.paramsBuffer?.destroy();
        this.particleBuffer?.destroy();
        this.heightBuffer?.destroy();
        this.sedimentBuffer?.destroy();
        this.heightDeltaBuffer?.destroy();
        this.sedimentDeltaBuffer?.destroy();
        this.initialized = false;
    }
}
