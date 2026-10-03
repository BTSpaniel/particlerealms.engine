// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Kernel-owned runtime for the canonical Ambient Runtime V3 plan. */

import {
    AMBIENT_RUNTIME_V3_ABI,
    AMBIENT_RUNTIME_V3_FRAME_SCHEMA,
    AMBIENT_RUNTIME_V3_ID,
    AMBIENT_RUNTIME_V3_UNIFORM_BYTES,
    buildAmbientRuntimeV3ProgramSource,
    packAmbientRuntimeV3FrameInputs,
    validateAmbientRuntimeV3Plan,
} from '../schema/AmbientRuntimeV3Contract.js';
import { getDefaultGpuFrameCoordinator } from '../GpuFrameCoordinator.js';
import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';
import { createAmbientRuntimeV3FrameInputSource } from './AmbientRuntimeV3FrameInputs.js';
import { createAmbientRuntimeV3DedicatedLane } from './AmbientRuntimeV3StatefulLanes.js';
import { createAmbientRuntimeV3Performance, ambientRuntimeV3WaterRenderScale, ambientRuntimeV3PerformanceResourceBudgetBytes } from './AmbientRuntimeV3Performance.js';
import { ambientWaterRetiredBytes, ambientWaterRetirementSnapshot, ambientWaterResidentBytes, ambientWaterResidencySnapshot,
    reserveAmbientWaterConstruction, updateAmbientWaterResidency, retainAmbientWaterRetirement, reserveAmbientWaterConstructionAfterRetirements } from './AmbientRuntimeV3Residency.js';
import { ambientProgramHasVersionedWater, createAmbientProgramWaterClock, projectAmbientProgramWaterFrame } from './AmbientProgramWaterClock.js';
import { inspectFiniteAmbientWater, createFiniteAmbientWaterLane } from './FiniteAmbientWaterLane.js';

export {
    AMBIENT_RUNTIME_V3_ABI,
    AMBIENT_RUNTIME_V3_EXECUTION_CLASSES,
    AMBIENT_RUNTIME_V3_FRAME_BYTE_OFFSETS,
    AMBIENT_RUNTIME_V3_FRAME_FLOAT_OFFSETS,
    AMBIENT_RUNTIME_V3_FRAME_LAYOUT,
    AMBIENT_RUNTIME_V3_FRAME_SCHEMA,
    AMBIENT_RUNTIME_V3_ID,
    AMBIENT_RUNTIME_V3_PLAN_SCHEMA,
    AMBIENT_RUNTIME_V3_PLAN_VERSION,
    AMBIENT_RUNTIME_V3_RECIPE_DEFINITIONS,
    AMBIENT_RUNTIME_V3_RECIPE_IDS,
    AMBIENT_RUNTIME_V3_UNIFORM_BYTES,
    AMBIENT_RUNTIME_V3_UNIFORM_FLOATS,
    ambientRuntimeV3RecipeDefinition,
    createAmbientRuntimeV3Plan,
    resolveAmbientRuntimeV3Execution,
    validateAmbientRuntimeV3Plan,
} from '../schema/AmbientRuntimeV3Contract.js';

const DEFAULT_MAX_PIXELS = 8_294_400;
const BUFFER_USAGE_UNIFORM = globalThis.GPUBufferUsage?.UNIFORM ?? 0x0040;
const BUFFER_USAGE_COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;

export function createWebGPUAmbientRuntimeV3Driver(options = {}) {
    return createAmbientGpuRuntimeDriver(options);
}

/** Shared canvas, generation, frame authority and receipt lifecycle for trusted runtime lanes. */
export function createAmbientGpuRuntimeDriver(options = {}, runtime = null) {
    const coordinatorProvider = () => options.frameCoordinator ?? getDefaultGpuFrameCoordinator();
    const deviceProvider = typeof options.deviceProvider === 'function'
        ? options.deviceProvider
        : () => coordinatorProvider()?.currentDevice?.() ?? null;
    const formatProvider = typeof options.formatProvider === 'function'
        ? options.formatProvider
        : () => globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() ?? null;
    const canvasFactory = typeof options.canvasFactory === 'function'
        ? options.canvasFactory
        : () => globalThis.document.createElement('canvas');
    const runtimeMaxPixels = boundedInteger(options.maxPixels, DEFAULT_MAX_PIXELS, 4, 67_108_864);
    let instance = null;
    let instanceLayer = null;
    let suspended = false;
    let accessibility = Object.freeze({ reducedMotion: false, forcedColors: false, reduceTransparency: false });
    let lastStatus = frozenStatus({ state: 'idle', message: 'No Ambient Runtime V3 wallpaper is active.' });

    const publish = detail => {
        lastStatus = frozenStatus(detail);
        try { options.onStatus?.(lastStatus); } catch {}
    };
    const teardown = () => {
        try { instance?.dispose?.(); } catch (error) {
            console.warn('[AmbientRuntimeV3Driver][destroy][error]', error);
        }
        instance = null;
        instanceLayer = null;
    };

    return Object.freeze({
        apply(layer, config = {}) {
            const checked = runtime?.normalizeConfig
                ? runtime.normalizeConfig(config, runtimeMaxPixels, suspended, accessibility)
                : normalizeConfig(config, runtimeMaxPixels, suspended, accessibility);
            if (!checked.ok) {
                teardown();
                applyFallback(layer, config, checked.message);
                publish({ state: 'rejected', message: checked.message, code: checked.code });
                return false;
            }
            const dimensions = measureBackingDimensions(layer, checked.config);
            if (!dimensions.ok) {
                teardown();
                applyFallback(layer, checked.config, dimensions.message);
                publish({
                    state: 'rejected', message: dimensions.message, code: dimensions.code,
                    ...identityDetail(checked.config), width: dimensions.width, height: dimensions.height,
                });
                return false;
            }
            suspended = checked.config.suspended;
            accessibility = Object.freeze({
                // Authored Still belongs to this plan. Do not remember it as
                // an OS accessibility preference when the next plan resumes.
                reducedMotion: config.reducedMotion === undefined ? accessibility.reducedMotion : config.reducedMotion === true,
                forcedColors: checked.config.forcedColors,
                reduceTransparency: checked.config.reduceTransparency,
            });
            if (instance && instanceLayer !== layer) teardown();
            if (!instance) {
                try {
                    instance = createInstance(layer, {
                        coordinatorProvider,
                        deviceProvider,
                        formatProvider,
                        canvasFactory,
                        pointerTarget: options.pointerTarget,
                        interactionFilter: options.interactionFilter,
                        accentProvider: options.accentProvider,
                        activityProvider: options.activityProvider,
                        contextOwnership: options.contextOwnership,
                        surfaceResize: options.surfaceResize,
                        removeCanvasOnDispose: options.removeCanvasOnDispose,
                        waitForWaterRetirements: options.waitForWaterRetirements === true,
                        maxPixels: runtimeMaxPixels,
                        runtime,
                        assetResolver: options.assetResolver,
                        audioProvider: options.audioProvider,
                        onStatus: publish,
                    });
                    instanceLayer = layer;
                } catch (error) {
                    applyFallback(layer, checked.config, error?.message);
                    publish({
                        state: 'failed', message: 'Ambient Runtime V3 surface creation failed.',
                        code: String(error?.code ?? 'AMBIENT_RUNTIME_V3_SURFACE_UNAVAILABLE'),
                        diagnostic: String(error?.message ?? error).slice(0, 512),
                        ...identityDetail(checked.config),
                    });
                    return false;
                }
            }
            instance.update(checked.config);
            return true;
        },
        setSuspended(value, detail = {}) {
            suspended = value === true;
            instance?.update?.({ suspended, suspensionReason: String(detail?.reason ?? '') });
        },
        setAccessibility(value = {}) {
            accessibility = Object.freeze({
                reducedMotion: value.reducedMotion === true,
                forcedColors: value.forcedColors === true,
                reduceTransparency: value.reduceTransparency === true,
            });
            instance?.update?.(accessibility);
        },
        status() { return instance?.status?.() ?? lastStatus; },
        reset(detail = {}) { return instance?.reset?.(detail) ?? false; },
        destroy() {
            teardown();
            publish({ state: 'idle', message: 'Ambient Runtime V3 wallpaper stopped.' });
        },
    });
}

