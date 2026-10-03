// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { getComputeOperation, listComputeOperations, validateComputeOperation, projectComputeOperationParameters, estimateComputeMemory, estimateComputeTransferBytes } from './ComputeOperations.js';
import { detectWasmCapabilities } from './WasmCapabilities.js';
import { WasmComputeProvider } from './WasmComputeProvider.js';
import { WebGpuComputeProvider } from './WebGpuComputeProvider.js';
import { ComputeError, computeFailure, assertCompute, throwIfComputeAborted, awaitComputeAbort } from './ComputeErrors.js';
import { isPlainJsonObject } from '../schema/StrictJsonValue.js';
import { assertComputeContract, projectComputeContractValue } from './ComputeContracts.js';

const MiB = 1024 * 1024;
const RECENT_JOB_LIMIT = 24;
const TYPES = new Map([[Uint8Array, 'u8'], [Uint8ClampedArray, 'u8clamped'], [Int8Array, 'i8'],
    [Uint16Array, 'u16'], [Int16Array, 'i16'], [Uint32Array, 'u32'], [Int32Array, 'i32'],
    [Float32Array, 'f32'], [Float64Array, 'f64']]);
const METHODS = ['capabilities', 'listOperations', 'copyFrom', 'readCopy', 'releaseBuffer', 'submit', 'wait', 'cancel', 'releaseJob'];
const BACKENDS = new Set(['auto', 'js', 'wasm-scalar', 'wasm-simd', 'wasm-threads', 'wasm-threads-simd', 'webgpu']);
const POLICY_KEYS = new Set(['backend', 'outputLocation', 'precision', 'timeoutMs', 'priority']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const JOB_RECORD_BYTES = 512;
const TYPED_ARRAY = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_GET = name => Object.getOwnPropertyDescriptor(TYPED_ARRAY, name).get;
const TYPED_NAME = Object.getOwnPropertyDescriptor(TYPED_ARRAY, Symbol.toStringTag).get;
const TYPED_LENGTH = TYPED_GET('length'), TYPED_BUFFER = TYPED_GET('buffer');
const TYPED_OFFSET = TYPED_GET('byteOffset'), TYPED_SET = TYPED_ARRAY.set;
const BUFFER_BYTES = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const TYPES_BY_NAME = new Map([...TYPES.keys()].map(Type => [Type.name, Type]));
const now = () => performance.now();
const token = record => Object.freeze({ id: record.id, generation: record.generation });

function typedArrayInfo(value) {
    // Use intrinsic slots: own constructor/length/byteLength getters are caller data.
    const Type = ArrayBuffer.isView(value) && TYPES_BY_NAME.get(TYPED_NAME.call(value));
    assertCompute(Type, 'COMPUTE_INVALID_INPUT', 'A supported typed array is required');
    const buffer = TYPED_BUFFER.call(value), byteOffset = TYPED_OFFSET.call(value), length = TYPED_LENGTH.call(value);
    return { Type, length, byteLength: length * Type.BYTES_PER_ELEMENT, buffer, byteOffset };
}

function controlBytes(value, maximum = MiB, code = 'COMPUTE_INVALID_INPUT') {
    let bytes = 0, nodes = 0;
    const seen = new Set(), ancestors = new Set(), buffers = new Set();
    const check = condition => assertCompute(condition, code, 'Compute controls exceed their bounded data-only contract');
    const charge = count => { bytes += count; check(Number.isSafeInteger(bytes) && bytes <= maximum); };
    const visit = (item, depth) => {
        check(++nodes <= 100000 && depth <= 32);
        if (item == null || typeof item === 'boolean' || typeof item === 'number') { charge(8); return; }
        if (typeof item === 'string') { charge(item.length * 2 + 16); return; }
        check(typeof item === 'object');
        if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) {
            let buffer;
            try { buffer = ArrayBuffer.isView(item) ? typedArrayInfo(item).buffer : item; BUFFER_BYTES.call(buffer); }
            catch (_) { check(false); }
            // Structured clone copies the backing store, including a view's unused range.
            if (!buffers.has(buffer)) { buffers.add(buffer); charge(BUFFER_BYTES.call(buffer)); }
            charge(32); return;
        }
        check(Array.isArray(item) || isPlainJsonObject(item));
        check(!ancestors.has(item));
        if (seen.has(item)) return;
        seen.add(item); ancestors.add(item); charge(32);
        if (Array.isArray(item)) check(item.length <= 100000);
        const keys = Reflect.ownKeys(item); check(keys.length <= 100000);
        if (Array.isArray(item)) check(keys.length === item.length + 1);
        for (const key of keys) {
            if (Array.isArray(item) && key === 'length') continue;
            check(typeof key === 'string' && !FORBIDDEN_KEYS.has(key));
            if (Array.isArray(item)) check(/^(0|[1-9]\d*)$/.test(key) && Number(key) < item.length);
            const descriptor = Object.getOwnPropertyDescriptor(item, key);
            check(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
            charge(key.length * 2 + 16); visit(descriptor.value, depth + 1);
        }
        ancestors.delete(item);
    };
    visit(value, 0);
    return bytes;
}

function controlObject(value, keys, code = 'COMPUTE_INVALID_INPUT') {
    assertCompute(isPlainJsonObject(value), code, 'Compute options must be a plain object');
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        assertCompute(typeof key === 'string' && (!keys || keys.has(key)) && !FORBIDDEN_KEYS.has(key)
            && descriptor?.enumerable && Object.hasOwn(descriptor, 'value'), code, 'Unsupported compute option or accessor');
    }
    return value;
}

