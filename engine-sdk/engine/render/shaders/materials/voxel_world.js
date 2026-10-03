// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Voxel World Material - terrain/world shader using voxel module + anime toon.
 *
 * This is a standalone material shader that can be used by the engine's
 * geometry system. It expects a simple FrameUniforms buffer with viewProj
 * and cameraPos, and shades geometry with a voxel terrain look plus
 * optional anime-style cel shading.
 */
import { voxelWorldModuleWGSL } from "../modules/chunks/voxel_world.js";
import { animeToonWGSL } from "../modules/chunks/anime_toon.js";

export const voxelWorldWGSL = /* wgsl */`
${voxelWorldModuleWGSL}
${animeToonWGSL}

struct FrameUniforms {
  viewProj : mat4x4<f32>,
  view     : mat4x4<f32>,
  proj     : mat4x4<f32>,
  cameraPos : vec3<f32>,
  time      : f32,
};

@group(0) @binding(0)
var<uniform> uFrame : FrameUniforms;

struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0)       worldPos : vec3<f32>,
  @location(1)       normal   : vec3<f32>,
};

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  let worldPos = input.position; // assume positions are already in world space
  out.position = uFrame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.normal = input.normal;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let N = normalize(input.normal);
  let V = normalize(uFrame.cameraPos - input.worldPos);
  let L = normalize(vec3<f32>(0.4, 0.8, 0.3));

  // Base terrain color + voxel grid
  var baseColor = voxelTerrainBaseColor(input.worldPos, N, 1.0);
  let edge = voxelEdgeFactor(input.worldPos, N);
  baseColor = baseColor * (0.92 + edge * 0.08);

  // Ambient (sky/ground) similar to the client voxel shader
  let skyAmbient = vec3<f32>(0.4, 0.45, 0.5);
  let groundAmbient = vec3<f32>(0.25, 0.2, 0.15);
  let ambientBlend = N.y * 0.5 + 0.5;
  let ambient = mix(groundAmbient, skyAmbient, ambientBlend) * 0.4;

  // Use animeShading helper for stylized direct light
  let shadowThreshold = 0.4;
  let specThreshold = 0.7;
  let rimPower = 3.0;
  let rimThreshold = 0.4;

  let shadowColor = baseColor * 0.4;
  let shading = animeShading(
    baseColor,
    shadowColor,
    N,
    L,
    V,
    shadowThreshold,
    specThreshold,
    rimPower,
    rimThreshold
  );

  var color = shading.color + ambient * baseColor;

  // Simple height/distance fog
  let dist = length(uFrame.cameraPos - input.worldPos);
  let heightFog = clamp((20.0 - input.worldPos.y) / 40.0, 0.0, 1.0);
  let distFog = clamp(dist / 250.0, 0.0, 0.4);
  let fogAmount = max(heightFog * 0.15, distFog);
  let fogColor = vec3<f32>(0.15, 0.18, 0.25);
  color = mix(color, fogColor, fogAmount);

  // Subtle distance darkening
  let darkness = 1.0 - clamp(dist / 300.0, 0.0, 0.15);
  color = color * darkness;

  return vec4<f32>(color, 1.0);
}
`;

export default voxelWorldWGSL;
