// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VGPURenderGraph - Declarative render pass system with automatic resource management
 * 
 * Inspired by Frostbite Frame Graph and Unreal Engine RDG.
 * 
 * Features:
 * - Declarative pass definition with explicit resource dependencies
 * - Automatic resource state transitions and barrier batching
 * - Transient resource allocation with memory aliasing
 * - Dead pass culling (unused outputs are pruned)
 * - Topological sorting for optimal execution order
 * - Debug visualization of pass dependencies
 * 
 * Usage:
 *   const graph = new VGPURenderGraph(vgpu);
 *   
 *   graph.addPass('ShadowDepth', {
 *     writes: [{ name: 'ShadowMap', format: 'depth24plus', size: [2048, 2048] }],
 *     execute: (encoder, resources) => { ... }
 *   });
 *   
 *   graph.addPass('Lighting', {
 *     reads: ['ShadowMap', 'GBuffer'],
 *     writes: [{ name: 'LitScene', format: 'rgba16float' }],
 *     execute: (encoder, resources) => { ... }
 *   });
 *   
 *   graph.compile();
 *   graph.execute(commandEncoder);
 */

// Resource usage flags
const ResourceUsage = {
    NONE: 0,
    READ: 1,
    WRITE: 2,
    READ_WRITE: 3,
    RENDER_TARGET: 4,
    DEPTH_STENCIL: 8,
    STORAGE: 16,
    COPY_SRC: 32,
    COPY_DST: 64,
};

// Resource types
const ResourceType = {
    TEXTURE: 'texture',
    BUFFER: 'buffer',
    EXTERNAL: 'external',
};

/**
 * Represents a virtual resource in the render graph
 */
class RenderGraphResource {
    constructor(name, desc) {
        this.name = name;
        this.desc = desc;
        this.type = desc.type || ResourceType.TEXTURE;
        this.version = 0;           // Incremented on each write
        this.firstPass = -1;        // First pass that uses this resource
        this.lastPass = -1;         // Last pass that uses this resource
        this.physicalResource = null; // Actual GPU resource (allocated during compile)
        this.isExternal = desc.external || false;
        this.isTransient = !this.isExternal;
        this.aliasGroup = -1;       // For memory aliasing
    }

    get lifetimeStart() { return this.firstPass; }
    get lifetimeEnd() { return this.lastPass; }
}

/**
 * Represents a render pass in the graph
 */
class RenderGraphPass {
    constructor(name, desc) {
        this.name = name;
        this.reads = [];            // Resource names this pass reads
        this.writes = [];           // Resource descriptors this pass writes
        this.execute = desc.execute; // Execution callback
        this.isAsync = desc.async || false;
        this.isCulled = false;
        this.index = -1;            // Assigned during compilation
        this.dependencies = new Set(); // Pass indices this depends on
        this.barriers = [];         // Resource barriers to execute before this pass
    }
}

/**
 * Transient resource allocator with memory aliasing
 */
