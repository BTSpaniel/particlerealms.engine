// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CascadedShadows.js - Cascaded Shadow Maps
 * Now powered by vGPU driver
 * 
 * Implements multi-cascade shadow mapping for large outdoor scenes.
 * Each cascade covers a different distance range for optimal shadow quality.
 * 
 * Benefits:
 * - High quality shadows near camera
 * - Shadows extend to far distances
 * - Efficient GPU usage
 * 
 * Typical setup:
 * - Cascade 0: 0-20m (high detail)
 * - Cascade 1: 20-60m (medium detail)
 * - Cascade 2: 60-150m (low detail)
 * - Cascade 3: 150-400m (very low detail)
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const CSM_DEPTH_SHADER = /* wgsl */ `
struct CascadeUniforms {
    lightViewProj: mat4x4<f32>,
    cascadeIndex: u32,
    _pad: vec3<u32>,
}

@group(0) @binding(0) var<uniform> cascade: CascadeUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
}

@vertex
fn vertexMain(input: VertexInput) -> @builtin(position) vec4<f32> {
    return cascade.lightViewProj * vec4<f32>(input.position, 1.0);
}

@fragment
fn fragmentMain() {
    // Depth-only pass, no output needed
}
`;

const CSM_SAMPLE_SHADER = /* wgsl */ `
struct CSMUniforms {
    cascadeViewProj: array<mat4x4<f32>, 4>,
    cascadeSplits: vec4<f32>,
    lightDirection: vec3<f32>,
    shadowBias: f32,
    shadowMapSize: f32,
    softness: f32,
    _pad: vec2<f32>,
}

@group(0) @binding(0) var<uniform> csm: CSMUniforms;
@group(0) @binding(1) var shadowMaps: texture_depth_2d_array;
@group(0) @binding(2) var shadowSampler: sampler_comparison;

// Determine which cascade to use based on view-space depth
fn getCascadeIndex(viewSpaceZ: f32) -> u32 {
    for (var i = 0u; i < 4u; i++) {
        if (viewSpaceZ < csm.cascadeSplits[i]) {
            return i;
        }
    }
    return 3u;
}

// Sample shadow map with PCF filtering
fn sampleShadowPCF(worldPos: vec3<f32>, cascadeIndex: u32) -> f32 {
    let lightSpacePos = csm.cascadeViewProj[cascadeIndex] * vec4<f32>(worldPos, 1.0);
    var projCoords = lightSpacePos.xyz / lightSpacePos.w;
    
    // Transform to [0,1] range
    projCoords.x = projCoords.x * 0.5 + 0.5;
    projCoords.y = projCoords.y * -0.5 + 0.5;
    
    // Check bounds
    if (projCoords.x < 0.0 || projCoords.x > 1.0 || 
        projCoords.y < 0.0 || projCoords.y > 1.0 ||
        projCoords.z < 0.0 || projCoords.z > 1.0) {
        return 1.0;  // Outside shadow map
    }
    
    let currentDepth = projCoords.z - csm.shadowBias;
    
    // PCF 3x3 filtering
    var shadow = 0.0;
    let texelSize = 1.0 / csm.shadowMapSize;
    
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let offset = vec2<f32>(f32(x), f32(y)) * texelSize * csm.softness;
            let sampleCoord = projCoords.xy + offset;
            shadow += textureSampleCompare(
                shadowMaps, 
                shadowSampler, 
                sampleCoord, 
                i32(cascadeIndex), 
                currentDepth
            );
        }
    }
    
    return shadow / 9.0;
}

// Main shadow sampling function
fn getShadow(worldPos: vec3<f32>, viewSpaceZ: f32) -> f32 {
    let cascadeIndex = getCascadeIndex(viewSpaceZ);
    return sampleShadowPCF(worldPos, cascadeIndex);
}

// Blend between cascades for smoother transitions
fn getShadowBlended(worldPos: vec3<f32>, viewSpaceZ: f32) -> f32 {
    let cascadeIndex = getCascadeIndex(viewSpaceZ);
    var shadow = sampleShadowPCF(worldPos, cascadeIndex);
    
    // Blend with next cascade near boundaries
    if (cascadeIndex < 3u) {
        let splitDist = csm.cascadeSplits[cascadeIndex];
        let blendStart = splitDist * 0.9;
        
        if (viewSpaceZ > blendStart) {
            let blendFactor = (viewSpaceZ - blendStart) / (splitDist - blendStart);
            let nextShadow = sampleShadowPCF(worldPos, cascadeIndex + 1u);
            shadow = mix(shadow, nextShadow, blendFactor);
        }
    }
    
    return shadow;
}
`;

/**
 * CascadedShadowMap - Multi-cascade shadow mapping system
 */