function validateHandle(handle) {
    // Schema engines read property values; reject accessors and oversized controls
    // using native descriptors before allowing those reads or any handle lookup.
    controlObject(handle, new Set(['id', 'generation']), 'COMPUTE_INVALID_HANDLE');
    controlBytes(handle, 4096, 'COMPUTE_INVALID_HANDLE');
    return assertComputeContract('handle', handle, { code: 'COMPUTE_INVALID_HANDLE' });
}

function payloadBytes(value, seen = new Set()) {
    if (value == null || typeof value === 'boolean') return 8;
    if (typeof value === 'number') return 8;
    if (typeof value === 'string') return value.length * 2;
    if (seen.has(value)) return 0;
    seen.add(value);
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    return 32 + Object.entries(value).reduce((sum, [key, entry]) => sum + key.length * 2 + payloadBytes(entry, seen), 0);
}

function resultOutputMetadata(operation, precision, parameters, outputs) {
    const expected = getComputeOperation(operation).result.outputs, metadata = {};
    assertCompute(isPlainJsonObject(outputs), 'COMPUTE_INVALID_RESULT', 'Compute outputs must be a named object');
    for (const [name, contract] of Object.entries(expected)) {
        const included = contract.presentWhen === 'parameters.includeAlpha !== false' ? parameters.includeAlpha !== false
            : contract.presentWhen === 'parameters.includeLuminance !== false' ? parameters.includeLuminance !== false : true;
        assertCompute(Object.hasOwn(outputs, name) === included, 'COMPUTE_INVALID_RESULT', 'Compute output names do not match the operation');
    }
    for (const [name, output] of Object.entries(outputs)) {
        const contract = expected[name];
        assertCompute(contract, 'COMPUTE_INVALID_RESULT', 'Compute returned an undeclared output');
        let dtype, shape, byteLength;
        if (output?.location === 'gpu') ({ dtype, shape, byteLength } = output);
        else {
            const native = typedArrayInfo(output);
            dtype = TYPES.get(native.Type); shape = [native.length]; byteLength = native.byteLength;
        }
        assertComputeContract('buffer-descriptor', { dtype, shape }, { code: 'COMPUTE_INVALID_RESULT' });
        const elementBytes = [...TYPES].find(([, name]) => name === dtype)?.[0].BYTES_PER_ELEMENT;
        assertCompute(dtype === (contract.dtypeByPrecision?.[precision] ?? contract.dtype)
            && Number.isSafeInteger(byteLength) && byteLength >= 0 && shape.reduce((a, b) => a * b, 1) * elementBytes === byteLength,
        'COMPUTE_INVALID_RESULT', 'Compute output type or byte layout does not match the operation');
        if (contract.shape.every(Number.isSafeInteger)) assertCompute(shape.length === contract.shape.length
            && shape.every((dimension, index) => dimension === contract.shape[index]), 'COMPUTE_INVALID_RESULT', 'Compute output fixed shape does not match the operation');
        metadata[name] = { dtype, shape, byteLength, location: output.location === 'gpu' ? 'gpu' : 'cpu' };
    }
    return metadata;
}

/**
 * Shallow publication metadata, distinct from the full job-result projection.
 * The report marker states the native root category only. Large arrays of audio
 * frames, glyphs or numeric reports retain their native contents and avoid an
 * additional schema traversal. Output handle authority remains in _lookup().
 */
export function projectComputeResultContract(result) {
    const value = result.value;
    const kind = value === null ? 'null' : ArrayBuffer.isView(value) ? 'typed-array'
        : value instanceof ArrayBuffer ? 'array-buffer' : Array.isArray(value) ? 'array' : typeof value;
    return { value: { $computeType: 'report', kind }, outputs: projectComputeContractValue(result.outputs),
        backend: result.backend, metrics: projectComputeContractValue(result.metrics) };
}

/** Explicitly owned async compute service; importing this module starts no workers. */
export class ComputeRuntime {
    constructor(options = {}) {
        this.options = options;
        this.logger = options.logger === null ? null : (options.logger || console);
        this.maxOwnerBytes = options.maxOwnerBytes ?? 256 * MiB;
        this.maxBytes = options.maxBytes ?? 512 * MiB;
        this.maxOwnerGpuBytes = options.maxOwnerGpuBytes ?? 256 * MiB;
        this.maxGpuBytes = options.maxGpuBytes ?? 512 * MiB;
        this.maxQueuedPerOwner = options.maxQueuedPerOwner ?? 64;
        this.maxBuffersPerOwner = options.maxBuffersPerOwner ?? 1024;
        this.maxBuffers = options.maxBuffers ?? 4096;
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
        assertCompute(Number.isSafeInteger(options.maxWorkers ?? 4) && (options.maxWorkers ?? 4) > 0,
            'COMPUTE_INVALID_CONFIG', 'Compute worker limit must be a positive integer');
        this.maxWorkers = Math.min(4, Math.max(1, (globalThis.navigator?.hardwareConcurrency || 2) - 1), options.maxWorkers ?? 4);
        for (const value of [this.maxOwnerBytes, this.maxBytes, this.maxOwnerGpuBytes, this.maxGpuBytes, this.maxQueuedPerOwner,
            this.maxBuffersPerOwner, this.maxBuffers, this.defaultTimeoutMs])
            assertCompute(Number.isSafeInteger(value) && value > 0, 'COMPUTE_INVALID_CONFIG', 'Compute limits must be positive integers');
        this.accelerationEnabled = options.accelerationEnabled !== false;
        this._owners = new Map(); this._buffers = new Map(); this._jobs = new Map(); this._queue = [];
        this._sequence = 0; this._namespace = crypto.randomUUID(); this._closed = false; this._active = null;
        this._lastOwner = null; this._draining = null; this._cpuBytes = 0; this._heapBytes = 0; this._gpuBytes = 0;
        this._stats = { completed: 0, failed: 0, cancelled: 0, peakCpuBytes: 0, lastBackend: null, lastError: null, backendCounts: {} };
        this._profiles = new Map();
        this._recentJobs = []; this._diagnosticsEpoch = 0;
        this._cpu = new WasmComputeProvider({ ...options, maxWorkers: this.maxWorkers,
            reserve: (ownerId, bytes) => { this._reserve(this._owners.get(ownerId), bytes); this._heapBytes += bytes; },
            unreserve: (ownerId, bytes) => { this._unreserve(this._owners.get(ownerId), bytes); this._heapBytes -= bytes; } });
        this._gpu = new WebGpuComputeProvider(options);
    }

