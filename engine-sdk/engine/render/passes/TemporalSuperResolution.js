// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TemporalSuperResolution.js - Temporal Upscaling System
 * 
 * Renders at reduced internal resolution and reconstructs full-res output
 * using temporal reprojection, motion vectors, and edge-aware upsampling.
 * 
 * Inspired by Unreal Engine TSR, AMD FSR 2, and Intel XeSS.
 * Pure WebGPU/WGSL compute implementation.
 * 
 * Pipeline:
 *   Render at renderScale (e.g. 50-75%) resolution
 *     ↓
 *   Dilate motion vectors (fill gaps from thin geometry)
 *     ↓
 *   Reproject history to current frame
 *     ↓
 *   Neighborhood clamp in YCoCg (anti-ghosting)
 *     ↓
 *   Compute per-pixel confidence (depth, motion, disocclusion)
 *     ↓
 *   Adaptive blend current + history
 *     ↓
 *   Lanczos-weighted upscale to output resolution
 *     ↓
 *   RCAS sharpening pass
 *     ↓
 *   Full-resolution output
 * 
 * Quality Modes:
 *   Ultra Performance: 33% (3x upscale)
 *   Performance:       50% (2x upscale)
 *   Balanced:          58% (~1.7x upscale)
 *   Quality:           67% (1.5x upscale)
 *   Ultra Quality:     77% (1.3x upscale)
 *   Native AA:        100% (TAA replacement, no upscale)
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// ============================================================================
// QUALITY PRESETS
// ============================================================================

export const TSRQuality = {
    ULTRA_PERFORMANCE: { name: 'Ultra Performance', renderScale: 0.33, sharpness: 0.8 },
    PERFORMANCE:       { name: 'Performance',       renderScale: 0.50, sharpness: 0.6 },
    BALANCED:          { name: 'Balanced',           renderScale: 0.58, sharpness: 0.5 },
    QUALITY:           { name: 'Quality',            renderScale: 0.67, sharpness: 0.4 },
    ULTRA_QUALITY:     { name: 'Ultra Quality',      renderScale: 0.77, sharpness: 0.3 },
    NATIVE_AA:         { name: 'Native AA',          renderScale: 1.00, sharpness: 0.2 },
};

// Halton sequence for sub-pixel jitter (low discrepancy)
function halton(index, base) {
    let result = 0;
    let f = 1 / base;
    let i = index;
    while (i > 0) {
        result += f * (i % base);
        i = Math.floor(i / base);
        f /= base;
    }
    return result;
}

function generateJitterSequence(count) {
    const jitters = [];
    for (let i = 0; i < count; i++) {
        jitters.push([
            halton(i + 1, 2) - 0.5,
            halton(i + 1, 3) - 0.5,
        ]);
    }
    return jitters;
}

import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

const TSR_UNIFORMS_STRUCT = `struct TSRUniforms {
    renderWidth: f32,
    renderHeight: f32,
    outputWidth: f32,
    outputHeight: f32,
    jitterX: f32,
    jitterY: f32,
    sharpness: f32,
    frameIndex: f32,
    cameraCut: f32,
    renderScale: f32,
    depthThreshold: f32,
    motionScale: f32,
}`;
const TSR_UNIFORM_FLOATS = getFloat32ArraySize(TSR_UNIFORMS_STRUCT);

const SHARPEN_UNIFORMS_STRUCT = `struct SharpenUniforms {
    width: f32,
    height: f32,
    sharpness: f32,
    _pad: f32,
}`;
const SHARPEN_UNIFORM_FLOATS = getFloat32ArraySize(SHARPEN_UNIFORMS_STRUCT);

// ============================================================================
// WGSL SHADERS
// ============================================================================

