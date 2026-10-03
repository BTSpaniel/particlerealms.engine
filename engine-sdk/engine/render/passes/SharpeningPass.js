// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SharpeningPass.js - Contrast Adaptive Sharpening (CAS)
 * Now powered by vGPU driver
 * 
 * AMD FidelityFX CAS-inspired sharpening for crisp visuals
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const CAS_SHADER = /* wgsl */ `
struct SharpeningUniforms {
    sharpness: f32,
    texelSizeX: f32,
    texelSizeY: f32,
    _pad: f32,
}

@group(0) @binding(0) var<uniform> uniforms: SharpeningUniforms;
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

fn getLuma(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let texelSize = vec2<f32>(uniforms.texelSizeX, uniforms.texelSizeY);
    
    // Sample 3x3 neighborhood
    let a = textureSample(colorTex, texSampler, input.uv + vec2<f32>(-1.0, -1.0) * texelSize).rgb;
    let b = textureSample(colorTex, texSampler, input.uv + vec2<f32>( 0.0, -1.0) * texelSize).rgb;
    let c = textureSample(colorTex, texSampler, input.uv + vec2<f32>( 1.0, -1.0) * texelSize).rgb;
    let d = textureSample(colorTex, texSampler, input.uv + vec2<f32>(-1.0,  0.0) * texelSize).rgb;
    let e = textureSample(colorTex, texSampler, input.uv).rgb; // Center
    let f = textureSample(colorTex, texSampler, input.uv + vec2<f32>( 1.0,  0.0) * texelSize).rgb;
    let g = textureSample(colorTex, texSampler, input.uv + vec2<f32>(-1.0,  1.0) * texelSize).rgb;
    let h = textureSample(colorTex, texSampler, input.uv + vec2<f32>( 0.0,  1.0) * texelSize).rgb;
    let i = textureSample(colorTex, texSampler, input.uv + vec2<f32>( 1.0,  1.0) * texelSize).rgb;
    
    // Get luma values
    let lumaA = getLuma(a);
    let lumaB = getLuma(b);
    let lumaC = getLuma(c);
    let lumaD = getLuma(d);
    let lumaE = getLuma(e);
    let lumaF = getLuma(f);
    let lumaG = getLuma(g);
    let lumaH = getLuma(h);
    let lumaI = getLuma(i);
    
    // Calculate min/max luma in cross pattern
    let minLuma = min(lumaE, min(min(lumaB, lumaD), min(lumaF, lumaH)));
    let maxLuma = max(lumaE, max(max(lumaB, lumaD), max(lumaF, lumaH)));
    
    // Calculate adaptive sharpening weight
    let contrast = maxLuma - minLuma;
    let sharpWeight = uniforms.sharpness * (1.0 - contrast);
    
    // Apply sharpening
    let blur = (b + d + f + h) * 0.25;
    let sharp = e + (e - blur) * sharpWeight;
    
    return vec4<f32>(sharp, 1.0);
}
`;

export class SharpeningPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        this.method = 'cas';
        this.intensity = 0.5;
        this.casSharpness = 0.4;
        this.width = 1920;
        this.height = 1080;
        
        this.pipeline = null;
        this.uniformBuffer = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(4);
    }
    
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 16, usage: 'uniform', label: 'SharpeningUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('sharpening', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('sharpening', CAS_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'SharpeningPipeline'
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
        this._uniformData[0] = this.casSharpness * this.intensity;
        this._uniformData[1] = 1.0 / this.width;
        this._uniformData[2] = 1.0 / this.height;
        this._uniformData[3] = 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.method = cfg.method || 'cas';
        this.intensity = parseFloat(cfg.intensity) || 0.5;
        this.casSharpness = parseFloat(cfg.cas_sharpness) || 0.4;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default SharpeningPass;
