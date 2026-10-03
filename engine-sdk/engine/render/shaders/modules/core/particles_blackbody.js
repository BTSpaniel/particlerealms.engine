// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * particles_blackbody.js - Blackbody Radiation Color Shader (GAP 39)
 * 
 * Converts particle temperature → physically-based color + emission.
 * Uses CIE 1931 approximation of Planck's law for blackbody radiation.
 * Stefan-Boltzmann T⁴ scaling for emissive intensity.
 * 
 * Generates a 1D LUT texture (256 texels, 300K-30000K → sRGB).
 * Fragment shader samples LUT based on thermalData.x temperature.
 */

// ============================================================================
// BLACKBODY LUT GENERATION (CPU-side, baked once)
// ============================================================================

/**
 * CIE 1931 color matching approximation for blackbody radiation.
 * Based on Tanner Helland's algorithm + CIE refinements.
 * @param {number} tempK - Temperature in Kelvin (300-30000)
 * @returns {[number, number, number]} sRGB [0-1]
 */
function blackbodyToRGB(tempK) {
  const temp = Math.max(1000, Math.min(40000, tempK)) / 100;
  let r, g, b;

  // Red
  if (temp <= 66) {
    r = 255;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
  }

  // Green
  if (temp <= 66) {
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
  } else {
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
  }

  // Blue
  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  }

  return [
    Math.max(0, Math.min(1, r / 255)),
    Math.max(0, Math.min(1, g / 255)),
    Math.max(0, Math.min(1, b / 255)),
  ];
}

/**
 * Generate blackbody LUT as Float32Array (256 × RGBA).
 * Maps temperature range [minT, maxT] linearly across 256 texels.
 * Alpha channel = relative emissive intensity (Stefan-Boltzmann T⁴ scaling).
 * @returns {{ data: Float32Array, minTemp: number, maxTemp: number }}
 */
export function generateBlackbodyLUT(minTemp = 300, maxTemp = 30000) {
  const SIZE = 256;
  const data = new Float32Array(SIZE * 4);
  const refT = 5778; // Sun surface temperature for normalization

  for (let i = 0; i < SIZE; i++) {
    const t = i / (SIZE - 1);
    const tempK = minTemp + t * (maxTemp - minTemp);
    const [r, g, b] = blackbodyToRGB(tempK);

    // Stefan-Boltzmann: emissive power ∝ T⁴
    const intensity = Math.pow(tempK / refT, 4);

    const base = i * 4;
    data[base + 0] = r;
    data[base + 1] = g;
    data[base + 2] = b;
    data[base + 3] = Math.min(intensity, 100.0); // cap for HDR
  }

  return { data, minTemp, maxTemp, size: SIZE };
}

// ============================================================================
// WGSL FRAGMENT SNIPPET — for inclusion in particle fragment shaders
// ============================================================================

export const blackbodyWGSL = /* wgsl */`
// Blackbody radiation sampling
// Bind: blackbodyLUT as texture_1d<f32> + blackbodySampler
// Uniforms: blackbodyMinTemp, blackbodyMaxTemp

fn sampleBlackbody(
  lut: texture_1d<f32>,
  samp: sampler,
  temperature: f32,
  minTemp: f32,
  maxTemp: f32,
) -> vec4<f32> {
  let t = clamp((temperature - minTemp) / (maxTemp - minTemp), 0.0, 1.0);
  return textureSampleLevel(lut, samp, t, 0.0);
}

// Planck spectral-radiance ratio at a fixed wavelength. Unlike total T^4
// power, visible-band emission falls rapidly as hot gas cools. Arguments are
// positive Kelvin/metres; the reference normalizes out the wavelength factor.
fn blackbodySpectralRatio(temperature: f32, reference: f32, wavelength: f32) -> f32 {
  let radiationConstant = 0.01438776877;
  let referenceExponent = radiationConstant / (wavelength * reference);
  let exponent = radiationConstant / (wavelength * temperature);
  return (exp(referenceExponent) - 1.0) / (exp(exponent) - 1.0);
}

// Apply blackbody emission to a base color.
// Returns color with emission added (for HDR pipeline).
fn applyBlackbodyEmission(
  baseColor: vec3<f32>,
  bbColor: vec4<f32>,   // rgb = color, a = intensity
  emissionStrength: f32, // global multiplier
) -> vec3<f32> {
  // Below ~800K: no visible glow, just warm tint
  // 800K+: increasingly bright emission
  let intensity = bbColor.a * emissionStrength;
  return baseColor + bbColor.rgb * intensity;
}
`;

export default blackbodyWGSL;
