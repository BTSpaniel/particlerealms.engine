// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Finite, paged Matter packet GPU storage with generational handles and caller-owned encoding. */

import { GpuStableFlagCompaction } from '../../core/gpu/GpuStableCompaction.js';
import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const MATTER_GPU_PACKET_ARENA_SCHEMA = 'engine.matter.gpu-packet-arena-snapshot';
export const MATTER_GPU_PACKET_ARENA_VERSION = '1.0.0';
export const MATTER_GPU_PACKET_RECORD_BYTES = 48;
export const MATTER_GPU_PACKET_UPLOAD_BYTES_PER_SLOT = 52;
export const MATTER_GPU_PACKET_PAGE_BYTES_PER_SLOT = 60;
export const MATTER_GPU_PACKET_PAGE_FIXED_BYTES = 16;

const HANDLE_KEYS = new Set(['pageId', 'slot', 'generation']);
const RECORD_KEYS = new Set([
    'positionM', 'velocityMPerS', 'massKg', 'representedVolumeM3',
    'definitionNumericId', 'resolutionLevel', 'flags',
]);
const SNAPSHOT_KEYS = new Set([
    'schema', 'schemaVersion', 'pageSize', 'maxPages', 'deviceGeneration',
    'pages', 'metrics',
]);
const PAGE_KEYS = new Set(['pageId', 'generations', 'active', 'records']);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function integer(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function finite(value, path, { minimum = -Number.MAX_VALUE } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
        fail(path, `must be finite and >= ${minimum}`);
    }
    return value;
}

function vector3(value, path) {
    if (!Array.isArray(value) || value.length !== 3) fail(path, 'must be a 3-vector');
    return value.map((entry, axis) => finite(entry, `${path}[${axis}]`));
}

