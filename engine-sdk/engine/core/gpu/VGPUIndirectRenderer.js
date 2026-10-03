// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VGPUIndirectRenderer - GPU-driven rendering with indirect draw/dispatch
 *
 * Features:
 * - GPU-based frustum culling
 * - GPU-based occlusion culling (requires HiZ)
 * - Indirect draw command generation
 * - Automatic instancing of similar meshes
 * - LOD selection on GPU
 * - Draw call compaction
 * - **Dynamic buffer sizing** - grows as needed, no fixed maximums
 *
 * The CPU submits all potential draws, GPU culls and compacts to only visible ones.
 * This minimizes CPU overhead and maximizes GPU parallelism.
 */

const WORKGROUP_SIZE = 64;

// Instance data layout (per-object)
const INSTANCE_STRIDE = 80; // bytes: mat4 (64) + boundingSphere (16)

// Draw command layout (matches WebGPU indirect draw)
const DRAW_INDIRECT_SIZE = 20; // 5 u32s: vertexCount, instanceCount, firstVertex, firstInstance, padding

// Initial capacities (will grow as needed)
const INITIAL_INSTANCE_CAPACITY = 256;
const INITIAL_MESH_CAPACITY = 32;
const GROWTH_FACTOR = 2;

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _frustumPlanes = new Float32Array(24);
const _cullUniformBuffer = new ArrayBuffer(256);
const _cullUniformF32 = new Float32Array(_cullUniformBuffer);
const _cullUniformU32 = new Uint32Array(_cullUniformBuffer);

/**
 * GPU Frustum Culling Shader
 */
const FRUSTUM_CULL_SHADER = /* wgsl */`
struct DrawCommand {
    vertexCount: u32,
    instanceCount: u32,
    firstVertex: u32,
    firstInstance: u32,
}

struct Instance {
    model: mat4x4<f32>,
    boundingSphere: vec4<f32>, // xyz = center, w = radius
}

struct CullUniforms {
    viewProj: mat4x4<f32>,
    frustumPlanes: array<vec4<f32>, 6>,
    cameraPos: vec3<f32>,
    instanceCount: u32,
    lodDistances: vec4<f32>, // LOD0, LOD1, LOD2, LOD3 distances
}

@group(0) @binding(0) var<uniform> uniforms: CullUniforms;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var<storage, read_write> drawCommands: array<DrawCommand>;
@group(0) @binding(3) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> drawCount: atomic<u32>;

fn isInFrustum(center: vec3<f32>, radius: f32) -> bool {
    for (var i = 0u; i < 6u; i++) {
        let plane = uniforms.frustumPlanes[i];
        let dist = dot(plane.xyz, center) + plane.w;
        if (dist < -radius) {
            return false;
        }
    }
    return true;
}

fn computeLOD(distance: f32) -> u32 {
    if (distance < uniforms.lodDistances.x) { return 0u; }
    if (distance < uniforms.lodDistances.y) { return 1u; }
    if (distance < uniforms.lodDistances.z) { return 2u; }
    if (distance < uniforms.lodDistances.w) { return 3u; }
    return 4u; // Culled by distance
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= uniforms.instanceCount) { return; }

    let instance = instances[idx];
    let worldCenter = (instance.model * vec4<f32>(instance.boundingSphere.xyz, 1.0)).xyz;
    let worldRadius = instance.boundingSphere.w * max(
        max(length(instance.model[0].xyz), length(instance.model[1].xyz)),
        length(instance.model[2].xyz)
    );

    // Frustum culling
    if (!isInFrustum(worldCenter, worldRadius)) { return; }

    // Distance-based LOD
    let distance = length(worldCenter - uniforms.cameraPos);
    let lod = computeLOD(distance);
    if (lod >= 4u) { return; } // Too far, culled

    // Add to visible list
    let visibleIdx = atomicAdd(&drawCount, 1u);
    visibleIndices[visibleIdx] = idx;
}
`;

/**
 * Draw command compaction shader
 */
const COMPACT_DRAWS_SHADER = /* wgsl */`
struct DrawCommand {
    vertexCount: u32,
    instanceCount: u32,
    firstVertex: u32,
    firstInstance: u32,
}

struct MeshInfo {
    vertexCount: u32,
    firstVertex: u32,
    indexCount: u32,
    firstIndex: u32,
}

@group(0) @binding(0) var<storage, read> visibleIndices: array<u32>;
@group(0) @binding(1) var<storage, read> meshInfos: array<MeshInfo>;
@group(0) @binding(2) var<storage, read> instanceMeshIds: array<u32>;
@group(0) @binding(3) var<storage, read_write> drawCommands: array<DrawCommand>;
@group(0) @binding(4) var<uniform> drawCount: u32;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= drawCount) { return; }

    let instanceIdx = visibleIndices[idx];
    let meshId = instanceMeshIds[instanceIdx];
    let mesh = meshInfos[meshId];

    drawCommands[idx] = DrawCommand(
        mesh.vertexCount,
        1u,
        mesh.firstVertex,
        instanceIdx
    );
}
`;

