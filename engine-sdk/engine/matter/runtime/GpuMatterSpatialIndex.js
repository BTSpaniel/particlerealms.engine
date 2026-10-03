// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic caller-encoded GPU cell indexing for Matter packet neighborhoods. */

import { GpuExclusiveU32Scan } from '../../core/gpu/GpuExclusiveScan.js';
import { GpuStableU32RadixSort } from '../../core/gpu/GpuStableRadixSort.js';
import {
    assertCommandEncoder,
    assertCount,
    assertDistinctBuffers,
    assertGpuBuffer,
    createUniformRecords,
    destroyBuffer,
    resolveGeneration,
    resolveMaxElements,
    resolveMaxInFlight,
} from '../../core/gpu/GpuPrimitiveSupport.js';
import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const GPU_MATTER_SPATIAL_INDEX_SCHEMA = 'engine.matter.gpu-spatial-index-snapshot';
export const GPU_MATTER_SPATIAL_INDEX_VERSION = '1.0.0';

const U32_BYTES = 4;
const SNAPSHOT_KEYS = new Set([
    'schema', 'schemaVersion', 'maxParticles', 'maxCells', 'deviceGeneration', 'metrics',
]);
const METRIC_KEYS = new Set([
    'encodedBuilds', 'encodedParticles', 'encodedCells', 'rejectedBuilds', 'deviceRecreations',
]);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function exactObject(value, keys, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${path}.${key}`, 'unknown field');
    return value;
}

function safeOptions(input) {
    if (!isPlainJsonObject(input)) fail('$.options', 'must be a plain object');
    const allowed = new Set([
        'maxParticles', 'maxCells', 'maxInFlightOperations', 'deviceGeneration', 'label',
        'logger', 'snapshot',
    ]);
    const result = {};
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== 'string' || !allowed.has(key)) fail(`$.options.${String(key)}`, 'unknown field');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
            fail(`$.options.${key}`, 'must be an enumerable data property');
        }
        result[key] = descriptor.value;
    }
    return result;
}

function callLogger(logger, type, details = {}) {
    try { logger?.(Object.freeze({ type, ...details })); } catch (_error) { /* diagnostic only */ }
}

const SPATIAL_INDEX_WGSL = /* wgsl */ `
struct SpatialIndexParams {
    particleCount: u32,
    cellCount: u32,
    reserved0: u32,
    reserved1: u32,
}

@group(0) @binding(0) var<uniform> params: SpatialIndexParams;
@group(0) @binding(1) var<storage, read> sortedCellKeys: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> cellOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> invalidCount: atomic<u32>;

@compute @workgroup_size(128)
fn histogram(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index >= params.particleCount) { return; }
    let cell = sortedCellKeys[index];
    if (cell < params.cellCount) {
        atomicAdd(&cellCounts[cell], 1u);
    } else {
        atomicAdd(&invalidCount, 1u);
    }
}

