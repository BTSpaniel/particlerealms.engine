// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Separable radix-2 complex FFT extracted from ParticleMeshEwald.
 * Buffers contain x-fastest interleaved vec2<f32>. A 2D batch occupies N*N
 * consecutive elements. Both directions are unnormalized: an inverse after
 * a forward transform yields N**dimensions times the original values.
 * The caller owns the device, encoder, submission and in-flight lifetime.
 */
import { createStorageBuffer, createUniformBuffer, destroyBuffers } from './GpuBuffer.js';

const WORKGROUP_SIZE = 128;
const FFT_PARAMS_BYTES = 32;
const pipelineDevices = new WeakMap();

export const COMPLEX_FFT_SHADER = /* wgsl */`
struct FftParams {
  axis: u32,
  stage: u32,
  inverse: u32,
  gridSize: u32,
  cellCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> params: FftParams;
@group(0) @binding(1) var<storage, read> fftInput: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> fftOutput: array<vec2<f32>>;

fn decodeIndex(index: u32) -> vec3<u32> {
  let size = params.gridSize;
  return vec3<u32>(index % size, (index / size) % size, index / (size * size));
}

fn flatten(coordinate: vec3<u32>) -> u32 {
  return coordinate.x + params.gridSize * (coordinate.y + params.gridSize * coordinate.z);
}

fn axisCoordinate(coordinate: vec3<u32>) -> u32 {
  if (params.axis == 0u) { return coordinate.x; }
  if (params.axis == 1u) { return coordinate.y; }
  return coordinate.z;
}

fn withAxis(coordinate: vec3<u32>, value: u32) -> vec3<u32> {
  if (params.axis == 0u) { return vec3<u32>(value, coordinate.y, coordinate.z); }
  if (params.axis == 1u) { return vec3<u32>(coordinate.x, value, coordinate.z); }
  return vec3<u32>(coordinate.x, coordinate.y, value);
}

fn reverseGridBits(value: u32) -> u32 {
  var source = value;
  var reversed = 0u;
  var span = params.gridSize;
  while (span > 1u) {
    reversed = (reversed << 1u) | (source & 1u);
    source >>= 1u;
    span >>= 1u;
  }
  return reversed;
}

fn complexMultiply(left: vec2<f32>, right: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(left.x * right.x - left.y * right.y, left.x * right.y + left.y * right.x);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn bitReverse(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.cellCount) { return; }
  let coordinate = decodeIndex(index);
  let source = withAxis(coordinate, reverseGridBits(axisCoordinate(coordinate)));
  fftOutput[index] = fftInput[flatten(source)];
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn fftStage(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.cellCount) { return; }
  let coordinate = decodeIndex(index);
  let outputAxis = axisCoordinate(coordinate);
  let length = 1u << params.stage;
  let half = length >> 1u;
  let block = (outputAxis / length) * length;
  let k = outputAxis % half;
  let a = fftInput[flatten(withAxis(coordinate, block + k))];
  let b = fftInput[flatten(withAxis(coordinate, block + k + half))];
  let direction = select(-1.0, 1.0, params.inverse != 0u);
  let angle = direction * 6.283185307179586 * f32(k) / f32(length);
  let rotated = complexMultiply(vec2<f32>(cos(angle), sin(angle)), b);
  fftOutput[index] = select(a + rotated, a - rotated, (outputAxis % length) >= half);
}
`;

function workgroupSizeFor(device) {
  const limit = Math.min(WORKGROUP_SIZE,
    device.limits?.maxComputeInvocationsPerWorkgroup ?? WORKGROUP_SIZE,
    device.limits?.maxComputeWorkgroupSizeX ?? WORKGROUP_SIZE);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Complex FFT requires a compute workgroup.');
  return 2 ** Math.floor(Math.log2(limit));
}

/** Shared pipelines may be borrowed by several forward/inverse plans. */
export function createComplexFftPipelines(device, { label = 'ComplexFft' } = {}) {
  if (!device?.createComputePipeline) throw new TypeError('Complex FFT requires a GPUDevice.');
  const workgroupSize = workgroupSizeFor(device);
  const code = COMPLEX_FFT_SHADER.replaceAll(`@workgroup_size(${WORKGROUP_SIZE})`, `@workgroup_size(${workgroupSize})`);
  const modules = [];
  const create = (suffix, entryPoint) => {
    const module = device.createShaderModule({ label: `${label}.${suffix}.shader`, code });
    modules.push(module);
    return device.createComputePipeline({ label: `${label}.${suffix}.pipeline`, layout: 'auto', compute: { module, entryPoint } });
  };
  const pipelines = { bitReverse: create('bitReverse', 'bitReverse'), stage: create('stage', 'fftStage'), workgroupSize };
  pipelineDevices.set(pipelines, device);
  // This is opt-in diagnostics, not a second compilation or a submitted job.
  pipelines.getCompilationInfo = async () => {
    const reports = await Promise.all(modules.map(module => module.getCompilationInfo?.() ?? { messages: [] }));
    const errors = reports.flatMap(report => report.messages).filter(message => message.type === 'error');
    if (errors.length) throw new Error(`Complex FFT shader compilation failed: ${errors.map(error => error.message).join('; ')}`);
    return reports;
  };
  return pipelines;
}

