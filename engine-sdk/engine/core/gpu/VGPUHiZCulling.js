// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VGPUHiZCulling - Hierarchical-Z Occlusion Culling
 * 
 * Uses a hierarchical depth buffer (mip chain) to perform fast GPU occlusion culling.
 * Objects are tested against the previous frame's depth to determine visibility.
 * 
 * Features:
 * - Automatic HiZ pyramid generation from depth buffer
 * - Conservative depth testing for robust culling
 * - Temporal reprojection for reduced latency
 * - Support for bounding boxes and spheres
 * - Integration with VGPUIndirectRenderer
 * - **Dynamic buffer sizing** - grows as needed
 */

const WORKGROUP_SIZE = 8;
const INITIAL_OBJECT_CAPACITY = 256;
const GROWTH_FACTOR = 2;

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _hizUniformBuffer = new ArrayBuffer(256);
const _hizUniformF32 = new Float32Array(_hizUniformBuffer);
const _hizUniformU32 = new Uint32Array(_hizUniformBuffer);
const _mipSizeData = new Uint32Array(2);

/**
 * HiZ pyramid generation shader - creates mip chain from depth buffer
 */
const HIZ_DOWNSAMPLE_SHADER = /* wgsl */`
@group(0) @binding(0) var srcDepth: texture_2d<f32>;
@group(0) @binding(1) var dstDepth: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> mipSize: vec2<u32>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= mipSize.x || gid.y >= mipSize.y) { return; }
    
    let srcCoord = gid.xy * 2u;
    
    // Sample 4 texels from source mip
    let d00 = textureLoad(srcDepth, srcCoord + vec2<u32>(0u, 0u), 0).r;
    let d10 = textureLoad(srcDepth, srcCoord + vec2<u32>(1u, 0u), 0).r;
    let d01 = textureLoad(srcDepth, srcCoord + vec2<u32>(0u, 1u), 0).r;
    let d11 = textureLoad(srcDepth, srcCoord + vec2<u32>(1u, 1u), 0).r;
    
    // Conservative: take maximum depth (furthest, reverse-Z)
    // For standard Z: take minimum
    let maxDepth = max(max(d00, d10), max(d01, d11));
    
    textureStore(dstDepth, gid.xy, vec4<f32>(maxDepth, 0.0, 0.0, 1.0));
}
`;

/**
 * HiZ occlusion test shader - tests bounding boxes against HiZ pyramid
 */
