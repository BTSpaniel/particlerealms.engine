// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VGPUDebugDraw - Immediate-mode debug visualization
 *
 * Features:
 * - Draw lines, boxes, spheres, arrows, text labels
 * - Persistent and per-frame draw calls
 * - Depth-tested and always-on-top modes
 * - Automatic batching for performance
 * - Color-coded categories
 * - **Dynamic buffer sizing** - grows as needed
 *
 * Usage:
 *   const debug = new VGPUDebugDraw(vgpu);
 *
 *   // Per-frame (cleared automatically)
 *   debug.line([0,0,0], [1,1,1], [1,0,0,1]);
 *   debug.box(center, size, color);
 *   debug.sphere(center, radius, color);
 *
 *   // Persistent (stays until removed)
 *   const id = debug.persistentLine([0,0,0], [1,1,1], color);
 *   debug.removePersistent(id);
 *
 *   // Render
 *   debug.render(encoder, viewProj);
 */

// Initial capacities (will grow as needed)
const INITIAL_LINE_CAPACITY = 1024;
const INITIAL_POINT_CAPACITY = 512;
const GROWTH_FACTOR = 2;

// Reusable buffer for uniforms (reduce/reuse/recycle)
const _debugUniforms = new Float32Array(20);

const DEBUG_VERTEX_SHADER = /* wgsl */`
struct Uniforms {
    viewProj: mat4x4<f32>,
    screenSize: vec2<f32>,
    time: f32,
    padding: f32,
}

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = uniforms.viewProj * vec4<f32>(input.position, 1.0);
    output.color = input.color;
    return output;
}
`;

const DEBUG_FRAGMENT_SHADER = /* wgsl */`
struct FragmentInput {
    @location(0) color: vec4<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    return input.color;
}
`;

// Sphere generation helper
function generateSphereLines(segments = 16) {
    const lines = [];

    // Latitude circles
    for (let lat = 1; lat < segments; lat++) {
        const theta = (lat / segments) * Math.PI;
        const y = Math.cos(theta);
        const r = Math.sin(theta);

        for (let lon = 0; lon < segments; lon++) {
            const phi0 = (lon / segments) * Math.PI * 2;
            const phi1 = ((lon + 1) / segments) * Math.PI * 2;

            lines.push(
                [r * Math.cos(phi0), y, r * Math.sin(phi0)],
                [r * Math.cos(phi1), y, r * Math.sin(phi1)]
            );
        }
    }

    // Longitude circles
    for (let lon = 0; lon < segments; lon++) {
        const phi = (lon / segments) * Math.PI * 2;

        for (let lat = 0; lat < segments; lat++) {
            const theta0 = (lat / segments) * Math.PI;
            const theta1 = ((lat + 1) / segments) * Math.PI;

            lines.push(
                [Math.sin(theta0) * Math.cos(phi), Math.cos(theta0), Math.sin(theta0) * Math.sin(phi)],
                [Math.sin(theta1) * Math.cos(phi), Math.cos(theta1), Math.sin(theta1) * Math.sin(phi)]
            );
        }
    }

    return lines;
}

// Pre-computed sphere lines (unit sphere)
const UNIT_SPHERE_LINES = generateSphereLines(12);

/**
 * Debug Draw System with dynamic buffer sizing
 */
export class VGPUDebugDraw {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;

        // Line data (position + color per vertex, 2 vertices per line)
        this._lineCapacity = INITIAL_LINE_CAPACITY;
        this.lineVertices = new Float32Array(INITIAL_LINE_CAPACITY * 2 * 7); // x,y,z,r,g,b,a
        this.lineCount = 0;

        // Point data
        this._pointCapacity = INITIAL_POINT_CAPACITY;
        this.pointVertices = new Float32Array(INITIAL_POINT_CAPACITY * 7);
        this.pointCount = 0;

        // Track if GPU buffers need resize
        this._lineBufferCapacity = 0;
        this._pointBufferCapacity = 0;

        // Persistent primitives
        this.persistent = new Map();
        this._nextPersistentId = 1;

        // GPU resources
        this.lineBuffer = null;
        this.pointBuffer = null;
        this.uniformBuffer = null;

        // Pipelines
        this._linePipeline = null;
        this._linePipelineNoDepth = null;
        this._pointPipeline = null;

        // Bind group
        this._bindGroup = null;

        // Categories with default colors
        this.categories = {
            default: [1, 1, 1, 1],
            physics: [0, 1, 0, 1],
            collision: [1, 0, 0, 1],
            ai: [0, 0, 1, 1],
            audio: [1, 1, 0, 1],
            camera: [1, 0, 1, 1],
            bounds: [0, 1, 1, 1],
        };

