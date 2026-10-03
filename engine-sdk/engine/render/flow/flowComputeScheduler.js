// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { GpuFrameBudgetBroker } from '../../core/gpu/GpuFrameBudgetBroker.js';
import { GPUTimestampProfiler } from '../../core/gpu/GPUTimestampProfiler.js';
import { FlowTextureLeasePool } from './flowTextureLeasePool.js';

const now = () => globalThis.performance?.now?.() ?? Date.now();

/** Optional submission adapter for the installed native Flow graph.
 *
 * Give `device` to the native solver, then await `run(() => solver.step(dt))`.
 * Only commands synchronously encoded inside that callback are partitioned.
 * Complete compute passes and their ordered copies retain the original GPU
 * operations; the shared broker admits those buffers between host frames.
 * Ordinary query encoders remain immediate, including submit -> mapAsync.
 *
 * This borrows the real device and all native resources. Dispose the native
 * solver before this adapter. Individual passes remain indivisible; the cost
 * estimate controls admission, not shader execution time or simulation dt.
 * `readbackTailBudget` opts into a caller-measured small native readback plus
 * profiler-copy estimate. It is not a portable GPU execution-time bound.
 * All other unlabelled copies retain the ordinary conservative estimate.
 */
export class FlowComputeScheduler {
    constructor(device, { computeBudgetMs = 4, estimatedPassGpuMs = 4, maxInFlightSubmissions = 2, texturePool = false, readbackTailBudget = false } = {}) {
        if (!device?.queue || typeof device.createCommandEncoder !== 'function')
            throw new TypeError('Flow compute scheduling requires a borrowed GPU device');
        if (![computeBudgetMs, estimatedPassGpuMs].every(value => Number.isFinite(value) && value > 0)
            || !Number.isSafeInteger(maxInFlightSubmissions) || maxInFlightSubmissions < 1)
            throw new RangeError('Flow compute scheduling needs positive budgets and an in-flight bound');
        if (texturePool !== false && texturePool !== true && (!texturePool || typeof texturePool !== 'object'))
            throw new TypeError('Flow texture pool must be disabled, enabled, or configured with lease bounds');
        if (readbackTailBudget !== false) {
            if (!readbackTailBudget || typeof readbackTailBudget !== 'object' || Array.isArray(readbackTailBudget))
                throw new TypeError('Readback tail budgeting requires an explicit configuration or false');
            const { maxCopyBytes, maxTimingBytes, estimatedGpuMs } = readbackTailBudget;
            if (![maxCopyBytes, maxTimingBytes].every(value => Number.isSafeInteger(value) && value > 0)
                || !Number.isFinite(estimatedGpuMs) || estimatedGpuMs <= 0)
                throw new RangeError('Readback tail budgeting requires positive byte bounds and a finite positive estimate');
            readbackTailBudget = Object.freeze({ maxCopyBytes, maxTimingBytes, estimatedGpuMs });
        }
        this._readbackTailBudget = readbackTailBudget;
        this._realDevice = device; this._realQueue = device.queue;
        this._estimatedPassGpuMs = estimatedPassGpuMs;
        this._texturePool = texturePool ? new FlowTextureLeasePool(device, { ...(texturePool === true ? {} : texturePool),
            retirementFence: () => this._activeRun ?? this._drain() }) : null;
        this._broker = new GpuFrameBudgetBroker({ device, computeBudgetMs, maxInFlightSubmissions,
            fallbackFrameMs: 1000 / 120, frameGapLimitMs: 1000 / 120 * 1.5 });
        this._profiler = new GPUTimestampProfiler(device, { maxQueries: 4096, maxPendingReads: 2 });
        this._passCosts = new Map(); this._timingReads = 0; this._timingByteLengths = []; this._timingBytes = 0;
        this._pipelineIds = new WeakMap(); this._nextPipelineId = 1;
        this._packets = new WeakMap(); this._tail = Promise.resolve(); this._lastDrainedTail = null;
        this._capturing = false; this._running = false; this._closing = false; this._disposed = false;
        this._activeRun = null; this._disposal = null; this._fault = null;
        this._stats = { runs: 0, completedRuns: 0, failedRuns: 0, capturedEncoders: 0,
            capturedPasses: 0, queuedCommandBuffers: 0, submittedCommandBuffers: 0,
            pendingCommandBuffers: 0, peakPendingCommandBuffers: 0, immediateSubmissions: 0,
            unsplitCapturedBuffers: 0, measuredPasses: 0, lastGpuPassMs: null, maximumGpuPassMs: null,
            startupMeasuredPasses: 0, startupFenceWallMs: 0, startupReusedPasses: 0,
            readbackTailEligibleBuffers: 0, readbackTailSubmittedBuffers: 0, readbackTailEstimatedGpuMs: 0,
            lastRunWallMs: 0, timingFailure: null };
        const queueMethods = new Map(), deviceMethods = new Map();
        const queue = new Proxy(device.queue, { get: (target, key) => {
            if (key === 'submit') return buffers => this._submit(buffers);
            if (key === 'onSubmittedWorkDone') return () => this._drain();
            const value = Reflect.get(target, key, target);
            if (typeof value !== 'function') return value;
            if (!queueMethods.has(key)) queueMethods.set(key, (...args) => {
                // The installed graph flushes every distinct upload slice
                // before its one submit. A future write after deferred work
                // would otherwise overtake that work on the physical queue.
                if (['writeBuffer', 'writeTexture', 'copyExternalImageToTexture'].includes(key)
                    && this._stats.pendingCommandBuffers)
                    throw new Error('Await captured Flow submissions before writing their borrowed queue');
                if (['writeTexture', 'copyExternalImageToTexture'].includes(key) && this._texturePool?.hasPendingClears)
                    throw new Error('Encode the reused Flow texture clear before a direct texture upload');
                return value.apply(target, args);
            });
            return queueMethods.get(key);
        } });
        this.device = new Proxy(device, { get: (target, key) => {
            if (key === 'queue') return queue;
            if (key === 'createCommandEncoder') return descriptor => this._capturing
                ? this._encoder(descriptor) : target.createCommandEncoder(descriptor);
            if (key === 'createTexture' && this._texturePool) return descriptor => this._texturePool.acquire(descriptor, this._capturing);
            if (key === 'destroy') return () => { throw new Error('Flow compute scheduling does not own the borrowed device'); };
            const value = Reflect.get(target, key, target);
            if (typeof value !== 'function') return value;
            if (!deviceMethods.has(key)) deviceMethods.set(key, value.bind(target));
            return deviceMethods.get(key);
        } });
    }