const HIZ_OCCLUSION_TEST_SHADER = /* wgsl */`
struct BoundingBox {
    minPos: vec3<f32>,
    pad0: f32,
    maxPos: vec3<f32>,
    pad1: f32,
}

struct OcclusionUniforms {
    viewProj: mat4x4<f32>,
    prevViewProj: mat4x4<f32>,
    screenSize: vec2<f32>,
    hizMipLevels: u32,
    objectCount: u32,
}

@group(0) @binding(0) var<uniform> uniforms: OcclusionUniforms;
@group(0) @binding(1) var hizTexture: texture_2d<f32>;
@group(0) @binding(2) var hizSampler: sampler;
@group(0) @binding(3) var<storage, read> boundingBoxes: array<BoundingBox>;
@group(0) @binding(4) var<storage, read_write> visibilityFlags: array<u32>;

fn projectPoint(p: vec3<f32>) -> vec4<f32> {
    return uniforms.viewProj * vec4<f32>(p, 1.0);
}

fn ndcToScreen(ndc: vec2<f32>) -> vec2<f32> {
    return (ndc * 0.5 + 0.5) * uniforms.screenSize;
}

// Get conservative screen-space AABB from 8 corners of bounding box
fn getScreenAABB(bbox: BoundingBox) -> vec4<f32> {
    var minScreen = vec2<f32>(1e10);
    var maxScreen = vec2<f32>(-1e10);
    var minZ = 1.0;
    
    // Test all 8 corners
    let corners = array<vec3<f32>, 8>(
        vec3<f32>(bbox.minPos.x, bbox.minPos.y, bbox.minPos.z),
        vec3<f32>(bbox.maxPos.x, bbox.minPos.y, bbox.minPos.z),
        vec3<f32>(bbox.minPos.x, bbox.maxPos.y, bbox.minPos.z),
        vec3<f32>(bbox.maxPos.x, bbox.maxPos.y, bbox.minPos.z),
        vec3<f32>(bbox.minPos.x, bbox.minPos.y, bbox.maxPos.z),
        vec3<f32>(bbox.maxPos.x, bbox.minPos.y, bbox.maxPos.z),
        vec3<f32>(bbox.minPos.x, bbox.maxPos.y, bbox.maxPos.z),
        vec3<f32>(bbox.maxPos.x, bbox.maxPos.y, bbox.maxPos.z),
    );
    
    for (var i = 0u; i < 8u; i++) {
        let clip = projectPoint(corners[i]);
        if (clip.w <= 0.0) {
            // Behind camera - assume visible
            return vec4<f32>(0.0, 0.0, uniforms.screenSize.x, uniforms.screenSize.y);
        }
        let ndc = clip.xy / clip.w;
        let screen = ndcToScreen(ndc);
        minScreen = min(minScreen, screen);
        maxScreen = max(maxScreen, screen);
        minZ = min(minZ, clip.z / clip.w);
    }
    
    return vec4<f32>(minScreen.x, minScreen.y, maxScreen.x - minScreen.x, maxScreen.y - minScreen.y);
}

fn selectHiZMip(screenSize: vec2<f32>) -> u32 {
    let maxDim = max(screenSize.x, screenSize.y);
    let mip = u32(ceil(log2(maxDim)));
    return min(mip, uniforms.hizMipLevels - 1u);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= uniforms.objectCount) { return; }
    
    let bbox = boundingBoxes[idx];
    let screenAABB = getScreenAABB(bbox);
    
    // Clamp to screen
    let minX = max(0.0, screenAABB.x);
    let minY = max(0.0, screenAABB.y);
    let maxX = min(uniforms.screenSize.x, screenAABB.x + screenAABB.z);
    let maxY = min(uniforms.screenSize.y, screenAABB.y + screenAABB.w);
    
    // Off-screen check
    if (minX >= maxX || minY >= maxY) {
        visibilityFlags[idx] = 0u;
        return;
    }
    
    let size = vec2<f32>(maxX - minX, maxY - minY);
    let mip = selectHiZMip(size);
    
    // Sample HiZ at appropriate mip level
    let mipScale = 1.0 / f32(1u << mip);
    let samplePos = vec2<f32>((minX + maxX) * 0.5, (minY + maxY) * 0.5) * mipScale / uniforms.screenSize;
    
    let hizDepth = textureSampleLevel(hizTexture, hizSampler, samplePos, f32(mip)).r;
    
    // Get closest depth of bounding box
    var closestZ = 1.0;
    let corners = array<vec3<f32>, 8>(
        vec3<f32>(bbox.minPos.x, bbox.minPos.y, bbox.minPos.z),
        vec3<f32>(bbox.maxPos.x, bbox.minPos.y, bbox.minPos.z),
        vec3<f32>(bbox.minPos.x, bbox.maxPos.y, bbox.minPos.z),
        vec3<f32>(bbox.maxPos.x, bbox.maxPos.y, bbox.minPos.z),
        vec3<f32>(bbox.minPos.x, bbox.minPos.y, bbox.maxPos.z),
        vec3<f32>(bbox.maxPos.x, bbox.minPos.y, bbox.maxPos.z),
        vec3<f32>(bbox.minPos.x, bbox.maxPos.y, bbox.maxPos.z),
        vec3<f32>(bbox.maxPos.x, bbox.maxPos.y, bbox.maxPos.z),
    );
    
    for (var i = 0u; i < 8u; i++) {
        let clip = projectPoint(corners[i]);
        if (clip.w > 0.0) {
            closestZ = min(closestZ, clip.z / clip.w);
        }
    }
    
    // Occlusion test (reverse-Z: closer objects have higher Z values)
    // Object is visible if its closest point is in front of HiZ depth
    let isVisible = closestZ >= hizDepth;
    visibilityFlags[idx] = select(0u, 1u, isVisible);
}
`;

/**
 * Hierarchical-Z Occlusion Culling System
 */
export class VGPUHiZCulling {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        
        // HiZ pyramid texture
        this.hizTexture = null;
        this.hizViews = [];         // One view per mip level
        this.hizMipLevels = 0;
        this.width = 0;
        this.height = 0;
        
        // Pipelines
        this._downsamplePipeline = null;
        this._occlusionPipeline = null;
        
        // Buffers
        this.boundingBoxBuffer = null;
        this.visibilityBuffer = null;
        this.uniformBuffer = null;
        
        // Bind groups (per mip for downsample)
        this._downsampleBindGroups = [];
        this._occlusionBindGroup = null;
        
        // Sampler
        this._hizSampler = null;
        
        // Capacity (grows dynamically)
        this._objectCapacity = 0;

        this._objectCount = 0;
        
        // Previous frame data for temporal
        this._prevViewProj = new Float32Array(16);
        
        this._initialized = false;

        this._destroyed = false;

        this._generation = 0;

        this._mipSizeBuffers = [];

        this._initOperation = null;

        this._initDescriptor = null;

        this._capacityOperation = null;

