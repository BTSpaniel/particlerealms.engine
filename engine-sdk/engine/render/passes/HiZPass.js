// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HiZPass.js - Hierarchical Z-Buffer for Occlusion Culling
 * Now powered by vGPU driver
 * 
 * Generates a mip-chain from the depth buffer for fast occlusion queries.
 * Each mip level stores the MAXIMUM depth (furthest) of the 2x2 region below,
 * allowing conservative occlusion testing.
 * 
 * Usage:
 * 1. After main depth render, call buildHiZ(depthTexture)
 * 2. Before rendering chunks, call testAABB() to check visibility
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Number of mip levels to generate (each halves resolution)
// 10 levels covers up to 1024x1024, 11 covers 2048x2048
const MAX_MIP_LEVELS = 10;

// Hi-Z downsample shader - takes max of 2x2 depth values
const HIZ_DOWNSAMPLE_SHADER = /* wgsl */ `
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let outputSize = textureDimensions(outputTex);
    
    // Skip if outside output bounds
    if (gid.x >= outputSize.x || gid.y >= outputSize.y) {
        return;
    }
    
    // Map the full source footprint. Fixed 2x2 loads drop odd edge texels.
    let inputSize = textureDimensions(inputTex, 0);

    let start = (gid.xy * inputSize) / outputSize;

    let end = max(start + vec2u(1), ((gid.xy + vec2u(1)) * inputSize) / outputSize);
    
    var maxDepth = 0.0;
    for (var y = start.y; y < end.y; y += 1u) {
        for (var x = start.x; x < end.x; x += 1u) {
            maxDepth = max(maxDepth, textureLoad(inputTex, vec2i(vec2u(x, y)), 0).r);

        }

    }
    
    // Max depth remains conservative for standard depth.
    textureStore(outputTex, vec2<i32>(gid.xy), vec4<f32>(maxDepth, 0.0, 0.0, 1.0));
}
`;

// Initial copy from depth texture to Hi-Z level 0
const HIZ_COPY_SHADER = /* wgsl */ `
@group(0) @binding(0) var depthTex: texture_depth_2d;
@group(0) @binding(1) var outputTex: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let outputSize = textureDimensions(outputTex);
    
    if (gid.x >= outputSize.x || gid.y >= outputSize.y) {
        return;
    }
    
    let depth = textureLoad(depthTex, vec2<i32>(gid.xy), 0);
    textureStore(outputTex, vec2<i32>(gid.xy), vec4<f32>(depth, 0.0, 0.0, 1.0));
}
`;

