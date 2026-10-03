// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// =============================================================================
// FLUID MPM - Material Point Method for hybrid particle-grid fluid simulation
// =============================================================================
// Implements MLS-MPM (Moving Least Squares Material Point Method) with APIC
// (Affine Particle-In-Cell) for stable momentum transfer.
//
// Key concepts:
//   - P2G (Particle to Grid): Scatter particle mass/momentum to grid using kernels
//   - Grid Update: Apply forces, boundaries, pressure projection
//   - G2P (Grid to Particle): Gather grid velocity back to particles
//
// Uses fixed-point atomics for P2G since WebGPU doesn't support float atomics.

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { BindGroupSignals } from "../../core/gpu/BindingSignals.js";
import { getGPUMemoryManager } from "../../core/memory/GPUMemoryManager.js";

// Fixed-point scale factor (2^20 gives ~6 decimal digits of precision)
const FIXED_POINT_SCALE = 1048576.0; // 2^20

/**
 * Create MPM-specific buffers for the fluid simulation
 */
export function createMPMBuffers(device, gridSize, maxParticles) {
  const [gx, gy, gz] = gridSize;
  const cellCount = gx * gy * gz;
  
  // Grid mass buffer - accumulated during P2G (atomic<i32> for fixed-point)
  const gridMassBuffer = device.createBuffer({
    label: "MPM.gridMass",
    size: cellCount * 4, // i32 per cell
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  // Grid momentum buffer - accumulated during P2G (3x atomic<i32> for fixed-point)
  const gridMomentumBuffer = device.createBuffer({
    label: "MPM.gridMomentum",
    size: cellCount * 4 * 4, // vec4<i32> per cell (xyz = momentum, w = unused)
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  // Particle affine momentum (C matrix from APIC) - 3x3 matrix per particle
  // Stored as 3 vec4s per particle for alignment
  const particleAffineBuffer = device.createBuffer({
    label: "MPM.particleAffine",
    size: maxParticles * 4 * 4 * 3, // 3 vec4<f32> per particle
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  return {
    gridMassBuffer,
    gridMomentumBuffer,
    particleAffineBuffer,
    cellCount,
    maxParticles,
  };
}

/**
 * Destroy MPM buffers
 */
export function destroyMPMBuffers(mpm) {
  if (!mpm) return;
  mpm.gridMassBuffer?.destroy();
  mpm.gridMomentumBuffer?.destroy();
  mpm.particleAffineBuffer?.destroy();
}

/**
 * Generate the P2G (Particle to Grid) compute shader
 * Uses linear kernel (tent function) for simplicity
 */
export function createP2GShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// P2G - Particle to Grid transfer
// =============================================================================
// Each particle scatters mass and momentum to nearby grid nodes using
// fixed-point atomics.

struct MPMParams {
  gridSizeX : f32,
  gridSizeY : f32,
  gridSizeZ : f32,
  cellSize  : f32,   // World units per cell
  worldMinX : f32,
  worldMinY : f32,
  worldMinZ : f32,
  particleCount : f32,
  dt        : f32,
  gravity   : f32,
  _pad0     : f32,
  _pad1     : f32,
};

// Particle data (from existing particle system)
@group(0) @binding(0) var<storage, read> particlePos : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> particleVel : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> particleAffine : array<vec4<f32>>; // 3 vec4s per particle

// Grid data (atomic for scatter)
@group(0) @binding(3) var<storage, read_write> gridMass : array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> gridMomentum : array<atomic<i32>>; // 4 i32s per cell

@group(0) @binding(5) var<uniform> params : MPMParams;

const FIXED_SCALE : f32 = 1048576.0; // 2^20

fn worldToGrid(worldPos : vec3<f32>) -> vec3<f32> {
  let relPos = worldPos - vec3<f32>(params.worldMinX, params.worldMinY, params.worldMinZ);
  return relPos / params.cellSize;
}

fn gridIndex(ix : i32, iy : i32, iz : i32) -> i32 {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  return iz * gx * gy + iy * gx + ix;
}

fn isValidCell(ix : i32, iy : i32, iz : i32) -> bool {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  let gz = i32(params.gridSizeZ);
  return ix >= 0 && ix < gx && iy >= 0 && iy < gy && iz >= 0 && iz < gz;
}

// Linear kernel (tent function) weight
fn kernelWeight(dist : f32) -> f32 {
  let d = abs(dist);
  if (d >= 1.0) { return 0.0; }
  return 1.0 - d;
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let pIdx = gid.x;
  let pCount = u32(params.particleCount);
  
  if (pIdx >= pCount) { return; }
  
  // Read particle data
  let pos4 = particlePos[pIdx];
  let vel4 = particleVel[pIdx];
  
  // Skip dead particles (w < 0 or lifetime expired)
  if (pos4.w <= 0.0) { return; }
  
  let pos = pos4.xyz;
  let vel = vel4.xyz;
  let mass = 1.0; // TODO: Get from particle meta
  
  // Get particle's grid position
  let gridPos = worldToGrid(pos);
  let baseCell = vec3<i32>(floor(gridPos));
  let frac = gridPos - vec3<f32>(baseCell);
  
  // Read affine momentum matrix (C from APIC)
  let affineIdx = pIdx * 3u;
  let C0 = particleAffine[affineIdx + 0u].xyz;
  let C1 = particleAffine[affineIdx + 1u].xyz;
  let C2 = particleAffine[affineIdx + 2u].xyz;
  
  // Scatter to 2x2x2 neighborhood (linear kernel)
  for (var dz = 0; dz <= 1; dz++) {
    for (var dy = 0; dy <= 1; dy++) {
      for (var dx = 0; dx <= 1; dx++) {
        let cellCoord = baseCell + vec3<i32>(dx, dy, dz);
        
        if (!isValidCell(cellCoord.x, cellCoord.y, cellCoord.z)) { continue; }
        
        // Compute kernel weight
        let cellFrac = vec3<f32>(f32(dx), f32(dy), f32(dz));
        let dist = frac - cellFrac;
        let wx = kernelWeight(dist.x);
        let wy = kernelWeight(dist.y);
        let wz = kernelWeight(dist.z);
        let weight = wx * wy * wz;
        
        if (weight <= 0.0) { continue; }
        
        // APIC: momentum contribution includes affine term
        // m_i += w * m_p
        // (mv)_i += w * m_p * (v_p + C_p * (x_i - x_p))
        let cellCenter = vec3<f32>(cellCoord) + 0.5;
        let dx_cell = (cellCenter - gridPos) * params.cellSize;
        
        let affineVel = vec3<f32>(
          dot(C0, dx_cell),
          dot(C1, dx_cell),
          dot(C2, dx_cell)
        );
        
        let momentum = mass * (vel + affineVel) * weight;
        let massContrib = mass * weight;
        
        // Convert to fixed-point and scatter
        let cellIdx = gridIndex(cellCoord.x, cellCoord.y, cellCoord.z);
        
        atomicAdd(&gridMass[cellIdx], i32(massContrib * FIXED_SCALE));
        atomicAdd(&gridMomentum[cellIdx * 4 + 0], i32(momentum.x * FIXED_SCALE));
        atomicAdd(&gridMomentum[cellIdx * 4 + 1], i32(momentum.y * FIXED_SCALE));
        atomicAdd(&gridMomentum[cellIdx * 4 + 2], i32(momentum.z * FIXED_SCALE));
      }
    }
  }
}
`;
}

/**
 * Generate the Grid Update compute shader
 * Converts accumulated momentum to velocity, applies forces and boundaries
 */
export function createGridUpdateShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// Grid Update - Convert momentum to velocity, apply forces
// =============================================================================

struct MPMParams {
  gridSizeX : f32,
  gridSizeY : f32,
  gridSizeZ : f32,
  cellSize  : f32,
  worldMinX : f32,
  worldMinY : f32,
  worldMinZ : f32,
  particleCount : f32,
  dt        : f32,
  gravity   : f32,
  _pad0     : f32,
  _pad1     : f32,
};

@group(0) @binding(0) var<storage, read> gridMassAtomic : array<i32>;
@group(0) @binding(1) var<storage, read> gridMomentumAtomic : array<i32>;
@group(0) @binding(2) var<storage, read_write> gridVelocity : array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params : MPMParams;

const FIXED_SCALE : f32 = 1048576.0;
const MIN_MASS : f32 = 0.0001;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  let gz = i32(params.gridSizeZ);
  let cellCount = gx * gy * gz;
  
  let cellIdx = i32(gid.x);
  if (cellIdx >= cellCount) { return; }
  
  // Read accumulated mass and momentum (convert from fixed-point)
  let mass = f32(gridMassAtomic[cellIdx]) / FIXED_SCALE;
  let momX = f32(gridMomentumAtomic[cellIdx * 4 + 0]) / FIXED_SCALE;
  let momY = f32(gridMomentumAtomic[cellIdx * 4 + 1]) / FIXED_SCALE;
  let momZ = f32(gridMomentumAtomic[cellIdx * 4 + 2]) / FIXED_SCALE;
  
  var vel = vec3<f32>(0.0);
  
  if (mass > MIN_MASS) {
    // Convert momentum to velocity
    vel = vec3<f32>(momX, momY, momZ) / mass;
    
    // Apply gravity
    vel.y -= params.gravity * params.dt;
  }
  
  // Decode cell coordinates for boundary handling
  let layerSize = gx * gy;
  let z = cellIdx / layerSize;
  let rem = cellIdx - z * layerSize;
  let y = rem / gx;
  let x = rem - y * gx;
  
  // Simple boundary conditions (no-slip walls)
  if (x <= 1 || x >= gx - 2) { vel.x = 0.0; }
  if (y <= 1) { vel.y = max(vel.y, 0.0); } // Floor - only block downward
  if (y >= gy - 2) { vel.y = min(vel.y, 0.0); } // Ceiling
  if (z <= 1 || z >= gz - 2) { vel.z = 0.0; }
  
  // Store velocity for G2P
  gridVelocity[u32(cellIdx)] = vec4<f32>(vel, mass);
}
`;
}

/**
 * Generate the G2P (Grid to Particle) compute shader
 */
export function createG2PShader(workgroupSize = 256) {
  return /* wgsl */`
// =============================================================================
// G2P - Grid to Particle transfer
// =============================================================================
// Each particle gathers velocity from nearby grid nodes and updates
// its velocity and affine momentum matrix.

struct MPMParams {
  gridSizeX : f32,
  gridSizeY : f32,
  gridSizeZ : f32,
  cellSize  : f32,
  worldMinX : f32,
  worldMinY : f32,
  worldMinZ : f32,
  particleCount : f32,
  dt        : f32,
  gravity   : f32,
  _pad0     : f32,
  _pad1     : f32,
};

@group(0) @binding(0) var<storage, read> particlePos : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> particleVel : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> particleAffine : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> gridVelocity : array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params : MPMParams;

fn worldToGrid(worldPos : vec3<f32>) -> vec3<f32> {
  let relPos = worldPos - vec3<f32>(params.worldMinX, params.worldMinY, params.worldMinZ);
  return relPos / params.cellSize;
}

fn gridIndex(ix : i32, iy : i32, iz : i32) -> u32 {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  return u32(iz * gx * gy + iy * gx + ix);
}

fn isValidCell(ix : i32, iy : i32, iz : i32) -> bool {
  let gx = i32(params.gridSizeX);
  let gy = i32(params.gridSizeY);
  let gz = i32(params.gridSizeZ);
  return ix >= 0 && ix < gx && iy >= 0 && iy < gy && iz >= 0 && iz < gz;
}

fn kernelWeight(dist : f32) -> f32 {
  let d = abs(dist);
  if (d >= 1.0) { return 0.0; }
  return 1.0 - d;
}

fn kernelGrad(dist : f32) -> f32 {
  let d = abs(dist);
  if (d >= 1.0) { return 0.0; }
  return select(-1.0, 1.0, dist < 0.0);
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let pIdx = gid.x;
  let pCount = u32(params.particleCount);
  
  if (pIdx >= pCount) { return; }
  
  let pos4 = particlePos[pIdx];
  
  // Skip dead particles
  if (pos4.w <= 0.0) { return; }
  
  let pos = pos4.xyz;
  let gridPos = worldToGrid(pos);
  let baseCell = vec3<i32>(floor(gridPos));
  let frac = gridPos - vec3<f32>(baseCell);
  
  // Gather velocity and compute affine matrix
  var newVel = vec3<f32>(0.0);
  var C0 = vec3<f32>(0.0);
  var C1 = vec3<f32>(0.0);
  var C2 = vec3<f32>(0.0);
  
  let invCellSize = 1.0 / params.cellSize;
  
  for (var dz = 0; dz <= 1; dz++) {
    for (var dy = 0; dy <= 1; dy++) {
      for (var dx = 0; dx <= 1; dx++) {
        let cellCoord = baseCell + vec3<i32>(dx, dy, dz);
        
        if (!isValidCell(cellCoord.x, cellCoord.y, cellCoord.z)) { continue; }
        
        let cellFrac = vec3<f32>(f32(dx), f32(dy), f32(dz));
        let dist = frac - cellFrac;
        let wx = kernelWeight(dist.x);
        let wy = kernelWeight(dist.y);
        let wz = kernelWeight(dist.z);
        let weight = wx * wy * wz;
        
        if (weight <= 0.0) { continue; }
        
        let cellIdx = gridIndex(cellCoord.x, cellCoord.y, cellCoord.z);
        let gridVel = gridVelocity[cellIdx].xyz;
        
        // Accumulate velocity
        newVel += weight * gridVel;
        
        // Compute affine matrix contribution (APIC)
        let cellCenter = vec3<f32>(cellCoord) + 0.5;
        let dx_cell = (cellCenter - gridPos) * params.cellSize;
        
        // C += w * v_i * (x_i - x_p)^T / dx^2
        // For linear kernel: simplified to 4 * w * v_i * (x_i - x_p)^T
        let factor = 4.0 * weight * invCellSize * invCellSize;
        C0 += factor * gridVel.x * dx_cell;
        C1 += factor * gridVel.y * dx_cell;
        C2 += factor * gridVel.z * dx_cell;
      }
    }
  }
  
  // Update particle velocity
  let vel4 = particleVel[pIdx];
  particleVel[pIdx] = vec4<f32>(newVel, vel4.w);
  
  // Update affine matrix
  let affineIdx = pIdx * 3u;
  particleAffine[affineIdx + 0u] = vec4<f32>(C0, 0.0);
  particleAffine[affineIdx + 1u] = vec4<f32>(C1, 0.0);
  particleAffine[affineIdx + 2u] = vec4<f32>(C2, 0.0);
}
`;
}

/**
 * Create MPM compute pipelines
 */
export function createMPMPipelines(device, options = {}) {
  const workgroupSize = options.workgroupSize || 256;
  
  // P2G shader and pipeline
  const p2gModule = device.createShaderModule({
    label: "MPM.P2G",
    code: createP2GShader(workgroupSize),
  });
  
  const p2gPipeline = device.createComputePipeline({
    label: "MPM.P2G.pipeline",
    layout: "auto",
    compute: {
      module: p2gModule,
      entryPoint: "main",
    },
  });
  
  // Grid update shader and pipeline
  const gridUpdateModule = device.createShaderModule({
    label: "MPM.GridUpdate",
    code: createGridUpdateShader(workgroupSize),
  });
  
  const gridUpdatePipeline = device.createComputePipeline({
    label: "MPM.GridUpdate.pipeline",
    layout: "auto",
    compute: {
      module: gridUpdateModule,
      entryPoint: "main",
    },
  });
  
  // G2P shader and pipeline
  const g2pModule = device.createShaderModule({
    label: "MPM.G2P",
    code: createG2PShader(workgroupSize),
  });
  
  const g2pPipeline = device.createComputePipeline({
    label: "MPM.G2P.pipeline",
    layout: "auto",
    compute: {
      module: g2pModule,
      entryPoint: "main",
    },
  });
  
  return {
    p2gPipeline,
    gridUpdatePipeline,
    g2pPipeline,
    workgroupSize,
  };
}

/**
 * Create a complete MPM simulation world
 */
export function createMPMWorld(device, options = {}) {
  const gridSize = options.gridSize || [64, 48, 64];
  const [gx, gy, gz] = gridSize;
  const cellCount = gx * gy * gz;
  const maxParticles = options.maxParticles || 100000;
  const workgroupSize = options.workgroupSize || 256;
  
  // Create buffers
  const buffers = createMPMBuffers(device, gridSize, maxParticles);
  
  // Grid velocity buffer (output from grid update, read by G2P)
  const gridVelocityBuffer = device.createBuffer({
    label: "MPM.gridVelocity",
    size: cellCount * 4 * 4, // vec4<f32> per cell
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  
  // MPM params uniform buffer
  const paramsBuffer = device.createBuffer({
    label: "MPM.params",
    size: 48, // 12 floats
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  
  // Create pipelines
  const pipelines = createMPMPipelines(device, { workgroupSize });

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  const p2gBindGroups = new BindGroupSignals(
    device,
    pipelines.p2gPipeline.getBindGroupLayout(0),
    [
      { name: "particlePos", binding: 0 },
      { name: "particleVel", binding: 1 },
      { name: "particleAffine", binding: 2 },
      { name: "gridMass", binding: 3 },
      { name: "gridMomentum", binding: 4 },
      { name: "params", binding: 5 },
    ],
    { label: "MPM.P2G.bindGroup", maxEntries: 64, getBindGroup: externalGetBindGroup }
  );

  const gridUpdateBindGroups = new BindGroupSignals(
    device,
    pipelines.gridUpdatePipeline.getBindGroupLayout(0),
    [
      { name: "gridMassAtomic", binding: 0 },
      { name: "gridMomentumAtomic", binding: 1 },
      { name: "gridVelocity", binding: 2 },
      { name: "params", binding: 3 },
    ],
    { label: "MPM.GridUpdate.bindGroup", maxEntries: 16, getBindGroup: externalGetBindGroup }
  );

  const g2pBindGroups = new BindGroupSignals(
    device,
    pipelines.g2pPipeline.getBindGroupLayout(0),
    [
      { name: "particlePos", binding: 0 },
      { name: "particleVel", binding: 1 },
      { name: "particleAffine", binding: 2 },
      { name: "gridVelocity", binding: 3 },
      { name: "params", binding: 4 },
    ],
    { label: "MPM.G2P.bindGroup", maxEntries: 64, getBindGroup: externalGetBindGroup }
  );
  
  return {
    device,
    gridSize,
    gx, gy, gz,
    cellCount,
    maxParticles,
    workgroupSize,
    ...buffers,
    gridVelocityBuffer,
    paramsBuffer,
    ...pipelines,
    p2gBindGroups,
    gridUpdateBindGroups,
    g2pBindGroups,
    // World bounds (set by caller)
    worldMin: options.worldMin || [-25, -25, -25],
    worldMax: options.worldMax || [25, 25, 25],
    cellSize: 0, // Computed in step
    gravity: options.gravity || 9.8,
  };
}

/**
 * Destroy MPM world
 */
export function destroyMPMWorld(world) {
  if (!world) return;
  destroyMPMBuffers(world);
  world.gridVelocityBuffer?.destroy();
  world.paramsBuffer?.destroy();
}

/**
 * Step the MPM simulation
 * @param {Object} world - MPM world from createMPMWorld
 * @param {Object} particles - Particle system with positionBuffer, velocityBuffer
 * @param {number} dt - Time step
 * @param {Object} options - Additional options
 */
export function stepMPMWorld(world, particles, dt, options = {}) {
  if (!world || !particles || !world.device) return;
  
  const device = world.device;
  const particleCount = particles.instanceCount || 0;
  
  if (particleCount <= 0) return;
  
  // Compute cell size from world bounds
  const worldSize = [
    world.worldMax[0] - world.worldMin[0],
    world.worldMax[1] - world.worldMin[1],
    world.worldMax[2] - world.worldMin[2],
  ];
  const cellSize = Math.max(
    worldSize[0] / world.gx,
    worldSize[1] / world.gy,
    worldSize[2] / world.gz
  );
  world.cellSize = cellSize;
  
  // CFL condition for stability
  const maxDt = cellSize * 0.4; // ~0.4 cells per step max
  const safeDt = Math.min(dt, maxDt);
  
  // Update params buffer
  const paramsData = new Float32Array([
    world.gx,
    world.gy,
    world.gz,
    cellSize,
    world.worldMin[0],
    world.worldMin[1],
    world.worldMin[2],
    particleCount,
    safeDt,
    world.gravity,
    0, 0, // padding
  ]);
  device.queue.writeBuffer(world.paramsBuffer, 0, paramsData);
  
  const encoder = device.createCommandEncoder({ label: "MPM.step" });
  
  // Clear grid accumulation buffers
  encoder.clearBuffer(world.gridMassBuffer);
  encoder.clearBuffer(world.gridMomentumBuffer);
  
  // Create bind groups (recreated each frame since particle buffers may change)
  const p2gBindGroup = world.p2gBindGroups.get({
    particlePos: particles.positionBuffer,
    particleVel: particles.velocityBuffer,
    particleAffine: world.particleAffineBuffer,
    gridMass: world.gridMassBuffer,
    gridMomentum: world.gridMomentumBuffer,
    params: world.paramsBuffer,
  }, "MPM.P2G.bindGroup");
  
  // P2G pass
  const p2gPass = encoder.beginComputePass({ label: "MPM.P2G" });
  p2gPass.setPipeline(world.p2gPipeline);
  p2gPass.setBindGroup(0, p2gBindGroup);
  p2gPass.dispatchWorkgroups(Math.ceil(particleCount / world.workgroupSize));
  p2gPass.end();
  
  // Grid update bind group
  const gridUpdateBindGroup = world.gridUpdateBindGroups.get({
    gridMassAtomic: world.gridMassBuffer,
    gridMomentumAtomic: world.gridMomentumBuffer,
    gridVelocity: world.gridVelocityBuffer,
    params: world.paramsBuffer,
  }, "MPM.GridUpdate.bindGroup");
  
  // Grid update pass
  const gridUpdatePass = encoder.beginComputePass({ label: "MPM.GridUpdate" });
  gridUpdatePass.setPipeline(world.gridUpdatePipeline);
  gridUpdatePass.setBindGroup(0, gridUpdateBindGroup);
  gridUpdatePass.dispatchWorkgroups(Math.ceil(world.cellCount / world.workgroupSize));
  gridUpdatePass.end();
  
  // G2P bind group
  const g2pBindGroup = world.g2pBindGroups.get({
    particlePos: particles.positionBuffer,
    particleVel: particles.velocityBuffer,
    particleAffine: world.particleAffineBuffer,
    gridVelocity: world.gridVelocityBuffer,
    params: world.paramsBuffer,
  }, "MPM.G2P.bindGroup");
  
  // G2P pass
  const g2pPass = encoder.beginComputePass({ label: "MPM.G2P" });
  g2pPass.setPipeline(world.g2pPipeline);
  g2pPass.setBindGroup(0, g2pBindGroup);
  g2pPass.dispatchWorkgroups(Math.ceil(particleCount / world.workgroupSize));
  g2pPass.end();
  
  // Submit
  device.queue.submit([encoder.finish()]);
}

/**
 * Update MPM world bounds
 */
export function setMPMWorldBounds(world, worldMin, worldMax) {
  if (!world) return;
  world.worldMin = [...worldMin];
  world.worldMax = [...worldMax];
}

export default {
  createMPMBuffers,
  destroyMPMBuffers,
  createMPMPipelines,
  createMPMWorld,
  destroyMPMWorld,
  stepMPMWorld,
  setMPMWorldBounds,
  createP2GShader,
  createGridUpdateShader,
  createG2PShader,
};
