// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ContactShadowsPass.js - Screen Space Contact Shadows
 * Now powered by vGPU driver
 * 
 * Adds fine-detail shadows for small objects and crevices that cascade
 * shadow maps miss. Uses screen-space ray marching from the depth buffer.
 * 
 * Algorithm:
 * 1. For each pixel, march rays toward light source in screen space
 * 2. Sample depth buffer along ray
 * 3. If ray goes behind geometry, pixel is in shadow
 * 
 * Parameters:
 * - length: Maximum ray length in pixels
 * - rayCount: Number of rays per pixel
 * - fadeDistance: Distance at which shadows fade out
 * - intensity: Shadow darkness (0-1)
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

const CONTACT_SHADOWS_STRUCT = `struct ContactShadowsUniforms {
    lightDir: vec3<f32>,
    rayLength: f32,
    rayCount: f32,
    thickness: f32,
    fadeDistance: f32,
    intensity: f32,
    screenWidth: f32,
    screenHeight: f32,
    enabled: f32,
    _pad: f32,
}`;
const _contactShadowsUniformData = new Float32Array(getFloat32ArraySize(CONTACT_SHADOWS_STRUCT));

const CONTACT_SHADOWS_SHADER = /* wgsl */ `
${CONTACT_SHADOWS_STRUCT}

@group(0) @binding(0) var<uniform> uniforms: ContactShadowsUniforms;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var colorSampler: sampler;
@group(0) @binding(4) var depthSampler: sampler;

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

// Linearize depth from depth buffer
fn linearizeDepth(depth: f32, near: f32, far: f32) -> f32 {
    return near * far / (far - depth * (far - near));
}

// Screen space ray march for contact shadows
fn rayMarchContactShadow(
    startUV: vec2<f32>,
    rayDir: vec2<f32>,
    startDepth: f32,
    uniforms: ContactShadowsUniforms
) -> f32 {
    let stepSize = uniforms.rayLength / uniforms.rayCount;
    let texelSize = vec2<f32>(1.0 / uniforms.screenWidth, 1.0 / uniforms.screenHeight);
    
    var shadow = 0.0;
    var rayPos = startUV;
    
    // March along ray (fixed iteration count for uniform control flow)
    for (var i = 0; i < 16; i = i + 1) {
        if (f32(i) >= uniforms.rayCount) {
            break;
        }
        
        rayPos = rayPos + rayDir * stepSize * texelSize;
        
        // Clamp to bounds instead of breaking
        let clampedPos = clamp(rayPos, vec2<f32>(0.001), vec2<f32>(0.999));
        let inBounds = step(0.001, rayPos.x) * step(rayPos.x, 0.999) * step(0.001, rayPos.y) * step(rayPos.y, 0.999);
        
        // Use textureSampleLevel for uniform control flow compatibility
        let texCoord = vec2<i32>(i32(clampedPos.x * uniforms.screenWidth), i32(clampedPos.y * uniforms.screenHeight));
        let sampledDepth = textureLoad(depthTex, texCoord, 0);
        
        let expectedDepth = startDepth - f32(i) * uniforms.thickness * 0.01;
        let depthDiff = expectedDepth - sampledDepth;
        let isShadowed = step(0.001, sampledDepth) * step(sampledDepth, expectedDepth) * step(depthDiff, uniforms.thickness);
        let shadowContrib = (1.0 - depthDiff / uniforms.thickness) * isShadowed * inBounds;
        shadow = max(shadow, shadowContrib);
    }
    
    return shadow * uniforms.intensity;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample all textures first (uniform control flow)
    let color = textureSampleLevel(colorTex, colorSampler, input.uv, 0.0);
    let depthCoord = vec2<i32>(i32(input.uv.x * uniforms.screenWidth), i32(input.uv.y * uniforms.screenHeight));
    let depth = textureLoad(depthTex, depthCoord, 0);
    
    // Compute shadow (always, to maintain uniform flow)
    let lightDir2D = normalize(uniforms.lightDir.xy + vec2<f32>(0.0001));
    let shadow = rayMarchContactShadow(input.uv, lightDir2D, depth, uniforms);
    
    // Fade based on distance
    let fadeFactor = smoothstep(0.0, uniforms.fadeDistance, depth * 100.0);
    let finalShadow = shadow * (1.0 - fadeFactor);
    
    // Skip shadow for sky pixels and when disabled
    let isSky = step(0.999, depth) + step(depth, 0.001);
    let applyEffect = uniforms.enabled * (1.0 - min(1.0, isSky));
    
    // Apply shadow (darken)
    let shadowedColor = color.rgb * (1.0 - finalShadow * applyEffect);
    
    return vec4<f32>(shadowedColor, color.a);
}
`;

