// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * SSRPass.js - Screen-Space Reflections

 * Now powered by vGPU driver

 * 

 * Ray marches through the depth buffer to find reflections.

 * Great for water, ice, and shiny surfaces.

 * 

 * Benefits:

 * - Dynamic reflections without cubemaps

 * - Works with any geometry

 * - Configurable quality/performance tradeoff

 * 

 * Limitations:

 * - Can only reflect visible geometry

 * - Artifacts at screen edges

 * - Requires depth + normal buffers

 */



import { initVGPU } from '../../core/gpu/VirtualGPU.js';

import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';
import { LEGACY_PCG32_WGSL } from '../../core/math/MathBits.js';



const SSR_UNIFORMS_STRUCT = `struct SSRUniforms {

    viewMatrix: mat4x4<f32>,

    projMatrix: mat4x4<f32>,

    invViewMatrix: mat4x4<f32>,

    invProjMatrix: mat4x4<f32>,

    resolution: vec2<f32>,

    maxSteps: f32,

    maxDistance: f32,

    thickness: f32,

    stride: f32,

    jitter: f32,

    fadeStart: f32,

    fadeEnd: f32,

    roughnessThreshold: f32,

}`;

const SSR_UNIFORM_FLOATS = getFloat32ArraySize(SSR_UNIFORMS_STRUCT);

export const SSR_JITTER_PCG_HASH_WGSL = /* wgsl */ `
fn ssrJitterHash2D(bits: vec2<u32>) -> u32 {
    return legacyPcgSsrJitterHash2D(bits);
}
`;



