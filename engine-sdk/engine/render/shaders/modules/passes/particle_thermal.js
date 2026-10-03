// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Particle Thermal/Blackbody Debug Pass
 * 
 * Visualizes particle temperature as blackbody radiation color.
 * Cold (blue) → Room temp (invisible) → Hot (red/orange/white).
 * Requires uThermalData buffer (binding 4) for per-particle temperature.
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
@group(1) @binding(4) var<storage, read> uThermalData: array<vec4<f32>>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,
  @location(1) particleDensity: f32,
  @location(2) temperature: f32,
  @location(3) phase: f32,
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
  let lifetime = max(vel4.w, 0.1);
  let t = clamp(age / lifetime, 0.0, 1.0);
  
  let thermal = uThermalData[ii];
  
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
  out.localPos = corner;
  out.particleDensity = sizeFactor;
  out.temperature = thermal.x;
  out.phase = thermal.y;
  return out;
}
`;

const fragmentWGSL = /* wgsl */`
@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let dist = length(input.localPos);
  if (dist > 1.0) { discard; }
  
  let falloff = falloffGaussian(dist, 0.8);
  if (falloff < 0.01) {
    discard;
  }
  
  let temp = input.temperature;
  
  // Tanner Helland blackbody approximation (CIE 1931)
  let t100 = max(temp, 300.0) / 100.0;
  var bbR: f32; var bbG: f32; var bbB: f32;
  if (t100 <= 66.0) {
    bbR = 1.0;
    bbG = clamp((99.4708025861 * log(t100) - 161.1195681661) / 255.0, 0.0, 1.0);
  } else {
    bbR = clamp(329.698727446 * pow(t100 - 60.0, -0.1332047592) / 255.0, 0.0, 1.0);
    bbG = clamp(288.1221695283 * pow(t100 - 60.0, -0.0755148492) / 255.0, 0.0, 1.0);
  }
  if (t100 >= 66.0) { bbB = 1.0; }
  else if (t100 <= 19.0) { bbB = 0.0; }
  else { bbB = clamp((138.5177312231 * log(t100 - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0); }
  
  var color = vec3<f32>(bbR, bbG, bbB);
  
  // Intensity ramp: dim at room temp, bright at extremes
  let thermalGlow = clamp((temp - 500.0) / 1500.0, 0.0, 1.0);
  let coldTint = clamp((250.0 - temp) / 200.0, 0.0, 1.0);
  let intensity = max(thermalGlow, coldTint);
  
  // Cold particles: shift toward blue-white
  if (temp < 250.0) {
    color = mix(color, vec3<f32>(0.3, 0.5, 1.0), coldTint);
  }
  
  // Phase indicator ring at billboard edge
  // 0=solid(white), 1=liquid(cyan), 2=gas(orange), 3=plasma(magenta)
  let phase = u32(input.phase);
  if (dist > 0.75 && dist < 0.9) {
    var phaseColor = vec3<f32>(1.0, 1.0, 1.0); // solid
    if (phase == 1u) { phaseColor = vec3<f32>(0.0, 0.8, 1.0); } // liquid
    if (phase == 2u) { phaseColor = vec3<f32>(1.0, 0.5, 0.0); } // gas
    if (phase == 3u) { phaseColor = vec3<f32>(0.9, 0.2, 1.0); } // plasma
    color = mix(color, phaseColor, 0.6);
  }
  
  // Scale brightness: minimum visibility + thermal intensity boost
  let brightness = 0.15 + intensity * 0.85;
  color *= brightness;
  
  let alpha = falloff * input.particleDensity;
  return vec4<f32>(color, alpha);
}
`;

export const particleThermalPassShader = ShaderComposer.compose({
  libs: ['density/falloff'],
  vertex: vertexWGSL,
  fragment: fragmentWGSL
});
