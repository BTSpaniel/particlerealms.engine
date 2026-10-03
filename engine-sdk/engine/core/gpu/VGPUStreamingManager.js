// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VGPUStreamingManager - Progressive resource loading and streaming
 * 
 * Features:
 * - Priority-based loading queue with distance/importance weighting
 * - Async texture streaming with mip-level progression
 * - Mesh LOD streaming
 * - Memory budget management
 * - Placeholder resources while loading
 * - Automatic eviction of unused resources
 * 
 * Usage:
 *   const streaming = new VGPUStreamingManager(vgpu);
 *   await streaming.init({ memoryBudget: 512 * 1024 * 1024 });
 *   
 *   const textureHandle = streaming.requestTexture('path/to/texture.png', { priority: 1.0 });
 *   const texture = streaming.getTexture(textureHandle); // Returns placeholder until loaded
 */

import {
    textureFormatFamily,
    textureFormatMipByteSize,
    textureMipLevelCount,
    textureStreamingPriorityScore,
} from '../math/TextureMath.js';

export const DEFAULT_STREAMING_MEMORY_BUDGET = 256 * 1024 * 1024;
export const DEFAULT_STREAMING_MAX_CONCURRENT_LOADS = 4;

// Resource states
const ResourceState = {
    UNLOADED: 0,
    QUEUED: 1,
    LOADING: 2,
    LOADED: 3,
    EVICTED: 4,
};

// Resource types
const StreamingResourceType = {
    TEXTURE: 'texture',
    MESH: 'mesh',
    BUFFER: 'buffer',
};

/**
 * Streaming resource entry
 */
class StreamingResource {
    constructor(id, type, requestDescriptor) {
        this.id = id;
        this.type = type;
        this.requestDescriptor = requestDescriptor;
        this.path = requestDescriptor.path;
        this.options = null;

        this.state = ResourceState.UNLOADED;
        this.priority = requestDescriptor.priority;
        this.distance = Infinity;       // Distance from camera (for priority)
        this.lastUsedFrame = 0;         // For LRU eviction
        this.memorySize = 0;            // Estimated memory usage
        this.loadedMipLevel = -1;       // For progressive texture loading
        this.targetMipLevel = 0;        // Desired mip level
        this.gpuResource = null;        // Actual GPU resource
        this.loadPromise = null;        // Loading promise
        this.loadRecord = null;         // Revocable in-flight ownership record
    }

    computePriority(cameraPos, frameIndex) {
        return textureStreamingPriorityScore({
            priority: this.priority,
            distance: this.distance,
            lastUsedFrame: this.lastUsedFrame,
            frameIndex,
        });
    }
}

/**
 * Priority queue for streaming requests
 */
class StreamingQueue {
    constructor() {
        this.items = [];
    }

    push(resource) {
        this.items.push(resource);
        this._bubbleUp(this.items.length - 1);
    }

    pop() {
        if (this.items.length === 0) return null;
        const result = this.items[0];
        const last = this.items.pop();
        if (this.items.length > 0) {
            this.items[0] = last;
            this._bubbleDown(0);
        }
        return result;
    }

    peek() {
        return this.items[0] || null;
    }

    updatePriorities(cameraPos, frameIndex) {
        for (const item of this.items) {
            item._computedPriority = item.computePriority(cameraPos, frameIndex);
        }
        // Rebuild heap
        for (let i = Math.floor(this.items.length / 2) - 1; i >= 0; i--) {
            this._bubbleDown(i);
        }
    }

    remove(resource) {
        const idx = this.items.indexOf(resource);
        if (idx === -1) return;
        const last = this.items.pop();
        if (idx < this.items.length) {
            this.items[idx] = last;
            this._bubbleDown(idx);
            this._bubbleUp(idx);
        }
    }

    get length() {
        return this.items.length;
    }

    _bubbleUp(idx) {
        while (idx > 0) {
            const parent = Math.floor((idx - 1) / 2);
            if (this._compare(idx, parent) >= 0) break;
            this._swap(idx, parent);
            idx = parent;
        }
    }

    _bubbleDown(idx) {
        const length = this.items.length;
        while (true) {
            const left = 2 * idx + 1;
            const right = 2 * idx + 2;
            let smallest = idx;
            
            if (left < length && this._compare(left, smallest) < 0) {
                smallest = left;
            }
            if (right < length && this._compare(right, smallest) < 0) {
                smallest = right;
            }
            if (smallest === idx) break;
            this._swap(idx, smallest);
            idx = smallest;
        }
    }

    _compare(a, b) {
        // Higher priority = lower in heap (should come out first)
        return (this.items[b]._computedPriority || 0) - (this.items[a]._computedPriority || 0);
    }

    _swap(a, b) {
        [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    }
}

/**
 * Main Streaming Manager
 */
export class VGPUStreamingManager {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        
        // Resource registry
        this.resources = new Map();     // id -> StreamingResource
        this.pathToId = new Map();      // path -> id
        this._nextId = 1;
        
        // Loading queue
        this.loadQueue = new StreamingQueue();
        this.activeLoads = new Set();   // Currently loading resources
        
        // Memory management
        this.memoryBudget = DEFAULT_STREAMING_MEMORY_BUDGET;
        this.memoryUsed = 0;
        
        // Placeholders
        this._placeholderTexture = null;
        this._placeholderTexture1x1 = null;
        
        // Settings
        this.maxConcurrentLoads = DEFAULT_STREAMING_MAX_CONCURRENT_LOADS;
        this.mipBias = 0;               // Bias for mip level selection
        this.evictionThreshold = 0.9;   // Start evicting at 90% memory usage
        
        // Frame tracking
        this._frameIndex = 0;
        this._cameraPos = [0, 0, 0];

        // Lifecycle fencing for fetch/decode/upload/preload work.
        this._activeLoadRecords = new Set();
        this._preloadOperations = new Set();
        this._initSnapshotToken = null;
        this._initOperation = null;
        this._initPromise = null;
        this._initDescriptor = null;
        this._initialized = false;
        this._generation = 0;
        this._destroyed = false;
        this._destroyError = null;
        
        // Loader functions (can be overridden)
        this.loaders = {
            texture: this._loadTexture.bind(this),
            mesh: this._loadMesh.bind(this),
            buffer: this._loadBuffer.bind(this),
        };
    }

