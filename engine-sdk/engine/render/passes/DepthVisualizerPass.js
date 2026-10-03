// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Depth Visualizer Pass
 * 
 * Fullscreen pass that visualizes depth texture as grayscale image.
 */

import { depthVisualizerShader } from '../shaders/modules/passes/depth_visualizer.js';
import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Reusable buffer for hot paths (reduce/reuse/recycle)
const _depthVisualizerParams = new Float32Array(4);

export async function createDepthVisualizerPass(device, outputFormat) {
  const vgpu = initVGPU(device);
  const shaderModule = vgpu.shader.compile('depthVisualizer', depthVisualizerShader);

  // Bind group layout
  const layout = vgpu.bindings.defineLayout('depthVisualizerLayout', [
    { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'float' },
    { binding: 1, type: 'uniform', visibility: 'fragment' },
  ]);

  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    layouts: [layout],
    colorFormat: outputFormat,
    blend: 'replace',
    cullMode: 'none',
    depthFormat: 'depth24plus',
    depthWrite: false,
    depthCompare: 'always',
    topology: 'triangle-list',
    label: 'DepthVisualizerPipeline'
  });

  // Params buffer for visualization settings
  const paramsBuffer = vgpu.buffer.create({
    size: 16, // vec4: nearPlane, farPlane, visualizationMode, pad
    usage: 'uniform',
    label: 'DepthVisualizerParams'
  }).buffer;

  return {
    device,
    pipeline,
    layout,
    paramsBuffer,
  };
}

/**
 * Execute depth visualizer pass
 */
export function executeDepthVisualizerPass(pass, visualizer, depthTexture, params = {}) {
  const { nearPlane = 0.1, farPlane = 100.0, mode = 0 } = params;
  
  const vgpu = initVGPU(visualizer.device);
  
  // Update params - reuse buffer to avoid GC pressure
  _depthVisualizerParams[0] = nearPlane;
  _depthVisualizerParams[1] = farPlane;
  _depthVisualizerParams[2] = mode;
  _depthVisualizerParams[3] = 0;
  visualizer.device.queue.writeBuffer(visualizer.paramsBuffer, 0, _depthVisualizerParams);
  
  // Create bind group with depth texture
  const bindGroup = vgpu.bindings.createGroup(visualizer.layout, [
    { binding: 0, textureView: depthTexture },
    { binding: 1, buffer: visualizer.paramsBuffer },
  ]);
  
  // Draw fullscreen triangle
  pass.setPipeline(visualizer.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
}