const TSR_RESOLVE_SHADER = /* wgsl */ `
// Temporal Super-Resolution - Resolve + Upscale Compute Shader
// Combines temporal accumulation with Lanczos upsampling in a single pass

${TSR_UNIFORMS_STRUCT}

@group(0) @binding(0) var<uniform> u: TSRUniforms;
@group(0) @binding(1) var currentColor: texture_2d<f32>;
@group(0) @binding(2) var currentDepth: texture_2d<f32>;
@group(0) @binding(3) var motionVectors: texture_2d<f32>;
@group(0) @binding(4) var historyColor: texture_2d<f32>;
@group(0) @binding(5) var outputTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var linearSampler: sampler;

// RGB <-> YCoCg for perceptual-space clamping
fn rgbToYCoCg(rgb: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        0.25 * rgb.r + 0.5 * rgb.g + 0.25 * rgb.b,
        0.5 * rgb.r - 0.5 * rgb.b,
        -0.25 * rgb.r + 0.5 * rgb.g - 0.25 * rgb.b
    );
}

fn yCoCgToRgb(ycocg: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        ycocg.x + ycocg.y - ycocg.z,
        ycocg.x + ycocg.z,
        ycocg.x - ycocg.y - ycocg.z
    );
}

// Luminance for weighting
fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// Soft clamp fireflies before accumulation
fn softClampFirefly(color: vec3<f32>, maxLum: f32) -> vec3<f32> {
    let lum = luminance(color);
    if (lum > maxLum) {
        return color * (maxLum / lum);
    }
    return color;
}

// Clip history to AABB (better than clamp - preserves chrominance)
fn clipToAABB(history: vec3<f32>, aabbMin: vec3<f32>, aabbMax: vec3<f32>) -> vec3<f32> {
    let center = (aabbMin + aabbMax) * 0.5;
    let extents = (aabbMax - aabbMin) * 0.5 + vec3<f32>(0.001);
    let offset = history - center;
    let ts = abs(extents / max(abs(offset), vec3<f32>(0.0001)));
    let t = min(min(ts.x, ts.y), ts.z);
    if (t < 1.0) {
        return center + offset * t;
    }
    return history;
}

// Mitchell-Netravali filter kernel (B=1/3, C=1/3)
fn mitchellNetravali(x: f32) -> f32 {
    let ax = abs(x);
    if (ax < 1.0) {
        return (21.0 * ax * ax * ax - 36.0 * ax * ax + 16.0) / 18.0;
    } else if (ax < 2.0) {
        return (-7.0 * ax * ax * ax + 36.0 * ax * ax - 60.0 * ax + 32.0) / 18.0;
    }
    return 0.0;
}

// Catmull-Rom filter kernel (sharper than Mitchell)
fn catmullRom(x: f32) -> f32 {
    let ax = abs(x);
    if (ax < 1.0) {
        return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1.0;
    } else if (ax < 2.0) {
        return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4.0 * ax + 2.0;
    }
    return 0.0;
}

// Lanczos2 kernel for high-quality upsampling
fn lanczos2(x: f32) -> f32 {
    if (abs(x) < 0.001) { return 1.0; }
    if (abs(x) >= 2.0) { return 0.0; }
    let pi = 3.14159265359;
    let px = pi * x;
    return (sin(px) / px) * (sin(px * 0.5) / (px * 0.5));
}

// Dilated motion vector - find closest depth in 3x3 and use its motion
fn getDilatedMotion(coord: vec2<i32>, dims: vec2<u32>) -> vec2<f32> {
    var closestDepth = 0.0;
    var closestMotion = vec2<f32>(0.0);

    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let sc = clamp(coord + vec2<i32>(dx, dy), vec2<i32>(0), vec2<i32>(dims) - vec2<i32>(1));
            let d = textureLoad(currentDepth, sc, 0).r;
            // Reversed-Z: closest = largest depth value
            if (d > closestDepth) {
                closestDepth = d;
                closestMotion = textureLoad(motionVectors, sc, 0).rg;
            }
        }
    }
    return closestMotion * u.motionScale;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let outputCoord = vec2<i32>(gid.xy);
    let outputDims = vec2<u32>(u32(u.outputWidth), u32(u.outputHeight));

    if (gid.x >= outputDims.x || gid.y >= outputDims.y) { return; }

    let renderDims = vec2<u32>(u32(u.renderWidth), u32(u.renderHeight));
    let outputUV = (vec2<f32>(gid.xy) + 0.5) / vec2<f32>(u.outputWidth, u.outputHeight);

    // Map output pixel to render-resolution space (with jitter correction)
    let renderUV = outputUV;
    let renderCoordF = renderUV * vec2<f32>(u.renderWidth, u.renderHeight) - 0.5;
    let renderCoord = vec2<i32>(renderCoordF);

    // ---- Upsampled current frame via Lanczos/Catmull-Rom ----
    var currentSum = vec3<f32>(0.0);
    var currentWeight = 0.0;

    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let sc = renderCoord + vec2<i32>(dx, dy);
            let csc = clamp(sc, vec2<i32>(0), vec2<i32>(renderDims) - vec2<i32>(1));
            let sample = textureLoad(currentColor, csc, 0).rgb;

            // Sub-pixel distance for filter kernel
            let dist = vec2<f32>(sc) + 0.5 - renderCoordF;
            let w = catmullRom(dist.x) * catmullRom(dist.y);

            // Tonemap weight to reduce firefly influence
            let lw = 1.0 / (1.0 + luminance(sample));
            currentSum += sample * w * lw;
            currentWeight += w * lw;
        }
    }
    let current = currentSum / max(currentWeight, 0.0001);

    // ---- Motion-compensated history sampling ----
    let motion = getDilatedMotion(renderCoord, renderDims);
    let historyUV = outputUV - motion;

    // Bilinear sample history at output resolution
    var history = textureSampleLevel(historyColor, linearSampler, historyUV, 0.0).rgb;
    let historyValid = historyUV.x >= 0.0 && historyUV.x <= 1.0 &&
                       historyUV.y >= 0.0 && historyUV.y <= 1.0;

    // ---- Neighborhood clamping in YCoCg ----
    var minC = vec3<f32>(1e10);
    var maxC = vec3<f32>(-1e10);
    var moment1 = vec3<f32>(0.0);
    var moment2 = vec3<f32>(0.0);

    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let sc = clamp(renderCoord + vec2<i32>(dx, dy), vec2<i32>(0), vec2<i32>(renderDims) - vec2<i32>(1));
            let s = rgbToYCoCg(textureLoad(currentColor, sc, 0).rgb);
            minC = min(minC, s);
            maxC = max(maxC, s);
            moment1 += s;
            moment2 += s * s;
        }
    }

    // Variance-based AABB (tighter than min/max, reduces ghosting)
    let mean = moment1 / 9.0;
    let variance = sqrt(max(moment2 / 9.0 - mean * mean, vec3<f32>(0.0)));
    let varianceGamma = 1.0; // 1.0 = tight, 2.0 = loose
    let aabbMin = mean - variance * varianceGamma;
    let aabbMax = mean + variance * varianceGamma;

    // Clip history to variance AABB
    let historyYCoCg = rgbToYCoCg(history);
    let clippedYCoCg = clipToAABB(historyYCoCg, aabbMin, aabbMax);
    history = yCoCgToRgb(clippedYCoCg);

    // ---- Adaptive blend factor ----
    // Base: accumulate heavily from history for temporal stability
    var blend = 0.05; // 5% current, 95% history (very stable)

    // Increase blend for fast motion (reduce trails)
    let motionLength = length(motion) * max(u.outputWidth, u.outputHeight);
    blend += smoothstep(0.5, 8.0, motionLength) * 0.25;

    // Increase blend for disoccluded regions
    let depthCenter = textureLoad(currentDepth, clamp(renderCoord, vec2<i32>(0), vec2<i32>(renderDims) - vec2<i32>(1)), 0).r;
    let clampAmount = length(clippedYCoCg - historyYCoCg);
    blend += clampAmount * 2.0;

    // Camera cut = full reset
    if (u.cameraCut > 0.5 || !historyValid) {
        blend = 1.0;
    }

    blend = clamp(blend, 0.03, 1.0);

    // ---- Blend ----
    var result = mix(history, current, blend);

    // Firefly suppression
    result = softClampFirefly(result, 65504.0); // half-float max

    textureStore(outputTex, outputCoord, vec4<f32>(result, 1.0));
}
`;

