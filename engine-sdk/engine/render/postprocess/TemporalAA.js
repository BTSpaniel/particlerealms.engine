// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Temporal Anti-Aliasing (TAA) System
 * High-quality motion-vector based temporal filtering
 * Used in virtually all modern AAA games
 * Now powered by vGPU driver
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

export class TemporalAA {
    constructor(device, width, height) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.width = width;
        this.height = height;
        
        // History buffers (ping-pong)
        this.historyTextures = [null, null];
        this.currentHistory = 0;
        
        // Motion vector buffer
        this.motionVectorTexture = null;
        
        // Depth buffers for reprojection validation
        this.depthTextures = [null, null];
        
        // Pipelines and bind groups
        this.taaPipeline = null;
        this.sampler = null;
        this.paramsBuffer = null;
        this.bindGroups = [null, null]; // One for each history buffer direction
        
        // Settings
        this.blendFactor = 0.1; // 90% history, 10% current
        this.velocityScale = 1.0;
        
        // Jitter pattern for sub-pixel sampling (Halton sequence)
        this.jitterIndex = 0;
        this.jitterPattern = this._generateHaltonSequence(16);
    }

    async init() {
        await this._createTextures();
        await this._createPipeline();
        console.log('[TAA] Initialized - Temporal anti-aliasing ready');
    }

    _generateHaltonSequence(count) {
        const pattern = [];
        for (let i = 0; i < count; i++) {
            const x = this._halton(i, 2) * 2.0 - 1.0;
            const y = this._halton(i, 3) * 2.0 - 1.0;
            pattern.push([x, y]);
        }
        return pattern;
    }

    _halton(index, base) {
        let result = 0;
        let f = 1.0 / base;
        let i = index;
        while (i > 0) {
            result += f * (i % base);
            i = Math.floor(i / base);
            f /= base;
        }
        return result;
    }

    async _createTextures() {
        const textureDesc = {
            size: [this.width, this.height, 1],
            format: 'rgba16float',
            usage: GPUTextureUsage.TEXTURE_BINDING | 
                   GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.RENDER_ATTACHMENT,
        };

        // History buffers
        this.historyTextures[0] = this.vgpu.texture.create({
            width: this.width, height: this.height, format: 'rgba16float',
            usage: 'texture|storage|render', label: 'TAA_History0'
        }).texture;
        this.historyTextures[1] = this.vgpu.texture.create({
            width: this.width, height: this.height, format: 'rgba16float',
            usage: 'texture|storage|render', label: 'TAA_History1'
        }).texture;

        // Motion vectors (RG16F for velocity)
        this.motionVectorTexture = this.vgpu.texture.create({
            width: this.width, height: this.height, format: 'rg16float',
            usage: 'texture|storage', label: 'MotionVectors'
        }).texture;

        // Depth for reprojection
        this.depthTextures[0] = this.vgpu.texture.create({
            width: this.width, height: this.height, format: 'depth32float',
            usage: 'texture|render', label: 'Depth_Current'
        }).texture;
        this.depthTextures[1] = this.vgpu.texture.create({
            width: this.width, height: this.height, format: 'depth32float',
            usage: 'texture|render', label: 'Depth_Previous'
        }).texture;
    }

    async _createPipeline() {
        const shader = this.vgpu.shader.compile('taa', `
@group(0) @binding(0) var currentFrame: texture_2d<f32>;
@group(0) @binding(1) var historyFrame: texture_2d<f32>;
@group(0) @binding(2) var motionVectors: texture_2d<f32>;
@group(0) @binding(3) var depthCurrent: texture_depth_2d;
@group(0) @binding(4) var depthPrevious: texture_depth_2d;
@group(0) @binding(5) var linearSampler: sampler;
@group(0) @binding(6) var outputTexture: texture_storage_2d<rgba16float, write>;

struct Params {
    invResolution: vec2<f32>,
    blendFactor: f32,
    velocityScale: f32,
}

@group(0) @binding(7) var<uniform> params: Params;

// RGB to YCoCg for better color space comparison
fn RGBToYCoCg(rgb: vec3<f32>) -> vec3<f32> {
    let Y = dot(rgb, vec3<f32>(0.25, 0.5, 0.25));
    let Co = dot(rgb, vec3<f32>(0.5, 0.0, -0.5));
    let Cg = dot(rgb, vec3<f32>(-0.25, 0.5, -0.25));
    return vec3<f32>(Y, Co, Cg);
}

fn YCoCgToRGB(ycocg: vec3<f32>) -> vec3<f32> {
    let Y = ycocg.x;
    let Co = ycocg.y;
    let Cg = ycocg.z;
    return vec3<f32>(
        Y + Co - Cg,
        Y + Cg,
        Y - Co - Cg
    );
}

// Neighborhood clamping for ghosting reduction
fn clipAABB(history: vec3<f32>, current: vec3<f32>, neighborhood: array<vec3<f32>, 9>) -> vec3<f32> {
    var minColor = neighborhood[0];
    var maxColor = neighborhood[0];
    
    for (var i = 1; i < 9; i++) {
        minColor = min(minColor, neighborhood[i]);
        maxColor = max(maxColor, neighborhood[i]);
    }
    
    // Expand AABB slightly to reduce flicker
    let center = (minColor + maxColor) * 0.5;
    let extent = (maxColor - minColor) * 0.5;
    minColor = center - extent * 1.1;
    maxColor = center + extent * 1.1;
    
    // Clip history to AABB
    return clamp(history, minColor, maxColor);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let coord = gid.xy;
    let dims = textureDimensions(currentFrame);
    
    if (coord.x >= dims.x || coord.y >= dims.y) {
        return;
    }
    
    let uv = (vec2<f32>(coord) + 0.5) * params.invResolution;
    
    // Read motion vector
    let velocity = textureLoad(motionVectors, coord, 0).xy * params.velocityScale;
    let historyUV = uv - velocity;
    
    // Sample current frame
    let current = textureLoad(currentFrame, coord, 0).rgb;
    
    // Gather 3x3 neighborhood for AABB clamping
    var neighborhood: array<vec3<f32>, 9>;
    var idx = 0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let sampleCoord = coord + vec2<i32>(x, y);
            neighborhood[idx] = textureLoad(currentFrame, sampleCoord, 0).rgb;
            idx++;
        }
    }
    
    // Sample history with bilinear filtering
    let history = textureSampleLevel(historyFrame, linearSampler, historyUV, 0.0).rgb;
    
    // Convert to YCoCg for better color comparison
    let currentYCoCg = RGBToYCoCg(current);
    let historyYCoCg = RGBToYCoCg(history);
    
    var neighborhoodYCoCg: array<vec3<f32>, 9>;
    for (var i = 0; i < 9; i++) {
        neighborhoodYCoCg[i] = RGBToYCoCg(neighborhood[i]);
    }
    
    // Clip history to neighborhood AABB (reduces ghosting)
    let clippedHistoryYCoCg = clipAABB(historyYCoCg, currentYCoCg, neighborhoodYCoCg);
    let clippedHistory = YCoCgToRGB(clippedHistoryYCoCg);
    
    // Disocclusion detection (compare depths)
    let depthCur = textureLoad(depthCurrent, coord, 0);
    let depthPrev = textureSampleLevel(depthPrevious, linearSampler, historyUV, 0.0);
    let depthDiff = abs(depthCur - depthPrev);
    
    // Adjust blend factor based on disocclusion
    var blend = params.blendFactor;
    if (depthDiff > 0.01) {
        blend = 0.9; // Favor current frame for disoccluded pixels
    }
    
    // Check if history UV is out of bounds
    if (historyUV.x < 0.0 || historyUV.x > 1.0 || historyUV.y < 0.0 || historyUV.y > 1.0) {
        blend = 1.0; // Use only current frame
    }
    
    // Temporal blend
    let result = mix(clippedHistory, current, blend);
    
    // Write result
    textureStore(outputTexture, coord, vec4<f32>(result, 1.0));
}
            `);

        this.taaPipeline = this.vgpu.pipeline.compute({
            module: shader, entryPoint: 'main', label: 'TAAPipeline'
        });

        // Create linear sampler
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            label: 'TAA_LinearSampler',
        });

        // Create params buffer
        this.paramsBuffer = this.vgpu.buffer.create({
            size: 16,
            usage: 'uniform',
            label: 'TAA_Params',
        }).buffer;
    }

    /**
     * Create bind group for TAA pass
     */
    _createBindGroup(currentFrameTexture, outputTexture) {
        const historyIdx = this.currentHistory;
        const historyTexture = this.historyTextures[historyIdx];

        // Update params
        const paramsData = new Float32Array([
            1.0 / this.width, 1.0 / this.height,
            this.blendFactor,
            this.velocityScale,
        ]);
        this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        return this.device.createBindGroup({
            layout: this.taaPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: currentFrameTexture.createView() },
                { binding: 1, resource: historyTexture.createView() },
                { binding: 2, resource: this.motionVectorTexture.createView() },
                { binding: 3, resource: this.depthTextures[0].createView() },
                { binding: 4, resource: this.depthTextures[1].createView() },
                { binding: 5, resource: this.sampler },
                { binding: 6, resource: outputTexture.createView() },
                { binding: 7, resource: { buffer: this.paramsBuffer } },
            ],
            label: 'TAA_BindGroup',
        });
    }

    /**
     * Get jitter offset for current frame (for sub-pixel sampling)
     */
    getJitterOffset() {
        const offset = this.jitterPattern[this.jitterIndex];
        this.jitterIndex = (this.jitterIndex + 1) % this.jitterPattern.length;
        return [
            offset[0] / this.width,
            offset[1] / this.height
        ];
    }

    /**
     * Get motion vector texture for writing during rendering
     */
    getMotionVectorTexture() {
        return this.motionVectorTexture;
    }

    /**
     * Get current depth texture for writing
     */
    getCurrentDepthTexture() {
        return this.depthTextures[0];
    }

    /**
     * Apply TAA to current frame
     * @param {GPUCommandEncoder} commandEncoder
     * @param {GPUTexture} currentFrameTexture - Current frame to apply TAA to
     * @param {GPUTexture} outputTexture - Where to write result (can be next history buffer)
     */
    apply(commandEncoder, currentFrameTexture, outputTexture = null) {
        // Default output is the next history buffer
        const nextHistoryIdx = 1 - this.currentHistory;
        const output = outputTexture || this.historyTextures[nextHistoryIdx];

        const bindGroup = this._createBindGroup(currentFrameTexture, output);
        
        const pass = commandEncoder.beginComputePass({ label: 'TAA' });
        pass.setPipeline(this.taaPipeline);
        pass.setBindGroup(0, bindGroup);
        
        const workgroupsX = Math.ceil(this.width / 8);
        const workgroupsY = Math.ceil(this.height / 8);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY);
        
        pass.end();
        
        // Swap history and depth buffers
        this.currentHistory = nextHistoryIdx;
        [this.depthTextures[0], this.depthTextures[1]] = [this.depthTextures[1], this.depthTextures[0]];
    }

    /**
     * Get the current TAA output (history buffer with latest result)
     */
    getOutputTexture() {
        return this.historyTextures[this.currentHistory];
    }

    destroy() {
        if (this.historyTextures[0]) this.historyTextures[0].destroy();
        if (this.historyTextures[1]) this.historyTextures[1].destroy();
        if (this.motionVectorTexture) this.motionVectorTexture.destroy();
        if (this.depthTextures[0]) this.depthTextures[0].destroy();
        if (this.depthTextures[1]) this.depthTextures[1].destroy();
    }
}
