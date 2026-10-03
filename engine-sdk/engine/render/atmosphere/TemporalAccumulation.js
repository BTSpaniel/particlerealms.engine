// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TemporalAccumulation.js - TAA for Atmospheric Effects
 * Now powered by vGPU driver
 * 
 * Provides temporal anti-aliasing for:
 * - Reducing ray marching noise
 * - Smoothing aurora flickering
 * - Accumulating weather simulation
 * 
 * Uses motion vectors for proper reprojection
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// WGSL code for temporal accumulation
export const TEMPORAL_ACCUMULATION_WGSL = /* wgsl */ `
struct TemporalUniforms {
    jitterOffset: vec2<f32>,
    blendFactor: f32,
    frameIndex: u32,
    
    resolution: vec2<f32>,
    invResolution: vec2<f32>,
    
    // Motion vector scale
    motionScale: vec2<f32>,
    _pad: vec2<f32>,
}

// Halton sequence for sub-pixel jitter (temporal super-sampling)
fn haltonSequence(index: u32, base: u32) -> f32 {
    var f = 1.0;
    var r = 0.0;
    var i = index;
    
    while (i > 0u) {
        f = f / f32(base);
        r = r + f * f32(i % base);
        i = i / base;
    }
    
    return r;
}

// Get jitter offset for current frame
fn getJitterOffset(frameIndex: u32) -> vec2<f32> {
    let idx = frameIndex % 16u;
    return vec2<f32>(
        haltonSequence(idx + 1u, 2u) - 0.5,
        haltonSequence(idx + 1u, 3u) - 0.5
    );
}

// Reproject previous frame using motion vectors
fn reprojectUV(currentUV: vec2<f32>, motionVector: vec2<f32>) -> vec2<f32> {
    return currentUV - motionVector;
}

// Neighborhood clamping to reduce ghosting
fn neighborhoodClamp(historyColor: vec3<f32>, currentColor: vec3<f32>, 
                      minColor: vec3<f32>, maxColor: vec3<f32>) -> vec3<f32> {
    return clamp(historyColor, minColor, maxColor);
}

// Variance clipping (better than simple clamping)
fn varianceClip(historyColor: vec3<f32>, currentColor: vec3<f32>,
                mean: vec3<f32>, stdDev: vec3<f32>, gamma: f32) -> vec3<f32> {
    let minC = mean - stdDev * gamma;
    let maxC = mean + stdDev * gamma;
    
    // Clip towards current color
    let direction = currentColor - historyColor;
    
    // Find intersection with AABB
    let tMin = (minC - historyColor) / direction;
    let tMax = (maxC - historyColor) / direction;
    
    let t1 = min(tMin, tMax);
    let t2 = max(tMin, tMax);
    
    let tNear = max(max(t1.x, t1.y), t1.z);
    let tFar = min(min(t2.x, t2.y), t2.z);
    
    if (tNear > 0.0 && tNear < 1.0) {
        return historyColor + direction * tNear;
    }
    
    return clamp(historyColor, minC, maxC);
}

// Blend current and history with confidence-based weight
fn temporalBlend(currentColor: vec3<f32>, historyColor: vec3<f32>, 
                 blendFactor: f32, confidence: f32) -> vec3<f32> {
    let adjustedBlend = mix(0.1, blendFactor, confidence);
    return mix(historyColor, currentColor, adjustedBlend);
}

// Compute motion confidence (lower for disoccluded regions)
fn motionConfidence(motionVector: vec2<f32>, depth: f32, prevDepth: f32) -> f32 {
    // Large motion = less confidence
    let motionMag = length(motionVector);
    let motionConf = exp(-motionMag * 10.0);
    
    // Depth discontinuity = disocclusion
    let depthDiff = abs(depth - prevDepth);
    let depthConf = exp(-depthDiff * 100.0);
    
    return motionConf * depthConf;
}

// YCoCg color space for better clamping
fn rgbToYCoCg(rgb: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        dot(rgb, vec3<f32>(0.25, 0.5, 0.25)),
        dot(rgb, vec3<f32>(0.5, 0.0, -0.5)),
        dot(rgb, vec3<f32>(-0.25, 0.5, -0.25))
    );
}

fn yCoCgToRgb(ycocg: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        ycocg.x + ycocg.y - ycocg.z,
        ycocg.x + ycocg.z,
        ycocg.x - ycocg.y - ycocg.z
    );
}
`;

/**
 * TemporalAccumulation - TAA pass for atmosphere
 */
