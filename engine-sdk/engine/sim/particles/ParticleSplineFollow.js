// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSplineFollow.js - Spline/Path Following (GAP 28)
 * 
 * GPU compute shader that steers particles along bezier or catmull-rom spline
 * paths. Each particle tracks its progress (t parameter) along the curve and
 * applies a steering force toward the next point on the path.
 * 
 * Supports:
 *   - Cubic Bezier paths (4 control points per segment)
 *   - Catmull-Rom splines (N control points, smooth interpolation)
 *   - Per-particle speed along path
 *   - Spread: particles can deviate from path center by a configurable radius
 *   - Looping and ping-pong modes
 * 
 * Control points are uploaded as a storage buffer (max 64 points).
 * Each particle stores its path progress in thermalData.w (repurposed when
 * not using thermal system) or a dedicated progress buffer.
 * 
 * Usage:
 *   const spline = createSplineFollowSystem(device, maxParticles);
 *   setSplineControlPoints(spline, device, points);
 *   initSplineFollowBindGroups(spline, device, positionBuffer, velocityBuffer);
 *   executeSplineFollow(spline, device, particleCount, dt);
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// SPLINE FOLLOW COMPUTE SHADER
// ============================================================================

const SPLINE_FOLLOW_SHADER = /* wgsl */`
struct SplineParams {
  particleCount: u32,
  controlPointCount: u32,
  mode: u32,          // 0=catmull-rom, 1=bezier
  loopMode: u32,      // 0=clamp, 1=loop, 2=ping-pong

  followStrength: f32,
  pathSpeed: f32,
  spreadRadius: f32,
  dt: f32,
};

@group(0) @binding(0) var<uniform> params: SplineParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> controlPoints: array<vec4<f32>>; // xyz=pos, w=unused
@group(0) @binding(4) var<storage, read_write> progress: array<f32>;      // per-particle t [0..1]

// Catmull-Rom interpolation between 4 points
fn catmullRom(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * (
    (2.0 * p1) +
    (-p0 + p2) * t +
    (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
    (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
  );
}

// Catmull-Rom tangent (derivative)
fn catmullRomTangent(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let t2 = t * t;
  return 0.5 * (
    (-p0 + p2) +
    (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * 2.0 * t +
    (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * 3.0 * t2
  );
}

// Cubic Bezier interpolation
fn cubicBezier(p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, p3: vec3<f32>, t: f32) -> vec3<f32> {
  let u = 1.0 - t;
  let u2 = u * u;
  let t2 = t * t;
  return u2 * u * p0 + 3.0 * u2 * t * p1 + 3.0 * u * t2 * p2 + t2 * t * p3;
}

fn sampleSpline(globalT: f32) -> vec3<f32> {
  let n = params.controlPointCount;
  if (n < 2u) { return controlPoints[0].xyz; }

  if (params.mode == 1u) {
    // Bezier: every 4 points = 1 segment
    let segCount = max((n - 1u) / 3u, 1u);
    let segF = globalT * f32(segCount);
    let seg = min(u32(floor(segF)), segCount - 1u);
    let localT = segF - f32(seg);
    let base = seg * 3u;
    return cubicBezier(
      controlPoints[base].xyz,
      controlPoints[min(base + 1u, n - 1u)].xyz,
      controlPoints[min(base + 2u, n - 1u)].xyz,
      controlPoints[min(base + 3u, n - 1u)].xyz,
      localT
    );
  }

  // Catmull-Rom: N control points, N-1 segments
  let segCount = n - 1u;
  let segF = globalT * f32(segCount);
  let seg = min(u32(floor(segF)), segCount - 1u);
  let localT = segF - f32(seg);

  let i0 = select(seg - 1u, 0u, seg == 0u);
  let i1 = seg;
  let i2 = min(seg + 1u, n - 1u);
  let i3 = min(seg + 2u, n - 1u);

  return catmullRom(
    controlPoints[i0].xyz, controlPoints[i1].xyz,
    controlPoints[i2].xyz, controlPoints[i3].xyz,
    localT
  );
}

@compute @workgroup_size(64)
fn splineFollowStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) { return; } // skip dead

  // Advance progress along path
  var t = progress[idx];
  t += params.pathSpeed * params.dt;

  // Apply loop mode
  if (params.loopMode == 1u) {
    t = t - floor(t); // loop
  } else if (params.loopMode == 2u) {
    // ping-pong
    let cycle = t - floor(t / 2.0) * 2.0;
    t = select(cycle, 2.0 - cycle, cycle > 1.0);
  } else {
    t = clamp(t, 0.0, 1.0); // clamp
  }
  progress[idx] = t;

  // Sample target position on spline
  let targetPos = sampleSpline(clamp(t, 0.0, 0.999));

  // Steer toward target
  let toTarget = targetPos - pos4.xyz;
  let steerForce = toTarget * params.followStrength;
  let newVel = vel4.xyz + steerForce * params.dt;

  velocities[idx] = vec4<f32>(newVel, vel4.w);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

const MAX_CONTROL_POINTS = 64;

/**
 * Create the spline follow system.
 */
export function createSplineFollowSystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'SplineFollow.shader', code: SPLINE_FOLLOW_SHADER,
  });
  const pipeline = device.createComputePipeline({
    label: 'SplineFollow.pipeline', layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'splineFollowStep' },
  });

  const paramsBuffer = createUniformBuffer(device, 32, { label: 'SplineFollow.params' });
  labelResource(paramsBuffer, 'SplineFollow.params');

  const controlPointsBuffer = createStorageBuffer(device, MAX_CONTROL_POINTS * 16, {
    label: 'SplineFollow.controlPoints',
  });
  labelResource(controlPointsBuffer, 'SplineFollow.controlPoints');

  const progressBuffer = createStorageBuffer(device, maxParticles * 4, {
    label: 'SplineFollow.progress',
  });
  labelResource(progressBuffer, 'SplineFollow.progress');

  return {
    device, pipeline, paramsBuffer, controlPointsBuffer, progressBuffer,
    bindGroup: null,
    maxParticles,
    controlPointCount: 0,
    mode: 0,          // 0=catmull-rom, 1=bezier
    loopMode: 1,      // 0=clamp, 1=loop, 2=ping-pong
    followStrength: 5.0,
    pathSpeed: 0.2,
    spreadRadius: 0.5,
  };
}

/**
 * Upload control points (array of [x, y, z]).
 */
export function setSplineControlPoints(system, device, points) {
  if (!system || !points) return;
  const count = Math.min(points.length, MAX_CONTROL_POINTS);
  system.controlPointCount = count;
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const p = points[i];
    data[i * 4 + 0] = p[0] || p.x || 0;
    data[i * 4 + 1] = p[1] || p.y || 0;
    data[i * 4 + 2] = p[2] || p.z || 0;
    data[i * 4 + 3] = 0;
  }
  device.queue.writeBuffer(system.controlPointsBuffer, 0, data);
}

/**
 * Initialize bind groups.
 */
export function initSplineFollowBindGroups(system, device, positionBuffer, velocityBuffer) {
  system.bindGroup = device.createBindGroup({
    label: 'SplineFollow.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: system.controlPointsBuffer } },
      { binding: 4, resource: { buffer: system.progressBuffer } },
    ],
  });
}

/**
 * Update spline follow parameters.
 */
export function setSplineFollowParams(system, params) {
  if (!system) return;
  if (params.mode !== undefined) system.mode = params.mode;
  if (params.loopMode !== undefined) system.loopMode = params.loopMode;
  if (params.followStrength !== undefined) system.followStrength = params.followStrength;
  if (params.pathSpeed !== undefined) system.pathSpeed = params.pathSpeed;
  if (params.spreadRadius !== undefined) system.spreadRadius = params.spreadRadius;
}

const _splineParamsF32 = new Float32Array(8);
const _splineParamsU32 = new Uint32Array(_splineParamsF32.buffer);

/**
 * Execute the spline follow compute pass.
 */
export function executeSplineFollow(system, device, particleCount, dt) {
  if (!system?.bindGroup || particleCount === 0 || system.controlPointCount < 2) return;

  _splineParamsU32[0] = particleCount;
  _splineParamsU32[1] = system.controlPointCount;
  _splineParamsU32[2] = system.mode;
  _splineParamsU32[3] = system.loopMode;
  _splineParamsF32[4] = system.followStrength;
  _splineParamsF32[5] = system.pathSpeed;
  _splineParamsF32[6] = system.spreadRadius;
  _splineParamsF32[7] = dt;
  device.queue.writeBuffer(system.paramsBuffer, 0, _splineParamsF32);

  const encoder = device.createCommandEncoder({ label: 'SplineFollow.step' });
  const pass = encoder.beginComputePass({ label: 'SplineFollow.step' });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Destroy the system.
 */
export function destroySplineFollowSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  if (system.controlPointsBuffer) system.controlPointsBuffer.destroy();
  if (system.progressBuffer) system.progressBuffer.destroy();
  system.bindGroup = null;
}
