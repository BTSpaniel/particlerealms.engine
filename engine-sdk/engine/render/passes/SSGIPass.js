// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SSGIPass.js - Screen Space Global Illumination
 * Now powered by vGPU driver
 * 
 * Approximates indirect lighting bounces using screen-space information.
 * Provides color bleeding and ambient lighting from nearby surfaces.
 * 
 * Algorithm:
 * 1. Sample nearby pixels in screen space
 * 2. Calculate indirect light contribution based on normal/depth
 * 3. Blend with direct lighting
 * 
 * Parameters:
 * - intensity: Overall GI strength (0-2)
 * - rayCount: Samples per pixel (quality vs performance)
 * - maxDistance: Maximum sample distance
 * - thickness: Depth comparison thickness
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

const SSGI_UNIFORMS_STRUCT = `struct SSGIUniforms {
    intensity: f32,
    rayCount: f32,
    maxDistance: f32,
    thickness: f32,
    diffuseIntensity: f32,
    screenWidth: f32,
    screenHeight: f32,
    enabled: f32,
    frameIndex: f32,
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
}`;
const SSGI_UNIFORM_FLOATS = getFloat32ArraySize(SSGI_UNIFORMS_STRUCT);

const SSGI_SHADER = /* wgsl */ `
${SSGI_UNIFORMS_STRUCT}

@group(0) @binding(0) var<uniform> uniforms: SSGIUniforms;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var colorSampler: sampler;
@group(0) @binding(5) var depthSampler: sampler;

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

// Hash function for random sampling
fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Get random direction on hemisphere
fn randomHemisphereDir(uv: vec2<f32>, index: f32, frameIndex: f32) -> vec2<f32> {
    let seed = uv * 1000.0 + vec2<f32>(index, frameIndex);
    let angle = hash(seed) * 6.28318;
    let radius = sqrt(hash(seed + vec2<f32>(1.0, 0.0)));
    return vec2<f32>(cos(angle), sin(angle)) * radius;
}

// Sample indirect lighting from nearby pixels
fn sampleIndirectLight(
    centerUV: vec2<f32>,
    centerDepth: f32,
    centerNormal: vec3<f32>,
    uniforms: SSGIUniforms
) -> vec3<f32> {
    let texelSize = vec2<f32>(1.0 / uniforms.screenWidth, 1.0 / uniforms.screenHeight);
    var indirectLight = vec3<f32>(0.0);
    var totalWeight = 0.0;
    
    // Fixed loop count for uniform control flow
    for (var i = 0; i < 8; i = i + 1) {
        if (f32(i) >= uniforms.rayCount) {
            break;
        }
        
        // Get random sample direction
        let randomDir = randomHemisphereDir(centerUV, f32(i), uniforms.frameIndex);
        let sampleOffset = randomDir * uniforms.maxDistance * texelSize;
        let sampleUV = centerUV + sampleOffset;
        
        // Clamp to bounds
        let clampedUV = clamp(sampleUV, vec2<f32>(0.001), vec2<f32>(0.999));
        let inBounds = step(0.001, sampleUV.x) * step(sampleUV.x, 0.999) * step(0.001, sampleUV.y) * step(sampleUV.y, 0.999);
        
        // Use textureSampleLevel for uniform control flow
        let sampleDepth = textureSampleLevel(depthTex, depthSampler, clampedUV, 0.0).r;
        let sampleColor = textureSampleLevel(colorTex, colorSampler, clampedUV, 0.0).rgb;
        
        // Depth-based weight
        let depthDiff = abs(centerDepth - sampleDepth);
        let depthWeight = 1.0 - smoothstep(0.0, uniforms.thickness, depthDiff);
        
        // Distance falloff
        let dist = length(sampleOffset / texelSize);
        let distWeight = max(0.0, 1.0 - (dist / uniforms.maxDistance));
        
        // Combine weights
        let weight = depthWeight * distWeight * distWeight * inBounds;
        
        indirectLight = indirectLight + sampleColor * weight;
        totalWeight = totalWeight + weight;
    }
    
    // Normalize
    let safeWeight = max(0.001, totalWeight);
    return indirectLight / safeWeight;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample all textures first (uniform control flow)
    let directColor = textureSampleLevel(colorTex, colorSampler, input.uv, 0.0);
    let depth = textureSampleLevel(depthTex, depthSampler, input.uv, 0.0).r;
    
    // Compute GI (always, to maintain uniform flow)
    let normal = vec3<f32>(0.0, 1.0, 0.0);
    let indirectLight = sampleIndirectLight(input.uv, depth, normal, uniforms);
    
    // Blend indirect with direct
    let gi = indirectLight * uniforms.intensity * uniforms.diffuseIntensity;
    
    // Apply only when enabled and not sky
    let isSky = step(0.999, depth) + step(depth, 0.001);
    let applyEffect = uniforms.enabled * (1.0 - min(1.0, isSky));
    
    let finalColor = directColor.rgb + gi * applyEffect;
    
    return vec4<f32>(finalColor, directColor.a);
}
`;