export class HiZPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        
        // Hi-Z texture (r32float with mip chain)
        this.hiZTexture = null;
        this.hiZViews = [];  // One view per mip level
        this.mipLevels = 0;
        this.width = 0;
        this.height = 0;
        
        // Pipelines
        this.copyPipeline = null;
        this.downsamplePipeline = null;
        
        // Bind group layouts
        this.copyBindGroupLayout = null;
        this.downsampleBindGroupLayout = null;
        
        // Cached bind groups (recreated when textures change)
        this.copyBindGroup = null;
        this.downsampleBindGroups = [];
        
        // Deferred destruction queue - textures destroyed on next frame
        this.pendingDestruction = [];
        
        // View-projection matrix for AABB testing
        this.viewProj = null;
        
        // Stats
        this.lastBuildTime = 0;
        this.enabled = true;
    }
    
    /**
     * Initialize the Hi-Z pass
     * @param {GPUDevice} device 
     * @param {number} width - Initial width
     * @param {number} height - Initial height
     */
    async init(device, width, height) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create shader modules
        const copyModule = this.vgpu.shader.compile('hizCopy', HIZ_COPY_SHADER);
        const downsampleModule = this.vgpu.shader.compile('hizDownsample', HIZ_DOWNSAMPLE_SHADER);
        
        // Copy bind group layout (depth texture -> storage texture)
        this.copyBindGroupLayout = this.vgpu.bindings.defineLayout('hizCopy', [
            { binding: 0, type: 'texture', visibility: 'compute', sampleType: 'depth' },
            { binding: 1, type: 'storage-texture', visibility: 'compute', format: 'r32float', access: 'write-only' },
        ]);
        
        // Downsample bind group layout (texture -> storage texture)
        this.downsampleBindGroupLayout = this.vgpu.bindings.defineLayout('hizDownsample', [
            { binding: 0, type: 'texture', visibility: 'compute', sampleType: 'unfilterable-float' },
            { binding: 1, type: 'storage-texture', visibility: 'compute', format: 'r32float', access: 'write-only' },
        ]);
        
        // Create compute pipelines
        this.copyPipeline = this.vgpu.pipeline.compute({
            module: copyModule,
            entryPoint: 'main',
            layout: this.copyBindGroupLayout,
            label: 'HiZCopyPipeline'
        });
        
        this.downsamplePipeline = this.vgpu.pipeline.compute({
            module: downsampleModule,
            entryPoint: 'main',
            layout: this.downsampleBindGroupLayout,
            label: 'HiZDownsamplePipeline'
        });
        
        // Create initial textures
        this.resize(width, height);
        
        this.initialized = true;
    }
    
    /**
     * Resize Hi-Z texture to match new screen size
     * @param {number} width 
     * @param {number} height 
     */
    resize(width, height) {
        if (!this.device) return;
        if (width === this.width && height === this.height) return;
        
        this.width = width;
        this.height = height;
        
        // Calculate mip levels needed
        this.mipLevels = Math.min(
            MAX_MIP_LEVELS,
            Math.floor(Math.log2(Math.max(width, height))) + 1
        );
        
        // Queue old texture for deferred destruction (GPU may still be using it)
        if (this.hiZTexture) {
            this.pendingDestruction.push(this.hiZTexture);
        }
        
        // Create Hi-Z texture with mip chain
        this.hiZTexture = this.vgpu.texture.create({
            width, height, format: 'r32float',
            usage: 'texture|storage', mipLevelCount: this.mipLevels,
            label: 'HiZTexture'
        }).texture;
        
        // Create views for each mip level
        this.hiZViews = [];
        for (let i = 0; i < this.mipLevels; i++) {
            this.hiZViews.push(this.hiZTexture.createView({
                baseMipLevel: i,
                mipLevelCount: 1,
                label: `HiZ Mip ${i}`,
            }));
        }
        
        // Clear cached bind groups (will be recreated on next build)
        this.copyBindGroup = null;
        this.downsampleBindGroups = [];
    }
    
    /**
     * Build the Hi-Z mip chain from the depth buffer
     * Call this after rendering all opaque geometry
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUTextureView} depthTextureView - The main depth buffer view
     * @param {GPUTexture} depthTexture - The main depth texture (for dimensions)
     */
    buildHiZ(encoder, depthTextureView, depthTexture) {
        if (!this.initialized || !this.enabled) return;
        
        const startTime = performance.now();
        
        // Ensure size matches
        const depthWidth = depthTexture.width;
        const depthHeight = depthTexture.height;
        if (depthWidth !== this.width || depthHeight !== this.height) {
            this.resize(depthWidth, depthHeight);
        }
        
        // Create copy bind group if needed
        if (!this.copyBindGroup) {
            this.copyBindGroup = this.device.createBindGroup({
                layout: this.copyBindGroupLayout,
                entries: [
                    { binding: 0, resource: depthTextureView },
                    { binding: 1, resource: this.hiZViews[0] },
                ],
                label: 'HiZ Copy BindGroup',
            });
        }
        
        // Pass 0: Copy depth to Hi-Z level 0
        {
            const pass = encoder.beginComputePass({ label: 'HiZ Copy Pass' });
            pass.setPipeline(this.copyPipeline);
            pass.setBindGroup(0, this.copyBindGroup);
            pass.dispatchWorkgroups(
                Math.ceil(this.width / 8),
                Math.ceil(this.height / 8)
            );
            pass.end();
        }
        
        // Passes 1-N: Downsample each mip level
        let mipWidth = this.width;
        let mipHeight = this.height;
        
        for (let i = 1; i < this.mipLevels; i++) {
            mipWidth = Math.max(1, Math.floor(mipWidth / 2));
            mipHeight = Math.max(1, Math.floor(mipHeight / 2));
            
            // Create bind group for this level if needed
            if (!this.downsampleBindGroups[i]) {
                this.downsampleBindGroups[i] = this.device.createBindGroup({
                    layout: this.downsampleBindGroupLayout,
                    entries: [
                        { binding: 0, resource: this.hiZViews[i - 1] },
                        { binding: 1, resource: this.hiZViews[i] },
                    ],
                    label: `HiZ Downsample BindGroup ${i}`,
                });
            }
            
            const pass = encoder.beginComputePass({ label: `HiZ Mip ${i}` });
            pass.setPipeline(this.downsamplePipeline);
            pass.setBindGroup(0, this.downsampleBindGroups[i]);
            pass.dispatchWorkgroups(
                Math.ceil(mipWidth / 8),
                Math.ceil(mipHeight / 8)
            );
            pass.end();
        }
        
        this.lastBuildTime = performance.now() - startTime;
    }
    
    /**
     * Set the view-projection matrix for AABB testing
     * @param {Float32Array} viewProj - 4x4 view-projection matrix
     */
    setViewProj(viewProj) {
        this.viewProj = viewProj;
    }
    
    /**
     * Test if an AABB is potentially visible (not fully occluded)
     * This is a CPU-side conservative test using the Hi-Z pyramid
     * 
     * Note: For true GPU-driven culling, you'd do this in a compute shader
     * and use indirect draw. This CPU version is simpler but requires readback.
     * 
     * For now, we'll use a simpler heuristic based on screen-space size
     * and skip the GPU readback overhead.
     * 
     * @param {number} minX - AABB min X
     * @param {number} minY - AABB min Y  
     * @param {number} minZ - AABB min Z
     * @param {number} maxX - AABB max X
     * @param {number} maxY - AABB max Y
     * @param {number} maxZ - AABB max Z
     * @param {number} occluderDepth - Optional: depth of potential occluder
     * @returns {boolean} True if potentially visible
     */
    testAABB(minX, minY, minZ, maxX, maxY, maxZ, occluderDepth = 1.0) {
        // Without GPU readback, we can't do true Hi-Z testing on CPU
        // For now, return true (visible) and let the GPU do the work
        // The value of Hi-Z is in the GPU-side culling via indirect draws
        return true;
    }
    
    /**
     * Get the Hi-Z texture for GPU-side occlusion testing
     * @returns {GPUTexture}
     */
    getHiZTexture() {
        return this.hiZTexture;
    }
    
    /**
     * Get a specific mip level view
     * @param {number} level 
     * @returns {GPUTextureView}
     */
    getMipView(level) {
        return this.hiZViews[Math.min(level, this.hiZViews.length - 1)];
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [hi_z_culling] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.mipLevels = parseInt(cfg.mip_levels) || 8;
        this.threshold = parseFloat(cfg.threshold) || 0.0;
    }
    
    /**
     * Flush pending texture destruction
     * Called after command submission when GPU is done with previous frames
     */
    flushPendingDestruction() {
        for (const texture of this.pendingDestruction) {
            texture.destroy();
        }
        this.pendingDestruction = [];
    }
    
    /**
     * Queue pending destruction flush for next frame
     * Call this after submitting commands to defer destruction until GPU is done
     */
    schedulePendingDestructionFlush() {
        if (this.pendingDestruction.length > 0) {
            // Defer to next microtask so GPU command is submitted first
            Promise.resolve().then(() => this.flushPendingDestruction());
        }
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        // Flush any pending textures
        this.flushPendingDestruction();
        
        if (this.hiZTexture) {
            this.hiZTexture.destroy();
            this.hiZTexture = null;
        }
        this.hiZViews = [];
        this.copyBindGroup = null;
        this.downsampleBindGroups = [];
        this.initialized = false;
    }
}

export default HiZPass;
