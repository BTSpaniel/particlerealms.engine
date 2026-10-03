// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  PARTICLE_BUFFER_SCHEMA,
  PARTICLE_PARAMS_SCHEMA,
  EMITTER_CONFIG_SCHEMA,
  PARTICLE_SHAPES,
  RENDER_MODES,
  PARTICLE_BEHAVIORS,
  packParticleMeta,
  unpackParticleMeta,
  validateEmitterConfig,
  createDefaultEmitterConfig,
  createDefaultParticleParams,
  getShapeId,
  getRenderModeId,
  getBehaviorId,
} from "./ParticleSchema.js";

// Re-export schema utilities for convenience
export {
  PARTICLE_BUFFER_SCHEMA,
  PARTICLE_PARAMS_SCHEMA,
  EMITTER_CONFIG_SCHEMA,
  PARTICLE_SHAPES,
  RENDER_MODES,
  PARTICLE_BEHAVIORS,
  packParticleMeta,
  unpackParticleMeta,
  validateEmitterConfig,
  createDefaultEmitterConfig,
  createDefaultParticleParams,
  getShapeId,
  getRenderModeId,
  getBehaviorId,
};

export const DEFAULT_MAX_PARTICLES = 1000000;

// Advanced particle system configuration
export const PARTICLE_CONFIG = {
  // Buffer limits
  hardMaxParticles: 100000000,  // 100M particles max
  maxParticleChunks: 4,         // Number of chunked buffers (bypasses GPU buffer size limits)
  particleStrideBytes: 48,      // Bytes per particle (pos, vel, color = 3 * vec4)
  
  // Spatial grid for neighbor lookups
  gridDims: 64,                 // Grid cells per axis
  cellCap: 32,                  // Max particles per cell
  
  // Line connections
  maxLines: 100000,             // Max line connections
  connectionDistance: 2.3,      // Distance threshold for line connections
  
  // Adaptive quality
  adaptiveQuality: true,
  targetFps: 60,
  qualityScaleMin: 0.3,   // Never drop below 30% (was 10%)
  qualityScaleMax: 1.0,
  
  // Simulation bounds (infinite)
  bounds: 1e9,
};

// Compute workgroup sizes
export const WORKGROUP_SIZES = {
  clearGrid: 256,
  clearCounters: 64,
  seedParticles: 256,
  updateParticles: 256,
  binParticles: 256,
  generateLines: 256,
  finalizeIndirect: 64,
};
