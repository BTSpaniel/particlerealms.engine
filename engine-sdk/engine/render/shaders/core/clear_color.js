// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Clear Color Shader - Full-screen clear with uniform color
 */
export const clearColorWGSL = /* wgsl */`
struct VSOut {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0),
  );

  var out : VSOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return out;
}

struct FSOut {
  @location(0) color : vec4<f32>,
};

@group(0) @binding(1)
var<uniform> uClearColor : vec4<f32>;

@fragment
fn fs_main() -> FSOut {
  var out : FSOut;
  out.color = uClearColor;
  return out;
}
`;
