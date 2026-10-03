// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSoftContainment.js - Soft Containment Volumes (GAP 31)
 * 
 * GPU compute shader that keeps particles inside shape volumes using soft
 * bounce forces instead of hard kill zones. Particles approaching the boundary
 * receive a proportional repulsion force pushing them back inside.
 * 
 * Supports: sphere, box, cylinder containment volumes.
 * Unlike kill zones (hard removal), soft containment preserves particles and
 * creates natural-looking bounded effects.
 * 
 * Matches PopcornFX CParticleEvolver_Containment.
 * 
 * Usage:
 *   const cont = createSoftContainmentSystem(device, maxParticles);
 *   addContainmentVolume(cont, { type: 'sphere', center: [0,5,0], radius: 10 });
 *   initContainmentBindGroups(cont, device, positionBuffer, velocityBuffer);
 *   executeSoftContainment(cont, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// SOFT CONTAINMENT COMPUTE SHADER
// ============================================================================

const CONTAINMENT_SHADER = /* wgsl */`
struct ContainmentParams {
  particleCount: u32,
  volumeCount: u32,
  _pad0: u32,
  _pad1: u32,
  
  bounceStrength: f32,
  dampingOnBounce: f32,
  marginFraction: f32,  // fraction of radius where force starts (0.8 = force starts at 80% of radius)
  dt: f32,
};

// Volume: vec4(type, centerX, centerY, centerZ), vec4(sizeX, sizeY, sizeZ, 0)
// Types: 1=sphere (sizeX=radius), 2=box (size=half extents), 3=cylinder (sizeX=radius, sizeY=halfHeight)
@group(0) @binding(0) var<uniform> params: ContainmentParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> volumes: array<vec4<f32>>; // pairs: [typeCenter, size]

fn containSphere(pos: vec3<f32>, vel: vec3<f32>, center: vec3<f32>, radius: f32,
                 margin: f32, strength: f32, damping: f32, dt: f32) -> vec4<f32> {
  let toPos = pos - center;
  let dist = length(toPos);
  let marginDist = radius * margin;
  
  if (dist < marginDist) {
    return vec4<f32>(vel, 0.0); // Inside safe zone, no force
  }
  
  // Proportional repulsion force
  let penetration = (dist - marginDist) / (radius - marginDist + 0.001);
  let force = -normalize(toPos) * penetration * penetration * strength;
  var newVel = vel + force * dt;
  
  // Damping on outward velocity
  let outwardSpeed = dot(newVel, normalize(toPos));
  if (outwardSpeed > 0.0) {
    newVel -= normalize(toPos) * outwardSpeed * damping;
  }
  
  // Hard clamp as safety net
  if (dist > radius) {
    let clampedPos = center + normalize(toPos) * radius * 0.99;
    return vec4<f32>(newVel, 1.0); // flag: needs position correction
  }
  
  return vec4<f32>(newVel, 0.0);
}

fn containBox(pos: vec3<f32>, vel: vec3<f32>, center: vec3<f32>, halfExt: vec3<f32>,
              margin: f32, strength: f32, damping: f32, dt: f32) -> vec4<f32> {
  let local = pos - center;
  let marginExt = halfExt * margin;
  var newVel = vel;
  
  // Check each axis independently
  for (var axis = 0; axis < 3; axis++) {
    var l: f32; var m: f32; var h: f32; var v: f32;
    if (axis == 0) { l = local.x; m = marginExt.x; h = halfExt.x; v = vel.x; }
    else if (axis == 1) { l = local.y; m = marginExt.y; h = halfExt.y; v = vel.y; }
    else { l = local.z; m = marginExt.z; h = halfExt.z; v = vel.z; }
    
    let absL = abs(l);
    if (absL > m) {
      let penetration = (absL - m) / (h - m + 0.001);
      let force = -sign(l) * penetration * penetration * strength;
      if (axis == 0) { newVel.x += force * dt; if (sign(newVel.x) == sign(l)) { newVel.x *= (1.0 - damping); } }
      else if (axis == 1) { newVel.y += force * dt; if (sign(newVel.y) == sign(l)) { newVel.y *= (1.0 - damping); } }
      else { newVel.z += force * dt; if (sign(newVel.z) == sign(l)) { newVel.z *= (1.0 - damping); } }
    }
  }
  
  return vec4<f32>(newVel, 0.0);
}

@compute @workgroup_size(64)
fn containmentStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) { return; } // skip dead

  var newVel = vel4.xyz;

  for (var v = 0u; v < params.volumeCount; v++) {
    let typeCenter = volumes[v * 2u];
    let sizeVec = volumes[v * 2u + 1u];
    let volType = u32(typeCenter.x);
    let center = typeCenter.yzw;

    if (volType == 1u) {
      // Sphere
      let result = containSphere(pos4.xyz, newVel, center, sizeVec.x,
                                  params.marginFraction, params.bounceStrength, params.dampingOnBounce, params.dt);
      newVel = result.xyz;
      // Hard clamp if flagged
      if (result.w > 0.5) {
        let toPos = pos4.xyz - center;
        let dist = length(toPos);
        if (dist > sizeVec.x) {
          positions[idx] = vec4<f32>(center + normalize(toPos) * sizeVec.x * 0.99, pos4.w);
        }
      }
    } else if (volType == 2u) {
      // Box
      let result = containBox(pos4.xyz, newVel, center, sizeVec.xyz,
                               params.marginFraction, params.bounceStrength, params.dampingOnBounce, params.dt);
      newVel = result.xyz;
      // Hard clamp
      let local = pos4.xyz - center;
      let clamped = clamp(local, -sizeVec.xyz, sizeVec.xyz);
      if (any(abs(local) > sizeVec.xyz)) {
        positions[idx] = vec4<f32>(center + clamped * 0.99, pos4.w);
      }
    } else if (volType == 3u) {
      // Cylinder: sizeVec.x = radius, sizeVec.y = halfHeight, axis = Y
      let local = pos4.xyz - center;
      let radialDist = length(local.xz);
      let heightDist = abs(local.y);
      
      // Radial containment
      let rMargin = sizeVec.x * params.marginFraction;
      if (radialDist > rMargin) {
        let pen = (radialDist - rMargin) / (sizeVec.x - rMargin + 0.001);
        let radDir = normalize(vec2<f32>(local.x, local.z));
        newVel.x -= radDir.x * pen * pen * params.bounceStrength * params.dt;
        newVel.z -= radDir.y * pen * pen * params.bounceStrength * params.dt;
      }
      // Height containment
      let hMargin = sizeVec.y * params.marginFraction;
      if (heightDist > hMargin) {
        let pen = (heightDist - hMargin) / (sizeVec.y - hMargin + 0.001);
        newVel.y -= sign(local.y) * pen * pen * params.bounceStrength * params.dt;
      }
    }
  }

  velocities[idx] = vec4<f32>(newVel, vel4.w);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

const MAX_CONTAINMENT_VOLUMES = 8;

/**
 * Create the soft containment system.
 */
export function createSoftContainmentSystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'SoftContain.shader', code: CONTAINMENT_SHADER,
  });
  const pipeline = device.createComputePipeline({
    label: 'SoftContain.pipeline', layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'containmentStep' },
  });

  const paramsBuffer = createUniformBuffer(device, 32, { label: 'SoftContain.params' });
  labelResource(paramsBuffer, 'SoftContain.params');

  // 2 vec4 per volume × 8 volumes = 256 bytes
  const volumeBuffer = createStorageBuffer(device, MAX_CONTAINMENT_VOLUMES * 32, {
    label: 'SoftContain.volumes',
  });
  labelResource(volumeBuffer, 'SoftContain.volumes');

  return {
    device, pipeline, paramsBuffer, volumeBuffer,
    bindGroup: null,
    volumes: [],
    bounceStrength: 20.0,
    dampingOnBounce: 0.5,
    marginFraction: 0.8,
  };
}

/**
 * Add a containment volume.
 * @param {Object} system
 * @param {Object} volume - { type: 'sphere'|'box'|'cylinder', center, radius, halfExtent, halfHeight }
 */
export function addContainmentVolume(system, volume) {
  if (!system || system.volumes.length >= MAX_CONTAINMENT_VOLUMES) return;
  const typeMap = { sphere: 1, box: 2, cylinder: 3 };
  const type = typeMap[volume.type] || 1;
  const center = volume.center || [0, 0, 0];
  let size = [1, 1, 1];
  if (type === 1) size = [volume.radius || 5, 0, 0];
  else if (type === 2) size = volume.halfExtent || [5, 5, 5];
  else if (type === 3) size = [volume.radius || 5, volume.halfHeight || 5, 0];

  system.volumes.push({ type, center, size });
  _uploadVolumes(system);
}

function _uploadVolumes(system) {
  const data = new Float32Array(MAX_CONTAINMENT_VOLUMES * 8);
  for (let i = 0; i < system.volumes.length; i++) {
    const v = system.volumes[i];
    const base = i * 8;
    data[base + 0] = v.type;
    data[base + 1] = v.center[0];
    data[base + 2] = v.center[1];
    data[base + 3] = v.center[2];
    data[base + 4] = v.size[0];
    data[base + 5] = v.size[1];
    data[base + 6] = v.size[2];
    data[base + 7] = 0;
  }
  system.device.queue.writeBuffer(system.volumeBuffer, 0, data);
}

/**
 * Initialize bind groups.
 */
export function initContainmentBindGroups(system, device, positionBuffer, velocityBuffer) {
  system.bindGroup = device.createBindGroup({
    label: 'SoftContain.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: system.volumeBuffer } },
    ],
  });
}

const _contParamsF32 = new Float32Array(8);
const _contParamsU32 = new Uint32Array(_contParamsF32.buffer);

/**
 * Execute the soft containment compute pass.
 */
export function executeSoftContainment(system, device, particleCount, dt) {
  if (!system?.bindGroup || particleCount === 0 || system.volumes.length === 0) return;

  _contParamsU32[0] = particleCount;
  _contParamsU32[1] = system.volumes.length;
  _contParamsU32[2] = 0;
  _contParamsU32[3] = 0;
  _contParamsF32[4] = system.bounceStrength;
  _contParamsF32[5] = system.dampingOnBounce;
  _contParamsF32[6] = system.marginFraction;
  _contParamsF32[7] = dt;
  device.queue.writeBuffer(system.paramsBuffer, 0, _contParamsF32);

  const encoder = device.createCommandEncoder({ label: 'SoftContain.step' });
  const pass = encoder.beginComputePass({ label: 'SoftContain.step' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Clear all volumes.
 */
export function clearContainmentVolumes(system) {
  if (!system) return;
  system.volumes.length = 0;
}

/**
 * Destroy the system.
 */
export function destroySoftContainmentSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  if (system.volumeBuffer) system.volumeBuffer.destroy();
  system.bindGroup = null;
  system.volumes.length = 0;
}
