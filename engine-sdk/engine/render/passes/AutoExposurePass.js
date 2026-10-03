// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AutoExposurePass.js - Eye Adaptation / Auto Exposure
 * Now powered by vGPU driver
 * 
 * Simulates human eye adaptation to brightness changes:
 * - Histogram-based luminance measurement
 * - Smooth adaptation over time
 * - Min/max EV limits
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const LUMINANCE_SHADER = /* wgsl */ `
@group(0) @binding(0) var colorTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> histogram: array<atomic<u32>, 256>;

@compute @workgroup_size(8, 8)
fn cs_histogram(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = textureDimensions(colorTex);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }
    
    let color = textureLoad(colorTex, vec2<i32>(gid.xy), 0).rgb;
    let luma = dot(color, vec3<f32>(0.299, 0.587, 0.114));
    
    // Map luminance to histogram bin (0-255)
    let bin = u32(clamp(luma * 255.0, 0.0, 255.0));
    atomicAdd(&histogram[bin], 1u);
}
`;

const EXPOSURE_SHADER = /* wgsl */ `
struct ExposureUniforms {
    minEV: f32,
    maxEV: f32,
    targetBrightness: f32,
    adaptationSpeed: f32,
    deltaTime: f32,
    currentExposure: f32,
    _pad: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: ExposureUniforms;
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
    let color = textureSample(colorTex, texSampler, input.uv).rgb;
    let exposed = color * uniforms.currentExposure;
    return vec4<f32>(exposed, 1.0);
}
`;

export class AutoExposurePass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        this.minEV = -4.0;
        this.maxEV = 16.0;
        this.target = 0.5;
        this.adaptationSpeed = 1.0;
        this.eyeAdaptation = true;
        
        this.currentExposure = 1.0;
        this.targetExposure = 1.0;
        
        this.pipeline = null;
        this.uniformBuffer = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(8);
    }
    
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'AutoExposureUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('autoExposure', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('autoExposure', EXPOSURE_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'AutoExposurePipeline'
        });
        
        this.initialized = true;
    }
    
    update(deltaTime, averageLuminance) {
        if (!this.enabled || !this.eyeAdaptation) return;
        
        // Calculate target exposure from luminance
        const targetLuma = this.target;
        const currentLuma = Math.max(averageLuminance, 0.001);
        this.targetExposure = targetLuma / currentLuma;
        
        // Clamp to EV range
        const minExposure = Math.pow(2, this.minEV);
        const maxExposure = Math.pow(2, this.maxEV);
        this.targetExposure = Math.max(minExposure, Math.min(maxExposure, this.targetExposure));
        
        // Smooth adaptation
        const adaptRate = 1.0 - Math.exp(-deltaTime / this.adaptationSpeed);
        this.currentExposure += (this.targetExposure - this.currentExposure) * adaptRate;
    }
    
    updateUniforms(deltaTime = 0.016) {
        if (!this.initialized) return;
        // Use pre-allocated buffer to avoid per-update allocations
        this._uniformData[0] = this.minEV;
        this._uniformData[1] = this.maxEV;
        this._uniformData[2] = this.target;
        this._uniformData[3] = this.adaptationSpeed;
        this._uniformData[4] = deltaTime;
        this._uniformData[5] = this.currentExposure;
        this._uniformData[6] = 0;
        this._uniformData[7] = 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.minEV = parseFloat(cfg.min_ev) || -4.0;
        this.maxEV = parseFloat(cfg.max_ev) || 16.0;
        this.target = parseFloat(cfg.target) || 0.5;
        this.adaptationSpeed = parseFloat(cfg.adaptation_speed) || 1.0;
        this.eyeAdaptation = cfg.eye_adaptation !== false;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default AutoExposurePass;
