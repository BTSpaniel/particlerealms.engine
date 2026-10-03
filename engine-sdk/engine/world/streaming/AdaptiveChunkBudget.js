// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AdaptiveChunkBudget.js - Self-optimizing chunk memory management
 * 
 * Uses PID-style control with EMA smoothing for smooth, responsive adaptation.
 * Based on game engine best practices for adaptive performance.
 */

export class AdaptiveChunkBudget {
    constructor() {
        // Current limits - VRAM-adaptive (will scale based on GPU memory usage)
        this.maxChunks = 12000;        // Starting value - AGGRESSIVE
        this.unloadTarget = 7500;
        
        // Bounds for VRAM-adaptive scaling - UNCAPPED
        this.minMaxChunks = 8000;     // Higher minimum - 2000 was too restrictive
        this.maxMaxChunks = 12000;    // Allow many more chunks (matches engine.cfg)
        this.hysteresisGap = 200;     // Gap between max and unload target
        
        // VRAM-adaptive settings
        this.vramTargetUsage = 0.70;  // Target 70% VRAM usage
        this.vramSoftLimit = 0.80;    // Start reducing at 80%
        this.vramHardLimit = 0.90;    // Hard stop at 90%
        this.lastVRAMAdapt = 0;
        this.vramAdaptInterval = 1000; // Adapt every 1 second
        
        // EMA smoothing (faster response than simple average)
        // EMA = alpha * new + (1-alpha) * old
        this.emaAlpha = 0.15;         // Higher = faster response (0.1-0.3 typical)
        this.emaFrameTime = 16.67;    // Smoothed frame time
        this.emaStreamingTime = 0;    // Smoothed streaming time
        this.emaHeapUsage = 0;        // Smoothed heap usage
        
        // 95th percentile tracking (catch spikes)
        this.frameTimeWindow = [];
        this.windowSize = 60;         // 1 second at 60fps
        this.p95FrameTime = 16.67;    // 95th percentile frame time
        
        // Adaptation settings (faster than before)
        this.adaptInterval = 500;     // Adapt every 500ms (was 1000ms)
        this.lastAdaptTime = 0;
        
        // Target thresholds
        this.targetFrameTime = 16.67; // 60 FPS target
        this.maxFrameTime = 33.33;    // 30 FPS minimum
        this.heapPressureThreshold = 0.85;
        this.heapCriticalThreshold = 0.92;
        this.streamingBudget = 5;     // Max 5ms for streaming
        
        // PID-style proportional control (smooth adjustments)
        this.kp = 0.5;                // Proportional gain (how aggressive)
        this.errorIntegral = 0;       // Accumulated error
        this.ki = 0.1;                // Integral gain (slow drift correction)
        this.maxIntegral = 50;        // Cap integral windup
        
        // State
        this.isUnderPressure = false;
        this.consecutiveGoodFrames = 0;
        this.consecutiveBadFrames = 0;
        
        // Generation throttling (adaptive per-frame limits)
        // Will be scaled by VRAM in setBufferPool()
        this.maxGeneratesPerFrame = 64;  // AGGRESSIVE for instant damage response
        this.minGeneratesPerFrame = 32;  // High minimum ensures responsiveness
        this.maxGeneratesLimit = 128;    // No limit on mesh throughput
        this.generationBudgetMs = 30;    // More time for generation
        
        // Stats for debugging
        this.stats = {
            adaptations: 0,
            increases: 0,
            decreases: 0,
            currentHeapPercent: 0,
            emaFrameTime: 0,
            emaStreamingTime: 0,
            p95FrameTime: 0,
            generatesPerFrame: 2,
        };
        
        // GPU page allocator reference (set via setPageAllocator)
        this.pageAllocator = null;
        this.vramBasedLimits = false;
        
        // GPU buffer pool reference (set via setBufferPool)
        this.bufferPool = null;
        this.bufferPoolLimits = false;
    }
    