function normalizeConfig(config, runtimeMaxPixels, suspended, accessibility) {
    if (!isPlainObject(config)) return failure('AMBIENT_RUNTIME_V3_CONFIG_INVALID', 'Ambient Runtime V3 config must be an object.');
    if (config.type !== 'webgpu-runtime-v3') {
        return failure('AMBIENT_RUNTIME_V3_CONFIG_TYPE', "Ambient Runtime V3 config type must be 'webgpu-runtime-v3'.");
    }
    const checked = validateAmbientRuntimeV3Plan(config.plan);
    if (!checked.ok) return checked;
    const plan = checked.plan;
    return Object.freeze({
        ok: true,
        config: Object.freeze({
            type: 'webgpu-runtime-v3',
            plan,
            execution: checked.execution,
            staticColor: normalizeColor(config.staticColor ?? plan.accessibility.staticFallback.color, '#05070c'),
            targetFps: boundedInteger(config.targetFps, plan.settings.targetFps, 1, 60),
            maxDpr: boundedNumber(config.maxDpr, plan.settings.maxDpr, 0.5, 4),
            maxPixels: Math.min(runtimeMaxPixels, boundedInteger(config.maxPixels, plan.settings.maxPixelCount, 4, 67_108_864)),
            renderScale: boundedNumber(config.renderScale, plan.settings.renderScale ?? 1, .1, 1),
            interactive: config.interactive !== false && plan.settings.interactive,
            suspended: config.suspended === undefined ? suspended : config.suspended === true,
            reducedMotion: plan.settings.motionPaused === true || (config.reducedMotion === undefined ? accessibility.reducedMotion : config.reducedMotion === true),
            forcedColors: config.forcedColors === undefined ? accessibility.forcedColors : config.forcedColors === true,
            reduceTransparency: config.reduceTransparency === undefined
                ? accessibility.reduceTransparency
                : config.reduceTransparency === true,
        }),
    });
}

