// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ResourceManager.js - Unified High-Performance Resource Management
 * 
 * Central facade integrating:
 * - Host Memory (RAM): Slab Allocators, Object Pools, SoA Containers
 * - Device Memory (GPU): Ring Buffers, Buddy Allocators, Texture Management
 * - Task Scheduling: Job System, Worker Pools, Frame Budgeting
 * 
 * Based on architectural specification for zero-allocation, high-throughput
 * WebGPU applications targeting 60+ FPS.
 */

import { 
    hostMemory, 
    createCommonPools,
    SlabAllocator,
    ObjectPool,
    SoAContainer,
} from './memory/HostMemoryManager.js';

import { 
    GPUMemoryManager,
    getGPUMemoryManager,
} from './memory/GPUMemoryManager.js';

import { 
    scheduler,
    JobPriority,
    workerTemplate,
} from './scheduler/TaskScheduler.js';
import { statsMean } from './math/MathStatistics.js';
import { runtimeFrameDeltaSeconds } from './math/FrameMath.js';

// ============================================================================
// RESOURCE MANAGER
// ============================================================================

/**
 * Unified resource management facade
 */
export class ResourceManager {
    constructor() {
        // Sub-managers
        this.host = hostMemory;
        this.gpu = null;
        this.scheduler = scheduler;
        
        // State
        this.initialized = false;
        this.device = null;
        
        // Frame state
        this.frameCount = 0;
        this.lastFrameTime = 0;
        this.deltaTime = 0;
        this.fps = 0;
        this.fpsSmoothed = 60;
        
        // Performance tracking
        this.frameTimes = new Float32Array(120); // 2 seconds of frames
        this.frameTimeIndex = 0;
        
        // Device loss handling
        this.onDeviceLost = null;
        this.onDeviceRestored = null;
        
        // Debug
        this.debugMode = false;
        this.profileNextFrame = false;
    }
    
    /**
     * Initialize the resource manager
     * @param {GPUDevice} device - WebGPU device
     * @param {Object} options - Configuration options
     */
    async init(device, options = {}) {
        this.device = device;
        
        const {
            // Host memory options
            frameSlabSize = 32 * 1024 * 1024,
            stagingSlabSize = 16 * 1024 * 1024,
            createPools = true,
            
            // GPU memory options
            uniformRingSize = 8 * 1024 * 1024,
            vertexRingSize = 16 * 1024 * 1024,
            geometryHeapSize = 64 * 1024 * 1024,
            textureBudget = 512 * 1024 * 1024,
            
            // Scheduler options
            workerScript = null,
            
            // Debug
            debug = false,
        } = options;
        
        this.debugMode = debug;
        
        // Initialize host memory
        this.host.createSlab('frame', frameSlabSize);
        this.host.createSlab('staging', stagingSlabSize);
        
        if (createPools) {
            createCommonPools(this.host);
        }
        
        // Initialize GPU memory
        this.gpu = getGPUMemoryManager(device);
        this.gpu.init({
            uniformRingSize,
            vertexRingSize,
            geometryHeapSize,
            textureBudget,
        });
        
        // Initialize scheduler
        if (workerScript) {
            await this.scheduler.init(workerScript);
        } else {
            await this.scheduler.init();
        }
        
        // Set up device loss handler
        device.lost.then(info => this._handleDeviceLost(info));
        
        this.initialized = true;
        console.log('[ResourceManager] Initialized');
        
        if (debug) {
            this.logReport();
        }
    }
    
    /**
     * Begin a new frame - call at START of render loop
     */
    beginFrame() {
        const now = performance.now();
        this.deltaTime = runtimeFrameDeltaSeconds(now, this.lastFrameTime, Infinity);
        this.lastFrameTime = now;
        this.frameCount++;
        
        // Track frame time for FPS
        this.frameTimes[this.frameTimeIndex] = this.deltaTime * 1000;
        this.frameTimeIndex = (this.frameTimeIndex + 1) % this.frameTimes.length;
        
        // Calculate FPS
        if (this.deltaTime > 0) {
            this.fps = 1 / this.deltaTime;
            this.fpsSmoothed = this.fpsSmoothed * 0.95 + this.fps * 0.05;
        }
        
        // Reset frame allocators
        this.host.beginFrame();
        this.gpu?.beginFrame();
        this.scheduler.beginFrame();
        
        if (this.profileNextFrame) {
            console.time('Frame');
            this.profileNextFrame = false;
        }
    }
    
