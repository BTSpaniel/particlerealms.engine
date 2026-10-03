// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { LEGACY_PCG32_WGSL } from '../../core/math/MathBits.js';
import { PathTracingPass } from './PathTracingPass.js';
import { restirGuidePolicyWGSL } from '../shaders/modules/chunks/restir_guide_policy.js';

const RESTIR_TEMPORAL_UNIFORM_FLOATS = 16;
const RESTIR_SPATIAL_UNIFORM_FLOATS = 16;
const RESTIR_COLOR_FORMAT = 'rgba16float';
const RESTIR_META_FORMAT = 'rgba16float';

export const RESTIR_TEMPORAL_PCG_HASH_WGSL = /* wgsl */ `
fn restirTemporalHash2(p: vec2<u32>, frameIndex: u32) -> f32 {
    return legacyPcgPixelFrameRandom24Float01(p, frameIndex, 0u);
}
`;

export const RESTIR_SPATIAL_PCG_HASH_WGSL = /* wgsl */ `
fn restirSpatialHash2(p: vec2<u32>, frameIndex: u32) -> f32 {
    return legacyPcgPixelFrameRandom24Float01(p, frameIndex, 89173u);
}
`;

const RESTIR_TEMPORAL_SHADER = /* wgsl */ `
${restirGuidePolicyWGSL}
${LEGACY_PCG32_WGSL}
${RESTIR_TEMPORAL_PCG_HASH_WGSL}

struct TemporalUniforms {
    width: f32,
    height: f32,
    frameIndex: f32,
    maxM: f32,
    temporalBlend: f32,
    depthThreshold: f32,
    historyClamp: f32,
    cameraCut: f32,
    motionScale: f32,
    guidePolicyEnabled: f32,
    pad1: f32,
    pad2: f32,
    pad3: f32,
    pad4: f32,
    pad5: f32,
    pad6: f32,
}

@group(0) @binding(0) var<uniform> u: TemporalUniforms;
@group(0) @binding(1) var candidateTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var motionTex: texture_2d<f32>;
@group(0) @binding(4) var prevReservoirColorTex: texture_2d<f32>;
@group(0) @binding(5) var prevReservoirMetaTex: texture_2d<f32>;
@group(0) @binding(6) var prevDepthTex: texture_2d<f32>;
@group(0) @binding(7) var outReservoirColor: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var outReservoirMeta: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var linearSampler: sampler;

fn luminance(c: vec3<f32>) -> f32 {
    return max(dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)), 1e-4);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = vec2<u32>(u32(u.width), u32(u.height));
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    let coord = vec2<i32>(gid.xy);
    let uv = (vec2<f32>(gid.xy) + 0.5) / vec2<f32>(u.width, u.height);
    let candidate = textureLoad(candidateTex, coord, 0).rgb;
    let currentDepthSample = textureLoad(depthTex, coord, 0);
    let currentDepth = currentDepthSample.r;
    let currentGuideValid = currentDepthSample.a > 0.5;
    let motionSample = textureSampleLevel(motionTex, linearSampler, uv, 0.0);
    let currentGuideClass = select(RESTIR_GUIDE_CLASS_DEFAULT, restirDecodeGuideClass(motionSample.b), u.guidePolicyEnabled > 0.5);
    let rawMotion = motionSample.rg * u.motionScale;
    let motion = clamp(rawMotion, vec2<f32>(-0.03), vec2<f32>(0.03));
    let motionMagnitude = length(motion);
    let historyUV = uv - motion;

    let historyInBounds = historyUV.x >= 0.0 && historyUV.x <= 1.0 && historyUV.y >= 0.0 && historyUV.y <= 1.0;
    // Screen-edge fade: reprojection (and its bilinear footprint) is unreliable near
    // the borders, where it pulls clamped edge texels — the classic screen-space
    // "leak"/smear. Fade history trust to zero within a few % of the screen edge.
    let edgeDist = min(min(historyUV.x, 1.0 - historyUV.x), min(historyUV.y, 1.0 - historyUV.y));
    let edgeFade = smoothstep(0.0, 0.06, edgeDist);
    let historyUvClamped = clamp(historyUV, vec2<f32>(0.0), vec2<f32>(1.0));
    let prevColor = textureSampleLevel(prevReservoirColorTex, linearSampler, historyUvClamped, 0.0).rgb;
    let prevMeta = textureSampleLevel(prevReservoirMetaTex, linearSampler, historyUvClamped, 0.0);
    let prevDepthSample = textureSampleLevel(prevDepthTex, linearSampler, historyUvClamped, 0.0);
    let prevDepth = prevDepthSample.r;
    let prevGuideValid = prevDepthSample.a > 0.5;
    let prevMotionSample = textureSampleLevel(motionTex, linearSampler, historyUvClamped, 0.0);
    let prevGuideClass = select(RESTIR_GUIDE_CLASS_DEFAULT, restirDecodeGuideClass(prevMotionSample.b), u.guidePolicyEnabled > 0.5);

    let currentWeight = luminance(candidate);
    let depthThreshold = mix(u.depthThreshold, u.depthThreshold * 0.5, smoothstep(0.002, 0.02, motionMagnitude));
    let historyDepthValid = abs(prevDepth - currentDepth) <= depthThreshold;
    let motionValid = motionMagnitude <= 0.04;
    let guideClassValid = restirGuideClassMatch(currentGuideClass, prevGuideClass);
    let historyValid = currentGuideValid && prevGuideValid && guideClassValid && historyInBounds && historyDepthValid && motionValid && u.cameraCut < 0.5 && prevMeta.w > 0.0;
    let motionTrust = 1.0 - smoothstep(0.002, 0.02, motionMagnitude);
    let guideHistoryScale = restirTemporalHistoryScale(currentGuideClass);
    let previousWeight = select(0.0, min(max(prevMeta.x, prevMeta.z) * u.temporalBlend * motionTrust * guideHistoryScale * edgeFade, u.historyClamp), historyValid);
    let totalWeight = currentWeight + previousWeight;
    let historyFactor = select(0.0, clamp(previousWeight / max(totalWeight, 1e-4), 0.0, 0.9), historyValid);
    let selectedColor = mix(candidate, prevColor, historyFactor);
    let selectedWeight = mix(currentWeight, max(prevMeta.z, 1e-4), historyFactor);
    let m = select(1.0, min(prevMeta.y + 1.0, u.maxM), historyValid);

    textureStore(outReservoirColor, coord, vec4<f32>(selectedColor, 1.0));
    textureStore(outReservoirMeta, coord, vec4<f32>(max(totalWeight, 1e-4), m, max(selectedWeight, 1e-4), select(0.0, 1.0, historyValid || currentWeight > 0.0)));
}
`;

