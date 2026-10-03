// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CascadeMetrics.js - Performance Metrics for Cascaded Chunk System
 * 
 * Tracks and reports performance of all cascaded subsystems:
 * - Sub-chunk meshing (CPU vs GPU)
 * - Buffer pool efficiency
 * - Progressive loading throughput
 * - LOD distribution
 * - Memory usage
 * - Frame time breakdown
 * 
 * Features:
 * - Rolling averages with configurable window
 * - Min/max/avg/p95 statistics
 * - JSON export for external analysis
 * - Real-time overlay display
 */

import { statsMax, statsMin } from '../../core/math/MathStatistics.js';

// Metric categories
const CATEGORY = {
    MESHING: 'meshing',
    BUFFER: 'buffer',
    LOADING: 'loading',
    LOD: 'lod',
    MEMORY: 'memory',
    FRAME: 'frame',
};

// Default rolling window size
const DEFAULT_WINDOW_SIZE = 120; // 2 seconds at 60fps

/**
 * RollingStats - Maintains rolling statistics for a metric
 */
class RollingStats {
    constructor(windowSize = DEFAULT_WINDOW_SIZE) {
        this.windowSize = windowSize;
        this.values = [];
        this.sum = 0;
        this.min = Infinity;
        this.max = -Infinity;
        this.lastValue = 0;
    }
    
    push(value) {
        this.values.push(value);
        this.sum += value;
        this.lastValue = value;
        
        if (value < this.min) this.min = value;
        if (value > this.max) this.max = value;
        
        // Trim to window size
        while (this.values.length > this.windowSize) {
            const evicted = this.values.shift();
            this.sum -= evicted;
            if (evicted === this.min || evicted === this.max) {
                this.min = this.values.length === 0 ? Infinity : statsMin(this.values);
                this.max = this.values.length === 0 ? -Infinity : statsMax(this.values);
            }
        }
    }
    
    get avg() {
        return this.values.length > 0 ? this.sum / this.values.length : 0;
    }
    
    get count() {
        return this.values.length;
    }
    
    get p95() {
        if (this.values.length < 20) return this.max;
        const sorted = [...this.values].sort((a, b) => a - b);
        const idx = Math.floor(sorted.length * 0.95);
        return sorted[idx];
    }
    
    reset() {
        this.values = [];
        this.sum = 0;
        this.min = Infinity;
        this.max = -Infinity;
        this.lastValue = 0;
    }
    
    toJSON() {
        return {
            count: this.count,
            last: this.lastValue.toFixed(3),
            avg: this.avg.toFixed(3),
            min: this.min === Infinity ? 0 : this.min.toFixed(3),
            max: this.max === -Infinity ? 0 : this.max.toFixed(3),
            p95: this.p95.toFixed(3),
        };
    }
}

/**
 * Counter - Simple incrementing counter with rate calculation
 */
class Counter {
    constructor(windowSize = DEFAULT_WINDOW_SIZE) {
        this.total = 0;
        this.windowSize = windowSize;
        this.timestamps = [];
    }
    
    increment(amount = 1) {
        this.total += amount;
        this.timestamps.push(performance.now());
        
        // Trim old timestamps
        const cutoff = performance.now() - (this.windowSize * 16.67); // Assume 60fps
        while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
            this.timestamps.shift();
        }
    }
    
    get rate() {
        if (this.timestamps.length < 2) return 0;
        const elapsed = (this.timestamps[this.timestamps.length - 1] - this.timestamps[0]) / 1000;
        return elapsed > 0 ? (this.timestamps.length - 1) / elapsed : 0;
    }
    
    reset() {
        this.total = 0;
        this.timestamps = [];
    }
    
    toJSON() {
        return {
            total: this.total,
            rate: this.rate.toFixed(1) + '/s',
        };
    }
}

/**
 * CascadeMetrics - Central metrics collection for cascaded chunk system
 */
