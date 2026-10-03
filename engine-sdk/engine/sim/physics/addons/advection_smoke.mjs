// SPDX-License-Identifier: MIT
// Executes NVIDIA's generated AdvectionSimpleCS; the CPU oracle is independent.
import {FlowWasmWebGpuBridge} from './webgpu_bridge.mjs';

export async function runAdvectionSmoke(module, shaderRoot = '/dist/flow-wgsl', options = {}) {
  const path = shaderRoot + '/source/nvflow/shaders/AdvectionSimpleCS';
  const responses = await Promise.all([fetch(path + '.wgsl'), fetch(path + '.reflection.json')]);
  if (responses.some(response => !response.ok)) throw new Error('Compiled Flow advection artifacts unavailable');
  const [code, reflection] = await Promise.all([responses[0].text(), responses[1].json()]);
  const bridge = await FlowWasmWebGpuBridge.create(module, {
    deviceDescriptor: {requiredFeatures: ['float32-filterable']},
    ...options,
  });
  const {device} = bridge;
  const textures = [];
  try {
    device.pushErrorScope('validation');
    const parameters = Object.fromEntries(reflection.parameters.map(p => [p.name, p]));
    const pack = (type, values, view, offset = 0) => {
      for (const field of type.fields) {
        if (!(field.name in values)) continue;
        const value = values[field.name], at = offset + field.binding.offset;
        if (field.type.kind === 'struct') pack(field.type, value, view, at);
        else {
          const scalar = field.type.elementType?.scalarType ?? field.type.scalarType;
          const setter = scalar === 'float32' ? 'setFloat32' : scalar === 'int32' ? 'setInt32' : 'setUint32';
          const items = Array.isArray(value) ? value : [value];
          items.forEach((item, i) => view[setter](at + 4 * i, item, true));
        }
      }
    };
    const buffer = (bytes, usage, name) => {
      const pointer = bridge.allocate(bytes.byteLength);
      module.HEAPU8.set(bytes, pointer);
      const gpu = bridge.createStorageBuffer(bytes.byteLength, usage, name);
      bridge.upload(gpu, pointer, bytes.byteLength);
      return gpu;
    };
    const globals = new Uint8Array(176);
    pack(parameters.globalParamsIn.type.elementType, {table: {
      blockDimLessOne: [7, 3, 3], threadsPerBlock: 128, blockDimBits: [3, 2, 2],
      numLocations: 1, layerParamIdxOffset: 32, numLayers: 1,
      dim: [10, 6, 6], dimInv: [1 / 10, 1 / 6, 1 / 6],
    }}, new DataView(globals.buffer));
    const layers = new Uint8Array(64);
    const layerType = parameters.layerParamsIn.type.resultType;
    pack(layerType, {advectParams: {
      valueToVelocityBlockScale: [1, 1, 1], cellSizeInv: [1, 1, 1],
      deltaTime: 0.25, maxDisplacement: [0.5, 0.5, 0.5],
    }, dampingRate: [0.5, 0.75, 1, 0.8]}, new DataView(layers.buffer));
    const table = new Uint32Array(33);
    table[18] = 0x80000000; // One resident block; all neighboring blocks absent.
    const globalBuffer = buffer(globals, GPUBufferUsage.UNIFORM, 'Flow global parameters');
    const layerBuffer = buffer(layers, 0, 'Flow layer parameters');
    const tableBuffer = buffer(new Uint8Array(table.buffer), 0, 'Flow sparse table');
    const input = new Float32Array(10 * 6 * 6 * 4);
    for (let z = 0; z < 6; z++) for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) {
      input.set([0.25, 0.5, 0.75, x + 2 * y + 3 * z], ((z * 6 + y) * 10 + x) * 4);
    }
    const inputPointer = bridge.allocate(input.byteLength);
    module.HEAPU8.set(new Uint8Array(input.buffer), inputPointer);
    const makeTexture = usage => {
      const texture = device.createTexture({size: [10, 6, 6], dimension: '3d',
        format: 'rgba32float', usage});
      textures.push(texture);
      return texture;
    };
    const source = makeTexture(GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
    const destination = makeTexture(GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC);
    device.queue.writeTexture({texture: source}, module.HEAPU8.subarray(inputPointer, inputPointer + input.byteLength),
      {bytesPerRow: 160, rowsPerImage: 6}, [10, 6, 6]);
    const shader = device.createShaderModule({code});
    const pipeline = await device.createComputePipelineAsync({layout: 'auto', compute: {module: shader, entryPoint: 'main'}});
    const resources = {globalParamsIn: {buffer: globalBuffer}, layerParamsIn: {buffer: layerBuffer},
      tableIn: {buffer: tableBuffer}, valueIn: source.createView(), valueOut: destination.createView(),
      valueSampler: device.createSampler({minFilter: 'linear', magFilter: 'linear'})};
    bridge.dispatch(pipeline, reflection.parameters.map(p => ({
      binding: p.binding.index, resource: resources[p.name],
    })), [1, 1, 1], 'NVIDIA Flow advection');
    const paddedBytes = 256 * 6 * 6;
    const readback = bridge.createStorageBuffer(paddedBytes);
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({texture: destination}, {buffer: readback, bytesPerRow: 256, rowsPerImage: 6}, [10, 6, 6]);
    device.queue.submit([encoder.finish()]);
    const resultPointer = bridge.allocate(paddedBytes);
    await bridge.download(readback, resultPointer, paddedBytes);
    const validation = await device.popErrorScope();
    if (validation) throw new Error(validation.message);
    const values = new DataView(module.HEAPU8.buffer, resultPointer, paddedBytes);
    let maximumError = 0, checked = 0;
    for (let z = 1; z <= 4; z++) for (let y = 1; y <= 4; y++) for (let x = 1; x <= 8; x++) {
      const expected = [0.125, 0.375, 0.75,
        (x + 2 * y + 3 * z - 0.25 * (0.25 + 2 * 0.5 + 3 * 0.75)) * 0.8];
      for (let channel = 0; channel < 4; channel++) {
        const actual = values.getFloat32((z * 6 + y) * 256 + x * 16 + channel * 4, true);
        if (!Number.isFinite(actual)) throw new Error('Nonfinite Flow advection output');
        maximumError = Math.max(maximumError, Math.abs(actual - expected[channel]));
        checked++;
      }
    }
    if (maximumError > 0.0001) throw new Error('Flow advection oracle mismatch: ' + maximumError);
    return {status: 'FLOW_ADVECTION_KERNEL_PASSED', cells: 128, checked, maximumError,
      deltaTime: 0.25, sameWasmHeapReadback: true};
  } finally {
    for (const texture of textures) texture.destroy();
    bridge.close();
  }
}
