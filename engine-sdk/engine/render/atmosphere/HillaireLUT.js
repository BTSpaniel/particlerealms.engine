// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HillaireLUT.js - Hillaire 2020 LUT-Based Atmospheric Scattering
 * Now powered by vGPU driver
 * 
 * Based on "A Scalable and Production Ready Sky and Atmosphere Rendering Technique"
 * by Sébastien Hillaire (Epic Games, 2020)
 * 
 * This implementation uses 4 LUTs for efficient atmospheric rendering:
 * 1. Transmittance LUT (256×64) - Extinction T(altitude, view angle)
 * 2. Multi-Scattering LUT (32×32) - Isotropic MS contribution
 * 3. Sky-View LUT (192×108) - Complete sky radiance (updated every frame)
 * 4. Aerial Perspective LUT (32×32×32) - Frustum-fitted inscatter + transmittance
 * 
 * Total VRAM: ~600KB for all LUTs
 * Performance: ~0.2ms for LUT generation, ~0.05ms for final composite
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _hillaireParamsData = new Float32Array(36);
const _hillaireCameraData = new Float32Array(4);
const _hillaireFrustumData = new Float32Array(16);

// Physical constants (Earth-like atmosphere)
const RAYLEIGH_SCALE_HEIGHT = 8000;  // 8km
const MIE_SCALE_HEIGHT = 1200;       // 1.2km
const OZONE_CENTER_ALTITUDE = 25000; // 25km peak
const OZONE_WIDTH = 15000;           // 15km width

// Scattering coefficients at sea level (per meter)
const RAYLEIGH_SCATTERING = [5.5e-6, 13.0e-6, 22.4e-6];  // RGB
const MIE_SCATTERING = [21e-6, 21e-6, 21e-6];            // Uniform
const MIE_ABSORPTION = [4.4e-6, 4.4e-6, 4.4e-6];         // Absorption
const OZONE_ABSORPTION = [0.65e-6, 1.88e-6, 0.085e-6];   // Critical for sunsets

// LUT dimensions
const TRANSMITTANCE_WIDTH = 256;
const TRANSMITTANCE_HEIGHT = 64;
const MULTISCATTER_SIZE = 32;
const SKYVIEW_WIDTH = 192;
const SKYVIEW_HEIGHT = 108;
const AERIAL_SIZE = 32;

// WGSL Compute shader for Transmittance LUT generation
export const TRANSMITTANCE_COMPUTE_WGSL = /* wgsl */ `
struct AtmosphereParams {
    // Planet geometry
    planetRadius: f32,          // Ground radius in meters
    atmosphereRadius: f32,      // Top of atmosphere radius
    
    // Rayleigh scattering
    rayleighScattering: vec3<f32>,
    rayleighScaleHeight: f32,
    
    // Mie scattering
    mieScattering: vec3<f32>,
    mieScaleHeight: f32,
    mieAbsorption: vec3<f32>,
    mieAnisotropy: f32,         // g parameter (0.76-0.99)
    
    // Ozone absorption
    ozoneAbsorption: vec3<f32>,
    ozoneCenterAltitude: f32,
    ozoneWidth: f32,
    
    // Sun
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    
    _pad: vec3<f32>,
}

@group(0) @binding(0) var<uniform> atm: AtmosphereParams;
@group(0) @binding(1) var transmittanceLUT: texture_storage_2d<rgba16float, write>;

const PI: f32 = 3.14159265359;
const TRANSMITTANCE_STEPS: u32 = 40u;

// Get altitude from radius
fn getAltitude(r: f32) -> f32 {
    return r - atm.planetRadius;
}

// Rayleigh density at altitude
fn rayleighDensity(altitude: f32) -> f32 {
    return exp(-altitude / atm.rayleighScaleHeight);
}

// Mie density at altitude  
fn mieDensity(altitude: f32) -> f32 {
    return exp(-altitude / atm.mieScaleHeight);
}

// Ozone density (bell curve centered at 25km)
fn ozoneDensity(altitude: f32) -> f32 {
    let x = (altitude - atm.ozoneCenterAltitude) / atm.ozoneWidth;
    return exp(-x * x);
}

// Ray-sphere intersection (returns distance to intersection, -1 if no hit)
fn raySphereIntersect(rayOrigin: vec3<f32>, rayDir: vec3<f32>, sphereRadius: f32) -> f32 {
    let b = dot(rayOrigin, rayDir);
    let c = dot(rayOrigin, rayOrigin) - sphereRadius * sphereRadius;
    let d = b * b - c;
    
    if (d < 0.0) {
        return -1.0;
    }
    
    let sqrtD = sqrt(d);
    let t1 = -b - sqrtD;
    let t2 = -b + sqrtD;
    
    // Return nearest positive intersection
    if (t1 > 0.0) { return t1; }
    if (t2 > 0.0) { return t2; }
    return -1.0;
}

// Get UV from altitude and cos(zenith angle)
fn getTransmittanceUV(altitude: f32, cosZenith: f32) -> vec2<f32> {
    let H = sqrt(max(0.0, atm.atmosphereRadius * atm.atmosphereRadius - atm.planetRadius * atm.planetRadius));
    let rho = sqrt(max(0.0, (atm.planetRadius + altitude) * (atm.planetRadius + altitude) - atm.planetRadius * atm.planetRadius));
    
    let d = max(0.0, (atm.atmosphereRadius - atm.planetRadius - altitude));
    let dMin = atm.atmosphereRadius - atm.planetRadius - altitude;
    let dMax = rho + H;
    
    let u = (cosZenith + 1.0) * 0.5;
    let v = altitude / (atm.atmosphereRadius - atm.planetRadius);
    
    return vec2<f32>(u, v);
}

// Compute optical depth along ray from position to atmosphere top
fn computeOpticalDepth(rayOrigin: vec3<f32>, rayDir: vec3<f32>, rayLength: f32) -> vec3<f32> {
    let stepSize = rayLength / f32(TRANSMITTANCE_STEPS);
    var opticalDepth = vec3<f32>(0.0);
    
    for (var i = 0u; i < TRANSMITTANCE_STEPS; i++) {
        let t = (f32(i) + 0.5) * stepSize;
        let pos = rayOrigin + rayDir * t;
        let altitude = length(pos) - atm.planetRadius;
        
        // Rayleigh contribution
        let rayleigh = rayleighDensity(altitude) * atm.rayleighScattering;
        
        // Mie contribution (scattering + absorption)
        let mie = mieDensity(altitude) * (atm.mieScattering + atm.mieAbsorption);
        
        // Ozone absorption
        let ozone = ozoneDensity(altitude) * atm.ozoneAbsorption;
        
        opticalDepth += (rayleigh + mie + ozone) * stepSize;
    }
    
    return opticalDepth;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = vec2<u32>(256u, 64u);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }
    
    // UV coordinates
    let uv = vec2<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5) / vec2<f32>(f32(dims.x), f32(dims.y));
    
    // Decode altitude and zenith angle from UV
    // u = cos(zenith) remapped, v = altitude normalized
    let altitude = uv.y * (atm.atmosphereRadius - atm.planetRadius);
    let cosZenith = uv.x * 2.0 - 1.0;
    
    // Ray origin at altitude
    let r = atm.planetRadius + altitude;
    let rayOrigin = vec3<f32>(0.0, r, 0.0);
    
    // Ray direction from zenith angle
    let sinZenith = sqrt(max(0.0, 1.0 - cosZenith * cosZenith));
    let rayDir = vec3<f32>(sinZenith, cosZenith, 0.0);
    
    // Find intersection with atmosphere top
    let tAtmosphere = raySphereIntersect(rayOrigin, rayDir, atm.atmosphereRadius);
    
    // Check for ground intersection
    let tGround = raySphereIntersect(rayOrigin, rayDir, atm.planetRadius);
    
    var rayLength = tAtmosphere;
    if (tGround > 0.0 && tGround < tAtmosphere) {
        rayLength = tGround;
    }
    
    if (rayLength <= 0.0) {
        textureStore(transmittanceLUT, vec2<i32>(id.xy), vec4<f32>(1.0, 1.0, 1.0, 1.0));
        return;
    }
    
    // Compute optical depth
    let opticalDepth = computeOpticalDepth(rayOrigin, rayDir, rayLength);
    
    // Transmittance = exp(-optical_depth)
    let transmittance = exp(-opticalDepth);
    
    textureStore(transmittanceLUT, vec2<i32>(id.xy), vec4<f32>(transmittance, 1.0));
}
`;

