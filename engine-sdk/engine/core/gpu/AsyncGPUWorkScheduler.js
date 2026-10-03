// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const GPU_JOB_TIERS = new Set(['D0', 'D1', 'D2', 'D3']);
const MAX_RETAINED_FENCES = 2_048;

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function safeError(error) {
    return Object.freeze({
        name: String(error?.name ?? 'Error').slice(0, 96),
        message: String(error?.message ?? error ?? 'GPU work failed').slice(0, 2_048),
    });
}

/**
 * Public, read-only completion authority for one submitted GPU job.
 * Completion is signalled by queue.onSubmittedWorkDone(), never by synchronous
 * per-frame readback. The simulation tick is caller-authored and survives every
 * state projection so consumers can reject late results deterministically.
 */
export class GPUWorkFence {
    constructor({ jobId, tick, label, determinismTier, enqueuedAt }) {
        this.jobId = jobId;
        this.tick = tick;
        this.label = label;
        this.determinismTier = determinismTier;
        this.enqueuedAt = enqueuedAt;
        this.batchId = null;
        this.submittedAt = null;
        this.completedAt = null;
        this.state = 'pending';
        this.result = null;
        this.error = null;
        this._settled = false;
        this._promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
        // A caller may only inspect snapshots and never await. Keep a failed GPU
        // submission from becoming an unrelated unhandled-rejection event.
        this._promise.catch(() => {});
    }

    wait() { return this._promise; }

    snapshot() {
        return Object.freeze({
            jobId: this.jobId,
            tick: this.tick,
            label: this.label,
            determinismTier: this.determinismTier,
            state: this.state,
            batchId: this.batchId,
            enqueuedAt: this.enqueuedAt,
            submittedAt: this.submittedAt,
            completedAt: this.completedAt,
            result: this.result,
            error: this.error,
        });
    }

    _submitted(batchId, submittedAt) {
        if (this._settled || this.state !== 'pending') return;
        this.batchId = batchId;
        this.submittedAt = submittedAt;
        this.state = 'submitted';
    }

    _complete(result, completedAt) {
        if (this._settled) return;
        this._settled = true;
        this.completedAt = completedAt;
        this.state = 'completed';
        this.result = Object.freeze({ ...result });
        this._resolve(this.result);
    }

    _fail(error, completedAt, state = 'failed') {
        if (this._settled) return;
        this._settled = true;
        this.completedAt = completedAt;
        this.state = state;
        this.error = safeError(error);
        const failure = new Error(this.error.message);
        failure.name = this.error.name;
        failure.code = state === 'cancelled' ? 'GPU_JOB_CANCELLED' : 'GPU_JOB_FAILED';
        failure.jobId = this.jobId;
        this._reject(failure);
    }
}

/**
 * Async GPU Work Scheduler - ordered queue batching plus public job/fence state.
 * Priority controls submission urgency only; queue execution order is preserved.
 */

export class AsyncGPUWorkScheduler {
    constructor(device) {
        this.device = device;
        this.queue = device.queue;
        this.pendingWork = [];
        this.isSubmitting = false;
        this.submitScheduled = false;
        this.minBatchSize = 1;
        this.maxBatchWaitMs = 0; // Submit immediately by default
        this.destroyed = false;
        this._jobSequence = 0;
        this._batchSequence = 0;
        this._fences = new Map();
        this._retiredFenceIds = [];
        this._lifecycleGeneration = 0;
        this._inFlightBatches = new Map();
        
        this.stats = {
            totalSubmissions: 0,
            totalCommandBuffers: 0,
            avgBatchSize: 0,
            gpuUtilization: 0,
            completedJobs: 0,
            failedJobs: 0,
            cancelledJobs: 0,
        };
    }

    /**
     * Schedule GPU work for batched submission
     * @param {GPUCommandBuffer} commandBuffer - Encoded GPU commands
     * @param {number} priority - 0=low, 1=normal, 2=high, 3=critical
     */
    schedule(commandBuffer, priority = 1) {
        return this.scheduleJob(commandBuffer, { priority });
    }

