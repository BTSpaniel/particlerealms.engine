// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CustomSDFCollisionBridge.js - Bridge Custom Particle Effects to Physics Collision
 * 
 * Ensures visual SDF and collision SDF are IDENTICAL by:
 * 1. Generating collision shaders from the same SDF code as visual effects
 * 2. Providing a unified API for registering custom effects with physics
 * 3. Syncing effect parameters between render and simulation
 * 
 * This ensures "what you see is what collides" - particles collide exactly
 * with the shape that's being rendered.
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { SDF_HELPERS_WGSL, EFFECT_PRESETS } from "../../render/particles/CustomParticleEffect.js";
import { getParticleEffectRegistry } from "../../render/particles/ParticleEffectRegistry.js";
import { registerEffectForCollision, getEffectIndex } from "../../render/particles/ParticleCollisionSDF.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_CUSTOM_EFFECT_COLLIDERS = 64;
const WORKGROUP_SIZE = 64;

// Reusable buffers to avoid GC pressure
const _customColliderData = new Float32Array(16); // center(3) + radius(1) + effectIndex(1) + params(4) + padding(7)
const _customParamsData = new Float32Array(8);

// ============================================================================
// CUSTOM EFFECT COLLISION SHADER GENERATOR
// ============================================================================

/**
 * Generate collision shader that uses the SAME SDF code as visual rendering
 * This is the key to ensuring physics matches visuals exactly
 */