    _log(event, detail = {}) {
        this.logger?.debug?.(`[ComputeRuntime] ${event}`, detail);
    }
    _assertOwner(owner) {
        assertCompute(!this._closed && owner?.alive && this._owners.get(owner.id) === owner, 'COMPUTE_OWNER_REVOKED', 'Compute owner is no longer active');
    }
    _reserve(owner, bytes) {
        this._assertOwner(owner);
        assertCompute(Number.isSafeInteger(bytes) && bytes >= 0 && owner.bytes + bytes <= this.maxOwnerBytes && this._cpuBytes + bytes <= this.maxBytes,
            'COMPUTE_MEMORY_LIMIT', 'Compute memory budget exceeded');
        owner.bytes += bytes; this._cpuBytes += bytes;
        this._stats.peakCpuBytes = Math.max(this._stats.peakCpuBytes, this._cpuBytes);
    }
    _unreserve(owner, bytes) { if (owner) owner.bytes -= bytes; this._cpuBytes -= bytes; }
    _assertBufferCapacity(owner, count = 1) {
        this._assertOwner(owner);
        assertCompute(owner.buffers + count <= this.maxBuffersPerOwner && this._buffers.size + count <= this.maxBuffers,
            'COMPUTE_MEMORY_LIMIT', 'Compute retained buffer limit exceeded');
    }
    _newId(kind) { return `${this._namespace}:${kind}:${++this._sequence}`; }
    _lookup(map, handle, owner, kind) {
        this._assertOwner(owner);
        validateHandle(handle);
        const record = handle && map.get(handle.id);
        assertCompute(record && record.owner === owner && record.generation === handle.generation && record.alive,
            'COMPUTE_INVALID_HANDLE', `Unknown, released, or foreign ${kind}`);
        return record;
    }

    /** Create one trusted host owner. OS callers receive only the returned facade. */
    createContext(ownerId) {
        assertCompute(typeof ownerId === 'string' && ownerId.length > 0 && ownerId.length <= 256 && !this._owners.has(ownerId) && !this._closed,
            'COMPUTE_INVALID_OWNER', 'Compute owner must be unique and active');
        const owner = { id: ownerId, alive: true, generation: ++this._sequence, bytes: 0, gpuBytes: 0, buffers: 0, controller: new AbortController() };
        this._owners.set(ownerId, owner);
        const context = {};
        for (const method of METHODS) context[method] = (...args) => this[`_${method}`](owner, ...args);
        this._log('owner-created', { ownerId });
        return Object.freeze(context);
    }

    async _capabilities(owner) {
        this._assertOwner(owner);
        const report = await this.inspectCapabilities({ signal: owner.controller.signal });
        this._assertOwner(owner);
        return { ...report, budget: { usedBytes: owner.bytes, maxBytes: this.maxOwnerBytes,
            gpuUsedBytes: owner.gpuBytes, maxGpuBytes: this.maxOwnerGpuBytes,
            maxQueuedJobs: this.maxQueuedPerOwner, maxWorkers: this.maxWorkers,
            buffers: owner.buffers, maxBuffers: this.maxBuffersPerOwner } };
    }

