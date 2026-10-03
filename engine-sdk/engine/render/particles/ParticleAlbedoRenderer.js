// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Particle Albedo Pass Renderer
 * 
 * Renders particle base color/albedo to a texture for G-buffer visualization.
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { particleAlbedoPassShader } from "../shaders/modules/passes/particle_albedo.js";
import { 
  FRAME_UNIFORMS_SCHEMA, 
  PARTICLE_PARAMS_SCHEMA 
} from "../shaders/ShaderSchema.js";
import { initVGPU } from "../../core/gpu/VirtualGPU.js";

/**
 * Create particle albedo pass renderer
 */
export async function createParticleAlbedoRenderer(options) {
  const { device, format = 'rgba16float' } = options || {};
  if (!device) throw new Error("createParticleAlbedoRenderer: device required");

  const vgpu = initVGPU(device);
  
  console.log('[ParticleAlbedoRenderer] Compiling albedo shader...');
  const shaderModule = vgpu.shader.compile('particleAlbedo', particleAlbedoPassShader);
  
  if (!shaderModule || shaderModule.constructor.name === 'GPUValidationError') {
    console.error('[ParticleAlbedoRenderer] Shader compilation FAILED');
    throw new Error('Albedo shader compilation failed');
  }
  console.log('[ParticleAlbedoRenderer] Shader compiled successfully');

  // Define bind group layouts
  const frameLayout = vgpu.bindings.defineLayout('particleAlbedoFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);
  const dataLayout = vgpu.bindings.defineLayout('particleAlbedoData', [
    { binding: 0, type: 'read-storage', visibility: 'vertex' },
    { binding: 1, type: 'read-storage', visibility: 'vertex' },
    { binding: 2, type: 'uniform', visibility: 'vertex|fragment' },
    { binding: 3, type: 'read-storage', visibility: 'vertex' },
  ]);

  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    layouts: [frameLayout, dataLayout],
    colorFormat: format,
    blend: {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
    cullMode: 'none',
    depthFormat: 'depth24plus',
    depthWrite: false,
    depthCompare: 'less-equal',
    topology: 'triangle-list',
    label: 'ParticleAlbedoPipeline'
  });

  const frameBuffer = vgpu.buffer.create({ 
    size: FRAME_UNIFORMS_SCHEMA.size || 96, 
    usage: 'uniform', 
    label: 'ParticleAlbedoFrame' 
  }).buffer;
  
  const paramsBuffer = vgpu.buffer.create({ 
    size: PARTICLE_PARAMS_SCHEMA.size, 
    usage: 'uniform', 
    label: 'ParticleAlbedoParams' 
  }).buffer;

  const frameBindGroup = vgpu.bindings.createGroup(frameLayout, [
    { binding: 0, buffer: frameBuffer },
  ]);

  return {
    device,
    pipeline,
    frameBuffer,
    paramsBuffer,
    frameBindGroup,
    dataLayout,
  };
}

/**
 * Create data bind group for albedo pass
 */
export function createParticleAlbedoDataBindGroup(
  renderer,
  positionBuffer,
  metaBuffer,
  velocityBuffer
) {
  const vgpu = initVGPU(renderer.device);
  return vgpu.bindings.createGroup(renderer.dataLayout, [
    { binding: 0, buffer: positionBuffer },
    { binding: 1, buffer: metaBuffer },
    { binding: 2, buffer: renderer.paramsBuffer },
    { binding: 3, buffer: velocityBuffer },
  ]);
}

/**
 * Update albedo pass parameters
 */
export function setParticleAlbedoParams(renderer, { 
  size = 1, 
  quality = 1.0, 
  lodBias = 1.0, 
  cullThreshold = 0 
}) {
  const params = new Float32Array(4);
  params[0] = size;
  params[1] = Math.max(0, Math.min(1, quality));
  params[2] = Math.max(0.5, Math.min(3, lodBias));
  params[3] = cullThreshold;
  updateBuffer(renderer.device, renderer.paramsBuffer, params, 0);
}
