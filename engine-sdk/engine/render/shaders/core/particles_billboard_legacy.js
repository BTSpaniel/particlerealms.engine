// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Legacy Particles Billboard - Horizontal quad particles with cloud-like appearance
 * Note: The main particles_billboard shader is in modules/core/particles_billboard.js
 */
export const particlesBillboardLegacyWGSL = /* wgsl */`
struct FrameUniforms {
  viewProj : mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> uFrame : FrameUniforms;

struct ParticleParams {
  size : f32,
  _pad0 : vec3<f32>,
};

@group(1) @binding(0)
var<storage, read> uPositions : array<vec4<f32>>;

@group(1) @binding(1)
var<uniform> uParams : ParticleParams;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0)       color    : vec4<f32>,
  @location(1)       localPos : vec3<f32>,
  @location(2)       age      : f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index)  vertexIndex  : u32,
  @builtin(instance_index) instanceIndex : u32,
) -> VSOut {
  let pos4 = uPositions[instanceIndex];
  let center = pos4.xyz;

  // Flat horizontal quad (plane) - 6 vertices for 2 triangles
  // Vertices are in XZ plane (horizontal), repeated to fill 24 slots
  var quad = array<vec3<f32>, 24>(
    // First triangle
    vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, 1.0),
    // Second triangle
    vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(-1.0, 0.0, 1.0),
    // Repeat to fill remaining slots (shader expects 24 vertices)
    vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, 1.0),
    vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(-1.0, 0.0, 1.0),
    vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, 1.0),
    vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(-1.0, 0.0, 1.0),
    vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, 1.0),
    vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(-1.0, 0.0, 1.0),
  );

  let lifetime = 60.0;
  let t = clamp(pos4.w / lifetime, 0.0, 1.0);
  let grow = smoothstep(0.0, 0.15, t);
  let shrink = 1.0 - smoothstep(0.7, 1.0, t);
  let sizeFactor = grow * shrink + 0.4;
  let size = uParams.size * sizeFactor;
  let radius = size * 0.5;
  let baseLocal = quad[vertexIndex % 6u] * radius;
  // Flat plane sits at particle center height
  let local = baseLocal;
  let worldPos = center + local;

  var out : VSOut;
  out.position = uFrame.viewProj * vec4<f32>(worldPos, 1.0);

  let baseColor = uParams._pad0;
  out.color = vec4<f32>(baseColor, 0.9);
  out.localPos = local;
  out.age = pos4.w;

  return out;
}

// Simple hash for pseudo-random noise
fn hash(p : vec2<f32>) -> f32 {
  let k = vec2<f32>(0.3183099, 0.3678794);
  let pp = p * k + k.yx;
  return fract(16.0 * k.x * fract(pp.x * pp.y * (pp.x + pp.y)));
}

// Smooth noise function
fn noise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  return mix(
    mix(hash(i + vec2<f32>(0.0, 0.0)), hash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// Fractal Brownian Motion for cloud-like texture
fn fbm(p : vec2<f32>) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var pp = p;
  for (var i = 0; i < 4; i = i + 1) {
    value = value + amplitude * noise(pp);
    pp = pp * 2.0;
    amplitude = amplitude * 0.5;
  }
  return value;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let baseColor = input.color.rgb;
  let baseAlpha = input.color.a;

  // Lifetime fade: particles fade out as age approaches lifetime
  let lifetime = 60.0;
  let t = clamp(input.age / lifetime, 0.0, 1.0);
  let fadeIn = smoothstep(0.0, 0.1, t);
  let lifeMask = (1.0 - smoothstep(0.6, 1.0, t)) * fadeIn;

  // Size animation
  let grow = smoothstep(0.0, 0.15, t);
  let shrink = 1.0 - smoothstep(0.7, 1.0, t);
  let sizeFactor = grow * shrink + 0.4;
  let radius = max(uParams.size * sizeFactor * 0.5, 0.0001);
  
  // Normalized position on the quad
  let uv = vec2<f32>(input.localPos.x, input.localPos.z) / radius;
  let dist = length(uv);
  
  // Puffy cloud shape - soft circular falloff with noise
  let noiseScale = 3.0;
  let noiseOffset = input.age * 0.1; // Animate noise over time
  let cloudNoise = fbm(uv * noiseScale + vec2<f32>(noiseOffset, noiseOffset * 0.7));
  
  // Create puffy edge by modulating the distance with noise
  let puffyDist = dist - (cloudNoise - 0.5) * 0.4;
  
  // Soft circular falloff with puffy edges
  let cloudMask = 1.0 - smoothstep(0.3, 0.9, puffyDist);
  
  // Add internal cloud detail - lighter/darker patches
  let detailNoise = fbm(uv * noiseScale * 2.0 + vec2<f32>(noiseOffset * 0.5, 0.0));
  let detail = 0.8 + detailNoise * 0.4;
  
  // Brighten the center for a puffy 3D look
  let centerBright = 1.0 - smoothstep(0.0, 0.6, dist) * 0.3;
  
  // Final color with cloud shading
  let cloudColor = baseColor * detail * centerBright;
  
  let alpha = baseAlpha * lifeMask * cloudMask;

  return vec4<f32>(cloudColor, alpha);
}
`;
