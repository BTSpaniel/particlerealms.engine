// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TaskScheduler.js - Cooperative Task Scheduler for WebGPU Applications
 * 
 * Implements:
 * - Frame-budget-aware job execution
 * - Priority queues (Critical, High, Low)
 * - Idle time processing via requestIdleCallback
 * - Web Worker job dispatch with SharedArrayBuffer
 * - Double-buffered state for parallel simulation/rendering
 * 
 * Goal: Maximize CPU utilization while maintaining frame timing
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const TARGET_FPS = 60;
const FRAME_BUDGET_MS = 1000 / TARGET_FPS;           // ~16.67ms
const OVERHEAD_RESERVE_MS = 4;                        // Browser compositor overhead
const SOFT_DEADLINE_MS = FRAME_BUDGET_MS - OVERHEAD_RESERVE_MS;  // ~12.67ms
const HARD_DEADLINE_MS = FRAME_BUDGET_MS - 1;        // Emergency cutoff

// Job priorities
export const JobPriority = {
    CRITICAL: 0,   // Must run this frame (physics integration, command encoding)
    HIGH: 1,       // Should run this frame (AI, animation)
    NORMAL: 2,     // Can be deferred 1-2 frames
    LOW: 3,        // Background work (streaming, cleanup)
    IDLE: 4,       // Only during idle time
};

// Job states
const JobState = {
    PENDING: 0,
    RUNNING: 1,
    COMPLETED: 2,
    CANCELLED: 3,
    FAILED: 4,
};

// ============================================================================
// JOB CLASS
// ============================================================================

/**
 * Represents a unit of work
 */
export class Job {
    constructor(id, callback, priority = JobPriority.NORMAL, options = {}) {
        this.id = id;
        this.callback = callback;
        this.priority = priority;
        this.state = JobState.PENDING;
        
        // Options
        this.label = options.label || `Job:${id}`;
        this.estimatedMs = options.estimatedMs || 1;  // Estimated execution time
        this.maxRetries = options.maxRetries || 0;
        this.dependencies = options.dependencies || []; // Job IDs that must complete first
        this.data = options.data || null;              // Job-specific data
        
        // Execution tracking
        this.retryCount = 0;
        this.startTime = 0;
        this.endTime = 0;
        this.result = null;
        this.error = null;
        
        // Frame tracking
        this.submittedFrame = 0;
        this.completedFrame = 0;
    }
    
    /**
     * Execute the job
     * @returns {Promise<any>}
     */
    async execute() {
        this.state = JobState.RUNNING;
        this.startTime = performance.now();
        
        try {
            this.result = await this.callback(this.data);
            this.state = JobState.COMPLETED;
        } catch (err) {
            this.error = err;
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                this.state = JobState.PENDING;
                return this.execute();
            }
            this.state = JobState.FAILED;
        }
        
        this.endTime = performance.now();
        return this.result;
    }
    
    /**
     * Get execution duration
     */
    get duration() {
        if (this.endTime > 0 && this.startTime > 0) {
            return this.endTime - this.startTime;
        }
        return 0;
    }
    
    /**
     * Cancel the job
     */
    cancel() {
        if (this.state === JobState.PENDING) {
            this.state = JobState.CANCELLED;
        }
    }
}

// ============================================================================
// PRIORITY QUEUE
// ============================================================================

/**
 * Simple priority queue using binary heap
 */
class PriorityQueue {
    constructor() {
        this.heap = [];
    }
    
    /**
     * Add job to queue
     * @param {Job} job
     */
    push(job) {
        this.heap.push(job);
        this._bubbleUp(this.heap.length - 1);
    }
    
    /**
     * Remove and return highest priority job
     * @returns {Job|null}
     */
    pop() {
        if (this.heap.length === 0) return null;
        
        const top = this.heap[0];
        const last = this.heap.pop();
        
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this._bubbleDown(0);
        }
        
