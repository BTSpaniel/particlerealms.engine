// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DualModeRenderer.js - Particle + Voxel Dual-Mode Visualization
 * Now powered by vGPU driver
 * 
 * Manages transitions between:
 * - Lagrangian view: Individual particles (spheres/billboards)
 * - Eulerian view: Density field (raymarched volume)
 * 
 * Features:
 * - Distance-based LOD (particles close, volume far)
 * - Smooth crossfade transitions
 * - Velocity-to-color mapping for particles
 * - Screen-space fluid rendering option
 * - Performance-adaptive quality
 */

import { initVGPU } from '../core/gpu/VirtualGPU.js';
import { VolumetricRaymarcher, RenderMode } from './VolumetricRaymarch.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _dualModeUniformData = new Float32Array(64);

// ============================================================================
// CONSTANTS
// ============================================================================

/** View modes */
export const ViewMode = {
    PARTICLES: 0,    // Pure particle rendering
    VOLUME: 1,       // Pure volume raymarching
    HYBRID: 2,       // Distance-based blend
    SSFR: 3,         // Screen-space fluid rendering
};

/** LOD distance thresholds */
export const LOD_THRESHOLDS = {
    particleOnly: 20,    // < 20m: Only particles
    blendStart: 20,      // 20m: Start blending
    blendEnd: 50,        // 50m: Full volume
    volumeOnly: 50,      // > 50m: Only volume
};

/** Particle rendering styles */
export const ParticleStyle = {
    SPHERE: 0,
    BILLBOARD: 1,
    POINT: 2,
    METABALL: 3,
};

// ============================================================================
// PARTICLE RENDERER
// ============================================================================

export class ParticleRenderer {
    /**
     * @param {GPUDevice} device 
     */
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        this.maxParticles = 100000;
        this.particleCount = 0;
        
        // Buffers
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.colorBuffer = null;
        this.instanceBuffer = null;
        
        // Render state
        this.style = ParticleStyle.SPHERE;
        this.particleSize = 0.1;
        this.velocityColorScale = 0.1;
        
        // Sphere geometry
        this.sphereVertexBuffer = null;
        this.sphereIndexBuffer = null;
        this.sphereIndexCount = 0;
        
        // Pipeline
        this.pipeline = null;
        this.bindGroup = null;
        
