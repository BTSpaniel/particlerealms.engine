// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Density Falloff Functions
 * 
 * Various falloff curves for volumetric density, particle opacity, etc.
 * Controls how density/opacity decreases with distance.
 */

export const densityFalloffWGSL = /* wgsl */`
// ============================================================================
// DENSITY FALLOFF - Distance-based density attenuation curves
// ============================================================================

// Linear falloff - simple linear decrease
fn falloffLinear(dist: f32, radius: f32) -> f32 {
  return clamp(1.0 - dist / radius, 0.0, 1.0);
}

// Quadratic falloff - smooth decrease
fn falloffQuadratic(dist: f32, radius: f32) -> f32 {
  let t = clamp(dist / radius, 0.0, 1.0);
  return 1.0 - t * t;
}

// Cubic falloff - smoother decrease
fn falloffCubic(dist: f32, radius: f32) -> f32 {
  let t = clamp(dist / radius, 0.0, 1.0);
  return 1.0 - t * t * t;
}

// Smoothstep falloff - very smooth S-curve
fn falloffSmoothstep(dist: f32, innerRadius: f32, outerRadius: f32) -> f32 {
  return smoothstep(outerRadius, innerRadius, dist);
}

// Exponential falloff - natural decay (like real fog/light)
fn falloffExponential(dist: f32, falloffRate: f32) -> f32 {
  return exp(-dist * falloffRate);
}

// Squared exponential falloff - gaussian-like
fn falloffGaussian(dist: f32, sigma: f32) -> f32 {
  return exp(-(dist * dist) / (2.0 * sigma * sigma));
}

// Inverse square falloff - physically accurate for point sources
fn falloffInverseSquare(dist: f32, minDist: f32) -> f32 {
  let d = max(dist, minDist);
  return 1.0 / (d * d);
}

// Soft falloff - combines inner solid region with outer smooth fade
fn falloffSoft(dist: f32, innerRadius: f32, outerRadius: f32) -> f32 {
  if (dist < innerRadius) {
    return 1.0;
  }
  let t = (dist - innerRadius) / (outerRadius - innerRadius);
  return 1.0 - smoothstep(0.0, 1.0, t);
}

// Layered falloff - multiple density layers (for smoke/clouds)
fn falloffLayered(dist: f32, layers: i32, frequency: f32) -> f32 {
  var density = falloffGaussian(dist, 1.0);
  for (var i = 0; i < layers; i = i + 1) {
    let wave = sin(dist * frequency * f32(i + 1)) * 0.5 + 0.5;
    density = density * (0.7 + wave * 0.3);
  }
  return density;
}
`;
