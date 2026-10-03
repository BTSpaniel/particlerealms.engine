// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleLocalSpace.js - Local/World Space Toggle (GAP 30)
 * 
 * Per-emitter transform for local-space simulation. When enabled, particles
 * are simulated in the emitter's local coordinate frame and transformed to
 * world space only for rendering. Moving the emitter moves all its particles.
 * 
 * When disabled (default), particles are emitted in world space and the emitter
 * can move without affecting existing particles.
 * 
 * GPU compute shader transforms between local and world space using the
 * emitter's model matrix each frame.
 * 
 * Matches PopcornFX CParticleEvolver_Localspace.
 * 
 * Usage:
 *   const ls = createLocalSpaceSystem(device, maxParticles);
 *   initLocalSpaceBindGroups(ls, device, positionBuffer, velocityBuffer);
 *   setEmitterTransform(ls, modelMatrix);
 *   // Before sim step: transform world→local
 *   executeWorldToLocal(ls, device, particleCount);
 *   // ... run simulation in local space ...
 *   // After sim step: transform local→world
 *   executeLocalToWorld(ls, device, particleCount);
 */

import { createStorageBuffer, createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// TRANSFORM COMPUTE SHADER
// ============================================================================

const LOCAL_SPACE_SHADER = /* wgsl */`
struct TransformParams {
  particleCount: u32,
  direction: u32, // 0 = world→local, 1 = local→world
  _pad0: u32,
  _pad1: u32,
  modelMatrix: mat4x4<f32>,
  inverseModelMatrix: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> params: TransformParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;

@compute @workgroup_size(64)
fn transformSpace(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos4 = positions[idx];
  let vel4 = velocities[idx];
  if (pos4.w >= vel4.w) { return; } // skip dead

  if (params.direction == 0u) {
    // World → Local: multiply by inverse model matrix
    let localPos = params.inverseModelMatrix * vec4<f32>(pos4.xyz, 1.0);
    let localVel = params.inverseModelMatrix * vec4<f32>(vel4.xyz, 0.0);
    positions[idx] = vec4<f32>(localPos.xyz, pos4.w);
    velocities[idx] = vec4<f32>(localVel.xyz, vel4.w);
  } else {
    // Local → World: multiply by model matrix
    let worldPos = params.modelMatrix * vec4<f32>(pos4.xyz, 1.0);
    let worldVel = params.modelMatrix * vec4<f32>(vel4.xyz, 0.0);
    positions[idx] = vec4<f32>(worldPos.xyz, pos4.w);
    velocities[idx] = vec4<f32>(worldVel.xyz, vel4.w);
  }
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create local space transform system.
 */
export function createLocalSpaceSystem(device, maxParticles) {
  const shaderModule = device.createShaderModule({
    label: 'LocalSpace.shader', code: LOCAL_SPACE_SHADER,
  });
  const pipeline = device.createComputePipeline({
    label: 'LocalSpace.pipeline', layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'transformSpace' },
  });

  // Params: 16 (header) + 64 (model) + 64 (inverse) = 144 bytes, aligned to 160
  const paramsBuffer = createUniformBuffer(device, 160, { label: 'LocalSpace.params' });
  labelResource(paramsBuffer, 'LocalSpace.params');

  return {
    device, pipeline, paramsBuffer,
    bindGroup: null,
    maxParticles,
    enabled: false,
    // Column-major 4x4 matrices
    modelMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
    inverseModelMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
  };
}

/**
 * Initialize bind groups.
 */
export function initLocalSpaceBindGroups(system, device, positionBuffer, velocityBuffer) {
  system.bindGroup = device.createBindGroup({
    label: 'LocalSpace.bindGroup',
    layout: system.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.paramsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
    ],
  });
}

/**
 * Set the emitter transform (4x4 column-major matrix).
 * Automatically computes the inverse.
 * @param {Object} system
 * @param {Float32Array|number[]} matrix - 16-element column-major 4x4 matrix
 */
export function setEmitterTransform(system, matrix) {
  if (!system || !matrix) return;
  system.modelMatrix.set(matrix);
  invertMatrix4(matrix, system.inverseModelMatrix);
}

/**
 * Set emitter transform from position + rotation (Euler angles in radians).
 */
export function setEmitterTransformFromPosRot(system, pos, rotation) {
  if (!system) return;
  const cx = Math.cos(rotation[0] || 0), sx = Math.sin(rotation[0] || 0);
  const cy = Math.cos(rotation[1] || 0), sy = Math.sin(rotation[1] || 0);
  const cz = Math.cos(rotation[2] || 0), sz = Math.sin(rotation[2] || 0);

  // Column-major rotation: Rz * Ry * Rx
  const m = system.modelMatrix;
  m[0]  = cy * cz;  m[1]  = cy * sz;  m[2]  = -sy;     m[3]  = 0;
  m[4]  = sx*sy*cz - cx*sz; m[5] = sx*sy*sz + cx*cz; m[6] = sx*cy; m[7] = 0;
  m[8]  = cx*sy*cz + sx*sz; m[9] = cx*sy*sz - sx*cz; m[10] = cx*cy; m[11] = 0;
  m[12] = pos[0] || 0; m[13] = pos[1] || 0; m[14] = pos[2] || 0; m[15] = 1;

  invertMatrix4(m, system.inverseModelMatrix);
}

const _lsParamsData = new ArrayBuffer(160);
const _lsU32 = new Uint32Array(_lsParamsData, 0, 4);
const _lsModel = new Float32Array(_lsParamsData, 16, 16);
const _lsInverse = new Float32Array(_lsParamsData, 80, 16);

function _executeTransform(system, device, particleCount, direction) {
  if (!system?.bindGroup || !system.enabled || particleCount === 0) return;

  _lsU32[0] = particleCount;
  _lsU32[1] = direction;
  _lsU32[2] = 0;
  _lsU32[3] = 0;
  _lsModel.set(system.modelMatrix);
  _lsInverse.set(system.inverseModelMatrix);
  device.queue.writeBuffer(system.paramsBuffer, 0, new Uint8Array(_lsParamsData));

  const label = direction === 0 ? 'LocalSpace.worldToLocal' : 'LocalSpace.localToWorld';
  const encoder = device.createCommandEncoder({ label });
  const pass = encoder.beginComputePass({ label });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/**
 * Transform particles from world space to local space (run before sim step).
 */
export function executeWorldToLocal(system, device, particleCount) {
  _executeTransform(system, device, particleCount, 0);
}

/**
 * Transform particles from local space to world space (run after sim step).
 */
export function executeLocalToWorld(system, device, particleCount) {
  _executeTransform(system, device, particleCount, 1);
}

/**
 * Destroy the system.
 */
export function destroyLocalSpaceSystem(system) {
  if (!system) return;
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  system.bindGroup = null;
}

// 4x4 matrix inverse (column-major)
function invertMatrix4(src, dst) {
  const s = src instanceof Float32Array ? src : new Float32Array(src);
  const d = dst || new Float32Array(16);

  const a00 = s[0], a01 = s[1], a02 = s[2], a03 = s[3];
  const a10 = s[4], a11 = s[5], a12 = s[6], a13 = s[7];
  const a20 = s[8], a21 = s[9], a22 = s[10], a23 = s[11];
  const a30 = s[12], a31 = s[13], a32 = s[14], a33 = s[15];

  const b00 = a00*a11 - a01*a10, b01 = a00*a12 - a02*a10;
  const b02 = a00*a13 - a03*a10, b03 = a01*a12 - a02*a11;
  const b04 = a01*a13 - a03*a11, b05 = a02*a13 - a03*a12;
  const b06 = a20*a31 - a21*a30, b07 = a20*a32 - a22*a30;
  const b08 = a20*a33 - a23*a30, b09 = a21*a32 - a22*a31;
  const b10 = a21*a33 - a23*a31, b11 = a22*a33 - a23*a32;

  let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
  if (Math.abs(det) < 1e-10) { d.set(s); return d; }
  det = 1.0 / det;

  d[0]  = (a11*b11 - a12*b10 + a13*b09) * det;
  d[1]  = (a02*b10 - a01*b11 - a03*b09) * det;
  d[2]  = (a31*b05 - a32*b04 + a33*b03) * det;
  d[3]  = (a22*b04 - a21*b05 - a23*b03) * det;
  d[4]  = (a12*b08 - a10*b11 - a13*b07) * det;
  d[5]  = (a00*b11 - a02*b08 + a03*b07) * det;
  d[6]  = (a32*b02 - a30*b05 - a33*b01) * det;
  d[7]  = (a20*b05 - a22*b02 + a23*b01) * det;
  d[8]  = (a10*b10 - a11*b08 + a13*b06) * det;
  d[9]  = (a01*b08 - a00*b10 - a03*b06) * det;
  d[10] = (a30*b04 - a31*b02 + a33*b00) * det;
  d[11] = (a21*b02 - a20*b04 - a23*b00) * det;
  d[12] = (a11*b07 - a10*b09 - a12*b06) * det;
  d[13] = (a00*b09 - a01*b07 + a02*b06) * det;
  d[14] = (a31*b01 - a30*b03 - a32*b00) * det;
  d[15] = (a20*b03 - a21*b01 + a22*b00) * det;
  return d;
}
