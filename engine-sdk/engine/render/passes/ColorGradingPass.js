// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ColorGradingPass.js - Color Grading & LUT Support
 * Now powered by vGPU driver
 * 
 * Professional color grading with:
 * - Temperature/tint adjustment
 * - Shadows/midtones/highlights color wheels
 * - Lift/gamma/gain controls
 * - LUT texture support
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

const COLOR_GRADING_STRUCT = `struct ColorGradingUniforms {
    temperature: f32,
    tint: f32,
    lift: f32,
    gamma: f32,
    gain: f32,
    _pad: vec3<f32>,
    shadowsColor: vec3<f32>,
    _pad2: f32,
    midtonesColor: vec3<f32>,
    _pad3: f32,
    highlightsColor: vec3<f32>,
    _pad4: f32,
}`;
const _colorGradingUniformData = new Float32Array(getFloat32ArraySize(COLOR_GRADING_STRUCT));

const COLOR_GRADING_SHADER = /* wgsl */ `
${COLOR_GRADING_STRUCT}

@group(0) @binding(0) var<uniform> uniforms: ColorGradingUniforms;
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

// Temperature to RGB (approximation)
fn temperatureToRGB(temp: f32) -> vec3<f32> {
    let t = temp / 100.0;
    var color = vec3<f32>(1.0);
    
    if (t < 0.0) {
        // Cool (blue shift)
        color.r = 1.0 + t * 0.3;
        color.b = 1.0 - t * 0.2;
    } else {
        // Warm (orange shift)
        color.r = 1.0 + t * 0.2;
        color.b = 1.0 - t * 0.3;
    }
    
    return color;
}

// Tint adjustment (green-magenta axis)
fn applyTint(color: vec3<f32>, tint: f32) -> vec3<f32> {
    let t = tint / 100.0;
    var result = color;
    result.g = color.g * (1.0 - abs(t) * 0.3);
    if (t > 0.0) {
        result.r = color.r * (1.0 + t * 0.2);
    } else {
        result.b = color.b * (1.0 - t * 0.2);
    }
    return result;
}

// Lift/Gamma/Gain
fn liftGammaGain(color: vec3<f32>, lift: f32, gamma: f32, gain: f32) -> vec3<f32> {
    var result = color;
    
    // Lift (shadows)
    result = result + vec3<f32>(lift);
    
    // Gamma (midtones)
    let invGamma = 1.0 / max(gamma, 0.001);
    result = pow(max(result, vec3<f32>(0.0)), vec3<f32>(invGamma));
    
    // Gain (highlights)
    result = result * vec3<f32>(gain);
    
    return result;
}

// Shadow/midtone/highlight separation
fn colorWheels(color: vec3<f32>, shadows: vec3<f32>, midtones: vec3<f32>, highlights: vec3<f32>) -> vec3<f32> {
    let luma = dot(color, vec3<f32>(0.299, 0.587, 0.114));
    
    // Weight masks
    let shadowWeight = 1.0 - smoothstep(0.0, 0.33, luma);
    let highlightWeight = smoothstep(0.66, 1.0, luma);
    let midtoneWeight = 1.0 - shadowWeight - highlightWeight;
    
    var result = color;
    result = result * mix(vec3<f32>(1.0), shadows, shadowWeight);
    result = result * mix(vec3<f32>(1.0), midtones, midtoneWeight);
    result = result * mix(vec3<f32>(1.0), highlights, highlightWeight);
    
    return result;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    var color = textureSample(colorTex, texSampler, input.uv).rgb;
    
    // Apply temperature
    color = color * temperatureToRGB(uniforms.temperature);
    
    // Apply tint
    color = applyTint(color, uniforms.tint);
    
    // Apply color wheels
    color = colorWheels(color, uniforms.shadowsColor, uniforms.midtonesColor, uniforms.highlightsColor);
    
    // Apply lift/gamma/gain
    color = liftGammaGain(color, uniforms.lift, uniforms.gamma, uniforms.gain);
    
    return vec4<f32>(color, 1.0);
}
`;

export class ColorGradingPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        this.temperature = 0;
        this.tint = 0;
        this.shadowsColor = [1.0, 1.0, 1.0];
        this.midtonesColor = [1.0, 1.0, 1.0];
        this.highlightsColor = [1.0, 1.0, 1.0];
        this.lift = 0.0;
        this.gamma = 1.0;
        this.gain = 1.0;
        this.lutTexture = null;
        
        this.pipeline = null;
        this.uniformBuffer = null;
    }
    
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 80, usage: 'uniform', label: 'ColorGradingUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('colorGrading', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('colorGrading', COLOR_GRADING_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            topology: 'triangle-list',
            label: 'ColorGradingPipeline'
        });
        
        this.initialized = true;
    }
    
    updateUniforms() {
        if (!this.initialized) return;
        
        // Reuse module-level buffer
        _colorGradingUniformData[0] = this.temperature;
        _colorGradingUniformData[1] = this.tint;
        _colorGradingUniformData[2] = this.lift;
        _colorGradingUniformData[3] = this.gamma;
        _colorGradingUniformData[4] = this.gain;
        _colorGradingUniformData[5] = 0;
        _colorGradingUniformData[6] = 0;
        _colorGradingUniformData[7] = 0;
        _colorGradingUniformData[8] = this.shadowsColor[0];
        _colorGradingUniformData[9] = this.shadowsColor[1];
        _colorGradingUniformData[10] = this.shadowsColor[2];
        _colorGradingUniformData[11] = 0;
        _colorGradingUniformData[12] = this.midtonesColor[0];
        _colorGradingUniformData[13] = this.midtonesColor[1];
        _colorGradingUniformData[14] = this.midtonesColor[2];
        _colorGradingUniformData[15] = 0;
        _colorGradingUniformData[16] = this.highlightsColor[0];
        _colorGradingUniformData[17] = this.highlightsColor[1];
        _colorGradingUniformData[18] = this.highlightsColor[2];
        _colorGradingUniformData[19] = 0;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _colorGradingUniformData);
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.temperature = parseFloat(cfg.temperature) || 0;
        this.tint = parseFloat(cfg.tint) || 0;
        this.shadowsColor = [
            parseFloat(cfg.shadows_r) || 1.0,
            parseFloat(cfg.shadows_g) || 1.0,
            parseFloat(cfg.shadows_b) || 1.0,
        ];
        this.midtonesColor = [
            parseFloat(cfg.midtones_r) || 1.0,
            parseFloat(cfg.midtones_g) || 1.0,
            parseFloat(cfg.midtones_b) || 1.0,
        ];
        this.highlightsColor = [
            parseFloat(cfg.highlights_r) || 1.0,
            parseFloat(cfg.highlights_g) || 1.0,
            parseFloat(cfg.highlights_b) || 1.0,
        ];
        this.lift = parseFloat(cfg.lift) || 0.0;
        this.gamma = parseFloat(cfg.gamma) || 1.0;
        this.gain = parseFloat(cfg.gain) || 1.0;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default ColorGradingPass;
