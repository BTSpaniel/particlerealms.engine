// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { SURFACE_FIELD_RENDER_WGSL } from './SurfaceFieldShaders.js';
import { SURFACE_FIELD_RUNOFF_WGSL } from './SurfaceFieldRunoffShaders.js';
import { SURFACE_RUNOFF_CAPACITY, SURFACE_RUNOFF_STRIDE } from '../../sim/surfaceFields/SurfaceFieldRunoff.js';
import { createMaterialLibrary } from '../materials/MaterialLibrary.js';
import { createCheckedShaderModule, assertCheckedShaderModule } from '../../core/gpu/GpuShaderDiagnostics.js';
import { GPUTimestampProfiler } from '../../core/gpu/GPUTimestampProfiler.js';
import { mat4Inverse } from '../../core/math/EngineMath.js';
import { mat4Determinant } from '../../core/math/MathMat.js';

/** Retained-field renderer on an explicitly borrowed device. Surface appearance
 * extends native material presets and PBR; water samples a separate solid pass.
 */
export async function createSurfaceFieldRenderer(options) {
    const renderer = new SurfaceFieldRenderer(options);
    try { await renderer.initialize(); return renderer; }
    catch (error) { renderer.log('error', 'initialization failed', { message: error.message }); renderer.dispose(); throw error; }
}

