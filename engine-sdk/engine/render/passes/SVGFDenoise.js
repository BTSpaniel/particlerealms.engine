// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SVGFDenoise.js - Spatiotemporal Variance-Guided Filtering
 * 
 * Full SVGF denoising pipeline for compute-based path tracing / GI.
 * Converts noisy 1-spp (or low-spp) input into clean output.
 * 
 * Based on:
 *   - "Spatiotemporal Variance-Guided Filtering" (Schied et al., HPG 2017)
 *   - NVIDIA SVGF implementation techniques
 *   - À-Trous wavelet decomposition with edge-stopping functions
 * 
 * Pipeline (per frame):
 *   1. Temporal Accumulation: Reproject history, blend with current, track variance
 *   2. Variance Estimation: Compute spatial variance from accumulated moments
 *   3. À-Trous Wavelet Filter: 1-5 iterations of edge-preserving spatial blur
 *      - Edge-stopping by normal, depth, luminance, and variance
 *      - Increasing step size each iteration (1, 2, 4, 8, 16)
 *      - Firefly suppression via luminance clamping
 * 
 * Inputs Required:
 *   - Noisy color (1-spp path trace output)
 *   - World-space normals
 *   - Linear depth
 *   - Motion vectors
 * 
 * Outputs:
 *   - Denoised color (rgba16float)
 *   - Accumulated variance (for adaptive sampling feedback)
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// ============================================================================
// WGSL SHADERS
// ============================================================================

const SVGF_TEMPORAL_SHADER = /* wgsl */ `
// Pass 1: Temporal Accumulation
// Reprojects history, accumulates color moments, estimates per-pixel variance

struct SVGFTemporalUniforms {
    width: f32,
    height: f32,
    frameIndex: f32,
    maxAccumFrames: f32,
    colorPhiLuminance: f32,
    depthThreshold: f32,
    normalThreshold: f32,
    cameraCut: f32,
}

@group(0) @binding(0) var<uniform> u: SVGFTemporalUniforms;
@group(0) @binding(1) var noisyColor: texture_2d<f32>;       // Current noisy input
@group(0) @binding(2) var normalTex: texture_2d<f32>;         // Current normals
@group(0) @binding(3) var depthTex: texture_2d<f32>;          // Current depth
@group(0) @binding(4) var motionTex: texture_2d<f32>;         // Motion vectors
@group(0) @binding(5) var historyColor: texture_2d<f32>;      // Previous accumulated color
@group(0) @binding(6) var historyMoments: texture_2d<f32>;    // Previous moments (mean, mean², count)
@group(0) @binding(7) var prevNormalTex: texture_2d<f32>;     // Previous normals
@group(0) @binding(8) var prevDepthTex: texture_2d<f32>;      // Previous depth
@group(0) @binding(9) var outColor: texture_storage_2d<rgba16float, write>;   // Accumulated color
@group(0) @binding(10) var outMoments: texture_storage_2d<rgba16float, write>; // Updated moments
@group(0) @binding(11) var linearSampler: sampler;

fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn isReprojectionValid(historyUV: vec2<f32>, currentGuide: vec4<f32>, currentDepth: f32,
                       dims: vec2<i32>) -> bool {
    // Bounds check
    if (historyUV.x < 0.0 || historyUV.x > 1.0 || historyUV.y < 0.0 || historyUV.y > 1.0) {
        return false;
    }

    let histCoord = vec2<i32>(historyUV * vec2<f32>(dims));
    let hc = clamp(histCoord, vec2<i32>(0), dims - vec2<i32>(1));

    // Normal consistency
    let prevGuide = textureLoad(prevNormalTex, hc, 0);
    if (abs(currentGuide.a - prevGuide.a) > 0.0005) {
        return false;
    }
    let currentNormal = currentGuide.rgb * 2.0 - 1.0;
    let prevNormal = prevGuide.rgb * 2.0 - 1.0;
    let normalDot = dot(currentNormal, prevNormal);
    if (normalDot < u.normalThreshold) {
        return false;
    }

    // Depth consistency
    let prevDepth = textureLoad(prevDepthTex, hc, 0).r;
    let depthDiff = abs(currentDepth - prevDepth) / max(currentDepth, 0.0001);
    if (depthDiff > u.depthThreshold) {
        return false;
    }

    return true;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let coord = vec2<i32>(gid.xy);
    let dims = vec2<i32>(i32(u.width), i32(u.height));
    if (coord.x >= dims.x || coord.y >= dims.y) { return; }

    let uv = (vec2<f32>(coord) + 0.5) / vec2<f32>(u.width, u.height);

    // Current frame data
    var currentColor = max(textureLoad(noisyColor, coord, 0).rgb, vec3<f32>(0.0));
    let currentGuide = textureLoad(normalTex, coord, 0);
    let currentDepth = textureLoad(depthTex, coord, 0).r;
    let motion = textureLoad(motionTex, coord, 0).rg;
    var currentLum = luminance(currentColor);

    // Reproject
    let historyUV = uv - motion;

    var accumColor = currentColor;
    var accumMoment1 = currentLum;
    var accumMoment2 = currentLum * currentLum;
    var historyLength = 1.0;

    if (u.cameraCut < 0.5 && isReprojectionValid(historyUV, currentGuide, currentDepth, dims)) {
        // Sample history
        let prevColor = textureSampleLevel(historyColor, linearSampler, historyUV, 0.0).rgb;
        let prevMoments = textureSampleLevel(historyMoments, linearSampler, historyUV, 0.0);
        let prevCount = prevMoments.b;

        // Reject rare high-energy Monte Carlo outliers against the temporal
        // luminance distribution. This targets fireflies without widening the
        // spatial kernel or softening geometric/material edges.
        let previousVariance = max(prevMoments.g - prevMoments.r * prevMoments.r, 0.0004);
        let fireflyCeiling = prevMoments.r + 5.0 * sqrt(previousVariance) + 0.35;
        if (currentLum > fireflyCeiling) {
            currentColor *= fireflyCeiling / max(currentLum, 0.0001);
            currentLum = fireflyCeiling;
        }

        // Accumulation count (capped)
        historyLength = min(prevCount + 1.0, u.maxAccumFrames);

        // Exponential moving average blend factor
        let alpha = 1.0 / historyLength;

        // Blend color
        accumColor = mix(prevColor, currentColor, alpha);

        // Update moments for variance estimation
        accumMoment1 = mix(prevMoments.r, currentLum, alpha);
        accumMoment2 = mix(prevMoments.g, currentLum * currentLum, alpha);
    }

    // Compute variance from moments: Var = E[X²] - E[X]²
    let variance = max(accumMoment2 - accumMoment1 * accumMoment1, 0.0);

    textureStore(outColor, coord, vec4<f32>(accumColor, variance));
    textureStore(outMoments, coord, vec4<f32>(accumMoment1, accumMoment2, historyLength, 0.0));
}
`;

