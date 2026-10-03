// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BloomPass.js - Bloom Post-Processing Effect
 * Now powered by vGPU driver
 * 
 * Creates a glow effect around bright pixels:
 * 1. Extract bright pixels above threshold
 * 2. Blur the bright pixels (box blur for performance)
 * 3. Composite with original scene
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Reusable buffer for hot paths (reduce/reuse/recycle)
const _bloomUniformData = new Float32Array(4);

// ============================================================================
// SHADERS
// ============================================================================

const BLOOM_EXTRACT_SHADER = /* wgsl */ `
struct BloomUniforms {
    threshold: f32,
    intensity: f32,
    _pad: vec2<f32>,
}

@group(0) @binding(0) var<uniform> bloom: BloomUniforms;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var sceneSampler: sampler;

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

@fragment
fn fs_extract(input: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(sceneTex, sceneSampler, input.uv);
    
    // Calculate luminance
    let luminance = dot(color.rgb, vec3<f32>(0.299, 0.587, 0.114));
    
    // Extract bright parts (soft threshold)
    let brightness = max(0.0, luminance - bloom.threshold);
    let contribution = brightness / (brightness + 1.0); // Soft falloff
    
    return vec4<f32>(color.rgb * contribution, 1.0);
}
`;

const BLOOM_BLUR_SHADER = /* wgsl */ `
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var inputSampler: sampler;

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

@fragment
fn fs_blur(input: VertexOutput) -> @location(0) vec4<f32> {
    let dims = vec2<f32>(textureDimensions(inputTex));
    let texelSize = 1.0 / dims;
    
    // 9-tap box blur (3x3)
    var color = vec3<f32>(0.0);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let offset = vec2<f32>(f32(x), f32(y)) * texelSize * 2.0;
            color += textureSample(inputTex, inputSampler, input.uv + offset).rgb;
        }
    }
    color = color / 9.0;
    
    return vec4<f32>(color, 1.0);
}
`;

const BLOOM_COMPOSITE_SHADER = /* wgsl */ `
struct BloomUniforms {
    threshold: f32,
    intensity: f32,
    _pad: vec2<f32>,
}

@group(0) @binding(0) var<uniform> bloom: BloomUniforms;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var bloomTex: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

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

@fragment
fn fs_composite(input: VertexOutput) -> @location(0) vec4<f32> {
    let scene = textureSample(sceneTex, texSampler, input.uv);
    let bloomColor = textureSample(bloomTex, texSampler, input.uv);
    
    // Add bloom with intensity control
    let result = scene.rgb + bloomColor.rgb * bloom.intensity;
    
    return vec4<f32>(result, scene.a);
}
`;

// ============================================================================
// BLOOM PASS CLASS
// ============================================================================

