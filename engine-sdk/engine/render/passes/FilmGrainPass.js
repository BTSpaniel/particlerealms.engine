// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FilmGrainPass.js - Cinematic Film Grain Effect
 * Now powered by vGPU driver
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const FILM_GRAIN_SHADER = /* wgsl */ `
struct FilmGrainUniforms {
    intensity: f32,
    size: f32,
    time: f32,
    response: f32,
}

@group(0) @binding(0) var<uniform> uniforms: FilmGrainUniforms;
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

fn hash(p: vec2<f32>) -> f32 {
    let p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    let p3d = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3d.x + p3d.y) * p3d.z);
}

fn grain(uv: vec2<f32>, time: f32, size: f32) -> f32 {
    let scaledUV = uv * size + vec2<f32>(time * 100.0);
    return hash(scaledUV) * 2.0 - 1.0;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    var color = textureSample(colorTex, texSampler, input.uv);
    
    let luminance = dot(color.rgb, vec3<f32>(0.299, 0.587, 0.114));
    let grainResponse = mix(1.0, 1.0 - luminance, uniforms.response);
    
    let grainValue = grain(input.uv, uniforms.time, uniforms.size);
    let grainAmount = grainValue * uniforms.intensity * grainResponse;
    
    color.r += grainAmount;
    color.g += grainAmount;
    color.b += grainAmount;
    
    return color;
}
`;

export class FilmGrainPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;
        
        this.intensity = 0.1;
        this.size = 1.0;
        this.animated = true;
        this.response = 0.8;
        this.time = 0;
        
        this.pipeline = null;
        this.uniformBuffer = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(4);
    }
    
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 16, usage: 'uniform', label: 'FilmGrainUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('filmGrain', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('filmGrain', FILM_GRAIN_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'FilmGrainPipeline'
        });
        
        this.initialized = true;
    }
    
    update(deltaTime) {
        if (this.animated) {
            this.time += deltaTime;
        }
    }
    
    updateUniforms() {
        if (!this.initialized) return;
        // Use pre-allocated buffer to avoid per-update allocations
        this._uniformData[0] = this.intensity;
        this._uniformData[1] = this.size;
        this._uniformData[2] = this.time;
        this._uniformData[3] = this.response;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        this.enabled = cfg.enabled === true;
        this.intensity = parseFloat(cfg.intensity) || 0.1;
        this.size = parseFloat(cfg.size) || 1.0;
        this.animated = cfg.animated !== false;
        this.response = parseFloat(cfg.response) || 0.8;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default FilmGrainPass;
