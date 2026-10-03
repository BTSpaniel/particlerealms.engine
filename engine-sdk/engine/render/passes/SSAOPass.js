// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SSAOPass.js - Screen-Space Ambient Occlusion for Voxel Terrain
 * Now powered by vGPU driver
 * 
 * Lightweight SSAO implementation:
 * - Reconstructs normals from depth buffer
 * - Uses 8-sample hemisphere kernel
 * - Quarter-resolution for performance
 * - Simple box blur
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// SSAO resolution scale (0.5 = half res, 0.25 = quarter res)
const SSAO_SCALE = 0.35;

// Number of samples (keep low for performance)
const SSAO_SAMPLES = 8;

import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

const SSAO_UNIFORMS_STRUCT = `struct SSAOUniforms {
    invProj: mat4x4<f32>,
    proj: mat4x4<f32>,
    screenSize: vec2<f32>,
    radius: f32,
    bias: f32,
    intensity: f32,
    _pad: vec3<f32>,
}`;
const SSAO_UNIFORM_FLOATS = getFloat32ArraySize(SSAO_UNIFORMS_STRUCT);

// SSAO shader
const SSAO_SHADER = /* wgsl */ `
${SSAO_UNIFORMS_STRUCT}

@group(0) @binding(0) var<uniform> ssao: SSAOUniforms;
@group(0) @binding(1) var depthTex: texture_depth_2d;

// Helper to load depth at pixel coordinates
fn loadDepth(pixelCoord: vec2<i32>) -> f32 {
    let dims = vec2<i32>(textureDimensions(depthTex));
    let clamped = clamp(pixelCoord, vec2<i32>(0), dims - vec2<i32>(1));
    return textureLoad(depthTex, clamped, 0);
}

// Helper to sample depth at UV coordinates
fn sampleDepthAt(uv: vec2<f32>) -> f32 {
    let dims = vec2<f32>(textureDimensions(depthTex));
    let pixelCoord = vec2<i32>(uv * dims);
    return loadDepth(pixelCoord);
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

// Fullscreen triangle
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    
    // Generate fullscreen triangle
    let x = f32((vertexIndex & 1u) << 2u) - 1.0;
    let y = f32((vertexIndex & 2u) << 1u) - 1.0;
    
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    
    return output;
}

// Reconstruct view-space position from depth
fn getViewPos(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let ndc = vec4<f32>(uv * 2.0 - 1.0, depth, 1.0);
    var viewPos = ssao.invProj * ndc;
    viewPos = viewPos / viewPos.w;
    return viewPos.xyz;
}

// Simple hash for random sampling
fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_ssao(input: VertexOutput) -> @location(0) vec4<f32> {
    let texelSize = 1.0 / ssao.screenSize;
    
    // Load all depths upfront using textureLoad (no sampler needed)
    let depth = sampleDepthAt(input.uv);
    let depthR = sampleDepthAt(input.uv + vec2<f32>(texelSize.x, 0.0));
    let depthU = sampleDepthAt(input.uv + vec2<f32>(0.0, texelSize.y));
    
    // Check if sky (will select result at end)
    let isSky = depth >= 0.9999;
    
    // Reconstruct view-space position
    let ndc = vec4<f32>(input.uv * 2.0 - 1.0, depth, 1.0);
    var viewPosH = ssao.invProj * ndc;
    let viewPos = viewPosH.xyz / viewPosH.w;
    
    // Reconstruct normal from depth derivatives
    let ndcR = vec4<f32>((input.uv + vec2<f32>(texelSize.x, 0.0)) * 2.0 - 1.0, depthR, 1.0);
    var viewPosRH = ssao.invProj * ndcR;
    let posR = viewPosRH.xyz / viewPosRH.w;
    
    let ndcU = vec4<f32>((input.uv + vec2<f32>(0.0, texelSize.y)) * 2.0 - 1.0, depthU, 1.0);
    var viewPosUH = ssao.invProj * ndcU;
    let posU = viewPosUH.xyz / viewPosUH.w;
    
    let dx = posR - viewPos;
    let dy = posU - viewPos;
    let normal = normalize(cross(dy, dx));
    
    // Random rotation based on screen position
    let randomAngle = hash(input.uv * ssao.screenSize) * 6.283185;
    let randomCos = cos(randomAngle);
    let randomSin = sin(randomAngle);
    
    let radius = ssao.radius;
    
    // Unrolled 8-sample hemisphere (to avoid loop with textureSample)
    var occlusion = 0.0;
    
    // Sample 0
    {
        let angle = 0.0 * 2.399963 + hash(input.uv * 100.0) * 6.283185;
        let r = 0.5 / 8.0;
        let h = hash(input.uv * 50.0);
        var sd = vec3<f32>(cos(angle) * r, sin(angle) * r, h * 0.5 + 0.5);
        let rx = sd.x * randomCos - sd.y * randomSin;
        let ry = sd.x * randomSin + sd.y * randomCos;
        sd = vec3<f32>(rx, ry, sd.z);
        let tangent = normalize(sd - normal * dot(sd, normal));
        let bitangent = cross(normal, tangent);
        let offset = tangent * sd.x + bitangent * sd.y + normal * sd.z;
        let samplePos = viewPos + offset * radius;
        let projected = ssao.proj * vec4<f32>(samplePos, 1.0);
        let sUV = vec2<f32>((projected.x / projected.w) * 0.5 + 0.5, 1.0 - ((projected.y / projected.w) * 0.5 + 0.5));
        let sDepth = sampleDepthAt(clamp(sUV, vec2<f32>(0.0), vec2<f32>(1.0)));
        let sNdc = vec4<f32>(sUV * 2.0 - 1.0, sDepth, 1.0);
        var sViewH = ssao.invProj * sNdc;
        let sViewPos = sViewH.xyz / sViewH.w;
        let rangeCheck = smoothstep(0.0, 1.0, radius / max(abs(viewPos.z - sViewPos.z), 0.001));
        occlusion += select(0.0, 1.0, sViewPos.z >= samplePos.z + ssao.bias) * rangeCheck;
    }
    
    // Sample 1
    {
        let angle = 1.0 * 2.399963 + hash(input.uv * 100.0) * 6.283185;
        let r = 1.5 / 8.0;
        let h = hash(input.uv * 50.0 + 0.1);
        var sd = vec3<f32>(cos(angle) * r, sin(angle) * r, h * 0.5 + 0.5);
        let rx = sd.x * randomCos - sd.y * randomSin;
        let ry = sd.x * randomSin + sd.y * randomCos;
        sd = vec3<f32>(rx, ry, sd.z);
        let tangent = normalize(sd - normal * dot(sd, normal));
        let bitangent = cross(normal, tangent);
        let offset = tangent * sd.x + bitangent * sd.y + normal * sd.z;
        let samplePos = viewPos + offset * radius;
        let projected = ssao.proj * vec4<f32>(samplePos, 1.0);
        let sUV = vec2<f32>((projected.x / projected.w) * 0.5 + 0.5, 1.0 - ((projected.y / projected.w) * 0.5 + 0.5));
        let sDepth = sampleDepthAt(clamp(sUV, vec2<f32>(0.0), vec2<f32>(1.0)));
        let sNdc = vec4<f32>(sUV * 2.0 - 1.0, sDepth, 1.0);
        var sViewH = ssao.invProj * sNdc;
        let sViewPos = sViewH.xyz / sViewH.w;
        let rangeCheck = smoothstep(0.0, 1.0, radius / max(abs(viewPos.z - sViewPos.z), 0.001));
        occlusion += select(0.0, 1.0, sViewPos.z >= samplePos.z + ssao.bias) * rangeCheck;
    }
    
    // Sample 2
    {
        let angle = 2.0 * 2.399963 + hash(input.uv * 100.0) * 6.283185;
        let r = 2.5 / 8.0;
        let h = hash(input.uv * 50.0 + 0.2);
        var sd = vec3<f32>(cos(angle) * r, sin(angle) * r, h * 0.5 + 0.5);
        let rx = sd.x * randomCos - sd.y * randomSin;
        let ry = sd.x * randomSin + sd.y * randomCos;
        sd = vec3<f32>(rx, ry, sd.z);
        let tangent = normalize(sd - normal * dot(sd, normal));
        let bitangent = cross(normal, tangent);
        let offset = tangent * sd.x + bitangent * sd.y + normal * sd.z;
        let samplePos = viewPos + offset * radius;
        let projected = ssao.proj * vec4<f32>(samplePos, 1.0);
        let sUV = vec2<f32>((projected.x / projected.w) * 0.5 + 0.5, 1.0 - ((projected.y / projected.w) * 0.5 + 0.5));
        let sDepth = sampleDepthAt(clamp(sUV, vec2<f32>(0.0), vec2<f32>(1.0)));
        let sNdc = vec4<f32>(sUV * 2.0 - 1.0, sDepth, 1.0);
        var sViewH = ssao.invProj * sNdc;
        let sViewPos = sViewH.xyz / sViewH.w;
        let rangeCheck = smoothstep(0.0, 1.0, radius / max(abs(viewPos.z - sViewPos.z), 0.001));
        occlusion += select(0.0, 1.0, sViewPos.z >= samplePos.z + ssao.bias) * rangeCheck;
    }
    
    // Sample 3
    {
        let angle = 3.0 * 2.399963 + hash(input.uv * 100.0) * 6.283185;
        let r = 3.5 / 8.0;
        let h = hash(input.uv * 50.0 + 0.3);
        var sd = vec3<f32>(cos(angle) * r, sin(angle) * r, h * 0.5 + 0.5);
        let rx = sd.x * randomCos - sd.y * randomSin;
        let ry = sd.x * randomSin + sd.y * randomCos;
        sd = vec3<f32>(rx, ry, sd.z);
        let tangent = normalize(sd - normal * dot(sd, normal));
        let bitangent = cross(normal, tangent);
        let offset = tangent * sd.x + bitangent * sd.y + normal * sd.z;
        let samplePos = viewPos + offset * radius;
        let projected = ssao.proj * vec4<f32>(samplePos, 1.0);
        let sUV = vec2<f32>((projected.x / projected.w) * 0.5 + 0.5, 1.0 - ((projected.y / projected.w) * 0.5 + 0.5));
        let sDepth = sampleDepthAt(clamp(sUV, vec2<f32>(0.0), vec2<f32>(1.0)));
        let sNdc = vec4<f32>(sUV * 2.0 - 1.0, sDepth, 1.0);
        var sViewH = ssao.invProj * sNdc;
        let sViewPos = sViewH.xyz / sViewH.w;
        let rangeCheck = smoothstep(0.0, 1.0, radius / max(abs(viewPos.z - sViewPos.z), 0.001));
        occlusion += select(0.0, 1.0, sViewPos.z >= samplePos.z + ssao.bias) * rangeCheck;
    }
    
    // Samples 4-7 (simplified - use averaged result from 0-3)
    occlusion = occlusion * 2.0; // Double the 4 samples to approximate 8
    
    let ao = 1.0 - (occlusion / 8.0) * ssao.intensity;
    
    // Select between sky (1.0) and computed AO
    return vec4<f32>(select(ao, 1.0, isSky));
}
`;