    /**
     * Set limits based on GPU page allocator's detected VRAM
     * Call this after GPUPageAllocator.init() completes
     * @param {GPUPageAllocator} pageAllocator
     * @param {number} avgChunkMeshBytes - Average mesh size per chunk (default ~1.5MB)
     */
    setPageAllocator(pageAllocator, avgChunkMeshBytes = 1.5 * 1024 * 1024) {
        this.pageAllocator = pageAllocator;
        
        if (!pageAllocator?.detectedVRAM) {
            console.warn('[AdaptiveChunkBudget] Page allocator has no detected VRAM');
            return;
        }
        
        // Calculate max chunks based on soft limit (75% VRAM)
        const softLimitBytes = pageAllocator.softLimit || pageAllocator.memoryLimit;
        const hardLimitBytes = pageAllocator.hardLimit || pageAllocator.detectedVRAM * 0.95;
        
        // Reserve ~30% of GPU memory for non-chunk buffers (uniforms, textures, staging, etc.)
        const chunkBudgetBytes = softLimitBytes * 0.7;
        const maxChunkBudgetBytes = hardLimitBytes * 0.7;
        
        // Calculate chunk limits
        const softMaxChunks = Math.floor(chunkBudgetBytes / avgChunkMeshBytes);
        const hardMaxChunks = Math.floor(maxChunkBudgetBytes / avgChunkMeshBytes);
        
        // Update bounds based on VRAM - UNCAPPED for maximum loading
        this.minMaxChunks = 4000;     // Higher minimum - 2000 was too restrictive
        this.maxMaxChunks = Math.min(12000, hardMaxChunks);  // Allow more chunks
        
        // Set initial limits based on VRAM (start at 90% capacity for faster loading)
        const targetChunks = Math.floor(softMaxChunks * 0.90);
        this.maxChunks = Math.max(this.minMaxChunks, Math.min(targetChunks, this.maxMaxChunks));
        this.unloadTarget = Math.max(this.minMaxChunks - 200, this.maxChunks - this.hysteresisGap);
        
        // Store VRAM-based target for reference
        this.vramSoftMaxChunks = softMaxChunks;
        this.vramHardMaxChunks = hardMaxChunks;
        this.vramBasedLimits = true;
        
        console.log(`[AdaptiveChunkBudget] VRAM-based limits set:`);
        console.log(`  Detected VRAM: ${(pageAllocator.detectedVRAM / 1024 / 1024).toFixed(0)}MB`);
        console.log(`  Soft limit: ${softMaxChunks} chunks (${(chunkBudgetBytes / 1024 / 1024).toFixed(0)}MB for chunks)`);
        console.log(`  Hard limit: ${hardMaxChunks} chunks (${(maxChunkBudgetBytes / 1024 / 1024).toFixed(0)}MB for chunks)`);
        console.log(`  maxChunks: ${this.maxChunks}, unloadTarget: ${this.unloadTarget}`);
        console.log(`  Bounds: ${this.minMaxChunks} min, ${this.maxMaxChunks} max`);
    }
    
    /**
     * Set limits based on GPU buffer pool (the actual mesh buffer allocator)
     * This is more accurate than page allocator since it tracks real mesh memory
     * @param {GPUBufferPool} bufferPool
     * @param {number} detectedVRAM - Detected VRAM in bytes
     */
    setBufferPool(bufferPool, detectedVRAM) {
        this.bufferPool = bufferPool;
        
        if (!bufferPool || !detectedVRAM) {
            console.warn('[AdaptiveChunkBudget] Buffer pool or VRAM not provided');
            return;
        }
        
        // Set memory limits on the buffer pool itself
        bufferPool.setMemoryLimits(detectedVRAM, 0.6); // 60% for chunk meshes
        
        // Calculate chunk limits based on actual buffer pool limits
        // Average chunk uses ~340KB of GPU buffer (based on 647MB / 1919 chunks from report)
        const avgChunkBufferBytes = 350 * 1024; // 350KB average
        
        const softLimitBytes = bufferPool.softLimit;
        const hardLimitBytes = bufferPool.hardLimit;
        
        const softMaxChunks = Math.floor(softLimitBytes / avgChunkBufferBytes);
        const hardMaxChunks = Math.floor(hardLimitBytes / avgChunkBufferBytes);
        
        // Update bounds based on VRAM - UNCAPPED for maximum loading
        this.minMaxChunks = 4000;     // Higher minimum - 2000 was too restrictive
        this.maxMaxChunks = Math.min(12000, hardMaxChunks);  // Allow more chunks
        
        // Set initial limits based on VRAM (start at 90% capacity for faster loading)
        const targetChunks = Math.floor(softMaxChunks * 0.90);
        this.maxChunks = Math.max(this.minMaxChunks, Math.min(targetChunks, this.maxMaxChunks));
        this.unloadTarget = Math.max(this.minMaxChunks - 200, this.maxChunks - this.hysteresisGap);
        
        this.bufferPoolLimits = true;
        
        // Store detected VRAM for job limit calculations
        this.detectedVRAM = detectedVRAM;
        
        // Generation limits - AGGRESSIVE for instant damage response
        const vramMB = detectedVRAM / 1024 / 1024;
        const scale = Math.max(1, Math.min(2, vramMB / 4096));
        this.maxGeneratesPerFrame = 64;  // Maximum throughput
        this.minGeneratesPerFrame = 32;  // High minimum ensures responsiveness
        this.maxGeneratesLimit = 128;    // No limit on mesh throughput
        this.generationBudgetMs = 30;    // More time for generation
        
        console.log(`[AdaptiveChunkBudget] Buffer pool limits set:`);
        console.log(`  Detected VRAM: ${vramMB.toFixed(0)}MB (scale: ${scale.toFixed(1)}x)`);
        console.log(`  Soft limit: ${softMaxChunks} chunks (${(softLimitBytes / 1024 / 1024).toFixed(0)}MB)`);
        console.log(`  Hard limit: ${hardMaxChunks} chunks (${(hardLimitBytes / 1024 / 1024).toFixed(0)}MB)`);
        console.log(`  maxChunks: ${this.maxChunks}, unloadTarget: ${this.unloadTarget}`);
        console.log(`  Generation: ${this.maxGeneratesPerFrame}-${this.maxGeneratesLimit}/frame, ${this.generationBudgetMs}ms budget`);
    }
    
