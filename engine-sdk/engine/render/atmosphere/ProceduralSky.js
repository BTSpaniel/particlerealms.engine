// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProceduralSky.js - Dynamic Sun, 3 Moons, Stars + Day/Night Cycle
 * Now powered by vGPU driver
 * 
 * Uses unified CelestialBodiesWGSL from the modular sky system.
 * 
 * Complete procedural sky system with:
 * - 1 Sun with realistic positioning and multi-layer corona
 * - 3 Moons with independent orbital periods and 3D shading
 * - Star Nest volumetric star field + point stars
 * - Procedural clouds with FBM noise and sun-based lighting
 * - Day/night cycle: 3 hours sun, 3 hours dark (6 hour total cycle)
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { CelestialBodiesWGSL } from './sky/index.js';
import { radiansToDegrees } from '../../core/math/UnitMath.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _skyViewDirMatrix = new Float32Array(16);
const _skyCameraData = new Float32Array(20);
const _skyUniformData = new Float32Array(84);

// Time constants
const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 6;  // 6 real hours = 1 game day
const DAY_DURATION_SECONDS = HOURS_PER_DAY * SECONDS_PER_HOUR;  // 21600 seconds

// Sun phases
export const SUN_PHASE = {
    NIGHT: 0,
    DAWN: 1,
    DAY: 2,
    DUSK: 3,
};