    /**
     * Schedule one GPU job and return its stable completion fence.
     * @param {GPUCommandBuffer} commandBuffer
     * @param {{priority?:number,tick?:number,label?:string,determinismTier?:string,publish?:(result:object)=>void|Promise<void>}} options
     */
    scheduleJob(commandBuffer, {
        priority = 1,
        tick = 0,
        label = 'gpu-work',
        determinismTier = 'D2',
        publish = null,
    } = {}) {
        if (this.destroyed) throw new Error('GPU work scheduler is destroyed');
        if (!commandBuffer || (typeof commandBuffer !== 'object' && typeof commandBuffer !== 'function')) {
            throw new TypeError('GPU work requires a command buffer');
        }
        if (!Number.isInteger(priority) || priority < 0 || priority > 3) {
            throw new RangeError('GPU job priority must be an integer from 0 through 3');
        }
        if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('GPU job tick must be a non-negative safe integer');
        const normalizedLabel = String(label).trim();
        if (!normalizedLabel || normalizedLabel.length > 160) throw new RangeError('GPU job label must contain 1 to 160 characters');
        if (!GPU_JOB_TIERS.has(determinismTier)) throw new TypeError('GPU job determinismTier must be D0, D1, D2, or D3');
        if (publish != null && typeof publish !== 'function') throw new TypeError('GPU job publish hook must be a function or null');

        const jobId = `gpu-job-${(++this._jobSequence).toString(36).padStart(8, '0')}`;
        const enqueuedAt = now();
        const fence = new GPUWorkFence({ jobId, tick, label: normalizedLabel, determinismTier, enqueuedAt });
        this._fences.set(jobId, fence);
        // Preserve enqueue order. Reordering command buffers from unrelated
        // producers can violate implicit queue dependencies between copies,
        // compute passes, and rendering. Priority controls submission urgency,
        // never execution order.
        this.pendingWork.push({ commandBuffer, priority, timestamp: enqueuedAt, publish, fence });
        
        // Schedule submission
        if (!this.submitScheduled) {
            this.submitScheduled = true;
            
            if (priority >= 3) {
                // Critical work - submit immediately
                this._submitBatch();
            } else if (this.maxBatchWaitMs === 0) {
                // Zero wait - submit next microtask
                Promise.resolve().then(() => this._submitBatch());
            } else {
                // Wait for batch to build
                setTimeout(() => this._submitBatch(), this.maxBatchWaitMs);
            }
        }
        return fence;
    }

    /**
     * Submit all pending work to GPU
     */
    _submitBatch() {
        if (this.destroyed) {
            this.submitScheduled = false;
            return;
        }
        if (this.isSubmitting || this.pendingWork.length === 0) {
            this.submitScheduled = false;
            return;
        }
        
        this.isSubmitting = true;
        this.submitScheduled = false;
        
        const batch = this.pendingWork;
        const commandBuffers = batch.map(work => work.commandBuffer);
        this.pendingWork = [];
        const batchId = `gpu-batch-${(++this._batchSequence).toString(36).padStart(8, '0')}`;
        const submittedAt = now();
        batch.forEach(work => work.fence._submitted(batchId, submittedAt));

        const startTime = now();
        try {
            this.queue.submit(commandBuffers);
        } catch (error) {
            const failedAt = now();
            batch.forEach(work => this._failWork(work, error, failedAt));
            this.isSubmitting = false;
            this._scheduleAccumulatedWork();
            return;
        }
        const submitTime = now() - startTime;
        
        this.stats.totalSubmissions++;
        this.stats.totalCommandBuffers += commandBuffers.length;
        this.stats.avgBatchSize = this.stats.totalCommandBuffers / this.stats.totalSubmissions;
        
        if (submitTime > 5) {
            console.log(`[GPUScheduler] Submitted ${commandBuffers.length} buffers in ${submitTime.toFixed(2)}ms`);
        }
        
        this.isSubmitting = false;
        const batchRecord = Object.freeze({
            batch,
            batchId,
            lifecycleGeneration: this._lifecycleGeneration,
        });
        this._inFlightBatches.set(batchId, batchRecord);
        this._observeBatchCompletion(batchRecord);
        this._scheduleAccumulatedWork();
    }

    _scheduleAccumulatedWork() {
        if (this.pendingWork.length > 0 && !this.submitScheduled && !this.destroyed) {
            this.submitScheduled = true;
            Promise.resolve().then(() => this._submitBatch());
        }
    }

    _observeBatchCompletion(record) {
        const { batch, batchId, lifecycleGeneration } = record;
        const isCurrent = () => !this.destroyed
            && lifecycleGeneration === this._lifecycleGeneration
            && this._inFlightBatches.get(batchId) === record;
        let completion;
        try {
            completion = typeof this.queue.onSubmittedWorkDone === 'function'
                ? this.queue.onSubmittedWorkDone()
                : Promise.resolve();
        } catch (error) {
            completion = Promise.reject(error);
        }
        Promise.resolve(completion).then(async () => {
            if (!isCurrent()) return;
            for (const work of batch) {
                if (work.fence._settled) continue;
                if (!isCurrent()) {
                    this._cancelWork(work, 'GPU work scheduler retired before publication');
                    continue;
                }
                const completedAt = now();
                const result = Object.freeze({
                    jobId: work.fence.jobId,
                    batchId,
                    tick: work.fence.tick,
                    label: work.fence.label,
                    determinismTier: work.fence.determinismTier,
                    submittedAt: work.fence.submittedAt,
                    completedAt,
                    durationMs: Math.max(0, completedAt - work.fence.enqueuedAt),
                });
                try {
                    if (work.publish) await work.publish(result);
                    if (!isCurrent()) {
                        this._cancelWork(work, 'GPU work scheduler retired during publication');
                        continue;
                    }
                    work.fence._complete(result, completedAt);
                    this.stats.completedJobs += 1;
                    this._retireFence(work.fence.jobId);
                } catch (error) {
                    this._failWork(work, error, completedAt);
                }
            }
        }).catch(error => {
            if (!isCurrent()) return;
            const failedAt = now();
            batch.forEach(work => this._failWork(work, error, failedAt));
        }).finally(() => {
            if (this._inFlightBatches.get(batchId) === record) {
                this._inFlightBatches.delete(batchId);
            }
        });
    }

