// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Denoising for Path Tracing
 * 
 * Edge-aware filtering and temporal accumulation for noisy renders.
 * 
 * Key Concepts:
 *   1. À-Trous Wavelet Transform - Multi-scale edge-aware blur
 *   2. Bilateral filtering - Edge-preserving smoothing
 *   3. Temporal AA/Accumulation - Frame blending with clamping
 *   4. YUV color space - Better for temporal clamping
 *   5. SVGF-style weights - Color, normal, depth weighting
 */

export const denoiseWGSL = /* wgsl */`
// ============================================================================
// COLOR SPACE CONVERSION
// ============================================================================

// RGB to YUV (for temporal clamping)
fn rgbToYuv(rgb : vec3<f32>) -> vec3<f32> {
  // Apply gamma before conversion
  let gammaCorrected = rgb * rgb;
  return vec3<f32>(
    dot(gammaCorrected, vec3<f32>(0.299, 0.587, 0.114)),
    dot(gammaCorrected, vec3<f32>(-0.14713, -0.28886, 0.436)),
    dot(gammaCorrected, vec3<f32>(0.615, -0.51499, -0.10001))
  );
}

// YUV to RGB
fn yuvToRgb(yuv : vec3<f32>) -> vec3<f32> {
  let rgb = vec3<f32>(
    dot(yuv, vec3<f32>(1.0, 0.0, 1.13983)),
    dot(yuv, vec3<f32>(1.0, -0.39465, -0.58060)),
    dot(yuv, vec3<f32>(1.0, 2.03211, 0.0))
  );
  // Remove gamma
  return sqrt(max(rgb, vec3<f32>(0.0)));
}

// Luminance
fn luminance(color : vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

// ============================================================================
// À-TROUS WAVELET KERNELS
// ============================================================================

// 5x5 À-Trous kernel weights (separable version)
fn atrousKernel5x5(index : i32) -> f32 {
  let weights = array<f32, 25>(
    1.0/256.0,  4.0/256.0,  6.0/256.0,  4.0/256.0, 1.0/256.0,
    4.0/256.0, 16.0/256.0, 24.0/256.0, 16.0/256.0, 4.0/256.0,
    6.0/256.0, 24.0/256.0, 36.0/256.0, 24.0/256.0, 6.0/256.0,
    4.0/256.0, 16.0/256.0, 24.0/256.0, 16.0/256.0, 4.0/256.0,
    1.0/256.0,  4.0/256.0,  6.0/256.0,  4.0/256.0, 1.0/256.0
  );
  return weights[index];
}

// Alternative B-Spline kernel (slightly different weights)
fn bsplineKernel5x5(index : i32) -> f32 {
  let weights = array<f32, 25>(
    1.0/256.0, 1.0/64.0, 3.0/128.0, 1.0/64.0, 1.0/256.0,
    1.0/64.0,  1.0/16.0, 3.0/32.0,  1.0/16.0, 1.0/64.0,
    3.0/128.0, 3.0/32.0, 9.0/64.0,  3.0/32.0, 3.0/128.0,
    1.0/64.0,  1.0/16.0, 3.0/32.0,  1.0/16.0, 1.0/64.0,
    1.0/256.0, 1.0/64.0, 3.0/128.0, 1.0/64.0, 1.0/256.0
  );
  return weights[index];
}

// 5x5 offset pattern
fn atrousOffset5x5(index : i32) -> vec2<i32> {
  let offsets = array<vec2<i32>, 25>(
    vec2<i32>(-2, -2), vec2<i32>(-1, -2), vec2<i32>(0, -2), vec2<i32>(1, -2), vec2<i32>(2, -2),
    vec2<i32>(-2, -1), vec2<i32>(-1, -1), vec2<i32>(0, -1), vec2<i32>(1, -1), vec2<i32>(2, -1),
    vec2<i32>(-2,  0), vec2<i32>(-1,  0), vec2<i32>(0,  0), vec2<i32>(1,  0), vec2<i32>(2,  0),
    vec2<i32>(-2,  1), vec2<i32>(-1,  1), vec2<i32>(0,  1), vec2<i32>(1,  1), vec2<i32>(2,  1),
    vec2<i32>(-2,  2), vec2<i32>(-1,  2), vec2<i32>(0,  2), vec2<i32>(1,  2), vec2<i32>(2,  2)
  );
  return offsets[index];
}

// ============================================================================
// EDGE-STOPPING FUNCTIONS
// ============================================================================

// Color edge weight (Gaussian falloff)
fn colorWeight(centerColor : vec3<f32>, sampleColor : vec3<f32>, sigma : f32) -> f32 {
  let diff = centerColor - sampleColor;
  let dist2 = dot(diff, diff);
  return min(exp(-dist2 / sigma), 1.0);
}

// Normal edge weight
fn normalWeight(centerNormal : vec3<f32>, sampleNormal : vec3<f32>, sigma : f32) -> f32 {
  let diff = centerNormal - sampleNormal;
  let dist2 = max(dot(diff, diff), 0.0);
  return min(exp(-dist2 / sigma), 1.0);
}

// Depth edge weight
fn depthWeight(centerDepth : f32, sampleDepth : f32, sigma : f32) -> f32 {
  let diff = abs(centerDepth - sampleDepth);
  return min(exp(-diff / sigma), 1.0);
}

// Combined SVGF-style weight
fn svgfWeight(
  centerColor : vec3<f32>, sampleColor : vec3<f32>,
  centerNormal : vec3<f32>, sampleNormal : vec3<f32>,
  centerDepth : f32, sampleDepth : f32,
  colorSigma : f32, normalSigma : f32, depthSigma : f32
) -> f32 {
  let cw = colorWeight(centerColor, sampleColor, colorSigma);
  let nw = normalWeight(centerNormal, sampleNormal, normalSigma);
  let dw = depthWeight(centerDepth, sampleDepth, depthSigma);
  return cw * nw * dw;
}

// ============================================================================
// BILATERAL FILTER
// ============================================================================

// Simple bilateral filter weight
fn bilateralWeight(
  spatialDist : f32,
  colorDist : f32,
  spatialSigma : f32,
  colorSigma : f32
) -> f32 {
  let spatial = exp(-(spatialDist * spatialDist) / (2.0 * spatialSigma * spatialSigma));
  let range = exp(-(colorDist * colorDist) / (2.0 * colorSigma * colorSigma));
  return spatial * range;
}

// Gaussian spatial weight only
fn gaussianSpatialWeight(offset : vec2<f32>, sigma : f32) -> f32 {
  let dist2 = dot(offset, offset);
  return exp(-dist2 / (2.0 * sigma * sigma));
}

// ============================================================================
// TEMPORAL ACCUMULATION
// ============================================================================

// Basic temporal blend
fn temporalBlendSimple(
  currentColor : vec3<f32>,
  historyColor : vec3<f32>,
  blendFactor : f32
) -> vec3<f32> {
  return mix(historyColor, currentColor, blendFactor);
}

// Temporal blend with neighborhood clamping (reduces ghosting)
fn temporalClamp(
  historyColor : vec3<f32>,
  neighborMin : vec3<f32>,
  neighborMax : vec3<f32>
) -> vec3<f32> {
  return clamp(historyColor, neighborMin, neighborMax);
}

// Temporal blend in YUV space (better results)
fn temporalBlendYuv(
  currentColor : vec3<f32>,
  historyColor : vec3<f32>,
  neighborMin : vec3<f32>,
  neighborMax : vec3<f32>,
  mixRate : f32
) -> vec4<f32> {
  // Convert to YUV
  var historyYuv = rgbToYuv(historyColor);
  let currentYuv = rgbToYuv(currentColor);
  let minYuv = rgbToYuv(neighborMin);
  let maxYuv = rgbToYuv(neighborMax);
  
  // Blend in squared space for better results
  var blended = mix(historyColor * historyColor, currentColor * currentColor, mixRate);
  blended = sqrt(blended);
  var blendedYuv = rgbToYuv(blended);
  
  // Clamp to neighborhood in YUV
  let preclamp = blendedYuv;
  blendedYuv = clamp(blendedYuv, minYuv, maxYuv);
  
  // Adjust mix rate based on clamping amount
  let diff = blendedYuv - preclamp;
  let clampAmount = dot(diff, diff);
  var newMixRate = 1.0 / (1.0 / mixRate + 1.0);
  newMixRate = newMixRate + clampAmount * 4.0;
  newMixRate = clamp(newMixRate, 0.05, 0.5);
  
  return vec4<f32>(yuvToRgb(blendedYuv), newMixRate);
}

// Compute neighborhood min/max (3x3)
fn computeNeighborhoodMinMax3x3(
  samples : array<vec3<f32>, 9>
) -> array<vec3<f32>, 2> {
  var minCol = samples[0];
  var maxCol = samples[0];
  
  for (var i = 1; i < 9; i = i + 1) {
    minCol = min(minCol, samples[i]);
    maxCol = max(maxCol, samples[i]);
  }
  
  return array<vec3<f32>, 2>(minCol, maxCol);
}

// Variance-based mix rate adjustment
fn varianceBasedMixRate(
  variance : f32,
  baseMixRate : f32,
  varianceScale : f32
) -> f32 {
  return clamp(baseMixRate + variance * varianceScale, 0.02, 0.5);
}

// ============================================================================
// FIREFLY REMOVAL
// ============================================================================

// Detect firefly (outlier pixel)
fn isFirefly(
  centerLuminance : f32,
  neighborAvgLuminance : f32,
  threshold : f32
) -> bool {
  return centerLuminance > neighborAvgLuminance * threshold;
}

// Clamp fireflies to neighbor average
fn clampFirefly(
  color : vec3<f32>,
  neighborAvg : vec3<f32>,
  threshold : f32
) -> vec3<f32> {
  let centerLum = luminance(color);
  let avgLum = luminance(neighborAvg);
  
  if (centerLum > avgLum * threshold) {
    return neighborAvg * (centerLum / avgLum) * 0.5;
  }
  return color;
}

// Soft firefly clamping
fn softClampFirefly(
  color : vec3<f32>,
  maxLuminance : f32
) -> vec3<f32> {
  let lum = luminance(color);
  if (lum > maxLuminance) {
    return color * (maxLuminance / lum);
  }
  return color;
}

// ============================================================================
// VARIANCE ESTIMATION
// ============================================================================

// Compute local variance (for adaptive filtering)
fn computeVariance(
  samples : array<vec3<f32>, 9>,
  mean : vec3<f32>
) -> f32 {
  var variance = 0.0;
  for (var i = 0; i < 9; i = i + 1) {
    let diff = samples[i] - mean;
    variance = variance + dot(diff, diff);
  }
  return variance / 9.0;
}

// Compute mean from samples
fn computeMean(samples : array<vec3<f32>, 9>) -> vec3<f32> {
  var sum = vec3<f32>(0.0);
  for (var i = 0; i < 9; i = i + 1) {
    sum = sum + samples[i];
  }
  return sum / 9.0;
}

// ============================================================================
// FRESNEL & REFRACTION (for glass materials)
// ============================================================================

// Schlick's approximation for Fresnel
fn fresnelSchlick(cosTheta : f32, ior : f32) -> f32 {
  let r0 = (1.0 - ior) / (1.0 + ior);
  let r0sq = r0 * r0;
  return r0sq + (1.0 - r0sq) * pow(1.0 - cosTheta, 5.0);
}

// Full Fresnel for dielectrics
fn fresnelDielectric(cosThetaI : f32, etaI : f32, etaT : f32) -> f32 {
  let sinThetaI = sqrt(max(0.0, 1.0 - cosThetaI * cosThetaI));
  let sinThetaT = etaI / etaT * sinThetaI;
  
  // Total internal reflection
  if (sinThetaT >= 1.0) {
    return 1.0;
  }
  
  let cosThetaT = sqrt(max(0.0, 1.0 - sinThetaT * sinThetaT));
  
  let rs = (etaT * cosThetaI - etaI * cosThetaT) / (etaT * cosThetaI + etaI * cosThetaT);
  let rp = (etaI * cosThetaI - etaT * cosThetaT) / (etaI * cosThetaI + etaT * cosThetaT);
  
  return (rs * rs + rp * rp) * 0.5;
}

// ============================================================================
// DIRECT LIGHT SAMPLING (Next Event Estimation)
// ============================================================================

// Solid angle of sphere from point
fn sphereSolidAngle(sphereCenter : vec3<f32>, sphereRadius : f32, point : vec3<f32>) -> f32 {
  let dir = sphereCenter - point;
  let dist2 = dot(dir, dir);
  let sinThetaMax2 = sphereRadius * sphereRadius / dist2;
  let cosThetaMax = sqrt(max(0.0, 1.0 - sinThetaMax2));
  return 2.0 * 3.14159265 * (1.0 - cosThetaMax);
}

// PDF for sampling sphere light
fn sphereLightPdf(solidAngle : f32) -> f32 {
  return 1.0 / solidAngle;
}

// Weight for direct light sample (MIS)
fn directLightWeight(
  lightPdf : f32,
  brdfPdf : f32
) -> f32 {
  // Power heuristic with beta=2
  let lightPdf2 = lightPdf * lightPdf;
  let brdfPdf2 = brdfPdf * brdfPdf;
  return lightPdf2 / (lightPdf2 + brdfPdf2);
}

// ============================================================================
// SAMPLE ACCUMULATION
// ============================================================================

// Progressive accumulation
fn progressiveAccumulate(
  newSample : vec3<f32>,
  accumulated : vec3<f32>,
  sampleCount : f32
) -> vec3<f32> {
  return mix(accumulated, newSample, 1.0 / sampleCount);
}

// Weighted accumulation
fn weightedAccumulate(
  newSample : vec3<f32>,
  newWeight : f32,
  accumulated : vec3<f32>,
  accumulatedWeight : f32
) -> vec4<f32> {
  let totalWeight = accumulatedWeight + newWeight;
  let result = (accumulated * accumulatedWeight + newSample * newWeight) / totalWeight;
  return vec4<f32>(result, totalWeight);
}
`;

export default denoiseWGSL;
