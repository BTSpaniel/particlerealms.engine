// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PipelineCache.js - WebGPU Pipeline Caching and Specialization
 *
 * Implements:
 * 1. Pipeline caching with composite keys (shader + overrides + render state)
 * 2. Async pipeline compilation to prevent frame hitches
 * 3. Pipeline specialization via override constants
 * 4. Automatic pipeline invalidation on shader changes
 */

import { PipelineOverrides } from './ShaderComposer.js';
import { GpuDescriptorIdentity } from '../../core/gpu/GpuDescriptorIdentity.js';

// Descriptor keys are used as Map equality, so they must retain the complete
// canonical value and the identity of opaque WebGPU host objects. Short hashes
// are suitable for diagnostics only and must never decide pipeline equality.
const DESCRIPTOR_IDENTITY = new GpuDescriptorIdentity({ generation: 0 });

/**
 * RenderStateDescriptor - Describes render pipeline state
 */
export class RenderStateDescriptor {
    constructor() {
        // Primitive state
        this.topology = 'triangle-list';
        this.cullMode = 'back';
        this.frontFace = 'ccw';

        // Depth/stencil state
        this.depthFormat = 'depth24plus';
        this.depthWriteEnabled = true;
        this.depthCompare = 'less';

        // Blend state
        this.blendEnabled = false;
        this.blendColor = {
            srcFactor: 'one',
            dstFactor: 'zero',
            operation: 'add',
        };
        this.blendAlpha = {
            srcFactor: 'one',
            dstFactor: 'zero',
            operation: 'add',
        };

        // Color target
        this.colorFormat = 'bgra8unorm';
        this.writeMask = GPUColorWrite.ALL;

        // Multisample
        this.sampleCount = 1;
    }

    /**
     * Set primitive topology
     * @param {string} topology - triangle-list, triangle-strip, line-list, etc.
     * @returns {RenderStateDescriptor}
     */
    setTopology(topology) {
        this.topology = topology;
        return this;
    }

    /**
     * Set cull mode
     * @param {string} cullMode - none, front, back
     * @returns {RenderStateDescriptor}
     */
    setCullMode(cullMode) {
        this.cullMode = cullMode;
        return this;
    }

    /**
     * Set depth test configuration
     * @param {Object} options - { format, writeEnabled, compare }
     * @returns {RenderStateDescriptor}
     */
    setDepthState(options) {
        if (options.format !== undefined) this.depthFormat = options.format;
        if (options.writeEnabled !== undefined) this.depthWriteEnabled = options.writeEnabled;
        if (options.compare !== undefined) this.depthCompare = options.compare;
        return this;
    }

    /**
     * Enable alpha blending
     * @param {string} mode - 'alpha', 'additive', 'multiply', or custom
     * @returns {RenderStateDescriptor}
     */
    setBlendMode(mode) {
        this.blendEnabled = true;

        switch (mode) {
            case 'alpha':
                this.blendColor = {
                    srcFactor: 'src-alpha',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add',
                };
                this.blendAlpha = {
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add',
                };
                break;
            case 'additive':
                this.blendColor = {
                    srcFactor: 'src-alpha',
                    dstFactor: 'one',
                    operation: 'add',
                };
                this.blendAlpha = {
                    srcFactor: 'one',
                    dstFactor: 'one',
                    operation: 'add',
                };
                break;
            case 'multiply':
                this.blendColor = {
                    srcFactor: 'dst-color',
                    dstFactor: 'zero',
                    operation: 'add',
                };
                this.blendAlpha = {
                    srcFactor: 'dst-alpha',
                    dstFactor: 'zero',
                    operation: 'add',
                };
                break;
            case 'premultiplied':
                this.blendColor = {
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add',
                };
                this.blendAlpha = {
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                    operation: 'add',
                };
                break;
            default:
                // Keep current or use as custom object
                if (typeof mode === 'object') {
                    if (mode.color) this.blendColor = mode.color;
                    if (mode.alpha) this.blendAlpha = mode.alpha;
                }
        }
        return this;
    }

