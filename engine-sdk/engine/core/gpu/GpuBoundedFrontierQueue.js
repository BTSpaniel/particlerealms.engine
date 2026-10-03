// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Finite, deterministic u32 GPU frontier storage for breadth-first searches,
 * crack propagation, refinement, and similar worklists. Producers write into
 * fixed candidate slots; this primitive stably compacts nonzero flags into the
 * alternate frontier. The caller owns the command encoder and queue submit.
 */

import { GPU_EXCLUSIVE_U32_SCAN_WGSL } from './GpuExclusiveScan.js';
import {
    GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
    GPU_SCAN_WORKGROUP_SIZE,
    acquireWorkspace,
    assertCommandEncoder,
    assertCount,
    assertDistinctBuffers,
    assertGpuBuffer,
    assertGpuDevice,
    bufferResource,
    createEncodeReceipt,
    createScanParameters,
    createScanWorkspace,
    createStorageBuffer,
    createUniformRecords,
    destroyBuffer,
    destroyPrimitiveLifecycle,
    encodeScanCommands,
    initializePrimitiveLifecycle,
    resolveGeneration,
    resolveMaxElements,
} from './GpuPrimitiveSupport.js';

const U32_BYTES = 4;

export const GPU_FRONTIER_METADATA_WORDS = 8;
export const GPU_FRONTIER_METADATA_BYTES = GPU_FRONTIER_METADATA_WORDS * U32_BYTES;
export const GPU_FRONTIER_INDIRECT_OFFSET = 2 * U32_BYTES;
export const GPU_FRONTIER_STATUS_OVERFLOW = 1;
export const GPU_FRONTIER_STATUS_SATURATED = 2;
export const GPU_FRONTIER_STATUS_EMPTY = 4;

const METADATA_COUNT = 0;
const METADATA_OVERFLOW = 1;
const METADATA_DISPATCH_X = 2;
const METADATA_DISPATCH_Y = 3;
const METADATA_DISPATCH_Z = 4;
const METADATA_STATUS = 5;
const METADATA_ATTEMPTED = 6;
const METADATA_ROUND = 7;

export const GPU_BOUNDED_FRONTIER_QUEUE_WGSL = /* wgsl */ `
struct FrontierParams {
    candidateCount: u32,
    capacity: u32,
    dispatchWidth: u32,
    round: u32,
}

@group(0) @binding(0) var<uniform> params: FrontierParams;
@group(0) @binding(1) var<storage, read> candidateValues: array<u32>;
@group(0) @binding(2) var<storage, read> candidateFlags: array<u32>;
@group(0) @binding(3) var<storage, read_write> selectedFlags: array<u32>;
@group(0) @binding(4) var<storage, read> selectedOffsets: array<u32>;
@group(0) @binding(5) var<storage, read_write> nextValues: array<u32>;
@group(0) @binding(6) var<storage, read_write> nextMetadata: array<u32>;

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn normalizeCandidates(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index >= params.candidateCount) { return; }
    selectedFlags[index] = select(0u, 1u, candidateFlags[index] != 0u);
}

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn scatterFrontier(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index == 0u) {
        var attempted = 0u;
        if (params.candidateCount > 0u) {
            let last = params.candidateCount - 1u;
            attempted = selectedOffsets[last] + selectedFlags[last];
        }
        let accepted = min(attempted, params.capacity);
        let overflow = attempted - accepted;
        var status = 0u;
        if (overflow > 0u) { status = status | ${GPU_FRONTIER_STATUS_OVERFLOW}u; }
        if (accepted == params.capacity) { status = status | ${GPU_FRONTIER_STATUS_SATURATED}u; }
        if (accepted == 0u) { status = status | ${GPU_FRONTIER_STATUS_EMPTY}u; }
        nextMetadata[${METADATA_COUNT}] = accepted;
        nextMetadata[${METADATA_OVERFLOW}] = overflow;
        nextMetadata[${METADATA_DISPATCH_X}] = (accepted + params.dispatchWidth - 1u) / params.dispatchWidth;
        nextMetadata[${METADATA_DISPATCH_Y}] = 1u;
        nextMetadata[${METADATA_DISPATCH_Z}] = 1u;
        nextMetadata[${METADATA_STATUS}] = status;
        nextMetadata[${METADATA_ATTEMPTED}] = attempted;
        nextMetadata[${METADATA_ROUND}] = params.round;
    }
    if (index >= params.candidateCount || selectedFlags[index] == 0u) { return; }
    let destination = selectedOffsets[index];
    if (destination < params.capacity) {
        nextValues[destination] = candidateValues[index];
    }
}
`;

