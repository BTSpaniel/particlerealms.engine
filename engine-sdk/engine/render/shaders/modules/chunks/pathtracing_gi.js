// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * Path Tracing Global Illumination

 *

 * Advanced path tracing with GI bounces, volumetrics, and temporal accumulation.

 *

 * Key Concepts:

 *   1. Indirect lighting - Multi-bounce GI

 *   2. Cosine-weighted sampling - Diffuse hemisphere

 *   3. Volumetric fog - Density, absorption, scattering

 *   4. Henyey-Greenstein - Anisotropic phase function

 *   5. Temporal reprojection - Sample accumulation

 *   6. Depth of Field - Aperture simulation

 *   7. ACES tone mapping - Film color response

 *   8. Bloom - Gaussian glow

 */

import {
  LEGACY_PCG32_WGSL,
  PATH_TRACING_GI_PCG_WGSL,
} from '../../../../core/math/MathBits.js';


export const pathtracingGIWGSL = /* wgsl */`

// ============================================================================

// PATH TRACING CONSTANTS

// ============================================================================



const PT_PI : f32 = 3.14159265359;

const PT_TAU : f32 = 6.28318530718;



// ============================================================================

// RANDOM NUMBER GENERATION

// ============================================================================



// PCG random - better quality than basic hash
${LEGACY_PCG32_WGSL}
${PATH_TRACING_GI_PCG_WGSL}


// Vec2 random

fn randomVec2PT(seed : ptr<function, u32>) -> vec2<f32> {

  return vec2<f32>(randomFloatPT(seed), randomFloatPT(seed));

}



// Vec3 random

fn randomVec3PT(seed : ptr<function, u32>) -> vec3<f32> {

  return vec3<f32>(randomFloatPT(seed), randomFloatPT(seed), randomFloatPT(seed));

}



// Initialize seed from pixel and frame

fn initSeed(fragCoord : vec2<f32>, frame : u32) -> u32 {

  let px = u32(fragCoord.x);

  let py = u32(fragCoord.y);

  return pcgHash(px + pcgHash(py + pcgHash(frame)));

}



// ============================================================================

// HEMISPHERE SAMPLING

// ============================================================================



// Get orthogonal vector

fn orthoPT(v : vec3<f32>) -> vec3<f32> {

  if (abs(v.x) > abs(v.z)) {

    return vec3<f32>(-v.y, v.x, 0.0);

  }

  return vec3<f32>(0.0, -v.z, v.y);

}



// Cosine-weighted hemisphere sample (for diffuse)

fn cosineWeightedSample(normal : vec3<f32>, seed : ptr<function, u32>) -> vec3<f32> {

  let o1 = normalize(orthoPT(normal));

  let o2 = normalize(cross(normal, o1));



  let r1 = randomFloatPT(seed) * PT_TAU;

  let r2 = randomFloatPT(seed);

  let r2s = sqrt(r2);



  let oneminus = sqrt(1.0 - r2);

  return cos(r1) * oneminus * o1 + sin(r1) * oneminus * o2 + r2s * normal;

}



// Uniform hemisphere sample

fn uniformHemisphereSample(normal : vec3<f32>, seed : ptr<function, u32>) -> vec3<f32> {

  let o1 = normalize(orthoPT(normal));

  let o2 = normalize(cross(normal, o1));



  let r1 = randomFloatPT(seed) * PT_TAU;

  let r2 = randomFloatPT(seed);



  let sinTheta = sqrt(1.0 - r2 * r2);

  return cos(r1) * sinTheta * o1 + sin(r1) * sinTheta * o2 + r2 * normal;

}



// Uniform sphere sample

fn uniformSphereSample(seed : ptr<function, u32>) -> vec3<f32> {

  let z = randomFloatPT(seed) * 2.0 - 1.0;

  let r = sqrt(1.0 - z * z);

  let phi = randomFloatPT(seed) * PT_TAU;

  return vec3<f32>(r * cos(phi), r * sin(phi), z);

}



// ============================================================================

// PHASE FUNCTIONS (Volumetric Scattering)

// ============================================================================



// Henyey-Greenstein phase function

// g: anisotropy parameter (-1 = back, 0 = isotropic, 1 = forward)

fn henyeyGreenstein(cosTheta : f32, g : f32) -> f32 {

  let g2 = g * g;

  let denom = 1.0 + g2 - 2.0 * g * cosTheta;

  return (1.0 - g2) / (4.0 * PT_PI * pow(denom, 1.5));

}



// HG with direction vectors

fn henyeyGreensteinDir(dirIn : vec3<f32>, dirOut : vec3<f32>, g : f32) -> f32 {

  let cosTheta = dot(dirIn, dirOut);

  return henyeyGreenstein(cosTheta, g);

}



// Schlick approximation of HG (faster)

fn schlickPhase(cosTheta : f32, g : f32) -> f32 {

  let k = 1.55 * g - 0.55 * g * g * g;

  let denom = 1.0 - k * cosTheta;

  return (1.0 - k * k) / (4.0 * PT_PI * denom * denom);

}



// Rayleigh scattering phase (for small particles)

fn rayleighPhase(cosTheta : f32) -> f32 {

  return (3.0 / (16.0 * PT_PI)) * (1.0 + cosTheta * cosTheta);

}



// ============================================================================

// VOLUMETRIC FOG

// ============================================================================



struct VolumetricParams {

  density : vec3<f32>,       // RGB absorption

  anisotropy : f32,          // HG parameter

  scatterStrength : f32,     // Scattering multiplier

  maxDistance : f32,         // Fog range

}



// Beer-Lambert absorption

fn beerLambertAbsorption(density : vec3<f32>, distance : f32) -> vec3<f32> {

  return exp(-density * distance);

}



// Single-scattering fog march

fn marchFog(

  rayOrigin : vec3<f32>,

  rayDir : vec3<f32>,

  maxDist : f32,

  steps : i32,

  lightDir : vec3<f32>,

  lightColor : vec3<f32>,

  params : VolumetricParams

) -> vec3<f32> {

  let stepDist = min(params.maxDistance, maxDist) / f32(steps);

  let stepAbsorption = beerLambertAbsorption(params.density, stepDist);



  // Phase function for this view/light angle

  let phase = henyeyGreensteinDir(-lightDir, rayDir, params.anisotropy);

  let stepScatter = (vec3<f32>(1.0) - stepAbsorption) * phase * params.scatterStrength;



  var accumulated = vec3<f32>(0.0);

  var transmission = vec3<f32>(1.0);

  var pos = rayOrigin;



  for (var i = 0; i < steps; i = i + 1) {

    pos = pos + rayDir * stepDist;

    transmission = transmission * stepAbsorption;



    // In-scatter from light (would need shadow test here)

    accumulated = accumulated + stepScatter * transmission * lightColor;

  }



  return accumulated;

}



// Apply fog to color

fn applyFog(

  color : vec3<f32>,

  rayOrigin : vec3<f32>,

  rayDir : vec3<f32>,

  hitDist : f32,

  lightDir : vec3<f32>,

  lightColor : vec3<f32>,

  params : VolumetricParams

) -> vec3<f32> {

  // Absorption along view ray

  let fogDist = min(hitDist, params.maxDistance);

  let absorption = beerLambertAbsorption(params.density, fogDist);



  // In-scattered light

  let inscatter = marchFog(rayOrigin, rayDir, hitDist, 8, lightDir, lightColor, params);



  return color * absorption + inscatter;

}



// ============================================================================

// GLOBAL ILLUMINATION

// ============================================================================



struct GIResult {

  color : vec3<f32>,

  hitPos : vec3<f32>,

  hitNormal : vec3<f32>,

  didHit : bool,

}



// Trace single GI bounce (template - needs SDF function)

fn traceGIBounce(

  pos : vec3<f32>,

  normal : vec3<f32>,

  seed : ptr<function, u32>

) -> GIResult {

  var result : GIResult;

  result.didHit = false;

  result.color = vec3<f32>(0.0);



  // Get random bounce direction

  let bounceDir = cosineWeightedSample(normal, seed);



  // March in that direction (implement with your SDF)

  // result = traceSDF(pos + normal * epsilon, bounceDir);



  return result;

}



// Accumulate multiple GI samples

fn accumulateGI(

  currentSample : vec3<f32>,

  previousAccum : vec3<f32>,

  sampleCount : f32

) -> vec3<f32> {

  return mix(previousAccum, currentSample, 1.0 / sampleCount);

}



// ============================================================================

// TEMPORAL REPROJECTION

// ============================================================================



// Reproject world position to previous frame UV

fn reprojectToPrevFrame(

  worldPos : vec3<f32>,

  prevViewProj : mat4x4<f32>,

  resolution : vec2<f32>

) -> vec2<f32> {

  let clipPos = prevViewProj * vec4<f32>(worldPos, 1.0);

  let ndc = clipPos.xyz / clipPos.w;

  return (ndc.xy * 0.5 + 0.5) * resolution;

}



// Check if reprojected sample is valid

fn isValidReproject(

  currentWorldPos : vec3<f32>,

  prevWorldPos : vec3<f32>,

  threshold : f32

) -> bool {

  return length(currentWorldPos - prevWorldPos) < threshold;

}



// Temporal blend with rejection

fn temporalBlend(

  currentSample : vec3<f32>,

  historySample : vec3<f32>,

  historyValid : bool,

  blendFactor : f32

) -> vec3<f32> {

  if (!historyValid) {

    return currentSample;

  }

  return mix(historySample, currentSample, blendFactor);

}



// ============================================================================

// DEPTH OF FIELD

// ============================================================================



struct DoFParams {

  focalDistance : f32,

  aperture : f32,

  maxBlur : f32,

}



// Circle of Confusion size

fn circleOfConfusion(depth : f32, params : DoFParams) -> f32 {

  let coc = abs(depth - params.focalDistance) / depth * params.aperture;

  return min(coc, params.maxBlur);

}



// Generate point on aperture disk

fn apertureOffset(seed : ptr<function, u32>, aperture : f32) -> vec2<f32> {

  let r = sqrt(randomFloatPT(seed)) * aperture;

  let theta = randomFloatPT(seed) * PT_TAU;

  return vec2<f32>(r * cos(theta), r * sin(theta));

}



// DoF ray modification

fn dofRay(

  rayOrigin : vec3<f32>,

  rayDir : vec3<f32>,

  focalDistance : f32,

  aperture : f32,

  right : vec3<f32>,

  up : vec3<f32>,

  seed : ptr<function, u32>

) -> vec3<f32> {

  // Point on focal plane

  let focalPoint = rayOrigin + rayDir * focalDistance;



  // Random offset on aperture

  let offset = apertureOffset(seed, aperture);

  let newOrigin = rayOrigin + right * offset.x + up * offset.y;



  return normalize(focalPoint - newOrigin);

}



// ============================================================================

// TONE MAPPING

// ============================================================================



// ACES Filmic (standard film response)

fn acesFilmicTonemap(x : vec3<f32>) -> vec3<f32> {

  let a = 2.51;

  let b = 0.03;

  let c = 2.43;

  let d = 0.59;

  let e = 0.14;

  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));

}



// Reinhard (simple)

fn reinhardTonemap(x : vec3<f32>) -> vec3<f32> {

  return x / (x + vec3<f32>(1.0));

}



// Reinhard extended (with white point)

fn reinhardExtendedTonemap(x : vec3<f32>, whitePoint : f32) -> vec3<f32> {

  let wp2 = whitePoint * whitePoint;

  let numerator = x * (vec3<f32>(1.0) + x / wp2);

  return numerator / (vec3<f32>(1.0) + x);

}



// Uncharted 2 filmic

fn uncharted2Tonemap(x : vec3<f32>) -> vec3<f32> {

  let A = 0.15;

  let B = 0.50;

  let C = 0.10;

  let D = 0.20;

  let E = 0.02;

  let F = 0.30;

  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;

}



// Neutral (balanced, no color shift)

fn neutralTonemap(x : vec3<f32>) -> vec3<f32> {

  let a = 0.2;

  let b = 0.29;

  let c = 0.24;

  let d = 0.272;

  let e = 0.02;

  let f = 0.3;

  let w = 11.2;

  return ((x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f)) - e / f;

}



// ============================================================================

// BLOOM

// ============================================================================



// Gaussian weight

fn gaussianWeight(offset : vec2<f32>, sigma : f32) -> f32 {

  let d2 = dot(offset, offset);

  return exp(-d2 / (2.0 * sigma * sigma));

}



// 3x3 Gaussian kernel weights

fn gaussianKernel3x3() -> array<f32, 9> {

  return array<f32, 9>(

    1.0/16.0, 2.0/16.0, 1.0/16.0,

    2.0/16.0, 4.0/16.0, 2.0/16.0,

    1.0/16.0, 2.0/16.0, 1.0/16.0

  );

}



// 5x5 Gaussian kernel (for bloom)

fn gaussianKernel5x5() -> array<f32, 25> {

  return array<f32, 25>(

    1.0/273.0,  4.0/273.0,  7.0/273.0,  4.0/273.0, 1.0/273.0,

    4.0/273.0, 16.0/273.0, 26.0/273.0, 16.0/273.0, 4.0/273.0,

    7.0/273.0, 26.0/273.0, 41.0/273.0, 26.0/273.0, 7.0/273.0,

    4.0/273.0, 16.0/273.0, 26.0/273.0, 16.0/273.0, 4.0/273.0,

    1.0/273.0,  4.0/273.0,  7.0/273.0,  4.0/273.0, 1.0/273.0

  );

}



// Threshold for bloom extraction

fn bloomThreshold(color : vec3<f32>, threshold : f32, softKnee : f32) -> vec3<f32> {

  let brightness = max(color.r, max(color.g, color.b));

  let soft = brightness - threshold + softKnee;

  let contribution = max(soft, 0.0) / (2.0 * softKnee + 0.00001);

  let factor = max(brightness - threshold, contribution) / max(brightness, 0.00001);

  return color * factor;

}



// ============================================================================

// COLOR GRADING

// ============================================================================



// Exposure adjustment

fn exposure(color : vec3<f32>, ev : f32) -> vec3<f32> {

  return color * pow(2.0, ev);

}



// Contrast adjustment

fn contrast(color : vec3<f32>, amount : f32) -> vec3<f32> {

  return (color - 0.5) * amount + 0.5;

}



// Saturation adjustment

fn saturation(color : vec3<f32>, amount : f32) -> vec3<f32> {

  let grey = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));

  return mix(vec3<f32>(grey), color, amount);

}



// Lift-Gamma-Gain

fn liftGammaGain(

  color : vec3<f32>,

  lift : vec3<f32>,

  gamma : vec3<f32>,

  gain : vec3<f32>

) -> vec3<f32> {

  let lifted = color * (vec3<f32>(1.0) - lift) + lift;

  let gained = lifted * gain;

  return pow(gained, vec3<f32>(1.0) / gamma);

}



// Simple vignette

fn vignetteEffect(uv : vec2<f32>, intensity : f32, smoothness : f32) -> f32 {

  let centeredUV = uv * 2.0 - 1.0;

  let dist = length(centeredUV);

  return 1.0 - smoothstep(1.0 - smoothness, 1.0, dist * intensity);

}

`;



export default pathtracingGIWGSL;
