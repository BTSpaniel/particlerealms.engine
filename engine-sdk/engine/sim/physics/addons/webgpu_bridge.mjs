// SPDX-License-Identifier: MIT
// Chrome WebGPU bridge over the unified PhysX/Rust/Blast WASM heap.

function requireFunction(module, name) {
  const fn = module?.[name];
  if (typeof fn !== 'function') throw new Error(`Unified WASM module is missing ${name}`);
  return fn;
}

function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value <= 0 || value > maximum)
    throw new RangeError(`${name} must be an integer in 1..${maximum}`);
  return value;
}

export class FlowWasmWebGpuBridge {
  static async create(module, options = {}) {
    if (!globalThis.navigator?.gpu) throw new Error('WebGPU is unavailable in this browser');
    if (module?._pr_flow_stage_abi?.() !== 1) throw new Error('Flow staging ABI 1 is required');
    if (module?._pr_flow_simd_enabled?.() !== 1)
      throw new Error('The unified Rust WASM was not built with simd128');
    const adapter = options.adapter ?? await navigator.gpu.requestAdapter({
      powerPreference: options.powerPreference ?? 'high-performance',
    });
    if (!adapter) throw new Error('Chrome did not provide a WebGPU adapter');
    const device = options.device ?? await adapter.requestDevice(options.deviceDescriptor);
    return new FlowWasmWebGpuBridge(module, adapter, device, !options.device);
  }

  constructor(module, adapter, device, ownsDevice) {
    this.module = module;
    this.adapter = adapter;
    this.device = device;
    this.ownsDevice = ownsDevice;
    this.closed = false;
    this.allocations = new Map();
    this.buffers = new Set();
  }

  requireOpen() {
    if (this.closed) throw new Error('Flow WebGPU bridge is closed');
  }

  assertHeapRange(pointer, byteLength) {
    this.requireOpen();
    positiveInteger(byteLength, 'byteLength', 0x7fffffff);
    if (!Number.isInteger(pointer) || pointer <= 0 ||
        pointer + byteLength > this.module.HEAPU8.length)
      throw new RangeError('WASM heap range is invalid or stale after memory growth');
  }

  allocate(byteLength) {
    positiveInteger(byteLength, 'byteLength', 0x7fffffff);
    const pointer = requireFunction(this.module, '_malloc')(byteLength);
    if (!pointer) throw new Error(`WASM allocation failed for ${byteLength} bytes`);
    this.allocations.set(pointer, byteLength);
    return pointer;
  }

  free(pointer) {
    this.requireOpen();
    if (!this.allocations.delete(pointer))
      throw new Error('Flow staging allocation is unknown or already freed');
    requireFunction(this.module, '_free')(pointer);
  }

  createStorageBuffer(byteLength, extraUsage = 0, label = 'Flow storage') {
    this.requireOpen();
    positiveInteger(byteLength, 'byteLength', 0x7fffffff);
    const buffer = this.device.createBuffer({
      label, size: byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC | extraUsage,
    });
    this.buffers.add(buffer);
    return buffer;
  }

  destroyBuffer(buffer) {
    if (this.buffers.delete(buffer)) buffer.destroy();
  }

  upload(buffer, pointer, byteLength, bufferOffset = 0) {
    this.assertHeapRange(pointer, byteLength);
    if (!Number.isInteger(bufferOffset) || bufferOffset < 0)
      throw new RangeError('Invalid GPU buffer offset');
    this.device.queue.writeBuffer(
      buffer, bufferOffset, this.module.HEAPU8.subarray(pointer, pointer + byteLength));
  }

  async createComputePipeline(code, entryPoint = 'main', label = 'Flow compute') {
    this.requireOpen();
    const shader = this.device.createShaderModule({label, code});
    if (typeof shader.getCompilationInfo === 'function') {
      const compilation = await shader.getCompilationInfo();
      const errors = compilation.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
    }
    return this.device.createComputePipeline({
      label: `${label} pipeline`, layout: 'auto', compute: {module: shader, entryPoint},
    });
  }

