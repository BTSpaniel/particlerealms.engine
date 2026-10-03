// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ComputeError, assertCompute, throwIfComputeAborted, awaitComputeAbort } from './ComputeErrors.js';
import { createMatmulShader, validateMatrixMultiply } from '../gpu/MatmulKernel.js';
import { GpuTriangularClothProgram, validateTriangularClothGpuProgram } from '../../sim/cloth/triangular/gpu-program.js';

const VALIDATION = `
@group(0) @binding(3) var<storage, read_write> precisionStatus: atomic<u32>;
fn meetsComparison(value: f32, errorBound: f32) -> bool {
    return abs(value) <= 3.4e38 && errorBound <= 0.0001 + 0.00002 * abs(value);
}
`;
const TRANSFORM = VALIDATION + `
@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read> params: array<f32>;
@group(0) @binding(2) var<storage, read_write> destination: array<f32>;
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
    let base = invocation.x * 3u;
    if (base + 2u >= arrayLength(&source)) { return; }
    let x=source[base]; let y=source[base+1u]; let z=source[base+2u];
    let w=params[3]*x+params[7]*y+params[11]*z+params[15];
    var invW=1.0/w; if (abs(w)<0.000001) { invW=1.0; }
    let wError=0.000001*(abs(params[3]*x)+abs(params[7]*y)+abs(params[11]*z)+abs(params[15]))+1.0e-37;
    if (!(abs(w)<=3.4e38) || abs(abs(w)-0.000001)<=wError) { atomicOr(&precisionStatus,1u); }
    for (var axis=0u; axis<3u; axis++) {
        let result=(params[axis]*x+params[4u+axis]*y+params[8u+axis]*z+params[12u+axis])*invW;
        let numeratorError=0.000001*(abs(params[axis]*x)+abs(params[4u+axis]*y)+abs(params[8u+axis]*z)+abs(params[12u+axis]))+1.0e-37;
        var errorBound=numeratorError;
        if (abs(w)>=0.000001) {
            errorBound=(numeratorError+abs(result)*wError)/max(abs(w)-wError,1.0e-37)+0.0000003*abs(result);
        }
        if (!meetsComparison(result,errorBound)) { atomicOr(&precisionStatus,1u); }
        destination[base+axis]=result;
    }
}`;
const LUMINANCE = VALIDATION + `
@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var<storage, read> params: array<f32>;
@group(0) @binding(2) var<storage, read_write> destination: array<f32>;
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
    let i=invocation.x; if (i>=arrayLength(&destination)) { return; }
    let pixel=source[i];
    let r=f32(pixel&255u)*params[0]; let g=f32((pixel>>8u)&255u)*params[1]; let b=f32((pixel>>16u)&255u)*params[2];
    let result=(r+g+b)*params[3];
    let errorBound=0.000001*(abs(r)+abs(g)+abs(b))*abs(params[3])+1.0e-37;
    if (!meetsComparison(result,errorBound)) { atomicOr(&precisionStatus,1u); }
    destination[i]=result;
}`;

/** GPU compute uses an injected engine lease or the kernel's app-scoped broker. */
export class WebGpuComputeProvider {
    constructor(options = {}) {
        this.options = options;
        this.available = typeof options.acquireGpu === 'function';
        this._owners = new Map();
        this._closed = false;
    }

    async _owner(ownerId) {
        let state = this._owners.get(ownerId);
        if (state) {
            await state.ready;
            try { state.assert(); return state; }
            catch (error) { this._retire(state); return this._owner(ownerId); }
        }
        assertCompute(!this._closed && this.available, 'COMPUTE_BACKEND_UNAVAILABLE', 'A host GPU owner lease is required');
        state = { ownerId, alive: true, outputs: new Set(), pipelines: new Map() };
        this._owners.set(ownerId, state);
        state.ready = (async () => {
            const lease = await this.options.acquireGpu(ownerId);
            if (!state.alive || this._closed) { lease?.release?.(); throw new ComputeError('COMPUTE_OWNER_REVOKED', 'GPU acquisition was revoked'); }
            assertCompute(lease?.device?.queue, 'COMPUTE_BACKEND_UNAVAILABLE', 'GPU lease contains no device');
            state.lease = lease; state.device = lease.device;
            state.generation = typeof lease.generation === 'function' ? lease.generation() : lease.generation;
            state.run = callback => { state.assert(); return lease.run ? lease.run(callback) : callback(); };
            state.assert = () => {
                const current = typeof lease.generation === 'function' ? lease.generation() : lease.generation;
                assertCompute(state.alive && !this._closed && current === state.generation, 'COMPUTE_GPU_INVALIDATED', 'GPU compute resources belong to a retired generation');
            };
            state.device.lost?.then(() => this._retire(state)).catch(() => {});
        })();
        try { await state.ready; return state; }
        catch (error) { if (this._owners.get(ownerId) === state) this._owners.delete(ownerId); throw error; }
    }