    /**
     * Get VRAM-based job limits for ChunkJobCoordinator
     * Scales with detected VRAM: 4GB=base, 8GB=2x, 12GB=3x
     * @returns {{ gpuCompute: number, priorityLoader: number, streaming: number, chunkManager: number }}
     */
    getVRAMBasedJobLimits() {
        const vramMB = (this.detectedVRAM || 4096 * 1024 * 1024) / 1024 / 1024;
        
        // AGGRESSIVE scale: 1.5x at 4GB, 2x at 8GB, 3x at 12GB+
        const scale = Math.max(1.5, Math.min(3, vramMB / 4096));
        
        // Base limits - AGGRESSIVE for fast loading
        const baseLimits = {
            gpuCompute: 24,     // 2x increase
            priorityLoader: 16, // 2x increase
            streaming: 24,      // 2x increase
            chunkManager: 16,   // 2x increase
        };
        
        return {
            gpuCompute: Math.floor(baseLimits.gpuCompute * scale),
            priorityLoader: Math.floor(baseLimits.priorityLoader * scale),
            streaming: Math.floor(baseLimits.streaming * scale),
            chunkManager: Math.floor(baseLimits.chunkManager * scale),
        };
    }
    
    /**
     * Check if we should stop loading chunks due to memory pressure
     * @param {number} currentChunkCount - Current number of loaded chunks
     * @returns {boolean} true if we should stop loading
     */
    shouldStopLoading(currentChunkCount = 0) {
        // CRITICAL: Check chunk count FIRST - this is the primary limit
        if (currentChunkCount >= this.maxChunks) {
            return true; // At chunk limit
        }
        
        if (this.bufferPool) {
            const pressure = this.bufferPool.getMemoryPressure();
            if (pressure.atLimit) {
                return true; // Hard stop at limit
            }
            if (pressure.pressure > 0.9) {
                return true; // Stop at 90% of soft limit
            }
        }
        return false;
    }
    
    /**
     * Adapt chunk limit based on current VRAM usage
     * Call this every frame - internally rate-limited
     * @returns {boolean} true if limits were changed
     */
    adaptToVRAM() {
        const now = performance.now();
        if (now - this.lastVRAMAdapt < this.vramAdaptInterval) {
            return false; // Rate limit
        }
        this.lastVRAMAdapt = now;
        
        if (!this.bufferPool) return false;
        
        const pressure = this.bufferPool.getMemoryPressure();
        const usage = pressure.pressure || 0;  // 0-1 range
        const oldMax = this.maxChunks;
        
        // Adaptive scaling based on VRAM pressure
        if (usage > this.vramHardLimit) {
            // CRITICAL: Over 90% - reduce aggressively
            this.maxChunks = Math.max(this.minMaxChunks, Math.floor(this.maxChunks * 0.85));
        } else if (usage > this.vramSoftLimit) {
            // HIGH: Over 80% - reduce gradually
            this.maxChunks = Math.max(this.minMaxChunks, this.maxChunks - 50);
        } else if (usage < this.vramTargetUsage * 0.8 && this.consecutiveGoodFrames > 30) {
            // LOW: Under 56% and stable FPS - can increase
            this.maxChunks = Math.min(this.maxMaxChunks, this.maxChunks + 25);
        }
        
        // Update unload target
        this.unloadTarget = Math.max(this.minMaxChunks - 100, this.maxChunks - this.hysteresisGap);
        
        const changed = this.maxChunks !== oldMax;
        if (changed) {
            this.stats.adaptations++;
            // Minimal logging - only log significant changes
            if (Math.abs(this.maxChunks - oldMax) >= 50) {
                console.log(`[VRAM Adaptive] ${oldMax}→${this.maxChunks} chunks (${(usage * 100).toFixed(0)}% VRAM)`);
            }
        }
        
        return changed;
    }
    
