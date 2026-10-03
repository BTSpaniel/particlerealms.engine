// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  NEXEL_AFFINE_DECODER_WGSL,
  NEXEL_AFFINE_SHADER_PLAN_SIGNATURE,
} from './NexelShaderPlan.js';

export { NEXEL_AFFINE_SHADER_PLAN_SIGNATURE };

/** Portable u32 direct-decode renderer for RM(1,3) Nexel clusters. */
export const NEXEL_MICROSTRUCTURE_SHADER_WGSL = /* wgsl */`
struct FrameUniforms {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  viewportTime: vec4<f32>,
  lodControls: vec4<f32>,
}

struct NexelRecord {
  originScale: vec4<f32>,
  data: vec4<u32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) opacity: f32,
  @location(3) @interpolate(flat) syndrome: u32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> nexels: array<NexelRecord>;

const QUAD = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
  vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
);
${NEXEL_AFFINE_DECODER_WGSL}

fn packedRgba(word: u32) -> vec4<f32> {
  return vec4<f32>(
    f32(word & 0xffu),
    f32((word >> 8u) & 0xffu),
    f32((word >> 16u) & 0xffu),
    f32((word >> 24u) & 0xffu),
  ) / 255.0;
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let parentIndex = instanceIndex >> 3u;
  let activeRank = instanceIndex & 7u;
  let record = nexels[parentIndex];
  let descriptor = record.data.x;
  let morphology = (descriptor >> 21u) & 0x0fu;
  let flags = (descriptor >> 30u) & 0x03u;
  let seed = record.data.z;
  var occupancy = affineOccupancy(morphology);
  let scramble = seed & 7u;
  var corner = affineActiveCorner(morphology, activeRank, scramble);
  var occupiedCount = affineOccupiedCount(morphology);
  var syndrome = 0u;
  if ((flags & 1u) != 0u) {
    occupancy ^= 1u << (seed & 7u);
    occupiedCount = countOneBits(occupancy);
    corner = diagnosticActiveCorner(occupancy, activeRank, scramble);
    syndrome = faceSyndrome(occupancy);
  }
  let validCorner = corner < 8u;
  let safeCorner = min(corner, 7u);
  let cornerOffset = vec3<f32>(
    f32(safeCorner & 1u),
    f32((safeCorner >> 1u) & 1u),
    f32((safeCorner >> 2u) & 1u),
  ) - vec3<f32>(0.5);
  let driftPhase = frame.viewportTime.z * (0.27 + f32(seed & 7u) * 0.011)
    + f32(seed & 0xffffu) * 0.0031;
  let drift = vec3<f32>(
    sin(driftPhase * 0.73),
    sin(driftPhase * 1.11 + 1.7),
    cos(driftPhase * 0.61),
  ) * record.originScale.w * 0.055;
  let center = record.originScale.xyz + cornerOffset * record.originScale.w * 0.58 + drift;
  let centerClip = frame.viewProjection * vec4<f32>(center, 1.0);
  let pixelRadius = abs(record.originScale.w / max(abs(centerClip.w), 0.0001))
    * max(frame.viewportTime.x, frame.viewportTime.y) * frame.lodControls.z;
  let requestedNonEmpty = clamp(
    1.0 + pixelRadius * frame.lodControls.y * frame.lodControls.x,
    1.0,
    max(1.0, f32(occupiedCount)),
  );
  let requested = select(0.0, requestedNonEmpty, occupiedCount > 0u);
  let sampleOpacity = clamp(requested - f32(activeRank), 0.0, 1.0);
  let quad = QUAD[vertexIndex];
  let pointRadius = record.originScale.w * (0.047 + 0.008 * sin(driftPhase * 1.7));
  let billboard = (frame.cameraRight.xyz * quad.x + frame.cameraUp.xyz * quad.y) * pointRadius;
  var clip = frame.viewProjection * vec4<f32>(center + billboard, 1.0);
  let outside = abs(centerClip.x) > abs(centerClip.w) * 1.08
    || abs(centerClip.y) > abs(centerClip.w) * 1.08
    || centerClip.z < 0.0 || centerClip.z > centerClip.w;
  if (!validCorner || outside || sampleOpacity <= 0.0) {
    clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  let packed = packedRgba(record.data.y);
  var color = packed.rgb;
  if (syndrome != 0u) {
    color = mix(color, vec3<f32>(1.0, 0.18, 0.46), 0.78);
  }
  var output: VertexOutput;
  output.position = clip;
  output.uv = quad;
  output.color = color;
  output.opacity = sampleOpacity * frame.lodControls.w * packed.a;
  output.syndrome = syndrome;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let radius = length(input.uv);
  if (radius >= 1.0 || input.opacity <= 0.0) { discard; }
  let core = 1.0 - smoothstep(0.0, 0.46, radius);
  let halo = 1.0 - smoothstep(0.24, 1.0, radius);
  let integrityPulse = select(1.0, 0.82 + 0.18 * sin(frame.viewportTime.z * 3.0), input.syndrome != 0u);
  let alpha = clamp((core * 0.52 + halo * 0.34) * input.opacity * integrityPulse, 0.0, 0.82);
  let radiance = input.color * (0.72 + core * 1.15 + halo * 0.26);
  return vec4<f32>(radiance * alpha, alpha);
}
`;

export default NEXEL_MICROSTRUCTURE_SHADER_WGSL;
