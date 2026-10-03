// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared Lighting Functions for WGSL Shaders
 * 
 * Provides reusable lighting calculations that can be composed into
 * any shader that needs dynamic lighting.
 * 
 * Dependencies: Requires lightStructWGSL from structs_common.js
 */

import { lightStructWGSL } from './structs_common.js';
import { mathCommonWGSL } from './math_common.js';

// ============================================================================
// LIGHT ATTENUATION FUNCTIONS
// ============================================================================
export const lightAttenuationWGSL = /* wgsl */`
// Point light attenuation (inverse square law)
fn attenuatePoint(distance : f32) -> f32 {
  return 1.0 / (1.0 + 0.02 * distance * distance);
}

// Spot light cone attenuation
fn attenuateSpot(spotCos : f32, innerCone : f32, outerCone : f32) -> f32 {
  return smoothstep(outerCone, innerCone, spotCos);
}

// Linear falloff (for area lights)
fn attenuateLinear(distance : f32, radius : f32) -> f32 {
  return saturate(1.0 - distance / radius);
}
`;

// ============================================================================
// DIFFUSE LIGHTING
// ============================================================================
export const diffuseLightingWGSL = /* wgsl */`
// Lambert diffuse
fn diffuseLambert(normal : vec3<f32>, lightDir : vec3<f32>) -> f32 {
  return max(dot(normal, lightDir), 0.0);
}

// Half-Lambert (softer, less harsh shadows)
fn diffuseHalfLambert(normal : vec3<f32>, lightDir : vec3<f32>) -> f32 {
  let ndl = dot(normal, lightDir);
  return ndl * 0.5 + 0.5;
}

// Wrapped diffuse (for subsurface scattering approximation)
fn diffuseWrapped(normal : vec3<f32>, lightDir : vec3<f32>, wrap : f32) -> f32 {
  let ndl = dot(normal, lightDir);
  return saturate((ndl + wrap) / (1.0 + wrap));
}
`;

// ============================================================================
// SPECULAR LIGHTING
// ============================================================================
export const specularLightingWGSL = /* wgsl */`
// Blinn-Phong specular
fn specularBlinnPhong(normal : vec3<f32>, halfVector : vec3<f32>, shininess : f32) -> f32 {
  let ndh = max(dot(normal, halfVector), 0.0);
  return pow(ndh, shininess);
}

// Phong specular
fn specularPhong(reflectDir : vec3<f32>, viewDir : vec3<f32>, shininess : f32) -> f32 {
  let rdv = max(dot(reflectDir, viewDir), 0.0);
  return pow(rdv, shininess);
}
`;

// ============================================================================
// UNIFIED LIGHT CALCULATION
// ============================================================================
export const lightCalculationWGSL = /* wgsl */`
// Calculate contribution from a single light
// Handles point, directional, and spot lights
fn calculateLightContribution(
  light : Light,
  fragPos : vec3<f32>,
  normal : vec3<f32>
) -> vec3<f32> {
  var lightDir : vec3<f32>;
  var attenuation : f32 = 1.0;
  
  // Point light (type 0)
  if (light.lightType == 0u) {
    let toLight = light.position - fragPos;
    let distance = length(toLight);
    lightDir = normalize(toLight);
    attenuation = attenuatePoint(distance);
  }
  // Directional light (type 1)
  else if (light.lightType == 1u) {
    lightDir = normalize(-light.direction);
    // No distance falloff for directional
  }
  // Spot light (type 2)
  else {
    let toLight = light.position - fragPos;
    let distance = length(toLight);
    lightDir = normalize(toLight);
    
    // Distance + cone attenuation
    let spotCos = dot(-lightDir, normalize(light.direction));
    attenuation = attenuatePoint(distance) * attenuateSpot(spotCos, light.innerCone, light.outerCone);
  }
  
  // Diffuse (Lambert)
  let diff = diffuseLambert(normal, lightDir);
  
  // Subtle back-lighting for softer look
  let backLight = max(dot(normal, -lightDir), 0.0) * 0.15;
  
  return light.color * (diff + backLight) * attenuation;
}
`;

// ============================================================================
// COMPLETE LIGHTING MODULE
// ============================================================================
// Combines all lighting functions with dependencies
export const lightingModuleWGSL = 
  mathCommonWGSL + 
  lightStructWGSL + 
  lightAttenuationWGSL + 
  diffuseLightingWGSL + 
  specularLightingWGSL + 
  lightCalculationWGSL;
