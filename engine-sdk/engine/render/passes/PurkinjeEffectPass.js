// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PurkinjeEffectPass.js - Night Vision Color Shift
 * Now powered by vGPU driver
 * 
 * Simulates the Purkinje effect - the human eye's shift toward blue sensitivity
 * in low light conditions. Rod cells (active in dim light) are more sensitive
 * to blue-green wavelengths than cone cells (active in bright light).
 * 
 * Effects:
 * - Blue shift in dark areas
 * - Desaturation (rods don't perceive color)
 * - Increased sensitivity to blue-green
 * - Reduced red sensitivity
 * 
 * Parameters:
 * - intensity: Overall effect strength (0-1)
 * - luminanceThreshold: Light level below which effect activates
 * - blueShift: How much to shift toward blue
 * - desaturation: How much to remove color
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Comprehensive Mesopic Vision Model
// Based on CIE mesopic photometry and visual science research
// References:
// - CIE 191:2010 - Recommended System for Mesopic Photometry
// - MPI Perceptual Effects in Real-time Tone Mapping (SCCG 2005)
// - SIGGRAPH 2021 Patry - Rod intrusion model
// MIT License - Mynx 2024

const PURKINJE_SHADER = /* wgsl */ `
struct PurkinjeUniforms {
    intensity: f32,           // Overall effect strength (0-1)
    adaptationLuminance: f32, // Scene adaptation luminance (cd/m²)
    mesopicLow: f32,          // Low end of mesopic range (default 0.01)
    mesopicHigh: f32,         // High end of mesopic range (default 3.0)
    adaptation: f32,          // Eye adaptation level (0=day, 1=night)
    desaturation: f32,        // Desaturation strength
    noiseAmount: f32,         // Scotopic noise amount
    enabled: f32,             // Toggle
}

@group(0) @binding(0) var<uniform> uniforms: PurkinjeUniforms;
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

// === CIE LUMINANCE FUNCTIONS ===

// Photopic luminance (cone vision) - peaks at 555nm (green-yellow)
// Standard CIE 1931 V(λ) weights
fn getPhotopicLuminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// Scotopic luminance (rod vision) - peaks at 507nm (blue-green)
// CIE 1951 V'(λ) weights - rods are more sensitive to blue
fn getScotopicLuminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.0621, 0.6081, 0.3298));
}

// === MESOPIC BLEND FUNCTION ===
// CIE 191:2010 recommended mesopic luminosity function
// Vmes(λ) = x·V(λ) + (1-x)·V'(λ)
// x varies from 0 (scotopic) to 1 (photopic) based on luminance

fn getMesopicBlendFactor(luminance: f32, lowThresh: f32, highThresh: f32) -> f32 {
    // Convert to log scale for perceptually linear transition
    let logLum = log2(max(luminance, 0.0001));
    let logLow = log2(max(lowThresh, 0.0001));
    let logHigh = log2(max(highThresh, 0.0001));
    
    // Smooth S-curve transition through mesopic range
    let t = (logLum - logLow) / (logHigh - logLow);
    
    // Use smootherstep for natural transition (Ken Perlin's improved smoothstep)
    let clamped = clamp(t, 0.0, 1.0);
    return clamped * clamped * clamped * (clamped * (clamped * 6.0 - 15.0) + 10.0);
}

// === SPECTRAL SHIFT (PURKINJE EFFECT) ===
// Shift color perception from photopic (555nm peak) to scotopic (507nm peak)
// Reds darken, blues brighten - NO green boost (green stays neutral)

fn applySpectralShift(color: vec3<f32>, scotopicFactor: f32) -> vec3<f32> {
    // Scotopic sensitivity - reduce red, keep green neutral, slight blue boost
    // Avoiding green boost prevents the green tint issue
    let scotopicSensitivity = vec3<f32>(0.4, 0.95, 1.15);
    
    // Blend between photopic (1,1,1) and scotopic sensitivity
    let sensitivity = mix(vec3<f32>(1.0), scotopicSensitivity, scotopicFactor);
    
    return color * sensitivity;
}

// === DESATURATION ===
// Rods cannot distinguish colors - vision becomes monochromatic
// Colors drift toward a dull blue-purple (NOT green)

fn applyDesaturation(color: vec3<f32>, scotopicFactor: f32, strength: f32) -> vec3<f32> {
    // Use scotopic luminance for the gray value
    let scotopicLum = getScotopicLuminance(color);
    
    // Pure neutral gray with subtle blue tint (no green)
    let scotopicGray = vec3<f32>(
        scotopicLum * 0.92,  // Reduce red
        scotopicLum * 0.92,  // Reduce green equally (no green boost!)
        scotopicLum * 1.05   // Slight blue
    );
    
    // Blend toward desaturated based on scotopic factor
    let desatAmount = scotopicFactor * strength;
    return mix(color, scotopicGray, desatAmount);
}

// === NOISE (REDUCED ACUITY) ===
// Scotopic vision has reduced spatial acuity - add subtle noise

fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn applyScotopicNoise(color: vec3<f32>, uv: vec2<f32>, amount: f32) -> vec3<f32> {
    let noise = (hash(uv * 500.0) - 0.5) * 2.0 * amount;
    return color + vec3<f32>(noise);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(colorTex, texSampler, input.uv);
    
    if (uniforms.enabled < 0.5) {
        return color;
    }
    
    // Get pixel luminance
    let photopicLum = getPhotopicLuminance(color.rgb);
    
    // Calculate mesopic blend factor (1 = full photopic, 0 = full scotopic)
    let mesopicX = getMesopicBlendFactor(
        photopicLum * uniforms.adaptationLuminance,
        uniforms.mesopicLow,
        uniforms.mesopicHigh
    );
    
    // Scotopic factor (inverse of mesopic blend, modulated by adaptation)
    let scotopicFactor = (1.0 - mesopicX) * uniforms.adaptation * uniforms.intensity;
    
    // Skip processing if fully photopic
    if (scotopicFactor < 0.001) {
        return color;
    }
    
    var result = color.rgb;
    
    // 1. Apply spectral shift (Purkinje effect)
    result = applySpectralShift(result, scotopicFactor);
    
    // 2. Apply desaturation (rods don't see color)
    result = applyDesaturation(result, scotopicFactor, uniforms.desaturation);
    
    // 3. Apply subtle noise for reduced acuity (only at high scotopic levels)
    if (scotopicFactor > 0.5 && uniforms.noiseAmount > 0.0) {
        result = applyScotopicNoise(result, input.uv, uniforms.noiseAmount * (scotopicFactor - 0.5));
    }
    
    return vec4<f32>(result, color.a);
}
`;

export class PurkinjeEffectPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        // Effect parameters (CIE-based mesopic vision model)
        this.intensity = 0.3;           // Reduced for subtle effect
        this.adaptationLuminance = 1.0; // Scene adaptation luminance (cd/m²)
        this.mesopicLow = 0.005;        // Lower scotopic threshold
        this.mesopicHigh = 2.0;         // Lower photopic threshold
        this.adaptation = 0.0;          // Current eye adaptation (0=day, 1=night)
        this.desaturation = 0.5;        // Reduced desaturation
        this.noiseAmount = 0.01;        // Very subtle noise
        
        // Adaptation timing
        this.targetAdaptation = 0.0;
        this.adaptationSpeed = 0.5;     // Seconds to adapt
        
        // GPU resources
        this.pipeline = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.sampler = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(8);
    }
    
    /**
     * Initialize GPU resources
     */
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.format = format;
        
        // 32 bytes = 8 floats
        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'PurkinjeUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('purkinje', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('purkinje', PURKINJE_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'PurkinjePipeline'
        });
        
        this.updateUniforms();
        this.initialized = true;
        
        console.log('[PurkinjeEffectPass] Initialized with vGPU');
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        data[0] = this.intensity;
        data[1] = this.adaptationLuminance;
        data[2] = this.mesopicLow;
        data[3] = this.mesopicHigh;
        data[4] = this.adaptation;
        data[5] = this.desaturation;
        data[6] = this.noiseAmount;
        data[7] = this.enabled ? 1.0 : 0.0;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Update eye adaptation based on scene brightness
     * Call this each frame with average scene luminance
     * @param {number} sceneLuminance - Average scene brightness (0-1)
     * @param {number} deltaTime - Time since last frame in seconds
     */
    updateAdaptation(sceneLuminance, deltaTime) {
        // Target is 1 (night mode) when scene is dark, 0 when bright
        this.targetAdaptation = 1.0 - Math.min(1.0, sceneLuminance / this.luminanceThreshold);
        
        // Smooth adaptation
        const adaptRate = deltaTime / this.adaptationSpeed;
        this.adaptation += (this.targetAdaptation - this.adaptation) * Math.min(1.0, adaptRate);
        
        this.updateUniforms();
    }
    
    /**
     * Set adaptation directly (for time-of-day integration)
     * @param {number} value - Adaptation level (0=day, 1=night)
     */
    setAdaptation(value) {
        this.adaptation = Math.max(0, Math.min(1, value));
        this.updateUniforms();
    }
    
    /**
     * Render the pass
     */
    render(commandEncoder, inputTexture, outputView) {
        if (!this.initialized || !this.enabled) return;
        if (this.adaptation < 0.01) return;  // Skip if fully daytime
        
        const bindGroup = this.device.createBindGroup({
            label: 'Purkinje Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: inputTexture.createView() },
                { binding: 2, resource: this.sampler },
            ],
        });
        
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: outputView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(3);
        passEncoder.end();
    }
    
    /**
     * Load configuration from engine.cfg
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.intensity = parseFloat(cfg.intensity) ?? 0.7;
        this.luminanceThreshold = parseFloat(cfg.luminance_threshold) ?? 0.3;
        this.blueShift = parseFloat(cfg.blue_shift) ?? 0.6;
        this.desaturation = parseFloat(cfg.desaturation) ?? 0.5;
        this.adaptationSpeed = parseFloat(cfg.adaptation_speed) ?? 0.5;
        
        this.updateUniforms();
    }
    
    /**
     * Get current config
     */
    getConfig() {
        return {
            enabled: this.enabled,
            intensity: this.intensity,
            luminance_threshold: this.luminanceThreshold,
            blue_shift: this.blueShift,
            desaturation: this.desaturation,
            adaptation_speed: this.adaptationSpeed,
        };
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroupLayout = null;
        this.sampler = null;
        this.initialized = false;
    }
}

export default PurkinjeEffectPass;
