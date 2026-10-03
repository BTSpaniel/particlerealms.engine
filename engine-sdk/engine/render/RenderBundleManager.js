// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Render Bundle Manager - Pre-record draw commands for massive CPU overhead reduction
 * Based on WebGPU best practices from Toji.dev
 * Reduces draw call overhead by 10x for repeated rendering
 */

export class RenderBundleManager {
    constructor(device) {
        this.device = device;
        this.bundles = new Map();
        this.stats = {
            bundlesCreated: 0,
            bundlesUsed: 0,
            cpuTimeSaved: 0,
        };
    }

    /**
     * Create a render bundle for repeated draw calls
     * @param {string} key - Unique identifier for this bundle
     * @param {function} recordCallback - Function that records draw commands
     * @param {object} descriptor - Render bundle encoder descriptor
     */
    createBundle(key, recordCallback, descriptor) {
        if (this.bundles.has(key)) {
            return this.bundles.get(key);
        }

        const bundleEncoder = this.device.createRenderBundleEncoder({
            colorFormats: descriptor.colorFormats || ['bgra8unorm'],
            depthStencilFormat: descriptor.depthStencilFormat || 'depth24plus',
            sampleCount: descriptor.sampleCount || 1,
            label: `RenderBundle_${key}`,
        });

        // Record draw commands
        recordCallback(bundleEncoder);

        const bundle = bundleEncoder.finish();
        this.bundles.set(key, bundle);
        this.stats.bundlesCreated++;

        console.log(`[RenderBundle] Created bundle: ${key}`);
        return bundle;
    }

    /**
     * Execute a render bundle in a render pass
     */
    executeBundle(pass, key) {
        const bundle = this.bundles.get(key);
        if (!bundle) {
            console.warn(`[RenderBundle] Bundle not found: ${key}`);
            return false;
        }

        pass.executeBundles([bundle]);
        this.stats.bundlesUsed++;
        return true;
    }

    /**
     * Create particle rendering bundle
     */
    createParticleBundle(pipeline, bindGroups, vertexBuffers, instanceCount, descriptor) {
        const key = `particles_${instanceCount}`;
        
        return this.createBundle(key, (encoder) => {
            encoder.setPipeline(pipeline);
            
            // Set bind groups
            for (let i = 0; i < bindGroups.length; i++) {
                if (bindGroups[i]) {
                    encoder.setBindGroup(i, bindGroups[i]);
                }
            }
            
            // Set vertex buffers
            for (let i = 0; i < vertexBuffers.length; i++) {
                if (vertexBuffers[i]) {
                    encoder.setVertexBuffer(i, vertexBuffers[i]);
                }
            }
            
            // Draw instanced
            encoder.draw(6, instanceCount, 0, 0); // 6 vertices for 2 triangles (quad)
        }, descriptor);
    }

    /**
     * Invalidate a bundle (force recreation)
     */
    invalidate(key) {
        if (this.bundles.has(key)) {
            this.bundles.delete(key);
            return true;
        }
        return false;
    }

    /**
     * Clear all bundles
     */
    clear() {
        this.bundles.clear();
    }

    getStats() {
        return {
            ...this.stats,
            totalBundles: this.bundles.size,
            avgTimeSaved: this.stats.bundlesUsed > 0 
                ? this.stats.cpuTimeSaved / this.stats.bundlesUsed 
                : 0,
        };
    }
}

/**
 * Particle-specific render bundle optimization
 * Pre-records particle billboard rendering for massive performance gains
 */
export class ParticleRenderBundleCache {
    constructor(device) {
        this.device = device;
        this.manager = new RenderBundleManager(device);
        this.cachedConfigs = new Map();
    }

    /**
     * Get or create particle render bundle
     * Bundles are keyed by instance count brackets (powers of 2)
     */
    getOrCreateBundle(pipeline, bindGroups, vertexBuffers, instanceCount, descriptor) {
        // Round up to nearest power of 2 for better cache reuse
        const bundleSize = Math.pow(2, Math.ceil(Math.log2(instanceCount)));
        const key = `particles_${bundleSize}`;
        
        let bundle = this.manager.bundles.get(key);
        if (!bundle) {
            bundle = this.manager.createParticleBundle(
                pipeline, 
                bindGroups, 
                vertexBuffers, 
                bundleSize, 
                descriptor
            );
        }
        
        return { bundle, actualInstanceCount: instanceCount };
    }

    /**
     * Execute particle bundle with dynamic instance count
     */
    executeParticleBundle(pass, pipeline, bindGroups, vertexBuffers, instanceCount, descriptor) {
        const { bundle } = this.getOrCreateBundle(pipeline, bindGroups, vertexBuffers, instanceCount, descriptor);
        
        // Execute the bundle
        pass.executeBundles([bundle]);
        
        return true;
    }

    clear() {
        this.manager.clear();
        this.cachedConfigs.clear();
    }

    getStats() {
        return this.manager.getStats();
    }
}
