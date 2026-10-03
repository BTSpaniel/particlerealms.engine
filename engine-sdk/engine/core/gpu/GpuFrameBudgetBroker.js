// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Dependency-safe frame admission for long compute submissions.
 *
 * The broker never reorders command buffers. Callers await admission, then
 * submit immediately to the one WebGPU queue, preserving queue dependencies.
 * Render-critical work bypasses the budget; interactive/background compute is
 * spread across animation frames so a long producer cannot monopolize the GPU.
 */
export class GpuFrameBudgetBroker {
    constructor({
        device,
        computeBudgetMs = 12,
        fallbackFrameMs = 16,
        maxInFlightSubmissions = 0,
        frameGapLimitMs = 25,
        conservativeRecoveryFrames = 8,
    } = {}) {
        if (!device?.queue) throw new Error('GpuFrameBudgetBroker requires a GPUDevice');
        this.device = device;
        this.queue = device.queue;
        this.computeBudgetMs = Math.max(1, Number(computeBudgetMs) || 12);
        this.fallbackFrameMs = Math.max(1, Number(fallbackFrameMs) || 16);
        this.maxInFlightSubmissions = normalizeInFlightLimit(maxInFlightSubmissions);
        this.frameGapLimitMs = Math.max(this.fallbackFrameMs, Number(frameGapLimitMs) || 25);
        this.conservativeRecoveryFrames = Math.max(1, Math.floor(Number(conservativeRecoveryFrames) || 8));
        this._frameStartedAt = nowMs();
        this._lastObservedFrameAt = 0;
        this._admittedMs = 0;
        this._framePromise = null;
        this._frameWait = null;
        this._timerWaits = new Set();
        this._conservativeFramesRemaining = 0;
        this._submitTail = Promise.resolve();
        this._inFlight = [];
        this._destroyed = false;
        this._lifecycleEpoch = 0;
        this._cancelLifecycle = null;
        this._lifecycleCancellation = new Promise(resolve => { this._cancelLifecycle = resolve; });
        this._stats = {
            admissions: 0,
            deferred: 0,
            submissions: 0,
            commandBuffers: 0,
            admittedEstimateMs: 0,
            lastWorkClass: '',
            backpressureWaits: 0,
            backpressureWaitMs: 0,
            maxBackpressureWaitMs: 0,
            trackedCompletions: 0,
            completions: 0,
            completionErrors: 0,
            peakInFlightSubmissions: 0,
            lastMaxInFlightSubmissions: 0,
            lastCompletionError: '',
            observedFrames: 0,
            lastObservedFrameGapMs: 0,
            maxObservedFrameGapMs: 0,
            frameOverloadEvents: 0,
            conservativeAdmissions: 0,
            checkpoints: 0,
            checkpointBytes: 0,
            checkpointQueueWaits: 0,
            checkpointQueueWaitMs: 0,
            maxCheckpointQueueWaitMs: 0,
            checkpointYieldMs: 0,
            maxCheckpointYieldMs: 0,
            byWorkClass: {},
        };
    }

    async beforeSubmit({
        workClass = 'background',
        estimatedGpuMs = 4,
        conservativeEstimatedGpuMs = estimatedGpuMs,
        frameGapLimitMs = this.frameGapLimitMs,
        conservativeRecoveryFrames = this.conservativeRecoveryFrames,
        signal = null,
    } = {}) {
        throwIfAborted(signal);
        const lifecycleEpoch = this._lifecycleEpoch;
        this._assertLifecycle(lifecycleEpoch);
        const baseCost = Math.max(0.1, Number(estimatedGpuMs) || 4);
        const conservativeCost = Math.max(baseCost, Number(conservativeEstimatedGpuMs) || baseCost);
        const conservative = this._conservativeFramesRemaining > 0;
        const cost = conservative ? conservativeCost : baseCost;
        const bypass = workClass === 'render-critical' || !hasVisibleAnimationFrame();
        const workStats = this._workClassStats(workClass);
        if (!bypass && this._admittedMs > 0 && this._admittedMs + cost > this.computeBudgetMs) {
            this._stats.deferred++;
            workStats.deferred++;
            await this._nextFrame(
                signal,
                { frameGapLimitMs, conservativeRecoveryFrames },
                lifecycleEpoch,
            );
            this._assertLifecycle(lifecycleEpoch);
        }
        this._assertLifecycle(lifecycleEpoch);
        this._admittedMs += cost;
        this._stats.admissions++;
        this._stats.admittedEstimateMs += cost;
        this._stats.lastWorkClass = String(workClass);
        workStats.admissions++;
        workStats.admittedEstimateMs += cost;
        if (conservative) {
            this._stats.conservativeAdmissions++;
            workStats.conservativeAdmissions++;
        }
        if (!bypass) {
            this._armFrameEpoch(
                { frameGapLimitMs, conservativeRecoveryFrames },
                lifecycleEpoch,
            );
        }
        this._assertLifecycle(lifecycleEpoch);
    }

