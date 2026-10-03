// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const WORKER_PROTOCOL = 'particle-realms.gpu-render-worker.v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_PENDING_COMMANDS = 128;

function workerError(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    if (details !== null) error.details = details;
    return error;
}

function constructorName(value) {
    try { return String(value?.constructor?.name || ''); } catch (_) { return ''; }
}

function isGpuHostObject(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
    if (value.__isGpuFacade === true) return true;
    return /^GPU(?:Adapter|AdapterInfo|BindGroup|BindGroupLayout|Buffer|CanvasContext|CommandBuffer|CommandEncoder|ComputePassEncoder|ComputePipeline|Device|ExternalTexture|PipelineLayout|QuerySet|Queue|RenderBundle|RenderBundleEncoder|RenderPassEncoder|RenderPipeline|Sampler|ShaderModule|Texture|TextureView)$/.test(constructorName(value));
}

function assertCpuMessage(value, path = 'payload', seen = new Set(), depth = 0) {
    if (depth > 64) throw workerError('GPU_WORKER_MESSAGE_DEPTH', `${path} exceeds the structured-command depth limit`);
    if (isGpuHostObject(value)) {
        throw workerError('GPU_WORKER_OBJECT_FORBIDDEN', `${path} contains a WebGPU host object; GPU ownership stays inside the render worker`);
    }
    if (value == null || ['string', 'number', 'boolean', 'bigint', 'undefined'].includes(typeof value)) return;
    if (typeof value === 'function' || typeof value === 'symbol') {
        throw workerError('GPU_WORKER_MESSAGE_UNCLONEABLE', `${path} contains ${typeof value}`);
    }
    if (seen.has(value)) return;
    seen.add(value);

    const name = constructorName(value);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)
        || ['Blob', 'File', 'ImageBitmap', 'ImageData', 'MessagePort', 'OffscreenCanvas'].includes(name)) return;
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertCpuMessage(entry, `${path}[${index}]`, seen, depth + 1));
        return;
    }
    if (value instanceof Map) {
        for (const [key, entry] of value) {
            assertCpuMessage(key, `${path}.mapKey`, seen, depth + 1);
            assertCpuMessage(entry, `${path}.mapValue`, seen, depth + 1);
        }
        return;
    }
    if (value instanceof Set) {
        for (const entry of value) assertCpuMessage(entry, `${path}.setValue`, seen, depth + 1);
        return;
    }
    for (const [key, entry] of Object.entries(value)) {
        assertCpuMessage(entry, `${path}.${key}`, seen, depth + 1);
    }
}

function normalizedDimension(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : Math.max(1, Math.floor(fallback || 1));
}

function serializeError(error) {
    return {
        code: String(error?.code || 'GPU_RENDER_WORKER_ERROR'),
        message: String(error?.message || error || 'GPU render worker failed'),
        details: error?.details ?? null,
    };
}

/**
 * Main-thread owner for one worker-owned GPU device and one transferred canvas.
 * Only structured CPU data crosses the boundary; GPU objects never do.
 */
export class GpuRenderWorkerHost {
    constructor(options = {}) {
        if (!options.canvas) throw new TypeError('GpuRenderWorkerHost requires a canvas');
        if (!options.rendererModule) throw new TypeError('GpuRenderWorkerHost requires a rendererModule URL');

        this.canvas = options.canvas;
        this.rendererModule = String(options.rendererModule);
        this.profile = String(options.profile || 'baseline-render');
        this.deviceOptions = { ...(options.deviceOptions || {}) };
        this.presentation = { ...(options.presentation || {}) };
        this.name = String(options.name || 'particle-realms-gpu-render');
        this.maxPendingCommands = Number.isFinite(Number(options.maxPendingCommands))
            ? Math.max(1, Math.floor(Number(options.maxPendingCommands)))
            : DEFAULT_MAX_PENDING_COMMANDS;
        this.requestTimeoutMs = Number.isFinite(Number(options.requestTimeoutMs))
            ? Math.max(100, Math.floor(Number(options.requestTimeoutMs)))
            : DEFAULT_REQUEST_TIMEOUT_MS;
        this._workerFactory = options.workerFactory || (() => new Worker(
            new URL('./GpuRenderWorker.js', import.meta.url),
            { type: 'module', name: this.name },
        ));

        assertCpuMessage(this.deviceOptions, 'deviceOptions');
        assertCpuMessage(this.presentation, 'presentation');

        this.state = 'new';
        this.generation = null;
        this.capabilities = null;
        this.worker = null;
        this._nextRequestId = 1;
        this._pending = new Map();
        this._listeners = new Map();
        this._boundMessage = event => this._handleMessage(event);
        this._boundError = event => this._handleWorkerFailure(event?.error || event);
        this._boundMessageError = event => this._handleWorkerFailure(
            workerError('GPU_WORKER_MESSAGE_ERROR', event?.message || 'Render worker message could not be cloned'),
        );
    }

