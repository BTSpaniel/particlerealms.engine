// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSharedMemCollision.js - Workgroup shared memory particle collision
 * 
 * Drop-in replacement for the grid collision `collide` pass that uses
 * workgroup shared memory to eliminate random global memory reads.
 * 
 * Architecture:
 * - Uses the same grid infrastructure (clearGrid + binParticles are unchanged)
 * - Dispatches one workgroup PER grid cell (cell-centric)
 * - All threads in a workgroup share the same cell → same neighbor cells
 * - Neighbor particles loaded into shared memory in tiles of TILE_SIZE
 * - Each thread checks its particle against shared memory (fast L1/register access)
 * 
 * Memory access improvement:
 * - Old: Each thread reads random global positions/velocities for neighbors
 * - New: Workgroup cooperatively loads sequential global reads → shared memory
 *        Then all threads read from shared memory (100× faster than global)
 * 
 * Uses the SAME bind group layout as the existing grid collision system,
 * so the existing bind group can be reused directly.
 * 
 * Ref: GPU Gems 3 Ch.31 "Fast N-Body Simulation with CUDA"
 */

// ============================================================================
// SHARED MEMORY COLLIDE SHADER
// ============================================================================

function createSharedMemCollideShader(tileSize = 256) {
    return `
struct Params {
    dt: f32,
    particleCount: u32,
    roomHalfSize: f32,
    gravityY: f32,
    baseIndex: u32,
    gridDims: u32,
    cellCap: u32,
    ropeSkip: u32,
};

@group(0) @binding(0) var<storage, read_write> positions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities : array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params : Params;
@group(0) @binding(3) var<storage, read> owners : array<u32>;
@group(0) @binding(4) var<storage, read_write> cellCounts : array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> cellIndices : array<u32>;
@group(0) @binding(6) var<storage, read> thermalData : array<vec4<f32>>;

const TILE_SIZE = ${tileSize}u;
const COLLISION_RADIUS: f32 = 0.5;
const SEPARATION_RADIUS: f32 = 1.5;
const SEPARATION_RADIUS_SQ: f32 = 2.25; // 1.5²

// Shared memory tile: neighbor particle data loaded cooperatively
var<workgroup> s_pos: array<vec3<f32>, ${tileSize}>;
var<workgroup> s_idx: array<u32, ${tileSize}>;

fn cellCoordFromIndex(idx: u32, gd: u32) -> vec3<u32> {
    let plane = gd * gd;
    let z = idx / plane;
    let rem = idx - z * plane;
    let y = rem / gd;
    let x = rem - y * gd;
    return vec3<u32>(x, y, z);
}

fn cellIndexFromCoord(c: vec3<u32>, gd: u32) -> u32 {
    return c.x + c.y * gd + c.z * gd * gd;
}

@compute @workgroup_size(${tileSize})
fn collideShared(@builtin(local_invocation_id) lid: vec3<u32>,
                 @builtin(workgroup_id) wgid: vec3<u32>) {
    let cellIdx = wgid.x + wgid.y * ${65535}u;
    let gd = max(params.gridDims, 1u);
    let totalCells = gd * gd * gd;
    let cap = max(params.cellCap, 1u);

    // All threads in invalid workgroups return together (uniform)
    if (cellIdx >= totalCells) { return; }

    // How many particles are in THIS cell?
    let cellCount = min(atomicLoad(&cellCounts[cellIdx]), cap);

    // My slot in this cell
    let mySlot = lid.x;
    let hasParticle = mySlot < cellCount;

    // Load my particle data from global memory (only active threads)
    var myPos = vec3<f32>(0.0);
    var myVel = vec4<f32>(0.0);
    var myIdx = 0u;
    var myGroup = 0u;
    if (hasParticle) {
        myIdx = cellIndices[cellIdx * cap + mySlot];
        myPos = positions[myIdx].xyz;
        myVel = velocities[myIdx];
        myGroup = u32(thermalData[myIdx].z) >> 8u;
    }

    var totalForce = vec3<f32>(0.0);

    // Determine my cell's grid coordinate (uniform across workgroup)
    let baseCoord = cellCoordFromIndex(cellIdx, gd);

    // Iterate over 3×3×3 neighbor cells (27 total, including self)
    // All branch conditions here are UNIFORM because baseCoord is derived from wgid
    for (var dz: i32 = -1; dz <= 1; dz++) {
        let nz = i32(baseCoord.z) + dz;
        if (nz < 0 || nz >= i32(gd)) { continue; }
        for (var dy: i32 = -1; dy <= 1; dy++) {
            let ny = i32(baseCoord.y) + dy;
            if (ny < 0 || ny >= i32(gd)) { continue; }
            for (var dx: i32 = -1; dx <= 1; dx++) {
                let nx = i32(baseCoord.x) + dx;
                if (nx < 0 || nx >= i32(gd)) { continue; }

                let nci = cellIndexFromCoord(vec3<u32>(u32(nx), u32(ny), u32(nz)), gd);
                let nCount = min(atomicLoad(&cellCounts[nci]), cap);

                // Load neighbor particles into shared memory in tiles
                // Use 'cap' (uniform) as loop bound so workgroupBarrier is in uniform control flow
                // Tiles beyond nCount load sentinel values (1e10) → no collisions
                for (var tileStart = 0u; tileStart < cap; tileStart += TILE_SIZE) {
                    // === LOAD PHASE: coalesced global reads ===
                    let loadSlot = tileStart + lid.x;
                    if (loadSlot < nCount) {
                        let j = cellIndices[nci * cap + loadSlot];
                        s_pos[lid.x] = positions[j].xyz;
                        s_idx[lid.x] = j;
                    } else {
                        s_pos[lid.x] = vec3<f32>(1e10);  // Far away = no collision
                        s_idx[lid.x] = 0xFFFFFFFFu;
                    }
                    workgroupBarrier();

                    // === CHECK PHASE: fast shared memory reads ===
                    let tileCount = min(nCount - tileStart, TILE_SIZE);
                    if (hasParticle) {
                        for (var k = 0u; k < tileCount; k++) {
                            let otherIdx = s_idx[k];
                            if (otherIdx == myIdx) { continue; }

                            // Collision group filter
                            let otherGroup = u32(thermalData[otherIdx].z) >> 8u;
                            if (myGroup != 0u && myGroup == otherGroup) { continue; }

                            let otherPos = s_pos[k];
                            let offset = myPos - otherPos;
                            let d2 = dot(offset, offset);

                            if (d2 > 0.000001 && d2 < SEPARATION_RADIUS_SQ) {
                                let dist = sqrt(d2);
                                let inv = 1.0 / dist;
                                let hardCollision = select(0.0, 5.0, dist < COLLISION_RADIUS);
                                let softRepulsion = (SEPARATION_RADIUS - dist) * 1.5;
                                totalForce += offset * inv * (hardCollision + softRepulsion);
                            }
                        }
                    }
                    workgroupBarrier();
                }
            }
        }
    }

    // Write accumulated force back to velocity
    if (hasParticle) {
        velocities[myIdx] = vec4<f32>(myVel.xyz + totalForce * params.dt, myVel.w);
    }
}
`;
}

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the shared-memory collide pipeline.
 * This pipeline uses the SAME bind group layout as the existing grid collision system.
 * @param {GPUDevice} device
 * @param {GPUBindGroupLayout} bindGroupLayout - From the existing grid collision system
 * @param {number} tileSize - Workgroup/tile size (default 256)
 */
