// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    LEGACY_PCG32_WGSL,
    LEGACY_STANDALONE_RUNTIME_PCG_WGSL,
} from '../../../core/math/MathBits.js';
import { runtimeFrameDeltaSeconds } from '../../../core/math/FrameMath.js';
import { uniformDistribution, mulberry32 } from '../../../core/math/MathRandom.js';
import {
    LIVE_3D_WORLD_GRID,
    LIVE_3D_WORLD_SUBSTANCES,
} from './Live3DWorldModel.js';
import { createAuthoredParticleInitialData, normalizeParticleAuthoring, normalizeParticlePointerResponse, particleAuthoringCount, isDefaultParticleAuthoring, PARTICLE_POINTER_MODES } from './Live3DWorldAuthoring.js';

/**
 * Engine-owned runtime for the Live 3D World ambient particle simulation.
 *
 * GPU/device/frame ownership is injected. The OS desktop driver and an app
 * preview can therefore execute this exact implementation on separate mediated
 * surfaces without either importing or duplicating the other's ownership code.
 */

const GRID_W = LIVE_3D_WORLD_GRID.width;
const GRID_H = LIVE_3D_WORLD_GRID.height;
const MAX_RECTS = LIVE_3D_WORLD_GRID.maxInteractionRects;

// Substance property tables (mirror the WGSL functions below)
const SUB_TEMP = LIVE_3D_WORLD_SUBSTANCES.map(value => value.baseTemperature);
const SUB_DENSITY = LIVE_3D_WORLD_SUBSTANCES.map(value => value.density);
const SUB_V0 = LIVE_3D_WORLD_SUBSTANCES.map(value => value.initialSpeed);
const BUFFER_USAGE_STORAGE = globalThis.GPUBufferUsage?.STORAGE ?? 0x0080;
const BUFFER_USAGE_UNIFORM = globalThis.GPUBufferUsage?.UNIFORM ?? 0x0040;
const BUFFER_USAGE_COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
const BUFFER_USAGE_VERTEX = globalThis.GPUBufferUsage?.VERTEX ?? 0x0020;
const COMPUTE_WORKGROUP_SIZE = 128;

