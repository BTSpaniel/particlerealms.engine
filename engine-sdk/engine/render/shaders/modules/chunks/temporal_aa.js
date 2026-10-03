// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Temporal Anti-Aliasing (TAA) Utilities
 * 
 * Functions for implementing high-quality temporal anti-aliasing.
 * 
 * Key Concepts:
 *   1. Jittered sampling (Halton sequence)
 *   2. History reprojection
 *   3. Neighborhood clamping (ghosting prevention)
 *   4. YCoCg color space (better clamping)
 *   5. Catmull-Rom history sampling
 *   6. Sharpening filter
 * 
 * Functions:
 *   - halton23(index) - Halton 2,3 sequence for jitter
 *   - rgb2YCoCg / yCoCg2Rgb - Color space conversion
 *   - clipToBox - Neighborhood clamping
 *   - catmullRomSample - High quality history sampling
 */

export const temporalAAWGSL = /* wgsl */`
// ============================================================================
// HALTON SEQUENCE (Low-discrepancy jitter)
// ============================================================================

// Radical inverse for Halton sequence
fn radicalInverse(x : i32, base : f32) -> f32 {
  let baseI = i32(base);
  var result = 0.0;
  var b = 1.0 / base;
  var xi = x;
  
  while (xi > 0) {
    result = result + f32(xi % baseI) * b;
    xi = xi / baseI;
    b = b / base;
  }
  
  return result;
}

// Halton sequence with bases 2 and 3
// Returns jitter offset in [0,1] range
fn halton23(index : i32) -> vec2<f32> {
  return vec2<f32>(
    radicalInverse(index, 2.0),
    radicalInverse(index, 3.0)
  );
}

// Center jitter around 0 (range [-0.5, 0.5])
fn halton23Centered(index : i32) -> vec2<f32> {
  return halton23(index) - 0.5;
}

// R2 sequence (alternative to Halton, better coverage)
fn r2Sequence(index : i32) -> vec2<f32> {
  let a1 = 1.0 / 1.32471795724; // Plastic constant
  let a2 = 1.0 / (1.32471795724 * 1.32471795724);
  return fract(vec2<f32>(0.5 + f32(index) * a1, 0.5 + f32(index) * a2));
}

// ============================================================================
// COLOR SPACE CONVERSION (YCoCg - better for clamping)
// ============================================================================

// RGB to YCoCg
fn rgb2YCoCg(rgb : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    0.25 * rgb.r + 0.5 * rgb.g + 0.25 * rgb.b,  // Y (luma)
    0.5 * rgb.r - 0.5 * rgb.b,                   // Co (orange)
    -0.25 * rgb.r + 0.5 * rgb.g - 0.25 * rgb.b   // Cg (green)
  );
}

// YCoCg to RGB
fn yCoCg2Rgb(yCoCg : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    yCoCg.x + yCoCg.y - yCoCg.z,
    yCoCg.x + yCoCg.z,
    yCoCg.x - yCoCg.y - yCoCg.z
  );
}

// ============================================================================
// NEIGHBORHOOD CLAMPING (Ghosting prevention)
// ============================================================================

// Clip point to AABB (for neighborhood clamping)
fn clipToBox(p : vec3<f32>, boxMin : vec3<f32>, boxMax : vec3<f32>) -> vec3<f32> {
  let epsilon = 0.000001;
  
  let boxCenter = 0.5 * (boxMax + boxMin);
  let boxHalf = 0.5 * (boxMax - boxMin);
  let localP = (p - boxCenter) / (boxHalf + epsilon);
  
  let maxD = max(max(abs(localP.x), abs(localP.y)), abs(localP.z));
  
  if (maxD < 1.0) {
    return p;
  } else {
    return localP / maxD * (boxHalf + epsilon) + boxCenter;
  }
}

// Compute neighborhood min/max for clamping
// Returns vec2(min luminance, max luminance) for simple luma clamp
fn computeNeighborhoodBounds3x3(
  centerColor : vec3<f32>,
  neighbors : array<vec3<f32>, 8>
) -> array<vec3<f32>, 2> {
  var minCol = centerColor;
  var maxCol = centerColor;
  
  for (var i = 0; i < 8; i = i + 1) {
    minCol = min(minCol, neighbors[i]);
    maxCol = max(maxCol, neighbors[i]);
  }
  
  return array<vec3<f32>, 2>(minCol, maxCol);
}

// Simple luminance-based clamp
fn clampToNeighborhood(historyColor : vec3<f32>, minCol : vec3<f32>, maxCol : vec3<f32>) -> vec3<f32> {
  return clamp(historyColor, minCol, maxCol);
}

// Better: clip in YCoCg space (reduces color clipping artifacts)
fn clampToNeighborhoodYCoCg(
  historyColor : vec3<f32>,
  currentColor : vec3<f32>,
  neighbors : array<vec3<f32>, 8>
) -> vec3<f32> {
  // Convert to YCoCg
  var minYCoCg = rgb2YCoCg(currentColor);
  var maxYCoCg = minYCoCg;
  
  for (var i = 0; i < 8; i = i + 1) {
    let neighborYCoCg = rgb2YCoCg(neighbors[i]);
    minYCoCg = min(minYCoCg, neighborYCoCg);
    maxYCoCg = max(maxYCoCg, neighborYCoCg);
  }
  
  // Clip history in YCoCg space
  let histYCoCg = rgb2YCoCg(historyColor);
  let clippedYCoCg = clipToBox(histYCoCg, minYCoCg, maxYCoCg);
  
  // Convert back
  return yCoCg2Rgb(clippedYCoCg);
}

// ============================================================================
// CATMULL-ROM SAMPLING (High quality history fetch)
// ============================================================================

// Compute Catmull-Rom weights for position t in [0,1]
fn catmullRomWeights(t : f32) -> vec4<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  
  return vec4<f32>(
    -0.5 * t3 + t2 - 0.5 * t,           // w0
    1.5 * t3 - 2.5 * t2 + 1.0,          // w1
    -1.5 * t3 + 2.0 * t2 + 0.5 * t,     // w2
    0.5 * t3 - 0.5 * t2                  // w3
  );
}

// Optimized weights that combine middle samples for bilinear fetch
fn catmullRomWeightsOptimized(t : f32) -> vec3<f32> {
  let w0 = t * (-0.5 + t * (1.0 - 0.5 * t));
  let w1 = 1.0 + t * t * (-2.5 + 1.5 * t);
  let w2 = t * (0.5 + t * (2.0 - 1.5 * t));
  let w3 = t * t * (-0.5 + 0.5 * t);
  
  let w12 = w1 + w2;
  let offset12 = w2 / (w1 + w2);
  
  return vec3<f32>(w0, w12, w3);
}

// ============================================================================
// REPROJECTION
// ============================================================================

// Calculate UV in previous frame given world position
fn reprojectWorldPos(
  worldPos : vec3<f32>,
  prevViewProj : mat4x4<f32>
) -> vec2<f32> {
  let clipPos = prevViewProj * vec4<f32>(worldPos, 1.0);
  let ndc = clipPos.xyz / clipPos.w;
  return ndc.xy * 0.5 + 0.5;
}

// Calculate motion vector (current UV - previous UV)
fn calcMotionVector(
  currentUV : vec2<f32>,
  worldPos : vec3<f32>,
  prevViewProj : mat4x4<f32>
) -> vec2<f32> {
  let prevUV = reprojectWorldPos(worldPos, prevViewProj);
  return currentUV - prevUV;
}

// Check if reprojected UV is valid
fn isValidReproject(uv : vec2<f32>) -> bool {
  return all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0));
}

// ============================================================================
// TAA BLEND
// ============================================================================

// Standard TAA blend with neighborhood clamping
fn taaBlend(
  currentColor : vec3<f32>,
  historyColor : vec3<f32>,
  blendFactor : f32,
  isValidHistory : bool
) -> vec3<f32> {
  if (!isValidHistory) {
    return currentColor;
  }
  
  return mix(currentColor, historyColor, blendFactor);
}

// Velocity-based blend factor (faster motion = less history)
fn velocityBasedBlend(velocity : vec2<f32>, baseBlend : f32, velocityScale : f32) -> f32 {
  let speed = length(velocity);
  let velocityFactor = clamp(1.0 - speed * velocityScale, 0.0, 1.0);
  return baseBlend * velocityFactor;
}

// Luminance-based blend (reduce blend on high contrast)
fn luminanceBasedBlend(
  currentLuma : f32,
  historyLuma : f32,
  baseBlend : f32,
  contrastThreshold : f32
) -> f32 {
  let contrast = abs(currentLuma - historyLuma) / max(currentLuma, 0.001);
  let contrastFactor = 1.0 - smoothstep(0.0, contrastThreshold, contrast);
  return baseBlend * contrastFactor;
}

// ============================================================================
// SHARPENING FILTER (Counter TAA blur)
// ============================================================================

// 3x3 sharpening kernel
fn sharpen3x3(
  center : vec3<f32>,
  neighbors : array<vec3<f32>, 8>,
  sharpness : f32
) -> vec3<f32> {
  var neighborSum = vec3<f32>(0.0);
  for (var i = 0; i < 8; i = i + 1) {
    neighborSum = neighborSum + neighbors[i];
  }
  
  // Unsharp mask: center + sharpness * (center - average)
  let average = neighborSum / 8.0;
  return center + sharpness * (center - average);
}

// Contrast-adaptive sharpening (less sharpening on high contrast edges)
fn sharpenAdaptive(
  center : vec3<f32>,
  neighbors : array<vec3<f32>, 8>,
  sharpness : f32
) -> vec3<f32> {
  var neighborSum = vec3<f32>(0.0);
  var minLuma = dot(center, vec3<f32>(0.299, 0.587, 0.114));
  var maxLuma = minLuma;
  
  for (var i = 0; i < 8; i = i + 1) {
    neighborSum = neighborSum + neighbors[i];
    let luma = dot(neighbors[i], vec3<f32>(0.299, 0.587, 0.114));
    minLuma = min(minLuma, luma);
    maxLuma = max(maxLuma, luma);
  }
  
  // Reduce sharpening on high contrast areas
  let contrast = maxLuma - minLuma;
  let adaptiveSharpness = sharpness * (1.0 - smoothstep(0.0, 0.5, contrast));
  
  let average = neighborSum / 8.0;
  return center + adaptiveSharpness * (center - average);
}

// ============================================================================
// LUMINANCE UTILITIES
// ============================================================================

fn luminance(color : vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

fn luminanceRec2020(color : vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2627, 0.6780, 0.0593));
}

// Tonemapped luminance weight (reduces firefly artifacts)
fn tonemappedWeight(color : vec3<f32>) -> f32 {
  return 1.0 / (1.0 + luminance(color));
}
`;

export default temporalAAWGSL;
