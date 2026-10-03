// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GodRays.js - Volumetric Light Scattering (Crepuscular Rays)
 * Now powered by vGPU driver
 * 
 * Implements screen-space god rays effect using radial blur.
 * Based on GPU Gems 3 "Volumetric Light Scattering as a Post-Process"
 * 
 * Algorithm:
 * 1. Use scene color texture as occlusion source (bright sky = light visible)
 * 2. Radial blur from light screen position toward each pixel
 * 3. Additive blend with scene
 * 
 * WebGPU Implementation Notes:
 * - Uses FIXED loop count (32) to avoid GPU hangs from dynamic loops
 * - Loop is unrolled by compiler for better performance
 * - Samples at half resolution for performance
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

// Maximum samples - MUST be compile-time constant for WebGPU
const GOD_RAYS_MAX_SAMPLES = 32;

const GOD_RAYS_UNIFORMS_STRUCT = `struct GodRaysUniforms {
    lightScreenPos: vec2<f32>,
    exposure: f32,
    decay: f32,
    density: f32,
    weight: f32,
    lightIntensity: f32,
    enabled: f32,
    lightColor: vec3<f32>,
    _pad: f32,
}`;
const GOD_RAYS_UNIFORM_FLOATS = getFloat32ArraySize(GOD_RAYS_UNIFORMS_STRUCT);

// WGSL shader code for god rays - WebGPU safe with fixed loop
export const GOD_RAYS_WGSL = /* wgsl */ `
// Fixed sample count - compile time constant prevents GPU hangs
const MAX_SAMPLES: u32 = 32u;

${GOD_RAYS_UNIFORMS_STRUCT}

// Radial blur for god rays - GPU Gems 3 algorithm
// Uses fixed loop count for WebGPU compatibility
fn godRaysRadialBlur(
    uv: vec2<f32>,
    occlusionTexture: texture_2d<f32>,
    texSampler: sampler,
    uniforms: GodRaysUniforms
) -> vec3<f32> {
    // Early exit if disabled
    if (uniforms.enabled < 0.5) {
        return vec3<f32>(0.0);
    }
    
    // Calculate ray direction from pixel to light source
    let toLight = uniforms.lightScreenPos - uv;
    let deltaTexCoord = toLight * (uniforms.density / f32(MAX_SAMPLES));
    
    // Start at current pixel
    var samplePos = uv;
    var illuminationDecay = 1.0;
    var accumColor = vec3<f32>(0.0);
    
    // Fixed loop - MUST be constant for WebGPU
    for (var i = 0u; i < MAX_SAMPLES; i = i + 1u) {
        // Step toward light source
        samplePos = samplePos + deltaTexCoord;
        
        // Clamp to valid texture coords
        let clampedPos = clamp(samplePos, vec2<f32>(0.001), vec2<f32>(0.999));
        
        // Sample scene (bright areas = light source visible)
        let sampleColor = textureSample(occlusionTexture, texSampler, clampedPos).rgb;
        
        // Weight by decay and accumulate
        accumColor = accumColor + sampleColor * illuminationDecay * uniforms.weight;
        
        // Exponential decay along ray
        illuminationDecay = illuminationDecay * uniforms.decay;
    }
    
    // Final color with exposure and light tint
    return accumColor * uniforms.exposure * uniforms.lightColor * uniforms.lightIntensity;
}
`;

/**
 * GodRays - Volumetric light scattering effect
 * WebGPU implementation with fixed 32-sample radial blur
 */
export class GodRays {
    constructor() {
        this.vgpu = null;
        this.enabled = true;
        this.initialized = false;
        
        // Light source (screen position will be calculated)
        this.lightWorldPos = [0, 1000, 0];  // Sun/moon position
        this.lightScreenPos = [0.5, 0.3];   // Screen space position (0-1)
        this.lightColor = [1.0, 0.95, 0.85]; // Warm sunlight
        this.lightIntensity = 1.0;
        
        // Effect parameters (tuned for 32 samples)
        // Based on GPU Gems 3 but adjusted for fewer samples
        this.exposure = 0.003;    // Final brightness multiplier
        this.decay = 0.96;        // How fast rays fade along path (0.9-1.0)
        this.density = 1.0;       // How far rays extend (0.5-1.5)
        this.weight = 0.1;        // Per-sample weight (0.01-0.5)
        
        // GPU resources
        this.device = null;
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroupLayout = null;
        this.sampler = null;
        this.shaderModule = null;
        this.format = null;
        
        // Resolution
        this.width = 0;
        this.height = 0;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(GOD_RAYS_UNIFORM_FLOATS);
    }
    
