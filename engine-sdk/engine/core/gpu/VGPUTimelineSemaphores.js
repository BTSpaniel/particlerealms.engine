// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GPU Timeline Semaphores - Advanced sync for multi-engine scenarios.
 */

// Barrier aggregation must not rediscover mutable global Promise members after
// caller-controlled iterator/getter code has run.
const NATIVE_PROMISE = Promise;
const NATIVE_PROMISE_ALL = Promise.all;
const NATIVE_PROMISE_REJECT = Promise.reject;
const NATIVE_PROMISE_RESOLVE = Promise.resolve;
const NATIVE_PROMISE_THEN = Promise.prototype.then;
const NATIVE_ARRAY_PUSH = Array.prototype.push;

function BarrierPromise(executor) {
    return new NATIVE_PROMISE(executor);
}

Object.defineProperty(BarrierPromise, 'resolve', {
    value(value) {
        // Promise.all dynamically invokes C.resolve and each result's then.
        // Keep both authorities private so hostile input getters cannot replace
        // either callable between barrier staging and aggregation.
        return {
            then(resolve, reject) {
                return Reflect.apply(NATIVE_PROMISE_THEN, value, [resolve, reject]);
            },
        };
    },
    configurable: false,
    enumerable: false,
    writable: false,
});

function timelineError(message, code = 'VGPU_TIMELINE_DESTROYED') {
    const error = new Error(message);
    error.code = code;
    return error;
}

function destroyResource(resource) {
    if (!resource) return;
    let destroy = null;
    try { destroy = resource.destroy; } catch (_) { return; }
    if (typeof destroy !== 'function') return;
    try { Reflect.apply(destroy, resource, []); } catch (_) {}
}

