// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Color Blending Functions
 * 
 * Various blend modes for compositing colors.
 * Photoshop-style blend modes and custom game-specific blending.
 */

export const colorBlendWGSL = /* wgsl */`
// ============================================================================
// COLOR BLENDING - Blend modes for color composition
// ============================================================================

// Alpha blend (normal/over)
fn blendNormal(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  return mix(base, blend, alpha);
}

// Additive blend
fn blendAdd(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  return base + blend * alpha;
}

// Multiply blend
fn blendMultiply(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  return mix(base, base * blend, alpha);
}

// Screen blend
fn blendScreen(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  let result = 1.0 - (1.0 - base) * (1.0 - blend);
  return mix(base, result, alpha);
}

// Overlay blend
fn blendOverlay(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  let low = 2.0 * base * blend;
  let high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  let result = select(high, low, base < vec3<f32>(0.5));
  return mix(base, result, alpha);
}

// Soft light blend
fn blendSoftLight(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  let low = 2.0 * base * blend + base * base * (1.0 - 2.0 * blend);
  let high = 2.0 * base * (1.0 - blend) + sqrt(base) * (2.0 * blend - 1.0);
  let result = select(high, low, blend < vec3<f32>(0.5));
  return mix(base, result, alpha);
}

// Hard light blend
fn blendHardLight(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  let low = 2.0 * base * blend;
  let high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  let result = select(high, low, blend < vec3<f32>(0.5));
  return mix(base, result, alpha);
}

// Color dodge blend
fn blendColorDodge(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  let result = base / max(1.0 - blend, vec3<f32>(0.001));
  return mix(base, clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), alpha);
}

// Color burn blend
fn blendColorBurn(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  let result = 1.0 - (1.0 - base) / max(blend, vec3<f32>(0.001));
  return mix(base, clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), alpha);
}

// Linear dodge (add) blend
fn blendLinearDodge(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  return mix(base, clamp(base + blend, vec3<f32>(0.0), vec3<f32>(1.0)), alpha);
}

// Linear burn blend
fn blendLinearBurn(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  return mix(base, clamp(base + blend - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)), alpha);
}

// Difference blend
fn blendDifference(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  return mix(base, abs(base - blend), alpha);
}

// Exclusion blend
fn blendExclusion(base: vec3<f32>, blend: vec3<f32>, alpha: f32) -> vec3<f32> {
  let result = base + blend - 2.0 * base * blend;
  return mix(base, result, alpha);
}

// Premultiplied alpha blend
fn blendPremultiplied(base: vec4<f32>, blend: vec4<f32>) -> vec4<f32> {
  let rgb = blend.rgb + base.rgb * (1.0 - blend.a);
  let a = blend.a + base.a * (1.0 - blend.a);
  return vec4<f32>(rgb, a);
}
`;
