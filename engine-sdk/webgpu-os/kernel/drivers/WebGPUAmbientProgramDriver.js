// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Kernel-owned runtime for bounded Ambient Studio fragment programs.
 *
 * Authored code supplies only the existing PaintShader pure function. Entry
 * points, bindings, uniforms, canvas ownership, pacing, and recovery stay with
 * the OS. The driver borrows the kernel GPUDevice and never destroys it.
 */

import {
    AMBIENT_PROGRAM_PLAN_SCHEMA,
    AMBIENT_PROGRAM_UNIFORM_BYTES,
    buildAmbientProgramSource,
    validateAmbientProgramSource,
} from '../schema/AmbientProgramContract.js';
import { getDefaultGpuFrameCoordinator } from '../GpuFrameCoordinator.js';
import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';
import { ambientProgramHasVersionedWater, createAmbientProgramWaterClock, projectAmbientProgramWaterFrame } from './AmbientProgramWaterClock.js';
import { createAmbientFiniteWaterHost } from './AmbientFiniteWaterHost.js';
import { reserveAmbientWaterConstructionAfterRetirements, updateAmbientWaterResidency, retainAmbientWaterRetirement } from './AmbientRuntimeV3Residency.js';

export { validateAmbientProgramSource } from '../schema/AmbientProgramContract.js';

const DEFAULT_MAX_PIXELS = 4 * 1024 * 1024;
const DEFAULT_FPS = 30;
const BUFFER_USAGE_UNIFORM = globalThis.GPUBufferUsage?.UNIFORM ?? 0x0040;
const BUFFER_USAGE_COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;

