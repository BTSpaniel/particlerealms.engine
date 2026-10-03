// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Particle Velocity Pass Renderer
 * 
 * Renders particle velocity as color-coded heatmap visualization.
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { particleVelocityPassShader } from "../shaders/modules/passes/particle_velocity.js";
import { 
  FRAME_UNIFORMS_SCHEMA, 
  PARTICLE_PARAMS_SCHEMA 
} from "../shaders/ShaderSchema.js";
import { initVGPU } from "../../core/gpu/VirtualGPU.js";

export async function createParticleVelocityRenderer(options) {
  const { device, format = 'rgba16float' } = options || {};
  if (!device) throw new Error("createParticleVelocityRenderer: device required");

  const vgpu = initVGPU(device);
  
  console.log('[ParticleVelocityRenderer] Compiling velocity shader...');
  const shaderModule = vgpu.shader.compile('particleVelocity', particleVelocityPassShader);
  
  if (!shaderModule || shaderModule.constructor.name === 'GPUValidationError') {
    console.error('[ParticleVelocityRenderer] Shader compilation FAILED');
    throw new Error('Velocity shader compilation failed');
  }
  console.log('[ParticleVelocityRenderer] Shader compiled successfully');

  const frameLayout = vgpu.bindings.defineLayout('particleVelocityFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);
  const dataLayout = vgpu.bindings.defineLayout('particleVelocityData', [
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
    label: 'ParticleVelocityPipeline'
  });

  const frameBuffer = vgpu.buffer.create({ 
    size: FRAME_UNIFORMS_SCHEMA.size || 96, 
    usage: 'uniform', 
    label: 'ParticleVelocityFrame' 
  }).buffer;
  
  const paramsBuffer = vgpu.buffer.create({ 
    size: PARTICLE_PARAMS_SCHEMA.size, 
    usage: 'uniform', 
    label: 'ParticleVelocityParams' 
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

export function createParticleVelocityDataBindGroup(
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

export function setParticleVelocityParams(renderer, { 
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