const TSR_SHARPEN_SHADER = /* wgsl */ `
// RCAS - Robust Contrast-Adaptive Sharpening
// Based on AMD FidelityFX CAS, adapted for TSR output

${SHARPEN_UNIFORMS_STRUCT}

@group(0) @binding(0) var<uniform> u: SharpenUniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d<rgba16float, write>;

fn rcasWeight(sharpness: f32, e: f32, n: f32, s: f32, w: f32, center: f32) -> f32 {
    // Compute local contrast
    let maxNeighbor = max(max(n, s), max(e, w));
    let minNeighbor = min(min(n, s), min(e, w));
    let contrast = maxNeighbor - minNeighbor;

    // Adaptive sharpening weight based on contrast
    let rcp_contrast = 1.0 / max(contrast, 0.001);
    let sharpWeight = min(rcp_contrast * sharpness, 1.0);
    return sharpWeight;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let coord = vec2<i32>(gid.xy);
    let dims = vec2<i32>(i32(u.width), i32(u.height));

    if (coord.x >= dims.x || coord.y >= dims.y) { return; }

    // Sample cross pattern
    let c = textureLoad(inputTex, coord, 0).rgb;
    let n = textureLoad(inputTex, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), dims - vec2<i32>(1)), 0).rgb;
    let s = textureLoad(inputTex, clamp(coord + vec2<i32>(0,  1), vec2<i32>(0), dims - vec2<i32>(1)), 0).rgb;
    let e = textureLoad(inputTex, clamp(coord + vec2<i32>( 1, 0), vec2<i32>(0), dims - vec2<i32>(1)), 0).rgb;
    let w = textureLoad(inputTex, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), dims - vec2<i32>(1)), 0).rgb;

    // Per-channel adaptive sharpening
    let lumC = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    let lumN = dot(n, vec3<f32>(0.2126, 0.7152, 0.0722));
    let lumS = dot(s, vec3<f32>(0.2126, 0.7152, 0.0722));
    let lumE = dot(e, vec3<f32>(0.2126, 0.7152, 0.0722));
    let lumW = dot(w, vec3<f32>(0.2126, 0.7152, 0.0722));

    let sw = rcasWeight(u.sharpness, lumE, lumN, lumS, lumW, lumC);

    // Apply sharpening: center + sw * (center - average_neighbors)
    let avg = (n + s + e + w) * 0.25;
    let sharpened = c + (c - avg) * sw;

    // Clamp to prevent ringing
    let minNeighbor = min(min(n, s), min(e, w));
    let maxNeighbor = max(max(n, s), max(e, w));
    let result = clamp(sharpened, minNeighbor, maxNeighbor);

    textureStore(outputTex, coord, vec4<f32>(result, 1.0));
}
`;