// WGSL shader code for procedural sky
// Uses CelestialBodiesWGSL from modular sky system for celestial rendering functions
export const PROCEDURAL_SKY_WGSL = /* wgsl */ `
struct SkyUniforms {
    // Time
    timeOfDay: f32,        // 0-1 (0=midnight, 0.5=noon)
    dayProgress: f32,      // Total days elapsed
    
    // Sun
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    sunColor: vec3<f32>,
    sunAngularRadius: f32,
    
    // Moon 1 (Large)
    moon1Direction: vec3<f32>,
    moon1Phase: f32,       // 0-1 (0=new, 0.5=full)
    moon1Color: vec3<f32>,
    moon1AngularRadius: f32,
    
    // Moon 2 (Medium)
    moon2Direction: vec3<f32>,
    moon2Phase: f32,
    moon2Color: vec3<f32>,
    moon2AngularRadius: f32,
    
    // Moon 3 (Small)
    moon3Direction: vec3<f32>,
    moon3Phase: f32,
    moon3Color: vec3<f32>,
    moon3AngularRadius: f32,
    
    // Sky colors
    zenithColorDay: vec3<f32>,
    _pad1: f32,
    horizonColorDay: vec3<f32>,
    _pad2: f32,
    zenithColorNight: vec3<f32>,
    _pad3: f32,
    horizonColorNight: vec3<f32>,
    _pad4: f32,
    
    // Stars
    starDensity: f32,
    starBrightness: f32,
    starTwinkleSpeed: f32,
    
    // Control
    sunPhase: u32,
    
    // Camera/Atmosphere
    cameraAltitude: f32,        // Height above planet surface in meters
    atmosphereHeight: f32,      // Total atmosphere thickness (default 100000m = 100km)
    planetRadius: f32,          // Planet radius in meters (default 424000m = 424km)
    _pad5: f32,
}

// Import celestial body rendering functions from modular system
${CelestialBodiesWGSL}

// --- GPU GEMS 2 ATMOSPHERIC SCATTERING ---
// Based on GLtracy's implementation and GPU Gems 2 Chapter 16

const ATM_PI: f32 = 3.14159265359;
const ATM_MAX: f32 = 10000.0;
const R_INNER: f32 = 1.0;           // Planet radius (normalized)
const R_OUTER: f32 = 1.025;         // Atmosphere outer radius

// Ray-sphere intersection
fn raySphere(p: vec3<f32>, dir: vec3<f32>, r: f32) -> vec2<f32> {
    let b = dot(p, dir);
    let c = dot(p, p) - r * r;
    let d = b * b - c;
    
    if (d < 0.0) {
        return vec2<f32>(ATM_MAX, -ATM_MAX);
    }
    let sqrtD = sqrt(d);
    return vec2<f32>(-b - sqrtD, -b + sqrtD);
}

// Mie phase function (aerosol scattering)
fn phaseMie(g: f32, c: f32, cc: f32) -> f32 {
    let gg = g * g;
    let a = (1.0 - gg) * (1.0 + cc);
    var b = 1.0 + gg - 2.0 * g * c;
    b *= sqrt(b);
    b *= 2.0 + gg;
    return (3.0 / 8.0 / ATM_PI) * a / b;
}

// Rayleigh phase function (molecular scattering)
fn phaseRay(cc: f32) -> f32 {
    return (3.0 / 16.0 / ATM_PI) * (1.0 + cc);
}

// Atmospheric density at point
fn atmDensity(p: vec3<f32>, scaleHeight: f32) -> f32 {
    return exp(-max(length(p) - R_INNER, 0.0) / scaleHeight);
}

// Optical depth along ray segment
fn opticalDepth(p: vec3<f32>, q: vec3<f32>, scaleHeight: f32) -> f32 {
    let steps = 8;
    let s = (q - p) / f32(steps);
    var v = p + s * 0.5;
    var sum = 0.0;
    
    for (var i = 0; i < steps; i++) {
        sum += atmDensity(v, scaleHeight);
        v += s;
    }
    return sum * length(s);
}

// Main atmospheric scattering calculation
fn atmosphericScatter(viewDir: vec3<f32>, sunDir: vec3<f32>, sunIntensity: f32) -> vec3<f32> {
    // Scale heights for Rayleigh and Mie
    let phRay = 0.05;
    let phMie = 0.02;
    
    // Scattering coefficients (tuned for Earth-like atmosphere)
    // Reduced green to prevent green tint at twilight
    let kRay = vec3<f32>(5.5, 10.0, 33.1);  // Rayleigh - blue scatters more
    let kMie = vec3<f32>(21.0);              // Mie - uniform
    let kMieEx = 1.1;
    
    // Observer position (on surface looking out)
    let eye = vec3<f32>(0.0, R_INNER + 0.001, 0.0);
    
    // Find atmosphere intersection
    let e = raySphere(eye, viewDir, R_OUTER);
    if (e.x > e.y) {
        return vec3<f32>(0.0);  // No intersection
    }
    
    // Check planet intersection (ground)
    let f = raySphere(eye, viewDir, R_INNER);
    let tMax = select(e.y, min(e.y, f.x), f.x > 0.0);
    let tMin = max(e.x, 0.0);
    
    if (tMin >= tMax) {
        return vec3<f32>(0.0);
    }
    
    // In-scattering integration
    let inScatterSteps = 16;
    let len = (tMax - tMin) / f32(inScatterSteps);
    let stepVec = viewDir * len;
    var pos = eye + viewDir * (tMin + len * 0.5);
    
    var sumRay = vec3<f32>(0.0);
    var sumMie = vec3<f32>(0.0);
    var optRay = 0.0;
    var optMie = 0.0;
    
    for (var i = 0; i < inScatterSteps; i++) {
        let dRay = atmDensity(pos, phRay) * len;
        let dMie = atmDensity(pos, phMie) * len;
        
        optRay += dRay;
        optMie += dMie;
        
        // Light ray to sun
        let sunRay = raySphere(pos, sunDir, R_OUTER);
        let sunPos = pos + sunDir * sunRay.y;
        
        let optRaySun = opticalDepth(pos, sunPos, phRay);
        let optMieSun = opticalDepth(pos, sunPos, phMie);
        
        // Attenuation
        let att = exp(-(optRay + optRaySun) * kRay - (optMie + optMieSun) * kMie * kMieEx);
        
        sumRay += dRay * att;
        sumMie += dMie * att;
        
        pos += stepVec;
    }
    
    // Phase functions
    let cosAngle = dot(viewDir, sunDir);
    let cc = cosAngle * cosAngle;
    
    let scatter = sumRay * kRay * phaseRay(cc) + 
                  sumMie * kMie * phaseMie(-0.78, cosAngle, cc);
    
    return scatter * sunIntensity * 10.0;
}

// Simplified atmospheric scattering for sky gradient (wrapper)
fn skyAtmosphere(direction: vec3<f32>, sunDir: vec3<f32>, dayFactor: f32) -> vec3<f32> {
    // Only compute for sky (above horizon)
    if (direction.y < -0.1) {
        return vec3<f32>(0.0);
    }
    
    let sunIntensity = max(0.0, sunDir.y + 0.1) * 2.0;
    if (sunIntensity < 0.01) {
        return vec3<f32>(0.0);  // Night - no atmospheric scattering
    }
    
    return atmosphericScatter(direction, sunDir, sunIntensity);
}

// Main sky rendering - SPACE-BASED with curved atmosphere shell
fn renderSky(
    direction: vec3<f32>,
    uniforms: SkyUniforms,
    time: f32
) -> vec3<f32> {
    // ========== BASE: BLACK SPACE ==========
    var color = vec3<f32>(0.0, 0.0, 0.0);  // Space is black
    
    // Calculate day factor (0=night, 1=full day)
    let sunHeight = uniforms.sunDirection.y;
    let dayFactor = smoothstep(-0.1, 0.4, sunHeight);
    
    // ========== ALTITUDE-BASED ATMOSPHERE FADE ==========
    // Atmosphere fades as camera leaves surface
    // At surface (0m): full atmosphere
    // At atmosphere edge (100km): no atmosphere
    let atmHeight = max(uniforms.atmosphereHeight, 1.0);
    let altitudeRatio = clamp(uniforms.cameraAltitude / atmHeight, 0.0, 1.0);
    let atmosphereDensity = 1.0 - pow(altitudeRatio, 0.5);  // Exponential falloff
    
    // ========== CURVED ATMOSPHERE SHELL ==========
    // The atmosphere appears as a curved shell around the planet
    // When on surface: atmosphere above, ground below
    // When in space: see the curved atmosphere band around planet horizon
    
    // Calculate angle to horizon based on altitude
    let planetR = max(uniforms.planetRadius, 1.0);
    let observerR = planetR + uniforms.cameraAltitude;
    let horizonAngle = acos(clamp(planetR / observerR, -1.0, 1.0));  // Angle below horizontal to horizon
    
    // How much of the view is "planet" vs "space"
    // direction.y < -sin(horizonAngle) means looking at planet surface
    let horizonY = -sin(horizonAngle);
    let lookingAtPlanet = direction.y < horizonY;
    
    // Atmosphere shell band - visible as a curved glow around planet edge
    // Strongest near the horizon, fading above and below
    let distFromHorizon = abs(direction.y - horizonY);
    let atmosphereBandWidth = 0.15 + altitudeRatio * 0.3;  // Wider band when higher up
    let atmosphereBand = smoothstep(atmosphereBandWidth, 0.0, distFromHorizon);
    
    // ========== ATMOSPHERIC SCATTERING ==========
    // Only apply when looking through atmosphere (not at space behind)
    if (atmosphereDensity > 0.01 && !lookingAtPlanet) {
        let sunIntensity = max(0.0, uniforms.sunDirection.y + 0.1) * 2.0;
        if (sunIntensity > 0.01 && dayFactor > 0.1) {
            let scatter = atmosphericScatter(direction, uniforms.sunDirection, sunIntensity);
            // Atmosphere fades with altitude AND concentrates near horizon
            let horizonConcentration = 1.0 - pow(abs(direction.y), 0.4);
            color += scatter * atmosphereDensity * (0.3 + 0.7 * horizonConcentration);
        }
    }
    
    // ========== ATMOSPHERE GLOW (visible from space) ==========
    // When in space, see the blue atmosphere band around the planet
    if (altitudeRatio > 0.1) {
        let atmosphereGlowColor = vec3<f32>(0.4, 0.6, 1.0) * dayFactor +  // Blue during day
                                   vec3<f32>(0.1, 0.15, 0.3) * (1.0 - dayFactor);  // Dim blue at night
        let glowIntensity = atmosphereBand * (1.0 - atmosphereDensity) * 0.5;
        color += atmosphereGlowColor * glowIntensity;
    }
    
    // ========== PLANET SURFACE (looking down at ground) ==========
    if (lookingAtPlanet) {
        // Dark ground/terrain color when looking at planet
        let groundColor = vec3<f32>(0.02, 0.02, 0.015);  // Very dark, almost black
        let groundT = smoothstep(horizonY, horizonY - 0.3, direction.y);
        color = mix(color, groundColor, groundT);
    }
    
    // ========== HORIZON GLOW ==========
    // Atmospheric glow concentrated at horizon (the curved atmosphere edge)
    let horizonGlow = pow(max(0.0, 1.0 - abs(direction.y - horizonY) * 5.0), 2.0);
    let horizonColor = mix(
        vec3<f32>(0.02, 0.03, 0.06),  // Night horizon
        vec3<f32>(0.5, 0.7, 1.0),      // Day horizon (bright blue)
        dayFactor
    );
    color += horizonColor * horizonGlow * atmosphereDensity * 0.3;
    
    // ========== SUN GLOW ==========
    let sunProximity = max(0.0, dot(direction, uniforms.sunDirection));
    let sunGlow = pow(sunProximity, 4.0) * 0.3 + pow(sunProximity, 16.0) * 0.4;
    // Sun glow visible even in space, but atmospheric halo only on surface
    color += uniforms.sunColor * sunGlow * (0.3 + 0.7 * atmosphereDensity) * dayFactor;
    
    // ========== STARS (visible in space, dimmed by atmosphere) ==========
    // Stars always visible, but atmosphere blocks them on surface during day
    let starVisibility = 1.0 - dayFactor * atmosphereDensity;  // Visible at night or in space
    if (starVisibility > 0.1 && !lookingAtPlanet) {
        let stars = renderStars(direction, uniforms.sunDirection.y, uniforms.starDensity, uniforms.starBrightness, time, uniforms.starTwinkleSpeed);
        let nebulaColor = starNest(direction, time) * 0.08;
        color += (stars + nebulaColor) * starVisibility;
    }
    
    // Moons - using modular function
    color += renderMoons(
        direction,
        uniforms.sunDirection,
        dayFactor,
        uniforms.moon1Direction, uniforms.moon1AngularRadius, uniforms.moon1Phase, uniforms.moon1Color,
        uniforms.moon2Direction, uniforms.moon2AngularRadius, uniforms.moon2Phase, uniforms.moon2Color,
        uniforms.moon3Direction, uniforms.moon3AngularRadius, uniforms.moon3Phase, uniforms.moon3Color
    );
    
    // Sun disc - using modular function
    color += renderSun(direction, uniforms.sunDirection, uniforms.sunAngularRadius, uniforms.sunColor, uniforms.sunIntensity);
    
    // ========== SIMPLE TONE MAPPING ==========
    color = pow(color, vec3<f32>(0.95));  // Slight gamma lift
    
    return color;
}
`;