class TransientResourceAllocator {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.texturePool = new Map(); // key -> [available textures]
        this.bufferPool = new Map();  // key -> [available buffers]
        this.activeResources = new Map(); // resource name -> GPU resource
        this.frameResources = [];     // Resources to return to pool at frame end
        this._allocationRecords = new WeakMap();
        this._retiredResources = new WeakSet();
        this._destroyed = false;
        this._generation = 0;
    }

    _lifecycleError(operation = 'allocate resources') {
        const error = new Error(`[RenderGraphAllocator] destroyed; cannot ${operation}`);
        error.name = 'AbortError';
        error.code = 'VGPU_RENDER_GRAPH_ALLOCATOR_DESTROYED';
        return error;
    }

    _assertActive(operation, generation = this._generation) {
        if (this._destroyed || generation !== this._generation) {
            throw this._lifecycleError(operation);
        }
    }

    _readDescriptorValue(descriptor, key, generation, operation, assertCurrent = null) {
        const value = descriptor[key];
        this._assertActive(operation, generation);
        assertCurrent?.();
        return value;
    }

    _isPrimitive(value) {
        return value === null || (typeof value !== 'object' && typeof value !== 'function');
    }

    _snapshotPrimitive(value, hint, generation, operation, assertCurrent = null) {
        if (this._isPrimitive(value)) return value;

        const exoticToPrimitive = value[Symbol.toPrimitive];
        this._assertActive(`${operation} primitive hook`, generation);
        assertCurrent?.();
        if (exoticToPrimitive !== undefined && exoticToPrimitive !== null) {
            if (typeof exoticToPrimitive !== 'function') {
                throw new TypeError(`[RenderGraphAllocator] ${operation} Symbol.toPrimitive is not callable`);
            }
            this._assertActive(`${operation} primitive conversion`, generation);
            assertCurrent?.();
            const primitive = Reflect.apply(exoticToPrimitive, value, [hint]);
            this._assertActive(`${operation} primitive conversion`, generation);
            assertCurrent?.();
            if (!this._isPrimitive(primitive)) {
                throw new TypeError(`[RenderGraphAllocator] ${operation} did not produce a primitive`);
            }
            return primitive;
        }

        const methods = hint === 'string' ? ['toString', 'valueOf'] : ['valueOf', 'toString'];
        for (const methodName of methods) {
            const method = value[methodName];
            this._assertActive(`${operation} ${methodName} hook`, generation);
            assertCurrent?.();
            if (typeof method !== 'function') continue;
            this._assertActive(`${operation} ${methodName} conversion`, generation);
            assertCurrent?.();
            const primitive = Reflect.apply(method, value, []);
            this._assertActive(`${operation} ${methodName} conversion`, generation);
            assertCurrent?.();
            if (this._isPrimitive(primitive)) return primitive;
        }
        throw new TypeError(`[RenderGraphAllocator] ${operation} did not produce a primitive`);
    }

    _normalizeString(value, generation, operation, assertCurrent = null) {
        const primitive = this._snapshotPrimitive(
            value, 'string', generation, operation, assertCurrent,
        );
        const normalized = typeof primitive === 'string' ? primitive : String(primitive);
        this._assertActive(operation, generation);
        assertCurrent?.();
        return normalized;
    }

    _normalizeNumber(value, generation, operation, assertCurrent = null) {
        const primitive = this._snapshotPrimitive(
            value, 'number', generation, operation, assertCurrent,
        );
        const normalized = typeof primitive === 'number' ? primitive : Number(primitive);
        this._assertActive(operation, generation);
        assertCurrent?.();
        return normalized;
    }

    _normalizeBoolean(value, generation, operation, assertCurrent = null) {
        const normalized = Boolean(value);
        this._assertActive(operation, generation);
        assertCurrent?.();
        return normalized;
    }

    _snapshotName(name, generation, operation, assertCurrent = null) {
        return this._normalizeString(name, generation, operation, assertCurrent);
    }

    _snapshotTextureDescriptor(descriptor, generation, assertCurrent = null) {
        const rawFormat = this._readDescriptorValue(
            descriptor, 'format', generation, 'read texture format', assertCurrent,
        );
        const format = rawFormat === undefined ? undefined : this._normalizeString(
            rawFormat, generation, 'normalize texture format', assertCurrent,
        );
        const rawSize = this._readDescriptorValue(
            descriptor, 'size', generation, 'read texture size', assertCurrent,
        );
        const rawWidth = this._readDescriptorValue(
            rawSize, 0, generation, 'read texture width', assertCurrent,
        );
        const width = rawWidth === undefined ? undefined : this._normalizeNumber(
            rawWidth, generation, 'normalize texture width', assertCurrent,
        );
        const rawHeight = this._readDescriptorValue(
            rawSize, 1, generation, 'read texture height', assertCurrent,
        );
        const height = rawHeight === undefined ? undefined : this._normalizeNumber(
            rawHeight, generation, 'normalize texture height', assertCurrent,
        );
        const rawDepth = this._readDescriptorValue(
            rawSize, 2, generation, 'read texture depth', assertCurrent,
        );
        const depth = rawDepth === undefined ? undefined : this._normalizeNumber(
            rawDepth, generation, 'normalize texture depth', assertCurrent,
        );
        const dictionaryWidth = width === undefined
            ? this._readDescriptorValue(
                rawSize, 'width', generation, 'read texture dictionary width', assertCurrent,
            )
            : undefined;
        const normalizedDictionaryWidth = dictionaryWidth === undefined
            ? undefined
            : this._normalizeNumber(
                dictionaryWidth, generation, 'normalize texture dictionary width', assertCurrent,
            );
        const dictionaryHeight = height === undefined
            ? this._readDescriptorValue(
                rawSize, 'height', generation, 'read texture dictionary height', assertCurrent,
            )
            : undefined;
        const normalizedDictionaryHeight = dictionaryHeight === undefined
            ? undefined
            : this._normalizeNumber(
                dictionaryHeight, generation, 'normalize texture dictionary height', assertCurrent,
            );
        const dictionaryDepth = depth === undefined && (dictionaryWidth !== undefined || dictionaryHeight !== undefined)
            ? this._readDescriptorValue(
                rawSize,
                'depthOrArrayLayers',
                generation,
                'read texture dictionary depth',
                assertCurrent,
            )
            : undefined;
        const normalizedDictionaryDepth = dictionaryDepth === undefined
            ? undefined
            : this._normalizeNumber(
                dictionaryDepth, generation, 'normalize texture dictionary depth', assertCurrent,
            );
        const rawUsage = this._readDescriptorValue(
            descriptor, 'usage', generation, 'read texture usage', assertCurrent,
        );
        const usage = rawUsage === undefined ? undefined : this._normalizeNumber(
            rawUsage, generation, 'normalize texture usage', assertCurrent,
        );
        const rawRenderTarget = this._readDescriptorValue(
            descriptor,
            'renderTarget',
            generation,
            'read texture render-target flag',
            assertCurrent,
        );
        const renderTarget = this._normalizeBoolean(
            rawRenderTarget, generation, 'normalize texture render-target flag', assertCurrent,
        );
        const rawStorage = this._readDescriptorValue(
            descriptor, 'storage', generation, 'read texture storage flag', assertCurrent,
        );
        const storage = this._normalizeBoolean(
            rawStorage, generation, 'normalize texture storage flag', assertCurrent,
        );
        const rawDimension = this._readDescriptorValue(
            descriptor, 'dimension', generation, 'read texture dimension', assertCurrent,
        );
        const dimension = rawDimension === undefined ? '2d' : this._normalizeString(
            rawDimension, generation, 'normalize texture dimension', assertCurrent,
        );
        const rawMipLevelCount = this._readDescriptorValue(
            descriptor, 'mipLevelCount', generation, 'read texture mip-level count', assertCurrent,
        );
        const rawLegacyMipLevels = rawMipLevelCount === undefined
            ? this._readDescriptorValue(
                descriptor, 'mipLevels', generation, 'read texture legacy mip levels', assertCurrent,
            )
            : undefined;
        const mipLevelCount = this._normalizeNumber(
            rawMipLevelCount ?? rawLegacyMipLevels ?? 1,
            generation,
            'normalize texture mip-level count',
            assertCurrent,
        );
        const rawSampleCount = this._readDescriptorValue(
            descriptor, 'sampleCount', generation, 'read texture sample count', assertCurrent,
        );
        const sampleCount = this._normalizeNumber(
            rawSampleCount ?? 1,
            generation,
            'normalize texture sample count',
            assertCurrent,
        );
        const dictionarySize = normalizedDictionaryWidth !== undefined
            || normalizedDictionaryHeight !== undefined;
        const normalizedWidth = dictionarySize ? normalizedDictionaryWidth : width;
        const normalizedHeight = dictionarySize ? (normalizedDictionaryHeight ?? 1) : (height ?? 1);
        const normalizedDepth = dictionarySize ? (normalizedDictionaryDepth ?? 1) : (depth ?? 1);
        return {
            format,
            size: [normalizedWidth, normalizedHeight, normalizedDepth],
            usage,
            renderTarget,
            storage,
            dimension,
            mipLevelCount,
            sampleCount,
        };
    }

    _snapshotBufferDescriptor(descriptor, generation, assertCurrent = null) {
        const rawSize = this._readDescriptorValue(
            descriptor, 'size', generation, 'read buffer size', assertCurrent,
        );
        const size = rawSize === undefined ? undefined : this._normalizeNumber(
            rawSize, generation, 'normalize buffer size', assertCurrent,
        );
        const rawUsage = this._readDescriptorValue(
            descriptor, 'usage', generation, 'read buffer usage', assertCurrent,
        );
        const usage = rawUsage === undefined ? undefined : this._normalizeNumber(
            rawUsage, generation, 'normalize buffer usage', assertCurrent,
        );
        return {
            size,
            usage,
        };
    }

    _snapshotDeviceFactory(method, generation, operation, assertCurrent = null) {
        const device = this.vgpu.device;
        this._assertActive(`resolve device for ${operation}`, generation);
        assertCurrent?.();
        const factory = device[method];
        this._assertActive(`resolve ${method}`, generation);
        assertCurrent?.();
        if (typeof factory !== 'function') {
            throw new TypeError(`[RenderGraphAllocator] device.${method} is not callable`);
        }
        return { device, factory };
    }

    _scrubResourceFromPools(resource) {
        if (!resource) return false;
        let removed = false;
        for (const poolMap of [this.texturePool, this.bufferPool]) {
            for (const [key, pool] of poolMap) {
                const live = pool.filter(candidate => candidate !== resource);
                if (live.length === pool.length) continue;
                removed = true;
                if (live.length > 0) poolMap.set(key, live);
                else poolMap.delete(key);
            }
        }
        return removed;
    }

    _retireResource(resource) {
        if (!resource) return false;
        this._scrubResourceFromPools(resource);
        if (this._retiredResources.has(resource)) return false;
        this._retiredResources.add(resource);
        let destroy = null;
        try { destroy = resource.destroy; } catch (_) {}
        if (typeof destroy === 'function') {
            try { Reflect.apply(destroy, resource, []); } catch (_) {}
        }
        return true;
    }

    _acquirePooledResource(poolMap, key) {
        const pool = poolMap.get(key);
        while (pool && pool.length > 0) {
            const resource = pool.pop();
            if (!this._retiredResources.has(resource)) {
                if (pool.length === 0) poolMap.delete(key);
                return resource;
            }
        }
        if (pool) poolMap.delete(key);
        return null;
    }

    _publishAllocation(name, key, type, resource, generation) {
        this._assertActive(`publish ${type} allocation`, generation);
        const record = {
            name,
            key,
            type,
            resource,
            previousActive: this.activeResources.get(name),
        };
        this.activeResources.set(name, resource);
        this.frameResources.push(record);
        this._allocationRecords.set(resource, record);
        return resource;
    }

    _rollbackResource(name, resource) {
        if (!resource) return false;
        let record = this._allocationRecords.get(resource) || null;
        if (!record || record.name !== name) {
            for (let index = this.frameResources.length - 1; index >= 0; index--) {
                const candidate = this.frameResources[index];
                if (candidate.name === name && candidate.resource === resource) {
                    record = candidate;
                    break;
                }
            }
        }

        this.frameResources = this.frameResources.filter(candidate => candidate.resource !== resource);
        if (this.activeResources.get(name) === resource) {
            const previous = record?.previousActive;
            if (previous && !this._retiredResources.has(previous)) {
                this.activeResources.set(name, previous);
            } else {
                this.activeResources.delete(name);
            }
        }
        this._allocationRecords.delete(resource);
        return this._retireResource(resource);
    }

    rollbackAllocations(allocations, assertCurrent = null) {
        const unique = new Set();
        for (const allocation of allocations || []) {
            const resource = allocation?.resource;
            if (!resource || unique.has(resource)) continue;
            unique.add(resource);
            this._rollbackResource(allocation.name, resource);
            assertCurrent?.();
        }
    }

    _getEffectiveTextureUsage(desc) {
        return (
            (desc.usage ?? 0)
            | GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_DST
            | (desc.renderTarget ? GPUTextureUsage.RENDER_ATTACHMENT : 0)
            | (desc.storage ? GPUTextureUsage.STORAGE_BINDING : 0)
        ) >>> 0;
    }

    _getTextureKey(desc, effectiveUsage = this._getEffectiveTextureUsage(desc)) {
        return JSON.stringify([
            desc.format,
            desc.size[0],
            desc.size[1],
            desc.size[2],
            desc.dimension,
            desc.mipLevelCount,
            desc.sampleCount,
            effectiveUsage,
        ]);
    }

    _getBufferKey(desc) {
        return `${desc.size}_${desc.usage || 0}`;
    }

    allocateTexture(name, desc, assertCurrent = null) {
        const generation = this._generation;
        this._assertActive('allocate texture', generation);
        assertCurrent?.();
        const allocationName = this._snapshotName(
            name, generation, 'read texture allocation name', assertCurrent,
        );
        const descriptor = this._snapshotTextureDescriptor(desc, generation, assertCurrent);
        const effectiveUsage = this._getEffectiveTextureUsage(descriptor);
        const key = this._getTextureKey(descriptor, effectiveUsage);
        this._assertActive('resolve texture allocation key', generation);
        assertCurrent?.();

        let texture = this._acquirePooledResource(this.texturePool, key);
        const fromPool = Boolean(texture);
        if (!texture) {
            // Create new texture
            try {
                const { device, factory } = this._snapshotDeviceFactory(
                    'createTexture',
                    generation,
                    'texture allocation',
                    assertCurrent,
                );
                this._assertActive('start texture allocation', generation);
                assertCurrent?.();
                texture = Reflect.apply(factory, device, [{
                    label: `RG_${allocationName}`,
                    size: descriptor.size,
                    format: descriptor.format,
                    usage: effectiveUsage,
                    dimension: descriptor.dimension,
                    mipLevelCount: descriptor.mipLevelCount,
                    sampleCount: descriptor.sampleCount,
                }]);
                this._assertActive('complete texture allocation', generation);
                assertCurrent?.();
            } catch (error) {
                this._retireResource(texture);
                throw error;
            }
        }

        try {
            assertCurrent?.();
            return this._publishAllocation(allocationName, key, 'texture', texture, generation);
        } catch (error) {
            if (fromPool) this._retireResource(texture);
            throw error;
        }
    }

    allocateBuffer(name, desc, assertCurrent = null) {
        const generation = this._generation;
        this._assertActive('allocate buffer', generation);
        assertCurrent?.();
        const allocationName = this._snapshotName(
            name, generation, 'read buffer allocation name', assertCurrent,
        );
        const descriptor = this._snapshotBufferDescriptor(desc, generation, assertCurrent);
        const key = this._getBufferKey(descriptor);
        this._assertActive('resolve buffer allocation key', generation);
        assertCurrent?.();

        let buffer = this._acquirePooledResource(this.bufferPool, key);
        const fromPool = Boolean(buffer);
        if (!buffer) {
            try {
                const { device, factory } = this._snapshotDeviceFactory(
                    'createBuffer',
                    generation,
                    'buffer allocation',
                    assertCurrent,
                );
                this._assertActive('start buffer allocation', generation);
                assertCurrent?.();
                buffer = Reflect.apply(factory, device, [{
                    label: `RG_${allocationName}`,
                    size: descriptor.size,
                    usage: descriptor.usage || (GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
                }]);
                this._assertActive('complete buffer allocation', generation);
                assertCurrent?.();
            } catch (error) {
                this._retireResource(buffer);
                throw error;
            }
        }

        try {
            assertCurrent?.();
            return this._publishAllocation(allocationName, key, 'buffer', buffer, generation);
        } catch (error) {
            if (fromPool) this._retireResource(buffer);
            throw error;
        }
    }

    getResource(name) {
        return this.activeResources.get(name);
    }

    endFrame() {
        const generation = this._generation;
        this._assertActive('end frame', generation);
        // Return all frame resources to pools
        const frameResources = this.frameResources;
        this.frameResources = [];
        for (const { name, key, type, resource } of frameResources) {
            this._assertActive('pool frame resources', generation);
            if (type === 'texture') {
                if (!this.texturePool.has(key)) this.texturePool.set(key, []);
                this.texturePool.get(key).push(resource);
            } else {
                if (!this.bufferPool.has(key)) this.bufferPool.set(key, []);
                this.bufferPool.get(key).push(resource);
            }
            if (this.activeResources.get(name) === resource) {
                this.activeResources.delete(name);
            }
            this._allocationRecords.delete(resource);
        }
    }

    destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;

        // Snapshot the exact union before clearing state so reentrant cleanup is inert.
        const resources = new Set();
        for (const pool of this.texturePool.values()) {
            for (const texture of pool) resources.add(texture);
        }
        for (const pool of this.bufferPool.values()) {
            for (const buffer of pool) resources.add(buffer);
        }
        for (const resource of this.activeResources.values()) resources.add(resource);
        for (const record of this.frameResources) resources.add(record.resource);

        this.texturePool.clear();
        this.bufferPool.clear();
        this.activeResources.clear();
        this.frameResources = [];
        this._allocationRecords = new WeakMap();

        for (const resource of resources) this._retireResource(resource);
        return true;
    }
}