function exactObject(value, keys, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${path}.${key}`, 'unknown field');
    return value;
}

function normalizeHandle(input, path = '$.handle') {
    const value = cloneStrictJson(input, path);
    exactObject(value, HANDLE_KEYS, path);
    for (const key of HANDLE_KEYS) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    return {
        pageId: integer(value.pageId, `${path}.pageId`, { maximum: 0xffffffff }),
        slot: integer(value.slot, `${path}.slot`, { maximum: 0xffffffff }),
        generation: integer(value.generation, `${path}.generation`, { minimum: 1, maximum: 0xffffffff }),
    };
}

function normalizeRecord(input, path = '$.record') {
    const value = cloneStrictJson(input, path);
    exactObject(value, RECORD_KEYS, path);
    for (const key of RECORD_KEYS) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    return {
        positionM: vector3(value.positionM, `${path}.positionM`),
        velocityMPerS: vector3(value.velocityMPerS, `${path}.velocityMPerS`),
        massKg: finite(value.massKg, `${path}.massKg`, { minimum: Number.MIN_VALUE }),
        representedVolumeM3: finite(value.representedVolumeM3, `${path}.representedVolumeM3`, { minimum: 0 }),
        definitionNumericId: integer(value.definitionNumericId, `${path}.definitionNumericId`, { maximum: 0xffffffff }),
        resolutionLevel: integer(value.resolutionLevel, `${path}.resolutionLevel`, { maximum: 31 }),
        flags: integer(value.flags, `${path}.flags`, { maximum: 0xffffffff }),
    };
}

function nextGeneration(value) {
    return value >= 0xffffffff ? 1 : value + 1;
}

function gpuUsage() {
    const usage = globalThis.GPUBufferUsage;
    if (!usage) throw new Error('GPUBufferUsage is unavailable');
    return usage;
}

function destroyBuffer(buffer) {
    try { buffer?.destroy?.(); } catch (_error) { /* idempotent cleanup */ }
}

function callLogger(logger, type, details = {}) {
    try { logger?.(Object.freeze({ type, ...details })); } catch (_error) { /* diagnostic only */ }
}

function makeBuffer(device, label, size, usage, mappedData = null) {
    const buffer = device.createBuffer({
        label,
        size: Math.max(4, Math.ceil(size / 4) * 4),
        usage,
        mappedAtCreation: mappedData !== null,
    });
    if (mappedData !== null) {
        try {
            const target = new Uint8Array(buffer.getMappedRange());
            target.set(new Uint8Array(mappedData.buffer, mappedData.byteOffset, mappedData.byteLength));
        } finally {
            buffer.unmap();
        }
    }
    return buffer;
}

function createCpuPage(pageId, pageSize) {
    const generations = new Uint32Array(pageSize);
    generations.fill(1);
    return {
        pageId,
        generations,
        active: new Uint32Array(pageSize),
        positions: new Float32Array(pageSize * 4),
        velocities: new Float32Array(pageSize * 4),
        metadata: new Uint32Array(pageSize * 4),
        slotIndices: Uint32Array.from({ length: pageSize }, (_unused, index) => index),
        records: Array(pageSize).fill(null),
        freeSlots: Array.from({ length: pageSize }, (_unused, index) => index),
        dirtyMinimum: pageSize,
        dirtyMaximum: -1,
        buffers: null,
    };
}

function markDirty(page, slot) {
    page.dirtyMinimum = Math.min(page.dirtyMinimum, slot);
    page.dirtyMaximum = Math.max(page.dirtyMaximum, slot);
}

function writeRecord(page, slot, record) {
    const floatOffset = slot * 4;
    page.positions.set([
        record.positionM[0], record.positionM[1], record.positionM[2], record.representedVolumeM3,
    ], floatOffset);
    page.velocities.set([
        record.velocityMPerS[0], record.velocityMPerS[1], record.velocityMPerS[2], record.massKg,
    ], floatOffset);
    page.metadata.set([
        record.definitionNumericId, record.resolutionLevel, record.flags, page.generations[slot],
    ], floatOffset);
    page.records[slot] = record;
    markDirty(page, slot);
}

function clearRecord(page, slot) {
    const offset = slot * 4;
    page.positions.fill(0, offset, offset + 4);
    page.velocities.fill(0, offset, offset + 4);
    page.metadata.fill(0, offset, offset + 4);
    page.records[slot] = null;
    markDirty(page, slot);
}

function createGpuBuffers(device, page, pageSize) {
    const usage = gpuUsage();
    const storageCopy = usage.STORAGE | usage.COPY_DST | usage.COPY_SRC;
    const buffers = {};
    try {
        buffers.positions = makeBuffer(device, `Matter page ${page.pageId} position-volume`, pageSize * 16, storageCopy);
        buffers.velocities = makeBuffer(device, `Matter page ${page.pageId} velocity-mass`, pageSize * 16, storageCopy);
        buffers.metadata = makeBuffer(device, `Matter page ${page.pageId} metadata`, pageSize * 16, storageCopy);
        buffers.alive = makeBuffer(device, `Matter page ${page.pageId} alive`, pageSize * 4, storageCopy);
        buffers.slotIndices = makeBuffer(
            device,
            `Matter page ${page.pageId} slot indices`,
            pageSize * 4,
            storageCopy,
            page.slotIndices,
        );
        buffers.activeSlots = makeBuffer(device, `Matter page ${page.pageId} active slots`, pageSize * 4, storageCopy);
        buffers.activeCount = makeBuffer(device, `Matter page ${page.pageId} active count`, 4, storageCopy);
        buffers.indirect = makeBuffer(
            device,
            `Matter page ${page.pageId} indirect dispatch`,
            12,
            usage.STORAGE | usage.INDIRECT | usage.COPY_SRC | usage.COPY_DST,
        );
        return buffers;
    } catch (error) {
        for (const buffer of Object.values(buffers)) destroyBuffer(buffer);
        throw error;
    }
}

function destroyGpuBuffers(buffers) {
    if (!buffers) return;
    for (const buffer of Object.values(buffers)) destroyBuffer(buffer);
}

const INDIRECT_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> activeCount: array<u32>;
@group(0) @binding(1) var<storage, read_write> indirect: array<u32>;

@compute @workgroup_size(1)
fn main() {
    indirect[0] = (activeCount[0] + 63u) / 64u;
    indirect[1] = 1u;
    indirect[2] = 1u;
}
`;

export class MatterGpuPacketArenaError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'MatterGpuPacketArenaError';
        this.code = code;
        this.details = cloneAndFreezeStrictJson(details, '$.matterGpuPacketArenaError.details');
    }
}

/**
 * CPU owns allocation metadata; GPU owns compact active lists and indirect counts.
 * The arena never creates a command encoder and never submits a queue.
 */