    async submit(commandBuffers, options = {}) {
        const buffers = Array.isArray(commandBuffers) ? commandBuffers.filter(Boolean) : [];
        if (!buffers.length) return null;
        const previous = this._submitTail;
        const lifecycleEpoch = this._lifecycleEpoch;
        this._assertLifecycle(lifecycleEpoch);
        let releaseSubmit = () => {};
        this._submitTail = new Promise(resolve => { releaseSubmit = resolve; });
        try {
            await previous;
            this._assertLifecycle(lifecycleEpoch);
            throwIfAborted(options.signal);
            this._assertLifecycle(lifecycleEpoch);
            const maxInFlight = normalizeInFlightLimit(
                options.maxInFlightSubmissions ?? this.maxInFlightSubmissions,
            );
            this._stats.lastMaxInFlightSubmissions = maxInFlight;
            await this._waitForCapacity(maxInFlight, options.signal, lifecycleEpoch);
            this._assertLifecycle(lifecycleEpoch);
            await this.beforeSubmit(options);
            this._assertLifecycle(lifecycleEpoch);
            const beforeQueueSubmit = options.beforeQueueSubmit;
            const afterQueueSubmit = options.afterQueueSubmit;
            let queueHookActive = false;
            try {
                if (typeof beforeQueueSubmit === 'function') {
                    this._assertLifecycle(lifecycleEpoch);
                    beforeQueueSubmit();
                    queueHookActive = true;
                    this._assertLifecycle(lifecycleEpoch);
                }
                const queueSubmit = this.queue.submit;
                this._assertLifecycle(lifecycleEpoch);
                queueSubmit.call(this.queue, buffers);
            } finally {
                // Paired diagnostics hooks must close in this same stack turn.
                // Awaiting submit() before closing a device-global error scope
                // would allow another producer to pop the wrong LIFO entry.
                if (queueHookActive && typeof afterQueueSubmit === 'function') {
                    afterQueueSubmit();
                }
            }
            this._assertLifecycle(lifecycleEpoch);
            this._stats.submissions++;
            this._stats.commandBuffers += buffers.length;
            // Return an object so the async method does not assimilate the GPU
            // completion promise and accidentally serialize every submission.
            return {
                completion: maxInFlight > 0 ? this._trackSubmittedCompletion(lifecycleEpoch) : null,
            };
        } finally {
            releaseSubmit();
        }
    }

