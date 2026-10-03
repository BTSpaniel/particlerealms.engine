// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { WorkerPool } from '../scheduler/TaskScheduler.js';
import { estimateComputeMemory, mergeComputePartitions } from './ComputeOperations.js';
import { ComputeError, computeFailure, assertCompute, throwIfComputeAborted, awaitComputeAbort } from './ComputeErrors.js';
import { deepFreezeJson, isPlainJsonObject } from '../schema/StrictJsonValue.js';
import { assertComputeContract } from './ComputeContracts.js';

const PAGE = 65536;
const STACK = 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
// ABI 1 uses wasm32 pointers/lengths and i32 status results. d denotes f64.
const ABI_PARAMETERS = { abi_version: '', stats: 'iiii', compensated_sum: 'iiii', bounds: 'iiiii',
    transform_points: 'iiiii', rgba_histogram: 'iiidddi', luminance: 'iiiddddi', fft: 'iiiiii',
    waveform: 'iiiii', windowed_rms: 'iiiiii', crc32: 'iiii', byte_histogram: 'iiii' };
const ABI_EXPORTS = [...Object.keys(ABI_PARAMETERS).map(name => ({ name, kind: 'function' })),
    { name: '__stack_pointer', kind: 'global' }, { name: '__heap_base', kind: 'global' }];
const ceilPage = value => Math.ceil(value / PAGE) * PAGE;

function validArtifact(condition, message) {
    assertCompute(condition, 'COMPUTE_ARTIFACT_INVALID', message);
}

