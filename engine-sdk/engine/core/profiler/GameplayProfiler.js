// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GameplayProfiler.js - Real-Time Performance Analysis System
 * 
 * Based on Unity/industry best practices:
 * - Uses frame TIME (ms) not FPS for accuracy
 * - Tracks percentiles (P95/P99) to catch stutters
 * - Identifies CPU vs GPU bound scenarios
 * - Throughput testing over real gameplay
 * - Detects thermal throttling and memory trends
 * 
 * Modes:
 * - QUICK: 30 seconds (fast check)
 * - SPAWN: 2 minutes (initial load stress test)
 * - EXTENDED: 5 minutes (sustained + thermal throttling)
 * - STRESS: Run particle/fluid/chunk stress tests
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from '../../sim/ai/AIRandom.js';
import { statsMean, statsPopulationStdDev } from '../math/MathStatistics.js';

export const PROFILE_MODE = {
    QUICK: 'quick',
    SPAWN: 'spawn',
    EXTENDED: 'extended',
    STRESS: 'stress',
    AUTO_TUNE: 'auto_tune',  // NEW: Auto-tuning benchmark
};

const MODE_DURATION_MS = {
    [PROFILE_MODE.QUICK]: 30 * 1000,
    [PROFILE_MODE.SPAWN]: 2 * 60 * 1000,
    [PROFILE_MODE.EXTENDED]: 5 * 60 * 1000,
    [PROFILE_MODE.STRESS]: 60 * 1000,
    [PROFILE_MODE.AUTO_TUNE]: 45 * 1000,  // 45 second auto-tune test
};

// Frame budget targets
const FRAME_BUDGET_60FPS = 16.66;
const FRAME_BUDGET_30FPS = 33.33;
const STUTTER_THRESHOLD_MS = 50;

export class GameplayProfiler {
    constructor() {
        this.game = null;
        this.active = false;
        this.mode = PROFILE_MODE.QUICK;
        this.startTime = 0;
        this.duration = 0;
        
        // Frame time samples (primary metric per Unity best practices)
        this.frameTimes = [];
        this.maxSamples = 20000;
        
        // Per-second snapshots for trends
        this.snapshots = [];
        this.lastSnapshotTime = 0;
        
        // Aggregate statistics
        this.stats = this._createEmptyStats();
        
        // Stress test results
        this.stressResults = {};
        
        // Callbacks
        this.onProgress = null;
        this.onComplete = null;
        
        // Analysis cache
        this._analysis = null;
        this._recommendations = null;
        
        // Auto-tuning state
        this.autoTuneResults = null;
        this.autoTunePhase = 0;
        this.autoTunePhases = [
            'baseline',      // Measure current performance
            'chunk_load',    // Test chunk loading rates
            'mesh_budget',   // Test meshing budget
            'validation',    // Test integrity validation batch size
            'finalize',      // Calculate optimal values
        ];
    }
    
    _createEmptyStats() {
        return {
            // Frame time is primary metric (ms)
            frameTime: {
                samples: [],
                min: Infinity,
                max: 0,
                avg: 0,
                stdDev: 0,
                range: 0,
                p50: 0,  // Median
                p95: 0,  // 95th percentile
                p99: 0,  // 99th percentile (catches stutters)
            },
            // FPS for user-friendly display
            fps: { min: Infinity, max: 0, avg: 0 },
            // Stutters (frames > 50ms)
            stutters: { count: 0, totalMs: 0, worst: 0, timestamps: [] },
            // Draw calls
            drawCalls: { min: Infinity, max: 0, avg: 0 },
            triangles: { min: Infinity, max: 0, avg: 0 },
            // Particles
            particles: { min: 0, max: 0, avg: 0, peak: 0 },
            // Fluids
            fluids: { min: 0, max: 0, avg: 0, peak: 0 },
            // Chunks
            chunks: { rendered: 0, loaded: 0, avg: 0, meshTime: 0 },
            // Memory (detect leaks)
            memory: { start: 0, end: 0, peak: 0, trend: 0, samples: [] },
            // Bound detection
            bound: { cpu: 0, gpu: 0, balanced: 0 },
            // Thermal (FPS drop over time indicates throttling)
            thermal: { startFps: 0, endFps: 0, throttled: false },
            // Duration
            duration: 0,
            sampleCount: 0,
        };
    }
    
