// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSDFAttraction.js - SDF Attraction/Repulsion Force (GAP 15)
 * 
 * Attract or repel particles toward/from SDF surfaces.
 * Unlike SDF collision (hard boundary), this applies a smooth force field
 * based on signed distance, so particles orbit, hover near, or flee from surfaces.
 * 
 * Force = -gradient(SDF) × strength / (|SDF| + softness)
 * 
 * Modes:
 *   - attract: particles pulled toward surface (strength > 0)
 *   - repel: particles pushed away from surface (strength < 0)
 *   - orbit: attract + tangential velocity (strength > 0, orbitalFactor > 0)
 *   - surface-lock: very strong attraction with damping (particles stick to surface)
 * 
 * Uses a GPU compute shader that evaluates SDF primitives and applies forces.
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// WGSL COMPUTE SHADER
// ============================================================================

const SDF_ATTRACTION_SHADER = /* wgsl */`
struct Params {
  particleCount: u32,
  attractorCount: u32,
  dt: f32,
  time: f32,
};

struct SDFAttractor {
  center: vec3<f32>,
  radius: f32,
  strength: f32,       // positive = attract, negative = repel
  softness: f32,       // prevents singularity at surface (default 0.1)
  orbitalFactor: f32,  // tangential velocity multiplier (0 = direct, 1 = full orbit)
  damping: f32,        // velocity damping near surface (0-1, 0 = none)
  halfExtents: vec3<f32>, // for box SDF
  sdfType: u32,        // 0=sphere, 1=box, 2=torus, 3=cylinder
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> attractors: array<SDFAttractor>;
@group(0) @binding(2) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;

// SDF primitives
fn sdfSphere(p: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {
  return length(p - center) - radius;
}

fn sdfBox(p: vec3<f32>, center: vec3<f32>, halfExtents: vec3<f32>) -> f32 {
  let d = abs(p - center) - halfExtents;
  return length(max(d, vec3<f32>(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

fn sdfTorus(p: vec3<f32>, center: vec3<f32>, majorR: f32, minorR: f32) -> f32 {
  let q = p - center;
  let q2 = vec2<f32>(length(vec2<f32>(q.x, q.z)) - majorR, q.y);
  return length(q2) - minorR;
}

fn sdfCylinder(p: vec3<f32>, center: vec3<f32>, radius: f32, halfHeight: f32) -> f32 {
  let q = p - center;
  let d = abs(vec2<f32>(length(vec2<f32>(q.x, q.z)), q.y)) - vec2<f32>(radius, halfHeight);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}

fn evaluateSDF(p: vec3<f32>, attractor: SDFAttractor) -> f32 {
  switch(attractor.sdfType) {
    case 1u: { return sdfBox(p, attractor.center, attractor.halfExtents); }
    case 2u: { return sdfTorus(p, attractor.center, attractor.radius, attractor.halfExtents.x); }
    case 3u: { return sdfCylinder(p, attractor.center, attractor.radius, attractor.halfExtents.y); }
    default: { return sdfSphere(p, attractor.center, attractor.radius); }
  }
}

// Numerical gradient of SDF (points away from surface)
fn sdfGradient(p: vec3<f32>, attractor: SDFAttractor) -> vec3<f32> {
  let eps = 0.05;
  let dx = evaluateSDF(p + vec3<f32>(eps, 0.0, 0.0), attractor) - evaluateSDF(p - vec3<f32>(eps, 0.0, 0.0), attractor);
  let dy = evaluateSDF(p + vec3<f32>(0.0, eps, 0.0), attractor) - evaluateSDF(p - vec3<f32>(0.0, eps, 0.0), attractor);
  let dz = evaluateSDF(p + vec3<f32>(0.0, 0.0, eps), attractor) - evaluateSDF(p - vec3<f32>(0.0, 0.0, eps), attractor);
  let grad = vec3<f32>(dx, dy, dz);
  let len = length(grad);
  if (len < 0.001) { return vec3<f32>(0.0, 1.0, 0.0); }
  return grad / len;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos = positions[idx];
  var vel = velocities[idx];

  // Skip dead particles
  let age = pos.w;
  let lifetime = vel.w;
  if (age >= lifetime) { return; }

  let p = pos.xyz;
  var totalForce = vec3<f32>(0.0);
  var totalDamping = 0.0;

  for (var i = 0u; i < params.attractorCount; i++) {
    let attractor = attractors[i];
    let dist = evaluateSDF(p, attractor);
    let gradient = sdfGradient(p, attractor);

    // Force magnitude: inversely proportional to distance, with softness preventing singularity
    let absDist = abs(dist) + attractor.softness;
    let forceMag = attractor.strength / (absDist * absDist);

    // Attraction force (toward surface = against gradient when outside, with gradient when inside)
    let attractForce = -gradient * forceMag;

    // Orbital component: tangential force perpendicular to gradient
    if (attractor.orbitalFactor > 0.001) {
      let velPerp = vel.xyz - gradient * dot(vel.xyz, gradient);
      let tangent = normalize(cross(gradient, vec3<f32>(0.0, 1.0, 0.0)));
      let orbitalForce = tangent * forceMag * attractor.orbitalFactor;
      totalForce += attractForce + orbitalForce;
    } else {
      totalForce += attractForce;
    }

    // Damping near surface
    if (attractor.damping > 0.001 && abs(dist) < attractor.radius * 2.0) {
      let proximityFactor = 1.0 - clamp(abs(dist) / (attractor.radius * 2.0), 0.0, 1.0);
      totalDamping = max(totalDamping, attractor.damping * proximityFactor);
    }
  }

  // Apply force
  let dt = params.dt;
  vel = vec4<f32>(vel.xyz + totalForce * dt, vel.w);

  // Apply damping
  if (totalDamping > 0.001) {
    vel = vec4<f32>(vel.xyz * (1.0 - totalDamping * dt), vel.w);
  }

  velocities[idx] = vel;
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

const MAX_ATTRACTORS = 16;

/**
 * Create an SDF attraction system.
 * @param {GPUDevice} device
 */
export function createSDFAttractionSystem(device) {
  const shaderModule = device.createShaderModule({
    label: 'SDFAttraction.shader',
    code: SDF_ATTRACTION_SHADER,
  });

  const pipeline = device.createComputePipeline({
    label: 'SDFAttraction.pipeline',
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  });

  // Params: 16 bytes (particleCount, attractorCount, dt, time)
  const paramsBuffer = createUniformBuffer(device, 16, { label: 'SDFAttraction.params' });

  // Attractors: MAX_ATTRACTORS × 64 bytes each
  const attractorBuffer = createStorageBuffer(device, MAX_ATTRACTORS * 64, { label: 'SDFAttraction.attractors' });

  labelResource(paramsBuffer, 'SDFAttraction.params');
  labelResource(attractorBuffer, 'SDFAttraction.attractors');

  return {
    device,
    pipeline,
    paramsBuffer,
    attractorBuffer,
    bindGroup: null,
    attractorCount: 0,
    attractors: [],
    maxAttractors: MAX_ATTRACTORS,
  };
}

/**
 * Add an SDF attractor.
 * @param {Object} system
 * @param {Object} config
 * @param {string} config.type - 'sphere', 'box', 'torus', 'cylinder'
 * @param {number[]} config.center - [x, y, z]
 * @param {number} config.radius
 * @param {number} config.strength - positive = attract, negative = repel
 * @param {number} config.softness - prevents singularity (default 0.1)
 * @param {number} config.orbitalFactor - tangential force (default 0)
 * @param {number} config.damping - velocity damping near surface (default 0)
 * @param {number[]} config.halfExtents - for box/torus/cylinder
 * @returns {number} Attractor index, or -1 if full
 */
export function addSDFAttractor(system, config = {}) {
  if (!system || system.attractorCount >= system.maxAttractors) return -1;

  const typeMap = { sphere: 0, box: 1, torus: 2, cylinder: 3 };
  const sdfType = typeMap[config.type] ?? 0;
  const center = config.center || [0, 0, 0];
  const halfExtents = config.halfExtents || [1, 1, 1];

  // Pack into 64 bytes (16 floats) matching SDFAttractor struct
  const data = new Float32Array(16);
  data[0] = center[0]; data[1] = center[1]; data[2] = center[2];
  data[3] = config.radius ?? 1.0;
  data[4] = config.strength ?? 5.0;
  data[5] = config.softness ?? 0.1;
  data[6] = config.orbitalFactor ?? 0;
  data[7] = config.damping ?? 0;
  data[8] = halfExtents[0]; data[9] = halfExtents[1]; data[10] = halfExtents[2];
  new Uint32Array(data.buffer)[11] = sdfType;

  const offset = system.attractorCount * 64;
  updateBuffer(system.device, system.attractorBuffer, data, offset);

  system.attractors.push(config);
  system.attractorCount++;
  return system.attractorCount - 1;
}

/**
 * Update an existing attractor.
 */
export function updateSDFAttractor(system, index, config) {
  if (!system || index < 0 || index >= system.attractorCount) return;

  const prev = system.attractors[index];
  const merged = { ...prev, ...config };
  system.attractors[index] = merged;

  const typeMap = { sphere: 0, box: 1, torus: 2, cylinder: 3 };
  const center = merged.center || [0, 0, 0];
  const halfExtents = merged.halfExtents || [1, 1, 1];

  const data = new Float32Array(16);
  data[0] = center[0]; data[1] = center[1]; data[2] = center[2];
  data[3] = merged.radius ?? 1.0;
  data[4] = merged.strength ?? 5.0;
  data[5] = merged.softness ?? 0.1;
  data[6] = merged.orbitalFactor ?? 0;
  data[7] = merged.damping ?? 0;
  data[8] = halfExtents[0]; data[9] = halfExtents[1]; data[10] = halfExtents[2];
  new Uint32Array(data.buffer)[11] = typeMap[merged.type] ?? 0;

  updateBuffer(system.device, system.attractorBuffer, data, index * 64);
}

/**
 * Initialize bind group (call after particle buffers are created).
 */
export function initSDFAttractionBindGroup(system, device, positionBuffer, velocityBuffer) {
  system.bindGroup = device.createBindGroup({
    label: 'SDFAttraction.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: system.attractorBuffer } },
      { binding: 2, resource: { buffer: positionBuffer } },
      { binding: 3, resource: { buffer: velocityBuffer } },
    ],
  });
}

// Reusable params buffer
const _sdfAttrParamsF32 = new Float32Array(4);
const _sdfAttrParamsU32 = new Uint32Array(_sdfAttrParamsF32.buffer);

/**
 * Execute SDF attraction compute pass.
 */
export function executeSDFAttraction(system, device, particleCount, dt = 1/60, time = 0) {
  if (!system?.bindGroup || system.attractorCount === 0 || particleCount === 0) return;

  _sdfAttrParamsU32[0] = particleCount;
  _sdfAttrParamsU32[1] = system.attractorCount;
  _sdfAttrParamsF32[2] = dt;
  _sdfAttrParamsF32[3] = time;
  device.queue.writeBuffer(system.paramsBuffer, 0, _sdfAttrParamsF32);

  const encoder = device.createCommandEncoder({ label: 'SDFAttraction.encoder' });
  const pass = encoder.beginComputePass({ label: 'SDFAttraction.pass' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Clear all attractors.
 */
export function clearSDFAttractors(system) {
  if (!system) return;
  system.attractorCount = 0;
  system.attractors = [];
}

/**
 * Destroy the system.
 */
export function destroySDFAttractionSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  if (system.attractorBuffer) system.attractorBuffer.destroy();
  system.bindGroup = null;
  system.attractorCount = 0;
}
