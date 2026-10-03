// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from "../../core/gpu/VirtualGPU.js";
import { createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import { getShaderSource } from "../shaders/ShaderLoaderJS.js";
import { FRAME_UNIFORMS_SCHEMA } from "../shaders/ShaderSchema.js";

export async function createSmokeVolumeRenderer(options) {
  const { device, format, roomSize, logger } = options || {};

  if (!device) {
    throw new Error("createSmokeVolumeRenderer: device is required");
  }
  if (!format) {
    throw new Error("createSmokeVolumeRenderer: format is required");
  }

  const size = Number.isFinite(roomSize) && roomSize > 0 ? roomSize : 50;
  const halfSize = size * 0.5;

  const volumeMin = [-halfSize, -halfSize, -halfSize];
  const volumeMax = [halfSize, halfSize, halfSize];

  const vgpu = initVGPU(device);
  const shaderCode = getShaderSource("postfx/volume_smoke");
  const shaderModule = vgpu.shader.compile('smokeVolume', shaderCode);

  // Define explicit bind group layouts
  const frameLayout = vgpu.bindings.defineLayout('smokeFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);

  // Must match engine/render/shaders/modules/postfx/volume_smoke.js:
  // @group(1) @binding(0) densityField (storage read)
  // @group(1) @binding(1) colorField   (storage read)
  // @group(1) @binding(2) grid         (uniform)
  const gridLayout = vgpu.bindings.defineLayout('smokeGrid', [
    { binding: 0, type: 'read-storage', visibility: 'fragment' },
    { binding: 1, type: 'read-storage', visibility: 'fragment' },
    { binding: 2, type: 'uniform', visibility: 'fragment' },
  ]);

  // Must match shader:
  // @group(2) @binding(0) var sceneDepth : texture_depth_2d;
  const depthLayout = vgpu.bindings.defineLayout('smokeDepth', [
    { binding: 0, type: 'texture', sampleType: 'depth', dimension: '2d', visibility: 'fragment' },
  ]);

  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    layouts: [frameLayout, gridLayout, depthLayout],
    colorFormat: format,
    blend: 'alpha',
    cullMode: 'none',
    depthFormat: null,
    topology: 'triangle-list',
    label: 'SmokeVolumePipeline'
  });

  // Use ShaderSchema for consistent buffer size
  const frameBuffer = vgpu.buffer.create({ size: FRAME_UNIFORMS_SCHEMA.size, usage: 'uniform', label: 'SmokeFrameUniforms' }).buffer;
  const gridBuffer = vgpu.buffer.create({ size: 16, usage: 'uniform', label: 'SmokeGridParams' }).buffer;

  const frameBindGroup = vgpu.bindings.createGroup(frameLayout, [
    { binding: 0, buffer: frameBuffer },
  ]);

  if (logger && typeof logger.info === "function") {
    logger.info("[SMOKE] Smoke volume renderer initialized", {
      roomSize: size,
    });
  }

  return {
    device,
    shaderModule,
    pipeline,
    frameBuffer,
    gridBuffer,
    frameBindGroup,
    gridLayout,
    depthLayout,
    volumeMin,
    volumeMax,
  };
}