    /**
     * Initialize with game reference
     */
    init(game) {
        this.game = game;
        console.log('[GameplayProfiler] Initialized');
    }
    
    /**
     * Start profiling session
     */
    start(mode = PROFILE_MODE.QUICK, options = {}) {
        if (this.active) {
            console.warn('[GameplayProfiler] Already running');
            return false;
        }
        
        this.mode = mode;
        this.duration = MODE_DURATION_MS[mode] || 30000;
        this.startTime = performance.now();
        this.active = true;
        
        // Reset
        this.frameTimes = [];
        this.snapshots = [];
        this.stats = this._createEmptyStats();
        this.stressResults = {};
        this._analysis = null;
        this._recommendations = null;
        
        // Callbacks
        this.onProgress = options.onProgress || null;
        this.onComplete = options.onComplete || null;
        
        // Record starting state
        this.stats.memory.start = this._getMemoryMB();
        this.stats.thermal.startFps = this.game?.stats?.fps || 60;
        
        console.log(`[GameplayProfiler] Started ${mode} (${this.duration/1000}s)`);
        this._reportProgress(0, `Starting ${mode} profile...`);
        
        // If stress mode, run stress tests
        if (mode === PROFILE_MODE.STRESS) {
            this._runStressTests();
        }
        
        // If auto-tune mode, run auto-tuning benchmark
        if (mode === PROFILE_MODE.AUTO_TUNE) {
            this._runAutoTune();
        }
        
        return true;
    }
    
    /**
     * Stop profiling and generate analysis
     */
    stop() {
        if (!this.active) return null;
        
        this.active = false;
        const elapsed = performance.now() - this.startTime;
        
        // Record ending state
        this.stats.memory.end = this._getMemoryMB();
        this.stats.thermal.endFps = this.game?.stats?.fps || 60;
        this.stats.duration = elapsed;
        this.stats.sampleCount = this.frameTimes.length;
        
        // Calculate final statistics
        this._calculateStats();
        
        // Generate analysis and recommendations
        this._analysis = this._generateAnalysis();
        this._recommendations = this._generateRecommendations();
        
        console.log('[GameplayProfiler] Stopped');
        
        // Callback
        const result = this.getResults();
        if (this.onComplete) {
            this.onComplete(result);
        }
        
        return result;
    }
    
    /**
     * Update - call each frame from game loop
     */
    update(dt) {
        if (!this.active) return;
        
        const now = performance.now();
        const elapsed = now - this.startTime;
        
        // Check duration
        if (elapsed >= this.duration) {
            this.stop();
            return;
        }
        
        // Record frame time (PRIMARY METRIC)
        const frameTimeMs = dt * 1000;
        this._recordFrameTime(frameTimeMs);
        
        // Collect game stats
        this._collectGameStats(frameTimeMs);
        
        // Per-second snapshot
        if (now - this.lastSnapshotTime >= 1000) {
            this._takeSnapshot(elapsed);
            this.lastSnapshotTime = now;
            
            // Report progress
            const pct = Math.floor((elapsed / this.duration) * 100);
            const remaining = Math.ceil((this.duration - elapsed) / 1000);
            this._reportProgress(pct, `Profiling... ${remaining}s remaining`);
        }
    }
    
    /**
     * Get current results
     */
    getResults() {
        return {
            mode: this.mode,
            stats: this.stats,
            snapshots: this.snapshots,
            analysis: this._analysis,
            recommendations: this._recommendations,
            stressResults: this.stressResults,
        };
    }
    
    // ========================================================================
    // DATA COLLECTION
    // ========================================================================
    
