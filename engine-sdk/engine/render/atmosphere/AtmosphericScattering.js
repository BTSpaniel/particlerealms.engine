// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AtmosphericScattering.js - Physical Rayleigh/Mie Scattering
 * Now powered by vGPU driver
 * 
 * Implements physically-based atmospheric scattering based on:
 * - Rayleigh scattering (λ⁻⁴) for molecular scattering (blue sky)
 * - Mie scattering for aerosols/particles (haze, fog)
 * - Koschmieder's Law for contrast-based visibility
 * 
 * Based on research from "The Optical Horizon" analysis.
 * 
 * Key formulas:
 * - Rayleigh: σ ∝ λ⁻⁴ (blue scatters more)
 * - Koschmieder: Cv = C0 * e^(-β * x)
 * - Visibility limit: V = -ln(ε) / β (where ε ≈ 0.02)
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Physical constants
const RAYLEIGH_SCALE_HEIGHT = 8500;  // meters (Earth-like)
const MIE_SCALE_HEIGHT = 1200;       // meters
const EARTH_RADIUS = 6371000;        // meters

// Wavelengths in nanometers
const WAVELENGTH_R = 680;  // Red
const WAVELENGTH_G = 550;  // Green
const WAVELENGTH_B = 440;  // Blue

// Rayleigh scattering coefficients at sea level (per meter)
// These are proportional to λ⁻⁴
const RAYLEIGH_BETA_R = 5.8e-6;
const RAYLEIGH_BETA_G = 13.5e-6;
const RAYLEIGH_BETA_B = 33.1e-6;

// Mie scattering coefficient (wavelength-independent for large particles)
const MIE_BETA = 21e-6;