function hexToRGBA(hex, fallback = { r: 0.027, g: 0.035, b: 0.063, a: 1 }) {
    if (typeof hex !== 'string') return fallback;
    const m = hex.replace('#', '');
    if (m.length !== 6) return fallback;
    const n = parseInt(m, 16);
    if (Number.isNaN(n)) return fallback;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

/**
 * Boot the WebGPU simulation on a supplied canvas. Returns a handle with
 * dispose() that unregisters its coordinated frame producer, removes listeners,
 * releases its resources, and optionally removes the canvas. The physical GPU
 * device is always borrowed from the caller.
 */
export function createParticleAmbientRuntime(options = {}) {
    const canvas = options.canvas;
    const layer = options.layer ?? canvas?.parentElement ?? canvas;
    const initialPlan = options.plan;
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('Particle ambient runtime requires a canvas');
    if (!layer) throw new TypeError('Particle ambient runtime requires a surface layer');
    if (!initialPlan?.settings) throw new TypeError('Particle ambient runtime requires a validated plan');
    const N = Math.max(256, Math.floor(initialPlan.settings.particleCount));
    let currentPlan = initialPlan;
    let interactive = initialPlan.settings.interactive !== false;
    let clearColor = hexToRGBA(initialPlan.settings.clearColor);
    let suspended = options.suspended === true;
    let reducedMotion = options.reducedMotion === true;
    let forcedColors = options.forcedColors === true;
    let targetFps = initialPlan.settings.targetFps;
    // SurfaceManager-configured app previews lend this runtime their canvas
    // context. Only the context owner may configure or unconfigure it; the
    // desktop driver keeps the historical owned-context default.
    const ownsContext = options.contextOwnership !== 'external';
    const surfaceResize = typeof options.surfaceResize === 'function' ? options.surfaceResize : null;
    if (!ownsContext && !surfaceResize) {
        throw new TypeError('External particle ambient surfaces require a kernel-owned surfaceResize callback');
    }

    let disposed   = false;
    let frameHandle = null;
    let device     = null;
    let deviceGeneration = null;
    let mouseX     = -1;
    let mouseY     = -1;
    let pointerU = -1, pointerV = -1, pointerSince = null, dwellU = -1, dwellV = -1;
    let pointerPressed = false, clickU = -1, clickV = -1, clickAt = null;
    const inputNow = () => Number(options.inputTimeProvider?.() ?? performance.now());
    const gesturesAllowed = () => interactive && !suspended && !reducedMotion && !forcedColors;
    const clearPointer = () => {
        mouseX = mouseY = pointerU = pointerV = dwellU = dwellV = clickU = clickV = -1;
        pointerSince = clickAt = null; pointerPressed = false;
    };
    let listening  = false;
    let resumeFrame = () => {};
    let renderFrozenFrame = () => false;
    let releaseResources = () => {};
    let restartTimer = 0;
    let startToken = 0;
    let submittedFrames = 0;
    let lastSubmittedAt = null;
    let resizeObserver = null;
    let lastStatus = frozenStatus('starting', 'Preparing Live 3D World particles.', {
        plan: currentPlan,
        count: N,
        suspended,
        reducedMotion,
        forcedColors,
        interactive,
    });
    const pointerTarget = options.pointerTarget ?? globalThis.document ?? null;
    const resizeTarget = options.resizeTarget ?? globalThis.window ?? null;

    const frameCoordinator = () => options.frameCoordinator ?? null;
    const publish = (state, message, detail = {}, notify = true) => {
        lastStatus = frozenStatus(state, message, {
            plan: currentPlan,
            count: N,
            width: canvas.width,
            height: canvas.height,
            submittedFrames,
            lastSubmittedAt,
            deviceGeneration,
            suspended,
            reducedMotion,
            forcedColors,
            interactive,
            ...detail,
        });
        if (notify) {
            try { options.onStatus?.(lastStatus); } catch {}
        }
        return lastStatus;
    };
    const stopFrame = () => {
        frameHandle?.unregister?.();
        frameHandle = null;
    };
    const scheduleRestart = delay => {
        if (disposed || restartTimer) return;
        restartTimer = setTimeout(() => {
            restartTimer = 0;
            void start();
        }, delay);
    };

    // ── Listeners (registered once, removed on dispose) ──────────────────────
    const resize = () => {
        if (disposed || !device) return;
        const size = measureParticleAmbientSurface(layer, canvas, {
            ...currentPlan.settings,
            maxTextureDimension2D: device.limits?.maxTextureDimension2D,
        }, options.surfaceSizeProvider);
        try {
            // Reassigning an owned canvas width/height, even to the same value,
            // clears its presented texture. Preserve an unchanged frozen frame.
            if (ownsContext && canvas.width === size.width && canvas.height === size.height) return;
            const previousWidth = canvas.width, previousHeight = canvas.height;
            applySurfaceSize(size);
            if ((suspended || reducedMotion || forcedColors)
                && (canvas.width !== previousWidth || canvas.height !== previousHeight)) renderFrozenFrame();
        } catch (error) {
            stopFrame();
            publish('recovering', 'Live 3D World surface resize failed; rebuilding.', {
                error: error?.message ?? String(error),
                retryInMilliseconds: 900,
            });
            scheduleRestart(900);
        }
    };
    const onResize = () => resize();
    const onMouseMove = (event) => {
        if (!gesturesAllowed()) { clearPointer(); return false; }
        // Authored gestures obey the host's blank-desktop/preview admission.
        // Older documents retain their original unfiltered hover behavior.
        if (currentPlan.authoring?.field.response && typeof options.interactionFilter === 'function') {
            let admitted = false;
            try { admitted = options.interactionFilter(event) !== false; } catch {}
            if (!admitted) { onMouseLeave(); return false; }
        }
        const rect = layer.getBoundingClientRect?.() ?? { left: 0, top: 0, width: canvas.clientWidth, height: canvas.clientHeight };
        const x = Number(event.clientX) - Number(rect.left || 0);
        const y = Number(event.clientY) - Number(rect.top || 0);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > Number(rect.width || canvas.clientWidth) || y > Number(rect.height || canvas.clientHeight)) {
            onMouseLeave(); return false;
        }
        mouseX = x;
        mouseY = y;
        const width = Math.max(1, Number(rect.width || canvas.clientWidth)), height = Math.max(1, Number(rect.height || canvas.clientHeight));
        pointerU = x / width; pointerV = y / height;
        const travel = (currentPlan.authoring?.field.response?.radius ?? .16) * Math.min(width, height) * .15;
        if (pointerSince === null || Math.hypot((pointerU - dwellU) * width, (pointerV - dwellV) * height) > travel) {
            pointerSince = inputNow(); dwellU = pointerU; dwellV = pointerV;
        }
        return true;
    };
    const onMouseLeave = () => { mouseX = mouseY = pointerU = pointerV = -1; pointerSince = null; pointerPressed = false; };
    const onPointerDown = event => {
        if (!currentPlan.authoring?.field.response || !gesturesAllowed() || event.button !== undefined && event.button !== 0) return;
        if (!onMouseMove(event)) { pointerPressed = false; return; }
        pointerPressed = true; clickU = pointerU; clickV = pointerV; clickAt = inputNow();
        try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch {}
    };
    const onPointerUp = () => { pointerPressed = false; };
    const onPointerCancel = () => clearPointer();

    const setListening = (on) => {
        if (on === listening) return;
        if (on) {
            pointerTarget?.addEventListener?.('mousemove', onMouseMove, { passive: true });
            pointerTarget?.addEventListener?.('mouseleave', onMouseLeave, { passive: true });
            pointerTarget?.addEventListener?.('pointermove', onMouseMove, { passive: true });
            pointerTarget?.addEventListener?.('pointerdown', onPointerDown, { passive: true });
            pointerTarget?.addEventListener?.('pointerup', onPointerUp, { passive: true });
            pointerTarget?.addEventListener?.('pointercancel', onPointerCancel, { passive: true });
        } else {
            pointerTarget?.removeEventListener?.('mousemove', onMouseMove);
            pointerTarget?.removeEventListener?.('mouseleave', onMouseLeave);
            pointerTarget?.removeEventListener?.('pointermove', onMouseMove);
            pointerTarget?.removeEventListener?.('pointerdown', onPointerDown);
            pointerTarget?.removeEventListener?.('pointerup', onPointerUp);
            pointerTarget?.removeEventListener?.('pointercancel', onPointerCancel);
            clearPointer();
        }
        listening = on;
    };

    let _configure = () => {};
    const applySurfaceSize = size => {
        if (ownsContext) {
            canvas.width = size.width;
            canvas.height = size.height;
            _configure();
            return;
        }
        // Public SurfaceManager.resize() accepts host CSS dimensions and owns
        // pixel-ratio, quota, and device-limit projection for the backing store.
        surfaceResize(size.cssWidth, size.cssHeight);
    };

    async function start() {
        if (disposed) return;
        const token = ++startToken;
        stopFrame();
        renderFrozenFrame = () => false;
        try { releaseResources(); } catch {}
        releaseResources = () => {};
        try {
            const coordinator = frameCoordinator();
            const nextDevice = await Promise.resolve(
                options.deviceProvider?.() ?? coordinator?.currentDevice?.() ?? null,
            );
            if (disposed || token !== startToken) return;
            if (!coordinator || !nextDevice) {
                publish('waiting', 'Waiting for the shared GPU device.', { retryInMilliseconds: 900 });
                scheduleRestart(900);
                return;
            }
            const nextGeneration = coordinator.generationForDevice?.(nextDevice);
            if (!Number.isInteger(nextGeneration)) {
                publish('waiting', 'Waiting for current GPU generation authority.', { retryInMilliseconds: 900 });
                scheduleRestart(900);
                return;
            }
            device = nextDevice;
            deviceGeneration = nextGeneration;

            const watchedDevice = device;
            watchedDevice.lost?.then((info) => {
                if (disposed || device !== watchedDevice || info?.reason === 'destroyed') return;
                stopFrame();
                try { releaseResources(); } catch {}
                releaseResources = () => {};
                device = null;
                deviceGeneration = null;
                publish('recovering', 'The GPU device was lost; rebuilding Live 3D World.', { reason: info?.reason ?? 'unknown' });
                scheduleRestart(900);
            }).catch?.(() => {});

            const ctx = canvas.getContext('webgpu');
            const fmt = options.formatProvider?.()
                ?? globalThis.navigator?.gpu?.getPreferredCanvasFormat?.()
                ?? 'bgra8unorm';

            _configure = () => {
                if (ownsContext) ctx.configure({ device, format: fmt, alphaMode: 'premultiplied' });
            };
            const size = measureParticleAmbientSurface(layer, canvas, {
                ...currentPlan.settings,
                maxTextureDimension2D: device.limits?.maxTextureDimension2D,
            }, options.surfaceSizeProvider);
            applySurfaceSize(size);
            resizeTarget?.addEventListener?.('resize', onResize);
            const ResizeObserverClass = options.resizeObserverFactory === false
                ? null
                : options.resizeObserverFactory ?? globalThis.ResizeObserver;
            if (typeof ResizeObserverClass === 'function' && !resizeObserver) {
                resizeObserver = new ResizeObserverClass(onResize);
                resizeObserver.observe(layer);
            }
            setListening(interactive);

            // ── Initial particle data ────────────────────────────────────────
            const authored = currentPlan.authoring ? normalizeParticleAuthoring(currentPlan.authoring) : null;
            const authoredSources = buildAuthoredParticleSources(currentPlan);
            if (authored?.field.response) console.debug('[ParticleAmbientRuntime][response]', { projectId: currentPlan.projectId, enabled: authored.field.response.enabled && authored.field.enabled, hover: authored.field.response.hoverMode, press: authored.field.response.pressMode, dwell: authored.field.response.dwellMode, click: authored.field.response.clickMode });
            const liveCount = authored ? particleAuthoringCount(authored) : N;
            const initData = authored && !authoredSources.usesLegacy ? createAuthoredParticleInitialData(authored, canvas.width, canvas.height, N) : new Float32Array(N * 8);
            const initialRandom = mulberry32(7314);
            for (let i = 0; i < (authoredSources.usesLegacy ? N : 0); i++) {
                const b = i * 8;
                const sub = i % 7;
                const v0 = SUB_V0[sub];
                const dens = SUB_DENSITY[sub];
                // Start in a settled density-biased volume, not two saturated
                // emitter lines. Reopening a recipe retains the same distribution.
                initData[b]     = uniformDistribution(0.02, 0.98, initialRandom) * canvas.width;
                initData[b + 1] = uniformDistribution(dens > 500 ? 0.06 : 0.32, dens > 500 ? 0.68 : 0.94, initialRandom) * canvas.height;
                initData[b + 2] = uniformDistribution(0.15, 1, initialRandom);
                initData[b + 3] = sub;
                initData[b + 4] = uniformDistribution(-v0 * 0.5, v0 * 0.5, initialRandom);
                initData[b + 5] = uniformDistribution(-v0 * 0.5, v0 * 0.5, initialRandom);
                initData[b + 6] = SUB_TEMP[sub];
                initData[b + 7] = dens;
            }

            const pBuf    = device.createBuffer({
                size: N * 32,
                usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST | BUFFER_USAGE_VERTEX,
            });
            const uploadInitialParticles = scopedDevice => scopedDevice.queue.writeBuffer(pBuf, 0, initData);
            if (typeof device.runOneShot === 'function') {
                device.runOneShot({
                    kind: 'transfer',
                    maxOperations: 1,
                    maxSubmissions: 0,
                    maxBytes: initData.byteLength,
                    durationMs: 1_000,
                }, uploadInitialParticles);
            } else if (device.__isGpuFacade === true) {
                const authorityError = new Error('The guarded GPU device did not provide finite particle-upload authority');
                authorityError.code = 'AMBIENT_PARTICLE_GPU_AUTHORITY_UNAVAILABLE';
                throw authorityError;
            } else uploadInitialParticles(device);
            const response = authored?.field.response;
            const uBuf    = device.createBuffer({ size: response ? 80 : 48, usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST });
            const rectBuf = device.createBuffer({ size: MAX_RECTS * 16, usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST });
            const vuBuf   = device.createBuffer({ size: 16, usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST });
            const gridBuf = device.createBuffer({ size: GRID_W * GRID_H * 4, usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST });
            releaseResources = () => {
                for (const buffer of [pBuf, uBuf, rectBuf, vuBuf, gridBuf]) {
                    try { buffer.destroy?.(); } catch {}
                }
            };

            let csGridPL;
            let csPhysPL;
            let csGridBG;
            let csPhysBG;
            let csResizePL;
            let csResizeBG;
            let rsPL;
            let rsBG;
            const validationScopesAvailable = typeof device.pushErrorScope === 'function'
                && typeof device.popErrorScope === 'function';
            let validationScopeOpen = false;
            try {
                if (validationScopesAvailable) {
                    device.pushErrorScope('validation');
                    validationScopeOpen = true;
                }

                const csMod = device.createShaderModule({ code: authoredSources.compute });
                csGridPL = device.createComputePipeline({ layout: 'auto', compute: { module: csMod, entryPoint: 'cs_grid' } });
                csPhysPL = device.createComputePipeline({ layout: 'auto', compute: { module: csMod, entryPoint: 'cs_physics' } });
                csResizePL = device.createComputePipeline({ layout: 'auto', compute: { module: csMod, entryPoint: 'cs_resize' } });
                csResizeBG = device.createBindGroup({ layout: csResizePL.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: { buffer: pBuf } },
                    { binding: 1, resource: { buffer: uBuf } },
                ] });

                csGridBG = device.createBindGroup({ layout: csGridPL.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: { buffer: pBuf } },
                    { binding: 1, resource: { buffer: uBuf } },
                    { binding: 2, resource: { buffer: rectBuf } },
                    { binding: 3, resource: { buffer: gridBuf } },
                ] });
                csPhysBG = device.createBindGroup({ layout: csPhysPL.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: { buffer: pBuf } },
                    { binding: 1, resource: { buffer: uBuf } },
                    { binding: 2, resource: { buffer: rectBuf } },
                    { binding: 3, resource: { buffer: gridBuf } },
                ] });

                const rsMod = device.createShaderModule({ code: authoredSources.render });
                rsPL = device.createRenderPipeline({
                    layout: 'auto',
                    vertex: {
                        module: rsMod,
                        entryPoint: 'vs',
                        buffers: [{
                            arrayStride: 32,
                            stepMode: 'instance',
                            attributes: [
                                { shaderLocation: 0, offset: 0, format: 'float32x4' },
                                { shaderLocation: 1, offset: 16, format: 'float32x4' },
                            ],
                        }],
                    },
                    fragment: { module: rsMod, entryPoint: 'fs', targets: [{
                        format: fmt,
                        blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                        },
                    }] },
                    primitive: { topology: 'triangle-list' },
                });
                rsBG = device.createBindGroup({ layout: rsPL.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: { buffer: vuBuf } },
                ] });

                if (validationScopeOpen) {
                    const validationResult = device.popErrorScope();
                    validationScopeOpen = false;
                    const validationError = await validationResult;
                    if (validationError) {
                        throw new Error(`Live 3D World GPU validation failed: ${validationError.message ?? String(validationError)}`);
                    }
                }
            } catch (error) {
                if (validationScopeOpen) {
                    validationScopeOpen = false;
                    try { await device.popErrorScope(); } catch {}
                }
                throw error;
            }
            if (disposed || token !== startToken) return;

            const zeroGrid = new Uint32Array(GRID_W * GRID_H);
            let last = 0;
            let stateWidth = canvas.width, stateHeight = canvas.height;

            const frame = (now, staticFrame = false) => {
                if (disposed || !device) return false;
                if ((suspended || reducedMotion || forcedColors) && !staticFrame) return false;
                try {
                    const dt = staticFrame ? 0 : runtimeFrameDeltaSeconds(now, last, 0.05);
                    if (!staticFrame) last = now;
                    const displayTime = staticFrame ? last : now;
                    const w = canvas.width, h = canvas.height;
                    const rect = layer.getBoundingClientRect?.() ?? { width: canvas.clientWidth, height: canvas.clientHeight };
                    const scaleX = w / Math.max(1, Number(rect.width || canvas.clientWidth || w));
                    const scaleY = h / Math.max(1, Number(rect.height || canvas.clientHeight || h));

                    const uni = new Float32Array(response ? 20 : 12);
                    uni[0] = dt; uni[1] = displayTime / 1000;
                    uni[4] = w;  uni[5] = h;
                    uni[6] = !staticFrame && mouseX >= 0 ? mouseX * scaleX : -1;
                    uni[7] = !staticFrame && mouseY >= 0 ? mouseY * scaleY : -1;
                    uni[8] = w / stateWidth; uni[9] = h / stateHeight;
                    if (response) {
                        const enabled = !staticFrame && gesturesAllowed() && authored.field.enabled && response.enabled;
                        const active = enabled && pointerU >= 0 && pointerV >= 0;
                        const pointer = particlePointerToSimulation([pointerU, pointerV], authored.camera, w, h);
                        const click = particlePointerToSimulation([clickU, clickV], authored.camera, w, h);
                        uni[6] = active ? pointer[0] : -1; uni[7] = active ? pointer[1] : -1;
                        uni[12] = active && pointerPressed ? 1 : 0;
                        uni[13] = active && pointerSince !== null ? Math.max(0, (now - pointerSince) / 1000) : 0;
                        uni[14] = enabled && clickAt !== null ? Math.max(0, (now - clickAt) / 1000) : -1;
                        uni[15] = active ? 1 : 0;
                        uni[16] = enabled && clickAt !== null ? click[0] : -1;
                        uni[17] = enabled && clickAt !== null ? click[1] : -1;
                    }
                    new Uint32Array(uni.buffer)[2] = liveCount;
                    new Uint32Array(uni.buffer)[3] = 0; // no text rects in OS mode
                    device.queue.writeBuffer(uBuf, 0, uni);
                    if (!staticFrame) device.queue.writeBuffer(gridBuf, 0, zeroGrid);
                    const emissionBudget = Math.max(0.025, Math.min(0.85, (w * h) / (N * 80)));
                    device.queue.writeBuffer(vuBuf, 0, new Float32Array([w, h, displayTime / 1000, emissionBudget]));

                    const cmd = device.createCommandEncoder();
                    if (!staticFrame || w !== stateWidth || h !== stateHeight) {
                        const cp = cmd.beginComputePass();
                        // Transform existing positions for a resized surface.
                        // Frozen resize never advances the physical simulation.
                        if (w !== stateWidth || h !== stateHeight) {
                            cp.setPipeline(csResizePL); cp.setBindGroup(0, csResizeBG);
                            if (liveCount) cp.dispatchWorkgroups(Math.ceil(liveCount / COMPUTE_WORKGROUP_SIZE));
                        }
                        if (!staticFrame) {
                            cp.setPipeline(csGridPL); cp.setBindGroup(0, csGridBG);
                            if (liveCount && (!authored || authored.field.enabled)) cp.dispatchWorkgroups(Math.ceil(liveCount / COMPUTE_WORKGROUP_SIZE));
                            cp.setPipeline(csPhysPL); cp.setBindGroup(0, csPhysBG);
                            if (liveCount && (!authored || authored.solver.enabled)) cp.dispatchWorkgroups(Math.ceil(liveCount / COMPUTE_WORKGROUP_SIZE));
                        }
                        cp.end();
                    }

                    const rp = cmd.beginRenderPass({ colorAttachments: [{
                        view: ctx.getCurrentTexture().createView(),
                        clearValue: forcedColors ? hexToRGBA(currentPlan.accessibility?.staticFallback?.color, clearColor) : clearColor,
                        loadOp: 'clear', storeOp: 'store',
                    }] });
                    rp.setPipeline(rsPL); rp.setBindGroup(0, rsBG);
                    rp.setVertexBuffer(0, pBuf);
                    rp.draw(6, forcedColors || authored && !authored.renderer.enabled ? 0 : liveCount); rp.end();

                    device.queue.submit([cmd.finish()]);
                    stateWidth = w; stateHeight = h;
                    submittedFrames += 1;
                    lastSubmittedAt = Number(now);
                    const isFirstFrame = submittedFrames === 1;
                    publish(
                        staticFrame ? 'paused' : 'ready',
                        staticFrame ? 'Live 3D World submitted a frozen frame.' : isFirstFrame ? 'Live 3D World submitted its first frame.' : 'Live 3D World is running.',
                        { deviceGeneration },
                        isFirstFrame,
                    );
                    return true;
                } catch (error) {
                    stopFrame();
                    publish('recovering', 'Live 3D World frame submission failed; rebuilding.', {
                        error: error?.message ?? String(error),
                        retryInMilliseconds: 900,
                    });
                    scheduleRestart(900);
                    return false;
                }
            };
            renderFrozenFrame = () => {
                if (disposed || !device || token !== startToken || !(suspended || reducedMotion || forcedColors)) return false;
                const render = () => frame(performance.now(), true);
                // Two uniform uploads plus one submission; frozen renders never
                // step physics, admit input, or register a continuous producer.
                if (typeof device.runOneShot === 'function') return device.runOneShot({
                    kind: 'job', maxOperations: 3, maxSubmissions: 1,
                    maxBytes: (response ? 80 : 48) + 16, durationMs: 1_000,
                }, render);
                if (device.__isGpuFacade === true) throw new Error('Finite frozen particle-frame authority is unavailable.');
                return render();
            };
            resumeFrame = () => {
                if (disposed || !device || suspended || reducedMotion || forcedColors || frameHandle) return;
                const coordinator = frameCoordinator();
                if (!coordinator || !Number.isInteger(deviceGeneration)) return;
                frameHandle = coordinator.registerProducer({
                    ownerId: options.ownerId ?? 'os.kernel.ambient',
                    surfaceId: options.surfaceId ?? 'os-ambient-particles',
                    generation: deviceGeneration,
                    priority: 300,
                    targetFps,
                    visible: true,
                    focused: true,
                    minimized: false,
                    cpuBudgetMs: 5,
                    callback: ({ now }) => ({ submitted: frame(now) }),
                });
            };
            publish('staged', 'Live 3D World GPU resources are ready.', { deviceGeneration });
            if (suspended || reducedMotion || forcedColors) renderFrozenFrame();
            else resumeFrame();
        } catch (error) {
            publish('recovering', 'Live 3D World could not stage GPU resources; retrying.', {
                error: error?.message ?? String(error),
                retryInMilliseconds: 2000,
            });
            scheduleRestart(2000);
        }
    }

    start();

    const updateRuntime = (cfg = {}) => {
        const previousForcedColors = forcedColors, previousClearColor = currentPlan.settings.clearColor;
        const nextPlan = cfg.plan?.settings ? cfg.plan : currentPlan;
        if (nextPlan.settings.particleCount !== N) {
            throw new RangeError('Particle count changes require a new ambient runtime');
        }
        const previousTargetFps = targetFps;
        const changedProgram = JSON.stringify(nextPlan.authoring) !== JSON.stringify(currentPlan.authoring);
        currentPlan = nextPlan;
        clearColor = hexToRGBA(nextPlan.settings.clearColor);
        targetFps = nextPlan.settings.targetFps;
        if (nextPlan.settings.interactive !== undefined) {
            interactive = nextPlan.settings.interactive !== false;
            if (device) setListening(interactive);
        }
        if (cfg.suspended !== undefined) {
            const next = cfg.suspended === true;
            if (next !== suspended) {
                suspended = next;
                if (suspended) stopFrame();
                else resumeFrame();
            }
        }
        if (cfg.reducedMotion !== undefined) reducedMotion = cfg.reducedMotion === true;
        if (cfg.forcedColors !== undefined) forcedColors = cfg.forcedColors === true;
        if (!gesturesAllowed() || changedProgram) clearPointer();
        if (previousTargetFps !== targetFps && frameHandle) stopFrame();
        if (suspended || reducedMotion || forcedColors) stopFrame();
        else resumeFrame();
        resize();
        if (changedProgram) { submittedFrames = 0; lastSubmittedAt = null; stopFrame(); void start(); }
        else if ((suspended || reducedMotion || forcedColors)
            && (previousForcedColors !== forcedColors || previousClearColor !== nextPlan.settings.clearColor)) renderFrozenFrame();
        publish(
            suspended || reducedMotion || forcedColors ? 'paused' : submittedFrames > 0 ? 'ready' : 'staged',
            suspended || reducedMotion || forcedColors ? 'Live 3D World is paused.' : 'Live 3D World settings updated.',
        );
        return lastStatus;
    };

    const disposeRuntime = () => {
        if (disposed) return lastStatus;
        disposed = true;
        startToken++;
        stopFrame();
        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = 0;
        resizeTarget?.removeEventListener?.('resize', onResize);
        resizeObserver?.disconnect?.();
        resizeObserver = null;
        setListening(false);
        try { releaseResources(); } catch {}
        releaseResources = () => {};
        if (ownsContext) {
            try { canvas.getContext('webgpu')?.unconfigure?.(); } catch {}
        }
        device = null;
        deviceGeneration = null;
        if (options.removeCanvasOnDispose === true) canvas.remove();
        return publish('disposed', 'Live 3D World runtime disposed.');
    };

    return Object.freeze({
        count: N,
        /** Apply a same-allocation plan or operational state without rebooting. */
        apply: updateRuntime,
        update: updateRuntime,
        status: () => lastStatus,
        destroy: disposeRuntime,
        dispose: disposeRuntime,
    });
}

