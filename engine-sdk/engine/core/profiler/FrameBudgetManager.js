// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { statsMean } from '../math/MathStatistics.js';
import { lerp } from '../math/MathScalar.js';

/**
 * FrameBudgetManager.js - Intelligent Frame Time Budget Management
 * 
 * Prevents frame budget violations by:
 * 1. Tracking time spent in each subsystem
 * 2. Dynamically throttling work based on remaining budget
 * 3. Spreading heavy operations across multiple frames
 * 4. Prioritizing visible/important work
 * 
 * Target: 16.67ms total frame time (60 FPS)
 *   - Update: 8ms max
 *   - Render: 6ms max  
 *   - Overhead: 2.67ms buffer
 */

// Default budgets in milliseconds
const DEFAULT_BUDGETS = {
    total: 16.0,        // 60 FPS target
    update: 8.0,        // Half for update
    render: 6.0,        // Most of remainder for render
    meshing: 2.0,       // Sub-budget for chunk meshing
    streaming: 1.5,     // Sub-budget for chunk streaming
    physics: 1.0,       // Sub-budget for physics
    progressive: 0.5,   // Sub-budget for progressive refinement
};

// Work queues for deferred operations
const workQueues = {
    meshing: [],
    streaming: [],
    refinement: [],
    cleanup: [],
};

/**
 * FrameBudgetManager - Manages per-frame time budgets
 */
export class FrameBudgetManager {
    constructor(options = {}) {
        this.budgets = { ...DEFAULT_BUDGETS, ...options };
        
        // Frame timing state
        this.frameStart = 0;
        this.updateStart = 0;
        this.renderStart = 0;
        
        // Section timings (rolling averages)
        this.sectionTimes = {
            update: 0,
            render: 0,
            meshing: 0,
            streaming: 0,
            physics: 0,
            progressive: 0,
        };
        
        // Adaptive throttle multipliers (0-1)
        this.throttles = {
            meshing: 1.0,
            streaming: 1.0,
            refinement: 1.0,
        };
        
        // Work queues
        this.workQueues = workQueues;
        
        // Statistics
        this.stats = {
            framesOverBudget: 0,
            totalFrames: 0,
            avgFrameTime: 0,
            avgUpdateTime: 0,
            avgRenderTime: 0,
            budgetViolationRate: 0,
        };
        
        // Rolling average window
        this.frameTimes = [];
        this.maxSamples = 60;
    }
    
    /**
     * Begin a new frame
     */
    beginFrame() {
        this.frameStart = performance.now();
        this.stats.totalFrames++;
    }
    
    /**
     * Begin update section
     */
    beginUpdate() {
        this.updateStart = performance.now();
    }
    
    /**
     * End update section and calculate time spent
     */
    endUpdate() {
        const elapsed = performance.now() - this.updateStart;
        this.sectionTimes.update = lerp(this.sectionTimes.update, elapsed, 0.1);
        return elapsed;
    }
    
    /**
     * Begin render section
     */
    beginRender() {
        this.renderStart = performance.now();
    }
    
    /**
     * End render section
     */
    endRender() {
        const elapsed = performance.now() - this.renderStart;
        this.sectionTimes.render = lerp(this.sectionTimes.render, elapsed, 0.1);
        return elapsed;
    }
    
    /**
     * End frame and update statistics
     */
    endFrame() {
        const totalTime = performance.now() - this.frameStart;
        
        // Track frame times
        this.frameTimes.push(totalTime);
        if (this.frameTimes.length > this.maxSamples) {
            this.frameTimes.shift();
        }
        
        // Update stats
        this.stats.avgFrameTime = statsMean(this.frameTimes);
        
        // Check for budget violation
        if (totalTime > this.budgets.total) {
            this.stats.framesOverBudget++;
            this._adjustThrottles(totalTime);
        } else {
            // Gradually restore throttles when under budget
            this._relaxThrottles();
        }
        
        this.stats.budgetViolationRate = (this.stats.framesOverBudget / this.stats.totalFrames) * 100;
    }
    
