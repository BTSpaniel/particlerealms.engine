// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AreaResamplePass.js - Area-Weighted Texture Resampling
 * Now powered by vGPU driver
 * 
 * Based on DeadlockCode's resample.comp shader.
 * Provides high-quality upscaling/downscaling using area-weighted averaging.
 * 
 * Use cases:
 * - Dynamic render scaling (render at 50% res, upscale for performance)
 * - Raycast buffer upscaling with better quality than bilinear
 * - Mipmap generation with proper filtering
 * 
 * Algorithm:
 * For each output pixel, calculate the corresponding region in the input.
 * Sum input pixels weighted by their overlap area with the output region.
 * This gives correct results for any scale factor (up or down).
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Reusable buffer for hot paths (reduce/reuse/recycle)
const _areaResampleUniformData = new Float32Array(4);

// ============================================================================
// WGSL SHADER
// ============================================================================

const AREA_RESAMPLE_SHADER = /* wgsl */ `
struct ResampleUniforms {
    inputWidth: f32,
    inputHeight: f32,
    outputWidth: f32,
    outputHeight: f32,
}

@group(0) @binding(0) var<uniform> uniforms: ResampleUniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let outputCoords = vec2<i32>(gid.xy);
    let outputSize = vec2<i32>(i32(uniforms.outputWidth), i32(uniforms.outputHeight));
    
    // Bounds check
    if (outputCoords.x >= outputSize.x || outputCoords.y >= outputSize.y) {
        return;
    }
    
    // Calculate ratio between input and output
    let ratio = vec2<f32>(uniforms.inputWidth, uniforms.inputHeight) / 
                vec2<f32>(uniforms.outputWidth, uniforms.outputHeight);
    
    // Calculate the region in input space that maps to this output pixel
    let inputRegionMin = vec2<f32>(outputCoords) * ratio;
    let inputRegionMax = vec2<f32>(outputCoords + vec2<i32>(1)) * ratio;
    
    // Area-weighted sum
    var areaWeightedSum = vec4<f32>(0.0);
    
    // Iterate over all input pixels that overlap with this region
    let startY = i32(floor(inputRegionMin.y));
    let endY = i32(ceil(inputRegionMax.y));
    let startX = i32(floor(inputRegionMin.x));
    let endX = i32(ceil(inputRegionMax.x));
    
    for (var y = startY; y < endY; y++) {
        for (var x = startX; x < endX; x++) {
            // Calculate overlap between this input pixel and the output region
            let pixelMin = vec2<f32>(f32(x), f32(y));
            let pixelMax = pixelMin + vec2<f32>(1.0);
            
            let overlapMin = max(pixelMin, inputRegionMin);
            let overlapMax = min(pixelMax, inputRegionMax);
            let overlapSize = max(overlapMax - overlapMin, vec2<f32>(0.0));
            let overlapArea = overlapSize.x * overlapSize.y;
            
            // Sample input and weight by overlap area
            let sample = textureLoad(inputTex, vec2<i32>(x, y), 0);
            areaWeightedSum += sample * overlapArea;
        }
    }
    
    // Normalize by total area
    let inputRegionSize = inputRegionMax - inputRegionMin;
    let totalArea = inputRegionSize.x * inputRegionSize.y;
    let result = areaWeightedSum / totalArea;
    
    textureStore(outputTex, outputCoords, result);
}
`;

// Fullscreen triangle vertex shader for blit operations
const BLIT_VERTEX_SHADER = /* wgsl */ `
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Fullscreen triangle
    let x = f32((vertexIndex & 1u) << 2u) - 1.0;
    let y = f32((vertexIndex & 2u) << 1u) - 1.0;
    
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    
    return output;
}
`;

// Fragment shader for final blit (simple passthrough)
const BLIT_FRAGMENT_SHADER = /* wgsl */ `
@group(0) @binding(0) var textureSampler: sampler;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(inputTexture, textureSampler, uv);
}
`;

// ============================================================================
// AREA RESAMPLE PASS CLASS
// ============================================================================

/**
 * AreaResamplePass - GPU-accelerated area-weighted resampling
 * 
 * Better quality than bilinear for arbitrary scale factors.
 * Especially useful for upscaling low-res renders.
 */
