// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Ray Tracing Utilities
 *
 * Helper functions for path tracing and ray-based rendering.
 * Includes materials, sampling, and lighting utilities.
 *
 * Functions:
 *   - Material handling (Lambertian, Metal, Dielectric)
 *   - Random sampling (hemisphere, disk, importance sampling)
 *   - Fresnel and BRDF calculations
 *   - Sky/environment sampling
 */

import {
  LEGACY_PCG32_WGSL,
  RAY_TRACING_RANDOM_FLOAT_WGSL,
} from '../../../../core/math/MathBits.js';

export const rayTracingWGSL = /* wgsl */`
${LEGACY_PCG32_WGSL}
// ============================================================================
// RANDOM NUMBER GENERATION
// ============================================================================

// Hash function for seeding
fn hashRay(p : vec2<u32>) -> u32 {
  var state = 1103515245u * ((p.x >> 1u) ^ p.y);
  state = 1103515245u * (state ^ (state >> 3u));
  return state ^ (state >> 16u);
}

// Float from hash [0, 1]
fn hashToFloat(hash : u32) -> f32 {
  return f32(hash) / f32(0xFFFFFFFFu);
}

// Random float, updates seed
${RAY_TRACING_RANDOM_FLOAT_WGSL}

// Random vec2
fn randomVec2(seed : ptr<function, u32>) -> vec2<f32> {
  return vec2<f32>(randomFloat(seed), randomFloat(seed));
}

// Random vec3
fn randomVec3(seed : ptr<function, u32>) -> vec3<f32> {
  return vec3<f32>(randomFloat(seed), randomFloat(seed), randomFloat(seed));
}

// ============================================================================
// SAMPLING FUNCTIONS
// ============================================================================

// Cosine-weighted hemisphere sampling (for diffuse)
fn sampleHemisphereCosine(normal : vec3<f32>, seed : ptr<function, u32>) -> vec3<f32> {
  let r = randomVec2(seed);

  // Build orthonormal basis
  let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(normal.y) > 0.5);
  let tangent = normalize(cross(up, normal));
  let bitangent = cross(normal, tangent);

  // Cosine-weighted sample
  let ra = sqrt(r.y);
  let rx = ra * cos(6.28318530718 * r.x);
  let ry = ra * sin(6.28318530718 * r.x);
  let rz = sqrt(1.0 - r.y);

  return normalize(rx * tangent + ry * bitangent + rz * normal);
}

// Uniform hemisphere sampling
fn sampleHemisphereUniform(normal : vec3<f32>, seed : ptr<function, u32>) -> vec3<f32> {
  let r = randomVec2(seed);

  let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(normal.y) > 0.5);
  let tangent = normalize(cross(up, normal));
  let bitangent = cross(normal, tangent);

  let phi = 6.28318530718 * r.x;
  let cosTheta = r.y;
  let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

  let dir = vec3<f32>(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
  return normalize(dir.x * tangent + dir.y * bitangent + dir.z * normal);
}

// Uniform disk sampling (for DOF, area lights)
fn sampleDisk(seed : ptr<function, u32>) -> vec2<f32> {
  let r = randomVec2(seed);
  let radius = sqrt(r.x);
  let angle = 6.28318530718 * r.y;
  return radius * vec2<f32>(cos(angle), sin(angle));
}

// GGX importance sampling for rough specular
fn sampleGGX(normal : vec3<f32>, roughness : f32, seed : ptr<function, u32>) -> vec3<f32> {
  let r = randomVec2(seed);

  let a = roughness * roughness;
  let phi = 6.28318530718 * r.x;
  let cosTheta = sqrt((1.0 - r.y) / (1.0 + (a * a - 1.0) * r.y));
  let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

  // Local space half vector
  let h = vec3<f32>(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);

  // Transform to world space
  let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(normal.y) > 0.5);
  let tangent = normalize(cross(up, normal));
  let bitangent = cross(normal, tangent);

  return normalize(tangent * h.x + bitangent * h.y + normal * h.z);
}

// ============================================================================
// FRESNEL & BRDF
// ============================================================================

// Schlick Fresnel approximation
fn fresnelSchlickRT(cosTheta : f32, f0 : f32) -> f32 {
  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

// Schlick Fresnel with roughness
fn fresnelSchlickRoughness(cosTheta : f32, f0 : f32, roughness : f32) -> f32 {
  return f0 + (max(1.0 - roughness, f0) - f0) * pow(abs(1.0 - cosTheta), 5.0);
}

// Schlick Fresnel for vec3 F0
fn fresnelSchlickVec(cosTheta : f32, f0 : vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - cosTheta, 5.0);
}

// ============================================================================
// MATERIAL TYPES
// ============================================================================

const MAT_LAMBERTIAN : u32 = 0u;
const MAT_METAL : u32 = 1u;
const MAT_DIELECTRIC : u32 = 2u;
const MAT_EMISSIVE : u32 = 3u;

struct Material {
  albedo : vec3<f32>,
  matType : u32,
  roughness : f32,
  ior : f32,        // Index of refraction (for dielectric)
  emission : vec3<f32>,
}

// Scatter ray based on material type
// Returns: new direction, attenuation color, and whether ray continues
fn scatterRay(
  rayDir : vec3<f32>,
  normal : vec3<f32>,
  mat : Material,
  seed : ptr<function, u32>
) -> vec3<f32> {
  var scattered : vec3<f32>;

  if (mat.matType == MAT_LAMBERTIAN) {
    // Diffuse: cosine-weighted hemisphere
    scattered = sampleHemisphereCosine(normal, seed);
  }
  else if (mat.matType == MAT_METAL) {
    // Metal: reflect with roughness
    let reflected = reflect(rayDir, normal);
    let roughDir = sampleGGX(reflected, mat.roughness, seed);
    scattered = select(roughDir, reflected, mat.roughness < 0.001);
    // Ensure scattered is in same hemisphere as normal
    if (dot(scattered, normal) < 0.0) {
      scattered = reflect(scattered, normal);
    }
  }
  else if (mat.matType == MAT_DIELECTRIC) {
    // Glass: refract or reflect
    let cosTheta = min(dot(-rayDir, normal), 1.0);
    let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

    var outwardNormal : vec3<f32>;
    var niOverNt : f32;
    var reflectProb : f32;

    if (dot(rayDir, normal) > 0.0) {
      // Exiting material
      outwardNormal = -normal;
      niOverNt = mat.ior;
    } else {
      // Entering material
      outwardNormal = normal;
      niOverNt = 1.0 / mat.ior;
    }

    // Check for total internal reflection
    let cannotRefract = niOverNt * sinTheta > 1.0;

    if (cannotRefract) {
      reflectProb = 1.0;
    } else {
      let r0 = (1.0 - niOverNt) / (1.0 + niOverNt);
      reflectProb = fresnelSchlickRT(cosTheta, r0 * r0);
    }

    if (randomFloat(seed) < reflectProb) {
      scattered = reflect(rayDir, outwardNormal);
    } else {
      scattered = refract(rayDir, outwardNormal, niOverNt);
    }

    // Add roughness to glass
    if (mat.roughness > 0.001) {
      let roughDir = sampleGGX(scattered, mat.roughness, seed);
      scattered = normalize(scattered + roughDir * mat.roughness * 0.5);
    }
  }
  else {
    // Emissive: no scatter
    scattered = rayDir;
  }

  return normalize(scattered);
}

// Get material attenuation
fn getMaterialAttenuation(rayDir : vec3<f32>, normal : vec3<f32>, mat : Material) -> vec3<f32> {
  if (mat.matType == MAT_LAMBERTIAN) {
    return mat.albedo;
  }
  else if (mat.matType == MAT_METAL) {
    return mat.albedo;
  }
  else if (mat.matType == MAT_DIELECTRIC) {
    return vec3<f32>(1.0);  // Glass doesn't absorb (for thin glass)
  }
  else {
    return mat.emission;
  }
}

// ============================================================================
// ENVIRONMENT / SKY
// ============================================================================

// Simple gradient sky
fn sampleSkyGradient(rd : vec3<f32>, skyColor : vec3<f32>, horizonColor : vec3<f32>, groundColor : vec3<f32>) -> vec3<f32> {
  let t = rd.y * 0.5 + 0.5;
  if (rd.y < 0.0) {
    return mix(horizonColor, groundColor, -rd.y);
  }
  return mix(horizonColor, skyColor, t);
}

// Physical sky with sun
fn samplePhysicalSky(rd : vec3<f32>, sunDir : vec3<f32>, sunColor : vec3<f32>) -> vec3<f32> {
  // Base sky gradient
  let skyBlue = vec3<f32>(0.4, 0.6, 1.0);
  let horizon = vec3<f32>(0.8, 0.85, 0.9);
  let ground = vec3<f32>(0.3, 0.25, 0.2);

  var col = sampleSkyGradient(rd, skyBlue, horizon, ground);

  // Sun disk
  let sunDot = dot(rd, sunDir);
  let sunDisk = smoothstep(0.9995, 0.9999, sunDot);
  col = col + sunColor * sunDisk * 10.0;

  // Sun glow
  let sunGlow = pow(max(sunDot, 0.0), 8.0);
  col = col + sunColor * sunGlow * 0.5;

  return col;
}

// ============================================================================
// PATH TRACING UTILITIES
// ============================================================================

// Russian roulette for path termination
fn russianRoulette(throughput : vec3<f32>, seed : ptr<function, u32>) -> bool {
  let maxComponent = max(max(throughput.r, throughput.g), throughput.b);
  let survivalProb = min(maxComponent, 0.95);
  return randomFloat(seed) < survivalProb;
}

// Tone mapping (ACES approximation)
fn toneMapACES(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Simple Reinhard tone mapping
fn toneMapReinhard(x : vec3<f32>) -> vec3<f32> {
  return x / (x + vec3<f32>(1.0));
}

// Gamma correction
fn gammaCorrect(color : vec3<f32>, gamma : f32) -> vec3<f32> {
  return pow(color, vec3<f32>(1.0 / gamma));
}
`;

export default rayTracingWGSL;
