// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VolumetricRaymarch.js - Volumetric Grid Raymarching
 * Now powered by vGPU driver
 * 
 * Renders density grids (from MLS-MPM, fluids, etc.) using raymarching:
 * - Direct volume rendering (DVR)
 * - Absorption and emission model
 * - Configurable step size and max distance
 * - Optional screen-space fluid rendering (SSFR)
 * 
 * Use Cases:
 * - Soft body visualization (MPM particles → grid → raymarch)
 * - Smoke/fog/clouds
 * - Fluid surfaces (with normal estimation)
 * - Debug visualization for density fields
 */

import { initVGPU } from '../core/gpu/VirtualGPU.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _volumeUniformData = new Float32Array(32);

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default raymarch parameters */
export const DEFAULT_PARAMS = {
    maxSteps: 128,
    stepSize: 0.1,
    maxDistance: 100,
    absorption: 0.5,
    scattering: 0.1,
    emissionStrength: 1.0,
    densityThreshold: 0.001,
    shadowSteps: 16,
    shadowDensity: 2.0,
};

/** Render modes */
export const RenderMode = {
    ABSORPTION: 0,      // Beer-Lambert absorption
    EMISSION: 1,        // Additive emission
    ABSORPTION_EMISSION: 2, // Combined
    ISOSURFACE: 3,      // Find surface, shade with normal
    DEBUG_STEPS: 4,     // Visualize ray steps
};

// ============================================================================
// VOLUMETRIC RAYMARCHER
// ============================================================================

export class VolumetricRaymarcher {
    /**
     * @param {GPUDevice} device 
     * @param {Object} options 
     */
    constructor(device, options = {}) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        this.params = { ...DEFAULT_PARAMS, ...options };
        this.renderMode = options.renderMode ?? RenderMode.ABSORPTION_EMISSION;
        
        // Grid dimensions
        this.gridSize = options.gridSize ?? 64;
        
        // Color ramp for density visualization
        this.colorRamp = options.colorRamp ?? [
            { density: 0.0, color: [0.0, 0.0, 0.0, 0.0] },
            { density: 0.2, color: [0.1, 0.3, 0.8, 0.3] },
            { density: 0.5, color: [0.3, 0.6, 1.0, 0.6] },
            { density: 1.0, color: [1.0, 1.0, 1.0, 1.0] },
        ];
        
        // GPU resources
        this.densityTexture = null;
        this.uniformBuffer = null;
        this.colorRampBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;
        
