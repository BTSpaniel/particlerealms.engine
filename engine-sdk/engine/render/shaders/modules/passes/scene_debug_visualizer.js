// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Scene Debug Visualizer Shader
 * 
 * Fullscreen post-process that reads the ACTUAL scene depth buffer (texture_depth_2d)
 * containing both entity meshes and particles, and visualizes:
 *   Mode 0: Depth — linearized grayscale (near=white, far=black, industry standard)
 *   Mode 1: Normals — world-space normals reconstructed from depth (RGB = XYZ)
 *   Mode 2: Albedo — passthrough of scene color (placeholder)
 *   Mode 3: Lighting — scene luminance only
 *
 * Reads from texture_depth_2d (depth24plus) — NOT texture_2d<f32>.
 */

const shaderWGSL = /* wgsl */`

struct Params {
  invViewProj: mat4x4<f32>,     // 64 bytes (offsets 0-63)
  nearPlane: f32,                // offset 64
  farPlane: f32,                 // offset 68
  mode: u32,                     // offset 72  (0=depth, 1=normals)
  _pad0: f32,                    // offset 76
  texelSize: vec2<f32>,          // offset 80  (1/width, 1/height)
  _pad1: vec2<f32>,              // offset 88
};

@group(0) @binding(0) var depthTex: texture_depth_2d;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var particleDepthTex: texture_2d<f32>; // R=linearDepth, G=density, B=normDepth

// ── Vertex: fullscreen triangle ─────────────────────────────────────────

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(pos[vi], 0.0, 1.0);
}

// ── Helpers ─────────────────────────────────────────────────────────────

// Linearize WebGPU depth [0,1] → view-space distance
fn linearizeDepth(d: f32, near: f32, far: f32) -> f32 {
  // WebGPU standard depth: 0=near, 1=far
  // Perspective: z_ndc = (far * z_view - far * near) / (z_view * (far - near))
  // Solving: z_view = near * far / (far - d * (far - near))
  return near * far / (far - d * (far - near));
}

// Convert linear depth back to hardware depth [0,1] (inverse of linearizeDepth)
fn linZToHwDepth(linZ: f32, near: f32, far: f32) -> f32 {
  // From linearizeDepth: linZ = near*far / (far - d*(far-near))
  // Solving for d: d = (far * (linZ - near)) / (linZ * (far - near))
  return (far * (linZ - near)) / (linZ * (far - near));
}

// Reconstruct world position from UV + hardware depth
fn worldPosFromDepth(uv: vec2<f32>, depth: f32) -> vec3<f32> {
  // UV [0,1] → NDC [-1,1], note Y flip for WebGPU
  let ndc = vec4<f32>(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, depth, 1.0);
  var wp = params.invViewProj * ndc;
  wp = wp / wp.w;
  return wp.xyz;
}

// ── Fragment ────────────────────────────────────────────────────────────

// Get the effective linear depth at a pixel, compositing scene depth with particle depth.
// Returns the closer of the two sources.
fn getCompositeLinearDepth(coord: vec2<i32>, sceneDepth: f32, near: f32, far: f32) -> f32 {
  let sceneLinZ = linearizeDepth(sceneDepth, near, far);
  let pData = textureLoad(particleDepthTex, coord, 0);
  let pLinZ = pData.r;    // linear depth (clip.w) from particle depth pass
  let pAlpha = pData.a;   // 0 = no particle, 1 = particle present
  // If particle is present and closer, use particle depth
  if (pAlpha > 0.01 && pLinZ > 0.0 && pLinZ < sceneLinZ) {
    return pLinZ;
  }
  return sceneLinZ;
}

// Check if a pixel has particle data that's closer than scene depth
fn hasCloserParticle(coord: vec2<i32>, sceneDepth: f32, near: f32, far: f32) -> bool {
  let sceneLinZ = linearizeDepth(sceneDepth, near, far);
  let pData = textureLoad(particleDepthTex, coord, 0);
  return (pData.a > 0.01 && pData.r > 0.0 && pData.r < sceneLinZ);
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(fragCoord.xy);
  let sceneDepth = textureLoad(depthTex, coord, 0);
  let pData = textureLoad(particleDepthTex, coord, 0);
  let pLinZ = pData.r;
  let pAlpha = pData.a;
  let hasParticle = pAlpha > 0.01 && pLinZ > 0.0;

  let near = params.nearPlane;
  let far  = params.farPlane;

  // Sky / cleared pixels — check if particle fills this pixel
  if (sceneDepth >= 0.9999 && !hasParticle) {
    if (params.mode == 0u) {
      return vec4<f32>(0.05, 0.05, 0.08, 1.0);
    } else {
      return vec4<f32>(0.5, 0.5, 1.0, 1.0);
    }
  }

  // Compute effective linear depth (closer of scene vs particle)
  var linZ: f32;
  if (sceneDepth >= 0.9999) {
    // Only particle here
    linZ = pLinZ;
  } else if (hasParticle) {
    let sceneLinZ = linearizeDepth(sceneDepth, near, far);
    linZ = min(sceneLinZ, pLinZ);
  } else {
    linZ = linearizeDepth(sceneDepth, near, far);
  }

  // ── Mode 0: Depth ──────────────────────────────────────────────────
  if (params.mode == 0u) {
    // Normalize to [0,1] then invert: near=white, far=dark (Unreal convention)
    let norm = clamp((linZ - near) / (far - near), 0.0, 1.0);
    let brightness = 1.0 - norm;
    // Slight warm tint for readability
    let col = vec3<f32>(
      brightness * 0.95,
      brightness * 0.97,
      brightness * 1.0
    );
    return vec4<f32>(col, 1.0);
  }

  // ── Mode 1: Normals (reconstructed from depth) ─────────────────────
  // For normals we need to reconstruct world positions from the composite depth.
  // Convert effective linear depth back to a pseudo hardware depth for worldPosFromDepth.
  let ts = params.texelSize;
  let dims = vec2<i32>(vec2<f32>(1.0 / ts.x, 1.0 / ts.y));

  // Current pixel UV (fragCoord.xy is already at pixel center: 0.5, 1.5, ...)
  let uv = fragCoord.xy * ts;

  // Helper: get composite linear depth at a neighbor, then convert to hardware depth
  // for world position reconstruction via invViewProj.
  // Hardware depth from linear: d = (far * (linZ - near)) / (linZ * (far - near))
  let depthC = linZToHwDepth(linZ, near, far);

  // Neighbor coords (clamped)
  let coordR = min(coord + vec2<i32>(1, 0), dims - vec2<i32>(1));
  let coordL = max(coord - vec2<i32>(1, 0), vec2<i32>(0));
  let coordU = max(coord - vec2<i32>(0, 1), vec2<i32>(0));
  let coordD = min(coord + vec2<i32>(0, 1), dims - vec2<i32>(1));

  // Get composite linear depth for each neighbor
  let linR = getCompositeLinearDepth(coordR, textureLoad(depthTex, coordR, 0), near, far);
  let linL = getCompositeLinearDepth(coordL, textureLoad(depthTex, coordL, 0), near, far);
  let linU = getCompositeLinearDepth(coordU, textureLoad(depthTex, coordU, 0), near, far);
  let linD = getCompositeLinearDepth(coordD, textureLoad(depthTex, coordD, 0), near, far);

  // Convert to hardware depth for world reconstruction
  let hwR = linZToHwDepth(linR, near, far);
  let hwL = linZToHwDepth(linL, near, far);
  let hwU = linZToHwDepth(linU, near, far);
  let hwD = linZToHwDepth(linD, near, far);

  // Reconstruct world positions
  let uvR = (vec2<f32>(coordR) + 0.5) * ts;
  let uvL = (vec2<f32>(coordL) + 0.5) * ts;
  let uvU = (vec2<f32>(coordU) + 0.5) * ts;
  let uvD = (vec2<f32>(coordD) + 0.5) * ts;

  let posC = worldPosFromDepth(uv,  depthC);
  let posR = worldPosFromDepth(uvR, hwR);
  let posL = worldPosFromDepth(uvL, hwL);
  let posU = worldPosFromDepth(uvU, hwU);
  let posD = worldPosFromDepth(uvD, hwD);

  // Use shortest difference for each axis (reduces edge artifacts)
  var ddx_pos: vec3<f32>;
  if (abs(linR - linZ) < abs(linZ - linL)) {
    ddx_pos = posR - posC;
  } else {
    ddx_pos = posC - posL;
  }
  var ddy_pos: vec3<f32>;
  if (abs(linD - linZ) < abs(linZ - linU)) {
    ddy_pos = posD - posC;
  } else {
    ddy_pos = posC - posU;
  }

  let normal = normalize(cross(ddy_pos, ddx_pos));

  // Map normal [-1,1] → [0,1] for display (industry standard: R=X, G=Y, B=Z)
  let col = normal * 0.5 + 0.5;
  return vec4<f32>(col, 1.0);
}
`;

export const sceneDebugVisualizerShader = shaderWGSL;