    init(options = {}) {
        const generation = this._generation;
        if (this._initSnapshotToken) {
            return this._rejectedStreamingPromise(this._streamingInitMismatchError());
        }
        const snapshotToken = {};
        this._initSnapshotToken = snapshotToken;
        let config;
        try {
            this._assertGeneration(generation);
            config = this._snapshotInitOptions(options, generation);
            this._assertGeneration(generation);
            if (this._initSnapshotToken !== snapshotToken) {
                throw this._streamingCancellationError('init snapshot invalidated');
            }
        } catch (error) {
            return this._rejectedStreamingPromise(error);
        } finally {
            if (this._initSnapshotToken === snapshotToken) this._initSnapshotToken = null;
        }

        if (this._initialized) {
            if (config.descriptor !== this._initDescriptor) {
                return this._rejectedStreamingPromise(this._streamingInitMismatchError());
            }
            return Promise.resolve(this);
        }

        const pending = this._initOperation;
        if (pending) {
            if (config.descriptor !== pending.config.descriptor) {
                return this._rejectedStreamingPromise(this._streamingInitMismatchError());
            }
            return pending.promise;
        }

        let resolvePublic;
        let rejectPublic;
        const operation = {
            generation,
            config,
            settled: false,
            promise: null,
            resolve: null,
            reject: null,
        };
        operation.promise = new Promise((resolve, reject) => {
            resolvePublic = resolve;
            rejectPublic = reject;
        });
        operation.resolve = resolvePublic;
        operation.reject = rejectPublic;
        void operation.promise.catch(() => {});

        try {
            this._assertGeneration(generation);
            this._initOperation = operation;
            this._initPromise = operation.promise;
        } catch (error) {
            this._settleInitOperation(operation, null, error);
            return operation.promise;
        }

        void Promise.resolve().then(() => {
            this._assertInitCurrent(operation);
            this._createPlaceholders(generation);
            this._assertInitCurrent(operation);
            this.memoryBudget = config.memoryBudget;
            this.maxConcurrentLoads = config.maxConcurrentLoads;
            this._initDescriptor = config.descriptor;
            this._initialized = true;
            this._settleInitOperation(operation, this, null);
        }).catch(error => {
            this._settleInitOperation(operation, null, error);
        });
        return operation.promise;
    }

    _snapshotInitOptions(options, generation) {
        this._assertGeneration(generation);
        const source = options ?? {};
        const pendingConfig = this._initOperation?.config ?? null;
        const defaultMemoryBudget = pendingConfig?.memoryBudget ?? this.memoryBudget;
        const defaultMaxConcurrentLoads = pendingConfig?.maxConcurrentLoads ?? this.maxConcurrentLoads;

        const memoryBudgetOption = source.memoryBudget;
        this._assertGeneration(generation);
        let memoryBudget = memoryBudgetOption === undefined
            ? defaultMemoryBudget
            : Number(memoryBudgetOption);
        this._assertGeneration(generation);
        if (!Number.isFinite(memoryBudget) || memoryBudget < 0) {
            throw new RangeError('Streaming memoryBudget must be a finite non-negative number');
        }
        if (Object.is(memoryBudget, -0)) memoryBudget = 0;

        const maxConcurrentLoadsOption = source.maxConcurrentLoads;
        this._assertGeneration(generation);
        let maxConcurrentLoads = maxConcurrentLoadsOption === undefined
            ? defaultMaxConcurrentLoads
            : Number(maxConcurrentLoadsOption);
        this._assertGeneration(generation);
        maxConcurrentLoads = Math.floor(maxConcurrentLoads);
        this._assertGeneration(generation);
        if (!Number.isSafeInteger(maxConcurrentLoads) || maxConcurrentLoads < 0) {
            throw new RangeError('Streaming maxConcurrentLoads must be a non-negative safe integer');
        }
        if (Object.is(maxConcurrentLoads, -0)) maxConcurrentLoads = 0;

        return Object.freeze({
            memoryBudget,
            maxConcurrentLoads,
            descriptor: `${memoryBudget}:${maxConcurrentLoads}`,
        });
    }

    _isInitCurrent(operation) {
        return Boolean(operation)
            && !operation.settled
            && !this._destroyed
            && operation.generation === this._generation
            && this._initOperation === operation
            && this._initPromise === operation.promise;
    }

    _assertInitCurrent(operation) {
        if (!this._isInitCurrent(operation)) {
            throw this._destroyError || this._streamingCancellationError('init invalidated');
        }
    }

    _settleInitOperation(operation, value, error) {
        if (!operation || operation.settled) return false;
        operation.settled = true;
        if (this._initOperation === operation) this._initOperation = null;
        if (this._initPromise === operation.promise) this._initPromise = null;
        if (error) operation.reject(error);
        else operation.resolve(value);
        return true;
    }

    _streamingInitMismatchError() {
        const error = new Error('[Streaming] init options do not match the active configuration');
        error.code = 'VGPU_STREAMING_INIT_OPTIONS_MISMATCH';
        return error;
    }

    _rejectedStreamingPromise(error) {
        const promise = Promise.reject(error);
        void promise.catch(() => {});
        return promise;
    }