  dispatch(pipeline, entries, workgroups, label = 'Flow compute dispatch') {
    this.requireOpen();
    if (!Array.isArray(entries) || entries.length === 0)
      throw new TypeError('Bindings are required');
    const counts = Array.isArray(workgroups) ? [...workgroups] : [workgroups, 1, 1];
    while (counts.length < 3) counts.push(1);
    counts.slice(0, 3).forEach(
      (value, index) => positiveInteger(value, `workgroups[${index}]`, 65535));
    const bindGroup = this.device.createBindGroup({
      label: `${label} bindings`, layout: pipeline.getBindGroupLayout(0), entries,
    });
    const encoder = this.device.createCommandEncoder({label});
    const pass = encoder.beginComputePass({label});
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(counts[0], counts[1], counts[2]);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  async download(buffer, pointer, byteLength, bufferOffset = 0) {
    this.assertHeapRange(pointer, byteLength);
    if (!Number.isInteger(bufferOffset) || bufferOffset < 0)
      throw new RangeError('Invalid GPU buffer offset');
    const readback = this.device.createBuffer({
      label: 'Flow WASM readback', size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.device.createCommandEncoder({label: 'Flow WASM readback copy'});
      encoder.copyBufferToBuffer(buffer, bufferOffset, readback, 0, byteLength);
      this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const copied = new Uint8Array(readback.getMappedRange()).slice();
      readback.unmap();
      // Refresh HEAPU8 after the await in case another caller grew WASM memory.
      this.assertHeapRange(pointer, byteLength);
      this.module.HEAPU8.set(copied, pointer);
    } finally {
      if (readback.mapState === 'mapped') readback.unmap();
      readback.destroy();
    }
  }

  close() {
    if (this.closed) return;
    for (const buffer of this.buffers) buffer.destroy();
    this.buffers.clear();
    const free = requireFunction(this.module, '_free');
    for (const pointer of this.allocations.keys()) free(pointer);
    this.allocations.clear();
    if (this.ownsDevice) this.device.destroy();
    this.closed = true;
  }
}

export async function runFlowWebGpuRoundTrip(module, options = {}) {
  const count = positiveInteger(options.count ?? 4096, 'Flow staging count', 16_777_216);
  const bridge = await FlowWasmWebGpuBridge.create(module, options);
  const byteLength = count * Uint32Array.BYTES_PER_ELEMENT;
  const pointer = bridge.allocate(byteLength);
  const storage = bridge.createStorageBuffer(byteLength, 0, 'Flow unified WASM staging');
  try {
    if (requireFunction(module, '_pr_flow_seed')(pointer, count) !== 0)
      throw new Error('Rust SIMD staging initialization failed');
    bridge.upload(storage, pointer, byteLength);
    const pipeline = await bridge.createComputePipeline(`
      @group(0) @binding(0) var<storage, read_write> values: array<u32>;
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let index = id.x;
        if (index < arrayLength(&values)) {
          values[index] = values[index] * 2u + 5u;
        }
      }
    `, 'main', 'Flow staging smoke');
    bridge.dispatch(pipeline, [{binding: 0, resource: {buffer: storage}}],
      Math.ceil(count / 64), 'Flow WASM/WebGPU round trip');
    await bridge.download(storage, pointer, byteLength);
    const verification = requireFunction(module, '_pr_flow_verify')(pointer, count);
    if (verification !== 0)
      throw new Error(`Rust SIMD readback verification failed: ${verification}`);
    return {
      status: 'FLOW_WEBGPU_WASM_ROUND_TRIP_PASSED', count, byteLength,
      stagingAbi: module._pr_flow_stage_abi(), simd128: true,
      adapter: bridge.adapter.info ? {
        vendor: bridge.adapter.info.vendor, architecture: bridge.adapter.info.architecture,
        device: bridge.adapter.info.device, description: bridge.adapter.info.description,
      } : null,
    };
  } finally {
    bridge.close();
  }
}
