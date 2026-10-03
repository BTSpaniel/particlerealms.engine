// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { sampleTerrainHeightfield } from './TerrainHeightfield.js';

/**
 * TectonicSimulation.js - GPU Clustered Convection Plate Tectonics
 * 
 * Implements tectonic plate simulation using:
 * - Deformable point clouds representing crustal segments
 * - JFA (Jump Flooding Algorithm) for real-time Voronoi plate boundaries
 * - Mantle convection currents driving plate motion
 * - Subduction/collision for mountain building (orogeny)
 * 
 * Based on: Nick McDonald's Clustered Convection
 * 
 * Key equations:
 * - Force on segment: f_i = γ(u_mantle(p_i) - v_plate)
 * - Net force: F_net = Σ f_i
 * - Torque: τ_net = Σ (p_i - p_center) × f_i
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_SEGMENTS = 16384;  // Maximum crustal segments
const MAX_PLATES = 32;       // Maximum tectonic plates
const SEGMENT_STRIDE = 32;   // 8 x f32 per segment

// ============================================================================
// SHADER SOURCES
// ============================================================================

const SEGMENT_STRUCT = /* wgsl */ `
struct CrustalSegment {
    pos: vec2<f32>,        // World position (x, z)
    vel: vec2<f32>,        // Velocity
    elevation: f32,        // Surface height
    thickness: f32,        // Crustal thickness
    density: f32,          // 0=continental (light), 1=oceanic (dense)
    plate_id: u32,         // Which plate this belongs to
}

struct PlateData {
    center: vec2<f32>,     // Center of mass
    velocity: vec2<f32>,   // Linear velocity
    angular_vel: f32,      // Rotation rate
    mass: f32,             // Total mass
    segment_count: u32,    // Number of segments
    _pad: u32,
}
`;

const TECTONIC_PARAMS = /* wgsl */ `
struct TectonicParams {
    world_size: f32,           // World dimensions
    grid_resolution: u32,      // JFA grid size
    segment_count: u32,
    plate_count: u32,
    
    mantle_strength: f32,      // Convection force multiplier
    viscosity: f32,            // Drag coefficient
    rigidity: f32,             // Plate rigidity (clustering)
    collision_force: f32,
    
    subduction_rate: f32,      // How fast oceanic crust subducts
    orogeny_rate: f32,         // Mountain building rate
    spreading_rate: f32,       // New crust at divergent boundaries
    dt: f32,
}
`;

// JFA initialization - place segment IDs at their positions
const JFA_INIT_SHADER = /* wgsl */ `
${SEGMENT_STRUCT}
${TECTONIC_PARAMS}

@group(0) @binding(0) var<storage, read> segments: array<CrustalSegment>;
@group(0) @binding(1) var<uniform> params: TectonicParams;
@group(0) @binding(2) var jfa_texture: texture_storage_2d<rg32uint, write>;
@group(0) @binding(3) var<storage, read_write> seed_cells: array<atomic<u32>>;

fn worldToGrid(pos: vec2<f32>) -> vec2<i32> {
    let normalized = (pos / params.world_size + 0.5);
    return vec2<i32>(normalized * f32(params.grid_resolution));
}

@compute @workgroup_size(64)
fn jfa_init(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.segment_count) {
        return;
    }
    
    let seg = segments[idx];
    let gridPos = worldToGrid(seg.pos);
    
    // Only write if in bounds
    if (gridPos.x >= 0 && gridPos.x < i32(params.grid_resolution) &&
        gridPos.y >= 0 && gridPos.y < i32(params.grid_resolution)) {
        // Concurrent segments can occupy one cell. Choose the lowest segment
        // index deterministically, then resolve each cell in a separate pass.
        let cell = u32(gridPos.y) * params.grid_resolution + u32(gridPos.x);
        atomicMin(&seed_cells[cell], idx);
    }
}

// Clear JFA texture
@compute @workgroup_size(8, 8)
fn jfa_clear(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.grid_resolution || gid.y >= params.grid_resolution) {
        return;
    }
    // 0xFFFFFFFF = no segment
    textureStore(jfa_texture, vec2<i32>(gid.xy), vec4<u32>(0xFFFFFFFFu, 0xFFFFFFFFu, 0u, 0u));
    atomicStore(&seed_cells[gid.y * params.grid_resolution + gid.x], 0xFFFFFFFFu);
}

@compute @workgroup_size(8, 8)
fn jfa_resolve_seeds(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.grid_resolution || gid.y >= params.grid_resolution) { return; }
    let idx = atomicLoad(&seed_cells[gid.y * params.grid_resolution + gid.x]);
    var plate = 0xFFFFFFFFu;
    if (idx < params.segment_count) { plate = segments[idx].plate_id; }
    textureStore(jfa_texture, vec2<i32>(gid.xy), vec4<u32>(idx, plate, 0u, 0u));
}
`;

