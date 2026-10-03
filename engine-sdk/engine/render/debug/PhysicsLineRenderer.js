// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PhysicsLineRenderer.js - GPU Line Rendering for Physics Objects
 * 
 * Renders ropes, wires, hair strands, and chain links using GPU instancing.
 * Supports both line primitives and tube geometry for thicker cables.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_LINE_SEGMENTS = 1000000; // ~56MB buffer (well under 512MB limit)
const WORKGROUP_SIZE = 64;

// Module-level scratch array for uniform uploads (avoids per-frame Float32Array allocation)
const _LINE_UNIFORM_DATA = new Float32Array(20); // viewProj(16) + cameraPos(3) + lineWidth(1)

// ============================================================================
// SHADERS
// ============================================================================

const LINE_SHADER = `
struct Uniforms {
    viewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    lineWidth: f32,
}

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) color: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = uniforms.viewProj * vec4<f32>(input.position, 1.0);
    output.color = input.color;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
`;

// ============================================================================
// PHYSICS LINE RENDERER CLASS
// ============================================================================

export class PhysicsLineRenderer {
    constructor(device) {
        this.device = device;
        this.initialized = false;
        
        // Line rendering
        this.lineVertexBuffer = null;
        this.lineUniformBuffer = null;
        this.linePipeline = null;
        this.lineBindGroup = null;
        this.lineVertexCount = 0;
        
        // Tube rendering
        this.tubeSegmentBuffer = null;
        this.tubeUniformBuffer = null;
        this.tubePipeline = null;
        this.tubeBindGroup = null;
        this.tubeSegmentCount = 0;
        
        // Reusable data arrays
        this._lineData = new Float32Array(MAX_LINE_SEGMENTS * 2 * 7); // pos(3) + color(4) per vertex
        this._tubeData = new Float32Array(MAX_LINE_SEGMENTS * 12); // SegmentData
    }
    
