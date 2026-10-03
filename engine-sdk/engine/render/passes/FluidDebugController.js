// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from "../../core/gpu/VirtualGPU.js";
import {
  createUniformBuffer,
  updateBuffer,
  destroyBuffers,
} from "../../core/gpu/GpuBuffer.js";
import { labelResource, withErrorScope } from "../../core/gpu/GpuDebug.js";
import { createShaderLoader } from "../shaders/ShaderLoader.js";

function createArrayBufferForParams() {
  const byteLength = 32;
  return new ArrayBuffer(byteLength);
}

export { createFluidDebugController as FluidDebugController };

function writeParamsToBuffer(device, paramsBuffer, fluidWorld, options = {}) {
  if (!device || !paramsBuffer || !fluidWorld) {
    return;
  }

  const gridSizeX = Number(fluidWorld.gridSizeX) || 1;
  const gridSizeY = Number(fluidWorld.gridSizeY) || 1;
  const gridSizeZ = Number(fluidWorld.gridSizeZ) || 1;

  const sliceZValue =
    typeof options.sliceZ === "number" && Number.isFinite(options.sliceZ)
      ? options.sliceZ
      : gridSizeZ * 0.5;

  const scaleValue =
    typeof options.scale === "number" && Number.isFinite(options.scale)
      ? options.scale
      : 1.0;

  const modeValue =
    typeof options.mode === "number" && Number.isFinite(options.mode)
      ? options.mode | 0
      : 1;

  const buffer = createArrayBufferForParams();
  const f32 = new Float32Array(buffer);
  const i32 = new Int32Array(buffer);

  f32[0] = gridSizeX;
  f32[1] = gridSizeY;
  f32[2] = gridSizeZ;
  f32[3] = sliceZValue;
  f32[4] = scaleValue;
  i32[5] = modeValue;
  f32[6] = 0;
  f32[7] = 0;

  updateBuffer(device, paramsBuffer, buffer, 0);
}

export function createFluidDebugController(options = {}) {
  const state = {
    device: null,
    pipeline: null,
    bindGroupLayout: null,
    pipelineLayout: null,
    paramsBuffer: null,
    bindGroup: null,
    shaderPromise: null,
    colorFormat: null,
    densityBuffer: null,
  };

  async function ensurePipeline(context, fluidWorld) {
    if (!context || !fluidWorld) {
      return null;
    }

    const device = context.device;
    const canvasSurface = context.canvasSurface;
    if (!device || !canvasSurface || !canvasSurface.format) {
      throw new Error(
        "FluidDebugController.ensurePipeline: context.device and context.canvasSurface.format are required"
      );
    }

    const format = canvasSurface.format;

    if (state.pipeline && state.device === device && state.colorFormat === format) {
      if (state.densityBuffer !== fluidWorld.densityBuffer) {
        state.densityBuffer = fluidWorld.densityBuffer;
        state.bindGroup = device.createBindGroup({
          label: "FluidDebug.bindGroup",
          layout: state.bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: state.densityBuffer } },
            { binding: 1, resource: { buffer: state.paramsBuffer } },
          ],
        });
      }
      return state.pipeline;
    }

    const baseUrl =
      typeof options.shaderBaseUrl === "string" && options.shaderBaseUrl.length > 0
        ? options.shaderBaseUrl
        : "./engine/render/shaders";

    const loader = createShaderLoader({ baseUrl });

    const vgpu = initVGPU(device);

    if (!state.shaderPromise) {
      state.shaderPromise = (async () => {
        const code = await loader.loadDebug("fluid_debug");
        return vgpu.shader.compile('fluidDebug', code);
      })();
    }

    const shaderModule = await state.shaderPromise;

    const bindGroupLayout = vgpu.bindings.defineLayout('fluidDebug', [
      { binding: 0, type: 'read-storage', visibility: 'fragment' },
      { binding: 1, type: 'uniform', visibility: 'fragment' },
    ]);

    const pipelineLayout = device.createPipelineLayout({
      label: "FluidDebug.pipelineLayout",
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = await withErrorScope(device, async () => {
      return device.createRenderPipeline({
        label: "FluidDebug.pipeline",
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: "vs_main",
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fs_main",
          targets: [
            {
              format,
            },
          ],
        },
        primitive: {
          topology: "triangle-list",
          cullMode: "none",
        },
      });
    });

    const paramsBuffer = createUniformBuffer(device, 32, {
      label: "FluidDebug.params",
    });
    labelResource(paramsBuffer, "FluidDebug.params");

    const densityBuffer = fluidWorld.densityBuffer;
    const bindGroup = device.createBindGroup({
      label: "FluidDebug.bindGroup",
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: densityBuffer } },
        { binding: 1, resource: { buffer: paramsBuffer } },
      ],
    });

    state.device = device;
    state.pipeline = pipeline;
    state.bindGroupLayout = bindGroupLayout;
    state.pipelineLayout = pipelineLayout;
    state.paramsBuffer = paramsBuffer;
    state.bindGroup = bindGroup;
    state.colorFormat = format;
    state.densityBuffer = densityBuffer;

    return pipeline;
  }

  async function attachToContext(context, fluidWorld, debugOptions = {}) {
    if (!context || !fluidWorld) {
      return null;
    }

    const device = context.device;
    if (!device) {
      throw new Error("FluidDebugController.attachToContext: context.device is required");
    }

    const pipeline = await ensurePipeline(context, fluidWorld);
    if (!pipeline || !state.paramsBuffer || !state.bindGroup) {
      return null;
    }

    writeParamsToBuffer(device, state.paramsBuffer, fluidWorld, debugOptions);

    const fluids = context.fluids || {};
    fluids.pipeline = pipeline;
    fluids.bindGroups = [state.bindGroup];
    fluids.vertexCount = 3;
    fluids.instanceCount = 1;
    fluids.firstVertex = 0;
    fluids.firstInstance = 0;

    context.fluids = fluids;

    return fluids;
  }

  function dispose() {
    if (state.paramsBuffer) {
      destroyBuffers(state.paramsBuffer);
      state.paramsBuffer = null;
    }
    state.pipeline = null;
    state.bindGroup = null;
    state.bindGroupLayout = null;
    state.pipelineLayout = null;
    state.device = null;
    state.densityBuffer = null;
    state.colorFormat = null;
  }

  return {
    attachToContext,
    dispose,
  };
}
