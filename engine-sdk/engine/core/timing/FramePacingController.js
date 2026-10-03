// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Frame Pacing Controller - Adaptive VSync and frame timing optimization
 * Eliminates micro-stuttering and optimizes for display refresh rate
 */

import { statsMean, statsPopulationStdDev } from '../math/MathStatistics.js';

export class FramePacingController {
    constructor(options = {}) {
        this.targetFps = options.targetFps || 60;
        this.targetFrameTime = 1000 / this.targetFps;
        this.adaptiveVSync = options.adaptiveVSync !== false;
        this.frameTimeHistory = new Float32Array(120);
        this.frameTimeIndex = 0;
        this.lastFrameTime = 0;
        this.frameDebt = 0;
        this.displayRefreshRate = 60;
        
        this.stats = {
            avgFrameTime: 0,
            variance: 0,
            droppedFrames: 0,
            vsyncMisses: 0,
        };
        
        this._detectRefreshRate();
    }

    async _detectRefreshRate() {
        if ('getScreenDetails' in window) {
            try {
                const screenDetails = await window.getScreenDetails();
                const currentScreen = screenDetails.currentScreen;
                this.displayRefreshRate = currentScreen.refreshRate || 60;
                console.log(`[FramePacing] Detected ${this.displayRefreshRate}Hz display`);
            } catch (e) {
                this.displayRefreshRate = 60;
            }
        }
    }

    /**
     * Calculate optimal frame timing
     */
    getOptimalFrameTime(currentTime) {
        const timeSinceLastFrame = currentTime - this.lastFrameTime;
        this.lastFrameTime = currentTime;
        
        // Record frame time
        this.frameTimeHistory[this.frameTimeIndex] = timeSinceLastFrame;
        this.frameTimeIndex = (this.frameTimeIndex + 1) % this.frameTimeHistory.length;
        
        // Calculate variance for adaptive vsync
        this._updateStats();
        
        // Adaptive VSync logic
        if (this.adaptiveVSync) {
            return this._calculateAdaptiveFrameTime(timeSinceLastFrame);
        }
        
        return this.targetFrameTime;
    }

    _calculateAdaptiveFrameTime(actualFrameTime) {
        const displayFrameTime = 1000 / this.displayRefreshRate;
        
        // If we're consistently hitting display refresh, lock to it
        if (Math.abs(actualFrameTime - displayFrameTime) < 1.0) {
            return displayFrameTime;
        }
        
        // If we're consistently missing, try half refresh (30fps on 60Hz)
        const halfRefresh = displayFrameTime * 2;
        if (this.stats.avgFrameTime > displayFrameTime * 1.5 && 
            this.stats.avgFrameTime < halfRefresh * 1.2) {
            return halfRefresh;
        }
        
        // Otherwise use target
        return this.targetFrameTime;
    }

    /**
     * Determine if we should skip this frame to maintain pacing
     */
    shouldSkipFrame(currentTime) {
        const timeSinceLastFrame = currentTime - this.lastFrameTime;
        
        // Skip if we're way behind (>2 frames)
        if (timeSinceLastFrame > this.targetFrameTime * 2.5) {
            this.stats.droppedFrames++;
            return true;
        }
        
        return false;
    }

    /**
     * Calculate sleep time to hit target frame time
     */
    calculateSleepTime(frameStartTime) {
        const frameElapsed = performance.now() - frameStartTime;
        const sleepTime = Math.max(0, this.targetFrameTime - frameElapsed - 1); // -1ms safety margin
        
        return sleepTime;
    }

    /**
     * Precise frame limiter using busy-wait for last millisecond
     */
    async waitForNextFrame(frameStartTime) {
        const targetTime = frameStartTime + this.targetFrameTime;
        const now = performance.now();
        const remaining = targetTime - now;
        
        if (remaining <= 0) return;
        
        // Sleep for most of the time
        if (remaining > 2) {
            await new Promise(resolve => setTimeout(resolve, remaining - 1));
        }
        
        // Busy-wait for precise timing (last 1-2ms)
        while (performance.now() < targetTime) {
            // Spin
        }
    }

    _frameTimeSamples() {
        return Array.from(this.frameTimeHistory).filter((value) => value > 0);
    }

    _updateStats() {
        const samples = this._frameTimeSamples();
        this.stats.avgFrameTime = statsMean(samples);
        this.stats.variance = statsPopulationStdDev(samples);
    }
    /**
     * Get frame pacing quality score (0-100)
     */
    getQualityScore() {
        const targetVariance = 2.0; // 2ms variance is acceptable
        const varianceScore = Math.max(0, 100 - (this.stats.variance / targetVariance) * 100);
        
        const fpsScore = Math.min(100, (this.stats.avgFrameTime > 0 ? 
            (this.targetFrameTime / this.stats.avgFrameTime) * 100 : 100));
        
        return (varianceScore * 0.6 + fpsScore * 0.4);
    }

    getStats() {
        return {
            ...this.stats,
            displayRefreshRate: this.displayRefreshRate,
            targetFps: this.targetFps,
            qualityScore: this.getQualityScore(),
        };
    }

    reset() {
        this.frameTimeHistory.fill(0);
        this.frameTimeIndex = 0;
        this.lastFrameTime = 0;
        this.frameDebt = 0;
        this.stats.droppedFrames = 0;
        this.stats.vsyncMisses = 0;
    }
}
