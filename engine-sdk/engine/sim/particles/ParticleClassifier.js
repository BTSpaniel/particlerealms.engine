// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleClassifier.js - GPU Particle Classification for Fluid Rendering
 * 
 * Classifies each liquid particle into categories based on SPH density and velocity.
 * Used by renderers to route particles to different visual styles:
 *   - Bulk fluid → SSFR surface rendering (smooth continuous surface)
 *   - Surface → SSFR + edge highlight
 *   - Spray → Small SDF billboard with fading alpha
 *   - Foam → White-tinted SDF billboard on surface
 *   - Bubble → Tiny transparent rising sphere
 * 
 * Output: per-particle u32 classification buffer (binding for vertex shaders).
 * 
 * Classification IDs:
 *   0 = unclassified / non-liquid
 *   1 = bulk (dense interior)
 *   2 = surface (boundary)
 *   3 = spray (isolated, fast)
 *   4 = foam (isolated, slow, near surface)
 *   5 = bubble (isolated, rising)
 * 
 * Usage:
 *   const cls = createClassifierSystem(device, maxParticles);
 *   initClassifierBindGroups(cls, device, posBuffer, velBuffer, thermalBuffer, sphDensityBuffer);
 *   executeClassifier(cls, device, particleCount);
 *   // cls.classBuffer is a storage buffer readable by vertex shaders
 */

import { createStorageBuffer, createUniformBuffer } from "../../core/gpu/GpuBuffer.js";

// Classification constants (must match shader)
export const CLASS_NONE    = 0;
export const CLASS_BULK    = 1;
export const CLASS_SURFACE = 2;
export const CLASS_SPRAY   = 3;
export const CLASS_FOAM    = 4;
export const CLASS_BUBBLE  = 5;

const CLASSIFIER_SHADER = /* wgsl */`
struct ClassParams {
  particleCount: u32,
  restDensity: f32,       // SPH rest density (e.g. 1000 for water)
  sprayDensityThresh: f32, // below this = spray/foam/bubble (fraction of rest)
  surfaceDensityThresh: f32, // below this = surface (fraction of rest)
  spraySpeedThresh: f32,   // above this speed + low density = spray
  foamSpeedThresh: f32,    // below this speed + low density = foam
  bubbleRiseThresh: f32,   // positive vy above this = bubble
  _pad: f32,
};

@group(0) @binding(0) var<uniform> params: ClassParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;     // xyz=pos, w=age
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;    // xyz=vel, w=lifetime
@group(0) @binding(3) var<storage, read> thermalData: array<vec4<f32>>;   // x=temp, y=phase, z=group|mat, w=latent
@group(0) @binding(4) var<storage, read> sphDensity: array<vec2<f32>>;    // x=density, y=pressure
@group(0) @binding(5) var<storage, read_write> classification: array<u32>; // output per-particle class

const CLASS_NONE: u32    = 0u;
const CLASS_BULK: u32    = 1u;
const CLASS_SURFACE: u32 = 2u;
const CLASS_SPRAY: u32   = 3u;
const CLASS_FOAM: u32    = 4u;
const CLASS_BUBBLE: u32  = 5u;

@compute @workgroup_size(64)
fn classify(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  let age = pos4.w;
  let lifetime = vel4.w;

  // Dead particle
  if (age >= lifetime) {
    classification[idx] = CLASS_NONE;
    return;
  }

  // Phase check: only classify liquid particles
  let phase = thermalData[idx].y;
  if (phase < 0.5 || phase > 1.5) {
    classification[idx] = CLASS_NONE;
    return;
  }

  let density = sphDensity[idx].x;
  let velocity = vel4.xyz;
  let speed = length(velocity);
  let densityRatio = density / params.restDensity;

  // Classification logic based on density ratio and velocity
  if (densityRatio < params.sprayDensityThresh) {
    // Very isolated particle — spray, foam, or bubble
    if (speed > params.spraySpeedThresh) {
      classification[idx] = CLASS_SPRAY;
    } else if (velocity.y > params.bubbleRiseThresh) {
      classification[idx] = CLASS_BUBBLE;
    } else {
      classification[idx] = CLASS_FOAM;
    }
  } else if (densityRatio < params.surfaceDensityThresh) {
    // Moderate density — surface particle
    classification[idx] = CLASS_SURFACE;
  } else {
    // High density — bulk interior
    classification[idx] = CLASS_BULK;
  }
}
`;