    /**
     * Bound queue lead created outside submit(), such as GPUQueue.writeBuffer,
     * then give the compositor a paint opportunity before more work is issued.
     */
    async checkpoint({
        workClass = 'background',
        byteLength = 0,
        waitForQueue = false,
        frameGapLimitMs = this.frameGapLimitMs,
        conservativeRecoveryFrames = this.conservativeRecoveryFrames,
        signal = null,
    } = {}) {
        throwIfAborted(signal);
        const lifecycleEpoch = this._lifecycleEpoch;
        this._assertLifecycle(lifecycleEpoch);
        const workStats = this._workClassStats(workClass);
        const bytes = Math.max(0, Number(byteLength) || 0);
        if (waitForQueue) {
            const onSubmittedWorkDone = this.queue.onSubmittedWorkDone;
            this._assertLifecycle(lifecycleEpoch);
            if (typeof onSubmittedWorkDone === 'function') {
                const queueStartedAt = nowMs();
                const queueCompletion = onSubmittedWorkDone.call(this.queue);
                this._assertLifecycle(lifecycleEpoch);
                this._stats.checkpointQueueWaits++;
                workStats.checkpointQueueWaits++;
                await this._waitForLifecycle(queueCompletion, signal, lifecycleEpoch);
                this._assertLifecycle(lifecycleEpoch);
                const queueWaitMs = Math.max(0, nowMs() - queueStartedAt);
                this._stats.checkpointQueueWaitMs += queueWaitMs;
                this._stats.maxCheckpointQueueWaitMs = Math.max(this._stats.maxCheckpointQueueWaitMs, queueWaitMs);
                workStats.checkpointQueueWaitMs += queueWaitMs;
                workStats.maxCheckpointQueueWaitMs = Math.max(workStats.maxCheckpointQueueWaitMs, queueWaitMs);
            }
        }
        const yieldStartedAt = nowMs();
        if (hasVisibleAnimationFrame()) {
            await this._nextFrame(
                signal,
                { frameGapLimitMs, conservativeRecoveryFrames },
                lifecycleEpoch,
            );
            this._assertLifecycle(lifecycleEpoch);
        } else {
            await this._waitForTimer(0, signal, lifecycleEpoch);
            this._assertLifecycle(lifecycleEpoch);
        }
        this._assertLifecycle(lifecycleEpoch);
        const yieldMs = Math.max(0, nowMs() - yieldStartedAt);
        this._stats.checkpoints++;
        this._stats.checkpointBytes += bytes;
        this._stats.checkpointYieldMs += yieldMs;
        this._stats.maxCheckpointYieldMs = Math.max(this._stats.maxCheckpointYieldMs, yieldMs);
        workStats.checkpoints++;
        workStats.checkpointBytes += bytes;
        workStats.checkpointYieldMs += yieldMs;
        workStats.maxCheckpointYieldMs = Math.max(workStats.maxCheckpointYieldMs, yieldMs);
    }

    snapshot() {
        return {
            ...this._stats,
            computeBudgetMs: this.computeBudgetMs,
            maxInFlightSubmissions: this.maxInFlightSubmissions,
            inFlightSubmissions: this._inFlight.length,
            frameStartedAt: this._frameStartedAt,
            frameAdmittedMs: this._admittedMs,
            conservativeFramesRemaining: this._conservativeFramesRemaining,
            frameGapLimitMs: this.frameGapLimitMs,
            conservativeRecoveryFrames: this.conservativeRecoveryFrames,
            byWorkClass: cloneWorkClassStats(this._stats.byWorkClass),
        };
    }

    configure({ computeBudgetMs, maxInFlightSubmissions } = {}) {
        if (Number.isFinite(Number(computeBudgetMs))) {
            this.computeBudgetMs = Math.max(1, Number(computeBudgetMs));
        }
        if (maxInFlightSubmissions != null) {
            this.maxInFlightSubmissions = normalizeInFlightLimit(maxInFlightSubmissions);
        }
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._lifecycleEpoch++;
        this._cancelLifecycle?.();
        this._cancelLifecycle = null;
        this._cancelFrameEpoch();
        for (const wait of [...this._timerWaits]) wait.cancel();
        this._timerWaits.clear();
        this._inFlight.length = 0;
    }

    async _waitForCapacity(maxInFlight, signal, lifecycleEpoch = this._lifecycleEpoch) {
        this._assertLifecycle(lifecycleEpoch);
        if (maxInFlight <= 0) return;
        let startedAt = 0;
        while (this._inFlight.length >= maxInFlight) {
            throwIfAborted(signal);
            this._assertLifecycle(lifecycleEpoch);
            const oldest = this._inFlight[0];
            if (!oldest) break;
            if (!startedAt) {
                startedAt = nowMs();
                this._stats.backpressureWaits++;
            }
            await this._waitForLifecycle(oldest.completion, signal, lifecycleEpoch);
            this._assertLifecycle(lifecycleEpoch);
        }
        this._assertLifecycle(lifecycleEpoch);
        if (startedAt) {
            const elapsedMs = Math.max(0, nowMs() - startedAt);
            this._stats.backpressureWaitMs += elapsedMs;
            this._stats.maxBackpressureWaitMs = Math.max(this._stats.maxBackpressureWaitMs, elapsedMs);
        }
    }