export class ContactShadowsPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        // Effect parameters (from engine.cfg defaults)
        this.rayLength = 64;        // Max ray length in pixels
        this.rayCount = 8;          // Samples per ray
        this.thickness = 0.5;       // Depth comparison thickness
        this.fadeDistance = 50.0;   // Fade distance
        this.intensity = 0.5;       // Shadow intensity
        
        // Light direction (updated from sun)
        this.lightDir = [0.5, 0.5, 0.5];
        
        // Screen dimensions
        this.width = 1920;
        this.height = 1080;
        
        // GPU resources
        this.pipeline = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.sampler = null;
    }
    
    /**
     * Initialize GPU resources
     */
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.format = format;
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 48, usage: 'uniform', label: 'ContactShadowsUniforms' }).buffer;
        this.colorSampler = this.vgpu.texture.sampler({ filter: 'linear' });
        this.depthSampler = this.vgpu.texture.sampler({ filter: 'nearest' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('contactShadows', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'depth' },
            { binding: 3, type: 'sampler', visibility: 'fragment' },
            { binding: 4, type: 'sampler', visibility: 'fragment', samplerType: 'non-filtering' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('contactShadows', CONTACT_SHADOWS_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'ContactShadowsPipeline'
        });
        
        this.updateUniforms();
        this.initialized = true;
        
        console.log('[ContactShadowsPass] Initialized with vGPU');
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Reuse module-level buffer
        _contactShadowsUniformData[0] = this.lightDir[0];
        _contactShadowsUniformData[1] = this.lightDir[1];
        _contactShadowsUniformData[2] = this.lightDir[2];
        _contactShadowsUniformData[3] = this.rayLength;
        _contactShadowsUniformData[4] = this.rayCount;
        _contactShadowsUniformData[5] = this.thickness;
        _contactShadowsUniformData[6] = this.fadeDistance;
        _contactShadowsUniformData[7] = this.intensity;
        _contactShadowsUniformData[8] = this.width;
        _contactShadowsUniformData[9] = this.height;
        _contactShadowsUniformData[10] = this.enabled ? 1.0 : 0.0;
        _contactShadowsUniformData[11] = 0.0;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _contactShadowsUniformData);
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
     * Update light direction from sun
     * @param {Array} direction - Normalized light direction [x, y, z]
     */
    setLightDirection(direction) {
        if (direction) {
            this.lightDir = [...direction];
            this.updateUniforms();
        }
    }
    
    /**
     * Render the pass
     * @param {GPUCommandEncoder} commandEncoder
     * @param {GPUTexture} colorTexture - Scene color
     * @param {GPUTexture} depthTexture - Scene depth
     * @param {GPUTextureView} outputView - Output target
     */
    render(commandEncoder, colorTexture, depthTexture, outputView) {
        if (!this.initialized || !this.enabled) return;
        if (!depthTexture) return;  // Need depth buffer
        
        const bindGroup = this.device.createBindGroup({
            label: 'Contact Shadows Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: colorTexture.createView() },
                { binding: 2, resource: depthTexture.createView({ aspect: 'depth-only' }) },
                { binding: 3, resource: this.colorSampler },
                { binding: 4, resource: this.depthSampler },
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
     * Load configuration from engine.cfg [contact_shadows] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.rayLength = parseFloat(cfg.length) ?? 64;
        this.rayCount = parseFloat(cfg.ray_count) ?? 8;
        this.fadeDistance = parseFloat(cfg.fade_distance) ?? 50.0;
        this.intensity = parseFloat(cfg.intensity) ?? 0.5;
        this.thickness = parseFloat(cfg.thickness) ?? 0.5;
        
        this.updateUniforms();
    }
    
    /**
     * Get current config
     */
    getConfig() {
        return {
            enabled: this.enabled,
            length: this.rayLength,
            ray_count: this.rayCount,
            fade_distance: this.fadeDistance,
            intensity: this.intensity,
            thickness: this.thickness,
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

export default ContactShadowsPass;
