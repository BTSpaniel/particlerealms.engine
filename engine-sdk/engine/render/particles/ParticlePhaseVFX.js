// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticlePhaseVFX.js - Phase Transition Visual Effects Manager (GAP 43)
 * 
 * Manages phase-transition visual effects for particle rendering.
 * Provides WGSL snippet injection for existing billboard/SDF fragment shaders.
 * Controls: frost crystallization, melt sheen, boiling bubbles, ionization arcs.
 * 
 * The actual rendering is done by injecting applyPhaseVFX() into existing
 * particle fragment shaders. This module manages the configuration and
 * provides the WGSL code for inclusion.
 * 
 * Usage:
 *   import { phaseVFXWGSL } from '../shaders/modules/core/particles_phase_vfx.js';
 *   // Include phaseVFXWGSL in particle fragment shader
 *   // Call applyPhaseVFX(baseColor, uv, time, phase, temperature, latentProgress)
 */

import { phaseVFXWGSL } from "../shaders/modules/core/particles_phase_vfx.js";

// Re-export the WGSL for shader composition
export { phaseVFXWGSL };

/**
 * Phase VFX configuration.
 * These values are passed to shaders via existing particle uniform buffers.
 */
export const PHASE_VFX_DEFAULTS = {
  enableFrost: true,
  enableMelt: true,
  enableBoil: true,
  enableIonize: true,
  frostIntensity: 1.0,
  meltGlossiness: 0.8,
  boilBubbleDensity: 1.0,
  ionizeGlowStrength: 2.0,
};

/**
 * Create a phase VFX configuration object.
 * @param {Object} [overrides]
 * @returns {Object}
 */
export function createPhaseVFXConfig(overrides = {}) {
  return { ...PHASE_VFX_DEFAULTS, ...overrides };
}

/**
 * Get the WGSL snippet for phase VFX.
 * Include this in particle fragment shaders to enable phase transition effects.
 * @returns {string} WGSL code
 */
export function getPhaseVFXShader() {
  return phaseVFXWGSL;
}