    _trackSubmittedCompletion(lifecycleEpoch = this._lifecycleEpoch) {
        if (typeof this.queue.onSubmittedWorkDone !== 'function') return null;
        const entry = { completion: null };
        let completion;
        try {
            completion = Promise.resolve(this.queue.onSubmittedWorkDone());
        } catch (error) {
            this._stats.completionErrors++;
            this._stats.lastCompletionError = error?.message ?? String(error);
            return null;
        }
        const removeEntry = () => {
            const index = this._inFlight.indexOf(entry);
            if (index >= 0) this._inFlight.splice(index, 1);
        };
        entry.completion = Promise.race([completion, this._lifecycleCancellation]).then(
            () => {
                if (!this._destroyed && lifecycleEpoch === this._lifecycleEpoch) {
                    this._stats.completions++;
                }
                removeEntry();
            },
            error => {
                if (!this._destroyed && lifecycleEpoch === this._lifecycleEpoch) {
                    this._stats.completionErrors++;
                    this._stats.lastCompletionError = error?.message ?? String(error);
                }
                removeEntry();
            },
        );
        this._inFlight.push(entry);
        this._stats.trackedCompletions++;
        this._stats.peakInFlightSubmissions = Math.max(
            this._stats.peakInFlightSubmissions,
            this._inFlight.length,
        );
        return entry.completion;
    }

    _workClassStats(workClass) {
        const key = String(workClass || 'background');
        if (!this._stats.byWorkClass[key]) {
            this._stats.byWorkClass[key] = {
                admissions: 0,
                deferred: 0,
                admittedEstimateMs: 0,
                conservativeAdmissions: 0,
                checkpoints: 0,
                checkpointBytes: 0,
                checkpointQueueWaits: 0,
                checkpointQueueWaitMs: 0,
                maxCheckpointQueueWaitMs: 0,
                checkpointYieldMs: 0,
                maxCheckpointYieldMs: 0,
            };
        }
        return this._stats.byWorkClass[key];
    }

    _armFrameEpoch(options = {}, lifecycleEpoch = this._lifecycleEpoch) {
        this._assertLifecycle(lifecycleEpoch);
        if (!this._framePromise) {
            const armedAt = nowMs();
            const wait = {
                lifecycleEpoch,
                promise: null,
                resolve: null,
                rafHandle: null,
                timerHandle: null,
                settled: false,
                settle: null,
            };
            wait.promise = new Promise(resolve => { wait.resolve = resolve; });
            wait.settle = observed => {
                if (wait.settled) return;
                wait.settled = true;
                if (this._frameWait === wait) {
                    this._frameWait = null;
                    this._framePromise = null;
                }
                if (observed && !this._destroyed && lifecycleEpoch === this._lifecycleEpoch) {
                    const observedAt = nowMs();
                    const gapMs = Math.max(0, observedAt - armedAt);
                    this._lastObservedFrameAt = observedAt;
                    this._frameStartedAt = observedAt;
                    this._admittedMs = 0;
                    this._framePromise = null;
                    this._stats.observedFrames++;
                    this._stats.lastObservedFrameGapMs = gapMs;
                    this._stats.maxObservedFrameGapMs = Math.max(this._stats.maxObservedFrameGapMs, gapMs);
                    const gapLimit = Math.max(
                        this.fallbackFrameMs,
                        Number(options.frameGapLimitMs) || this.frameGapLimitMs,
                    );
                    if (gapMs > gapLimit) {
                        this._conservativeFramesRemaining = Math.max(
                            1,
                            Math.floor(Number(options.conservativeRecoveryFrames) || this.conservativeRecoveryFrames),
                        );
                        this._stats.frameOverloadEvents++;
                    } else if (gapMs > 0 && this._conservativeFramesRemaining > 0) {
                        this._conservativeFramesRemaining--;
                    }
                }
                wait.resolve();
            };
            this._frameWait = wait;
            this._framePromise = wait.promise;
            if (typeof globalThis.requestAnimationFrame === 'function') {
                wait.rafHandle = globalThis.requestAnimationFrame(() => {
                    wait.rafHandle = null;
                    if (wait.settled) return;
                    wait.timerHandle = setTimeout(() => {
                        wait.timerHandle = null;
                        wait.settle(true);
                    }, 0);
                });
            } else {
                wait.timerHandle = setTimeout(() => {
                    wait.timerHandle = null;
                    wait.settle(true);
                }, this.fallbackFrameMs);
            }
        }
        return this._framePromise;
    }

