// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// =============================================================================
// FLUID WATER PASS - Screen-space water/metaball rendering
// Now powered by vGPU driver
// =============================================================================
// Orchestrates the 3-pass screen-space fluid rendering pipeline:
//   Pass 1: Render water/metaball particles as sphere impostors → depth texture
//   Pass 2: Bilateral blur to merge particles into smooth surface
//   Pass 3: Composite with refraction/reflection shading
//
// Usage:
//   const waterPass = createFluidWaterPass(device, { width, height });
//   // In render loop:
//   renderFluidWater(waterPass, encoder, {
//     particles,
//     sceneColor,
//     sceneDepth,
//     camera,
//   });

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { fluidWaterDepthWGSL } from "../shaders/modules/postfx/fluid_water_depth.js";
 import { fluidWaterBlurWGSL } from "../shaders/modules/postfx/fluid_water_blur.js";
 import { fluidWaterCompositeWGSL } from "../shaders/modules/postfx/fluid_water_composite.js";
 import { fluidWaterThicknessWGSL } from "../shaders/modules/postfx/fluid_water_thickness.js";

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _fluidDepthFrameData = new Float32Array(64);
const _fluidBlurParams = new Float32Array(8);
const _fluidCompositeFrameData = new Float32Array(64);

/**
 * Create resources for the fluid water rendering pass
 */
