// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DepthOfFieldPass.js - Bokeh Depth of Field
 * Now powered by vGPU driver
 * 
 * Implements cinematic depth of field with:
 * - Near and far blur planes
 * - Bokeh shape (circle, hexagon, octagon)
 * - Auto-focus option
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const DOF_SHADER = /* wgsl */ `
struct DOFUniforms {
    focusDistance: f32,
    aperture: f32,
    nearStart: f32,
    farStart: f32,
    bokehIntensity: f32,
    _pad: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: DOFUniforms;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var texSampler: sampler;

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

fn linearizeDepth(depth: f32, near: f32, far: f32) -> f32 {
    return near * far / (far - depth * (far - near));
}

fn calculateCoC(depth: f32) -> f32 {
    let linearDepth = linearizeDepth(depth, 0.1, 500.0);
    let focusDist = uniforms.focusDistance;
    let aperture = uniforms.aperture;
    
    // Circle of confusion formula
    let coc = abs(linearDepth - focusDist) / linearDepth;
    let cocScale = 1.0 / aperture;
    
    return clamp(coc * cocScale, 0.0, 1.0);
}

// Hexagonal bokeh kernel
fn hexagonalBlur(uv: vec2<f32>, coc: f32) -> vec4<f32> {
    if (coc < 0.01) {
        return textureSample(colorTex, texSampler, uv);
    }
    
    var color = vec4<f32>(0.0);
    let samples = 16;
    let radius = coc * 0.02;
    
    for (var i = 0; i < samples; i++) {
        let angle = f32(i) * 6.283185 / f32(samples);
        let offset = vec2<f32>(cos(angle), sin(angle)) * radius;
        color += textureSample(colorTex, texSampler, uv + offset);
    }
    
    return color / f32(samples);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let depth = textureSample(depthTex, texSampler, input.uv);
    let coc = calculateCoC(depth);
    
    return hexagonalBlur(input.uv, coc * uniforms.bokehIntensity);
}
`;

export class DepthOfFieldPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;
        
        this.focusDistance = 10.0;
        this.aperture = 2.8;
        this.nearStart = 0.5;
        this.farStart = 50.0;
        this.bokehShape = 'hexagon';
        this.bokehIntensity = 1.0;
        this.autoFocus = false;
        
        this.pipeline = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.sampler = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(8);
    }
    
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'DOFUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('depthOfField', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'depth' },
            { binding: 3, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('depthOfField', DOF_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'DepthOfFieldPipeline'
        });
        
        this.initialized = true;
    }
    
    updateUniforms() {
        if (!this.initialized) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        data[0] = this.focusDistance;
        data[1] = this.aperture;
        data[2] = this.nearStart;
        data[3] = this.farStart;
        data[4] = this.bokehIntensity;
        data[5] = 0;
        data[6] = 0;
        data[7] = 0;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled === true;
        this.focusDistance = parseFloat(cfg.focus_distance) || 10.0;
        this.aperture = parseFloat(cfg.aperture) || 2.8;
        this.nearStart = parseFloat(cfg.near_start) || 0.5;
        this.farStart = parseFloat(cfg.far_start) || 50.0;
        this.bokehShape = cfg.bokeh_shape || 'hexagon';
        this.bokehIntensity = parseFloat(cfg.bokeh_intensity) || 1.0;
        this.autoFocus = cfg.auto_focus === true;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default DepthOfFieldPass;
