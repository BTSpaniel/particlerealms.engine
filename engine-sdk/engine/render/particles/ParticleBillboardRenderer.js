// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { getShaderSource } from "../shaders/ShaderLoaderJS.js";
import { 
  FRAME_UNIFORMS_SCHEMA, 
  PARTICLE_PARAMS_SCHEMA,
  writeUniformField,
} from "../shaders/ShaderSchema.js";
import { initVGPU } from "../../core/gpu/VirtualGPU.js";

function createDefaultAlbedoResources(device) {
  const vgpu = initVGPU(device);
  const texture = vgpu.texture.create({
    width: 1, height: 1, format: 'rgba8unorm',
    usage: 'texture|copy-dst', label: 'Engine.Particles.DefaultAlbedo'
  }).texture;

  device.queue.writeTexture(
    { texture },
    new Uint8Array([255, 255, 255, 255]),
    { bytesPerRow: 4 },
    { width: 1, height: 1 }
  );

  const view = texture.createView();
  const sampler = vgpu.texture.sampler({ filter: 'linear', addressMode: 'repeat' });

  return { texture, view, sampler };
}

/**
 * Creates a particle point renderer (spheres instead of flat billboards).
 * This renders particles as actual points with spherical falloff.
 */
export async function createParticlePointRenderer(options) {
  const { device, format, blendMode } = options || {};
  if (!device) throw new Error("createParticlePointRenderer: device required");
  if (!format) throw new Error("createParticlePointRenderer: format required");

  const mode = blendMode === "additive" ? "additive" : "alpha";
  const blend =
    mode === "additive"
      ? {
          color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
        }
      : {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        };

  const vgpu = initVGPU(device);
  const shaderCode = getShaderSource("core/particles_point");
  const shaderModule = vgpu.shader.compile('particlePoint', shaderCode);

  // Define explicit bind group layouts
  const frameLayout = vgpu.bindings.defineLayout('particlePointFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);
  const dataLayout = vgpu.bindings.defineLayout('particlePointData', [
    { binding: 0, type: 'read-storage', visibility: 'vertex' },
    { binding: 1, type: 'read-storage', visibility: 'vertex' },
    { binding: 2, type: 'uniform', visibility: 'vertex|fragment' },
    { binding: 3, type: 'read-storage', visibility: 'vertex' },
    { binding: 4, type: 'read-storage', visibility: 'vertex' },
    { binding: 5, type: 'texture', visibility: 'fragment', sampleType: 'float' },
    { binding: 6, type: 'sampler', visibility: 'fragment' },
  ]);

  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    layouts: [frameLayout, dataLayout],
    colorFormat: format,
    blend: mode === 'additive' ? 'additive' : 'alpha',
    cullMode: 'none',
    depthFormat: 'depth24plus',
    depthWrite: false,
    depthCompare: 'less-equal',
    topology: 'triangle-list',
    label: 'ParticlePointPipeline'
  });

  // Use ShaderSchema for consistent buffer sizes
  const frameBuffer = vgpu.buffer.create({ size: FRAME_UNIFORMS_SCHEMA.size || 96, usage: 'uniform', label: 'ParticlePointFrame' }).buffer;
  const paramsBuffer = vgpu.buffer.create({ size: PARTICLE_PARAMS_SCHEMA.size, usage: 'uniform', label: 'ParticlePointParams' }).buffer;

  const frameBindGroup = vgpu.bindings.createGroup(frameLayout, [
    { binding: 0, buffer: frameBuffer },
  ]);

  const { texture: albedoTexture, view: albedoTextureView, sampler: albedoSampler } = createDefaultAlbedoResources(device);
  const dummyUvBuffer = createStorageBuffer(device, 16, { label: "Engine.Particles.DummyUVs" });

  return {
    device,
    pipeline,
    frameBuffer,
    paramsBuffer,
    _paramsData: new Float32Array(8),
    frameBindGroup,
    dataLayout,
    albedoTexture,
    albedoTextureView,
    albedoSampler,
    dummyUvBuffer,
  };
}

