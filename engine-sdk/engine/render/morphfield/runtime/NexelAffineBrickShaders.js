// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { NEXEL_AFFINE_DECODER_WGSL } from './NexelShaderPlan.js';

/** Direct GPU expansion of a 32-byte, sixty-four-microcube AFFINE4 payload. */
export const NEXEL_AFFINE_BRICK_SHADER_WGSL = /* wgsl */`
struct FrameUniforms {
  viewProjection: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  viewportTime: vec4<f32>,
  lodControls: vec4<f32>,
}

struct AffineBrickRecord {
  originScale: vec4<f32>,
  payloadLow: vec4<u32>,
  payloadHigh: vec4<u32>,
  presentation: vec4<u32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) opacity: f32,
  @location(3) shimmer: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> bricks: array<AffineBrickRecord>;

const QUAD = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
  vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
);

${NEXEL_AFFINE_DECODER_WGSL}

fn payloadWord(record: AffineBrickRecord, index: u32) -> u32 {
  if (index < 4u) { return record.payloadLow[index]; }
  return record.payloadHigh[index - 4u];
}

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
  let brickIndex = instanceIndex >> 9u;
  let localIndex = instanceIndex & 511u;
  let microIndex = localIndex >> 3u;
  let activeRank = localIndex & 7u;
  let record = bricks[brickIndex];
  let packedMorphologies = payloadWord(record, microIndex >> 3u);
  let morphology = (packedMorphologies >> ((microIndex & 7u) * 4u)) & 0x0fu;
  let seed = record.presentation.y ^ (microIndex * 0x9e3779b9u);
  let scramble = seed & 7u;
  let occupiedCount = affineOccupiedCount(morphology);
  let corner = affineActiveCorner(morphology, activeRank, scramble);
  let safeCorner = min(corner, 7u);
  let microCoordinate = vec3<f32>(
    f32(microIndex & 3u),
    f32((microIndex >> 2u) & 3u),
    f32((microIndex >> 4u) & 3u),
  ) - vec3<f32>(1.5);
  let cornerOffset = vec3<f32>(
    f32(safeCorner & 1u),
    f32((safeCorner >> 1u) & 1u),
    f32((safeCorner >> 2u) & 1u),
  ) - vec3<f32>(0.5);
  let cellScale = record.originScale.w;
  let wavePhase = frame.viewportTime.z * (0.19 + f32(seed & 7u) * 0.006)
    + f32(seed & 0xffffu) * 0.0019;
  let breeze = vec3<f32>(
    sin(wavePhase + microCoordinate.y * 0.31),
    sin(wavePhase * 0.73 + microCoordinate.x * 0.27),
    cos(wavePhase * 0.59 + microCoordinate.z * 0.23),
  ) * cellScale * 0.022;
  let center = record.originScale.xyz
    + microCoordinate * cellScale
    + cornerOffset * cellScale * 0.54
    + breeze;
  let centerClip = frame.viewProjection * vec4<f32>(center, 1.0);
  let pixelRadius = abs(cellScale / max(abs(centerClip.w), 0.0001))
    * max(frame.viewportTime.x, frame.viewportTime.y) * frame.lodControls.z;
  let requestedNonEmpty = clamp(
    1.0 + pixelRadius * frame.lodControls.y * frame.lodControls.x,
    1.0,
    max(1.0, f32(occupiedCount)),
  );
  let requested = select(0.0, requestedNonEmpty, occupiedCount > 0u);
  let sampleOpacity = clamp(requested - f32(activeRank), 0.0, 1.0);
  let quad = QUAD[vertexIndex];
  let pointRadius = cellScale * (0.079 + 0.009 * sin(wavePhase * 1.31));
  let billboard = (frame.cameraRight.xyz * quad.x + frame.cameraUp.xyz * quad.y) * pointRadius;
  var clip = frame.viewProjection * vec4<f32>(center + billboard, 1.0);
  let outside = abs(centerClip.x) > abs(centerClip.w) * 1.12
    || abs(centerClip.y) > abs(centerClip.w) * 1.12
    || centerClip.z < 0.0 || centerClip.z > centerClip.w;
  if (corner >= 8u || outside || sampleOpacity <= 0.0) {
    clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  }
  let packed = packedRgba(record.presentation.x);
  let baseColor = packed.rgb;
  let tint = 0.88 + 0.12 * sin(f32(microIndex) * 1.618 + wavePhase);
  var output: VertexOutput;
  output.position = clip;
  output.uv = quad;
  output.color = baseColor * vec3<f32>(tint, 0.94 + 0.06 * tint, 1.04 - 0.04 * tint);
  output.opacity = sampleOpacity * frame.lodControls.w * packed.a;
  output.shimmer = 0.5 + 0.5 * sin(wavePhase + f32(activeRank) * 0.91);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let radius = length(input.uv);
  if (radius >= 1.0 || input.opacity <= 0.0) { discard; }
  let core = 1.0 - smoothstep(0.0, 0.42, radius);
  let halo = 1.0 - smoothstep(0.18, 1.0, radius);
  let alpha = clamp((core * 0.46 + halo * 0.27) * input.opacity, 0.0, 0.72);
  let radiance = input.color * (0.62 + core * 0.94 + halo * (0.13 + input.shimmer * 0.07));
  return vec4<f32>(radiance * alpha, alpha);
}
`;

export default NEXEL_AFFINE_BRICK_SHADER_WGSL;
