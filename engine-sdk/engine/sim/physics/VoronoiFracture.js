/**
 * VoronoiFracture.js - GPU-accelerated Voronoi Fracture System
 * 
 * Uses Jump Flooding Algorithm (JFA) to compute 3D Voronoi diagrams for
 * realistic mesh fracturing. Seeds are placed based on impact location
 * and fracture patterns.
 * 
 * Algorithm:
 * 1. Place seed points (impact-based or pattern-based)
 * 2. Run JFA to compute nearest seed for each voxel
 * 3. Extract cell boundaries as fracture planes
 * 4. Cut mesh along planes to create fragments
 */

import { BindGroupSignals } from "../../core/gpu/BindingSignals.js";
import { getGPUMemoryManager } from "../../core/memory/GPUMemoryManager.js";

// ============================================================================
// SHADER SOURCES
// ============================================================================

// Initialize JFA grid with seed points
const JFA_SEED_SHADER = /* wgsl */ `
const GRID_SIZE: u32 = 64u;  // 64³ grid for fracture volume
const GRID_SIZE_SQ: u32 = 4096u;
const GRID_VOLUME: u32 = 262144u;
const EMPTY_SEED: u32 = 0xFFFFFFFFu;

struct Params {
    seedCount: u32,
    gridScale: f32,  // World units per grid cell
    originX: f32,
    originY: f32,
    originZ: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

struct Seed {
    x: f32,
    y: f32,
    z: f32,
    id: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> seeds: array<Seed>;
@group(0) @binding(2) var<storage, read_write> grid: array<atomic<u32>>;  // Nearest seed ID per cell

fn worldToGrid(wx: f32, wy: f32, wz: f32) -> vec3<u32> {
    let gx = u32(clamp((wx - params.originX) / params.gridScale, 0.0, f32(GRID_SIZE - 1u)));
    let gy = u32(clamp((wy - params.originY) / params.gridScale, 0.0, f32(GRID_SIZE - 1u)));
    let gz = u32(clamp((wz - params.originZ) / params.gridScale, 0.0, f32(GRID_SIZE - 1u)));
    return vec3<u32>(gx, gy, gz);
}

fn gridToIndex(gx: u32, gy: u32, gz: u32) -> u32 {
    return gx + gy * GRID_SIZE + gz * GRID_SIZE_SQ;
}

@compute @workgroup_size(4, 4, 4)
fn clear(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_SIZE || gid.y >= GRID_SIZE || gid.z >= GRID_SIZE) {
        return;
    }
    let idx = gridToIndex(gid.x, gid.y, gid.z);
    atomicStore(&grid[idx], EMPTY_SEED);
}

@compute @workgroup_size(64)
fn plant(@builtin(global_invocation_id) gid: vec3<u32>) {
    let seedIdx = gid.x;
    if (seedIdx >= params.seedCount) {
        return;
    }
    
    let seed = seeds[seedIdx];
    let gridPos = worldToGrid(seed.x, seed.y, seed.z);
    let idx = gridToIndex(gridPos.x, gridPos.y, gridPos.z);
    
    // Plant seed (use atomicMin to handle collisions - lowest ID wins)
    atomicMin(&grid[idx], seed.id);
}
`;

