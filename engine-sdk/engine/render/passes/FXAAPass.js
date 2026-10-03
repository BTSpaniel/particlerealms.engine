// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FXAAPass.js - Fast Approximate Anti-Aliasing
 * Now powered by vGPU driver
 * 
 * Compact FXAA edge filter with contrast-weighted subpixel filtering.
 * Shared by the engine and isolated WebGPU viewports.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Shared by engine and isolated app renderers; importing it never initializes vGPU.
export const FXAA_SHADER = /* wgsl */ `
struct FXAAUniforms {
    texelSizeX: f32,
    texelSizeY: f32,
    edgeThreshold: f32,
    edgeThresholdMin: f32,
    subpixel: f32,
    // Scalar padding keeps this structure aligned with the existing 32-byte buffer.
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

@group(0) @binding(0) var<uniform> uniforms: FXAAUniforms;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32((vertexIndex & 1u) << 2u) - 1.0;
    let y = f32((vertexIndex & 2u) << 1u) - 1.0;
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return output;
}

fn luma(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let texelSize = vec2<f32>(uniforms.texelSizeX, uniforms.texelSizeY);
    let uv = input.uv;
    
    // Sample center and neighbors
    let rgbM = textureSampleLevel(colorTex, texSampler, uv, 0.0).rgb;
    let rgbNW = textureSampleLevel(colorTex, texSampler, uv + vec2<f32>(-1.0, -1.0) * texelSize, 0.0).rgb;
    let rgbNE = textureSampleLevel(colorTex, texSampler, uv + vec2<f32>(1.0, -1.0) * texelSize, 0.0).rgb;
    let rgbSW = textureSampleLevel(colorTex, texSampler, uv + vec2<f32>(-1.0, 1.0) * texelSize, 0.0).rgb;
    let rgbSE = textureSampleLevel(colorTex, texSampler, uv + vec2<f32>(1.0, 1.0) * texelSize, 0.0).rgb;
    let rgbN = textureSampleLevel(colorTex, texSampler, uv + vec2<f32>(0.0, -1.0) * texelSize, 0.0).rgb;
    let rgbS = textureSampleLevel(colorTex, texSampler, uv + vec2<f32>(0.0, 1.0) * texelSize, 0.0).rgb;
    let rgbW = textureSampleLevel(colorTex, texSampler, uv + vec2<f32>(-1.0, 0.0) * texelSize, 0.0).rgb;
    let rgbE = textureSampleLevel(colorTex, texSampler, uv + vec2<f32>(1.0, 0.0) * texelSize, 0.0).rgb;
    
    // Compute luma
    let lumaM = luma(rgbM);
    let lumaNW = luma(rgbNW);
    let lumaNE = luma(rgbNE);
    let lumaSW = luma(rgbSW);
    let lumaSE = luma(rgbSE);
    let lumaN = luma(rgbN);
    let lumaS = luma(rgbS);
    let lumaW = luma(rgbW);
    let lumaE = luma(rgbE);
    
    // Find min/max luma
    let diagonalMin = min(min(lumaNW, lumaNE), min(lumaSW, lumaSE));
    let diagonalMax = max(max(lumaNW, lumaNE), max(lumaSW, lumaSE));
    let cardinalMin = min(min(lumaN, lumaS), min(lumaW, lumaE));
    let cardinalMax = max(max(lumaN, lumaS), max(lumaW, lumaE));
    let lumaMin = min(lumaM, min(diagonalMin, cardinalMin));
    let lumaMax = max(lumaM, max(diagonalMax, cardinalMax));
    let lumaRange = lumaMax - lumaMin;
    
    // Skip if contrast too low
    if (lumaRange < max(uniforms.edgeThresholdMin, lumaMax * uniforms.edgeThreshold)) {
        return vec4<f32>(rgbM, 1.0);
    }
    
    // Compute edge direction
    let dirX = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    let dirY = ((lumaNW + lumaSW) - (lumaNE + lumaSE));
    
    let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * 0.25, 1.0 / 128.0);
    let rcpDirMin = 1.0 / (min(abs(dirX), abs(dirY)) + dirReduce);
    
    var dir = vec2<f32>(dirX, dirY) * rcpDirMin;
    dir = clamp(dir, vec2<f32>(-8.0), vec2<f32>(8.0)) * texelSize;
    
    // This branch is pixel-dependent. Explicit LOD avoids implicit derivatives
    // in nonuniform control flow; the resolved scene has one mip level.
    let rgbA = 0.5 * (
        textureSampleLevel(colorTex, texSampler, uv + dir * (1.0 / 3.0 - 0.5), 0.0).rgb +
        textureSampleLevel(colorTex, texSampler, uv + dir * (2.0 / 3.0 - 0.5), 0.0).rgb
    );
    
    let rgbB = rgbA * 0.5 + 0.25 * (
        textureSampleLevel(colorTex, texSampler, uv + dir * -0.5, 0.0).rgb +
        textureSampleLevel(colorTex, texSampler, uv + dir * 0.5, 0.0).rgb
    );
    
    let lumaB = luma(rgbB);
    
    let edgeColor = select(rgbB, rgbA, lumaB < lumaMin || lumaB > lumaMax);

    // An isolated bevel sample has no diagonal edge direction. Detect its
    // contrast against the four adjacent pixels, then blend toward the 3x3
    // low-pass color. The trim leaves resolved straight edges untouched.
    // Adapted from Timothy Lottes, FXAA Whitepaper, "Sub-pixel Aliasing Test":
    // https://developer.download.nvidia.com/assets/gamedev/files/sdk/11/FXAA_WhitePaper.pdf
    let neighborLuma = (lumaN + lumaS + lumaW + lumaE) * 0.25;
    let pixelContrast = abs(neighborLuma - lumaM) / max(lumaRange, 1e-6);
    let subpixelBlend = min(clamp(uniforms.subpixel, 0.0, 1.0), max(0.0, pixelContrast - 0.25) * (4.0 / 3.0));
    let lowPassColor = (rgbM + rgbN + rgbS + rgbW + rgbE + rgbNW + rgbNE + rgbSW + rgbSE) / 9.0;
    return vec4<f32>(mix(edgeColor, lowPassColor, subpixelBlend), 1.0);
}
`;

