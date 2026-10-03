// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { updateSpatialCameraGesture } from '../../factory/apps/ambient-studio/spatial/SpatialResponse.js';
import { SpatialPhysics, cameraFor, hash01, radixDepthOrder } from '../../factory/apps/ambient-studio/spatial/SpatialCore.js';
import { prepareSpatialAmbientAssets } from './SpatialAmbientAssets.js';
import { SPATIAL_SPLAT_WGSL, SPATIAL_IMMERSIVE_SPLAT_WGSL, SPATIAL_PRESENT_WGSL, SPATIAL_IMMERSIVE_PRESENT_WGSL } from './SpatialAmbientShaders.js';
import { createSpatialCpuVisibility, applySpatialTreeWind } from './SpatialAmbientVisibility.js';
import { createSpatialGpuVisibility, spatialBitonicStages } from './SpatialAmbientGpuVisibility.js';
import { createSpatialMipGenerator, spatialMipLevelCount, spatialTextureBytes, spatialMediaDimensions } from './SpatialAmbientMipmaps.js';
import { createSpatialMeshShadows, spatialKeyLightDirection } from './SpatialAmbientShadows.js';
import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';
import { sampleAmbientAudioResponse, createAmbientAudioResponseState } from './AmbientAudioResponse.js';
import { createSpatialStreamingAmbientLane } from './SpatialStreamingAmbientLane.js';
import { createSpatialVideoPlayback } from './SpatialVideoPlayback.js';
import { createSpatialWaterShader } from './SpatialWaterShaders.js';
import { spatialWaterTargetPlan, spatialWaterDrawRanges, SPATIAL_WATER_MEMORY_LIMIT } from './SpatialWaterCapture.js';
import { applySpatialWaterSpray, createSpatialWaterFoamDomains } from '../../factory/apps/ambient-studio/spatial/SpatialWaterSurface.js';
import { createSpatialWaterFoam, spatialWaterFoamResourceBytes } from './SpatialWaterFoam.js';
import { createWaterFieldService } from '../../../engine/render/water/WaterFieldService.js';
import { waterFieldResourceByteSize } from '../../../engine/render/water/WaterFieldMath.js';
import { createNeutralWaterFieldBindings, WATER_FIELD_NEUTRAL_RESOURCE_BYTES } from '../../../engine/render/water/WaterFieldNeutral.js';