    /**
     * Process scheduled jobs within frame budget
     * @returns {{ jobsRun: number, timeUsed: number, overrun: boolean }}
     */
    processJobs() {
        return this.scheduler.processJobs();
    }
    
    /**
     * Update all registered systems
     */
    updateSystems() {
        this.scheduler.updateSystems(this.deltaTime);
    }
    
    /**
     * End frame - call at END of render loop
     */
    endFrame() {
        this.host.endFrame();
        this.scheduler.endFrame();
    }
    
    // ========================================================================
    // HOST MEMORY SHORTCUTS
    // ========================================================================
    
    /**
     * Allocate float array from frame slab
     * @param {number} count
     * @returns {Float32Array}
     */
    allocFloat32(count) {
        return this.host.getSlab('frame').allocFloat32(count);
    }
    
    /**
     * Allocate a 4x4 matrix
     * @returns {Float32Array}
     */
    allocMatrix4() {
        return this.host.getSlab('frame').allocMatrix4();
    }
    
    /**
     * Allocate vec3 (padded to vec4)
     * @returns {Float32Array}
     */
    allocVec3() {
        return this.host.getSlab('frame').allocVec3();
    }
    
    /**
     * Allocate vec4
     * @returns {Float32Array}
     */
    allocVec4() {
        return this.host.getSlab('frame').allocVec4();
    }
    
    /**
     * Get object from pool
     * @param {string} poolName
     * @returns {Object}
     */
    poolAlloc(poolName) {
        const pool = this.host.getPool(poolName);
        return pool?.alloc();
    }
    
    /**
     * Return object to pool
     * @param {string} poolName
     * @param {Object} obj
     */
    poolFree(poolName, obj) {
        const pool = this.host.getPool(poolName);
        pool?.free(obj);
    }
    
    /**
     * Create or get an SoA container
     * @param {string} name
     * @param {Object} schema
     * @param {number} capacity
     * @returns {SoAContainer}
     */
    getOrCreateContainer(name, schema, capacity) {
        let container = this.host.getContainer(name);
        if (!container) {
            container = this.host.createContainer(name, schema, capacity);
        }
        return container;
    }
    
    // ========================================================================
    // GPU MEMORY SHORTCUTS
    // ========================================================================
    
    /**
     * Allocate and upload uniform data
     * @param {ArrayBuffer|TypedArray} data
     * @returns {{ buffer: GPUBuffer, offset: number, size: number }}
     */
    allocUniform(data) {
        return this.gpu.allocUniform(data);
    }
    
    /**
     * Allocate and upload dynamic vertex data
     * @param {ArrayBuffer|TypedArray} data
     * @returns {{ buffer: GPUBuffer, offset: number, size: number }}
     */
    allocVertexDynamic(data) {
        return this.gpu.allocVertexDynamic(data);
    }
    
    /**
     * Allocate static geometry (persistent)
     * @param {ArrayBuffer|TypedArray} data
     * @returns {{ buffer: GPUBuffer, offset: number, size: number }}
     */
    allocGeometry(data) {
        return this.gpu.allocGeometry(data);
    }
    
    /**
     * Free static geometry
     * @param {number} offset
     */
    freeGeometry(offset) {
        this.gpu.freeGeometry(offset);
    }
    
    /**
     * Get or create cached bind group
     * @param {GPUBindGroupLayout} layout
     * @param {GPUBindGroupEntry[]} entries
     * @param {string} label
     * @returns {GPUBindGroup}
     */
    getBindGroup(layout, entries, label) {
        return this.gpu.getBindGroup(layout, entries, label);
    }
    
    /**
     * Create or get texture
     * @param {string} id
     * @param {GPUTextureDescriptor} descriptor
     * @returns {{ texture: GPUTexture, view: GPUTextureView }}
     */
    createTexture(id, descriptor) {
        return this.gpu.textureManager.create(id, descriptor);
    }
    
    /**
     * Get texture by ID
     * @param {string} id
     * @returns {{ texture: GPUTexture, view: GPUTextureView } | null}
     */
    getTexture(id) {
        return this.gpu.textureManager.get(id);
    }
    
    // ========================================================================
    // SCHEDULER SHORTCUTS
    // ========================================================================
    
    /**
     * Submit job
     * @param {Function} callback
     * @param {number} priority
     * @param {Object} options
     * @returns {Job}
     */
    submitJob(callback, priority = JobPriority.NORMAL, options = {}) {
        return this.scheduler.submit(callback, priority, options);
    }
    
    /**
     * Submit critical job
     */
    submitCritical(callback, options = {}) {
        return this.scheduler.submitCritical(callback, options);
    }
    