function createInstance(layer, options) {
    const canvas = options.canvasFactory();
    if (!canvas) throw typedError('AMBIENT_RUNTIME_V3_SURFACE_UNAVAILABLE', 'The Ambient Runtime V3 canvas is unavailable.');
    canvas.className = 'os-ambient-runtime-v3-canvas';
    canvas.setAttribute?.('aria-hidden', 'true');
    if (canvas.style) canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    removeNonFxChildren(layer);
    layer?.insertBefore?.(canvas, layer.querySelector?.('#os-ambient-fx') ?? null);

    const inputSource = createAmbientRuntimeV3FrameInputSource({
        pointerTarget: options.pointerTarget,
        interactionFilter: options.interactionFilter,
        accentProvider: options.accentProvider,
        activityProvider: options.activityProvider,
    });
    const packedFrame = new Float32Array(AMBIENT_RUNTIME_V3_UNIFORM_BYTES / 4);
    const ownsContext = options.contextOwnership !== 'external';
    const removeCanvasOnDispose = options.removeCanvasOnDispose !== false;
    let disposed = false;
    let requestedConfig = null;
    let activeConfig = null;
    let statusConfig = null;
    let activeGpu = null;
    let frameHandle = null;
    let resizeObserver = null;
    let compileToken = 0;
    let compileController = null;
    let pendingCompile = null;
    let frameOperationToken = 0;
    let lifecycle = Object.freeze({ state: 'idle', message: 'Ambient Runtime V3 is idle.', code: null, diagnostic: null });
    let startTime = performance.now();
    let lastFrame = 0;
    let submittedFrames = 0;
    let lastSubmittedAt = null;
    let renderedStatic = false;
    const refreshHostResidency = gpu => {
        if (!gpu) return;
        gpu.hostResourceBytes = gpu.performance.resourceBudgetBytes + AMBIENT_RUNTIME_V3_UNIFORM_BYTES + ambientWaterResidentBytes(gpu.device,gpu);
        gpu.lane?.setHostResourceBytes?.(gpu.hostResourceBytes);
    };

    const isHidden = () => globalThis.document?.hidden === true;
    const shouldFreeze = config => !config || config.suspended || config.reducedMotion || config.forcedColors || isHidden();
    const ownsFrameOperation = (token, gpu, config) => !disposed && !pendingCompile
        && token === frameOperationToken && gpu === activeGpu && config === activeConfig;
    const frameOperationConfig = (token, gpu, config) => {
        if (!ownsFrameOperation(token, gpu, config)) {
            throw typedError('AMBIENT_RUNTIME_V3_FRAME_SUPERSEDED', 'The pending Ambient Runtime V3 frame update was superseded.');
        }
        return config;
    };
    const publish = (state, message, detail = {}, config = requestedConfig ?? activeConfig) => {
        statusConfig = config;
        lifecycle = Object.freeze({
            state,
            message,
            code: detail.code ?? null,
            diagnostic: detail.diagnostic ?? null,
            diagnostics: Number(detail.diagnostics ?? 0),
        });
        options.onStatus?.(snapshot(config));
    };
    const snapshot = (config = statusConfig ?? activeConfig ?? requestedConfig) => frozenStatus({
        ...lifecycle,
        ...identityDetail(config),
        recipeId: config?.plan?.recipeId ?? null,
        executionClass: config?.plan?.executionClass ?? null,
        frameInputSchema: AMBIENT_RUNTIME_V3_FRAME_SCHEMA,
        width: canvas.width,
        height: canvas.height,
        targetFps: config?.targetFps ?? 0,
        submittedFrames,
        lastSubmittedAt,
        deviceGeneration: activeGpu?.generation ?? null,
        suspended: config?.suspended === true,
        reducedMotion: config?.reducedMotion === true,
        forcedColors: config?.forcedColors === true,
        interactive: config?.interactive === true,
        ownedResources: resourceCounts(activeGpu),
        spatial: activeGpu?.lane?.diagnostics?.() ?? activeGpu?.finiteWater?.diagnostics?.() ?? null,
        performance: activeGpu?.performance ? { ...activeGpu.performance.snapshot(), hostResourceBytes: activeGpu.hostResourceBytes,
            sharedWaterResidency: ambientWaterResidencySnapshot(activeGpu.device),
            retiredWaterBytes: ambientWaterRetiredBytes(activeGpu.device), retiredLaneCount: ambientWaterRetirementSnapshot(activeGpu.device).count,
            failedRetirementFences: ambientWaterRetirementSnapshot(activeGpu.device).failed } : null,
        receipt: submittedFrames && activeConfig ? {
            projectId: activeConfig.plan.projectId,
            revision: activeConfig.plan.revision,
            contentHash: activeConfig.plan.contentHash,
            runtimeId: activeConfig.runtimeId ?? AMBIENT_RUNTIME_V3_ID,
            runtimeAbi: activeConfig.runtimeAbi ?? AMBIENT_RUNTIME_V3_ABI,
            recipeId: activeConfig.plan.recipeId,
            executionClass: activeConfig.plan.executionClass,
            width: canvas.width,
            height: canvas.height,
            frameCount: submittedFrames,
            lastSubmittedAt,
        } : null,
    });

    const stopLoop = () => {
        frameHandle?.unregister?.();
        frameHandle = null;
        activeGpu?.lane?.setSuspended?.(true);
    };

    const resize = (config, gpu) => {
        if (!gpu?.context) return false;
        const scale = ambientRuntimeV3WaterRenderScale(config, gpu.performance?.snapshot?.().qualityDecision, gpu.lane?.diagnostics?.() ?? {});
        if (scale !== (config.renderScale ?? 1)) config = { ...config, renderScale: scale };
        if (!ownsContext) {
            const rect = layer?.getBoundingClientRect?.();
            const cssWidth = Math.floor(Number(rect?.width));
            const cssHeight = Math.floor(Number(rect?.height));
            if (cssWidth < 2 || cssHeight < 2) throw dimensionError(cssWidth, cssHeight);
            const oldWidth = Number(canvas.width ?? 0);
            const oldHeight = Number(canvas.height ?? 0);
            const renderScale = config.renderScale ?? 1;
            options.surfaceResize?.(Math.max(2, Math.floor(cssWidth * renderScale)), Math.max(2, Math.floor(cssHeight * renderScale)));
            if (canvas.width < 2 || canvas.height < 2) {
                throw typedError('AMBIENT_RUNTIME_V3_SURFACE_UNAVAILABLE', `The kernel-owned Ambient V3 surface is ${canvas.width}x${canvas.height}.`);
            }
            const changed = canvas.width !== oldWidth || canvas.height !== oldHeight;
            if (changed || !gpu.laneSized) {
                if (gpu.lane?.resize?.(canvas.width, canvas.height)) gpu.frameIndex = 0;
                gpu.laneSized = true;
            }
            gpu.contextConfigured = true;
            return changed;
        }
        const measured = measureBackingDimensions(layer, config, Number(gpu.device?.limits?.maxTextureDimension2D ?? 8192));
        if (!measured.ok) throw typedError(measured.code, measured.message);
        const changed = canvas.width !== measured.width || canvas.height !== measured.height;
        if (changed) {
            canvas.width = measured.width;
            canvas.height = measured.height;
        }
        if (changed || !gpu.contextConfigured) {
            gpu.context.configure({ device: gpu.device, format: gpu.format, alphaMode: 'premultiplied' });
            gpu.contextConfigured = true;
        }
        if (changed || !gpu.laneSized) {
            if (gpu.lane?.resize?.(canvas.width, canvas.height)) gpu.frameIndex = 0;
            gpu.laneSized = true;
        }
        return changed;
    };

    const renderFrame = (now, config = activeConfig, gpu = activeGpu) => {
        if (disposed || !gpu?.device || !gpu.context || !config) return false;
        const frozen = shouldFreeze(config);
        if (frozen && renderedStatic && gpu === activeGpu) { stopLoop(); return false; }
        const admission = gpu.performance?.beforeFrame(now, config.targetFps);
        if (admission && !admission.admitted) return false;
        const cpuStarted = performance.now();
        // Other active, constructing and retired owners share this device.
        // A candidate's own construction envelope is excluded exactly once.
        refreshHostResidency(gpu);
        resize(config, gpu);
        if(gpu===activeGpu) updateAmbientWaterResidency(gpu.device,gpu,gpuResourceBytes(gpu));
        const previousFrame = lastFrame;
        const elapsedSeconds = frozen ? 0 : Math.max(0, (now - startTime) / 1000);
        const deltaSeconds = frozen || !previousFrame ? 0 : Math.max(0, Math.min(0.1, (now - previousFrame) / 1000));
        const rect = layer?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: canvas.width, height: canvas.height };
        // CSS gradient lengths remain stable when the backing surface is scaled.
        const classicCoordinates = config.plan.recipeId === 'classic-wallpaper';
        let frame = inputSource.snapshot({
            now,
            width: classicCoordinates ? Math.max(1, Math.round(rect.width)) : canvas.width,
            height: classicCoordinates ? Math.max(1, Math.round(rect.height)) : canvas.height,
            rect,
            elapsedSeconds,
            deltaSeconds,
            frameIndex: gpu.frameIndex,
            interactive: config.interactive && !config.forcedColors,
            reducedMotion: frozen,
            reduceTransparency: config.reduceTransparency,
            settings: config.plan.settings,
        });
        // New saved finite-water programs opt into the same submitted-time
        // convention as retained water lanes. Pausing does not rewind them or
        // consume the covered interval; older saved programs retain their ABI.
        const waterPaused = frozen || frame.effects[3] > .5;
        const waterFrame = gpu.waterClock?.prepare({ deltaSeconds, speed: config.plan.settings.speed,
            paused: waterPaused, advance: Boolean(frameHandle) });
        frame = projectAmbientProgramWaterFrame(frame,waterFrame,{previousTime:gpu.waterClock?.time??0,paused:waterPaused});
        // Retained simulations may own a continuous clock. The same projected
        // frame feeds rendering and simulation, including a frozen one-shot.
        if (gpu.lane?.prepareFrame) frame = gpu.lane.prepareFrame(frame);
        packAmbientRuntimeV3FrameInputs(frame, packedFrame);
        gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, packedFrame);
        gpu.performance?.beginFrame(cpuStarted);
        const rawEncoder = gpu.device.createCommandEncoder({ label: `ambient-v3-${config.plan.recipeId}-frame` });
        const encoder = gpu.performance?.wrapEncoder(rawEncoder) ?? rawEncoder;
        const targetView = gpu.context.getCurrentTexture().createView();
        const clearValue = colorToClearValue(config.plan.settings.clearColor);
        let commit = null;
        let finiteToken = null;
        let timingQueued = false;
        try {
            if (gpu.lane) commit = gpu.lane.encode(encoder, targetView, clearValue, { frame, now, config, frameIndex: gpu.frameIndex,
                qualityDecision: admission?.qualityDecision, hostResourceBytes: gpu.hostResourceBytes ?? 0 });
            else {
                finiteToken=gpu.finiteWater?.encode(encoder,{time:frame.resolutionTime[2],delta:frame.resolutionTime[3],
                    paused:waterPaused,width:canvas.width,height:canvas.height,pointer:{x:frame.pointer[0],y:frame.pointer[1],
                        active:frame.pointerState[0]>0,pressed:frame.pointerState[1]>0,clickSerial:frame.pointerState[3],
                        clickX:frame.clickActivity[0],clickY:frame.clickActivity[1]}});
                const pass = encoder.beginRenderPass({
                    label: `ambient-v3-${config.plan.recipeId}-present`,
                    colorAttachments: [{ view: targetView, clearValue, loadOp: 'clear', storeOp: 'store' }],
                });
                pass.setPipeline(gpu.pipeline);
                pass.setBindGroup(0, gpu.bindGroup);
                finiteToken?.bind(pass);
                pass.draw(3);
                pass.end();
            }
            if(gpu===activeGpu) updateAmbientWaterResidency(gpu.device,gpu,gpuResourceBytes(gpu));
            timingQueued = gpu.performance?.resolve(rawEncoder) ?? false;
            gpu.device.queue.submit([encoder.finish()]);
            commit?.();
            finiteToken?.commit();
            waterFrame?.commit();
            gpu.completionFence = gpu.performance?.submitted(performance.now() - cpuStarted, timingQueued) ?? Promise.resolve();
        } catch (error) {
            // A failed encoding/submission must not strand a retained lane in
            // its pending state or consume its click, reset, or simulation time.
            gpu.lane?.abortFrame?.();
            finiteToken?.abort();
            waterFrame?.abort();
            gpu.performance?.abortFrame?.();
            throw error;
        }
        gpu.frameIndex += 1;
        lastFrame = now;
        submittedFrames += 1;
        lastSubmittedAt = performance.now();
        renderedStatic = frozen;
        if (frozen) stopLoop();
        return true;
    };

    const renderOneShot = (now, config = activeConfig, gpu = activeGpu) => {
        const telemetry = gpu?.performance?.snapshot?.();
        if (telemetry && telemetry.queueDepth >= telemetry.queueCapacity && gpu.completionFence) {
            // Authored updates wait for the owner's existing completion fence;
            // their eventual finite GPU permit still has a synchronous body.
            return gpu.completionFence.then(() => renderOneShot(now, config, gpu));
        }
        // A queued one-shot runs at the existing host clock's current time;
        // accepted producer frames may have advanced while its fence waited.
        const render = () => renderFrame(performance.now(), typeof config === 'function' ? config() : config, gpu);
        if (typeof gpu?.device?.runOneShot === 'function') {
            return gpu.device.runOneShot({
                // The guarded facade accounts the uniform upload and queue
                // submission as the two finite queue operations. All encoded
                // passes share that single submission.
                kind: 'job', maxOperations: 2 + Number(gpu.lane?.oneShotBudget?.().operations ?? 0)
                    + Number(gpu.finiteWater?.oneShotBudget?.().writeOperations ?? 0),
                maxSubmissions: 1,
                maxBytes: AMBIENT_RUNTIME_V3_UNIFORM_BYTES + Number(gpu.lane?.oneShotBudget?.().bytes ?? 0)
                    + Number(gpu.finiteWater?.oneShotBudget?.().writeBytes ?? 0)
                    + Number(gpu.performance?.resourceBudgetBytes ?? 0), durationMs: 1_000,
            }, render);
        }
        if (gpu?.device?.__isGpuFacade === true) {
            throw typedError('AMBIENT_RUNTIME_V3_GPU_AUTHORITY_UNAVAILABLE', 'The guarded GPU device did not provide finite first-frame authority.');
        }
        return render();
    };

    const resume = () => {
        const wasRunning = Boolean(frameHandle);
        stopLoop();
        if (disposed || pendingCompile || !activeGpu || !activeConfig || !Number.isInteger(activeGpu.generation) || shouldFreeze(activeConfig)) return false;
        if (!wasRunning) lastFrame = performance.now();
        activeGpu.lane?.setSuspended?.(false);
        const coordinator = options.coordinatorProvider?.();
        if (!coordinator) throw typedError('AMBIENT_RUNTIME_V3_FRAME_COORDINATOR_UNAVAILABLE', 'Ambient Runtime V3 frame scheduling is unavailable.');
        const waterDetail=activeGpu.lane?.diagnostics?.()??{};
        const phaseCadence=Boolean(activeGpu.waterClock)||waterDetail.waterSurfaceVersion===2
            ||(activeConfig.plan.executionClass==='mesh-ocean'&&waterDetail.waterField!=null);
        frameHandle = coordinator.registerProducer({
            ownerId: 'os.kernel.ambient',
            surfaceId: options.runtime?.surfaceId ?? 'os-ambient-runtime-v3',
            generation: activeGpu.generation,
            priority: 320,
            targetFps: activeConfig.targetFps,
            ...(phaseCadence?{cadenceMode:'phase'}:{}),
            visible: true,
            focused: true,
            minimized: false,
            cpuBudgetMs: 6,
            callback: ({ now }) => {
                try { return { submitted: renderFrame(now) }; }
                catch (error) {
                    stopLoop();
                    publish('failed', 'Ambient Runtime V3 rendering stopped; the last valid frame remains.', {
                        code: String(error?.code ?? 'AMBIENT_RUNTIME_V3_RENDER_FAILED'),
                        diagnostic: String(error?.message ?? error).slice(0, 512),
                    }, activeConfig);
                    console.warn('[AmbientRuntimeV3Driver][frame][error]', error);
                    return { submitted: false };
                }
            },
        });
        return true;
    };

    const compile = async config => {
        const token = ++compileToken;
        const initialClickSerial=inputSource.currentClickSerial();
        frameOperationToken += 1;
        pendingCompile = { token, contentHash: config.plan.contentHash, config };
        compileController?.abort();
        const controller = compileController = new AbortController();
        stopLoop();
        publish('compiling', `Compiling ${config.plan.metadata.title}.`, {}, config);
        let candidate = null;
        try {
            const device = await Promise.resolve(options.deviceProvider());
            if (disposed || token !== compileToken) return;
            if (!device?.createShaderModule || !device?.createBuffer || !device?.createBindGroup || !device?.queue) {
                throw typedError('AMBIENT_RUNTIME_V3_GPU_UNAVAILABLE', 'The shared WebGPU device is unavailable.');
            }
            const coordinator = options.coordinatorProvider?.();
            const deviceGeneration = coordinator?.generationForDevice?.(device);
            if (!Number.isInteger(deviceGeneration)) {
                throw typedError('AMBIENT_RUNTIME_V3_GPU_GENERATION_STALE', 'The shared WebGPU device generation is not current.');
            }
            const format = options.formatProvider?.();
            if (typeof format !== 'string' || !format) {
                throw typedError('AMBIENT_RUNTIME_V3_FORMAT_UNAVAILABLE', 'The preferred WebGPU canvas format is unavailable.');
            }
            const context = activeGpu?.context ?? canvas.getContext?.('webgpu');
            if (!context?.getCurrentTexture || (ownsContext && !context.configure)) {
                throw typedError('AMBIENT_RUNTIME_V3_SURFACE_UNAVAILABLE', 'The Ambient Runtime V3 GPU surface is unavailable.');
            }
            candidate = {
                device, generation: deviceGeneration, context, format, uniformBuffer:null,
                pipeline: null, bindGroup: null, lane: null, contextConfigured: false, laneSized: false, frameIndex: 0,
            };
            try {
                const finite=config.plan.executionClass==='program'?inspectFiniteAmbientWater(config.plan.program.sourceWGSL):null;
                const minimum=AMBIENT_RUNTIME_V3_UNIFORM_BYTES+ambientRuntimeV3PerformanceResourceBudgetBytes(device)+(finite?.resourceBytes??0);
                const fullEnvelope=config.plan.executionClass!=='program'||finite!==null;
                if(options.waitForWaterRetirements===true) {
                    await reserveAmbientWaterConstructionAfterRetirements(device,candidate,minimum,{fullEnvelope,signal:controller.signal});
                }else reserveAmbientWaterConstruction(device,candidate,minimum,{fullEnvelope});
            } catch(error) {
                candidate=null;
                throw typedError('AMBIENT_RUNTIME_V3_WATER_RESIDENCY',String(error.message));
            }
            if(disposed||token!==compileToken) {disposeGpu(candidate);candidate=null;return;}
            if(coordinator.generationForDevice(device)!==deviceGeneration) {
                throw typedError('AMBIENT_RUNTIME_V3_GPU_GENERATION_STALE','The shared WebGPU device generation changed while retiring water.');
            }
            const uniformBuffer = candidate.uniformBuffer = device.createBuffer({
                label: `ambient-v3-${config.plan.recipeId}-frame-inputs`,
                size: AMBIENT_RUNTIME_V3_UNIFORM_BYTES,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
            });
            if (config.plan.executionClass === 'program' && ambientProgramHasVersionedWater(config.plan.program.sourceWGSL)) {
                candidate.waterClock = createAmbientProgramWaterClock({ time: activeConfig?.plan?.program?.sourceWGSL === config.plan.program.sourceWGSL
                    && activeConfig?.plan?.recipeId === config.plan.recipeId ? activeGpu?.waterClock?.time ?? 0 : 0 });
            }
            const performanceGpu = candidate;
            candidate.performance = createAmbientRuntimeV3Performance({ device, generation: deviceGeneration, targetFPS: config.targetFps,
                isCurrent: () => !disposed && !performanceGpu.disposed && options.coordinatorProvider?.()?.generationForDevice?.(device) === deviceGeneration,
                logger: event => console.debug('[AmbientRuntimeV3Driver][performance]', event) });
            refreshHostResidency(candidate);
            let diagnostics = 0;
            if (options.runtime?.createLane) {
                candidate.lane = await options.runtime.createLane({
                    device, format, plan: config.plan, uniformBuffer,
                    assetResolver: options.assetResolver, audioProvider: options.audioProvider,
                    signal: controller.signal,
                    hostResourceBytes: candidate.hostResourceBytes,
                    initialClickSerial,
                });
            } else if (config.plan.executionClass === 'program') {
                const code = buildAmbientRuntimeV3ProgramSource(config.plan.program.sourceWGSL, config.plan.contentHash, { recipeId: config.plan.recipeId });
                candidate.finiteWater=await createFiniteAmbientWaterLane({device,sourceWGSL:config.plan.program.sourceWGSL,
                    builtSource:code,frameBuffer:uniformBuffer,frameFlavor:'v3',budgetBytes:64*1024*1024-candidate.hostResourceBytes,
                    signal:controller.signal,initialClickSerial});
                const module = device.createShaderModule({ label: `ambient-v3-${config.plan.recipeId}-program`, code:candidate.finiteWater?.shaderSource??code });
                const info = module?.getCompilationInfo ? await module.getCompilationInfo() : { messages: [] };
                const error = info.messages?.find(message => message.type === 'error');
                if (error) {
                    const location = Number.isInteger(error.lineNum)
                        ? `line ${error.lineNum}${Number.isInteger(error.linePos) ? `:${error.linePos}` : ''}: `
                        : '';
                    throw typedError('AMBIENT_RUNTIME_V3_SHADER_INVALID', `${location}${String(error.message ?? 'Ambient V3 shader compilation failed.')}`);
                }
                diagnostics = info.messages?.length ?? 0;
                candidate.pipeline = await withErrorScope(device, () => {
                    const descriptor = {
                        label: `ambient-v3-${config.plan.recipeId}-pipeline`, layout: candidate.finiteWater?.pipelineLayout??'auto',
                        vertex: { module, entryPoint: 'ambientV3Vertex' },
                        fragment: { module, entryPoint: 'ambientV3Fragment', targets: [{ format }] },
                        primitive: { topology: 'triangle-list' },
                    };
                    return device.createRenderPipelineAsync
                        ? device.createRenderPipelineAsync(descriptor)
                        : device.createRenderPipeline(descriptor);
                });
                candidate.bindGroup = device.createBindGroup({
                    label: `ambient-v3-${config.plan.recipeId}-bind-group`,
                    layout: candidate.pipeline.getBindGroupLayout(0),
                    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                });
            } else {
                candidate.lane = await withErrorScope(device, () => createAmbientRuntimeV3DedicatedLane({
                    device, format, plan: config.plan, uniformBuffer,
                    hostResourceBytes: candidate.hostResourceBytes, signal: controller.signal,initialClickSerial,
                }));
            }
            if (disposed || token !== compileToken) { disposeGpu(candidate); return; }
            // Host policy can change while native pipeline creation is pending.
            // Reuse that pipeline, but submit its first frame with the latest
            // admitted pause, accessibility, sizing and interaction settings.
            config = pendingCompile.config;
            resize(config, candidate);
            const previousGpu = activeGpu;
            const previousStart = startTime;
            const previousLastFrame = lastFrame;
            const previousRenderedStatic = renderedStatic;
            startTime = performance.now();
            lastFrame = 0;
            renderedStatic = false;
            const firstFrameConfig = () => {
                if (disposed || token !== compileToken) {
                    throw typedError('AMBIENT_RUNTIME_V3_COMPILE_SUPERSEDED', 'The pending Ambient Runtime V3 first frame was superseded.');
                }
                config = pendingCompile.config;
                return config;
            };
            try {
                do {
                    const submitted = await Promise.resolve(renderOneShot(performance.now(), firstFrameConfig, candidate));
                    if (disposed || token !== compileToken) { disposeGpu(candidate); candidate = null; return; }
                    if (!submitted) {
                        throw typedError('AMBIENT_RUNTIME_V3_FIRST_FRAME_FAILED', 'Ambient Runtime V3 compiled but submitted no first frame.');
                    }
                    // A guarded surface may acknowledge its synchronous draw
                    // asynchronously. Refresh any policy admitted during that
                    // acknowledgement before publishing the running receipt.
                } while (config !== pendingCompile.config);
            } catch (error) {
                if (!disposed && token === compileToken) {
                    startTime = previousStart;
                    lastFrame = previousLastFrame;
                    renderedStatic = previousRenderedStatic;
                }
                throw error;
            }
            updateAmbientWaterResidency(device,candidate,gpuResourceBytes(candidate));
            activeGpu = candidate;
            activeConfig = config;
            candidate = null;
            disposeGpu(previousGpu);
            refreshHostResidency(activeGpu);
            if (pendingCompile?.token === token) pendingCompile = null;
            publish('running', `${config.plan.metadata.title} is running.`, { diagnostics }, config);
            resume();
        } catch (error) {
            const failedCandidate = candidate;
            disposeGpu(candidate);
            // A failed preview becomes actionable after its constructor has
            // unwound and its existing queue fence has retired the envelope.
            // Otherwise an immediate edit/retry observes that temporary full
            // reservation and reports a misleading memory error.
            if (failedCandidate?.retirementCompletion) await failedCandidate.retirementCompletion.catch(() => {});
            if (disposed || token !== compileToken) return;
            publish('failed', 'Ambient Runtime V3 compilation failed; the last valid frame remains.', {
                code: String(error?.code ?? 'AMBIENT_RUNTIME_V3_COMPILE_FAILED'),
                diagnostic: String(error?.message ?? error).slice(0, 512),
            }, config);
            layer.style.background = config.staticColor;
            if (!activeGpu) canvas.style.display = 'none';
            console.warn('[AmbientRuntimeV3Driver][compile][error]', error);
        } finally {
            if (pendingCompile?.token === token) pendingCompile = null;
        }
    };

    const onVisibility = () => {
        if (isHidden()) stopLoop();
        else {
            renderedStatic = false;
            try { resume(); } catch (error) { console.warn('[AmbientRuntimeV3Driver][visibility][error]', error); }
        }
    };
    globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
    if (globalThis.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => {
            if (pendingCompile || !activeConfig || !activeGpu) return;
            try {
                const changed = resize(activeConfig, activeGpu);
                if (changed && shouldFreeze(activeConfig)) {
                    renderedStatic = false;
                    void Promise.resolve(renderOneShot(performance.now()));
                }
                resume();
            } catch (error) {
                publish('failed', 'Ambient Runtime V3 surface resize failed.', {
                    code: String(error?.code ?? 'AMBIENT_RUNTIME_V3_DIMENSIONS_INVALID'),
                    diagnostic: String(error?.message ?? error).slice(0, 512),
                }, activeConfig);
            }
        });
        resizeObserver.observe(layer);
    } else globalThis.window?.addEventListener?.('resize', onVisibility);

    return Object.freeze({
        update(patch = {}) {
            if (disposed) return;
            const token = ++frameOperationToken;
            const merged = { ...(requestedConfig ?? activeConfig ?? {}), ...patch };
            if (merged.plan?.settings?.motionPaused === true || merged.plan?.accessibility?.reducedMotion === true) {
                merged.reducedMotion = true;
                merged.interactive = false;
            }
            const next = Object.freeze(merged);
            requestedConfig = next;
            canvas.style.display = next.forcedColors ? 'none' : 'block';
            layer.style.background = next.staticColor;
            inputSource.bind(next.interactive && !next.reducedMotion && !next.forcedColors);
            if (pendingCompile?.contentHash === next.plan?.contentHash) {
                pendingCompile.config = next;
                publish('compiling', `Compiling ${next.plan.metadata.title}.`, {}, next);
                return;
            }
            const reuseFinite=activeGpu?.finiteWater&&next.plan?.executionClass==='program'
                &&next.plan.recipeId===activeConfig?.plan.recipeId&&next.plan.program.sourceWGSL===activeConfig?.plan.program.sourceWGSL;
            if (!activeGpu || next.plan?.contentHash !== activeConfig?.plan?.contentHash && !activeGpu.lane?.canReusePlan?.(next.plan)&&!reuseFinite) {
                void compile(next);
                return;
            }
            // Returning to the current plan supersedes a different pending
            // candidate even though the active pipeline itself can be reused.
            if (pendingCompile) {
                compileToken += 1;
                compileController?.abort();
                pendingCompile = null;
            }
            const previous = activeConfig;
            const gpu = activeGpu;
            activeConfig = next;
            renderedStatic = false;
            try {
                void Promise.resolve(renderOneShot(performance.now(), () => frameOperationConfig(token, gpu, next), gpu)).then(submitted => {
                    if (!ownsFrameOperation(token, gpu, next)) return;
                    if (!submitted && !shouldFreeze(next)) throw typedError('AMBIENT_RUNTIME_V3_FRAME_UPDATE_FAILED', 'Ambient Runtime V3 update submitted no frame.');
                    publish('running', `${next.plan.metadata.title} is running.`, {}, next);
                    resume();
                }).catch(error => {
                    if (!ownsFrameOperation(token, gpu, next)) return;
                    activeConfig = previous;
                    publish('failed', 'Ambient Runtime V3 update failed; the last valid frame remains.', {
                        code: String(error?.code ?? 'AMBIENT_RUNTIME_V3_FRAME_UPDATE_FAILED'),
                        diagnostic: String(error?.message ?? error).slice(0, 512),
                    }, next);
                });
            } catch (error) {
                if (!ownsFrameOperation(token, gpu, next)) return;
                activeConfig = previous;
                publish('failed', 'Ambient Runtime V3 update failed; the last valid frame remains.', {
                    code: String(error?.code ?? 'AMBIENT_RUNTIME_V3_FRAME_UPDATE_FAILED'),
                    diagnostic: String(error?.message ?? error).slice(0, 512),
                }, next);
            }
        },
        status() { return snapshot(); },
        reset(detail = {}) {
            if (disposed || pendingCompile || !activeGpu?.lane?.reset) return false;
            const token = ++frameOperationToken;
            const gpu = activeGpu;
            const config = activeConfig;
            try {
                gpu.lane.reset(detail); renderedStatic = false;
                void Promise.resolve(renderOneShot(performance.now(), () => frameOperationConfig(token, gpu, config), gpu)).then(() => {
                    if (!ownsFrameOperation(token, gpu, config)) return;
                    publish('running', `${config.plan.metadata.title} reformed.`, {}, config); resume();
                }).catch(error => {
                    if (!ownsFrameOperation(token, gpu, config)) return;
                    publish('failed', 'Wallpaper reset failed.', { diagnostic: String(error.message) }, config);
                });
                return true;
            } catch (error) {
                if (ownsFrameOperation(token, gpu, config)) {
                    publish('failed', 'Wallpaper reset failed.', { diagnostic: String(error.message) }, config);
                }
                return false;
            }
        },
        dispose() {
            if (disposed) return false;
            disposed = true;
            compileToken += 1;
            frameOperationToken += 1;
            compileController?.abort();
            pendingCompile = null;
            stopLoop();
            inputSource.dispose();
            globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
            resizeObserver?.disconnect?.();
            globalThis.window?.removeEventListener?.('resize', onVisibility);
            const context = activeGpu?.context ?? null;
            disposeGpu(activeGpu);
            activeGpu = null;
            try { if (ownsContext) context?.unconfigure?.(); } catch {}
            if (removeCanvasOnDispose) canvas.remove?.();
            return true;
        },
    });
}