    get stats() {
        return { ...this._stats, running: this._running, disposed: this._disposed,
            failure: this._fault?.message ?? null, estimatedPassGpuMs: this._estimatedPassGpuMs,
            timestampQueries: this._profiler.enabled, passCosts: Object.fromEntries(this._passCosts),
            readbackTailBudget: this._readbackTailBudget ? { ...this._readbackTailBudget } : false,
            timestampBufferBytes: this._timestampBytes, timestampQuerySlots: this._disposed || !this._profiler.enabled ? 0 : this._profiler.maxQueries,
            texturePool: this._texturePool?.stats ?? null,
            broker: this._broker.snapshot() };
    }

    /** Native allocatedBytes owns active leases; count only retained idle/retiring
     * textures here. Query-set implementation storage remains opaque. */
    get _timestampBytes() { return this._disposed ? 0 : (this._profiler.resolveBuffer?.size ?? 0) + this._timingBytes; }
    get bytes() { return this._disposed ? 0 : this._timestampBytes + (this._texturePool?.retainedBytes ?? 0); }

    run(callback) {
        if (this._closing || this._disposed || this._fault) throw new Error('Flow compute scheduler is closed or failed');
        if (this._running) throw new Error('Await the preceding Flow compute run; nested capture is not supported');
        if (typeof callback !== 'function') throw new TypeError('Flow compute run requires a callback');
        this._running = true;
        const pending = this._run(callback); this._activeRun = pending;
        pending.catch(() => {});
        return pending;
    }

    async _run(callback) {
        const started = now(); ++this._stats.runs;
        let result, failure;
        try { if (this._texturePool) await this._texturePool.prepare(); }
        catch (error) { failure = error; }
        if (!failure) {
            this._capturing = true;
            try {
                this._profiler.beginFrame(); result = callback();
                if (this._texturePool?.hasPendingClears) this._submit([]);
            } catch (error) { failure = error; }
            finally { this._capturing = false; }
        }
        try {
            if (!failure) result = await result;
        } catch (error) { failure = error; }
        // A failed callback must not let native ownership retire before the
        // already scheduled part of its graph has reached the real GPU fence.
        try { if (this._lastDrainedTail !== this._tail) await this._drain(); }
        catch (error) { failure ??= error; }
        if (!failure) await this._readTimings();
        this._stats.lastRunWallMs = Math.max(0, now() - started);
        this._running = false; this._activeRun = null;
        if (failure) {
            this._fault ??= failure; ++this._stats.failedRuns; throw failure;
        }
        ++this._stats.completedRuns;
        return result;
    }