// WGSL shader code for atmospheric scattering
export const ATMOSPHERIC_SCATTERING_WGSL = /* wgsl */ `
// Atmospheric scattering uniforms
struct AtmosphereUniforms {
    // Rayleigh coefficients (RGB)
    rayleighBeta: vec3<f32>,
    rayleighScaleHeight: f32,
    
    // Mie coefficients
    mieBeta: f32,
    mieScaleHeight: f32,
    mieG: f32,  // Asymmetry parameter (-1 to 1)
    
    // Planet parameters
    planetRadius: f32,
    atmosphereHeight: f32,
    
    // Visibility parameters
    visibility: f32,         // Meteorological visibility in meters
    contrastThreshold: f32,  // Usually 0.02 (2%)
    
    // Sun direction
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    
    // Camera height above surface
    cameraHeight: f32,
    
    // Refraction coefficient (standard: 0.13-0.17)
    refractionK: f32,
    _pad: vec2<f32>,
}

// Rayleigh phase function
fn rayleighPhase(cosTheta: f32) -> f32 {
    return 0.75 * (1.0 + cosTheta * cosTheta);
}

// Mie phase function (Henyey-Greenstein)
fn miePhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let num = (1.0 - g2);
    let denom = pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return (3.0 / (8.0 * 3.14159265)) * num / denom;
}

// Optical depth for exponential atmosphere
fn opticalDepth(height: f32, scaleHeight: f32, distance: f32) -> f32 {
    // Simplified: assumes roughly constant altitude along ray
    return exp(-height / scaleHeight) * distance;
}

// Koschmieder's Law: contrast at distance
fn koschmiederContrast(inherentContrast: f32, extinctionCoeff: f32, distance: f32) -> f32 {
    return inherentContrast * exp(-extinctionCoeff * distance);
}

// Calculate visibility limit from extinction coefficient
fn visibilityLimit(extinctionCoeff: f32, threshold: f32) -> f32 {
    return -log(threshold) / extinctionCoeff;
}

// Calculate extinction coefficient from visibility
fn extinctionFromVisibility(visibility: f32, threshold: f32) -> f32 {
    return -log(threshold) / visibility;
}

// Main atmospheric scattering calculation
fn calculateAtmosphericScattering(
    fragColor: vec3<f32>,
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    atm: AtmosphereUniforms
) -> vec3<f32> {
    let viewDir = normalize(worldPos - cameraPos);
    let distance = length(worldPos - cameraPos);
    
    // Calculate extinction coefficient from visibility
    let beta = extinctionFromVisibility(atm.visibility, atm.contrastThreshold);
    
    // Rayleigh scattering (wavelength-dependent)
    let rayleighOpticalDepth = opticalDepth(atm.cameraHeight, atm.rayleighScaleHeight, distance);
    let rayleighExtinction = exp(-atm.rayleighBeta * rayleighOpticalDepth);
    
    // Mie scattering
    let mieOpticalDepth = opticalDepth(atm.cameraHeight, atm.mieScaleHeight, distance);
    let mieExtinction = exp(-vec3<f32>(atm.mieBeta) * mieOpticalDepth);
    
    // Combined extinction
    let totalExtinction = rayleighExtinction * mieExtinction;
    
    // Sun angle for scattering
    let cosTheta = dot(viewDir, atm.sunDirection);
    
    // In-scattering (airlight) - light scattered INTO the view ray
    let rayleighInscatter = atm.rayleighBeta * rayleighPhase(cosTheta) * (1.0 - rayleighExtinction);
    let mieInscatter = vec3<f32>(atm.mieBeta) * miePhase(cosTheta, atm.mieG) * (1.0 - mieExtinction);
    
    // Sky color from inscattering
    let inscatter = (rayleighInscatter + mieInscatter) * atm.sunIntensity;
    
    // Apply extinction and add inscattering
    let finalColor = fragColor * totalExtinction + inscatter;
    
    return finalColor;
}

// Simplified fog with Koschmieder contrast
fn applyKoschmiederFog(
    fragColor: vec3<f32>,
    fogColor: vec3<f32>,
    distance: f32,
    visibility: f32,
    threshold: f32
) -> vec3<f32> {
    let beta = extinctionFromVisibility(visibility, threshold);
    let contrast = exp(-beta * distance);
    return mix(fogColor, fragColor, contrast);
}

// Calculate effective horizon distance with refraction
fn effectiveHorizon(observerHeight: f32, planetRadius: f32, refractionK: f32) -> f32 {
    // d = sqrt(2 * R' * h) where R' = R / (1 - k)
    let effectiveRadius = planetRadius / (1.0 - refractionK);
    return sqrt(2.0 * effectiveRadius * observerHeight);
}
`;

/**
 * AtmosphericScattering - Physical atmosphere simulation
 */
