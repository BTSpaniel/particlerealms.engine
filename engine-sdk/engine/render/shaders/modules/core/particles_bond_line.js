// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * particles_bond_line.js - Bond Line / Stick Shader (GAP 41)
 * 
 * Renders molecular bonds as lines/cylinders between bonded particles.
 * Reads constraint buffer to find bonded pairs.
 * Supports single/double/triple bond visualization.
 * Color by bond type: ionic=dashed, covalent=solid, metallic=thick.
 */

export const bondLineVertexWGSL = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  lineWidth: f32,
  viewRight: vec3<f32>,
  _pad0: f32,
  viewUp: vec3<f32>,
  _pad1: f32,
};

// Bond data: vec4<u32>(particleA, particleB, bondType, bondOrder)
// bondType: 0=covalent, 1=ionic, 2=metallic, 3=hydrogen
// bondOrder: 1=single, 2=double, 3=triple

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> bonds: array<vec4<u32>>;
@group(1) @binding(3) var<storage, read> particleMeta: array<vec4<f32>>;  // xyz=emitter color
@group(1) @binding(4) var<storage, read> thermal: array<vec4<f32>>;   // x=temperature(K), y=phase

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) localT: f32,       // 0 at particleA, 1 at particleB
  @location(2) @interpolate(flat) bondType: u32,
  @location(3) edgeDist: f32,     // distance from center line (for width)
};

// Each bond rendered as a quad strip: 6 vertices per bond
// vertex 0-2: triangle 1 (A-side), vertex 3-5: triangle 2 (B-side)
const QUAD_OFFSETS = array<vec2<f32>, 6>(
  vec2<f32>(0.0, -0.5), vec2<f32>(1.0, -0.5), vec2<f32>(0.0, 0.5),
  vec2<f32>(0.0, 0.5), vec2<f32>(1.0, -0.5), vec2<f32>(1.0, 0.5),
);

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;

  let bond = bonds[iid];
  let idxA = bond.x;
  let idxB = bond.y;
  let bondType = bond.z;
  let bondOrder = bond.w;

  let posA = positions[idxA];
  let posB = positions[idxB];

  // Skip dead particles
  if (posA.w >= velocities[idxA].w || posB.w >= velocities[idxB].w) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }

  let worldA = posA.xyz;
  let worldB = posB.xyz;
  let bondDir = worldB - worldA;
  let bondLen = length(bondDir);
  if (bondLen < 0.001) {
    out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return out;
  }

  let tangent = bondDir / bondLen;

  // Camera-facing width direction
  let toCamera = normalize(frame.cameraPos - (worldA + worldB) * 0.5);
  let widthDir = normalize(cross(tangent, toCamera));

  let width = frame.lineWidth * select(1.0, select(1.5, 2.0, bondType == 2u), bondType > 0u);

  let qo = QUAD_OFFSETS[vid % 6u];
  let worldPos = worldA + tangent * qo.x * bondLen + widthDir * qo.y * width;

  out.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.localT = qo.x;
  out.bondType = bondType;
  out.edgeDist = qo.y;

  // Color: per-particle emitter color blended with temperature
  let baseColorA = particleMeta[idxA].xyz;
  let baseColorB = particleMeta[idxB].xyz;
  let tempA = thermal[idxA].x;
  let tempB = thermal[idxB].x;

  // Temperature-based tinting: cold=icy blue, room=emitter color, hot=fire glow
  let coldColor = vec3<f32>(0.6, 0.85, 1.0);
  let hotColor = vec3<f32>(1.0, 0.6, 0.1);
  let hotGlow = vec3<f32>(1.0, 0.95, 0.8);
  let tA = clamp((tempA - 200.0) / 1000.0, 0.0, 1.0); // 0=cold, 1=hot
  let tB = clamp((tempB - 200.0) / 1000.0, 0.0, 1.0);
  let colorA = mix(coldColor, mix(baseColorA, hotGlow, smoothstep(0.5, 1.0, tA)), smoothstep(0.0, 0.3, tA));
  let colorB = mix(coldColor, mix(baseColorB, hotGlow, smoothstep(0.5, 1.0, tB)), smoothstep(0.0, 0.3, tB));
  out.color = mix(colorA, colorB, qo.x);

  return out;
}
`;

export const bondLineFragmentWGSL = /* wgsl */`
struct FSIn {
  @location(0) color: vec3<f32>,
  @location(1) localT: f32,
  @location(2) @interpolate(flat) bondType: u32,
  @location(3) edgeDist: f32,
};

@fragment
fn fs_main(in: FSIn) -> @location(0) vec4<f32> {
  var color = in.color;
  var alpha = 1.0;

  // Edge softness
  let edgeFade = 1.0 - smoothstep(0.35, 0.5, abs(in.edgeDist));
  alpha *= edgeFade;

  // Bond type styling
  switch (in.bondType) {
    // Covalent: solid line
    case 0u: {
      // Already solid
    }
    // Ionic: dashed pattern
    case 1u: {
      let dashPhase = fract(in.localT * 8.0);
      if (dashPhase > 0.6) { discard; }
    }
    // Metallic: thick with bright center
    case 2u: {
      color = color * (1.0 + 0.5 * (1.0 - abs(in.edgeDist) * 2.0));
    }
    // Hydrogen bond: thin dotted
    case 3u: {
      let dotPhase = fract(in.localT * 12.0);
      if (dotPhase > 0.3) { discard; }
      alpha *= 0.6;
    }
    default: {}
  }

  if (alpha < 0.01) { discard; }
  return vec4<f32>(color, alpha);
}
`;

export default bondLineVertexWGSL;