function gpuResourceBytes(gpu) {
    const detail=gpu.lane?.diagnostics?.()??{};
    return Math.ceil(Math.max(0,Number(detail.waterResourceBytes??detail.residentBytes??0))
        +Number(gpu.finiteWater?.resourceBytes??0)+Number(gpu.performance?.resourceBudgetBytes??0)+(gpu.uniformBuffer?AMBIENT_RUNTIME_V3_UNIFORM_BYTES:0));
}

function disposeGpu(gpu) {
    if (!gpu || gpu.disposed) return false;
    gpu.disposed = true;
    const bytes = gpuResourceBytes(gpu);
    try { gpu.performance?.dispose?.(); } catch {}
    try { gpu.lane?.dispose?.(); } catch {}
    try { gpu.finiteWater?.dispose?.(); } catch {}
    try { gpu.uniformBuffer?.destroy?.(); } catch {}
    let completion,settled;
    try { completion = typeof gpu.device.queue.onSubmittedWorkDone === 'function' ? gpu.device.queue.onSubmittedWorkDone() : Promise.resolve(); }
    catch(error) { completion = Promise.reject(error); }
    try { settled = Promise.all([gpu.lane?.retirementSettled?.()??Promise.resolve(),gpu.finiteWater?.whenSettled?.()??Promise.resolve()]); }
    catch(error) { settled = Promise.reject(error); }
    gpu.retirementCompletion = Promise.all([completion, settled]);
    void gpu.retirementCompletion.catch(() => {});
    retainAmbientWaterRetirement(gpu.device,gpu,Math.ceil(bytes),completion,settled);
    return true;
}

