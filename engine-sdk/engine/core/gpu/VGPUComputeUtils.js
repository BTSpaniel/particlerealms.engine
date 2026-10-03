// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GPU Compute Utilities - Prefix sum, radix sort, histogram
 * Common GPU building blocks for parallel algorithms
 */

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _prefixSumParams = new Uint32Array(4);
const _histogramParamsBuffer = new ArrayBuffer(16);
const _histogramParamsU32 = new Uint32Array(_histogramParamsBuffer, 0, 2);
const _histogramParamsF32 = new Float32Array(_histogramParamsBuffer, 8, 2);
const _radixSortParams = new Uint32Array(4);

// Prefix Sum (Parallel Scan) Shader
const PREFIX_SUM_SHADER = `
struct Params {
    count: u32,
    stride: u32,
    pad0: u32,
    pad1: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> input: array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<u32>;

var<workgroup> shared_data: array<u32, 512>;

@compute @workgroup_size(256)
fn upsweep(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let idx = gid.x;
    if (idx >= params.count) { return; }
    
    shared_data[lid.x * 2u] = input[idx * 2u];
    shared_data[lid.x * 2u + 1u] = input[idx * 2u + 1u];
    workgroupBarrier();
    
    var offset = 1u;
    for (var d = params.count >> 1u; d > 0u; d >>= 1u) {
        workgroupBarrier();
        if (lid.x < d) {
            let ai = offset * (2u * lid.x + 1u) - 1u;
            let bi = offset * (2u * lid.x + 2u) - 1u;
            shared_data[bi] += shared_data[ai];
        }
        offset *= 2u;
    }
    
    workgroupBarrier();
    output[idx * 2u] = shared_data[lid.x * 2u];
    output[idx * 2u + 1u] = shared_data[lid.x * 2u + 1u];
}

@compute @workgroup_size(256)
fn downsweep(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
    let idx = gid.x;
    if (idx >= params.count) { return; }
    
    shared_data[lid.x * 2u] = input[idx * 2u];
    shared_data[lid.x * 2u + 1u] = input[idx * 2u + 1u];
    
    if (lid.x == 255u) { shared_data[511u] = 0u; }
    workgroupBarrier();
    
    var offset = params.count;
    for (var d = 1u; d < params.count; d *= 2u) {
        offset >>= 1u;
        workgroupBarrier();
        if (lid.x < d) {
            let ai = offset * (2u * lid.x + 1u) - 1u;
            let bi = offset * (2u * lid.x + 2u) - 1u;
            let t = shared_data[ai];
            shared_data[ai] = shared_data[bi];
            shared_data[bi] += t;
        }
    }
    
    workgroupBarrier();
    output[idx * 2u] = shared_data[lid.x * 2u];
    output[idx * 2u + 1u] = shared_data[lid.x * 2u + 1u];
}
`;

// Histogram Shader
const HISTOGRAM_SHADER = `
struct Params {
    count: u32,
    numBins: u32,
    minVal: f32,
    maxVal: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> input: array<f32>;
@group(0) @binding(2) var<storage, read_write> histogram: array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= params.count) { return; }
    
    let value = input[gid.x];
    let normalized = (value - params.minVal) / (params.maxVal - params.minVal);
    let bin = min(u32(normalized * f32(params.numBins)), params.numBins - 1u);
    
    atomicAdd(&histogram[bin], 1u);
}
`;

// Radix Sort Shader (per-digit counting)
const RADIX_COUNT_SHADER = `
struct Params {
    count: u32,
    shift: u32,
    pad0: u32,
    pad1: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= params.count) { return; }
    
    let key = keys[gid.x];
    let digit = (key >> params.shift) & 0xFu;
    atomicAdd(&counts[digit], 1u);
}
`;

// Radix Sort Scatter Shader
const RADIX_SCATTER_SHADER = `
struct Params {
    count: u32,
    shift: u32,
    pad0: u32,
    pad1: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> keysIn: array<u32>;
@group(0) @binding(2) var<storage, read> valuesIn: array<u32>;
@group(0) @binding(3) var<storage, read> offsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> keysOut: array<u32>;
@group(0) @binding(5) var<storage, read_write> valuesOut: array<u32>;
@group(0) @binding(6) var<storage, read_write> digitCounts: array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= params.count) { return; }
    
    let key = keysIn[gid.x];
    let value = valuesIn[gid.x];
    let digit = (key >> params.shift) & 0xFu;
    
    let baseOffset = offsets[digit];
    let localOffset = atomicAdd(&digitCounts[digit], 1u);
    let dstIdx = baseOffset + localOffset;
    
    keysOut[dstIdx] = key;
    valuesOut[dstIdx] = value;
}
`;

