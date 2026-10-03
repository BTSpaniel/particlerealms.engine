// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from "../../core/gpu/VirtualGPU.js";
import { createUniformBuffer } from "../../core/gpu/GpuBuffer.js";
import { getShaderSource } from "../shaders/ShaderLoaderJS.js";

export async function createIsoSurfaceVolumeRenderer(options) {
  const { device, format } = options || {};

  if (!device) {
    throw new Error("createIsoSurfaceVolumeRenderer: device is required");
  }
  if (!format) {
    throw new Error("createIsoSurfaceVolumeRenderer: format is required");
  }

  const vgpu = initVGPU(device);
  const shaderCode = getShaderSource("postfx/volume_isosurface");
  const shaderModule = vgpu.shader.compile('isoSurfaceVolume', shaderCode);

  // Define explicit bind group layouts
  const frameLayout = vgpu.bindings.defineLayout('isoSurfaceFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);
  const gridLayout = vgpu.bindings.defineLayout('isoSurfaceGrid', [
    { binding: 0, type: 'uniform', visibility: 'fragment' },
  ]);

  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    layouts: [frameLayout, gridLayout],
    colorFormat: format,
    blend: 'alpha',
    cullMode: 'none',
    topology: 'triangle-list',
    label: 'IsoSurfaceVolumePipeline'
  });

  const frameBuffer = vgpu.buffer.create({ size: 48 * 4, usage: 'uniform', label: 'IsoSurfaceFrame' }).buffer;
  const gridBuffer = vgpu.buffer.create({ size: 16, usage: 'uniform', label: 'IsoSurfaceGrid' }).buffer;

  const frameBindGroup = vgpu.bindings.createGroup(frameLayout, [
    { binding: 0, buffer: frameBuffer },
  ]);

  return {
    device,
    shaderModule,
    pipeline,
    frameBuffer,
    gridBuffer,
    frameBindGroup,
    gridLayout,
  };
}
