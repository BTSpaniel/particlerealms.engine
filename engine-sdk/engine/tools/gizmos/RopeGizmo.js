// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RopeGizmo - Visual handles for manipulating rope attachment points
 * 
 * Features:
 * - Draggable spheres at start/end attachment points
 * - Catenary curve visualization between endpoints
 * - Entity snapping when dragging near entities
 * - Visual feedback for hover/drag states
 * 
 * Based on common patterns from Unity/Unreal constraint gizmos:
 * - Anchor points shown as spherical handles
 * - Lines/curves connecting attachment points
 * - Snapping to nearby entities for easy attachment
 */

import { raySphere } from '../../core/math/MathGeometry.js';
import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const ROPE_GIZMO_SHADER = `
struct Uniforms {
    viewProj: mat4x4<f32>,
    model: mat4x4<f32>,
    color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) worldPos: vec3<f32>,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let worldPos = uniforms.model * vec4<f32>(input.position, 1.0);
    output.position = uniforms.viewProj * worldPos;
    output.color = uniforms.color;
    output.worldPos = worldPos.xyz;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    // Simple lit shading
    let lightDir = normalize(vec3<f32>(0.5, 0.8, 0.3));
    let normal = normalize(input.worldPos);
    let diffuse = max(dot(normal, lightDir), 0.0) * 0.4 + 0.6;
    return vec4<f32>(input.color.rgb * diffuse, input.color.a);
}
`;

// Reusable matrix buffer
const _modelMatrix = new Float32Array(16);

export class RopeGizmo {
    constructor(device) {
        this.device = device;
        this.vgpu = null;
        this.pipeline = null;
        this.linePipeline = null;
        this.sphereGeometry = null;
        this.lineGeometry = null;
        
        // State
        this.hoveredHandle = null; // 'start', 'end', or null
        this.draggedHandle = null; // 'start', 'end', or null
        this.animTime = 0;
        
        // Handle positions (set externally)
        this.startPosition = [0, 0, 0];
        this.endPosition = [0, 0, 0];
        
        // Snap state
        this.snapTarget = null; // { entityId, position }
        this.snapRadius = 0.5; // World units to snap
        
        // Visual settings
        this.handleRadius = 0.25;  // Larger handles for better visibility
        this.startColor = [0.2, 1.0, 0.3, 1.0]; // Bright green for start
        this.endColor = [1.0, 0.3, 0.2, 1.0];   // Bright red for end
        this.lineColor = [1.0, 0.8, 0.2, 0.9];  // Yellow/gold for visibility
        this.snapColor = [0.3, 0.7, 1.0, 0.9];  // Blue for snap indicator
        
        // Uniform data buffer
        this.uniformData = new Float32Array(36); // viewProj(16) + model(16) + color(4)
    }
    