// Blur shader
const BLUR_SHADER = /* wgsl */ `
@group(0) @binding(0) var ssaoTex: texture_2d<f32>;
@group(0) @binding(1) var ssaoSampler: sampler;

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
    let texelSize = vec2<f32>(1.0) / vec2<f32>(textureDimensions(ssaoTex));
    
    var result = 0.0;
    
    // 4x4 box blur
    for (var x = -2; x <= 1; x = x + 1) {
        for (var y = -2; y <= 1; y = y + 1) {
            let offset = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5) * texelSize;
            result = result + textureSample(ssaoTex, ssaoSampler, input.uv + offset).r;
        }
    }
    
    result = result / 16.0;
    
    return vec4<f32>(result, result, result, 1.0);
}
`;

// Composite shader (applies SSAO to final image)
const COMPOSITE_SHADER = /* wgsl */ `
@group(0) @binding(0) var colorTex: texture_2d<f32>;
@group(0) @binding(1) var ssaoTex: texture_2d<f32>;
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

@fragment
fn fs_composite(input: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(colorTex, texSampler, input.uv);
    let ao = textureSample(ssaoTex, texSampler, input.uv).r;
    
    return vec4<f32>(color.rgb * ao, color.a);
}
`;

/**
 * SSAO Pass Manager
 */