    _retire(state) {
        if (!state.alive) return;
        state.alive = false;
        for (const output of state.outputs) output.dispose();
        state.clothProgram?.destroy();
        state.pipelines.clear(); state.lease?.release?.();
        if (this._owners.get(state.ownerId) === state) this._owners.delete(state.ownerId);
    }

    _output(state, native, outputBytes) {
        const device = state.device;
        const record = { location: 'gpu', dtype: 'f32', shape: [outputBytes / 4], byteLength: outputBytes,
            gpuBuffer: native, gpuOwner: state, assertGpu: () => { state.assert(); assertCompute(!record.closed, 'COMPUTE_INVALID_HANDLE', 'GPU output is released'); },
            closed: false,
            dispose: () => { if (record.closed) return; record.closed = true; native?.destroy(); state.outputs.delete(record); },
            readCopy: async (readSignal = null) => {
                throwIfComputeAborted(readSignal);
                record.assertGpu();
                if (!outputBytes) return new Float32Array();
                let staging;
                const cancelRead = () => staging?.destroy();
                try {
                    state.run(() => {
                        staging = device.createBuffer({ size: outputBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, label: 'compute-readback' });
                        const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(native, 0, staging, 0, outputBytes); device.queue.submit([encoder.finish()]);
                    });
                    readSignal?.addEventListener('abort', cancelRead, { once: true });
                    await awaitComputeAbort(staging.mapAsync(GPUMapMode.READ), readSignal);
                    record.assertGpu();
                    return new Float32Array(staging.getMappedRange().slice(0));
                } finally { readSignal?.removeEventListener('abort', cancelRead); staging?.destroy(); }
            } };
        state.outputs.add(record);
        return record;
    }

    /** Reserve CPU copies before reading retained GPU inputs or producing CPU outputs. */
    estimateCpuTransferBytes(task) {
        const inputs = task.inputs;
        let readbackBytes = 0, outputBytes = 0;
        if (task.operation === 'math.matrix.multiply@1') {
            const { rows, inner, columns } = task.parameters || {};
            assertCompute([rows, inner, columns].every(value => Number.isSafeInteger(value) && value > 0),
                'COMPUTE_INVALID_INPUT', 'Matrix dimensions must be positive safe integers');
            for (const key of ['a', 'b']) {
                const source = inputs[key];
                assertCompute(source?.location === 'gpu' ? source.dtype === 'f32' : source instanceof Float32Array,
                    'COMPUTE_INVALID_INPUT', 'Matrix inputs must contain float32 values');
                const expectedBytes = (key === 'a' ? rows * inner : inner * columns) * 4;
                assertCompute(Number.isSafeInteger(expectedBytes) && source.byteLength === expectedBytes,
                    'COMPUTE_INVALID_INPUT', 'Matrix input dimensions do not match its element count');
                if (source.location === 'gpu') readbackBytes += source.byteLength;
            }
            outputBytes = rows * columns * 4;
        } else if (task.operation === 'math.geometry.transform-points@1') {
            const { positions, matrix } = inputs;
            assertCompute((positions?.location === 'gpu' ? positions.dtype === 'f32' : positions instanceof Float32Array)
                && positions.byteLength % 12 === 0
                && (matrix?.location === 'gpu' ? matrix.dtype === 'f32' : matrix instanceof Float32Array)
                && matrix.byteLength === 64, 'COMPUTE_INVALID_INPUT', 'GPU transforms require packed f32 xyz positions and a f32 matrix');
            if (matrix.location === 'gpu') readbackBytes = matrix.byteLength;
            outputBytes = positions.byteLength;
        } else {
            throw new ComputeError('COMPUTE_BACKEND_UNAVAILABLE', 'Operation cannot consume retained GPU inputs');
        }
        // Account for readback snapshots and copies, result handoff, and the same
        // bounded report/scratch allowance used for CPU-visible input transport.
        const bytes = readbackBytes * 2 + (task.policy.outputLocation === 'gpu' ? 0 : outputBytes * 2) + 65536 + 1024;
        assertCompute(Number.isSafeInteger(outputBytes) && Number.isSafeInteger(bytes),
            'COMPUTE_MEMORY_LIMIT', 'GPU transfer estimate exceeds addressable memory');
        return bytes;
    }