    _createPlaceholders(generation = this._generation) {
        if (this._placeholderTexture && this._placeholderTexture1x1) return;
        // 8x8 checkerboard placeholder
        const size = 8;
        const data = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                const isLight = ((x + y) % 2) === 0;
                const v = isLight ? 200 : 100;
                data[idx] = v;
                data[idx + 1] = v;
                data[idx + 2] = v;
                data[idx + 3] = 255;
            }
        }
        
        let placeholder = null;
        let placeholder1x1 = null;
        try {
            const assertCurrent = () => this._assertGeneration(generation);
            const device = this.device;
            const queue = this._readExternalMember(
                device, 'queue', assertCurrent, 'resolve placeholder upload queue',
            );
            placeholder = this._callExternal(device, 'createTexture', [{
                label: 'Streaming_Placeholder',
                size: [size, size],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            }], assertCurrent, 'create streaming placeholder', resource => {
                this._retireGpuResource(resource, new Set());
            });
            this._callExternal(
                queue, 'writeTexture', [
                { texture: placeholder },
                data,
                { bytesPerRow: size * 4 },
                [size, size],
                ], assertCurrent, 'upload streaming placeholder',
            );

            placeholder1x1 = this._callExternal(device, 'createTexture', [{
                label: 'Streaming_Placeholder1x1',
                size: [1, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            }], assertCurrent, 'create 1x1 streaming placeholder', resource => {
                this._retireGpuResource(resource, new Set());
            });
            this._callExternal(
                queue, 'writeTexture', [
                { texture: placeholder1x1 },
                new Uint8Array([255, 255, 255, 255]),
                { bytesPerRow: 4 },
                [1, 1],
                ], assertCurrent, 'upload 1x1 streaming placeholder',
            );

            this._placeholderTexture = placeholder;
            this._placeholderTexture1x1 = placeholder1x1;
        } catch (error) {
            const retirementSet = new Set();
            this._retireGpuResource(placeholder, retirementSet);
            this._retireGpuResource(placeholder1x1, retirementSet);
            throw error;
        }
    }

    /**
     * Request a texture to be streamed
     * @returns {number} Resource handle
     */
    requestTexture(path, options = {}) {
        return this._requestResource(StreamingResourceType.TEXTURE, path, options);
    }

    /**
     * Request a mesh to be streamed
     */
    requestMesh(path, options = {}) {
        return this._requestResource(StreamingResourceType.MESH, path, options);
    }

    /**
     * Request a buffer to be streamed
     */
    requestBuffer(path, options = {}) {
        return this._requestResource(StreamingResourceType.BUFFER, path, options);
    }

    _requestResource(type, path, options) {
        const generation = this._generation;
        this._assertGeneration(generation);
        const requestDescriptor = this._snapshotRequestDescriptor(type, path, options, generation);
        this._assertGeneration(generation);

        // Check if already requested
        if (this.pathToId.has(requestDescriptor.path)) {
            const id = this.pathToId.get(requestDescriptor.path);
            const resource = this.resources.get(id);
            this._assertGeneration(generation);
            if (!resource) throw new Error(`[Streaming] Resource registry is missing handle ${id}`);
            if (resource.requestDescriptor.identityKey !== requestDescriptor.identityKey) {
                throw this._streamingResourceCollisionError(requestDescriptor.path);
            }
            if ((resource.state === ResourceState.UNLOADED || resource.state === ResourceState.EVICTED)
                && (resource.loadRecord || resource.loadPromise)) {
                throw new Error(`[Streaming] Retryable resource ${id} retained stale load authority`);
            }

            const priorState = resource.state;
            const priorOptions = resource.options;
            if (priorState === ResourceState.UNLOADED || priorState === ResourceState.EVICTED) {
                try {
                    this._assertGeneration(generation);
                    resource.options = options ?? {};
                    resource.state = ResourceState.QUEUED;
                    this.loadQueue.push(resource);
                    this._assertGeneration(generation);
                } catch (error) {
                    this.loadQueue.remove(resource);
                    resource.options = priorOptions;
                    resource.state = priorState;
                    throw error;
                }
            }

            this._assertGeneration(generation);
            resource.lastUsedFrame = this._frameIndex;
            resource.priority = Math.max(resource.priority, requestDescriptor.priority);
            return id;
        }

        // Create new resource entry
        const id = this._nextId;
        const resource = new StreamingResource(id, type, requestDescriptor);
        // Custom loaders retain the caller contract. Built-in loaders consume only
        // requestDescriptor, so later caller mutation cannot change GPU descriptors.
        resource.options = options ?? {};
        resource.lastUsedFrame = this._frameIndex;

        try {
            this._assertGeneration(generation);
            this.resources.set(id, resource);
            this._assertGeneration(generation);
            this.pathToId.set(requestDescriptor.path, id);
            this._assertGeneration(generation);
            resource.state = ResourceState.QUEUED;
            this.loadQueue.push(resource);
            this._assertGeneration(generation);
            if (this._nextId !== id) throw new Error('[Streaming] Resource handle allocation was superseded');
            this._nextId = id + 1;
            return id;
        } catch (error) {
            if (this.resources.get(id) === resource) this.resources.delete(id);
            if (this.pathToId.get(requestDescriptor.path) === id) this.pathToId.delete(requestDescriptor.path);
            this.loadQueue.remove(resource);
            resource.state = ResourceState.UNLOADED;
            throw error;
        }
    }

    _snapshotRequestDescriptor(type, path, options, generation) {
        this._assertGeneration(generation);
        const normalizedPath = String(path);
        this._assertGeneration(generation);
        const source = options ?? {};

        const priorityOption = source.priority;
        this._assertGeneration(generation);
        let priority = priorityOption ? Number(priorityOption) : 0;
        this._assertGeneration(generation);
        if (!Number.isFinite(priority)) {
            throw new RangeError('Streaming resource priority must be finite');
        }
        if (Object.is(priority, -0)) priority = 0;

        let generateMips = true;
        let format = 'rgba8unorm';
        let usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
        if (type === StreamingResourceType.TEXTURE) {
            const generateMipsOption = source.generateMips;
            this._assertGeneration(generation);
            generateMips = generateMipsOption !== false;

            const formatOption = source.format;
            this._assertGeneration(generation);
            if (formatOption) {
                format = String(formatOption);
                this._assertGeneration(generation);
            }
        } else if (type === StreamingResourceType.BUFFER) {
            const usageOption = source.usage;
            this._assertGeneration(generation);
            if (usageOption) {
                usage = Number(usageOption);
                this._assertGeneration(generation);
                usage = Math.floor(usage);
                this._assertGeneration(generation);
                if (!Number.isSafeInteger(usage) || usage < 0 || usage > 0xFFFFFFFF) {
                    throw new RangeError('Streaming buffer usage must be an unsigned 32-bit integer');
                }
            }
        }

        // Priority is request scheduling metadata; GPU-affecting fields define identity.
        const identityKey = type === StreamingResourceType.TEXTURE
            ? JSON.stringify([type, normalizedPath, generateMips, format])
            : type === StreamingResourceType.BUFFER
                ? JSON.stringify([type, normalizedPath, usage])
                : JSON.stringify([type, normalizedPath]);
        const immutableOptions = Object.freeze({ priority, generateMips, format, usage });
        return Object.freeze({
            type,
            path: normalizedPath,
            priority,
            identityKey,
            options: immutableOptions,
        });
    }

    _streamingResourceCollisionError(path) {
        const error = new Error(`[Streaming] Path '${path}' is already registered with an incompatible descriptor`);
        error.code = 'VGPU_STREAMING_RESOURCE_COLLISION';
        return error;
    }

    /**
     * Get a texture by handle (returns placeholder if not loaded)
     */
    getTexture(handle) {
        const resource = this.resources.get(handle);
        if (!resource) return this._placeholderTexture;
        
        resource.lastUsedFrame = this._frameIndex;
        
        if (resource.state === ResourceState.LOADED && resource.gpuResource) {
            return resource.gpuResource;
        }
        
        return this._placeholderTexture;
    }

    /**
     * Get a mesh by handle
     */
    getMesh(handle) {
        const resource = this.resources.get(handle);
        if (!resource || resource.state !== ResourceState.LOADED) {
            return null;
        }
        resource.lastUsedFrame = this._frameIndex;
        return resource.gpuResource;
    }

    /**
     * Check if a resource is fully loaded
     */
    isLoaded(handle) {
        const resource = this.resources.get(handle);
        return resource && resource.state === ResourceState.LOADED;
    }

    /**
     * Get loading progress (0-1)
     */
    getLoadProgress(handle) {
        const resource = this.resources.get(handle);
        if (!resource) return 0;
        
        switch (resource.state) {
            case ResourceState.UNLOADED: return 0;
            case ResourceState.QUEUED: return 0.1;
            case ResourceState.LOADING: return 0.5;
            case ResourceState.LOADED: return 1.0;
            default: return 0;
        }
    }

    /**
     * Set distance for priority calculation
     */
    setResourceDistance(handle, distance) {
        const resource = this.resources.get(handle);
        if (resource) {
            resource.distance = distance;
        }
    }

    /**
     * Update camera position for priority calculations
     */
    updateCamera(position) {
        this._cameraPos = position;
    }

    /**
     * Process streaming queue - call once per frame
     */
    update() {
        this._assertAlive();
        this._frameIndex++;
        
        // Update priorities
        this.loadQueue.updatePriorities(this._cameraPos, this._frameIndex);
        
        // Start new loads if under limit
        while (this.activeLoads.size < this.maxConcurrentLoads && this.loadQueue.length > 0) {
            const resource = this.loadQueue.pop();
            if (resource.state !== ResourceState.QUEUED) continue;
            
            this._startLoad(resource);
        }
        
        // Check memory pressure and evict if needed
        if (this.memoryUsed > this.memoryBudget * this.evictionThreshold) {
            this._evictLRU();
        }
    }

    _startLoad(resource) {
        this._assertAlive();
        if (resource.loadRecord) return resource.loadRecord.promise;

        const record = this._createLoadRecord(resource);
        resource.state = ResourceState.LOADING;
        resource.loadRecord = record;
        resource.loadPromise = record.promise;
        this.activeLoads.add(resource);
        this._activeLoadRecords.add(record);
        void record.promise.catch(() => {});

        let loader;
        try {
            this._assertLoadCurrent(record);
            loader = this.loaders[resource.type];
            this._assertLoadCurrent(record);
            if (typeof loader !== 'function') {
                throw this._streamingLoaderError(resource.type);
            }
        } catch (error) {
            this._retireLoadCandidate(record);
            const retryable = this._isLoadCurrent(record);
            this._settleLoadRecord(record, null, error);
            if (retryable) resource.state = ResourceState.UNLOADED;
            return record.promise;
        }

        const rawOutcome = Promise.resolve()
            .then(() => {
                const assertCurrent = () => this._assertLoadCurrent(record);
                return this._invokeCapturedExternal(
                    { receiver: undefined, callable: loader },
                    [resource, record],
                    assertCurrent,
                    'invoke a streaming loader',
                    result => this._retireReturnedLoadOutcome(record, result),
                );
            })
            .then(
                result => {
                    record.resolvedResult = result;
                    if (!this._isLoadCurrent(record)) {
                        this._retireResolvedLoadResult(record);
                        return { status: 'cancelled', error: this._destroyError || this._streamingCancellationError('load invalidated') };
                    }
                    return { status: 'resolved', result };
                },
                error => ({ status: 'rejected', error }),
            );

        void Promise.race([
            rawOutcome,
            record.cancellation.then(error => ({ status: 'cancelled', error })),
        ]).then(outcome => {
            if (outcome.status === 'resolved' && !this._isLoadCurrent(record)) {
                this._retireResolvedLoadResult(record, outcome.result);
                return;
            }
            if (outcome.status === 'cancelled' || !this._isLoadCurrent(record)) return;
            if (outcome.status === 'rejected') {
                this._retireLoadCandidate(record);
                const retryable = this._isLoadCurrent(record);
                this._settleLoadRecord(record, null, outcome.error);
                if (retryable) resource.state = ResourceState.UNLOADED;
                try { console.warn(`Failed to load ${resource.path}:`, outcome.error); } catch (_) {}
                return;
            }

            try {
                this._publishLoadCandidate(record, outcome.result);
                this._assertLoadCurrent(record);
                resource.state = ResourceState.LOADED;
                this._settleLoadRecord(record, resource.gpuResource, null);
            } catch (error) {
                this._retireLoadCandidate(record);
                const retryable = this._isLoadCurrent(record);
                this._settleLoadRecord(record, null, error);
                if (retryable) resource.state = ResourceState.UNLOADED;
            }
        });
        return record.promise;
    }

    _streamingLoaderError(type) {
        const error = new TypeError(`[Streaming] No callable loader is registered for '${type}'`);
        error.code = 'VGPU_STREAMING_LOADER_INVALID';
        return error;
    }

    _createLoadRecord(resource) {
        let resolvePublic;
        let rejectPublic;
        let cancelWait;
        const record = {
            resource,
            requestDescriptor: resource.requestDescriptor,
            generation: this._generation,
            abortController: new AbortController(),
            imageBitmap: null,
            texture: null,
            vertexBuffer: null,
            indexBuffer: null,
            buffer: null,
            resolvedResult: null,
            resolvedGpuResource: null,
            retiringResolvedResult: false,
            retiredResources: new WeakSet(),
            retirementSet: null,
            settled: false,
            cancelled: false,
            promise: null,
            cancellation: null,
        };
        record.promise = new Promise((resolve, reject) => {
            resolvePublic = resolve;
            rejectPublic = reject;
        });
        record.resolve = resolvePublic;
        record.reject = rejectPublic;
        record.cancellation = new Promise(resolve => { cancelWait = resolve; });
        record.cancelWait = cancelWait;
        return record;
    }

    _isLoadCurrent(record) {
        const resource = record?.resource;
        return Boolean(record)
            && !record.settled
            && !record.cancelled
            && !this._destroyed
            && record.generation === this._generation
            && this._activeLoadRecords.has(record)
            && resource?.loadRecord === record
            && this.resources.get(resource.id) === resource;
    }

    _assertLoadCurrent(record) {
        if (!this._isLoadCurrent(record)) {
            throw this._destroyError || this._streamingCancellationError('load invalidated');
        }
    }

    _publishLoadCandidate(record, result) {
        this._assertLoadCurrent(record);
        const resource = record.resource;
        record.resolvedResult = result;
        if (result === null || result === undefined) {
            throw this._streamingLoadResultError('loader returned no result');
        }

        let gpuResource = result?.gpuResource ?? resource.gpuResource ?? null;
        record.resolvedGpuResource = gpuResource;
        this._assertLoadCurrent(record);
        if (!gpuResource && (typeof result === 'object' || typeof result === 'function')) {
            const directDestroy = result.destroy;
            this._assertLoadCurrent(record);
            if (typeof directDestroy === 'function') gpuResource = result;
        }
        record.resolvedGpuResource = gpuResource;
        this._assertLoadCurrent(record);
        if (!gpuResource) throw this._streamingLoadResultError('loader returned no GPU resource');

        const rawMemorySize = result?.memorySize ?? resource.memorySize;
        this._assertLoadCurrent(record);
        const memorySize = Number(rawMemorySize);
        this._assertLoadCurrent(record);
        if (!Number.isSafeInteger(memorySize) || memorySize < 0) {
            throw this._streamingLoadResultError('memorySize must be a non-negative safe integer');
        }
        const nextMemoryUsed = this.memoryUsed + memorySize;
        if (!Number.isSafeInteger(nextMemoryUsed) || nextMemoryUsed < this.memoryUsed) {
            throw this._streamingLoadResultError('memory accounting overflow');
        }
        this._assertLoadCurrent(record);
        const loadedMipLevel = result?.loadedMipLevel ?? resource.loadedMipLevel;
        this._assertLoadCurrent(record);
        const vertexBuffer = gpuResource?.vertexBuffer ?? null;
        this._assertLoadCurrent(record);
        const indexBuffer = gpuResource?.indexBuffer ?? null;
        this._assertLoadCurrent(record);
        resource.gpuResource = gpuResource;
        resource.memorySize = memorySize;
        resource.loadedMipLevel = loadedMipLevel;
        this.memoryUsed = nextMemoryUsed;

        record.resolvedResult = null;
        record.resolvedGpuResource = null;
        if (gpuResource === record.texture) record.texture = null;
        if (gpuResource === record.buffer) record.buffer = null;
        if (vertexBuffer === record.vertexBuffer) record.vertexBuffer = null;
        if (indexBuffer === record.indexBuffer) record.indexBuffer = null;
        this._retireLoadCandidate(record);
    }

    _streamingLoadResultError(reason) {
        const error = new TypeError(`[Streaming] Invalid loader result: ${reason}`);
        error.code = 'VGPU_STREAMING_LOAD_RESULT_INVALID';
        return error;
    }

    _detachLoadCandidate(record) {
        if (!record) return null;
        const candidate = {
            imageBitmap: this._takeOwnedField(record, 'imageBitmap'),
            resources: [
                this._takeOwnedField(record, 'texture'),
                this._takeOwnedField(record, 'vertexBuffer'),
                this._takeOwnedField(record, 'indexBuffer'),
                this._takeOwnedField(record, 'buffer'),
            ],
            resolvedResult: this._takeOwnedField(record, 'resolvedResult'),
            resolvedGpuResource: this._takeOwnedField(record, 'resolvedGpuResource'),
        };
        return candidate;
    }

    _takeOwnedField(owner, key) {
        let value = null;
        try { value = owner[key]; } catch (_) {}
        try { owner[key] = null; } catch (_) {}
        return value;
    }

    _retireLoadCandidate(record, retirementSet = record?.retirementSet ?? null) {
        const candidate = this._detachLoadCandidate(record);
        this._retireDetachedLoadCandidate(record, candidate, retirementSet);
    }

    _retireDetachedLoadCandidate(record, candidate, retirementSet = record?.retirementSet ?? null) {
        if (!candidate) return;
        this._retireOwnedMethod(candidate.imageBitmap, 'close', retirementSet, record);
        for (const resource of new Set(candidate.resources.filter(Boolean))) {
            this._retireGpuResource(resource, retirementSet, record);
        }
        this._retireResolvedLoadResult(
            record,
            candidate.resolvedResult,
            candidate.resolvedGpuResource,
            retirementSet,
        );
    }

    _claimRetirement(resource, retirementSet, record) {
        if (!resource || (typeof resource !== 'object' && typeof resource !== 'function')) return;
        if (retirementSet?.has(resource) || record?.retiredResources?.has(resource)) {
            retirementSet?.add(resource);
            record?.retiredResources?.add(resource);
            return false;
        }
        retirementSet?.add(resource);
        record?.retiredResources?.add(resource);
        return true;
    }

    _retireOwnedMethod(resource, methodName, retirementSet, record = null) {
        if (!this._claimRetirement(resource, retirementSet, record)) return;
        let method = null;
        try { method = resource[methodName]; } catch (_) { return; }
        if (typeof method !== 'function') return;
        try { Reflect.apply(method, resource, []); } catch (_) {}
    }

    _retireGpuResource(resource, retirementSet, record = null) {
        if (!this._claimRetirement(resource, retirementSet, record)) return;
        let destroyMethod = null;
        try { destroyMethod = resource.destroy; } catch (_) {}
        if (typeof destroyMethod === 'function') {
            try {
                Reflect.apply(destroyMethod, resource, []);
                return;
            } catch (_) {}
        }

        for (const key of ['vertexBuffer', 'indexBuffer']) {
            let child = null;
            try { child = resource[key]; } catch (_) { continue; }
            this._retireGpuResource(child, retirementSet, record);
        }
    }

    _destroyLoadResource(record, resource, retirementSet = record?.retirementSet ?? null) {
        this._retireGpuResource(resource, retirementSet, record);
    }

    _retireResolvedLoadResult(
        record,
        result = record?.resolvedResult,
        stagedResource = record?.resolvedGpuResource,
        retirementSet = record?.retirementSet ?? null,
    ) {
        if (!record || record.retiringResolvedResult) return;
        record.retiringResolvedResult = true;
        if (record.resolvedResult === result) record.resolvedResult = null;
        if (record.resolvedGpuResource === stagedResource) record.resolvedGpuResource = null;
        try {
            let gpuResource = stagedResource;
            if (!gpuResource && result) {
                try { gpuResource = result?.gpuResource ?? result; } catch (_) { return; }
            }
            if (!gpuResource) return;
            this._destroyLoadResource(record, gpuResource, retirementSet);
        } finally {
            record.retiringResolvedResult = false;
        }
    }

    _retireReturnedLoadOutcome(record, result) {
        if (!result || (typeof result !== 'object' && typeof result !== 'function')) return;
        let attached = false;
        try {
            Reflect.apply(Promise.prototype.then, result, [
                value => this._retireResolvedLoadResult(record, value),
                () => {},
            ]);
            attached = true;
        } catch (_) {}
        if (!attached) this._retireResolvedLoadResult(record, result);
    }

    _settleLoadRecord(record, value, error) {
        if (!record || record.settled) return false;
        record.settled = true;
        this._activeLoadRecords.delete(record);
        const resource = record.resource;
        this.activeLoads.delete(resource);
        if (resource?.loadRecord === record) resource.loadRecord = null;
        if (resource?.loadPromise === record.promise) resource.loadPromise = null;
        if (error) record.reject(error);
        else record.resolve(value);
        return true;
    }

    _cancelLoadRecord(record, error) {
        if (!record || record.settled) return false;
        record.cancelled = true;
        try { record.abortController.abort(error); } catch (_) {}
        this._retireLoadCandidate(record);
        record.cancelWait(error);
        return this._settleLoadRecord(record, null, error);
    }

    async _loadTexture(resource, record) {
        const requestDescriptor = record.requestDescriptor;
        const path = requestDescriptor.path;
        const { generateMips, format } = requestDescriptor.options;

        try {
            const assertCurrent = () => this._assertLoadCurrent(record);
            const response = await this._callExternal(
                globalThis,
                'fetch',
                [path, { signal: record.abortController.signal }],
                assertCurrent,
                'fetch a streamed texture',
            );
            assertCurrent();
            const blob = await this._callExternal(
                response, 'blob', [], assertCurrent, 'read a streamed texture response',
            );
            assertCurrent();
            const imageBitmap = await this._callExternal(
                globalThis,
                'createImageBitmap',
                [blob],
                assertCurrent,
                'decode a streamed texture',
            );
            record.imageBitmap = imageBitmap;
            assertCurrent();

            const width = this._snapshotLoadDimension(record, imageBitmap, 'width', 'Texture width');
            const height = this._snapshotLoadDimension(record, imageBitmap, 'height', 'Texture height');
            const requestedMipLevels = generateMips
                ? textureMipLevelCount(width, height)
                : 1;
            this._assertLoadCurrent(record);

            let mipReceiver = null;
            let generateMipsMethod = null;
            if (requestedMipLevels > 1) {
                const vgpu = this.vgpu;
                this._assertLoadCurrent(record);
                mipReceiver = vgpu?.mipmap ?? null;
                this._assertLoadCurrent(record);
                const method = mipReceiver?.generate ?? null;
                this._assertLoadCurrent(record);
                if (typeof method === 'function' && format === 'rgba8unorm') {
                    generateMipsMethod = method;
                }
            }
            const mipLevels = generateMipsMethod ? requestedMipLevels : 1;
            const formatFamily = textureFormatFamily(format);
            this._assertLoadCurrent(record);
            if (formatFamily === 'unknown') {
                throw new RangeError(`[Streaming] Unsupported texture format: ${format}`);
            }

            assertCurrent();
            const device = this.device;
            const texture = this._callExternal(device, 'createTexture', [{
                label: `Streaming_${path}`,
                size: [width, height],
                format,
                usage: GPUTextureUsage.TEXTURE_BINDING |
                       GPUTextureUsage.COPY_DST |
                       GPUTextureUsage.RENDER_ATTACHMENT |
                       (mipLevels > 1 ? GPUTextureUsage.STORAGE_BINDING : 0),
                mipLevelCount: mipLevels,
            }], assertCurrent, 'create a streamed texture', candidate => {
                this._retireGpuResource(candidate, record.retirementSet, record);
            });
            record.texture = texture;
            assertCurrent();

            const queue = this._readExternalMember(
                device, 'queue', assertCurrent, 'resolve streamed texture upload queue',
            );
            this._callExternal(
                queue, 'copyExternalImageToTexture', [
                { source: imageBitmap },
                { texture },
                [width, height],
                ], assertCurrent, 'upload a streamed texture',
            );

            if (generateMipsMethod) {
                this._assertLoadCurrent(record);
                await Reflect.apply(generateMipsMethod, mipReceiver, [texture]);
                this._assertLoadCurrent(record);
            }

            const totalBytes = textureFormatMipByteSize(width, height, format, mipLevels);
            this._assertLoadCurrent(record);
            return { gpuResource: texture, memorySize: totalBytes, loadedMipLevel: 0 };
        } catch (error) {
            this._retireLoadCandidate(record);
            throw error;
        } finally {
            const imageBitmap = record.imageBitmap;
            record.imageBitmap = null;
            this._retireOwnedMethod(
                imageBitmap, 'close', record.retirementSet, record,
            );
        }
    }

    _snapshotLoadDimension(record, source, key, label) {
        this._assertLoadCurrent(record);
        const rawValue = source[key];
        this._assertLoadCurrent(record);
        let value = Number(rawValue);
        this._assertLoadCurrent(record);
        value = Math.floor(value);
        this._assertLoadCurrent(record);
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new RangeError(`[Streaming] ${label} must be a positive safe integer`);
        }
        return value;
    }

    async _loadMesh(resource, record) {
        const { path } = record.requestDescriptor;

        try {
            const assertCurrent = () => this._assertLoadCurrent(record);
            const response = await this._callExternal(
                globalThis,
                'fetch',
                [path, { signal: record.abortController.signal }],
                assertCurrent,
                'fetch a streamed mesh',
            );
            assertCurrent();
            const data = await this._callExternal(
                response, 'arrayBuffer', [], assertCurrent, 'read a streamed mesh response',
            );
            assertCurrent();

            // Assume simple binary format: header + vertex data + index data
            const view = new DataView(data);
            const vertexCount = view.getUint32(0, true);
            const indexCount = view.getUint32(4, true);
            const vertexStride = view.getUint32(8, true) || 32;
            const vertexOffset = 16;
            const indexOffset = vertexOffset + vertexCount * vertexStride;

            const device = this.device;
            const vertexBuffer = this._callExternal(device, 'createBuffer', [{
                label: `Streaming_Mesh_${path}_Vertices`,
                size: vertexCount * vertexStride,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            }], assertCurrent, 'create a streamed mesh vertex buffer', candidate => {
                this._retireGpuResource(candidate, record.retirementSet, record);
            });
            record.vertexBuffer = vertexBuffer;
            assertCurrent();
            const queue = this._readExternalMember(
                device, 'queue', assertCurrent, 'resolve streamed mesh upload queue',
            );
            const writeBuffer = this._captureExternalCallable(
                queue, 'writeBuffer', assertCurrent, 'resolve streamed mesh upload',
            );
            this._invokeCapturedExternal(
                writeBuffer,
                [vertexBuffer, 0, new Uint8Array(data, vertexOffset, vertexCount * vertexStride)],
                assertCurrent,
                'upload streamed mesh vertices',
            );

            let indexBuffer = null;
            if (indexCount > 0) {
                indexBuffer = this._callExternal(device, 'createBuffer', [{
                    label: `Streaming_Mesh_${path}_Indices`,
                    size: indexCount * 4,
                    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
                }], assertCurrent, 'create a streamed mesh index buffer', candidate => {
                    this._retireGpuResource(candidate, record.retirementSet, record);
                });
                record.indexBuffer = indexBuffer;
                assertCurrent();
                this._invokeCapturedExternal(
                    writeBuffer,
                    [indexBuffer, 0, new Uint8Array(data, indexOffset, indexCount * 4)],
                    assertCurrent,
                    'upload streamed mesh indices',
                );
            }

            return {
                gpuResource: { vertexBuffer, indexBuffer, vertexCount, indexCount, vertexStride },
                memorySize: vertexCount * vertexStride + indexCount * 4,
            };
        } catch (error) {
            this._retireLoadCandidate(record);
            throw error;
        }
    }

    async _loadBuffer(resource, record) {
        const requestDescriptor = record.requestDescriptor;
        const path = requestDescriptor.path;
        const { usage } = requestDescriptor.options;

        try {
            const assertCurrent = () => this._assertLoadCurrent(record);
            const response = await this._callExternal(
                globalThis,
                'fetch',
                [path, { signal: record.abortController.signal }],
                assertCurrent,
                'fetch a streamed buffer',
            );
            assertCurrent();
            const data = await this._callExternal(
                response, 'arrayBuffer', [], assertCurrent, 'read a streamed buffer response',
            );
            assertCurrent();

            const rawByteLength = data.byteLength;
            this._assertLoadCurrent(record);
            let byteLength = Number(rawByteLength);
            this._assertLoadCurrent(record);
            byteLength = Math.floor(byteLength);
            this._assertLoadCurrent(record);
            if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
                throw new RangeError('[Streaming] Buffer byteLength must be a non-negative safe integer');
            }

            assertCurrent();
            const device = this.device;
            const buffer = this._callExternal(device, 'createBuffer', [{
                label: `Streaming_Buffer_${path}`,
                size: byteLength,
                usage,
            }], assertCurrent, 'create a streamed buffer', candidate => {
                this._retireGpuResource(candidate, record.retirementSet, record);
            });
            record.buffer = buffer;
            assertCurrent();
            const queue = this._readExternalMember(
                device, 'queue', assertCurrent, 'resolve streamed buffer upload queue',
            );
            this._callExternal(
                queue, 'writeBuffer', [buffer, 0, data], assertCurrent,
                'upload a streamed buffer',
            );
            return { gpuResource: buffer, memorySize: byteLength };
        } catch (error) {
            this._retireLoadCandidate(record);
            throw error;
        }
    }

    _evictLRU() {
        // Find least recently used loaded resources
        const loaded = [...this.resources.values()]
            .filter(r => r.state === ResourceState.LOADED)
            .sort((a, b) => a.lastUsedFrame - b.lastUsedFrame);
        
        // Evict until under threshold
        const targetMemory = this.memoryBudget * 0.7;
        const retirementSet = new Set();
        for (const resource of loaded) {
            if (this.memoryUsed <= targetMemory) break;
            
            // Don't evict recently used
            if (this._frameIndex - resource.lastUsedFrame < 60) continue;
            
            this._evictResource(resource, retirementSet);
        }
    }

    _detachRegistryResource(resource) {
        if (!resource) return null;
        let gpuResource = null;
        let memorySize = 0;
        try { gpuResource = resource.gpuResource; } catch (_) {}
        try {
            const candidateSize = Number(resource.memorySize);
            if (Number.isSafeInteger(candidateSize) && candidateSize >= 0) memorySize = candidateSize;
        } catch (_) {}
        try { resource.gpuResource = null; } catch (_) {}
        try { resource.state = ResourceState.EVICTED; } catch (_) {}
        try { resource.memorySize = 0; } catch (_) {}
        try { resource.loadedMipLevel = -1; } catch (_) {}
        return { gpuResource, memorySize };
    }

    _evictResource(resource, retirementSet = new Set()) {
        const candidate = this._detachRegistryResource(resource);
        if (!candidate) return;
        this.memoryUsed = Math.max(0, this.memoryUsed - candidate.memorySize);
        this._retireGpuResource(candidate.gpuResource, retirementSet);
    }

    /**
     * Unload a specific resource
     */
    unload(handle) {
        this._assertAlive();
        const resource = this.resources.get(handle);
        if (!resource) return;
        const retirementSet = new Set();

        if (resource.state === ResourceState.QUEUED) {
            this.loadQueue.remove(resource);
        }
        if (resource.loadRecord) {
            resource.loadRecord.retirementSet = retirementSet;
            this._cancelLoadRecord(resource.loadRecord, this._streamingCancellationError('resource unloaded'));
        }

        this._evictResource(resource, retirementSet);
        this.resources.delete(handle);
        this.pathToId.delete(resource.path);
    }

    /**
     * Get streaming statistics
     */
    getStats() {
        return {
            totalResources: this.resources.size,
            loadedResources: [...this.resources.values()].filter(r => r.state === ResourceState.LOADED).length,
            queuedResources: this.loadQueue.length,
            activeLoads: this.activeLoads.size,
            memoryUsed: this.memoryUsed,
            memoryBudget: this.memoryBudget,
            memoryPercent: (this.memoryUsed / this.memoryBudget * 100).toFixed(1) + '%',
        };
    }

    /**
     * Preload resources (useful for loading screens)
     */
    preload(paths, type = StreamingResourceType.TEXTURE) {
        this._assertAlive();
        let resolvePublic;
        let rejectPublic;
        let cancelWait;
        const operation = {
            generation: this._generation,
            handles: [],
            timeoutId: null,
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
        void operation.promise.catch(() => {});
        this._preloadOperations.add(operation);

        let pathSnapshot;
        let normalizedType;
        try {
            const assertCurrent = () => this._assertPreloadCurrent(operation);
            pathSnapshot = this._snapshotExternalIterable(
                paths, assertCurrent, 'snapshot preload paths',
            );
            try {
                normalizedType = String(type);
            } finally {
                assertCurrent();
            }
        } catch (error) {
            this._settlePreload(operation, null, error);
            return operation.promise;
        }

        void this._runPreload(operation, pathSnapshot, normalizedType);
        return operation.promise;
    }

    async _runPreload(operation, paths, type) {
        try {
            const handles = [];
            for (const path of paths) {
                this._assertPreloadCurrent(operation);
                switch (type) {
                    case StreamingResourceType.TEXTURE:
                        handles.push(this.requestTexture(path, { priority: 100 }));
                        break;
                    case StreamingResourceType.MESH:
                        handles.push(this.requestMesh(path, { priority: 100 }));
                        break;
                    default:
                        handles.push(this.requestBuffer(path, { priority: 100 }));
                        break;
                }
            }
            operation.handles = handles;

            while (operation.handles.some(handle => !this.isLoaded(handle))) {
                this._assertPreloadCurrent(operation);
                const missing = operation.handles.find(handle => !this.resources.has(handle));
                if (missing !== undefined) throw new Error(`Preload resource ${missing} was unloaded`);
                this.update();
                const failed = operation.handles
                    .map(handle => this.resources.get(handle))
                    .find(resource => resource?.state === ResourceState.UNLOADED && !resource.loadRecord);
                if (failed) throw new Error(`Failed to preload ${failed.path}`);
                const outcome = await Promise.race([
                    new Promise(resolve => {
                        operation.timeoutId = setTimeout(() => {
                            operation.timeoutId = null;
                            resolve({ status: 'tick' });
                        }, 16);
                    }),
                    operation.cancellation.then(error => ({ status: 'cancelled', error })),
                ]);
                if (outcome.status === 'cancelled') throw outcome.error;
                this._assertPreloadCurrent(operation);
            }
            this._settlePreload(operation, operation.handles, null);
        } catch (error) {
            if (this._isPreloadCurrent(operation)) this._settlePreload(operation, null, error);
        }
    }

    _isPreloadCurrent(operation) {
        return Boolean(operation)
            && !operation.settled
            && !operation.cancelled
            && !this._destroyed
            && operation.generation === this._generation
            && this._preloadOperations.has(operation);
    }

    _assertPreloadCurrent(operation) {
        if (!this._isPreloadCurrent(operation)) {
            throw this._destroyError || this._streamingCancellationError('preload invalidated');
        }
    }

    _settlePreload(operation, value, error) {
        if (!operation || operation.settled) return false;
        operation.settled = true;
        if (operation.timeoutId !== null) clearTimeout(operation.timeoutId);
        operation.timeoutId = null;
        this._preloadOperations.delete(operation);
        if (error) operation.reject(error);
        else operation.resolve(value);
        return true;
    }

    _streamingCancellationError(reason = 'destroyed') {
        const error = new Error(`[Streaming] ${reason}`);
        error.name = 'AbortError';
        error.code = 'VGPU_STREAMING_MANAGER_DESTROYED';
        return error;
    }

    _assertAlive() {
        if (this._destroyed) throw this._destroyError || this._streamingCancellationError();
    }

    _assertGeneration(generation) {
        if (this._destroyed || generation !== this._generation) {
            throw this._destroyError || this._streamingCancellationError('generation invalidated');
        }
    }

    _readExternalMember(receiver, key, assertCurrent, operation) {
        assertCurrent();
        let value;
        try {
            value = receiver?.[key];
        } finally {
            assertCurrent();
        }
        return value;
    }

    _captureExternalCallable(receiver, key, assertCurrent, operation) {
        const callable = this._readExternalMember(receiver, key, assertCurrent, operation);
        if (typeof callable !== 'function') {
            throw new TypeError(`[Streaming] ${String(key)} is not callable`);
        }
        assertCurrent();
        return { receiver, callable };
    }

    _silenceExternalPromise(value) {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
        try {
            Reflect.apply(Promise.prototype.then, value, [() => {}, () => {}]);
        } catch (_) {}
    }

    _invokeCapturedExternal(captured, args, assertCurrent, operation, retireResult = null) {
        assertCurrent();
        let result;
        let callError = null;
        try {
            result = Reflect.apply(captured.callable, captured.receiver, args);
        } catch (error) {
            callError = error;
        }
        try {
            assertCurrent();
        } catch (error) {
            this._silenceExternalPromise(result);
            if (retireResult && result) {
                try { retireResult(result); } catch (_) {}
            }
            throw error;
        }
        if (callError) throw callError;
        return result;
    }

    _callExternal(receiver, key, args, assertCurrent, operation, retireResult = null) {
        const captured = this._captureExternalCallable(receiver, key, assertCurrent, operation);
        return this._invokeCapturedExternal(
            captured, args, assertCurrent, operation, retireResult,
        );
    }

    _snapshotExternalIterable(iterable, assertCurrent, operation) {
        const iteratorFactory = this._captureExternalCallable(
            iterable, Symbol.iterator, assertCurrent, `${operation} iterator`,
        );
        const iterator = this._invokeCapturedExternal(
            iteratorFactory, [], assertCurrent, `${operation} iterator`,
        );
        const next = this._captureExternalCallable(
            iterator, 'next', assertCurrent, `${operation} next`,
        );
        const values = [];
        while (true) {
            const step = this._invokeCapturedExternal(
                next, [], assertCurrent, `${operation} next`,
            );
            const done = this._readExternalMember(
                step, 'done', assertCurrent, `${operation} done`,
            );
            if (done) break;
            values.push(this._readExternalMember(
                step, 'value', assertCurrent, `${operation} value`,
            ));
        }
        return values;
    }

    _detachPlaceholderTextures() {
        const placeholders = [this._placeholderTexture, this._placeholderTexture1x1];
        this._placeholderTexture = null;
        this._placeholderTexture1x1 = null;
        return placeholders;
    }

    _destroyPlaceholderTextures(retirementSet = new Set()) {
        const placeholders = this._detachPlaceholderTextures();
        for (const texture of placeholders) this._retireGpuResource(texture, retirementSet);
    }

    destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;
        this._initialized = false;
        const error = this._streamingCancellationError();
        this._destroyError = error;

        const initOperation = this._initOperation;
        const loads = [...this._activeLoadRecords];
        const preloads = [...this._preloadOperations];
        const resources = [...this.resources.values()];
        const retirementSet = new Set();
        for (const record of loads) record.retirementSet = retirementSet;
        this._initSnapshotToken = null;
        this._initOperation = null;
        this._initPromise = null;
        this._initDescriptor = null;
        this._activeLoadRecords.clear();
        this._preloadOperations.clear();
        this.activeLoads.clear();
        this.loadQueue.items.length = 0;
        this.resources.clear();
        this.pathToId.clear();

        const loadCandidates = loads.map(record => ({
            record,
            candidate: this._detachLoadCandidate(record),
        }));
        const resourceCandidates = resources.map(resource => this._detachRegistryResource(resource));
        const placeholderCandidates = this._detachPlaceholderTextures();
        this.memoryUsed = 0;

        this._settleInitOperation(initOperation, null, error);
        for (const record of loads) this._cancelLoadRecord(record, error);
        for (const entry of loadCandidates) {
            this._retireDetachedLoadCandidate(entry.record, entry.candidate, retirementSet);
        }
        for (const candidate of resourceCandidates) {
            this._retireGpuResource(candidate?.gpuResource, retirementSet);
        }
        for (const texture of placeholderCandidates) {
            this._retireGpuResource(texture, retirementSet);
        }

        for (const operation of preloads) {
            operation.cancelled = true;
            if (operation.timeoutId !== null) clearTimeout(operation.timeoutId);
            operation.timeoutId = null;
            operation.cancelWait(error);
            this._settlePreload(operation, null, error);
        }
        return true;
    }
}

export { ResourceState, StreamingResourceType };