export class SSAOPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.enabled = true;
        
        // Textures
        this.ssaoTexture = null;
        this.ssaoView = null;
        this.blurTexture = null;
        this.blurView = null;
        this.colorTexture = null;
        this.colorView = null;
        
        // Pipelines
        this.ssaoPipeline = null;
        this.blurPipeline = null;
        this.compositePipeline = null;
        
        // Bind groups
        this.ssaoBindGroup = null;
        this.blurBindGroup = null;
        this.compositeBindGroup = null;
        
        // Uniforms
        this.uniformBuffer = null;
        this.sampler = null;
        
        // Settings
        this.radius = 1.0;
        this.bias = 0.01;
        this.intensity = 0.5;
        
        // Size
        this.width = 1;
        this.height = 1;
        
        // Deferred destruction queue - textures destroyed on next frame
        this.pendingDestruction = [];
        
        this.initialized = false;
        this.enabled = true;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(SSAO_UNIFORM_FLOATS);
    }
    
    /**
     * Initialize SSAO pass
     * @param {GPUDevice} device
     * @param {number} width
     * @param {number} height
     * @param {string} format - Output format
     */
    async init(device, width, height, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.width = width;
        this.height = height;
        this.format = format;
        
        // SSAO resolution
        const ssaoWidth = Math.floor(width * SSAO_SCALE);
        const ssaoHeight = Math.floor(height * SSAO_SCALE);
        
        // Create textures using vGPU
        this.ssaoTexture = this.vgpu.texture.create({
            width: ssaoWidth, height: ssaoHeight,
            format: 'r8unorm', usage: 'render|texture', label: 'SSAOTexture'
        }).texture;
        this.ssaoView = this.ssaoTexture.createView();
        
        this.blurTexture = this.vgpu.texture.create({
            width: ssaoWidth, height: ssaoHeight,
            format: 'r8unorm', usage: 'render|texture', label: 'SSAOBlurTexture'
        }).texture;
        this.blurView = this.blurTexture.createView();
        
        this.colorTexture = this.vgpu.texture.create({
            width, height, format,
            usage: 'render|texture|copy-dst', label: 'SSAOColorCopy'
        }).texture;
        this.colorView = this.colorTexture.createView();
        
        // Create sampler and uniform buffer
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp' });
        this.uniformBuffer = this.vgpu.buffer.create({ size: 176, usage: 'uniform', label: 'SSAOUniforms' }).buffer;
        
        // Create shaders
        const ssaoModule = this.vgpu.shader.compile('ssao', SSAO_SHADER);
        const blurModule = this.vgpu.shader.compile('ssaoBlur', BLUR_SHADER);
        const compositeModule = this.vgpu.shader.compile('ssaoComposite', COMPOSITE_SHADER);
        
        // Bind group layouts
        const ssaoBindGroupLayout = this.vgpu.bindings.defineLayout('ssao', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'depth' },
        ]);
        
        const blurBindGroupLayout = this.vgpu.bindings.defineLayout('ssaoBlur', [
            { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 1, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const compositeBindGroupLayout = this.vgpu.bindings.defineLayout('ssaoComposite', [
            { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        // Create pipelines (no depth attachment - color only post-processing)
        this.ssaoPipeline = this.vgpu.pipeline.render({
            vertex: { module: ssaoModule, entryPoint: 'vs_main' },
            fragment: { module: ssaoModule, entryPoint: 'fs_ssao' },
            layouts: [ssaoBindGroupLayout],
            colorFormat: 'r8unorm',
            depthFormat: null,  // No depth attachment
            topology: 'triangle-list',
            label: 'SSAOPipeline'
        });
        
        this.blurPipeline = this.vgpu.pipeline.render({
            vertex: { module: blurModule, entryPoint: 'vs_main' },
            fragment: { module: blurModule, entryPoint: 'fs_blur' },
            layouts: [blurBindGroupLayout],
            colorFormat: 'r8unorm',
            depthFormat: null,  // No depth attachment
            topology: 'triangle-list',
            label: 'SSAOBlurPipeline'
        });
        
        this.compositePipeline = this.vgpu.pipeline.render({
            vertex: { module: compositeModule, entryPoint: 'vs_main' },
            fragment: { module: compositeModule, entryPoint: 'fs_composite' },
            layouts: [compositeBindGroupLayout],
            colorFormat: format,
            depthFormat: null,  // No depth attachment
            topology: 'triangle-list',
            label: 'SSAOCompositePipeline'
        });
        
        // Store layouts for bind group creation
        this.ssaoBindGroupLayout = ssaoBindGroupLayout;
        this.blurBindGroupLayout = blurBindGroupLayout;
        this.compositeBindGroupLayout = compositeBindGroupLayout;
        
        this.initialized = true;
    }
    
    /**
     * Resize textures
     */
    resize(width, height) {
        if (!this.initialized) return;
        
        this.width = width;
        this.height = height;
        
        const ssaoWidth = Math.floor(width * SSAO_SCALE);
        const ssaoHeight = Math.floor(height * SSAO_SCALE);
        
        // Queue old textures for deferred destruction (GPU may still be using them)
        if (this.ssaoTexture) this.pendingDestruction.push(this.ssaoTexture);
        if (this.blurTexture) this.pendingDestruction.push(this.blurTexture);
        if (this.colorTexture) this.pendingDestruction.push(this.colorTexture);
        
        this.ssaoTexture = this.vgpu.texture.create({
            width: ssaoWidth, height: ssaoHeight,
            format: 'r8unorm', usage: 'render|texture', label: 'SSAOTexture'
        }).texture;
        this.ssaoView = this.ssaoTexture.createView();
        
        this.blurTexture = this.vgpu.texture.create({
            width: ssaoWidth, height: ssaoHeight,
            format: 'r8unorm', usage: 'render|texture', label: 'SSAOBlurTexture'
        }).texture;
        this.blurView = this.blurTexture.createView();
        
        this.colorTexture = this.vgpu.texture.create({
            width, height, format: this.format,
            usage: 'render|texture|copy-dst', label: 'SSAOColorCopy'
        }).texture;
        this.colorView = this.colorTexture.createView();
        
        // Invalidate bind groups
        this.ssaoBindGroup = null;
        this.blurBindGroup = null;
        this.compositeBindGroup = null;
    }
    
    /**
     * Update uniforms
     * @param {Float32Array} invProj - Inverse projection matrix
     * @param {Float32Array} proj - Projection matrix
     */
    updateUniforms(invProj, proj) {
        if (!this.initialized) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        data.set(invProj, 0);           // 0-15: invProj
        data.set(proj, 16);             // 16-31: proj
        data[32] = this.width;          // screenSize.x
        data[33] = this.height;         // screenSize.y
        data[34] = this.radius;         // radius
        data[35] = this.bias;           // bias
        data[36] = this.intensity;      // intensity
        // 37-39: padding
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Create or update bind groups
     * @param {GPUTextureView} depthView - Depth texture view
     */
    ensureBindGroups(depthView) {
        if (!this.initialized) return;
        
        // SSAO bind group (needs depth view, no sampler since using textureLoad)
        this.ssaoBindGroup = this.device.createBindGroup({
            layout: this.ssaoBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: depthView },
            ],
        });
        
        // Blur bind group
        this.blurBindGroup = this.device.createBindGroup({
            layout: this.blurBindGroupLayout,
            entries: [
                { binding: 0, resource: this.ssaoView },
                { binding: 1, resource: this.sampler },
            ],
        });
        
        // Composite bind group
        this.compositeBindGroup = this.device.createBindGroup({
            layout: this.compositeBindGroupLayout,
            entries: [
                { binding: 0, resource: this.colorView },
                { binding: 1, resource: this.blurView },
                { binding: 2, resource: this.sampler },
            ],
        });
    }
    
    /**
     * Render SSAO pass
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTextureView} depthView - Depth texture from main pass
     * @param {GPUTexture} colorTexture - Color texture to copy and composite
     * @param {GPUTextureView} outputView - Final output view
     */
    render(encoder, depthView, colorTexture, outputView) {
        if (!this.initialized || !this.enabled) return;
        
        // Flush pending texture destruction (GPU is done with previous frames)
        this.flushPendingDestruction();
        
        // Copy color to our texture
        encoder.copyTextureToTexture(
            { texture: colorTexture },
            { texture: this.colorTexture },
            [this.width, this.height, 1]
        );
        
        // Ensure bind groups are created
        this.ensureBindGroups(depthView);
        
        // Pass 1: SSAO
        const ssaoPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.ssaoView,
                clearValue: { r: 1, g: 1, b: 1, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        ssaoPass.setPipeline(this.ssaoPipeline);
        ssaoPass.setBindGroup(0, this.ssaoBindGroup);
        ssaoPass.draw(3);
        ssaoPass.end();
        
        // Pass 2: Blur
        const blurPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: this.blurView,
                clearValue: { r: 1, g: 1, b: 1, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        blurPass.setPipeline(this.blurPipeline);
        blurPass.setBindGroup(0, this.blurBindGroup);
        blurPass.draw(3);
        blurPass.end();
        
        // Pass 3: Composite
        const compositePass = encoder.beginRenderPass({
            colorAttachments: [{
                view: outputView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        compositePass.setPipeline(this.compositePipeline);
        compositePass.setBindGroup(0, this.compositeBindGroup);
        compositePass.draw(3);
        compositePass.end();
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [ssao] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.radius = parseFloat(cfg.radius) || 0.5;
        this.bias = parseFloat(cfg.bias) || 0.025;
        this.intensity = parseFloat(cfg.intensity) || 1.0;
        // Note: samples is compile-time constant in shader
    }
    
    /**
     * Flush pending texture destruction
     */
    flushPendingDestruction() {
        for (const texture of this.pendingDestruction) {
            texture.destroy();
        }
        this.pendingDestruction = [];
    }
    
    /**
     * Destroy resources
     */
    destroy() {
        this.flushPendingDestruction();
        if (this.ssaoTexture) this.ssaoTexture.destroy();
        if (this.blurTexture) this.blurTexture.destroy();
        if (this.colorTexture) this.colorTexture.destroy();
        if (this.uniformBuffer) this.uniformBuffer.destroy();
    }
}

export default SSAOPass;
