// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const fluidWaterThicknessWGSL = /* wgsl */`
struct FrameData {
  viewProj    : mat4x4<f32>,
  view        : mat4x4<f32>,
  proj        : mat4x4<f32>,
  cameraPos   : vec3<f32>,
  sphereScale : f32,
  screenSize  : vec2<f32>,
  nearPlane   : f32,
  farPlane    : f32,
};

struct ParticleData {
  position : vec3<f32>,
  age      : f32,
  velocity : vec3<f32>,
  lifetime : f32,
  color    : vec3<f32>,
  packed   : f32,
};

@group(0) @binding(0) var<uniform> frame : FrameData;
@group(1) @binding(0) var<storage, read> positions : array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities : array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> particleMeta : array<vec4<f32>>;

fn decodeSize(packed : f32) -> f32 {
  return floor(packed / 100.0);
}

fn decodeRenderMode(packed : f32) -> u32 {
  return u32(floor(packed / 10.0) % 10.0);
}

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) localUV : vec2<f32>,
  @location(1) sphereRadius : f32,
  @location(2) renderMode : f32,
  @location(3) age : f32,
  @location(4) lifetime : f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32
) -> VSOut {
  var out : VSOut;

  let pos4 = positions[instanceIndex];
  let vel4 = velocities[instanceIndex];
  let meta4 = particleMeta[instanceIndex];

  let worldPos = pos4.xyz;
  let age = pos4.w;
  let lifetime = max(vel4.w, 0.1);
  let packed = meta4.a;

  let mode = decodeRenderMode(packed);

  // Skip dead particles and non-fluid modes by outputting degenerate geometry
  if (age >= lifetime || (mode != 1u && mode != 3u)) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    out.localUV = vec2<f32>(0.0);
    out.sphereRadius = 0.0;
    out.renderMode = 0.0;
    out.age = age;
    out.lifetime = lifetime;
    return out;
  }

  let size = decodeSize(packed);
  let radius = max(size * frame.sphereScale, 0.1);

  let lifeRatio = 1.0 - clamp(age / lifetime, 0.0, 1.0);
  let effectiveRadius = radius * lifeRatio;

  var cornerOffsets = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );

  let localOffset = cornerOffsets[vertexIndex % 6u];

  let viewCenter = (frame.view * vec4<f32>(worldPos, 1.0)).xyz;
  let viewOffset = vec3<f32>(localOffset * effectiveRadius, 0.0);
  let viewPos = viewCenter + viewOffset;

  out.position = frame.proj * vec4<f32>(viewPos, 1.0);
  out.localUV = localOffset;
  out.sphereRadius = effectiveRadius;
  out.renderMode = f32(mode);
  out.age = age;
  out.lifetime = lifetime;

  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  if (input.sphereRadius <= 0.0) {
    discard;
  }

  let mode = i32(input.renderMode);
  if (mode != 1 && mode != 3) {
    discard;
  }

  let uvLen = length(input.localUV);
  if (uvLen > 1.0) {
    discard;
  }

  let base = sqrt(max(0.0, 1.0 - uvLen * uvLen));
  var thickness = 2.0 * base * input.sphereRadius;

  let lifeRatio = 1.0 - clamp(input.age / max(input.lifetime, 0.1), 0.0, 1.0);
  thickness = thickness * lifeRatio;

  // Output to rgba16float (thickness stored in .r channel)
  return vec4<f32>(thickness, 0.0, 0.0, 1.0);
}
`;

export default fluidWaterThicknessWGSL;
