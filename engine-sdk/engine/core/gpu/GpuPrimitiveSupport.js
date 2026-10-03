// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared bounds, workspace, and lifecycle support for caller-encoded GPU data
 * primitives. This module intentionally owns no queue submission authority.
 */

export const GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS = 1 << 20;
export const GPU_PRIMITIVE_DEFAULT_MAX_IN_FLIGHT = 2;
export const GPU_PRIMITIVE_MAX_IN_FLIGHT = 16;
export const GPU_SCAN_WORKGROUP_SIZE = 128;
export const GPU_SCAN_BLOCK_SIZE = GPU_SCAN_WORKGROUP_SIZE;

const U32_BYTES = 4;
const UNIFORM_WORDS = 4;

function finiteInteger(value, label, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}`);
    }
    return value;
}

function gpuBufferUsage() {
    const usage = globalThis.GPUBufferUsage;
    if (!usage || !Number.isInteger(usage.STORAGE) || !Number.isInteger(usage.UNIFORM)) {
        throw new Error('WebGPU GPUBufferUsage constants are unavailable');
    }
    return usage;
}

function alignTo(value, alignment) {
    return Math.ceil(value / alignment) * alignment;
}

function numericLimit(device, name, fallback) {
    const value = Number(device?.limits?.[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function assertGpuDevice(device) {
    if (!device
        || typeof device.createBuffer !== 'function'
        || typeof device.createShaderModule !== 'function'
        || typeof device.createComputePipeline !== 'function'
        || typeof device.createBindGroup !== 'function') {
        throw new TypeError('device must be a live GPUDevice');
    }
    return device;
}

export function assertCommandEncoder(encoder) {
    if (!encoder || typeof encoder.beginComputePass !== 'function') {
        throw new TypeError('encoder must be a caller-owned GPUCommandEncoder');
    }
    return encoder;
}

export function resolveMaxElements(
    device,
    requested = GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
    {
        bytesPerElement = U32_BYTES,
        elementsPerWorkgroup = GPU_SCAN_WORKGROUP_SIZE,
        label = 'maxElements',
    } = {},
) {
    assertGpuDevice(device);
    finiteInteger(bytesPerElement, 'bytesPerElement', 1, 0x10000);
    finiteInteger(elementsPerWorkgroup, 'elementsPerWorkgroup', 1, 0x100000);
    const bindingBytes = numericLimit(device, 'maxStorageBufferBindingSize', 128 * 1024 * 1024);
    const bufferBytes = numericLimit(device, 'maxBufferSize', 256 * 1024 * 1024);
    const dispatchGroups = numericLimit(device, 'maxComputeWorkgroupsPerDimension', 65535);
    const maximum = Math.min(
        0xffffffff,
        Math.floor(bindingBytes / bytesPerElement),
        Math.floor(bufferBytes / bytesPerElement),
        dispatchGroups * elementsPerWorkgroup,
    );
    return finiteInteger(requested, label, 1, maximum);
}

export function resolveMaxInFlight(value = GPU_PRIMITIVE_DEFAULT_MAX_IN_FLIGHT) {
    return finiteInteger(value, 'maxInFlightOperations', 1, GPU_PRIMITIVE_MAX_IN_FLIGHT);
}

export function resolveGeneration(value = 1) {
    return finiteInteger(value, 'generation', 0, Number.MAX_SAFE_INTEGER - 1);
}

export function assertCount(count, maximum, label = 'count') {
    return finiteInteger(count, label, 0, maximum);
}

export function assertGpuBuffer(buffer, minimumBytes, label) {
    if (!buffer || typeof buffer !== 'object') {
        throw new TypeError(`${label} must be a GPUBuffer`);
    }
    finiteInteger(minimumBytes, `${label} minimumBytes`, 1, Number.MAX_SAFE_INTEGER);
    if (Number.isFinite(buffer.size) && Number(buffer.size) < minimumBytes) {
        throw new RangeError(`${label} needs at least ${minimumBytes} bytes`);
    }
    return buffer;
}

export function assertDistinctBuffers(buffers, label) {
    if (new Set(buffers).size !== buffers.length) {
        throw new RangeError(`${label} buffers must not alias`);
    }
}

export function bufferResource(buffer, byteLength) {
    return { buffer, offset: 0, size: Math.max(U32_BYTES, byteLength) };
}

export function createStorageBuffer(device, byteLength, label) {
    finiteInteger(byteLength, `${label} byteLength`, 1, Number.MAX_SAFE_INTEGER);
    const usage = gpuBufferUsage();
    return device.createBuffer({
        label,
        size: alignTo(Math.max(U32_BYTES, byteLength), U32_BYTES),
        usage: usage.STORAGE,
    });
}

export function createUniformRecords(device, records, label) {
    if (!Array.isArray(records) || records.length === 0) {
        throw new RangeError('uniform records must contain at least one record');
    }
    const usage = gpuBufferUsage();
    const alignment = Math.max(16, numericLimit(device, 'minUniformBufferOffsetAlignment', 256));
    const stride = alignTo(UNIFORM_WORDS * U32_BYTES, alignment);
    const buffer = device.createBuffer({
        label,
        size: stride * records.length,
        usage: usage.UNIFORM,
        mappedAtCreation: true,
    });
    try {
        const words = new Uint32Array(buffer.getMappedRange());
        for (let index = 0; index < records.length; index++) {
            const record = records[index];
            if (!Array.isArray(record) || record.length > UNIFORM_WORDS) {
                throw new TypeError(`uniform record ${index} must be an array of at most four u32 values`);
            }
            const base = (index * stride) / U32_BYTES;
            for (let word = 0; word < record.length; word++) {
                words[base + word] = finiteInteger(
                    record[word],
                    `uniform record ${index} word ${word}`,
                    0,
                    0xffffffff,
                );
            }
        }
    } catch (error) {
        try { buffer.unmap(); } catch (_) {}
        try { buffer.destroy(); } catch (_) {}
        throw error;
    }
    buffer.unmap();
    return { buffer, stride, count: records.length };
}

export function destroyBuffer(buffer) {
    try { buffer?.destroy?.(); } catch (_) {}
}

export function scanLevelCounts(count) {
    if (count === 0) return [];
    const counts = [count];
    while (Math.ceil(counts[counts.length - 1] / GPU_SCAN_BLOCK_SIZE) > 1) {
        counts.push(Math.ceil(counts[counts.length - 1] / GPU_SCAN_BLOCK_SIZE));
    }
    return counts;
}

export function createScanWorkspace(device, maxElements, label) {
    const levels = [];
    let capacity = maxElements;
    let level = 0;
    while (true) {
        const blockCapacity = Math.ceil(capacity / GPU_SCAN_BLOCK_SIZE);
        levels.push({
            capacity,
            blockCapacity,
            output: level === 0
                ? null
                : createStorageBuffer(device, capacity * U32_BYTES, `${label} level ${level} scan`),
            sums: createStorageBuffer(device, blockCapacity * U32_BYTES, `${label} level ${level} sums`),
        });
        if (blockCapacity <= 1) break;
        capacity = blockCapacity;
        level++;
    }
    return {
        levels,
        destroy() {
            for (const entry of levels) {
                destroyBuffer(entry.output);
                destroyBuffer(entry.sums);
            }
        },
    };
}

export function createScanParameters(device, count, label) {
    const counts = scanLevelCounts(count);
    if (counts.length === 0) return null;
    return createUniformRecords(device, counts.map(value => [value, 0, 0, 0]), label);
}

export function encodeScanCommands({
    device,
    encoder,
    pipelines,
    workspace,
    input,
    output,
    count,
    parameters,
    label,
}) {
    const counts = scanLevelCounts(count);
    if (counts.length === 0) return 0;
    if (!parameters || parameters.count < counts.length) {
        throw new RangeError('scan parameter storage does not cover every hierarchy level');
    }
    for (let level = 0; level < counts.length; level++) {
        const levelCount = counts[level];
        const levelInput = level === 0 ? input : workspace.levels[level - 1].sums;
        const levelOutput = level === 0 ? output : workspace.levels[level].output;
        const blockSums = workspace.levels[level].sums;
        const bindGroup = device.createBindGroup({
            label: `${label} level ${level} scan bindings`,
            layout: pipelines.scan.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: parameters.buffer,
                        offset: level * parameters.stride,
                        size: 16,
                    },
                },
                { binding: 1, resource: bufferResource(levelInput, levelCount * U32_BYTES) },
                { binding: 2, resource: bufferResource(levelOutput, levelCount * U32_BYTES) },
                {
                    binding: 3,
                    resource: bufferResource(
                        blockSums,
                        Math.ceil(levelCount / GPU_SCAN_BLOCK_SIZE) * U32_BYTES,
                    ),
                },
            ],
        });
        const pass = encoder.beginComputePass({ label: `${label} level ${level} scan` });
        pass.setPipeline(pipelines.scan);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(levelCount / GPU_SCAN_BLOCK_SIZE));
        pass.end();
    }
    for (let level = counts.length - 2; level >= 0; level--) {
        const levelCount = counts[level];
        const levelOutput = level === 0 ? output : workspace.levels[level].output;
        const blockOffsets = workspace.levels[level + 1].output;
        const bindGroup = device.createBindGroup({
            label: `${label} level ${level} offset bindings`,
            layout: pipelines.add.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: parameters.buffer,
                        offset: level * parameters.stride,
                        size: 16,
                    },
                },
                {
                    binding: 1,
                    resource: bufferResource(
                        blockOffsets,
                        Math.ceil(levelCount / GPU_SCAN_BLOCK_SIZE) * U32_BYTES,
                    ),
                },
                { binding: 2, resource: bufferResource(levelOutput, levelCount * U32_BYTES) },
            ],
        });
        const pass = encoder.beginComputePass({ label: `${label} level ${level} add offsets` });
        pass.setPipeline(pipelines.add);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(levelCount / GPU_SCAN_WORKGROUP_SIZE));
        pass.end();
    }
    return counts.length;
}

export function acquireWorkspace(owner, slots, factory, operationName) {
    owner._assertAlive();
    let slot = slots.find(candidate => !candidate.busy);
    if (!slot && slots.length < owner.maxInFlightOperations) {
        slot = factory(slots.length);
        slot.busy = false;
        slots.push(slot);
    }
    if (!slot) {
        throw new Error(
            `${operationName} exceeded maxInFlightOperations=${owner.maxInFlightOperations}; `
            + 'retire a completed encode receipt before encoding more work',
        );
    }
    slot.busy = true;
    return slot;
}

export function createEncodeReceipt(owner, slot, transientBuffers, details) {
    const generation = owner.generation;
    let released = false;
    const cleanup = () => {
        if (released) return false;
        released = true;
        for (const buffer of transientBuffers) destroyBuffer(buffer);
        if (slot) slot.busy = false;
        owner._activeOperationCleanups.delete(cleanup);
        return true;
    };
    owner._activeOperationCleanups.add(cleanup);
    return Object.freeze({
        ...details,
        generation,
        release: cleanup,
        retire(completion) {
            if (!completion || typeof completion.then !== 'function') {
                throw new TypeError('retire requires the caller submission completion promise');
            }
            return Promise.resolve(completion).finally(cleanup);
        },
    });
}

export function initializePrimitiveLifecycle(instance, device, options, label) {
    instance.device = assertGpuDevice(device);
    instance.label = String(options.label ?? label);
    instance.generation = resolveGeneration(options.generation);
    instance.maxInFlightOperations = resolveMaxInFlight(options.maxInFlightOperations);
    instance._destroyed = false;
    instance._activeOperationCleanups = new Set();
    instance._assertAlive = function assertAlive(generation = this.generation) {
        if (this._destroyed) throw new Error(`${this.label} is destroyed`);
        if (generation !== this.generation) {
            throw new Error(
                `${this.label} generation ${generation} is stale; current generation is ${this.generation}`,
            );
        }
    };
}

export function destroyPrimitiveLifecycle(instance, slots) {
    if (instance._destroyed) return false;
    instance._destroyed = true;
    instance.generation++;
    for (const cleanup of [...instance._activeOperationCleanups]) cleanup();
    for (const slot of slots) slot.destroy();
    slots.length = 0;
    return true;
}
