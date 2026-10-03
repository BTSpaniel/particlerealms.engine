// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RenderBundleCache.js - Pre-recorded Render Commands for Voxel Terrain
 * 
 * Render bundles dramatically reduce CPU overhead by pre-recording render commands.
 * Instead of issuing thousands of draw calls per frame, we execute a single bundle.
 * 
 * Based on: https://toji.dev/webgpu-best-practices/render-bundles.html
 * 
 * Benefits:
 * - Skip JS→C++→GPU process validation each frame
 * - 50-80% reduction in CPU render time
 * - Frees CPU for other work (physics, AI, etc.)
 * 
 * Limitations:
 * - Bundle must be recreated when chunks load/unload
 * - Bind groups and pipelines are locked at creation time
 * - Best for relatively static scenes
 */

/**
 * RenderBundleCache - Manages render bundles for voxel terrain
 */
export class RenderBundleCache {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // Cached render bundles
        this.opaqueBundle = null;
        this.waterBundle = null;
        
        // Bundle configuration
        this.colorFormat = 'bgra8unorm';
        this.depthFormat = 'depth24plus';
        
        // Dirty flag - set when chunks change
        this.isDirty = true;
        this.lastChunkCount = 0;
        this.lastBundleTime = 0;
        
        // Statistics
        this.stats = {
            bundleCreateCount: 0,
            bundleCreateTimeMs: 0,
            chunksInBundle: 0,
            drawCallsInBundle: 0,
        };
        
        // Configuration
        this.enabled = true;
        this.minChunksForBundle = 10;  // Don't bother with bundles for small scenes
        this.rebuildCooldownMs = 100;  // Minimum time between rebuilds
    }
    
    /**
     * Initialize the render bundle cache
     * @param {GPUDevice} device 
     * @param {string} colorFormat 
     * @param {string} depthFormat 
     */
    init(device, colorFormat = 'bgra8unorm', depthFormat = 'depth24plus') {
        this.device = device;
        this.colorFormat = colorFormat;
        this.depthFormat = depthFormat;
        this.initialized = true;
        console.log('[RenderBundleCache] Initialized');
    }
    
    /**
     * Mark bundles as needing rebuild (call when chunks change)
     */
    invalidate() {
        this.isDirty = true;
    }
    
    /**
     * Check if bundles need rebuild
     * @param {number} currentChunkCount 
     * @returns {boolean}
     */
    needsRebuild(currentChunkCount) {
        if (!this.enabled) return false;
        if (!this.isDirty && currentChunkCount === this.lastChunkCount) return false;
        
        // Cooldown to prevent constant rebuilds during streaming
        const now = performance.now();
        if (now - this.lastBundleTime < this.rebuildCooldownMs) return false;
        
        return true;
    }
    
    /**
     * Build opaque terrain render bundle
     * @param {GPURenderPipeline} pipeline 
     * @param {GPUBindGroup} frameBindGroup 
     * @param {Array} chunks - Array of chunk objects with vertex/index buffers
     * @param {Object} options - Additional options
     * @returns {GPURenderBundle|null}
     */
    buildOpaqueBundle(pipeline, frameBindGroup, chunks, options = {}) {
        if (!this.initialized) return null;
        if (chunks.length < this.minChunksForBundle) return null;
        
        const startTime = performance.now();
        
        const encoder = this.device.createRenderBundleEncoder({
            label: 'Opaque Terrain Bundle',
            colorFormats: [this.colorFormat],
            depthStencilFormat: this.depthFormat,
            sampleCount: options.sampleCount || 1,
        });
        
        encoder.setPipeline(pipeline);
        encoder.setBindGroup(0, frameBindGroup);
        
        let drawCalls = 0;
        
        for (const chunk of chunks) {
            // Skip chunks without valid buffers
            if (!chunk.vertexBuffer || !chunk.indexBuffer || !chunk.indexCount) {
                continue;
            }
            
            // Set chunk-specific bind group if provided
            if (chunk.bindGroup) {
                encoder.setBindGroup(1, chunk.bindGroup);
            }
            
            encoder.setVertexBuffer(0, chunk.vertexBuffer);
            encoder.setIndexBuffer(chunk.indexBuffer, 'uint32');
            
            // Use indirect draw if available (for GPU-driven rendering)
            if (options.useIndirectDraw && options.indirectBuffer && chunk.batchOffset !== undefined) {
                encoder.drawIndexedIndirect(options.indirectBuffer, chunk.batchOffset);
            } else {
                encoder.drawIndexed(chunk.indexCount);
            }
            
            drawCalls++;
        }
        
        this.opaqueBundle = encoder.finish();
        
        // Update stats
        this.stats.bundleCreateCount++;
        this.stats.bundleCreateTimeMs = performance.now() - startTime;
        this.stats.chunksInBundle = chunks.length;
        this.stats.drawCallsInBundle = drawCalls;
        
        this.isDirty = false;
        this.lastChunkCount = chunks.length;
        this.lastBundleTime = performance.now();
        
        return this.opaqueBundle;
    }
    
    /**
     * Build water/transparent render bundle
     * @param {GPURenderPipeline} pipeline 
     * @param {GPUBindGroup} frameBindGroup 
     * @param {Array} chunks 
     * @param {Object} options 
     * @returns {GPURenderBundle|null}
     */
    buildWaterBundle(pipeline, frameBindGroup, chunks, options = {}) {
        if (!this.initialized) return null;
        
        // Filter to chunks with water
        const waterChunks = chunks.filter(c => c.waterVertexBuffer && c.waterIndexCount > 0);
        if (waterChunks.length === 0) return null;
        
        const encoder = this.device.createRenderBundleEncoder({
            label: 'Water Bundle',
            colorFormats: [this.colorFormat],
            depthStencilFormat: this.depthFormat,
            sampleCount: options.sampleCount || 1,
        });
        
        encoder.setPipeline(pipeline);
        encoder.setBindGroup(0, frameBindGroup);
        
        for (const chunk of waterChunks) {
            if (chunk.waterBindGroup) {
                encoder.setBindGroup(1, chunk.waterBindGroup);
            }
            
            encoder.setVertexBuffer(0, chunk.waterVertexBuffer);
            encoder.setIndexBuffer(chunk.waterIndexBuffer, 'uint32');
            encoder.drawIndexed(chunk.waterIndexCount);
        }
        
        this.waterBundle = encoder.finish();
        return this.waterBundle;
    }
    
    /**
     * Execute the opaque bundle
     * @param {GPURenderPassEncoder} renderPass 
     * @returns {boolean} - True if bundle was executed
     */
    executeOpaqueBundle(renderPass) {
        if (!this.opaqueBundle) return false;
        renderPass.executeBundles([this.opaqueBundle]);
        return true;
    }
    
    /**
     * Execute the water bundle
     * @param {GPURenderPassEncoder} renderPass 
     * @returns {boolean}
     */
    executeWaterBundle(renderPass) {
        if (!this.waterBundle) return false;
        renderPass.executeBundles([this.waterBundle]);
        return true;
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [render_bundles] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.maxCached = parseInt(cfg.max_cached) || 128;
        this.lifetime = parseInt(cfg.lifetime) || 300;
    }
    
    /**
     * Destroy cached bundles
     */
    destroy() {
        this.opaqueBundle = null;
        this.waterBundle = null;
        this.isDirty = true;
        this.initialized = false;
    }
}

export default RenderBundleCache;