function exactFields(value, names) {
    return isPlainJsonObject(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}

function sameStrings(actual, expected) {
    return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function validExports(exports) {
    return Array.isArray(exports) && exports.length === ABI_EXPORTS.length && ABI_EXPORTS.every(expected =>
        exports.filter(item => exactFields(item, ['name', 'kind']) && item.name === expected.name && item.kind === expected.kind).length === 1);
}

function validateManifest(manifest, maximum) {
    assertComputeContract('artifact-manifest', manifest, { code: 'COMPUTE_ARTIFACT_INVALID' });
    // The shared contract covers portable structure. Configured resource limits
    // and validation of the actual executable remain mandatory host checks.
    for (const artifact of Object.values(manifest.variants)) artifactByteLength(artifact, maximum);
    try { return deepFreezeJson(manifest); }
    catch (_) { throw new ComputeError('COMPUTE_ARTIFACT_INVALID', 'Compute manifest contains invalid metadata'); }
}

// This reader checks only ABI layout after browser validation, never instructions.
// ABI 1 has no tables, defined memory, start function, elements or data segments:
// instantiating another shared worker therefore cannot run initialization code
// or overwrite another worker's stack, cancellation word or arena.
function layoutReader(bytes) {
    let offset = 0;
    const take = count => {
        validArtifact(Number.isSafeInteger(count) && count >= 0 && count <= bytes.length - offset, 'Truncated compute module layout');
        const result = bytes.subarray(offset, offset + count); offset += count; return result;
    };
    const byte = () => take(1)[0];
    const integer = (signed = false) => {
        let value = 0, shift = 0, part;
        do {
            validArtifact(shift < 35, 'Invalid compute layout integer'); part = byte();
            value += (part & 127) * 2 ** shift; shift += 7;
        } while (part & 128);
        if (signed && (part & 64)) value -= 2 ** shift;
        validArtifact(Number.isSafeInteger(value) && (signed ? value >= -2147483648 && value <= 2147483647 : value >= 0 && value <= 0xffffffff),
            'Compute layout integer is out of range');
        return value;
    };
    const name = () => new TextDecoder('utf-8', { fatal: true }).decode(take(integer()));
    const vector = (read, maximum = 4096) => {
        const count = integer(); validArtifact(count <= maximum && count <= bytes.length - offset, 'Invalid compute layout vector');
        return Array.from({ length: count }, read);
    };
    return { take, byte, integer, name, vector, get remaining() { return bytes.length - offset; } };
}

function validateModuleLayout(module, bytes, artifact) {
    const imports = WebAssembly.Module.imports(module);
    validArtifact(imports.length === 1 && imports[0].module === 'env' && imports[0].name === 'memory'
        && imports[0].kind === 'memory' && validExports(WebAssembly.Module.exports(module)), 'Compute module does not match ABI 1');
    const reader = layoutReader(bytes); reader.take(8);
    const sections = new Map();
    while (reader.remaining) {
        const kind = reader.byte(), section = reader.take(reader.integer());
        if (kind === 0) continue;
        validArtifact([1, 2, 3, 6, 7, 10].includes(kind) && !sections.has(kind), 'Unsupported compute module initialization or layout');
        sections.set(kind, layoutReader(section));
    }
    validArtifact([1, 2, 3, 6, 7, 10].every(kind => sections.has(kind)), 'Incomplete compute module layout');
    const types = sections.get(1), functions = sections.get(3), memory = sections.get(2), globals = sections.get(6), exports = sections.get(7);
    const typeName = value => ({ 127: 'i', 126: 'l', 125: 'f', 124: 'd' })[value] || '?';
    const signatures = types.vector(() => {
        validArtifact(types.byte() === 0x60, 'Unsupported compute function type');
        return `${types.vector(() => typeName(types.byte()), 16).join('')}>${types.vector(() => typeName(types.byte()), 1).join('')}`;
    });
    const functionTypes = functions.vector(() => functions.integer());
    validArtifact(memory.integer() === 1 && memory.name() === 'env' && memory.name() === 'memory' && memory.byte() === 2,
        'Unexpected compute memory import');
    validArtifact(memory.integer() === (artifact.memory.shared ? 3 : 1) && memory.integer() === artifact.memory.minimumPages
        && memory.integer() === artifact.memory.maximumPages, 'Compute memory import differs from manifest');
    const globalValues = globals.vector(() => {
        validArtifact(globals.byte() === 0x7f, 'Compute globals must use i32');
        const mutable = globals.byte(); validArtifact(mutable === 0 || mutable === 1, 'Invalid compute global mutability');
        validArtifact(globals.byte() === 0x41, 'Compute globals must have constant initializers');
        const value = globals.integer(true); validArtifact(globals.byte() === 0x0b, 'Invalid compute global initializer');
        return { mutable, value };
    }, 2);
    validArtifact(globalValues.length === 2, 'Compute module has unexpected globals');
    exports.vector(() => {
        const name = exports.name(), kind = exports.byte(), index = exports.integer();
        if (kind === 0) validArtifact(signatures[functionTypes[index]] === `${ABI_PARAMETERS[name]}>i`, 'Compute function signature does not match ABI 1');
        else {
            const global = globalValues[index];
            validArtifact(global && global.mutable === (name === '__stack_pointer' ? 1 : 0)
                && global.value >= STACK && global.value <= artifact.memory.minimumPages * PAGE, 'Unsafe compute stack or heap layout');
        }
    }, ABI_EXPORTS.length);
    validArtifact([types, functions, memory, globals, exports].every(section => section.remaining === 0), 'Unexpected compute layout bytes');
    const features = WebAssembly.Module.customSections(module, 'target_features');
    validArtifact(features.length === 1, 'Missing or duplicate compute target features');
    const featureReader = layoutReader(new Uint8Array(features[0]));
    const actual = featureReader.vector(() => {
        validArtifact(featureReader.byte() === 43, 'Unsupported compute target feature declaration'); return featureReader.name();
    }, artifact.compiledFeatures.length).sort();
    validArtifact(featureReader.remaining === 0 && sameStrings(actual, artifact.compiledFeatures), 'Compute feature metadata mismatch');
}

function artifactByteLength(artifact, maximum) {
    const size = artifact?.byteLength;
    assertCompute(Number.isSafeInteger(size) && size > 0 && size <= maximum,
        'COMPUTE_ARTIFACT_INVALID', 'Compute artifact byte length exceeds its allowed bound or is invalid');
    return size;
}

// Keep the existing bounded stream pattern local to compute; OS package and
// MorphField readers have domain-specific dependencies and are not exported.
async function readBoundedResource(response, maximum, expected, signal) {
    const declared = response.headers.get('content-length');
    const encoded = response.headers.get('content-encoding');
    let reader = null, ended = false;
    try {
        // Fetch exposes decoded bytes. Encoded wire lengths are not the decoded
        // payload size; the stream bound remains authoritative in that case.
        if (declared !== null && (!encoded || encoded === 'identity')) {
            const size = Number(declared);
            assertCompute(/^\d+$/.test(declared) && Number.isSafeInteger(size) && size <= maximum
                && (expected === null || size === expected), 'COMPUTE_ARTIFACT_INVALID', 'Compute response byte length is invalid');
        }
        assertCompute(typeof response.body?.getReader === 'function', 'COMPUTE_ARTIFACT_INVALID', 'Compute response has no readable body');
        reader = response.body.getReader();
        const bytes = new Uint8Array(maximum); let offset = 0;
        for (;;) {
            const { done, value } = await reader.read();
            throwIfComputeAborted(signal);
            if (done) { ended = true; break; }
            assertCompute(value instanceof Uint8Array && value.byteLength <= maximum - offset,
                'COMPUTE_ARTIFACT_INVALID', 'Compute response exceeds its allowed byte bound');
            bytes.set(value, offset); offset += value.byteLength;
        }
        assertCompute(expected === null || offset === expected, 'COMPUTE_ARTIFACT_INVALID', 'Compute artifact length mismatch');
        return bytes.subarray(0, offset);
    } catch (error) {
        throwIfComputeAborted(signal);
        if (error instanceof ComputeError) throw error;
        throw new ComputeError('COMPUTE_ARTIFACT_INVALID', 'Compute response body could not be read completely');
    } finally {
        if (!ended) {
            try { await awaitComputeAbort(reader ? reader.cancel() : response.body?.cancel(), signal); } catch (_) {}
        }
        reader?.releaseLock();
    }
}

function partition(task, workers) {
    const input = task.inputs;
    let key, unit, rows;
    if (task.operation === 'math.geometry.transform-points@1') { key = 'positions'; unit = 3; }
    else if (task.operation.startsWith('math.image.')) { key = 'image'; unit = task.parameters.width * 4; rows = true; }
    else if (task.operation === 'math.binary.histogram@1') { key = 'bytes'; unit = 1; }
    else return [task];
    if (!input[key]) return [task];
    const units = Math.floor(input[key].length / unit);
    const count = Math.min(workers, units);
    if (count < 2) return [task];
    return Array.from({ length: count }, (_, index) => {
        const start = Math.floor(units * index / count);
        const end = Math.floor(units * (index + 1) / count);
        const partitionInputs = Object.fromEntries(Object.entries(input).map(([name, value]) => [name,
            name === key ? value.slice(start * unit, end * unit) : value.slice()]));
        return { ...task, inputs: partitionInputs,
            parameters: rows ? { ...task.parameters, height: end - start } : { ...task.parameters } };
    });
}

/** Host-owned worker groups. Linear memory is never exposed to application code. */
export class WasmComputeProvider {
    constructor({ workerUrl = new URL('./ComputeWorker.js', import.meta.url),
        manifestUrl = new URL('./artifacts/manifest.json', import.meta.url), maxWorkers = 4,
        reserve = () => {}, unreserve = () => {}, logger = null,
        manifestTimeoutMs = 4000, artifactTimeoutMs = 30000, maxArtifactBytes = MAX_ARTIFACT_BYTES } = {}) {
        this.workerUrl = workerUrl;
        this.manifestUrl = new URL(manifestUrl, globalThis.location?.href || import.meta.url);
        validArtifact(['http:', 'https:'].includes(this.manifestUrl.protocol) && !this.manifestUrl.username
            && !this.manifestUrl.password && !this.manifestUrl.hash, 'Compute manifest requires an HTTP URL without credentials or a fragment');
        this.maxWorkers = maxWorkers;
        this.reserve = reserve;
        this.unreserve = unreserve;
        this.logger = logger;
        for (const timeout of [manifestTimeoutMs, artifactTimeoutMs])
            assertCompute(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 300000,
                'COMPUTE_INVALID_CONFIG', 'Compute resource deadlines must be positive integers within five minutes');
        this.manifestTimeoutMs = manifestTimeoutMs;
        this.artifactTimeoutMs = artifactTimeoutMs;
        assertCompute(Number.isSafeInteger(maxArtifactBytes) && maxArtifactBytes > 0 && maxArtifactBytes <= MAX_ARTIFACT_BYTES,
            'COMPUTE_INVALID_CONFIG', 'Compute artifact byte limit must be positive and no more than 16 MiB');
        this.maxArtifactBytes = maxArtifactBytes;
        this._manifest = null;
        this._modules = new Map();
        this._group = null;
        this._disposed = false;
        this._epoch = 0;
        this._fetchController = new AbortController();
    }

    async _fetchResource(url, timeoutMs, label, read) {
        assertCompute(!this._disposed, 'COMPUTE_CLOSED', 'Compute provider is closed');
        const controller = new AbortController();
        const closed = () => controller.abort(new ComputeError('COMPUTE_CLOSED', 'Compute provider was disposed'));
        this._fetchController.signal.addEventListener('abort', closed, { once: true });
        const timer = setTimeout(() => controller.abort(new ComputeError('COMPUTE_TIMEOUT', `${label} request timed out`)), timeoutMs);
        try {
            const requested = new URL(url);
            const response = await fetch(requested, { signal: controller.signal, redirect: 'manual' });
            validArtifact(response.type !== 'opaqueredirect' && !response.redirected && response.url === requested.href,
                `${label} redirected or changed its release location`);
            assertCompute(response.ok, 'COMPUTE_ARTIFACT_MISSING', `${label} HTTP ${response.status}`);
            return await read(response, controller.signal);
        } catch (error) {
            if (controller.signal.aborted) throw computeFailure(controller.signal.reason);
            throw error;
        } finally {
            clearTimeout(timer);
            this._fetchController.signal.removeEventListener('abort', closed);
            // Also retire a response rejected before its body reader was opened.
            controller.abort();
        }
    }

    async manifest() {
        if (!this._manifest) {
            const loading = (async () => {
                const bytes = await this._fetchResource(this.manifestUrl, this.manifestTimeoutMs, 'Compute manifest',
                    (response, signal) => readBoundedResource(response, MAX_MANIFEST_BYTES, null, signal));
                let manifest;
                try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
                catch (_) { throw new ComputeError('COMPUTE_ARTIFACT_INVALID', 'Compute manifest is not valid UTF-8 JSON'); }
                return validateManifest(manifest, this.maxArtifactBytes);
            })();
            this._manifest = loading;
            loading.catch(() => { if (this._manifest === loading) this._manifest = null; });
        }
        return this._manifest;
    }

    async _module(variant) {
        if (!this._modules.has(variant)) {
            let manifestCache = null;
            const loading = (async () => {
                const request = this.manifest(); manifestCache = this._manifest;
                const manifest = await request;
                const artifact = manifest.variants[variant];
                assertCompute(artifact, 'COMPUTE_BACKEND_UNAVAILABLE', `Missing Wasm variant ${variant}`);
                const expected = artifactByteLength(artifact, this.maxArtifactBytes);
                const url = new URL(artifact.url, this.manifestUrl);
                validArtifact(url.origin === this.manifestUrl.origin, 'Compute artifacts must share the configured manifest origin');
                const bytes = await this._fetchResource(url, this.artifactTimeoutMs, 'Compute artifact',
                    (response, signal) => readBoundedResource(response, expected, expected, signal));
                const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
                validArtifact(digest === artifact.sha256, 'Compute artifact hash mismatch');
                let module;
                try { module = await WebAssembly.compile(bytes); validateModuleLayout(module, bytes, artifact); }
                catch (error) {
                    if (error instanceof ComputeError) throw error;
                    throw new ComputeError('COMPUTE_ARTIFACT_INVALID', 'Compute module validation failed');
                }
                return { module, artifact };
            })();
            this._modules.set(variant, loading);
            loading.catch(error => {
                if (this._modules.get(variant) === loading) this._modules.delete(variant);
                if (error?.code === 'COMPUTE_ARTIFACT_INVALID' && this._manifest === manifestCache) this._manifest = null;
            });
        }
        return this._modules.get(variant);
    }

    _dropGroup(reason = null) {
        const group = this._group;
        this._group = null;
        if (!group) return;
        group.pool.terminate(reason);
        this.unreserve(group.ownerId, group.bytes);
    }

    async execute(ownerId, task, backend, signal) {
        throwIfComputeAborted(signal);
        assertCompute(!this._disposed, 'COMPUTE_CLOSED', 'Compute provider is closed');
        const epoch = this._epoch;
        const started = performance.now();
        const variant = backend === 'js' ? 'js' : backend.slice(5);
        const threaded = variant.startsWith('threads');
        const parts = threaded ? partition(task, this.maxWorkers) : [task];
        const arenaBytes = ceilPage(Math.max(...parts.map(part => estimateComputeMemory(part)), PAGE));
        const stride = STACK + arenaBytes;
        const loaded = variant === 'js' ? null : await awaitComputeAbort(this._module(variant), signal);
        const module = loaded?.module;
        const prefix = module ? (loaded.artifact.memory.minimumPages + 1) * PAGE : 0;
        const cancelOffset = prefix - PAGE;
        const bytes = variant === 'js' ? arenaBytes : prefix + parts.length * stride;
        assertCompute(!module || bytes <= loaded.artifact.memory.maximumPages * PAGE, 'COMPUTE_MEMORY_LIMIT', 'Job exceeds the compiled Wasm memory limit');
        throwIfComputeAborted(signal);
        assertCompute(epoch === this._epoch && !this._disposed, 'COMPUTE_CLOSED', 'Compute preparation was revoked');
        let group = this._group;
        if (!group || group.ownerId !== ownerId || group.variant !== variant || group.workers !== parts.length || group.arenaBytes < arenaBytes || group.pool._closed) {
            this._dropGroup();
            this.reserve(ownerId, bytes);
            let memory;
            try { memory = module && threaded ? new WebAssembly.Memory({ initial: bytes / PAGE, maximum: bytes / PAGE, shared: true }) : null; }
            catch (error) { this.unreserve(ownerId, bytes); throw error; }
            const pool = new WorkerPool(this.workerUrl, parts.length, {
                autoSharedBuffer: false, requireReady: true, restartOnError: false, maxPending: parts.length,
                initData: workerId => ({ backend, variant, module, memory,
                    memoryDescriptor: module && !threaded ? { initial: bytes / PAGE, maximum: bytes / PAGE } : null,
                    stackPointer: prefix + workerId * stride + STACK,
                    arenaStart: prefix + workerId * stride + STACK,
                    arenaEnd: prefix + (workerId + 1) * stride, cancelOffset: module ? cancelOffset : 0 }),
            });
            group = { pool, ownerId, variant, workers: parts.length, memory, bytes, arenaBytes, cancelOffset };
            this._group = group;
            const abortInit = () => pool.terminate(signal.reason);
            signal?.addEventListener('abort', abortInit, { once: true });
            try { await pool.init(); }
            catch (error) { if (this._group === group) this._dropGroup(error); throw error; }
            finally { signal?.removeEventListener('abort', abortInit); }
        }
        throwIfComputeAborted(signal);
        const prepared = performance.now();
        if (threaded) Atomics.store(new Int32Array(group.memory.buffer), group.cancelOffset / 4, 0);
        let killTimer = null;
        const abort = () => {
            if (threaded) {
                Atomics.store(new Int32Array(group.memory.buffer), group.cancelOffset / 4, 1);
                killTimer = setTimeout(() => group.pool.terminate(signal.reason), 100);
            } else group.pool.terminate(signal.reason);
        };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            const inputCopyBytes = parts.reduce((total, part) => total + Object.values(part.inputs).reduce((sum, value) => sum + value.byteLength, 0), 0);
            const results = await Promise.all(parts.map(part => group.pool.submit('compute', { ...part, backend },
                parts.length > 1 ? [...new Set(Object.values(part.inputs).map(value => value.buffer))] : [])));
            throwIfComputeAborted(signal);
            const result = results.length === 1 ? results[0] : mergeComputePartitions(task.operation, results, task);
            return { ...result, metrics: { ...result.metrics, preparationMs: prepared - started,
                executionMs: performance.now() - prepared, workers: parts.length,
                sharedMemory: threaded, heapBytes: group.bytes, inputCopyBytes } };
        } catch (error) {
            if (this._group === group) this._dropGroup(error);
            throw error;
        } finally {
            clearTimeout(killTimer);
            signal?.removeEventListener('abort', abort);
        }
    }

    releaseOwner(ownerId) {
        if (this._group?.ownerId === ownerId) this._dropGroup(new ComputeError('COMPUTE_OWNER_REVOKED', 'Compute owner was revoked'));
    }

    dispose() {
        this._disposed = true;
        this._epoch++;
        this._fetchController.abort();
        this._dropGroup(new ComputeError('COMPUTE_CLOSED', 'Compute runtime was disposed'));
        this._modules.clear();
    }
}
