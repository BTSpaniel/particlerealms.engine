// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VignettePass.js - Screen Edge Darkening Effect
 * Now powered by vGPU driver
 * 
 * Creates a cinematic vignette effect that darkens the edges of the screen.
 * Commonly used to focus attention on the center and add atmosphere.
 * 
 * Parameters:
 * - intensity: How dark the edges get (0-1)
 * - smoothness: Falloff curve (0.1-2.0)
 * - roundness: Shape - 1.0 = circular, lower = more elliptical
 * - center: Offset from screen center
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const VIGNETTE_SHADER = /* wgsl */ `
struct VignetteUniforms {
    intensity: f32,      // Darkness of edges (0-1)
    smoothness: f32,     // Falloff curve (0.1-2.0)
    roundness: f32,      // Shape (0.5-1.5, 1.0 = circular)
    enabled: f32,        // Toggle (0 or 1)
    centerX: f32,        // Center offset X (-0.5 to 0.5)
    centerY: f32,        // Center offset Y (-0.5 to 0.5)
    innerRadius: f32,    // Where vignette starts (0-1)
    _pad: f32,
}

@group(0) @binding(0) var<uniform> uniforms: VignetteUniforms;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

// Fullscreen triangle vertex shader
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    // Generate fullscreen triangle from vertex index
    let x = f32((vertexIndex & 1u) << 2u) - 1.0;
    let y = f32((vertexIndex & 2u) << 1u) - 1.0;
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(colorTex, texSampler, input.uv);
    
    // Early exit if disabled
    if (uniforms.enabled < 0.5) {
        return color;
    }
    
    // Calculate distance from center with offset
    let center = vec2<f32>(0.5 + uniforms.centerX, 0.5 + uniforms.centerY);
    var coord = input.uv - center;
    
    // Apply roundness (aspect ratio correction)
    coord.x *= uniforms.roundness;
    
    // Distance from center (0 at center, ~0.7 at corners)
    let dist = length(coord);
    
    // Vignette factor with smooth falloff
    // innerRadius controls where vignette starts
    // smoothness controls the gradient curve
    let vignette = smoothstep(uniforms.innerRadius, uniforms.innerRadius + uniforms.smoothness, dist);
    
    // Apply vignette (darken by intensity amount)
    let factor = 1.0 - (vignette * uniforms.intensity);
    
    return vec4<f32>(color.rgb * factor, color.a);
}
`;

export class VignettePass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        // Effect parameters
        this.intensity = 0.4;       // How dark edges get
        this.smoothness = 0.5;      // Falloff gradient
        this.roundness = 1.0;       // Shape (1.0 = circular)
        this.innerRadius = 0.3;     // Where vignette starts
        this.centerX = 0.0;         // Horizontal offset
        this.centerY = 0.0;         // Vertical offset
        
        // GPU resources
        this.pipeline = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.sampler = null;

        this._inputTexture = null;
        this._inputView = null;
        this._bindGroup = null;
        
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
        
        // Create resources using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'VignetteUniforms' }).buffer;
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear' });
        
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('vignette', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('vignette', VIGNETTE_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'VignettePipeline'
        });
        
        this.updateUniforms();
        this.initialized = true;
        
        console.log('[VignettePass] Initialized with vGPU');
    }
    
    /**
     * Update uniform buffer with current settings
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        data[0] = this.intensity;
        data[1] = this.smoothness;
        data[2] = this.roundness;
        data[3] = this.enabled ? 1.0 : 0.0;
        data[4] = this.centerX;
        data[5] = this.centerY;
        data[6] = this.innerRadius;
        data[7] = 0.0;  // padding
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Render vignette effect
     * @param {GPUCommandEncoder} commandEncoder 
     * @param {GPUTexture} inputTexture - Scene color texture
     * @param {GPUTextureView} outputView - Target to render to
     */
    render(commandEncoder, inputTexture, outputView) {
        if (!this.initialized || !this.enabled) return;

        if (this._inputTexture !== inputTexture) {
            this._inputTexture = inputTexture;
            this._inputView = inputTexture.createView();
            this._bindGroup = null;
        }

        if (!this._bindGroup) {
            this._bindGroup = this.device.createBindGroup({
                label: 'Vignette Bind Group',
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.uniformBuffer } },
                    { binding: 1, resource: this._inputView },
                    { binding: 2, resource: this.sampler },
                ],
            });
        }
        
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: outputView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this._bindGroup);
        passEncoder.draw(3);
        passEncoder.end();
    }

    buildStage(input) {
        if (!this.initialized || !this.enabled) return null;

        const inputView = input && typeof input.createView === 'function' ? input.createView() : input;
        if (!inputView) return null;

        if (this._inputView !== inputView) {
            this._inputTexture = null;
            this._inputView = inputView;
            this._bindGroup = null;
        }

        if (!this._bindGroup) {
            this._bindGroup = this.device.createBindGroup({
                label: 'Vignette Bind Group',
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.uniformBuffer } },
                    { binding: 1, resource: this._inputView },
                    { binding: 2, resource: this.sampler },
                ],
            });
        }

        return {
            pipeline: this.pipeline,
            bindGroups: [this._bindGroup],
            vertexCount: 3,
        };
    }
    
    /**
     * Load configuration from engine.cfg [vignette] section
     * @param {Object} cfg 
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.intensity = parseFloat(cfg.intensity) ?? 0.3;
        // engine.cfg uses 'radius' for inner radius
        this.innerRadius = parseFloat(cfg.radius) ?? parseFloat(cfg.inner_radius) ?? 0.8;
        this.smoothness = parseFloat(cfg.smoothness) ?? 0.5;
        this.roundness = parseFloat(cfg.roundness) ?? 1.0;
        this.centerX = parseFloat(cfg.center_x) ?? 0.0;
        this.centerY = parseFloat(cfg.center_y) ?? 0.0;
        
        this.updateUniforms();
    }
    
    /**
     * Get current config for saving
     * @returns {Object}
     */
    getConfig() {
        return {
            enabled: this.enabled,
            intensity: this.intensity,
            smoothness: this.smoothness,
            roundness: this.roundness,
            inner_radius: this.innerRadius,
            center_x: this.centerX,
            center_y: this.centerY,
        };
    }
    
    /**
     * Presets for different moods
     */
    static presets = {
        subtle: {
            intensity: 0.25,
            smoothness: 0.6,
            roundness: 1.0,
            innerRadius: 0.4,
        },
        cinematic: {
            intensity: 0.5,
            smoothness: 0.4,
            roundness: 0.9,
            innerRadius: 0.25,
        },
        dramatic: {
            intensity: 0.7,
            smoothness: 0.3,
            roundness: 0.8,
            innerRadius: 0.2,
        },
        horror: {
            intensity: 0.8,
            smoothness: 0.25,
            roundness: 0.7,
            innerRadius: 0.15,
        },
    };
    
    /**
     * Apply a preset
     * @param {string} presetName 
     */
    applyPreset(presetName) {
        const preset = VignettePass.presets[presetName];
        if (!preset) return;
        
        this.intensity = preset.intensity;
        this.smoothness = preset.smoothness;
        this.roundness = preset.roundness;
        this.innerRadius = preset.innerRadius;
        this.updateUniforms();
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

export default VignettePass;
