// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { statsMean } from '../math/MathStatistics.js';

/**
 * PerformanceOptimizer.js - GPU Performance Tuning and Optimization
 * 
 * Provides tools for optimizing WebGPU compute workloads:
 * - Workgroup size tuning (optimal occupancy)
 * - Double/triple buffering management
 * - Memory allocation strategies
 * - Pipeline state caching
 * - Frame budget monitoring
 * 
 * Integrates with GPUProfiler.js for performance measurement.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Common workgroup sizes */
export const WorkgroupSizes = {
    SMALL: 64,      // Good for register-heavy kernels
    MEDIUM: 128,    // Balanced
    LARGE: 256,     // Good for memory-bound kernels
    MAX: 512,       // Maximum common support
};

/** Buffer strategies */
export const BufferStrategy = {
    SINGLE: 1,          // Single buffer (simplest)
    DOUBLE: 2,          // Double buffer (ping-pong)
    TRIPLE: 3,          // Triple buffer (max throughput)
};

/** Memory allocation tiers */
export const MemoryTier = {
    STREAMING: 'streaming',   // Updated every frame
    DYNAMIC: 'dynamic',       // Updated occasionally
    STATIC: 'static',         // Rarely changes
};

/** Frame budget targets */
export const FrameBudget = {
    TARGET_60FPS: 16.67,
    TARGET_30FPS: 33.33,
    TARGET_UNLIMITED: Infinity,
};

// ============================================================================
// WORKGROUP TUNER
// ============================================================================

export class WorkgroupTuner {
    /**
     * @param {GPUDevice} device 
     */
    constructor(device) {
        this.device = device;
        
        // Device limits
        this.limits = {
            maxWorkgroupSize: device.limits.maxComputeWorkgroupSizeX,
            maxWorkgroupsX: device.limits.maxComputeWorkgroupsPerDimension,
            maxInvocations: device.limits.maxComputeInvocationsPerWorkgroup,
        };
        
        // Cached optimal sizes per kernel type
        this.optimalSizes = new Map();
        
        // Benchmark results
        this.benchmarks = new Map();
    }
    
    /**
     * Get optimal workgroup size for a kernel type
     * @param {string} kernelType - e.g., 'particle_update', 'grid_scatter'
     * @param {Object} characteristics - { registersPerThread, sharedMemory, memoryBound }
     * @returns {number}
     */
    getOptimalSize(kernelType, characteristics = {}) {
        // Check cache
        if (this.optimalSizes.has(kernelType)) {
            return this.optimalSizes.get(kernelType);
        }
        
        // Heuristic selection
        let size;
        
        if (characteristics.registersPerThread > 32) {
            // High register pressure → smaller workgroups
            size = WorkgroupSizes.SMALL;
        } else if (characteristics.sharedMemory > 16384) {
            // High shared memory → smaller workgroups
            size = WorkgroupSizes.MEDIUM;
        } else if (characteristics.memoryBound) {
            // Memory-bound → larger workgroups for latency hiding
            size = WorkgroupSizes.LARGE;
        } else {
            // Default balanced
            size = WorkgroupSizes.MEDIUM;
        }
        
        // Clamp to device limits
        size = Math.min(size, this.limits.maxWorkgroupSize);
        
        this.optimalSizes.set(kernelType, size);
        return size;
    }
    
    /**
     * Calculate dispatch dimensions
     * @param {number} totalElements 
     * @param {number} workgroupSize 
     * @returns {{ x: number, y: number, z: number }}
     */
    calculateDispatch(totalElements, workgroupSize) {
        const workgroups = Math.ceil(totalElements / workgroupSize);
        
        if (workgroups <= this.limits.maxWorkgroupsX) {
            return { x: workgroups, y: 1, z: 1 };
        }
        
        // Split into 2D dispatch
        const sqrtWg = Math.ceil(Math.sqrt(workgroups));
        const x = Math.min(sqrtWg, this.limits.maxWorkgroupsX);
        const y = Math.ceil(workgroups / x);
        
        return { x, y, z: 1 };
    }
    