export class CascadeMetrics {
    constructor(windowSize = DEFAULT_WINDOW_SIZE) {
        this.windowSize = windowSize;
        this.startTime = performance.now();
        
        // === MESHING METRICS ===
        this.meshing = {
            cpu4: new RollingStats(windowSize),      // 4³ CPU mesh time
            cpu8: new RollingStats(windowSize),      // 8³ CPU mesh time
            cpu16: new RollingStats(windowSize),     // 16³ CPU mesh time
            cpu32: new RollingStats(windowSize),     // 32³ CPU mesh time
            gpu4: new RollingStats(windowSize),      // 4³ GPU mesh time
            gpu8: new RollingStats(windowSize),      // 8³ GPU mesh time
            totalCpu: new Counter(windowSize),       // Total CPU meshes
            totalGpu: new Counter(windowSize),       // Total GPU meshes
            facesGenerated: new Counter(windowSize), // Faces generated
        };
        
        // === BUFFER POOL METRICS ===
        this.buffer = {
            allocations: new Counter(windowSize),
            reuses: new Counter(windowSize),
            returns: new Counter(windowSize),
            hitRate: new RollingStats(windowSize),
            pooledMB: new RollingStats(windowSize),
            bucketUsage: [0, 0, 0, 0, 0], // TINY, SMALL, MEDIUM, LARGE, XLARGE
        };
        
        // === PROGRESSIVE LOADING METRICS ===
        this.loading = {
            refinements: new Counter(windowSize),
            downgrades: new Counter(windowSize),
            queueDepth: new RollingStats(windowSize),
            refinementTime: new RollingStats(windowSize),
        };
        
        // === LOD METRICS ===
        this.lod = {
            levelCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // LOD 0-9
            subMeshCounts: [0, 0, 0, 0], // 4³, 8³, 16³, 32³
            drawCalls: new Counter(windowSize),
            triangles: new Counter(windowSize),
        };
        
        // === MEMORY METRICS ===
        this.memory = {
            vertexBufferMB: 0,
            indexBufferMB: 0,
            pooledBufferMB: 0,
            chunkCount: 0,
            subMeshCount: 0,
        };
        
        // === FRAME TIMING METRICS ===
        this.frame = {
            total: new RollingStats(windowSize),
            meshing: new RollingStats(windowSize),
            culling: new RollingStats(windowSize),
            rendering: new RollingStats(windowSize),
            loading: new RollingStats(windowSize),
            fps: new RollingStats(windowSize),
        };
        
        // Frame timing state
        this._frameStart = 0;
        this._sectionStart = 0;
        this._lastFrameTime = 0;
    }
    
    // === MESHING TRACKING ===
    
    recordCpuMesh(size, timeMs, faceCount) {
        const key = `cpu${size}`;
        if (this.meshing[key]) {
            this.meshing[key].push(timeMs);
        }
        this.meshing.totalCpu.increment();
        this.meshing.facesGenerated.increment(faceCount);
    }
    
    recordGpuMesh(size, timeMs, faceCount) {
        const key = `gpu${size}`;
        if (this.meshing[key]) {
            this.meshing[key].push(timeMs);
        }
        this.meshing.totalGpu.increment();
        this.meshing.facesGenerated.increment(faceCount);
    }
    
    // === BUFFER POOL TRACKING ===
    
    recordBufferAllocation() {
        this.buffer.allocations.increment();
    }
    
    recordBufferReuse() {
        this.buffer.reuses.increment();
    }
    
    recordBufferReturn() {
        this.buffer.returns.increment();
    }
    
    updateBufferPoolStats(stats) {
        if (!stats) return;
        this.buffer.hitRate.push(stats.hitRate || 0);
        this.buffer.pooledMB.push(parseFloat(stats.pooledMB) || 0);
        if (stats.buckets) {
            stats.buckets.forEach((bucket, i) => {
                this.buffer.bucketUsage[i] = bucket.pooled || 0;
            });
        }
    }
    
    // === PROGRESSIVE LOADING TRACKING ===
    
    recordRefinement(timeMs) {
        this.loading.refinements.increment();
        this.loading.refinementTime.push(timeMs);
    }
    
    recordDowngrade() {
        this.loading.downgrades.increment();
    }
    
    updateLoadingStats(stats) {
        if (!stats) return;
        this.loading.queueDepth.push(stats.refinementsQueued || 0);
    }
    
    // === LOD TRACKING ===
    
    updateLodDistribution(levelCounts) {
        if (Array.isArray(levelCounts)) {
            for (let i = 0; i < Math.min(levelCounts.length, 10); i++) {
                this.lod.levelCounts[i] = levelCounts[i];
            }
        }
    }
    
    updateSubMeshCounts(counts) {
        if (Array.isArray(counts)) {
            for (let i = 0; i < Math.min(counts.length, 4); i++) {
                this.lod.subMeshCounts[i] = counts[i];
            }
        }
    }
    
    recordDrawCall(triangleCount) {
        this.lod.drawCalls.increment();
        this.lod.triangles.increment(triangleCount);
    }
    
    // === MEMORY TRACKING ===
    
    updateMemoryStats({ vertexMB, indexMB, pooledMB, chunkCount, subMeshCount }) {
        if (vertexMB !== undefined) this.memory.vertexBufferMB = vertexMB;
        if (indexMB !== undefined) this.memory.indexBufferMB = indexMB;
        if (pooledMB !== undefined) this.memory.pooledBufferMB = pooledMB;
        if (chunkCount !== undefined) this.memory.chunkCount = chunkCount;
        if (subMeshCount !== undefined) this.memory.subMeshCount = subMeshCount;
    }
    
    // === FRAME TIMING ===
    
    beginFrame() {
        this._frameStart = performance.now();
    }
    
    beginSection(section) {
        this._sectionStart = performance.now();
    }
    
    endSection(section) {
        const elapsed = performance.now() - this._sectionStart;
        if (this.frame[section]) {
            this.frame[section].push(elapsed);
        }
    }
    