        return top;
    }
    
    /**
     * Peek at highest priority job without removing
     * @returns {Job|null}
     */
    peek() {
        return this.heap.length > 0 ? this.heap[0] : null;
    }
    
    /**
     * Check if empty
     */
    get isEmpty() {
        return this.heap.length === 0;
    }
    
    /**
     * Get queue size
     */
    get size() {
        return this.heap.length;
    }
    
    /**
     * Clear the queue
     */
    clear() {
        this.heap.length = 0;
    }
    
    _bubbleUp(index) {
        while (index > 0) {
            const parentIdx = Math.floor((index - 1) / 2);
            if (this._compare(this.heap[index], this.heap[parentIdx]) < 0) {
                this._swap(index, parentIdx);
                index = parentIdx;
            } else {
                break;
            }
        }
    }
    
    _bubbleDown(index) {
        const length = this.heap.length;
        
        while (true) {
            const leftIdx = 2 * index + 1;
            const rightIdx = 2 * index + 2;
            let smallest = index;
            
            if (leftIdx < length && this._compare(this.heap[leftIdx], this.heap[smallest]) < 0) {
                smallest = leftIdx;
            }
            if (rightIdx < length && this._compare(this.heap[rightIdx], this.heap[smallest]) < 0) {
                smallest = rightIdx;
            }
            
            if (smallest !== index) {
                this._swap(index, smallest);
                index = smallest;
            } else {
                break;
            }
        }
    }
    
    _compare(a, b) {
        // Lower priority number = higher priority
        // Secondary sort by submission order (id)
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        return a.id - b.id;
    }
    
    _swap(i, j) {
        const temp = this.heap[i];
        this.heap[i] = this.heap[j];
        this.heap[j] = temp;
    }
}

// ============================================================================
// WORKER POOL
// ============================================================================

/**
 * Pool of Web Workers for parallel job execution
 */
export class WorkerPool {
    constructor(workerScript, numWorkers = null, options = {}) {
        this.workerScript = workerScript;
        this.numWorkers = Math.max(1, numWorkers || Math.max(1, (globalThis.navigator?.hardwareConcurrency || 4) - 1));
        this.options = options;
        this.workers = [];
        this.available = [];
        this.pending = new Map();
        this.sharedBuffer = null;
        this.sharedView = null;
        this.jobsCompleted = 0;
        this.jobsFailed = 0;
        this.totalWorkerTime = 0;
        this._jobCounter = 0;
        this._epoch = 0;
        this._closed = false;
        this._ready = new Map();
        this._flushWaiters = new Set();
    }

    async init() {
        if (this._closed) throw this._error('WORKER_POOL_CLOSED', 'Worker pool is closed');
        if (this.workers.length) return;
        if (this.options.sharedMemory) {
            this.sharedBuffer = this.options.sharedMemory.buffer;
        } else if (this.options.autoSharedBuffer !== false && globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') {
            this.sharedBuffer = new SharedArrayBuffer(64 * 1024 * 1024);
        }
        if (this.sharedBuffer) this.sharedView = new Float32Array(this.sharedBuffer);
        try {
            await Promise.all(Array.from({ length: this.numWorkers }, (_, i) => this._createWorker(i)));
            this._processQueue();
        } catch (error) {
            this.terminate(error);
            throw error;
        }
    }

    _error(code, message) { return Object.assign(new Error(message), { code }); }

    async _createWorker(id) {
        const epoch = this._epoch;
        const data = typeof this.options.initData === 'function'
            ? await this.options.initData(id) : (this.options.initData || {});
        if (this._closed || epoch !== this._epoch) throw this._error('WORKER_POOL_CLOSED', 'Worker startup was revoked');
        const worker = new Worker(this.workerScript, { type: 'module' });
        this.workers[id] = worker;
        worker.onmessage = event => {
            if (this.workers[id] === worker && epoch === this._epoch && !this._closed) this._handleWorkerMessage(id, event);
        };
        worker.onerror = event => {
            event.preventDefault?.();
            if (this.workers[id] === worker && epoch === this._epoch && !this._closed) this._handleWorkerError(id, event);
        };
        worker.onmessageerror = () => {
            if (this.workers[id] === worker && epoch === this._epoch && !this._closed)
                this._handleWorkerError(id, { message: 'Worker reply could not be decoded' });
        };
        let ready;
        if (this.options.requireReady) {
            ready = new Promise((resolve, reject) => {
                const timer = setTimeout(() => this._handleWorkerError(id, { message: 'Worker initialization timed out' }), this.options.initTimeoutMs || 15000);
                this._ready.set(id, { resolve, reject, timer });
            });
        }
        try {
            worker.postMessage({ type: 'init', workerId: id, sharedBuffer: this.sharedBuffer, ...data });
        } catch (error) {
            this._handleWorkerError(id, error);
            if (!ready) throw error;
        }
        if (ready) await ready;
        else if (!this._closed && this.workers[id] === worker) this.available.push(id);
    }

