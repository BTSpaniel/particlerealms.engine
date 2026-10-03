// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { degreesToRadians } from '../../core/math/UnitMath.js';

/**
 * WindSimulation.js - GPU Lattice Boltzmann Method Wind Simulation
 * 
 * Implements wind flow simulation using D2Q9/D3Q19 LBM:
 * - Particle distribution function on lattice
 * - BGK collision operator
 * - Bounce-back boundary conditions for terrain
 * - Streaming step for propagation
 * 
 * Based on: Nick McDonald's LBM Wind Simulation
 * https://nickmcd.me/2022/10/01/procedural-wind-and-clouds-using-gpu-accelerated-lattice-boltzmann-method/
 * 
 * Key equations:
 * - f(x+c_i*dt, t+dt) = f(x,t) - (f - f_eq)/tau
 * - f_eq = w_i * rho * (1 + (c_i·u)/cs² + (c_i·u)²/(2*cs⁴) - u²/(2*cs²))
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const Q = 9;  // D2Q9 velocity set
const CS = 1.0 / Math.sqrt(3.0);  // Lattice speed of sound
const CS2 = CS * CS;
const CS4 = CS2 * CS2;

// D2Q9 velocity vectors
const C = [
    [0, 0],   // 0: rest
    [1, 0],   // 1: east
    [-1, 0],  // 2: west
    [0, 1],   // 3: north
    [0, -1],  // 4: south
    [1, 1],   // 5: NE
    [-1, 1],  // 6: NW
    [1, -1],  // 7: SE
    [-1, -1], // 8: SW
];

// Weights for D2Q9
const W = [
    4.0/9.0,  // rest
    1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0,  // cardinals
    1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0,  // diagonals
];

// Opposite directions for bounce-back
const CP = [0, 2, 1, 4, 3, 8, 7, 6, 5];

// ============================================================================
// SHADER SOURCES
// ============================================================================

const LBM_PARAMS = /* wgsl */ `
struct LBMParams {
    grid_size_x: u32,
    grid_size_y: u32,
    tau: f32,              // Relaxation time (viscosity)
    dt: f32,
    
    wind_speed_x: f32,     // Prevailing wind velocity
    wind_speed_y: f32,
    init_density: f32,
    force_strength: f32,
}
`;

const LBM_COMMON = /* wgsl */ `
${LBM_PARAMS}

// D2Q9 velocity set
const Q: u32 = 9u;
const CS2: f32 = 1.0 / 3.0;
const CS4: f32 = 1.0 / 9.0;

// Velocity vectors
const c = array<vec2<i32>, 9>(
    vec2<i32>(0, 0),
    vec2<i32>(1, 0),
    vec2<i32>(-1, 0),
    vec2<i32>(0, 1),
    vec2<i32>(0, -1),
    vec2<i32>(1, 1),
    vec2<i32>(-1, 1),
    vec2<i32>(1, -1),
    vec2<i32>(-1, -1)
);

// Weights
const w = array<f32, 9>(
    4.0/9.0,
    1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0,
    1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0
);

// Opposite directions for bounce-back
const cp = array<u32, 9>(0u, 2u, 1u, 4u, 3u, 8u, 7u, 6u, 5u);

// Compute equilibrium distribution
fn equilibrium(q: u32, rho: f32, v: vec2<f32>) -> f32 {
    let ci = vec2<f32>(f32(c[q].x), f32(c[q].y));
    let cu = dot(ci, v);
    let usq = dot(v, v);
    
    var eq = w[q] * rho;
    eq += w[q] * rho * cu / CS2;
    eq += w[q] * rho * cu * cu * 0.5 / CS4;
    eq -= w[q] * rho * usq * 0.5 / CS2;
    
    return eq;
}

// Get 1D index from 2D position
fn getIndex(x: u32, y: u32, params: LBMParams) -> u32 {
    return x * params.grid_size_y + y;
}
`;