// JFA pass - flood nearest seed to neighbors
const JFA_PASS_SHADER = /* wgsl */ `
${SEGMENT_STRUCT}
${TECTONIC_PARAMS}

@group(0) @binding(0) var<storage, read> segments: array<CrustalSegment>;
@group(0) @binding(1) var<uniform> params: TectonicParams;
@group(0) @binding(2) var jfa_in: texture_2d<u32>;
@group(0) @binding(3) var jfa_out: texture_storage_2d<rg32uint, write>;
@group(0) @binding(4) var<uniform> step_size: u32;

fn gridToWorld(gpos: vec2<i32>) -> vec2<f32> {
    return (vec2<f32>(gpos) / f32(params.grid_resolution) - 0.5) * params.world_size;
}

@compute @workgroup_size(8, 8)
fn jfa_pass(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    
    if (gid.x >= params.grid_resolution || gid.y >= params.grid_resolution) {
        return;
    }
    
    let myPos = gridToWorld(vec2<i32>(x, y));
    var bestDist = 999999.0;
    var bestSeed = vec2<u32>(0xFFFFFFFFu, 0xFFFFFFFFu);
    
    let step = i32(step_size);
    
    // Check 3x3 neighborhood at step distance
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let nx = x + dx * step;
            let ny = y + dy * step;
            
            // Bounds check
            if (nx < 0 || nx >= i32(params.grid_resolution) ||
                ny < 0 || ny >= i32(params.grid_resolution)) {
                continue;
            }
            
            let neighbor = textureLoad(jfa_in, vec2<i32>(nx, ny), 0);
            let segIdx = neighbor.r;
            
            if (segIdx != 0xFFFFFFFFu) {
                // Valid seed - check distance
                let seedPos = segments[segIdx].pos;
                let d = distance(myPos, seedPos);
                
                if (d < bestDist) {
                    bestDist = d;
                    bestSeed = neighbor.rg;
                }
            }
        }
    }
    
    textureStore(jfa_out, vec2<i32>(x, y), vec4<u32>(bestSeed.x, bestSeed.y, 0u, 0u));
}
`;

// Simulate mantle convection and apply forces to segments
const CONVECTION_SHADER = /* wgsl */ `
${SEGMENT_STRUCT}
${TECTONIC_PARAMS}

@group(0) @binding(0) var<storage, read_write> segments: array<CrustalSegment>;
@group(0) @binding(1) var<storage, read_write> plates: array<PlateData>;
@group(0) @binding(2) var<uniform> params: TectonicParams;
@group(0) @binding(3) var<uniform> time: f32;

// Procedural mantle flow field
fn mantleVelocity(pos: vec2<f32>, t: f32) -> vec2<f32> {
    // Multiple convection cells using sine waves
    let scale1 = 0.01;
    let scale2 = 0.02;
    
    // Large convection cells
    var flow = vec2<f32>(
        sin(pos.y * scale1 + t * 0.1) * cos(pos.x * scale1 * 0.7),
        cos(pos.x * scale1 + t * 0.1) * sin(pos.y * scale1 * 0.7)
    );
    
    // Smaller turbulence
    flow += vec2<f32>(
        sin(pos.y * scale2 + pos.x * scale2 * 0.5 + t * 0.2),
        cos(pos.x * scale2 - pos.y * scale2 * 0.5 + t * 0.2)
    ) * 0.3;
    
    return flow * params.mantle_strength;
}

@compute @workgroup_size(64)
fn apply_convection(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.segment_count) {
        return;
    }
    
    var seg = segments[idx];
    let plateIdx = seg.plate_id;
    
    if (plateIdx >= params.plate_count) {
        return;
    }
    
    let plate = plates[plateIdx];
    
    // Get mantle flow at this position
    let mantleFlow = mantleVelocity(seg.pos, time);
    
    // Force = drag * (mantle_velocity - segment_velocity)
    let force = params.viscosity * (mantleFlow - seg.vel);
    
    // Clustering force toward plate center (rigidity)
    let toCenter = plate.center - seg.pos;
    let centerDist = length(toCenter);
    var clusterForce = vec2<f32>(0.0);
    if (centerDist > 1.0) {
        clusterForce = normalize(toCenter) * params.rigidity * min(centerDist * 0.1, 10.0);
    }
    
    // Update velocity
    seg.vel += (force + clusterForce) * params.dt;
    
    // Apply friction
    seg.vel *= 0.99;
    
    // Update position
    seg.pos += seg.vel * params.dt;
    
    // Wrap around world (torus topology)
    let halfSize = params.world_size * 0.5;
    if (seg.pos.x > halfSize) { seg.pos.x -= params.world_size; }
    if (seg.pos.x < -halfSize) { seg.pos.x += params.world_size; }
    if (seg.pos.y > halfSize) { seg.pos.y -= params.world_size; }
    if (seg.pos.y < -halfSize) { seg.pos.y += params.world_size; }
    
    segments[idx] = seg;
}
`;