const SVGF_ATROUS_SHADER = /* wgsl */ `
// Pass 2: À-Trous Wavelet Filter (run 3-5 times with increasing step size)
// Edge-preserving spatial filter guided by normals, depth, and luminance variance

struct ATrousUniforms {
    width: f32,
    height: f32,
    stepSize: f32,     // 1, 2, 4, 8, 16 for each iteration
    sigmaLuminance: f32,
    sigmaNormal: f32,
    sigmaDepth: f32,
    iteration: f32,    // Current iteration index (0-4)
    _pad: f32,
}

@group(0) @binding(0) var<uniform> u: ATrousUniforms;
@group(0) @binding(1) var inputColor: texture_2d<f32>;   // Color + variance in alpha
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var depthTex: texture_2d<f32>;
@group(0) @binding(4) var outputColor: texture_storage_2d<rgba16float, write>;

fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// 5x5 À-Trous kernel weights (B3 spline)
fn getKernelWeight(dx: i32, dy: i32) -> f32 {
    let weights = array<f32, 25>(
        1.0/256.0,  4.0/256.0,  6.0/256.0,  4.0/256.0, 1.0/256.0,
        4.0/256.0, 16.0/256.0, 24.0/256.0, 16.0/256.0, 4.0/256.0,
        6.0/256.0, 24.0/256.0, 36.0/256.0, 24.0/256.0, 6.0/256.0,
        4.0/256.0, 16.0/256.0, 24.0/256.0, 16.0/256.0, 4.0/256.0,
        1.0/256.0,  4.0/256.0,  6.0/256.0,  4.0/256.0, 1.0/256.0
    );
    return weights[(dy + 2) * 5 + (dx + 2)];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let coord = vec2<i32>(gid.xy);
    let dims = vec2<i32>(i32(u.width), i32(u.height));
    if (coord.x >= dims.x || coord.y >= dims.y) { return; }

    let maxC = dims - vec2<i32>(1);
    let step = i32(u.stepSize);

    // Center pixel data
    let centerSample = textureLoad(inputColor, coord, 0);
    let centerColor = centerSample.rgb;
    let centerVariance = centerSample.a;
    let centerLum = luminance(centerColor);
    let centerGuide = textureLoad(normalTex, coord, 0);
    let centerNormal = centerGuide.rgb * 2.0 - 1.0;
    let centerDepth = textureLoad(depthTex, coord, 0).r;

    // Variance-driven luminance sigma (more blur where noisy)
    let sigmaL = u.sigmaLuminance * sqrt(max(centerVariance, 0.0004)) + 0.0001;

    var colorSum = vec3<f32>(0.0);
    var varianceSum = 0.0;
    var weightSum = 0.0;

    // 5x5 À-Trous filter with edge stopping
    for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
            let sampleCoord = clamp(coord + vec2<i32>(dx, dy) * step, vec2<i32>(0), maxC);

            let sampleData = textureLoad(inputColor, sampleCoord, 0);
            let sampleColor = sampleData.rgb;
            let sampleVariance = sampleData.a;
            let sampleLum = luminance(sampleColor);
            let sampleGuide = textureLoad(normalTex, sampleCoord, 0);
            let sampleNormal = sampleGuide.rgb * 2.0 - 1.0;
            let sampleDepth = textureLoad(depthTex, sampleCoord, 0).r;

            // Kernel weight
            let kw = getKernelWeight(dx, dy);

            // Luminance edge stopping (variance-guided)
            let lumDiff = abs(centerLum - sampleLum);
            let wLum = exp(-lumDiff / sigmaL);

            // Normal edge stopping
            let normalDiff = max(1.0 - dot(centerNormal, sampleNormal), 0.0);
            let wNormal = exp(-normalDiff / u.sigmaNormal);

            // Depth edge stopping (gradient-aware)
            let depthDiff = abs(centerDepth - sampleDepth);
            let depthGradient = max(abs(centerDepth), 0.0001);
            let wDepth = exp(-depthDiff / (u.sigmaDepth * depthGradient));

            // Combined weight
            let materialMatch = select(0.0, 1.0, abs(centerGuide.a - sampleGuide.a) <= 0.0005);
            let w = kw * wLum * wNormal * wDepth * materialMatch;

            colorSum += sampleColor * w;
            varianceSum += sampleVariance * w * w; // Variance propagation
            weightSum += w;
        }
    }

    let filteredColor = colorSum / max(weightSum, 0.0001);
    let filteredVariance = varianceSum / max(weightSum * weightSum, 0.0001);

    textureStore(outputColor, coord, vec4<f32>(filteredColor, filteredVariance));
}
`;

