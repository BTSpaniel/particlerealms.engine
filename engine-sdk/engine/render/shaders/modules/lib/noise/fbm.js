// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Fractal Brownian Motion (FBM)
 * 
 * Layered noise functions with decreasing amplitude and increasing frequency.
 * Creates natural-looking organic patterns with detail at multiple scales.
 */

import { valueNoiseWGSL } from './value.js';

export const fbmWGSL = /* wgsl */`
${valueNoiseWGSL}

// ============================================================================
// FRACTAL BROWNIAN MOTION - Multi-octave noise for natural patterns
// ============================================================================

// 2D FBM with configurable octaves
fn fbm2d(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * valueNoise2d(pos * frequency);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
    // Rotate each octave to reduce axis-aligned artifacts
    pos = vec2<f32>(pos.x * 0.866 - pos.y * 0.5, pos.x * 0.5 + pos.y * 0.866);
  }
  
  return value;
}

// 3D FBM with configurable octaves
fn fbm3d(p: vec3<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * valueNoise3d(pos * frequency);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
  }
  
  return value;
}

// Ridged FBM - creates sharp features (mountains, cracks)
fn ridgedFbm2d(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * ridgedNoise2d(pos * frequency);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
    pos = vec2<f32>(pos.x * 0.866 - pos.y * 0.5, pos.x * 0.5 + pos.y * 0.866);
  }
  
  return value;
}

fn ridgedFbm3d(p: vec3<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * ridgedNoise3d(pos * frequency);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
  }
  
  return value;
}

// Turbulence - absolute value of noise (creates billowy clouds)
fn turbulence2d(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * abs(valueNoise2d(pos * frequency) * 2.0 - 1.0);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
    pos = vec2<f32>(pos.x * 0.866 - pos.y * 0.5, pos.x * 0.5 + pos.y * 0.866);
  }
  
  return value;
}

fn turbulence3d(p: vec3<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * abs(valueNoise3d(pos * frequency) * 2.0 - 1.0);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
  }
  
  return value;
}
`;
