// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Raymarching Utilities for Volumetric Effects
 * 
 * Provides common ray-volume intersection and marching utilities
 * used by volume_smoke, SDF rendering, and other volumetric effects.
 */

// ============================================================================
// RAY-BOX INTERSECTION
// ============================================================================
export const rayBoxIntersectWGSL = /* wgsl */`
// Ray-box intersection with robust handling of edge cases
// Returns: vec2(tNear, tFar) - distances along ray to entry/exit points
// If tFar < tNear, no intersection occurred
fn intersectBox(ro : vec3<f32>, rd : vec3<f32>, boxMin : vec3<f32>, boxMax : vec3<f32>) -> vec2<f32> {
  // Handle near-zero ray directions to avoid division issues
  let eps = EPSILON;
  let invRd = vec3<f32>(
    select(1.0 / rd.x, 1e10 * sign(rd.x + eps), abs(rd.x) < eps),
    select(1.0 / rd.y, 1e10 * sign(rd.y + eps), abs(rd.y) < eps),
    select(1.0 / rd.z, 1e10 * sign(rd.z + eps), abs(rd.z) < eps)
  );
  
  let t0 = (boxMin - ro) * invRd;
  let t1 = (boxMax - ro) * invRd;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tNear = max(max(tmin.x, tmin.y), tmin.z);
  let tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2<f32>(max(tNear, 0.0), tFar);
}

// Simplified box intersection (no edge case handling - faster)
fn intersectBoxFast(ro : vec3<f32>, invRd : vec3<f32>, boxMin : vec3<f32>, boxMax : vec3<f32>) -> vec2<f32> {
  let t0 = (boxMin - ro) * invRd;
  let t1 = (boxMax - ro) * invRd;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  return vec2<f32>(
    max(max(tmin.x, tmin.y), tmin.z),
    min(min(tmax.x, tmax.y), tmax.z)
  );
}
`;

// ============================================================================
// RAY-SPHERE INTERSECTION
// ============================================================================
export const raySphereIntersectWGSL = /* wgsl */`
// Ray-sphere intersection
// Returns: vec2(tNear, tFar) or vec2(-1, -1) if no hit
fn intersectSphere(ro : vec3<f32>, rd : vec3<f32>, center : vec3<f32>, radius : f32) -> vec2<f32> {
  let oc = ro - center;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - radius * radius;
  let h = b * b - c;
  
  if (h < 0.0) {
    return vec2<f32>(-1.0);
  }
  
  let sqrtH = sqrt(h);
  return vec2<f32>(-b - sqrtH, -b + sqrtH);
}
`;

// ============================================================================
// DEPTH BUFFER UTILITIES
// ============================================================================
export const depthUtilsWGSL = /* wgsl */`
// Convert depth buffer value to linear depth
// WebGPU uses [0,1] clip space Z by default
fn linearizeDepth(depth : f32, near : f32, far : f32) -> f32 {
  return near * far / (far - depth * (far - near));
}

// Convert linear depth back to depth buffer value
fn depthFromLinear(linearDepth : f32, near : f32, far : f32) -> f32 {
  return (far - near * far / linearDepth) / (far - near);
}
`;

// ============================================================================
// TRILINEAR INTERPOLATION
// ============================================================================
export const trilinearSampleWGSL = /* wgsl */`
// Trilinear interpolation helper for 3D grid sampling
// Returns interpolated value from 8 corner samples
fn trilinear(
  d000 : f32, d100 : f32, d010 : f32, d110 : f32,
  d001 : f32, d101 : f32, d011 : f32, d111 : f32,
  f : vec3<f32>
) -> f32 {
  let d00 = mix(d000, d100, f.x);
  let d10 = mix(d010, d110, f.x);
  let d01 = mix(d001, d101, f.x);
  let d11 = mix(d011, d111, f.x);
  let d0 = mix(d00, d10, f.y);
  let d1 = mix(d01, d11, f.y);
  return mix(d0, d1, f.z);
}
`;

// ============================================================================
// PHASE FUNCTIONS (for scattering)
// ============================================================================
export const phaseFunctionsWGSL = /* wgsl */`
// Henyey-Greenstein phase function
// g: asymmetry parameter (-1 = back scatter, 0 = isotropic, 1 = forward scatter)
fn phaseHG(cosTheta : f32, g : f32) -> f32 {
  let g2 = g * g;
  let denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * PI * pow(max(denom, EPSILON), 1.5));
}

// Rayleigh phase function (for small particles like air molecules)
// Properly normalized: integrates to 1 over sphere
// Symmetric lobes forward/back, minimum at 90 degrees
fn phaseRayleigh(cosTheta : f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

// Schlick approximation to HG (faster, good for real-time)
fn phaseSchlick(cosTheta : f32, k : f32) -> f32 {
  let kCos = 1.0 - k * cosTheta;
  return (1.0 - k * k) / (4.0 * PI * kCos * kCos);
}

// Dual-lobe phase function (combines forward and back scatter)
fn phaseDualLobe(cosTheta : f32, gForward : f32, gBack : f32, blend : f32) -> f32 {
  let forward = phaseHG(cosTheta, gForward);
  let back = phaseHG(cosTheta, gBack);
  return mix(back, forward, blend);
}

// Combined smoke/cloud phase function
// Blends HG (large droplets) with Rayleigh (fine particles)
// Good for realistic smoke, fog, clouds
fn phaseSmoke(cosTheta : f32) -> f32 {
  let hgForward = phaseHG(cosTheta, 0.6);   // Strong forward scatter (sun halo)
  let hgBack = phaseHG(cosTheta, -0.3);     // Weak back scatter (rim light)
  let hg = mix(hgBack, hgForward, 0.7);
  let rayleigh = phaseRayleigh(cosTheta);
  // Blend: mostly HG but add Rayleigh for atmospheric quality
  return mix(hg, rayleigh, 0.2);
}
`;

// ============================================================================
// BEER-LAMBERT TRANSMISSION
// ============================================================================
export const beerLambertWGSL = /* wgsl */`
// Beer-Lambert law for light transmission through medium
fn beerLambert(density : f32, distance : f32) -> f32 {
  return exp(-density * distance);
}

// Beer-Lambert with extinction coefficient
fn beerLambertExt(density : f32, extinction : f32, distance : f32) -> f32 {
  return exp(-density * extinction * distance);
}
`;

// ============================================================================
// COMBINED MODULE
// ============================================================================
import { mathCommonWGSL } from "./math_common.js";

export const raymarchingModuleWGSL = 
  mathCommonWGSL +
  rayBoxIntersectWGSL + 
  raySphereIntersectWGSL + 
  depthUtilsWGSL + 
  trilinearSampleWGSL + 
  phaseFunctionsWGSL + 
  beerLambertWGSL;
