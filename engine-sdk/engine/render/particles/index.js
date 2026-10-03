// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Particle System Exports
 * 
 * Barrel file for easy importing of all particle-related modules.
 */

// Core particle effect system
export { 
  EFFECT_PRESETS,
  SDF_HELPERS_WGSL,
  generateVisualShader,
  generateCollisionShader,
  validateEffect,
  compileEffect,
  createEffect,
  cloneEffect,
  getPresets,
  getPreset,
} from './CustomParticleEffect.js';

// Effect registry (persistence)
export {
  ParticleEffectRegistry,
  getParticleEffectRegistry,
  initParticleEffectRegistry,
} from './ParticleEffectRegistry.js';

// Collision SDF system
export {
  registerEffectForCollision,
  getEffectIndex,
  getEffectByIndex,
  generateMultiEffectCollisionShader,
  createCollisionPipeline,
  ParticleCollisionSDFSystem,
  createParticleCollisionSDFSystem,
} from './ParticleCollisionSDF.js';

// Engine integration
export {
  initCustomParticleEffects,
  getCompiledEffect,
  getCollisionSDFSystem,
  applyEffectToEmitter,
  getEffectForRendering,
  createEffectParamsData,
  getParticleSDF,
  isCustomEffectsInitialized,
} from './CustomParticleEffectIntegration.js';

// Existing particle renderers
export { createParticleSdfRenderer, createParticleSdfDataBindGroup, setParticleSdfParams } from './ParticleSdfRenderer.js';

// GAP 39: Blackbody Radiation Renderer
export {
  createBlackbodySystem, createBlackbodyBindGroupLayout, getBlackbodyBindGroup,
  setBlackbodyEmission, destroyBlackbodySystem,
} from './ParticleBlackbodyRenderer.js';

// GAP 40: Electron Orbital Renderer
export {
  createOrbitalRenderer, initOrbitalBindGroups, renderOrbitals,
  destroyOrbitalRenderer,
} from './ParticleOrbitalRenderer.js';

// GAP 41: Bond Line Renderer
export {
  createBondRenderer, initBondRendererBindGroups, uploadBonds,
  renderBonds, destroyBondRenderer,
} from './ParticleBondRenderer.js';

// GAP 42: EM Field Visualizer
export {
  createFieldRenderer, initFieldRendererBindGroups, updateFieldProbes,
  renderFieldArrows, destroyFieldRenderer,
} from './ParticleFieldRenderer.js';

// GAP 43: Phase Transition VFX
export {
  phaseVFXWGSL, PHASE_VFX_DEFAULTS, createPhaseVFXConfig, getPhaseVFXShader,
} from './ParticlePhaseVFX.js';

// GAP 44: SPH Fluid Surface Renderer
export {
  createSPHSurfaceRenderer, initSPHSurfaceBindGroups, initSPHCompositeBindGroup,
  setSPHSurfaceTint, renderSPHSurface, compositeSPHSurface, destroySPHSurfaceRenderer,
} from './ParticleSPHSurfaceRenderer.js';

// Re-export simulation bridge for convenience
// The actual implementation is in engine/sim/particles/CustomSDFCollisionBridge.js
// This ensures visual and physics SDFs are identical