function resourceCounts(gpu) {
    const lane = gpu?.lane?.resourceCounts?.() ?? {};
    const timing = gpu?.performance?.resourceCounts?.() ?? {};
    const finite = gpu?.finiteWater?.resourceCounts?.() ?? {};
    return {
        buffers: (gpu?.uniformBuffer ? 1 : 0) + Number(lane.buffers ?? 0) + Number(timing.buffers ?? 0)+Number(finite.buffers??0),
        textures: Number(lane.textures ?? 0)+Number(finite.textures??0),
        persistentBuffers: Number(lane.persistentBuffers ?? 0)+Number(finite.buffers??0),
        persistentTextures: Number(lane.persistentTextures ?? 0)+Number(finite.textures??0),
    };
}

function measureBackingDimensions(layer, config, deviceLimit = 8192) {
    const rect = layer?.getBoundingClientRect?.();
    const cssWidth = Math.floor(Number(rect?.width));
    const cssHeight = Math.floor(Number(rect?.height));
    if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth < 1 || cssHeight < 1) {
        return dimensionFailure(0, 0);
    }
    let dpr = Math.min(config.maxDpr, Math.max(0.5, Number(globalThis.devicePixelRatio) || 1)) * (config.renderScale ?? 1);
    const requestedPixels = cssWidth * cssHeight * dpr * dpr;
    if (requestedPixels > config.maxPixels) dpr *= Math.sqrt(config.maxPixels / requestedPixels);
    // One scale preserves the CSS aspect ratio when either axis reaches the
    // physical-device limit, just as it does for the total pixel budget.
    dpr = Math.min(dpr, deviceLimit / cssWidth, deviceLimit / cssHeight);
    const width = Math.floor(cssWidth * dpr);
    const height = Math.floor(cssHeight * dpr);
    if (width < 2 || height < 2) return dimensionFailure(width, height);
    return Object.freeze({ ok: true, width, height, dpr });
}

