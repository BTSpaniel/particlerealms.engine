// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * particles_field_lines.js - Electromagnetic Field Visualization Shader (GAP 42)
 * 
 * Renders electric/magnetic field lines and force arrows around charged particles.
 * Supports: field lines, arrow glyphs, heat map, equipotential surfaces.
 * Color: blue=attraction, red=repulsion, intensity=magnitude.
 */

export const fieldLineVertexWGSL = /* wgsl */`
struct FieldFrameUniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  arrowScale: f32,
  viewRight: vec3<f32>,
  fieldMode: u32,  // 0=arrows, 1=lines, 2=heatmap
  viewUp: vec3<f32>,
  maxFieldStrength: f32,
};

// Probe grid: each probe has position + field vector
// Laid out as vec4(posX,posY,posZ, magnitude), vec4(fieldX,fieldY,fieldZ, sign)
@group(0) @binding(0) var<uniform> frame: FieldFrameUniforms;
@group(1) @binding(0) var<storage, read> probeData: array<vec4<f32>>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) alpha: f32,
  @location(2) localUV: vec2<f32>,
};

// Arrow geometry: 12 vertices (4 triangles: shaft + head)
const ARROW_VERTS = array<vec3<f32>, 12>(
  // Shaft (2 triangles)
  vec3<f32>(0.0, -0.15, 0.0), vec3<f32>(0.6, -0.15, 0.0), vec3<f32>(0.0, 0.15, 0.0),
  vec3<f32>(0.0, 0.15, 0.0), vec3<f32>(0.6, -0.15, 0.0), vec3<f32>(0.6, 0.15, 0.0),
  // Head (2 triangles forming a cone)
  vec3<f32>(0.6, -0.35, 0.0), vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.6, 0.0, 0.0),
  vec3<f32>(0.6, 0.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.6, 0.35, 0.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;

  // Each probe: 2 vec4s at indices iid*2 and iid*2+1
  let probePos = probeData[iid * 2u];
  let probeField = probeData[iid * 2u + 1u];

  let worldPos = probePos.xyz;
  let magnitude = probePos.w;
  let fieldDir = probeField.xyz;
  let sign = probeField.w; // >0 = positive charge source, <0 = negative

  if (magnitude < 0.001) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }

  // Normalize field direction
  let fieldLen = length(fieldDir);
  if (fieldLen < 0.001) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }
  let dir = fieldDir / fieldLen;

  // Build orientation matrix: X = field direction, Y = perpendicular (camera-facing)
  let toCamera = normalize(frame.cameraPos - worldPos);
  var up = cross(dir, toCamera);
  let upLen = length(up);
  if (upLen < 0.001) {
    up = cross(dir, vec3<f32>(0.0, 1.0, 0.0));
  }
  up = normalize(up);

  let scale = frame.arrowScale * clamp(magnitude / frame.maxFieldStrength, 0.1, 2.0);
  let vert = ARROW_VERTS[vid % 12u];
  let rotatedPos = dir * vert.x * scale + up * vert.y * scale;
  let finalPos = worldPos + rotatedPos;

  out.position = frame.viewProj * vec4<f32>(finalPos, 1.0);
  out.localUV = vert.xy;

  // Color: red for positive/repulsion, blue for negative/attraction
  let normalizedMag = clamp(magnitude / frame.maxFieldStrength, 0.0, 1.0);
  if (sign > 0.0) {
    out.color = mix(vec3<f32>(0.3, 0.1, 0.1), vec3<f32>(1.0, 0.2, 0.1), normalizedMag);
  } else {
    out.color = mix(vec3<f32>(0.1, 0.1, 0.3), vec3<f32>(0.1, 0.3, 1.0), normalizedMag);
  }

  out.alpha = 0.3 + normalizedMag * 0.7;

  return out;
}
`;

export const fieldLineFragmentWGSL = /* wgsl */`
struct FSIn {
  @location(0) color: vec3<f32>,
  @location(1) alpha: f32,
  @location(2) localUV: vec2<f32>,
};

@fragment
fn fs_main(in: FSIn) -> @location(0) vec4<f32> {
  // Soft edges
  let edgeDist = abs(in.localUV.y);
  let edgeFade = smoothstep(0.4, 0.2, edgeDist);
  let alpha = in.alpha * edgeFade;

  if (alpha < 0.01) { discard; }

  // Slight emissive glow
  let glow = in.color * (1.0 + 0.5 * (1.0 - edgeDist * 2.0));
  return vec4<f32>(glow, alpha);
}
`;

export default fieldLineVertexWGSL;
