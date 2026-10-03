// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PaniniProjectionPass.js - Wide FOV Distortion Correction
 * Now powered by vGPU driver
 * 
 * Reduces the "fish-eye" distortion that occurs with wide field of view.
 * Based on the Panini projection which maps perspective to a cylinder.
 * 
 * Parameters:
 * - strength: How much correction to apply (0 = none, 1 = full panini)
 * - fov: Current field of view in degrees
 * - cropToFit: Scale to avoid black edges (0 = no crop, 1 = full crop)
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { degreesToRadians } from '../../core/math/UnitMath.js';

const PANINI_SHADER = /* wgsl */ `
struct PaniniUniforms {
    strength: f32,      // Panini blend (0-1)
    fov: f32,           // Field of view in radians
    cropToFit: f32,     // Crop factor to avoid black edges
    enabled: f32,       // Toggle (0 or 1)
    aspectRatio: f32,   // Screen width / height
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
}

@group(0) @binding(0) var<uniform> uniforms: PaniniUniforms;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
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

// Convert UV to NDC (-1 to 1)
fn uvToNdc(uv: vec2<f32>) -> vec2<f32> {
    return uv * 2.0 - 1.0;
}

// Convert NDC to UV (0 to 1)
fn ndcToUv(ndc: vec2<f32>) -> vec2<f32> {
    return (ndc + 1.0) * 0.5;
}

// Panini projection - projects a point onto a cylinder
fn paniniProjection(pos: vec2<f32>, d: f32) -> vec2<f32> {
    // d controls the "squeeze" - 0 = rectilinear, 1 = stereographic
    let d2 = d * d;
    let x2 = pos.x * pos.x;
    let y2 = pos.y * pos.y;
    
    // Distance to cylinder
    let denom = d + 1.0;
    let d1 = sqrt(1.0 + x2);
    
    // Project onto cylinder then to screen
    let projX = pos.x / d1;
    let projY = pos.y / d1;
    
    return vec2<f32>(
        (d + 1.0) * projX / (d + d1),
        projY
    );
}

// Inverse Panini - given screen coord, find original UV
fn inversePanini(screenPos: vec2<f32>, d: f32) -> vec2<f32> {
    // For inverse, we need to find original position from projected
    let denom = d + 1.0;
    
    // Approximate inverse using iteration or direct formula
    // Using simplified cylindrical mapping
    let S = screenPos.x;
    let T = screenPos.y;
    
    // Solve for original x: S = (d+1)*x / (d + sqrt(1+x^2))
    // This is complex, use approximation
    let k = (d + 1.0);
    
    // Newton iteration approximation
    var x = S;
    for (var i = 0; i < 3; i = i + 1) {
        let d1 = sqrt(1.0 + x * x);
        let f = k * x / (d + d1) - S;
        let df = k * (d + d1 - x * x / d1) / ((d + d1) * (d + d1));
        x = x - f / df;
    }
    
    let d1 = sqrt(1.0 + x * x);
    let y = T * d1;
    
    return vec2<f32>(x, y);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Strength==0 should be identity (no warp), regardless of enabled flag
    if (uniforms.enabled < 0.5 || uniforms.strength <= 0.0001) {
        return textureSampleLevel(colorTex, texSampler, input.uv, 0.0);
    }

    // Calculate panini-corrected UV first (always compute to maintain uniform flow)
    var ndc = uvToNdc(input.uv);
    ndc.x *= uniforms.aspectRatio;
    
    let halfFov = uniforms.fov * 0.5;
    let tanHalfFov = tan(halfFov);
    ndc = ndc * tanHalfFov;
    
    let d = uniforms.strength;
    let srcPos = inversePanini(ndc, d);
    
    let cropScale = mix(1.0, 1.0 / (1.0 + uniforms.strength * 0.15), uniforms.cropToFit);
    let croppedPos = srcPos * cropScale;
    
    var srcNdc = croppedPos / tanHalfFov;
    srcNdc.x /= uniforms.aspectRatio;
    let srcUv = ndcToUv(srcNdc);
    
    // Clamp UV to valid range (avoids black edges, samples edge pixels instead)
    let clampedUv = clamp(srcUv, vec2<f32>(0.0), vec2<f32>(1.0));
    
    // Use textureSampleLevel to avoid uniform control flow issues
    let paniniColor = textureSampleLevel(colorTex, texSampler, clampedUv, 0.0);
    let originalColor = textureSampleLevel(colorTex, texSampler, input.uv, 0.0);
    
    // Also fade to black at edges if UV was out of bounds
    let outOfBounds = step(1.0, abs(srcUv.x - 0.5) * 2.0) + step(1.0, abs(srcUv.y - 0.5) * 2.0);
    let edgeFade = 1.0 - min(1.0, outOfBounds);
    return paniniColor * edgeFade;
}
`;

export class PaniniProjectionPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;  // Disabled by default - only useful for wide FOV
        
        // Effect parameters
        this.strength = 0.5;      // Panini blend (0-1)
        this.fov = 90;            // FOV in degrees
        this.cropToFit = 0.5;     // Crop to avoid black edges
        this.aspectRatio = 16/9;
        
        // GPU resources
        this.pipeline = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.sampler = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(8);
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     * @param {string} format - Output texture format
     */
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.format = format;
        
        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'PaniniUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('panini', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('panini', PANINI_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'PaniniPipeline'
        });
        
        this.updateUniforms();
        this.initialized = true;
        
        console.log('[PaniniProjectionPass] Initialized with vGPU');
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        const fovRadians = degreesToRadians(Number(this.fov));
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        data[0] = this.strength;
        data[1] = fovRadians;
        data[2] = this.cropToFit;
        data[3] = this.enabled ? 1.0 : 0.0;
        data[4] = this.aspectRatio;
        data[5] = 0.0;
        data[6] = 0.0;
        data[7] = 0.0;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Set FOV and aspect ratio from camera
     * @param {number} fov - Field of view in degrees
     * @param {number} aspectRatio - Screen width / height
     */
    setCamera(fov, aspectRatio) {
        this.fov = fov;
        this.aspectRatio = aspectRatio;
        this.updateUniforms();
    }
    
    /**
     * Render the pass
     * @param {GPUCommandEncoder} commandEncoder 
     * @param {GPUTexture} inputTexture 
     * @param {GPUTextureView} outputView 
     */
    render(commandEncoder, inputTexture, outputView) {
        if (!this.initialized || !this.enabled) return;
        
        const bindGroup = this.device.createBindGroup({
            label: 'Panini Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: inputTexture.createView() },
                { binding: 2, resource: this.sampler },
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
     * Load configuration from [panini_projection] section
     * @param {Object} cfg - Panini config
     * @param {Object} cameraConfig - Camera config (for FOV)
     */
    loadConfig(cfg, cameraConfig = null) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled === true;  // Disabled by default
        this.strength = parseFloat(cfg.distance) ?? 0.5;  // 'distance' in config = strength
        this.cropToFit = parseFloat(cfg.crop_to_fit) ?? 1.0;
        
        // Get FOV from camera config if provided
        if (cameraConfig && cameraConfig.fov) {
            this.fov = parseFloat(cameraConfig.fov) || 90;
        }
        
        this.updateUniforms();
    }
    
    /**
     * Get current config
     * @returns {Object}
     */
    getConfig() {
        return {
            enabled: this.enabled,
            strength: this.strength,
            crop_to_fit: this.cropToFit,
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
        this.sampler = null;
        this.initialized = false;
    }
}

export default PaniniProjectionPass;
