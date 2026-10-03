// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Kernel-owned, ordered multi-layer wallpaper runtime. */

import {
    AMBIENT_PROGRAM_UNIFORM_BYTES,
    buildAmbientProgramSource,
} from '../schema/AmbientProgramContract.js';
import {
    COMPOSITE_AMBIENT_BUILD_ID,
    COMPOSITE_AMBIENT_RECEIPT_SCHEMA,
    COMPOSITE_AMBIENT_RUNTIME_ABI,
    COMPOSITE_AMBIENT_RUNTIME_ID,
    validateCompositeAmbientPlan,
} from '../schema/CompositeAmbientContract.js';
import { getDefaultGpuFrameCoordinator } from '../GpuFrameCoordinator.js';
import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';
import { createAmbientCompositeMedia } from './AmbientCompositeMedia.js';

export {
    COMPOSITE_AMBIENT_BUILD_ID,
    COMPOSITE_AMBIENT_PLAN_SCHEMA,
    COMPOSITE_AMBIENT_PLAN_VERSION,
    COMPOSITE_AMBIENT_RECEIPT_SCHEMA,
    COMPOSITE_AMBIENT_RUNTIME_ABI,
    COMPOSITE_AMBIENT_RUNTIME_ID,
    compositeAmbientPlanHash,
    createCompositeAmbientPlan,
    resolveCompositeAmbientExecution,
    validateCompositeAmbientPlan,
} from '../schema/CompositeAmbientContract.js';

const DEFAULT_MAX_PIXELS = 4 * 1024 * 1024;
const BUFFER_USAGE_UNIFORM = globalThis.GPUBufferUsage?.UNIFORM ?? 0x0040;
const BUFFER_USAGE_COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;

export function createWebGPUCompositeAmbientDriver(options = {}) {
    const coordinatorProvider = () => options.frameCoordinator ?? getDefaultGpuFrameCoordinator();
    const deviceProvider = typeof options.deviceProvider === 'function'
        ? options.deviceProvider
        : () => coordinatorProvider()?.currentDevice?.() ?? null;
    const formatProvider = typeof options.formatProvider === 'function'
        ? options.formatProvider
        : () => globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() ?? null;
    const canvasFactory = typeof options.canvasFactory === 'function'
        ? options.canvasFactory
        : () => document.createElement('canvas');
    const runtimeMaxPixels = boundedInteger(options.maxPixels, DEFAULT_MAX_PIXELS, 4, 67_108_864);
    let instance = null;
    let suspended = false;
    let lastStatus = frozenStatus({ state: 'idle', message: 'No composite wallpaper is active.' });

    const publish = detail => {
        lastStatus = frozenStatus(detail);
        try { options.onStatus?.(lastStatus); } catch {}
    };
    const teardown = () => {
        try { instance?.dispose?.(); } catch (error) {
            console.warn('[CompositeAmbientDriver][destroy][error]', error);
        }
        instance = null;
    };

    return Object.freeze({
        apply(layer, config = {}) {
            const checked = normalizeCompositeConfig(config, runtimeMaxPixels);
            if (!checked.ok) {
                teardown();
                publish({ state: 'rejected', message: checked.message, code: checked.code });
                applyFallback(layer, config, checked.message);
                return false;
            }
            const dimensions = measureBackingDimensions(layer, checked.config);
            if (!dimensions.ok) {
                teardown();
                publish({
                    state: 'rejected',
                    message: dimensions.message,
                    code: dimensions.code,
                    ...identityDetail(checked.config),
                    width: dimensions.width,
                    height: dimensions.height,
                    warnings: checked.config.execution.warnings,
                });
                applyFallback(layer, checked.config, dimensions.message);
                return false;
            }
            if (checked.config.execution.executableLayerIds.length === 0) {
                teardown();
                const message = 'The composite plan has no active, reachable layer executable by runtime v2.';
                publish({
                    state: 'rejected',
                    message,
                    code: 'AMBIENT_COMPOSITE_NO_EXECUTABLE_LAYERS',
                    ...identityDetail(checked.config),
                    width: dimensions.width,
                    height: dimensions.height,
                    warnings: checked.config.execution.warnings,
                    unsupportedLayerIds: checked.config.execution.unsupportedLayerIds,
                });
                applyFallback(layer, checked.config, message);
                return false;
            }
            if (config.suspended !== undefined) suspended = config.suspended === true;
            if (!instance) {
                instance = createInstance(layer, {
                    coordinatorProvider,
                    deviceProvider,
                    formatProvider,
                    canvasFactory,
                    maxPixels: runtimeMaxPixels,
                    contextOwnership: options.contextOwnership,
                    surfaceResize: options.surfaceResize,
                    removeCanvasOnDispose: options.removeCanvasOnDispose,
                    assetResolver: options.assetResolver,
                    onStatus: publish,
                });
            }
            instance.update({ ...checked.config, suspended });
            return true;
        },
        setSuspended(value, detail = {}) {
            suspended = value === true;
            instance?.update?.({ suspended, suspensionReason: String(detail?.reason ?? '') });
        },
        setAccessibility(value = {}) {
            instance?.update?.({
                reducedMotion: value.reducedMotion === true,
                forcedColors: value.forcedColors === true,
                reduceTransparency: value.reduceTransparency === true,
            });
        },
        status() { return instance?.status?.() ?? lastStatus; },
        destroy() {
            teardown();
            publish({ state: 'idle', message: 'Composite wallpaper stopped.' });
        },
    });
}