/**
 * Main Render Graph class
 */
export class VGPURenderGraph {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.passes = [];
        this.resources = new Map();     // name -> RenderGraphResource
        this.externalResources = new Map(); // name -> GPU resource
        this.allocator = new TransientResourceAllocator(vgpu);
        this.compiled = false;
        this.executionOrder = [];       // Topologically sorted pass indices
        this.debugEnabled = false;
        this._frameIndex = 0;
        this._publishedAllocations = [];
        this._destroyed = false;
        this._generation = 0;
        this._revision = 0;
        this._compileOperation = null;
        this._executionDepth = 0;
        this._destroyError = null;
    }

    _lifecycleError(operation = 'use render graph') {
        const error = new Error(`[RenderGraph] destroyed; cannot ${operation}`);
        error.name = 'AbortError';
        error.code = 'VGPU_RENDER_GRAPH_DESTROYED';
        return error;
    }

    _assertActive(operation, generation = this._generation) {
        if (this._destroyed || generation !== this._generation) {
            throw this._destroyError || this._lifecycleError(operation);
        }
        if (this.allocator?._destroyed) {
            throw this.allocator._lifecycleError(operation);
        }
    }

    _revisionError(operation = 'complete graph operation') {
        const error = new Error(`[RenderGraph] structure changed; cannot ${operation}`);
        error.name = 'AbortError';
        error.code = 'VGPU_RENDER_GRAPH_REVISION_INVALIDATED';
        return error;
    }

    _compileInProgressError() {
        const error = new Error('[RenderGraph] compilation is already in progress');
        error.name = 'InvalidStateError';
        error.code = 'VGPU_RENDER_GRAPH_COMPILE_IN_PROGRESS';
        return error;
    }

    _executionInProgressError() {
        const error = new Error('[RenderGraph] execution is already in progress');
        error.name = 'InvalidStateError';
        error.code = 'VGPU_RENDER_GRAPH_EXECUTION_IN_PROGRESS';
        return error;
    }

    _assertStructuralAuthority(generation, revision, operation) {
        this._assertActive(operation, generation);
        if (revision !== this._revision) throw this._revisionError(operation);
    }

    _assertCompileCurrent(operation, label) {
        if (!operation) throw this._compileInProgressError();
        this._assertStructuralAuthority(operation.generation, operation.revision, label);
        if (!operation.active || this._compileOperation !== operation) {
            throw this._compileInProgressError();
        }
    }

    _snapshotName(name, generation, revision, operation) {
        const value = typeof name === 'string' ? name : String(name);
        this._assertStructuralAuthority(generation, revision, operation);
        return value;
    }

    _readExternalProperty(target, key, generation, revision, operation) {
        const value = target[key];
        this._assertStructuralAuthority(generation, revision, operation);
        return value;
    }

    _captureExecutionCallable(target, key, generation, revision, operation) {
        const callable = this._readExternalProperty(
            target, key, generation, revision, operation,
        );
        if (typeof callable !== 'function') {
            throw new TypeError(`[RenderGraph] ${String(key)} is not callable`);
        }
        this._assertStructuralAuthority(generation, revision, operation);
        return { receiver: target, callable };
    }

    _invokeExecutionCallable(captured, args, generation, revision, operation) {
        this._assertStructuralAuthority(generation, revision, operation);
        let result;
        let callError = null;
        try {
            result = Reflect.apply(captured.callable, captured.receiver, args);
        } catch (error) {
            callError = error;
        }
        this._assertStructuralAuthority(generation, revision, operation);
        if (callError) throw callError;
        return result;
    }

    _hasStructuralAuthority(generation, revision) {
        return !this._destroyed
            && generation === this._generation
            && revision === this._revision
            && !this.allocator?._destroyed;
    }

    _snapshotEnumerableObject(value, generation, revision, operation) {
        if (value === null || value === undefined) return {};
        const source = Object(value);
        const keys = Reflect.ownKeys(source);
        this._assertStructuralAuthority(generation, revision, `${operation} keys`);
        const snapshot = {};
        for (const key of keys) {
            const property = Object.getOwnPropertyDescriptor(source, key);
            this._assertStructuralAuthority(generation, revision, `${operation} property`);
            if (!property?.enumerable) continue;
            const item = source[key];
            this._assertStructuralAuthority(generation, revision, `${operation} value`);
            Object.defineProperty(snapshot, key, {
                value: item,
                writable: true,
                enumerable: true,
                configurable: true,
            });
        }
        return snapshot;
    }

    _snapshotIterable(value, generation, revision, operation) {
        if (value === null || value === undefined) return [];
        const iteratorFactory = value[Symbol.iterator];
        this._assertStructuralAuthority(generation, revision, `${operation} iterator`);
        if (typeof iteratorFactory !== 'function') throw new TypeError(`${operation} is not iterable`);
        this._assertStructuralAuthority(generation, revision, `${operation} iterator creation`);
        const iterator = Reflect.apply(iteratorFactory, value, []);
        this._assertStructuralAuthority(generation, revision, `${operation} iterator creation`);
        const next = iterator.next;
        this._assertStructuralAuthority(generation, revision, `${operation} next method`);
        if (typeof next !== 'function') throw new TypeError(`${operation} iterator has no next method`);

        const snapshot = [];
        while (true) {
            this._assertStructuralAuthority(generation, revision, `${operation} next result`);
            const step = Reflect.apply(next, iterator, []);
            this._assertStructuralAuthority(generation, revision, `${operation} next result`);
            if (!step || (typeof step !== 'object' && typeof step !== 'function')) {
                throw new TypeError(`${operation} iterator returned a non-object result`);
            }
            const done = step.done;
            this._assertStructuralAuthority(generation, revision, `${operation} done flag`);
            if (done) break;
            const item = step.value;
            this._assertStructuralAuthority(generation, revision, `${operation} item`);
            snapshot.push(item);
        }
        return snapshot;
    }

    _invalidateCompiledState() {
        this.compiled = false;
        this.executionOrder = [];
    }

    _commitStructuralRevision() {
        this._revision++;
    }

    _captureCompileState() {
        return {
            compiled: this.compiled,
            executionOrder: [...this.executionOrder],
            publishedAllocations: [...this._publishedAllocations],
            resources: new Map([...this.resources.values()].map(resource => [resource, {
                firstPass: resource.firstPass,
                lastPass: resource.lastPass,
                physicalResource: resource.physicalResource,
            }])),
            passes: new Map(this.passes.map(pass => [pass, {
                index: pass.index,
                isCulled: pass.isCulled,
                dependencies: new Set(pass.dependencies),
                barriers: [...pass.barriers],
            }])),
        };
    }

    _restoreCompileState(snapshot) {
        this.compiled = snapshot.compiled;
        this.executionOrder = snapshot.executionOrder;
        this._publishedAllocations = snapshot.publishedAllocations;
        for (const [resource, state] of snapshot.resources) {
            resource.firstPass = state.firstPass;
            resource.lastPass = state.lastPass;
            resource.physicalResource = state.physicalResource;
        }
        for (const [pass, state] of snapshot.passes) {
            pass.index = state.index;
            pass.isCulled = state.isCulled;
            pass.dependencies = state.dependencies;
            pass.barriers = state.barriers;
        }
    }

    /**
     * Register an external resource (not managed by the graph)
     */
    registerExternal(name, resource, desc = {}) {
        const generation = this._generation;
        const revision = this._revision;
        this._assertStructuralAuthority(generation, revision, 'register an external resource');
        const resourceName = this._snapshotName(name, generation, revision, 'read external resource name');
        const externalResource = resource;
        this._assertStructuralAuthority(generation, revision, 'capture external resource');
        const descriptor = this._snapshotEnumerableObject(
            desc,
            generation,
            revision,
            'snapshot external resource descriptor',
        );
        this._assertStructuralAuthority(generation, revision, 'construct external resource');
        const rgResource = new RenderGraphResource(resourceName, {
            ...descriptor,
            external: true,
        });
        rgResource.physicalResource = externalResource;
        this._assertStructuralAuthority(generation, revision, 'publish external resource');

        this.externalResources.set(resourceName, externalResource);
        this.resources.set(resourceName, rgResource);
        this._invalidateCompiledState();
        this._commitStructuralRevision();
        return this;
    }

    /**
     * Add a render pass to the graph
     */
    addPass(name, desc) {
        const generation = this._generation;
        const revision = this._revision;
        this._assertStructuralAuthority(generation, revision, 'add a pass');
        const passName = this._snapshotName(name, generation, revision, 'read pass name');
        const execute = this._readExternalProperty(
            desc,
            'execute',
            generation,
            revision,
            'read pass execute callback',
        );
        const isAsync = this._readExternalProperty(desc, 'async', generation, revision, 'read pass async flag');
        const readsInput = this._readExternalProperty(desc, 'reads', generation, revision, 'read pass reads');
        const writesInput = this._readExternalProperty(desc, 'writes', generation, revision, 'read pass writes');
        const rawReads = readsInput
            ? this._snapshotIterable(readsInput, generation, revision, 'pass reads')
            : [];
        const rawWrites = writesInput
            ? this._snapshotIterable(writesInput, generation, revision, 'pass writes')
            : [];

        const reads = rawReads.map((read, index) => {
            if (typeof read === 'string') return read;
            const readName = this._readExternalProperty(
                read,
                'name',
                generation,
                revision,
                `read pass resource name ${index}`,
            );
            return this._snapshotName(
                readName,
                generation,
                revision,
                `coerce pass resource name ${index}`,
            );
        });
        const writes = rawWrites.map((write, index) => {
            const snapshot = this._snapshotEnumerableObject(
                write,
                generation,
                revision,
                `snapshot pass write ${index}`,
            );
            snapshot.name = this._snapshotName(
                snapshot.name,
                generation,
                revision,
                `coerce pass write name ${index}`,
            );
            return snapshot;
        });

        const pass = new RenderGraphPass(passName, { execute, async: isAsync });
        pass.reads.push(...reads);
        pass.writes.push(...writes);

        // Stage every resource version/create decision before touching graph state.
        const resourceUpdates = new Map();
        for (const write of writes) {
            const staged = resourceUpdates.get(write.name);
            if (staged) {
                staged.version++;
                continue;
            }
            const existing = this.resources.get(write.name);
            resourceUpdates.set(write.name, existing
                ? { resource: existing, version: existing.version + 1, isNew: false }
                : { resource: new RenderGraphResource(write.name, write), version: 0, isNew: true });
        }

        this._assertStructuralAuthority(generation, revision, 'publish pass');
        for (const [resourceName, update] of resourceUpdates) {
            update.resource.version = update.version;
            if (update.isNew) this.resources.set(resourceName, update.resource);
        }
        this.passes.push(pass);
        this._invalidateCompiledState();
        this._commitStructuralRevision();
        return this;
    }

    /**
     * Compile the render graph
     * - Cull unused passes
     * - Compute resource lifetimes
     * - Allocate transient resources
     * - Build execution order
     * - Batch resource barriers
     */
    compile() {
        if (this._compileOperation) {
            this._compileOperation.active = false;
            throw this._compileInProgressError();
        }
        if (this._executionDepth > 0) throw this._executionInProgressError();
        const generation = this._generation;
        const revision = this._revision;
        this._assertStructuralAuthority(generation, revision, 'compile');
        const operation = { generation, revision, active: true };
        this._compileOperation = operation;
        const previous = this._captureCompileState();
        let stagedAllocations = [];
        let committed = false;

        try {
            // Assign pass indices
            for (let i = 0; i < this.passes.length; i++) {
                this.passes[i].index = i;
            }

            // Build dependency graph and compute resource lifetimes
            this._buildDependencies();
            this._assertCompileCurrent(operation, 'build dependencies');

            // Cull passes with no used outputs
            this._cullPasses();
            this._assertCompileCurrent(operation, 'cull passes');

            // Topological sort
            this._topologicalSort();
            this._assertCompileCurrent(operation, 'sort passes');

            // Compute resource lifetimes based on execution order
            this._computeLifetimes();
            this._assertCompileCurrent(operation, 'compute resource lifetimes');

            // Allocate transient resources without publishing graph-visible handles.
            stagedAllocations = this._allocateResources(operation);
            this._assertCompileCurrent(operation, 'complete resource allocation');

            // Compute barriers before committing the staged graph.
            this._computeBarriers();
            this._assertCompileCurrent(operation, 'publish compiled graph');

            const physicalResources = new Map(
                stagedAllocations.map(allocation => [allocation.graphResource, allocation.resource]),
            );
            for (const resource of this.resources.values()) {
                if (!resource.isExternal) {
                    resource.physicalResource = physicalResources.get(resource) || null;
                }
            }
            this._publishedAllocations = stagedAllocations;
            this.compiled = true;
            this._commitStructuralRevision();
            operation.revision = this._revision;
            committed = true;

            // The prior compiled set is retired only after the replacement is committed.
            const assertRetirementCurrent = () => this._assertCompileCurrent(
                operation,
                'retire previous compiled allocation',
            );
            this.allocator.rollbackAllocations(
                previous.publishedAllocations,
                assertRetirementCurrent,
            );
            this._assertCompileCurrent(operation, 'complete previous allocation retirement');
            operation.active = false;
            this._compileOperation = null;
            return this;
        } catch (error) {
            this.allocator.rollbackAllocations(stagedAllocations);
            if (committed) {
                // Complete exact retirement even when a destroy hook superseded this compile.
                this.allocator.rollbackAllocations(previous.publishedAllocations);
                const stagedResources = new Set(
                    stagedAllocations.map(allocation => allocation.resource),
                );
                if (this._publishedAllocations === stagedAllocations) {
                    this._publishedAllocations = [];
                }
                for (const resource of this.resources.values()) {
                    if (stagedResources.has(resource.physicalResource)) {
                        resource.physicalResource = null;
                    }
                }
                if (!this._destroyed) {
                    const revisionAlreadySuperseded = operation.revision !== this._revision;
                    this._invalidateCompiledState();
                    if (!revisionAlreadySuperseded) this._commitStructuralRevision();
                }
            } else if (
                !this._destroyed
                && generation === this._generation
                && revision === this._revision
            ) {
                this._restoreCompileState(previous);
            }
            throw error;
        } finally {
            operation.active = false;
            if (this._compileOperation === operation) this._compileOperation = null;
        }
    }

    _buildDependencies() {
        // Map resource -> pass that produces it
        const producers = new Map();

        for (const pass of this.passes) {
            pass.dependencies.clear();
            for (const write of pass.writes) {
                producers.set(write.name, pass.index);
            }
        }
        
        // Build dependencies based on reads
        for (const pass of this.passes) {
            for (const read of pass.reads) {
                const producerIdx = producers.get(read);
                if (producerIdx !== undefined && producerIdx !== pass.index) {
                    pass.dependencies.add(producerIdx);
                }
            }
        }
    }

    _cullPasses() {
        // Mark passes as culled if their outputs are never read
        // Start from final outputs (external or marked as output)
        const used = new Set();
        const queue = [];
        
        // Find passes that write to external resources or are explicitly marked
        for (const pass of this.passes) {
            for (const write of pass.writes) {
                if (write.output || this.externalResources.has(write.name)) {
                    queue.push(pass.index);
                    break;
                }
            }
        }
        
        // If no explicit outputs, assume last pass is output
        if (queue.length === 0 && this.passes.length > 0) {
            queue.push(this.passes.length - 1);
        }
        
        // BFS backwards through dependencies
        while (queue.length > 0) {
            const idx = queue.shift();
            if (used.has(idx)) continue;
            used.add(idx);
            
            const pass = this.passes[idx];
            for (const dep of pass.dependencies) {
                if (!used.has(dep)) {
                    queue.push(dep);
                }
            }
        }
        
        // Mark unused passes as culled
        for (const pass of this.passes) {
            pass.isCulled = !used.has(pass.index);
        }
    }

    _topologicalSort() {
        const visited = new Set();
        const order = [];
        
        const visit = (idx) => {
            if (visited.has(idx)) return;
            visited.add(idx);
            
            const pass = this.passes[idx];
            if (pass.isCulled) return;
            
            for (const dep of pass.dependencies) {
                visit(dep);
            }
            order.push(idx);
        };
        
        for (let i = 0; i < this.passes.length; i++) {
            visit(i);
        }
        
        this.executionOrder = order;
    }

    _computeLifetimes() {
        // Reset lifetimes
        for (const resource of this.resources.values()) {
            resource.firstPass = -1;
            resource.lastPass = -1;
        }
        
        // Compute based on execution order
        for (let execIdx = 0; execIdx < this.executionOrder.length; execIdx++) {
            const pass = this.passes[this.executionOrder[execIdx]];
            
            // Reads
            for (const read of pass.reads) {
                const resource = this.resources.get(read);
                if (resource) {
                    if (resource.firstPass === -1) resource.firstPass = execIdx;
                    resource.lastPass = execIdx;
                }
            }
            
            // Writes
            for (const write of pass.writes) {
                const resource = this.resources.get(write.name);
                if (resource) {
                    if (resource.firstPass === -1) resource.firstPass = execIdx;
                    resource.lastPass = execIdx;
                }
            }
        }
    }

    _allocateResources(operation) {
        this._assertCompileCurrent(operation, 'allocate resources');
        const staged = [];
        const assertCurrent = () => this._assertCompileCurrent(operation, 'allocate graph resource');

        try {
            // Stage every allocation before any RenderGraphResource publishes it.
            for (const [name, graphResource] of this.resources) {
                this._assertCompileCurrent(operation, `inspect resource ${name}`);
                if (graphResource.isExternal) continue;
                if (graphResource.firstPass === -1) continue; // Never used

                let resource = null;
                if (graphResource.type === ResourceType.TEXTURE) {
                    resource = this.allocator.allocateTexture(name, {
                        format: graphResource.desc.format || 'rgba8unorm',
                        size: graphResource.desc.size || [1, 1],
                        usage: graphResource.desc.usage,
                        renderTarget: graphResource.desc.renderTarget !== false,
                        storage: graphResource.desc.storage || false,
                        dimension: graphResource.desc.dimension,
                        mipLevelCount: graphResource.desc.mipLevelCount,
                        mipLevels: graphResource.desc.mipLevels || 1,
                        sampleCount: graphResource.desc.sampleCount,
                    }, assertCurrent);
                } else if (graphResource.type === ResourceType.BUFFER) {
                    resource = this.allocator.allocateBuffer(name, {
                        size: graphResource.desc.size,
                        usage: graphResource.desc.usage,
                    }, assertCurrent);
                }

                if (!resource) continue;
                staged.push({ name, graphResource, resource });
                this._assertCompileCurrent(operation, `complete allocation for ${name}`);
            }
            return staged;
        } catch (error) {
            this.allocator.rollbackAllocations(staged);
            throw error;
        }
    }

    _computeBarriers() {
        // Track resource states
        const resourceStates = new Map();
        
        for (let execIdx = 0; execIdx < this.executionOrder.length; execIdx++) {
            const pass = this.passes[this.executionOrder[execIdx]];
            pass.barriers = [];
            
            // Check reads - need transition to shader resource
            for (const read of pass.reads) {
                const prevState = resourceStates.get(read);
                if (prevState && prevState !== 'read') {
                    pass.barriers.push({
                        resource: read,
                        from: prevState,
                        to: 'read',
                    });
                }
                resourceStates.set(read, 'read');
            }
            
            // Check writes - need transition to render target / storage
            for (const write of pass.writes) {
                const targetState = write.storage ? 'storage' : 'write';
                const prevState = resourceStates.get(write.name);
                if (prevState && prevState !== targetState) {
                    pass.barriers.push({
                        resource: write.name,
                        from: prevState,
                        to: targetState,
                    });
                }
                resourceStates.set(write.name, targetState);
            }
        }
    }

    /**
     * Execute the compiled render graph
     */
    execute(commandEncoder) {
        if (this._executionDepth > 0) throw this._executionInProgressError();
        const generation = this._generation;
        this._assertActive('execute', generation);
        if (!this.compiled) {
            this.compile();
            this._assertActive('execute compiled graph', generation);
        }
        const revision = this._revision;
        this._assertStructuralAuthority(generation, revision, 'execute compiled graph');
        this._executionDepth++;

        try {
            // Build a revision-bound resource accessor.
            const resources = {
                get: (name) => {
                    this._assertStructuralAuthority(generation, revision, 'access pass resources');
                    const resourceName = this._snapshotName(
                        name,
                        generation,
                        revision,
                        'read pass resource accessor name',
                    );
                    const resource = this.resources.get(resourceName);
                    return resource ? resource.physicalResource : this.externalResources.get(resourceName);
                },
                getTexture: (name) => resources.get(name),
                getBuffer: (name) => resources.get(name),
                getView: (name, desc) => {
                    const tex = resources.get(name);
                    if (!tex) return null;
                    const descriptor = this._snapshotEnumerableObject(
                        desc,
                        generation,
                        revision,
                        'snapshot pass texture view descriptor',
                    );
                    const createView = this._captureExecutionCallable(
                        tex,
                        'createView',
                        generation,
                        revision,
                        'resolve pass texture view factory',
                    );
                    return this._invokeExecutionCallable(
                        createView,
                        [descriptor],
                        generation,
                        revision,
                        'create a pass resource view',
                    );
                },
            };

            // Execute passes in order under the exact compiled revision.
            const executionOrder = [...this.executionOrder];
            for (const passIdx of executionOrder) {
                this._assertStructuralAuthority(generation, revision, 'execute pass');
                const pass = this.passes[passIdx];
                if (!pass) {
                    throw new Error(`[RenderGraph] compiled pass ${passIdx} is unavailable`);
                }
                if (pass.isCulled) continue;

                const executePass = this._captureExecutionCallable(
                    pass,
                    'execute',
                    generation,
                    revision,
                    'resolve pass callback',
                );
                const debugEnabled = this._readExternalProperty(
                    this,
                    'debugEnabled',
                    generation,
                    revision,
                    'read graph debug state',
                );
                let debugGroupOpen = false;
                let popDebugGroup = null;
                if (debugEnabled) {
                    const passName = this._snapshotName(
                        this._readExternalProperty(
                            pass,
                            'name',
                            generation,
                            revision,
                            'read pass debug name',
                        ),
                        generation,
                        revision,
                        'normalize pass debug name',
                    );
                    const pushDebugGroup = this._captureExecutionCallable(
                        commandEncoder,
                        'pushDebugGroup',
                        generation,
                        revision,
                        'resolve pass debug marker',
                    );
                    popDebugGroup = this._captureExecutionCallable(
                        commandEncoder,
                        'popDebugGroup',
                        generation,
                        revision,
                        'resolve pass debug marker cleanup',
                    );
                    this._invokeExecutionCallable(
                        pushDebugGroup,
                        [`Pass: ${passName}`],
                        generation,
                        revision,
                        'push a pass debug marker',
                    );
                    debugGroupOpen = true;
                }

                try {
                    this._assertStructuralAuthority(generation, revision, 'begin pass callback');
                    this._invokeExecutionCallable(
                        executePass,
                        [commandEncoder, resources],
                        generation,
                        revision,
                        'execute pass callback',
                    );
                } finally {
                    if (debugGroupOpen && popDebugGroup) {
                        if (this._hasStructuralAuthority(generation, revision)) {
                            this._invokeExecutionCallable(
                                popDebugGroup,
                                [],
                                generation,
                                revision,
                                'pop a pass debug marker',
                            );
                        } else {
                            // A pass callback may intentionally destroy/reset the graph. The
                            // exact marker cleanup captured while live must still balance the
                            // encoder, but no fresh post-teardown getter is consulted.
                            try {
                                Reflect.apply(
                                    popDebugGroup.callable,
                                    popDebugGroup.receiver,
                                    [],
                                );
                            } catch (_) {}
                        }
                    }
                }
                this._assertStructuralAuthority(generation, revision, `complete pass ${pass.name}`);
            }

            this._assertStructuralAuthority(generation, revision, 'complete execution');
            this._frameIndex++;
        } finally {
            this._executionDepth--;
        }
    }

    /**
     * Reset the graph for next frame
     */
    reset() {
        const generation = this._generation;
        const revision = this._revision;
        this._assertStructuralAuthority(generation, revision, 'reset');
        this.passes = [];
        // Keep external resources, clear transient
        for (const [name, resource] of this.resources) {
            if (!resource.isExternal) {
                this.resources.delete(name);
            }
        }
        this._invalidateCompiledState();
        this._commitStructuralRevision();
    }

    /**
     * End frame - return transient resources to pool
     */
    endFrame() {
        const generation = this._generation;
        const revision = this._revision;
        this._assertStructuralAuthority(generation, revision, 'end frame');
        this.allocator.endFrame();
        this._assertStructuralAuthority(generation, revision, 'complete allocator frame');
        this._publishedAllocations = [];
        this.reset();
    }

    /**
     * Get debug info about the graph
     */
    getDebugInfo() {
        this._assertActive('read debug information');
        const info = {
            passCount: this.passes.length,
            culledCount: this.passes.filter(p => p.isCulled).length,
            resourceCount: this.resources.size,
            transientCount: [...this.resources.values()].filter(r => r.isTransient).length,
            executionOrder: this.executionOrder.map(i => this.passes[i].name),
            passes: this.passes.map(p => ({
                name: p.name,
                culled: p.isCulled,
                reads: p.reads,
                writes: p.writes.map(w => w.name),
                dependencies: [...p.dependencies].map(d => this.passes[d].name),
                barriers: p.barriers,
            })),
        };
        return info;
    }

    /**
     * Generate DOT graph for visualization
     */
    toDOT() {
        this._assertActive('generate DOT output');
        let dot = 'digraph RenderGraph {\n';
        dot += '  rankdir=LR;\n';
        dot += '  node [shape=box];\n\n';
        
        // Passes
        for (const pass of this.passes) {
            const style = pass.isCulled ? ', style=dashed, color=gray' : '';
            dot += `  "${pass.name}" [label="${pass.name}"${style}];\n`;
        }
        
        dot += '\n';
        
        // Dependencies
        for (const pass of this.passes) {
            for (const dep of pass.dependencies) {
                dot += `  "${this.passes[dep].name}" -> "${pass.name}";\n`;
            }
        }
        
        dot += '}\n';
        return dot;
    }

    destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;
        this._revision++;
        this._destroyError = this._lifecycleError();
        if (this._compileOperation) this._compileOperation.active = false;
        this._invalidateCompiledState();

        const allocator = this.allocator;
        this._publishedAllocations = [];
        this.resources.clear();
        this.externalResources.clear();
        this.passes = [];
        allocator.destroy();
        return true;
    }

    dispose() {
        return this.destroy();
    }
}