    async execute(ownerId, task, signal) {
        throwIfComputeAborted(signal);
        assertCompute(task.policy.precision === 'f32', 'COMPUTE_PRECISION_UNSUPPORTED', 'WebGPU compute requires explicit f32 precision');
        if (task.operation === 'math.matrix.multiply@1') return this._executeMatrix(ownerId, task, signal);
        if(task.operation==='math.geometry.cloth-iteration@1')return this._executeCloth(ownerId,task,signal);
        const transform = task.operation === 'math.geometry.transform-points@1';
        assertCompute(transform || task.operation === 'math.image.luminance@1', 'COMPUTE_BACKEND_UNAVAILABLE', 'Operation has no GPU implementation');
        const state = await awaitComputeAbort(this._owner(ownerId), signal);
        throwIfComputeAborted(signal); state.assert();
        const p = task.parameters || {};
        let source = task.inputs[transform ? 'positions' : 'image'];
        let matrix = transform ? task.inputs.matrix : null;
        if (matrix?.location === 'gpu') matrix = await awaitComputeAbort(matrix.readCopy(signal), signal);
        const retained = source?.location === 'gpu';
        if (retained) {
            source.assertGpu();
            assertCompute(source.gpuOwner === state, 'COMPUTE_GPU_INVALIDATED', 'GPU input belongs to a different owner or generation');
        }
        const sourceBytes = retained ? source.byteLength : source?.byteLength;
        if (transform) {
            assertCompute((retained ? source.dtype === 'f32' : source instanceof Float32Array)
                && sourceBytes % 12 === 0 && matrix instanceof Float32Array && matrix.length === 16,
                'COMPUTE_INVALID_INPUT', 'GPU transforms require packed f32 xyz positions and a f32 matrix');
        } else {
            assertCompute(!retained && (source instanceof Uint8Array || source instanceof Uint8ClampedArray)
                && Number.isSafeInteger(p.width) && Number.isSafeInteger(p.height) && p.width > 0 && p.height > 0 && source.length === p.width * p.height * 4,
                'COMPUTE_INVALID_INPUT', 'GPU luminance requires a complete RGBA image');
            assertCompute((!p.mode || p.mode === 'encoded') && !p.alphaWeight && !p.includeAlphaWeight && !p.byteOutput,
                'COMPUTE_INVALID_INPUT', 'GPU luminance supports the encoded float32 contract');
        }
        const count = transform ? sourceBytes / 12 : sourceBytes / 4;
        const outputBytes = transform ? sourceBytes : count * 4;
        if (!outputBytes) {
            const record = this._output(state, null, 0);
            const result = task.policy.outputLocation === 'gpu' ? record : new Float32Array();
            if (task.policy.outputLocation !== 'gpu') record.dispose();
            return { value: { count: 0 }, outputs: { positions: result },
                metrics: { workers: 0, gpuUploadBytes: 0, gpuReadbackBytes: 0, gpuGeneration: state.generation } };
        }
        const params = transform ? matrix : new Float32Array([...(p.coefficients || [0.2126, 0.7152, 0.0722]), p.normalized || p.normalizedOutput ? 1 / 255 : 1]);
        if (!transform) assertCompute(Array.from(params).every(Number.isFinite)
            && 255 * (Math.abs(params[0]) + Math.abs(params[1]) + Math.abs(params[2])) <= 3.4028234663852886e38,
            'COMPUTE_PRECISION_UNSUPPORTED', 'Luminance coefficients exceed the finite float32 arithmetic range');
        const device = state.device;
        assertCompute(sourceBytes <= device.limits.maxStorageBufferBindingSize && outputBytes <= device.limits.maxStorageBufferBindingSize
            && Math.ceil(count / 128) <= device.limits.maxComputeWorkgroupsPerDimension,
            'COMPUTE_GPU_LIMIT', 'GPU workload exceeds device limits');
        const transient = [];
        let output = null, precisionReadback = null;
        const started = performance.now();
        try {
            let pipeline = state.pipelines.get(task.operation);
            if (!pipeline) {
                const module = state.run(() => device.createShaderModule({ label: task.operation, code: transform ? TRANSFORM : LUMINANCE }));
                const compilation = await awaitComputeAbort(module.getCompilationInfo(), signal);
                const errors = compilation.messages.filter(message => message.type === 'error');
                assertCompute(errors.length === 0, 'COMPUTE_GPU_SHADER_FAILED', errors.map(error => error.message).join('\n'));
                pipeline = await awaitComputeAbort(device.createComputePipelineAsync({ label: task.operation,
                    layout: 'auto', compute: { module, entryPoint: 'main' } }), signal);
                state.assert(); throwIfComputeAborted(signal);
                state.pipelines.set(task.operation, pipeline);
            }
            const frameBudget = state.lease.frameBudgetBroker || this.options.frameBudgetBroker;
            await frameBudget?.beforeSubmit({ workClass: task.policy.priority || 'background', estimatedGpuMs: 4, signal });
            throwIfComputeAborted(signal); state.assert();
            const scopedValidation = typeof device.pushErrorScope === 'function' && typeof device.popErrorScope === 'function';
            if (scopedValidation) device.pushErrorScope('validation');
            let validation;
            try { state.run(() => {
                const allocate = (size, usage, label) => {
                    const buffer = device.createBuffer({ size: Math.max(4, Math.ceil(size / 4) * 4), usage, label });
                    transient.push(buffer); return buffer;
                };
                const input = retained ? source.gpuBuffer : allocate(sourceBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'compute-input');
                const uniform = allocate(params.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'compute-parameters');
                output = allocate(outputBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, 'compute-output');
                const precisionStatus = allocate(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'compute-precision-status');
                precisionReadback = allocate(4, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, 'compute-precision-readback');
                if (!retained) device.queue.writeBuffer(input, 0, source.buffer, source.byteOffset, source.byteLength);
                device.queue.writeBuffer(uniform, 0, params.buffer, params.byteOffset, params.byteLength);
                const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [input, uniform, output, precisionStatus].map((buffer, binding) => ({ binding, resource: { buffer } })) });
                const encoder = device.createCommandEncoder({ label: task.operation });
                const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(Math.ceil(count / 128)); pass.end();
                encoder.copyBufferToBuffer(precisionStatus, 0, precisionReadback, 0, 4);
                device.queue.submit([encoder.finish()]);
            }); } finally { validation = scopedValidation ? device.popErrorScope() : Promise.resolve(null); }
            const validationError = await awaitComputeAbort(validation, signal);
            assertCompute(!validationError, 'COMPUTE_GPU_VALIDATION_FAILED', validationError?.message || 'GPU validation failed');
            await awaitComputeAbort(device.queue.onSubmittedWorkDone(), signal);
            throwIfComputeAborted(signal); state.assert();
            await awaitComputeAbort(precisionReadback.mapAsync(GPUMapMode.READ), signal);
            assertCompute(new Uint32Array(precisionReadback.getMappedRange())[0] === 0,
                'COMPUTE_PRECISION_UNSUPPORTED', 'GPU input conditioning cannot meet the declared float32 comparison');
            precisionReadback.unmap();
            const native = output;
            const record = this._output(state, native, outputBytes);
            transient.splice(transient.indexOf(native), 1);
            let result;
            if (task.policy.outputLocation === 'gpu') result = record;
            else { try { result = await record.readCopy(signal); } finally { record.dispose(); } }
            return { value: transform ? { count } : { width: p.width, height: p.height, pixelCount: count },
                outputs: { [transform ? 'positions' : 'luminance']: result },
                metrics: { workers: 0, gpuMs: performance.now() - started, gpuUploadBytes: (retained ? 0 : sourceBytes) + params.byteLength,
                    gpuReadbackBytes: task.policy.outputLocation === 'gpu' ? 0 : outputBytes, gpuValidationReadbackBytes: 4, gpuGeneration: state.generation } };
        } finally { for (const buffer of transient) buffer.destroy(); }
    }

    async _executeMatrix(ownerId, task, signal) {
        const state = await awaitComputeAbort(this._owner(ownerId), signal), device = state.device, p = task.parameters || {};
        const inputs = {};
        // Readback remains explicit in metrics when an earlier GPU result is used.
        let inputReadbackBytes = 0;
        for (const key of ['a', 'b']) {
            const source = task.inputs[key];
            if (source?.location === 'gpu') {
                source.assertGpu();
                assertCompute(source.gpuOwner === state, 'COMPUTE_GPU_INVALIDATED', 'Matrix input belongs to another owner or generation');
                inputs[key] = await source.readCopy(signal); inputReadbackBytes += source.byteLength;
            } else inputs[key] = source;
        }
        try { validateMatrixMultiply(inputs.a, inputs.b, p); }
        catch (error) { throw new ComputeError('COMPUTE_INVALID_INPUT', error.message); }
        throwIfComputeAborted(signal); state.assert();
        const outputBytes = p.rows * p.columns * 4;
        assertCompute([inputs.a.byteLength, inputs.b.byteLength, outputBytes].every(size => size <= device.limits.maxStorageBufferBindingSize && size <= device.limits.maxBufferSize)
            && Math.ceil(p.rows / 8) <= device.limits.maxComputeWorkgroupsPerDimension && Math.ceil(p.columns / 8) <= device.limits.maxComputeWorkgroupsPerDimension,
            'COMPUTE_GPU_LIMIT', 'Matrix workload exceeds GPU device limits');
        const transient = [], started = performance.now();
        try {
            let pipeline = state.pipelines.get(task.operation);
            if (!pipeline) {
                const module = state.run(() => device.createShaderModule({ label: task.operation, code: createMatmulShader(8, { validatePrecision: true }) }));
                const compilation = await awaitComputeAbort(module.getCompilationInfo(), signal);
                const errors = compilation.messages.filter(message => message.type === 'error');
                assertCompute(!errors.length, 'COMPUTE_GPU_SHADER_FAILED', errors.map(error => error.message).join('\n'));
                pipeline = await awaitComputeAbort(device.createComputePipelineAsync({ label: task.operation, layout: 'auto', compute: { module, entryPoint: 'main' } }), signal);
                state.assert(); throwIfComputeAborted(signal); state.pipelines.set(task.operation, pipeline);
            }
            const frameBudget = state.lease.frameBudgetBroker || this.options.frameBudgetBroker;
            await frameBudget?.beforeSubmit({ workClass: task.policy.priority || 'background', estimatedGpuMs: 4, signal });
            throwIfComputeAborted(signal); state.assert();
            let output, precisionReadback;
            const scopedValidation = typeof device.pushErrorScope === 'function' && typeof device.popErrorScope === 'function';
            if (scopedValidation) device.pushErrorScope('validation');
            let validation;
            try { state.run(() => {
                const allocate = (size, usage, label) => {
                    const buffer = device.createBuffer({ size: Math.max(4, size), usage, label }); transient.push(buffer); return buffer;
                };
                const a = allocate(inputs.a.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'compute-matrix-a');
                const b = allocate(inputs.b.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'compute-matrix-b');
                output = allocate(outputBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'compute-matrix-result');
                const dimensions = allocate(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'compute-matrix-dimensions');
                const precisionStatus = allocate(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'compute-matrix-precision');
                precisionReadback = allocate(4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'compute-matrix-validation');
                device.queue.writeBuffer(a, 0, inputs.a); device.queue.writeBuffer(b, 0, inputs.b);
                device.queue.writeBuffer(dimensions, 0, new Uint32Array([p.rows, p.inner, p.columns, 0]));
                const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [a, b, output, dimensions, precisionStatus].map((buffer, binding) => ({ binding, resource: { buffer } })) });
                const encoder = device.createCommandEncoder({ label: task.operation }), pass = encoder.beginComputePass();
                pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(p.rows / 8), Math.ceil(p.columns / 8)); pass.end();
                encoder.copyBufferToBuffer(precisionStatus, 0, precisionReadback, 0, 4); device.queue.submit([encoder.finish()]);
            }); } finally { validation = scopedValidation ? device.popErrorScope() : Promise.resolve(null); }
            const validationError = await awaitComputeAbort(validation, signal);
            assertCompute(!validationError, 'COMPUTE_GPU_VALIDATION_FAILED', validationError?.message || 'Matrix GPU validation failed');
            await awaitComputeAbort(device.queue.onSubmittedWorkDone(), signal);
            throwIfComputeAborted(signal); state.assert();
            await awaitComputeAbort(precisionReadback.mapAsync(GPUMapMode.READ), signal);
            assertCompute(new Uint32Array(precisionReadback.getMappedRange())[0] === 0, 'COMPUTE_PRECISION_UNSUPPORTED', 'Matrix conditioning cannot meet the float32 comparison bound');
            precisionReadback.unmap();
            const record = this._output(state, output, outputBytes); transient.splice(transient.indexOf(output), 1);
            let matrix;
            if (task.policy.outputLocation === 'gpu') matrix = record;
            else { try { matrix = await record.readCopy(signal); } finally { record.dispose(); } }
            return { value: { rows: p.rows, columns: p.columns }, outputs: { matrix }, metrics: {
                workers: 0, gpuMs: performance.now() - started, gpuUploadBytes: inputs.a.byteLength + inputs.b.byteLength + 16,
                gpuReadbackBytes: inputReadbackBytes + (task.policy.outputLocation === 'gpu' ? 0 : outputBytes), gpuValidationReadbackBytes: 4, gpuGeneration: state.generation,
            } };
        } finally { for (const buffer of transient) buffer.destroy(); }
    }

    async _executeCloth(ownerId,task,signal){
        assertCompute(task.policy.outputLocation!=='gpu','COMPUTE_INVALID_INPUT','Cloth candidates require CPU readback for continuous contact acceptance');
        const parameters=validateTriangularClothGpuProgram(task.inputs,task.parameters),state=await awaitComputeAbort(this._owner(ownerId),signal),device=state.device;
        throwIfComputeAborted(signal);state.assert();
        assertCompute(Object.values(task.inputs).every(value=>value.byteLength<=device.limits.maxStorageBufferBindingSize&&value.byteLength<=device.limits.maxBufferSize),'COMPUTE_GPU_LIMIT','Cloth program exceeds device buffer limits');
        const frameBudget=state.lease.frameBudgetBroker||this.options.frameBudgetBroker;
        await frameBudget?.beforeSubmit({workClass:task.policy.priority||'background',estimatedGpuMs:4,signal});
        const readbacks=[],started=performance.now();let receipt,validation;
        const cancel=()=>{for(const buffer of readbacks)buffer.destroy();};
        signal?.addEventListener('abort',cancel,{once:true});
        try{
            device.pushErrorScope('validation');
            try{state.run(()=>{
                state.clothProgram??=new GpuTriangularClothProgram(device,{maxInFlightOperations:2});
                const encoder=device.createCommandEncoder({label:task.operation});receipt=state.clothProgram.encode(encoder,task.inputs,parameters);
                for(const source of [receipt.positions,receipt.iterationStart,receipt.constraints,receipt.reports]){
                    const buffer=device.createBuffer({size:source.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,label:'cloth candidate readback'});readbacks.push(buffer);encoder.copyBufferToBuffer(source,0,buffer,0,source.size);
                }
                device.queue.submit([encoder.finish()]);
            });}finally{validation=device.popErrorScope();}
            const error=await awaitComputeAbort(validation,signal);assertCompute(!error,'COMPUTE_GPU_VALIDATION_FAILED',error?.message||'Cloth GPU validation failed');
            await awaitComputeAbort(Promise.all(readbacks.map(buffer=>buffer.mapAsync(GPUMapMode.READ))),signal);state.assert();throwIfComputeAborted(signal);
            const values=readbacks.map((buffer,index)=>index===2?new Uint8Array(buffer.getMappedRange().slice(0)):new Float32Array(buffer.getMappedRange().slice(0)));
            readbacks.forEach(buffer=>buffer.unmap());
            const [positions,iterationStart,constraints,reports]=values;
            assertCompute([...positions,...iterationStart,...reports].every(Number.isFinite),'COMPUTE_PRECISION_UNSUPPORTED','Cloth candidate became nonfinite');
            for(let i=3;i<reports.length;i+=4)assertCompute(reports[i]===0,'COMPUTE_PRECISION_UNSUPPORTED','Cloth material or geometry lies outside the GPU numerical domain');
            await receipt.retire(device.queue.onSubmittedWorkDone());
            return {value:{vertexCount:positions.length/4,constraintCount:constraints.length/80,iterations:parameters.iterations},outputs:{positions,iterationStart,constraints,reports},metrics:{workers:0,gpuMs:performance.now()-started,gpuUploadBytes:Object.values(task.inputs).reduce((sum,value)=>sum+value.byteLength,0),gpuReadbackBytes:values.reduce((sum,value)=>sum+value.byteLength,0),gpuGeneration:state.generation}};
        }finally{signal?.removeEventListener('abort',cancel);cancel();receipt?.release();}
    }

    releaseOwner(ownerId) { const state = this._owners.get(ownerId); if (state) this._retire(state); }
    dispose() { this._closed = true; for (const state of [...this._owners.values()]) this._retire(state); }
}
