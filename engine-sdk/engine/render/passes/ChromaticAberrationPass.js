// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChromaticAberrationPass.js - RGB Channel Separation Effect
 * Now powered by vGPU driver
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const CA_SHADER = /* wgsl */ `
struct CAUniforms {
    intensity: f32,
    radialOffset: f32,
    offsetR: f32,
    offsetB: f32,
}

@group(0) @binding(0) var<uniform> uniforms: CAUniforms;
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

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let center = vec2<f32>(0.5);
    let dir = input.uv - center;
    let dist = length(dir);
    
    let radialMult = 1.0 + dist * uniforms.radialOffset;
    let offsetR = dir * uniforms.offsetR * uniforms.intensity * radialMult;
    let offsetB = dir * uniforms.offsetB * uniforms.intensity * radialMult;
    
    let r = textureSample(colorTex, texSampler, input.uv + offsetR).r;
    let g = textureSample(colorTex, texSampler, input.uv).g;
    let b = textureSample(colorTex, texSampler, input.uv + offsetB).b;
    
    return vec4<f32>(r, g, b, 1.0);
}
`;

export class ChromaticAberrationPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;
        
        this.intensity = 0.1;
        this.radialOffset = 0.0;
        this.offsetR = 0.002;
        this.offsetG = 0.0;
        this.offsetB = -0.002;
        
        this.pipeline = null;
        this.uniformBuffer = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(4);
    }
    
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 16, usage: 'uniform', label: 'ChromaticAberrationUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('chromaticAberration', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('chromaticAberration', CA_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'ChromaticAberrationPipeline'
        });
        
        this.initialized = true;
    }
    
    updateUniforms() {
        if (!this.initialized) return;
        // Use pre-allocated buffer to avoid per-update allocations
        this._uniformData[0] = this.intensity;
        this._uniformData[1] = this.radialOffset;
        this._uniformData[2] = this.offsetR;
        this._uniformData[3] = this.offsetB;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        this.enabled = cfg.enabled === true;
        this.intensity = parseFloat(cfg.intensity) || 0.1;
        this.radialOffset = parseFloat(cfg.radial_offset) || 0.0;
        this.offsetR = parseFloat(cfg.offset_r) || 0.002;
        this.offsetB = parseFloat(cfg.offset_b) || -0.002;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default ChromaticAberrationPass;