// WGSL Compute shader for Multi-Scattering LUT generation
// Based on Hillaire's dual-scattering approximation with 2 hemisphere samples
export const MULTISCATTER_COMPUTE_WGSL = /* wgsl */ `
struct AtmosphereParams {
    planetRadius: f32,
    atmosphereRadius: f32,
    _pad0: vec2<f32>,
    
    rayleighScattering: vec3<f32>,
    rayleighScaleHeight: f32,
    
    mieScattering: vec3<f32>,
    mieScaleHeight: f32,
    
    mieAbsorption: vec3<f32>,
    mieAnisotropy: f32,
    
    ozoneAbsorption: vec3<f32>,
    ozoneCenterAltitude: f32,
    ozoneWidth: f32,
    _pad1: vec3<f32>,
    
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    
    _pad2: vec3<f32>,
    _pad3: f32,
}

@group(0) @binding(0) var<uniform> atm: AtmosphereParams;
@group(0) @binding(1) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(2) var transmittanceSampler: sampler;
@group(0) @binding(3) var multiScatterLUT: texture_storage_2d<rgba16float, write>;

const PI: f32 = 3.14159265359;
const MULTISCATTER_STEPS: u32 = 20u;
const SPHERE_SAMPLES: u32 = 64u;  // Samples over sphere for isotropic integration

// Density functions
fn rayleighDensity(altitude: f32) -> f32 {
    return exp(-altitude / atm.rayleighScaleHeight);
}

fn mieDensity(altitude: f32) -> f32 {
    return exp(-altitude / atm.mieScaleHeight);
}

// Sample transmittance from LUT
fn sampleTransmittance(altitude: f32, cosZenith: f32) -> vec3<f32> {
    let u = (cosZenith + 1.0) * 0.5;
    let v = altitude / (atm.atmosphereRadius - atm.planetRadius);
    return textureSampleLevel(transmittanceLUT, transmittanceSampler, vec2<f32>(u, v), 0.0).rgb;
}

// Rayleigh phase (isotropic average = 1)
fn rayleighPhaseIsotropic() -> f32 {
    return 1.0;  // Integrated over sphere
}

// Mie phase isotropic contribution
fn miePhaseIsotropic() -> f32 {
    return 1.0;  // Integrated over sphere
}

// Uniform sphere sampling
fn sphereSample(i: u32, n: u32) -> vec3<f32> {
    let golden_ratio = 1.618033988749895;
    let theta = 2.0 * PI * f32(i) / golden_ratio;
    let phi = acos(1.0 - 2.0 * (f32(i) + 0.5) / f32(n));
    return vec3<f32>(
        sin(phi) * cos(theta),
        cos(phi),
        sin(phi) * sin(theta)
    );
}

// Ray-sphere intersection
fn raySphereIntersect(rayOrigin: vec3<f32>, rayDir: vec3<f32>, sphereRadius: f32) -> f32 {
    let b = dot(rayOrigin, rayDir);
    let c = dot(rayOrigin, rayOrigin) - sphereRadius * sphereRadius;
    let d = b * b - c;
    if (d < 0.0) { return -1.0; }
    let sqrtD = sqrt(d);
    let t1 = -b - sqrtD;
    let t2 = -b + sqrtD;
    if (t1 > 0.0) { return t1; }
    if (t2 > 0.0) { return t2; }
    return -1.0;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = vec2<u32>(32u, 32u);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }
    
    // UV: x = sun zenith cos, y = altitude normalized
    let uv = vec2<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5) / vec2<f32>(f32(dims.x), f32(dims.y));
    
    let altitude = uv.y * (atm.atmosphereRadius - atm.planetRadius);
    let cosSunZenith = uv.x * 2.0 - 1.0;
    
    // Position at altitude
    let r = atm.planetRadius + altitude;
    let pos = vec3<f32>(0.0, r, 0.0);
    
    // Sun direction from zenith angle
    let sinSunZenith = sqrt(max(0.0, 1.0 - cosSunZenith * cosSunZenith));
    let sunDir = vec3<f32>(sinSunZenith, cosSunZenith, 0.0);
    
    // Integrate multi-scattering over sphere of directions
    // This is Hillaire's isotropic approximation
    var totalLuminance = vec3<f32>(0.0);
    var totalFms = vec3<f32>(0.0);  // F_ms term
    
    for (var i = 0u; i < SPHERE_SAMPLES; i++) {
        let dir = sphereSample(i, SPHERE_SAMPLES);
        
        // Find ray length to atmosphere boundary
        let tAtm = raySphereIntersect(pos, dir, atm.atmosphereRadius);
        let tGround = raySphereIntersect(pos, dir, atm.planetRadius);
        
        var rayLen = tAtm;
        if (tGround > 0.0 && tGround < tAtm) {
            rayLen = tGround;
        }
        
        if (rayLen <= 0.0) { continue; }
        
        let stepSize = rayLen / f32(MULTISCATTER_STEPS);
        var inscatter = vec3<f32>(0.0);
        var transmittance = vec3<f32>(1.0);
        
        for (var j = 0u; j < MULTISCATTER_STEPS; j++) {
            let t = (f32(j) + 0.5) * stepSize;
            let samplePos = pos + dir * t;
            let sampleAlt = length(samplePos) - atm.planetRadius;
            
            // Local scattering
            let rayleigh = rayleighDensity(sampleAlt) * atm.rayleighScattering;
            let mie = mieDensity(sampleAlt) * atm.mieScattering;
            let scattering = rayleigh + mie;
            
            // Extinction (scattering + absorption)
            let mieAbs = mieDensity(sampleAlt) * atm.mieAbsorption;
            let extinction = scattering + mieAbs;
            
            // Transmittance to sun
            let cosSun = dot(normalize(samplePos), sunDir);
            let sunT = sampleTransmittance(sampleAlt, cosSun);
            
            // In-scatter contribution
            let sampleTransmittance = exp(-extinction * stepSize);
            let S = scattering * sunT;
            
            // Integrate
            let Sint = (S - S * sampleTransmittance) / max(extinction, vec3<f32>(1e-6));
            inscatter += transmittance * Sint;
            transmittance *= sampleTransmittance;
        }
        
        // Accumulate (weighted by solid angle)
        let weight = 4.0 * PI / f32(SPHERE_SAMPLES);
        totalLuminance += inscatter * weight;
        totalFms += transmittance * weight;  // Multiple scattering contribution
    }
    
    // The multi-scattering LUT stores Ψms = L / (1 - f_ms)
    // where f_ms is the fraction that scatters again
    let fms = totalFms / (4.0 * PI);
    let psi_ms = totalLuminance / max(vec3<f32>(1.0) - fms, vec3<f32>(1e-6));
    
    textureStore(multiScatterLUT, vec2<i32>(id.xy), vec4<f32>(psi_ms * atm.sunIntensity, 1.0));
}
`;