    /** Inspect metadata without allocating an owner, worker, heap, or GPU lease. */
    async inspectCapabilities({ signal } = {}) {
        assertCompute(!this._closed, 'COMPUTE_CLOSED', 'Compute runtime is closed');
        throwIfComputeAborted(signal);
        const supported = detectWasmCapabilities();
        let deployed = [], deploymentError = null;
        try { deployed = Object.keys((await awaitComputeAbort(this._cpu.manifest(), signal)).variants).map(name => `wasm-${name}`); }
        catch (error) { throwIfComputeAborted(signal); deploymentError = computeFailure(error).code; }
        throwIfComputeAborted(signal);
        assertCompute(!this._closed, 'COMPUTE_CLOSED', 'Compute runtime is closed');
        const available = new Set(['js', ...deployed, ...(this._gpu.available ? ['webgpu'] : [])]);
        const backends = {};
        for (const backend of BACKENDS) {
            if (backend === 'auto') continue;
            const hardware = backend === 'webgpu' ? Boolean(globalThis.navigator?.gpu)
                : supported.workers && (backend === 'js' || supported.wasm
                    && (!backend.includes('simd') || supported.simd) && (!backend.includes('threads') || supported.threads));
            backends[backend] = { supported: hardware, deployed: available.has(backend),
                enabled: hardware && available.has(backend) && (backend === 'js' || this.accelerationEnabled),
                permitted: backend !== 'webgpu' || this._gpu.available };
        }
        return { supported, deployed: ['js', ...deployed, ...(this._gpu.available ? ['webgpu'] : [])],
            enabled: { acceleration: this.accelerationEnabled, threads: backends['wasm-threads'].enabled || backends['wasm-threads-simd'].enabled,
                gpu: backends.webgpu.enabled },
            permitted: { approvedOperations: true, arbitraryModules: false, gpu: this._gpu.available }, backends, deploymentError,
            operations: structuredClone(listComputeOperations().map(({ id, name, domain, moduleId, inputs, precisions,
                defaultPrecision, backends, wasmVariants, gpuPrecisions, result, comparison, parameterSchema, requestSchema, resultSchema }) => ({ id, name, domain,
                moduleId, inputs, precisions, defaultPrecision, backends, wasmVariants, gpuPrecisions, result, comparison, parameterSchema, requestSchema, resultSchema }))) };
    }
    async _listOperations(owner, filters = {}) { this._assertOwner(owner); return structuredClone(listComputeOperations(filters)); }

    async _copyFrom(owner, data, descriptor = {}) {
        this._assertOwner(owner);
        if (data instanceof ArrayBuffer) data = new Uint8Array(data);
        const { Type, length, byteLength, buffer, byteOffset } = typedArrayInfo(data);
        controlObject(descriptor, new Set(['elementType', 'dtype', 'shape']));
        controlBytes(descriptor, 4096);
        descriptor = structuredClone(descriptor);
        const dtype = TYPES.get(Type);
        assertCompute(!descriptor.elementType || descriptor.elementType === dtype, 'COMPUTE_INVALID_INPUT', 'Buffer element type mismatch');
        assertCompute(!descriptor.dtype || descriptor.dtype === dtype, 'COMPUTE_INVALID_INPUT', 'Buffer dtype mismatch');
        let shape = [length];
        if (descriptor.shape != null) {
            const shapeLength = Array.isArray(descriptor.shape) ? descriptor.shape.length : typedArrayInfo(descriptor.shape).length;
            assertCompute(shapeLength > 0 && shapeLength <= 8, 'COMPUTE_INVALID_INPUT', 'Buffer shape must have one to eight dimensions');
            shape = Array.from(descriptor.shape);
        }
        assertCompute(shape.length > 0 && shape.length <= 8 && shape.every(n => Number.isSafeInteger(n) && n >= 0)
            && shape.reduce((a, b) => a * b, 1) === length, 'COMPUTE_INVALID_INPUT', 'Buffer shape does not match its element count');
        assertComputeContract('buffer-descriptor', { dtype, shape });
        this._assertBufferCapacity(owner);
        this._reserve(owner, byteLength);
        let copy;
        try {
            // Pin the captured length even if a shared backing store grows while
            // copying; the admitted bytes and destination size remain identical.
            const source = new Type(buffer, byteOffset, length);
            copy = new Type(length);
            TYPED_SET.call(copy, source);
        } catch (error) { this._unreserve(owner, byteLength); throw computeFailure(error, 'COMPUTE_INVALID_INPUT'); }
        return token(this._storeBuffer(owner, { data: copy, dtype, shape }, true));
    }

    _storeBuffer(owner, value, reserved = false) {
        const gpu = value.location === 'gpu';
        const bytes = gpu ? value.byteLength : value.data.byteLength;
        if (!reserved && !gpu) this._reserve(owner, bytes);
        const buffer = { ...value, id: this._newId('buffer'), owner, generation: owner.generation, alive: true, refs: 0,
            bytes, location: gpu ? 'gpu' : 'cpu' };
        this._buffers.set(buffer.id, buffer);
        owner.buffers++;
        if (gpu) { this._gpuBytes += bytes; owner.gpuBytes += bytes; }
        return buffer;
    }
    _freeBuffer(buffer) {
        if (buffer.alive || buffer.refs || !this._buffers.has(buffer.id)) return;
        this._buffers.delete(buffer.id);
        buffer.owner.buffers--;
        if (buffer.location === 'gpu') { buffer.dispose(); this._gpuBytes -= buffer.bytes; buffer.owner.gpuBytes -= buffer.bytes; }
        if (buffer.location !== 'gpu') this._unreserve(buffer.owner, buffer.bytes);
        buffer.data = null;
    }
    async _readCopy(owner, handle) {
        const buffer = this._lookup(this._buffers, handle, owner, 'buffer');
        this._reserve(owner, buffer.bytes);
        buffer.refs++;
        try {
            const result = buffer.location === 'gpu'
                ? await awaitComputeAbort(buffer.readCopy(owner.controller.signal), owner.controller.signal) : new buffer.data.constructor(buffer.data);
            this._assertOwner(owner);
            assertCompute(buffer.alive, 'COMPUTE_INVALID_HANDLE', 'Buffer was released during readback');
            return result;
        } finally { this._unreserve(owner, buffer.bytes); buffer.refs--; this._freeBuffer(buffer); }
    }
    async _releaseBuffer(owner, handle) {
        this._assertOwner(owner);
        validateHandle(handle);
        const buffer = this._buffers.get(handle?.id);
        if (!buffer) return false;
        assertCompute(buffer.owner === owner && buffer.generation === handle.generation, 'COMPUTE_INVALID_HANDLE', 'Foreign buffer');
        buffer.alive = false; this._freeBuffer(buffer); return true;
    }