    /**
     * Submit to worker pool
     */
    submitToWorker(taskType, data, transfer = []) {
        return this.scheduler.submitToWorker(taskType, data, transfer);
    }
    
    /**
     * Register system for ordered updates
     */
    registerSystem(name, system, order = 100) {
        this.scheduler.registerSystem(name, system, order);
    }
    
    /**
     * Get time remaining in frame budget
     */
    getTimeRemaining() {
        return this.scheduler.getTimeRemaining();
    }
    
    /**
     * Check if over frame budget
     */
    isOverBudget() {
        return this.scheduler.isOverBudget();
    }
    
    // ========================================================================
    // DEVICE LOSS HANDLING
    // ========================================================================
    
    /**
     * Handle GPU device loss
     */
    async _handleDeviceLost(info) {
        console.error('[ResourceManager] GPU device lost:', info.message);
        
        // Clear GPU caches
        this.gpu?.handleDeviceLoss();
        
        // Notify application
        if (this.onDeviceLost) {
            this.onDeviceLost(info);
        }
    }
    
    /**
     * Restore after device loss
     * @param {GPUDevice} newDevice
     */
    async restore(newDevice) {
        this.device = newDevice;
        
        // Reinitialize GPU memory manager
        this.gpu = getGPUMemoryManager(newDevice);
        this.gpu.init();
        
        // Set up new loss handler
        newDevice.lost.then(info => this._handleDeviceLost(info));
        
        // Notify application
        if (this.onDeviceRestored) {
            this.onDeviceRestored(newDevice);
        }
        
        console.log('[ResourceManager] Restored with new device');
    }
    
    // ========================================================================
    // STATISTICS & DEBUGGING
    // ========================================================================
    
    /**
     * Get current FPS
     */
    getFPS() {
        return this.fpsSmoothed;
    }
    
    /**
     * Get frame time statistics
     */
    getFrameTimeStats() {
        let sum = 0, min = Infinity, max = 0;
        const count = Math.min(this.frameCount, this.frameTimes.length);
        
        for (let i = 0; i < count; i++) {
            const t = this.frameTimes[i];
            sum += t;
            min = Math.min(min, t);
            max = Math.max(max, t);
        }
        
        return {
            avg: statsMean(this.frameTimes.subarray(0, count)),
            min: min === Infinity ? 0 : min,
            max,
            current: this.frameTimes[(this.frameTimeIndex - 1 + this.frameTimes.length) % this.frameTimes.length],
        };
    }
    
    /**
     * Get comprehensive statistics
     */
    getStats() {
        return {
            frameCount: this.frameCount,
            fps: this.fpsSmoothed.toFixed(1),
            deltaTime: this.deltaTime.toFixed(4),
            frameTimes: this.getFrameTimeStats(),
            host: this.host.getStats(),
            gpu: this.gpu?.getStats(),
            scheduler: this.scheduler.getStats(),
        };
    }
    
    /**
     * Log comprehensive report
     */
    logReport() {
        console.group('[ResourceManager] Status Report');
        console.log(`Frame: ${this.frameCount}, FPS: ${this.fpsSmoothed.toFixed(1)}`);
        
        this.host.logReport();
        this.gpu?.logReport();
        this.scheduler.logReport();
        
        console.groupEnd();
    }
    
    /**
     * Profile next frame
     */
    profileFrame() {
        this.profileNextFrame = true;
    }
    
    // ========================================================================
    // BENCHMARK SYSTEM
    // ========================================================================
    
    /**
     * Run comprehensive benchmark and return optimal settings
     * @param {Function} progressCallback - (phase, progress, message) => void
     * @returns {Promise<Object>} Benchmark results and recommendations
     */
    async runBenchmark(progressCallback = null) {
        const report = (phase, progress, msg) => {
            if (progressCallback) progressCallback(phase, progress, msg);
            console.log(`[Benchmark] ${phase}: ${msg}`);
        };
        
        const results = {
            device: {},
            memory: {},
            gpu: {},
            scheduler: {},
            recommendations: {},
            score: 0,
        };
        
        report('init', 0, 'Starting benchmark...');
        
        // Phase 1: Device Info
        report('device', 10, 'Collecting device info...');
        results.device = {
            cores: navigator.hardwareConcurrency || 4,
            memory: navigator.deviceMemory || 4, // GB (approximate)
            platform: navigator.platform,
            userAgent: navigator.userAgent,
            webgpu: !!this.device,
        };
        
        // Phase 2: Memory Allocation Test
        report('memory', 20, 'Testing memory allocation speed...');
        results.memory = await this._benchmarkMemory();
        
        // Phase 3: GPU Buffer Test
        report('gpu', 40, 'Testing GPU buffer operations...');
        results.gpu = await this._benchmarkGPU();
        
        // Phase 4: Scheduler Test
        report('scheduler', 60, 'Testing job scheduler throughput...');
        results.scheduler = await this._benchmarkScheduler();
        
        // Phase 5: Compute Score & Recommendations
        report('analysis', 80, 'Analyzing results...');
        results.score = this._computeScore(results);
        results.recommendations = this._generateRecommendations(results);
        
        report('complete', 100, `Benchmark complete! Score: ${results.score}`);
        
        return results;
    }
    