export class SSGIPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;  // Disabled by default (expensive)
        
        // Effect parameters (from engine.cfg)
        this.intensity = 1.0;
        this.rayCount = 4;
        this.maxDistance = 10.0;
        this.thickness = 0.1;
        this.diffuseIntensity = 1.0;
        
        // Screen dimensions
        this.width = 1920;
        this.height = 1080;
        
        // Temporal
        this.frameIndex = 0;
        
        // GPU resources
        this.pipeline = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.sampler = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(SSGI_UNIFORM_FLOATS);
    }
    
    /**
     * Initialize GPU resources
     */
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.format = format;
        
        // Create resources using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 48, usage: 'uniform', label: 'SSGIUniforms' }).buffer;
        this.colorSampler = this.vgpu.texture.sampler({ filter: 'linear' });
        this.depthSampler = this.vgpu.texture.sampler({ filter: 'nearest' });
        
        // Bind group layout
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('ssgi', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'unfilterable-float' },
            { binding: 3, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 4, type: 'sampler', visibility: 'fragment' },
            { binding: 5, type: 'sampler', visibility: 'fragment', samplerType: 'non-filtering' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('ssgi', SSGI_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'SSGIPipeline'
        });
        
        this.updateUniforms();
        this.initialized = true;
        
        console.log('[SSGIPass] Initialized with vGPU');
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        data[0] = this.intensity;
        data[1] = this.rayCount;
        data[2] = this.maxDistance;
        data[3] = this.thickness;
        data[4] = this.diffuseIntensity;
        data[5] = this.width;
        data[6] = this.height;
        data[7] = this.enabled ? 1.0 : 0.0;
        data[8] = this.frameIndex;
        data[9] = 0.0;
        data[10] = 0.0;
        data[11] = 0.0;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Set screen dimensions
     */
    setSize(width, height) {
        this.width = width;
        this.height = height;
        this.updateUniforms();
    }
    
    /**
     * Render the pass
     */
    render(commandEncoder, colorTexture, depthTexture, outputView) {
        if (!this.initialized || !this.enabled) return;
        if (!depthTexture) return;
        
        // Increment frame for temporal jitter
        this.frameIndex = (this.frameIndex + 1) % 256;
        this.updateUniforms();
        
        const bindGroup = this.device.createBindGroup({
            label: 'SSGI Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: colorTexture.createView() },
                { binding: 2, resource: depthTexture.createView() },
                { binding: 3, resource: colorTexture.createView() },  // placeholder for normal
                { binding: 4, resource: this.colorSampler },
                { binding: 5, resource: this.depthSampler },
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
     * Load configuration from engine.cfg [screen_space_gi] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled === true;  // Disabled by default
        this.intensity = parseFloat(cfg.intensity) ?? 1.0;
        this.rayCount = parseFloat(cfg.ray_count) ?? 4;
        this.maxDistance = parseFloat(cfg.max_distance) ?? 10.0;
        this.thickness = parseFloat(cfg.thickness) ?? 0.1;
        this.diffuseIntensity = parseFloat(cfg.diffuse_intensity) ?? 1.0;
        
        this.updateUniforms();
    }
    
    /**
     * Get current config
     */
    getConfig() {
        return {
            enabled: this.enabled,
            intensity: this.intensity,
            ray_count: this.rayCount,
            max_distance: this.maxDistance,
            thickness: this.thickness,
            diffuse_intensity: this.diffuseIntensity,
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
        this.colorSampler = null;
        this.depthSampler = null;
        this.initialized = false;
    }
}

export default SSGIPass;
