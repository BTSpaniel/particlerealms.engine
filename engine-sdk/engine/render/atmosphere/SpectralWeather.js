// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { random } from '../../core/math/MathRandom.js';

/**
 * SpectralWeather.js - Spectral Spherical Harmonics Weather Simulation
 * Now powered by vGPU driver
 * 
 * Implements T21 resolution spectral weather model:
 * - Spherical harmonic basis functions Y_l^m(θ,φ)
 * - 484 complex coefficients (l=0..21, m=-l..l) per variable
 * - 5 pressure levels × 4 variables (u, v, T, q)
 * - Rossby wave dynamics with westward propagation
 * - Hadley cell forcing for seasonal patterns
 * 
 * Based on ECMWF spectral weather modeling techniques.
 * Simplified for real-time game simulation.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// T21 truncation: max degree l=21, total coefficients = (21+1)² = 484 per level
const MAX_DEGREE = 21;
const NUM_COEFFICIENTS = (MAX_DEGREE + 1) * (MAX_DEGREE + 1);  // 484
const NUM_LEVELS = 5;  // Pressure levels
const NUM_VARIABLES = 4;  // u, v, T, q

// Variable indices
const VAR_U = 0;  // Zonal wind (east-west)
const VAR_V = 1;  // Meridional wind (north-south)
const VAR_T = 2;  // Temperature
const VAR_Q = 3;  // Specific humidity

// Pressure levels (hPa)
const PRESSURE_LEVELS = [1000, 850, 500, 300, 100];

// Physical constants
const EARTH_ROTATION = 7.2921e-5;  // rad/s
const EARTH_RADIUS = 6.371e6;      // meters
const ROSSBY_BETA = 2 * EARTH_ROTATION / EARTH_RADIUS;

// WGSL Compute shader for spherical harmonic evaluation and weather evolution
export const SPECTRAL_WEATHER_WGSL = /* wgsl */ `
struct WeatherUniforms {
    time: f32,
    deltaTime: f32,
    seasonalPhase: f32,      // 0-1 (0=winter, 0.5=summer in northern hemisphere)
    planetRadius: f32,
    
    rotationRate: f32,       // rad/s
    rossbyBeta: f32,
    dissipationRate: f32,
    forcingStrength: f32,
    
    cameraLatitude: f32,
    cameraLongitude: f32,
    _pad: vec2<f32>,
}

const PI: f32 = 3.14159265359;
const MAX_L: u32 = 21u;
const NUM_COEFFS: u32 = 484u;  // (21+1)²

// Spherical harmonic basis function Y_l^m(θ,φ)
// Uses associated Legendre polynomials P_l^m(cos θ)
// Y_l^m = K_l^m * P_l^m(cos θ) * e^(imφ)

// Normalization constant K_l^m
fn sphericalHarmonicNorm(l: u32, m: i32) -> f32 {
    let absM = u32(abs(m));
    var factorialRatio = 1.0;
    
    // (l-|m|)! / (l+|m|)!
    for (var k = l - absM + 1u; k <= l + absM; k++) {
        factorialRatio /= f32(k);
    }
    
    return sqrt((2.0 * f32(l) + 1.0) / (4.0 * PI) * factorialRatio);
}

// Associated Legendre polynomial P_l^m(x) using recurrence
fn associatedLegendre(l: u32, m: u32, x: f32) -> f32 {
    if (m > l) { return 0.0; }
    
    // Start with P_m^m
    var pmm = 1.0;
    if (m > 0u) {
        let somx2 = sqrt((1.0 - x) * (1.0 + x));
        var fact = 1.0;
        for (var i = 1u; i <= m; i++) {
            pmm *= -fact * somx2;
            fact += 2.0;
        }
    }
    
    if (l == m) { return pmm; }
    
    // P_{m+1}^m
    var pmmp1 = x * (2.0 * f32(m) + 1.0) * pmm;
    if (l == m + 1u) { return pmmp1; }
    
    // Use recurrence for higher l
    var pll = 0.0;
    for (var ll = m + 2u; ll <= l; ll++) {
        pll = (x * (2.0 * f32(ll) - 1.0) * pmmp1 - (f32(ll) + f32(m) - 1.0) * pmm) / (f32(ll) - f32(m));
        pmm = pmmp1;
        pmmp1 = pll;
    }
    
    return pll;
}

// Real spherical harmonic (returns cos(mφ) and sin(mφ) parts separately)
fn realSphericalHarmonic(l: u32, m: i32, theta: f32, phi: f32) -> vec2<f32> {
    let absM = u32(abs(m));
    let cosTheta = cos(theta);
    
    let norm = sphericalHarmonicNorm(l, m);
    let plm = associatedLegendre(l, absM, cosTheta);
    
    let mPhi = f32(absM) * phi;
    
    if (m >= 0) {
        return vec2<f32>(norm * plm * cos(mPhi), 0.0);
    } else {
        return vec2<f32>(0.0, norm * plm * sin(mPhi));
    }
}

// Convert (l, m) to linear index
fn coeffIndex(l: u32, m: i32) -> u32 {
    // Index = l² + l + m
    return l * l + l + u32(m + i32(l));
}

// Rossby wave dispersion relation
// ω = -βk / (k² + ℓ² + 1/R²)
fn rossbyFrequency(l: u32, beta: f32, radius: f32) -> f32 {
    let k = f32(l) / radius;  // Wavenumber
    let deformationRadius = radius / 10.0;  // Rossby deformation radius
    let invRd2 = 1.0 / (deformationRadius * deformationRadius);
    
    return -beta * k / (k * k + invRd2);
}

// Hadley cell forcing (tropical heating, polar cooling)
fn hadleyCellForcing(latitude: f32, seasonalPhase: f32) -> f32 {
    // Seasonal shift of ITCZ
    let itczLat = 10.0 * sin(seasonalPhase * 2.0 * PI);  // degrees
    let latDeg = latitude * 180.0 / PI;
    
    // Gaussian heating centered on ITCZ
    let sigma = 15.0;  // degrees
    let heating = exp(-pow((latDeg - itczLat) / sigma, 2.0));
    
    // Polar cooling
    let polarCooling = -0.5 * (1.0 - cos(latitude));
    
    return heating + polarCooling;
}

// Orographic forcing from terrain
// Models how mountains deflect and lift air masses
fn orographicForcing(wind: vec3<f32>, terrainGradient: vec2<f32>, terrainHeight: f32, stability: f32) -> vec3<f32> {
    // Vertical velocity from terrain slope
    let w_terrain = dot(wind.xy, terrainGradient);
    
    // Froude number: determines if flow goes over or around mountain
    // Fr < 1: flow blocked/diverted, Fr > 1: flow goes over
    let windSpeed = length(wind.xy);
    let froudeNumber = windSpeed / max(stability * terrainHeight, 0.001);
    
    // Drag coefficient based on Froude number
    let dragCoeff = select(0.0, 1.0 - froudeNumber, froudeNumber < 1.0);
    
    // Rain shadow effect (lee side drying)
    let rainShadow = select(0.0, -w_terrain * 0.5, w_terrain < 0.0);
    
    // Orographic lift (windward side precipitation)
    let orographicLift = max(0.0, w_terrain);
    
    return vec3<f32>(orographicLift, dragCoeff, rainShadow);
}

// Lee wave generation (mountain waves)
fn leeWaveAmplitude(windSpeed: f32, stabilityFreq: f32, terrainHeight: f32) -> f32 {
    // Scorer parameter
    let scorer = stabilityFreq / max(windSpeed, 0.1);
    
    // Wave amplitude proportional to terrain and trapped by scorer parameter
    return terrainHeight * exp(-scorer * terrainHeight);
}
`;