    /**
     * Benchmark different workgroup sizes
     * @param {string} kernelType 
     * @param {Function} createPipeline - (workgroupSize) => GPUComputePipeline
     * @param {Function} runKernel - (pipeline, encoder) => void
     * @returns {Promise<number>} Best workgroup size
     */
    async benchmark(kernelType, createPipeline, runKernel) {
        const sizesToTest = [64, 128, 256];
        const results = [];
        
        for (const size of sizesToTest) {
            if (size > this.limits.maxWorkgroupSize) continue;
            
            const pipeline = createPipeline(size);
            const times = [];
            
            // Warmup
            for (let i = 0; i < 3; i++) {
                const encoder = this.device.createCommandEncoder();
                runKernel(pipeline, encoder);
                this.device.queue.submit([encoder.finish()]);
            }
            await this.device.queue.onSubmittedWorkDone();
            
            // Measure
            for (let i = 0; i < 10; i++) {
                const start = performance.now();
                const encoder = this.device.createCommandEncoder();
                runKernel(pipeline, encoder);
                this.device.queue.submit([encoder.finish()]);
                await this.device.queue.onSubmittedWorkDone();
                times.push(performance.now() - start);
            }
            
            const avgTime = statsMean(times);
            results.push({ size, time: avgTime });
        }
        
        // Find best
        results.sort((a, b) => a.time - b.time);
        const best = results[0].size;
        
        this.optimalSizes.set(kernelType, best);
        this.benchmarks.set(kernelType, results);
        
        return best;
    }
}

// ============================================================================
// PING-PONG BUFFER MANAGER
// ============================================================================

export class PingPongBuffer {
    /**
     * @param {GPUDevice} device 
     * @param {Object} options 
     */
    constructor(device, options) {
        this.device = device;
        this.label = options.label ?? 'PingPong';
        this.size = options.size;
        this.usage = options.usage;
        this.strategy = options.strategy ?? BufferStrategy.DOUBLE;
        
        this.buffers = [];
        this.currentIndex = 0;
        
        this._createBuffers();
    }
    
    _createBuffers() {
        for (let i = 0; i < this.strategy; i++) {
            this.buffers.push(this.device.createBuffer({
                label: `${this.label} [${i}]`,
                size: this.size,
                usage: this.usage,
            }));
        }
    }
    
    /** Get current read buffer */
    getReadBuffer() {
        return this.buffers[this.currentIndex];
    }
    
    /** Get current write buffer */
    getWriteBuffer() {
        return this.buffers[(this.currentIndex + 1) % this.strategy];
    }
    
    /** Swap buffers (call after write is complete) */
    swap() {
        this.currentIndex = (this.currentIndex + 1) % this.strategy;
    }
    
    /** Get buffer by index */
    getBuffer(index) {
        return this.buffers[index % this.strategy];
    }
    
    /** Get all buffers */
    getAllBuffers() {
        return [...this.buffers];
    }
    
    destroy() {
        for (const buffer of this.buffers) {
            buffer.destroy();
        }
        this.buffers = [];
    }
}

// ============================================================================
// FRAME BUDGET MANAGER
// ============================================================================

export class FrameBudgetManager {
    constructor(options = {}) {
        this.targetFrameTime = options.targetFrameTime ?? FrameBudget.TARGET_60FPS;
        
        // Budget allocation (ms)
        this.budgets = {
            physics: options.physicsBudget ?? 4,
            meshing: options.meshingBudget ?? 3,
            rendering: options.renderingBudget ?? 6,
            other: options.otherBudget ?? 3,
        };
        
        // Tracking
        this.frameTimes = [];
        this.maxSamples = 60;
        
        // Current frame
        this.currentFrame = {
            startTime: 0,
            phases: new Map(),
        };
        
        // Adaptive quality
        this.qualityLevel = 1.0;
        this.adaptiveEnabled = options.adaptive ?? true;
    }
    