    /**
     * Record frame metrics - call every frame
     * Uses EMA for smooth, responsive tracking
     * @param {number} frameTime - Frame time in ms
     * @param {number} streamingTime - Streaming/update time in ms
     */
    recordFrame(frameTime, streamingTime) {
        // Also adapt to VRAM each frame (internally rate-limited)
        this.adaptToVRAM();
        // EMA update: new = alpha * sample + (1 - alpha) * old
        const a = this.emaAlpha;
        this.emaFrameTime = a * frameTime + (1 - a) * this.emaFrameTime;
        this.emaStreamingTime = a * streamingTime + (1 - a) * this.emaStreamingTime;
        
        // Track frame times for 95th percentile calculation
        this.frameTimeWindow.push(frameTime);
        if (this.frameTimeWindow.length > this.windowSize) {
            this.frameTimeWindow.shift();
        }
        
        // Calculate 95th percentile every 10 frames (avoid sorting every frame)
        if (this.frameTimeWindow.length >= 10 && (this.frameTimeWindow.length % 10) === 0) {
            const sorted = [...this.frameTimeWindow].sort((a, b) => a - b);
            const idx = Math.floor(sorted.length * 0.95);
            this.p95FrameTime = sorted[idx] || this.emaFrameTime;
        }
        
        // EMA heap usage if available
        if (performance.memory) {
            const heapPercent = performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit;
            this.emaHeapUsage = a * heapPercent + (1 - a) * this.emaHeapUsage;
        }
        
        // Track consecutive good/bad frames for stability detection
        if (frameTime < this.targetFrameTime * 1.2) {
            this.consecutiveGoodFrames++;
            this.consecutiveBadFrames = 0;
        } else if (frameTime > this.maxFrameTime) {
            this.consecutiveBadFrames++;
            this.consecutiveGoodFrames = 0;
        }
    }
    
    /**
     * Get current limits - call when checking chunk counts
     * @returns {{maxChunks: number, unloadTarget: number, maxGenerates: number, generationBudgetMs: number}}
     */
    getLimits() {
        return {
            maxChunks: this.maxChunks,
            unloadTarget: this.unloadTarget,
            maxGenerates: this.maxGeneratesPerFrame,
            generationBudgetMs: this.generationBudgetMs,
        };
    }
    