function normalizeCompositeConfig(config, runtimeMaxPixels) {
    if (!isPlainObject(config)) return failure('AMBIENT_COMPOSITE_CONFIG_INVALID', 'Composite wallpaper config must be an object.');
    const checked = validateCompositeAmbientPlan(config.plan);
    if (!checked.ok) return checked;
    const plan = checked.plan;
    return Object.freeze({
        ok: true,
        config: Object.freeze({
            plan,
            execution: checked.execution,
            staticColor: normalizeColor(config.staticColor ?? plan.accessibility.staticFallback.color, '#07090f'),
            targetFps: boundedInteger(config.targetFps, plan.settings.targetFps, 1, 60),
            maxDpr: boundedNumber(config.maxDpr, plan.settings.maxDpr, 0.5, 4),
            maxPixels: Math.min(runtimeMaxPixels, boundedInteger(
                config.maxPixels,
                plan.settings.maxPixelCount,
                4,
                67_108_864,
            )),
            interactive: config.interactive !== false && plan.settings.interactive,
            reducedMotion: plan.settings.motionPaused === true || config.reducedMotion === true,
            forcedColors: config.forcedColors === true,
            reduceTransparency: config.reduceTransparency === true,
            suspended: config.suspended === true,
        }),
    });
}

function createInstance(layer, options) {
    const canvas = options.canvasFactory();
    canvas.className = 'os-ambient-composite-canvas';
    canvas.setAttribute?.('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    removeNonFxChildren(layer);
    layer.insertBefore(canvas, layer.querySelector?.('#os-ambient-fx') ?? null);

    let disposed = false;
    let requestedConfig = null;
    let activeConfig = null;
    let statusConfig = null;
    let lifecycle = Object.freeze({ state: 'idle', message: 'Composite runtime is idle.', code: null, diagnostic: null });
    let device = null;
    let deviceGeneration = null;
    let context = null;
    let format = null;
    let contextConfigured = false;
    let compiledLayers = [];
    let ownedResources = createOwnedResources();
    let frameHandle = null;
    let resizeObserver = null;
    let generation = 0;
    let compileController = null;
    let startTime = performance.now();
    let lastFrame = 0;
    let submittedFrames = 0;
    let lastSubmittedAt = null;
    let pointerX = -1;
    let pointerY = -1;
    let pointerBound = false;
    let renderedStatic = false;
    let compileWarnings = [];
    const ownsContext = options.contextOwnership !== 'external';
    const removeCanvasOnDispose = options.removeCanvasOnDispose !== false;

    const isDocumentHidden = () => typeof document !== 'undefined' && document.hidden === true;
    const shouldFreeze = config => !config || config.suspended || config.reducedMotion || config.forcedColors || isDocumentHidden();
    const warningsFor = config => [...(config?.execution?.warnings ?? []), ...compileWarnings];
    const publish = (state, message, detail = {}, config = requestedConfig ?? activeConfig) => {
        statusConfig = config;
        lifecycle = Object.freeze({
            state,
            message,
            code: detail.code ?? null,
            diagnostic: detail.diagnostic ?? null,
            diagnostics: detail.diagnostics ?? 0,
        });
        options.onStatus?.(snapshot(config));
    };

    const snapshot = (config = statusConfig ?? activeConfig ?? requestedConfig) => {
        const warnings = warningsFor(config);
        const receipt = submittedFrames > 0 && activeConfig ? frozenReceipt({
            plan: activeConfig.plan,
            width: canvas.width,
            height: canvas.height,
            submittedFrames,
            lastSubmittedAt,
            compiledLayerIds: compiledLayers.map(item => item.layer.id),
            unsupportedLayerIds: activeConfig.execution.unsupportedLayerIds,
            warnings: warningsFor(activeConfig),
        }) : null;
        return frozenStatus({
            ...lifecycle,
            ...identityDetail(config),
            width: canvas.width,
            height: canvas.height,
            targetFps: config?.targetFps ?? 0,
            activeReachableLayerIds: config?.execution?.activeReachableLayerIds ?? [],
            compiledLayerIds: compiledLayers.map(item => item.layer.id),
            unsupportedLayerIds: config?.execution?.unsupportedLayerIds ?? [],
            warnings,
            submittedFrames,
            lastSubmittedAt,
            ownedResources: ownedResources.counts(),
            receipt,
        });
    };

    const onPointerMove = event => { pointerX = event.clientX; pointerY = event.clientY; };
    const onPointerLeave = () => { pointerX = -1; pointerY = -1; };
    const setPointerBound = enabled => {
        if (enabled === pointerBound) return;
        pointerBound = enabled;
        const method = enabled ? 'addEventListener' : 'removeEventListener';
        document[method]?.('pointermove', onPointerMove, { passive: true });
        document[method]?.('pointerleave', onPointerLeave, { passive: true });
        if (!enabled) onPointerLeave();
    };

    const resize = config => {
        if (!ownsContext) {
            const rect = layer?.getBoundingClientRect?.();
            const cssWidth = Math.floor(Number(rect?.width));
            const cssHeight = Math.floor(Number(rect?.height));
            if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth < 2 || cssHeight < 2) {
                throw typedError('AMBIENT_COMPOSITE_DIMENSIONS_INVALID',
                    `Composite wallpaper needs at least 2×2 CSS pixels; received ${Math.max(0, cssWidth || 0)}×${Math.max(0, cssHeight || 0)}.`);
            }
            const previousWidth = canvas.width;
            const previousHeight = canvas.height;
            options.surfaceResize?.(cssWidth, cssHeight);
            if (canvas.width < 2 || canvas.height < 2) {
                throw typedError('AMBIENT_COMPOSITE_SURFACE_UNAVAILABLE',
                    `The kernel-owned composite surface is ${canvas.width}×${canvas.height}.`);
            }
            const changed = canvas.width !== previousWidth || canvas.height !== previousHeight;
            if (changed) renderedStatic = false;
            // SurfaceManager owns configuration with the native GPUDevice. A
            // guarded app facade cannot and must not be passed to configure().
            contextConfigured = true;
            return changed;
        }
        const measured = measureBackingDimensions(layer, config, Number(device?.limits?.maxTextureDimension2D ?? 8192));
        if (!measured.ok) throw typedError(measured.code, measured.message);
        const changed = canvas.width !== measured.width || canvas.height !== measured.height;
        if (changed) {
            canvas.width = measured.width;
            canvas.height = measured.height;
            renderedStatic = false;
        }
        if (changed || !contextConfigured) {
            context.configure({ device, format, alphaMode: 'premultiplied' });
            contextConfigured = true;
        }
        return changed;
    };

    const stopLoop = () => {
        frameHandle?.unregister?.();
        frameHandle = null;
        compiledLayers.forEach(item => item.pause?.());
    };

    const renderFrame = (now, config = activeConfig, layers = compiledLayers) => {
        if (disposed || !device || !context || !config || layers.length === 0) return false;
        const frozen = shouldFreeze(config);
        resize(config);
        if (frozen && renderedStatic) { stopLoop(); return false; }
        const previousFrame = lastFrame;
        const rect = layer.getBoundingClientRect?.() ?? { left: 0, top: 0, width: canvas.width, height: canvas.height };
        const pointerActive = !frozen && config.interactive && pointerX >= 0 && pointerY >= 0;
        const px = pointerActive ? (pointerX - Number(rect.left ?? 0)) / Math.max(1, Number(rect.width ?? 1)) : -1;
        const py = pointerActive ? (pointerY - Number(rect.top ?? 0)) / Math.max(1, Number(rect.height ?? 1)) : -1;
        const elapsedSeconds = frozen ? 0 : Math.max(0, (now - startTime) / 1000);
        const deltaSeconds = !frozen && previousFrame ? Math.max(0, Math.min(0.1, (now - previousFrame) / 1000)) : 0;
        lastFrame = now;
        const encoder = device.createCommandEncoder({ label: 'ambient-composite-frame' });
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: colorToClearValue(config.plan.settings.clearColor),
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        for (const item of layers) {
            if (item.update) {
                item.update(canvas.width, canvas.height, frozen, item.layer.opacity * (config.reduceTransparency ? .82 : 1));
                pass.setPipeline(item.pipeline); pass.setBindGroup(0, item.bindGroup); pass.draw(3);
                continue;
            }
            const settings = item.layer.descriptor.program.settings ?? {};
            const background = colorToClearValue(config.staticColor);
            device.queue.writeBuffer(item.uniformBuffer, 0, new Float32Array([
                canvas.width, canvas.height,
                elapsedSeconds, deltaSeconds,
                px, py, pointerActive ? 1 : 0, frozen ? 0 : boundedNumber(settings.pointerInfluence, 0.35, 0, 1),
                boundedNumber(settings.speed, 1, 0, 4),
                boundedNumber(settings.intensity, 1, 0, 2) * (config.reduceTransparency ? 0.82 : 1),
                boundedNumber(settings.exposure, 0, -4, 4),
                boundedNumber(settings.saturation, 1, 0, 3),
                background.r, background.g, background.b, 1,
            ]));
            const opacity = item.layer.opacity * (config.reduceTransparency ? 0.82 : 1);
            pass.setBlendConstant({ r: opacity, g: opacity, b: opacity, a: opacity });
            pass.setPipeline(item.pipeline);
            pass.setBindGroup(0, item.bindGroup);
            pass.draw(3);
        }
        pass.end();
        device.queue.submit([encoder.finish()]);
        submittedFrames += 1;
        lastSubmittedAt = performance.now();
        renderedStatic = frozen;
        if (frozen) stopLoop();
        return true;
    };

    const renderOneShot = (now, config = activeConfig, layers = compiledLayers) => {
        const render = () => renderFrame(now, config, layers);
        if (typeof device?.runOneShot === 'function') {
            return device.runOneShot({
                kind: 'job',
                maxOperations: layers.length + 1 + layers.filter(item => item.update).length,
                maxSubmissions: 1,
                maxBytes: layers.length * AMBIENT_PROGRAM_UNIFORM_BYTES + layers.reduce((bytes, item) => bytes + (item.uploadBytes ?? 0), 0),
                durationMs: 1_000,
            }, render);
        }
        if (device?.__isGpuFacade === true) {
            throw typedError(
                'AMBIENT_COMPOSITE_GPU_AUTHORITY_UNAVAILABLE',
                'The guarded GPU device did not provide finite first-frame authority.',
            );
        }
        return render();
    };

    const resume = () => {
        stopLoop();
        if (disposed || !activeConfig || !device || compiledLayers.length === 0 || !Number.isInteger(deviceGeneration)) return false;
        if (shouldFreeze(activeConfig)) return false;
        const coordinator = options.coordinatorProvider?.();
        if (!coordinator) throw typedError('AMBIENT_COMPOSITE_FRAME_COORDINATOR_UNAVAILABLE', 'Composite frame scheduling is unavailable.');
        frameHandle = coordinator.registerProducer({
            ownerId: 'os.kernel.ambient',
            surfaceId: 'os-ambient-composite',
            generation: deviceGeneration,
            priority: 315,
            targetFps: activeConfig.targetFps,
            visible: true,
            focused: true,
            minimized: false,
            cpuBudgetMs: 6,
            callback: ({ now }) => {
                try {
                    return { submitted: renderFrame(now) };
                } catch (error) {
                    stopLoop();
                    publish('failed', 'Composite rendering stopped; the last valid frame remains.', {
                        code: String(error?.code ?? 'AMBIENT_COMPOSITE_RENDER_FAILED'),
                        diagnostic: String(error?.message ?? error).slice(0, 512),
                    }, activeConfig);
                    console.warn('[CompositeAmbientDriver][frame][error]', error);
                    return { submitted: false };
                }
            },
        });
        return true;
    };

    const compile = async config => {
        const token = ++generation;
        compileController?.abort();
        const controller = compileController = new AbortController();
        stopLoop();
        publish('compiling', 'Compiling active composite layers.', {}, config);
        const candidateResources = createOwnedResources();
        try {
            const nextDevice = await Promise.resolve(options.deviceProvider());
            if (disposed || token !== generation) return candidateResources.releaseAll();
            if (!nextDevice?.createShaderModule || !nextDevice?.createBuffer || !nextDevice?.queue) {
                throw typedError('AMBIENT_COMPOSITE_GPU_UNAVAILABLE', 'The shared WebGPU device is unavailable.');
            }
            const coordinator = options.coordinatorProvider?.();
            const nextGeneration = coordinator?.generationForDevice?.(nextDevice);
            if (!Number.isInteger(nextGeneration)) {
                throw typedError('AMBIENT_COMPOSITE_GPU_GENERATION_STALE', 'The shared WebGPU device generation is not current.');
            }
            const nextFormat = options.formatProvider?.();
            if (typeof nextFormat !== 'string' || !nextFormat) {
                throw typedError('AMBIENT_COMPOSITE_FORMAT_UNAVAILABLE', 'The preferred WebGPU canvas format is unavailable.');
            }
            const nextContext = context ?? canvas.getContext?.('webgpu');
            if (!nextContext?.configure || !nextContext?.getCurrentTexture) {
                throw typedError('AMBIENT_COMPOSITE_SURFACE_UNAVAILABLE', 'The composite GPU surface is unavailable.');
            }
            if (device !== nextDevice) contextConfigured = false;
            device = nextDevice;
            deviceGeneration = nextGeneration;
            context = nextContext;
            format = nextFormat;
            resize(config);

            const byId = new Map(config.plan.layers.map(item => [item.id, item]));
            const candidates = [];
            const shaderWarnings = [];
            for (const layerPlan of config.plan.layers) {
                if (!config.execution.executableLayerIds.includes(layerPlan.id)) continue;
                if (layerPlan.kind === 'image' || layerPlan.kind === 'video') {
                    candidates.push(await createAmbientCompositeMedia({ device, format, layer: layerPlan, projectId: config.plan.projectId, assetResolver: options.assetResolver, signal: controller.signal, resources: candidateResources }));
                    continue;
                }
                const program = layerPlan.descriptor.program;
                const code = buildAmbientProgramSource(program.source ?? program.sourceWGSL, program.contentHash);
                let module;
                const pipeline = await withErrorScope(device, () => {
                    module = device.createShaderModule({ label: `ambient-composite-${layerPlan.id}`, code });
                    const descriptor = {
                        label: `ambient-composite-pipeline-${layerPlan.id}`,
                        layout: 'auto',
                        vertex: { module, entryPoint: 'ambientVertex' },
                        fragment: {
                            module,
                            entryPoint: 'ambientFragment',
                            targets: [{ format, blend: blendState(layerPlan.blendMode) }],
                        },
                        primitive: { topology: 'triangle-list' },
                    };
                    return device.createRenderPipelineAsync
                        ? device.createRenderPipelineAsync(descriptor)
                        : device.createRenderPipeline(descriptor);
                });
                const diagnostics = module.getCompilationInfo ? await module.getCompilationInfo() : { messages: [] };
                const errors = [...(diagnostics.messages ?? [])].filter(message => message.type === 'error');
                if (errors.length) throw typedError('AMBIENT_COMPOSITE_SHADER_INVALID', errors[0].message);
                for (const diagnostic of diagnostics.messages ?? []) {
                    if (diagnostic.type === 'error') continue;
                    shaderWarnings.push(Object.freeze({
                        code: 'AMBIENT_COMPOSITE_SHADER_DIAGNOSTIC',
                        layerId: layerPlan.id,
                        kind: 'procedural',
                        message: String(diagnostic.message ?? diagnostic.type ?? 'Shader diagnostic').slice(0, 512),
                    }));
                }
                const uniformBuffer = candidateResources.trackBuffer(device.createBuffer({
                    label: `ambient-composite-uniforms-${layerPlan.id}`,
                    size: AMBIENT_PROGRAM_UNIFORM_BYTES,
                    usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
                }));
                const bindGroup = device.createBindGroup({
                    label: `ambient-composite-bind-group-${layerPlan.id}`,
                    layout: pipeline.getBindGroupLayout(0),
                    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
                });
                candidates.push(Object.freeze({ layer: byId.get(layerPlan.id), pipeline, uniformBuffer, bindGroup }));
            }
            if (disposed || token !== generation) return candidateResources.releaseAll();
            if (candidates.length !== config.execution.executableLayerIds.length) {
                throw typedError('AMBIENT_COMPOSITE_EXECUTION_MISMATCH', 'The compiled layer set did not match the resolved plan.');
            }
            const previousLayers = compiledLayers;
            const previousResources = ownedResources;
            const previousConfig = activeConfig;
            const previousWarnings = compileWarnings;
            compiledLayers = candidates;
            ownedResources = candidateResources;
            activeConfig = config;
            compileWarnings = shaderWarnings;
            startTime = performance.now();
            lastFrame = 0;
            renderedStatic = false;
            try {
                if (!renderOneShot(performance.now(), config, candidates)) {
                    throw typedError('AMBIENT_COMPOSITE_FIRST_FRAME_FAILED', 'Composite layers compiled but no first frame was submitted.');
                }
            } catch (error) {
                compiledLayers = previousLayers;
                ownedResources = previousResources;
                activeConfig = previousConfig;
                compileWarnings = previousWarnings;
                candidateResources.releaseAll();
                throw error;
            }
            previousResources.releaseAll();
            const warnings = warningsFor(config);
            publish(
                warnings.length ? 'running-with-warnings' : 'running',
                warnings.length ? 'Composite wallpaper is running with unsupported layers omitted.' : 'Composite wallpaper is running.',
                { diagnostics: shaderWarnings.length },
                config,
            );
            resume();
        } catch (error) {
            candidateResources.releaseAll();
            if (disposed || token !== generation) return;
            publish('failed', 'Composite compilation failed; the last valid frame remains.', {
                code: String(error?.code ?? 'AMBIENT_COMPOSITE_COMPILE_FAILED'),
                diagnostic: String(error?.message ?? error).slice(0, 512),
            }, config);
            layer.style.background = config.staticColor;
            if (compiledLayers.length === 0) canvas.style.display = 'none';
            console.warn('[CompositeAmbientDriver][compile][error]', error);
        }
    };

    const onVisibility = () => {
        if (isDocumentHidden()) stopLoop();
        else {
            try {
                if (activeConfig && shouldFreeze(activeConfig)) renderOneShot(performance.now());
                resume();
            } catch (error) { console.warn('[CompositeAmbientDriver][visibility][error]', error); }
        }
    };
    document.addEventListener?.('visibilitychange', onVisibility);
    if (globalThis.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => {
            try {
                if (activeConfig) {
                    const changed = resize(activeConfig);
                    if (changed && shouldFreeze(activeConfig)) renderOneShot(performance.now());
                    resume();
                }
            } catch (error) {
                publish('failed', 'Composite surface resize failed.', {
                    code: String(error?.code ?? 'AMBIENT_COMPOSITE_DIMENSIONS_INVALID'),
                    diagnostic: String(error?.message ?? error).slice(0, 512),
                }, activeConfig);
            }
        });
        resizeObserver.observe(layer);
    } else globalThis.window?.addEventListener?.('resize', onVisibility);

    return Object.freeze({
        update(patch = {}) {
            if (disposed) return;
            const merged = { ...(requestedConfig ?? activeConfig ?? {}), ...patch };
            // Host accessibility updates cannot resume an authored Still look.
            if (merged.plan?.settings?.motionPaused === true) { merged.reducedMotion = true; merged.interactive = false; }
            const next = Object.freeze(merged);
            const planChanged = next.plan?.contentHash !== activeConfig?.plan?.contentHash;
            requestedConfig = next;
            canvas.style.display = next.forcedColors ? 'none' : 'block';
            layer.style.background = next.staticColor;
            setPointerBound(next.interactive && !next.reducedMotion && !next.forcedColors);
            if (planChanged || compiledLayers.length === 0) {
                void compile(next);
                return;
            }
            activeConfig = next;
            renderedStatic = false;
            try {
                if (!renderOneShot(performance.now())) {
                    throw typedError('AMBIENT_COMPOSITE_FRAME_UPDATE_FAILED', 'The composite update submitted no frame.');
                }
                const warnings = warningsFor(next);
                publish(warnings.length ? 'running-with-warnings' : 'running',
                    warnings.length ? 'Composite wallpaper is running with unsupported layers omitted.' : 'Composite wallpaper is running.',
                    {}, next);
                resume();
            } catch (error) {
                publish('failed', 'Composite update failed; the static fallback remains.', {
                    code: String(error?.code ?? 'AMBIENT_COMPOSITE_FRAME_UPDATE_FAILED'),
                    diagnostic: String(error?.message ?? error).slice(0, 512),
                }, next);
                console.warn('[CompositeAmbientDriver][update][error]', error);
            }
        },
        status() { return snapshot(); },
        dispose() {
            disposed = true;
            generation += 1;
            compileController?.abort();
            stopLoop();
            setPointerBound(false);
            document.removeEventListener?.('visibilitychange', onVisibility);
            resizeObserver?.disconnect?.();
            globalThis.window?.removeEventListener?.('resize', onVisibility);
            ownedResources.releaseAll();
            compiledLayers = [];
            try { if (contextConfigured && ownsContext) context?.unconfigure?.(); } catch {}
            context = null;
            contextConfigured = false;
            device = null;
            deviceGeneration = null;
            if (removeCanvasOnDispose) canvas.remove?.();
        },
    });
}