    async init(renderFormat = 'bgra8unorm', depthFormat = 'depth24plus') {
        if (this.initialized) return;
        
        // Create buffers
        this.lineVertexBuffer = this.device.createBuffer({
            label: 'PhysicsLine.vertices',
            size: this._lineData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        
        this.lineUniformBuffer = this.device.createBuffer({
            label: 'PhysicsLine.uniforms',
            size: 80, // mat4(64) + vec3(12) + f32(4)
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.tubeSegmentBuffer = this.device.createBuffer({
            label: 'PhysicsTube.segments',
            size: this._tubeData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.tubeUniformBuffer = this.device.createBuffer({
            label: 'PhysicsTube.uniforms',
            size: 80,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Create line pipeline
        const lineShaderModule = this.device.createShaderModule({
            label: 'PhysicsLine.shader',
            code: LINE_SHADER,
        });
        
        this.linePipeline = this.device.createRenderPipeline({
            label: 'PhysicsLine.pipeline',
            layout: 'auto',
            vertex: {
                module: lineShaderModule,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 28, // 7 floats
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
                        { shaderLocation: 1, offset: 12, format: 'float32x4' }, // color
                    ],
                }],
            },
            fragment: {
                module: lineShaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: renderFormat }],
            },
            primitive: {
                topology: 'line-list',
            },
            depthStencil: {
                format: depthFormat,
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
        
        this.lineBindGroup = this.device.createBindGroup({
            label: 'PhysicsLine.bindGroup',
            layout: this.linePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.lineUniformBuffer } },
            ],
        });
        
        this.initialized = true;
        console.log('[PhysicsLineRenderer] Initialized');
    }
    
    /**
     * Update line data from physics simulations
     * @param {Map} simulations - Map of entityId -> simulation data
     */
    updateFromSimulations(simulations) {
        if (!simulations || simulations.size === 0) {
            this.lineVertexCount = 0;
            return;
        }
        
        let vertexOffset = 0;
        const data = this._lineData;
        
        for (const [entityId, sim] of simulations) {
            if (sim.type === 'rope' || sim.type === 'wire' || sim.type === 'chain') {
                const particles = sim.particles;
                const color = sim.opts?.color || [0.6, 0.4, 0.2, 1];
                const radius = sim.opts?.radius || 0.05;
                
                // Draw single center line only (SDF capsules handle solid rendering)
                for (let i = 0; i < particles.length - 1; i++) {
                    const p0 = particles[i];
                    const p1 = particles[i + 1];
                    
                    // Draw single center line
                    data[vertexOffset++] = p0.x;
                    data[vertexOffset++] = p0.y;
                    data[vertexOffset++] = p0.z;
                    data[vertexOffset++] = color[0];
                    data[vertexOffset++] = color[1];
                    data[vertexOffset++] = color[2];
                    data[vertexOffset++] = color[3];
                    
                    data[vertexOffset++] = p1.x;
                    data[vertexOffset++] = p1.y;
                    data[vertexOffset++] = p1.z;
                    data[vertexOffset++] = color[0];
                    data[vertexOffset++] = color[1];
                    data[vertexOffset++] = color[2];
                    data[vertexOffset++] = color[3];
                }
            } else if (sim.type === 'hair') {
                const strands = sim.strands;
                const baseColor = sim.opts?.color || [0.2, 0.15, 0.1, 1];
                const variation = sim.opts?.colorVariation || 0.1;
                const bcR = baseColor[0], bcG = baseColor[1], bcB = baseColor[2], bcA = baseColor[3];
                
                for (let s = 0; s < strands.length; s++) {
                    const strand = strands[s];
                    const colorMod = 1 + (Math.sin(s * 1.7) * variation);
                    // Inline color scalars instead of allocating [r,g,b,a] per strand
                    const cr = bcR * colorMod, cg = bcG * colorMod, cb = bcB * colorMod;
                    
                    for (let i = 0; i < strand.length - 1; i++) {
                        const p0 = strand[i];
                        const p1 = strand[i + 1];
                        
                        data[vertexOffset++] = p0.x;
                        data[vertexOffset++] = p0.y;
                        data[vertexOffset++] = p0.z;
                        data[vertexOffset++] = cr;
                        data[vertexOffset++] = cg;
                        data[vertexOffset++] = cb;
                        data[vertexOffset++] = bcA;
                        
                        data[vertexOffset++] = p1.x;
                        data[vertexOffset++] = p1.y;
                        data[vertexOffset++] = p1.z;
                        data[vertexOffset++] = cr;
                        data[vertexOffset++] = cg;
                        data[vertexOffset++] = cb;
                        data[vertexOffset++] = bcA;
                    }
                }
            } else if (sim.type === 'softbody') {
                // Render soft body as point connections
                const particles = sim.particles;
                const color = sim.opts?.color || [0.3, 0.7, 0.4, 1];
                
                // Draw edges between nearby particles
                for (let i = 0; i < particles.length; i++) {
                    for (let j = i + 1; j < particles.length; j++) {
                        const p0 = particles[i];
                        const p1 = particles[j];
                        const dx = p1.x - p0.x;
                        const dy = p1.y - p0.y;
                        const dz = p1.z - p0.z;
                        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                        
                        if (dist < (sim.opts?.size || 1) * 0.4) {
                            data[vertexOffset++] = p0.x;
                            data[vertexOffset++] = p0.y;
                            data[vertexOffset++] = p0.z;
                            data[vertexOffset++] = color[0];
                            data[vertexOffset++] = color[1];
                            data[vertexOffset++] = color[2];
                            data[vertexOffset++] = color[3] * 0.5;
                            
                            data[vertexOffset++] = p1.x;
                            data[vertexOffset++] = p1.y;
                            data[vertexOffset++] = p1.z;
                            data[vertexOffset++] = color[0];
                            data[vertexOffset++] = color[1];
                            data[vertexOffset++] = color[2];
                            data[vertexOffset++] = color[3] * 0.5;
                        }
                    }
                }
            }
        }
        
        this.lineVertexCount = vertexOffset / 7;
        
        if (this.lineVertexCount > 0) {
            this.device.queue.writeBuffer(
                this.lineVertexBuffer, 
                0, 
                data.buffer, 
                0, 
                vertexOffset * 4
            );
        }
    }
    
    /**
     * Render physics lines
     * @param {GPURenderPassEncoder} pass - Render pass
     * @param {Float32Array} viewProjMatrix - 4x4 view-projection matrix
     * @param {number[]} cameraPos - Camera position [x, y, z]
     */
    render(pass, viewProjMatrix, cameraPos) {
        if (!this.initialized || this.lineVertexCount === 0) return;
        
        _LINE_UNIFORM_DATA.set(viewProjMatrix, 0);
        _LINE_UNIFORM_DATA[16] = cameraPos[0];
        _LINE_UNIFORM_DATA[17] = cameraPos[1];
        _LINE_UNIFORM_DATA[18] = cameraPos[2];
        _LINE_UNIFORM_DATA[19] = 2.0; // line width (not used for basic lines)
        this.device.queue.writeBuffer(this.lineUniformBuffer, 0, _LINE_UNIFORM_DATA);
        
        // Draw lines
        pass.setPipeline(this.linePipeline);
        pass.setBindGroup(0, this.lineBindGroup);
        pass.setVertexBuffer(0, this.lineVertexBuffer);
        pass.draw(this.lineVertexCount);
    }
    
    destroy() {
        if (this.lineVertexBuffer) this.lineVertexBuffer.destroy();
        if (this.lineUniformBuffer) this.lineUniformBuffer.destroy();
        if (this.tubeSegmentBuffer) this.tubeSegmentBuffer.destroy();
        if (this.tubeUniformBuffer) this.tubeUniformBuffer.destroy();
        this.initialized = false;
    }
}

export default PhysicsLineRenderer;