export class FXAAPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        this.quality = 2;
        this.edgeThreshold = 0.125;
        this.edgeThresholdMin = 0.0312;
        this.subpixel = 0.75;
        this.width = 1920;
        this.height = 1080;
        
        this.pipeline = null;
        this.uniformBuffer = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(8);
    }
    
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create resources using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'FXAAUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('fxaa', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('fxaa', FXAA_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'FXAAPipeline'
        });
        
        this.initialized = true;
    }
    
    setSize(width, height) {
        this.width = width;
        this.height = height;
    }
    
    updateUniforms() {
        if (!this.initialized) return;
        // Use pre-allocated buffer to avoid per-update allocations
        this._uniformData[0] = 1.0 / this.width;
        this._uniformData[1] = 1.0 / this.height;
        this._uniformData[2] = this.edgeThreshold;
        this._uniformData[3] = this.edgeThresholdMin;
        this._uniformData[4] = this.subpixel;
        this._uniformData[5] = 0;
        this._uniformData[6] = 0;
        this._uniformData[7] = 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.quality = parseInt(cfg.quality) || 2;
        this.edgeThreshold = parseFloat(cfg.edge_threshold) || 0.125;
        this.edgeThresholdMin = parseFloat(cfg.edge_threshold_min) || 0.0312;
        const subpixel = parseFloat(cfg.subpixel);
        this.subpixel = Number.isFinite(subpixel) ? Math.max(0, Math.min(1, subpixel)) : 0.75;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default FXAAPass;