    endFrame() {
        const elapsed = performance.now() - this._frameStart;
        this.frame.total.push(elapsed);
        
        // Calculate FPS
        const now = performance.now();
        if (this._lastFrameTime > 0) {
            const frameDelta = now - this._lastFrameTime;
            const fps = 1000 / frameDelta;
            this.frame.fps.push(fps);
        }
        this._lastFrameTime = now;
    }
    
    // === REPORTING ===
    
    /**
     * Get summary statistics
     */
    getSummary() {
        const uptime = (performance.now() - this.startTime) / 1000;
        
        return {
            uptime: uptime.toFixed(1) + 's',
            fps: {
                current: this.frame.fps.lastValue.toFixed(1),
                avg: this.frame.fps.avg.toFixed(1),
                min: this.frame.fps.min === Infinity ? 0 : this.frame.fps.min.toFixed(1),
            },
            meshing: {
                cpuRate: this.meshing.totalCpu.rate.toFixed(1) + '/s',
                gpuRate: this.meshing.totalGpu.rate.toFixed(1) + '/s',
                avgCpu32: this.meshing.cpu32.avg.toFixed(2) + 'ms',
                avgGpu8: this.meshing.gpu8.avg.toFixed(2) + 'ms',
            },
            bufferPool: {
                hitRate: this.buffer.hitRate.avg.toFixed(1) + '%',
                pooledMB: this.buffer.pooledMB.lastValue.toFixed(2),
            },
            memory: {
                totalMB: (this.memory.vertexBufferMB + this.memory.indexBufferMB).toFixed(2),
                chunks: this.memory.chunkCount,
                subMeshes: this.memory.subMeshCount,
            },
        };
    }
    
    /**
     * Get full metrics as JSON
     */
    toJSON() {
        return {
            meshing: {
                cpu4: this.meshing.cpu4.toJSON(),
                cpu8: this.meshing.cpu8.toJSON(),
                cpu16: this.meshing.cpu16.toJSON(),
                cpu32: this.meshing.cpu32.toJSON(),
                gpu4: this.meshing.gpu4.toJSON(),
                gpu8: this.meshing.gpu8.toJSON(),
                totalCpu: this.meshing.totalCpu.toJSON(),
                totalGpu: this.meshing.totalGpu.toJSON(),
            },
            buffer: {
                allocations: this.buffer.allocations.toJSON(),
                reuses: this.buffer.reuses.toJSON(),
                hitRate: this.buffer.hitRate.toJSON(),
                bucketUsage: this.buffer.bucketUsage,
            },
            loading: {
                refinements: this.loading.refinements.toJSON(),
                downgrades: this.loading.downgrades.toJSON(),
                queueDepth: this.loading.queueDepth.toJSON(),
                refinementTime: this.loading.refinementTime.toJSON(),
            },
            lod: {
                levelCounts: this.lod.levelCounts,
                subMeshCounts: this.lod.subMeshCounts,
                drawCalls: this.lod.drawCalls.toJSON(),
                triangles: this.lod.triangles.toJSON(),
            },
            memory: this.memory,
            frame: {
                total: this.frame.total.toJSON(),
                fps: this.frame.fps.toJSON(),
            },
        };
    }
    
    /**
     * Get compact display string
     */
    getDisplayString() {
        const fps = this.frame.fps.avg.toFixed(0);
        const meshRate = (this.meshing.totalCpu.rate + this.meshing.totalGpu.rate).toFixed(0);
        const hitRate = this.buffer.hitRate.avg.toFixed(0);
        const poolMB = this.buffer.pooledMB.lastValue.toFixed(1);
        
        return `FPS: ${fps} | Mesh: ${meshRate}/s | Pool: ${hitRate}% (${poolMB}MB)`;
    }
    
    /**
     * Reset all metrics
     */
    reset() {
        // Reset meshing
        Object.values(this.meshing).forEach(m => m.reset && m.reset());
        
        // Reset buffer
        Object.values(this.buffer).forEach(m => m.reset && m.reset());
        this.buffer.bucketUsage = [0, 0, 0, 0, 0];
        
        // Reset loading
        Object.values(this.loading).forEach(m => m.reset && m.reset());
        
        // Reset LOD
        this.lod.levelCounts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        this.lod.subMeshCounts = [0, 0, 0, 0];
        this.lod.drawCalls.reset();
        this.lod.triangles.reset();
        
        // Reset memory
        this.memory = {
            vertexBufferMB: 0,
            indexBufferMB: 0,
            pooledBufferMB: 0,
            chunkCount: 0,
            subMeshCount: 0,
        };
        
        // Reset frame
        Object.values(this.frame).forEach(m => m.reset && m.reset());
        
        this.startTime = performance.now();
    }
}

// Singleton instance
let globalMetrics = null;

/**
 * Get global metrics instance
 */
export function getMetrics() {
    if (!globalMetrics) {
        globalMetrics = new CascadeMetrics();
    }
    return globalMetrics;
}

/**
 * Reset global metrics
 */
export function resetMetrics() {
    if (globalMetrics) {
        globalMetrics.reset();
    }
}

export { CATEGORY, RollingStats, Counter };
export default CascadeMetrics;