export class AtmosphericScattering {
    constructor() {
        this.enabled = true;
        this.vgpu = null;
        
        // Planet parameters
        this.planetRadius = 424000;  // 424 km in meters
        this.atmosphereHeight = 100000; // 100 km atmosphere
        
        // Rayleigh scattering (molecular)
        this.rayleighBeta = [RAYLEIGH_BETA_R, RAYLEIGH_BETA_G, RAYLEIGH_BETA_B];
        this.rayleighScaleHeight = RAYLEIGH_SCALE_HEIGHT;
        
        // Mie scattering (aerosols)
        this.mieBeta = MIE_BETA;
        this.mieScaleHeight = MIE_SCALE_HEIGHT;
        this.mieG = 0.76;  // Forward scattering asymmetry
        
        // Visibility (meteorological)
        this.visibility = 50000;  // 50 km standard visibility
        this.contrastThreshold = 0.02;  // 2% contrast threshold
        
        // Sun parameters
        this.sunDirection = [0.5, 0.8, 0.3];
        this.sunIntensity = 20.0;
        
        // Observer
        this.cameraHeight = 1.7;  // meters
        
        // Refraction coefficient (0.13-0.17 standard, up to 1.0 for mirages)
        this.refractionK = 0.14;
        
        // GPU resources
        this.uniformBuffer = null;
        this.device = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(20);
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     */
    init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create uniform buffer using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 80, usage: 'uniform', label: 'AtmosphericScatteringUniforms' }).buffer;
        
        this.updateUniforms();
        console.log(`[AtmosphericScattering] Initialized with vGPU for planet R=${this.planetRadius/1000}km`);
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        
        // Rayleigh
        data[0] = this.rayleighBeta[0];
        data[1] = this.rayleighBeta[1];
        data[2] = this.rayleighBeta[2];
        data[3] = this.rayleighScaleHeight;
        
        // Mie
        data[4] = this.mieBeta;
        data[5] = this.mieScaleHeight;
        data[6] = this.mieG;
        data[7] = this.planetRadius;
        
        // Atmosphere
        data[8] = this.atmosphereHeight;
        data[9] = this.visibility;
        data[10] = this.contrastThreshold;
        data[11] = 0;  // padding
        
        // Sun
        data[12] = this.sunDirection[0];
        data[13] = this.sunDirection[1];
        data[14] = this.sunDirection[2];
        data[15] = this.sunIntensity;
        
        // Camera/Refraction
        data[16] = this.cameraHeight;
        data[17] = this.refractionK;
        data[18] = 0;  // padding
        data[19] = 0;  // padding
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Set planet radius
     * @param {number} radiusKm - Radius in kilometers
     */
    setPlanetRadius(radiusKm) {
        this.planetRadius = radiusKm * 1000;  // Convert to meters
        this.updateUniforms();
    }
    
    /**
     * Set meteorological visibility
     * @param {number} visibilityKm - Visibility in kilometers
     */
    setVisibility(visibilityKm) {
        this.visibility = visibilityKm * 1000;
        this.updateUniforms();
    }
    
    /**
     * Set sun direction (normalized)
     * @param {Array} dir - [x, y, z]
     */
    setSunDirection(dir) {
        const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);
        this.sunDirection = [dir[0]/len, dir[1]/len, dir[2]/len];
        this.updateUniforms();
    }
    
    /**
     * Set camera height above surface
     * @param {number} height - Height in meters
     */
    setCameraHeight(height) {
        this.cameraHeight = height;
        this.updateUniforms();
    }
    
    /**
     * Calculate geometric horizon distance
     * @param {number} observerHeight - Height in meters
     * @returns {number} - Distance in meters
     */
    getGeometricHorizon(observerHeight = this.cameraHeight) {
        // d = sqrt(2 * R * h + h²) ≈ sqrt(2 * R * h) for small h
        return Math.sqrt(2 * this.planetRadius * observerHeight + observerHeight ** 2);
    }
    
    /**
     * Calculate effective horizon with refraction
     * @param {number} observerHeight - Height in meters
     * @returns {number} - Distance in meters
     */
    getEffectiveHorizon(observerHeight = this.cameraHeight) {
        // R' = R / (1 - k)
        const effectiveRadius = this.planetRadius / (1 - this.refractionK);
        return Math.sqrt(2 * effectiveRadius * observerHeight);
    }
    
    /**
     * Calculate Rayleigh scattering limit (~300km on Earth)
     * @returns {number} - Maximum visibility in meters
     */
    getRayleighLimit() {
        // V = -ln(ε) / β where β is the combined extinction coefficient
        const avgBeta = (this.rayleighBeta[0] + this.rayleighBeta[1] + this.rayleighBeta[2]) / 3;
        return -Math.log(this.contrastThreshold) / avgBeta;
    }
    
    /**
     * Calculate Koschmieder visibility
     * @returns {number} - Visibility limit in meters
     */
    getKoschmiederVisibility() {
        const extinctionCoeff = -Math.log(this.contrastThreshold) / this.visibility;
        return -Math.log(this.contrastThreshold) / extinctionCoeff;
    }
    
    /**
     * Apply atmospheric scattering to a color (CPU-side)
     * @param {Array} color - [r, g, b]
     * @param {number} distance - Distance in meters
     * @returns {Array} - [r, g, b]
     */
    applyScattering(color, distance) {
        // Simplified CPU implementation
        const beta = -Math.log(this.contrastThreshold) / this.visibility;
        const extinction = Math.exp(-beta * distance);
        
        // Sky color approximation (blue-shifted)
        const skyColor = [0.5, 0.7, 1.0];
        
        return [
            color[0] * extinction + skyColor[0] * (1 - extinction),
            color[1] * extinction + skyColor[1] * (1 - extinction),
            color[2] * extinction + skyColor[2] * (1 - extinction),
        ];
    }
    
    /**
     * Get visibility info for debugging
     */
    getVisibilityInfo() {
        const geoHorizon = this.getGeometricHorizon();
        const effHorizon = this.getEffectiveHorizon();
        const rayleighLimit = this.getRayleighLimit();
        
        return {
            planetRadiusKm: this.planetRadius / 1000,
            geometricHorizonKm: geoHorizon / 1000,
            effectiveHorizonKm: effHorizon / 1000,
            rayleighLimitKm: rayleighLimit / 1000,
            meteorologicalVisibilityKm: this.visibility / 1000,
            actualLimitKm: Math.min(effHorizon, this.visibility, rayleighLimit) / 1000,
            refractionExtension: ((effHorizon / geoHorizon) - 1) * 100,  // % extension
        };
    }
    
    /**
     * Set weather conditions
     * @param {string} condition - 'clear', 'hazy', 'foggy', 'rain'
     */
    setWeatherCondition(condition) {
        switch (condition) {
            case 'clear':
                this.visibility = 50000;
                this.mieBeta = MIE_BETA;
                break;
            case 'hazy':
                this.visibility = 15000;
                this.mieBeta = MIE_BETA * 3;
                break;
            case 'foggy':
                this.visibility = 1000;
                this.mieBeta = MIE_BETA * 20;
                break;
            case 'rain':
                this.visibility = 5000;
                this.mieBeta = MIE_BETA * 10;
                break;
        }
        this.updateUniforms();
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
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [atmospheric_scattering] section
     * @param {Object} planetCfg - Config from [planet] section
     */
    loadConfig(cfg, planetCfg) {
        if (planetCfg) {
            this.setPlanetRadius(parseFloat(planetCfg.radius_km) || 424);
            this.atmosphereHeight = (parseFloat(planetCfg.atmosphere_height_km) || 100) * 1000;
        }
        
        if (cfg) {
            this.enabled = cfg.enabled !== false;
            this.setVisibility(parseFloat(cfg.visibility_km) || 50);
            this.rayleighScaleHeight = parseFloat(cfg.rayleigh_scale_height) || 8500;
            this.mieScaleHeight = parseFloat(cfg.mie_scale_height) || 1200;
            this.mieG = parseFloat(cfg.mie_g) || 0.76;
            this.sunIntensity = parseFloat(cfg.sun_intensity) || 20.0;
        }
        
        this.updateUniforms();
    }
    
    /**
     * Get WGSL shader code
     */
    static getShaderCode() {
        return ATMOSPHERIC_SCATTERING_WGSL;
    }
    
    // ========================================================================
    // LUT PRECOMPUTATION (Section 2.3.1 of Bruneton/Nishita)
    // ========================================================================
    
    /**
     * Precompute transmittance LUT texture
     * Maps (altitude, view zenith angle) -> transmittance RGB
     * Reduces per-pixel scattering calculation to a single texture fetch
     * @param {number} width - LUT width (altitude resolution)
     * @param {number} height - LUT height (angle resolution)
     */
    createTransmittanceLUT(width = 256, height = 64) {
        if (!this.device) return null;
        
        // Create texture
        const texture = this.vgpu.texture.create({
            width, height, format: 'rgba16float',
            usage: 'texture|copy-dst', label: 'TransmittanceLUT'
        }).texture;
        
        // Precompute transmittance values on CPU
        const data = new Float32Array(width * height * 4);
        
        for (let y = 0; y < height; y++) {
            // View zenith angle: 0 (horizon) to PI/2 (zenith)
            const cosViewZenith = y / (height - 1);  // 0 to 1
            const viewZenith = Math.acos(cosViewZenith);
            
            for (let x = 0; x < width; x++) {
                // Altitude: 0 to atmosphere height
                const altitude = (x / (width - 1)) * this.atmosphereHeight;
                
                // Calculate optical depth along ray
                const { transmittance } = this.computeOpticalDepth(altitude, viewZenith);
                
                const idx = (y * width + x) * 4;
                data[idx + 0] = transmittance[0];
                data[idx + 1] = transmittance[1];
                data[idx + 2] = transmittance[2];
                data[idx + 3] = 1.0;
            }
        }
        
        // Upload to GPU
        this.device.queue.writeTexture(
            { texture },
            data,
            { bytesPerRow: width * 16, rowsPerImage: height },
            { width, height, depthOrArrayLayers: 1 }
        );
        
        this.transmittanceLUT = texture;
        this.transmittanceLUTView = texture.createView();
        
        console.log(`[AtmosphericScattering] Transmittance LUT created: ${width}x${height}`);
        return texture;
    }
    
    /**
     * Precompute inscattering LUT texture
     * Maps (altitude, sun zenith, view-sun angle) -> inscattered light RGB
     * 3D texture for full angular coverage
     * @param {number} size - LUT size per dimension
     */
    createInscatteringLUT(size = 32) {
        if (!this.device) return null;
        
        // Create 3D texture
        const texture = this.vgpu.texture.create({
            width: size, height: size, depth: size,
            format: 'rgba16float', usage: 'texture|copy-dst',
            label: 'InscatteringLUT'
        }).texture;
        
        // Precompute inscattering values
        const data = new Float32Array(size * size * size * 4);
        
        for (let z = 0; z < size; z++) {
            // View-sun angle: -1 to 1 (cos theta)
            const cosTheta = (z / (size - 1)) * 2 - 1;
            
            for (let y = 0; y < size; y++) {
                // Sun zenith: 0 to PI (horizon to below)
                const sunZenith = (y / (size - 1)) * Math.PI;
                const cosSunZenith = Math.cos(sunZenith);
                
                for (let x = 0; x < size; x++) {
                    // Altitude: 0 to atmosphere height
                    const altitude = (x / (size - 1)) * this.atmosphereHeight;
                    
                    // Calculate inscattering
                    const inscatter = this.computeInscattering(altitude, cosSunZenith, cosTheta);
                    
                    const idx = (z * size * size + y * size + x) * 4;
                    data[idx + 0] = inscatter[0];
                    data[idx + 1] = inscatter[1];
                    data[idx + 2] = inscatter[2];
                    data[idx + 3] = 1.0;
                }
            }
        }
        
        // Upload to GPU
        this.device.queue.writeTexture(
            { texture },
            data,
            { bytesPerRow: size * 16, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: size }
        );
        
        this.inscatteringLUT = texture;
        this.inscatteringLUTView = texture.createView();
        
        console.log(`[AtmosphericScattering] Inscattering LUT created: ${size}x${size}x${size}`);
        return texture;
    }
    
    /**
     * Compute optical depth and transmittance for LUT
     * @param {number} altitude - Observer altitude in meters
     * @param {number} viewZenith - View zenith angle in radians
     * @returns {Object} - { opticalDepth, transmittance }
     */
    computeOpticalDepth(altitude, viewZenith) {
        // Raymarching through atmosphere
        const numSamples = 16;
        const cosViewZenith = Math.cos(viewZenith);
        
        // Ray from altitude to atmosphere edge
        const rayLength = this.computeRayLength(altitude, cosViewZenith);
        const stepSize = rayLength / numSamples;
        
        let opticalDepthR = [0, 0, 0];
        let opticalDepthM = 0;
        
        for (let i = 0; i < numSamples; i++) {
            const t = (i + 0.5) * stepSize;
            const sampleAlt = altitude + t * cosViewZenith;
            
            // Rayleigh density at this altitude
            const densityR = Math.exp(-sampleAlt / this.rayleighScaleHeight);
            opticalDepthR[0] += this.rayleighBeta[0] * densityR * stepSize;
            opticalDepthR[1] += this.rayleighBeta[1] * densityR * stepSize;
            opticalDepthR[2] += this.rayleighBeta[2] * densityR * stepSize;
            
            // Mie density at this altitude
            const densityM = Math.exp(-sampleAlt / this.mieScaleHeight);
            opticalDepthM += this.mieBeta * densityM * stepSize;
        }
        
        // Transmittance = exp(-optical_depth)
        const transmittance = [
            Math.exp(-(opticalDepthR[0] + opticalDepthM)),
            Math.exp(-(opticalDepthR[1] + opticalDepthM)),
            Math.exp(-(opticalDepthR[2] + opticalDepthM)),
        ];
        
        return { opticalDepth: opticalDepthR, transmittance };
    }
    
    /**
     * Compute inscattered light for LUT
     * @param {number} altitude - Observer altitude
     * @param {number} cosSunZenith - Cosine of sun zenith angle
     * @param {number} cosTheta - Cosine of view-sun angle
     * @returns {Array} - [r, g, b] inscattered light
     */
    computeInscattering(altitude, cosSunZenith, cosTheta) {
        // Rayleigh phase function
        const rayleighPhase = 0.75 * (1 + cosTheta * cosTheta);
        
        // Mie phase function (Henyey-Greenstein)
        const g = this.mieG;
        const g2 = g * g;
        const miePhase = (1 - g2) / Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
        
        // Density at altitude
        const densityR = Math.exp(-altitude / this.rayleighScaleHeight);
        const densityM = Math.exp(-altitude / this.mieScaleHeight);
        
        // Sun visibility factor (below horizon = 0)
        const sunFactor = Math.max(0, cosSunZenith);
        
        // Inscattering contribution
        const inscatter = [
            (this.rayleighBeta[0] * densityR * rayleighPhase + this.mieBeta * densityM * miePhase) * sunFactor * this.sunIntensity,
            (this.rayleighBeta[1] * densityR * rayleighPhase + this.mieBeta * densityM * miePhase) * sunFactor * this.sunIntensity,
            (this.rayleighBeta[2] * densityR * rayleighPhase + this.mieBeta * densityM * miePhase) * sunFactor * this.sunIntensity,
        ];
        
        return inscatter;
    }
    
    /**
     * Compute ray length through atmosphere
     * @param {number} altitude - Starting altitude
     * @param {number} cosZenith - Cosine of zenith angle
     * @returns {number} - Ray length in meters
     */
    computeRayLength(altitude, cosZenith) {
        const r = this.planetRadius + altitude;
        const R = this.planetRadius + this.atmosphereHeight;
        
        // Quadratic for ray-sphere intersection
        // |origin + t*dir|² = R²
        const a = 1;
        const b = 2 * r * cosZenith;
        const c = r * r - R * R;
        
        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) return 0;
        
        const t = (-b + Math.sqrt(discriminant)) / (2 * a);
        return Math.max(0, t);
    }
    
    /**
     * Initialize all LUTs for fast runtime sampling
     */
    initializeLUTs() {
        if (!this.device) return;
        
        this.createTransmittanceLUT(256, 64);
        this.createInscatteringLUT(32);
        
        // Create sampler for LUT access
        this.lutSampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp' });
        
        console.log('[AtmosphericScattering] LUTs initialized for fast runtime sampling');
    }
    
    /**
     * Get LUT bind group entries for shader
     * @param {number} baseBinding - Starting binding number
     * @returns {Array} - Bind group entries
     */
    getLUTBindGroupEntries(baseBinding) {
        if (!this.transmittanceLUTView || !this.inscatteringLUTView || !this.lutSampler) {
            return [];
        }
        
        return [
            { binding: baseBinding, resource: this.lutSampler },
            { binding: baseBinding + 1, resource: this.transmittanceLUTView },
            { binding: baseBinding + 2, resource: this.inscatteringLUTView },
        ];
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
        this.uniformBuffer = null;
        this.transmittanceLUT?.destroy();
        this.transmittanceLUT = null;
        this.inscatteringLUT?.destroy();
        this.inscatteringLUT = null;
    }
}

export default AtmosphericScattering;
