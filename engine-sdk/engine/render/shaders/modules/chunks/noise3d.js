// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared 3D Noise Functions for WGSL Shaders
 * 
 * Used by: volume_smoke, future volumetric effects
 * 
 * Functions provided:
 *   - hash3d(p) - Pseudo-random hash for 3D position
 *   - noise3d(p) - Smooth value noise
 *   - fbm3d(p, octaves) - Fractal Brownian Motion (variable octaves)
 *   - fbm3dRotated(p, octaves) - FBM with rotation between octaves (reduces banding)
 *   - fbm3dVec(p) - Returns 3 independent noise values for domain warping
 *   - domainWarp(p, scale, intensity) - Warp position for organic turbulence
 */

export const noise3dWGSL = /* wgsl */`
fn noise3dFractScalar(value : f32) -> f32 {
  return value - floor(value);
}

fn noise3dFractVec(p : vec3<f32>) -> vec3<f32> {
  return p - floor(p);
}

// ============================================================================
// 3D NOISE UTILITIES
// ============================================================================

// Rotation matrix for FBM - prevents axis-aligned banding artifacts
// This rotates the sample position between octaves for more natural results
const FBM_ROT : mat3x3<f32> = mat3x3<f32>(
  vec3<f32>( 0.00,  0.80,  0.60),
  vec3<f32>(-0.80,  0.36, -0.48),
  vec3<f32>(-0.60, -0.48,  0.64)
);

// Hash for 3D noise - fast pseudo-random
fn hash3d(p : vec3<f32>) -> f32 {
  var p3 = noise3dFractVec(p * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return noise3dFractScalar((p3.x + p3.y) * p3.z);
}

// 3D value noise with smooth interpolation
fn noise3d(p : vec3<f32>) -> f32 {
  let i = floor(p);
  let f = noise3dFractVec(p);
  // Quintic interpolation for smoother derivatives
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  
  return mix(
    mix(
      mix(hash3d(i + vec3<f32>(0.0, 0.0, 0.0)), hash3d(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
      mix(hash3d(i + vec3<f32>(0.0, 1.0, 0.0)), hash3d(i + vec3<f32>(1.0, 1.0, 0.0)), u.x),
      u.y
    ),
    mix(
      mix(hash3d(i + vec3<f32>(0.0, 0.0, 1.0)), hash3d(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
      mix(hash3d(i + vec3<f32>(0.0, 1.0, 1.0)), hash3d(i + vec3<f32>(1.0, 1.0, 1.0)), u.x),
      u.y
    ),
    u.z
  );
}

// Basic 3D FBM (variable octaves)
fn fbm3d(p : vec3<f32>, octaves : i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pp = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * noise3d(pp * frequency);
    frequency = frequency * 2.0;
    amplitude = amplitude * 0.5;
  }
  return value;
}

// FBM with rotation between octaves - reduces axis-aligned artifacts
// Produces more natural, organic-looking noise
fn fbm3dRotated(p : vec3<f32>, octaves : i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var pp = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * noise3d(pp);
    pp = FBM_ROT * pp * 2.02;  // Rotate and scale for next octave
    amplitude = amplitude * 0.5;
  }
  return value;
}

// 3-component FBM for domain warping - returns independent noise in x,y,z
fn fbm3dVec(p : vec3<f32>) -> vec3<f32> {
  let fx = fbm3dRotated(p, 4);
  let fy = fbm3dRotated(p + vec3<f32>(123.45, 0.0, 67.89), 4);
  let fz = fbm3dRotated(p + vec3<f32>(0.0, 456.78, -98.76), 4);
  return vec3<f32>(fx, fy, fz);
}

// Domain warping - displaces sample position using noise for organic turbulence
// scale: how large the warp features are (larger = bigger swirls)
// intensity: how strong the displacement is
fn domainWarp(p : vec3<f32>, scale : f32, intensity : f32) -> vec3<f32> {
  let warpScale = scale * 2.0;
  return p + intensity * warpScale * fbm3dVec(p / warpScale);
}
`;