// ============================================================================
// SVGF DENOISE CLASS
// ============================================================================

export class SVGFDenoise {
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.initialized = false;
        this.enabled = true;

        // Settings
        this.maxAccumFrames = 32;    // Max temporal accumulation frames
        this.atrousIterations = 5;   // Number of spatial filter passes (3-5)
        this.sigmaLuminance = 4.0;   // Luminance edge-stopping sensitivity
        this.sigmaNormal = 0.1;      // Normal edge-stopping sensitivity
        this.sigmaDepth = 0.05;      // Depth edge-stopping sensitivity
        this.colorPhiLuminance = 1.0;
        this.depthThreshold = 0.1;
        this.normalThreshold = 0.9;

        // Pipelines
        this.temporalPipeline = null;
        this.atrousPipeline = null;

        // Textures - temporal
        this.accumColorTextures = [null, null]; // ping-pong
        this.momentsTextures = [null, null];    // ping-pong
        this.prevNormalTexture = null;
        this.prevDepthTexture = null;
        this.currentHistoryIndex = 0;

        // Textures - spatial (ping-pong for à-trous iterations)
        this.atrousTextures = [null, null];

        // Buffers
        this.temporalUniformBuffer = null;
        this.atrousUniformBuffers = []; // One per iteration
        this.sampler = null;

        // Bind groups and texture views are stable until an input/output texture
        // or an internal resource epoch changes. Keep them out of the frame loop.
        this._executionResources = null;
        this._temporalBindGroups = [null, null];
        this._atrousBindGroups = [[], []];
        this._internalViews = null;

