// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VolumetricCloudsPass.js - 3D Volumetric Clouds
 * Now powered by vGPU driver
 * 
 * Renders realistic volumetric clouds using ray marching through
 * 3D noise-based density fields. Includes lighting and shadowing.
 * 
 * Algorithm:
 * 1. Ray march from camera through cloud layer
 * 2. Sample 3D noise for cloud density
 * 3. Accumulate light scattering and extinction
 * 4. Apply shadow from sun direction
 * 
 * Parameters:
 * - coverage: Cloud coverage (0-1)
 * - altitude: Cloud layer altitude in meters
 * - thickness: Cloud layer thickness
 * - density: Cloud density multiplier
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';
import { LEGACY_PCG32_WGSL } from '../../core/math/MathBits.js';
import { degreesToRadians } from '../../core/math/UnitMath.js';

const CLOUD_UNIFORMS_STRUCT = `struct CloudUniforms {
    altitude: f32,
    thickness: f32,
    coverage: f32,
    density: f32,
    windX: f32,
    windZ: f32,
    time: f32,
    sunDirX: f32,
    sunDirY: f32,
    sunDirZ: f32,
    shadowIntensity: f32,
    screenWidth: f32,
    screenHeight: f32,
    enabled: f32,
    detailScale: f32,
    _pad: f32,
}`;
const CLOUD_CAMERA_STRUCT = `struct CameraUniforms {
    invViewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    _pad: f32,
}`;
const _cloudUniformData = new Float32Array(getFloat32ArraySize(CLOUD_UNIFORMS_STRUCT));
const _cloudCameraData = new Float32Array(getFloat32ArraySize(CLOUD_CAMERA_STRUCT));

export const VOLUMETRIC_CLOUDS_JITTER_PCG_HASH_WGSL = /* wgsl */ `
fn volumetricCloudsJitterHash2D(bits: vec2<u32>) -> u32 {
    return legacyPcgCloudJitterHash2D(bits);
}
`;

