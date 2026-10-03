// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleDistortionRenderer.js - Heat haze / distortion from particles
 * 
 * PopcornFX/Niagara parity: particles can distort the scene behind them.
 * Hot particles, explosions, and magic effects create screen-space UV offsets.
 * 
 * Pipeline:
 *   1. Render distortion-emitting particles to an RG16float texture (UV offset)
 *   2. Composite pass samples scene color with distorted UVs
 * 
 * The distortion texture stores per-pixel UV offset (R=deltaU, G=deltaV).
 * Particles contribute based on temperature/emissive strength.
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { calcWGSLStructSize } from "../../core/gpu/WGSLStructSize.js";

// ============================================================================
// DISTORTION PARTICLE SHADER
// Renders particles as UV offset contributors to a distortion buffer
// ============================================================================

const DISTORTION_SHADER = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  viewRight: vec3<f32>,
  _pad0: f32,
  viewUp: vec3<f32>,
  _pad1: f32,
  cameraPos: vec3<f32>,
  _pad2: f32,
};

struct DistortionParams {
  strength: f32,       // Global distortion strength multiplier
  temperatureThreshold: f32, // Min temperature to emit distortion (Kelvin)
  falloffPower: f32,   // Edge falloff exponent
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uFrame: FrameUniforms;
@group(1) @binding(0) var<storage, read> uPositions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> uVelocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> uThermalData: array<vec4<f32>>;
@group(1) @binding(3) var<storage, read> uMeta: array<vec4<f32>>;
@group(1) @binding(4) var<uniform> uParams: DistortionParams;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,
  @location(1) distortionStrength: f32,
  @location(2) velocity: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let pos4 = uPositions[ii];
  let center = pos4.xyz;
  let age = pos4.w;
  let vel4 = uVelocities[ii];
  let lifetime = max(vel4.w, 0.1);

  // Dead particle early-out
  if (age >= lifetime) {
    var out: VSOut;
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    out.localPos = vec2<f32>(0.0);
    out.distortionStrength = 0.0;
    out.velocity = vec2<f32>(0.0);
    return out;
  }

  let thermal = uThermalData[ii];
  let temperature = thermal.x;
  let phase = thermal.y;

  // Only distort if above temperature threshold (hot particles)
  // Or if phase is gas/plasma (2+) and temperature is elevated
  let tempFactor = max(0.0, (temperature - uParams.temperatureThreshold) / 1000.0);
  let phaseFactor = select(0.3, 1.0, phase >= 2.0);
  let distStr = tempFactor * phaseFactor * uParams.strength;

