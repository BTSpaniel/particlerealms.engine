// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleNeighborGrid.js - General-Purpose Neighbor Grid (GAP 25)
 * 
 * GPU spatial query structure for arbitrary particle-to-particle interactions.
 * Unlike the collision-specific spatial grid, this is a general-purpose 3D grid
 * that any system can query: flocking, color transfer, interaction, etc.
 * 
 * Matches Niagara Neighbor Grid 3D and PopcornFX Spatial Layers.
 * 
 * Architecture (hash-modulo bucket approach — inspired by NVIDIA CUDA Particles):
 *   1. Clear cell counts via encoder.clearBuffer (GPU memset, no dispatch limit)
 *   2. Insert particles into hash buckets (compute pass, atomic append)
 *   3. Query neighbors from any other compute pass via grid lookup
 * 
 * Instead of allocating one bucket per 3D cell (can exceed millions), we use
 * numBuckets = min(totalCells, maxParticles). The flat cell index is modulo'd
 * into this smaller range. Hash collisions are harmless — consumer shaders
 * already do distance checks that filter false positives.
 * 
 * Grid stores up to maxNeighborsPerCell particle indices per bucket.
 * Query returns indices of particles in same + adjacent cells (27-cell neighborhood).
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// WGSL SHADERS
// ============================================================================

const NEIGHBOR_GRID_INSERT_SHADER = /* wgsl */`
struct GridParams {
  gridDimX: u32,
  gridDimY: u32,
  gridDimZ: u32,
  maxNeighborsPerCell: u32,
  worldMinX: f32,
  worldMinY: f32,
  worldMinZ: f32,
  cellSize: f32,
  particleCount: u32,
  numBuckets: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> params: GridParams;
@group(0) @binding(1) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> cellEntries: array<u32>;
@group(0) @binding(3) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> velocities: array<vec4<f32>>;

fn worldToCell(pos: vec3<f32>) -> vec3<i32> {
  let rel = pos - vec3<f32>(params.worldMinX, params.worldMinY, params.worldMinZ);
  return vec3<i32>(floor(rel / params.cellSize));
}

fn cellIndex(cx: i32, cy: i32, cz: i32) -> u32 {
  if (cx < 0 || cy < 0 || cz < 0) { return 0xFFFFFFFFu; }
  let ux = u32(cx); let uy = u32(cy); let uz = u32(cz);
  if (ux >= params.gridDimX || uy >= params.gridDimY || uz >= params.gridDimZ) { return 0xFFFFFFFFu; }
  let flat = uz * params.gridDimX * params.gridDimY + uy * params.gridDimX + ux;
  return flat % params.numBuckets;
}

@compute @workgroup_size(64)
fn insertParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos = positions[idx];
  let vel = velocities[idx];
  let age = pos.w;
  let lifetime = vel.w;
  if (age >= lifetime) { return; } // skip dead

  let cell = worldToCell(pos.xyz);
  let ci = cellIndex(cell.x, cell.y, cell.z);
  if (ci == 0xFFFFFFFFu) { return; } // out of grid

  let slot = atomicAdd(&cellCounts[ci], 1u);
  if (slot < params.maxNeighborsPerCell) {
    cellEntries[ci * params.maxNeighborsPerCell + slot] = idx;
  }
}
`;