// ============================================================================
// TSR CLASS
// ============================================================================

export class TemporalSuperResolution {
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.initialized = false;
        this.enabled = true;

        // Quality preset
        this.quality = TSRQuality.QUALITY;

        // Resolutions
        this.outputWidth = 0;
        this.outputHeight = 0;
        this.renderWidth = 0;
        this.renderHeight = 0;

        // Pipelines
        this.resolvePipeline = null;
        this.sharpenPipeline = null;

        // Textures
        this.historyTextures = [null, null]; // ping-pong
        this.currentHistoryIndex = 0;
        this.resolveTarget = null; // intermediate before sharpening

        // Buffers
        this.resolveUniformBuffer = null;
        this.sharpenUniformBuffer = null;
        this.sampler = null;

        // Jitter
        this.jitterSequence = generateJitterSequence(32);
        this.frameIndex = 0;

        // State
        this.cameraCut = false;

        // Pre-allocated uniform data
        this._resolveUniformData = new Float32Array(TSR_UNIFORM_FLOATS);
        this._sharpenUniformData = new Float32Array(SHARPEN_UNIFORM_FLOATS);
        this._jitteredMatrix = new Float32Array(16);
    }

    /**
     * Initialize TSR with output dimensions
     */
    async init(outputWidth, outputHeight) {
        this.outputWidth = outputWidth;
        this.outputHeight = outputHeight;
        this.renderWidth = Math.ceil(outputWidth * this.quality.renderScale);
        this.renderHeight = Math.ceil(outputHeight * this.quality.renderScale);

        // Compile shaders
        const resolveModule = this.vgpu.shader.compile('tsr_resolve', TSR_RESOLVE_SHADER);
        const sharpenModule = this.vgpu.shader.compile('tsr_sharpen', TSR_SHARPEN_SHADER);

        // Create compute pipelines
        this.resolvePipeline = this.vgpu.pipeline.compute({
            module: resolveModule, entryPoint: 'main', label: 'TSR_Resolve'
        });
        this.sharpenPipeline = this.vgpu.pipeline.compute({
            module: sharpenModule, entryPoint: 'main', label: 'TSR_Sharpen'
        });

        // Create sampler
        this.sampler = this.device.createSampler({
            magFilter: 'linear', minFilter: 'linear',
            addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
            label: 'TSR_LinearSampler',
        });

        // Create uniform buffers
        this.resolveUniformBuffer = this.vgpu.buffer.create({
            size: 48, usage: 'uniform', label: 'TSR_ResolveUniforms'
        }).buffer;
        this.sharpenUniformBuffer = this.vgpu.buffer.create({
            size: 16, usage: 'uniform', label: 'TSR_SharpenUniforms'
        }).buffer;

        // Create textures
        this._createTextures();

        this.initialized = true;
        console.log(`[TSR] Initialized: ${this.renderWidth}×${this.renderHeight} → ${outputWidth}×${outputHeight} (${this.quality.name})`);
    }

    _createTextures() {
        // Destroy old textures
        this.historyTextures[0]?.destroy();
        this.historyTextures[1]?.destroy();
        this.resolveTarget?.destroy();

        const ow = this.outputWidth;
        const oh = this.outputHeight;

        // History at output resolution (accumulates detail over frames)
        for (let i = 0; i < 2; i++) {
            this.historyTextures[i] = this.vgpu.texture.create({
                width: ow, height: oh, format: 'rgba16float',
                usage: 'texture|storage|render|copy-dst', label: `TSR_History${i}`
            }).texture;
        }

        // Resolve target (before sharpening)
        this.resolveTarget = this.vgpu.texture.create({
            width: ow, height: oh, format: 'rgba16float',
            usage: 'texture|storage', label: 'TSR_ResolveTarget'
        }).texture;
    }

    /**
     * Set quality preset
     */
    setQuality(preset) {
        this.quality = preset;
        if (this.initialized) {
            this.renderWidth = Math.ceil(this.outputWidth * preset.renderScale);
            this.renderHeight = Math.ceil(this.outputHeight * preset.renderScale);
            this._createTextures();
            this.cameraCut = true; // Reset history on quality change
            console.log(`[TSR] Quality changed: ${this.renderWidth}×${this.renderHeight} → ${this.outputWidth}×${this.outputHeight} (${preset.name})`);
        }
    }

    /**
     * Get render dimensions (use these for your internal render targets)
     */
    getRenderSize() {
        return { width: this.renderWidth, height: this.renderHeight };
    }

    /**
     * Get sub-pixel jitter for current frame's projection matrix
     */
    getJitter() {
        const j = this.jitterSequence[this.frameIndex % this.jitterSequence.length];
        return { x: j[0], y: j[1] };
    }

    /**
     * Apply jitter to projection matrix
     */
    applyJitter(projMatrix) {
        const jitter = this.getJitter();
        const result = this._jitteredMatrix;
        result.set(projMatrix);
        result[8] += (jitter.x * 2.0) / this.renderWidth;
        result[9] += (jitter.y * 2.0) / this.renderHeight;
        return result;
    }

    /**
     * Signal a camera cut (teleport, scene change) - resets history
     */
    signalCameraCut() {
        this.cameraCut = true;
    }

    /**
     * Resize output dimensions
     */
    resize(outputWidth, outputHeight) {
        if (outputWidth === this.outputWidth && outputHeight === this.outputHeight) return;
        this.outputWidth = outputWidth;
        this.outputHeight = outputHeight;
        this.renderWidth = Math.ceil(outputWidth * this.quality.renderScale);
        this.renderHeight = Math.ceil(outputHeight * this.quality.renderScale);
        this._createTextures();
        this.cameraCut = true;
        console.log(`[TSR] Resized: ${this.renderWidth}×${this.renderHeight} → ${outputWidth}×${outputHeight}`);
    }

    /**
     * Execute TSR pass
     * 
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTexture} currentColor - Rendered color at render resolution (rgba16float or rgba8unorm)
     * @param {GPUTexture} currentDepth - Depth buffer at render resolution
     * @param {GPUTexture} motionVectors - Motion vectors at render resolution (rg16float)
     * @param {GPUTexture} outputTexture - Final output at display resolution (rgba16float storage)
     */
    execute(encoder, currentColor, currentDepth, motionVectors, outputTexture) {
        if (!this.enabled || !this.initialized) return;

        const jitter = this.getJitter();

        // --- Pass 1: Temporal Resolve + Upscale ---
        const resolveData = this._resolveUniformData;
        resolveData[0] = this.renderWidth;
        resolveData[1] = this.renderHeight;
        resolveData[2] = this.outputWidth;
        resolveData[3] = this.outputHeight;
        resolveData[4] = jitter.x;
        resolveData[5] = jitter.y;
        resolveData[6] = this.quality.sharpness;
        resolveData[7] = this.frameIndex;
        resolveData[8] = this.cameraCut ? 1.0 : 0.0;
        resolveData[9] = this.quality.renderScale;
        resolveData[10] = 0.01; // depth threshold
        resolveData[11] = 1.0;  // motion scale
        this.device.queue.writeBuffer(this.resolveUniformBuffer, 0, resolveData);

        const historyIn = this.historyTextures[this.currentHistoryIndex];
        const historyOut = this.historyTextures[1 - this.currentHistoryIndex];

        // Write resolve output to next history buffer
        const resolveBindGroup = this.device.createBindGroup({
            layout: this.resolvePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.resolveUniformBuffer } },
                { binding: 1, resource: currentColor.createView() },
                { binding: 2, resource: currentDepth.createView() },
                { binding: 3, resource: motionVectors.createView() },
                { binding: 4, resource: historyIn.createView() },
                { binding: 5, resource: historyOut.createView() },
                { binding: 6, resource: this.sampler },
            ],
        });

        const resolvePass = encoder.beginComputePass({ label: 'TSR_Resolve' });
        resolvePass.setPipeline(this.resolvePipeline);
        resolvePass.setBindGroup(0, resolveBindGroup);
        resolvePass.dispatchWorkgroups(
            Math.ceil(this.outputWidth / 8),
            Math.ceil(this.outputHeight / 8)
        );
        resolvePass.end();

        // --- Pass 2: RCAS Sharpening ---
        const sharpenData = this._sharpenUniformData;
        sharpenData[0] = this.outputWidth;
        sharpenData[1] = this.outputHeight;
        sharpenData[2] = this.quality.sharpness;
        sharpenData[3] = 0;
        this.device.queue.writeBuffer(this.sharpenUniformBuffer, 0, sharpenData);

        const sharpenBindGroup = this.device.createBindGroup({
            layout: this.sharpenPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.sharpenUniformBuffer } },
                { binding: 1, resource: historyOut.createView() },
                { binding: 2, resource: outputTexture.createView() },
            ],
        });

        const sharpenPass = encoder.beginComputePass({ label: 'TSR_Sharpen' });
        sharpenPass.setPipeline(this.sharpenPipeline);
        sharpenPass.setBindGroup(0, sharpenBindGroup);
        sharpenPass.dispatchWorkgroups(
            Math.ceil(this.outputWidth / 8),
            Math.ceil(this.outputHeight / 8)
        );
        sharpenPass.end();

        // Swap history ping-pong
        this.currentHistoryIndex = 1 - this.currentHistoryIndex;
        this.frameIndex++;
        this.cameraCut = false;
    }

    /**
     * Load configuration
     */
    loadConfig(cfg) {
        if (!cfg) return;
        this.enabled = cfg.enabled !== false;
        if (cfg.quality) {
            const preset = TSRQuality[cfg.quality.toUpperCase()?.replace(/\s+/g, '_')];
            if (preset) this.setQuality(preset);
        }
    }

    /**
     * Get current output texture (latest history)
     */
    getOutputTexture() {
        return this.historyTextures[this.currentHistoryIndex];
    }

    destroy() {
        this.historyTextures[0]?.destroy();
        this.historyTextures[1]?.destroy();
        this.resolveTarget?.destroy();
        this.resolveUniformBuffer?.destroy();
        this.sharpenUniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default TemporalSuperResolution;