    /**
     * Check if we're over the update budget
     */
    isUpdateOverBudget() {
        return (performance.now() - this.updateStart) > this.budgets.update;
    }
    
    /**
     * Check if we're over a specific sub-budget
     */
    isOverSubBudget(section) {
        const sectionStart = this[`${section}Start`] || this.updateStart;
        const budget = this.budgets[section] || 1.0;
        return (performance.now() - sectionStart) > budget;
    }
    
    /**
     * Get remaining time for a section
     */
    getRemainingTime(section) {
        const budget = this.budgets[section] || this.budgets.update;
        const elapsed = performance.now() - this.updateStart;
        return Math.max(0, budget - elapsed);
    }
    
    /**
     * Get throttle multiplier for a section (0-1)
     */
    getThrottle(section) {
        return this.throttles[section] || 1.0;
    }
    
    /**
     * Calculate max work items for this frame based on throttle
     */
    getMaxWorkItems(section, baseMax) {
        const throttle = this.getThrottle(section);
        return Math.max(1, Math.floor(baseMax * throttle));
    }
    
    /**
     * Queue work for later frames
     */
    queueWork(section, work) {
        if (!this.workQueues[section]) {
            this.workQueues[section] = [];
        }
        this.workQueues[section].push(work);
    }
    
    /**
     * Process queued work within budget
     */
    processQueue(section, maxTimeMs = 1.0) {
        const queue = this.workQueues[section];
        if (!queue || queue.length === 0) return 0;
        
        const start = performance.now();
        let processed = 0;
        
        while (queue.length > 0 && (performance.now() - start) < maxTimeMs) {
            const work = queue.shift();
            if (typeof work === 'function') {
                work();
                processed++;
            }
        }
        
        return processed;
    }
    
    /**
     * Get queue depth
     */
    getQueueDepth(section) {
        return this.workQueues[section]?.length || 0;
    }
    
    /**
     * Adjust throttles when over budget
     */
    _adjustThrottles(actualTime) {
        const overageRatio = actualTime / this.budgets.total;
        const reduction = Math.min(0.9, overageRatio - 1.0);
        
        // Reduce throttles proportionally
        for (const key in this.throttles) {
            this.throttles[key] = Math.max(0.1, this.throttles[key] - reduction * 0.1);
        }
    }
    
    /**
     * Gradually restore throttles when under budget
     */
    _relaxThrottles() {
        for (const key in this.throttles) {
            this.throttles[key] = Math.min(1.0, this.throttles[key] + 0.02);
        }
    }
    
    /**
     * Set custom budget for a section
     */
    setBudget(section, ms) {
        this.budgets[section] = ms;
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            throttles: { ...this.throttles },
            sectionTimes: { ...this.sectionTimes },
            queueDepths: {
                meshing: this.getQueueDepth('meshing'),
                streaming: this.getQueueDepth('streaming'),
                refinement: this.getQueueDepth('refinement'),
            },
        };
    }
    
    /**
     * Reset statistics
     */
    reset() {
        this.stats = {
            framesOverBudget: 0,
            totalFrames: 0,
            avgFrameTime: 0,
            avgUpdateTime: 0,
            avgRenderTime: 0,
            budgetViolationRate: 0,
        };
        this.frameTimes = [];
        
        // Reset throttles
        for (const key in this.throttles) {
            this.throttles[key] = 1.0;
        }
        
        // Clear work queues
        for (const key in this.workQueues) {
            this.workQueues[key] = [];
        }
    }
}

// Singleton instance
let globalManager = null;

/**
 * Get global frame budget manager
 */
export function getFrameBudgetManager() {
    if (!globalManager) {
        globalManager = new FrameBudgetManager();
    }
    return globalManager;
}

/**
 * Quick check if we should skip work this frame
 */
export function shouldSkipWork(section) {
    const manager = getFrameBudgetManager();
    return manager.isUpdateOverBudget() || manager.getThrottle(section) < 0.5;
}

export { DEFAULT_BUDGETS };
export default FrameBudgetManager;