export function generateCustomEffectCollisionShader(registeredEffects) {
  // Collect all SDF functions from registered effects
  const sdfFunctions = [];
  const effectCases = [];
  
  for (const [effectId, index] of registeredEffects) {
    const registry = getParticleEffectRegistry();
    const effect = registry?.get(effectId) || EFFECT_PRESETS[effectId] || EFFECT_PRESETS.sphere;
    
    // Use the EXACT same SDF code as visual rendering
    const sdfCode = effect.sdfCode || EFFECT_PRESETS.sphere.sdfCode;
    
    // Rename customSDF to unique function name for this effect
    const uniqueName = `customSDF_${index}`;
    const renamedSdf = sdfCode.replace(/fn\s+customSDF\s*\(/g, `fn ${uniqueName}(`);
    
    sdfFunctions.push(`
// Effect: ${effect.name} (index ${index}) - SAME AS VISUAL
${renamedSdf}
`);
    
    effectCases.push(`    case ${index}u: { return ${uniqueName}(p, time, params); }`);
  }
  
  // Default sphere if no effects
  if (sdfFunctions.length === 0) {
    sdfFunctions.push(`
fn customSDF_0(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  return length(p) - 1.0;
}
`);
    effectCases.push(`    case 0u: { return customSDF_0(p, time, params); }`);
  }
  
  return /* wgsl */`
// ============================================================================
// SDF HELPERS (shared with visual rendering)
// ============================================================================
${SDF_HELPERS_WGSL}

// ============================================================================
// CUSTOM EFFECT SDF FUNCTIONS (identical to visual)
// ============================================================================
${sdfFunctions.join('\n')}

// ============================================================================
// EFFECT DISPATCHER
// ============================================================================

fn evaluateCustomSDF(effectIndex: u32, p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  switch(effectIndex) {
${effectCases.join('\n')}
    default: { return length(p) - 1.0; }
  }
}

fn calcCustomSDFNormal(effectIndex: u32, p: vec3<f32>, time: f32, params: vec4<f32>) -> vec3<f32> {
  let e = vec2(0.001, 0.0);
  return normalize(vec3(
    evaluateCustomSDF(effectIndex, p + e.xyy, time, params) - evaluateCustomSDF(effectIndex, p - e.xyy, time, params),
    evaluateCustomSDF(effectIndex, p + e.yxy, time, params) - evaluateCustomSDF(effectIndex, p - e.yxy, time, params),
    evaluateCustomSDF(effectIndex, p + e.yyx, time, params) - evaluateCustomSDF(effectIndex, p - e.yyx, time, params)
  ));
}
`;
}

// ============================================================================
// CUSTOM EFFECT COLLIDER SYSTEM
// ============================================================================

/**
 * Create custom effect collision system
 * Uses the same SDF code as visual rendering for exact physics/visual match
 */
export function createCustomEffectCollisionSystem(device, registeredEffects = []) {
  const sdfCode = generateCustomEffectCollisionShader(registeredEffects);
  
  const computeShader = /* wgsl */`
${sdfCode}

struct CustomCollider {
  center: vec3<f32>,
  radius: f32,
  effectIndex: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
  effectParams: vec4<f32>,
}

struct CollisionParams {
  time: f32,
  dt: f32,
  particleCount: u32,
  colliderCount: u32,
  bounciness: f32,
  friction: f32,
  usePerParticleSize: f32,
  fallbackRadius: f32,
}

@group(0) @binding(0) var<uniform> params: CollisionParams;
@group(0) @binding(1) var<storage, read> colliders: array<CustomCollider>;
@group(0) @binding(2) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> particleMeta: array<vec4<f32>>;

// ============================================================================
// EXTRACT PARTICLE PROPERTIES FROM PACKED META
// Packing: mass * 1e8 + drag * 1e6 + size * 1e4 + renderMode * 1e3 + shape * 10 + behavior
// ============================================================================

fn extractParticleSize(packedMeta: f32) -> f32 {
    let sizeEncoded = (floor(packedMeta / 1e4) % 100.0) * 0.1;
    return max(0.05, sizeEncoded * 0.5);
}

fn extractParticleShape(packedMeta: f32) -> u32 {
    return u32(floor(packedMeta / 10.0)) % 10u;
}

// Get collision radius accounting for shape, age animation, and depth blend
fn getParticleCollisionRadius(packedMeta: f32, age: f32, lifetime: f32) -> f32 {
    let baseRadius = extractParticleSize(packedMeta);
    let shape = extractParticleShape(packedMeta);
    
    // Age-based size animation (matches vertex shader)
    let t = clamp(age / max(lifetime, 0.1), 0.0, 1.0);
    let fadeIn = smoothstep(0.0, 0.08, t);
    let fadeOut = 1.0 - smoothstep(0.9, 1.0, t);
    let sizeFactor = fadeIn * fadeOut * 0.9 + 0.1;
    
    // Shape-specific collision scale
    var shapeScale = 1.0;
    switch(shape) {
        case 1u: { shapeScale = 0.5; }  // Point - smaller
        case 2u: { shapeScale = 0.7; }  // Soft - penetrates more
        case 4u: { shapeScale = 0.6; }  // Ring - hollow
        case 7u: { shapeScale = 0.6; }  // Mist - very soft
        default: { shapeScale = 1.0; }
    }
    
    // Depth blend offset for soft edges
    let depthBlendOffset = 0.15;
    
    return baseRadius * sizeFactor * shapeScale * (1.0 - depthBlendOffset);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn collideWithCustomEffects(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  
  let age = positions[i].w;
  let lifetime = velocities[i].w;
  
  // Dead particle early-out: skip collision for particles past lifetime
  if (age >= lifetime) { return; }
  
  var pos = positions[i].xyz;
  var vel = velocities[i].xyz;
  
  // Get per-particle collision radius with shape and age adaptation
  let pMeta = particleMeta[i];
  let particleRadius = select(
    params.fallbackRadius,
    getParticleCollisionRadius(pMeta.w, age, lifetime),
    params.usePerParticleSize > 0.5
  );
  
  for (var c = 0u; c < params.colliderCount; c++) {
    let collider = colliders[c];
    
    // Transform to collider local space
    let localPos = (pos - collider.center) / collider.radius;
    
    // Evaluate using the SAME SDF as visual rendering
    let dist = evaluateCustomSDF(
      collider.effectIndex,
      localPos,
      params.time,
      collider.effectParams
    ) * collider.radius;
    
    let penetration = particleRadius - dist;
    
    if (penetration > 0.0) {
      // Get collision normal from SDF gradient
      let normal = calcCustomSDFNormal(
        collider.effectIndex,
        localPos,
        params.time,
        collider.effectParams
      );
      
      // Push out of collision
      pos += normal * penetration;
      
      // Reflect velocity with bounciness
      let velNormal = dot(vel, normal);
      if (velNormal < 0.0) {
        vel -= normal * velNormal * (1.0 + params.bounciness);
        
        // Apply friction to tangent component
        let tangent = vel - normal * dot(vel, normal);
        vel = normal * dot(vel, normal) + tangent * (1.0 - params.friction);
      }
    }
  }
  
  positions[i] = vec4(pos, positions[i].w);
  velocities[i] = vec4(vel, velocities[i].w);
}
`;

  const shaderModule = device.createShaderModule({
    label: "CustomEffectCollision.shader",
    code: computeShader,
  });
  
  // Collider buffer: 48 bytes per collider (center + radius + effectIndex + pad + params)
  const colliderBuffer = createStorageBuffer(device, MAX_CUSTOM_EFFECT_COLLIDERS * 48, {
    label: "CustomEffectCollision.colliders",
  });
  
  const paramsBuffer = createUniformBuffer(device, 32, {
    label: "CustomEffectCollision.params",
  });
  
  const pipeline = device.createComputePipeline({
    label: "CustomEffectCollision.pipeline",
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "collideWithCustomEffects" },
  });
  
  labelResource(colliderBuffer, "CustomEffectCollision.colliders");
  labelResource(paramsBuffer, "CustomEffectCollision.params");
  
  return {
    shaderModule,
    colliderBuffer,
    paramsBuffer,
    pipeline,
    maxColliders: MAX_CUSTOM_EFFECT_COLLIDERS,
    colliderCount: 0,
    colliders: [],
    bindGroup: null,
    registeredEffects: new Map(registeredEffects),
  };
}

