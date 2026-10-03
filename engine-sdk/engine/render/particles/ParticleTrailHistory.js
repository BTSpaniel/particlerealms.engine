// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleTrailHistory.js - Per-Particle Trail Histories (GAP 26)
 * 
 * Individual per-particle position history trails. Unlike ribbon trails
 * (which connect sequential particles into a strip), this stores N frames
 * of position history PER particle and renders each as a fading afterimage.
 * 
 * Think sparks leaving comet tails, or tracers behind projectiles.
 * 
 * Architecture:
 *   - Ring buffer: historyBuffer[maxParticles × historyLength × vec4] stores position snapshots
 *   - GPU compute shader shifts history and writes current position each frame
 *   - Render pass draws each trail point as a small billboard, fading by age
 * 
 * Usage:
 *   const trails = createTrailHistorySystem(device, maxParticles, { historyLength: 16 });
 *   initTrailHistoryBindGroups(trails, device, positionBuffer, velocityBuffer);
 *   // Each frame:
 *   updateTrailHistories(trails, device, particleCount);
 *   renderTrailHistories(pass, trails, frameBindGroup);
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// UPDATE COMPUTE SHADER — shifts history ring buffer, writes current position
// ============================================================================

const TRAIL_UPDATE_SHADER = /* wgsl */`
struct TrailParams {
  particleCount: u32,
  historyLength: u32,
  writeIndex: u32,   // current ring buffer write position (mod historyLength)
  dt: f32,
};

@group(0) @binding(0) var<uniform> params: TrailParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> trailHistory: array<vec4<f32>>;
// trailHistory layout: [particle0_slot0, particle0_slot1, ..., particle0_slotN, particle1_slot0, ...]

@compute @workgroup_size(64)
fn updateTrails(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let pos = positions[idx];
  let vel = velocities[idx];
  let age = pos.w;
  let lifetime = vel.w;

  // Write current position into ring buffer slot
  let histBase = idx * params.historyLength;
  let writeSlot = histBase + params.writeIndex;

  if (age < lifetime) {
    // Alive: store current position + speed in w for trail width scaling
    let speed = length(vel.xyz);
    trailHistory[writeSlot] = vec4<f32>(pos.xyz, speed);
  } else {
    // Dead: write sentinel (w = -1 means invalid)
    trailHistory[writeSlot] = vec4<f32>(0.0, 0.0, 0.0, -1.0);
  }
}
`;

// ============================================================================
// RENDER SHADER — draws trail points as small fading billboards
// ============================================================================

const TRAIL_RENDER_SHADER = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  resolution: vec2<f32>,
  nearFar: vec2<f32>,
};

struct TrailRenderParams {
  particleCount: u32,
  historyLength: u32,
  newestIndex: u32,
  baseWidth: f32,
  fadeExponent: f32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
};

@group(0) @binding(0) var<uniform> uFrame: FrameUniforms;
@group(1) @binding(0) var<uniform> uTrailParams: TrailRenderParams;
@group(1) @binding(1) var<storage, read> trailHistory: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(3) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(4) var<storage, read> ptclMeta: array<vec4<f32>>;

struct TrailVSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) localUV: vec2<f32>,
};

