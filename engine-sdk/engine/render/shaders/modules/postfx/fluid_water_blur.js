// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// =============================================================================
// FLUID WATER BLUR - Bilateral depth blur for smooth surfaces
// =============================================================================
// This is Pass 2 of the screen-space water rendering pipeline.
//
// Applies a bilateral blur to the depth texture to merge nearby particles
// into a smooth, continuous surface. The blur is depth-aware to preserve
// edges between fluid and scene geometry.
//
// Run twice: once horizontal, once vertical (separable blur).

export const fluidWaterBlurWGSL = /* wgsl */`
// =============================================================================
// BILATERAL DEPTH BLUR
// =============================================================================

struct BlurParams {
  direction    : vec2<f32>,  // (1,0) for horizontal, (0,1) for vertical
  filterSize   : f32,        // Blur radius in pixels
  depthFalloff : f32,        // How much depth difference reduces blur weight
  screenSize   : vec2<f32>,
  _pad         : vec2<f32>,
};

@group(0) @binding(0) var<uniform> params : BlurParams;
@group(0) @binding(1) var inputDepth : texture_2d<f32>;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

// Fullscreen triangle vertex shader
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  var out : VSOut;
  
  // Fullscreen triangle covering clip space
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  
  let pos = positions[vertexIndex];
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;  // Flip Y for texture coords
  
  return out;
}

// Gaussian weight
fn gaussian(x : f32, sigma : f32) -> f32 {
  return exp(-0.5 * (x * x) / (sigma * sigma));
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  // Use textureLoad to avoid non-uniform control flow issues with textureSample
  let pixelCoord = vec2<i32>(input.uv * params.screenSize);
  let centerDepth = textureLoad(inputDepth, pixelCoord, 0).r;
  
  let texelSize = 1.0 / params.screenSize;
  let blurDir = params.direction * texelSize;
  let filterRadius = i32(params.filterSize);
  let sigma = params.filterSize / 3.0;  // 3-sigma rule
  
  // If no depth (background), keep as is - but don't early return to keep uniform control flow
  let isBackground = centerDepth <= 0.0 || centerDepth >= 1000.0;
  
  var weightSum = 0.0;
  var depthSum = 0.0;
  
  // Sample along blur direction (unrolled for uniform control flow)
  for (var i = -filterRadius; i <= filterRadius; i = i + 1) {
    let offset = vec2<i32>(params.direction * f32(i));
    let sampleCoord = pixelCoord + offset;
    
    // Clamp to valid range
    let clampedCoord = clamp(sampleCoord, vec2<i32>(0), vec2<i32>(params.screenSize) - 1);
    let sampleDepth = textureLoad(inputDepth, clampedCoord, 0).r;
    
    // Compute weight (0 for background samples)
    let isValidSample = sampleDepth > 0.0 && sampleDepth < 1000.0;
    let spatialWeight = gaussian(f32(i), sigma);
    let depthDiff = abs(centerDepth - sampleDepth);
    let depthWeight = exp(-depthDiff * params.depthFalloff);
    
    let weight = select(0.0, spatialWeight * depthWeight, isValidSample);
    weightSum = weightSum + weight;
    depthSum = depthSum + sampleDepth * weight;
  }
  
  // Normalize and return (output vec4 for rgba16float format)
  let blurredDepth = select(centerDepth, depthSum / max(weightSum, 0.001), weightSum > 0.001);
  let finalDepth = select(blurredDepth, centerDepth, isBackground);
  return vec4<f32>(finalDepth, 0.0, 0.0, 1.0);
}
`;

export default fluidWaterBlurWGSL;