        // Stats
        this.stats = {
            linesDrawn: 0,
            pointsDrawn: 0,
            batchCount: 0,
        };

        this._initialized = false;
        this._initOperation = null;
        this._initDescriptorKey = null;
        this._generation = 0;
        this._destroyed = false;
        this._destroyError = null;
    }

    /**
     * Ensure CPU line array has sufficient capacity
     */
    _ensureLineCapacity(requiredCount) {
        if (this._lineCapacity >= requiredCount) return;

        let newCapacity = this._lineCapacity;
        while (newCapacity < requiredCount) {
            newCapacity = Math.ceil(newCapacity * GROWTH_FACTOR);
        }

        const newVertices = new Float32Array(newCapacity * 2 * 7);
        newVertices.set(this.lineVertices);
        this.lineVertices = newVertices;
        this._lineCapacity = newCapacity;
    }

    /**
     * Ensure GPU line buffer has sufficient capacity
     */
    _ensureLineBufferCapacity(requiredCount) {
        this._assertAlive();
        const generation = this._generation;
        const requestedCount = Number(requiredCount);
        this._assertGeneration(generation);
        if (this._lineBufferCapacity >= requestedCount) {
            this._assertGeneration(generation);
            return false;
        }

        let newCapacity = Math.max(INITIAL_LINE_CAPACITY, this._lineBufferCapacity);
        while (newCapacity < requestedCount) {
            newCapacity = Math.ceil(newCapacity * GROWTH_FACTOR);
        }

        const candidate = this._createLifecycleBuffer(generation, {
            label: 'DebugDraw_Lines',
            size: newCapacity * 2 * 7 * 4, // floats to bytes
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this._assertGeneration(generation);
        const previous = this.lineBuffer;
        const assertCurrent = () => this._assertGeneration(generation);
        let previousDestroy = null;
        let candidatePublished = false;
        try {
            if (previous) {
                previousDestroy = this._captureExternalCallable(
                    previous, 'destroy', assertCurrent, 'resolve the retired line buffer cleanup',
                );
            }
            assertCurrent();
            this.lineBuffer = candidate;
            this._lineBufferCapacity = newCapacity;
            candidatePublished = true;
            if (previousDestroy) {
                try {
                    this._invokeCapturedExternal(
                        previousDestroy, [], assertCurrent, 'retire the previous line buffer',
                    );
                } catch (_) {
                    assertCurrent();
                }
            }
            assertCurrent();
        } catch (error) {
            if (!candidatePublished) this._destroyExternalResource(candidate);
            throw error;
        }
        return true;
    }

    init(colorFormat = 'rgba8unorm', depthFormat = 'depth24plus') {
        let generation;
        let normalizedColorFormat;
        let normalizedDepthFormat;
        try {
            this._assertAlive();
            generation = this._generation;
            try {
                normalizedColorFormat = String(colorFormat);
            } finally {
                this._assertGeneration(generation);
            }
            try {
                normalizedDepthFormat = String(depthFormat);
            } finally {
                this._assertGeneration(generation);
            }
        } catch (error) {
            return Promise.reject(error);
        }
        const descriptorKey = `${normalizedColorFormat}\u0000${normalizedDepthFormat}`;
        this._assertGeneration(generation);
        if (this._initialized) {
            if (this._initDescriptorKey !== descriptorKey) {
                return Promise.reject(this._optionsMismatchError());
            }
            return Promise.resolve(this);
        }
        if (this._initOperation) {
            if (this._initOperation.descriptorKey !== descriptorKey) {
                return Promise.reject(this._optionsMismatchError());
            }
            return this._initOperation.promise;
        }

        let resolvePublic;
        let rejectPublic;
        const operation = {
            generation,
            descriptorKey,
            uniformBuffer: null,
            linePipeline: null,
            linePipelineNoDepth: null,
            bindGroup: null,
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

        const rawInit = Promise.resolve().then(
            () => this._initialize(operation, normalizedColorFormat, normalizedDepthFormat),
        );
        void rawInit.then(
            () => this._commitInit(operation),
            error => this._failInit(operation, error),
        );
        return operation.promise;
    }

    _initialize(operation, normalizedColorFormat, normalizedDepthFormat) {
        this._assertInitCurrent(operation);
        const assertCurrent = () => this._assertInitCurrent(operation);
        const device = this.device;
        operation.uniformBuffer = this._createLifecycleBuffer(operation.generation, {
            label: 'DebugDraw_Uniforms',
            size: 80,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._assertInitCurrent(operation);

        const vertexModule = this._callExternal(device, 'createShaderModule', [{
            label: 'DebugDraw_Vertex',
            code: DEBUG_VERTEX_SHADER,
        }], assertCurrent, 'create the debug vertex shader');
        const fragmentModule = this._callExternal(device, 'createShaderModule', [{
            label: 'DebugDraw_Fragment',
            code: DEBUG_FRAGMENT_SHADER,
        }], assertCurrent, 'create the debug fragment shader');

        const vertexLayout = {
            arrayStride: 28,
            attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x3' },
                { shaderLocation: 1, offset: 12, format: 'float32x4' },
            ],
        };
        const bindGroupLayout = this._callExternal(device, 'createBindGroupLayout', [{
            label: 'DebugDraw_BindGroupLayout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            ],
        }], assertCurrent, 'create the debug bind group layout');
        const pipelineLayout = this._callExternal(device, 'createPipelineLayout', [{
            label: 'DebugDraw_PipelineLayout',
            bindGroupLayouts: [bindGroupLayout],
        }], assertCurrent, 'create the debug pipeline layout');

        operation.linePipeline = this._callExternal(device, 'createRenderPipeline', [{
            label: 'DebugDraw_LinePipeline',
            layout: pipelineLayout,
            vertex: {
                module: vertexModule,
                entryPoint: 'main',
                buffers: [vertexLayout],
            },
            fragment: {
                module: fragmentModule,
                entryPoint: 'main',
                targets: [{
                    format: normalizedColorFormat,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                    },
                }],
            },
            primitive: { topology: 'line-list' },
            depthStencil: {
                format: normalizedDepthFormat,
                depthWriteEnabled: false,
                depthCompare: 'less-equal',
            },
        }], assertCurrent, 'create the depth-tested debug pipeline');

        operation.linePipelineNoDepth = this._callExternal(device, 'createRenderPipeline', [{
            label: 'DebugDraw_LinePipelineNoDepth',
            layout: pipelineLayout,
            vertex: {
                module: vertexModule,
                entryPoint: 'main',
                buffers: [vertexLayout],
            },
            fragment: {
                module: fragmentModule,
                entryPoint: 'main',
                targets: [{
                    format: normalizedColorFormat,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                    },
                }],
            },
            primitive: { topology: 'line-list' },
            depthStencil: {
                format: normalizedDepthFormat,
                depthWriteEnabled: false,
                depthCompare: 'always',
            },
        }], assertCurrent, 'create the always-on-top debug pipeline');

        operation.bindGroup = this._callExternal(device, 'createBindGroup', [{
            label: 'DebugDraw_BindGroup',
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: operation.uniformBuffer } },
            ],
        }], assertCurrent, 'create the debug bind group');
    }

    _commitInit(operation) {
        if (!this._isInitCurrent(operation)) {
            this._retireInitResources(operation);
            return false;
        }
        this.uniformBuffer = operation.uniformBuffer;
        this._linePipeline = operation.linePipeline;
        this._linePipelineNoDepth = operation.linePipelineNoDepth;
        this._bindGroup = operation.bindGroup;
        operation.uniformBuffer = null;
        operation.linePipeline = null;
        operation.linePipelineNoDepth = null;
        operation.bindGroup = null;
        this._initDescriptorKey = operation.descriptorKey;
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
        const uniformBuffer = operation.uniformBuffer;
        operation.uniformBuffer = null;
        operation.linePipeline = null;
        operation.linePipelineNoDepth = null;
        operation.bindGroup = null;
        this._destroyExternalResource(uniformBuffer);
    }

    _cancelInit(operation, error) {
        if (!operation || operation.settled) return false;
        this._retireInitResources(operation);
        return this._settleInit(operation, null, error);
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
            'create a debug-draw lifecycle buffer',
            resource => this._destroyExternalResource(resource),
        );
    }

    _optionsMismatchError() {
        const error = new Error('[DebugDraw] already initialized with incompatible formats');
        error.code = 'VGPU_DEBUG_DRAW_OPTIONS_MISMATCH';
        return error;
    }

    _lifecycleError(reason = 'destroyed') {
        const error = new Error(`[DebugDraw] ${reason}`);
        error.name = 'AbortError';
        error.code = 'VGPU_DEBUG_DRAW_DESTROYED';
        return error;
    }

    _assertAlive() {
        if (this._destroyed) throw this._destroyError || this._lifecycleError();
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
            throw new TypeError(`[DebugDraw] ${String(key)} is not callable`);
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

    _snapshotNumbers(values, length, generation, defaults = null) {
        const snapshot = new Float32Array(length);
        for (let index = 0; index < length; index++) {
            let value;
            try {
                value = values[index];
            } finally {
                this._assertGeneration(generation);
            }
            try {
                const fallback = defaults?.[index];
                snapshot[index] = Number(value == null && fallback !== undefined ? fallback : value);
            } finally {
                this._assertGeneration(generation);
            }
        }
        return snapshot;
    }

    _assertRenderGraph(generation, graph) {
        this._assertGeneration(generation);
        if (this.uniformBuffer !== graph.uniformBuffer
            || this.lineBuffer !== graph.lineBuffer
            || this._bindGroup !== graph.bindGroup
            || this._linePipeline !== graph.linePipeline
            || this._linePipelineNoDepth !== graph.linePipelineNoDepth
            || this.lineVertices !== graph.lineVertices
            || this.lineCount !== graph.lineCount) {
            throw this._lifecycleError('render resource graph invalidated');
        }
    }

    /**
     * Draw a line
     */
    line(start, end, color = [1, 1, 1, 1]) {
        this._assertAlive();
        const generation = this._generation;
        const startSnapshot = this._snapshotNumbers(start, 3, generation);
        const endSnapshot = this._snapshotNumbers(end, 3, generation);
        const colorSnapshot = this._snapshotNumbers(color, 4, generation, [undefined, undefined, undefined, 1]);
        this._assertGeneration(generation);
        const nextLineCount = this.lineCount + 1;
        this._ensureLineCapacity(nextLineCount);
        this._assertGeneration(generation);

        const offset = this.lineCount * 2 * 7;
        const vertices = new Float32Array([
            startSnapshot[0], startSnapshot[1], startSnapshot[2],
            colorSnapshot[0], colorSnapshot[1], colorSnapshot[2], colorSnapshot[3],
            endSnapshot[0], endSnapshot[1], endSnapshot[2],
            colorSnapshot[0], colorSnapshot[1], colorSnapshot[2], colorSnapshot[3],
        ]);
        this.lineVertices.set(vertices, offset);
        this.lineCount = nextLineCount;
        this._assertGeneration(generation);
    }

    /**
     * Draw a ray (line from origin in direction)
     */
    ray(origin, direction, length = 1, color = [1, 1, 1, 1]) {
        this._assertAlive();
        const generation = this._generation;
        const originSnapshot = this._snapshotNumbers(origin, 3, generation);
        const directionSnapshot = this._snapshotNumbers(direction, 3, generation);
        let rayLength;
        try {
            rayLength = Number(length);
        } finally {
            this._assertGeneration(generation);
        }
        const end = [
            originSnapshot[0] + directionSnapshot[0] * rayLength,
            originSnapshot[1] + directionSnapshot[1] * rayLength,
            originSnapshot[2] + directionSnapshot[2] * rayLength,
        ];
        this._assertGeneration(generation);
        this.line(originSnapshot, end, color);
        this._assertGeneration(generation);
    }

    /**
     * Draw an arrow
     */
    arrow(start, end, color = [1, 1, 1, 1], headSize = 0.1) {
        this._assertAlive();
        const generation = this._generation;
        const startSnapshot = this._snapshotNumbers(start, 3, generation);
        const endSnapshot = this._snapshotNumbers(end, 3, generation);
        let arrowHeadSize;
        try {
            arrowHeadSize = Number(headSize);
        } finally {
            this._assertGeneration(generation);
        }
        this.line(startSnapshot, endSnapshot, color);
        this._assertGeneration(generation);

        // Arrow head
        const dir = [
            endSnapshot[0] - startSnapshot[0],
            endSnapshot[1] - startSnapshot[1],
            endSnapshot[2] - startSnapshot[2],
        ];
        const len = Math.sqrt(dir[0]*dir[0] + dir[1]*dir[1] + dir[2]*dir[2]);
        if (len < 0.001) return;

        dir[0] /= len;
        dir[1] /= len;
        dir[2] /= len;

        // Find perpendicular vectors
        let perp1, perp2;
        if (Math.abs(dir[1]) < 0.9) {
            perp1 = [dir[2], 0, -dir[0]];
        } else {
            perp1 = [0, dir[2], -dir[1]];
        }
        const plen = Math.sqrt(perp1[0]*perp1[0] + perp1[1]*perp1[1] + perp1[2]*perp1[2]);
        perp1[0] /= plen; perp1[1] /= plen; perp1[2] /= plen;

        perp2 = [
            dir[1] * perp1[2] - dir[2] * perp1[1],
            dir[2] * perp1[0] - dir[0] * perp1[2],
            dir[0] * perp1[1] - dir[1] * perp1[0],
        ];

        const headBase = [
            endSnapshot[0] - dir[0] * arrowHeadSize,
            endSnapshot[1] - dir[1] * arrowHeadSize,
            endSnapshot[2] - dir[2] * arrowHeadSize,
        ];

        const hs = arrowHeadSize * 0.5;
        this.line(endSnapshot, [headBase[0] + perp1[0]*hs, headBase[1] + perp1[1]*hs, headBase[2] + perp1[2]*hs], color);
        this.line(endSnapshot, [headBase[0] - perp1[0]*hs, headBase[1] - perp1[1]*hs, headBase[2] - perp1[2]*hs], color);
        this.line(endSnapshot, [headBase[0] + perp2[0]*hs, headBase[1] + perp2[1]*hs, headBase[2] + perp2[2]*hs], color);
        this.line(endSnapshot, [headBase[0] - perp2[0]*hs, headBase[1] - perp2[1]*hs, headBase[2] - perp2[2]*hs], color);
        this._assertGeneration(generation);
    }

    /**
     * Draw an axis-aligned box
     */
    box(center, size, color = [1, 1, 1, 1]) {
        this._assertAlive();
        const generation = this._generation;
        const centerSnapshot = this._snapshotNumbers(center, 3, generation);
        const sizeSnapshot = this._snapshotNumbers(size, 3, generation);
        const hx = sizeSnapshot[0] * 0.5;
        const hy = sizeSnapshot[1] * 0.5;
        const hz = sizeSnapshot[2] * 0.5;
        const cx = centerSnapshot[0], cy = centerSnapshot[1], cz = centerSnapshot[2];

        // Bottom face
        this.line([cx-hx, cy-hy, cz-hz], [cx+hx, cy-hy, cz-hz], color);
        this.line([cx+hx, cy-hy, cz-hz], [cx+hx, cy-hy, cz+hz], color);
        this.line([cx+hx, cy-hy, cz+hz], [cx-hx, cy-hy, cz+hz], color);
        this.line([cx-hx, cy-hy, cz+hz], [cx-hx, cy-hy, cz-hz], color);

        // Top face
        this.line([cx-hx, cy+hy, cz-hz], [cx+hx, cy+hy, cz-hz], color);
        this.line([cx+hx, cy+hy, cz-hz], [cx+hx, cy+hy, cz+hz], color);
        this.line([cx+hx, cy+hy, cz+hz], [cx-hx, cy+hy, cz+hz], color);
        this.line([cx-hx, cy+hy, cz+hz], [cx-hx, cy+hy, cz-hz], color);

        // Vertical edges
        this.line([cx-hx, cy-hy, cz-hz], [cx-hx, cy+hy, cz-hz], color);
        this.line([cx+hx, cy-hy, cz-hz], [cx+hx, cy+hy, cz-hz], color);
        this.line([cx+hx, cy-hy, cz+hz], [cx+hx, cy+hy, cz+hz], color);
        this.line([cx-hx, cy-hy, cz+hz], [cx-hx, cy+hy, cz+hz], color);
        this._assertGeneration(generation);
    }

    /**
     * Draw a wireframe sphere
     */
    sphere(center, radius, color = [1, 1, 1, 1], segments = 12) {
        this._assertAlive();
        const generation = this._generation;
        const centerSnapshot = this._snapshotNumbers(center, 3, generation);
        let sphereRadius;
        try {
            sphereRadius = Number(radius);
        } finally {
            this._assertGeneration(generation);
        }
        for (let i = 0; i < UNIT_SPHERE_LINES.length; i += 2) {
            const p0 = UNIT_SPHERE_LINES[i];
            const p1 = UNIT_SPHERE_LINES[i + 1];
            this.line(
                [centerSnapshot[0] + p0[0] * sphereRadius, centerSnapshot[1] + p0[1] * sphereRadius, centerSnapshot[2] + p0[2] * sphereRadius],
                [centerSnapshot[0] + p1[0] * sphereRadius, centerSnapshot[1] + p1[1] * sphereRadius, centerSnapshot[2] + p1[2] * sphereRadius],
                color
            );
        }
        this._assertGeneration(generation);
    }

    /**
     * Draw a circle in a plane
     */
    circle(center, radius, normal, color = [1, 1, 1, 1], segments = 32) {
        this._assertAlive();
        const generation = this._generation;
        const centerSnapshot = this._snapshotNumbers(center, 3, generation);
        const normalSnapshot = this._snapshotNumbers(normal, 3, generation);
        let circleRadius;
        let segmentCount;
        try {
            circleRadius = Number(radius);
            segmentCount = Number(segments);
        } finally {
            this._assertGeneration(generation);
        }
        // Find perpendicular vectors
        let tangent, bitangent;
        if (Math.abs(normalSnapshot[1]) < 0.9) {
            tangent = [normalSnapshot[2], 0, -normalSnapshot[0]];
        } else {
            tangent = [0, normalSnapshot[2], -normalSnapshot[1]];
        }
        const tlen = Math.sqrt(tangent[0]*tangent[0] + tangent[1]*tangent[1] + tangent[2]*tangent[2]);
        tangent[0] /= tlen; tangent[1] /= tlen; tangent[2] /= tlen;

        bitangent = [
            normalSnapshot[1] * tangent[2] - normalSnapshot[2] * tangent[1],
            normalSnapshot[2] * tangent[0] - normalSnapshot[0] * tangent[2],
            normalSnapshot[0] * tangent[1] - normalSnapshot[1] * tangent[0],
        ];

        let prevPoint = null;
        for (let i = 0; i <= segmentCount; i++) {
            const angle = (i / segmentCount) * Math.PI * 2;
            const c = Math.cos(angle) * circleRadius;
            const s = Math.sin(angle) * circleRadius;

            const point = [
                centerSnapshot[0] + tangent[0] * c + bitangent[0] * s,
                centerSnapshot[1] + tangent[1] * c + bitangent[1] * s,
                centerSnapshot[2] + tangent[2] * c + bitangent[2] * s,
            ];

            if (prevPoint) {
                this.line(prevPoint, point, color);
            }
            prevPoint = point;
        }
        this._assertGeneration(generation);
    }

    /**
     * Draw coordinate axes
     */
    axes(origin, size = 1) {
        this._assertAlive();
        const generation = this._generation;
        const originSnapshot = this._snapshotNumbers(origin, 3, generation);
        let axisSize;
        try {
            axisSize = Number(size);
        } finally {
            this._assertGeneration(generation);
        }
        this.arrow(originSnapshot, [originSnapshot[0] + axisSize, originSnapshot[1], originSnapshot[2]], [1, 0, 0, 1], axisSize * 0.1);
        this.arrow(originSnapshot, [originSnapshot[0], originSnapshot[1] + axisSize, originSnapshot[2]], [0, 1, 0, 1], axisSize * 0.1);
        this.arrow(originSnapshot, [originSnapshot[0], originSnapshot[1], originSnapshot[2] + axisSize], [0, 0, 1, 1], axisSize * 0.1);
        this._assertGeneration(generation);
    }

    /**
     * Draw a grid on XZ plane
     */
    grid(center, size, divisions, color = [0.5, 0.5, 0.5, 0.5]) {
        this._assertAlive();
        const generation = this._generation;
        const centerSnapshot = this._snapshotNumbers(center, 3, generation);
        let gridSize;
        let divisionCount;
        try {
            gridSize = Number(size);
            divisionCount = Number(divisions);
        } finally {
            this._assertGeneration(generation);
        }
        const half = gridSize * 0.5;
        const step = gridSize / divisionCount;

        for (let i = 0; i <= divisionCount; i++) {
            const offset = -half + i * step;

            // X lines
            this.line(
                [centerSnapshot[0] - half, centerSnapshot[1], centerSnapshot[2] + offset],
                [centerSnapshot[0] + half, centerSnapshot[1], centerSnapshot[2] + offset],
                color
            );

            // Z lines
            this.line(
                [centerSnapshot[0] + offset, centerSnapshot[1], centerSnapshot[2] - half],
                [centerSnapshot[0] + offset, centerSnapshot[1], centerSnapshot[2] + half],
                color
            );
        }
        this._assertGeneration(generation);
    }

    /**
     * Draw a frustum
     */
    frustum(invViewProj, color = [1, 1, 0, 1]) {
        this._assertAlive();
        const generation = this._generation;
        const inverseViewProjection = this._snapshotNumbers(invViewProj, 16, generation);
        // NDC corners
        const corners = [
            [-1, -1, 0, 1], [1, -1, 0, 1], [1, 1, 0, 1], [-1, 1, 0, 1], // Near
            [-1, -1, 1, 1], [1, -1, 1, 1], [1, 1, 1, 1], [-1, 1, 1, 1], // Far
        ];

        // Transform to world space
        const worldCorners = corners.map(c => {
            const x = inverseViewProjection[0]*c[0] + inverseViewProjection[4]*c[1] + inverseViewProjection[8]*c[2] + inverseViewProjection[12]*c[3];
            const y = inverseViewProjection[1]*c[0] + inverseViewProjection[5]*c[1] + inverseViewProjection[9]*c[2] + inverseViewProjection[13]*c[3];
            const z = inverseViewProjection[2]*c[0] + inverseViewProjection[6]*c[1] + inverseViewProjection[10]*c[2] + inverseViewProjection[14]*c[3];
            const w = inverseViewProjection[3]*c[0] + inverseViewProjection[7]*c[1] + inverseViewProjection[11]*c[2] + inverseViewProjection[15]*c[3];
            return [x/w, y/w, z/w];
        });

        // Near plane
        this.line(worldCorners[0], worldCorners[1], color);
        this.line(worldCorners[1], worldCorners[2], color);
        this.line(worldCorners[2], worldCorners[3], color);
        this.line(worldCorners[3], worldCorners[0], color);

        // Far plane
        this.line(worldCorners[4], worldCorners[5], color);
        this.line(worldCorners[5], worldCorners[6], color);
        this.line(worldCorners[6], worldCorners[7], color);
        this.line(worldCorners[7], worldCorners[4], color);

        // Edges
        this.line(worldCorners[0], worldCorners[4], color);
        this.line(worldCorners[1], worldCorners[5], color);
        this.line(worldCorners[2], worldCorners[6], color);
        this.line(worldCorners[3], worldCorners[7], color);
        this._assertGeneration(generation);
    }

    /**
     * Add persistent primitive (returns ID for removal)
     */
    persistentLine(start, end, color) {
        this._assertAlive();
        const id = this._nextPersistentId++;
        this.persistent.set(id, { type: 'line', start, end, color });
        return id;
    }

    persistentBox(center, size, color) {
        this._assertAlive();
        const id = this._nextPersistentId++;
        this.persistent.set(id, { type: 'box', center, size, color });
        return id;
    }

    persistentSphere(center, radius, color) {
        this._assertAlive();
        const id = this._nextPersistentId++;
        this.persistent.set(id, { type: 'sphere', center, radius, color });
        return id;
    }

    removePersistent(id) {
        this._assertAlive();
        this.persistent.delete(id);
    }

    clearPersistent() {
        this._assertAlive();
        this.persistent.clear();
    }

    /**
     * Clear per-frame primitives
     */
    clear() {
        this._assertAlive();
        this.lineCount = 0;
        this.pointCount = 0;
    }

    /**
     * Render debug primitives
     */
    render(renderPass, viewProj, options = {}) {
        this._assertAlive();
        if (!this._initialized) return;
        const generation = this._generation;
        let screenSizeSource;
        let timeSource;
        let onTopSource;
        try {
            screenSizeSource = options.screenSize;
        } finally {
            this._assertGeneration(generation);
        }
        try {
            timeSource = options.time;
        } finally {
            this._assertGeneration(generation);
        }
        try {
            onTopSource = options.onTop;
        } finally {
            this._assertGeneration(generation);
        }
        const screenSize = this._snapshotNumbers(
            screenSizeSource === undefined ? [1920, 1080] : screenSizeSource,
            2,
            generation,
        );
        const viewProjection = this._snapshotNumbers(viewProj, 16, generation);
        let time;
        try {
            time = Number(timeSource ?? 0);
        } finally {
            this._assertGeneration(generation);
        }
        const onTop = Boolean(onTopSource ?? false);
        this._assertGeneration(generation);

        // Add persistent primitives
        for (const prim of this.persistent.values()) {
            switch (prim.type) {
                case 'line': this.line(prim.start, prim.end, prim.color); break;
                case 'box': this.box(prim.center, prim.size, prim.color); break;
                case 'sphere': this.sphere(prim.center, prim.radius, prim.color); break;
            }
            this._assertGeneration(generation);
        }
        this._assertGeneration(generation);

        if (this.lineCount === 0) return;

        // Ensure GPU buffer has sufficient capacity
        this._ensureLineBufferCapacity(this.lineCount);
        this._assertGeneration(generation);
        const graph = {
            uniformBuffer: this.uniformBuffer,
            lineBuffer: this.lineBuffer,
            bindGroup: this._bindGroup,
            linePipeline: this._linePipeline,
            linePipelineNoDepth: this._linePipelineNoDepth,
            lineVertices: this.lineVertices,
            lineCount: this.lineCount,
        };
        const assertCurrent = () => this._assertRenderGraph(generation, graph);
        assertCurrent();

        // Upload uniforms - reuse module-level buffer
        const uniforms = _debugUniforms;
        uniforms.set(viewProjection, 0);
        uniforms[16] = screenSize[0];
        uniforms[17] = screenSize[1];
        uniforms[18] = time;
        const queue = this._readExternalMember(
            this.device, 'queue', assertCurrent, 'resolve the debug upload queue',
        );
        const writeBuffer = this._captureExternalCallable(
            queue, 'writeBuffer', assertCurrent, 'resolve the debug buffer upload',
        );
        this._invokeCapturedExternal(
            writeBuffer,
            [graph.uniformBuffer, 0, uniforms],
            assertCurrent,
            'upload debug uniforms',
        );

        // Upload line data
        this._invokeCapturedExternal(
            writeBuffer,
            [
                graph.lineBuffer,
                0,
                graph.lineVertices,
                0,
                graph.lineCount * 2 * 7,
            ],
            assertCurrent,
            'upload debug line vertices',
        );

        // Draw lines
        this._callExternal(
            renderPass,
            'setPipeline',
            [onTop ? graph.linePipelineNoDepth : graph.linePipeline],
            assertCurrent,
            'set the debug render pipeline',
        );
        this._callExternal(
            renderPass,
            'setBindGroup',
            [0, graph.bindGroup],
            assertCurrent,
            'set the debug bind group',
        );
        this._callExternal(
            renderPass,
            'setVertexBuffer',
            [0, graph.lineBuffer],
            assertCurrent,
            'set the debug line vertex buffer',
        );
        this._callExternal(
            renderPass,
            'draw',
            [graph.lineCount * 2],
            assertCurrent,
            'draw debug lines',
        );

        // Update stats
        assertCurrent();
        this.stats.linesDrawn = graph.lineCount;
        assertCurrent();
        this.stats.batchCount = 1;
        assertCurrent();
    }

    /**
     * Get category color
     */
    getCategoryColor(category) {
        this._assertAlive();
        return this.categories[category] || this.categories.default;
    }

    /**
     * Set category color
     */
    setCategoryColor(category, color) {
        this._assertAlive();
        this.categories[category] = color;
    }

    destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;
        this._initialized = false;
        this._initDescriptorKey = null;
        const error = this._lifecycleError();
        this._destroyError = error;
        this._cancelInit(this._initOperation, error);

        const resources = new Set([
            this.lineBuffer,
            this.pointBuffer,
            this.uniformBuffer,
        ].filter(Boolean));
        this.lineBuffer = null;
        this.pointBuffer = null;
        this.uniformBuffer = null;
        this._linePipeline = null;
        this._linePipelineNoDepth = null;
        this._pointPipeline = null;
        this._bindGroup = null;
        this._lineBufferCapacity = 0;
        this._pointBufferCapacity = 0;
        this.lineCount = 0;
        this.pointCount = 0;
        this.persistent.clear();
        for (const resource of resources) {
            this._destroyExternalResource(resource);
        }
        return true;
    }
}

