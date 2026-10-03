// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PBR BRDF - Physically-based rendering BRDF functions (GGX/Schlick)
 *
 * Dependencies: Requires mathCommonWGSL for saturate() and PI.
 * These are provided separately to avoid duplication when composing shaders.
 */
import { mathCommonWGSL } from "../modules/chunks/math_common.js";

// PBR-specific struct (not in common because it's only used here)
export const pbrInputsStructWGSL = /* wgsl */`
struct PbrInputs {
  N : vec3<f32>,
  V : vec3<f32>,
  L : vec3<f32>,
  baseColor : vec3<f32>,
  metallic : f32,
  roughness : f32,
  F0 : vec3<f32>,
};
`;

// PBR BRDF functions - use saturate() from math_common.js
export const pbrBrdfFunctionsWGSL = /* wgsl */`
fn fresnelSchlick(cosTheta : f32, F0 : vec3<f32>) -> vec3<f32> {
  let ct = saturate(cosTheta);
  let oneMinus = 1.0 - ct;
  return F0 + (vec3<f32>(1.0) - F0) * pow5(oneMinus);
}

fn distributionGGX(N : vec3<f32>, H : vec3<f32>, roughness : f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let NdotH = saturate(dot(N, H));
  let NdotH2 = NdotH * NdotH;
  let denom = NdotH2 * (a2 - 1.0) + 1.0;
  return a2 / (PI * sq(denom));
}

fn geometrySchlickGGX(NdotV : f32, roughness : f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}

fn geometrySmith(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, roughness : f32) -> f32 {
  let NdotV = saturate(dot(N, V));
  let NdotL = saturate(dot(N, L));
  let ggx1 = geometrySchlickGGX(NdotV, roughness);
  let ggx2 = geometrySchlickGGX(NdotL, roughness);
  return ggx1 * ggx2;
}

fn pbrBrdfNormalizeOrFallback(value : vec3<f32>, fallback : vec3<f32>) -> vec3<f32> {
  if (dot(value, value) <= 0.00000001) {
    return normalize(fallback);
  }
  return normalize(value);
}

fn pbrBrdfFallbackTangentForNormal(normal : vec3<f32>) -> vec3<f32> {
  let axis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(normal.x) < 0.9);
  let projected = axis - normal * dot(axis, normal);
  return pbrBrdfNormalizeOrFallback(projected, vec3<f32>(1.0, 0.0, 0.0));
}

fn pbrBrdfDecodeNormalTextureSample(normalSample : vec3<f32>, normalScale : f32, greenChannelSign : f32) -> vec3<f32> {
  let tangentNormal = vec3<f32>(
    (normalSample.x * 2.0 - 1.0) * normalScale,
    (normalSample.y * 2.0 - 1.0) * normalScale * greenChannelSign,
    normalSample.z * 2.0 - 1.0
  );
  return pbrBrdfNormalizeOrFallback(tangentNormal, vec3<f32>(0.0, 0.0, 1.0));
}

fn pbrBrdfTangentFrameNormalToWorld(baseNormal : vec3<f32>, tangent : vec4<f32>, tangentNormal : vec3<f32>) -> vec3<f32> {
  let nBase = pbrBrdfNormalizeOrFallback(baseNormal, vec3<f32>(0.0, 0.0, 1.0));
  let tangentFallback = pbrBrdfFallbackTangentForNormal(nBase);
  let projectedTangent = tangent.xyz - nBase * dot(tangent.xyz, nBase);
  let t = pbrBrdfNormalizeOrFallback(projectedTangent, tangentFallback);
  let handedness = select(1.0, -1.0, tangent.w < 0.0);
  let b = pbrBrdfNormalizeOrFallback(cross(nBase, t), cross(nBase, tangentFallback)) * handedness;
  return pbrBrdfNormalizeOrFallback(t * tangentNormal.x + b * tangentNormal.y + nBase * tangentNormal.z, nBase);
}

fn pbrBrdfApplyGlTFNormalMap(
  baseNormal : vec3<f32>,
  tangent : vec4<f32>,
  normalSample : vec3<f32>,
  normalScale : f32,
  greenChannelSign : f32
) -> vec3<f32> {
  return pbrBrdfTangentFrameNormalToWorld(
    baseNormal,
    tangent,
    pbrBrdfDecodeNormalTextureSample(normalSample, normalScale, greenChannelSign)
  );
}

fn unpackNormal(encoded : vec3<f32>) -> vec3<f32> {
  return pbrBrdfDecodeNormalTextureSample(encoded, 1.0, 1.0);
}

fn applyNormalMap(
  baseNormal : vec3<f32>,
  tangent : vec3<f32>,
  bitangent : vec3<f32>,
  normalSample : vec3<f32>
) -> vec3<f32> {
  let n = unpackNormal(normalSample);
  let t = normalize(tangent);
  let b = normalize(bitangent);
  let nBase = normalize(baseNormal);
  let TBN = mat3x3<f32>(t, b, nBase);
  return normalize(TBN * n);
}

fn evaluatePbrBrdf(inputs : PbrInputs) -> vec3<f32> {
  let N = normalize(inputs.N);
  let V = normalize(inputs.V);
  let L = normalize(inputs.L);
  let H = normalize(V + L);

  let NdotL = saturate(dot(N, L));
  let NdotV = saturate(dot(N, V));

  if (NdotL <= 0.0 || NdotV <= 0.0) {
    return vec3<f32>(0.0);
  }

  let metallic = saturate(inputs.metallic);
  let rough = clamp(inputs.roughness, 0.04, 1.0);
  let F0 = mix(inputs.F0, inputs.baseColor, metallic);

  let F = fresnelSchlick(saturate(dot(H, V)), F0);
  let D = distributionGGX(N, H, rough);
  let G = geometrySmith(N, V, L, rough);

  let numerator = F * D * G;
  let denom = 4.0 * NdotV * NdotL + EPSILON;
  let specular = numerator / denom;

  let kd = (vec3<f32>(1.0) - F) * (1.0 - metallic);
  let diffuse = kd * inputs.baseColor * INV_PI;

  return (diffuse + specular) * NdotL;
}
`;

// Complete PBR BRDF module with all dependencies
export const pbrBrdfWGSL = mathCommonWGSL + pbrInputsStructWGSL + pbrBrdfFunctionsWGSL;
