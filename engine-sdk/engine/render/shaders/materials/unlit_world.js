// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Unlit World Shader - Simple unlit rendering with checkerboard floor
 */
export const unlitWorldWGSL = /* wgsl */`
struct FrameUniforms {
  viewProj : mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> uFrame : FrameUniforms;

struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0)       normal   : vec3<f32>,
  @location(1)       worldPos : vec3<f32>,
};

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  out.position = uFrame.viewProj * vec4<f32>(input.position, 1.0);
  out.normal = input.normal;
  out.worldPos = input.position;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.25));
  let ndl = max(dot(n, lightDir), 0.0);
  var baseColor = vec3<f32>(0.8, 0.5, 0.3);

  let isFloor = abs(input.worldPos.y + 1.0) < 0.01 && abs(n.y - 1.0) < 0.01;
  if (isFloor) {
    let tileSize = 0.01;
    let u = input.worldPos.x / tileSize;
    let v = input.worldPos.z / tileSize;
    let iu = i32(floor(u));
    let iv = i32(floor(v));
    let check = (iu + iv) & 1;
    if (check == 0) {
      baseColor = vec3<f32>(1.0, 0.5, 0.0);
    } else {
      baseColor = vec3<f32>(0.0, 0.0, 0.0);
    }
  }
  let color = baseColor * (0.2 + 0.8 * ndl);
  return vec4<f32>(color, 1.0);
}
`;
