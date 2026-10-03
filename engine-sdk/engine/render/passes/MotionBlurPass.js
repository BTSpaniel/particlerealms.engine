// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MotionBlurPass.js - Camera & Object Motion Blur
 * Now powered by vGPU driver
 * 
 * Implements per-pixel motion blur using velocity buffer:
 * - Camera motion blur from view matrix changes
 * - Per-object motion blur from velocity vectors
 * - Tile-based optimization for performance
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

const MOTION_BLUR_UNIFORMS_STRUCT = `struct MotionBlurUniforms {
    intensity: f32,
    samples: u32,
    maxVelocity: f32,
    _pad: f32,
    prevViewProj: mat4x4<f32>,
    currViewProj: mat4x4<f32>,
}`;
const MOTION_BLUR_UNIFORM_FLOATS = getFloat32ArraySize(MOTION_BLUR_UNIFORMS_STRUCT);

// ============================================================================
// SHADER
// ============================================================================

const MOTION_BLUR_SHADER = /* wgsl */ `
${MOTION_BLUR_UNIFORMS_STRUCT}

@group(0) @binding(0) var<uniform> uniforms: MotionBlurUniforms;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var velocityTex: texture_2d<f32>;
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

// Reconstruct world position from depth
fn reconstructWorldPos(uv: vec2<f32>, depth: f32, invViewProj: mat4x4<f32>) -> vec3<f32> {
    let clipPos = vec4<f32>(uv * 2.0 - 1.0, depth, 1.0);
    let worldPos = invViewProj * clipPos;
    return worldPos.xyz / worldPos.w;
}

// Calculate velocity from current and previous positions
fn calculateVelocity(uv: vec2<f32>, depth: f32) -> vec2<f32> {
    // Get velocity from velocity buffer if available
    let velocity = textureSample(velocityTex, texSampler, uv).xy;
    
    // Clamp velocity to max
    let velocityLength = length(velocity);
    if (velocityLength > uniforms.maxVelocity) {
        return velocity * (uniforms.maxVelocity / velocityLength);
    }
    return velocity;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let depth = textureSample(depthTex, texSampler, input.uv);
    let velocity = calculateVelocity(input.uv, depth) * uniforms.intensity;
    
    // Early exit if no motion
    if (length(velocity) < 0.001) {
        return textureSample(colorTex, texSampler, input.uv);
    }
    
    // Accumulate samples along velocity direction
    var color = vec4<f32>(0.0);
    let samples = uniforms.samples;
    
    for (var i = 0u; i < samples; i++) {
        let t = (f32(i) / f32(samples - 1u)) - 0.5;
        let sampleUV = input.uv + velocity * t;
        color += textureSample(colorTex, texSampler, sampleUV);
    }
    
    return color / f32(samples);
}
`;

// ============================================================================
// MOTION BLUR PASS CLASS
// ============================================================================

export class MotionBlurPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;
        
        // Settings
        this.intensity = 0.5;
        this.samples = 8;
        this.maxVelocity = 32;
        this.cameraBlur = true;
        this.objectBlur = true;
        
        // GPU resources
        this.pipeline = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.sampler = null;
        
        // Previous frame data
        this.prevViewProj = new Float32Array(16);
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(MOTION_BLUR_UNIFORM_FLOATS);
    }
    
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create uniform buffer
        this.uniformBuffer = this.vgpu.buffer.create({ size: MOTION_BLUR_UNIFORM_FLOATS * 4, usage: 'uniform', label: 'MotionBlurUniforms' }).buffer;
        
        // Create sampler
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp' });
        
        // Create bind group layout
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('motionBlur', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'depth' },
            { binding: 3, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 4, type: 'sampler', visibility: 'fragment' },
        ]);
        
        // Create pipeline
        const shaderModule = this.vgpu.shader.compile('motionBlur', MOTION_BLUR_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'MotionBlurPipeline'
        });
        
        this.initialized = true;
    }
    
    updateUniforms(currViewProj) {
        if (!this.initialized) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        data[0] = this.intensity;
        data[1] = this.samples;
        data[2] = this.maxVelocity;
        data[3] = 0; // padding
        
        // Previous view-projection matrix
        data.set(this.prevViewProj, 4);
        
        // Current view-projection matrix
        data.set(currViewProj, 20);
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
        
        // Store current for next frame
        this.prevViewProj.set(currViewProj);
    }
    
    execute(commandEncoder, colorTexture, depthTexture, velocityTexture, outputView) {
        if (!this.initialized || !this.enabled) return false;
        
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: colorTexture.createView() },
                { binding: 2, resource: depthTexture.createView() },
                { binding: 3, resource: velocityTexture.createView() },
                { binding: 4, resource: this.sampler },
            ],
        });
        
        const pass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: outputView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        
        return true;
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [motion_blur] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled === true;
        this.intensity = parseFloat(cfg.intensity) || 0.5;
        this.samples = parseInt(cfg.samples) || 8;
        this.maxVelocity = parseFloat(cfg.max_velocity) || 32;
        this.cameraBlur = cfg.camera_blur !== false;
        this.objectBlur = cfg.object_blur !== false;
    }
    
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default MotionBlurPass;
