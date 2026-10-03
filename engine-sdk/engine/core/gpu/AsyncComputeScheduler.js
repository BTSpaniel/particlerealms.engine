// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AsyncComputeScheduler.js - Async Compute Overlap
 * 
 * Schedules compute work to run in parallel with rendering.
 * Uses multiple command encoders and careful synchronization.
 * 
 * Benefits:
 * - Better GPU utilization
 * - Hide compute latency behind render work
 * - Prioritize time-critical work
 * 
 * WebGPU Note:
 * WebGPU doesn't expose explicit async compute queues like Vulkan,
 * but we can still benefit from:
 * - Batching independent compute dispatches
 * - Submitting compute work early in the frame
 * - Using mapAsync for non-blocking readbacks
 */

/**
 * ComputeTask - A single compute operation
 */
class ComputeTask {
    constructor(name, priority = 0) {
        this.name = name;
        this.priority = priority;
        this.pipeline = null;
        this.bindGroups = [];
        this.dispatchSize = [1, 1, 1];
        this.dependencies = [];
        this.onComplete = null;
        
        // Timing
        this.submittedTime = 0;
        this.completedTime = 0;
    }
}

/**
 * AsyncComputeScheduler - Manages async compute work
 */
export class AsyncComputeScheduler {
    constructor() {
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        // Task queues by priority
        this.highPriorityTasks = [];    // Frame-critical (culling, LOD)
        this.normalPriorityTasks = [];  // Important (meshing, physics)
        this.lowPriorityTasks = [];     // Background (compression, GI)
        
        // Running tasks
        this.pendingTasks = new Map();
        this.taskIdCounter = 0;
        
        // Readback buffers for async results
        this.readbackBuffers = [];
        this.maxReadbackBuffers = 4;
        
        // Stats
        this.stats = {
            tasksSubmitted: 0,
            tasksCompleted: 0,
            totalComputeTimeMs: 0,
            averageLatencyMs: 0,
        };
        
        // Frame timing
        this.frameStartTime = 0;
        this.computeBudgetMs = 4.0;  // Max compute time per frame
    }
    
    /**
     * Initialize the scheduler
     * @param {GPUDevice} device 
     */
    init(device) {
        this.device = device;
        
        // Create readback buffers for async result retrieval
        for (let i = 0; i < this.maxReadbackBuffers; i++) {
            this.readbackBuffers.push({
                buffer: device.createBuffer({
                    label: `Async Readback ${i}`,
                    size: 1024 * 1024,  // 1MB each
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                }),
                inUse: false,
                taskId: -1,
            });
        }
        
        this.initialized = true;
        console.log('[AsyncComputeScheduler] Initialized');
    }
    
    /**
     * Begin frame - reset timing
     */
    beginFrame() {
        this.frameStartTime = performance.now();
    }
    
    /**
     * Check if we have compute budget remaining
     */
    hasComputeBudget() {
        const elapsed = performance.now() - this.frameStartTime;
        return elapsed < this.computeBudgetMs;
    }
    
    /**
     * Schedule a compute task
     * @param {Object} config - Task configuration
     * @returns {number} - Task ID
     */
    scheduleTask(config) {
        const task = new ComputeTask(config.name, config.priority || 0);
        task.pipeline = config.pipeline;
        task.bindGroups = config.bindGroups || [];
        task.dispatchSize = config.dispatchSize || [1, 1, 1];
        task.dependencies = config.dependencies || [];
        task.onComplete = config.onComplete;
        
        const taskId = this.taskIdCounter++;
        
        // Add to appropriate priority queue
        if (config.priority >= 10) {
            this.highPriorityTasks.push({ id: taskId, task });
        } else if (config.priority >= 0) {
            this.normalPriorityTasks.push({ id: taskId, task });
        } else {
            this.lowPriorityTasks.push({ id: taskId, task });
        }
        
        return taskId;
    }
    
    /**
     * Schedule high-priority compute (culling, LOD selection)
     */
    scheduleHighPriority(name, pipeline, bindGroups, dispatchSize, onComplete) {
        return this.scheduleTask({
            name,
            priority: 10,
            pipeline,
            bindGroups,
            dispatchSize,
            onComplete,
        });
    }
    
    /**
     * Schedule normal-priority compute (meshing, physics)
     */
    scheduleNormal(name, pipeline, bindGroups, dispatchSize, onComplete) {
        return this.scheduleTask({
            name,
            priority: 0,
            pipeline,
            bindGroups,
            dispatchSize,
            onComplete,
        });
    }
    
    /**
     * Schedule low-priority background compute
     */
    scheduleLowPriority(name, pipeline, bindGroups, dispatchSize, onComplete) {
        return this.scheduleTask({
            name,
            priority: -10,
            pipeline,
            bindGroups,
            dispatchSize,
            onComplete,
        });
    }
    
    /**
     * Execute high-priority tasks immediately
     * Call this before rendering for frame-critical compute
     * @returns {GPUCommandBuffer}
     */
    executeHighPriority() {
        if (!this.enabled || this.highPriorityTasks.length === 0) {
            return null;
        }
        
        const encoder = this.device.createCommandEncoder({
            label: 'High Priority Compute',
        });
        
        const pass = encoder.beginComputePass({
            label: 'High Priority Compute Pass',
        });
        
        for (const { id, task } of this.highPriorityTasks) {
            this.executeTask(pass, task);
            task.submittedTime = performance.now();
            this.pendingTasks.set(id, task);
            this.stats.tasksSubmitted++;
        }
        
        pass.end();
        this.highPriorityTasks = [];
        
        return encoder.finish();
    }
    
