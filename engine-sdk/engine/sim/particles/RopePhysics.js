// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RopePhysics.js - Advanced Rope Physics System
 * 
 * GPU-accelerated rope physics with:
 * - Tension/slack simulation
 * - Attachment constraints (fixed points, entity attachments)
 * - Rope cutting and rejoining
 * - Stretching/compression limits
 * - Wind/external force response
 */

import { createStorageBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";

const ROPE_PHYSICS_SHADER = `
struct RopeParams {
  particleStart: u32,
  particleCount: u32,
  dt: f32,
  stiffness: f32,
  damping: f32,
  restLength: f32,
  stretchLimit: f32,
  compressionLimit: f32,
  gravityY: f32,
  windX: f32,
  windY: f32,
  windZ: f32,
};

struct AttachmentConstraint {
  particleIndex: u32,
  attachType: u32,  // 0=none, 1=fixed, 2=entity
  targetX: f32,
  targetY: f32,
  targetZ: f32,
  strength: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: RopeParams;
@group(0) @binding(3) var<storage, read> attachments: array<AttachmentConstraint>;
@group(0) @binding(4) var<storage, read_write> tensions: array<f32>;

@compute @workgroup_size(64)
fn applyExternalForces(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }
  
  let i = params.particleStart + idx;
  var vel = velocities[i].xyz;
  
  // Gravity
  vel.y += params.gravityY * params.dt;
  
  // Wind
  let wind = vec3<f32>(params.windX, params.windY, params.windZ);
  vel += wind * params.dt;
  
  // Damping
  vel *= (1.0 - params.damping * params.dt);
  
  velocities[i] = vec4<f32>(vel, velocities[i].w);
}

@compute @workgroup_size(64)
fn solveDistanceConstraints(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount - 1u) { return; }
  
  let i0 = params.particleStart + idx;
  let i1 = i0 + 1u;
  
  let p0 = positions[i0].xyz;
  let p1 = positions[i1].xyz;
  
  let delta = p1 - p0;
  let dist = length(delta);
  
  if (dist < 0.0001) { return; }
  
  let restLen = params.restLength;
  let diff = dist - restLen;
  
  // Calculate tension (positive = stretched, negative = compressed)
  let tension = diff / restLen;
  tensions[idx] = tension;
  
  // Apply stretch/compression limits
  var correction = diff;
  if (tension > params.stretchLimit) {
    correction = restLen * params.stretchLimit;
  } else if (tension < -params.compressionLimit) {
    correction = -restLen * params.compressionLimit;
  }
  
  // Spring force
  let force = delta / dist * correction * params.stiffness;
  
  // Apply to velocities (equal and opposite)
  let v0 = velocities[i0].xyz + force * params.dt * 0.5;
  let v1 = velocities[i1].xyz - force * params.dt * 0.5;
  
  velocities[i0] = vec4<f32>(v0, velocities[i0].w);
  velocities[i1] = vec4<f32>(v1, velocities[i1].w);
}

@compute @workgroup_size(64)
fn applyAttachments(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }
  
  let attachment = attachments[idx];
  if (attachment.attachType == 0u) { return; }
  
  let i = params.particleStart + attachment.particleIndex;
  let target = vec3<f32>(attachment.targetX, attachment.targetY, attachment.targetZ);
  
  if (attachment.attachType == 1u) {
    // Fixed attachment - snap to position
    positions[i] = vec4<f32>(target, positions[i].w);
    velocities[i] = vec4<f32>(0.0, 0.0, 0.0, velocities[i].w);
  } else if (attachment.attachType == 2u) {
    // Soft attachment - spring towards target
    let pos = positions[i].xyz;
    let vel = velocities[i].xyz;
    
    let delta = target - pos;
    let force = delta * attachment.strength;
    
    let newVel = vel + force * params.dt;
    velocities[i] = vec4<f32>(newVel, velocities[i].w);
  }
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }
  
  let i = params.particleStart + idx;
  let pos = positions[i].xyz;
  let vel = velocities[i].xyz;
  
  let newPos = pos + vel * params.dt;
  positions[i] = vec4<f32>(newPos, positions[i].w);
}
`;

export class RopePhysicsSystem {
  constructor(device, options = {}) {
    this.device = device;
    this.maxRopes = options.maxRopes || 16;
    this.maxParticlesPerRope = options.maxParticlesPerRope || 128;
    this.maxAttachments = options.maxAttachments || 32;
    
    this.pipelines = null;
    this.buffers = null;
    this.bindGroupLayout = null;
    this.ropeBindGroups = new Map();
    this.ropeData = new Map();
    this.initialized = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    const device = this.device;
    
    // Create shader module
    const shaderModule = device.createShaderModule({
      label: 'RopePhysics.shader',
      code: ROPE_PHYSICS_SHADER,
    });
    
    // Create bind group layout
    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'RopePhysics.bindGroupLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });
    
    // Create pipelines
    this.pipelines = {
      applyExternalForces: device.createComputePipeline({
        label: 'RopePhysics.externalForces',
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: 'applyExternalForces' },
      }),
      solveDistanceConstraints: device.createComputePipeline({
        label: 'RopePhysics.distanceConstraints',
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: 'solveDistanceConstraints' },
      }),
      applyAttachments: device.createComputePipeline({
        label: 'RopePhysics.attachments',
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: 'applyAttachments' },
      }),
      integrate: device.createComputePipeline({
        label: 'RopePhysics.integrate',
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: 'integrate' },
      }),
    };
    
    // Create shared buffers
    this.buffers = {
      params: device.createBuffer({
        label: 'RopePhysics.params',
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      attachments: createStorageBuffer(device, this.maxAttachments * 32, {
        label: 'RopePhysics.attachments',
      }),
      tensions: createStorageBuffer(device, this.maxParticlesPerRope * 4, {
        label: 'RopePhysics.tensions',
      }),
    };
    
    this.initialized = true;
  }
  
  /**
   * Register a rope for physics simulation
   * @param {string} ropeId - Unique rope identifier
   * @param {Object} config - { particleStart, particleCount, restLength, stiffness, damping }
   */
  registerRope(ropeId, config) {
    this.ropeData.set(ropeId, {
      particleStart: config.particleStart || 0,
      particleCount: config.particleCount || 10,
      restLength: config.restLength || 0.5,
      stiffness: config.stiffness || 100.0,
      damping: config.damping || 0.1,
      stretchLimit: config.stretchLimit || 1.5,
      compressionLimit: config.compressionLimit || 0.5,
      attachments: [],
      isCut: false,
      cutIndex: -1,
    });
  }
  
  /**
   * Add attachment constraint to a rope
   * @param {string} ropeId
   * @param {Object} attachment - { particleIndex, type: 'fixed'|'entity', target: [x,y,z], strength? }
   */
  addAttachment(ropeId, attachment) {
    const rope = this.ropeData.get(ropeId);
    if (!rope) return;
    
    rope.attachments.push({
      particleIndex: attachment.particleIndex,
      type: attachment.type === 'fixed' ? 1 : (attachment.type === 'entity' ? 2 : 0),
      target: attachment.target || [0, 0, 0],
      strength: attachment.strength || 50.0,
    });
  }
  
  /**
   * Update attachment target position
   * @param {string} ropeId
   * @param {number} attachmentIndex
   * @param {Array} target - [x, y, z]
   */
  updateAttachmentTarget(ropeId, attachmentIndex, target) {
    const rope = this.ropeData.get(ropeId);
    if (!rope || !rope.attachments[attachmentIndex]) return;
    
    rope.attachments[attachmentIndex].target = target;
  }
  
  /**
   * Cut a rope at specified particle index
   * @param {string} ropeId
   * @param {number} cutIndex - Particle index to cut at
   * @returns {{ ropeA: string, ropeB: string }} New rope IDs for each segment
   */
  cutRope(ropeId, cutIndex) {
    const rope = this.ropeData.get(ropeId);
    if (!rope || rope.isCut) return null;
    
    rope.isCut = true;
    rope.cutIndex = cutIndex;
    
    // Create two new rope segments
    const ropeAId = `${ropeId}_A`;
    const ropeBId = `${ropeId}_B`;
    
    // First segment: particles 0 to cutIndex
    this.registerRope(ropeAId, {
      particleStart: rope.particleStart,
      particleCount: cutIndex + 1,
      restLength: rope.restLength,
      stiffness: rope.stiffness,
      damping: rope.damping,
      stretchLimit: rope.stretchLimit,
      compressionLimit: rope.compressionLimit,
    });
    
    // Second segment: particles cutIndex+1 to end
    this.registerRope(ropeBId, {
      particleStart: rope.particleStart + cutIndex + 1,
      particleCount: rope.particleCount - cutIndex - 1,
      restLength: rope.restLength,
      stiffness: rope.stiffness,
      damping: rope.damping,
      stretchLimit: rope.stretchLimit,
      compressionLimit: rope.compressionLimit,
    });
    
    // Migrate attachments
    for (const att of rope.attachments) {
      if (att.particleIndex <= cutIndex) {
        this.addAttachment(ropeAId, { ...att });
      } else {
        this.addAttachment(ropeBId, {
          ...att,
          particleIndex: att.particleIndex - cutIndex - 1,
        });
      }
    }
    
    return { ropeA: ropeAId, ropeB: ropeBId };
  }
  
  /**
   * Create bind group for a rope
   */
  createRopeBindGroup(ropeId, positionBuffer, velocityBuffer) {
    if (!this.initialized) return null;
    
    const bindGroup = this.device.createBindGroup({
      label: `RopePhysics.bindGroup.${ropeId}`,
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: positionBuffer } },
        { binding: 1, resource: { buffer: velocityBuffer } },
        { binding: 2, resource: { buffer: this.buffers.params } },
        { binding: 3, resource: { buffer: this.buffers.attachments } },
        { binding: 4, resource: { buffer: this.buffers.tensions } },
      ],
    });
    
    this.ropeBindGroups.set(ropeId, bindGroup);
    return bindGroup;
  }
  
  /**
   * Step rope physics simulation
   * @param {GPUCommandEncoder} encoder
   * @param {string} ropeId
   * @param {Object} options - { dt, wind?, iterations? }
   */
  stepRope(encoder, ropeId, options = {}) {
    if (!this.initialized) return;
    
    const rope = this.ropeData.get(ropeId);
    const bindGroup = this.ropeBindGroups.get(ropeId);
    if (!rope || !bindGroup || rope.isCut) return;
    
    const dt = options.dt || 1/60;
    const wind = options.wind || [0, 0, 0];
    const iterations = options.iterations || 4;
    
    // Update params
    const paramsData = new Float32Array(12);
    new Uint32Array(paramsData.buffer)[0] = rope.particleStart;
    new Uint32Array(paramsData.buffer)[1] = rope.particleCount;
    paramsData[2] = dt / iterations;
    paramsData[3] = rope.stiffness;
    paramsData[4] = rope.damping;
    paramsData[5] = rope.restLength;
    paramsData[6] = rope.stretchLimit;
    paramsData[7] = rope.compressionLimit;
    paramsData[8] = -9.81;
    paramsData[9] = wind[0];
    paramsData[10] = wind[1];
    paramsData[11] = wind[2];
    
    this.device.queue.writeBuffer(this.buffers.params, 0, paramsData);
    
    // Update attachments
    const attachData = new Float32Array(this.maxAttachments * 8);
    for (let i = 0; i < rope.attachments.length && i < this.maxAttachments; i++) {
      const att = rope.attachments[i];
      const base = i * 8;
      new Uint32Array(attachData.buffer)[base] = att.particleIndex;
      new Uint32Array(attachData.buffer)[base + 1] = att.type;
      attachData[base + 2] = att.target[0];
      attachData[base + 3] = att.target[1];
      attachData[base + 4] = att.target[2];
      attachData[base + 5] = att.strength;
    }
    this.device.queue.writeBuffer(this.buffers.attachments, 0, attachData);
    
    const workgroups = Math.ceil(rope.particleCount / 64);
    
    // Run simulation iterations
    for (let iter = 0; iter < iterations; iter++) {
      const pass = encoder.beginComputePass({ label: `RopePhysics.step.${ropeId}.${iter}` });
      pass.setBindGroup(0, bindGroup);
      
      // External forces
      pass.setPipeline(this.pipelines.applyExternalForces);
      pass.dispatchWorkgroups(workgroups);
      
      // Distance constraints
      pass.setPipeline(this.pipelines.solveDistanceConstraints);
      pass.dispatchWorkgroups(workgroups);
      
      // Attachments
      pass.setPipeline(this.pipelines.applyAttachments);
      pass.dispatchWorkgroups(workgroups);
      
      // Integration
      pass.setPipeline(this.pipelines.integrate);
      pass.dispatchWorkgroups(workgroups);
      
      pass.end();
    }
  }
  
  /**
   * Get rope tension data (requires GPU readback)
   */
  async getTensions(ropeId) {
    const rope = this.ropeData.get(ropeId);
    if (!rope) return null;
    
    // This would require GPU readback - simplified here
    return new Float32Array(rope.particleCount - 1);
  }
  
  unregisterRope(ropeId) {
    this.ropeData.delete(ropeId);
    this.ropeBindGroups.delete(ropeId);
  }
  
  destroy() {
    if (this.buffers) {
      for (const buffer of Object.values(this.buffers)) {
        if (buffer && buffer.destroy) buffer.destroy();
      }
    }
    this.buffers = null;
    this.pipelines = null;
    this.ropeBindGroups.clear();
    this.ropeData.clear();
    this.initialized = false;
  }
}

export function createRopePhysicsSystem(device, options = {}) {
  return new RopePhysicsSystem(device, options);
}

export default RopePhysicsSystem;