const SSR_SHADER = /* wgsl */ `

${SSR_UNIFORMS_STRUCT}
${LEGACY_PCG32_WGSL}
${SSR_JITTER_PCG_HASH_WGSL}



@group(0) @binding(0) var<uniform> ssr: SSRUniforms;

@group(0) @binding(1) var colorTexture: texture_2d<f32>;

@group(0) @binding(2) var depthTexture: texture_2d<f32>;

@group(0) @binding(3) var normalTexture: texture_2d<f32>;

@group(0) @binding(4) var linearSampler: sampler;

@group(0) @binding(5) var nearestSampler: sampler;



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



// Reconstruct view-space position from depth

fn getViewPos(uv: vec2<f32>, depth: f32) -> vec3<f32> {

    let ndc = vec4<f32>(uv * 2.0 - 1.0, depth, 1.0);

    let viewPos = ssr.invProjMatrix * ndc;

    return viewPos.xyz / viewPos.w;

}



// Project view-space position to screen UV

fn projectToScreen(viewPos: vec3<f32>) -> vec3<f32> {

    let clipPos = ssr.projMatrix * vec4<f32>(viewPos, 1.0);

    let ndc = clipPos.xyz / clipPos.w;

    return vec3<f32>(ndc.xy * 0.5 + 0.5, ndc.z);

}



// Binary search refinement for more accurate hit

fn binarySearch(rayOrigin: vec3<f32>, rayDir: vec3<f32>, hitT: f32) -> vec3<f32> {

    var t = hitT;

    var step = hitT * 0.5;

    

    for (var i = 0; i < 8; i++) {

        let pos = rayOrigin + rayDir * t;

        let screenPos = projectToScreen(pos);

        

        if (screenPos.x < 0.0 || screenPos.x > 1.0 || 

            screenPos.y < 0.0 || screenPos.y > 1.0) {

            break;

        }

        

        let screenDepth = textureSampleLevel(depthTexture, nearestSampler, screenPos.xy, 0.0).r;

        let sampleViewPos = getViewPos(screenPos.xy, screenDepth);

        

        if (pos.z < sampleViewPos.z) {

            t -= step;

        } else {

            t += step;

        }

        step *= 0.5;

    }

    

    return rayOrigin + rayDir * t;

}



// Main ray marching function

fn traceRay(rayOrigin: vec3<f32>, rayDir: vec3<f32>) -> vec4<f32> {

    let maxSteps = i32(ssr.maxSteps);

    var stepSize = ssr.stride;

    

    // Add jitter to reduce banding

    let jitterBits = vec2<u32>(bitcast<u32>(rayOrigin.x), bitcast<u32>(rayOrigin.y));

    var t = ssr.jitter * stepSize * f32(ssrJitterHash2D(jitterBits) & 0x00FFFFFFu) / 16777215.0;

    

    var prevScreenPos = vec3<f32>(0.0);

    var prevViewZ = 0.0;

    

    for (var i = 0; i < maxSteps; i++) {

        t += stepSize;

        

        if (t > ssr.maxDistance) {

            break;

        }

        

        let pos = rayOrigin + rayDir * t;

        let screenPos = projectToScreen(pos);

        

        // Check screen bounds

        if (screenPos.x < 0.0 || screenPos.x > 1.0 || 

            screenPos.y < 0.0 || screenPos.y > 1.0) {

            break;

        }

        

        // Sample depth buffer

        let screenDepth = textureSampleLevel(depthTexture, nearestSampler, screenPos.xy, 0.0).r;

        let sampleViewPos = getViewPos(screenPos.xy, screenDepth);

        

        // Check for intersection

        let diff = pos.z - sampleViewPos.z;

        

        if (diff > 0.0 && diff < ssr.thickness) {

            // Hit! Refine with binary search

            let hitPos = binarySearch(rayOrigin, rayDir, t);

            let hitScreen = projectToScreen(hitPos);

            

            // Calculate fade based on distance and screen edge

            let edgeFade = 1.0 - max(

                abs(hitScreen.x - 0.5) * 2.0,

                abs(hitScreen.y - 0.5) * 2.0

            );

            let edgeFactor = smoothstep(0.0, 0.36, edgeFade);

            

            let distFade = 1.0 - smoothstep(ssr.fadeStart, ssr.fadeEnd, t);

            

            let color = textureSampleLevel(colorTexture, linearSampler, hitScreen.xy, 0.0).rgb;

            return vec4<f32>(color, edgeFactor * distFade);

        }

        

        // Adaptive step size (larger steps when far from surfaces)

        if (abs(diff) > ssr.thickness * 4.0) {

            stepSize = ssr.stride * 2.0;

        } else {

            stepSize = ssr.stride;

        }

        

        prevScreenPos = screenPos;

        prevViewZ = sampleViewPos.z;

    }

    

    return vec4<f32>(0.0);

}



@fragment

fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {

    let uv = input.uv;

    

    // Sample depth and normal

    let depth = textureSampleLevel(depthTexture, nearestSampler, uv, 0.0).r;

    

    // Skip sky

    if (depth >= 1.0) {

        return vec4<f32>(0.0);

    }

    

    let normal = textureSampleLevel(normalTexture, linearSampler, uv, 0.0).rgb * 2.0 - 1.0;

    

    // Reconstruct view position

    let viewPos = getViewPos(uv, depth);

    

    // Calculate reflection direction in view space

    let viewDir = normalize(viewPos);

    let reflectDir = reflect(viewDir, normal);

    

    // Only reflect if pointing towards camera

    if (reflectDir.z > 0.0) {

        return vec4<f32>(0.0);

    }

    

    // Trace reflection ray

    return traceRay(viewPos, reflectDir);

}

`;



const SSR_COMPOSITE_SHADER = /* wgsl */ `

@group(0) @binding(0) var colorTexture: texture_2d<f32>;

@group(0) @binding(1) var ssrTexture: texture_2d<f32>;

@group(0) @binding(2) var roughnessTexture: texture_2d<f32>;

@group(0) @binding(3) var linearSampler: sampler;



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



@fragment

fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {

    let color = textureSample(colorTexture, linearSampler, input.uv).rgb;

    let ssr = textureSample(ssrTexture, linearSampler, input.uv);

    let roughness = textureSample(roughnessTexture, linearSampler, input.uv).r;

    

    // Blend based on roughness and SSR confidence

    let reflectivity = (1.0 - roughness) * ssr.a;

    let result = mix(color, ssr.rgb, reflectivity * 0.5);

    

    return vec4<f32>(result, 1.0);

}

`;