@vertex
fn vs_trail(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TrailVSOut {
  // ii encodes: particleIndex * historyLength + historySlot
  let particleIdx = ii / uTrailParams.historyLength;
  let historySlot = ii % uTrailParams.historyLength;

  var out: TrailVSOut;

  // Check if parent particle is alive
  let parentPos = positions[particleIdx];
  let parentVel = velocities[particleIdx];
  if (parentPos.w >= parentVel.w) {
    // Dead particle — cull trail point
    out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.color = vec4<f32>(0.0);
    out.localUV = vec2<f32>(0.0);
    return out;
  }

  // Read trail position from ring buffer
  let histBase = particleIdx * uTrailParams.historyLength;
  // Convert history slot to ring buffer index (oldest first)
  let ringIdx = (uTrailParams.newestIndex + 1u + historySlot) % uTrailParams.historyLength;
  let trailPoint = trailHistory[histBase + ringIdx];

  if (trailPoint.w < 0.0) {
    // Invalid slot
    out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.color = vec4<f32>(0.0);
    out.localUV = vec2<f32>(0.0);
    return out;
  }

  // Age-based fade: newest = brightest, oldest = faded
  let normalizedAge = f32(historySlot) / f32(max(uTrailParams.historyLength - 1u, 1u));
  let fade = pow(1.0 - normalizedAge, uTrailParams.fadeExponent);

  // Trail point width: base width × speed factor × age fade
  let speedFactor = clamp(trailPoint.w * 0.2, 0.1, 2.0);
  let width = uTrailParams.baseWidth * speedFactor * fade;

  // Billboard quad corners
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0)
  );
  let corner = corners[vi];

  // Camera-facing billboard
  let toCamera = normalize(uFrame.cameraPos - trailPoint.xyz);
  let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), toCamera));
  let up = cross(toCamera, right);

  let worldPos = trailPoint.xyz + right * corner.x * width + up * corner.y * width;
  out.position = uFrame.viewProj * vec4<f32>(worldPos, 1.0);

  // Tint from parent particle color
  let particleMeta = ptclMeta[particleIdx];
  let baseColor = vec3<f32>(uTrailParams.colorR, uTrailParams.colorG, uTrailParams.colorB);
  let tintedColor = particleMeta.rgb * baseColor;
  out.color = vec4<f32>(tintedColor, fade * 0.8);
  out.localUV = corner;

  return out;
}

@fragment
fn fs_trail(input: TrailVSOut) -> @location(0) vec4<f32> {
  // Soft circle shape
  let dist = length(input.localUV);
  if (dist > 1.0) { discard; }
  let soft = 1.0 - smoothstep(0.5, 1.0, dist);
  return vec4<f32>(input.color.rgb, input.color.a * soft);
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create a per-particle trail history system.
 * @param {GPUDevice} device
 * @param {number} maxParticles
 * @param {Object} config
 * @param {number} config.historyLength - Number of position snapshots per particle (default 16)
 * @param {number} config.baseWidth - Base trail point width (default 0.05)
 * @param {number} config.fadeExponent - Fade curve exponent (default 2.0)
 * @param {number[]} config.color - Trail color [r, g, b] (default [1, 1, 1])
 * @param {string} config.targetFormat - Render target format (default 'bgra8unorm')
 */
export function createTrailHistorySystem(device, maxParticles, config = {}) {
  const historyLength = config.historyLength || 16;
  const targetFormat = config.targetFormat || 'bgra8unorm';

  // Trail history buffer: maxParticles × historyLength × vec4<f32>
  const historyBuffer = createStorageBuffer(device, maxParticles * historyLength * 16, {
    label: 'TrailHistory.history',
  });
  labelResource(historyBuffer, 'TrailHistory.history');

  // Update compute
  const updateModule = device.createShaderModule({
    label: 'TrailHistory.update', code: TRAIL_UPDATE_SHADER,
  });
  const updatePipeline = device.createComputePipeline({
    label: 'TrailHistory.updatePipeline', layout: 'auto',
    compute: { module: updateModule, entryPoint: 'updateTrails' },
  });

  // Update params (16 bytes)
  const updateParamsBuffer = createUniformBuffer(device, 16, { label: 'TrailHistory.updateParams' });
  labelResource(updateParamsBuffer, 'TrailHistory.updateParams');

  // Render pipeline
  const renderModule = device.createShaderModule({
    label: 'TrailHistory.render', code: TRAIL_RENDER_SHADER,
  });
  const renderPipeline = device.createRenderPipeline({
    label: 'TrailHistory.renderPipeline',
    layout: 'auto',
    vertex: { module: renderModule, entryPoint: 'vs_trail' },
    fragment: {
      module: renderModule, entryPoint: 'fs_trail',
      targets: [{
        format: targetFormat,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
    },
  });

  // Render params (32 bytes)
  const renderParamsBuffer = createUniformBuffer(device, 32, { label: 'TrailHistory.renderParams' });
  labelResource(renderParamsBuffer, 'TrailHistory.renderParams');

  const color = config.color || [1, 1, 1];

  return {
    device,
    maxParticles,
    historyLength,
    historyBuffer,
    updatePipeline,
    updateParamsBuffer,
    renderPipeline,
    renderParamsBuffer,
    updateBindGroup: null,
    renderBindGroup: null,
    writeIndex: 0,
    baseWidth: config.baseWidth ?? 0.05,
    fadeExponent: config.fadeExponent ?? 2.0,
    color,
  };
}

/**
 * Initialize bind groups.
 */
export function initTrailHistoryBindGroups(system, device, positionBuffer, velocityBuffer, metaBuffer) {
  system.updateBindGroup = device.createBindGroup({
    label: 'TrailHistory.updateBindGroup',
    layout: system.updatePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: system.updateParamsBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: velocityBuffer } },
      { binding: 3, resource: { buffer: system.historyBuffer } },
    ],
  });

  // Render bind group (group 1) — frame uniform is group 0, set externally
  system.renderBindGroup = device.createBindGroup({
    label: 'TrailHistory.renderBindGroup',
    layout: system.renderPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: system.renderParamsBuffer } },
      { binding: 1, resource: { buffer: system.historyBuffer } },
      { binding: 2, resource: { buffer: positionBuffer } },
      { binding: 3, resource: { buffer: velocityBuffer } },
      { binding: 4, resource: { buffer: metaBuffer } },
    ],
  });
}