export function createSharedMemCollidePipeline(device, bindGroupLayout, tileSize = 256) {
    const shaderModule = device.createShaderModule({
        label: "SharedMemCollision.shader",
        code: createSharedMemCollideShader(tileSize),
    });

    const pipelineLayout = device.createPipelineLayout({
        label: "SharedMemCollision.layout",
        bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createComputePipeline({
        label: "SharedMemCollision.pipeline",
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: "collideShared" },
    });

    console.log(`[SharedMemCollision] Pipeline created (tileSize=${tileSize})`);
    return pipeline;
}

/**
 * Execute the shared-memory collide pass.
 * Dispatches one workgroup per grid cell. Uses the existing grid bind group.
 * 
 * @param {GPUComputePipeline} pipeline - From createSharedMemCollidePipeline
 * @param {GPUBindGroup} bindGroup - Existing grid collision bind group
 * @param {GPUComputePassEncoder} pass - Active compute pass
 * @param {number} gridDims - Grid dimensions (e.g. 32)
 */
export function dispatchSharedMemCollide(pipeline, bindGroup, pass, gridDims) {
    const totalCells = gridDims * gridDims * gridDims;
    const MAX_WG = 65535;
    const wgX = Math.min(totalCells, MAX_WG);
    const wgY = Math.ceil(totalCells / MAX_WG);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
}