        // Dimensions
        this.width = 0;
        this.height = 0;

        // State
        this.frameIndex = 0;
        this.cameraCut = false;

        // Pre-allocated
        this._temporalData = new Float32Array(8);
    }

    /**
     * Initialize SVGF denoiser
     */
    async init(width, height) {
        if (!Number.isInteger(this.atrousIterations) || this.atrousIterations < 1 || this.atrousIterations > 5) {
            throw new RangeError('SVGF atrousIterations must be an integer from 1 through 5');
        }
        this.width = width;
        this.height = height;

        // Compile shaders
        const temporalModule = this.vgpu.shader.compile('svgf_temporal', SVGF_TEMPORAL_SHADER);
        const atrousModule = this.vgpu.shader.compile('svgf_atrous', SVGF_ATROUS_SHADER);
        const modules = [temporalModule, atrousModule];
        const diagnostics = await Promise.all(modules.map(async module => {
            if (typeof module.getCompilationInfo !== 'function') return [];
            const info = await module.getCompilationInfo();
            return info.messages.filter(message => message.type === 'error');
        }));
        const errors = diagnostics.flat();
        if (errors.length) {
            throw new Error(`SVGF shader compilation failed: ${errors.map(error => error.message).join('; ')}`);
        }

        // Create pipelines
        this.temporalPipeline = this.vgpu.pipeline.compute({
            module: temporalModule, entryPoint: 'main', label: 'SVGF_Temporal'
        });
        this.atrousPipeline = this.vgpu.pipeline.compute({
            module: atrousModule, entryPoint: 'main', label: 'SVGF_ATrous'
        });

        // Sampler
        this.sampler = this.device.createSampler({
            magFilter: 'linear', minFilter: 'linear',
            addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
            label: 'SVGF_Sampler',
        });

        // Uniform buffers
        this.temporalUniformBuffer = this.vgpu.buffer.create({
            size: 32, usage: 'uniform', label: 'SVGF_TemporalUniforms'
        }).buffer;

        // One uniform buffer per à-trous iteration
        this._createAtrousUniformBuffers();

        // Create textures
        this._createTextures();
        this._writeAtrousUniforms();

        this.initialized = true;
        console.log(`[SVGF] Initialized: ${width}×${height}, ${this.atrousIterations} filter iterations`);
    }

    _createTextures() {
        const w = this.width;
        const h = this.height;

        // Destroy old
        for (const t of [
            ...this.accumColorTextures, ...this.momentsTextures,
            ...this.atrousTextures, this.prevNormalTexture, this.prevDepthTexture
        ]) {
            t?.destroy();
        }

        // Temporal accumulation (ping-pong)
        for (let i = 0; i < 2; i++) {
            this.accumColorTextures[i] = this.vgpu.texture.create({
                width: w, height: h, format: 'rgba16float',
                usage: 'texture|storage|copy-dst', label: `SVGF_AccumColor${i}`
            }).texture;
            this.momentsTextures[i] = this.vgpu.texture.create({
                width: w, height: h, format: 'rgba16float',
                usage: 'texture|storage|copy-dst', label: `SVGF_Moments${i}`
            }).texture;
        }

        // Previous frame normals and depth (for reprojection validation)
        this.prevNormalTexture = this.vgpu.texture.create({
            width: w, height: h, format: 'rgba16float',
            usage: 'texture|copy-dst|render', label: 'SVGF_PrevNormal'
        }).texture;
        this.prevDepthTexture = this.vgpu.texture.create({
            width: w, height: h, format: 'r32float',
            usage: 'texture|copy-dst|render', label: 'SVGF_PrevDepth'
        }).texture;

        // Allocate only the intermediates the selected pass count can reach.
        // One pass writes straight to the caller output; two need one scratch;
        // three or more ping-pong through two scratches.
        const intermediateCount = Math.min(2, Math.max(0, this.atrousIterations - 1));
        for (let i = 0; i < 2; i++) {
            this.atrousTextures[i] = i < intermediateCount
                ? this.vgpu.texture.create({
                    width: w, height: h, format: 'rgba16float',
                    usage: 'texture|storage', label: `SVGF_ATrous${i}`
                }).texture
                : null;
        }

        this._internalViews = {
            accum: this.accumColorTextures.map(texture => texture.createView()),
            moments: this.momentsTextures.map(texture => texture.createView()),
            atrous: this.atrousTextures.map(texture => texture?.createView() || null),
            previousNormal: this.prevNormalTexture.createView(),
            previousDepth: this.prevDepthTexture.createView(),
        };
        this.currentHistoryIndex = 0;
        this.frameIndex = 0;
        this.cameraCut = true;
        this._invalidateBindGroups();
    }

    _createAtrousUniformBuffers() {
        for (const buffer of this.atrousUniformBuffers) buffer?.destroy();
        this.atrousUniformBuffers = [];
        for (let i = 0; i < this.atrousIterations; i++) {
            this.atrousUniformBuffers.push(
                this.vgpu.buffer.create({
                    size: 32, usage: 'uniform', label: `SVGF_ATrous_${i}`
                }).buffer
            );
        }
    }

    _writeAtrousUniforms() {
        for (let i = 0; i < this.atrousIterations; i++) {
            const data = new Float32Array([
                this.width, this.height, 1 << i, this.sigmaLuminance,
                this.sigmaNormal, this.sigmaDepth, i, 0,
            ]);
            this.device.queue.writeBuffer(this.atrousUniformBuffers[i], 0, data);
        }
    }

    _invalidateBindGroups() {
        this._executionResources = null;
        this._temporalBindGroups = [null, null];
        this._atrousBindGroups = [[], []];
    }

    _ensureBindGroups(noisyColor, normalTex, depthTex, motionTex, outputTex) {
        const resources = [noisyColor, normalTex, depthTex, motionTex, outputTex];
        if (this._executionResources?.every((resource, index) => resource === resources[index])) return;

        const noisyView = noisyColor.createView();
        const normalView = normalTex.createView();
        const depthView = depthTex.createView();
        const motionView = motionTex.createView();
        const outputView = outputTex.createView();
        for (let histIn = 0; histIn < 2; histIn++) {
            const histOut = 1 - histIn;
            this._temporalBindGroups[histIn] = this.device.createBindGroup({
                label: `SVGF_Temporal_Group_${histIn}`,
                layout: this.temporalPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: this.temporalUniformBuffer } },
                    { binding: 1, resource: noisyView },
                    { binding: 2, resource: normalView },
                    { binding: 3, resource: depthView },
                    { binding: 4, resource: motionView },
                    { binding: 5, resource: this._internalViews.accum[histIn] },
                    { binding: 6, resource: this._internalViews.moments[histIn] },
                    { binding: 7, resource: this._internalViews.previousNormal },
                    { binding: 8, resource: this._internalViews.previousDepth },
                    { binding: 9, resource: this._internalViews.accum[histOut] },
                    { binding: 10, resource: this._internalViews.moments[histOut] },
                    { binding: 11, resource: this.sampler },
                ],
            });

            this._atrousBindGroups[histIn] = [];
            for (let i = 0; i < this.atrousIterations; i++) {
                const inputView = i === 0
                    ? this._internalViews.accum[histOut]
                    : this._internalViews.atrous[(i - 1) % 2];
                const targetView = i === this.atrousIterations - 1
                    ? outputView
                    : this._internalViews.atrous[i % 2];
                this._atrousBindGroups[histIn][i] = this.device.createBindGroup({
                    label: `SVGF_ATrous_Group_${histIn}_${i}`,
                    layout: this.atrousPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: this.atrousUniformBuffers[i] } },
                        { binding: 1, resource: inputView },
                        { binding: 2, resource: normalView },
                        { binding: 3, resource: depthView },
                        { binding: 4, resource: targetView },
                    ],
                });
            }
        }
        this._executionResources = resources;
    }

    /**
     * Resize denoiser
     */
    resize(width, height) {
        if (width === this.width && height === this.height) return;
        this.width = width;
        this.height = height;
        this._createTextures();
        this._writeAtrousUniforms();
        this.cameraCut = true;
        console.log(`[SVGF] Resized to ${width}×${height}`);
    }

    /**
     * Signal camera cut / scene change (resets temporal accumulation)
     */
    signalCameraCut() {
        this.cameraCut = true;
        this.frameIndex = 0;
    }

    /**
     * Execute full SVGF denoising pipeline
     * 
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTexture} noisyColor   - Noisy path-traced color (rgba16float)
     * @param {GPUTexture} normalTex    - World normals in RGB plus material ID in A (rgba16float, COPY_SRC)
     * @param {GPUTexture} depthTex     - Linear depth (r32float, COPY_SRC)
     * @param {GPUTexture} motionTex    - currentUV - previousUV motion vectors (rg16float)
     * @param {GPUTexture} outputTex    - Denoised output (rgba16float, storage)
     */
    execute(encoder, noisyColor, normalTex, depthTex, motionTex, outputTex) {
        if (!this.enabled || !this.initialized) return;

        const wgX = Math.ceil(this.width / 8);
        const wgY = Math.ceil(this.height / 8);
        const histIn = this.currentHistoryIndex;
        const histOut = 1 - histIn;
        this._ensureBindGroups(noisyColor, normalTex, depthTex, motionTex, outputTex);

        // --- Pass 1: Temporal Accumulation ---
        const td = this._temporalData;
        td[0] = this.width;
        td[1] = this.height;
        td[2] = this.frameIndex;
        td[3] = this.maxAccumFrames;
        td[4] = this.colorPhiLuminance;
        td[5] = this.depthThreshold;
        td[6] = this.normalThreshold;
        td[7] = this.cameraCut ? 1.0 : 0.0;
        this.device.queue.writeBuffer(this.temporalUniformBuffer, 0, td);

        const temporalPass = encoder.beginComputePass({ label: 'SVGF_Temporal' });
        temporalPass.setPipeline(this.temporalPipeline);
        temporalPass.setBindGroup(0, this._temporalBindGroups[histIn]);
        temporalPass.dispatchWorkgroups(wgX, wgY);
        temporalPass.end();

        // --- Pass 2: À-Trous Wavelet Filter (iterative) ---
        for (let i = 0; i < this.atrousIterations; i++) {
            const atrousPass = encoder.beginComputePass({ label: `SVGF_ATrous_${i}` });
            atrousPass.setPipeline(this.atrousPipeline);
            atrousPass.setBindGroup(0, this._atrousBindGroups[histIn][i]);
            atrousPass.dispatchWorkgroups(wgX, wgY);
            atrousPass.end();
        }

        // --- Copy current normals/depth for next frame's reprojection ---
        encoder.copyTextureToTexture(
            { texture: normalTex },
            { texture: this.prevNormalTexture },
            [this.width, this.height]
        );
        // Note: depth copy may need format conversion if source is depth24plus
        // For now assumes matching format or compatible copy
        encoder.copyTextureToTexture(
            { texture: depthTex },
            { texture: this.prevDepthTexture },
            [this.width, this.height]
        );

        // Swap history
        this.currentHistoryIndex = histOut;
        this.frameIndex++;
        this.cameraCut = false;
    }

    /**
     * Load configuration
     */
    loadConfig(cfg) {
        if (!cfg) return;
        this.enabled = cfg.enabled !== false;
        if (cfg.iterations !== undefined) {
            const iterations = parseInt(cfg.iterations);
            if (!Number.isInteger(iterations) || iterations < 1 || iterations > 5) {
                throw new RangeError('SVGF iterations must be an integer from 1 through 5');
            }
            if (iterations !== this.atrousIterations) {
                this.atrousIterations = iterations;
                if (this.initialized) {
                    this._createAtrousUniformBuffers();
                    this._createTextures();
                }
                this._invalidateBindGroups();
            }
        }
        if (cfg.max_accum_frames !== undefined) this.maxAccumFrames = parseInt(cfg.max_accum_frames);
        if (cfg.sigma_luminance !== undefined) this.sigmaLuminance = parseFloat(cfg.sigma_luminance);
        if (cfg.sigma_normal !== undefined) this.sigmaNormal = parseFloat(cfg.sigma_normal);
        if (cfg.sigma_depth !== undefined) this.sigmaDepth = parseFloat(cfg.sigma_depth);
        if (this.initialized) this._writeAtrousUniforms();
    }

    /**
     * Get current accumulated variance texture (for adaptive sampling)
     */
    getVarianceTexture() {
        return this.accumColorTextures[this.currentHistoryIndex];
    }

    destroy() {
        for (const t of [
            ...this.accumColorTextures, ...this.momentsTextures,
            ...this.atrousTextures, this.prevNormalTexture, this.prevDepthTexture
        ]) {
            t?.destroy();
        }
        this.temporalUniformBuffer?.destroy();
        for (const b of this.atrousUniformBuffers) b?.destroy();
        this._invalidateBindGroups();
        this._internalViews = null;
        this.initialized = false;
    }
}

export default SVGFDenoise;
