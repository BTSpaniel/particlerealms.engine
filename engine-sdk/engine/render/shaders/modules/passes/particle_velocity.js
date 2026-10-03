// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Particle Velocity Pass
 * 
 * Renders particle velocity as color-coded heatmap.
 * Shows motion vectors: slow=blue, fast=red
 */

import { ShaderComposer } from '../../ShaderComposer.js';

const vertexWGSL = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  viewRight: vec3<f32>,
  _pad0: f32,
  viewUp: vec3<f32>,
  _pad1: f32,
};

struct ParticleParams {
  defaultSize: f32,
  quality: f32,
  lodBias: f32,
  cullThreshold: f32
};

@group(0) @binding(0) var<uniform> uFrame: FrameUniforms;
@group(1) @binding(0) var<storage, read> uPositions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> uMeta: array<vec4<f32>>;
@group(1) @binding(2) var<uniform> uParams: ParticleParams;
@group(1) @binding(3) var<storage, read> uVelocities: array<vec4<f32>>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) velocity: vec3<f32>,
  @location(1) localPos: vec2<f32>,
  @location(2) particleDensity: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let pos4 = uPositions[ii];
  let center = pos4.xyz;
  let age = pos4.w;
  
  let particleMeta = uMeta[ii];
  let packedValue = select(uParams.defaultSize * 1e5, particleMeta.w, particleMeta.w > 0.001);
  let particleSize = (floor(packedValue / 1e4) % 100.0) * 0.1;
  
  let vel4 = uVelocities[ii];
  let velocity = vel4.xyz;
  let lifetime = max(vel4.w, 0.1);
  let t = clamp(age / lifetime, 0.0, 1.0);
  
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  
  let corner = corners[vi % 6u];
  let sizeFactor = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.9, 1.0, t));
  let radius = particleSize * 0.5 * sizeFactor;
  
  let viewRight = uFrame.viewRight;
  let viewUp = uFrame.viewUp;
  let worldOffset = viewRight * corner.x * radius + viewUp * corner.y * radius;
  let worldPos = center + worldOffset;
  
  let clipPos = uFrame.viewProj * vec4<f32>(worldPos, 1.0);
  
  var out: VSOut;
  out.position = clipPos;
  out.velocity = velocity;
  out.localPos = corner;
  out.particleDensity = sizeFactor;
  return out;
}
`;

const fragmentWGSL = /* wgsl */`
fn heatmap(t: f32) -> vec3<f32> {
  let r = clamp(t * 2.0, 0.0, 1.0);
  let g = clamp(t * 2.0 - 0.5, 0.0, 1.0);
  let b = clamp((1.0 - t) * 2.0, 0.0, 1.0);
  return vec3<f32>(r, g, b);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let dist = length(input.localPos);
  if (dist > 1.0) { discard; }
  
  let falloff = falloffGaussian(dist, 0.8);
  if (falloff < 0.01) {
    discard;
  }
  
  let speed = length(input.velocity);
  let maxSpeed = 50.0;
  let normalizedSpeed = clamp(speed / maxSpeed, 0.0, 1.0);
  
  let color = heatmap(normalizedSpeed);
  let alpha = falloff * input.particleDensity;
  return vec4<f32>(color, alpha);
}
`;

export const particleVelocityPassShader = ShaderComposer.compose({
  libs: ['density/falloff'],
  vertex: vertexWGSL,
  fragment: fragmentWGSL
});