    /** Start frame timing */
    startFrame() {
        this.currentFrame.startTime = performance.now();
        this.currentFrame.phases.clear();
    }
    
    /** Start a phase */
    startPhase(name) {
        this.currentFrame.phases.set(name, {
            start: performance.now(),
            end: 0,
            duration: 0,
        });
    }
    
    /** End a phase */
    endPhase(name) {
        const phase = this.currentFrame.phases.get(name);
        if (phase) {
            phase.end = performance.now();
            phase.duration = phase.end - phase.start;
        }
    }
    
    /** End frame and analyze */
    endFrame() {
        const frameTime = performance.now() - this.currentFrame.startTime;
        
        this.frameTimes.push(frameTime);
        if (this.frameTimes.length > this.maxSamples) {
            this.frameTimes.shift();
        }
        
        // Adaptive quality adjustment
        if (this.adaptiveEnabled) {
            this._adjustQuality(frameTime);
        }
        
        return {
            frameTime,
            phases: Object.fromEntries(this.currentFrame.phases),
            overBudget: frameTime > this.targetFrameTime,
            qualityLevel: this.qualityLevel,
        };
    }
    
    _adjustQuality(frameTime) {
        const avgFrameTime = statsMean(this.frameTimes);
        
        if (avgFrameTime > this.targetFrameTime * 1.1) {
            // Over budget - reduce quality
            this.qualityLevel = Math.max(0.5, this.qualityLevel - 0.05);
        } else if (avgFrameTime < this.targetFrameTime * 0.8) {
            // Under budget - increase quality
            this.qualityLevel = Math.min(1.0, this.qualityLevel + 0.02);
        }
    }
    
    /** Check if phase is within budget */
    isWithinBudget(phase) {
        const phaseData = this.currentFrame.phases.get(phase);
        if (!phaseData) return true;
        
        const budget = this.budgets[phase] ?? this.budgets.other;
        return phaseData.duration <= budget;
    }
    
    /** Get recommended particle count based on budget */
    getRecommendedParticleCount(baseCount) {
        return Math.floor(baseCount * this.qualityLevel);
    }
    
    /** Get stats */
    getStats() {
        const avgFrameTime = statsMean(this.frameTimes);
        
        return {
            avgFrameTime,
            fps: avgFrameTime > 0 ? 1000 / avgFrameTime : 0,
            qualityLevel: this.qualityLevel,
            overBudgetFrames: this.frameTimes.filter(t => t > this.targetFrameTime).length,
        };
    }
}

// ============================================================================
// MEMORY POOL
// ============================================================================

