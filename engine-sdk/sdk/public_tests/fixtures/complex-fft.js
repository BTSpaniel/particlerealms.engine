// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule, sourceUrl, finishSuite } from '../resolver.js';
const { fft, ifft, fft2D, ifft2D } = await resolveModule("engine/core/math/MathSignal.js", ["fft", "ifft", "fft2D", "ifft2D"]);
const { createComplexFftPipelines, createComplexFftPlan } = await resolveModule("engine/core/gpu/ComplexFft.js", ["createComplexFftPipelines", "createComplexFftPlan"]);
const { createParticleMeshEwaldSystem, initParticleMeshEwaldBindGroups, executeParticleMeshEwald, destroyParticleMeshEwaldSystem } = await resolveModule("engine/sim/particles/ParticleMeshEwald.js", ["createParticleMeshEwaldSystem", "initParticleMeshEwaldBindGroups", "executeParticleMeshEwald", "destroyParticleMeshEwaldSystem"]);

const assert = (value, message) => { if (!value) throw new Error(message); };
const rejects = action => { let rejected = false; try { action(); } catch { rejected = true; } assert(rejected, 'Invalid operation was accepted.'); };
const nearArray = (actual, expected, tolerance = 1e-10) => {
  assert(actual.length === expected.length, 'Array length mismatch.');
  let maxError = 0;
  for (let i = 0; i < actual.length; i++) {
    const error = Math.abs(actual[i] - expected[i]); maxError = Math.max(maxError, error);
    assert(Number.isFinite(actual[i]) && error <= tolerance * (1 + Math.abs(expected[i])), `Element ${i}: ${actual[i]} != ${expected[i]}`);
  }
  return maxError;
};

// Independent direct DFT oracle: no radix-2 butterflies or bit permutations.
function dft2D(real, imag, width, height, inverse = false) {
  const outReal = new Array(real.length).fill(0), outImag = new Array(real.length).fill(0);
  const direction = inverse ? 1 : -1, normalization = inverse ? real.length : 1;
  for (let ky = 0; ky < height; ky++) for (let kx = 0; kx < width; kx++) {
    const target = ky * width + kx;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const source = y * width + x, angle = direction * 2 * Math.PI * (kx * x / width + ky * y / height);
      const c = Math.cos(angle), s = Math.sin(angle), imaginary = imag?.[source] ?? 0;
      outReal[target] += (real[source] * c - imaginary * s) / normalization;
      outImag[target] += (real[source] * s + imaginary * c) / normalization;
    }
  }
  return { real: outReal, imag: outImag };
}

function reference3D(input, size, inverse = false) {
  const real = Array.from(input.filter((_, index) => index % 2 === 0));
  const imag = Array.from(input.filter((_, index) => index % 2 === 1));
  for (let axis = 0; axis < 3; axis++) {
    const stride = size ** axis;
    for (let base = 0; base < real.length; base++) {
      if (Math.floor(base / stride) % size !== 0) continue;
      const indices = Array.from({ length: size }, (_, i) => base + i * stride);
      const transform = inverse ? ifft(indices.map(i => real[i]), indices.map(i => imag[i]))
        : fft(indices.map(i => real[i]), indices.map(i => imag[i]));
      indices.forEach((index, i) => { real[index] = transform.real[i] * (inverse ? size : 1); imag[index] = transform.imag[i] * (inverse ? size : 1); });
    }
  }
  return interleave({ real, imag });
}

function interleave({ real, imag }) {
  const values = new Float32Array(real.length * 2);
  for (let i = 0; i < real.length; i++) { values[i * 2] = real[i]; values[i * 2 + 1] = imag[i]; }
  return values;
}