    submit(taskType, data, transfer = [], options = {}) {
        if (this._closed) return Promise.reject(this._error('WORKER_POOL_CLOSED', 'Worker pool is closed'));
        if (this.pending.size >= (this.options.maxPending ?? Infinity)) return Promise.reject(this._error('WORKER_QUEUE_FULL', 'Worker queue limit exceeded'));
        const jobId = String(++this._jobCounter);
        return new Promise((resolve, reject) => {
            const task = { taskType, data, transfer, resolve, reject, workerId: -1, startTime: 0, timer: null };
            this.pending.set(jobId, task);
            if (options.timeoutMs > 0) task.timer = setTimeout(() => {
                const current = this.pending.get(jobId);
                if (!current) return;
                if (current.workerId >= 0) this._handleWorkerError(current.workerId, this._error('WORKER_TIMEOUT', 'Worker job timed out'));
                else this._settle(jobId, null, this._error('WORKER_TIMEOUT', 'Queued worker job timed out'));
            }, options.timeoutMs);
            this._processQueue();
        });
    }

    _settle(jobId, result, error = null) {
        const task = this.pending.get(jobId);
        if (!task) return;
        this.pending.delete(jobId);
        clearTimeout(task.timer);
        if (error) { this.jobsFailed++; task.reject(error); }
        else { this.jobsCompleted++; task.resolve(result); }
        if (!this.pending.size) {
            for (const resolve of this._flushWaiters) resolve();
            this._flushWaiters.clear();
        }
    }

    _handleWorkerMessage(workerId, event) {
        const { type, jobId, result, error } = event.data || {};
        if (type === 'ready' || type === 'init-error') {
            const waiter = this._ready.get(workerId);
            if (!waiter) return;
            if (error || type === 'init-error') { this._handleWorkerError(workerId, error || { message: 'Worker initialization failed' }); return; }
            clearTimeout(waiter.timer);
            this._ready.delete(workerId);
            if (!this.available.includes(workerId)) this.available.push(workerId);
            waiter.resolve();
            this._processQueue();
            return;
        }
        if (type !== 'result') return;
        const task = this.pending.get(jobId);
        // A stale or forged reply cannot settle another worker's reservation.
        if (!task || task.workerId !== workerId) return;
        this.totalWorkerTime += performance.now() - task.startTime;
        if (!this.available.includes(workerId)) this.available.push(workerId);
        const failure = error ? this._error(error.code || 'WORKER_JOB_FAILED', error.message || String(error)) : null;
        this._settle(jobId, result, failure);
        this._processQueue();
    }

    _handleWorkerError(workerId, event) {
        if (this._closed) return;
        const failure = this._error(event.code || 'WORKER_CRASHED', event.message || 'Worker crashed');
        this.workers[workerId]?.terminate();
        this.workers[workerId] = null;
        this.available = this.available.filter(id => id !== workerId);
        const waiter = this._ready.get(workerId);
        if (waiter) { clearTimeout(waiter.timer); this._ready.delete(workerId); waiter.reject(failure); }
        for (const [jobId, task] of this.pending) if (task.workerId === workerId) this._settle(jobId, null, failure);
        this.options.onError?.(failure, workerId);
        // Shared heaps may be left inconsistent by a trap. Their owner opts out
        // of replacement and retires the complete group instead.
        if (!waiter && this.options.restartOnError !== false) {
            this._createWorker(workerId).then(() => this._processQueue(), error => this.terminate(error));
        } else if (!waiter) this.terminate(failure);
    }