const RESTIR_SPATIAL_SHADER = /* wgsl */ `
${restirGuidePolicyWGSL}
${LEGACY_PCG32_WGSL}
${RESTIR_SPATIAL_PCG_HASH_WGSL}

struct SpatialUniforms {
    width: f32,
    height: f32,
    frameIndex: f32,
    maxM: f32,
    spatialRadius: f32,
    spatialNeighbors: f32,
    depthThreshold: f32,
    normalThreshold: f32,
    estimateClamp: f32,
    guidePolicyEnabled: f32,
    pad1: f32,
    pad2: f32,
    pad3: f32,
    pad4: f32,
    pad5: f32,
    pad6: f32,
}

@group(0) @binding(0) var<uniform> u: SpatialUniforms;
@group(0) @binding(1) var inReservoirColor: texture_2d<f32>;
@group(0) @binding(2) var inReservoirMeta: texture_2d<f32>;
@group(0) @binding(3) var depthTex: texture_2d<f32>;
@group(0) @binding(4) var normalTex: texture_2d<f32>;
@group(0) @binding(5) var motionTex: texture_2d<f32>;
@group(0) @binding(6) var outReservoirColor: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var outReservoirMeta: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var outResolved: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var linearSampler: sampler;

fn luminance(c: vec3<f32>) -> f32 {
    return max(dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)), 1e-4);
}

fn decodeNormal(encoded: vec3<f32>) -> vec3<f32> {
    let n = encoded * 2.0 - 1.0;
    let len2 = dot(n, n);
    if (len2 < 1e-6) {
        return vec3<f32>(0.0, 1.0, 0.0);
    }
    return n * inverseSqrt(len2);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = vec2<u32>(u32(u.width), u32(u.height));
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    let coord = vec2<i32>(gid.xy);
    let baseColor = textureLoad(inReservoirColor, coord, 0).rgb;
    let baseMeta = textureLoad(inReservoirMeta, coord, 0);
    let baseDepthSample = textureLoad(depthTex, coord, 0);
    let baseDepth = baseDepthSample.r;
    let baseGuideValid = baseDepthSample.a > 0.5;
    let baseNormalSample = textureSampleLevel(normalTex, linearSampler, (vec2<f32>(gid.xy) + 0.5) / vec2<f32>(u.width, u.height), 0.0);
    let baseNormal = decodeNormal(baseNormalSample.xyz);
    let baseNormalGuideValid = baseNormalSample.w > 0.5;
    let baseUv = (vec2<f32>(gid.xy) + 0.5) / vec2<f32>(u.width, u.height);
    let baseMotionSample = textureSampleLevel(motionTex, linearSampler, baseUv, 0.0);
    let baseGuideClass = select(RESTIR_GUIDE_CLASS_DEFAULT, restirDecodeGuideClass(baseMotionSample.b), u.guidePolicyEnabled > 0.5);

    let baseWeight = max(baseMeta.x, luminance(baseColor));
    var accumColor = baseColor * baseWeight;
    var accumWeight = baseWeight;
    var sumM = max(baseMeta.y, 1.0);
    let maxNeighbors = i32(clamp(u.spatialNeighbors, 0.0, 8.0));
    var accepted = 0;

    for (var i = 0; i < 8; i = i + 1) {
        if (i >= maxNeighbors) {
            break;
        }

        var offset = vec2<i32>(0);
        switch(i) {
            case 0: { offset = vec2<i32>( i32(u.spatialRadius), 0); }
            case 1: { offset = vec2<i32>(-i32(u.spatialRadius), 0); }
            case 2: { offset = vec2<i32>(0,  i32(u.spatialRadius)); }
            case 3: { offset = vec2<i32>(0, -i32(u.spatialRadius)); }
            case 4: { offset = vec2<i32>( i32(u.spatialRadius),  i32(u.spatialRadius)); }
            case 5: { offset = vec2<i32>(-i32(u.spatialRadius),  i32(u.spatialRadius)); }
            case 6: { offset = vec2<i32>( i32(u.spatialRadius), -i32(u.spatialRadius)); }
            default: { offset = vec2<i32>(-i32(u.spatialRadius), -i32(u.spatialRadius)); }
        }

        let neighborCoord = clamp(coord + offset, vec2<i32>(0), vec2<i32>(dims) - vec2<i32>(1));
        let neighborColor = textureLoad(inReservoirColor, neighborCoord, 0).rgb;
        let neighborMeta = textureLoad(inReservoirMeta, neighborCoord, 0);
        let neighborDepthSample = textureLoad(depthTex, neighborCoord, 0);
        let neighborDepth = neighborDepthSample.r;
        let neighborGuideValid = neighborDepthSample.a > 0.5;
        let neighborUV = (vec2<f32>(neighborCoord) + 0.5) / vec2<f32>(u.width, u.height);
        let neighborNormalSample = textureSampleLevel(normalTex, linearSampler, neighborUV, 0.0);
        let neighborNormal = decodeNormal(neighborNormalSample.xyz);
        let neighborNormalGuideValid = neighborNormalSample.w > 0.5;
        let neighborMotionSample = textureSampleLevel(motionTex, linearSampler, neighborUV, 0.0);
        let neighborGuideClass = select(RESTIR_GUIDE_CLASS_DEFAULT, restirDecodeGuideClass(neighborMotionSample.b), u.guidePolicyEnabled > 0.5);

        let depthValid = abs(neighborDepth - baseDepth) <= u.depthThreshold;
        let normalValid = dot(baseNormal, neighborNormal) >= u.normalThreshold;
        let guideClassValid = restirGuideClassMatch(baseGuideClass, neighborGuideClass);
        let valid = baseGuideValid && baseNormalGuideValid && neighborGuideValid && neighborNormalGuideValid && guideClassValid && depthValid && normalValid && neighborMeta.w > 0.0;
        if (!valid) {
            continue;
        }

        accepted = accepted + 1;
        let normalWeight = clamp(dot(baseNormal, neighborNormal), 0.0, 1.0);
        let depthWeight = 1.0 - clamp(abs(neighborDepth - baseDepth) / max(u.depthThreshold, 1e-4), 0.0, 1.0);
        let rawNeighborWeight = max(neighborMeta.x, luminance(neighborColor)) * normalWeight * depthWeight;
        // A single half-float highlight must not dominate the whole spatial
        // reservoir. Clamp relative to the center estimate while preserving
        // genuinely bright neighborhoods; estimateClamp is exposed by config.
        let neighborWeight = min(rawNeighborWeight, max(baseWeight, 1e-4) * max(u.estimateClamp, 1.0));
        accumColor = accumColor + neighborColor * neighborWeight;
        accumWeight = accumWeight + neighborWeight;
        sumM = min(sumM + neighborMeta.y, u.maxM);
    }

    let resolved = accumColor / max(accumWeight, 1e-4);
    let spatialFactor = select(0.0, clamp(f32(accepted) / max(u.spatialNeighbors, 1.0), 0.0, 1.0) * 0.18 * restirSpatialReuseScale(baseGuideClass), baseGuideValid && baseNormalGuideValid);
    let stabilized = mix(baseColor, resolved, spatialFactor);

    textureStore(outReservoirColor, coord, vec4<f32>(stabilized, 1.0));
    textureStore(outReservoirMeta, coord, vec4<f32>(accumWeight, sumM, max(accumWeight / max(f32(accepted) + 1.0, 1.0), 1e-4), 1.0));
    textureStore(outResolved, coord, vec4<f32>(stabilized, 1.0));
}
`;

