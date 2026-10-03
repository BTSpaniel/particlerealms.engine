// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Fullscreen Quad Vertex Shader - Reusable for post-processing effects
 * 
 * Renders a fullscreen triangle (more efficient than quad) using vertex index.
 * No vertex buffer needed - just draw 3 vertices.
 * 
 * Usage:
 *   const myPostFx = `${fullscreenQuadVertexWGSL}${myFragmentShader}`;
 */

export const fullscreenQuadVertexWGSL = /* wgsl */`
struct FullscreenVSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
}

// Fullscreen triangle - covers entire screen with single triangle
// More efficient than a quad (3 vertices vs 6)
@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex : u32) -> FullscreenVSOut {
  // Triangle vertices that cover the screen:
  //   (-1,-1), (3,-1), (-1,3)
  // The GPU clips the oversized parts automatically
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  
  var out : FullscreenVSOut;
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  // UV: convert from clip [-1,1] to texture [0,1]
  out.uv = pos[vertexIndex] * 0.5 + 0.5;
  return out;
}
`;

// Alternative: Standard quad with explicit UVs
export const fullscreenQuadExplicitWGSL = /* wgsl */`
struct FullscreenVSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
}

// 6-vertex quad (two triangles) - use if you need explicit control
@vertex
fn vs_fullscreen_quad(@builtin(vertex_index) vi : u32) -> FullscreenVSOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0),
  );
  
  var out : FullscreenVSOut;
  out.position = vec4<f32>(positions[vi], 0.0, 1.0);
  out.uv = uvs[vi];
  return out;
}
`;
