// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * LensFlarePass.js - Screen-Space Lens Flare Effect
 * Now powered by vGPU driver
 * 
 * Creates cinematic lens flares from bright light sources:
 * - Ghosts (multiple reflections)
 * - Halo ring around bright spots
 * - Anamorphic streak option
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const LENS_FLARE_SHADER = /* wgsl */ `
struct LensFlareUniforms {
    intensity: f32,
    threshold: f32,
    ghostCount: u32,
    ghostSpacing: f32,
    haloIntensity: f32,
    haloRadius: f32,
    _pad: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: LensFlareUniforms;
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

fn sampleThreshold(uv: vec2<f32>) -> vec3<f32> {
    let color = textureSample(colorTex, texSampler, uv).rgb;
    let brightness = max(color.r, max(color.g, color.b));
    if (brightness > uniforms.threshold) {
        return color * (brightness - uniforms.threshold);
    }
    return vec3<f32>(0.0);
}

fn sampleGhosts(uv: vec2<f32>) -> vec3<f32> {
    var result = vec3<f32>(0.0);
    let center = vec2<f32>(0.5);
    let ghostVec = (center - uv) * uniforms.ghostSpacing;
    
    for (var i = 0u; i < uniforms.ghostCount; i++) {
        let offset = ghostVec * f32(i + 1u);
        let sampleUV = uv + offset;
        
        // Chromatic aberration on ghosts
        let rOffset = offset * 1.02;
        let bOffset = offset * 0.98;
        
        result.r += sampleThreshold(uv + rOffset).r;
        result.g += sampleThreshold(sampleUV).g;
        result.b += sampleThreshold(uv + bOffset).b;
    }
    
    return result / f32(uniforms.ghostCount);
}

fn sampleHalo(uv: vec2<f32>) -> vec3<f32> {
    let center = vec2<f32>(0.5);
    let dir = uv - center;
    let dist = length(dir);
    
    let haloMask = 1.0 - abs(dist - uniforms.haloRadius) * 10.0;
    if (haloMask <= 0.0) { return vec3<f32>(0.0); }
    
    let haloUV = center + normalize(dir) * uniforms.haloRadius;
    return sampleThreshold(haloUV) * haloMask * uniforms.haloIntensity;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let original = textureSample(colorTex, texSampler, input.uv);
    
    // Sample ghosts
    let ghosts = sampleGhosts(input.uv);
    
    // Sample halo
    let halo = sampleHalo(input.uv);
    
    // Combine
    let flare = (ghosts + halo) * uniforms.intensity;
    
    return vec4<f32>(original.rgb + flare, original.a);
}
`;

export class LensFlarePass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;
        
        this.intensity = 0.5;
        this.threshold = 0.9;
        this.ghostCount = 8;
        this.ghostSpacing = 0.3;
        this.haloIntensity = 0.3;
        this.haloRadius = 0.6;
        
        this.pipeline = null;
        this.uniformBuffer = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(8);
    }
    
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'LensFlareUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('lensFlare', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('lensFlare', LENS_FLARE_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'LensFlarePipeline'
        });
        
        this.initialized = true;
    }
    
    updateUniforms() {
        if (!this.initialized) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        data[0] = this.intensity;
        data[1] = this.threshold;
        data[2] = this.ghostCount;
        data[3] = this.ghostSpacing;
        data[4] = this.haloIntensity;
        data[5] = this.haloRadius;
        data[6] = 0;
        data[7] = 0;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled === true;
        this.intensity = parseFloat(cfg.intensity) || 0.5;
        this.threshold = parseFloat(cfg.threshold) || 0.9;
        this.ghostCount = parseInt(cfg.ghost_count) || 8;
        this.ghostSpacing = parseFloat(cfg.ghost_spacing) || 0.3;
        this.haloIntensity = parseFloat(cfg.halo_intensity) || 0.3;
        this.haloRadius = parseFloat(cfg.halo_radius) || 0.6;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default LensFlarePass;
