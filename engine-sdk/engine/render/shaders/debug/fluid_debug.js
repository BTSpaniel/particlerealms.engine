// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Fluid Debug Shader - Visualize fluid density grid slices or max projection
 */
export const fluidDebugWGSL = /* wgsl */`
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

struct FluidDebugParams {
  gridSize : vec3<f32>,
  sliceZ  : f32,
  scale   : f32,
  mode    : i32,
  pad     : vec2<f32>,
};

@group(0) @binding(0)
var<storage, read> uDensity : array<f32>;

@group(0) @binding(1)
var<uniform> uParams : FluidDebugParams;

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let uv = clamp(input.uv, vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));

  let gx = i32(max(uParams.gridSize.x, 1.0));
  let gy = i32(max(uParams.gridSize.y, 1.0));
  let gz = i32(max(uParams.gridSize.z, 1.0));

  if (gx <= 0 || gy <= 0 || gz <= 0) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let layerSize = gx * gy;
  let totalCells = layerSize * gz;

  let xf = clamp(uv.x * uParams.gridSize.x, 0.0, uParams.gridSize.x - 1.0);
  let yf = clamp(uv.y * uParams.gridSize.y, 0.0, uParams.gridSize.y - 1.0);

  let x = i32(xf + 0.5);
  let y = i32(yf + 0.5);

  var value : f32 = 0.0;

  if (uParams.mode == 0) {
    let zf = clamp(uParams.sliceZ, 0.0, uParams.gridSize.z - 1.0);
    let z = i32(zf + 0.5);
    let idx = z * layerSize + y * gx + x;
    let uidx = u32(clamp(idx, 0, totalCells - 1));
    if (uidx < arrayLength(&uDensity)) {
      value = uDensity[uidx];
    }
  } else {
    for (var z : i32 = 0; z < gz; z = z + 1) {
      let idx = z * layerSize + y * gx + x;
      let uidx = u32(clamp(idx, 0, totalCells - 1));
      if (uidx >= arrayLength(&uDensity)) {
        break;
      }
      let d = uDensity[uidx];
      if (d > value) {
        value = d;
      }
    }
  }

  let scaled = clamp(value * uParams.scale, 0.0, 1.0);

  let color = vec3<f32>(
    scaled,
    sqrt(scaled),
    pow(scaled, 0.25),
  );

  return vec4<f32>(color, 1.0);
}
`;
