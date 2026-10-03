// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { AdaptiveQualityGovernor } from '../../core/gpu/AdaptiveQualityGovernor.js';
import { planProgressiveWorkBudget } from '../../core/gpu/ProgressiveWorkBudget.js';
import { planProgressiveTiles } from '../../core/gpu/ProgressiveTilePlanner.js';

/** Cached premultiplied volume, with exact full-resolution silhouette rays.
 * Only presentation resolution adapts. Native cells, time steps and sparse
 * world coordinates are independent of this cache. No temporal reprojection. */
export class FlowPresentation {
    static async create(device, format, source, options = {}) {
        const presentation = new FlowPresentation(device, options);
        try {
            const shader = device.createShaderModule({ label: 'Sparse Flow cached presentation', code: source });
            const errors = (await shader.getCompilationInfo()).messages.filter(message => message.type === 'error');
            if (errors.length) throw new Error(errors.map(message => `${message.lineNum}: ${message.message}`).join('\n'));
            const descriptor = { layout: 'auto', vertex: { module: shader, entryPoint: 'vertex' }, primitive: { topology: 'triangle-list' } };
            presentation.cachePipeline = await device.createRenderPipelineAsync({ ...descriptor, label: 'Sparse Flow low-resolution rays',
                fragment: { module: shader, entryPoint: 'cacheFragment', targets: [{ format: 'rgba16float' }, { format: 'r32float' }] } });
            presentation.compositePipeline = await device.createRenderPipelineAsync({ ...descriptor, label: 'Sparse Flow depth-aware composite',
                fragment: { module: shader, entryPoint: 'compositeFragment', targets: [{ format: 'rgba16float' }] } });
            presentation.refinePipeline = await device.createRenderPipelineAsync({ ...descriptor, label: 'Sparse Flow exact paused tiles',
                fragment: { module: shader, entryPoint: 'refineFragment', targets: [{ format: 'rgba16float' }] } });
            presentation.displayPipeline = await device.createRenderPipelineAsync({ ...descriptor, label: 'Present completed Flow volume',
                fragment: { module: shader, entryPoint: 'displayFragment', targets: [{ format, blend: {
                    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                } }] } });
            return presentation;
        } catch (error) { presentation.dispose(); throw error; }
    }
    constructor(device, { targetFPS = 60 } = {}) {
        this.device = device; this.quality = 'auto'; this.stepSamples = 0; this.stepMeanMs = 0;
        // Use the Engine's medium representation tier. The native field is
        // authoritative; none of the tier's simulation/work quotas apply here.
        this.governor = new AdaptiveQualityGovernor({ targetFPS, initialTier: 'high',
            historySize: 45, cooldownMs: 2000, upgradeBackoffMs: 10000, minimumGpuSamples: 3 });
        this.decision = this.governor.getDecision();
        this.policyRevision = 0; this.refinementGeneration = 0; this.tiles = []; this.tileCursor = 0; this.tilesPlanned = false;
        this.refinementSamples = 0; this.refinementCpuMs = 0; this.refinementGpuMs = 0;
        this.refinementUnitMs = this.governor.targetFrameMs * .5;
        this.refinementTimingTiles = 0; this.refinementTimingPixels = 0;
        this.refinedPixels = 0; this.coupledTickWallMs = null;
        this.cameraData = new Float32Array(48); this.previousCamera = new Float32Array(48).fill(NaN);
        this.cameraBuffer = device.createBuffer({ label: 'Sparse Flow presentation camera', size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    setQuality(mode) {
        if (!['auto', 'performance', 'balanced', 'high', 'full'].includes(mode))
            throw new RangeError('Flow render quality must be auto, performance, balanced, high or full');
        if (mode === this.quality) return;
        this.quality = mode;
        ++this.policyRevision;
        this.governor.setMode(mode === 'auto' ? 'auto' : 'fixed', mode === 'full' ? 'ultra' : mode === 'auto' ? 'high' : mode);
        this.governor.reset(); this.decision = this.governor.getDecision();
    }
    observeStep(milliseconds) {
        if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
        this.stepMeanMs += (milliseconds - this.stepMeanMs) * (this.stepSamples ? .08 : 1);
        ++this.stepSamples;
    }
    observePresentation(sample = {}) {
        // GPU timestamps, queue debt and CPU work remain separate signals.
        // A native-step fence duration is not a render GPU timestamp.
        if (typeof sample.gpuSamplePaused === 'boolean' && sample.gpuSamplePaused !== (sample.paused === true)) {
            // Pause/resume may happen while a timestamp readback is pending.
            // Its GPU cost belongs to the sampled phase; CPU and queue signals
            // still describe this observation and must remain available.
            if (Number.isFinite(sample.passTimes?.['Flow refine'])) this.refinementTimingTiles = 0;
            sample = { ...sample, gpuMs: null, passTimes: {} };
        }
        if (sample.paused === true) {
            const refinementMs = sample.passTimes?.['Flow refine'];
            if (Number.isFinite(refinementMs) && refinementMs >= 0 && this.refinementTimingTiles > 0) {
                if (this.refinementTimingGeneration === this.refinementGeneration && this.refinementTimingPolicy === this.policyRevision) {
                    // Normalize to a64x64 tile; delayed samples may cover a mix
                    // of subdivided regions, so tile count is not a work unit.
                    const perTile = Math.max(.01, refinementMs * 4096 / this.refinementTimingPixels);
                    this.refinementUnitMs = Math.max(perTile, this.refinementUnitMs * .8);
                }
                this.refinementTimingTiles = 0;
            }
            if (Number.isFinite(sample.cpuMs) && sample.cpuMs >= 0) {
                this.refinementCpuMs = sample.cpuMs; ++this.refinementSamples;
            }
            if (Number.isFinite(sample.gpuMs) && sample.gpuMs >= 0)
                this.refinementGpuMs = Math.max(0, sample.gpuMs - (refinementMs ?? 0));
            return this.decision;
        }
        this.refinementSamples = 0;
        const coupled = sample.coupledTickWallMs;
        const coupledFresh = Number.isFinite(coupled) && coupled >= 0;
        this.coupledTickWallMs = coupledFresh ? coupled : null;
        // A coupled tick can include a batched CPU thermal solve. Reducing ray
        // resolution cannot pay that cost. Keep its real latency visible, but
        // adapt pixels from measured renderer work and unfinished render debt.
        const renderWork = [sample.cpuMs, sample.gpuMs].filter(value => Number.isFinite(value) && value >= 0);
        this.observedQueueDepth = sample.queueDepth ?? 0;
        const queueDepth = Number.isFinite(sample.queueDepthBeforeSubmit)
            ? sample.queueDepthBeforeSubmit : sample.queueDepth;
        this.observedQueueDepthBeforeSubmit = queueDepth ?? 0;
        // Post-submit depth1 is the frame just admitted, not evidence that a
        // previous frame is unfinished. Full/throttled admission retains its
        // original debt; callers without this metadata keep existing behavior.
        // The shared governor already derives max(measured CPU, measured GPU).
        // Do not replace that measured-work policy with an outer elapsed total.
        this.decision = this.governor.recordFrame({ ...sample, queueDepth, totalMs: undefined });
        this.qualityLoadSource = renderWork.length ? 'measured-render-work-and-prior-queue-debt' : this.decision.timingSource;
        return this.decision;
    }
    resize(width, height, fullWidth, fullHeight) {
        if (this.width === width && this.height === height && this.fullWidth === fullWidth && this.fullHeight === fullHeight) return false;
        let colour, depth, completed;
        try {
            const descriptor = { size: [width, height], usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING };
            colour = this.device.createTexture({ ...descriptor, label: 'Cached Flow premultiplied radiance', format: 'rgba16float' });
            depth = this.device.createTexture({ ...descriptor, label: 'Cached Flow opaque depth witnesses', format: 'r32float' });
            completed = this.device.createTexture({ ...descriptor, size: [fullWidth, fullHeight], label: 'Completed depth-aware Flow image', format: 'rgba16float' });
            const colourView = colour.createView(), depthView = depth.createView(), completedView = completed.createView();
            this.colour?.destroy(); this.depth?.destroy(); this.completed?.destroy();
            Object.assign(this, { colour, depth, completed, colourView, depthView, completedView, width, height, fullWidth, fullHeight });
            return true;
        } catch (error) { colour?.destroy(); depth?.destroy(); completed?.destroy(); throw error; }
    }
    draw(encoder, target, sceneDepth, camera, snapshot, colourView, stats) {
        // One shared quality decision, without a second hidden pixel ceiling.
        const scale = this.decision.mediumScale;
        const resized = this.resize(Math.max(1, Math.ceil(camera.width * scale)), Math.max(1, Math.ceil(camera.height * scale)), camera.width, camera.height);
        const data = this.cameraData;
        data.set(camera.viewProjection, 0); data.set(camera.eye, 16); data.set(camera.right, 20);
        data.set(camera.up, 24); data.set(camera.forward, 28);
        data.set([camera.width, camera.height, camera.aspect, camera.tanHalfFov], 32);
        data.set([camera.x ?? 0, camera.y ?? 0, this.width, this.height], 44);
        const timeSeconds = camera.timeSeconds ?? 0;
        if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new RangeError('Flow presentation time must be finite and nonnegative');
        // Completed physical time keeps detail frozen while paused and invalidates
        // only alongside an actual native step, rather than every display frame.
        data[36] = timeSeconds;
        // Explicit depth convention participates in the camera cache key.
        // Shared forward-Z callers keep their existing zero-valued default.
        const reverseZ = camera.reverseZ === true;
        data[37] = Number(reverseZ);
        const cameraChanged = data.some((value, index) => value !== this.previousCamera[index]);
        const bindingChanged = resized || sceneDepth !== this.sceneDepth || snapshot.generation !== this.generation || colourView !== this.sourceColourView;
        if (bindingChanged) {
            const entries = [...snapshot.entries(), { binding: 5, resource: { buffer: this.cameraBuffer } },
                { binding: 6, resource: sceneDepth }, { binding: 7, resource: snapshot.lightView },
                { binding: 8, resource: colourView }, { binding: 9, resource: { buffer: snapshot.bounds } }];
            this.cacheGroup = this.device.createBindGroup({ layout: this.cachePipeline.getBindGroupLayout(0), entries });
            this.refineGroup = this.device.createBindGroup({ layout: this.refinePipeline.getBindGroupLayout(0), entries });
            this.compositeGroup = this.device.createBindGroup({ layout: this.compositePipeline.getBindGroupLayout(0), entries: [...entries,
                { binding: 10, resource: this.colourView }, { binding: 11, resource: this.depthView }] });
            this.displayGroup = this.device.createBindGroup({ layout: this.displayPipeline.getBindGroupLayout(0), entries: [
                { binding: 12, resource: this.completedView }] });
            this.sceneDepth = sceneDepth; this.generation = snapshot.generation; this.sourceColourView = colourView;
        }
        if (cameraChanged) {
            this.device.queue.writeBuffer(this.cameraBuffer, 0, data); this.previousCamera.set(data);
        }
        const sceneRevision = camera.sceneRevision ?? 0;
        const refreshed = bindingChanged || cameraChanged || snapshot.frame !== this.frame || sceneRevision !== this.sceneRevision
            || this.appliedPolicyRevision !== this.policyRevision;
        if (refreshed) {
            const pass = encoder.beginRenderPass({ label: 'Refresh completed Flow volume cache',
                timestampWrites: camera.timing?.('Flow rays')?.timestampWrites, colorAttachments: [
                { view: this.colourView, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' },
                { view: this.depthView, loadOp: 'clear', clearValue: [reverseZ ? 0 : 1, 0, 0, 0], storeOp: 'store' },
            ] });
            pass.setPipeline(this.cachePipeline); pass.setBindGroup(0, this.cacheGroup); pass.draw(3); pass.end();
            const composite = encoder.beginRenderPass({ label: 'Resolve Flow silhouettes at full resolution',
                timestampWrites: camera.timing?.('Flow composite')?.timestampWrites,
                colorAttachments: [{ view: this.completedView, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
            composite.setPipeline(this.compositePipeline); composite.setBindGroup(0, this.compositeGroup); composite.draw(3); composite.end();
            this.frame = snapshot.frame; this.sceneRevision = sceneRevision; ++stats.raymarchedFrames;
            this.appliedPolicyRevision = this.policyRevision;
            this.tiles = []; this.tilesPlanned = false;
            this.tileCursor = 0; this.refinedPixels = 0; ++this.refinementGeneration;
        } else ++stats.cachedFrames;
        const fullRays = this.width === camera.width && this.height === camera.height;
        if (camera.paused === true && !fullRays && !this.tilesPlanned) {
            this.tiles = planProgressiveTiles(camera.width, camera.height,
                { tileSize: 64, focusX: camera.focus?.[0], focusY: camera.focus?.[1] });
            this.tilesPlanned = true;
        }
        // A frozen physical snapshot can be refined exactly over several host
        // frames, as in the Fractal app. The completed image keeps its valid
        // coarse preview until each non-overlapping tile replaces those pixels.
        const estimateTile = tile => this.refinementUnitMs * tile.width * tile.height / 4096;
        const planBudget = () => planProgressiveWorkBudget({ targetFrameMs: this.decision.targetFrameMs,
            cpuP95Ms: this.refinementCpuMs, gpuP95Ms: this.refinementGpuMs,
            queueDepth: camera.queueDepth, queueCapacity: camera.queueCapacity ?? 2,
            timingReady: camera.paused === true && !refreshed && this.refinementSamples > 0,
            requestedUnits: this.tiles.length - this.tileCursor,
            unitCostMs: this.tiles[this.tileCursor] ? estimateTile(this.tiles[this.tileCursor]) : this.refinementUnitMs });
        let budget = planBudget(), subdivisions = 0;
        // Keep already completed pixels and the same generation. Only an
        // unaffordable pending region is split, using the shared Fractal order.
        while (budget.timingReady && !budget.queueBlocked && !budget.admittedUnits && this.tileCursor < this.tiles.length) {
            const tile = this.tiles[this.tileCursor], side = Math.max(tile.width, tile.height);
            if (side <= 16) break;
            const children = planProgressiveTiles(tile.width, tile.height, { tileSize: Math.max(16, Math.floor(side / 2)),
                focusX: ((camera.focus?.[0] ?? .5) * camera.width - tile.x) / tile.width,
                focusY: ((camera.focus?.[1] ?? .5) * camera.height - tile.y) / tile.height });
            this.tiles.splice(this.tileCursor, 1, ...children.map(child => ({ ...child, x: child.x + tile.x, y: child.y + tile.y })));
            ++subdivisions; budget = planBudget();
        }
        let tileCount = 0, estimatedWorkMs = 0, timingPixels = 0;
        if (budget.timingReady && !budget.queueBlocked) {
            for (let cursor = this.tileCursor; cursor < this.tiles.length; ++cursor) {
                const tile = this.tiles[cursor], cost = estimateTile(tile);
                if (estimatedWorkMs + cost > budget.availableMs) break;
                estimatedWorkMs += cost; timingPixels += tile.width * tile.height; ++tileCount;
            }
            if (!tileCount && this.tileCursor < this.tiles.length && (camera.queueDepth ?? 0) === 0) {
                const tile = this.tiles[this.tileCursor];
                // A frozen frame must eventually finish even if its smallest
                // exact region exceeds the budget. Disclose that cost instead
                // of silently promising refinement that can never advance.
                if (Math.max(tile.width, tile.height) <= 16) {
                    tileCount = 1; timingPixels = tile.width * tile.height; estimatedWorkMs = estimateTile(tile);
                    budget = { ...budget, reason: 'paused-minimum-tile-progress' };
                }
            }
        }
        budget = { ...budget, admittedUnits: tileCount, estimatedWorkMs, subdivisions };
        if (tileCount > 0) {
            const timing = camera.timing?.('Flow refine');
            if (timing?.timestampWrites) {
                this.refinementTimingTiles = tileCount;
                this.refinementTimingPixels = timingPixels;
                this.refinementTimingGeneration = this.refinementGeneration; this.refinementTimingPolicy = this.policyRevision;
            }
            const refinement = encoder.beginRenderPass({ label: 'Refine frozen Flow pixels', timestampWrites: timing?.timestampWrites,
                colorAttachments: [{ view: this.completedView, loadOp: 'load', storeOp: 'store' }] });
            refinement.setPipeline(this.refinePipeline); refinement.setBindGroup(0, this.refineGroup);
            for (let i = 0; i < tileCount; ++i) {
                const tile = this.tiles[this.tileCursor++];
                refinement.setScissorRect(tile.x, tile.y, tile.width, tile.height); refinement.draw(3);
                this.refinedPixels += tile.width * tile.height;
            }
            refinement.end();
        }
        const pass = encoder.beginRenderPass({ label: 'Present cached completed Flow image',
            timestampWrites: camera.timing?.('Flow display')?.timestampWrites,
            colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }] });
        pass.setViewport(camera.x ?? 0, camera.y ?? 0, camera.width, camera.height, 0, 1);
        pass.setScissorRect(camera.x ?? 0, camera.y ?? 0, camera.width, camera.height);
        pass.setPipeline(this.displayPipeline); pass.setBindGroup(0, this.displayGroup); pass.draw(3); pass.end();
        Object.assign(stats, { renderQuality: this.quality, requestedRenderScale: scale,
            qualityTier: this.decision.name, qualityReason: this.decision.reason,
            qualityTimingSource: this.decision.timingSource, qualityDecision: this.decision,
            qualityLoadSource: this.qualityLoadSource ?? this.decision.timingSource, coupledTickWallMs: this.coupledTickWallMs,
            observedRenderQueueDepth: this.observedQueueDepth ?? 0,
            observedRenderQueueDepthBeforeSubmit: this.observedQueueDepthBeforeSubmit ?? 0,
            refinementGeneration: this.refinementGeneration, refinementTiles: this.tileCursor,
            refinementTotalTiles: this.tiles.length, refinementTilesThisFrame: tileCount,
            refinementComplete: fullRays || (this.tilesPlanned && this.tileCursor === this.tiles.length),
            refinementFraction: fullRays ? 1 : this.refinedPixels / (camera.width * camera.height),
            refinementBudget: budget, refinementOutputSize: [camera.width, camera.height],
            authoritativeParticipation: 1,
            renderScale: Math.min(this.width / camera.width, this.height / camera.height),
            renderScaleXY: [this.width / camera.width, this.height / camera.height], renderSize: [this.width, this.height],
            presentationBytes: this.width * this.height * 12 + camera.width * camera.height * 8,
            observedStepMeanMs: this.stepMeanMs });
        ++stats.renderedFrames;
    }
    dispose() { this.colour?.destroy(); this.depth?.destroy(); this.completed?.destroy(); this.cameraBuffer?.destroy(); }
}