export class AreaResamplePass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        
        // Pipelines
        this.resamplePipeline = null;
        this.blitPipeline = null;
        
        // Bind group layouts
        this.resampleBindGroupLayout = null;
        this.blitBindGroupLayout = null;
        
        // Uniform buffer
        this.uniformBuffer = null;
        
        // Cached textures for reuse
        this.cachedTexture = null;
        this.cachedWidth = 0;
        this.cachedHeight = 0;
        
        // Sampler for blit
        this.linearSampler = null;
    }
    
    /**
     * Initialize the resample pass
     * @param {GPUDevice} device - WebGPU device
     */
    async init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create shader modules
        const resampleModule = this.vgpu.shader.compile('areaResample', AREA_RESAMPLE_SHADER);
        const blitVertexModule = this.vgpu.shader.compile('blitVertex', BLIT_VERTEX_SHADER);
        const blitFragmentModule = this.vgpu.shader.compile('blitFragment', BLIT_FRAGMENT_SHADER);
        
        // Create bind group layout for compute
        this.resampleBindGroupLayout = this.vgpu.bindings.defineLayout('areaResample', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'texture', visibility: 'compute', sampleType: 'float' },
            { binding: 2, type: 'storage-texture', visibility: 'compute', format: 'rgba8unorm', access: 'write-only' },
        ]);
        
        // Create compute pipeline
        this.resamplePipeline = this.vgpu.pipeline.compute({
            module: resampleModule,
            entryPoint: 'main',
            layout: this.resampleBindGroupLayout,
            label: 'AreaResamplePipeline'
        });
        
        // Create bind group layout for blit
        this.blitBindGroupLayout = this.vgpu.bindings.defineLayout('blit', [
            { binding: 0, type: 'sampler', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
        ]);
        
        // Create blit render pipeline (no depth attachment)
        this.blitPipeline = this.vgpu.pipeline.render({
            vertex: { module: blitVertexModule, entryPoint: 'main' },
            fragment: { module: blitFragmentModule, entryPoint: 'main' },
            layouts: [this.blitBindGroupLayout],
            colorFormat: 'rgba8unorm',
            depthFormat: null,
            topology: 'triangle-list',
            label: 'BlitPipeline'
        });
        
        // Create uniform buffer and sampler
        this.uniformBuffer = this.vgpu.buffer.create({ size: 16, usage: 'uniform', label: 'AreaResampleUniforms' }).buffer;
        this.linearSampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.initialized = true;
    }
    
    /**
     * Get or create an intermediate texture of the specified size
     * @param {number} width - Texture width
     * @param {number} height - Texture height
     * @returns {GPUTexture} The texture
     */
    getIntermediateTexture(width, height) {
        if (this.cachedTexture && this.cachedWidth === width && this.cachedHeight === height) {
            return this.cachedTexture;
        }
        
        // Destroy old texture
        if (this.cachedTexture) {
            this.cachedTexture.destroy();
        }
        
        // Create new texture using vGPU
        this.cachedTexture = this.vgpu.texture.create({
            width, height, format: 'rgba8unorm',
            usage: 'storage|texture', label: 'AreaResampleIntermediate'
        }).texture;
        
        this.cachedWidth = width;
        this.cachedHeight = height;
        
        return this.cachedTexture;
    }
    
    /**
     * Resample input texture to output texture using area-weighted averaging
     * 
     * @param {GPUCommandEncoder} encoder - Command encoder
     * @param {GPUTexture} inputTexture - Source texture
     * @param {GPUTexture} outputTexture - Destination texture (must have STORAGE_BINDING)
     */
    resample(encoder, inputTexture, outputTexture) {
        if (!this.initialized) {
            console.warn('AreaResamplePass not initialized');
            return;
        }
        
        const inputWidth = inputTexture.width;
        const inputHeight = inputTexture.height;
        const outputWidth = outputTexture.width;
        const outputHeight = outputTexture.height;
        
        // Update uniforms - reuse buffer
        _areaResampleUniformData[0] = inputWidth;
        _areaResampleUniformData[1] = inputHeight;
        _areaResampleUniformData[2] = outputWidth;
        _areaResampleUniformData[3] = outputHeight;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _areaResampleUniformData);
        
        // Create bind group
        const bindGroup = this.device.createBindGroup({
            layout: this.resampleBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: inputTexture.createView() },
                { binding: 2, resource: outputTexture.createView() },
            ],
        });
        
        // Dispatch compute
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.resamplePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(outputWidth / 8),
            Math.ceil(outputHeight / 8)
        );
        pass.end();
    }
    
    /**
     * Resample and blit to a render target (convenience method)
     * 
     * @param {GPUCommandEncoder} encoder - Command encoder
     * @param {GPUTexture} inputTexture - Source texture
     * @param {GPUTextureView} outputView - Destination render target view
     * @param {number} outputWidth - Output width
     * @param {number} outputHeight - Output height
     */
    resampleAndBlit(encoder, inputTexture, outputView, outputWidth, outputHeight) {
        if (!this.initialized) {
            console.warn('AreaResamplePass not initialized');
            return;
        }
        
        // Get intermediate texture at output size
        const intermediate = this.getIntermediateTexture(outputWidth, outputHeight);
        
        // Resample to intermediate
        this.resample(encoder, inputTexture, intermediate);
        
        // Blit intermediate to output
        const blitBindGroup = this.device.createBindGroup({
            layout: this.blitBindGroupLayout,
            entries: [
                { binding: 0, resource: this.linearSampler },
                { binding: 1, resource: intermediate.createView() },
            ],
        });
        
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: outputView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        
        pass.setPipeline(this.blitPipeline);
        pass.setBindGroup(0, blitBindGroup);
        pass.draw(3);
        pass.end();
    }
    
    /**
     * Cleanup GPU resources
     */
    destroy() {
        this.cachedTexture?.destroy();
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// CPU FALLBACK - Area-weighted resampling for ImageData
// ============================================================================

/**
 * CPU area-weighted resample for ImageData (fallback or small images)
 * 
 * @param {ImageData} input - Source image data
 * @param {number} outputWidth - Output width
 * @param {number} outputHeight - Output height
 * @returns {ImageData} Resampled image data
 */
export function areaResampleCPU(input, outputWidth, outputHeight) {
    const output = new ImageData(outputWidth, outputHeight);
    const { width: inputWidth, height: inputHeight, data: inputData } = input;
    const outputData = output.data;
    
    const ratioX = inputWidth / outputWidth;
    const ratioY = inputHeight / outputHeight;
    
    for (let oy = 0; oy < outputHeight; oy++) {
        for (let ox = 0; ox < outputWidth; ox++) {
            // Input region for this output pixel
            const inputMinX = ox * ratioX;
            const inputMaxX = (ox + 1) * ratioX;
            const inputMinY = oy * ratioY;
            const inputMaxY = (oy + 1) * ratioY;
            
            // Area-weighted sum
            let r = 0, g = 0, b = 0, a = 0;
            let totalArea = 0;
            
            const startX = Math.floor(inputMinX);
            const endX = Math.ceil(inputMaxX);
            const startY = Math.floor(inputMinY);
            const endY = Math.ceil(inputMaxY);
            
            for (let iy = startY; iy < endY; iy++) {
                for (let ix = startX; ix < endX; ix++) {
                    if (ix < 0 || ix >= inputWidth || iy < 0 || iy >= inputHeight) continue;
                    
                    // Calculate overlap
                    const overlapMinX = Math.max(ix, inputMinX);
                    const overlapMaxX = Math.min(ix + 1, inputMaxX);
                    const overlapMinY = Math.max(iy, inputMinY);
                    const overlapMaxY = Math.min(iy + 1, inputMaxY);
                    
                    const overlapWidth = Math.max(0, overlapMaxX - overlapMinX);
                    const overlapHeight = Math.max(0, overlapMaxY - overlapMinY);
                    const area = overlapWidth * overlapHeight;
                    
                    if (area > 0) {
                        const idx = (iy * inputWidth + ix) * 4;
                        r += inputData[idx] * area;
                        g += inputData[idx + 1] * area;
                        b += inputData[idx + 2] * area;
                        a += inputData[idx + 3] * area;
                        totalArea += area;
                    }
                }
            }
            
            // Write output pixel
            const outIdx = (oy * outputWidth + ox) * 4;
            if (totalArea > 0) {
                outputData[outIdx] = Math.round(r / totalArea);
                outputData[outIdx + 1] = Math.round(g / totalArea);
                outputData[outIdx + 2] = Math.round(b / totalArea);
                outputData[outIdx + 3] = Math.round(a / totalArea);
            }
        }
    }
    
    return output;
}

// ============================================================================
// EXPORTS
// ============================================================================

export { AREA_RESAMPLE_SHADER, BLIT_VERTEX_SHADER, BLIT_FRAGMENT_SHADER };
