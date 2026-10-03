// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Value Noise Functions
 * 
 * Classic value noise with smooth interpolation.
 * Uses grid of random values and interpolates between them.
 */

import { hashWGSL } from './hash.js';

export const valueNoiseWGSL = /* wgsl */`
${hashWGSL}

// ============================================================================
// VALUE NOISE - Smooth interpolated noise from hashed grid values
// ============================================================================

// 2D value noise with cubic interpolation
fn valueNoise2d(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  
  // Cubic interpolation (smoother than quadratic)
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  
  let a = hash2d(i + vec2<f32>(0.0, 0.0));
  let b = hash2d(i + vec2<f32>(1.0, 0.0));
  let c = hash2d(i + vec2<f32>(0.0, 1.0));
  let d = hash2d(i + vec2<f32>(1.0, 1.0));
  
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 3D value noise with cubic interpolation
fn valueNoise3d(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  
  let h000 = hash3d(i + vec3<f32>(0.0, 0.0, 0.0));
  let h100 = hash3d(i + vec3<f32>(1.0, 0.0, 0.0));
  let h010 = hash3d(i + vec3<f32>(0.0, 1.0, 0.0));
  let h110 = hash3d(i + vec3<f32>(1.0, 1.0, 0.0));
  let h001 = hash3d(i + vec3<f32>(0.0, 0.0, 1.0));
  let h101 = hash3d(i + vec3<f32>(1.0, 0.0, 1.0));
  let h011 = hash3d(i + vec3<f32>(0.0, 1.0, 1.0));
  let h111 = hash3d(i + vec3<f32>(1.0, 1.0, 1.0));
  
  let x0 = mix(mix(h000, h100, u.x), mix(h010, h110, u.x), u.y);
  let x1 = mix(mix(h001, h101, u.x), mix(h011, h111, u.x), u.y);
  
  return mix(x0, x1, u.z);
}

// Ridged value noise - creates sharp creases (good for mountains, lightning)
fn ridgedNoise2d(p: vec2<f32>) -> f32 {
  return 1.0 - abs(valueNoise2d(p) * 2.0 - 1.0);
}

fn ridgedNoise3d(p: vec3<f32>) -> f32 {
  return 1.0 - abs(valueNoise3d(p) * 2.0 - 1.0);
}
`;
