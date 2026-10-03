// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleFlocking.js - GPU Flocking / Boids System (GAP 27)
 * 
 * Dedicated GPU compute shader implementing classic boid rules:
 *   1. Separation — steer away from nearby neighbors
 *   2. Alignment — match velocity direction of nearby neighbors
 *   3. Cohesion — steer toward center of mass of nearby neighbors
 *   4. Goal seeking — steer toward target position(s)
 *   5. Obstacle avoidance — steer away from repulsion points
 *   6. Speed regulation — maintain target speed range
 * 
 * Uses the NeighborGrid (GAP 25) for O(N) spatial queries instead of O(N²).
 * Each force has independent radius + weight for fine-tuned behavior.
 * 
 * Matches PopcornFX CParticleEvolver_Flocking.
 * 
 * Usage:
 *   const flock = createFlockingSystem(device, maxParticles);
 *   initFlockingBindGroups(flock, device, positionBuffer, velocityBuffer, gridBuffers);
 *   setFlockingParams(flock, { separationWeight: 1.5, alignmentWeight: 1.0, ... });
 *   // Each frame (after neighbor grid is built):
 *   executeFlocking(flock, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// FLOCKING COMPUTE SHADER
// ============================================================================

const FLOCKING_SHADER = /* wgsl */`
struct FlockParams {
  particleCount: u32,
  maxNeighborsPerCell: u32,
  gridDimX: u32,
  gridDimY: u32,

  gridDimZ: u32,
  numBuckets: u32,
  _pad1: u32,
  _pad2: u32,

  worldMin: vec3<f32>,
  cellSize: f32,

  separationWeight: f32,
  separationRadius: f32,
  alignmentWeight: f32,
  alignmentRadius: f32,

  cohesionWeight: f32,
  cohesionRadius: f32,
  goalWeight: f32,
  avoidWeight: f32,

  goalPos: vec3<f32>,
  targetSpeed: f32,

  maxSteerForce: f32,
  speedRegWeight: f32,
  dt: f32,
  _pad3: f32,
};

@group(0) @binding(0) var<uniform> params: FlockParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(4) var<storage, read> cellEntries: array<u32>;

fn worldToCell(pos: vec3<f32>) -> vec3<i32> {
  let rel = pos - params.worldMin;
  return vec3<i32>(floor(rel / params.cellSize));
}

fn cellIndex(cx: i32, cy: i32, cz: i32) -> u32 {
  if (cx < 0 || cy < 0 || cz < 0) { return 0xFFFFFFFFu; }
  let ux = u32(cx); let uy = u32(cy); let uz = u32(cz);
  if (ux >= params.gridDimX || uy >= params.gridDimY || uz >= params.gridDimZ) { return 0xFFFFFFFFu; }
  let flat = uz * params.gridDimX * params.gridDimY + uy * params.gridDimX + ux;
  return flat % params.numBuckets;
}

fn limitVec(v: vec3<f32>, maxMag: f32) -> vec3<f32> {
  let mag = length(v);
  if (mag > maxMag && mag > 0.001) {
    return v * (maxMag / mag);
  }
  return v;
}

@compute @workgroup_size(64)
fn flockingStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  let age = pos4.w;
  let lifetime = vel4.w;
  if (age >= lifetime) { return; } // skip dead

  let myPos = pos4.xyz;
  let myVel = vel4.xyz;
  let cell = worldToCell(myPos);

  // Accumulators
  var sepForce = vec3<f32>(0.0);
  var alignSum = vec3<f32>(0.0);
  var cohesionSum = vec3<f32>(0.0);
  var sepCount = 0u;
  var alignCount = 0u;
  var cohesionCount = 0u;

  let sepRadSq = params.separationRadius * params.separationRadius;
  let alignRadSq = params.alignmentRadius * params.alignmentRadius;
  let cohRadSq = params.cohesionRadius * params.cohesionRadius;
  let maxRad = max(params.separationRadius, max(params.alignmentRadius, params.cohesionRadius));
  let searchRange = i32(ceil(maxRad / params.cellSize));

  // Query 27-cell (or larger) neighborhood
  for (var dz = -searchRange; dz <= searchRange; dz++) {
    for (var dy = -searchRange; dy <= searchRange; dy++) {
      for (var dx = -searchRange; dx <= searchRange; dx++) {
        let ci = cellIndex(cell.x + dx, cell.y + dy, cell.z + dz);
        if (ci == 0xFFFFFFFFu) { continue; }

        let count = min(cellCounts[ci], params.maxNeighborsPerCell);
        let base = ci * params.maxNeighborsPerCell;

        for (var k = 0u; k < count; k++) {
          let j = cellEntries[base + k];
          if (j == 0xFFFFFFFFu || j == idx) { continue; }

          let otherPos = positions[j].xyz;
          let otherVel = velocities[j].xyz;
          let diff = myPos - otherPos;
          let distSq = dot(diff, diff);

          // Separation
          if (distSq < sepRadSq && distSq > 0.0001) {
            let dist = sqrt(distSq);
            sepForce += diff / dist / dist; // inverse distance weighting
            sepCount++;
          }

          // Alignment
          if (distSq < alignRadSq) {
            alignSum += otherVel;
            alignCount++;
          }

          // Cohesion
          if (distSq < cohRadSq) {
            cohesionSum += otherPos;
            cohesionCount++;
          }
        }
      }
    }
  }

  var steer = vec3<f32>(0.0);

  // Separation: steer away from neighbors
  if (sepCount > 0u) {
    sepForce = sepForce / f32(sepCount);
    steer += limitVec(sepForce, params.maxSteerForce) * params.separationWeight;
  }

  // Alignment: match neighbor velocity direction
  if (alignCount > 0u) {
    let avgVel = alignSum / f32(alignCount);
    let alignSteer = avgVel - myVel;
    steer += limitVec(alignSteer, params.maxSteerForce) * params.alignmentWeight;
  }

  // Cohesion: steer toward center of mass
  if (cohesionCount > 0u) {
    let centerOfMass = cohesionSum / f32(cohesionCount);
    let cohesionSteer = centerOfMass - myPos;
    steer += limitVec(cohesionSteer, params.maxSteerForce) * params.cohesionWeight;
  }

  // Goal seeking: steer toward target position
  if (params.goalWeight > 0.001) {
    let toGoal = params.goalPos - myPos;
    steer += limitVec(toGoal, params.maxSteerForce) * params.goalWeight;
  }

  // Speed regulation: maintain target speed
  let currentSpeed = length(myVel);
  if (params.speedRegWeight > 0.001 && currentSpeed > 0.01) {
    let speedDiff = params.targetSpeed - currentSpeed;
    let speedSteer = normalize(myVel) * speedDiff;
    steer += speedSteer * params.speedRegWeight;
  }

  // Apply steering force
  let newVel = myVel + limitVec(steer, params.maxSteerForce) * params.dt;
  velocities[idx] = vec4<f32>(newVel, vel4.w);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the flocking system.
 * @param {GPUDevice} device
 * @param {number} maxParticles
 */
export function createFlockingSystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'Flocking.shader', code: FLOCKING_SHADER,
  });

  const pipeline = device.createComputePipeline({
    label: 'Flocking.pipeline', layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'flockingStep' },
  });

  // Params: 112 bytes (28 floats, aligned)
  const paramsBuffer = createUniformBuffer(device, 128, { label: 'Flocking.params' });
  labelResource(paramsBuffer, 'Flocking.params');

  return {
    device,
    pipeline,
    paramsBuffer,
    bindGroup: null,
    maxParticles,
    // Default parameters
    separationWeight: 1.5,
    separationRadius: 1.0,
    alignmentWeight: 1.0,
    alignmentRadius: 2.0,
    cohesionWeight: 1.0,
    cohesionRadius: 2.5,
    goalWeight: 0.3,
    avoidWeight: 1.0,
    goalPos: [0, 5, 0],
    targetSpeed: 3.0,
    maxSteerForce: 5.0,
    speedRegWeight: 0.5,
  };
}

/**
 * Initialize bind groups. Requires neighbor grid buffers.
 */
export function initFlockingBindGroups(system, device, positionBuffer, velocityBuffer, gridBuffers) {
  system.bindGroup = device.createBindGroup({
    label: 'Flocking.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: gridBuffers.cellCountsBuffer } },
      { binding: 4, resource: { buffer: gridBuffers.cellEntriesBuffer } },
    ],
  });

  // Store grid info for params upload
  system._gridDimX = gridBuffers.gridDimX;
  system._gridDimY = gridBuffers.gridDimY;
  system._gridDimZ = gridBuffers.gridDimZ;
  system._cellSize = gridBuffers.cellSize;
  system._maxNeighbors = gridBuffers.maxNeighbors;
  system._numBuckets = gridBuffers.numBuckets;
  system._worldMin = gridBuffers.worldMin || [-50, -50, -50];
}

/**
 * Update flocking parameters.
 */
export function setFlockingParams(system, params) {
  if (!system) return;
  const keys = [
    'separationWeight', 'separationRadius', 'alignmentWeight', 'alignmentRadius',
    'cohesionWeight', 'cohesionRadius', 'goalWeight', 'avoidWeight',
    'goalPos', 'targetSpeed', 'maxSteerForce', 'speedRegWeight',
  ];
  for (const k of keys) {
    if (params[k] !== undefined) system[k] = params[k];
  }
}

const _flockParamsData = new ArrayBuffer(128);
const _flockU32 = new Uint32Array(_flockParamsData);
const _flockF32 = new Float32Array(_flockParamsData);

/**
 * Execute the flocking compute pass.
 */
export function executeFlocking(system, device, particleCount, dt) {
  if (!system?.bindGroup || particleCount === 0) return;

  // Upload params
  _flockU32[0] = particleCount;
  _flockU32[1] = system._maxNeighbors || 16;
  _flockU32[2] = system._gridDimX || 50;
  _flockU32[3] = system._gridDimY || 50;

  _flockU32[4] = system._gridDimZ || 50;
  _flockU32[5] = system._numBuckets || 100000;
  _flockU32[6] = 0;
  _flockU32[7] = 0;

  const wm = system._worldMin || [-50, -50, -50];
  _flockF32[8]  = wm[0];
  _flockF32[9]  = wm[1];
  _flockF32[10] = wm[2];
  _flockF32[11] = system._cellSize || 2.0;

  _flockF32[12] = system.separationWeight;
  _flockF32[13] = system.separationRadius;
  _flockF32[14] = system.alignmentWeight;
  _flockF32[15] = system.alignmentRadius;

  _flockF32[16] = system.cohesionWeight;
  _flockF32[17] = system.cohesionRadius;
  _flockF32[18] = system.goalWeight;
  _flockF32[19] = system.avoidWeight;

  _flockF32[20] = system.goalPos[0];
  _flockF32[21] = system.goalPos[1];
  _flockF32[22] = system.goalPos[2];
  _flockF32[23] = system.targetSpeed;

  _flockF32[24] = system.maxSteerForce;
  _flockF32[25] = system.speedRegWeight;
  _flockF32[26] = dt;
  _flockF32[27] = 0;

  device.queue.writeBuffer(system.paramsBuffer, 0, _flockParamsData);

  const encoder = device.createCommandEncoder({ label: 'Flocking.step' });
  const pass = encoder.beginComputePass({ label: 'Flocking.step' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Destroy the system.
 */
export function destroyFlockingSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  system.bindGroup = null;
}