export function createWebGPUAmbientProgramDriver(options = {}) {
    const coordinatorProvider = () => options.frameCoordinator ?? getDefaultGpuFrameCoordinator();
    const deviceProvider = typeof options.deviceProvider === 'function'
        ? options.deviceProvider
        : () => coordinatorProvider()?.currentDevice?.() ?? null;
    const maxPixels = boundedInteger(options.maxPixels, DEFAULT_MAX_PIXELS, 320 * 180, 16 * 1024 * 1024);
    let instance = null;
    let suspended = false;
    let lastStatus = frozenStatus('idle', 'No authored wallpaper is active.');

    const publish = status => {
        lastStatus = frozenStatus(status.state, status.message, status);
        try { options.onStatus?.(lastStatus); } catch {}
    };

    const teardown = () => {
        try { instance?.dispose?.(); } catch (error) {
            console.warn('[AmbientProgramDriver][destroy][error]', error);
        }
        instance = null;
    };

    return Object.freeze({
        apply(layer, config = {}) {
            const checked = validateAmbientProgramConfig(config);
            if (!checked.ok) {
                teardown();
                publish({ state: 'rejected', message: checked.message, code: checked.code });
                applyFallback(layer, config, checked.message);
                return false;
            }
            if (config.suspended !== undefined) suspended = config.suspended === true;
            if (!instance) {
                teardown();
                instance = createInstance(layer, {
                    deviceProvider,
                    coordinatorProvider,
                    maxPixels,
                    onStatus: publish,
                    targetFps: checked.config.targetFps,
                    interactionFilter:options.interactionFilter??(event=>event.target===layer||event.target?.id==='os-desktop'),
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
        status() { return frozenStatus(lastStatus.state,lastStatus.message,{...lastStatus,...instance?.telemetry?.()}); },
        destroy() {
            teardown();
            publish({ state: 'idle', message: 'Authored wallpaper stopped.' });
        },
    });
}

function validateAmbientProgramConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return failure('AMBIENT_CONFIG_INVALID', 'Wallpaper configuration must be an object.');
    }
    const plan = config.plan;
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        return failure('AMBIENT_PLAN_MISSING', 'The compiled wallpaper plan is missing.');
    }
    if (plan.schema !== AMBIENT_PROGRAM_PLAN_SCHEMA) {
        return failure('AMBIENT_PLAN_SCHEMA', 'The compiled wallpaper plan schema is unsupported.');
    }
    if (plan.version !== 1 || plan.uniformContract?.byteLength !== AMBIENT_PROGRAM_UNIFORM_BYTES) {
        return failure('AMBIENT_PLAN_ABI', 'The compiled wallpaper plan uses an unsupported runtime ABI.');
    }
    if (plan.entryPoints?.vertex !== 'ambientVertex' || plan.entryPoints?.fragment !== 'ambientFragment') {
        return failure('AMBIENT_PLAN_ENTRY_POINTS', 'The compiled wallpaper plan entry-point contract is unsupported.');
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(String(plan.contentHash ?? ''))) {
        return failure('AMBIENT_PLAN_HASH', 'The compiled wallpaper plan content hash is invalid.');
    }
    const sourceResult = validateAmbientProgramSource(plan.source ?? plan.sourceWGSL);
    if (!sourceResult.ok) return sourceResult;
    const staticColor = normalizeColor(config.staticColor ?? plan.accessibility?.staticColor, '#07090f');
    const planFallbackColor = plan.accessibility?.staticFallback?.color
        ?? plan.accessibility?.staticFallback?.backgroundColor;
    return Object.freeze({
        ok: true,
        config: Object.freeze({
            plan: Object.freeze({ ...plan, source: sourceResult.source, sourceWGSL: sourceResult.source }),
            staticColor: normalizeColor(config.staticColor ?? planFallbackColor, staticColor),
            interactive: config.interactive !== false && plan.settings?.interactive !== false
                && boundedNumber(plan.settings?.pointerInfluence, 0.35, 0, 1) > 0,
            targetFps: boundedInteger(config.targetFps ?? plan.settings?.fps ?? plan.settings?.maxFramesPerSecond, DEFAULT_FPS, 1, 60),
            maxDpr: boundedNumber(config.maxDpr ?? plan.settings?.dpr ?? (Number(plan.settings?.resolutionScale) * 2), 1.5, 1, 2),
            maxPixels: boundedInteger(config.maxPixels ?? plan.settings?.maxPixelCount, DEFAULT_MAX_PIXELS, 320 * 180, 16 * 1024 * 1024),
            speed: boundedNumber(plan.settings?.speed, 1, 0, 4),
            intensity: boundedNumber(plan.settings?.intensity, 1, 0, 2),
            exposure: boundedNumber(plan.settings?.exposure, 0, -4, 4),
            saturation: boundedNumber(plan.settings?.saturation, 1, 0, 3),
            pointerInfluence: boundedNumber(plan.settings?.pointerInfluence, 0.35, 0, 1),
            reducedMotion: config.reducedMotion === true,
            forcedColors: config.forcedColors === true,
            reduceTransparency: config.reduceTransparency === true,
            suspended: config.suspended === true,
        }),
    });
}

function createInstance(layer, options) {
    const canvas = document.createElement('canvas');
    canvas.className = 'os-ambient-program-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    removeNonFxChildren(layer);
    layer.insertBefore(canvas, layer.querySelector('#os-ambient-fx'));

    let disposed = false;
    let current = null;
    let device = null;
    let context = null;
    let format = null;
    let contextConfigured = false;
    let pipeline = null;
    let uniformBuffer = null;
    let bindGroup = null;
    let frameHandle = null;
    let deviceGeneration = null;
    let generation = 0;
    let lastFrame = 0;
    let startTime = performance.now();
    let submittedFrames = 0;
    let lastSubmittedAt = null;
    let pointerX = -1;
    let pointerY = -1;
    let pointerBound = false;
    let resizeObserver = null;
    let renderedStatic = false;
    let waterClock = null, waterClockSource = null;
    let waterHost=null,activeRecord=null,compileController=null;
    const candidates=new Set();
    const waterPointer={pressed:false,clickSerial:0,clickX:-1,clickY:-1};
    const retireRecord=record=>{
        if(!record)return;
        record.disposed=true;record.waterHost?.dispose();record.buffer?.destroy();
        if(record.reserved&&!record.retired){record.retired=true;retainAmbientWaterRetirement(record.device,record,AMBIENT_PROGRAM_UNIFORM_BYTES,
            record.device.queue.onSubmittedWorkDone?.()??Promise.resolve());}
    };

    const isDocumentHidden = () => typeof document !== 'undefined' && document.hidden === true;
    const shouldFreeze = () => !current || current.suspended || current.reducedMotion || current.forcedColors || isDocumentHidden();

    const publish = (state, message, detail = {}) => options.onStatus?.({
        state,
        message,
        projectId: current?.plan?.projectId ?? null,
        revision: current?.plan?.revision ?? null,
        contentHash: current?.plan?.contentHash ?? null,
        width: canvas.width,
        height: canvas.height,
        targetFps: current?.targetFps ?? options.targetFps,
        finiteWater:waterHost?.diagnostics()??null,
        ...detail,
    });

    const onPointerMove = event => {
        pointerX = event.clientX;
        pointerY = event.clientY;
    };
    const onPointerLeave = () => { pointerX = -1; pointerY = -1; };
    const onPointerDown=event=>{
        onPointerMove(event);
        if(!options.interactionFilter(event)||shouldFreeze())return;
        const rect=canvas.getBoundingClientRect();
        waterPointer.pressed=true;waterPointer.clickSerial=waterPointer.clickSerial>=16_777_215?1:waterPointer.clickSerial+1;
        waterPointer.clickX=(pointerX-rect.left)/Math.max(1,rect.width);waterPointer.clickY=(pointerY-rect.top)/Math.max(1,rect.height);
    };
    const onPointerUp=()=>{waterPointer.pressed=false;};
    const setPointerBound = enabled => {
        if (enabled === pointerBound) return;
        pointerBound = enabled;
        const method = enabled ? 'addEventListener' : 'removeEventListener';
        document[method]('pointermove', onPointerMove, { passive: true });
        document[method]('pointerleave', onPointerLeave, { passive: true });
        document[method]('pointerdown',onPointerDown,{passive:true});
        document[method]('pointerup',onPointerUp,{passive:true});
        document[method]('pointercancel',onPointerUp,{passive:true});
        if (!enabled) onPointerLeave();
    };

    const resize = () => {
        if (disposed || !context || !device || !current) return false;
        const rect = layer.getBoundingClientRect?.() ?? { width: innerWidth, height: innerHeight };
        const cssWidth = Math.max(1, Math.floor(rect.width || innerWidth || 1));
        const cssHeight = Math.max(1, Math.floor(rect.height || innerHeight || 1));
        const deviceLimit = Number(device.limits?.maxTextureDimension2D ?? 8192);
        let dpr = Math.min(current.maxDpr, Math.max(1, Number(globalThis.devicePixelRatio) || 1));
        const requestedPixels = cssWidth * cssHeight * dpr * dpr;
        const pixelBudget = Math.min(options.maxPixels, current.maxPixels ?? options.maxPixels);
        if (requestedPixels > pixelBudget) dpr *= Math.sqrt(pixelBudget / requestedPixels);
        const width = Math.max(1, Math.min(deviceLimit, Math.floor(cssWidth * dpr)));
        const height = Math.max(1, Math.min(deviceLimit, Math.floor(cssHeight * dpr)));
        const dimensionsChanged = canvas.width !== width || canvas.height !== height;
        if (!dimensionsChanged && contextConfigured) return false;
        if (dimensionsChanged) {
            canvas.width = width;
            canvas.height = height;
        }
        context.configure({ device, format, alphaMode: 'premultiplied' });
        contextConfigured = true;
        renderedStatic = false;
        return dimensionsChanged;
    };

    const stopLoop = () => {
        frameHandle?.unregister?.();
        frameHandle = null;
    };

    const draw = now => {
        if (disposed || !device || !pipeline || !uniformBuffer || !current) return false;
        const frozen = shouldFreeze();
        if (frozen && renderedStatic) { stopLoop(); return false; }
        const previousFrame = lastFrame;
        lastFrame = now;
        resize();
        const rect = canvas.getBoundingClientRect();
        const pointerActive = current.interactive && pointerX >= 0 && pointerY >= 0;
        const px = pointerActive ? (pointerX - rect.left) / Math.max(1, rect.width) : -1;
        const py = pointerActive ? (pointerY - rect.top) / Math.max(1, rect.height) : -1;
        const elapsedSeconds = frozen ? 0 : Math.max(0, (now - startTime) / 1000);
        const deltaSeconds = previousFrame ? Math.max(0, Math.min(0.1, (now - previousFrame) / 1000)) : 0;
        const waterFrame=waterClock?.prepare({deltaSeconds,speed:current.speed,paused:frozen,advance:true});
        const background = colorToClearValue(current.staticColor);
        const frame = projectAmbientProgramWaterFrame({
            resolutionTime:[canvas.width,canvas.height,elapsedSeconds,deltaSeconds],
            pointer:[px,py,pointerActive?1:0,current.pointerInfluence],
            tone:[current.speed,current.intensity*(current.reduceTransparency?0.82:1),current.exposure,current.saturation],
        },waterFrame,{previousTime:waterClock?.time??0,paused:frozen});
        const values = new Float32Array([
            ...frame.resolutionTime,...frame.pointer,...frame.tone,
            background.r, background.g, background.b, 1,
        ]);
        let waterToken=null;
        try {
            device.queue.writeBuffer(uniformBuffer, 0, values);
            const encoder = device.createCommandEncoder({ label: 'ambient-program-frame' });
            waterToken=waterHost?.encode(encoder,{time:frame.resolutionTime[2],delta:frame.resolutionTime[3],paused:frozen,
                width:canvas.width,height:canvas.height,pointer:{x:px,y:py,active:pointerActive&&!frozen,...waterPointer,pressed:waterPointer.pressed&&!frozen}});
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    clearValue: colorToClearValue(current.staticColor),
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            waterToken?.bind(pass);
            pass.draw(3);
            pass.end();
            device.queue.submit([encoder.finish()]);
            waterToken?.commit();
            waterFrame?.commit();
            submittedFrames += 1;
            lastSubmittedAt = performance.now();
            renderedStatic = frozen;
            if (frozen) stopLoop();
            return true;
        } catch (error) {
            waterToken?.abort();waterFrame?.abort();
            stopLoop();
            publish('failed', 'Wallpaper rendering stopped; the static fallback remains.', {
                code: 'AMBIENT_RENDER_FAILED',
                diagnostic: String(error?.message ?? error).slice(0, 512),
                submittedFrames,
                lastSubmittedAt,
            });
            layer.style.background = current.staticColor;
            console.warn('[AmbientProgramDriver][frame][error]', error);
            return false;
        }
    };

    const drawOneShot=(now,accept=()=>true)=>{
        const render=()=>accept()?draw(now):false;
        if(typeof device?.runOneShot==='function'){
            const budget=waterHost?.oneShotBudget();
            return device.runOneShot({kind:'job',maxOperations:2+Number(budget?.operations??0),maxSubmissions:1,
                maxBytes:AMBIENT_PROGRAM_UNIFORM_BYTES+Number(budget?.bytes??0),durationMs:1_000},render);
        }
        if(device?.__isGpuFacade===true)throw typedError('AMBIENT_GPU_AUTHORITY_UNAVAILABLE','The guarded GPU device did not provide finite wallpaper-frame authority.');
        return render();
    };

    const resume = () => {
        stopLoop();
        if (disposed || !device || !pipeline || !current || !Number.isInteger(deviceGeneration)) return false;
        if (shouldFreeze()) return false;
        renderedStatic = false;
        if (waterClock) lastFrame=0;
        const coordinator = options.coordinatorProvider?.();
        if (!coordinator) {
            throw typedError('AMBIENT_FRAME_COORDINATOR_UNAVAILABLE', 'Wallpaper frame scheduling is unavailable.');
        }
        frameHandle = coordinator.registerProducer({
            ownerId: 'os.kernel.ambient',
            surfaceId: 'os-ambient-program',
            generation: deviceGeneration,
            priority: 310,
            targetFps: current.targetFps,
            ...(waterClock?{cadenceMode:'phase'}:{}),
            visible: true,
            focused: true,
            minimized: false,
            cpuBudgetMs: 4,
            callback: ({ now }) => ({ submitted: draw(now) }),
        });
        return true;
    };

    const compile = async config => {
        const token = ++generation;
        const initialClickSerial=waterPointer.clickSerial;
        compileController?.abort();
        const controller=compileController=new AbortController();
        stopLoop();
        let record=null;
        publish('compiling', 'Compiling wallpaper program.');
        try {
            const nextDevice = await Promise.resolve(options.deviceProvider());
            if (disposed || token !== generation) return;
            if (!nextDevice?.createShaderModule || !globalThis.navigator?.gpu) {
                throw typedError('AMBIENT_GPU_UNAVAILABLE', 'The shared WebGPU device is unavailable.');
            }
            const coordinator = options.coordinatorProvider?.();
            const nextGeneration = coordinator?.generationForDevice?.(nextDevice);
            if (!Number.isInteger(nextGeneration)) {
                throw typedError('AMBIENT_GPU_GENERATION_STALE', 'The shared WebGPU device generation is not current.');
            }
            if (device !== nextDevice) contextConfigured = false;
            device = nextDevice;
            deviceGeneration = nextGeneration;
            context = context ?? canvas.getContext('webgpu');
            if (!context) throw typedError('AMBIENT_SURFACE_UNAVAILABLE', 'The wallpaper GPU surface is unavailable.');
            format = globalThis.navigator.gpu.getPreferredCanvasFormat();
            resize();
            const code = buildAmbientProgramSource(config.plan.source, config.plan.contentHash);
            record={device,reserved:false,disposed:false,buffer:null,waterHost:null};candidates.add(record);
            await reserveAmbientWaterConstructionAfterRetirements(device,record,AMBIENT_PROGRAM_UNIFORM_BYTES,{signal:controller.signal});
            record.reserved=true;controller.signal.throwIfAborted();
            record.buffer=device.createBuffer({label:'ambient-program-uniforms',size:AMBIENT_PROGRAM_UNIFORM_BYTES,usage:BUFFER_USAGE_UNIFORM|BUFFER_USAGE_COPY_DST});
            updateAmbientWaterResidency(device,record,AMBIENT_PROGRAM_UNIFORM_BYTES);
            record.waterHost=createAmbientFiniteWaterHost({device,sourceWGSL:config.plan.source,builtSource:code,
                frameBuffer:record.buffer,frameFlavor:'program',signal:controller.signal,initialClickSerial});
            if(record.waterHost)await record.waterHost.ready;
            let module;
            const candidate = await withErrorScope(device, () => {
                module = device.createShaderModule({ label: 'ambient-studio-program', code:record.waterHost?.shaderSource??code });
                const descriptor = {
                    label: 'ambient-studio-pipeline',
                    layout: record.waterHost?.pipelineLayout??'auto',
                    vertex: { module, entryPoint: 'ambientVertex' },
                    fragment: { module, entryPoint: 'ambientFragment', targets: [{ format }] },
                    primitive: { topology: 'triangle-list' },
                };
                return device.createRenderPipelineAsync
                    ? device.createRenderPipelineAsync(descriptor)
                    : device.createRenderPipeline(descriptor);
            });
            const diagnostics = module.getCompilationInfo ? await module.getCompilationInfo() : { messages: [] };
            const errors = [...(diagnostics.messages ?? [])].filter(message => message.type === 'error');
            if (errors.length) throw typedError('AMBIENT_SHADER_INVALID', errors[0].message);
            if (disposed || token !== generation) return;
            const previous={pipeline,uniformBuffer,bindGroup,waterHost,waterClock,waterClockSource,activeRecord};
            record.previous=previous;record.pipeline=candidate;
            pipeline = candidate;
            uniformBuffer = record.buffer;
            waterHost=record.waterHost;
            bindGroup = device.createBindGroup({
                label: 'ambient-program-bind-group',
                layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
            });
            waterClock=ambientProgramHasVersionedWater(config.plan.source)?createAmbientProgramWaterClock({time:waterClockSource===config.plan.source?waterClock?.time??0:0}):null;
            waterClockSource=waterClock?config.plan.source:null;
            startTime = performance.now();
            lastFrame = 0;
            if (!await drawOneShot(performance.now(),()=>!disposed&&token===generation&&pipeline===candidate)) {
                if(token===generation)({pipeline,uniformBuffer,bindGroup,waterHost,waterClock,waterClockSource,activeRecord}=previous);
                throw typedError('AMBIENT_FIRST_FRAME_FAILED', 'The wallpaper program compiled but its first frame was not submitted.');
            }
            if(disposed||token!==generation)return;
            activeRecord=record;candidates.delete(record);record=null;retireRecord(previous.activeRecord);
            publish('running', 'Wallpaper program is running.', {
                diagnostics: diagnostics.messages?.length ?? 0,
                submittedFrames,
                lastSubmittedAt,
            });
            resume();
        } catch (error) {
            if (disposed || token !== generation) return;
            if(record?.previous&&pipeline===record.pipeline)({pipeline,uniformBuffer,bindGroup,waterHost,waterClock,waterClockSource,activeRecord}=record.previous);
            publish('failed', 'Wallpaper compilation failed; the last valid frame remains.', {
                code: String(error?.code ?? 'AMBIENT_COMPILE_FAILED'),
                diagnostic: String(error?.message ?? error).slice(0, 512),
            });
            layer.style.background = config.staticColor;
            if (!pipeline) canvas.style.display = 'none';
            console.warn('[AmbientProgramDriver][compile][error]', error);
        } finally {
            if(record){candidates.delete(record);retireRecord(record);}
        }
    };

    const onVisibility = () => {
        if (waterClock) lastFrame=0;
        if (isDocumentHidden()) stopLoop();
        else resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (globalThis.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => { resize(); resume(); });
        resizeObserver.observe(layer);
    } else window.addEventListener('resize', resume);

    return Object.freeze({
        telemetry(){return {submittedFrames,lastSubmittedAt,finiteWater:waterHost?.diagnostics()??null};},
        update(patch = {}) {
            if (disposed) return;
            const previousSource = current?.plan?.source;
            current = Object.freeze({ ...(current ?? {}), ...patch });
            canvas.style.display = current.forcedColors ? 'none' : 'block';
            layer.style.background = current.staticColor;
            setPointerBound(current.interactive && !current.reducedMotion && !current.forcedColors);
            if (current.plan?.source !== previousSource || !pipeline) {
                void compile(current);
            } else {
                try {
                    if (waterClock && (shouldFreeze() || patch.suspended!==undefined || patch.reducedMotion!==undefined || patch.forcedColors!==undefined)) {lastFrame=0;renderedStatic=false;}
                    const updateGeneration=generation,updateConfig=current;
                    const complete=submitted=>{
                        if(disposed||updateGeneration!==generation||current!==updateConfig)return;
                        if(!submitted)throw typedError('AMBIENT_FRAME_UPDATE_FAILED','The updated wallpaper frame was not submitted.');
                        publish('running','Wallpaper program is running.',{submittedFrames,lastSubmittedAt});resume();
                    };
                    const result=drawOneShot(performance.now(),()=>!disposed&&generation===updateGeneration&&current===updateConfig);
                    if(result?.then)void result.then(complete).catch(error=>{
                        if(disposed||updateGeneration!==generation||current!==updateConfig)return;
                        publish('failed','Wallpaper update failed; the static fallback remains.',{code:String(error?.code??'AMBIENT_FRAME_UPDATE_FAILED'),
                            diagnostic:String(error?.message??error).slice(0,512),submittedFrames,lastSubmittedAt});
                        console.warn('[AmbientProgramDriver][update][error]',error);
                    });else complete(result);
                } catch (error) {
                    publish('failed', 'Wallpaper update failed; the static fallback remains.', {
                        code: String(error?.code ?? 'AMBIENT_FRAME_UPDATE_FAILED'),
                        diagnostic: String(error?.message ?? error).slice(0, 512),
                        submittedFrames,
                        lastSubmittedAt,
                    });
                    layer.style.background = current.staticColor;
                    console.warn('[AmbientProgramDriver][update][error]', error);
                }
            }
        },
        dispose() {
            disposed = true;
            generation += 1;
            compileController?.abort();
            retireRecord(activeRecord);for(const record of candidates)retireRecord(record);
            stopLoop();
            setPointerBound(false);
            document.removeEventListener('visibilitychange', onVisibility);
            resizeObserver?.disconnect?.();
            window.removeEventListener('resize', resume);
            uniformBuffer = null;
            bindGroup = null;
            pipeline = null;
            context?.unconfigure?.();
            context = null;
            contextConfigured = false;
            device = null;
            deviceGeneration = null;
            canvas.remove();
        },
    });
}

function removeNonFxChildren(layer) {
    for (const child of [...layer.children]) {
        if (child.id !== 'os-ambient-fx') child.remove();
    }
}

function applyFallback(layer, config, message) {
    removeNonFxChildren(layer);
    layer.style.background = normalizeColor(config?.staticColor ?? config?.plan?.accessibility?.staticColor, '#07090f');
    layer.dataset.ambientError = String(message ?? '').slice(0, 256);
}

function normalizeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? String(value) : fallback;
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
    return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.round(number) : fallback));
}

function boundedNumber(value, fallback, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function failure(code, message) {
    return Object.freeze({ ok: false, code, message });
}

function typedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function frozenStatus(state, message, detail = {}) {
    return Object.freeze({
        state: String(state ?? 'idle'),
        message: String(message ?? '').slice(0, 512),
        code: detail.code ? String(detail.code).slice(0, 96) : null,
        diagnostic: detail.diagnostic ? String(detail.diagnostic).slice(0, 512) : null,
        projectId: detail.projectId ?? null,
        revision: detail.revision ?? null,
        contentHash: detail.contentHash ?? null,
        width: Number(detail.width ?? 0),
        height: Number(detail.height ?? 0),
        targetFps: Number(detail.targetFps ?? 0),
        diagnostics: Number(detail.diagnostics ?? 0),
        submittedFrames: Number(detail.submittedFrames ?? 0),
        lastSubmittedAt: Number.isFinite(detail.lastSubmittedAt) ? Number(detail.lastSubmittedAt) : null,
        finiteWater:detail.finiteWater??null,
    });
}
