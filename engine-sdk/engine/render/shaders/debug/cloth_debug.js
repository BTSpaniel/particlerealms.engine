// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Cloth Debug Shader - Visualize cloth mesh with normal-based coloring
 */
export const clothDebugWGSL = /* wgsl */`
struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0)       normal   : vec3<f32>,
};

struct Uniforms {
  mvp   : mat4x4<f32>,
  color : vec3<f32>,
  pad0  : f32,
};

@group(0) @binding(0)
var<uniform> u : Uniforms;

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = u.mvp * vec4<f32>(input.position, 1.0);
  out.normal = input.normal;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let nColor = n * 0.5 + vec3<f32>(0.5, 0.5, 0.5);
  let base = u.color * nColor;
  return vec4<f32>(base, 1.0);
}
`;
