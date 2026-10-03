// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { OCEAN_SPECTRUM_TYPES_WGSL } from '../../../engine/render/water/OceanSpectrum.js';
import { createAmbientOceanState, AMBIENT_OCEAN_STATE_RESOURCE_BYTES } from './AmbientOceanState.js';
import { buildAmbientOceanMeshSources, AMBIENT_OCEAN_MESH_MAX_RINGS, AMBIENT_OCEAN_MESH_MAX_SEGMENTS } from './AmbientOceanMeshShaders.js';
import { createWaterFieldService } from '../../../engine/render/water/WaterFieldService.js';
import { createWaterClipmap } from '../../../engine/render/water/WaterClipmap.js';
import { packAmbientRuntimeV3FrameInputs } from '../schema/AmbientRuntimeV3Contract.js';
import { waterFieldResourceByteSize } from '../../../engine/render/water/WaterFieldMath.js';
import { writeWaterInitializationBuffer } from '../../../engine/render/water/WaterFieldInitialization.js';

/** A bounded mesh and fluid lane inside the existing ambient GPU owner. It has
 * no independent device, canvas, animation loop, or submission authority. */
export async function createAmbientOceanMeshLane({ device, format, plan, uniformBuffer, signal, hostResourceBytes = 0, initialClickSerial = 0 }) {
    const started=performance.now();
    const stage=name=>console.debug('[AmbientOcean][construction]', {name,elapsedMs:performance.now()-started,contentHash:plan.contentHash});
    stage('source');
    if (plan.recipeId !== 'mesh-ocean' || plan.executionClass !== 'mesh-ocean') throw new TypeError('Invalid mesh ocean plan.');
    const sources = buildAmbientOceanMeshSources(plan, OCEAN_SPECTRUM_TYPES_WGSL);
    const geometry = sources.waterFieldRecipe ? createWaterClipmap() : null;
    if (geometry && AMBIENT_OCEAN_STATE_RESOURCE_BYTES + geometry.bytes + 128 + waterFieldResourceByteSize(128, sources.waterFieldRecipe.model).totalBytes + hostResourceBytes > 64 * 1024 * 1024) {
        throw new RangeError('Ocean replacement exceeds the shared 64 MiB water residency budget.');
    }
    const field = sources.waterFieldRecipe ? createWaterFieldService({ device, recipe: sources.waterFieldRecipe,
        maxBytes: 32 * 1024 * 1024, logger: detail => console.debug('[AmbientOcean][field]', detail) }) : null;
    let vertexBuffer = null, indexBuffer = null, renderUniform = uniformBuffer, state = null;
    try {
    let prepared = field ? await field.prepare({ time: 0, resolution: 128 }) : null;
    stage('field-ready');
    const fieldLayout = field?.getBindings(prepared).layout;
    renderUniform = field ? device.createBuffer({ label: 'ambient-ocean-render-frame', size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) : uniformBuffer;
    if (geometry) {
        vertexBuffer = device.createBuffer({ label: 'ambient-ocean-clipmap-vertices', size: geometry.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        indexBuffer = device.createBuffer({ label: 'ambient-ocean-clipmap-indices', size: geometry.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        writeWaterInitializationBuffer(device, vertexBuffer, geometry.vertices); writeWaterInitializationBuffer(device, indexBuffer, geometry.indices);
    }
    const module = device.createShaderModule({ label: 'ambient-mesh-ocean-surface', code: sources.render });
    const presentModule = device.createShaderModule({ label: 'ambient-mesh-ocean-present', code: sources.present });
    for (const shader of [module, presentModule]) {
        const info = await shader.getCompilationInfo();
        const errors = info.messages.filter(message => message.type === 'error');
        if (errors.length) throw new Error(errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('; '));
    }
    stage('modules-ready');
    // Explicit layouts remain valid when an authored component is deleted and
    // its fallback stops reading a texture or a storage buffer.
    const renderBindings = device.createBindGroupLayout({ label: 'ambient-ocean-render-bindings', entries: [
        { binding: 0, visibility: 3, buffer: { type: 'uniform' } },
        { binding: 1, visibility: 2, texture: { sampleType: 'unfilterable-float' } },
        { binding: 2, visibility: 1, buffer: { type: 'read-only-storage' } },
    ] });
    const renderLayout = device.createPipelineLayout({ bindGroupLayouts: [renderBindings, ...(fieldLayout ? [fieldLayout] : [])] });
    const depth = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
    const pipeline = (label, vertex, fragment, extra = {}) => device.createRenderPipelineAsync({
        label, layout: renderLayout, vertex: { module, entryPoint: vertex,
            ...(geometry && vertex === 'oceanMeshVertex' ? { buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] }] } : {}) },
        fragment: { module, entryPoint: fragment, targets: [{ format: 'rgba16float', ...(extra.blend ? { blend: extra.blend } : {}) }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { ...depth, ...(extra.depthStencil ?? {}) },
    });
    const skyPipeline = await pipeline('ambient-ocean-sky', 'oceanSkyVertex', 'oceanSkyFragment', { depthStencil: { depthWriteEnabled: false, depthCompare: 'always' } });
    stage('sky-pipeline-ready');
    const meshPipeline = await pipeline('ambient-ocean-mesh', 'oceanMeshVertex', 'oceanMeshFragment');
    stage('mesh-pipeline-ready');
    const splashPipeline = await pipeline('ambient-ocean-splashes', 'oceanSplashVertex', 'oceanSplashFragment', {
        blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
    });
    const presentBindings = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: 2, buffer: { type: 'uniform' } },
        { binding: 1, visibility: 2, texture: { sampleType: 'unfilterable-float' } },
    ] });
    stage('splash-pipeline-ready');
    const presentPipeline = await device.createRenderPipelineAsync({
        label: 'ambient-ocean-present', layout: device.createPipelineLayout({ bindGroupLayouts: [presentBindings] }),
        vertex: { module: presentModule, entryPoint: 'oceanSkyVertex' },
        fragment: { module: presentModule, entryPoint: 'oceanPresent', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
    });
    state = await createAmbientOceanState({ device, uniformBuffer, functionsWGSL: sources.functions, typesWGSL: OCEAN_SPECTRUM_TYPES_WGSL, signal, waterFieldLayout: fieldLayout, initialClickSerial });
    stage('state-ready');
    let color = null, depthTexture = null, presentBind = null, width = 0, height = 0, disposed = false, simulationTime = 0, suspended = false;
    let requestedWidth = 0, requestedHeight = 0, renderScale = 1, pendingTargetBytes = 0, pendingFieldToken = null, qualityDecision = {}, targetReferenced = false;
    let fieldCandidate = null, fieldPreparation = null, fieldRetryTime = 0, fieldTransition = null;
    let fieldPreparationBytes = 0, fieldPreparationBaseBytes = 0;
    const retiredTargets = new Set();
    const targetBytes = () => width * height * 12;
    const fixedBytes = () => AMBIENT_OCEAN_STATE_RESOURCE_BYTES + (geometry?.bytes ?? 0) + (field?.resourceBytes ?? 0) + (field ? 128 : 0)
        + Math.max(0, fieldPreparationBytes - Math.max(0, (field?.resourceBytes ?? 0) - fieldPreparationBaseBytes));
    const requestFieldDetail = (time) => {
        if (!field || disposed || fieldPreparation || fieldCandidate || pendingFieldToken || time < fieldRetryTime) return;
        const pressured = ['balanced', 'performance', 'emergency'].includes(qualityDecision?.name) || qualityDecision?.queuePressure === true;
        const resolution = pressured ? 128 : qualityDecision?.waterField256Eligible === true ? 256 : prepared.resource.resolution;
        if (resolution === prepared.resource.resolution) return;
        const candidateBytes = waterFieldResourceByteSize(resolution, sources.waterFieldRecipe.model).totalBytes;
        if (fixedBytes() + targetBytes() + pendingTargetBytes + hostResourceBytes + candidateBytes > 64 * 1024 * 1024) return;
        fieldPreparationBaseBytes = field.resourceBytes; fieldPreparationBytes = candidateBytes;
        // Allocation runs after this producer's synchronous encode callback;
        // bounded initialization writes borrow the same device transfer permit.
        fieldPreparation = field.prepare({ time, resolution }).then(candidate => {
            if (disposed) return;
            fieldCandidate = candidate;
            console.debug('[AmbientOcean][detail][prepared]', { from: prepared.resource.resolution, resolution, candidateBytes });
        }).catch(error => {
            if (!disposed) { fieldRetryTime = time + 10; console.warn('[AmbientOcean][detail][failed]', error); }
        }).finally(() => { fieldPreparation = null; fieldPreparationBytes = 0; fieldPreparationBaseBytes = 0; });
    };
    const boundedTargetSize = (areaBytes, scale) => {
        const maximum = device.limits?.maxTextureDimension2D ?? 8192;
        const pixels = Math.max(4, Math.floor(areaBytes / 12));
        const fit = Math.min(scale, maximum / requestedWidth, maximum / requestedHeight, Math.sqrt(pixels / (requestedWidth * requestedHeight)));
        let w = Math.max(2, Math.floor(requestedWidth * fit));
        let h = Math.max(2, Math.floor(requestedHeight * fit));
        if (w * h > pixels) { if (w >= h) w = Math.max(2, Math.floor(pixels / h)); else h = Math.max(2, Math.floor(pixels / w)); }
        return [w, h];
    };
    const renderBinds = new Map();
    const bindForState = () => {
        const foam = state.getFoamView(), particles = state.getParticleBuffer();
        let views = renderBinds.get(foam);
        if (!views) { views = new Map(); renderBinds.set(foam, views); }
        if (!views.has(particles)) views.set(particles, device.createBindGroup({ layout: renderBindings, entries: [
            { binding: 0, resource: { buffer: renderUniform } }, { binding: 1, resource: foam }, { binding: 2, resource: { buffer: particles } },
        ] }));
        return views.get(particles);
    };
    return Object.freeze({
        executionClass: plan.executionClass, recipeId: plan.recipeId,
        canReusePlan(next) {
            return next?.recipeId === plan.recipeId && next?.executionClass === plan.executionClass
                && next?.appearance?.renderFunctions === sources.functions;
        },
        prepareFrame(frame) {
            // Integrate speed exactly once, retaining phase when the shared
            // host supplies time=0 for Still. Commit the clock only on submit.
            const dt = suspended || frame.effects[3] > 0.5 ? 0 : Math.min(0.1, Math.max(0, frame.resolutionTime[3])) * frame.tone[0];
            return { ...frame, resolutionTime: [frame.resolutionTime[0], frame.resolutionTime[1], simulationTime + dt, dt], tone: [1, ...frame.tone.slice(1)] };
        },
        setHostResourceBytes(bytes) { hostResourceBytes = Math.max(0, bytes); },
        resize(nextWidth, nextHeight) {
            if (disposed) return false;
            requestedWidth = Math.max(2, Math.floor(nextWidth)); requestedHeight = Math.max(2, Math.floor(nextHeight));
            const steadyBudget = field ? Math.min(32 * 1024 * 1024 - fixedBytes() - 16384,
                64 * 1024 * 1024 - fixedBytes() - pendingTargetBytes - hostResourceBytes) : Infinity;
            if (steadyBudget < 48) return false;
            const policyScale = field ? Math.min(renderScale, Math.sqrt(steadyBudget / (requestedWidth * requestedHeight * 12))) : 1;
            const policySize = boundedTargetSize(steadyBudget, policyScale);
            if (color && width === policySize[0] && height === policySize[1]) return false;
            const available = field ? Math.min(steadyBudget, 64 * 1024 * 1024 - fixedBytes() - pendingTargetBytes - (targetReferenced ? targetBytes() : 0) - hostResourceBytes) : Infinity;
            if (available < 48) return false;
            const budgetScale = Math.min(1, Math.sqrt(available / (requestedWidth * requestedHeight * 12)));
            const scale = Math.min(renderScale, budgetScale);
            const [w, h] = boundedTargetSize(available, scale);
            if (w === width && h === height && color) return false;
            // The host sizes once before its first encode. A quality adjustment
            // can replace those unused targets immediately; no queue references
            // exist yet, so reserving them until a fence would double residency.
            if (color && !targetReferenced) { color.destroy(); depthTexture.destroy(); color = null; depthTexture = null; width = 0; height = 0; }
            let nextColor, nextDepth;
            try {
                nextColor = device.createTexture({ label: 'ambient-ocean-color', size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
                nextDepth = device.createTexture({ label: 'ambient-ocean-depth', size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
                const nextBind = device.createBindGroup({ layout: presentBindings, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: nextColor.createView() }] });
                const oldColor = color, oldDepth = depthTexture, retiredBytes = targetBytes();
                if (oldColor) {
                    const retired = { color: oldColor, depth: oldDepth, bytes: retiredBytes }; retiredTargets.add(retired);
                    pendingTargetBytes += retiredBytes;
                    Promise.resolve(device.queue.onSubmittedWorkDone()).then(() => {
                        if (!retiredTargets.delete(retired)) return;
                        oldColor.destroy(); oldDepth.destroy(); pendingTargetBytes -= retiredBytes;
                    }).catch(error => console.warn('[AmbientOcean][targets][completion-failed]', error));
                }
                color = nextColor; depthTexture = nextDepth; presentBind = nextBind; width = w; height = h; targetReferenced = false;
                return true;
            } catch (error) { nextColor?.destroy(); nextDepth?.destroy(); throw error; }
        },
        encode(encoder, targetView, clearValue, context = {}) {
            if (disposed || !color || !targetView) return null;
            const frame = context.frame;
            if (field) {
                qualityDecision = context.qualityDecision ?? qualityDecision;
                const scale = Math.min(1, Math.max(0.35, qualityDecision?.renderScale ?? 1));
                hostResourceBytes = context.hostResourceBytes ?? hostResourceBytes;
                requestFieldDetail(frame.resolutionTime[2]);
                renderScale = scale; this.resize(requestedWidth, requestedHeight);
                device.queue.writeBuffer(renderUniform, 0, packAmbientRuntimeV3FrameInputs({ ...frame, resolutionTime: [width, height, frame.resolutionTime[2], frame.resolutionTime[3]] }));
                const snapshot = field.prepareFrame({ prepared: fieldCandidate ?? prepared, time: frame.resolutionTime[2], qualityDecision, update: !suspended && frame.effects[3] <= 0.5 });
                pendingFieldToken = field.encode(encoder, snapshot);
            }
            const commit = state.encode(encoder, {
                ...context, simulationTime: (frame?.resolutionTime?.[2] ?? 0) * (frame?.tone?.[0] ?? 1),
                deltaSeconds: (frame?.resolutionTime?.[3] ?? 0) * (frame?.tone?.[0] ?? 1),
                paused: (frame?.effects?.[3] ?? 0) > 0.5,
                waterFieldBindGroup: pendingFieldToken?.bindGroup,
            });
            targetReferenced = true;
            const surface = encoder.beginRenderPass({ label: 'ambient-ocean-sky-mesh-splashes',
                colorAttachments: [{ view: color.createView(), clearValue, loadOp: 'clear', storeOp: 'store' }],
                depthStencilAttachment: { view: depthTexture.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
            });
            surface.setBindGroup(0, bindForState());
            if (field) surface.setBindGroup(1, pendingFieldToken.bindGroup);
            surface.setPipeline(skyPipeline); surface.draw(3);
            surface.setPipeline(meshPipeline);
            if (geometry) { surface.setVertexBuffer(0, vertexBuffer); surface.setIndexBuffer(indexBuffer, 'uint32'); surface.drawIndexed(geometry.indices.length); }
            else surface.draw(AMBIENT_OCEAN_MESH_MAX_RINGS * AMBIENT_OCEAN_MESH_MAX_SEGMENTS * 6);
            surface.setPipeline(splashPipeline); surface.draw(6, 256); surface.end();
            const present = encoder.beginRenderPass({ label: 'ambient-ocean-present', colorAttachments: [{ view: targetView, clearValue, loadOp: 'clear', storeOp: 'store' }] });
            present.setPipeline(presentPipeline); present.setBindGroup(0, presentBind); present.draw(3); present.end();
            return () => {
                const submitted = pendingFieldToken;
                submitted?.commit(); pendingFieldToken = null;
                if (fieldCandidate && submitted?.resource === fieldCandidate.resource) {
                    const previous = prepared; prepared = fieldCandidate; fieldCandidate = null;
                    fieldTransition = { from: previous.resource.resolution, to: prepared.resource.resolution, time: frame.resolutionTime[2] };
                    void field.retire(previous, device.queue.onSubmittedWorkDone()).catch(error => console.warn('[AmbientOcean][detail][retire-failed]', error));
                    console.debug('[AmbientOcean][detail][committed]', fieldTransition);
                }
                const result = commit?.(); if (result !== false) simulationTime = (frame?.resolutionTime?.[2] ?? simulationTime) * (frame?.tone?.[0] ?? 1); return result;
            };
        },
        abortFrame: () => { pendingFieldToken?.abort(); pendingFieldToken = null; return state.abortFrame(); },
        reset: () => { simulationTime = 0; return state.reset(); },
        setSuspended(value) { suspended = value === true; state.setSuspended(value); },
        oneShotBudget: () => ({ operations: 1 + (field ? 5 : 0), bytes: 1280 + (field ? 480 : 0) }),
        resources: () => state.resources(),
        retirementSettled: () => field?.whenSettled() ?? Promise.resolve(),
        diagnostics: () => ({ ...state.diagnostics(), geometry: geometry ? 'indexed-stitched-clipmap' : 'camera-spaced-triangle-mesh', maximumTriangles: geometry ? geometry.indices.length / 3 : AMBIENT_OCEAN_MESH_MAX_RINGS * AMBIENT_OCEAN_MESH_MAX_SEGMENTS * 2, depthTest: true, width, height,
            waterField: field?.diagnostics() ?? null, fieldPreparing: fieldPreparation !== null, fieldTransition, residentBytes: fixedBytes() + targetBytes() + pendingTargetBytes, hostResourceBytes, pendingTargetBytes, renderScale: requestedWidth ? width / requestedWidth : 1, qualityDecision }),
        resourceCounts() { if (disposed) return Object.freeze({ buffers: 0, textures: 0, persistentBuffers: 0, persistentTextures: 0 }); const counts = state.resourceCounts(), fields = field?.resourceCounts() ?? { buffers: 0, textures: 0 }; return Object.freeze({ ...counts, buffers: counts.buffers + fields.buffers + (geometry ? 3 : 0), textures: counts.textures + fields.textures + (color ? 2 : 0) }); },
        dispose() {
            if (disposed) return false;
            disposed = true; pendingFieldToken?.abort(); state.dispose(); field?.dispose(); vertexBuffer?.destroy(); indexBuffer?.destroy(); if (field) renderUniform.destroy(); color?.destroy(); depthTexture?.destroy();
            for (const retired of retiredTargets) { retired.color.destroy(); retired.depth.destroy(); }
            retiredTargets.clear(); pendingTargetBytes = 0; color = null; depthTexture = null; presentBind = null; renderBinds.clear(); return true;
        },
    });
    } catch (error) {
        state?.dispose(); field?.dispose(); vertexBuffer?.destroy(); indexBuffer?.destroy(); if (renderUniform !== uniformBuffer) renderUniform.destroy();
        console.warn('[AmbientOcean][create][failed]', error); throw error;
    }
}