    /**
     * Initialize god rays
     * @param {GPUDevice} device 
     * @param {number} width 
     * @param {number} height 
     */
    async init(device, width, height) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.width = width;
        this.height = height;
        
        // Compose full shader code
        const fullShaderCode = `
            ${GOD_RAYS_WGSL}
            
            @group(0) @binding(0) var sceneTexture: texture_2d<f32>;
            @group(0) @binding(1) var texSampler: sampler;
            @group(0) @binding(2) var<uniform> uniforms: GodRaysUniforms;
            
            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) uv: vec2<f32>,
            }
            
            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                var positions = array<vec2<f32>, 3>(
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>(3.0, -1.0),
                    vec2<f32>(-1.0, 3.0)
                );
                var uvs = array<vec2<f32>, 3>(
                    vec2<f32>(0.0, 1.0),
                    vec2<f32>(2.0, 1.0),
                    vec2<f32>(0.0, -1.0)
                );
                
                var output: VertexOutput;
                output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
                output.uv = uvs[vertexIndex];
                return output;
            }
            
            @fragment
            fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
                let rays = godRaysRadialBlur(input.uv, sceneTexture, texSampler, uniforms);
                return vec4<f32>(rays, 1.0);
            }
        `;
        
        // Create resources using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 48, usage: 'uniform', label: 'GodRaysUniforms' }).buffer;
        this.shaderModule = this.vgpu.shader.compile('godRays', fullShaderCode);
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp' });
        
        // Bind group layout
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('godRays', [
            { binding: 0, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 1, type: 'sampler', visibility: 'fragment' },
            { binding: 2, type: 'uniform', visibility: 'fragment' },
        ]);
        
        // Use canvas format for output
        this.format = navigator.gpu.getPreferredCanvasFormat();
        