export class CascadedShadowMap {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        // Configuration (matches engine.cfg [shadows] section)
        this.cascadeCount = 4;
        this.shadowMapSize = 2048;
        this.resolution = 2048;  // Alias for shadowMapSize (config compatibility)
        this.cascadeSplits = [20, 60, 150, 400];  // View-space distances
        this.shadowBias = 0.002;
        this.bias = 0.002;  // Alias for shadowBias (config compatibility)
        this.normalBias = 0.02;  // Normal offset bias
        this.softness = 1.5;

        this.shadowMapFormat = 'depth32float';
        
        // Light direction (normalized)
        this.lightDirection = [0.5, -0.8, 0.3];
        
        // GPU resources
        this.shadowMapArray = null;
        this.shadowMapLayerViews = [];
        this.depthPipeline = null;
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.samplerComparison = null;

        this.sampleBindGroup = null;
        this.shadowMapArrayView = null;

        this._cascadeUniformData = new Float32Array(20);
        this._mainUniformData = new Float32Array(4 * 16 + 12);
        this._lightView = new Float32Array(16);
        this._lightProj = new Float32Array(16);
        this._viewProj = new Float32Array(16);
        
        // Per-cascade data
        this.cascadeMatrices = [];
        this.cascadeBindGroups = [];
    }
    
    /**
     * Initialize the cascaded shadow map system
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;

        // Create shadow map array texture (try lower-VRAM depth16unorm, fallback to depth32float)
        const tryFormats = this.shadowMapFormat === 'depth16unorm'
            ? ['depth16unorm', 'depth32float']
            : [this.shadowMapFormat, 'depth32float'];

        let format = 'depth32float';
        for (const fmt of tryFormats) {
            try {
                this.shadowMapArray = this.vgpu.texture.create({
                    width: this.shadowMapSize, height: this.shadowMapSize,
                    depth: this.cascadeCount, format: fmt,
                    usage: 'render|texture', label: 'CSMShadowMapArray'
                }).texture;
                format = fmt;
                break;
            } catch (e) {
                // Try next format
            }
        }

        this.shadowMapFormat = format;
        this.shadowMapArrayView = this.shadowMapArray.createView({ dimension: '2d-array' });

        // Cache per-cascade depth views
        this.shadowMapLayerViews = [];
        for (let i = 0; i < this.cascadeCount; i++) {
            this.shadowMapLayerViews.push(this.shadowMapArray.createView({
                dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1,
            }));
        }
        
        // Create comparison sampler and uniform buffer
        this.samplerComparison = this.vgpu.texture.sampler({ filter: 'linear', compare: 'less' });
        this.uniformBuffer = this.vgpu.buffer.create({ size: 4 * 64 + 48, usage: 'uniform', label: 'CSMUniforms' }).buffer;
        
        // Create depth pass shader and layout
        const depthModule = this.vgpu.shader.compile('csmDepth', CSM_DEPTH_SHADER);
        const depthBindGroupLayout = this.vgpu.bindings.defineLayout('csmDepth', [
            { binding: 0, type: 'uniform', visibility: 'vertex' },
        ]);
        
        // Create depth pipeline (depth-only, no color output)
        this.depthPipeline = this.vgpu.pipeline.render({
            vertex: { module: depthModule, entryPoint: 'vertexMain' },
            fragment: { module: depthModule, entryPoint: 'fragmentMain' },
            vertexLayout: [{
                arrayStride: 12,
                attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
            }],
            layouts: [depthBindGroupLayout],
            colorFormats: [],  // Depth-only pass - no color output
            depthFormat: this.shadowMapFormat,
            depthWrite: true,
            depthCompare: 'less',
            cullMode: 'front',
            topology: 'triangle-list',
            label: 'CSMDepthPipeline'
        });
        
        // Create bind group layout for shadow sampling
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('csmSample', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'depth', viewDimension: '2d-array' },
            { binding: 2, type: 'sampler', visibility: 'fragment', samplerType: 'comparison' },
        ]);

        this.sampleBindGroup = this.vgpu.bindings.createGroup(this.bindGroupLayout, [
            { binding: 0, buffer: this.uniformBuffer },
            { binding: 1, textureView: this.shadowMapArrayView },
            { binding: 2, sampler: this.samplerComparison },
        ]);
        
        // Create per-cascade uniform buffers and bind groups
        for (let i = 0; i < this.cascadeCount; i++) {
            const cascadeBuffer = this.vgpu.buffer.create({
                size: 80, usage: 'uniform', label: `CSMCascade${i}Uniforms`
            }).buffer;
            
            const bindGroup = this.vgpu.bindings.createGroup(depthBindGroupLayout, [
                { binding: 0, buffer: cascadeBuffer },
            ]);
            
            this.cascadeMatrices.push({
                buffer: cascadeBuffer,
                viewProj: new Float32Array(16),
            });
            this.cascadeBindGroups.push(bindGroup);
        }
        
        this.initialized = true;
        console.log(`[CascadedShadows] Initialized: ${this.cascadeCount} cascades, ${this.shadowMapSize}×${this.shadowMapSize}`);
    }
    
    /**
     * Calculate cascade frustum split distances using PSSM
     * @param {number} near - Camera near plane
     * @param {number} far - Camera far plane
     * @param {number} lambda - Blend factor (0 = linear, 1 = logarithmic)
     */
    calculateSplits(near, far, lambda = 0.5) {
        for (let i = 0; i < this.cascadeCount; i++) {
            const p = (i + 1) / this.cascadeCount;
            const log = near * Math.pow(far / near, p);
            const linear = near + (far - near) * p;
            this.cascadeSplits[i] = lambda * log + (1 - lambda) * linear;
        }
    }
    
    /**
     * Update cascade matrices for current camera
     * @param {Object} camera - { position, viewMatrix, projMatrix, near, far, fov, aspect }
     */
    updateCascades(camera) {
        if (!this.initialized) return;
        
        const lightDir = this.normalizeVec3(this.lightDirection);
        
        for (let i = 0; i < this.cascadeCount; i++) {
            const nearDist = i === 0 ? camera.near : this.cascadeSplits[i - 1];
            const farDist = this.cascadeSplits[i];
            
            // Calculate frustum corners for this cascade
            const frustumCorners = this.getFrustumCorners(camera, nearDist, farDist);
            
            // Calculate tight bounding sphere
            const center = this.calculateFrustumCenter(frustumCorners);
            let radius = 0;
            for (const corner of frustumCorners) {
                const dist = this.distance(corner, center);
                radius = Math.max(radius, dist);
            }
            
            // Round to prevent shadow swimming
            const texelsPerUnit = this.shadowMapSize / (radius * 2);
            
            // Create light view matrix
            const lightView = this.lookAt(
                [center[0] - lightDir[0] * radius, 
                 center[1] - lightDir[1] * radius, 
                 center[2] - lightDir[2] * radius],
                center,
                [0, 1, 0],
                this._lightView
            );
            
            // Create orthographic projection
            const lightProj = this.ortho(-radius, radius, -radius, radius, 0.1, radius * 2, this._lightProj);
            
            // Combine into view-projection matrix
            const viewProj = this.multiplyMat4(lightProj, lightView, this._viewProj);
            
            // Store matrix
            this.cascadeMatrices[i].viewProj.set(viewProj);
            
            // Update GPU buffer
            const data = this._cascadeUniformData;  // mat4 + index + pad
            data.set(viewProj, 0);
            data[16] = i;
            this.device.queue.writeBuffer(this.cascadeMatrices[i].buffer, 0, data);
        }
        
        // Update main uniform buffer
        this.updateUniformBuffer();
    }
    
    /**
     * Update the main uniform buffer with all cascade data
     */
    updateUniformBuffer() {
        const data = this._mainUniformData;
        
        // Copy all cascade matrices
        for (let i = 0; i < this.cascadeCount; i++) {
            data.set(this.cascadeMatrices[i].viewProj, i * 16);
        }
        
        // Cascade splits
        const offset = 64;
        data[offset + 0] = this.cascadeSplits[0];
        data[offset + 1] = this.cascadeSplits[1];
        data[offset + 2] = this.cascadeSplits[2];
        data[offset + 3] = this.cascadeSplits[3];
        
        // Light direction
        data[offset + 4] = this.lightDirection[0];
        data[offset + 5] = this.lightDirection[1];
        data[offset + 6] = this.lightDirection[2];
        
        // Shadow parameters
        data[offset + 7] = this.shadowBias;
        data[offset + 8] = this.shadowMapSize;
        data[offset + 9] = this.softness;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Render shadow maps for all cascades
     * @param {GPUCommandEncoder} encoder 
     * @param {Function} renderGeometry - (pass, cascadeIndex) => void
     */
    renderShadowMaps(encoder, renderGeometry) {
        if (!this.enabled || !this.initialized) return;
        
        for (let i = 0; i < this.cascadeCount; i++) {
            const view = this.shadowMapLayerViews[i];
            
            const pass = encoder.beginRenderPass({
                colorAttachments: [],
                depthStencilAttachment: {
                    view,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                    depthClearValue: 1.0,
                },
            });
            
            pass.setPipeline(this.depthPipeline);
            pass.setBindGroup(0, this.cascadeBindGroups[i]);
            
            // Let caller render geometry
            renderGeometry(pass, i);
            
            pass.end();
        }
    }
    
    /**
     * Update uniforms from config (called by ConfigLoader)
     */
    updateUniforms() {
        // Sync aliases
        this.shadowMapSize = this.resolution;
        this.shadowBias = this.bias;
        
        if (this.initialized) {
            this.updateUniformBuffer();
        }
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [shadows] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.cascadeCount = parseInt(cfg.cascades) || 4;
        this.resolution = parseInt(cfg.resolution) || 2048;
        this.bias = parseFloat(cfg.bias) || 0.005;
        this.normalBias = parseFloat(cfg.normal_bias) || 0.02;
        
        this.updateUniforms();
    }
    
    /**
     * Get bind group for shadow sampling
     * @returns {GPUBindGroup}
     */
    getSampleBindGroup() {
        return this.sampleBindGroup;
    }
    
    /**
     * Get WGSL code for shadow sampling
     */
    static getSampleShader() {
        return CSM_SAMPLE_SHADER;
    }
    
    // === Math utilities ===
    
    normalizeVec3(v) {
        const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
        return [v[0]/len, v[1]/len, v[2]/len];
    }
    
    distance(a, b) {
        const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2];
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    
    calculateFrustumCenter(corners) {
        let cx = 0, cy = 0, cz = 0;
        for (const c of corners) {
            cx += c[0]; cy += c[1]; cz += c[2];
        }
        return [cx/8, cy/8, cz/8];
    }
    
    getFrustumCorners(camera, near, far) {
        // Simplified - returns 8 corners of view frustum slice
        const tanHalfFov = Math.tan(camera.fov * 0.5);
        const nearH = near * tanHalfFov;
        const nearW = nearH * camera.aspect;
        const farH = far * tanHalfFov;
        const farW = farH * camera.aspect;
        
        // In view space, transform to world space using inverse view matrix
        // Simplified version - assumes camera at origin looking -Z
        const pos = camera.position || [0, 0, 0];
        return [
            [pos[0] - nearW, pos[1] - nearH, pos[2] - near],
            [pos[0] + nearW, pos[1] - nearH, pos[2] - near],
            [pos[0] + nearW, pos[1] + nearH, pos[2] - near],
            [pos[0] - nearW, pos[1] + nearH, pos[2] - near],
            [pos[0] - farW, pos[1] - farH, pos[2] - far],
            [pos[0] + farW, pos[1] - farH, pos[2] - far],
            [pos[0] + farW, pos[1] + farH, pos[2] - far],
            [pos[0] - farW, pos[1] + farH, pos[2] - far],
        ];
    }
    
    lookAt(eye, center, up, out = new Float32Array(16)) {
        const f = this.normalizeVec3([center[0]-eye[0], center[1]-eye[1], center[2]-eye[2]]);
        const s = this.normalizeVec3(this.cross(f, up));
        const u = this.cross(s, f);

        out[0] = s[0];
        out[1] = u[0];
        out[2] = -f[0];
        out[3] = 0;

        out[4] = s[1];
        out[5] = u[1];
        out[6] = -f[1];
        out[7] = 0;

        out[8] = s[2];
        out[9] = u[2];
        out[10] = -f[2];
        out[11] = 0;

        out[12] = -this.dot(s, eye);
        out[13] = -this.dot(u, eye);
        out[14] = this.dot(f, eye);
        out[15] = 1;

        return out;
    }
    
    ortho(left, right, bottom, top, near, far, out = new Float32Array(16)) {
        out[0] = 2 / (right - left);
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;

        out[4] = 0;
        out[5] = 2 / (top - bottom);
        out[6] = 0;
        out[7] = 0;

        out[8] = 0;
        out[9] = 0;
        out[10] = -2 / (far - near);
        out[11] = 0;

        out[12] = -(right + left) / (right - left);
        out[13] = -(top + bottom) / (top - bottom);
        out[14] = -(far + near) / (far - near);
        out[15] = 1;

        return out;
    }

    cross(a, b) {
        return [
            a[1]*b[2] - a[2]*b[1],
            a[2]*b[0] - a[0]*b[2],
            a[0]*b[1] - a[1]*b[0],
        ];
    }

    dot(a, b) {
        return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    }

    multiplyMat4(a, b, out = new Float32Array(16)) {
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                out[i*4+j] = a[j]*b[i*4] + a[4+j]*b[i*4+1] + a[8+j]*b[i*4+2] + a[12+j]*b[i*4+3];
            }
        }
        return out;
    }

    setLightDirection(dir) {
        this.lightDirection = this.normalizeVec3(dir);
    }
    destroy() {
        this.shadowMapArray?.destroy();
        this.uniformBuffer?.destroy();
        for (const cascade of this.cascadeMatrices) {
            cascade.buffer?.destroy();
        }
        this.cascadeMatrices = [];
        this.cascadeBindGroups = [];
        this.initialized = false;
    }
}

export default CascadedShadowMap;
