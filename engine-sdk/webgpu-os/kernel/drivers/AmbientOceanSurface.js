// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { pbrMaterialsWGSL } from '../../../engine/render/shaders/modules/chunks/pbr_materials.js';
import { noise2dWGSL } from '../../../engine/render/shaders/modules/chunks/noise2d.js';
import { extractAmbientWgslFunctions } from '../schema/AmbientNativeAppearance.js';

// Keep the engine's BRDF implementation authoritative without bringing its
// resource declarations and unrelated material sampling into authored programs.
const opticalNames = new Map([
    ['fresnelSchlickF0', 'ambientOceanSchlick'],
    ['distributionGGX', 'ambientOceanDistribution'],
    ['geometrySchlickGGX', 'ambientOceanMasking'],
    ['geometrySmith', 'ambientOceanVisibility'],
]);
const opticalFunctions = extractAmbientWgslFunctions(pbrMaterialsWGSL);
const oceanOptics = [...opticalNames].map(([name]) => {
    const source = opticalFunctions.find(fn => fn.name === name)?.source;
    if (!source) throw new Error(`Ocean material requires engine PBR function '${name}'.`);
    return source.replace(/\b(?:fresnelSchlickF0|distributionGGX|geometrySchlickGGX|geometrySmith|PBR_PI)\b/g,
        symbol => opticalNames.get(symbol) ?? '3.141592653589793');
}).join('\n');

// Reuse the engine's value-noise kernel. Only these four resource-free functions
// enter saved foam nodes; unrelated fBM loops and texture bindings stay out.
const foamNoiseNames = new Map([
    ['noise2dFractScalar', 'ambientOceanFoamFract'],
    ['noise2dFractVec', 'ambientOceanFoamFract2'],
    ['hash2d', 'ambientOceanFoamHash'],
    ['noise2d', 'ambientOceanFoamNoise'],
]);
const noiseFunctions = extractAmbientWgslFunctions(noise2dWGSL);
const oceanFoamNoise = [...foamNoiseNames].map(([name]) => {
    const source = noiseFunctions.find(fn => fn.name === name)?.source;
    if (!source) throw new Error(`Ocean whitewater requires engine noise function '${name}'.`);
    return source.replace(/\b(?:noise2dFractScalar|noise2dFractVec|hash2d|noise2d)\b/g, symbol => foamNoiseNames.get(symbol))
        .replace(/vec2<f32>/g, 'vec2f');
}).join('\n');

/** Independent analytic open-water model, shared by authored wallpaper lanes.
 * Units are metres and seconds. This is a finite directional wave model, not an
 * FFT, shallow-water solver or simulation of shoreline transport. Both visible
 * displacement and normals come from the same filtered height function.
 */
