// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * VirtualGPU - Unified GPU abstraction layer

 *

 * Provides a clean API over WebGPU with automatic:

 * - Buffer pooling and lifecycle management

 * - Bind group layout caching and deduplication

 * - Pipeline caching with async compilation

 * - Shader compilation and variant management

 * - Resource tracking and debug labels

 * - Command batching and scheduling

 *

 * Usage:

 *   const vgpu = await VirtualGPU.create();

 *   const buffer = vgpu.buffer.create({ size: 1024, usage: 'vertex' });

 *   const layout = vgpu.bindings.defineLayout('material', [...]);

 *   const pipeline = vgpu.pipeline.render({ vertex, fragment, ... });

 */



import { GpuDevice } from './GpuDevice.js';

import { BufferPool } from './BufferPool.js';

import { DEFAULT_COLOR_FORMAT, DEFAULT_DEPTH_FORMAT } from './GpuFormats.js';

import { GPUTimestampProfiler } from './GPUTimestampProfiler.js';
import { assertCheckedShaderModule, createCheckedShaderModule } from './GpuShaderDiagnostics.js';

import { AsyncComputeScheduler } from './AsyncComputeScheduler.js';

import { RingBuffer, GPUMemoryManager } from '../memory/GPUMemoryManager.js';



// New vGPU enhancement modules

import { VGPUReadbackQueue } from './VGPUReadbackQueue.js';

import { WGSLPreprocessor, createPreprocessor } from './WGSLPreprocessor.js';

import { VGPUComputeUtils } from './VGPUComputeUtils.js';

import { VGPUTextureAtlas, VGPUSpriteBatch } from './VGPUTextureAtlas.js';

import { VGPUMemoryTracker } from './VGPUMemoryTracker.js';

import { VGPUShaderReflection, getShaderReflection } from './VGPUShaderReflection.js';

import { VGPUBindGroupManager } from './VGPUBindGroupManager.js';

import { VGPUResourceBarriers } from './VGPUResourceBarriers.js';

import { VGPUQualityScaler, VGPUDynamicViewport } from './VGPUQualityScaler.js';

import { VGPURenderStats, VGPUStatsOverlay } from './VGPURenderStats.js';

import { VGPUBindless } from './VGPUBindless.js';

import { VGPUMultiQueue } from './VGPUMultiQueue.js';

import { VGPUTimelineSemaphores } from './VGPUTimelineSemaphores.js';



// Advanced rendering modules

import { VGPURenderGraph, RenderGraphBuilder } from './VGPURenderGraph.js';

import { VGPUIndirectRenderer, IndirectInstanceBuilder } from './VGPUIndirectRenderer.js';

import { VGPUHiZCulling, BoundingBoxBuilder } from './VGPUHiZCulling.js';

import {
    DEFAULT_STREAMING_MAX_CONCURRENT_LOADS,
    DEFAULT_STREAMING_MEMORY_BUDGET,
    VGPUStreamingManager,
} from './VGPUStreamingManager.js';

import { VGPUDebugDraw, DebugDrawScope } from './VGPUDebugDraw.js';

const VGPU_REGISTRY = new WeakMap();
const VGPU_CORE_AUTHORITIES = new WeakMap();
const VGPU_OPERATION_STATES = new WeakMap();
const VGPU_PRIVATE_CONTAINERS = new WeakMap();
const VGPU_CORE_MANAGER_STATES = new WeakMap();
const VGPU_FACADE_STATES = new WeakMap();
const VGPU_REGISTRY_RECORD_STATES = new WeakMap();
const VGPU_OWNER_SCOPE_STATES = new WeakMap();
const VGPU_RING_FACADE_STATES = new WeakMap();
const VGPU_QUERY_POOL_STATES = new WeakMap();
const VGPU_CREATE_PROVENANCE = Symbol('VGPU_CREATE_PROVENANCE');
const VGPU_NORMALIZED_DEVICE_INPUTS = new WeakSet();
const VGPU_NATIVE_PROMISE = Promise;
const VGPU_NATIVE_SET = Set;
const VGPU_NATIVE_MAP = Map;
const VGPU_NATIVE_WEAK_MAP = WeakMap;
const VGPU_NATIVE_WEAK_SET = WeakSet;
const VGPU_NATIVE_PROMISE_RESOLVE = VGPU_NATIVE_PROMISE.resolve;
const VGPU_NATIVE_PROMISE_REJECT = VGPU_NATIVE_PROMISE.reject;
const VGPU_NATIVE_PROMISE_THEN = VGPU_NATIVE_PROMISE.prototype.then;
const VGPU_SET_ADD = Set.prototype.add;
const VGPU_SET_DELETE = Set.prototype.delete;
const VGPU_SET_CLEAR = Set.prototype.clear;
const VGPU_SET_HAS = Set.prototype.has;
const VGPU_SET_VALUES = Set.prototype.values;
const VGPU_SET_ITERATOR_NEXT = Object.getPrototypeOf(new Set().values()).next;
const VGPU_MAP_SET = Map.prototype.set;
const VGPU_MAP_GET = Map.prototype.get;
const VGPU_MAP_DELETE = Map.prototype.delete;
const VGPU_MAP_CLEAR = Map.prototype.clear;
const VGPU_MAP_HAS = Map.prototype.has;
const VGPU_MAP_VALUES = Map.prototype.values;
const VGPU_MAP_ENTRIES = Map.prototype.entries;
const VGPU_MAP_ITERATOR_NEXT = Object.getPrototypeOf(new Map().values()).next;
const VGPU_WEAK_MAP_SET = WeakMap.prototype.set;
const VGPU_WEAK_MAP_GET = WeakMap.prototype.get;
const VGPU_WEAK_MAP_DELETE = WeakMap.prototype.delete;
const VGPU_WEAK_MAP_HAS = WeakMap.prototype.has;
const VGPU_WEAK_SET_ADD = WeakSet.prototype.add;
const VGPU_WEAK_SET_HAS = WeakSet.prototype.has;
const VGPU_WEAK_SET_DELETE = WeakSet.prototype.delete;
const VGPU_ARRAY_PUSH = Array.prototype.push;
const VGPU_QUEUE_MICROTASK = globalThis.queueMicrotask;
let realmGeneration = 0;
let registryRecordId = 0;
let ownerScopeId = 0;

function resolveVgpuPromise(value) {
    return Reflect.apply(VGPU_NATIVE_PROMISE_RESOLVE, VGPU_NATIVE_PROMISE, [value]);
}

function rejectVgpuPromise(error) {
    const promise = Reflect.apply(VGPU_NATIVE_PROMISE_REJECT, VGPU_NATIVE_PROMISE, [error]);
    silenceVgpuPromise(promise);
    return promise;
}

function thenVgpuPromise(promise, onFulfilled, onRejected) {
    return Reflect.apply(VGPU_NATIVE_PROMISE_THEN, promise, [onFulfilled, onRejected]);
}

function raceVgpuPromises(values) {
    return new VGPU_NATIVE_PROMISE((resolve, reject) => {
        for (let index = 0; index < values.length; index++) {
            thenVgpuPromise(resolveVgpuPromise(values[index]), resolve, reject);
        }
    });
}

function allVgpuPromises(values) {
    return new VGPU_NATIVE_PROMISE((resolve, reject) => {
        const length = values.length;
        if (length === 0) {
            resolve([]);
            return;
        }
        const results = new Array(length);
        let remaining = length;
        for (let index = 0; index < length; index++) {
            thenVgpuPromise(resolveVgpuPromise(values[index]), value => {
                results[index] = value;
                remaining--;
                if (remaining === 0) resolve(results);
            }, reject);
        }
    });
}

function silenceVgpuPromise(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
    try { thenVgpuPromise(resolveVgpuPromise(value), () => {}, () => {}); } catch (_) {}
}

function installVgpuSettlementAuthorities(record, resolve, reject = null) {
    const resolveAuthority = Object.freeze({ receiver: undefined, callable: resolve });
    const rejectAuthority = typeof reject === 'function'
        ? Object.freeze({ receiver: undefined, callable: reject })
        : null;
    const identity = Object.freeze({
        backendKey: record.backendKey,
        descriptorKey: record.descriptorKey,
        descriptor: record.descriptor,
        engineProfiler: record.engineProfiler,
        epoch: record.epoch,
        generation: record.generation,
        key: record.key,
        kind: record.kind,
        label: record.label,
        owner: record.owner,
        ownerGeneration: record.ownerGeneration,
        pendingKey: record.pendingKey,
        pool: record.pool,
        poolName: record.poolName,
        request: record.request,
        resultBuffer: record.resultBuffer,
        snapshot: record.snapshot,
        slot: record.slot,
    });
    const state = {
        callableAuthorities: Object.create(null),
        cancelled: false,
        factoryAuthorities: record.factoryAuthorities || null,
        identity,
        lifecycleAuthorities: record.lifecycleAuthorities || null,
        promise: record.promise,
        rejectAuthority,
        resolveAuthority,
        settled: false,
        values: Object.create(null),
    };
    Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_OPERATION_STATES, [record, state]);
    const lifecycleMirrors = {
        settled: {
            configurable: false,
            enumerable: true,
            get: () => state.settled,
            set: () => {},
        },
    };
    if ('cancelled' in record) lifecycleMirrors.cancelled = {
        configurable: false,
        enumerable: true,
        get: () => state.cancelled,
        set: () => {},
    };
    Object.defineProperties(record, lifecycleMirrors);
    record.resolve = null;
    record.reject = null;
    if ('lifecycleAuthorities' in record) record.lifecycleAuthorities = null;
    if ('factoryAuthorities' in record) record.factoryAuthorities = null;
    return record;
}

function installVgpuOperationCallableAuthority(record, property, callable) {
    const authority = Object.freeze({ receiver: undefined, callable });
    const state = Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_OPERATION_STATES, [record]);
    if (!state) throw new TypeError('[vGPU] Operation state is unavailable');
    state.callableAuthorities[property] = authority;
    if (property === '_cancelWaitAuthority' && 'cancelWait' in record) {
        record.cancelWait = null;
    }
    return authority;
}

function getVgpuOperationState(record) {
    return record && Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_OPERATION_STATES, [record]) || null;
}

function getVgpuOperationIdentity(record, property) {
    return getVgpuOperationState(record)?.identity[property];
}

function getVgpuOperationLifecycleAuthorities(record) {
    return getVgpuOperationState(record)?.lifecycleAuthorities || null;
}

function invokeVgpuOperationLifecycleAuthority(record, name, args = []) {
    const authority = getVgpuOperationLifecycleAuthorities(record)?.[name];
    if (!authority || typeof authority.callable !== 'function') {
        throw new TypeError(`[vGPU] Operation lifecycle authority ${name} is unavailable`);
    }
    return Reflect.apply(authority.callable, authority.receiver, args);
}

function getVgpuOperationFactoryAuthorities(record) {
    return getVgpuOperationState(record)?.factoryAuthorities || null;
}

function getVgpuOperationCallableAuthority(record, property) {
    return getVgpuOperationState(record)?.callableAuthorities[property] || null;
}

function setVgpuOperationPrivateValue(record, property, value) {
    const state = getVgpuOperationState(record);
    if (!state) return false;
    state.values[property] = value;
    const redacted = property === 'candidateCleanup'
        || property === 'controller'
        || property === 'controllerAbort'
        || property === 'controllerSignal'
        || property === 'getMappedRange'
        || property === 'initializeAuthority'
        || property === 'mapAsync'
        || property === 'passTimingSet'
        || property === 'pipelineCache'
        || property === 'stagingCleanup'
        || property === 'unmap';
    if (!redacted) {
        try { record[property] = value; } catch (_) {}
    }
    return true;
}

function getVgpuOperationPrivateValue(record, property) {
    return getVgpuOperationState(record)?.values[property];
}

function getVgpuOperationPromise(record) {
    return getVgpuOperationState(record)?.promise || null;
}

function isVgpuOperationSettled(record) {
    const state = getVgpuOperationState(record);
    return !state || state.settled;
}

function isVgpuOperationCancelled(record) {
    const state = getVgpuOperationState(record);
    return !state || state.cancelled;
}

function cancelVgpuOperation(record) {
    const state = getVgpuOperationState(record);
    if (!state) return null;
    state.cancelled = true;
    return state;
}

function claimVgpuOperationSettlement(record) {
    const state = getVgpuOperationState(record);
    if (!state || state.settled) return null;
    state.settled = true;
    return state;
}

function forceVgpuOperationSettlement(record) {
    const state = getVgpuOperationState(record);
    if (!state) return null;
    state.settled = true;
    return state;
}

function invokeVgpuSettlementAuthority(record, rejected, value) {
    const state = getVgpuOperationState(record);
    const authority = rejected ? state?.rejectAuthority : state?.resolveAuthority;
    if (!authority || typeof authority.callable !== 'function') return false;
    Reflect.apply(authority.callable, authority.receiver, [value]);
    return true;
}

function installVgpuPrivateContainer(owner, name, container, mirrorValue = null) {
    let containers = Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_PRIVATE_CONTAINERS, [owner]);
    if (!containers) {
        containers = Object.create(null);
        Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_PRIVATE_CONTAINERS, [owner, containers]);
    }
    containers[name] = Object.freeze({
        authoritative: container,
        mirror: owner[name],
        mirrorValue,
        weak: container instanceof VGPU_NATIVE_WEAK_MAP,
    });
    return container;
}

function getVgpuPrivateContainer(owner, name) {
    const container = Reflect.apply(
        VGPU_WEAK_MAP_GET, VGPU_PRIVATE_CONTAINERS, [owner],
    )?.[name]?.authoritative;
    if (!container) throw new TypeError(`[vGPU] Private ${name} container is unavailable`);
    return container;
}

function mirrorVgpuContainerMutation(owner, name, method, args = []) {
    const entry = Reflect.apply(
        VGPU_WEAK_MAP_GET, VGPU_PRIVATE_CONTAINERS, [owner],
    )?.[name];
    if (!entry) return;
    const mirror = entry.mirror;
    if (!mirror || mirror === entry.authoritative) return;
    try {
        let callable = null;
        if (entry.weak) {
            if (method === 'set') callable = VGPU_WEAK_MAP_SET;
            else if (method === 'delete') callable = VGPU_WEAK_MAP_DELETE;
        } else if (entry.authoritative instanceof VGPU_NATIVE_SET) {
            if (method === 'add') callable = VGPU_SET_ADD;
            else if (method === 'delete') callable = VGPU_SET_DELETE;
            else if (method === 'clear') callable = VGPU_SET_CLEAR;
        } else {
            if (method === 'set') callable = VGPU_MAP_SET;
            else if (method === 'delete') callable = VGPU_MAP_DELETE;
            else if (method === 'clear') callable = VGPU_MAP_CLEAR;
        }
        const mirrorArgs = method === 'set' && typeof entry.mirrorValue === 'function'
            ? [args[0], Reflect.apply(entry.mirrorValue, undefined, [args[1]])]
            : args;
        if (callable) Reflect.apply(callable, mirror, mirrorArgs);
    } catch (_) {}
}

function addVgpuPrivateSetEntry(owner, name, value) {
    const container = getVgpuPrivateContainer(owner, name);
    Reflect.apply(VGPU_SET_ADD, container, [value]);
    mirrorVgpuContainerMutation(owner, name, 'add', [value]);
    return value;
}

function deleteVgpuPrivateSetEntry(owner, name, value) {
    const removed = Reflect.apply(
        VGPU_SET_DELETE, getVgpuPrivateContainer(owner, name), [value],
    );
    mirrorVgpuContainerMutation(owner, name, 'delete', [value]);
    return removed;
}

function clearVgpuPrivateSet(owner, name) {
    Reflect.apply(VGPU_SET_CLEAR, getVgpuPrivateContainer(owner, name), []);
    mirrorVgpuContainerMutation(owner, name, 'clear');
}

function setVgpuPrivateMapEntry(owner, name, key, value) {
    const container = getVgpuPrivateContainer(owner, name);
    const setter = container instanceof VGPU_NATIVE_WEAK_MAP ? VGPU_WEAK_MAP_SET : VGPU_MAP_SET;
    Reflect.apply(setter, container, [key, value]);
    mirrorVgpuContainerMutation(owner, name, 'set', [key, value]);
    return value;
}

function deleteVgpuPrivateMapEntry(owner, name, key) {
    const container = getVgpuPrivateContainer(owner, name);
    const deleter = container instanceof VGPU_NATIVE_WEAK_MAP ? VGPU_WEAK_MAP_DELETE : VGPU_MAP_DELETE;
    const removed = Reflect.apply(deleter, container, [key]);
    mirrorVgpuContainerMutation(owner, name, 'delete', [key]);
    return removed;
}

function clearVgpuPrivateMap(owner, name) {
    Reflect.apply(VGPU_MAP_CLEAR, getVgpuPrivateContainer(owner, name), []);
    mirrorVgpuContainerMutation(owner, name, 'clear');
}

function getVgpuPrivateMapEntry(owner, name, key) {
    const container = getVgpuPrivateContainer(owner, name);
    const getter = container instanceof VGPU_NATIVE_WEAK_MAP ? VGPU_WEAK_MAP_GET : VGPU_MAP_GET;
    return Reflect.apply(getter, container, [key]);
}

function hasVgpuPrivateMapEntry(owner, name, key) {
    const container = getVgpuPrivateContainer(owner, name);
    const has = container instanceof VGPU_NATIVE_WEAK_MAP ? VGPU_WEAK_MAP_HAS : VGPU_MAP_HAS;
    return Reflect.apply(has, container, [key]);
}

function hasVgpuPrivateSetEntry(owner, name, value) {
    return Reflect.apply(VGPU_SET_HAS, getVgpuPrivateContainer(owner, name), [value]);
}

function snapshotVgpuPrivateSet(owner, name) {
    const iterator = Reflect.apply(VGPU_SET_VALUES, getVgpuPrivateContainer(owner, name), []);
    const values = [];
    while (true) {
        const step = Reflect.apply(VGPU_SET_ITERATOR_NEXT, iterator, []);
        if (step.done) return values;
        values.push(step.value);
    }
}

function snapshotVgpuPrivateMapValues(owner, name) {
    const iterator = Reflect.apply(VGPU_MAP_VALUES, getVgpuPrivateContainer(owner, name), []);
    const values = [];
    while (true) {
        const step = Reflect.apply(VGPU_MAP_ITERATOR_NEXT, iterator, []);
        if (step.done) return values;
        values.push(step.value);
    }
}

function snapshotVgpuPrivateMapEntries(owner, name) {
    const iterator = Reflect.apply(VGPU_MAP_ENTRIES, getVgpuPrivateContainer(owner, name), []);
    const entries = [];
    while (true) {
        const step = Reflect.apply(VGPU_MAP_ITERATOR_NEXT, iterator, []);
        if (step.done) return entries;
        entries.push(step.value);
    }
}

function queueVgpuMicrotask(callback) {
    if (typeof VGPU_QUEUE_MICROTASK !== 'function') {
        throw new TypeError('[vGPU] queueMicrotask is unavailable');
    }
    return Reflect.apply(VGPU_QUEUE_MICROTASK, globalThis, [callback]);
}

function initializeVgpuFacadeLifecycle(vgpu) {
    const state = {
        destroyed: false,
        destroyReason: null,
        factoryGeneration: 0,
        registryRecord: null,
    };
    Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_FACADE_STATES, [vgpu, state]);
    Object.defineProperties(vgpu, {
        _destroyed: {
            configurable: false,
            enumerable: false,
            get: () => state.destroyed,
            set: () => {},
        },
        _destroyReason: {
            configurable: false,
            enumerable: false,
            get: () => state.destroyReason,
            set: () => {},
        },
        _factoryGeneration: {
            configurable: false,
            enumerable: false,
            get: () => state.factoryGeneration,
            set: () => {},
        },
        _registryRecord: {
            configurable: false,
            enumerable: false,
            get: () => state.registryRecord,
            set: () => {},
        },
    });
    return state;
}

function getVgpuFacadeLifecycleState(vgpu) {
    return Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_FACADE_STATES, [vgpu]) || null;
}

function getVgpuRegistryRecord(rawDevice) {
    return rawDevice
        ? Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_REGISTRY, [rawDevice]) || null
        : null;
}

function getVgpuRegistryRecordState(record) {
    return record
        ? Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_REGISTRY_RECORD_STATES, [record]) || null
        : null;
}

function snapshotVgpuFacadeAuthority(vgpu) {
    if (!vgpu) return null;
    const facadeState = getVgpuFacadeLifecycleState(vgpu);
    const record = facadeState?.registryRecord || null;
    const recordState = getVgpuRegistryRecordState(record);
    const coreAuthorities = Reflect.apply(
        VGPU_WEAK_MAP_GET, VGPU_CORE_AUTHORITIES, [vgpu],
    ) || null;
    if (!facadeState
        || facadeState.destroyed
        || !recordState
        || recordState.active !== true
        || recordState.vgpu !== vgpu
        || getVgpuRegistryRecord(recordState.rawDevice) !== record
        || !coreAuthorities
        || coreAuthorities.rawDevice !== recordState.rawDevice) {
        return null;
    }
    return Object.freeze({
        vgpu,
        facadeState,
        record,
        recordState,
        coreAuthorities,
        rawDevice: recordState.rawDevice,
    });
}

function invalidateVgpuRegistryRecord(record, reason, info = null) {
    const state = getVgpuRegistryRecordState(record);
    return state?.active && typeof state.invalidate === 'function'
        ? Reflect.apply(state.invalidate, undefined, [reason, info])
        : false;
}

function deleteVgpuRegistryRecord(rawDevice) {
    return rawDevice
        ? Reflect.apply(VGPU_WEAK_MAP_DELETE, VGPU_REGISTRY, [rawDevice])
        : false;
}

function setVgpuFacadeRegistryRecord(vgpu, record) {
    const state = getVgpuFacadeLifecycleState(vgpu);
    if (!state) throw new TypeError('[vGPU] Facade lifecycle state is unavailable');
    state.registryRecord = record;
    return record;
}

function invalidateVgpuFacadeLifecycle(vgpu, reason) {
    const state = getVgpuFacadeLifecycleState(vgpu);
    if (!state || state.destroyed) return false;
    state.destroyed = true;
    state.destroyReason = reason;
    state.factoryGeneration++;
    return true;
}

function stableDescriptorKey(value, seen = new VGPU_NATIVE_WEAK_SET()) {
    if (value === null) return 'null';
    const valueType = typeof value;
    if (valueType === 'undefined') return 'undefined';
    if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') return `${valueType}:${value}`;
    if (valueType === 'string') return `string:${JSON.stringify(value)}`;
    if (valueType !== 'object') return `${valueType}:${String(value)}`;
    if (Reflect.apply(VGPU_WEAK_SET_HAS, seen, [value])) return '[circular]';
    Reflect.apply(VGPU_WEAK_SET_ADD, seen, [value]);
    if (Array.isArray(value)) {
        const key = `[${value.map(item => stableDescriptorKey(item, seen)).join(',')}]`;
        Reflect.apply(VGPU_WEAK_SET_DELETE, seen, [value]);
        return key;
    }
    const key = `{${Object.keys(value).sort().map(name => (
        `${JSON.stringify(name)}:${stableDescriptorKey(value[name], seen)}`
    )).join(',')}}`;
    Reflect.apply(VGPU_WEAK_SET_DELETE, seen, [value]);
    return key;
}



function captureVgpuPropertySlot(receiver, key) {
    let cursor = receiver;
    const visited = new VGPU_NATIVE_SET();
    while (cursor && !Reflect.apply(VGPU_SET_HAS, visited, [cursor])) {
        Reflect.apply(VGPU_SET_ADD, visited, [cursor]);
        const descriptor = Reflect.getOwnPropertyDescriptor(cursor, key);
        if (descriptor) {
            return Object.freeze({
                receiver,
                descriptor: Object.freeze({ ...descriptor }),
            });
        }
        cursor = Reflect.getPrototypeOf(cursor);
    }
    return Object.freeze({ receiver, descriptor: null });
}

function readVgpuPropertySlot(slot) {
    const descriptor = slot.descriptor;
    if (!descriptor) return undefined;
    return 'value' in descriptor
        ? descriptor.value
        : (typeof descriptor.get === 'function'
            ? Reflect.apply(descriptor.get, slot.receiver, [])
            : undefined);
}

function snapshotVgpuProperties(receiver, keys) {
    if (!receiver) return Object.freeze({});
    const slots = {};
    for (const key of keys) slots[key] = captureVgpuPropertySlot(receiver, key);
    const values = {};
    for (const key of keys) values[key] = readVgpuPropertySlot(slots[key]);
    return Object.freeze(values);
}

function captureVgpuCallable(receiver, key) {
    if (!receiver) return null;
    const callable = readVgpuPropertySlot(captureVgpuPropertySlot(receiver, key));
    return typeof callable === 'function'
        ? Object.freeze({ receiver, callable })
        : null;
}

function captureVgpuCallableSet(specifications, assertCurrent = null) {
    if (assertCurrent) assertCurrent();
    const staged = specifications.map(specification => {
        let slot;
        try {
            slot = captureVgpuPropertySlot(
                specification.lookupReceiver || specification.receiver,
                specification.key,
            );
        }
        finally { if (assertCurrent) assertCurrent(); }
        return Object.freeze({ ...specification, slot });
    });
    const authorities = {};
    for (const specification of staged) {
        let callable;
        try { callable = readVgpuPropertySlot(specification.slot); }
        finally { if (assertCurrent) assertCurrent(); }
        if (typeof callable !== 'function') {
            if (specification.optional) {
                authorities[specification.name] = null;
                continue;
            }
            throw new TypeError(
                `[vGPU] ${specification.operation || String(specification.key)} is unavailable`,
            );
        }
        authorities[specification.name] = Object.freeze({
            receiver: specification.receiver,
            callable,
        });
    }
    return Object.freeze(authorities);
}

function captureVgpuCleanupCallableSet(specifications) {
    const staged = specifications.map(specification => {
        let slot = null;
        try {
            slot = captureVgpuPropertySlot(
                specification.lookupReceiver || specification.receiver,
                specification.key,
            );
        } catch (_) {}
        return Object.freeze({ ...specification, slot });
    });
    const authorities = {};
    for (const specification of staged) {
        let callable = null;
        try { callable = specification.slot ? readVgpuPropertySlot(specification.slot) : null; }
        catch (_) {}
        authorities[specification.name] = typeof callable === 'function'
            ? Object.freeze({ receiver: specification.receiver, callable })
            : null;
    }
    return Object.freeze(authorities);
}



function snapshotGpuDeviceInput(deviceOrOptions) {
    if (deviceOrOptions instanceof VirtualGPU) {
        return Object.freeze({
            rawDevice: deviceOrOptions.device,
            normalized: deviceOrOptions.gpuDevice,
        });
    }
    const isObject = Boolean(deviceOrOptions)
        && (typeof deviceOrOptions === 'object' || typeof deviceOrOptions === 'function');
    const source = isObject ? deviceOrOptions : null;
    const values = {};
    const sourceKeys = [
        'getDevice', 'device', 'queue', 'adapter', 'limits', 'features',
        'generation', 'capabilities', 'onDeviceLost', 'removeDeviceLostHandler', 'lost',
    ];
    const sourceSlots = {};
    let sourceLostThen = null;
    if (source) {
        for (const key of sourceKeys) sourceSlots[key] = captureVgpuPropertySlot(source, key);
        const lostDescriptor = sourceSlots.lost.descriptor;
        if (lostDescriptor && 'value' in lostDescriptor && lostDescriptor.value) {
            sourceLostThen = readVgpuPropertySlot(
                captureVgpuPropertySlot(lostDescriptor.value, 'then'),
            );
        }
        values.lost = readVgpuPropertySlot(sourceSlots.lost);
        if (sourceLostThen === null && values.lost) {
            sourceLostThen = readVgpuPropertySlot(captureVgpuPropertySlot(values.lost, 'then'));
        }
        for (const key of sourceKeys) {
            if (key !== 'lost') values[key] = readVgpuPropertySlot(sourceSlots[key]);
        }
    }
    const rawDevice = typeof values.getDevice === 'function'
        ? Reflect.apply(values.getDevice, source, [])
        : (values.device || deviceOrOptions || null);
    if (!rawDevice || (typeof rawDevice !== 'object' && typeof rawDevice !== 'function')) {
        return Object.freeze({ rawDevice: null, normalized: null });
    }
    const sourceIsRaw = source === rawDevice;
    const rawValues = {};
    let lostThen = sourceIsRaw ? sourceLostThen : null;
    if (sourceIsRaw) {
        for (const key of ['queue', 'limits', 'features', 'lost']) rawValues[key] = values[key];
    } else {
        const rawKeys = ['queue', 'limits', 'features', 'lost'];
        const rawSlots = {};
        for (const key of rawKeys) rawSlots[key] = captureVgpuPropertySlot(rawDevice, key);
        const lostDescriptor = rawSlots.lost.descriptor;
        if (lostDescriptor && 'value' in lostDescriptor && lostDescriptor.value) {
            lostThen = readVgpuPropertySlot(
                captureVgpuPropertySlot(lostDescriptor.value, 'then'),
            );
        }
        rawValues.lost = readVgpuPropertySlot(rawSlots.lost);
        if (lostThen === null && rawValues.lost) {
            lostThen = readVgpuPropertySlot(captureVgpuPropertySlot(rawValues.lost, 'then'));
        }
        for (const key of ['queue', 'limits', 'features']) {
            rawValues[key] = readVgpuPropertySlot(rawSlots[key]);
        }
    }
    return Object.freeze({
        rawDevice,
        normalized: null,
        source,
        wrapperMatches: values.device === rawDevice,
        values: Object.freeze(values),
        rawValues: Object.freeze(rawValues),
        lostThen,
    });
}

function rawDeviceFrom(deviceOrOptions) {
    return snapshotGpuDeviceInput(deviceOrOptions).rawDevice;
}

function normalizeGpuDeviceInput(deviceOrOptions, inputSnapshot = null) {
    if (deviceOrOptions && Reflect.apply(
        VGPU_WEAK_SET_HAS, VGPU_NORMALIZED_DEVICE_INPUTS, [deviceOrOptions],
    )) {
        return deviceOrOptions;
    }
    const snapshot = inputSnapshot || snapshotGpuDeviceInput(deviceOrOptions);
    if (snapshot.normalized) return snapshot.normalized;
    const {
        rawDevice, source, wrapperMatches, values, rawValues, lostThen,
    } = snapshot;
    if (!rawDevice) {
        throw new TypeError('[vGPU] A GPUDevice or GpuDevice wrapper is required');
    }
    const lostHandlers = new Set();
    let lossSettled = false;
    let lossInfo = null;
    const onLoss = info => {
        lossSettled = true;
        lossInfo = info;
        for (const handler of [...lostHandlers]) {
            try { handler(info); } catch (error) {
                try { console.error('[vGPU] Device loss handler failed:', error); } catch (_) {}
            }
        }
    };
    const onLossError = error => {
        try { console.error('[vGPU] GPUDevice lost promise rejected:', error); } catch (_) {}
    };
    const wrapperOnDeviceLost = wrapperMatches && typeof values.onDeviceLost === 'function'
        ? Object.freeze({ receiver: source, callable: values.onDeviceLost })
        : null;
    const wrapperRemoveDeviceLost = wrapperMatches
        && typeof values.removeDeviceLostHandler === 'function'
        ? Object.freeze({ receiver: source, callable: values.removeDeviceLostHandler })
        : null;
    if (!wrapperOnDeviceLost && rawValues.lost && typeof lostThen === 'function') {
        try { Reflect.apply(lostThen, rawValues.lost, [onLoss, onLossError]); }
        catch (error) { onLossError(error); }
    }
    const limits = (wrapperMatches ? values.limits : null) || rawValues.limits || {};
    const features = (wrapperMatches ? values.features : null) || rawValues.features || new Set();
    const normalized = {
        device: rawDevice,
        queue: (wrapperMatches ? values.queue : null) || rawValues.queue,
        adapter: (wrapperMatches ? values.adapter : null) || null,
        limits,
        features,
        generation: wrapperMatches ? values.generation : undefined,
        capabilities: (wrapperMatches ? values.capabilities : null) || {
            limits,
            features,
            defaultColorFormat: DEFAULT_COLOR_FORMAT,
            defaultDepthFormat: DEFAULT_DEPTH_FORMAT,
            defaultSampleCount: 1,
        },
        onDeviceLost(handler) {
            if (wrapperOnDeviceLost) {
                return Reflect.apply(
                    wrapperOnDeviceLost.callable, wrapperOnDeviceLost.receiver, [handler],
                );
            }
            if (typeof handler !== 'function') return () => {};
            if (lossSettled) {
                queueVgpuMicrotask(() => handler(lossInfo));
                return () => {};
            }
            lostHandlers.add(handler);
            return () => lostHandlers.delete(handler);
        },
        removeDeviceLostHandler(handler) {
            if (wrapperRemoveDeviceLost) {
                return Reflect.apply(
                    wrapperRemoveDeviceLost.callable, wrapperRemoveDeviceLost.receiver, [handler],
                );
            }
            lostHandlers.delete(handler);
        },
    };
    Reflect.apply(VGPU_WEAK_SET_ADD, VGPU_NORMALIZED_DEVICE_INPUTS, [normalized]);
    return Object.freeze(normalized);
}



function generationInvalidatedError(generation, reason = 'invalidated') {

    const error = new Error(`[vGPU] Generation ${generation} is no longer active (${reason || 'invalidated'})`);

    error.code = 'VGPU_GENERATION_INVALIDATED';

    error.generation = generation;

    error.reason = reason || 'invalidated';

    return error;

}

function queryPoolCancellationError() {
    const error = new Error('[vGPU] Query pool destroyed');
    error.name = 'AbortError';
    error.code = 'VGPU_QUERY_POOL_DESTROYED';
    return error;
}

function factoryOperationLifecycleError(reason = 'destroyed') {
    const error = new Error(`[vGPU] Factory operation cancelled (${reason})`);
    error.name = 'AbortError';
    error.code = 'VGPU_FACTORY_DESTROYED';
    return error;
}

function shaderManagerCancellationError(reason = 'destroyed') {
    const error = new Error(`[vGPU] Shader manager ${reason}`);
    error.name = 'AbortError';
    error.code = 'VGPU_SHADER_MANAGER_DESTROYED';
    return error;
}

function pipelineManagerCancellationError(reason = 'destroyed') {
    const error = new Error(`[vGPU] Pipeline manager ${reason}`);
    error.name = 'AbortError';
    error.code = 'VGPU_PIPELINE_MANAGER_DESTROYED';
    return error;
}

function commandManagerCancellationError() {
    const error = new Error('[vGPU] Command manager destroyed');
    error.name = 'AbortError';
    error.code = 'VGPU_COMMAND_MANAGER_DESTROYED';
    return error;
}

function warmupManagerCancellationError(reason = 'destroyed') {
    const error = new Error(`[vGPU] Pipeline warmup ${reason}`);
    error.name = 'AbortError';
    error.code = 'VGPU_PIPELINE_WARMUP_DESTROYED';
    return error;
}

function syncWarmupPendingMirror(manager) {
    const mirror = getCoreManagerPrivateValue(manager, 'pendingMirror');
    if (!mirror) return;
    const pending = snapshotVgpuPrivateSet(manager, '_pendingPromises');
    try {
        mirror.length = 0;
        for (let index = 0; index < pending.length; index++) {
            Reflect.apply(VGPU_ARRAY_PUSH, mirror, [pending[index]]);
        }
    } catch (_) {}
}

function cancelWarmupOperations(manager, containerName, error, wait = false) {
    const operations = snapshotVgpuPrivateSet(manager, containerName).map(operation => {
        const lifecycle = getVgpuOperationLifecycleAuthorities(operation);
        return Object.freeze({
            operation,
            cancel: getVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority'),
            settle: lifecycle?.settle || null,
        });
    });
    clearVgpuPrivateSet(manager, containerName);
    for (const entry of operations) {
        cancelVgpuOperation(entry.operation);
        safeInvokeCoreCallable(entry.cancel, [error]);
        if (entry.settle) Reflect.apply(
            entry.settle.callable, entry.settle.receiver,
            wait ? [entry.operation, error] : [entry.operation, null, error],
        );
    }
    return operations.length;
}

function factoryDeviceCollisionError(record) {
    const error = new Error(
        `[vGPU] Factory device collided with active generation ${record?.generation ?? -1}`,
    );
    error.code = 'VGPU_FACTORY_DEVICE_COLLISION';
    error.generation = record?.generation ?? -1;
    return error;
}

function captureFactoryEntryAuthorities(vgpu, generation, extraSpecifications = []) {
    const assertCurrent = () => {
        if (vgpu._destroyed || generation !== vgpu._factoryGeneration) {
            const error = new Error(
                `[vGPU] Factory operation cancelled (${vgpu._destroyReason || 'destroyed'})`,
            );
            error.name = 'AbortError';
            error.code = 'VGPU_FACTORY_DESTROYED';
            throw error;
        }
    };
    return captureVgpuCallableSet([
        { name: 'start', receiver: vgpu, key: '_startFactoryOperation', operation: 'factory operation start' },
        { name: 'construct', receiver: vgpu, key: '_constructFactoryCandidate', operation: 'factory candidate construction' },
        { name: 'assertAlive', receiver: vgpu, key: '_assertFactoryAlive', operation: 'factory lifecycle assertion' },
        { name: 'mismatchError', receiver: vgpu, key: '_factoryOptionsMismatchError', operation: 'factory mismatch reporting' },
        { name: 'releaseChild', receiver: vgpu, key: '_releaseFactoryChild', operation: 'factory child release' },
        { name: 'publishedPromise', receiver: vgpu, key: '_publishedFactoryPromise', operation: 'factory cached publication' },
        { name: 'isCurrent', receiver: vgpu, key: '_isFactoryOperationCurrent', operation: 'factory authority validation' },
        { name: 'retireCandidate', receiver: vgpu, key: '_retireFactoryCandidate', operation: 'factory candidate retirement' },
        { name: 'attachChild', receiver: vgpu, key: '_attachFactoryChildRelease', operation: 'factory child registration' },
        { name: 'cancelOperation', receiver: vgpu, key: '_cancelFactoryOperation', operation: 'factory cancellation' },
        { name: 'trackResource', receiver: vgpu, key: '_trackFactoryResource', operation: 'factory resource tracking' },
        { name: 'settleOperation', receiver: vgpu, key: '_settleFactoryOperation', operation: 'factory operation settlement' },
        { name: 'lifecycleError', receiver: vgpu, key: '_factoryLifecycleError', operation: 'factory lifecycle reporting' },
        { name: 'destroyCandidate', receiver: vgpu, key: '_destroyFactoryCandidate', operation: 'factory candidate cleanup' },
        ...extraSpecifications,
    ], assertCurrent);
}

function initializeVgpuOwnerScopeState(scope, record, ownerId, namespace) {
    const state = {
        leaseCount: 0,
        memoryOwnerId: `${namespace}@g${record.generation}`,
        namespace,
        nextResourceId: 0,
        ownerId,
        record,
        released: false,
        shaderGeneration: 0,
        view: null,
    };
    Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_OWNER_SCOPE_STATES, [scope, state]);
    const mirrored = [
        'leaseCount', 'memoryOwnerId', 'namespace', 'nextResourceId', 'ownerId',
        'record', 'released', 'shaderGeneration', 'view',
    ];
    const descriptors = {};
    for (let index = 0; index < mirrored.length; index++) {
        const name = mirrored[index];
        descriptors[name] = {
            configurable: false,
            enumerable: true,
            get: () => state[name],
            set: () => {},
        };
    }
    Object.defineProperties(scope, descriptors);
    return state;
}

function getVgpuOwnerScopeState(scope) {
    return scope
        ? Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_OWNER_SCOPE_STATES, [scope]) || null
        : null;
}

function claimVgpuOwnerScopeRelease(scope) {
    const state = getVgpuOwnerScopeState(scope);
    if (!state || state.released) return null;
    state.released = true;
    return state;
}

function adjustVgpuOwnerScopeLeaseCount(scope, delta) {
    const state = getVgpuOwnerScopeState(scope);
    if (!state) throw new TypeError('[vGPU] Owner scope state is unavailable');
    state.leaseCount = Math.max(0, state.leaseCount + delta);
    return state.leaseCount;
}

function advanceVgpuOwnerShaderGeneration(scope) {
    const state = getVgpuOwnerScopeState(scope);
    if (!state) throw new TypeError('[vGPU] Owner scope state is unavailable');
    state.shaderGeneration++;
    return state.shaderGeneration;
}

function nextVgpuOwnerResourceId(scope) {
    const state = getVgpuOwnerScopeState(scope);
    if (!state) throw new TypeError('[vGPU] Owner scope state is unavailable');
    state.nextResourceId++;
    return state.nextResourceId;
}



class VGPUOwnerScope {

    constructor(record, ownerId) {

        this.record = record;

        this.ownerId = ownerId;

        this.leaseCount = 0;

        this.released = false;

        this.namespace = `owner_${record.id}_${++ownerScopeId}_${encodeURIComponent(ownerId)}`;

        this.memoryOwnerId = `${this.namespace}@g${record.generation}`;

        this.nextResourceId = 0;

        this.bufferIds = new VGPU_NATIVE_MAP();

        installVgpuPrivateContainer(this, 'bufferIds', new VGPU_NATIVE_MAP());

        this.textureIds = new VGPU_NATIVE_MAP();

        installVgpuPrivateContainer(this, 'textureIds', new VGPU_NATIVE_MAP());

        this.bindingNames = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, 'bindingNames', new VGPU_NATIVE_SET());

        this.shaderNames = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, 'shaderNames', new VGPU_NATIVE_SET());

        this.shaderGeneration = 0;

        this.renderPipelineKeys = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, 'renderPipelineKeys', new VGPU_NATIVE_SET());

        this.computePipelineKeys = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, 'computePipelineKeys', new VGPU_NATIVE_SET());

        this.factoryResources = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, 'factoryResources', new VGPU_NATIVE_SET());

        this.hotReloadUnsubscribers = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, 'hotReloadUnsubscribers', new VGPU_NATIVE_SET());

        this.asyncOperations = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, 'asyncOperations', new VGPU_NATIVE_SET());

        this.asyncOperationsByBackend = new VGPU_NATIVE_WEAK_MAP();

        installVgpuPrivateContainer(
            this, 'asyncOperationsByBackend', new VGPU_NATIVE_WEAK_MAP(),
        );

        this.syncOperations = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, 'syncOperations', new VGPU_NATIVE_SET());

        const state = initializeVgpuOwnerScopeState(
            this, record, ownerId, this.namespace,
        );

        state.view = this._createView();

    }



    assertActive() {

        if (!this.record.active) {

            throw generationInvalidatedError(this.record.generation, this.record.reason);

        }

        if (this.released) {

            const error = new Error(`[vGPU] Owner scope has been released: ${this.ownerId}`);

            error.code = 'VGPU_OWNER_RELEASED';

            throw error;

        }

    }



    run(operation, retireResult = null, withOwnerScopeAuthority = undefined) {

        this.assertActive();

        const token = Object.freeze({

            record: this.record,

            generation: this.record.generation,

            vgpu: this.record.vgpu,

        });

        addVgpuPrivateSetEntry(this, 'syncOperations', token);

        let result;

        let stagedResult;

        const stagedOperation = () => {

            this._assertRunCurrent(token);

            stagedResult = operation();

            this._assertRunCurrent(token);

            return stagedResult;

        };

        try {

            this._assertRunCurrent(token);

            const memory = withOwnerScopeAuthority?.receiver || token.vgpu.memory;

            let withOwnerScope = withOwnerScopeAuthority?.callable || null;

            if (withOwnerScopeAuthority === undefined && memory) {

                try { withOwnerScope = memory.withOwnerScope; } finally { this._assertRunCurrent(token); }

            }

            if (typeof withOwnerScope === 'function') {

                this._assertRunCurrent(token);

                result = Reflect.apply(withOwnerScope, memory, [this.memoryOwnerId, stagedOperation]);

            } else {

                this._assertRunCurrent(token);

                result = stagedOperation();

            }

            this._assertRunCurrent(token);

            return result;

        } catch (error) {

            const candidate = result !== undefined ? result : stagedResult;

            if (candidate !== undefined && retireResult) {

                try { retireResult(candidate); } catch (_) {}

            }

            silenceVgpuPromise(candidate);

            throw error;

        } finally {

            deleteVgpuPrivateSetEntry(this, 'syncOperations', token);

        }

    }



    _assertRunCurrent(token) {

        if (

            !token

            || !hasVgpuPrivateSetEntry(this, 'syncOperations', token)

            || token.record !== this.record

            || token.generation !== this.record.generation

            || token.vgpu !== this.record.vgpu

        ) throw this._ownerReleaseError();

        this.assertActive();

    }



    _readOwnerValue(target, key) {

        let value;

        try { value = target[key]; } finally { this.assertActive(); }

        return value;

    }



    _normalizeOwnerValue(value, normalize = String) {

        let normalized;

        try { normalized = normalize(value); } finally { this.assertActive(); }

        return normalized;

    }



    _snapshotOwnerOptions(options = {}) {

        this.assertActive();

        if (options == null) return Object.freeze({});

        let keys;

        try { keys = Reflect.ownKeys(options); } finally { this.assertActive(); }

        const snapshot = {};

        for (const key of keys) {

            let descriptor;

            try { descriptor = Reflect.getOwnPropertyDescriptor(options, key); } finally { this.assertActive(); }

            if (!descriptor?.enumerable) continue;

            snapshot[key] = this._readOwnerValue(options, key);

        }

        return Object.freeze(snapshot);

    }



    _snapshotOwnerArray(source) {

        this.assertActive();

        const iterator = this._readOwnerValue(source, Symbol.iterator);

        if (typeof iterator !== 'function') return Object.freeze([source]);

        let cursor;

        try { cursor = Reflect.apply(iterator, source, []); } finally { this.assertActive(); }

        const next = this._readOwnerValue(cursor, 'next');

        if (typeof next !== 'function') throw new TypeError('[vGPU] Owner input is not iterable');

        const values = [];

        while (true) {

            let step;

            try { step = Reflect.apply(next, cursor, []); } finally { this.assertActive(); }

            const done = Boolean(this._readOwnerValue(step, 'done'));

            if (done) break;

            values.push(this._readOwnerValue(step, 'value'));

        }

        return Object.freeze(values);

    }



    _snapshotOwnerBytes(data) {

        if (data == null) return null;

        return this._normalizeOwnerValue(data, value => {

            if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));

            if (ArrayBuffer.isView(value)) {

                return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();

            }

            throw new TypeError('[vGPU] Owner buffer and texture data must be an ArrayBuffer or typed array');

        });

    }



    _captureOwnerCallSet(specifications) {

        const memory = this.record.vgpu.memory;

        const authorities = captureVgpuCallableSet([

            ...specifications,

            {
                name: 'withOwnerScope',
                receiver: memory,
                key: 'withOwnerScope',
                optional: true,
            },

        ], () => this.assertActive());

        const result = { withOwnerScope: authorities.withOwnerScope };

        for (const specification of specifications) {

            const authority = authorities[specification.name];

            result[specification.name] = authority

                ? Object.freeze({ ...authority, withOwnerScope: authorities.withOwnerScope })

                : null;

        }

        return Object.freeze(result);

    }



    _invokeOwnerCall(authority, args = [], retireResult = null) {

        if (!authority) throw new TypeError('[vGPU] Owner callable authority is unavailable');

        return this.run(

            () => Reflect.apply(authority.callable, authority.receiver, args),

            retireResult,

            authority.withOwnerScope,

        );

    }



    _invokeOwnerCallAsync(authority, args = []) {

        if (!authority) return rejectVgpuPromise(
            new TypeError('[vGPU] Owner callable authority is unavailable'),
        );

        return this.runAsync(

            () => Reflect.apply(authority.callable, authority.receiver, args),

            authority.withOwnerScope,

        );

    }



    runAsync(operation, withOwnerScopeAuthority = undefined) {

        this.assertActive();

        const lifecycleAuthorities = captureVgpuCallableSet([

            {
                name: 'settleAsyncOperation',
                receiver: this,
                key: '_settleAsyncOperation',
                operation: 'owner async settlement',
            },

            {
                name: 'ownerReleaseError',
                receiver: this,
                key: '_ownerReleaseError',
                operation: 'owner release error creation',
            },

        ], () => this.assertActive());

        let backendPromise;

        try {

            backendPromise = this.run(operation, null, withOwnerScopeAuthority);

        } catch (error) {

            const rejection = rejectVgpuPromise(error);

            silenceVgpuPromise(rejection);

            return rejection;

        }

        const backendKey = backendPromise

            && (typeof backendPromise === 'object' || typeof backendPromise === 'function')

            ? backendPromise

            : null;

        const existing = backendKey
            ? getVgpuPrivateMapEntry(this, 'asyncOperationsByBackend', backendKey)
            : null;

        if (existing && !isVgpuOperationSettled(existing)) return getVgpuOperationPromise(existing);

        let resolvePublic;

        let rejectPublic;

        const record = {

            settled: false,

            backendKey,

            promise: null,

            lifecycleAuthorities,

        };

        record.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        record.resolve = resolvePublic;

        record.reject = rejectPublic;

        installVgpuSettlementAuthorities(record, resolvePublic, rejectPublic);

        silenceVgpuPromise(getVgpuOperationPromise(record));

        addVgpuPrivateSetEntry(this, 'asyncOperations', record);

        if (backendKey) setVgpuPrivateMapEntry(
            this, 'asyncOperationsByBackend', backendKey, record,
        );

        if (this.released || !this.record.active) {

            const releaseError = Reflect.apply(

                lifecycleAuthorities.ownerReleaseError.callable,

                lifecycleAuthorities.ownerReleaseError.receiver,

                [],

            );

            Reflect.apply(

                lifecycleAuthorities.settleAsyncOperation.callable,

                lifecycleAuthorities.settleAsyncOperation.receiver,

                [record, null, releaseError],

            );

            silenceVgpuPromise(backendPromise);

            return getVgpuOperationPromise(record);

        }

        void thenVgpuPromise(resolveVgpuPromise(backendPromise),

            value => {

                if (
                    !this.released
                    && this.record.active
                    && hasVgpuPrivateSetEntry(this, 'asyncOperations', record)
                ) {

                    Reflect.apply(

                        lifecycleAuthorities.settleAsyncOperation.callable,

                        lifecycleAuthorities.settleAsyncOperation.receiver,

                        [record, value, null],

                    );

                }

            },

            error => {

                if (hasVgpuPrivateSetEntry(this, 'asyncOperations', record)) {

                    Reflect.apply(

                        lifecycleAuthorities.settleAsyncOperation.callable,

                        lifecycleAuthorities.settleAsyncOperation.receiver,

                        [record, null, error],

                    );

                }

            },

        );

        return getVgpuOperationPromise(record);

    }



    _settleAsyncOperation(record, value, error) {

        if (!claimVgpuOperationSettlement(record)) return false;

        deleteVgpuPrivateSetEntry(this, 'asyncOperations', record);

        const backendKey = getVgpuOperationIdentity(record, 'backendKey');

        if (
            backendKey
            && getVgpuPrivateMapEntry(this, 'asyncOperationsByBackend', backendKey) === record
        ) {

            deleteVgpuPrivateMapEntry(this, 'asyncOperationsByBackend', backendKey);

        }

        invokeVgpuSettlementAuthority(record, Boolean(error), error || value);

        return true;

    }



    _ownerReleaseError() {

        const error = new Error(`[vGPU] Owner scope has been released: ${this.ownerId}`);

        error.name = 'AbortError';

        error.code = 'VGPU_OWNER_RELEASED';

        return error;

    }



    _cancelAsyncOperations(error = null) {

        const operations = snapshotVgpuPrivateSet(this, 'asyncOperations');

        clearVgpuPrivateSet(this, 'asyncOperations');

        let cancellation = error;

        if (!cancellation && operations.length > 0) {

            const authority = getVgpuOperationLifecycleAuthorities(operations[0])?.ownerReleaseError;

            if (authority) cancellation = Reflect.apply(authority.callable, authority.receiver, []);

        }

        for (const operation of operations) {

            const authority = getVgpuOperationLifecycleAuthorities(operation)?.settleAsyncOperation;

            if (authority) Reflect.apply(
                authority.callable, authority.receiver, [operation, null, cancellation],
            );

        }

    }



    name(kind, value) {

        return `${this.namespace}/${kind}/${String(value)}`;

    }



    label(kind, value) {

        const suffix = value ? String(value) : kind;

        return `${this.namespace}:${suffix}`;

    }



    resourceId(kind) {

        return `${this.namespace}:${kind}:${nextVgpuOwnerResourceId(this)}`;

    }



    _createView() {

        const scope = this;

        const internal = this.record.vgpu;

        const featureNames = new Set(internal.features ? [...internal.features] : []);

        const safeFeatures = Object.freeze({

            has: (name) => featureNames.has(name),

            get size() { return featureNames.size; },

            values: () => featureNames.values(),

            keys: () => featureNames.keys(),

            entries: () => featureNames.entries(),

            [Symbol.iterator]: () => featureNames[Symbol.iterator](),

        });

        const safeCapabilities = Object.freeze({

            limits: internal.limits,

            features: safeFeatures,

            defaultColorFormat: internal.capabilities?.defaultColorFormat || DEFAULT_COLOR_FORMAT,

            defaultDepthFormat: internal.capabilities?.defaultDepthFormat || DEFAULT_DEPTH_FORMAT,

            defaultSampleCount: internal.capabilities?.defaultSampleCount || 1,

        });

        const buffer = Object.freeze({

            create(options = {}) {

                const manager = internal.buffer;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'create', receiver: manager, key: 'create', operation: 'owner buffer creation' },

                    { name: 'releaseManaged', receiver: manager, key: '_releaseManaged', operation: 'owner buffer rollback' },

                ]);

                const values = scope._snapshotOwnerOptions(options);

                const stable = Object.freeze({

                    size: scope._normalizeOwnerValue(values.size, Number),

                    usage: typeof values.usage === 'number'

                        ? values.usage

                        : scope._normalizeOwnerValue(values.usage ?? 'copy-dst', String),

                    label: scope.label(

                        'buffer',

                        values.label == null ? '' : scope._normalizeOwnerValue(values.label, String),

                    ),

                    data: scope._snapshotOwnerBytes(values.data),

                    pooled: Boolean(values.pooled),

                });

                const allocation = scope._invokeOwnerCall(

                    authorities.create,

                    [stable],

                    candidate => Reflect.apply(
                        authorities.releaseManaged.callable,
                        authorities.releaseManaged.receiver,
                        [candidate?.id],
                    ),

                );

                scope.assertActive();

                const id = scope.resourceId('buffer');

                scope.assertActive();

                setVgpuPrivateMapEntry(scope, 'bufferIds', id, allocation.id);

                return { buffer: allocation.buffer, id };

            },

            write(gpuBuffer, data, offset = 0) {

                const manager = internal.buffer;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'write', receiver: manager, key: 'write', operation: 'owner buffer write' },

                ]);

                const bytes = scope._snapshotOwnerBytes(data);

                const stableOffset = scope._normalizeOwnerValue(offset, Number);

                return scope._invokeOwnerCall(
                    authorities.write, [gpuBuffer, bytes, stableOffset],
                );

            },

            release(id) {

                const manager = internal.buffer;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'release', receiver: manager, key: 'release', operation: 'owner buffer release' },

                ]);

                const internalId = getVgpuPrivateMapEntry(scope, 'bufferIds', id);

                if (internalId === undefined) return false;

                deleteVgpuPrivateMapEntry(scope, 'bufferIds', id);

                scope._invokeOwnerCall(authorities.release, [internalId]);

                return true;

            },

            get(id) {

                const manager = internal.buffer;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'get', receiver: manager, key: 'get', operation: 'owner buffer lookup' },

                ]);

                const internalId = getVgpuPrivateMapEntry(scope, 'bufferIds', id);

                return internalId === undefined
                    ? undefined
                    : scope._invokeOwnerCall(authorities.get, [internalId]);

            },

            getStats() {

                scope.assertActive();

                return { managed: snapshotVgpuPrivateMapValues(scope, 'bufferIds').length };

            },

        });



        const texture = Object.freeze({

            create(options = {}) {

                const manager = internal.texture;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'create', receiver: manager, key: 'create', operation: 'owner texture creation' },

                    { name: 'releaseManaged', receiver: manager, key: '_releaseManaged', operation: 'owner texture rollback' },

                ]);

                const values = scope._snapshotOwnerOptions(options);

                const stable = Object.freeze({

                    width: scope._normalizeOwnerValue(values.width, Number),

                    height: scope._normalizeOwnerValue(values.height, Number),

                    depth: values.depth == null ? 1 : scope._normalizeOwnerValue(values.depth, Number),

                    format: values.format == null ? 'rgba8unorm' : scope._normalizeOwnerValue(values.format, String),

                    usage: typeof values.usage === 'number'

                        ? values.usage

                        : scope._normalizeOwnerValue(values.usage ?? 'texture', String),

                    mipLevelCount: scope._normalizeOwnerValue(

                        values.mipLevelCount ?? values.mipLevels ?? 1, Number,

                    ),

                    sampleCount: scope._normalizeOwnerValue(values.sampleCount ?? 1, Number),

                    dimension: scope._normalizeOwnerValue(values.dimension ?? '2d', String),

                    label: scope.label(

                        'texture',

                        values.label == null ? '' : scope._normalizeOwnerValue(values.label, String),

                    ),

                    data: scope._snapshotOwnerBytes(values.data),

                });

                const allocation = scope._invokeOwnerCall(

                    authorities.create,

                    [stable],

                    candidate => Reflect.apply(
                        authorities.releaseManaged.callable,
                        authorities.releaseManaged.receiver,
                        [candidate?.id],
                    ),

                );

                scope.assertActive();

                const id = scope.resourceId('texture');

                scope.assertActive();

                setVgpuPrivateMapEntry(scope, 'textureIds', id, allocation.id);

                return { texture: allocation.texture, view: allocation.view, id };

            },

            sampler(options = {}) {

                const manager = internal.texture;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'sampler', receiver: manager, key: 'sampler', operation: 'owner sampler creation' },

                ]);

                const values = scope._snapshotOwnerOptions(options);

                const stable = {};

                for (const key of [

                    'filter', 'addressMode', 'minFilter', 'magFilter', 'mipmapFilter',

                    'compare', 'addressModeU', 'addressModeV', 'addressModeW',

                ]) {

                    if (values[key] != null) stable[key] = scope._normalizeOwnerValue(values[key], String);

                }

                stable.maxAnisotropy = scope._normalizeOwnerValue(values.maxAnisotropy ?? 1, Number);

                const keysBefore = new Set(manager.samplers.keys());

                return scope._invokeOwnerCall(authorities.sampler, [Object.freeze(stable)], () => {

                    for (const key of manager.samplers.keys()) {

                        if (!keysBefore.has(key)) manager.samplers.delete(key);

                    }

                });

            },

            release(id) {

                const manager = internal.texture;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'release', receiver: manager, key: 'release', operation: 'owner texture release' },

                ]);

                const internalId = getVgpuPrivateMapEntry(scope, 'textureIds', id);

                if (internalId === undefined) return false;

                deleteVgpuPrivateMapEntry(scope, 'textureIds', id);

                scope._invokeOwnerCall(authorities.release, [internalId]);

                return true;

            },

            get(id) {

                const manager = internal.texture;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'get', receiver: manager, key: 'get', operation: 'owner texture lookup' },

                ]);

                const internalId = getVgpuPrivateMapEntry(scope, 'textureIds', id);

                return internalId === undefined
                    ? undefined
                    : scope._invokeOwnerCall(authorities.get, [internalId]);

            },

            getStats() {

                scope.assertActive();

                return { textures: snapshotVgpuPrivateMapValues(scope, 'textureIds').length };

            },

        });



        const bindings = Object.freeze({

            defineLayout(name, entries) {

                const manager = internal.bindings;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'defineLayout', receiver: manager, key: 'defineLayout', operation: 'owner layout definition' },

                ]);

                const normalizedName = scope._normalizeOwnerValue(name, String);

                const scopedName = scope.name('layout', normalizedName);

                const stableEntries = scope._snapshotOwnerArray(entries).map((entry, index) => {

                    const values = scope._snapshotOwnerOptions(entry);

                    const stable = { ...values };

                    stable.binding = scope._normalizeOwnerValue(values.binding ?? index, Number);

                    stable.type = scope._normalizeOwnerValue(values.type, String);

                    stable.visibility = typeof values.visibility === 'number'

                        ? values.visibility

                        : scope._normalizeOwnerValue(values.visibility ?? 'compute', String);

                    for (const key of [

                        'samplerType', 'sampleType', 'viewDimension', 'dimension', 'access', 'format',

                    ]) {

                        if (values[key] != null) stable[key] = scope._normalizeOwnerValue(values[key], String);

                    }

                    if (values.minBindingSize != null) {

                        stable.minBindingSize = scope._normalizeOwnerValue(values.minBindingSize, Number);

                    }

                    if (values.hasDynamicOffset != null) stable.hasDynamicOffset = Boolean(values.hasDynamicOffset);

                    if (values.multisampled != null) stable.multisampled = Boolean(values.multisampled);

                    return Object.freeze(stable);

                });

                const existed = manager.layouts.has(scopedName);

                const result = scope._invokeOwnerCall(

                    authorities.defineLayout,

                    [scopedName, Object.freeze(stableEntries)],

                    () => {

                        if (!existed) {

                            manager.layouts.delete(scopedName);

                            manager.layoutDefs.delete(scopedName);

                            manager.layoutKeys.delete(scopedName);

                        }

                    },

                );

                scope.assertActive();

                addVgpuPrivateSetEntry(scope, 'bindingNames', scopedName);

                return result;

            },

            getLayout(name) {

                const manager = internal.bindings;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'getLayout', receiver: manager, key: 'getLayout', operation: 'owner layout lookup' },

                ]);

                const normalizedName = scope._normalizeOwnerValue(name, String);

                return scope._invokeOwnerCall(
                    authorities.getLayout, [scope.name('layout', normalizedName)],
                );

            },

            createGroup(layout, entries, label = '') {

                const manager = internal.bindings;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'createGroup', receiver: manager, key: 'createGroup', operation: 'owner bind-group creation' },

                ]);

                const scopedLayout = typeof layout === 'string'

                    ? scope.name('layout', scope._normalizeOwnerValue(layout, String))

                    : layout;

                const stableEntries = scope._snapshotOwnerArray(entries).map((entry, index) => {

                    const values = scope._snapshotOwnerOptions(entry);

                    return Object.freeze({

                        ...values,

                        binding: scope._normalizeOwnerValue(values.binding ?? index, Number),

                        offset: scope._normalizeOwnerValue(values.offset ?? 0, Number),

                        size: values.size == null ? undefined : scope._normalizeOwnerValue(values.size, Number),

                    });

                });

                const normalizedLabel = label == null ? '' : scope._normalizeOwnerValue(label, String);

                const keysBefore = new Set(manager.groupCache.keys());

                return scope._invokeOwnerCall(

                    authorities.createGroup,

                    [
                        scopedLayout,
                        Object.freeze(stableEntries),
                        scope.label('bind-group', normalizedLabel),
                    ],

                    () => {

                        for (const key of manager.groupCache.keys()) {

                            if (!keysBefore.has(key)) manager.groupCache.delete(key);

                        }

                    },

                );

            },

            getStats() {

                scope.assertActive();

                return { layouts: snapshotVgpuPrivateSet(scope, 'bindingNames').length };

            },

        });



        const scopedShaderName = (name) => {

            const normalizedName = scope._normalizeOwnerValue(name, String);

            return scope.name('shader', normalizedName);

        };

        const shader = Object.freeze({

            compile(name, code, defines = {}) {

                const manager = internal.shader;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'compile', receiver: manager, key: 'compile', operation: 'owner shader compilation' },

                ]);

                const scopedName = scopedShaderName(name);

                const result = scope._invokeOwnerCall(
                    authorities.compile, [scopedName, code, defines, scope],
                );

                scope.assertActive();

                addVgpuPrivateSetEntry(scope, 'shaderNames', scopedName);

                return result;

            },

            compileFromFile(name, code, filePath, defines = {}) {

                const manager = internal.shader;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'compileFromFile', receiver: manager, key: 'compileFromFile', operation: 'owner file shader compilation' },

                ]);

                const scopedName = scopedShaderName(name);

                const result = scope._invokeOwnerCall(
                    authorities.compileFromFile, [scopedName, code, filePath, defines, scope],
                );

                scope.assertActive();

                addVgpuPrivateSetEntry(scope, 'shaderNames', scopedName);

                return result;

            },

            recompile(name, code, defines = {}) {

                const manager = internal.shader;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'recompile', receiver: manager, key: 'recompile', operation: 'owner shader recompilation' },

                ]);

                const scopedName = scopedShaderName(name);

                addVgpuPrivateSetEntry(scope, 'shaderNames', scopedName);

                return scope._invokeOwnerCallAsync(
                    authorities.recompile, [scopedName, code, defines, scope],
                );

            },

            invalidate(name, defines = {}) {

                const manager = internal.shader;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'invalidate', receiver: manager, key: 'invalidate', operation: 'owner shader invalidation' },

                ]);

                const normalizedName = scope._normalizeOwnerValue(name, String);

                scope._invokeOwnerCall(
                    authorities.invalidate,
                    [scope.name('shader', normalizedName), defines, scope],
                );

            },

            invalidateAll() {

                const manager = internal.shader;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'cancelOwner', receiver: manager, key: 'cancelOwner', operation: 'owner shader cancellation' },

                    { name: 'cancellationError', receiver: manager, key: '_shaderCancellationError', operation: 'owner shader cancellation error' },

                ]);

                advanceVgpuOwnerShaderGeneration(scope);

                const cancellationError = scope._invokeOwnerCall(
                    authorities.cancellationError, ['owner invalidated'],
                );

                scope._invokeOwnerCall(authorities.cancelOwner, [scope, cancellationError]);

                scope._clearShaderCache();

            },

            get(name, defines = {}) {

                const manager = internal.shader;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'get', receiver: manager, key: 'get', operation: 'owner shader lookup' },

                ]);

                const normalizedName = scope._normalizeOwnerValue(name, String);

                return scope._invokeOwnerCall(
                    authorities.get,
                    [scope.name('shader', normalizedName), defines, scope],
                );

            },

            checkCompilationInfo(module) {

                const manager = internal.shader;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'checkCompilationInfo', receiver: manager, key: 'checkCompilationInfo', operation: 'owner shader diagnostics' },

                ]);

                return scope._invokeOwnerCallAsync(
                    authorities.checkCompilationInfo, [module, scope],
                );

            },

            onHotReload(callback) {

                const manager = internal.shader;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'onHotReload', receiver: manager, key: 'onHotReload', operation: 'owner hot-reload registration' },

                ]);

                const prefix = scope.name('shader', '');

                const unsubscribe = scope._invokeOwnerCall(

                    authorities.onHotReload,

                    [(name, module) => {

                        if (String(name).startsWith(prefix)) callback(String(name).slice(prefix.length), module);

                    }],

                    candidate => {
                        if (typeof candidate === 'function') Reflect.apply(candidate, undefined, []);
                    },

                );

                scope.assertActive();

                addVgpuPrivateSetEntry(scope, 'hotReloadUnsubscribers', unsubscribe);

                return () => {

                    deleteVgpuPrivateSetEntry(scope, 'hotReloadUnsubscribers', unsubscribe);

                    unsubscribe();

                };

            },

            getStats() {

                scope.assertActive();

                const prefix = scope.name('shader', '');

                return {

                    modules: [...internal.shader.modules.keys()].filter(key => key.startsWith(prefix)).length,

                };

            },

        });



        const pipelineOptions = (options, kind, snapshotAuthority) => {

            const manager = snapshotAuthority.receiver;

            const generation = manager._generation;

            const snapshot = scope._invokeOwnerCall(

                snapshotAuthority, [options, generation, scope],

            );

            return Object.freeze({

                ...snapshot,

                label: scope.label('pipeline', snapshot.label || kind),

            });

        };

        const pipeline = Object.freeze({

            render(options) {

                const manager = internal.pipeline;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'snapshot', receiver: manager, key: '_snapshotRenderOptions', operation: 'owner render pipeline snapshot' },

                    { name: 'render', receiver: manager, key: 'render', operation: 'owner render pipeline creation' },

                ]);

                const scopedOptions = pipelineOptions(options, 'render', authorities.snapshot);

                return scope._invokeOwnerCall(authorities.render, [scopedOptions, scope]);

            },

            renderAsync(options) {

                const manager = internal.pipeline;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'snapshot', receiver: manager, key: '_snapshotRenderOptions', operation: 'owner async render pipeline snapshot' },

                    { name: 'renderAsync', receiver: manager, key: 'renderAsync', operation: 'owner async render pipeline creation' },

                ]);

                let scopedOptions;

                try {
                    scopedOptions = pipelineOptions(options, 'render', authorities.snapshot);
                } catch (error) {
                    return rejectVgpuPromise(error);
                }

                return scope._invokeOwnerCallAsync(
                    authorities.renderAsync, [scopedOptions, scope],
                );

            },

            compute(options) {

                const manager = internal.pipeline;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'snapshot', receiver: manager, key: '_snapshotComputeOptions', operation: 'owner compute pipeline snapshot' },

                    { name: 'compute', receiver: manager, key: 'compute', operation: 'owner compute pipeline creation' },

                ]);

                const scopedOptions = pipelineOptions(options, 'compute', authorities.snapshot);

                return scope._invokeOwnerCall(authorities.compute, [scopedOptions, scope]);

            },

            computeAsync(options) {

                const manager = internal.pipeline;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'snapshot', receiver: manager, key: '_snapshotComputeOptions', operation: 'owner async compute pipeline snapshot' },

                    { name: 'computeAsync', receiver: manager, key: 'computeAsync', operation: 'owner async compute pipeline creation' },

                ]);

                let scopedOptions;

                try {
                    scopedOptions = pipelineOptions(options, 'compute', authorities.snapshot);
                } catch (error) {
                    return rejectVgpuPromise(error);
                }

                return scope._invokeOwnerCallAsync(
                    authorities.computeAsync, [scopedOptions, scope],
                );

            },

            getStats() {

                scope.assertActive();

                return {

                    renderPipelines: snapshotVgpuPrivateSet(scope, 'renderPipelineKeys').length,

                    computePipelines: snapshotVgpuPrivateSet(scope, 'computePipelineKeys').length,

                };

            },

        });



        const command = Object.freeze({

            encoder(label = 'encoder') {

                const manager = internal.command;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'encoder', receiver: manager, key: 'encoder', operation: 'owner command encoder creation' },

                ]);

                const normalizedLabel = scope._normalizeOwnerValue(label, String);

                return scope._invokeOwnerCall(

                    authorities.encoder,

                    [scope.label('command', normalizedLabel)],

                    candidate => safeCoreCleanup(captureCoreCleanup(candidate)),

                );

            },

            submit(commandBuffers) {

                const manager = internal.command;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'submit', receiver: manager, key: 'submit', operation: 'owner command submission' },

                ]);

                const buffers = scope._snapshotOwnerArray(commandBuffers);

                return scope._invokeOwnerCall(authorities.submit, [buffers]);

            },

            dispatchCompute(options = {}) {

                const manager = internal.command;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'dispatchCompute', receiver: manager, key: 'dispatchCompute', operation: 'owner compute dispatch' },

                ]);

                const values = scope._snapshotOwnerOptions(options);

                const groups = values.bindGroups == null

                    ? values.bindGroups

                    : scope._snapshotOwnerArray(values.bindGroups);

                const rawWorkgroups = values.workgroups;

                const workgroups = Array.isArray(rawWorkgroups)

                    ? scope._snapshotOwnerArray(rawWorkgroups).map(value => (

                        scope._normalizeOwnerValue(value, Number)

                    ))

                    : scope._normalizeOwnerValue(rawWorkgroups, Number);

                const normalizedLabel = values.label == null

                    ? 'compute-dispatch'

                    : scope._normalizeOwnerValue(values.label, String);

                return scope._invokeOwnerCall(authorities.dispatchCompute, [Object.freeze({

                    pipeline: values.pipeline,

                    bindGroups: groups,

                    workgroups,

                    label: scope.label('compute-dispatch', normalizedLabel),

                })]);

            },

            copyBuffer(src, dst, srcOffset = 0, dstOffset = 0, size) {

                const manager = internal.command;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'copyBuffer', receiver: manager, key: 'copyBuffer', operation: 'owner buffer copy' },

                ]);

                const stableSrcOffset = scope._normalizeOwnerValue(srcOffset, Number);

                const stableDstOffset = scope._normalizeOwnerValue(dstOffset, Number);

                const stableSize = size == null ? size : scope._normalizeOwnerValue(size, Number);

                return scope._invokeOwnerCall(
                    authorities.copyBuffer,
                    [src, dst, stableSrcOffset, stableDstOffset, stableSize],
                );

            },

            readBuffer(buffer, offset = 0, size) {

                const manager = internal.command;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'readBuffer', receiver: manager, key: 'readBuffer', operation: 'owner buffer readback' },

                ]);

                const stableOffset = scope._normalizeOwnerValue(offset, Number);

                const rawSize = size === undefined ? scope._readOwnerValue(buffer, 'size') : size;

                const stableSize = scope._normalizeOwnerValue(rawSize, Number);

                return scope._invokeOwnerCallAsync(
                    authorities.readBuffer, [buffer, stableOffset, stableSize, scope],
                );

            },

        });



        const memory = Object.freeze({

            getUsage() {

                const manager = internal.memory;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'getUsage', receiver: manager, key: 'getUsageForOwner', operation: 'owner memory usage lookup' },

                ]);

                return scope._invokeOwnerCall(authorities.getUsage, [scope.memoryOwnerId]);

            },

            getStats() {

                const manager = internal.memory;

                const authorities = scope._captureOwnerCallSet([

                    { name: 'getUsage', receiver: manager, key: 'getUsageForOwner', operation: 'owner memory stats lookup' },

                ]);

                return {

                    currentUsage: scope._invokeOwnerCall(
                        authorities.getUsage, [scope.memoryOwnerId],
                    ),

                    resources: snapshotVgpuPrivateMapValues(scope, 'bufferIds').length
                        + snapshotVgpuPrivateMapValues(scope, 'textureIds').length,

                };

            },

        });



        const createAtlas = (options = {}) => {

            const queue = internal.queue;

            const authorities = scope._captureOwnerCallSet([

                { name: 'track', receiver: internal, key: '_trackFactoryResource', operation: 'owner atlas tracking' },

                { name: 'copyExternalImage', receiver: queue, key: 'copyExternalImageToTexture', operation: 'owner atlas image copy' },

                { name: 'writeTexture', receiver: queue, key: 'writeTexture', operation: 'owner atlas texture write' },

            ]);

            const stableOptions = scope._snapshotOwnerOptions(options);

            return scope.run(() => {

            const atlasQueue = Object.freeze({

                copyExternalImageToTexture(...args) {

                    return scope._invokeOwnerCall(authorities.copyExternalImage, args);

                },

                writeTexture(...args) {

                    return scope._invokeOwnerCall(authorities.writeTexture, args);

                },

            });

            const atlasRuntime = {

                device: internal.device,

                queue: atlasQueue,

                buffer,

                get _destroyed() {

                    scope.assertActive();

                    return false;

                },

                _factoryGeneration: scope.record.generation,

            };

            let stagedAtlas = null;

            let stagedAtlasCleanup = null;

            try {

                const atlas = new VGPUTextureAtlas(atlasRuntime, stableOptions);

                stagedAtlas = atlas;

                stagedAtlasCleanup = captureCoreCleanup(

                    atlas, ['destroy', 'dispose', 'clear', 'hide', 'reset'],

                );

                scope.assertActive();

                atlas.device = null;

                delete atlasRuntime.device;

                Object.freeze(atlasRuntime);

                scope._invokeOwnerCall(
                    authorities.track, [atlas, stagedAtlasCleanup],
                );

                scope.assertActive();

                addVgpuPrivateSetEntry(scope, 'factoryResources', atlas);

                return atlas;

            } catch (error) {

                deleteVgpuPrivateSetEntry(internal, '_ownedFactoryResources', stagedAtlas);

                deleteVgpuPrivateSetEntry(scope, 'factoryResources', stagedAtlas);

                safeCoreCleanup(stagedAtlasCleanup || stagedAtlas);

                throw error;

            }

            });

        };



        return Object.freeze({

            ownerId: this.ownerId,

            generation: this.record.generation,

            capabilities: safeCapabilities,

            limits: internal.limits,

            features: safeFeatures,

            buffer,

            bindings,

            shader,

            pipeline,

            texture,

            command,

            memory,

            createAtlas,

            get valid() {

                return scope.record.active && !scope.released;

            },

            getStats() {

                scope.assertActive();

                return {

                    generation: scope.record.generation,

                    ownerId: scope.ownerId,

                    buffer: buffer.getStats(),

                    texture: texture.getStats(),

                    shader: shader.getStats(),

                    bindings: bindings.getStats(),

                    pipeline: pipeline.getStats(),

                    memory: memory.getUsage(),

                };

            },

        });

    }



    _clearShaderCache() {

        const shader = this.record.vgpu.shader;

        const prefix = this.name('shader', '');

        for (const key of [...shader.modules.keys()]) if (key.startsWith(prefix)) shader.modules.delete(key);

        for (const key of [...shader.sources.keys()]) if (key.startsWith(prefix)) shader.sources.delete(key);

        for (const key of [...shader.filePaths.keys()]) if (key.startsWith(prefix)) shader.filePaths.delete(key);

        clearVgpuPrivateSet(this, 'shaderNames');

    }



    releaseResources() {

        const ownerState = claimVgpuOwnerScopeRelease(this);

        if (!ownerState) return;

        const internal = this.record.vgpu;

        const cleanupAuthorities = captureVgpuCleanupCallableSet([

            {
                name: 'pipelineCancel',
                lookupReceiver: VGPUPipelineManager.prototype,
                receiver: internal.pipeline,
                key: 'cancelOwner',
            },

            {
                name: 'shaderCancel',
                lookupReceiver: VGPUShaderManager.prototype,
                receiver: internal.shader,
                key: 'cancelOwner',
            },

            {
                name: 'commandCancel',
                lookupReceiver: VGPUCommandManager.prototype,
                receiver: internal.command,
                key: 'cancelOwner',
            },

            {
                name: 'textureRelease',
                lookupReceiver: VGPUTextureManager.prototype,
                receiver: internal.texture,
                key: '_releaseManaged',
            },

            {
                name: 'bufferRelease',
                lookupReceiver: VGPUBufferManager.prototype,
                receiver: internal.buffer,
                key: '_releaseManaged',
            },

            {
                name: 'bindingObjectId',
                receiver: internal.bindings,
                key: '_getObjectId',
            },

            {
                name: 'memoryRelease',
                receiver: internal.memory,
                key: 'releaseOwner',
            },

            {
                name: 'ownerReleaseError',
                lookupReceiver: VGPUOwnerScope.prototype,
                receiver: this,
                key: '_ownerReleaseError',
            },

            {
                name: 'cancelAsyncOperations',
                lookupReceiver: VGPUOwnerScope.prototype,
                receiver: this,
                key: '_cancelAsyncOperations',
            },

        ]);

        const renderPipelines = internal.pipeline.renderPipelines;

        const computePipelines = internal.pipeline.computePipelines;

        const bindingLayouts = internal.bindings.layouts;

        const bindingLayoutDefs = internal.bindings.layoutDefs;

        const bindingLayoutKeys = internal.bindings.layoutKeys;

        const bindingGroupCache = internal.bindings.groupCache;

        const shaderModules = internal.shader.modules;

        const shaderSources = internal.shader.sources;

        const shaderFilePaths = internal.shader.filePaths;

        const shaderPrefix = this.name('shader', '');

        const renderPipelineKeys = snapshotVgpuPrivateSet(this, 'renderPipelineKeys');

        const computePipelineKeys = snapshotVgpuPrivateSet(this, 'computePipelineKeys');

        const bindingNames = snapshotVgpuPrivateSet(this, 'bindingNames');

        const unsubscribers = snapshotVgpuPrivateSet(this, 'hotReloadUnsubscribers');

        const unsubscribeAuthorities = [];

        for (let index = 0; index < unsubscribers.length; index++) {
            const callable = unsubscribers[index];
            Reflect.apply(VGPU_ARRAY_PUSH, unsubscribeAuthorities, [
                typeof callable === 'function'
                    ? Object.freeze({ receiver: undefined, callable })
                    : null,
            ]);
        }

        const ownedResources = snapshotVgpuPrivateSet(this, 'factoryResources');

        const factoryResources = [];

        for (let index = ownedResources.length - 1; index >= 0; index--) {
            const resource = ownedResources[index];
            const registration = getVgpuPrivateMapEntry(
                internal, '_factoryChildReleases', resource,
            );
            Reflect.apply(VGPU_ARRAY_PUSH, factoryResources, [Object.freeze({
                resource,
                cleanup: registration?.cleanup || captureCoreCleanup(
                    resource, ['destroy', 'dispose', 'clear', 'hide', 'reset'],
                ),
            })]);
        }

        const textureIds = snapshotVgpuPrivateMapValues(this, 'textureIds');

        const bufferIds = snapshotVgpuPrivateMapValues(this, 'bufferIds');

        clearVgpuPrivateSet(this, 'hotReloadUnsubscribers');

        clearVgpuPrivateSet(this, 'factoryResources');

        clearVgpuPrivateMap(this, 'textureIds');

        clearVgpuPrivateMap(this, 'bufferIds');

        clearVgpuPrivateSet(this, 'renderPipelineKeys');

        clearVgpuPrivateSet(this, 'computePipelineKeys');

        clearVgpuPrivateSet(this, 'bindingNames');

        const ownerError = Reflect.apply(

            cleanupAuthorities.ownerReleaseError.callable,

            cleanupAuthorities.ownerReleaseError.receiver,

            [],

        );

        Reflect.apply(

            cleanupAuthorities.cancelAsyncOperations.callable,

            cleanupAuthorities.cancelAsyncOperations.receiver,

            [ownerError],

        );

        safeInvokeCoreCallable(cleanupAuthorities.pipelineCancel, [this, ownerError]);

        safeInvokeCoreCallable(cleanupAuthorities.shaderCancel, [this, ownerError]);

        safeInvokeCoreCallable(cleanupAuthorities.commandCancel, [this, ownerError]);

        for (const unsubscribe of unsubscribeAuthorities) {

            safeInvokeCoreCallable(unsubscribe, []);

        }



        for (const entry of factoryResources) {

            deleteVgpuPrivateSetEntry(internal, '_ownedFactoryResources', entry.resource);

            deleteVgpuPrivateMapEntry(internal, '_factoryChildReleases', entry.resource);

            safeCoreCleanup(entry.cleanup);

        }



        for (const internalId of textureIds) {

            safeInvokeCoreCallable(cleanupAuthorities.textureRelease, [internalId]);

        }

        for (const internalId of bufferIds) {

            safeInvokeCoreCallable(cleanupAuthorities.bufferRelease, [internalId]);

        }

        for (const key of renderPipelineKeys) {

            try { renderPipelines.delete(key); } catch (_) {}

        }

        for (const key of computePipelineKeys) {

            try { computePipelines.delete(key); } catch (_) {}

        }

        for (const key of [...shaderModules.keys()]) {
            if (key.startsWith(shaderPrefix)) shaderModules.delete(key);
        }

        for (const key of [...shaderSources.keys()]) {
            if (key.startsWith(shaderPrefix)) shaderSources.delete(key);
        }

        for (const key of [...shaderFilePaths.keys()]) {
            if (key.startsWith(shaderPrefix)) shaderFilePaths.delete(key);
        }

        clearVgpuPrivateSet(this, 'shaderNames');

        for (const name of bindingNames) {

            const layout = bindingLayouts.get(name);

            if (layout) {

                let objectId = null;

                try {
                    objectId = cleanupAuthorities.bindingObjectId
                        ? Reflect.apply(
                            cleanupAuthorities.bindingObjectId.callable,
                            cleanupAuthorities.bindingObjectId.receiver,
                            [layout],
                        )
                        : null;
                } catch (_) {}

                for (const key of [...bindingGroupCache.keys()]) {

                    if (key.startsWith(`l:${objectId}|`) || key === `l:${objectId}`) {

                        bindingGroupCache.delete(key);

                    }

                }

            }

            bindingLayouts.delete(name);

            bindingLayoutDefs.delete(name);

            bindingLayoutKeys.delete(name);

        }

        if (cleanupAuthorities.memoryRelease) {

            try {

                Reflect.apply(

                    cleanupAuthorities.memoryRelease.callable,
                    cleanupAuthorities.memoryRelease.receiver,
                    [this.memoryOwnerId],

                );

            } catch (_) {}

        }

    }

}



function registerVGPUInstance(vgpu) {

    const rawDevice = vgpu.device;

    const record = {

        id: ++registryRecordId,

        rawDevice,

        owners: new Map(),

    };

    installVgpuPrivateContainer(record, 'owners', new VGPU_NATIVE_MAP());

    const state = {
        active: true,
        generation: vgpu.generation,
        invalidate: null,
        lossInfo: null,
        rawDevice,
        reason: null,
        vgpu,
    };

    Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_REGISTRY_RECORD_STATES, [record, state]);

    const invalidate = (reason = 'invalidated', info = null) => {

            if (!state.active) return false;

            state.active = false;

            state.reason = reason;

            state.lossInfo = info;

            const ownerScopes = snapshotVgpuPrivateMapValues(record, 'owners');

            const cleanupSpecifications = ownerScopes.map((scope, index) => ({
                name: `owner${index}`,
                receiver: scope,
                key: 'releaseResources',
            }));

            cleanupSpecifications.push({
                name: 'teardown',
                receiver: vgpu,
                key: '_teardown',
            });

            const cleanupAuthorities = captureVgpuCleanupCallableSet(
                cleanupSpecifications,
            );

            clearVgpuPrivateMap(record, 'owners');

            invalidateCompatibilityAlias(vgpu, reason);

            for (let index = 0; index < ownerScopes.length; index++) {

                try {
                    const authority = cleanupAuthorities[`owner${index}`];
                    if (authority) Reflect.apply(authority.callable, authority.receiver, []);
                } catch (error) {

                    try {
                        console.warn(`[vGPU] Owner cleanup failed during generation ${state.generation} invalidation:`, error);
                    } catch (_) {}

                }

            }

            const teardown = cleanupAuthorities.teardown;

            return teardown
                ? Reflect.apply(teardown.callable, teardown.receiver, [reason])
                : false;

    };

    state.invalidate = invalidate;

    Object.defineProperties(record, {
        active: { enumerable: true, get: () => state.active, set: () => {} },
        generation: { enumerable: true, get: () => state.generation, set: () => {} },
        invalidate: {
            configurable: false,
            enumerable: true,
            writable: false,
            value: invalidate,
        },
        lossInfo: { enumerable: true, get: () => state.lossInfo, set: () => {} },
        rawDevice: { enumerable: true, get: () => state.rawDevice, set: () => {} },
        reason: { enumerable: true, get: () => state.reason, set: () => {} },
        vgpu: { enumerable: true, get: () => state.vgpu, set: () => {} },
    });

    Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_REGISTRY, [rawDevice, record]);

    return record;

}



function activeRecordFor(deviceOrOptions) {

    if (deviceOrOptions instanceof VirtualGPU) return deviceOrOptions._registryRecord;

    const rawDevice = rawDeviceFrom(deviceOrOptions);

    return getVgpuRegistryRecord(rawDevice);

}



function acquireFromRecord(record, ownerId) {

    if (!record?.active) throw generationInvalidatedError(record?.generation ?? -1, record?.reason);

    const generation = record.generation;

    const vgpu = record.vgpu;

    let normalizedOwnerId;

    try { normalizedOwnerId = String(ownerId || '').trim(); } finally {

        if (!record.active || record.generation !== generation || record.vgpu !== vgpu || vgpu?._destroyed) {

            throw generationInvalidatedError(generation, record.reason || 'invalidated during owner normalization');

        }

    }

    if (!normalizedOwnerId) throw new TypeError('[vGPU] ownerId must be a non-empty string');

    if (!record.active || record.generation !== generation || record.vgpu !== vgpu || vgpu._destroyed) {

        throw generationInvalidatedError(generation, record.reason || 'invalidated before owner acquisition');

    }

    let scope = getVgpuPrivateMapEntry(record, 'owners', normalizedOwnerId);

    if (!scope || scope.released) {

        scope = new VGPUOwnerScope(record, normalizedOwnerId);

        if (!record.active || record.generation !== generation || record.vgpu !== vgpu || vgpu._destroyed) {

            scope.releaseResources();

            throw generationInvalidatedError(generation, record.reason || 'invalidated during owner acquisition');

        }

        setVgpuPrivateMapEntry(record, 'owners', normalizedOwnerId, scope);

    }

    adjustVgpuOwnerScopeLeaseCount(scope, 1);

    if (!record.active || record.generation !== generation || record.vgpu !== vgpu || vgpu._destroyed) {

        adjustVgpuOwnerScopeLeaseCount(scope, -1);

        if (scope.leaseCount === 0) scope.releaseResources();

        throw generationInvalidatedError(generation, record.reason || 'invalidated before owner publication');

    }

    let released = false;

    const release = () => {

        if (released) return false;

        released = true;

        adjustVgpuOwnerScopeLeaseCount(scope, -1);

        if (scope.leaseCount === 0) {

            scope.releaseResources();

            if (getVgpuPrivateMapEntry(record, 'owners', normalizedOwnerId) === scope) {
                deleteVgpuPrivateMapEntry(record, 'owners', normalizedOwnerId);
            }

        }

        return true;

    };

    const lease = {};

    Object.defineProperties(lease, {

        ownerId: { enumerable: true, value: normalizedOwnerId },

        generation: { enumerable: true, value: record.generation },

        vgpu: { enumerable: true, value: scope.view },

        view: { enumerable: true, value: scope.view },

        released: { enumerable: true, get: () => released },

        valid: { enumerable: true, get: () => !released && record.active && !scope.released },

        release: { enumerable: true, value: release },

    });

    return Object.freeze(lease);

}



// ============================================================================

// USAGE FLAGS - Simplified buffer usage strings

// ============================================================================



const USAGE_MAP = {

    'vertex': GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,

    'index': GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,

    'uniform': GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,

    'storage': GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,

    'storage-read': GPUBufferUsage.STORAGE,

    'indirect': GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,

    'read': GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,

    'write': GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,

    'copy-src': GPUBufferUsage.COPY_SRC,

    'copy-dst': GPUBufferUsage.COPY_DST,

    'map-read': GPUBufferUsage.MAP_READ,

    'map-write': GPUBufferUsage.MAP_WRITE,

};



function resolveUsage(usage) {

    if (typeof usage === 'number') return usage;

    if (typeof usage === 'string') {

        const flags = usage.split('|').map(u => USAGE_MAP[u.trim()]);

        return flags.reduce((a, b) => a | b, 0);

    }

    return GPUBufferUsage.COPY_DST;

}



function initializeCoreManagerLifecycle(manager, vgpu, label) {

    const state = {
        destroyed: false,
        destroyError: null,
        generation: 0,
        label,
        parentGeneration: vgpu.generation,
        slots: Object.create(null),
        slotAssigned: Object.create(null),
    };

    state.slots.vgpu = vgpu;
    state.slotAssigned.vgpu = true;

    Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_CORE_MANAGER_STATES, [manager, state]);

    Object.defineProperties(manager, {
        _managerLabel: {
            configurable: false,
            enumerable: false,
            get: () => state.label,
            set: () => {},
        },
        _generation: {
            configurable: false,
            enumerable: false,
            get: () => state.generation,
            set: () => {},
        },
        _parentGeneration: {
            configurable: false,
            enumerable: false,
            get: () => state.parentGeneration,
            set: () => {},
        },
        _destroyed: {
            configurable: false,
            enumerable: false,
            get: () => state.destroyed,
            set: () => {},
        },
        _destroyError: {
            configurable: false,
            enumerable: false,
            get: () => state.destroyError,
            set: () => {},
        },
        vgpu: {
            configurable: false,
            enumerable: true,
            get: () => state.slots.vgpu,
            set: value => {
                if (!state.slotAssigned.vgpu || (state.destroyed && value === null)) {
                    state.slotAssigned.vgpu = true;
                    state.slots.vgpu = value;
                }
            },
        },
        device: {
            configurable: false,
            enumerable: true,
            get: () => state.slots.device,
            set: value => {
                if (!state.slotAssigned.device || (state.destroyed && value === null)) {
                    state.slotAssigned.device = true;
                    state.slots.device = value;
                }
            },
        },
        queue: {
            configurable: false,
            enumerable: true,
            get: () => state.slots.queue,
            set: value => {
                if (!state.slotAssigned.queue || (state.destroyed && value === null)) {
                    state.slotAssigned.queue = true;
                    state.slots.queue = value;
                }
            },
        },
    });

    return state;

}

function getCoreManagerLifecycleState(manager) {
    return Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_CORE_MANAGER_STATES, [manager]) || null;
}

function advanceCoreManagerGeneration(manager) {
    const state = getCoreManagerLifecycleState(manager);
    if (!state) throw new TypeError('[vGPU] Core manager lifecycle state is unavailable');
    state.generation++;
    return state.generation;
}

function setCoreManagerDestroyError(manager, error) {
    const state = getCoreManagerLifecycleState(manager);
    if (!state) throw new TypeError('[vGPU] Core manager lifecycle state is unavailable');
    state.destroyError = error;
    return error;
}

function setCoreManagerPrivateValue(manager, name, value) {
    const state = getCoreManagerLifecycleState(manager);
    if (!state) throw new TypeError('[vGPU] Core manager lifecycle state is unavailable');
    if (!state.values) state.values = Object.create(null);
    state.values[name] = value;
    return value;
}

function getCoreManagerPrivateValue(manager, name) {
    return getCoreManagerLifecycleState(manager)?.values?.[name];
}

function createVgpuQueryPoolFacade(state) {
    const pool = {};
    Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_QUERY_POOL_STATES, [pool, state]);
    const properties = {};
    const names = [
        'querySet', 'resolveBuffer', 'resultBuffer', 'count', 'nextIndex',
    ];
    for (let index = 0; index < names.length; index++) {
        const name = names[index];
        properties[name] = {
            configurable: false,
            enumerable: true,
            get: () => state[name],
            set: () => {},
        };
    }
    Object.defineProperties(pool, properties);
    return pool;
}

function getVgpuQueryPoolState(pool) {
    return pool
        ? Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_QUERY_POOL_STATES, [pool]) || null
        : null;
}

function severCoreManagerProperties(manager, names) {
    const state = getCoreManagerLifecycleState(manager);
    for (const name of names) {
        if (state && name in state.slots) {
            state.slots[name] = null;
            state.slotAssigned[name] = true;
            continue;
        }
        try {
            Reflect.defineProperty(manager, name, {
                configurable: true,
                enumerable: true,
                writable: true,
                value: null,
            });
        } catch (_) {}
    }
}



function coreManagerLifecycleError(manager, reason = 'destroyed') {

    const state = getCoreManagerLifecycleState(manager);

    return state?.destroyError || generationInvalidatedError(

        state?.parentGeneration ?? manager._parentGeneration,

        `${state?.label || manager._managerLabel || 'core-manager'}-${reason}`,

    );

}



function assertCoreManagerAlive(manager, generation = manager._generation) {

    const state = getCoreManagerLifecycleState(manager);

    const parent = manager.vgpu;

    if (

        !state

        || state.destroyed

        || generation !== state.generation

        || !parent

        || parent._destroyed

        || parent.generation !== state.parentGeneration

    ) {

        throw coreManagerLifecycleError(manager);

    }

    return parent;

}



function terminateCoreManagerLifecycle(manager) {

    const state = getCoreManagerLifecycleState(manager);

    if (!state || state.destroyed) return false;

    state.destroyed = true;

    state.generation++;

    state.destroyError = generationInvalidatedError(
        state.parentGeneration, `${state.label || 'core-manager'}-destroyed`,
    );

    return true;

}



function readCoreManagerValue(manager, generation, target, key) {

    let value;

    try {

        value = target[key];

    } finally {

        assertCoreManagerAlive(manager, generation);

    }

    return value;

}



function captureCoreManagerCallable(manager, generation, receiver, key, operation = String(key)) {

    assertCoreManagerAlive(manager, generation);

    const callable = readCoreManagerValue(manager, generation, receiver, key);

    if (typeof callable !== 'function') {

        throw new TypeError(`[vGPU] ${operation} is unavailable`);

    }

    assertCoreManagerAlive(manager, generation);

    return Object.freeze({ receiver, callable });

}



function captureCoreManagerPropertySlot(manager, generation, receiver, key) {

    assertCoreManagerAlive(manager, generation);

    let cursor = receiver;

    const visited = new VGPU_NATIVE_SET();

    while (cursor && !Reflect.apply(VGPU_SET_HAS, visited, [cursor])) {

        Reflect.apply(VGPU_SET_ADD, visited, [cursor]);

        let descriptor;

        try { descriptor = Reflect.getOwnPropertyDescriptor(cursor, key); }

        finally { assertCoreManagerAlive(manager, generation); }

        if (descriptor) {

            return Object.freeze({

                receiver,

                descriptor: Object.freeze({ ...descriptor }),

            });

        }

        try { cursor = Reflect.getPrototypeOf(cursor); }

        finally { assertCoreManagerAlive(manager, generation); }

    }

    return Object.freeze({ receiver, descriptor: null });

}



function readCoreManagerPropertySlot(manager, generation, slot) {

    const descriptor = slot.descriptor;

    if (!descriptor) {

        assertCoreManagerAlive(manager, generation);

        return undefined;

    }

    let value;

    try {

        value = 'value' in descriptor

            ? descriptor.value

            : (typeof descriptor.get === 'function'

                ? Reflect.apply(descriptor.get, slot.receiver, [])

                : undefined);

    } finally {

        assertCoreManagerAlive(manager, generation);

    }

    return value;

}



function captureCoreManagerCallableSet(manager, generation, specifications) {

    const staged = specifications.map(specification => Object.freeze({

        ...specification,

        slot: captureCoreManagerPropertySlot(

            manager, generation, specification.receiver, specification.key,

        ),

    }));

    const authorities = {};

    for (const specification of staged) {

        const callable = readCoreManagerPropertySlot(

            manager, generation, specification.slot,

        );

        if (typeof callable !== 'function') {

            if (specification.optional) {

                authorities[specification.name] = null;

                continue;

            }

            throw new TypeError(

                `[vGPU] ${specification.operation || String(specification.key)} is unavailable`,

            );

        }

        authorities[specification.name] = Object.freeze({

            receiver: specification.receiver,

            callable,

        });

    }

    return Object.freeze(authorities);

}



function silenceCorePromise(value) {

    silenceVgpuPromise(value);

}



function invokeCoreManagerCallable(

    manager, generation, captured, args, retireResult = null,

) {

    assertCoreManagerAlive(manager, generation);

    let result;

    let callError = null;

    try {

        result = Reflect.apply(captured.callable, captured.receiver, args);

    } catch (error) {

        callError = error;

    }

    try {

        assertCoreManagerAlive(manager, generation);

    } catch (error) {

        if (retireResult && result) {

            try { retireResult(result); } catch (_) {}

        }

        silenceCorePromise(result);

        throw error;

    }

    if (callError) throw callError;

    return result;

}



function callCoreManagerExternal(

    manager, generation, receiver, key, args, operation = String(key), retireResult = null,

) {

    const captured = captureCoreManagerCallable(manager, generation, receiver, key, operation);

    return invokeCoreManagerCallable(manager, generation, captured, args, retireResult);

}



function normalizeCoreManagerValue(manager, generation, normalize) {

    let value;

    try {

        value = normalize();

    } finally {

        assertCoreManagerAlive(manager, generation);

    }

    return value;

}



function snapshotCoreManagerObject(manager, generation, source, keys) {

    const snapshot = {};

    for (const key of keys) {

        snapshot[key] = readCoreManagerValue(manager, generation, source, key);

    }

    return snapshot;

}



function snapshotCoreManagerArray(manager, generation, source, entryKeys) {

    const lengthValue = readCoreManagerValue(manager, generation, source, 'length');

    const length = normalizeCoreManagerValue(manager, generation, () => Number(lengthValue));

    if (!Number.isSafeInteger(length) || length < 0) {

        throw new TypeError('[vGPU] Expected a finite array-like input');

    }

    const snapshot = new Array(length);

    for (let index = 0; index < length; index++) {

        const entry = readCoreManagerValue(manager, generation, source, index);

        snapshot[index] = snapshotCoreManagerObject(manager, generation, entry, entryKeys);

    }

    return snapshot;

}



function snapshotCoreManagerValues(manager, generation, source) {

    const lengthValue = readCoreManagerValue(manager, generation, source, 'length');

    const length = normalizeCoreManagerValue(manager, generation, () => Number(lengthValue));

    if (!Number.isSafeInteger(length) || length < 0) {

        throw new TypeError('[vGPU] Expected a finite array-like input');

    }

    const snapshot = new Array(length);

    for (let index = 0; index < length; index++) {

        snapshot[index] = readCoreManagerValue(manager, generation, source, index);

    }

    return snapshot;

}



function snapshotCoreManagerOptions(manager, generation, options) {

    if (options == null) return Object.freeze({});

    const snapshot = {};

    let keys;

    try {

        keys = Reflect.ownKeys(options);

    } finally {

        assertCoreManagerAlive(manager, generation);

    }

    for (const key of keys) {

        let descriptor;

        try {

            descriptor = Reflect.getOwnPropertyDescriptor(options, key);

        } finally {

            assertCoreManagerAlive(manager, generation);

        }

        if (!descriptor?.enumerable) continue;

        snapshot[key] = readCoreManagerValue(manager, generation, options, key);

    }

    return Object.freeze(snapshot);

}



function snapshotCoreManagerBytes(manager, generation, data) {

    if (data == null) return null;

    return normalizeCoreManagerValue(manager, generation, () => {

        if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));

        if (ArrayBuffer.isView(data)) {

            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();

        }

        throw new TypeError('[vGPU] Buffer and texture data must be an ArrayBuffer or typed array');

    });

}



const CORE_CLEANUP_RECORD = Symbol('CORE_CLEANUP_RECORD');

const CORE_CLEANUP_RECORDS = new WeakSet();



function captureCoreCleanup(target, methodNames = ['destroy', 'dispose']) {

    if (!target) return false;

    for (const methodName of methodNames) {

        let cursor = target;

        const visited = new VGPU_NATIVE_SET();

        while (cursor && !Reflect.apply(VGPU_SET_HAS, visited, [cursor])) {

            Reflect.apply(VGPU_SET_ADD, visited, [cursor]);

            let descriptor = null;

            try { descriptor = Reflect.getOwnPropertyDescriptor(cursor, methodName); } catch (_) {}

            if (typeof descriptor?.value === 'function') {

                const record = {

                    [CORE_CLEANUP_RECORD]: true,

                    target,

                    callable: descriptor.value,

                    methodName,

                };

                Reflect.apply(VGPU_WEAK_SET_ADD, CORE_CLEANUP_RECORDS, [record]);

                return Object.freeze(record);

            }

            try { cursor = Reflect.getPrototypeOf(cursor); } catch (_) { cursor = null; }

        }

    }

    return false;

}



function safeCoreCleanup(targetOrRecord, methodNames = ['destroy', 'dispose']) {

    const record = Reflect.apply(VGPU_WEAK_SET_HAS, CORE_CLEANUP_RECORDS, [targetOrRecord])

        ? targetOrRecord

        : captureCoreCleanup(targetOrRecord, methodNames);

    if (!record) return false;

    try { Reflect.apply(record.callable, record.target, []); } catch (_) {}

    return true;

}



function safeInvokeCoreCallable(captured, args = []) {

    if (!captured) return false;

    try { Reflect.apply(captured.callable, captured.receiver, args); } catch (_) {}

    return true;

}



function safeMemoryUntrack(memory, resource) {

    if (!memory || !resource) return;

    const fallback = (attempted = null) => {

        let prototype;

        try { prototype = Object.getPrototypeOf(memory); } catch (_) { return; }

        while (prototype) {

            let descriptor;

            try { descriptor = Object.getOwnPropertyDescriptor(prototype, 'untrack'); } catch (_) {}

            const method = descriptor?.value;

            if (typeof method === 'function' && method !== attempted) {

                try { method.call(memory, resource); } catch (_) {}

                return;

            }

            try { prototype = Object.getPrototypeOf(prototype); } catch (_) { return; }

        }

    };

    let untrack;

    try {

        untrack = memory.untrack;

    } catch (_) {

        fallback();

        return;

    }

    if (typeof untrack !== 'function') {

        fallback(untrack);

        return;

    }

    try {

        untrack.call(memory, resource);

    } catch (_) {

        fallback(untrack);

    }

}



// ============================================================================

// BUFFER MANAGER

// ============================================================================



class VGPUBufferManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'buffer');

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this.pool = new BufferPool(vgpu.device, { maxPoolSize: 256 });

        this._poolCleanup = captureCoreCleanup(this.pool);

        setCoreManagerPrivateValue(this, 'pool', this.pool);

        setCoreManagerPrivateValue(this, 'poolCleanup', this._poolCleanup);

        this.managed = new VGPU_NATIVE_MAP(); // id -> buffer

        installVgpuPrivateContainer(
            this,
            'managed',
            new VGPU_NATIVE_MAP(),
            entry => Object.freeze({
                buffer: entry.buffer,
                pooled: entry.pooled,
                size: entry.size,
                usage: entry.usage,
            }),
        );

        this._nextId = 1;

    }



    /**

     * Create a buffer with simplified options

     * @param {Object} options

     * @param {number} options.size - Buffer size in bytes

     * @param {string|number} options.usage - 'vertex', 'index', 'uniform', 'storage', etc.

     * @param {string} [options.label] - Debug label

     * @param {ArrayBuffer|TypedArray} [options.data] - Initial data to upload

     * @param {boolean} [options.pooled=false] - Use buffer pooling

     * @returns {{ buffer: GPUBuffer, id: number }}

     */

    create(options) {

        const generation = this._generation;

        const parent = assertCoreManagerAlive(this, generation);

        // Capture every external authority before caller-controlled option
        // getters or coercions can replace it.  Selection remains deferred
        // until the normalized options are known, but the authority itself is
        // immutable for this transaction.
        const pool = getCoreManagerPrivateValue(this, 'pool');

        const device = this.device;

        const queue = readCoreManagerValue(this, generation, parent, 'queue');

        const memory = readCoreManagerValue(this, generation, this.vgpu, 'memory');

        const authoritySpecifications = [

            { name: 'poolAcquire', receiver: pool, key: 'acquire', operation: 'buffer pool acquire' },

            { name: 'poolRelease', receiver: pool, key: 'release', operation: 'buffer pool release' },

            { name: 'createBuffer', receiver: device, key: 'createBuffer', operation: 'buffer creation' },

            { name: 'writeBuffer', receiver: queue, key: 'writeBuffer', operation: 'pooled buffer initial upload' },

        ];

        if (memory) authoritySpecifications.push(

            { name: 'trackBuffer', receiver: memory, key: 'trackBuffer', operation: 'buffer memory tracking', optional: true },

            { name: 'untrackBuffer', receiver: memory, key: 'untrack', operation: 'buffer memory untracking', optional: true },

        );

        const authorities = captureCoreManagerCallableSet(

            this, generation, authoritySpecifications,

        );

        const values = snapshotCoreManagerObject(this, generation, options, [

            'size', 'usage', 'label', 'data', 'pooled',

        ]);

        const size = normalizeCoreManagerValue(this, generation, () => Number(values.size));

        const normalizedUsage = values.usage == null

            ? GPUBufferUsage.COPY_DST

            : normalizeCoreManagerValue(this, generation, () => (

                typeof values.usage === 'number' ? values.usage : String(values.usage)

            ));

        const usageFlags = resolveUsage(normalizedUsage);

        const data = snapshotCoreManagerBytes(this, generation, values.data);

        const pooled = Boolean(values.pooled);

        const id = this._nextId++;

        const bufferLabel = values.label == null || values.label === ''

            ? `vgpu_buffer_${id}`

            : normalizeCoreManagerValue(this, generation, () => String(values.label));

        const acquire = pooled
            ? authorities.poolAcquire
            : null;

        const createBuffer = pooled
            ? null
            : authorities.createBuffer;

        const writeBuffer = pooled && data !== null ? authorities.writeBuffer : null;

        const trackBuffer = authorities.trackBuffer || null;

        const untrackBuffer = authorities.untrackBuffer || null;

        let buffer = null;

        let bufferCleanup = null;

        let poolRelease = null;

        let trackedMemory = null;

        try {

            assertCoreManagerAlive(this, generation);

            if (pooled) {
                assertCoreManagerAlive(this, generation);

                poolRelease = authorities.poolRelease;

                buffer = Reflect.apply(
                    acquire.callable, acquire.receiver, [size, usageFlags, bufferLabel],
                );

                bufferCleanup = captureCoreCleanup(buffer);

                assertCoreManagerAlive(this, generation);

            } else {
                assertCoreManagerAlive(this, generation);

                buffer = Reflect.apply(createBuffer.callable, createBuffer.receiver, [{

                    size,

                    usage: usageFlags,

                    label: bufferLabel,

                    mappedAtCreation: data !== null,

                }]);

                bufferCleanup = captureCoreCleanup(buffer);

            }

            assertCoreManagerAlive(this, generation);

            if (!bufferCleanup) bufferCleanup = captureCoreCleanup(buffer);

            assertCoreManagerAlive(this, generation);

            if (!pooled && data !== null) {

                const mappedAuthorities = captureCoreManagerCallableSet(this, generation, [
                    {
                        name: 'getMappedRange',
                        receiver: buffer,
                        key: 'getMappedRange',
                        operation: 'mapped buffer access',
                    },
                    {
                        name: 'unmap',
                        receiver: buffer,
                        key: 'unmap',
                        operation: 'mapped buffer unmap',
                    },
                ]);

                assertCoreManagerAlive(this, generation);

                const mappedRange = Reflect.apply(
                    mappedAuthorities.getMappedRange.callable,
                    mappedAuthorities.getMappedRange.receiver,
                    [],
                );

                assertCoreManagerAlive(this, generation);

                new Uint8Array(mappedRange).set(data);

                assertCoreManagerAlive(this, generation);

                Reflect.apply(
                    mappedAuthorities.unmap.callable,
                    mappedAuthorities.unmap.receiver,
                    [],
                );

                assertCoreManagerAlive(this, generation);

            }

            if (pooled && data !== null) {
                invokeCoreManagerCallable(
                    this, generation, writeBuffer,
                    [buffer, 0, data.buffer, data.byteOffset, data.byteLength],
                );

            }

            if (memory) {

                trackedMemory = memory;

                if (trackBuffer) {

                    assertCoreManagerAlive(this, generation);

                    trackedMemory = memory;

                    Reflect.apply(
                        trackBuffer.callable, trackBuffer.receiver, [buffer, bufferLabel],
                    );

                    assertCoreManagerAlive(this, generation);

                }

            }

            assertCoreManagerAlive(this, generation);

            setVgpuPrivateMapEntry(this, 'managed', id, Object.freeze({

                buffer,

                pooled,

                usage: usageFlags,

                size,

                cleanup: bufferCleanup,

                poolRelease,

                memoryUntrack: untrackBuffer,

            }));

            return { buffer, id };

        } catch (error) {

            let poolDestroyed = pooled;

            if (pooled) {
                try { poolDestroyed = Boolean(pool.destroyed); } catch (_) {}
            }

            if (trackedMemory) safeInvokeCoreCallable(untrackBuffer, [buffer]);

            if (buffer) {

                if (pooled && !poolDestroyed) {

                    try {

                        if (!poolRelease) throw new Error('buffer pool release unavailable');

                        const released = Reflect.apply(
                            poolRelease.callable, poolRelease.receiver, [buffer],
                        );

                        if (released !== true) safeCoreCleanup(bufferCleanup || buffer);

                    } catch (_) { safeCoreCleanup(bufferCleanup || buffer); }

                } else {

                    try { pool.inUse?.delete?.(buffer); } catch (_) {}

                    safeCoreCleanup(bufferCleanup || buffer);

                }

            }

            throw error;

        }

    }



    /**

     * Write data to a buffer

     */

    write(buffer, data, offset = 0) {

        const generation = this._generation;

        const parent = assertCoreManagerAlive(this, generation);

        const queue = readCoreManagerValue(this, generation, parent, 'queue');

        const writeBuffer = captureCoreManagerCallable(

            this, generation, queue, 'writeBuffer', 'buffer write',

        );

        const bytes = snapshotCoreManagerBytes(this, generation, data);

        const normalizedOffset = normalizeCoreManagerValue(this, generation, () => Number(offset));

        invokeCoreManagerCallable(

            this, generation, writeBuffer,

            [buffer, normalizedOffset, bytes.buffer, bytes.byteOffset, bytes.byteLength],

        );

    }



    /**

     * Release a buffer back to the pool or destroy it

     */

    release(id) {

        assertCoreManagerAlive(this);

        return this._releaseManaged(id);

    }



    _releaseManaged(id) {

        const entry = getVgpuPrivateMapEntry(this, 'managed', id);

        if (!entry) return false;

        const memoryUntrack = captureVgpuCallable(this.vgpu?.memory, 'untrack')

            || entry.memoryUntrack;

        deleteVgpuPrivateMapEntry(this, 'managed', id);

        safeInvokeCoreCallable(memoryUntrack, [entry.buffer]);

        if (entry.pooled) {

            try {

                if (!entry.poolRelease) throw new Error('buffer pool release unavailable');

                Reflect.apply(entry.poolRelease.callable, entry.poolRelease.receiver, [entry.buffer]);

            } catch (_) { safeCoreCleanup(entry.cleanup || entry.buffer); }

        } else {

            safeCoreCleanup(entry.cleanup || entry.buffer);

        }

        return true;

    }



    /**

     * Get buffer by ID

     */

    get(id) {

        assertCoreManagerAlive(this);

        return getVgpuPrivateMapEntry(this, 'managed', id)?.buffer;

    }



    getStats() {

        assertCoreManagerAlive(this);

        return {

            managed: snapshotVgpuPrivateMapValues(this, 'managed').length,

            pool: getCoreManagerPrivateValue(this, 'pool').getStats(),

        };

    }



    destroy() {

        const entries = snapshotVgpuPrivateMapValues(this, 'managed');

        const parent = getCoreManagerLifecycleState(this)?.slots?.vgpu || null;

        const memoryUntrack = captureVgpuCallable(parent?.memory, 'untrack');

        if (!terminateCoreManagerLifecycle(this)) return false;

        const pool = getCoreManagerPrivateValue(this, 'pool');

        const poolCleanup = getCoreManagerPrivateValue(this, 'poolCleanup');

        setCoreManagerPrivateValue(this, 'pool', null);

        setCoreManagerPrivateValue(this, 'poolCleanup', null);

        clearVgpuPrivateMap(this, 'managed');

        for (const entry of entries) {

            safeInvokeCoreCallable(memoryUntrack || entry.memoryUntrack, [entry.buffer]);

            safeCoreCleanup(entry.cleanup);

        }

        safeCoreCleanup(poolCleanup || pool);

        severCoreManagerProperties(this, ['pool', '_poolCleanup', 'device', 'vgpu']);

        return true;

    }

}



// ============================================================================

// BINDING MANAGER - Layouts and Groups

// ============================================================================



class VGPUBindingManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'bindings');

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this.layouts = new Map();      // name -> GPUBindGroupLayout

        this.layoutDefs = new Map();   // name -> definition (for recreation)

        this.layoutKeys = new Map();   // name -> canonical descriptor key

        this.groupCache = new Map();   // hash -> GPUBindGroup

        this._idByObject = new WeakMap();

        this._nextObjectId = 1;

    }



    /**

     * Define a named bind group layout

     * @param {string} name - Layout name for reuse

     * @param {Array} entries - Simplified entry definitions

     * @returns {GPUBindGroupLayout}

     *

     * Entry format: { binding, type, visibility? }

     * Types: 'uniform', 'storage', 'read-storage', 'sampler', 'texture', 'storage-texture'

     */

    defineLayout(name, entries) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const device = this.device;

        const createBindGroupLayout = captureCoreManagerCallable(

            this, generation, device, 'createBindGroupLayout', 'bind-group layout creation',

        );

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(name));

        const snapshot = snapshotCoreManagerArray(this, generation, entries, [

            'binding', 'type', 'visibility', 'hasDynamicOffset', 'minBindingSize',

            'samplerType', 'sampleType', 'viewDimension', 'dimension',

            'multisampled', 'access', 'format',

        ]).map(entry => {

            const normalized = { ...entry };

            normalized.binding = normalizeCoreManagerValue(this, generation, () => Number(entry.binding));

            normalized.type = normalizeCoreManagerValue(this, generation, () => String(entry.type));

            normalized.visibility = typeof entry.visibility === 'number'

                ? entry.visibility

                : normalizeCoreManagerValue(this, generation, () => String(entry.visibility ?? 'compute'));

            for (const key of ['samplerType', 'sampleType', 'viewDimension', 'dimension', 'access', 'format']) {

                if (entry[key] != null) {

                    normalized[key] = normalizeCoreManagerValue(this, generation, () => String(entry[key]));

                }

            }

            if (entry.minBindingSize != null) {

                normalized.minBindingSize = normalizeCoreManagerValue(this, generation, () => Number(entry.minBindingSize));

            }

            normalized.hasDynamicOffset = entry.hasDynamicOffset == null ? undefined : Boolean(entry.hasDynamicOffset);

            normalized.multisampled = Boolean(entry.multisampled);

            return Object.freeze(normalized);

        });

        const descriptorKey = stableDescriptorKey(snapshot);

        assertCoreManagerAlive(this, generation);

        if (this.layouts.has(normalizedName)) {

            if (this.layoutKeys.get(normalizedName) !== descriptorKey) {

                const error = new Error(`[vGPU] Bind group layout name collision: ${normalizedName}`);

                error.code = 'VGPU_LAYOUT_NAME_COLLISION';

                throw error;

            }

            return this.layouts.get(normalizedName);

        }

        const gpuEntries = snapshot.map(entry => this._toLayoutEntry(entry));

        assertCoreManagerAlive(this, generation);

        const layout = invokeCoreManagerCallable(this, generation, createBindGroupLayout, [{

            label: `vgpu_layout_${normalizedName}`,

            entries: gpuEntries,

        }]);

        this.layouts.set(normalizedName, layout);

        this.layoutDefs.set(normalizedName, Object.freeze(snapshot));

        this.layoutKeys.set(normalizedName, descriptorKey);

        return layout;

    }



    _toLayoutEntry(entry) {

        const { binding, type, visibility = 'compute', hasDynamicOffset, minBindingSize } = entry;



        const vis = this._resolveVisibility(visibility);

        const result = { binding, visibility: vis };



        switch (type) {

            case 'uniform':

                result.buffer = { type: 'uniform' };

                if (hasDynamicOffset !== undefined) result.buffer.hasDynamicOffset = hasDynamicOffset;

                if (minBindingSize !== undefined) result.buffer.minBindingSize = minBindingSize;

                break;

            case 'storage':

                result.buffer = { type: 'storage' };

                if (hasDynamicOffset !== undefined) result.buffer.hasDynamicOffset = hasDynamicOffset;

                if (minBindingSize !== undefined) result.buffer.minBindingSize = minBindingSize;

                break;

            case 'read-storage':

                result.buffer = { type: 'read-only-storage' };

                if (hasDynamicOffset !== undefined) result.buffer.hasDynamicOffset = hasDynamicOffset;

                if (minBindingSize !== undefined) result.buffer.minBindingSize = minBindingSize;

                break;

            case 'sampler':

                result.sampler = { type: entry.samplerType || 'filtering' };

                break;

            case 'comparison-sampler':

                result.sampler = { type: 'comparison' };

                break;

            case 'texture':

                result.texture = {

                    sampleType: entry.sampleType || 'float',

                    viewDimension: entry.viewDimension || entry.dimension || '2d',

                    multisampled: entry.multisampled || false,

                };

                break;

            case 'storage-texture':

                result.storageTexture = {

                    access: entry.access || 'write-only',

                    format: entry.format || 'rgba8unorm',

                    viewDimension: entry.viewDimension || entry.dimension || '2d',

                };

                break;

            case 'external':

                result.externalTexture = {};

                break;

            default:

                result.buffer = { type: 'uniform' };

        }



        return result;

    }



    _resolveVisibility(vis) {

        if (typeof vis === 'number') return vis;



        const parts = vis.split('|').map(v => v.trim().toLowerCase());

        let flags = 0;

        for (const part of parts) {

            if (part === 'vertex') flags |= GPUShaderStage.VERTEX;

            if (part === 'fragment') flags |= GPUShaderStage.FRAGMENT;

            if (part === 'compute') flags |= GPUShaderStage.COMPUTE;

        }

        return flags || GPUShaderStage.COMPUTE;

    }



    /**

     * Get a cached or create bind group

     * @param {string|GPUBindGroupLayout} layout - Layout name or object

     * @param {Array} entries - Bind group entries

     * @param {string} [label]

     */

    createGroup(layout, entries, label = '') {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const device = this.device;

        const createBindGroup = captureCoreManagerCallable(

            this, generation, device, 'createBindGroup', 'bind-group creation',

        );

        const normalizedLabel = label == null || label === ''

            ? ''

            : normalizeCoreManagerValue(this, generation, () => String(label));

        const layoutName = typeof layout === 'string'

            ? normalizeCoreManagerValue(this, generation, () => String(layout))

            : null;

        const layoutObj = layoutName !== null ? this.layouts.get(layoutName) : layout;

        assertCoreManagerAlive(this, generation);

        if (!layoutObj) throw new Error(`[vGPU] Unknown layout: ${layoutName ?? '<object>'}`);

        const snapshot = snapshotCoreManagerArray(this, generation, entries, [

            'binding', 'buffer', 'offset', 'size', 'sampler', 'textureView', 'resource',

        ]).map((entry, index) => Object.freeze({

            ...entry,

            binding: entry.binding == null

                ? index

                : normalizeCoreManagerValue(this, generation, () => Number(entry.binding)),

            offset: entry.offset == null

                ? 0

                : normalizeCoreManagerValue(this, generation, () => Number(entry.offset)),

            size: entry.size == null

                ? undefined

                : normalizeCoreManagerValue(this, generation, () => Number(entry.size)),

        }));

        const key = this._generateKey(layoutObj, snapshot);

        assertCoreManagerAlive(this, generation);

        const cached = this.groupCache.get(key);

        if (cached) return cached;

        const gpuEntries = snapshot.map(entry => ({

            binding: entry.binding,

            resource: this._toResource(entry),

        }));

        assertCoreManagerAlive(this, generation);

        const bindGroup = invokeCoreManagerCallable(this, generation, createBindGroup, [{

            label: normalizedLabel || `vgpu_group_${key.substring(0, 16)}`,

            layout: layoutObj,

            entries: gpuEntries,

        }]);

        this.groupCache.set(key, bindGroup);

        return bindGroup;

    }



    _toResource(entry) {

        if (entry.buffer) {

            return {

                buffer: entry.buffer,

                offset: entry.offset || 0,

                size: entry.size,

            };

        }

        if (entry.sampler) return entry.sampler;

        if (entry.textureView) return entry.textureView;

        if (entry.resource) return entry.resource;

        return entry;

    }



    _generateKey(layout, entries) {

        const parts = [`l:${this._getObjectId(layout)}`];

        for (const entry of entries) {

            const binding = entry.binding ?? entries.indexOf(entry);

            if (entry.buffer) {

                parts.push(`${binding}:b:${this._getObjectId(entry.buffer)}:${entry.offset || 0}:${entry.size || 0}`);

            } else if (entry.sampler) {

                parts.push(`${binding}:s:${this._getObjectId(entry.sampler)}`);

            } else if (entry.textureView) {

                parts.push(`${binding}:t:${this._getObjectId(entry.textureView)}`);

            } else if (entry.resource) {

                parts.push(`${binding}:r:${this._getObjectId(entry.resource)}`);

            }

        }

        return parts.join('|');

    }



    _getObjectId(obj) {

        if (!obj) return 0;

        let id = this._idByObject.get(obj);

        if (!id) {

            id = this._nextObjectId++;

            this._idByObject.set(obj, id);

        }

        return id;

    }



    /**

     * Get a layout by name

     */

    getLayout(name) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(name));

        return this.layouts.get(normalizedName);

    }



    /**

     * Clear bind group cache (call on device loss or major state change)

     */

    clearCache() {

        assertCoreManagerAlive(this);

        this.groupCache.clear();

    }



    destroy() {

        if (!terminateCoreManagerLifecycle(this)) return false;

        this.groupCache.clear();

        this.layouts.clear();

        this.layoutDefs.clear();

        this.layoutKeys.clear();

        this._idByObject = new WeakMap();

        this.device = null;

        this.vgpu = null;

        return true;

    }



    getStats() {

        assertCoreManagerAlive(this);

        return {

            layouts: this.layouts.size,

            cachedGroups: this.groupCache.size,

        };

    }

}



// ============================================================================

// SHADER MANAGER

// ============================================================================



class VGPUShaderManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'shader');

        setCoreManagerPrivateValue(this, 'captureCancellationAuthority', Object.freeze({
            receiver: this,
            callable: this._captureShaderCancellationBatch,
        }));

        setCoreManagerPrivateValue(this, 'cancelBatchAuthority', Object.freeze({
            receiver: this,
            callable: this._cancelShaderBatch,
        }));

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this.modules = new Map();   // name -> GPUShaderModule

        this.sources = new Map();   // name -> source code

        this.filePaths = new Map(); // name -> file path (for hot reload)

        this._hotReloadEnabled = false;

        this._hotReloadCallbacks = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, '_hotReloadCallbacks', new VGPU_NATIVE_SET());

        this._recompileCount = 0;

        this._recompileRevisions = new VGPU_NATIVE_MAP();

        installVgpuPrivateContainer(this, '_recompileRevisions', new VGPU_NATIVE_MAP());

        this._operations = new VGPU_NATIVE_SET();

        installVgpuPrivateContainer(this, '_operations', new VGPU_NATIVE_SET());

        this._recompileOperations = new VGPU_NATIVE_MAP();

        installVgpuPrivateContainer(this, '_recompileOperations', new VGPU_NATIVE_MAP());

        this._diagnosticControllers = new VGPU_NATIVE_MAP();

        installVgpuPrivateContainer(
            this,
            '_diagnosticControllers',
            new VGPU_NATIVE_MAP(),
            record => Object.freeze({ owner: record.owner }),
        );

    }



    /**

     * Compile and cache a shader module

     * @param {string} name - Shader name for reuse

     * @param {string} code - WGSL source code

     * @param {Object} [defines] - Preprocessor defines (simple search/replace)

     * @returns {GPUShaderModule}

     */

    compile(name, code, defines = {}, owner = null) {

        this._assertShaderAlive();

        this._assertShaderOwnerAlive(owner);

        const generation = this._generation;

        const ownerGeneration = owner?.shaderGeneration ?? 0;

        const stableName = normalizeCoreManagerValue(this, generation, () => String(name));

        const stableCode = normalizeCoreManagerValue(this, generation, () => String(code));

        const stableDefines = this._snapshotDefines(defines, owner, ownerGeneration);

        this._assertShaderGeneration(generation, owner, ownerGeneration);

        const key = this._makeKey(stableName, stableDefines);

        this._assertShaderGeneration(generation, owner, ownerGeneration);



        let processedCode = stableCode;

        for (const [k, v] of Object.entries(stableDefines)) {

            processedCode = processedCode.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), String(v));

            processedCode = processedCode.replace(new RegExp(`#define\\s+${k}\\b.*`, 'g'), `const ${k} = ${v};`);

        }

        this._assertShaderGeneration(generation, owner, ownerGeneration);



        if (this.modules.has(key)) {

            if (this.sources.get(key) !== processedCode) {

                const error = new Error(`[vGPU] Shader name collision: ${stableName}`);

                error.code = 'VGPU_SHADER_NAME_COLLISION';

                throw error;

            }

            return this.modules.get(key);

        }



        const controller = new AbortController();

        const controllerAbort = Object.freeze({ receiver: controller, callable: controller.abort });

        let module;

        try {

            this._assertShaderGeneration(generation, owner, ownerGeneration);

            module = createCheckedShaderModule(this.device, {

                label: `vgpu_shader_${key}`,

                code: processedCode,

            }, {

                generation: this.vgpu.generation,

                sourcePath: this.filePaths.get(key) || null,

                signal: controller.signal,

            });

        } catch (error) {

            safeInvokeCoreCallable(controllerAbort, [error]);

            throw error;

        }

        if (this._destroyed

            || generation !== this._generation

            || (owner && owner.shaderGeneration !== ownerGeneration)

            || owner?.released

            || (owner && !owner.record.active)) {

            const error = this._destroyError || owner?._ownerReleaseError?.() || this._shaderCancellationError();

            safeInvokeCoreCallable(controllerAbort, [error]);

            throw error;

        }



        this.modules.set(key, module);

        this.sources.set(key, processedCode);

        setVgpuPrivateMapEntry(
            this,
            '_diagnosticControllers',
            key,
            Object.freeze({ abort: controllerAbort, controller, owner }),
        );

        return module;

    }



    /**

     * B2: Compile with file path for hot reload tracking

     */

    compileFromFile(name, code, filePath, defines = {}, owner = null) {

        this._assertShaderAlive();

        this._assertShaderOwnerAlive(owner);

        const generation = this._generation;

        const ownerGeneration = owner?.shaderGeneration ?? 0;

        const stableName = normalizeCoreManagerValue(this, generation, () => String(name));

        const stableCode = normalizeCoreManagerValue(this, generation, () => String(code));

        const stablePath = normalizeCoreManagerValue(this, generation, () => String(filePath));

        const stableDefines = this._snapshotDefines(defines, owner, ownerGeneration);

        this._assertShaderGeneration(generation, owner, ownerGeneration);

        const key = this._makeKey(stableName, stableDefines);

        this._assertShaderGeneration(generation, owner, ownerGeneration);

        const existingPath = this.filePaths.get(key);

        if (existingPath !== undefined && existingPath !== stablePath) {

            const error = new Error(`[vGPU] Shader file path collision: ${stableName}`);

            error.code = 'VGPU_SHADER_PATH_COLLISION';

            throw error;

        }

        this.filePaths.set(key, stablePath);

        let module;

        try {

            module = this.compile(stableName, stableCode, stableDefines, owner);

            this._assertShaderGeneration(generation, owner, ownerGeneration);

        } catch (error) {

            if (existingPath === undefined) this.filePaths.delete(key);

            throw error;

        }

        return module;

    }



    /**

     * B2: Force recompile a shader (for hot reload)

     */

    recompile(name, newCode, defines = {}, owner = null) {

        this._assertShaderAlive();

        this._assertShaderOwnerAlive(owner);

        const generation = this._generation;

        const ownerGeneration = owner?.shaderGeneration ?? 0;

        const stableName = normalizeCoreManagerValue(this, generation, () => String(name));

        const stableCode = normalizeCoreManagerValue(this, generation, () => String(newCode));

        const stableDefines = this._snapshotDefines(defines, owner, ownerGeneration);

        this._assertShaderGeneration(generation, owner, ownerGeneration);

        const key = this._makeKey(stableName, stableDefines);

        this._assertShaderGeneration(generation, owner, ownerGeneration);

        let processedCode = stableCode;

        for (const [k, v] of Object.entries(stableDefines)) {

            processedCode = processedCode.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), String(v));

            processedCode = processedCode.replace(new RegExp(`#define\\s+${k}\\b.*`, 'g'), `const ${k} = ${v};`);

        }

        this._assertShaderGeneration(generation, owner, ownerGeneration);

        const revision = ++this._recompileCount;

        setVgpuPrivateMapEntry(this, '_recompileRevisions', key, revision);

        const superseded = getVgpuPrivateMapEntry(this, '_recompileOperations', key);

        if (superseded) this._cancelShaderOperation(superseded, this._supersededShaderError(stableName));

        const operation = this._createShaderOperation('recompile', key, owner);

        operation.revision = revision;

        const controller = new AbortController();

        const controllerSignal = controller.signal;

        setVgpuOperationPrivateValue(operation, 'controller', controller);

        setVgpuOperationPrivateValue(operation, 'controllerSignal', controllerSignal);

        setVgpuOperationPrivateValue(operation, 'controllerAbort', Object.freeze({
            receiver: controller,
            callable: controller.abort,
        }));

        setVgpuPrivateMapEntry(this, '_recompileOperations', key, operation);

        const sourcePath = this.filePaths.get(key) || null;

        let module;

        try {

            this._assertShaderOwnerAlive(owner);

            module = createCheckedShaderModule(this.device, {

                label: `vgpu_shader_${key}_v${revision}`,

                code: processedCode,

            }, {

                generation: this.vgpu.generation,

                sourcePath,

                signal: controllerSignal,

            });

            if (!invokeVgpuOperationLifecycleAuthority(
                operation, 'isCurrent', [operation],
            )) throw this._destroyError || this._shaderCancellationError('operation invalidated');

        } catch (error) {

            safeInvokeCoreCallable(
                getVgpuOperationPrivateValue(operation, 'controllerAbort'), [error],
            );

            invokeVgpuOperationLifecycleAuthority(
                operation, 'settle', [operation, null, error],
            );

            return getVgpuOperationPromise(operation);

        }

        let rawOutcome;

        try {
            rawOutcome = thenVgpuPromise(resolveVgpuPromise(assertCheckedShaderModule(module, {

                generation: this.vgpu.generation,

                sourcePath,

                signal: controllerSignal,

            })),

                () => ({ status: 'resolved' }),

                error => ({ status: 'rejected', error }),

            );
        } catch (error) {
            safeInvokeCoreCallable(
                getVgpuOperationPrivateValue(operation, 'controllerAbort'), [error],
            );
            invokeVgpuOperationLifecycleAuthority(
                operation, 'settle', [operation, null, error],
            );
            return getVgpuOperationPromise(operation);
        }

        void thenVgpuPromise(raceVgpuPromises([

            rawOutcome,

            thenVgpuPromise(
                getVgpuOperationPrivateValue(operation, 'cancellation'),
                error => ({ status: 'cancelled', error }),
            ),

        ]), outcome => {

            if (
                outcome.status === 'cancelled'
                || !invokeVgpuOperationLifecycleAuthority(operation, 'isCurrent', [operation])
            ) return;

            if (outcome.status === 'rejected') {

                invokeVgpuOperationLifecycleAuthority(
                    operation, 'settle', [operation, null, outcome.error],
                );

                return;

            }

            if (getVgpuPrivateMapEntry(this, '_recompileRevisions', key) !== revision) {

                invokeVgpuOperationLifecycleAuthority(
                    operation, 'settle', [
                        operation, null, this._supersededShaderError(stableName),
                    ],
                );

                return;

            }

            const previousController = getVgpuPrivateMapEntry(
                this, '_diagnosticControllers', key,
            );

            this.modules.set(key, module);

            this.sources.set(key, processedCode);

            setVgpuPrivateMapEntry(
                this,
                '_diagnosticControllers',
                key,
                Object.freeze({
                    abort: Object.freeze({ receiver: controller, callable: controller.abort }),
                    controller,
                    owner,
                }),
            );

            setVgpuOperationPrivateValue(operation, 'controller', null);

            safeInvokeCoreCallable(
                previousController?.abort,
                [this._supersededShaderError(stableName)],
            );

            const callbacks = snapshotVgpuPrivateSet(this, '_hotReloadCallbacks');
            for (let index = 0; index < callbacks.length; index++) {

                const callback = callbacks[index];

                if (!invokeVgpuOperationLifecycleAuthority(
                    operation, 'isCurrent', [operation],
                )) return;

                try { callback(stableName, module); } catch (error) {

                    try { console.error('[vGPU] Hot reload callback error:', error); } catch (_) {}

                }

            }

            if (!invokeVgpuOperationLifecycleAuthority(
                operation, 'isCurrent', [operation],
            )) return;

            try { console.log(`[vGPU] Shader recompiled: ${stableName}`); } catch (_) {}

            if (!invokeVgpuOperationLifecycleAuthority(
                operation, 'isCurrent', [operation],
            )) return;

            invokeVgpuOperationLifecycleAuthority(
                operation, 'settle', [operation, module, null],
            );

        });

        return getVgpuOperationPromise(operation);

    }



    _createShaderOperation(kind, key = null, owner = null) {

        const lifecycleAuthorities = captureVgpuCallableSet([
            { name: 'isCurrent', receiver: this, key: '_isShaderOperationCurrent', operation: 'shader operation lifecycle check' },
            { name: 'settle', receiver: this, key: '_settleShaderOperation', operation: 'shader operation settlement' },
            { name: 'captureCancellation', receiver: this, key: '_captureShaderCancellationBatch', operation: 'shader cancellation capture' },
            { name: 'cancelBatch', receiver: this, key: '_cancelShaderBatch', operation: 'shader cancellation' },
        ], () => {
            this._assertShaderAlive();
            this._assertShaderOwnerAlive(owner);
        });

        let resolvePublic;

        let rejectPublic;

        let cancelWait;

        const operation = {

            kind,

            key,

            owner,

            ownerGeneration: owner?.shaderGeneration ?? 0,

            generation: this._generation,

            settled: false,

            cancelled: false,

            controller: null,

            promise: null,

            cancellation: null,

            lifecycleAuthorities,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        operation.cancellation = new VGPU_NATIVE_PROMISE(resolve => { cancelWait = resolve; });

        setVgpuOperationPrivateValue(operation, 'cancellation', operation.cancellation);

        operation.cancelWait = cancelWait;

        installVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority', cancelWait);

        addVgpuPrivateSetEntry(this, '_operations', operation);

        return operation;

    }



    _isShaderOperationCurrent(operation) {

        const owner = getVgpuOperationIdentity(operation, 'owner');

        if (!operation

            || isVgpuOperationSettled(operation)

            || isVgpuOperationCancelled(operation)

            || this._destroyed

            || (owner && (owner.released || !owner.record.active))

            || (owner && owner.shaderGeneration !== getVgpuOperationIdentity(operation, 'ownerGeneration'))

            || getVgpuOperationIdentity(operation, 'generation') !== this._generation

            || !hasVgpuPrivateSetEntry(this, '_operations', operation)) {

            return false;

        }

        return getVgpuOperationIdentity(operation, 'kind') !== 'recompile'

            || getVgpuPrivateMapEntry(
                this, '_recompileOperations', getVgpuOperationIdentity(operation, 'key'),
            ) === operation;

    }



    _assertShaderOperationCurrent(operation) {

        if (!invokeVgpuOperationLifecycleAuthority(operation, 'isCurrent', [operation])) {

            throw this._destroyError || this._shaderCancellationError('operation invalidated');

        }

    }



    _settleShaderOperation(operation, value, error) {

        if (!claimVgpuOperationSettlement(operation)) return false;

        deleteVgpuPrivateSetEntry(this, '_operations', operation);

        const key = getVgpuOperationIdentity(operation, 'key');

        if (key && getVgpuPrivateMapEntry(this, '_recompileOperations', key) === operation) {

            deleteVgpuPrivateMapEntry(this, '_recompileOperations', key);

        }

        invokeVgpuSettlementAuthority(operation, Boolean(error), error || value);

        return true;

    }



    _captureShaderCancellationBatch(operations, diagnosticEntries = []) {

        const activeOperations = [];
        for (let index = 0; index < operations.length; index++) {
            const operation = operations[index];
            if (operation && !isVgpuOperationSettled(operation)) {
                activeOperations[activeOperations.length] = operation;
            }
        }

        let privateCancelBatch = null;

        for (let index = 0; index < activeOperations.length; index++) {
            const operation = activeOperations[index];
            const authority = getVgpuOperationLifecycleAuthorities(operation)?.cancelBatch;
            if (authority) {
                privateCancelBatch = authority;
                break;
            }
        }

        const operationsSnapshot = [];
        for (let index = 0; index < activeOperations.length; index++) {
            const operation = activeOperations[index];
            operationsSnapshot[operationsSnapshot.length] = Object.freeze({
                operation,
                abort: getVgpuOperationPrivateValue(operation, 'controllerAbort') || null,
                cancel: getVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority'),
                reject: getVgpuOperationState(operation)?.rejectAuthority || null,
            });
        }

        const diagnosticsSnapshot = [];
        for (let index = 0; index < diagnosticEntries.length; index++) {
            const entry = diagnosticEntries[index];
            diagnosticsSnapshot[diagnosticsSnapshot.length] = Object.freeze({
                key: entry[0],
                record: entry[1],
                abort: entry[1]?.abort || null,
            });
        }

        return Object.freeze({
            cancelBatch: privateCancelBatch
                || getCoreManagerPrivateValue(this, 'cancelBatchAuthority')
                || null,
            operations: Object.freeze(operationsSnapshot),
            diagnostics: Object.freeze(diagnosticsSnapshot),
        });

    }



    _cancelShaderBatch(batch, error) {

        for (let index = 0; index < batch.operations.length; index++) {
            const entry = batch.operations[index];
            const operation = entry.operation;
            cancelVgpuOperation(operation);
            setVgpuOperationPrivateValue(operation, 'controller', null);
            forceVgpuOperationSettlement(operation);
            deleteVgpuPrivateSetEntry(this, '_operations', operation);
            const key = getVgpuOperationIdentity(operation, 'key');
            if (key && getVgpuPrivateMapEntry(this, '_recompileOperations', key) === operation) {
                deleteVgpuPrivateMapEntry(this, '_recompileOperations', key);
            }
        }

        for (let index = 0; index < batch.diagnostics.length; index++) {
            const entry = batch.diagnostics[index];
            if (getVgpuPrivateMapEntry(
                this, '_diagnosticControllers', entry.key,
            ) === entry.record) {
                deleteVgpuPrivateMapEntry(this, '_diagnosticControllers', entry.key);
            }
        }

        for (let index = 0; index < batch.operations.length; index++) {
            const entry = batch.operations[index];
            safeInvokeCoreCallable(entry.abort, [error]);
            safeInvokeCoreCallable(entry.cancel, [error]);
            safeInvokeCoreCallable(entry.reject, [error]);
        }

        for (let index = 0; index < batch.diagnostics.length; index++) {
            safeInvokeCoreCallable(batch.diagnostics[index].abort, [error]);
        }

        return batch.operations.length + batch.diagnostics.length;

    }



    _cancelShaderOperation(operation, error) {

        const captureAuthority = getVgpuOperationLifecycleAuthorities(operation)
            ?.captureCancellation;

        const batch = captureAuthority
            ? Reflect.apply(captureAuthority.callable, captureAuthority.receiver, [[operation]])
            : this._captureShaderCancellationBatch([operation]);

        if (!batch.cancelBatch) return false;

        return Reflect.apply(
            batch.cancelBatch.callable, batch.cancelBatch.receiver, [batch, error],
        ) > 0;

    }



    cancelOwner(owner, error = null) {

        if (!owner) return 0;

        const operations = snapshotVgpuPrivateSet(this, '_operations').filter(
            operation => getVgpuOperationIdentity(operation, 'owner') === owner,
        );

        const diagnostics = [];
        const diagnosticEntries = snapshotVgpuPrivateMapEntries(
            this, '_diagnosticControllers',
        );
        for (let index = 0; index < diagnosticEntries.length; index++) {
            const entry = diagnosticEntries[index];
            if (entry[1].owner === owner) diagnostics[diagnostics.length] = entry;
        }

        const batch = this._captureShaderCancellationBatch(operations, diagnostics);

        const cancellation = error
            || owner._ownerReleaseError?.()
            || this._shaderCancellationError('owner released');

        return batch.cancelBatch
            ? Reflect.apply(
                batch.cancelBatch.callable,
                batch.cancelBatch.receiver,
                [batch, cancellation],
            )
            : 0;

    }



    _shaderCancellationError(reason = 'destroyed') {

        return shaderManagerCancellationError(reason);

    }



    _supersededShaderError(name) {

        const error = new Error(`[vGPU] Shader recompile superseded: ${name}`);

        error.code = 'VGPU_SHADER_RECOMPILE_SUPERSEDED';

        return error;

    }



    _assertShaderAlive() {

        const parent = this.vgpu;

        if (

            this._destroyed

            || !parent

            || parent._destroyed

            || parent.generation !== this._parentGeneration

        ) throw this._destroyError || this._shaderCancellationError();

    }



    _assertShaderOwnerAlive(owner, expectedGeneration = null) {

        if (owner?.released || (owner && !owner.record.active)) {

            throw owner?._ownerReleaseError?.() || this._shaderCancellationError('owner invalidated');

        }

        if (owner && expectedGeneration !== null && owner.shaderGeneration !== expectedGeneration) {

            throw this._shaderCancellationError('owner invalidated');

        }

    }



    _assertShaderGeneration(generation, owner = null, ownerGeneration = null) {

        this._assertShaderAlive();

        this._assertShaderOwnerAlive(owner, ownerGeneration);

        if (generation !== this._generation) throw this._shaderCancellationError('generation invalidated');

    }



    /**

     * B2: Register callback for shader hot reload

     */

    onHotReload(callback) {

        this._assertShaderAlive();

        addVgpuPrivateSetEntry(this, '_hotReloadCallbacks', callback);

        return () => deleteVgpuPrivateSetEntry(this, '_hotReloadCallbacks', callback);

    }



    /**

     * B2: Invalidate cached shader (forces recompile on next use)

     */

    invalidate(name, defines = {}, owner = null) {

        this._assertShaderAlive();

        this._assertShaderOwnerAlive(owner);

        const generation = this._generation;

        const ownerGeneration = owner?.shaderGeneration ?? 0;

        const stableName = normalizeCoreManagerValue(this, generation, () => String(name));

        const stableDefines = this._snapshotDefines(defines, owner, ownerGeneration);

        this._assertShaderGeneration(generation, owner, ownerGeneration);

        const key = this._makeKey(stableName, stableDefines);

        const active = getVgpuPrivateMapEntry(this, '_recompileOperations', key);

        const diagnostic = getVgpuPrivateMapEntry(
            this, '_diagnosticControllers', key,
        ) || null;

        const batch = this._captureShaderCancellationBatch(
            active ? [active] : [], diagnostic ? [[key, diagnostic]] : [],
        );

        const cancellation = this._supersededShaderError(stableName);

        if (batch.cancelBatch) Reflect.apply(
            batch.cancelBatch.callable,
            batch.cancelBatch.receiver,
            [batch, cancellation],
        );

        setVgpuPrivateMapEntry(
            this, '_recompileRevisions', key, ++this._recompileCount,
        );

        this.modules.delete(key);

        this.sources.delete(key);

    }



    /**

     * Invalidate all shaders (for device loss recovery)

     */

    invalidateAll() {

        this._assertShaderAlive();

        advanceCoreManagerGeneration(this);

        const error = this._shaderCancellationError('invalidated');

        const batch = this._captureShaderCancellationBatch(
            snapshotVgpuPrivateSet(this, '_operations'),
            snapshotVgpuPrivateMapEntries(this, '_diagnosticControllers'),
        );

        if (batch.cancelBatch) Reflect.apply(
            batch.cancelBatch.callable, batch.cancelBatch.receiver, [batch, error],
        );

        clearVgpuPrivateMap(this, '_recompileRevisions');

        this.modules.clear();

        this.sources.clear();

    }



    _makeKey(name, defines) {

        if (Object.keys(defines).length === 0) return name;

        return `${name}[${stableDescriptorKey(defines)}]`;

    }



    /**

     * Get cached module

     */

    get(name, defines = {}, owner = null) {

        this._assertShaderAlive();

        this._assertShaderOwnerAlive(owner);

        const generation = this._generation;

        const ownerGeneration = owner?.shaderGeneration ?? 0;

        const stableName = normalizeCoreManagerValue(this, generation, () => String(name));

        const stableDefines = this._snapshotDefines(defines, owner, ownerGeneration);

        this._assertShaderGeneration(generation, owner, ownerGeneration);

        return this.modules.get(this._makeKey(stableName, stableDefines));

    }



    /**

     * Check if shader has compilation errors (call after creating pipeline)

     */

    checkCompilationInfo(module, owner = null) {

        this._assertShaderAlive();

        this._assertShaderOwnerAlive(owner);

        const operation = this._createShaderOperation('compilation-info', null, owner);

        const controller = new AbortController();

        const controllerSignal = controller.signal;

        setVgpuOperationPrivateValue(operation, 'controller', controller);

        setVgpuOperationPrivateValue(operation, 'controllerSignal', controllerSignal);

        setVgpuOperationPrivateValue(operation, 'controllerAbort', Object.freeze({
            receiver: controller,
            callable: controller.abort,
        }));

        let rawCheck;

        try {

            if (!invokeVgpuOperationLifecycleAuthority(
                operation, 'isCurrent', [operation],
            )) throw this._destroyError || this._shaderCancellationError('operation invalidated');

            rawCheck = assertCheckedShaderModule(module, {

                generation: this.vgpu.generation,

                signal: controllerSignal,

            });

        } catch (error) {

            invokeVgpuOperationLifecycleAuthority(
                operation, 'settle', [operation, null, error],
            );

            safeInvokeCoreCallable(
                getVgpuOperationPrivateValue(operation, 'controllerAbort'), [error],
            );

            return getVgpuOperationPromise(operation);

        }

        const rawOutcome = thenVgpuPromise(resolveVgpuPromise(rawCheck),

            () => ({ status: 'resolved' }),

            error => ({ status: 'rejected', error }),

        );

        void thenVgpuPromise(raceVgpuPromises([

            rawOutcome,

            thenVgpuPromise(
                getVgpuOperationPrivateValue(operation, 'cancellation'),
                error => ({ status: 'cancelled', error }),
            ),

        ]), outcome => {

            if (
                outcome.status === 'cancelled'
                || !invokeVgpuOperationLifecycleAuthority(operation, 'isCurrent', [operation])
            ) return;

            setVgpuOperationPrivateValue(operation, 'controller', null);

            if (outcome.status === 'rejected') {

                try {
                    console.error(
                        '[vGPU] Shader compilation errors:',
                        outcome.error?.diagnostics?.messages || outcome.error,
                    );
                } catch (_) {}

                if (!invokeVgpuOperationLifecycleAuthority(
                    operation, 'isCurrent', [operation],
                )) return;

                invokeVgpuOperationLifecycleAuthority(
                    operation, 'settle', [operation, false, null],
                );

                return;

            }

            invokeVgpuOperationLifecycleAuthority(
                operation, 'settle', [operation, true, null],
            );

        });

        return getVgpuOperationPromise(operation);

    }



    _snapshotDefines(defines, owner = null, ownerGeneration = owner?.shaderGeneration ?? null) {

        const generation = this._generation;

        this._assertShaderGeneration(generation, owner, ownerGeneration);

        const source = defines || {};

        let keys;

        try { keys = Reflect.ownKeys(source); }

        finally { this._assertShaderGeneration(generation, owner, ownerGeneration); }

        const snapshot = {};

        for (const key of keys) {

            if (typeof key !== 'string') continue;

            let descriptor;

            try { descriptor = Reflect.getOwnPropertyDescriptor(source, key); }

            finally { this._assertShaderGeneration(generation, owner, ownerGeneration); }

            if (!descriptor?.enumerable) continue;

            let value;

            try { value = Reflect.get(source, key); }

            finally { this._assertShaderGeneration(generation, owner, ownerGeneration); }

            try { snapshot[key] = String(value); }

            finally { this._assertShaderGeneration(generation, owner, ownerGeneration); }

        }

        return Object.freeze(snapshot);

    }



    getStats() {

        assertCoreManagerAlive(this);

        return {

            modules: this.modules.size,

            recompiles: this._recompileCount,

        };

    }



    destroy() {

        const error = shaderManagerCancellationError();
        const operations = snapshotVgpuPrivateSet(this, '_operations');

        const captureCancellation = getCoreManagerPrivateValue(
            this, 'captureCancellationAuthority',
        );

        const batch = Reflect.apply(
            captureCancellation.callable,
            captureCancellation.receiver,
            [operations, snapshotVgpuPrivateMapEntries(this, '_diagnosticControllers')],
        );

        if (!terminateCoreManagerLifecycle(this)) return false;

        setCoreManagerDestroyError(this, error);

        if (batch.cancelBatch) Reflect.apply(
            batch.cancelBatch.callable, batch.cancelBatch.receiver, [batch, error],
        );

        try { Reflect.apply(VGPU_MAP_CLEAR, this.modules, []); } catch (_) {}

        try { Reflect.apply(VGPU_MAP_CLEAR, this.sources, []); } catch (_) {}

        try { Reflect.apply(VGPU_MAP_CLEAR, this.filePaths, []); } catch (_) {}

        clearVgpuPrivateMap(this, '_recompileRevisions');

        clearVgpuPrivateSet(this, '_hotReloadCallbacks');

        try { this._hotReloadEnabled = false; } catch (_) {}

        severCoreManagerProperties(this, ['device', 'vgpu']);

        return true;

    }

}



// ============================================================================

// PIPELINE MANAGER

// ============================================================================



class VGPUPipelineManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'pipeline');

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this.renderPipelines = new Map();

        this.computePipelines = new Map();

        this.pending = new Map();

        installVgpuPrivateContainer(this, 'pending', new VGPU_NATIVE_MAP());

    }



    /**

     * Create or get cached render pipeline

     * @param {Object} options

     */

    render(options, owner = null) {

        this._assertAsyncAlive();

        this._assertPipelineOwnerAlive(owner);

        const generation = this._generation;

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'createPipeline', receiver: this.device, key: 'createRenderPipeline', operation: 'render pipeline creation' },

            { name: 'createLayout', receiver: this.device, key: 'createPipelineLayout', operation: 'pipeline layout creation' },

        ]);

        this._assertPipelineGeneration(generation, owner);

        const snapshot = this._snapshotRenderOptions(options, generation, owner);

        const key = this._renderKey(snapshot);

        this._assertPipelineGeneration(generation, owner);



        if (this.renderPipelines.has(key)) {

            if (owner) addVgpuPrivateSetEntry(owner, 'renderPipelineKeys', key);

            return this.renderPipelines.get(key);

        }



        const createPipeline = authorities.createPipeline;
        const descriptor = this._buildRenderDescriptor(
            snapshot, generation, owner, authorities.createLayout,
        );

        this._assertPipelineGeneration(generation, owner);

        const pipeline = this._invokePipelineExternal(
            createPipeline, [descriptor], generation, owner,
        );

        this._assertPipelineGeneration(generation, owner);



        this.renderPipelines.set(key, pipeline);

        if (owner) addVgpuPrivateSetEntry(owner, 'renderPipelineKeys', key);

        return pipeline;

    }



    /**

     * Create or get cached render pipeline (async)

     */

    renderAsync(options, owner = null) {

        this._assertAsyncAlive();

        this._assertPipelineOwnerAlive(owner);

        const generation = this._generation;

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'createPipeline', receiver: this.device, key: 'createRenderPipelineAsync', operation: 'async render pipeline creation' },

            { name: 'createLayout', receiver: this.device, key: 'createPipelineLayout', operation: 'pipeline layout creation' },

            { name: 'startAsyncPipeline', receiver: this, key: '_startAsyncPipeline', operation: 'async pipeline operation start' },

            { name: 'isAsyncPipelineCurrent', receiver: this, key: '_isAsyncPipelineCurrent', operation: 'pipeline operation lifecycle check' },

            { name: 'settleAsyncPipeline', receiver: this, key: '_settleAsyncPipeline', operation: 'pipeline operation settlement' },

        ]);

        this._assertPipelineGeneration(generation, owner);

        const snapshot = this._snapshotRenderOptions(options, generation, owner);

        const key = this._renderKey(snapshot);

        this._assertPipelineOwnerAlive(owner);

        if (this.renderPipelines.has(key)) {

            if (owner) addVgpuPrivateSetEntry(owner, 'renderPipelineKeys', key);

            return resolveVgpuPromise(this.renderPipelines.get(key));

        }

        const pendingKey = `render:${key}:owner:${owner?.namespace || 'shared'}`;

        const existing = getVgpuPrivateMapEntry(this, 'pending', pendingKey);

        if (existing) return getVgpuOperationPromise(existing);

        const createPipeline = authorities.createPipeline;

        const descriptor = this._buildRenderDescriptor(
            snapshot, generation, owner, authorities.createLayout,
        );

        this._assertAsyncAlive();

        this._assertPipelineOwnerAlive(owner);

        return Reflect.apply(
            authorities.startAsyncPipeline.callable,
            authorities.startAsyncPipeline.receiver,
            ['render', key, pendingKey, descriptor, owner, createPipeline, authorities],
        );

    }



    _buildRenderDescriptor(

        options, generation = this._generation, owner = null, createLayout = null,

    ) {

        const {

            vertex,

            fragment,

            vertexLayout,

            topology = 'triangle-list',

            cullMode = 'back',

            frontFace = 'ccw',

            depthWrite = true,

            depthCompare = 'less',

            blend,

            colorFormat = DEFAULT_COLOR_FORMAT,

            colorFormats,  // C2: Multi-target support

            depthFormat = DEFAULT_DEPTH_FORMAT,

            sampleCount = 1,

            label,

            layouts = [],

            // C3: Stencil state support

            stencilFront,

            stencilBack,

            stencilReadMask,

            stencilWriteMask,

            depthBias,

            depthBiasSlopeScale,

            depthBiasClamp,

        } = options;



        const descriptor = {

            label: label || 'vgpu_render_pipeline',

            layout: layouts.length > 0

                ? this._invokePipelineExternal(

                    createLayout, [{ bindGroupLayouts: layouts }], generation, owner,

                )

                : 'auto',

            vertex: {

                module: vertex.module,

                entryPoint: vertex.entryPoint || 'main',

                buffers: vertexLayout || [],

            },

            primitive: {

                topology,

                cullMode,

                frontFace,

            },

        };



        if (fragment) {

            // C2: Support multiple render targets

            // Allow colorFormats: [] or colorFormat: null for depth-only passes

            const formats = colorFormats !== undefined ? colorFormats :

                           (colorFormat === null ? [] : [colorFormat]);

            const targets = formats.map((fmt, i) => {

                const target = { format: fmt };

                // Apply blend to first target or all if blend is an array

                const blendConfig = Array.isArray(blend) ? blend[i] : (i === 0 ? blend : undefined);

                if (blendConfig) {

                    target.blend = this._resolveBlend(blendConfig);

                }

                return target;

            });



            descriptor.fragment = {

                module: fragment.module,

                entryPoint: fragment.entryPoint || 'main',

                targets,

            };

        }



        if (depthFormat) {

            descriptor.depthStencil = {

                format: depthFormat,

                depthWriteEnabled: depthWrite,

                depthCompare,

            };



            // C3: Stencil state

            if (stencilFront) {

                descriptor.depthStencil.stencilFront = this._resolveStencil(stencilFront);

            }

            if (stencilBack) {

                descriptor.depthStencil.stencilBack = this._resolveStencil(stencilBack);

            }

            if (stencilReadMask !== undefined) {

                descriptor.depthStencil.stencilReadMask = stencilReadMask;

            }

            if (stencilWriteMask !== undefined) {

                descriptor.depthStencil.stencilWriteMask = stencilWriteMask;

            }

            if (depthBias !== undefined) {

                descriptor.depthStencil.depthBias = depthBias;

            }

            if (depthBiasSlopeScale !== undefined) {

                descriptor.depthStencil.depthBiasSlopeScale = depthBiasSlopeScale;

            }

            if (depthBiasClamp !== undefined) {

                descriptor.depthStencil.depthBiasClamp = depthBiasClamp;

            }

        }



        if (sampleCount > 1) {

            descriptor.multisample = { count: sampleCount };

        }



        return descriptor;

    }



    _resolveStencil(stencil) {

        if (typeof stencil === 'object') return stencil;

        // Preset stencil operations

        switch (stencil) {

            case 'always-replace':

                return { compare: 'always', passOp: 'replace', failOp: 'keep', depthFailOp: 'keep' };

            case 'equal-keep':

                return { compare: 'equal', passOp: 'keep', failOp: 'keep', depthFailOp: 'keep' };

            case 'not-equal-keep':

                return { compare: 'not-equal', passOp: 'keep', failOp: 'keep', depthFailOp: 'keep' };

            default:

                return { compare: 'always', passOp: 'keep', failOp: 'keep', depthFailOp: 'keep' };

        }

    }



    _resolveBlend(blend) {

        if (typeof blend === 'object') return blend;



        switch (blend) {

            case 'alpha':

                return {

                    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },

                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },

                };

            case 'premultiplied':

                return {

                    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },

                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },

                };

            case 'additive':

                return {

                    color: { srcFactor: 'src-alpha', dstFactor: 'one' },

                    alpha: { srcFactor: 'one', dstFactor: 'one' },

                };

            case 'additive-full':

                return {

                    color: { srcFactor: 'one', dstFactor: 'one' },

                    alpha: { srcFactor: 'one', dstFactor: 'one' },

                };

            case 'multiply':

                return {

                    color: { srcFactor: 'dst-color', dstFactor: 'zero' },

                    alpha: { srcFactor: 'dst-alpha', dstFactor: 'zero' },

                };

            case 'screen':

                return {

                    color: { srcFactor: 'one', dstFactor: 'one-minus-src-color' },

                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },

                };

            case 'min':

                return {

                    color: { srcFactor: 'one', dstFactor: 'one', operation: 'min' },

                    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'min' },

                };

            case 'max':

                return {

                    color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },

                    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },

                };

            default:

                return undefined;

        }

    }



    // Canonicalize the effective descriptor so cache identity cannot alias
    // depth-only pipelines or omit blend/stencil fields consumed by WebGPU.

    _renderKey(options) {

        const colorFormat = options.colorFormat === undefined

            ? DEFAULT_COLOR_FORMAT

            : options.colorFormat;

        const colorFormats = options.colorFormats !== undefined

            ? options.colorFormats

            : (colorFormat === null ? [] : [colorFormat]);

        const targets = options.fragment

            ? colorFormats.map((format, index) => {

                const target = { format };

                const blend = Array.isArray(options.blend)

                    ? options.blend[index]

                    : (index === 0 ? options.blend : undefined);

                if (blend) target.blend = this._resolveBlend(blend);

                return target;

            })

            : null;

        const depthFormat = options.depthFormat === undefined

            ? DEFAULT_DEPTH_FORMAT

            : options.depthFormat;

        let depthStencil = null;

        if (depthFormat) {

            depthStencil = {

                format: depthFormat,

                depthWriteEnabled: options.depthWrite === undefined ? true : options.depthWrite,

                depthCompare: options.depthCompare === undefined ? 'less' : options.depthCompare,

            };

            if (options.stencilFront) {

                depthStencil.stencilFront = this._resolveStencil(options.stencilFront);

            }

            if (options.stencilBack) {

                depthStencil.stencilBack = this._resolveStencil(options.stencilBack);

            }

            if (options.stencilReadMask !== undefined) {

                depthStencil.stencilReadMask = options.stencilReadMask;

            }

            if (options.stencilWriteMask !== undefined) {

                depthStencil.stencilWriteMask = options.stencilWriteMask;

            }

            if (options.depthBias !== undefined) {

                depthStencil.depthBias = options.depthBias;

            }

            if (options.depthBiasSlopeScale !== undefined) {

                depthStencil.depthBiasSlopeScale = options.depthBiasSlopeScale;

            }

            if (options.depthBiasClamp !== undefined) {

                depthStencil.depthBiasClamp = options.depthBiasClamp;

            }

        }

        const sampleCount = options.sampleCount === undefined ? 1 : options.sampleCount;

        return stableDescriptorKey({

            layout: (options.layouts || []).map(layout => this._getLayoutId(layout)),

            vertex: {

                module: this._getModuleId(options.vertex?.module),

                entryPoint: options.vertex?.entryPoint || 'main',

                buffers: options.vertexLayout || [],

            },

            fragment: options.fragment ? {

                module: this._getModuleId(options.fragment.module),

                entryPoint: options.fragment.entryPoint || 'main',

                targets,

            } : null,

            primitive: {

                topology: options.topology === undefined ? 'triangle-list' : options.topology,

                cullMode: options.cullMode === undefined ? 'back' : options.cullMode,

                frontFace: options.frontFace === undefined ? 'ccw' : options.frontFace,

            },

            depthStencil,

            multisample: sampleCount > 1 ? { count: sampleCount } : null,

        });

    }



    _getModuleId(module) {

        if (!module) return 'none';

        if (!this._moduleIds) this._moduleIds = new WeakMap();

        if (!this._nextModuleId) this._nextModuleId = 1;

        let id = this._moduleIds.get(module);

        if (!id) {

            id = this._nextModuleId++;

            this._moduleIds.set(module, id);

        }

        return `m${id}`;

    }



    _blendKey(blend) {

        if (!blend) return 'none';

        if (Array.isArray(blend)) return blend.map(value => this._blendKey(value)).join('+');

        return stableDescriptorKey(this._resolveBlend(blend));

    }



    /**

     * Create or get cached compute pipeline

     * @param {Object} options

     */

    compute(options, owner = null) {

        this._assertAsyncAlive();

        this._assertPipelineOwnerAlive(owner);

        const generation = this._generation;

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'createPipeline', receiver: this.device, key: 'createComputePipeline', operation: 'compute pipeline creation' },

            { name: 'createLayout', receiver: this.device, key: 'createPipelineLayout', operation: 'pipeline layout creation' },

        ]);

        this._assertPipelineGeneration(generation, owner);

        const snapshot = this._snapshotComputeOptions(options, generation, owner);

        const key = this._computeKey(snapshot);

        this._assertPipelineGeneration(generation, owner);



        if (this.computePipelines.has(key)) {

            if (owner) addVgpuPrivateSetEntry(owner, 'computePipelineKeys', key);

            return this.computePipelines.get(key);

        }



        const createPipeline = authorities.createPipeline;

        const { module, entryPoint = 'main', layout, layouts = [], label } = snapshot;



        // Support both 'layout' (singular) and 'layouts' (array)

        const bindGroupLayouts = layout ? [layout] : layouts;



        const descriptor = {

            label: label || 'vgpu_compute_pipeline',

            layout: bindGroupLayouts.length > 0

                ? this._invokePipelineExternal(

                    authorities.createLayout, [{ bindGroupLayouts }], generation, owner,

                )

                : 'auto',

            compute: {

                module,

                entryPoint,

            },

        };



        this._assertPipelineGeneration(generation, owner);

        const pipeline = this._invokePipelineExternal(
            createPipeline, [descriptor], generation, owner,
        );

        this._assertPipelineGeneration(generation, owner);

        this.computePipelines.set(key, pipeline);

        if (owner) addVgpuPrivateSetEntry(owner, 'computePipelineKeys', key);

        return pipeline;

    }



    /**

     * Create or get cached compute pipeline (async)

     */

    computeAsync(options, owner = null) {

        this._assertAsyncAlive();

        this._assertPipelineOwnerAlive(owner);

        const generation = this._generation;

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'createPipeline', receiver: this.device, key: 'createComputePipelineAsync', operation: 'async compute pipeline creation' },

            { name: 'createLayout', receiver: this.device, key: 'createPipelineLayout', operation: 'pipeline layout creation' },

            { name: 'startAsyncPipeline', receiver: this, key: '_startAsyncPipeline', operation: 'async pipeline operation start' },

            { name: 'isAsyncPipelineCurrent', receiver: this, key: '_isAsyncPipelineCurrent', operation: 'pipeline operation lifecycle check' },

            { name: 'settleAsyncPipeline', receiver: this, key: '_settleAsyncPipeline', operation: 'pipeline operation settlement' },

        ]);

        this._assertPipelineGeneration(generation, owner);

        const snapshot = this._snapshotComputeOptions(options, generation, owner);

        const key = this._computeKey(snapshot);

        this._assertPipelineOwnerAlive(owner);

        if (this.computePipelines.has(key)) {

            if (owner) addVgpuPrivateSetEntry(owner, 'computePipelineKeys', key);

            return resolveVgpuPromise(this.computePipelines.get(key));

        }

        const pendingKey = `compute:${key}:owner:${owner?.namespace || 'shared'}`;

        const existing = getVgpuPrivateMapEntry(this, 'pending', pendingKey);

        if (existing) return getVgpuOperationPromise(existing);

        const createPipeline = authorities.createPipeline;

        const { module, entryPoint = 'main', layout, layouts = [], label } = snapshot;

        // Support both 'layout' (singular) and 'layouts' (array)

        const bindGroupLayouts = layout ? [layout] : layouts;

        const descriptor = {

            label: label || 'vgpu_compute_pipeline',

            layout: bindGroupLayouts.length > 0

                ? this._invokePipelineExternal(

                    authorities.createLayout, [{ bindGroupLayouts }], generation, owner,

                )

                : 'auto',

            compute: { module, entryPoint },

        };

        this._assertAsyncAlive();

        this._assertPipelineOwnerAlive(owner);

        return Reflect.apply(
            authorities.startAsyncPipeline.callable,
            authorities.startAsyncPipeline.receiver,
            ['compute', key, pendingKey, descriptor, owner, createPipeline, authorities],
        );

    }



    _computeKey(options) {

        // Support both 'layout' (singular) and 'layouts' (array)

        const bindGroupLayouts = options.layout ? [options.layout] : (Array.isArray(options.layouts) ? options.layouts : []);

        const layoutKey = bindGroupLayouts.length > 0

            ? bindGroupLayouts.map(l => this._getLayoutId(l)).join(',')

            : 'auto';

        return `${this._getModuleId(options.module)}|${options.entryPoint || 'main'}|l:${layoutKey}`;

    }



    _getLayoutId(layout) {

        if (!layout) return '0';

        if (!this._layoutIds) this._layoutIds = new WeakMap();

        if (!this._nextLayoutId) this._nextLayoutId = 1;

        let id = this._layoutIds.get(layout);

        if (!id) {

            id = this._nextLayoutId++;

            this._layoutIds.set(layout, id);

        }

        return `g${id}`;

    }



    _startAsyncPipeline(
        kind, key, pendingKey, descriptor, owner = null, createPipeline,
        lifecycleAuthorities = null,
    ) {

        this._assertAsyncAlive();

        this._assertPipelineOwnerAlive(owner);

        lifecycleAuthorities = lifecycleAuthorities || captureVgpuCallableSet([

            {
                name: 'isAsyncPipelineCurrent',
                receiver: this,
                key: '_isAsyncPipelineCurrent',
                operation: 'pipeline operation lifecycle check',
            },

            {
                name: 'settleAsyncPipeline',
                receiver: this,
                key: '_settleAsyncPipeline',
                operation: 'pipeline operation settlement',
            },

        ], () => {

            this._assertAsyncAlive();

            this._assertPipelineOwnerAlive(owner);

        });

        let resolvePublic;

        let rejectPublic;

        let cancelWait;

        const record = {

            kind,

            key,

            pendingKey,

            owner,

            generation: this._generation,

            settled: false,

            cancelled: false,

            promise: null,

            cancellation: null,

            lifecycleAuthorities,

        };

        record.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        record.resolve = resolvePublic;

        record.reject = rejectPublic;

        installVgpuSettlementAuthorities(record, resolvePublic, rejectPublic);

        silenceVgpuPromise(getVgpuOperationPromise(record));

        record.cancellation = new VGPU_NATIVE_PROMISE(resolve => { cancelWait = resolve; });

        setVgpuOperationPrivateValue(record, 'cancellation', record.cancellation);

        record.cancelWait = cancelWait;

        installVgpuOperationCallableAuthority(record, '_cancelWaitAuthority', cancelWait);

        let pipelineCache;

        try {
            pipelineCache = kind === 'render'
                ? this.renderPipelines
                : this.computePipelines;
        } finally {
            this._assertAsyncAlive();
            this._assertPipelineOwnerAlive(owner);
        }

        setVgpuOperationPrivateValue(record, 'pipelineCache', pipelineCache);

        setVgpuPrivateMapEntry(this, 'pending', pendingKey, record);

        let rawPipeline;

        try {
            rawPipeline = this._invokePipelineExternal(
                createPipeline,
                [descriptor],
                getVgpuOperationIdentity(record, 'generation'),
                owner,
            );

        } catch (error) {

            Reflect.apply(

                lifecycleAuthorities.settleAsyncPipeline.callable,

                lifecycleAuthorities.settleAsyncPipeline.receiver,

                [record, null, error],

            );

            return getVgpuOperationPromise(record);

        }

        const rawOutcome = thenVgpuPromise(resolveVgpuPromise(rawPipeline),

            pipeline => ({ status: 'resolved', pipeline }),

            error => ({ status: 'rejected', error }),

        );

        void thenVgpuPromise(raceVgpuPromises([

            rawOutcome,

            thenVgpuPromise(
                getVgpuOperationPrivateValue(record, 'cancellation'),
                error => ({ status: 'cancelled', error }),
            ),

        ]), outcome => {

            if (

                outcome.status === 'cancelled'

                || !Reflect.apply(

                    lifecycleAuthorities.isAsyncPipelineCurrent.callable,

                    lifecycleAuthorities.isAsyncPipelineCurrent.receiver,

                    [record],

                )

            ) return;

            if (outcome.status === 'rejected') {

                Reflect.apply(

                    lifecycleAuthorities.settleAsyncPipeline.callable,

                    lifecycleAuthorities.settleAsyncPipeline.receiver,

                    [record, null, outcome.error],

                );

                return;

            }

            const operationKind = getVgpuOperationIdentity(record, 'kind');

            const operationKey = getVgpuOperationIdentity(record, 'key');

            const operationOwner = getVgpuOperationIdentity(record, 'owner');

            const isCurrent = () => Reflect.apply(
                lifecycleAuthorities.isAsyncPipelineCurrent.callable,
                lifecycleAuthorities.isAsyncPipelineCurrent.receiver,
                [record],
            );

            if (!isCurrent()) return;

            const cache = getVgpuOperationPrivateValue(record, 'pipelineCache');

            try {
                Reflect.apply(VGPU_MAP_SET, cache, [operationKey, outcome.pipeline]);
            } catch (error) {
                Reflect.apply(
                    lifecycleAuthorities.settleAsyncPipeline.callable,
                    lifecycleAuthorities.settleAsyncPipeline.receiver,
                    [record, null, error],
                );
                return;
            }

            if (!isCurrent()) {
                if (Reflect.apply(VGPU_MAP_GET, cache, [operationKey]) === outcome.pipeline) {
                    Reflect.apply(VGPU_MAP_DELETE, cache, [operationKey]);
                }
                return;
            }

            if (operationOwner) addVgpuPrivateSetEntry(
                operationOwner,
                operationKind === 'render' ? 'renderPipelineKeys' : 'computePipelineKeys',
                operationKey,
            );

            if (!isCurrent()) {
                if (operationOwner) deleteVgpuPrivateSetEntry(
                    operationOwner,
                    operationKind === 'render' ? 'renderPipelineKeys' : 'computePipelineKeys',
                    operationKey,
                );
                if (Reflect.apply(VGPU_MAP_GET, cache, [operationKey]) === outcome.pipeline) {
                    Reflect.apply(VGPU_MAP_DELETE, cache, [operationKey]);
                }
                return;
            }

            Reflect.apply(

                lifecycleAuthorities.settleAsyncPipeline.callable,

                lifecycleAuthorities.settleAsyncPipeline.receiver,

                [record, outcome.pipeline, null],

            );

        });

        return getVgpuOperationPromise(record);

    }



    _isAsyncPipelineCurrent(record) {

        const owner = getVgpuOperationIdentity(record, 'owner');

        return Boolean(record)

            && !isVgpuOperationSettled(record)

            && !isVgpuOperationCancelled(record)

            && !this._destroyed

            && (!owner || (!owner.released && owner.record.active))

            && getVgpuOperationIdentity(record, 'generation') === this._generation

            && getVgpuPrivateMapEntry(
                this, 'pending', getVgpuOperationIdentity(record, 'pendingKey'),
            ) === record;

    }



    _settleAsyncPipeline(record, value, error) {

        if (!claimVgpuOperationSettlement(record)) return false;

        const pendingKey = getVgpuOperationIdentity(record, 'pendingKey');

        if (getVgpuPrivateMapEntry(this, 'pending', pendingKey) === record) {
            deleteVgpuPrivateMapEntry(this, 'pending', pendingKey);
        }

        invokeVgpuSettlementAuthority(record, Boolean(error), error || value);

        return true;

    }



    cancelOwner(owner, error = null) {

        if (!owner) return 0;

        const cancellation = error || owner._ownerReleaseError?.() || this._pipelineCancellationError('owner released');

        const records = snapshotVgpuPrivateMapValues(this, 'pending').filter(
            record => getVgpuOperationIdentity(record, 'owner') === owner,
        );

        for (const record of records) {

            cancelVgpuOperation(record);

            const authority = getVgpuOperationLifecycleAuthorities(record)?.settleAsyncPipeline;

            if (authority) Reflect.apply(
                authority.callable, authority.receiver, [record, null, cancellation],
            );

            safeInvokeCoreCallable(
                getVgpuOperationCallableAuthority(record, '_cancelWaitAuthority'), [cancellation],
            );

        }

        return records.length;

    }



    _pipelineCancellationError(reason = 'destroyed') {

        return pipelineManagerCancellationError(reason);

    }



    _assertAsyncAlive() {

        const parent = this.vgpu;

        if (

            this._destroyed

            || !parent

            || parent._destroyed

            || parent.generation !== this._parentGeneration

        ) throw this._destroyError || this._pipelineCancellationError();

    }



    _assertPipelineOwnerAlive(owner) {

        if (owner?.released || (owner && !owner.record.active)) {

            throw owner._ownerReleaseError?.() || this._pipelineCancellationError('owner released');

        }

    }



    _readPipelineValue(target, key, generation, owner) {

        let value;

        try { value = target[key]; } finally {

            this._assertPipelineGeneration(generation, owner);

        }

        return value;

    }



    _normalizePipelineValue(value, generation, owner, normalize = String) {

        let normalized;

        try { normalized = normalize(value); } finally {

            this._assertPipelineGeneration(generation, owner);

        }

        return normalized;

    }



    _snapshotPipelineObject(source, keys, generation, owner) {

        if (source == null) return null;

        const snapshot = {};

        for (const key of keys) {

            snapshot[key] = this._readPipelineValue(source, key, generation, owner);

        }

        return snapshot;

    }



    _snapshotPipelineArray(source, generation, owner, mapper = value => value) {

        if (source == null) return Object.freeze([]);

        const lengthValue = this._readPipelineValue(source, 'length', generation, owner);

        const length = this._normalizePipelineValue(lengthValue, generation, owner, Number);

        if (!Number.isSafeInteger(length) || length < 0) {

            throw new TypeError('[vGPU] Pipeline descriptor arrays require a finite length');

        }

        const snapshot = new Array(length);

        for (let index = 0; index < length; index++) {

            const value = this._readPipelineValue(source, index, generation, owner);

            snapshot[index] = mapper(value, index);

            this._assertPipelineGeneration(generation, owner);

        }

        return Object.freeze(snapshot);

    }



    _snapshotBlend(blend, generation, owner) {

        if (blend == null) return undefined;

        if (typeof blend !== 'object') {

            return this._normalizePipelineValue(blend, generation, owner, String);

        }

        const root = this._snapshotPipelineObject(blend, ['color', 'alpha'], generation, owner);

        const component = value => {

            if (value == null) return undefined;

            const fields = this._snapshotPipelineObject(

                value, ['srcFactor', 'dstFactor', 'operation'], generation, owner,

            );

            const result = {};

            for (const key of ['srcFactor', 'dstFactor', 'operation']) {

                if (fields[key] !== undefined) {

                    result[key] = this._normalizePipelineValue(fields[key], generation, owner, String);

                }

            }

            return Object.freeze(result);

        };

        return Object.freeze({ color: component(root.color), alpha: component(root.alpha) });

    }



    _snapshotStencil(stencil, generation, owner) {

        if (stencil == null) return undefined;

        if (typeof stencil !== 'object') {

            return this._normalizePipelineValue(stencil, generation, owner, String);

        }

        const fields = this._snapshotPipelineObject(

            stencil, ['compare', 'failOp', 'depthFailOp', 'passOp'], generation, owner,

        );

        const snapshot = {};

        for (const key of ['compare', 'failOp', 'depthFailOp', 'passOp']) {

            if (fields[key] !== undefined) {

                snapshot[key] = this._normalizePipelineValue(fields[key], generation, owner, String);

            }

        }

        return Object.freeze(snapshot);

    }



    _snapshotRenderOptions(options, generation, owner) {

        const root = this._snapshotPipelineObject(options, [

            'vertex', 'fragment', 'vertexLayout', 'topology', 'cullMode', 'frontFace',

            'depthWrite', 'depthCompare', 'blend', 'colorFormat', 'colorFormats',

            'depthFormat', 'sampleCount', 'label', 'layouts', 'stencilFront',

            'stencilBack', 'stencilReadMask', 'stencilWriteMask', 'depthBias',

            'depthBiasSlopeScale', 'depthBiasClamp',

        ], generation, owner);

        if (!root) throw new TypeError('[vGPU] Render pipeline options are required');

        const shaderStage = stage => {

            if (stage == null) return null;

            const values = this._snapshotPipelineObject(stage, ['module', 'entryPoint'], generation, owner);

            return Object.freeze({

                module: values.module,

                entryPoint: values.entryPoint == null

                    ? 'main'

                    : this._normalizePipelineValue(values.entryPoint, generation, owner, String),

            });

        };

        const vertexLayout = this._snapshotPipelineArray(

            root.vertexLayout || [], generation, owner, layout => {

                const values = this._snapshotPipelineObject(

                    layout, ['arrayStride', 'stepMode', 'attributes'], generation, owner,

                );

                const attributes = this._snapshotPipelineArray(

                    values.attributes || [], generation, owner, attribute => {

                        const fields = this._snapshotPipelineObject(

                            attribute, ['shaderLocation', 'offset', 'format'], generation, owner,

                        );

                        return Object.freeze({

                            shaderLocation: this._normalizePipelineValue(fields.shaderLocation, generation, owner, Number),

                            offset: this._normalizePipelineValue(fields.offset, generation, owner, Number),

                            format: this._normalizePipelineValue(fields.format, generation, owner, String),

                        });

                    },

                );

                return Object.freeze({

                    arrayStride: this._normalizePipelineValue(values.arrayStride, generation, owner, Number),

                    stepMode: values.stepMode == null

                        ? 'vertex'

                        : this._normalizePipelineValue(values.stepMode, generation, owner, String),

                    attributes,

                });

            },

        );

        const layouts = this._snapshotPipelineArray(root.layouts || [], generation, owner);

        const colorFormats = root.colorFormats === undefined

            ? undefined

            : this._snapshotPipelineArray(root.colorFormats, generation, owner, value => (

                this._normalizePipelineValue(value, generation, owner, String)

            ));

        const blend = Array.isArray(root.blend)

            ? this._snapshotPipelineArray(root.blend, generation, owner, value => (

                this._snapshotBlend(value, generation, owner)

            ))

            : this._snapshotBlend(root.blend, generation, owner);

        const stringValue = (value, fallback, preserveNull = false) => {

            if (value === undefined) return fallback;

            if (preserveNull && value === null) return null;

            return this._normalizePipelineValue(value, generation, owner, String);

        };

        const numberValue = (value, fallback) => value === undefined

            ? fallback

            : this._normalizePipelineValue(value, generation, owner, Number);

        return Object.freeze({

            vertex: shaderStage(root.vertex),

            fragment: shaderStage(root.fragment),

            vertexLayout,

            topology: stringValue(root.topology, 'triangle-list'),

            cullMode: stringValue(root.cullMode, 'back'),

            frontFace: stringValue(root.frontFace, 'ccw'),

            depthWrite: root.depthWrite === undefined ? true : Boolean(root.depthWrite),

            depthCompare: stringValue(root.depthCompare, 'less'),

            blend,

            colorFormat: stringValue(root.colorFormat, DEFAULT_COLOR_FORMAT, true),

            colorFormats,

            depthFormat: stringValue(root.depthFormat, DEFAULT_DEPTH_FORMAT, true),

            sampleCount: numberValue(root.sampleCount, 1),

            label: root.label == null ? undefined : stringValue(root.label, undefined),

            layouts,

            stencilFront: this._snapshotStencil(root.stencilFront, generation, owner),

            stencilBack: this._snapshotStencil(root.stencilBack, generation, owner),

            stencilReadMask: root.stencilReadMask === undefined ? undefined : numberValue(root.stencilReadMask),

            stencilWriteMask: root.stencilWriteMask === undefined ? undefined : numberValue(root.stencilWriteMask),

            depthBias: root.depthBias === undefined ? undefined : numberValue(root.depthBias),

            depthBiasSlopeScale: root.depthBiasSlopeScale === undefined ? undefined : numberValue(root.depthBiasSlopeScale),

            depthBiasClamp: root.depthBiasClamp === undefined ? undefined : numberValue(root.depthBiasClamp),

        });

    }



    _snapshotComputeOptions(options, generation, owner) {

        const root = this._snapshotPipelineObject(

            options, ['module', 'entryPoint', 'layout', 'layouts', 'label'], generation, owner,

        );

        if (!root) throw new TypeError('[vGPU] Compute pipeline options are required');

        return Object.freeze({

            module: root.module,

            entryPoint: root.entryPoint == null

                ? 'main'

                : this._normalizePipelineValue(root.entryPoint, generation, owner, String),

            layout: root.layout || null,

            layouts: this._snapshotPipelineArray(root.layouts || [], generation, owner),

            label: root.label == null

                ? undefined

                : this._normalizePipelineValue(root.label, generation, owner, String),

        });

    }



    _capturePipelineExternal(receiver, methodName, generation, owner) {
        this._assertPipelineGeneration(generation, owner);
        const callable = this._readPipelineValue(receiver, methodName, generation, owner);
        if (typeof callable !== 'function') {
            throw new TypeError(`[vGPU] ${methodName} is unavailable`);
        }
        this._assertPipelineGeneration(generation, owner);
        return Object.freeze({ receiver, callable });
    }



    _invokePipelineExternal(captured, args, generation, owner) {
        this._assertPipelineGeneration(generation, owner);

        let result;

        let callError = null;

        try {
            result = Reflect.apply(captured.callable, captured.receiver, args);
        } catch (error) { callError = error; }

        try {

            this._assertPipelineGeneration(generation, owner);

        } catch (error) {

            silenceCorePromise(result);

            throw error;

        }

        if (callError) throw callError;

        return result;

    }

    _callPipelineExternal(receiver, methodName, args, generation, owner) {
        const captured = this._capturePipelineExternal(
            receiver, methodName, generation, owner,
        );
        return this._invokePipelineExternal(captured, args, generation, owner);
    }



    _assertPipelineGeneration(generation, owner = null) {

        this._assertAsyncAlive();

        this._assertPipelineOwnerAlive(owner);

        if (generation !== this._generation) throw this._pipelineCancellationError('generation invalidated');

    }



    getStats() {

        this._assertAsyncAlive();

        return {

            renderPipelines: this.renderPipelines.size,

            computePipelines: this.computePipelines.size,

            pending: snapshotVgpuPrivateMapValues(this, 'pending').length,

        };

    }



    destroy() {

        const state = getCoreManagerLifecycleState(this);
        if (!state || state.destroyed) return false;

        const error = pipelineManagerCancellationError();
        const records = snapshotVgpuPrivateMapValues(this, 'pending');
        const pending = [];
        for (let index = 0; index < records.length; index++) {
            const record = records[index];
            Reflect.apply(VGPU_ARRAY_PUSH, pending, [Object.freeze({
                record,
                cancel: getVgpuOperationCallableAuthority(record, '_cancelWaitAuthority'),
                settle: getVgpuOperationLifecycleAuthorities(record)?.settleAsyncPipeline || null,
            })]);
        }

        if (!terminateCoreManagerLifecycle(this)) return false;
        setCoreManagerDestroyError(this, error);
        clearVgpuPrivateMap(this, 'pending');

        for (const entry of pending) {

            cancelVgpuOperation(entry.record);

            if (entry.settle) Reflect.apply(
                entry.settle.callable, entry.settle.receiver,
                [entry.record, null, error],
            );

            safeInvokeCoreCallable(entry.cancel, [error]);

        }

        try { Reflect.apply(VGPU_MAP_CLEAR, this.renderPipelines, []); } catch (_) {}
        try { Reflect.apply(VGPU_MAP_CLEAR, this.computePipelines, []); } catch (_) {}
        try { this._moduleIds = new VGPU_NATIVE_WEAK_MAP(); } catch (_) {}
        try { this._layoutIds = new VGPU_NATIVE_WEAK_MAP(); } catch (_) {}
        severCoreManagerProperties(this, ['device', 'vgpu']);

        return true;

    }

}



// ============================================================================

// TEXTURE MANAGER

// ============================================================================



class VGPUTextureManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'texture');

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this.textures = new Map();  // id -> { texture, view, descriptor }

        installVgpuPrivateContainer(

            this, 'textures', new VGPU_NATIVE_MAP(),

            entry => entry && Object.freeze({

                texture: entry.texture,

                view: entry.view,

                descriptor: entry.descriptor,

            }),

        );

        this.samplers = new Map();  // key -> GPUSampler

        installVgpuPrivateContainer(this, 'samplers', new VGPU_NATIVE_MAP());

        this._nextId = 1;

    }



    /**

     * Create a texture

     */

    create(options) {

        const generation = this._generation;

        const parent = assertCoreManagerAlive(this, generation);

        const device = this.device;

        const queue = readCoreManagerValue(this, generation, parent, 'queue');

        const memory = readCoreManagerValue(this, generation, parent, 'memory');

        const authoritySpecifications = [

            { name: 'createTexture', receiver: device, key: 'createTexture', operation: 'texture creation' },

            { name: 'writeTexture', receiver: queue, key: 'writeTexture', operation: 'texture upload' },

        ];

        if (memory) authoritySpecifications.push(

            { name: 'trackTexture', receiver: memory, key: 'trackTexture', operation: 'texture memory tracking', optional: true },

            { name: 'untrackTexture', receiver: memory, key: 'untrack', operation: 'texture memory untracking', optional: true },

        );

        const authorities = captureCoreManagerCallableSet(

            this, generation, authoritySpecifications,

        );

        const values = snapshotCoreManagerObject(this, generation, options, [

            'width', 'height', 'depth', 'format', 'usage', 'mipLevels',

            'mipLevelCount', 'sampleCount', 'dimension', 'label', 'data',

        ]);

        const width = normalizeCoreManagerValue(this, generation, () => Number(values.width));

        const height = normalizeCoreManagerValue(this, generation, () => Number(values.height));

        const depth = values.depth == null ? 1 : normalizeCoreManagerValue(this, generation, () => Number(values.depth));

        const format = values.format == null

            ? 'rgba8unorm'

            : normalizeCoreManagerValue(this, generation, () => String(values.format));

        const usage = values.usage == null

            ? 'texture'

            : (typeof values.usage === 'number'

                ? values.usage

                : normalizeCoreManagerValue(this, generation, () => String(values.usage)));

        const effectiveMipLevels = normalizeCoreManagerValue(this, generation, () => Number(

            values.mipLevelCount ?? values.mipLevels ?? 1,

        ));

        const sampleCount = values.sampleCount == null

            ? 1

            : normalizeCoreManagerValue(this, generation, () => Number(values.sampleCount));

        const dimension = values.dimension == null

            ? '2d'

            : normalizeCoreManagerValue(this, generation, () => String(values.dimension));

        const data = snapshotCoreManagerBytes(this, generation, values.data);

        const id = this._nextId++;

        const usageFlags = this._resolveTextureUsage(usage);

        const label = values.label == null || values.label === ''

            ? `vgpu_texture_${id}`

            : normalizeCoreManagerValue(this, generation, () => String(values.label));

        const descriptor = Object.freeze({

            label,

            size: Object.freeze({ width, height, depthOrArrayLayers: depth }),

            format,

            usage: usageFlags,

            mipLevelCount: effectiveMipLevels,

            sampleCount,

            dimension,

        });

        let texture = null;

        let textureCleanup = null;

        let trackedMemory = null;

        try {

            texture = invokeCoreManagerCallable(

                this, generation, authorities.createTexture, [descriptor],

                candidate => safeCoreCleanup(captureCoreCleanup(candidate)),

            );

            textureCleanup = captureCoreCleanup(texture);

            assertCoreManagerAlive(this, generation);

            const createView = captureCoreManagerCallable(

                this, generation, texture, 'createView', 'texture view creation',

            );

            const view = invokeCoreManagerCallable(this, generation, createView, []);

            if (data !== null) {

                invokeCoreManagerCallable(this, generation, authorities.writeTexture, [

                    { texture },

                    data,

                    { bytesPerRow: width * this._getBytesPerPixel(format), rowsPerImage: height },

                    { width, height, depthOrArrayLayers: depth },

                ]);

            }

            if (memory) {

                trackedMemory = memory;

                if (authorities.trackTexture) {

                    assertCoreManagerAlive(this, generation);

                    trackedMemory = memory;

                    Reflect.apply(

                        authorities.trackTexture.callable,

                        authorities.trackTexture.receiver,

                        [texture, descriptor.label, descriptor],

                    );

                    assertCoreManagerAlive(this, generation);

                }

            }

            setVgpuPrivateMapEntry(this, 'textures', id, Object.freeze({

                texture,

                view,

                descriptor,

                cleanup: textureCleanup,

                memoryUntrack: authorities.untrackTexture || null,

            }));

            return { texture, view, id };

        } catch (error) {

            if (trackedMemory) safeInvokeCoreCallable(authorities.untrackTexture, [texture]);

            safeCoreCleanup(textureCleanup || texture);

            throw error;

        }

    }



    _resolveTextureUsage(usage) {

        if (typeof usage === 'number') return usage;



        const flags = {

            'texture': GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,

            'storage': GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,

            'render': GPUTextureUsage.RENDER_ATTACHMENT,

            'copy-src': GPUTextureUsage.COPY_SRC,

            'copy-dst': GPUTextureUsage.COPY_DST,

        };



        const parts = usage.split('|').map(u => flags[u.trim()] || 0);

        return parts.reduce((a, b) => a | b, 0);

    }



    _getBytesPerPixel(format) {

        const bpp = {

            'r8unorm': 1, 'r8snorm': 1, 'r8uint': 1, 'r8sint': 1,

            'rg8unorm': 2, 'rg8snorm': 2, 'rg8uint': 2, 'rg8sint': 2,

            'rgba8unorm': 4, 'rgba8snorm': 4, 'rgba8uint': 4, 'rgba8sint': 4,

            'bgra8unorm': 4,

            'r16float': 2, 'rg16float': 4, 'rgba16float': 8,

            'r32float': 4, 'rg32float': 8, 'rgba32float': 16,

            'depth32float': 4, 'depth24plus': 4,

        };

        return bpp[format] || 4;

    }



    /**

     * Normalize address mode (WebGPU requires 'clamp-to-edge', not 'clamp')

     */

    _normalizeAddressMode(mode) {

        if (mode === 'clamp') return 'clamp-to-edge';

        return mode || 'clamp-to-edge';

    }



    /**

     * Get or create a sampler

     */

    sampler(options = {}) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const device = this.device;

        const createSampler = captureCoreManagerCallable(

            this, generation, device, 'createSampler', 'sampler creation',

        );

        const values = snapshotCoreManagerObject(this, generation, options, [

            'filter', 'addressMode', 'minFilter', 'magFilter', 'mipmapFilter',

            'compare', 'maxAnisotropy', 'addressModeU', 'addressModeV', 'addressModeW',

        ]);

        options = {};

        for (const key of [

            'filter', 'addressMode', 'minFilter', 'magFilter', 'mipmapFilter',

            'compare', 'addressModeU', 'addressModeV', 'addressModeW',

        ]) {

            if (values[key] != null) {

                options[key] = normalizeCoreManagerValue(this, generation, () => String(values[key]));

            }

        }

        options.maxAnisotropy = values.maxAnisotropy == null

            ? 1

            : normalizeCoreManagerValue(this, generation, () => Number(values.maxAnisotropy));

        // Support 'filter' shorthand for minFilter/magFilter/mipmapFilter

        const filterDefault = options.filter || 'linear';

        // Support 'addressMode' shorthand for all address modes

        const addressDefault = this._normalizeAddressMode(options.addressMode ?? 'clamp-to-edge');



        const {

            minFilter = filterDefault,

            magFilter = filterDefault,

            mipmapFilter = filterDefault,

            compare,

            maxAnisotropy = 1,

        } = options;



        // Normalize all address modes (support 'clamp' -> 'clamp-to-edge')

        const addressModeU = options.addressModeU === undefined
            ? addressDefault
            : this._normalizeAddressMode(options.addressModeU);

        const addressModeV = options.addressModeV === undefined
            ? addressDefault
            : this._normalizeAddressMode(options.addressModeV);

        const addressModeW = options.addressModeW === undefined
            ? addressDefault
            : this._normalizeAddressMode(options.addressModeW);



        const key = `${minFilter}|${magFilter}|${mipmapFilter}|${addressModeU}|${addressModeV}|${addressModeW}|${compare || 'none'}|${maxAnisotropy}`;



        if (hasVgpuPrivateMapEntry(this, 'samplers', key)) {

            return getVgpuPrivateMapEntry(this, 'samplers', key);

        }



        const descriptor = {

            minFilter, magFilter, mipmapFilter,

            addressModeU, addressModeV, addressModeW,

            maxAnisotropy,

        };



        if (compare) {

            descriptor.compare = compare;

        }



        assertCoreManagerAlive(this, generation);

        const sampler = invokeCoreManagerCallable(

            this, generation, createSampler, [descriptor],

        );

        setVgpuPrivateMapEntry(this, 'samplers', key, sampler);

        return sampler;

    }



    /**

     * Release a texture

     */

    release(id) {

        assertCoreManagerAlive(this);

        return this._releaseManaged(id);

    }



    _releaseManaged(id) {

        const entry = getVgpuPrivateMapEntry(this, 'textures', id);

        if (entry) {
            deleteVgpuPrivateMapEntry(this, 'textures', id);

            safeInvokeCoreCallable(entry.memoryUntrack, [entry.texture]);

            safeCoreCleanup(entry.cleanup || entry.texture);

            return true;

        }

        return false;

    }



    get(id) {

        assertCoreManagerAlive(this);

        return getVgpuPrivateMapEntry(this, 'textures', id);

    }



    getStats() {

        assertCoreManagerAlive(this);

        return {

            textures: snapshotVgpuPrivateMapValues(this, 'textures').length,

            samplers: snapshotVgpuPrivateMapValues(this, 'samplers').length,

        };

    }



    destroy() {

        const state = getCoreManagerLifecycleState(this);

        if (!state || state.destroyed) return false;

        const records = snapshotVgpuPrivateMapValues(this, 'textures');

        const entries = [];

        for (let index = 0; index < records.length; index++) {

            const entry = records[index];

            entries.push(Object.freeze({

                texture: entry.texture,

                memoryUntrack: entry.memoryUntrack,

                cleanup: entry.cleanup || captureCoreCleanup(entry.texture),

            }));

        }

        if (!terminateCoreManagerLifecycle(this)) return false;

        clearVgpuPrivateMap(this, 'textures');

        clearVgpuPrivateMap(this, 'samplers');

        severCoreManagerProperties(this, ['device', 'vgpu']);

        for (const entry of entries) {

            safeInvokeCoreCallable(entry.memoryUntrack, [entry.texture]);

            safeCoreCleanup(entry.cleanup);

        }

        return true;

    }

}



// ============================================================================

// COMMAND MANAGER

// ============================================================================



class VGPUCommandManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'command');

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this.queue = vgpu.queue;

        this._pendingCommands = [];

        this._activeReads = new Set();

        installVgpuPrivateContainer(this, '_activeReads', new VGPU_NATIVE_SET());

    }



    /**

     * Create a command encoder

     */

    encoder(label = 'vgpu_encoder', createAuthority = null) {

        const generation = this._generation;

        this._assertCommandAlive(generation);

        const createCommandEncoder = createAuthority || Object.freeze({

            receiver: this.device,

            callable: this._readCommandValue(this.device, 'createCommandEncoder', generation),

        });

        if (typeof createCommandEncoder.callable !== 'function') {

            throw new TypeError('[vGPU] command encoder creation is unavailable');

        }

        let normalizedLabel;

        try {

            normalizedLabel = String(label);

        } finally {

            this._assertCommandAlive(generation);

        }

        return this._invokeCommandExternal(

            createCommandEncoder, [{ label: normalizedLabel }], generation,

            candidate => safeCoreCleanup(candidate),

        );

    }



    /**

     * Submit command buffers

     */

    submit(commandBuffers, submitAuthority = null) {

        const generation = this._generation;

        this._assertCommandAlive(generation);

        const submit = submitAuthority || Object.freeze({

            receiver: this.queue,

            callable: this._readCommandValue(this.queue, 'submit', generation),

        });

        if (typeof submit.callable !== 'function') {

            throw new TypeError('[vGPU] command submission is unavailable');

        }

        const buffers = this._snapshotCommandBuffers(commandBuffers, generation);

        return this._invokeCommandExternal(submit, [buffers], generation);

    }



    _readCommandValue(target, key, generation) {

        let value;

        try {

            value = target[key];

        } finally {

            this._assertCommandAlive(generation);

        }

        return value;

    }



    _callCommandExternal(

        receiver, methodName, args, generation = this._generation, operation = methodName,

        retireResult = null,

    ) {

        this._assertCommandAlive(generation);

        const callable = this._readCommandValue(receiver, methodName, generation);

        if (typeof callable !== 'function') throw new TypeError(`[vGPU] ${operation} is unavailable`);

        this._assertCommandAlive(generation);

        let result;

        let callError = null;

        try { result = Reflect.apply(callable, receiver, args); } catch (error) { callError = error; }

        try { this._assertCommandAlive(generation); } catch (error) {

            if (result && retireResult) {

                try { retireResult(result); } catch (_) {}

            }

            silenceCorePromise(result);

            throw error;

        }

        if (callError) throw callError;

        return result;

    }



    _invokeCommandExternal(

        captured, args, generation = this._generation, retireResult = null,

    ) {

        this._assertCommandAlive(generation);

        let result;

        let callError = null;

        try { result = Reflect.apply(captured.callable, captured.receiver, args); }

        catch (error) { callError = error; }

        try { this._assertCommandAlive(generation); } catch (error) {

            if (result && retireResult) {

                try { retireResult(result); } catch (_) {}

            }

            silenceCorePromise(result);

            throw error;

        }

        if (callError) throw callError;

        return result;

    }



    _snapshotCommandBuffers(commandBuffers, generation) {

        if (Array.isArray(commandBuffers)) {

            const lengthValue = this._readCommandValue(commandBuffers, 'length', generation);

            let length;

            try { length = Number(lengthValue); } finally { this._assertCommandAlive(generation); }

            if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('[vGPU] Invalid command buffer array');

            const buffers = new Array(length);

            for (let index = 0; index < length; index++) {

                buffers[index] = this._readCommandValue(commandBuffers, index, generation);

            }

            return buffers;

        }

        const iteratorMethod = this._readCommandValue(commandBuffers, Symbol.iterator, generation);

        if (typeof iteratorMethod !== 'function') return [commandBuffers];

        let iterator;

        try { iterator = iteratorMethod.call(commandBuffers); } finally { this._assertCommandAlive(generation); }

        const next = this._readCommandValue(iterator, 'next', generation);

        if (typeof next !== 'function') throw new TypeError('[vGPU] Invalid command buffer iterable');

        const buffers = [];

        while (true) {

            let step;

            try { step = next.call(iterator); } finally { this._assertCommandAlive(generation); }

            const done = this._readCommandValue(step, 'done', generation);

            if (done) break;

            buffers.push(this._readCommandValue(step, 'value', generation));

        }

        return buffers;

    }



    /**

     * Create and immediately submit a one-shot compute pass

     * @param {Object} options

     */

    dispatchCompute(options) {

        const generation = this._generation;

        this._assertCommandAlive(generation);

        const entryAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'createEncoder', receiver: this.device, key: 'createCommandEncoder', operation: 'compute command encoder creation' },

            { name: 'submit', receiver: this.queue, key: 'submit', operation: 'compute command submission' },

        ]);

        const values = {};

        for (const key of ['pipeline', 'bindGroups', 'workgroups', 'label']) {

            values[key] = this._readCommandValue(options, key, generation);

        }

        let label = 'compute_dispatch';

        if (values.label != null && values.label !== '') {

            try { label = String(values.label); } finally { this._assertCommandAlive(generation); }

        }

        const groups = Array.isArray(values.bindGroups)

            ? this._snapshotCommandBuffers(values.bindGroups, generation)

            : [values.bindGroups];

        const rawWorkgroups = Array.isArray(values.workgroups)

            ? this._snapshotCommandBuffers(values.workgroups, generation)

            : [values.workgroups];

        const dimensions = rawWorkgroups.map((value, index) => {

            if (value === undefined && index > 0) return 1;

            let numeric;

            try { numeric = Number(value); } finally { this._assertCommandAlive(generation); }

            return numeric;

        });

        const [x, y = 1, z = 1] = dimensions;

        const encoder = this.encoder(label, entryAuthorities.createEncoder);

        const encoderAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'beginPass', receiver: encoder, key: 'beginComputePass', operation: 'compute pass creation' },

            { name: 'finish', receiver: encoder, key: 'finish', operation: 'compute command finish' },

        ]);

        const pass = this._invokeCommandExternal(encoderAuthorities.beginPass, [], generation);

        const passAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'setPipeline', receiver: pass, key: 'setPipeline', operation: 'compute set pipeline' },

            { name: 'setBindGroup', receiver: pass, key: 'setBindGroup', operation: 'compute set bind group' },

            { name: 'dispatch', receiver: pass, key: 'dispatchWorkgroups', operation: 'compute dispatch' },

            { name: 'end', receiver: pass, key: 'end', operation: 'compute pass end' },

        ]);

        this._invokeCommandExternal(passAuthorities.setPipeline, [values.pipeline], generation);

        for (let index = 0; index < groups.length; index++) {

            this._invokeCommandExternal(

                passAuthorities.setBindGroup, [index, groups[index]], generation,

            );

        }

        this._invokeCommandExternal(passAuthorities.dispatch, [x, y, z], generation);

        this._invokeCommandExternal(passAuthorities.end, [], generation);

        const commands = this._invokeCommandExternal(encoderAuthorities.finish, [], generation);

        this.submit([commands], entryAuthorities.submit);

    }



    /**

     * Copy buffer to buffer

     */

    copyBuffer(src, dst, srcOffset = 0, dstOffset = 0, size) {

        const generation = this._generation;

        this._assertCommandAlive(generation);

        const entryAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'createEncoder', receiver: this.device, key: 'createCommandEncoder', operation: 'copy command encoder creation' },

            { name: 'submit', receiver: this.queue, key: 'submit', operation: 'copy command submission' },

        ]);

        const offsets = [srcOffset, dstOffset, size].map(value => {

            let numeric;

            try { numeric = Number(value); } finally { this._assertCommandAlive(generation); }

            return numeric;

        });

        const encoder = this.encoder('copy_buffer', entryAuthorities.createEncoder);

        const encoderAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'copy', receiver: encoder, key: 'copyBufferToBuffer', operation: 'buffer copy encoding' },

            { name: 'finish', receiver: encoder, key: 'finish', operation: 'buffer copy command finish' },

        ]);

        this._invokeCommandExternal(

            encoderAuthorities.copy, [src, offsets[0], dst, offsets[1], offsets[2]], generation,

        );

        const commands = this._invokeCommandExternal(encoderAuthorities.finish, [], generation);

        this.submit([commands], entryAuthorities.submit);

    }



    /**

     * Read buffer data back to CPU

     */

    readBuffer(buffer, offset = 0, size, owner = null) {

        const generation = this._generation;

        this._assertCommandAlive(generation);

        const entryAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'createBuffer', receiver: this.device, key: 'createBuffer', operation: 'readback staging buffer creation' },

            { name: 'createEncoder', receiver: this.device, key: 'createCommandEncoder', operation: 'readback command encoder creation' },

            { name: 'submit', receiver: this.queue, key: 'submit', operation: 'readback command submission' },

        ]);

        const sizeValue = size ?? this._readCommandValue(buffer, 'size', generation);

        let readSize;

        let readOffset;

        try {

            readSize = Number(sizeValue);

            readOffset = Number(offset);

        } finally {

            this._assertCommandAlive(generation);

        }

        if (owner?.released || (owner && !owner.record.active)) {
            return rejectVgpuPromise(owner._ownerReleaseError());
        }

        const operation = this._createReadOperation(owner);

        const assertReadCurrent = staging => invokeVgpuOperationLifecycleAuthority(
            operation, 'assertCurrent', [operation, staging],
        );

        const invokeRead = (authority, args) => invokeVgpuOperationLifecycleAuthority(
            operation, 'invoke', [operation, authority, args],
        );

        const retireRead = () => invokeVgpuOperationLifecycleAuthority(
            operation, 'retire', [operation],
        );

        const settleRead = (value, error) => invokeVgpuOperationLifecycleAuthority(
            operation, 'settle', [operation, value, error],
        );

        try {

            const staging = this._invokeCommandExternal(entryAuthorities.createBuffer, [{

                size: readSize,

                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,

                label: 'readback_staging',

            }], generation, candidate => safeCoreCleanup(candidate));

            setVgpuOperationPrivateValue(operation, 'staging', staging);

            setVgpuOperationPrivateValue(operation, 'stagingCleanup', captureCoreCleanup(staging));

            assertReadCurrent(staging);

            const stagingAuthorities = captureCoreManagerCallableSet(this, generation, [

                { name: 'mapAsync', receiver: staging, key: 'mapAsync', operation: 'readback map' },

                { name: 'getMappedRange', receiver: staging, key: 'getMappedRange', operation: 'readback mapped-range access' },

                { name: 'unmap', receiver: staging, key: 'unmap', operation: 'readback unmap', optional: true },

            ]);

            setVgpuOperationPrivateValue(operation, 'mapAsync', stagingAuthorities.mapAsync);

            setVgpuOperationPrivateValue(
                operation, 'getMappedRange', stagingAuthorities.getMappedRange,
            );

            setVgpuOperationPrivateValue(operation, 'unmap', stagingAuthorities.unmap);

            const encoder = this.encoder('readback', entryAuthorities.createEncoder);

            assertReadCurrent(staging);

            const encoderAuthorities = captureCoreManagerCallableSet(this, generation, [

                { name: 'copy', receiver: encoder, key: 'copyBufferToBuffer', operation: 'readback copy encoding' },

                { name: 'finish', receiver: encoder, key: 'finish', operation: 'readback command finish' },

            ]);

            invokeRead(encoderAuthorities.copy, [

                buffer, readOffset, staging, 0, readSize,

            ]);

            assertReadCurrent(staging);

            const commandBuffer = invokeRead(

                encoderAuthorities.finish, [],

            );

            assertReadCurrent(staging);

            this.submit(commandBuffer, entryAuthorities.submit);

            assertReadCurrent(staging);

        } catch (error) {

            retireRead();

            settleRead(null, error);

            return getVgpuOperationPromise(operation);

        }

        const staging = getVgpuOperationPrivateValue(operation, 'staging');

        const rawStart = thenVgpuPromise(resolveVgpuPromise(), () => {

                assertReadCurrent(staging);

                return invokeRead(
                    getVgpuOperationPrivateValue(operation, 'mapAsync'), [GPUMapMode.READ],
                );

            });

        const rawOutcome = thenVgpuPromise(rawStart,

                () => ({ status: 'mapped' }),

                error => ({ status: 'rejected', error }),

            );

        void thenVgpuPromise(raceVgpuPromises([

            rawOutcome,

            thenVgpuPromise(
                getVgpuOperationPrivateValue(operation, 'cancellation'),
                error => ({ status: 'cancelled', error }),
            ),

        ]), outcome => {

            if (
                outcome.status === 'cancelled'
                || !invokeVgpuOperationLifecycleAuthority(
                    operation, 'isCurrent', [operation, staging],
                )
            ) return;

            if (outcome.status === 'rejected') {

                retireRead();

                settleRead(null, outcome.error);

                return;

            }

            setVgpuOperationPrivateValue(operation, 'mapped', true);

            let data;

            try {

                const mappedRange = invokeRead(
                    getVgpuOperationPrivateValue(operation, 'getMappedRange'), [],
                );

                data = Reflect.apply(ArrayBuffer.prototype.slice, mappedRange, [0]);

                assertReadCurrent(staging);

            } catch (error) {

                retireRead();

                settleRead(null, error);

                return;

            }

            retireRead();

            if (!invokeVgpuOperationLifecycleAuthority(
                operation, 'isCurrent', [operation, null],
            )) return;

            settleRead(data, null);

        });

        return getVgpuOperationPromise(operation);

    }



    _createReadOperation(owner = null) {

        const generation = this._generation;

        const lifecycleAuthorities = captureVgpuCallableSet([
            { name: 'assertCurrent', receiver: this, key: '_assertReadCurrent', operation: 'readback lifecycle assertion' },
            { name: 'isCurrent', receiver: this, key: '_isReadCurrent', operation: 'readback lifecycle check' },
            { name: 'invoke', receiver: this, key: '_invokeReadCallable', operation: 'readback callable invocation' },
            { name: 'retire', receiver: this, key: '_retireReadStaging', operation: 'readback staging retirement' },
            { name: 'settle', receiver: this, key: '_settleReadOperation', operation: 'readback settlement' },
        ], () => this._assertCommandAlive(generation));

        let resolvePublic;

        let rejectPublic;

        let cancelWait;

        const operation = {

            generation,

            owner,

            staging: null,

            stagingCleanup: null,

            mapAsync: null,

            getMappedRange: null,

            unmap: null,

            mapped: false,

            settled: false,

            cancelled: false,

            promise: null,

            cancellation: null,

            lifecycleAuthorities,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        for (const property of [
            'staging', 'stagingCleanup', 'mapAsync', 'getMappedRange', 'unmap', 'mapped',
        ]) setVgpuOperationPrivateValue(operation, property, operation[property]);

        operation.cancellation = new VGPU_NATIVE_PROMISE(resolve => { cancelWait = resolve; });

        setVgpuOperationPrivateValue(operation, 'cancellation', operation.cancellation);

        operation.cancelWait = cancelWait;

        installVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority', cancelWait);

        addVgpuPrivateSetEntry(this, '_activeReads', operation);

        return operation;

    }



    _captureReadCallable(operation, receiver, methodName, optional = false) {

        const staging = getVgpuOperationPrivateValue(operation, 'staging');

        invokeVgpuOperationLifecycleAuthority(
            operation, 'assertCurrent', [operation, staging],
        );

        let callable;

        try { callable = receiver[methodName]; } finally {

            invokeVgpuOperationLifecycleAuthority(
                operation, 'assertCurrent', [operation, staging],
            );

        }

        if (typeof callable !== 'function') {

            if (optional) return null;

            throw new TypeError(`[vGPU] Readback ${methodName} is unavailable`);

        }

        return Object.freeze({ receiver, callable });

    }



    _callReadExternal(operation, receiver, methodName, args) {

        const captured = this._captureReadCallable(operation, receiver, methodName);

        return this._invokeReadCallable(operation, captured, args);

    }



    _invokeReadCallable(operation, captured, args) {

        const staging = getVgpuOperationPrivateValue(operation, 'staging');

        if (!this._isReadCurrent(operation, staging)) {
            throw this._destroyError || this._commandCancellationError();
        }

        if (!captured) return undefined;

        let result;

        let callError = null;

        try { result = Reflect.apply(captured.callable, captured.receiver, args); } catch (error) { callError = error; }

        try {
            if (!this._isReadCurrent(operation, staging)) {
                throw this._destroyError || this._commandCancellationError();
            }
        } catch (error) {

            silenceCorePromise(result);

            throw error;

        }

        if (callError) throw callError;

        return result;

    }



    _isReadCurrent(operation, staging) {

        const owner = getVgpuOperationIdentity(operation, 'owner');

        return Boolean(operation)

            && !isVgpuOperationSettled(operation)

            && !isVgpuOperationCancelled(operation)

            && !this._destroyed

            && (!owner || (!owner.released && owner.record.active))

            && getVgpuOperationIdentity(operation, 'generation') === this._generation

            && hasVgpuPrivateSetEntry(this, '_activeReads', operation)

            && getVgpuOperationPrivateValue(operation, 'staging') === staging;

    }



    _assertReadCurrent(operation, staging) {

        if (!this._isReadCurrent(operation, staging)) {

            throw this._destroyError || this._commandCancellationError();

        }

    }



    _retireReadStaging(operation) {

        if (!operation) return;

        const staging = getVgpuOperationPrivateValue(operation, 'staging');

        const wasMapped = getVgpuOperationPrivateValue(operation, 'mapped');

        setVgpuOperationPrivateValue(operation, 'staging', null);

        const stagingCleanup = getVgpuOperationPrivateValue(operation, 'stagingCleanup');

        const unmap = getVgpuOperationPrivateValue(operation, 'unmap');

        setVgpuOperationPrivateValue(operation, 'stagingCleanup', null);

        setVgpuOperationPrivateValue(operation, 'mapAsync', null);

        setVgpuOperationPrivateValue(operation, 'getMappedRange', null);

        setVgpuOperationPrivateValue(operation, 'unmap', null);

        setVgpuOperationPrivateValue(operation, 'mapped', false);

        if (!staging) return;

        if (wasMapped) {

            try {

                if (unmap) Reflect.apply(unmap.callable, unmap.receiver, []);

            } catch (_) {}

        }

        safeCoreCleanup(stagingCleanup || staging);

    }



    _settleReadOperation(operation, value, error) {

        if (!claimVgpuOperationSettlement(operation)) return false;

        deleteVgpuPrivateSetEntry(this, '_activeReads', operation);

        invokeVgpuSettlementAuthority(operation, Boolean(error), error || value);

        return true;

    }



    cancelOwner(owner, error = null) {

        if (!owner) return 0;

        const cancellation = error || owner._ownerReleaseError?.() || this._commandCancellationError();

        const reads = snapshotVgpuPrivateSet(this, '_activeReads').filter(
            operation => getVgpuOperationIdentity(operation, 'owner') === owner,
        );

        for (const operation of reads) {

            cancelVgpuOperation(operation);

            invokeVgpuOperationLifecycleAuthority(operation, 'retire', [operation]);

        }

        for (const operation of reads) {

            safeInvokeCoreCallable(
                getVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority'), [cancellation],
            );

            invokeVgpuOperationLifecycleAuthority(
                operation, 'settle', [operation, null, cancellation],
            );

        }

        return reads.length;

    }



    _commandCancellationError() {

        return commandManagerCancellationError();

    }



    _assertCommandAlive(generation = this._generation) {

        if (

            this._destroyed

            || generation !== this._generation

            || !this.vgpu

            || this.vgpu._destroyed

            || this.vgpu.generation !== this._parentGeneration

        ) throw this._destroyError || this._commandCancellationError();

    }



    destroy() {

        const state = getCoreManagerLifecycleState(this);
        if (!state || state.destroyed) return false;

        const error = commandManagerCancellationError();
        const records = snapshotVgpuPrivateSet(this, '_activeReads');
        const reads = [];
        for (let index = 0; index < records.length; index++) {
            const operation = records[index];
            const lifecycle = getVgpuOperationLifecycleAuthorities(operation);
            Reflect.apply(VGPU_ARRAY_PUSH, reads, [Object.freeze({
                operation,
                cancel: getVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority'),
                retire: lifecycle?.retire || null,
                settle: lifecycle?.settle || null,
            })]);
        }

        if (!terminateCoreManagerLifecycle(this)) return false;
        setCoreManagerDestroyError(this, error);
        clearVgpuPrivateSet(this, '_activeReads');

        for (const entry of reads) {

            cancelVgpuOperation(entry.operation);

            if (entry.retire) Reflect.apply(
                entry.retire.callable, entry.retire.receiver, [entry.operation],
            );

        }

        for (const entry of reads) {

            safeInvokeCoreCallable(entry.cancel, [error]);

            if (entry.settle) Reflect.apply(
                entry.settle.callable, entry.settle.receiver,
                [entry.operation, null, error],
            );

        }

        try { this._pendingCommands.length = 0; } catch (_) {}
        severCoreManagerProperties(this, ['device', 'queue', 'vgpu']);

        return true;

    }

}



// ============================================================================

// MIPMAP GENERATOR - GPU-based mipmap generation

// ============================================================================



const MIPMAP_SHADER = `

@group(0) @binding(0) var srcTexture: texture_2d<f32>;

@group(0) @binding(1) var dstTexture: texture_storage_2d<rgba8unorm, write>;



@compute @workgroup_size(8, 8)

fn main(@builtin(global_invocation_id) id: vec3u) {

    let dstSize = textureDimensions(dstTexture);

    if (id.x >= dstSize.x || id.y >= dstSize.y) { return; }



    let srcCoord = id.xy * 2u;

    let c00 = textureLoad(srcTexture, srcCoord, 0);

    let c10 = textureLoad(srcTexture, srcCoord + vec2u(1u, 0u), 0);

    let c01 = textureLoad(srcTexture, srcCoord + vec2u(0u, 1u), 0);

    let c11 = textureLoad(srcTexture, srcCoord + vec2u(1u, 1u), 0);



    let avg = (c00 + c10 + c01 + c11) * 0.25;

    textureStore(dstTexture, id.xy, avg);

}

`;



class VGPUMipmapGenerator {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'mipmap');

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this._pipeline = null;

        this._sampler = null;

    }



    _ensurePipeline(generation = this._generation) {

        const parent = assertCoreManagerAlive(this, generation);

        const shader = readCoreManagerValue(this, generation, parent, 'shader');

        const bindings = readCoreManagerValue(this, generation, parent, 'bindings');

        const pipelines = readCoreManagerValue(this, generation, parent, 'pipeline');

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'compile', receiver: shader, key: 'compile', operation: 'mipmap shader compile' },

            { name: 'defineLayout', receiver: bindings, key: 'defineLayout', operation: 'mipmap layout creation' },

            { name: 'compute', receiver: pipelines, key: 'compute', operation: 'mipmap pipeline creation' },

        ]);

        if (this._pipeline) return this._pipeline;

        const module = invokeCoreManagerCallable(

            this, generation, authorities.compile, ['vgpu_mipmap', MIPMAP_SHADER],

        );

        const layout = invokeCoreManagerCallable(this, generation, authorities.defineLayout, ['vgpu_mipmap', [

            { binding: 0, type: 'texture', visibility: 'compute', sampleType: 'float' },

            { binding: 1, type: 'storage-texture', visibility: 'compute', format: 'rgba8unorm', access: 'write-only' },

        ]]);

        const pipeline = invokeCoreManagerCallable(this, generation, authorities.compute, [{

            module,

            entryPoint: 'main',

            layout,

            label: 'MipmapGenerator',

        }]);

        assertCoreManagerAlive(this, generation);

        this._pipeline = pipeline;

        return pipeline;

    }



    /**

     * Generate mipmaps for a texture

     * @param {GPUTexture} texture - Must have STORAGE_BINDING usage

     */

    generate(texture, encoder) {

        const generation = this._generation;

        const parent = assertCoreManagerAlive(this, generation);

        const queue = readCoreManagerValue(this, generation, parent, 'queue');

        const entrySpecifications = [

            { name: 'createView', receiver: texture, key: 'createView', operation: 'mipmap texture view creation' },

            { name: 'createEncoder', receiver: this.device, key: 'createCommandEncoder', operation: 'mipmap command encoder creation' },

            { name: 'createBindGroup', receiver: this.device, key: 'createBindGroup', operation: 'mipmap bind-group creation' },

            { name: 'submit', receiver: queue, key: 'submit', operation: 'mipmap queue submit' },

        ];

        if (encoder) entrySpecifications.push(

            { name: 'beginPass', receiver: encoder, key: 'beginComputePass', operation: 'mipmap compute pass creation' },

        );

        const entryAuthorities = captureCoreManagerCallableSet(

            this, generation, entrySpecifications,

        );

        const pipeline = this._ensurePipeline(generation);

        const getBindGroupLayout = captureCoreManagerCallable(

            this, generation, pipeline, 'getBindGroupLayout', 'mipmap bind-group layout lookup',

        );

        const mipCount = normalizeCoreManagerValue(

            this, generation, () => Number(readCoreManagerValue(this, generation, texture, 'mipLevelCount')),

        );

        if (mipCount <= 1) return false;

        const ownEncoder = !encoder;

        if (ownEncoder) {

            encoder = invokeCoreManagerCallable(

                this, generation, entryAuthorities.createEncoder, [{ label: 'mipmap_gen' }],

            );

        }

        const encoderAuthorities = ownEncoder

            ? captureCoreManagerCallableSet(this, generation, [

                { name: 'beginPass', receiver: encoder, key: 'beginComputePass', operation: 'mipmap compute pass creation' },

                { name: 'finish', receiver: encoder, key: 'finish', operation: 'mipmap command finish' },

            ])

            : Object.freeze({ beginPass: entryAuthorities.beginPass, finish: null });

        let width = normalizeCoreManagerValue(

            this, generation, () => Number(readCoreManagerValue(this, generation, texture, 'width')),

        );

        let height = normalizeCoreManagerValue(

            this, generation, () => Number(readCoreManagerValue(this, generation, texture, 'height')),

        );

        for (let level = 1; level < mipCount; level++) {

            const srcView = invokeCoreManagerCallable(

                this, generation, entryAuthorities.createView,

                [{ baseMipLevel: level - 1, mipLevelCount: 1 }],

            );

            const dstView = invokeCoreManagerCallable(

                this, generation, entryAuthorities.createView,

                [{ baseMipLevel: level, mipLevelCount: 1 }],

            );

            width = Math.max(1, width >> 1);

            height = Math.max(1, height >> 1);

            const bindGroupLayout = invokeCoreManagerCallable(

                this, generation, getBindGroupLayout, [0],

            );

            const bindGroup = invokeCoreManagerCallable(this, generation, entryAuthorities.createBindGroup, [{

                layout: bindGroupLayout,

                entries: [

                    { binding: 0, resource: srcView },

                    { binding: 1, resource: dstView },

                ],

            }]);

            const pass = invokeCoreManagerCallable(

                this, generation, encoderAuthorities.beginPass, [],

            );

            const passAuthorities = captureCoreManagerCallableSet(this, generation, [

                { name: 'setPipeline', receiver: pass, key: 'setPipeline', operation: 'mipmap set pipeline' },

                { name: 'setBindGroup', receiver: pass, key: 'setBindGroup', operation: 'mipmap set bind group' },

                { name: 'dispatch', receiver: pass, key: 'dispatchWorkgroups', operation: 'mipmap dispatch' },

                { name: 'end', receiver: pass, key: 'end', operation: 'mipmap pass end' },

            ]);

            invokeCoreManagerCallable(this, generation, passAuthorities.setPipeline, [pipeline]);

            invokeCoreManagerCallable(this, generation, passAuthorities.setBindGroup, [0, bindGroup]);

            invokeCoreManagerCallable(

                this, generation, passAuthorities.dispatch,

                [Math.ceil(width / 8), Math.ceil(height / 8)],

            );

            invokeCoreManagerCallable(this, generation, passAuthorities.end, []);

        }

        if (ownEncoder) {

            const commands = invokeCoreManagerCallable(

                this, generation, encoderAuthorities.finish, [],

            );

            invokeCoreManagerCallable(this, generation, entryAuthorities.submit, [[commands]]);

        }

        return true;

    }



    destroy() {

        if (!terminateCoreManagerLifecycle(this)) return false;

        this._pipeline = null;

        this._sampler = null;

        this.device = null;

        this.vgpu = null;

        return true;

    }

}



// ============================================================================

// QUERY POOL - Occlusion queries and pipeline statistics

// ============================================================================



class VGPUQueryPool {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'queries');

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this._occlusionPools = new VGPU_NATIVE_MAP(); // name -> query-pool facade

        installVgpuPrivateContainer(this, '_occlusionPools', new VGPU_NATIVE_MAP());

        this._nextId = 1;

        this._activeReads = new VGPU_NATIVE_MAP();

        installVgpuPrivateContainer(this, '_activeReads', new VGPU_NATIVE_MAP());

    }



    /**

     * Create an occlusion query pool

     */

    createOcclusionPool(name, count = 256) {

        this._assertQueryAlive();

        const generation = this._generation;

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'createQuerySet', receiver: this.device, key: 'createQuerySet', operation: 'occlusion query-set creation' },

            { name: 'createBuffer', receiver: this.device, key: 'createBuffer', operation: 'occlusion buffer creation' },

        ]);

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(name));

        const normalizedCount = normalizeCoreManagerValue(this, generation, () => Number(count));

        if (!Number.isSafeInteger(normalizedCount) || normalizedCount <= 0) {

            throw new RangeError('[vGPU] Occlusion query count must be a positive integer');

        }

        if (hasVgpuPrivateMapEntry(this, '_occlusionPools', normalizedName)) {

            const existing = getVgpuPrivateMapEntry(this, '_occlusionPools', normalizedName);

            const existingState = getVgpuQueryPoolState(existing);

            if (existingState?.count !== normalizedCount) {

                const error = new Error(`[vGPU] Occlusion pool descriptor mismatch: ${normalizedName}`);

                error.code = 'VGPU_QUERY_POOL_DESCRIPTOR_MISMATCH';

                throw error;

            }

            return existing;

        }



        const poolState = {

            querySet: null,

            querySetCleanup: null,

            resolveBuffer: null,

            resolveBufferCleanup: null,

            resultBuffer: null,

            resultBufferCleanup: null,

            count: normalizedCount,

            nextIndex: 0,

        };

        const pool = createVgpuQueryPoolFacade(poolState);

        try {

            poolState.querySet = invokeCoreManagerCallable(this, generation, authorities.createQuerySet, [{

                type: 'occlusion',

                count: normalizedCount,

                label: `occlusion_${normalizedName}`,

            }], resource => safeCoreCleanup(resource));

            poolState.querySetCleanup = captureCoreCleanup(poolState.querySet);

            this._assertQueryGeneration(generation);

            poolState.resolveBuffer = invokeCoreManagerCallable(this, generation, authorities.createBuffer, [{

                size: normalizedCount * 8, // BigUint64

                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,

                label: `occlusion_resolve_${normalizedName}`,

            }], resource => safeCoreCleanup(resource));

            poolState.resolveBufferCleanup = captureCoreCleanup(poolState.resolveBuffer);

            this._assertQueryGeneration(generation);

            poolState.resultBuffer = invokeCoreManagerCallable(this, generation, authorities.createBuffer, [{

                size: normalizedCount * 8,

                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,

                label: `occlusion_result_${normalizedName}`,

            }], resource => safeCoreCleanup(resource));

            poolState.resultBufferCleanup = captureCoreCleanup(poolState.resultBuffer);

            this._assertQueryGeneration(generation);

        } catch (error) {

            safeCoreCleanup(poolState.resultBufferCleanup || poolState.resultBuffer);

            safeCoreCleanup(poolState.resolveBufferCleanup || poolState.resolveBuffer);

            safeCoreCleanup(poolState.querySetCleanup || poolState.querySet);

            throw error;

        }

        setVgpuPrivateMapEntry(this, '_occlusionPools', normalizedName, pool);

        return pool;

    }



    /**

     * Begin an occlusion query

     */

    beginOcclusion(renderPass, poolName, queryIndex) {

        this._assertQueryAlive();

        const generation = this._generation;

        const beginOcclusionQuerySlot = captureCoreManagerPropertySlot(

            this, generation, renderPass, 'beginOcclusionQuery',

        );

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(poolName));

        const normalizedIndex = normalizeCoreManagerValue(this, generation, () => Number(queryIndex));

        const pool = getVgpuPrivateMapEntry(this, '_occlusionPools', normalizedName);

        const poolState = getVgpuQueryPoolState(pool);

        if (!poolState || normalizedIndex >= poolState.count) return false;

        const beginOcclusionQuery = readCoreManagerPropertySlot(

            this, generation, beginOcclusionQuerySlot,

        );

        if (typeof beginOcclusionQuery !== 'function') {

            throw new TypeError('[vGPU] begin occlusion query is unavailable');

        }

        invokeCoreManagerCallable(this, generation, Object.freeze({

            receiver: renderPass, callable: beginOcclusionQuery,

        }), [normalizedIndex]);

        return true;

    }



    /**

     * End an occlusion query

     */

    endOcclusion(renderPass) {

        const generation = this._generation;

        this._assertQueryGeneration(generation);

        callCoreManagerExternal(this, generation, renderPass, 'endOcclusionQuery', [], 'end occlusion query');

        return true;

    }



    /**

     * Resolve queries and prepare for readback

     */

    resolve(encoder, poolName) {

        this._assertQueryAlive();

        const generation = this._generation;

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'resolve', receiver: encoder, key: 'resolveQuerySet', operation: 'resolve occlusion queries' },

            { name: 'copy', receiver: encoder, key: 'copyBufferToBuffer', operation: 'copy occlusion query results' },

        ]);

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(poolName));

        const pool = getVgpuPrivateMapEntry(this, '_occlusionPools', normalizedName);

        const poolState = getVgpuQueryPoolState(pool);

        if (!poolState) return false;



        invokeCoreManagerCallable(

            this, generation, authorities.resolve,

            [poolState.querySet, 0, poolState.count, poolState.resolveBuffer, 0],

        );

        invokeCoreManagerCallable(

            this, generation, authorities.copy,

            [
                poolState.resolveBuffer,
                0,
                poolState.resultBuffer,
                0,
                poolState.count * 8,
            ],

        );

        return true;

    }



    /**

     * Read occlusion results

     */

    readOcclusionResults(poolName) {

        this._assertQueryAlive();

        const generation = this._generation;

        const lifecycleAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'captureRead', receiver: this, key: '_captureQueryReadCallable', operation: 'query read callable capture' },

            { name: 'invokeRead', receiver: this, key: '_invokeQueryReadCallable', operation: 'query read host call' },

            { name: 'isCurrent', receiver: this, key: '_isQueryReadCurrent', operation: 'query read lifecycle check' },

            { name: 'settle', receiver: this, key: '_settleQueryRead', operation: 'query read settlement' },

            { name: 'cancellationError', receiver: this, key: '_queryCancellationError', operation: 'query cancellation reporting' },

        ]);

        const invokeLifecycle = (authority, args = []) => Reflect.apply(

            authority.callable, authority.receiver, args,

        );

        const isCurrent = operation => invokeLifecycle(lifecycleAuthorities.isCurrent, [operation]);

        const cancellationError = () => this._destroyError

            || invokeLifecycle(lifecycleAuthorities.cancellationError);

        const settle = (operation, value, error) => invokeLifecycle(

            lifecycleAuthorities.settle, [operation, value, error],

        );

        const stagedReadSlots = new Map();

        for (const [name, pool] of snapshotVgpuPrivateMapEntries(this, '_occlusionPools')) {

            const resultBuffer = getVgpuQueryPoolState(pool)?.resultBuffer;

            stagedReadSlots.set(name, Object.freeze({

                pool,

                resultBuffer,

                mapAsync: captureCoreManagerPropertySlot(

                    this, generation, resultBuffer, 'mapAsync',

                ),

                getMappedRange: captureCoreManagerPropertySlot(

                    this, generation, resultBuffer, 'getMappedRange',

                ),

                unmap: captureCoreManagerPropertySlot(

                    this, generation, resultBuffer, 'unmap',

                ),

            }));

        }

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(poolName));

        const pool = getVgpuPrivateMapEntry(this, '_occlusionPools', normalizedName);

        const poolState = getVgpuQueryPoolState(pool);

        if (!pool) return resolveVgpuPromise([]);

        const stagedRead = stagedReadSlots.get(normalizedName);

        if (
            !stagedRead
            || stagedRead.pool !== pool
            || stagedRead.resultBuffer !== poolState?.resultBuffer
        ) {

            throw new Error('[vGPU] Query pool changed during readback staging');

        }

        const existing = getVgpuPrivateMapEntry(this, '_activeReads', normalizedName);

        if (existing) return getVgpuOperationPromise(existing);

        let resolvePublic;

        let rejectPublic;

        let cancelWait;

        const operation = {

            poolName: normalizedName,

            pool,

            resultBuffer: poolState.resultBuffer,

            generation,

            mapped: false,

            settled: false,

            cancelled: false,

            promise: null,

            cancellation: null,

            lifecycleAuthorities,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        for (const property of ['mapAsync', 'getMappedRange', 'unmap', 'mapped']) {
            setVgpuOperationPrivateValue(operation, property, operation[property]);
        }

        operation.cancellation = new VGPU_NATIVE_PROMISE(resolve => { cancelWait = resolve; });

        setVgpuOperationPrivateValue(operation, 'cancellation', operation.cancellation);

        operation.cancelWait = cancelWait;

        installVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority', cancelWait);

        setVgpuPrivateMapEntry(this, '_activeReads', normalizedName, operation);

        try {

            setVgpuOperationPrivateValue(operation, 'mapAsync', invokeLifecycle(lifecycleAuthorities.captureRead, [

                operation, 'mapAsync', stagedRead.mapAsync, lifecycleAuthorities,

            ]));

            setVgpuOperationPrivateValue(operation, 'getMappedRange', invokeLifecycle(lifecycleAuthorities.captureRead, [

                operation, 'getMappedRange', stagedRead.getMappedRange, lifecycleAuthorities,

            ]));

            setVgpuOperationPrivateValue(operation, 'unmap', invokeLifecycle(lifecycleAuthorities.captureRead, [

                operation, 'unmap', stagedRead.unmap, lifecycleAuthorities,

            ]));

        } catch (error) {

            settle(operation, null, error);

            return getVgpuOperationPromise(operation);

        }

        const rawStart = thenVgpuPromise(resolveVgpuPromise(), () => {

                if (!isCurrent(operation)) throw cancellationError();

                return invokeLifecycle(lifecycleAuthorities.invokeRead, [

                    operation,
                    getVgpuOperationPrivateValue(operation, 'mapAsync'),
                    [GPUMapMode.READ],
                    lifecycleAuthorities,

                ]);

            });

        const rawOutcome = thenVgpuPromise(rawStart,

                () => ({ status: 'mapped' }),

                error => ({ status: 'rejected', error }),

            );

        void thenVgpuPromise(raceVgpuPromises([

            rawOutcome,

            thenVgpuPromise(
                getVgpuOperationPrivateValue(operation, 'cancellation'),
                error => ({ status: 'cancelled', error }),
            ),

        ]), outcome => {

            if (outcome.status === 'cancelled' || !isCurrent(operation)) return;

            if (outcome.status === 'rejected') {

                settle(operation, null, outcome.error);

                return;

            }

            setVgpuOperationPrivateValue(operation, 'mapped', true);

            try {

                const mappedRange = invokeLifecycle(lifecycleAuthorities.invokeRead, [

                    operation,
                    getVgpuOperationPrivateValue(operation, 'getMappedRange'),
                    [],
                    lifecycleAuthorities,

                ]);

                const data = new BigUint64Array(mappedRange.slice(0));

                if (!isCurrent(operation)) return;

                // Claim the exact unmap before invoking host code. A reentrant
                // destroy must not observe this read as still mapped and call
                // the same captured unmap authority a second time.
                setVgpuOperationPrivateValue(operation, 'mapped', false);

                invokeLifecycle(lifecycleAuthorities.invokeRead, [

                    operation,
                    getVgpuOperationPrivateValue(operation, 'unmap'),
                    [],
                    lifecycleAuthorities,

                ]);

                settle(operation, Array.from(data).map(value => Number(value)), null);

            } catch (error) {

                if (getVgpuOperationPrivateValue(operation, 'mapped')) {

                    try {

                        const unmap = getVgpuOperationPrivateValue(operation, 'unmap');

                        if (unmap) Reflect.apply(

                            unmap.callable, unmap.receiver, [],

                        );

                    } catch (_) {}

                    setVgpuOperationPrivateValue(operation, 'mapped', false);

                }

                settle(operation, null, error);

            }

        });

        return getVgpuOperationPromise(operation);

    }



    _captureQueryReadCallable(

        operation, methodName, propertySlot = null, lifecycleAuthorities = null,

    ) {

        const isCurrent = () => lifecycleAuthorities

            ? Reflect.apply(

                lifecycleAuthorities.isCurrent.callable,

                lifecycleAuthorities.isCurrent.receiver,

                [operation],

            )

            : this._isQueryReadCurrent(operation);

        const cancellationError = () => this._destroyError || (lifecycleAuthorities

            ? Reflect.apply(

                lifecycleAuthorities.cancellationError.callable,

                lifecycleAuthorities.cancellationError.receiver,

                [],

            )

            : this._queryCancellationError());

        if (!isCurrent()) {

            throw cancellationError();

        }

        let callable;

        try {

            callable = propertySlot

                ? readCoreManagerPropertySlot(
                    this, getVgpuOperationIdentity(operation, 'generation'), propertySlot,
                )

                : getVgpuOperationIdentity(operation, 'resultBuffer')[methodName];

        } finally {

            if (!isCurrent()) {

                throw cancellationError();

            }

        }

        if (typeof callable !== 'function') throw new TypeError(`[vGPU] ${methodName} is unavailable`);

        return Object.freeze({
            receiver: getVgpuOperationIdentity(operation, 'resultBuffer'), callable,
        });

    }



    _invokeQueryReadCallable(operation, captured, args, lifecycleAuthorities = null) {

        const isCurrent = () => lifecycleAuthorities

            ? Reflect.apply(

                lifecycleAuthorities.isCurrent.callable,

                lifecycleAuthorities.isCurrent.receiver,

                [operation],

            )

            : this._isQueryReadCurrent(operation);

        const cancellationError = () => this._destroyError || (lifecycleAuthorities

            ? Reflect.apply(

                lifecycleAuthorities.cancellationError.callable,

                lifecycleAuthorities.cancellationError.receiver,

                [],

            )

            : this._queryCancellationError());

        if (!isCurrent()) {

            throw cancellationError();

        }

        let result;

        let callError = null;

        try { result = Reflect.apply(captured.callable, captured.receiver, args); } catch (error) { callError = error; }

        if (!isCurrent()) {

            silenceCorePromise(result);

            throw cancellationError();

        }

        if (callError) throw callError;

        return result;

    }



    _isQueryReadCurrent(operation) {

        const poolName = getVgpuOperationIdentity(operation, 'poolName');

        const pool = getVgpuOperationIdentity(operation, 'pool');

        return Boolean(operation)

            && !isVgpuOperationSettled(operation)

            && !isVgpuOperationCancelled(operation)

            && !this._destroyed

            && getVgpuOperationIdentity(operation, 'generation') === this._generation

            && getVgpuPrivateMapEntry(this, '_activeReads', poolName) === operation

            && getVgpuPrivateMapEntry(this, '_occlusionPools', poolName) === pool

            && getVgpuQueryPoolState(pool)?.resultBuffer
                === getVgpuOperationIdentity(operation, 'resultBuffer');

    }



    _settleQueryRead(operation, value, error) {

        if (!claimVgpuOperationSettlement(operation)) return false;

        const poolName = getVgpuOperationIdentity(operation, 'poolName');

        if (getVgpuPrivateMapEntry(this, '_activeReads', poolName) === operation) {

            deleteVgpuPrivateMapEntry(this, '_activeReads', poolName);

        }

        invokeVgpuSettlementAuthority(operation, Boolean(error), error || value);

        return true;

    }



    _queryCancellationError() {

        return queryPoolCancellationError();

    }



    _assertQueryAlive() {

        const parent = this.vgpu;

        if (

            this._destroyed

            || !parent

            || parent._destroyed

            || parent.generation !== this._parentGeneration

        ) throw this._destroyError || this._queryCancellationError();

    }



    _assertQueryGeneration(generation) {

        this._assertQueryAlive();

        if (generation !== this._generation) {

            throw this._destroyError || this._queryCancellationError();

        }

    }



    _destroyQueryPool(pool) {

        if (!pool) return;

        this._retireQueryPoolCleanup(this._captureQueryPoolCleanup(pool));

    }



    _captureQueryPoolCleanup(pool) {

        const state = getVgpuQueryPoolState(pool);

        if (!state) return null;

        const querySetCleanup = state.querySetCleanup;

        const resolveBufferCleanup = state.resolveBufferCleanup;

        const resultBufferCleanup = state.resultBufferCleanup;

        return Object.freeze({

            querySetCleanup,

            resolveBufferCleanup,

            resultBufferCleanup,

        });

    }



    _retireQueryPoolCleanup(cleanup) {

        safeCoreCleanup(cleanup.querySetCleanup);

        safeCoreCleanup(cleanup.resolveBufferCleanup);

        safeCoreCleanup(cleanup.resultBufferCleanup);

    }



    /**

     * Reset pool for next frame

     */

    reset(poolName) {

        this._assertQueryAlive();

        const generation = this._generation;

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(poolName));

        const pool = getVgpuPrivateMapEntry(this, '_occlusionPools', normalizedName);

        const state = getVgpuQueryPoolState(pool);

        if (state) state.nextIndex = 0;

    }



    destroy() {

        const lifecycle = getCoreManagerLifecycleState(this);

        if (!lifecycle || lifecycle.destroyed) return false;

        const error = queryPoolCancellationError();

        const reads = snapshotVgpuPrivateMapValues(this, '_activeReads');

        const readCleanups = [];
        for (let index = 0; index < reads.length; index++) {
            const operation = reads[index];
            Reflect.apply(VGPU_ARRAY_PUSH, readCleanups, [Object.freeze({
                operation,
                unmap: getVgpuOperationPrivateValue(operation, 'unmap') || null,
                cancel: getVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority'),
                reject: getVgpuOperationState(operation)?.rejectAuthority || null,
            })]);
        }

        const poolFacades = snapshotVgpuPrivateMapValues(this, '_occlusionPools');
        const pools = [];
        for (let index = 0; index < poolFacades.length; index++) {
            const state = getVgpuQueryPoolState(poolFacades[index]);
            if (!state) continue;
            Reflect.apply(VGPU_ARRAY_PUSH, pools, [Object.freeze({
                querySetCleanup: state.querySetCleanup,
                resolveBufferCleanup: state.resolveBufferCleanup,
                resultBufferCleanup: state.resultBufferCleanup,
            })]);
        }

        if (!terminateCoreManagerLifecycle(this)) return false;

        setCoreManagerDestroyError(this, error);

        clearVgpuPrivateMap(this, '_activeReads');

        clearVgpuPrivateMap(this, '_occlusionPools');

        for (const entry of readCleanups) {

            const operation = entry.operation;

            cancelVgpuOperation(operation);

            forceVgpuOperationSettlement(operation);

            setVgpuOperationPrivateValue(operation, 'resultBuffer', null);

            if (getVgpuOperationPrivateValue(operation, 'mapped')) {

                try {

                    if (entry.unmap) Reflect.apply(

                        entry.unmap.callable, entry.unmap.receiver, [],

                    );

                } catch (_) {}

                setVgpuOperationPrivateValue(operation, 'mapped', false);

            }

        }

        for (const poolCleanup of pools) {
            safeCoreCleanup(poolCleanup.querySetCleanup);
            safeCoreCleanup(poolCleanup.resolveBufferCleanup);
            safeCoreCleanup(poolCleanup.resultBufferCleanup);
        }

        for (const entry of readCleanups) {

            safeInvokeCoreCallable(entry.cancel, [error]);

            safeInvokeCoreCallable(entry.reject, [error]);

        }

        severCoreManagerProperties(this, ['device', 'vgpu']);

        return true;

    }

}



// ============================================================================

// PIPELINE WARMUP - Pre-compile pipelines during loading

// ============================================================================



class VGPUPipelineWarmup {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'pipeline-warmup');

        this.vgpu = vgpu;

        this._pending = [];

        setCoreManagerPrivateValue(this, 'pendingMirror', this._pending);

        installVgpuPrivateContainer(this, '_pendingPromises', new VGPU_NATIVE_SET());

        this._completed = 0;

        this._total = 0;

        this._waitOperations = new Set();

        installVgpuPrivateContainer(this, '_waitOperations', new VGPU_NATIVE_SET());

        this._queueOperations = new Set();

        installVgpuPrivateContainer(this, '_queueOperations', new VGPU_NATIVE_SET());

    }



    /**

     * Queue a render pipeline for async compilation

     */

    queueRender(options) {

        return this._queuePipeline('render', options);

    }



    /**

     * Queue a compute pipeline for async compilation

     */

    queueCompute(options) {

        return this._queuePipeline('compute', options);

    }



    _queuePipeline(kind, options) {

        const generation = this._generation;

        const parent = this._assertWarmupAlive(generation);

        const lifecycleAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'isCurrent', receiver: this, key: '_isWarmupQueueCurrent', operation: 'warmup queue lifecycle check' },

            { name: 'settle', receiver: this, key: '_settleWarmupQueue', operation: 'warmup queue settlement' },

        ]);

        let resolvePublic;

        let rejectPublic;

        let cancelWait;

        const operation = {

            generation,

            settled: false,

            cancelled: false,

            promise: null,

            cancellation: null,

            lifecycleAuthorities,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        operation.cancellation = new VGPU_NATIVE_PROMISE(resolve => { cancelWait = resolve; });

        setVgpuOperationPrivateValue(operation, 'cancellation', operation.cancellation);

        operation.cancelWait = cancelWait;

        installVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority', cancelWait);

        addVgpuPrivateSetEntry(this, '_queueOperations', operation);

        addVgpuPrivateSetEntry(this, '_pendingPromises', getVgpuOperationPromise(operation));

        syncWarmupPendingMirror(this);

        this._total++;

        let backend;

        try {

            const pipeline = readCoreManagerValue(this, generation, parent, 'pipeline');

            backend = callCoreManagerExternal(

                this,

                generation,

                pipeline,

                kind === 'render' ? 'renderAsync' : 'computeAsync',

                [options],

                `pipeline warmup ${kind}`,

            );

        } catch (error) {

            Reflect.apply(

                lifecycleAuthorities.settle.callable,

                lifecycleAuthorities.settle.receiver,

                [operation, null, error],

            );

            return getVgpuOperationPromise(operation);

        }

        const rawOutcome = thenVgpuPromise(resolveVgpuPromise(backend),

            pipeline => ({ status: 'resolved', pipeline }),

            error => ({ status: 'rejected', error }),

        );

        void thenVgpuPromise(raceVgpuPromises([

            rawOutcome,

            thenVgpuPromise(
                getVgpuOperationPrivateValue(operation, 'cancellation'),
                error => ({ status: 'cancelled', error }),
            ),

        ]), outcome => {

            if (outcome.status === 'cancelled' || !Reflect.apply(

                lifecycleAuthorities.isCurrent.callable,

                lifecycleAuthorities.isCurrent.receiver,

                [operation],

            )) return;

            if (outcome.status === 'rejected') {

                Reflect.apply(

                    lifecycleAuthorities.settle.callable,

                    lifecycleAuthorities.settle.receiver,

                    [operation, null, outcome.error],

                );

                return;

            }

            this._completed++;

            Reflect.apply(

                lifecycleAuthorities.settle.callable,

                lifecycleAuthorities.settle.receiver,

                [operation, outcome.pipeline, null],

            );

        });

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        return getVgpuOperationPromise(operation);

    }



    _isWarmupQueueCurrent(operation) {

        return Boolean(operation)

            && !isVgpuOperationSettled(operation)

            && !isVgpuOperationCancelled(operation)

            && !this._destroyed

            && this.vgpu

            && !this.vgpu._destroyed

            && this.vgpu.generation === this._parentGeneration

            && getVgpuOperationIdentity(operation, 'generation') === this._generation

            && hasVgpuPrivateSetEntry(this, '_queueOperations', operation);

    }



    _settleWarmupQueue(operation, value, error) {

        if (!claimVgpuOperationSettlement(operation)) return false;

        deleteVgpuPrivateSetEntry(this, '_queueOperations', operation);

        invokeVgpuSettlementAuthority(operation, Boolean(error), error || value);

        return true;

    }



    _cancelWarmupQueues(error) {

        return cancelWarmupOperations(this, '_queueOperations', error, false);

    }



    /**

     * Wait for all queued pipelines to compile

     */

    waitAll() {

        try { this._assertWarmupAlive(this._generation); } catch (error) { return rejectVgpuPromise(error); }

        const generation = this._generation;

        const lifecycleAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'isCurrent', receiver: this, key: '_isWarmupWaitCurrent', operation: 'warmup wait lifecycle check' },

            { name: 'settle', receiver: this, key: '_settleWarmupWait', operation: 'warmup wait settlement' },

        ]);

        const snapshot = snapshotVgpuPrivateSet(this, '_pendingPromises');

        if (snapshot.length === 0) return resolveVgpuPromise();

        let resolvePublic;

        let rejectPublic;

        let cancelWait;

        const operation = {

            generation: this._generation,

            snapshot,

            settled: false,

            cancelled: false,

            promise: null,

            cancellation: null,

            lifecycleAuthorities,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        operation.cancellation = new VGPU_NATIVE_PROMISE(resolve => { cancelWait = resolve; });

        setVgpuOperationPrivateValue(operation, 'cancellation', operation.cancellation);

        operation.cancelWait = cancelWait;

        installVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority', cancelWait);

        addVgpuPrivateSetEntry(this, '_waitOperations', operation);

        const rawOutcome = thenVgpuPromise(allVgpuPromises(snapshot),

            () => ({ status: 'resolved' }),

            error => ({ status: 'rejected', error }),

        );

        void thenVgpuPromise(raceVgpuPromises([

            rawOutcome,

            thenVgpuPromise(
                getVgpuOperationPrivateValue(operation, 'cancellation'),
                error => ({ status: 'cancelled', error }),
            ),

        ]), outcome => {

            if (outcome.status === 'cancelled' || !Reflect.apply(

                lifecycleAuthorities.isCurrent.callable,

                lifecycleAuthorities.isCurrent.receiver,

                [operation],

            )) return;

            Reflect.apply(

                lifecycleAuthorities.settle.callable,

                lifecycleAuthorities.settle.receiver,

                [operation, outcome.status === 'rejected' ? outcome.error : null],

            );

        });

        return getVgpuOperationPromise(operation);

    }



    _isWarmupWaitCurrent(operation) {

        return Boolean(operation)

            && !isVgpuOperationSettled(operation)

            && !isVgpuOperationCancelled(operation)

            && !this._destroyed

            && this.vgpu

            && !this.vgpu._destroyed

            && this.vgpu.generation === this._parentGeneration

            && getVgpuOperationIdentity(operation, 'generation') === this._generation

            && hasVgpuPrivateSetEntry(this, '_waitOperations', operation);

    }



    _settleWarmupWait(operation, error) {

        if (!claimVgpuOperationSettlement(operation)) return false;

        deleteVgpuPrivateSetEntry(this, '_waitOperations', operation);

        const completed = getVgpuOperationIdentity(operation, 'snapshot') || [];

        for (let index = 0; index < completed.length; index++) {

            deleteVgpuPrivateSetEntry(this, '_pendingPromises', completed[index]);

        }

        syncWarmupPendingMirror(this);

        invokeVgpuSettlementAuthority(operation, Boolean(error), error);

        return true;

    }



    _warmupCancellationError(reason = 'destroyed') {

        return warmupManagerCancellationError(reason);

    }



    /**

     * Get compilation progress

     */

    getProgress() {

        this._assertWarmupAlive(this._generation);

        return {

            completed: this._completed,

            total: this._total,

            percent: this._total > 0 ? (this._completed / this._total * 100).toFixed(1) : 100,

        };

    }



    /**

     * Reset counters

     */

    reset() {

        this._assertWarmupAlive(this._generation);

        advanceCoreManagerGeneration(this);

        const error = warmupManagerCancellationError('reset');

        cancelWarmupOperations(this, '_queueOperations', error, false);

        cancelWarmupOperations(this, '_waitOperations', error, true);

        clearVgpuPrivateSet(this, '_pendingPromises');

        syncWarmupPendingMirror(this);

        this._completed = 0;

        this._total = 0;

    }



    destroy() {

        const state = getCoreManagerLifecycleState(this);

        if (!state || state.destroyed) return false;

        const error = warmupManagerCancellationError();

        const snapshotOperations = name => {

            const records = snapshotVgpuPrivateSet(this, name);

            const entries = [];

            for (let index = 0; index < records.length; index++) {

                const operation = records[index];

                const lifecycle = getVgpuOperationLifecycleAuthorities(operation);

                Reflect.apply(VGPU_ARRAY_PUSH, entries, [Object.freeze({

                    operation,

                    cancel: getVgpuOperationCallableAuthority(operation, '_cancelWaitAuthority'),

                    settle: lifecycle?.settle || null,

                })]);

            }

            return entries;

        };

        const queues = snapshotOperations('_queueOperations');

        const waits = snapshotOperations('_waitOperations');

        if (!terminateCoreManagerLifecycle(this)) return false;

        setCoreManagerDestroyError(this, error);

        clearVgpuPrivateSet(this, '_queueOperations');

        clearVgpuPrivateSet(this, '_waitOperations');

        clearVgpuPrivateSet(this, '_pendingPromises');

        for (const entry of queues) {

            cancelVgpuOperation(entry.operation);

            safeInvokeCoreCallable(entry.cancel, [error]);

            if (entry.settle) Reflect.apply(

                entry.settle.callable, entry.settle.receiver,

                [entry.operation, null, error],

            );

        }

        for (const entry of waits) {

            cancelVgpuOperation(entry.operation);

            safeInvokeCoreCallable(entry.cancel, [error]);

            if (entry.settle) Reflect.apply(

                entry.settle.callable, entry.settle.receiver,

                [entry.operation, error],

            );

        }

        syncWarmupPendingMirror(this);

        try { this._completed = 0; } catch (_) {}

        try { this._total = 0; } catch (_) {}

        severCoreManagerProperties(this, ['vgpu']);

        return true;

    }



    _assertWarmupAlive(generation) {

        const parent = this.vgpu;

        if (

            this._destroyed

            || generation !== this._generation

            || !parent

            || parent._destroyed

            || parent.generation !== this._parentGeneration

        ) throw this._destroyError || this._warmupCancellationError();

        return parent;

    }

}



// ============================================================================

// FRAME GRAPH INTEGRATION - Connect vGPU to FrameGraph

// ============================================================================



class VGPUFrameGraphBridge {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'frame-graph-bridge');

        this.vgpu = vgpu;

        this._textureManager = vgpu.texture;

        setCoreManagerPrivateValue(this, 'textureManager', this._textureManager);

        this._bufferManager = vgpu.buffer;

        setCoreManagerPrivateValue(this, 'bufferManager', this._bufferManager);

        this._transientTextures = new Map(); // aliasId -> { id, resource }

        installVgpuPrivateContainer(

            this, '_transientTextures', new VGPU_NATIVE_MAP(),

            record => record && Object.freeze({ id: record.id, resource: record.resource }),

        );

        this._transientBuffers = new Map();  // aliasId -> { id, resource }

        installVgpuPrivateContainer(

            this, '_transientBuffers', new VGPU_NATIVE_MAP(),

            record => record && Object.freeze({ id: record.id, resource: record.resource }),

        );

    }



    /**

     * Allocate transient resources based on frame graph compilation

     */

    allocateTransients(compiledGraph, resourceSpecs) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'getSnapshot', receiver: compiledGraph, key: 'getDebugSnapshot', operation: 'frame-graph snapshot' },

            { name: 'createTexture', receiver: getCoreManagerPrivateValue(this, 'textureManager'), key: 'create', operation: 'frame-graph texture allocation' },

            { name: 'releaseTexture', receiver: getCoreManagerPrivateValue(this, 'textureManager'), key: '_releaseManaged', operation: 'frame-graph texture release' },

            { name: 'createBuffer', receiver: getCoreManagerPrivateValue(this, 'bufferManager'), key: 'create', operation: 'frame-graph buffer allocation' },

            { name: 'releaseBuffer', receiver: getCoreManagerPrivateValue(this, 'bufferManager'), key: '_releaseManaged', operation: 'frame-graph buffer release' },

        ]);

        const graphSnapshot = invokeCoreManagerCallable(

            this, generation, authorities.getSnapshot, [],

        );

        const resources = readCoreManagerValue(this, generation, graphSnapshot, 'resources');

        const resourceSnapshot = snapshotCoreManagerArray(this, generation, resources, [

            'external', 'name', 'aliasId',

        ]);

        const created = [];

        try {

            for (const resource of resourceSnapshot) {

                if (resource.external) continue;

                const name = normalizeCoreManagerValue(this, generation, () => String(resource.name));

                const spec = readCoreManagerValue(this, generation, resourceSpecs, name);

                if (!spec) continue;

                const values = snapshotCoreManagerObject(this, generation, spec, [

                    'type', 'width', 'height', 'format', 'usage', 'size',

                ]);

                const type = normalizeCoreManagerValue(this, generation, () => String(values.type));

                const aliasId = resource.aliasId == null || resource.aliasId === ''

                    ? name

                    : normalizeCoreManagerValue(this, generation, () => String(resource.aliasId));

                if (type === 'texture' && !hasVgpuPrivateMapEntry(this, '_transientTextures', aliasId)) {

                    const result = invokeCoreManagerCallable(

                        this, generation, authorities.createTexture, [{

                        width: values.width,

                        height: values.height,

                        format: values.format ?? 'rgba8unorm',

                        usage: values.usage ?? 'render|texture',

                        label: `transient_${aliasId}`,

                        }],

                        candidate => safeInvokeCoreCallable(

                            authorities.releaseTexture, [candidate?.id],

                        ),

                    );

                    const record = Object.freeze({

                        id: result.id, resource: result.texture, release: authorities.releaseTexture,

                    });

                    setVgpuPrivateMapEntry(this, '_transientTextures', aliasId, record);

                    Reflect.apply(VGPU_ARRAY_PUSH, created, [{

                        containerName: '_transientTextures', aliasId, record,

                    }]);

                }

                if (type === 'buffer' && !hasVgpuPrivateMapEntry(this, '_transientBuffers', aliasId)) {

                    const result = invokeCoreManagerCallable(

                        this, generation, authorities.createBuffer, [{

                        size: values.size,

                        usage: values.usage ?? 'storage',

                        label: `transient_${aliasId}`,

                        }],

                        candidate => safeInvokeCoreCallable(

                            authorities.releaseBuffer, [candidate?.id],

                        ),

                    );

                    const record = Object.freeze({

                        id: result.id, resource: result.buffer, release: authorities.releaseBuffer,

                    });

                    setVgpuPrivateMapEntry(this, '_transientBuffers', aliasId, record);

                    Reflect.apply(VGPU_ARRAY_PUSH, created, [{

                        containerName: '_transientBuffers', aliasId, record,

                    }]);

                }

            }

        } catch (error) {

            for (let index = created.length - 1; index >= 0; index--) {

                const item = created[index];

                if (getVgpuPrivateMapEntry(this, item.containerName, item.aliasId) === item.record) {

                    deleteVgpuPrivateMapEntry(this, item.containerName, item.aliasId);

                }

                safeInvokeCoreCallable(item.record.release, [item.record.id]);

            }

            throw error;

        }

    }



    /**

     * Get a transient texture by resource name or alias

     */

    getTexture(nameOrAlias) {

        assertCoreManagerAlive(this);

        return getVgpuPrivateMapEntry(this, '_transientTextures', nameOrAlias)?.resource;

    }



    /**

     * Get a transient buffer by resource name or alias

     */

    getBuffer(nameOrAlias) {

        assertCoreManagerAlive(this);

        return getVgpuPrivateMapEntry(this, '_transientBuffers', nameOrAlias)?.resource;

    }



    /**

     * Clear transient resources (call at end of frame or graph rebuild)

     */

    clearTransients() {

        assertCoreManagerAlive(this);

        this._releaseTransients();

    }



    _releaseTransients() {

        const textureRelease = captureVgpuCallable(

            getCoreManagerPrivateValue(this, 'textureManager'), '_releaseManaged',

        );

        const bufferRelease = captureVgpuCallable(

            getCoreManagerPrivateValue(this, 'bufferManager'), '_releaseManaged',

        );

        const textureRecords = snapshotVgpuPrivateMapValues(this, '_transientTextures');

        const bufferRecords = snapshotVgpuPrivateMapValues(this, '_transientBuffers');

        clearVgpuPrivateMap(this, '_transientTextures');

        clearVgpuPrivateMap(this, '_transientBuffers');

        for (const record of textureRecords) {

            safeInvokeCoreCallable(textureRelease || record.release, [record.id]);

        }

        for (const record of bufferRecords) {

            safeInvokeCoreCallable(bufferRelease || record.release, [record.id]);

        }

    }



    /**

     * Create execution context for frame graph

     */

    createContext(extras = {}) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const context = { ...snapshotCoreManagerOptions(this, generation, extras) };

        Object.defineProperties(context, {

            vgpu: { enumerable: true, get: () => assertCoreManagerAlive(this, generation) },

            device: { enumerable: true, get: () => assertCoreManagerAlive(this, generation).device },

            queue: { enumerable: true, get: () => assertCoreManagerAlive(this, generation).queue },

        });

        context.getTexture = name => this.getTexture(name);

        context.getBuffer = name => this.getBuffer(name);

        return context;

    }



    destroy() {

        const state = getCoreManagerLifecycleState(this);

        if (!state || state.destroyed) return false;

        const textureRelease = captureVgpuCallable(

            getCoreManagerPrivateValue(this, 'textureManager'), '_releaseManaged',

        );

        const bufferRelease = captureVgpuCallable(

            getCoreManagerPrivateValue(this, 'bufferManager'), '_releaseManaged',

        );

        const textureRecords = snapshotVgpuPrivateMapValues(this, '_transientTextures');

        const bufferRecords = snapshotVgpuPrivateMapValues(this, '_transientBuffers');

        if (!terminateCoreManagerLifecycle(this)) return false;

        clearVgpuPrivateMap(this, '_transientTextures');

        clearVgpuPrivateMap(this, '_transientBuffers');

        setCoreManagerPrivateValue(this, 'textureManager', null);

        setCoreManagerPrivateValue(this, 'bufferManager', null);

        for (const record of textureRecords) {

            safeInvokeCoreCallable(textureRelease || record.release, [record.id]);

        }

        for (const record of bufferRecords) {

            safeInvokeCoreCallable(bufferRelease || record.release, [record.id]);

        }

        severCoreManagerProperties(this, ['_textureManager', '_bufferManager', 'vgpu']);

        return true;

    }

}



// ============================================================================

// ENGINE PROFILER BRIDGE - Connect vGPU to game's EngineProfiler

// ============================================================================



class VGPUProfilerBridge {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'profiler-bridge');

        this.vgpu = vgpu;

        this._engineProfiler = null;

        setCoreManagerPrivateValue(this, 'engineProfiler', null);

        this._operations = new Set();

        installVgpuPrivateContainer(this, '_operations', new VGPU_NATIVE_SET());

    }



    /**

     * Connect to the game's EngineProfiler

     */

    connect(engineProfiler) {

        assertCoreManagerAlive(this);

        this._engineProfiler = engineProfiler;

        setCoreManagerPrivateValue(this, 'engineProfiler', engineProfiler);

        return true;

    }



    /**

     * Sync vGPU stats to EngineProfiler metrics

     */

    sync() {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const assertCurrent = captureCoreManagerCallable(

            this, generation, this, '_assertBridgeCurrent', 'profiler bridge lifecycle assertion',

        );

        const engineProfiler = getCoreManagerPrivateValue(this, 'engineProfiler');

        if (!engineProfiler) return false;

        const parent = this.vgpu;

        const getStatsSlot = captureCoreManagerPropertySlot(

            this, generation, parent, 'getStats',

        );

        const metricsSlot = captureCoreManagerPropertySlot(

            this, generation, engineProfiler, 'metrics',

        );

        const getStats = readCoreManagerPropertySlot(this, generation, getStatsSlot);

        const metrics = readCoreManagerPropertySlot(this, generation, metricsSlot);

        if (typeof getStats !== 'function') throw new TypeError('[vGPU] Profiler stats are unavailable');

        const stats = Reflect.apply(getStats, parent, []);

        invokeCoreManagerCallable(this, generation, assertCurrent, [generation, engineProfiler]);



        // Sync buffer stats

        if (stats.buffer) {

            metrics.bufferPoolHits = stats.buffer.pool?.hits || 0;

            invokeCoreManagerCallable(this, generation, assertCurrent, [generation, engineProfiler]);

            metrics.bufferPoolMisses = stats.buffer.pool?.misses || 0;

            invokeCoreManagerCallable(this, generation, assertCurrent, [generation, engineProfiler]);

        }



        // Sync pipeline stats

        if (stats.pipeline) {

            metrics.renderPasses = stats.pipeline.renderPipelines || 0;

            invokeCoreManagerCallable(this, generation, assertCurrent, [generation, engineProfiler]);

            metrics.computePasses = stats.pipeline.computePipelines || 0;

            invokeCoreManagerCallable(this, generation, assertCurrent, [generation, engineProfiler]);

        }



        // Sync ring buffer stats

        if (stats.ring?.default) {

            // Could add ring buffer utilization metric

        }

    }



    /**

     * Report GPU timing from vGPU profiler to EngineProfiler

     */

    syncGPUTiming() {

        const generation = this._generation;

        try { assertCoreManagerAlive(this, generation); } catch (error) { return rejectVgpuPromise(error); }

        const lifecycleAuthorities = captureCoreManagerCallableSet(this, generation, [
            { name: 'complete', receiver: this, key: '_completeBridgeTiming', operation: 'profiler bridge completion' },
            { name: 'isCurrent', receiver: this, key: '_isBridgeOperationCurrent', operation: 'profiler bridge lifecycle check' },
            { name: 'settle', receiver: this, key: '_settleBridgeOperation', operation: 'profiler bridge settlement' },
        ]);

        const engineProfiler = getCoreManagerPrivateValue(this, 'engineProfiler');

        if (!engineProfiler) return resolveVgpuPromise(false);

        let resolvePublic;

        let rejectPublic;

        const operation = {

            generation,

            engineProfiler,

            profiler: null,

            passTimings: null,

            passTimingSet: null,

            metrics: null,

            lifecycleAuthorities,

            settled: false,

            promise: null,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        addVgpuPrivateSetEntry(this, '_operations', operation);

        let pending;

        try {

            const profiler = readCoreManagerValue(this, generation, this.vgpu, 'profiler');

            setVgpuOperationPrivateValue(operation, 'profiler', profiler);

            const getResultsSlot = captureCoreManagerPropertySlot(

                this, generation, profiler, 'getResults',

            );

            const passTimingsSlot = captureCoreManagerPropertySlot(

                this, generation, engineProfiler, 'passTimings',

            );

            const metricsSlot = captureCoreManagerPropertySlot(

                this, generation, engineProfiler, 'metrics',

            );

            const passTimings = readCoreManagerPropertySlot(

                this, generation, passTimingsSlot,

            );

            const passTimingSetSlot = passTimings

                ? captureCoreManagerPropertySlot(this, generation, passTimings, 'set')

                : null;

            const getResults = readCoreManagerPropertySlot(this, generation, getResultsSlot);

            setVgpuOperationPrivateValue(operation, 'passTimings', passTimings);

            setVgpuOperationPrivateValue(operation, 'passTimingSet', passTimingSetSlot

                ? readCoreManagerPropertySlot(this, generation, passTimingSetSlot)

                : null);

            setVgpuOperationPrivateValue(
                operation, 'metrics',
                readCoreManagerPropertySlot(this, generation, metricsSlot),
            );

            if (typeof getResults !== 'function') throw new TypeError('[vGPU] Profiler results are unavailable');

            if (!Reflect.apply(
                lifecycleAuthorities.isCurrent.callable,
                lifecycleAuthorities.isCurrent.receiver,
                [operation],
            )) throw coreManagerLifecycleError(this);

            pending = Reflect.apply(getResults, profiler, []);

            if (!Reflect.apply(
                lifecycleAuthorities.isCurrent.callable,
                lifecycleAuthorities.isCurrent.receiver,
                [operation],
            )) throw coreManagerLifecycleError(this);

        } catch (error) {

            silenceCorePromise(pending);

            Reflect.apply(
                lifecycleAuthorities.settle.callable,
                lifecycleAuthorities.settle.receiver,
                [operation, null, error],
            );

            return getVgpuOperationPromise(operation);

        }

        void thenVgpuPromise(resolveVgpuPromise(pending),

            rawResults => Reflect.apply(
                lifecycleAuthorities.complete.callable,
                lifecycleAuthorities.complete.receiver,
                [operation, rawResults],
            ),

            error => Reflect.apply(
                lifecycleAuthorities.settle.callable,
                lifecycleAuthorities.settle.receiver,
                [operation, null, error],
            ),

        );

        return getVgpuOperationPromise(operation);

    }



    _completeBridgeTiming(operation, rawResults) {

        const lifecycleAuthorities = getVgpuOperationLifecycleAuthorities(operation);

        const isCurrent = () => Boolean(lifecycleAuthorities?.isCurrent) && Reflect.apply(
            lifecycleAuthorities.isCurrent.callable,
            lifecycleAuthorities.isCurrent.receiver,
            [operation],
        );

        const settle = (value, error) => lifecycleAuthorities?.settle
            ? Reflect.apply(
                lifecycleAuthorities.settle.callable,
                lifecycleAuthorities.settle.receiver,
                [operation, value, error],
            )
            : false;

        if (!isCurrent()) {

            settle(false, null);

            return false;

        }

        const generation = getVgpuOperationIdentity(operation, 'generation');

        const engineProfiler = getVgpuOperationIdentity(operation, 'engineProfiler');

        const profiler = getVgpuOperationPrivateValue(operation, 'profiler');

        try {

            const results = snapshotCoreManagerOptions(this, generation, rawResults || {});

            let totalGpu = 0;

            for (const [name, ms] of Object.entries(results)) {

                const normalizedMs = normalizeCoreManagerValue(this, generation, () => Number(ms));

                totalGpu += normalizedMs;

                const passTimings = getVgpuOperationPrivateValue(operation, 'passTimings');

                if (passTimings) {

                    const set = getVgpuOperationPrivateValue(operation, 'passTimingSet');

                    if (typeof set !== 'function') throw new TypeError('[vGPU] Profiler pass timings are unavailable');

                    if (!isCurrent()) throw coreManagerLifecycleError(this);

                    Reflect.apply(set, passTimings, [name, normalizedMs]);

                    if (!isCurrent()) throw coreManagerLifecycleError(this);

                }

            }

            if (Reflect.ownKeys(results).length > 0) {

                const metrics = getVgpuOperationPrivateValue(operation, 'metrics');

                if (!isCurrent()) throw coreManagerLifecycleError(this);

                metrics.gpuTime = totalGpu;

                if (!isCurrent()) throw coreManagerLifecycleError(this);

            }

            return settle(true, null);

        } catch (error) {

            return settle(null, error);

        }

    }



    _isBridgeOperationCurrent(operation) {

        const generation = getVgpuOperationIdentity(operation, 'generation');

        const engineProfiler = getVgpuOperationIdentity(operation, 'engineProfiler');

        const profiler = getVgpuOperationPrivateValue(operation, 'profiler');

        return Boolean(operation)

            && !isVgpuOperationSettled(operation)

            && hasVgpuPrivateSetEntry(this, '_operations', operation)

            && this._isBridgeCurrent(generation, engineProfiler, profiler);

    }



    _assertBridgeOperationCurrent(operation) {

        if (!this._isBridgeOperationCurrent(operation)) throw coreManagerLifecycleError(this);

    }



    _settleBridgeOperation(operation, value, error) {

        if (!claimVgpuOperationSettlement(operation)) return false;

        deleteVgpuPrivateSetEntry(this, '_operations', operation);

        invokeVgpuSettlementAuthority(operation, Boolean(error), error || value);

        return true;

    }



    _isBridgeCurrent(generation, engineProfiler, profiler = null) {

        return !this._destroyed

            && generation === this._generation

            && getCoreManagerPrivateValue(this, 'engineProfiler') === engineProfiler

            && this.vgpu

            && !this.vgpu._destroyed

            && this.vgpu.generation === this._parentGeneration

            && (!profiler || this.vgpu.profiler === profiler);

    }



    _assertBridgeCurrent(generation, engineProfiler, profiler = null) {

        if (!this._isBridgeCurrent(generation, engineProfiler, profiler)) {

            throw coreManagerLifecycleError(this);

        }

    }



    destroy() {

        const state = getCoreManagerLifecycleState(this);

        if (!state || state.destroyed) return false;

        const error = coreManagerLifecycleError(this);

        const records = snapshotVgpuPrivateSet(this, '_operations');

        const operations = [];

        for (let index = 0; index < records.length; index++) {

            const operation = records[index];

            Reflect.apply(VGPU_ARRAY_PUSH, operations, [Object.freeze({

                operation,

                settle: getVgpuOperationLifecycleAuthorities(operation)?.settle || null,

            })]);

        }

        if (!terminateCoreManagerLifecycle(this)) return false;

        setCoreManagerDestroyError(this, error);

        clearVgpuPrivateSet(this, '_operations');

        setCoreManagerPrivateValue(this, 'engineProfiler', null);

        for (const entry of operations) {

            if (entry.settle) Reflect.apply(

                entry.settle.callable, entry.settle.receiver,

                [entry.operation, null, error],

            );

        }

        severCoreManagerProperties(this, ['_engineProfiler', 'vgpu']);

        return true;

    }

}



// ============================================================================

// RENDER BUNDLE MANAGER - Pre-recorded render commands

// ============================================================================



class VGPURenderBundleManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'render-bundles');

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this._bundles = new Map(); // name -> { bundle, config, isDirty }

    }



    /**

     * Create a render bundle encoder

     */

    createEncoder(options = {}) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const device = this.device;

        const createRenderBundleEncoder = captureCoreManagerCallable(

            this, generation, device, 'createRenderBundleEncoder', 'render-bundle encoder creation',

        );

        const values = snapshotCoreManagerObject(this, generation, options, [

            'colorFormats', 'depthStencilFormat', 'sampleCount', 'label',

        ]);

        const rawFormats = values.colorFormats ?? ['bgra8unorm'];

        const colorFormats = snapshotCoreManagerValues(this, generation, rawFormats).map(format => (

            normalizeCoreManagerValue(this, generation, () => String(format))

        ));

        const depthStencilFormat = values.depthStencilFormat == null

            ? 'depth24plus'

            : normalizeCoreManagerValue(this, generation, () => String(values.depthStencilFormat));

        const sampleCount = values.sampleCount == null

            ? 1

            : normalizeCoreManagerValue(this, generation, () => Number(values.sampleCount));

        const label = values.label == null

            ? 'vgpu_bundle'

            : normalizeCoreManagerValue(this, generation, () => String(values.label));

        let encoder = null;

        try {

            encoder = invokeCoreManagerCallable(this, generation, createRenderBundleEncoder, [{

                label, colorFormats, depthStencilFormat, sampleCount,

            }], candidate => safeCoreCleanup(candidate));

            return encoder;

        } catch (error) {

            if (encoder) safeCoreCleanup(encoder);

            throw error;

        }

    }



    /**

     * Register a named bundle

     */

    register(name, bundle, config = {}) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(name));

        const snapshot = snapshotCoreManagerOptions(this, generation, config);

        this._bundles.set(normalizedName, { bundle, config: snapshot, isDirty: false });

        return bundle;

    }



    /**

     * Get a registered bundle

     */

    get(name) {

        assertCoreManagerAlive(this);

        return this._bundles.get(name)?.bundle;

    }



    /**

     * Mark a bundle as dirty (needs rebuild)

     */

    markDirty(name) {

        assertCoreManagerAlive(this);

        const entry = this._bundles.get(name);

        if (entry) entry.isDirty = true;

    }



    /**

     * Check if bundle needs rebuild

     */

    isDirty(name) {

        assertCoreManagerAlive(this);

        return this._bundles.get(name)?.isDirty ?? true;

    }



    /**

     * Remove a bundle

     */

    remove(name) {

        assertCoreManagerAlive(this);

        this._bundles.delete(name);

    }



    /**

     * Clear all bundles

     */

    clear() {

        assertCoreManagerAlive(this);

        this._bundles.clear();

    }



    getStats() {

        assertCoreManagerAlive(this);

        return {

            bundles: this._bundles.size,

            dirty: Array.from(this._bundles.values()).filter(b => b.isDirty).length,

        };

    }



    destroy() {

        if (!terminateCoreManagerLifecycle(this)) return false;

        this._bundles.clear();

        this.device = null;

        this.vgpu = null;

        return true;

    }

}



// ============================================================================

// DEBUG MANAGER - Debug markers and validation

// ============================================================================



class VGPUDebugManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'debug');

        this.vgpu = vgpu;

        this.enabled = true;

        this._groupStack = [];

        this._leakTracking = false;

        this._allocations = new Map(); // id -> { type, label, stack, time }

        this._nextAllocId = 1;

    }



    /**

     * Push a debug group for GPU debuggers (RenderDoc, PIX)

     */

    pushGroup(encoder, label) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        if (!this.enabled) return false;

        const pushDebugGroup = captureCoreManagerCallable(

            this, generation, encoder, 'pushDebugGroup', 'debug group push',

        );

        const normalizedLabel = normalizeCoreManagerValue(this, generation, () => String(label));

        invokeCoreManagerCallable(this, generation, pushDebugGroup, [normalizedLabel]);

        this._groupStack.push(normalizedLabel);

        return true;

    }



    /**

     * Pop a debug group

     */

    popGroup(encoder) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        if (!this.enabled || this._groupStack.length === 0) return false;

        const popDebugGroup = readCoreManagerValue(this, generation, encoder, 'popDebugGroup');

        if (typeof popDebugGroup !== 'function') return false;

        assertCoreManagerAlive(this, generation);

        popDebugGroup.call(encoder);

        assertCoreManagerAlive(this, generation);

        this._groupStack.pop();

        return true;

    }



    /**

     * Insert a debug marker

     */

    insertMarker(encoder, label) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        if (!this.enabled) return false;

        const insertDebugMarker = captureCoreManagerCallable(

            this, generation, encoder, 'insertDebugMarker', 'debug marker insertion',

        );

        const normalizedLabel = normalizeCoreManagerValue(this, generation, () => String(label));

        invokeCoreManagerCallable(this, generation, insertDebugMarker, [normalizedLabel]);

        return true;

    }



    /**

     * Enable resource leak tracking (performance cost)

     */

    enableLeakTracking(enabled = true) {

        assertCoreManagerAlive(this);

        this._leakTracking = enabled;

        if (!enabled) this._allocations.clear();

    }



    /**

     * Track an allocation (internal use)

     */

    trackAlloc(type, label, resource) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        if (!this._leakTracking) return 0;

        const normalizedType = normalizeCoreManagerValue(this, generation, () => String(type));

        const normalizedLabel = normalizeCoreManagerValue(this, generation, () => String(label));

        const time = normalizeCoreManagerValue(this, generation, () => performance.now());

        const stack = normalizeCoreManagerValue(this, generation, () => new Error().stack);

        assertCoreManagerAlive(this, generation);

        const id = this._nextAllocId++;

        this._allocations.set(id, {

            type: normalizedType, label: normalizedLabel, resource,

            time,

            stack,

        });

        return id;

    }



    /**

     * Untrack an allocation (internal use)

     */

    untrackAlloc(id) {

        assertCoreManagerAlive(this);

        if (!this._leakTracking) return;

        this._allocations.delete(id);

    }



    /**

     * Get current leaks

     */

    getLeaks() {

        assertCoreManagerAlive(this);

        return Array.from(this._allocations.values());

    }



    /**

     * Log leaks to console

     */

    logLeaks() {

        assertCoreManagerAlive(this);

        const leaks = this.getLeaks();

        if (leaks.length === 0) {

            console.log('[vGPU] No resource leaks detected');

            return;

        }

        console.group(`[vGPU] ${leaks.length} potential resource leaks`);

        for (const leak of leaks) {

            console.warn(`${leak.type}: ${leak.label} (allocated ${((performance.now() - leak.time) / 1000).toFixed(1)}s ago)`);

        }

        console.groupEnd();

    }



    destroy() {

        if (!terminateCoreManagerLifecycle(this)) return false;

        this._groupStack.length = 0;

        this._allocations.clear();

        this._leakTracking = false;

        this.enabled = false;

        this.vgpu = null;

        return true;

    }

}



// ============================================================================

// RING BUFFER MANAGER - Per-frame uniform uploads

// ============================================================================



class VGPURingFacade {

    constructor(manager, record, generation) {

        const state = {
            destroyed: false,
            destroyError: null,
            generation,
            manager,
            record,
        };

        Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_RING_FACADE_STATES, [this, state]);

        Object.defineProperties(this, {
            _destroyed: { get: () => state.destroyed, set: () => {} },
            _destroyError: { get: () => state.destroyError, set: () => {} },
            _generation: { get: () => state.generation, set: () => {} },
            _manager: { get: () => state.manager, set: () => {} },
            _record: { get: () => state.record, set: () => {} },
        });

    }

    _read(key) {

        return this._requireManager()._readRingFacade(this, key);

    }

    _requireManager() {

        if (!this._manager || this._destroyed) {

            throw this._destroyError || generationInvalidatedError(-1, 'ring-destroyed');

        }

        return this._manager;

    }

    get device() { return this._manager?._ringDevice(this) ?? null; }

    get buffer() { return this._read('buffer'); }

    get name() { return this._read('name'); }

    get size() { return this._read('size'); }

    get usage() { return this._read('usage'); }

    get writePtr() { return this._read('writePtr'); }

    get frameOffsets() { return this._read('frameOffsets'); }

    get currentFrame() { return this._read('currentFrame'); }

    get totalAllocated() { return this._read('totalAllocated'); }

    get frameAllocations() { return this._read('frameAllocations'); }

    get wrapCount() { return this._read('wrapCount'); }

    get peakUsage() { return this._read('peakUsage'); }

    beginFrame() { return this._requireManager()._callRingFacade(this, 'beginFrame', []); }

    alloc(bytes, alignment = 256) {

        return this._requireManager()._allocRingFacade(this, bytes, alignment);

    }

    write(data, alignment = 256) {

        return this._requireManager()._writeRingFacade(this, data, alignment);

    }

    getBuffer() { return this.buffer; }

    getStats() { return this._requireManager()._callRingFacade(this, 'getStats', []); }

    destroy() {

        if (this._destroyed) return false;

        const manager = this._manager;

        if (!manager) {

            const state = Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_RING_FACADE_STATES, [this]);

            if (state) state.destroyed = true;

            return false;

        }

        return manager._destroyRingFacade(this);

    }

    _revoke() {

        const state = Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_RING_FACADE_STATES, [this]);

        if (!state || state.destroyed) return false;

        state.destroyed = true;

        state.destroyError = coreManagerLifecycleError(state.manager || {

            _parentGeneration: -1,

            _managerLabel: 'ring',

        });

        state.generation++;

        state.record = null;

        state.manager = null;

        return true;

    }

}



class VGPURingManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'ring');

        this.vgpu = vgpu;

        this.device = vgpu.device;

        this._rings = new VGPU_NATIVE_MAP(); // name -> { raw, cleanup, facade }

        installVgpuPrivateContainer(
            this,
            '_rings',
            new VGPU_NATIVE_MAP(),
            record => Object.freeze({
                facade: record.facade,
                name: record.name,
                raw: record.raw,
            }),
        );

        this._defaultRing = null;

        setCoreManagerPrivateValue(this, 'defaultRing', null);

    }



    /**

     * Get or create a named ring buffer

     */

    get(name = 'default', sizeBytes = 4 * 1024 * 1024, createAuthority = null) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const device = this.device;

        const createBuffer = createAuthority || captureCoreManagerCallable(

            this, generation, device, 'createBuffer', 'ring GPU buffer creation',

        );

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(name));

        const normalizedSize = normalizeCoreManagerValue(this, generation, () => Number(sizeBytes));

        if (hasVgpuPrivateMapEntry(this, '_rings', normalizedName)) {

            return getVgpuPrivateMapEntry(this, '_rings', normalizedName).facade;

        }

        let raw = null;

        let cleanup = null;

        let stagedBufferCleanup = null;

        try {

            const guardedDevice = normalizeCoreManagerValue(this, generation, () => Object.create(device));

            Object.defineProperty(guardedDevice, 'createBuffer', {

                configurable: true,

                value: descriptor => {

                    const buffer = invokeCoreManagerCallable(

                        this,

                        generation,

                        createBuffer,

                        [descriptor],

                        resource => safeCoreCleanup(resource),

                    );

                    stagedBufferCleanup = captureCoreCleanup(buffer);

                    assertCoreManagerAlive(this, generation);

                    return buffer;

                },

            });

            raw = new RingBuffer(guardedDevice, normalizedSize, null, normalizedName);

            assertCoreManagerAlive(this, generation);

            cleanup = stagedBufferCleanup || captureCoreCleanup(raw);

            assertCoreManagerAlive(this, generation);

            const record = { name: normalizedName, raw, cleanup, facade: null };

            const facade = new VGPURingFacade(this, record, generation);

            record.facade = facade;

            Object.freeze(record);

            setVgpuPrivateMapEntry(this, '_rings', normalizedName, record);

            if (normalizedName === 'default') {
                setCoreManagerPrivateValue(this, 'defaultRing', record);
                try { this._defaultRing = record; } catch (_) {}
            }

            return facade;

        } catch (error) {

            safeCoreCleanup(cleanup || raw || stagedBufferCleanup);

            throw error;

        }

    }



    /**

     * Allocate from the default ring buffer

     * @returns {{ buffer: GPUBuffer, offset: number }}

     */

    alloc(sizeBytes, alignment = 256) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        let record = getCoreManagerPrivateValue(this, 'defaultRing');

        const authorities = record

            ? captureCoreManagerCallableSet(this, generation, [{

                name: 'alloc', receiver: record.raw, key: 'alloc', operation: 'ring allocation',

            }])

            : captureCoreManagerCallableSet(this, generation, [

                {

                    name: 'createBuffer', receiver: this.device, key: 'createBuffer',

                    operation: 'ring GPU buffer creation',

                },

                {

                    name: 'allocPrototype', receiver: RingBuffer.prototype, key: 'alloc',

                    operation: 'ring allocation',

                },

            ]);

        const size = normalizeCoreManagerValue(this, generation, () => Number(sizeBytes));

        const normalizedAlignment = normalizeCoreManagerValue(this, generation, () => Number(alignment));

        if (!record) {

            this.get('default', 4 * 1024 * 1024, authorities.createBuffer);

            record = getCoreManagerPrivateValue(this, 'defaultRing');

        }

        if (getCoreManagerPrivateValue(this, 'defaultRing') !== record) {
            throw coreManagerLifecycleError(this);
        }

        const alloc = authorities.alloc || Object.freeze({

            receiver: record.raw,

            callable: authorities.allocPrototype.callable,

        });

        return this._allocRingFacade(

            record.facade, size, normalizedAlignment, alloc,

        );

    }



    /**

     * Write data to the default ring buffer

     * @returns {{ buffer: GPUBuffer, offset: number }}

     */

    write(data, alignment = 256) {

        const generation = this._generation;

        const parent = assertCoreManagerAlive(this, generation);

        const queue = readCoreManagerValue(this, generation, parent, 'queue');

        let record = getCoreManagerPrivateValue(this, 'defaultRing');

        const specifications = [{

            name: 'writeBuffer', receiver: queue, key: 'writeBuffer', operation: 'ring buffer write',

        }];

        if (record) specifications.push({

            name: 'alloc', receiver: record.raw, key: 'alloc', operation: 'ring allocation',

        });

        else specifications.push(

            {

                name: 'createBuffer', receiver: this.device, key: 'createBuffer',

                operation: 'ring GPU buffer creation',

            },

            {

                name: 'allocPrototype', receiver: RingBuffer.prototype, key: 'alloc',

                operation: 'ring allocation',

            },

        );

        const authorities = captureCoreManagerCallableSet(

            this, generation, specifications,

        );

        const bytes = snapshotCoreManagerBytes(this, generation, data);

        const normalizedAlignment = normalizeCoreManagerValue(this, generation, () => Number(alignment));

        if (!record) {

            this.get('default', 4 * 1024 * 1024, authorities.createBuffer);

            record = getCoreManagerPrivateValue(this, 'defaultRing');

        }

        if (getCoreManagerPrivateValue(this, 'defaultRing') !== record) {
            throw coreManagerLifecycleError(this);
        }

        const alloc = authorities.alloc || Object.freeze({

            receiver: record.raw,

            callable: authorities.allocPrototype.callable,

        });

        return this._writeRingFacade(

            record.facade,

            bytes,

            normalizedAlignment,

            Object.freeze({ alloc, writeBuffer: authorities.writeBuffer }),

        );

    }



    /**

     * Begin a new frame (call at frame start)

     */

    beginFrame() {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const records = snapshotVgpuPrivateMapValues(this, '_rings');

        const authorities = captureCoreManagerCallableSet(

            this,

            generation,

            records.map((record, index) => ({

                name: `ring${index}`,

                receiver: record.raw,

                key: 'beginFrame',

                operation: 'ring frame advance',

            })),

        );

        for (let index = 0; index < records.length; index++) {

            const record = records[index];

            this._callRingFacade(

                record.facade, 'beginFrame', [], authorities[`ring${index}`],

            );

        }

    }



    getStats() {

        assertCoreManagerAlive(this);

        const stats = {};

        for (const [name, record] of snapshotVgpuPrivateMapEntries(this, '_rings')) {

            const ring = record.raw;

            stats[name] = {

                size: ring.size,

                used: ring.writePtr,

                utilization: (ring.writePtr / ring.size * 100).toFixed(1) + '%',

            };

        }

        return stats;

    }



    _ringRecord(facade) {

        const generation = facade?._generation;

        assertCoreManagerAlive(this, generation);

        const record = facade?._record;

        if (

            facade?._destroyed

            || !record

            || record.facade !== facade

            || getVgpuPrivateMapEntry(this, '_rings', record.name) !== record

        ) throw coreManagerLifecycleError(this);

        return record;

    }



    _ringDevice(facade) {

        this._ringRecord(facade);

        return this.device;

    }



    _readRingFacade(facade, key) {

        const record = this._ringRecord(facade);

        const value = record.raw[key];

        this._ringRecord(facade);

        return value;

    }



    _callRingFacade(facade, methodName, args, captured = null) {

        const generation = facade?._generation;

        const record = this._ringRecord(facade);

        const authority = captured || captureCoreManagerCallable(

            this, generation, record.raw, methodName, `ring ${methodName}`,

        );

        const result = invokeCoreManagerCallable(this, generation, authority, args);

        this._ringRecord(facade);

        return result;

    }



    _allocRingFacade(facade, bytes, alignment = 256, allocAuthority = null) {

        const generation = facade?._generation;

        const record = this._ringRecord(facade);

        const alloc = allocAuthority || captureCoreManagerCallable(

            this, generation, record.raw, 'alloc', 'ring allocation',

        );

        const normalizedBytes = normalizeCoreManagerValue(this, generation, () => Number(bytes));

        const normalizedAlignment = normalizeCoreManagerValue(this, generation, () => Number(alignment));

        const allocation = invokeCoreManagerCallable(

            this, generation, alloc, [normalizedBytes, normalizedAlignment],

        );

        this._ringRecord(facade);

        return allocation;

    }



    _writeRingFacade(facade, data, alignment = 256, capturedAuthorities = null) {

        const generation = facade?._generation;

        const parent = assertCoreManagerAlive(this, generation);

        const record = this._ringRecord(facade);

        const queue = readCoreManagerValue(this, generation, parent, 'queue');

        const authorities = capturedAuthorities || captureCoreManagerCallableSet(this, generation, [

            { name: 'alloc', receiver: record.raw, key: 'alloc', operation: 'ring allocation' },

            { name: 'writeBuffer', receiver: queue, key: 'writeBuffer', operation: 'ring buffer write' },

        ]);

        const bytes = snapshotCoreManagerBytes(this, generation, data);

        const normalizedAlignment = normalizeCoreManagerValue(this, generation, () => Number(alignment));

        const allocation = invokeCoreManagerCallable(

            this, generation, authorities.alloc, [bytes.byteLength, normalizedAlignment],

        );

        this._ringRecord(facade);

        if (!allocation) return null;

        this._ringRecord(facade);

        invokeCoreManagerCallable(

            this, generation, authorities.writeBuffer,

            [record.raw.buffer, allocation.offset, bytes.buffer, bytes.byteOffset, bytes.byteLength],

        );

        this._ringRecord(facade);

        return allocation;

    }



    _destroyRingFacade(facade) {

        const record = this._ringRecord(facade);

        const raw = record.raw;

        const cleanup = record.cleanup || captureCoreCleanup(raw);

        const revoke = captureVgpuCallable(facade, '_revoke');

        deleteVgpuPrivateMapEntry(this, '_rings', record.name);

        if (getCoreManagerPrivateValue(this, 'defaultRing') === record) {
            setCoreManagerPrivateValue(this, 'defaultRing', null);
            try { this._defaultRing = null; } catch (_) {}
        }

        safeInvokeCoreCallable(revoke, []);

        safeCoreCleanup(cleanup);

        return true;

    }



    destroy() {

        const state = getCoreManagerLifecycleState(this);

        if (!state || state.destroyed) return false;

        const records = snapshotVgpuPrivateMapValues(this, '_rings');

        const rings = [];

        for (let index = 0; index < records.length; index++) {

            const record = records[index];

            Reflect.apply(VGPU_ARRAY_PUSH, rings, [Object.freeze({

                record,

                raw: record.raw,

                cleanup: record.cleanup || captureCoreCleanup(record.raw),

                revoke: captureVgpuCallable(record.facade, '_revoke'),

            })]);

        }

        if (!terminateCoreManagerLifecycle(this)) return false;

        clearVgpuPrivateMap(this, '_rings');

        setCoreManagerPrivateValue(this, 'defaultRing', null);

        for (const entry of rings) {

            safeInvokeCoreCallable(entry.revoke, []);

            safeCoreCleanup(entry.cleanup);

        }

        severCoreManagerProperties(this, ['_defaultRing', 'device', 'vgpu']);

        return true;

    }

}



// ============================================================================

// PROFILER MANAGER - GPU timestamp profiling

// ============================================================================



class VGPUProfilerManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'profiler');

        this.vgpu = vgpu;

        this._profiler = new GPUTimestampProfiler(vgpu.device, {
            generation: vgpu.generation,
        });

        setCoreManagerPrivateValue(this, 'profiler', this._profiler);

        this._profilerCleanup = captureCoreCleanup(this._profiler);

        setCoreManagerPrivateValue(this, 'profilerCleanup', this._profilerCleanup);

        this._publicOperations = new Set();

        installVgpuPrivateContainer(this, '_publicOperations', new VGPU_NATIVE_SET());

        this._initialized = true;

        setCoreManagerPrivateValue(this, 'initialized', true);

    }



    /**

     * Initialize the profiler (call after device is ready)

     */

    init() {

        try {
            assertCoreManagerAlive(this);
            if (getCoreManagerPrivateValue(this, 'initialized')) {

                return resolveVgpuPromise(this.isAvailable());

            }
            return rejectVgpuPromise(new Error('[vGPU] GPU profiler cannot be reinitialized'));
        } catch (error) {
            return rejectVgpuPromise(error);
        }

    }



    /**

     * Enable/disable profiling

     */

    setEnabled(enabled) {

        const generation = this._generation;

        const setEnabled = this._captureProfiler('setEnabled', generation);

        return this._invokeProfiler(setEnabled, [Boolean(enabled)], generation);

    }

    beginFrame(metadata = {}) {

        const generation = this._generation;

        const beginFrame = this._captureProfiler('beginFrame', generation);

        const parent = assertCoreManagerAlive(this, generation);

        const snapshot = Object.freeze({

            ...snapshotCoreManagerOptions(this, generation, metadata),

            generation: parent.generation,

        });

        return this._invokeProfiler(beginFrame, [snapshot], generation);

    }

    markSubmitted(metadata = {}) {

        const generation = this._generation;

        const markSubmitted = this._captureProfiler('markSubmitted', generation);

        const parent = assertCoreManagerAlive(this, generation);

        const queue = readCoreManagerValue(this, generation, parent, 'queue');

        const queueAuthorities = captureCoreManagerCallableSet(this, generation, [

            {
                name: 'onSubmittedWorkDone',
                receiver: queue,
                key: 'onSubmittedWorkDone',
                operation: 'queue drain telemetry',
                optional: true,
            },

        ]);

        const snapshot = snapshotCoreManagerOptions(this, generation, metadata);

        return this._invokeProfiler(
            markSubmitted, [queue, snapshot, queueAuthorities.onSubmittedWorkDone], generation,
        );

    }



    /**

     * Begin timing a pass

     */

    beginPass(name, encoder) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const beginPass = this._captureProfiler('beginPass', generation);

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(name));

        return this._invokeProfiler(beginPass, [encoder, normalizedName], generation);

    }



    /**

     * End timing a pass

     */

    endPass(name, encoder) {

        assertCoreManagerAlive(this);

        // Pass-end timestamps are emitted automatically by timestampWrites.
        return this.isAvailable() && !!name && !!encoder;

    }



    isAvailable() {

        const generation = this._generation;

        return this._callProfiler('isAvailable', [], generation, true) || false;

    }



    getTimestampWrites(name) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const getTimestampWrites = this._captureProfiler(

            'getTimestampWrites', generation, true,

        );

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(name));

        return this._invokeProfiler(getTimestampWrites, [normalizedName], generation);

    }



    addToPassDescriptor(name, descriptor) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        if (!descriptor) return descriptor;

        const authorities = this._captureProfilerSet(generation, [

            { name: 'isAvailable', key: 'isAvailable', optional: true },

            { name: 'addToPassDescriptor', key: 'addToPassDescriptor', optional: true },

        ]);

        if (!this._invokeProfiler(authorities.isAvailable, [], generation)) return descriptor;

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(name));

        return this._invokeProfiler(

            authorities.addToPassDescriptor, [normalizedName, descriptor], generation,

        ) || descriptor;

    }



    /**

     * Resolve timing results (call at frame end)

     */

    resolve(encoder) {

        const generation = this._generation;

        const operationAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'start', receiver: this, key: '_startProfilerOperation', operation: 'profiler operation start' },

            { name: 'isCurrent', receiver: this, key: '_isProfilerOperationCurrent', operation: 'profiler operation lifecycle check' },

            { name: 'settle', receiver: this, key: '_settleProfilerOperation', operation: 'profiler operation settlement' },

        ]);

        const resolveAndRead = this._captureProfiler('resolveAndRead', generation);

        const parent = assertCoreManagerAlive(this, generation);

        if (getCoreManagerPrivateValue(this, 'initialized')) {

            return Reflect.apply(operationAuthorities.start.callable, operationAuthorities.start.receiver, [

                'resolveAndRead', [encoder, {

                    generation: parent.generation,

                }], generation, false, false, resolveAndRead, operationAuthorities,

            ]);

        }

        return false;

    }



    readResults() {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        if (getCoreManagerPrivateValue(this, 'initialized')) {

            const operationAuthorities = captureCoreManagerCallableSet(this, generation, [

                { name: 'start', receiver: this, key: '_startProfilerOperation', operation: 'profiler operation start' },

                { name: 'isCurrent', receiver: this, key: '_isProfilerOperationCurrent', operation: 'profiler operation lifecycle check' },

                { name: 'settle', receiver: this, key: '_settleProfilerOperation', operation: 'profiler operation settlement' },

            ]);

            const readResults = this._captureProfiler('readResults', generation);

            return Reflect.apply(operationAuthorities.start.callable, operationAuthorities.start.receiver, [

                'readResults', [], generation, false, null, readResults, operationAuthorities,

            ]);

        }

        return resolveVgpuPromise(null);

    }



    /**

     * Get timing results

     */

    getResults() {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        if (!getCoreManagerPrivateValue(this, 'initialized')) return {};

        const operationAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'start', receiver: this, key: '_startProfilerOperation', operation: 'profiler operation start' },

            { name: 'isCurrent', receiver: this, key: '_isProfilerOperationCurrent', operation: 'profiler operation lifecycle check' },

            { name: 'settle', receiver: this, key: '_settleProfilerOperation', operation: 'profiler operation settlement' },

        ]);

        const getStats = this._captureProfiler('getStats', generation, true);

        return Reflect.apply(operationAuthorities.start.callable, operationAuthorities.start.receiver, [

            'getStats', [], generation, true, {}, getStats, operationAuthorities,

        ]);

    }



    /**

     * Get formatted timing string

     */

    getTimingString() {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const operationAuthorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'start', receiver: this, key: '_startProfilerOperation', operation: 'profiler operation start' },

            { name: 'isCurrent', receiver: this, key: '_isProfilerOperationCurrent', operation: 'profiler operation lifecycle check' },

            { name: 'settle', receiver: this, key: '_settleProfilerOperation', operation: 'profiler operation settlement' },

        ]);

        const getStatsString = this._captureProfiler('getStatsString', generation, true);

        return Reflect.apply(operationAuthorities.start.callable, operationAuthorities.start.receiver, [

            'getStatsString', [], generation, true, '', getStatsString, operationAuthorities,

        ]);

    }



    _startProfilerOperation(

        methodName, args, generation, optional = false, fallback = undefined, captured = null,

        lifecycleAuthorities = null,

    ) {

        lifecycleAuthorities = lifecycleAuthorities

            ? Object.freeze({

                isProfilerOperationCurrent: lifecycleAuthorities.isCurrent,

                settleProfilerOperation: lifecycleAuthorities.settle,

            })

            : captureCoreManagerCallableSet(this, generation, [

            {
                name: 'isProfilerOperationCurrent',
                receiver: this,
                key: '_isProfilerOperationCurrent',
                operation: 'profiler operation lifecycle check',
            },

            {
                name: 'settleProfilerOperation',
                receiver: this,
                key: '_settleProfilerOperation',
                operation: 'profiler operation settlement',
            },

            ]);

        let resolvePublic;

        let rejectPublic;

        const operation = {

            generation,

            settled: false,

            promise: null,

            lifecycleAuthorities,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        addVgpuPrivateSetEntry(this, '_publicOperations', operation);

        let backend;

        try {

            backend = captured

                ? this._invokeProfiler(captured, args, generation)

                : this._callProfiler(methodName, args, generation, optional);

            if (backend === undefined && optional) backend = fallback;

        } catch (error) {

            Reflect.apply(

                lifecycleAuthorities.settleProfilerOperation.callable,

                lifecycleAuthorities.settleProfilerOperation.receiver,

                [operation, null, error],

            );

            return getVgpuOperationPromise(operation);

        }

        void thenVgpuPromise(resolveVgpuPromise(backend),

            value => {

                if (Reflect.apply(

                    lifecycleAuthorities.isProfilerOperationCurrent.callable,

                    lifecycleAuthorities.isProfilerOperationCurrent.receiver,

                    [operation],

                )) {

                    Reflect.apply(

                        lifecycleAuthorities.settleProfilerOperation.callable,

                        lifecycleAuthorities.settleProfilerOperation.receiver,

                        [operation, value, null],

                    );

                }

            },

            error => Reflect.apply(

                lifecycleAuthorities.settleProfilerOperation.callable,

                lifecycleAuthorities.settleProfilerOperation.receiver,

                [operation, null, error],

            ),

        );

        return getVgpuOperationPromise(operation);

    }



    _isProfilerOperationCurrent(operation) {

        if (
            !operation
            || isVgpuOperationSettled(operation)
            || !hasVgpuPrivateSetEntry(this, '_publicOperations', operation)
        ) return false;

        try {
            assertCoreManagerAlive(this, getVgpuOperationIdentity(operation, 'generation'));
        } catch (_) { return false; }

        return true;

    }



    _settleProfilerOperation(operation, value, error) {

        if (!claimVgpuOperationSettlement(operation)) return false;

        deleteVgpuPrivateSetEntry(this, '_publicOperations', operation);

        invokeVgpuSettlementAuthority(operation, Boolean(error), error || value);

        return true;

    }



    _callProfiler(methodName, args, generation, optional = false) {

        const captured = this._captureProfiler(methodName, generation, optional);

        return this._invokeProfiler(captured, args, generation);

    }



    _captureProfilerSet(generation, specifications) {

        assertCoreManagerAlive(this, generation);

        const profiler = getCoreManagerPrivateValue(this, 'profiler');

        return captureCoreManagerCallableSet(

            this,

            generation,

            specifications.map(specification => ({

                ...specification,

                receiver: profiler,

                operation: `profiler ${specification.key}`,

            })),

        );

    }



    _captureProfiler(methodName, generation, optional = false) {

        return this._captureProfilerSet(generation, [{

            name: methodName,

            key: methodName,

            optional,

        }])[methodName];

    }



    _invokeProfiler(captured, args, generation) {

        if (!captured) return undefined;

        return invokeCoreManagerCallable(this, generation, captured, args);

    }



    destroy() {

        const state = getCoreManagerLifecycleState(this);

        if (!state || state.destroyed) return false;

        const profiler = getCoreManagerPrivateValue(this, 'profiler');

        const profilerCleanup = getCoreManagerPrivateValue(this, 'profilerCleanup');

        const error = coreManagerLifecycleError(this);

        const records = snapshotVgpuPrivateSet(this, '_publicOperations');

        const operations = [];

        for (let index = 0; index < records.length; index++) {

            const operation = records[index];

            Reflect.apply(VGPU_ARRAY_PUSH, operations, [Object.freeze({

                operation,

                settle: getVgpuOperationLifecycleAuthorities(operation)?.settleProfilerOperation || null,

            })]);

        }

        if (!terminateCoreManagerLifecycle(this)) return false;

        setCoreManagerDestroyError(this, error);

        clearVgpuPrivateSet(this, '_publicOperations');

        setCoreManagerPrivateValue(this, 'profiler', null);

        setCoreManagerPrivateValue(this, 'profilerCleanup', null);

        setCoreManagerPrivateValue(this, 'initialized', false);

        for (const entry of operations) {

            if (entry.settle) Reflect.apply(

                entry.settle.callable, entry.settle.receiver,

                [entry.operation, null, error],

            );

        }

        safeCoreCleanup(profilerCleanup || profiler);

        severCoreManagerProperties(this, [

            '_profiler', '_profilerCleanup', '_initialized', 'vgpu',

        ]);

        return true;

    }

}



// ============================================================================

// SCHEDULER MANAGER - Async compute scheduling

// ============================================================================



class VGPUSchedulerManager {

    constructor(vgpu) {

        initializeCoreManagerLifecycle(this, vgpu, 'scheduler');

        this.vgpu = vgpu;

        this._scheduler = new AsyncComputeScheduler();

        setCoreManagerPrivateValue(this, 'scheduler', this._scheduler);

        this._schedulerCleanup = captureCoreCleanup(this._scheduler);

        setCoreManagerPrivateValue(this, 'schedulerCleanup', this._schedulerCleanup);

        this._initialized = false;

        setCoreManagerPrivateValue(this, 'initialized', false);

    }



    /**

     * Initialize the scheduler

     */

    init() {

        const generation = this._generation;

        const parent = assertCoreManagerAlive(this, generation);

        if (this._initialized) return true;

        const scheduler = this._scheduler;

        const device = readCoreManagerValue(this, generation, parent, 'device');

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'init', receiver: scheduler, key: 'init', operation: 'scheduler initialization' },

            { name: 'createBuffer', receiver: device, key: 'createBuffer', operation: 'scheduler buffer creation' },

        ]);

        if (!getCoreManagerPrivateValue(this, 'schedulerCleanup')) {

            setCoreManagerPrivateValue(this, 'schedulerCleanup', captureCoreCleanup(scheduler));

        }

        const staged = [];

        const guardedDevice = Object.create(device);

        Object.defineProperty(guardedDevice, 'createBuffer', {

            configurable: true,

            value: descriptor => {

                assertCoreManagerAlive(this, generation);

                const buffer = invokeCoreManagerCallable(

                    this,

                    generation,

                    authorities.createBuffer,

                    [descriptor],

                    candidate => safeCoreCleanup(captureCoreCleanup(candidate)),

                );

                const cleanup = captureCoreCleanup(buffer);

                Reflect.apply(VGPU_ARRAY_PUSH, staged, [Object.freeze({ buffer, cleanup })]);

                assertCoreManagerAlive(this, generation);

                return buffer;

            },

        });

        try {

            assertCoreManagerAlive(this, generation);

            Reflect.apply(authorities.init.callable, authorities.init.receiver, [guardedDevice]);

            assertCoreManagerAlive(this, generation);

            scheduler.device = device;

            assertCoreManagerAlive(this, generation);

            this._initialized = true;

            setCoreManagerPrivateValue(this, 'initialized', true);

            return true;

        } catch (error) {

            for (const entry of staged) safeCoreCleanup(entry.cleanup || entry.buffer);

            try { scheduler.readbackBuffers = []; } catch (_) {}

            try { scheduler.initialized = false; } catch (_) {}

            throw error;

        }

    }



    /**

     * Schedule a compute task

     */

    schedule(name, options) {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const scheduler = this._scheduler;

        const initialized = Boolean(this._initialized);

        const authorities = captureCoreManagerCallableSet(this, generation, [

            { name: 'scheduleTask', receiver: scheduler, key: 'scheduleTask', operation: 'scheduler task submission' },

            { name: 'initManager', receiver: this, key: 'init', operation: 'scheduler initialization' },

        ]);

        const normalizedName = normalizeCoreManagerValue(this, generation, () => String(name));

        const snapshotOptions = snapshotCoreManagerOptions(this, generation, options || {});

        const config = Object.freeze({ ...snapshotOptions, name: normalizedName });

        if (!initialized) Reflect.apply(

            authorities.initManager.callable, authorities.initManager.receiver, [],

        );

        assertCoreManagerAlive(this, generation);

        const result = invokeCoreManagerCallable(

            this, generation, authorities.scheduleTask, [config],

        );

        return result;

    }



    /**

     * Flush pending compute work

     */

    flush() {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        if (this._initialized) {

            const scheduler = this._scheduler;

            const clearAll = captureCoreManagerCallable(

                this, generation, scheduler, 'clearAll', 'scheduler pending-work clear',

            );

            invokeCoreManagerCallable(this, generation, clearAll, []);

            return true;

        }

        return false;

    }



    /**

     * Get scheduler stats

     */

    getStats() {

        const generation = this._generation;

        assertCoreManagerAlive(this, generation);

        const scheduler = this._scheduler;

        const authorities = captureCoreManagerCallableSet(this, generation, [{

            name: 'getStats',

            receiver: scheduler,

            key: 'getStats',

            operation: 'scheduler stats',

            optional: true,

        }]);

        if (!authorities.getStats) return {};

        const stats = invokeCoreManagerCallable(

            this, generation, authorities.getStats, [],

        ) || {};

        return stats;

    }



    destroy() {

        const state = getCoreManagerLifecycleState(this);

        if (!state || state.destroyed) return false;

        const scheduler = getCoreManagerPrivateValue(this, 'scheduler');

        const schedulerCleanup = getCoreManagerPrivateValue(this, 'schedulerCleanup');

        if (!terminateCoreManagerLifecycle(this)) return false;

        setCoreManagerPrivateValue(this, 'scheduler', null);

        setCoreManagerPrivateValue(this, 'schedulerCleanup', null);

        setCoreManagerPrivateValue(this, 'initialized', false);

        safeCoreCleanup(schedulerCleanup || scheduler);

        severCoreManagerProperties(this, [

            '_scheduler', '_schedulerCleanup', '_initialized', 'vgpu',

        ]);

        return true;

    }



}



// ============================================================================

// VIRTUAL GPU - Main Facade

// ============================================================================



export class VirtualGPU {

    constructor(gpuDevice, factoryConstructionToken = null) {

        const exactGpuDeviceInput = gpuDevice;

        gpuDevice = normalizeGpuDeviceInput(gpuDevice);

        const existingRecord = getVgpuRegistryRecord(gpuDevice.device);

        if (existingRecord?.active) return existingRecord.vgpu;

        if (existingRecord && !existingRecord.active) {

            throw generationInvalidatedError(existingRecord.generation, existingRecord.reason);

        }

        this.gpuDevice = gpuDevice;

        this.device = gpuDevice.device;

        this.queue = gpuDevice.queue || this.device.queue;

        this.adapter = gpuDevice.adapter || null;

        this.limits = gpuDevice.limits || this.device.limits || {};

        this.features = gpuDevice.features || this.device.features || new Set();

        this.capabilities = gpuDevice.capabilities || {

            limits: this.limits,

            features: this.features,

            defaultColorFormat: DEFAULT_COLOR_FORMAT,

            defaultDepthFormat: DEFAULT_DEPTH_FORMAT,

            defaultSampleCount: 1,

        };

        this.generation = Number.isSafeInteger(gpuDevice.generation)

            ? gpuDevice.generation

            : ++realmGeneration;

        initializeVgpuFacadeLifecycle(this);

        // Set only by VirtualGPU.create() after this exact instance finishes
        // construction. fromDevice(), injected wrappers, and registry reuse do
        // not transfer physical-device ownership into the VGPU graph.
        this._ownedGpuDevice = null;

        this._ownedFactoryResources = new Set();

        installVgpuPrivateContainer(this, '_ownedFactoryResources', new VGPU_NATIVE_SET());

        this._factoryOperations = new Map();

        installVgpuPrivateContainer(this, '_factoryOperations', new VGPU_NATIVE_MAP());

        this._factoryDescriptors = new VGPU_NATIVE_MAP();

        installVgpuPrivateContainer(this, '_factoryDescriptors', new VGPU_NATIVE_MAP());

        installVgpuPrivateContainer(this, '_factoryPublications', new VGPU_NATIVE_MAP());

        this._factoryChildReleases = new VGPU_NATIVE_WEAK_MAP();

        installVgpuPrivateContainer(
            this,
            '_factoryChildReleases',
            new VGPU_NATIVE_WEAK_MAP(),
            registration => Object.freeze({ slot: registration?.slot || null }),
        );

        const coreAuthorities = {
            managers: [],
            deviceLostCleanup: null,
            ownedDeviceCleanup: null,
            gpuDeviceIdentity: exactGpuDeviceInput,
            normalizedGpuDevice: gpuDevice,
            rawDevice: this.device,
            limits: this.limits,
            features: this.features,
            featureHas: captureVgpuCallable(this.features, 'has'),
            factoryConstructionToken,
        };

        const deviceLostAuthorities = captureVgpuCleanupCallableSet([{

            name: 'handleDeviceLost',

            lookupReceiver: VirtualGPU.prototype,

            receiver: this,

            key: '_handleDeviceLost',

        }]);

        Reflect.apply(VGPU_WEAK_MAP_SET, VGPU_CORE_AUTHORITIES, [this, coreAuthorities]);

        this._coreManagerCleanups = [];

        const constructionGeneration = this._factoryGeneration;

        const assertConstructing = () => {

            if (this._destroyed || this._factoryGeneration !== constructionGeneration) {

                throw generationInvalidatedError(this.generation, this._destroyReason || 'construction invalidated');

            }

        };

        const installManager = (name, candidate, methods = ['destroy', 'dispose']) => {

            const cleanup = captureCoreCleanup(candidate, methods);

            try { assertConstructing(); } catch (error) {

                safeCoreCleanup(cleanup || candidate);

                throw error;

            }

            try {

                const installed = Reflect.defineProperty(this, name, {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: candidate,
                });

                if (!installed) throw new TypeError(`[vGPU] Failed to install ${name} manager`);

            } catch (error) {

                safeCoreCleanup(cleanup || candidate);

                throw error;

            }

            try { assertConstructing(); } catch (error) {

                safeCoreCleanup(cleanup || candidate);

                try {
                    Reflect.defineProperty(this, name, {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: null,
                    });
                } catch (_) {}

                throw error;

            }

            if (cleanup) {
                coreAuthorities.managers[coreAuthorities.managers.length] = Object.freeze({
                    name,
                    cleanup,
                });
            }

            return candidate;

        };

        const constructorReuseSignal = Object.freeze({});

        let reentrantVGPU = null;

        try {



        // Core subsystem managers

        installManager('buffer', new VGPUBufferManager(this));

        installManager('bindings', new VGPUBindingManager(this));

        installManager('shader', new VGPUShaderManager(this));

        installManager('pipeline', new VGPUPipelineManager(this));

        installManager('texture', new VGPUTextureManager(this));

        installManager('command', new VGPUCommandManager(this));



        // Enhanced subsystems (A: Integration of existing utilities)

        installManager('debug', new VGPUDebugManager(this));

        installManager('ring', new VGPURingManager(this));

        installManager('profiler', new VGPUProfilerManager(this));

        installManager('scheduler', new VGPUSchedulerManager(this));

        installManager('bundles', new VGPURenderBundleManager(this));



        // Utilities

        installManager('mipmap', new VGPUMipmapGenerator(this));

        installManager('queries', new VGPUQueryPool(this));

        installManager('warmup', new VGPUPipelineWarmup(this));



        // Deep integrations

        installManager('frameGraph', new VGPUFrameGraphBridge(this));

        installManager('engineProfiler', new VGPUProfilerBridge(this));



        // New enhancement subsystems

        installManager('readback', new VGPUReadbackQueue(this));

        installManager('preprocessor', createPreprocessor(), ['destroy', 'clear']);

        installManager('computeUtils', new VGPUComputeUtils(this));

        installManager('memory', new VGPUMemoryTracker(this));

        this.reflection = getShaderReflection();

        installManager('materials', new VGPUBindGroupManager(this));

        installManager('barriers', new VGPUResourceBarriers(this));

        installManager('quality', new VGPUQualityScaler(this));

        installManager('renderStats', new VGPURenderStats(this));

        installManager('bindless', new VGPUBindless(this));

        installManager('multiQueue', new VGPUMultiQueue(this));

        installManager('semaphores', new VGPUTimelineSemaphores(this));



        // Advanced rendering modules (lazy-initialized via factory methods)

        this._renderGraph = null;

        this._indirectRenderer = null;

        this._hizCulling = null;

        this._streaming = null;

        this._debugDraw = null;



        // Device loss handling

        this._deviceLostHandler = info => Reflect.apply(

            deviceLostAuthorities.handleDeviceLost.callable,

            deviceLostAuthorities.handleDeviceLost.receiver,

            [info],

        );

        const onDeviceLostSlot = captureVgpuPropertySlot(gpuDevice, 'onDeviceLost');

        const removeDeviceLostHandlerSlot = captureVgpuPropertySlot(

            gpuDevice, 'removeDeviceLostHandler',

        );

        let onDeviceLost;

        try { onDeviceLost = readVgpuPropertySlot(onDeviceLostSlot); }

        finally { assertConstructing(); }

        let removeDeviceLostHandler;

        try { removeDeviceLostHandler = readVgpuPropertySlot(removeDeviceLostHandlerSlot); }

        finally { assertConstructing(); }

        const fallbackDeviceLostCleanup = typeof removeDeviceLostHandler === 'function'
            ? () => Reflect.apply(
                removeDeviceLostHandler, gpuDevice, [this._deviceLostHandler],
            )
            : null;

        this._removeDeviceLostHandler = fallbackDeviceLostCleanup;

        coreAuthorities.deviceLostCleanup = fallbackDeviceLostCleanup;

        let unsubscribe;

        if (typeof onDeviceLost === 'function') {

            assertConstructing();

            unsubscribe = Reflect.apply(onDeviceLost, gpuDevice, [this._deviceLostHandler]);

            try { assertConstructing(); } catch (error) {

                if (typeof unsubscribe === 'function') {
                    try { Reflect.apply(unsubscribe, gpuDevice, []); } catch (_) {}
                }

                throw error;

            }

        }

        this._removeDeviceLostHandler = typeof unsubscribe === 'function'

            ? () => Reflect.apply(unsubscribe, gpuDevice, [])

            : fallbackDeviceLostCleanup;

        coreAuthorities.deviceLostCleanup = this._removeDeviceLostHandler;

        assertConstructing();

        const currentRecord = getVgpuRegistryRecord(this.device);

        if (currentRecord?.active) {

            reentrantVGPU = currentRecord.vgpu;

            throw constructorReuseSignal;

        }

        if (currentRecord) {

            throw generationInvalidatedError(currentRecord.generation, currentRecord.reason);

        }

        setVgpuFacadeRegistryRecord(this, registerVGPUInstance(this));

        } catch (error) {

            invalidateVgpuFacadeLifecycle(this, 'construction-failed');

            const cleanups = [];
            for (let index = coreAuthorities.managers.length - 1; index >= 0; index--) {
                cleanups[cleanups.length] = coreAuthorities.managers[index];
            }

            coreAuthorities.managers.length = 0;

            try { this._coreManagerCleanups = []; } catch (_) {}

            Reflect.apply(VGPU_WEAK_MAP_DELETE, VGPU_CORE_AUTHORITIES, [this]);

            coreAuthorities.factoryConstructionToken = null;

            coreAuthorities.gpuDeviceIdentity = null;

            coreAuthorities.normalizedGpuDevice = null;

            coreAuthorities.rawDevice = null;

            coreAuthorities.limits = null;

            coreAuthorities.features = null;

            coreAuthorities.featureHas = null;

            let removeDeviceLostHandler = null;

            try { removeDeviceLostHandler = coreAuthorities.deviceLostCleanup; } catch (_) {}

            this._removeDeviceLostHandler = null;

            if (typeof removeDeviceLostHandler === 'function') {

                try { Reflect.apply(removeDeviceLostHandler, null, []); } catch (_) {}

            }

            for (const entry of cleanups) safeCoreCleanup(entry.cleanup);

            const rawDevice = this.device;

            if (rawDevice && getVgpuRegistryRecord(rawDevice)?.vgpu === this) {
                deleteVgpuRegistryRecord(rawDevice);
            }

            try { this.gpuDevice = null; } catch (_) {}

            try { this.device = null; } catch (_) {}

            try { this.queue = null; } catch (_) {}

            try { this.adapter = null; } catch (_) {}

            if (error === constructorReuseSignal && reentrantVGPU) return reentrantVGPU;

            throw error;

        }

    }



    /**

     * Create a VirtualGPU instance

     */

    static create(options = {}) {

        const operationPromise = (async () => {

        const authorities = captureVgpuCallableSet([

            {
                name: 'createGpuDevice',
                receiver: GpuDevice,
                key: 'create',
                operation: 'GpuDevice creation',
            },

            {
                name: 'defineProperty',
                receiver: Reflect,
                key: 'defineProperty',
                operation: 'VirtualGPU factory publication',
            },

            {
                name: 'getOwnPropertyDescriptor',
                receiver: Reflect,
                key: 'getOwnPropertyDescriptor',
                operation: 'VirtualGPU factory identity inspection',
            },

            {
                name: 'log',
                receiver: console,
                key: 'log',
                operation: 'VirtualGPU factory logging',
                optional: true,
            },

        ]);

        const provenance = options?.[VGPU_CREATE_PROVENANCE] || null;

        const gpuDevice = await Reflect.apply(
            authorities.createGpuDevice.callable,
            authorities.createGpuDevice.receiver,
            [options],
        );

        const gpuDeviceCleanup = captureCoreCleanup(gpuDevice, ['destroy']);

        let gpuDeviceRetired = false;

        const retireGpuDevice = () => {

            if (gpuDeviceRetired) return false;

            gpuDeviceRetired = true;

            return safeCoreCleanup(gpuDeviceCleanup);

        };

        const ownedGpuDeviceCleanup = captureCoreCleanup(
            Object.freeze({ destroy: retireGpuDevice }), ['destroy'],
        );

        let inputSnapshot;

        let normalizedGpuDevice;

        try {

            inputSnapshot = snapshotGpuDeviceInput(gpuDevice);

            normalizedGpuDevice = normalizeGpuDeviceInput(gpuDevice, inputSnapshot);

        } catch (error) {

            safeCoreCleanup(ownedGpuDeviceCleanup);

            throw error;

        }

        const rawDevice = inputSnapshot.rawDevice;

        const publishProvenance = (
            candidate, adoptedByThisOperation, assertCurrent = null,
        ) => {

            if (!provenance) return;

            const candidatePublished = Reflect.apply(
                authorities.defineProperty.callable,
                authorities.defineProperty.receiver,
                [provenance, 'candidate', {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: candidate,
                }],
            );

            if (assertCurrent) assertCurrent();

            const adoptionPublished = Reflect.apply(
                authorities.defineProperty.callable,
                authorities.defineProperty.receiver,
                [provenance, 'adoptedByThisOperation', {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: adoptedByThisOperation,
                }],
            );

            if (assertCurrent) assertCurrent();

            if (!candidatePublished || !adoptionPublished) {

                throw new TypeError('[vGPU] Failed to publish factory provenance');

            }

        };

        const liveWrapperFor = record => {

            const registeredAuthorities = Reflect.apply(
                VGPU_WEAK_MAP_GET, VGPU_CORE_AUTHORITIES, [record.vgpu],
            );

            if (registeredAuthorities?.gpuDeviceIdentity) {

                return registeredAuthorities.gpuDeviceIdentity;

            }

            const descriptor = Reflect.apply(
                authorities.getOwnPropertyDescriptor.callable,
                authorities.getOwnPropertyDescriptor.receiver,
                [record.vgpu, 'gpuDevice'],
            );

            return descriptor && 'value' in descriptor ? descriptor.value : null;

        };

        const retireFactoryCollision = record => {
            const invalidate = record?.active
                ? captureVgpuCallable(record, 'invalidate')
                : null;
            if (invalidate) {
                try {
                    Reflect.apply(
                        invalidate.callable,
                        invalidate.receiver,
                        ['factory-device-collision'],
                    );
                } catch (_) {}
            }
            if (record && getVgpuRegistryRecord(rawDevice) === record) {
                deleteVgpuRegistryRecord(rawDevice);
            }
            safeCoreCleanup(ownedGpuDeviceCleanup);
            const replacementRecord = getVgpuRegistryRecord(rawDevice);
            if (replacementRecord?.active && replacementRecord !== record) {
                const invalidateReplacement = captureVgpuCallable(
                    replacementRecord, 'invalidate',
                );
                if (invalidateReplacement) {
                    try {
                        Reflect.apply(
                            invalidateReplacement.callable,
                            invalidateReplacement.receiver,
                            ['factory-device-collision-cleanup'],
                        );
                    } catch (_) {}
                }
            }
            const currentRecord = getVgpuRegistryRecord(rawDevice);
            if (currentRecord && currentRecord !== record) {
                deleteVgpuRegistryRecord(rawDevice);
            }
            throw factoryDeviceCollisionError(record);
        };

        // A registry hit represents an already-owned lifetime. Returning it
        // must not silently convert a borrowed/reused VGPU into the owner of a
        // wrapper merely because it was reached through this factory.
        const existingRecord = getVgpuRegistryRecord(rawDevice);

        if (existingRecord?.active) {

            if (liveWrapperFor(existingRecord) === gpuDevice) {

                const reusedAuthorities = Reflect.apply(
                    VGPU_WEAK_MAP_GET, VGPU_CORE_AUTHORITIES, [existingRecord.vgpu],
                );

                const assertReusedCurrent = () => {

                    if (!existingRecord.active
                        || getVgpuRegistryRecord(rawDevice) !== existingRecord
                        || Reflect.apply(
                            VGPU_WEAK_MAP_GET, VGPU_CORE_AUTHORITIES, [existingRecord.vgpu],
                        ) !== reusedAuthorities
                        || reusedAuthorities?.gpuDeviceIdentity !== gpuDevice) {

                        throw generationInvalidatedError(
                            existingRecord.generation,
                            existingRecord.reason || 'factory provenance invalidated reuse',
                        );

                    }

                };

                publishProvenance(existingRecord.vgpu, false, assertReusedCurrent);

                return existingRecord.vgpu;

            }

            return retireFactoryCollision(existingRecord);

        }

        let vgpu;

        const factoryConstructionToken = Object.freeze({});

        try {

            vgpu = new VirtualGPU(normalizedGpuDevice, factoryConstructionToken);

        } catch (error) {

            // Construction never published an owner for this exact wrapper.
            // Retire it here so failed initialization cannot leak a device.
            try { safeCoreCleanup(ownedGpuDeviceCleanup); } catch (cleanupError) {

                try {
                    console.warn('[vGPU] Failed to retire GpuDevice after initialization error:', cleanupError);
                } catch (_) {}

            }

            throw error;

        }

        const coreAuthorities = Reflect.apply(
            VGPU_WEAK_MAP_GET, VGPU_CORE_AUTHORITIES, [vgpu],
        );

        const constructedByThisOperation = Boolean(
            coreAuthorities?.factoryConstructionToken === factoryConstructionToken,
        );

        if (!constructedByThisOperation) {

            const reusedRecord = getVgpuRegistryRecord(rawDevice);

            if (reusedRecord?.active
                && reusedRecord.vgpu === vgpu
                && liveWrapperFor(reusedRecord) === gpuDevice) {

                const reusedAuthorities = Reflect.apply(
                    VGPU_WEAK_MAP_GET, VGPU_CORE_AUTHORITIES, [vgpu],
                );

                const assertReusedCurrent = () => {

                    if (!reusedRecord.active
                        || getVgpuRegistryRecord(rawDevice) !== reusedRecord
                        || Reflect.apply(
                            VGPU_WEAK_MAP_GET, VGPU_CORE_AUTHORITIES, [vgpu],
                        ) !== reusedAuthorities
                        || reusedAuthorities?.gpuDeviceIdentity !== gpuDevice) {

                        throw generationInvalidatedError(
                            reusedRecord.generation,
                            reusedRecord.reason || 'factory provenance invalidated reuse',
                        );

                    }

                };

                publishProvenance(vgpu, false, assertReusedCurrent);

                return vgpu;

            }

            return retireFactoryCollision(reusedRecord);

        }

        coreAuthorities.factoryConstructionToken = null;

        const candidateRecord = getVgpuRegistryRecord(rawDevice);

        if (!candidateRecord?.active || candidateRecord.vgpu !== vgpu) {

            safeCoreCleanup(ownedGpuDeviceCleanup);

            throw factoryDeviceCollisionError(candidateRecord);

        }

        const invalidateCandidate = captureVgpuCallable(candidateRecord, 'invalidate');

        const assertCandidateCurrent = () => {

            if (!candidateRecord.active
                || candidateRecord.vgpu !== vgpu
                || getVgpuRegistryRecord(rawDevice) !== candidateRecord
                || Reflect.apply(VGPU_WEAK_MAP_GET, VGPU_CORE_AUTHORITIES, [vgpu]) !== coreAuthorities
                || coreAuthorities.ownedDeviceCleanup !== ownedGpuDeviceCleanup
                || coreAuthorities.gpuDeviceIdentity !== gpuDevice
                || coreAuthorities.factoryConstructionToken !== null) {

                throw generationInvalidatedError(
                    candidateRecord.generation,
                    candidateRecord.reason || 'factory publication invalidated',
                );

            }

        };

        try {

            const gpuDevicePublished = Reflect.apply(
                authorities.defineProperty.callable,
                authorities.defineProperty.receiver,
                [vgpu, 'gpuDevice', {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: gpuDevice,
                }],
            );

            if (!gpuDevicePublished) {

                throw new TypeError('[vGPU] Failed to publish exact GpuDevice wrapper');

            }

            const ownershipPublished = Reflect.apply(
                authorities.defineProperty.callable,
                authorities.defineProperty.receiver,
                [vgpu, '_ownedGpuDevice', {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: gpuDevice,
                }],
            );

            if (!ownershipPublished) {

                throw new TypeError('[vGPU] Failed to publish GpuDevice ownership');

            }

            coreAuthorities.ownedDeviceCleanup = ownedGpuDeviceCleanup;

            coreAuthorities.gpuDeviceIdentity = gpuDevice;

            assertCandidateCurrent();

            publishProvenance(vgpu, true, assertCandidateCurrent);

            safeInvokeCoreCallable(authorities.log, ['[vGPU] Virtual GPU driver initialized']);

            assertCandidateCurrent();

        } catch (error) {

            if (invalidateCandidate) {

                try {
                    Reflect.apply(
                        invalidateCandidate.callable,
                        invalidateCandidate.receiver,
                        ['factory-publication-failed'],
                    );
                } catch (_) {}

            }

            if (getVgpuRegistryRecord(rawDevice) === candidateRecord) {

                deleteVgpuRegistryRecord(rawDevice);

            }

            safeCoreCleanup(ownedGpuDeviceCleanup);

            try { publishProvenance(null, false); } catch (_) {}

            throw error;

        }

        return vgpu;

        })();

        silenceVgpuPromise(operationPromise);

        return operationPromise;

    }



    /**

     * Wrap an existing GpuDevice

     */

    static fromDevice(gpuDevice) {

        return new VirtualGPU(gpuDevice);

    }



    _handleDeviceLost(info) {

        if (this._destroyed) return;

        try { console.warn('[vGPU] Device lost - invalidating generation'); } catch (_) {}

        if (this._registryRecord) {

            invalidateVgpuRegistryRecord(this._registryRecord, 'device-lost', info);

        } else {

            this._teardown('device-lost');

        }

    }



    /**

     * Get comprehensive stats

     */

    getStats() {

        const generation = this._factoryGeneration;

        this._assertFacadeAlive(generation);

        const targets = this._snapshotFacadeTargets([

            'buffer', 'bindings', 'shader', 'pipeline', 'texture', 'ring',

            'bundles', 'scheduler', 'warmup', 'debug', 'memory', 'renderStats',

            'quality', 'bindless', 'multiQueue', 'readback',

        ], generation);

        const calls = this._captureFacadeManagerCalls([

            { name: 'buffer', receiver: targets.buffer, key: 'getStats' },

            { name: 'bindings', receiver: targets.bindings, key: 'getStats' },

            { name: 'shader', receiver: targets.shader, key: 'getStats' },

            { name: 'pipeline', receiver: targets.pipeline, key: 'getStats' },

            { name: 'texture', receiver: targets.texture, key: 'getStats' },

            { name: 'ring', receiver: targets.ring, key: 'getStats' },

            { name: 'bundles', receiver: targets.bundles, key: 'getStats' },

            { name: 'scheduler', receiver: targets.scheduler, key: 'getStats' },

            { name: 'warmup', receiver: targets.warmup, key: 'getProgress' },

            { name: 'getLeaks', receiver: targets.debug, key: 'getLeaks' },

            { name: 'memory', receiver: targets.memory, key: 'getUsage' },

            { name: 'renderStats', receiver: targets.renderStats, key: 'getCurrent' },

            { name: 'quality', receiver: targets.quality, key: 'getStats' },

            { name: 'bindless', receiver: targets.bindless, key: 'getStats' },

            { name: 'multiQueue', receiver: targets.multiQueue, key: 'getStats' },

            { name: 'readback', receiver: targets.readback, key: 'getPendingCount' },

        ], generation);

        let leakTracking;

        try { leakTracking = Boolean(targets.debug._leakTracking); }

        finally { this._assertFacadeAlive(generation); }

        const call = (name, ...args) => this._invokeFacadeManager(calls[name], args, generation);

        return {

            buffer: call('buffer'),

            bindings: call('bindings'),

            shader: call('shader'),

            pipeline: call('pipeline'),

            texture: call('texture'),

            ring: call('ring'),

            bundles: call('bundles'),

            scheduler: call('scheduler'),

            warmup: call('warmup'),

            leaks: leakTracking ? call('getLeaks').length : 'disabled',

            memory: call('memory'),

            renderStats: call('renderStats'),

            quality: call('quality'),

            bindless: call('bindless'),

            multiQueue: call('multiQueue'),

            readbackPending: call('readback'),

        };

    }



    /**

     * Connect to game's EngineProfiler for unified stats

     */

    connectProfiler(engineProfiler) {

        const generation = this._factoryGeneration;

        this._assertFacadeAlive(generation);

        return this._callFacadeManager(this.engineProfiler, 'connect', [engineProfiler], generation);

    }



    /**

     * Sync stats to connected EngineProfiler

     */

    syncProfiler() {

        const generation = this._factoryGeneration;

        this._assertFacadeAlive(generation);

        return this._callFacadeManager(this.engineProfiler, 'sync', [], generation);

    }



    /**

     * Begin a new frame (call at frame start)

     */

    beginFrame() {

        const generation = this._factoryGeneration;

        this._assertFacadeAlive(generation);

        const targets = this._snapshotFacadeTargets(

            ['ring', 'renderStats', 'memory'], generation,

        );

        const calls = this._captureFacadeManagerCalls([

            { name: 'ring', receiver: targets.ring, key: 'beginFrame' },

            { name: 'renderStats', receiver: targets.renderStats, key: 'beginFrame' },

            { name: 'memory', receiver: targets.memory, key: 'update' },

        ], generation);

        this._invokeFacadeManager(calls.ring, [], generation);

        this._invokeFacadeManager(calls.renderStats, [], generation);

        this._invokeFacadeManager(calls.memory, [], generation);

        return true;

    }



    /**

     * End a frame (call at frame end, resolves profiler)

     */

    endFrame(encoder, frameTimeMs = 0) {

        const generation = this._factoryGeneration;

        this._assertFacadeAlive(generation);

        const targets = this._snapshotFacadeTargets(

            ['profiler', 'renderStats', 'readback', 'quality'], generation,

        );

        const calls = this._captureFacadeManagerCalls([

            { name: 'profiler', receiver: targets.profiler, key: 'resolve' },

            { name: 'renderStats', receiver: targets.renderStats, key: 'endFrame' },

            { name: 'readback', receiver: targets.readback, key: 'flush' },

            { name: 'quality', receiver: targets.quality, key: 'update' },

        ], generation);

        let normalizedFrameTime;

        try { normalizedFrameTime = Number(frameTimeMs); } finally { this._assertFacadeAlive(generation); }

        this._invokeFacadeManager(calls.profiler, [encoder], generation);

        this._invokeFacadeManager(calls.renderStats, [normalizedFrameTime], generation);

        this._invokeFacadeManager(calls.readback, [encoder], generation);

        this._invokeFacadeManager(calls.quality, [normalizedFrameTime], generation);

        return true;

    }



    /**

     * Log stats to console

     */

    logStats() {

        const generation = this._factoryGeneration;

        this._assertFacadeAlive(generation);

        const stats = this.getStats();

        console.group('[vGPU] Statistics');

        this._assertFacadeAlive(generation);

        console.log('Buffers:', stats.buffer);

        this._assertFacadeAlive(generation);

        console.log('Bindings:', stats.bindings);

        this._assertFacadeAlive(generation);

        console.log('Shaders:', stats.shader);

        this._assertFacadeAlive(generation);

        console.log('Pipelines:', stats.pipeline);

        this._assertFacadeAlive(generation);

        console.log('Textures:', stats.texture);

        this._assertFacadeAlive(generation);

        console.groupEnd();

        this._assertFacadeAlive(generation);

        return stats;

    }



    /**

     * Destroy all resources

     */

    destroy() {

        if (this._registryRecord) {

            return invalidateVgpuRegistryRecord(

                this._registryRecord,

                'coordinator-destroy',

            );

        }

        return this._teardown('coordinator-destroy');

    }



    _assertFacadeAlive(generation = this._factoryGeneration) {

        if (this._destroyed || generation !== this._factoryGeneration) {

            throw generationInvalidatedError(this.generation, this._destroyReason || 'destroyed');

        }

        return this;

    }



    _callFacadeManager(target, methodName, args, generation) {

        const captured = this._captureFacadeManagerCalls([{

            name: 'call', receiver: target, key: methodName,

        }], generation).call;

        return this._invokeFacadeManager(captured, args, generation);

    }



    _snapshotFacadeTargets(names, generation) {

        this._assertFacadeAlive(generation);

        const slots = names.map(name => Object.freeze({

            name,

            slot: captureVgpuPropertySlot(this, name),

        }));

        const targets = {};

        for (const entry of slots) {

            try { targets[entry.name] = readVgpuPropertySlot(entry.slot); }

            finally { this._assertFacadeAlive(generation); }

        }

        return Object.freeze(targets);

    }



    _captureFacadeManagerCalls(specifications, generation) {

        this._assertFacadeAlive(generation);

        const staged = specifications.map(specification => Object.freeze({

            ...specification,

            slot: captureVgpuPropertySlot(specification.receiver, specification.key),

        }));

        const calls = {};

        for (const specification of staged) {

            let callable;

            try { callable = readVgpuPropertySlot(specification.slot); }

            finally { this._assertFacadeAlive(generation); }

            if (typeof callable !== 'function') {

                throw new TypeError(`[vGPU] ${specification.key} is unavailable`);

            }

            calls[specification.name] = Object.freeze({

                receiver: specification.receiver,

                callable,

            });

        }

        return Object.freeze(calls);

    }



    _invokeFacadeManager(captured, args, generation) {

        this._assertFacadeAlive(generation);

        const result = Reflect.apply(captured.callable, captured.receiver, args);

        this._assertFacadeAlive(generation);

        return result;

    }



    acquire(ownerId) {

        if (!this._registryRecord?.active) {

            throw generationInvalidatedError(this.generation, this._destroyReason);

        }

        return acquireFromRecord(this._registryRecord, ownerId);

    }



    _teardown(reason = 'destroyed') {

        const lifecycleState = getVgpuFacadeLifecycleState(this);

        if (!lifecycleState || lifecycleState.destroyed) return false;

        const factoryOperations = snapshotVgpuPrivateMapValues(this, '_factoryOperations');

        let factoryError = factoryOperationLifecycleError(reason);

        for (let index = 0; index < factoryOperations.length; index++) {
            const lifecycleAuthority = getVgpuOperationFactoryAuthorities(
                factoryOperations[index],
            )?.lifecycleError || null;
            if (!lifecycleAuthority) continue;
            try {
                factoryError = Reflect.apply(
                    lifecycleAuthority.callable, lifecycleAuthority.receiver, [reason],
                );
            } catch (_) {}
            break;
        }

        const ownedFactoryResources = snapshotVgpuPrivateSet(this, '_ownedFactoryResources');

        const factoryResources = [];

        for (let index = ownedFactoryResources.length - 1; index >= 0; index--) {

            const resource = ownedFactoryResources[index];
            const registration = getVgpuPrivateMapEntry(this, '_factoryChildReleases', resource);

            factoryResources[factoryResources.length] = Object.freeze({

                resource,

                cleanup: registration?.cleanup || null,

            });

        }

        const coreAuthorities = Reflect.apply(
            VGPU_WEAK_MAP_GET, VGPU_CORE_AUTHORITIES, [this],
        ) || null;

        const managerCleanups = [];

        const registeredManagerCleanups = coreAuthorities?.managers || [];

        for (let index = registeredManagerCleanups.length - 1; index >= 0; index--) {
            managerCleanups[managerCleanups.length] = registeredManagerCleanups[index];
        }

        const removeDeviceLostHandler = coreAuthorities?.deviceLostCleanup || null;

        const ownedDeviceCleanup = coreAuthorities?.ownedDeviceCleanup || null;

        if (!invalidateVgpuFacadeLifecycle(this, reason)) return false;

        Reflect.apply(VGPU_WEAK_MAP_DELETE, VGPU_CORE_AUTHORITIES, [this]);

        if (coreAuthorities) {

            coreAuthorities.managers.length = 0;

            coreAuthorities.deviceLostCleanup = null;

            coreAuthorities.ownedDeviceCleanup = null;

            coreAuthorities.gpuDeviceIdentity = null;

            coreAuthorities.normalizedGpuDevice = null;

            coreAuthorities.rawDevice = null;

            coreAuthorities.limits = null;

            coreAuthorities.features = null;

            coreAuthorities.featureHas = null;

        }

        try { this._coreManagerCleanups = []; } catch (_) {}

        clearVgpuPrivateMap(this, '_factoryOperations');

        clearVgpuPrivateMap(this, '_factoryDescriptors');

        clearVgpuPrivateMap(this, '_factoryPublications');

        clearVgpuPrivateSet(this, '_ownedFactoryResources');

        for (let index = 0; index < factoryResources.length; index++) {
            deleteVgpuPrivateMapEntry(
                this, '_factoryChildReleases', factoryResources[index].resource,
            );
        }

        const sever = (name) => {

            try {

                Object.defineProperty(this, name, {

                    configurable: true,

                    enumerable: true,

                    writable: true,

                    value: null,

                });

            } catch (_) {}

        };

        sever('_ownedGpuDevice');

        sever('gpuDevice');

        sever('device');

        sever('queue');

        sever('adapter');

        sever('_debugDraw');

        sever('_renderGraph');

        sever('_indirectRenderer');

        sever('_hizCulling');

        sever('_streaming');

        if (typeof removeDeviceLostHandler === 'function') {

            try { Reflect.apply(removeDeviceLostHandler, null, []); } catch (_) {}

        }

        sever('_removeDeviceLostHandler');

        sever('_deviceLostHandler');



        for (let index = 0; index < factoryOperations.length; index++) {

            const operation = factoryOperations[index];
            const operationAuthorities = getVgpuOperationFactoryAuthorities(operation);

            try {
                const cancelAuthority = operationAuthorities?.cancelOperation || null;
                if (cancelAuthority) {
                    Reflect.apply(cancelAuthority.callable, cancelAuthority.receiver, [
                        operation, factoryError, null, operationAuthorities,
                    ]);
                } else {
                    const candidate = getVgpuOperationPrivateValue(operation, 'candidate');
                    const cleanup = getVgpuOperationPrivateValue(operation, 'candidateCleanup');
                    if (candidate && !getVgpuOperationPrivateValue(operation, 'candidateOwned')) {
                        setVgpuOperationPrivateValue(operation, 'candidate', null);
                        setVgpuOperationPrivateValue(operation, 'candidateCleanup', null);
                        safeCoreCleanup(cleanup);
                    }
                    if (claimVgpuOperationSettlement(operation)) {
                        invokeVgpuSettlementAuthority(operation, true, factoryError);
                    }
                }

            } catch (_) {}

        }



        for (let index = 0; index < factoryResources.length; index++) {

            safeCoreCleanup(factoryResources[index].cleanup);

        }

        for (let index = 0; index < managerCleanups.length; index++) {

            const entry = managerCleanups[index];
            try { safeCoreCleanup(entry.cleanup); } catch (error) {

                try { console.warn(`[vGPU] Teardown failed for ${entry.name}:`, error); } catch (_) {}

            }

        }

        if (ownedDeviceCleanup) safeCoreCleanup(ownedDeviceCleanup);

        sever('reflection');

        try { console.log(`[vGPU] Destroyed generation ${this.generation} (${reason})`); } catch (_) {}

        return true;

    }



    _trackFactoryResource(
        resource, cleanup = null, attachAuthority = null, releaseAuthority = null,
    ) {

        if (this._destroyed) {

            throw generationInvalidatedError(this.generation, this._destroyReason);

        }

        if (resource && typeof resource === 'object') {

            addVgpuPrivateSetEntry(this, '_ownedFactoryResources', resource);

            try {

                if (attachAuthority) {
                    Reflect.apply(
                        attachAuthority.callable,
                        attachAuthority.receiver,
                        [resource, null, cleanup, releaseAuthority],
                    );
                } else {
                    this._attachFactoryChildRelease(resource, null, cleanup);
                }

            } catch (error) {

                deleteVgpuPrivateSetEntry(this, '_ownedFactoryResources', resource);

                throw error;

            }

        }

        return resource;

    }



    _factoryLifecycleError(reason = this._destroyReason || 'destroyed') {

        return factoryOperationLifecycleError(reason);

    }



    _factoryOptionsMismatchError(label) {

        const error = new Error(`[vGPU] ${label} already exists with incompatible options`);

        error.code = 'VGPU_FACTORY_OPTIONS_MISMATCH';

        return error;

    }



    _assertFactoryAlive(generation = this._factoryGeneration) {

        if (this._destroyed || generation !== this._factoryGeneration) {

            throw this._factoryLifecycleError();

        }

    }



    _isFactoryOperationCurrent(operation) {

        return Boolean(operation)

            && !isVgpuOperationSettled(operation)

            && !this._destroyed

            && getVgpuOperationIdentity(operation, 'generation') === this._factoryGeneration

            && getVgpuPrivateMapEntry(
                this, '_factoryOperations', getVgpuOperationIdentity(operation, 'key'),
            ) === operation;

    }



    _destroyFactoryCandidate(candidate, cleanupOverride = null) {

        if (!candidate) return;

        const registration = getVgpuPrivateMapEntry(this, '_factoryChildReleases', candidate);

        const cleanup = cleanupOverride || registration?.cleanup || captureCoreCleanup(

            candidate, ['destroy', 'dispose', 'clear', 'hide', 'reset'],

        );

        if (cleanup) safeCoreCleanup(cleanup);

    }



    _releaseFactoryChild(candidate) {

        if (!candidate) return false;

        const registration = getVgpuPrivateMapEntry(this, '_factoryChildReleases', candidate);

        deleteVgpuPrivateMapEntry(this, '_factoryChildReleases', candidate);

        deleteVgpuPrivateSetEntry(this, '_ownedFactoryResources', candidate);

        const slot = registration?.slot || null;

        if (slot && getVgpuPrivateMapEntry(this, '_factoryPublications', slot) === candidate) {
            deleteVgpuPrivateMapEntry(this, '_factoryPublications', slot);
            deleteVgpuPrivateMapEntry(this, '_factoryDescriptors', slot);
            try {
                if (Reflect.get(this, slot) === candidate) Reflect.set(this, slot, null);
            } catch (_) {}
        }

        const operations = snapshotVgpuPrivateMapValues(this, '_factoryOperations');

        const lifecycleOperation = operations.find(
            operation => getVgpuOperationFactoryAuthorities(operation)?.lifecycleError,
        );

        const lifecycleAuthority = lifecycleOperation
            ? getVgpuOperationFactoryAuthorities(lifecycleOperation).lifecycleError
            : null;

        const error = lifecycleAuthority
            ? Reflect.apply(
                lifecycleAuthority.callable, lifecycleAuthority.receiver, ['child destroyed'],
            )
            : this._factoryLifecycleError('child destroyed');

        for (const operation of operations) {

            if (getVgpuOperationPrivateValue(operation, 'candidate') !== candidate) continue;

            setVgpuOperationPrivateValue(operation, 'candidate', null);

            const settleAuthority = getVgpuOperationFactoryAuthorities(operation)?.settleOperation || null;

            if (settleAuthority) {
                Reflect.apply(
                    settleAuthority.callable, settleAuthority.receiver,
                    [operation, null, error],
                );
            } else this._settleFactoryOperation(operation, null, error);

        }

        return Boolean(registration);

    }



    _attachFactoryChildRelease(
        candidate, slot = null, cleanupOverride = null, releaseAuthority = null,
    ) {

        if (!candidate || typeof candidate !== 'object') {

            return candidate;

        }

        if (hasVgpuPrivateMapEntry(this, '_factoryChildReleases', candidate)) return candidate;

        const generation = this._factoryGeneration;

        this._assertFactoryAlive(generation);

        const cleanup = cleanupOverride || captureCoreCleanup(

            candidate, ['destroy', 'dispose', 'clear', 'hide', 'reset'],

        );

        setVgpuPrivateMapEntry(
            this,
            '_factoryChildReleases',
            candidate,
            Object.freeze({ slot, cleanup }),
        );

        this._assertFactoryAlive(generation);

        if (!cleanup || cleanup.methodName !== 'destroy') {

            return candidate;

        }

        const parent = this;

        const originalDestroy = cleanup.callable;

        const wrappedDestroy = function factoryChildDestroy(...args) {

            try {

                return originalDestroy.apply(this, args);

            } finally {

                if (releaseAuthority) {
                    Reflect.apply(
                        releaseAuthority.callable, releaseAuthority.receiver, [candidate],
                    );
                } else {
                    parent._releaseFactoryChild(candidate);
                }

            }

        };

        setVgpuPrivateMapEntry(this, '_factoryChildReleases', candidate, Object.freeze({

            slot, cleanup, originalDestroy, wrappedDestroy,

        }));

        Object.defineProperty(candidate, 'destroy', {

            configurable: true,

            writable: true,

            value: wrappedDestroy,

        });

        this._assertFactoryAlive(generation);

        return candidate;

    }



    _publishedFactoryPromise({
        key, label, slot, descriptorKey, candidate, generation, factoryAuthorities,
    }) {

        let resolvePublic;

        let rejectPublic;

        const candidateCleanup = getVgpuPrivateMapEntry(
            this, '_factoryChildReleases', candidate,
        )?.cleanup || null;

        const operation = {

            key,

            label,

            slot,

            descriptorKey,

            generation,

            candidate,

            candidateCleanup: null,

            candidateOwned: true,

            factoryAuthorities,

            settled: false,

            promise: null,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        setVgpuOperationPrivateValue(operation, 'candidate', candidate);

        setVgpuOperationPrivateValue(
            operation, 'candidateCleanup', candidateCleanup,
        );

        setVgpuOperationPrivateValue(operation, 'candidateOwned', true);

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        setVgpuPrivateMapEntry(this, '_factoryOperations', key, operation);

        const isCurrent = () => Reflect.apply(
            factoryAuthorities.isCurrent.callable,
            factoryAuthorities.isCurrent.receiver,
            [operation],
        );

        const settle = (value, error) => Reflect.apply(
            factoryAuthorities.settleOperation.callable,
            factoryAuthorities.settleOperation.receiver,
            [operation, value, error],
        );

        queueVgpuMicrotask(() => {
            let operationCurrent = false;
            let publishedCandidate = null;
            let candidateDestroyed = true;
            let validationError = null;
            try {
                operationCurrent = isCurrent();
                if (operationCurrent) {
                    publishedCandidate = getVgpuPrivateMapEntry(
                        this, '_factoryPublications', slot,
                    );
                    candidateDestroyed = Boolean(Reflect.get(candidate, '_destroyed'));
                }
            } catch (error) {
                validationError = error;
            }
            if (validationError) {
                if (!isVgpuOperationSettled(operation)) {
                    setVgpuOperationPrivateValue(operation, 'candidate', null);
                    settle(null, validationError);
                }
                return;
            }

            if (

                !operationCurrent

                || publishedCandidate !== candidate

                || candidateDestroyed

            ) {

                if (!isVgpuOperationSettled(operation)) {

                    setVgpuOperationPrivateValue(operation, 'candidate', null);

                    const lifecycleError = Reflect.apply(
                        factoryAuthorities.lifecycleError.callable,
                        factoryAuthorities.lifecycleError.receiver,
                        ['cached child invalidated'],
                    );

                    settle(null, lifecycleError);

                }

                return;

            }

            setVgpuOperationPrivateValue(operation, 'candidate', null);

            settle(candidate, null);

        });

        return getVgpuOperationPromise(operation);

    }



    _constructFactoryCandidate(FactoryType) {

        return new FactoryType(this);

    }



    _retireFactoryCandidate(
        operation, cleanup = null, factoryAuthorities = null,
    ) {

        factoryAuthorities = factoryAuthorities || getVgpuOperationFactoryAuthorities(operation);

        const candidate = getVgpuOperationPrivateValue(operation, 'candidate');

        if (!candidate) return;

        setVgpuOperationPrivateValue(operation, 'candidate', null);

        const candidateCleanup = getVgpuOperationPrivateValue(operation, 'candidateCleanup');

        setVgpuOperationPrivateValue(operation, 'candidateCleanup', null);

        if (getVgpuOperationPrivateValue(operation, 'candidateOwned')) return;

        deleteVgpuPrivateSetEntry(this, '_ownedFactoryResources', candidate);

        const slot = getVgpuOperationIdentity(operation, 'slot');

        if (slot) {
            if (getVgpuPrivateMapEntry(this, '_factoryPublications', slot) === candidate) {
                deleteVgpuPrivateMapEntry(this, '_factoryPublications', slot);
                deleteVgpuPrivateMapEntry(this, '_factoryDescriptors', slot);
            }
            let descriptor = null;
            try { descriptor = Reflect.getOwnPropertyDescriptor(this, slot); } catch (_) {}
            if (descriptor && 'value' in descriptor && descriptor.value === candidate) {
                try {
                    Reflect.defineProperty(this, slot, {
                        ...descriptor,
                        value: null,
                    });
                } catch (_) {}
            }
        }

        if (cleanup) cleanup(
            candidate, ['destroy', 'dispose', 'clear', 'hide', 'reset'],
            getVgpuOperationIdentity(operation, 'label'),
        );

        else if (factoryAuthorities?.destroyCandidate) {
            Reflect.apply(
                factoryAuthorities.destroyCandidate.callable,
                factoryAuthorities.destroyCandidate.receiver,
                [candidate, candidateCleanup],
            );
        } else this._destroyFactoryCandidate(candidate, candidateCleanup);

    }



    _settleFactoryOperation(operation, value, error) {

        if (!claimVgpuOperationSettlement(operation)) return false;

        const key = getVgpuOperationIdentity(operation, 'key');

        if (getVgpuPrivateMapEntry(this, '_factoryOperations', key) === operation) {

            deleteVgpuPrivateMapEntry(this, '_factoryOperations', key);

        }

        invokeVgpuSettlementAuthority(operation, Boolean(error), error || value);

        return true;

    }



    _cancelFactoryOperation(
        operation, error, cleanup = null, factoryAuthorities = null,
    ) {

        if (!operation || isVgpuOperationSettled(operation)) return false;

        factoryAuthorities = factoryAuthorities || getVgpuOperationFactoryAuthorities(operation);

        const key = getVgpuOperationIdentity(operation, 'key');

        if (getVgpuPrivateMapEntry(this, '_factoryOperations', key) === operation) {

            deleteVgpuPrivateMapEntry(this, '_factoryOperations', key);

        }

        if (factoryAuthorities?.retireCandidate) {
            Reflect.apply(
                factoryAuthorities.retireCandidate.callable,
                factoryAuthorities.retireCandidate.receiver,
                [operation, cleanup, factoryAuthorities],
            );
        } else this._retireFactoryCandidate(operation, cleanup);

        return factoryAuthorities?.settleOperation
            ? Reflect.apply(
                factoryAuthorities.settleOperation.callable,
                factoryAuthorities.settleOperation.receiver,
                [operation, null, error],
            )
            : this._settleFactoryOperation(operation, null, error);

    }



    _startFactoryOperation({
        key,
        label,
        slot = null,
        descriptorKey = null,
        create,
        initialize,
        initializeAuthority = null,
        initializeKey = 'init',
        factoryAuthorities = null,
    }) {

        const generation = this._factoryGeneration;

        try {
            factoryAuthorities = factoryAuthorities
                || captureFactoryEntryAuthorities(this, generation);
            Reflect.apply(
                factoryAuthorities.assertAlive.callable,
                factoryAuthorities.assertAlive.receiver,
                [generation],
            );
        } catch (error) { return rejectVgpuPromise(error); }

        const invokeFactory = (authority, args = []) => Reflect.apply(
            authority.callable, authority.receiver, args,
        );

        const isCurrent = operation => invokeFactory(
            factoryAuthorities.isCurrent, [operation],
        );

        const retire = operation => invokeFactory(
            factoryAuthorities.retireCandidate, [operation, null, factoryAuthorities],
        );

        const cancel = (operation, error) => invokeFactory(
            factoryAuthorities.cancelOperation,
            [operation, error, null, factoryAuthorities],
        );



        const existing = getVgpuPrivateMapEntry(this, '_factoryOperations', key);

        if (existing) {

            if (getVgpuOperationIdentity(existing, 'descriptorKey') !== descriptorKey) {

                return rejectVgpuPromise(invokeFactory(
                    factoryAuthorities.mismatchError, [label],
                ));

            }

            return getVgpuOperationPromise(existing);

        }



        let publishedCandidate = slot
            ? getVgpuPrivateMapEntry(this, '_factoryPublications', slot)
            : null;

        if (publishedCandidate && publishedCandidate._destroyed) {

            const terminal = publishedCandidate;

            invokeFactory(factoryAuthorities.releaseChild, [terminal]);

            if (getVgpuPrivateMapEntry(this, '_factoryPublications', slot) === terminal) {

                deleteVgpuPrivateMapEntry(this, '_factoryPublications', slot);

                deleteVgpuPrivateMapEntry(this, '_factoryDescriptors', slot);

                deleteVgpuPrivateSetEntry(this, '_ownedFactoryResources', terminal);

            }

            publishedCandidate = null;

        }



        if (slot && publishedCandidate) {

            const publishedDescriptor = getVgpuPrivateMapEntry(
                this, '_factoryDescriptors', slot,
            );

            if (publishedDescriptor !== descriptorKey) {

                return rejectVgpuPromise(invokeFactory(
                    factoryAuthorities.mismatchError, [label],
                ));

            }

            return invokeFactory(factoryAuthorities.publishedPromise, [{

                key,

                label,

                slot,

                descriptorKey,

                candidate: publishedCandidate,

                generation,

                factoryAuthorities,

            }]);

        }



        let resolvePublic;

        let rejectPublic;

        const operation = {

            key,

            label,

            slot,

            descriptorKey,

            generation,

            candidate: null,

            candidateCleanup: null,

            initializeAuthority: null,

            factoryAuthorities,

            candidateOwned: false,

            settled: false,

            promise: null,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        for (const property of [
            'candidate', 'candidateCleanup', 'initializeAuthority', 'candidateOwned',
        ]) setVgpuOperationPrivateValue(operation, property, operation[property]);



        silenceVgpuPromise(getVgpuOperationPromise(operation));



        // Publish the authority record before construction/init can invoke any

        // user or GPU hook. Teardown can now synchronously reach the candidate.

        setVgpuPrivateMapEntry(this, '_factoryOperations', key, operation);

        let candidate = null;

        try {

            candidate = create();

            setVgpuOperationPrivateValue(operation, 'candidate', candidate);

            setVgpuOperationPrivateValue(operation, 'candidateCleanup', captureCoreCleanup(

                candidate, ['destroy', 'dispose', 'clear', 'hide', 'reset'],

            ));

            setVgpuOperationPrivateValue(operation, 'initializeAuthority', initializeAuthority

                && Reflect.getPrototypeOf(candidate) === initializeAuthority.receiver

                ? Object.freeze({

                    receiver: candidate,

                    callable: initializeAuthority.callable,

                })

                : captureVgpuCallableSet([

                {
                    name: 'initialize',
                    receiver: candidate,
                    key: initializeKey,
                    operation: `${label} initialization`,
                },

            ], () => invokeFactory(
                factoryAuthorities.assertAlive, [generation],
            )).initialize);

            if (!isCurrent(operation)) {

                retire(operation);

                return getVgpuOperationPromise(operation);

            }

            invokeFactory(factoryAuthorities.attachChild, [

                candidate,

                getVgpuOperationIdentity(operation, 'slot'),

                getVgpuOperationPrivateValue(operation, 'candidateCleanup'),

                factoryAuthorities.releaseChild,

            ]);

            if (!isCurrent(operation)) {

                retire(operation);

                return getVgpuOperationPromise(operation);

            }

            const candidateDestroyed = Boolean(Reflect.get(candidate, '_destroyed'));

            if (!isCurrent(operation) || candidateDestroyed) {

                retire(operation);

                return getVgpuOperationPromise(operation);

            }

        } catch (error) {

            if (!isVgpuOperationSettled(operation)) cancel(operation, error);

            else if (getVgpuOperationPrivateValue(operation, 'candidate')) retire(operation);

            return getVgpuOperationPromise(operation);

        }



        let rawPromise;

        try {

            if (!isCurrent(operation)) return getVgpuOperationPromise(operation);

            rawPromise = initialize(
                getVgpuOperationPrivateValue(operation, 'candidate'),
                getVgpuOperationPrivateValue(operation, 'initializeAuthority'),
            );

        } catch (error) {

            cancel(operation, error);

            return getVgpuOperationPromise(operation);

        }



        void thenVgpuPromise(resolveVgpuPromise(rawPromise),

            () => {

                if (!isCurrent(operation)) return;

                const candidate = getVgpuOperationPrivateValue(operation, 'candidate');

                try {

                    invokeFactory(
                        factoryAuthorities.assertAlive,
                        [getVgpuOperationIdentity(operation, 'generation')],
                    );

                    const terminal = Boolean(Reflect.get(candidate, '_destroyed'));

                    if (!isCurrent(operation) || terminal) {

                        throw invokeFactory(factoryAuthorities.lifecycleError, [
                            terminal
                                ? 'candidate terminated during initialization'
                                : 'invalidated',
                        ]);

                    }

                    invokeFactory(factoryAuthorities.trackResource, [
                        candidate,
                        getVgpuOperationPrivateValue(operation, 'candidateCleanup'),
                        factoryAuthorities.attachChild,
                        factoryAuthorities.releaseChild,
                    ]);

                    setVgpuOperationPrivateValue(operation, 'candidateOwned', true);

                    invokeFactory(
                        factoryAuthorities.assertAlive,
                        [getVgpuOperationIdentity(operation, 'generation')],
                    );

                    const operationSlot = getVgpuOperationIdentity(operation, 'slot');

                    if (operationSlot) {

                        const published = Reflect.defineProperty(this, operationSlot, {
                            configurable: true,
                            enumerable: true,
                            writable: true,
                            value: candidate,
                        });

                        if (!published) {
                            throw invokeFactory(
                                factoryAuthorities.lifecycleError,
                                ['factory slot publication failed'],
                            );
                        }

                        setVgpuPrivateMapEntry(
                            this,
                            '_factoryDescriptors',
                            operationSlot,
                            getVgpuOperationIdentity(operation, 'descriptorKey'),
                        );

                        setVgpuPrivateMapEntry(
                            this, '_factoryPublications', operationSlot, candidate,
                        );

                    }

                    setVgpuOperationPrivateValue(operation, 'candidate', null);

                    setVgpuOperationPrivateValue(operation, 'candidateCleanup', null);

                    invokeFactory(
                        factoryAuthorities.settleOperation, [operation, candidate, null],
                    );

                } catch (error) {

                    setVgpuOperationPrivateValue(operation, 'candidate', candidate);

                    if (getVgpuOperationPrivateValue(operation, 'candidateOwned') && isCurrent(operation)) {
                        deleteVgpuPrivateSetEntry(this, '_ownedFactoryResources', candidate);
                        deleteVgpuPrivateMapEntry(this, '_factoryChildReleases', candidate);
                        setVgpuOperationPrivateValue(operation, 'candidateOwned', false);
                    }

                    cancel(operation, error);

                }

            },

            error => {

                if (isCurrent(operation)) {

                    cancel(operation, error);

                }

            },

        );

        return getVgpuOperationPromise(operation);

    }



    _readFactoryValue(target, key, generation = this._factoryGeneration) {

        this._assertFactoryAlive(generation);

        let value;

        try { value = Reflect.get(target, key); }

        finally { this._assertFactoryAlive(generation); }

        return value;

    }



    _normalizeFactoryValue(value, normalize, generation = this._factoryGeneration) {

        this._assertFactoryAlive(generation);

        let normalized;

        try { normalized = normalize(value); }

        finally { this._assertFactoryAlive(generation); }

        return normalized;

    }



    _snapshotStreamingFactoryOptions(options, generation = this._factoryGeneration) {

        const source = options ?? {};

        const memoryBudgetValue = this._readFactoryValue(source, 'memoryBudget', generation);

        const concurrentValue = this._readFactoryValue(source, 'maxConcurrentLoads', generation);

        let memoryBudget = memoryBudgetValue === undefined

            ? DEFAULT_STREAMING_MEMORY_BUDGET

            : this._normalizeFactoryValue(memoryBudgetValue, Number, generation);

        if (!Number.isFinite(memoryBudget) || memoryBudget < 0) {

            throw new RangeError('Streaming memoryBudget must be a finite non-negative number');

        }

        if (Object.is(memoryBudget, -0)) memoryBudget = 0;

        let maxConcurrentLoads = concurrentValue === undefined

            ? DEFAULT_STREAMING_MAX_CONCURRENT_LOADS

            : this._normalizeFactoryValue(concurrentValue, Number, generation);

        maxConcurrentLoads = Math.floor(maxConcurrentLoads);

        this._assertFactoryAlive(generation);

        if (!Number.isSafeInteger(maxConcurrentLoads) || maxConcurrentLoads < 0) {

            throw new RangeError('Streaming maxConcurrentLoads must be a non-negative safe integer');

        }

        if (Object.is(maxConcurrentLoads, -0)) maxConcurrentLoads = 0;

        return Object.freeze({ memoryBudget, maxConcurrentLoads });

    }



    _createSyncFactoryResource(create) {

        const generation = this._factoryGeneration;

        const factoryAuthorities = captureFactoryEntryAuthorities(this, generation);

        const invokeFactory = (authority, args = []) => Reflect.apply(
            authority.callable, authority.receiver, args,
        );

        invokeFactory(factoryAuthorities.assertAlive, [generation]);

        let candidate = null;

        let candidateCleanup = null;

        try {

            candidate = create();

            candidateCleanup = captureCoreCleanup(

                candidate, ['destroy', 'dispose', 'clear', 'hide', 'reset'],

            );

            invokeFactory(factoryAuthorities.assertAlive, [generation]);

            const tracked = invokeFactory(factoryAuthorities.trackResource, [
                candidate,
                candidateCleanup,
                factoryAuthorities.attachChild,
                factoryAuthorities.releaseChild,
            ]);

            invokeFactory(factoryAuthorities.assertAlive, [generation]);

            return tracked;

        } catch (error) {

            if (candidate && !hasVgpuPrivateSetEntry(this, '_ownedFactoryResources', candidate)) {

                invokeFactory(
                    factoryAuthorities.destroyCandidate, [candidate, candidateCleanup],
                );

            }

            throw error;

        }

    }



    _createSyncFactoryValue(create) {

        const generation = this._factoryGeneration;

        const factoryAuthorities = captureFactoryEntryAuthorities(this, generation);

        const assertAlive = () => Reflect.apply(
            factoryAuthorities.assertAlive.callable,
            factoryAuthorities.assertAlive.receiver,
            [generation],
        );

        assertAlive();

        const value = create();

        assertAlive();

        return value;

    }



    /**

     * Create a texture atlas

     */

    createAtlas(options) {

        return this._createSyncFactoryResource(() => new VGPUTextureAtlas(this, options));

    }



    /**

     * Create a sprite batch for an atlas

     */

    createSpriteBatch(atlas) {

        return this._createSyncFactoryResource(() => new VGPUSpriteBatch(this, atlas));

    }



    /**

     * Create a dynamic viewport for resolution scaling

     */

    createDynamicViewport(width, height) {

        return this._createSyncFactoryResource(() => new VGPUDynamicViewport(this, width, height));

    }



    /**

     * Create a stats overlay for debugging

     */

    createStatsOverlay() {

        return this._createSyncFactoryResource(() => new VGPUStatsOverlay(this.renderStats));

    }



    // ========================================================================

    // ADVANCED RENDERING MODULE FACTORIES

    // ========================================================================



    /**

     * Create or get the render graph instance

     * @returns {VGPURenderGraph}

     */

    createRenderGraph() {

        const renderGraph = this._createSyncFactoryResource(() => new VGPURenderGraph(this));

        this._renderGraph = renderGraph;

        return renderGraph;

    }



    /**

     * Create a render graph builder for ergonomic graph construction

     * @returns {RenderGraphBuilder}

     */

    createRenderGraphBuilder() {

        const generation = this._factoryGeneration;

        const factoryAuthorities = captureFactoryEntryAuthorities(this, generation, [
            {
                name: 'createBuilder',
                receiver: RenderGraphBuilder,
                key: 'create',
                operation: 'render graph builder creation',
            },
        ]);

        Reflect.apply(
            factoryAuthorities.assertAlive.callable,
            factoryAuthorities.assertAlive.receiver,
            [generation],
        );

        let builder = null;

        let builderCleanup = null;

        let graph = null;

        let graphCleanup = null;

        let rollbackCleanup = null;

        try {

            builder = Reflect.apply(
                factoryAuthorities.createBuilder.callable,
                factoryAuthorities.createBuilder.receiver,
                [this],
            );

            builderCleanup = captureCoreCleanup(
                builder, ['destroy', 'dispose', 'clear', 'hide', 'reset'],
            );

            const graphSlot = captureVgpuPropertySlot(builder, 'graph');

            graph = readVgpuPropertySlot(graphSlot);

            graphCleanup = captureCoreCleanup(

                graph, ['destroy', 'dispose', 'clear', 'hide', 'reset'],

            );

            const rollbackBase = graphCleanup || builderCleanup;

            if (rollbackBase) {
                let retired = false;
                rollbackCleanup = Object.freeze({
                    ...rollbackBase,
                    receiver: undefined,
                    callable: () => {
                        if (retired) return;
                        retired = true;
                        safeCoreCleanup(rollbackBase);
                    },
                });

                Reflect.apply(VGPU_WEAK_SET_ADD, CORE_CLEANUP_RECORDS, [rollbackCleanup]);
            }

            Reflect.apply(
                factoryAuthorities.assertAlive.callable,
                factoryAuthorities.assertAlive.receiver,
                [generation],
            );

            Reflect.apply(
                factoryAuthorities.trackResource.callable,
                factoryAuthorities.trackResource.receiver,
                [
                    graph,
                    rollbackCleanup || graphCleanup,
                    factoryAuthorities.attachChild,
                    factoryAuthorities.releaseChild,
                ],
            );

            Reflect.apply(
                factoryAuthorities.assertAlive.callable,
                factoryAuthorities.assertAlive.receiver,
                [generation],
            );

            return builder;

        } catch (error) {

            if (!graph || !hasVgpuPrivateSetEntry(this, '_ownedFactoryResources', graph)) {
                safeCoreCleanup(rollbackCleanup || builderCleanup || graphCleanup);
            }

            throw error;

        }

    }



    /**

     * Create an indirect renderer for GPU-driven rendering

     * Buffers grow dynamically - no fixed maximums needed.

     * @returns {Promise<VGPUIndirectRenderer>}

     */

    createIndirectRenderer() {

        const generation = this._factoryGeneration;

        let factoryAuthorities;

        try {

            factoryAuthorities = captureFactoryEntryAuthorities(this, generation, [{

                name: 'initialize',

                receiver: VGPUIndirectRenderer.prototype,

                key: 'init',

                operation: 'indirect renderer initialization',

            }]);

        }
        catch (error) { return rejectVgpuPromise(error); }

        return Reflect.apply(factoryAuthorities.start.callable, factoryAuthorities.start.receiver, [{

            key: 'indirect-renderer',

            label: 'indirect renderer',

            slot: '_indirectRenderer',

            descriptorKey: 'default',

            create: () => Reflect.apply(
                factoryAuthorities.construct.callable,
                factoryAuthorities.construct.receiver,
                [VGPUIndirectRenderer],
            ),

            initialize: (_renderer, authority) => Reflect.apply(
                authority.callable, authority.receiver, [],
            ),

            initializeAuthority: factoryAuthorities.initialize,

            factoryAuthorities,

        }]);

    }



    /**

     * Create an instance builder for indirect rendering

     * Grows dynamically - no fixed maximum.

     * @param {number} initialCapacity - Initial capacity (optional, grows as needed)

     * @returns {IndirectInstanceBuilder}

     */

    createIndirectInstanceBuilder(initialCapacity = 256) {

        return this._createSyncFactoryValue(() => new IndirectInstanceBuilder(initialCapacity));

    }



    /**

     * Create HiZ culling system for occlusion culling

     * Object buffers grow dynamically - no fixed maximums.

     * @param {number} width - Screen width

     * @param {number} height - Screen height

     * @returns {Promise<VGPUHiZCulling>}

     */

    createHiZCulling(width, height) {

        const generation = this._factoryGeneration;

        let factoryAuthorities;

        let stableWidth;

        let stableHeight;

        try {

            factoryAuthorities = captureFactoryEntryAuthorities(this, generation, [{

                name: 'initialize',

                receiver: VGPUHiZCulling.prototype,

                key: 'init',

                operation: 'HiZ culling initialization',

            }]);

            Reflect.apply(
                factoryAuthorities.assertAlive.callable,
                factoryAuthorities.assertAlive.receiver,
                [generation],
            );

            stableWidth = this._normalizeFactoryValue(width, Number, generation);

            stableHeight = this._normalizeFactoryValue(height, Number, generation);

        } catch (error) {

            return rejectVgpuPromise(error);

        }

        const descriptorKey = stableDescriptorKey({ width: stableWidth, height: stableHeight });

        return Reflect.apply(factoryAuthorities.start.callable, factoryAuthorities.start.receiver, [{

            key: 'hiz-culling',

            label: 'HiZ culling',

            slot: '_hizCulling',

            descriptorKey,

            create: () => Reflect.apply(
                factoryAuthorities.construct.callable,
                factoryAuthorities.construct.receiver,
                [VGPUHiZCulling],
            ),

            initialize: (_hiz, authority) => Reflect.apply(
                authority.callable, authority.receiver, [stableWidth, stableHeight],
            ),

            initializeAuthority: factoryAuthorities.initialize,

            factoryAuthorities,

        }]);

    }



    /**

     * Create a bounding box builder for HiZ culling

     * Grows dynamically - no fixed maximum.

     * @param {number} initialCapacity - Initial capacity (optional, grows as needed)

     * @returns {BoundingBoxBuilder}

     */

    createBoundingBoxBuilder(initialCapacity = 256) {

        return this._createSyncFactoryValue(() => new BoundingBoxBuilder(initialCapacity));

    }



    /**

     * Create a streaming manager for progressive resource loading

     * @param {Object} options - { memoryBudget, maxConcurrentLoads }

     * @returns {Promise<VGPUStreamingManager>}

     */

    createStreamingManager(options = {}) {

        const generation = this._factoryGeneration;

        let factoryAuthorities;

        let effectiveOptions;

        try {

            factoryAuthorities = captureFactoryEntryAuthorities(this, generation, [{

                name: 'initialize',

                receiver: VGPUStreamingManager.prototype,

                key: 'init',

                operation: 'streaming manager initialization',

            }]);

            Reflect.apply(
                factoryAuthorities.assertAlive.callable,
                factoryAuthorities.assertAlive.receiver,
                [generation],
            );

            effectiveOptions = this._snapshotStreamingFactoryOptions(options, generation);

        } catch (error) {

            return rejectVgpuPromise(error);

        }

        const descriptorKey = stableDescriptorKey(effectiveOptions);

        return Reflect.apply(factoryAuthorities.start.callable, factoryAuthorities.start.receiver, [{

            key: 'streaming-manager',

            label: 'streaming manager',

            slot: '_streaming',

            descriptorKey,

            create: () => Reflect.apply(
                factoryAuthorities.construct.callable,
                factoryAuthorities.construct.receiver,
                [VGPUStreamingManager],
            ),

            initialize: (_streaming, authority) => Reflect.apply(
                authority.callable, authority.receiver, [effectiveOptions],
            ),

            initializeAuthority: factoryAuthorities.initialize,

            factoryAuthorities,

        }]);

    }



    /**

     * Create debug draw system for visualization

     * @param {string} colorFormat - Render target format

     * @param {string} depthFormat - Depth buffer format

     * @returns {Promise<VGPUDebugDraw>}

     */

    createDebugDraw(colorFormat = 'rgba8unorm', depthFormat = 'depth24plus') {

        const generation = this._factoryGeneration;

        let factoryAuthorities;

        let stableColorFormat;

        let stableDepthFormat;

        try {

            factoryAuthorities = captureFactoryEntryAuthorities(this, generation, [{

                name: 'initialize',

                receiver: VGPUDebugDraw.prototype,

                key: 'init',

                operation: 'debug draw initialization',

            }]);

            Reflect.apply(
                factoryAuthorities.assertAlive.callable,
                factoryAuthorities.assertAlive.receiver,
                [generation],
            );

            stableColorFormat = this._normalizeFactoryValue(colorFormat, String, generation);

            stableDepthFormat = this._normalizeFactoryValue(depthFormat, String, generation);

        } catch (error) {

            return rejectVgpuPromise(error);

        }

        return Reflect.apply(factoryAuthorities.start.callable, factoryAuthorities.start.receiver, [{

            key: Symbol('debug-draw'),

            label: 'debug draw',

            descriptorKey: stableDescriptorKey({

                colorFormat: stableColorFormat, depthFormat: stableDepthFormat,

            }),

            create: () => Reflect.apply(
                factoryAuthorities.construct.callable,
                factoryAuthorities.construct.receiver,
                [VGPUDebugDraw],
            ),

            initialize: (_debug, authority) => Reflect.apply(
                authority.callable, authority.receiver,
                [stableColorFormat, stableDepthFormat],
            ),

            initializeAuthority: factoryAuthorities.initialize,

            factoryAuthorities,

        }]);

    }



    /**

     * Get or create a shared debug draw instance

     * @returns {Promise<VGPUDebugDraw>}

     */

    getDebugDraw(colorFormat = 'rgba8unorm', depthFormat = 'depth24plus') {

        const generation = this._factoryGeneration;

        let factoryAuthorities;

        let stableColorFormat;

        let stableDepthFormat;

        try {

            factoryAuthorities = captureFactoryEntryAuthorities(this, generation, [{

                name: 'initialize',

                receiver: VGPUDebugDraw.prototype,

                key: 'init',

                operation: 'shared debug draw initialization',

            }]);

            Reflect.apply(
                factoryAuthorities.assertAlive.callable,
                factoryAuthorities.assertAlive.receiver,
                [generation],
            );

            stableColorFormat = this._normalizeFactoryValue(colorFormat, String, generation);

            stableDepthFormat = this._normalizeFactoryValue(depthFormat, String, generation);

        } catch (error) {

            return rejectVgpuPromise(error);

        }

        return Reflect.apply(factoryAuthorities.start.callable, factoryAuthorities.start.receiver, [{

            key: 'shared-debug-draw',

            label: 'shared debug draw',

            slot: '_debugDraw',

            descriptorKey: stableDescriptorKey({

                colorFormat: stableColorFormat, depthFormat: stableDepthFormat,

            }),

            create: () => Reflect.apply(
                factoryAuthorities.construct.callable,
                factoryAuthorities.construct.receiver,
                [VGPUDebugDraw],
            ),

            initialize: (_debug, authority) => Reflect.apply(
                authority.callable, authority.receiver,
                [stableColorFormat, stableDepthFormat],
            ),

            initializeAuthority: factoryAuthorities.initialize,

            factoryAuthorities,

        }]);

    }

}



// ============================================================================

// SINGLETON / GLOBAL ACCESS

// ============================================================================



let globalVGPU = null;

let globalVGPUDescriptor = null;

let globalVGPUOperation = null;

let globalVGPUEpoch = 0;

let globalRequestObjectId = 0;

const globalRequestObjectIds = new VGPU_NATIVE_WEAK_MAP();

const globalNormalizationOperations = new VGPU_NATIVE_SET();



function requestObjectIdentity(value) {

    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;

    let identity = Reflect.apply(VGPU_WEAK_MAP_GET, globalRequestObjectIds, [value]);

    if (!identity) {

        identity = ++globalRequestObjectId;

        Reflect.apply(VGPU_WEAK_MAP_SET, globalRequestObjectIds, [value, identity]);

    }

    return identity;

}



function assertGlobalNormalizationCurrent(operation) {

    if (

        !operation

        || operation.revoked

        || !Reflect.apply(VGPU_SET_HAS, globalNormalizationOperations, [operation])

        || operation.epoch !== globalVGPUEpoch

    ) throw globalVGPULifecycleError(operation?.reason || 'invalidated during request normalization');

}



function readGlobalNormalizationValue(operation, target, key) {

    let value;

    try { value = Reflect.get(target, key); } finally { assertGlobalNormalizationCurrent(operation); }

    return value;

}



function captureGlobalNormalizationPropertySlot(operation, target, key) {

    assertGlobalNormalizationCurrent(operation);

    let cursor = target;

    const visited = new VGPU_NATIVE_SET();

    while (cursor && !Reflect.apply(VGPU_SET_HAS, visited, [cursor])) {

        Reflect.apply(VGPU_SET_ADD, visited, [cursor]);

        let descriptor;

        try { descriptor = Reflect.getOwnPropertyDescriptor(cursor, key); }

        finally { assertGlobalNormalizationCurrent(operation); }

        if (descriptor) return Object.freeze({

            receiver: target,

            key,

            descriptor: Object.freeze({ ...descriptor }),

        });

        try { cursor = Reflect.getPrototypeOf(cursor); }

        finally { assertGlobalNormalizationCurrent(operation); }

    }

    return Object.freeze({ receiver: target, key, descriptor: null });

}



function readGlobalNormalizationPropertySlot(operation, slot) {

    const descriptor = slot.descriptor;

    if (!descriptor) {

        assertGlobalNormalizationCurrent(operation);

        return undefined;

    }

    let value;

    try {

        value = 'value' in descriptor

            ? descriptor.value

            : (typeof descriptor.get === 'function'

                ? Reflect.apply(descriptor.get, slot.receiver, [])

                : undefined);

    } finally { assertGlobalNormalizationCurrent(operation); }

    return value;

}



function normalizeGlobalValue(operation, value, normalize = String) {

    let normalized;

    try { normalized = normalize(value); } finally { assertGlobalNormalizationCurrent(operation); }

    return normalized;

}



function normalizedRequestValue(operation, value, seen = new WeakMap()) {

    assertGlobalNormalizationCurrent(operation);

    if (value === null || typeof value !== 'object') return value;

    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {

        const result = [];

        seen.set(value, result);

        const length = normalizeGlobalValue(

            operation, readGlobalNormalizationValue(operation, value, 'length'), Number,

        );

        if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('[vGPU] Invalid request array');

        for (let index = 0; index < length; index++) {

            const item = readGlobalNormalizationValue(operation, value, index);

            result.push(normalizedRequestValue(operation, item, seen));

        }

        return Object.freeze(result);

    }

    const result = {};

    seen.set(value, result);

    let keys;

    try { keys = Reflect.ownKeys(value); } finally { assertGlobalNormalizationCurrent(operation); }

    const names = keys.filter(key => typeof key === 'string').sort();

    for (const name of names) {

        let descriptor;

        try { descriptor = Reflect.getOwnPropertyDescriptor(value, name); } finally {

            assertGlobalNormalizationCurrent(operation);

        }

        if (!descriptor?.enumerable) continue;

        const member = readGlobalNormalizationValue(operation, value, name);

        if (member === undefined) continue;

        result[name] = normalizedRequestValue(operation, member, seen);

    }

    return Object.freeze(result);

}



function snapshotGlobalRequestIterable(operation, source) {

    if (source == null) return Object.freeze([]);

    const iteratorMethod = readGlobalNormalizationValue(operation, source, Symbol.iterator);

    if (typeof iteratorMethod !== 'function') throw new TypeError('[vGPU] Feature request must be iterable');

    let iterator;

    try { iterator = Reflect.apply(iteratorMethod, source, []); } finally {

        assertGlobalNormalizationCurrent(operation);

    }

    const next = readGlobalNormalizationValue(operation, iterator, 'next');

    if (typeof next !== 'function') throw new TypeError('[vGPU] Feature iterator is invalid');

    const result = [];

    while (true) {

        let step;

        try { step = Reflect.apply(next, iterator, []); } finally { assertGlobalNormalizationCurrent(operation); }

        const done = Boolean(readGlobalNormalizationValue(operation, step, 'done'));

        if (done) break;

        result.push(normalizeGlobalValue(

            operation, readGlobalNormalizationValue(operation, step, 'value'), String,

        ));

    }

    return Object.freeze(result);

}



function snapshotGlobalDeviceInput(operation, source) {

    if (source == null) return Object.freeze({

        rawDevice: null, deviceInput: null, inputSnapshot: null,

    });

    if (source instanceof VirtualGPU) {

        const deviceSlot = captureGlobalNormalizationPropertySlot(

            operation, source, 'device',

        );

        const gpuDeviceSlot = captureGlobalNormalizationPropertySlot(

            operation, source, 'gpuDevice',

        );

        const rawDevice = readGlobalNormalizationPropertySlot(operation, deviceSlot);

        const deviceInput = readGlobalNormalizationPropertySlot(operation, gpuDeviceSlot);

        return Object.freeze({

            rawDevice,

            deviceInput,

            inputSnapshot: Object.freeze({ rawDevice, normalized: deviceInput }),

        });

    }

    const isObject = typeof source === 'object' || typeof source === 'function';

    const values = {};

    const sourceKeys = [

        'getDevice', 'device', 'queue', 'adapter', 'limits', 'features',

        'generation', 'capabilities', 'onDeviceLost', 'removeDeviceLostHandler',

        'lost',

    ];

    const sourceSlots = {};

    let lostThen = null;

    if (isObject) {

        for (const key of sourceKeys) {

            sourceSlots[key] = captureGlobalNormalizationPropertySlot(

                operation, source, key,

            );

        }

        const lostDescriptor = sourceSlots.lost.descriptor;

        if (lostDescriptor && 'value' in lostDescriptor && lostDescriptor.value) {

            const thenSlot = captureGlobalNormalizationPropertySlot(

                operation, lostDescriptor.value, 'then',

            );

            lostThen = readGlobalNormalizationPropertySlot(operation, thenSlot);

        }

        values.lost = readGlobalNormalizationPropertySlot(operation, sourceSlots.lost);

        if (lostThen === null && values.lost) {

            const thenSlot = captureGlobalNormalizationPropertySlot(

                operation, values.lost, 'then',

            );

            lostThen = readGlobalNormalizationPropertySlot(operation, thenSlot);

        }

        values.getDevice = readGlobalNormalizationPropertySlot(

            operation, sourceSlots.getDevice,

        );

        values.device = readGlobalNormalizationPropertySlot(operation, sourceSlots.device);

    }

    const getDevice = values.getDevice;

    const directDevice = values.device;

    let rawDevice;

    if (typeof getDevice === 'function') {

        assertGlobalNormalizationCurrent(operation);

        try { rawDevice = Reflect.apply(getDevice, source, []); } finally {

            assertGlobalNormalizationCurrent(operation);

        }

    } else {

        rawDevice = directDevice || source || null;

    }

    if (!rawDevice) return Object.freeze({

        rawDevice: null, deviceInput: null, inputSnapshot: null,

    });

    const sourceIsRaw = source === rawDevice;

    const rawValues = {};

    if (sourceIsRaw) {

        rawValues.lost = values.lost;

        for (const key of ['queue', 'limits', 'features']) {

            values[key] = readGlobalNormalizationPropertySlot(operation, sourceSlots[key]);

            rawValues[key] = values[key];

        }

    } else {

        const rawKeys = ['queue', 'limits', 'features', 'lost'];

        const rawSlots = {};

        for (const key of rawKeys) {

            rawSlots[key] = captureGlobalNormalizationPropertySlot(

                operation, rawDevice, key,

            );

        }

        const lostDescriptor = rawSlots.lost.descriptor;

        if (lostDescriptor && 'value' in lostDescriptor && lostDescriptor.value) {

            const thenSlot = captureGlobalNormalizationPropertySlot(

                operation, lostDescriptor.value, 'then',

            );

            lostThen = readGlobalNormalizationPropertySlot(operation, thenSlot);

        }

        rawValues.lost = readGlobalNormalizationPropertySlot(operation, rawSlots.lost);

        if (lostThen === null && rawValues.lost) {

            const thenSlot = captureGlobalNormalizationPropertySlot(

                operation, rawValues.lost, 'then',

            );

            lostThen = readGlobalNormalizationPropertySlot(operation, thenSlot);

        }

        for (const key of ['queue', 'limits', 'features']) {

            rawValues[key] = readGlobalNormalizationPropertySlot(operation, rawSlots[key]);

        }

    }

    if (isObject) {

        for (const key of [

            'queue', 'adapter', 'limits', 'features', 'generation', 'capabilities',

            'onDeviceLost', 'removeDeviceLostHandler',

        ]) {

            if (!(key in values)) {

                values[key] = readGlobalNormalizationPropertySlot(operation, sourceSlots[key]);

            }

        }

    }

    const inputSnapshot = Object.freeze({

        rawDevice,

        normalized: null,

        source,

        wrapperMatches: directDevice === rawDevice,

        values: Object.freeze(values),

        rawValues: Object.freeze(rawValues),

        lostThen,

    });

    return Object.freeze({ rawDevice, deviceInput: source, inputSnapshot });

}



function normalizeGlobalVGPURequest(options) {

    const operation = {

        epoch: globalVGPUEpoch,

        revoked: false,

        reason: null,

    };

    Reflect.apply(VGPU_SET_ADD, globalNormalizationOperations, [operation]);

    try {

        const input = options ?? {};

        assertGlobalNormalizationCurrent(operation);

        const values = {};

        const inputKeys = [

            'device', 'deviceDescriptor', 'requiredFeatures', 'requiredLimits',

            'optionalFeatures', 'adapterOptions', 'profile', 'label', 'verbose',

        ];

        const inputSlots = {};

        for (const key of inputKeys) {

            inputSlots[key] = captureGlobalNormalizationPropertySlot(

                operation, input, key,

            );

        }

        values.device = readGlobalNormalizationPropertySlot(operation, inputSlots.device);

        const deviceSnapshot = snapshotGlobalDeviceInput(operation, values.device);

        const { rawDevice, deviceInput, inputSnapshot } = deviceSnapshot;

        for (const key of inputKeys) {

            if (key === 'device') continue;

            values[key] = readGlobalNormalizationPropertySlot(operation, inputSlots[key]);

        }

        const suppliedDescriptor = values.deviceDescriptor || null;

        const suppliedDescriptorValue = normalizedRequestValue(operation, suppliedDescriptor || {});

        const descriptorFeatures = suppliedDescriptorValue.requiredFeatures || [];

        const requiredFeatures = [...new Set([

            ...snapshotGlobalRequestIterable(operation, descriptorFeatures),

            ...snapshotGlobalRequestIterable(operation, values.requiredFeatures || []),

        ])].sort();

        assertGlobalNormalizationCurrent(operation);

        const requiredLimits = Object.freeze({

            ...(suppliedDescriptorValue.requiredLimits || {}),

            ...normalizedRequestValue(operation, values.requiredLimits || {}),

        });

        const optionalFeatures = suppliedDescriptor

            ? []

            : [...new Set(snapshotGlobalRequestIterable(

                operation, values.optionalFeatures || [],

            ))].sort();

        assertGlobalNormalizationCurrent(operation);

        const adapterOptions = normalizedRequestValue(operation, values.adapterOptions || {});

        const profile = values.profile == null

            ? 'default'

            : normalizeGlobalValue(operation, values.profile, String);

        const rawLabel = values.label ?? suppliedDescriptorValue.label ?? null;

        const label = rawLabel == null ? null : normalizeGlobalValue(operation, rawLabel, String);

    const descriptor = {

        deviceIdentity: requestObjectIdentity(rawDevice),

        profile,

        adapterOptions,

        suppliedDescriptor: Boolean(suppliedDescriptor),

        deviceDescriptor: suppliedDescriptorValue,

        requiredFeatures,

        requiredLimits,

        optionalFeatures,

        label,

    };

        const wildcard = !rawDevice

        && profile === 'default'

        && Object.keys(adapterOptions).length === 0

        && !suppliedDescriptor

        && requiredFeatures.length === 0

        && Object.keys(requiredLimits).length === 0

        && optionalFeatures.length === 0

        && label === null;

        const createOptions = {};

        if (values.profile !== undefined) createOptions.profile = profile;

    if (Object.keys(adapterOptions).length > 0) createOptions.adapterOptions = adapterOptions;

    if (suppliedDescriptor) createOptions.deviceDescriptor = suppliedDescriptorValue;

    if (requiredFeatures.length > 0) createOptions.requiredFeatures = requiredFeatures;

    if (Object.keys(requiredLimits).length > 0) createOptions.requiredLimits = requiredLimits;

    if (optionalFeatures.length > 0) createOptions.optionalFeatures = optionalFeatures;

        if (values.label !== undefined) createOptions.label = label;

        if (values.verbose !== undefined) createOptions.verbose = Boolean(values.verbose);

        assertGlobalNormalizationCurrent(operation);

        return Object.freeze({

        key: stableDescriptorKey(descriptor),

        wildcard,

        rawDevice,

        descriptor,

        createOptions,

            deviceInput,

            inputSnapshot,

        });

    } finally {

        Reflect.apply(VGPU_SET_DELETE, globalNormalizationOperations, [operation]);

    }

}



function globalVGPUOptionsMismatch() {

    const error = new Error('[vGPU] Global instance already has incompatible acquisition options');

    error.code = 'VGPU_GLOBAL_OPTIONS_MISMATCH';

    return error;

}



function globalVGPULifecycleError(reason = 'superseded') {

    const error = new Error(`[vGPU] Global acquisition ${reason}`);

    error.name = 'AbortError';

    error.code = 'VGPU_GLOBAL_ACQUISITION_INVALIDATED';

    return error;

}



function requestCapabilitiesSatisfied(candidate, request, assertCurrent = null) {

    const fence = () => assertCurrent?.();

    fence();

    let features = candidate?.features;

    fence();

    if (!features) {

        const device = candidate?.device;

        fence();

        features = device?.features;

        fence();

    }

    features ||= new Set();

    const hasFeature = captureVgpuCallable(features, 'has');

    fence();

    for (const feature of request.descriptor.requiredFeatures) {

        const supported = hasFeature

            ? Reflect.apply(hasFeature.callable, hasFeature.receiver, [feature])

            : false;

        fence();

        if (!supported) return false;

    }

    let limits = candidate?.limits;

    fence();

    if (!limits) {

        const device = candidate?.device;

        fence();

        limits = device?.limits;

        fence();

    }

    limits ||= {};

    for (const [name, required] of Object.entries(request.descriptor.requiredLimits)) {

        const rawLimit = limits[name];

        fence();

        const numericLimit = Number(rawLimit);

        fence();

        if (!Number.isFinite(numericLimit) || numericLimit < Number(required)) return false;

    }

    return true;

}



function globalRequestCompatible(request, descriptor, candidate, assertCurrent = null) {

    assertCurrent?.();

    if (request.wildcard) return true;

    let candidateDevice = null;

    if (request.rawDevice) {

        candidateDevice = candidate?.device;

        assertCurrent?.();

        if (request.rawDevice !== candidateDevice) return false;

    }

    if (!requestCapabilitiesSatisfied(candidate, request, assertCurrent)) return false;

    assertCurrent?.();

    if (descriptor?.key === request.key) return true;

    return Boolean(request.rawDevice && request.rawDevice === candidateDevice);

}



function globalAliasSnapshotCurrent(candidate, descriptor, epoch) {

    if (

        !candidate

        || epoch !== globalVGPUEpoch

        || globalVGPU !== candidate

        || globalVGPUDescriptor !== descriptor

    ) return false;

    const destroyed = Boolean(candidate._destroyed);

    return !destroyed

        && epoch === globalVGPUEpoch

        && globalVGPU === candidate

        && globalVGPUDescriptor === descriptor;

}



function globalOperationAccepts(operation, request) {

    return request.wildcard
        || getVgpuOperationIdentity(operation, 'request')?.key === request.key;

}



function isGlobalOperationCurrent(operation) {

    return Boolean(operation)

        && !isVgpuOperationSettled(operation)

        && getVgpuOperationIdentity(operation, 'epoch') === globalVGPUEpoch

        && globalVGPUOperation === operation;

}



function settleGlobalOperation(operation, value, error) {

    if (!claimVgpuOperationSettlement(operation)) return false;

    if (globalVGPUOperation === operation) globalVGPUOperation = null;

    invokeVgpuSettlementAuthority(operation, Boolean(error), error || value);

    return true;

}



function retireGlobalCandidate(
    operation, candidate = getVgpuOperationPrivateValue(operation, 'candidate'),
) {

    if (!operation || !candidate || !getVgpuOperationPrivateValue(operation, 'retireCandidate')) return;

    const retiredCandidates = getVgpuOperationPrivateValue(operation, 'retiredCandidates');

    if (Reflect.apply(VGPU_WEAK_SET_HAS, retiredCandidates, [candidate])) return;

    Reflect.apply(VGPU_WEAK_SET_ADD, retiredCandidates, [candidate]);

    if (globalVGPU === candidate) return;

    const currentCandidate = getVgpuOperationPrivateValue(operation, 'candidate');

    const cleanup = candidate === currentCandidate
        ? getVgpuOperationPrivateValue(operation, 'candidateCleanup')
        : null;

    if (cleanup) safeCoreCleanup(cleanup);

    if (currentCandidate === candidate) {
        setVgpuOperationPrivateValue(operation, 'candidate', null);
        setVgpuOperationPrivateValue(operation, 'candidateCleanup', null);
    }

}



function supersedeGlobalOperation(reason = 'superseded') {

    globalVGPUEpoch++;

    for (const normalization of globalNormalizationOperations) {

        normalization.revoked = true;

        normalization.reason = reason;

    }

    const operation = globalVGPUOperation;

    if (!operation) return false;

    globalVGPUOperation = null;

    retireGlobalCandidate(operation);

    return settleGlobalOperation(operation, null, globalVGPULifecycleError(reason));

}



function replaceCompatibilityAlias(
    candidate, reason = 'compatibility alias changed', descriptor = null,
    assertExternalCurrent = null,
) {

    let candidateSnapshot = null;

    let nextDescriptor = null;

    const assertCandidateCurrent = () => {
        if (!candidateSnapshot) return;
        const current = snapshotVgpuFacadeAuthority(candidate);
        if (!current
            || current.facadeState !== candidateSnapshot.facadeState
            || current.record !== candidateSnapshot.record
            || current.recordState !== candidateSnapshot.recordState
            || current.coreAuthorities !== candidateSnapshot.coreAuthorities
            || current.rawDevice !== candidateSnapshot.rawDevice) {
            throw generationInvalidatedError(
                candidateSnapshot.recordState.generation,
                candidateSnapshot.recordState.reason || 'compatibility publication invalidated',
            );
        }
    };

    const assertPublicationCurrent = () => {
        assertCandidateCurrent();
        if (assertExternalCurrent) assertExternalCurrent();
    };

    if (candidate) {
        candidateSnapshot = snapshotVgpuFacadeAuthority(candidate);
        if (!candidateSnapshot) {
            throw new TypeError('[vGPU] Compatibility candidate has no active registry identity');
        }
        assertPublicationCurrent();
        nextDescriptor = descriptor || normalizeGlobalVGPURequest({
            device: candidateSnapshot.rawDevice,
        });
        assertPublicationCurrent();
    }

    const publicationEpoch = globalVGPUEpoch + 1;

    supersedeGlobalOperation(reason);

    if (globalVGPUEpoch !== publicationEpoch) {

        throw globalVGPULifecycleError(

            'compatibility alias changed during publication',

        );

    }

    assertPublicationCurrent();

    globalVGPU = candidate || null;

    globalVGPUDescriptor = candidate ? nextDescriptor : null;

    assertPublicationCurrent();

    return candidate;

}



function invalidateCompatibilityAlias(candidate, reason = 'invalidated') {

    const operation = globalVGPUOperation;

    const operationMatches = operation

        ? getVgpuOperationPrivateValue(operation, 'candidate') === candidate

        : false;

    const aliasMatches = globalVGPU === candidate;

    if (!operationMatches && !aliasMatches) return false;

    const invalidationEpoch = globalVGPUEpoch + 1;

    supersedeGlobalOperation(reason);

    if (aliasMatches

        && globalVGPUEpoch === invalidationEpoch

        && globalVGPU === candidate) {

        globalVGPU = null;

        globalVGPUDescriptor = null;

    }

    return true;

}



function publishCompatibilityAlias(candidate) {

    if (candidate?._destroyed) {

        throw generationInvalidatedError(candidate.generation, candidate._destroyReason);

    }

    if (!globalVGPU || globalVGPU._destroyed) {

        replaceCompatibilityAlias(candidate, 'superseded by initVGPU');

    } else if (globalVGPU === candidate && globalVGPUOperation) {

        supersedeGlobalOperation('superseded by initVGPU');

    }

    return candidate;

}



/**

 * Get or create the global vGPU instance

 */

export function getVGPU(options) {

    let factoryAuthorities;

    let request;

    try {

        factoryAuthorities = captureVgpuCallableSet([

            {
                name: 'fromDevice',
                receiver: VirtualGPU,
                key: 'fromDevice',
                operation: 'VirtualGPU device wrapping',
            },

            {
                name: 'create',
                receiver: VirtualGPU,
                key: 'create',
                operation: 'VirtualGPU creation',
            },

        ]);

        request = normalizeGlobalVGPURequest(options);

    } catch (error) {

        return rejectVgpuPromise(error);

    }

    if (globalVGPUOperation) {

        if (!globalOperationAccepts(globalVGPUOperation, request)) {

            return rejectVgpuPromise(globalVGPUOptionsMismatch());

        }

        return globalVGPUOperation.promise;

    }

    const aliasCandidate = globalVGPU;

    const aliasDescriptor = globalVGPUDescriptor;

    const aliasEpoch = globalVGPUEpoch;

    let aliasDestroyed = true;

    if (aliasCandidate) {

        try {

            aliasDestroyed = Boolean(aliasCandidate._destroyed);

        } catch (error) {

            return rejectVgpuPromise(error);

        }

        if (

            aliasEpoch !== globalVGPUEpoch

            || globalVGPU !== aliasCandidate

            || globalVGPUDescriptor !== aliasDescriptor

        ) {

            return rejectVgpuPromise(
                globalVGPULifecycleError('compatibility alias changed during validation'),
            );

        }

    }

    if (aliasCandidate && !aliasDestroyed) {

        const assertAliasCurrent = () => {

            if (!globalAliasSnapshotCurrent(aliasCandidate, aliasDescriptor, aliasEpoch)) {

                throw globalVGPULifecycleError('compatibility alias changed during validation');

            }

        };

        try {

            assertAliasCurrent();

            if (!globalRequestCompatible(request, aliasDescriptor, aliasCandidate, assertAliasCurrent)) {

                return rejectVgpuPromise(globalVGPUOptionsMismatch());

            }

            assertAliasCurrent();

        } catch (error) {

            return rejectVgpuPromise(error);

        }

        let resolvePublic;

        let rejectPublic;

        const operation = {

            request,

            epoch: aliasEpoch,

            candidate: aliasCandidate,

            descriptor: aliasDescriptor,

            retireCandidate: false,

            retiredCandidates: new VGPU_NATIVE_WEAK_SET(),

            settled: false,

            promise: null,

        };

        operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

        setVgpuOperationPrivateValue(operation, 'candidate', aliasCandidate);

        setVgpuOperationPrivateValue(operation, 'candidateCleanup', null);

        setVgpuOperationPrivateValue(operation, 'retireCandidate', false);

        setVgpuOperationPrivateValue(
            operation, 'retiredCandidates', new VGPU_NATIVE_WEAK_SET(),
        );

        silenceVgpuPromise(getVgpuOperationPromise(operation));

        try {

            assertAliasCurrent();

        } catch (error) {

            if (claimVgpuOperationSettlement(operation)) {
                invokeVgpuSettlementAuthority(operation, true, error);
            }

            return getVgpuOperationPromise(operation);

        }

        globalVGPUOperation = operation;

        queueVgpuMicrotask(() => {

            if (

                !isGlobalOperationCurrent(operation)

                || !globalAliasSnapshotCurrent(
                    getVgpuOperationPrivateValue(operation, 'candidate'),
                    getVgpuOperationIdentity(operation, 'descriptor'),
                    getVgpuOperationIdentity(operation, 'epoch'),
                )

            ) {

                if (!isVgpuOperationSettled(operation)) {
                    settleGlobalOperation(
                        operation, null, globalVGPULifecycleError('invalidated'),
                    );
                }

                return;

            }

            settleGlobalOperation(
                operation, getVgpuOperationPrivateValue(operation, 'candidate'), null,
            );

        });

        return getVgpuOperationPromise(operation);

    }

    let resolvePublic;

    let rejectPublic;

    const operation = {

        request,

        epoch: globalVGPUEpoch,

        candidate: null,

        candidateCleanup: null,

        retireCandidate: false,

        retiredCandidates: new VGPU_NATIVE_WEAK_SET(),

        settled: false,

        promise: null,

    };

    operation.promise = new VGPU_NATIVE_PROMISE((resolve, reject) => {

        resolvePublic = resolve;

        rejectPublic = reject;

    });

    operation.resolve = resolvePublic;

    operation.reject = rejectPublic;

    installVgpuSettlementAuthorities(operation, resolvePublic, rejectPublic);

    setVgpuOperationPrivateValue(operation, 'candidate', null);

    setVgpuOperationPrivateValue(operation, 'candidateCleanup', null);

    setVgpuOperationPrivateValue(operation, 'retireCandidate', false);

    setVgpuOperationPrivateValue(
        operation, 'retiredCandidates', new VGPU_NATIVE_WEAK_SET(),
    );

    silenceVgpuPromise(getVgpuOperationPromise(operation));

    globalVGPUOperation = operation;

    let rawPromise;

    try {

        if (request.rawDevice) {

            const existing = getVgpuRegistryRecord(request.rawDevice);

            if (existing?.active) {

                rawPromise = resolveVgpuPromise({
                    candidate: existing.vgpu, adoptedByThisOperation: false,
                });

            } else {

                const candidate = Reflect.apply(

                    factoryAuthorities.fromDevice.callable,

                    factoryAuthorities.fromDevice.receiver,

                    [normalizeGpuDeviceInput(request.deviceInput, request.inputSnapshot)],

                );

                rawPromise = resolveVgpuPromise({
                    candidate,
                    adoptedByThisOperation: true,
                    candidateCleanup: captureCoreCleanup(candidate, ['destroy']),
                });

            }

        } else {

            const provenance = {

                candidate: null,

                adoptedByThisOperation: false,

            };

            const createOptions = { ...request.createOptions };

            createOptions[VGPU_CREATE_PROVENANCE] = provenance;

            rawPromise = thenVgpuPromise(
                resolveVgpuPromise(Reflect.apply(
                    factoryAuthorities.create.callable,
                    factoryAuthorities.create.receiver,
                    [createOptions],
                )),
                candidate => {
                    const adoptedByThisOperation = Boolean(
                        provenance.adoptedByThisOperation
                        && provenance.candidate === candidate
                    );
                    return {
                        candidate,
                        adoptedByThisOperation,
                        candidateCleanup: adoptedByThisOperation
                            ? captureCoreCleanup(candidate, ['destroy'])
                            : null,
                    };
                },
            );

        }

    } catch (error) {

        settleGlobalOperation(operation, null, error);

        return getVgpuOperationPromise(operation);

    }

    void thenVgpuPromise(rawPromise,

        ({ candidate, adoptedByThisOperation, candidateCleanup = null }) => {

            setVgpuOperationPrivateValue(operation, 'candidate', candidate);

            setVgpuOperationPrivateValue(
                operation, 'retireCandidate', Boolean(adoptedByThisOperation),
            );

            setVgpuOperationPrivateValue(operation, 'candidateCleanup', candidateCleanup);

            try {
                if (!isGlobalOperationCurrent(operation)) {
                    retireGlobalCandidate(operation, candidate);
                    return;
                }

                if (!candidate || candidate._destroyed) {
                    retireGlobalCandidate(operation, candidate);
                    settleGlobalOperation(
                        operation,
                        null,
                        generationInvalidatedError(
                            candidate?.generation,
                            candidate?._destroyReason || 'destroyed before publication',
                        ),
                    );
                    return;
                }

                if (request.rawDevice && candidate.device !== request.rawDevice) {
                    retireGlobalCandidate(operation, candidate);
                    settleGlobalOperation(operation, null, globalVGPUOptionsMismatch());
                    return;
                }

                if (!requestCapabilitiesSatisfied(candidate, request)) {
                    retireGlobalCandidate(operation, candidate);
                    settleGlobalOperation(operation, null, globalVGPUOptionsMismatch());
                    return;
                }

                if (!isGlobalOperationCurrent(operation) || candidate._destroyed) {
                    retireGlobalCandidate(operation, candidate);
                    if (!isVgpuOperationSettled(operation)) {
                        settleGlobalOperation(
                            operation, null,
                            globalVGPULifecycleError('invalidated before publication'),
                        );
                    }
                    return;
                }

                if (globalVGPU && !globalVGPU._destroyed && globalVGPU !== candidate) {
                    retireGlobalCandidate(operation, candidate);
                    settleGlobalOperation(
                        operation, null,
                        globalVGPULifecycleError('lost publication authority'),
                    );
                    return;
                }

                globalVGPU = candidate;
                globalVGPUDescriptor = request;
                setVgpuOperationPrivateValue(operation, 'candidate', null);
                setVgpuOperationPrivateValue(operation, 'retireCandidate', false);
                setVgpuOperationPrivateValue(operation, 'candidateCleanup', null);
                settleGlobalOperation(operation, candidate, null);
                globalVGPUEpoch++;
            } catch (error) {
                retireGlobalCandidate(operation, candidate);
                if (!isVgpuOperationSettled(operation)) {
                    settleGlobalOperation(operation, null, error);
                }
            }

        },

        error => {

            if (isGlobalOperationCurrent(operation)) settleGlobalOperation(operation, null, error);

        },

    );

    return getVgpuOperationPromise(operation);

}



/**

 * Get existing vGPU instance (throws if not initialized)

 */

export function vgpu() {

    if (!globalVGPU || globalVGPU._destroyed) {

        throw new Error('[vGPU] Not initialized. Call getVGPU() first.');

    }

    return globalVGPU;

}



/**

 * Initialize vGPU from existing GpuDevice or raw GPUDevice

 * @param {GpuDevice|GPUDevice|Object} deviceOrOptions - GpuDevice wrapper, raw GPUDevice, or {device, queue, adapter}

 */

export function initVGPU(deviceOrOptions) {

    const factoryAuthorities = captureVgpuCallableSet([

        {
            name: 'fromDevice',
            receiver: VirtualGPU,
            key: 'fromDevice',
            operation: 'VirtualGPU device wrapping',
        },

    ]);

    // If already a VirtualGPU, return it

    if (deviceOrOptions instanceof VirtualGPU) {

        if (deviceOrOptions._destroyed) {

            throw generationInvalidatedError(deviceOrOptions.generation, deviceOrOptions._destroyReason);

        }

        return publishCompatibilityAlias(deviceOrOptions);

    }

    const inputSnapshot = snapshotGpuDeviceInput(deviceOrOptions);

    const existing = inputSnapshot.rawDevice
        ? getVgpuRegistryRecord(inputSnapshot.rawDevice)
        : null;

    const internal = existing?.active

        ? existing.vgpu

        : Reflect.apply(
            factoryAuthorities.fromDevice.callable,
            factoryAuthorities.fromDevice.receiver,
            [normalizeGpuDeviceInput(deviceOrOptions, inputSnapshot)],
        );

    return publishCompatibilityAlias(internal);

}



/**

 * Acquire an owner-scoped lease without transferring coordinator lifetime.

 * Legacy initVGPU() calls remain non-owning lookups.

 */

export function acquireVGPU(ownerId, deviceOrOptions = null) {

    const factoryAuthorities = captureVgpuCallableSet([

        {
            name: 'fromDevice',
            receiver: VirtualGPU,
            key: 'fromDevice',
            operation: 'VirtualGPU device wrapping',
        },

        {
            name: 'acquire',
            lookupReceiver: VirtualGPU.prototype,
            receiver: VirtualGPU.prototype,
            key: 'acquire',
            operation: 'VirtualGPU owner acquisition',
        },

    ]);

    let internal;

    if (deviceOrOptions === null || deviceOrOptions === undefined) {

        internal = vgpu();

    } else if (deviceOrOptions instanceof VirtualGPU) {

        internal = deviceOrOptions;

    } else {

        const inputSnapshot = snapshotGpuDeviceInput(deviceOrOptions);

        const existing = inputSnapshot.rawDevice
            ? getVgpuRegistryRecord(inputSnapshot.rawDevice)
            : null;

        internal = existing?.active

            ? existing.vgpu

            : Reflect.apply(
                factoryAuthorities.fromDevice.callable,
                factoryAuthorities.fromDevice.receiver,
                [normalizeGpuDeviceInput(deviceOrOptions, inputSnapshot)],
            );

    }

    return Reflect.apply(factoryAuthorities.acquire.callable, internal, [ownerId]);

}



/**

 * Invalidate one exact raw-device generation. This is coordinator authority;

 * owner leases deliberately do not expose it.

 */

export function invalidateVGPU(deviceOrOptions, options = {}) {

    const record = activeRecordFor(deviceOrOptions);

    if (!record?.active) return false;

    if (options.expectedGeneration !== undefined && options.expectedGeneration !== record.generation) {

        return false;

    }

    return invalidateVgpuRegistryRecord(

        record,

        options.reason || 'coordinator-invalidated',

        options.info || null,

    );

}



export function getVGPURegistryInfo(deviceOrOptions) {

    const record = activeRecordFor(deviceOrOptions);

    if (!record) return null;

    let leases = 0;

    const ownerScopes = snapshotVgpuPrivateMapValues(record, 'owners');

    for (const scope of ownerScopes) leases += scope.leaseCount;

    return Object.freeze({

        generation: record.generation,

        active: record.active,

        ownerCount: ownerScopes.length,

        leaseCount: leases,

        destroyed: record.vgpu._destroyed,

    });

}



/**

 * Build a two-phase recovery participant for GpuRuntimeCoordinator.

 * Staging creates the replacement graph without publishing it globally.

 */

export function createVGPURecoveryParticipant(options = {}) {

    const initialVGPU = options.initialVGPU || null;

    if (initialVGPU && !(initialVGPU instanceof VirtualGPU)) {

        throw new TypeError('[vGPU] initialVGPU must be a VirtualGPU instance');

    }

    // The compatibility alias is a lookup convenience, never an ownership
    // grant. Only an explicitly injected graph or a graph created by this
    // participant may be retired during recovery.
    let current = initialVGPU;

    let currentOwned = Boolean(initialVGPU);

    let managesCompatibilityAlias = Boolean(initialVGPU && globalVGPU === initialVGPU);

    let participantRevision = 0;

    const snapshotParticipantVgpu = snapshotVgpuFacadeAuthority;

    return Object.freeze({

        stageGpuRuntime(runtime = {}) {

            const stageRevision = participantRevision;

            const previous = current;

            const previousOwned = currentOwned;

            const previousManagedCompatibilityAlias = managesCompatibilityAlias;

            const assertStageCurrent = () => {
                if (participantRevision !== stageRevision
                    || current !== previous
                    || currentOwned !== previousOwned
                    || managesCompatibilityAlias !== previousManagedCompatibilityAlias) {
                    const error = new Error('[vGPU] Recovery stage was superseded');
                    error.code = 'VGPU_RECOVERY_STAGE_SUPERSEDED';
                    throw error;
                }
            };

            const snapshotStageProperties = (receiver, keys) => {
                assertStageCurrent();
                if (!receiver) return Object.freeze({});
                const slots = {};
                for (let index = 0; index < keys.length; index++) {
                    const key = keys[index];
                    try { slots[key] = captureVgpuPropertySlot(receiver, key); }
                    finally { assertStageCurrent(); }
                }
                const values = {};
                for (let index = 0; index < keys.length; index++) {
                    const key = keys[index];
                    try { values[key] = readVgpuPropertySlot(slots[key]); }
                    finally { assertStageCurrent(); }
                }
                return Object.freeze(values);
            };

            const factoryAuthorities = captureVgpuCallableSet([

                {
                    name: 'fromDevice',
                    receiver: VirtualGPU,
                    key: 'fromDevice',
                    operation: 'VirtualGPU coordinator wrapping',
                },

            ], assertStageCurrent);

            const previousCleanup = captureCoreCleanup(previous, ['destroy']);

            const runtimeSource = runtime ?? {};

            const runtimeValues = snapshotStageProperties(runtimeSource, [

                'generation', 'gpuDevice', 'device', 'adapter',

            ]);

            const runtimeGeneration = runtimeValues.generation;

            if (!Number.isSafeInteger(runtimeGeneration) || runtimeGeneration < 0) {

                throw new TypeError('[vGPU] staged GPU runtime requires a non-negative coordinator generation');

            }

            const runtimeGpuDevice = runtimeValues.gpuDevice || null;

            const runtimeDevice = runtimeValues.device || null;

            const runtimeDeviceValues = snapshotStageProperties(runtimeDevice, [

                'queue', 'limits', 'features',

            ]);

            const gpuDeviceValues = snapshotStageProperties(runtimeGpuDevice, [

                'getDevice', 'device', 'getQueue', 'queue', 'getAdapter', 'adapter',

                'limits', 'features', 'getCapabilities', 'capabilities',

                'onDeviceLost', 'removeDeviceLostHandler',

            ]);

            const callGpuDevice = (name, args = []) => {

                const callable = gpuDeviceValues[name];

                if (typeof callable !== 'function') return undefined;

                try { return Reflect.apply(callable, runtimeGpuDevice, args); }

                finally { assertStageCurrent(); }

            };

            const resolvedDevice = runtimeDevice

                || callGpuDevice('getDevice')

                || gpuDeviceValues.device;

            const deviceOrOptions = runtimeGpuDevice ? {

                device: resolvedDevice,

                queue: runtimeDeviceValues.queue || callGpuDevice('getQueue') || gpuDeviceValues.queue,

                adapter: runtimeValues.adapter || callGpuDevice('getAdapter') || gpuDeviceValues.adapter || null,

                limits: gpuDeviceValues.limits || runtimeDeviceValues.limits || {},

                features: gpuDeviceValues.features || runtimeDeviceValues.features || new Set(),

                capabilities: callGpuDevice('getCapabilities') || gpuDeviceValues.capabilities,

                generation: runtimeGeneration,

                onDeviceLost(handler) {

                    const callable = gpuDeviceValues.onDeviceLost;

                    if (typeof callable !== 'function') return undefined;

                    try { return Reflect.apply(callable, runtimeGpuDevice, [handler]); }

                    finally { assertStageCurrent(); }

                },

                removeDeviceLostHandler(handler) {

                    const callable = gpuDeviceValues.removeDeviceLostHandler;

                    if (typeof callable !== 'function') return undefined;

                    try { return Reflect.apply(callable, runtimeGpuDevice, [handler]); }

                    finally { assertStageCurrent(); }

                },

            } : {

                device: runtimeDevice,

                queue: runtimeDeviceValues.queue,

                adapter: runtimeValues.adapter || null,

                generation: runtimeGeneration,

            };

            let inputSnapshot;

            try { inputSnapshot = snapshotGpuDeviceInput(deviceOrOptions); }

            finally { assertStageCurrent(); }

            const existingRecord = inputSnapshot.rawDevice
                ? getVgpuRegistryRecord(inputSnapshot.rawDevice)
                : null;

            const existingRecordState = getVgpuRegistryRecordState(existingRecord);

            if (existingRecordState?.active
                && existingRecordState.generation !== runtimeGeneration) {

                const error = new Error(

                    `[vGPU] Device is already registered as generation ${existingRecordState.generation}; coordinator requested ${runtimeGeneration}`,

                );

                error.code = 'VGPU_COORDINATOR_GENERATION_MISMATCH';

                throw error;

            }

            let staged = null;

            try {
                if (existingRecordState?.active) staged = existingRecordState.vgpu;
                else {
                    let normalizedInput;
                    try { normalizedInput = normalizeGpuDeviceInput(deviceOrOptions, inputSnapshot); }
                    finally { assertStageCurrent(); }
                    staged = Reflect.apply(
                        factoryAuthorities.fromDevice.callable,
                        factoryAuthorities.fromDevice.receiver,
                        [normalizedInput],
                    );
                }
                assertStageCurrent();
            } catch (error) {
                if (staged && staged !== previous && !existingRecordState?.active) {
                    const stagedFacadeState = getVgpuFacadeLifecycleState(staged);
                    const stagedRecord = stagedFacadeState?.registryRecord || null;
                    const stagedState = getVgpuRegistryRecordState(stagedRecord);
                    safeCoreCleanup(captureCoreCleanup(staged, ['destroy']));
                    if (stagedRecord
                        && getVgpuRegistryRecord(stagedState?.rawDevice) === stagedRecord) {
                        deleteVgpuRegistryRecord(stagedState.rawDevice);
                    }
                }
                throw error;
            }

            const stagedCleanup = captureCoreCleanup(staged, ['destroy']);

            let disposition = 'staged';

            const replacesCurrent = previous !== staged;

            const stagedOwned = staged === previous ? previousOwned : !existingRecordState?.active;

            const stagedFacadeState = getVgpuFacadeLifecycleState(staged);

            const stagedRecord = stagedFacadeState?.registryRecord || null;

            const stagedRawDevice = getVgpuRegistryRecordState(stagedRecord)?.rawDevice || null;

            let stagedDiscarded = false;

            const discardStaged = () => {

                if (stagedDiscarded || !replacesCurrent || !stagedOwned) return false;

                stagedDiscarded = true;

                safeCoreCleanup(stagedCleanup);

                if (stagedRecord && getVgpuRegistryRecord(stagedRawDevice) === stagedRecord) {

                    deleteVgpuRegistryRecord(stagedRawDevice);

                }

                return true;

            };

            let stagedCompatibilityDescriptor;

            try {
                stagedCompatibilityDescriptor = normalizeGlobalVGPURequest({
                    device: stagedRawDevice,
                });
                assertStageCurrent();
            } catch (error) {
                discardStaged();
                throw error;
            }

            let publishedCompatibilityAlias = false;

            let previousCompatibilityAlias = null;

            let previousCompatibilityDescriptor = null;

            let committedRevision = null;

            return Object.freeze({

                commit() {

                    if (disposition !== 'staged') return false;

                    if (participantRevision !== stageRevision
                        || current !== previous
                        || currentOwned !== previousOwned
                        || managesCompatibilityAlias !== previousManagedCompatibilityAlias) {
                        disposition = 'rolled-back';
                        discardStaged();
                        return false;
                    }

                    disposition = 'committed';

                    current = staged;

                    currentOwned = stagedOwned;

                    participantRevision++;

                    committedRevision = participantRevision;

                    const assertCommitCurrent = () => {
                        if (participantRevision !== committedRevision || current !== staged) {
                            const error = new Error('[vGPU] Recovery commit was superseded');
                            error.code = 'VGPU_RECOVERY_COMMIT_SUPERSEDED';
                            throw error;
                        }
                    };

                    try {

                    const liveCompatibilityAlias = snapshotParticipantVgpu(globalVGPU)

                        ? globalVGPU

                        : null;

                    const mayPublishCompatibilityAlias = !liveCompatibilityAlias

                        || (previousManagedCompatibilityAlias && liveCompatibilityAlias === previous);

                    if (mayPublishCompatibilityAlias) {

                        previousCompatibilityAlias = liveCompatibilityAlias;

                        previousCompatibilityDescriptor = globalVGPUDescriptor;

                        replaceCompatibilityAlias(
                            staged,
                            'superseded by recovery commit',
                            stagedCompatibilityDescriptor,
                            assertCommitCurrent,
                        );

                        publishedCompatibilityAlias = true;

                        managesCompatibilityAlias = true;

                    } else {

                        managesCompatibilityAlias = false;

                    }

                    assertCommitCurrent();

                    } catch (error) {
                        if (participantRevision === committedRevision && current === staged) {
                            participantRevision++;
                            current = previous;
                            currentOwned = previousOwned;
                            managesCompatibilityAlias = previousManagedCompatibilityAlias;
                            disposition = 'rolled-back';
                            discardStaged();
                        } else {
                            disposition = 'stale';
                        }
                        throw error;
                    }

                    return true;

                },

                finalize() {

                    if (disposition !== 'committed') return false;

                    if (participantRevision !== committedRevision || current !== staged) {
                        disposition = 'stale';
                        return false;
                    }

                    disposition = 'finalized';

                    participantRevision++;

                    if (previousOwned && replacesCurrent && snapshotParticipantVgpu(previous)) {

                        try { safeCoreCleanup(previousCleanup); } catch (error) {

                            try {
                                console.warn('[vGPU] Retirement of the previous generation failed:', error);
                            } catch (_) {}

                        }

                    }

                    return true;

                },

                rollback() {

                    if (disposition === 'staged') {

                        disposition = 'rolled-back';

                        discardStaged();

                        return true;

                    }

                    if (disposition !== 'committed') return false;

                    if (participantRevision !== committedRevision || current !== staged) {
                        disposition = 'stale';
                        return false;
                    }

                    disposition = 'rolled-back';

                    participantRevision++;

                    const rollbackRevision = participantRevision;

                    const previousIsLive = Boolean(snapshotParticipantVgpu(previous));

                    current = previousIsLive ? previous : null;

                    currentOwned = Boolean(previousIsLive && previousOwned);

                    managesCompatibilityAlias = Boolean(

                        previousManagedCompatibilityAlias

                        && current === previous

                        && globalVGPU === previous,

                    );

                    const assertRollbackCurrent = () => {

                        if (participantRevision !== rollbackRevision
                            || current !== (previousIsLive ? previous : null)
                            || currentOwned !== Boolean(previousIsLive && previousOwned)) {

                            const error = new Error('[vGPU] Recovery rollback was superseded');

                            error.code = 'VGPU_RECOVERY_ROLLBACK_SUPERSEDED';

                            throw error;

                        }

                    };

                    if (publishedCompatibilityAlias && globalVGPU === staged) {

                        const restorableAlias = snapshotParticipantVgpu(previousCompatibilityAlias)

                            ? previousCompatibilityAlias

                            : null;

                        replaceCompatibilityAlias(

                            restorableAlias,

                            'superseded by recovery rollback',

                            restorableAlias ? previousCompatibilityDescriptor : null,

                            assertRollbackCurrent,

                        );

                        managesCompatibilityAlias = Boolean(

                            previousManagedCompatibilityAlias

                            && restorableAlias === previous,

                        );

                    }

                    assertRollbackCurrent();

                    discardStaged();

                    return true;

                },

            });

        },

        invalidateGpuRuntime(runtime = {}) {

            const invalidated = current;

            const invalidatedSnapshot = snapshotParticipantVgpu(invalidated);

            if (!invalidatedSnapshot) {

                return false;

            }

            const invalidationRevision = participantRevision;

            const invalidatedOwned = currentOwned;

            const invalidatedManagedCompatibilityAlias = managesCompatibilityAlias;

            const { facadeState, record: invalidatedRecord, recordState } = invalidatedSnapshot;

            const invalidatedRawDevice = recordState.rawDevice;

            const invalidatedGeneration = recordState.generation;

            const invalidateAuthority = recordState.invalidate;

            const teardownCleanup = captureCoreCleanup(invalidated, ['_teardown']);

            const assertInvalidationCurrent = () => {

                if (participantRevision !== invalidationRevision

                    || current !== invalidated

                    || currentOwned !== invalidatedOwned

                    || managesCompatibilityAlias !== invalidatedManagedCompatibilityAlias

                    || facadeState.destroyed

                    || facadeState.registryRecord !== invalidatedRecord

                    || recordState.active !== true

                    || recordState.vgpu !== invalidated

                    || getVgpuRegistryRecord(invalidatedRawDevice) !== invalidatedRecord) {

                    const error = new Error('[vGPU] Recovery invalidation was superseded');

                    error.code = 'VGPU_RECOVERY_INVALIDATION_SUPERSEDED';

                    throw error;

                }

            };

            const runtimeSource = runtime ?? {};

            const runtimeSlots = {};

            for (const key of ['device', 'generation', 'reason', 'info']) {

                try { runtimeSlots[key] = captureVgpuPropertySlot(runtimeSource, key); }

                finally { assertInvalidationCurrent(); }

            }

            const runtimeValues = {};

            for (const key of ['device', 'generation', 'reason', 'info']) {

                try { runtimeValues[key] = readVgpuPropertySlot(runtimeSlots[key]); }

                finally { assertInvalidationCurrent(); }

            }

            if (runtimeValues.device !== invalidatedRawDevice

                || runtimeValues.generation !== invalidatedGeneration) {

                return false;

            }

            const invalidationReason = runtimeValues.reason || 'coordinator-invalidated';

            const invalidationInfo = runtimeValues.info || null;

            participantRevision++;

            const invalidationClaimRevision = participantRevision;


            const assertInvalidationClaimed = () => {

                if (participantRevision !== invalidationClaimRevision || current !== null) {

                    const error = new Error('[vGPU] Recovery invalidation was superseded');

                    error.code = 'VGPU_RECOVERY_INVALIDATION_SUPERSEDED';

                    throw error;

                }

            };

            current = null;

            currentOwned = false;

            managesCompatibilityAlias = false;

            if (invalidatedManagedCompatibilityAlias && globalVGPU === invalidated) {

                try {

                    replaceCompatibilityAlias(

                        null,

                        invalidationReason,

                        null,

                        assertInvalidationClaimed,

                    );

                } catch (_) {}

            }

            if (!invalidatedOwned) return true;

            if (recordState.active && typeof invalidateAuthority === 'function') {

                Reflect.apply(invalidateAuthority, undefined, [

                    invalidationReason,

                    invalidationInfo,

                ]);

            } else if (!facadeState.destroyed) {

                safeCoreCleanup(teardownCleanup);

            }

            if (invalidatedRecord && getVgpuRegistryRecord(invalidatedRawDevice) === invalidatedRecord) {

                deleteVgpuRegistryRecord(invalidatedRawDevice);

            }

            return true;

        },

        getCurrentGeneration() {

            return snapshotParticipantVgpu(current)?.recordState.generation ?? null;

        },

    });

}



export default VirtualGPU;