/**
 * Scoped debug drawing (auto-clears when scope ends)
 */
export class DebugDrawScope {
    constructor(debugDraw) {
        debugDraw._assertAlive();
        this.debug = debugDraw;
        this._debugGeneration = debugDraw._generation;
        this._startLineCount = debugDraw.lineCount;
        this._ended = false;
    }

    _scopeError() {
        const error = new Error('[DebugDrawScope] ended');
        error.code = 'VGPU_DEBUG_DRAW_SCOPE_ENDED';
        return error;
    }

    _assertActive() {
        if (this._ended) throw this._scopeError();
        this.debug._assertGeneration(this._debugGeneration);
    }

    _invoke(method, args) {
        this._assertActive();
        const result = this.debug[method](...args);
        if (this._ended) {
            if (!this.debug._destroyed && this.debug._generation === this._debugGeneration) {
                this.debug.lineCount = Math.min(this.debug.lineCount, this._startLineCount);
            }
            throw this._scopeError();
        }
        this.debug._assertGeneration(this._debugGeneration);
        return result;
    }

    line(...args) { return this._invoke('line', args); }
    ray(...args) { return this._invoke('ray', args); }
    arrow(...args) { return this._invoke('arrow', args); }
    box(...args) { return this._invoke('box', args); }
    sphere(...args) { return this._invoke('sphere', args); }
    circle(...args) { return this._invoke('circle', args); }
    axes(...args) { return this._invoke('axes', args); }
    grid(...args) { return this._invoke('grid', args); }
    frustum(...args) { return this._invoke('frustum', args); }

    end() {
        if (this._ended) return false;
        this._ended = true;
        if (this.debug._destroyed || this.debug._generation !== this._debugGeneration) return false;
        this.debug.lineCount = Math.min(this.debug.lineCount, this._startLineCount);
        this.debug._assertGeneration(this._debugGeneration);
        return true;
    }
}