export const AMBIENT_OCEAN_SURFACE_WGSL = /* wgsl */`
${oceanOptics}
// waves = dominant wavelength, height scale, direction (radians), spread.
// wind = short-wave strength, crest sharpness. Height zero is exactly flat.
// Returns height, dHeight/dX, dHeight/dZ, unresolved mean-square slope.
fn ambientOceanWave(index: f32, waves: vec4f, wind: vec2f) -> vec4f {
 let shortWave = max(index - 4.0, 0.0);
 let k = 6.28318530718 / clamp(waves.x, 2.0, 80.0) * select(pow(1.38, index), 5.7 * pow(1.57, shortWave), index >= 4.0);
 let amplitude = clamp(waves.y, 0.0, 2.0) * select(0.42 * pow(0.61, index), 0.048 * clamp(wind.x, 0.0, 2.0) * pow(0.61, shortWave), index >= 4.0);
 let angularSpread = select(mix(0.12, 1.38, clamp(waves.w, 0.0, 1.0)), mix(0.40, 2.60, clamp(waves.w, 0.0, 1.0)), index >= 4.0);
 let angle = waves.z + sin(index * 2.39996323 + 0.73) * angularSpread;
 return vec4f(k, amplitude, angle, clamp(wind.y, 0.0, 1.0) * 0.24);
}
fn ambientOceanWavePhase(point: vec2f, time: f32, index: f32, wave: vec4f) -> f32 {
 return dot(point, vec2f(cos(wave.z), sin(wave.z))) * wave.x - time * sqrt(9.81 * wave.x) + index * 2.79128785 + sin(index * 1.731) * 3.0;
}
fn ambientOceanHeightBound(footprint: f32, waves: vec4f, wind: vec2f) -> f32 {
 var bound = 0.0;
 for (var i = 0; i < 12; i += 1) {
  let wave = ambientOceanWave(f32(i), waves, wind);
  let resolved = 1.0 - smoothstep(0.55, 2.2, wave.x * max(footprint, 0.0));
  let harmonicResolved = 1.0 - smoothstep(0.55, 2.2, 2.0 * wave.x * max(footprint, 0.0));
  bound += wave.y * (resolved + wave.w * harmonicResolved);
 }
 return bound;
}
// Absolute directional derivative bound for conservative front-to-back traces.
// Direction is a ray expressed in the same horizontal coordinates as the waves.
fn ambientOceanRayBounds(direction: vec2f, footprint: f32, waves: vec4f, wind: vec2f) -> vec2f {
 var bound = vec2f(0.0);
 for (var i = 0; i < 12; i += 1) {
  let wave = ambientOceanWave(f32(i), waves, wind);
  let resolved = 1.0 - smoothstep(0.55, 2.2, wave.x * max(footprint, 0.0));
  let harmonicResolved = 1.0 - smoothstep(0.55, 2.2, 2.0 * wave.x * max(footprint, 0.0));
  let projection = abs(dot(vec2f(cos(wave.z), sin(wave.z)), direction));
  let directionalFrequency = wave.x * projection;
  bound += wave.y * vec2f(directionalFrequency * (resolved + 2.0 * wave.w * harmonicResolved), directionalFrequency * directionalFrequency * (resolved + 4.0 * wave.w * harmonicResolved));
 }
 return bound;
}
fn ambientOceanSample(point: vec2f, time: f32, footprint: f32, waves: vec4f, wind: vec2f) -> vec4f {
 var height = 0.0; var slope = vec2f(0.0); var variance = 0.0;
 for (var i = 0; i < 12; i += 1) {
  let octave = f32(i);
  let wave = ambientOceanWave(octave, waves, wind);
  let k = wave.x; let amplitude = wave.y; let sharpness = wave.w;
  let resolved = 1.0 - smoothstep(0.55, 2.2, k * max(footprint, 0.0));
  let harmonicResolved = 1.0 - smoothstep(0.55, 2.2, 2.0 * k * max(footprint, 0.0));
  // The removed waves still scatter light. Retaining their slope energy avoids
  // a mirror-flat horizon when subpixel geometry is filtered out.
  let slopeEnergy = 0.5 * amplitude * amplitude * k * k;
  variance += slopeEnergy * ((1.0 - resolved * resolved) + 4.0 * sharpness * sharpness * (1.0 - harmonicResolved * harmonicResolved));
  if (resolved <= 0.0 && harmonicResolved <= 0.0) { continue; }
  let direction = vec2f(cos(wave.z), sin(wave.z));
  let phase = ambientOceanWavePhase(point, time, octave, wave);
  height += amplitude * (sin(phase) * resolved - sharpness * cos(phase * 2.0) * harmonicResolved);
  slope += direction * amplitude * k * (cos(phase) * resolved + 2.0 * sharpness * sin(phase * 2.0) * harmonicResolved);
 }
 return vec4f(height, slope, variance);
}
// Both bounds keep the step in front of the next crossing. The second-order
// bound converges faster near a grazing root than the slope bound alone.
fn ambientOceanRayAdvance(residual: f32, derivative: f32, descent: f32, bounds: vec2f) -> f32 {
 let linear = max(residual, 0.0) / max(descent + bounds.x, 0.00001);
 var quadratic = linear;
 if (bounds.y > 0.000001) {
  let discriminant = sqrt(derivative * derivative + 2.0 * bounds.y * max(residual, 0.0));
  if (derivative < 0.0) { quadratic = 2.0 * max(residual, 0.0) / max(discriminant - derivative, 0.000001); }
  else { quadratic = (discriminant + derivative) / bounds.y; }
 }
 return max(0.0001, max(linear, quadratic) * 0.98);
}
fn ambientOceanFresnel(facing: f32) -> f32 {
 return ambientOceanSchlick(clamp(facing, 0.0, 1.0), 0.020373);
}
fn ambientOceanMoonSpecular(normal: vec3f, view: vec3f, light: vec3f, roughness: f32, variance: f32) -> f32 {
 let facing = max(dot(normal, view), 0.001);
 let lighting = max(dot(normal, light), 0.001);
 let halfLight = (view + light) / max(length(view + light), 0.00001);
 let filtered = clamp(pow(pow(clamp(roughness, 0.055, 0.8), 4.0) + max(variance, 0.0) * 0.40, 0.25), 0.055, 0.8);
 let distribution = ambientOceanDistribution(max(dot(normal, halfLight), 0.0), filtered);
 let visibility = ambientOceanVisibility(facing, lighting, filtered);
 let fresnel = ambientOceanFresnel(max(dot(view, halfLight), 0.0));
 return distribution * visibility * fresnel / max(4.0 * facing, 0.004) * smoothstep(0.0, 0.02, dot(normal, light));
}
`;

