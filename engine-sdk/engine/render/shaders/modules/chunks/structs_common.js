// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared Struct Definitions for WGSL Shaders
 * 
 * IMPORTANT: Only ONE definition of each struct should exist in a shader module.
 * Use these as the canonical definitions and import them where needed.
 */

// ============================================================================
// LIGHT STRUCT - Unified across all shaders
// ============================================================================
export const lightStructWGSL = /* wgsl */`
// Light types: 0 = point, 1 = directional, 2 = spot
struct Light {
  position: vec3<f32>,    // World position (point/spot) or unused (directional)
  lightType: u32,         // 0=point, 1=directional, 2=spot
  color: vec3<f32>,       // RGB intensity
  innerCone: f32,         // Spot inner cone cosine
  direction: vec3<f32>,   // Direction (directional/spot only)
  outerCone: f32,         // Spot outer cone cosine
}
`;

// ============================================================================
// CAMERA STRUCT - Common camera uniforms
// ============================================================================
export const cameraStructWGSL = /* wgsl */`
struct CameraUniforms {
  viewProj    : mat4x4<f32>,
  invViewProj : mat4x4<f32>,
  view        : mat4x4<f32>,
  projection  : mat4x4<f32>,
  position    : vec3<f32>,
  _pad0       : f32,
  forward     : vec3<f32>,
  _pad1       : f32,
  right       : vec3<f32>,
  _pad2       : f32,
  up          : vec3<f32>,
  _pad3       : f32,
}
`;

// ============================================================================
// FRAME UNIFORMS - Per-frame global data
// ============================================================================
export const frameUniformsWGSL = /* wgsl */`
struct FrameUniforms {
  viewProj : mat4x4<f32>,
  time     : f32,
  deltaTime : f32,
  _pad0    : vec2<f32>,
}
`;

// ============================================================================
// PBR MATERIAL - Physically-based material inputs
// ============================================================================
export const pbrMaterialStructWGSL = /* wgsl */`
struct PbrMaterial {
  baseColor   : vec3<f32>,
  metallic    : f32,
  roughness   : f32,
  ao          : f32,
  emissive    : vec3<f32>,
  emissiveStrength : f32,
}
`;

// ============================================================================
// VERTEX OUTPUTS - Common vertex-to-fragment data
// ============================================================================
export const standardVertexOutputWGSL = /* wgsl */`
struct StandardVSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) worldPos       : vec3<f32>,
  @location(1) normal         : vec3<f32>,
  @location(2) uv             : vec2<f32>,
}
`;

export const fullscreenVertexOutputWGSL = /* wgsl */`
struct FullscreenVSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv             : vec2<f32>,
}
`;
