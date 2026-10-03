// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleCollisionSDF.js - Custom SDF Collision Integration
 * 
 * Integrates custom particle effect SDFs into the collision system.
 * The same SDF code used for visual rendering is used for collision detection.
 * 
 * This module:
 * 1. Generates collision compute shaders with custom SDFs
 * 2. Manages effect-to-index mapping for GPU dispatch
 * 3. Provides collision evaluation utilities
 */

import { SDF_HELPERS_WGSL, EFFECT_PRESETS, generateCollisionShader } from './CustomParticleEffect.js';
import { getParticleEffectRegistry } from './ParticleEffectRegistry.js';

// ============================================================================
// COLLISION SYSTEM CONSTANTS
// ============================================================================

const MAX_REGISTERED_EFFECTS = 32;
const WORKGROUP_SIZE = 64;

// ============================================================================
// EFFECT INDEX MAPPING
// ============================================================================

// Maps effect IDs to indices for GPU dispatch
const _effectIndexMap = new Map();
const _effectCodeCache = new Map();
let _nextEffectIndex = 0;

/**
 * Register an effect for collision (assigns an index)
 */
export function registerEffectForCollision(effectId) {
  if (_effectIndexMap.has(effectId)) {
    return _effectIndexMap.get(effectId);
  }
  
  if (_nextEffectIndex >= MAX_REGISTERED_EFFECTS) {
    console.warn(`[ParticleCollisionSDF] Max effects (${MAX_REGISTERED_EFFECTS}) reached, reusing index 0`);
    return 0;
  }
  
  const index = _nextEffectIndex++;
  _effectIndexMap.set(effectId, index);
  return index;
}

/**
 * Get effect index (0 if not registered)
 */
export function getEffectIndex(effectId) {
  return _effectIndexMap.get(effectId) ?? 0;
}

/**
 * Get effect by index
 */
export function getEffectByIndex(index) {
  for (const [id, idx] of _effectIndexMap.entries()) {
    if (idx === index) {
      const registry = getParticleEffectRegistry();
      return registry.get(id) || EFFECT_PRESETS[id] || null;
    }
  }
  return EFFECT_PRESETS.sphere;
}

// ============================================================================
// SHADER GENERATION
// ============================================================================

/**
 * Generate the multi-effect collision shader
 * This shader supports switching between different SDFs based on effectId
 */