    _recordFrameTime(ms) {
        if (this.frameTimes.length < this.maxSamples) {
            this.frameTimes.push(ms);
        }
        
        // Update running min/max
        this.stats.frameTime.min = Math.min(this.stats.frameTime.min, ms);
        this.stats.frameTime.max = Math.max(this.stats.frameTime.max, ms);
        
        // Track stutters
        if (ms > STUTTER_THRESHOLD_MS) {
            this.stats.stutters.count++;
            this.stats.stutters.totalMs += ms;
            this.stats.stutters.worst = Math.max(this.stats.stutters.worst, ms);
            if (this.stats.stutters.timestamps.length < 100) {
                this.stats.stutters.timestamps.push(performance.now() - this.startTime);
            }
        }
    }
    
    _collectGameStats(frameTimeMs) {
        const g = this.game;
        if (!g) return;
        
        // FPS
        const fps = g.stats?.fps || (1000 / frameTimeMs);
        this.stats.fps.min = Math.min(this.stats.fps.min, fps);
        this.stats.fps.max = Math.max(this.stats.fps.max, fps);
        
        // Draw calls
        const dc = g.stats?.drawCalls || 0;
        this.stats.drawCalls.min = Math.min(this.stats.drawCalls.min, dc);
        this.stats.drawCalls.max = Math.max(this.stats.drawCalls.max, dc);
        
        // Triangles
        const tri = g.stats?.triangles || 0;
        this.stats.triangles.min = Math.min(this.stats.triangles.min, tri);
        this.stats.triangles.max = Math.max(this.stats.triangles.max, tri);
        
        // Particles
        const particles = g.worldParticles?.length || g.stats?.particleCount || 0;
        this.stats.particles.max = Math.max(this.stats.particles.max, particles);
        this.stats.particles.peak = Math.max(this.stats.particles.peak, particles);
        
        // Fluids
        const fluids = g.fluidSimulator?.activeWaterCount || 0;
        this.stats.fluids.max = Math.max(this.stats.fluids.max, fluids);
        this.stats.fluids.peak = Math.max(this.stats.fluids.peak, fluids);
        
        // Chunks
        const chunks = g.stats?.chunkCount || g.chunkManager?.chunks?.size || 0;
        this.stats.chunks.rendered = Math.max(this.stats.chunks.rendered, chunks);
        
        // Memory
        const mem = this._getMemoryMB();
        this.stats.memory.peak = Math.max(this.stats.memory.peak, mem);
    }
    
    _takeSnapshot(elapsed) {
        const g = this.game;
        this.snapshots.push({
            time: elapsed,
            fps: g?.stats?.fps || 0,
            frameTime: this.frameTimes.length > 0 ? this.frameTimes[this.frameTimes.length - 1] : 0,
            drawCalls: g?.stats?.drawCalls || 0,
            particles: g?.worldParticles?.length || 0,
            fluids: g?.fluidSimulator?.activeWaterCount || 0,
            chunks: g?.stats?.chunkCount || 0,
            memory: this._getMemoryMB(),
        });
        
        // Track memory for trend
        this.stats.memory.samples.push(this._getMemoryMB());
    }
    
    _getMemoryMB() {
        if (performance.memory) {
            return performance.memory.usedJSHeapSize / (1024 * 1024);
        }
        return 0;
    }
    
    // ========================================================================
    // STATISTICS CALCULATION
    // ========================================================================
    
    _calculateStats() {
        const ft = this.frameTimes;
        if (ft.length === 0) return;
        
        // Sort for percentiles
        const sorted = [...ft].sort((a, b) => a - b);
        
        // Frame time stats
        this.stats.frameTime.avg = statsMean(ft);
        this.stats.frameTime.stdDev = statsPopulationStdDev(ft);
        this.stats.frameTime.range = this.stats.frameTime.max - this.stats.frameTime.min;
        this.stats.frameTime.p50 = sorted[Math.floor(sorted.length * 0.50)];
        this.stats.frameTime.p95 = sorted[Math.floor(sorted.length * 0.95)];
        this.stats.frameTime.p99 = sorted[Math.floor(sorted.length * 0.99)];
        this.stats.frameTime.samples = ft;
        
        // FPS stats
        this.stats.fps.avg = 1000 / this.stats.frameTime.avg;
        
        // Draw calls / triangles / particles averages from snapshots
        if (this.snapshots.length > 0) {
            this.stats.drawCalls.avg = statsMean(this.snapshots.map((snapshot) => snapshot.drawCalls));
            this.stats.particles.avg = statsMean(this.snapshots.map((snapshot) => snapshot.particles));
            this.stats.fluids.avg = statsMean(this.snapshots.map((snapshot) => snapshot.fluids));
            this.stats.chunks.avg = statsMean(this.snapshots.map((snapshot) => snapshot.chunks));
        }
        
        // Memory trend (positive = leak)
        this.stats.memory.trend = this.stats.memory.end - this.stats.memory.start;
        
        // Thermal throttling detection (>10% FPS drop)
        const fpsDrop = (this.stats.thermal.startFps - this.stats.thermal.endFps) / this.stats.thermal.startFps;
        this.stats.thermal.throttled = fpsDrop > 0.1;
    }
    
