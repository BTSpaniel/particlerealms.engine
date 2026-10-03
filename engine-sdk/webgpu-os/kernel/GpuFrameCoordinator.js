// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const DEFAULT_CPU_BUDGET_MS = 8;
const DEFAULT_PRODUCER_CPU_BUDGET_MS = 3;
const MAX_HISTORY = 60;
const MAX_ID_LENGTH = 160;
const DEFAULT_MAX_PRODUCERS = 512;
const DEFAULT_MAX_PRODUCERS_PER_OWNER = 32;
const DEFAULT_MAX_RETIRED_TELEMETRY = 256;

const coordinatorByDevice = new WeakMap();
const producerTelemetrySources = new WeakMap();
const readProducerTelemetrySource = Function.prototype.call.bind(WeakMap.prototype.get);
const retainProducerTelemetrySource = Function.prototype.call.bind(WeakMap.prototype.set);
let defaultCoordinator = null;

function boundedNumber(value, fallback, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function boundedInteger(value, fallback, min, max) {
    return Math.round(boundedNumber(value, fallback, min, max));
}

function normalizeCadenceMode(value = 'interval') {
    if (value !== 'interval' && value !== 'phase') {
        throw new TypeError("GPU frame cadenceMode must be 'interval' or 'phase'");
    }
    return value;
}

function boundedId(value, label) {
    const id = String(value ?? '').trim();
    if (!id || id.length > MAX_ID_LENGTH) {
        throw new TypeError(`${label} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
    }
    return id;
}

function historyAverage(history) {
    if (!history.length) return 0;
    return history.reduce((sum, value) => sum + value, 0) / history.length;
}

function historyMaximum(history) {
    return history.length ? Math.max(...history) : 0;
}

function appendHistory(history, value) {
    const sample = boundedNumber(value, 0, 0, 1000);
    history.push(sample);
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    return sample;
}

function normalizedTimingHistory(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(-MAX_HISTORY)
        .map(sample => Number(sample))
        .filter(sample => Number.isFinite(sample) && sample >= 0)
        .map(sample => Math.min(1000, sample));
}

function frozenTelemetry(record, effectiveFps) {
    return Object.freeze({
        id: record.id,
        ownerId: record.ownerId,
        surfaceId: record.surfaceId,
        generation: record.generation,
        priority: record.priority,
        targetFps: record.targetFps,
        cadenceMode: record.cadenceMode,
        effectiveFps,
        visible: record.visible,
        focused: record.focused,
        minimized: record.minimized,
        enabled: record.enabled,
        registered: record.registered,
        frames: record.frames,
        submissions: record.submissions,
        skipped: record.skipped,
        deferred: record.deferred,
        errors: record.errors,
        lastFrameAt: record.lastRunAt,
        lastSkipReason: record.lastSkipReason,
        lastError: record.lastError,
        cpuEncodeMs: Object.freeze({
            last: record.lastCpuMs,
            average: historyAverage(record.cpuHistory),
            max: historyMaximum(record.cpuHistory),
        }),
        gpuTimeMs: Object.freeze({
            last: record.lastGpuMs,
            average: historyAverage(record.gpuHistory),
            max: historyMaximum(record.gpuHistory),
        }),
    });
}

function frameTelemetryError(suffix) {
    const code = `GPU_FRAME_TELEMETRY_${suffix}`;
    const error = new Error(code);
    error.code = code;
    return Object.freeze(error);
}

function timingAccounting(history) {
    if (!Array.isArray(history) || history.length > MAX_HISTORY) {
        throw frameTelemetryError('RECORD_INVALID');
    }
    for (let index = 0; index < history.length; index++) {
        const value = history[index];
        if (!Object.hasOwn(history, index) || !Number.isFinite(value) || value < 0 || value > 1000) {
            throw frameTelemetryError('RECORD_INVALID');
        }
    }
    const sampleCount = history.length;
    return Object.freeze({
        sampleCount,
        last: sampleCount ? history.at(-1) : null,
        average: sampleCount ? historyAverage(history) : null,
        max: sampleCount ? historyMaximum(history) : null,
    });
}

function producerAccounting(record) {
    const counters = [record.frames, record.submissions, record.skipped, record.deferred, record.errors];
    if (typeof record.registered !== 'boolean'
        || !Number.isSafeInteger(record.generation) || record.generation < 1
        || counters.some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw frameTelemetryError('RECORD_INVALID');
    }
    return Object.freeze({
        sourceName: 'gpuFrameProducerAccounting',
        version: 1,
        registered: record.registered,
        generation: record.generation,
        frames: record.frames,
        submissionsReported: record.submissions,
        skipped: record.skipped,
        deferred: record.deferred,
        errors: record.errors,
        cpuEncodeMs: timingAccounting(record.cpuHistory),
        gpuTimeReportedMs: timingAccounting(record.gpuHistory),
    });
}

/**
 * Host-only observation of one genuine producer handle, never an owner/surface
 * name lookup. Copies and proxies cannot select a producer. Each observer can
 * close independently, without unregistering or changing the producer.
 *
 * Frozen snapshots contain coordinator accounting only. Frames count successful
 * synchronous callbacks; submissionsReported counts them unless the callback
 * returns submitted === false, not native queue activity. CPU timing is the
 * coordinator's bounded callback
 * interval; GPU timing is reported data, not trusted GPU execution evidence.
 * Both histories retain at most 60 normalized 0..1000 ms samples. Unsampled
 * timing is null, not a fabricated measured zero. No identifiers, raw errors,
 * callbacks, mount authorities, device or coordinator handles are exposed.
 *
 * The original record remains readable after unregister/cache eviction/destroy
 * and receives any in-flight callback's final accounting. Observation is not
 * proof of callback settlement, resource disposal, or a Virtual Realm owner
 * binding. That binding remains the future host provider's responsibility.
 */
export function captureGpuFrameProducerTelemetrySource(handle) {
    if (arguments.length !== 1) throw frameTelemetryError('REQUEST_INVALID');
    let read = readProducerTelemetrySource(producerTelemetrySources, handle);
    if (!read) throw frameTelemetryError('SOURCE_REQUIRED');
    const closedReceipt = Object.freeze({ closed: true });
    return Object.freeze({
        snapshot(...args) {
            if (args.length) throw frameTelemetryError('REQUEST_INVALID');
            if (read === null) throw frameTelemetryError('CLOSED');
            return read();
        },
        close(...args) {
            if (args.length) throw frameTelemetryError('REQUEST_INVALID');
            read = null;
            return closedReceipt;
        },
    });
}

/** Return the live OS coordinator that owns `device`, if one is registered. */
export function getGpuFrameCoordinatorForDevice(device) {
    return device && typeof device === 'object' ? coordinatorByDevice.get(device) ?? null : null;
}

/** Kernel-internal fallback for drivers created before explicit dependency wiring. */
export function getDefaultGpuFrameCoordinator() {
    return defaultCoordinator?.destroyed ? null : defaultCoordinator;
}

/**
 * One ordered frame-admission lane for continuous kernel WebGPU producers.
 * The coordinator owns the browser RAF used by KernelBootstrap. Producer
 * callbacks are synchronous so command encoding/submission order cannot escape
 * the priority order selected for a frame.
 */
export class GpuFrameCoordinator {
    constructor(kernel, {
        clock = () => performance.now(),
        requestFrame = callback => globalThis.requestAnimationFrame(callback),
        cancelFrame = handle => globalThis.cancelAnimationFrame(handle),
        documentHidden = () => globalThis.document?.hidden === true,
        cpuBudgetMs = DEFAULT_CPU_BUDGET_MS,
        maxProducers = DEFAULT_MAX_PRODUCERS,
        maxProducersPerOwner = DEFAULT_MAX_PRODUCERS_PER_OWNER,
        maxRetiredTelemetry = DEFAULT_MAX_RETIRED_TELEMETRY,
    } = {}) {
        if (!kernel || typeof kernel !== 'object') {
            throw new TypeError('GpuFrameCoordinator requires a kernel object');
        }
        if (typeof clock !== 'function' || typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
            throw new TypeError('GpuFrameCoordinator requires frame clock functions');
        }
        this._kernel = kernel;
        this._clock = clock;
        this._requestFrame = requestFrame;
        this._cancelFrame = cancelFrame;
        this._documentHidden = typeof documentHidden === 'function' ? documentHidden : () => false;
        this._cpuBudgetMs = boundedNumber(cpuBudgetMs, DEFAULT_CPU_BUDGET_MS, 1, 16);
        this._maxProducers = boundedInteger(maxProducers, DEFAULT_MAX_PRODUCERS, 1, 4096);
        this._maxProducersPerOwner = boundedInteger(
            maxProducersPerOwner,
            DEFAULT_MAX_PRODUCERS_PER_OWNER,
            1,
            this._maxProducers,
        );
        this._maxRetiredTelemetry = boundedInteger(
            maxRetiredTelemetry,
            DEFAULT_MAX_RETIRED_TELEMETRY,
            1,
            4096,
        );
        this._records = new Map();
        this._surfaceIds = new Map();
        this._ownerProducerCounts = new Map();
        this._retiredTelemetry = new Map();
        this._deviceGenerations = new WeakMap();
        this._boundDevices = new Set();
        this._sequence = 0;
        this._frameIndex = 0;
        this._rafId = null;
        this._running = false;
        this._destroyed = false;
        this._beforeFrame = null;
        this._onAnimationFrame = now => {
            this._rafId = null;
            if (!this._running || this._destroyed) return;
            this._scheduleFrame();
            this.tick(now);
        };
        this._offRestored = kernel.events?.on?.('gpu:device-restored', () => this.bindCurrentDevice()) ?? null;
        this.bindCurrentDevice();
        defaultCoordinator = this;
    }

    get destroyed() { return this._destroyed; }
    get running() { return this._running; }
    get size() { return this._records.size; }
    get generation() {
        const generation = Number(this._kernel.gpuRuntime?.generation ?? this._kernel.gpu?.generation);
        return Number.isInteger(generation) && generation >= 0 ? generation : 0;
    }

    get canAdmitFrames() {
        return this._destroyed === false
            && this._kernel.gpuRuntime?.canAdmitFrames === true
            && this._kernel.gpu?.generation === this.generation
            && Boolean(this._kernel.gpu?.device);
    }

    currentDevice() {
        if (!this.canAdmitFrames) return null;
        if (typeof this._kernel.gpuRuntime?.currentDevice === 'function') {
            return this._kernel.gpuRuntime.currentDevice(this.generation);
        }
        return this._kernel.gpu?.device ?? null;
    }

    bindCurrentDevice() {
        const device = this.currentDevice();
        if (!device || typeof device !== 'object') {
            this._clearDeviceBindings();
            return false;
        }
        if (this._boundDevices.size === 1 && this._boundDevices.has(device)) return true;
        this._clearDeviceBindings();
        coordinatorByDevice.set(device, this);
        this._deviceGenerations.set(device, this.generation);
        this._boundDevices.add(device);
        return true;
    }

    generationForDevice(device) {
        if (!device || typeof device !== 'object' || coordinatorByDevice.get(device) !== this) return null;
        const generation = this._deviceGenerations.get(device);
        return Number.isInteger(generation) && generation === this.generation && this.currentDevice() === device
            ? this._deviceGenerations.get(device)
            : null;
    }

    start(beforeFrame = null) {
        if (this._destroyed) throw new Error('GpuFrameCoordinator is destroyed');
        if (beforeFrame != null && typeof beforeFrame !== 'function') {
            throw new TypeError('GpuFrameCoordinator.start expects a frame callback');
        }
        if (beforeFrame) this._beforeFrame = beforeFrame;
        if (this._running) return false;
        for (const record of this._records.values()) record.nextRunAt = null;
        this._running = true;
        this._scheduleFrame();
        return true;
    }

    stop() {
        if (!this._running && this._rafId == null) return false;
        this._running = false;
        for (const record of this._records.values()) record.nextRunAt = null;
        if (this._rafId != null) {
            try { this._cancelFrame(this._rafId); } catch {}
            this._rafId = null;
        }
        return true;
    }

    registerProducer(options = {}) {
        if (this._destroyed) throw new Error('GpuFrameCoordinator is destroyed');
        if (typeof options.callback !== 'function') {
            throw new TypeError('GPU frame producer callback must be a function');
        }
        const ownerId = boundedId(options.ownerId, 'GPU frame ownerId');
        const surfaceId = boundedId(options.surfaceId, 'GPU frame surfaceId');
        const surfaceKey = `${ownerId}\0${surfaceId}`;
        if (this._surfaceIds.has(surfaceKey)) {
            throw new Error(`GPU frame producer already registered for '${ownerId}/${surfaceId}'`);
        }
        if (this._records.size >= this._maxProducers) {
            const error = new Error(`GPU frame producer limit of ${this._maxProducers} has been reached`);
            error.code = 'GPU_FRAME_PRODUCER_GLOBAL_LIMIT';
            throw error;
        }
        const ownerProducerCount = this._ownerProducerCounts.get(ownerId) ?? 0;
        if (ownerProducerCount >= this._maxProducersPerOwner) {
            const error = new Error(
                `GPU frame owner '${ownerId}' reached its producer limit of ${this._maxProducersPerOwner}`,
            );
            error.code = 'GPU_FRAME_PRODUCER_OWNER_LIMIT';
            throw error;
        }
        const generation = Number(options.generation ?? this.generation);
        if (!Number.isInteger(generation) || generation < 1) {
            throw new TypeError('GPU frame producer generation must be a positive integer');
        }
        const targetFps = boundedNumber(options.targetFps, 60, 1, 240);
        const cadenceMode = normalizeCadenceMode(options.cadenceMode);
        const record = {
            id: `gpu-frame-${++this._sequence}`,
            sequence: this._sequence,
            ownerId,
            surfaceId,
            surfaceKey,
            generation,
            ownerAuthority: options.ownerAuthority ?? null,
            kernelOwned: options.ownerAuthority == null,
            priority: boundedInteger(options.priority, 100, -1000, 1000),
            targetFps,
            cadenceMode,
            nextRunAt: null,
            cadenceIntervalMs: null,
            backgroundFps: boundedNumber(options.backgroundFps, targetFps, 1, targetFps),
            cpuBudgetMs: boundedNumber(
                options.cpuBudgetMs,
                DEFAULT_PRODUCER_CPU_BUDGET_MS,
                0.25,
                this._cpuBudgetMs,
            ),
            visible: options.visible !== false,
            focused: options.focused !== false,
            minimized: options.minimized === true,
            suspendWhenUnfocused: options.suspendWhenUnfocused === true,
            enabled: options.enabled !== false,
            callback: options.callback,
            externalGpuTiming: typeof options.gpuTimingHistory === 'function'
                ? options.gpuTimingHistory
                : null,
            registered: true,
            frames: 0,
            submissions: 0,
            skipped: 0,
            deferred: 0,
            errors: 0,
            lastRunAt: null,
            lastCpuMs: 0,
            lastGpuMs: 0,
            lastSkipReason: null,
            lastError: null,
            cpuHistory: [],
            gpuHistory: normalizedTimingHistory(options.gpuTimingHistory),
        };
        this._records.set(record.id, record);
        this._surfaceIds.set(surfaceKey, record.id);
        this._ownerProducerCounts.set(ownerId, ownerProducerCount + 1);
        this._retiredTelemetry.delete(surfaceKey);

        const unregister = () => this.unregisterProducer(record.id);
        const handle = Object.freeze({
            id: record.id,
            ownerId,
            surfaceId,
            update: patch => this.updateProducer(record.id, patch),
            reportGpuTiming: milliseconds => this.reportGpuTiming(record.id, milliseconds),
            // Retained handles observe their own record, including final callback
            // accounting after unregister, never a replacement with the same key.
            telemetry: () => this._snapshot(record),
            unregister,
            destroy: unregister,
        });
        retainProducerTelemetrySource(producerTelemetrySources, handle, () => producerAccounting(record));
        return handle;
    }

    updateProducer(id, patch = {}) {
        const record = this._records.get(id);
        if (!record?.registered) return false;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new TypeError('GPU frame producer update must be an object');
        }
        const cadenceMode = patch.cadenceMode === undefined ? record.cadenceMode : normalizeCadenceMode(patch.cadenceMode);
        const cadencePolicy = ['cadenceMode', 'targetFps', 'backgroundFps', 'visible', 'focused', 'minimized', 'enabled', 'suspendWhenUnfocused'];
        const previousPolicy = cadencePolicy.map(key => record[key]);
        if (patch.generation !== undefined) {
            const generation = Number(patch.generation);
            if (!Number.isInteger(generation) || generation !== record.generation) {
                throw new TypeError('GPU frame producer generation is immutable; unregister and rebuild the producer');
            }
        }
        if (patch.priority !== undefined) record.priority = boundedInteger(patch.priority, record.priority, -1000, 1000);
        if (patch.targetFps !== undefined) record.targetFps = boundedNumber(patch.targetFps, record.targetFps, 1, 240);
        if (patch.backgroundFps !== undefined) {
            record.backgroundFps = boundedNumber(patch.backgroundFps, record.backgroundFps, 1, record.targetFps);
        }
        if (patch.cpuBudgetMs !== undefined) {
            record.cpuBudgetMs = boundedNumber(patch.cpuBudgetMs, record.cpuBudgetMs, 0.25, this._cpuBudgetMs);
        }
        if (patch.visible !== undefined) record.visible = patch.visible === true;
        if (patch.focused !== undefined) record.focused = patch.focused === true;
        if (patch.minimized !== undefined) record.minimized = patch.minimized === true;
        if (patch.enabled !== undefined) record.enabled = patch.enabled === true;
        if (patch.suspendWhenUnfocused !== undefined) record.suspendWhenUnfocused = patch.suspendWhenUnfocused === true;
        record.cadenceMode = cadenceMode;
        if (cadencePolicy.some((key, index) => record[key] !== previousPolicy[index])) {
            record.nextRunAt = null;
            record.cadenceIntervalMs = null;
        }
        if (patch.gpuTimingHistory !== undefined) {
            record.externalGpuTiming = typeof patch.gpuTimingHistory === 'function'
                ? patch.gpuTimingHistory
                : null;
            if (Array.isArray(patch.gpuTimingHistory)) {
                record.gpuHistory = normalizedTimingHistory(patch.gpuTimingHistory);
            }
        }
        return true;
    }

    reportGpuTiming(id, milliseconds) {
        const record = this._records.get(id);
        if (!record?.registered) return false;
        record.lastGpuMs = appendHistory(record.gpuHistory, milliseconds);
        return true;
    }

    unregisterProducer(id) {
        const record = this._records.get(id);
        if (!record) return false;
        record.registered = false;
        this._records.delete(id);
        if (this._surfaceIds.get(record.surfaceKey) === id) this._surfaceIds.delete(record.surfaceKey);
        const ownerProducerCount = this._ownerProducerCounts.get(record.ownerId) ?? 0;
        if (ownerProducerCount <= 1) this._ownerProducerCounts.delete(record.ownerId);
        else this._ownerProducerCounts.set(record.ownerId, ownerProducerCount - 1);
        this._retire(record);
        return true;
    }

    unregisterOwner(ownerId) {
        const owner = boundedId(ownerId, 'GPU frame ownerId');
        let removed = 0;
        for (const record of [...this._records.values()]) {
            if (record.ownerId === owner && this.unregisterProducer(record.id)) removed++;
        }
        for (const [key, receipt] of this._retiredTelemetry) {
            if (receipt.ownerId === owner) this._retiredTelemetry.delete(key);
        }
        return removed;
    }

    _retire(record) {
        this._retiredTelemetry.delete(record.surfaceKey);
        this._retiredTelemetry.set(record.surfaceKey, this._snapshot(record));
        while (this._retiredTelemetry.size > this._maxRetiredTelemetry) {
            const oldestKey = this._retiredTelemetry.keys().next().value;
            this._retiredTelemetry.delete(oldestKey);
        }
    }

    tick(now = this._clock()) {
        if (this._destroyed) return Object.freeze({ admitted: 0, submitted: 0, deferred: 0 });
        const frameNow = Number.isFinite(Number(now)) ? Number(now) : this._clock();
        this._frameIndex++;
        this.bindCurrentDevice();
        if (this._beforeFrame) {
            try { this._beforeFrame(frameNow); }
            catch (error) { this._warn(`Kernel frame callback failed: ${error?.message ?? error}`); }
        }

        const records = [...this._records.values()].sort((left, right) => (
            left.priority - right.priority || left.sequence - right.sequence
        ));
        const encodeStart = this._clock();
        let admitted = 0;
        let submitted = 0;
        let deferred = 0;

        for (const record of records) {
            if (!record.registered) continue;
            const suspension = this._suspensionReason(record);
            if (suspension) {
                this._skip(record, suspension);
                continue;
            }
            this._sampleExternalGpuTiming(record);
            const interval = this._effectiveInterval(record);
            if (record.cadenceMode === 'phase') {
                // Preserve progress if measured pressure changes the effective
                // rate. Explicit rate/state updates reset this deadline instead.
                if (record.nextRunAt != null && record.cadenceIntervalMs != null
                    && Math.abs(interval - record.cadenceIntervalMs) > 0.001) {
                    const remaining = Math.max(0, Math.min(1, (record.nextRunAt - frameNow) / record.cadenceIntervalMs));
                    record.nextRunAt = frameNow + remaining * interval;
                }
                record.cadenceIntervalMs = interval;
            }
            const beforeDeadline = record.cadenceMode === 'phase'
                ? record.nextRunAt != null && frameNow + 0.001 < record.nextRunAt
                : record.lastRunAt != null && frameNow - record.lastRunAt + 0.001 < interval;
            if (beforeDeadline) {
                this._skip(record, 'cadence');
                continue;
            }
            if (admitted > 0 && this._clock() - encodeStart >= this._cpuBudgetMs) {
                record.deferred++;
                record.skipped++;
                record.lastSkipReason = 'cpu-budget';
                deferred++;
                continue;
            }
            if (!this._generationIsCurrent(record)) {
                this._skip(record, 'generation-stale');
                continue;
            }

            const previousRun = record.lastRunAt;
            record.lastRunAt = frameNow;
            if (record.cadenceMode === 'phase') {
                const deadline = record.nextRunAt ?? frameNow;
                // Carry only the display-quantization remainder. Missed frame
                // credits from a stall never create catch-up submissions.
                record.nextRunAt = frameNow - deadline >= interval ? frameNow + interval : deadline + interval;
            }
            record.lastSkipReason = null;
            const callbackStart = this._clock();
            let result = null;
            try {
                const invoke = () => record.callback(Object.freeze({
                    now: frameNow,
                    deltaSeconds: previousRun == null
                        ? 0
                        : Math.max(0, Math.min(0.1, (frameNow - previousRun) / 1000)),
                    frameIndex: this._frameIndex,
                    generation: record.generation,
                    ownerId: record.ownerId,
                    surfaceId: record.surfaceId,
                    targetFps: record.targetFps,
                    effectiveFps: 1000 / interval,
                }));
                result = typeof this._kernel.gpuBroker?.runContinuous === 'function'
                    ? this._kernel.gpuBroker.runContinuous(
                        record.ownerId,
                        record.generation,
                        invoke,
                        record.ownerAuthority,
                        record.kernelOwned,
                    )
                    : invoke();
                if (result && typeof result.then === 'function') {
                    result.catch?.(() => {});
                    record.enabled = false;
                    throw new Error('GPU frame callbacks must be synchronous');
                }
                if (Number.isFinite(Number(result?.gpuTimeMs))) {
                    this.reportGpuTiming(record.id, Number(result.gpuTimeMs));
                }
                record.frames++;
                admitted++;
                if (result?.submitted !== false) {
                    record.submissions++;
                    submitted++;
                } else if (record.cadenceMode === 'phase') {
                    record.nextRunAt = frameNow + interval;
                }
            } catch (error) {
                if (record.cadenceMode === 'phase') record.nextRunAt = frameNow + interval;
                record.errors++;
                record.lastError = String(error?.message ?? error).slice(0, 512);
                this._warn(`GPU frame producer '${record.ownerId}/${record.surfaceId}' failed: ${record.lastError}`);
            } finally {
                const callbackEnd = this._clock();
                record.lastCpuMs = appendHistory(record.cpuHistory, callbackEnd - callbackStart);
                if (record.cadenceMode === 'phase' && callbackEnd - frameNow >= interval) {
                    record.nextRunAt = callbackEnd + interval;
                }
                if (!record.registered) {
                    this._retire(record);
                }
            }
        }
        return Object.freeze({ admitted, submitted, deferred });
    }

    telemetry(ownerId = null, surfaceId = null) {
        if (ownerId != null || surfaceId != null) {
            const key = `${String(ownerId ?? '')}\0${String(surfaceId ?? '')}`;
            const id = this._surfaceIds.get(key);
            const record = id ? this._records.get(id) : null;
            return record ? this._snapshot(record) : this._retiredTelemetry.get(key) ?? null;
        }
        const live = [...this._records.values()].map(record => this._snapshot(record));
        const liveKeys = new Set([...this._records.values()].map(record => record.surfaceKey));
        const retired = [...this._retiredTelemetry.entries()]
            .filter(([key]) => !liveKeys.has(key))
            .map(([, receipt]) => receipt);
        return Object.freeze([...live, ...retired]);
    }

    status() {
        return Object.freeze({
            running: this._running,
            destroyed: this._destroyed,
            rafActive: this._rafId != null,
            producers: this._records.size,
            generation: this.generation,
            canAdmitFrames: this.canAdmitFrames,
            cpuBudgetMs: this._cpuBudgetMs,
            maxProducers: this._maxProducers,
            maxProducersPerOwner: this._maxProducersPerOwner,
            retiredTelemetry: this._retiredTelemetry.size,
            maxRetiredTelemetry: this._maxRetiredTelemetry,
        });
    }

    destroy() {
        if (this._destroyed) return false;
        this.stop();
        this._destroyed = true;
        for (const id of [...this._records.keys()]) this.unregisterProducer(id);
        try { this._offRestored?.(); } catch {}
        this._offRestored = null;
        this._clearDeviceBindings();
        this._ownerProducerCounts.clear();
        this._retiredTelemetry.clear();
        if (defaultCoordinator === this) defaultCoordinator = null;
        this._beforeFrame = null;
        return true;
    }

    _scheduleFrame() {
        if (!this._running || this._destroyed || this._rafId != null) return;
        this._rafId = this._requestFrame(this._onAnimationFrame);
    }

    _generationIsCurrent(record) {
        return this.canAdmitFrames
            && record.generation === this.generation
            && this.currentDevice() === this._kernel.gpu?.device;
    }

    _suspensionReason(record) {
        if (!record.enabled) return 'disabled';
        if (this._documentHidden()) return 'document-hidden';
        if (!record.visible) return 'not-visible';
        if (record.minimized) return 'minimized';
        if (record.suspendWhenUnfocused && !record.focused) return 'not-focused';
        if (!this.canAdmitFrames) return 'gpu-unavailable';
        return null;
    }

    _skip(record, reason) {
        record.skipped++;
        record.lastSkipReason = reason;
        if (record.cadenceMode === 'phase' && reason !== 'cadence') {
            record.nextRunAt = null;
            record.cadenceIntervalMs = null;
        }
    }

    _sampleExternalGpuTiming(record) {
        if (!record.externalGpuTiming) return;
        try {
            const value = record.externalGpuTiming();
            if (Array.isArray(value)) {
                record.gpuHistory = normalizedTimingHistory(value);
                record.lastGpuMs = record.gpuHistory.at(-1) ?? 0;
            } else if (Number.isFinite(Number(value)) && Number(value) >= 0) {
                record.lastGpuMs = appendHistory(record.gpuHistory, Number(value));
            }
        } catch (error) {
            record.lastError = `GPU timing provider failed: ${String(error?.message ?? error).slice(0, 400)}`;
        }
    }

    _clearDeviceBindings() {
        for (const device of this._boundDevices) {
            if (coordinatorByDevice.get(device) === this) coordinatorByDevice.delete(device);
        }
        this._boundDevices.clear();
    }

    _effectiveInterval(record) {
        const requestedFps = record.focused
            ? record.targetFps
            : Math.min(record.targetFps, record.backgroundFps);
        const baseInterval = 1000 / requestedFps;
        const cpuAverage = historyAverage(record.cpuHistory);
        const gpuAverage = historyAverage(record.gpuHistory);
        const cpuPressure = cpuAverage > 0 ? cpuAverage / record.cpuBudgetMs : 1;
        const gpuPressure = gpuAverage > 0 ? gpuAverage / Math.max(1, baseInterval * 0.8) : 1;
        const pressure = Math.max(1, Math.min(4, cpuPressure, 4), Math.min(4, gpuPressure));
        return Math.min(1000, baseInterval * pressure);
    }

    _snapshot(record) {
        return frozenTelemetry(record, 1000 / this._effectiveInterval(record));
    }

    _warn(message) {
        if (typeof this._kernel._warn === 'function') this._kernel._warn(message);
        else this._kernel.logger?.warn?.(message, 'GpuFrameCoordinator');
    }
}