// CPU-side spherical harmonic utilities
const factorial = (n) => {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
};

const sphericalHarmonicNorm = (l, m) => {
    const absM = Math.abs(m);
    const factRatio = factorial(l - absM) / factorial(l + absM);
    return Math.sqrt((2 * l + 1) / (4 * Math.PI) * factRatio);
};

/**
 * SpectralWeather - T21 spectral weather simulation
 */
export class SpectralWeather {
    constructor() {
        this.initialized = false;
        this.device = null;
        
        // Planet parameters
        this.planetRadius = 424000;  // meters (game planet)
        this.rotationRate = 7.2921e-5;  // rad/s
        
        // Simulation parameters
        this.time = 0;
        this.seasonalPhase = 0;  // 0-1 (annual cycle)
        this.dissipationRate = 0.01;
        this.forcingStrength = 1.0;
        
        // GPU resources
        this.uniformBuffer = null;
        this.coefficientBuffer = null;  // Complex coefficients
        
        // CPU coefficient arrays (for initialization)
        this.coefficients = null;  // Float32Array: 484 * 5 * 4 * 2 (real + imag)
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(12);
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create buffers using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 48, usage: 'uniform', label: 'WeatherUniforms' }).buffer;
        
        // Coefficient buffer: 484 coefficients × 5 levels × 4 variables × 2 (complex) × 4 bytes
        const bufferSize = NUM_COEFFICIENTS * NUM_LEVELS * NUM_VARIABLES * 2 * 4;
        this.coefficientBuffer = this.vgpu.buffer.create({ size: bufferSize, usage: 'storage', label: 'WeatherCoefficients' }).buffer;
        
        // Initialize coefficients
        this.coefficients = new Float32Array(NUM_COEFFICIENTS * NUM_LEVELS * NUM_VARIABLES * 2);
        this._initializeCoefficients();
        
        // Upload to GPU
        device.queue.writeBuffer(this.coefficientBuffer, 0, this.coefficients);
        
        this.updateUniforms();
        this.initialized = true;
        
        console.log(`[SpectralWeather] Initialized:`);
        console.log(`  - T${MAX_DEGREE} truncation (${NUM_COEFFICIENTS} coefficients)`);
        console.log(`  - ${NUM_LEVELS} pressure levels × ${NUM_VARIABLES} variables`);
        console.log(`  - Buffer size: ${(bufferSize / 1024).toFixed(1)}KB`);
    }
    
    /**
     * Initialize coefficient buffer with realistic patterns
     */
    _initializeCoefficients() {
        // Initialize with dominant weather modes
        for (let level = 0; level < NUM_LEVELS; level++) {
            for (let varIdx = 0; varIdx < NUM_VARIABLES; varIdx++) {
                for (let l = 0; l <= MAX_DEGREE; l++) {
                    for (let m = -l; m <= l; m++) {
                        const idx = this._coeffIndex(l, m, level, varIdx);
                        
                        // Power spectrum: energy decreases with l
                        const powerSpectrum = 1.0 / Math.pow(l + 1, 2);
                        
                        // Random initial phase
                        const phase = random() * 2 * Math.PI;
                        const amplitude = Math.sqrt(powerSpectrum) * (0.5 + random());
                        
                        // Zonal modes (m=0) are stronger (jet streams)
                        const zonalBoost = (m === 0) ? 3.0 : 1.0;
                        
                        // Rossby wave modes (l=4-8) are stronger
                        const rossbyBoost = (l >= 4 && l <= 8) ? 2.0 : 1.0;
                        
                        const finalAmp = amplitude * zonalBoost * rossbyBoost;
                        
                        // Store complex coefficient (real, imag)
                        this.coefficients[idx * 2] = finalAmp * Math.cos(phase);
                        this.coefficients[idx * 2 + 1] = finalAmp * Math.sin(phase);
                    }
                }
            }
        }
    }
    
    /**
     * Get coefficient buffer index
     */
    _coeffIndex(l, m, level, varIdx) {
        const lmIndex = l * l + l + m;  // 0 to 483
        return lmIndex + 
               NUM_COEFFICIENTS * varIdx +
               NUM_COEFFICIENTS * NUM_VARIABLES * level;
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        
        data[0] = this.time;
        data[1] = 1/60;  // deltaTime (assume 60fps)
        data[2] = this.seasonalPhase;
        data[3] = this.planetRadius;
        
        data[4] = this.rotationRate;
        data[5] = ROSSBY_BETA * (this.planetRadius / EARTH_RADIUS);
        data[6] = this.dissipationRate;
        data[7] = this.forcingStrength;
        
        // Camera position (for local weather query)
        data[8] = 0;   // latitude
        data[9] = 0;   // longitude
        data[10] = 0;  // padding
        data[11] = 0;  // padding
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Evolve weather coefficients (CPU fallback)
     * @param {number} deltaTime - Time step in seconds
     */
    evolve(deltaTime) {
        this.time += deltaTime;
        
        // Seasonal cycle (1 game day = 6 hours, so ~4 game days per real hour)
        // Annual cycle: 365 game days
        const gameHoursPerRealSecond = 1;  // Configurable
        const gameDaysElapsed = (this.time * gameHoursPerRealSecond) / 6;
        this.seasonalPhase = (gameDaysElapsed / 365) % 1;
        
        // Evolve coefficients with Rossby wave dynamics
        for (let level = 0; level < NUM_LEVELS; level++) {
            for (let l = 1; l <= MAX_DEGREE; l++) {  // Skip l=0 (mean)
                // Rossby frequency for this mode
                const omega = this._rossbyFrequency(l);
                const phase = omega * deltaTime;
                
                for (let m = -l; m <= l; m++) {
                    // Rotate complex coefficient by phase
                    const cosP = Math.cos(phase);
                    const sinP = Math.sin(phase);
                    
                    for (let varIdx = 0; varIdx < NUM_VARIABLES; varIdx++) {
                        const idx = this._coeffIndex(l, m, level, varIdx);
                        
                        const real = this.coefficients[idx * 2];
                        const imag = this.coefficients[idx * 2 + 1];
                        
                        // Rotation in complex plane (westward propagation)
                        this.coefficients[idx * 2] = real * cosP - imag * sinP;
                        this.coefficients[idx * 2 + 1] = real * sinP + imag * cosP;
                        
                        // Apply dissipation
                        const dissipation = Math.exp(-this.dissipationRate * deltaTime * l);
                        this.coefficients[idx * 2] *= dissipation;
                        this.coefficients[idx * 2 + 1] *= dissipation;
                    }
                }
            }
        }
        
        // Upload evolved coefficients
        if (this.device) {
            this.device.queue.writeBuffer(this.coefficientBuffer, 0, this.coefficients);
        }
        
        this.updateUniforms();
    }
    
    /**
     * Rossby wave frequency
     */
    _rossbyFrequency(l) {
        const k = l / this.planetRadius;
        const Rd = this.planetRadius / 10;  // Deformation radius
        const beta = ROSSBY_BETA * (this.planetRadius / EARTH_RADIUS);
        
        return -beta * k / (k * k + 1 / (Rd * Rd));
    }
    
    /**
     * Sample weather at a point (CPU)
     * @param {number} latitude - Latitude in radians
     * @param {number} longitude - Longitude in radians
     * @param {number} level - Pressure level index (0-4)
     * @returns {Object} {u, v, T, q} weather variables
     */
    sampleWeather(latitude, longitude, level = 0) {
        const theta = Math.PI / 2 - latitude;  // Colatitude
        const phi = longitude;
        
        const result = { u: 0, v: 0, T: 0, q: 0 };
        const varNames = ['u', 'v', 'T', 'q'];
        
        // Sum spherical harmonic contributions
        for (let l = 0; l <= MAX_DEGREE; l++) {
            for (let m = -l; m <= l; m++) {
                // Compute Y_l^m(θ, φ)
                const Ylm = this._realSphericalHarmonic(l, m, theta, phi);
                
                for (let varIdx = 0; varIdx < NUM_VARIABLES; varIdx++) {
                    const idx = this._coeffIndex(l, m, level, varIdx);
                    const coefReal = this.coefficients[idx * 2];
                    const coefImag = this.coefficients[idx * 2 + 1];
                    
                    // Real part of complex product
                    result[varNames[varIdx]] += coefReal * Ylm.real + coefImag * Ylm.imag;
                }
            }
        }
        
        // Scale to physical units
        result.u *= 30;   // m/s
        result.v *= 30;   // m/s
        result.T = 288 + result.T * 30;  // Kelvin (base 288K ≈ 15°C)
        result.q = Math.max(0, 0.01 + result.q * 0.02);  // kg/kg (humidity)
        
        return result;
    }
    
    /**
     * Real spherical harmonic Y_l^m(θ, φ)
     */
    _realSphericalHarmonic(l, m, theta, phi) {
        const absM = Math.abs(m);
        const cosTheta = Math.cos(theta);
        
        const norm = sphericalHarmonicNorm(l, m);
        const plm = this._associatedLegendre(l, absM, cosTheta);
        
        const mPhi = absM * phi;
        
        if (m >= 0) {
            return { real: norm * plm * Math.cos(mPhi), imag: 0 };
        } else {
            return { real: 0, imag: norm * plm * Math.sin(mPhi) };
        }
    }
    
    /**
     * Associated Legendre polynomial P_l^m(x)
     */
    _associatedLegendre(l, m, x) {
        if (m > l) return 0;
        
        // P_m^m
        let pmm = 1;
        if (m > 0) {
            const somx2 = Math.sqrt((1 - x) * (1 + x));
            let fact = 1;
            for (let i = 1; i <= m; i++) {
                pmm *= -fact * somx2;
                fact += 2;
            }
        }
        
        if (l === m) return pmm;
        
        // P_{m+1}^m
        let pmmp1 = x * (2 * m + 1) * pmm;
        if (l === m + 1) return pmmp1;
        
        // Recurrence
        let pll = 0;
        for (let ll = m + 2; ll <= l; ll++) {
            pll = (x * (2 * ll - 1) * pmmp1 - (ll + m - 1) * pmm) / (ll - m);
            pmm = pmmp1;
            pmmp1 = pll;
        }
        
        return pll;
    }
    
    /**
     * Get wind vector for cloud advection
     * @param {number} latitude - Radians
     * @param {number} longitude - Radians
     * @returns {number[]} [u, v] wind components in m/s
     */
    getWindVector(latitude, longitude) {
        const weather = this.sampleWeather(latitude, longitude, 1);  // 850 hPa level
        return [weather.u, weather.v];
    }
    
    /**
     * Get temperature for cloud formation
     * @param {number} latitude - Radians
     * @param {number} longitude - Radians
     * @param {number} level - Pressure level (0-4)
     * @returns {number} Temperature in Kelvin
     */
    getTemperature(latitude, longitude, level = 0) {
        return this.sampleWeather(latitude, longitude, level).T;
    }
    
    /**
     * Get humidity for precipitation
     */
    getHumidity(latitude, longitude, level = 0) {
        return this.sampleWeather(latitude, longitude, level).q;
    }
    
    /**
     * Get coefficient buffer for GPU access
     */
    getCoefficientBuffer() {
        return this.coefficientBuffer;
    }
    
    /**
     * Get uniform buffer
     */
    getUniformBuffer() {
        return this.uniformBuffer;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
        this.coefficientBuffer?.destroy();
        this.initialized = false;
    }
}

export default SpectralWeather;
