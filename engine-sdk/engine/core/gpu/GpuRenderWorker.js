// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { GpuDevice } from './GpuDevice.js';

const WORKER_PROTOCOL = 'particle-realms.gpu-render-worker.v1';
const RECOVERY_DELAYS_MS = Object.freeze([0, 100, 250]);
const LIMIT_KEYS = Object.freeze([
    'maxTextureDimension1D', 'maxTextureDimension2D', 'maxTextureDimension3D',
    'maxBindGroups', 'maxBindingsPerBindGroup', 'maxBufferSize',
    'maxStorageBufferBindingSize', 'maxUniformBufferBindingSize',
    'maxStorageBuffersPerShaderStage', 'maxComputeInvocationsPerWorkgroup',
    'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ',
]);

let runtime = null;
let workerState = 'new';
let commandTail = Promise.resolve();
let recoveryTail = Promise.resolve();
let lifecycleGeneration = 0;

function runtimeError(code, message, details = null) {
    const error = new Error(message);
    error.code = code;
    if (details !== null) error.details = details;
    return error;
}

function serializeError(error) {
    return {
        code: String(error?.code || 'GPU_RENDER_WORKER_ERROR'),
        message: String(error?.message || error || 'GPU render worker failed'),
        details: error?.details ?? null,
    };
}

function constructorName(value) {
    try { return String(value?.constructor?.name || ''); } catch (_) { return ''; }
}

function assertNoGpuObject(value, path = 'value', seen = new Set(), depth = 0) {
    if (depth > 64) throw runtimeError('GPU_WORKER_MESSAGE_DEPTH', `${path} exceeds the message depth limit`);
    if (value == null || ['string', 'number', 'boolean', 'bigint', 'undefined'].includes(typeof value)) return;
    if (typeof value === 'function' || typeof value === 'symbol') {
        throw runtimeError('GPU_WORKER_MESSAGE_UNCLONEABLE', `${path} contains ${typeof value}`);
    }
    const name = constructorName(value);
    if (/^GPU(?:Adapter|AdapterInfo|BindGroup|BindGroupLayout|Buffer|CanvasContext|CommandBuffer|CommandEncoder|ComputePassEncoder|ComputePipeline|Device|ExternalTexture|PipelineLayout|QuerySet|Queue|RenderBundle|RenderBundleEncoder|RenderPassEncoder|RenderPipeline|Sampler|ShaderModule|Texture|TextureView)$/.test(name)
        || value.__isGpuFacade === true) {
        throw runtimeError('GPU_WORKER_OBJECT_FORBIDDEN', `${path} contains a WebGPU host object`);
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)
        || ['Blob', 'File', 'ImageBitmap', 'ImageData', 'MessagePort', 'OffscreenCanvas'].includes(name)) return;
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertNoGpuObject(entry, `${path}[${index}]`, seen, depth + 1));
        return;
    }
    if (value instanceof Map) {
        for (const [key, entry] of value) {
            assertNoGpuObject(key, `${path}.mapKey`, seen, depth + 1);
            assertNoGpuObject(entry, `${path}.mapValue`, seen, depth + 1);
        }
        return;
    }
    if (value instanceof Set) {
        for (const entry of value) assertNoGpuObject(entry, `${path}.setValue`, seen, depth + 1);
        return;
    }
    for (const [key, entry] of Object.entries(value)) {
        assertNoGpuObject(entry, `${path}.${key}`, seen, depth + 1);
    }
}

function postResponse(requestId, ok, value = null, error = null) {
    if (ok) assertNoGpuObject(value, 'response');
    globalThis.postMessage({
        protocol: WORKER_PROTOCOL,
        type: 'response',
        requestId,
        ok,
        value: ok ? value : null,
        error: ok ? null : serializeError(error),
    });
}

function postEvent(event, value = null) {
    assertNoGpuObject(value, `event.${event}`);
    globalThis.postMessage({ protocol: WORKER_PROTOCOL, type: 'event', event, value });
}