export class BufferPool {
    /**
     * @param {GPUDevice} device 
     * @param {Object} options 
     */
    constructor(device, options = {}) {
        this.device = device;
        this.defaultUsage = options.usage ?? 
            (GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        
        // Pools by size class (power of 2)
        this.pools = new Map();
        
        // Allocation tracking
        this.allocations = new Map();
        this.totalAllocated = 0;
        this.totalUsed = 0;
    }
    
    /**
     * Allocate a buffer from pool
     * @param {number} size 
     * @param {number} usage 
     * @returns {GPUBuffer}
     */
    allocate(size, usage = this.defaultUsage) {
        // Round up to power of 2
        const sizeClass = this._getSizeClass(size);
        
        // Check pool for available buffer
        const pool = this.pools.get(sizeClass);
        if (pool && pool.length > 0) {
            const buffer = pool.pop();
            this.allocations.set(buffer, { sizeClass, usage });
            this.totalUsed += sizeClass;
            return buffer;
        }
        
        // Create new buffer
        const buffer = this.device.createBuffer({
            label: `Pooled Buffer [${sizeClass}]`,
            size: sizeClass,
            usage,
        });
        
        this.allocations.set(buffer, { sizeClass, usage });
        this.totalAllocated += sizeClass;
        this.totalUsed += sizeClass;
        
        return buffer;
    }
    
    /**
     * Return buffer to pool
     * @param {GPUBuffer} buffer 
     */
    free(buffer) {
        const info = this.allocations.get(buffer);
        if (!info) return;
        
        this.allocations.delete(buffer);
        this.totalUsed -= info.sizeClass;
        
        // Add to pool
        if (!this.pools.has(info.sizeClass)) {
            this.pools.set(info.sizeClass, []);
        }
        this.pools.get(info.sizeClass).push(buffer);
    }
    
    _getSizeClass(size) {
        // Round up to next power of 2, minimum 256 bytes
        let sizeClass = 256;
        while (sizeClass < size) {
            sizeClass *= 2;
        }
        return sizeClass;
    }
    
    /** Get memory stats */
    getStats() {
        let pooledCount = 0;
        let pooledSize = 0;
        
        for (const [size, pool] of this.pools) {
            pooledCount += pool.length;
            pooledSize += size * pool.length;
        }
        
        return {
            totalAllocated: this.totalAllocated,
            totalUsed: this.totalUsed,
            pooledCount,
            pooledSize,
            efficiency: this.totalAllocated > 0 
                ? this.totalUsed / this.totalAllocated 
                : 1,
        };
    }
    
    /** Destroy all pooled buffers */
    destroy() {
        for (const pool of this.pools.values()) {
            for (const buffer of pool) {
                buffer.destroy();
            }
        }
        this.pools.clear();
        this.allocations.clear();
        this.totalAllocated = 0;
        this.totalUsed = 0;
    }
}

// ============================================================================
// PERFORMANCE OPTIMIZER (Main Class)
// ============================================================================

export class PerformanceOptimizer {
    /**
     * @param {GPUDevice} device 
     * @param {Object} options 
     */
    constructor(device, options = {}) {
        this.device = device;
        
        // Sub-systems
        this.workgroupTuner = new WorkgroupTuner(device);
        this.frameBudget = new FrameBudgetManager(options);
        this.bufferPool = new BufferPool(device, options);
        
        // Pipeline cache
        this.pipelineCache = new Map();
        
        // Stats tracking
        this.stats = {
            pipelineCacheHits: 0,
            pipelineCacheMisses: 0,
        };
    }
    
    /**
     * Create or get cached pipeline
     * @param {string} key 
     * @param {Function} createFn 
     * @returns {GPUComputePipeline}
     */
    getPipeline(key, createFn) {
        if (this.pipelineCache.has(key)) {
            this.stats.pipelineCacheHits++;
            return this.pipelineCache.get(key);
        }
        
        this.stats.pipelineCacheMisses++;
        const pipeline = createFn();
        this.pipelineCache.set(key, pipeline);
        return pipeline;
    }
    
    /**
     * Create ping-pong buffer
     */
    createPingPongBuffer(options) {
        return new PingPongBuffer(this.device, options);
    }
    
    /**
     * Get optimal dispatch for kernel
     */
    getOptimalDispatch(kernelType, totalElements, characteristics = {}) {
        const workgroupSize = this.workgroupTuner.getOptimalSize(kernelType, characteristics);
        const dispatch = this.workgroupTuner.calculateDispatch(totalElements, workgroupSize);
        return { workgroupSize, dispatch };
    }
    
    /**
     * Start frame timing
     */
    startFrame() {
        this.frameBudget.startFrame();
    }
    
    /**
     * End frame and get stats
     */
    endFrame() {
        return this.frameBudget.endFrame();
    }
    
    /**
     * Get comprehensive stats
     */
    getStats() {
        return {
            frame: this.frameBudget.getStats(),
            memory: this.bufferPool.getStats(),
            pipeline: { ...this.stats },
            workgroups: {
                cached: this.workgroupTuner.optimalSizes.size,
            },
        };
    }
    
    /**
     * Cleanup
     */
    destroy() {
        this.bufferPool.destroy();
        this.pipelineCache.clear();
    }
}

export default PerformanceOptimizer;
