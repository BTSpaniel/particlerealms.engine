// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { GPUTimestampProfiler } from './GPUTimestampProfiler.js';

class RollingAverage {
    constructor(sampleCount = 30) {
        this.sampleCount = sampleCount;
        this.samples = [];
        this.cursor = 0;
        this.total = 0;
    }

    add(value) {
        if (!Number.isFinite(value) || value < 0) return;
        this.total += value - (this.samples[this.cursor] || 0);
        this.samples[this.cursor] = value;
        this.cursor = (this.cursor + 1) % this.sampleCount;
    }

    value() {
        return this.samples.length ? this.total / this.samples.length : 0;
    }
}

/**
 * Backwards-compatible facade over the canonical GPUTimestampProfiler.
 *
 * New code should import GPUTimestampProfiler directly. This class preserves
 * the former init/addToPassDescriptor/readResults API without allocating a
 * second timestamp-query implementation.
 */
export class GPUProfiler {
    constructor(options = {}) {
        this.options = options;
        this.device = null;
        this.initialized = false;
        this.enabled = false;
        this.maxQueries = Number.isFinite(options.maxQueries) ? options.maxQueries : 32;
        this.passes = new Map();
        this.lastResults = new Map();
        this.readPending = false;
        this._service = null;
    }

    get querySet() {
        return this._service?.querySet || null;
    }

    get resolveBuffer() {
        return this._service?.resolveBuffer || null;
    }

    async init(device, _adapter, options = {}) {
        this.destroy();
        this.device = device;
        this._service = new GPUTimestampProfiler(device, {
            ...this.options,
            ...options,
            maxQueries: this.maxQueries,
        });
        this.initialized = true;
        this.enabled = this._service.isAvailable();
        return this.enabled;
    }

    registerPass(name) {
        const normalizedName = String(name);
        if (!this.passes.has(normalizedName)) {
            this.passes.set(normalizedName, new RollingAverage(30));
        }
        return normalizedName;
    }

    beginFrame(metadata = {}) {
        if (!this.isAvailable()) return null;
        return this._service.beginFrame(metadata);
    }

    getTimestampWrites(name) {
        if (!this.isAvailable()) return undefined;
        this.registerPass(name);
        return this._service.getTimestampWrites(name);
    }

    addToPassDescriptor(name, descriptor) {
        if (!descriptor) return descriptor;
        const timestampWrites = this.getTimestampWrites(name);
        return timestampWrites ? { ...descriptor, timestampWrites } : descriptor;
    }

    resolve(encoder, metadata = {}) {
        if (!this.isAvailable()) return false;
        return this._service.resolveAndRead(encoder, metadata);
    }

    markSubmitted(queue = this.device?.queue, metadata = {}) {
        return this._service?.markSubmitted(queue, metadata) || Promise.resolve(null);
    }

    readResults() {
        if (!this.isAvailable() || this.readPending) return Promise.resolve(this.getStats());
        this.readPending = true;
        return this._service.getDetailedResults()
            .then(result => {
                for (const pass of result.passes) {
                    const average = this.passes.get(this.registerPass(pass.passName));
                    average.add(pass.durationMs);
                    this.lastResults.set(pass.passName, average.value());
                }
                return this.getStats();
            })
            .catch(() => this.getStats())
            .finally(() => {
                this.readPending = false;
            });
    }

    getResults() {
        return this.readResults();
    }

    getStats() {
        const stats = Object.fromEntries(this.lastResults);
        stats.total = Array.from(this.lastResults.values()).reduce((sum, value) => sum + value, 0);
        stats.telemetry = this._service?.getStats() || {
            enabled: false,
            generation: null,
        };
        return stats;
    }

    getStatsString() {
        const parts = Array.from(this.lastResults, ([name, value]) => `${name}: ${value.toFixed(2)}ms`);
        const total = Array.from(this.lastResults.values()).reduce((sum, value) => sum + value, 0);
        parts.push(`total: ${total.toFixed(2)}ms`);
        return parts.join(' | ');
    }

    async copyDiagnostics() {
        const report = JSON.stringify({
            timestamp: new Date().toISOString(),
            profiler: this.getStats(),
        }, null, 2);
        try {
            await navigator.clipboard.writeText(report);
            return true;
        } catch (_) {
            console.info('[GPUProfiler] Diagnostics', report);
            return false;
        }
    }

    isAvailable() {
        return this.enabled && !!this._service?.isAvailable();
    }

    loadConfig(config) {
        if (!config) return;
        this.enabled = config.enabled === true && !!this._service?.isAvailable();
    }

    destroy() {
        this._service?.destroy();
        this._service = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;
        this.readPending = false;
        this.passes.clear();
        this.lastResults.clear();
    }
}

export default GPUProfiler;