// Jump Flooding Algorithm step
const JFA_STEP_SHADER = /* wgsl */ `
const GRID_SIZE: u32 = 64u;
const GRID_SIZE_SQ: u32 = 4096u;
const GRID_VOLUME: u32 = 262144u;
const EMPTY_SEED: u32 = 0xFFFFFFFFu;

struct Params {
    stepSize: i32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

struct SeedPos {
    x: f32,
    y: f32,
    z: f32,
    _pad: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> gridIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> gridOut: array<u32>;
@group(0) @binding(3) var<storage, read> seedPositions: array<SeedPos>;

fn gridToIndex(gx: u32, gy: u32, gz: u32) -> u32 {
    return gx + gy * GRID_SIZE + gz * GRID_SIZE_SQ;
}

fn distSq(ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32) -> f32 {
    let dx = ax - bx;
    let dy = ay - by;
    let dz = az - bz;
    return dx * dx + dy * dy + dz * dz;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_SIZE || gid.y >= GRID_SIZE || gid.z >= GRID_SIZE) {
        return;
    }
    
    let idx = gridToIndex(gid.x, gid.y, gid.z);
    let currentSeed = gridIn[idx];
    
    var bestSeed = currentSeed;
    var bestDistSq = 1e30;
    
    // Current cell position (center)
    let cx = f32(gid.x) + 0.5;
    let cy = f32(gid.y) + 0.5;
    let cz = f32(gid.z) + 0.5;
    
    // Get current best distance
    if (currentSeed != EMPTY_SEED) {
        let seedPos = seedPositions[currentSeed];
        bestDistSq = distSq(cx, cy, cz, seedPos.x, seedPos.y, seedPos.z);
        bestSeed = currentSeed;
    }
    
    // Check 26 neighbors at stepSize distance
    let step = params.stepSize;
    for (var dz: i32 = -1; dz <= 1; dz++) {
        for (var dy: i32 = -1; dy <= 1; dy++) {
            for (var dx: i32 = -1; dx <= 1; dx++) {
                if (dx == 0 && dy == 0 && dz == 0) {
                    continue;
                }
                
                let nx = i32(gid.x) + dx * step;
                let ny = i32(gid.y) + dy * step;
                let nz = i32(gid.z) + dz * step;
                
                // Bounds check
                if (nx < 0 || nx >= i32(GRID_SIZE) ||
                    ny < 0 || ny >= i32(GRID_SIZE) ||
                    nz < 0 || nz >= i32(GRID_SIZE)) {
                    continue;
                }
                
                let neighborIdx = gridToIndex(u32(nx), u32(ny), u32(nz));
                let neighborSeed = gridIn[neighborIdx];
                
                if (neighborSeed == EMPTY_SEED) {
                    continue;
                }
                
                let seedPos = seedPositions[neighborSeed];
                let d = distSq(cx, cy, cz, seedPos.x, seedPos.y, seedPos.z);
                
                if (d < bestDistSq) {
                    bestDistSq = d;
                    bestSeed = neighborSeed;
                }
            }
        }
    }
    
    gridOut[idx] = bestSeed;
}
`;

// Extract cell boundaries (find voxels where neighbors have different seeds)
const JFA_BOUNDARY_SHADER = /* wgsl */ `
const GRID_SIZE: u32 = 64u;
const GRID_SIZE_SQ: u32 = 4096u;
const EMPTY_SEED: u32 = 0xFFFFFFFFu;

struct BoundaryVoxel {
    x: u32,
    y: u32,
    z: u32,
    seedA: u32,
    seedB: u32,
    normalX: f32,
    normalY: f32,
    normalZ: f32,
}

@group(0) @binding(0) var<storage, read> grid: array<u32>;
@group(0) @binding(1) var<storage, read_write> boundaries: array<BoundaryVoxel>;
@group(0) @binding(2) var<storage, read_write> boundaryCount: atomic<u32>;

fn gridToIndex(gx: u32, gy: u32, gz: u32) -> u32 {
    return gx + gy * GRID_SIZE + gz * GRID_SIZE_SQ;
}

fn getSeed(gx: i32, gy: i32, gz: i32) -> u32 {
    if (gx < 0 || gx >= i32(GRID_SIZE) ||
        gy < 0 || gy >= i32(GRID_SIZE) ||
        gz < 0 || gz >= i32(GRID_SIZE)) {
        return EMPTY_SEED;
    }
    return grid[gridToIndex(u32(gx), u32(gy), u32(gz))];
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_SIZE || gid.y >= GRID_SIZE || gid.z >= GRID_SIZE) {
        return;
    }
    
    let mySeed = grid[gridToIndex(gid.x, gid.y, gid.z)];
    if (mySeed == EMPTY_SEED) {
        return;
    }
    
    let ix = i32(gid.x);
    let iy = i32(gid.y);
    let iz = i32(gid.z);
    
    // Check 6 face neighbors for different seeds
    let neighbors = array<vec3<i32>, 6>(
        vec3<i32>(1, 0, 0),
        vec3<i32>(-1, 0, 0),
        vec3<i32>(0, 1, 0),
        vec3<i32>(0, -1, 0),
        vec3<i32>(0, 0, 1),
        vec3<i32>(0, 0, -1),
    );
    
    for (var i = 0u; i < 6u; i++) {
        let n = neighbors[i];
        let neighborSeed = getSeed(ix + n.x, iy + n.y, iz + n.z);
        
        if (neighborSeed != EMPTY_SEED && neighborSeed != mySeed) {
            // This is a boundary voxel
            let boundaryIdx = atomicAdd(&boundaryCount, 1u);
            if (boundaryIdx < 65536u) {  // Max boundaries
                boundaries[boundaryIdx] = BoundaryVoxel(
                    gid.x, gid.y, gid.z,
                    mySeed, neighborSeed,
                    f32(n.x), f32(n.y), f32(n.z)
                );
            }
            return;  // Only record once per voxel
        }
    }
}
`;

