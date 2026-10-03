// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WireframeBoxRenderer - Renders wireframe boxes for debug visualization
 * Used to visualize voxel colliders in the editor
 * Now powered by vGPU driver
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const WIREFRAME_SHADER = `
struct Uniforms {
    viewProj: mat4x4<f32>,
    color: vec4<f32>,
    cameraPos: vec3<f32>,
    maxDistance: f32,
    time: f32,
    glowIntensity: f32,
    padding: vec2<f32>,
}

struct BoxInstance {
    position: vec3<f32>,
    contactGlow: f32,
    halfExtents: vec3<f32>,
    padding: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> boxes: array<BoxInstance>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) worldPos: vec3<f32>,
    @location(2) localPos: vec3<f32>,
    @location(3) contactGlow: f32,
}

// 24 line vertices for a wireframe box (12 edges, 2 vertices each)
const BOX_LINES: array<vec3<f32>, 24> = array<vec3<f32>, 24>(
    // Bottom face
    vec3<f32>(-1, -1, -1), vec3<f32>(1, -1, -1),
    vec3<f32>(1, -1, -1), vec3<f32>(1, -1, 1),
    vec3<f32>(1, -1, 1), vec3<f32>(-1, -1, 1),
    vec3<f32>(-1, -1, 1), vec3<f32>(-1, -1, -1),
    // Top face
    vec3<f32>(-1, 1, -1), vec3<f32>(1, 1, -1),
    vec3<f32>(1, 1, -1), vec3<f32>(1, 1, 1),
    vec3<f32>(1, 1, 1), vec3<f32>(-1, 1, 1),
    vec3<f32>(-1, 1, 1), vec3<f32>(-1, 1, -1),
    // Vertical edges
    vec3<f32>(-1, -1, -1), vec3<f32>(-1, 1, -1),
    vec3<f32>(1, -1, -1), vec3<f32>(1, 1, -1),
    vec3<f32>(1, -1, 1), vec3<f32>(1, 1, 1),
    vec3<f32>(-1, -1, 1), vec3<f32>(-1, 1, 1),
);

@vertex
fn vertexMain(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    var output: VertexOutput;
    
    let box = boxes[instanceIndex];
    let localPos = BOX_LINES[vertexIndex];
    
    // Scale by half extents and translate
    let worldPos = box.position + localPos * box.halfExtents;
    
    output.position = uniforms.viewProj * vec4<f32>(worldPos, 1.0);
    output.worldPos = worldPos;
    output.localPos = localPos;
    output.color = uniforms.color;
    output.contactGlow = box.contactGlow;
    
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    // Distance-based fade
    let dist = length(input.worldPos - uniforms.cameraPos);
    let distFade = 1.0 - smoothstep(0.0, uniforms.maxDistance, dist);
    
    // Subtle pulse animation (Tron-style energy flow)
    let pulse = 0.85 + 0.15 * sin(uniforms.time * 2.0 + input.worldPos.y * 3.0);
    
    // Contact detection
    let isContact = input.contactGlow > 0.5;
    
    // Base color with height variation
    let heightFactor = (input.localPos.y + 1.0) * 0.5;
    let baseColor = input.color.rgb;
    let tintColor = vec3<f32>(0.6, 0.2, 1.0); // Purple tint
    var finalColor = mix(baseColor, tintColor, heightFactor * 0.3);
    
    // Contact voxels: solid bright orange/yellow, no flashing
    if (isContact) {
        finalColor = vec3<f32>(1.0, 0.7, 0.0); // Bright orange-yellow
        let alpha = 0.9 * distFade; // Solid, high opacity
        return vec4<f32>(finalColor * 1.5, alpha);
    }
    
    // Normal wireframe rendering
    let glowBoost = uniforms.glowIntensity * pulse;
    let neonColor = finalColor * (1.0 + glowBoost * 0.5);
    let clampedColor = min(neonColor, vec3<f32>(1.5, 1.5, 1.5));
    let alpha = input.color.a * distFade * pulse;
    
    if (alpha < 0.01) {
        discard;
    }
    
    return vec4<f32>(clampedColor, alpha);
}
`;