// WGSL Compute shader for Sky-View LUT generation
// Updated every frame - stores complete sky radiance in lat/long parameterization
export const SKYVIEW_COMPUTE_WGSL = /* wgsl */ `
struct AtmosphereParams {
    planetRadius: f32,
    atmosphereRadius: f32,
    _pad0: vec2<f32>,
    
    rayleighScattering: vec3<f32>,
    rayleighScaleHeight: f32,
    
    mieScattering: vec3<f32>,
    mieScaleHeight: f32,
    
    mieAbsorption: vec3<f32>,
    mieAnisotropy: f32,
    
    ozoneAbsorption: vec3<f32>,
    ozoneCenterAltitude: f32,
    ozoneWidth: f32,
    _pad1: vec3<f32>,
    
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    
    _pad2: vec3<f32>,
    _pad3: f32,
}

struct CameraParams {
    position: vec3<f32>,
    altitude: f32,
}

@group(0) @binding(0) var<uniform> atm: AtmosphereParams;
@group(0) @binding(1) var<uniform> camera: CameraParams;
@group(0) @binding(2) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(3) var multiScatterLUT: texture_2d<f32>;
@group(0) @binding(4) var lutSampler: sampler;
@group(0) @binding(5) var skyViewLUT: texture_storage_2d<rgba16float, write>;

const PI: f32 = 3.14159265359;
const SKYVIEW_STEPS: u32 = 32u;

// Density functions
fn rayleighDensity(altitude: f32) -> f32 {
    return exp(-altitude / atm.rayleighScaleHeight);
}

fn mieDensity(altitude: f32) -> f32 {
    return exp(-altitude / atm.mieScaleHeight);
}

fn ozoneDensity(altitude: f32) -> f32 {
    let x = (altitude - atm.ozoneCenterAltitude) / atm.ozoneWidth;
    return exp(-x * x);
}

// Sample transmittance from LUT
fn sampleTransmittance(altitude: f32, cosZenith: f32) -> vec3<f32> {
    let u = (cosZenith + 1.0) * 0.5;
    let v = altitude / (atm.atmosphereRadius - atm.planetRadius);
    return textureSampleLevel(transmittanceLUT, lutSampler, vec2<f32>(u, v), 0.0).rgb;
}

// Sample multi-scattering from LUT
fn sampleMultiScatter(altitude: f32, cosSunZenith: f32) -> vec3<f32> {
    let u = (cosSunZenith + 1.0) * 0.5;
    let v = altitude / (atm.atmosphereRadius - atm.planetRadius);
    return textureSampleLevel(multiScatterLUT, lutSampler, vec2<f32>(u, v), 0.0).rgb;
}

// Rayleigh phase function
fn rayleighPhase(cosTheta: f32) -> f32 {
    return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

// Cornette-Shanks phase function (better than Henyey-Greenstein for sun halos)
fn cornetteShanksMiePhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let mu2 = cosTheta * cosTheta;
    return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu2)) / 
           ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

// Ray-sphere intersection
fn raySphereIntersect(rayOrigin: vec3<f32>, rayDir: vec3<f32>, sphereRadius: f32) -> f32 {
    let b = dot(rayOrigin, rayDir);
    let c = dot(rayOrigin, rayOrigin) - sphereRadius * sphereRadius;
    let d = b * b - c;
    if (d < 0.0) { return -1.0; }
    let sqrtD = sqrt(d);
    let t1 = -b - sqrtD;
    let t2 = -b + sqrtD;
    if (t1 > 0.0) { return t1; }
    if (t2 > 0.0) { return t2; }
    return -1.0;
}

// Horizon-preserving UV parameterization (Hillaire 2020)
// Concentrates texels at horizon where gradients are sharpest
fn uvToViewDir(uv: vec2<f32>) -> vec3<f32> {
    // u = longitude (0-1 -> 0-2π)
    // v = latitude with horizon concentration
    let longitude = uv.x * 2.0 * PI;
    
    // Inverse of horizon-preserving mapping
    let vCentered = uv.y * 2.0 - 1.0;  // -1 to 1
    let sign_v = sign(vCentered);
    let latitude = sign_v * (vCentered * vCentered) * (PI * 0.5);
    
    let cosLat = cos(latitude);
    let sinLat = sin(latitude);
    let cosLon = cos(longitude);
    let sinLon = sin(longitude);
    
    return vec3<f32>(cosLat * sinLon, sinLat, cosLat * cosLon);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = vec2<u32>(192u, 108u);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }
    
    // UV with half-texel offset for center sampling
    let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(f32(dims.x), f32(dims.y));
    
    // Get view direction from UV
    let viewDir = uvToViewDir(uv);
    
    // Camera position (at altitude)
    let r = atm.planetRadius + camera.altitude;
    let rayOrigin = vec3<f32>(0.0, r, 0.0);
    
    // Find atmosphere intersection
    let tAtm = raySphereIntersect(rayOrigin, viewDir, atm.atmosphereRadius);
    let tGround = raySphereIntersect(rayOrigin, viewDir, atm.planetRadius);
    
    var rayLength = tAtm;
    var hitGround = false;
    if (tGround > 0.0 && tGround < tAtm) {
        rayLength = tGround;
        hitGround = true;
    }
    
    if (rayLength <= 0.0) {
        textureStore(skyViewLUT, vec2<i32>(id.xy), vec4<f32>(0.0, 0.0, 0.0, 1.0));
        return;
    }
    
    // Ray march through atmosphere
    let stepSize = rayLength / f32(SKYVIEW_STEPS);
    var luminance = vec3<f32>(0.0);
    var transmittance = vec3<f32>(1.0);
    
    let cosViewSun = dot(viewDir, atm.sunDirection);
    let phaseR = rayleighPhase(cosViewSun);
    let phaseM = cornetteShanksMiePhase(cosViewSun, atm.mieAnisotropy);
    
    for (var i = 0u; i < SKYVIEW_STEPS; i++) {
        let t = (f32(i) + 0.5) * stepSize;
        let pos = rayOrigin + viewDir * t;
        let altitude = length(pos) - atm.planetRadius;
        
        // Local scattering coefficients
        let rayleigh = rayleighDensity(altitude) * atm.rayleighScattering;
        let mie = mieDensity(altitude) * atm.mieScattering;
        let scattering = rayleigh + mie;
        
        // Extinction
        let mieAbs = mieDensity(altitude) * atm.mieAbsorption;
        let ozoneAbs = ozoneDensity(altitude) * atm.ozoneAbsorption;
        let extinction = scattering + mieAbs + ozoneAbs;
        
        // Transmittance to sun
        let cosSunZenith = dot(normalize(pos), atm.sunDirection);
        let sunTransmittance = sampleTransmittance(altitude, cosSunZenith);
        
        // Single scattering
        let singleScatter = (rayleigh * phaseR + mie * phaseM) * sunTransmittance * atm.sunIntensity;
        
        // Multi-scattering contribution
        let multiScatter = sampleMultiScatter(altitude, cosSunZenith) * scattering;
        
        // Total in-scattering
        let S = singleScatter + multiScatter;
        
        // Integrate
        let sampleT = exp(-extinction * stepSize);
        let Sint = (S - S * sampleT) / max(extinction, vec3<f32>(1e-6));
        luminance += transmittance * Sint;
        transmittance *= sampleT;
    }
    
    // Ground contribution (if hit)
    if (hitGround) {
        let groundAlbedo = vec3<f32>(0.3);  // Average Earth albedo
        let groundNormal = normalize(rayOrigin + viewDir * rayLength);
        let NdotL = max(0.0, dot(groundNormal, atm.sunDirection));
        let groundRadiance = groundAlbedo * NdotL * atm.sunIntensity * transmittance;
        luminance += groundRadiance * 0.1;  // Reduced to prevent over-bright ground
    }
    
    textureStore(skyViewLUT, vec2<i32>(id.xy), vec4<f32>(luminance, 1.0));
}
`;

