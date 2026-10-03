// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Monitor Patterns - Test patterns for display calibration
 */
export const monitorPatternsWGSL = /* wgsl */`
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

struct Params {
  mode : f32,
  time : f32,
  pad  : vec2<f32>,
};

@group(0) @binding(0)
var<uniform> uParams : Params;

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let mode = u32(uParams.mode + 0.5);

  var color : vec3<f32>;

  if (mode == 1u) {
    // Color bars (vertical)
    let x = uv.x;
    if (x < 1.0 / 6.0) {
      color = vec3<f32>(1.0, 1.0, 1.0);
    } else if (x < 2.0 / 6.0) {
      color = vec3<f32>(1.0, 1.0, 0.0);
    } else if (x < 3.0 / 6.0) {
      color = vec3<f32>(0.0, 1.0, 1.0);
    } else if (x < 4.0 / 6.0) {
      color = vec3<f32>(0.0, 1.0, 0.0);
    } else if (x < 5.0 / 6.0) {
      color = vec3<f32>(1.0, 0.0, 1.0);
    } else {
      color = vec3<f32>(1.0, 0.0, 0.0);
    }
  } else if (mode == 2u) {
    // Grayscale horizontal gradient
    let g = clamp(uv.x, 0.0, 1.0);
    color = vec3<f32>(g, g, g);
  } else if (mode == 3u) {
    // Checkerboard
    let scale = 16.0;
    let cx = i32(floor(uv.x * scale));
    let cy = i32(floor(uv.y * scale));
    let parity = (cx + cy) & 1;
    if (parity == 0) {
      color = vec3<f32>(1.0, 1.0, 1.0);
    } else {
      color = vec3<f32>(0.0, 0.0, 0.0);
    }
  } else if (mode == 4u) {
    // Fine grid / sharpness pattern
    let scale = 64.0;
    let fx = fract(uv.x * scale);
    let fy = fract(uv.y * scale);
    let thickness = 0.02;
    if (fx < thickness || fx > 1.0 - thickness || fy < thickness || fy > 1.0 - thickness) {
      color = vec3<f32>(1.0, 1.0, 1.0);
    } else {
      color = vec3<f32>(0.1, 0.1, 0.1);
    }
  } else if (mode == 5u) {
    // Moving vertical bar (ghosting / motion test)
    let speed = 0.25;
    let t = fract(uParams.time * speed);
    let width = 0.1;
    let center = t;
    let dist = abs(uv.x - center);
    if (dist < width * 0.5) {
      color = vec3<f32>(1.0, 1.0, 1.0);
    } else {
      color = vec3<f32>(0.0, 0.0, 0.0);
    }
  } else {
    // Default subtle gradient when no specific pattern is selected
    color = vec3<f32>(uv.x, uv.y, 0.5);
  }

  return vec4<f32>(color, 1.0);
}
`;