const _updateParamsF32 = new Float32Array(4);
const _updateParamsU32 = new Uint32Array(_updateParamsF32.buffer);

/**
 * Update trail histories (GPU compute pass).
 * Call once per frame before rendering trails.
 */
export function updateTrailHistories(system, device, particleCount, dt = 1/60) {
  if (!system?.updateBindGroup || particleCount === 0) return;

  _updateParamsU32[0] = particleCount;
  _updateParamsU32[1] = system.historyLength;
  _updateParamsU32[2] = system.writeIndex;
  _updateParamsF32[3] = dt;
  device.queue.writeBuffer(system.updateParamsBuffer, 0, _updateParamsF32);

  const encoder = device.createCommandEncoder({ label: 'TrailHistory.update' });
  const pass = encoder.beginComputePass({ label: 'TrailHistory.update' });
  pass.setPipeline(system.updatePipeline);
  pass.setBindGroup(0, system.updateBindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);

  // Advance ring buffer write head
  system.writeIndex = (system.writeIndex + 1) % system.historyLength;
}

const _renderParamsF32 = new Float32Array(8);
const _renderParamsU32 = new Uint32Array(_renderParamsF32.buffer);

/**
 * Render trail histories as additive fading billboards.
 * @param {GPURenderPassEncoder} pass - Active render pass
 * @param {Object} system - Trail history system
 * @param {GPUBindGroup} frameBindGroup - Frame uniform bind group (group 0)
 * @param {number} particleCount - Active particle count
 */
export function renderTrailHistories(pass, system, frameBindGroup, particleCount) {
  if (!system?.renderBindGroup || !frameBindGroup || particleCount === 0) return;

  // Update render params
  _renderParamsU32[0] = particleCount;
  _renderParamsU32[1] = system.historyLength;
  _renderParamsU32[2] = system.writeIndex;
  _renderParamsF32[3] = system.baseWidth;
  _renderParamsF32[4] = system.fadeExponent;
  _renderParamsF32[5] = system.color[0];
  _renderParamsF32[6] = system.color[1];
  _renderParamsF32[7] = system.color[2];
  system.device.queue.writeBuffer(system.renderParamsBuffer, 0, _renderParamsF32);

  pass.setPipeline(system.renderPipeline);
  pass.setBindGroup(0, frameBindGroup);
  pass.setBindGroup(1, system.renderBindGroup);
  // 6 vertices per quad, instanced: particleCount × historyLength instances
  pass.draw(6, particleCount * system.historyLength);
}

/**
 * Destroy the system.
 */
export function destroyTrailHistorySystem(system) {
  if (!system) return;
  if (system.historyBuffer) system.historyBuffer.destroy();
  if (system.updateParamsBuffer) system.updateParamsBuffer.destroy();
  if (system.renderParamsBuffer) system.renderParamsBuffer.destroy();
  system.updateBindGroup = null;
  system.renderBindGroup = null;
}
