// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PipelineCache.js - Async Pipeline Compilation & Caching
 * 
 * Eliminates frame hitches by compiling all pipelines asynchronously at startup.
 * Caches pipelines for instant retrieval during rendering.
 * 
 * Benefits:
 * - No frame drops during shader compilation
 * - All shaders ready before first frame
 * - Easy pipeline management
 * 
 * Usage:
 *   await pipelineCache.warmup(device, [
 *       { name: 'terrain', descriptor: terrainDesc },
 *       { name: 'water', descriptor: waterDesc },
 *   ]);
 *   
 *   const pipeline = pipelineCache.getRender('terrain');
 */

/**
 * PipelineCache - Async pipeline compilation and caching
 */
export class PipelineCache {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // Cached pipelines
        this.renderPipelines = new Map();
        this.computePipelines = new Map();
        
        // Bind group layouts (derived from pipelines)
        this.bindGroupLayouts = new Map();
        
        // Compilation stats
        this.stats = {
            renderPipelinesCompiled: 0,
            computePipelinesCompiled: 0,
            totalCompileTimeMs: 0,
            failedCompilations: 0,
        };
        
        // Pending compilations
        this.pendingRender = new Map();
        this.pendingCompute = new Map();
    }
    
    /**
     * Initialize the cache
     * @param {GPUDevice} device 
     */
    init(device) {
        this.device = device;
        this.initialized = true;
        console.log('[PipelineCache] Initialized');
    }
    
    /**
     * Warmup by compiling multiple pipelines in parallel
     * @param {Array} configs - Array of { name, type, descriptor }
     * @returns {Promise} - Resolves when all pipelines are ready
     */
    async warmup(configs) {
        if (!this.initialized) {
            throw new Error('PipelineCache not initialized');
        }
        
        const startTime = performance.now();
        console.log(`[PipelineCache] Warming up ${configs.length} pipelines...`);
        
        const promises = configs.map(async (config) => {
            try {
                if (config.type === 'compute') {
                    await this.createComputePipelineAsync(config.name, config.descriptor);
                } else {
                    await this.createRenderPipelineAsync(config.name, config.descriptor);
                }
            } catch (err) {
                console.error(`[PipelineCache] Failed to compile ${config.name}:`, err);
                this.stats.failedCompilations++;
            }
        });
        
        await Promise.all(promises);
        
        this.stats.totalCompileTimeMs = performance.now() - startTime;
        console.log(`[PipelineCache] Warmup complete: ${this.stats.renderPipelinesCompiled} render, ${this.stats.computePipelinesCompiled} compute in ${this.stats.totalCompileTimeMs.toFixed(0)}ms`);
    }
    
    /**
     * Create a render pipeline asynchronously
     * @param {string} name 
     * @param {Object} descriptor 
     * @returns {Promise<GPURenderPipeline>}
     */
    async createRenderPipelineAsync(name, descriptor) {
        // Check if already exists
        if (this.renderPipelines.has(name)) {
            return this.renderPipelines.get(name);
        }
        
        // Check if already pending
        if (this.pendingRender.has(name)) {
            return this.pendingRender.get(name);
        }
        
        // Start async compilation
        const promise = this.device.createRenderPipelineAsync(descriptor)
            .then(pipeline => {
                this.renderPipelines.set(name, pipeline);
                this.pendingRender.delete(name);
                this.stats.renderPipelinesCompiled++;
                
                // Cache bind group layout
                if (descriptor.layout === 'auto') {
                    try {
                        this.bindGroupLayouts.set(`${name}_0`, pipeline.getBindGroupLayout(0));
                        this.bindGroupLayouts.set(`${name}_1`, pipeline.getBindGroupLayout(1));
                    } catch (e) { /* Layout not available */ }
                }
                
                return pipeline;
            });
        
        this.pendingRender.set(name, promise);
        return promise;
    }
    
    /**
     * Create a compute pipeline asynchronously
     * @param {string} name 
     * @param {Object} descriptor 
     * @returns {Promise<GPUComputePipeline>}
     */
    async createComputePipelineAsync(name, descriptor) {
        // Check if already exists
        if (this.computePipelines.has(name)) {
            return this.computePipelines.get(name);
        }
        
        // Check if already pending
        if (this.pendingCompute.has(name)) {
            return this.pendingCompute.get(name);
        }
        
        // Start async compilation
        const promise = this.device.createComputePipelineAsync(descriptor)
            .then(pipeline => {
                this.computePipelines.set(name, pipeline);
                this.pendingCompute.delete(name);
                this.stats.computePipelinesCompiled++;
                
                // Cache bind group layout
                if (descriptor.layout === 'auto') {
                    try {
                        this.bindGroupLayouts.set(`${name}_0`, pipeline.getBindGroupLayout(0));
                    } catch (e) { /* Layout not available */ }
                }
                
                return pipeline;
            });
        
        this.pendingCompute.set(name, promise);
        return promise;
    }
    
    /**
     * Create render pipeline synchronously (use only if async not possible)
     * @param {string} name 
     * @param {Object} descriptor 
     * @returns {GPURenderPipeline}
     */
    createRenderPipelineSync(name, descriptor) {
        if (this.renderPipelines.has(name)) {
            return this.renderPipelines.get(name);
        }
        
        const pipeline = this.device.createRenderPipeline(descriptor);
        this.renderPipelines.set(name, pipeline);
        this.stats.renderPipelinesCompiled++;
        
        return pipeline;
    }
    
    /**
     * Create compute pipeline synchronously
     * @param {string} name 
     * @param {Object} descriptor 
     * @returns {GPUComputePipeline}
     */
    createComputePipelineSync(name, descriptor) {
        if (this.computePipelines.has(name)) {
            return this.computePipelines.get(name);
        }
        
        const pipeline = this.device.createComputePipeline(descriptor);
        this.computePipelines.set(name, pipeline);
        this.stats.computePipelinesCompiled++;
        
        return pipeline;
    }
    
    /**
     * Get a cached render pipeline
     * @param {string} name 
     * @returns {GPURenderPipeline|null}
     */
    getRender(name) {
        return this.renderPipelines.get(name) || null;
    }
    
    /**
     * Get a cached compute pipeline
     * @param {string} name 
     * @returns {GPUComputePipeline|null}
     */
    getCompute(name) {
        return this.computePipelines.get(name) || null;
    }
    
    /**
     * Get a cached bind group layout
     * @param {string} name 
     * @returns {GPUBindGroupLayout|null}
     */
    getLayout(name) {
        return this.bindGroupLayouts.get(name) || null;
    }
    
    /**
     * Check if a render pipeline exists
     * @param {string} name 
     * @returns {boolean}
     */
    hasRender(name) {
        return this.renderPipelines.has(name);
    }
    
    /**
     * Check if a compute pipeline exists
     * @param {string} name 
     * @returns {boolean}
     */
    hasCompute(name) {
        return this.computePipelines.has(name);
    }
    
    /**
     * Wait for a pipeline to be ready
     * @param {string} name 
     * @param {string} type - 'render' or 'compute'
     * @returns {Promise}
     */
    async waitFor(name, type = 'render') {
        if (type === 'render') {
            if (this.renderPipelines.has(name)) return this.renderPipelines.get(name);
            if (this.pendingRender.has(name)) return this.pendingRender.get(name);
        } else {
            if (this.computePipelines.has(name)) return this.computePipelines.get(name);
            if (this.pendingCompute.has(name)) return this.pendingCompute.get(name);
        }
        return null;
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            renderPipelineCount: this.renderPipelines.size,
            computePipelineCount: this.computePipelines.size,
            pendingRenderCount: this.pendingRender.size,
            pendingComputeCount: this.pendingCompute.size,
        };
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [pipeline_cache] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.maxCached = parseInt(cfg.max_cached) || 64;
        this.asyncCompile = cfg.async_compile !== false;
    }
    
    /**
     * Destroy all pipelines
     */
    destroy() {
        this.renderPipelines.clear();
        this.computePipelines.clear();
        this.bindGroupLayouts.clear();
        this.pendingRender.clear();
        this.pendingCompute.clear();
        this.initialized = false;
    }
}

export default PipelineCache;
