// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PBR IBL - Image-based lighting for diffuse irradiance and specular reflections
 */
export const pbrIblWGSL = /* wgsl */`
const PI : f32 = 3.14159265;

fn pbrIblSaturate(x : f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn computePbrIblDiffuse(
  N : vec3<f32>,
  baseColor : vec3<f32>,
  diffuseEnv : texture_cube<f32>,
  envSampler : sampler
) -> vec3<f32> {
  let n = normalize(N);
  let irradiance = textureSample(diffuseEnv, envSampler, n).rgb;
  let diffuse = baseColor * irradiance / PI;
  return diffuse;
}

fn computePbrIblSpecular(
  N : vec3<f32>,
  V : vec3<f32>,
  roughness : f32,
  F0 : vec3<f32>,
  prefilteredEnv : texture_cube<f32>,
  envSampler : sampler,
  brdfLut : texture_2d<f32>,
  brdfSampler : sampler
) -> vec3<f32> {
  let n = normalize(N);
  let v = normalize(V);
  let NdotV = pbrIblSaturate(dot(n, v));

  let numLevels = textureNumLevels(prefilteredEnv);
  let maxMip = max(f32(numLevels - 1), 0.0);
  let mipLevel = roughness * maxMip;

  let prefilteredColor =
    textureSampleLevel(prefilteredEnv, envSampler, n, mipLevel).rgb;

  let brdfSample = textureSample(
    brdfLut,
    brdfSampler,
    vec2<f32>(NdotV, roughness)
  ).rg;

  let specular = prefilteredColor * (F0 * brdfSample.x + brdfSample.y);
  return specular;
}
`;
