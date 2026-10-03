// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Textured Quad Shader - Simple texture sampling
 */
export const texturedQuadWGSL = /* wgsl */`
struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) uv       : vec2<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0)       uv       : vec2<f32>,
};

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = vec4<f32>(input.position, 1.0);
  out.uv = input.uv;
  return out;
}

@group(0) @binding(0)
var uTexture : texture_2d<f32>;

@group(0) @binding(1)
var uSampler : sampler;

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  return textureSample(uTexture, uSampler, input.uv);
}
`;
