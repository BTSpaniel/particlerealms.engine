// SPDX-License-Identifier: MIT
import {FlowWasmWebGpuBridge} from './webgpu_bridge.mjs';

export async function runMeshScanSmoke(module, shaderRoot = '/dist/flow-wgsl') {
  const response = await fetch(shaderRoot + '/source/nvflowext/shaders/EmitterMeshClosestCS.wgsl');
  if (!response.ok) throw new Error('Mesh emitter WGSL unavailable');
  const source = await response.text();
  const begin = source.indexOf('var<workgroup> sdata0_0');
  const end = source.indexOf('var<workgroup> slist3_0', begin);
  if (begin < 0 || end <= begin) throw new Error('Pinned mesh scan layout changed');
  const scan = source.slice(begin, end);
  if (!scan.includes('workgroupUniformLoad')) throw new Error('Uniform scan lowering missing');
  const bridge = await FlowWasmWebGpuBridge.create(module);
  try {
    const input = new Uint32Array(4 * 256), expected = new Uint32Array(4 * 256 * 2);
    for (let group = 0; group < 4; group++) {
      let sum = 0;
      for (let lane = 0; lane < 256; lane++) {
        const value = group === 0 ? 0 : group === 1 ? 1 : group === 2 ? Number(lane % 3 === 0) : Number(lane === 255);
        input[group * 256 + lane] = value;
        sum += value;
        expected[(group * 256 + lane) * 2] = sum;
      }
      for (let lane = 0; lane < 256; lane++) expected[(group * 256 + lane) * 2 + 1] = sum;
    }
    const pointer = bridge.allocate(input.byteLength);
    module.HEAPU8.set(new Uint8Array(input.buffer), pointer);
    const values = bridge.createStorageBuffer(input.byteLength);
    const results = bridge.createStorageBuffer(expected.byteLength);
    bridge.upload(values, pointer, input.byteLength);
    const {device} = bridge;
    device.pushErrorScope('validation');
    const shader = device.createShaderModule({code: scan + `
      @group(0) @binding(0) var<storage, read> input: array<u32>;
      @group(0) @binding(1) var<storage, read_write> output: array<u32>;
      @compute @workgroup_size(256)
      fn main(@builtin(global_invocation_id) id: vec3<u32>,
              @builtin(local_invocation_id) local: vec3<u32>) {
        var total = 0u;
        let prefix = blockScan_0(local.x, input[id.x], &total);
        // Exercise the same dynamic, group-uniform loop property as the emitter.
        for (var i = 0u; i < total; i++) { workgroupBarrier(); }
        output[id.x * 2u] = prefix;
        output[id.x * 2u + 1u] = total;
      }
    `});
    const pipeline = await device.createComputePipelineAsync({layout: 'auto', compute: {module: shader, entryPoint: 'main'}});
    bridge.dispatch(pipeline, [{binding: 0, resource: {buffer: values}},
      {binding: 1, resource: {buffer: results}}], 4);
    const resultPointer = bridge.allocate(expected.byteLength);
    await bridge.download(results, resultPointer, expected.byteLength);
    const error = await device.popErrorScope();
    if (error) throw new Error(error.message);
    const actual = new Uint32Array(module.HEAPU8.buffer, resultPointer, expected.length);
    for (let index = 0; index < actual.length; index++) {
      if (actual[index] !== expected[index]) throw new Error('Mesh scan mismatch at ' + index);
    }
    return {status: 'FLOW_MESH_SCAN_PASSED', groups: 4, lanes: input.length,
      checked: expected.length, patterns: ['empty', 'full', 'every-third', 'last-only']};
  } finally { bridge.close(); }
}