export class SurfaceFieldRenderer {
    constructor({ device, format = 'bgra8unorm', topology, logger, materials = null, reverseZ = false } = {}) {
        if (!device?.createBuffer || !topology?.count || !topology?.address) throw new TypeError('Surface renderer needs a borrowed GPU device and surface topology');
        if (typeof reverseZ !== 'boolean') throw new TypeError('Surface renderer reverseZ must be boolean');
        this.device = device; this.format = format; this.topology = topology; this.logger = logger; this.materials = materials;
        this.reverseZ = reverseZ; this.depthFormat = reverseZ ? 'depth32float' : 'depth24plus';
        this.resources = new Set(); this.disposed = false; this.width = 0; this.height = 0; this._bytes = 0;
        this.parameters = new ArrayBuffer(224); this.f32 = new Float32Array(this.parameters); this.u32 = new Uint32Array(this.parameters);
        this.inverseViewProjection = new Float32Array(this.parameters, 160, 16);
        this.submittedFrames = 0; this.queueDepth = 0; this.queueCapacity = 2; this.timingPending = false;
        this.gpuSample = null; this.lastCpuMs = 0; this.queueFailure = null; this.presentationStarted = false;
        this.presentationStats = { submittedFrames: 0, queueDepth: 0, gpuTimingAvailable: false };
    }
    log(level, message, detail = {}) {
        if (typeof this.logger === 'function') this.logger(`[SurfaceFieldRenderer] ${message}`, { level, ...detail });
        else this.logger?.[level]?.(`[SurfaceFieldRenderer] ${message}`, detail);
    }
    get bytes() { return this._bytes; }
    alive() { if (this.disposed) throw new Error('Surface renderer is disposed'); }
    buffer(data, label, usage) {
        const size = Math.max(16, typeof data === 'number' ? data : data.byteLength);
        const buffer = this.device.createBuffer({ label: `Surface ${label}`, size, usage, mappedAtCreation: typeof data !== 'number' });
        this.resources.add(buffer); this._bytes += size;
        if (typeof data !== 'number') { new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); buffer.unmap(); }
        return buffer;
    }
    async initialize() {
        const t = this.topology, device = this.device;
        this.log('debug', 'initializing retained presentation', { cells: t.count, depthFormat: this.depthFormat, reverseZ: this.reverseZ });
        this.fields = this.buffer(t.count * 32, 'presentation fields', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        this.auxiliary = this.buffer(t.count * 32, 'retained oil acid and material loss', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        this.emptyAuxiliary = new Float32Array(t.count * 8);
        this.defaultPoses = new Float32Array(t.count * 8);
        for (let i = 0; i < t.count; i++) this.defaultPoses.set([t.meta[i * 8], t.meta[i * 8 + 1] - t.meta[i * 8 + 7] * .5, t.meta[i * 8 + 2], 1, 0, 0, 0, 1], i * 8);
        this.poses = this.buffer(this.defaultPoses, 'native rigid leaf poses', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        this.liquidProperties = this.buffer(t.count * 16, 'aqueous concentration and stratified oil properties', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        this.defaultLiquidProperties = new Float32Array(t.count * 4);
        this.runoff = this.buffer(SURFACE_RUNOFF_CAPACITY * SURFACE_RUNOFF_STRIDE * 4, 'retained airborne liquid parcels', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        this.runoffCount = 0;
        this.meta = this.buffer(t.meta, 'presentation geometry', GPUBufferUsage.STORAGE);
        this.uniform = this.buffer(224, 'presentation camera', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.inertFireLight = this.buffer(new Float32Array(8), 'inactive native fire light', GPUBufferUsage.STORAGE);
        this.boundFireLight = this.inertFireLight; this.sceneRevision = 0;
        // Passing an inert storage object loads built-in presets without reading
        // or writing the user's editor material library.
        const library = createMaterialLibrary({ getItem: () => null, setItem: () => {} });
        const domainData = new Float32Array(t.domains.length * 16), addresses = new Uint32Array(t.count);
        t.domains.forEach((d, index) => {
            const id = ({ wood: 'mat_wood', metal: 'mat_brushed_aluminum', stone: 'mat_concrete' })[d.material];
            const kindIndex = ['wood', 'metal', 'stone', 'calcite'].indexOf(d.material);
            const material = this.materials?.[kindIndex] || library.get(id || 'mat_default');
            domainData.set([...d.center, Number(!d.receiveRunoff && d.material !== 'calcite'), ...d.size, d.size[0] / t.n, d.size[1] / t.n,
                ...material.baseColor.slice(0, 3), material.metallic, material.roughness, d.tiltX || 0, d.tiltZ || 0, Math.max(0, kindIndex)], index * 16);
            for (let z = 0; z < t.n; z++) for (let x = 0; x < t.n; x++) addresses[index * t.n * t.n + z * t.n + x] = t.address(index, x, z);
        });
        this.domains = this.buffer(domainData, 'native PBR materials and domains', GPUBufferUsage.STORAGE);
        this.addresses = this.buffer(addresses, 'physical chart lookup', GPUBufferUsage.STORAGE);
        const entries = [0, 1, 2, 3, 4, 5, 6, 7].map(binding => ({ binding, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: binding ? 'read-only-storage' : 'uniform' } }));
        entries.push({ binding: 10, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } });
        this.solidLayout = device.createBindGroupLayout({ entries });
        this.waterLayout = device.createBindGroupLayout({ entries: [...entries,
            { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 9, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
        // A separate layout avoids exceeding eight storage bindings per stage.
        this.runoffLayout = device.createBindGroupLayout({ entries: [entries[0],
            { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 9, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            { binding: 10, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            { binding: 11, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }] });
        this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
        this.solidBind = device.createBindGroup({ layout: this.solidLayout, entries: this.surfaceBindings() });
        const module = createCheckedShaderModule(device, { label: 'Surface retained native-material presentation', code: SURFACE_FIELD_RENDER_WGSL + SURFACE_FIELD_RUNOFF_WGSL });
        await assertCheckedShaderModule(module);
        const solid = device.createPipelineLayout({ bindGroupLayouts: [this.solidLayout] }), water = device.createPipelineLayout({ bindGroupLayouts: [this.waterLayout] });
        const specs = [
            ['sky', 'fullscreenVertex', 'skyFragment', solid, true, false],
            ['solid', 'surfaceVertex', 'surfaceFragment', solid, true, false],
            ['copy', 'fullscreenVertex', 'copyFragment', water, false, false],
            ['water', 'waterVertex', 'waterFragment', water, true, false],
            ['rain', 'rainVertex', 'rainFragment', solid, true, true],
            ['runoff', 'runoffVertex', 'runoffFragment', device.createPipelineLayout({ bindGroupLayouts: [this.runoffLayout] }), true, false],
        ];
        const pipelines = await Promise.all(specs.map(async ([name, vertex, fragment, layout, depth, blend]) => [name, await device.createRenderPipelineAsync({
            label: `Surface ${name}`, layout, vertex: { module, entryPoint: vertex }, fragment: { module, entryPoint: fragment,
                targets: [{ format: this.format, ...(blend ? { blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } } : {}) }] },
            primitive: { topology: 'triangle-list', cullMode: 'none' }, ...(depth ? { depthStencil: { format: this.depthFormat, depthWriteEnabled: !['rain', 'sky'].includes(name), depthCompare: name === 'sky' ? 'always' : this.reverseZ ? 'greater-equal' : 'less-equal' } } : {}),
        })]));
        this.pipelines = Object.fromEntries(pipelines);
        this.profiler = new GPUTimestampProfiler(device, { maxPendingReads: 2, maxQueries: 16 });
        this.presentationStats.gpuTimingAvailable = this.profiler.enabled === true;
        this.log('debug', 'retained presentation ready', { bytes: this.bytes, gpuTimingAvailable: this.profiler.enabled === true, depthFormat: this.depthFormat, reverseZ: this.reverseZ });
    }
    surfaceBindings() {
        return [this.uniform, this.fields, this.meta, this.domains, this.addresses, this.liquidProperties, this.auxiliary, this.poses].map((buffer, binding) => ({ binding, resource: { buffer } }))
            .concat([{ binding: 10, resource: { buffer: this.boundFireLight } }]);
    }
    runoffBindings() {
        return [{ binding: 0, resource: { buffer: this.uniform } },
            { binding: 8, resource: this.sceneView }, { binding: 9, resource: this.sampler },
            { binding: 10, resource: { buffer: this.boundFireLight } }, { binding: 11, resource: { buffer: this.runoff } }];
    }
    bindFireLight(buffer) {
        const next = buffer || this.inertFireLight;
        if (next === this.boundFireLight) return;
        this.boundFireLight = next;
        this.solidBind = this.device.createBindGroup({ layout: this.solidLayout, entries: this.surfaceBindings() });
        if (this.sceneView) this.waterBind = this.device.createBindGroup({ layout: this.waterLayout, entries: this.surfaceBindings().concat([{ binding: 8, resource: this.sceneView }, { binding: 9, resource: this.sampler }]) });
        if (this.sceneView) this.runoffBind = this.device.createBindGroup({ layout: this.runoffLayout, entries: this.runoffBindings() });
    }
    upload(fields, { emissions = null, auxiliary = null, poses = null, liquidProperties = null, runoff = null } = {}) {
        this.alive(); if (!(fields instanceof Float32Array) || fields.length !== this.topology.count * 8 || fields.some(value => !Number.isFinite(value))) throw new RangeError('Surface presentation upload requires finite fields with eight channels');
        if (emissions) {
            if (!(emissions instanceof Float32Array) || emissions.length !== this.topology.count * 2 || emissions.some(value => !Number.isFinite(value) || value < 0)) throw new RangeError('Surface emissions need finite nonnegative native volatile and steam rates');
        }
        if (auxiliary && (!(auxiliary instanceof Float32Array) || auxiliary.length !== this.topology.count * 8 || auxiliary.some(value => !Number.isFinite(value) || value < 0))) throw new RangeError('Auxiliary surface fields require eight finite nonnegative channels');
        if (liquidProperties && (!(liquidProperties instanceof Float32Array) || liquidProperties.length !== this.topology.count * 4
            || liquidProperties.some((value, index) => !Number.isFinite(value) || value < 0 || (index % 4 === 0 || index % 4 === 3) && value > 1))) throw new RangeError('Liquid properties need finite nonnegative concentrations, temperature, depth and bounded oil coverage');
        if (runoff && (!(runoff instanceof Float32Array) || runoff.length % SURFACE_RUNOFF_STRIDE !== 0
            || runoff.length > SURFACE_RUNOFF_CAPACITY * SURFACE_RUNOFF_STRIDE || runoff.some(value => !Number.isFinite(value)))) throw new RangeError('Runoff presentation requires bounded finite parcel records');
        if (runoff) for (let i = 0; i < runoff.length; i += SURFACE_RUNOFF_STRIDE) {
            if (runoff[i + 7] < runoff[i + 3] || runoff[i + 8] <= 0 || ![0, 1].includes(runoff[i + 9])
                || runoff[i + 10] < 0 || runoff[i + 10] > 1 || runoff[i + 11] < 0 || runoff[i + 15] <= 0) throw new RangeError('Runoff presentation requires valid lifetimes, liquid phases and positive volumes');
        }
        if (poses) {
            if (!(poses instanceof Float32Array) || poses.length !== this.topology.count * 8 || poses.some(value => !Number.isFinite(value))) throw new RangeError('Rigid surface poses require eight finite channels');
            for (let i = 0; i < this.topology.count; i++) {
                const k = i * 8, visible = poses[k + 3], length = Math.hypot(poses[k + 4], poses[k + 5], poses[k + 6], poses[k + 7]);
                if ((visible !== 0 && visible !== 1) || Math.abs(length - 1) > .02) throw new RangeError('Rigid surface poses require binary visibility and unit quaternions');
            }
        }
        this.device.queue.writeBuffer(this.fields, 0, fields);
        this.sceneRevision++;
        if (!auxiliary) for (let i = 0; i < this.topology.count; i++) this.emptyAuxiliary[i * 8 + 1] = Math.max(0, fields[i * 8]);
        this.device.queue.writeBuffer(this.auxiliary, 0, auxiliary || this.emptyAuxiliary);
        this.device.queue.writeBuffer(this.poses, 0, poses || this.defaultPoses);
        if (!liquidProperties) for (let i = 0; i < this.topology.count; i++) this.defaultLiquidProperties.set([
            0, fields[i * 8 + 2], auxiliary?.[i * 8 + 1] ?? fields[i * 8], Number((auxiliary?.[i * 8] ?? 0) > 0),
        ], i * 4);
        this.device.queue.writeBuffer(this.liquidProperties, 0, liquidProperties || this.defaultLiquidProperties);
        this.runoffCount = (runoff?.length || 0) / SURFACE_RUNOFF_STRIDE;
        if (this.runoffCount) this.device.queue.writeBuffer(this.runoff, 0, runoff);
    }
    /** Consume the preceding completed timing before new paused-refinement work
     * changes its generation. The caller submits only when admission succeeds. */
    beginPresentation({ flow = null, frameMs, presentationMs = null, nowMs = performance.now(), paused = false, simulationPending = false, coupledTickWallMs = null } = {}) {
        this.alive(); if (this.queueFailure) throw this.queueFailure;
        const sample = this.gpuSample; this.gpuSample = null;
        const metrics = { cpuMs: this.lastCpuMs, gpuMs: sample?.gpuMs ?? null, gpuSamplePaused: sample?.paused ?? null,
            gpuSampleVolumeRefresh: sample?.volumeRefresh ?? null,
            passTimes: sample?.passTimes ?? {}, gpuTimingAvailable: this.profiler?.enabled === true, gpuSamplePending: Number(this.timingPending),
            queueDepth: this.queueDepth, queueDepthBeforeSubmit: this.queueDepth, queueCapacity: this.queueCapacity,
            queueThrottled: this.queueDepth >= this.queueCapacity, queueCompletionWallMs: this.queueCompletionWallMs ?? null,
            frameMs, presentationMs, displayIntervalMs: frameMs, nowMs, paused, simulationPending, coupledTickWallMs };
        // No encoding occurs when queue admission is denied. Report that zero
        // render CPU work on the next observation instead of an unknown sample
        // which would misclassify material-step wall time as rendering cost.
        this.lastCpuMs = 0; flow?.observePresentation(metrics);
        Object.assign(this.presentationStats, metrics, { submittedFrames: this.submittedFrames });
        this.presentationStarted = this.queueDepth < this.queueCapacity;
        return this.presentationStarted;
    }
    /** Called immediately after the caller submits this renderer's encoder. */
    didSubmit() {
        this.alive(); if (!this.encodedFrame) throw new Error('Surface renderer has no encoded frame to submit');
        const frame = this.encodedFrame; this.encodedFrame = null; ++this.submittedFrames; ++this.queueDepth;
        const submittedAt = performance.now();
        void this.device.queue.onSubmittedWorkDone().then(() => {
            if (!this.disposed) this.queueCompletionWallMs = performance.now() - submittedAt;
        }).catch(error => { if (!this.disposed) this.queueFailure = error; }).finally(() => { --this.queueDepth; });
        if (frame.timingQueued) {
            this.timingPending = true;
            void this.profiler.readResults().then(result => {
                if (!this.disposed) this.gpuSample = { paused: frame.paused, volumeRefresh: frame.volumeRefresh, gpuMs: result.durations.reduce((sum, value) => sum + value, 0),
                    passTimes: Object.fromEntries(result.passNames.map((name, index) => [name, result.durations[index]])) };
            }).catch(error => { if (!this.disposed) this.log('warn', 'GPU presentation timing failed', { message: error.message }); })
                .finally(() => { this.timingPending = false; });
        }
    }
    resize(width, height) {
        if (width === this.width && height === this.height) return;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > this.device.limits.maxTextureDimension2D || height > this.device.limits.maxTextureDimension2D) throw new RangeError('Invalid surface presentation viewport');
        this.sceneTexture?.destroy(); this.depthTexture?.destroy(); this._bytes -= this.textureBytes || 0;
        this.sceneTexture = null; this.depthTexture = null; this.width = 0; this.height = 0;
        try {
            this.sceneTexture = this.device.createTexture({ label: 'Surface solid refraction source', size: [width, height], format: this.format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
            this.depthTexture = this.device.createTexture({ label: 'Surface solid depth', size: [width, height], format: this.depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
            this.sceneView = this.sceneTexture.createView(); this.depthView = this.depthTexture.createView();
            this.waterBind = this.device.createBindGroup({ layout: this.waterLayout, entries: this.surfaceBindings().concat([{ binding: 8, resource: this.sceneView }, { binding: 9, resource: this.sampler }]) });
            this.runoffBind = this.device.createBindGroup({ layout: this.runoffLayout, entries: this.runoffBindings() });
            this.width = width; this.height = height; this.textureBytes = width * height * 8; this._bytes += this.textureBytes;
        } catch (error) { this.sceneTexture?.destroy(); this.depthTexture?.destroy(); this.sceneTexture = null; this.depthTexture = null; this.textureBytes = 0; throw error; }
        this.log('debug', 'presentation resized', { width, height, bytes: this.bytes });
    }
    render({ encoder, colorView, width, height, vp, eye, time = 0, rainTime = time, viewMode = 0, showSeams = false, quality = 0, tiltX = 0, tiltZ = 0, brush = null, rain = 0, rainDomain = 0, erosionScale = 1, flow = null, supports = null, camera = null, paused = false } = {}) {
        this.alive(); const started = performance.now();
        if (!encoder?.beginRenderPass || !colorView || vp?.length !== 16 || eye?.length !== 3 || ![...vp, ...eye, time, rainTime, viewMode, quality, tiltX, tiltZ].every(Number.isFinite)) throw new TypeError('Surface rendering requires a command encoder, output view and finite camera');
        const brushPosition = brush?.position ?? (brush ? [brush.x, brush.y ?? 0, brush.z] : null);
        if (brush && (brushPosition?.length !== 3 || ![...brushPosition, brush.radius].every(Number.isFinite) || brush.radius < 0)) throw new RangeError('Surface brush marker requires finite coordinates and a nonnegative radius');
        if (!Number.isFinite(rain) || rain < 0 || !Number.isInteger(rainDomain) || rainDomain < 0 || rainDomain >= this.topology.domains.length || !Number.isFinite(erosionScale) || erosionScale < 1 || erosionScale > 1000) throw new RangeError('Invalid rain domain or visual erosion scale');
        this.bindFireLight(flow?.lightBuffer); this.resize(width, height);
        // A cached frame omits the expensive volume rays. Prefer the frame
        // that refreshes them so a fixed sampling stride cannot miss that work.
        const volumeRefresh = !!flow && viewMode === 0 && (flow.snapshot?.frame !== flow.presentation?.frame
            || this.sceneRevision !== flow.presentation?.sceneRevision);
        const sampleTiming = this.presentationStarted && this.profiler?.enabled && !this.timingPending && !this.gpuSample
            && (volumeRefresh || this.submittedFrames % 8 === 0);
        const timing = sampleTiming ? label => { const sample = this.profiler.beginPass(encoder, label); return sample ? { timestampWrites: sample.timestampWrites } : {}; } : () => ({});
        flow?.encodeLighting(encoder, timing);
        const detail = quality === 0 ? 4 : quality;
        // Invert the exact packed camera used by raster vertices, including
        // when callers supply plain arrays or Float64Array matrices.
        this.f32.set(vp, 0);
        // Match the shared inverse helper's singular-matrix policy. A zero
        // inverse explicitly keeps raster depth for a degenerate projection.
        const determinant = mat4Determinant(this.f32);
        if (Number.isFinite(determinant) && Math.abs(determinant) >= 1e-6) {
            mat4Inverse(this.f32, this.inverseViewProjection);
            if (!this.inverseViewProjection.every(Number.isFinite)) this.inverseViewProjection.fill(0);
        } else this.inverseViewProjection.fill(0);
        this.f32.set([...eye, time], 16); this.f32.set([width, height, viewMode, detail], 20);
        this.f32.set([Number(showSeams), tiltX, tiltZ, rainTime], 24);
        this.f32.set(brush ? [...brushPosition, brush.radius] : [0, 0, 0, 0], 28);
        this.u32.set([this.topology.n, this.topology.count, this.topology.domains.length, Number(this.topology.seams)], 32);
        const rainDrops = rain > 0 && viewMode === 0 ? Math.min(512, Math.ceil((detail >= 4 ? 128 : detail >= 2 ? 64 : 32) * Math.sqrt(rain / .000003))) : 0;
        this.u32.set([0, rainDomain, rainDrops, Math.round(erosionScale)], 36);
        if (this.lastQuality !== quality) {
            this.lastQuality = quality;
            this.log('debug', 'presentation detail changed', { quality, nativeFlowTier: quality === 0 ? 'auto' : quality >= 5 ? 'full' : quality >= 4 ? 'high' : quality >= 2 ? 'balanced' : 'performance' });
        }
        this.device.queue.writeBuffer(this.uniform, 0, this.parameters);
        const solid = encoder.beginRenderPass({ label: 'Surface solid material pass', ...timing('Surface solids'), colorAttachments: [{ view: this.sceneView, loadOp: 'clear', storeOp: 'store', clearValue: { r: .025, g: .035, b: .05, a: 1 } }],
            depthStencilAttachment: { view: this.depthView, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: this.reverseZ ? 0 : 1 } });
        solid.setBindGroup(0, this.solidBind); solid.setPipeline(this.pipelines.sky); solid.draw(3);
        solid.setPipeline(this.pipelines.solid); solid.draw(30, this.topology.count);
        supports?.render(solid, vp, eye); solid.end();
        const copy = encoder.beginRenderPass({ label: 'Surface solid presentation', ...timing('Surface copy'), colorAttachments: [{ view: colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        copy.setBindGroup(0, this.waterBind); copy.setPipeline(this.pipelines.copy); copy.draw(3); copy.end();
        const water = encoder.beginRenderPass({ label: 'Surface water and derived source optics', ...timing('Surface liquids'), colorAttachments: [{ view: colorView, loadOp: 'load', storeOp: 'store' }],
            depthStencilAttachment: { view: this.depthView, depthLoadOp: 'load', depthStoreOp: 'store' } });
        water.setBindGroup(0, this.waterBind); water.setPipeline(this.pipelines.water); water.draw(6, this.topology.count);
        if (this.runoffCount && viewMode === 0) { water.setBindGroup(0, this.runoffBind); water.setPipeline(this.pipelines.runoff); water.draw(6, this.runoffCount); }
        if (rainDrops) { water.setBindGroup(0, this.solidBind); water.setPipeline(this.pipelines.rain); water.draw(6, rainDrops); }
        water.end();
        if (flow && viewMode === 0) flow.draw(encoder, colorView, this.depthView, { ...camera, vp, eye, width, height, quality, paused, reverseZ: this.reverseZ, sceneRevision: this.sceneRevision,
            timing, queueDepth: this.queueDepth, queueCapacity: this.queueCapacity });
        this.encodedFrame = { paused, volumeRefresh, timingQueued: sampleTiming && this.profiler.resolveAndRead(encoder) };
        this.presentationStarted = false; this.lastCpuMs = performance.now() - started;
    }
    dispose() {
        if (this.disposed) return; this.disposed = true;
        this.profiler?.destroy();
        for (const buffer of this.resources) buffer.destroy(); this.resources.clear(); this.sceneTexture?.destroy(); this.depthTexture?.destroy(); this._bytes = 0;
        this.log('debug', 'disposed retained presentation');
    }
}