    _processQueue() {
        if (this._closed) return;
        for (const [jobId, task] of this.pending) {
            if (task.workerId !== -1 || !this.available.length) continue;
            const workerId = this.available.shift();
            const worker = this.workers[workerId];
            if (!worker) continue;
            task.workerId = workerId;
            task.startTime = performance.now();
            try { worker.postMessage({ type: 'job', jobId, taskType: task.taskType, data: task.data }, task.transfer || []); }
            catch (error) { this._handleWorkerError(workerId, error); }
        }
    }

    getSharedView() { return this.sharedView; }
    flush() { return this.pending.size ? new Promise(resolve => this._flushWaiters.add(resolve)) : Promise.resolve(); }
    getStats() {
        return { numWorkers: this.workers.filter(Boolean).length, available: this.available.length,
            pending: this.pending.size, jobsCompleted: this.jobsCompleted, jobsFailed: this.jobsFailed,
            avgJobTime: this.jobsCompleted ? (this.totalWorkerTime / this.jobsCompleted).toFixed(2) : 0,
            sharedMemoryEnabled: this.sharedBuffer !== null };
    }
    terminate(reason = null) {
        if (this._closed) return;
        this._closed = true;
        this._epoch++;
        const error = reason || this._error('WORKER_POOL_CLOSED', 'Worker pool terminated');
        for (const worker of this.workers) worker?.terminate();
        for (const waiter of this._ready.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
        this._ready.clear();
        for (const jobId of this.pending.keys()) this._settle(jobId, null, error);
        this.workers.length = 0;
        this.available.length = 0;
        this.sharedBuffer = null;
        this.sharedView = null;
    }
}

// ============================================================================
// TASK SCHEDULER
// ============================================================================

/**
 * Main task scheduler with frame budget management
 */
export class TaskScheduler {
    constructor() {
        // Job queues by priority
        this.queues = {
            [JobPriority.CRITICAL]: new PriorityQueue(),
            [JobPriority.HIGH]: new PriorityQueue(),
            [JobPriority.NORMAL]: new PriorityQueue(),
            [JobPriority.LOW]: new PriorityQueue(),
            [JobPriority.IDLE]: new PriorityQueue(),
        };
        
        // Completed jobs (for dependency tracking)
        this.completed = new Set();
        
        // Job counter
        this.nextJobId = 0;
        
        // Frame state
        this.frameCount = 0;
        this.frameStartTime = 0;
        this.frameEndTime = 0;
        this.isProcessing = false;
        
        // Worker pool
        this.workerPool = null;
        
        // Stats
        this.stats = {
            jobsSubmitted: 0,
            jobsCompleted: 0,
            jobsFailed: 0,
            jobsDeferred: 0,
            totalJobTime: 0,
            frameOverruns: 0,
            idleTimeUsed: 0,
        };
        
        // Idle callback handle
        this.idleCallbackId = null;
        
        // Registered systems (for ordered updates)
        this.systems = new Map();
        this.systemOrder = [];
    }
    
    /**
     * Initialize scheduler with optional worker pool
     * @param {string} workerScript - Worker script URL (optional)
     */
    async init(workerScript = null) {
        if (workerScript) {
            this.workerPool = new WorkerPool(workerScript);
            await this.workerPool.init();
        }
        
        // Start idle processing
        this._scheduleIdleWork();
        
        console.log('[TaskScheduler] Initialized');
    }
    
    /**
     * Register a system for ordered updates
     * @param {string} name
     * @param {Object} system - Object with update(dt) method
     * @param {number} order - Execution order (lower = earlier)
     */
    registerSystem(name, system, order = 100) {
        this.systems.set(name, { system, order });
        this.systemOrder = [...this.systems.entries()]
            .sort((a, b) => a[1].order - b[1].order)
            .map(([name]) => name);
    }
    