        this.initialized = false;
    }
    
    async init() {
        // Create sphere geometry
        this._createSphereGeometry(8, 6);
        
        // Create buffers using vGPU
        this.positionBuffer = this.vgpu.buffer.create({
            size: this.maxParticles * 16, usage: 'storage', label: 'ParticlePositions'
        }).buffer;
        
        this.velocityBuffer = this.vgpu.buffer.create({
            size: this.maxParticles * 16, usage: 'storage', label: 'ParticleVelocities'
        }).buffer;
        
        this.instanceBuffer = this.vgpu.buffer.create({
            size: this.maxParticles * 32, usage: 'vertex', label: 'ParticleInstances'
        }).buffer;
        
        this.uniformBuffer = this.vgpu.buffer.create({
            size: 256, usage: 'uniform', label: 'ParticleUniforms'
        }).buffer;
        
        await this._createPipeline();
        
        this.initialized = true;
    }
    
    _createSphereGeometry(segments, rings) {
        const vertices = [];
        const indices = [];
        
        // Generate vertices
        for (let r = 0; r <= rings; r++) {
            const phi = (r / rings) * Math.PI;
            const y = Math.cos(phi);
            const ringRadius = Math.sin(phi);
            
            for (let s = 0; s <= segments; s++) {
                const theta = (s / segments) * Math.PI * 2;
                const x = ringRadius * Math.cos(theta);
                const z = ringRadius * Math.sin(theta);
                
                // Position
                vertices.push(x, y, z);
                // Normal (same as position for unit sphere)
                vertices.push(x, y, z);
            }
        }
        
        // Generate indices
        for (let r = 0; r < rings; r++) {
            for (let s = 0; s < segments; s++) {
                const a = r * (segments + 1) + s;
                const b = a + segments + 1;
                
                indices.push(a, b, a + 1);
                indices.push(b, b + 1, a + 1);
            }
        }
        
        this.sphereVertexBuffer = this.vgpu.buffer.create({
            size: vertices.length * 4, usage: 'vertex', label: 'SphereVertices'
        }).buffer;
        this.device.queue.writeBuffer(this.sphereVertexBuffer, 0, new Float32Array(vertices));
        
        this.sphereIndexBuffer = this.vgpu.buffer.create({
            size: indices.length * 2, usage: 'index', label: 'SphereIndices'
        }).buffer;
        this.device.queue.writeBuffer(this.sphereIndexBuffer, 0, new Uint16Array(indices));
        
        this.sphereIndexCount = indices.length;
    }
    
    async _createPipeline() {
        const shaderModule = this.vgpu.shader.compile('particle', PARTICLE_SHADER);
        
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            vertexLayout: [
                {
                    arrayStride: 24,
                    stepMode: 'vertex',
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' },
                        { shaderLocation: 1, offset: 12, format: 'float32x3' },
                    ],
                },
                {
                    arrayStride: 32,
                    stepMode: 'instance',
                    attributes: [
                        { shaderLocation: 2, offset: 0, format: 'float32x3' },
                        { shaderLocation: 3, offset: 12, format: 'float32' },
                        { shaderLocation: 4, offset: 16, format: 'float32x4' },
                    ],
                },
            ],
            colorFormat: 'rgba8unorm',
            depthFormat: 'depth24plus',
            depthWrite: true,
            depthCompare: 'less',
            cullMode: 'back',
            topology: 'triangle-list',
            label: 'ParticlePipeline'
        });
    }
    
    /**
     * Update particle data from storage buffer
     * @param {GPUBuffer} positionBuffer 
     * @param {GPUBuffer} velocityBuffer 
     * @param {number} count 
     */
    setParticleBuffers(positionBuffer, velocityBuffer, count) {
        this.externalPositionBuffer = positionBuffer;
        this.externalVelocityBuffer = velocityBuffer;
        this.particleCount = count;
    }
    
    /**
     * Update instance buffer with velocity-to-color mapping
     * @param {GPUCommandEncoder} encoder 
     */
    updateInstances(encoder) {
        // This would be a compute pass to convert positions/velocities to instance data
        // For simplicity, assume external update
    }
    
    /**
     * Upload instance data from CPU
     * @param {Float32Array} data - 8 floats per particle
     */
    uploadInstances(data) {
        this.device.queue.writeBuffer(this.instanceBuffer, 0, data);
        this.particleCount = data.length / 8;
    }
    
    /**
     * Update uniforms
     * @param {Float32Array} viewProjMatrix 
     * @param {number[]} cameraPos 
     */
    updateUniforms(viewProjMatrix, cameraPos) {
        const data = _dualModeUniformData;  // Reuse buffer
        data.set(viewProjMatrix, 0);
        data[48] = cameraPos[0];
        data[49] = cameraPos[1];
        data[50] = cameraPos[2];
        data[51] = this.particleSize;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Render particles
     * @param {GPURenderPassEncoder} pass 
     */
    render(pass) {
        if (!this.initialized || this.particleCount === 0) return;
        
        pass.setPipeline(this.pipeline);
        pass.setVertexBuffer(0, this.sphereVertexBuffer);
        pass.setVertexBuffer(1, this.instanceBuffer);
        pass.setIndexBuffer(this.sphereIndexBuffer, 'uint16');
        pass.drawIndexed(this.sphereIndexCount, this.particleCount);
    }
    
    destroy() {
        this.positionBuffer?.destroy();
        this.velocityBuffer?.destroy();
        this.instanceBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.sphereVertexBuffer?.destroy();
        this.sphereIndexBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// DUAL MODE RENDERER
// ============================================================================

export class DualModeRenderer {
    /**
     * @param {GPUDevice} device 
     * @param {Object} options 
     */
    constructor(device, options = {}) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Renderers
        this.particleRenderer = new ParticleRenderer(device);
        this.volumeRenderer = new VolumetricRaymarcher(device, options);
        
        // Mode
        this.viewMode = options.viewMode ?? ViewMode.HYBRID;
        this.blendFactor = 0; // 0 = particles, 1 = volume
        
        // LOD thresholds
        this.lodThresholds = { ...LOD_THRESHOLDS, ...options.lodThresholds };
        
        // Blend texture (for compositing)
        this.blendTexture = null;
        
        // Quality settings
        this.adaptiveQuality = options.adaptiveQuality ?? true;
        this.targetFrameTime = options.targetFrameTime ?? 16.67; // 60 FPS
        
        this.initialized = false;
    }
    
    /**
     * Initialize both renderers
     * @param {number} width 
     * @param {number} height 
     */
    async init(width, height) {
        await this.particleRenderer.init();
        await this.volumeRenderer.init(width, height);
        
        // Create blend texture using vGPU
        this.blendTexture = this.vgpu.texture.create({
            width, height, format: 'rgba8unorm',
            usage: 'render|texture|storage', label: 'BlendTexture'
        }).texture;
        
        this.width = width;
        this.height = height;
        this.initialized = true;
    }
    
    /**
     * Update LOD based on camera distance to volume center
     * @param {number[]} cameraPos 
     * @param {number[]} volumeCenter 
     */
    updateLOD(cameraPos, volumeCenter) {
        const dx = cameraPos[0] - volumeCenter[0];
        const dy = cameraPos[1] - volumeCenter[1];
        const dz = cameraPos[2] - volumeCenter[2];
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Compute blend factor based on distance
        if (distance < this.lodThresholds.particleOnly) {
            this.blendFactor = 0;
        } else if (distance > this.lodThresholds.volumeOnly) {
            this.blendFactor = 1;
        } else {
            const range = this.lodThresholds.blendEnd - this.lodThresholds.blendStart;
            this.blendFactor = (distance - this.lodThresholds.blendStart) / range;
            this.blendFactor = Math.max(0, Math.min(1, this.blendFactor));
        }
    }
    
    /**
     * Set view mode
     * @param {number} mode 
     */
    setViewMode(mode) {
        this.viewMode = mode;
        
        switch (mode) {
            case ViewMode.PARTICLES:
                this.blendFactor = 0;
                break;
            case ViewMode.VOLUME:
                this.blendFactor = 1;
                break;
        }
    }
    
    /**
     * Update particle data
     */
    setParticleData(positionBuffer, velocityBuffer, count) {
        this.particleRenderer.setParticleBuffers(positionBuffer, velocityBuffer, count);
    }
    
    /**
     * Update volume density
     */
    updateVolumeDensity(densityData) {
        this.volumeRenderer.updateDensityFromCPU(densityData);
    }
    
    /**
     * Render frame
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUTexture} outputTexture 
     * @param {GPUTexture} depthTexture 
     * @param {Object} camera 
     * @param {Object} bounds 
     */
    render(encoder, outputTexture, depthTexture, camera, bounds) {
        if (!this.initialized) return;
        
        const renderParticles = this.blendFactor < 1 || this.viewMode === ViewMode.PARTICLES;
        const renderVolume = this.blendFactor > 0 || this.viewMode === ViewMode.VOLUME;
        
        // Render particles if needed
        if (renderParticles && this.viewMode !== ViewMode.VOLUME) {
            const particlePass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: outputTexture.createView(),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                }],
                depthStencilAttachment: {
                    view: depthTexture.createView(),
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                    depthClearValue: 1.0,
                },
            });
            
            this.particleRenderer.render(particlePass);
            particlePass.end();
        }
        
        // Render volume if needed
        if (renderVolume && this.viewMode !== ViewMode.PARTICLES) {
            this.volumeRenderer.updateUniforms(camera, bounds);
            
            if (this.blendFactor >= 1 || this.viewMode === ViewMode.VOLUME) {
                // Direct to output
                this.volumeRenderer.render(encoder, outputTexture);
            } else {
                // Render to blend texture, then composite
                this.volumeRenderer.render(encoder, this.blendTexture);
                // Would need composite pass here
            }
        }
    }
    
    /**
     * Get current rendering stats
     */
    getStats() {
        return {
            viewMode: this.viewMode,
            blendFactor: this.blendFactor,
            particleCount: this.particleRenderer.particleCount,
        };
    }
    
    /**
     * Resize render targets
     */
    resize(width, height) {
        this.width = width;
        this.height = height;
        
        this.blendTexture?.destroy();
        this.blendTexture = this.vgpu.texture.create({
            width, height, format: 'rgba8unorm',
            usage: 'render|texture|storage', label: 'BlendTexture'
        }).texture;
    }
    
    destroy() {
        this.particleRenderer.destroy();
        this.volumeRenderer.destroy();
        this.blendTexture?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// PARTICLE SHADER
// ============================================================================

const PARTICLE_SHADER = /* wgsl */ `
struct Uniforms {
    viewProj: mat4x4f,
    cameraPos: vec3f,
    particleSize: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) localPos: vec3f,
    @location(1) localNormal: vec3f,
    @location(2) worldPos: vec3f,
    @location(3) size: f32,
    @location(4) color: vec4f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) color: vec4f,
    @location(2) worldPos: vec3f,
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Scale and translate sphere
    let worldPos = input.worldPos + input.localPos * input.size * uniforms.particleSize;
    
    output.position = uniforms.viewProj * vec4f(worldPos, 1.0);
    output.normal = input.localNormal;
    output.color = input.color;
    output.worldPos = worldPos;
    
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
    // Simple diffuse lighting
    let lightDir = normalize(vec3f(1.0, 1.0, 0.5));
    let viewDir = normalize(uniforms.cameraPos - input.worldPos);
    let halfDir = normalize(lightDir + viewDir);
    
    let diffuse = max(dot(input.normal, lightDir), 0.0);
    let specular = pow(max(dot(input.normal, halfDir), 0.0), 32.0);
    let ambient = 0.1;
    
    let lighting = ambient + diffuse * 0.7 + specular * 0.3;
    
    return vec4f(input.color.rgb * lighting, input.color.a);
}
`;

// ============================================================================
// VELOCITY-TO-COLOR MAPPING
// ============================================================================

/**
 * Map velocity to color
 * @param {number} vx 
 * @param {number} vy 
 * @param {number} vz 
 * @param {number} scale 
 * @returns {number[]} RGBA
 */
export function velocityToColor(vx, vy, vz, scale = 0.1) {
    const speed = Math.sqrt(vx*vx + vy*vy + vz*vz);
    const normalizedSpeed = Math.min(1, speed * scale);
    
    // Blue (slow) → Green → Yellow → Red (fast)
    let r, g, b;
    
    if (normalizedSpeed < 0.25) {
        const t = normalizedSpeed / 0.25;
        r = 0;
        g = t;
        b = 1;
    } else if (normalizedSpeed < 0.5) {
        const t = (normalizedSpeed - 0.25) / 0.25;
        r = 0;
        g = 1;
        b = 1 - t;
    } else if (normalizedSpeed < 0.75) {
        const t = (normalizedSpeed - 0.5) / 0.25;
        r = t;
        g = 1;
        b = 0;
    } else {
        const t = (normalizedSpeed - 0.75) / 0.25;
        r = 1;
        g = 1 - t;
        b = 0;
    }
    
    return [r, g, b, 1];
}

/**
 * Generate particle instance data from positions and velocities
 * @param {Float32Array} positions - xyz per particle
 * @param {Float32Array} velocities - xyz per particle
 * @param {number} particleSize 
 * @param {number} colorScale 
 * @returns {Float32Array} - 8 floats per particle
 */
export function generateInstanceData(positions, velocities, particleSize = 1.0, colorScale = 0.1) {
    const particleCount = positions.length / 3;
    const data = new Float32Array(particleCount * 8);
    
    for (let i = 0; i < particleCount; i++) {
        const px = positions[i * 3 + 0];
        const py = positions[i * 3 + 1];
        const pz = positions[i * 3 + 2];
        
        const vx = velocities[i * 3 + 0];
        const vy = velocities[i * 3 + 1];
        const vz = velocities[i * 3 + 2];
        
        const color = velocityToColor(vx, vy, vz, colorScale);
        
        const offset = i * 8;
        data[offset + 0] = px;
        data[offset + 1] = py;
        data[offset + 2] = pz;
        data[offset + 3] = particleSize;
        data[offset + 4] = color[0];
        data[offset + 5] = color[1];
        data[offset + 6] = color[2];
        data[offset + 7] = color[3];
    }
    
    return data;
}

export default DualModeRenderer;