function createOwnedResources() {
    const buffers = new Set();
    const textures = new Set();
    const media = new Set();
    const browserHandles = new Set();
    let released = false;
    return Object.freeze({
        trackBuffer(value) { if (value) buffers.add(value); return value; },
        trackTexture(value) { if (value) textures.add(value); return value; },
        trackMedia(value) { if (value) media.add(value); return value; },
        trackBrowserHandle(value) { if (value) browserHandles.add(value); return value; },
        counts() {
            return Object.freeze({
                buffers: buffers.size,
                textures: textures.size,
                media: media.size,
                browserHandles: browserHandles.size,
            });
        },
        releaseAll() {
            if (released) return false;
            released = true;
            for (const value of buffers) { try { value.destroy?.(); } catch {} }
            for (const value of textures) { try { value.destroy?.(); } catch {} }
            for (const value of media) {
                try { value.pause?.(); } catch {}
                try { value.removeAttribute?.('src'); value.load?.(); } catch {}
            }
            for (const value of browserHandles) {
                try { (value.dispose ?? value.close)?.call(value); } catch {}
            }
            buffers.clear();
            textures.clear();
            media.clear();
            browserHandles.clear();
            return true;
        },
    });
}

function measureBackingDimensions(layer, config, deviceLimit = 8192) {
    const rect = layer?.getBoundingClientRect?.();
    const cssWidth = Math.floor(Number(rect?.width));
    const cssHeight = Math.floor(Number(rect?.height));
    if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth < 1 || cssHeight < 1) {
        return dimensionFailure(0, 0);
    }
    let dpr = Math.min(config.maxDpr, Math.max(0.5, Number(globalThis.devicePixelRatio) || 1));
    const requestedPixels = cssWidth * cssHeight * dpr * dpr;
    if (requestedPixels > config.maxPixels) dpr *= Math.sqrt(config.maxPixels / requestedPixels);
    const width = Math.min(deviceLimit, Math.floor(cssWidth * dpr));
    const height = Math.min(deviceLimit, Math.floor(cssHeight * dpr));
    if (width < 2 || height < 2) return dimensionFailure(width, height);
    return Object.freeze({ ok: true, width, height, dpr });
}