        this._resizeOperation = null;
    }

    _destroyError() {

        const error = new Error('[vGPU HiZ] Culling system has been destroyed');

        error.name = 'AbortError';

        error.code = 'VGPU_HIZ_CULLING_DESTROYED';

        return error;

    }



    _assertAlive(generation = this._generation) {

        if (this._destroyed || generation !== this._generation) throw this._destroyError();

    }

    _assertReady(generation = this._generation) {
        this._assertAlive(generation);
        if (
            !this._initialized
            || !this.hizTexture
            || !this._downsamplePipeline
            || !this._occlusionPipeline
            || !this.uniformBuffer
            || !this._hizSampler
        ) {
            const error = new Error('[vGPU HiZ] Culling system has not been initialized');
            error.code = 'VGPU_HIZ_CULLING_NOT_INITIALIZED';
            throw error;
        }
    }

    _invalidHostMethodError(methodName) {
        const error = new TypeError(`[vGPU HiZ] Host method ${methodName} is not callable`);
        error.code = 'VGPU_HIZ_HOST_METHOD_INVALID';
        return error;
    }

    _captureHostProperty(receiver, propertyName, assertCurrent) {
        assertCurrent();
        let value;
        try {
            value = receiver[propertyName];
        } catch (error) {
            assertCurrent();
            throw error;
        }
        assertCurrent();
        return value;
    }

    _captureHostMethod(receiver, methodName, assertCurrent) {
        const method = this._captureHostProperty(receiver, methodName, assertCurrent);
        if (typeof method !== 'function') throw this._invalidHostMethodError(methodName);
        assertCurrent();
        return method;
    }

    _invokeHostMethod(receiver, methodName, args, assertCurrent, stageResult = null) {
        const method = this._captureHostMethod(receiver, methodName, assertCurrent);
        assertCurrent();
        let result;
        try {
            result = Reflect.apply(method, receiver, args);
        } catch (error) {
            assertCurrent();
            throw error;
        }
        if (stageResult) stageResult(result);
        assertCurrent();
        return result;
    }

    _retireResource(resource, retiredResources = null) {
        if (!resource) return false;
        if (retiredResources?.has(resource)) return false;
        retiredResources?.add(resource);
        let destroyMethod;
        try { destroyMethod = resource.destroy; } catch (_) { return false; }
        if (typeof destroyMethod !== 'function') return false;
        try { Reflect.apply(destroyMethod, resource, []); } catch (_) {}
        return true;
    }

    _snapshotCount(value, label, generation) {
        this._assertAlive(generation);
        const numericValue = Number(value);
        this._assertAlive(generation);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
            throw new RangeError(`[vGPU HiZ] ${label} must be a finite non-negative number`);
        }
        const count = Math.floor(numericValue);
        this._assertAlive(generation);
        if (!Number.isSafeInteger(count)) {
            throw new RangeError(`[vGPU HiZ] ${label} exceeds the supported integer range`);
        }
        return count;
    }

    _snapshotAliveDimension(value, label, generation) {
        this._assertAlive(generation);
        const numericValue = Number(value);
        this._assertAlive(generation);
        if (!Number.isFinite(numericValue) || numericValue < 1) {
            throw new RangeError(`[vGPU HiZ] ${label} must be a finite positive number`);
        }
        const dimension = Math.floor(numericValue);
        this._assertAlive(generation);
        if (!Number.isSafeInteger(dimension) || dimension < 1) {
            throw new RangeError(`[vGPU HiZ] ${label} exceeds the supported integer range`);
        }
        return dimension;
    }

    _snapshotDimension(value, label, generation) {
        this._assertReady(generation);
        const dimension = this._snapshotAliveDimension(value, label, generation);
        this._assertReady(generation);
        return dimension;
    }

    _snapshotBoundingBoxData(data, generation) {
        this._assertReady(generation);
        const rawLength = data?.length;
        this._assertReady(generation);
        const numericLength = Number(rawLength);
        this._assertReady(generation);
        if (!Number.isSafeInteger(numericLength) || numericLength < 0) {
            throw new RangeError('[vGPU HiZ] Bounding-box data must have a finite integer length');
        }
        const snapshot = new Float32Array(numericLength);
        this._assertReady(generation);
        for (let index = 0; index < numericLength; index++) {
            const rawValue = data[index];
            this._assertReady(generation);
            const numericValue = Number(rawValue);
            this._assertReady(generation);
            snapshot[index] = numericValue;
        }
        return snapshot;
    }

    _snapshotViewProjection(viewProj, generation) {
        this._assertReady(generation);
        const snapshot = new Float32Array(16);
        for (let index = 0; index < snapshot.length; index++) {
            const rawValue = viewProj?.[index];
            this._assertReady(generation);
            const numericValue = Number(rawValue);
            this._assertReady(generation);
            snapshot[index] = numericValue;
        }
        return snapshot;
    }



    init(width, height) {

        const generation = this._generation;

        let normalizedWidth;

        let normalizedHeight;

        try {

            this._assertAlive(generation);

            normalizedWidth = this._snapshotAliveDimension(width, 'Width', generation);

            this._assertAlive(generation);

            normalizedHeight = this._snapshotAliveDimension(height, 'Height', generation);

            this._assertAlive(generation);

        } catch (error) {

            return Promise.reject(error);

        }

        const descriptor = `${normalizedWidth}x${normalizedHeight}`;

        if (this._initialized) {

            if (this._initDescriptor !== descriptor) {

                const error = new Error('[vGPU HiZ] Already initialized with different dimensions');

                error.code = 'VGPU_HIZ_INIT_OPTIONS_MISMATCH';

                return Promise.reject(error);

            }

            return Promise.resolve(this);

        }

        if (this._initOperation) {

            if (this._initOperation.descriptor !== descriptor) {

                const error = new Error('[vGPU HiZ] Initialization already pending with different dimensions');

                error.code = 'VGPU_HIZ_INIT_OPTIONS_MISMATCH';

                return Promise.reject(error);

            }

            return this._initOperation.promise;

        }

        let resolvePublic;

        let rejectPublic;

        const operation = { generation, descriptor, settled: false, promise: null };

        operation.promise = new Promise((resolve, reject) => {

            resolvePublic = resolve;

            rejectPublic = reject;

        });

        operation.resolve = resolvePublic;

        operation.reject = rejectPublic;

        void operation.promise.catch(() => {});

        this._initOperation = operation;

        let rawPromise;

        try { rawPromise = this._initialize(normalizedWidth, normalizedHeight, generation); } catch (error) {

            this._settleInit(operation, null, error);

            return operation.promise;

        }

        void Promise.resolve(rawPromise).then(

            () => {

                if (!this._isInitCurrent(operation)) return;

                this._initDescriptor = descriptor;

                this._settleInit(operation, this, null);

            },

            error => {

                if (this._isInitCurrent(operation)) {

                    this._settleInit(operation, null, error);

                    this.destroy();

                }

            },

        );

        return operation.promise;

    }



    _isInitCurrent(operation) {

        return Boolean(operation)

            && !operation.settled

            && !this._destroyed

            && operation.generation === this._generation

            && this._initOperation === operation;

    }



    _settleInit(operation, value, error) {

        if (!operation || operation.settled) return false;

        operation.settled = true;

        if (this._initOperation === operation) this._initOperation = null;

        if (error) operation.reject(error);

        else operation.resolve(value);

        return true;

    }



    async _initialize(normalizedWidth, normalizedHeight, generation) {

        this._assertAlive(generation);

        const assertAlive = () => this._assertAlive(generation);

        const device = this.device;

        assertAlive();

        const maxDimension = Math.max(normalizedWidth, normalizedHeight);

        this._assertAlive(generation);

        const mipExponent = Math.log2(maxDimension);

        this._assertAlive(generation);

        const mipLevels = Math.floor(mipExponent) + 1;

        this._assertAlive(generation);

        this.width = normalizedWidth;

        this.height = normalizedHeight;

        this.hizMipLevels = mipLevels;

        // Create HiZ texture with mip chain only after every input coercion and
        // derived dimension calculation has passed the captured lifecycle fence.
        this._assertAlive(generation);

        this._createHiZTexture(generation);
        
        // Create pipelines
        await this._createPipelines(generation);

        this._assertAlive(generation);
        
        // Create fixed-size uniform buffer
        let uniformBuffer = null;

        try {

            this._invokeHostMethod(device, 'createBuffer', [{
                label: 'HiZ_Uniforms',
                size: 256,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }], assertAlive, candidate => { uniformBuffer = candidate; });

        } catch (error) {

            this._retireResource(uniformBuffer);

            throw error;

        }

        this.uniformBuffer = uniformBuffer;
        
        // Create mip size uniform buffers (for downsample)
        this._mipSizeBuffers = [];
        for (let i = 1; i < this.hizMipLevels; i++) {
            let mipSizeBuffer = null;

            try {

                this._invokeHostMethod(device, 'createBuffer', [{
                    label: `HiZ_MipSize_${i}`,
                    size: 8,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                }], assertAlive, candidate => { mipSizeBuffer = candidate; });

            } catch (error) {

                this._retireResource(mipSizeBuffer);

                throw error;

            }

            this._mipSizeBuffers.push(mipSizeBuffer);
        }
        
        // Create sampler
        const hizSampler = this._invokeHostMethod(device, 'createSampler', [{
            label: 'HiZ_Sampler',
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        }], assertAlive);

        this._hizSampler = hizSampler;
        
        this._initialized = true;
        return this;
    }

    /**
     * Ensure object buffers have sufficient capacity
     */
    _ensureObjectCapacity(requiredCount) {
        const generation = this._generation;
        this._assertAlive(generation);
        const normalizedRequiredCount = this._snapshotCount(requiredCount, 'Object count', generation);
        this._assertAlive(generation);
        if (this._objectCapacity >= normalizedRequiredCount) return false;

        let newCapacity = Math.max(INITIAL_OBJECT_CAPACITY, this._objectCapacity);
        this._assertAlive(generation);
        while (newCapacity < normalizedRequiredCount) {
            newCapacity = Math.ceil(newCapacity * GROWTH_FACTOR);
            this._assertAlive(generation);
        }

        const operation = {
            generation,
            boundingBoxBuffer: null,
            visibilityBuffer: null,
            retiredResources: new WeakSet(),
        };
        this._assertAlive(generation);
        this._capacityOperation = operation;

        try {
            const assertCurrent = () => this._assertCapacityOperationCurrent(operation);
            const device = this.device;
            assertCurrent();
            const boundingBoxBuffer = this._invokeHostMethod(device, 'createBuffer', [{
                label: 'HiZ_BoundingBoxes',
                size: newCapacity * 32,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }], assertCurrent, candidate => { operation.boundingBoxBuffer = candidate; });

            const visibilityBuffer = this._invokeHostMethod(device, 'createBuffer', [{
                label: 'HiZ_Visibility',
                size: newCapacity * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            }], assertCurrent, candidate => { operation.visibilityBuffer = candidate; });

            const previousBoundingBoxBuffer = this.boundingBoxBuffer;
            const previousVisibilityBuffer = this.visibilityBuffer;
            this.boundingBoxBuffer = boundingBoxBuffer;
            this.visibilityBuffer = visibilityBuffer;
            this._objectCapacity = newCapacity;
            this._occlusionBindGroup = null;
            operation.boundingBoxBuffer = null;
            operation.visibilityBuffer = null;
            if (this._capacityOperation === operation) this._capacityOperation = null;
            this._generation++;
            const committedGeneration = this._generation;
            this._retireResource(previousBoundingBoxBuffer);
            this._assertAlive(committedGeneration);
            this._retireResource(previousVisibilityBuffer);
            this._assertAlive(committedGeneration);
            return true;
        } catch (error) {
            if (this._capacityOperation === operation) this._capacityOperation = null;
            this._retireCapacityOperation(operation);
            throw error;
        }
    }

    _assertCapacityOperationCurrent(operation) {
        if (
            this._destroyed
            || operation.generation !== this._generation
            || this._capacityOperation !== operation
        ) {
            throw this._destroyError();
        }
    }

    _retireCapacityOperation(operation) {
        if (!operation) return;
        const resources = new Set([
            operation.boundingBoxBuffer,
            operation.visibilityBuffer,
        ].filter(Boolean));
        operation.boundingBoxBuffer = null;
        operation.visibilityBuffer = null;
        for (const resource of resources) {
            this._retireResource(resource, operation.retiredResources);
        }
    }

    _createHiZTexture(generation = this._generation) {
        let texture = null;

        try {
            const assertAlive = () => this._assertAlive(generation);
            const device = this.device;
            assertAlive();

            // HiZ texture (r32float for depth values)
            this._invokeHostMethod(device, 'createTexture', [{
                label: 'HiZ_Pyramid',
                size: [this.width, this.height],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING |
                       GPUTextureUsage.STORAGE_BINDING |
                       GPUTextureUsage.COPY_DST,
                mipLevelCount: this.hizMipLevels,
            }], assertAlive, candidate => { texture = candidate; });

            // Create view for each mip level
            const views = [];
            for (let i = 0; i < this.hizMipLevels; i++) {
                views.push(this._invokeHostMethod(texture, 'createView', [{
                    label: `HiZ_Mip${i}`,
                    baseMipLevel: i,
                    mipLevelCount: 1,
                }], assertAlive));
            }

            const previous = this.hizTexture;

            this.hizTexture = texture;

            this.hizViews = views;

            texture = null;

            this._retireResource(previous);

            assertAlive();

        } catch (error) {

            this._retireResource(texture);

            throw error;

        }

    }

    async _createPipelines(generation = this._generation) {
        const assertAlive = () => this._assertAlive(generation);
        const device = this.device;
        assertAlive();

        // Downsample pipeline
        const downsampleModule = this._invokeHostMethod(device, 'createShaderModule', [{
            label: 'HiZ_Downsample',
            code: HIZ_DOWNSAMPLE_SHADER,
        }], assertAlive);
        
        const downsamplePipeline = this._invokeHostMethod(device, 'createComputePipeline', [{
            label: 'HiZ_DownsamplePipeline',
            layout: 'auto',
            compute: {
                module: downsampleModule,
                entryPoint: 'main',
            },
        }], assertAlive);
        
        // Occlusion test pipeline
        const occlusionModule = this._invokeHostMethod(device, 'createShaderModule', [{
            label: 'HiZ_OcclusionTest',
            code: HIZ_OCCLUSION_TEST_SHADER,
        }], assertAlive);
        
        const occlusionPipeline = this._invokeHostMethod(device, 'createComputePipeline', [{
            label: 'HiZ_OcclusionPipeline',
            layout: 'auto',
            compute: {
                module: occlusionModule,
                entryPoint: 'main',
            },
        }], assertAlive);

        this._downsamplePipeline = downsamplePipeline;

        this._occlusionPipeline = occlusionPipeline;

    }


    /**
     * Build HiZ pyramid from depth buffer
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUTexture} depthTexture - Source depth buffer
     */
    buildPyramid(encoder, depthTexture) {
        const generation = this._generation;
        this._assertReady(generation);
        const assertReady = () => this._assertReady(generation);
        const device = this.device;
        assertReady();
        const queue = this._captureHostProperty(device, 'queue', assertReady);
        const hizTexture = this.hizTexture;
        const downsamplePipeline = this._downsamplePipeline;
        const hizViews = this.hizViews;
        const mipSizeBuffers = this._mipSizeBuffers;
        // Copy depth to mip 0
        this._invokeHostMethod(encoder, 'copyTextureToTexture', [
            { texture: depthTexture },
            { texture: hizTexture, mipLevel: 0 },
            [this.width, this.height],
        ], assertReady);
        
        // Generate mip chain
        let srcWidth = this.width;
        let srcHeight = this.height;
        
        for (let mip = 1; mip < this.hizMipLevels; mip++) {
            const dstWidth = Math.max(1, srcWidth >> 1);
            const dstHeight = Math.max(1, srcHeight >> 1);
            
            // Update mip size uniform - reuse buffer
            _mipSizeData[0] = dstWidth;
            _mipSizeData[1] = dstHeight;
            this._invokeHostMethod(
                queue,
                'writeBuffer',
                [mipSizeBuffers[mip - 1], 0, _mipSizeData],
                assertReady,
            );
            
            // Create bind group for this mip level
            let bindGroup = this._downsampleBindGroups[mip - 1];
            if (!bindGroup) {
                const layout = this._invokeHostMethod(
                    downsamplePipeline,
                    'getBindGroupLayout',
                    [0],
                    assertReady,
                );
                const candidate = this._invokeHostMethod(device, 'createBindGroup', [{
                    label: `HiZ_Downsample_Mip${mip}`,
                    layout,
                    entries: [
                        { binding: 0, resource: hizViews[mip - 1] },
                        { binding: 1, resource: hizViews[mip] },
                        { binding: 2, resource: { buffer: mipSizeBuffers[mip - 1] } },
                    ],
                }], assertReady);
                if (!this._downsampleBindGroups[mip - 1]) {
                    this._downsampleBindGroups[mip - 1] = candidate;
                }
                bindGroup = this._downsampleBindGroups[mip - 1];
            }
            
            const pass = this._invokeHostMethod(encoder, 'beginComputePass', [{
                label: `HiZ_Downsample_Mip${mip}`,
            }], assertReady);
            this._invokeHostMethod(pass, 'setPipeline', [downsamplePipeline], assertReady);
            this._invokeHostMethod(pass, 'setBindGroup', [0, bindGroup], assertReady);
            this._invokeHostMethod(pass, 'dispatchWorkgroups', [
                Math.ceil(dstWidth / WORKGROUP_SIZE),
                Math.ceil(dstHeight / WORKGROUP_SIZE),
            ], assertReady);
            this._invokeHostMethod(pass, 'end', [], assertReady);
            
            srcWidth = dstWidth;
            srcHeight = dstHeight;
        }
    }

    /**
     * Upload bounding boxes for occlusion testing
     * Buffers grow automatically to fit the data.
     * @param {Float32Array} data - [minX, minY, minZ, pad, maxX, maxY, maxZ, pad] per object
     * @param {number} count 
     */
    uploadBoundingBoxes(data, count) {
        let generation = this._generation;
        this._assertReady(generation);
        const normalizedCount = this._snapshotCount(count, 'Object count', generation);
        this._assertReady(generation);
        const dataSnapshot = this._snapshotBoundingBoxData(data, generation);
        this._assertReady(generation);
        this._ensureObjectCapacity(normalizedCount);
        generation = this._generation;
        this._assertReady(generation);
        const assertReady = () => this._assertReady(generation);
        const device = this.device;
        assertReady();
        const queue = this._captureHostProperty(device, 'queue', assertReady);
        const boundingBoxBuffer = this.boundingBoxBuffer;
        assertReady();
        this._invokeHostMethod(
            queue,
            'writeBuffer',
            [boundingBoxBuffer, 0, dataSnapshot],
            assertReady,
        );
        if (this.boundingBoxBuffer !== boundingBoxBuffer) throw this._destroyError();
        this._objectCount = normalizedCount;
    }

    /**
     * Perform occlusion culling
     * @param {GPUCommandEncoder} encoder 
     * @param {Float32Array} viewProj - Current view-projection matrix
     * @param {number} objectCount 
     */
    cull(encoder, viewProj, objectCount) {
        const generation = this._generation;
        this._assertReady(generation);
        const normalizedObjectCount = this._snapshotCount(objectCount, 'Object count', generation);
        this._assertReady(generation);
        const viewProjSnapshot = this._snapshotViewProjection(viewProj, generation);
        this._assertReady(generation);
        const assertReady = () => this._assertReady(generation);
        const device = this.device;
        assertReady();
        const queue = this._captureHostProperty(device, 'queue', assertReady);
        const uniformBuffer = this.uniformBuffer;
        const hizTexture = this.hizTexture;
        const hizSampler = this._hizSampler;
        const boundingBoxBuffer = this.boundingBoxBuffer;
        const visibilityBuffer = this.visibilityBuffer;
        const occlusionPipeline = this._occlusionPipeline;
        // Update uniforms - reuse module-level buffers
        const f32 = _hizUniformF32;
        const u32 = _hizUniformU32;
        
        // Current viewProj
        f32.set(viewProjSnapshot, 0);
        // Previous viewProj (for temporal)
        f32.set(this._prevViewProj, 16);
        // Screen size
        f32[32] = this.width;
        f32[33] = this.height;
        // Mip levels and object count
        u32[34] = this.hizMipLevels;
        u32[35] = normalizedObjectCount;
        
        assertReady();
        this._invokeHostMethod(
            queue,
            'writeBuffer',
            [uniformBuffer, 0, _hizUniformBuffer],
            assertReady,
        );
        
        // Create occlusion bind group if needed
        let bindGroup = this._occlusionBindGroup;
        if (!bindGroup) {
            const textureView = this._invokeHostMethod(
                hizTexture,
                'createView',
                [],
                assertReady,
            );
            const layout = this._invokeHostMethod(
                occlusionPipeline,
                'getBindGroupLayout',
                [0],
                assertReady,
            );
            const candidate = this._invokeHostMethod(device, 'createBindGroup', [{
                label: 'HiZ_Occlusion',
                layout,
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: textureView },
                    { binding: 2, resource: hizSampler },
                    { binding: 3, resource: { buffer: boundingBoxBuffer } },
                    { binding: 4, resource: { buffer: visibilityBuffer } },
                ],
            }], assertReady);
            if (!this._occlusionBindGroup) this._occlusionBindGroup = candidate;
            bindGroup = this._occlusionBindGroup;
        }
        
        const pass = this._invokeHostMethod(encoder, 'beginComputePass', [{
            label: 'HiZ_OcclusionCull',
        }], assertReady);
        this._invokeHostMethod(pass, 'setPipeline', [occlusionPipeline], assertReady);
        this._invokeHostMethod(pass, 'setBindGroup', [0, bindGroup], assertReady);
        this._invokeHostMethod(
            pass,
            'dispatchWorkgroups',
            [Math.ceil(normalizedObjectCount / 64)],
            assertReady,
        );
        this._invokeHostMethod(pass, 'end', [], assertReady);

        // Publish temporal state only after every caller-controlled and encoder
        // hook has completed under the captured lifecycle generation.
        this._prevViewProj.set(viewProjSnapshot);
        assertReady();
    }

    /**
     * Get visibility buffer for reading results
     */
    getVisibilityBuffer() {
        this._assertAlive();
        return this.visibilityBuffer;
    }

    /**
     * Get HiZ texture (for debugging)
     */
    getHiZTexture() {
        this._assertAlive();
        return this.hizTexture;
    }

    /**
     * Resize HiZ buffers
     */
    resize(width, height) {
        const generation = this._generation;
        this._assertReady(generation);
        const normalizedWidth = this._snapshotDimension(width, 'Width', generation);
        this._assertReady(generation);
        const normalizedHeight = this._snapshotDimension(height, 'Height', generation);
        this._assertReady(generation);
        if (normalizedWidth === this.width && normalizedHeight === this.height) return;

        const maxDimension = Math.max(normalizedWidth, normalizedHeight);
        this._assertReady(generation);
        const mipExponent = Math.log2(maxDimension);
        this._assertReady(generation);
        const mipLevels = Math.floor(mipExponent) + 1;
        this._assertReady(generation);

        const operation = {
            generation,
            width: normalizedWidth,
            height: normalizedHeight,
            mipLevels,
            texture: null,
            views: [],
            mipSizeBuffers: [],
            retiredResources: new WeakSet(),
        };
        this._assertReady(generation);
        this._resizeOperation = operation;

        try {
            const assertCurrent = () => this._assertResizeOperationCurrent(operation);
            const device = this.device;
            assertCurrent();
            const texture = this._invokeHostMethod(device, 'createTexture', [{
                label: 'HiZ_Pyramid',
                size: [normalizedWidth, normalizedHeight],
                format: 'r32float',
                usage: GPUTextureUsage.TEXTURE_BINDING
                    | GPUTextureUsage.STORAGE_BINDING
                    | GPUTextureUsage.COPY_DST,
                mipLevelCount: operation.mipLevels,
            }], assertCurrent, candidate => { operation.texture = candidate; });

            for (let mip = 0; mip < operation.mipLevels; mip++) {
                operation.views.push(this._invokeHostMethod(texture, 'createView', [{
                    label: `HiZ_Mip${mip}`,
                    baseMipLevel: mip,
                    mipLevelCount: 1,
                }], assertCurrent));
            }

            for (let mip = 1; mip < operation.mipLevels; mip++) {
                this._invokeHostMethod(device, 'createBuffer', [{
                    label: `HiZ_MipSize_${mip}`,
                    size: 8,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                }], assertCurrent, candidate => { operation.mipSizeBuffers.push(candidate); });
            }

            const previousTexture = this.hizTexture;
            const previousMipSizeBuffers = this._mipSizeBuffers;
            this.width = normalizedWidth;
            this.height = normalizedHeight;
            this.hizMipLevels = operation.mipLevels;
            this.hizTexture = texture;
            this.hizViews = operation.views;
            this._mipSizeBuffers = operation.mipSizeBuffers;
            this._downsampleBindGroups = [];
            this._occlusionBindGroup = null;
            this._initDescriptor = `${normalizedWidth}x${normalizedHeight}`;
            operation.texture = null;
            operation.views = [];
            operation.mipSizeBuffers = [];
            if (this._resizeOperation === operation) this._resizeOperation = null;
            this._generation++;
            const committedGeneration = this._generation;
            this._retireResource(previousTexture);
            this._assertAlive(committedGeneration);
            for (const buffer of new Set(previousMipSizeBuffers.filter(Boolean))) {
                this._retireResource(buffer);
                this._assertAlive(committedGeneration);
            }
            return true;
        } catch (error) {
            if (this._resizeOperation === operation) this._resizeOperation = null;
            this._retireResizeOperation(operation);
            throw error;
        }
    }

    _assertResizeOperationCurrent(operation) {
        if (
            this._destroyed
            || operation.generation !== this._generation
            || this._resizeOperation !== operation
        ) {
            throw this._destroyError();
        }
    }

    _retireResizeOperation(operation) {
        if (!operation) return;
        const resources = new Set([
            operation.texture,
            ...operation.mipSizeBuffers,
        ].filter(Boolean));
        operation.texture = null;
        operation.views = [];
        operation.mipSizeBuffers = [];
        for (const resource of resources) {
            this._retireResource(resource, operation.retiredResources);
        }
    }

    destroy() {
        const firstDestroy = !this._destroyed;
        const initOperation = this._initOperation;
        const capacityOperation = this._capacityOperation;
        const resizeOperation = this._resizeOperation;
        this._initOperation = null;
        this._capacityOperation = null;
        this._resizeOperation = null;
        if (!this._destroyed) {
            this._destroyed = true;
            this._generation++;
        }
        if (initOperation) this._settleInit(initOperation, null, this._destroyError());
        this._retireCapacityOperation(capacityOperation);
        this._retireResizeOperation(resizeOperation);
        const resources = new Set([
            this.hizTexture,
            this.boundingBoxBuffer,
            this.visibilityBuffer,
            this.uniformBuffer,
            ...this._mipSizeBuffers,
        ].filter(Boolean));
        this.hizTexture = null;
        this.hizViews = [];
        this.boundingBoxBuffer = null;
        this.visibilityBuffer = null;
        this.uniformBuffer = null;
        this._mipSizeBuffers = [];
        this._downsamplePipeline = null;
        this._occlusionPipeline = null;
        this._downsampleBindGroups = [];
        this._occlusionBindGroup = null;
        this._hizSampler = null;
        this._objectCapacity = 0;
        this._objectCount = 0;
        this._initialized = false;
        this._initDescriptor = null;
        for (const resource of resources) {
            this._retireResource(resource);
        }
        return firstDestroy;
    }
}

