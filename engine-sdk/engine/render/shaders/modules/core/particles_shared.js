// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * PARTICLE SHADER SHARED DEFINITIONS
 * ============================================================================
 * 
 * This file contains WGSL struct definitions and buffer bindings shared between
 * the vertex and fragment shaders for particle rendering.
 * 
 * Uses ShaderSchema.js for consistent buffer layouts.
 * See BINDING_GROUPS.particles and PARTICLE_PARAMS_SCHEMA for schema definitions.
 * 
 * GPU BUFFER LAYOUT (from ShaderSchema.js):
 * 
 *   Group 0: FrameUniforms (camera, time)
 *   Group 1: Particle buffers (positions, meta, params, velocities, uvs, texture)
 * 
 * PACK FORMAT (from ParticleSchema.js):
 *   meta.w = mass * 1e8 + drag * 1e6 + size * 1e4 + renderMode * 1e3 + shape * 10 + behavior
 */
export const particleStructsWGSL = /* wgsl */`
struct FrameUniforms {
  viewProj : mat4x4<f32>,
  viewRight : vec3<f32>,  // Camera right vector for billboarding
  _pad0 : f32,
  viewUp : vec3<f32>,     // Camera up vector for billboarding
  _pad1 : f32,
  // Camera pos + misc (offsets 24-31)
  cameraPos : vec3<f32>,
  _pad2 : f32,
  particleCount : u32,
  depthScaleX : f32,
  depthScaleY : f32,
  flags : u32,
  // Lighting from LightManager (offsets 32-43)
  sunDir : vec3<f32>,
  sunIntensity : f32,
  sunColor : vec3<f32>,
  ambientIntensity : f32,
  ambientColor : vec3<f32>,
  _padLight : f32,
};
struct ParticleParams {
  defaultSize : f32,
  quality : f32,      // 0.0 = aggressive culling, 1.0 = full quality
  lodBias : f32,      // Distance LOD bias (higher = more aggressive)
  cullThreshold : f32, // Instance index threshold for emergency culling
  rotationRate : f32,  // Billboard rotation speed (radians/sec, 0 = static)
  useColorGradient : f32, // > 0.5 = sample albedo texture as 1D color gradient LUT
  stretchFactor : f32,  // Velocity-aligned stretch multiplier (0 = none, 1 = proportional to speed)
  facingMode : f32,     // 0=screen-aligned, 1=velocity-aligned, 2=world-Y-axis, 3=horizontal-only
};

@group(0) @binding(0) var<uniform> uFrame : FrameUniforms;
@group(1) @binding(0) var<storage, read> uPositions : array<vec4<f32>>;  // xyz=pos, w=age
@group(1) @binding(1) var<storage, read> uMeta : array<vec4<f32>>;       // rgb=color, w=size+shape
@group(1) @binding(2) var<uniform> uParams : ParticleParams;             // Fallback defaults
@group(1) @binding(3) var<storage, read> uVelocities : array<vec4<f32>>; // xyz=vel, w=lifetime
@group(1) @binding(4) var<storage, read> uUVs : array<vec4<f32>>;         // xy=uv
@group(1) @binding(5) var uAlbedoTex : texture_2d<f32>;
@group(1) @binding(6) var uAlbedoSampler : sampler;

// Group 2: Scene depth for soft particles + alive list for indirect draw
@group(2) @binding(0) var uSceneDepth : texture_depth_2d;
@group(2) @binding(1) var<storage, read> uAliveList : array<u32>; // GAP 18: compact alive indices

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) localPos : vec3<f32>,
  @location(2) age : f32,
  @location(3) shape : f32,    // 0=sphere, 1=point, 2=soft, 3=spark
  @location(4) lifetime : f32, // Per-particle lifetime from emitter
  @location(5) renderMode : f32,
  @location(6) uv : vec2<f32>,
  @location(7) worldY : f32,   // World Y position for ground clipping
  @location(8) viewDepth : f32, // View-space depth for near-fade (fly-through fix)
};
`;