@compute @workgroup_size(1)
fn finalizeOffsets() {
    cellOffsets[params.cellCount] = params.particleCount - atomicLoad(&invalidCount);
}
`;

function createPipelines(device, label) {
    const module = device.createShaderModule({ label: `${label} shader`, code: SPATIAL_INDEX_WGSL });
    return {
        histogram: device.createComputePipeline({
            label: `${label} histogram pipeline`,
            layout: 'auto',
            compute: { module, entryPoint: 'histogram' },
        }),
        finalize: device.createComputePipeline({
            label: `${label} terminal offset pipeline`,
            layout: 'auto',
            compute: { module, entryPoint: 'finalizeOffsets' },
        }),
    };
}

export class GpuMatterSpatialIndex {
    #device;
    #maxParticles;
    #maxCells;
    #maxInFlightOperations;
    #deviceGeneration;
    #label;
    #logger;
    #sort;
    #scan;
    #pipelines;
    #destroyed = false;
    #activeCleanups = new Set();
    #metrics = {
        encodedBuilds: 0,
        encodedParticles: 0,
        encodedCells: 0,
        rejectedBuilds: 0,
        deviceRecreations: 0,
    };

    constructor(device, optionsInput = {}) {
        const options = safeOptions(optionsInput);
        if (!device || typeof device.createComputePipeline !== 'function') fail('$.device', 'must be a GPUDevice');
        if (options.logger != null && typeof options.logger !== 'function') fail('$.options.logger', 'must be a function or null');
        const constructorSnapshot = options.snapshot == null
            ? null
            : validateGpuMatterSpatialIndexSnapshot(options.snapshot);
        this.#device = device;
        this.#maxParticles = resolveMaxElements(device, options.maxParticles ?? constructorSnapshot?.maxParticles ?? (1 << 20), {
            label: 'maxParticles',
        });
        this.#maxCells = resolveMaxElements(device, options.maxCells ?? constructorSnapshot?.maxCells ?? (1 << 18), {
            label: 'maxCells',
        });
        this.#maxInFlightOperations = resolveMaxInFlight(options.maxInFlightOperations);
        this.#deviceGeneration = resolveGeneration(options.deviceGeneration ?? constructorSnapshot?.deviceGeneration);
        this.#label = String(options.label ?? 'Matter GPU spatial index');
        this.#logger = options.logger ?? null;
        this.#sort = new GpuStableU32RadixSort(device, {
            maxElements: this.#maxParticles,
            maxInFlightOperations: this.#maxInFlightOperations,
            generation: this.#deviceGeneration,
            label: `${this.#label} stable sort`,
        });
        this.#scan = new GpuExclusiveU32Scan(device, {
            maxElements: this.#maxCells,
            maxInFlightOperations: this.#maxInFlightOperations,
            generation: this.#deviceGeneration,
            label: `${this.#label} cell scan`,
        });
        this.#pipelines = createPipelines(device, this.#label);
        callLogger(this.#logger, 'matter-spatial-index-initialize', {
            maxParticles: this.#maxParticles,
            maxCells: this.#maxCells,
            deviceGeneration: this.#deviceGeneration,
        });
        if (constructorSnapshot != null) this.restore(constructorSnapshot);
    }

    #assertAlive(generation = this.#deviceGeneration) {
        if (this.#destroyed) throw new Error(`${this.#label} is destroyed`);
        if (generation !== this.#deviceGeneration) {
            throw new Error(
                `${this.#label} generation ${generation} is stale; current generation is ${this.#deviceGeneration}`,
            );
        }
    }

    encode(encoder, {
        cellKeys,
        particleIds,
        sortedCellKeys,
        sortedParticleIds,
        cellCounts,
        cellOffsets,
        invalidCount,
        particleCount,
        cellCount,
        generation = this.#deviceGeneration,
    } = {}) {
        callLogger(this.#logger, 'matter-spatial-index-build-start', { particleCount, cellCount });
        let sortReceipt = null;
        let scanReceipt = null;
        let parameters = null;
        try {
            this.#assertAlive(generation);
            assertCommandEncoder(encoder);
            if (typeof encoder.clearBuffer !== 'function') fail('$.encoder', 'must support clearBuffer');
            assertCount(particleCount, this.#maxParticles, 'particleCount');
            integer(cellCount, '$.cellCount', 1, this.#maxCells);
            const particleBytes = Math.max(U32_BYTES, particleCount * U32_BYTES);
            assertGpuBuffer(cellKeys, particleBytes, 'cellKeys');
            assertGpuBuffer(particleIds, particleBytes, 'particleIds');
            assertGpuBuffer(sortedCellKeys, particleBytes, 'sortedCellKeys');
            assertGpuBuffer(sortedParticleIds, particleBytes, 'sortedParticleIds');
            assertGpuBuffer(cellCounts, cellCount * U32_BYTES, 'cellCounts');
            assertGpuBuffer(cellOffsets, (cellCount + 1) * U32_BYTES, 'cellOffsets');
            assertGpuBuffer(invalidCount, U32_BYTES, 'invalidCount');
            assertDistinctBuffers([cellCounts, cellOffsets, invalidCount], 'spatial index aggregate');
            for (const aggregate of [cellCounts, cellOffsets, invalidCount]) {
                if ([cellKeys, particleIds, sortedCellKeys, sortedParticleIds].includes(aggregate)) {
                    throw new RangeError('spatial index aggregate buffers must not alias key/value buffers');
                }
            }

            encoder.clearBuffer(cellCounts, 0, cellCount * U32_BYTES);
            encoder.clearBuffer(invalidCount, 0, U32_BYTES);
            sortReceipt = this.#sort.encode(encoder, {
                inputKeys: cellKeys,
                inputValues: particleIds,
                outputKeys: sortedCellKeys,
                outputValues: sortedParticleIds,
                count: particleCount,
                bitCount: 32,
                generation,
            });
            parameters = createUniformRecords(
                this.#device,
                [[particleCount, cellCount, 0, 0]],
                `${this.#label} parameters`,
            );

            if (particleCount > 0) {
                const histogramBindings = this.#device.createBindGroup({
                    label: `${this.#label} histogram bindings`,
                    layout: this.#pipelines.histogram.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: parameters.buffer, size: 16 } },
                        { binding: 1, resource: { buffer: sortedCellKeys, size: particleBytes } },
                        { binding: 2, resource: { buffer: cellCounts, size: cellCount * U32_BYTES } },
                        { binding: 4, resource: { buffer: invalidCount, size: U32_BYTES } },
                    ],
                });
                const histogramPass = encoder.beginComputePass({ label: `${this.#label} histogram` });
                histogramPass.setPipeline(this.#pipelines.histogram);
                histogramPass.setBindGroup(0, histogramBindings);
                histogramPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
                histogramPass.end();
            }

            scanReceipt = this.#scan.encode(encoder, {
                input: cellCounts,
                output: cellOffsets,
                count: cellCount,
                generation,
            });
            const finalizeBindings = this.#device.createBindGroup({
                label: `${this.#label} terminal offset bindings`,
                layout: this.#pipelines.finalize.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: parameters.buffer, size: 16 } },
                    { binding: 3, resource: { buffer: cellOffsets, size: (cellCount + 1) * U32_BYTES } },
                    { binding: 4, resource: { buffer: invalidCount, size: U32_BYTES } },
                ],
            });
            const finalizePass = encoder.beginComputePass({ label: `${this.#label} terminal offset` });
            finalizePass.setPipeline(this.#pipelines.finalize);
            finalizePass.setBindGroup(0, finalizeBindings);
            finalizePass.dispatchWorkgroups(1);
            finalizePass.end();

            this.#metrics.encodedBuilds += 1;
            this.#metrics.encodedParticles += particleCount;
            this.#metrics.encodedCells += cellCount;
            let settled = false;
            const cleanup = () => {
                if (settled) return false;
                settled = true;
                sortReceipt.release();
                scanReceipt.release();
                destroyBuffer(parameters.buffer);
                this.#activeCleanups.delete(cleanup);
                return true;
            };
            this.#activeCleanups.add(cleanup);
            const receipt = Object.freeze({
                kind: 'matter-gpu-spatial-index',
                particleCount,
                cellCount,
                generation,
                stable: true,
                release: cleanup,
                retire(completion) {
                    if (!completion || typeof completion.then !== 'function') {
                        throw new TypeError('retire requires the caller submission completion promise');
                    }
                    return Promise.resolve(completion).finally(cleanup);
                },
            });
            callLogger(this.#logger, 'matter-spatial-index-build-encoded', { particleCount, cellCount });
            return receipt;
        } catch (error) {
            sortReceipt?.release();
            scanReceipt?.release();
            destroyBuffer(parameters?.buffer);
            this.#metrics.rejectedBuilds += 1;
            callLogger(this.#logger, 'matter-spatial-index-build-failed', { message: error.message });
            throw error;
        }
    }

    snapshot() {
        this.#assertAlive();
        return deepFreezeJson({
            schema: GPU_MATTER_SPATIAL_INDEX_SCHEMA,
            schemaVersion: GPU_MATTER_SPATIAL_INDEX_VERSION,
            maxParticles: this.#maxParticles,
            maxCells: this.#maxCells,
            deviceGeneration: this.#deviceGeneration,
            metrics: cloneStrictJson(this.#metrics),
        }, '$.gpuMatterSpatialIndexSnapshot');
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const snapshot = validateGpuMatterSpatialIndexSnapshot(snapshotInput);
        if (snapshot.maxParticles !== this.#maxParticles || snapshot.maxCells !== this.#maxCells) {
            fail('$.gpuMatterSpatialIndexSnapshot', 'capacity does not match this index');
        }
        if (snapshot.deviceGeneration !== this.#deviceGeneration) {
            fail('$.gpuMatterSpatialIndexSnapshot.deviceGeneration', 'does not match the live device generation');
        }
        this.#metrics = cloneStrictJson(snapshot.metrics);
        callLogger(this.#logger, 'matter-spatial-index-restored', { deviceGeneration: this.#deviceGeneration });
        return this;
    }

    async prepareDevice(device, { nextGeneration } = {}) {
        this.#assertAlive();
        const generation = resolveGeneration(nextGeneration);
        if (generation <= this.#deviceGeneration) fail('$.nextGeneration', 'must advance');
        const candidate = new GpuMatterSpatialIndex(device, {
            maxParticles: this.#maxParticles,
            maxCells: this.#maxCells,
            maxInFlightOperations: this.#maxInFlightOperations,
            deviceGeneration: generation,
            label: this.#label,
            logger: this.#logger,
        });
        candidate.#metrics = { ...this.#metrics, deviceRecreations: this.#metrics.deviceRecreations + 1 };
        let state = 'prepared';
        let previous = null;
        return Object.freeze({
            commit: async () => {
                if (state !== 'prepared') return false;
                previous = {
                    device: this.#device,
                    sort: this.#sort,
                    scan: this.#scan,
                    pipelines: this.#pipelines,
                    deviceGeneration: this.#deviceGeneration,
                    metrics: this.#metrics,
                    activeCleanups: this.#activeCleanups,
                };
                this.#device = candidate.#device;
                this.#sort = candidate.#sort;
                this.#scan = candidate.#scan;
                this.#pipelines = candidate.#pipelines;
                this.#deviceGeneration = generation;
                this.#metrics = candidate.#metrics;
                this.#activeCleanups = candidate.#activeCleanups;
                this.#destroyed = false;
                candidate.#destroyed = true;
                candidate.#activeCleanups = new Set();
                state = 'committed';
                callLogger(this.#logger, 'matter-spatial-index-device-recreated', { deviceGeneration: generation });
                return true;
            },
            rollback: async () => {
                if (state !== 'committed' || !previous) return false;
                for (const cleanup of [...this.#activeCleanups]) cleanup();
                this.#sort.destroy();
                this.#scan.destroy();
                this.#device = previous.device;
                this.#sort = previous.sort;
                this.#scan = previous.scan;
                this.#pipelines = previous.pipelines;
                this.#deviceGeneration = previous.deviceGeneration;
                this.#metrics = previous.metrics;
                this.#activeCleanups = previous.activeCleanups;
                previous = null;
                state = 'rolled-back';
                callLogger(this.#logger, 'matter-spatial-index-device-recreation-rolled-back', {
                    deviceGeneration: this.#deviceGeneration,
                });
                return true;
            },
            finalize: async () => {
                if (state !== 'committed' || !previous) return false;
                for (const cleanup of [...previous.activeCleanups]) cleanup();
                previous.sort.destroy();
                previous.scan.destroy();
                previous = null;
                state = 'finalized';
                return true;
            },
            destroy: async () => {
                if (state !== 'prepared') return false;
                candidate.destroy();
                state = 'destroyed';
                return true;
            },
        });
    }

    stats() {
        return cloneAndFreezeStrictJson({
            ...this.#metrics,
            maxParticles: this.#maxParticles,
            maxCells: this.#maxCells,
            maxInFlightOperations: this.#maxInFlightOperations,
            deviceGeneration: this.#deviceGeneration,
            activeReceipts: this.#activeCleanups.size,
            destroyed: this.#destroyed,
        }, '$.gpuMatterSpatialIndexStats');
    }

    destroy() {
        if (this.#destroyed) return false;
        callLogger(this.#logger, 'matter-spatial-index-destroy-start');
        for (const cleanup of [...this.#activeCleanups]) cleanup();
        this.#sort.destroy();
        this.#scan.destroy();
        this.#destroyed = true;
        callLogger(this.#logger, 'matter-spatial-index-destroyed');
        return true;
    }
}

export function validateGpuMatterSpatialIndexSnapshot(snapshotInput) {
    const snapshot = cloneStrictJson(snapshotInput, '$.gpuMatterSpatialIndexSnapshot');
    exactObject(snapshot, SNAPSHOT_KEYS, '$.gpuMatterSpatialIndexSnapshot');
    for (const key of SNAPSHOT_KEYS) if (!Object.hasOwn(snapshot, key)) fail(`$.gpuMatterSpatialIndexSnapshot.${key}`, 'is required');
    if (snapshot.schema !== GPU_MATTER_SPATIAL_INDEX_SCHEMA
        || snapshot.schemaVersion !== GPU_MATTER_SPATIAL_INDEX_VERSION) {
        fail('$.gpuMatterSpatialIndexSnapshot', 'uses an unsupported schema');
    }
    integer(snapshot.maxParticles, '$.gpuMatterSpatialIndexSnapshot.maxParticles', 1);
    integer(snapshot.maxCells, '$.gpuMatterSpatialIndexSnapshot.maxCells', 1);
    resolveGeneration(snapshot.deviceGeneration);
    exactObject(snapshot.metrics, METRIC_KEYS, '$.gpuMatterSpatialIndexSnapshot.metrics');
    for (const key of METRIC_KEYS) integer(snapshot.metrics[key], `$.gpuMatterSpatialIndexSnapshot.metrics.${key}`);
    return deepFreezeJson(snapshot, '$.gpuMatterSpatialIndexSnapshot');
}

export function createGpuMatterSpatialIndex(device, options = {}) {
    return new GpuMatterSpatialIndex(device, options);
}

export default GpuMatterSpatialIndex;