  // Lifetime fade: ramp up quickly, fade out near death
  let t = clamp(age / lifetime, 0.0, 1.0);
  let lifeFade = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.8, 1.0, t));
  let finalStrength = distStr * lifeFade;

  // Extract size from packed meta
  let packedMeta = uMeta[ii].w;
  let particleSize = (floor(packedMeta / 1e4) % 100.0) * 0.1;
  // Distortion billboards are slightly larger than visual particles (haze extends beyond)
  let radius = particleSize * 0.5 * 1.5;

  // Quad corners
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  let corner = corners[vi % 6u];

  let worldOffset = uFrame.viewRight * corner.x * radius + uFrame.viewUp * corner.y * radius;
  let worldPos = center + worldOffset;
  let clipPos = uFrame.viewProj * vec4<f32>(worldPos, 1.0);

  // Project velocity to screen space for directional distortion
  let velClip = uFrame.viewProj * vec4<f32>(vel4.xyz, 0.0);
  let velScreen = vec2<f32>(velClip.x, velClip.y) * 0.01;

  var out: VSOut;
  out.position = select(clipPos, vec4<f32>(0.0, 0.0, -2.0, 1.0), finalStrength < 0.001);
  out.localPos = corner;
  out.distortionStrength = finalStrength;
  out.velocity = velScreen;
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let dist = length(input.localPos);
  if (dist > 1.0) { discard; }

  // Radial falloff with configurable power
  let falloff = pow(1.0 - dist, 2.0);

  // Distortion direction: radial outward + velocity bias
  let radialDir = normalize(input.localPos);
  let distortDir = radialDir * 0.7 + input.velocity * 0.3;

  // UV offset: direction × strength × falloff
  let uvOffset = distortDir * input.distortionStrength * falloff * 0.02;

  // Output: RG = UV offset, BA unused (additive blend accumulates offsets)
  return vec4<f32>(uvOffset.x, uvOffset.y, 0.0, falloff * input.distortionStrength);
}
`;

// ============================================================================
// DISTORTION COMPOSITE SHADER
// Applies accumulated UV offsets to scene color
// ============================================================================

const DISTORTION_COMPOSITE_SHADER = /* wgsl */`
@group(0) @binding(0) var sceneColor: texture_2d<f32>;
@group(0) @binding(1) var distortionTex: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var out: VSOut;
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  out.position = vec4<f32>(x * 2.0 - 1.0, -(y * 2.0 - 1.0), 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let distortion = textureSample(distortionTex, linearSampler, input.uv);
  let uvOffset = distortion.xy;

  // Sample scene with distorted UVs
  let distortedUV = input.uv + uvOffset;
  let color = textureSample(sceneColor, linearSampler, distortedUV);

  return color;
}
`;

// ============================================================================
// RENDERER CREATION
// ============================================================================

/**
 * Create the particle distortion rendering system
 * @param {GPUDevice} device
 * @param {string} sceneFormat - Scene color format (e.g. 'bgra8unorm')
 * @param {number} width - Render target width
 * @param {number} height - Render target height
 */
export function createParticleDistortionRenderer(device, sceneFormat, width, height) {
  // Distortion pass shader
  const distortionModule = device.createShaderModule({
    label: "ParticleDistortion.shader",
    code: DISTORTION_SHADER,
  });

  // Composite pass shader
  const compositeModule = device.createShaderModule({
    label: "ParticleDistortionComposite.shader",
    code: DISTORTION_COMPOSITE_SHADER,
  });

  // Distortion accumulation texture (RG16float for UV offsets)
  const distortionTexture = device.createTexture({
    label: "ParticleDistortion.texture",
    size: { width, height },
    format: 'rg16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const distortionView = distortionTexture.createView();

  // Frame uniforms buffer (auto-sized from WGSL struct)
  const frameBufferSize = calcWGSLStructSize(`struct FrameUniforms {
    viewProj: mat4x4<f32>,
    viewRight: vec3<f32>,
    _pad0: f32,
    viewUp: vec3<f32>,
    _pad1: f32,
    cameraPos: vec3<f32>,
    _pad2: f32,
  }`);
  const frameBuffer = device.createBuffer({
    label: "ParticleDistortion.frameBuffer",
    size: frameBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: false,
  });

  // Distortion params buffer
  const paramsBuffer = device.createBuffer({
    label: "ParticleDistortion.paramsBuffer",
    size: 16, // 4 floats
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // Default params: strength=1.0, threshold=500K, falloff=2.0
  device.queue.writeBuffer(paramsBuffer, 0, new Float32Array([1.0, 500.0, 2.0, 0.0]));

  // Distortion pass pipeline (additive blend for accumulating UV offsets)
  const distortionPipeline = device.createRenderPipeline({
    label: "ParticleDistortion.pipeline",
    layout: 'auto',
    vertex: { module: distortionModule, entryPoint: 'vs_main' },
    fragment: {
      module: distortionModule,
      entryPoint: 'fs_main',
      targets: [{
        format: 'rg16float',
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });

  // Composite pipeline (samples distortion + scene, outputs corrected color)
  const compositePipeline = device.createRenderPipeline({
    label: "ParticleDistortionComposite.pipeline",
    layout: 'auto',
    vertex: { module: compositeModule, entryPoint: 'vs_main' },
    fragment: {
      module: compositeModule,
      entryPoint: 'fs_main',
      targets: [{ format: sceneFormat }],
    },
    primitive: { topology: 'triangle-list' },
  });

  // Sampler for composite pass
  const linearSampler = device.createSampler({
    label: "ParticleDistortion.sampler",
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  return {
    device,
    distortionTexture,
    distortionView,
    frameBuffer,
    paramsBuffer,
    distortionPipeline,
    compositePipeline,
    linearSampler,
    width,
    height,
    _dataBindGroup: null,
    _compositeBindGroup: null,
  };
}

/**
 * Create bind groups for the distortion pass (call once when particle buffers are ready)
 */
export function initDistortionBindGroups(renderer, particleWorld, sceneColorView) {
  if (!renderer || !particleWorld || !renderer.device) return;
  const device = renderer.device;

  // Group 0: frame uniforms
  const frameBindGroup = device.createBindGroup({
    label: "ParticleDistortion.frameBindGroup",
    layout: renderer.distortionPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: renderer.frameBuffer } },
    ],
  });

  // Group 1: particle data
  const dataBindGroup = device.createBindGroup({
    label: "ParticleDistortion.dataBindGroup",
    layout: renderer.distortionPipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: particleWorld.positionBuffer } },
      { binding: 1, resource: { buffer: particleWorld.velocityBuffer } },
      { binding: 2, resource: { buffer: particleWorld.thermalBuffer } },
      { binding: 3, resource: { buffer: particleWorld.metaBuffer } },
      { binding: 4, resource: { buffer: renderer.paramsBuffer } },
    ],
  });

  // Composite bind group
  const compositeBindGroup = device.createBindGroup({
    label: "ParticleDistortionComposite.bindGroup",
    layout: renderer.compositePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sceneColorView },
      { binding: 1, resource: renderer.distortionView },
      { binding: 2, resource: renderer.linearSampler },
    ],
  });

  renderer._frameBindGroup = frameBindGroup;
  renderer._dataBindGroup = dataBindGroup;
  renderer._compositeBindGroup = compositeBindGroup;
}

/**
 * Update distortion params
 * @param {Object} renderer
 * @param {Object} params - { strength, temperatureThreshold, falloffPower }
 */
export function setDistortionParams(renderer, params = {}) {
  if (!renderer?.device) return;
  const data = new Float32Array([
    params.strength ?? 1.0,
    params.temperatureThreshold ?? 500.0,
    params.falloffPower ?? 2.0,
    0.0,
  ]);
  renderer.device.queue.writeBuffer(renderer.paramsBuffer, 0, data);
}

/**
 * Render distortion pass: accumulate UV offsets from hot particles
 * @param {GPUCommandEncoder} encoder
 * @param {Object} renderer
 * @param {number} instanceCount - Number of particles to render
 * @param {Float32Array} frameData - Frame uniforms data (viewProj, viewRight, viewUp, cameraPos)
 */
export function renderDistortionPass(encoder, renderer, instanceCount, frameData) {
  if (!renderer?._dataBindGroup || instanceCount <= 0) return;

  // Update frame uniforms
  if (frameData) {
    renderer.device.queue.writeBuffer(renderer.frameBuffer, 0, frameData);
  }

  // Clear and render to distortion texture
  const pass = encoder.beginRenderPass({
    label: "ParticleDistortion.renderPass",
    colorAttachments: [{
      view: renderer.distortionView,
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });

  pass.setPipeline(renderer.distortionPipeline);
  pass.setBindGroup(0, renderer._frameBindGroup);
  pass.setBindGroup(1, renderer._dataBindGroup);
  pass.draw(6, instanceCount);
  pass.end();
}

/**
 * Composite distortion onto scene (fullscreen triangle)
 * @param {GPURenderPassEncoder} pass - Active render pass targeting the scene framebuffer
 * @param {Object} renderer
 */
export function compositeDistortion(pass, renderer) {
  if (!renderer?._compositeBindGroup) return;
  pass.setPipeline(renderer.compositePipeline);
  pass.setBindGroup(0, renderer._compositeBindGroup);
  pass.draw(3);
}

/**
 * Resize distortion texture when viewport changes
 */
export function resizeDistortionRenderer(renderer, width, height) {
  if (!renderer?.device) return;
  if (renderer.distortionTexture) renderer.distortionTexture.destroy();

  renderer.distortionTexture = renderer.device.createTexture({
    label: "ParticleDistortion.texture",
    size: { width, height },
    format: 'rg16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  renderer.distortionView = renderer.distortionTexture.createView();
  renderer.width = width;
  renderer.height = height;
  // Bind groups need to be recreated after resize
  renderer._compositeBindGroup = null;
}

/**
 * Destroy distortion renderer resources
 */
export function destroyDistortionRenderer(renderer) {
  if (!renderer) return;
  if (renderer.distortionTexture) renderer.distortionTexture.destroy();
  if (renderer.frameBuffer) renderer.frameBuffer.destroy();
  if (renderer.paramsBuffer) renderer.paramsBuffer.destroy();
  renderer._dataBindGroup = null;
  renderer._compositeBindGroup = null;
  renderer._frameBindGroup = null;
}
