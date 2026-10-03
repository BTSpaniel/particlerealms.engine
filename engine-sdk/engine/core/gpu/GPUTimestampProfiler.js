// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Canonical timestamp-query profiler for the engine, VGPU, and OS apps.
 *
 * A profiler belongs to exactly one physical-device generation. Readbacks are
 * bounded; when every slot is occupied, the current sample is skipped rather
 * than stalling rendering or mapping a buffer still used by the GPU.
 */

function monotonicNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function positiveInteger(value, fallback, minimum = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.floor(number)) : fallback;
}

function emptyDetailedResult(telemetry) {
    return {
        durations: [],
        timestampsNs: [],
        passNames: [],
        passes: [],
        frame: null,
        telemetry,
    };
}

const NATIVE_PROMISE = Promise;
const NATIVE_PROMISE_RESOLVE = NATIVE_PROMISE.resolve;
const NATIVE_PROMISE_REJECT = NATIVE_PROMISE.reject;
const NATIVE_PROMISE_THEN = NATIVE_PROMISE.prototype.then;
const NATIVE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const NATIVE_SET_ADD = Set.prototype.add;
const NATIVE_SET_DELETE = Set.prototype.delete;
const NATIVE_SET_CLEAR = Set.prototype.clear;
const NATIVE_SET_HAS = Set.prototype.has;
const NATIVE_WEAK_SET_ADD = WeakSet.prototype.add;
const NATIVE_WEAK_SET_HAS = WeakSet.prototype.has;
const NATIVE_ARRAY_PUSH = Array.prototype.push;
const NATIVE_ARRAY_SPLICE = Array.prototype.splice;
const NATIVE_ARRAY_INDEX_OF = Array.prototype.indexOf;
const NATIVE_ARRAY_SHIFT = Array.prototype.shift;
const NATIVE_ARRAY_FIND_INDEX = Array.prototype.findIndex;
const TIMESTAMP_SETTLEMENT_AUTHORITIES = new WeakMap();
const TIMESTAMP_CANCELLATION_AUTHORITIES = new WeakMap();
const TIMESTAMP_QUEUED_DRAIN_AUTHORITIES = new WeakMap();
const TIMESTAMP_PROFILER_LIFECYCLE_STATES = new WeakMap();
const TIMESTAMP_READ_AUTHORITIES = new WeakMap();
const TIMESTAMP_PUBLIC_OPERATION_AUTHORITIES = new WeakMap();

function installTimestampSettlementAuthorities(
    record, resolve, reject = null, continuation = null,
) {
    let settled = false;
    let cancelled = false;
    const authorities = Object.freeze({
        resolve: Object.freeze({ receiver: undefined, callable: resolve }),
        reject: typeof reject === 'function'
            ? Object.freeze({ receiver: undefined, callable: reject })
            : null,
        isSettled: Object.freeze({
            receiver: undefined,
            callable: () => settled,
        }),
        claim: Object.freeze({
            receiver: undefined,
            callable: () => {
                if (settled) return false;
                settled = true;
                return true;
            },
        }),
        isCancelled: Object.freeze({
            receiver: undefined,
            callable: () => cancelled,
        }),
        cancel: Object.freeze({
            receiver: undefined,
            callable: () => {
                if (cancelled) return false;
                cancelled = true;
                return true;
            },
        }),
        continuation: continuation || null,
    });
    TIMESTAMP_SETTLEMENT_AUTHORITIES.set(record, authorities);
    writeTimestampMirror(record, 'settled', false);
    return authorities;
}

function timestampProfilerLifecycleState(profiler) {
    const state = TIMESTAMP_PROFILER_LIFECYCLE_STATES.get(profiler);
    if (!state) throw new Error('[GPUProfiler] Missing private lifecycle state');
    return state;
}

function timestampProfilerLifecycleError(profiler) {
    const lifecycleState = timestampProfilerLifecycleState(profiler);
    if (lifecycleState.destroyError) return lifecycleState.destroyError;
    const error = new Error('GPU timestamp profiler destroyed');
    error.name = 'AbortError';
    error.code = 'GPU_TIMESTAMP_PROFILER_DESTROYED';
    return error;
}

function assertTimestampProfilerAlive(
    profiler,
    generation = timestampProfilerLifecycleState(profiler).lifecycleGeneration,
) {
    const lifecycleState = timestampProfilerLifecycleState(profiler);
    if (lifecycleState.destroyed
        || generation !== lifecycleState.lifecycleGeneration
        || !lifecycleState.device) {
        throw timestampProfilerLifecycleError(profiler);
    }
}

function writeTimestampMirror(target, key, value) {
    try {
        Reflect.apply(NATIVE_OBJECT_DEFINE_PROPERTY, Object, [target, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
        }]);
    } catch (_) {}
}

function installTimestampReadAuthority(profiler, read, authoritative = null) {
    const existing = TIMESTAMP_READ_AUTHORITIES.get(read);
    if (existing) return existing;
    const buffer = authoritative?.readBuffer ?? read.readBuffer;
    const cleanup = authoritative?.readBufferCleanup
        || read.readBufferCleanup
        || profiler._captureCleanup(buffer);
    const passes = Object.freeze(Array.from(
        authoritative?.passes || read.passes || [], pass => Object.freeze({ ...pass }),
    ));
    const authority = Object.freeze({
        generation: authoritative?.generation ?? read.generation,
        queryCount: authoritative?.queryCount ?? read.queryCount,
        passes,
        readBuffer: buffer,
        readBufferCleanup: cleanup,
        frame: authoritative?.frame ?? read.frame,
    });
    TIMESTAMP_READ_AUTHORITIES.set(read, authority);
    return authority;
}

function installTimestampPublicOperationAuthority(operation, promise, generation) {
    const authority = Object.freeze({ promise, generation });
    TIMESTAMP_PUBLIC_OPERATION_AUTHORITIES.set(operation, authority);
    return authority;
}

function syncTimestampPendingReads(profiler, state = timestampProfilerLifecycleState(profiler)) {
    return state;
}

function pushTimestampArrayMirror(mirror, value) {
    try { Reflect.apply(NATIVE_ARRAY_PUSH, mirror, [value]); } catch (_) {}
}

function removeTimestampArrayMirror(mirror, value) {
    try {
        const index = Reflect.apply(NATIVE_ARRAY_INDEX_OF, mirror, [value]);
        if (index >= 0) Reflect.apply(NATIVE_ARRAY_SPLICE, mirror, [index, 1]);
    } catch (_) {}
}

function clearTimestampArrayMirror(mirror) {
    try { Reflect.apply(NATIVE_ARRAY_SPLICE, mirror, [0, mirror.length]); } catch (_) {}
}

function isTimestampSettlementPending(record) {
    const authority = TIMESTAMP_SETTLEMENT_AUTHORITIES.get(record)?.isSettled;
    return Boolean(authority)
        && !Reflect.apply(authority.callable, authority.receiver, []);
}

function claimTimestampSettlement(record) {
    const authority = TIMESTAMP_SETTLEMENT_AUTHORITIES.get(record)?.claim;
    const claimed = Boolean(authority)
        && Reflect.apply(authority.callable, authority.receiver, []);
    if (claimed) writeTimestampMirror(record, 'settled', true);
    return claimed;
}

function isTimestampRecordCancelled(record) {
    const authority = TIMESTAMP_SETTLEMENT_AUTHORITIES.get(record)?.isCancelled;
    return Boolean(authority)
        && Reflect.apply(authority.callable, authority.receiver, []);
}

function cancelTimestampRecord(record) {
    const authority = TIMESTAMP_SETTLEMENT_AUTHORITIES.get(record)?.cancel;
    return Boolean(authority)
        && Reflect.apply(authority.callable, authority.receiver, []);
}

function invokeTimestampSettlementAuthority(record, rejected, value) {
    const authorities = TIMESTAMP_SETTLEMENT_AUTHORITIES.get(record);
    const authority = rejected ? authorities?.reject : authorities?.resolve;
    if (!authority) return false;
    Reflect.apply(authority.callable, authority.receiver, [value]);
    return true;
}

function installTimestampCancellationAuthority(record, promise, cancel) {
    const authorities = Object.freeze({
        promise,
        cancel: Object.freeze({ receiver: undefined, callable: cancel }),
    });
    TIMESTAMP_CANCELLATION_AUTHORITIES.set(record, authorities);
    return authorities;
}

function resolveTimestampPromise(value) {
    return Reflect.apply(NATIVE_PROMISE_RESOLVE, NATIVE_PROMISE, [value]);
}

function rejectTimestampPromise(error) {
    return Reflect.apply(NATIVE_PROMISE_REJECT, NATIVE_PROMISE, [error]);
}

function thenTimestampPromise(promise, onFulfilled, onRejected) {
    return Reflect.apply(NATIVE_PROMISE_THEN, promise, [onFulfilled, onRejected]);
}

function silenceTimestampPromise(promise) {
    thenTimestampPromise(promise, () => {}, () => {});
}

function rejectTimestampPublicPromise(error) {
    const rejection = rejectTimestampPromise(error);
    silenceTimestampPromise(rejection);
    return rejection;
}