// Updating a uniform with queue.writeBuffer while several steps are encoded in
// one command buffer makes every dispatch see the final CPU value. Advance the
// same scalar in command order, then read it as a uniform during convection.
const ADVANCE_TIME_SHADER = /* wgsl */ `
${TECTONIC_PARAMS}
@group(0) @binding(0) var<storage, read_write> simulation_time: f32;
@group(0) @binding(1) var<uniform> params: TectonicParams;
@compute @workgroup_size(1)
fn advance_time() { simulation_time += params.dt; }
`;

// Detect boundaries and handle collision/subduction
const BOUNDARY_SHADER = /* wgsl */ `
${SEGMENT_STRUCT}
${TECTONIC_PARAMS}

@group(0) @binding(0) var<storage, read_write> segments: array<CrustalSegment>;
@group(0) @binding(1) var<storage, read> plates: array<PlateData>;
@group(0) @binding(2) var<uniform> params: TectonicParams;
@group(0) @binding(3) var jfa_texture: texture_2d<u32>;
@group(0) @binding(4) var<storage, read> neighbor_segments: array<CrustalSegment>;

fn worldToGrid(pos: vec2<f32>) -> vec2<i32> {
    let normalized = (pos / params.world_size + 0.5);
    return vec2<i32>(normalized * f32(params.grid_resolution));
}

@compute @workgroup_size(64)
fn process_boundaries(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.segment_count) {
        return;
    }
    
    var seg = segments[idx];
    let gridPos = worldToGrid(seg.pos);
    
    // Check neighbors for different plate IDs
    var isBoundary = false;
    var neighborPlate = seg.plate_id;
    var neighborDensity = seg.density;
    
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) { continue; }
            
            let nx = gridPos.x + dx;
            let ny = gridPos.y + dy;
            
            if (nx < 0 || nx >= i32(params.grid_resolution) ||
                ny < 0 || ny >= i32(params.grid_resolution)) {
                continue;
            }
            
            let neighbor = textureLoad(jfa_texture, vec2<i32>(nx, ny), 0);
            let nPlateId = neighbor.g;
            
            if (nPlateId != seg.plate_id && nPlateId != 0xFFFFFFFFu) {
                isBoundary = true;
                neighborPlate = nPlateId;
                if (neighbor.r != 0xFFFFFFFFu) {
                    neighborDensity = neighbor_segments[neighbor.r].density;
                }
                break;
            }
        }
        if (isBoundary) { break; }
    }
    
    if (isBoundary && neighborPlate < params.plate_count) {
        let myPlate = plates[seg.plate_id];
        let otherPlate = plates[neighborPlate];
        
        // Calculate convergence rate
        let relVel = myPlate.velocity - otherPlate.velocity;
        let boundaryDelta = otherPlate.center - myPlate.center;
        let boundaryNormal = boundaryDelta / max(length(boundaryDelta), 0.00001);
        // Relative velocity toward the other center is a positive closing rate.
        let convergence = dot(relVel, boundaryNormal);
        
        if (convergence > 0.1) {
            // CONVERGING - collision or subduction
            if (seg.density > neighborDensity) {
                // This segment is denser (oceanic) - subduct
                seg.elevation -= params.subduction_rate * convergence * params.dt;
                seg.thickness -= params.subduction_rate * convergence * params.dt * 0.5;
            } else {
                // This segment is lighter (continental) - uplift (orogeny)
                seg.elevation += params.orogeny_rate * convergence * params.dt;
                seg.thickness += params.orogeny_rate * convergence * params.dt * 0.3;
            }
        } else if (convergence < -0.1) {
            // DIVERGING - create new oceanic crust
            seg.density = mix(seg.density, 1.0, params.spreading_rate * params.dt);
            seg.elevation = mix(seg.elevation, -50.0, params.spreading_rate * params.dt);
        }
    }
    
    // Clamp values
    seg.elevation = clamp(seg.elevation, -500.0, 500.0);
    seg.thickness = clamp(seg.thickness, 5.0, 100.0);
    
    segments[idx] = seg;
}
`;