/** Analytic whitewater appearance reconstructed from five recent wave samples.
 * This bounded history is deterministic at any time and needs no retained GPU
 * state. It approximates crest deposition/decay, not SPH or foam transport.
 * Factory compositions persist every function below inside their foam node.
 */
export const AMBIENT_OCEAN_WHITEWATER_WGSL = /* wgsl */`
${oceanFoamNoise}
// A virtual horizontal compression tensor follows the same directional modes
// as the visible height field. It is a breaking proxy, not a fluid Jacobian.
fn ambientOceanBreaking(point: vec2f, time: f32, footprint: f32, waves: vec4f, wind: vec2f, threshold: f32) -> f32 {
 if (waves.y <= 0.0) { return 0.0; }
 var compression = vec3f(0.0); var height = 0.0; var heightBound = 0.0;
 for (var i = 0; i < 12; i += 1) {
  let wave = ambientOceanWave(f32(i), waves, wind);
  let resolved = 1.0 - smoothstep(0.55, 2.2, wave.x * max(footprint, 0.0));
  let harmonicResolved = 1.0 - smoothstep(0.55, 2.2, 2.0 * wave.x * max(footprint, 0.0));
  if (resolved <= 0.0 && harmonicResolved <= 0.0) { continue; }
  let direction = vec2f(cos(wave.z), sin(wave.z));
  let phase = ambientOceanWavePhase(point, time, f32(i), wave);
  let crest = sin(phase) * resolved - wave.w * cos(phase * 2.0) * harmonicResolved;
  let convergence = wave.y * wave.x * (sin(phase) * resolved - 2.0 * wave.w * cos(phase * 2.0) * harmonicResolved);
  compression += vec3f(direction.x * direction.x, direction.y * direction.y, direction.x * direction.y) * convergence;
  height += wave.y * crest; heightBound += wave.y * (resolved + wave.w * harmonicResolved);
 }
 let jacobian = (1.0 - compression.x) * (1.0 - compression.y) - compression.z * compression.z;
 let crestGate = smoothstep(0.015, 0.24, height / max(heightBound, 0.00001));
 let onset = clamp(threshold, 0.0, 0.95);
 return smoothstep(onset, onset + 0.18, max(0.0, 1.0 - jacobian)) * crestGate;
}
fn ambientOceanFoamPatch(point: vec2f, footprint: f32, patchScale: f32) -> f32 {
 let scale = clamp(patchScale, 0.1, 12.0);
 let fineResolved = 1.0 - smoothstep(0.4, 1.8, max(footprint, 0.0) * scale);
 let broadResolved = 1.0 - smoothstep(0.4, 1.8, max(footprint, 0.0) * scale * 0.29);
 let broad = mix(0.5, ambientOceanFoamNoise(point * scale * 0.29 + vec2f(8.7, 3.2)), broadResolved);
 let fine = mix(0.5, ambientOceanFoamNoise(point * scale + vec2f(2.1, 7.9)), fineResolved);
 let coverageNoise = broad * 0.72 + fine * 0.28;
 let edge = mix(0.045, 0.20, 1.0 - fineResolved);
 return smoothstep(0.48 - edge, 0.48 + edge, coverageNoise);
}
// foam = coverage strength, breaking threshold, lifetime seconds, patch cells/m.
// Five finite history taps advect deposits along the authored wind direction.
fn ambientOceanWhitewater(point: vec2f, time: f32, footprint: f32, waves: vec4f, wind: vec2f, foam: vec4f, driftSpeed: f32) -> f32 {
 if (foam.x <= 0.0 || waves.y <= 0.0) { return 0.0; }
 let lifetime = clamp(foam.z, 0.1, 12.0);
 let drift = vec2f(cos(waves.z), sin(waves.z)) * clamp(driftSpeed, -2.0, 2.0);
 let coverageNoise = ambientOceanFoamPatch(point - drift * time, footprint, foam.w);
 if (coverageNoise <= 0.0) { return 0.0; }
 var coverage = 0.0;
 for (var i = 0; i < 5; i += 1) {
  let age = lifetime * f32(i) * 0.25;
  let breaking = ambientOceanBreaking(point - drift * age, time - age, footprint, waves, wind, foam.y);
  let deposit = breaking * exp(-age * 2.5 / lifetime) * coverageNoise;
  coverage = 1.0 - (1.0 - coverage) * (1.0 - deposit);
 }
 return clamp(coverage * clamp(foam.x, 0.0, 1.0), 0.0, 1.0);
}
`;