export class MatterGpuPacketArena {
    #device;
    #pageSize;
    #maxPages;
    #deviceGeneration;
    #pages = [];
    #compaction;
    #indirectPipeline;
    #logger;
    #destroyed = false;
    #metrics = {
        allocations: 0,
        releases: 0,
        updates: 0,
        allocationFailures: 0,
        encodedMaintenances: 0,
        uploadedBytes: 0,
        highWaterMark: 0,
        deviceRecreations: 0,
    };

    constructor(device, optionsInput = {}) {
        if (!device || typeof device.createBuffer !== 'function' || typeof device.createComputePipeline !== 'function') {
            fail('$.device', 'must be a GPUDevice-like object');
        }
        if (!isPlainJsonObject(optionsInput)) fail('$.options', 'must be a plain object');
        const allowed = new Set(['pageSize', 'maxPages', 'deviceGeneration', 'logger', 'snapshot']);
        const options = {};
        for (const key of Reflect.ownKeys(optionsInput)) {
            if (typeof key !== 'string' || !allowed.has(key)) fail(`$.options.${String(key)}`, 'unknown field');
            const descriptor = Object.getOwnPropertyDescriptor(optionsInput, key);
            if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`$.options.${key}`, 'must be an enumerable data property');
            options[key] = descriptor.value;
        }
        if (options.logger != null && typeof options.logger !== 'function') fail('$.options.logger', 'must be a function or null');
        const constructorSnapshot = options.snapshot == null
            ? null
            : validateMatterGpuPacketArenaSnapshot(options.snapshot);
        this.#device = device;
        this.#pageSize = integer(
            options.pageSize ?? constructorSnapshot?.pageSize ?? 1024,
            '$.options.pageSize',
            { minimum: 1, maximum: 1_048_576 },
        );
        this.#maxPages = integer(
            options.maxPages ?? constructorSnapshot?.maxPages ?? 64,
            '$.options.maxPages',
            { minimum: 1, maximum: 65_536 },
        );
        this.#deviceGeneration = integer(
            options.deviceGeneration ?? constructorSnapshot?.deviceGeneration ?? 0,
            '$.options.deviceGeneration',
        );
        this.#logger = options.logger ?? null;
        this.#compaction = new GpuStableFlagCompaction(device, {
            maxElements: this.#pageSize,
            label: 'Matter GPU packet active-slot compaction',
            generation: this.#deviceGeneration,
        });
        const shader = device.createShaderModule({ label: 'Matter indirect dispatch shader', code: INDIRECT_WGSL });
        this.#indirectPipeline = device.createComputePipeline({
            label: 'Matter indirect dispatch pipeline',
            layout: 'auto',
            compute: { module: shader, entryPoint: 'main' },
        });
        callLogger(this.#logger, 'matter-gpu-arena-initialize', {
            pageSize: this.#pageSize,
            maxPages: this.#maxPages,
            deviceGeneration: this.#deviceGeneration,
        });
        if (constructorSnapshot != null) this.restore(constructorSnapshot);
    }

    #assertAlive() {
        if (this.#destroyed) throw new MatterGpuPacketArenaError('destroyed', 'Matter GPU packet arena is destroyed');
    }

    #createPage() {
        if (this.#pages.length >= this.#maxPages) return null;
        const page = createCpuPage(this.#pages.length, this.#pageSize);
        page.buffers = createGpuBuffers(this.#device, page, this.#pageSize);
        this.#pages.push(page);
        callLogger(this.#logger, 'matter-gpu-page-created', { pageId: page.pageId });
        return page;
    }

    #lookup(handleInput) {
        const handle = normalizeHandle(handleInput);
        const page = this.#pages[handle.pageId];
        if (!page || handle.slot >= this.#pageSize
            || page.active[handle.slot] !== 1
            || page.generations[handle.slot] !== handle.generation) {
            throw new MatterGpuPacketArenaError('stale-handle', 'Matter GPU packet handle is stale or invalid', { handle });
        }
        return { handle, page, record: page.records[handle.slot] };
    }

    allocate(recordInput) {
        this.#assertAlive();
        callLogger(this.#logger, 'matter-gpu-allocation-start');
        try {
            const record = normalizeRecord(recordInput);
            let page = this.#pages.find(candidate => candidate.freeSlots.length > 0) ?? this.#createPage();
            if (!page) {
                this.#metrics.allocationFailures += 1;
                throw new MatterGpuPacketArenaError('capacity-exhausted', 'Matter GPU packet arena capacity is exhausted', this.stats());
            }
            const slot = page.freeSlots.shift();
            page.active[slot] = 1;
            writeRecord(page, slot, record);
            this.#metrics.allocations += 1;
            this.#metrics.highWaterMark = Math.max(this.#metrics.highWaterMark, this.activeCount);
            const handle = deepFreezeJson({ pageId: page.pageId, slot, generation: page.generations[slot] });
            callLogger(this.#logger, 'matter-gpu-allocated', { handle });
            return handle;
        } catch (error) {
            callLogger(this.#logger, 'matter-gpu-allocation-failed', { message: error.message });
            throw error;
        }
    }

    release(handleInput) {
        this.#assertAlive();
        callLogger(this.#logger, 'matter-gpu-release-start');
        try {
            const { handle, page, record } = this.#lookup(handleInput);
            page.active[handle.slot] = 0;
            page.generations[handle.slot] = nextGeneration(page.generations[handle.slot]);
            clearRecord(page, handle.slot);
            page.freeSlots.push(handle.slot);
            page.freeSlots.sort((left, right) => left - right);
            this.#metrics.releases += 1;
            callLogger(this.#logger, 'matter-gpu-released', { handle });
            return cloneAndFreezeStrictJson(record);
        } catch (error) {
            callLogger(this.#logger, 'matter-gpu-release-failed', { message: error.message });
            throw error;
        }
    }

    update(handleInput, recordInput) {
        this.#assertAlive();
        callLogger(this.#logger, 'matter-gpu-update-start');
        try {
            const record = normalizeRecord(recordInput);
            const { handle, page } = this.#lookup(handleInput);
            writeRecord(page, handle.slot, record);
            this.#metrics.updates += 1;
            callLogger(this.#logger, 'matter-gpu-updated', { handle });
            return this.get(handle);
        } catch (error) {
            callLogger(this.#logger, 'matter-gpu-update-failed', { message: error.message });
            throw error;
        }
    }

    get(handleInput) {
        this.#assertAlive();
        const { handle, record } = this.#lookup(handleInput);
        return cloneAndFreezeStrictJson({ handle, ...record }, '$.matterGpuPacketRecord');
    }

    list() {
        this.#assertAlive();
        const result = [];
        for (const page of this.#pages) {
            for (let slot = 0; slot < this.#pageSize; slot += 1) {
                if (page.active[slot] !== 1) continue;
                result.push({
                    handle: { pageId: page.pageId, slot, generation: page.generations[slot] },
                    ...page.records[slot],
                });
            }
        }
        return cloneAndFreezeStrictJson(result, '$.matterGpuPacketRecords');
    }

    #flushPage(page) {
        if (page.dirtyMaximum < page.dirtyMinimum) return 0;
        const first = page.dirtyMinimum;
        const count = page.dirtyMaximum - first + 1;
        const floatStart = first * 4;
        const floatEnd = (first + count) * 4;
        const byteOffset4 = first * 16;
        this.#device.queue.writeBuffer(page.buffers.positions, byteOffset4, page.positions.subarray(floatStart, floatEnd));
        this.#device.queue.writeBuffer(page.buffers.velocities, byteOffset4, page.velocities.subarray(floatStart, floatEnd));
        this.#device.queue.writeBuffer(page.buffers.metadata, byteOffset4, page.metadata.subarray(floatStart, floatEnd));
        this.#device.queue.writeBuffer(page.buffers.alive, first * 4, page.active.subarray(first, first + count));
        page.dirtyMinimum = this.#pageSize;
        page.dirtyMaximum = -1;
        const uploaded = count * MATTER_GPU_PACKET_UPLOAD_BYTES_PER_SLOT;
        this.#metrics.uploadedBytes += uploaded;
        return uploaded;
    }

    encodeMaintenance(encoder, { pageId, deviceGeneration = this.#deviceGeneration } = {}) {
        this.#assertAlive();
        if (!encoder || typeof encoder.beginComputePass !== 'function') fail('$.encoder', 'must be a GPUCommandEncoder-like object');
        integer(deviceGeneration, '$.deviceGeneration');
        if (deviceGeneration !== this.#deviceGeneration) {
            throw new MatterGpuPacketArenaError('stale-device', 'Matter GPU arena device generation is stale', {
                expected: this.#deviceGeneration,
                actual: deviceGeneration,
            });
        }
        const pageIndex = integer(pageId, '$.pageId', { maximum: this.#pages.length - 1 });
        const page = this.#pages[pageIndex];
        if (!page) fail('$.pageId', 'does not name an allocated page');
        callLogger(this.#logger, 'matter-gpu-maintenance-start', { pageId: pageIndex });
        try {
            const uploadedBytes = this.#flushPage(page);
            const compactionReceipt = this.#compaction.encode(encoder, {
                flags: page.buffers.alive,
                values: page.buffers.slotIndices,
                output: page.buffers.activeSlots,
                count: this.#pageSize,
                countOutput: page.buffers.activeCount,
                generation: this.#deviceGeneration,
            });
            const bindGroup = this.#device.createBindGroup({
                label: `Matter page ${pageIndex} indirect bindings`,
                layout: this.#indirectPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: page.buffers.activeCount } },
                    { binding: 1, resource: { buffer: page.buffers.indirect } },
                ],
            });
            const pass = encoder.beginComputePass({ label: `Matter page ${pageIndex} indirect dispatch` });
            pass.setPipeline(this.#indirectPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(1);
            pass.end();
            this.#metrics.encodedMaintenances += 1;
            let settled = false;
            const receipt = Object.freeze({
                kind: 'matter-gpu-page-maintenance',
                pageId: pageIndex,
                deviceGeneration: this.#deviceGeneration,
                uploadedBytes,
                activeCount: page.active.reduce((sum, value) => sum + value, 0),
                activeSlotsBuffer: page.buffers.activeSlots,
                activeCountBuffer: page.buffers.activeCount,
                indirectBuffer: page.buffers.indirect,
                release() {
                    if (settled) return false;
                    settled = true;
                    return compactionReceipt.release();
                },
                retire(completionPromise) {
                    if (settled) return Promise.resolve(false);
                    settled = true;
                    return compactionReceipt.retire(completionPromise);
                },
            });
            callLogger(this.#logger, 'matter-gpu-maintenance-encoded', {
                pageId: pageIndex,
                activeCount: receipt.activeCount,
                uploadedBytes,
            });
            return receipt;
        } catch (error) {
            callLogger(this.#logger, 'matter-gpu-maintenance-failed', { pageId: pageIndex, message: error.message });
            throw error;
        }
    }

    getPageResources(pageIdInput) {
        this.#assertAlive();
        const pageId = integer(pageIdInput, '$.pageId', { maximum: this.#pages.length - 1 });
        const page = this.#pages[pageId];
        if (!page) fail('$.pageId', 'does not name an allocated page');
        return Object.freeze({ pageId, ...page.buffers });
    }

    get activeCount() {
        return this.#pages.reduce((sum, page) => sum + page.active.reduce((pageSum, value) => pageSum + value, 0), 0);
    }

    snapshot() {
        this.#assertAlive();
        return deepFreezeJson({
            schema: MATTER_GPU_PACKET_ARENA_SCHEMA,
            schemaVersion: MATTER_GPU_PACKET_ARENA_VERSION,
            pageSize: this.#pageSize,
            maxPages: this.#maxPages,
            deviceGeneration: this.#deviceGeneration,
            pages: this.#pages.map(page => ({
                pageId: page.pageId,
                generations: [...page.generations],
                active: [...page.active],
                records: page.records.map(record => record == null ? null : cloneStrictJson(record)),
            })),
            metrics: cloneStrictJson(this.#metrics),
        }, '$.matterGpuPacketArenaSnapshot');
    }

    restore(snapshotInput) {
        this.#assertAlive();
        callLogger(this.#logger, 'matter-gpu-restore-start');
        const snapshot = validateMatterGpuPacketArenaSnapshot(snapshotInput);
        if (snapshot.pageSize !== this.#pageSize || snapshot.maxPages !== this.#maxPages) {
            fail('$.matterGpuPacketArenaSnapshot', 'capacity does not match this arena');
        }
        if (snapshot.deviceGeneration !== this.#deviceGeneration) {
            fail('$.matterGpuPacketArenaSnapshot.deviceGeneration', 'does not match the live device generation');
        }
        const candidates = [];
        try {
            for (const pageSnapshot of snapshot.pages) {
                const page = createCpuPage(pageSnapshot.pageId, this.#pageSize);
                page.generations.set(pageSnapshot.generations);
                page.active.set(pageSnapshot.active);
                page.freeSlots.length = 0;
                for (let slot = 0; slot < this.#pageSize; slot += 1) {
                    const record = pageSnapshot.records[slot];
                    if (page.active[slot] === 1) {
                        writeRecord(page, slot, record);
                    } else {
                        page.freeSlots.push(slot);
                    }
                }
                page.buffers = createGpuBuffers(this.#device, page, this.#pageSize);
                candidates.push(page);
            }
        } catch (error) {
            for (const page of candidates) destroyGpuBuffers(page.buffers);
            callLogger(this.#logger, 'matter-gpu-restore-failed', { message: error.message });
            throw error;
        }
        for (const page of this.#pages) destroyGpuBuffers(page.buffers);
        this.#pages = candidates;
        this.#deviceGeneration = snapshot.deviceGeneration;
        this.#metrics = cloneStrictJson(snapshot.metrics);
        callLogger(this.#logger, 'matter-gpu-restored', { pages: candidates.length, activeCount: this.activeCount });
        return this;
    }

    async prepareDevice(device, { nextGeneration, snapshot } = {}) {
        this.#assertAlive();
        const generation = integer(nextGeneration, '$.nextGeneration');
        if (generation <= this.#deviceGeneration) fail('$.nextGeneration', 'must advance');
        const source = validateMatterGpuPacketArenaSnapshot(snapshot ?? this.snapshot());
        const migrated = cloneStrictJson(source);
        migrated.deviceGeneration = generation;
        const candidate = new MatterGpuPacketArena(device, {
            pageSize: this.#pageSize,
            maxPages: this.#maxPages,
            deviceGeneration: generation,
            logger: this.#logger,
        });
        candidate.restore(migrated);
        let state = 'prepared';
        let previous = null;
        return Object.freeze({
            commit: async () => {
                if (state !== 'prepared') return false;
                previous = {
                    device: this.#device,
                    pages: this.#pages,
                    compaction: this.#compaction,
                    indirectPipeline: this.#indirectPipeline,
                    deviceGeneration: this.#deviceGeneration,
                    metrics: this.#metrics,
                };
                this.#device = candidate.#device;
                this.#pages = candidate.#pages;
                this.#compaction = candidate.#compaction;
                this.#indirectPipeline = candidate.#indirectPipeline;
                this.#deviceGeneration = generation;
                this.#metrics = { ...candidate.#metrics, deviceRecreations: candidate.#metrics.deviceRecreations + 1 };
                candidate.#pages = [];
                candidate.#destroyed = true;
                state = 'committed';
                callLogger(this.#logger, 'matter-gpu-device-recreated', { deviceGeneration: generation });
                return true;
            },
            rollback: async () => {
                if (state !== 'committed' || !previous) return false;
                const rejectedPages = this.#pages;
                const rejectedCompaction = this.#compaction;
                this.#device = previous.device;
                this.#pages = previous.pages;
                this.#compaction = previous.compaction;
                this.#indirectPipeline = previous.indirectPipeline;
                this.#deviceGeneration = previous.deviceGeneration;
                this.#metrics = previous.metrics;
                for (const page of rejectedPages) destroyGpuBuffers(page.buffers);
                rejectedCompaction.destroy();
                previous = null;
                state = 'rolled-back';
                callLogger(this.#logger, 'matter-gpu-device-recreation-rolled-back', {
                    deviceGeneration: this.#deviceGeneration,
                });
                return true;
            },
            finalize: async () => {
                if (state !== 'committed' || !previous) return false;
                for (const page of previous.pages) destroyGpuBuffers(page.buffers);
                previous.compaction.destroy();
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
        const allocatedSlotCapacity = this.#pages.length * this.#pageSize;
        return cloneAndFreezeStrictJson({
            ...this.#metrics,
            pageSize: this.#pageSize,
            maxPages: this.#maxPages,
            allocatedPages: this.#pages.length,
            allocatedSlotCapacity,
            maximumSlotCapacity: this.#pageSize * this.#maxPages,
            activePackets: this.activeCount,
            freeSlots: allocatedSlotCapacity - this.activeCount,
            unallocatedSlots: (this.#maxPages - this.#pages.length) * this.#pageSize,
            estimatedGpuBytes: this.#pages.length * (
                this.#pageSize * MATTER_GPU_PACKET_PAGE_BYTES_PER_SLOT
                + MATTER_GPU_PACKET_PAGE_FIXED_BYTES
            ),
            deviceGeneration: this.#deviceGeneration,
            destroyed: this.#destroyed,
        }, '$.matterGpuPacketArenaStats');
    }

    destroy() {
        if (this.#destroyed) return;
        callLogger(this.#logger, 'matter-gpu-arena-destroy-start', { pages: this.#pages.length });
        for (const page of this.#pages) destroyGpuBuffers(page.buffers);
        this.#pages = [];
        this.#compaction.destroy();
        this.#destroyed = true;
        callLogger(this.#logger, 'matter-gpu-arena-destroyed');
    }
}

export function validateMatterGpuPacketArenaSnapshot(snapshotInput) {
    const snapshot = cloneStrictJson(snapshotInput, '$.matterGpuPacketArenaSnapshot');
    exactObject(snapshot, SNAPSHOT_KEYS, '$.matterGpuPacketArenaSnapshot');
    for (const key of SNAPSHOT_KEYS) if (!Object.hasOwn(snapshot, key)) fail(`$.matterGpuPacketArenaSnapshot.${key}`, 'is required');
    if (snapshot.schema !== MATTER_GPU_PACKET_ARENA_SCHEMA
        || snapshot.schemaVersion !== MATTER_GPU_PACKET_ARENA_VERSION) {
        fail('$.matterGpuPacketArenaSnapshot', 'uses an unsupported schema');
    }
    const pageSize = integer(snapshot.pageSize, '$.matterGpuPacketArenaSnapshot.pageSize', { minimum: 1, maximum: 1_048_576 });
    const maxPages = integer(snapshot.maxPages, '$.matterGpuPacketArenaSnapshot.maxPages', { minimum: 1, maximum: 65_536 });
    integer(snapshot.deviceGeneration, '$.matterGpuPacketArenaSnapshot.deviceGeneration');
    if (!Array.isArray(snapshot.pages) || snapshot.pages.length > maxPages) fail('$.matterGpuPacketArenaSnapshot.pages', 'exceeds maxPages');
    for (const [pageIndex, page] of snapshot.pages.entries()) {
        const path = `$.matterGpuPacketArenaSnapshot.pages[${pageIndex}]`;
        exactObject(page, PAGE_KEYS, path);
        if (page.pageId !== pageIndex) fail(`${path}.pageId`, 'must equal its deterministic page index');
        if (!Array.isArray(page.generations) || page.generations.length !== pageSize) fail(`${path}.generations`, 'has wrong length');
        if (!Array.isArray(page.active) || page.active.length !== pageSize) fail(`${path}.active`, 'has wrong length');
        if (!Array.isArray(page.records) || page.records.length !== pageSize) fail(`${path}.records`, 'has wrong length');
        for (let slot = 0; slot < pageSize; slot += 1) {
            integer(page.generations[slot], `${path}.generations[${slot}]`, { minimum: 1, maximum: 0xffffffff });
            if (page.active[slot] !== 0 && page.active[slot] !== 1) fail(`${path}.active[${slot}]`, 'must be 0 or 1');
            if (page.active[slot] === 1) page.records[slot] = normalizeRecord(page.records[slot], `${path}.records[${slot}]`);
            else if (page.records[slot] !== null) fail(`${path}.records[${slot}]`, 'must be null while inactive');
        }
    }
    const metricKeys = new Set([
        'allocations', 'releases', 'updates', 'allocationFailures', 'encodedMaintenances',
        'uploadedBytes', 'highWaterMark', 'deviceRecreations',
    ]);
    exactObject(snapshot.metrics, metricKeys, '$.matterGpuPacketArenaSnapshot.metrics');
    for (const key of metricKeys) integer(snapshot.metrics[key], `$.matterGpuPacketArenaSnapshot.metrics.${key}`);
    const maximumSlotCapacity = pageSize * maxPages;
    if (snapshot.metrics.highWaterMark > maximumSlotCapacity) {
        fail('$.matterGpuPacketArenaSnapshot.metrics.highWaterMark', 'exceeds arena capacity');
    }
    const activeCount = snapshot.pages.reduce(
        (total, page) => total + page.active.reduce((pageTotal, value) => pageTotal + value, 0),
        0,
    );
    if (snapshot.metrics.highWaterMark < activeCount) {
        fail('$.matterGpuPacketArenaSnapshot.metrics.highWaterMark', 'cannot be below the active packet count');
    }
    return deepFreezeJson(snapshot, '$.matterGpuPacketArenaSnapshot');
}

export function createMatterGpuPacketArena(device, options = {}) {
    return new MatterGpuPacketArena(device, options);
}

export default MatterGpuPacketArena;