    async _submit(owner, operation, request = {}) {
        this._assertOwner(owner);
        const descriptor = getComputeOperation(operation);
        assertCompute(descriptor, 'COMPUTE_UNKNOWN_OPERATION', `Unknown operation ${operation}`);
        controlObject(request, new Set(['inputs', 'parameters', 'policy']));
        const requestedPolicy = controlObject(request.policy ?? {}, POLICY_KEYS, 'COMPUTE_INVALID_POLICY');
        controlBytes(requestedPolicy, 4096, 'COMPUTE_INVALID_POLICY');
        const policy = { backend: requestedPolicy.backend ?? 'auto', outputLocation: requestedPolicy.outputLocation ?? 'cpu',
            precision: requestedPolicy.precision ?? descriptor.defaultPrecision ?? 'f64',
            priority: requestedPolicy.priority ?? 'background', timeoutMs: requestedPolicy.timeoutMs ?? this.defaultTimeoutMs };
        assertCompute(BACKENDS.has(policy.backend) && ['cpu', 'gpu'].includes(policy.outputLocation), 'COMPUTE_INVALID_POLICY', 'Unsupported execution policy');
        assertCompute(['background', 'interactive'].includes(policy.priority), 'COMPUTE_INVALID_POLICY', 'Compute requests cannot claim a host execution class');
        assertCompute((descriptor.precisions || ['f64']).includes(policy.precision), 'COMPUTE_PRECISION_UNSUPPORTED', 'Operation does not support the requested precision');
        assertComputeContract('policy', policy, { code: 'COMPUTE_INVALID_POLICY' });
        assertCompute(this.accelerationEnabled || policy.backend === 'auto' || policy.backend === 'js', 'COMPUTE_BACKEND_DISABLED', 'Compute acceleration is disabled');
        assertCompute(this.accelerationEnabled || policy.outputLocation === 'cpu', 'COMPUTE_BACKEND_DISABLED', 'GPU output is unavailable while acceleration is disabled');
        const count = [...this._jobs.values()].filter(job => job.owner === owner && !job.settled).length;
        assertCompute(count < this.maxQueuedPerOwner, 'COMPUTE_QUEUE_FULL', 'Owner compute queue is full');
        assertCompute([...this._jobs.values()].filter(job => job.owner === owner).length < this.maxQueuedPerOwner * 4,
            'COMPUTE_QUEUE_FULL', 'Release completed jobs before submitting more work');
        const records = {};
        const inputNames = new Set(descriptor.inputs);
        if (descriptor.name === 'signal.fft') inputNames.add('imag');
        const requestedInputs = controlObject(request.inputs ?? {}, inputNames);
        for (const [name, handle] of Object.entries(requestedInputs)) records[name] = this._lookup(this._buffers, handle, owner, 'input buffer');
        const requestedParameters = controlObject(request.parameters ?? {}, null);
        const controls = controlBytes({ policy, parameters: requestedParameters });
        const timeoutMs = policy.timeoutMs;
        assertCompute(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000, 'COMPUTE_INVALID_POLICY', 'Job timeout must be within five minutes');
        // Charge the retained control copy before cloning. The job remains charged
        // while its handle exists, including after failure or queued cancellation.
        const retainedControlBytes = controls + JOB_RECORD_BYTES;
        this._reserve(owner, retainedControlBytes);
        let parameters;
        try {
            parameters = structuredClone(requestedParameters);
            assertComputeContract('job-request', { operation, inputs: requestedInputs,
                parameters: projectComputeOperationParameters(operation, parameters), policy });
            // CPU-visible inputs can be structurally checked before admission. GPU
            // handles are validated by their provider without forcing a readback.
            if (Object.values(records).every(buffer => buffer.location === 'cpu')) {
                const task = { operation, inputs: Object.fromEntries(Object.entries(records).map(([key, buffer]) => [key, buffer.data])), parameters, policy };
                validateComputeOperation(task);
                assertCompute(estimateComputeMemory(task) <= this.maxOwnerBytes, 'COMPUTE_MEMORY_LIMIT', 'Job scratch requirement exceeds the owner budget');
            }
        } catch (error) {
            this._unreserve(owner, retainedControlBytes);
            throw computeFailure(error, 'COMPUTE_INVALID_INPUT');
        }
        this._assertOwner(owner);
        for (const buffer of Object.values(records)) buffer.refs++;
        const job = { id: this._newId('job'), owner, generation: owner.generation, alive: true, operation, records, parameters, policy,
            state: 'queued', settled: false, released: false, controller: new AbortController(), createdAt: now(), metadataBytes: 0,
            controlBytes: retainedControlBytes, transportControlBytes: controls, outputRecords: [],
            diagnosticsEpoch: this._diagnosticsEpoch, startedAt: null, backend: null,
            inputBytes: Object.values(records).reduce((sum, buffer) => sum + buffer.bytes, 0) };
        job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
        job.promise.catch(() => {});
        job.timer = setTimeout(() => this._cancelRecord(job, new ComputeError('COMPUTE_TIMEOUT', 'Compute job deadline exceeded')), timeoutMs);
        this._jobs.set(job.id, job); this._queue.push(job);
        this._log('job-queued', { operation, jobId: job.id });
        this._schedule();
        return token(job);
    }

