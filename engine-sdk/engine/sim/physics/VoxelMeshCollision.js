/**
 * VoxelMeshCollision.js - Voxel-based Mesh Collision for Particles and Ropes
 * 
 * Voxelizes meshes into an occupancy grid with compressed normals for efficient
 * GPU collision detection. This allows particles and ropes to collide with
 * arbitrary mesh geometry beyond simple AABBs.
 * 
 * Representation (per voxel, 32 bits total):
 * - Bit 31: Occupancy flag (1 = solid)
 * - Bits 30-21: Normal X (10 bits, signed normalized)
 * - Bits 20-11: Normal Y (10 bits, signed normalized)
 * - Bits 10-1: Normal Z (10 bits, signed normalized)
 * - Bit 0: Reserved
 * 
 * Features:
 * - GPU mesh voxelization via compute shader
 * - Compressed normal storage (10-10-10-2 format)
 * - Cascaded/multi-resolution support
 * - GPU collision queries for particles
 * - Cache and reuse voxelized meshes
 */

import { createStorageBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";

const VOXELIZE_MESH_SHADER = `
struct VoxelParams {
  gridMin: vec3<f32>,
  voxelSize: f32,
  gridMax: vec3<f32>,
  gridDims: u32,
  triangleCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct Triangle {
  v0: vec3<f32>,
  _pad0: f32,
  v1: vec3<f32>,
  _pad1: f32,
  v2: vec3<f32>,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> params: VoxelParams;
@group(0) @binding(1) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(2) var<storage, read_write> voxelGrid: array<atomic<u32>>;

fn encodeNormal(n: vec3<f32>) -> u32 {
  let nx = u32(clamp((n.x * 0.5 + 0.5) * 1023.0, 0.0, 1023.0));
  let ny = u32(clamp((n.y * 0.5 + 0.5) * 1023.0, 0.0, 1023.0));
  let nz = u32(clamp((n.z * 0.5 + 0.5) * 1023.0, 0.0, 1023.0));
  return (1u << 31u) | (nx << 21u) | (ny << 11u) | (nz << 1u);
}

fn voxelIndex(coord: vec3<u32>, dims: u32) -> u32 {
  return coord.x + coord.y * dims + coord.z * dims * dims;
}

fn worldToVoxel(pos: vec3<f32>) -> vec3<i32> {
  let rel = (pos - params.gridMin) / params.voxelSize;
  return vec3<i32>(floor(rel));
}

fn triangleAABB(tri: Triangle) -> array<vec3<f32>, 2> {
  var minP = min(min(tri.v0, tri.v1), tri.v2);
  var maxP = max(max(tri.v0, tri.v1), tri.v2);
  return array<vec3<f32>, 2>(minP, maxP);
}

fn triangleNormal(tri: Triangle) -> vec3<f32> {
  let e1 = tri.v1 - tri.v0;
  let e2 = tri.v2 - tri.v0;
  return normalize(cross(e1, e2));
}

fn pointInTriangle(p: vec3<f32>, v0: vec3<f32>, v1: vec3<f32>, v2: vec3<f32>) -> bool {
  let e0 = v1 - v0;
  let e1 = v2 - v0;
  let e2 = p - v0;
  
  let d00 = dot(e0, e0);
  let d01 = dot(e0, e1);
  let d11 = dot(e1, e1);
  let d20 = dot(e2, e0);
  let d21 = dot(e2, e1);
  
  let denom = d00 * d11 - d01 * d01;
  if (abs(denom) < 1e-10) { return false; }
  
  let v = (d11 * d20 - d01 * d21) / denom;
  let w = (d00 * d21 - d01 * d20) / denom;
  
  return v >= 0.0 && w >= 0.0 && (v + w) <= 1.0;
}

fn triangleVoxelIntersect(tri: Triangle, voxelCenter: vec3<f32>, halfSize: f32) -> bool {
  let v0 = tri.v0 - voxelCenter;
  let v1 = tri.v1 - voxelCenter;
  let v2 = tri.v2 - voxelCenter;
  
  // Test AABB overlap first
  let triMin = min(min(v0, v1), v2);
  let triMax = max(max(v0, v1), v2);
  let hs = vec3<f32>(halfSize);
  
  if (any(triMin > hs) || any(triMax < -hs)) {
    return false;
  }
  
  // Test triangle plane vs AABB
  let normal = cross(v1 - v0, v2 - v0);
  let d = -dot(normal, v0);
  
  var r = halfSize * (abs(normal.x) + abs(normal.y) + abs(normal.z));
  if (abs(d) > r) {
    return false;
  }
  
  return true;
}

@compute @workgroup_size(64)
fn voxelizeMesh(@builtin(global_invocation_id) gid: vec3<u32>) {
  let triIdx = gid.x;
  if (triIdx >= params.triangleCount) {
    return;
  }
  
  let tri = triangles[triIdx];
  let normal = triangleNormal(tri);
  let encodedNormal = encodeNormal(normal);
  
  let aabb = triangleAABB(tri);
  let minVoxel = worldToVoxel(aabb[0]);
  let maxVoxel = worldToVoxel(aabb[1]);
  
  let dims = i32(params.gridDims);
  let halfSize = params.voxelSize * 0.5;
  
  for (var z = max(minVoxel.z, 0); z <= min(maxVoxel.z, dims - 1); z = z + 1) {
    for (var y = max(minVoxel.y, 0); y <= min(maxVoxel.y, dims - 1); y = y + 1) {
      for (var x = max(minVoxel.x, 0); x <= min(maxVoxel.x, dims - 1); x = x + 1) {
        let voxelCenter = params.gridMin + vec3<f32>(f32(x), f32(y), f32(z)) * params.voxelSize + halfSize;
        
        if (triangleVoxelIntersect(tri, voxelCenter, halfSize)) {
          let idx = voxelIndex(vec3<u32>(u32(x), u32(y), u32(z)), params.gridDims);
          atomicOr(&voxelGrid[idx], encodedNormal);
        }
      }
    }
  }
}

@compute @workgroup_size(64)
fn clearGrid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  let totalVoxels = params.gridDims * params.gridDims * params.gridDims;
  if (idx < totalVoxels) {
    atomicStore(&voxelGrid[idx], 0u);
  }
}
`;

const PARTICLE_VOXEL_COLLISION_SHADER = `
struct CollisionParams {
  gridMin: vec3<f32>,
  voxelSize: f32,
  gridMax: vec3<f32>,
  gridDims: u32,
  particleCount: u32,
  collisionRadius: f32,
  restitution: f32,
  friction: f32,
};

@group(0) @binding(0) var<uniform> params: CollisionParams;
@group(0) @binding(1) var<storage, read> voxelGrid: array<u32>;
@group(0) @binding(2) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;

fn decodeNormal(encoded: u32) -> vec3<f32> {
  let nx = f32((encoded >> 21u) & 0x3FFu) / 1023.0 * 2.0 - 1.0;
  let ny = f32((encoded >> 11u) & 0x3FFu) / 1023.0 * 2.0 - 1.0;
  let nz = f32((encoded >> 1u) & 0x3FFu) / 1023.0 * 2.0 - 1.0;
  return normalize(vec3<f32>(nx, ny, nz));
}

fn isOccupied(encoded: u32) -> bool {
  return (encoded & (1u << 31u)) != 0u;
}

fn voxelIndex(coord: vec3<u32>, dims: u32) -> u32 {
  return coord.x + coord.y * dims + coord.z * dims * dims;
}

fn worldToVoxelF(pos: vec3<f32>) -> vec3<f32> {
  return (pos - params.gridMin) / params.voxelSize;
}

fn isInGrid(coord: vec3<i32>, dims: i32) -> bool {
  return all(coord >= vec3<i32>(0)) && all(coord < vec3<i32>(dims));
}

fn sampleVoxel(pos: vec3<f32>) -> u32 {
  let voxelF = worldToVoxelF(pos);
  let coord = vec3<i32>(floor(voxelF));
  let dims = i32(params.gridDims);
  
  if (!isInGrid(coord, dims)) {
    return 0u;
  }
  
  return voxelGrid[voxelIndex(vec3<u32>(coord), params.gridDims)];
}

@compute @workgroup_size(64)
fn collideParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) {
    return;
  }
  
  var pos = positions[idx].xyz;
  var vel = velocities[idx].xyz;
  let age = positions[idx].w;
  let lifetime = velocities[idx].w;
  
  let radius = params.collisionRadius;
  
  // Sample voxel at particle position
  let voxel = sampleVoxel(pos);
  
  if (isOccupied(voxel)) {
    let normal = decodeNormal(voxel);
    
    // Push particle out of solid
    pos = pos + normal * params.voxelSize * 0.6;
    
    // Reflect velocity with restitution and friction
    let vn = dot(vel, normal);
    if (vn < 0.0) {
      let vNormal = normal * vn;
      let vTangent = vel - vNormal;
      
      vel = vTangent * (1.0 - params.friction) - vNormal * params.restitution;
    }
  }
  
  // Also check neighboring voxels for radius-based collision
  let voxelF = worldToVoxelF(pos);
  let cellRadius = i32(ceil(radius / params.voxelSize));
  let baseCoord = vec3<i32>(floor(voxelF));
  let dims = i32(params.gridDims);
  
  var totalPush = vec3<f32>(0.0);
  var pushCount = 0u;
  
  for (var dz = -cellRadius; dz <= cellRadius; dz = dz + 1) {
    for (var dy = -cellRadius; dy <= cellRadius; dy = dy + 1) {
      for (var dx = -cellRadius; dx <= cellRadius; dx = dx + 1) {
        let coord = baseCoord + vec3<i32>(dx, dy, dz);
        if (!isInGrid(coord, dims)) { continue; }
        
        let neighborVoxel = voxelGrid[voxelIndex(vec3<u32>(coord), params.gridDims)];
        if (!isOccupied(neighborVoxel)) { continue; }
        
        let voxelCenter = params.gridMin + (vec3<f32>(coord) + 0.5) * params.voxelSize;
        let toParticle = pos - voxelCenter;
        let dist = length(toParticle);
        let penetration = (params.voxelSize * 0.5 + radius) - dist;
        
        if (penetration > 0.0 && dist > 0.001) {
          let pushDir = toParticle / dist;
          totalPush = totalPush + pushDir * penetration;
          pushCount = pushCount + 1u;
        }
      }
    }
  }
  
  if (pushCount > 0u) {
    let avgPush = totalPush / f32(pushCount);
    pos = pos + avgPush;
    
    let pushNormal = normalize(avgPush);
    let vn = dot(vel, pushNormal);
    if (vn < 0.0) {
      let vNormal = pushNormal * vn;
      let vTangent = vel - vNormal;
      vel = vTangent * (1.0 - params.friction * 0.5) - vNormal * params.restitution * 0.8;
    }
  }
  
  positions[idx] = vec4<f32>(pos, age);
  velocities[idx] = vec4<f32>(vel, lifetime);
}
`;

export class VoxelMeshCollider {
  constructor(device, options = {}) {
    this.device = device;
    this.gridDims = options.gridDims || 64;
    this.voxelSize = options.voxelSize || 0.5;
    
    this.pipelines = null;
    this.buffers = null;
    this.bindGroupLayouts = null;
    this.initialized = false;
    
    // Cache for voxelized meshes
    this.meshCache = new Map();
  }
  
  async initialize() {
    if (this.initialized) return;
    
    const device = this.device;
    const totalVoxels = this.gridDims ** 3;
    
    // Create buffers
    this.buffers = {
      voxelParams: device.createBuffer({
        label: 'VoxelCollision.params',
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      collisionParams: device.createBuffer({
        label: 'VoxelCollision.collisionParams',
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      voxelGrid: createStorageBuffer(device, totalVoxels * 4, {
        label: 'VoxelCollision.grid',
      }),
    };
    
    // Create voxelization shader
    const voxelizeModule = device.createShaderModule({
      label: 'VoxelCollision.voxelize',
      code: VOXELIZE_MESH_SHADER,
    });
    
    // Create collision shader
    const collisionModule = device.createShaderModule({
      label: 'VoxelCollision.collision',
      code: PARTICLE_VOXEL_COLLISION_SHADER,
    });
    
    // Voxelization bind group layout
    const voxelizeLayout = device.createBindGroupLayout({
      label: 'VoxelCollision.voxelizeLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    
    // Collision bind group layout
    const collisionLayout = device.createBindGroupLayout({
      label: 'VoxelCollision.collisionLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    
    this.bindGroupLayouts = { voxelize: voxelizeLayout, collision: collisionLayout };
    
    // Create pipelines
    this.pipelines = {
      clearGrid: device.createComputePipeline({
        label: 'VoxelCollision.clearGrid',
        layout: device.createPipelineLayout({ bindGroupLayouts: [voxelizeLayout] }),
        compute: { module: voxelizeModule, entryPoint: 'clearGrid' },
      }),
      voxelizeMesh: device.createComputePipeline({
        label: 'VoxelCollision.voxelizeMesh',
        layout: device.createPipelineLayout({ bindGroupLayouts: [voxelizeLayout] }),
        compute: { module: voxelizeModule, entryPoint: 'voxelizeMesh' },
      }),
      collideParticles: device.createComputePipeline({
        label: 'VoxelCollision.collideParticles',
        layout: device.createPipelineLayout({ bindGroupLayouts: [collisionLayout] }),
        compute: { module: collisionModule, entryPoint: 'collideParticles' },
      }),
    };
    
    this.initialized = true;
  }
  
  /**
   * Upload mesh triangles and voxelize
   * @param {Float32Array} triangleData - Triangle vertices (v0x,v0y,v0z,_,v1x,v1y,v1z,_,v2x,v2y,v2z,_,...)
   * @param {Object} bounds - { min: [x,y,z], max: [x,y,z] }
   * @param {string} cacheKey - Optional cache key for reuse
   * @returns {GPUBuffer} Voxel grid buffer
   */
  voxelizeMesh(triangleData, bounds, cacheKey = null) {
    if (!this.initialized) {
      console.warn('[VoxelMeshCollider] Not initialized');
      return null;
    }
    
    // Check cache
    if (cacheKey && this.meshCache.has(cacheKey)) {
      return this.meshCache.get(cacheKey);
    }
    
    const device = this.device;
    const triangleCount = triangleData.length / 12; // 12 floats per triangle (3 verts * 4 floats)
    
    // Create triangle buffer
    const triangleBuffer = createStorageBuffer(device, triangleData, {
      label: 'VoxelCollision.triangles',
    });
    
    // Calculate voxel parameters
    const gridMin = bounds.min;
    const gridMax = bounds.max;
    const extent = [
      gridMax[0] - gridMin[0],
      gridMax[1] - gridMin[1],
      gridMax[2] - gridMin[2],
    ];
    const maxExtent = Math.max(extent[0], extent[1], extent[2]);
    const voxelSize = maxExtent / this.gridDims;
    
    // Update params
    const paramsData = new Float32Array(12);
    paramsData[0] = gridMin[0];
    paramsData[1] = gridMin[1];
    paramsData[2] = gridMin[2];
    paramsData[3] = voxelSize;
    paramsData[4] = gridMax[0];
    paramsData[5] = gridMax[1];
    paramsData[6] = gridMax[2];
    new Uint32Array(paramsData.buffer)[7] = this.gridDims;
    new Uint32Array(paramsData.buffer)[8] = triangleCount;
    
    device.queue.writeBuffer(this.buffers.voxelParams, 0, paramsData);
    
    // Create bind group
    const bindGroup = device.createBindGroup({
      label: 'VoxelCollision.voxelizeBindGroup',
      layout: this.bindGroupLayouts.voxelize,
      entries: [
        { binding: 0, resource: { buffer: this.buffers.voxelParams } },
        { binding: 1, resource: { buffer: triangleBuffer } },
        { binding: 2, resource: { buffer: this.buffers.voxelGrid } },
      ],
    });
    
    // Execute voxelization
    const encoder = device.createCommandEncoder({ label: 'VoxelCollision.voxelize' });
    const pass = encoder.beginComputePass({ label: 'VoxelCollision.voxelizePass' });
    
    // Clear grid
    pass.setPipeline(this.pipelines.clearGrid);
    pass.setBindGroup(0, bindGroup);
    const totalVoxels = this.gridDims ** 3;
    pass.dispatchWorkgroups(Math.ceil(totalVoxels / 64));
    
    // Voxelize
    pass.setPipeline(this.pipelines.voxelizeMesh);
    pass.dispatchWorkgroups(Math.ceil(triangleCount / 64));
    
    pass.end();
    device.queue.submit([encoder.finish()]);
    
    // Cleanup triangle buffer
    triangleBuffer.destroy();
    
    // Store voxel info
    const voxelInfo = {
      gridBuffer: this.buffers.voxelGrid,
      gridDims: this.gridDims,
      voxelSize,
      gridMin,
      gridMax,
    };
    
    if (cacheKey) {
      this.meshCache.set(cacheKey, voxelInfo);
    }
    
    return voxelInfo;
  }
  
  /**
   * Create collision bind group for particle buffers
   * @param {GPUBuffer} positionBuffer
   * @param {GPUBuffer} velocityBuffer
   * @returns {GPUBindGroup}
   */
  createCollisionBindGroup(positionBuffer, velocityBuffer) {
    return this.device.createBindGroup({
      label: 'VoxelCollision.collisionBindGroup',
      layout: this.bindGroupLayouts.collision,
      entries: [
        { binding: 0, resource: { buffer: this.buffers.collisionParams } },
        { binding: 1, resource: { buffer: this.buffers.voxelGrid } },
        { binding: 2, resource: { buffer: positionBuffer } },
        { binding: 3, resource: { buffer: velocityBuffer } },
      ],
    });
  }
  
  /**
   * Run particle-voxel collision
   * @param {GPUCommandEncoder} encoder
   * @param {GPUBindGroup} collisionBindGroup
   * @param {Object} options - { particleCount, collisionRadius, restitution, friction, voxelInfo }
   */
  collideParticles(encoder, collisionBindGroup, options) {
    const {
      particleCount,
      collisionRadius = 0.1,
      restitution = 0.3,
      friction = 0.2,
      voxelInfo,
    } = options;
    
    if (!voxelInfo) return;
    
    // Update collision params
    const paramsData = new Float32Array(12);
    paramsData[0] = voxelInfo.gridMin[0];
    paramsData[1] = voxelInfo.gridMin[1];
    paramsData[2] = voxelInfo.gridMin[2];
    paramsData[3] = voxelInfo.voxelSize;
    paramsData[4] = voxelInfo.gridMax[0];
    paramsData[5] = voxelInfo.gridMax[1];
    paramsData[6] = voxelInfo.gridMax[2];
    new Uint32Array(paramsData.buffer)[7] = voxelInfo.gridDims;
    new Uint32Array(paramsData.buffer)[8] = particleCount;
    paramsData[9] = collisionRadius;
    paramsData[10] = restitution;
    paramsData[11] = friction;
    
    this.device.queue.writeBuffer(this.buffers.collisionParams, 0, paramsData);
    
    const pass = encoder.beginComputePass({ label: 'VoxelCollision.collidePass' });
    pass.setPipeline(this.pipelines.collideParticles);
    pass.setBindGroup(0, collisionBindGroup);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
    pass.end();
  }
  
  /**
   * Clear the mesh cache
   */
  clearCache() {
    this.meshCache.clear();
  }
  
  destroy() {
    if (this.buffers) {
      for (const buffer of Object.values(this.buffers)) {
        if (buffer && buffer.destroy) buffer.destroy();
      }
    }
    this.buffers = null;
    this.pipelines = null;
    this.meshCache.clear();
    this.initialized = false;
  }
}

/**
 * Helper: Convert mesh vertices/indices to triangle buffer format
 * @param {Float32Array} vertices - Vertex positions (x,y,z,x,y,z,...)
 * @param {Uint32Array|Uint16Array} indices - Triangle indices
 * @returns {Float32Array} Triangle data for voxelization
 */
export function meshToTriangleBuffer(vertices, indices) {
  const triangleCount = indices.length / 3;
  const triangleData = new Float32Array(triangleCount * 12);
  
  for (let i = 0; i < triangleCount; i++) {
    const i0 = indices[i * 3 + 0];
    const i1 = indices[i * 3 + 1];
    const i2 = indices[i * 3 + 2];
    
    const base = i * 12;
    
    // v0
    triangleData[base + 0] = vertices[i0 * 3 + 0];
    triangleData[base + 1] = vertices[i0 * 3 + 1];
    triangleData[base + 2] = vertices[i0 * 3 + 2];
    triangleData[base + 3] = 0; // padding
    
    // v1
    triangleData[base + 4] = vertices[i1 * 3 + 0];
    triangleData[base + 5] = vertices[i1 * 3 + 1];
    triangleData[base + 6] = vertices[i1 * 3 + 2];
    triangleData[base + 7] = 0;
    
    // v2
    triangleData[base + 8] = vertices[i2 * 3 + 0];
    triangleData[base + 9] = vertices[i2 * 3 + 1];
    triangleData[base + 10] = vertices[i2 * 3 + 2];
    triangleData[base + 11] = 0;
  }
  
  return triangleData;
}

/**
 * Helper: Compute mesh AABB
 * @param {Float32Array} vertices
 * @returns {{ min: number[], max: number[] }}
 */
export function computeMeshBounds(vertices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  
  for (let i = 0; i < vertices.length; i += 3) {
    min[0] = Math.min(min[0], vertices[i]);
    min[1] = Math.min(min[1], vertices[i + 1]);
    min[2] = Math.min(min[2], vertices[i + 2]);
    max[0] = Math.max(max[0], vertices[i]);
    max[1] = Math.max(max[1], vertices[i + 1]);
    max[2] = Math.max(max[2], vertices[i + 2]);
  }
  
  // Add small padding
  const pad = 0.1;
  return {
    min: [min[0] - pad, min[1] - pad, min[2] - pad],
    max: [max[0] + pad, max[1] + pad, max[2] + pad],
  };
}

export function createVoxelMeshCollider(device, options = {}) {
  return new VoxelMeshCollider(device, options);
}

/**
 * CascadedVoxelCollider - Multi-resolution voxel collision with LOD levels
 * 
 * Uses multiple grid resolutions for efficient collision:
 * - LOD 0: Fine (128³) - Near particles, high accuracy
 * - LOD 1: Medium (64³) - Mid-range particles
 * - LOD 2: Coarse (32³) - Far particles, fast queries
 */
export class CascadedVoxelCollider {
  constructor(device, options = {}) {
    this.device = device;
    this.lodLevels = options.lodLevels || [
      { gridDims: 128, maxDistance: 5.0 },
      { gridDims: 64, maxDistance: 15.0 },
      { gridDims: 32, maxDistance: Infinity },
    ];
    this.colliders = [];
    this.initialized = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    for (const lod of this.lodLevels) {
      const collider = createVoxelMeshCollider(this.device, { gridDims: lod.gridDims });
      await collider.initialize();
      this.colliders.push({ collider, maxDistance: lod.maxDistance, gridDims: lod.gridDims });
    }
    
    this.initialized = true;
  }
  
  /**
   * Voxelize mesh at all LOD levels
   */
  voxelizeMeshAllLODs(triangleData, bounds, cacheKey = null) {
    const results = [];
    for (let i = 0; i < this.colliders.length; i++) {
      const key = cacheKey ? `${cacheKey}_lod${i}` : null;
      const voxelInfo = this.colliders[i].collider.voxelizeMesh(triangleData, bounds, key);
      results.push({ lod: i, voxelInfo, maxDistance: this.colliders[i].maxDistance });
    }
    return results;
  }
  
  /**
   * Get appropriate LOD collider based on distance
   */
  getColliderForDistance(distance) {
    for (const { collider, maxDistance } of this.colliders) {
      if (distance <= maxDistance) {
        return collider;
      }
    }
    return this.colliders[this.colliders.length - 1].collider;
  }
  
  clearCache() {
    for (const { collider } of this.colliders) {
      collider.clearCache();
    }
  }
  
  destroy() {
    for (const { collider } of this.colliders) {
      collider.destroy();
    }
    this.colliders = [];
    this.initialized = false;
  }
}

/**
 * VoxelCacheManager - Persistent cache for voxelized meshes
 * 
 * Saves/loads voxelized mesh data to avoid re-voxelization.
 * Uses IndexedDB for persistence.
 */
export class VoxelCacheManager {
  constructor(dbName = 'VoxelMeshCache') {
    this.dbName = dbName;
    this.db = null;
    this.memoryCache = new Map();
  }
  
  async open() {
    if (this.db) return this.db;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      
      request.onerror = () => reject(request.error);
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('voxels')) {
          db.createObjectStore('voxels', { keyPath: 'key' });
        }
      };
    });
  }
  
  /**
   * Save voxel data to persistent cache
   * @param {string} key - Cache key
   * @param {Object} data - { gridData: Uint32Array, bounds, gridDims, voxelSize }
   */
  async save(key, data) {
    await this.open();
    
    const serialized = {
      key,
      gridData: Array.from(data.gridData),
      bounds: data.bounds,
      gridDims: data.gridDims,
      voxelSize: data.voxelSize,
      timestamp: Date.now(),
    };
    
    this.memoryCache.set(key, data);
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['voxels'], 'readwrite');
      const store = transaction.objectStore('voxels');
      const request = store.put(serialized);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
  
  /**
   * Load voxel data from cache
   * @param {string} key - Cache key
   * @returns {Object|null} Cached data or null
   */
  async load(key) {
    // Check memory cache first
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }
    
    await this.open();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['voxels'], 'readonly');
      const store = transaction.objectStore('voxels');
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }
        
        const data = {
          gridData: new Uint32Array(result.gridData),
          bounds: result.bounds,
          gridDims: result.gridDims,
          voxelSize: result.voxelSize,
        };
        
        this.memoryCache.set(key, data);
        resolve(data);
      };
    });
  }
  
  /**
   * Check if key exists in cache
   */
  async has(key) {
    if (this.memoryCache.has(key)) return true;
    
    await this.open();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['voxels'], 'readonly');
      const store = transaction.objectStore('voxels');
      const request = store.count(IDBKeyRange.only(key));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result > 0);
    });
  }
  
  /**
   * Delete cached entry
   */
  async delete(key) {
    this.memoryCache.delete(key);
    
    await this.open();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['voxels'], 'readwrite');
      const store = transaction.objectStore('voxels');
      const request = store.delete(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
  
  /**
   * Clear all cached data
   */
  async clear() {
    this.memoryCache.clear();
    
    await this.open();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['voxels'], 'readwrite');
      const store = transaction.objectStore('voxels');
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
  
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export function createCascadedVoxelCollider(device, options = {}) {
  return new CascadedVoxelCollider(device, options);
}

export function createVoxelCacheManager(dbName = 'VoxelMeshCache') {
  return new VoxelCacheManager(dbName);
}

export default VoxelMeshCollider;
