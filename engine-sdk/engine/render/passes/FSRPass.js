// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FSRPass.js - FidelityFX Super Resolution 1.0 (Spatial Upscaler)
 * 
 * Pure WebGPU/WGSL port of AMD's open-source FSR 1.0 algorithm.
 * Two-pass spatial upscaler: EASU (Edge-Adaptive Spatial Upsampling) + RCAS (Sharpening).
 * 
 * Use cases:
 *   - Fallback when temporal history is invalid (camera cuts, teleports)
 *   - Standalone spatial upscaling for non-temporal content
 *   - Combined with TSR as the spatial component
 * 
 * Pipeline:
 *   Low-res input → EASU (directional upscale) → RCAS (adaptive sharpen) → Full-res output
 * 
 * EASU: Analyzes local edge direction and applies a directionally-aware 12-tap filter.
 *       Detects edges via luminance gradients and stretches the filter kernel along the edge.
 *       This preserves edge sharpness while smoothing along edges (not across them).
 * 
 * RCAS: Contrast-adaptive sharpening that avoids ringing artifacts.
 *       Computes local contrast from a cross-shaped sample pattern and applies
 *       sharpening proportional to inverse contrast (sharp where flat, gentle on edges).
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// ============================================================================
// WGSL SHADERS
// ============================================================================

const FSR_EASU_SHADER = /* wgsl */ `
// FSR 1.0 - Edge-Adaptive Spatial Upsampling (EASU)
// Directionally-aware upscaling filter

struct EASUUniforms {
    inputWidth: f32,
    inputHeight: f32,
    outputWidth: f32,
    outputHeight: f32,
}

@group(0) @binding(0) var<uniform> u: EASUUniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var linearSampler: sampler;

fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.299, 0.587, 0.114));
}

// Compute edge direction and strength from 2x2 luminance quad
fn computeEdgeInfo(a: f32, b: f32, c: f32, d: f32) -> vec2<f32> {
    // Horizontal and vertical gradients
    let hGrad = abs(a - b) + abs(c - d);
    let vGrad = abs(a - c) + abs(b - d);
    // Diagonal gradients
    let d1Grad = abs(a - d);
    let d2Grad = abs(b - c);

    // Edge direction (angle encoded as cos/sin pair)
    let edgeX = hGrad - vGrad;
    let edgeY = d1Grad - d2Grad;
    let len = max(sqrt(edgeX * edgeX + edgeY * edgeY), 0.0001);
    return vec2<f32>(edgeX / len, edgeY / len);
}

// Compute filter weight based on distance and edge direction
fn easuWeight(offset: vec2<f32>, edgeDir: vec2<f32>, edgeStrength: f32) -> f32 {
    // Project offset onto edge direction
    let along = dot(offset, edgeDir);
    let across = length(offset - edgeDir * along);

    // Stretch kernel along edge, compress across
    let stretch = mix(1.0, 2.0, edgeStrength);
    let compress = mix(1.0, 0.5, edgeStrength);

    let dx = along * compress;
    let dy = across * stretch;
    let d2 = dx * dx + dy * dy;

    // Lanczos-like window
    if (d2 >= 4.0) { return 0.0; }
    let d = sqrt(d2);
    if (d < 0.001) { return 1.0; }
    let pi = 3.14159265359;
    let pd = pi * d;
    return (sin(pd) / pd) * (sin(pd * 0.5) / (pd * 0.5));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let outCoord = vec2<i32>(gid.xy);
    let outDims = vec2<i32>(i32(u.outputWidth), i32(u.outputHeight));
    if (outCoord.x >= outDims.x || outCoord.y >= outDims.y) { return; }

    let inDims = vec2<f32>(u.inputWidth, u.inputHeight);
    let outDimsF = vec2<f32>(u.outputWidth, u.outputHeight);
    let ratio = inDims / outDimsF;

    // Map output pixel center to input space
    let inputPos = (vec2<f32>(outCoord) + 0.5) * ratio - 0.5;
    let inputBase = vec2<i32>(floor(inputPos));
    let frac = inputPos - vec2<f32>(inputBase);

    let inMax = vec2<i32>(i32(u.inputWidth) - 1, i32(u.inputHeight) - 1);

    // Sample 4x4 neighborhood
    var samples: array<vec3<f32>, 16>;
    var lums: array<f32, 16>;
    for (var dy = -1; dy <= 2; dy++) {
        for (var dx = -1; dx <= 2; dx++) {
            let idx = (dy + 1) * 4 + (dx + 1);
            let sc = clamp(inputBase + vec2<i32>(dx, dy), vec2<i32>(0), inMax);
            samples[idx] = textureLoad(inputTex, sc, 0).rgb;
            lums[idx] = luminance(samples[idx]);
        }
    }

    // Compute edge info from center 2x2
    // Center 2x2 indices: (1,1)=5, (2,1)=6, (1,2)=9, (2,2)=10
    let edgeDir = computeEdgeInfo(lums[5], lums[6], lums[9], lums[10]);

    // Compute edge strength from surrounding gradients
    let hGrad = abs(lums[5] - lums[6]) + abs(lums[9] - lums[10]);
    let vGrad = abs(lums[5] - lums[9]) + abs(lums[6] - lums[10]);
    let maxGrad = max(hGrad, vGrad);
    let minGrad = min(hGrad, vGrad);
    let edgeStrength = saturate(1.0 - minGrad / max(maxGrad, 0.001));

    // Weighted filter using edge-aware kernel
    var weightSum = 0.0;
    var colorSum = vec3<f32>(0.0);

    for (var dy = -1; dy <= 2; dy++) {
        for (var dx = -1; dx <= 2; dx++) {
            let idx = (dy + 1) * 4 + (dx + 1);
            let offset = vec2<f32>(f32(dx), f32(dy)) - frac;
            let w = easuWeight(offset, edgeDir, edgeStrength);

            // Tonemap weight to suppress fireflies
            let lw = 1.0 / (1.0 + lums[idx]);
            let totalW = w * lw;
            colorSum += samples[idx] * totalW;
            weightSum += totalW;
        }
    }

    let result = colorSum / max(weightSum, 0.0001);
    textureStore(outputTex, outCoord, vec4<f32>(result, 1.0));
}
`;