    _encoder(descriptor = {}) {
        const chunks = [], owner = this;
        let encoder = this._realDevice.createCommandEncoder(descriptor), dirty = false, inPass = false, finished = false;
        let trailingOperations = 0, trailingCopyBytes = null, callerQueries = false;
        let preparingClears = false, precedingNativeCompute = false;
        ++this._stats.capturedEncoders;
        const ready = () => {
            if (finished) throw new Error('Captured Flow encoder is already finished');
            if (inPass) throw new Error('End the captured Flow compute pass before encoding another command');
            return encoder ??= owner._realDevice.createCommandEncoder(descriptor);
        };
        const complete = (finishDescriptor, passLabel = null, startupKey = null, readbackTail = null) => {
            if (dirty) {
                const chunk = { buffer: encoder.finish(finishDescriptor), passLabel, startupKey };
                if (readbackTail) chunk.readbackTail = readbackTail;
                chunks.push(chunk);
                trailingOperations = 0; trailingCopyBytes = null;
                encoder = null; dirty = false;
            }
        };
        // The installed addon uses these copies and compute passes only. Do
        // not silently forward future encoder operations across a split.
        const wrapper = {};
        const prepared = () => {
            ready();
            if (owner._texturePool?.hasPendingClears) {
                preparingClears = true;
                try { owner._texturePool.encodePendingClears(wrapper); }
                finally { preparingClears = false; }
            }
            return ready();
        };
        for (const method of ['copyBufferToBuffer', 'copyBufferToTexture', 'copyTextureToBuffer', 'copyTextureToTexture', 'clearBuffer', 'resolveQuerySet']) {
            wrapper[method] = (...args) => {
                const target = prepared(); target[method](...args); dirty = true;
                if (owner._readbackTailBudget) {
                    ++trailingOperations; trailingCopyBytes = null;
                    if (method === 'resolveQuerySet') callerQueries = true;
                    if (method === 'copyBufferToBuffer' && trailingOperations === 1 && args.length === 5) {
                        const [src, srcOffset, dst, dstOffset, bytes] = args;
                        if (src !== dst && Number.isSafeInteger(bytes) && bytes > 0 && bytes % 4 === 0
                            && bytes <= owner._readbackTailBudget.maxCopyBytes
                            && [srcOffset, dstOffset].every(value => Number.isSafeInteger(value) && value >= 0 && value % 4 === 0)
                            && Number.isSafeInteger(src.size) && Number.isSafeInteger(dst.size)
                            && srcOffset <= src.size - bytes && dstOffset <= dst.size - bytes
                            && (src.usage & GPUBufferUsage.COPY_SRC)
                            && dst.usage === (GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST))
                            trailingCopyBytes = bytes;
                    }
                }
            };
        }
        wrapper.beginComputePass = passDescriptor => {
            const target = prepared(), label = passDescriptor?.label ?? 'Unnamed Flow compute pass';
            const nativeCompute = !preparingClears;
            if (passDescriptor?.timestampWrites) callerQueries = true;
            const timing = passDescriptor?.timestampWrites ? null : owner._profiler.beginPass(target, label);
            const pass = target.beginComputePass(timing ? { ...passDescriptor, timestampWrites: timing.timestampWrites } : passDescriptor);
            dirty = true; inPass = true;
            let ended = false, startupKey = owner._passCosts.has(label) ? null : label, directDispatch = false;
            const methods = new Map();
            return new Proxy(pass, { get: (target, key) => {
                if (key === 'end') return () => {
                    if (ended) throw new Error('Captured Flow compute pass is already ended');
                    target.end(); ended = true; inPass = false;
                    ++owner._stats.capturedPasses;
                    complete(undefined, label, directDispatch ? startupKey : null);
                    precedingNativeCompute = nativeCompute;
                };
                const value = Reflect.get(target, key, target);
                if (typeof value !== 'function') return value;
                if (!methods.has(key)) methods.set(key, (...args) => {
                    if (ended) throw new Error('Captured Flow compute pass is already ended');
                    if (key === 'setPipeline' && startupKey !== null) {
                        if (!owner._pipelineIds.has(args[0])) owner._pipelineIds.set(args[0], owner._nextPipelineId++);
                        startupKey += `:p${owner._pipelineIds.get(args[0])}`;
                    } else if (key === 'dispatchWorkgroups' && startupKey !== null) {
                        startupKey += `:d${args[0]},${args[1] ?? 1},${args[2] ?? 1}`; directDispatch = true;
                    } else if (key === 'dispatchWorkgroupsIndirect') startupKey = null;
                    return value.apply(target, args);
                });
                return methods.get(key);
            } });
        };
        wrapper.finish = finishDescriptor => {
            if (finished || inPass) throw new Error('Captured Flow encoder must finish once, outside a compute pass');
            if (owner._texturePool?.hasPendingClears) {
                preparingClears = true;
                try { owner._texturePool.encodePendingClears(wrapper); }
                finally { preparingClears = false; }
            }
            let readbackTail = null;
            const timingBytes = owner._profiler.queryCount * 8;
            if (owner._profiler.enabled && owner._profiler.resolveAndRead(ready())) {
                dirty = true; ++owner._timingReads;
                owner._timingByteLengths.push(timingBytes); owner._timingBytes += timingBytes;
                const budget = owner._readbackTailBudget;
                if (budget && !callerQueries && precedingNativeCompute && chunks.at(-1)?.passLabel != null
                    && trailingOperations === 1 && trailingCopyBytes !== null
                    && timingBytes > 0 && timingBytes <= budget.maxTimingBytes) {
                    readbackTail = { estimatedGpuMs: budget.estimatedGpuMs, copyBytes: trailingCopyBytes, timingBytes };
                    ++owner._stats.readbackTailEligibleBuffers;
                }
            }
            complete(finishDescriptor, null, null, readbackTail);
            if (!chunks.length) chunks.push({ buffer: encoder.finish(finishDescriptor), passLabel: null });
            finished = true;
            const packet = Object.freeze({ label: finishDescriptor?.label ?? descriptor?.label ?? 'Captured Flow graph' });
            owner._packets.set(packet, chunks);
            return packet;
        };
        return wrapper;
    }