// WGSL Compute shader for Aerial Perspective LUT generation
// 3D froxel volume (32×32×32) storing inscatter + transmittance
// Updated every frame for proper depth-based atmospheric effects on geometry
export const AERIAL_PERSPECTIVE_COMPUTE_WGSL = /* wgsl */ `
struct AtmosphereParams {
    planetRadius: f32,
    atmosphereRadius: f32,
    _pad0: vec2<f32>,
    
    rayleighScattering: vec3<f32>,
    rayleighScaleHeight: f32,
    
    mieScattering: vec3<f32>,
    mieScaleHeight: f32,
    
    mieAbsorption: vec3<f32>,
    mieAnisotropy: f32,
    
    ozoneAbsorption: vec3<f32>,
    ozoneCenterAltitude: f32,
    ozoneWidth: f32,
    _pad1: vec3<f32>,
    
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    
    _pad2: vec3<f32>,
    _pad3: f32,
}

struct FrustumParams {
    cameraPosition: vec3<f32>,
    nearPlane: f32,
    cameraForward: vec3<f32>,
    farPlane: f32,
    cameraRight: vec3<f32>,
    fovY: f32,
    cameraUp: vec3<f32>,
    aspectRatio: f32,
}

@group(0) @binding(0) var<uniform> atm: AtmosphereParams;
@group(0) @binding(1) var<uniform> frustum: FrustumParams;
@group(0) @binding(2) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(3) var multiScatterLUT: texture_2d<f32>;
@group(0) @binding(4) var lutSampler: sampler;
@group(0) @binding(5) var aerialPerspectiveLUT: texture_storage_3d<rgba16float, write>;

const PI: f32 = 3.14159265359;
const AP_STEPS: u32 = 16u;
const AP_SIZE: u32 = 32u;

// Density functions
fn rayleighDensity(altitude: f32) -> f32 {
    return exp(-altitude / atm.rayleighScaleHeight);
}

fn mieDensity(altitude: f32) -> f32 {
    return exp(-altitude / atm.mieScaleHeight);
}

fn ozoneDensity(altitude: f32) -> f32 {
    let x = (altitude - atm.ozoneCenterAltitude) / atm.ozoneWidth;
    return exp(-x * x);
}

// Sample transmittance from LUT
fn sampleTransmittance(altitude: f32, cosZenith: f32) -> vec3<f32> {
    let u = (cosZenith + 1.0) * 0.5;
    let v = altitude / (atm.atmosphereRadius - atm.planetRadius);
    return textureSampleLevel(transmittanceLUT, lutSampler, vec2<f32>(u, v), 0.0).rgb;
}

// Sample multi-scattering from LUT
fn sampleMultiScatter(altitude: f32, cosSunZenith: f32) -> vec3<f32> {
    let u = (cosSunZenith + 1.0) * 0.5;
    let v = altitude / (atm.atmosphereRadius - atm.planetRadius);
    return textureSampleLevel(multiScatterLUT, lutSampler, vec2<f32>(u, v), 0.0).rgb;
}

// Phase functions
fn rayleighPhase(cosTheta: f32) -> f32 {
    return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

fn cornetteShanksMiePhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let mu2 = cosTheta * cosTheta;
    return (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu2)) / 
           ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

// Ray-sphere intersection
fn raySphereIntersect(rayOrigin: vec3<f32>, rayDir: vec3<f32>, sphereRadius: f32) -> f32 {
    let b = dot(rayOrigin, rayDir);
    let c = dot(rayOrigin, rayOrigin) - sphereRadius * sphereRadius;
    let d = b * b - c;
    if (d < 0.0) { return -1.0; }
    let sqrtD = sqrt(d);
    let t1 = -b - sqrtD;
    let t2 = -b + sqrtD;
    if (t1 > 0.0) { return t1; }
    if (t2 > 0.0) { return t2; }
    return -1.0;
}

// Exponential slice distribution for froxels (more detail near camera)
fn sliceToDepth(slice: f32, near: f32, far: f32) -> f32 {
    // Exponential distribution: more slices near camera
    let t = slice / f32(AP_SIZE);
    return near * pow(far / near, t);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= AP_SIZE || id.y >= AP_SIZE || id.z >= AP_SIZE) {
        return;
    }
    
    // UV coordinates (x,y = screen position, z = depth slice)
    let uv = (vec2<f32>(id.xy) + 0.5) / f32(AP_SIZE);
    let sliceDepth = sliceToDepth(f32(id.z) + 0.5, frustum.nearPlane, frustum.farPlane);
    
    // Reconstruct view ray from frustum
    let tanHalfFovY = tan(frustum.fovY * 0.5);
    let tanHalfFovX = tanHalfFovY * frustum.aspectRatio;
    
    let ndcX = uv.x * 2.0 - 1.0;
    let ndcY = uv.y * 2.0 - 1.0;
    
    let viewDir = normalize(
        frustum.cameraForward + 
        frustum.cameraRight * ndcX * tanHalfFovX + 
        frustum.cameraUp * ndcY * tanHalfFovY
    );
    
    // Ray origin (camera position relative to planet center)
    let rayOrigin = frustum.cameraPosition;
    let rayEnd = rayOrigin + viewDir * sliceDepth;
    
    // Compute atmospheric contribution along this ray segment
    let stepSize = sliceDepth / f32(AP_STEPS);
    var inscatter = vec3<f32>(0.0);
    var transmittance = vec3<f32>(1.0);
    
    let cosViewSun = dot(viewDir, atm.sunDirection);
    let phaseR = rayleighPhase(cosViewSun);
    let phaseM = cornetteShanksMiePhase(cosViewSun, atm.mieAnisotropy);
    
    for (var i = 0u; i < AP_STEPS; i++) {
        let t = (f32(i) + 0.5) * stepSize;
        let pos = rayOrigin + viewDir * t;
        let altitude = length(pos) - atm.planetRadius;
        
        // Skip if outside atmosphere
        if (altitude < 0.0 || altitude > atm.atmosphereRadius - atm.planetRadius) {
            continue;
        }
        
        // Local scattering coefficients
        let rayleigh = rayleighDensity(altitude) * atm.rayleighScattering;
        let mie = mieDensity(altitude) * atm.mieScattering;
        let scattering = rayleigh + mie;
        
        // Extinction
        let mieAbs = mieDensity(altitude) * atm.mieAbsorption;
        let ozoneAbs = ozoneDensity(altitude) * atm.ozoneAbsorption;
        let extinction = scattering + mieAbs + ozoneAbs;
        
        // Transmittance to sun
        let cosSunZenith = dot(normalize(pos), atm.sunDirection);
        let sunTransmittance = sampleTransmittance(altitude, cosSunZenith);
        
        // Single scattering
        let singleScatter = (rayleigh * phaseR + mie * phaseM) * sunTransmittance * atm.sunIntensity;
        
        // Multi-scattering contribution
        let multiScatter = sampleMultiScatter(altitude, cosSunZenith) * scattering;
        
        // Total in-scattering
        let S = singleScatter + multiScatter;
        
        // Integrate
        let sampleT = exp(-extinction * stepSize);
        let Sint = (S - S * sampleT) / max(extinction, vec3<f32>(1e-6));
        inscatter += transmittance * Sint;
        transmittance *= sampleT;
    }
    
    // Store inscatter (RGB) and transmittance (A = average of RGB transmittance)
    let avgTransmittance = (transmittance.r + transmittance.g + transmittance.b) / 3.0;
    textureStore(aerialPerspectiveLUT, vec3<i32>(id), vec4<f32>(inscatter, avgTransmittance));
}
`;

