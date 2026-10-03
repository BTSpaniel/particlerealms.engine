// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TAAPass.js - Temporal Anti-Aliasing
 * Now powered by vGPU driver
 * 
 * Reduces aliasing by jittering the camera and blending with previous frames.
 * Provides smooth edges without the blur of MSAA.
 * 
 * Benefits:
 * - Smooth edges on voxel geometry
 * - No geometry cost (unlike MSAA)
 * - Reduces specular aliasing
 * - Works well with deferred rendering
 * 
 * Algorithm:
 * 1. Jitter projection matrix each frame (sub-pixel offset)
 * 2. Render scene to current frame buffer
 * 3. Reproject previous frame using motion vectors
 * 4. Blend current and history with neighborhood clamping
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Halton sequence for jitter (low discrepancy)
function halton(index, base) {
    let result = 0;
    let f = 1 / base;
    let i = index;
    while (i > 0) {
        result += f * (i % base);
        i = Math.floor(i / base);
        f /= base;
    }
    return result;
}

// Generate jitter offsets using Halton sequence
function generateJitterSequence(count) {
    const jitters = [];
    for (let i = 0; i < count; i++) {
        jitters.push({
            x: halton(i + 1, 2) - 0.5,
            y: halton(i + 1, 3) - 0.5,
        });
    }
    return jitters;
}

import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

const TAA_UNIFORMS_STRUCT = `struct Uniforms {
    resolution: vec2<f32>,
    jitterOffset: vec2<f32>,
    blendFactor: f32,
    sharpness: f32,
    _pad: vec2<f32>,
}`;
const TAA_UNIFORM_FLOATS = getFloat32ArraySize(TAA_UNIFORMS_STRUCT);

const TAA_SHADER = /* wgsl */ `
${TAA_UNIFORMS_STRUCT}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var currentFrame: texture_2d<f32>;
@group(0) @binding(2) var historyFrame: texture_2d<f32>;
@group(0) @binding(3) var depthTexture: texture_2d<f32>;
@group(0) @binding(4) var motionTexture: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    
    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
    output.uv = positions[vertexIndex] * 0.5 + 0.5;
    output.uv.y = 1.0 - output.uv.y;
    return output;
}

// RGB to YCoCg color space (better for clamping)
fn rgbToYCoCg(rgb: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        0.25 * rgb.r + 0.5 * rgb.g + 0.25 * rgb.b,
        0.5 * rgb.r - 0.5 * rgb.b,
        -0.25 * rgb.r + 0.5 * rgb.g - 0.25 * rgb.b
    );
}

fn yCoCgToRgb(ycocg: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        ycocg.x + ycocg.y - ycocg.z,
        ycocg.x + ycocg.z,
        ycocg.x - ycocg.y - ycocg.z
    );
}

// Neighborhood clamping to reduce ghosting
fn clipToAABB(history: vec3<f32>, minC: vec3<f32>, maxC: vec3<f32>) -> vec3<f32> {
    let center = (minC + maxC) * 0.5;
    let extents = (maxC - minC) * 0.5;
    
    let offset = history - center;
    let absOffset = abs(offset);
    let maxScale = max(max(absOffset.x / max(extents.x, 0.0001),
                           absOffset.y / max(extents.y, 0.0001)),
                       absOffset.z / max(extents.z, 0.0001));
    
    if (maxScale > 1.0) {
        return center + offset / maxScale;
    }
    return history;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    let texelSize = 1.0 / uniforms.resolution;
    let uv = input.uv;
    
    // Sample current frame
    let current = textureSample(currentFrame, linearSampler, uv).rgb;
    
    // Get motion vector for reprojection
    let motion = textureSample(motionTexture, linearSampler, uv).rg;
    let historyUV = uv - motion;
    
    // Sample history BEFORE control flow (WGSL requirement)
    // Clamp UV to valid range for the sample, then check validity after
    let clampedHistoryUV = clamp(historyUV, vec2<f32>(0.001), vec2<f32>(0.999));
    var history = textureSample(historyFrame, linearSampler, clampedHistoryUV).rgb;
    
    // Check if history UV is valid - if not, use current frame only
    let historyValid = historyUV.x >= 0.0 && historyUV.x <= 1.0 && historyUV.y >= 0.0 && historyUV.y <= 1.0;
    if (!historyValid) {
        history = current;
    }
    
    // Sample 3x3 neighborhood for clamping
    var minC = current;
    var maxC = current;
    
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let offset = vec2<f32>(f32(dx), f32(dy)) * texelSize;
            let neighbor = textureSample(currentFrame, linearSampler, uv + offset).rgb;
            minC = min(minC, neighbor);
            maxC = max(maxC, neighbor);
        }
    }
    
    // Convert to YCoCg for better clamping
    let historyYCoCg = rgbToYCoCg(history);
    let minYCoCg = rgbToYCoCg(minC);
    let maxYCoCg = rgbToYCoCg(maxC);
    
    // Clip history to neighborhood bounds
    let clampedYCoCg = clipToAABB(historyYCoCg, minYCoCg, maxYCoCg);
    history = yCoCgToRgb(clampedYCoCg);
    
    // Blend current and history
    let blendFactor = uniforms.blendFactor;
    var result = mix(history, current, blendFactor);
    
    // Optional sharpening
    if (uniforms.sharpness > 0.0) {
        var sharp = current * (1.0 + uniforms.sharpness * 4.0);
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                if (dx == 0 && dy == 0) { continue; }
                let offset = vec2<f32>(f32(dx), f32(dy)) * texelSize;
                let neighbor = textureSample(currentFrame, linearSampler, uv + offset).rgb;
                sharp -= neighbor * uniforms.sharpness;
            }
        }
        result = mix(result, sharp, 0.25);
    }
    
    return vec4<f32>(result, 1.0);
}
`;

