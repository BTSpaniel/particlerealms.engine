// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Light Scattering Functions
 * 
 * Physical and approximated scattering models for volumetric lighting.
 * Includes phase functions and multiple scattering approximations.
 */

export const lightScatterWGSL = /* wgsl */`
// ============================================================================
// LIGHT SCATTERING - Phase functions and scattering models
// ============================================================================

// Henyey-Greenstein phase function - anisotropic scattering
// g > 0: forward scattering, g < 0: back scattering, g = 0: isotropic
fn phaseHG(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(denom, 0.0001), 1.5));
}

// Rayleigh scattering phase - for small particles (atmospheric)
fn phaseRayleigh(cosTheta: f32) -> f32 {
  return (3.0 / (16.0 * 3.14159265)) * (1.0 + cosTheta * cosTheta);
}

// Mie scattering phase - for larger particles (fog, smoke)
fn phaseMie(cosTheta: f32, g: f32) -> f32 {
  return phaseHG(cosTheta, g);
}

// Dual-lobe phase - combines forward and back scatter
fn phaseDualLobe(cosTheta: f32, gForward: f32, gBack: f32, forwardWeight: f32) -> f32 {
  let forward = phaseHG(cosTheta, gForward);
  let back = phaseHG(cosTheta, gBack);
  return mix(back, forward, forwardWeight);
}

// Combined atmospheric phase - Rayleigh + Mie
fn phaseAtmospheric(cosTheta: f32, mieWeight: f32) -> f32 {
  let rayleigh = phaseRayleigh(cosTheta);
  let mie = phaseMie(cosTheta, 0.76);
  return mix(rayleigh, mie, mieWeight);
}

// In-scattering approximation - simple directional scattering
fn inScattering(density: f32, lightDir: vec3<f32>, viewDir: vec3<f32>, lightColor: vec3<f32>, phase: f32) -> vec3<f32> {
  return lightColor * density * phase;
}

// Beer-Lambert law - light transmission through medium
fn transmittance(density: f32, extinctionCoeff: f32, distance: f32) -> f32 {
  return exp(-density * extinctionCoeff * distance);
}

// Powder effect - enhanced scattering at edges (clouds, smoke)
// Creates realistic bright edges on thick volumes
fn powderEffect(density: f32, cosTheta: f32, powderStrength: f32) -> f32 {
  let brightEdge = 1.0 - exp(-density * powderStrength);
  let forwardWeight = cosTheta * 0.5 + 0.5;
  return mix(1.0, brightEdge, forwardWeight);
}

// Multiple scattering approximation - cheap ambient bounce
fn multipleScattering(density: f32, ambientColor: vec3<f32>, scatterStrength: f32) -> vec3<f32> {
  let bounce = 1.0 - exp(-density * scatterStrength);
  return ambientColor * bounce;
}

// Light march - accumulate scattering along ray to light
fn lightMarchDensity(startPos: vec3<f32>, lightDir: vec3<f32>, stepSize: f32, numSteps: i32, sampleDensityFn: ptr<function, f32>) -> f32 {
  var totalDensity = 0.0;
  var pos = startPos;
  
  for (var i = 0; i < numSteps; i = i + 1) {
    pos = pos + lightDir * stepSize;
    totalDensity = totalDensity + *sampleDensityFn * stepSize;
  }
  
  return totalDensity;
}

// Schlick approximation for fresnel (view-dependent scattering)
fn fresnelSchlick(cosTheta: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}
`;