export class VGPUTimelineSemaphores {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        this._semaphores = new Map();
        this._nextId = 0;
        this._timelines = new Map();
        this._frameSyncs = new Set();
        this._activeSignals = new Set();
        this._timestampSupported = false;
        this._timestampQuerySet = null;
        this._timestampBuffer = null;
        this._destroyed = false;
        this._generation = 0;
        this._checkTimestampSupport();
    }

    _assertActive(operation = 'perform work') {
        if (this._destroyed || !this.device) {
            throw timelineError(`Timeline semaphore manager is destroyed; cannot ${operation}`);
        }
        return this._generation;
    }

    _isGeneration(generation) {
        return !this._destroyed && generation === this._generation;
    }

    _assertGeneration(generation, operation) {
        if (!this._isGeneration(generation)) {
            throw timelineError(`Timeline semaphore manager is destroyed; cannot ${operation}`);
        }
    }

    _readExternalMember(receiver, key, generation, operation) {
        this._assertGeneration(generation, operation);
        let value;
        try {
            value = receiver?.[key];
        } finally {
            this._assertGeneration(generation, operation);
        }
        return value;
    }

    _captureExternalCallable(receiver, key, generation, operation) {
        const callable = this._readExternalMember(receiver, key, generation, operation);
        if (typeof callable !== 'function') {
            throw new TypeError(`[Timeline] ${String(key)} is not callable`);
        }
        this._assertGeneration(generation, operation);
        return { receiver, callable };
    }

    _silenceExternalPromise(value) {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
        try {
            Reflect.apply(NATIVE_PROMISE_THEN, value, [() => {}, () => {}]);
        } catch (_) {}
    }

    _invokeCapturedExternal(captured, args, generation, operation, retireResult = null) {
        this._assertGeneration(generation, operation);
        let result;
        let callError = null;
        try {
            result = Reflect.apply(captured.callable, captured.receiver, args);
        } catch (error) {
            callError = error;
        }
        try {
            this._assertGeneration(generation, operation);
        } catch (error) {
            this._silenceExternalPromise(result);
            if (retireResult && result) {
                try { retireResult(result); } catch (_) {}
            }
            throw error;
        }
        if (callError) throw callError;
        return result;
    }

    _callExternal(receiver, key, args, generation, operation, retireResult = null) {
        const captured = this._captureExternalCallable(receiver, key, generation, operation);
        return this._invokeCapturedExternal(
            captured, args, generation, operation, retireResult,
        );
    }

    _snapshotNumber(value, generation, operation) {
        let normalized;
        try {
            normalized = Number(value);
        } finally {
            this._assertGeneration(generation, operation);
        }
        return normalized;
    }

    _snapshotBarrierEntries(semaphores, generation) {
        const operation = 'snapshot semaphore barrier inputs';
        const iteratorFactory = this._captureExternalCallable(
            semaphores, Symbol.iterator, generation, `${operation} iterator`,
        );
        const iterator = this._invokeCapturedExternal(
            iteratorFactory, [], generation, `${operation} iterator`,
        );
        const next = this._captureExternalCallable(
            iterator, 'next', generation, `${operation} next`,
        );
        const entries = [];

        while (true) {
            const step = this._invokeCapturedExternal(
                next, [], generation, `${operation} next`,
            );
            if (!step || (typeof step !== 'object' && typeof step !== 'function')) {
                throw new TypeError('[Timeline] Semaphore barrier iterator returned a non-object result');
            }
            const done = this._readExternalMember(
                step, 'done', generation, `${operation} done`,
            );
            if (done) break;

            const entry = this._readExternalMember(
                step, 'value', generation, `${operation} value`,
            );
            const semaphore = this._readExternalMember(
                entry, 'semaphore', generation, `${operation} semaphore`,
            );
            const value = this._readExternalMember(
                entry, 'value', generation, `${operation} target value`,
            );
            const id = this._resolveId(
                semaphore, generation, `${operation} semaphore id`,
            );
            const normalizedValue = this._snapshotNumber(
                value, generation, `${operation} target value`,
            );
            this._invokeCapturedExternal(
                { receiver: entries, callable: NATIVE_ARRAY_PUSH },
                [{ semaphore: id, value: normalizedValue }],
                generation,
                `${operation} publication`,
            );
        }

        this._assertGeneration(generation, operation);
        return entries;
    }

    _checkTimestampSupport() {
        const generation = this._assertActive('initialize timestamp support');
        let querySet = null;
        let buffer = null;
        try {
            const device = this.device;
            const features = this._readExternalMember(
                device, 'features', generation, 'read timestamp feature set',
            );
            const supported = this._callExternal(
                features, 'has', ['timestamp-query'], generation, 'inspect timestamp support',
            );
            if (!supported) return;

            querySet = this._callExternal(device, 'createQuerySet', [{
                type: 'timestamp',
                count: 256,
                label: 'TimelineSemaphore_Timestamps',
            }], generation, 'initialize timestamp queries', destroyResource);
            buffer = this._callExternal(device, 'createBuffer', [{
                size: 256 * 8,
                usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
                label: 'TimelineSemaphore_TimestampBuffer',
            }], generation, 'initialize timestamp storage', destroyResource);

            this._timestampSupported = true;
            this._timestampQuerySet = querySet;
            this._timestampBuffer = buffer;
            querySet = null;
            buffer = null;
        } catch (error) {
            destroyResource(buffer);
            destroyResource(querySet);
            throw error;
        }
    }

    create(initialValue = 0) {
        const generation = this._assertActive('create a semaphore');
        const normalizedInitialValue = this._snapshotNumber(
            initialValue, generation, 'normalize a semaphore initial value',
        );
        const id = this._nextId++;
        const semaphore = new TimelineSemaphore(this, id, normalizedInitialValue, generation);
        this._semaphores.set(id, semaphore);
        this._timelines.set(id, {
            value: normalizedInitialValue,
            waiters: [],
            history: [],
        });
        return semaphore;
    }

    get(id) {
        if (this._destroyed || !this._semaphores) return undefined;
        return this._semaphores.get(id);
    }

    _resolveId(semaphore, generation, operation) {
        let id;
        if (typeof semaphore === 'number') {
            id = semaphore;
        } else {
            try {
                id = semaphore?.id;
            } finally {
                this._assertGeneration(generation, operation);
            }
        }
        return id;
    }

    signal(semaphore, value) {
        const generation = this._assertActive('signal a semaphore');
        const id = this._resolveId(semaphore, generation, 'signal a semaphore');
        const normalizedValue = this._snapshotNumber(
            value, generation, 'normalize a semaphore signal value',
        );
        const timeline = this._timelines.get(id);
        if (!timeline) {
            throw timelineError(`Unknown semaphore: ${id}`, 'VGPU_SEMAPHORE_DESTROYED');
        }
        if (normalizedValue <= timeline.value) return false;

        timeline.value = normalizedValue;
        timeline.history.push({ value: normalizedValue, timestamp: performance.now(), type: 'signal' });
        const ready = timeline.waiters.filter(waiter => waiter.value <= normalizedValue);
        timeline.waiters = timeline.waiters.filter(waiter => waiter.value > normalizedValue);
        for (const waiter of ready) this._settleWaiter(waiter, true, normalizedValue);
        return true;
    }

    wait(semaphore, value, timeoutMs = 5000) {
        let generation;
        let id;
        let normalizedValue;
        let normalizedTimeout;
        try {
            generation = this._assertActive('wait on a semaphore');
            id = this._resolveId(semaphore, generation, 'wait on a semaphore');
            normalizedValue = this._snapshotNumber(
                value, generation, 'normalize a semaphore wait value',
            );
            normalizedTimeout = this._snapshotNumber(
                timeoutMs, generation, 'normalize a semaphore wait timeout',
            );
        } catch (error) {
            return Reflect.apply(NATIVE_PROMISE_REJECT, NATIVE_PROMISE, [error]);
        }
        const timeline = this._timelines.get(id);
        if (!timeline) {
            return Reflect.apply(NATIVE_PROMISE_REJECT, NATIVE_PROMISE, [timelineError(
                `Unknown semaphore: ${id}`,
                'VGPU_SEMAPHORE_DESTROYED',
            )]);
        }
        if (timeline.value >= normalizedValue) {
            return Reflect.apply(NATIVE_PROMISE_RESOLVE, NATIVE_PROMISE, [timeline.value]);
        }

        return new NATIVE_PROMISE((resolve, reject) => {
            const waiter = {
                value: normalizedValue,
                resolve,
                reject,
                timer: null,
                settled: false,
            };
            let timer = null;
            try {
                if (normalizedTimeout > 0) {
                    timer = setTimeout(() => {
                    const current = this._timelines?.get(id);
                    if (current) {
                        const index = current.waiters.indexOf(waiter);
                        if (index >= 0) current.waiters.splice(index, 1);
                    }
                    this._settleWaiter(waiter, false, timelineError(
                            `Semaphore wait timeout: wanted ${normalizedValue}, current ${timeline.value}`,
                        'VGPU_SEMAPHORE_TIMEOUT',
                    ));
                    }, normalizedTimeout);
                    this._assertGeneration(generation, 'schedule a semaphore wait');
                }
                if (this._timelines.get(id) !== timeline) {
                    throw timelineError('Semaphore was destroyed before its wait could be published');
                }
                waiter.timer = timer;
                timeline.waiters.push(waiter);
                timeline.history.push({
                    value: normalizedValue,
                    timestamp: performance.now(),
                    type: 'wait',
                });
                this._assertGeneration(generation, 'publish a semaphore wait');
            } catch (error) {
                if (timer !== null) {
                    try { clearTimeout(timer); } catch (_) {}
                }
                this._settleWaiter(waiter, false, error);
            }
        });
    }

    _settleWaiter(waiter, success, value) {
        if (!waiter || waiter.settled) return false;
        waiter.settled = true;
        if (waiter.timer !== null) {
            clearTimeout(waiter.timer);
            waiter.timer = null;
        }
        if (success) waiter.resolve(value);
        else waiter.reject(value);
        return true;
    }

    getValue(semaphore) {
        if (this._destroyed || !this._timelines) return 0;
        const id = typeof semaphore === 'number' ? semaphore : semaphore?.id;
        if (this._destroyed || !this._timelines) return 0;
        return this._timelines.get(id)?.value ?? 0;
    }

    createGPUSignal(semaphore, value) {
        const generation = this._assertActive('create a GPU signal');
        const id = this._resolveId(semaphore, generation, 'create a GPU signal');
        const normalizedValue = this._snapshotNumber(
            value, generation, 'normalize a GPU signal value',
        );
        if (!this._timelines.has(id)) {
            throw timelineError(`Unknown semaphore: ${id}`, 'VGPU_SEMAPHORE_DESTROYED');
        }
        return () => this._startGPUSignal(id, normalizedValue, generation);
    }

    _startGPUSignal(id, value, generation) {
        try {
            this._assertGeneration(generation, 'start a GPU signal');
            if (!this._timelines.has(id)) {
                throw timelineError(`Unknown semaphore: ${id}`, 'VGPU_SEMAPHORE_DESTROYED');
            }
        } catch (error) {
            return Promise.reject(error);
        }

        let resolvePublic;
        let rejectPublic;
        const promise = new Promise((resolve, reject) => {
            resolvePublic = resolve;
            rejectPublic = reject;
        });
        const record = {
            id,
            value,
            generation,
            promise,
            resolve: resolvePublic,
            reject: rejectPublic,
            settled: false,
        };
        this._activeSignals.add(record);

        let rawPromise;
        try {
            const device = this.device;
            const queue = this._readExternalMember(
                device, 'queue', generation, 'resolve the GPU signal queue',
            );
            rawPromise = this._callExternal(
                queue, 'onSubmittedWorkDone', [], generation, 'start a GPU signal',
            );
        } catch (error) {
            this._settleSignal(record, false, error);
            return promise;
        }

        try {
            const completion = this._captureExternalCallable(
                rawPromise, 'then', generation, 'resolve GPU signal completion',
            );
            this._invokeCapturedExternal(
                completion,
                [
                    () => this._completeSignal(record, null),
                    error => this._completeSignal(record, error),
                ],
                generation,
                'observe GPU signal completion',
            );
        } catch (error) {
            this._settleSignal(record, false, error);
        }

        if (!this._isGeneration(generation)) {
            this._settleSignal(record, false, timelineError(
                'GPU signal cancelled because the timeline manager was destroyed',
                'VGPU_GPU_SIGNAL_CANCELLED',
            ));
        }
        return promise;
    }

    _completeSignal(record, error) {
        if (!record || record.settled) return;
        if (error) {
            this._settleSignal(record, false, error);
            return;
        }
        if (
            !this._isGeneration(record.generation)
            || !this._timelines?.has(record.id)
        ) {
            this._settleSignal(record, false, timelineError(
                'GPU signal cancelled before completion',
                'VGPU_GPU_SIGNAL_CANCELLED',
            ));
            return;
        }
        try {
            this.signal(record.id, record.value);
            this._settleSignal(record, true, record.value);
        } catch (signalError) {
            this._settleSignal(record, false, signalError);
        }
    }

    _settleSignal(record, success, value) {
        if (!record || record.settled) return false;
        record.settled = true;
        this._activeSignals?.delete(record);
        if (success) record.resolve(value);
        else record.reject(value);
        return true;
    }

    insertGPUSignal(semaphore, value) {
        let promise;
        try {
            const signal = this.createGPUSignal(semaphore, value);
            promise = signal();
        } catch (error) {
            promise = Promise.reject(error);
        }
        promise.catch(() => {});
        return promise;
    }

    barrier(semaphores) {
        const waits = [];
        try {
            const generation = this._assertActive('create a semaphore barrier');
            const wait = this._captureExternalCallable(
                this, 'wait', generation, 'resolve semaphore barrier wait',
            );
            const entries = this._snapshotBarrierEntries(semaphores, generation);
            for (let index = 0; index < entries.length; index++) {
                const entry = entries[index];
                const waitPromise = this._invokeCapturedExternal(
                    wait,
                    [entry.semaphore, entry.value],
                    generation,
                    'start a semaphore barrier wait',
                );
                this._invokeCapturedExternal(
                    { receiver: waits, callable: NATIVE_ARRAY_PUSH },
                    [waitPromise],
                    generation,
                    'stage a semaphore barrier wait',
                );
            }
            const aggregateInput = {
                [Symbol.iterator]() {
                    let index = 0;
                    return {
                        next() {
                            if (index >= waits.length) return { done: true, value: undefined };
                            return { done: false, value: waits[index++] };
                        },
                    };
                },
            };
            return this._invokeCapturedExternal(
                { receiver: BarrierPromise, callable: NATIVE_PROMISE_ALL },
                [aggregateInput],
                generation,
                'aggregate semaphore barrier waits',
            );
        } catch (error) {
            for (let index = 0; index < waits.length; index++) {
                this._silenceExternalPromise(waits[index]);
            }
            return Reflect.apply(NATIVE_PROMISE_REJECT, NATIVE_PROMISE, [error]);
        }
    }

    createFrameSync(maxFramesInFlight = 2) {
        const generation = this._assertActive('create frame synchronization');
        const frameSync = new FrameSync(this, maxFramesInFlight, generation);
        this._assertGeneration(generation, 'publish frame synchronization');
        this._frameSyncs.add(frameSync);
        return frameSync;
    }

    _releaseFrameSync(frameSync) {
        this._frameSyncs?.delete(frameSync);
    }

    destroySemaphore(semaphore) {
        if (this._destroyed || !this._timelines || !this._semaphores) return false;
        const generation = this._generation;
        const id = this._resolveId(semaphore, generation, 'destroy a semaphore');
        const timeline = this._timelines.get(id);
        const child = this._semaphores.get(id);
        if (!timeline && !child) return false;

        this._timelines.delete(id);
        this._semaphores.delete(id);
        child?._destroyFromManager();
        if (timeline) {
            const waiters = timeline.waiters.splice(0);
            timeline.history.splice(0);
            for (const waiter of waiters) {
                this._settleWaiter(waiter, false, timelineError(
                    'Semaphore destroyed',
                    'VGPU_SEMAPHORE_DESTROYED',
                ));
            }
        }
        const signals = Array.from(this._activeSignals)
            .filter(record => record.id === id);
        for (const record of signals) {
            this._settleSignal(record, false, timelineError(
                'GPU signal cancelled because its semaphore was destroyed',
                'VGPU_GPU_SIGNAL_CANCELLED',
            ));
        }
        return true;
    }

    getDebugInfo() {
        if (this._destroyed || !this._timelines) return [];
        const info = [];
        for (const [id, timeline] of this._timelines) {
            info.push({
                id,
                value: timeline.value,
                waiters: timeline.waiters.length,
                historyLength: timeline.history.length,
            });
        }
        return info;
    }

    /**
     * With an argument, preserve the legacy child-destroy operation. With no
     * argument, terminally destroy the manager.
     */
    destroy(semaphore) {
        if (arguments.length > 0) return this.destroySemaphore(semaphore);
        if (this._destroyed) return false;

        const timelines = this._timelines ? Array.from(this._timelines.values()) : [];
        const semaphores = this._semaphores ? Array.from(this._semaphores.values()) : [];
        const frameSyncs = this._frameSyncs ? Array.from(this._frameSyncs) : [];
        const signals = this._activeSignals ? Array.from(this._activeSignals) : [];
        const querySet = this._timestampQuerySet;
        const timestampBuffer = this._timestampBuffer;

        this._destroyed = true;
        this._generation++;
        this._semaphores?.clear();
        this._timelines?.clear();
        this._frameSyncs?.clear();
        this._activeSignals?.clear();
        this._semaphores = null;
        this._timelines = null;
        this._frameSyncs = null;
        this._activeSignals = null;
        this._timestampQuerySet = null;
        this._timestampBuffer = null;
        this._timestampSupported = false;
        this.device = null;
        this.vgpu = null;

        for (const semaphoreChild of semaphores) semaphoreChild._destroyFromManager();
        for (const frameSync of frameSyncs) frameSync._destroyFromManager();
        for (const timeline of timelines) {
            const waiters = timeline.waiters.splice(0);
            timeline.history.splice(0);
            for (const waiter of waiters) {
                this._settleWaiter(waiter, false, timelineError(
                    'Timeline semaphore manager destroyed',
                    'VGPU_TIMELINE_DESTROYED',
                ));
            }
        }
        for (const record of signals) {
            this._settleSignal(record, false, timelineError(
                'GPU signal cancelled because the timeline manager was destroyed',
                'VGPU_GPU_SIGNAL_CANCELLED',
            ));
        }
        destroyResource(timestampBuffer);
        destroyResource(querySet);
        return true;
    }

    destroyAll() {
        return this.destroy();
    }

    dispose() {
        return this.destroy();
    }
}