const COLLISION_SHADER = /* wgsl */ `
${LBM_COMMON}

@group(0) @binding(0) var<uniform> params: LBMParams;
@group(0) @binding(1) var<storage, read> f: array<f32>;           // Distribution function
@group(0) @binding(2) var<storage, read_write> f_prop: array<f32>; // Post-collision
@group(0) @binding(3) var<storage, read_write> rho: array<f32>;    // Density field
@group(0) @binding(4) var<storage, read_write> velocity: array<vec2<f32>>; // Velocity field

@compute @workgroup_size(8, 8)
fn collision(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    
    if (x >= params.grid_size_x || y >= params.grid_size_y) {
        return;
    }
    
    let ind = getIndex(x, y, params);
    let size = params.grid_size_x * params.grid_size_y;
    
    // Compute macroscopic density
    var local_rho: f32 = 0.0;
    for (var q: u32 = 0u; q < Q; q++) {
        local_rho += f[q * size + ind];
    }
    
    // Compute macroscopic velocity
    var local_v = vec2<f32>(0.0);
    for (var q: u32 = 0u; q < Q; q++) {
        let ci = vec2<f32>(f32(c[q].x), f32(c[q].y));
        local_v += f[q * size + ind] * ci;
    }
    local_v = local_v / max(local_rho, 0.001);
    
    // Store macroscopic quantities
    rho[ind] = local_rho;
    velocity[ind] = local_v;
    
    // BGK collision: f_new = f - (f - f_eq) / tau
    let inv_tau = params.dt / params.tau;
    for (var q: u32 = 0u; q < Q; q++) {
        let f_eq = equilibrium(q, local_rho, local_v);
        f_prop[q * size + ind] = (1.0 - inv_tau) * f[q * size + ind] + inv_tau * f_eq;
    }
}
`;

const STREAMING_SHADER = /* wgsl */ `
${LBM_COMMON}

@group(0) @binding(0) var<uniform> params: LBMParams;
@group(0) @binding(1) var<storage, read> f_prop: array<f32>;    // Post-collision
@group(0) @binding(2) var<storage, read_write> f: array<f32>;   // Distribution (next step)
@group(0) @binding(3) var<storage, read> boundary: array<f32>;  // Boundary mask (1 = solid)

@compute @workgroup_size(8, 8)
fn streaming(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    
    if (x >= params.grid_size_x || y >= params.grid_size_y) {
        return;
    }
    
    let ind = getIndex(x, y, params);
    let size = params.grid_size_x * params.grid_size_y;
    
    // Stream each velocity direction
    for (var q: u32 = 0u; q < Q; q++) {
        // Target position (push scheme)
        let nx = i32(x) + c[q].x;
        let ny = i32(y) + c[q].y;
        
        // Boundary check
        if (nx < 0 || nx >= i32(params.grid_size_x) ||
            ny < 0 || ny >= i32(params.grid_size_y)) {
            continue;
        }
        
        let nind = u32(nx) * params.grid_size_y + u32(ny);
        
        // Bounce-back or push
        if (boundary[nind] > 0.5) {
            // Solid boundary: bounce back to opposite direction
            f[cp[q] * size + ind] = f_prop[q * size + ind];
        } else {
            // Normal streaming
            f[q * size + nind] = f_prop[q * size + ind];
        }
    }
}
`;

const FORCE_BOUNDARY_SHADER = /* wgsl */ `
${LBM_COMMON}

@group(0) @binding(0) var<uniform> params: LBMParams;
@group(0) @binding(1) var<storage, read_write> f: array<f32>;

@compute @workgroup_size(64)
fn forceBoundary(@builtin(global_invocation_id) gid: vec3<u32>) {
    let y = gid.x;
    
    if (y >= params.grid_size_y) {
        return;
    }
    
    let size = params.grid_size_x * params.grid_size_y;
    
    // Apply wind at left boundary (x = 0)
    let wind_v = vec2<f32>(params.wind_speed_x, params.wind_speed_y);
    let ind = getIndex(0u, y, params);
    
    for (var q: u32 = 0u; q < Q; q++) {
        f[q * size + ind] = equilibrium(q, params.init_density, wind_v);
    }
    
    // Open boundary at right (x = max)
    // Copy from neighbor
    let right_ind = getIndex(params.grid_size_x - 1u, y, params);
    let neighbor_ind = getIndex(params.grid_size_x - 2u, y, params);
    
    for (var q: u32 = 0u; q < Q; q++) {
        f[q * size + right_ind] = f[q * size + neighbor_ind];
    }
}
`;

// ============================================================================
// MAIN CLASS
// ============================================================================

export class WindSimulation {
    constructor(config = {}) {
        this.config = {
            gridSizeX: config.gridSizeX || 256,
            gridSizeY: config.gridSizeY || 256,
            tau: config.tau || 0.6,                // Relaxation time
            dt: config.dt || 1.0,
            windSpeed: config.windSpeed || [0.1, 0.0],
            initDensity: config.initDensity || 1.0,
            forceStrength: config.forceStrength || 0.01,
        };
        
        this.device = null;
        this.initialized = false;
        
        // Buffers
        this.paramsBuffer = null;
        this.fBuffer = null;
        this.fPropBuffer = null;
        this.rhoBuffer = null;
        this.velocityBuffer = null;
        this.boundaryBuffer = null;
        
        // Pipelines
        this.collisionPipeline = null;
        this.streamingPipeline = null;
        this.forceBoundaryPipeline = null;
        
        // Bind groups
        this.collisionBindGroup = null;
        this.streamingBindGroup = null;
        this.forceBindGroup = null;
    }
    