    _schedule() {
        if (this._draining || this._closed) return;
        this._draining = Promise.resolve().then(async () => {
            while (this._queue.length && !this._closed) {
                let index = this._queue.findIndex(job => job.owner.id !== this._lastOwner);
                if (index < 0) index = 0;
                const [job] = this._queue.splice(index, 1);
                if (job.settled) continue;
                this._active = job; this._lastOwner = job.owner.id; job.state = 'running';
                try { await this._execute(job); } catch (error) { this._settle(job, null, error); }
                finally { this._active = null; }
            }
        }).finally(() => { this._draining = null; if (this._queue.length && !this._closed) this._schedule(); });
    }

    async _execute(job) {
        const signal = job.controller.signal;
        throwIfComputeAborted(signal); this._assertOwner(job.owner);
        const started = now(); const inputs = {};
        job.startedAt = started;
        let readbackBytes = 0, transferBytes = 0;
        try {
            for (const [name, buffer] of Object.entries(job.records)) {
                const retain = this.accelerationEnabled && job.policy.backend === 'auto' && this._gpu.available
                    && job.operation === 'math.geometry.transform-points@1' && job.policy.precision === 'f32';
                if (buffer.location === 'gpu' && (job.policy.backend === 'webgpu' || job.policy.outputLocation === 'gpu' || retain)) inputs[name] = buffer;
                else if (buffer.location === 'gpu') {
                    this._reserve(job.owner, buffer.bytes); readbackBytes += buffer.bytes;
                    inputs[name] = await awaitComputeAbort(buffer.readCopy(signal), signal);
                } else inputs[name] = buffer.data;
            }
            throwIfComputeAborted(signal);
            const task = { operation: job.operation, inputs, parameters: job.parameters, policy: job.policy };
            const estimate = Object.values(inputs).every(ArrayBuffer.isView)
                ? estimateComputeTransferBytes(task) : this._gpu.estimateCpuTransferBytes(task);
            const requiredTransferBytes = estimate + job.transportControlBytes * this.maxWorkers;
            this._reserve(job.owner, requiredTransferBytes);
            transferBytes = requiredTransferBytes;
            const selected = await this._runTask(job.owner, task, signal, backend => { job.backend = backend; });
            const result = selected.result;
            try {
                throwIfComputeAborted(signal); this._assertOwner(job.owner);
                const outputMetadata = resultOutputMetadata(job.operation, job.policy.precision, job.parameters, result.outputs || {});
                const value = structuredClone(result.value ?? null);
                const metadataBytes = payloadBytes(value);
                this._assertBufferCapacity(job.owner, Object.keys(result.outputs || {}).length);
                const outputBytes = Object.values(result.outputs || {}).reduce((sum, output) => sum + (output.location === 'gpu' ? 0 : output.byteLength), 0);
                const gpuBytes = Object.values(result.outputs || {}).reduce((sum, output) => sum + (output.location === 'gpu' ? output.byteLength : 0), 0);
                assertCompute(job.owner.gpuBytes + gpuBytes <= this.maxOwnerGpuBytes && this._gpuBytes + gpuBytes <= this.maxGpuBytes,
                    'COMPUTE_MEMORY_LIMIT', 'Retained GPU output budget exceeded');
                this._reserve(job.owner, metadataBytes + outputBytes);
                job.metadataBytes = metadataBytes;
                const outputs = {};
                for (const [name, output] of Object.entries(result.outputs || {})) {
                    const record = output.location === 'gpu' ? this._storeBuffer(job.owner, output, true)
                        : this._storeBuffer(job.owner, { data: output, dtype: outputMetadata[name].dtype, shape: outputMetadata[name].shape }, true);
                    job.outputRecords.push(record); outputs[name] = token(record);
                }
                const completed = { value, outputs, backend: selected.backend, metrics: { ...result.metrics,
                    ...selected.metrics, queueMs: started - job.createdAt, totalMs: now() - job.createdAt, readbackBytes } };
                assertComputeContract('job-result#/$defs/envelope', projectComputeResultContract(completed), { code: 'COMPUTE_INVALID_RESULT' });
                this._settle(job, completed);
            } catch (error) { for (const output of Object.values(result.outputs || {})) output.dispose?.(); throw error; }
        } finally {
            if (readbackBytes) this._unreserve(job.owner, readbackBytes);
            if (transferBytes) this._unreserve(job.owner, transferBytes);
        }
    }