/**
 * Creates a particle billboard renderer.
 * This is a pure rendering module - it does not own particle simulation.
 */
export async function createParticleBillboardRenderer(options) {
  const { device, format, blendMode } = options || {};
  if (!device) throw new Error("createParticleBillboardRenderer: device required");
  if (!format) throw new Error("createParticleBillboardRenderer: format required");

  const mode = blendMode === "additive" ? "additive" : "alpha";

  const vgpu = initVGPU(device);
  const shaderCode = getShaderSource("core/particles_billboard");
  const shaderModule = vgpu.shader.compile('particleBillboard', shaderCode);

  // Define explicit bind group layouts
  const frameLayout = vgpu.bindings.defineLayout('particleBillboardFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);
  const dataLayout = vgpu.bindings.defineLayout('particleBillboardData', [
    { binding: 0, type: 'read-storage', visibility: 'vertex' },
    { binding: 1, type: 'read-storage', visibility: 'vertex' },
    { binding: 2, type: 'uniform', visibility: 'vertex|fragment' },
    { binding: 3, type: 'read-storage', visibility: 'vertex' },
    { binding: 4, type: 'read-storage', visibility: 'vertex' },
    { binding: 5, type: 'texture', visibility: 'fragment', sampleType: 'float' },
    { binding: 6, type: 'sampler', visibility: 'fragment' },
  ]);
  // Group 2: Scene depth for soft particles (GAP 17) + alive list for indirect draw (GAP 18)
  const depthLayout = vgpu.bindings.defineLayout('particleBillboardDepth', [
    { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'depth', viewDimension: '2d' },
    { binding: 1, type: 'read-storage', visibility: 'vertex' }, // aliveList for indirect draw
  ]);

  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    layouts: [frameLayout, dataLayout, depthLayout],
    colorFormat: format,
    blend: mode === 'additive' ? 'additive' : 'alpha',
    cullMode: 'none',
    depthFormat: 'depth24plus',
    depthWrite: false,
    depthCompare: 'less-equal',
    topology: 'triangle-list',
    label: 'ParticleBillboardPipeline'
  });

  // Use ShaderSchema for consistent buffer sizes
  const frameBuffer = vgpu.buffer.create({ size: FRAME_UNIFORMS_SCHEMA.size || 96, usage: 'uniform', label: 'ParticleBillboardFrame' }).buffer;
  const paramsBuffer = vgpu.buffer.create({ size: PARTICLE_PARAMS_SCHEMA.size, usage: 'uniform', label: 'ParticleBillboardParams' }).buffer;

  const frameBindGroup = vgpu.bindings.createGroup(frameLayout, [
    { binding: 0, buffer: frameBuffer },
  ]);

  const { texture: albedoTexture, view: albedoTextureView, sampler: albedoSampler } = createDefaultAlbedoResources(device);
  const dummyUvBuffer = vgpu.buffer.create({ size: 16, usage: 'storage', label: 'ParticleDummyUVs' }).buffer;

  // Create a 1x1 dummy depth texture for when no scene depth is provided
  const dummyDepthTex = device.createTexture({
    size: [1, 1], format: 'depth24plus',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    label: 'ParticleBillboard.dummyDepth',
  });
  const dummyDepthView = dummyDepthTex.createView();
  // Dummy alive list: identity mapping (slot[i] = i) for non-indirect fallback
  const dummyAliveBuffer = vgpu.buffer.create({ size: 16, usage: 'storage', label: 'ParticleBillboard.dummyAlive' }).buffer;
  const depthBindGroup = vgpu.bindings.createGroup(depthLayout, [
    { binding: 0, textureView: dummyDepthView },
    { binding: 1, buffer: dummyAliveBuffer },
  ]);

  return {
    device,
    pipeline,
    frameBuffer,
    paramsBuffer,
    frameBindGroup,
    dataLayout,
    depthLayout,
    depthBindGroup,
    dummyDepthTex,
    albedoTexture,
    albedoTextureView,
    albedoSampler,
    dummyUvBuffer,
  };
}