class TimelineSemaphore {
    constructor(manager, id, initialValue, managerGeneration) {
        this.manager = manager;
        this.id = id;
        this._initialValue = initialValue;
        this._managerGeneration = managerGeneration;
        this._destroyed = false;
    }

    _assertActive(operation) {
        if (
            this._destroyed
            || !this.manager
            || !this.manager._isGeneration(this._managerGeneration)
            || this.manager.get(this.id) !== this
        ) {
            throw timelineError(
                `Timeline semaphore is destroyed; cannot ${operation}`,
                'VGPU_SEMAPHORE_DESTROYED',
            );
        }
    }

    signal(value) {
        this._assertActive('signal');
        return this.manager.signal(this.id, value);
    }

    wait(value, timeoutMs) {
        try {
            this._assertActive('wait');
            return this.manager.wait(this.id, value, timeoutMs);
        } catch (error) {
            return Promise.reject(error);
        }
    }

    getValue() {
        if (this._destroyed || !this.manager) return 0;
        return this.manager.getValue(this.id);
    }

    signalAfterGPU(value) {
        this._assertActive('signal after GPU work');
        return this.manager.insertGPUSignal(this.id, value);
    }

    _destroyFromManager() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this.manager = null;
        return true;
    }

    destroy() {
        if (this._destroyed || !this.manager) return false;
        return this.manager.destroySemaphore(this.id);
    }

    dispose() {
        return this.destroy();
    }
}