/** Inverse of the authored desktop-camera vertex transform. Points are raw
 * top-origin surface fractions, so DPR and resize do not change their anchor. */
export function particlePointerToSimulation(point, camera, width, height) {
    const zoom = camera?.enabled ? camera.zoom : 1;
    const offsetX = camera?.enabled ? camera.offsetX : 0, offsetY = camera?.enabled ? camera.offsetY : 0;
    return [(.5 + (point[0] - .5) / zoom + offsetX) * width, (.5 + (point[1] - .5) / zoom + offsetY) * height];
}

/** Resolve a canvas backing size from its actual host surface, not the window. */
export function measureParticleAmbientSurface(layer, canvas, settings = {}, provider = null) {
    const provided = typeof provider === 'function' ? provider({ layer, canvas, settings }) : null;
    const rect = provided ?? layer?.getBoundingClientRect?.() ?? canvas?.getBoundingClientRect?.() ?? null;
    const cssWidth = Math.max(1, Number(rect?.width || canvas?.clientWidth || globalThis.innerWidth || 1));
    const cssHeight = Math.max(1, Number(rect?.height || canvas?.clientHeight || globalThis.innerHeight || 1));
    const maximumDpr = boundedNumber(settings.maxDpr, 4, 0.5, 4);
    let dpr = Math.min(maximumDpr, Math.max(0.5, Number(provided?.dpr ?? globalThis.devicePixelRatio) || 1));
    const maximumPixels = boundedInteger(settings.maxPixelCount, 67_108_864, 16_384, 67_108_864);
    const requestedPixels = cssWidth * cssHeight * dpr * dpr;
    if (requestedPixels > maximumPixels) dpr *= Math.sqrt(maximumPixels / requestedPixels);
    const deviceLimit = boundedInteger(settings.maxTextureDimension2D, 16_384, 1, 65_536);
    return Object.freeze({
        cssWidth,
        cssHeight,
        dpr,
        width: Math.max(1, Math.min(deviceLimit, Math.floor(cssWidth * dpr))),
        height: Math.max(1, Math.min(deviceLimit, Math.floor(cssHeight * dpr))),
    });
}