// Calculate plate centers and aggregate data
const PLATE_AGGREGATE_SHADER = /* wgsl */ `
${SEGMENT_STRUCT}
${TECTONIC_PARAMS}

@group(0) @binding(0) var<storage, read> segments: array<CrustalSegment>;
@group(0) @binding(1) var<storage, read_write> plates: array<PlateData>;
@group(0) @binding(2) var<uniform> params: TectonicParams;
@group(0) @binding(3) var<storage, read_write> plate_sums: array<atomic<i32>>;

const FIXED_SCALE: f32 = 1000.0;

// Pass 1: Sum positions (using fixed-point atomics)
@compute @workgroup_size(64)
fn aggregate_positions(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.segment_count) {
        return;
    }
    
    let seg = segments[idx];
    let plateIdx = seg.plate_id;
    
    if (plateIdx >= params.plate_count) {
        return;
    }
    
    // Accumulate position (4 values per plate: sumX, sumZ, sumVelX, sumVelZ, count)
    let baseIdx = plateIdx * 5u;
    atomicAdd(&plate_sums[baseIdx], i32(seg.pos.x * FIXED_SCALE));
    atomicAdd(&plate_sums[baseIdx + 1u], i32(seg.pos.y * FIXED_SCALE));
    atomicAdd(&plate_sums[baseIdx + 2u], i32(seg.vel.x * FIXED_SCALE));
    atomicAdd(&plate_sums[baseIdx + 3u], i32(seg.vel.y * FIXED_SCALE));
    atomicAdd(&plate_sums[baseIdx + 4u], 1i);
}

// Pass 2: Finalize plate data
@compute @workgroup_size(32)
fn finalize_plates(@builtin(global_invocation_id) gid: vec3<u32>) {
    let plateIdx = gid.x;
    if (plateIdx >= params.plate_count) {
        return;
    }
    
    let baseIdx = plateIdx * 5u;
    let count = f32(atomicLoad(&plate_sums[baseIdx + 4u]));
    
    if (count > 0.0) {
        let sumX = f32(atomicLoad(&plate_sums[baseIdx])) / FIXED_SCALE;
        let sumZ = f32(atomicLoad(&plate_sums[baseIdx + 1u])) / FIXED_SCALE;
        let sumVelX = f32(atomicLoad(&plate_sums[baseIdx + 2u])) / FIXED_SCALE;
        let sumVelZ = f32(atomicLoad(&plate_sums[baseIdx + 3u])) / FIXED_SCALE;
        
        plates[plateIdx].center = vec2<f32>(sumX, sumZ) / count;
        plates[plateIdx].velocity = vec2<f32>(sumVelX, sumVelZ) / count;
        plates[plateIdx].segment_count = u32(count);
        plates[plateIdx].mass = count;  // Simplified mass = segment count
    }
    
    // Clear sums for next frame
    atomicStore(&plate_sums[baseIdx], 0i);
    atomicStore(&plate_sums[baseIdx + 1u], 0i);
    atomicStore(&plate_sums[baseIdx + 2u], 0i);
    atomicStore(&plate_sums[baseIdx + 3u], 0i);
    atomicStore(&plate_sums[baseIdx + 4u], 0i);
}
`;

// Bake elevation to heightmap
const BAKE_HEIGHTMAP_SHADER = /* wgsl */ `
${SEGMENT_STRUCT}
${TECTONIC_PARAMS}

@group(0) @binding(0) var<storage, read> segments: array<CrustalSegment>;
@group(0) @binding(1) var<uniform> params: TectonicParams;
@group(0) @binding(2) var jfa_texture: texture_2d<u32>;
@group(0) @binding(3) var heightmap_out: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn bake_heightmap(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.grid_resolution || gid.y >= params.grid_resolution) {
        return;
    }
    
    let jfa = textureLoad(jfa_texture, vec2<i32>(gid.xy), 0);
    let segIdx = jfa.r;
    
    var height = 0.0;
    if (segIdx != 0xFFFFFFFFu && segIdx < params.segment_count) {
        height = segments[segIdx].elevation;
    }
    
    textureStore(heightmap_out, vec2<i32>(gid.xy), vec4<f32>(height, 0.0, 0.0, 1.0));
}
`;

// ============================================================================
// JAVASCRIPT CLASS
// ============================================================================

/**
 * TectonicSimulation - GPU plate tectonics using clustered convection
 */