class FrameSync {
    constructor(manager, maxFramesInFlight, managerGeneration) {
        this.manager = manager;
        this.maxFramesInFlight = maxFramesInFlight;
        this._managerGeneration = managerGeneration;
        this._frameSemaphore = manager.create(0);
        this._cpuFrame = 0;
        this._gpuFrame = 0;
        this._destroyed = false;
        this._generation = 0;
    }

    _assertActive(operation) {
        if (
            this._destroyed
            || !this.manager
            || !this.manager._isGeneration(this._managerGeneration)
        ) {
            throw timelineError(
                `Frame synchronization is destroyed; cannot ${operation}`,
                'VGPU_FRAME_SYNC_DESTROYED',
            );
        }
        return this._generation;
    }

    async beginFrame() {
        const generation = this._assertActive('begin a frame');
        const targetFrame = this._cpuFrame - this.maxFramesInFlight;
        if (targetFrame > 0 && this._gpuFrame < targetFrame) {
            await this._frameSemaphore.wait(targetFrame);
            if (generation !== this._generation) this._assertActive('finish beginning a frame');
            this._assertActive('finish beginning a frame');
            this._gpuFrame = targetFrame;
        }
        this._assertActive('publish a CPU frame');
        this._cpuFrame++;
        return this._cpuFrame;
    }