export const GPU_BOUNDED_FRONTIER_RESET_WGSL = /* wgsl */ `
struct ResetParams {
    capacity: u32,
    reserved0: u32,
    reserved1: u32,
    reserved2: u32,
}

@group(0) @binding(0) var<uniform> params: ResetParams;
@group(0) @binding(1) var<storage, read_write> firstValues: array<u32>;
@group(0) @binding(2) var<storage, read_write> firstMetadata: array<u32>;
@group(0) @binding(3) var<storage, read_write> secondValues: array<u32>;
@group(0) @binding(4) var<storage, read_write> secondMetadata: array<u32>;

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn resetFrontiers(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index < params.capacity) {
        firstValues[index] = 0u;
        secondValues[index] = 0u;
    }
    if (index == 0u) {
        for (var word = 0u; word < ${GPU_FRONTIER_METADATA_WORDS}u; word++) {
            firstMetadata[word] = 0u;
            secondMetadata[word] = 0u;
        }
        firstMetadata[${METADATA_DISPATCH_Y}] = 1u;
        firstMetadata[${METADATA_DISPATCH_Z}] = 1u;
        firstMetadata[${METADATA_STATUS}] = ${GPU_FRONTIER_STATUS_EMPTY}u;
        secondMetadata[${METADATA_DISPATCH_Y}] = 1u;
        secondMetadata[${METADATA_DISPATCH_Z}] = 1u;
        secondMetadata[${METADATA_STATUS}] = ${GPU_FRONTIER_STATUS_EMPTY}u;
    }
}
`;

function positiveCount(value, label, maximum) {
    assertCount(value, maximum, label);
    if (value === 0) {
        throw new RangeError(`${label} must be an integer from 1 through ${maximum}`);
    }
    return value;
}

function queueBufferUsage() {
    const usage = globalThis.GPUBufferUsage;
    for (const name of ['STORAGE', 'COPY_SRC', 'COPY_DST', 'INDIRECT']) {
        if (!Number.isInteger(usage?.[name])) {
            throw new Error(`WebGPU GPUBufferUsage.${name} is unavailable`);
        }
    }
    return usage;
}

function createOwnedBuffer(device, descriptor, initialWords = null) {
    let buffer = null;
    try {
        buffer = device.createBuffer({
            ...descriptor,
            mappedAtCreation: initialWords !== null,
        });
        if (initialWords !== null) {
            new Uint32Array(buffer.getMappedRange()).set(initialWords);
            buffer.unmap();
        }
        return buffer;
    } catch (error) {
        try { buffer?.unmap?.(); } catch (_) {}
        destroyBuffer(buffer);
        throw error;
    }
}

function emptyMetadata() {
    const words = new Uint32Array(GPU_FRONTIER_METADATA_WORDS);
    words[METADATA_DISPATCH_Y] = 1;
    words[METADATA_DISPATCH_Z] = 1;
    words[METADATA_STATUS] = GPU_FRONTIER_STATUS_EMPTY;
    return words;
}