export function createFluidWaterPass(device, options = {}) {
  const vgpu = initVGPU(device);
  const width = options.width || 1920;
  const height = options.height || 1080;
  const scale = options.scale || 0.5;  // Render at half res for performance
  
  const scaledWidth = Math.max(1, Math.floor(width * scale));
  const scaledHeight = Math.max(1, Math.floor(height * scale));
  
  // Create textures using vGPU
  const fluidDepthTexture = vgpu.texture.create({
    width: scaledWidth, height: scaledHeight,
    format: 'rgba16float', usage: 'render|texture', label: 'FluidWaterDepth'
  }).texture;
  
  const blurTempTexture = vgpu.texture.create({
    width: scaledWidth, height: scaledHeight,
    format: 'rgba16float', usage: 'render|texture', label: 'FluidWaterBlurTemp'
  }).texture;
  
  const thicknessTexture = vgpu.texture.create({
    width: scaledWidth, height: scaledHeight,
    format: 'rgba16float', usage: 'render|texture', label: 'FluidWaterThickness'
  }).texture;
  
  const depthBuffer = vgpu.texture.create({
    width: scaledWidth, height: scaledHeight,
    format: 'depth24plus', usage: 'render', label: 'FluidWaterDepthBuffer'
  }).texture;
  
  // Create sampler and buffers
  const linearSampler = vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp' });
  const depthFrameBuffer = vgpu.buffer.create({ size: 256, usage: 'uniform', label: 'FluidWaterDepthFrame' }).buffer;
  const blurParamsBuffer = vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'FluidWaterBlurParams' }).buffer;
  const compositeFrameBuffer = vgpu.buffer.create({ size: 256, usage: 'uniform', label: 'FluidWaterCompositeFrame' }).buffer;
  
  // Create shader modules
  const depthShaderModule = vgpu.shader.compile('fluidWaterDepth', fluidWaterDepthWGSL);
  const blurShaderModule = vgpu.shader.compile('fluidWaterBlur', fluidWaterBlurWGSL);
  const compositeShaderModule = vgpu.shader.compile('fluidWaterComposite', fluidWaterCompositeWGSL);
  const thicknessShaderModule = vgpu.shader.compile('fluidWaterThickness', fluidWaterThicknessWGSL);
  
  // Define explicit bind group layouts
  const depthFrameLayout = vgpu.bindings.defineLayout('fluidWaterDepthFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);
  const depthParticleLayout = vgpu.bindings.defineLayout('fluidWaterDepthParticle', [
    { binding: 0, type: 'read-storage', visibility: 'vertex' },
    { binding: 1, type: 'read-storage', visibility: 'vertex' },
    { binding: 2, type: 'read-storage', visibility: 'vertex' },
  ]);
  const blurLayout = vgpu.bindings.defineLayout('fluidWaterBlur', [
    { binding: 0, type: 'uniform', visibility: 'fragment' },
    { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
  ]);
  const compositeLayout = vgpu.bindings.defineLayout('fluidWaterComposite', [
    { binding: 0, type: 'uniform', visibility: 'fragment' },
    { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
    { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'float' },
    { binding: 3, type: 'texture', visibility: 'fragment', sampleType: 'depth' },
    { binding: 5, type: 'texture', visibility: 'fragment', sampleType: 'float' },
  ]);
  
  // Pass 1: Depth pipeline (instanced spheres)
  const depthPipeline = vgpu.pipeline.render({
    vertex: { module: depthShaderModule, entryPoint: 'vs_main' },
    fragment: { module: depthShaderModule, entryPoint: 'fs_main' },
    layouts: [depthFrameLayout, depthParticleLayout],
    colorFormat: 'rgba16float',
    depthFormat: 'depth24plus',
    depthWrite: true,
    depthCompare: 'less',
    topology: 'triangle-list',
    label: 'FluidWaterDepthPipeline'
  });
  
  // Pass 2: Blur pipeline (fullscreen, no depth)
  const blurPipeline = vgpu.pipeline.render({
    vertex: { module: blurShaderModule, entryPoint: 'vs_main' },
    fragment: { module: blurShaderModule, entryPoint: 'fs_main' },
    layouts: [blurLayout],
    colorFormat: 'rgba16float',
    depthFormat: null,
    topology: 'triangle-list',
    label: 'FluidWaterBlurPipeline'
  });
  
  // Pass 3: Composite pipeline (fullscreen, outputs to swapchain, no depth)
  const compositePipeline = vgpu.pipeline.render({
    vertex: { module: compositeShaderModule, entryPoint: 'vs_main' },
    fragment: { module: compositeShaderModule, entryPoint: 'fs_main' },
    layouts: [compositeLayout],
    colorFormat: 'bgra8unorm',
    depthFormat: null,
    topology: 'triangle-list',
    label: 'FluidWaterCompositePipeline'
  });
  
  // Thickness pipeline (additive blending, no depth)
  const thicknessPipeline = vgpu.pipeline.render({
    vertex: { module: thicknessShaderModule, entryPoint: 'vs_main' },
    fragment: { module: thicknessShaderModule, entryPoint: 'fs_main' },
    layouts: [depthFrameLayout, depthParticleLayout],
    colorFormat: 'rgba16float',
    depthFormat: null,
    blend: 'additive',
    topology: 'triangle-list',
    label: 'FluidWaterThicknessPipeline'
  });
  
  return {
    device,
    vgpu,
    width: scaledWidth,
    height: scaledHeight,
    fullWidth: width,
    fullHeight: height,
    scale,
    // Textures
    fluidDepthTexture,
    blurTempTexture,
    thicknessTexture,
    depthBuffer,
    linearSampler,
    // Buffers
    depthFrameBuffer,
    blurParamsBuffer,
    compositeFrameBuffer,
    // Layouts
    depthFrameLayout,
    depthParticleLayout,
    blurLayout,
    compositeLayout,
    // Pipelines
    depthPipeline,
    blurPipeline,
    compositePipeline,
    thicknessPipeline,
    // Cached bind groups (will be created on first use)
    depthFrameBindGroup: null,
    blurHBindGroup: null,
    blurVBindGroup: null,
    compositeBindGroup: null,
  };
}

export { createFluidWaterPass as FluidWaterPass };

/**
 * Render water/metaball surfaces from particles
 */
export function renderFluidWater(pass, encoder, options = {}) {
  if (!pass || !encoder) return false;
  
  const {
    particles,
    sceneColorView,
    sceneDepthView,
    camera,
    view,
    projection,
    swapView,
  } = options;
  
  if (!particles || !particles.world) return false;
  if (!sceneColorView || !sceneDepthView) return false;
  if (!swapView) return false;
  
  const device = pass.device;
  const particleWorld = particles.world;
  const particleCount = particles.instanceCount || 0;
  
  if (particleCount <= 0) return false;
  
  // =========================================================================
  // PASS 1: Render particle spheres to depth texture
  // =========================================================================
  
  // Update depth frame uniform - reuse buffer
  const depthFrameData = _fluidDepthFrameData;
  // viewProj (mat4)
  if (projection && view) {
    // Simple matrix multiply for viewProj
    for (let i = 0; i < 16; i++) {
      let sum = 0;
      const row = Math.floor(i / 4);
      const col = i % 4;
      for (let k = 0; k < 4; k++) {
        sum += projection[row * 4 + k] * view[k * 4 + col];
      }
      depthFrameData[i] = sum;
    }
  }
  // view (mat4)
  if (view) {
    for (let i = 0; i < 16; i++) {
      depthFrameData[16 + i] = view[i];
    }
  }
  // proj (mat4)
  if (projection) {
    for (let i = 0; i < 16; i++) {
      depthFrameData[32 + i] = projection[i];
    }
  }
  // cameraPos + sphereScale
  if (camera) {
    depthFrameData[48] = camera.eye ? camera.eye[0] : 0;
    depthFrameData[49] = camera.eye ? camera.eye[1] : 0;
    depthFrameData[50] = camera.eye ? camera.eye[2] : 0;
  }
  depthFrameData[51] = options.sphereScale || 0.5;  // World units per size unit
  // screenSize + near/far
  depthFrameData[52] = pass.width;
  depthFrameData[53] = pass.height;
  depthFrameData[54] = camera?.near || 0.1;
  depthFrameData[55] = camera?.far || 1000;
  
  device.queue.writeBuffer(pass.depthFrameBuffer, 0, depthFrameData);
  
  // Create depth bind groups if needed
  if (!pass.depthFrameBindGroup) {
    pass.depthFrameBindGroup = pass.vgpu.bindings.createGroup(pass.depthFrameLayout, [
      { binding: 0, buffer: pass.depthFrameBuffer },
    ]);
  }
  
  // Particle bind group (recreate each frame in case buffers change)
  const particleBindGroup = pass.vgpu.bindings.createGroup(pass.depthParticleLayout, [
    { binding: 0, buffer: particleWorld.positionBuffer },
    { binding: 1, buffer: particleWorld.velocityBuffer },
    { binding: 2, buffer: particleWorld.metaBuffer },
  ]);
  
  // Render depth pass
  const depthPassDesc = {
    label: "FluidWater.depthPass",
    colorAttachments: [{
      view: pass.fluidDepthTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
    depthStencilAttachment: {
      view: pass.depthBuffer.createView(),
      depthLoadOp: "clear",
      depthStoreOp: "store",
      depthClearValue: 1.0,
    },
  };
  
  const depthPass = encoder.beginRenderPass(depthPassDesc);
  depthPass.setPipeline(pass.depthPipeline);
  depthPass.setBindGroup(0, pass.depthFrameBindGroup);
  depthPass.setBindGroup(1, particleBindGroup);
  // 6 vertices per particle (2 triangles for billboard quad)
  depthPass.draw(6, particleCount, 0, 0);
  depthPass.end();
  
  // =========================================================================
  // OPTIONAL THICKNESS PASS (additive, no depth test)
  // =========================================================================
  const thicknessFrameBindGroup = pass.vgpu.bindings.createGroup(pass.depthFrameLayout, [
    { binding: 0, buffer: pass.depthFrameBuffer },
  ]);
  
  const thicknessParticleBindGroup = pass.vgpu.bindings.createGroup(pass.depthParticleLayout, [
    { binding: 0, buffer: particleWorld.positionBuffer },
    { binding: 1, buffer: particleWorld.velocityBuffer },
    { binding: 2, buffer: particleWorld.metaBuffer },
  ]);
  
  const thicknessPassDesc = {
    label: "FluidWater.thicknessPass",
    colorAttachments: [{
      view: pass.thicknessTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
  };
  
  const thicknessPass = encoder.beginRenderPass(thicknessPassDesc);
  thicknessPass.setPipeline(pass.thicknessPipeline);
  thicknessPass.setBindGroup(0, thicknessFrameBindGroup);
  thicknessPass.setBindGroup(1, thicknessParticleBindGroup);
  thicknessPass.draw(6, particleCount, 0, 0);
  thicknessPass.end();
  
  // =========================================================================
  // PASS 2: Bilateral blur (horizontal then vertical) for depth and thickness
  // =========================================================================
  
  // Adaptive blur radius: if caller does not provide a positive blurSize,
  // estimate a reasonable kernel from sphereScale and projection.
  let filterSize = options.blurSize;
  if (!Number.isFinite(filterSize) || filterSize <= 0) {
    const sphereScale = options.sphereScale || 0.5;
    let approxPixels = 8;
    if (projection) {
      const m11 = projection[5];
      if (m11 !== 0) {
        const fovY = 2 * Math.atan(1 / m11);
        const refDepth = 10; // world units
        const pixelsPerWorld = pass.height / (2 * refDepth * Math.tan(fovY / 2));
        approxPixels = sphereScale * pixelsPerWorld;
      }
    }
    filterSize = approxPixels * 0.75;
  }
  // Clamp to a safe range so kernels don't explode
  if (!Number.isFinite(filterSize)) filterSize = 8;
  filterSize = Math.max(2, Math.min(48, filterSize));

  const depthFalloff = options.depthFalloff || 100;
  
  // Horizontal blur: fluidDepth → blurTemp - reuse buffer
  const blurHParams = _fluidBlurParams;
  blurHParams[0] = 1.0;  // direction.x
  blurHParams[1] = 0.0;  // direction.y
  blurHParams[2] = filterSize;
  blurHParams[3] = depthFalloff;
  blurHParams[4] = pass.width;
  blurHParams[5] = pass.height;
  device.queue.writeBuffer(pass.blurParamsBuffer, 0, blurHParams);
  
  if (!pass.blurHBindGroup) {
    pass.blurHBindGroup = pass.vgpu.bindings.createGroup(pass.blurLayout, [
      { binding: 0, buffer: pass.blurParamsBuffer },
      { binding: 1, textureView: pass.fluidDepthTexture.createView() },
    ]);
  }
  
  const blurHPass = encoder.beginRenderPass({
    label: "FluidWater.blurHPass",
    colorAttachments: [{
      view: pass.blurTempTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
  });
  blurHPass.setPipeline(pass.blurPipeline);
  blurHPass.setBindGroup(0, pass.blurHBindGroup);
  blurHPass.draw(3, 1, 0, 0);
  blurHPass.end();
  
  // Vertical blur: blurTemp → fluidDepth
  blurHParams[0] = 0.0;  // direction.x
  blurHParams[1] = 1.0;  // direction.y
  device.queue.writeBuffer(pass.blurParamsBuffer, 0, blurHParams);
  
  if (!pass.blurVBindGroup) {
    pass.blurVBindGroup = pass.vgpu.bindings.createGroup(pass.blurLayout, [
      { binding: 0, buffer: pass.blurParamsBuffer },
      { binding: 1, textureView: pass.blurTempTexture.createView() },
    ]);
  }
  
  const blurVPass = encoder.beginRenderPass({
    label: "FluidWater.blurVPass",
    colorAttachments: [{
      view: pass.fluidDepthTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
  });
  blurVPass.setPipeline(pass.blurPipeline);
  blurVPass.setBindGroup(0, pass.blurVBindGroup);
  blurVPass.draw(3, 1, 0, 0);
  blurVPass.end();
  
  // Blur thickness texture separately using the same kernel
  // Horizontal: thicknessTexture -> blurTemp
  device.queue.writeBuffer(pass.blurParamsBuffer, 0, blurHParams);
  const thicknessBlurHBindGroup = pass.vgpu.bindings.createGroup(pass.blurLayout, [
    { binding: 0, buffer: pass.blurParamsBuffer },
    { binding: 1, textureView: pass.thicknessTexture.createView() },
  ]);
  
  const thicknessBlurHPass = encoder.beginRenderPass({
    label: "FluidWater.thicknessBlurHPass",
    colorAttachments: [{
      view: pass.blurTempTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
  });
  thicknessBlurHPass.setPipeline(pass.blurPipeline);
  thicknessBlurHPass.setBindGroup(0, thicknessBlurHBindGroup);
  thicknessBlurHPass.draw(3, 1, 0, 0);
  thicknessBlurHPass.end();
  
  // Vertical: blurTemp -> thicknessTexture
  blurHParams[0] = 0.0;
  blurHParams[1] = 1.0;
  device.queue.writeBuffer(pass.blurParamsBuffer, 0, blurHParams);
  const thicknessBlurVBindGroup = pass.vgpu.bindings.createGroup(pass.blurLayout, [
    { binding: 0, buffer: pass.blurParamsBuffer },
    { binding: 1, textureView: pass.blurTempTexture.createView() },
  ]);
  
  const thicknessBlurVPass = encoder.beginRenderPass({
    label: "FluidWater.thicknessBlurVPass",
    colorAttachments: [{
      view: pass.thicknessTexture.createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
  });
  thicknessBlurVPass.setPipeline(pass.blurPipeline);
  thicknessBlurVPass.setBindGroup(0, thicknessBlurVBindGroup);
  thicknessBlurVPass.draw(3, 1, 0, 0);
  thicknessBlurVPass.end();
  
  // =========================================================================
  // PASS 3: Composite water onto scene
  // =========================================================================
  
  // Update composite frame uniform - reuse buffer
  const compositeFrameData = _fluidCompositeFrameData;
  // invProj, invView would need to be computed - for now use identity
  // TODO: Pass proper inverse matrices
  compositeFrameData[0] = 1; compositeFrameData[5] = 1; compositeFrameData[10] = 1; compositeFrameData[15] = 1;
  compositeFrameData[16] = 1; compositeFrameData[21] = 1; compositeFrameData[26] = 1; compositeFrameData[31] = 1;
  // cameraPos + time
  if (camera?.eye) {
    compositeFrameData[32] = camera.eye[0];
    compositeFrameData[33] = camera.eye[1];
    compositeFrameData[34] = camera.eye[2];
  }
  compositeFrameData[35] = options.time || 0;
  // screenSize + waterColor placeholder
  compositeFrameData[36] = pass.fullWidth;
  compositeFrameData[37] = pass.fullHeight;
  // Water properties
  compositeFrameData[40] = options.refractionStrength || 0.05;
  compositeFrameData[41] = options.fresnelPower || 5.0;
  compositeFrameData[42] = options.absorptionCoeff || 0.5;
  compositeFrameData[43] = options.specularPower || 64.0;
  // Light direction
  const lightDir = options.lightDir || [0.5, 1.0, 0.3];
  const lightLen = Math.sqrt(lightDir[0]**2 + lightDir[1]**2 + lightDir[2]**2);
  compositeFrameData[44] = lightDir[0] / lightLen;
  compositeFrameData[45] = lightDir[1] / lightLen;
  compositeFrameData[46] = lightDir[2] / lightLen;
  // Light color
  const lightColor = options.lightColor || [1.0, 0.95, 0.9];
  compositeFrameData[48] = lightColor[0];
  compositeFrameData[49] = lightColor[1];
  compositeFrameData[50] = lightColor[2];
  // Ambient
  const ambientColor = options.ambientColor || [0.3, 0.35, 0.4];
  compositeFrameData[52] = ambientColor[0];
  compositeFrameData[53] = ambientColor[1];
  compositeFrameData[54] = ambientColor[2];
  // Water color RGB + thickness
  const waterColor = options.waterColor || [0.1, 0.3, 0.5];
  compositeFrameData[56] = waterColor[0];
  compositeFrameData[57] = waterColor[1];
  compositeFrameData[58] = waterColor[2];
  compositeFrameData[59] = options.thickness || 2.0;
  
  device.queue.writeBuffer(pass.compositeFrameBuffer, 0, compositeFrameData);
  
  // Create composite bind group
  const compositeBindGroup = pass.vgpu.bindings.createGroup(pass.compositeLayout, [
    { binding: 0, buffer: pass.compositeFrameBuffer },
    { binding: 1, textureView: pass.fluidDepthTexture.createView() },
    { binding: 2, textureView: sceneColorView },
    { binding: 3, textureView: sceneDepthView },
    { binding: 5, textureView: pass.thicknessTexture.createView() },
  ]);
  
  const compositePass = encoder.beginRenderPass({
    label: "FluidWater.compositePass",
    colorAttachments: [{
      view: swapView,
      loadOp: "load",
      storeOp: "store",
    }],
  });
  compositePass.setPipeline(pass.compositePipeline);
  compositePass.setBindGroup(0, compositeBindGroup);
  compositePass.draw(3, 1, 0, 0);
  compositePass.end();
  
  return true;
}

/**
 * Resize the fluid water pass textures
 */
export function resizeFluidWaterPass(pass, width, height) {
  if (!pass || !pass.device) return;
  
  const scaledWidth = Math.max(1, Math.floor(width * pass.scale));
  const scaledHeight = Math.max(1, Math.floor(height * pass.scale));
  
  // Destroy old textures
  pass.fluidDepthTexture?.destroy();
  pass.blurTempTexture?.destroy();
  pass.thicknessTexture?.destroy();
  pass.depthBuffer?.destroy();
  
  // Create new textures using vGPU
  pass.fluidDepthTexture = pass.vgpu.texture.create({
    width: scaledWidth, height: scaledHeight,
    format: 'rgba16float', usage: 'render|texture', label: 'FluidWaterDepth'
  }).texture;
  
  pass.blurTempTexture = pass.vgpu.texture.create({
    width: scaledWidth, height: scaledHeight,
    format: 'rgba16float', usage: 'render|texture', label: 'FluidWaterBlurTemp'
  }).texture;
  
  pass.depthBuffer = pass.vgpu.texture.create({
    width: scaledWidth, height: scaledHeight,
    format: 'depth24plus', usage: 'render', label: 'FluidWaterDepthBuffer'
  }).texture;
  
  pass.thicknessTexture = pass.vgpu.texture.create({
    width: scaledWidth, height: scaledHeight,
    format: 'rgba16float', usage: 'render|texture', label: 'FluidWaterThickness'
  }).texture;
  
  pass.width = scaledWidth;
  pass.height = scaledHeight;
  pass.fullWidth = width;
  pass.fullHeight = height;
  
  // Invalidate bind groups
  pass.blurHBindGroup = null;
  pass.blurVBindGroup = null;
}

/**
 * Destroy the fluid water pass resources
 */
export function destroyFluidWaterPass(pass) {
  if (!pass) return;
  
  pass.fluidDepthTexture?.destroy();
  pass.blurTempTexture?.destroy();
  pass.depthBuffer?.destroy();
  pass.thicknessTexture?.destroy();
  pass.depthFrameBuffer?.destroy();
  pass.blurParamsBuffer?.destroy();
  pass.compositeFrameBuffer?.destroy();
}