    /**
     * Unregister a system
     * @param {string} name
     */
    unregisterSystem(name) {
        this.systems.delete(name);
        this.systemOrder = [...this.systems.entries()]
            .sort((a, b) => a[1].order - b[1].order)
            .map(([name]) => name);
    }
    
    /**
     * Submit a job
     * @param {Function} callback
     * @param {number} priority
     * @param {Object} options
     * @returns {Job}
     */
    submit(callback, priority = JobPriority.NORMAL, options = {}) {
        const job = new Job(this.nextJobId++, callback, priority, options);
        job.submittedFrame = this.frameCount;
        
        this.queues[priority].push(job);
        this.stats.jobsSubmitted++;
        
        return job;
    }
    
    /**
     * Submit critical job (must run this frame)
     */
    submitCritical(callback, options = {}) {
        return this.submit(callback, JobPriority.CRITICAL, options);
    }
    
    /**
     * Submit high priority job
     */
    submitHigh(callback, options = {}) {
        return this.submit(callback, JobPriority.HIGH, options);
    }
    
    /**
     * Submit low priority job
     */
    submitLow(callback, options = {}) {
        return this.submit(callback, JobPriority.LOW, options);
    }
    
    /**
     * Submit idle job (only runs during idle time)
     */
    submitIdle(callback, options = {}) {
        return this.submit(callback, JobPriority.IDLE, options);
    }
    
    /**
     * Submit job to worker pool
     * @param {string} taskType
     * @param {any} data
     * @param {Transferable[]} transfer
     * @returns {Promise<any>}
     */
    submitToWorker(taskType, data, transfer = []) {
        if (!this.workerPool) {
            return Promise.reject(new Error('Worker pool not initialized'));
        }
        return this.workerPool.submit(taskType, data, transfer);
    }
    
    /**
     * Begin frame processing
     */
    beginFrame() {
        this.frameCount++;
        this.frameStartTime = performance.now();
        this.isProcessing = true;
        
        // Clear old completed jobs
        if (this.completed.size > 10000) {
            this.completed.clear();
        }
    }
    
    /**
     * Process jobs within frame budget
     * @returns {{ jobsRun: number, timeUsed: number, overrun: boolean }}
     */
    processJobs() {
        let jobsRun = 0;
        let timeUsed = 0;
        const softDeadline = this.frameStartTime + SOFT_DEADLINE_MS;
        const hardDeadline = this.frameStartTime + HARD_DEADLINE_MS;
        
        // Process CRITICAL jobs (always run)
        while (!this.queues[JobPriority.CRITICAL].isEmpty) {
            const job = this.queues[JobPriority.CRITICAL].pop();
            if (this._canRunJob(job)) {
                this._executeJob(job);
                jobsRun++;
            }
        }
        
        // Check time after critical jobs
        let now = performance.now();
        if (now >= hardDeadline) {
            this.stats.frameOverruns++;
            return { jobsRun, timeUsed: now - this.frameStartTime, overrun: true };
        }
        
        // Process HIGH priority jobs if time permits
        while (!this.queues[JobPriority.HIGH].isEmpty && performance.now() < softDeadline) {
            const job = this.queues[JobPriority.HIGH].pop();
            if (this._canRunJob(job)) {
                this._executeJob(job);
                jobsRun++;
            }
        }
        
        // Process NORMAL priority jobs if more time
        while (!this.queues[JobPriority.NORMAL].isEmpty && performance.now() < softDeadline) {
            const job = this.queues[JobPriority.NORMAL].pop();
            if (this._canRunJob(job)) {
                this._executeJob(job);
                jobsRun++;
            }
        }
        
        now = performance.now();
        timeUsed = now - this.frameStartTime;
        
        return { jobsRun, timeUsed, overrun: timeUsed > FRAME_BUDGET_MS };
    }
    
    /**
     * Update registered systems in order
     * @param {number} dt - Delta time in seconds
     */
    updateSystems(dt) {
        for (const name of this.systemOrder) {
            const { system } = this.systems.get(name);
            try {
                system.update(dt);
            } catch (err) {
                console.error(`[TaskScheduler] System "${name}" update failed:`, err);
            }
        }
    }
    