function delay(ms) {
    return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function normalizeFeatureList(value) {
    if (!Array.isArray(value)) return undefined;
    return Array.from(new Set(value.map(String).filter(Boolean)));
}

function normalizeLimits(value) {
    if (!value || typeof value !== 'object') return undefined;
    const limits = {};
    for (const [name, requested] of Object.entries(value)) {
        const number = Number(requested);
        if (Number.isFinite(number) && number >= 0) limits[name] = Math.floor(number);
    }
    return limits;
}

function normalizeDeviceOptions(raw = {}, profile = 'baseline-render') {
    const options = {
        profile: String(profile || 'baseline-render'),
        label: String(raw.label || 'ParticleRealms_RenderWorkerDevice'),
    };
    if (raw.adapterOptions && typeof raw.adapterOptions === 'object') {
        options.adapterOptions = {
            ...(raw.adapterOptions.powerPreference ? { powerPreference: String(raw.adapterOptions.powerPreference) } : {}),
            ...(raw.adapterOptions.forceFallbackAdapter === true ? { forceFallbackAdapter: true } : {}),
            ...(raw.adapterOptions.featureLevel ? { featureLevel: String(raw.adapterOptions.featureLevel) } : {}),
        };
    }
    const requiredFeatures = normalizeFeatureList(raw.requiredFeatures);
    const optionalFeatures = normalizeFeatureList(raw.optionalFeatures);
    const requiredLimits = normalizeLimits(raw.requiredLimits);
    if (requiredFeatures) options.requiredFeatures = requiredFeatures;
    if (optionalFeatures) options.optionalFeatures = optionalFeatures;
    if (requiredLimits) options.requiredLimits = requiredLimits;
    return options;
}

function serializableLimits(limits) {
    const result = {};
    for (const key of LIMIT_KEYS) {
        const value = Number(limits?.[key]);
        if (Number.isFinite(value)) result[key] = value;
    }
    return result;
}

function capabilitySnapshot(gpuDevice) {
    const capabilities = gpuDevice.getCapabilities();
    return Object.freeze({
        profile: gpuDevice.profile,
        generation: gpuDevice.generation,
        featureLevel: capabilities.featureLevel,
        compatibilityMode: capabilities.compatibilityMode === true,
        features: Array.from(gpuDevice.features || [], String).sort(),
        limits: serializableLimits(gpuDevice.limits),
        workloadSupport: { ...(capabilities.workloadSupport || {}) },
        defaultColorFormat: capabilities.defaultColorFormat,
        safeCanvasUsage: capabilities.safeCanvasUsage,
    });
}

function normalizedPresentation(raw = {}, gpuDevice) {
    const preferred = globalThis.navigator?.gpu?.getPreferredCanvasFormat?.()
        || gpuDevice.getCapabilities().defaultColorFormat
        || 'bgra8unorm';
    const configuration = {
        device: gpuDevice.device,
        format: String(raw.format || preferred),
        alphaMode: raw.alphaMode === 'opaque' ? 'opaque' : 'premultiplied',
    };
    const safeUsage = Number(gpuDevice.getCapabilities().safeCanvasUsage);
    if (Number.isInteger(safeUsage) && safeUsage > 0) configuration.usage = safeUsage;
    if (raw.colorSpace === 'display-p3' || raw.colorSpace === 'srgb') {
        configuration.colorSpace = raw.colorSpace;
    }
    if (raw.toneMapping === 'extended' || raw.toneMapping?.mode === 'extended') {
        configuration.toneMapping = { mode: 'extended' };
    }
    return configuration;
}

function configureContext(context, configuration) {
    try {
        context.configure(configuration);
        return configuration;
    } catch (error) {
        if (!configuration.colorSpace && !configuration.toneMapping) throw error;
        const fallback = {
            device: configuration.device,
            format: configuration.format,
            alphaMode: configuration.alphaMode,
            ...(configuration.usage ? { usage: configuration.usage } : {}),
        };
        context.configure(fallback);
        return fallback;
    }
}

function rendererFactory(moduleNamespace) {
    const factory = moduleNamespace?.createGpuRenderWorker || moduleNamespace?.default;
    if (typeof factory !== 'function') {
        throw runtimeError(
            'GPU_WORKER_RENDERER_EXPORT',
            'Renderer module must export createGpuRenderWorker() or a default factory',
        );
    }
    return factory;
}

async function buildCandidate(base, acquisitionOptions, previousState = null) {
    const gpuDevice = await GpuDevice.create(acquisitionOptions);
    let renderer = null;
    const candidateLoss = { info: null };
    const candidateLossHandler = info => {
        candidateLoss.info = info || { reason: 'unknown', message: '' };
    };
    gpuDevice.onDeviceLost(candidateLossHandler);
    const assertLive = () => {
        if (!gpuDevice.lost && !gpuDevice.destroyed && !candidateLoss.info) return;
        throw runtimeError(
            'GPU_WORKER_CANDIDATE_LOST',
            candidateLoss.info?.message || gpuDevice.lossInfo?.message
                || 'Worker GPU candidate was lost before publication',
            candidateLoss.info ?? gpuDevice.lossInfo,
        );
    };
    try {
        assertLive();
        const generation = gpuDevice.generation;
        const capabilities = capabilitySnapshot(gpuDevice);
        const presentationConfiguration = normalizedPresentation(base.presentation, gpuDevice);
        renderer = await base.factory(Object.freeze({
            phase: 'prepare',
            device: gpuDevice.device,
            queue: gpuDevice.queue,
            context: base.context,
            canvas: base.canvas,
            format: presentationConfiguration.format,
            generation,
            capabilities,
            previousState,
        }));
        assertLive();
        if (!renderer || (typeof renderer.handleCommand !== 'function' && typeof renderer.render !== 'function')) {
            throw runtimeError('GPU_WORKER_RENDERER_CONTRACT', 'Renderer factory must return render() or handleCommand()');
        }
        await renderer.validate?.();
        await Promise.resolve();
        assertLive();
        return {
            gpuDevice,
            renderer,
            generation,
            capabilities,
            acquisitionOptions: gpuDevice.getAcquisitionOptions(),
            presentationConfiguration,
            candidateLoss,
            candidateLossHandler,
        };
    } catch (error) {
        gpuDevice.removeDeviceLostHandler(candidateLossHandler);
        try { await renderer?.destroy?.(); } catch (_) {}
        gpuDevice.destroy();
        throw error;
    }
}

async function disposeCandidate(base, candidate, { releaseContext = false } = {}) {
    if (!candidate) return;
    candidate.gpuDevice?.removeDeviceLostHandler?.(candidate.lossHandler);
    candidate.gpuDevice?.removeDeviceLostHandler?.(candidate.candidateLossHandler);
    try { await candidate.renderer?.destroy?.(); } catch (_) {}
    if (releaseContext) {
        try { base.context?.unconfigure?.(); } catch (_) {}
    }
    try { candidate.gpuDevice?.destroy?.(); } catch (_) {}
}

async function commitCandidate(base, candidate, previous = null, { isCurrent = null } = {}) {
    let contextConfigured = false;
    let nextRuntime = null;
    const assertCurrent = () => {
        if (!isCurrent || isCurrent()) return;
        throw runtimeError(
            'GPU_WORKER_RECOVERY_STALE',
            'Worker GPU candidate no longer owns the active lifecycle operation',
        );
    };
    const assertLive = () => {
        if (!candidate.gpuDevice?.lost && !candidate.gpuDevice?.destroyed
            && !candidate.candidateLoss?.info) return;
        throw runtimeError(
            'GPU_WORKER_CANDIDATE_LOST',
            candidate.candidateLoss?.info?.message || candidate.gpuDevice?.lossInfo?.message
                || 'Worker GPU candidate was lost before publication',
            candidate.candidateLoss?.info ?? candidate.gpuDevice?.lossInfo,
        );
    };
    try {
        assertCurrent();
        assertLive();
        const configuration = candidate.presentationConfiguration
            || normalizedPresentation(base.presentation, candidate.gpuDevice);
        const committedConfiguration = configureContext(base.context, configuration);
        contextConfigured = true;
        candidate.configuration = {
            format: committedConfiguration.format,
            alphaMode: committedConfiguration.alphaMode,
            colorSpace: committedConfiguration.colorSpace || 'srgb',
            toneMapping: committedConfiguration.toneMapping?.mode || 'standard',
        };
        await candidate.renderer.onPublished?.({
            generation: candidate.generation,
            configuration: candidate.configuration,
        });
        await Promise.resolve();
        assertCurrent();
        assertLive();

        nextRuntime = { ...base, ...candidate, state: 'ready' };
        assertCurrent();
        attachLossHandler(nextRuntime);
        candidate.gpuDevice.removeDeviceLostHandler(candidate.candidateLossHandler);
        candidate.candidateLossHandler = null;
        runtime = nextRuntime;
        workerState = 'ready';
    } catch (error) {
        await disposeCandidate(base, candidate, { releaseContext: contextConfigured });
        throw error;
    }

    if (previous) {
        previous.gpuDevice?.removeDeviceLostHandler?.(previous.lossHandler);
        try { await previous.renderer?.destroy?.(); } catch (_) {}
        try { previous.gpuDevice?.destroy?.(); } catch (_) {}
    }
    return nextRuntime;
}

function attachLossHandler(owner) {
    const handler = info => {
        if (runtime !== owner || workerState !== 'ready') return;
        recoveryTail = recoveryTail.then(() => recoverRuntime(owner, info)).catch(error => {
            workerState = 'failed';
            postEvent('recovery-failed', {
                generation: owner.generation,
                error: serializeError(error),
            });
        });
    };
    owner.lossHandler = handler;
    owner.gpuDevice.onDeviceLost(handler);
}

async function recoverRuntime(lostRuntime, info) {
    if (runtime !== lostRuntime || workerState !== 'ready') return null;
    const recoveryLifecycle = lifecycleGeneration;
    workerState = 'recovering';
    const ownsRecovery = () => lifecycleGeneration === recoveryLifecycle
        && runtime === lostRuntime
        && workerState === 'recovering';
    postEvent('device-lost', {
        generation: lostRuntime.generation,
        reason: String(info?.reason || 'unknown'),
        message: String(info?.message || ''),
    });
    let previousState = null;
    try { previousState = await lostRuntime.renderer?.captureRecoveryState?.(); }
    catch (_) {}
    if (!ownsRecovery()) return null;
    assertNoGpuObject(previousState, 'recoveryState');

    let lastError = null;
    for (let attempt = 0; attempt < RECOVERY_DELAYS_MS.length; attempt++) {
        await delay(RECOVERY_DELAYS_MS[attempt]);
        if (!ownsRecovery()) return null;
        postEvent('recovering', {
            generation: lostRuntime.generation,
            attempt: attempt + 1,
            maximumAttempts: RECOVERY_DELAYS_MS.length,
        });
        try {
            const nextGeneration = lostRuntime.generation + 1;
            const candidate = await buildCandidate(lostRuntime, {
                ...lostRuntime.acquisitionOptions,
                generation: nextGeneration,
            }, previousState);
            if (!ownsRecovery()) {
                await disposeCandidate(lostRuntime, candidate);
                return null;
            }
            const published = await commitCandidate(lostRuntime, candidate, lostRuntime, {
                isCurrent: ownsRecovery,
            });
            if (lifecycleGeneration !== recoveryLifecycle
                || runtime !== published
                || workerState !== 'ready') return null;
            postEvent('recovered', runtimeSnapshot(published));
            return published;
        } catch (error) {
            if (!ownsRecovery() || error?.code === 'GPU_WORKER_RECOVERY_STALE') return null;
            lastError = error;
        }
    }
    throw lastError || runtimeError('GPU_WORKER_RECOVERY_FAILED', 'Render worker device recovery failed');
}

function effectiveSize(owner, width, height, resolutionScale = 1) {
    const limit = Number(owner.gpuDevice.limits?.maxTextureDimension2D) || 8192;
    const scale = Number.isFinite(Number(resolutionScale))
        ? Math.max(0.1, Math.min(2, Number(resolutionScale)))
        : 1;
    return {
        width: Math.min(limit, Math.max(1, Math.floor(Number(width) * scale))),
        height: Math.min(limit, Math.max(1, Math.floor(Number(height) * scale))),
        resolutionScale: scale,
        maxTextureDimension2D: limit,
    };
}

function assertCurrentCommandOwner(owner, command) {
    if (runtime === owner && workerState === 'ready') return;
    throw runtimeError(
        'GPU_WORKER_COMMAND_STALE_GENERATION',
        `Render worker command '${command}' completed after its GPU generation was retired`,
        {
            command,
            expectedGeneration: owner?.generation ?? null,
            activeGeneration: runtime?.generation ?? null,
            state: workerState,
        },
    );
}

async function handleRendererCommand(command, payload) {
    const owner = runtime;
    if (!owner || workerState !== 'ready') {
        throw runtimeError('GPU_WORKER_RECOVERING', `Render worker cannot accept commands while ${workerState}`);
    }
    if (command === 'resize') {
        const size = effectiveSize(owner, payload?.width, payload?.height, payload?.resolutionScale);
        owner.canvas.width = size.width;
        owner.canvas.height = size.height;
        await owner.renderer.resize?.(size);
        assertCurrentCommandOwner(owner, command);
        return { ...size, generation: owner.generation };
    }
    if (command === 'snapshot') return runtimeSnapshot(owner);

    const startedAt = performance.now();
    let value;
    if (command === 'frame' && typeof owner.renderer.render === 'function') {
        value = await owner.renderer.render(payload, {
            generation: owner.generation,
            device: owner.gpuDevice.device,
            queue: owner.gpuDevice.queue,
            context: owner.context,
            canvas: owner.canvas,
        });
    } else if (typeof owner.renderer.handleCommand === 'function') {
        value = await owner.renderer.handleCommand(command, payload, {
            generation: owner.generation,
            device: owner.gpuDevice.device,
            queue: owner.gpuDevice.queue,
            context: owner.context,
            canvas: owner.canvas,
        });
    } else {
        throw runtimeError('GPU_WORKER_COMMAND_UNSUPPORTED', `Renderer does not support '${command}'`);
    }
    assertCurrentCommandOwner(owner, command);
    assertNoGpuObject(value, `commandResult.${command}`);
    return {
        value: value ?? null,
        telemetry: {
            generation: owner.generation,
            cpuEncodeMs: Math.max(0, performance.now() - startedAt),
        },
    };
}

function runtimeSnapshot(owner = runtime) {
    if (!owner) return { state: workerState, generation: null, capabilities: null };
    return {
        state: workerState,
        generation: owner.generation,
        profile: owner.gpuDevice.profile,
        capabilities: owner.capabilities,
        configuration: owner.configuration,
        size: { width: owner.canvas.width, height: owner.canvas.height },
    };
}

async function initialize(payload) {
    if (workerState !== 'new') throw runtimeError('GPU_WORKER_ALREADY_INITIALIZED', 'Render worker is already initialized');
    if (!payload?.canvas || constructorName(payload.canvas) !== 'OffscreenCanvas') {
        throw runtimeError('GPU_OFFSCREEN_CANVAS_REQUIRED', 'Worker initialization requires a transferred OffscreenCanvas');
    }
    if (!globalThis.navigator?.gpu) {
        throw runtimeError('GPU_WORKER_WEBGPU_UNAVAILABLE', 'navigator.gpu is unavailable in the render worker');
    }
    workerState = 'starting';
    const initializationLifecycle = lifecycleGeneration;
    const ownsInitialization = () => lifecycleGeneration === initializationLifecycle
        && runtime === null
        && workerState === 'starting';
    const moduleNamespace = await import(String(payload.rendererModule));
    const context = payload.canvas.getContext('webgpu');
    if (!context) throw runtimeError('GPU_WORKER_CONTEXT_UNAVAILABLE', 'OffscreenCanvas WebGPU context is unavailable');
    const presentation = { ...(payload.presentation || {}) };
    const base = {
        canvas: payload.canvas,
        context,
        factory: rendererFactory(moduleNamespace),
        presentation,
        rendererModule: String(payload.rendererModule),
    };
    const size = effectiveSize(
        { gpuDevice: { limits: { maxTextureDimension2D: 8192 } } },
        payload.size?.width || payload.canvas.width,
        payload.size?.height || payload.canvas.height,
        1,
    );
    payload.canvas.width = size.width;
    payload.canvas.height = size.height;
    const acquisitionOptions = {
        ...normalizeDeviceOptions(payload.deviceOptions, payload.profile),
        generation: 1,
    };
    const candidate = await buildCandidate(base, acquisitionOptions, null);
    if (!ownsInitialization()) {
        await disposeCandidate(base, candidate);
        throw runtimeError('GPU_WORKER_INITIALIZATION_STALE', 'Worker initialization was superseded');
    }
    presentation.format = candidate.presentationConfiguration.format;
    const published = await commitCandidate(base, candidate, null, { isCurrent: ownsInitialization });
    return runtimeSnapshot(published);
}

async function destroyRuntime() {
    if (workerState === 'destroying' || workerState === 'destroyed') return false;
    lifecycleGeneration++;
    workerState = 'destroying';
    const owner = runtime;
    runtime = null;
    if (owner) {
        owner.gpuDevice.removeDeviceLostHandler?.(owner.lossHandler);
        try { await owner.renderer?.destroy?.(); } catch (_) {}
        try { owner.context?.unconfigure?.(); } catch (_) {}
        try { owner.gpuDevice?.destroy?.(); } catch (_) {}
    }
    workerState = 'destroyed';
    return true;
}

async function handleRequest(message) {
    if (!message || message.protocol !== WORKER_PROTOCOL || !Number.isInteger(message.requestId)) return;
    assertNoGpuObject(message.payload, 'request');
    try {
        let value;
        if (message.type === 'init') {
            value = await initialize(message.payload);
        } else if (message.type === 'command') {
            value = await handleRendererCommand(String(message.payload?.command || ''), message.payload?.payload);
        } else if (message.type === 'destroy') {
            value = await destroyRuntime();
        } else {
            throw runtimeError('GPU_WORKER_REQUEST_UNSUPPORTED', `Unsupported request type '${message.type}'`);
        }
        postResponse(message.requestId, true, value);
        if (message.type === 'destroy') setTimeout(() => globalThis.close?.(), 0);
    } catch (error) {
        postResponse(message.requestId, false, null, error);
        if (message.type === 'init') workerState = 'failed';
    }
}

globalThis.addEventListener('message', event => {
    commandTail = commandTail
        .then(() => handleRequest(event.data))
        .catch(error => postEvent('error', serializeError(error)));
});

globalThis.addEventListener('messageerror', () => {
    postEvent('error', serializeError(runtimeError(
        'GPU_WORKER_MESSAGE_ERROR',
        'A render worker command could not be cloned',
    )));
});
