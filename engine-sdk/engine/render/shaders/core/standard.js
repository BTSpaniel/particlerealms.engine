// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ============================================================================
 * STANDARD PBR SHADER WITH MULTI-TYPE LIGHTING
 * ============================================================================
 * 
 * Supports three light types:
 *   - Point (type 0): Position-based with quadratic distance falloff
 *   - Directional (type 1): Direction-based, no distance falloff (sun-like)
 *   - Spot (type 2): Position + direction + cone falloff
 * 
 * GPU BUFFER LAYOUT:
 * 
 *   Group 0 (Uniforms):
 *     Binding 0: Uniforms
 *       - projection, view, model matrices
 *       - color, alpha
 *       - lightCount, feature flags, sunDir, sunColor
 * 
 *     Binding 1: lights array<Light, 64>
 *       - position (vec3) + lightType (u32)
 *       - color (vec3) + innerCone (f32)
 *       - direction (vec3) + outerCone (f32)
 */

export const standardShaderWGSL = /* wgsl */`
// Standard PBR shader with dynamic lighting
// Supports point, directional, and spot lights

// Light types: 0 = point, 1 = directional, 2 = spot
struct Light {
  position: vec3<f32>,    // World position (point/spot) or unused (directional)
  lightType: u32,         // 0=point, 1=directional, 2=spot
  color: vec3<f32>,       // RGB intensity
  innerCone: f32,         // Spot inner cone cosine
  direction: vec3<f32>,   // Direction (directional/spot)
  outerCone: f32,         // Spot outer cone cosine
}

struct Uniforms {
  projection: mat4x4<f32>,      // 0..63 (16 floats)
  view: mat4x4<f32>,            // 64..127 (16 floats)
  model: mat4x4<f32>,           // 128..191 (16 floats)
  color: vec3<f32>,             // 192..203 (3 floats)
  alpha: f32,                   // 204..207 (1 float, used for transparency)
  lightCount: u32,              // 208..211 (1 u32)
  _pad1: u32,                   // 212..215 (1 u32 padding)
  sunDir: vec3<f32>,            // 216..227 (3 floats)
  _pad2: f32,                   // 228..231 (1 float padding)
  sunColor: vec3<f32>,          // 232..243 (3 floats)
  _pad3: f32,                   // 244..247 (1 float padding)
  enableDiffuse: u32,           // 248..251 (1 u32)
  enableBounce: u32,            // 252..255 (1 u32)
  enableEmissive: u32,          // 256..259 (1 u32)
  enableSun: u32,               // 260..263 (1 u32)
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> lights: array<Light, 64>;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) fragPos: vec3<f32>,
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  let worldPos = (uniforms.model * vec4<f32>(input.position, 1.0)).xyz;
  return VertexOutput(
    uniforms.projection * uniforms.view * vec4<f32>(worldPos, 1.0),
    (uniforms.model * vec4<f32>(input.normal, 0.0)).xyz,
    worldPos,
  );
}

// ============================================================================
// LIGHTING UTILITIES
// ============================================================================

// Hemisphere ambient: blend between sky and ground color based on normal
fn hemisphereAmbient(norm: vec3<f32>, skyColor: vec3<f32>, groundColor: vec3<f32>) -> vec3<f32> {
  let skyBlend = norm.y * 0.5 + 0.5;  // 1 when facing up, 0 when facing down
  return mix(groundColor, skyColor, skyBlend);
}

// Simple vertex-based ambient occlusion approximation
// Corners and crevices are darker (based on normal pointing inward)
fn simpleAO(norm: vec3<f32>, worldPos: vec3<f32>) -> f32 {
  // Higher surfaces get less occlusion (crude approximation)
  let heightFactor = clamp(worldPos.y * 0.1, 0.0, 1.0);
  // Surfaces facing down get more occlusion
  let normalFactor = norm.y * 0.3 + 0.7;
  return mix(0.5, 1.0, heightFactor * normalFactor);
}

// Blinn-Phong specular highlight
fn blinnPhongSpecular(
  lightDir: vec3<f32>,
  viewDir: vec3<f32>, 
  norm: vec3<f32>,
  shininess: f32
) -> f32 {
  let halfDir = normalize(lightDir + viewDir);
  let specAngle = max(dot(norm, halfDir), 0.0);
  return pow(specAngle, shininess);
}

// Calculate light contribution based on type (with specular)
fn calcLightContribution(
  light: Light, 
  fragPos: vec3<f32>, 
  norm: vec3<f32>,
  viewDir: vec3<f32>,
  shininess: f32
) -> vec3<f32> {
  var lightDir: vec3<f32>;
  var attenuation: f32 = 1.0;
  
  // Point light (type 0)
  if (light.lightType == 0u) {
    let toLight = light.position - fragPos;
    let distance = length(toLight);
    lightDir = normalize(toLight);
    // Quadratic falloff with minimum range
    attenuation = 1.0 / (1.0 + 0.02 * distance * distance);
  }
  // Directional light (type 1)
  else if (light.lightType == 1u) {
    lightDir = normalize(-light.direction);
    attenuation = 1.0; // No distance falloff for directional
  }
  // Spot light (type 2)
  else {
    let toLight = light.position - fragPos;
    let distance = length(toLight);
    lightDir = normalize(toLight);
    
    // Distance attenuation
    attenuation = 1.0 / (1.0 + 0.02 * distance * distance);
    
    // Cone attenuation: smoothstep between outer and inner cone
    let spotCos = dot(-lightDir, normalize(light.direction));
    let spotFactor = smoothstep(light.outerCone, light.innerCone, spotCos);
    attenuation = attenuation * spotFactor;
  }
  
  // Diffuse (Lambert)
  let diff = max(dot(norm, lightDir), 0.0);
  
  // Specular (Blinn-Phong)
  let spec = blinnPhongSpecular(lightDir, viewDir, norm, shininess) * 0.3;
  
  // Subtle back-lighting for softer look
  let backLight = max(dot(norm, -lightDir), 0.0) * 0.1;
  
  return light.color * (diff + spec + backLight) * attenuation;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let norm = normalize(input.normal);
  let albedo = uniforms.color;
  
  // =========================================================================
  // IMPROVED AMBIENT: Hemisphere lighting + simple AO
  // =========================================================================
  let skyColor = vec3<f32>(0.4, 0.5, 0.7);      // Cool sky
  let groundColor = vec3<f32>(0.15, 0.12, 0.1); // Warm ground bounce
  let ambientBase = hemisphereAmbient(norm, skyColor, groundColor) * 0.08;
  let ao = simpleAO(norm, input.fragPos);
  var result = albedo * ambientBase * ao;
  
  // =========================================================================
  // Approximate view direction (camera assumed near origin for simplicity)
  // In a full implementation, pass camera position via uniforms
  // =========================================================================
  let viewDir = normalize(-input.fragPos);  // Simple approximation
  let shininess = 32.0;  // Material shininess (could be uniform)
  
  // Dynamic lights with specular
  if (uniforms.enableDiffuse > 0u || uniforms.enableBounce > 0u) {
    for (var i: u32 = 0u; i < uniforms.lightCount && i < 64u; i = i + 1u) {
      let light = lights[i];
      let lightContrib = calcLightContribution(light, input.fragPos, norm, viewDir, shininess);
      
      // Intensity multiplier
      let intensity = 8.0;

      // Classic lambert + specular: surface albedo tinted by light color
      if (uniforms.enableDiffuse > 0u) {
        result = result + albedo * lightContrib * intensity;
      }

      // Fake bounce: add light color based on proximity (point/spot only)
      if (uniforms.enableBounce > 0u && light.lightType != 1u) {
        let toLight = light.position - input.fragPos;
        let distance = length(toLight);
        let bounceAtten = 1.0 / (1.0 + 0.02 * distance * distance);
        let bounceFactor = bounceAtten * 4.0;
        result = result + light.color * bounceFactor * ao;  // AO affects bounce too
      }
      
      // For directional lights, add subtle ambient bounce
      if (uniforms.enableBounce > 0u && light.lightType == 1u) {
        result = result + light.color * 0.08 * ao;
      }
    }
  }
  
  // Sun light (if enabled) - with specular
  if (uniforms.enableSun > 0u) {
    let sunDiff = max(dot(norm, uniforms.sunDir), 0.0);
    let sunSpec = blinnPhongSpecular(uniforms.sunDir, viewDir, norm, shininess) * 0.2;
    let sunBack = max(dot(norm, -uniforms.sunDir), 0.0) * 0.15;
    result = result + albedo * uniforms.sunColor * (sunDiff + sunSpec + sunBack) * 0.12 * ao;
  }

  // Simple emissive hack: if the material is very bright, make it glow
  if (uniforms.enableEmissive > 0u) {
    let maxComp = max(max(albedo.r, albedo.g), albedo.b);
    if (maxComp > 1.0) {
      let emissiveStrength = (maxComp - 1.0) * 0.3;
      result = result + albedo * emissiveStrength;  // Emissive ignores AO
    }
  }
  
  return vec4<f32>(result, uniforms.alpha);
}
`;