const VOLUMETRIC_CLOUDS_SHADER = /* wgsl */ `
${CLOUD_UNIFORMS_STRUCT}

${CLOUD_CAMERA_STRUCT}

${LEGACY_PCG32_WGSL}
${VOLUMETRIC_CLOUDS_JITTER_PCG_HASH_WGSL}

@group(0) @binding(0) var<uniform> uniforms: CloudUniforms;
@group(0) @binding(1) var colorTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var colorSampler: sampler;
@group(0) @binding(4) var depthSampler: sampler;
@group(0) @binding(5) var<uniform> camera: CameraUniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) clipPos: vec4<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var output: VertexOutput;
    let x = f32((vertexIndex & 1u) << 2u) - 1.0;
    let y = f32((vertexIndex & 2u) << 1u) - 1.0;
    output.position = vec4<f32>(x, y, 0.0, 1.0);
    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    output.clipPos = vec4<f32>(x, y, 1.0, 1.0);
    return output;
}

// Simple 3D noise (hash-based)
fn hash3(p: vec3<f32>) -> f32 {
    var p3 = fract(p * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Value noise 3D
fn noise3D(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    return mix(
        mix(
            mix(hash3(i + vec3<f32>(0.0, 0.0, 0.0)), hash3(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
            mix(hash3(i + vec3<f32>(0.0, 1.0, 0.0)), hash3(i + vec3<f32>(1.0, 1.0, 0.0)), u.x),
            u.y
        ),
        mix(
            mix(hash3(i + vec3<f32>(0.0, 0.0, 1.0)), hash3(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
            mix(hash3(i + vec3<f32>(0.0, 1.0, 1.0)), hash3(i + vec3<f32>(1.0, 1.0, 1.0)), u.x),
            u.y
        ),
        u.z
    );
}

// 4-octave FBM for base cloud shape (optimized)
fn fbm4(p: vec3<f32>) -> f32 {
    return 0.5 * noise3D(p) + 
           0.25 * noise3D(p * 2.0) + 
           0.125 * noise3D(p * 4.0) + 
           0.0625 * noise3D(p * 8.0);
}

// 2-octave FBM for detail erosion (optimized)
fn fbm2(p: vec3<f32>) -> f32 {
    return 0.5 * noise3D(p) + 0.25 * noise3D(p * 2.0);
}

// Remap utility for cloud shaping
fn remap(value: f32, oldMin: f32, oldMax: f32, newMin: f32, newMax: f32) -> f32 {
    return newMin + (value - oldMin) / (oldMax - oldMin) * (newMax - newMin);
}

// Cloud density at a point (improved with softer edges and better thickness)
fn cloudDensity(pos: vec3<f32>, uniforms: CloudUniforms) -> f32 {
    // Height-based falloff within cloud layer (extended range for softer edges)
    let heightFraction = (pos.y - uniforms.altitude) / uniforms.thickness;
    if (heightFraction < -0.1 || heightFraction > 1.1) {
        return 0.0;
    }
    
    // Softer height gradient with smooth falloff at edges
    let gradientBottom = smoothstep(-0.05, 0.2, heightFraction);
    let gradientTop = 1.0 - smoothstep(0.7, 1.05, heightFraction);
    let heightGradient = gradientBottom * gradientTop;
    
    // Wind offset
    let windOffset = vec3<f32>(uniforms.windX * uniforms.time, 0.0, uniforms.windZ * uniforms.time);
    
    // Base shape noise (large scale) - reduced frequency for fluffier clouds
    let basePos = (pos + windOffset) * 0.0005;
    var baseShape = fbm4(basePos);
    
    // Softer coverage remapping with wider blend
    let coverageEdge = 0.15;  // Softer edge transition
    let coverageShape = smoothstep(1.0 - uniforms.coverage - coverageEdge, 1.0 - uniforms.coverage + coverageEdge, baseShape);
    
    // Apply height gradient to shape
    var density = coverageShape * heightGradient;
    
    // Softer detail erosion
    if (density > 0.005) {
        let detailPos = basePos * uniforms.detailScale * 4.0;
        let detailNoise = fbm2(detailPos);
        
        // Gentle erosion for fluffy edges
        let detailErosion = detailNoise * 0.25;
        density = max(0.0, density - detailErosion * smoothstep(0.0, 0.5, density));
    }
    
    // Apply density multiplier with soft clamp
    density = density * uniforms.density;
    
    // Soft density falloff to prevent hard edges
    return smoothstep(0.0, 0.1, density) * density;
}

// Simple ray-plane intersection for cloud layer bounds
fn rayPlaneIntersect(rayOrigin: vec3<f32>, rayDir: vec3<f32>, planeY: f32) -> f32 {
    if (abs(rayDir.y) < 0.0001) {
        return -1.0;
    }
    return (planeY - rayOrigin.y) / rayDir.y;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample textures first (uniform control flow)
    let sceneColor = textureSampleLevel(colorTex, colorSampler, input.uv, 0.0);
    let depth = textureSampleLevel(depthTex, depthSampler, input.uv, 0.0).r;
    
    // Only render clouds where there's sky (depth near 1.0 = far plane)
    // Skip pixels with terrain/geometry in front
    let isSky = step(0.9999, depth);
    if (isSky < 0.5) {
        return sceneColor;
    }
    
    // Reconstruct world-space ray direction using inverse view-projection matrix
    // Same technique as sky rendering - unproject clip space to world space
    let t = camera.invViewProj * input.clipPos;
    let rayDir = normalize(t.xyz / t.w - camera.cameraPos);
    
    // Camera position from uniforms (world space)
    let rayOrigin = camera.cameraPos;
    
    // Find intersections with cloud layer
    let cloudBottom = uniforms.altitude;
    let cloudTop = uniforms.altitude + uniforms.thickness;
    
    var tMin = rayPlaneIntersect(rayOrigin, rayDir, cloudBottom);
    var tMax = rayPlaneIntersect(rayOrigin, rayDir, cloudTop);
    
    // Ensure proper ordering using min/max
    let tMinSafe = min(tMin, tMax);
    let tMaxSafe = max(tMin, tMax);
    tMin = max(0.0, tMinSafe);
    tMax = tMaxSafe;
    
    // Check if ray hits cloud layer (must be in front of camera)
    if (tMax < 0.0 || tMin > tMax) {
        return sceneColor;
    }
    
    // === PLANET CURVATURE ===
    // Clouds should fade out near horizon due to planet curvature
    // At low viewing angles, clouds are "over the horizon" and shouldn't render
    let horizonFade = smoothstep(0.02, 0.15, rayDir.y);
    if (horizonFade < 0.01) {
        return sceneColor;  // Below effective horizon, skip clouds entirely
    }
    
    // Ray march through cloud layer (more steps = smoother, less banding)
    let rayLength = tMax - tMin;
    let numSteps = select(32, select(48, 64, rayLength > 2000.0), rayLength > 5000.0);
    let stepSize = rayLength / f32(numSteps);
    
    var transmittance = 1.0;
    var lightEnergy = 0.0;
    var inScatter = vec3<f32>(0.0);
    
    let sunDir = normalize(vec3<f32>(uniforms.sunDirX, uniforms.sunDirY, uniforms.sunDirZ) + vec3<f32>(0.0001));
    let sunHeight = max(0.0, sunDir.y);
    
    // Cloud colors - pure white/gray, NOT affected by atmosphere
    // Atmosphere affects sun disc color, but clouds receive direct unfiltered sunlight
    let cloudWhite = vec3<f32>(0.95, 0.95, 0.95);
    let cloudGray = vec3<f32>(0.6, 0.62, 0.65);
    let cloudDark = vec3<f32>(0.35, 0.37, 0.42);
    
    // Sun intensity based on height (clouds get less light when sun is low, but NO color tint)
    let sunIntensity = smoothstep(-0.1, 0.3, sunHeight);
    
    // Temporal jitter to break up banding - hash based on screen position
    let jitterBits = vec2<u32>(bitcast<u32>(input.uv.x), bitcast<u32>(input.uv.y));
    let jitterSeed = f32(volumetricCloudsJitterHash2D(jitterBits)) / 4294967295.0;
    let jitterOffset = jitterSeed * stepSize;
    
    for (var i = 0; i < numSteps; i = i + 1) {
        if (transmittance < 0.01) {
            break;  // Early exit when opaque
        }
        
        // Add jitter to sample position to eliminate banding
        let marchT = tMin + jitterOffset + (f32(i) + 0.5) * stepSize;
        let samplePos = rayOrigin + rayDir * marchT;
        
        let density = cloudDensity(samplePos, uniforms);
        
        if (density > 0.001) {
            // Beer-Lambert extinction (very soft for translucent clouds)
            let sampleExtinction = exp(-density * stepSize * 0.02);
            
            // Light marching toward sun (2 steps for performance)
            let lightStepSize = uniforms.thickness * 0.2;
            let lightPos1 = samplePos + sunDir * lightStepSize;
            let lightPos2 = samplePos + sunDir * lightStepSize * 2.0;
            let lightOpticalDepth = (cloudDensity(lightPos1, uniforms) + cloudDensity(lightPos2, uniforms)) * lightStepSize;
            let lightTransmittance = exp(-lightOpticalDepth * uniforms.shadowIntensity * 0.5);
            
            // Powder effect (brighter at thin edges) - Horizon technique
            let powder = 1.0 - exp(-density * 2.0);
            
            // === MULTI-SCATTERING FIX (prevents black clouds) ===
            // Real clouds have multiple scattering that fills in shadows
            // Fake it with isotropic + forward scatter blend
            let cosTheta = dot(rayDir, sunDir);
            
            // Henyey-Greenstein phase function (g=0.7 forward scatter)
            let g = 0.7;
            let hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5) / 4.0;
            
            // Blend forward scatter with isotropic (fake multiple scattering)
            let isotropic = 0.25;  // Uniform scatter in all directions
            let phase = mix(isotropic, hg, 0.6);  // 60% directional, 40% isotropic
            
            // In-scatter calculation
            let scatter = density * transmittance * lightTransmittance * phase;
            
            // === GRADIENT LIGHTING (prevents harsh black) ===
            // Use smooth gradient instead of hard shadow cutoff
            let lightGradient = smoothstep(0.0, 1.0, lightTransmittance);
            let ambientBoost = 0.35;  // Minimum light level (prevents pure black)
            let totalLight = max(ambientBoost, lightGradient * sunIntensity);
            
            // Color based on lighting with soft gradient
            var sampleColor = mix(cloudDark, cloudGray, totalLight);
            sampleColor = mix(sampleColor, cloudWhite, powder * totalLight * 0.7);
            
            // Accumulate (low multiplier to prevent blowout)
            inScatter += sampleColor * scatter * stepSize * 3.0;
            transmittance *= sampleExtinction;
        }
    }
    
    // Clamp in-scatter to prevent blowout
    inScatter = min(inScatter, vec3<f32>(1.0));
    
    // Ambient lighting - stronger to prevent black clouds
    let ambientStrength = 0.45 + sunIntensity * 0.25;
    let ambient = vec3<f32>(0.55, 0.57, 0.6) * ambientStrength;
    let cloudLit = inScatter + ambient * (1.0 - transmittance);
    
    // Soft color clamp
    let cloudClamped = clamp(cloudLit, vec3<f32>(0.0), vec3<f32>(1.0));
    
    // Softer blend with sky using smoothstep for gradual transition
    // Apply horizon fade for planet curvature effect
    let blendFactor = smoothstep(0.0, 0.1, 1.0 - transmittance) * (1.0 - transmittance) * horizonFade;
    let finalColor = mix(sceneColor.rgb, cloudClamped, blendFactor);
    
    return vec4<f32>(finalColor, sceneColor.a);
}
`;

