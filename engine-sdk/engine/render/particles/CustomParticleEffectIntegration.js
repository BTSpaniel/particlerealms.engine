// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CustomParticleEffectIntegration.js - Integration Layer
 * 
 * Wires the custom particle effect system into the engine:
 * - Initializes registry on engine startup
 * - Provides utilities for applying effects to emitters
 * - Connects visual effects to collision system
 */

import { initParticleEffectRegistry, getParticleEffectRegistry } from './ParticleEffectRegistry.js';
import { EFFECT_PRESETS, generateVisualShader, generateCollisionShader } from './CustomParticleEffect.js';
import { registerEffectForCollision, getEffectIndex, createParticleCollisionSDFSystem } from './ParticleCollisionSDF.js';

// ============================================================================
// ENGINE INTEGRATION
// ============================================================================

let _initialized = false;
let _collisionSystem = null;
let _compiledEffects = new Map();

// Reusable buffer for effect params to avoid GC pressure
const _effectParamsBuffer = new Float32Array(4);

/**
 * Initialize the custom particle effect system
 * Call this during engine initialization
 */
export async function initCustomParticleEffects(device) {
  if (_initialized) return;
  
  console.log('[CustomParticleEffect] Initializing...');
  
  // Initialize registry (loads from IndexedDB)
  await initParticleEffectRegistry();
  const registry = getParticleEffectRegistry();
  
  // Register all built-in effects for collision
  for (const presetId of Object.keys(EFFECT_PRESETS)) {
    registerEffectForCollision(presetId);
  }
  
  // Register any saved custom effects
  for (const effect of registry.getCustomEffects()) {
    registerEffectForCollision(effect.id);
  }
  
  // Create collision system
  if (device) {
    _collisionSystem = createParticleCollisionSDFSystem(device);
  }
  
  // Subscribe to registry changes to register new effects
  registry.subscribe((event) => {
    if (event.type === 'save') {
      registerEffectForCollision(event.data.id);
      if (_collisionSystem) {
        _collisionSystem.markDirty();
      }
      // Clear compiled cache for this effect
      _compiledEffects.delete(event.data.id);
    }
  });
  
  _initialized = true;
  console.log('[CustomParticleEffect] Initialized with', Object.keys(EFFECT_PRESETS).length, 'presets');
}

/**
 * Get compiled effect shaders for an effect ID
 */
export async function getCompiledEffect(device, effectId) {
  // Check cache
  if (_compiledEffects.has(effectId)) {
    return _compiledEffects.get(effectId);
  }
  
  // Get effect from registry or presets
  const registry = getParticleEffectRegistry();
  const effect = registry?.get(effectId) || EFFECT_PRESETS[effectId] || EFFECT_PRESETS.sphere;
  
  // Generate shaders
  const visualShaderCode = generateVisualShader(effect);
  const collisionShaderCode = generateCollisionShader(effect);
  
  // Compile shaders
  const visualModule = device.createShaderModule({
    label: `CustomEffect.${effectId}.visual`,
    code: visualShaderCode,
  });
  
  const collisionModule = device.createShaderModule({
    label: `CustomEffect.${effectId}.collision`,
    code: collisionShaderCode,
  });
  
  const compiled = {
    effect,
    visualModule,
    collisionModule,
    visualShaderCode,
    collisionShaderCode,
    effectIndex: getEffectIndex(effectId),
  };
  
  _compiledEffects.set(effectId, compiled);
  return compiled;
}

/**
 * Get the collision SDF system
 */
export function getCollisionSDFSystem() {
  return _collisionSystem;
}

/**
 * Apply a custom effect to a particle emitter component
 */
export function applyEffectToEmitter(emitterComponent, effectId, params = null) {
  emitterComponent.useCustomEffect = true;
  emitterComponent.effectId = effectId;
  
  if (params) {
    emitterComponent.effectParams = [
      params.x ?? params[0] ?? 0,
      params.y ?? params[1] ?? 0,
      params.z ?? params[2] ?? 0,
      params.w ?? params[3] ?? 0,
    ];
  }
  
  // Register for collision if not already
  registerEffectForCollision(effectId);
  
  return emitterComponent;
}

/**
 * Get effect data for rendering
 */
export function getEffectForRendering(effectId) {
  const registry = getParticleEffectRegistry();
  const effect = registry?.get(effectId) || EFFECT_PRESETS[effectId] || EFFECT_PRESETS.sphere;
  
  return {
    effect,
    effectIndex: getEffectIndex(effectId),
    sdfCode: effect.sdfCode,
    colorCode: effect.colorCode,
  };
}

/**
 * Create effect parameters buffer data for GPU
 * Returns a reusable Float32Array - DO NOT modify after passing to GPU
 */
export function createEffectParamsData(emitter) {
  if (!emitter.useCustomEffect) {
    _effectParamsBuffer[0] = 0;
    _effectParamsBuffer[1] = 0;
    _effectParamsBuffer[2] = 0;
    _effectParamsBuffer[3] = 0;
    return _effectParamsBuffer;
  }
  
  const params = emitter.effectParams || [0, 0, 0, 0];
  _effectParamsBuffer[0] = params[0] || 0;
  _effectParamsBuffer[1] = params[1] || 0;
  _effectParamsBuffer[2] = params[2] || 0;
  _effectParamsBuffer[3] = params[3] || 0;
  return _effectParamsBuffer;
}

// ============================================================================
// PARTICLE SYSTEM HELPERS
// ============================================================================

/**
 * Get the effective SDF for a particle (for collision queries)
 * Returns a function that evaluates the SDF at a local position
 */
export function getParticleSDF(effectId) {
  const effect = getParticleEffectRegistry()?.get(effectId) || EFFECT_PRESETS[effectId] || EFFECT_PRESETS.sphere;
  
  // Return a simple sphere SDF for CPU fallback
  // GPU uses the actual shader code
  return (localPos, time, params) => {
    // Default sphere SDF
    const len = Math.sqrt(
      localPos[0] * localPos[0] + 
      localPos[1] * localPos[1] + 
      localPos[2] * localPos[2]
    );
    return len - 1.0;
  };
}

/**
 * Check if custom effects system is initialized
 */
export function isCustomEffectsInitialized() {
  return _initialized;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  initCustomParticleEffects,
  getCompiledEffect,
  getCollisionSDFSystem,
  applyEffectToEmitter,
  getEffectForRendering,
  createEffectParamsData,
  getParticleSDF,
  isCustomEffectsInitialized,
};
