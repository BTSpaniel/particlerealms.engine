// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Curl Noise Functions
 * 
 * Divergence-free noise fields computed from gradient of noise.
 * Creates natural fluid-like turbulent flow patterns.
 */

import { valueNoiseWGSL } from './value.js';

export const curlNoiseWGSL = /* wgsl */`
${valueNoiseWGSL}

// ============================================================================
// CURL NOISE - Divergence-free flow fields for natural turbulence
// ============================================================================

// 2D curl noise - creates swirling flow patterns
fn curl2d(p: vec2<f32>, epsilon: f32) -> vec2<f32> {
  let n1 = valueNoise2d(p + vec2<f32>(0.0, epsilon));
  let n2 = valueNoise2d(p + vec2<f32>(0.0, -epsilon));
  let n3 = valueNoise2d(p + vec2<f32>(epsilon, 0.0));
  let n4 = valueNoise2d(p + vec2<f32>(-epsilon, 0.0));
  
  let dx = n1 - n2;
  let dy = n3 - n4;
  
  // Perpendicular gradient
  let curl = vec2<f32>(dx, -dy);
  let len = max(length(curl), 0.0001);
  return curl / len;
}

// 3D curl noise - full 3D vorticity field
fn curl3d(p: vec3<f32>, epsilon: f32) -> vec3<f32> {
  // Sample noise gradient in all directions
  let dx_p = valueNoise3d(p + vec3<f32>(epsilon, 0.0, 0.0));
  let dx_n = valueNoise3d(p + vec3<f32>(-epsilon, 0.0, 0.0));
  let dy_p = valueNoise3d(p + vec3<f32>(0.0, epsilon, 0.0));
  let dy_n = valueNoise3d(p + vec3<f32>(0.0, -epsilon, 0.0));
  let dz_p = valueNoise3d(p + vec3<f32>(0.0, 0.0, epsilon));
  let dz_n = valueNoise3d(p + vec3<f32>(0.0, 0.0, -epsilon));
  
  // Compute curl as cross product of gradient
  let curl = vec3<f32>(
    (dy_p - dy_n) - (dz_p - dz_n),
    (dz_p - dz_n) - (dx_p - dx_n),
    (dx_p - dx_n) - (dy_p - dy_n)
  );
  
  let len = max(length(curl), 0.0001);
  return curl / len;
}

// Multi-octave curl for complex flow
fn curlFbm2d(p: vec2<f32>, octaves: i32, epsilon: f32) -> vec2<f32> {
  var result = vec2<f32>(0.0);
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    result = result + amplitude * curl2d(pos * frequency, epsilon);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
    pos = vec2<f32>(pos.x * 0.866 - pos.y * 0.5, pos.x * 0.5 + pos.y * 0.866);
  }
  
  return result;
}

fn curlFbm3d(p: vec3<f32>, octaves: i32, epsilon: f32) -> vec3<f32> {
  var result = vec3<f32>(0.0);
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    result = result + amplitude * curl3d(pos * frequency, epsilon);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
  }
  
  return result;
}
`;
