// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Advanced Performance Analyzer
 * Real-time bottleneck detection, frame pacing analysis, and optimization suggestions
 */

import { statsMean, statsPopulationStdDev } from '../math/MathStatistics.js';

export class PerformanceAnalyzer {
    constructor() {
        this.frameHistory = new Float32Array(300); // 5 seconds at 60fps
        this.frameIndex = 0;
        this.cpuTimings = new Map();
        this.gpuTimings = new Map();
        this.bottlenecks = [];
        this.recommendations = [];
    }

    recordFrame(cpuTime, gpuTime, totalTime) {
        this.frameHistory[this.frameIndex] = totalTime;
        this.frameIndex = (this.frameIndex + 1) % this.frameHistory.length;
    }

    recordCPUTiming(label, time) {
        if (!this.cpuTimings.has(label)) {
            this.cpuTimings.set(label, { samples: [], total: 0, count: 0 });
        }
        const entry = this.cpuTimings.get(label);
        entry.samples.push(time);
        entry.total += time;
        entry.count++;
        
        if (entry.samples.length > 100) {
            entry.samples.shift();
        }
    }

    recordGPUTiming(label, time) {
        if (!this.gpuTimings.has(label)) {
            this.gpuTimings.set(label, { samples: [], total: 0, count: 0 });
        }
        const entry = this.gpuTimings.get(label);
        entry.samples.push(time);
        entry.total += time;
        entry.count++;
        
        if (entry.samples.length > 100) {
            entry.samples.shift();
        }
    }

    analyzeFramePacing() {
        const validFrames = [];
        for (let i = 0; i < this.frameHistory.length; i++) {
            if (this.frameHistory[i] > 0) {
                validFrames.push(this.frameHistory[i]);
            }
        }
        
        if (validFrames.length === 0) return null;
        
        validFrames.sort((a, b) => a - b);
        
        const avg = statsMean(validFrames);
        const p50 = validFrames[Math.floor(validFrames.length * 0.50)];
        const p95 = validFrames[Math.floor(validFrames.length * 0.95)];
        const p99 = validFrames[Math.floor(validFrames.length * 0.99)];
        const max = validFrames[validFrames.length - 1];
        
        // Calculate frame time variance
        const stdDev = statsPopulationStdDev(validFrames);
        
        
        return {
            avg,
            p50,
            p95,
            p99,
            max,
            stdDev,
            fps: {
                avg: 1000 / avg,
                p1: 1000 / p99, // 1% low FPS
            },
        };
    }

    detectBottlenecks() {
        this.bottlenecks = [];
        const framePacing = this.analyzeFramePacing();
        
        if (!framePacing) return this.bottlenecks;
        
        // High frame time variance = stuttering
        if (framePacing.stdDev > 5) {
            this.bottlenecks.push({
                type: 'stuttering',
                severity: 'high',
                metric: `${framePacing.stdDev.toFixed(1)}ms stddev`,
                description: 'High frame time variance causing stuttering',
            });
        }
        
        // P99 much higher than average = occasional spikes
        if (framePacing.p99 > framePacing.avg * 2) {
            this.bottlenecks.push({
                type: 'spikes',
                severity: 'medium',
                metric: `${framePacing.p99.toFixed(1)}ms p99`,
                description: 'Occasional frame spikes detected',
            });
        }
        
        // Analyze CPU timings
        for (const [label, data] of this.cpuTimings.entries()) {
            const avg = data.total / data.count;
            if (avg > 5) {
                this.bottlenecks.push({
                    type: 'cpu',
                    severity: avg > 10 ? 'high' : 'medium',
                    metric: `${avg.toFixed(1)}ms`,
                    description: `CPU bottleneck in ${label}`,
                });
            }
        }
        
        // Analyze GPU timings
        for (const [label, data] of this.gpuTimings.entries()) {
            const avg = data.total / data.count;
            if (avg > 5) {
                this.bottlenecks.push({
                    type: 'gpu',
                    severity: avg > 10 ? 'high' : 'medium',
                    metric: `${avg.toFixed(1)}ms`,
                    description: `GPU bottleneck in ${label}`,
                });
            }
        }
        
        return this.bottlenecks;
    }

    generateRecommendations() {
        this.recommendations = [];
        const bottlenecks = this.detectBottlenecks();
        
        for (const bottleneck of bottlenecks) {
            switch (bottleneck.type) {
                case 'stuttering':
                    this.recommendations.push({
                        priority: 'high',
                        action: 'Enable adaptive quality scaling',
                        reason: 'Reduce frame time variance',
                    });
                    this.recommendations.push({
                        priority: 'medium',
                        action: 'Implement frame pacing with vsync',
                        reason: 'Smooth out frame delivery',
                    });
                    break;
                    
                case 'spikes':
                    this.recommendations.push({
                        priority: 'high',
                        action: 'Profile and optimize spike sources',
                        reason: 'Eliminate occasional long frames',
                    });
                    this.recommendations.push({
                        priority: 'medium',
                        action: 'Implement async asset loading',
                        reason: 'Prevent loading stalls',
                    });
                    break;
                    
                case 'cpu':
                    this.recommendations.push({
                        priority: 'high',
                        action: 'Move work to GPU compute shaders',
                        reason: 'Offload CPU bottleneck',
                    });
                    this.recommendations.push({
                        priority: 'medium',
                        action: 'Use Web Workers for parallel processing',
                        reason: 'Utilize multiple CPU cores',
                    });
                    break;
                    
                case 'gpu':
                    this.recommendations.push({
                        priority: 'high',
                        action: 'Reduce draw calls with instancing',
                        reason: 'Lower GPU overhead',
                    });
                    this.recommendations.push({
                        priority: 'medium',
                        action: 'Implement GPU culling and LOD',
                        reason: 'Reduce GPU workload',
                    });
                    break;
            }
        }
        
        return this.recommendations;
    }

    getReport() {
        const framePacing = this.analyzeFramePacing();
        const bottlenecks = this.detectBottlenecks();
        const recommendations = this.generateRecommendations();
        
        return {
            framePacing,
            bottlenecks,
            recommendations,
            timestamp: Date.now(),
        };
    }

    reset() {
        this.frameHistory.fill(0);
        this.frameIndex = 0;
        this.cpuTimings.clear();
        this.gpuTimings.clear();
        this.bottlenecks = [];
        this.recommendations = [];
    }
}