/**
 * Create the classifier system.
 */
export function createClassifierSystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'ParticleClassifier.shader',
    code: CLASSIFIER_SHADER,
  });

  const pipeline = device.createComputePipeline({
    label: 'ParticleClassifier.pipeline',
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'classify' },
  });

  const paramsBuffer = createUniformBuffer(device, 32, { label: 'ParticleClassifier.params' });

  // Per-particle classification output (u32 per particle)
  const classBuffer = device.createBuffer({
    label: 'ParticleClassifier.output',
    size: maxParticles * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  return {
    device,
    pipeline,
    paramsBuffer,
    classBuffer,
    bindGroup: null,
    maxParticles,
    // Tuning (fractions of rest density)
    restDensity: 1000.0,
    sprayDensityThresh: 0.3,    // below 30% rest density = spray/foam/bubble
    surfaceDensityThresh: 0.8,  // below 80% = surface, above = bulk
    spraySpeedThresh: 3.0,      // fast isolated = spray
    foamSpeedThresh: 0.5,       // slow isolated = foam
    bubbleRiseThresh: 1.0,      // rising isolated = bubble
  };
}

/**
 * Initialize bind groups.
 */
export function initClassifierBindGroups(system, device, positionBuffer, velocityBuffer, thermalBuffer, sphDensityBuffer) {
  system.bindGroup = device.createBindGroup({
    label: 'ParticleClassifier.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: thermalBuffer } },
      { binding: 4, resource: { buffer: sphDensityBuffer } },
      { binding: 5, resource: { buffer: system.classBuffer } },
    ],
  });
}

// Reusable typed arrays for params upload
const _clsParamsBuf = new ArrayBuffer(32);
const _clsU32 = new Uint32Array(_clsParamsBuf);
const _clsF32 = new Float32Array(_clsParamsBuf);

/**
 * Execute the classification compute pass.
 */
export function executeClassifier(system, device, particleCount) {
  if (!system?.bindGroup || particleCount === 0) return;

  _clsU32[0] = particleCount;
  _clsF32[1] = system.restDensity;
  _clsF32[2] = system.sprayDensityThresh;
  _clsF32[3] = system.surfaceDensityThresh;
  _clsF32[4] = system.spraySpeedThresh;
  _clsF32[5] = system.foamSpeedThresh;
  _clsF32[6] = system.bubbleRiseThresh;
  _clsF32[7] = 0; // pad

  device.queue.writeBuffer(system.paramsBuffer, 0, new Uint8Array(_clsParamsBuf));

  const encoder = device.createCommandEncoder({ label: 'ParticleClassifier' });
  const pass = encoder.beginComputePass({ label: 'ParticleClassifier' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Get the classification buffer for use by renderers.
 */
export function getClassificationBuffer(system) {
  return system?.classBuffer || null;
}

/**
 * Update classifier thresholds at runtime.
 */
export function setClassifierParams(system, config) {
  if (!system) return;
  if (config.restDensity !== undefined) system.restDensity = config.restDensity;
  if (config.sprayDensityThresh !== undefined) system.sprayDensityThresh = config.sprayDensityThresh;
  if (config.surfaceDensityThresh !== undefined) system.surfaceDensityThresh = config.surfaceDensityThresh;
  if (config.spraySpeedThresh !== undefined) system.spraySpeedThresh = config.spraySpeedThresh;
  if (config.foamSpeedThresh !== undefined) system.foamSpeedThresh = config.foamSpeedThresh;
  if (config.bubbleRiseThresh !== undefined) system.bubbleRiseThresh = config.bubbleRiseThresh;
}

/**
 * Destroy classifier system.
 */
export function destroyClassifierSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  if (system.classBuffer) system.classBuffer.destroy();
  system.bindGroup = null;
}
