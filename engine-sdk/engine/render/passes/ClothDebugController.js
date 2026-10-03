// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from "../../core/gpu/VirtualGPU.js";
import {
  createVertexBuffer,
  createIndexBuffer,
  createUniformBuffer,
  updateBuffer,
  destroyBuffers,
} from "../../core/gpu/GpuBuffer.js";
import { createShaderLoader } from "../shaders/ShaderLoader.js";

// Reusable buffers to avoid GC pressure in hot paths
const _clothUniformData = new Float32Array(20);
let _clothVertexData = null;
let _clothVertexCapacity = 0;

function getClothVertexBuffer(floatCount) {
  if (!_clothVertexData || _clothVertexCapacity < floatCount) {
    _clothVertexCapacity = Math.max(floatCount, (_clothVertexCapacity || 1024) * 2);
    _clothVertexData = new Float32Array(_clothVertexCapacity);
  }
  return _clothVertexData;
}

export function createClothDebugController(options = {}) {
  const state = {
    device: null,
    pipeline: null,
    shaderPromise: null,
    colorFormat: null,
    uniformBuffer: null,
    bindGroup: null,
    vertexBuffer: null,
    indexBuffer: null,
    vertexCapacity: 0,
    indexCapacity: 0,
    indexFormat: "uint16",
  };

  async function ensurePipeline(context) {
    if (!context) {
      return null;
    }

    const device = context.device;
    const canvasSurface = context.canvasSurface;
    if (!device || !canvasSurface || !canvasSurface.format) {
      throw new Error(
        "ClothDebugController.ensurePipeline: context.device and context.canvasSurface.format are required",
      );
    }

    const format = canvasSurface.format;

    if (state.pipeline && state.device === device && state.colorFormat === format) {
      return state.pipeline;
    }

    const baseUrl =
      typeof options.shaderBaseUrl === "string" && options.shaderBaseUrl.length > 0
        ? options.shaderBaseUrl
        : "./engine/render/shaders";

    const loader = createShaderLoader({ baseUrl });

    if (!state.shaderPromise) {
      state.shaderPromise = loader.loadDebug("cloth_debug").then((code) => {
        const vgpu = initVGPU(device);
        return vgpu.shader.compile('clothDebug', code);
      });
    }

    const shaderModule = await state.shaderPromise;
    const vgpu = initVGPU(device);

    // Define explicit bind group layout
    const bindGroupLayout = vgpu.bindings.defineLayout('clothDebug', [
      { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
    ]);

    const pipeline = vgpu.pipeline.render({
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: { module: shaderModule, entryPoint: 'fs_main' },
      vertexLayout: [{
        arrayStride: 6 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ],
      }],
      layouts: [bindGroupLayout],
      colorFormat: format,
      cullMode: 'back',
      topology: 'triangle-list',
      label: 'ClothDebugPipeline'
    });

    if (!state.uniformBuffer) {
      state.uniformBuffer = vgpu.buffer.create({ size: 80, usage: 'uniform', label: 'ClothDebugUniforms' }).buffer;
    }

    state.bindGroup = vgpu.bindings.createGroup(bindGroupLayout, [
      { binding: 0, buffer: state.uniformBuffer },
    ]);

    state.device = device;
    state.pipeline = pipeline;
    state.colorFormat = format;

    return pipeline;
  }

  function ensureBuffers(device, vertexCount, indices) {
    const vertexFloats = vertexCount * 6;
    const requiredVertexFloats = vertexFloats;
    const requiredIndexCount = indices.length;

    if (!state.vertexBuffer || state.vertexCapacity < requiredVertexFloats) {
      if (state.vertexBuffer) {
        destroyBuffers(state.vertexBuffer);
      }
      const initialData = new Float32Array(requiredVertexFloats);
      state.vertexBuffer = createVertexBuffer(device, initialData, {
        label: "ClothDebug.vertices",
      });
      state.vertexCapacity = requiredVertexFloats;
    }

    const useUint32 = indices instanceof Uint32Array;
    const indexFormat = useUint32 ? "uint32" : "uint16";

    if (
      !state.indexBuffer ||
      state.indexCapacity < requiredIndexCount ||
      state.indexFormat !== indexFormat
    ) {
      if (state.indexBuffer) {
        destroyBuffers(state.indexBuffer);
      }
      state.indexBuffer = createIndexBuffer(device, indices, {
        label: "ClothDebug.indices",
      });
      state.indexCapacity = requiredIndexCount;
      state.indexFormat = indexFormat;
    } else {
      updateBuffer(device, state.indexBuffer, indices);
    }
  }

  function buildUniformData(debugOptions) {
    // Reuse module-level buffer to avoid GC pressure
    const data = _clothUniformData;
    const mvp = debugOptions && debugOptions.mvp;
    if (mvp && mvp.length >= 16) {
      for (let i = 0; i < 16; i++) {
        data[i] = Number.isFinite(mvp[i]) ? mvp[i] : 0;
      }
    } else {
      data.fill(0, 0, 16);
      data[0] = 1;
      data[5] = 1;
      data[10] = 1;
      data[15] = 1;
    }

    const color =
      debugOptions && Array.isArray(debugOptions.color) && debugOptions.color.length >= 3
        ? debugOptions.color
        : [1, 0, 0];

    data[16] = Number.isFinite(color[0]) ? color[0] : 1;
    data[17] = Number.isFinite(color[1]) ? color[1] : 0;
    data[18] = Number.isFinite(color[2]) ? color[2] : 0;
    data[19] = 0;

    return data;
  }

  async function attachToContext(context, clothData, debugOptions = {}) {
    if (!context || !clothData) {
      return null;
    }

    const device = context.device;
    if (!device) {
      throw new Error("ClothDebugController.attachToContext: context.device is required");
    }

    const pipeline = await ensurePipeline(context);
    if (!pipeline || !state.uniformBuffer || !state.bindGroup) {
      return null;
    }

    const positions = clothData.positions;
    const normals = clothData.normals;
    const indices = clothData.indices;
    const vertexCount = clothData.vertexCount | 0;
    const indexCount = clothData.indexCount | 0;

    if (!positions || !normals || !indices || vertexCount <= 0 || indexCount <= 0) {
      return null;
    }

    const vertexFloats = vertexCount * 6;
    const vertexData = getClothVertexBuffer(vertexFloats);

    for (let i = 0; i < vertexCount; i++) {
      const pi = i * 3;
      const vi = i * 6;
      const px = positions[pi + 0];
      const py = positions[pi + 1];
      const pz = positions[pi + 2];
      const nx = normals[pi + 0];
      const ny = normals[pi + 1];
      const nz = normals[pi + 2];
      vertexData[vi + 0] = Number.isFinite(px) ? px : 0;
      vertexData[vi + 1] = Number.isFinite(py) ? py : 0;
      vertexData[vi + 2] = Number.isFinite(pz) ? pz : 0;
      vertexData[vi + 3] = Number.isFinite(nx) ? nx : 0;
      vertexData[vi + 4] = Number.isFinite(ny) ? ny : 1;
      vertexData[vi + 5] = Number.isFinite(nz) ? nz : 0;
    }

    ensureBuffers(device, vertexCount, indices);
    updateBuffer(device, state.vertexBuffer, vertexData);

    const uniformData = buildUniformData(debugOptions);
    updateBuffer(device, state.uniformBuffer, uniformData);

    const cloth = context.cloth || {};
    cloth.pipeline = pipeline;
    cloth.bindGroups = [state.bindGroup];
    cloth.vertexBuffer = state.vertexBuffer;
    cloth.indexBuffer = state.indexBuffer;
    cloth.indexFormat = state.indexFormat;
    cloth.indexCount = indexCount;
    cloth.vertexCount = vertexCount;
    cloth.firstIndex = 0;
    cloth.firstVertex = 0;
    cloth.instanceCount = 1;
    cloth.firstInstance = 0;

    context.cloth = cloth;

    return cloth;
  }

  function dispose() {
    if (state.vertexBuffer) {
      destroyBuffers(state.vertexBuffer);
      state.vertexBuffer = null;
      state.vertexCapacity = 0;
    }
    if (state.indexBuffer) {
      destroyBuffers(state.indexBuffer);
      state.indexBuffer = null;
      state.indexCapacity = 0;
    }
    if (state.uniformBuffer) {
      destroyBuffers(state.uniformBuffer);
      state.uniformBuffer = null;
    }
    state.pipeline = null;
    state.bindGroup = null;
    state.device = null;
    state.colorFormat = null;
  }

  return {
    attachToContext,
    dispose,
  };
}

export { createClothDebugController as ClothDebugController };