export class ReSTIRGIPass {
    constructor(device, options = {}) {
        this.vgpu = initVGPU(device);
        this.device = device;
        // Demos and engine integrations that already produce candidate radiance
        // and geometry guides should not pay for an unused PathTracingPass and
        // its render targets. The default remains backward compatible.
        this.externalCandidateOnly = options.externalCandidateOnly === true;
        this.pathTracing = this.externalCandidateOnly ? null : new PathTracingPass(device);
        this.initialized = false;
        this.enabled = true;
        this.width = 1;
        this.height = 1;
        this.frameIndex = 0;
        this.maxM = 16;
        this.temporalBlend = 0.88;
        this.depthThreshold = 0.01;
        this.historyClamp = 3.0;
        this.motionScale = 1.0;
        this.spatialRadius = 1;
        this.spatialNeighbors = 1;
        this.normalThreshold = 0.96;
        this.estimateClamp = 1.5;
        this.guidePolicyEnabled = true;
        this.currentHistoryIndex = 0;
        this.cameraCut = false;
        this.temporalPipeline = null;
        this.spatialPipeline = null;
        this.temporalUniformBuffer = null;
        this.spatialUniformBuffer = null;
        this.linearSampler = null;
        this.temporalReservoirColor = null;
        this.temporalReservoirMeta = null;
        this.reservoirColorTextures = [null, null];
        this.reservoirMetaTextures = [null, null];
        this.prevDepthTexture = null;
        this.outputTexture = null;
        this._fallbackMotionTexture = null;
        this._temporalData = new Float32Array(RESTIR_TEMPORAL_UNIFORM_FLOATS);
        this._spatialData = new Float32Array(RESTIR_SPATIAL_UNIFORM_FLOATS);
    }