/**
 * CelestialBody - Represents sun or moon
 */
class CelestialBody {
    constructor(config) {
        this.name = config.name || 'Body';
        this.orbitalPeriod = config.orbitalPeriod || 6;  // hours
        this.angularRadius = config.angularRadius || 0.02;  // radians
        this.color = config.color || [1, 1, 1];
        this.intensity = config.intensity || 1.0;
        this.inclination = config.inclination || 0;  // orbital tilt in radians
        this.phase = 0;  // 0-1 for moons
        this.direction = [0, 1, 0];
        
        // Orbital phase offset (so bodies don't all start at same position)
        this.phaseOffset = config.phaseOffset || 0;
    }
    
    /**
     * Update position based on time
     * @param {number} timeSeconds - Total elapsed time in seconds
     */
    update(timeSeconds) {
        const periodSeconds = this.orbitalPeriod * SECONDS_PER_HOUR;
        const angle = ((timeSeconds / periodSeconds) + this.phaseOffset) * Math.PI * 2;
        
        // Calculate direction (simplified circular orbit)
        const cosAngle = Math.cos(angle);
        const sinAngle = Math.sin(angle);
        const cosIncl = Math.cos(this.inclination);
        const sinIncl = Math.sin(this.inclination);
        
        // Orbit in XY plane, tilted by inclination
        this.direction = [
            sinAngle * cosIncl,
            cosAngle,  // Y is "up"
            sinAngle * sinIncl,
        ];
        
        // Normalize
        const len = Math.sqrt(
            this.direction[0]**2 + 
            this.direction[1]**2 + 
            this.direction[2]**2
        );
        this.direction = this.direction.map(d => d / len);
        
        // Update moon phase (based on position relative to sun)
        // Simplified: phase = position in orbit
        this.phase = ((timeSeconds / periodSeconds) + this.phaseOffset) % 1;
    }
    
    /**
     * Check if body is above horizon
     */
    isAboveHorizon() {
        return this.direction[1] > 0;
    }
    
    /**
     * Get altitude angle (radians above horizon)
     */
    getAltitude() {
        return Math.asin(this.direction[1]);
    }
}