function frozenStatus(state, message, detail = {}) {
    return Object.freeze({
        state,
        message,
        projectId: currentStatusPlan(detail)?.projectId ?? null,
        revision: currentStatusPlan(detail)?.revision ?? null,
        contentHash: currentStatusPlan(detail)?.contentHash ?? null,
        count: Number(detail.count ?? 0),
        width: Number(detail.width ?? 0),
        height: Number(detail.height ?? 0),
        submittedFrames: Number(detail.submittedFrames ?? 0),
        lastSubmittedAt: detail.lastSubmittedAt ?? null,
        deviceGeneration: detail.deviceGeneration ?? null,
        suspended: detail.suspended === true,
        reducedMotion: detail.reducedMotion === true,
        forcedColors: detail.forcedColors === true,
        interactive: detail.interactive === true,
        error: detail.error ?? null,
        retryInMilliseconds: detail.retryInMilliseconds ?? null,
    });
}

function currentStatusPlan(detail) {
    return detail.plan ?? null;
}

function boundedInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// WGSL — compute (grid + physics/reactions)
// ─────────────────────────────────────────────────────────────────────────────

const CS_CODE = `
struct P { pos: vec4f, vel: vec4f }
struct U { dt: f32, time: f32, count: u32, rectCount: u32, w: f32, h: f32, mx: f32, my: f32, resizeScale: vec2f }
struct R { xywh: vec4f }
@group(0) @binding(0) var<storage, read_write> pts: array<P>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var<storage, read> rects: array<R>;
@group(0) @binding(3) var<storage, read_write> grid: array<atomic<u32>>;

const GW = ${GRID_W}u;
const GH = ${GRID_H}u;

@compute @workgroup_size(${COMPUTE_WORKGROUP_SIZE})
fn cs_resize(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= u.count) { return; }
  pts[i].pos = vec4f(pts[i].pos.xy * u.resizeScale, pts[i].pos.zw);
  pts[i].vel = vec4f(pts[i].vel.xy * u.resizeScale, pts[i].vel.zw);
}

fn getCell(pos: vec2f) -> i32 {
  let cx = i32(pos.x / u.w * f32(GW));
  let cy = i32(pos.y / u.h * f32(GH));
  if (cx < 0 || cx >= i32(GW) || cy < 0 || cy >= i32(GH)) { return -1; }
  return cy * i32(GW) + cx;
}

@compute @workgroup_size(${COMPUTE_WORKGROUP_SIZE})
fn cs_grid(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= u.count) { return; }
  let _dummy = rects[0].xywh;
  let p = pts[i];
  let cell = getCell(p.pos.xy);
  if (cell >= 0) {
    let sub = p.pos.w;
    let dens = select(select(select(select(select(select(1u,0u,sub>0.5&&sub<1.5),1u,sub>1.5&&sub<2.5),0u,sub>2.5&&sub<3.5),2u,sub>3.5&&sub<4.5),0u,sub>4.5&&sub<5.5),1u,sub>5.5);
    atomicAdd(&grid[cell], dens + 1u);
  }
}

${LEGACY_PCG32_WGSL}
${LEGACY_STANDALONE_RUNTIME_PCG_WGSL}
fn pcg(v: u32) -> u32 { return legacyStandaloneRuntimePcgHash32(v); }
fn rf(s: u32) -> f32 { return legacyStandaloneRuntimePcgFloat01(s); }
fn h21(p: vec2f) -> f32 { return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i=floor(p); let f=fract(p); let s=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2f(1,0)),s.x),mix(h21(i+vec2f(0,1)),h21(i+vec2f(1,1)),s.x),s.y);
}
fn fbm(p: vec2f) -> f32 { return vnoise(p)*0.5+vnoise(p*2.03)*0.25+vnoise(p*4.01)*0.125; }

fn substanceBaseTemp(s: f32) -> f32 {
  if(s < 0.5) { return 20.0; }
  if(s < 1.5) { return 900.0; }
  if(s < 2.5) { return 50.0; }
  if(s < 3.5) { return 6000.0; }
  if(s < 4.5) { return 35.0; }
  if(s < 5.5) { return 120.0; }
  return 25.0;
}
fn substanceDensity(s: f32) -> f32 {
  if(s < 0.5) { return 1000.0; }
  if(s < 1.5) { return 0.3; }
  if(s < 2.5) { return 1200.0; }
  if(s < 3.5) { return 0.001; }
  if(s < 4.5) { return 1600.0; }
  if(s < 5.5) { return 0.6; }
  return 850.0;
}

@compute @workgroup_size(${COMPUTE_WORKGROUP_SIZE})
fn cs_physics(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= u.count) { return; }
  let _dummy = rects[0].xywh;
  var p = pts[i];
  let sub = p.pos.w;
  var temp = p.vel.z;
  let dens = substanceDensity(sub);
  let baseT = substanceBaseTemp(sub);

  var grav = 0.0;
  if(dens > 500.0) { grav = (dens / 1000.0) * 160.0; }
  else { grav = -80.0 / max(dens, 0.01); }
  p.vel.y += grav * u.dt;

  let ns = 0.0015; let t = u.time * 0.18;
  let turbStr = select(select(select(select(select(select(15.0,65.0,sub>0.5&&sub<1.5),25.0,sub>1.5&&sub<2.5),110.0,sub>2.5&&sub<3.5),0.0,sub>3.5&&sub<4.5),45.0,sub>4.5&&sub<5.5),10.0,sub>5.5);
  if (turbStr > 0.0) {
    p.vel.x += (fbm(vec2f(p.pos.x*ns+t, p.pos.y*ns))-0.5) * turbStr * u.dt;
    p.vel.y += (fbm(vec2f(p.pos.x*ns, p.pos.y*ns+t*0.9))-0.5) * turbStr * 0.5 * u.dt;
  }

  let cx = clamp(i32(p.pos.x / u.w * f32(GW)), 0, i32(GW)-1);
  let cy = clamp(i32(p.pos.y / u.h * f32(GH)), 0, i32(GH)-1);
  var grad = vec2f(0.0);
  var localDens = 0.0;
  for(var y=-1; y<=1; y++) {
    for(var x=-1; x<=1; x++) {
      if (x==0 && y==0) { continue; }
      let nx = cx + x; let ny = cy + y;
      var nDens = 0.0;
      if (nx >= 0 && nx < i32(GW) && ny >= 0 && ny < i32(GH)) {
        nDens = f32(atomicLoad(&grid[ny * i32(GW) + nx]));
      } else if (ny >= i32(GH)) { nDens = 20.0; }
      else if (nx < 0 || nx >= i32(GW)) { nDens = 20.0; }
      else { nDens = 0.0; }
      grad += vec2f(f32(x), f32(y)) * nDens;
      localDens += nDens;
    }
  }
  let cellDens = f32(atomicLoad(&grid[cy * i32(GW) + cx]));
  if (cellDens > 2.0) {
    let push = (cellDens - 2.0) * 80.0 * (1000.0 / max(dens, 100.0));
    p.vel.x -= grad.x * push * u.dt;
    p.vel.y -= grad.y * push * u.dt;
  }

  let scanStride = u.count / 8u;
  for(var k = 1u; k <= 4u; k++) {
    let j = (i + k * scanStride) % u.count;
    let q = pts[j];
    let dist = length(q.pos.xy - p.pos.xy);
    if(dist < 80.0) {
      let qsub = q.pos.w; let qtemp = q.vel.z;
      if(sub < 0.5 && qsub > 0.5 && qsub < 1.5) {
        temp += 150.0 * u.dt;
        if(temp > 100.0) { p.pos.w = 5.0; temp = 120.0; }
      }
      if(sub > 0.5 && sub < 1.5 && qsub > 3.5 && qsub < 4.5) { temp -= 120.0 * u.dt; }
      if(sub > 1.5 && sub < 2.5 && qsub < 0.5) {
        temp += 60.0 * u.dt;
        p.vel = vec4f(p.vel.xy + (p.pos.xy - q.pos.xy) / max(dist, 0.001) * 20.0 * u.dt, p.vel.zw);
      }
      if(sub > 5.5 && qsub > 0.5 && qsub < 1.5 && dist < 50.0) {
        temp += 300.0 * u.dt;
        if(temp > 100.0) { p.pos.w = 1.0; temp = 900.0; }
      }
      if(qsub > 2.5 && qsub < 3.5) { temp += 400.0 * u.dt * (1.0 - dist/80.0); }
      if(sub > 4.5 && sub < 5.5 && (qsub < 0.5 || (qsub > 3.5 && qsub < 4.5)) && qtemp < 60.0) {
        temp -= 80.0 * u.dt;
        if(temp < 80.0) { p.pos.w = 0.0; temp = 20.0; }
      }
    }
  }

  temp += (baseT - temp) * 0.8 * u.dt;
  p.vel.z = temp;

  let damp = select(select(select(select(select(select(0.92,0.96,sub>0.5&&sub<1.5),0.92,sub>1.5&&sub<2.5),0.95,sub>2.5&&sub<3.5),0.85,sub>3.5&&sub<4.5),0.96,sub>4.5&&sub<5.5),0.90,sub>5.5);
  p.vel = vec4f(p.vel.xy * pow(damp, u.dt * 60.0), p.vel.zw);
  let maxS = select(select(select(select(select(select(120.0,180.0,sub>0.5&&sub<1.5),120.0,sub>1.5&&sub<2.5),250.0,sub>2.5&&sub<3.5),200.0,sub>3.5&&sub<4.5),150.0,sub>4.5&&sub<5.5),100.0,sub>5.5);
  let spd = length(p.vel.xy);
  if(spd > maxS) { p.vel = vec4f(p.vel.xy/spd*maxS, p.vel.zw); }

  if(u.mx > 0.0 || u.my > 0.0) {
    let d = vec2f(u.mx,u.my) - p.pos.xy; let r = max(length(d),30.0);
    if(r < 250.0) { p.vel += vec4f(d/max(length(d),0.001)*min(8000.0/(r*r),80.0)*u.dt,0.0,0.0); }
  }

  p.pos = vec4f(p.pos.xy + p.vel.xy*u.dt, p.pos.zw);

  let pad=20.0;
  if(p.pos.x < -pad || p.pos.x > u.w+pad){ p.pos.z = 0.0; }
  // Exit and recycle rather than stacking luminous particles on a hard edge.
  if(p.pos.y < -pad || p.pos.y > u.h + pad) { p.pos.z = 0.0; }

  let lifeRate = select(select(select(select(select(select(0.015,0.08,sub>0.5&&sub<1.5),0.02,sub>1.5&&sub<2.5),0.15,sub>2.5&&sub<3.5),0.005,sub>3.5&&sub<4.5),0.03,sub>4.5&&sub<5.5),0.01,sub>5.5);
  p.pos.z -= u.dt * lifeRate;
  if(p.pos.z <= 0.0) {
    let seed = i*1664525u + u32(u.time*1000.0)*22695477u;
    let newSub = floor(rf(seed+7u)*7.0);
    let v0 = select(select(select(select(select(select(12.0,40.0,newSub>0.5&&newSub<1.5),18.0,newSub>1.5&&newSub<2.5),70.0,newSub>2.5&&newSub<3.5),8.0,newSub>3.5&&newSub<4.5),25.0,newSub>4.5&&newSub<5.5),10.0,newSub>5.5);
    let densN = substanceDensity(newSub);
    let startY = select(0.74, 0.06, densN > 500.0) + rf(seed+1u)*0.20;
    p.pos = vec4f(rf(seed)*u.w, startY*u.h, rf(seed+2u)*0.65+0.35, newSub);
    p.vel = vec4f((rf(seed+3u)-0.5)*v0,(rf(seed+4u)-0.5)*v0,substanceBaseTemp(newSub),densN);
  }
  pts[i] = p;
}`;