/**
 * Add a custom effect collider
 * Uses the same effect ID as visual rendering for exact match
 */
export function addCustomEffectCollider(system, device, effectId, center, radius, effectParams = [0, 0, 0, 0]) {
  if (system.colliderCount >= system.maxColliders) {
    console.warn("[CustomEffectCollision] Max colliders reached");
    return -1;
  }
  
  // Get effect index (same as used for visual rendering)
  const effectIndex = getEffectIndex(effectId);
  
  // Pack collider data: center(3) + radius(1) + effectIndex(1) + pad(3) + params(4)
  const colliderData = new Float32Array([
    center[0], center[1], center[2], radius,
    effectIndex, 0, 0, 0, // effectIndex as float for buffer, plus padding
    effectParams[0] || 0, effectParams[1] || 0, effectParams[2] || 0, effectParams[3] || 0,
  ]);
  
  // Fix: effectIndex needs to be written as u32
  const dataView = new DataView(colliderData.buffer);
  dataView.setUint32(16, effectIndex, true); // offset 16 = after center+radius
  
  const offset = system.colliderCount * 48;
  updateBuffer(device, system.colliderBuffer, colliderData, offset);
  
  system.colliders.push({ effectId, effectIndex, center, radius, effectParams });
  system.colliderCount++;
  
  return system.colliderCount - 1;
}

/**
 * Update collider transform (for moving effects)
 */
export function updateCustomEffectCollider(system, device, index, center, radius, effectParams) {
  if (index < 0 || index >= system.colliderCount) return;
  
  const collider = system.colliders[index];
  if (center) collider.center = center;
  if (radius !== undefined) collider.radius = radius;
  if (effectParams) collider.effectParams = effectParams;
  
  const colliderData = new Float32Array([
    collider.center[0], collider.center[1], collider.center[2], collider.radius,
    collider.effectIndex, 0, 0, 0,
    collider.effectParams[0] || 0, collider.effectParams[1] || 0, 
    collider.effectParams[2] || 0, collider.effectParams[3] || 0,
  ]);
  
  const dataView = new DataView(colliderData.buffer);
  dataView.setUint32(16, collider.effectIndex, true);
  
  const offset = index * 48;
  updateBuffer(device, system.colliderBuffer, colliderData, offset);
}

/**
 * Initialize bind group with particle buffers
 * @param {object} system - Custom effect collision system
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUBuffer} positionsBuffer - Particle positions buffer
 * @param {GPUBuffer} velocitiesBuffer - Particle velocities buffer
 * @param {GPUBuffer} metaBuffer - Particle meta buffer (for per-particle size)
 */