    /**
     * Execute normal and low priority tasks with budget
     * Call this after rendering or during idle time
     * @returns {GPUCommandBuffer|null}
     */
    executeBackground() {
        if (!this.enabled) return null;
        
        const tasks = [
            ...this.normalPriorityTasks,
            ...this.lowPriorityTasks,
        ];
        
        if (tasks.length === 0) return null;
        
        const encoder = this.device.createCommandEncoder({
            label: 'Background Compute',
        });
        
        const pass = encoder.beginComputePass({
            label: 'Background Compute Pass',
        });
        
        let executedCount = 0;
        const maxTasksPerFrame = 8;  // Limit to prevent frame spikes
        
        for (const { id, task } of tasks) {
            if (!this.hasComputeBudget() || executedCount >= maxTasksPerFrame) {
                break;
            }
            
            this.executeTask(pass, task);
            task.submittedTime = performance.now();
            this.pendingTasks.set(id, task);
            this.stats.tasksSubmitted++;
            executedCount++;
        }
        
        pass.end();
        
        // Remove executed tasks from queues
        this.normalPriorityTasks = this.normalPriorityTasks.slice(executedCount);
        if (executedCount > this.normalPriorityTasks.length) {
            const remaining = executedCount - this.normalPriorityTasks.length;
            this.lowPriorityTasks = this.lowPriorityTasks.slice(remaining);
        }
        
        return encoder.finish();
    }
    
    /**
     * Execute a single task in a compute pass
     */
    executeTask(pass, task) {
        pass.setPipeline(task.pipeline);
        
        for (let i = 0; i < task.bindGroups.length; i++) {
            pass.setBindGroup(i, task.bindGroups[i]);
        }
        
        pass.dispatchWorkgroups(
            task.dispatchSize[0],
            task.dispatchSize[1],
            task.dispatchSize[2]
        );
    }
    
    /**
     * Request async readback of compute results
     * @param {GPUBuffer} sourceBuffer 
     * @param {number} size 
     * @param {Function} callback - (data: ArrayBuffer) => void
     * @returns {boolean} - True if readback was scheduled
     */
    requestReadback(sourceBuffer, size, callback) {
        // Find available readback buffer
        const readback = this.readbackBuffers.find(rb => !rb.inUse);
        if (!readback) {
            console.warn('[AsyncComputeScheduler] No readback buffers available');
            return false;
        }
        
        // Check size
        if (size > readback.buffer.size) {
            console.warn(`[AsyncComputeScheduler] Readback size ${size} exceeds buffer size`);
            return false;
        }
        
        readback.inUse = true;
        
        // Copy and map
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(sourceBuffer, 0, readback.buffer, 0, size);
        this.device.queue.submit([encoder.finish()]);
        
        // Async map
        readback.buffer.mapAsync(GPUMapMode.READ, 0, size).then(() => {
            const data = readback.buffer.getMappedRange(0, size).slice(0);
            readback.buffer.unmap();
            readback.inUse = false;
            callback(data);
        }).catch(err => {
            console.error('[AsyncComputeScheduler] Readback failed:', err);
            readback.inUse = false;
        });
        
        return true;
    }
    
    /**
     * Mark a task as complete
     * @param {number} taskId 
     */
    completeTask(taskId) {
        const task = this.pendingTasks.get(taskId);
        if (task) {
            task.completedTime = performance.now();
            const latency = task.completedTime - task.submittedTime;
            
            this.stats.tasksCompleted++;
            this.stats.totalComputeTimeMs += latency;
            this.stats.averageLatencyMs = this.stats.totalComputeTimeMs / this.stats.tasksCompleted;
            
            if (task.onComplete) {
                task.onComplete();
            }
            
            this.pendingTasks.delete(taskId);
        }
    }
    
    /**
     * Get pending task count
     */
    getPendingCount() {
        return this.highPriorityTasks.length + 
               this.normalPriorityTasks.length + 
               this.lowPriorityTasks.length;
    }
    
    /**
     * Get stats
     */
    getStats() {
        return {
            ...this.stats,
            pendingTasks: this.getPendingCount(),
            runningTasks: this.pendingTasks.size,
        };
    }
    
    /**
     * Clear all pending tasks
     */
    clearAll() {
        this.highPriorityTasks = [];
        this.normalPriorityTasks = [];
        this.lowPriorityTasks = [];
        this.pendingTasks.clear();
    }
    
    /**
     * Destroy resources
     */
    destroy() {
        for (const readback of this.readbackBuffers) {
            readback.buffer.destroy();
        }
        this.readbackBuffers = [];
        this.clearAll();
        this.initialized = false;
    }
}

/**
 * ComputeWorkGroup - Helper for organizing related compute work
 */
export class ComputeWorkGroup {
    constructor(scheduler, name) {
        this.scheduler = scheduler;
        this.name = name;
        this.tasks = [];
    }
    
    /**
     * Add a task to this work group
     */
    addTask(config) {
        const taskId = this.scheduler.scheduleTask({
            ...config,
            name: `${this.name}/${config.name}`,
        });
        this.tasks.push(taskId);
        return taskId;
    }
    
    /**
     * Wait for all tasks in group to complete
     * @param {Function} callback 
     */
    onAllComplete(callback) {
        // Simple polling approach
        const checkComplete = () => {
            const allDone = this.tasks.every(id => 
                !this.scheduler.pendingTasks.has(id)
            );
            if (allDone) {
                callback();
            } else {
                requestAnimationFrame(checkComplete);
            }
        };
        checkComplete();
    }
}

export default AsyncComputeScheduler;