// ─────────────────────────────────────────────────────────────────────────────
// WGSL — render (substance-specific visuals)
// ─────────────────────────────────────────────────────────────────────────────

const RS_CODE = `
struct P { pos: vec4f, vel: vec4f }
struct U { w: f32, h: f32, time: f32, pad: f32 }
@group(0) @binding(0) var<uniform> u: U;
struct VO { @builtin(position) p: vec4f, @location(0) c: vec4f, @location(1) uv: vec2f }
@vertex fn vs(
  @builtin(vertex_index) vi: u32,
  @location(0) particlePosition: vec4f,
  @location(1) particleVelocity: vec4f,
) -> VO {
  let ci=vi%6u;
  let co6=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(1,1),vec2f(-1,-1),vec2f(1,1),vec2f(-1,1));
  let p=P(particlePosition, particleVelocity); let co=co6[ci];
  let sub=p.pos.w; let life=p.pos.z;
  let temp=p.vel.z; let spd=length(p.vel.xy);
  let tInt=clamp(temp/1000.0,0.0,1.0);
  var sz: f32;
  if(sub<0.5){sz=2.8+life*1.2;}
  else if(sub<1.5){sz=1.5+tInt*3.5;}
  else if(sub<2.5){sz=2.0+life*0.8;}
  else if(sub<3.5){sz=0.8+tInt*2.5;}
  else if(sub<4.5){sz=2.2;}
  else if(sub<5.5){sz=3.5+life*1.5;}
  else{sz=3.0;}
  sz *= 0.4+life*0.6;
  var ofs: vec2f;
  if(((sub>0.5&&sub<1.5)||(sub>2.5&&sub<3.5))&&spd>5.0) {
    let vd=normalize(p.vel.xy); let pd=vec2f(-vd.y,vd.x);
    let str=1.0+min(spd*0.018,4.0);
    ofs=vd*co.x*sz*str + pd*co.y*sz;
  } else { ofs=co*sz; }
  let nx=(p.pos.x+ofs.x)/u.w*2.0-1.0;
  let ny=1.0-(p.pos.y+ofs.y)/u.h*2.0;
  var col: vec3f; var alpha: f32;
  if(sub<0.5) {
    col=mix(vec3f(0.04,0.10,0.28), vec3f(0.20,0.60,1.00), clamp(temp/100.0,0.0,1.0));
    alpha=life*0.22;
  } else if(sub<1.5) {
    let f=clamp((temp-200.0)/700.0,0.0,1.0);
    col=mix(mix(vec3f(0.55,0.08,0.02),vec3f(1.0,0.42,0.05),f),vec3f(1.0,0.88,0.30),f*f);
    alpha=life*(0.20+tInt*0.35);
  } else if(sub<2.5) {
    col=mix(vec3f(0.08,0.22,0.04), vec3f(0.35,0.95,0.10), clamp(spd*0.012,0.0,1.0));
    alpha=life*0.24;
  } else if(sub<3.5) {
    let f=clamp((temp-1000.0)/5000.0,0.0,1.0);
    col=mix(vec3f(0.30,0.04,0.55), mix(vec3f(0.70,0.30,1.00),vec3f(0.95,0.90,1.00),f), f*0.8+0.2);
    alpha=life*(0.18+f*0.45);
  } else if(sub<4.5) {
    col=mix(vec3f(0.28,0.20,0.08), vec3f(0.72,0.58,0.28), clamp(spd*0.008,0.0,1.0));
    alpha=life*0.30;
  } else if(sub<5.5) {
    col=mix(vec3f(0.55,0.60,0.68), vec3f(0.82,0.88,0.95), life);
    alpha=life*life*0.16;
  } else {
    col=mix(vec3f(0.02,0.01,0.04), vec3f(0.18,0.08,0.28), clamp(spd*0.01,0.0,1.0));
    alpha=life*0.35;
  }
  var o: VO;
  o.p=vec4f(nx,ny,0.0,1.0); o.c=vec4f(col,alpha*u.pad); o.uv=co;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let d=dot(i.uv,i.uv); if(d>1.0){discard;}
  let glow=exp(-d*1.6);
  let core=exp(-d*7.0)*0.45;
  return vec4f(i.c.rgb*(glow+core), i.c.a*glow);
}`;

