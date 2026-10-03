// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Optimization Integration Helper
 * Easy drop-in replacements for common performance bottlenecks
 */

import { MappedBufferWriter } from './MappedBufferWriter.js';
import { RenderBundleManager } from '../../render/RenderBundleManager.js';

/**
 * Enhanced GPU Device wrapper with all optimizations
 */
export class OptimizedGPUDevice {
    constructor(gpuDevice) {
        this.gpuDevice = gpuDevice;
        this.device = gpuDevice.getDevice();
        
        // Optimization systems
        this.pipelineCache = gpuDevice.getPipelineCache();
        this.bufferPool = gpuDevice.getBufferPool();
        this.workScheduler = gpuDevice.getWorkScheduler();
        
        // Additional optimizers
        this.renderBundleManager = new RenderBundleManager(this.device);
        this.uniformWriters = new Map();
    }

    /**
     * Optimized uniform buffer update (uses mapped buffers)
     */
    updateUniformBuffer(buffer, data, offset = 0) {
        const key = buffer;
        
        if (!this.uniformWriters.has(key)) {
            const writer = new MappedBufferWriter(
                this.device,
                buffer.size,
                GPUBufferUsage.UNIFORM
            );
            this.uniformWriters.set(key, writer);
        }
        
        const writer = this.uniformWriters.get(key);
        const encoder = this.device.createCommandEncoder({
            label: 'UniformUpdate',
        });
        
        writer.write(encoder, data, offset);
        
        const commandBuffer = encoder.finish();
        this.scheduleWork(commandBuffer, 1);
    }

    /**
     * Quick uniform update (uses writeBuffer for small data)
     */
    updateUniformBufferSmall(buffer, data, offset = 0) {
        this.device.queue.writeBuffer(buffer, offset, data);
    }

    /**
     * Schedule GPU work with intelligent batching
     */
    scheduleWork(commandBuffer, priority = 1) {
        if (this.workScheduler) {
            this.workScheduler.schedule(commandBuffer, priority);
        } else {
            this.device.queue.submit([commandBuffer]);
        }
    }

    /**
     * Flush all pending GPU work
     */
    flush() {
        if (this.workScheduler) {
            this.workScheduler.flush();
        }
    }

    /**
     * Get or create render bundle for repeated geometry
     */
    getRenderBundle(key, recordCallback, descriptor) {
        return this.renderBundleManager.createBundle(key, recordCallback, descriptor);
    }

    /**
     * Get statistics from all optimization systems
     */
    getOptimizationStats() {
        return {
            pipelineCache: this.pipelineCache?.getStats() || {},
            bufferPool: this.bufferPool?.getStats() || {},
            workScheduler: this.workScheduler?.getStats() || {},
            renderBundles: this.renderBundleManager?.getStats() || {},
        };
    }

    /**
     * Log performance statistics
     */
    logStats() {
        const stats = this.getOptimizationStats();
        console.log('[Optimization Stats]', JSON.stringify(stats, null, 2));
    }
}

/**
 * Quick optimization helper functions
 */
export const OptimizationHelpers = {
    /**
     * Replace device.queue.writeBuffer() with optimized mapped buffer write
     */
    optimizedWrite(device, targetBuffer, data, offset = 0) {
        const encoder = device.createCommandEncoder({
            label: 'OptimizedWrite',
        });
        
        // Create temporary mapped buffer
        const stagingBuffer = device.createBuffer({
            size: data.byteLength,
            usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        
        const mappedRange = stagingBuffer.getMappedRange();
        const mappedArray = new Uint8Array(mappedRange);
        
        if (data instanceof ArrayBuffer) {
            mappedArray.set(new Uint8Array(data));
        } else if (ArrayBuffer.isView(data)) {
            mappedArray.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        }
        
        stagingBuffer.unmap();
        
        encoder.copyBufferToBuffer(
            stagingBuffer, 0,
            targetBuffer, offset,
            data.byteLength
        );
        
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
        
        // Clean up
        setTimeout(() => stagingBuffer.destroy(), 1000);
    },

    /**
     * Measure optimization impact
     */
    measureOptimization(name, fn) {
        const start = performance.now();
        const result = fn();
        const duration = performance.now() - start;
        
        if (duration > 1) {
            console.log(`[Optimization] ${name}: ${duration.toFixed(2)}ms`);
        }
        
        return result;
    },
};
