// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  LEGACY_PARTICLE_VERTEX_QUALITY_PCG_WGSL,
  LEGACY_PCG32_WGSL,
} from '../../../../core/math/MathBits.js';

// Point vertex shader - single vertex per particle
export const particlesPointVertexWGSL = /* wgsl */`

${LEGACY_PCG32_WGSL}
${LEGACY_PARTICLE_VERTEX_QUALITY_PCG_WGSL}
struct FrameUniforms {
  viewProj : mat4x4<f32>,
  viewRight : vec3<f32>,
  _pad0 : f32,
  viewUp : vec3<f32>,
  _pad1 : f32,
};

struct ParticleParams {
  defaultSize : f32,
  quality : f32,
  lodBias : f32,
  cullThreshold : f32,
};

@group(0) @binding(0) var<uniform> uFrame : FrameUniforms;
@group(1) @binding(0) var<storage, read> uPositions : array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> uMeta : array<vec4<f32>>;
@group(1) @binding(2) var<uniform> uParams : ParticleParams;
@group(1) @binding(3) var<storage, read> uVelocities : array<vec4<f32>>;
@group(1) @binding(4) var<storage, read> uUVs : array<vec4<f32>>;
@group(1) @binding(5) var uAlbedoTex : texture_2d<f32>;
@group(1) @binding(6) var uAlbedoSampler : sampler;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) age : f32,
  @location(2) lifetime : f32,
  @location(3) shape : f32,
  @location(4) renderMode : f32,
  @location(5) localPos : vec2<f32>,
  @location(6) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VSOut {
  let pos4 = uPositions[ii];
  let center = pos4.xyz;
  let age = pos4.w;
  let vel4 = uVelocities[ii];
  let lifetime = max(vel4.w, 0.0001);
  let particleMeta = uMeta[ii];

  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  let corner = corners[vi % 6u];

  let packedValue = select(uParams.defaultSize * 1e5, particleMeta.w, particleMeta.w > 0.001);

  // Extract size, shape, renderMode from packed value
  // Pack format: mass * 1e8 + drag * 1e6 + size * 1e4 + renderMode * 1e3 + shape * 10 + behavior
  let particleSize = (floor(packedValue / 1e4) % 100.0) * 0.1;  // Size is in 1e4 position, 0-99, decoded to 0.0-9.9
  let renderMode = floor(packedValue / 1e3) % 10.0;     // RenderMode is in 1e3 position, 0-9
  let particleShape = floor(packedValue / 10.0) % 10.0; // Shape is in 10s position, 0-9

  let quality = uParams.quality;
  let cullThreshold = uParams.cullThreshold;
  let emergencyCull = select(1.0, 0.0, cullThreshold > 0.0 && f32(ii) > cullThreshold);
  let pseudoRandom = legacyParticleVertexQualityRandomFloat01(ii, bitcast<u32>(center.x));
  let stochasticCull = select(1.0, 0.0, pseudoRandom > quality && quality < 0.95);
  
  // Cull invalid particles: dead (age > lifetime), negative age, or extreme positions
  let isDead = age > lifetime || age < 0.0;
  let isInvalidPos = abs(center.x) > 1e9 || abs(center.y) > 1e9 || abs(center.z) > 1e9;
  let isNaN = center.x != center.x || center.y != center.y || center.z != center.z || age != age;
  let invalidCull = select(1.0, 0.0, isDead || isInvalidPos || isNaN);
  
  let qualityCulling = emergencyCull * stochasticCull * invalidCull;

  let clipPos = uFrame.viewProj * vec4<f32>(center, 1.0);
  // Far plane check removed - let GPU handle clipping for infinite distance
  let frustumMargin = 1.3;
  let outsideFrustum =
    clipPos.w <= 0.0 ||
    abs(clipPos.x) > clipPos.w * frustumMargin ||
    abs(clipPos.y) > clipPos.w * frustumMargin;
  let frustumCull = select(1.0, 0.0, outsideFrustum);

  let distance = max(clipPos.w, 0.0001);
  // Distance LOD disabled - render at all distances
  let distanceLod = 1.0;

  let basePx = max(1.0, particleSize);
  let ndcRadius = basePx * 0.0016 * distanceLod * frustumCull * qualityCulling;

  let uv4 = uUVs[ii];
  let particleOpacity = select(1.0, clamp(uv4.z, 0.0, 1.0), uv4.z > 0.0001);

  var out : VSOut;
  var finalClip = clipPos;
  finalClip.x = finalClip.x + corner.x * ndcRadius * clipPos.w;
  finalClip.y = finalClip.y + corner.y * ndcRadius * clipPos.w;
  out.position = finalClip;
  out.color = vec4<f32>(particleMeta.rgb, particleOpacity);
  out.age = age;
  out.lifetime = lifetime;
  out.shape = particleShape;
  out.renderMode = renderMode;
  out.localPos = corner;
  out.uv = uv4.xy;
  return out;
}
`;