// Reusable WGSL snippet for consumer shaders to query neighbors
export const NEIGHBOR_QUERY_WGSL = /* wgsl */`
// Include this in any compute shader that needs neighbor queries.
// Assumes gridParams, gridCellCounts, gridCellEntries are bound.
// IMPORTANT: cellIndex() must use % numBuckets to match the hash-modulo insert.

fn queryNeighbors(
  pos: vec3<f32>,
  gridParams: GridParams,
  cellCounts: ptr<storage, array<atomic<u32>>, read>,
  cellEntries: ptr<storage, array<u32>, read>,
  callback: ptr<function, array<u32, 128>>,
) -> u32 {
  // This is a conceptual snippet. In practice, inline the loop in your shader.
  // See queryNeighborsInline() below for copy-paste usage.
  return 0u;
}

// Inline neighbor query pattern (copy into your shader):
// fn cellIndex(cx, cy, cz) -> u32 {
//   ... bounds check ...
//   let flat = uz * gridDimX * gridDimY + uy * gridDimX + ux;
//   return flat % numBuckets;  // hash-modulo into bucket range
// }
// let cell = worldToCell(myPos);
// var neighborCount = 0u;
// for (var dz = -1; dz <= 1; dz++) {
//   for (var dy = -1; dy <= 1; dy++) {
//     for (var dx = -1; dx <= 1; dx++) {
//       let ci = cellIndex(cell.x + dx, cell.y + dy, cell.z + dz);
//       if (ci == 0xFFFFFFFFu) { continue; }
//       let count = min(cellCounts[ci], maxNeighborsPerCell);
//       for (var k = 0u; k < count; k++) {
//         let neighborIdx = cellEntries[ci * maxNeighborsPerCell + k];
//         if (neighborIdx == 0xFFFFFFFFu || neighborIdx == myIdx) { continue; }
//         // ... use neighborIdx ...
//         neighborCount++;
//       }
//     }
//   }
// }
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create a general-purpose neighbor grid.
 * @param {GPUDevice} device
 * @param {Object} config
 * @param {number[]} config.worldMin - Grid world origin [x, y, z] (default [-50, -50, -50])
 * @param {number[]} config.worldMax - Grid world extent [x, y, z] (default [50, 50, 50])
 * @param {number} config.cellSize - Cell size in world units (default 2.0)
 * @param {number} config.maxNeighborsPerCell - Max particles per cell (default 16)
 * @param {number} config.maxParticles - Max particle count for insert
 */
export function createNeighborGridSystem(device, config = {}) {
  const worldMin = config.worldMin || [-50, -50, -50];
  const worldMax = config.worldMax || [50, 50, 50];
  const cellSize = config.cellSize || 2.0;
  const maxNeighbors = config.maxNeighborsPerCell || 16;
  const maxParticles = config.maxParticles || 100000;

  const gridDimX = Math.ceil((worldMax[0] - worldMin[0]) / cellSize);
  const gridDimY = Math.ceil((worldMax[1] - worldMin[1]) / cellSize);
  const gridDimZ = Math.ceil((worldMax[2] - worldMin[2]) / cellSize);
  const totalCells = gridDimX * gridDimY * gridDimZ;

  // Hash-modulo bucket count: cap at maxParticles to keep buffers small.
  // If totalCells <= maxParticles, no hashing needed (1:1 mapping).
  // With cellSize=0.6, world=100³: 167³=4.6M cells → capped to 100K buckets.
  // Hash collisions are harmless — consumer shaders do distance checks.
  const numBuckets = Math.min(totalCells, maxParticles);

  // Shader modules (no clear shader — we use encoder.clearBuffer instead)
  const insertModule = device.createShaderModule({
    label: 'NeighborGrid.insert', code: NEIGHBOR_GRID_INSERT_SHADER,
  });

  // Pipelines
  const insertPipeline = device.createComputePipeline({
    label: 'NeighborGrid.insertPipeline', layout: 'auto',
    compute: { module: insertModule, entryPoint: 'insertParticles' },
  });

  // Params uniform (48 bytes = 12 u32/f32)
  const paramsBuffer = createUniformBuffer(device, 48, { label: 'NeighborGrid.params' });
  labelResource(paramsBuffer, 'NeighborGrid.params');

  // Cell counts buffer: numBuckets × u32 (atomic) — zeroed each frame via clearBuffer
  const cellCountsBuffer = createStorageBuffer(device, numBuckets * 4, { label: 'NeighborGrid.cellCounts' });
  labelResource(cellCountsBuffer, 'NeighborGrid.cellCounts');

  // Cell entries buffer: numBuckets × maxNeighbors × u32
  const cellEntriesBuffer = createStorageBuffer(device, numBuckets * maxNeighbors * 4, { label: 'NeighborGrid.cellEntries' });
  labelResource(cellEntriesBuffer, 'NeighborGrid.cellEntries');

  console.log(`[NeighborGrid] Hash-modulo grid: ${totalCells} cells → ${numBuckets} buckets (${(numBuckets * maxNeighbors * 4 / 1024 / 1024).toFixed(1)}MB entries, ${(numBuckets * 4 / 1024).toFixed(0)}KB counts)`);

  return {
    device,
    insertPipeline,
    paramsBuffer,
    cellCountsBuffer,
    cellEntriesBuffer,
    insertBindGroup: null,
    gridDimX, gridDimY, gridDimZ,
    totalCells,
    numBuckets,
    cellSize,
    maxNeighbors,
    maxParticles,
    worldMin,
  };
}

/**
 * Initialize bind groups (call after particle buffers are created).
 */
export function initNeighborGridBindGroups(system, device, positionBuffer, velocityBuffer) {
  // Update params
  const paramsData = new ArrayBuffer(48);
  const u32View = new Uint32Array(paramsData);
  const f32View = new Float32Array(paramsData);
  u32View[0] = system.gridDimX;
  u32View[1] = system.gridDimY;
  u32View[2] = system.gridDimZ;
  u32View[3] = system.maxNeighbors;
  f32View[4] = system.worldMin[0];
  f32View[5] = system.worldMin[1];
  f32View[6] = system.worldMin[2];
  f32View[7] = system.cellSize;
  u32View[8] = system.maxParticles;
  u32View[9] = system.numBuckets;
  device.queue.writeBuffer(system.paramsBuffer, 0, paramsData);

  // Insert bind group (bindings 0-4)
  system.insertBindGroup = device.createBindGroup({
    label: 'NeighborGrid.insertBindGroup',
    layout: system.insertPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: system.cellCountsBuffer } },
      { binding: 2, resource: { buffer: system.cellEntriesBuffer } },
      { binding: 3, resource: { buffer: positionBuffer } },
      { binding: 4, resource: { buffer: velocityBuffer } },
    ],
  });
}

/**
 * Update the particle count in params (call each frame if count changes).
 */
export function setNeighborGridParticleCount(system, particleCount) {
  const data = new Uint32Array([particleCount]);
  system.device.queue.writeBuffer(system.paramsBuffer, 32, data); // offset 32 = particleCount field
}

/**
 * Execute clear + insert passes. Call once per frame before any queries.
 * @param {Object} system
 * @param {GPUDevice} device
 * @param {number} particleCount
 */
export function buildNeighborGrid(system, device, particleCount) {
  if (!system.insertBindGroup || particleCount === 0) return;

  // Update particle count
  setNeighborGridParticleCount(system, particleCount);

  const encoder = device.createCommandEncoder({ label: 'NeighborGrid.build' });

  // Pass 1: Clear cell counts via GPU memset (no compute dispatch needed).
  // encoder.clearBuffer fills with zeros — exactly what atomicStore(0) did.
  // Entries don't need clearing: they're only read up to count (which is 0).
  encoder.clearBuffer(system.cellCountsBuffer);

  // Pass 2: Insert particles into hash buckets
  const insertWGs = Math.ceil(particleCount / 64);
  const insertPass = encoder.beginComputePass({ label: 'NeighborGrid.insert' });
  insertPass.setPipeline(system.insertPipeline);
  insertPass.setBindGroup(0, system.insertBindGroup);
  insertPass.dispatchWorkgroups(insertWGs);
  insertPass.end();

  device.queue.submit([encoder.finish()]);
}

/**
 * Get the grid buffers for use in consumer compute shaders.
 * Consumer shaders should bind cellCountsBuffer and cellEntriesBuffer as read-only storage.
 * @returns {{ paramsBuffer, cellCountsBuffer, cellEntriesBuffer, gridDimX, gridDimY, gridDimZ, cellSize, maxNeighbors }}
 */
export function getNeighborGridBuffers(system) {
  return {
    paramsBuffer: system.paramsBuffer,
    cellCountsBuffer: system.cellCountsBuffer,
    cellEntriesBuffer: system.cellEntriesBuffer,
    gridDimX: system.gridDimX,
    gridDimY: system.gridDimY,
    gridDimZ: system.gridDimZ,
    cellSize: system.cellSize,
    maxNeighbors: system.maxNeighbors,
    numBuckets: system.numBuckets,
    worldMin: system.worldMin,
  };
}

/**
 * Destroy the system.
 */
export function destroyNeighborGridSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  if (system.cellCountsBuffer) system.cellCountsBuffer.destroy();
  if (system.cellEntriesBuffer) system.cellEntriesBuffer.destroy();
  system.insertBindGroup = null;
}