    async _runTask(owner, task, signal, onBackend = () => {}) {
        const descriptor = getComputeOperation(task.operation);
        const run = async backend => {
            throwIfComputeAborted(signal);
            onBackend(backend);
            if (backend === 'webgpu') return this._gpu.execute(owner.id, task, signal);
            assertCompute(task.policy.outputLocation !== 'gpu', 'COMPUTE_BACKEND_UNAVAILABLE', 'GPU output requires a GPU implementation');
            if (backend !== 'js') {
                const variant = backend.slice(5), caps = detectWasmCapabilities();
                assertCompute(descriptor.wasmVariants.includes(variant), 'COMPUTE_BACKEND_UNAVAILABLE', 'Operation has no requested Wasm implementation');
                assertCompute(caps.wasm && (!variant.includes('simd') || caps.simd) && (!variant.includes('threads') || caps.threads),
                    'COMPUTE_BACKEND_UNAVAILABLE', 'Requested Wasm features are unavailable');
            }
            return this._cpu.execute(owner.id, task, backend, signal);
        };
        const requested = task.policy.backend;
        if (requested !== 'auto') return { backend: requested, result: await run(requested) };
        if (task.policy.outputLocation === 'gpu') return { backend: 'webgpu', result: await run('webgpu') };
        if (Object.values(task.inputs).some(value => value.location === 'gpu')) return { backend: 'webgpu', result: await run('webgpu') };
        const bytes = Object.values(task.inputs).reduce((sum, value) => sum + value.byteLength, 0);
        const key = `${task.operation}:${task.policy.precision}:${Math.floor(Math.log2(Math.max(1, bytes)))}`;
        const profile = this._profiles.get(key);
        if (this.accelerationEnabled && profile) {
            try { return { backend: profile.backend, result: await run(profile.backend) }; }
            catch (error) { throwIfComputeAborted(signal); this._profiles.delete(key); this._log('auto-backend-unavailable', { code: error.code }); }
        }
        const start = now(); const baseline = await run('js'); const jsMs = now() - start;
        if (!this.accelerationEnabled || bytes < 65536) return { backend: 'js', result: baseline };
        // Approved operations are pure. The first sufficiently large request in
        // each size band measures a complete alternative, including transport.
        // Later requests use only a backend that beat this observed JS cost.
        const caps = detectWasmCapabilities();
        const variant = ['threads-simd', 'threads', 'simd', 'scalar'].find(name => descriptor.wasmVariants.includes(name)
            && caps.wasm && (!name.includes('simd') || caps.simd) && (!name.includes('threads') || caps.threads && this.maxWorkers > 1));
        const trials = variant ? [`wasm-${variant}`] : [];
        if (this._gpu.available && task.policy.precision === 'f32'
            && descriptor.backends.includes('webgpu')) trials.push('webgpu');
        let winner = 'js', winnerMs = jsMs, result = baseline;
        const measurements = { jsMs };
        for (const backend of trials) {
            const trialStart = now();
            try {
                const candidate = await run(backend);
                const elapsed = now() - trialStart;
                measurements[backend] = elapsed;
                if (elapsed < jsMs * 0.9 && elapsed < winnerMs) { winner = backend; winnerMs = elapsed; result = candidate; }
            } catch (error) {
                throwIfComputeAborted(signal);
                measurements[`${backend}Error`] = computeFailure(error).code;
                this._log('auto-fallback', { code: error.code });
            }
        }
        this._profiles.set(key, { backend: winner, measurements, bytes });
        return { backend: winner, result, metrics: { calibrationMs: now() - start,
            calibration: { ...measurements, winner, wasmMs: variant ? measurements[`wasm-${variant}`] : null } } };
    }

    _settle(job, result, error = null) {
        if (job.settled) return;
        job.settled = true; clearTimeout(job.timer);
        for (const buffer of Object.values(job.records)) { buffer.refs--; this._freeBuffer(buffer); }
        job.records = {};
        if (error) {
            const cancelled = job.controller.signal.aborted;
            const failure = computeFailure(cancelled ? job.controller.signal.reason : error);
            job.state = cancelled ? 'cancelled' : 'failed'; this._stats[cancelled ? 'cancelled' : 'failed']++;
            if (job.diagnosticsEpoch === this._diagnosticsEpoch) this._stats.lastError = { code: failure.code, message: failure.message };
            this._recordJobDiagnostics(job, null, failure.code); job.reject(failure);
            this._log('job-failed', { code: failure.code, message: failure.message });
        } else {
            job.state = 'completed'; this._stats.completed++;
            if (job.diagnosticsEpoch === this._diagnosticsEpoch) this._stats.lastBackend = result.backend;
            this._stats.backendCounts[result.backend] = (this._stats.backendCounts[result.backend] || 0) + 1;
            this._recordJobDiagnostics(job, result);
            job.result = result; job.resolve(result); this._log('job-completed', { operation: job.operation, backend: result.backend, metrics: result.metrics });
        }
    }
    _cancelRecord(job, reason = new ComputeError('COMPUTE_CANCELLED', 'Compute job was cancelled')) {
        if (job.settled) return false;
        this._log('job-cancelled', { jobId: job.id, operation: job.operation, code: reason.code });
        job.controller.abort(reason);
        if (job.state === 'queued') { this._queue = this._queue.filter(entry => entry !== job); this._settle(job, null, reason); }
        return true;
    }
    async _wait(owner, handle) {
        const job = this._lookup(this._jobs, handle, owner, 'job');
        const result = await job.promise;
        this._assertOwner(owner);
        assertCompute(job.alive, 'COMPUTE_INVALID_HANDLE', 'Job was released while waiting');
        return structuredClone(result);
    }
    async _cancel(owner, handle) { return this._cancelRecord(this._lookup(this._jobs, handle, owner, 'job')); }
    _releaseJobControls(job) {
        this._unreserve(job.owner, job.controlBytes);
        job.controlBytes = 0; job.parameters = null; job.policy = null;
    }
    async _releaseJob(owner, handle) {
        this._assertOwner(owner);
        validateHandle(handle);
        const job = this._jobs.get(handle?.id);
        if (!job) return false;
        assertCompute(job.owner === owner && job.generation === handle.generation, 'COMPUTE_INVALID_HANDLE', 'Foreign job');
        job.alive = false; this._cancelRecord(job);
        await job.promise.catch(() => {});
        for (const buffer of job.outputRecords) { buffer.alive = false; this._freeBuffer(buffer); }
        this._unreserve(owner, job.metadataBytes); job.metadataBytes = 0; job.result = null;
        this._releaseJobControls(job);
        this._jobs.delete(job.id); return true;
    }