/**
 * Builder pattern for ergonomic graph construction
 */
export class RenderGraphBuilder {
    constructor(graph) {
        this.graph = graph;
        this._currentPass = null;
    }

    static create(vgpu) {
        return new RenderGraphBuilder(new VGPURenderGraph(vgpu));
    }

    _assertActive(operation) {
        this.graph._assertActive(operation);
    }

    external(name, resource, desc) {
        this._assertActive('register a builder external resource');
        this.graph.registerExternal(name, resource, desc);
        return this;
    }

    pass(name) {
        this._assertActive('start a builder pass');
        this._currentPass = { name, reads: [], writes: [], execute: null };
        return this;
    }

    read(resourceName) {
        this._assertActive('add a builder read');
        if (this._currentPass) {
            this._currentPass.reads.push(resourceName);
        }
        return this;
    }

    write(desc) {
        this._assertActive('add a builder write');
        if (this._currentPass) {
            this._currentPass.writes.push(desc);
        }
        return this;
    }

    execute(fn) {
        this._assertActive('add a builder execute callback');
        if (this._currentPass) {
            this._currentPass.execute = fn;
            this.graph.addPass(this._currentPass.name, this._currentPass);
            this._currentPass = null;
        }
        return this;
    }

    build() {
        this._assertActive('build');
        return this.graph.compile();
    }

    destroy() {
        this._currentPass = null;
        return this.graph.destroy();
    }

    dispose() {
        return this.destroy();
    }
}

export { ResourceUsage, ResourceType };
