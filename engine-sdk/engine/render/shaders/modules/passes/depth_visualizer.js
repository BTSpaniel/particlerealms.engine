// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Depth Visualizer Pass
 * 
 * Converts depth buffer to visible grayscale image for debugging.
 * Shows near objects as dark, far objects as bright.
 */

import { ShaderComposer } from '../../ShaderComposer.js';

const vertexWGSL = /* wgsl */`
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}
`;

const fragmentWGSL = /* wgsl */`
@group(0) @binding(0) var depthTex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: DepthVisualizerParams;

struct DepthVisualizerParams {
  nearPlane: f32,
  farPlane: f32,
  visualizationMode: u32,  // 0=linear, 1=log, 2=inverse
  _pad0: f32,
};

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let texCoord = vec2<i32>(fragCoord.xy);
  let depthSample = textureLoad(depthTex, texCoord, 0);
  
  // R channel = linear depth, G = density, B = normalized depth
  let linearDepth = depthSample.r;
  let density = depthSample.g;
  let normalizedDepth = depthSample.b;
  
  // Visualize based on mode
  var visualizedDepth = normalizedDepth;
  
  if (params.visualizationMode == 1u) {
    // Logarithmic visualization (better for large depth ranges)
    visualizedDepth = logDepth(linearDepth, params.farPlane);
  } else if (params.visualizationMode == 2u) {
    // Inverse visualization (emphasize near objects)
    visualizedDepth = 1.0 - normalizedDepth;
  }
  
  // Convert to grayscale with some color tinting for readability
  let nearColor = vec3<f32>(0.1, 0.2, 0.4);  // Blue tint for near
  let farColor = vec3<f32>(0.9, 0.95, 1.0);   // White for far
  let depthColor = mix(nearColor, farColor, visualizedDepth);
  
  // Overlay density as brightness modulation
  let finalColor = depthColor * (0.7 + density * 0.3);
  
  return vec4<f32>(finalColor, 1.0);
}
`;

// Compose shader with depth library
export const depthVisualizerShader = ShaderComposer.compose({
  libs: ['depth/linearize'],
  vertex: vertexWGSL,
  fragment: fragmentWGSL
});