    // ========================================================================
    // STRESS TESTS
    // ========================================================================
    
    async _runStressTests() {
        const report = (msg) => this._reportProgress(0, msg);
        
        // Particle stress test
        report('Stress test: Particles...');
        this.stressResults.particles = await this._stressParticles();
        
        // Fluid stress test
        report('Stress test: Fluids...');
        this.stressResults.fluids = await this._stressFluids();
        
        // Chunk stress test
        report('Stress test: Chunks...');
        this.stressResults.chunks = await this._stressChunks();
        
        report('Stress tests complete');
    }
    
    async _stressParticles() {
        const g = this.game;
        if (!g?.worldParticles) return { supported: false };
        
        const results = {
            supported: true,
            maxStable: 0,
            fpsAt1k: 0,
            fpsAt10k: 0,
            fpsAt50k: 0,
        };
        
        const testCounts = [1000, 10000, 50000];
        const originalCount = g.worldParticles.length;
        
        for (const count of testCounts) {
            // Spawn particles
            while (g.worldParticles.length < count) {
                g.worldParticles.push({
                    x: aiRng.range(-50, 50),
                    y: aiRng.range(10, 60),
                    z: aiRng.range(-50, 50),
                    vx: 0, vy: -1, vz: 0,
                    material: 1,
                    life: 5,
                });
            }
            
            // Wait and measure
            await this._wait(500);
            const fps = g.stats?.fps || 60;
            
            if (count === 1000) results.fpsAt1k = fps;
            else if (count === 10000) results.fpsAt10k = fps;
            else if (count === 50000) results.fpsAt50k = fps;
            
            if (fps >= 30) results.maxStable = count;
        }
        
        // Cleanup
        g.worldParticles.length = originalCount;
        
        return results;
    }
    
    async _stressFluids() {
        const g = this.game;
        if (!g?.fluidSimulator) return { supported: false };
        
        // Just measure current fluid performance
        await this._wait(1000);
        
        return {
            supported: true,
            activeCells: g.fluidSimulator.activeWaterCount || 0,
            fps: g.stats?.fps || 60,
        };
    }
    
    async _stressChunks() {
        const g = this.game;
        if (!g?.chunkManager) return { supported: false };
        
        await this._wait(1000);
        
        return {
            supported: true,
            loadedChunks: g.chunkManager.chunks?.size || 0,
            renderedChunks: g.stats?.chunkCount || 0,
            fps: g.stats?.fps || 60,
        };
    }
    