function raceTimestampPromises(values) {
    return new NATIVE_PROMISE((resolve, reject) => {
        for (let index = 0; index < values.length; index++) {
            thenTimestampPromise(
                resolveTimestampPromise(values[index]), resolve, reject,
            );
        }
    });
}

export class GPUTimestampProfiler {
    constructor(device, options = {}) {
        this._destroyed = false;
        this._lifecycleGeneration = 0;
        this._destroyError = null;
        this._publicOperations = new Set();
        this.device = device;
        this.querySet = null;
        this.resolveBuffer = null;
        this._querySetCleanup = null;
        this._resolveBufferCleanup = null;
        this.queryCount = 0;
        this.pendingReads = [];
        this._activeReads = new Set();
        this._destroyedReadBuffers = new WeakSet();
        this._currentPasses = [];
        this._currentFrame = null;
        this._lastResolvedRead = null;
        this._history = [];
        this._lastResults = new Map();
        this._lastDetailed = null;
        this._queueDrainTask = null;
        this._activeQueueDrain = null;
        this._queuedQueueDrainFrames = [];
        this._queuedQueueDrainPromise = null;
        this._queuedQueueDrainResolve = null;
        this._queuedQueueDrainQueue = null;
        this._queuedQueueDrainCallable = null;
        TIMESTAMP_PROFILER_LIFECYCLE_STATES.set(this, {
            destroyed: false,
            lifecycleGeneration: 0,
            destroyError: null,
            device,
            querySet: null,
            resolveBuffer: null,
            querySetCleanup: null,
            resolveBufferCleanup: null,
            createQuerySet: null,
            createBuffer: null,
            featuresHas: null,
            destroyAuthorities: null,
            publicOperations: new Set(),
            publicOperationsMirror: this._publicOperations,
            pendingReads: [],
            pendingReadsMirror: this.pendingReads,
            activeReads: new Set(),
            activeReadsMirror: this._activeReads,
            destroyedReadBuffers: new WeakSet(),
            queueDrainTask: null,
            activeQueueDrain: null,
            queueDrainEntryAuthorities: null,
            queuedQueueDrainFrames: [],
            queuedQueueDrainFramesMirror: this._queuedQueueDrainFrames,
            queuedQueueDrainPromise: null,
            queuedQueueDrainResolve: null,
            queuedQueueDrainQueue: null,
            queuedQueueDrainCallable: null,
        });
        const lifecycleState = timestampProfilerLifecycleState(this);
        lifecycleState.destroyAuthorities = Object.freeze({ ...this._captureExternalSet([
            { name: 'captureReadCleanup', receiver: this, key: '_captureReadBufferCleanup' },
            { name: 'captureCleanup', receiver: this, key: '_captureCleanup' },
            { name: 'retireReadCleanup', receiver: this, key: '_retireReadBufferCleanup' },
            { name: 'retireCleanup', receiver: this, key: '_retireCleanup' },
            { name: 'resetQueries', receiver: this, key: '_resetCurrentQueries' },
            { name: 'lifecycleError', receiver: this, key: '_lifecycleError' },
        ], lifecycleState.lifecycleGeneration) });
        this._frameSequence = 0;
        this.skippedFrames = 0;
        this.skippedPasses = 0;
        this.droppedReadbacks = 0;
        this.staleReadbacks = 0;
        this.coalescedQueueDrains = 0;
        this.droppedQueueDrainFrames = 0;
        const lifecycleGeneration = timestampProfilerLifecycleState(this).lifecycleGeneration;
        const createQuerySetProperty = this._captureExternalProperty(
            device, 'createQuerySet', lifecycleGeneration,
        );
        const createBufferProperty = this._captureExternalProperty(
            device, 'createBuffer', lifecycleGeneration,
        );
        const featuresProperty = this._captureExternalProperty(
            device, 'features', lifecycleGeneration,
        );
        const creationAuthorities = this._captureExternalSet([
            {
                name: 'createQuerySet', receiver: device, key: 'createQuerySet', optional: true,
                property: createQuerySetProperty,
            },
            {
                name: 'createBuffer', receiver: device, key: 'createBuffer', optional: true,
                property: createBufferProperty,
            },
        ], lifecycleGeneration);
        this._createQuerySet = creationAuthorities.createQuerySet;
        this._createBuffer = creationAuthorities.createBuffer;
        lifecycleState.createQuerySet = creationAuthorities.createQuerySet;
        lifecycleState.createBuffer = creationAuthorities.createBuffer;
        const features = this._readCapturedExternalProperty(
            featuresProperty, lifecycleGeneration,
        );
        this._featuresHas = features
            ? this._captureExternal(features, 'has', lifecycleGeneration, true)
            : null;
        lifecycleState.featuresHas = this._featuresHas;
        const stableOptions = this._snapshotOptions(options, lifecycleGeneration);
        this.generation = stableOptions.generation;
        const requestedQueries = positiveInteger(stableOptions.maxQueries, 64, 2);
        this.maxQueries = requestedQueries - (requestedQueries % 2);
        this.maxPendingReads = positiveInteger(stableOptions.maxPendingReads, 3);
        this.maxPendingQueueDrainFrames = positiveInteger(
            stableOptions.maxPendingQueueDrainFrames,
            this.maxPendingReads,
        );
        this.historySize = positiveInteger(stableOptions.historySize, 120);
        this.enabled = this._supportsTimestampQueries(lifecycleGeneration);
        this.timerResolutionEvidence = {
            generation: this.generation,
            smallestObservedDeltaNs: null,
            observationCount: 0,
            basis: 'adjacent distinct timestamp-query results',
        };

        if (this.enabled) this._initializeResources();
    }

    _lifecycleError() {
        return timestampProfilerLifecycleError(this);
    }

    _assertAlive(generation = timestampProfilerLifecycleState(this).lifecycleGeneration) {
        assertTimestampProfilerAlive(this, generation);
    }

    _readExternal(
        target, key,
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
    ) {
        let value;
        try { value = Reflect.get(target, key); }
        finally { assertTimestampProfilerAlive(this, generation); }
        return value;
    }

    _captureExternalProperty(
        target, key,
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
    ) {
        assertTimestampProfilerAlive(this, generation);
        let cursor = target;
        const visited = new Set();
        while (cursor && !visited.has(cursor)) {
            visited.add(cursor);
            let descriptor;
            try { descriptor = Reflect.getOwnPropertyDescriptor(cursor, key); }
            finally { assertTimestampProfilerAlive(this, generation); }
            if (descriptor) {
                return Object.freeze({
                    receiver: target,
                    key,
                    descriptor: Object.freeze({ ...descriptor }),
                });
            }
            try { cursor = Reflect.getPrototypeOf(cursor); }
            finally { assertTimestampProfilerAlive(this, generation); }
        }
        return Object.freeze({ receiver: target, key, descriptor: null });
    }

    _readCapturedExternalProperty(
        property,
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
    ) {
        const descriptor = property.descriptor;
        if (!descriptor) {
            assertTimestampProfilerAlive(this, generation);
            return undefined;
        }
        let value;
        try {
            value = 'value' in descriptor
                ? descriptor.value
                : (typeof descriptor.get === 'function'
                    ? Reflect.apply(descriptor.get, property.receiver, [])
                    : undefined);
        } finally { assertTimestampProfilerAlive(this, generation); }
        return value;
    }

    _captureExternalSet(
        specifications,
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
    ) {
        const staged = specifications.map(specification => Object.freeze({
            ...specification,
            property: specification.property || this._captureExternalProperty(
                specification.receiver, specification.key, generation,
            ),
        }));
        const authorities = {};
        for (const specification of staged) {
            const callable = this._readCapturedExternalProperty(
                specification.property, generation,
            );
            if (typeof callable !== 'function') {
                if (specification.optional) {
                    authorities[specification.name] = null;
                    continue;
                }
                throw new TypeError(
                    `GPU timestamp profiler requires ${String(specification.key)}()`,
                );
            }
            authorities[specification.name] = Object.freeze({
                receiver: specification.receiver,
                callable,
            });
        }
        return Object.freeze(authorities);
    }

    _normalizeExternal(
        value, normalize,
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
    ) {
        let normalized;
        try { normalized = normalize(value); }
        finally { assertTimestampProfilerAlive(this, generation); }
        return normalized;
    }

    _snapshotOptions(
        options,
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
    ) {
        const source = options ?? {};
        const values = {};
        for (const key of [
            'generation', 'maxQueries', 'maxPendingReads',
            'maxPendingQueueDrainFrames', 'historySize',
        ]) values[key] = this._readExternal(source, key, generation);
        return Object.freeze({
            generation: Number.isInteger(values.generation) ? values.generation : 0,
            maxQueries: values.maxQueries === undefined
                ? 64
                : this._normalizeExternal(values.maxQueries, Number, generation),
            maxPendingReads: values.maxPendingReads === undefined
                ? 3
                : this._normalizeExternal(values.maxPendingReads, Number, generation),
            maxPendingQueueDrainFrames: values.maxPendingQueueDrainFrames === undefined
                ? undefined
                : this._normalizeExternal(values.maxPendingQueueDrainFrames, Number, generation),
            historySize: values.historySize === undefined
                ? 120
                : this._normalizeExternal(values.historySize, Number, generation),
        });
    }

