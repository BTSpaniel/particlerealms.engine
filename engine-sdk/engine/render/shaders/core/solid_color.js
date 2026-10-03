// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Solid Color Shader - Simple vertex color passthrough
 */
export const solidColorWGSL = /* wgsl */`
struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) color    : vec3<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0)       color    : vec3<f32>,
};

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = vec4<f32>(input.position, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 1.0);
}
`;