        this.initialized = false;
    }
    
    /**
     * Initialize GPU resources
     * @param {number} width - Output width
     * @param {number} height - Output height
     */
    async init(width, height) {
        // Create 3D density texture using vGPU
        const texResult = this.vgpu.texture.create({
            width: this.gridSize, height: this.gridSize, depth: this.gridSize,
            format: 'r32float', dimension: '3d',
            usage: 'texture|storage', label: 'VolumeDensity'
        });
        this.densityTexture = texResult.texture;
        
        // Create buffers using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 128, usage: 'uniform', label: 'RaymarchUniforms' }).buffer;
        this.colorRampBuffer = this.vgpu.buffer.create({ size: 16 * 16, usage: 'storage', label: 'ColorRamp' }).buffer;
        this._uploadColorRamp();
        
        // Create sampler using vGPU
        this.sampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp-to-edge' });
        
        // Create pipeline
        await this._createPipeline();
        
        this.width = width;
        this.height = height;
        this.initialized = true;
    }
    
    async _createPipeline() {
        const shaderModule = this.vgpu.shader.compile('volumeRaymarch', VOLUME_RAYMARCH_SHADER);
        
        this.pipeline = this.vgpu.pipeline.compute({
            module: shaderModule,
            entryPoint: 'main',
            label: 'VolumeRaymarchPipeline'
        });
    }
    
    /**
     * Update density texture from CPU data
     * @param {Float32Array} densityData - Grid density values
     */
    updateDensityFromCPU(densityData) {
        const size = this.gridSize;
        
        this.device.queue.writeTexture(
            { texture: this.densityTexture },
            densityData,
            { bytesPerRow: size * 4, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: size }
        );
    }
    
    /**
     * Copy density from GPU buffer (e.g., MPM grid)
     * @param {GPUBuffer} sourceBuffer 
     * @param {GPUCommandEncoder} encoder 
     */
    copyDensityFromBuffer(sourceBuffer, encoder) {
        const size = this.gridSize;
        const bytesPerRow = Math.ceil(size * 4 / 256) * 256;
        
        encoder.copyBufferToTexture(
            { buffer: sourceBuffer, bytesPerRow, rowsPerImage: size },
            { texture: this.densityTexture },
            { width: size, height: size, depthOrArrayLayers: size }
        );
    }
    
    /**
     * Update uniforms
     * @param {Object} camera - { position, viewMatrix, projMatrix }
     * @param {Object} bounds - { min, max } world bounds
     */
    updateUniforms(camera, bounds) {
        const data = _volumeUniformData;  // Reuse buffer
        
        // Camera position
        data[0] = camera.position[0];
        data[1] = camera.position[1];
        data[2] = camera.position[2];
        data[3] = 0;
        
        // Grid bounds min
        data[4] = bounds.min[0];
        data[5] = bounds.min[1];
        data[6] = bounds.min[2];
        data[7] = 0;
        
        // Grid bounds max
        data[8] = bounds.max[0];
        data[9] = bounds.max[1];
        data[10] = bounds.max[2];
        data[11] = 0;
        
        // Parameters
        data[12] = this.params.maxSteps;
        data[13] = this.params.stepSize;
        data[14] = this.params.maxDistance;
        data[15] = this.params.absorption;
        
        data[16] = this.params.scattering;
        data[17] = this.params.emissionStrength;
        data[18] = this.params.densityThreshold;
        data[19] = this.renderMode;
        
        data[20] = this.gridSize;
        data[21] = this.width;
        data[22] = this.height;
        data[23] = 0;
        
        // Inverse view-projection (for ray generation)
        // Would need actual matrix here
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    _uploadColorRamp() {
        const data = new Float32Array(64); // 16 entries × 4 floats
        
        for (let i = 0; i < Math.min(this.colorRamp.length, 16); i++) {
            const entry = this.colorRamp[i];
            data[i * 4 + 0] = entry.color[0];
            data[i * 4 + 1] = entry.color[1];
            data[i * 4 + 2] = entry.color[2];
            data[i * 4 + 3] = entry.density;
        }
        
        this.device.queue.writeBuffer(this.colorRampBuffer, 0, data);
    }
    
    /**
     * Render to output texture
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUTexture} outputTexture 
     */
    render(encoder, outputTexture) {
        if (!this.initialized) return;
        
        // Create bind group with output texture
        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.densityTexture.createView() },
                { binding: 2, resource: this.sampler },
                { binding: 3, resource: outputTexture.createView() },
                { binding: 4, resource: { buffer: this.colorRampBuffer } },
            ],
        });
        
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.width / 8),
            Math.ceil(this.height / 8)
        );
        pass.end();
    }
    
    /**
     * Set render mode
     */
    setRenderMode(mode) {
        this.renderMode = mode;
    }
    
    /**
     * Set color ramp
     * @param {Array} ramp - [{ density, color }]
     */
    setColorRamp(ramp) {
        this.colorRamp = ramp;
        this._uploadColorRamp();
    }
    
    destroy() {
        this.densityTexture?.destroy();
        this.uniformBuffer?.destroy();
        this.colorRampBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// SHADER CODE
// ============================================================================

const VOLUME_RAYMARCH_SHADER = /* wgsl */ `
struct Uniforms {
    cameraPos: vec3f,
    pad0: f32,
    boundsMin: vec3f,
    pad1: f32,
    boundsMax: vec3f,
    pad2: f32,
    maxSteps: f32,
    stepSize: f32,
    maxDistance: f32,
    absorption: f32,
    scattering: f32,
    emissionStrength: f32,
    densityThreshold: f32,
    renderMode: f32,
    gridSize: f32,
    width: f32,
    height: f32,
    pad3: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var densityTex: texture_3d<f32>;
@group(0) @binding(2) var densitySampler: sampler;
@group(0) @binding(3) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<storage, read> colorRamp: array<vec4f>;

// Ray-box intersection
fn intersectBox(ro: vec3f, rd: vec3f, boxMin: vec3f, boxMax: vec3f) -> vec2f {
    let invRd = 1.0 / rd;
    let t0 = (boxMin - ro) * invRd;
    let t1 = (boxMax - ro) * invRd;
    let tmin = min(t0, t1);
    let tmax = max(t0, t1);
    let tNear = max(max(tmin.x, tmin.y), tmin.z);
    let tFar = min(min(tmax.x, tmax.y), tmax.z);
    return vec2f(tNear, tFar);
}

// Sample density from 3D texture
fn sampleDensity(p: vec3f) -> f32 {
    // Normalize to [0, 1] within bounds
    let size = uniforms.boundsMax - uniforms.boundsMin;
    let uvw = (p - uniforms.boundsMin) / size;
    
    if (any(uvw < vec3f(0.0)) || any(uvw > vec3f(1.0))) {
        return 0.0;
    }
    
    return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r;
}

// Get color from density using ramp
fn getColor(density: f32) -> vec4f {
    // Simple linear interpolation through ramp
    var color = vec4f(0.0);
    
    for (var i = 0u; i < 15u; i++) {
        let d0 = colorRamp[i].w;
        let d1 = colorRamp[i + 1u].w;
        
        if (density >= d0 && density <= d1) {
            let t = (density - d0) / max(d1 - d0, 0.001);
            color = mix(
                vec4f(colorRamp[i].rgb, 1.0),
                vec4f(colorRamp[i + 1u].rgb, 1.0),
                t
            );
            break;
        }
    }
    
    return color;
}

// Estimate gradient (for normals)
fn estimateGradient(p: vec3f) -> vec3f {
    let eps = uniforms.stepSize * 0.5;
    return normalize(vec3f(
        sampleDensity(p + vec3f(eps, 0.0, 0.0)) - sampleDensity(p - vec3f(eps, 0.0, 0.0)),
        sampleDensity(p + vec3f(0.0, eps, 0.0)) - sampleDensity(p - vec3f(0.0, eps, 0.0)),
        sampleDensity(p + vec3f(0.0, 0.0, eps)) - sampleDensity(p - vec3f(0.0, 0.0, eps))
    ));
}

// Main raymarch function
fn raymarch(ro: vec3f, rd: vec3f) -> vec4f {
    // Intersect with volume bounds
    let tBox = intersectBox(ro, rd, uniforms.boundsMin, uniforms.boundsMax);
    
    if (tBox.x > tBox.y || tBox.y < 0.0) {
        return vec4f(0.0);
    }
    
    var t = max(tBox.x, 0.0);
    let tMax = min(tBox.y, uniforms.maxDistance);
    
    var accColor = vec3f(0.0);
    var accAlpha = 0.0;
    var steps = 0u;
    
    let maxSteps = u32(uniforms.maxSteps);
    let stepSize = uniforms.stepSize;
    
    // Raymarch loop
    loop {
        if (t > tMax || accAlpha >= 0.99 || steps >= maxSteps) {
            break;
        }
        
        let p = ro + t * rd;
        let density = sampleDensity(p);
        
        if (density > uniforms.densityThreshold) {
            // Absorption model
            let absorption = uniforms.absorption * density * stepSize;
            let transmittance = exp(-absorption);
            
            // Get color from density
            let sampleColor = getColor(density);
            
            // Emission
            let emission = sampleColor.rgb * uniforms.emissionStrength * density * stepSize;
            
            // Accumulate
            accColor += emission * (1.0 - accAlpha);
            accAlpha += (1.0 - transmittance) * (1.0 - accAlpha);
        }
        
        t += stepSize;
        steps++;
    }
    
    // Debug mode: show steps
    if (u32(uniforms.renderMode) == 4u) {
        let stepRatio = f32(steps) / f32(maxSteps);
        return vec4f(stepRatio, 1.0 - stepRatio, 0.0, 1.0);
    }
    
    return vec4f(accColor, accAlpha);
}

// Isosurface mode
fn raymarchIsosurface(ro: vec3f, rd: vec3f, isoValue: f32) -> vec4f {
    let tBox = intersectBox(ro, rd, uniforms.boundsMin, uniforms.boundsMax);
    
    if (tBox.x > tBox.y || tBox.y < 0.0) {
        return vec4f(0.0);
    }
    
    var t = max(tBox.x, 0.0);
    let tMax = min(tBox.y, uniforms.maxDistance);
    let stepSize = uniforms.stepSize;
    
    var prevDensity = sampleDensity(ro + t * rd);
    t += stepSize;
    
    // Find isosurface crossing
    loop {
        if (t > tMax) { break; }
        
        let p = ro + t * rd;
        let density = sampleDensity(p);
        
        // Check for crossing
        if ((prevDensity < isoValue && density >= isoValue) ||
            (prevDensity >= isoValue && density < isoValue)) {
            
            // Binary search for exact crossing
            var tLo = t - stepSize;
            var tHi = t;
            for (var i = 0u; i < 4u; i++) {
                let tMid = (tLo + tHi) * 0.5;
                let midDensity = sampleDensity(ro + tMid * rd);
                if ((prevDensity < isoValue) == (midDensity < isoValue)) {
                    tLo = tMid;
                } else {
                    tHi = tMid;
                }
            }
            
            let hitPoint = ro + tHi * rd;
            let normal = estimateGradient(hitPoint);
            
            // Simple diffuse shading
            let lightDir = normalize(vec3f(1.0, 1.0, 0.5));
            let diffuse = max(dot(normal, lightDir), 0.0);
            let ambient = 0.2;
            
            let color = vec3f(0.4, 0.6, 0.9) * (diffuse + ambient);
            return vec4f(color, 1.0);
        }
        
        prevDensity = density;
        t += stepSize;
    }
    
    return vec4f(0.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let pixelCoord = gid.xy;
    
    if (pixelCoord.x >= u32(uniforms.width) || pixelCoord.y >= u32(uniforms.height)) {
        return;
    }
    
    // Generate ray from pixel (simplified, assumes looking down -Z)
    let uv = (vec2f(pixelCoord) + 0.5) / vec2f(uniforms.width, uniforms.height);
    let ndc = uv * 2.0 - 1.0;
    
    let ro = uniforms.cameraPos;
    let rd = normalize(vec3f(ndc.x, -ndc.y, -1.0)); // Simple perspective
    
    var color: vec4f;
    
    let mode = u32(uniforms.renderMode);
    if (mode == 3u) {
        // Isosurface mode
        color = raymarchIsosurface(ro, rd, 0.5);
    } else {
        // Standard raymarch
        color = raymarch(ro, rd);
    }
    
    textureStore(outputTex, pixelCoord, color);
}
`;

export default VolumetricRaymarcher;