    _snapshotExternalObject(
        source,
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
    ) {
        const target = source ?? {};
        let keys;
        try { keys = Reflect.ownKeys(target); }
        finally { assertTimestampProfilerAlive(this, generation); }
        const snapshot = {};
        for (const key of keys) {
            let descriptor;
            try { descriptor = Reflect.getOwnPropertyDescriptor(target, key); }
            finally { assertTimestampProfilerAlive(this, generation); }
            if (!descriptor?.enumerable) continue;
            snapshot[key] = this._readExternal(target, key, generation);
        }
        return Object.freeze(snapshot);
    }

    _captureExternal(
        target, key,
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
        optional = false,
    ) {
        return this._captureExternalSet([{
            name: 'callable', receiver: target, key, optional,
        }], generation).callable;
    }

    _invokeExternal(
        captured, args,
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
        retire = null,
    ) {
        assertTimestampProfilerAlive(this, generation);
        let result;
        let callError = null;
        try { result = Reflect.apply(captured.callable, captured.receiver, args); }
        catch (error) { callError = error; }
        try { assertTimestampProfilerAlive(this, generation); }
        catch (error) {
            if (result && retire) {
                try { retire(result); } catch (_) {}
            }
            thenTimestampPromise(
                resolveTimestampPromise(result), () => {}, () => {},
            );
            throw error;
        }
        if (callError) throw callError;
        return result;
    }

    _captureCleanup(target, required = false) {
        if (!target) return null;
        for (const key of ['destroy', 'dispose']) {
            let cursor = target;
            const visited = new Set();
            while (cursor && !visited.has(cursor)) {
                visited.add(cursor);
                let descriptor;
                try { descriptor = Reflect.getOwnPropertyDescriptor(cursor, key); }
                catch (error) {
                    if (required) throw error;
                    descriptor = null;
                }
                if (typeof descriptor?.value === 'function') {
                    return Object.freeze({ receiver: target, callable: descriptor.value });
                }
                try { cursor = Reflect.getPrototypeOf(cursor); }
                catch (error) {
                    if (required) throw error;
                    cursor = null;
                }
            }
        }
        if (required) throw new TypeError('GPU timestamp profiler resource has no cleanup authority');
        return null;
    }

    _retireCleanup(cleanup) {
        if (!cleanup) return false;
        try { Reflect.apply(cleanup.callable, cleanup.receiver, []); } catch (_) {}
        return true;
    }

    _supportsTimestampQueries(
        generation = timestampProfilerLifecycleState(this).lifecycleGeneration,
        hasTimestampFeature = timestampProfilerLifecycleState(this).featuresHas,
    ) {
        assertTimestampProfilerAlive(this, generation);
        return hasTimestampFeature
            ? Boolean(this._invokeExternal(hasTimestampFeature, ['timestamp-query'], generation))
            : false;
    }

    _initializeResources() {
        const lifecycleState = timestampProfilerLifecycleState(this);
        if (lifecycleState.destroyed || !this.enabled) return;
        const generation = lifecycleState.lifecycleGeneration;
        const createQuerySet = lifecycleState.createQuerySet;
        const createBuffer = lifecycleState.createBuffer;
        if (!createQuerySet || !createBuffer) {
            throw new TypeError('GPU timestamp profiler requires query-set and buffer creation');
        }
        let querySet = null;
        let querySetCleanup = null;
        let resolveBuffer = null;
        let resolveBufferCleanup = null;
        const cleanupAuthorities = this._captureExternalSet([
            { name: 'captureCleanup', receiver: this, key: '_captureCleanup' },
            { name: 'retireCleanup', receiver: this, key: '_retireCleanup' },
        ], generation);
        const captureCleanup = (candidate, required = false) => Reflect.apply(
            cleanupAuthorities.captureCleanup.callable,
            cleanupAuthorities.captureCleanup.receiver,
            [candidate, required],
        );
        const retireCleanup = cleanup => Reflect.apply(
            cleanupAuthorities.retireCleanup.callable,
            cleanupAuthorities.retireCleanup.receiver,
            [cleanup],
        );
        const retireCandidate = candidate => retireCleanup(captureCleanup(candidate));
        try {
            querySet = this._invokeExternal(createQuerySet, [{
                label: `GPU timestamp queries (generation ${this.generation})`,
                type: 'timestamp',
                count: this.maxQueries,
            }], generation, retireCandidate);
            querySetCleanup = captureCleanup(querySet, true);
            assertTimestampProfilerAlive(this, generation);
            resolveBuffer = this._invokeExternal(createBuffer, [{
                label: `GPU timestamp resolve buffer (generation ${this.generation})`,
                size: this.maxQueries * 8,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
            }], generation, retireCandidate);
            resolveBufferCleanup = captureCleanup(resolveBuffer, true);
            assertTimestampProfilerAlive(this, generation);
            lifecycleState.querySet = querySet;
            lifecycleState.resolveBuffer = resolveBuffer;
            lifecycleState.querySetCleanup = querySetCleanup;
            lifecycleState.resolveBufferCleanup = resolveBufferCleanup;
            writeTimestampMirror(this, 'querySet', querySet);
            writeTimestampMirror(this, 'resolveBuffer', resolveBuffer);
            writeTimestampMirror(this, '_querySetCleanup', querySetCleanup);
            writeTimestampMirror(this, '_resolveBufferCleanup', resolveBufferCleanup);
        } catch (error) {
            if (resolveBufferCleanup) retireCleanup(resolveBufferCleanup);
            else if (resolveBuffer) retireCandidate(resolveBuffer);
            if (querySetCleanup) retireCleanup(querySetCleanup);
            else if (querySet) retireCandidate(querySet);
            throw error;
        }
    }

    isAvailable() {
        return this.enabled
            && !timestampProfilerLifecycleState(this).destroyed
            && timestampProfilerLifecycleState(this).querySet !== null;
    }

    setEnabled(enabled) {
        this.enabled = enabled === true
            && !timestampProfilerLifecycleState(this).destroyed
            && this._supportsTimestampQueries();
        return this.isAvailable();
    }

    beginFrame(metadata = {}) {
        if (!this.isAvailable()) return null;
        const lifecycleGeneration = timestampProfilerLifecycleState(this).lifecycleGeneration;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        const source = metadata ?? {};
        const metadataGeneration = this._readExternal(
            source, 'generation', lifecycleGeneration,
        );
        const metadataNowMs = this._readExternal(source, 'nowMs', lifecycleGeneration);
        const generation = Number.isInteger(metadataGeneration)
            ? metadataGeneration
            : this.generation;
        if (generation !== this.generation) {
            this.skippedFrames++;
            return null;
        }

        if (this._currentFrame) {
            this._currentFrame.skippedReason = 'frame-restarted-before-resolve';
            this.skippedFrames++;
            this._recordFrame(this._currentFrame);
            this._resetCurrentQueries();
        }

        const startedAtMs = Number.isFinite(metadataNowMs) ? metadataNowMs : monotonicNow();
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        this._currentFrame = {
            id: ++this._frameSequence,
            generation,
            startedAtMs,
            encodedAtMs: null,
            submittedAtMs: null,
            cpuEncodeMs: null,
            cpuSubmitOverheadMs: null,
            queueDrainMs: null,
            gpuMs: null,
            gpuPasses: {},
            skippedReason: null,
        };
        return this._currentFrame.id;
    }

    _ensureFrame() {
        if (!this._currentFrame) this.beginFrame();
        return this._currentFrame;
    }

    beginPass(_encoder, passName) {
        if (!this.isAvailable()) return null;
        const lifecycleGeneration = timestampProfilerLifecycleState(this).lifecycleGeneration;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        if (this.queryCount >= this.maxQueries - 1) {
            this.skippedPasses++;
            return null;
        }
        const fallbackName = `pass-${this._currentPasses.length + 1}`;
        const normalizedName = this._normalizeExternal(
            passName || fallbackName, String, lifecycleGeneration,
        );
        const frame = this._ensureFrame();
        if (!frame) return null;
        assertTimestampProfilerAlive(this, lifecycleGeneration);

        const beginIndex = this.queryCount++;
        const endIndex = this.queryCount++;
        const pass = {
            passName: normalizedName,
            instance: this._currentPasses.length,
            beginIndex,
            endIndex,
        };
        this._currentPasses.push(pass);
        return {
            ...pass,
            timestampWrites: {
                querySet: timestampProfilerLifecycleState(this).querySet,
                beginningOfPassWriteIndex: beginIndex,
                endOfPassWriteIndex: endIndex,
            },
        };
    }

    getTimestampWrites(passName) {
        return this.beginPass(null, passName)?.timestampWrites;
    }

    addToPassDescriptor(passName, descriptor) {
        if (!descriptor) return descriptor;
        const lifecycleGeneration = timestampProfilerLifecycleState(this).lifecycleGeneration;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        const stableDescriptor = this._snapshotExternalObject(
            descriptor, lifecycleGeneration,
        );
        const timestampWrites = this.getTimestampWrites(passName);
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        return timestampWrites ? { ...stableDescriptor, timestampWrites } : stableDescriptor;
    }