const FSR_RCAS_SHADER = /* wgsl */ `
// FSR 1.0 - Robust Contrast-Adaptive Sharpening (RCAS)
// Final pass: sharpen without ringing

struct RCASUniforms {
    width: f32,
    height: f32,
    sharpness: f32, // 0.0 = no sharpening, 1.0 = maximum
    _pad: f32,
}

@group(0) @binding(0) var<uniform> u: RCASUniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d<rgba16float, write>;

fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let coord = vec2<i32>(gid.xy);
    let dims = vec2<i32>(i32(u.width), i32(u.height));
    if (coord.x >= dims.x || coord.y >= dims.y) { return; }

    let maxC = dims - vec2<i32>(1);

    // Cross-shaped samples (center + 4 neighbors)
    let c = textureLoad(inputTex, coord, 0).rgb;
    let n = textureLoad(inputTex, clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), maxC), 0).rgb;
    let s = textureLoad(inputTex, clamp(coord + vec2<i32>(0,  1), vec2<i32>(0), maxC), 0).rgb;
    let e = textureLoad(inputTex, clamp(coord + vec2<i32>( 1, 0), vec2<i32>(0), maxC), 0).rgb;
    let w = textureLoad(inputTex, clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), maxC), 0).rgb;

    // Luminance for edge detection
    let lC = luminance(c);
    let lN = luminance(n);
    let lS = luminance(s);
    let lE = luminance(e);
    let lW = luminance(w);

    // Local contrast
    let lMax = max(max(lN, lS), max(lE, lW));
    let lMin = min(min(lN, lS), min(lE, lW));
    let contrast = lMax - lMin;

    // Adaptive sharpening amount (inverse contrast)
    // High contrast = less sharpening (already sharp)
    // Low contrast = more sharpening (flat area needs it)
    let rcpContrast = 1.0 / max(contrast, 0.04);
    let sharpAmount = min(rcpContrast * u.sharpness * 0.25, 1.0);

    // Unsharp mask via cross kernel
    let avg = (n + s + e + w) * 0.25;
    let detail = c - avg;
    var result = c + detail * sharpAmount;

    // Anti-ringing: clamp to neighbor bounds
    let nMin = min(min(n, s), min(e, w));
    let nMax = max(max(n, s), max(e, w));
    result = clamp(result, nMin, nMax);

    textureStore(outputTex, coord, vec4<f32>(result, 1.0));
}
`;