/**
 * Helper to build bounding box data for HiZ culling
 * Grows dynamically - no fixed maximum.
 */
export class BoundingBoxBuilder {
    constructor(initialCapacity = 256) {
        this._capacity = initialCapacity;
        this.data = new Float32Array(initialCapacity * 8); // min + pad + max + pad
        this.count = 0;
    }

    reset() {
        this.count = 0;
    }

    _ensureCapacity(required) {
        if (this._capacity >= required) return;
        
        let newCapacity = this._capacity;
        while (newCapacity < required) {
            newCapacity = Math.ceil(newCapacity * GROWTH_FACTOR);
        }
        
        const newData = new Float32Array(newCapacity * 8);
        newData.set(this.data);
        this.data = newData;
        this._capacity = newCapacity;
    }

    /**
     * Add a bounding box
     * @param {Array} min - [x, y, z]
     * @param {Array} max - [x, y, z]
     */
    add(min, max) {
        this._ensureCapacity(this.count + 1);
        
        const offset = this.count * 8;
        this.data[offset + 0] = min[0];
        this.data[offset + 1] = min[1];
        this.data[offset + 2] = min[2];
        this.data[offset + 3] = 0; // padding
        this.data[offset + 4] = max[0];
        this.data[offset + 5] = max[1];
        this.data[offset + 6] = max[2];
        this.data[offset + 7] = 0; // padding
        
        return this.count++;
    }

    /**
     * Add from center and half-extents
     */
    addCenterExtents(center, halfExtents) {
        return this.add(
            [center[0] - halfExtents[0], center[1] - halfExtents[1], center[2] - halfExtents[2]],
            [center[0] + halfExtents[0], center[1] + halfExtents[1], center[2] + halfExtents[2]]
        );
    }

    getData() {
        return this.data.subarray(0, this.count * 8);
    }

    getCount() {
        return this.count;
    }
}