/**
 * HillaireLUT - Main class for Hillaire-style atmospheric LUT system
 */
export class HillaireLUT {
    constructor() {
        this.initialized = false;
        this.vgpu = null;
        this.device = null;
        
        // Planet parameters (default: 424km radius planet)
        this.planetRadius = 424000;      // meters
        this.atmosphereRadius = 424000 + 100000;  // +100km atmosphere
        
        // Scattering coefficients
        this.rayleighScattering = [...RAYLEIGH_SCATTERING];
        this.rayleighScaleHeight = RAYLEIGH_SCALE_HEIGHT;
        
        this.mieScattering = [...MIE_SCATTERING];
        this.mieAbsorption = [...MIE_ABSORPTION];
        this.mieScaleHeight = MIE_SCALE_HEIGHT;
        this.mieAnisotropy = 0.8;  // Forward scattering
        
        this.ozoneAbsorption = [...OZONE_ABSORPTION];
        this.ozoneCenterAltitude = OZONE_CENTER_ALTITUDE;
        this.ozoneWidth = OZONE_WIDTH;
        
        // Sun
        this.sunDirection = [0, 1, 0];
        this.sunIntensity = 20.0;
        
        // GPU resources - Transmittance
        this.paramsBuffer = null;
        this.transmittanceLUT = null;
        this.transmittancePipeline = null;
        this.transmittanceBindGroup = null;
        
        // GPU resources - Multi-Scattering
        this.multiScatterLUT = null;
        this.multiScatterPipeline = null;
        this.multiScatterBindGroup = null;
        this.linearSampler = null;
        
        // GPU resources - Sky-View
        this.skyViewLUT = null;
        this.skyViewPipeline = null;
        this.skyViewBindGroup = null;
        this.cameraBuffer = null;
        this.cameraAltitude = 1.7;  // Default camera altitude in meters
        
        // GPU resources - Aerial Perspective
        this.aerialPerspectiveLUT = null;
        this.aerialPerspectivePipeline = null;
        this.aerialPerspectiveBindGroup = null;
        this.frustumBuffer = null;
        
        // Frustum params for aerial perspective
        this.frustumParams = {
            nearPlane: 0.1,
            farPlane: 10000,
            fovY: Math.PI / 3,  // 60 degrees
            aspectRatio: 16 / 9,
            cameraForward: [0, 0, -1],
            cameraRight: [1, 0, 0],
            cameraUp: [0, 1, 0],
        };
        
        // Dirty flags for LUT regeneration
        this.transmittanceDirty = true;
        this.multiScatterDirty = true;
        this.skyViewDirty = true;  // Updated every frame
        this.aerialPerspectiveDirty = true;  // Updated every frame
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create buffers using vGPU
        this.paramsBuffer = this.vgpu.buffer.create({ size: 144, usage: 'uniform', label: 'HillaireAtmosphereParams' }).buffer;
        this.cameraBuffer = this.vgpu.buffer.create({ size: 16, usage: 'uniform', label: 'CameraParams' }).buffer;
        this.frustumBuffer = this.vgpu.buffer.create({ size: 64, usage: 'uniform', label: 'FrustumParams' }).buffer;
        
        // Create LUT textures using vGPU
        this.transmittanceLUT = this.vgpu.texture.create({
            width: TRANSMITTANCE_WIDTH, height: TRANSMITTANCE_HEIGHT,
            format: 'rgba16float', usage: 'storage|texture', label: 'TransmittanceLUT'
        }).texture;
        
        this.multiScatterLUT = this.vgpu.texture.create({
            width: MULTISCATTER_SIZE, height: MULTISCATTER_SIZE,
            format: 'rgba16float', usage: 'storage|texture', label: 'MultiScatterLUT'
        }).texture;
        
        this.skyViewLUT = this.vgpu.texture.create({
            width: SKYVIEW_WIDTH, height: SKYVIEW_HEIGHT,
            format: 'rgba16float', usage: 'storage|texture', label: 'SkyViewLUT'
        }).texture;
        
        this.aerialPerspectiveLUT = this.vgpu.texture.create({
            width: AERIAL_SIZE, height: AERIAL_SIZE, depth: AERIAL_SIZE,
            dimension: '3d', format: 'rgba16float', usage: 'storage|texture', label: 'AerialPerspectiveLUT'
        }).texture;
        
        // Create sampler using vGPU
        this.linearSampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp-to-edge' });
        
        // Compile shaders using vGPU
        const transmittanceModule = this.vgpu.shader.compile('transmittance', TRANSMITTANCE_COMPUTE_WGSL);
        const multiScatterModule = this.vgpu.shader.compile('multiScatter', MULTISCATTER_COMPUTE_WGSL);
        const skyViewModule = this.vgpu.shader.compile('skyView', SKYVIEW_COMPUTE_WGSL);
        const aerialPerspectiveModule = this.vgpu.shader.compile('aerialPerspective', AERIAL_PERSPECTIVE_COMPUTE_WGSL);
        
        // Define explicit bind group layouts
        const transmittanceLayout = this.vgpu.bindings.defineLayout('transmittance', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'storage-texture', visibility: 'compute', format: 'rgba16float' },
        ]);
        const multiScatterLayout = this.vgpu.bindings.defineLayout('multiScatter', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'texture', visibility: 'compute', sampleType: 'float' },
            { binding: 2, type: 'sampler', visibility: 'compute' },
            { binding: 3, type: 'storage-texture', visibility: 'compute', format: 'rgba16float' },
        ]);
        const skyViewLayout = this.vgpu.bindings.defineLayout('skyView', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'uniform', visibility: 'compute' },
            { binding: 2, type: 'texture', visibility: 'compute', sampleType: 'float' },
            { binding: 3, type: 'texture', visibility: 'compute', sampleType: 'float' },
            { binding: 4, type: 'sampler', visibility: 'compute' },
            { binding: 5, type: 'storage-texture', visibility: 'compute', format: 'rgba16float' },
        ]);
        const aerialPerspectiveLayout = this.vgpu.bindings.defineLayout('aerialPerspective', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'uniform', visibility: 'compute' },
            { binding: 2, type: 'texture', visibility: 'compute', sampleType: 'float' },
            { binding: 3, type: 'texture', visibility: 'compute', sampleType: 'float' },
            { binding: 4, type: 'sampler', visibility: 'compute' },
            { binding: 5, type: 'storage-texture', visibility: 'compute', format: 'rgba16float', dimension: '3d' },
        ]);
        
        // Create compute pipelines with explicit layouts
        this.transmittancePipeline = this.vgpu.pipeline.compute({
            module: transmittanceModule, entryPoint: 'main',
            layout: transmittanceLayout, label: 'TransmittancePipeline'
        });
        this.multiScatterPipeline = this.vgpu.pipeline.compute({
            module: multiScatterModule, entryPoint: 'main',
            layout: multiScatterLayout, label: 'MultiScatterPipeline'
        });
        this.skyViewPipeline = this.vgpu.pipeline.compute({
            module: skyViewModule, entryPoint: 'main',
            layout: skyViewLayout, label: 'SkyViewPipeline'
        });
        this.aerialPerspectivePipeline = this.vgpu.pipeline.compute({
            module: aerialPerspectiveModule, entryPoint: 'main',
            layout: aerialPerspectiveLayout, label: 'AerialPerspectivePipeline'
        });
        
        // Create bind groups with explicit layouts
        this.transmittanceBindGroup = this.vgpu.bindings.createGroup(transmittanceLayout, [
            { binding: 0, buffer: this.paramsBuffer },
            { binding: 1, textureView: this.transmittanceLUT.createView() },
        ]);
        this.multiScatterBindGroup = this.vgpu.bindings.createGroup(multiScatterLayout, [
            { binding: 0, buffer: this.paramsBuffer },
            { binding: 1, textureView: this.transmittanceLUT.createView() },
            { binding: 2, sampler: this.linearSampler },
            { binding: 3, textureView: this.multiScatterLUT.createView() },
        ]);
        this.skyViewBindGroup = this.vgpu.bindings.createGroup(skyViewLayout, [
            { binding: 0, buffer: this.paramsBuffer },
            { binding: 1, buffer: this.cameraBuffer },
            { binding: 2, textureView: this.transmittanceLUT.createView() },
            { binding: 3, textureView: this.multiScatterLUT.createView() },
            { binding: 4, sampler: this.linearSampler },
            { binding: 5, textureView: this.skyViewLUT.createView() },
        ]);
        this.aerialPerspectiveBindGroup = this.vgpu.bindings.createGroup(aerialPerspectiveLayout, [
            { binding: 0, buffer: this.paramsBuffer },
            { binding: 1, buffer: this.frustumBuffer },
            { binding: 2, textureView: this.transmittanceLUT.createView() },
            { binding: 3, textureView: this.multiScatterLUT.createView() },
            { binding: 4, sampler: this.linearSampler },
            { binding: 5, textureView: this.aerialPerspectiveLUT.createView() },
        ]);
        
        // Upload initial parameters
        this.updateParams();
        this.updateCameraParams();
        this.updateFrustumParams();
        
        // Generate initial LUTs (transmittance → multi-scatter → sky-view → aerial perspective)
        await this.generateTransmittanceLUT();
        await this.generateMultiScatterLUT();
        await this.generateSkyViewLUT();
        await this.generateAerialPerspectiveLUT();
        
        this.initialized = true;
        console.log(`[HillaireLUT] Initialized:`);
        console.log(`  - Transmittance LUT: ${TRANSMITTANCE_WIDTH}×${TRANSMITTANCE_HEIGHT}`);
        console.log(`  - Multi-Scattering LUT: ${MULTISCATTER_SIZE}×${MULTISCATTER_SIZE}`);
        console.log(`  - Sky-View LUT: ${SKYVIEW_WIDTH}×${SKYVIEW_HEIGHT}`);
        console.log(`  - Aerial Perspective LUT: ${AERIAL_SIZE}×${AERIAL_SIZE}×${AERIAL_SIZE}`);
    }
    
    /**
     * Update atmosphere parameters buffer
     */
    updateParams() {
        if (!this.device || !this.paramsBuffer) return;
        
        const data = _hillaireParamsData;  // Reuse module-level buffer
        
        // Planet geometry
        data[0] = this.planetRadius;
        data[1] = this.atmosphereRadius;
        data[2] = 0;  // padding (_pad0.x)
        data[3] = 0;  // padding (_pad0.y)
        
        // Rayleigh
        data[4] = this.rayleighScattering[0];
        data[5] = this.rayleighScattering[1];
        data[6] = this.rayleighScattering[2];
        data[7] = this.rayleighScaleHeight;
        
        // Mie scattering
        data[8] = this.mieScattering[0];
        data[9] = this.mieScattering[1];
        data[10] = this.mieScattering[2];
        data[11] = this.mieScaleHeight;
        
        // Mie absorption
        data[12] = this.mieAbsorption[0];
        data[13] = this.mieAbsorption[1];
        data[14] = this.mieAbsorption[2];
        data[15] = this.mieAnisotropy;
        
        // Ozone
        data[16] = this.ozoneAbsorption[0];
        data[17] = this.ozoneAbsorption[1];
        data[18] = this.ozoneAbsorption[2];
        data[19] = this.ozoneCenterAltitude;
        data[20] = this.ozoneWidth;
        data[21] = 0;  // padding (_pad1.x)
        data[22] = 0;  // padding (_pad1.y)
        data[23] = 0;  // padding (_pad1.z)
        
        // Sun (at offset 24, aligned to 16 bytes = offset 96)
        data[24] = this.sunDirection[0];
        data[25] = this.sunDirection[1];
        data[26] = this.sunDirection[2];
        data[27] = this.sunIntensity;
        
        // Padding (_pad2 + _pad3 to reach 144 bytes)
        data[28] = 0;  // _pad2.x
        data[29] = 0;  // _pad2.y
        data[30] = 0;  // _pad2.z
        data[31] = 0;  // _pad3
        data[32] = 0;  // extra padding
        data[33] = 0;  // extra padding
        data[34] = 0;  // extra padding
        data[35] = 0;  // extra padding
        
        this.device.queue.writeBuffer(this.paramsBuffer, 0, data);
    }
    
    /**
     * Update camera parameters buffer
     */
    updateCameraParams() {
        if (!this.device || !this.cameraBuffer) return;
        
        const data = _hillaireCameraData;  // Reuse buffer
        data[0] = 0;  // Camera position X (relative to planet center, simplified)
        data[1] = this.planetRadius + this.cameraAltitude;  // Camera Y
        data[2] = 0;  // Camera position Z
        data[3] = this.cameraAltitude;
        
        this.device.queue.writeBuffer(this.cameraBuffer, 0, data);
    }
    
    /**
     * Update frustum parameters buffer for aerial perspective
     */
    updateFrustumParams() {
        if (!this.device || !this.frustumBuffer) return;
        
        const data = _hillaireFrustumData;  // Reuse buffer
        
        // Camera position (relative to planet center)
        data[0] = 0;
        data[1] = this.planetRadius + this.cameraAltitude;
        data[2] = 0;
        data[3] = this.frustumParams.nearPlane;
        
        // Camera forward
        data[4] = this.frustumParams.cameraForward[0];
        data[5] = this.frustumParams.cameraForward[1];
        data[6] = this.frustumParams.cameraForward[2];
        data[7] = this.frustumParams.farPlane;
        
        // Camera right
        data[8] = this.frustumParams.cameraRight[0];
        data[9] = this.frustumParams.cameraRight[1];
        data[10] = this.frustumParams.cameraRight[2];
        data[11] = this.frustumParams.fovY;
        
        // Camera up
        data[12] = this.frustumParams.cameraUp[0];
        data[13] = this.frustumParams.cameraUp[1];
        data[14] = this.frustumParams.cameraUp[2];
        data[15] = this.frustumParams.aspectRatio;
        
        this.device.queue.writeBuffer(this.frustumBuffer, 0, data);
    }
    
    /**
     * Generate Transmittance LUT (call when atmosphere params change)
     */
    async generateTransmittanceLUT() {
        if (!this.initialized && !this.device) return;
        
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        
        passEncoder.setPipeline(this.transmittancePipeline);
        passEncoder.setBindGroup(0, this.transmittanceBindGroup);
        passEncoder.dispatchWorkgroups(
            Math.ceil(TRANSMITTANCE_WIDTH / 8),
            Math.ceil(TRANSMITTANCE_HEIGHT / 8),
            1
        );
        passEncoder.end();
        
        this.device.queue.submit([commandEncoder.finish()]);
        this.transmittanceDirty = false;
    }
    
    /**
     * Generate Multi-Scattering LUT (call when atmosphere params change)
     * Must be called AFTER transmittance LUT is generated
     */
    async generateMultiScatterLUT() {
        if (!this.initialized && !this.device) return;
        
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        
        passEncoder.setPipeline(this.multiScatterPipeline);
        passEncoder.setBindGroup(0, this.multiScatterBindGroup);
        passEncoder.dispatchWorkgroups(
            Math.ceil(MULTISCATTER_SIZE / 8),
            Math.ceil(MULTISCATTER_SIZE / 8),
            1
        );
        passEncoder.end();
        
        this.device.queue.submit([commandEncoder.finish()]);
        this.multiScatterDirty = false;
    }
    
    /**
     * Generate Sky-View LUT (updated every frame)
     * Must be called AFTER transmittance and multi-scatter LUTs are generated
     */
    async generateSkyViewLUT() {
        if (!this.initialized && !this.device) return;
        
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        
        passEncoder.setPipeline(this.skyViewPipeline);
        passEncoder.setBindGroup(0, this.skyViewBindGroup);
        passEncoder.dispatchWorkgroups(
            Math.ceil(SKYVIEW_WIDTH / 8),
            Math.ceil(SKYVIEW_HEIGHT / 8),
            1
        );
        passEncoder.end();
        
        this.device.queue.submit([commandEncoder.finish()]);
        this.skyViewDirty = false;
    }
    
    /**
     * Generate Aerial Perspective LUT (updated every frame)
     * Must be called AFTER transmittance and multi-scatter LUTs are generated
     */
    async generateAerialPerspectiveLUT() {
        if (!this.initialized && !this.device) return;
        
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        
        passEncoder.setPipeline(this.aerialPerspectivePipeline);
        passEncoder.setBindGroup(0, this.aerialPerspectiveBindGroup);
        passEncoder.dispatchWorkgroups(
            Math.ceil(AERIAL_SIZE / 4),
            Math.ceil(AERIAL_SIZE / 4),
            Math.ceil(AERIAL_SIZE / 4)
        );
        passEncoder.end();
        
        this.device.queue.submit([commandEncoder.finish()]);
        this.aerialPerspectiveDirty = false;
    }
    
    /**
     * Set planet radius
     * @param {number} radiusKm - Radius in kilometers
     */
    setPlanetRadius(radiusKm) {
        this.planetRadius = radiusKm * 1000;
        this.atmosphereRadius = this.planetRadius + 100000;  // +100km
        this.updateParams();
        this.updateCameraParams();
        this.updateFrustumParams();
        this.transmittanceDirty = true;
        this.multiScatterDirty = true;
        this.skyViewDirty = true;
        this.aerialPerspectiveDirty = true;
    }
    
    /**
     * Set sun direction
     * @param {number[]} dir - Normalized [x, y, z]
     */
    setSunDirection(dir) {
        const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);
        this.sunDirection = [dir[0]/len, dir[1]/len, dir[2]/len];
        this.updateParams();
        this.skyViewDirty = true;  // Sky depends on sun direction
    }
    
    /**
     * Set camera altitude (for sky-view and aerial perspective LUTs)
     * @param {number} altitude - Altitude in meters above surface
     */
    setCameraAltitude(altitude) {
        this.cameraAltitude = altitude;
        this.updateCameraParams();
        this.updateFrustumParams();
        this.skyViewDirty = true;
        this.aerialPerspectiveDirty = true;
    }
    
    /**
     * Set frustum parameters for aerial perspective
     * @param {Object} params - {nearPlane, farPlane, fovY, aspectRatio, cameraForward, cameraRight, cameraUp}
     */
    setFrustum(params) {
        Object.assign(this.frustumParams, params);
        this.updateFrustumParams();
        this.aerialPerspectiveDirty = true;
    }
    
    /**
     * Update LUTs if needed (call once per frame)
     * Sky-View and Aerial Perspective are regenerated every frame
     */
    async update() {
        if (this.transmittanceDirty) {
            await this.generateTransmittanceLUT();
            this.multiScatterDirty = true;
        }
        if (this.multiScatterDirty) {
            await this.generateMultiScatterLUT();
            this.skyViewDirty = true;
            this.aerialPerspectiveDirty = true;
        }
        // Per-frame LUTs
        if (this.skyViewDirty || this.initialized) {
            await this.generateSkyViewLUT();
        }
        if (this.aerialPerspectiveDirty || this.initialized) {
            await this.generateAerialPerspectiveLUT();
        }
    }
    
    /**
     * Get transmittance LUT texture view
     */
    getTransmittanceView() {
        return this.transmittanceLUT?.createView();
    }
    
    /**
     * Get multi-scattering LUT texture view
     */
    getMultiScatterView() {
        return this.multiScatterLUT?.createView();
    }
    
    /**
     * Get sky-view LUT texture view
     */
    getSkyViewView() {
        return this.skyViewLUT?.createView();
    }
    
    /**
     * Get aerial perspective LUT texture view (3D)
     */
    getAerialPerspectiveView() {
        return this.aerialPerspectiveLUT?.createView();
    }
    
    /**
     * Get linear sampler for LUT sampling
     */
    getSampler() {
        return this.linearSampler;
    }
    
    /**
     * Get atmosphere params buffer
     */
    getParamsBuffer() {
        return this.paramsBuffer;
    }
    
    /**
     * Get camera params buffer
     */
    getCameraBuffer() {
        return this.cameraBuffer;
    }
    
    /**
     * Get frustum params buffer
     */
    getFrustumBuffer() {
        return this.frustumBuffer;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.transmittanceLUT?.destroy();
        this.multiScatterLUT?.destroy();
        this.skyViewLUT?.destroy();
        this.aerialPerspectiveLUT?.destroy();
        this.paramsBuffer?.destroy();
        this.cameraBuffer?.destroy();
        this.frustumBuffer?.destroy();
        this.initialized = false;
    }
}

export default HillaireLUT;