export function generateMultiEffectCollisionShader(registeredEffects) {
  // Collect SDF functions for each registered effect
  const sdfFunctions = [];
  const effectCases = [];
  
  for (const [effectId, index] of registeredEffects) {
    const effect = getParticleEffectRegistry()?.get(effectId) || EFFECT_PRESETS[effectId] || EFFECT_PRESETS.sphere;
    const sdfCode = effect.sdfCode || EFFECT_PRESETS.sphere.sdfCode;
    const helperCode = effect.helperCode || '';
    
    // Rename customSDF to unique function name
    const uniqueName = `customSDF_${index}`;
    const renamedSdf = sdfCode.replace(/fn\s+customSDF\s*\(/g, `fn ${uniqueName}(`);
    const renamedHelper = helperCode.replace(/fn\s+customSDF\s*\(/g, `fn ${uniqueName}(`);
    
    sdfFunctions.push(`
// Effect: ${effect.name} (index ${index})
${renamedHelper}
${renamedSdf}
`);
    
    effectCases.push(`    case ${index}u: { return ${uniqueName}(p, time, params); }`);
  }
  
  // Add default sphere if no effects registered
  if (sdfFunctions.length === 0) {
    sdfFunctions.push(`
fn customSDF_0(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  return length(p) - 1.0;
}
`);
    effectCases.push(`    case 0u: { return customSDF_0(p, time, params); }`);
  }
  
  return /* wgsl */`
${SDF_HELPERS_WGSL}

// ============================================================================
// REGISTERED EFFECT SDF FUNCTIONS
// ============================================================================
${sdfFunctions.join('\n')}

// ============================================================================
// EFFECT DISPATCHER
// ============================================================================

fn evaluateEffectSDF(effectIndex: u32, p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  switch(effectIndex) {
${effectCases.join('\n')}
    default: { return length(p) - 1.0; }
  }
}

// Calculate normal from SDF gradient for any effect
fn calcEffectSDFNormal(effectIndex: u32, p: vec3<f32>, time: f32, params: vec4<f32>) -> vec3<f32> {
  let e = vec2(0.001, 0.0);
  return normalize(vec3(
    evaluateEffectSDF(effectIndex, p + e.xyy, time, params) - evaluateEffectSDF(effectIndex, p - e.xyy, time, params),
    evaluateEffectSDF(effectIndex, p + e.yxy, time, params) - evaluateEffectSDF(effectIndex, p - e.yxy, time, params),
    evaluateEffectSDF(effectIndex, p + e.yyx, time, params) - evaluateEffectSDF(effectIndex, p - e.yyx, time, params)
  ));
}

// ============================================================================
// PARTICLE COLLISION UTILITIES
// ============================================================================

// Evaluate particle SDF at world position
fn evaluateParticleSDF(
  queryPos: vec3<f32>,
  particlePos: vec3<f32>,
  particleRadius: f32,
  effectIndex: u32,
  time: f32,
  params: vec4<f32>
) -> f32 {
  let localPos = (queryPos - particlePos) / particleRadius;
  return evaluateEffectSDF(effectIndex, localPos, time, params) * particleRadius;
}

// Get collision normal
fn getParticleCollisionNormal(
  queryPos: vec3<f32>,
  particlePos: vec3<f32>,
  particleRadius: f32,
  effectIndex: u32,
  time: f32,
  params: vec4<f32>
) -> vec3<f32> {
  let localPos = (queryPos - particlePos) / particleRadius;
  return calcEffectSDFNormal(effectIndex, localPos, time, params);
}
`;
}

// ============================================================================
// COLLISION COMPUTE PIPELINE
// ============================================================================

/**
 * Create collision compute pipeline with custom SDFs
 */
export function createCollisionPipeline(device, options = {}) {
  const registeredEffects = Array.from(_effectIndexMap.entries());
  const shaderCode = generateMultiEffectCollisionShader(registeredEffects);
  
  // Add compute shader wrapper
  const computeShader = /* wgsl */`
${shaderCode}

struct CollisionParams {
  time: f32,
  dt: f32,
  particleCount: u32,
  stiffness: f32,
  damping: f32,
  _pad: vec3<f32>,
}

struct Particle {
  position: vec3<f32>,
  radius: f32,
  velocity: vec3<f32>,
  effectIndex: u32,
  effectParams: vec4<f32>,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: CollisionParams;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn collideParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  
  let pi = particles[i];
  var totalForce = vec3<f32>(0.0);
  
  // Check against all other particles (naive O(n²) - use spatial hash in practice)
  for (var j = 0u; j < params.particleCount; j++) {
    if (i == j) { continue; }
    
    let pj = particles[j];
    let toJ = pj.position - pi.position;
    let dist = length(toJ);
    let combinedRadius = pi.radius + pj.radius;
    
    // Early out for far particles
    if (dist > combinedRadius * 2.0) { continue; }
    
    // Evaluate SDF of particle j at position of particle i
    let sdfDist = evaluateParticleSDF(
      pi.position,
      pj.position,
      pj.radius,
      pj.effectIndex,
      params.time,
      pj.effectParams
    );
    
    if (sdfDist < 0.0) {
      // Collision! Get normal and push out
      let normal = getParticleCollisionNormal(
        pi.position,
        pj.position,
        pj.radius,
        pj.effectIndex,
        params.time,
        pj.effectParams
      );
      
      let penetration = -sdfDist;
      let pushForce = normal * penetration * params.stiffness;
      
      // Add damping based on relative velocity
      let relVel = pi.velocity - pj.velocity;
      let dampForce = -dot(relVel, normal) * normal * params.damping;
      
      totalForce += pushForce + dampForce;
    }
  }
  
  // Apply collision force to velocity
  particles[i].velocity += totalForce * params.dt;
}
`;

  const shaderModule = device.createShaderModule({
    label: 'ParticleCollisionSDF.compute',
    code: computeShader,
  });
  
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'ParticleCollisionSDF.bindGroupLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  
  const pipelineLayout = device.createPipelineLayout({
    label: 'ParticleCollisionSDF.pipelineLayout',
    bindGroupLayouts: [bindGroupLayout],
  });
  
  const pipeline = device.createComputePipeline({
    label: 'ParticleCollisionSDF.pipeline',
    layout: pipelineLayout,
    compute: {
      module: shaderModule,
      entryPoint: 'collideParticles',
    },
  });
  
  return {
    pipeline,
    bindGroupLayout,
    shaderModule,
    workgroupSize: WORKGROUP_SIZE,
  };
}

// ============================================================================
// COLLISION SYSTEM MANAGER
// ============================================================================

export class ParticleCollisionSDFSystem {
  constructor(device) {
    this._device = device;
    this._pipeline = null;
    this._bindGroupLayout = null;
    this._paramsBuffer = null;
    this._dirty = true;
  }

  /**
   * Initialize/rebuild the collision pipeline
   */
  rebuild() {
    if (!this._dirty) return;
    
    const result = createCollisionPipeline(this._device);
    this._pipeline = result.pipeline;
    this._bindGroupLayout = result.bindGroupLayout;
    this._workgroupSize = result.workgroupSize;
    
    // Create params buffer if needed
    if (!this._paramsBuffer) {
      this._paramsBuffer = this._device.createBuffer({
        label: 'ParticleCollisionSDF.paramsBuffer',
        size: 32, // CollisionParams struct size
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    
    this._dirty = false;
  }

  /**
   * Mark pipeline as needing rebuild (call when effects change)
   */
  markDirty() {
    this._dirty = true;
  }

  /**
   * Register effect for collision
   */
  registerEffect(effectId) {
    const index = registerEffectForCollision(effectId);
    this._dirty = true;
    return index;
  }

  /**
   * Create bind group for particle buffer
   */
  createBindGroup(particleBuffer) {
    this.rebuild();
    
    return this._device.createBindGroup({
      label: 'ParticleCollisionSDF.bindGroup',
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: { buffer: this._paramsBuffer } },
      ],
    });
  }

  /**
   * Dispatch collision computation
   */
  dispatch(encoder, bindGroup, params) {
    this.rebuild();
    
    // Update params buffer
    const paramsData = new Float32Array([
      params.time || 0,
      params.dt || 0.016,
      0, 0, // u32 particleCount will be set separately
    ]);
    const paramsU32 = new Uint32Array(paramsData.buffer);
    paramsU32[2] = params.particleCount || 0;
    
    const fullParams = new Float32Array(8);
    fullParams[0] = params.time || 0;
    fullParams[1] = params.dt || 0.016;
    fullParams[3] = params.stiffness || 100.0;
    fullParams[4] = params.damping || 0.5;
    const fullU32 = new Uint32Array(fullParams.buffer);
    fullU32[2] = params.particleCount || 0;
    
    this._device.queue.writeBuffer(this._paramsBuffer, 0, fullParams);
    
    const pass = encoder.beginComputePass({
      label: 'ParticleCollisionSDF.pass',
    });
    
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, bindGroup);
    
    const workgroups = Math.ceil((params.particleCount || 1) / this._workgroupSize);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
  }

  /**
   * Destroy resources
   */
  destroy() {
    if (this._paramsBuffer) {
      this._paramsBuffer.destroy();
      this._paramsBuffer = null;
    }
    this._pipeline = null;
    this._bindGroupLayout = null;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a particle collision SDF system
 */
export function createParticleCollisionSDFSystem(device) {
  return new ParticleCollisionSDFSystem(device);
}

export default {
  registerEffectForCollision,
  getEffectIndex,
  getEffectByIndex,
  generateMultiEffectCollisionShader,
  createCollisionPipeline,
  ParticleCollisionSDFSystem,
  createParticleCollisionSDFSystem,
};
