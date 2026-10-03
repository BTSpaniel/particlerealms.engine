// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleEmitterLOD.js - Emitter-Level LOD System (GAP 19)
 * 
 * Distance/screen-size based LOD for particle emitters.
 * Unlike per-particle quality fade, this operates at the EMITTER level:
 *   - Reduce spawn rate by LOD tier
 *   - Disable expensive features (collision, turbulence) at distance
 *   - Switch renderer (billboard → point → cull) by distance
 *   - Scale particle lifetime to reduce total particle count
 * 
 * Matches Niagara scalability / PopcornFX LOD layers.
 * 
 * Usage:
 *   const lod = createEmitterLOD({ tiers: [...] });
 *   // Each frame:
 *   const tier = evaluateEmitterLOD(lod, cameraPos, emitterPos);
 *   // Use tier.spawnRateScale, tier.features, etc. to drive emitter config
 */

import { lerp } from '../../core/math/MathScalar.js';

// ============================================================================
// DEFAULT LOD TIERS
// ============================================================================

export const DEFAULT_LOD_TIERS = [
  {
    name: 'ultra',
    maxDistance: 30,
    spawnRateScale: 1.0,
    lifetimeScale: 1.0,
    sizeScale: 1.0,
    features: { collision: true, turbulence: true, shadows: true, softParticles: true },
    renderer: 'billboard',
  },
  {
    name: 'high',
    maxDistance: 80,
    spawnRateScale: 0.7,
    lifetimeScale: 0.9,
    sizeScale: 1.1,
    features: { collision: true, turbulence: true, shadows: false, softParticles: true },
    renderer: 'billboard',
  },
  {
    name: 'medium',
    maxDistance: 150,
    spawnRateScale: 0.4,
    lifetimeScale: 0.75,
    sizeScale: 1.3,
    features: { collision: false, turbulence: true, shadows: false, softParticles: false },
    renderer: 'billboard',
  },
  {
    name: 'low',
    maxDistance: 300,
    spawnRateScale: 0.15,
    lifetimeScale: 0.5,
    sizeScale: 1.5,
    features: { collision: false, turbulence: false, shadows: false, softParticles: false },
    renderer: 'point',
  },
  {
    name: 'culled',
    maxDistance: Infinity,
    spawnRateScale: 0,
    lifetimeScale: 0,
    sizeScale: 0,
    features: { collision: false, turbulence: false, shadows: false, softParticles: false },
    renderer: 'none',
  },
];

// ============================================================================
// LOD SYSTEM
// ============================================================================

/**
 * Create an emitter LOD controller.
 * @param {Object} config
 * @param {Array} config.tiers - Array of LOD tier definitions (sorted by maxDistance)
 * @param {number} config.hysteresis - Distance hysteresis to prevent LOD flicker (default 5.0)
 * @param {number} config.transitionSpeed - Blend speed between tiers (default 3.0, units/sec)
 */
export function createEmitterLOD(config = {}) {
  const tiers = config.tiers || DEFAULT_LOD_TIERS;
  
  // Ensure tiers are sorted by maxDistance
  const sortedTiers = [...tiers].sort((a, b) => a.maxDistance - b.maxDistance);

  return {
    tiers: sortedTiers,
    hysteresis: config.hysteresis ?? 5.0,
    transitionSpeed: config.transitionSpeed ?? 3.0,
    currentTierIndex: 0,
    currentBlend: 0, // 0-1 blend factor between current and next tier
    _lastDistance: 0,
  };
}

/**
 * Evaluate LOD tier for an emitter based on camera distance.
 * Returns the active tier config with interpolated values.
 * 
 * @param {Object} lod - LOD controller
 * @param {number[]|Float32Array} cameraPos - Camera position [x, y, z]
 * @param {number[]|Float32Array} emitterPos - Emitter world position [x, y, z]
 * @param {number} dt - Delta time for smooth transitions
 * @returns {Object} Active LOD tier with potentially interpolated values
 */
export function evaluateEmitterLOD(lod, cameraPos, emitterPos, dt = 1/60) {
  const dx = cameraPos[0] - emitterPos[0];
  const dy = cameraPos[1] - emitterPos[1];
  const dz = cameraPos[2] - emitterPos[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  lod._lastDistance = distance;

  // Find target tier
  let targetIndex = lod.tiers.length - 1;
  for (let i = 0; i < lod.tiers.length; i++) {
    if (distance < lod.tiers[i].maxDistance) {
      targetIndex = i;
      break;
    }
  }

  // Apply hysteresis: don't switch tier if we're within hysteresis range of boundary
  const currentTier = lod.tiers[lod.currentTierIndex];
  if (targetIndex !== lod.currentTierIndex) {
    const boundary = targetIndex > lod.currentTierIndex
      ? currentTier.maxDistance
      : lod.tiers[targetIndex].maxDistance;
    
    if (Math.abs(distance - boundary) < lod.hysteresis) {
      targetIndex = lod.currentTierIndex; // Stay on current tier
    }
  }

  // Smooth transition
  if (targetIndex !== lod.currentTierIndex) {
    lod.currentBlend += lod.transitionSpeed * dt;
    if (lod.currentBlend >= 1.0) {
      lod.currentTierIndex = targetIndex;
      lod.currentBlend = 0;
    }
  } else {
    lod.currentBlend = Math.max(0, lod.currentBlend - lod.transitionSpeed * dt);
  }

  const tier = lod.tiers[lod.currentTierIndex];

  // If transitioning, interpolate values with next tier
  if (lod.currentBlend > 0.01 && targetIndex !== lod.currentTierIndex) {
    const nextTier = lod.tiers[targetIndex];
    const t = lod.currentBlend;
    return {
      ...tier,
      tierIndex: lod.currentTierIndex,
      distance,
      blending: true,
      spawnRateScale: lerp(tier.spawnRateScale, nextTier.spawnRateScale, t),
      lifetimeScale: lerp(tier.lifetimeScale, nextTier.lifetimeScale, t),
      sizeScale: lerp(tier.sizeScale, nextTier.sizeScale, t),
    };
  }

  return {
    ...tier,
    tierIndex: lod.currentTierIndex,
    distance,
    blending: false,
  };
}

/**
 * Evaluate LOD by screen-space size instead of distance.
 * Useful for effects that vary in world scale.
 * 
 * @param {Object} lod - LOD controller
 * @param {number} screenSize - Approximate screen-space diameter in pixels
 * @param {number[]} screenThresholds - Pixel thresholds per tier [ultra, high, medium, low]
 */
export function evaluateEmitterLODByScreenSize(lod, screenSize, screenThresholds) {
  const thresholds = screenThresholds || [200, 100, 40, 10];
  
  let targetIndex = lod.tiers.length - 1;
  for (let i = 0; i < thresholds.length && i < lod.tiers.length; i++) {
    if (screenSize >= thresholds[i]) {
      targetIndex = i;
      break;
    }
  }

  lod.currentTierIndex = targetIndex;
  return lod.tiers[targetIndex];
}

/**
 * Get the current LOD tier without re-evaluation.
 */
export function getCurrentLODTier(lod) {
  return lod.tiers[lod.currentTierIndex];
}

/**
 * Force a specific LOD tier.
 */
export function setForcedLODTier(lod, tierIndex) {
  lod.currentTierIndex = Math.max(0, Math.min(tierIndex, lod.tiers.length - 1));
  lod.currentBlend = 0;
}