/**
 * ProceduralSky - Complete sky system
 */
export class ProceduralSky {
    constructor() {
        this.enabled = true;
        this.initialized = false;
        this.vgpu = null;
        
        // Time system
        this.timeScale = 1.0;  // 1.0 = real time, 60 = 1 minute = 1 hour
        this.elapsedSeconds = 0;
        this.dayDuration = DAY_DURATION_SECONDS;  // 6 hours
        
        // Sun (6 hour cycle = 3h day, 3h night)
        this.sun = new CelestialBody({
            name: 'Sun',
            orbitalPeriod: 6,
            angularRadius: 0.08,  // Much larger for visibility (~4.5 degrees)
            color: [1.0, 0.95, 0.85],
            intensity: 8.0,  // Bright enough to stand out
            inclination: 0.1,
            phaseOffset: 0.5,  // Start at noon (0.25=sunrise, 0.5=noon, 0.75=sunset)
        });
        
        // Moon 1 - Large, slow
        this.moon1 = new CelestialBody({
            name: 'Luna Major',
            orbitalPeriod: 8,
            angularRadius: 0.025,
            color: [0.9, 0.9, 1.0],
            intensity: 0.3,
            inclination: 0.15,
            phaseOffset: 0.1,
        });
        
        // Moon 2 - Medium, moderate speed
        this.moon2 = new CelestialBody({
            name: 'Luna Minor',
            orbitalPeriod: 5,
            angularRadius: 0.015,
            color: [1.0, 0.85, 0.7],  // Slightly orange
            intensity: 0.2,
            inclination: -0.2,
            phaseOffset: 0.4,
        });
        
        // Moon 3 - Small, fast
        this.moon3 = new CelestialBody({
            name: 'Luna Tertia',
            orbitalPeriod: 3,
            angularRadius: 0.008,
            color: [0.8, 0.9, 1.0],  // Slightly blue
            intensity: 0.1,
            inclination: 0.3,
            phaseOffset: 0.7,
        });
        
        // Sky colors
        this.zenithColorDay = [0.2, 0.5, 1.0];
        this.horizonColorDay = [0.7, 0.85, 1.0];
        this.zenithColorNight = [0.02, 0.02, 0.08];
        this.horizonColorNight = [0.05, 0.05, 0.15];
        
        // Stars
        this.starDensity = 1.0;
        this.starBrightness = 1.0;
        this.starTwinkleSpeed = 2.0;
        
        // Current state
        this.sunPhase = SUN_PHASE.DAY;
        this.ambientLight = [0.3, 0.3, 0.4];
        this.directionalLight = [1, 1, 1];
        
        // Camera/Atmosphere parameters
        this.cameraAltitude = 1.7;           // Height above surface in meters (default eye height)
        this.atmosphereHeight = 100000;       // Atmosphere thickness (100km)
        this.planetRadius = 424000;           // Planet radius (424km)
        
        // Hillaire LUT integration (optional, uses built-in scattering if not set)
        this.hillaireAtmosphere = null;
        this.useHillaireLUT = false;
        
        // GPU resources
        this.device = null;
        this.uniformBuffer = null;
    }
    