export function initCustomEffectCollisionBindGroup(system, device, positionsBuffer, velocitiesBuffer, metaBuffer = null) {
  const entries = [
    { binding: 0, resource: { buffer: system.paramsBuffer } },
    { binding: 1, resource: { buffer: system.colliderBuffer } },
    { binding: 2, resource: { buffer: positionsBuffer } },
    { binding: 3, resource: { buffer: velocitiesBuffer } },
  ];
  
  // Add meta buffer for per-particle size
  if (metaBuffer) {
    entries.push({ binding: 4, resource: { buffer: metaBuffer } });
    system.hasMetaBuffer = true;
  } else {
    // Create a dummy buffer if no meta buffer provided
    if (!system.dummyMetaBuffer) {
      system.dummyMetaBuffer = createStorageBuffer(device, 16, { label: "CustomEffectCollision.dummyMeta" });
    }
    entries.push({ binding: 4, resource: { buffer: system.dummyMetaBuffer } });
    system.hasMetaBuffer = false;
  }
  
  system.bindGroup = device.createBindGroup({
    label: "CustomEffectCollision.bindGroup",
    layout: system.pipeline.getBindGroupLayout(0),
    entries,
  });
}

/**
 * Execute custom effect collision pass
 * @param {object} system - Custom effect collision system
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUQueue} queue - WebGPU queue
 * @param {number} particleCount - Number of particles
 * @param {number} time - Current simulation time
 * @param {number} dt - Time step
 * @param {number} bounciness - Bounce coefficient (0-1)
 * @param {number} friction - Friction coefficient (0-1)
 * @param {number} fallbackRadius - Fallback particle radius if no meta buffer
 */
export function executeCustomEffectCollision(system, device, queue, particleCount, time, dt, bounciness = 0.3, friction = 0.1, fallbackRadius = 0.1) {
  if (!system.bindGroup || system.colliderCount === 0 || particleCount === 0) return;
  
  // Use per-particle size if meta buffer is available
  const usePerParticleSize = system.hasMetaBuffer ? 1.0 : 0.0;
  
  // Update params - reuse buffer
  // CollisionParams: time, dt, particleCount(u32), colliderCount(u32), bounciness, friction, usePerParticleSize, fallbackRadius
  _customParamsData[0] = time;
  _customParamsData[1] = dt;
  _customParamsData[2] = particleCount;
  _customParamsData[3] = system.colliderCount;
  _customParamsData[4] = bounciness;
  _customParamsData[5] = friction;
  _customParamsData[6] = usePerParticleSize;
  _customParamsData[7] = fallbackRadius;
  
  // Fix: particleCount and colliderCount need to be u32
  const dataView = new DataView(_customParamsData.buffer);
  dataView.setUint32(8, particleCount, true);
  dataView.setUint32(12, system.colliderCount, true);
  
  queue.writeBuffer(system.paramsBuffer, 0, _customParamsData);
  
  const encoder = device.createCommandEncoder({ label: "CustomEffectCollision.encoder" });
  const pass = encoder.beginComputePass({ label: "CustomEffectCollision.pass" });
  pass.setPipeline(system.pipeline);
  pass.setBindGroup(0, system.bindGroup);
  pass.dispatchWorkgroups(Math.ceil(particleCount / WORKGROUP_SIZE));
  pass.end();
  
  queue.submit([encoder.finish()]);
}

/**
 * Rebuild collision system when effects change
 * Call this after registering new custom effects
 */
export function rebuildCustomEffectCollisionSystem(device, existingSystem) {
  const registeredEffects = Array.from(existingSystem.registeredEffects.entries());
  const newSystem = createCustomEffectCollisionSystem(device, registeredEffects);
  
  // Copy existing colliders
  for (const collider of existingSystem.colliders) {
    addCustomEffectCollider(
      newSystem, device,
      collider.effectId,
      collider.center,
      collider.radius,
      collider.effectParams
    );
  }
  
  return newSystem;
}

/**
 * Clear all colliders
 */
export function clearCustomEffectColliders(system) {
  system.colliderCount = 0;
  system.colliders = [];
}

/**
 * Destroy system and release GPU resources
 */
export function destroyCustomEffectCollisionSystem(system) {
  if (system.colliderBuffer) system.colliderBuffer.destroy();
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  system.bindGroup = null;
  system.colliders = [];
  system.colliderCount = 0;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  createCustomEffectCollisionSystem,
  addCustomEffectCollider,
  updateCustomEffectCollider,
  initCustomEffectCollisionBindGroup,
  executeCustomEffectCollision,
  rebuildCustomEffectCollisionSystem,
  clearCustomEffectColliders,
  destroyCustomEffectCollisionSystem,
};
