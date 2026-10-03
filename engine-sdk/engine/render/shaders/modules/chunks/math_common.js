// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared Math Constants & Utilities for WGSL Shaders
 * 
 * Usage: Import and concatenate at the beginning of shaders that need these.
 * Example: `${mathCommonWGSL}` + yourShaderCode
 */

export const mathCommonWGSL = /* wgsl */`
// ============================================================================
// MATH CONSTANTS
// ============================================================================
const PI : f32 = 3.14159265359;
const TAU : f32 = 6.28318530718;
const HALF_PI : f32 = 1.57079632679;
const INV_PI : f32 = 0.31830988618;
const EPSILON : f32 = 0.0001;
const DEG_TO_RAD : f32 = 0.01745329252;
const RAD_TO_DEG : f32 = 57.2957795131;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Saturate (clamp 0-1) - matches HLSL saturate()
fn saturate(x : f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn saturate3(v : vec3<f32>) -> vec3<f32> {
  return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn saturate4(v : vec4<f32>) -> vec4<f32> {
  return clamp(v, vec4<f32>(0.0), vec4<f32>(1.0));
}

// Linear interpolation helpers
fn lerpf(a : f32, b : f32, t : f32) -> f32 {
  return a + (b - a) * t;
}

fn inverseLerp(a : f32, b : f32, v : f32) -> f32 {
  return (v - a) / (b - a);
}

fn remap(v : f32, inMin : f32, inMax : f32, outMin : f32, outMax : f32) -> f32 {
  let t = inverseLerp(inMin, inMax, v);
  return lerpf(outMin, outMax, saturate(t));
}

// Square and pow helpers
fn sq(x : f32) -> f32 {
  return x * x;
}

fn pow5(x : f32) -> f32 {
  let x2 = x * x;
  return x2 * x2 * x;
}

// Length squared (avoids sqrt)
fn lengthSq3(v : vec3<f32>) -> f32 {
  return dot(v, v);
}

fn lengthSq2(v : vec2<f32>) -> f32 {
  return dot(v, v);
}

// Safe normalize (handles zero vectors)
fn safeNormalize(v : vec3<f32>) -> vec3<f32> {
  let len = length(v);
  if (len < EPSILON) {
    return vec3<f32>(0.0, 1.0, 0.0); // Default up
  }
  return v / len;
}
`;
