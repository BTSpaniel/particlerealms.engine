// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Async Shader Compilation Queue - Priority-based background compilation
 * Eliminates frame stalls from shader compilation
 */

import { GpuDescriptorIdentity } from './GpuDescriptorIdentity.js';
import { assertCheckedShaderModule } from './GpuShaderDiagnostics.js';

export class ShaderCompilationQueue {
    constructor(device, { generation = 0 } = {}) {
        this.device = device;
        this.queue = [];
        this.compiling = new Map();
        this.compiled = new Map();
        this.isProcessing = false;
        this.identity = new GpuDescriptorIdentity({ generation });
        this._epoch = 0;
        this._destroyed = false;

        this.stats = {
            totalCompiled: 0,
            totalFailed: 0,
            avgCompileTime: 0,
            totalCompileTime: 0,
        };
    }

    /**
     * Queue shader for compilation
     * Priority: 0 = low, 1 = normal, 2 = high, 3 = critical
     */
    queueShader(descriptor, priority = 1, label = '') {
        if (this._destroyed || !this.device) {
            return Promise.reject(new Error('ShaderCompilationQueue is destroyed'));
        }
        const hash = this._hashDescriptor(descriptor);

        if (this.compiled.has(hash)) {
            return Promise.resolve(this.compiled.get(hash));
        }

        if (this.compiling.has(hash)) {
            return this.compiling.get(hash);
        }

        let item;
        const promise = new Promise((resolve, reject) => {
            item = {
                descriptor,
                priority,
                label,
                hash,
                resolve,
                reject,
                queuedAt: performance.now(),
                epoch: this._epoch,
                promise: null,
            };
            this.queue.push(item);

            this.queue.sort((a, b) => b.priority - a.priority);
        });
        item.promise = promise;

        this.compiling.set(hash, promise);

        if (!this.isProcessing) {
            this._processQueue();
        }

        return promise;
    }

    async _processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();

            try {
                const startTime = performance.now();
                const shader = await this._compileShader(item.descriptor, item.label);
                const compileTime = performance.now() - startTime;

                if (this._destroyed || item.epoch !== this._epoch) {
                    const error = new Error('Shader compilation completed for a stale device generation');
                    error.code = 'GPU_PIPELINE_GENERATION_STALE';
                    throw error;
                }

                this.compiled.set(item.hash, shader);
                if (this.compiling.get(item.hash) === item.promise) {
                    this.compiling.delete(item.hash);
                }

                this.stats.totalCompiled++;
                this.stats.totalCompileTime += compileTime;
                this.stats.avgCompileTime = this.stats.totalCompileTime / this.stats.totalCompiled;

                if (compileTime > 50) {
                    console.log(`[ShaderQueue] Compiled ${item.label}: ${compileTime.toFixed(1)}ms`);
                }

                item.resolve(shader);
            } catch (err) {
                console.error(`[ShaderQueue] Failed to compile ${item.label}:`, err);
                this.stats.totalFailed++;
                if (this.compiling.get(item.hash) === item.promise) {
                    this.compiling.delete(item.hash);
                }
                item.reject(err);
            }

            // Yield to main thread every 3 shaders
            if (this.stats.totalCompiled % 3 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        this.isProcessing = false;
    }

    async _compileShader(descriptor, label) {
        const modules = [
            descriptor.compute?.module,
            descriptor.vertex?.module,
            descriptor.fragment?.module,
        ].filter(Boolean);
        await Promise.all(modules.map(module => assertCheckedShaderModule(module, { label })));
        if (descriptor.type === 'compute') {
            return await this.device.createComputePipelineAsync({
                ...descriptor,
                label: label || 'ComputePipeline',
            });
        } else if (descriptor.type === 'render') {
            return await this.device.createRenderPipelineAsync({
                ...descriptor,
                label: label || 'RenderPipeline',
            });
        } else {
            throw new Error('Unknown shader type');
        }
    }

    _hashDescriptor(descriptor) {
        return this.identity.key(descriptor, descriptor?.type || 'pipeline');
    }

    /**
     * Precompile common shaders during idle time
     */
    async prewarmShaders(descriptors) {
        const promises = descriptors.map(({ descriptor, label, priority }) =>
            this.queueShader(descriptor, priority || 0, label)
        );
        return Promise.all(promises);
    }

    getStats() {
        return {
            ...this.stats,
            queued: this.queue.length,
            compiling: this.compiling.size,
            cached: this.compiled.size,
        };
    }

    clear(reason = 'Shader compilation queue cleared') {
        this._epoch += 1;
        const error = new Error(reason);
        error.code = 'GPU_SHADER_QUEUE_CLEARED';
        for (const item of this.queue) item.reject(error);
        this.queue = [];
        this.compiling.clear();
        this.compiled.clear();
        this.identity.clear();
    }

    destroy() {
        if (this._destroyed) return;
        this.clear('Shader compilation queue destroyed');
        this._destroyed = true;
        this.device = null;
    }
}
