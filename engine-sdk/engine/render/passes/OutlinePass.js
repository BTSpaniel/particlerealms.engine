// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * OutlinePass.js - Screen-Space Outline/Edge Detection
 * Now powered by vGPU driver
 * 
 * Detects edges using depth and normal discontinuities
 * Perfect for stylized rendering or selection highlights
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const OUTLINE_SHADER = /* wgsl */ `
struct OutlineUniforms {
    color: vec3<f32>,
    thickness: f32,
    depthThreshold: f32,
    normalThreshold: f32,
    texelSizeX: f32,
    texelSizeY: f32,
}

@group(0) @binding(0) var<uniform> uniforms: OutlineUniforms;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var texSampler: sampler;

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

fn sampleDepth(uv: vec2<f32>) -> f32 {
    return textureSample(depthTex, texSampler, uv);
}

fn sampleNormal(uv: vec2<f32>) -> vec3<f32> {
    return textureSample(normalTex, texSampler, uv).xyz * 2.0 - 1.0;
}

fn robertsCross(samples: array<f32, 4>) -> f32 {
    let diff1 = samples[0] - samples[3];
    let diff2 = samples[1] - samples[2];
    return sqrt(diff1 * diff1 + diff2 * diff2);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let texelSize = vec2<f32>(uniforms.texelSizeX, uniforms.texelSizeY) * uniforms.thickness;
    let color = textureSample(colorTex, texSampler, input.uv);
    
    // Sample depth at 4 corners
    let d0 = sampleDepth(input.uv + vec2<f32>(-1.0, -1.0) * texelSize);
    let d1 = sampleDepth(input.uv + vec2<f32>(1.0, -1.0) * texelSize);
    let d2 = sampleDepth(input.uv + vec2<f32>(-1.0, 1.0) * texelSize);
    let d3 = sampleDepth(input.uv + vec2<f32>(1.0, 1.0) * texelSize);
    
    let depthEdge = robertsCross(array<f32, 4>(d0, d1, d2, d3));
    
    // Sample normals at 4 corners
    let n0 = sampleNormal(input.uv + vec2<f32>(-1.0, -1.0) * texelSize);
    let n1 = sampleNormal(input.uv + vec2<f32>(1.0, -1.0) * texelSize);
    let n2 = sampleNormal(input.uv + vec2<f32>(-1.0, 1.0) * texelSize);
    let n3 = sampleNormal(input.uv + vec2<f32>(1.0, 1.0) * texelSize);
    
    let normalEdge = length(n0 - n3) + length(n1 - n2);
    
    // Combine edges
    let isEdge = step(uniforms.depthThreshold, depthEdge) + 
                 step(uniforms.normalThreshold, normalEdge);
    
    let edgeMask = clamp(isEdge, 0.0, 1.0);
    
    return vec4<f32>(mix(color.rgb, uniforms.color, edgeMask), color.a);
}
`;

export class OutlinePass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;
        
        this.color = [0.0, 0.0, 0.0];
        this.thickness = 1.0;
        this.depthThreshold = 0.1;
        this.normalThreshold = 0.5;
        this.selectionOnly = false;
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
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'OutlineUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('outline', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'depth' },
            { binding: 3, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 4, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('outline', OUTLINE_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'OutlinePipeline'
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
        this._uniformData[0] = this.color[0];
        this._uniformData[1] = this.color[1];
        this._uniformData[2] = this.color[2];
        this._uniformData[3] = this.thickness;
        this._uniformData[4] = this.depthThreshold;
        this._uniformData[5] = this.normalThreshold;
        this._uniformData[6] = 1.0 / this.width;
        this._uniformData[7] = 1.0 / this.height;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled === true;
        this.color = [
            parseFloat(cfg.color_r) || 0.0,
            parseFloat(cfg.color_g) || 0.0,
            parseFloat(cfg.color_b) || 0.0,
        ];
        this.thickness = parseFloat(cfg.thickness) || 1.0;
        this.depthThreshold = parseFloat(cfg.depth_threshold) || 0.1;
        this.normalThreshold = parseFloat(cfg.normal_threshold) || 0.5;
        this.selectionOnly = cfg.selection_only === true;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default OutlinePass;