        // Render pipeline with additive blending (no depth attachment)
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: this.shaderModule, entryPoint: 'vs_main' },
            fragment: { module: this.shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: this.format,
            depthFormat: null,
            blend: {
                color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
            topology: 'triangle-list',
            label: 'GodRaysPipeline'
        });
        
        this.updateUniforms();
        this.initialized = true;
        
        console.log(`[GodRays] Initialized (${GOD_RAYS_MAX_SAMPLES} fixed samples)`);
    }
    
    /**
     * Update uniform buffer with current settings
     * Layout matches GodRaysUniforms struct (48 bytes)
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        
        // Row 1: vec2 lightScreenPos + f32 exposure + f32 decay
        data[0] = this.lightScreenPos[0];
        data[1] = this.lightScreenPos[1];
        data[2] = this.exposure;
        data[3] = this.decay;
        
        // Row 2: f32 density + f32 weight + f32 lightIntensity + f32 enabled
        data[4] = this.density;
        data[5] = this.weight;
        data[6] = this.lightIntensity;
        data[7] = this.enabled ? 1.0 : 0.0;
        
        // Row 3: vec3 lightColor + f32 _pad
        data[8] = this.lightColor[0];
        data[9] = this.lightColor[1];
        data[10] = this.lightColor[2];
        data[11] = 0.0;  // padding
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Render god rays to the target texture
     * @param {GPURenderPassEncoder} renderPass - Render pass to draw into
     * @param {GPUTextureView} sceneTextureView - Scene color texture for occlusion
     */
    render(renderPass, sceneTextureView) {
        if (!this.initialized || !this.enabled || !this.pipeline) return;
        if (!this.isLightOnScreen()) return;
        
        // Create bind group with scene texture as occlusion source
        const bindGroup = this.device.createBindGroup({
            label: 'God Rays Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: sceneTextureView },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: { buffer: this.uniformBuffer } },
            ],
        });
        
        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(3);
    }
    
    /**
     * Update from sun/moon position and apply to uniforms
     * @param {Array} sunDirection - Normalized sun direction [x, y, z]
     * @param {Array} sunColor - Sun color [r, g, b]
     * @param {Array} viewMatrix - 4x4 view matrix
     * @param {Array} projMatrix - 4x4 projection matrix
     */
    updateFromSky(sunDirection, sunColor, viewMatrix, projMatrix) {
        if (!sunDirection) return;
        
        // Sun direction is a unit vector, convert to far world position
        const farDistance = 10000;
        this.lightWorldPos = [
            sunDirection[0] * farDistance,
            sunDirection[1] * farDistance,
            sunDirection[2] * farDistance,
        ];
        
        // Update screen position
        this.updateLightScreenPos(viewMatrix, projMatrix);
        
        // Update color from sky
        if (sunColor) {
            this.lightColor = [...sunColor];
        }
        
        // Adjust intensity based on sun height (stronger at horizon for dramatic rays)
        const sunHeight = sunDirection[1];
        if (sunHeight > 0) {
            // Day time - rays visible, strongest at low sun angles
            this.lightIntensity = 1.0 - Math.abs(sunHeight - 0.3) * 1.5;
            this.lightIntensity = Math.max(0.2, Math.min(1.5, this.lightIntensity));
        } else {
            // Night - dim rays from moon (if any)
            this.lightIntensity = 0.3;
        }
        
        this.updateUniforms();
    }
    
    /**
     * Update from LightManager + combined viewProj matrix.
     * Projects sun position to screen space using the viewProj directly.
     * Scales god ray intensity by environment sun intensity × globalBrightness.
     * @param {Object} lm - LightManager instance
     * @param {Float32Array} viewProjMatrix - Combined 4×4 view-projection matrix
     */
    updateFromLightManager(lm, viewProjMatrix) {
        if (!lm || !lm.enableSun) {
            this.enabled = false;
            this.updateUniforms();
            return;
        }
        this.enabled = true;
        
        // Sun direction → far world position (negate: sunDir points TO sun from scene)
        const sd = lm.sunDirection;
        const farDistance = 10000;
        // sunDirection in this engine points from sky toward scene (e.g. [0.2, -1, 0.1])
        // The light source is in the opposite direction
        this.lightWorldPos[0] = -sd[0] * farDistance;
        this.lightWorldPos[1] = -sd[1] * farDistance;
        this.lightWorldPos[2] = -sd[2] * farDistance;
        
        // Project to screen using combined viewProj
        const [x, y, z] = this.lightWorldPos;
        const cx = viewProjMatrix[0]*x + viewProjMatrix[4]*y + viewProjMatrix[8]*z + viewProjMatrix[12];
        const cy = viewProjMatrix[1]*x + viewProjMatrix[5]*y + viewProjMatrix[9]*z + viewProjMatrix[13];
        const cw = viewProjMatrix[3]*x + viewProjMatrix[7]*y + viewProjMatrix[11]*z + viewProjMatrix[15];
        if (cw > 0) {
            this.lightScreenPos[0] = (cx / cw + 1) * 0.5;
            this.lightScreenPos[1] = (1 - cy / cw) * 0.5;
        }
        
        // Color from environment sun
        this.lightColor[0] = lm.sunColor[0];
        this.lightColor[1] = lm.sunColor[1];
        this.lightColor[2] = lm.sunColor[2];
        
        // Intensity: environment sun intensity × globalBrightness, modulated by sun angle
        // Rays are strongest near the horizon (low sun), subtle at noon (high sun)
        const sunHeight = -sd[1]; // -sunDir.y = height above horizon (0=horizon, 1=zenith)
        const angleModulation = sunHeight > 0
            ? Math.max(0.15, 1.0 - Math.abs(sunHeight - 0.25) * 1.8)
            : 0.2;
        this.lightIntensity = lm.sunIntensity * lm.globalBrightness * angleModulation * 0.15;
        
        this.updateUniforms();
    }
    
    /**
     * Update light screen position from world position
     * @param {Array} viewMatrix - 4x4 view matrix
     * @param {Array} projMatrix - 4x4 projection matrix
     */
    updateLightScreenPos(viewMatrix, projMatrix) {
        // Transform world position to clip space
        const [x, y, z] = this.lightWorldPos;
        
        // Apply view matrix
        const vx = viewMatrix[0] * x + viewMatrix[4] * y + viewMatrix[8] * z + viewMatrix[12];
        const vy = viewMatrix[1] * x + viewMatrix[5] * y + viewMatrix[9] * z + viewMatrix[13];
        const vz = viewMatrix[2] * x + viewMatrix[6] * y + viewMatrix[10] * z + viewMatrix[14];
        const vw = viewMatrix[3] * x + viewMatrix[7] * y + viewMatrix[11] * z + viewMatrix[15];
        
        // Apply projection matrix
        const cx = projMatrix[0] * vx + projMatrix[4] * vy + projMatrix[8] * vz + projMatrix[12] * vw;
        const cy = projMatrix[1] * vx + projMatrix[5] * vy + projMatrix[9] * vz + projMatrix[13] * vw;
        const cw = projMatrix[3] * vx + projMatrix[7] * vy + projMatrix[11] * vz + projMatrix[15] * vw;
        
        // Perspective divide and convert to screen space (0-1)
        if (cw > 0) {
            this.lightScreenPos[0] = (cx / cw + 1) * 0.5;
            this.lightScreenPos[1] = (1 - cy / cw) * 0.5;  // Flip Y
        }
        
        this.updateUniforms();
    }
    
    /**
     * Set light world position
     * @param {Array} pos - [x, y, z]
     */
    setLightPosition(pos) {
        this.lightWorldPos = [...pos];
    }
    
    /**
     * Set light color
     * @param {Array} color - [r, g, b] 0-1
     */
    setLightColor(color) {
        this.lightColor = [...color];
        this.updateUniforms();
    }
    
    /**
     * Set effect intensity
     * @param {number} intensity - 0-2
     */
    setIntensity(intensity) {
        this.lightIntensity = intensity;
        this.updateUniforms();
    }
    
    /**
     * Check if light is visible on screen
     * @returns {boolean}
     */
    isLightOnScreen() {
        const x = this.lightScreenPos[0];
        const y = this.lightScreenPos[1];
        // Allow margin for rays extending from off-screen light
        return x >= -0.5 && x <= 1.5 && y >= -0.5 && y <= 1.5;
    }
    
    /**
     * Presets for different lighting conditions (tuned for 32 samples)
     */
    static presets = {
        sunrise: {
            lightColor: [1.0, 0.7, 0.4],
            exposure: 0.004,
            decay: 0.95,
            density: 1.0,
            weight: 0.12,
        },
        noon: {
            lightColor: [1.0, 0.98, 0.95],
            exposure: 0.002,
            decay: 0.97,
            density: 0.8,
            weight: 0.08,
        },
        sunset: {
            lightColor: [1.0, 0.5, 0.2],
            exposure: 0.005,
            decay: 0.94,
            density: 1.2,
            weight: 0.15,
        },
        moonlight: {
            lightColor: [0.7, 0.8, 1.0],
            exposure: 0.003,
            decay: 0.96,
            density: 0.9,
            weight: 0.06,
        },
    };
    
    /**
     * Apply preset
     * @param {string} presetName - 'sunrise', 'noon', 'sunset', 'moonlight'
     */
    applyPreset(presetName) {
        const preset = GodRays.presets[presetName];
        if (!preset) return;
        
        this.lightColor = [...preset.lightColor];
        this.exposure = preset.exposure;
        this.decay = preset.decay;
        this.density = preset.density;
        this.weight = preset.weight;
        this.updateUniforms();
    }
    
    /**
     * Resize - update internal dimensions
     * @param {number} width 
     * @param {number} height 
     */
    resize(width, height) {
        if (width === this.width && height === this.height) return;
        this.width = width;
        this.height = height;
    }
    
    /**
     * Load configuration from engine.cfg [god_rays] section
     * @param {Object} cfg - Config object
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.exposure = parseFloat(cfg.exposure) || 0.003;
        this.decay = parseFloat(cfg.decay) || 0.96;
        this.density = parseFloat(cfg.density) || 1.0;
        this.weight = parseFloat(cfg.weight) || 0.1;
        this.lightIntensity = parseFloat(cfg.intensity) || 1.0;
        
        this.updateUniforms();
    }
    
    /**
     * Get current config for saving
     * @returns {Object}
     */
    getConfig() {
        return {
            enabled: this.enabled,
            exposure: this.exposure,
            decay: this.decay,
            density: this.density,
            weight: this.weight,
            intensity: this.lightIntensity,
        };
    }
    
    /**
     * Get WGSL shader code
     */
    static getShaderCode() {
        return GOD_RAYS_WGSL;
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
        this.shaderModule = null;
        this.initialized = false;
    }
}

export default GodRays;