export class TemporalAccumulation {
    constructor() {
        this.initialized = false;
        this.vgpu = null;
        this.device = null;
        
        // Double buffer for history
        this.historyTexture = null;
        this.currentTexture = null;
        this.frameIndex = 0;
        
        // Configuration
        this.blendFactor = 0.1;  // 10% new frame, 90% history
        this.jitterScale = 1.0;
        
        // GPU resources
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;

        this._uniformData = new Float32Array(12);
        this._jitterOffset = new Float32Array(2);
    }
    
    /**
     * Initialize TAA resources
     * @param {GPUDevice} device 
     * @param {number} width - Render width
     * @param {number} height - Render height
     */
    init(device, width, height) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.width = width;
        this.height = height;
        
        // Create history textures using vGPU
        this.historyTexture = this.vgpu.texture.create({
            width, height, format: 'rgba16float',
            usage: 'texture|storage|render', label: 'TAAHistory'
        }).texture;
        
        this.currentTexture = this.vgpu.texture.create({
            width, height, format: 'rgba16float',
            usage: 'texture|storage|render', label: 'TAACurrent'
        }).texture;
        
        // Create uniform buffer using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 48, usage: 'uniform', label: 'TAAUniforms' }).buffer;
        
        this.updateUniforms();
        this.initialized = true;
        
        console.log(`[TemporalAccumulation] Initialized ${width}×${height} with vGPU`);
    }
    
    /**
     * Update uniforms
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;

        const jitter = this._getJitterOffset();

        const data = this._uniformData;
        data[0] = jitter[0] * this.jitterScale;
        data[1] = jitter[1] * this.jitterScale;
        data[2] = this.blendFactor;
        data[3] = this.frameIndex;  // as float, will be cast to u32

        data[4] = this.width;
        data[5] = this.height;
        data[6] = 1 / this.width;
        data[7] = 1 / this.height;

        data[8] = 1.0;  // motionScale X
        data[9] = 1.0;  // motionScale Y
        data[10] = 0;
        data[11] = 0;

        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Get Halton jitter offset for current frame
     */
    _getJitterOffset() {
        const idx = (this.frameIndex % 16) + 1;

        const jitter = this._jitterOffset;
        jitter[0] = this._halton(idx, 2) - 0.5;
        jitter[1] = this._halton(idx, 3) - 0.5;
        return jitter;
    }
    
    _halton(index, base) {
        let f = 1;
        let r = 0;
        let i = index;
        while (i > 0) {
            f = f / base;
            r = r + f * (i % base);
            i = Math.floor(i / base);
        }
        return r;
    }
    
    /**
     * Advance to next frame (swap buffers)
     */
    nextFrame() {
        // Swap history and current
        const temp = this.historyTexture;
        this.historyTexture = this.currentTexture;
        this.currentTexture = temp;
        
        this.frameIndex++;
        this.updateUniforms();
    }
    
    /**
     * Get jitter offset for applying to projection matrix
     */
    getJitterOffset() {
        const jitter = this._getJitterOffset();
        return [
            jitter[0] * this.jitterScale / this.width * 2,
            jitter[1] * this.jitterScale / this.height * 2
        ];
    }
    
    /**
     * Get history texture view
     */
    getHistoryView() {
        return this.historyTexture?.createView();
    }
    
    /**
     * Get current texture view
     */
    getCurrentView() {
        return this.currentTexture?.createView();
    }
    
    /**
     * Get uniform buffer
     */
    getUniformBuffer() {
        return this.uniformBuffer;
    }
    
    /**
     * Resize textures
     */
    resize(width, height) {
        if (this.width === width && this.height === height) return;
        
        this.historyTexture?.destroy();
        this.currentTexture?.destroy();
        
        this.width = width;
        this.height = height;
        
        const textureDesc = {
            size: [width, height],
            format: 'rgba16float',
            usage: GPUTextureUsage.TEXTURE_BINDING | 
                   GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.RENDER_ATTACHMENT,
        };
        
        this.historyTexture = this.vgpu.texture.create({
            width, height, format: 'rgba16float',
            usage: 'texture|storage|render', label: 'TAAHistory'
        }).texture;
        
        this.currentTexture = this.vgpu.texture.create({
            width, height, format: 'rgba16float',
            usage: 'texture|storage|render', label: 'TAACurrent'
        }).texture;
        
        this.updateUniforms();
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.historyTexture?.destroy();
        this.currentTexture?.destroy();
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default TemporalAccumulation;