    _submit(commandBuffers) {
        if (this._disposed) throw new Error('Flow compute scheduler is disposed');
        const buffers = Array.from(commandBuffers);
        // A native encoder retained from initialization may be a real encoder,
        // without operation wrappers. Prefix its new leases' zero commands at
        // submit; prior leases have already completed their retirement fence.
        if (this._texturePool?.hasPendingClears) {
            const clear = this._encoder({ label: 'Initialize reused native Flow textures' });
            buffers.unshift(clear.finish());
        }
        const captured = buffers.some(buffer => this._packets.has(buffer));
        if (!captured && !this._capturing) {
            if (this._stats.pendingCommandBuffers) throw new Error('Await captured Flow work before an immediate query submission');
            this._realQueue.submit(buffers); ++this._stats.immediateSubmissions;
            return;
        }
        if (this._fault) throw this._fault;
        const chunks = buffers.flatMap(buffer => {
            const packet = this._packets.get(buffer);
            if (!packet) { ++this._stats.unsplitCapturedBuffers; return [{ buffer, passLabel: null }]; }
            this._packets.delete(buffer); return packet;
        });
        this._stats.queuedCommandBuffers += chunks.length;
        this._stats.pendingCommandBuffers += chunks.length;
        this._stats.peakPendingCommandBuffers = Math.max(this._stats.peakPendingCommandBuffers, this._stats.pendingCommandBuffers);
        // The first native graph repeats kernels before its final timestamp
        // resolve is readable. Fence each unseen pipeline/dispatch shape once, using
        // its entire queue-completion wall time as a conservative provisional
        // cost. Later occurrences can share the normal budget immediately.
        // GPU timestamps replace these packet-local estimates after the run;
        // copies and indirect dispatches retain their conservative admission.
        this._tail = this._tail.then(async () => {
            const provisional = new Map(), budgetMs = this._broker.computeBudgetMs;
            const cost = chunk => chunk.passLabel === null ? chunk.readbackTail?.estimatedGpuMs
                : this._passCosts.get(chunk.passLabel) ?? provisional.get(chunk.startupKey);
            for (let index = 0; index < chunks.length;) {
                if (this._fault) throw this._fault;
                const first = chunks[index++], firstCost = cost(first), buffers = [first.buffer];
                let estimatedGpuMs = firstCost ?? this._estimatedPassGpuMs;
                let readbackTails = first.readbackTail ? 1 : 0;
                if (provisional.has(first.startupKey)) ++this._stats.startupReusedPasses;
                if (firstCost !== undefined) while (index < chunks.length) {
                    const next = chunks[index], nextCost = cost(next);
                    if (nextCost === undefined || estimatedGpuMs + nextCost > budgetMs) break;
                    buffers.push(next.buffer); estimatedGpuMs += nextCost; ++index;
                    if (next.readbackTail) ++readbackTails;
                    if (provisional.has(next.startupKey)) ++this._stats.startupReusedPasses;
                }
                let submittedAt;
                await this._broker.submit(buffers, { workClass: 'native-flow', estimatedGpuMs,
                    beforeQueueSubmit: () => { submittedAt = now(); } });
                this._stats.submittedCommandBuffers += buffers.length;
                this._stats.readbackTailSubmittedBuffers += readbackTails;
                this._stats.readbackTailEstimatedGpuMs += readbackTails * (this._readbackTailBudget?.estimatedGpuMs ?? 0);
                if (firstCost === undefined && first.startupKey != null) {
                    await this._realQueue.onSubmittedWorkDone();
                    const elapsed = now() - submittedAt;
                    if (Number.isFinite(elapsed) && elapsed >= 0) {
                        provisional.set(first.startupKey, Math.max(.1, elapsed * 1.25));
                        ++this._stats.startupMeasuredPasses; this._stats.startupFenceWallMs += elapsed;
                    }
                }
            }
        }).catch(error => { this._fault ??= error; throw error; })
            .finally(() => { this._stats.pendingCommandBuffers -= chunks.length; });
        this._tail.catch(() => {});
    }