/** The authored program changes only bounded constants and retained engine
 * operations. Resource ownership, bindings and state layout remain native. */
export function buildAuthoredParticleSources(plan) {
    if (!plan.authoring) return { compute: CS_CODE, render: RS_CODE, usesLegacy: true };
    const a = normalizeParticleAuthoring(plan.authoring), f = value => Number(value).toFixed(6);
    const historical = { ...a, field: { ...a.field } }; delete historical.field.response;
    if (isDefaultParticleAuthoring(historical, plan.settings.particleCount)) {
        return { compute: a.field.response ? applyParticlePointerResponse(CS_CODE, a, 1) : CS_CODE, render: RS_CODE, usesLegacy: true };
    }
    let compute = CS_CODE, render = RS_CODE;
    const replace = (source, before, after) => { if (!source.includes(before)) throw new Error(`Live 3D source hook missing: ${before.slice(0, 60)}`); return source.replace(before, after); };
    const rows = a.emitters.length ? a.emitters : [{ substance: 0, temperature: 20, density: 1000, initialSpeed: 0 }];
    const table = `\nfn authoredEmitter(index: u32) -> vec4f { let sources = array<vec4f, ${rows.length}>(${rows.map(emitter => `vec4f(${f(emitter.substance)}, ${f(emitter.temperature)}, ${f(emitter.density)}, ${f(emitter.initialSpeed)})`).join(', ')}); return sources[min(index, ${rows.length - 1}u)]; }\nfn authoredEmitterSeed(index: u32) -> u32 { let seeds = array<u32, ${rows.length}>(${rows.map(emitter => `${emitter.seed ?? 7314}u`).join(', ')}); return seeds[min(index, ${rows.length - 1}u)]; }\n`;
    compute = table + compute;
    compute = replace(compute, 'let dens = substanceDensity(sub);\n  let baseT = substanceBaseTemp(sub);', 'let origin = authoredEmitter(u32(p.vel.w) % 64u);\n  let dens = select(substanceDensity(sub), origin.z, abs(sub - origin.x) < 0.5);\n  let baseT = select(substanceBaseTemp(sub), origin.y, abs(sub - origin.x) < 0.5);');
    compute = replace(compute, 'p.vel.y += grav * u.dt;', `p.vel.y += grav * u.dt * ${f(a.solver.gravity)};`);
    compute = replace(compute, 'if (turbStr > 0.0)', `if (${a.field.enabled} && turbStr > 0.0)`);
    compute = compute.replaceAll('* turbStr *', `* turbStr * ${f(a.field.turbulence)} *`);
    compute = replace(compute, '* 80.0 * (1000.0', `* ${f(a.field.enabled ? 80 * a.field.densityPressure : 0)} * (1000.0`);
    compute = replace(compute, 'if(u.mx > 0.0 || u.my > 0.0)', `if(${a.field.enabled} && (u.mx > 0.0 || u.my > 0.0))`);
    compute = replace(compute, 'min(8000.0/(r*r),80.0)*u.dt', `min(8000.0/(r*r),80.0)*u.dt*${f(a.field.pointerStrength)}`);
    const thermalStart = compute.indexOf('  let scanStride ='), thermalEnd = compute.indexOf('  p.vel.z = temp;', thermalStart);
    if (thermalStart < 0 || thermalEnd < 0) throw new Error('Live 3D thermal operation source is missing');
    compute = compute.slice(0, thermalStart) + compute.slice(thermalStart, thermalEnd).replaceAll('u.dt', `(u.dt * ${f(a.solver.thermalRate)})`) + compute.slice(thermalEnd);
    compute = replace(compute, 'let newSub = floor(rf(seed+7u)*7.0);', 'let newSub = origin.x;');
    compute = replace(compute, 'let seed = i*1664525u + u32(u.time*1000.0)*22695477u;', 'let seed = (u32(p.vel.w) / 64u)*1664525u + authoredEmitterSeed(u32(p.vel.w) % 64u) + u32(u.time*1000.0)*22695477u;');
    compute = compute.replace(/let v0 = select\([^\n]+;/, `let v0 = origin.w * ${f(a.initialize.speedScale)};`);
    compute = replace(compute, 'let densN = substanceDensity(newSub);', 'let densN = origin.z;');
    compute = replace(compute, 'rf(seed)*u.w, startY*u.h', `(.5 + (rf(seed) - .5) * ${f(a.initialize.spreadX)})*u.w, (.5 + (${a.initialize.enabled ? 'startY' : 'rf(seed+1u)'} - .5) * ${f(a.initialize.spreadY)})*u.h`);
    compute = replace(compute, 'substanceBaseTemp(newSub),densN);', 'origin.y,p.vel.w);');
    compute = compute.replaceAll('u.dt', `(u.dt * ${f(a.solver.timeScale)})`);
    render = replace(render, 'sz *= 0.4+life*0.6;', `sz *= (0.4+life*0.6) * ${f(a.renderer.pointScale)};`);
    render = replace(render, 'o.p=vec4f(nx,ny,0.0,1.0); o.c=vec4f(col,alpha*u.pad);', `o.p=vec4f((nx - ${f(a.camera.enabled ? a.camera.offsetX * 2 : 0)}) * ${f(a.camera.enabled ? a.camera.zoom : 1)}, (ny + ${f(a.camera.enabled ? a.camera.offsetY * 2 : 0)}) * ${f(a.camera.enabled ? a.camera.zoom : 1)},0.0,1.0); o.c=vec4f(col * ${f(a.renderer.brightness)},alpha*u.pad);`);
    render = replace(render, 'let glow=exp(-d*1.6);', a.bloom.enabled ? `let glow=exp(-d*1.6) * ${f(a.bloom.glow)};` : 'let glow=exp(-d*4.0);');
    render = replace(render, 'let core=exp(-d*7.0)*0.45;', `let core=exp(-d*7.0)*0.45 * ${f(a.bloom.enabled ? a.bloom.core : 0)};`);
    if (a.field.response) compute = applyParticlePointerResponse(compute, a, a.solver.timeScale);
    return { compute, render, usesLegacy: false };
}

/** Bounded force vocabulary generated solely from the saved field response.
 * This helper is also sampled directly by the real GPU gesture oracle. */
export function buildParticlePointerResponseWGSL(response, { enabled = true, pointerStrength = 1, zoom = 1 } = {}) {
    const r = normalizeParticlePointerResponse(response), f = value => Number(value).toFixed(6);
    const mode = key => `${PARTICLE_POINTER_MODES.indexOf(r[key])}u`;
    return `
fn authoredPointerGesture(point: vec2f, center: vec2f, mode: u32, gain: f32, age: f32) -> vec2f {
  let delta = center - point;
  let distance = length(delta);
  let radius = max(0.001, min(u.w, u.h) * ${f(r.radius)} / ${f(zoom)});
  if (mode == 0u || gain <= 0.0 || distance >= radius) { return vec2f(0.0); }
  let support = max(0.0, 1.0 - distance / radius);
  let envelope = pow(support, ${f(r.falloff)});
  let radial = delta / max(distance, 0.001);
  var direction = vec2f(0.0);
  if (mode == 1u) { direction = radial; }
  if (mode == 2u) { direction = -radial; }
  if (mode == 3u) { direction = vec2f(-radial.y, radial.x); }
  if (mode == 4u) { direction = -radial * sin(distance / radius * ${f(r.rippleFrequency)} - age * ${f(r.rippleSpeed)}); }
  return direction * envelope * gain * ${f(enabled && r.enabled ? pointerStrength * r.acceleration : 0)};
}
fn authoredPointerAcceleration(point: vec2f) -> vec2f {
  var force = vec2f(0.0);
  if (u.gesture.w > 0.0) {
    let center = vec2f(u.mx, u.my);
    force += authoredPointerGesture(point, center, ${mode('hoverMode')}, ${f(r.hoverStrength)}, u.time);
    force += authoredPointerGesture(point, center, ${mode('pressMode')}, u.gesture.x * ${f(r.pressStrength)}, u.time);
    let dwell = clamp((u.gesture.y - ${f(r.dwellDelay)}) / ${f(r.dwellDuration)}, 0.0, 1.0);
    force += authoredPointerGesture(point, center, ${mode('dwellMode')}, dwell * ${f(r.dwellStrength)}, u.time);
  }
  let clickAge = u.gesture.z;
  if (clickAge >= 0.0 && clickAge < ${f(r.clickDuration)}) {
    let progress = clickAge / ${f(r.clickDuration)};
    let decay = exp(-progress * ${f(r.clickDecay)}) * (1.0 - progress);
    force += authoredPointerGesture(point, u.responseClick.xy, ${mode('clickMode')}, decay * ${f(r.clickStrength)}, clickAge);
  }
  return force;
}
`;
}

function applyParticlePointerResponse(source, authoring, timeScale) {
    const declaration = 'resizeScale: vec2f }';
    const marker = source.indexOf('u.mx > 0.0'), start = source.lastIndexOf('  if(', marker), end = source.indexOf('\n\n  p.pos =', marker);
    if (!source.includes(declaration) || marker < 0 || start < 0 || end < 0) throw new Error('Live 3D pointer operation source is missing');
    let result = source.slice(0, start) + `  p.vel = vec4f(p.vel.xy + authoredPointerAcceleration(p.pos.xy) * u.dt * ${Number(timeScale).toFixed(6)}, p.vel.zw);` + source.slice(end);
    result = result.replace(declaration, 'resizeScale: vec2f, gesture: vec4f, responseClick: vec4f }');
    return result + buildParticlePointerResponseWGSL(authoring.field.response, { enabled: authoring.field.enabled, pointerStrength: authoring.field.pointerStrength, zoom: authoring.camera.enabled ? authoring.camera.zoom : 1 });
}