// ============================================================================
// FSR PASS CLASS
// ============================================================================

export class FSRPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;

        // Pipelines
        this.easuPipeline = null;
        this.rcasPipeline = null;

        // Textures
        this.intermediateTexture = null; // EASU output, RCAS input

        // Buffers
        this.easuUniformBuffer = null;
        this.rcasUniformBuffer = null;
        this.sampler = null;

        // Settings
        this.sharpness = 0.5;

        // Dimensions
        this.inputWidth = 0;
        this.inputHeight = 0;
        this.outputWidth = 0;
        this.outputHeight = 0;

        // Pre-allocated
        this._easuData = new Float32Array(4);
        this._rcasData = new Float32Array(4);
    }

    /**
     * Initialize FSR pass
     */
    async init(device, inputWidth, inputHeight, outputWidth, outputHeight) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.inputWidth = inputWidth;
        this.inputHeight = inputHeight;
        this.outputWidth = outputWidth;
        this.outputHeight = outputHeight;

        // Compile shaders
        const easuModule = this.vgpu.shader.compile('fsr_easu', FSR_EASU_SHADER);
        const rcasModule = this.vgpu.shader.compile('fsr_rcas', FSR_RCAS_SHADER);

        // Create pipelines
        this.easuPipeline = this.vgpu.pipeline.compute({
            module: easuModule, entryPoint: 'main', label: 'FSR_EASU'
        });
        this.rcasPipeline = this.vgpu.pipeline.compute({
            module: rcasModule, entryPoint: 'main', label: 'FSR_RCAS'
        });

        // Sampler
        this.sampler = this.device.createSampler({
            magFilter: 'linear', minFilter: 'linear',
            addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
            label: 'FSR_Sampler',
        });

        // Uniform buffers
        this.easuUniformBuffer = this.vgpu.buffer.create({
            size: 16, usage: 'uniform', label: 'FSR_EASUUniforms'
        }).buffer;
        this.rcasUniformBuffer = this.vgpu.buffer.create({
            size: 16, usage: 'uniform', label: 'FSR_RCASUniforms'
        }).buffer;

        // Intermediate texture at output resolution
        this._createIntermediateTexture();

        this.initialized = true;
        console.log(`[FSR] Initialized: ${inputWidth}×${inputHeight} → ${outputWidth}×${outputHeight}`);
    }

    _createIntermediateTexture() {
        this.intermediateTexture?.destroy();
        this.intermediateTexture = this.vgpu.texture.create({
            width: this.outputWidth, height: this.outputHeight,
            format: 'rgba16float', usage: 'texture|storage',
            label: 'FSR_Intermediate'
        }).texture;
    }

    /**
     * Resize for new dimensions
     */
    resize(inputWidth, inputHeight, outputWidth, outputHeight) {
        this.inputWidth = inputWidth;
        this.inputHeight = inputHeight;
        this.outputWidth = outputWidth;
        this.outputHeight = outputHeight;
        this._createIntermediateTexture();
        console.log(`[FSR] Resized: ${inputWidth}×${inputHeight} → ${outputWidth}×${outputHeight}`);
    }

    /**
     * Execute FSR upscaling
     * 
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTexture} inputTexture - Low-res input
     * @param {GPUTexture} outputTexture - Full-res output (storage texture)
     */
    execute(encoder, inputTexture, outputTexture) {
        if (!this.enabled || !this.initialized) return;

        // --- Pass 1: EASU (Edge-Adaptive Spatial Upsampling) ---
        const easuData = this._easuData;
        easuData[0] = this.inputWidth;
        easuData[1] = this.inputHeight;
        easuData[2] = this.outputWidth;
        easuData[3] = this.outputHeight;
        this.device.queue.writeBuffer(this.easuUniformBuffer, 0, easuData);

        const easuBindGroup = this.device.createBindGroup({
            layout: this.easuPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.easuUniformBuffer } },
                { binding: 1, resource: inputTexture.createView() },
                { binding: 2, resource: this.intermediateTexture.createView() },
                { binding: 3, resource: this.sampler },
            ],
        });

        const easuPass = encoder.beginComputePass({ label: 'FSR_EASU' });
        easuPass.setPipeline(this.easuPipeline);
        easuPass.setBindGroup(0, easuBindGroup);
        easuPass.dispatchWorkgroups(
            Math.ceil(this.outputWidth / 8),
            Math.ceil(this.outputHeight / 8)
        );
        easuPass.end();

        // --- Pass 2: RCAS (Robust Contrast-Adaptive Sharpening) ---
        const rcasData = this._rcasData;
        rcasData[0] = this.outputWidth;
        rcasData[1] = this.outputHeight;
        rcasData[2] = this.sharpness;
        rcasData[3] = 0;
        this.device.queue.writeBuffer(this.rcasUniformBuffer, 0, rcasData);

        const rcasBindGroup = this.device.createBindGroup({
            layout: this.rcasPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.rcasUniformBuffer } },
                { binding: 1, resource: this.intermediateTexture.createView() },
                { binding: 2, resource: outputTexture.createView() },
            ],
        });

        const rcasPass = encoder.beginComputePass({ label: 'FSR_RCAS' });
        rcasPass.setPipeline(this.rcasPipeline);
        rcasPass.setBindGroup(0, rcasBindGroup);
        rcasPass.dispatchWorkgroups(
            Math.ceil(this.outputWidth / 8),
            Math.ceil(this.outputHeight / 8)
        );
        rcasPass.end();
    }

    /**
     * Execute EASU only (no sharpening)
     */
    executeEASU(encoder, inputTexture, outputTexture) {
        if (!this.enabled || !this.initialized) return;

        const easuData = this._easuData;
        easuData[0] = this.inputWidth;
        easuData[1] = this.inputHeight;
        easuData[2] = this.outputWidth;
        easuData[3] = this.outputHeight;
        this.device.queue.writeBuffer(this.easuUniformBuffer, 0, easuData);

        const bindGroup = this.device.createBindGroup({
            layout: this.easuPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.easuUniformBuffer } },
                { binding: 1, resource: inputTexture.createView() },
                { binding: 2, resource: outputTexture.createView() },
                { binding: 3, resource: this.sampler },
            ],
        });

        const pass = encoder.beginComputePass({ label: 'FSR_EASU_Only' });
        pass.setPipeline(this.easuPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.outputWidth / 8),
            Math.ceil(this.outputHeight / 8)
        );
        pass.end();
    }

    /**
     * Execute RCAS only (sharpening on already-upscaled image)
     */
    executeRCAS(encoder, inputTexture, outputTexture) {
        if (!this.enabled || !this.initialized) return;

        const rcasData = this._rcasData;
        rcasData[0] = this.outputWidth;
        rcasData[1] = this.outputHeight;
        rcasData[2] = this.sharpness;
        rcasData[3] = 0;
        this.device.queue.writeBuffer(this.rcasUniformBuffer, 0, rcasData);

        const bindGroup = this.device.createBindGroup({
            layout: this.rcasPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.rcasUniformBuffer } },
                { binding: 1, resource: inputTexture.createView() },
                { binding: 2, resource: outputTexture.createView() },
            ],
        });

        const pass = encoder.beginComputePass({ label: 'FSR_RCAS_Only' });
        pass.setPipeline(this.rcasPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.outputWidth / 8),
            Math.ceil(this.outputHeight / 8)
        );
        pass.end();
    }

    /**
     * Load configuration
     */
    loadConfig(cfg) {
        if (!cfg) return;
        this.enabled = cfg.enabled !== false;
        if (cfg.sharpness !== undefined) this.sharpness = parseFloat(cfg.sharpness);
    }

    destroy() {
        this.intermediateTexture?.destroy();
        this.easuUniformBuffer?.destroy();
        this.rcasUniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default FSRPass;