    /**
     * Disable blending
     * @returns {RenderStateDescriptor}
     */
    disableBlend() {
        this.blendEnabled = false;
        return this;
    }

    /**
     * Set color format
     * @param {string} format
     * @returns {RenderStateDescriptor}
     */
    setColorFormat(format) {
        this.colorFormat = format;
        return this;
    }

    /**
     * Set multisample count
     * @param {number} count
     * @returns {RenderStateDescriptor}
     */
    setMultisample(count) {
        this.sampleCount = count;
        return this;
    }

    /**
     * Generate cache key string
     * @returns {string}
     */
    toCacheKey() {
        return DESCRIPTOR_IDENTITY.key({
            primitive: {
                topology: this.topology,
                cullMode: this.cullMode,
                frontFace: this.frontFace,
            },
            depthStencil: this.depthFormat ? {
                format: this.depthFormat,
                depthWriteEnabled: this.depthWriteEnabled,
                depthCompare: this.depthCompare,
            } : undefined,
            fragmentTarget: {
                format: this.colorFormat,
                writeMask: this.writeMask,
                blend: this.blendEnabled ? {
                    color: this.blendColor,
                    alpha: this.blendAlpha,
                } : undefined,
            },
            multisample: { count: this.sampleCount },
        }, 'render-material-state');
    }

    /**
     * Create a copy of this descriptor
     * @returns {RenderStateDescriptor}
     */
    clone() {
        const copy = new RenderStateDescriptor();
        Object.assign(copy, JSON.parse(JSON.stringify(this)));
        return copy;
    }
}

/**
 * PipelineDescriptor - Complete pipeline configuration
 */
export class PipelineDescriptor {
    constructor(shaderModule, layout) {
        this.shaderModule = shaderModule;
        this.layout = layout;
        this.vertexEntryPoint = 'vs_main';
        this.fragmentEntryPoint = 'fs_main';
        this.vertexBufferLayouts = [];
        this.overrides = new PipelineOverrides();
        this.renderState = new RenderStateDescriptor();
        this.label = 'Pipeline';
    }

    /**
     * Set entry points
     * @param {string} vertex
     * @param {string} fragment
     * @returns {PipelineDescriptor}
     */
    setEntryPoints(vertex, fragment) {
        this.vertexEntryPoint = vertex;
        this.fragmentEntryPoint = fragment;
        return this;
    }

    /**
     * Add vertex buffer layout
     * @param {Object} layout - { arrayStride, stepMode, attributes }
     * @returns {PipelineDescriptor}
     */
    addVertexBuffer(layout) {
        this.vertexBufferLayouts.push(layout);
        return this;
    }

    /**
     * Set override constants
     * @param {PipelineOverrides|Object} overrides
     * @returns {PipelineDescriptor}
     */
    setOverrides(overrides) {
        if (overrides instanceof PipelineOverrides) {
            this.overrides = overrides;
        } else {
            this.overrides = new PipelineOverrides().setAll(overrides);
        }
        return this;
    }

    /**
     * Set render state
     * @param {RenderStateDescriptor} state
     * @returns {PipelineDescriptor}
     */
    setRenderState(state) {
        this.renderState = state;
        return this;
    }

    /**
     * Set label for debugging
     * @param {string} label
     * @returns {PipelineDescriptor}
     */
    setLabel(label) {
        this.label = label;
        return this;
    }

    /**
     * Generate cache key
     * @returns {string}
     */
    toCacheKey() {
        return DESCRIPTOR_IDENTITY.key(
            this.toWebGPUDescriptor(),
            'render-material-pipeline',
        );
    }

