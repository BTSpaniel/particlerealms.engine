// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RopeGPURenderer.js - GPU-driven rope/tube mesh generation
 * 
 * Generates tube geometry from rope particle positions entirely on the GPU.
 * Reads particle positions from the simulation buffer and outputs vertex data
 * for rendering as a triangle mesh.
 * 
 * Features:
 * - Compute shader generates tube vertices from particle chain
 * - Configurable tube radius and segment count
 * - Automatic tangent/normal/binormal frame calculation
 * - Twist-resistant frame propagation (parallel transport)
 * - Indirect draw support for variable-length ropes
 */

import { createStorageBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";

const ROPE_TUBE_COMPUTE_SHADER = `
struct RopeParams {
  particleStart: u32,
  particleCount: u32,
  tubeSegments: u32,
  tubeRadius: f32,
  vertexOffset: u32,
  indexOffset: u32,
  constraintStart: u32,
  hasConstraints: u32,
};

struct DrawIndirect {
  vertexCount: u32,
  instanceCount: u32,
  firstVertex: u32,
  firstInstance: u32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: RopeParams;
@group(0) @binding(2) var<storage, read_write> vertexPositions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> vertexNormals: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> vertexUVs: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> indices: array<u32>;
@group(0) @binding(6) var<storage, read_write> drawIndirect: DrawIndirect;
@group(0) @binding(7) var<storage, read> constraintWords: array<u32>;

fn broken(edge: u32) -> bool {
  if (params.hasConstraints == 0u) { return false; }
  return (constraintWords[(params.constraintStart + edge) * 16u + 15u] & 1u) != 0u;
}

fn safeNormalize(v: vec3<f32>) -> vec3<f32> {
  let len = length(v);
  if (len < 0.0001) {
    return vec3<f32>(0.0, 1.0, 0.0);
  }
  return v / len;
}

fn perpendicular(v: vec3<f32>) -> vec3<f32> {
  let absV = abs(v);
  if (absV.x <= absV.y && absV.x <= absV.z) {
    return vec3<f32>(0.0, -v.z, v.y);
  } else if (absV.y <= absV.z) {
    return vec3<f32>(-v.z, 0.0, v.x);
  } else {
    return vec3<f32>(-v.y, v.x, 0.0);
  }
}

@compute @workgroup_size(64)
fn generateVertices(@builtin(global_invocation_id) gid: vec3<u32>) {
  let segmentIdx = gid.x;
  if (segmentIdx >= params.particleCount) {
    return;
  }
  
  let particleIdx = params.particleStart + segmentIdx;
  let pos = positions[particleIdx].xyz;
  
  // Calculate tangent from neighbors
  var tangent: vec3<f32>;
  let hasPrevious = segmentIdx > 0u && !broken(segmentIdx - 1u);
  let hasNext = segmentIdx + 1u < params.particleCount && !broken(segmentIdx);
  if (!hasPrevious && !hasNext) {
    tangent = vec3<f32>(0.0, 1.0, 0.0);
  } else if (!hasPrevious) {
    let nextPos = positions[particleIdx + 1u].xyz;
    tangent = safeNormalize(nextPos - pos);
  } else if (!hasNext) {
    let prevPos = positions[particleIdx - 1u].xyz;
    tangent = safeNormalize(pos - prevPos);
  } else {
    let prevPos = positions[particleIdx - 1u].xyz;
    let nextPos = positions[particleIdx + 1u].xyz;
    tangent = safeNormalize(nextPos - prevPos);
  }
  
  // Build orthonormal frame (Frenet-like but twist-resistant)
  let up = vec3<f32>(0.0, 1.0, 0.0);
  var binormal = safeNormalize(cross(tangent, up));
  if (length(binormal) < 0.01) {
    binormal = safeNormalize(perpendicular(tangent));
  }
  let normal = safeNormalize(cross(binormal, tangent));
  
  // Generate ring of vertices around this segment
  let segments = params.tubeSegments;
  let radius = params.tubeRadius;
  let vOffset = params.vertexOffset + segmentIdx * segments;
  let v = f32(segmentIdx) / f32(max(params.particleCount - 1u, 1u));
  
  for (var i: u32 = 0u; i < segments; i = i + 1u) {
    let angle = f32(i) * 6.28318530718 / f32(segments);
    let cosA = cos(angle);
    let sinA = sin(angle);
    
    // Point on circle in local frame
    let localOffset = normal * cosA + binormal * sinA;
    let worldPos = pos + localOffset * radius;
    let worldNormal = localOffset;
    
    let vertIdx = vOffset + i;
    vertexPositions[vertIdx] = vec4<f32>(worldPos, 1.0);
    vertexNormals[vertIdx] = vec4<f32>(worldNormal, 0.0);
    
    let u = f32(i) / f32(segments);
    vertexUVs[vertIdx] = vec2<f32>(u, v);
  }
}

@compute @workgroup_size(64)
fn generateIndices(@builtin(global_invocation_id) gid: vec3<u32>) {
  let segmentIdx = gid.x;
  if (segmentIdx >= params.particleCount - 1u) {
    return;
  }
  
  let segments = params.tubeSegments;
  let vBase = params.vertexOffset + segmentIdx * segments;
  let vNext = vBase + segments;
  
  // 6 indices per quad, segments quads per ring
  let iBase = params.indexOffset + segmentIdx * segments * 6u;
  if (broken(segmentIdx)) {
    for (var i = 0u; i < segments * 6u; i++) { indices[iBase + i] = vBase; }
    return;
  }
  
  for (var i: u32 = 0u; i < segments; i = i + 1u) {
    let i0 = vBase + i;
    let i1 = vBase + ((i + 1u) % segments);
    let i2 = vNext + i;
    let i3 = vNext + ((i + 1u) % segments);
    
    let quadBase = iBase + i * 6u;
    
    // Triangle 1
    indices[quadBase + 0u] = i0;
    indices[quadBase + 1u] = i2;
    indices[quadBase + 2u] = i1;
    
    // Triangle 2
    indices[quadBase + 3u] = i1;
    indices[quadBase + 4u] = i2;
    indices[quadBase + 5u] = i3;
  }
}

@compute @workgroup_size(1)
fn updateDrawIndirect() {
  let vertexCount = (params.particleCount - 1u) * params.tubeSegments * 6u;
  drawIndirect.vertexCount = vertexCount;
  drawIndirect.instanceCount = 1u;
  drawIndirect.firstVertex = 0u;
  drawIndirect.firstInstance = 0u;
}
`;

const ROPE_RENDER_SHADER = `
struct Uniforms {
  viewProjection: mat4x4<f32>,
  cameraPos: vec3<f32>,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> vertexPositions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> vertexNormals: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> vertexUVs: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let idx = indices[vertexIndex];
  let worldPos = vertexPositions[idx].xyz;
  let normal = vertexNormals[idx].xyz;
  let uv = vertexUVs[idx];
  
  var out: VertexOutput;
  out.position = uniforms.viewProjection * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.normal = normal;
  out.uv = uv;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));
  let normal = normalize(in.normal);
  
  let ambient = 0.2;
  let diffuse = max(dot(normal, lightDir), 0.0) * 0.7;
  let viewDir = normalize(uniforms.cameraPos - in.worldPos);
  let halfVec = normalize(lightDir + viewDir);
  let specular = pow(max(dot(normal, halfVec), 0.0), 32.0) * 0.3;
  
  let baseColor = vec3<f32>(0.6, 0.4, 0.2); // Rope brown
  let lighting = ambient + diffuse;
  let color = baseColor * lighting + vec3<f32>(specular);
  
  return vec4<f32>(color, 1.0);
}
`;

export class RopeGPURenderer {
  constructor(device, options = {}) {
    this.device = device;
    this.maxRopeParticles = options.maxRopeParticles || 1024;
    this.tubeSegments = options.tubeSegments || 8;
    this.tubeRadius = options.tubeRadius || 0.05;
    
    this.computePipelines = null;
    this.renderPipeline = null;
    this.buffers = null;
    this.bindGroups = null;
    this.initialized = false;
  }
  
  async initialize(colorFormat = 'bgra8unorm', depthFormat = 'depth24plus') {
    this._initialize(colorFormat, depthFormat);
  }

  _initialize(colorFormat = 'bgra8unorm', depthFormat = 'depth24plus') {
    if (this.initialized) return;
    
    const device = this.device;
    const maxVerts = this.maxRopeParticles * this.tubeSegments;
    const maxIndices = (this.maxRopeParticles - 1) * this.tubeSegments * 6;
    
    // Create buffers
    this.buffers = {
      emptyConstraints: createStorageBuffer(device, 64, { label: 'RopeGPU.emptyConstraints' }),
      params: device.createBuffer({
        label: 'RopeGPU.params',
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      vertexPositions: createStorageBuffer(device, maxVerts * 16, {
        label: 'RopeGPU.vertexPositions',
        usageExtra: GPUBufferUsage.VERTEX,
      }),
      vertexNormals: createStorageBuffer(device, maxVerts * 16, {
        label: 'RopeGPU.vertexNormals',
      }),
      vertexUVs: createStorageBuffer(device, maxVerts * 8, {
        label: 'RopeGPU.vertexUVs',
      }),
      indices: createStorageBuffer(device, maxIndices * 4, {
        label: 'RopeGPU.indices',
        usageExtra: GPUBufferUsage.INDEX,
      }),
      drawIndirect: device.createBuffer({
        label: 'RopeGPU.drawIndirect',
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      }),
      renderUniforms: device.createBuffer({
        label: 'RopeGPU.renderUniforms',
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    };
    
    // Create compute pipelines
    const computeModule = device.createShaderModule({
      label: 'RopeGPU.compute',
      code: ROPE_TUBE_COMPUTE_SHADER,
    });
    
    const computeBindGroupLayout = device.createBindGroupLayout({
      label: 'RopeGPU.computeBindGroupLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    
    const computePipelineLayout = device.createPipelineLayout({
      label: 'RopeGPU.computePipelineLayout',
      bindGroupLayouts: [computeBindGroupLayout],
    });
    
    this.computePipelines = {
      generateVertices: device.createComputePipeline({
        label: 'RopeGPU.generateVertices',
        layout: computePipelineLayout,
        compute: { module: computeModule, entryPoint: 'generateVertices' },
      }),
      generateIndices: device.createComputePipeline({
        label: 'RopeGPU.generateIndices',
        layout: computePipelineLayout,
        compute: { module: computeModule, entryPoint: 'generateIndices' },
      }),
      updateDrawIndirect: device.createComputePipeline({
        label: 'RopeGPU.updateDrawIndirect',
        layout: computePipelineLayout,
        compute: { module: computeModule, entryPoint: 'updateDrawIndirect' },
      }),
    };
    
    this.computeBindGroupLayout = computeBindGroupLayout;
    
    // Create render pipeline
    const renderModule = device.createShaderModule({
      label: 'RopeGPU.render',
      code: ROPE_RENDER_SHADER,
    });
    
    const renderBindGroupLayout = device.createBindGroupLayout({
      label: 'RopeGPU.renderBindGroupLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    
    this.renderPipeline = device.createRenderPipeline({
      label: 'RopeGPU.renderPipeline',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [renderBindGroupLayout],
      }),
      vertex: {
        module: renderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{ format: colorFormat }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
      },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
    
    this.renderBindGroupLayout = renderBindGroupLayout;
    
    // Create render bind group
    this.bindGroups = {
      render: device.createBindGroup({
        label: 'RopeGPU.renderBindGroup',
        layout: renderBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.buffers.renderUniforms } },
          { binding: 1, resource: { buffer: this.buffers.vertexPositions } },
          { binding: 2, resource: { buffer: this.buffers.vertexNormals } },
          { binding: 3, resource: { buffer: this.buffers.vertexUVs } },
          { binding: 4, resource: { buffer: this.buffers.indices } },
        ],
      }),
    };
    
    this.initialized = true;
  }
  
  /**
   * Create a compute bind group for a specific rope using particle position buffer
   * @param {GPUBuffer} positionBuffer - Particle positions storage buffer
   * @returns {GPUBindGroup}
   */
  createComputeBindGroup(positionBuffer, constraintBuffer = this.buffers.emptyConstraints) {
    return this.device.createBindGroup({
      label: 'RopeGPU.computeBindGroup',
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: positionBuffer } },
        { binding: 1, resource: { buffer: this.buffers.params } },
        { binding: 2, resource: { buffer: this.buffers.vertexPositions } },
        { binding: 3, resource: { buffer: this.buffers.vertexNormals } },
        { binding: 4, resource: { buffer: this.buffers.vertexUVs } },
        { binding: 5, resource: { buffer: this.buffers.indices } },
        { binding: 6, resource: { buffer: this.buffers.drawIndirect } },
        { binding: 7, resource: { buffer: constraintBuffer } },
      ],
    });
  }
  
  /**
   * Generate tube mesh for a rope on the GPU
   * @param {GPUCommandEncoder} encoder
   * @param {GPUBindGroup} computeBindGroup - From createComputeBindGroup
   * @param {Object} ropeInfo - { particleStart, particleCount, tubeRadius? }
   */
  generateMesh(encoder, computeBindGroup, ropeInfo) {
    const { particleStart, particleCount, tubeRadius } = ropeInfo;
    
    if (particleCount < 2) return;
    if (particleCount > this.maxRopeParticles) throw new RangeError('Rope exceeds mesh particle capacity');
    
    // Update params
    const paramsData = new ArrayBuffer(32);
    const paramsU32 = new Uint32Array(paramsData);
    const paramsF32 = new Float32Array(paramsData);
    
    paramsU32[0] = particleStart >>> 0;
    paramsU32[1] = particleCount >>> 0;
    paramsU32[2] = this.tubeSegments >>> 0;
    paramsF32[3] = tubeRadius || this.tubeRadius;
    paramsU32[4] = 0; // vertexOffset
    paramsU32[5] = 0; // indexOffset
    paramsU32[6] = ropeInfo.constraintStart ?? 0;
    paramsU32[7] = ropeInfo.constraintStart != null ? 1 : 0;
    
    this.device.queue.writeBuffer(this.buffers.params, 0, paramsData);
    
    const pass = encoder.beginComputePass({ label: 'RopeGPU.generate' });
    pass.setBindGroup(0, computeBindGroup);
    
    const workgroups = Math.ceil(particleCount / 64);
    
    pass.setPipeline(this.computePipelines.generateVertices);
    pass.dispatchWorkgroups(workgroups);
    
    pass.setPipeline(this.computePipelines.generateIndices);
    pass.dispatchWorkgroups(workgroups);
    
    pass.setPipeline(this.computePipelines.updateDrawIndirect);
    pass.dispatchWorkgroups(1);
    
    pass.end();
  }
  
  /**
   * Render the generated rope mesh
   * @param {GPURenderPassEncoder} pass
   * @param {Object} camera - { viewProjection: mat4, position: vec3 }
   */
  render(pass, camera) {
    if (!this.initialized) return;
    
    // Update render uniforms
    const uniformData = new Float32Array(20);
    uniformData.set(camera.viewProjection, 0);
    uniformData.set(camera.position, 16);
    
    this.device.queue.writeBuffer(this.buffers.renderUniforms, 0, uniformData);
    
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.bindGroups.render);
    pass.drawIndirect(this.buffers.drawIndirect, 0);
  }
  
  destroy() {
    if (this.buffers) {
      for (const buffer of Object.values(this.buffers)) {
        if (buffer && buffer.destroy) buffer.destroy();
      }
    }
    this.buffers = null;
    this.bindGroups = null;
    this.computePipelines = null;
    this.renderPipeline = null;
    this.initialized = false;
  }
}

/**
 * Create a rope GPU renderer instance
 * @param {GPUDevice} device
 * @param {Object} options
 * @returns {RopeGPURenderer}
 */
export function createRopeGPURenderer(device, options = {}) {
  return new RopeGPURenderer(device, options);
}

export default RopeGPURenderer;