    markEncoded(now = monotonicNow(), frame = this._currentFrame || this._lastResolvedRead?.frame) {
        const lifecycleState = timestampProfilerLifecycleState(this);
        if (lifecycleState.destroyed) return null;
        const lifecycleGeneration = lifecycleState.lifecycleGeneration;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        if (!frame) return null;
        const frameGeneration = this._readExternal(frame, 'generation', lifecycleGeneration);
        const startedAtMs = this._readExternal(frame, 'startedAtMs', lifecycleGeneration);
        if (frameGeneration !== this.generation) return null;
        const normalizedNow = this._normalizeExternal(now, Number, lifecycleGeneration);
        const normalizedStartedAtMs = this._normalizeExternal(
            startedAtMs, Number, lifecycleGeneration,
        );
        const cpuEncodeMs = Math.max(0, normalizedNow - normalizedStartedAtMs);
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        frame.encodedAtMs = normalizedNow;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        frame.cpuEncodeMs = cpuEncodeMs;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        return frame.cpuEncodeMs;
    }

    /**
     * Mark submission and measure queue drain independently. The returned
     * promise never rejects, so telemetry cannot create an unhandled rejection.
     */
    markSubmitted(queue = undefined, metadata = {}, onSubmittedWorkDoneAuthority = undefined) {
        const lifecycleState = timestampProfilerLifecycleState(this);
        const generation = lifecycleState.lifecycleGeneration;
        if (lifecycleState.destroyed) return resolveTimestampPromise(null);
        assertTimestampProfilerAlive(this, generation);
        let drainAuthorities = lifecycleState.queueDrainEntryAuthorities;
        if (!drainAuthorities) {
            drainAuthorities = Object.freeze({ ...this._captureExternalSet([
                { name: 'markEncoded', receiver: this, key: 'markEncoded' },
                { name: 'queueQueueDrain', receiver: this, key: '_queueQueueDrain' },
                { name: 'startQueueDrain', receiver: this, key: '_startQueueDrain' },
                { name: 'captureExternalSet', receiver: this, key: '_captureExternalSet' },
            ], generation) });
            lifecycleState.queueDrainEntryAuthorities = drainAuthorities;
        }
        const activeQueue = queue === undefined
            ? this._readExternal(lifecycleState.device, 'queue', generation)
            : queue;
        const onSubmittedWorkDone = onSubmittedWorkDoneAuthority === undefined
            ? (activeQueue
                ? Reflect.apply(
                    drainAuthorities.captureExternalSet.callable,
                    drainAuthorities.captureExternalSet.receiver,
                    [[{
                        name: 'onSubmittedWorkDone',
                        receiver: activeQueue,
                        key: 'onSubmittedWorkDone',
                        optional: true,
                    }], generation],
                ).onSubmittedWorkDone
                : null)
            : onSubmittedWorkDoneAuthority;
        const source = metadata ?? {};
        const frameValue = this._readExternal(source, 'frame', generation);
        const nowValue = this._readExternal(source, 'nowMs', generation);
        const frame = frameValue || this._lastResolvedRead?.frame || this._currentFrame;
        if (!frame || this._readExternal(frame, 'generation', generation) !== this.generation) {
            return resolveTimestampPromise(null);
        }
        const submittedAtMs = Number.isFinite(nowValue) ? nowValue : monotonicNow();
        assertTimestampProfilerAlive(this, generation);
        let encodedAtMs = this._readExternal(frame, 'encodedAtMs', generation);
        if (encodedAtMs === null) {
            Reflect.apply(
                drainAuthorities.markEncoded.callable,
                drainAuthorities.markEncoded.receiver,
                [submittedAtMs, frame],
            );
            encodedAtMs = this._readExternal(frame, 'encodedAtMs', generation);
        }
        const normalizedEncodedAtMs = this._normalizeExternal(
            encodedAtMs, Number, generation,
        );
        assertTimestampProfilerAlive(this, generation);
        frame.submittedAtMs = submittedAtMs;
        assertTimestampProfilerAlive(this, generation);
        frame.cpuSubmitOverheadMs = Math.max(0, submittedAtMs - normalizedEncodedAtMs);
        assertTimestampProfilerAlive(this, generation);

        const record = { frame, submittedAtMs };
        if (lifecycleState.queueDrainTask) {
            return Reflect.apply(
                drainAuthorities.queueQueueDrain.callable,
                drainAuthorities.queueQueueDrain.receiver,
                [activeQueue, onSubmittedWorkDone, record],
            );
        }
        return Reflect.apply(
            drainAuthorities.startQueueDrain.callable,
            drainAuthorities.startQueueDrain.receiver,
            [activeQueue, onSubmittedWorkDone, [record]],
        );
    }

    _queueQueueDrain(queue, onSubmittedWorkDone, record) {
        const lifecycleState = timestampProfilerLifecycleState(this);
        const lifecycleGeneration = lifecycleState.lifecycleGeneration;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        const queuedFrames = lifecycleState.queuedQueueDrainFrames;
        try { this.coalescedQueueDrains++; }
        finally { assertTimestampProfilerAlive(this, lifecycleGeneration); }
        let existingIndex;
        try {
            existingIndex = Reflect.apply(
                NATIVE_ARRAY_FIND_INDEX, queuedFrames,
                [entry => entry.frame === record.frame],
            );
        } finally { assertTimestampProfilerAlive(this, lifecycleGeneration); }
        if (existingIndex >= 0) {
            const [existing] = Reflect.apply(
                NATIVE_ARRAY_SPLICE, queuedFrames, [existingIndex, 1],
            );
            removeTimestampArrayMirror(lifecycleState.queuedQueueDrainFramesMirror, existing);
            assertTimestampProfilerAlive(this, lifecycleGeneration);
        }
        let maxPendingQueueDrainFrames;
        try { maxPendingQueueDrainFrames = this.maxPendingQueueDrainFrames; }
        finally { assertTimestampProfilerAlive(this, lifecycleGeneration); }
        if (queuedFrames.length >= maxPendingQueueDrainFrames) {
            const dropped = Reflect.apply(NATIVE_ARRAY_SHIFT, queuedFrames, []);
            removeTimestampArrayMirror(lifecycleState.queuedQueueDrainFramesMirror, dropped);
            assertTimestampProfilerAlive(this, lifecycleGeneration);
            let droppedFrame = null;
            try { droppedFrame = dropped?.frame || null; }
            finally { assertTimestampProfilerAlive(this, lifecycleGeneration); }
            if (droppedFrame) {
                try {
                    droppedFrame.queueDrainSkippedReason = 'queue-drain-telemetry-overflow';
                } finally { assertTimestampProfilerAlive(this, lifecycleGeneration); }
            }
            try { this.droppedQueueDrainFrames++; }
            finally { assertTimestampProfilerAlive(this, lifecycleGeneration); }
        }
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        Reflect.apply(NATIVE_ARRAY_PUSH, queuedFrames, [record]);
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        pushTimestampArrayMirror(lifecycleState.queuedQueueDrainFramesMirror, record);
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        lifecycleState.queuedQueueDrainQueue = queue;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        lifecycleState.queuedQueueDrainCallable = onSubmittedWorkDone;
        writeTimestampMirror(this, '_queuedQueueDrainQueue', queue);
        writeTimestampMirror(this, '_queuedQueueDrainCallable', null);
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        if (!lifecycleState.queuedQueueDrainPromise) {
            let resolveQueued;
            assertTimestampProfilerAlive(this, lifecycleGeneration);
            lifecycleState.queuedQueueDrainPromise = new NATIVE_PROMISE(resolve => {
                resolveQueued = resolve;
            });
            assertTimestampProfilerAlive(this, lifecycleGeneration);
            lifecycleState.queuedQueueDrainResolve = resolveQueued;
            writeTimestampMirror(
                this, '_queuedQueueDrainPromise', lifecycleState.queuedQueueDrainPromise,
            );
            writeTimestampMirror(this, '_queuedQueueDrainResolve', null);
            assertTimestampProfilerAlive(this, lifecycleGeneration);
            TIMESTAMP_QUEUED_DRAIN_AUTHORITIES.set(
                this, Object.freeze({ receiver: undefined, callable: resolveQueued }),
            );
        }
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        return lifecycleState.queuedQueueDrainPromise;
    }