/**
 * Creates a data bind group for a specific particle world.
 * Call this once per particle world you want to render.
 * @param {Object} renderer - The particle billboard renderer
 * @param {GPUBuffer} positionBuffer - The particle position buffer (xyz=pos, w=age)
 * @param {GPUBuffer} metaBuffer - The per-particle metadata buffer (rgb=color, w=size+shape)
 * @param {GPUBuffer} velocityBuffer - The particle velocity buffer (xyz=vel, w=lifetime)
 */
export function createParticleBillboardDataBindGroup(
  renderer,
  positionBuffer,
  metaBuffer,
  velocityBuffer,
  uvBuffer,
  albedoTextureView,
  albedoSampler
) {
  const uv = uvBuffer || renderer.dummyUvBuffer;
  const texView = albedoTextureView || renderer.albedoTextureView;
  const samp = albedoSampler || renderer.albedoSampler;
  const vgpu = initVGPU(renderer.device);
  return vgpu.bindings.createGroup(renderer.dataLayout, [
    { binding: 0, buffer: positionBuffer },
    { binding: 1, buffer: metaBuffer },
    { binding: 2, buffer: renderer.paramsBuffer },
    { binding: 3, buffer: velocityBuffer },
    { binding: 4, buffer: uv },
    { binding: 5, textureView: texView },
    { binding: 6, sampler: samp },
  ]);
}

/**
 * Updates particle rendering parameters including quality settings.
 * 
 * @param {Object} renderer - Particle renderer
 * @param {Object} params
 * @param {number} params.size - Default particle size (fallback)
 * @param {number} params.quality - Quality scalar 0.0-1.0 (1.0 = full quality)
 * @param {number} params.lodBias - Distance LOD aggressiveness (1.0 = normal)
 * @param {number} params.cullThreshold - Max particles to render (0 = no limit)
 */
export function setParticleBillboardParams(renderer, { 
  size = 1, 
  quality = 1.0, 
  lodBias = 1.0, 
  cullThreshold = 0,
  rotationRate = 0,
  useColorGradient = false,
  stretchFactor = 0,
  facingMode = 0,
}) {
  // ParticleParams struct: { defaultSize, quality, lodBias, cullThreshold, rotationRate, useColorGradient, stretchFactor, facingMode }
  const params = renderer && renderer._paramsData ? renderer._paramsData : new Float32Array(8);
  params[0] = size;
  params[1] = Math.max(0, Math.min(1, quality));
  params[2] = Math.max(0.5, Math.min(3, lodBias));
  params[3] = cullThreshold;
  params[4] = rotationRate;
  params[5] = useColorGradient ? 1.0 : 0.0;
  params[6] = stretchFactor ?? 0;
  params[7] = facingMode ?? 0;
  updateBuffer(renderer.device, renderer.paramsBuffer, params, 0);
}

/**
 * Create or update the scene depth + alive list bind group (GAP 17 + 18).
 * Call this when the depth texture changes (e.g. on resize) or when
 * connecting the alive list from IndirectDispatch for GPU indirect draw.
 * @param {Object} renderer - The billboard renderer
 * @param {GPUTextureView} depthTextureView - Scene depth texture view
 * @param {GPUBuffer} aliveListBuffer - Alive list buffer from IndirectDispatch (optional)
 */
export function setParticleBillboardDepth(renderer, depthTextureView, aliveListBuffer) {
  if (!renderer || !depthTextureView) return;
  const vgpu = initVGPU(renderer.device);
  renderer.depthBindGroup = vgpu.bindings.createGroup(renderer.depthLayout, [
    { binding: 0, textureView: depthTextureView },
    { binding: 1, buffer: aliveListBuffer || renderer.dummyAliveBuffer || renderer.dummyUvBuffer },
  ]);
}