    async init(width, height) {
        this.width = width;
        this.height = height;
        if (this.pathTracing) await this.pathTracing.init(width, height);
        this.temporalUniformBuffer = this.vgpu.buffer.create({ size: RESTIR_TEMPORAL_UNIFORM_FLOATS * 4, usage: 'uniform', label: 'ReSTIRGITemporalUniforms' }).buffer;
        this.spatialUniformBuffer = this.vgpu.buffer.create({ size: RESTIR_SPATIAL_UNIFORM_FLOATS * 4, usage: 'uniform', label: 'ReSTIRGISpatialUniforms' }).buffer;
        this.linearSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            label: 'ReSTIRGISampler',
        });
        const temporalModule = this.vgpu.shader.compile('restir_gi_temporal', RESTIR_TEMPORAL_SHADER);
        const spatialModule = this.vgpu.shader.compile('restir_gi_spatial', RESTIR_SPATIAL_SHADER);
        this.temporalPipeline = this.vgpu.pipeline.compute({ module: temporalModule, entryPoint: 'main', label: 'ReSTIRGI_Temporal' });
        this.spatialPipeline = this.vgpu.pipeline.compute({ module: spatialModule, entryPoint: 'main', label: 'ReSTIRGI_Spatial' });
        this._createTextures();
        this._createFallbackMotionTexture();
        this.initialized = true;
        this.updateUniforms();
        console.log(`[ReSTIRGIPass] Initialized: ${width}×${height}`);
    }

    _createTexture(label, format) {
        return this.vgpu.texture.create({
            width: this.width,
            height: this.height,
            format,
            usage: 'texture|storage|copy-src|copy-dst',
            label,
        }).texture;
    }

    _createTextures() {
        this.temporalReservoirColor?.destroy();
        this.temporalReservoirMeta?.destroy();
        this.prevDepthTexture?.destroy();
        this.outputTexture?.destroy();
        for (const texture of this.reservoirColorTextures) texture?.destroy();
        for (const texture of this.reservoirMetaTextures) texture?.destroy();
        this.temporalReservoirColor = this._createTexture('ReSTIRGI_TemporalReservoirColor', RESTIR_COLOR_FORMAT);
        this.temporalReservoirMeta = this._createTexture('ReSTIRGI_TemporalReservoirMeta', RESTIR_META_FORMAT);
        this.outputTexture = this._createTexture('ReSTIRGI_Output', RESTIR_COLOR_FORMAT);
        this.prevDepthTexture = this.vgpu.texture.create({
            width: this.width,
            height: this.height,
            format: 'rgba16float',
            usage: 'texture|copy-src|copy-dst',
            label: 'ReSTIRGI_PrevDepth',
        }).texture;
        this.reservoirColorTextures = [
            this._createTexture('ReSTIRGI_ReservoirColor0', RESTIR_COLOR_FORMAT),
            this._createTexture('ReSTIRGI_ReservoirColor1', RESTIR_COLOR_FORMAT),
        ];
        this.reservoirMetaTextures = [
            this._createTexture('ReSTIRGI_ReservoirMeta0', RESTIR_META_FORMAT),
            this._createTexture('ReSTIRGI_ReservoirMeta1', RESTIR_META_FORMAT),
        ];
        this.currentHistoryIndex = 0;
    }

    _createFallbackMotionTexture() {
        if (this._fallbackMotionTexture) {
            return;
        }
        this._fallbackMotionTexture = this.device.createTexture({
            size: [1, 1, 1],
            format: 'rgba16float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label: 'ReSTIRGI_FallbackMotion',
        });
        this.device.queue.writeTexture(
            { texture: this._fallbackMotionTexture },
            new Uint16Array([0, 0, 0, 0]),
            { bytesPerRow: 8 },
            { width: 1, height: 1, depthOrArrayLayers: 1 },
        );
    }

    resize(width, height) {
        if (width === this.width && height === this.height) {
            return;
        }
        this.width = width;
        this.height = height;
        this.pathTracing?.resize(width, height);
        if (this.initialized) {
            this._createTextures();
            this.updateUniforms();
        }
        console.log(`[ReSTIRGIPass] Resized: ${width}×${height}`);
    }

    setSize(width, height) {
        this.resize(width, height);
    }

    signalCameraCut() {
        this.cameraCut = true;
        this.frameIndex = 0;
        this.pathTracing?.signalCameraCut();
    }

    updateUniforms() {
        if (!this.temporalUniformBuffer || !this.spatialUniformBuffer) {
            return;
        }

        const temporal = this._temporalData;
        temporal[0] = this.width;
        temporal[1] = this.height;
        temporal[2] = this.frameIndex;
        temporal[3] = this.maxM;
        temporal[4] = this.temporalBlend;
        temporal[5] = this.depthThreshold;
        temporal[6] = this.historyClamp;
        temporal[7] = this.cameraCut ? 1.0 : 0.0;
        temporal[8] = this.motionScale;
        temporal[9] = this.guidePolicyEnabled ? 1.0 : 0.0;
        for (let i = 10; i < RESTIR_TEMPORAL_UNIFORM_FLOATS; i++) temporal[i] = 0.0;
        this.device.queue.writeBuffer(this.temporalUniformBuffer, 0, temporal);

        const spatial = this._spatialData;
        spatial[0] = this.width;
        spatial[1] = this.height;
        spatial[2] = this.frameIndex;
        spatial[3] = this.maxM;
        spatial[4] = this.spatialRadius;
        spatial[5] = this.spatialNeighbors;
        spatial[6] = this.depthThreshold;
        spatial[7] = this.normalThreshold;
        spatial[8] = this.estimateClamp;
        spatial[9] = this.guidePolicyEnabled ? 1.0 : 0.0;
        for (let i = 10; i < RESTIR_SPATIAL_UNIFORM_FLOATS; i++) spatial[i] = 0.0;
        this.device.queue.writeBuffer(this.spatialUniformBuffer, 0, spatial);
    }

    loadConfig(cfg) {
        if (!cfg) {
            return;
        }
        if (cfg.enabled !== undefined) this.enabled = cfg.enabled !== false;
        if (cfg.max_m !== undefined) this.maxM = Math.max(1, parseInt(cfg.max_m, 10) || 1);
        if (cfg.temporal_blend !== undefined) this.temporalBlend = Math.min(1.0, Math.max(0.0, parseFloat(cfg.temporal_blend) || 0.0));
        if (cfg.depth_threshold !== undefined) this.depthThreshold = Math.max(0.0001, parseFloat(cfg.depth_threshold) || 0.02);
        if (cfg.history_clamp !== undefined) this.historyClamp = Math.max(1.0, parseFloat(cfg.history_clamp) || 8.0);
        if (cfg.motion_scale !== undefined) this.motionScale = Math.max(0.0, parseFloat(cfg.motion_scale) || 1.0);
        if (cfg.spatial_radius !== undefined) this.spatialRadius = Math.max(1, parseInt(cfg.spatial_radius, 10) || 1);
        if (cfg.spatial_neighbors !== undefined) this.spatialNeighbors = Math.min(8, Math.max(0, parseInt(cfg.spatial_neighbors, 10) || 0));
        if (cfg.normal_threshold !== undefined) this.normalThreshold = Math.min(1.0, Math.max(0.0, parseFloat(cfg.normal_threshold) || 0.8));
        if (cfg.estimate_clamp !== undefined) this.estimateClamp = Math.max(1.0, parseFloat(cfg.estimate_clamp) || 4.0);
        if (cfg.guide_policy_enabled !== undefined) this.guidePolicyEnabled = cfg.guide_policy_enabled !== false;
        if (cfg.path_tracing) this.pathTracing?.loadConfig(cfg.path_tracing);
    }

    execute(encoder, options = {}) {
        if (!this.initialized || !encoder) {
            return this.outputTexture;
        }

        if (options.width !== undefined && options.height !== undefined) {
            this.resize(options.width, options.height);
        }

        const prevIndex = this.currentHistoryIndex;
        const nextIndex = 1 - prevIndex;
        const candidateTexture = options.candidateTexture || this.pathTracing?.execute(encoder, options);
        if (!candidateTexture) {
            throw new Error('ReSTIRGIPass requires candidateTexture when externalCandidateOnly is enabled');
        }
        if (!this.enabled) {
            this.frameIndex = (this.frameIndex + 1) % 1048576;
            this.cameraCut = false;
            return candidateTexture;
        }

        this.updateUniforms();

        const depthTexture = options.depthTexture || this.pathTracing?._fallbackDepthTexture;
        const normalTexture = options.normalTexture || this.pathTracing?._fallbackNormalTexture;
        if (!depthTexture || !normalTexture) {
            throw new Error('ReSTIRGIPass requires depthTexture and normalTexture for external candidates');
        }
        const motionTexture = options.motionTexture || this._fallbackMotionTexture;
        const prevColor = this.reservoirColorTextures[prevIndex];
        const prevMeta = this.reservoirMetaTextures[prevIndex];
        const nextColor = this.reservoirColorTextures[nextIndex];
        const nextMeta = this.reservoirMetaTextures[nextIndex];

        const temporalBindGroup = this.device.createBindGroup({
            layout: this.temporalPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.temporalUniformBuffer } },
                { binding: 1, resource: candidateTexture.createView() },
                { binding: 2, resource: depthTexture.createView() },
                { binding: 3, resource: motionTexture.createView() },
                { binding: 4, resource: prevColor.createView() },
                { binding: 5, resource: prevMeta.createView() },
                { binding: 6, resource: this.prevDepthTexture.createView() },
                { binding: 7, resource: this.temporalReservoirColor.createView() },
                { binding: 8, resource: this.temporalReservoirMeta.createView() },
                { binding: 9, resource: this.linearSampler },
            ],
        });

        const temporalPass = encoder.beginComputePass({ label: 'ReSTIRGI_Temporal' });
        temporalPass.setPipeline(this.temporalPipeline);
        temporalPass.setBindGroup(0, temporalBindGroup);
        temporalPass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
        temporalPass.end();

        const spatialBindGroup = this.device.createBindGroup({
            layout: this.spatialPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.spatialUniformBuffer } },
                { binding: 1, resource: this.temporalReservoirColor.createView() },
                { binding: 2, resource: this.temporalReservoirMeta.createView() },
                { binding: 3, resource: depthTexture.createView() },
                { binding: 4, resource: normalTexture.createView() },
                { binding: 5, resource: motionTexture.createView() },
                { binding: 6, resource: nextColor.createView() },
                { binding: 7, resource: nextMeta.createView() },
                { binding: 8, resource: this.outputTexture.createView() },
                { binding: 9, resource: this.linearSampler },
            ],
        });

        const spatialPass = encoder.beginComputePass({ label: 'ReSTIRGI_Spatial' });
        spatialPass.setPipeline(this.spatialPipeline);
        spatialPass.setBindGroup(0, spatialBindGroup);
        spatialPass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
        spatialPass.end();

        if (depthTexture) {
            encoder.copyTextureToTexture(
                { texture: depthTexture },
                { texture: this.prevDepthTexture },
                [this.width, this.height],
            );
        }

        this.currentHistoryIndex = nextIndex;
        this.frameIndex = (this.frameIndex + 1) % 1048576;
        this.cameraCut = false;
        return this.outputTexture;
    }

    getOutputTexture() {
        return this.outputTexture;
    }

    getCandidateTexture() {
        return this.pathTracing?.getOutputTexture() || null;
    }

    destroy() {
        this.pathTracing?.destroy();
        this.temporalUniformBuffer?.destroy();
        this.spatialUniformBuffer?.destroy();
        this.temporalReservoirColor?.destroy();
        this.temporalReservoirMeta?.destroy();
        this.outputTexture?.destroy();
        this.prevDepthTexture?.destroy();
        this._fallbackMotionTexture?.destroy();
        for (const texture of this.reservoirColorTextures) texture?.destroy();
        for (const texture of this.reservoirMetaTextures) texture?.destroy();
        this.initialized = false;
    }
}

export default ReSTIRGIPass;
