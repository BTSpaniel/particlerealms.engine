// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AtmosphereUtils.js - Shared Utilities for Atmospheric Rendering
 * 
 * Contains:
 * - Adaptive step sizing for ray marching
 * - Dithering utilities
 * - Mie asymmetry parameter functions
 * - Sun halo calculations
 */

// WGSL shared utilities for atmosphere shaders
export const ATMOSPHERE_UTILS_WGSL = /* wgsl */ `
// ============================================
// ADAPTIVE STEP SIZING
// ============================================

// Adaptive step size based on local density
// Large steps in clear areas, small steps in dense areas
fn adaptiveStepSize(baseDensity: f32, minStep: f32, maxStep: f32) -> f32 {
    // Exponential falloff: high density -> small steps
    let densityFactor = exp(-baseDensity * 10.0);
    return mix(minStep, maxStep, densityFactor);
}

// Exponential step distribution for froxels (more detail near camera)
fn exponentialSliceDepth(slice: f32, numSlices: f32, near: f32, far: f32) -> f32 {
    let t = slice / numSlices;
    return near * pow(far / near, t);
}

// Logarithmic slice for better distribution
fn logarithmicSliceDepth(slice: f32, numSlices: f32, near: f32, far: f32) -> f32 {
    let t = slice / numSlices;
    let logNear = log(near);
    let logFar = log(far);
    return exp(mix(logNear, logFar, t));
}

// ============================================
// MIE PHASE FUNCTIONS WITH TUNABLE ASYMMETRY
// ============================================

// Henyey-Greenstein phase function (fast, less accurate)
fn henyeyGreensteinPhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let denom = 1.0 + g2 - 2.0 * g * cosTheta;
    return (1.0 - g2) / (4.0 * 3.14159265 * pow(denom, 1.5));
}

// Cornette-Shanks phase function (physically correct for Mie)
// g = 0.76 for haze, g = 0.85 for thin clouds, g = 0.99 for fog
fn cornetteShanksMiePhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let mu2 = cosTheta * cosTheta;
    return (3.0 / (8.0 * 3.14159265)) * ((1.0 - g2) * (1.0 + mu2)) / 
           ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

// Schlick phase approximation (fast alternative)
fn schlickPhase(cosTheta: f32, g: f32) -> f32 {
    let k = 1.55 * g - 0.55 * g * g * g;
    let denom = 1.0 + k * cosTheta;
    return (1.0 - k * k) / (4.0 * 3.14159265 * denom * denom);
}

// Double Henyey-Greenstein (forward + back scattering)
fn doubleHGPhase(cosTheta: f32, gForward: f32, gBack: f32, blend: f32) -> f32 {
    let forward = henyeyGreensteinPhase(cosTheta, gForward);
    let back = henyeyGreensteinPhase(cosTheta, -gBack);
    return mix(forward, back, blend);
}

// ============================================
// SUN HALO / GLORY EFFECTS
// ============================================

// Enhanced phase function with sun halo
fn miePhaseWithHalo(cosTheta: f32, g: f32, haloStrength: f32) -> f32 {
    let basePhase = cornetteShanksMiePhase(cosTheta, g);
    
    // Add glory/halo ring at specific angles (backscatter around 138°)
    let gloryAngle = -0.74;  // cos(138°)
    let gloryWidth = 0.1;
    let glory = exp(-pow((cosTheta - gloryAngle) / gloryWidth, 2.0));
    
    // Add corona ring near sun (forward scatter at 22° and 46° for ice crystals)
    let corona22 = exp(-pow((cosTheta - 0.927) / 0.05, 2.0));  // 22° halo
    let corona46 = exp(-pow((cosTheta - 0.719) / 0.05, 2.0));  // 46° halo
    
    return basePhase + haloStrength * (glory * 0.3 + corona22 * 0.5 + corona46 * 0.2);
}

// ============================================
// DITHERING UTILITIES
// ============================================

// Ordered dithering pattern (Bayer 4x4)
fn bayerDither4x4(pos: vec2<u32>) -> f32 {
    let bayer: array<f32, 16> = array<f32, 16>(
        0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
        12.0/16.0, 4.0/16.0, 14.0/16.0,  6.0/16.0,
        3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
        15.0/16.0, 7.0/16.0, 13.0/16.0,  5.0/16.0
    );
    let idx = (pos.y % 4u) * 4u + (pos.x % 4u);
    return bayer[idx];
}

// Apply dithering before quantization to 8-bit
fn ditherTo8Bit(color: vec3<f32>, screenPos: vec2<u32>) -> vec3<f32> {
    let dither = bayerDither4x4(screenPos) - 0.5;
    return color + vec3<f32>(dither / 255.0);
}

// Blue noise dithering (requires texture)
fn blueNoiseDither(color: vec3<f32>, noise: vec3<f32>) -> vec3<f32> {
    let dither = (noise - 0.5) / 255.0;
    return color + dither;
}

// ============================================
// EARLY TERMINATION
// ============================================

// Check if transmittance is below threshold (can skip remaining samples)
fn shouldTerminateRay(transmittance: vec3<f32>, threshold: f32) -> bool {
    return max(max(transmittance.r, transmittance.g), transmittance.b) < threshold;
}

// Check accumulated alpha for front-to-back compositing
fn shouldTerminateAlpha(alpha: f32, threshold: f32) -> bool {
    return alpha > threshold;
}

// ============================================
// COLOR SPACE CONVERSIONS
// ============================================

// Linear to sRGB
fn linearToSRGB(color: vec3<f32>) -> vec3<f32> {
    let cutoff = vec3<f32>(0.0031308);
    let higher = 1.055 * pow(color, vec3<f32>(1.0/2.4)) - 0.055;
    let lower = color * 12.92;
    return select(higher, lower, color <= cutoff);
}

// sRGB to Linear
fn sRGBToLinear(color: vec3<f32>) -> vec3<f32> {
    let cutoff = vec3<f32>(0.04045);
    let higher = pow((color + 0.055) / 1.055, vec3<f32>(2.4));
    let lower = color / 12.92;
    return select(higher, lower, color <= cutoff);
}

// ACES tone mapping
fn acesToneMap(color: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return saturate((color * (a * color + b)) / (color * (c * color + d) + e));
}
`;