    endFrame() {
        this._assertActive('end a frame');
        return this._frameSemaphore.signalAfterGPU(this._cpuFrame);
    }

    getFramesInFlight() {
        if (this._destroyed) return 0;
        return this._cpuFrame - this._gpuFrame;
    }

    getCPUFrame() {
        return this._destroyed ? 0 : this._cpuFrame;
    }

    getGPUFrame() {
        return this._destroyed ? 0 : this._gpuFrame;
    }

    async flush() {
        const generation = this._assertActive('flush');
        if (this._cpuFrame > 0) {
            await this._frameSemaphore.wait(this._cpuFrame);
            if (generation !== this._generation) this._assertActive('finish flushing');
            this._assertActive('finish flushing');
            this._gpuFrame = this._cpuFrame;
        }
        return true;
    }

    _destroyFromManager() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;
        this._frameSemaphore?._destroyFromManager();
        this._frameSemaphore = null;
        this.manager = null;
        this._cpuFrame = 0;
        this._gpuFrame = 0;
        return true;
    }

    destroy() {
        if (this._destroyed) return false;
        const manager = this.manager;
        const semaphore = this._frameSemaphore;
        this._destroyed = true;
        this._generation++;
        this._frameSemaphore = null;
        this.manager = null;
        this._cpuFrame = 0;
        this._gpuFrame = 0;
        manager?._releaseFrameSync(this);
        semaphore?.destroy();
        return true;
    }

    dispose() {
        return this.destroy();
    }
}

export { TimelineSemaphore, FrameSync };