/**
 * TAAPass - Temporal Anti-Aliasing render pass
 */
export class TAAPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        // Render resources
        this.pipeline = null;
        this.bindGroupLayout = null;
        this.sampler = null;
        this.uniformBuffer = null;
        
        // History buffers (ping-pong)
        this.historyTextures = [null, null];
        this.currentHistoryIndex = 0;
        
        // Motion vector texture
        this.motionTexture = null;
        
        // Configuration
        this.jitterSequence = generateJitterSequence(16);
        this.frameIndex = 0;
        this.blendFactor = 0.1;  // 10% current, 90% history
        this.sharpness = 0.2;
        this.jitterScale = 1.0;  // Scale jitter offset
        
        // Resolution
        this.width = 0;
        this.height = 0;
        
        // Pre-allocated buffers to avoid per-frame allocations
        this._uniformData = new Float32Array(TAA_UNIFORM_FLOATS);
        this._jitteredMatrix = new Float32Array(16);
    }
    
    /**
     * Initialize the TAA pass
     * @param {GPUDevice} device 
     * @param {number} width 
     * @param {number} height 
     * @param {string} format 
     */
    async init(device, width, height, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.width = width;
        this.height = height;
        this.format = format;
        
        // Create shader module
        const shaderModule = this.vgpu.shader.compile('taa', TAA_SHADER);
        
        // Create bind group layout
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('taa', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 3, type: 'texture', visibility: 'fragment', sampleType: 'unfilterable-float' },
            { binding: 4, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 5, type: 'sampler', visibility: 'fragment' },
        ]);
        
        // Create pipeline (no depth attachment - post-processing)
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vertexMain' },
            fragment: { module: shaderModule, entryPoint: 'fragmentMain' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'TAAPipeline'
        });
        
        // Create sampler and uniform buffer
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'TAAUniforms' }).buffer;
        
        // Create history textures
        await this.createHistoryTextures(width, height, format);
        
        // Create placeholder motion texture
        this.motionTexture = this.vgpu.texture.create({
            width, height, format: 'rg16float',
            usage: 'texture|render', label: 'TAAMotionVectors'
        }).texture;
        
        this.initialized = true;
        console.log(`[TAAPass] Initialized at ${width}×${height} with vGPU`);
    }
    
    /**
     * Create history textures for ping-pong buffering
     */
    async createHistoryTextures(width, height, format) {
        for (let i = 0; i < 2; i++) {
            this.historyTextures[i]?.destroy();
            this.historyTextures[i] = this.vgpu.texture.create({
                width, height, format,
                usage: 'texture|render|copy-dst', label: `TAAHistory${i}`
            }).texture;
        }
    }
    
    /**
     * Resize the TAA buffers
     */
    resize(width, height, format = 'bgra8unorm') {
        if (width === this.width && height === this.height) return;
        
        this.width = width;
        this.height = height;
        
        this.createHistoryTextures(width, height, format);
        
        this.motionTexture?.destroy();
        this.motionTexture = this.vgpu.texture.create({
            width, height, format: 'rg16float',
            usage: 'texture|render', label: 'TAAMotionVectors'
        }).texture;
        
        console.log(`[TAAPass] Resized to ${width}×${height}`);
    }
    
    /**
     * Get jitter offset for current frame
     * @returns {Object} - { x, y } in pixels
     */
    getJitter() {
        const jitter = this.jitterSequence[this.frameIndex % this.jitterSequence.length];
        return {
            x: jitter.x * this.jitterScale,
            y: jitter.y * this.jitterScale,
        };
    }
    
    /**
     * Update settings (called by ConfigLoader)
     */
    updateUniforms() {
        // Settings are applied during execute() - this is a no-op for compatibility
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [taa] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.jitterScale = parseFloat(cfg.jitter_scale) || 1.0;
        this.blendFactor = parseFloat(cfg.blend_factor) || 0.9;
    }
    
    /**
     * Apply jitter to projection matrix
     * @param {Float32Array} projMatrix - 4x4 projection matrix
     * @returns {Float32Array} - Jittered matrix
     */
    applyJitter(projMatrix) {
        const jitter = this.getJitter();
        // Use pre-allocated buffer to avoid per-frame allocation
        const jitteredMatrix = this._jitteredMatrix;
        jitteredMatrix.set(projMatrix);
        
        // Add sub-pixel offset to projection matrix
        jitteredMatrix[8] += (jitter.x * 2) / this.width;
        jitteredMatrix[9] += (jitter.y * 2) / this.height;
        
        return jitteredMatrix;
    }
    
    /**
     * Execute TAA pass
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUTextureView} currentFrameView - Current rendered frame
     * @param {GPUTextureView} depthView - Depth buffer
     * @param {GPUTextureView} outputView - Output texture view
     */
    execute(encoder, currentFrameView, depthView, outputView) {
        if (!this.enabled || !this.initialized) return;
        
        // Update uniforms - use pre-allocated buffer
        const uniformData = this._uniformData;
        const jitter = this.getJitter();
        uniformData[0] = this.width;
        uniformData[1] = this.height;
        uniformData[2] = jitter.x;
        uniformData[3] = jitter.y;
        uniformData[4] = this.blendFactor;
        uniformData[5] = this.sharpness;
        uniformData[6] = 0;
        uniformData[7] = 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        
        // Get history texture (previous frame)
        const historyIndex = this.currentHistoryIndex;
        const outputIndex = 1 - historyIndex;
        
        const historyView = this.historyTextures[historyIndex].createView();
        const motionView = this.motionTexture.createView();
        
        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: currentFrameView },
                { binding: 2, resource: historyView },
                { binding: 3, resource: depthView },
                { binding: 4, resource: motionView },
                { binding: 5, resource: this.sampler },
            ],
        });
        
        // Render TAA
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: outputView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        
        // Copy output to history for next frame
        encoder.copyTextureToTexture(
            { texture: { createView: () => outputView } },
            { texture: this.historyTextures[outputIndex] },
            [this.width, this.height]
        );
        
        // Swap history buffers
        this.currentHistoryIndex = outputIndex;
        this.frameIndex++;
    }
    
    /**
     * Get motion texture view for writing motion vectors
     */
    getMotionTextureView() {
        return this.motionTexture.createView();
    }
    
    /**
     * Destroy resources
     */
    destroy() {
        this.historyTextures[0]?.destroy();
        this.historyTextures[1]?.destroy();
        this.motionTexture?.destroy();
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default TAAPass;