function dimensionFailure(width, height) {
    return Object.freeze({
        ok: false,
        code: 'AMBIENT_COMPOSITE_DIMENSIONS_INVALID',
        message: 'Composite wallpaper activation requires backing dimensions of at least 2 by 2 pixels.',
        width,
        height,
    });
}

function blendState(mode) {
    const dstFactor = mode === 'add' ? 'one' : 'one-minus-constant';
    return Object.freeze({
        color: Object.freeze({ operation: 'add', srcFactor: 'constant', dstFactor }),
        alpha: Object.freeze({ operation: 'add', srcFactor: 'constant', dstFactor }),
    });
}

function identityDetail(config) {
    return {
        projectId: config?.plan?.projectId ?? null,
        revision: config?.plan?.revision ?? null,
        planSchema: config?.plan?.schema ?? null,
        contentHash: config?.plan?.contentHash ?? null,
        runtimeId: COMPOSITE_AMBIENT_RUNTIME_ID,
        runtimeAbi: COMPOSITE_AMBIENT_RUNTIME_ABI,
        buildId: COMPOSITE_AMBIENT_BUILD_ID,
    };
}

function frozenReceipt(detail) {
    return deepFreeze({
        schema: COMPOSITE_AMBIENT_RECEIPT_SCHEMA,
        projectId: detail.plan.projectId,
        revision: detail.plan.revision,
        contentHash: detail.plan.contentHash,
        width: detail.width,
        height: detail.height,
        submittedFrames: detail.submittedFrames,
        frameCount: detail.submittedFrames,
        lastSubmittedAt: detail.lastSubmittedAt,
        runtimeId: COMPOSITE_AMBIENT_RUNTIME_ID,
        runtimeAbi: COMPOSITE_AMBIENT_RUNTIME_ABI,
        buildId: COMPOSITE_AMBIENT_BUILD_ID,
        compiledLayerIds: [...detail.compiledLayerIds],
        unsupportedLayerIds: [...detail.unsupportedLayerIds],
        warnings: cloneJson(detail.warnings),
    });
}

