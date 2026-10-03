// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WorldParticleRenderer.js - Simple Billboard Particle Renderer
 * Now powered by vGPU driver
 * 
 * Renders destruction particles as colored quads facing the camera.
 */

import { initVGPU } from '../core/gpu/VirtualGPU.js';
import { MATERIAL, MATERIAL_COLORS } from '../voxel/MaterialSchema.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _worldParticleFrameData = new Float32Array(32);
let _worldParticleInstanceCapacity = 256;
let _worldParticleInstanceData = new Float32Array(_worldParticleInstanceCapacity * 8);

function ensureWorldParticleCapacity(count) {
    if (count <= _worldParticleInstanceCapacity) return;
    while (_worldParticleInstanceCapacity < count) {
        _worldParticleInstanceCapacity *= 2;
    }
    _worldParticleInstanceData = new Float32Array(_worldParticleInstanceCapacity * 8);
}

// ============================================================================
// SHADER
// ============================================================================

const PARTICLE_SHADER = /* wgsl */ `
struct FrameUniforms {
    viewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    cameraRight: vec3<f32>,
    cameraUp: vec3<f32>,
    time: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

struct ParticleData {
    position: vec3<f32>,
    size: f32,
    color: vec4<f32>,
}

@group(1) @binding(0) var<storage, read> particles: array<ParticleData>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
}

@vertex
fn vs_main(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    var output: VertexOutput;
    
    let particle = particles[instanceIndex];
    
    // Quad corners (billboard)
    var corners = array<vec2<f32>, 4>(
        vec2<f32>(-0.5, -0.5),
        vec2<f32>(0.5, -0.5),
        vec2<f32>(0.5, 0.5),
        vec2<f32>(-0.5, 0.5)
    );
    
    // Triangle indices for quad
    var indices = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
    let cornerIndex = indices[vertexIndex];
    let corner = corners[cornerIndex];
    
    // Billboard position
    let worldPos = particle.position 
        + frame.cameraRight * corner.x * particle.size
        + frame.cameraUp * corner.y * particle.size;
    
    output.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
    output.uv = corner + 0.5;
    output.color = particle.color;
    
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Simple circular particle
    let dist = length(input.uv - 0.5) * 2.0;
    if (dist > 1.0) {
        discard;
    }
    
    // Soft edge
    let alpha = 1.0 - smoothstep(0.5, 1.0, dist);
    
    return vec4<f32>(input.color.rgb, input.color.a * alpha);
}
`;

// ============================================================================
// PARTICLE RENDERER
// ============================================================================

const MAX_PARTICLES = 10000;