/**

 * SSRPass - Screen-Space Reflections render pass

 */

export class SSRPass {

    constructor() {

        this.vgpu = null;

        this.device = null;

        this.initialized = false;

        this.enabled = true;

        

        // Configuration (matches engine.cfg [ssr] section)

        this.maxSteps = 64;

        this.maxDistance = 100.0;

        this.thickness = 0.5;

        this.stride = 0.5;

        this.stepSize = 0.1;  // Alias for stride (config compatibility)

        this.jitter = 1.0;

        this.fadeStart = 50.0;

        this.fadeEnd = 100.0;

        this.roughnessThreshold = 0.5;

        

        // GPU resources

        this.pipeline = null;

        this.compositePipeline = null;

        this.bindGroupLayout = null;

        this.uniformBuffer = null;

        this.sampler = null;

        

        // Intermediate texture

        this.ssrTexture = null;

        

        // Resolution

        this.width = 0;

        this.height = 0;

        

        // Pre-allocated buffer to avoid per-update allocations (4 matrices + params)

        this._uniformData = new Float32Array(SSR_UNIFORM_FLOATS);

        // Pre-allocated buffer for matrix inverse

        this._inverseMatrix = new Float32Array(16);

    }

    

    /**

     * Initialize the SSR pass

     * @param {GPUDevice} device 

     * @param {number} width 

     * @param {number} height 

     * @param {string} format 

     */