    releaseOwner(ownerId) {
        const owner = this._owners.get(ownerId);
        if (!owner || !owner.alive) return Promise.resolve();
        owner.alive = false;
        owner.controller.abort(new ComputeError('COMPUTE_OWNER_REVOKED', 'Compute owner was revoked'));
        for (const job of this._jobs.values()) if (job.owner === owner) this._cancelRecord(job, new ComputeError('COMPUTE_OWNER_REVOKED', 'Compute owner was revoked'));
        this._cpu.releaseOwner(ownerId); this._gpu.releaseOwner(ownerId);
        for (const buffer of this._buffers.values()) if (buffer.owner === owner) { buffer.alive = false; this._freeBuffer(buffer); }
        const jobs = [...this._jobs.values()].filter(job => job.owner === owner);
        return Promise.allSettled(jobs.map(job => job.promise)).then(() => {
            for (const job of jobs) {
                this._unreserve(owner, job.metadataBytes); job.metadataBytes = 0;
                this._releaseJobControls(job); this._jobs.delete(job.id);
            }
            this._owners.delete(ownerId); this._log('owner-released', { ownerId });
        });
    }
    setAccelerationEnabled(enabled) {
        this.accelerationEnabled = Boolean(enabled); this._profiles.clear();
        this._log('acceleration-changed', { enabled: this.accelerationEnabled });
        return this.accelerationEnabled;
    }
    _recordJobDiagnostics(job, result, errorCode = null) {
        if (job.diagnosticsEpoch !== this._diagnosticsEpoch) return;
        const ended = now();
        this._recentJobs.unshift({ operation: job.operation, requestedBackend: job.policy.backend,
            backend: result?.backend ?? job.backend, precision: job.policy.precision, status: job.state,
            queueMs: (job.startedAt ?? ended) - job.createdAt, runMs: job.startedAt === null ? null : ended - job.startedAt,
            totalMs: ended - job.createdAt, inputBytes: job.inputBytes,
            outputBytes: result ? job.outputRecords.reduce((sum, buffer) => sum + buffer.bytes, 0) : null,
            workers: Number.isFinite(result?.metrics?.workers) ? result.metrics.workers : null,
            finishedAt: Date.now(), errorCode });
        this._recentJobs.length = Math.min(this._recentJobs.length, RECENT_JOB_LIMIT);
    }
    /** Clear identifying activity details without changing cumulative resource counters. */
    clearDiagnostics() {
        this._diagnosticsEpoch++; this._recentJobs = [];
        this._stats.lastError = null; this._stats.lastBackend = null;
    }
    getStats() {
        const ownerJobs = new Map(); const ownerPending = new Map();
        for (const job of this._jobs.values()) {
            ownerJobs.set(job.owner, (ownerJobs.get(job.owner) || 0) + 1);
            if (!job.settled) ownerPending.set(job.owner, (ownerPending.get(job.owner) || 0) + 1);
        }
        const queued = this._queue.filter(job => !job.settled);
        const maxPending = Math.max(0, ...ownerPending.values()), maxRetained = Math.max(0, ...ownerJobs.values());
        return { ...structuredClone(this._stats), accelerationEnabled: this.accelerationEnabled,
            owners: this._owners.size, buffers: this._buffers.size, jobs: this._jobs.size, queued: this._queue.length,
            running: this._active ? 1 : 0, cpuBytes: this._cpuBytes, heapBytes: this._heapBytes, gpuBytes: this._gpuBytes,
            workers: this._cpu._group?.pool.workers.filter(Boolean).length || 0, calibratedRanges: this._profiles.size,
            limits: { cpuBytes: this.maxBytes, gpuBytes: this.maxGpuBytes, ownerCpuBytes: this.maxOwnerBytes,
                ownerGpuBytes: this.maxOwnerGpuBytes, queuedJobsPerOwner: this.maxQueuedPerOwner,
                buffers: this.maxBuffers, ownerBuffers: this.maxBuffersPerOwner,
                retainedJobsPerOwner: this.maxQueuedPerOwner * 4, workers: this.maxWorkers, concurrentJobs: 1,
                defaultTimeoutMs: this.defaultTimeoutMs },
            pressure: { cpuRatio: this._cpuBytes / this.maxBytes, gpuRatio: this._gpuBytes / this.maxGpuBytes,
                ownerQueuePeakRatio: maxPending / this.maxQueuedPerOwner,
                ownerRetainedPeakRatio: maxRetained / (this.maxQueuedPerOwner * 4),
                queuedOwners: new Set(queued.map(job => job.owner)).size,
                retainedJobs: [...this._jobs.values()].filter(job => job.settled).length,
                oldestQueuedMs: queued.length ? now() - Math.min(...queued.map(job => job.createdAt)) : 0 },
            recentJobs: structuredClone(this._recentJobs) };
    }
    async dispose() {
        if (this._closed) return;
        const owners = [...this._owners.keys()].map(owner => this.releaseOwner(owner));
        this._closed = true; this._cpu.dispose(); this._gpu.dispose();
        await Promise.allSettled(owners); await this._draining;
    }
}

export function createComputeRuntime(options = {}) { return new ComputeRuntime(options); }
