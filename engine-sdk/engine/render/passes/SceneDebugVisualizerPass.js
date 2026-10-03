// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Scene Debug Visualizer Pass
 * 
 * Fullscreen post-process that reads the ACTUAL scene depth buffer (depth24plus)
 * and renders industry-standard debug visualizations:
 *   - Depth: linearized grayscale (near=white, far=black)
 *   - Normals: world-space normals reconstructed from depth (RGB = XYZ)
 *
 * Unlike the particle-only debug renderers, this shows the FULL scene
 * (entity meshes + particles + everything that wrote to the depth buffer).
 */

import { sceneDebugVisualizerShader } from '../shaders/modules/passes/scene_debug_visualizer.js';
import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Reusable param buffer to avoid GC pressure
const _params = new Float32Array(24); // mat4(16) + 8 floats

/**
 * Create the scene debug visualizer pass
 * @param {GPUDevice} device
 * @param {string} outputFormat - Swapchain format (e.g. 'bgra8unorm')
 * @returns {Promise<Object>} Visualizer resources
 */
export async function createSceneDebugVisualizerPass(device, outputFormat) {
  const vgpu = initVGPU(device);
  
  const shaderModule = vgpu.shader.compile('sceneDebugVisualizer', sceneDebugVisualizerShader);
  if (!shaderModule) throw new Error('SceneDebugVisualizer shader compilation failed');

  const layout = vgpu.bindings.defineLayout('sceneDebugVisualizerLayout', [
    { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'depth' },
    { binding: 1, type: 'uniform', visibility: 'fragment' },
    { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'unfilterable-float' },
  ]);

  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    layouts: [layout],
    colorFormat: outputFormat,
    blend: 'replace',
    cullMode: 'none',
    depthFormat: null, // No depth — this is a post-process
    topology: 'triangle-list',
    label: 'SceneDebugVisualizerPipeline'
  });

  // Params buffer: mat4x4 (invViewProj) + nearPlane + farPlane + mode + pad + texelSize + pad
  const paramsBuffer = vgpu.buffer.create({
    size: 96, // 24 * 4 bytes
    usage: 'uniform',
    label: 'SceneDebugVisualizerParams'
  }).buffer;

  // 1x1 black fallback for when no particle depth texture is available
  const fallbackTex = device.createTexture({
    size: [1, 1, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
    label: 'SceneDebugViz_fallbackParticleDepth',
  });
  const fallbackView = fallbackTex.createView();

  return {
    device,
    pipeline,
    layout,
    paramsBuffer,
    fallbackView,
  };
}

/**
 * Execute the scene debug visualizer pass
 * @param {GPUCommandEncoder} encoder
 * @param {GPUTextureView} outputView - Swapchain texture view to render into
 * @param {GPUTextureView} depthView - Scene depth texture view (depth24plus, TEXTURE_BINDING)
 * @param {Object} visualizer - Resources from createSceneDebugVisualizerPass
 * @param {Object} opts
 * @param {Float32Array} opts.invViewProj - 4x4 inverse view-projection matrix
 * @param {number} opts.nearPlane
 * @param {number} opts.farPlane
 * @param {number} opts.mode - 0=depth, 1=normals
 * @param {number} opts.width - Canvas width
 * @param {number} opts.height - Canvas height
 * @param {GPUTextureView} [opts.particleDepthView] - Particle depth color texture (rgba16float)
 */
export function executeSceneDebugVisualizerPass(encoder, outputView, depthView, visualizer, opts) {
  const { invViewProj, nearPlane = 0.1, farPlane = 1000.0, mode = 0, width, height, particleDepthView } = opts;
  
  const vgpu = initVGPU(visualizer.device);
  
  // Pack uniforms
  _params.set(invViewProj, 0);    // mat4x4 at offset 0
  _params[16] = nearPlane;         // offset 64
  _params[17] = farPlane;          // offset 68
  // mode is u32 — write as uint32 into the float array's buffer
  new Uint32Array(_params.buffer, 72, 1)[0] = mode;
  _params[19] = 0;                 // pad
  _params[20] = 1.0 / width;      // texelSize.x
  _params[21] = 1.0 / height;     // texelSize.y
  _params[22] = 0;                 // pad
  _params[23] = 0;                 // pad
  
  visualizer.device.queue.writeBuffer(visualizer.paramsBuffer, 0, _params);
  
  // Create bind group (use fallback 1x1 if no particle depth available)
  const pdView = particleDepthView || visualizer.fallbackView;
  const bindGroup = vgpu.bindings.createGroup(visualizer.layout, [
    { binding: 0, textureView: depthView },
    { binding: 1, buffer: visualizer.paramsBuffer },
    { binding: 2, textureView: pdView },
  ]);
  
  // Render fullscreen triangle to output
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: outputView,
      loadOp: 'clear',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      storeOp: 'store'
    }],
  });
  
  pass.setPipeline(visualizer.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
}