    async init(device, heightmapTexture = null) {
        this.device = device;
        const cfg = this.config;
        const size = cfg.gridSizeX * cfg.gridSizeY;
        
        // Create params buffer
        this.paramsBuffer = device.createBuffer({
            label: 'LBM Params',
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Distribution function buffers (Q * size floats)
        const fSize = Q * size * 4;
        this.fBuffer = device.createBuffer({
            label: 'Distribution F',
            size: fSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.fPropBuffer = device.createBuffer({
            label: 'Distribution F Prop',
            size: fSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Macroscopic quantity buffers
        this.rhoBuffer = device.createBuffer({
            label: 'Density',
            size: size * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.velocityBuffer = device.createBuffer({
            label: 'Velocity',
            size: size * 8,  // vec2<f32>
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        // Boundary buffer (terrain as solid)
        this.boundaryBuffer = device.createBuffer({
            label: 'Boundary',
            size: size * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Initialize distribution to equilibrium
        this._initializeDistribution();
        
        // Update params
        this._updateParams();
        
        // Create pipelines
        await this._createPipelines();
        
        this.initialized = true;
        console.log(`[WindSimulation] Initialized ${cfg.gridSizeX}×${cfg.gridSizeY} LBM grid`);
    }
    
    _initializeDistribution() {
        const cfg = this.config;
        const size = cfg.gridSizeX * cfg.gridSizeY;
        const data = new Float32Array(Q * size);
        
        // Initialize to equilibrium with initial wind
        const rho = cfg.initDensity;
        const v = cfg.windSpeed;
        
        for (let i = 0; i < size; i++) {
            for (let q = 0; q < Q; q++) {
                const ci = C[q];
                const cu = ci[0] * v[0] + ci[1] * v[1];
                const usq = v[0] * v[0] + v[1] * v[1];
                
                let eq = W[q] * rho;
                eq += W[q] * rho * cu / CS2;
                eq += W[q] * rho * cu * cu * 0.5 / CS4;
                eq -= W[q] * rho * usq * 0.5 / CS2;
                
                data[q * size + i] = eq;
            }
        }
        
        this.device.queue.writeBuffer(this.fBuffer, 0, data);
        this.device.queue.writeBuffer(this.fPropBuffer, 0, data);
    }
    
    _updateParams() {
        const cfg = this.config;
        const data = new Float32Array([
            cfg.gridSizeX,
            cfg.gridSizeY,
            cfg.tau,
            cfg.dt,
            cfg.windSpeed[0],
            cfg.windSpeed[1],
            cfg.initDensity,
            cfg.forceStrength,
        ]);
        
        // Fix integer fields
        const view = new DataView(data.buffer);
        view.setUint32(0, cfg.gridSizeX, true);
        view.setUint32(4, cfg.gridSizeY, true);
        
        this.device.queue.writeBuffer(this.paramsBuffer, 0, data);
    }
    
    async _createPipelines() {
        // Collision pipeline
        const collisionModule = this.device.createShaderModule({
            label: 'LBM Collision',
            code: COLLISION_SHADER,
        });
        this.collisionPipeline = this.device.createComputePipeline({
            label: 'LBM Collision Pipeline',
            layout: 'auto',
            compute: { module: collisionModule, entryPoint: 'collision' },
        });
        
        // Streaming pipeline
        const streamingModule = this.device.createShaderModule({
            label: 'LBM Streaming',
            code: STREAMING_SHADER,
        });
        this.streamingPipeline = this.device.createComputePipeline({
            label: 'LBM Streaming Pipeline',
            layout: 'auto',
            compute: { module: streamingModule, entryPoint: 'streaming' },
        });
        
        // Force boundary pipeline
        const forceModule = this.device.createShaderModule({
            label: 'LBM Force Boundary',
            code: FORCE_BOUNDARY_SHADER,
        });
        this.forceBoundaryPipeline = this.device.createComputePipeline({
            label: 'LBM Force Pipeline',
            layout: 'auto',
            compute: { module: forceModule, entryPoint: 'forceBoundary' },
        });
        
        // Create bind groups
        this._createBindGroups();
    }
    
    _createBindGroups() {
        // Collision bind group
        this.collisionBindGroup = this.device.createBindGroup({
            label: 'Collision Bind Group',
            layout: this.collisionPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.fBuffer } },
                { binding: 2, resource: { buffer: this.fPropBuffer } },
                { binding: 3, resource: { buffer: this.rhoBuffer } },
                { binding: 4, resource: { buffer: this.velocityBuffer } },
            ],
        });
        
        // Streaming bind group
        this.streamingBindGroup = this.device.createBindGroup({
            label: 'Streaming Bind Group',
            layout: this.streamingPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.fPropBuffer } },
                { binding: 2, resource: { buffer: this.fBuffer } },
                { binding: 3, resource: { buffer: this.boundaryBuffer } },
            ],
        });
        
        // Force boundary bind group
        this.forceBindGroup = this.device.createBindGroup({
            label: 'Force Bind Group',
            layout: this.forceBoundaryPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: this.fBuffer } },
            ],
        });
    }
    
    /**
     * Set terrain boundary from heightmap
     * @param {Float32Array} heightmap - 2D heightmap data
     * @param {number} threshold - Height above which is solid
     */
    setTerrainBoundary(heightmap, threshold = 0) {
        const cfg = this.config;
        const size = cfg.gridSizeX * cfg.gridSizeY;
        const boundary = new Float32Array(size);
        
        for (let i = 0; i < size; i++) {
            boundary[i] = heightmap[i] > threshold ? 1.0 : 0.0;
        }
        
        this.device.queue.writeBuffer(this.boundaryBuffer, 0, boundary);
    }
    
    /**
     * Set wind direction and speed
     * @param {number} speed - Wind speed
     * @param {number} angle - Wind direction in radians
     */
    setWind(speed, angle) {
        this.config.windSpeed = [
            Math.cos(angle) * speed,
            Math.sin(angle) * speed,
        ];
        this._updateParams();
    }
    
    /**
     * Run one LBM simulation step
     * @param {GPUCommandEncoder} encoder 
     */
    step(encoder) {
        if (!this.initialized) return;
        
        const cfg = this.config;
        const workgroupsX = Math.ceil(cfg.gridSizeX / 8);
        const workgroupsY = Math.ceil(cfg.gridSizeY / 8);
        
        // Collision step
        const collisionPass = encoder.beginComputePass({ label: 'LBM Collision' });
        collisionPass.setPipeline(this.collisionPipeline);
        collisionPass.setBindGroup(0, this.collisionBindGroup);
        collisionPass.dispatchWorkgroups(workgroupsX, workgroupsY);
        collisionPass.end();
        
        // Streaming step
        const streamingPass = encoder.beginComputePass({ label: 'LBM Streaming' });
        streamingPass.setPipeline(this.streamingPipeline);
        streamingPass.setBindGroup(0, this.streamingBindGroup);
        streamingPass.dispatchWorkgroups(workgroupsX, workgroupsY);
        streamingPass.end();
        
        // Force boundary conditions
        const forcePass = encoder.beginComputePass({ label: 'LBM Force' });
        forcePass.setPipeline(this.forceBoundaryPipeline);
        forcePass.setBindGroup(0, this.forceBindGroup);
        forcePass.dispatchWorkgroups(Math.ceil(cfg.gridSizeY / 64));
        forcePass.end();
    }
    
    /**
     * Get velocity buffer for wind erosion
     */
    getVelocityBuffer() {
        return this.velocityBuffer;
    }
    
    /**
     * Get density buffer
     */
    getDensityBuffer() {
        return this.rhoBuffer;
    }
    
    /**
     * Load config from object
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        if (cfg.wind_grid_size !== undefined) {
            this.config.gridSizeX = parseInt(cfg.wind_grid_size);
            this.config.gridSizeY = parseInt(cfg.wind_grid_size);
        }
        if (cfg.wind_tau !== undefined) this.config.tau = parseFloat(cfg.wind_tau);
        if (cfg.wind_speed !== undefined) {
            const speed = parseFloat(cfg.wind_speed);
            const angle = degreesToRadians(parseFloat(cfg.wind_angle || 0));
            this.config.windSpeed = [Math.cos(angle) * speed, Math.sin(angle) * speed];
        }
        if (cfg.wind_angle !== undefined) {
            const angle = degreesToRadians(parseFloat(cfg.wind_angle));
            const speed = Math.sqrt(
                this.config.windSpeed[0] ** 2 + 
                this.config.windSpeed[1] ** 2
            ) || 0.1;
            this.config.windSpeed = [Math.cos(angle) * speed, Math.sin(angle) * speed];
        }
    }
    
    destroy() {
        this.paramsBuffer?.destroy();
        this.fBuffer?.destroy();
        this.fPropBuffer?.destroy();
        this.rhoBuffer?.destroy();
        this.velocityBuffer?.destroy();
        this.boundaryBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// PROCEDURAL WEATHER PATTERNS
// Based on: Nick McDonald's Procedural Weather
// https://nickmcd.me/2018/07/10/procedural-weather-patterns/
// ============================================================================

/**
 * Procedural Weather System - Grid-based weather simulation
 * 
 * Simulates coupled ODE system for:
 * - Temperature (fed by sunshine, decreased by rain/altitude)
 * - Humidity (fed by water evaporation, lost to rain)
 * - Clouds (appear above temp/humidity thresholds)
 * - Precipitation (impulsive rain from cooling humid air)
 * - Wind (convects temperature and humidity)
 */
export class ProceduralWeather {
    constructor(config = {}) {
        this.config = {
            gridSize: config.gridSize || 64,
            cellScale: config.cellScale || 100,  // World units per cell
            
            // Wind
            globalWindSpeed: config.globalWindSpeed || 0.5,
            globalWindAngle: config.globalWindAngle || 0,  // Radians
            windVariation: config.windVariation || 0.3,
            
            // Temperature
            baseTemperature: config.baseTemperature || 20,
            sunStrength: config.sunStrength || 0.5,
            altitudeCooling: config.altitudeCooling || 0.1,
            
            // Humidity
            evaporationRate: config.evaporationRate || 0.02,
            rainThreshold: config.rainThreshold || 0.7,
            
            // Clouds
            cloudTempThreshold: config.cloudTempThreshold || 15,
            cloudHumidityThreshold: config.cloudHumidityThreshold || 0.6,
            
            // Diffusion
            diffusionRate: config.diffusionRate || 0.1,
            
            ...config,
        };
        
        this.time = 0;
        this.dayOfYear = 0;
        
        // Weather grids
        this.temperature = null;    // Temperature field
        this.humidity = null;       // Humidity field  
        this.clouds = null;         // Cloud coverage (boolean-ish)
        this.precipitation = null;  // Rain/snow
        this.windSpeed = null;      // Local wind speed
        this.windAngle = null;      // Local wind direction
        
        this.initialized = false;
    }
    
    /**
     * Initialize weather grids
     * @param {Float32Array} heightmap - Terrain heightmap
     * @param {Float32Array} watermap - Water body mask (1 = water)
     */
    init(heightmap, watermap = null) {
        const size = this.config.gridSize;
        const count = size * size;
        
        this.heightmap = heightmap || new Float32Array(count);
        this.watermap = watermap || new Float32Array(count);
        
        // Initialize grids
        this.temperature = new Float32Array(count).fill(this.config.baseTemperature);
        this.humidity = new Float32Array(count).fill(0.3);
        this.clouds = new Float32Array(count).fill(0);
        this.precipitation = new Float32Array(count).fill(0);
        this.windSpeed = new Float32Array(count).fill(this.config.globalWindSpeed);
        this.windAngle = new Float32Array(count).fill(this.config.globalWindAngle);
        
        // Temporary buffers for convection
        this._tempNext = new Float32Array(count);
        this._humidNext = new Float32Array(count);
        
        this.initialized = true;
        console.log(`[ProceduralWeather] Initialized ${size}x${size} grid`);
    }
    
    /**
     * Step weather simulation
     * @param {number} dt - Time step (in-game hours)
     */
    step(dt = 1) {
        if (!this.initialized) return;
        
        this.time += dt;
        this.dayOfYear = (this.time / 24) % 365;
        
        const cfg = this.config;
        const size = cfg.gridSize;
        
        // Update global wind with time variation
        const windVar = Math.sin(this.time * 0.1) * cfg.windVariation;
        const globalWind = [
            Math.cos(cfg.globalWindAngle + windVar) * cfg.globalWindSpeed,
            Math.sin(cfg.globalWindAngle + windVar) * cfg.globalWindSpeed,
        ];
        
        // Step 1: Generate local wind from terrain
        this._updateWindField(globalWind);
        
        // Step 2: Convect temperature and humidity
        this._convect(this.temperature, this._tempNext);
        this._convect(this.humidity, this._humidNext);
        
        // Swap buffers
        [this.temperature, this._tempNext] = [this._tempNext, this.temperature];
        [this.humidity, this._humidNext] = [this._humidNext, this.humidity];
        
        // Step 3: Diffuse (smooth) fields
        this._diffuse(this.temperature);
        this._diffuse(this.humidity);
        
        // Step 4: Update temperature and humidity sources/sinks
        for (let i = 0; i < size * size; i++) {
            const height = this.heightmap[i];
            const isWater = this.watermap[i] > 0.5;
            const hasCloud = this.clouds[i] > 0.5;
            const isRaining = this.precipitation[i] > 0.5;
            
            // Temperature: sunshine where no clouds, cooling at altitude
            if (!hasCloud) {
                this.temperature[i] += cfg.sunStrength * dt;
            }
            this.temperature[i] -= height * cfg.altitudeCooling * dt;
            if (isRaining) {
                this.temperature[i] -= 2 * dt;
            }
            this.temperature[i] = Math.max(-40, Math.min(50, this.temperature[i]));
            
            // Humidity: evaporation from water, lost to rain
            if (isWater) {
                const evap = cfg.evaporationRate * (this.temperature[i] / 30) * dt;
                this.humidity[i] += evap;
            }
            if (isRaining) {
                this.humidity[i] -= 0.1 * dt;
            }
            this.humidity[i] = Math.max(0, Math.min(1, this.humidity[i]));
            
            // Clouds: form when humid air cools
            const cloudCondition = this.humidity[i] > cfg.cloudHumidityThreshold &&
                                   this.temperature[i] < cfg.cloudTempThreshold;
            this.clouds[i] = cloudCondition ? 1 : this.clouds[i] * 0.9;
            
            // Precipitation: rain when clouds + high humidity
            const rainCondition = this.clouds[i] > 0.5 && 
                                  this.humidity[i] > cfg.rainThreshold;
            this.precipitation[i] = rainCondition ? 1 : this.precipitation[i] * 0.8;
        }
    }
    
    /**
     * Update wind field based on terrain
     */
    _updateWindField(globalWind) {
        const size = this.config.gridSize;
        
        for (let z = 1; z < size - 1; z++) {
            for (let x = 1; x < size - 1; x++) {
                const i = x + z * size;
                
                // Gradient of heightmap
                const dhdx = (this.heightmap[i + 1] - this.heightmap[i - 1]) / 2;
                const dhdz = (this.heightmap[i + size] - this.heightmap[i - size]) / 2;
                
                // Wind speed increases going uphill (orographic lift)
                const dotProduct = globalWind[0] * dhdx + globalWind[1] * dhdz;
                const speedMod = 1 + dotProduct * 0.5;
                
                this.windSpeed[i] = this.config.globalWindSpeed * Math.max(0.1, speedMod);
                this.windAngle[i] = Math.atan2(globalWind[1], globalWind[0]);
            }
        }
    }
    
    /**
     * Convect field using wind
     */
    _convect(src, dst) {
        const size = this.config.gridSize;
        dst.fill(0);
        
        for (let z = 1; z < size - 1; z++) {
            for (let x = 1; x < size - 1; x++) {
                const i = x + z * size;
                
                // Wind vector
                const speed = this.windSpeed[i];
                const angle = this.windAngle[i];
                const wx = Math.cos(angle) * speed;
                const wz = Math.sin(angle) * speed;
                
                // Source position (backward trace)
                const sx = x - wx;
                const sz = z - wz;
                
                // Bilinear interpolation
                const x0 = Math.floor(sx), x1 = x0 + 1;
                const z0 = Math.floor(sz), z1 = z0 + 1;
                const fx = sx - x0, fz = sz - z0;
                
                if (x0 >= 0 && x1 < size && z0 >= 0 && z1 < size) {
                    dst[i] = 
                        src[x0 + z0 * size] * (1 - fx) * (1 - fz) +
                        src[x1 + z0 * size] * fx * (1 - fz) +
                        src[x0 + z1 * size] * (1 - fx) * fz +
                        src[x1 + z1 * size] * fx * fz;
                } else {
                    dst[i] = src[i];
                }
            }
        }
    }
    
    /**
     * Diffuse (smooth) field
     */
    _diffuse(field) {
        const size = this.config.gridSize;
        const rate = this.config.diffusionRate;
        
        for (let z = 1; z < size - 1; z++) {
            for (let x = 1; x < size - 1; x++) {
                const i = x + z * size;
                const avg = (
                    field[i - 1] + field[i + 1] +
                    field[i - size] + field[i + size]
                ) / 4;
                field[i] = field[i] * (1 - rate) + avg * rate;
            }
        }
    }
    
    /**
     * Sample weather at world position
     */
    sampleWeather(worldX, worldZ) {
        const size = this.config.gridSize;
        const scale = this.config.cellScale;
        
        const x = Math.floor(worldX / scale);
        const z = Math.floor(worldZ / scale);
        
        if (x < 0 || x >= size || z < 0 || z >= size) {
            return { temperature: 20, humidity: 0.5, clouds: 0, rain: 0, wind: [0, 0] };
        }
        
        const i = x + z * size;
        return {
            temperature: this.temperature[i],
            humidity: this.humidity[i],
            clouds: this.clouds[i],
            rain: this.precipitation[i],
            wind: [
                Math.cos(this.windAngle[i]) * this.windSpeed[i],
                Math.sin(this.windAngle[i]) * this.windSpeed[i],
            ],
        };
    }
    
    /**
     * Get average weather stats (for vegetation/biome generation)
     */
    getAverageStats() {
        const count = this.temperature.length;
        let avgTemp = 0, avgHumid = 0, avgRain = 0, avgSun = 0;
        
        for (let i = 0; i < count; i++) {
            avgTemp += this.temperature[i];
            avgHumid += this.humidity[i];
            avgRain += this.precipitation[i];
            avgSun += this.clouds[i] < 0.5 ? 1 : 0;
        }
        
        return {
            temperature: avgTemp / count,
            humidity: avgHumid / count,
            rainfall: avgRain / count,
            sunshine: avgSun / count,
        };
    }
    
    /**
     * Load config
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        if (cfg.weather_grid_size) this.config.gridSize = parseInt(cfg.weather_grid_size);
        if (cfg.weather_wind_speed) this.config.globalWindSpeed = parseFloat(cfg.weather_wind_speed);
        if (cfg.weather_evaporation) this.config.evaporationRate = parseFloat(cfg.weather_evaporation);
        if (cfg.weather_sun_strength) this.config.sunStrength = parseFloat(cfg.weather_sun_strength);
    }
}

// ============================================================================
// VOLUMETRIC CLOUDS
// GPU raymarched procedural clouds using 3D density + wind advection
// ============================================================================

/**
 * Volumetric Cloud Generator - Raymarched 3D density clouds
 * 
 * INTEGRATION:
 * - Uses GPU particles for cloud puffs/wisps
 * - Uses WindSimulation for cloud advection
 * - Uses SpatialHashCompute for LOD particle culling
 * 
 * Uses multi-octave noise for cloud density with:
 * - Wind advection from LBM simulation
 * - Rayleigh/Mie scattering for realistic lighting
 * - LOD based on ray distance
 */
export class VolumetricClouds {
    constructor(config = {}) {
        this.config = {
            resolution: config.resolution || 128,
            cloudHeight: config.cloudHeight || 200,
            cloudThickness: config.cloudThickness || 50,
            coverage: config.coverage || 0.5,
            density: config.density || 0.3,
            windSpeed: config.windSpeed || [0.01, 0, 0.005],
            lightAbsorption: config.lightAbsorption || 0.5,
            ambientLight: config.ambientLight || 0.3,
            sunColor: config.sunColor || [1.0, 0.95, 0.8],
            useParticles: config.useParticles !== false,  // Use GPU particles for wisps
            maxCloudParticles: config.maxCloudParticles || 10000,
            ...config,
        };
        
        this.device = null;
        this.initialized = false;
        this.time = 0;
        
        // External system references
        this.windSimulation = null;   // WindSimulation for advection
        this.sharedParticleSystem = null;  // game.worldParticles
        this.spatialHash = null;      // SpatialHashCompute for culling
        
        // GPU particle buffer for cloud wisps
        this.cloudParticleBuffer = null;
        this.cloudParticleCount = 0;
    }
    
    /**
     * Connect to wind simulation and particle system
     * @param {Object} options - {windSimulation, particleSystem, spatialHash}
     */
    setParticleSystem(options) {
        if (options.windSimulation) this.windSimulation = options.windSimulation;
        if (options.particleSystem) this.sharedParticleSystem = options.particleSystem;
        if (options.spatialHash) this.spatialHash = options.spatialHash;
    }
    
    async init(device) {
        this.device = device;
        const res = this.config.resolution;
        
        // 3D cloud density texture
        this.cloudTexture = device.createTexture({
            label: 'Cloud Density 3D',
            size: [res, res / 4, res],  // Wider than tall
            dimension: '3d',
            format: 'r16float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        
        // Params buffer
        this.paramsBuffer = device.createBuffer({
            label: 'Cloud Params',
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.initialized = true;
        console.log(`[VolumetricClouds] Initialized ${res}³`);
    }
    
    /**
     * CPU noise for cloud density (can be moved to GPU)
     */
    _noise3D(x, y, z) {
        const hash = (a, b, c) => {
            let n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
            return n - Math.floor(n);
        };
        
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        const fx = x - ix, fy = y - iy, fz = z - iz;
        const ux = fx * fx * (3 - 2 * fx);
        const uy = fy * fy * (3 - 2 * fy);
        const uz = fz * fz * (3 - 2 * fz);
        
        const lerp = (a, b, t) => a + t * (b - a);
        
        return lerp(
            lerp(
                lerp(hash(ix, iy, iz), hash(ix+1, iy, iz), ux),
                lerp(hash(ix, iy+1, iz), hash(ix+1, iy+1, iz), ux),
                uy
            ),
            lerp(
                lerp(hash(ix, iy, iz+1), hash(ix+1, iy, iz+1), ux),
                lerp(hash(ix, iy+1, iz+1), hash(ix+1, iy+1, iz+1), ux),
                uy
            ),
            uz
        );
    }
    
    /**
     * Generate cloud density field
     * @param {number} time - Current time for animation
     */
    generateClouds(time) {
        if (!this.initialized) return;
        
        this.time = time;
        const cfg = this.config;
        const res = cfg.resolution;
        const resY = Math.floor(res / 4);
        
        // Generate 3D noise field
        const data = new Float32Array(res * resY * res);
        const wind = cfg.windSpeed;
        
        for (let z = 0; z < res; z++) {
            for (let y = 0; y < resY; y++) {
                for (let x = 0; x < res; x++) {
                    // World-space with wind offset
                    const wx = x / res + wind[0] * time;
                    const wy = y / resY;
                    const wz = z / res + wind[2] * time;
                    
                    // Multi-octave noise
                    let density = 0;
                    let amplitude = 1;
                    let freq = 1;
                    for (let o = 0; o < 5; o++) {
                        density += amplitude * this._noise3D(wx * freq * 4, wy * freq * 2, wz * freq * 4);
                        amplitude *= 0.5;
                        freq *= 2;
                    }
                    
                    // Apply coverage threshold
                    density = (density - (1 - cfg.coverage)) * cfg.density;
                    density = Math.max(0, density);
                    
                    // Height falloff (thinner at edges)
                    const heightFalloff = 1 - Math.abs(wy - 0.5) * 2;
                    density *= heightFalloff * heightFalloff;
                    
                    const idx = x + y * res + z * res * resY;
                    data[idx] = density;
                }
            }
        }
        
        // Upload to GPU (would need staging buffer in real impl)
        // For now, just store the data
        this.cloudData = data;
    }
    
    /**
     * Sample cloud density at world position
     * @param {number} x - World X
     * @param {number} y - World Y (height)
     * @param {number} z - World Z
     */
    sampleDensity(x, y, z) {
        const cfg = this.config;
        
        // Check if in cloud layer
        if (y < cfg.cloudHeight || y > cfg.cloudHeight + cfg.cloudThickness) {
            return 0;
        }
        
        // Normalize to cloud layer
        const ny = (y - cfg.cloudHeight) / cfg.cloudThickness;
        
        // Add wind offset
        const wind = cfg.windSpeed;
        const wx = x * 0.001 + wind[0] * this.time;
        const wz = z * 0.001 + wind[2] * this.time;
        
        // Sample noise
        let density = 0;
        let amplitude = 1;
        let freq = 1;
        for (let o = 0; o < 4; o++) {
            density += amplitude * this._noise3D(wx * freq, ny * freq * 0.5, wz * freq);
            amplitude *= 0.5;
            freq *= 2;
        }
        
        density = Math.max(0, (density - (1 - cfg.coverage)) * cfg.density);
        
        // Height falloff
        const heightFalloff = 1 - Math.abs(ny - 0.5) * 2;
        return density * heightFalloff * heightFalloff;
    }
    
    /**
     * Get cloud texture for rendering
     */
    getCloudTexture() {
        return this.cloudTexture;
    }
    
    /**
     * Load config
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        if (cfg.cloud_height !== undefined) this.config.cloudHeight = parseFloat(cfg.cloud_height);
        if (cfg.cloud_thickness !== undefined) this.config.cloudThickness = parseFloat(cfg.cloud_thickness);
        if (cfg.cloud_coverage !== undefined) this.config.coverage = parseFloat(cfg.cloud_coverage);
        if (cfg.cloud_density !== undefined) this.config.density = parseFloat(cfg.cloud_density);
    }
    
    destroy() {
        this.cloudTexture?.destroy();
        this.paramsBuffer?.destroy();
        this.initialized = false;
    }
}