    /**
     * End frame processing
     */
    endFrame() {
        this.frameEndTime = performance.now();
        this.isProcessing = false;
        
        // Defer remaining HIGH/NORMAL jobs if too many frames old
        this._deferOldJobs();
    }
    
    /**
     * Check if job dependencies are satisfied
     */
    _canRunJob(job) {
        if (job.state !== JobState.PENDING) return false;
        
        for (const depId of job.dependencies) {
            if (!this.completed.has(depId)) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * Execute a job synchronously
     */
    _executeJob(job) {
        job.state = JobState.RUNNING;
        job.startTime = performance.now();
        
        try {
            job.result = job.callback(job.data);
            job.state = JobState.COMPLETED;
            job.completedFrame = this.frameCount;
            this.completed.add(job.id);
            this.stats.jobsCompleted++;
        } catch (err) {
            job.error = err;
            job.state = JobState.FAILED;
            this.stats.jobsFailed++;
            console.error(`[TaskScheduler] Job ${job.label} failed:`, err);
        }
        
        job.endTime = performance.now();
        this.stats.totalJobTime += job.duration;
    }
    
    /**
     * Defer old jobs that missed their frame
     */
    _deferOldJobs() {
        const maxAge = 3; // Max frames to wait
        
        for (const priority of [JobPriority.HIGH, JobPriority.NORMAL]) {
            const queue = this.queues[priority];
            const toRequeue = [];
            
            while (!queue.isEmpty) {
                const job = queue.pop();
                if (this.frameCount - job.submittedFrame > maxAge) {
                    // Job is too old - demote priority
                    job.priority = Math.min(job.priority + 1, JobPriority.LOW);
                    this.stats.jobsDeferred++;
                }
                toRequeue.push(job);
            }
            
            // Requeue jobs
            for (const job of toRequeue) {
                this.queues[job.priority].push(job);
            }
        }
    }
    
    /**
     * Schedule idle work processing
     */
    _scheduleIdleWork() {
        if (typeof requestIdleCallback !== 'undefined') {
            this.idleCallbackId = requestIdleCallback(
                (deadline) => this._processIdleWork(deadline),
                { timeout: 100 }
            );
        } else {
            // Fallback: use setTimeout with low priority
            setTimeout(() => this._processIdleWorkFallback(), 100);
        }
    }
    
    /**
     * Process idle work
     */
    _processIdleWork(deadline) {
        const startTime = performance.now();
        
        // Process LOW priority jobs
        while (deadline.timeRemaining() > 1 && !this.queues[JobPriority.LOW].isEmpty) {
            const job = this.queues[JobPriority.LOW].pop();
            if (this._canRunJob(job)) {
                this._executeJob(job);
            }
        }
        
        // Process IDLE jobs
        while (deadline.timeRemaining() > 1 && !this.queues[JobPriority.IDLE].isEmpty) {
            const job = this.queues[JobPriority.IDLE].pop();
            if (this._canRunJob(job)) {
                this._executeJob(job);
            }
        }
        
        this.stats.idleTimeUsed += performance.now() - startTime;
        
        // Schedule next idle callback
        this._scheduleIdleWork();
    }
    
    /**
     * Fallback idle processing for browsers without requestIdleCallback
     */
    _processIdleWorkFallback() {
        const budget = 5; // 5ms budget
        const deadline = performance.now() + budget;
        
        while (performance.now() < deadline) {
            let job = this.queues[JobPriority.LOW].pop();
            if (!job) job = this.queues[JobPriority.IDLE].pop();
            if (!job) break;
            
            if (this._canRunJob(job)) {
                this._executeJob(job);
            }
        }
        
        // Schedule next
        setTimeout(() => this._processIdleWorkFallback(), 100);
    }
    
    /**
     * Get time remaining in frame budget
     * @returns {number} Milliseconds remaining
     */
    getTimeRemaining() {
        if (!this.isProcessing) return SOFT_DEADLINE_MS;
        return Math.max(0, SOFT_DEADLINE_MS - (performance.now() - this.frameStartTime));
    }
    
    /**
     * Check if we're over budget
     * @returns {boolean}
     */
    isOverBudget() {
        return this.getTimeRemaining() <= 0;
    }
    
    /**
     * Get queue sizes
     */
    getQueueSizes() {
        return {
            critical: this.queues[JobPriority.CRITICAL].size,
            high: this.queues[JobPriority.HIGH].size,
            normal: this.queues[JobPriority.NORMAL].size,
            low: this.queues[JobPriority.LOW].size,
            idle: this.queues[JobPriority.IDLE].size,
        };
    }
    
    /**
     * Get comprehensive statistics
     */
    getStats() {
        const queueSizes = this.getQueueSizes();
        const avgJobTime = this.stats.jobsCompleted > 0
            ? (this.stats.totalJobTime / this.stats.jobsCompleted).toFixed(2)
            : 0;
        
        return {
            frameCount: this.frameCount,
            ...this.stats,
            avgJobTimeMs: avgJobTime,
            queueSizes,
            workerPool: this.workerPool?.getStats(),
            systemCount: this.systems.size,
        };
    }
    
    /**
     * Log status report
     */
    logReport() {
        const stats = this.getStats();
        console.group('[TaskScheduler] Status Report');
        console.log(`Frame: ${stats.frameCount}`);
        console.log(`Jobs: ${stats.jobsCompleted} completed, ${stats.jobsFailed} failed, ${stats.jobsDeferred} deferred`);
        console.log(`Avg job time: ${stats.avgJobTimeMs}ms`);
        console.log(`Frame overruns: ${stats.frameOverruns}`);
        console.log(`Idle time used: ${stats.idleTimeUsed.toFixed(1)}ms`);
        console.log('Queue sizes:', stats.queueSizes);
        if (stats.workerPool) {
            console.log('Worker pool:', stats.workerPool);
        }
        console.groupEnd();
    }
    
    /**
     * Clear all queues
     */
    clearAll() {
        for (const queue of Object.values(this.queues)) {
            queue.clear();
        }
        this.completed.clear();
    }
    
    /**
     * Shutdown scheduler
     */
    shutdown() {
        if (this.idleCallbackId && typeof cancelIdleCallback !== 'undefined') {
            cancelIdleCallback(this.idleCallbackId);
        }
        
        this.workerPool?.terminate();
        this.clearAll();
        
        console.log('[TaskScheduler] Shutdown complete');
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const scheduler = new TaskScheduler();

// ============================================================================
// WORKER TEMPLATE
// ============================================================================

/**
 * Template for worker script. Export this and use with URL.createObjectURL.
 */
export const workerTemplate = `
// Worker script for TaskScheduler
let workerId = -1;
let sharedBuffer = null;
let sharedView = null;

// Task handlers
const taskHandlers = new Map();

// Register a task handler
self.registerTask = (type, handler) => {
    taskHandlers.set(type, handler);
};

// Message handler
self.onmessage = async (e) => {
    const { type, jobId, taskType, data, workerId: wid, sharedBuffer: sb } = e.data;
    
    if (type === 'init') {
        workerId = wid;
        if (sb) {
            sharedBuffer = sb;
            sharedView = new Float32Array(sharedBuffer);
        }
        console.log('[Worker ' + workerId + '] Initialized');
        return;
    }
    
    if (type === 'job') {
        const handler = taskHandlers.get(taskType);
        
        if (!handler) {
            self.postMessage({
                type: 'result',
                jobId,
                error: 'Unknown task type: ' + taskType,
            });
            return;
        }
        
        try {
            const result = await handler(data, sharedView);
            self.postMessage({
                type: 'result',
                jobId,
                result,
            });
        } catch (err) {
            self.postMessage({
                type: 'result',
                jobId,
                error: err.message,
            });
        }
    }
};

// Example task registration
self.registerTask('echo', (data) => data);
`;

export default TaskScheduler;