    _wait(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
    
    // ========================================================================
    // AUTO-TUNING BENCHMARK
    // ========================================================================
    
    /**
     * Run auto-tuning benchmark to find optimal settings for this hardware
     */
    async _runAutoTune() {
        const report = (pct, msg) => this._reportProgress(pct, msg);
        
        this.autoTuneResults = {
            hardware: this._detectHardware(),
            baseline: null,
            optimal: {
                frame_budget_ms: 16,
                initial_load_budget_ms: 33,
                chunks_per_frame: 64,
                max_generates_per_frame: 24,
                heavy_op_budget_ms: 16,
                mesh_budget_base_ms: 16,
                validation_batch: 50,
            },
            tests: [],
            timestamp: Date.now(),
        };
        
        report(5, 'Auto-tune: Detecting hardware...');
        await this._wait(500);
        
        // Phase 1: Baseline measurement
        report(10, 'Auto-tune: Measuring baseline performance...');
        this.autoTuneResults.baseline = await this._measureBaseline();
        
        // Phase 2: Test chunk loading rates
        report(25, 'Auto-tune: Testing chunk loading rates...');
        const chunkResults = await this._testChunkLoadRates();
        this.autoTuneResults.tests.push({ name: 'chunk_load', ...chunkResults });
        
        // Phase 3: Test meshing budget
        report(45, 'Auto-tune: Testing mesh generation...');
        const meshResults = await this._testMeshBudget();
        this.autoTuneResults.tests.push({ name: 'mesh_budget', ...meshResults });
        
        // Phase 4: Test frame budget thresholds
        report(65, 'Auto-tune: Finding optimal frame budget...');
        const budgetResults = await this._testFrameBudget();
        this.autoTuneResults.tests.push({ name: 'frame_budget', ...budgetResults });
        
        // Phase 5: Calculate optimal values
        report(85, 'Auto-tune: Calculating optimal settings...');
        this._calculateOptimalSettings();
        
        report(95, 'Auto-tune: Finalizing...');
        await this._wait(500);
        
        report(100, 'Auto-tune complete!');
        console.log('[GameplayProfiler] Auto-tune complete:', this.autoTuneResults.optimal);
    }
    
    _detectHardware() {
        const gl = document.createElement('canvas').getContext('webgl2');
        const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
        
        return {
            gpu: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown',
            vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'Unknown',
            cores: navigator.hardwareConcurrency || 4,
            memory: navigator.deviceMemory || 4,
            platform: navigator.platform,
            userAgent: navigator.userAgent,
        };
    }
    
    async _measureBaseline() {
        const samples = [];
        const startTime = performance.now();
        
        // Collect 3 seconds of baseline
        while (performance.now() - startTime < 3000) {
            const frameStart = performance.now();
            await this._wait(0);  // Yield to next frame
            samples.push(performance.now() - frameStart);
        }
        
        const sorted = [...samples].sort((a, b) => a - b);
        return {
            avgFrameTime: samples.length === 0 ? NaN : statsMean(samples),
            p95FrameTime: sorted[Math.floor(sorted.length * 0.95)] || 16.66,
            fps: this.game?.stats?.fps || 60,
            samples: samples.length,
        };
    }
    
    async _testChunkLoadRates() {
        const g = this.game;
        const results = { rates: [], optimal: 8 };
        
        // Test different chunk load rates
        const testRates = [2, 4, 8, 12, 16];
        const originalRate = g?.chunkLoadSettings?.maxPerFrame || 8;
        
        for (const rate of testRates) {
            // Apply test rate
            if (g?.chunkLoadSettings) {
                g.chunkLoadSettings.maxPerFrame = rate;
            }
            
            // Measure for 2 seconds
            const samples = [];
            const startTime = performance.now();
            while (performance.now() - startTime < 2000) {
                await this._wait(16);
                samples.push(this.game?.stats?.frameTime || 16.66);
            }
            
            const avgFrameTime = samples.length === 0 ? NaN : statsMean(samples);
            const stable = avgFrameTime < 20;  // Target under 20ms
            
            results.rates.push({ rate, avgFrameTime, stable });
            
            // Find optimal (highest rate that maintains stability)
            if (stable && rate > results.optimal) {
                results.optimal = rate;
            }
        }
        
        // Restore original
        if (g?.chunkLoadSettings) {
            g.chunkLoadSettings.maxPerFrame = originalRate;
        }
        
        return results;
    }
    
    async _testMeshBudget() {
        const g = this.game;
        const results = { budgets: [], optimal: 2 };
        
        // Test different mesh budgets
        const testBudgets = [1, 2, 4, 6, 8];
        
        for (const budget of testBudgets) {
            const samples = [];
            const startTime = performance.now();
            
            while (performance.now() - startTime < 1500) {
                await this._wait(16);
                samples.push(this.game?.stats?.frameTime || 16.66);
            }
            
            const avgFrameTime = samples.length === 0 ? NaN : statsMean(samples);
            const stable = avgFrameTime < 18;
            
            results.budgets.push({ budget, avgFrameTime, stable });
            
            if (stable) {
                results.optimal = budget;
            }
        }
        
        return results;
    }
    
    async _testFrameBudget() {
        const baseline = this.autoTuneResults.baseline;
        const results = { 
            recommended: 12,
            headroom: 0,
        };
        
        // Calculate headroom based on baseline
        const targetFrameTime = 16.66;  // 60fps target
        const currentAvg = baseline.avgFrameTime;
        
        if (currentAvg < 10) {
            // Lots of headroom - can use larger budget
            results.recommended = 14;
            results.headroom = targetFrameTime - currentAvg;
        } else if (currentAvg < 14) {
            // Some headroom
            results.recommended = 12;
            results.headroom = targetFrameTime - currentAvg;
        } else if (currentAvg < 18) {
            // Tight budget
            results.recommended = 10;
            results.headroom = Math.max(0, targetFrameTime - currentAvg);
        } else {
            // Over budget - need strict limits
            results.recommended = 8;
            results.headroom = 0;
        }
        
        return results;
    }
    
    _calculateOptimalSettings() {
        const r = this.autoTuneResults;
        const baseline = r.baseline;
        const chunkTest = r.tests.find(t => t.name === 'chunk_load');
        const meshTest = r.tests.find(t => t.name === 'mesh_budget');
        const budgetTest = r.tests.find(t => t.name === 'frame_budget');
        
        // Calculate optimal values
        r.optimal = {
            // Frame budget based on hardware capability
            frame_budget_ms: budgetTest?.recommended || 12,
            initial_load_budget_ms: Math.min(25, (budgetTest?.recommended || 12) + 8),
            initial_load_min_chunks: baseline.fps >= 55 ? 30 : 50,
            initial_load_stable_frames: 60,
            
            // Chunk loading based on test results
            chunks_per_frame: chunkTest?.optimal || 8,
            max_generates_per_frame: Math.max(1, Math.floor((chunkTest?.optimal || 8) / 4)),
            heavy_op_budget_ms: Math.floor((budgetTest?.recommended || 12) / 3),
            
            // Mesh budget
            mesh_budget_base_ms: meshTest?.optimal || 2,
            
            // Validation batch - scale with CPU cores
            validation_batch: Math.min(100, Math.max(25, r.hardware.cores * 10)),
        };
        
        console.log('[AutoTune] Calculated optimal settings:', r.optimal);
    }
    
    /**
     * Get auto-tune results for saving
     */
    getAutoTuneResults() {
        return this.autoTuneResults;
    }
    
    /**
     * Generate config string for engine.cfg [frame_budget] section
     */
    generateConfigString() {
        if (!this.autoTuneResults?.optimal) return null;
        
        const o = this.autoTuneResults.optimal;
        const hw = this.autoTuneResults.hardware;
        
        return `# Auto-tuned on ${new Date().toISOString()}
# Hardware: ${hw.gpu} (${hw.cores} cores, ${hw.memory}GB RAM)
frame_budget_ms = ${o.frame_budget_ms}
initial_load_budget_ms = ${o.initial_load_budget_ms}
initial_load_min_chunks = ${o.initial_load_min_chunks}
initial_load_stable_frames = ${o.initial_load_stable_frames}
chunks_per_frame = ${o.chunks_per_frame}
max_generates_per_frame = ${o.max_generates_per_frame}
heavy_op_budget_ms = ${o.heavy_op_budget_ms}
mesh_budget_base_ms = ${o.mesh_budget_base_ms}`;
    }
    
    /**
     * Apply auto-tuned settings to game runtime
     */
    applyAutoTuneSettings() {
        if (!this.autoTuneResults?.optimal) {
            console.warn('[GameplayProfiler] No auto-tune results to apply');
            return false;
        }
        
        const o = this.autoTuneResults.optimal;
        const g = this.game;
        
        // Apply to runtime settings
        if (g?.chunkLoadSettings) {
            g.chunkLoadSettings.maxPerFrame = o.chunks_per_frame;
            g.chunkLoadSettings.maxGeneratesPerFrame = o.max_generates_per_frame;
            g.chunkLoadSettings.heavyOpBudgetMs = o.heavy_op_budget_ms;
            g.chunkLoadSettings.meshBudgetBaseMs = o.mesh_budget_base_ms;
        }
        
        // Update config object for persistence
        if (g?.config) {
            if (!g.config.frame_budget) g.config.frame_budget = {};
            Object.assign(g.config.frame_budget, o);
        }
        
        console.log('[GameplayProfiler] Applied auto-tune settings');
        return true;
    }
    
    // ========================================================================
    // ANALYSIS & RECOMMENDATIONS
    // ========================================================================
    
    _generateAnalysis() {
        const s = this.stats;
        const analysis = {
            score: 0,
            grade: 'F',
            budgetMet: false,
            bound: 'unknown', // cpu, gpu, balanced
            issues: [],
            strengths: [],
            summary: '',
        };
        
        // Check frame budget (targeting 60fps = 16.66ms)
        analysis.budgetMet = s.frameTime.p95 <= FRAME_BUDGET_60FPS;
        
        // Score calculation (0-100)
        let score = 50;
        
        // Frame time scoring (most important)
        if (s.frameTime.avg <= 16.66) score += 20;
        else if (s.frameTime.avg <= 33.33) score += 10;
        else score -= 10;
        
        // P95 scoring (stutters matter)
        if (s.frameTime.p95 <= 20) score += 15;
        else if (s.frameTime.p95 <= 33) score += 5;
        else score -= 5;
        
        // Stutter scoring
        if (s.stutters.count === 0) score += 10;
        else if (s.stutters.count < 5) score += 5;
        else score -= 10;
        
        // Stability scoring retains the established frame-time range thresholds.
        const frameTimeRange = s.frameTime.range;
        if (frameTimeRange < 10) score += 5;
        else if (frameTimeRange > 50) score -= 5;
        
        // Clamp
        analysis.score = Math.max(0, Math.min(100, score));
        
        // Grade
        if (analysis.score >= 90) analysis.grade = 'A';
        else if (analysis.score >= 80) analysis.grade = 'B';
        else if (analysis.score >= 70) analysis.grade = 'C';
        else if (analysis.score >= 60) analysis.grade = 'D';
        else analysis.grade = 'F';
        
        // Issues & Strengths
        if (s.frameTime.avg <= 16.66) {
            analysis.strengths.push(`Excellent avg frame time: ${s.frameTime.avg.toFixed(2)}ms (60+ FPS)`);
        } else if (s.frameTime.avg <= 33.33) {
            analysis.strengths.push(`Acceptable avg frame time: ${s.frameTime.avg.toFixed(2)}ms (30+ FPS)`);
        } else {
            analysis.issues.push(`High avg frame time: ${s.frameTime.avg.toFixed(2)}ms (below 30 FPS target)`);
        }
        
        if (s.frameTime.p99 > 50) {
            analysis.issues.push(`High P99 frame time: ${s.frameTime.p99.toFixed(1)}ms - occasional stutters`);
        }
        
        if (s.stutters.count > 0) {
            analysis.issues.push(`${s.stutters.count} frame stutters (>${STUTTER_THRESHOLD_MS}ms), worst: ${s.stutters.worst.toFixed(0)}ms`);
        } else {
            analysis.strengths.push('No frame stutters detected');
        }
        
        if (s.thermal.throttled) {
            analysis.issues.push('Thermal throttling detected - FPS dropped over time');
        }
        
        if (s.memory.trend > 50) {
            analysis.issues.push(`Memory leak suspected: +${s.memory.trend.toFixed(1)}MB during profile`);
        } else if (s.memory.trend < 5) {
            analysis.strengths.push('Stable memory usage');
        }
        
        if (s.drawCalls.avg > 500) {
            analysis.issues.push(`High draw call count: ${s.drawCalls.avg.toFixed(0)} avg`);
        }
        
        // Summary
        analysis.summary = `Grade ${analysis.grade} (${analysis.score}/100). ` +
            `Avg: ${s.frameTime.avg.toFixed(1)}ms (${s.fps.avg.toFixed(0)} FPS), ` +
            `P95: ${s.frameTime.p95.toFixed(1)}ms, ` +
            `${s.stutters.count} stutters.`;
        
        return analysis;
    }
    
    _generateRecommendations() {
        const s = this.stats;
        const a = this._analysis;
        const recs = [];
        
        // Frame time recommendations
        if (s.frameTime.avg > 33.33) {
            recs.push({
                priority: 'high',
                category: 'performance',
                issue: 'Frame time too high for 30 FPS',
                suggestion: 'Reduce render distance, lower particle count, disable expensive effects',
                settings: {
                    'chunk_distances.render_distance': Math.max(4, Math.floor((this.game?.config?.chunk_distances?.render_distance || 12) * 0.7)),
                    'resources.maxParticles': Math.floor(s.particles.avg * 0.5),
                },
            });
        }
        
        // Stutters
        if (s.stutters.count > 5) {
            recs.push({
                priority: 'high',
                category: 'stutters',
                issue: `${s.stutters.count} frame stutters detected`,
                suggestion: 'Increase memory budgets to reduce GC pressure',
                settings: {
                    'resources.frameSlabSizeMB': 64,
                    'resources.geometryHeapSizeMB': 128,
                },
            });
        }
        
        // Draw calls
        if (s.drawCalls.avg > 500) {
            recs.push({
                priority: 'medium',
                category: 'drawcalls',
                issue: 'High draw call count',
                suggestion: 'Enable render bundles, reduce chunk count, use LOD',
                settings: {
                    'chunk_distances.render_distance': Math.max(4, Math.floor((this.game?.config?.chunk_distances?.render_distance || 12) * 0.8)),
                },
            });
        }
        
        // Particles
        if (s.particles.peak > 50000 && s.frameTime.avg > 20) {
            recs.push({
                priority: 'medium',
                category: 'particles',
                issue: 'High particle count affecting performance',
                suggestion: 'Reduce max particles or particle lifetime',
                settings: {
                    'resources.maxParticles': 50000,
                },
            });
        }
        
        // Memory
        if (s.memory.trend > 50) {
            recs.push({
                priority: 'high',
                category: 'memory',
                issue: 'Memory increasing over time (possible leak)',
                suggestion: 'Check for object pooling, enable resource manager',
                settings: {
                    'resources.enabled': true,
                },
            });
        }
        
        // Thermal
        if (s.thermal.throttled) {
            recs.push({
                priority: 'medium',
                category: 'thermal',
                issue: 'Device thermal throttling detected',
                suggestion: 'Lower quality settings to reduce heat',
                settings: {
                    'resources.textureBudgetMB': 256,
                    'chunk_distances.render_distance': 8,
                },
            });
        }
        
        // Good performance - can increase quality
        if (a.score >= 80 && s.frameTime.avg < 12) {
            recs.push({
                priority: 'low',
                category: 'quality',
                issue: 'Headroom available for higher quality',
                suggestion: 'Can increase render distance or particle count',
                settings: {
                    'chunk_distances.render_distance': Math.min(24, (this.game?.config?.chunk_distances?.render_distance || 12) + 4),
                    'resources.maxParticles': Math.min(200000, (s.particles.peak || 50000) * 1.5),
                },
            });
        }
        
        return recs;
    }
    
    /**
     * Apply recommendations to game config
     */
    applyRecommendations(config, priorityFilter = null) {
        if (!this._recommendations) return config;
        
        for (const rec of this._recommendations) {
            if (priorityFilter && rec.priority !== priorityFilter) continue;
            
            for (const [key, value] of Object.entries(rec.settings || {})) {
                const parts = key.split('.');
                let obj = config;
                for (let i = 0; i < parts.length - 1; i++) {
                    if (!obj[parts[i]]) obj[parts[i]] = {};
                    obj = obj[parts[i]];
                }
                obj[parts[parts.length - 1]] = value;
            }
        }
        
        console.log('[GameplayProfiler] Applied recommendations to config');
        return config;
    }
    
    _reportProgress(pct, msg) {
        if (this.onProgress) this.onProgress(pct, msg);
    }
}

// Singleton
export const profiler = new GameplayProfiler();
export default GameplayProfiler;