    /**
     * Build WebGPU render pipeline descriptor
     * @returns {Object}
     */
    toWebGPUDescriptor() {
        const constants = this.overrides.toConstants();
        const hasConstants = Object.keys(constants).length > 0;

        const descriptor = {
            label: this.label,
            layout: this.layout,
            vertex: {
                module: this.shaderModule,
                entryPoint: this.vertexEntryPoint,
                buffers: this.vertexBufferLayouts,
            },
            primitive: {
                topology: this.renderState.topology,
                cullMode: this.renderState.cullMode,
                frontFace: this.renderState.frontFace,
            },
            multisample: {
                count: this.renderState.sampleCount,
            },
        };

        // Add vertex constants if any
        if (hasConstants) {
            descriptor.vertex.constants = constants;
        }

        // Fragment state
        const colorTarget = {
            format: this.renderState.colorFormat,
            writeMask: this.renderState.writeMask,
        };

        if (this.renderState.blendEnabled) {
            colorTarget.blend = {
                color: this.renderState.blendColor,
                alpha: this.renderState.blendAlpha,
            };
        }

        descriptor.fragment = {
            module: this.shaderModule,
            entryPoint: this.fragmentEntryPoint,
            targets: [colorTarget],
        };

        if (hasConstants) {
            descriptor.fragment.constants = constants;
        }

        // Depth/stencil state
        if (this.renderState.depthFormat) {
            descriptor.depthStencil = {
                format: this.renderState.depthFormat,
                depthWriteEnabled: this.renderState.depthWriteEnabled,
                depthCompare: this.renderState.depthCompare,
            };
        }

        return descriptor;
    }
}

export class ComputePipelineDescriptor {
    constructor(shaderModule, layout) {
        this.shaderModule = shaderModule;
        this.layout = layout;
        this.computeEntryPoint = 'main';
        this.overrides = new PipelineOverrides();
        this.label = 'ComputePipeline';
    }

    setEntryPoint(entryPoint) {
        this.computeEntryPoint = entryPoint;
        return this;
    }

    setOverrides(overrides) {
        if (overrides instanceof PipelineOverrides) {
            this.overrides = overrides;
        } else {
            this.overrides = new PipelineOverrides().setAll(overrides);
        }
        return this;
    }

    setLabel(label) {
        this.label = label;
        return this;
    }

    toCacheKey() {
        return DESCRIPTOR_IDENTITY.key(
            this.toWebGPUDescriptor(),
            'compute-material-pipeline',
        );
    }

    toWebGPUDescriptor() {
        const constants = this.overrides.toConstants();
        const hasConstants = Object.keys(constants).length > 0;

        const descriptor = {
            label: this.label,
            layout: this.layout,
            compute: {
                module: this.shaderModule,
                entryPoint: this.computeEntryPoint,
            },
        };

        if (hasConstants) {
            descriptor.compute.constants = constants;
        }

        return descriptor;
    }
}

function createPipelineMetadata(descriptor, webGpuDescriptor) {
    const shaderModules = new Set();
    for (const stage of ['vertex', 'fragment', 'compute']) {
        const shaderModule = webGpuDescriptor[stage]?.module;
        if (shaderModule) shaderModules.add(shaderModule);
    }
    return { descriptor, webGpuDescriptor, shaderModules };
}

class MaterialPipelineCacheBase {
    constructor(device, { syncMethod, asyncMethod, logLabel }) {
        this.device = device;
        this.cache = new Map();
        this.pendingCompilations = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            asyncCompilations: 0,
        };

