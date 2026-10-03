// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  LEGACY_PCG32_WGSL,
  PBR_MATERIALS_PCG_HASH_WGSL,
} from '../../../../core/math/MathBits.js';


/**

 * PBR Materials for Path Tracing

 *

 * Physically-based materials with roughness, metallic, and Fresnel.

 *

 * Key Concepts:

 *   1. Fresnel-Schlick - Reflectance at grazing angles

 *   2. GGX/Roughness sampling - Importance sampling for specular

 *   3. Metallic workflow - Dielectric vs conductor

 *   4. Glass/refraction - Transparent materials

 *   5. Energy conservation - Diffuse + specular balance

 */



export const pbrMaterialsWGSL = /* wgsl */`

// ============================================================================

// PBR CONSTANTS

// ============================================================================



const PBR_PI : f32 = 3.14159265359;

const PBR_INV_PI : f32 = 0.31830988618;

const PBR_EPSILON : f32 = 0.0001;



// Common material F0 values (linear sRGB)

const F0_DIELECTRIC : f32 = 0.04;   // Non-metals

const F0_WATER : f32 = 0.02;

const F0_PLASTIC : f32 = 0.04;

const F0_GLASS : f32 = 0.04;

const F0_DIAMOND : f32 = 0.17;



// Metal F0 values (linear sRGB)

const F0_IRON : vec3<f32> = vec3<f32>(0.560, 0.570, 0.580);

const F0_GOLD : vec3<f32> = vec3<f32>(1.000, 0.766, 0.336);

const F0_SILVER : vec3<f32> = vec3<f32>(0.972, 0.960, 0.915);

const F0_COPPER : vec3<f32> = vec3<f32>(0.955, 0.638, 0.538);

const F0_ALUMINUM : vec3<f32> = vec3<f32>(0.913, 0.922, 0.924);

const F0_CHROMIUM : vec3<f32> = vec3<f32>(0.550, 0.556, 0.554);

const F0_PLATINUM : vec3<f32> = vec3<f32>(0.673, 0.637, 0.585);

const F0_TITANIUM : vec3<f32> = vec3<f32>(0.542, 0.497, 0.449);



// ============================================================================

// NORMAL-MAP / TANGENT-SPACE HELPERS

// ============================================================================



fn pbrNormalizeOrFallback(value : vec3<f32>, fallback : vec3<f32>) -> vec3<f32> {

  if (dot(value, value) <= PBR_EPSILON * PBR_EPSILON) {

    return normalize(fallback);

  }

  return normalize(value);

}



fn pbrFallbackTangentForNormal(normal : vec3<f32>) -> vec3<f32> {

  let axis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(normal.x) < 0.9);

  let projected = axis - normal * dot(axis, normal);

  return pbrNormalizeOrFallback(projected, vec3<f32>(1.0, 0.0, 0.0));

}



fn decodeNormalTextureSample(normalSample : vec3<f32>, normalScale : f32, greenChannelSign : f32) -> vec3<f32> {

  let tangentNormal = vec3<f32>(

    (normalSample.x * 2.0 - 1.0) * normalScale,

    (normalSample.y * 2.0 - 1.0) * normalScale * greenChannelSign,

    normalSample.z * 2.0 - 1.0

  );

  return pbrNormalizeOrFallback(tangentNormal, vec3<f32>(0.0, 0.0, 1.0));

}



fn tangentFrameNormalToWorld(baseNormal : vec3<f32>, tangent : vec4<f32>, tangentNormal : vec3<f32>) -> vec3<f32> {

  let N = pbrNormalizeOrFallback(baseNormal, vec3<f32>(0.0, 0.0, 1.0));

  let tangentFallback = pbrFallbackTangentForNormal(N);

  let projectedTangent = tangent.xyz - N * dot(tangent.xyz, N);

  let T = pbrNormalizeOrFallback(projectedTangent, tangentFallback);

  let handedness = select(1.0, -1.0, tangent.w < 0.0);

  let B = pbrNormalizeOrFallback(cross(N, T), cross(N, tangentFallback)) * handedness;

  return pbrNormalizeOrFallback(T * tangentNormal.x + B * tangentNormal.y + N * tangentNormal.z, N);

}



fn applyGlTFNormalMap(

  baseNormal : vec3<f32>,

  tangent : vec4<f32>,

  normalSample : vec3<f32>,

  normalScale : f32,

  greenChannelSign : f32

) -> vec3<f32> {

  return tangentFrameNormalToWorld(

    baseNormal,

    tangent,

    decodeNormalTextureSample(normalSample, normalScale, greenChannelSign)

  );

}



// ============================================================================

// FRESNEL FUNCTIONS
// ============================================================================



// Schlick's approximation for dielectrics (scalar F0)

fn fresnelSchlickF0(cosTheta : f32, f0 : f32) -> f32 {

  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);

}



// Schlick for metals (vec3 F0)

fn fresnelSchlickVec3(cosTheta : f32, f0 : vec3<f32>) -> vec3<f32> {

  return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - cosTheta, 5.0);

}



// Schlick with roughness term (for IBL)

fn fresnelSchlickRoughness(cosTheta : f32, f0 : f32, roughness : f32) -> f32 {

  return f0 + (max(1.0 - roughness, f0) - f0) * pow(abs(1.0 - cosTheta), 5.0);

}



// Schlick with roughness (vec3 version)

fn fresnelSchlickRoughnessVec3(cosTheta : f32, f0 : vec3<f32>, roughness : f32) -> vec3<f32> {

  let maxF0 = max(vec3<f32>(1.0 - roughness), f0);

  return f0 + (maxF0 - f0) * pow(abs(1.0 - cosTheta), 5.0);

}



// Full Fresnel for dielectric (exact, for glass)

fn fresnelDielectricExact(cosThetaI : f32, eta : f32) -> f32 {

  let sinThetaI = sqrt(max(0.0, 1.0 - cosThetaI * cosThetaI));

  let sinThetaT = sinThetaI / eta;



  // Total internal reflection

  if (sinThetaT >= 1.0) {

    return 1.0;

  }



  let cosThetaT = sqrt(max(0.0, 1.0 - sinThetaT * sinThetaT));



  let rs = (eta * cosThetaI - cosThetaT) / (eta * cosThetaI + cosThetaT);

  let rp = (cosThetaI - eta * cosThetaT) / (cosThetaI + eta * cosThetaT);



  return (rs * rs + rp * rp) * 0.5;

}



// ============================================================================

// GGX / TROWBRIDGE-REITZ DISTRIBUTION

// ============================================================================



// GGX normal distribution function

fn distributionGGX(NdotH : f32, roughness : f32) -> f32 {

  let a = roughness * roughness;

  let a2 = a * a;

  let NdotH2 = NdotH * NdotH;



  let denom = NdotH2 * (a2 - 1.0) + 1.0;

  return a2 / (PBR_PI * denom * denom);

}



// Smith's geometry function (Schlick-GGX)

fn geometrySchlickGGX(NdotV : f32, roughness : f32) -> f32 {

  let r = roughness + 1.0;

  let k = (r * r) / 8.0;

  return NdotV / (NdotV * (1.0 - k) + k);

}



// Smith's geometry function (both directions)

fn geometrySmith(NdotV : f32, NdotL : f32, roughness : f32) -> f32 {

  let ggx2 = geometrySchlickGGX(NdotV, roughness);

  let ggx1 = geometrySchlickGGX(NdotL, roughness);

  return ggx1 * ggx2;

}



// ============================================================================

// IMPORTANCE SAMPLING

// ============================================================================



// Sample GGX microfacet normal (importance sampling)

fn sampleGGX(normal : vec3<f32>, roughness : f32, xi : vec2<f32>) -> vec3<f32> {

  let a = roughness * roughness;

  let a2 = a * a;



  // Sample half-vector in tangent space

  let phi = 2.0 * PBR_PI * xi.x;

  let cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a2 - 1.0) * xi.y));

  let sinTheta = sqrt(1.0 - cosTheta * cosTheta);



  let H = vec3<f32>(

    cos(phi) * sinTheta,

    sin(phi) * sinTheta,

    cosTheta

  );



  // Transform to world space

  let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(normal.z) < 0.999);

  let tangent = normalize(cross(up, normal));

  let bitangent = cross(normal, tangent);



  return normalize(tangent * H.x + bitangent * H.y + normal * H.z);

}



// Modify direction with roughness (for reflections)

fn modifyDirectionWithRoughness(

  reflectDir : vec3<f32>,

  roughness : f32,

  xi : vec2<f32>

) -> vec3<f32> {

  // Build basis around reflection direction

  let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(reflectDir.y) > 0.5);

  let tangent = normalize(cross(reflectDir, up));

  let bitangent = cross(tangent, reflectDir);



  // Sample based on roughness

  let a = roughness * roughness;

  let a2 = a * a * a * a; // Extra power for sharper reflections



  let cosTheta = sqrt(abs((1.0 - xi.y) / clamp(1.0 + (a2 - 1.0) * xi.y, PBR_EPSILON, 1.0)));

  let sinTheta = sqrt(abs(1.0 - cosTheta * cosTheta));

  let phi = 2.0 * PBR_PI * xi.x;



  let rx = sinTheta * cos(phi);

  let ry = sinTheta * sin(phi);



  return normalize(rx * tangent + ry * bitangent + cosTheta * reflectDir);

}



// PDF for GGX sampling

fn pdfGGX(NdotH : f32, HdotV : f32, roughness : f32) -> f32 {

  let D = distributionGGX(NdotH, roughness);

  return (D * NdotH) / (4.0 * HdotV);

}



// ============================================================================

// DIFFUSE BRDF

// ============================================================================



// Lambertian diffuse

fn diffuseLambertian(albedo : vec3<f32>) -> vec3<f32> {

  return albedo * PBR_INV_PI;

}



// Disney diffuse (more realistic)

fn diffuseDisney(

  albedo : vec3<f32>,

  roughness : f32,

  NdotL : f32,

  NdotV : f32,

  LdotH : f32

) -> vec3<f32> {

  let fd90 = 0.5 + 2.0 * LdotH * LdotH * roughness;

  let lightScatter = 1.0 + (fd90 - 1.0) * pow(1.0 - NdotL, 5.0);

  let viewScatter = 1.0 + (fd90 - 1.0) * pow(1.0 - NdotV, 5.0);

  return albedo * PBR_INV_PI * lightScatter * viewScatter;

}



// Oren-Nayar diffuse (rough surfaces)

fn diffuseOrenNayar(

  albedo : vec3<f32>,

  roughness : f32,

  NdotL : f32,

  NdotV : f32,

  VdotL : f32

) -> vec3<f32> {

  let sigma2 = roughness * roughness;

  let A = 1.0 - 0.5 * sigma2 / (sigma2 + 0.33);

  let B = 0.45 * sigma2 / (sigma2 + 0.09);



  let cosThetaI = NdotL;

  let cosThetaO = NdotV;

  let sinThetaI = sqrt(max(0.0, 1.0 - cosThetaI * cosThetaI));

  let sinThetaO = sqrt(max(0.0, 1.0 - cosThetaO * cosThetaO));



  var maxCos = 0.0;

  if (sinThetaI > PBR_EPSILON && sinThetaO > PBR_EPSILON) {

    let sinPhiI = 0.0; // Simplified

    let cosPhiI = 1.0;

    let sinPhiO = 0.0;

    let cosPhiO = 1.0;

    maxCos = max(0.0, cosPhiI * cosPhiO + sinPhiI * sinPhiO);

  }



  let sinAlpha = select(sinThetaI, sinThetaO, cosThetaI > cosThetaO);

  let tanBeta = select(sinThetaO / cosThetaO, sinThetaI / cosThetaI, cosThetaI > cosThetaO);



  return albedo * PBR_INV_PI * (A + B * maxCos * sinAlpha * tanBeta);

}



// ============================================================================

// FULL PBR BRDF

// ============================================================================



// Cook-Torrance specular BRDF

fn specularCookTorrance(

  NdotL : f32,

  NdotV : f32,

  NdotH : f32,

  VdotH : f32,

  roughness : f32,

  F : vec3<f32>

) -> vec3<f32> {

  let D = distributionGGX(NdotH, roughness);

  let G = geometrySmith(NdotV, NdotL, roughness);



  let numerator = D * G * F;

  let denominator = 4.0 * NdotV * NdotL + PBR_EPSILON;



  return numerator / denominator;

}



// Full PBR BRDF (diffuse + specular)

fn evaluatePBR(

  albedo : vec3<f32>,

  metallic : f32,

  roughness : f32,

  N : vec3<f32>,

  V : vec3<f32>,

  L : vec3<f32>

) -> vec3<f32> {

  let H = normalize(V + L);



  let NdotL = max(dot(N, L), 0.0);

  let NdotV = max(dot(N, V), 0.0);

  let NdotH = max(dot(N, H), 0.0);

  let VdotH = max(dot(V, H), 0.0);



  // F0 for metallic workflow

  let f0 = mix(vec3<f32>(F0_DIELECTRIC), albedo, metallic);

  let F = fresnelSchlickVec3(VdotH, f0);



  // Specular (metals and dielectrics)

  let specular = specularCookTorrance(NdotL, NdotV, NdotH, VdotH, roughness, F);



  // Diffuse (only for dielectrics)

  let kD = (vec3<f32>(1.0) - F) * (1.0 - metallic);

  let diffuse = kD * diffuseLambertian(albedo);



  return (diffuse + specular) * NdotL;

}



// ============================================================================

// PATH TRACING MATERIAL SAMPLING

// ============================================================================



struct MaterialSample {

  direction : vec3<f32>,

  throughput : vec3<f32>,

  pdf : f32,

}



// Sample material for path tracing

fn sampleMaterial(

  albedo : vec3<f32>,

  metallic : f32,

  roughness : f32,

  N : vec3<f32>,

  V : vec3<f32>,

  xi : vec2<f32>,

  xi2 : f32

) -> MaterialSample {

  var result : MaterialSample;



  let NdotV = max(dot(N, V), 0.0);

  let f0 = mix(F0_DIELECTRIC, luminancePBR(albedo), metallic);

  let F = fresnelSchlickRoughness(NdotV, f0, roughness);



  // Probability of sampling specular vs diffuse

  let specProb = F + metallic * (1.0 - F);



  if (xi2 < specProb) {

    // Sample specular

    let R = reflect(-V, N);

    result.direction = modifyDirectionWithRoughness(R, roughness, xi);



    // Make sure direction is in correct hemisphere

    if (dot(result.direction, N) <= 0.0) {

      result.direction = cosineWeightedDirectionPBR(N, xi);

    }



    if (metallic > 0.5) {

      result.throughput = albedo;

    } else {

      result.throughput = vec3<f32>(1.0);

    }

    result.pdf = specProb;

  } else {

    // Sample diffuse

    result.direction = cosineWeightedDirectionPBR(N, xi);

    result.throughput = albedo;

    result.pdf = 1.0 - specProb;

  }



  return result;

}



// Helper: luminance

fn luminancePBR(color : vec3<f32>) -> f32 {

  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));

}



// Helper: cosine-weighted hemisphere direction

fn cosineWeightedDirectionPBR(N : vec3<f32>, xi : vec2<f32>) -> vec3<f32> {

  let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(N.y) > 0.5);

  let tangent = normalize(cross(N, up));

  let bitangent = cross(tangent, N);



  let r = sqrt(xi.y);

  let phi = 2.0 * PBR_PI * xi.x;



  let x = r * cos(phi);

  let y = r * sin(phi);

  let z = sqrt(abs(1.0 - xi.y));



  return normalize(x * tangent + y * bitangent + z * N);

}



// ============================================================================

// GLASS / REFRACTION

// ============================================================================



// Sample glass material

fn sampleGlass(

  N : vec3<f32>,

  V : vec3<f32>,

  ior : f32,

  roughness : f32,

  xi : vec2<f32>,

  xi2 : f32

) -> vec3<f32> {

  let NdotV = dot(N, V);

  let entering = NdotV > 0.0;



  let eta = select(ior, 1.0 / ior, entering);

  let normal = select(-N, N, entering);

  let cosTheta = abs(NdotV);



  let F = fresnelDielectricExact(cosTheta, eta);



  if (xi2 < F) {

    // Reflect

    var R = reflect(-V, normal);

    if (roughness > 0.0) {

      R = modifyDirectionWithRoughness(R, roughness, xi);

    }

    return R;

  } else {

    // Refract

    var T = refract(-V, normal, 1.0 / eta);

    if (length(T) < 0.5) {

      // Total internal reflection

      T = reflect(-V, normal);

    }

    if (roughness > 0.0) {

      T = modifyDirectionWithRoughness(T, roughness, xi);

    }

    return T;

  }

}



// ============================================================================

// PROCEDURAL TEXTURES

// ============================================================================



// PCG hash - deterministic across all GPUs
${LEGACY_PCG32_WGSL}
${PBR_MATERIALS_PCG_HASH_WGSL}

// Simple tri-planar noise sampling (for metals)
fn triplanarNoise(pos : vec3<f32>, normal : vec3<f32>, scale : f32) -> f32 {

  let blend = abs(normal);

  let blendNorm = blend / (blend.x + blend.y + blend.z);



  // Deterministic hash-based noise (PCG)

  let sp = pos * scale;

  let nx = f32(pcg_pbr(bitcast<u32>(sp.y) + pcg_pbr(bitcast<u32>(sp.z)))) / 4294967295.0;

  let ny = f32(pcg_pbr(bitcast<u32>(sp.x) + pcg_pbr(bitcast<u32>(sp.z) + 1u))) / 4294967295.0;

  let nz = f32(pcg_pbr(bitcast<u32>(sp.x) + pcg_pbr(bitcast<u32>(sp.y) + 2u))) / 4294967295.0;



  return nx * blendNorm.x + ny * blendNorm.y + nz * blendNorm.z;

}



// Metal wear/scratches

fn metalWear(noise : f32, wearAmount : f32) -> f32 {

  let wear = 1.0 - noise * noise;

  return wear * wearAmount;

}



// ============================================================================

// GGX MULTISCATTER ENERGY COMPENSATION (Fdez-Agüera 2019)

// ============================================================================

// Fixes energy loss in rough metals - without this, rough metals appear too dark

// Reference: http://www.jcgt.org/published/0008/01/03/paper.pdf



// Directional albedo (single scattering) - from precomputed LUT or approximation

// fa, fb are scale and bias from environment BRDF LUT

fn directionalAlbedoSS(f0 : vec3<f32>, fa : f32, fb : f32) -> vec3<f32> {

  return f0 * fa + fb;

}



// Average Fresnel reflectance

fn averageFresnel(f0 : vec3<f32>) -> vec3<f32> {

  return f0 + (vec3<f32>(1.0) - f0) * (1.0 / 21.0);

}



// Multiscatter energy compensation factor

fn multiscatterCompensation(

  f0 : vec3<f32>,

  fa : f32,  // BRDF LUT scale (precomputed)

  fb : f32   // BRDF LUT bias (precomputed)

) -> vec3<f32> {

  // Single scattering directional albedo

  let Ess = fa + fb;



  // Average Fresnel

  let Favg = averageFresnel(f0);



  // Multiscatter contribution (geometric series)

  let Fms = (vec3<f32>(1.0) - Ess) * Favg / (vec3<f32>(1.0) - Favg * (1.0 - Ess));



  return vec3<f32>(1.0) + Fms;

}



// Full multiscatter BRDF evaluation

// Use this instead of evaluatePBR for physically correct rough metals

fn evaluatePBRMultiscatter(

  albedo : vec3<f32>,

  metallic : f32,

  roughness : f32,

  N : vec3<f32>,

  V : vec3<f32>,

  L : vec3<f32>,

  fa : f32,  // From BRDF LUT at (NdotV, roughness)

  fb : f32

) -> vec3<f32> {

  let H = normalize(V + L);



  let NdotL = max(dot(N, L), 0.0);

  let NdotV = max(dot(N, V), 0.0);

  let NdotH = max(dot(N, H), 0.0);

  let VdotH = max(dot(V, H), 0.0);



  // F0 for metallic workflow

  let f0 = mix(vec3<f32>(F0_DIELECTRIC), albedo, metallic);

  let F = fresnelSchlickVec3(VdotH, f0);



  // Single-scatter specular

  let specular = specularCookTorrance(NdotL, NdotV, NdotH, VdotH, roughness, F);



  // Multiscatter compensation (key improvement!)

  let msCompensation = multiscatterCompensation(f0, fa, fb);

  let specularMS = specular * msCompensation;



  // Diffuse (only for dielectrics)

  let kD = (vec3<f32>(1.0) - F) * (1.0 - metallic);

  let diffuse = kD * diffuseLambertian(albedo);



  return (diffuse + specularMS) * NdotL;

}



// Approximate BRDF LUT values (when texture not available)

// Based on analytical fit from Epic Games

fn approximateBRDFLUT(NdotV : f32, roughness : f32) -> vec2<f32> {

  let r = roughness;

  let v = NdotV;



  // Analytical approximation

  let fa = 1.0 - pow(1.0 - v, 5.0) * (1.0 - r);

  let fb = pow(1.0 - v, 5.0) * (1.0 - r);



  return vec2<f32>(fa, fb);

}



// ============================================================================

// HENYEY-GREENSTEIN PHASE FUNCTION (for volumetrics)

// ============================================================================



fn henyeyGreensteinVol(cosTheta : f32, g : f32) -> f32 {

  let g2 = g * g;

  let denom = 1.0 + g2 - 2.0 * g * cosTheta;

  return (1.0 / (4.0 * PBR_PI)) * ((1.0 - g2) / pow(denom, 1.5));

}

`;



export default pbrMaterialsWGSL;