export class TectonicSimulation {
    constructor() {
        this.device = null;
        this.initialized = false;
        this.seeded = false;
        
        // Configuration
        this.config = {
            worldSize: 1000.0,
            gridResolution: 256,
            segmentCount: 8192,
            plateCount: 8,
            
            mantleStrength: 5.0,
            viscosity: 0.8,
            rigidity: 2.0,
            collisionForce: 1.0,
            
            subductionRate: 0.5,
            orogenyRate: 1.0,
            spreadingRate: 0.1,
            dt: 0.1,
        };
        
        // GPU resources
        this.segmentBuffer = null;
        this.neighborSegmentBuffer = null;
        this.seedCellsBuffer = null;
        this.plateBuffer = null;
        this.plateSumsBuffer = null;
        this.paramsBuffer = null;
        this.timeBuffer = null;
        this.stepSizeBuffer = null;
        this.jfaStepSizes = [];
        this.jfaStepBuffers = [];
        this.bindGroups = null;
        
        // JFA textures (ping-pong)
        this.jfaTextures = [null, null];
        this.currentJFA = 0;
        
        // Output
        this.heightmapTexture = null;
        
        // Pipelines
        this.jfaClearPipeline = null;
        this.jfaInitPipeline = null;
        this.jfaResolvePipeline = null;
        this.jfaPassPipeline = null;
        this.convectionPipeline = null;
        this.advanceTimePipeline = null;
        this.boundaryPipeline = null;
        this.aggregatePipeline = null;
        this.finalizePipeline = null;
        this.bakePipeline = null;
        
        this.time = 0;
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     */
    async init(device) {
        if (this.device) this.destroy();
        const config = this.config;
        if (!Number.isInteger(config.gridResolution) || config.gridResolution < 2 || config.gridResolution > device.limits.maxTextureDimension2D
            || !Number.isInteger(config.segmentCount) || config.segmentCount < 1 || config.segmentCount > MAX_SEGMENTS
            || !Number.isInteger(config.plateCount) || config.plateCount < 1 || config.plateCount > MAX_PLATES
            || !Number.isFinite(config.worldSize) || config.worldSize <= 0) {
            throw new RangeError('Tectonic dimensions and plate/segment counts exceed the supported bounds.');
        }
        for (const name of ['mantleStrength', 'viscosity', 'rigidity', 'collisionForce', 'subductionRate', 'orogenyRate', 'spreadingRate', 'dt']) {
            if (!Number.isFinite(config[name]) || config[name] < 0) throw new RangeError(`Tectonic ${name} must be finite and non-negative.`);
        }
        const seedBytes = config.gridResolution * config.gridResolution * 4;
        if (Math.max(MAX_SEGMENTS * SEGMENT_STRIDE, seedBytes) > Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)) {
            throw new RangeError('Tectonic segment or seed-cell buffers exceed this device\'s storage-buffer limits.');
        }
        this.device = device;
        this.time = 0;
        this.currentJFA = 0;
        try {
        
        // Create segment buffer
        this.segmentBuffer = device.createBuffer({
            label: 'Tectonic Segments',
            size: MAX_SEGMENTS * SEGMENT_STRIDE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        // Boundary invocations must all read the same pre-update densities.
        this.neighborSegmentBuffer = device.createBuffer({
            label: 'Tectonic Boundary Snapshot', size: MAX_SEGMENTS * SEGMENT_STRIDE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.seedCellsBuffer = device.createBuffer({
            label: 'Tectonic Seed Cells', size: seedBytes, usage: GPUBufferUsage.STORAGE,
        });

        // Create plate buffer
        this.plateBuffer = device.createBuffer({
            label: 'Plate Data',
            size: MAX_PLATES * 32,  // 8 x f32 per plate
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        // Create plate sums buffer (for atomic aggregation)
        this.plateSumsBuffer = device.createBuffer({
            label: 'Plate Sums',
            size: MAX_PLATES * 5 * 4,  // 5 x i32 per plate
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Create params buffer
        this.paramsBuffer = device.createBuffer({
            label: 'Tectonic Params',
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Create time buffer
        this.timeBuffer = device.createBuffer({
            label: 'Time',
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        // Each flood distance has immutable bytes. Rewriting one shared uniform
        // between recorded dispatches would make all flood passes use step 1.
        for (let step = 2 ** (Math.ceil(Math.log2(config.gridResolution)) - 1); step >= 1; step /= 2) {
            const buffer = device.createBuffer({ label: `JFA Step ${step}`, size: 4, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
            new Uint32Array(buffer.getMappedRange())[0] = step;
            buffer.unmap();
            this.jfaStepSizes.push(step);
            this.jfaStepBuffers.push(buffer);
        }
        this.stepSizeBuffer = this.jfaStepBuffers[0];
        
        // Create JFA textures
        for (let i = 0; i < 2; i++) {
            this.jfaTextures[i] = device.createTexture({
                label: `JFA Texture ${i}`,
                size: [this.config.gridResolution, this.config.gridResolution],
                format: 'rg32uint',
                usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
            });
        }
        
        // Create heightmap output
        this.heightmapTexture = device.createTexture({
            label: 'Tectonic Heightmap',
            size: [this.config.gridResolution, this.config.gridResolution],
            format: 'r32float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        
        // Update params
        this._updateParams();
        
        // Create pipelines
        await this._createPipelines();
        this._createBindGroups();
        
        this.initialized = true;
        console.log(`[TectonicSimulation] Initialized with ${this.config.plateCount} plates, ${this.config.segmentCount} segments`);
        } catch (error) {
            this.destroy();
            throw error;
        }
    }
    
    /**
     * Update params buffer
     * @private
     */
    _updateParams() {
        const c = this.config;
        const params = new ArrayBuffer(64);
        const f32 = new Float32Array(params);
        const u32 = new Uint32Array(params);
        
        f32[0] = c.worldSize;
        u32[1] = c.gridResolution;
        u32[2] = c.segmentCount;
        u32[3] = c.plateCount;
        
        f32[4] = c.mantleStrength;
        f32[5] = c.viscosity;
        f32[6] = c.rigidity;
        f32[7] = c.collisionForce;
        
        f32[8] = c.subductionRate;
        f32[9] = c.orogenyRate;
        f32[10] = c.spreadingRate;
        f32[11] = c.dt;
        
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params);
    }
    
    /**
     * Create compute pipelines
     * @private
     */
    async _createPipelines() {
        // JFA Clear
        const clearModule = this.device.createShaderModule({
            code: JFA_INIT_SHADER,
        });
        this.jfaClearPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: clearModule, entryPoint: 'jfa_clear' },
        });
        
        // JFA Init
        this.jfaInitPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: clearModule, entryPoint: 'jfa_init' },
        });
        
        this.jfaResolvePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: clearModule, entryPoint: 'jfa_resolve_seeds' },
        });

        // JFA Pass
        const jfaModule = this.device.createShaderModule({
            code: JFA_PASS_SHADER,
        });
        this.jfaPassPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: jfaModule, entryPoint: 'jfa_pass' },
        });
        
        // Convection
        const convModule = this.device.createShaderModule({
            code: CONVECTION_SHADER,
        });
        this.convectionPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: convModule, entryPoint: 'apply_convection' },
        });
        this.advanceTimePipeline = this.device.createComputePipeline({
            label: 'Tectonic Advance Time',
            layout: 'auto',
            compute: { module: this.device.createShaderModule({ label: 'Tectonic Time Shader', code: ADVANCE_TIME_SHADER }), entryPoint: 'advance_time' },
        });
        
        // Boundary
        const boundaryModule = this.device.createShaderModule({
            code: BOUNDARY_SHADER,
        });
        this.boundaryPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: boundaryModule, entryPoint: 'process_boundaries' },
        });
        
        // Aggregate
        const aggModule = this.device.createShaderModule({
            code: PLATE_AGGREGATE_SHADER,
        });
        this.aggregatePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: aggModule, entryPoint: 'aggregate_positions' },
        });
        this.finalizePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: aggModule, entryPoint: 'finalize_plates' },
        });
        
        // Bake
        const bakeModule = this.device.createShaderModule({
            code: BAKE_HEIGHTMAP_SHADER,
        });
        this.bakePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: bakeModule, entryPoint: 'bake_heightmap' },
        });
    }

    /** Bind only resources reachable from the selected auto-layout entrypoint. */
    _createBindGroups() {
        const buffer = (binding, value) => ({ binding, resource: { buffer: value } });
        const texture = (binding, value) => ({ binding, resource: value.createView() });
        const group = (pipeline, entries) => this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
        const groups = {
            aggregate: group(this.aggregatePipeline, [buffer(0, this.segmentBuffer), buffer(2, this.paramsBuffer), buffer(3, this.plateSumsBuffer)]),
            finalize: group(this.finalizePipeline, [buffer(1, this.plateBuffer), buffer(2, this.paramsBuffer), buffer(3, this.plateSumsBuffer)]),
            advanceTime: group(this.advanceTimePipeline, [buffer(0, this.timeBuffer), buffer(1, this.paramsBuffer)]),
            convection: group(this.convectionPipeline, [buffer(0, this.segmentBuffer), buffer(1, this.plateBuffer), buffer(2, this.paramsBuffer), buffer(3, this.timeBuffer)]),
            clear: this.jfaTextures.map(value => group(this.jfaClearPipeline, [buffer(1, this.paramsBuffer), texture(2, value), buffer(3, this.seedCellsBuffer)])),
            seed: group(this.jfaInitPipeline, [buffer(0, this.segmentBuffer), buffer(1, this.paramsBuffer), buffer(3, this.seedCellsBuffer)]),
            resolveSeeds: this.jfaTextures.map(value => group(this.jfaResolvePipeline, [buffer(0, this.segmentBuffer), buffer(1, this.paramsBuffer), texture(2, value), buffer(3, this.seedCellsBuffer)])),
            flood: this.jfaTextures.map((value, index) => this.jfaStepBuffers.map(step => group(this.jfaPassPipeline, [buffer(0, this.segmentBuffer), buffer(1, this.paramsBuffer), texture(2, value), texture(3, this.jfaTextures[1 - index]), buffer(4, step)]))),
            boundary: this.jfaTextures.map(value => group(this.boundaryPipeline, [buffer(0, this.segmentBuffer), buffer(1, this.plateBuffer), buffer(2, this.paramsBuffer), texture(3, value), buffer(4, this.neighborSegmentBuffer)])),
            bake: this.jfaTextures.map(value => group(this.bakePipeline, [buffer(0, this.segmentBuffer), buffer(1, this.paramsBuffer), texture(2, value), texture(3, this.heightmapTexture)])),
        };
        this.bindGroups = groups;
    }
    
    /**
     * Initialize segments with random plates
     */
    initializeRandom() {
        if (!this.initialized) throw new Error('Initialize the tectonic GPU resources before seeding segments.');
        const segments = new Float32Array(this.config.segmentCount * 8);
        const rng = this._createSeededRandom();
        
        for (let i = 0; i < this.config.segmentCount; i++) {
            const base = i * 8;
            // Deterministic position
            segments[base + 0] = (rng() - 0.5) * this.config.worldSize;  // pos.x
            segments[base + 1] = (rng() - 0.5) * this.config.worldSize;  // pos.z
            segments[base + 2] = 0;  // vel.x
            segments[base + 3] = 0;  // vel.z
            segments[base + 4] = rng() * 50;  // elevation
            segments[base + 5] = 30 + rng() * 20;  // thickness
            segments[base + 6] = rng();  // density
            
            // Assign to deterministic plate
            const u32View = new Uint32Array(segments.buffer, base * 4 + 28, 1);
            u32View[0] = Math.floor(rng() * this.config.plateCount);
        }
        
        this._uploadSegments(segments);
    }

    /**
     * Seed an existing authored terrain without random elevation discontinuities.
     * Supply exactly one signed heightfield or synchronous sampleHeight(x,z).
     * Coherent plates are deterministic Voronoi regions over the segment grid.
     * To retain terrain coverage during a bake, configure rigidity=0 before init:
     * the existing positive rigidity force attracts points toward plate centers.
     */
    initializeTerrain({ heightfield = null, sampleHeight = null, coherentPlates = true } = {}) {
        if (!this.initialized) throw new Error('Initialize the tectonic GPU resources before seeding terrain.');
        if (typeof coherentPlates !== 'boolean' || (heightfield != null) === (sampleHeight != null)
            || sampleHeight != null && typeof sampleHeight !== 'function') {
            throw new TypeError('Tectonic terrain requires exactly one heightfield or height callback and a boolean coherentPlates setting.');
        }
        if (heightfield != null) {
            const { width, height, bounds, heights } = heightfield;
            if (![width, height].every(value => Number.isInteger(value) && value >= 2)
                || !Array.isArray(bounds) || bounds.length !== 4 || bounds.some(value => !Number.isFinite(value)) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]
                || !(Array.isArray(heights) || ArrayBuffer.isView(heights)) || heights.length !== width * height
                || Array.from(heights).some(value => !Number.isFinite(value) || Math.abs(value) > 500)) {
                throw new TypeError('Tectonic terrain field needs valid dimensions, X/Z bounds and signed heights in [-500,500].');
            }
            sampleHeight = (x, z) => sampleTerrainHeightfield(heightfield, x, z);
        }
        const count = this.config.segmentCount, plates = this.config.plateCount, world = this.config.worldSize;
        const segments = new Float32Array(count * 8), integers = new Uint32Array(segments.buffer), rng = this._createSeededRandom();
        // A complete near-square lattice maintains field coverage; square counts
        // sample exactly x/N,z/N like the existing JFA/bake coordinate convention.
        const rows = Math.max(1, Math.floor(Math.sqrt(count))), columns = Math.floor(count / rows), extra = count % rows;
        for (let row = 0, index = 0; row < rows; row++) {
            const rowCount = columns + (row < extra ? 1 : 0);
            for (let column = 0; column < rowCount; column++, index++) {
                const base = index * 8, x = (column / rowCount - .5) * world, z = (row / rows - .5) * world;
                const elevation = sampleHeight(x, z);
                if (!Number.isFinite(elevation) || Math.abs(elevation) > 500) throw new RangeError('Tectonic terrain callback returned a nonfinite or out-of-range height.');
                segments[base] = x; segments[base + 1] = z; segments[base + 4] = elevation;
            }
        }
        const centers = [Math.floor(rng() * count)], distances = new Float64Array(count).fill(Infinity);
        for (let plate = 1; plate < Math.min(plates, count); plate++) {
            const last = centers[centers.length - 1] * 8; let farthest = 0, farthestDistance = -1;
            for (let index = 0; index < count; index++) {
                const base = index * 8, dx = segments[base] - segments[last], dz = segments[base + 1] - segments[last + 1];
                distances[index] = Math.min(distances[index], dx * dx + dz * dz);
                if (distances[index] > farthestDistance) { farthestDistance = distances[index]; farthest = index; }
            }
            centers.push(farthest);
        }
        const densities = Array.from({ length: plates }, () => rng()), thicknesses = Array.from({ length: plates }, () => 30 + rng() * 20), counts = new Uint32Array(plates);
        for (let index = 0; index < count; index++) {
            const base = index * 8; let nearest = 0, best = Infinity;
            if (coherentPlates) {
                for (let plate = 0; plate < centers.length; plate++) {
                    const center = centers[plate] * 8, dx = segments[base] - segments[center], dz = segments[base + 1] - segments[center + 1], distance = dx * dx + dz * dz;
                    if (distance < best) { best = distance; nearest = plate; }
                }
            } else { nearest = Math.floor(rng() * plates); }
            integers[base + 7] = nearest; segments[base + 5] = thicknesses[nearest]; segments[base + 6] = densities[nearest]; counts[nearest]++;
        }
        this._uploadSegments(segments);
        console.log(`[TectonicSimulation] Terrain seeded: ${count} segments, ${centers.length} coherent centers, rigidity ${this.config.rigidity}`);
        return { coherentPlates, centers: centers.map(index => [segments[index * 8], segments[index * 8 + 1]]), segmentCounts: Array.from(counts) };
    }

    /** Reuse the original deterministic RNG without changing random seeding. */
    _createSeededRandom() {
        let rngState = (this.config.seed ?? 42069) >>> 0;
        return () => {
            rngState = (rngState + 0x6D2B79F5) | 0;
            let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /** Commit a fully validated field and reset the existing simulation state. */
    _uploadSegments(segments) {
        this.device.queue.writeBuffer(this.segmentBuffer, 0, segments);
        
        // Initialize plates
        const plates = new Float32Array(this.config.plateCount * 8);
        this.device.queue.writeBuffer(this.plateBuffer, 0, plates);
        
        // Clear sums
        const zeros = new Int32Array(MAX_PLATES * 5);
        this.device.queue.writeBuffer(this.plateSumsBuffer, 0, zeros);
        this.time = 0;
        this.currentJFA = 0;
        this.device.queue.writeBuffer(this.timeBuffer, 0, new Float32Array([0]));
        this.seeded = true;
    }
    
    /**
     * Run one simulation step
     * @param {GPUCommandEncoder} encoder 
     */
    step(encoder) {
        if (!this.initialized || !this.bindGroups || !this.seeded) throw new Error('Initialize and seed the tectonic GPU resources before stepping.');
        this.time += this.config.dt;
        const res = this.config.gridResolution;
        const segmentGroups = Math.ceil(this.config.segmentCount / 64), plateGroups = Math.ceil(this.config.plateCount / 32), gridGroups = Math.ceil(res / 8);
        const dispatch = (label, pipeline, bindings, x, y = 1) => {
            const pass = encoder.beginComputePass({ label });
            pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.dispatchWorkgroups(x, y); pass.end();
        };
        const aggregate = () => {
            encoder.clearBuffer(this.plateSumsBuffer);
            dispatch('Tectonic Aggregate Positions', this.aggregatePipeline, this.bindGroups.aggregate, segmentGroups);
            dispatch('Tectonic Finalize Plates', this.finalizePipeline, this.bindGroups.finalize, plateGroups);
        };
        aggregate();
        dispatch('Tectonic Advance Time', this.advanceTimePipeline, this.bindGroups.advanceTime, 1);
        dispatch('Tectonic Convection', this.convectionPipeline, this.bindGroups.convection, segmentGroups);
        // Boundaries need current centers and velocities after convection.
        aggregate();
        this.currentJFA = 0;
        dispatch('Tectonic Clear Seeds', this.jfaClearPipeline, this.bindGroups.clear[0], gridGroups, gridGroups);
        dispatch('Tectonic Place Seeds', this.jfaInitPipeline, this.bindGroups.seed, segmentGroups);
        dispatch('Tectonic Resolve Seeds', this.jfaResolvePipeline, this.bindGroups.resolveSeeds[0], gridGroups, gridGroups);
        for (let index = 0; index < this.jfaStepSizes.length; index++) {
            dispatch(`Tectonic Flood ${this.jfaStepSizes[index]}`, this.jfaPassPipeline, this.bindGroups.flood[this.currentJFA][index], gridGroups, gridGroups);
            this.currentJFA = 1 - this.currentJFA;
        }
        encoder.copyBufferToBuffer(this.segmentBuffer, 0, this.neighborSegmentBuffer, 0, this.config.segmentCount * SEGMENT_STRIDE);
        dispatch('Tectonic Plate Boundaries', this.boundaryPipeline, this.bindGroups.boundary[this.currentJFA], segmentGroups);
        dispatch('Tectonic Bake Heightmap', this.bakePipeline, this.bindGroups.bake[this.currentJFA], gridGroups, gridGroups);
    }
    
    /**
     * Get heightmap texture for use by other systems
     */
    getHeightmapTexture() {
        return this.heightmapTexture;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.segmentBuffer?.destroy();
        this.neighborSegmentBuffer?.destroy();
        this.seedCellsBuffer?.destroy();
        this.plateBuffer?.destroy();
        this.plateSumsBuffer?.destroy();
        this.paramsBuffer?.destroy();
        this.timeBuffer?.destroy();
        this.jfaStepBuffers.forEach(buffer => buffer.destroy());
        this.jfaStepBuffers = [];
        this.jfaStepSizes = [];
        this.jfaTextures.forEach(t => t?.destroy());
        this.heightmapTexture?.destroy();
        this.segmentBuffer = this.neighborSegmentBuffer = this.seedCellsBuffer = this.plateBuffer = this.plateSumsBuffer = this.paramsBuffer = this.timeBuffer = this.stepSizeBuffer = null;
        this.jfaTextures = [null, null];
        this.heightmapTexture = null;
        this.bindGroups = null;
        this.device = null;
        this.currentJFA = 0;
        this.time = 0;
        this.initialized = false;
        this.seeded = false;
    }
}

export default TectonicSimulation;