        this._syncMethod = syncMethod;
        this._asyncMethod = asyncMethod;
        this._logLabel = logLabel;
        this._managerEpoch = 0;
        this._keyEpochs = new Map();
        this._cacheMetadata = new Map();
        this._pendingMetadata = new Map();
    }

    _key(descriptor) {
        return descriptor.toCacheKey();
    }

    _keyEpoch(key) {
        return this._keyEpochs.get(key) || 0;
    }

    _bumpKeyEpoch(key) {
        this._keyEpochs.set(key, this._keyEpoch(key) + 1);
    }

    _isCurrentCompilation(key, promise, managerEpoch, keyEpoch, pendingMetadata) {
        return managerEpoch === this._managerEpoch
            && keyEpoch === this._keyEpoch(key)
            && this.pendingCompilations.get(key) === promise
            && this._pendingMetadata.get(key) === pendingMetadata;
    }

    getOrCreate(descriptor) {
        const key = this._key(descriptor);
        if (this.cache.has(key)) {
            this.stats.hits++;
            return this.cache.get(key);
        }

        this.stats.misses++;
        if (this.pendingCompilations.has(key)) return null;

        const managerEpoch = this._managerEpoch;
        const keyEpoch = this._keyEpoch(key);
        const webGpuDescriptor = descriptor.toWebGPUDescriptor();
        const metadata = createPipelineMetadata(descriptor, webGpuDescriptor);
        const pipeline = this.device[this._syncMethod](webGpuDescriptor);

        // A mock or host callback can re-enter clear()/invalidate() while the
        // device creates the pipeline. Never publish across that boundary.
        if (managerEpoch === this._managerEpoch && keyEpoch === this._keyEpoch(key)) {
            this.cache.set(key, pipeline);
            this._cacheMetadata.set(key, metadata);
        }
        return pipeline;
    }

    getOrCreateAsync(descriptor) {
        const key = this._key(descriptor);
        if (this.cache.has(key)) {
            this.stats.hits++;
            return Promise.resolve(this.cache.get(key));
        }

        const existing = this.pendingCompilations.get(key);
        if (existing) return existing;

        this.stats.misses++;
        this.stats.asyncCompilations++;

        const managerEpoch = this._managerEpoch;
        const keyEpoch = this._keyEpoch(key);
        const webGpuDescriptor = descriptor.toWebGPUDescriptor();
        const metadata = createPipelineMetadata(descriptor, webGpuDescriptor);
        const pendingMetadata = { managerEpoch, keyEpoch, metadata };
        let promise;

        // Start from a settled promise so the exact tracked promise is visible
        // before a device implementation can settle or re-enter the cache.
        promise = Promise.resolve()
            .then(() => this.device[this._asyncMethod](webGpuDescriptor))
            .then(compiledPipeline => {
                if (this._isCurrentCompilation(
                    key,
                    promise,
                    managerEpoch,
                    keyEpoch,
                    pendingMetadata,
                )) {
                    this.cache.set(key, compiledPipeline);
                    this._cacheMetadata.set(key, metadata);
                }
                return compiledPipeline;
            })
            .catch(error => {
                console.error(`[${this._logLabel}] Async compilation failed:`, error);
                throw error;
            })
            .finally(() => {
                if (this.pendingCompilations.get(key) === promise) {
                    this.pendingCompilations.delete(key);
                }
                if (this._pendingMetadata.get(key) === pendingMetadata) {
                    this._pendingMetadata.delete(key);
                }
            });

        this.pendingCompilations.set(key, promise);
        this._pendingMetadata.set(key, pendingMetadata);
        return promise;
    }

    has(descriptor) {
        return this.cache.has(this._key(descriptor));
    }

    isPending(descriptor) {
        return this.pendingCompilations.has(this._key(descriptor));
    }

    invalidate(key) {
        this._bumpKeyEpoch(key);
        this.cache.delete(key);
        this._cacheMetadata.delete(key);
        this.pendingCompilations.delete(key);
        this._pendingMetadata.delete(key);
    }

    invalidateShader(shaderModule) {
        const keys = new Set();
        for (const [key, metadata] of this._cacheMetadata) {
            if (metadata.shaderModules.has(shaderModule)) keys.add(key);
        }
        for (const [key, pending] of this._pendingMetadata) {
            if (pending.metadata.shaderModules.has(shaderModule)) keys.add(key);
        }
        for (const key of keys) this.invalidate(key);
    }

    clear() {
        this._managerEpoch++;
        this.cache.clear();
        this.pendingCompilations.clear();
        this._cacheMetadata.clear();
        this._pendingMetadata.clear();
        this._keyEpochs.clear();
    }

    getStats() {
        return {
            ...this.stats,
            cached: this.cache.size,
            pending: this.pendingCompilations.size,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
        };
    }
}

/** PipelineCache - Caches compiled render pipelines. */
export class PipelineCache extends MaterialPipelineCacheBase {
    constructor(device) {
        super(device, {
            syncMethod: 'createRenderPipeline',
            asyncMethod: 'createRenderPipelineAsync',
            logLabel: 'PipelineCache',
        });
    }

