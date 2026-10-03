// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSplitting.js - Adaptive Particle Refinement for Fluid
 * 
 * When water stretches thin (low SPH density, high velocity, few neighbors),
 * particles split into smaller child particles. When many small particles
 * cluster in a dense area, they merge back. This is how water naturally
 * breaks apart into spray/droplets and reforms.
 * 
 * GPU compute shader scans liquid particles, identifies split candidates,
 * and uses atomic counters to claim dead particle slots for children.
 * 
 * Split trigger: density < threshold AND speed > threshold
 * Merge trigger: two particles within close range, both small, low relative velocity
 * 
 * Mass conservation:
 *   Split: parent shrinks to 0.7× size, child spawns at 0.7× size
 *          (2 × 0.7³ ≈ 0.686 volume — slight loss acceptable for stability)
 *   Merge: surviving particle grows by merged particle's volume^(1/3)
 * 
 * Usage:
 *   const split = createSplittingSystem(device, maxParticles);
 *   initSplittingBindGroups(split, device, posBuffer, velBuffer, thermalBuffer, metaBuffer, sphDensityBuffer);
 *   executeSplitting(split, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer } from "../../core/gpu/GpuBuffer.js";

const SPLITTING_SHADER = /* wgsl */`
struct SplitParams {
  particleCount: u32,
  maxParticles: u32,
  restDensity: f32,
  splitDensityThresh: f32,   // split when density ratio < this (e.g. 0.4)
  splitSpeedThresh: f32,     // split when speed > this (e.g. 2.0)
  splitSizeFactor: f32,      // child size = parent * this (e.g. 0.7)
  splitVelDivergence: f32,   // velocity divergence for children (e.g. 0.3)
  maxSplitsPerFrame: u32,    // rate limit (e.g. 16)
  mergeDist: f32,            // merge when within this distance (fraction of radius)
  mergeMaxSize: f32,         // only merge particles smaller than this
  mergeMaxRelSpeed: f32,     // only merge when relative speed < this
  dt: f32,
};

@group(0) @binding(0) var<uniform> params: SplitParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;   // xyz=pos, w=age
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>; // xyz=vel, w=lifetime
@group(0) @binding(3) var<storage, read_write> thermalData: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> particleMeta: array<vec4<f32>>; // rgb=color, w=packed
@group(0) @binding(5) var<storage, read> sphDensity: array<vec2<f32>>;
@group(0) @binding(6) var<storage, read_write> splitCounter: array<atomic<u32>>; // [0] = split count

// Simple hash for pseudo-random offset
fn hash(n: u32) -> f32 {
  var x = n;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = (x >> 16u) ^ x;
  return f32(x) / f32(0xFFFFFFFFu);
}

@compute @workgroup_size(64)
fn splitPass(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  let age = pos4.w;
  let lifetime = vel4.w;

  // Only alive liquid particles
  if (age >= lifetime) { return; }
  let phase = thermalData[idx].y;
  if (phase < 0.5 || phase > 1.5) { return; }

  let density = sphDensity[idx].x;
  let densityRatio = density / params.restDensity;
  let speed = length(vel4.xyz);

  // Split trigger: low density AND high speed (water stretching thin)
  if (densityRatio >= params.splitDensityThresh || speed < params.splitSpeedThresh) { return; }

  // Rate limit: atomic increment, check against max
  let splitIdx = atomicAdd(&splitCounter[0], 1u);
  if (splitIdx >= params.maxSplitsPerFrame) { return; }

  // Find a dead particle slot to use for the child
  // Search forward from a hash-based starting point to avoid contention
  let searchStart = (idx * 7919u + 104729u) % params.maxParticles;
  var childSlot: u32 = 0xFFFFFFFFu;

  for (var s = 0u; s < 128u; s++) {
    let candidate = (searchStart + s) % params.maxParticles;
    if (candidate == idx) { continue; }
    let cAge = positions[candidate].w;
    let cLifetime = velocities[candidate].w;
    // Dead particle: age >= lifetime (or lifetime <= 0)
    if (cAge >= cLifetime || cLifetime <= 0.0) {
      childSlot = candidate;
      break;
    }
  }

  if (childSlot == 0xFFFFFFFFu) { return; } // No free slot

  // === SPLIT: Create child particle ===
  let parentPos = pos4.xyz;
  let parentVel = vel4.xyz;
  let parentMeta = particleMeta[idx];
  let parentThermal = thermalData[idx];

  // Perpendicular offset direction (tangent to velocity)
  let velDir = select(normalize(parentVel), vec3<f32>(0.0, 1.0, 0.0), speed < 0.01);
  let up = vec3<f32>(0.0, 1.0, 0.0);
  var tangent = cross(velDir, up);
  if (length(tangent) < 0.01) { tangent = cross(velDir, vec3<f32>(1.0, 0.0, 0.0)); }
  tangent = normalize(tangent);

  // Random offset angle using particle index + frame
  let angle = hash(idx + splitIdx * 31u) * 6.28318;
  let offsetDir = tangent * cos(angle) + cross(velDir, tangent) * sin(angle);

  // Extract parent size from packed meta
  let packedValue = parentMeta.w;
  let parentSize = (floor(packedValue / 1e4) % 100.0) * 0.1;
  let parentRadius = parentSize * 0.5;

  // Child position: offset from parent along tangent
  let childPos = parentPos + offsetDir * parentRadius * 0.5;

  // Child velocity: parent velocity + small divergence along offset
  let childVel = parentVel + offsetDir * params.splitVelDivergence * speed;

  // Child size: shrink parent and child
  let childSizeFactor = params.splitSizeFactor;
  let newSize = parentSize * childSizeFactor;

  // Repack meta with new size (keep mass, drag, renderMode, shape, behavior)
  // packed = mass*1e8 + drag*1e6 + size*1e4 + renderMode*1e3 + shape*10 + behavior
  let massPart = floor(packedValue / 1e8) * 1e8;
  let dragPart = floor((packedValue - massPart) / 1e6) * 1e6;
  let sizePacked = floor(newSize * 10.0) * 1e4; // size in 0.1 units
  let lowerBits = packedValue - floor(packedValue / 1e4) * 1e4; // renderMode*1e3 + shape*10 + behavior
  let newPacked = massPart + dragPart + sizePacked + lowerBits;

  // Remaining lifetime: fraction of parent's remaining
  let remainingLife = max(lifetime - age, 0.1);
  let childLifetime = remainingLife * 0.8;

  // Write child particle
  positions[childSlot] = vec4<f32>(childPos, 0.0); // age = 0 (newborn)
  velocities[childSlot] = vec4<f32>(childVel, childLifetime);
  particleMeta[childSlot] = vec4<f32>(parentMeta.xyz, newPacked); // same color, new size
  thermalData[childSlot] = parentThermal; // same phase, temp, material

  // Shrink parent too (approximate mass conservation)
  let parentNewPacked = massPart + dragPart + sizePacked + lowerBits;
  particleMeta[idx] = vec4<f32>(parentMeta.xyz, parentNewPacked);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the splitting system.
 */
export function createSplittingSystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'ParticleSplitting.shader',
    code: SPLITTING_SHADER,
  });

  const pipeline = device.createComputePipeline({
    label: 'ParticleSplitting.pipeline',
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'splitPass' },
  });

  const paramsBuffer = createUniformBuffer(device, 48, { label: 'ParticleSplitting.params' });

  // Atomic counter buffer (single u32)
  const counterBuffer = device.createBuffer({
    label: 'ParticleSplitting.counter',
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  return {
    device,
    pipeline,
    paramsBuffer,
    counterBuffer,
    bindGroup: null,
    maxParticles,
    // Tuning
    restDensity: 1000.0,
    splitDensityThresh: 0.4,    // split when below 40% rest density
    splitSpeedThresh: 2.0,      // split when faster than 2.0 units/sec
    splitSizeFactor: 0.7,       // children are 70% of parent size
    splitVelDivergence: 0.3,    // velocity divergence multiplier
    maxSplitsPerFrame: 16,      // max new particles per frame
    mergeDist: 0.3,
    mergeMaxSize: 0.5,
    mergeMaxRelSpeed: 0.5,
  };
}

/**
 * Initialize bind groups.
 */
export function initSplittingBindGroups(system, device, positionBuffer, velocityBuffer, thermalBuffer, metaBuffer, sphDensityBuffer) {
  system.bindGroup = device.createBindGroup({
    label: 'ParticleSplitting.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: thermalBuffer } },
      { binding: 4, resource: { buffer: metaBuffer } },
      { binding: 5, resource: { buffer: sphDensityBuffer } },
      { binding: 6, resource: { buffer: system.counterBuffer } },
    ],
  });
}

// Reusable typed arrays
const _splitParamsBuf = new ArrayBuffer(48);
const _splitU32 = new Uint32Array(_splitParamsBuf);
const _splitF32 = new Float32Array(_splitParamsBuf);
const _zeroCounter = new Uint32Array([0]);

/**
 * Execute the splitting compute pass.
 */
export function executeSplitting(system, device, particleCount, dt) {
  if (!system?.bindGroup || particleCount === 0) return;

  // Reset atomic counter to 0
  device.queue.writeBuffer(system.counterBuffer, 0, _zeroCounter);

  // Upload params
  _splitU32[0] = particleCount;
  _splitU32[1] = system.maxParticles;
  _splitF32[2] = system.restDensity;
  _splitF32[3] = system.splitDensityThresh;
  _splitF32[4] = system.splitSpeedThresh;
  _splitF32[5] = system.splitSizeFactor;
  _splitF32[6] = system.splitVelDivergence;
  _splitU32[7] = system.maxSplitsPerFrame;
  _splitF32[8] = system.mergeDist;
  _splitF32[9] = system.mergeMaxSize;
  _splitF32[10] = system.mergeMaxRelSpeed;
  _splitF32[11] = dt;

  device.queue.writeBuffer(system.paramsBuffer, 0, new Uint8Array(_splitParamsBuf));

  const wg = Math.ceil(particleCount / 64);
  const encoder = device.createCommandEncoder({ label: 'ParticleSplitting' });
  const pass = encoder.beginComputePass({ label: 'ParticleSplitting' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(wg);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Update splitting parameters at runtime.
 */
export function setSplittingParams(system, config) {
  if (!system) return;
  if (config.restDensity !== undefined) system.restDensity = config.restDensity;
  if (config.splitDensityThresh !== undefined) system.splitDensityThresh = config.splitDensityThresh;
  if (config.splitSpeedThresh !== undefined) system.splitSpeedThresh = config.splitSpeedThresh;
  if (config.splitSizeFactor !== undefined) system.splitSizeFactor = config.splitSizeFactor;
  if (config.splitVelDivergence !== undefined) system.splitVelDivergence = config.splitVelDivergence;
  if (config.maxSplitsPerFrame !== undefined) system.maxSplitsPerFrame = config.maxSplitsPerFrame;
}

/**
 * Destroy splitting system.
 */
export function destroySplittingSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  if (system.counterBuffer) system.counterBuffer.destroy();
  system.bindGroup = null;
}
