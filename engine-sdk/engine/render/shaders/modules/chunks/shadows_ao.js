// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Soft Shadows and Ambient Occlusion for Ray Marching
 * 
 * Used by: SDF rendering, volumetric effects, global illumination
 * 
 * Functions:
 *   - calcSoftShadow(ro, rd, sceneSDF, mint, maxt, k) - Penumbra soft shadows
 *   - calcAO(pos, nor, sceneSDF) - Ambient occlusion via ray marching
 *   - calcHardShadow(ro, rd, sceneSDF, mint, maxt) - Binary shadow test
 */

export const shadowsAoWGSL = /* wgsl */`
// ============================================================================
// SOFT SHADOWS
// Inspired by Inigo Quilez's soft shadow technique
// k controls penumbra softness (higher = harder shadows)
// ============================================================================

// Soft shadow with penumbra
// sceneSDF must be a function that returns distance to nearest surface
// Returns 0.0 (full shadow) to 1.0 (no shadow)
fn calcSoftShadowGeneric(ro : vec3<f32>, rd : vec3<f32>, mint : f32, maxt : f32, k : f32) -> f32 {
  var res = 1.0;
  var t = mint;
  
  for (var i = 0; i < 40; i = i + 1) {
    // Note: Replace sceneSDF with your actual scene distance function
    let h = 0.1; // sceneSDF(ro + rd * t) - placeholder
    
    // Accumulate shadow based on how close we pass to surfaces
    res = min(res, k * h / t);
    t = t + clamp(h, 0.02, 0.20);
    
    // Early exit if in shadow or past max distance
    if (h < 0.001 || t > maxt) {
      break;
    }
  }
  
  return clamp(res, 0.0, 1.0);
}

// Improved soft shadow (sharper near contact point)
fn calcSoftShadowImproved(ro : vec3<f32>, rd : vec3<f32>, mint : f32, maxt : f32, k : f32) -> f32 {
  var res = 1.0;
  var ph = 1e20;  // Previous height
  var t = mint;
  
  for (var i = 0; i < 64; i = i + 1) {
    let h = 0.1; // sceneSDF(ro + rd * t) - placeholder
    
    if (h < 0.001) {
      return 0.0;  // In shadow
    }
    
    // Improved penumbra calculation
    let y = h * h / (2.0 * ph);
    let d = sqrt(h * h - y * y);
    res = min(res, k * d / max(0.0, t - y));
    ph = h;
    t = t + h;
    
    if (t > maxt) {
      break;
    }
  }
  
  return clamp(res, 0.0, 1.0);
}

// ============================================================================
// AMBIENT OCCLUSION
// Sample along normal to detect nearby geometry
// ============================================================================

// Basic ambient occlusion
// pos = surface position, nor = surface normal
fn calcAOGeneric(pos : vec3<f32>, nor : vec3<f32>) -> f32 {
  var occ = 0.0;
  var sca = 1.0;
  var h = 0.001;
  
  for (var i = 0; i < 5; i = i + 1) {
    // Sample distance along normal
    let d = 0.1; // sceneSDF(pos + h * nor) - placeholder
    
    // Accumulate occlusion
    occ = occ + (h - d) * sca;
    sca = sca * 0.85;  // Falloff for farther samples
    h = h + 0.45 * f32(i + 1) / 5.0;
  }
  
  return clamp(1.0 - occ, 0.0, 1.0);
}

// Ground-truth style AO with more samples
fn calcAOHighQuality(pos : vec3<f32>, nor : vec3<f32>) -> f32 {
  var occ = 0.0;
  let samples = 8;
  
  for (var i = 0; i < samples; i = i + 1) {
    let h = 0.01 + 0.12 * f32(i) / f32(samples - 1);
    let d = 0.1; // sceneSDF(pos + h * nor) - placeholder
    occ = occ + clamp(h - d, 0.0, 1.0);
  }
  
  return 1.0 - occ / f32(samples);
}
`;

// ============================================================================
// PRACTICAL SHADOW/AO MACROS FOR USE IN SHADERS
// These need the scene SDF passed in or defined globally
// ============================================================================

export const shadowsAoMacrosWGSL = /* wgsl */`
// Soft shadow for directional/point lights
// Call with your sceneSDF function
// Example: let shadow = softShadow(surfacePos, lightDir, sceneSDF);
fn softShadow(ro : vec3<f32>, rd : vec3<f32>, mint : f32, maxt : f32, k : f32, sdfSample : f32) -> f32 {
  // sdfSample should be sceneSDF(ro + rd * t) evaluated at current t
  // This is a single-step helper - call in a loop
  return clamp(k * sdfSample / mint, 0.0, 1.0);
}
`;
