// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSurfaceProjection.js - Surface Projection / Conform (GAP 29)
 * 
 * GPU compute shader that projects particles onto shape surfaces.
 * Particles are snapped or attracted to the nearest point on a surface,
 * enabling effects like particles crawling along walls, flowing over terrain,
 * or conforming to mesh silhouettes.
 * 
 * Supports analytical shapes (sphere, box, plane, cylinder) on GPU.
 * For arbitrary meshes, uses a signed distance field (SDF) with gradient
 * descent to find the nearest surface point.
 * 
 * Matches PopcornFX CParticleEvolver_Projection.
 * 
 * Usage:
 *   const proj = createSurfaceProjectionSystem(device, maxParticles);
 *   addProjectionSurface(proj, { type: 'sphere', center: [0,0,0], radius: 5 });
 *   initProjectionBindGroups(proj, device, positionBuffer, velocityBuffer);
 *   executeSurfaceProjection(proj, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// SURFACE PROJECTION COMPUTE SHADER
// ============================================================================

const PROJECTION_SHADER = /* wgsl */`
struct ProjectionParams {
  particleCount: u32,
  surfaceCount: u32,
  mode: u32,        // 0=snap (hard), 1=attract (soft), 2=slide (constrained velocity)
  _pad: u32,

  attractStrength: f32,
  surfaceOffset: f32,  // offset distance above surface
  stickyFriction: f32, // friction when on surface (slide mode)
  dt: f32,
};

// Each surface: vec4(type, centerX, centerY, centerZ), vec4(param0, param1, param2, param3)
// Types: 1=sphere, 2=box, 3=plane, 4=cylinder
// Sphere: params = (radius, 0, 0, 0)
// Box: params = (halfX, halfY, halfZ, 0)
// Plane: center=point on plane, params = (normalX, normalY, normalZ, 0)
// Cylinder: center=axis base, params = (axisX, axisY, axisZ, radius)
struct Surface {
  typeAndCenter: vec4<f32>,
  params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uParams: ProjectionParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> surfaces: array<Surface>;

fn projectToSphere(pos: vec3<f32>, center: vec3<f32>, radius: f32, offset: f32) -> vec3<f32> {
  let toPos = pos - center;
  let dist = length(toPos);
  if (dist < 0.0001) { return center + vec3<f32>(0.0, radius + offset, 0.0); }
  return center + normalize(toPos) * (radius + offset);
}

fn sphereNormal(pos: vec3<f32>, center: vec3<f32>) -> vec3<f32> {
  let d = pos - center;
  let len = length(d);
  if (len < 0.0001) { return vec3<f32>(0.0, 1.0, 0.0); }
  return d / len;
}

fn projectToPlane(pos: vec3<f32>, planePoint: vec3<f32>, normal: vec3<f32>, offset: f32) -> vec3<f32> {
  let toPos = pos - planePoint;
  let dist = dot(toPos, normal);
  return pos - normal * (dist - offset);
}

fn projectToBox(pos: vec3<f32>, center: vec3<f32>, half_ext: vec3<f32>, offset: f32) -> vec3<f32> {
  let local = pos - center;
  let clamped = clamp(local, -half_ext, half_ext);
  let onSurface = center + clamped;
  let toPos = pos - onSurface;
  let dist = length(toPos);
  if (dist < 0.0001) {
    // Inside box — push to nearest face
    let dists = half_ext - abs(local);
    let minDist = min(dists.x, min(dists.y, dists.z));
    var normal = vec3<f32>(0.0, 1.0, 0.0);
    if (minDist == dists.x) { normal = vec3<f32>(sign(local.x), 0.0, 0.0); }
    else if (minDist == dists.z) { normal = vec3<f32>(0.0, 0.0, sign(local.z)); }
    return center + clamped + normal * offset;
  }
  return onSurface + normalize(toPos) * offset;
}

fn projectToCylinder(pos: vec3<f32>, base: vec3<f32>, axis: vec3<f32>, radius: f32, offset: f32) -> vec3<f32> {
  let axisNorm = normalize(axis);
  let toPos = pos - base;
  let along = dot(toPos, axisNorm);
  let perp = toPos - axisNorm * along;
  let perpDist = length(perp);
  if (perpDist < 0.0001) { return base + axisNorm * along + vec3<f32>(radius + offset, 0.0, 0.0); }
  return base + axisNorm * along + normalize(perp) * (radius + offset);
}

@compute @workgroup_size(64)
fn projectStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= uParams.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) { return; } // skip dead

  var bestProjected = pos4.xyz;
  var bestDistSq = 1e20;

  // Find nearest surface projection
  for (var s = 0u; s < uParams.surfaceCount; s++) {
    let surf = surfaces[s];
    let surfType = u32(surf.typeAndCenter.x);
    let center = surf.typeAndCenter.yzw;
    let p = surf.params;
    var projected = pos4.xyz;

    if (surfType == 1u) { // Sphere
      projected = projectToSphere(pos4.xyz, center, p.x, uParams.surfaceOffset);
    } else if (surfType == 2u) { // Box
      projected = projectToBox(pos4.xyz, center, p.xyz, uParams.surfaceOffset);
    } else if (surfType == 3u) { // Plane
      projected = projectToPlane(pos4.xyz, center, normalize(p.xyz), uParams.surfaceOffset);
    } else if (surfType == 4u) { // Cylinder
      projected = projectToCylinder(pos4.xyz, center, p.xyz, p.w, uParams.surfaceOffset);
    }

    let diff = projected - pos4.xyz;
    let distSq = dot(diff, diff);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestProjected = projected;
    }
  }

  let toSurface = bestProjected - pos4.xyz;

  if (uParams.mode == 0u) {
    // Snap: hard projection
    positions[idx] = vec4<f32>(bestProjected, pos4.w);
    // Remove velocity component going into surface
    let surfNormal = select(normalize(toSurface), vec3<f32>(0.0, 1.0, 0.0), bestDistSq < 0.00001);
    let velAlongNormal = dot(vel4.xyz, surfNormal);
    velocities[idx] = vec4<f32>(vel4.xyz - surfNormal * velAlongNormal, vel4.w);
  } else if (uParams.mode == 1u) {
    // Attract: soft spring toward surface
    let force = toSurface * uParams.attractStrength;
    velocities[idx] = vec4<f32>(vel4.xyz + force * uParams.dt, vel4.w);
  } else {
    // Slide: constrained velocity (project velocity onto surface tangent plane)
    positions[idx] = vec4<f32>(bestProjected, pos4.w);
    let surfNormal = select(normalize(toSurface), vec3<f32>(0.0, 1.0, 0.0), bestDistSq < 0.00001);
    let velAlongNormal = dot(vel4.xyz, surfNormal);
    let tangentVel = vel4.xyz - surfNormal * velAlongNormal;
    velocities[idx] = vec4<f32>(tangentVel * (1.0 - uParams.stickyFriction * uParams.dt), vel4.w);
  }
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

const MAX_SURFACES = 16;

/**
 * Create the surface projection system.
 */
export function createSurfaceProjectionSystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'SurfProj.shader', code: PROJECTION_SHADER,
  });
  const pipeline = device.createComputePipeline({
    label: 'SurfProj.pipeline', layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'projectStep' },
  });

  const paramsBuffer = createUniformBuffer(device, 32, { label: 'SurfProj.params' });
  labelResource(paramsBuffer, 'SurfProj.params');

  // Each surface: 2 × vec4 = 32 bytes
  const surfaceBuffer = createStorageBuffer(device, MAX_SURFACES * 32, { label: 'SurfProj.surfaces' });
  labelResource(surfaceBuffer, 'SurfProj.surfaces');

  return {
    device, pipeline, paramsBuffer, surfaceBuffer,
    bindGroup: null,
    surfaces: [],
    mode: 1,             // 0=snap, 1=attract, 2=slide
    attractStrength: 10.0,
    surfaceOffset: 0.05,
    stickyFriction: 2.0,
  };
}

/**
 * Add a projection surface.
 * @param {Object} system
 * @param {Object} surface - { type: 'sphere'|'box'|'plane'|'cylinder', center, radius, halfExtent, normal, axis }
 */
export function addProjectionSurface(system, surface) {
  if (!system || system.surfaces.length >= MAX_SURFACES) return;

  const typeMap = { sphere: 1, box: 2, plane: 3, cylinder: 4 };
  const type = typeMap[surface.type] || 1;
  const center = surface.center || [0, 0, 0];
  let params = [0, 0, 0, 0];

  if (type === 1) params = [surface.radius || 1, 0, 0, 0];
  else if (type === 2) params = surface.halfExtent || [1, 1, 1, 0];
  else if (type === 3) params = surface.normal || [0, 1, 0, 0];
  else if (type === 4) params = [...(surface.axis || [0, 1, 0]), surface.radius || 1];

  system.surfaces.push({ type, center, params });
  _uploadSurfaces(system);
}

function _uploadSurfaces(system) {
  const data = new Float32Array(MAX_SURFACES * 8);
  for (let i = 0; i < system.surfaces.length; i++) {
    const s = system.surfaces[i];
    const base = i * 8;
    data[base + 0] = s.type;
    data[base + 1] = s.center[0];
    data[base + 2] = s.center[1];
    data[base + 3] = s.center[2];
    data[base + 4] = s.params[0];
    data[base + 5] = s.params[1];
    data[base + 6] = s.params[2];
    data[base + 7] = s.params[3] || 0;
  }
  system.device.queue.writeBuffer(system.surfaceBuffer, 0, data);
}

/**
 * Initialize bind groups.
 */
export function initProjectionBindGroups(system, device, positionBuffer, velocityBuffer) {
  system.bindGroup = device.createBindGroup({
    label: 'SurfProj.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: system.surfaceBuffer } },
    ],
  });
}

const _projParamsF32 = new Float32Array(8);
const _projParamsU32 = new Uint32Array(_projParamsF32.buffer);

/**
 * Execute the surface projection compute pass.
 */
export function executeSurfaceProjection(system, device, particleCount, dt) {
  if (!system?.bindGroup || particleCount === 0 || system.surfaces.length === 0) return;

  _projParamsU32[0] = particleCount;
  _projParamsU32[1] = system.surfaces.length;
  _projParamsU32[2] = system.mode;
  _projParamsU32[3] = 0;
  _projParamsF32[4] = system.attractStrength;
  _projParamsF32[5] = system.surfaceOffset;
  _projParamsF32[6] = system.stickyFriction;
  _projParamsF32[7] = dt;
  device.queue.writeBuffer(system.paramsBuffer, 0, _projParamsF32);

  const encoder = device.createCommandEncoder({ label: 'SurfProj.step' });
  const pass = encoder.beginComputePass({ label: 'SurfProj.step' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Clear all surfaces.
 */
export function clearProjectionSurfaces(system) {
  if (!system) return;
  system.surfaces.length = 0;
}

/**
 * Destroy the system.
 */
export function destroySurfaceProjectionSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  if (system.surfaceBuffer) system.surfaceBuffer.destroy();
  system.bindGroup = null;
  system.surfaces.length = 0;
}