    /**
     * Benchmark memory allocation
     */
    async _benchmarkMemory() {
        const iterations = 1000;
        const results = { slabAlloc: 0, poolAlloc: 0, arrayCreate: 0 };
        
        // Test slab allocation (should be very fast)
        if (this.host) {
            const slab = this.host.getSlab('frame');
            const start = performance.now();
            for (let i = 0; i < iterations; i++) {
                slab.allocFloat32(16); // 4x4 matrix
            }
            results.slabAlloc = (performance.now() - start) / iterations;
            slab.reset();
        }
        
        // Test pool allocation
        const pool = this.host?.getPool('mat4');
        if (pool) {
            const objects = [];
            const start = performance.now();
            for (let i = 0; i < Math.min(iterations, 500); i++) {
                objects.push(pool.alloc());
            }
            results.poolAlloc = (performance.now() - start) / objects.length;
            // Return objects
            for (const obj of objects) {
                pool.free(obj);
            }
        }
        
        // Test native array creation (baseline)
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            new Float32Array(16);
        }
        results.arrayCreate = (performance.now() - start) / iterations;
        
        // Calculate speedup
        results.slabSpeedup = results.arrayCreate / Math.max(0.001, results.slabAlloc);
        
        return results;
    }
    
    /**
     * Benchmark GPU operations
     */
    async _benchmarkGPU() {
        const results = { 
            bufferWrite: 0, 
            uniformAlloc: 0,
            supported: false,
            limits: {}
        };
        
        if (!this.gpu || !this.device) {
            return results;
        }
        
        results.supported = true;
        results.limits = {
            maxBufferSize: this.device.limits.maxBufferSize,
            maxStorageBufferBindingSize: this.device.limits.maxStorageBufferBindingSize,
            maxComputeWorkgroupsPerDimension: this.device.limits.maxComputeWorkgroupsPerDimension,
        };
        
        // Test uniform ring buffer allocation
        const iterations = 500;
        const testData = new Float32Array(64); // 256 bytes
        
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            this.gpu.uniformRing?.write(testData, 256);
        }
        results.uniformAlloc = (performance.now() - start) / iterations;
        
        // Reset ring buffer
        this.gpu.uniformRing?.beginFrame();
        
        return results;
    }
    
    /**
     * Benchmark scheduler throughput
     */
    async _benchmarkScheduler() {
        const results = { 
            jobsPerMs: 0,
            syncJobTime: 0,
            queueOverhead: 0,
        };
        
        // Test synchronous job execution
        const iterations = 1000;
        let counter = 0;
        
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            this.scheduler.submit(() => { counter++; }, 0); // CRITICAL priority
        }
        this.scheduler.processJobs();
        const elapsed = performance.now() - start;
        
        results.jobsPerMs = iterations / elapsed;
        results.syncJobTime = elapsed / iterations;
        results.jobsExecuted = counter;
        
        return results;
    }
    
    /**
     * Compute overall performance score (0-100)
     */
    _computeScore(results) {
        let score = 50; // Base score
        
        // Memory score (up to +20)
        if (results.memory.slabSpeedup > 10) score += 20;
        else if (results.memory.slabSpeedup > 5) score += 15;
        else if (results.memory.slabSpeedup > 2) score += 10;
        else score += 5;
        
        // GPU score (up to +20)
        if (results.gpu.supported) {
            score += 10;
            if (results.gpu.uniformAlloc < 0.05) score += 10;
            else if (results.gpu.uniformAlloc < 0.1) score += 5;
        }
        
        // Scheduler score (up to +10)
        if (results.scheduler.jobsPerMs > 50) score += 10;
        else if (results.scheduler.jobsPerMs > 20) score += 5;
        
        // Device score (up to +10)
        if (results.device.cores >= 8) score += 5;
        if (results.device.memory >= 8) score += 5;
        
        return Math.min(100, Math.max(0, Math.round(score)));
    }
    
    /**
     * Generate optimal settings recommendations
     */
    _generateRecommendations(results) {
        const rec = {
            quality: 'medium',
            frameSlabSizeMB: 32,
            uniformRingSizeMB: 8,
            vertexRingSizeMB: 16,
            geometryHeapSizeMB: 64,
            textureBudgetMB: 512,
            maxParticles: 100000,
            enableWorkers: false,
            reasons: [],
        };
        
        const score = results.score;
        const cores = results.device.cores;
        const memory = results.device.memory;
        
        // Quality tier
        if (score >= 80) {
            rec.quality = 'ultra';
            rec.reasons.push('High performance detected - ultra settings recommended');
        } else if (score >= 60) {
            rec.quality = 'high';
            rec.reasons.push('Good performance - high settings recommended');
        } else if (score >= 40) {
            rec.quality = 'medium';
            rec.reasons.push('Average performance - medium settings recommended');
        } else {
            rec.quality = 'low';
            rec.reasons.push('Lower performance detected - reduced settings recommended');
        }
        
        // Memory settings based on available RAM
        if (memory >= 16) {
            rec.frameSlabSizeMB = 64;
            rec.textureBudgetMB = 1024;
            rec.geometryHeapSizeMB = 128;
            rec.reasons.push(`${memory}GB RAM detected - increased memory budgets`);
        } else if (memory >= 8) {
            rec.frameSlabSizeMB = 32;
            rec.textureBudgetMB = 512;
            rec.geometryHeapSizeMB = 64;
        } else if (memory >= 4) {
            rec.frameSlabSizeMB = 16;
            rec.textureBudgetMB = 256;
            rec.geometryHeapSizeMB = 32;
            rec.reasons.push('Limited RAM - reduced memory budgets');
        } else {
            rec.frameSlabSizeMB = 8;
            rec.textureBudgetMB = 128;
            rec.geometryHeapSizeMB = 16;
            rec.reasons.push('Low RAM - minimal memory budgets');
        }
        
        // GPU buffer settings
        if (results.gpu.supported && results.gpu.uniformAlloc < 0.05) {
            rec.uniformRingSizeMB = 16;
            rec.vertexRingSizeMB = 32;
            rec.reasons.push('Fast GPU detected - increased GPU buffers');
        }
        
        // Particle count based on overall score
        if (score >= 80) {
            rec.maxParticles = 200000;
        } else if (score >= 60) {
            rec.maxParticles = 100000;
        } else if (score >= 40) {
            rec.maxParticles = 50000;
        } else {
            rec.maxParticles = 25000;
            rec.reasons.push('Reduced particle count for performance');
        }
        
        // Workers based on core count
        if (cores >= 8 && score >= 60) {
            rec.enableWorkers = true;
            rec.reasons.push(`${cores} CPU cores - enabling Web Workers`);
        } else if (cores >= 4) {
            rec.enableWorkers = false;
            rec.reasons.push('Workers disabled - main thread sufficient');
        }
        
        return rec;
    }
    
    /**
     * Apply benchmark recommendations to config
     * @param {Object} recommendations - From runBenchmark()
     * @param {Object} config - Game config object to update
     */
    applyRecommendations(recommendations, config) {
        if (!config.resources) config.resources = {};
        
        config.resources.frameSlabSizeMB = recommendations.frameSlabSizeMB;
        config.resources.uniformRingSizeMB = recommendations.uniformRingSizeMB;
        config.resources.vertexRingSizeMB = recommendations.vertexRingSizeMB;
        config.resources.geometryHeapSizeMB = recommendations.geometryHeapSizeMB;
        config.resources.textureBudgetMB = recommendations.textureBudgetMB;
        config.resources.maxParticles = recommendations.maxParticles;
        config.resources.enableWorkers = recommendations.enableWorkers;
        
        console.log('[ResourceManager] Applied recommendations:', recommendations);
        return config;
    }
    
    /**
     * Shutdown and cleanup
     */
    shutdown() {
        this.scheduler.shutdown();
        this.gpu?.destroy();
        this.initialized = false;
        console.log('[ResourceManager] Shutdown complete');
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const resources = new ResourceManager();

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

export { 
    JobPriority,
    hostMemory,
    scheduler,
    SlabAllocator,
    ObjectPool,
    SoAContainer,
    workerTemplate,
};

export default ResourceManager;