    async _nextFrame(signal, options = {}, lifecycleEpoch = this._lifecycleEpoch) {
        this._assertLifecycle(lifecycleEpoch);
        const framePromise = this._armFrameEpoch(options, lifecycleEpoch);
        await waitWithAbort(framePromise, signal);
        this._assertLifecycle(lifecycleEpoch);
    }

    async _waitForLifecycle(promise, signal, lifecycleEpoch = this._lifecycleEpoch) {
        this._assertLifecycle(lifecycleEpoch);
        await waitWithAbort(
            Promise.race([Promise.resolve(promise), this._lifecycleCancellation]),
            signal,
        );
        this._assertLifecycle(lifecycleEpoch);
    }

    async _waitForTimer(delayMs, signal, lifecycleEpoch = this._lifecycleEpoch) {
        this._assertLifecycle(lifecycleEpoch);
        let timerHandle = null;
        let settled = false;
        let resolveWait = () => {};
        const promise = new Promise(resolve => { resolveWait = resolve; });
        const wait = {
            cancel: () => {
                if (settled) return;
                settled = true;
                if (timerHandle != null) clearTimeout(timerHandle);
                timerHandle = null;
                resolveWait();
            },
        };
        this._timerWaits.add(wait);
        timerHandle = setTimeout(wait.cancel, Math.max(0, Number(delayMs) || 0));
        try {
            await waitWithAbort(promise, signal);
            this._assertLifecycle(lifecycleEpoch);
        } finally {
            wait.cancel();
            this._timerWaits.delete(wait);
        }
    }

    _cancelFrameEpoch() {
        const wait = this._frameWait;
        if (!wait) {
            this._framePromise = null;
            return;
        }
        if (wait.rafHandle != null && typeof globalThis.cancelAnimationFrame === 'function') {
            globalThis.cancelAnimationFrame(wait.rafHandle);
        }
        if (wait.timerHandle != null) clearTimeout(wait.timerHandle);
        wait.rafHandle = null;
        wait.timerHandle = null;
        wait.settle(false);
    }

    _assertLifecycle(lifecycleEpoch) {
        if (this._destroyed || lifecycleEpoch !== this._lifecycleEpoch) {
            throw new Error('GpuFrameBudgetBroker is destroyed');
        }
    }
}

function cloneWorkClassStats(stats) {
    return Object.fromEntries(Object.entries(stats ?? {}).map(([key, value]) => [key, { ...value }]));
}

function hasVisibleAnimationFrame() {
    return typeof globalThis.requestAnimationFrame === 'function'
        && globalThis.document?.visibilityState !== 'hidden';
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function normalizeInFlightLimit(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.max(1, Math.min(64, Math.floor(number)));
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error(String(signal.reason || 'GPU work cancelled'));
    error.name = 'AbortError';
    throw error;
}

async function waitWithAbort(promise, signal) {
    if (!signal) return promise;
    throwIfAborted(signal);
    let remove = () => {};
    const aborted = new Promise((_, reject) => {
        const onAbort = () => {
            const error = new Error(String(signal.reason || 'GPU work cancelled'));
            error.name = 'AbortError';
            reject(error);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        remove = () => signal.removeEventListener('abort', onAbort);
    });
    try {
        return await Promise.race([promise, aborted]);
    } finally {
        remove();
    }
}

export default GpuFrameBudgetBroker;