export class VGPUComputeUtils {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        
        this._prefixSumPipeline = null;
        this._histogramPipeline = null;
        this._radixCountPipeline = null;
        this._radixScatterPipeline = null;
        
        this._paramsBuffer = null;
        this._tempBuffers = new Map();
        this._activeReductions = new Set();
        this._generation = 0;
        this._destroyed = false;
        this._destroyError = null;
    }

    _ensureParamsBuffer() {
        this._assertAlive();
        if (!this._paramsBuffer) {
            const generation = this._generation;
            let buffer = null;
            try {
                buffer = this.device.createBuffer({
                    size: 16,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                    label: 'ComputeUtils_Params',
                });
                this._assertGeneration(generation);
            } catch (error) {
                try { buffer?.destroy?.(); } catch (_) {}
                throw error;
            }
            this._paramsBuffer = buffer;
        }
        return this._paramsBuffer;
    }

    _getTempBuffer(key, size, usage) {
        this._assertAlive();
        const existing = this._tempBuffers.get(key);
        if (existing && existing.size >= size) {
            return existing;
        }
        const generation = this._generation;
        let buffer = null;
        try {
            buffer = this.device.createBuffer({
                size,
                usage: usage | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
                label: `ComputeUtils_Temp_${key}`,
            });
            if (this._destroyed || generation !== this._generation) {
                throw this._destroyError || this._cancellationError();
            }
        } catch (error) {
            try { buffer?.destroy?.(); } catch (_) {}
            throw error;
        }
        this._tempBuffers.set(key, buffer);
        try { existing?.destroy?.(); } catch (_) {}
        return buffer;
    }

    /**
     * Compute exclusive prefix sum (scan)
     * @param {GPUBuffer} input - Input u32 array
     * @param {GPUBuffer} output - Output u32 array (can be same as input)
     * @param {number} count - Number of elements
     */
    prefixSum(input, output, count) {
        this._assertAlive();
        const generation = this._generation;
        if (!this._prefixSumPipeline) {
            const module = this.vgpu.shader.compile('prefixSum', PREFIX_SUM_SHADER);
            this._assertGeneration(generation);
            const layout = this.vgpu.bindings.defineLayout('prefixSum', [
                { binding: 0, type: 'uniform', visibility: 'compute' },
                { binding: 1, type: 'read-storage', visibility: 'compute' },
                { binding: 2, type: 'storage', visibility: 'compute' },
            ]);
            this._assertGeneration(generation);
            const upsweep = this.vgpu.pipeline.compute({ module, entryPoint: 'upsweep', layouts: [layout] });
            this._assertGeneration(generation);
            const downsweep = this.vgpu.pipeline.compute({ module, entryPoint: 'downsweep', layouts: [layout] });
            this._assertGeneration(generation);
            this._prefixSumPipeline = {
                upsweep,
                downsweep,
                layout,
            };
        }

        const params = this._ensureParamsBuffer();
        _prefixSumParams[0] = count;
        _prefixSumParams[1] = 1;
        _prefixSumParams[2] = 0;
        _prefixSumParams[3] = 0;
        this.vgpu.queue.writeBuffer(params, 0, _prefixSumParams);

        const bindGroup = this.vgpu.bindings.createGroup(this._prefixSumPipeline.layout, [
            { binding: 0, buffer: params },
            { binding: 1, buffer: input },
            { binding: 2, buffer: output },
        ]);

        const encoder = this.device.createCommandEncoder({ label: 'PrefixSum' });
        
        // Upsweep phase
        const pass1 = encoder.beginComputePass();
        pass1.setPipeline(this._prefixSumPipeline.upsweep);
        pass1.setBindGroup(0, bindGroup);
        pass1.dispatchWorkgroups(Math.ceil(count / 512));
        pass1.end();

        // Downsweep phase
        const pass2 = encoder.beginComputePass();
        pass2.setPipeline(this._prefixSumPipeline.downsweep);
        pass2.setBindGroup(0, bindGroup);
        pass2.dispatchWorkgroups(Math.ceil(count / 512));
        pass2.end();

        this.vgpu.queue.submit([encoder.finish()]);
    }

    /**
     * Compute histogram of float values
     * @param {GPUBuffer} input - Input f32 array
     * @param {GPUBuffer} histogram - Output histogram (u32 array, size = numBins)
     * @param {number} count - Number of input elements
     * @param {number} numBins - Number of histogram bins
     * @param {number} minVal - Minimum value for binning
     * @param {number} maxVal - Maximum value for binning
     */
    histogram(input, histogram, count, numBins, minVal = 0, maxVal = 1) {
        this._assertAlive();
        const generation = this._generation;
        if (!this._histogramPipeline) {
            const module = this.vgpu.shader.compile('histogram', HISTOGRAM_SHADER);
            this._assertGeneration(generation);
            const layout = this.vgpu.bindings.defineLayout('histogram', [
                { binding: 0, type: 'uniform', visibility: 'compute' },
                { binding: 1, type: 'read-storage', visibility: 'compute' },
                { binding: 2, type: 'storage', visibility: 'compute' },
            ]);
            this._assertGeneration(generation);
            const pipeline = this.vgpu.pipeline.compute({ module, entryPoint: 'main', layouts: [layout] });
            this._assertGeneration(generation);
            this._histogramPipeline = pipeline;
            this._histogramLayout = layout;
        }

        const params = this._ensureParamsBuffer();
        _histogramParamsU32[0] = count;
        _histogramParamsU32[1] = numBins;
        _histogramParamsF32[0] = minVal;
        _histogramParamsF32[1] = maxVal;
        this.vgpu.queue.writeBuffer(params, 0, _histogramParamsBuffer);

        // Clear histogram buffer
        const encoder = this.device.createCommandEncoder({ label: 'Histogram' });
        encoder.clearBuffer(histogram, 0, numBins * 4);

        const bindGroup = this.vgpu.bindings.createGroup(this._histogramLayout, [
            { binding: 0, buffer: params },
            { binding: 1, buffer: input },
            { binding: 2, buffer: histogram },
        ]);

        const pass = encoder.beginComputePass();
        pass.setPipeline(this._histogramPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(count / 256));
        pass.end();

        this.vgpu.queue.submit([encoder.finish()]);
    }

    /**
     * Radix sort key-value pairs (32-bit keys)
     * @param {GPUBuffer} keys - u32 keys buffer (will be modified)
     * @param {GPUBuffer} values - u32 values buffer (will be modified)
     * @param {number} count - Number of elements
     * @param {number} [numBits=32] - Number of bits to sort (8, 16, 24, or 32)
     */
    radixSort(keys, values, count, numBits = 32) {
        this._assertAlive();
        const generation = this._generation;
        if (!this._radixCountPipeline) {
            this._initRadixSort(generation);
        }
        this._assertGeneration(generation);

        const keysTemp = this._getTempBuffer('radixKeys', count * 4, GPUBufferUsage.STORAGE);
        const valuesTemp = this._getTempBuffer('radixValues', count * 4, GPUBufferUsage.STORAGE);
        const counts = this._getTempBuffer('radixCounts', 16 * 4, GPUBufferUsage.STORAGE);
        const offsets = this._getTempBuffer('radixOffsets', 16 * 4, GPUBufferUsage.STORAGE);
        const digitCounts = this._getTempBuffer('radixDigitCounts', 16 * 4, GPUBufferUsage.STORAGE);

        const params = this._ensureParamsBuffer();

        let keysIn = keys, keysOut = keysTemp;
        let valuesIn = values, valuesOut = valuesTemp;

        for (let shift = 0; shift < numBits; shift += 4) {
            // Clear counts
            const encoder = this.device.createCommandEncoder({ label: `RadixSort_Pass${shift}` });
            encoder.clearBuffer(counts, 0, 64);
            encoder.clearBuffer(digitCounts, 0, 64);

            // Write params - reuse buffer
            _radixSortParams[0] = count;
            _radixSortParams[1] = shift;
            _radixSortParams[2] = 0;
            _radixSortParams[3] = 0;
            this.vgpu.queue.writeBuffer(params, 0, _radixSortParams);

            // Count pass
            const countBG = this.device.createBindGroup({
                layout: this._radixCountPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: params } },
                    { binding: 1, resource: { buffer: keysIn } },
                    { binding: 2, resource: { buffer: counts } },
                ],
            });

            const countPass = encoder.beginComputePass();
            countPass.setPipeline(this._radixCountPipeline);
            countPass.setBindGroup(0, countBG);
            countPass.dispatchWorkgroups(Math.ceil(count / 256));
            countPass.end();

            // CPU-side prefix sum for offsets (16 elements is fast enough)
            this.vgpu.queue.submit([encoder.finish()]);

            // Compute offsets on CPU (small array, easier than GPU for 16 elements)
            const offsetsData = new Uint32Array(16);
            // This would need async readback in real impl, simplified here
            
            // Scatter pass
            const encoder2 = this.device.createCommandEncoder({ label: `RadixSort_Scatter${shift}` });
            
            const scatterBG = this.device.createBindGroup({
                layout: this._radixScatterPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: params } },
                    { binding: 1, resource: { buffer: keysIn } },
                    { binding: 2, resource: { buffer: valuesIn } },
                    { binding: 3, resource: { buffer: offsets } },
                    { binding: 4, resource: { buffer: keysOut } },
                    { binding: 5, resource: { buffer: valuesOut } },
                    { binding: 6, resource: { buffer: digitCounts } },
                ],
            });

            const scatterPass = encoder2.beginComputePass();
            scatterPass.setPipeline(this._radixScatterPipeline);
            scatterPass.setBindGroup(0, scatterBG);
            scatterPass.dispatchWorkgroups(Math.ceil(count / 256));
            scatterPass.end();

            this.vgpu.queue.submit([encoder2.finish()]);

            // Swap buffers
            [keysIn, keysOut] = [keysOut, keysIn];
            [valuesIn, valuesOut] = [valuesOut, valuesIn];
        }

        // Copy result back if needed
        if (keysIn !== keys) {
            const encoder = this.device.createCommandEncoder({ label: 'RadixSort_CopyBack' });
            encoder.copyBufferToBuffer(keysIn, 0, keys, 0, count * 4);
            encoder.copyBufferToBuffer(valuesIn, 0, values, 0, count * 4);
            this.vgpu.queue.submit([encoder.finish()]);
        }
    }

    _initRadixSort(generation = this._generation) {
        this._assertAlive();
        const countModule = this.vgpu.shader.compile('radixCount', RADIX_COUNT_SHADER);
        this._assertGeneration(generation);
        const countPipeline = this.vgpu.pipeline.compute({
            module: countModule,
            entryPoint: 'main',
            label: 'RadixCount',
        });
        this._assertGeneration(generation);

        const scatterModule = this.vgpu.shader.compile('radixScatter', RADIX_SCATTER_SHADER);
        this._assertGeneration(generation);
        const scatterPipeline = this.vgpu.pipeline.compute({
            module: scatterModule,
            entryPoint: 'main',
            label: 'RadixScatter',
        });
        this._assertGeneration(generation);
        this._radixCountPipeline = countPipeline;
        this._radixScatterPipeline = scatterPipeline;
    }

    /**
     * Find min/max values in a buffer
     * @param {GPUBuffer} input - Input f32 array
     * @param {number} count - Number of elements
     * @returns {Promise<{min: number, max: number}>}
     */
    reduce(input, count) {
        this._assertAlive();
        const operation = this._createReductionOperation();

        try {
            // Simple CPU readback for now - GPU reduction would be more complex
            operation.staging = this.device.createBuffer({
                size: count * 4,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
                label: 'ComputeUtils_ReduceReadback',
            });
            this._assertReductionCurrent(operation, operation.staging);

            const encoder = this.device.createCommandEncoder();
            this._assertReductionCurrent(operation, operation.staging);
            encoder.copyBufferToBuffer(input, 0, operation.staging, 0, count * 4);
            this._assertReductionCurrent(operation, operation.staging);
            const commands = encoder.finish();
            this._assertReductionCurrent(operation, operation.staging);
            this.vgpu.queue.submit([commands]);
            this._assertReductionCurrent(operation, operation.staging);
        } catch (error) {
            this._retireReductionStaging(operation);
            this._settleReduction(operation, null, error);
            return operation.promise;
        }

        const staging = operation.staging;
        const rawOutcome = Promise.resolve()
            .then(() => {
                this._assertReductionCurrent(operation, staging);
                return staging.mapAsync(GPUMapMode.READ);
            })
            .then(
                () => ({ status: 'mapped' }),
                error => ({ status: 'rejected', error }),
            );
        void Promise.race([
            rawOutcome,
            operation.cancellation.then(error => ({ status: 'cancelled', error })),
        ]).then(outcome => {
            if (outcome.status === 'cancelled' || !this._isReductionCurrent(operation, staging)) return;
            if (outcome.status === 'rejected') {
                this._retireReductionStaging(operation);
                this._settleReduction(operation, null, outcome.error);
                return;
            }

            operation.mapped = true;
            let data;
            try {
                data = new Float32Array(staging.getMappedRange().slice(0));
                this._assertReductionCurrent(operation, staging);
            } catch (error) {
                this._retireReductionStaging(operation);
                this._settleReduction(operation, null, error);
                return;
            }

            this._retireReductionStaging(operation);
            if (!this._isReductionCurrent(operation, null)) return;
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < count; i++) {
                if (data[i] < min) min = data[i];
                if (data[i] > max) max = data[i];
            }
            this._settleReduction(operation, { min, max }, null);
        });

        return operation.promise;
    }

    _createReductionOperation() {
        let resolvePublic;
        let rejectPublic;
        let cancelWait;
        const operation = {
            generation: this._generation,
            staging: null,
            mapped: false,
            settled: false,
            cancelled: false,
            promise: null,
            cancellation: null,
        };
        operation.promise = new Promise((resolve, reject) => {
            resolvePublic = resolve;
            rejectPublic = reject;
        });
        operation.resolve = resolvePublic;
        operation.reject = rejectPublic;
        operation.cancellation = new Promise(resolve => { cancelWait = resolve; });
        operation.cancelWait = cancelWait;
        this._activeReductions.add(operation);
        return operation;
    }

    _isReductionCurrent(operation, staging) {
        return Boolean(operation)
            && !operation.settled
            && !operation.cancelled
            && !this._destroyed
            && operation.generation === this._generation
            && this._activeReductions.has(operation)
            && operation.staging === staging;
    }

    _assertReductionCurrent(operation, staging) {
        if (!this._isReductionCurrent(operation, staging)) {
            throw this._destroyError || this._cancellationError();
        }
    }

    _retireReductionStaging(operation) {
        if (!operation) return;
        const staging = operation.staging;
        const wasMapped = operation.mapped;
        operation.staging = null;
        operation.mapped = false;
        if (!staging) return;
        if (wasMapped) {
            try { staging.unmap(); } catch (_) {}
        }
        try { staging.destroy(); } catch (_) {}
    }

    _settleReduction(operation, value, error) {
        if (!operation || operation.settled) return false;
        operation.settled = true;
        this._activeReductions.delete(operation);
        if (error) operation.reject(error);
        else operation.resolve(value);
        return true;
    }

    _cancellationError() {
        const error = new Error('[ComputeUtils] destroyed');
        error.name = 'AbortError';
        error.code = 'VGPU_COMPUTE_UTILS_DESTROYED';
        return error;
    }

    _assertAlive() {
        if (this._destroyed) throw this._destroyError || this._cancellationError();
    }

    _assertGeneration(generation) {
        if (this._destroyed || generation !== this._generation) {
            throw this._destroyError || this._cancellationError();
        }
    }

    /**
     * Fill buffer with constant value
     */
    fill(buffer, value, count, offset = 0) {
        this._assertAlive();
        const data = new Uint32Array(count).fill(value);
        this.vgpu.queue.writeBuffer(buffer, offset, data);
    }

    destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;
        const error = this._cancellationError();
        this._destroyError = error;
        const reductions = [...this._activeReductions];
        this._activeReductions.clear();
        for (const operation of reductions) {
            operation.cancelled = true;
            this._retireReductionStaging(operation);
        }
        for (const operation of reductions) {
            operation.cancelWait(error);
            this._settleReduction(operation, null, error);
        }
        const paramsBuffer = this._paramsBuffer;
        this._paramsBuffer = null;
        try { paramsBuffer?.destroy?.(); } catch (_) {}
        for (const buf of this._tempBuffers.values()) {
            try { buf.destroy(); } catch (_) {}
        }
        this._tempBuffers.clear();
        this._prefixSumPipeline = null;
        this._histogramPipeline = null;
        this._histogramLayout = null;
        this._radixCountPipeline = null;
        this._radixScatterPipeline = null;
        return true;
    }
}