function frozenStatus(detail = {}) {
    return deepFreeze({
        state: String(detail.state ?? 'idle'),
        message: String(detail.message ?? '').slice(0, 512),
        code: detail.code ? String(detail.code).slice(0, 96) : null,
        diagnostic: detail.diagnostic ? String(detail.diagnostic).slice(0, 512) : null,
        projectId: detail.projectId ?? null,
        revision: detail.revision ?? null,
        planSchema: detail.planSchema ?? null,
        contentHash: detail.contentHash ?? null,
        runtimeId: detail.runtimeId ?? COMPOSITE_AMBIENT_RUNTIME_ID,
        runtimeAbi: detail.runtimeAbi ?? COMPOSITE_AMBIENT_RUNTIME_ABI,
        buildId: detail.buildId ?? COMPOSITE_AMBIENT_BUILD_ID,
        width: Number(detail.width ?? 0),
        height: Number(detail.height ?? 0),
        targetFps: Number(detail.targetFps ?? 0),
        diagnostics: Number(detail.diagnostics ?? 0),
        submittedFrames: Number(detail.submittedFrames ?? 0),
        frameCount: Number(detail.submittedFrames ?? detail.frameCount ?? 0),
        lastSubmittedAt: Number.isFinite(detail.lastSubmittedAt) ? Number(detail.lastSubmittedAt) : null,
        activeReachableLayerIds: [...(detail.activeReachableLayerIds ?? [])],
        compiledLayerIds: [...(detail.compiledLayerIds ?? [])],
        unsupportedLayerIds: [...(detail.unsupportedLayerIds ?? [])],
        warnings: cloneJson(detail.warnings ?? []),
        ownedResources: {
            buffers: Number(detail.ownedResources?.buffers ?? 0),
            textures: Number(detail.ownedResources?.textures ?? 0),
            media: Number(detail.ownedResources?.media ?? 0),
            browserHandles: Number(detail.ownedResources?.browserHandles ?? 0),
        },
        receipt: detail.receipt ? cloneJson(detail.receipt) : null,
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
    layer.style.background = normalizeColor(
        config?.staticColor ?? config?.plan?.accessibility?.staticFallback?.color,
        '#07090f',
    );
    if (layer.dataset) layer.dataset.ambientError = String(message ?? '').slice(0, 256);
}

function normalizeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? String(value).toLowerCase() : fallback;
}

function colorToClearValue(value) {
    const hex = normalizeColor(value, '#07090f').slice(1);
    return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: 1,
    };
}

function boundedInteger(value, fallback, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isSafeInteger(number) ? number : fallback));
}

function boundedNumber(value, fallback, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
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