/**
 * GPU-driven indirect renderer with dynamic buffer sizing
 */
export class VGPUIndirectRenderer {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;

        // Pipelines (lazy init)
        this._cullPipeline = null;
        this._compactPipeline = null;

        // Buffers (created on demand)
        this.instanceBuffer = null;
        this.drawCommandBuffer = null;
        this.visibleIndexBuffer = null;
        this.drawCountBuffer = null;
        this.meshInfoBuffer = null;
        this.instanceMeshIdBuffer = null;

        // Bind groups (invalidated on resize)
        this._cullBindGroup = null;
        this._compactBindGroup = null;

        // Uniform buffer for culling
        this.cullUniformBuffer = null;

        // Current capacity (grows dynamically)
        this._instanceCapacity = 0;
        this._meshCapacity = 0;

        // Stats
        this.stats = {
            totalInstances: 0,
            visibleInstances: 0,
            culledInstances: 0,
            drawCalls: 0,
        };

        this._initialized = false;
        this._initOperation = null;
        this._generation = 0;
        this._destroyed = false;
        this._destroyError = null;
        this._allocationOperations = new Set();
        this._statsReads = new Set();
        this._readOwner = {
            released: false,
            record: { active: true },
            _ownerReleaseError: () => this._destroyError || this._lifecycleError(),
        };
    }

    init() {
        try {
            this._assertAlive();
        } catch (error) {
            return Promise.reject(error);
        }
        if (this._initialized) return Promise.resolve(this);
        if (this._initOperation) return this._initOperation.promise;

        let resolvePublic;
        let rejectPublic;
        const operation = {
            generation: this._generation,
            cullPipeline: null,
            compactPipeline: null,
            cullUniformBuffer: null,
            drawCountBuffer: null,
            settled: false,
            promise: null,
        };
        operation.promise = new Promise((resolve, reject) => {
            resolvePublic = resolve;
            rejectPublic = reject;
        });
        operation.resolve = resolvePublic;
        operation.reject = rejectPublic;
        this._initOperation = operation;
        void operation.promise.catch(() => {});

        const rawInit = Promise.resolve().then(() => this._initialize(operation));
        void rawInit.then(
            () => this._commitInit(operation),
            error => this._failInit(operation, error),
        );
        return operation.promise;
    }

    _initialize(operation) {
        this._assertInitCurrent(operation);
        this._createPipelines(operation);
        operation.cullUniformBuffer = this._createLifecycleBuffer(operation.generation, {
            label: 'IndirectRenderer_CullUniforms',
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._assertInitCurrent(operation);
        operation.drawCountBuffer = this._createLifecycleBuffer(operation.generation, {
            label: 'IndirectRenderer_DrawCount',
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT,
        });
        this._assertInitCurrent(operation);
    }

    _commitInit(operation) {
        if (!this._isInitCurrent(operation)) {
            this._retireInitResources(operation);
            return false;
        }
        this._cullPipeline = operation.cullPipeline;
        this._compactPipeline = operation.compactPipeline;
        this.cullUniformBuffer = operation.cullUniformBuffer;
        this.drawCountBuffer = operation.drawCountBuffer;
        operation.cullPipeline = null;
        operation.compactPipeline = null;
        operation.cullUniformBuffer = null;
        operation.drawCountBuffer = null;
        this._initialized = true;
        return this._settleInit(operation, this, null);
    }

    _failInit(operation, error) {
        this._retireInitResources(operation);
        if (!operation?.settled) this._settleInit(operation, null, error);
    }

    _isInitCurrent(operation) {
        return Boolean(operation)
            && !operation.settled
            && !this._destroyed
            && operation.generation === this._generation
            && this._initOperation === operation;
    }

    _assertInitCurrent(operation) {
        if (!this._isInitCurrent(operation)) {
            throw this._destroyError || this._lifecycleError('initialization invalidated');
        }
    }

    _settleInit(operation, value, error) {
        if (!operation || operation.settled) return false;
        operation.settled = true;
        if (this._initOperation === operation) this._initOperation = null;
        if (error) operation.reject(error);
        else operation.resolve(value);
        return true;
    }

    _retireInitResources(operation) {
        if (!operation) return;
        const resources = new Set([
            operation.cullUniformBuffer,
            operation.drawCountBuffer,
        ].filter(Boolean));
        operation.cullUniformBuffer = null;
        operation.drawCountBuffer = null;
        operation.cullPipeline = null;
        operation.compactPipeline = null;
        for (const resource of resources) {
            this._destroyExternalResource(resource);
        }
    }

    _cancelInit(operation, error) {
        if (!operation || operation.settled) return false;
        this._retireInitResources(operation);
        return this._settleInit(operation, null, error);
    }

    /**
     * Ensure instance buffers have sufficient capacity
     */
    _ensureInstanceCapacity(requiredCount) {
        this._assertReady();
        const generation = this._generation;
        const requestedCount = Number(requiredCount);
        this._assertGeneration(generation);
        if (this._instanceCapacity >= requestedCount) {
            this._assertGeneration(generation);
            return false;
        }

        // Calculate new capacity with growth factor
        let newCapacity = Math.max(INITIAL_INSTANCE_CAPACITY, this._instanceCapacity);
        while (newCapacity < requestedCount) {
            newCapacity = Math.ceil(newCapacity * GROWTH_FACTOR);
        }

        const allocation = this._createAllocationOperation(generation);
        const candidates = [];
        try {
            candidates.push(this._createLifecycleBuffer(generation, {
                label: 'IndirectRenderer_Instances',
                size: newCapacity * INSTANCE_STRIDE,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }));
            allocation.resources.add(candidates.at(-1));
            candidates.push(this._createLifecycleBuffer(generation, {
                label: 'IndirectRenderer_DrawCommands',
                size: newCapacity * DRAW_INDIRECT_SIZE,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
            }));
            allocation.resources.add(candidates.at(-1));
            candidates.push(this._createLifecycleBuffer(generation, {
                label: 'IndirectRenderer_VisibleIndices',
                size: newCapacity * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }));
            allocation.resources.add(candidates.at(-1));
            candidates.push(this._createLifecycleBuffer(generation, {
                label: 'IndirectRenderer_InstanceMeshIds',
                size: newCapacity * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }));
            allocation.resources.add(candidates.at(-1));
            this._assertGeneration(generation);
        } catch (error) {
            this._retireAllocationOperation(allocation);
            throw error;
        }

        const previous = [
            this.instanceBuffer,
            this.drawCommandBuffer,
            this.visibleIndexBuffer,
            this.instanceMeshIdBuffer,
        ];
        [
            this.instanceBuffer,
            this.drawCommandBuffer,
            this.visibleIndexBuffer,
            this.instanceMeshIdBuffer,
        ] = candidates;
        allocation.resources.clear();
        this._allocationOperations.delete(allocation);

        this._instanceCapacity = newCapacity;
        this._cullBindGroup = null; // Invalidate bind group
        this._retireReplacedResources(previous, generation);
        this._assertGeneration(generation);

        return true; // Resized
    }

    /**
     * Ensure mesh info buffer has sufficient capacity
     */
    _ensureMeshCapacity(requiredCount) {
        this._assertReady();
        const generation = this._generation;
        const requestedCount = Number(requiredCount);
        this._assertGeneration(generation);
        if (this._meshCapacity >= requestedCount) {
            this._assertGeneration(generation);
            return false;
        }

        let newCapacity = Math.max(INITIAL_MESH_CAPACITY, this._meshCapacity);
        while (newCapacity < requestedCount) {
            newCapacity = Math.ceil(newCapacity * GROWTH_FACTOR);
        }

        const allocation = this._createAllocationOperation(generation);
        let candidate;
        try {
            candidate = this._createLifecycleBuffer(generation, {
                label: 'IndirectRenderer_MeshInfos',
                size: newCapacity * 16,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            allocation.resources.add(candidate);
            this._assertGeneration(generation);
        } catch (error) {
            this._retireAllocationOperation(allocation);
            throw error;
        }
        const previous = this.meshInfoBuffer;
        this.meshInfoBuffer = candidate;
        allocation.resources.clear();
        this._allocationOperations.delete(allocation);
        this._meshCapacity = newCapacity;
        this._retireReplacedResources([previous], generation);
        this._assertGeneration(generation);
        return true;
    }

    _retireReplacedResources(resources, generation) {
        let lifecycleError = null;
        for (const resource of new Set(resources.filter(Boolean))) {
            this._destroyExternalResource(resource);
            try {
                this._assertGeneration(generation);
            } catch (error) {
                lifecycleError ||= error;
            }
        }
        if (lifecycleError) throw lifecycleError;
        this._assertGeneration(generation);
    }

    _createLifecycleBuffer(generation, descriptor) {
        const assertCurrent = () => this._assertGeneration(generation);
        const device = this.device;
        assertCurrent();
        return this._callExternal(
            device,
            'createBuffer',
            [descriptor],
            assertCurrent,
            'create a lifecycle buffer',
            resource => this._destroyExternalResource(resource),
        );
    }

    _createAllocationOperation(generation = this._generation) {
        const operation = { generation, resources: new Set(), retired: false };
        this._allocationOperations.add(operation);
        return operation;
    }

    _retireAllocationOperation(operation) {
        if (!operation || operation.retired) return false;
        operation.retired = true;
        this._allocationOperations.delete(operation);
        const resources = [...operation.resources];
        operation.resources.clear();
        for (const resource of resources) {
            this._destroyExternalResource(resource);
        }
        return true;
    }

    _lifecycleError(reason = 'destroyed') {
        const error = new Error(`[IndirectRenderer] ${reason}`);
        error.name = 'AbortError';
        error.code = 'VGPU_INDIRECT_RENDERER_DESTROYED';
        return error;
    }

    _assertAlive() {
        if (this._destroyed) throw this._destroyError || this._lifecycleError();
    }

    _assertReady() {
        this._assertAlive();
        if (!this._initialized) {
            const error = new Error('[IndirectRenderer] not initialized');
            error.code = 'VGPU_INDIRECT_RENDERER_NOT_INITIALIZED';
            throw error;
        }
    }

    _assertGeneration(generation) {
        if (this._destroyed || generation !== this._generation) {
            throw this._destroyError || this._lifecycleError('generation invalidated');
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
            throw new TypeError(`[IndirectRenderer] ${String(key)} is not callable`);
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

    _destroyExternalResource(resource) {
        if (!resource) return;
        let destroy = null;
        try { destroy = resource.destroy; } catch (_) { return; }
        if (typeof destroy !== 'function') return;
        try { Reflect.apply(destroy, resource, []); } catch (_) {}
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

    _captureResourceGraph(fields) {
        const graph = {};
        for (const field of fields) graph[field] = this[field];
        return graph;
    }

    _assertResourceGraph(generation, graph) {
        this._assertGeneration(generation);
        for (const [field, resource] of Object.entries(graph)) {
            if (this[field] !== resource) {
                throw this._lifecycleError('resource graph invalidated');
            }
        }
    }

    _snapshotNumbers(values, length, generation) {
        const snapshot = new Float32Array(length);
        for (let index = 0; index < length; index++) {
            let value;
            try {
                value = values[index];
            } finally {
                this._assertGeneration(generation);
            }
            try {
                snapshot[index] = Number(value);
            } finally {
                this._assertGeneration(generation);
            }
        }
        return snapshot;
    }

    _createPipelines(operation) {
        const assertCurrent = () => this._assertInitCurrent(operation);
        const device = this.device;
        // Frustum cull pipeline
        const cullModule = this._callExternal(device, 'createShaderModule', [{
            label: 'IndirectRenderer_FrustumCull',
            code: FRUSTUM_CULL_SHADER,
        }], assertCurrent, 'create the frustum cull shader');
        operation.cullPipeline = this._callExternal(device, 'createComputePipeline', [{
            label: 'IndirectRenderer_CullPipeline',
            layout: 'auto',
            compute: {
                module: cullModule,
                entryPoint: 'main',
            },
        }], assertCurrent, 'create the frustum cull pipeline');

        // Compact draws pipeline
        const compactModule = this._callExternal(device, 'createShaderModule', [{
            label: 'IndirectRenderer_CompactDraws',
            code: COMPACT_DRAWS_SHADER,
        }], assertCurrent, 'create the draw compaction shader');
        operation.compactPipeline = this._callExternal(device, 'createComputePipeline', [{
            label: 'IndirectRenderer_CompactPipeline',
            layout: 'auto',
            compute: {
                module: compactModule,
                entryPoint: 'main',
            },
        }], assertCurrent, 'create the draw compaction pipeline');
    }

    /**
     * Upload instance data (transforms and bounding spheres)
     * Buffers grow automatically to fit the data.
     * @param {Float32Array} data - Interleaved mat4 + vec4 boundingSphere per instance
     * @param {number} instanceCount
     */
    uploadInstances(data, instanceCount) {
        this._assertReady();
        const generation = this._generation;
        let requestedCount;
        try {
            requestedCount = Number(instanceCount);
        } finally {
            this._assertGeneration(generation);
        }
        this._ensureInstanceCapacity(requestedCount);
        this._assertGeneration(generation);
        const graph = this._captureResourceGraph(['instanceBuffer']);
        const assertCurrent = () => this._assertResourceGraph(generation, graph);
        const queue = this._readExternalMember(
            this.device, 'queue', assertCurrent, 'resolve the instance upload queue',
        );
        this._callExternal(
            queue, 'writeBuffer', [graph.instanceBuffer, 0, data], assertCurrent,
            'upload indirect instances',
        );
        this.stats.totalInstances = requestedCount;
        this._assertResourceGraph(generation, graph);
    }

    /**
     * Upload mesh information
     * @param {Array<{vertexCount, firstVertex, indexCount, firstIndex}>} meshes
     */
    uploadMeshInfos(meshes) {
        this._assertReady();
        const generation = this._generation;
        let meshCount;
        try {
            meshCount = Number(meshes.length);
        } finally {
            this._assertGeneration(generation);
        }
        this._ensureMeshCapacity(meshCount);
        this._assertGeneration(generation);
        const graph = this._captureResourceGraph(['meshInfoBuffer']);
        const data = new Uint32Array(meshCount * 4);
        for (let i = 0; i < meshCount; i++) {
            let mesh;
            try {
                mesh = meshes[i];
            } finally {
                this._assertResourceGraph(generation, graph);
            }
            const values = [];
            for (const field of ['vertexCount', 'firstVertex', 'indexCount', 'firstIndex']) {
                let value;
                try {
                    value = mesh[field];
                } finally {
                    this._assertResourceGraph(generation, graph);
                }
                try {
                    values.push(Number(value || 0));
                } finally {
                    this._assertResourceGraph(generation, graph);
                }
            }
            data.set(values, i * 4);
        }
        this._assertResourceGraph(generation, graph);
        const assertCurrent = () => this._assertResourceGraph(generation, graph);
        const queue = this._readExternalMember(
            this.device, 'queue', assertCurrent, 'resolve the mesh upload queue',
        );
        this._callExternal(
            queue, 'writeBuffer', [graph.meshInfoBuffer, 0, data], assertCurrent,
            'upload indirect mesh information',
        );
    }

    /**
     * Upload which mesh each instance uses
     * @param {Uint32Array} meshIds - meshId per instance
     */
    uploadInstanceMeshIds(meshIds) {
        this._assertReady();
        const generation = this._generation;
        let instanceCount;
        try {
            instanceCount = Number(meshIds.length);
        } finally {
            this._assertGeneration(generation);
        }
        this._ensureInstanceCapacity(instanceCount);
        this._assertGeneration(generation);
        const graph = this._captureResourceGraph(['instanceMeshIdBuffer']);
        const assertCurrent = () => this._assertResourceGraph(generation, graph);
        const queue = this._readExternalMember(
            this.device, 'queue', assertCurrent, 'resolve the mesh-ID upload queue',
        );
        this._callExternal(
            queue, 'writeBuffer', [graph.instanceMeshIdBuffer, 0, meshIds], assertCurrent,
            'upload indirect instance mesh IDs',
        );
    }

    /**
     * Extract frustum planes from view-projection matrix
     */
    _extractFrustumPlanes(viewProj) {
        const planes = _frustumPlanes; // Reuse module-level buffer

        // Left
        planes[0] = viewProj[3] + viewProj[0];
        planes[1] = viewProj[7] + viewProj[4];
        planes[2] = viewProj[11] + viewProj[8];
        planes[3] = viewProj[15] + viewProj[12];

        // Right
        planes[4] = viewProj[3] - viewProj[0];
        planes[5] = viewProj[7] - viewProj[4];
        planes[6] = viewProj[11] - viewProj[8];
        planes[7] = viewProj[15] - viewProj[12];

        // Bottom
        planes[8] = viewProj[3] + viewProj[1];
        planes[9] = viewProj[7] + viewProj[5];
        planes[10] = viewProj[11] + viewProj[9];
        planes[11] = viewProj[15] + viewProj[13];

        // Top
        planes[12] = viewProj[3] - viewProj[1];
        planes[13] = viewProj[7] - viewProj[5];
        planes[14] = viewProj[11] - viewProj[9];
        planes[15] = viewProj[15] - viewProj[13];

        // Near
        planes[16] = viewProj[3] + viewProj[2];
        planes[17] = viewProj[7] + viewProj[6];
        planes[18] = viewProj[11] + viewProj[10];
        planes[19] = viewProj[15] + viewProj[14];

        // Far
        planes[20] = viewProj[3] - viewProj[2];
        planes[21] = viewProj[7] - viewProj[6];
        planes[22] = viewProj[11] - viewProj[10];
        planes[23] = viewProj[15] - viewProj[14];

        // Normalize planes
        for (let i = 0; i < 6; i++) {
            const len = Math.sqrt(
                planes[i*4] * planes[i*4] +
                planes[i*4+1] * planes[i*4+1] +
                planes[i*4+2] * planes[i*4+2]
            );
            planes[i*4] /= len;
            planes[i*4+1] /= len;
            planes[i*4+2] /= len;
            planes[i*4+3] /= len;
        }

        return planes;
    }

    /**
     * Perform GPU culling pass
     * @param {GPUCommandEncoder} encoder
     * @param {Object} camera - { viewProj: Float32Array, position: [x,y,z] }
     * @param {Object} options - { lodDistances: [d0,d1,d2,d3] }
     */
    cull(encoder, camera, options = {}) {
        this._assertReady();
        const generation = this._generation;
        let viewProjSource;
        let positionSource;
        let lodSource;
        try {
            viewProjSource = camera.viewProj;
        } finally {
            this._assertGeneration(generation);
        }
        try {
            positionSource = camera.position;
        } finally {
            this._assertGeneration(generation);
        }
        try {
            lodSource = options.lodDistances;
        } finally {
            this._assertGeneration(generation);
        }
        const viewProj = this._snapshotNumbers(viewProjSource, 16, generation);
        const cameraPosition = this._snapshotNumbers(positionSource, 3, generation);
        const lodDistances = this._snapshotNumbers(
            lodSource === undefined ? [50, 100, 200, 500] : lodSource,
            4,
            generation,
        );
        this._assertGeneration(generation);
        const graph = this._captureResourceGraph([
            'drawCountBuffer',
            'cullUniformBuffer',
            'instanceBuffer',
            'drawCommandBuffer',
            'visibleIndexBuffer',
            '_cullPipeline',
            '_cullBindGroup',
        ]);
        const assertCurrent = () => this._assertResourceGraph(generation, graph);
        const instanceCount = this.stats.totalInstances;
        assertCurrent();

        // Reset draw count
        this._callExternal(
            encoder, 'clearBuffer', [graph.drawCountBuffer, 0, 4], assertCurrent,
            'clear the indirect draw count',
        );

        // Upload uniforms - reuse module-level buffers
        const frustumPlanes = this._extractFrustumPlanes(viewProj);
        const f32 = _cullUniformF32;
        const u32 = _cullUniformU32;

        // viewProj (64 bytes)
        f32.set(viewProj, 0);
        // frustumPlanes (96 bytes)
        f32.set(frustumPlanes, 16);
        // cameraPos (12 bytes) + instanceCount (4 bytes)
        f32[40] = cameraPosition[0];
        f32[41] = cameraPosition[1];
        f32[42] = cameraPosition[2];
        u32[43] = instanceCount;
        // lodDistances (16 bytes)
        f32[44] = lodDistances[0];
        f32[45] = lodDistances[1];
        f32[46] = lodDistances[2];
        f32[47] = lodDistances[3];

        const queue = this._readExternalMember(
            this.device, 'queue', assertCurrent, 'resolve the cull uniform upload queue',
        );
        this._callExternal(
            queue,
            'writeBuffer',
            [graph.cullUniformBuffer, 0, _cullUniformBuffer],
            assertCurrent,
            'upload indirect cull uniforms',
        );

        // Create bind group if needed
        if (!graph._cullBindGroup) {
            const layout = this._callExternal(
                graph._cullPipeline,
                'getBindGroupLayout',
                [0],
                assertCurrent,
                'resolve the cull bind group layout',
            );
            const bindGroup = this._callExternal(this.device, 'createBindGroup', [{
                label: 'IndirectRenderer_CullBindGroup',
                layout,
                entries: [
                    { binding: 0, resource: { buffer: graph.cullUniformBuffer } },
                    { binding: 1, resource: { buffer: graph.instanceBuffer } },
                    { binding: 2, resource: { buffer: graph.drawCommandBuffer } },
                    { binding: 3, resource: { buffer: graph.visibleIndexBuffer } },
                    { binding: 4, resource: { buffer: graph.drawCountBuffer } },
                ],
            }], assertCurrent, 'create the cull bind group');
            this._cullBindGroup = bindGroup;
            graph._cullBindGroup = bindGroup;
            assertCurrent();
        }

        // Dispatch culling
        const pass = this._callExternal(
            encoder,
            'beginComputePass',
            [{ label: 'IndirectRenderer_Cull' }],
            assertCurrent,
            'begin the indirect cull pass',
        );
        this._callExternal(
            pass, 'setPipeline', [graph._cullPipeline], assertCurrent,
            'set the indirect cull pipeline',
        );
        this._callExternal(
            pass, 'setBindGroup', [0, graph._cullBindGroup], assertCurrent,
            'set the indirect cull bind group',
        );
        this._callExternal(
            pass,
            'dispatchWorkgroups',
            [Math.ceil(instanceCount / WORKGROUP_SIZE)],
            assertCurrent,
            'dispatch indirect culling',
        );
        this._callExternal(
            pass, 'end', [], assertCurrent, 'end the indirect cull pass',
        );
    }

    /**
     * Get the indirect draw buffer for use with drawIndirect
     */
    getDrawCommandBuffer() {
        this._assertReady();
        return this.drawCommandBuffer;
    }

    /**
     * Get the draw count buffer (for multi-draw-indirect-count if supported)
     */
    getDrawCountBuffer() {
        this._assertReady();
        return this.drawCountBuffer;
    }

    /**
     * Get visible instance indices buffer (for instanced rendering)
     */
    getVisibleIndicesBuffer() {
        this._assertReady();
        return this.visibleIndexBuffer;
    }

    /**
     * Read back stats (async - uses readback queue)
     */
    readStats() {
        try {
            this._assertReady();
        } catch (error) {
            return Promise.reject(error);
        }

        let resolvePublic;
        let rejectPublic;
        const operation = {
            generation: this._generation,
            settled: false,
            promise: null,
        };
        operation.promise = new Promise((resolve, reject) => {
            resolvePublic = resolve;
            rejectPublic = reject;
        });
        operation.resolve = resolvePublic;
        operation.reject = rejectPublic;
        this._statsReads.add(operation);
        void operation.promise.catch(() => {});

        let rawRead;
        try {
            rawRead = this._readDrawCount(operation);
        } catch (error) {
            this._settleStatsRead(operation, null, error);
            return operation.promise;
        }

        void Reflect.apply(Promise.prototype.then, rawRead, [
            result => {
                if (!this._isStatsReadCurrent(operation)) return;
                try {
                    const view = this._asUint32View(result);
                    if (view.length === 0) throw new Error('[IndirectRenderer] empty draw-count readback');
                    this.stats.visibleInstances = view[0];
                    this.stats.culledInstances = this.stats.totalInstances - this.stats.visibleInstances;
                    this.stats.drawCalls = this.stats.visibleInstances;
                    this._settleStatsRead(operation, this.stats, null);
                } catch (error) {
                    this._settleStatsRead(operation, null, error);
                }
            },
            error => {
                if (this._isStatsReadCurrent(operation)) {
                    this._settleStatsRead(operation, null, error);
                }
            },
        ]);
        return operation.promise;
    }

    _readDrawCount(operation) {
        const assertCurrent = () => this._assertStatsReadCurrent(operation);
        const commandBackend = this._readExternalMember(
            this.vgpu, 'command', assertCurrent, 'resolve command readback backend',
        );

        const commandReadBuffer = this._readExternalMember(
            commandBackend, 'readBuffer', assertCurrent, 'resolve command readback method',
        );
        if (typeof commandReadBuffer === 'function') {
            const result = this._invokeCapturedExternal(
                { receiver: commandBackend, callable: commandReadBuffer },
                [this.drawCountBuffer, 0, 4, this._readOwner],
                assertCurrent,
                'read the indirect draw count through the command backend',
            );
            return this._adoptStatsThenable(
                operation, result, 'observe command draw-count readback',
            ) || Promise.resolve(result);
        }

        const readbackBackend = this._readExternalMember(
            this.vgpu, 'readback', assertCurrent, 'resolve legacy readback backend',
        );
        const readbackReadBuffer = this._readExternalMember(
            readbackBackend, 'readBuffer', assertCurrent, 'resolve legacy readback method',
        );
        if (typeof readbackReadBuffer !== 'function') {
            throw new Error('[IndirectRenderer] no GPU readback backend is available');
        }

        let resolveCallback;
        let rejectCallback;
        const callbackResult = new Promise((resolve, reject) => {
            resolveCallback = resolve;
            rejectCallback = reject;
        });
        let backendResult;
        try {
            backendResult = this._invokeCapturedExternal(
                { receiver: readbackBackend, callable: readbackReadBuffer },
                [this.drawCountBuffer, 0, 4, data => resolveCallback(data)],
                assertCurrent,
                'read the indirect draw count through the legacy backend',
            );
            const backendPromise = this._adoptStatsThenable(
                operation, backendResult, 'observe legacy draw-count readback',
            );
            if (backendPromise) return backendPromise;
            if (backendResult instanceof ArrayBuffer || ArrayBuffer.isView(backendResult)) {
                return Promise.resolve(backendResult);
            }
            let flush;
            try {
                flush = readbackBackend.flush;
            } finally {
                this._assertStatsReadCurrent(operation);
            }
            if (typeof flush === 'function') {
                this._invokeCapturedExternal(
                    { receiver: readbackBackend, callable: flush },
                    [],
                    assertCurrent,
                    'flush the legacy readback backend',
                );
            }
        } catch (error) {
            rejectCallback(error);
        }
        return callbackResult;
    }

    _adoptStatsThenable(operation, result, operationLabel) {
        if (!result || (typeof result !== 'object' && typeof result !== 'function')) return null;
        const assertCurrent = () => this._assertStatsReadCurrent(operation);
        const then = this._readExternalMember(
            result, 'then', assertCurrent, `${operationLabel} method`,
        );
        if (typeof then !== 'function') return null;
        return new Promise((resolve, reject) => {
            try {
                const observation = this._invokeCapturedExternal(
                    { receiver: result, callable: then },
                    [resolve, reject],
                    assertCurrent,
                    operationLabel,
                );
                this._silenceExternalPromise(observation);
            } catch (error) {
                reject(error);
            }
        });
    }

    _asUint32View(result) {
        if (result instanceof ArrayBuffer) return new Uint32Array(result);
        if (ArrayBuffer.isView(result)) {
            return new Uint32Array(result.buffer, result.byteOffset, Math.floor(result.byteLength / 4));
        }
        throw new TypeError('[IndirectRenderer] draw-count readback did not return binary data');
    }

    _isStatsReadCurrent(operation) {
        return Boolean(operation)
            && !operation.settled
            && !this._destroyed
            && operation.generation === this._generation
            && this._statsReads.has(operation);
    }

    _assertStatsReadCurrent(operation) {
        if (!this._isStatsReadCurrent(operation)
            || this._readOwner.released
            || !this._readOwner.record.active) {
            throw this._destroyError || this._lifecycleError('stats read invalidated');
        }
    }

    _settleStatsRead(operation, value, error) {
        if (!operation || operation.settled) return false;
        operation.settled = true;
        this._statsReads.delete(operation);
        if (error) operation.reject(error);
        else operation.resolve(value);
        return true;
    }

    destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;
        this._initialized = false;
        const error = this._lifecycleError();
        this._destroyError = error;
        this._readOwner.released = true;
        this._readOwner.record.active = false;

        const initOperation = this._initOperation;
        const allocations = [...this._allocationOperations];
        const reads = [...this._statsReads];
        this._cancelInit(initOperation, error);
        for (const operation of allocations) this._retireAllocationOperation(operation);
        for (const operation of reads) this._settleStatsRead(operation, null, error);
        try {
            const command = this.vgpu?.command;
            const cancelOwner = command?.cancelOwner;
            if (typeof cancelOwner === 'function') {
                Reflect.apply(cancelOwner, command, [this._readOwner, error]);
            }
        } catch (_) {}

        const resources = new Set([
            this.instanceBuffer,
            this.drawCommandBuffer,
            this.visibleIndexBuffer,
            this.drawCountBuffer,
            this.meshInfoBuffer,
            this.instanceMeshIdBuffer,
            this.cullUniformBuffer,
        ].filter(Boolean));
        this.instanceBuffer = null;
        this.drawCommandBuffer = null;
        this.visibleIndexBuffer = null;
        this.drawCountBuffer = null;
        this.meshInfoBuffer = null;
        this.instanceMeshIdBuffer = null;
        this.cullUniformBuffer = null;
        this._cullPipeline = null;
        this._compactPipeline = null;
        this._cullBindGroup = null;
        this._compactBindGroup = null;
        this._instanceCapacity = 0;
        this._meshCapacity = 0;
        for (const resource of resources) {
            this._destroyExternalResource(resource);
        }
        return true;
    }
}

/**
 * Helper to build instance data for indirect rendering
 * Grows dynamically - no fixed maximum.
 */
export class IndirectInstanceBuilder {
    constructor(initialCapacity = 256) {
        this._capacity = initialCapacity;
        this.data = new Float32Array(initialCapacity * 20); // mat4 + vec4
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

        const newData = new Float32Array(newCapacity * 20);
        newData.set(this.data);
        this.data = newData;
        this._capacity = newCapacity;
    }

    /**
     * Add an instance
     * @param {Float32Array} modelMatrix - 4x4 transform matrix
     * @param {Array} boundingSphere - [centerX, centerY, centerZ, radius]
     */
    add(modelMatrix, boundingSphere) {
        this._ensureCapacity(this.count + 1);

        const offset = this.count * 20;
        this.data.set(modelMatrix, offset);
        this.data[offset + 16] = boundingSphere[0];
        this.data[offset + 17] = boundingSphere[1];
        this.data[offset + 18] = boundingSphere[2];
        this.data[offset + 19] = boundingSphere[3];

        return this.count++;
    }

    getData() {
        return this.data.subarray(0, this.count * 20);
    }

    getCount() {
        return this.count;
    }
}