    /**
     * Precompile a set of pipeline variants
     * @param {PipelineDescriptor[]} descriptors
     * @returns {Promise<GPURenderPipeline[]>}
     */
    precompile(descriptors) {
        return Promise.all(descriptors.map(descriptor => this.getOrCreateAsync(descriptor)));
    }
}

/** ComputePipelineCache - Caches compiled compute pipelines. */
export class ComputePipelineCache extends MaterialPipelineCacheBase {
    constructor(device) {
        super(device, {
            syncMethod: 'createComputePipeline',
            asyncMethod: 'createComputePipelineAsync',
            logLabel: 'ComputePipelineCache',
        });
    }
}

/**
 * ShaderModuleCache - Caches compiled shader modules
 */
export class ShaderModuleCache {
    constructor(device) {
        this.device = device;
        this.cache = new Map();
    }

    /**
     * Get or create a shader module
     * @param {string} code - WGSL source code
     * @param {string} label - Debug label
     * @returns {GPUShaderModule}
     */
    getOrCreate(code, label = 'Shader') {
        // WGSL source is already an immutable, collision-free Map key. A
        // truncated numeric digest can alias distinct programs (for example
        // Java-style 31x collisions), so it must not decide module equality.
        let module = this.cache.get(code);
        if (!module) {
            module = this.device.createShaderModule({
                label,
                code,
            });
            this.cache.set(code, module);
        }

        return module;
    }

    /**
     * Invalidate a cached module
     * @param {string} code
     */
    invalidate(code) {
        this.cache.delete(code);
    }

    /**
     * Clear entire cache
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Get cache size
     * @returns {number}
     */
    get size() {
        return this.cache.size;
    }
}

/**
 * MaterialPipelineManager - High-level material-to-pipeline management
 */
export class MaterialPipelineManager {
    constructor(device, pipelineLayout) {
        this.device = device;
        this.pipelineLayout = pipelineLayout;
        this.shaderCache = new ShaderModuleCache(device);
        this.pipelineCache = new PipelineCache(device);
        this.materialShaders = new Map();
    }

    /**
     * Register a shader for a material type
     * @param {string} materialType
     * @param {string} shaderCode
     */
    registerMaterialShader(materialType, shaderCode) {
        const module = this.shaderCache.getOrCreate(shaderCode, `${materialType}_shader`);
        this.materialShaders.set(materialType, module);
    }

    /**
     * Get pipeline for a material
     * @param {string} materialType
     * @param {Object} materialParams - Material-specific parameters
     * @param {Object} vertexLayout - Vertex buffer layout
     * @param {RenderStateDescriptor} renderState
     * @returns {GPURenderPipeline}
     */
    getPipelineForMaterial(materialType, materialParams, vertexLayout, renderState = null) {
        const shaderModule = this.materialShaders.get(materialType);
        if (!shaderModule) {
            throw new Error(`[MaterialPipelineManager] Unknown material type: ${materialType}`);
        }

        // Build overrides from material params
        const overrides = new PipelineOverrides();
        if (materialParams.useNormalMap !== undefined) {
            overrides.set('USE_NORMAL_MAP', materialParams.useNormalMap);
        }
        if (materialParams.useEmissive !== undefined) {
            overrides.set('USE_EMISSIVE', materialParams.useEmissive);
        }
        if (materialParams.alphaCutoff !== undefined) {
            overrides.set('ALPHA_CUTOFF', materialParams.alphaCutoff);
        }

        // Create descriptor
        const descriptor = new PipelineDescriptor(shaderModule, this.pipelineLayout)
            .setLabel(`${materialType}_pipeline`)
            .addVertexBuffer(vertexLayout)
            .setOverrides(overrides)
            .setRenderState(renderState || new RenderStateDescriptor());

        return this.pipelineCache.getOrCreate(descriptor);
    }

    /**
     * Get cache statistics
     * @returns {Object}
     */
    getStats() {
        return {
            shaderModules: this.shaderCache.size,
            ...this.pipelineCache.getStats(),
        };
    }
}

export default {
    RenderStateDescriptor,
    PipelineDescriptor,
    ComputePipelineDescriptor,
    PipelineCache,
    ComputePipelineCache,
    ShaderModuleCache,
    MaterialPipelineManager,
};