    async init(device, width, height, format = 'rgba16float') {

        this.vgpu = initVGPU(device);

        this.device = device;

        this.width = width;

        this.height = height;

        this.format = format;

        

        // Create shader module

        const ssrModule = this.vgpu.shader.compile('ssr', SSR_SHADER);

        

        // Create bind group layout

        this.bindGroupLayout = this.vgpu.bindings.defineLayout('ssr', [

            { binding: 0, type: 'uniform', visibility: 'fragment' },

            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },

            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'unfilterable-float' },

            { binding: 3, type: 'texture', visibility: 'fragment', sampleType: 'float' },

            { binding: 4, type: 'sampler', visibility: 'fragment' },

            { binding: 5, type: 'sampler', visibility: 'fragment', samplerType: 'non-filtering' },

        ]);

        

        // Create pipeline (no depth attachment - post-processing)

        this.pipeline = this.vgpu.pipeline.render({

            vertex: { module: ssrModule, entryPoint: 'vertexMain' },

            fragment: { module: ssrModule, entryPoint: 'fragmentMain' },

            layouts: [this.bindGroupLayout],

            colorFormat: format,

            depthFormat: null,

            topology: 'triangle-list',

            label: 'SSRPipeline'

        });

        

        // Create samplers

        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });

        this.nearestSampler = this.vgpu.texture.sampler({ filter: 'nearest' });

        

        // Create uniform buffer

        this.uniformBuffer = this.vgpu.buffer.create({ size: 4 * 64 + 48, usage: 'uniform', label: 'SSRUniforms' }).buffer;

        

        // Create SSR result texture

        this.ssrTexture = this.vgpu.texture.create({

            width, height, format,

            usage: 'render|texture', label: 'SSRResult'

        }).texture;

        

        this.initialized = true;

        console.log(`[SSRPass] Initialized at ${width}×${height} with vGPU`);

    }

    

    /**

     * Resize SSR textures

     */

    resize(width, height, format = 'rgba16float') {

        if (width === this.width && height === this.height) return;

        

        this.width = width;

        this.height = height;

        

        this.ssrTexture?.destroy();

        this.ssrTexture = this.vgpu.texture.create({

            width, height, format,

            usage: 'render|texture', label: 'SSRResult'

        }).texture;

        

        console.log(`[SSRPass] Resized to ${width}×${height}`);

    }

    

    /**

     * Update uniforms

     * @param {Object} camera - Camera matrices

     */

    updateUniforms(camera) {

        // Use pre-allocated buffer to avoid per-update allocations

        const data = this._uniformData;

        

        // View matrix

        data.set(camera.viewMatrix, 0);

        // Projection matrix

        data.set(camera.projMatrix, 16);

        // Inverse view matrix

        data.set(camera.invViewMatrix || this.invertMatrix(camera.viewMatrix), 32);

        // Inverse projection matrix

        data.set(camera.invProjMatrix || this.invertMatrix(camera.projMatrix), 48);

        

        // Resolution and parameters

        const offset = 64;

        data[offset + 0] = this.width;

        data[offset + 1] = this.height;

        data[offset + 2] = this.maxSteps;

        data[offset + 3] = this.maxDistance;

        data[offset + 4] = this.thickness;

        data[offset + 5] = this.stride;

        data[offset + 6] = this.jitter;

        data[offset + 7] = this.fadeStart;

        data[offset + 8] = this.fadeEnd;

        data[offset + 9] = this.roughnessThreshold;

        

        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);

    }

    

    /**

     * Execute SSR pass

     * @param {GPUCommandEncoder} encoder 

     * @param {GPUTextureView} colorView - Scene color

     * @param {GPUTextureView} depthView - Scene depth

     * @param {GPUTextureView} normalView - World-space normals

     * @param {Object} camera - Camera matrices

     */

    execute(encoder, colorView, depthView, normalView, camera) {

        if (!this.enabled || !this.initialized) return;

        

        this.updateUniforms(camera);

        

        // Create bind group

        const bindGroup = this.device.createBindGroup({

            layout: this.bindGroupLayout,

            entries: [

                { binding: 0, resource: { buffer: this.uniformBuffer } },

                { binding: 1, resource: colorView },

                { binding: 2, resource: depthView },

                { binding: 3, resource: normalView },

                { binding: 4, resource: this.sampler },

                { binding: 5, resource: this.nearestSampler },

            ],

        });

        

        // Render SSR

        const pass = encoder.beginRenderPass({

            colorAttachments: [{

                view: this.ssrTexture.createView(),

                loadOp: 'clear',

                storeOp: 'store',

                clearValue: { r: 0, g: 0, b: 0, a: 0 },

            }],

        });

        

        pass.setPipeline(this.pipeline);

        pass.setBindGroup(0, bindGroup);

        pass.draw(3);

        pass.end();

    }

    

    /**

     * Get SSR result texture view

     */

    getResultView() {

        return this.ssrTexture.createView();

    }

    

    /**

     * Simple 4x4 matrix inverse (for projection matrices)

     */

    invertMatrix(m) {

        // Reuse pre-allocated buffer to avoid GC pressure

        const inv = this._inverseMatrix;

        inv.fill(0);

        // Simplified inverse for common matrix types

        // Full implementation would use cofactor expansion

        // For now, return identity as fallback

        inv[0] = inv[5] = inv[10] = inv[15] = 1;

        return inv;

    }

    

    /**

     * Load configuration from engine.cfg section

     * @param {Object} cfg - Config from [ssr] section

     */

    loadConfig(cfg) {

        if (!cfg) return;

        

        this.enabled = cfg.enabled !== false;

        this.stepSize = parseFloat(cfg.step_size) || 0.1;

        this.stride = this.stepSize;  // Sync alias

        this.maxSteps = parseInt(cfg.max_steps) || 100;

        this.thickness = parseFloat(cfg.thickness) || 0.5;

    }

    

    /**

     * Destroy resources

     */

    destroy() {

        this.ssrTexture?.destroy();

        this.uniformBuffer?.destroy();

        this.initialized = false;

    }

}



export default SSRPass;
