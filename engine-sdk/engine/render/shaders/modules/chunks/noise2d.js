// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared 2D Noise Functions for WGSL Shaders
 * 
 * Used by: particles_billboard, volume_smoke, future effects
 * 
 * Functions provided:
 *   - hash2d(p) - Pseudo-random hash for 2D position
 *   - noise2d(p) - Smooth value noise
 *   - fbm2d(p) - Fractal Brownian Motion (4 octaves)
 */

export const noise2dWGSL = /* wgsl */`
fn noise2dFractScalar(value : f32) -> f32 {
  return value - floor(value);
}

fn noise2dFractVec(p : vec2<f32>) -> vec2<f32> {
  return p - floor(p);
}

// Simple hash for pseudo-random noise
fn hash2d(p : vec2<f32>) -> f32 {
  let k = vec2<f32>(0.3183099, 0.3678794);
  let pp = p * k + k.yx;
  return noise2dFractScalar(16.0 * k.x * noise2dFractScalar(pp.x * pp.y * (pp.x + pp.y)));
}

// Smooth 2D noise function
fn noise2d(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = noise2dFractVec(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  return mix(
    mix(hash2d(i + vec2<f32>(0.0, 0.0)), hash2d(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash2d(i + vec2<f32>(0.0, 1.0)), hash2d(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// Fractal Brownian Motion (4 octaves)
fn fbm2d(p : vec2<f32>) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var pp = p;
  for (var i = 0; i < 4; i = i + 1) {
    value = value + amplitude * noise2d(pp);
    pp = pp * 2.0;
    amplitude = amplitude * 0.5;
  }
  return value;
}
`;