    _startQueueDrain(queue, onSubmittedWorkDone, records, continuationAuthorities = null) {
        const generation = this.generation;
        const lifecycleState = timestampProfilerLifecycleState(this);
        const lifecycleGeneration = lifecycleState.lifecycleGeneration;
        const lifecycleAuthorities = continuationAuthorities || Object.freeze({
            ...this._captureExternalSet([
                { name: 'settleQueueDrain', receiver: this, key: '_settleQueueDrain' },
                { name: 'finishQueueDrain', receiver: this, key: '_finishQueueDrain' },
                { name: 'startQueueDrain', receiver: this, key: '_startQueueDrain' },
            ], lifecycleGeneration),
        });
        const privateContinuation = Object.freeze({
            startQueueDrain: lifecycleAuthorities.startQueueDrain,
            lifecycleAuthorities,
        });
        const record = {
            cancelled: false,
            settled: false,
            resolve: null,
            promise: null,
            lifecycleAuthorities: null,
        };
        let resolvePublic;
        record.promise = new NATIVE_PROMISE(resolve => {
            resolvePublic = resolve;
        });
        const publicAuthority = installTimestampPublicOperationAuthority(
            record, record.promise, lifecycleGeneration,
        );
        installTimestampSettlementAuthorities(
            record, resolvePublic, null, privateContinuation,
        );
        lifecycleState.activeQueueDrain = record;
        lifecycleState.queueDrainTask = publicAuthority.promise;
        writeTimestampMirror(this, '_activeQueueDrain', record);
        writeTimestampMirror(this, '_queueDrainTask', publicAuthority.promise);
        let completion;
        try {
            if (!onSubmittedWorkDone) {
                Reflect.apply(
                    lifecycleAuthorities.settleQueueDrain.callable,
                    lifecycleAuthorities.settleQueueDrain.receiver,
                    [record, null],
                );
                Reflect.apply(
                    lifecycleAuthorities.finishQueueDrain.callable,
                    lifecycleAuthorities.finishQueueDrain.receiver,
                    [record, queue, onSubmittedWorkDone],
                );
                return publicAuthority.promise;
            }
            completion = this._invokeExternal(onSubmittedWorkDone, [], lifecycleGeneration);
        }
        catch (error) { completion = rejectTimestampPromise(error); }
        const measured = thenTimestampPromise(resolveTimestampPromise(completion), () => {
                const drainedAtMs = monotonicNow();
                if (!isTimestampRecordCancelled(record)
                    && !lifecycleState.destroyed
                    && this.generation === generation) {
                    for (const entry of records) {
                        entry.frame.queueDrainMs = Math.max(0, drainedAtMs - entry.submittedAtMs);
                    }
                }
                return records.at(-1)?.frame?.queueDrainMs ?? null;
            }, error => {
                const message = String(error?.message || error);
                if (!isTimestampRecordCancelled(record)
                    && !lifecycleState.destroyed
                    && this.generation === generation) {
                    for (const entry of records) entry.frame.queueDrainError = message;
                }
                return null;
            });
        const settled = thenTimestampPromise(
            measured,
            value => Reflect.apply(
                lifecycleAuthorities.settleQueueDrain.callable,
                lifecycleAuthorities.settleQueueDrain.receiver,
                [record, value],
            ),
            () => Reflect.apply(
                lifecycleAuthorities.settleQueueDrain.callable,
                lifecycleAuthorities.settleQueueDrain.receiver,
                [record, null],
            ),
        );
        thenTimestampPromise(
            settled,
            () => Reflect.apply(
                lifecycleAuthorities.finishQueueDrain.callable,
                lifecycleAuthorities.finishQueueDrain.receiver,
                [record, queue, onSubmittedWorkDone],
            ),
            () => Reflect.apply(
                lifecycleAuthorities.finishQueueDrain.callable,
                lifecycleAuthorities.finishQueueDrain.receiver,
                [record, queue, onSubmittedWorkDone],
            ),
        );
        return publicAuthority.promise;
    }

    _settleQueueDrain(record, value) {
        if (!claimTimestampSettlement(record)) return false;
        invokeTimestampSettlementAuthority(record, false, value);
        return true;
    }

    _finishQueueDrain(record, fallbackQueue, fallbackCallable) {
        const lifecycleState = timestampProfilerLifecycleState(this);
        if (lifecycleState.activeQueueDrain !== record) return;
        lifecycleState.activeQueueDrain = null;
        lifecycleState.queueDrainTask = null;
        writeTimestampMirror(this, '_activeQueueDrain', null);
        writeTimestampMirror(this, '_queueDrainTask', null);
        const queued = Reflect.apply(
            NATIVE_ARRAY_SPLICE, lifecycleState.queuedQueueDrainFrames, [0],
        );
        clearTimestampArrayMirror(lifecycleState.queuedQueueDrainFramesMirror);
        if (lifecycleState.queuedQueueDrainFramesMirror.length !== 0) {
            lifecycleState.queuedQueueDrainFramesMirror = [];
        }
        writeTimestampMirror(
            this, '_queuedQueueDrainFrames', lifecycleState.queuedQueueDrainFramesMirror,
        );
        const resolveQueued = lifecycleState.queuedQueueDrainResolve
            ? Object.freeze({
                receiver: undefined, callable: lifecycleState.queuedQueueDrainResolve,
            })
            : null;
        const queue = lifecycleState.queuedQueueDrainQueue || fallbackQueue;
        const onSubmittedWorkDone = lifecycleState.queuedQueueDrainCallable || fallbackCallable;
        lifecycleState.queuedQueueDrainPromise = null;
        lifecycleState.queuedQueueDrainResolve = null;
        lifecycleState.queuedQueueDrainQueue = null;
        lifecycleState.queuedQueueDrainCallable = null;
        writeTimestampMirror(this, '_queuedQueueDrainPromise', null);
        writeTimestampMirror(this, '_queuedQueueDrainResolve', null);
        TIMESTAMP_QUEUED_DRAIN_AUTHORITIES.delete(this);
        writeTimestampMirror(this, '_queuedQueueDrainQueue', null);
        writeTimestampMirror(this, '_queuedQueueDrainCallable', null);
        if (lifecycleState.destroyed || queued.length === 0) {
            if (resolveQueued) Reflect.apply(
                resolveQueued.callable, resolveQueued.receiver, [null],
            );
            return;
        }
        const continuation = TIMESTAMP_SETTLEMENT_AUTHORITIES.get(record)?.continuation;
        let next;
        try {
            next = Reflect.apply(
                continuation.startQueueDrain.callable,
                continuation.startQueueDrain.receiver,
                [queue, onSubmittedWorkDone, queued, continuation.lifecycleAuthorities],
            );
        } catch (_) {
            if (resolveQueued) Reflect.apply(
                resolveQueued.callable, resolveQueued.receiver, [null],
            );
            return;
        }
        thenTimestampPromise(
            resolveTimestampPromise(next),
            value => {
                if (resolveQueued) Reflect.apply(
                    resolveQueued.callable, resolveQueued.receiver, [value],
                );
            },
            () => {
                if (resolveQueued) Reflect.apply(
                    resolveQueued.callable, resolveQueued.receiver, [null],
                );
            },
        );
    }

    resolveAndRead(encoder, metadata = {}) {
        const lifecycleState = syncTimestampPendingReads(this);
        const lifecycleGeneration = lifecycleState.lifecycleGeneration;
        if (!this.isAvailable() || !encoder) return false;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        const cleanupAuthorities = this._captureExternalSet([
            { name: 'captureCleanup', receiver: this, key: '_captureCleanup' },
            { name: 'retireCleanup', receiver: this, key: '_retireCleanup' },
        ], lifecycleGeneration);
        const captureCleanup = (candidate, required = false) => Reflect.apply(
            cleanupAuthorities.captureCleanup.callable,
            cleanupAuthorities.captureCleanup.receiver,
            [candidate, required],
        );
        const retireCleanup = cleanup => Reflect.apply(
            cleanupAuthorities.retireCleanup.callable,
            cleanupAuthorities.retireCleanup.receiver,
            [cleanup],
        );
        const retireCandidate = candidate => retireCleanup(captureCleanup(candidate));
        const encoderAuthorities = this._captureExternalSet([
            {
                name: 'resolveQuerySet', receiver: encoder, key: 'resolveQuerySet',
            },
            {
                name: 'copyBufferToBuffer', receiver: encoder, key: 'copyBufferToBuffer',
            },
        ], lifecycleGeneration);
        const metadataGeneration = this._readExternal(metadata, 'generation', lifecycleGeneration);
        const metadataNowMs = this._readExternal(metadata, 'nowMs', lifecycleGeneration);
        const frame = this._ensureFrame();
        if (!frame) return false;
        if (Number.isInteger(metadataGeneration) && metadataGeneration !== this.generation) {
            frame.skippedReason = 'stale-generation';
            this.skippedFrames++;
            this._recordFrame(frame);
            this._resetCurrentQueries();
            this._currentFrame = null;
            return false;
        }
        if (this.queryCount === 0) {
            frame.skippedReason = 'no-profiled-passes';
            this.skippedFrames++;
            this._recordFrame(frame);
            this._currentFrame = null;
            return false;
        }

        if (lifecycleState.pendingReads.length + lifecycleState.activeReads.size
            >= this.maxPendingReads) {
            frame.skippedReason = 'readback-ring-full';
            this.skippedFrames++;
            this.droppedReadbacks++;
            this._recordFrame(frame);
            this._resetCurrentQueries();
            this._currentFrame = null;
            return false;
        }

        const queryCount = this.queryCount;
        const passes = this._currentPasses.slice();
        const byteSize = queryCount * 8;
        const createBuffer = lifecycleState.createBuffer || this._captureExternal(
            lifecycleState.device, 'createBuffer', lifecycleGeneration,
        );
        let readBuffer = null;
        let readBufferCleanup = null;
        try {
            readBuffer = this._invokeExternal(createBuffer, [{
                label: `GPU timestamp readback frame ${frame.id}`,
                size: byteSize,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            }], lifecycleGeneration, retireCandidate);
            readBufferCleanup = captureCleanup(readBuffer, true);
            assertTimestampProfilerAlive(this, lifecycleGeneration);
            this._invokeExternal(encoderAuthorities.resolveQuerySet, [
                lifecycleState.querySet, 0, queryCount, lifecycleState.resolveBuffer, 0,
            ], lifecycleGeneration);
            this._invokeExternal(encoderAuthorities.copyBufferToBuffer, [
                lifecycleState.resolveBuffer, 0, readBuffer, 0, byteSize,
            ], lifecycleGeneration);
        } catch (error) {
            if (readBufferCleanup) retireCleanup(readBufferCleanup);
            else if (readBuffer) retireCandidate(readBuffer);
            if (!lifecycleState.destroyed
                && lifecycleGeneration === lifecycleState.lifecycleGeneration) {
                frame.skippedReason = 'resolve-failed';
                this.skippedFrames++;
                this._recordFrame(frame);
                this._resetCurrentQueries();
                this._currentFrame = null;
            }
            throw error;
        }

        const read = {
            generation: this.generation,
            queryCount,
            passes,
            readBuffer: null,
            readBufferCleanup: null,
            frame,
        };
        installTimestampReadAuthority(this, read, {
            generation: this.generation,
            queryCount,
            passes,
            readBuffer,
            readBufferCleanup,
            frame,
        });
        Reflect.apply(NATIVE_ARRAY_PUSH, lifecycleState.pendingReads, [read]);
        pushTimestampArrayMirror(lifecycleState.pendingReadsMirror, read);
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        this._lastResolvedRead = read;
        this.markEncoded(Number.isFinite(metadataNowMs) ? metadataNowMs : monotonicNow(), frame);
        this._resetCurrentQueries();
        this._currentFrame = null;
        return true;
    }

