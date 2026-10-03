// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleNBody.js - N-Body Gravitational Dynamics (GAP 37)
 * 
 * GPU compute: every particle attracts every other via gravity.
 *   F = G · m₁·m₂ / (r² + ε²)^(3/2)
 * 
 * Direct summation O(N²) — suitable for up to ~100K particles on modern GPUs.
 * Softening parameter ε prevents singularities at close range.
 * Configurable G for different scales (molecular, macro, celestial).
 * 
 * Uses tiled shared-memory approach: each workgroup loads a tile of particles
 * into shared memory, computes interactions, then loads next tile.
 * 
 * Usage:
 *   const nb = createNBodySystem(device, maxParticles);
 *   initNBodyBindGroups(nb, device, positionBuffer, velocityBuffer, metaBuffer);
 *   executeNBody(nb, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// N-BODY COMPUTE SHADER (tiled shared memory)
// ============================================================================

const TILE_SIZE = 128;

const NBODY_SHADER = /* wgsl */`
const TILE_SIZE: u32 = ${TILE_SIZE}u;

struct NBodyParams {
  particleCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,

  G: f32,              // gravitational constant (scaled for sim)
  softening: f32,      // ε: prevents singularities
  dt: f32,
  maxAccel: f32,

  defaultMass: f32,    // used when meta buffer unavailable
  useParticleMass: u32, // 1 = read mass from meta.w packing
  damping: f32,        // velocity damping (1.0 = none, 0.99 = slight)
  _pad3: f32,
};

@group(0) @binding(0) var<uniform> params: NBodyParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> particleMeta: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> thermalData: array<vec4<f32>>; // x=temp, y=phase, z=group|mat, w=latent

// Shared memory tile for positions + masses
var<workgroup> tilePos: array<vec4<f32>, TILE_SIZE>; // xyz = pos, w = mass

fn extractMass(metaW: f32) -> f32 {
  let massEncoded = floor(metaW / 1e8) % 100.0;
  return max(0.1, massEncoded * 0.1);
}

@compute @workgroup_size(${TILE_SIZE})
fn nbodyStep(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wgid: vec3<u32>,
) {
  let idx = gid.x;
  let localIdx = lid.x;
  let N = params.particleCount;

  // Load my particle
  var myPos = vec3<f32>(0.0);
  var myVel = vec3<f32>(0.0);
  var myMass = params.defaultMass;
  var lifetime = 1e6;
  var alive = false;

  if (idx < N) {
    let pos4 = positions[idx];
    let vel4 = velocities[idx];
    myPos = pos4.xyz;
    myVel = vel4.xyz;
    lifetime = vel4.w;
    alive = pos4.w < lifetime;

    // Phase mask: NBody affects solid (0) and plasma (3), NOT liquid (1) or gas (2)
    if (alive) {
      let phase = thermalData[idx].y;
      if (phase > 0.5 && phase < 2.5) { alive = false; } // skip liquid + gas
    }

    if (params.useParticleMass > 0u) {
      myMass = extractMass(particleMeta[idx].w);
    }
  }

  var accel = vec3<f32>(0.0);
  let softSq = params.softening * params.softening;
  let numTiles = (N + TILE_SIZE - 1u) / TILE_SIZE;

  // Tiled loop: process all particles in tiles of TILE_SIZE
  for (var tile = 0u; tile < numTiles; tile++) {
    // Load tile into shared memory
    let loadIdx = tile * TILE_SIZE + localIdx;
    if (loadIdx < N) {
      let p = positions[loadIdx].xyz;
      var m = params.defaultMass;
      if (params.useParticleMass > 0u) {
        m = extractMass(particleMeta[loadIdx].w);
      }
      // Skip dead particles by setting mass to 0
      let lp = positions[loadIdx];
      let lv = velocities[loadIdx];
      let isAlive = lp.w < lv.w;
      tilePos[localIdx] = vec4<f32>(p, select(0.0, m, isAlive));
    } else {
      tilePos[localIdx] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }

    workgroupBarrier();

    // Compute interactions with this tile
    if (alive) {
      for (var j = 0u; j < TILE_SIZE; j++) {
        let globalJ = tile * TILE_SIZE + j;
        if (globalJ >= N || globalJ == idx) { continue; }

        let otherPos = tilePos[j].xyz;
        let otherMass = tilePos[j].w;
        if (otherMass < 0.001) { continue; }

        let diff = otherPos - myPos;
        let distSq = dot(diff, diff) + softSq;
        let invDist = 1.0 / sqrt(distSq);
        let invDist3 = invDist * invDist * invDist;

        // F/m = G · M_other / (r² + ε²)^(3/2) · r̂ · r
        accel += diff * (params.G * otherMass * invDist3);
      }
    }

    workgroupBarrier();
  }

  // Write back
  if (idx < N && alive) {
    // Clamp acceleration
    let accelMag = length(accel);
    if (accelMag > params.maxAccel) {
      accel = accel * (params.maxAccel / accelMag);
    }

    let newVel = (myVel + accel * params.dt) * params.damping;
    velocities[idx] = vec4<f32>(newVel, velocities[idx].w);
  }
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the N-body gravity system.
 */
export function createNBodySystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'NBody.shader', code: NBODY_SHADER,
  });
  const pipeline = device.createComputePipeline({
    label: 'NBody.pipeline', layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'nbodyStep' },
  });

  const paramsBuffer = createUniformBuffer(device, 48, { label: 'NBody.params' });
  labelResource(paramsBuffer, 'NBody.params');

  return {
    device, pipeline, paramsBuffer,
    bindGroup: null,
    maxParticles,
    // Tuning
    G: 1.0,             // gravitational constant (game-scale)
    softening: 0.5,     // prevents singularity
    maxAccel: 100.0,
    defaultMass: 1.0,
    useParticleMass: true,
    damping: 1.0,       // 1.0 = no damping
  };
}

/**
 * Initialize bind groups.
 */
export function initNBodyBindGroups(system, device, positionBuffer, velocityBuffer, metaBuffer, thermalBuffer) {
  system.bindGroup = device.createBindGroup({
    label: 'NBody.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: metaBuffer } },
      { binding: 4, resource: { buffer: thermalBuffer } },
    ],
  });
}

/**
 * Set N-body parameters at runtime.
 */
export function setNBodyParams(system, config) {
  if (!system) return;
  if (config.G !== undefined) system.G = config.G;
  if (config.softening !== undefined) system.softening = config.softening;
  if (config.maxAccel !== undefined) system.maxAccel = config.maxAccel;
  if (config.defaultMass !== undefined) system.defaultMass = config.defaultMass;
  if (config.useParticleMass !== undefined) system.useParticleMass = config.useParticleMass;
  if (config.damping !== undefined) system.damping = config.damping;
}

const _nbBuf = new ArrayBuffer(48);
const _nbU32 = new Uint32Array(_nbBuf);
const _nbF32 = new Float32Array(_nbBuf);

/**
 * Execute the N-body compute pass.
 */
export function executeNBody(system, device, particleCount, dt, options = {}) {
  if (!system?.bindGroup || particleCount === 0) return null;

  _nbU32[0] = particleCount;
  _nbU32[1] = 0; _nbU32[2] = 0; _nbU32[3] = 0;
  _nbF32[4] = system.G;
  _nbF32[5] = system.softening;
  _nbF32[6] = dt;
  _nbF32[7] = system.maxAccel;
  _nbF32[8] = system.defaultMass;
  _nbU32[9] = system.useParticleMass ? 1 : 0;
  _nbF32[10] = system.damping;
  _nbF32[11] = 0;

  device.queue.writeBuffer(system.paramsBuffer, 0, new Uint8Array(_nbBuf));

  const externalEncoder = options.encoder || null;
  const encoder = externalEncoder || device.createCommandEncoder({ label: 'NBody.step' });
  const pass = encoder.beginComputePass({ label: 'NBody.step' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / TILE_SIZE));
  pass.end();
  if (!externalEncoder) device.queue.submit([encoder.finish()]);
  system.lastExecution = Object.freeze({
    backend: 'direct',
    particleCount,
    passCount: 1,
    encoded: true,
    submitted: !externalEncoder,
  });
  return system.lastExecution;
}

/**
 * Destroy.
 */
export function destroyNBodySystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  system.bindGroup = null;
}