// ============================================================================
// FRACTURE PATTERNS
// ============================================================================

/**
 * Seeded random for deterministic fracture patterns (multiplayer sync)
 */
function createSeededRng(seed) {
    let state = seed >>> 0;
    return function() {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Predefined fracture patterns for different impact types
 */
export const FRACTURE_PATTERNS = {
    // Radial burst from impact point
    RADIAL: {
        name: 'Radial',
        generateSeeds: (center, radius, count, seed = 12345) => {
            const rng = createSeededRng(seed);
            const seeds = [{ x: center[0], y: center[1], z: center[2], id: 0 }];
            for (let i = 1; i < count; i++) {
                const theta = rng() * Math.PI * 2;
                const phi = Math.acos(2 * rng() - 1);
                const r = radius * (0.3 + rng() * 0.7);
                seeds.push({
                    x: center[0] + r * Math.sin(phi) * Math.cos(theta),
                    y: center[1] + r * Math.sin(phi) * Math.sin(theta),
                    z: center[2] + r * Math.cos(phi),
                    id: i,
                });
            }
            return seeds;
        },
    },
    
    // Shatter with denser fragments near impact
    SHATTER: {
        name: 'Shatter',
        generateSeeds: (center, radius, count, seed = 12345) => {
            const rng = createSeededRng(seed);
            const seeds = [];
            for (let i = 0; i < count; i++) {
                // Bias toward center
                const bias = Math.pow(rng(), 0.5);
                const r = radius * bias;
                const theta = rng() * Math.PI * 2;
                const phi = Math.acos(2 * rng() - 1);
                seeds.push({
                    x: center[0] + r * Math.sin(phi) * Math.cos(theta),
                    y: center[1] + r * Math.sin(phi) * Math.sin(theta),
                    z: center[2] + r * Math.cos(phi),
                    id: i,
                });
            }
            return seeds;
        },
    },
    
    // Columnar fracture (like basalt)
    COLUMNAR: {
        name: 'Columnar',
        generateSeeds: (center, radius, count, seed = 12345) => {
            const rng = createSeededRng(seed);
            const seeds = [];
            const layers = Math.ceil(Math.sqrt(count));
            const perLayer = Math.ceil(count / layers);
            let id = 0;
            
            for (let layer = 0; layer < layers && id < count; layer++) {
                const y = center[1] - radius + (2 * radius * layer / (layers - 1 || 1));
                for (let i = 0; i < perLayer && id < count; i++) {
                    const angle = (i / perLayer) * Math.PI * 2 + (layer * 0.3);
                    const r = radius * 0.7 * (0.5 + rng() * 0.5);
                    seeds.push({
                        x: center[0] + r * Math.cos(angle),
                        y: y + (rng() - 0.5) * radius * 0.2,
                        z: center[2] + r * Math.sin(angle),
                        id: id++,
                    });
                }
            }
            return seeds;
        },
    },
    
    // Brick-like regular fracture
    BRICK: {
        name: 'Brick',
        generateSeeds: (center, radius, count) => {
            const seeds = [];
            const side = Math.ceil(Math.cbrt(count));
            const spacing = (2 * radius) / side;
            let id = 0;
            
            for (let z = 0; z < side && id < count; z++) {
                for (let y = 0; y < side && id < count; y++) {
                    for (let x = 0; x < side && id < count; x++) {
                        // Offset alternate rows
                        const offset = (y % 2) * spacing * 0.5;
                        seeds.push({
                            x: center[0] - radius + x * spacing + offset + spacing * 0.5,
                            y: center[1] - radius + y * spacing + spacing * 0.5,
                            z: center[2] - radius + z * spacing + spacing * 0.5,
                            id: id++,
                        });
                    }
                }
            }
            return seeds;
        },
    },
};

// ============================================================================
// VORONOI FRACTURE COMPUTE CLASS
// ============================================================================

export class VoronoiFracture {
    constructor() {
        this.device = null;
        
        // Pipelines
        this.clearPipeline = null;
        this.plantPipeline = null;
        this.jfaStepPipeline = null;
        this.boundaryPipeline = null;
        
        // Layouts
        this.seedLayout = null;
        this.jfaLayout = null;
        this.boundaryLayout = null;

        this.seedBindGroups = null;
        this.jfaBindGroups = null;
        this.boundaryBindGroups = null;
        
        // Buffers
        this.paramsBuffer = null;
        this.jfaParamsBuffer = null;
        this.seedBuffer = null;
        this.seedPosBuffer = null;
        this.gridBufferA = null;
        this.gridBufferB = null;
        this.boundaryBuffer = null;
        this.boundaryCountBuffer = null;
        this.boundaryReadback = null;
        this.countReadback = null;
        
        // Config
        this.gridSize = 64;
        this.maxSeeds = 256;
        this.maxBoundaries = 65536;
        
        this.initialized = false;
    }
    
    /**
     * Initialize the fracture system
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.device = device;
        
        // Create shader modules
        const seedModule = device.createShaderModule({
            label: 'JFA Seed Shader',
            code: JFA_SEED_SHADER,
        });
        
        const jfaModule = device.createShaderModule({
            label: 'JFA Step Shader',
            code: JFA_STEP_SHADER,
        });
        
        const boundaryModule = device.createShaderModule({
            label: 'JFA Boundary Shader',
            code: JFA_BOUNDARY_SHADER,
        });
        
        // Create bind group layouts
        this.seedLayout = device.createBindGroupLayout({
            label: 'Seed Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        this.jfaLayout = device.createBindGroupLayout({
            label: 'JFA Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });
        
        this.boundaryLayout = device.createBindGroupLayout({
            label: 'Boundary Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });

        const gpu = getGPUMemoryManager(device);
        const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

        this.seedBindGroups = new BindGroupSignals(
            device,
            this.seedLayout,
            [
                { name: 'params', binding: 0 },
                { name: 'seeds', binding: 1 },
                { name: 'grid', binding: 2 },
            ],
            { label: 'VoronoiFracture.seedBindGroup', maxEntries: 16, getBindGroup: externalGetBindGroup }
        );

        this.jfaBindGroups = new BindGroupSignals(
            device,
            this.jfaLayout,
            [
                { name: 'params', binding: 0 },
                { name: 'gridIn', binding: 1 },
                { name: 'gridOut', binding: 2 },
                { name: 'seedPositions', binding: 3 },
            ],
            { label: 'VoronoiFracture.jfaBindGroup', maxEntries: 32, getBindGroup: externalGetBindGroup }
        );

        this.boundaryBindGroups = new BindGroupSignals(
            device,
            this.boundaryLayout,
            [
                { name: 'grid', binding: 0 },
                { name: 'boundaries', binding: 1 },
                { name: 'boundaryCount', binding: 2 },
            ],
            { label: 'VoronoiFracture.boundaryBindGroup', maxEntries: 16, getBindGroup: externalGetBindGroup }
        );
        
        // Create pipelines
        this.clearPipeline = device.createComputePipeline({
            label: 'JFA Clear Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.seedLayout] }),
            compute: { module: seedModule, entryPoint: 'clear' },
        });
        
        this.plantPipeline = device.createComputePipeline({
            label: 'JFA Plant Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.seedLayout] }),
            compute: { module: seedModule, entryPoint: 'plant' },
        });
        
        this.jfaStepPipeline = device.createComputePipeline({
            label: 'JFA Step Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.jfaLayout] }),
            compute: { module: jfaModule, entryPoint: 'main' },
        });
        
        this.boundaryPipeline = device.createComputePipeline({
            label: 'JFA Boundary Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.boundaryLayout] }),
            compute: { module: boundaryModule, entryPoint: 'main' },
        });
        
        // Create buffers
        const gridVolume = this.gridSize ** 3;
        
        this.paramsBuffer = device.createBuffer({
            label: 'Seed Params',
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.jfaParamsBuffer = device.createBuffer({
            label: 'JFA Params',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.seedBuffer = device.createBuffer({
            label: 'Seeds',
            size: this.maxSeeds * 16,  // 16 bytes per seed
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.seedPosBuffer = device.createBuffer({
            label: 'Seed Positions',
            size: this.maxSeeds * 16,  // vec4 per seed
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.gridBufferA = device.createBuffer({
            label: 'Grid A',
            size: gridVolume * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.gridBufferB = device.createBuffer({
            label: 'Grid B',
            size: gridVolume * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.boundaryBuffer = device.createBuffer({
            label: 'Boundaries',
            size: this.maxBoundaries * 32,  // 32 bytes per boundary
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.boundaryCountBuffer = device.createBuffer({
            label: 'Boundary Count',
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        
        this.boundaryReadback = device.createBuffer({
            label: 'Boundary Readback',
            size: this.maxBoundaries * 32,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        this.countReadback = device.createBuffer({
            label: 'Count Readback',
            size: 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        this.initialized = true;
        console.log('[VoronoiFracture] Initialized');
    }
    
    /**
     * Compute Voronoi diagram for fracturing
     * @param {number[]} center - Impact center [x, y, z]
     * @param {number} radius - Fracture radius
     * @param {string} pattern - Fracture pattern name
     * @param {number} fragmentCount - Target number of fragments
     * @returns {Promise<{seeds: Array, boundaries: Array}>}
     */
    async computeFracture(center, radius, pattern = 'RADIAL', fragmentCount = 8) {
        if (!this.initialized) {
            console.warn('[VoronoiFracture] Not initialized');
            return { seeds: [], boundaries: [] };
        }
        
        const device = this.device;
        const patternDef = FRACTURE_PATTERNS[pattern] || FRACTURE_PATTERNS.RADIAL;
        
        // Generate seeds
        const seeds = patternDef.generateSeeds(center, radius, fragmentCount);
        const seedCount = Math.min(seeds.length, this.maxSeeds);
        
        // Upload seeds
        const seedData = new Float32Array(seedCount * 4);
        const seedPosData = new Float32Array(seedCount * 4);
        for (let i = 0; i < seedCount; i++) {
            const s = seeds[i];
            seedData[i * 4 + 0] = s.x;
            seedData[i * 4 + 1] = s.y;
            seedData[i * 4 + 2] = s.z;
            seedData[i * 4 + 3] = s.id;
            
            // Also store as grid-space positions for JFA
            const gridScale = (2 * radius) / this.gridSize;
            seedPosData[i * 4 + 0] = (s.x - (center[0] - radius)) / gridScale;
            seedPosData[i * 4 + 1] = (s.y - (center[1] - radius)) / gridScale;
            seedPosData[i * 4 + 2] = (s.z - (center[2] - radius)) / gridScale;
            seedPosData[i * 4 + 3] = 0;
        }
        device.queue.writeBuffer(this.seedBuffer, 0, seedData);
        device.queue.writeBuffer(this.seedPosBuffer, 0, seedPosData);
        
        // Upload params
        const gridScale = (2 * radius) / this.gridSize;
        const paramsData = new Float32Array([
            seedCount, gridScale,
            center[0] - radius, center[1] - radius, center[2] - radius,
            0, 0, 0,
        ]);
        const paramsView = new DataView(paramsData.buffer);
        paramsView.setUint32(0, seedCount, true);
        device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);
        
        // Reset boundary count
        device.queue.writeBuffer(this.boundaryCountBuffer, 0, new Uint32Array([0]));
        
        const commandEncoder = device.createCommandEncoder();
        
        // Step 1: Clear grid
        {
            const bindGroup = this.seedBindGroups.get({
                params: this.paramsBuffer,
                seeds: this.seedBuffer,
                grid: this.gridBufferA,
            }, 'VoronoiFracture.seedBindGroup');
            
            const pass = commandEncoder.beginComputePass();
            pass.setPipeline(this.clearPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(16, 16, 16);  // 64/4 = 16 with 4x4x4 workgroup
            pass.end();
        }
        
        // Step 2: Plant seeds
        {
            const bindGroup = this.seedBindGroups.get({
                params: this.paramsBuffer,
                seeds: this.seedBuffer,
                grid: this.gridBufferA,
            }, 'VoronoiFracture.seedBindGroup');
            
            const pass = commandEncoder.beginComputePass();
            pass.setPipeline(this.plantPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(seedCount / 64));
            pass.end();
        }
        
        device.queue.submit([commandEncoder.finish()]);
        
        // Step 3: JFA iterations (log2(gridSize) steps)
        let gridIn = this.gridBufferA;
        let gridOut = this.gridBufferB;
        
        for (let step = this.gridSize / 2; step >= 1; step = Math.floor(step / 2)) {
            const jfaParams = new Int32Array([step, 0, 0, 0]);
            device.queue.writeBuffer(this.jfaParamsBuffer, 0, jfaParams);
            
            const bindGroup = this.jfaBindGroups.get({
                params: this.jfaParamsBuffer,
                gridIn,
                gridOut,
                seedPositions: this.seedPosBuffer,
            }, 'VoronoiFracture.jfaBindGroup');
            
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.jfaStepPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(16, 16, 16);  // 64/4 = 16 with 4x4x4 workgroup
            pass.end();
            device.queue.submit([encoder.finish()]);
            
            // Swap buffers
            [gridIn, gridOut] = [gridOut, gridIn];
        }
        
        // Step 4: Extract boundaries
        {
            const bindGroup = this.boundaryBindGroups.get({
                grid: gridIn,
                boundaries: this.boundaryBuffer,
                boundaryCount: this.boundaryCountBuffer,
            }, 'VoronoiFracture.boundaryBindGroup');
            
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.boundaryPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(16, 16, 16);  // 64/4 = 16 with 4x4x4 workgroup
            pass.end();
            
            encoder.copyBufferToBuffer(this.boundaryCountBuffer, 0, this.countReadback, 0, 4);
            device.queue.submit([encoder.finish()]);
        }
        
        // Read back boundary count
        await this.countReadback.mapAsync(GPUMapMode.READ);
        const boundaryCount = new Uint32Array(this.countReadback.getMappedRange())[0];
        this.countReadback.unmap();
        
        // Read back boundaries
        const boundaries = [];
        if (boundaryCount > 0) {
            const readCount = Math.min(boundaryCount, this.maxBoundaries);
            const encoder = device.createCommandEncoder();
            encoder.copyBufferToBuffer(this.boundaryBuffer, 0, this.boundaryReadback, 0, readCount * 32);
            device.queue.submit([encoder.finish()]);
            
            await this.boundaryReadback.mapAsync(GPUMapMode.READ);
            const data = new Float32Array(this.boundaryReadback.getMappedRange());
            
            for (let i = 0; i < readCount; i++) {
                const offset = i * 8;
                // Convert grid coords to world coords
                boundaries.push({
                    x: center[0] - radius + data[offset + 0] * gridScale,
                    y: center[1] - radius + data[offset + 1] * gridScale,
                    z: center[2] - radius + data[offset + 2] * gridScale,
                    seedA: data[offset + 3],
                    seedB: data[offset + 4],
                    normalX: data[offset + 5],
                    normalY: data[offset + 6],
                    normalZ: data[offset + 7],
                });
            }
            
            this.boundaryReadback.unmap();
        }
        
        return { seeds, boundaries, boundaryCount };
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.paramsBuffer?.destroy();
        this.jfaParamsBuffer?.destroy();
        this.seedBuffer?.destroy();
        this.seedPosBuffer?.destroy();
        this.gridBufferA?.destroy();
        this.gridBufferB?.destroy();
        this.boundaryBuffer?.destroy();
        this.boundaryCountBuffer?.destroy();
        this.boundaryReadback?.destroy();
        this.countReadback?.destroy();
        this.initialized = false;
    }
}

export default VoronoiFracture;
