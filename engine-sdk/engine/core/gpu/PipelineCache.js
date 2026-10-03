// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Generation-scoped pipeline cache with collision-free descriptor identity. */

import { GpuDescriptorIdentity } from './GpuDescriptorIdentity.js';
import { assertCheckedShaderModule } from './GpuShaderDiagnostics.js';

export class PipelineCache {
    constructor(device, { generation = 0 } = {}) {
        this.device = device;
        this.cache = new Map();
        this.compiling = new Map();
        this._inflight = new Map();
        this.identity = new GpuDescriptorIdentity({ generation });
        this._epoch = 0;
        this._destroyed = false;
    }

    async init() {
        return !this._destroyed;
    }

    _pipelineKey(descriptor, kind) {
        return this.identity.key(descriptor, kind);
    }

    async getOrCreateComputePipeline(descriptor, label = '') {
        return this._getOrCreate('compute', descriptor, label);
    }

    async getOrCreateRenderPipeline(descriptor, label = '') {
        return this._getOrCreate('render', descriptor, label);
    }

    _getOrCreate(kind, descriptor, label) {
        if (this._destroyed || !this.device) {
            const error = new Error('PipelineCache is destroyed');
            error.code = 'GPU_PIPELINE_CACHE_DESTROYED';
            return Promise.reject(error);
        }
        const key = this._pipelineKey(descriptor, kind);
        if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
        if (this.compiling.has(key)) return this.compiling.get(key);

        const epoch = this._epoch;
        const token = this.identity.token(key);
        const device = this.device;
        const record = {
            key,
            epoch,
            settled: false,
            cancelled: false,
            resolve: null,
            reject: null,
            promise: null,
        };
        record.promise = new Promise((resolve, reject) => {
            record.resolve = resolve;
            record.reject = reject;
        });
        // Cancellation can happen during owner teardown even when the caller
        // intentionally does not retain the promise. Keep that rejection from
        // becoming a global unhandled-rejection while preserving await/then.
        record.promise.catch(() => {});

        const compilationOperation = (async () => {
            const startTime = performance.now();
            const modules = [
                descriptor.compute?.module,
                descriptor.vertex?.module,
                descriptor.fragment?.module,
            ].filter(Boolean);
            await Promise.all(modules.map(module => assertCheckedShaderModule(module, { label })));
            if (record.cancelled || this._destroyed || epoch !== this._epoch) {
                const error = new Error('Pipeline compilation was revoked before pipeline creation');
                error.code = this._destroyed
                    ? 'GPU_PIPELINE_CACHE_DESTROYED'
                    : 'GPU_PIPELINE_CACHE_CLEARED';
                throw error;
            }
            const method = kind === 'compute' ? 'createComputePipelineAsync' : 'createRenderPipelineAsync';
            const prefix = kind === 'compute' ? 'ComputePipeline' : 'RenderPipeline';
            const pipeline = await device[method]({
                ...descriptor,
                label: label || `${prefix}_${token}`,
            });
            const compileTime = performance.now() - startTime;
            if (compileTime > 10) {
                console.log(`[PipelineCache] Compiled ${label}: ${compileTime.toFixed(1)}ms`);
            }
            if (this._destroyed || epoch !== this._epoch) {
                const error = new Error('Pipeline compilation completed for a stale device generation');
                error.code = 'GPU_PIPELINE_GENERATION_STALE';
                throw error;
            }
            this.cache.set(key, pipeline);
            return pipeline;
        });
        compilationOperation().then(
            pipeline => this._settleCompilation(record, null, pipeline),
            error => this._settleCompilation(record, error),
        );
        this._inflight.set(key, record);
        this.compiling.set(key, record.promise);
        return record.promise;
    }

    _settleCompilation(record, error = null, pipeline = null) {
        if (this._inflight.get(record.key) === record) this._inflight.delete(record.key);
        if (this.compiling.get(record.key) === record.promise) this.compiling.delete(record.key);
        if (record.settled) return false;
        record.settled = true;
        if (error) record.reject(error);
        else record.resolve(pipeline);
        return true;
    }

    _revokeInflight(code, message) {
        for (const record of this._inflight.values()) {
            if (record.settled) continue;
            record.cancelled = true;
            record.settled = true;
            const error = new Error(message);
            error.code = code;
            record.reject(error);
        }
        this._inflight.clear();
        this.compiling.clear();
    }

    prewarmPipelines(descriptors) {
        const promises = [];
        for (const { type, descriptor, label } of descriptors) {
            if (type === 'compute') {
                promises.push(this.getOrCreateComputePipeline(descriptor, label));
            } else if (type === 'render') {
                promises.push(this.getOrCreateRenderPipeline(descriptor, label));
            }
        }
        return Promise.all(promises);
    }

    clear() {
        this._epoch += 1;
        this._revokeInflight(
            'GPU_PIPELINE_CACHE_CLEARED',
            'Pipeline compilation was revoked because the cache was cleared',
        );
        this.cache.clear();
        this.identity.clear();
    }

    getStats() {
        return {
            cached: this.cache.size,
            compiling: this.compiling.size,
        };
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._epoch += 1;
        this._revokeInflight(
            'GPU_PIPELINE_CACHE_DESTROYED',
            'Pipeline compilation was revoked because the cache was destroyed',
        );
        this.cache.clear();
        this.identity.clear();
        this.device = null;
    }
}