    resolve(encoder, metadata = {}) {
        return this.resolveAndRead(encoder, metadata);
    }

    _resetCurrentQueries() {
        this.queryCount = 0;
        this._currentPasses = [];
    }

    _recordFrame(frame) {
        if (!frame || frame._recorded) return;
        Object.defineProperty(frame, '_recorded', { value: true, enumerable: false });
        this._history.push(frame);
        if (this._history.length > this.historySize) this._history.shift();
    }

    _updateResolutionEvidence(timestampsNs) {
        const distinct = Array.from(new Set(timestampsNs)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        let smallest = null;
        for (let index = 1; index < distinct.length; index++) {
            const delta = distinct[index] - distinct[index - 1];
            if (delta > 0n && (smallest === null || delta < smallest)) smallest = delta;
        }
        if (smallest === null) return;
        const deltaNs = Number(smallest);
        const evidence = this.timerResolutionEvidence;
        evidence.observationCount++;
        if (evidence.smallestObservedDeltaNs === null || deltaNs < evidence.smallestObservedDeltaNs) {
            evidence.smallestObservedDeltaNs = deltaNs;
        }
    }

    _destroyReadBuffer(read) {
        return this._retireReadBufferCleanup(this._captureReadBufferCleanup(read));
    }

    _captureReadBufferCleanup(read, captureCleanupAuthority = null) {
        const readAuthority = read
            ? (TIMESTAMP_READ_AUTHORITIES.get(read)
                || installTimestampReadAuthority(this, read))
            : null;
        const buffer = readAuthority?.readBuffer;
        return Object.freeze({
            buffer,
            cleanup: readAuthority?.readBufferCleanup || (captureCleanupAuthority
                ? Reflect.apply(
                    captureCleanupAuthority.callable,
                    captureCleanupAuthority.receiver,
                    [buffer],
                )
                : this._captureCleanup(buffer)),
        });
    }

    _retireReadBufferCleanup(snapshot, retireCleanupAuthority = null) {
        const buffer = snapshot?.buffer;
        const destroyedReadBuffers = timestampProfilerLifecycleState(this).destroyedReadBuffers;
        if (!buffer || Reflect.apply(NATIVE_WEAK_SET_HAS, destroyedReadBuffers, [buffer])) {
            return false;
        }
        Reflect.apply(NATIVE_WEAK_SET_ADD, destroyedReadBuffers, [buffer]);
        if (retireCleanupAuthority) {
            Reflect.apply(
                retireCleanupAuthority.callable,
                retireCleanupAuthority.receiver,
                [snapshot.cleanup],
            );
        } else this._retireCleanup(snapshot.cleanup);
        return true;
    }

    _createPublicOperation(kind) {
        const lifecycleState = timestampProfilerLifecycleState(this);
        const lifecycleGeneration = lifecycleState.lifecycleGeneration;
        assertTimestampProfilerAlive(this, lifecycleGeneration);
        let resolve;
        let reject;
        const operation = {
            kind,
            generation: lifecycleGeneration,
            settled: false,
            resolve: null,
            reject: null,
            promise: null,
            cancellation: null,
        };
        operation.promise = new NATIVE_PROMISE((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        installTimestampPublicOperationAuthority(
            operation, operation.promise, lifecycleGeneration,
        );
        installTimestampSettlementAuthorities(operation, resolve, reject);
        silenceTimestampPromise(operation.promise);
        let cancelWait;
        operation.cancellation = new NATIVE_PROMISE(resolveCancellation => {
            cancelWait = resolveCancellation;
        });
        installTimestampCancellationAuthority(
            operation, operation.cancellation, cancelWait,
        );
        Reflect.apply(NATIVE_SET_ADD, lifecycleState.publicOperations, [operation]);
        Reflect.apply(NATIVE_SET_ADD, lifecycleState.publicOperationsMirror, [operation]);
        return operation;
    }

    _isPublicOperationCurrent(operation) {
        const operationAuthority = operation
            ? TIMESTAMP_PUBLIC_OPERATION_AUTHORITIES.get(operation)
            : null;
        const lifecycleState = timestampProfilerLifecycleState(this);
        return Boolean(operation)
            && Boolean(operationAuthority)
            && isTimestampSettlementPending(operation)
            && Reflect.apply(
                NATIVE_SET_HAS,
                lifecycleState.publicOperations,
                [operation],
            )
            && !lifecycleState.destroyed
            && operationAuthority.generation === lifecycleState.lifecycleGeneration;
    }

    _assertPublicOperationCurrent(operation) {
        if (!this._isPublicOperationCurrent(operation)) {
            throw timestampProfilerLifecycleError(this);
        }
    }

    _settlePublicOperation(operation, value, error) {
        if (!operation || !claimTimestampSettlement(operation)) return false;
        const lifecycleState = timestampProfilerLifecycleState(this);
        Reflect.apply(NATIVE_SET_DELETE, lifecycleState.publicOperations, [operation]);
        Reflect.apply(NATIVE_SET_DELETE, lifecycleState.publicOperationsMirror, [operation]);
        invokeTimestampSettlementAuthority(operation, Boolean(error), error || value);
        return true;
    }

    _startDetailedOperation(kind, project) {
        const generation = timestampProfilerLifecycleState(this).lifecycleGeneration;
        let lifecycleAuthorities;
        try {
            lifecycleAuthorities = this._captureExternalSet([
                { name: 'createPublicOperation', receiver: this, key: '_createPublicOperation' },
                { name: 'consumeDetailedResult', receiver: this, key: '_consumeDetailedResult' },
                { name: 'isPublicCurrent', receiver: this, key: '_isPublicOperationCurrent' },
                { name: 'settlePublicOperation', receiver: this, key: '_settlePublicOperation' },
            ], generation);
        } catch (error) { return rejectTimestampPublicPromise(error); }
        let operation;
        try {
            operation = Reflect.apply(
                lifecycleAuthorities.createPublicOperation.callable,
                lifecycleAuthorities.createPublicOperation.receiver,
                [kind],
            );
        }
        catch (error) { return rejectTimestampPublicPromise(error); }
        const operationAuthority = TIMESTAMP_PUBLIC_OPERATION_AUTHORITIES.get(operation);
        if (!operationAuthority) {
            const error = new Error('[GPUProfiler] Missing public operation authority');
            Reflect.apply(
                lifecycleAuthorities.settlePublicOperation.callable,
                lifecycleAuthorities.settlePublicOperation.receiver,
                [operation, null, error],
            );
            return rejectTimestampPublicPromise(error);
        }
        const publicPromise = operationAuthority.promise;
        let backend;
        try {
            backend = Reflect.apply(
                lifecycleAuthorities.consumeDetailedResult.callable,
                lifecycleAuthorities.consumeDetailedResult.receiver,
                [operation],
            );
        }
        catch (error) {
            Reflect.apply(
                lifecycleAuthorities.settlePublicOperation.callable,
                lifecycleAuthorities.settlePublicOperation.receiver,
                [operation, null, error],
            );
            return publicPromise;
        }
        thenTimestampPromise(resolveTimestampPromise(backend),
            value => {
                if (!Reflect.apply(
                    lifecycleAuthorities.isPublicCurrent.callable,
                    lifecycleAuthorities.isPublicCurrent.receiver,
                    [operation],
                )) return;
                let projected;
                try { projected = project(value); }
                catch (error) {
                    Reflect.apply(
                        lifecycleAuthorities.settlePublicOperation.callable,
                        lifecycleAuthorities.settlePublicOperation.receiver,
                        [operation, null, error],
                    );
                    return;
                }
                Reflect.apply(
                    lifecycleAuthorities.settlePublicOperation.callable,
                    lifecycleAuthorities.settlePublicOperation.receiver,
                    [operation, projected, null],
                );
            },
            error => {
                if (Reflect.apply(
                    NATIVE_SET_HAS,
                    timestampProfilerLifecycleState(this).publicOperations,
                    [operation],
                )) {
                    Reflect.apply(
                        lifecycleAuthorities.settlePublicOperation.callable,
                        lifecycleAuthorities.settlePublicOperation.receiver,
                        [operation, null, error],
                    );
                }
            },
        );
        return publicPromise;
    }

    async _consumeDetailedResult(operation) {
        const operationAuthority = TIMESTAMP_PUBLIC_OPERATION_AUTHORITIES.get(operation);
        if (!operationAuthority) {
            throw new Error('[GPUProfiler] Missing public operation authority');
        }
        const operationGeneration = operationAuthority.generation;
        const cancellationAuthorities = TIMESTAMP_CANCELLATION_AUTHORITIES.get(operation);
        const cancellation = cancellationAuthorities?.promise;
        if (!cancellation) throw new Error('[GPUProfiler] Missing cancellation authority');
        const lifecycleState = syncTimestampPendingReads(this);
        const cleanupAuthorities = this._captureExternalSet([
            {
                name: 'captureReadCleanup', receiver: this, key: '_captureReadBufferCleanup',
            },
            {
                name: 'retireReadCleanup', receiver: this, key: '_retireReadBufferCleanup',
            },
            {
                name: 'isPublicCurrent', receiver: this, key: '_isPublicOperationCurrent',
            },
            {
                name: 'lifecycleError', receiver: this, key: '_lifecycleError',
            },
            {
                name: 'captureCleanup', receiver: this, key: '_captureCleanup',
            },
            {
                name: 'retireCleanup', receiver: this, key: '_retireCleanup',
            },
            {
                name: 'updateResolutionEvidence',
                receiver: this,
                key: '_updateResolutionEvidence',
            },
            {
                name: 'recordFrame', receiver: this, key: '_recordFrame',
            },
            {
                name: 'getStats', receiver: this, key: 'getStats',
            },
        ], operationGeneration);
        const lifecycleError = () => Reflect.apply(
            cleanupAuthorities.lifecycleError.callable,
            cleanupAuthorities.lifecycleError.receiver,
            [],
        );
        const assertPublicCurrent = () => {
            if (!Reflect.apply(
                cleanupAuthorities.isPublicCurrent.callable,
                cleanupAuthorities.isPublicCurrent.receiver,
                [operation],
            )) throw lifecycleError();
        };
        const invokeCurrent = (authority, args = []) => {
            assertPublicCurrent();
            let result;
            let callError = null;
            try { result = Reflect.apply(authority.callable, authority.receiver, args); }
            catch (error) { callError = error; }
            assertPublicCurrent();
            if (callError) throw callError;
            return result;
        };
        const mutateCurrent = mutation => {
            assertPublicCurrent();
            let callError = null;
            try { mutation(); }
            catch (error) { callError = error; }
            assertPublicCurrent();
            if (callError) throw callError;
        };
        assertPublicCurrent();
        if (lifecycleState.pendingReads.length === 0) {
            const telemetry = invokeCurrent(cleanupAuthorities.getStats);
            assertPublicCurrent();
            return emptyDetailedResult(telemetry);
        }
        const read = Reflect.apply(NATIVE_ARRAY_SHIFT, lifecycleState.pendingReads, []);
        removeTimestampArrayMirror(lifecycleState.pendingReadsMirror, read);
        const readAuthority = TIMESTAMP_READ_AUTHORITIES.get(read)
            || installTimestampReadAuthority(this, read);
        Reflect.apply(NATIVE_SET_ADD, lifecycleState.activeReads, [read]);
        Reflect.apply(NATIVE_SET_ADD, lifecycleState.activeReadsMirror, [read]);
        let mapped = false;
        let unmap = null;
        try {
            assertPublicCurrent();
            if (readAuthority.generation !== this.generation || lifecycleState.destroyed) {
                throw lifecycleError();
            }

            const readAuthorities = this._captureExternalSet([
                {
                    name: 'mapAsync', receiver: readAuthority.readBuffer, key: 'mapAsync',
                },
                {
                    name: 'getMappedRange', receiver: readAuthority.readBuffer, key: 'getMappedRange',
                },
                {
                    name: 'unmap', receiver: readAuthority.readBuffer, key: 'unmap', optional: true,
                },
            ], operationGeneration);
            const mapAsync = readAuthorities.mapAsync;
            const getMappedRange = readAuthorities.getMappedRange;
            unmap = readAuthorities.unmap;
            const mapping = this._invokeExternal(
                mapAsync, [GPUMapMode.READ], operationGeneration,
            );
            const mappingOutcome = await raceTimestampPromises([
                thenTimestampPromise(resolveTimestampPromise(mapping),
                    () => ({ status: 'mapped' }),
                    error => ({ status: 'rejected', error }),
                ),
                thenTimestampPromise(cancellation,
                    error => ({ status: 'cancelled', error }),
                ),
            ]);
            if (mappingOutcome.status === 'cancelled') throw mappingOutcome.error;
            if (mappingOutcome.status === 'rejected') throw mappingOutcome.error;
            assertPublicCurrent();
            mapped = true;
            if (readAuthority.generation !== this.generation || lifecycleState.destroyed) {
                throw lifecycleError();
            }

            const mappedRange = this._invokeExternal(
                getMappedRange, [0, readAuthority.queryCount * 8], operationGeneration,
            );
            assertPublicCurrent();
            const view = new BigUint64Array(mappedRange);
            const timestampsNs = Array.from(view);
            assertPublicCurrent();
            const passes = [];
            for (const pass of readAuthority.passes) {
                const start = timestampsNs[pass.beginIndex];
                const end = timestampsNs[pass.endIndex];
                if (start === undefined || end === undefined || end < start) continue;
                passes.push({
                    ...pass,
                    durationMs: Number(end - start) / 1_000_000,
                });
            }
            assertPublicCurrent();
            const nextResults = new Map();
            for (const pass of passes) {
                nextResults.set(
                    pass.passName,
                    (nextResults.get(pass.passName) || 0) + pass.durationMs,
                );
            }
            const nextGpuPasses = Object.fromEntries(nextResults);
            const nextGpuMs = passes.reduce((total, pass) => total + pass.durationMs, 0);

            mutateCurrent(() => { readAuthority.frame.gpuPasses = nextGpuPasses; });
            mutateCurrent(() => { readAuthority.frame.gpuMs = nextGpuMs; });
            invokeCurrent(cleanupAuthorities.updateResolutionEvidence, [timestampsNs]);
            mutateCurrent(() => { this._lastResults = nextResults; });
            invokeCurrent(cleanupAuthorities.recordFrame, [readAuthority.frame]);
            const telemetry = invokeCurrent(cleanupAuthorities.getStats);

            const detailed = {
                durations: passes.map(pass => pass.durationMs),
                timestampsNs,
                passNames: passes.map(pass => pass.passName),
                passes,
                frame: readAuthority.frame,
                telemetry,
            };
            mutateCurrent(() => { this._lastDetailed = detailed; });
            assertPublicCurrent();
            return detailed;
        } catch (error) {
            if (lifecycleState.destroyed || readAuthority.generation !== this.generation) {
                throw lifecycleError();
            }
            throw error;
        } finally {
            Reflect.apply(NATIVE_SET_DELETE, lifecycleState.activeReads, [read]);
            Reflect.apply(NATIVE_SET_DELETE, lifecycleState.activeReadsMirror, [read]);
            const readCleanup = Reflect.apply(
                cleanupAuthorities.captureReadCleanup.callable,
                cleanupAuthorities.captureReadCleanup.receiver,
                [read, cleanupAuthorities.captureCleanup],
            );
            const operationCurrent = Reflect.apply(
                cleanupAuthorities.isPublicCurrent.callable,
                cleanupAuthorities.isPublicCurrent.receiver,
                [operation],
            );
            if (mapped && operationCurrent && unmap) {
                try { Reflect.apply(unmap.callable, unmap.receiver, []); } catch (_) {}
            }
            Reflect.apply(
                cleanupAuthorities.retireReadCleanup.callable,
                cleanupAuthorities.retireReadCleanup.receiver,
                [readCleanup, cleanupAuthorities.retireCleanup],
            );
        }
    }

    getResults() {
        return this._startDetailedOperation('results', detailed => detailed.durations);
    }

    getDetailedResults() {
        return this._startDetailedOperation('detailed-results', detailed => detailed);
    }

    readResults() {
        return this._startDetailedOperation('read-results', detailed => detailed);
    }

    getLatestFrame() {
        return this._history[this._history.length - 1] || null;
    }

    getHistory() {
        return this._history.map(frame => ({ ...frame, gpuPasses: { ...frame.gpuPasses } }));
    }

    getStats() {
        const lifecycleState = syncTimestampPendingReads(this);
        return {
            enabled: this.isAvailable(),
            generation: this.generation,
            pendingReads: lifecycleState.pendingReads.length,
            activeReads: lifecycleState.activeReads.size,
            maxPendingReads: this.maxPendingReads,
            pendingQueueDrainTasks: lifecycleState.queueDrainTask ? 1 : 0,
            queuedQueueDrainFrames: lifecycleState.queuedQueueDrainFrames.length,
            maxPendingQueueDrainFrames: this.maxPendingQueueDrainFrames,
            coalescedQueueDrains: this.coalescedQueueDrains,
            droppedQueueDrainFrames: this.droppedQueueDrainFrames,
            droppedReadbacks: this.droppedReadbacks,
            skippedFrames: this.skippedFrames,
            skippedPasses: this.skippedPasses,
            staleReadbacks: this.staleReadbacks,
            recordedPasses: this._currentPasses.length,
            passTimingsMs: Object.fromEntries(this._lastResults),
            latestFrame: this.getLatestFrame(),
            timerResolutionEvidence: { ...this.timerResolutionEvidence },
        };
    }

    getStatsString() {
        const parts = Array.from(this._lastResults, ([name, duration]) => `${name}: ${duration.toFixed(2)}ms`);
        const total = Array.from(this._lastResults.values()).reduce((sum, duration) => sum + duration, 0);
        parts.push(`total: ${total.toFixed(2)}ms`);
        return parts.join(' | ');
    }

    invalidateGeneration(nextGeneration) {
        if (nextGeneration === this.generation) return false;
        this.destroy();
        return true;
    }

    destroy() {
        const lifecycleState = syncTimestampPendingReads(this);
        if (lifecycleState.destroyed) return false;

        const lifecycleGeneration = lifecycleState.lifecycleGeneration;
        const pendingReads = [...lifecycleState.pendingReads];
        const activeReads = [...lifecycleState.activeReads];
        const reads = [...new Set([...pendingReads, ...activeReads])];
        const operations = [...lifecycleState.publicOperations];
        const operationCleanups = operations.map(operation => {
            const settlement = TIMESTAMP_SETTLEMENT_AUTHORITIES.get(operation);
            return Object.freeze({
                operation,
                cancel: TIMESTAMP_CANCELLATION_AUTHORITIES.get(operation)?.cancel || null,
                reject: settlement?.reject || null,
            });
        });
        const authorities = lifecycleState.destroyAuthorities;
        const readCleanups = reads.map(read => Reflect.apply(
            authorities.captureReadCleanup.callable,
            authorities.captureReadCleanup.receiver,
            [read, authorities.captureCleanup],
        ));
        const queuedQueueDrainResolve = lifecycleState.queuedQueueDrainResolve
            ? Object.freeze({
                receiver: undefined, callable: lifecycleState.queuedQueueDrainResolve,
            })
            : null;
        const activeQueueDrain = lifecycleState.activeQueueDrain;
        const activeQueueDrainResolve = activeQueueDrain
            ? TIMESTAMP_SETTLEMENT_AUTHORITIES.get(activeQueueDrain)?.resolve || null
            : null;
        const querySetCleanup = lifecycleState.querySetCleanup;
        const resolveBufferCleanup = lifecycleState.resolveBufferCleanup;

        lifecycleState.destroyed = true;
        lifecycleState.lifecycleGeneration++;
        writeTimestampMirror(this, '_destroyed', true);
        writeTimestampMirror(
            this, '_lifecycleGeneration', lifecycleState.lifecycleGeneration,
        );
        const destroyError = Reflect.apply(
            authorities.lifecycleError.callable,
            authorities.lifecycleError.receiver,
            [],
        );
        lifecycleState.destroyError = destroyError;
        writeTimestampMirror(this, '_destroyError', destroyError);
        writeTimestampMirror(this, 'enabled', false);
        try {
            Reflect.apply(
                authorities.resetQueries.callable, authorities.resetQueries.receiver, [],
            );
        } catch (_) {}
        writeTimestampMirror(this, '_currentFrame', null);
        lifecycleState.pendingReads.length = 0;
        clearTimestampArrayMirror(lifecycleState.pendingReadsMirror);
        if (lifecycleState.pendingReadsMirror.length !== 0) {
            lifecycleState.pendingReadsMirror = [];
        }
        writeTimestampMirror(this, 'pendingReads', lifecycleState.pendingReadsMirror);
        lifecycleState.querySetCleanup = null;
        lifecycleState.resolveBufferCleanup = null;
        lifecycleState.querySet = null;
        lifecycleState.resolveBuffer = null;
        writeTimestampMirror(this, '_querySetCleanup', null);
        writeTimestampMirror(this, '_resolveBufferCleanup', null);
        writeTimestampMirror(this, 'querySet', null);
        writeTimestampMirror(this, 'resolveBuffer', null);
        Reflect.apply(NATIVE_SET_CLEAR, lifecycleState.publicOperations, []);
        Reflect.apply(NATIVE_SET_CLEAR, lifecycleState.publicOperationsMirror, []);
        writeTimestampMirror(this, '_publicOperations', lifecycleState.publicOperationsMirror);
        for (const cleanup of operationCleanups) {
            const { operation, cancel, reject } = cleanup;
            if (!claimTimestampSettlement(operation)) continue;
            if (cancel) {
                try { Reflect.apply(cancel.callable, cancel.receiver, [destroyError]); }
                catch (_) {}
            }
            if (reject) {
                try { Reflect.apply(reject.callable, reject.receiver, [destroyError]); }
                catch (_) {}
            }
        }
        if (activeQueueDrain && claimTimestampSettlement(activeQueueDrain)) {
            cancelTimestampRecord(activeQueueDrain);
            writeTimestampMirror(activeQueueDrain, 'cancelled', true);
            try {
                if (activeQueueDrainResolve) Reflect.apply(
                    activeQueueDrainResolve.callable, activeQueueDrainResolve.receiver, [null],
                );
            }
            catch (_) {}
        }
        try {
            if (queuedQueueDrainResolve) Reflect.apply(
                queuedQueueDrainResolve.callable, queuedQueueDrainResolve.receiver, [null],
            );
        }
        catch (_) {}
        for (const cleanup of readCleanups) Reflect.apply(
            authorities.retireReadCleanup.callable,
            authorities.retireReadCleanup.receiver,
            [cleanup, authorities.retireCleanup],
        );
        Reflect.apply(NATIVE_SET_CLEAR, lifecycleState.activeReads, []);
        Reflect.apply(NATIVE_SET_CLEAR, lifecycleState.activeReadsMirror, []);
        writeTimestampMirror(this, '_activeReads', lifecycleState.activeReadsMirror);
        lifecycleState.queuedQueueDrainFrames.length = 0;
        clearTimestampArrayMirror(lifecycleState.queuedQueueDrainFramesMirror);
        if (lifecycleState.queuedQueueDrainFramesMirror.length !== 0) {
            lifecycleState.queuedQueueDrainFramesMirror = [];
        }
        writeTimestampMirror(
            this, '_queuedQueueDrainFrames', lifecycleState.queuedQueueDrainFramesMirror,
        );
        lifecycleState.activeQueueDrain = null;
        lifecycleState.queueDrainTask = null;
        lifecycleState.queuedQueueDrainPromise = null;
        lifecycleState.queuedQueueDrainResolve = null;
        lifecycleState.queuedQueueDrainQueue = null;
        lifecycleState.queuedQueueDrainCallable = null;
        writeTimestampMirror(this, '_activeQueueDrain', null);
        writeTimestampMirror(this, '_queueDrainTask', null);
        writeTimestampMirror(this, '_queuedQueueDrainPromise', null);
        writeTimestampMirror(this, '_queuedQueueDrainResolve', null);
        TIMESTAMP_QUEUED_DRAIN_AUTHORITIES.delete(this);
        writeTimestampMirror(this, '_queuedQueueDrainQueue', null);
        writeTimestampMirror(this, '_queuedQueueDrainCallable', null);
        writeTimestampMirror(this, '_lastResolvedRead', null);
        writeTimestampMirror(this, '_createQuerySet', null);
        writeTimestampMirror(this, '_createBuffer', null);
        writeTimestampMirror(this, '_featuresHas', null);
        lifecycleState.createQuerySet = null;
        lifecycleState.createBuffer = null;
        lifecycleState.featuresHas = null;
        lifecycleState.device = null;
        writeTimestampMirror(this, 'device', null);
        Reflect.apply(
            authorities.retireCleanup.callable,
            authorities.retireCleanup.receiver,
            [querySetCleanup],
        );
        Reflect.apply(
            authorities.retireCleanup.callable,
            authorities.retireCleanup.receiver,
            [resolveBufferCleanup],
        );
        return true;
    }
}

export default GPUTimestampProfiler;