    static async create(options = {}) {
        const host = new GpuRenderWorkerHost(options);
        await host.start();
        return host;
    }

    get pendingCommandCount() {
        return this._pending.size;
    }

    on(type, listener) {
        if (typeof listener !== 'function') throw new TypeError('GpuRenderWorkerHost listener must be a function');
        const key = String(type);
        let listeners = this._listeners.get(key);
        if (!listeners) {
            listeners = new Set();
            this._listeners.set(key, listeners);
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    _emit(type, value) {
        for (const listener of this._listeners.get(String(type)) || []) {
            try { listener(value); } catch (_) {}
        }
    }

    async start() {
        if (this.state === 'ready') return this.snapshot();
        if (this.state !== 'new') throw workerError('GPU_WORKER_STATE', `Cannot start render worker while state is ${this.state}`);
        if (typeof this._workerFactory !== 'function') throw workerError('GPU_WORKER_UNAVAILABLE', 'Worker construction is unavailable');

        this.state = 'starting';
        let canvasTransferred = false;
        try {
            // Validate the execution owner before performing the irreversible
            // HTMLCanvasElement -> OffscreenCanvas ownership transfer.
            this.worker = this._workerFactory();
            if (!this.worker || typeof this.worker.postMessage !== 'function') {
                throw workerError('GPU_WORKER_UNAVAILABLE', 'Worker factory returned an invalid worker');
            }
            this.worker.addEventListener?.('message', this._boundMessage);
            this.worker.addEventListener?.('error', this._boundError);
            this.worker.addEventListener?.('messageerror', this._boundMessageError);
            if (!this.worker.addEventListener) {
                this.worker.onmessage = this._boundMessage;
                this.worker.onerror = this._boundError;
                this.worker.onmessageerror = this._boundMessageError;
            }

            let offscreenCanvas;
            if (typeof this.canvas.transferControlToOffscreen === 'function') {
                offscreenCanvas = this.canvas.transferControlToOffscreen();
                canvasTransferred = true;
            } else if (constructorName(this.canvas) === 'OffscreenCanvas') {
                offscreenCanvas = this.canvas;
                canvasTransferred = true;
            } else {
                throw workerError('GPU_OFFSCREEN_CANVAS_UNAVAILABLE', 'Canvas cannot transfer control to an OffscreenCanvas');
            }

            const width = normalizedDimension(offscreenCanvas.width, this.canvas.width);
            const height = normalizedDimension(offscreenCanvas.height, this.canvas.height);
            const ready = await this._request('init', {
                canvas: offscreenCanvas,
                rendererModule: this.rendererModule,
                profile: this.profile,
                deviceOptions: this.deviceOptions,
                presentation: this.presentation,
                size: { width, height },
            }, [offscreenCanvas], this.requestTimeoutMs);
            this.state = 'ready';
            this.generation = ready.generation;
            this.capabilities = ready.capabilities;
            this._emit('ready', ready);
            return this.snapshot();
        } catch (error) {
            this.state = 'failed';
            this._terminateWorker();
            if (canvasTransferred) {
                const failure = workerError(
                    error?.code || 'GPU_WORKER_START_FAILED_AFTER_TRANSFER',
                    error?.message || 'Render worker startup failed after canvas transfer',
                    error?.details ?? null,
                );
                failure.canvasTransferred = true;
                failure.cause = error;
                throw failure;
            }
            throw error;
        }
    }

    command(command, payload = null, transfer = []) {
        if (this.state !== 'ready') {
            return Promise.reject(workerError('GPU_WORKER_NOT_READY', `Render worker is ${this.state}`));
        }
        const commandName = String(command || '');
        if (!commandName) return Promise.reject(new TypeError('GPU worker command name is required'));
        assertCpuMessage(payload, `command.${commandName}`);
        return this._request('command', { command: commandName, payload }, transfer);
    }

    render(payload = null, transfer = []) {
        return this.command('frame', payload, transfer);
    }

    async resize(width, height, options = {}) {
        const result = await this.command('resize', {
            width: normalizedDimension(width, this.canvas.width),
            height: normalizedDimension(height, this.canvas.height),
            resolutionScale: Number.isFinite(Number(options.resolutionScale))
                ? Math.max(0.1, Math.min(2, Number(options.resolutionScale)))
                : 1,
        });
        return result;
    }

    snapshot() {
        return Object.freeze({
            state: this.state,
            generation: this.generation,
            profile: this.profile,
            capabilities: this.capabilities,
            pendingCommands: this._pending.size,
        });
    }

    _request(type, payload, transfer = [], timeoutMs = this.requestTimeoutMs) {
        if (!this.worker) return Promise.reject(workerError('GPU_WORKER_UNAVAILABLE', 'Render worker is not running'));
        if (this._pending.size >= this.maxPendingCommands) {
            return Promise.reject(workerError('GPU_WORKER_BACKPRESSURE', 'Render worker command queue is full'));
        }
        assertCpuMessage(payload, type);
        const requestId = this._nextRequestId++;
        const message = { protocol: WORKER_PROTOCOL, type, requestId, payload };
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                // The worker serializes commands, so a timed-out request may
                // still own the head of its queue. Terminate the execution
                // owner instead of reopening host admission onto an unknown,
                // potentially permanently blocked queue.
                this._handleWorkerFailure(workerError(
                    'GPU_WORKER_TIMEOUT',
                    `${type} request ${requestId} timed out; render worker was terminated`,
                ));
            }, timeoutMs);
            this._pending.set(requestId, {
                resolve,
                reject,
                timeout,
                type,
                generation: type === 'command' ? this.generation : null,
            });
            try {
                this.worker.postMessage(message, transfer);
            } catch (error) {
                clearTimeout(timeout);
                this._pending.delete(requestId);
                reject(error);
            }
        });
    }

    _handleMessage(event) {
        const message = event?.data;
        if (!message || message.protocol !== WORKER_PROTOCOL) return;
        if (message.type === 'response') {
            const pending = this._pending.get(message.requestId);
            if (!pending) return;
            clearTimeout(pending.timeout);
            this._pending.delete(message.requestId);
            if (message.ok) {
                try {
                    if (pending.type === 'command') {
                        const responseGeneration = message.value?.telemetry?.generation
                            ?? message.value?.generation
                            ?? null;
                        if (this.state !== 'ready'
                            || this.generation !== pending.generation
                            || responseGeneration !== pending.generation) {
                            throw workerError(
                                'GPU_WORKER_COMMAND_STALE_GENERATION',
                                'Render worker response belongs to a retired GPU generation',
                                {
                                    requestGeneration: pending.generation,
                                    responseGeneration,
                                    activeGeneration: this.generation,
                                    state: this.state,
                                },
                            );
                        }
                    }
                    assertCpuMessage(message.value, 'workerResponse');
                    pending.resolve(message.value);
                } catch (error) {
                    pending.reject(error);
                }
            } else {
                pending.reject(workerError(
                    message.error?.code || 'GPU_RENDER_WORKER_ERROR',
                    message.error?.message || 'Render worker request failed',
                    message.error?.details ?? null,
                ));
            }
            return;
        }
        if (message.type === 'event') {
            const eventType = String(message.event || 'telemetry');
            if (eventType === 'recovered') {
                this.generation = message.value?.generation ?? this.generation;
                this.capabilities = message.value?.capabilities ?? this.capabilities;
                this.state = 'ready';
            } else if (eventType === 'device-lost' || eventType === 'recovering') {
                this.state = 'recovering';
                this._rejectPending(workerError(
                    'GPU_WORKER_COMMAND_STALE_GENERATION',
                    'Pending render commands were invalidated with their GPU generation',
                    {
                        lostGeneration: message.value?.generation ?? this.generation,
                        activeGeneration: this.generation,
                    },
                ));
            } else if (eventType === 'recovery-failed') {
                this.state = 'failed';
                const failure = workerError(
                    message.value?.error?.code || 'GPU_WORKER_RECOVERY_FAILED',
                    message.value?.error?.message || 'Render worker GPU recovery failed',
                    message.value?.error?.details ?? null,
                );
                this._rejectPending(failure);
                this._terminateWorker();
            }
            this._emit(eventType, message.value);
        }
    }

    _handleWorkerFailure(error) {
        if (this.state === 'destroyed') return;
        this.state = 'failed';
        const normalized = error instanceof Error
            ? error
            : workerError('GPU_RENDER_WORKER_CRASH', String(error?.message || error || 'Render worker crashed'));
        this._rejectPending(normalized);
        this._terminateWorker();
        this._emit('error', serializeError(normalized));
    }

    _rejectPending(error) {
        for (const pending of this._pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this._pending.clear();
    }

    _terminateWorker() {
        const worker = this.worker;
        this.worker = null;
        if (!worker) return;
        worker.removeEventListener?.('message', this._boundMessage);
        worker.removeEventListener?.('error', this._boundError);
        worker.removeEventListener?.('messageerror', this._boundMessageError);
        try { worker.terminate?.(); } catch (_) {}
    }

    async destroy() {
        if (this.state === 'destroyed') return false;
        const worker = this.worker;
        this.state = 'stopping';
        if (worker) {
            try { await this._request('destroy', null, [], Math.min(this.requestTimeoutMs, 2_000)); }
            catch (_) {}
        }
        this._rejectPending(workerError('GPU_WORKER_DESTROYED', 'Render worker was destroyed'));
        this._terminateWorker();
        this.state = 'destroyed';
        this.generation = null;
        this.capabilities = null;
        this._listeners.clear();
        return true;
    }
}

export { WORKER_PROTOCOL, assertCpuMessage };

export default GpuRenderWorkerHost;