    /**
     * Initialize the sky system
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create buffers using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 352, usage: 'uniform', label: 'ProceduralSkyUniforms' }).buffer;
        this.cameraBuffer = this.vgpu.buffer.create({ size: 80, usage: 'uniform', label: 'SkyCameraUniforms' }).buffer;
        
        // Create render pipeline for sky
        await this.createPipeline(device);
        
        this.initialized = true;
        console.log(`[ProceduralSky] Initialized (${this.dayDuration/3600}h day cycle, 3 moons)`);
        
        // Initial update
        this.update(0);
    }
    
    /**
     * Create the sky render pipeline
     */
    async createPipeline(device) {
        const shaderModule = this.vgpu.shader.compile('proceduralSky', `
${PROCEDURAL_SKY_WGSL}

struct CameraUniforms {
    viewDirectionProjectionInverse: mat4x4<f32>,
    time: f32,
    useHillaireLUT: f32,  // 1.0 = use LUT, 0.0 = use built-in scattering
    _pad2: f32,
    _pad3: f32,
}

@group(0) @binding(0) var<uniform> sky: SkyUniforms;
@group(0) @binding(1) var<uniform> camera: CameraUniforms;
@group(0) @binding(2) var skyViewLUT: texture_2d<f32>;
@group(0) @binding(3) var lutSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) clipPos: vec4<f32>,
}

// Hillaire Sky-View LUT UV mapping (horizon-preserving)
fn directionToSkyViewUV(direction: vec3<f32>) -> vec2<f32> {
    // Longitude: 0-1 around the horizon
    let longitude = atan2(direction.z, direction.x);
    let u = (longitude / (2.0 * 3.14159265) + 0.5);
    
    // Latitude: horizon-preserving mapping (concentrates texels at horizon)
    let latitude = asin(clamp(direction.y, -1.0, 1.0));
    let v = 0.5 + 0.5 * sign(latitude) * sqrt(abs(latitude) / (3.14159265 * 0.5));
    
    return vec2<f32>(u, v);
}

// Sample sky color from Hillaire Sky-View LUT
fn sampleSkyViewLUT(direction: vec3<f32>) -> vec3<f32> {
    let uv = directionToSkyViewUV(direction);
    return textureSample(skyViewLUT, lutSampler, uv).rgb;
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    // Fullscreen triangle in clip space
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    
    var output: VertexOutput;
    // Set z=1 so sky is at far plane (furthest depth)
    output.position = vec4<f32>(positions[vertexIndex], 1.0, 1.0);
    output.clipPos = output.position;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    // Standard skybox technique: multiply clip position by inverse view-direction-projection
    let t = camera.viewDirectionProjectionInverse * input.clipPos;
    let direction = normalize(t.xyz / t.w);
    
    var color: vec3<f32>;
    
    // Use Hillaire Sky-View LUT if available, otherwise fall back to built-in scattering
    if (camera.useHillaireLUT > 0.5) {
        // Production-grade Hillaire 2020 LUT-based rendering
        color = sampleSkyViewLUT(direction);
        
        // Still render celestial bodies on top of LUT sky
        let sunHeight = sky.sunDirection.y;
        let dayFactor = smoothstep(-0.1, 0.4, sunHeight);
        
        // Stars (at night)
        if (dayFactor < 0.3 && direction.y > -0.3) {
            let starFade = 1.0 - dayFactor / 0.3;
            color += renderStars(direction, sky.sunDirection.y, sky.starDensity, sky.starBrightness, camera.time, sky.starTwinkleSpeed) * starFade;
        }
        
        // Moons
        color += renderMoons(
            direction, sky.sunDirection, dayFactor,
            sky.moon1Direction, sky.moon1AngularRadius, sky.moon1Phase, sky.moon1Color,
            sky.moon2Direction, sky.moon2AngularRadius, sky.moon2Phase, sky.moon2Color,
            sky.moon3Direction, sky.moon3AngularRadius, sky.moon3Phase, sky.moon3Color
        );
        
        // Sun disc
        color += renderSun(direction, sky.sunDirection, sky.sunAngularRadius, sky.sunColor, sky.sunIntensity);
    } else {
        // Fallback: built-in GPU Gems 2 scattering
        color = renderSky(direction, sky, camera.time);
    }
    
    return vec4<f32>(color, 1.0);
}
            `);
        
        // Define bind group layout using vGPU
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('proceduralSky', [
            { binding: 0, type: 'uniform', visibility: 'fragment' },
            { binding: 1, type: 'uniform', visibility: 'vertex|fragment' },
            { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'float' },
            { binding: 3, type: 'sampler', visibility: 'fragment' },
        ]);
        
        // Create dummy texture and sampler using vGPU
        this.dummyTexture = this.vgpu.texture.create({ width: 1, height: 1, format: 'rgba16float', usage: 'texture', label: 'SkyDummyTexture' }).texture;
        this.lutSampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp-to-edge' });
        
        // Create bind group using vGPU
        this.bindGroup = this.vgpu.bindings.createGroup(this.bindGroupLayout, [
            { binding: 0, buffer: this.uniformBuffer },
            { binding: 1, buffer: this.cameraBuffer },
            { binding: 2, textureView: this.dummyTexture.createView() },
            { binding: 3, sampler: this.lutSampler },
        ], 'SkyBindGroup');
        
        // Create pipeline using vGPU
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module: shaderModule, entryPoint: 'vertexMain' },
            fragment: { module: shaderModule, entryPoint: 'fragmentMain' },
            layouts: [this.bindGroupLayout],
            colorFormat: navigator.gpu.getPreferredCanvasFormat(),
            topology: 'triangle-list',
            depthFormat: 'depth24plus',
            depthWrite: false,
            depthCompare: 'less-equal',
            label: 'ProceduralSkyPipeline'
        });
    }
    
    /**
     * Render the sky
     * @param {GPURenderPassEncoder} renderPass 
     * @param {Float32Array} viewMatrix - View matrix (will have translation zeroed)
     * @param {Float32Array} projectionMatrix - Projection matrix
     * @param {number} time - Current time for animations
     * @param {Function} mat4Multiply - Matrix multiply function from engine
     * @param {Function} mat4Inverse - Matrix inverse function from engine
     */
    render(renderPass, viewMatrix, projectionMatrix, time = 0, mat4Multiply, mat4Inverse) {
        if (!this.initialized || !this.enabled || !this.pipeline) return;
        
        // Standard skybox technique from WebGL Fundamentals:
        // 1. Zero out translation from view matrix (we only care about direction) - reuse buffer
        _skyViewDirMatrix.set(viewMatrix);
        _skyViewDirMatrix[12] = 0;  // Column-major: translation at 12,13,14
        _skyViewDirMatrix[13] = 0;
        _skyViewDirMatrix[14] = 0;
        
        // 2. Multiply projection * viewDirection (use engine's column-major multiply)
        const viewDirectionProjection = mat4Multiply(projectionMatrix, _skyViewDirMatrix);
        
        // 3. Take the inverse (use engine's inverse)
        const viewDirectionProjectionInverse = mat4Inverse(viewDirectionProjection);
        
        // Update camera uniforms (includes useHillaireLUT flag) - reuse buffer
        _skyCameraData.set(viewDirectionProjectionInverse, 0);
        _skyCameraData[16] = time;
        _skyCameraData[17] = this.useHillaireLUT ? 1.0 : 0.0;  // useHillaireLUT flag
        this.device.queue.writeBuffer(this.cameraBuffer, 0, _skyCameraData);
        
        // Update bind group if Hillaire LUT is available
        this._updateBindGroupForLUT();
        
        // Draw fullscreen sky
        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, this.bindGroup);
        renderPass.draw(3);  // Fullscreen triangle
    }
    
    /**
     * Update bind group to use Hillaire Sky-View LUT when available
     * @private
     */
    _updateBindGroupForLUT() {
        if (!this.device || !this.bindGroupLayout) return;
        
        // Get Sky-View LUT texture view from Hillaire system
        let skyViewTexture = this.dummyTexture.createView();
        
        if (this.useHillaireLUT && this.hillaireAtmosphere) {
            const lutViews = this.hillaireAtmosphere.getLUTViews();
            if (lutViews?.skyView) {
                skyViewTexture = lutViews.skyView;
            }
        }
        
        // Recreate bind group with current LUT
        this.bindGroup = this.device.createBindGroup({
            label: 'Sky Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.cameraBuffer } },
                { binding: 2, resource: skyViewTexture },
                { binding: 3, resource: this.lutSampler },
            ],
        });
    }
    
    /**
     * Invert a 4x4 matrix (simple implementation for projection matrices)
     */
    invertMatrix4(m) {
        const out = new Float32Array(16);
        const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
        const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
        const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
        const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (!det) return out;
        det = 1.0 / det;

        out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
        out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
        out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
        out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
        out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
        out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
        out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
        out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
        out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
        out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
        out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
        out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
        out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
        out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
        out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
        out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

        return out;
    }
    
    /**
     * Update sky based on world time
     * @param {number} deltaSeconds - Time since last update (scaled by TimeController)
     * @param {number} gameTime - Total game time from TimeController (optional)
     */
    update(deltaSeconds, gameTime = null) {
        // If gameTime is provided, use it directly (synced with TimeController)
        // Otherwise, accumulate our own elapsed time
        if (gameTime !== null) {
            this.elapsedSeconds = gameTime * this.timeScale;
        } else {
            this.elapsedSeconds += deltaSeconds * this.timeScale;
        }
        
        // Update celestial bodies based on world time
        this.sun.update(this.elapsedSeconds);
        this.moon1.update(this.elapsedSeconds);
        this.moon2.update(this.elapsedSeconds);
        this.moon3.update(this.elapsedSeconds);
        
        // Determine sun phase
        const sunAlt = this.sun.getAltitude();
        if (sunAlt > 0.1) {
            this.sunPhase = SUN_PHASE.DAY;
        } else if (sunAlt > -0.1) {
            this.sunPhase = sunAlt > 0 ? SUN_PHASE.DUSK : SUN_PHASE.DAWN;
        } else {
            this.sunPhase = SUN_PHASE.NIGHT;
        }
        
        // Update lighting
        this.updateLighting();
        
        // Update GPU uniforms
        this.updateUniforms();
    }
    
    /**
     * Update ambient and directional lighting based on sun/moons
     */
    updateLighting() {
        const sunAlt = Math.max(0, this.sun.direction[1]);
        const dayFactor = Math.min(1, sunAlt * 3);  // 0-1 based on sun height
        
        // Ambient light (base level)
        const dayAmbient = [0.4, 0.45, 0.5];
        const nightAmbient = [0.05, 0.05, 0.1];
        
        this.ambientLight = [
            nightAmbient[0] + (dayAmbient[0] - nightAmbient[0]) * dayFactor,
            nightAmbient[1] + (dayAmbient[1] - nightAmbient[1]) * dayFactor,
            nightAmbient[2] + (dayAmbient[2] - nightAmbient[2]) * dayFactor,
        ];
        
        // Add moon contribution to ambient at night
        if (dayFactor < 0.5) {
            const moonContrib = this.getMoonlightContribution();
            this.ambientLight[0] += moonContrib[0] * (1 - dayFactor * 2);
            this.ambientLight[1] += moonContrib[1] * (1 - dayFactor * 2);
            this.ambientLight[2] += moonContrib[2] * (1 - dayFactor * 2);
        }
        
        // Directional light (from sun during day, strongest moon at night)
        if (dayFactor > 0.1) {
            this.directionalLight = this.sun.color.map(c => c * this.sun.intensity * dayFactor);
        } else {
            const strongestMoon = this.getStrongestMoon();
            if (strongestMoon) {
                this.directionalLight = strongestMoon.color.map(c => c * strongestMoon.intensity * 0.3);
            } else {
                this.directionalLight = [0.05, 0.05, 0.1];
            }
        }
    }
    
    /**
     * Get combined moonlight contribution
     */
    getMoonlightContribution() {
        const moons = [this.moon1, this.moon2, this.moon3];
        let light = [0, 0, 0];
        
        for (const moon of moons) {
            if (moon.isAboveHorizon()) {
                const alt = moon.getAltitude();
                const factor = Math.sin(alt) * moon.intensity;
                // Phase affects brightness (full moon = bright)
                const phaseFactor = Math.abs(moon.phase - 0.5) * 2;
                
                light[0] += moon.color[0] * factor * phaseFactor;
                light[1] += moon.color[1] * factor * phaseFactor;
                light[2] += moon.color[2] * factor * phaseFactor;
            }
        }
        
        return light;
    }
    
    /**
     * Get the strongest moon currently above horizon
     */
    getStrongestMoon() {
        const moons = [this.moon1, this.moon2, this.moon3];
        let strongest = null;
        let maxBrightness = 0;
        
        for (const moon of moons) {
            if (moon.isAboveHorizon()) {
                const brightness = moon.intensity * moon.direction[1];
                if (brightness > maxBrightness) {
                    maxBrightness = brightness;
                    strongest = moon;
                }
            }
        }
        
        return strongest;
    }
    
    /**
     * Update GPU uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        const data = _skyUniformData;  // Reuse module-level buffer
        let i = 0;
        
        // Time
        data[i++] = (this.elapsedSeconds % this.dayDuration) / this.dayDuration;  // timeOfDay
        data[i++] = this.elapsedSeconds / this.dayDuration;  // dayProgress
        data[i++] = 0;  // padding
        data[i++] = 0;  // padding
        
        // Sun (16 floats)
        data[i++] = this.sun.direction[0];
        data[i++] = this.sun.direction[1];
        data[i++] = this.sun.direction[2];
        data[i++] = this.sun.intensity;
        data[i++] = this.sun.color[0];
        data[i++] = this.sun.color[1];
        data[i++] = this.sun.color[2];
        data[i++] = this.sun.angularRadius;
        
        // Moon 1 (12 floats)
        data[i++] = this.moon1.direction[0];
        data[i++] = this.moon1.direction[1];
        data[i++] = this.moon1.direction[2];
        data[i++] = this.moon1.phase;
        data[i++] = this.moon1.color[0];
        data[i++] = this.moon1.color[1];
        data[i++] = this.moon1.color[2];
        data[i++] = this.moon1.angularRadius;
        
        // Moon 2 (12 floats)
        data[i++] = this.moon2.direction[0];
        data[i++] = this.moon2.direction[1];
        data[i++] = this.moon2.direction[2];
        data[i++] = this.moon2.phase;
        data[i++] = this.moon2.color[0];
        data[i++] = this.moon2.color[1];
        data[i++] = this.moon2.color[2];
        data[i++] = this.moon2.angularRadius;
        
        // Moon 3 (12 floats)
        data[i++] = this.moon3.direction[0];
        data[i++] = this.moon3.direction[1];
        data[i++] = this.moon3.direction[2];
        data[i++] = this.moon3.phase;
        data[i++] = this.moon3.color[0];
        data[i++] = this.moon3.color[1];
        data[i++] = this.moon3.color[2];
        data[i++] = this.moon3.angularRadius;
        
        // Sky colors (16 floats with padding)
        data[i++] = this.zenithColorDay[0];
        data[i++] = this.zenithColorDay[1];
        data[i++] = this.zenithColorDay[2];
        data[i++] = 0;
        data[i++] = this.horizonColorDay[0];
        data[i++] = this.horizonColorDay[1];
        data[i++] = this.horizonColorDay[2];
        data[i++] = 0;
        data[i++] = this.zenithColorNight[0];
        data[i++] = this.zenithColorNight[1];
        data[i++] = this.zenithColorNight[2];
        data[i++] = 0;
        data[i++] = this.horizonColorNight[0];
        data[i++] = this.horizonColorNight[1];
        data[i++] = this.horizonColorNight[2];
        data[i++] = 0;
        
        // Stars + control (4 floats)
        data[i++] = this.starDensity;
        data[i++] = this.starBrightness;
        data[i++] = this.starTwinkleSpeed;
        data[i++] = this.sunPhase;
        
        // Camera/Atmosphere (4 floats)
        data[i++] = this.cameraAltitude;
        data[i++] = this.atmosphereHeight;
        data[i++] = this.planetRadius;
        data[i++] = 0;  // padding
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Set time of day
     * @param {number} hours - Hours (0-6, where 0=midnight, 3=noon)
     */
    setTimeOfDay(hours) {
        this.elapsedSeconds = (hours / HOURS_PER_DAY) * this.dayDuration;
        this.update(0);
    }
    
    /**
     * Set time scale
     * @param {number} scale - 1=real time, 60=1min=1hour, 360=1min=6hours(full day)
     */
    setTimeScale(scale) {
        this.timeScale = scale;
    }
    
    /**
     * Set camera altitude (affects atmosphere rendering)
     * @param {number} altitude - Height above planet surface in meters
     */
    setCameraAltitude(altitude) {
        this.cameraAltitude = Math.max(0, altitude);
        this.updateUniforms();
    }
    
    /**
     * Set planet parameters
     * @param {number} radiusKm - Planet radius in kilometers
     * @param {number} atmosphereKm - Atmosphere height in kilometers
     */
    setPlanetParams(radiusKm, atmosphereKm = 100) {
        this.planetRadius = radiusKm * 1000;
        this.atmosphereHeight = atmosphereKm * 1000;
        this.updateUniforms();
    }
    
    /**
     * Connect to Hillaire LUT atmosphere system
     * When connected, sky rendering uses production-grade LUTs instead of built-in scattering
     * @param {HillaireAtmosphereSystem} hillaireAtmosphere - The Hillaire atmosphere system
     */
    setHillaireAtmosphere(hillaireAtmosphere) {
        this.hillaireAtmosphere = hillaireAtmosphere;
        this.useHillaireLUT = hillaireAtmosphere?.initialized ?? false;
        if (this.useHillaireLUT) {
            console.log('[ProceduralSky] Connected to Hillaire LUT system');
        }
    }
    
    /**
     * Get Hillaire LUT views for external rendering
     * @returns {Object|null} LUT texture views or null if not available
     */
    getHillaireLUTViews() {
        if (!this.useHillaireLUT || !this.hillaireAtmosphere) return null;
        return this.hillaireAtmosphere.getLUTViews();
    }
    
    /**
     * Get current time info
     */
    getTimeInfo() {
        const dayProgress = (this.elapsedSeconds % this.dayDuration) / this.dayDuration;
        const hours = dayProgress * HOURS_PER_DAY;
        
        return {
            dayProgress,
            hours: hours.toFixed(2),
            sunPhase: ['Night', 'Dawn', 'Day', 'Dusk'][this.sunPhase],
            sunAltitude: radiansToDegrees(this.sun.getAltitude()).toFixed(1) + '°',
            moon1Above: this.moon1.isAboveHorizon(),
            moon2Above: this.moon2.isAboveHorizon(),
            moon3Above: this.moon3.isAboveHorizon(),
            ambientLight: this.ambientLight.map(v => v.toFixed(2)),
        };
    }
    
    /**
     * Get sun direction for lighting
     */
    getSunDirection() {
        return [...this.sun.direction];
    }
    
    /**
     * Get primary light direction (sun during day, moon at night)
     */
    getPrimaryLightDirection() {
        if (this.sun.isAboveHorizon()) {
            return this.getSunDirection();
        }
        const moon = this.getStrongestMoon();
        return moon ? [...moon.direction] : [0, 1, 0];
    }
    
    /**
     * Get bind group entry
     */
    getBindGroupEntry(binding) {
        return {
            binding,
            resource: { buffer: this.uniformBuffer },
        };
    }
    
    /**
     * Load configuration from engine.cfg sections
     * @param {Object} config - Full config object with all sections
     */
    loadConfig(config) {
        if (!config) return;
        
        const skyCfg = config.procedural_sky;
        if (skyCfg) {
            this.enabled = skyCfg.enabled !== false;
            this.timeScale = parseFloat(skyCfg.time_scale) || 60;
            this.setTimeOfDay(parseFloat(skyCfg.start_time) || 1.5);
        }
        
        // Sun configuration
        const sunCfg = config.sun;
        if (sunCfg && this.sun) {
            this.sun.orbitalPeriod = parseFloat(sunCfg.orbital_period) || 6;
            this.sun.angularRadius = parseFloat(sunCfg.angular_radius) || 0.03;
            this.sun.color = [
                parseFloat(sunCfg.color_r) || 1.0,
                parseFloat(sunCfg.color_g) || 0.95,
                parseFloat(sunCfg.color_b) || 0.85,
            ];
            this.sun.intensity = parseFloat(sunCfg.intensity) || 1.5;
            this.sun.inclination = parseFloat(sunCfg.inclination) || 0.1;
        }
        
        // Moon 1 configuration
        const moon1Cfg = config.moon1;
        if (moon1Cfg && this.moon1) {
            this.moon1.name = moon1Cfg.name || 'Luna Major';
            this.moon1.orbitalPeriod = parseFloat(moon1Cfg.orbital_period) || 8;
            this.moon1.angularRadius = parseFloat(moon1Cfg.angular_radius) || 0.025;
            this.moon1.color = [
                parseFloat(moon1Cfg.color_r) || 0.9,
                parseFloat(moon1Cfg.color_g) || 0.9,
                parseFloat(moon1Cfg.color_b) || 1.0,
            ];
            this.moon1.intensity = parseFloat(moon1Cfg.intensity) || 0.3;
            this.moon1.inclination = parseFloat(moon1Cfg.inclination) || 0.15;
            this.moon1.phaseOffset = parseFloat(moon1Cfg.phase_offset) || 0.1;
        }
        
        // Moon 2 configuration
        const moon2Cfg = config.moon2;
        if (moon2Cfg && this.moon2) {
            this.moon2.name = moon2Cfg.name || 'Luna Minor';
            this.moon2.orbitalPeriod = parseFloat(moon2Cfg.orbital_period) || 5;
            this.moon2.angularRadius = parseFloat(moon2Cfg.angular_radius) || 0.015;
            this.moon2.color = [
                parseFloat(moon2Cfg.color_r) || 1.0,
                parseFloat(moon2Cfg.color_g) || 0.85,
                parseFloat(moon2Cfg.color_b) || 0.7,
            ];
            this.moon2.intensity = parseFloat(moon2Cfg.intensity) || 0.2;
            this.moon2.inclination = parseFloat(moon2Cfg.inclination) || -0.2;
            this.moon2.phaseOffset = parseFloat(moon2Cfg.phase_offset) || 0.4;
        }
        
        // Moon 3 configuration
        const moon3Cfg = config.moon3;
        if (moon3Cfg && this.moon3) {
            this.moon3.name = moon3Cfg.name || 'Luna Tertia';
            this.moon3.orbitalPeriod = parseFloat(moon3Cfg.orbital_period) || 3;
            this.moon3.angularRadius = parseFloat(moon3Cfg.angular_radius) || 0.008;
            this.moon3.color = [
                parseFloat(moon3Cfg.color_r) || 0.8,
                parseFloat(moon3Cfg.color_g) || 0.9,
                parseFloat(moon3Cfg.color_b) || 1.0,
            ];
            this.moon3.intensity = parseFloat(moon3Cfg.intensity) || 0.1;
            this.moon3.inclination = parseFloat(moon3Cfg.inclination) || 0.3;
            this.moon3.phaseOffset = parseFloat(moon3Cfg.phase_offset) || 0.7;
        }
        
        // Stars configuration
        const starsCfg = config.stars;
        if (starsCfg) {
            this.starDensity = parseFloat(starsCfg.density) || 1.0;
            this.starBrightness = parseFloat(starsCfg.brightness) || 1.0;
            this.starTwinkleSpeed = parseFloat(starsCfg.twinkle_speed) || 2.0;
        }
        
        // Sky colors configuration
        const colorsCfg = config.sky_colors;
        if (colorsCfg) {
            this.zenithColorDay = [
                parseFloat(colorsCfg.zenith_day_r) || 0.2,
                parseFloat(colorsCfg.zenith_day_g) || 0.5,
                parseFloat(colorsCfg.zenith_day_b) || 1.0,
            ];
            this.horizonColorDay = [
                parseFloat(colorsCfg.horizon_day_r) || 0.7,
                parseFloat(colorsCfg.horizon_day_g) || 0.85,
                parseFloat(colorsCfg.horizon_day_b) || 1.0,
            ];
            this.zenithColorNight = [
                parseFloat(colorsCfg.zenith_night_r) || 0.02,
                parseFloat(colorsCfg.zenith_night_g) || 0.02,
                parseFloat(colorsCfg.zenith_night_b) || 0.08,
            ];
            this.horizonColorNight = [
                parseFloat(colorsCfg.horizon_night_r) || 0.05,
                parseFloat(colorsCfg.horizon_night_g) || 0.05,
                parseFloat(colorsCfg.horizon_night_b) || 0.15,
            ];
        }
        
        this.updateUniforms();
    }
    
    /**
     * Get WGSL shader code
     */
    static getShaderCode() {
        return PROCEDURAL_SKY_WGSL;
    }
    
    /**
     * Destroy resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default ProceduralSky;
