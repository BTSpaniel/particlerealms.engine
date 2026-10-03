// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Debug Views Shader - Visualize different render targets (color, depth, normals, roughness/metallic)
 */
export const debugViewsWGSL = /* wgsl */`
struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0)       uv       : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0),
  );

  let p = positions[vertexIndex];

  var out : VSOut;
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5, 0.5);
  return out;
}

struct DebugParams {
  mode    : i32, // 0=color, 1=depth, 2=normals, 3=roughness/metallic
  pad0    : i32,
  pad1    : i32,
  pad2    : i32,
};

@group(0) @binding(0)
var uColorTex : texture_2d<f32>;

@group(0) @binding(1)
var uColorSampler : sampler;

@group(0) @binding(2)
var uAuxTex : texture_2d<f32>;

@group(0) @binding(3)
var uAuxSampler : sampler;

@group(0) @binding(4)
var<uniform> uDebug : DebugParams;

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let baseColor = textureSample(uColorTex, uColorSampler, input.uv).rgb;
  let aux = textureSample(uAuxTex, uAuxSampler, input.uv);

  var outColor : vec3<f32> = baseColor;

  switch (uDebug.mode) {
    case 0: { // Color (default)
      outColor = baseColor;
    }
    case 1: { // Depth (grayscale from aux.r)
      let d = aux.r;
      outColor = vec3<f32>(d, d, d);
    }
    case 2: { // Normals (aux.xyz mapped from [-1,1] to [0,1])
      let n = aux.xyz * 0.5 + vec3<f32>(0.5, 0.5, 0.5);
      outColor = n;
    }
    case 3: { // Roughness/metallic from aux.g/b
      let roughness = aux.g;
      let metallic = aux.b;
      outColor = vec3<f32>(roughness, metallic, 0.0);
    }
    default: {
      outColor = baseColor;
    }
  }

  return vec4<f32>(outColor, 1.0);
}
`;