    /**
     * Adapt limits based on recent performance using PID-style control
     * @param {number} now - Current timestamp (performance.now())
     * @returns {boolean} True if limits were changed
     */
    adapt(now = performance.now()) {
        if (now - this.lastAdaptTime < this.adaptInterval) {
            return false;
        }
        this.lastAdaptTime = now;
        
        if (this.frameTimeWindow.length < 10) {
            return false; // Not enough data
        }
        
        // Use EMA values (already computed in recordFrame)
        const frameTime = this.emaFrameTime;
        const streamingTime = this.emaStreamingTime;
        const heapPercent = this.emaHeapUsage;
        
        // Update stats
        this.stats.currentHeapPercent = Math.round(heapPercent * 100);
        this.stats.emaFrameTime = frameTime.toFixed(1);
        this.stats.emaStreamingTime = streamingTime.toFixed(1);
        this.stats.p95FrameTime = this.p95FrameTime.toFixed(1);
        
        const oldMax = this.maxChunks;
        const oldGenerates = this.maxGeneratesPerFrame;
        
        // === PID-STYLE CHUNK CONTROL ===
        // Error = how far we are from target frame time (positive = too slow)
        const frameError = frameTime - this.targetFrameTime;
        const p95Error = this.p95FrameTime - this.targetFrameTime;
        
        // Use worse of EMA and P95 for decisions
        const effectiveError = Math.max(frameError, p95Error * 0.5);
        
        // Integrate error (with anti-windup)
        this.errorIntegral = Math.max(-this.maxIntegral, 
            Math.min(this.maxIntegral, this.errorIntegral + effectiveError * 0.1));
        
        // CRITICAL: Immediate reduction on heap pressure (bypass PID)
        if (heapPercent > this.heapCriticalThreshold) {
            this.maxChunks = Math.max(this.minMaxChunks, Math.floor(this.maxChunks * 0.7));
            this.errorIntegral = this.maxIntegral; // Max pressure
            this.isUnderPressure = true;
        }
        // HIGH heap pressure
        else if (heapPercent > this.heapPressureThreshold) {
            const reduction = Math.ceil((heapPercent - this.heapPressureThreshold) * 200);
            this.maxChunks = Math.max(this.minMaxChunks, this.maxChunks - reduction);
            this.isUnderPressure = true;
        }
        // PID control for frame time
        else if (effectiveError > 5) {
            // Too slow - reduce chunks proportionally
            const adjustment = Math.ceil(this.kp * effectiveError + this.ki * this.errorIntegral);
            this.maxChunks = Math.max(this.minMaxChunks, this.maxChunks - adjustment);
            this.isUnderPressure = true;
        }
        // Good performance - can increase
        else if (effectiveError < -2 && heapPercent < 0.7 && this.consecutiveGoodFrames > 30) {
            // Proportional increase based on headroom
            const headroom = Math.abs(effectiveError);
            const adjustment = Math.ceil(this.kp * headroom * 0.5);
            this.maxChunks = Math.min(this.maxMaxChunks, this.maxChunks + adjustment);
            this.isUnderPressure = false;
            this.consecutiveGoodFrames = 0; // Reset after increase
        }
        else {
            this.isUnderPressure = false;
        }
        
        // Maintain hysteresis gap
        this.unloadTarget = this.maxChunks - this.hysteresisGap;
        
        // === GENERATION THROTTLING (based on BOTH streaming and frame time) ===
        const streamError = streamingTime - this.streamingBudget;
        
        // CRITICAL: Also throttle based on frame time, not just streaming time
        // Mesh/LOD work can spike even when streaming is 0
        if (frameTime > 40 || this.p95FrameTime > 35) {
            // Frame time critical - aggressive throttle
            const frameOverage = Math.max(frameTime - 25, this.p95FrameTime - 25);
            const reduction = Math.ceil(frameOverage / 5);
            this.maxGeneratesPerFrame = Math.max(this.minGeneratesPerFrame, 
                this.maxGeneratesPerFrame - reduction);
            this.generationBudgetMs = 2;
        } else if (streamingTime > 30) {
            // Severe streaming spike - emergency throttle
            this.maxGeneratesPerFrame = this.minGeneratesPerFrame;
            this.generationBudgetMs = 2;
        } else if (frameTime > 25 || streamError > 5) {
            // Moderate pressure - reduce proportionally
            const reduction = Math.max(1, Math.ceil(Math.max(streamError, frameTime - 20) / 5));
            this.maxGeneratesPerFrame = Math.max(this.minGeneratesPerFrame, 
                this.maxGeneratesPerFrame - reduction);
            this.generationBudgetMs = Math.max(2, this.generationBudgetMs - 1);
        } else if (streamError < -2 && frameTime < this.targetFrameTime && this.consecutiveGoodFrames > 30) {
            // Increase only if BOTH streaming and frame time are good
            this.maxGeneratesPerFrame = Math.min(this.maxGeneratesLimit, 
                this.maxGeneratesPerFrame + 1);
            this.generationBudgetMs = Math.min(8, this.generationBudgetMs + 1);
        }
        this.stats.generatesPerFrame = this.maxGeneratesPerFrame;
        
        const changed = this.maxChunks !== oldMax || this.maxGeneratesPerFrame !== oldGenerates;
        
        if (changed) {
            this.stats.adaptations++;
            if (this.maxChunks > oldMax) this.stats.increases++;
            else if (this.maxChunks < oldMax) this.stats.decreases++;
            
            // Verbose logging disabled for performance
        }
        
        return changed;
    }
    
    /**
     * Force immediate reduction (emergency)
     * @param {number} amount - Amount to reduce by
     */
    forceReduce(amount = 50) {
        this.maxChunks = Math.max(this.minMaxChunks, this.maxChunks - amount);
        this.unloadTarget = this.maxChunks - this.hysteresisGap;
        // Emergency logging disabled for performance
    }
    
    /**
     * Get debug info
     * @returns {Object}
     */
    getDebugInfo() {
        return {
            maxChunks: this.maxChunks,
            unloadTarget: this.unloadTarget,
            ...this.stats,
            emaFrameTime: this.emaFrameTime.toFixed(1),
            emaStreamingTime: this.emaStreamingTime.toFixed(1),
            p95FrameTime: this.p95FrameTime.toFixed(1),
            errorIntegral: this.errorIntegral.toFixed(1),
            isUnderPressure: this.isUnderPressure,
            consecutiveGoodFrames: this.consecutiveGoodFrames,
        };
    }
}

export default AdaptiveChunkBudget;
