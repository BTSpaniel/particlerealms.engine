// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Core Lighting - Reusable lighting calculations for dynamic lights
 * 
 * NOTE: This is a LEGACY shader kept for backwards compatibility.
 * For new shaders, use modules/chunks/lighting_common.js which provides:
 *   - lightStructWGSL (unified Light struct)
 *   - lightAttenuationWGSL (attenuation functions)
 *   - diffuseLightingWGSL (diffuse models)
 *   - specularLightingWGSL (specular models)
 *   - lightCalculationWGSL (unified calculation)
 *   - lightingModuleWGSL (complete module)
 */

// Simple Light struct for legacy compatibility (point lights only)
export const simpleLightStructWGSL = /* wgsl */`
struct SimpleLight {
  position: vec3<f32>,
  color: vec3<f32>,
}
`;

// Legacy lighting calculation for backwards compatibility
export const legacyLightingWGSL = /* wgsl */`
fn calculateLighting(
  fragPos: vec3<f32>,
  normal: vec3<f32>,
  baseColor: vec3<f32>,
  lights: array<SimpleLight, 64>,
  lightCount: u32,
  sunDir: vec3<f32>,
  sunColor: vec3<f32>
) -> vec3<f32> {
  var result = baseColor * 0.3; // Ambient
  
  // Dynamic lights
  for (var i: u32 = 0u; i < lightCount && i < 64u; i = i + 1u) {
    let light = lights[i];
    let lightDir = normalize(light.position - fragPos);
    let distance = length(light.position - fragPos);
    
    // Inverse square law attenuation
    let attenuation = 1.0 / (1.0 + distance * distance * 0.02);
    
    // Diffuse + back-lighting
    let diff = max(dot(normal, lightDir), 0.0);
    let backLight = max(dot(normal, -lightDir), 0.0) * 0.3;
    
    // Intensity scales with light count
    let intensity = 1.5 / max(1.0, f32(lightCount) * 0.3);
    
    let lightContrib = light.color * (diff + backLight) * attenuation * intensity;
    result = result + baseColor * lightContrib;
  }
  
  // Sun light
  let sunDiff = max(dot(normal, sunDir), 0.0);
  let sunBack = max(dot(normal, -sunDir), 0.0) * 0.2;
  result = result + baseColor * sunColor * (sunDiff + sunBack) * 0.4;
  
  return result;
}
`;

// Combined export for backwards compatibility
export const lightingWGSL = simpleLightStructWGSL + legacyLightingWGSL;