export class BloomPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.format = 'bgra8unorm';
        this.width = 1;
        this.height = 1;
        
        // Textures
        this.extractTexture = null;
        this.blurTexture1 = null;
        this.blurTexture2 = null;
        
        // Pipelines
        this.extractPipeline = null;
        this.blurPipeline = null;
        this.compositePipeline = null;
        
        // Bind groups
        this.extractBindGroup = null;
        this.blur1BindGroup = null;
        this.blur2BindGroup = null;
        this.compositeBindGroup = null;
        
        // Resources
        this.uniformBuffer = null;
        this.sampler = null;
        
        // Settings
        this.threshold = 0.7;
        this.intensity = 0.5;
        
        this.initialized = false;
        this.enabled = true;
    }
    
    async init(device, width, height, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.width = width;
        this.height = height;
        this.format = format;
        
        // Bloom at half resolution for performance
        const bloomWidth = Math.floor(width / 2);
        const bloomHeight = Math.floor(height / 2);
        
        // Create textures using vGPU
        this.extractTexture = this.vgpu.texture.create({
            width: bloomWidth, height: bloomHeight,
            format: 'rgba16float', usage: 'render|texture', label: 'BloomExtract'
        }).texture;
        
        this.blurTexture1 = this.vgpu.texture.create({
            width: bloomWidth, height: bloomHeight,
            format: 'rgba16float', usage: 'render|texture', label: 'BloomBlur1'
        }).texture;
        
        this.blurTexture2 = this.vgpu.texture.create({
            width: bloomWidth, height: bloomHeight,
            format: 'rgba16float', usage: 'render|texture', label: 'BloomBlur2'
        }).texture;
        
        // Create sampler and uniform buffer
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp' });
        this.uniformBuffer = this.vgpu.buffer.create({ size: 16, usage: 'uniform', label: 'BloomUniforms' }).buffer;
        
        // Create shaders
        const extractModule = this.vgpu.shader.compile('bloomExtract', BLOOM_EXTRACT_SHADER);
        const blurModule = this.vgpu.shader.compile('bloomBlur', BLOOM_BLUR_SHADER);
        const compositeModule = this.vgpu.shader.compile('bloomComposite', BLOOM_COMPOSITE_SHADER);
        
        // Bind group layouts
        const extractLayout = this.vgpu.bindings.defineLayout('bloomExtract', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const blurLayout = this.vgpu.bindings.defineLayout('bloomBlur', [
            { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 1, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const compositeLayout = this.vgpu.bindings.defineLayout('bloomComposite', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 3, type: 'sampler', visibility: 'fragment' },
        ]);
        
        // Store layouts
        this.extractLayout = extractLayout;
        this.blurLayout = blurLayout;
        this.compositeLayout = compositeLayout;
        
        // Create pipelines (no depth attachment - color only post-processing)
        this.extractPipeline = this.vgpu.pipeline.render({
            vertex: { module: extractModule, entryPoint: 'vs_main' },
            fragment: { module: extractModule, entryPoint: 'fs_extract' },
            layouts: [extractLayout],
            colorFormat: 'rgba16float',
            depthFormat: null,
            topology: 'triangle-list',
            label: 'BloomExtractPipeline'
        });
        
        this.blurPipeline = this.vgpu.pipeline.render({
            vertex: { module: blurModule, entryPoint: 'vs_main' },
            fragment: { module: blurModule, entryPoint: 'fs_blur' },
            layouts: [blurLayout],
            colorFormat: 'rgba16float',
            depthFormat: null,
            topology: 'triangle-list',
            label: 'BloomBlurPipeline'
        });
        
        this.compositePipeline = this.vgpu.pipeline.render({
            vertex: { module: compositeModule, entryPoint: 'vs_main' },
            fragment: { module: compositeModule, entryPoint: 'fs_composite' },
            layouts: [compositeLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'BloomCompositePipeline'
        });
        
        this.initialized = true;
    }
    
    updateUniforms() {
        if (!this.initialized) return;
        
        // Reuse module-level buffer
        _bloomUniformData[0] = this.threshold;
        _bloomUniformData[1] = this.intensity;
        _bloomUniformData[2] = 0;
        _bloomUniformData[3] = 0;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _bloomUniformData);
    }
    
    /**
     * Render bloom effect
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUTexture} sceneTexture - Input scene texture
     * @param {GPUTextureView} outputView - Output target (swapchain view)
     */
    render(encoder, sceneTexture, outputView) {
        if (!this.initialized || !this.enabled) return;
        
        this.updateUniforms();
        
        // Cache bind groups + views + pass descriptors (only rebuild on resize / scene texture change)
        if (!this._cachedSceneTex || this._cachedSceneTex !== sceneTexture) {
            this._cachedSceneTex = sceneTexture;
            const sceneView = sceneTexture.createView();
            const extractView = this.extractTexture.createView();
            const blur1View = this.blurTexture1.createView();
            const blur2View = this.blurTexture2.createView();
            
            this.extractBindGroup = this.device.createBindGroup({
                layout: this.extractLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.uniformBuffer } },
                    { binding: 1, resource: sceneView },
                    { binding: 2, resource: this.sampler },
                ],
            });
            this.blur1BindGroup = this.device.createBindGroup({
                layout: this.blurLayout,
                entries: [{ binding: 0, resource: extractView }, { binding: 1, resource: this.sampler }],
            });
            this.blur2BindGroup = this.device.createBindGroup({
                layout: this.blurLayout,
                entries: [{ binding: 0, resource: blur1View }, { binding: 1, resource: this.sampler }],
            });
            this.compositeBindGroup = this.device.createBindGroup({
                layout: this.compositeLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.uniformBuffer } },
                    { binding: 1, resource: sceneView },
                    { binding: 2, resource: blur2View },
                    { binding: 3, resource: this.sampler },
                ],
            });
            
            // Cache render pass descriptors (internal views are stable)
            this._extractRPD = { colorAttachments: [{ view: extractView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] };
            this._blur1RPD = { colorAttachments: [{ view: blur1View, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] };
            this._blur2RPD = { colorAttachments: [{ view: blur2View, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] };
            this._compositeRPD = { colorAttachments: [{ view: null, loadOp: 'load', storeOp: 'store' }] };
        }
        
        // Pass 1: Extract bright pixels
        const extractPass = encoder.beginRenderPass(this._extractRPD);
        extractPass.setPipeline(this.extractPipeline);
        extractPass.setBindGroup(0, this.extractBindGroup);
        extractPass.draw(3);
        extractPass.end();
        
        // Pass 2: Blur horizontal
        const blur1Pass = encoder.beginRenderPass(this._blur1RPD);
        blur1Pass.setPipeline(this.blurPipeline);
        blur1Pass.setBindGroup(0, this.blur1BindGroup);
        blur1Pass.draw(3);
        blur1Pass.end();
        
        // Pass 3: Blur vertical
        const blur2Pass = encoder.beginRenderPass(this._blur2RPD);
        blur2Pass.setPipeline(this.blurPipeline);
        blur2Pass.setBindGroup(0, this.blur2BindGroup);
        blur2Pass.draw(3);
        blur2Pass.end();
        
        // Pass 4: Composite (outputView changes per frame — update in-place)
        this._compositeRPD.colorAttachments[0].view = outputView;
        const compositePass = encoder.beginRenderPass(this._compositeRPD);
        compositePass.setPipeline(this.compositePipeline);
        compositePass.setBindGroup(0, this.compositeBindGroup);
        compositePass.draw(3);
        compositePass.end();
    }
    
    resize(width, height) {
        if (!this.initialized) return;
        
        this.width = width;
        this.height = height;
        
        // Invalidate cached bind groups and descriptors (textures are about to be destroyed)
        this._cachedSceneTex = null;
        
        const bloomWidth = Math.floor(width / 2);
        const bloomHeight = Math.floor(height / 2);
        
        // Recreate textures
        if (this.extractTexture) this.extractTexture.destroy();
        if (this.blurTexture1) this.blurTexture1.destroy();
        if (this.blurTexture2) this.blurTexture2.destroy();
        
        this.extractTexture = this.vgpu.texture.create({
            width: bloomWidth, height: bloomHeight,
            format: 'rgba16float', usage: 'render|texture', label: 'BloomExtract'
        }).texture;
        
        this.blurTexture1 = this.vgpu.texture.create({
            width: bloomWidth, height: bloomHeight,
            format: 'rgba16float', usage: 'render|texture', label: 'BloomBlur1'
        }).texture;
        
        this.blurTexture2 = this.vgpu.texture.create({
            width: bloomWidth, height: bloomHeight,
            format: 'rgba16float', usage: 'render|texture', label: 'BloomBlur2'
        }).texture;
    }
    
    destroy() {
        if (this.extractTexture) this.extractTexture.destroy();
        if (this.blurTexture1) this.blurTexture1.destroy();
        if (this.blurTexture2) this.blurTexture2.destroy();
        if (this.uniformBuffer) this.uniformBuffer.destroy();
        this.initialized = false;
    }
}

export default BloomPass;