    _cancelWork(work, reason) {
        if (work.fence._settled) return;
        work.fence._fail(new Error(String(reason)), now(), 'cancelled');
        this.stats.cancelledJobs += 1;
        this._retireFence(work.fence.jobId);
    }

    _failWork(work, error, completedAt) {
        if (work.fence._settled) return;
        work.fence._fail(error, completedAt);
        this.stats.failedJobs += 1;
        this._retireFence(work.fence.jobId);
    }

    _retireFence(jobId) {
        this._retiredFenceIds.push(jobId);
        while (this._retiredFenceIds.length > MAX_RETAINED_FENCES) {
            this._fences.delete(this._retiredFenceIds.shift());
        }
    }

    getFence(jobId) {
        return this._fences.get(String(jobId)) ?? null;
    }

    cancel(jobId, reason = 'GPU job cancelled before submission') {
        const id = String(jobId);
        const index = this.pendingWork.findIndex(work => work.fence.jobId === id);
        if (index < 0) return false;
        const [work] = this.pendingWork.splice(index, 1);
        this._cancelWork(work, reason);
        return true;
    }

    /**
     * Force immediate submission of all pending work
     */
    flush() {
        if (this.pendingWork.length > 0) {
            this._submitBatch();
        }
    }

    /**
     * Configure batching behavior
     */
    configure(options = {}) {
        if (typeof options.minBatchSize === 'number') {
            this.minBatchSize = Math.max(1, options.minBatchSize);
        }
        if (typeof options.maxBatchWaitMs === 'number') {
            this.maxBatchWaitMs = Math.max(0, options.maxBatchWaitMs);
        }
    }

    getStats() {
        return {
            ...this.stats,
            pendingWork: this.pendingWork.length,
            retainedFences: this._fences.size,
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._lifecycleGeneration++;
        const pending = this.pendingWork.splice(0);
        for (const work of pending) {
            this._cancelWork(work, 'GPU work scheduler destroyed before submission');
        }
        for (const record of this._inFlightBatches.values()) {
            for (const work of record.batch) {
                this._cancelWork(work, 'GPU work scheduler destroyed before completion');
            }
        }
        this._inFlightBatches.clear();
        this.isSubmitting = false;
        this.submitScheduled = false;
    }
}

/**
 * GPU Frame Coordinator - Coordinates GPU work across frame boundaries
 * Implements triple-buffering and proper synchronization
 */
export class GPUFrameCoordinator {
    constructor(device) {
        this.device = device;
        this.scheduler = new AsyncGPUWorkScheduler(device);
        this.frameIndex = 0;
        this.framesInFlight = 3; // Triple buffering
        this.frameResources = [];
        
        for (let i = 0; i < this.framesInFlight; i++) {
            this.frameResources.push({
                commandBuffers: [],
                fence: null,
            });
        }
    }

    /**
     * Begin a new frame
     * Returns frame index for resource management
     */
    beginFrame() {
        const currentFrame = this.frameIndex % this.framesInFlight;
        this.frameIndex++;
        
        // Clear previous frame's command buffers
        this.frameResources[currentFrame].commandBuffers = [];
        
        return currentFrame;
    }

    /**
     * Submit work for current frame
     */
    submitFrameWork(frameIndex, commandBuffer, priority = 1) {
        const frame = this.frameResources[frameIndex % this.framesInFlight];
        frame.commandBuffers.push(commandBuffer);
        const fence = this.scheduler.scheduleJob(commandBuffer, { priority, tick: this.frameIndex, label: `frame-${frameIndex}` });
        frame.fence = fence;
        return fence;
    }

    /**
     * End frame and ensure GPU work is submitted
     */
    endFrame(frameIndex) {
        // Ensure all work for this frame is submitted
        this.scheduler.flush();
        return this.frameResources[frameIndex % this.framesInFlight].fence;
    }

    getStats() {
        return {
            ...this.scheduler.getStats(),
            framesInFlight: this.framesInFlight,
            currentFrame: this.frameIndex,
        };
    }
}
