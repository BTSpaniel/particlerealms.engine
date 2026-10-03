// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Particle Depth Pass Renderer
 * 
 * Renders particles to a depth texture for visualization and later compositing.
 * Uses modular shader library for depth functions.
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { particleDepthPassShader } from "../shaders/modules/passes/particle_depth.js";
import { 
  FRAME_UNIFORMS_SCHEMA, 
  PARTICLE_PARAMS_SCHEMA 
} from "../shaders/ShaderSchema.js";
import { initVGPU } from "../../core/gpu/VirtualGPU.js";

/**
 * Create particle depth pass renderer
 */
export async function createParticleDepthRenderer(options) {
  const { device, format = 'rgba16float' } = options || {};
  if (!device) throw new Error("createParticleDepthRenderer: device required");

  const vgpu = initVGPU(device);
  
  console.log('[ParticleDepthRenderer] Compiling depth shader...');
  const shaderModule = vgpu.shader.compile('particleDepth', particleDepthPassShader);
  
  if (!shaderModule || shaderModule.constructor.name === 'GPUValidationError') {
    console.error('[ParticleDepthRenderer] Shader compilation FAILED');
    throw new Error('Depth shader compilation failed');
  }
  console.log('[ParticleDepthRenderer] Shader compiled successfully');

  // Define bind group layouts
  const frameLayout = vgpu.bindings.defineLayout('particleDepthFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);
  const dataLayout = vgpu.bindings.defineLayout('particleDepthData', [
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
    label: 'ParticleDepthPipeline'
  });

  const frameBuffer = vgpu.buffer.create({ 
    size: FRAME_UNIFORMS_SCHEMA.size || 96, 
    usage: 'uniform', 
    label: 'ParticleDepthFrame' 
  }).buffer;
  
  const paramsBuffer = vgpu.buffer.create({ 
    size: PARTICLE_PARAMS_SCHEMA.size, 
    usage: 'uniform', 
    label: 'ParticleDepthParams' 
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
 * Create data bind group for depth pass
 */
export function createParticleDepthDataBindGroup(
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
 * Update depth pass parameters
 */
export function setParticleDepthParams(renderer, { 
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
