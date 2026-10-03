// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PBR Material Uniforms - Standard material parameter bindings
 */
export const pbrMaterialUniformsWGSL = /* wgsl */`
struct MaterialUniforms {
  baseColorFactor  : vec4<f32>,
  emissiveFactor   : vec3<f32>,
  metallicFactor   : f32,
  roughnessFactor  : f32,
};

@group(1) @binding(0)
var<uniform> uMaterial : MaterialUniforms;

const DIELECTRIC_F0 : vec3<f32> = vec3<f32>(0.04, 0.04, 0.04);

fn saturateScalar(x : f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn getMaterialBaseColor() -> vec3<f32> {
  return uMaterial.baseColorFactor.rgb;
}

fn getMaterialEmissive() -> vec3<f32> {
  return uMaterial.emissiveFactor;
}

fn getMaterialMetallicRoughness() -> vec2<f32> {
  let metallic  = saturateScalar(uMaterial.metallicFactor);
  let roughness = clamp(uMaterial.roughnessFactor, 0.04, 1.0);
  return vec2<f32>(metallic, roughness);
}

fn getMaterialF0() -> vec3<f32> {
  let metallic = saturateScalar(uMaterial.metallicFactor);
  let baseColor = getMaterialBaseColor();
  return mix(DIELECTRIC_F0, baseColor, metallic);
}
`;