export class VolumetricCloudsPass {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = false;  // Disabled by default (expensive)
        
        // Cloud parameters (from engine.cfg)
        this.coverage = 0.45;      // Moderate coverage
        this.altitude = 1800;
        this.thickness = 1200;     // Thicker layer for softer falloff
        this.density = 0.12;       // Moderate density for visible but soft clouds
        this.windSpeed = 10.0;
        this.windDirection = 45;  // degrees
        this.shadowIntensity = 0.5;
        this.detailScale = 0.5;
        
        // Sun direction (updated from sky)
        this.sunDir = [0.5, 0.5, 0.5];
        
        // Time for wind animation
        this.time = 0;
        
        // Screen dimensions
        this.width = 1920;
        this.height = 1080;
        
        // GPU resources
        this.pipeline = null;
        this.uniformBuffer = null;
        this.cameraBuffer = null;
        this.bindGroupLayout = null;
        this.sampler = null;
    }
    
    /**
     * Initialize GPU resources
     */
    async init(device, format = 'bgra8unorm') {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.format = format;
        
        // Create buffers using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 64, usage: 'uniform', label: 'VolumetricCloudsUniforms' }).buffer;
        this.cameraBuffer = this.vgpu.buffer.create({ size: 80, usage: 'uniform', label: 'VolumetricCloudsCamera' }).buffer;
        
        // Create samplers
        this.colorSampler = this.vgpu.texture.sampler({ filter: 'linear' });
        this.depthSampler = this.vgpu.texture.sampler({ filter: 'nearest' });
        
        // Bind group layout
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('volumetricClouds', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'unfilterable-float' },
            { binding: 3, type: 'sampler', visibility: 'fragment' },
            { binding: 4, type: 'sampler', visibility: 'fragment', samplerType: 'non-filtering' },
            { binding: 5, type: 'uniform', visibility: 'vertex|fragment' },
        ]);
        
        const shaderModule = this.vgpu.shader.compile('volumetricClouds', VOLUMETRIC_CLOUDS_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            depthFormat: null,
            topology: 'triangle-list',
            label: 'VolumetricCloudsPipeline'
        });
        
        this.updateUniforms();
        this.initialized = true;
        
        console.log('[VolumetricCloudsPass] Initialized with vGPU');
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Calculate wind vector from speed and direction
        const windRad = degreesToRadians(Number(this.windDirection));
        const windX = Math.cos(windRad) * this.windSpeed;
        const windZ = Math.sin(windRad) * this.windSpeed;
        
        // Reuse module-level buffer
        _cloudUniformData[0] = this.altitude;
        _cloudUniformData[1] = this.thickness;
        _cloudUniformData[2] = this.coverage;
        _cloudUniformData[3] = this.density;
        _cloudUniformData[4] = windX;
        _cloudUniformData[5] = windZ;
        _cloudUniformData[6] = this.time;
        _cloudUniformData[7] = this.sunDir[0];
        _cloudUniformData[8] = this.sunDir[1];
        _cloudUniformData[9] = this.sunDir[2];
        _cloudUniformData[10] = this.shadowIntensity;
        _cloudUniformData[11] = this.width;
        _cloudUniformData[12] = this.height;
        _cloudUniformData[13] = this.enabled ? 1.0 : 0.0;
        _cloudUniformData[14] = this.detailScale;
        _cloudUniformData[15] = 0.0;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _cloudUniformData, 0, 16);
    }
    
    /**
     * Set screen dimensions
     */
    setSize(width, height) {
        this.width = width;
        this.height = height;
        this.updateUniforms();
    }
    
    /**
     * Update sun direction
     */
    setSunDirection(direction) {
        if (direction) {
            this.sunDir = [...direction];
            this.updateUniforms();
        }
    }
    
    /**
     * Update time for wind animation
     */
    update(deltaTime) {
        this.time += deltaTime;
        this.updateUniforms();
    }
    
    /**
     * Render the pass
     * @param {GPUCommandEncoder} commandEncoder
     * @param {GPUTexture} colorTexture
     * @param {GPUTexture} depthTexture  
     * @param {GPUTextureView} outputView
     * @param {Float32Array} viewMatrix - View matrix
     * @param {Float32Array} projectionMatrix - Projection matrix
     * @param {Function} mat4Multiply - Matrix multiply function
     * @param {Function} mat4Inverse - Matrix inverse function
     */
    render(commandEncoder, colorTexture, depthTexture, outputView, viewMatrix, projectionMatrix, mat4Multiply, mat4Inverse) {
        if (!this.initialized || !this.enabled) return;
        if (!depthTexture) return;
        
        // Skip if no camera matrices provided (first frame)
        if (!viewMatrix || !projectionMatrix || !mat4Multiply || !mat4Inverse) return;
        
        // Skip if projection is identity (camera not initialized)
        if (projectionMatrix[0] === 1 && projectionMatrix[5] === 1 && projectionMatrix[10] === 1 && projectionMatrix[15] === 1) {
            return;
        }
        
        // Compute view-projection and its inverse
        const viewProj = mat4Multiply(projectionMatrix, viewMatrix);
        const invViewProj = mat4Inverse(viewProj);
        
        // Extract camera position from inverse view matrix
        const invView = mat4Inverse(viewMatrix);
        const cameraPos = [invView[12], invView[13], invView[14]];
        
        // Update camera buffer - reuse buffer
        _cloudCameraData.set(invViewProj, 0);  // mat4 at offset 0
        _cloudCameraData[16] = cameraPos[0];
        _cloudCameraData[17] = cameraPos[1];
        _cloudCameraData[18] = cameraPos[2];
        _cloudCameraData[19] = 0;  // padding
        this.device.queue.writeBuffer(this.cameraBuffer, 0, _cloudCameraData);
        
        const bindGroup = this.device.createBindGroup({
            label: 'Volumetric Clouds Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: colorTexture.createView() },
                { binding: 2, resource: depthTexture.createView() },
                { binding: 3, resource: this.colorSampler },
                { binding: 4, resource: this.depthSampler },
                { binding: 5, resource: { buffer: this.cameraBuffer } },
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
     * Load configuration from engine.cfg [volumetric_clouds] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled === true;  // Disabled by default
        this.coverage = parseFloat(cfg.coverage) ?? 0.5;
        this.altitude = parseFloat(cfg.altitude) ?? 2000;
        this.thickness = parseFloat(cfg.thickness) ?? 500;
        this.density = parseFloat(cfg.density) ?? 0.3;
        this.windSpeed = parseFloat(cfg.wind_speed) ?? 10.0;
        this.windDirection = parseFloat(cfg.wind_direction) ?? 45;
        this.shadowIntensity = parseFloat(cfg.shadow_intensity) ?? 0.5;
        this.detailScale = parseFloat(cfg.detail_scale) ?? 0.5;
        
        this.updateUniforms();
    }
    
    /**
     * Get current config
     */
    getConfig() {
        return {
            enabled: this.enabled,
            coverage: this.coverage,
            altitude: this.altitude,
            thickness: this.thickness,
            density: this.density,
            wind_speed: this.windSpeed,
            wind_direction: this.windDirection,
            shadow_intensity: this.shadowIntensity,
            detail_scale: this.detailScale,
        };
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
        this.cameraBuffer?.destroy();
        this.uniformBuffer = null;
        this.cameraBuffer = null;
        this.pipeline = null;
        this.bindGroupLayout = null;
        this.colorSampler = null;
        this.depthSampler = null;
        this.initialized = false;
    }
}

export default VolumetricCloudsPass;