function createRuntime(device, capacity, label) {
    const usage = queueBufferUsage();
    const frontiers = [];
    try {
        for (let index = 0; index < 2; index++) {
            const values = createOwnedBuffer(device, {
                label: `${label} frontier ${index} values`,
                size: capacity * U32_BYTES,
                usage: usage.STORAGE | usage.COPY_SRC | usage.COPY_DST,
            });
            let metadata = null;
            try {
                metadata = createOwnedBuffer(device, {
                    label: `${label} frontier ${index} metadata`,
                    size: GPU_FRONTIER_METADATA_BYTES,
                    usage: usage.STORAGE | usage.COPY_SRC | usage.COPY_DST | usage.INDIRECT,
                }, emptyMetadata());
            } catch (error) {
                destroyBuffer(values);
                throw error;
            }
            frontiers.push({ values, metadata });
        }

        const scanModule = device.createShaderModule({
            label: `${label} scan shader`,
            code: GPU_EXCLUSIVE_U32_SCAN_WGSL,
        });
        const queueModule = device.createShaderModule({
            label: `${label} frontier shader`,
            code: GPU_BOUNDED_FRONTIER_QUEUE_WGSL,
        });
        const resetModule = device.createShaderModule({
            label: `${label} reset shader`,
            code: GPU_BOUNDED_FRONTIER_RESET_WGSL,
        });
        const pipelines = {
            scan: {
                scan: device.createComputePipeline({
                    label: `${label} block scan pipeline`,
                    layout: 'auto',
                    compute: { module: scanModule, entryPoint: 'scanBlocks' },
                }),
                add: device.createComputePipeline({
                    label: `${label} offset add pipeline`,
                    layout: 'auto',
                    compute: { module: scanModule, entryPoint: 'addBlockOffsets' },
                }),
            },
            normalize: device.createComputePipeline({
                label: `${label} normalize candidates pipeline`,
                layout: 'auto',
                compute: { module: queueModule, entryPoint: 'normalizeCandidates' },
            }),
            scatter: device.createComputePipeline({
                label: `${label} stable frontier scatter pipeline`,
                layout: 'auto',
                compute: { module: queueModule, entryPoint: 'scatterFrontier' },
            }),
            reset: device.createComputePipeline({
                label: `${label} reset pipeline`,
                layout: 'auto',
                compute: { module: resetModule, entryPoint: 'resetFrontiers' },
            }),
        };
        return { frontiers, pipelines };
    } catch (error) {
        for (const frontier of frontiers) {
            destroyBuffer(frontier.values);
            destroyBuffer(frontier.metadata);
        }
        throw error;
    }
}

function destroyRuntime(runtime) {
    for (const frontier of runtime?.frontiers ?? []) {
        destroyBuffer(frontier.values);
        destroyBuffer(frontier.metadata);
    }
}

function createWorkspace(device, maxCandidates, label) {
    const byteLength = maxCandidates * U32_BYTES;
    const scan = createScanWorkspace(device, maxCandidates, `${label} scan`);
    const selectedFlags = createStorageBuffer(device, byteLength, `${label} selected flags`);
    const selectedOffsets = createStorageBuffer(device, byteLength, `${label} selected offsets`);
    return {
        scan,
        selectedFlags,
        selectedOffsets,
        destroy() {
            scan.destroy();
            destroyBuffer(selectedFlags);
            destroyBuffer(selectedOffsets);
        },
    };
}

function retireSlots(owner) {
    for (const cleanup of [...owner._activeOperationCleanups]) cleanup();
    for (const slot of owner._slots) slot.destroy();
    owner._slots.length = 0;
}