export class WireframeBoxRenderer {
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.pipeline = null;
        this.uniformBuffer = null;
        this.boxBuffer = null;
        this.bindGroup = null;
        this.uniformData = new Float32Array(32);
        this.maxBoxes = 4096;
        this.boxData = new Float32Array(this.maxBoxes * 8);
        this.boxCount = 0;
        
        this.color = [0.0, 1.0, 0.85, 0.95];
        this.maxDistance = 60.0;
        this.glowIntensity = 1.2;
        this.time = 0;
    }
    
    async initialize(format) {
        const shaderModule = this.vgpu.shader.compile('wireframeBox', WIREFRAME_SHADER);
        
        // Create buffers using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: this.uniformData.byteLength, usage: 'uniform', label: 'WireframeUniforms' }).buffer;
        this.boxBuffer = this.vgpu.buffer.create({ size: this.boxData.byteLength, usage: 'storage', label: 'WireframeBoxes' }).buffer;
        
        // Create bind group layout using vGPU
        const bindGroupLayout = this.vgpu.bindings.defineLayout('wireframeBox', [
            { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
            { binding: 1, type: 'read-storage', visibility: 'vertex' }
        ]);
        
        // Create bind group using vGPU
        this.bindGroup = this.vgpu.bindings.createGroup(bindGroupLayout, [
            { binding: 0, buffer: this.uniformBuffer },
            { binding: 1, buffer: this.boxBuffer }
        ]);
        
        // Create pipeline using vGPU
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vertexMain' },
            fragment: { module: shaderModule, entryPoint: 'fragmentMain' },
            layouts: [bindGroupLayout],
            colorFormat: format,
            blend: 'alpha',
            topology: 'line-list',
            depthFormat: 'depth24plus',
            depthWrite: false,
            depthCompare: 'less-equal',
            label: 'WireframeBoxPipeline'
        });
    }
    
    /**
     * Clear boxes for this frame
     */
    beginFrame() {
        this.boxCount = 0;
    }
    
    /**
     * Add a wireframe box to render
     * @param {number[]} position - [x, y, z] world position
     * @param {number[]} halfExtents - [hx, hy, hz] half extents
     * @param {number} contactGlow - 0-1 glow intensity for contact highlighting
     */
    addBox(position, halfExtents, contactGlow = 0) {
        if (this.boxCount >= this.maxBoxes) return;
        
        const offset = this.boxCount * 8;
        this.boxData[offset + 0] = position[0];
        this.boxData[offset + 1] = position[1];
        this.boxData[offset + 2] = position[2];
        this.boxData[offset + 3] = contactGlow; // contact glow intensity
        this.boxData[offset + 4] = halfExtents[0];
        this.boxData[offset + 5] = halfExtents[1];
        this.boxData[offset + 6] = halfExtents[2];
        this.boxData[offset + 7] = 0; // padding
        
        this.boxCount++;
    }
    
    /**
     * Render all accumulated boxes
     * @param {GPURenderPassEncoder} passEncoder
     * @param {Float32Array} viewProjMatrix
     * @param {number[]} cameraPos - Camera position [x, y, z]
     */
    render(passEncoder, viewProjMatrix, cameraPos = [0, 0, 10]) {
        if (!this.pipeline || this.boxCount === 0) return;
        
        // Update time for animation
        this.time += 0.016; // ~60fps
        
        // Update uniforms
        this.uniformData.set(viewProjMatrix, 0);
        this.uniformData.set(this.color, 16);
        this.uniformData[20] = cameraPos[0];
        this.uniformData[21] = cameraPos[1];
        this.uniformData[22] = cameraPos[2];
        this.uniformData[23] = this.maxDistance;
        this.uniformData[24] = this.time;
        this.uniformData[25] = this.glowIntensity;
        this.uniformData[26] = 0; // padding
        this.uniformData[27] = 0; // padding
        this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
        
        // Update box buffer
        this.device.queue.writeBuffer(this.boxBuffer, 0, this.boxData, 0, this.boxCount * 8);
        
        // Draw
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.draw(24, this.boxCount, 0, 0); // 24 vertices per box (12 edges * 2)
    }
    
    destroy() {
        if (this.uniformBuffer) this.uniformBuffer.destroy();
        if (this.boxBuffer) this.boxBuffer.destroy();
    }
}