export class WorldParticleRenderer {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.pipeline = null;
        this.frameUniformBuffer = null;
        this.frameBindGroup = null;
        this.particleBuffer = null;
        this.particleBindGroup = null;
        this.frameBindGroupLayout = null;
        this.particleBindGroupLayout = null;
        this.initialized = false;
    }
    
    async init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Compile shader using vGPU
        const shaderModule = this.vgpu.shader.compile('worldParticle', PARTICLE_SHADER);
        
        // Define layouts using vGPU
        this.frameBindGroupLayout = this.vgpu.bindings.defineLayout('worldParticleFrame', [
            { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
        ]);
        
        this.particleBindGroupLayout = this.vgpu.bindings.defineLayout('worldParticleData', [
            { binding: 0, type: 'read-storage', visibility: 'vertex' },
        ]);
        
        // Create pipeline using vGPU
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vs_main' },
            fragment: { module: shaderModule, entryPoint: 'fs_main' },
            layouts: [this.frameBindGroupLayout, this.particleBindGroupLayout],
            colorFormat: navigator.gpu.getPreferredCanvasFormat(),
            blend: 'alpha',
            topology: 'triangle-list',
            depthFormat: 'depth24plus',
            depthWrite: false,
            depthCompare: 'less',
            label: 'WorldParticlePipeline'
        });
        
        // Create buffers using vGPU
        this.frameUniformBuffer = this.vgpu.buffer.create({ size: 128, usage: 'uniform', label: 'WorldParticleFrameUniforms' }).buffer;
        this.particleBuffer = this.vgpu.buffer.create({ size: MAX_PARTICLES * 32, usage: 'storage', label: 'WorldParticleData' }).buffer;
        
        // Create bind groups using vGPU
        this.frameBindGroup = this.vgpu.bindings.createGroup(this.frameBindGroupLayout, [
            { binding: 0, buffer: this.frameUniformBuffer },
        ], 'WorldParticleFrameBindGroup');
        
        this.particleBindGroup = this.vgpu.bindings.createGroup(this.particleBindGroupLayout, [
            { binding: 0, buffer: this.particleBuffer },
        ], 'WorldParticleDataBindGroup');
        
        this.initialized = true;
    }
    
    /**
     * Update frame uniforms
     */
    updateFrameUniforms(viewProj, cameraPos, cameraRight, cameraUp, time) {
        const data = _worldParticleFrameData;  // Reuse buffer
        data.set(viewProj, 0);           // 0-15: viewProj
        data[16] = cameraPos[0];         // 16: cameraPos.x
        data[17] = cameraPos[1];         // 17: cameraPos.y
        data[18] = cameraPos[2];         // 18: cameraPos.z
        data[19] = 0;                    // padding
        data[20] = cameraRight[0];       // 20: cameraRight.x
        data[21] = cameraRight[1];       // 21: cameraRight.y
        data[22] = cameraRight[2];       // 22: cameraRight.z
        data[23] = 0;                    // padding
        data[24] = cameraUp[0];          // 24: cameraUp.x
        data[25] = cameraUp[1];          // 25: cameraUp.y
        data[26] = cameraUp[2];          // 26: cameraUp.z
        data[27] = time;                 // 27: time
        
        this.device.queue.writeBuffer(this.frameUniformBuffer, 0, data);
    }
    
    /**
     * Upload particle data
     * @param {Array} particles - Array of { x, y, z, material, life }
     */
    uploadParticles(particles) {
        if (particles.length === 0) return 0;
        
        const count = Math.min(particles.length, MAX_PARTICLES);
        ensureWorldParticleCapacity(count);
        const data = _worldParticleInstanceData; // Reuse dynamic buffer
        
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const color = MATERIAL_COLORS[p.material] || MATERIAL_COLORS[MATERIAL.STONE];
            const baseIdx = i * 8;
            
            // Density affects size (denser = bigger particle)
            const density = p.density !== undefined ? p.density : 1.0;
            const densityScale = Math.sqrt(density);  // sqrt for visual scaling
            
            // Position
            data[baseIdx + 0] = p.x;
            data[baseIdx + 1] = p.y;
            data[baseIdx + 2] = p.z;
            // Size (scales with density and life)
            data[baseIdx + 3] = 0.3 * densityScale * Math.min(1, p.life);
            // Color RGBA
            data[baseIdx + 4] = color[0] / 255;
            data[baseIdx + 5] = color[1] / 255;
            data[baseIdx + 6] = color[2] / 255;
            data[baseIdx + 7] = Math.min(1, p.life) * (color[3] / 255);
        }
        
        this.device.queue.writeBuffer(this.particleBuffer, 0, data);
        return count;
    }
    
    /**
     * Render particles
     */
    render(pass, particleCount) {
        if (!this.initialized || particleCount === 0) return;
        
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.frameBindGroup);
        pass.setBindGroup(1, this.particleBindGroup);
        
        // 6 vertices per quad (2 triangles), instanced
        pass.draw(6, particleCount);
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [world_particles] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.maxCount = parseInt(cfg.max_count) || 100000;
        this.size = parseFloat(cfg.size) || 0.1;
        this.physicsEnabled = cfg.physics_enabled !== false;
    }
    
    destroy() {
        if (this.frameUniformBuffer) this.frameUniformBuffer.destroy();
        if (this.particleBuffer) this.particleBuffer.destroy();
        this.initialized = false;
    }
}

export default WorldParticleRenderer;