function validateBuffer(buffer, byteLength, usage, name) {
  if (!buffer || typeof buffer.destroy !== 'function') throw new TypeError(`${name} must be a GPUBuffer.`);
  if (buffer.size < byteLength) throw new RangeError(`${name} needs at least ${byteLength} bytes.`);
  if ((buffer.usage & usage) !== usage) throw new RangeError(`${name} is missing required GPUBufferUsage flags.`);
}

/**
 * Create a bounded transform plan. Supplied buffers/pipelines are borrowed.
 * encode() records into an external encoder and returns its result buffer.
 * External inputs require COPY_SRC and outputs require COPY_DST. Writing the
 * spectrum directly into inputBuffer avoids an extra input copy.
 * Batched 3D is intentionally rejected: PME's original z indexing is retained.
 */
export function createComplexFftPlan(device, {
  size, dimensions = 2, batchCount = 1, inverse = false, label = 'ComplexFft',
  buffers: suppliedBuffers = null, pipelines: suppliedPipelines = null, initialBufferIndex = 0,
} = {}) {
  if (!device?.createComputePipeline) throw new TypeError('Complex FFT requires a GPUDevice.');
  if (!Number.isSafeInteger(size) || size < 2 || !Number.isInteger(Math.log2(size))) throw new RangeError('Complex FFT size must be a power of two, at least two.');
  if (dimensions !== 2 && dimensions !== 3) throw new RangeError('Complex FFT dimensions must be two or three.');
  if (!Number.isSafeInteger(batchCount) || batchCount < 1 || dimensions === 3 && batchCount !== 1) throw new RangeError('Complex FFT batchCount must be positive; 3D currently supports one batch.');
  if (initialBufferIndex !== 0 && initialBufferIndex !== 1) throw new RangeError('Complex FFT initialBufferIndex must be zero or one.');
  if (typeof inverse !== 'boolean') throw new TypeError('Complex FFT inverse must be boolean.');
  const elementCount = size ** dimensions * batchCount;
  const byteLength = elementCount * 8;
  if (!Number.isSafeInteger(elementCount) || elementCount > 0xffffffff) throw new RangeError('Complex FFT element count exceeds u32 indexing.');
  for (const name of ['maxBufferSize', 'maxStorageBufferBindingSize']) {
    if (device.limits?.[name] && byteLength > device.limits[name]) throw new RangeError(`Complex FFT requires ${byteLength} bytes; ${name} is ${device.limits[name]}.`);
  }
  if (suppliedPipelines && pipelineDevices.get(suppliedPipelines) !== device) throw new TypeError('Complex FFT pipelines and GPUDevice do not match.');
  const workgroupSize = suppliedPipelines?.workgroupSize ?? workgroupSizeFor(device);
  const workgroups = Math.ceil(elementCount / workgroupSize);
  if (workgroups > (device.limits?.maxComputeWorkgroupsPerDimension ?? 65535)) throw new RangeError('Complex FFT dispatch exceeds maxComputeWorkgroupsPerDimension.');
  const ownsBuffers = suppliedBuffers === null;
  const ownedBuffers = [];
  const paramsBuffers = [];
  const passes = [];
  let buffers, pipelines;
  try {
    pipelines = suppliedPipelines ?? createComplexFftPipelines(device, { label });
    if (ownsBuffers) {
      for (const suffix of ['A', 'B']) ownedBuffers.push(createStorageBuffer(device, byteLength, { label: `${label}.spectral${suffix}` }));
      buffers = ownedBuffers;
    } else {
      if (!Array.isArray(suppliedBuffers) || suppliedBuffers.length !== 2 || suppliedBuffers[0] === suppliedBuffers[1]) throw new TypeError('Complex FFT requires two distinct ping-pong buffers.');
      buffers = suppliedBuffers.slice();
    }
    buffers.forEach((buffer, index) => validateBuffer(buffer, byteLength, GPUBufferUsage.STORAGE, `Complex FFT buffer ${index}`));
    let sourceIndex = initialBufferIndex;
    for (let axis = 0; axis < dimensions; axis += 1) {
      for (let stage = 0; stage <= Math.log2(size); stage += 1) {
        const destinationIndex = sourceIndex ^ 1;
        const paramsBuffer = createUniformBuffer(device, FFT_PARAMS_BYTES, { label: `${label}.${inverse ? 'inverse' : 'forward'}.${axis}.${stage}` });
        paramsBuffers.push(paramsBuffer);
        device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([axis, stage, inverse ? 1 : 0, size, elementCount, 0, 0, 0]));
        const pipeline = stage === 0 ? pipelines.bitReverse : pipelines.stage;
        passes.push({
          label: `${label}.${inverse ? 'inverse' : 'forward'}.axis${axis}.stage${stage}`,
          pipeline,
          bindGroup: device.createBindGroup({
            label: `${label}.bindGroup.${inverse}.${axis}.${stage}`,
            layout: pipeline.getBindGroupLayout(0),
            entries: [paramsBuffer, buffers[sourceIndex], buffers[destinationIndex]].map((buffer, binding) => ({ binding, resource: { buffer, offset: 0, size: binding === 0 ? FFT_PARAMS_BYTES : byteLength } })),
          }),
        });
        sourceIndex = destinationIndex;
      }
    }
    let disposed = false;
    const plan = {
      device, size, dimensions, batchCount, inverse, label, buffers, pipelines, passes, paramsBuffers,
      initialBufferIndex, finalBufferIndex: sourceIndex, inputBuffer: buffers[initialBufferIndex], outputBuffer: buffers[sourceIndex],
      elementCount, byteLength, workgroupSize, workgroups, passCount: passes.length,
      resourceBytes: ownedBuffers.reduce((sum, buffer) => sum + buffer.size, 0) + paramsBuffers.reduce((sum, buffer) => sum + buffer.size, 0),
      inverseNormalization: 1 / size ** dimensions, encodeCount: 0, lastEncoding: null,
      get disposed() { return disposed; },
      encode(encoder, input = plan.inputBuffer, output = null) {
        if (disposed) throw new Error('Complex FFT plan has been disposed.');
        if (!encoder?.beginComputePass) throw new TypeError('Complex FFT encode requires an external GPUCommandEncoder.');
        // Validate every copy before recording anything into the caller's encoder.
        if (input !== plan.inputBuffer) {
          validateBuffer(input, byteLength, GPUBufferUsage.COPY_SRC, 'Complex FFT input');
          validateBuffer(plan.inputBuffer, byteLength, GPUBufferUsage.COPY_DST, 'Complex FFT input scratch');
        }
        if (output && output !== plan.outputBuffer) {
          validateBuffer(output, byteLength, GPUBufferUsage.COPY_DST, 'Complex FFT output');
          validateBuffer(plan.outputBuffer, byteLength, GPUBufferUsage.COPY_SRC, 'Complex FFT result scratch');
        }
        try {
          if (input !== plan.inputBuffer) encoder.copyBufferToBuffer(input, 0, plan.inputBuffer, 0, byteLength);
          for (const fftPass of passes) {
            const pass = encoder.beginComputePass({ label: fftPass.label });
            pass.setPipeline(fftPass.pipeline);
            pass.setBindGroup(0, fftPass.bindGroup);
            pass.dispatchWorkgroups(workgroups);
            pass.end();
          }
          if (output && output !== plan.outputBuffer) encoder.copyBufferToBuffer(plan.outputBuffer, 0, output, 0, byteLength);
          plan.encodeCount += 1;
          plan.lastEncoding = Object.freeze({ passCount: passes.length, elementCount, inverse, submitted: false, inputCopied: input !== plan.inputBuffer, outputCopied: !!output && output !== plan.outputBuffer });
          return output || plan.outputBuffer;
        } catch (error) {
          console.debug('[ComplexFft][encode-failed]', { label, size, dimensions, batchCount, error: error.message });
          throw error;
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        destroyBuffers([...paramsBuffers, ...ownedBuffers]);
        console.debug('[ComplexFft][disposed]', { label, resourceBytes: plan.resourceBytes, encodeCount: plan.encodeCount });
      },
    };
    console.debug('[ComplexFft][created]', { label, size, dimensions, batchCount, inverse, passCount: plan.passCount, resourceBytes: plan.resourceBytes });
    return plan;
  } catch (error) {
    console.debug('[ComplexFft][create-failed]', { label, size, dimensions, batchCount, error: error.message });
    try { destroyBuffers([...paramsBuffers, ...ownedBuffers]); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Complex FFT creation and rollback failed.'); }
    throw error;
  }
}