function fakeDevice(limits = {}, failAfter = Infinity) {
  const resources = [], calls = [], writes = [];
  const device = {
    limits, resources, calls, writes,
    createBuffer(descriptor) {
      if (resources.length === failAfter) throw new Error('Injected allocation failure');
      const buffer = { ...descriptor, destroys: 0, destroy() { this.destroys++; } };
      resources.push(buffer); return buffer;
    },
    createShaderModule: descriptor => ({ ...descriptor, getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipeline: descriptor => ({ ...descriptor, getBindGroupLayout: () => ({}) }),
    createBindGroup: descriptor => descriptor,
    queue: { writeBuffer: (buffer, offset, data) => writes.push({ buffer, offset, data: Array.from(data) }), submit: () => { throw new Error('Utility submitted work.'); } },
  };
  return device;
}

function fakeEncoder() {
  const calls = [];
  return { calls,
    clearBuffer: () => {},
    copyBufferToBuffer: (...args) => calls.push({ copy: args }),
    beginComputePass({ label }) {
      const row = { label }; calls.push(row);
      return { setPipeline: pipeline => { row.pipeline = pipeline; }, setBindGroup: (_, group) => { row.group = group; }, dispatchWorkgroups: count => { row.workgroups = count; }, end: () => { row.ended = true; } };
    },
  };
}

async function readBuffer(device, input, bytes) {
  const readback = device.createBuffer({ label: 'ComplexFftTest.readback', size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(input, 0, readback, 0, bytes); device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readback.getMappedRange()).slice(); readback.unmap(); return result;
  } finally { readback.destroy(); }
}

function gpuError(actual, expected, normalization = 1) {
  let errorSquared = 0, normSquared = 0, maxError = 0;
  assert(actual.length === expected.length, 'GPU result length mismatch.');
  for (let i = 0; i < actual.length; i++) {
    const value = actual[i] * normalization, error = value - expected[i];
    assert(Number.isFinite(value), 'Nonfinite GPU result.');
    errorSquared += error * error; normSquared += expected[i] ** 2; maxError = Math.max(maxError, Math.abs(error));
  }
  const relativeL2 = Math.sqrt(errorSquared / Math.max(normSquared, 1e-30));
  assert(relativeL2 < 3e-5, `GPU FFT relative L2 ${relativeL2} exceeds 3e-5.`);
  return { relativeL2, maxError };
}

async function gpuTransformCheck(device, size, dimensions, batchCount) {
  const forward = createComplexFftPlan(device, { size, dimensions, batchCount, label: 'ComplexFftTest' });
  const inverse = createComplexFftPlan(device, { size, dimensions, batchCount, inverse: true, buffers: forward.buffers, pipelines: forward.pipelines, initialBufferIndex: forward.finalBufferIndex, label: 'ComplexFftTest' });
  try {
    await forward.pipelines.getCompilationInfo();
    const input = new Float32Array(forward.elementCount * 2), expected = new Float32Array(input.length);
    const perBatch = size ** dimensions;
    for (let batch = 0; batch < batchCount; batch++) {
      for (let index = 0; index < perBatch; index++) {
        const x = index % size, y = Math.floor(index / size) % size, z = Math.floor(index / (size * size));
        const phase = 2 * Math.PI * (-x + 2 * y + (dimensions === 3 ? z : 0)) / size;
        const at = (batch * perBatch + index) * 2;
        input[at] = batch === 1 ? 2 : Math.cos(phase) + (index === 3 ? .25 : 0);
        input[at + 1] = batch === 1 ? -.75 : Math.sin(phase) + (index === 2 ? -.5 : 0);
      }
      const values = input.subarray(batch * perBatch * 2, (batch + 1) * perBatch * 2);
      const transformed = dimensions === 3 ? reference3D(values, size) : interleave(fft2D(
        Array.from(values.filter((_, i) => i % 2 === 0)), size, size, Array.from(values.filter((_, i) => i % 2 === 1))));
      expected.set(transformed, batch * perBatch * 2);
    }
    device.queue.writeBuffer(forward.inputBuffer, 0, input);
    let encoder = device.createCommandEncoder(); forward.encode(encoder); device.queue.submit([encoder.finish()]);
    const forwardError = gpuError(await readBuffer(device, forward.outputBuffer, forward.byteLength), expected);
    encoder = device.createCommandEncoder(); inverse.encode(encoder); device.queue.submit([encoder.finish()]);
    const roundTripError = gpuError(await readBuffer(device, inverse.outputBuffer, inverse.byteLength), input, inverse.inverseNormalization);
    assert(roundTripError.maxError < 3e-5, 'Normalized complex round trip exceeds pointwise tolerance.');
    return { size, dimensions, batchCount, forwardError, roundTripError };
  } finally { inverse.dispose(); forward.dispose(); }
}

function encodePass(encoder, label, pipeline, group, workgroups) {
  const pass = encoder.beginComputePass({ label }); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(workgroups); pass.end();
}

// Compare complete PME output with its exact same deposit/solve/gather kernels,
// replacing only GPU transforms by independently validated CPU transforms.
async function pmeReferenceCheck(device, size, backend = 'pme') {
  const count = 16, owned = [], systems = [];
  const createBuffer = (data, label) => {
    const buffer = device.createBuffer({ label, size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    owned.push(buffer); device.queue.writeBuffer(buffer, 0, data); return buffer;
  };
  try {
    const positions = new Float32Array(count * 4), velocities = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      positions[i * 4] = Math.sin(i * 2.17) * 3.5; positions[i * 4 + 1] = Math.cos(i * 1.37) * 3.5; positions[i * 4 + 2] = Math.sin(i * 1.71) * 3.5;
      velocities[i * 4 + 3] = 1e9;
    }
    const position = createBuffer(positions, 'PMEReference.positions'), meta = createBuffer(new Float32Array(count * 4), 'PMEReference.meta'), thermal = createBuffer(new Float32Array(count * 4), 'PMEReference.thermal');
    const actualVelocity = createBuffer(velocities, 'PMEReference.actualVelocity'), referenceVelocity = createBuffer(velocities, 'PMEReference.referenceVelocity');
    const options = { backend, gridSize: size, domainHalfExtent: 6, coupling: .08, maxAcceleration: 1e8, damping: 1, defaultSource: 1, useParticleMass: false, windowRadius: backend === 'esp' ? 3 : 2 };
    const actual = createParticleMeshEwaldSystem(device, count, options); systems.push(actual);
    const reference = createParticleMeshEwaldSystem(device, count, options); systems.push(reference);
    initParticleMeshEwaldBindGroups(actual, device, position, actualVelocity, meta, thermal);
    initParticleMeshEwaldBindGroups(reference, device, position, referenceVelocity, meta, thermal);
    let encoder = device.createCommandEncoder(); const receipt = executeParticleMeshEwald(actual, device, count, .01, { encoder }); device.queue.submit([encoder.finish()]);
    assert(receipt.submitted === false && receipt.passCount === 6 + 6 * (1 + Math.log2(size)), 'PME external-encoder/pass-count contract changed.');
    const actualValues = await readBuffer(device, actualVelocity, velocities.byteLength);
    // Prime immutable global uniforms using the public executor; discard these
    // commands, then execute only reference deposit/solve/gather below.
    executeParticleMeshEwald(reference, device, count, .01, { encoder: device.createCommandEncoder() });
    const { buffers, pipelines, bindGroups, forwardPlan, inversePlan } = reference;
    encoder = device.createCommandEncoder();
    for (const key of ['cellCounts', 'cellCursors', 'spectralA', 'spectralB', 'diagnostics']) encoder.clearBuffer(buffers[key]);
    for (const [name, workgroups] of [['assign', 1], ['prefix', 1], ['scatter', 1], ['deposit', Math.ceil(size ** 3 / 128)]]) encodePass(encoder, `PMEReference.${name}`, pipelines[name], bindGroups[name], workgroups);
    device.queue.submit([encoder.finish()]);
    const density = await readBuffer(device, buffers.spectralA, forwardPlan.byteLength);
    device.queue.writeBuffer(forwardPlan.outputBuffer, 0, reference3D(density, size));
    encoder = device.createCommandEncoder(); encodePass(encoder, 'PMEReference.solve', pipelines.solve, bindGroups.solve, Math.ceil(size ** 3 / 128)); device.queue.submit([encoder.finish()]);
    const reciprocal = await readBuffer(device, forwardPlan.outputBuffer, forwardPlan.byteLength);
    device.queue.writeBuffer(inversePlan.outputBuffer, 0, reference3D(reciprocal, size, true));
    encoder = device.createCommandEncoder(); encodePass(encoder, 'PMEReference.gather', pipelines.gather, bindGroups.gather, 1); device.queue.submit([encoder.finish()]);
    const expectedValues = await readBuffer(device, referenceVelocity, velocities.byteLength);
    // Exclude velocity.w's lifetime sentinel, which would hide force errors.
    const xyz = values => Array.from(values).filter((_, i) => i % 4 !== 3);
    const error = gpuError(xyz(actualValues), xyz(expectedValues));
    assert(xyz(actualValues).some(value => Math.abs(value) > 1e-8), 'PME comparison has zero force.');
    return { size, backend, error, passCount: receipt.passCount };
  } finally { systems.forEach(destroyParticleMeshEwaldSystem); owned.forEach(buffer => buffer.destroy()); }
}

export async function runTests({ gpu = false } = {}) {
  const checks = [];
  const check = async (name, action) => { try { checks.push({ name, ok: true, detail: await action() }); } catch (error) { checks.push({ name, ok: false, error: error.stack || String(error) }); } };
  await check('Complex rectangular FFT and inverse agree with direct DFT without changing inputs', () => {
    const width = 4, height = 8, real = Float64Array.from({ length: width * height }, (_, i) => Math.sin(i * .73) + i / 37), imag = Float64Array.from(real, (_, i) => Math.cos(i * .41) * .7);
    const originalReal = real.slice(), originalImag = imag.slice();
    const expected = dft2D(real, imag, width, height), actual = fft2D(real, width, height, imag);
    nearArray(actual.real, expected.real); nearArray(actual.imag, expected.imag);
    const recovered = ifft2D(actual.real, actual.imag, width, height), directInverse = dft2D(actual.real, actual.imag, width, height, true);
    nearArray(recovered.real, real); nearArray(recovered.imag, imag); nearArray(recovered.real, directInverse.real); nearArray(recovered.imag, directInverse.imag);
    nearArray(real, originalReal, 0); nearArray(imag, originalImag, 0);
    return { width, height };
  });
  await check('Real-only calls, impulse, constant and negative complex frequency preserve sign and normalization', () => {
    const size = 8, count = size * size, impulse = new Array(count).fill(0); impulse[0] = 1;
    nearArray(fft2D(impulse, size, size).real, new Array(count).fill(1));
    const constant = fft2D(new Array(count).fill(3), size, size); nearArray(constant.real, [count * 3, ...new Array(count - 1).fill(0)]);
    const real = [], imag = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const phase = 2 * Math.PI * (-x + 2 * y) / size; real.push(Math.cos(phase)); imag.push(Math.sin(phase)); }
    const signed = fft2D(real, size, size, imag), expected = new Array(count).fill(0); expected[2 * size + size - 1] = count;
    nearArray(signed.real, expected); nearArray(signed.imag, new Array(count).fill(0));
    const recovered = ifft2D(signed.real, signed.imag, size, size); nearArray(recovered.real, real); nearArray(recovered.imag, imag);
    const realInput = fft2D(real, size, size), inverse = ifft2D(realInput.real, realInput.imag, size, size); nearArray(inverse.real, real);
    const singleton = fft2D([2], 1, 1, [-3]); nearArray(ifft2D(singleton.real, singleton.imag, 1, 1).imag, [-3]);
  });
  await check('2D FFT rejects malformed dimensions, lengths and nonfinite complex components', () => {
    for (const [width, height] of [[0, 2], [3, 2], [2, 3], [Infinity, 2], [2.5, 2]]) rejects(() => fft2D([1, 2, 3, 4], width, height));
    rejects(() => fft2D([1], 2, 2)); rejects(() => fft2D([1, 2, 3, 4], 2, 2, [0])); rejects(() => fft2D([1, NaN, 3, 4], 2, 2)); rejects(() => ifft2D([1, 2, 3, 4], [0, Infinity, 0, 0], 2, 2));
  });
  // CPU-only browsers may omit WebGPU constants. These values match the API
  // flags and are used solely by mock allocation/ownership tests below.
  globalThis.GPUBufferUsage ??= { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
  await check('Plans record exact axis/stage order, immutable uniforms and caller-owned submissions', () => {
    for (const dimensions of [2, 3]) {
      const device = fakeDevice(), plan = createComplexFftPlan(device, { size: 8, dimensions, batchCount: dimensions === 2 ? 3 : 1, label: 'ParticleMeshFFT' });
      const encoder = fakeEncoder(); assert(plan.encode(encoder) === plan.outputBuffer, 'Returned result buffer differs.');
      assert(encoder.calls.length === dimensions * 4 && encoder.calls.every(row => row.ended), 'Transform pass count/order incomplete.');
      encoder.calls.forEach((row, index) => assert(row.label === `ParticleMeshFFT.forward.axis${Math.floor(index / 4)}.stage${index % 4}`, 'PME pass label changed.'));
      assert(device.writes.every(row => row.offset === 0 && row.data.length === 8 && row.data[4] === plan.elementCount), 'Immutable 32-byte params contract changed.');
      assert(new Set(device.writes.map(row => row.buffer)).size === plan.passCount, 'Passes share overwritten uniform slots.');
      assert(plan.lastEncoding.submitted === false && plan.inverseNormalization === 1 / 8 ** dimensions, 'Submission/normalization contract changed.');
      const input = device.createBuffer({ size: plan.byteLength, usage: GPUBufferUsage.COPY_SRC }), output = device.createBuffer({ size: plan.byteLength, usage: GPUBufferUsage.COPY_DST });
      const copying = fakeEncoder(); assert(plan.encode(copying, input, output) === output, 'External output was ignored.');
      assert(copying.calls[0].copy[0] === input && copying.calls.at(-1).copy[2] === output, 'External copy order changed.');
      plan.dispose(); plan.dispose(); rejects(() => plan.encode(fakeEncoder()));
      assert(plan.buffers.every(buffer => buffer.destroys === 1) && plan.paramsBuffers.every(buffer => buffer.destroys === 1), 'Owned resources were not destroyed exactly once.');
      assert(input.destroys === 0 && output.destroys === 0, 'Caller input/output was destroyed.');
    }
  });
  await check('Borrowed PME buffers, pipeline device identity, hardware limits and rollback are enforced', async () => {
    const device = fakeDevice(), pipelines = createComplexFftPipelines(device, { label: 'ParticleMesh.fft' });
    const buffers = [0, 1].map(() => device.createBuffer({ size: 8 ** 3 * 8, usage: GPUBufferUsage.STORAGE }));
    const plan = createComplexFftPlan(device, { size: 8, dimensions: 3, inverse: true, buffers, pipelines, initialBufferIndex: 0, label: 'ParticleMeshFFT' });
    await pipelines.getCompilationInfo(); assert(plan.passes[0].label === 'ParticleMeshFFT.inverse.axis0.stage0', 'Inverse label changed.');
    assert(plan.resourceBytes === plan.passCount * 32, 'Borrowed memory was charged as owned.'); plan.dispose(); assert(buffers.every(buffer => buffer.destroys === 0), 'Borrowed storage was destroyed.');
    rejects(() => createComplexFftPlan(fakeDevice(), { size: 8, pipelines }));
    for (const options of [{ size: 7 }, { size: 8, dimensions: 3, batchCount: 2 }, { size: 8, batchCount: 0 }, { size: 8, initialBufferIndex: 2 }]) rejects(() => createComplexFftPlan(device, options));
    const small = fakeDevice({ maxStorageBufferBindingSize: 64 }); rejects(() => createComplexFftPlan(small, { size: 8 })); assert(small.resources.length === 0, 'Oversized plan allocated before admission.');
    rejects(() => createComplexFftPlan(fakeDevice({ maxComputeWorkgroupsPerDimension: 1 }), { size: 256 }));
    const fallback = createComplexFftPlan(fakeDevice({ maxComputeInvocationsPerWorkgroup: 64, maxComputeWorkgroupSizeX: 64 }), { size: 8 }); assert(fallback.workgroupSize === 64, 'Safe device workgroup specialization failed.'); fallback.dispose();
    const failing = fakeDevice({}, 4); rejects(() => createComplexFftPlan(failing, { size: 8 })); assert(failing.resources.every(buffer => buffer.destroys === 1), 'Failed construction leaked buffers.');
  });
  await check('PME imports the single shared core and retains gather normalization', async () => {
    const source = await (await fetch(sourceUrl('engine/sim/particles/ParticleMeshEwald.js'))).text();
    assert(source.includes("from '../../core/gpu/ComplexFft.js'") && !source.includes('const FFT_SHADER') && !source.includes('function createFftPlan('), 'PME retains a duplicated FFT.');
    assert(source.includes('potential[flattenCell(wrapped, params.gridSize)].x * params.inverseCellCount') && source.includes('f32[19] = 1 / memory.cells'), 'PME inverse normalization changed.');
  });
  await check('PME wrapper preserves external encoding, device checks and complete resource cleanup', () => {
    const device = fakeDevice(), system = createParticleMeshEwaldSystem(device, 16, { gridSize: 8 });
    const particleBuffers = [0, 1, 2, 3].map(() => device.createBuffer({ size: 16 * 16, usage: GPUBufferUsage.STORAGE }));
    initParticleMeshEwaldBindGroups(system, device, ...particleBuffers);
    const encoder = fakeEncoder(), receipt = executeParticleMeshEwald(system, device, 16, .01, { encoder });
    assert(receipt.passCount === 30 && receipt.submitted === false, 'PME 3D transform count/submission changed.');
    assert(encoder.calls[4].label === 'ParticleMeshFFT.forward.axis0.stage0'
      && encoder.calls[15].label === 'ParticleMeshFFT.forward.axis2.stage3'
      && encoder.calls[16].label === 'ParticleMesh.solve'
      && encoder.calls[17].label === 'ParticleMeshFFT.inverse.axis0.stage0'
      && encoder.calls.at(-1).label === 'ParticleMesh.gather', 'PME stage ordering changed.');
    rejects(() => executeParticleMeshEwald(system, fakeDevice(), 16, .01, { encoder: fakeEncoder() }));
    destroyParticleMeshEwaldSystem(system);
    assert(device.resources.filter(buffer => !particleBuffers.includes(buffer)).every(buffer => buffer.destroys === 1), 'PME-owned resources were not all destroyed once.');
    assert(particleBuffers.every(buffer => buffer.destroys === 0), 'PME destroyed caller particle buffers.');
  });
  if (gpu) {
    let device;
    await check('Native GPU FFT and PME parity suite', async () => {
      assert(navigator.gpu, 'Native WebGPU is unavailable.'); const adapter = await navigator.gpu.requestAdapter(); assert(adapter, 'Native WebGPU adapter unavailable.');
      device = await adapter.requestDevice(); const uncaptured = []; device.addEventListener('uncapturederror', event => uncaptured.push(event.error.message));
      device.pushErrorScope('validation');
      try {
        const transforms = [];
        for (const [size, dimensions, batches] of [[8, 2, 3], [128, 2, 3], [256, 2, 3], [8, 3, 1], [16, 3, 1], [32, 3, 1]]) transforms.push(await gpuTransformCheck(device, size, dimensions, batches));
        const pme = [];
        for (const size of [8, 16, 32]) pme.push(await pmeReferenceCheck(device, size));
        pme.push(await pmeReferenceCheck(device, 8, 'esp'));
        const error = await device.popErrorScope(); assert(!error, `GPU validation: ${error?.message}`); assert(uncaptured.length === 0, `Uncaptured GPU errors: ${uncaptured.join('; ')}`);
        return { transforms, pme, uncaptured };
      } catch (error) { await device.popErrorScope().catch(() => {}); throw error; }
    });
    device?.destroy();
  }
  return { status: checks.every(row => row.ok) ? 'passed' : 'failed', gpuRequested: gpu, checks };
}

const result = await runTests({gpu:false});
export const suiteResult = finishSuite('complex-fft', result.checks.map(row => ({name:row.name, passed:row.ok, error:row.error, detail:row.detail, evidence:row.name.startsWith('PME imports') ? 'source-contract' : row.name.startsWith('Plans') || row.name.startsWith('Borrowed') || row.name.startsWith('PME wrapper') ? 'controlled-resource-contract' : 'CPU numerical execution'})));