    async _drain() {
        if (this._texturePool?.hasPendingClears) this._submit([]);
        const tail = this._tail;
        let failure;
        try { await tail; } catch (error) { failure = error; }
        // Broker cancellation/failure is not GPU completion. Still fence all
        // physically submitted commands before allowing resource destruction.
        try { await this._realQueue.onSubmittedWorkDone(); }
        catch (error) { failure ??= error; }
        this._lastDrainedTail = tail;
        if (failure) throw failure;
    }

    async _readTimings() {
        const maxima = new Map();
        while (this._timingReads > 0) {
            --this._timingReads;
            const bytes = this._timingByteLengths.shift();
            try {
                const detailed = await this._profiler.readResults();
                for (const { passName, durationMs } of detailed.passes) {
                    if (!Number.isFinite(durationMs) || durationMs < 0) continue;
                    maxima.set(passName, Math.max(maxima.get(passName) ?? 0, durationMs));
                    ++this._stats.measuredPasses; this._stats.lastGpuPassMs = durationMs;
                    this._stats.maximumGpuPassMs = Math.max(this._stats.maximumGpuPassMs ?? 0, durationMs);
                }
            } catch (error) {
                // Timing is observational. An unavailable read keeps the
                // conservative admission estimate and never changes the graph.
                this._stats.timingFailure = error.message;
            } finally { this._timingBytes -= bytes; }
        }
        for (const [name, maximumMs] of maxima) {
            // Apply the broker's submission overhead once per packed batch,
            // not once per tiny pass. A 0.1 ms floor on every pass turns an
            // otherwise short native graph into several frames of idle waits.
            // Keep a 1 us timestamp floor and the measured 25% safety margin.
            const measured = Math.max(.001, maximumMs * 1.25);
            const preceding = this._passCosts.get(name);
            this._passCosts.set(name, preceding === undefined ? measured : Math.max(measured, preceding * .95));
        }
    }

    dispose() {
        if (this._capturing) throw new Error('Dispose Flow compute scheduling after its native callback returns');
        if (this._disposal) return this._disposal;
        this._closing = true;
        this._disposal = (async () => {
            let failure;
            try { await this._activeRun; } catch (error) { failure = error; }
            try { await this._drain(); } catch (error) { failure ??= error; }
            finally {
                try { await this._texturePool?.dispose(); } catch (error) { failure ??= error; }
                this._profiler.destroy(); this._timingByteLengths.length = 0; this._timingReads = this._timingBytes = 0;
                this._broker.destroy(); this._disposed = true;
            }
            if (failure) throw failure;
        })();
        this._disposal.catch(() => {});
        return this._disposal;
    }
}