// Mie asymmetry parameter presets
export const MIE_ASYMMETRY = {
    CLEAR_SKY: 0.76,      // Clear atmosphere
    HAZY: 0.80,           // Light haze
    DUSTY: 0.85,          // Dusty/smoky
    FOGGY: 0.90,          // Fog/mist
    DENSE_FOG: 0.95,      // Very dense fog
    WATER_DROPLETS: 0.85, // Rain/clouds
    ICE_CRYSTALS: 0.75,   // Ice halos visible
};

// Adaptive step sizing configuration
export const ADAPTIVE_STEPS = {
    MIN_STEP: 0.001,   // Minimum step size (dense regions)
    MAX_STEP: 0.1,     // Maximum step size (clear regions)
    DENSITY_SCALE: 10, // How quickly to reduce steps with density
};

/**
 * Calculate recommended Mie asymmetry based on visibility
 * @param {number} visibility - Visibility in meters
 * @returns {number} Mie asymmetry parameter g (0.76-0.99)
 */
export function getMieAsymmetryFromVisibility(visibility) {
    // Higher visibility = lower g (less forward scattering)
    // Lower visibility = higher g (more forward scattering)
    const normalizedVis = Math.min(1, visibility / 50000); // Normalize to 50km max
    return 0.99 - normalizedVis * 0.23; // Range: 0.76 to 0.99
}

/**
 * Get step size recommendation based on optical depth
 * @param {number} opticalDepth - Local optical depth
 * @returns {number} Recommended step multiplier (0.1 to 1.0)
 */
export function getAdaptiveStepMultiplier(opticalDepth) {
    return Math.exp(-opticalDepth * ADAPTIVE_STEPS.DENSITY_SCALE);
}

export default {
    ATMOSPHERE_UTILS_WGSL,
    MIE_ASYMMETRY,
    ADAPTIVE_STEPS,
    getMieAsymmetryFromVisibility,
    getAdaptiveStepMultiplier,
};