export class GpuBoundedU32FrontierQueue {
    constructor(device, options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('options must be an object');
        }
        initializePrimitiveLifecycle(this, device, options, 'GpuBoundedU32FrontierQueue');
        this.dispatchItemsPerWorkgroup = positiveCount(
            options.dispatchItemsPerWorkgroup ?? GPU_SCAN_WORKGROUP_SIZE,
            'dispatchItemsPerWorkgroup',
            0xffff,
        );
        this.capacity = resolveMaxElements(
            device,
            options.capacity ?? GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
            {
                elementsPerWorkgroup: Math.min(
                    this.dispatchItemsPerWorkgroup,
                    GPU_SCAN_WORKGROUP_SIZE,
                ),
                label: 'capacity',
            },
        );
        const defaultMaxCandidates = Math.min(
            GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
            this.capacity * 2,
        );
        this.maxCandidates = resolveMaxElements(
            device,
            options.maxCandidates ?? defaultMaxCandidates,
            { label: 'maxCandidates' },
        );
        this._slots = [];
        this._readIndex = 0;
        this._round = 0;
        this._runtime = createRuntime(device, this.capacity, this.label);
    }

    getCurrentFrontier(generation = this.generation) {
        this._assertAlive(generation);
        return this._frontierView(this._readIndex, this._round);
    }

    encodeNext(encoder, {
        candidateValues,
        candidateFlags,
        candidateCount,
        generation = this.generation,
    } = {}) {
        this._assertAlive(generation);
        assertCommandEncoder(encoder);
        assertCount(candidateCount, this.maxCandidates, 'candidateCount');
        if (this._round >= 0xffffffff) {
            throw new RangeError('frontier round exhausted u32 space; encodeReset before continuing');
        }
        const candidateBytes = Math.max(U32_BYTES, candidateCount * U32_BYTES);
        assertGpuBuffer(candidateValues, candidateBytes, 'candidateValues');
        assertGpuBuffer(candidateFlags, candidateBytes, 'candidateFlags');
        const sourceIndex = this._readIndex;
        const destinationIndex = 1 - sourceIndex;
        const source = this._runtime.frontiers[sourceIndex];
        const destination = this._runtime.frontiers[destinationIndex];
        assertDistinctBuffers(
            [candidateValues, candidateFlags, destination.values, destination.metadata],
            'frontier candidate/destination',
        );

        const slot = acquireWorkspace(
            this,
            this._slots,
            index => createWorkspace(
                this.device,
                this.maxCandidates,
                `${this.label} workspace ${index}`,
            ),
            this.label,
        );
        let compactParameters = null;
        let scanParameters = null;
        try {
            const round = this._round + 1;
            compactParameters = createUniformRecords(
                this.device,
                [[candidateCount, this.capacity, this.dispatchItemsPerWorkgroup, round]],
                `${this.label} round ${round} parameters`,
            );
            if (candidateCount > 0) {
                scanParameters = createScanParameters(
                    this.device,
                    candidateCount,
                    `${this.label} round ${round} scan parameters`,
                );
            }
            const parameterResource = {
                buffer: compactParameters.buffer,
                offset: 0,
                size: 16,
            };
            const workgroups = Math.max(
                1,
                Math.ceil(candidateCount / GPU_SCAN_WORKGROUP_SIZE),
            );
            const normalizeBindings = this.device.createBindGroup({
                label: `${this.label} round ${round} normalize bindings`,
                layout: this._runtime.pipelines.normalize.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: parameterResource },
                    { binding: 2, resource: bufferResource(candidateFlags, candidateBytes) },
                    { binding: 3, resource: bufferResource(slot.selectedFlags, candidateBytes) },
                ],
            });
            const normalizePass = encoder.beginComputePass({
                label: `${this.label} round ${round} normalize candidates`,
            });
            normalizePass.setPipeline(this._runtime.pipelines.normalize);
            normalizePass.setBindGroup(0, normalizeBindings);
            normalizePass.dispatchWorkgroups(workgroups);
            normalizePass.end();

            if (candidateCount > 0) {
                encodeScanCommands({
                    device: this.device,
                    encoder,
                    pipelines: this._runtime.pipelines.scan,
                    workspace: slot.scan,
                    input: slot.selectedFlags,
                    output: slot.selectedOffsets,
                    count: candidateCount,
                    parameters: scanParameters,
                    label: `${this.label} round ${round}`,
                });
            }

            const scatterBindings = this.device.createBindGroup({
                label: `${this.label} round ${round} scatter bindings`,
                layout: this._runtime.pipelines.scatter.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: parameterResource },
                    { binding: 1, resource: bufferResource(candidateValues, candidateBytes) },
                    { binding: 3, resource: bufferResource(slot.selectedFlags, candidateBytes) },
                    { binding: 4, resource: bufferResource(slot.selectedOffsets, candidateBytes) },
                    {
                        binding: 5,
                        resource: bufferResource(destination.values, this.capacity * U32_BYTES),
                    },
                    {
                        binding: 6,
                        resource: bufferResource(destination.metadata, GPU_FRONTIER_METADATA_BYTES),
                    },
                ],
            });
            const scatterPass = encoder.beginComputePass({
                label: `${this.label} round ${round} stable scatter`,
            });
            scatterPass.setPipeline(this._runtime.pipelines.scatter);
            scatterPass.setBindGroup(0, scatterBindings);
            scatterPass.dispatchWorkgroups(workgroups);
            scatterPass.end();

            const sourceView = this._frontierView(sourceIndex, this._round);
            this._readIndex = destinationIndex;
            this._round = round;
            const frontierView = this._frontierView(destinationIndex, round);
            const transientBuffers = [compactParameters.buffer];
            if (scanParameters) transientBuffers.push(scanParameters.buffer);
            return createEncodeReceipt(this, slot, transientBuffers, {
                kind: 'bounded-u32-frontier-next',
                candidateCount,
                source: sourceView,
                frontier: frontierView,
                metadata: frontierView.metadata,
                indirectBuffer: frontierView.metadata,
                indirectOffset: GPU_FRONTIER_INDIRECT_OFFSET,
                round,
            });
        } catch (error) {
            destroyBuffer(compactParameters?.buffer);
            destroyBuffer(scanParameters?.buffer);
            slot.busy = false;
            throw error;
        }
    }

    encodeReset(encoder, { generation = this.generation } = {}) {
        this._assertAlive(generation);
        assertCommandEncoder(encoder);
        const slot = acquireWorkspace(
            this,
            this._slots,
            index => createWorkspace(
                this.device,
                this.maxCandidates,
                `${this.label} workspace ${index}`,
            ),
            this.label,
        );
        let parameters = null;
        try {
            parameters = createUniformRecords(
                this.device,
                [[this.capacity, 0, 0, 0]],
                `${this.label} reset parameters`,
            );
            const first = this._runtime.frontiers[0];
            const second = this._runtime.frontiers[1];
            const bindings = this.device.createBindGroup({
                label: `${this.label} reset bindings`,
                layout: this._runtime.pipelines.reset.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: parameters.buffer, offset: 0, size: 16 } },
                    {
                        binding: 1,
                        resource: bufferResource(first.values, this.capacity * U32_BYTES),
                    },
                    {
                        binding: 2,
                        resource: bufferResource(first.metadata, GPU_FRONTIER_METADATA_BYTES),
                    },
                    {
                        binding: 3,
                        resource: bufferResource(second.values, this.capacity * U32_BYTES),
                    },
                    {
                        binding: 4,
                        resource: bufferResource(second.metadata, GPU_FRONTIER_METADATA_BYTES),
                    },
                ],
            });
            const pass = encoder.beginComputePass({ label: `${this.label} reset` });
            pass.setPipeline(this._runtime.pipelines.reset);
            pass.setBindGroup(0, bindings);
            pass.dispatchWorkgroups(Math.ceil(this.capacity / GPU_SCAN_WORKGROUP_SIZE));
            pass.end();
            const previousRound = this._round;
            this._readIndex = 0;
            this._round = 0;
            return createEncodeReceipt(this, slot, [parameters.buffer], {
                kind: 'bounded-u32-frontier-reset',
                previousRound,
                frontier: this._frontierView(0, 0),
            });
        } catch (error) {
            destroyBuffer(parameters?.buffer);
            slot.busy = false;
            throw error;
        }
    }

    recreateDevice(device, nextGeneration = this.generation + 1) {
        this._assertAlive();
        assertGpuDevice(device);
        const generation = resolveGeneration(nextGeneration);
        if (generation <= this.generation) {
            throw new RangeError('nextGeneration must advance the frontier queue generation');
        }
        resolveMaxElements(device, this.capacity, {
            elementsPerWorkgroup: Math.min(
                this.dispatchItemsPerWorkgroup,
                GPU_SCAN_WORKGROUP_SIZE,
            ),
            label: 'capacity',
        });
        resolveMaxElements(device, this.maxCandidates, { label: 'maxCandidates' });
        const candidate = createRuntime(device, this.capacity, this.label);
        const previous = this._runtime;
        retireSlots(this);
        this.device = device;
        this.generation = generation;
        this._runtime = candidate;
        this._readIndex = 0;
        this._round = 0;
        destroyRuntime(previous);
        return this.getCurrentFrontier(generation);
    }

    destroy() {
        const destroyed = destroyPrimitiveLifecycle(this, this._slots);
        if (!destroyed) return false;
        destroyRuntime(this._runtime);
        this._runtime = null;
        return true;
    }

    _frontierView(index, round) {
        const frontier = this._runtime.frontiers[index];
        return Object.freeze({
            values: frontier.values,
            metadata: frontier.metadata,
            capacity: this.capacity,
            index,
            round,
            generation: this.generation,
            countOffset: METADATA_COUNT * U32_BYTES,
            overflowOffset: METADATA_OVERFLOW * U32_BYTES,
            indirectOffset: GPU_FRONTIER_INDIRECT_OFFSET,
            statusOffset: METADATA_STATUS * U32_BYTES,
            attemptedOffset: METADATA_ATTEMPTED * U32_BYTES,
            roundOffset: METADATA_ROUND * U32_BYTES,
        });
    }
}

export default GpuBoundedU32FrontierQueue;