    async initialize(format) {
        this.vgpu = initVGPU(this.device);
        
        const shaderModule = this.device.createShaderModule({
            code: ROPE_GIZMO_SHADER,
            label: 'RopeGizmoShader'
        });
        
        // Create uniform buffers
        const uniformSize = 36 * 4; // 36 floats
        this.uniformBufferStart = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'RopeStart' }).buffer;
        this.uniformBufferEnd = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'RopeEnd' }).buffer;
        this.uniformBufferLine = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'RopeLine' }).buffer;
        this.uniformBufferSnap = this.vgpu.buffer.create({ size: uniformSize, usage: 'uniform', label: 'RopeSnap' }).buffer;
        
        // Create bind group layout
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('ropeGizmo', [{
            binding: 0, type: 'uniform', visibility: 'vertex|fragment'
        }]);
        
        // Create bind groups
        this.bindGroupStart = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferStart }]);
        this.bindGroupEnd = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferEnd }]);
        this.bindGroupLine = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferLine }]);
        this.bindGroupSnap = this.vgpu.bindings.createGroup(this.bindGroupLayout, [{ binding: 0, buffer: this.uniformBufferSnap }]);
        
        // Vertex layout
        const vertexLayout = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }];
        
        // Triangle pipeline for spheres
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vertexMain' },
            fragment: { module: shaderModule, entryPoint: 'fragmentMain' },
            vertexLayout,
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            blend: 'alpha',
            cullMode: 'back',
            depthFormat: 'depth24plus',
            depthWrite: false,
            depthCompare: 'always',
            label: 'RopeGizmoPipeline'
        });
        
        // Line pipeline for rope visualization
        this.linePipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vertexMain' },
            fragment: { module: shaderModule, entryPoint: 'fragmentMain' },
            vertexLayout,
            layouts: [this.bindGroupLayout],
            colorFormat: format,
            topology: 'line-strip',
            cullMode: 'none',
            depthFormat: 'depth24plus',
            depthWrite: false,
            depthCompare: 'always',
            label: 'RopeGizmoLinePipeline'
        });
        
        // Create geometries
        this.sphereGeometry = this.createSphereGeometry();
        this.lineGeometry = this.createLineGeometry();
    }
    
    createSphereGeometry() {
        const vertices = [];
        const radius = 1.0; // Unit sphere, scaled at render time
        const segments = 16;
        const rings = 12;
        
        for (let ring = 0; ring < rings; ring++) {
            const theta1 = (ring / rings) * Math.PI;
            const theta2 = ((ring + 1) / rings) * Math.PI;
            
            for (let seg = 0; seg < segments; seg++) {
                const phi1 = (seg / segments) * Math.PI * 2;
                const phi2 = ((seg + 1) / segments) * Math.PI * 2;
                
                // Two triangles per quad
                vertices.push(
                    radius * Math.sin(theta1) * Math.cos(phi1),
                    radius * Math.cos(theta1),
                    radius * Math.sin(theta1) * Math.sin(phi1)
                );
                vertices.push(
                    radius * Math.sin(theta2) * Math.cos(phi1),
                    radius * Math.cos(theta2),
                    radius * Math.sin(theta2) * Math.sin(phi1)
                );
                vertices.push(
                    radius * Math.sin(theta2) * Math.cos(phi2),
                    radius * Math.cos(theta2),
                    radius * Math.sin(theta2) * Math.sin(phi2)
                );
                
                vertices.push(
                    radius * Math.sin(theta1) * Math.cos(phi1),
                    radius * Math.cos(theta1),
                    radius * Math.sin(theta1) * Math.sin(phi1)
                );
                vertices.push(
                    radius * Math.sin(theta2) * Math.cos(phi2),
                    radius * Math.cos(theta2),
                    radius * Math.sin(theta2) * Math.sin(phi2)
                );
                vertices.push(
                    radius * Math.sin(theta1) * Math.cos(phi2),
                    radius * Math.cos(theta1),
                    radius * Math.sin(theta1) * Math.sin(phi2)
                );
            }
        }
        
        const vertexData = new Float32Array(vertices);
        const { buffer } = this.vgpu.buffer.create({ size: vertexData.byteLength, usage: 'vertex', data: vertexData });
        
        return { buffer, vertexCount: vertices.length / 3 };
    }
    
    createLineGeometry() {
        // Create a catenary curve approximation with 32 segments
        // Actual positions will be set dynamically
        const segments = 32;
        // Initialize with zeros - will be updated before first render
        const vertices = new Float32Array(segments * 3);
        
        const { buffer } = this.vgpu.buffer.create({ 
            size: vertices.byteLength, 
            usage: 'vertex|copy_dst', 
            data: vertices,
            label: 'RopeLineVertices'
        });
        
        return { buffer, vertexCount: segments, initialized: false };
    }
    
    /**
     * Update line geometry with proper catenary curve based on rope length
     * @param {number[]} startPos - Start position [x,y,z]
     * @param {number[]} endPos - End position [x,y,z]
     * @param {number} ropeLength - Total rope length (if > distance, rope has slack)
     */
    updateLineGeometry(startPos, endPos, ropeLength = 0) {
        if (!this.lineGeometry) return;
        
        const segments = this.lineGeometry.vertexCount;
        const vertices = new Float32Array(segments * 3);
        
        // Calculate distance between endpoints
        const dx = endPos[0] - startPos[0];
        const dy = endPos[1] - startPos[1];
        const dz = endPos[2] - startPos[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Calculate slack (extra rope beyond straight-line distance)
        // ropeLength must be >= dist for physical rope
        const effectiveLength = Math.max(ropeLength, dist * 1.01); // At least 1% slack minimum
        const slack = effectiveLength - dist;
        
        // Calculate catenary parameter 'a' using Newton-Raphson iteration
        // For catenary: length = 2a * sinh(d/(2a)) where d is horizontal distance
        // We solve for 'a' given length and distance
        let a = dist * 0.5; // Initial guess
        const horizontalDist = Math.sqrt(dx*dx + dz*dz); // Horizontal span
        
        if (slack > 0.001 && horizontalDist > 0.001) {
            // Newton-Raphson to find catenary parameter 'a'
            for (let iter = 0; iter < 10; iter++) {
                const sinh_val = Math.sinh(horizontalDist / (2 * a));
                const cosh_val = Math.cosh(horizontalDist / (2 * a));
                const f = 2 * a * sinh_val - effectiveLength;
                const df = 2 * sinh_val - (horizontalDist * cosh_val) / a;
                if (Math.abs(df) < 1e-10) break;
                const delta = f / df;
                a -= delta;
                if (Math.abs(delta) < 1e-6) break;
                a = Math.max(a, 0.01); // Prevent negative/zero
            }
        }
        
        // Calculate the lowest point of catenary (sag depth)
        const sagDepth = slack > 0.001 ? a * (Math.cosh(horizontalDist / (2 * a)) - 1) : 0;
        
        for (let i = 0; i < segments; i++) {
            const t = i / (segments - 1);
            
            // Linear interpolation for base position
            let x = startPos[0] + dx * t;
            let y = startPos[1] + dy * t;
            let z = startPos[2] + dz * t;
            
            // Apply catenary sag in world Y direction
            // Catenary formula: sag = a * (cosh(x/a) - 1) normalized to our span
            if (slack > 0.001 && a > 0.01) {
                // Map t to catenary x coordinate (-d/2 to d/2)
                const catX = (t - 0.5) * horizontalDist;
                // Catenary y offset (relative to lowest point)
                const catY = a * (Math.cosh(catX / a) - 1);
                // Invert and offset so sag goes downward from the line
                const sagAmount = sagDepth - catY;
                y -= sagAmount;
            }
            
            vertices[i * 3 + 0] = x;
            vertices[i * 3 + 1] = y;
            vertices[i * 3 + 2] = z;
        }
        
        this.device.queue.writeBuffer(this.lineGeometry.buffer, 0, vertices);
        this.lineGeometry.initialized = true;
    }
    
    /**
     * Hit test against rope handles
     * @returns 'start', 'end', or null
     */
    hitTest(rayOrigin, rayDir, startPos, endPos) {
        // Use larger hit radius for easier clicking
        const hitRadius = this.handleRadius * 2.5;
        
        // Test start handle
        const hitStart = raySphere(rayOrigin, rayDir, startPos, hitRadius);
        if (hitStart && hitStart.t > 0) {
            // Check if end is closer
            const hitEnd = raySphere(rayOrigin, rayDir, endPos, hitRadius);
            if (hitEnd && hitEnd.t > 0 && hitEnd.t < hitStart.t) {
                return 'end';
            }
            return 'start';
        }
        
        // Test end handle
        const hitEnd = raySphere(rayOrigin, rayDir, endPos, hitRadius);
        if (hitEnd && hitEnd.t > 0) {
            return 'end';
        }
        
        return null;
    }
    
    /**
     * Find nearest entity to snap to
     */
    findSnapTarget(position, entities, excludeIds = []) {
        let closest = null;
        let closestDist = this.snapRadius;
        
        for (const [entityId, meta] of entities) {
            if (excludeIds.includes(entityId)) continue;
            
            // Skip non-physical entities
            const spawnId = meta.spawnId || '';
            if (spawnId.startsWith('emitter_')) continue;
            
            // Get entity position from transform
            const transform = meta.transform;
            if (!transform?.position) continue;
            
            const pos = transform.position;
            const dx = pos[0] - position[0];
            const dy = pos[1] - position[1];
            const dz = pos[2] - position[2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            if (dist < closestDist) {
                closestDist = dist;
                closest = { entityId, position: [...pos], name: meta.name };
            }
        }
        
        return closest;
    }
    
    /**
     * Render the rope gizmo
     * @param {GPURenderPassEncoder} passEncoder
     * @param {Float32Array} viewProjMatrix
     * @param {number[]} startPos
     * @param {number[]} endPos
     * @param {number} ropeLength - Total rope length for catenary calculation
     * @param {number} dt - Delta time for animations
     */
    render(passEncoder, viewProjMatrix, startPos, endPos, ropeLength = 0, dt = 0.016) {
        if (!this.pipeline || !this.sphereGeometry) {
            console.warn('[RopeGizmo] Not initialized - pipeline:', !!this.pipeline, 'geometry:', !!this.sphereGeometry);
            return;
        }
        
        // Validate positions
        if (!startPos || !endPos || startPos.length < 3 || endPos.length < 3) {
            console.warn('[RopeGizmo] Invalid positions:', startPos, endPos);
            return;
        }
        
        this.animTime += dt;
        
        // Update line geometry with catenary based on rope length/slack
        this.updateLineGeometry(startPos, endPos, ropeLength);
        
        // Render catenary line
        passEncoder.setPipeline(this.linePipeline);
        this.renderLine(passEncoder, viewProjMatrix);
        
        // Render handle spheres
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setVertexBuffer(0, this.sphereGeometry.buffer);
        
        this.renderHandle(passEncoder, viewProjMatrix, startPos, 'start', this.bindGroupStart, this.uniformBufferStart);
        this.renderHandle(passEncoder, viewProjMatrix, endPos, 'end', this.bindGroupEnd, this.uniformBufferEnd);
        
        // Render snap indicator if snapping
        if (this.snapTarget && this.draggedHandle) {
            this.renderSnapIndicator(passEncoder, viewProjMatrix, this.snapTarget.position);
        }
    }
    
    renderHandle(passEncoder, viewProjMatrix, position, handleId, bindGroup, uniformBuffer) {
        const isHovered = this.hoveredHandle === handleId;
        const isDragged = this.draggedHandle === handleId;
        const isActive = isHovered || isDragged;
        
        // Pulse animation
        const pulseSpeed = isDragged ? 8.0 : 4.0;
        const pulseAmount = isDragged ? 0.25 : 0.1;
        const pulse = isActive ? 1.0 + Math.sin(this.animTime * pulseSpeed) * pulseAmount : 1.0;
        
        const scale = this.handleRadius * pulse;
        
        // Build model matrix
        const modelMatrix = _modelMatrix;
        modelMatrix.fill(0);
        modelMatrix[0] = scale;
        modelMatrix[5] = scale;
        modelMatrix[10] = scale;
        modelMatrix[15] = 1;
        modelMatrix[12] = position[0];
        modelMatrix[13] = position[1];
        modelMatrix[14] = position[2];
        
        // Set uniforms
        this.uniformData.set(viewProjMatrix, 0);
        this.uniformData.set(modelMatrix, 16);
        
        // Color based on handle type and state
        let color = handleId === 'start' ? this.startColor : this.endColor;
        if (isDragged && this.snapTarget) {
            color = this.snapColor;
        }
        
        const brightness = isActive ? 1.3 : 1.0;
        this.uniformData[32] = color[0] * brightness;
        this.uniformData[33] = color[1] * brightness;
        this.uniformData[34] = color[2] * brightness;
        this.uniformData[35] = color[3];
        
        this.device.queue.writeBuffer(uniformBuffer, 0, this.uniformData);
        
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(this.sphereGeometry.vertexCount, 1, 0, 0);
    }
    
    renderLine(passEncoder, viewProjMatrix) {
        if (!this.lineGeometry || !this.lineGeometry.initialized) return;
        
        // Identity model matrix for line (vertices are in world space)
        const modelMatrix = _modelMatrix;
        modelMatrix.fill(0);
        modelMatrix[0] = 1;
        modelMatrix[5] = 1;
        modelMatrix[10] = 1;
        modelMatrix[15] = 1;
        
        this.uniformData.set(viewProjMatrix, 0);
        this.uniformData.set(modelMatrix, 16);
        
        // Line color with slight pulse
        const pulse = 0.9 + Math.sin(this.animTime * 2) * 0.1;
        this.uniformData[32] = this.lineColor[0] * pulse;
        this.uniformData[33] = this.lineColor[1] * pulse;
        this.uniformData[34] = this.lineColor[2] * pulse;
        this.uniformData[35] = this.lineColor[3];
        
        this.device.queue.writeBuffer(this.uniformBufferLine, 0, this.uniformData);
        
        passEncoder.setVertexBuffer(0, this.lineGeometry.buffer);
        passEncoder.setBindGroup(0, this.bindGroupLine);
        passEncoder.draw(this.lineGeometry.vertexCount, 1, 0, 0);
    }
    
    renderSnapIndicator(passEncoder, viewProjMatrix, position) {
        // Render a pulsing ring/sphere at snap target
        const pulse = 1.0 + Math.sin(this.animTime * 10) * 0.3;
        const scale = this.handleRadius * 1.5 * pulse;
        
        const modelMatrix = _modelMatrix;
        modelMatrix.fill(0);
        modelMatrix[0] = scale;
        modelMatrix[5] = scale;
        modelMatrix[10] = scale;
        modelMatrix[15] = 1;
        modelMatrix[12] = position[0];
        modelMatrix[13] = position[1];
        modelMatrix[14] = position[2];
        
        this.uniformData.set(viewProjMatrix, 0);
        this.uniformData.set(modelMatrix, 16);
        
        this.uniformData[32] = this.snapColor[0];
        this.uniformData[33] = this.snapColor[1];
        this.uniformData[34] = this.snapColor[2];
        this.uniformData[35] = 0.4; // Semi-transparent
        
        this.device.queue.writeBuffer(this.uniformBufferSnap, 0, this.uniformData);
        
        passEncoder.setVertexBuffer(0, this.sphereGeometry.buffer);
        passEncoder.setBindGroup(0, this.bindGroupSnap);
        passEncoder.draw(this.sphereGeometry.vertexCount, 1, 0, 0);
    }
}