const U = globalThis.GPUBufferUsage ?? { COPY_DST: 8, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
const T = globalThis.GPUTextureUsage ?? { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 };
const V = globalThis.GPUShaderStage?.VERTEX ?? 1, F = globalThis.GPUShaderStage?.FRAGMENT ?? 2;
const COHORTS = 12;

/** A coordinated rendering lane. Every queue operation happens inside encode(). */
export async function createSpatialAmbientLane({ device, format, plan, assetResolver, audioProvider, signal, preparation, hostResourceBytes = 0, initialClickSerial = 0 }) {
    if (plan.source.streaming?.enabled) return createSpatialStreamingAmbientLane({ device, format, plan, assetResolver, audioProvider, signal, hostResourceBytes, initialClickSerial, createLane: createSpatialAmbientLane });
    if (Number(device.limits?.maxStorageBuffersInVertexStage ?? 3) < 3 || Number(device.limits?.maxStorageBuffersPerShaderStage ?? 3) < 3) {
        const error = new Error('Spatial wallpapers require three vertex storage buffers; the shared WebGPU device has not enabled this capability');
        error.code = 'AMBIENT_SPATIAL_GPU_CAPABILITY_UNAVAILABLE'; throw error;
    }
    const assets = await prepareSpatialAmbientAssets(plan, assetResolver, signal, preparation);
    const allocated = [];
    const retiringTargets = new Set();
    let target = null, disposed = false, gpuVisibility = null, shadows = null, videoPlayback = null, waterField = null, waterToken = null, waterFoam = null, foamToken = null;
    const own = value => { allocated.push(value); return value; };
    const dispose = () => {
        if (disposed) return; disposed = true;
        gpuVisibility?.dispose(); shadows?.dispose(); videoPlayback?.dispose(); waterFoam?.dispose(); waterField?.dispose(); assets.dispose(); target?.color.destroy(); target?.depth.destroy(); target?.opaqueColor?.destroy(); target?.opaqueDepth?.destroy(); target = null;
        for (const old of retiringTargets) { old.color.destroy(); old.depth.destroy(); old.opaqueColor.destroy(); old.opaqueDepth.destroy(); } retiringTargets.clear();
        allocated.splice(0).reverse().forEach(resource => resource.destroy?.());
        console.debug('[SpatialAmbientLane][dispose]', { projectId: plan.projectId });
    };
    try {
        const authored = plan.spatial, g = assets.geometry, n = g.count, physics = new SpatialPhysics(g);
        const versionedWater = !!g.meshWaterFlags?.some(flags => flags >= 2), drawRanges = versionedWater ? spatialWaterDrawRanges(g) : null;
        let foamDomains = versionedWater ? createSpatialWaterFoamDomains(g, 128) : null;
        const retainedFoam = !!foamDomains?.domains.length;
        if (versionedWater && Number(device.limits?.maxBindGroups ?? 4) < 4) throw new Error('Version2 finite water requires four WebGPU bind groups');
        let waterPrepared = null, waterBindings = null;
        const waterRecipe = versionedWater ? plan.source.scene.waterField : null;
        if (versionedWater && !waterRecipe && !plan.source.scene.parts.filter(part => part.visible && part.params.surfaceVersion === 2).every(part => part.params.waterOperationsVersion === 1 && part.params.waterFieldEnabled === false)) throw new TypeError('Version2 finite water has no saved field recipe');
        const immersive = authored.renderVersion === 1 || !!g.meshWind || !!g.treeWind;
        const faithful = authored.renderVersion === 1 && authored.renderProfile === 'faithful';
        const capturedMesh = faithful && plan.source.kind !== 'procedural';
        const s = faithful ? { ...authored, size: 1, opacity: 1, lighting: 0, haze: 0, paletteMix: 0, exposure: 0, shutter: 0, echoes: 0, texture: 'live', shape: 'gaussian', force: 0, idleDrift: 0, turbulence: 0 } : authored;
        const panoramic = immersive && ['equirectangular', 'cubemap-atlas'].includes(s.mediaProjection);
        const geometry = new Float32Array(n * 40), scene = new Float32Array(immersive ? 140 : 80);
        const laminaSplats = plan.source.kind === 'procedural' ? (g.splatMaterials?.reduce((count, material) => count + (material === 3 ? 1 : 0), 0) ?? 0) : 0;
        const waterVertices = plan.source.kind === 'procedural' ? (g.meshMaterials?.reduce((count, material) => count + (material === 4 ? 1 : 0), 0) ?? 0) : 0;
        const cpuVisibility = authored.renderVersion === 1 && s.visibilityBackend !== 'gpu' ? createSpatialCpuVisibility(n, s.localVisibility === true) : null;
        const mesh = buildFrameMesh(s, g, !!assets.media), frameVertices = (mesh.length - (g.mesh?.length ?? 0)) / 6;
        const metadataStride = versionedWater ? 16 : 12;
        const meshMetadata = g.meshWind || g.meshNormals || g.meshMaterials || immersive && s.surfaceDetail > 0 ? new Float32Array(mesh.length / 6 * metadataStride) : null;
        if (meshMetadata) for (let i = 0; i < (g.mesh?.length ?? 0) / 6; i++) {
            const offset = (frameVertices + i) * metadataStride; if (g.meshWind) meshMetadata.set(g.meshWind.subarray(i * 8, i * 8 + 8), offset);
            if (g.meshNormals) meshMetadata.set(g.meshNormals.subarray(i * 3, i * 3 + 3), offset + 8);
            if (versionedWater && g.meshWaterParams) meshMetadata.set(g.meshWaterParams.subarray(i * 4, i * 4 + 4), offset + 12);
        }
        if (meshMetadata) {
            const treeIds = new Set((g.trees ?? []).map(tree => tree.groupId));
            for (const range of g.meshRanges ?? []) {
                const material = treeIds.has(range.groupId) ? 2 : range.columns ? 1 : 0;
                for (let i = range.start; i < range.start + range.count; i++) meshMetadata[(frameVertices + i) * metadataStride + 11] = material;
            }
            if (g.meshMaterials) for (let i = 0; i < g.meshMaterials.length; i++) meshMetadata[(frameVertices + i) * metadataStride + 11] = g.meshMaterials[i];
            // Water normals are computed from the saved analytic waves. Its
            // unused authored normal slots carry glint, optional roughness and
            // the depth-profile marker without changing the storage stride.
            // Missing/plain profiles retain their original metadata bytes.
            if (g.meshMaterials) for (let i = 0; i < g.meshMaterials.length; i++) if (g.meshMaterials[i] === 4) {
                const offset = (frameVertices + i) * metadataStride + 8;
                meshMetadata[offset] = g.meshWaterGlint?.[i] ?? 1;
                if (plan.source.kind === 'procedural' && g.meshWaterRoughness?.[i] > 0) {
                    meshMetadata[offset + 1] = g.meshWaterRoughness[i]; meshMetadata[offset + 2] = 1;
                }
                if (versionedWater && g.meshWaterFlags?.[i] >= 2) meshMetadata[offset + 2] = g.meshWaterFlags[i];
            }
            for (const domain of foamDomains?.domains ?? []) for (let i = domain.water.meshStart; i < domain.water.meshStart + domain.water.meshCount; i++) meshMetadata[(frameVertices + i) * metadataStride + 10] += 8 * (domain.layer + 1);
        }
        const order = new Uint32Array(n), depths = new Float32Array(n), sortScratch = new Uint32Array(n), sortKeys = new Uint32Array(n), sortCounts = new Uint32Array(256);
        const shDegree = g.sphericalHarmonics?.degree ?? -1, shCoefficients = shDegree < 0 ? 1 : (shDegree + 1) ** 2;
        const shPixels = new Float32Array(Math.max(1, n * shCoefficients) * 4);
        for (let i = 0; i < n; i++) {
            order[i] = i; const at = i * 40, p = i * 3, c = i * 6;
            geometry.set([...g.anchor.subarray(p, p + 3), 1], at);
            geometry.set(g.covariance.subarray(c, c + 6), at + 4);
            geometry.set(g.uv.subarray(i * 2, i * 2 + 2), at + 10);
            geometry.set(g.colors.subarray(i * 4, i * 4 + 4), at + 12);
            geometry.set(g.tangentU?.subarray(p, p + 3) ?? [g.anchor[p + 2] * g.sourceAspect / 1.207, 0, 0], at + 16); geometry[at + 19] = i % COHORTS;
            geometry.set(g.tangentV?.subarray(p, p + 3) ?? [0, -g.anchor[p + 2] / 1.207, 0], at + 20);
            geometry[at + 23] = plan.source.kind === 'procedural' ? g.splatMaterials?.[i] ?? 0 : 0;
            geometry.set(g.normals.subarray(p, p + 3), at + 24); geometry[at + 27] = g.mobility[i];
            geometry.set([g.cols ? 1 / g.cols : .002, g.rows ? 1 / g.rows : .002, hash01(g.phaseIds?.[i] ?? g.sourceIds?.[i] ?? i), g.confidence?.[i] ?? 1], at + 28);
        }
        const waterSteadyLimit = (SPATIAL_WATER_MEMORY_LIMIT - 16 * 1024) / 2;
        if (versionedWater) {
            if (!Number.isFinite(hostResourceBytes) || hostResourceBytes < 0) throw new RangeError('Invalid shared water host reservation');
            const bufferEstimate = Math.max(160, geometry.byteLength + (meshMetadata?.byteLength ?? 0)) + Math.max(16, cpuVisibility?.order.byteLength ?? order.byteLength) + Math.max(16, shPixels.byteLength) + Math.max(16, scene.byteLength) + Math.max(16, mesh.byteLength);
            const filtered = immersive && (s.mediaFilter ?? 1) > 0;
            const textureEstimate = [assets.plate, assets.completionMask, assets.maskImage].reduce((sum, source) => {
                const canvas = source ? scaledCanvas(source.width, source.height, 1024, 1048576) : { width: 1, height: 1 };
                return sum + spatialTextureBytes(canvas.width, canvas.height, 1, spatialMipLevelCount(canvas.width, canvas.height, 'perspective', filtered));
            }, 8);
            // Finite authored water has no source-media texture; reject an
            // incompatible combined source before making GPU allocations.
            if (assets.media) throw new TypeError('Finite authored water requires a procedural scene source');
            const visibility = authored.renderVersion === 1 && s.visibilityBackend === 'gpu' ? spatialBitonicStages(n) : null;
            const visibilityBytes = visibility ? visibility.padded * 8 + 16 + (visibility.stages.length + 1) * (device.limits.minUniformBufferOffsetAlignment ?? 256) : 0;
            const shadowBytes = authored.renderVersion === 1 && !capturedMesh && s.view === 'color' && s.meshShadowStrength > 0 && g.mesh?.length ? Number(s.meshShadowMapSize ?? '1024') ** 2 * 4 + 4096 : 0;
            const baseReservation = bufferEstimate + textureEstimate + visibilityBytes + shadowBytes + (waterRecipe ? waterFieldResourceByteSize(128, waterRecipe.model).totalBytes : WATER_FIELD_NEUTRAL_RESOURCE_BYTES) + 96;
            const admissionLimit = Math.min(waterSteadyLimit, SPATIAL_WATER_MEMORY_LIMIT - hostResourceBytes);
            if (retainedFoam && baseReservation + spatialWaterFoamResourceBytes(foamDomains) > admissionLimit) foamDomains = createSpatialWaterFoamDomains(g, 64);
            const reservation = baseReservation + (retainedFoam ? spatialWaterFoamResourceBytes(foamDomains) : 0);
            if (reservation > Math.min(waterSteadyLimit, SPATIAL_WATER_MEMORY_LIMIT - hostResourceBytes)) throw new RangeError(`Finite water requires ${reservation} bytes plus ${hostResourceBytes} shared host bytes; the64MiB replacement budget cannot admit this scene`);
            waterField = waterRecipe ? await createWaterFieldService({ device, recipe: waterRecipe, maxBytes: 16 * 1024 * 1024 }) : createNeutralWaterFieldBindings({ device });
            if (waterRecipe) waterPrepared = await waterField.prepare({ time: 0, resolution: 128, origin: [0, 0] });
            waterBindings = waterField.getBindings(waterPrepared);
            if (retainedFoam) waterFoam = await createSpatialWaterFoam({ device, geometry: g, domainData: foamDomains, fieldLayout: waterBindings.layout, signal, initialClickSerial });
        }
        const buffer = (label, bytes, usage) => own(device.createBuffer({ label: `ambient-spatial-${label}`, size: Math.max(16, bytes), usage: usage | U.COPY_DST }));
        const geometryBuffer = buffer('geometry', Math.max(160, geometry.byteLength + (meshMetadata?.byteLength ?? 0)), U.STORAGE), orderBuffer = buffer('order', cpuVisibility?.order.byteLength ?? order.byteLength, U.STORAGE), shBuffer = buffer('sh', shPixels.byteLength, U.STORAGE), sceneBuffer = buffer('camera', scene.byteLength, U.UNIFORM);
        if (authored.renderVersion === 1 && s.visibilityBackend === 'gpu') gpuVisibility = await createSpatialGpuVisibility({ device, count: n, geometryBuffer, orderBuffer, sceneBuffer });
        const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', ...(immersive ? { mipmapFilter: 'linear' } : {}), addressModeU: panoramic && s.mediaProjection === 'equirectangular' ? 'repeat' : 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
        const video = assets.media?.tagName === 'VIDEO' ? assets.media : null;
        if (video) videoPlayback = createSpatialVideoPlayback(video, s);
        const historyLayers = s.texture === 'live' || !video ? 1 : COHORTS;
        const makeMediaCanvas = history => { const dimensions = spatialMediaDimensions(assets.width, assets.height, s.mediaProjection ?? 'perspective', history); return scaledCanvas(dimensions[0], dimensions[1], Infinity, Infinity); };
        const liveCanvas = !assets.media ? scaledCanvas(1, 1, 1, 1) : immersive ? makeMediaCanvas(false) : scaledCanvas(assets.width, assets.height, 1024, 1024 * 1024), historyCanvas = s.texture === 'live' || !assets.media ? scaledCanvas(1, 1, 1, 1) : immersive ? makeMediaCanvas(true) : scaledCanvas(assets.width, assets.height, 640, 300000);
        const filtered = immersive && (s.mediaFilter ?? 1) > 0, mipGenerator = filtered ? await createSpatialMipGenerator(device) : null;
        const textureInfo = new Map();
        const texture = (label, width, height, layers = 1) => { const levels = spatialMipLevelCount(width, height, label === 'live' || label === 'history' ? s.mediaProjection : 'perspective', filtered); const value = own(device.createTexture({ label: `ambient-spatial-${label}`, size: [width, height, layers], format: 'rgba8unorm', mipLevelCount: levels,
            // Compatibility devices otherwise infer '2d' when layers === 1,
            // which cannot be bound to the history sampler's 2d-array slot.
            textureBindingViewDimension: label === 'history' ? '2d-array' : '2d',
            usage: T.COPY_DST | T.TEXTURE_BINDING | T.RENDER_ATTACHMENT })); textureInfo.set(value, { width, height, layers, levels, array: label === 'history' }); return value; };
        const live = texture('live', liveCanvas.width, liveCanvas.height), history = texture('history', historyCanvas.width, historyCanvas.height, historyLayers);
        const auxiliary = [assets.plate, assets.completionMask, assets.maskImage].map((source, index) => {
            const canvas = source ? scaledCanvas(source.width, source.height, 1024, 1048576) : scaledCanvas(1, 1, 1, 1);
            const context = canvas.getContext('2d');
            if (source) context.drawImage(source, 0, 0, canvas.width, canvas.height);
            else { context.fillStyle = 'white'; context.fillRect(0, 0, 1, 1); }
            return { canvas, texture: texture(`aux-${index}`, canvas.width, canvas.height) };
        });
        const layout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
            ...[1, 2, 3].map(binding => ({ binding, visibility: V, buffer: { type: 'read-only-storage' } })),
            { binding: 4, visibility: F, sampler: { type: 'filtering' } },
            ...[5, 6, 7, 8, 9].map(binding => ({ binding, visibility: F, texture: { sampleType: 'float', viewDimension: binding === 6 ? '2d-array' : '2d' } })),
        ] });
        const captureLayout = versionedWater ? device.createBindGroupLayout({ entries: [{ binding: 0, visibility: F, texture: { sampleType: 'float' } }, { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } }, { binding: 2, visibility: F, sampler: { type: 'non-filtering' } }, ...(retainedFoam ? [{ binding: 3, visibility: F, texture: { sampleType: 'float', viewDimension: '2d-array' } }, { binding: 4, visibility: F, sampler: { type: 'filtering' } }, { binding: 5, visibility: F, buffer: { type: 'uniform' } }] : [])] }) : null;
        // One lane-owned immutable sampler is shared by current and retiring
        // capture bind groups; it adds no buffer/texture residency on resize.
        const captureDepthSampler = versionedWater ? device.createSampler({ label: 'ambient-spatial-opaque-water-depth-sampler', minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }) : null;
        const emptyLayout = versionedWater ? device.createBindGroupLayout({ entries: [] }) : null;
        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: versionedWater ? [layout, emptyLayout, waterBindings.layout, captureLayout] : [layout] });
        // The capture output must never be bound while it is attached. This
        // pipeline only needs the vertex-stage source and water-field groups.
        const depthCaptureLayout = versionedWater ? device.createPipelineLayout({ bindGroupLayouts: [layout, emptyLayout, waterBindings.layout] }) : null;
        const splatCode = immersive ? SPATIAL_IMMERSIVE_SPLAT_WGSL : SPATIAL_SPLAT_WGSL;
        const splatModule = await moduleFor(device, versionedWater ? createSpatialWaterShader(splatCode, { retainedFoam }) : splatCode, 'spatial-splat'), presentModule = await moduleFor(device, authored.renderVersion === 1 ? SPATIAL_IMMERSIVE_PRESENT_WGSL : SPATIAL_PRESENT_WGSL, 'spatial-present');
        const pipeline = async descriptor => withErrorScope(device, () => device.createRenderPipelineAsync ? device.createRenderPipelineAsync(descriptor) : device.createRenderPipeline(descriptor));
        const splatPipeline = await pipeline({ label: 'ambient-spatial-gaussians', layout: pipelineLayout,
            vertex: { module: splatModule, entryPoint: 'splatVertex' }, fragment: { module: splatModule, entryPoint: 'splatFragment', targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
            primitive: { topology: 'triangle-list' }, depthStencil: { format: versionedWater ? 'depth32float' : 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
        });
        const backingPipeline = await pipeline({ label: 'ambient-spatial-backing', layout: pipelineLayout,
            vertex: { module: splatModule, entryPoint: 'quadVertex' }, fragment: { module: splatModule, entryPoint: 'backingFragment', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' }, depthStencil: { format: versionedWater ? 'depth32float' : 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
        });
        const skyPipeline = immersive && s.skyMode === 'procedural' && !panoramic ? await pipeline({ label: 'ambient-spatial-generated-sky', layout: pipelineLayout,
            vertex: { module: splatModule, entryPoint: 'quadVertex' }, fragment: { module: splatModule, entryPoint: 'skyFragment', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' }, depthStencil: { format: versionedWater ? 'depth32float' : 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
        }) : null;
        const meshPipeline = await pipeline({ label: 'ambient-spatial-frame', layout: pipelineLayout,
            vertex: { module: splatModule, entryPoint: 'meshVertex', buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] },
            fragment: { module: splatModule, entryPoint: 'meshFragment', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' }, depthStencil: { format: versionedWater ? 'depth32float' : 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
        });
        const terrainPipeline = g.mesh?.length ? await pipeline({ label: 'ambient-spatial-terrain', layout: pipelineLayout,
            vertex: { module: splatModule, entryPoint: 'terrainMeshVertex', buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] },
            fragment: { module: splatModule, entryPoint: 'terrainMeshFragment', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' }, depthStencil: { format: versionedWater ? 'depth32float' : 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
        }) : null;
        const opaqueDepthPipeline = async entryPoint => pipeline({ label: `ambient-spatial-opaque-depth-${entryPoint}`, layout: depthCaptureLayout,
            vertex: { module: splatModule, entryPoint, buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }] },
            fragment: { module: splatModule, entryPoint: 'spatialOpaqueDepthFragment', targets: [{ format: 'r32float' }] },
            primitive: { topology: 'triangle-list' }, depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'equal' },
        });
        const frameDepthPipeline = versionedWater ? await opaqueDepthPipeline('meshVertex') : null;
        const terrainDepthPipeline = versionedWater && terrainPipeline ? await opaqueDepthPipeline('terrainMeshVertex') : null;
        const presentPipeline = await pipeline({ label: 'ambient-spatial-present', layout: 'auto', vertex: { module: presentModule, entryPoint: 'presentVertex' }, fragment: { module: presentModule, entryPoint: 'presentFragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
        const meshBuffer = buffer('frame', mesh.byteLength, U.VERTEX);
        const bindGroup = await withErrorScope(device, () => device.createBindGroup({ label: 'ambient-spatial-source-bindings', layout, entries: [
            ...[sceneBuffer, geometryBuffer, orderBuffer, shBuffer].map((resource, binding) => ({ binding, resource: { buffer: resource } })),
            { binding: 4, resource: sampler }, { binding: 5, resource: live.createView() }, { binding: 6, resource: history.createView({ dimension: '2d-array' }) },
            ...auxiliary.map((item, index) => ({ binding: 7 + index, resource: item.texture.createView() })),
        ] }));
        if (authored.renderVersion === 1 && !capturedMesh && s.view === 'color' && s.meshShadowStrength > 0 && g.mesh?.length) {
            shadows = await createSpatialMeshShadows({ device, settings: s, geometry: g, meshBuffer, sourceLayout: layout, sourceBindings: bindGroup, shaderModule: splatModule, frameVertices });
        }
        const residentBytes = [geometryBuffer, orderBuffer, shBuffer, sceneBuffer, meshBuffer].reduce((sum, value) => sum + value.size, 0)
            + [...textureInfo.values()].reduce((sum, value) => sum + spatialTextureBytes(value.width, value.height, value.layers, value.levels), 0)
            + (gpuVisibility?.bytes ?? 0) + (shadows?.bytes ?? 0) + (waterBindings?.resourceBytes ?? 0) + (waterFoam?.resourceBytes ?? 0);
        const retiringBytes = () => [...retiringTargets].reduce((sum, value) => sum + value.budget.targetBytes, 0);
        const waterLiveBytes = () => residentBytes + (target?.budget?.targetBytes ?? 0) + retiringBytes();
        let pendingResize = null, waterRenderScale = 1, waterQualityDecision = {};
        const cycles = new Int32Array(historyLayers).fill(-2147483648);
        let initialized = false, restoredState = false, lastMediaTime = null, lastSH = null, width = 2, height = 2, metrics = null, frozen = false, suspended = false, lastDisplacement = 0, geometryUploadBytes = 0, lastWaterTime = null;
        let cameraYaw = s.yaw, cameraPitch = s.pitch, cameraRig = s.cameraRig, orbitStart = null, currentCamera = null, mipPasses = 0;
        const audioResponseState = createAmbientAudioResponseState();
        let lastInputSerial = 0, discardedClickSerial = null, waterDiscardedClickSerial = null;
        const sourceContext = liveCanvas.getContext('2d'), historyContext = historyCanvas.getContext('2d');
        const uploadExternal = (source, destination, layer = 0, encoder = null) => {
            device.queue.copyExternalImageToTexture({ source, flipY: false }, { texture: destination, origin: [0, 0, layer] }, [source.width, source.height]);
            if (encoder && mipGenerator) mipPasses += mipGenerator.encode(encoder, destination, layer, textureInfo.get(destination).array);
        };
        const setSuspended = value => { suspended = !!value; frozen = suspended; if (suspended) videoPlayback?.suspend(); };
        const updateSource = (time, encoder) => {
            videoPlayback?.update(time, { frozen });
            const decoded = videoPlayback?.consumeFrame();
            const stamp = video ? decoded?.revision ?? lastMediaTime : 0;
            if (!initialized || stamp !== lastMediaTime) {
                sourceContext.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
                if (assets.media) sourceContext.drawImage(assets.media, 0, 0, liveCanvas.width, liveCanvas.height);
                else { sourceContext.fillStyle = 'white'; sourceContext.fillRect(0, 0, liveCanvas.width, liveCanvas.height); }
                uploadExternal(liveCanvas, live, 0, encoder); lastMediaTime = stamp;
            }
            // A still image has one immutable history frame. Live sampling does
            // not read history at all; only a video needs twelve temporal cohorts.
            if (s.texture === 'live' || video?.seeking || video && !decoded && lastMediaTime === null) return;
            let captured = false;
            for (let i = 0; i < historyLayers; i++) {
                const cycle = video ? Math.floor(time / s.lifetime + i / COHORTS) : 0;
                if (cycles[i] === cycle) continue;
                if (!captured) { historyContext.clearRect(0, 0, historyCanvas.width, historyCanvas.height); historyContext.drawImage(liveCanvas, 0, 0, historyCanvas.width, historyCanvas.height); captured = true; }
                uploadExternal(historyCanvas, history, i, encoder); cycles[i] = cycle;
            }
        };
        const resize = (w, h) => {
            if (disposed) return false;
            if (target?.requestedWidth === w && target?.requestedHeight === h && (!versionedWater || target.requestedScale === waterRenderScale)) return false;
            const requestedWidth = w, requestedHeight = h;
            if (versionedWater) { w = Math.max(1, Math.round(w * waterRenderScale)); h = Math.max(1, Math.round(h * waterRenderScale)); }
            const retainedBytes = retiringBytes() + (target?.budget?.targetBytes ?? 0);
            // Reserve room for a candidate and its last submitted predecessor.
            // Rapid resize predecessors remain counted until the queue drains.
            const candidateBytes = Math.min(waterSteadyLimit - residentBytes, SPATIAL_WATER_MEMORY_LIMIT - hostResourceBytes - residentBytes - retainedBytes);
            if (versionedWater && candidateBytes < 96 && target) { pendingResize = [requestedWidth, requestedHeight]; console.debug('[SpatialAmbientLane][water-resize-deferred]', { projectId: plan.projectId, retainedBytes, residentBytes }); return false; }
            const budget = versionedWater ? spatialWaterTargetPlan(w, h, residentBytes, residentBytes + candidateBytes) : null;
            if (budget) { budget.resizePeakBytes = budget.totalBytes + retainedBytes + hostResourceBytes; budget.limit = SPATIAL_WATER_MEMORY_LIMIT; budget.scaled ||= waterRenderScale < 1; budget.policyScale = waterRenderScale; }
            w = budget?.width ?? w; h = budget?.height ?? h;
            if (target?.width === w && target?.height === h) { target.requestedWidth = requestedWidth; target.requestedHeight = requestedHeight; target.requestedScale = waterRenderScale; pendingResize = null; return false; }
            let color, depth, opaqueColor, opaqueDepth;
            try {
                color = device.createTexture({ label: 'ambient-spatial-linear-target', size: [w, h], format: 'rgba16float', usage: T.TEXTURE_BINDING | T.RENDER_ATTACHMENT | (versionedWater ? T.COPY_SRC : 0) });
                depth = device.createTexture({ label: 'ambient-spatial-depth-target', size: [w, h], format: versionedWater ? 'depth32float' : 'depth24plus', usage: T.RENDER_ATTACHMENT | (shadows ? T.TEXTURE_BINDING : 0) | (versionedWater ? T.COPY_SRC : 0) });
                const colorView = color.createView(), depthView = depth.createView();
                const present = device.createBindGroup({ layout: presentPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: sceneBuffer } }, { binding: 1, resource: colorView }, { binding: 2, resource: sampler }] });
                let capture = null, foamCaptures = null;
                if (versionedWater) {
                    opaqueColor = device.createTexture({ label: 'ambient-spatial-opaque-water-color', size: [w, h], format: 'rgba16float', usage: T.COPY_DST | T.TEXTURE_BINDING });
                    opaqueDepth = device.createTexture({ label: 'ambient-spatial-opaque-water-depth', size: [w, h], format: 'r32float', usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
                    const captureEntries = [{ binding: 0, resource: opaqueColor.createView() }, { binding: 1, resource: opaqueDepth.createView() }, { binding: 2, resource: captureDepthSampler }];
                    if (waterFoam) {
                        foamCaptures = new Map(waterFoam.views.map(view => [view, device.createBindGroup({ layout: captureLayout, entries: [...captureEntries, { binding: 3, resource: view }, { binding: 4, resource: waterFoam.sampler }, { binding: 5, resource: { buffer: waterFoam.renderDomains } }] })]));
                        capture = foamCaptures.get(waterFoam.views[0]);
                    } else capture = device.createBindGroup({ layout: captureLayout, entries: captureEntries });
                }
                const previous = target; target = { width: w, height: h, requestedWidth, requestedHeight, requestedScale: waterRenderScale, color, depth, colorView, depthView, present, opaqueColor, opaqueDepth, capture, foamCaptures, budget }; width = w; height = h; pendingResize = null;
                const destroyPrevious = () => { previous?.color.destroy(); previous?.depth.destroy(); previous?.opaqueColor?.destroy(); previous?.opaqueDepth?.destroy(); };
                if (previous && versionedWater && device.queue.onSubmittedWorkDone) {
                    retiringTargets.add(previous);
                    const release = () => { if (!retiringTargets.delete(previous)) return; destroyPrevious(); if (pendingResize && !disposed) resize(...pendingResize); };
                    Promise.resolve(device.queue.onSubmittedWorkDone()).then(release, error => {
                        console.warn('[SpatialAmbientLane][water-retirement-fence-failed]', { projectId: plan.projectId, error: String(error) });
                        // A failed completion fence does not prove reclamation.
                        // Keep predecessor bytes reserved until device loss.
                        if (device.lost?.then) void device.lost.then(release);
                    });
                } else destroyPrevious();
                if (versionedWater) console.debug('[SpatialAmbientLane][water-target]', { projectId: plan.projectId, ...budget }); return true;
            } catch (error) {
                opaqueDepth?.destroy(); opaqueColor?.destroy(); depth?.destroy(); color?.destroy(); console.debug('[SpatialAmbientLane][resize-failed]', { width: w, height: h, error: error.message }); throw error;
            }
        };
        const setHostResourceBytes = value => {
            if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid shared water host reservation');
            hostResourceBytes = value;
            if (pendingResize && !disposed) resize(...pendingResize);
        };
        const encode = (encoder, targetView, clearValue, detail) => {
            if (disposed || !target) throw new Error('Spatial lane is unavailable');
            if (waterToken || foamToken) throw new Error('Finite water frame must be committed or aborted before encoding another frame');
            if (versionedWater && detail.hostResourceBytes !== undefined && detail.hostResourceBytes !== hostResourceBytes) setHostResourceBytes(detail.hostResourceBytes);
            if (versionedWater && detail.qualityDecision) {
                waterQualityDecision = detail.qualityDecision;
                const scale = Number.isFinite(waterQualityDecision.renderScale) ? Math.min(1, Math.max(.35, waterQualityDecision.renderScale)) : 1;
                if (scale !== waterRenderScale) { waterRenderScale = scale; resize(target.requestedWidth, target.requestedHeight); }
            }
            mipPasses = 0; const rawFrame = detail.frame; lastInputSerial = rawFrame.pointerState[3];
            if (!initialized && !restoredState && waterFoam && lastInputSerial > 0 && rawFrame.clickActivity[2] > Math.max(.000001,rawFrame.resolutionTime[3])) waterDiscardedClickSerial = lastInputSerial;
            if (!initialized && !restoredState && s.response && lastInputSerial > 0) discardedClickSerial = lastInputSerial;
            // Reform/Home consumes the current gesture. A decaying pulse or
            // held drag may resume only after a newly admitted pointerdown.
            const f = lastInputSerial === discardedClickSerial ? { ...rawFrame,
                pointerState: [rawFrame.pointerState[0], 0, rawFrame.pointerState[2], 0], clickActivity: [-1, -1, 60, rawFrame.clickActivity[3]] } : rawFrame;
            const time = f.resolutionTime[2]; frozen = suspended || f.effects[3] > 0;
            const waterTime = frozen && lastWaterTime !== null ? lastWaterTime : time;
            if (versionedWater && waterRecipe) { waterPrepared = waterField.prepareFrame({ time: waterTime, origin: [0, 0], qualityDecision: waterQualityDecision, update: waterTime !== lastWaterTime }); waterToken = waterField.encode(encoder, waterPrepared); }
            const orbit = updateSpatialCameraGesture(s, f, { yaw: cameraYaw, pitch: cameraPitch, cameraRig, start: orbitStart }, frozen);
            const orbiting = orbit.orbiting;
            cameraYaw = orbit.yaw; cameraPitch = orbit.pitch; cameraRig = orbit.cameraRig ?? cameraRig; orbitStart = orbit.start;
            const camera = cameraFor({ ...s, yaw: cameraYaw, pitch: cameraPitch, ...(cameraRig ? { cameraRig } : {}), cameraTime: time }, width / height, g.sourceAspect, g.center, g.baseDistance, g.referenceIntrinsics, g.cols ? { near: s.near, far: s.near + s.depth } : null);
            currentCamera = camera; const input = { pointer: [f.pointer[0], f.pointer[1], orbiting ? 0 : f.pointerState[0], .5], velocity: [f.pointer[2], f.pointer[3]], pressed: !orbiting && f.pointerState[1] > 0, dwell: f.pointerState[2], serial: f.pointerState[3], anchor: f.clickActivity.slice(0, 2), clickAge: f.clickActivity[2], suppressed: orbiting };
            if (waterFoam) {
                // The saved contact owner consumes its own canonical gesture.
                // Legacy spatial physics retains its existing initial suppression.
                const waterInput = { ...input, pointer: [rawFrame.pointer[0],rawFrame.pointer[1],orbiting ? 0 : rawFrame.pointerState[0],.5], serial: lastInputSerial === waterDiscardedClickSerial ? 0 : lastInputSerial, anchor: rawFrame.clickActivity.slice(0,2) };
                foamToken = waterFoam.encode(encoder, { time: waterTime, fieldBindings: waterBindings.bindGroup, camera, input: waterInput, frozen }); target.capture = target.foamCaptures.get(foamToken.view);
            }
            let activity = null; try { activity = audioProvider?.({ now: detail.now, time }) ?? null; } catch {}
            const audio = sampleAmbientAudioResponse(s, activity, { now: detail.now, frozen, state: audioResponseState });
            physics.step(time, s, input, camera, audio, frozen);
            const geometryChanged = !initialized || !!s.sequence || !!g.treeWind || physics.maxOffset > 0 || lastDisplacement > 0;
            lastDisplacement = physics.maxOffset;
            const covariance = physics.currentCovariance ?? g.covariance, colors = physics.currentColors ?? g.colors, normals = physics.currentNormals ?? g.normals;
            const tangentU = physics.currentTangentU ?? g.tangentU, tangentV = physics.currentTangentV ?? g.tangentV;
            for (let i = 0; i < n; i++) {
                const at = i * 40, p = i * 3;
                for (let k = 0; k < 3; k++) { geometry[at + k] = physics.anchors[p + k] + physics.offset[p + k]; geometry[at + 24 + k] = normals[p + k]; geometry[at + 32 + k] = physics.velocity[p + k]; if (tangentU) geometry[at + 16 + k] = tangentU[p + k]; if (tangentV) geometry[at + 20 + k] = tangentV[p + k]; }
                geometry.set(covariance.subarray(i * 6, i * 6 + 6), at + 4); geometry.set(colors.subarray(i * 4, i * 4 + 4), at + 12);
                depths[i] = (geometry[at] - camera.eye[0]) * camera.forward[0] + (geometry[at + 1] - camera.eye[1]) * camera.forward[1] + (geometry[at + 2] - camera.eye[2]) * camera.forward[2];
            }
            applySpatialTreeWind(geometry, g.treeWind, time);
            applySpatialWaterSpray(geometry, g, g.waterSpray, waterTime);
            if (g.treeWind || g.waterSpray) for (let i = 0; i < n; i++) { const at = i * 40; depths[i] = (geometry[at] - camera.eye[0]) * camera.forward[0] + (geometry[at + 1] - camera.eye[1]) * camera.forward[1] + (geometry[at + 2] - camera.eye[2]) * camera.forward[2]; }
            if (!gpuVisibility) radixDepthOrder(depths, order, sortScratch, sortKeys, sortCounts);
            const visibility = cpuVisibility?.encode(geometry, camera, width, height, s, order) ?? null;
            const sh = physics.currentSH ?? g.sphericalHarmonics;
            if (!initialized || sh !== lastSH || physics.currentSH) {
                if (sh) for (let i = 0; i < n * shCoefficients; i++) shPixels.set(sh.values.subarray(i * 3, i * 3 + 3), i * 4);
                device.queue.writeBuffer(shBuffer, 0, shPixels); lastSH = sh;
            }
            if (!initialized) { auxiliary.forEach(item => uploadExternal(item.canvas, item.texture, 0, encoder)); if (mesh.byteLength) device.queue.writeBuffer(meshBuffer, 0, mesh); if (meshMetadata?.byteLength) device.queue.writeBuffer(geometryBuffer, geometry.byteLength, meshMetadata); }
            updateSource(time, encoder);
            packScene(scene, s, g, camera, width, height, time, assets, shDegree, shCoefficients, plan.settings.clearColor, immersive, meshMetadata, capturedMesh);
            if (versionedWater) scene[3] = waterTime;
            geometryUploadBytes = geometryChanged ? geometry.byteLength : 0;
            if (geometryChanged) device.queue.writeBuffer(geometryBuffer, 0, geometry);
            if (!gpuVisibility) device.queue.writeBuffer(orderBuffer, 0, visibility ? cpuVisibility.order.subarray(0, visibility.count) : order); device.queue.writeBuffer(sceneBuffer, 0, scene);
            gpuVisibility?.encode(encoder);
            shadows?.encodeDepth(encoder);
            let pass = encoder.beginRenderPass({ label: 'ambient-spatial-compose', colorAttachments: [{ view: target.colorView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: target.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
            pass.setBindGroup(0, bindGroup);
            if (versionedWater) { pass.setBindGroup(2, waterBindings.bindGroup); pass.setBindGroup(3, target.capture); }
            if (skyPipeline && s.view === 'color') { pass.setPipeline(skyPipeline); pass.draw(3); }
            if (assets.media && s.view === 'color' && (panoramic || s.backing !== 'none' && s.backingOpacity > 0)) { pass.setPipeline(backingPipeline); pass.draw(3); }
            if (frameVertices && s.view !== 'coverage') { pass.setPipeline(meshPipeline); pass.setVertexBuffer(0, meshBuffer); pass.draw(frameVertices); }
            if (terrainPipeline) {
                pass.setPipeline(terrainPipeline); pass.setVertexBuffer(0, meshBuffer);
                for (const range of drawRanges?.opaque ?? g.meshRanges) if (range.count) pass.draw(range.count, 1, frameVertices + range.start, range.groupId);
            }
            if (shadows) {
                pass.end(); shadows.composite(encoder, target.colorView, target.depth, camera, width, height);
                pass = encoder.beginRenderPass({ label: 'ambient-spatial-transparent-after-shadows', colorAttachments: [{ view: target.colorView, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: target.depthView, depthLoadOp: 'load', depthStoreOp: 'store' } });
                pass.setBindGroup(0, bindGroup);
            }
            if (versionedWater) {
                pass.end();
                encoder.copyTextureToTexture({ texture: target.color }, { texture: target.opaqueColor }, [width, height]);
                // Re-rasterize only the already depth-tested opaque triangles.
                // The R32 color capture preserves their exact fragment depth;
                // depth32 remains the authoritative occlusion attachment.
                const capturePass = encoder.beginRenderPass({ label: 'ambient-spatial-opaque-depth-capture',
                    colorAttachments: [{ view: target.opaqueDepth.createView(), clearValue: { r: 1, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
                    depthStencilAttachment: { view: target.depthView, depthReadOnly: true } });
                capturePass.setBindGroup(0, bindGroup); capturePass.setBindGroup(2, waterBindings.bindGroup); capturePass.setVertexBuffer(0, meshBuffer);
                if (frameVertices && s.view !== 'coverage') { capturePass.setPipeline(frameDepthPipeline); capturePass.draw(frameVertices); }
                if (terrainDepthPipeline) { capturePass.setPipeline(terrainDepthPipeline);
                    for (const range of drawRanges.opaque) if (range.count) capturePass.draw(range.count, 1, frameVertices + range.start, range.groupId); }
                capturePass.end();
                pass = encoder.beginRenderPass({ label: 'ambient-spatial-water-after-opaque-shadows', colorAttachments: [{ view: target.colorView, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: target.depthView, depthLoadOp: 'load', depthStoreOp: 'store' } });
                pass.setBindGroup(0, bindGroup); pass.setBindGroup(2, waterBindings.bindGroup); pass.setBindGroup(3, target.capture); pass.setPipeline(terrainPipeline); pass.setVertexBuffer(0, meshBuffer);
                for (const range of drawRanges.water) if (range.count) pass.draw(range.count, 1, frameVertices + range.start, range.groupId);
                pass.end();
                pass = encoder.beginRenderPass({ label: 'ambient-spatial-transparent-after-water', colorAttachments: [{ view: target.colorView, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: target.depthView, depthLoadOp: 'load', depthStoreOp: 'store' } });
                pass.setBindGroup(0, bindGroup); pass.setBindGroup(2, waterBindings.bindGroup); pass.setBindGroup(3, target.capture);
            }
            if (!panoramic || !g.cols) {
                pass.setPipeline(splatPipeline);
                if (gpuVisibility) pass.drawIndirect(gpuVisibility.indirect, 0);
                else if (visibility?.tiles) { for (const tile of visibility.tiles) { pass.setScissorRect(tile.x, tile.y, tile.width, tile.height); pass.draw(6, tile.count, 0, tile.first); } }
                else pass.draw(6, visibility?.count ?? n);
            } pass.end();
            const present = encoder.beginRenderPass({ label: 'ambient-spatial-present', colorAttachments: [{ view: targetView, clearValue, loadOp: 'clear', storeOp: 'store' }] });
            present.setPipeline(presentPipeline); present.setBindGroup(0, target.present); present.draw(3); present.end();
            initialized = true;
            metrics = { meshShadows: !!shadows, meshShadowMapSize: shadows?.mapSize ?? 0, proceduralSky: !!skyPipeline && s.view === 'color', surfaceDetail: capturedMesh ? 0 : s.surfaceDetail ?? 0, meshLighting: capturedMesh ? 0 : immersive ? s.meshLighting ?? .65 : 0, count: n, visibleCount: visibility?.visible ?? (gpuVisibility ? null : n), culledCount: visibility?.culled ?? null, visibilityReasons: visibility?.reasons ?? null, visibilityBackend: gpuVisibility ? 'gpu' : cpuVisibility ? 'cpu' : 'legacy', visibilityOrdering: visibility?.tiles ? 'tile-local' : 'stable-global', drawInstances: visibility?.count ?? (gpuVisibility ? null : n), gpuSortDispatches: gpuVisibility?.dispatches ?? 0, mediaProjection: s.mediaProjection ?? 'perspective', mediaMipLevels: textureInfo.get(live).levels, mediaMipPasses: mipPasses, renderProfile: faithful ? 'faithful' : 'artistic', camera: cameraReceipt(camera), treeCount: g.trees?.length ?? 0, meshVertices: mesh.length / 6, steps: physics.steps, pickedId: physics.hit?.id ?? null, maxDisplacement: physics.maxOffset, covariance: true, shDegree, coverageView: s.view === 'coverage', depthKind: assets.field?.kind ?? 'authored', correctedEdges: physics.correctedEdges ?? 0, cageNodes: physics.cage?.nodes.length ?? 0, cameraYaw, cameraPitch, historyLayers: s.texture === 'live' ? 0 : historyLayers, historyBytes: historyCanvas.width * historyCanvas.height * 4 * historyLayers };
            if (versionedWater) return () => { waterToken?.commit(); waterToken = null; foamToken?.commit(); foamToken = null; lastWaterTime = waterTime; };
        };
        signal?.throwIfAborted();
        console.debug('[SpatialAmbientLane][ready]', { projectId: plan.projectId, gaussians: n, source: plan.source.kind });
        return Object.freeze({ encode, resize, dispose, setSuspended, setHostResourceBytes, retirementSettled: () => waterField?.whenSettled?.() ?? Promise.resolve(), abortFrame() { waterToken?.abort(); waterToken = null; foamToken?.abort(); foamToken = null; }, diagnostics: () => ({ ...metrics, laminaSplats, waterVertices, geometryUploadBytes, ...(versionedWater ? { waterSurfaceVersion: 2, waterField: waterField.diagnostics(), waterFoam: waterFoam?.diagnostics() ?? null, waterRefraction: g.waters.filter(water => water.surfaceVersion === 2 && water.bedReliable && water.opticsEnabled !== false).length > 0, waterRefractionMode: 'opaque-depth-supported-two-step', waterOpaqueCaptureBytes: target ? width * height * 12 : 0, waterCaptureResolution: [width,height], waterRenderScale: target ? width / target.requestedWidth : 1, waterQualityDecision, waterResourceBytes: waterLiveBytes(), waterHostResourceBytes: hostResourceBytes, waterTotalResourceBytes: waterLiveBytes() + hostResourceBytes, waterResizePeakBytes: target?.budget?.resizePeakBytes ?? residentBytes + hostResourceBytes, waterRetiringTargetBytes: retiringBytes(), waterResizeDeferred: !!pendingResize, waterResourceLimit: SPATIAL_WATER_MEMORY_LIMIT, waterTargetScaled: target?.budget?.scaled ?? false, waterfallSpraySamples: g.waters.reduce((sum, water) => sum + (water.sprayCount ?? 0), 0), waterPassOrder: ['opaque', 'opaque-shadows', 'opaque-capture', 'water', 'transparent-splats'] } : {}), ...(videoPlayback ? { ...videoPlayback.diagnostics(), mediaAssetId: plan.source.mediaAssetId } : {}) }),
            camera: () => currentCamera ? cameraReceipt(currentCamera) : null,
            captureState: () => ({ cameraYaw, cameraPitch, cameraRig, orbitStart, lastInputSerial, discardedClickSerial, waterDiscardedClickSerial, waterTime: lastWaterTime,
                ids: g.sourceIds, offset: physics.offset, velocity: physics.velocity, last: physics.last, lastSerial: physics.lastSerial, clickHit: physics.clickHit }),
            restoreState(state) {
                if (!state) return;
                restoredState = true;
                cameraYaw = state.cameraYaw; cameraPitch = state.cameraPitch; cameraRig = state.cameraRig; orbitStart = state.orbitStart;
                lastInputSerial = state.lastInputSerial; discardedClickSerial = state.discardedClickSerial; waterDiscardedClickSerial = state.waterDiscardedClickSerial ?? null;
                lastWaterTime = state.waterTime ?? null;
                physics.last = state.last; physics.lastSerial = state.lastSerial; physics.clickHit = state.clickHit;
                const previous = new Map(Array.from(state.ids, (id, index) => [id, index]));
                for (let i = 0; i < n; i++) { const index = previous.get(g.sourceIds[i]); if (index === undefined) continue; physics.offset.set(state.offset.subarray(index * 3, index * 3 + 3), i * 3); physics.velocity.set(state.velocity.subarray(index * 3, index * 3 + 3), i * 3); }
            },
            reset(detail = {}) { if (detail.physics !== false) { physics.reset(); cycles.fill(-2147483648); lastMediaTime = null; lastWaterTime = null; waterFoam?.reset(); waterDiscardedClickSerial = lastInputSerial; } if (s.response || s.cameraResponse) discardedClickSerial = lastInputSerial; cameraYaw = s.yaw; cameraPitch = s.pitch; cameraRig = s.cameraRig; orbitStart = null; },
            resourceCounts: () => ({ buffers: 5 + (gpuVisibility ? 3 : 0) + (shadows?.buffers ?? 0) + (waterField?.resourceCounts?.().buffers ?? 0) + (waterFoam?.resourceCounts?.().buffers ?? 0), textures: 5 + (target ? versionedWater ? 4 : 2 : 0) + (shadows?.textures ?? 0) + (waterField?.resourceCounts?.().textures ?? 0) + (waterFoam?.resourceCounts?.().textures ?? 0) + retiringTargets.size * 4, persistentBuffers: 5 + (gpuVisibility ? 3 : 0) + (shadows?.buffers ?? 0) + (waterField?.resourceCounts?.().buffers ?? 0) + (waterFoam?.resourceCounts?.().buffers ?? 0), persistentTextures: 5 + (shadows?.textures ?? 0) + (waterField?.resourceCounts?.().textures ?? 0) + (waterFoam?.resourceCounts?.().textures ?? 0) }),
            oneShotBudget: () => ({ operations: (waterFoam ? 1 + foamDomains.domains.length * (spatialMipLevelCount(foamDomains.resolution,foamDomains.resolution) - 1) : 0) + 12 + historyLayers + (skyPipeline ? 1 : 0) + (shadows ? 4 : 0) + (gpuVisibility?.dispatches ?? 0) + [...textureInfo.values()].reduce((sum, value) => sum + (value.levels - 1) * value.layers, 0) + (versionedWater ? 4 + (waterPrepared ? waterPrepared.resource.mipPasses.length + waterPrepared.resource.domainGroups.length * (waterPrepared.resource.fft ? 2 + waterPrepared.resource.fft.passCount : 1) : 0) : 0), bytes: versionedWater ? waterLiveBytes() : (shadows?.bytes ?? 0) + geometry.byteLength + order.byteLength + shPixels.byteLength + scene.byteLength + mesh.byteLength + liveCanvas.width * liveCanvas.height * 4 + historyCanvas.width * historyCanvas.height * 4 * historyLayers + auxiliary.reduce((sum, item) => sum + item.canvas.width * item.canvas.height * 4, 0) + (meshMetadata?.byteLength ?? 0) + (gpuVisibility?.bytes ?? 0) + [...textureInfo.values()].reduce((sum, value) => sum + spatialTextureBytes(value.width, value.height, value.layers, value.levels), 0) }),
        });
    } catch (error) { dispose(); throw error; }
}

async function moduleFor(device, code, label) {
    const module = device.createShaderModule({ code, label });
    const info = await module.getCompilationInfo?.(); const error = info?.messages?.find(message => message.type === 'error');
    if (error) throw new Error(`${label}:${error.lineNum}:${error.linePos}: ${error.message}`); return module;
}
function scaledCanvas(width, height, maxDimension, maxPixels) {
    const scale = Math.min(1, maxDimension / width, maxDimension / height, Math.sqrt(maxPixels / (width * height)));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale)); return canvas;
}
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); }
function packScene(out, s, g, camera, width, height, time, assets, shDegree, shCoefficients, background, immersive = false, meshMetadata = null, capturedMesh = false) {
    out.set([width, height, time, 0], 0); out.set([...camera.eye, s.size], 4); out.set([...camera.right, s.shutter], 8); out.set([...camera.up, s.opacity], 12); out.set([...camera.forward, s.surfaceSafety && g.cols ? s.footprintLimit : 0], 16); out.set([camera.fx, camera.fy, camera.cx, camera.cy], 20);
    out.set([['color', 'depth', 'normals', 'identity', 'confidence', 'coverage'].indexOf(s.view), ['gaussian', 'grain', 'streak'].indexOf(s.shape), ['live', 'birth', 'echo'].indexOf(s.texture), assets.media ? 1 : 0], 24);
    out.set([s.echoes, s.lighting, s.haze, s.near], 28); out.set([s.depth, s.paletteMix, s.exposure, s.depthAntialias], 32);
    const isolated = s.isolateMask && assets.plate && assets.completionMask;
    out.set([['none', 'soft', 'source', 'learned'].indexOf(s.backing), s.backingOpacity, isolated ? 1 : 0, isolated && s.backing === 'learned' && s.completionProjection === 'screen' && s.backingOpacity >= .999 && s.view === 'color' ? 1 : 0], 36);
    out.set([assets.width, assets.height, Math.max(s.near + s.depth + .1, s.completionDepth), s.backing === 'learned' && s.completionProjection === 'plane' ? 1 : 0], 40);
    const fy = 1 / (2 * Math.tan(s.fov * Math.PI / 360)); out.set([shDegree, shCoefficients, fy / g.sourceAspect, fy], 44);
    [s.paletteShadow ?? '#122b35', s.paletteMid ?? '#3e9398', s.paletteLight ?? '#e3b85b', s.paletteHighlight ?? '#fff1c4'].forEach((color, i) => out.set([...rgb(color), 1], 48 + i * 4)); out.set([...rgb(background), 1], 64);
    const K = s.depthCamera ? assets.field?.K : null;
    out.set(K ? [K[0] / assets.field.width, K[1] / assets.field.height, (K[2] + .5) / assets.field.width, (K[3] + .5) / assets.field.height] : [fy / g.sourceAspect, fy, .5, .5], 68);
    out.set([...(s.hazeColor ? rgb(s.hazeColor) : [.11, .23, .28]), 0], 72);
    // Historical shader inputs retain their exact bytes when immersive is off.
    if (immersive) out.set([...spatialKeyLightDirection(s), 0], 76);
    else if (s.lightAzimuth !== undefined || s.lightElevation !== undefined) {
        const azimuth = (s.lightAzimuth ?? -147) * Math.PI / 180, elevation = (s.lightElevation ?? 40) * Math.PI / 180;
        out.set([Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation), 0], 76);
    } else out.set([-.45, .7, -.7, 0], 76);
    if (immersive) {
        out.set([1, ['perspective', 'equirectangular', 'cubemap-atlas'].indexOf(s.mediaProjection ?? 'perspective'), s.renderProfile === 'faithful' ? 1 : 0, s.fogMode === 'distance' ? 1 : 0], 80);
        out.set([s.lodPixelRadius ?? .18, s.mediaFilter ?? 1, capturedMesh ? 0 : s.meshLighting ?? .65, 0], 84);
        out.set([s.fogDensity ?? .025, s.fogHeight ?? 0, camera.near ?? .06, camera.far ?? 100], 88);
        out.set([s.leafTransmission ?? .18, 0, 0, 0], 92); out.set([g.count * 10, meshMetadata ? 1 : 0, 0, 0], 96); out.set([0, 0, 0, 0], 100);
        out.set([...rgb(s.skyZenith ?? '#5883ad'), s.skyIntensity ?? 1], 104);
        out.set([...rgb(s.skyHorizon ?? '#d6dfd7'), s.skyHaze ?? .25], 108);
        out.set([...rgb(s.skySunColor ?? '#fff0cf'), s.skySunIntensity ?? 3], 112);
        out.set([s.skyCloudCoverage ?? .35, s.skyCloudScale ?? .6, s.skyCloudSpeed ?? .015, s.skySunRadius ?? .007], 116);
        out.set([capturedMesh ? 0 : s.surfaceDetail ?? 0, s.meshRoughness ?? .82, s.meshSpecular ?? 0, s.skyMode === 'procedural' ? 1 : 0], 120);
        ['ground', 'bark', 'stone'].forEach((material, index) => out.set([s[`${material}DetailScale`] ?? 1, s[`${material}DetailAmount`] ?? 1, s[`${material}RoughnessScale`] ?? 1, s[`${material}HighlightScale`] ?? 1], 124 + index * 4));
        out.set([s.surfaceBumpStrength ?? 1, 0, 0, 0], 136);
    }
}
function buildFrameMesh(s, g, hasSource) {
    if (!s.frame || !g.cols || s.box <= 0) return g.mesh ?? new Float32Array(0);
    const fy = 1 / (2 * Math.tan(s.fov * Math.PI / 360)), fx = fy / g.sourceAspect, z0 = s.near - .22, z1 = s.near + s.depth + .35 + s.box, color = rgb(s.frameColor), vertices = [];
    const point = (u, v, z) => [(u - .5) * z / fx, (.5 - v) * z / fy, z];
    const quad = (a, b, c, d, shade) => { for (const p of [a, b, c, a, c, d]) vertices.push(...p, ...color.map(x => x * shade)); };
    if (!hasSource || s.backing === 'none') quad(point(-.015, -.015, z1), point(1.015, -.015, z1), point(1.015, 1.015, z1), point(-.015, 1.015, z1), .19);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]], outer = [[-.035, -.022], [1.035, -.022], [1.035, 1.022], [-.035, 1.022]];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(point(...corners[i], z0), point(...corners[j], z0), point(...corners[j], z1), point(...corners[i], z1), [.58, .34, .78, .43][i]); quad(point(...outer[i], z0), point(...outer[j], z0), point(...corners[j], z0), point(...corners[i], z0), [.91, .63, .82, .71][i]); }
    if (!g.mesh?.length) return Float32Array.from(vertices);
    const mesh = new Float32Array(vertices.length + g.mesh.length); mesh.set(vertices); mesh.set(g.mesh, vertices.length); return mesh;
}

function cameraReceipt(camera) {
    const result = {}; for (const key of ['eye', 'right', 'up', 'forward', 'target', 'center', 'position']) if (camera[key]) result[key] = [...camera[key]];
    for (const key of ['fx', 'fy', 'cx', 'cy', 'distance', 'aspect', 'yaw', 'pitch', 'near', 'far', 'mode', 'projection']) if (camera[key] !== undefined) result[key] = camera[key]; return result;
}