function dimensionError(width, height) {
    return typedError('AMBIENT_RUNTIME_V3_DIMENSIONS_INVALID', `Ambient Runtime V3 requires at least 2x2 CSS pixels; received ${Math.max(0, width || 0)}x${Math.max(0, height || 0)}.`);
}

function dimensionFailure(width, height) {
    return Object.freeze({
        ok: false,
        code: 'AMBIENT_RUNTIME_V3_DIMENSIONS_INVALID',
        message: 'Ambient Runtime V3 activation requires backing dimensions of at least 2 by 2 pixels.',
        width,
        height,
    });
}

function identityDetail(config) {
    return {
        projectId: config?.plan?.projectId ?? null,
        revision: config?.plan?.revision ?? null,
        planSchema: config?.plan?.schema ?? null,
        contentHash: config?.plan?.contentHash ?? null,
        runtimeId: config?.runtimeId ?? AMBIENT_RUNTIME_V3_ID,
        runtimeAbi: config?.runtimeAbi ?? AMBIENT_RUNTIME_V3_ABI,
    };
}

function frozenStatus(detail = {}) {
    return deepFreeze({
        state: String(detail.state ?? 'idle'),
        message: String(detail.message ?? '').slice(0, 512),
        code: detail.code ? String(detail.code).slice(0, 96) : null,
        diagnostic: detail.diagnostic ? String(detail.diagnostic).slice(0, 512) : null,
        diagnostics: Number(detail.diagnostics ?? 0),
        projectId: detail.projectId ?? null,
        revision: detail.revision ?? null,
        planSchema: detail.planSchema ?? null,
        contentHash: detail.contentHash ?? null,
        runtimeId: detail.runtimeId ?? AMBIENT_RUNTIME_V3_ID,
        runtimeAbi: detail.runtimeAbi ?? AMBIENT_RUNTIME_V3_ABI,
        recipeId: detail.recipeId ?? null,
        executionClass: detail.executionClass ?? null,
        frameInputSchema: detail.frameInputSchema ?? AMBIENT_RUNTIME_V3_FRAME_SCHEMA,
        width: Number(detail.width ?? 0),
        height: Number(detail.height ?? 0),
        targetFps: Number(detail.targetFps ?? 0),
        submittedFrames: Number(detail.submittedFrames ?? 0),
        frameCount: Number(detail.submittedFrames ?? detail.frameCount ?? 0),
        lastSubmittedAt: Number.isFinite(detail.lastSubmittedAt) ? Number(detail.lastSubmittedAt) : null,
        deviceGeneration: Number.isInteger(detail.deviceGeneration) ? detail.deviceGeneration : null,
        suspended: detail.suspended === true,
        reducedMotion: detail.reducedMotion === true,
        forcedColors: detail.forcedColors === true,
        interactive: detail.interactive === true,
        ownedResources: {
            buffers: Number(detail.ownedResources?.buffers ?? 0),
            textures: Number(detail.ownedResources?.textures ?? 0),
            persistentBuffers: Number(detail.ownedResources?.persistentBuffers ?? 0),
            persistentTextures: Number(detail.ownedResources?.persistentTextures ?? 0),
        },
        receipt: detail.receipt ? cloneJson(detail.receipt) : null,
        spatial: detail.spatial ? cloneJson(detail.spatial) : null,
        performance: detail.performance ? cloneJson(detail.performance) : null,
    });
}

function removeNonFxChildren(layer) {
    for (const child of [...(layer?.children ?? [])]) {
        if (child.id !== 'os-ambient-fx') child.remove?.();
    }
}

function applyFallback(layer, config, message) {
    removeNonFxChildren(layer);
    if (!layer) return;
    layer.style.background = normalizeColor(config?.staticColor ?? config?.plan?.accessibility?.staticFallback?.color, '#05070c');
    if (layer.dataset) layer.dataset.ambientError = String(message ?? '').slice(0, 256);
}

function normalizeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? String(value).toLowerCase() : fallback;
}

function colorToClearValue(value) {
    const hex = normalizeColor(value, '#05070c').slice(1);
    return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: 1,
    };
}

function boundedInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isSafeInteger(number) ? number : fallback));
}

function boundedNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function typedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function failure(code, message) {
    return Object.freeze({ ok: false, code, message });
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}
