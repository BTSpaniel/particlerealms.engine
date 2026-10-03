// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlanetCurvature.js - Hull-Down Effect & Horizon Rendering
 * Now powered by vGPU driver
 * 
 * Implements planetary curvature effects for a 180,000km radius planet.
 * 
 * Features:
 * - Hull-down effect (objects sink below horizon)
 * - Geometric horizon calculation with refraction
 * - Vertex displacement shader for curvature
 * - Horizon line rendering
 * 
 * For reference (1.7m observer):
 * - Earth (R=6,371km): d ≈ 4.7km
 * - This planet (R=180,000km): d ≈ 24.7km
 * 
 * Formula: d = √(2Rh + h²) ≈ √(2Rh) for small h
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// WGSL shader code for planet curvature
export const PLANET_CURVATURE_WGSL = /* wgsl */ `
struct PlanetCurvatureUniforms {
    // Planet parameters
    planetRadius: f32,           // Planet radius in meters
    refractionCoefficient: f32,  // k factor (0.13-0.17 standard)
    
    // Camera
    cameraHeight: f32,           // Height above surface
    cameraWorldY: f32,           // Absolute camera Y position
    
    // Effect control
    curvatureEnabled: u32,       // Toggle curvature effect
    hullDownEnabled: u32,        // Toggle hull-down culling
    
    // Horizon
    geometricHorizon: f32,       // Distance to geometric horizon
    effectiveHorizon: f32,       // Distance with refraction
    
    // Visual settings
    horizonFadeStart: f32,       // Distance to start fading
    horizonFadeEnd: f32,         // Distance to fully fade
    
    // Drop per distance (precomputed)
    dropPerMeter: f32,           // Meters of drop per meter of distance
    _pad: f32,
}

// Calculate the "drop" due to curvature at a given distance
// This is how much lower an object appears due to Earth's curve
fn calculateCurvatureDrop(distance: f32, planetRadius: f32) -> f32 {
    // Using the exact formula: drop = √(R² + d²) - R
    // Approximation for small d: drop ≈ d² / (2R)
    return (distance * distance) / (2.0 * planetRadius);
}

// Calculate the "hidden height" - how much of an object is below horizon
fn calculateHiddenHeight(
    objectDistance: f32,
    objectHeight: f32,
    observerHeight: f32,
    planetRadius: f32,
    refractionK: f32
) -> f32 {
    // Effective radius with refraction
    let effectiveRadius = planetRadius / (1.0 - refractionK);
    
    // Horizon distance for observer
    let horizonDist = sqrt(2.0 * effectiveRadius * observerHeight);
    
    if (objectDistance <= horizonDist) {
        return 0.0;  // Object is before horizon, fully visible
    }
    
    // Distance beyond horizon
    let beyondHorizon = objectDistance - horizonDist;
    
    // Drop at that distance
    let drop = calculateCurvatureDrop(beyondHorizon, effectiveRadius);
    
    // How much of object is hidden
    return max(0.0, drop - objectHeight);
}

// Check if a point is below the horizon (hull-down)
fn isHullDown(
    objectDistance: f32,
    objectHeightAboveSurface: f32,
    observerHeight: f32,
    planetRadius: f32,
    refractionK: f32
) -> bool {
    let effectiveRadius = planetRadius / (1.0 - refractionK);
    let observerHorizon = sqrt(2.0 * effectiveRadius * observerHeight);
    let objectHorizon = sqrt(2.0 * effectiveRadius * objectHeightAboveSurface);
    
    // Object is visible if combined horizon distances exceed separation
    return objectDistance > (observerHorizon + objectHorizon);
}

// Apply curvature displacement to vertex
fn applyCurvatureDisplacement(
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    curvature: PlanetCurvatureUniforms
) -> vec3<f32> {
    if (curvature.curvatureEnabled == 0u) {
        return worldPos;
    }
    
    // Horizontal distance from camera
    let dx = worldPos.x - cameraPos.x;
    let dz = worldPos.z - cameraPos.z;
    let horizontalDist = sqrt(dx * dx + dz * dz);
    
    // Calculate drop
    let drop = calculateCurvatureDrop(horizontalDist, curvature.planetRadius);
    
    // Displace vertex downward
    return vec3<f32>(worldPos.x, worldPos.y - drop, worldPos.z);
}

// Calculate horizon fade factor for smooth transition
fn horizonFadeFactor(
    distance: f32,
    horizonDist: f32,
    fadeRange: f32
) -> f32 {
    let fadeStart = horizonDist - fadeRange;
    if (distance < fadeStart) {
        return 1.0;
    }
    if (distance > horizonDist) {
        return 0.0;
    }
    return 1.0 - (distance - fadeStart) / fadeRange;
}

// Apply horizon fade to color
fn applyHorizonFade(
    fragColor: vec4<f32>,
    distance: f32,
    curvature: PlanetCurvatureUniforms,
    horizonColor: vec3<f32>
) -> vec4<f32> {
    let factor = horizonFadeFactor(distance, curvature.effectiveHorizon, 
                                    curvature.horizonFadeEnd - curvature.horizonFadeStart);
    
    if (factor <= 0.0) {
        discard;  // Beyond horizon, don't render
    }
    
    // Fade alpha and blend color toward horizon
    return vec4<f32>(
        mix(horizonColor, fragColor.rgb, factor),
        fragColor.a * factor
    );
}
`;

/**
 * PlanetCurvature - Planetary curvature simulation
 */
export class PlanetCurvature {
    constructor() {
        this.enabled = true;
        
        // Planet parameters
        this.planetRadius = 424000;  // 424 km in meters
        this.refractionCoefficient = 0.14;  // Standard atmospheric refraction
        
        // Camera state
        this.cameraHeight = 1.7;  // meters above surface
        this.cameraWorldY = 0;
        
        // Effect toggles
        this.curvatureEnabled = true;
        this.hullDownEnabled = true;
        
        // Precomputed horizon distances
        this.geometricHorizon = 0;
        this.effectiveHorizon = 0;
        
        // Fade settings
        this.horizonFadeStart = 0;
        this.horizonFadeEnd = 0;
        
        // GPU resources
        this.uniformBuffer = null;
        this.device = null;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(12);
        
        // Calculate initial values
        this.recalculateHorizon();
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     */
    init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create uniform buffer using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 48, usage: 'uniform', label: 'PlanetCurvatureUniforms' }).buffer;
        
        this.updateUniforms();
        
        const info = this.getHorizonInfo();
        console.log(`[PlanetCurvature] Initialized: R=${info.planetRadiusKm.toLocaleString()}km, ` +
            `horizon=${info.effectiveHorizonKm.toFixed(1)}km`);
    }
    
    /**
     * Recalculate horizon distances
     */
    recalculateHorizon() {
        // Geometric horizon: d = √(2Rh)
        this.geometricHorizon = Math.sqrt(
            2 * this.planetRadius * this.cameraHeight + 
            this.cameraHeight ** 2
        );
        
        // Effective horizon with refraction: R' = R / (1-k)
        const effectiveRadius = this.planetRadius / (1 - this.refractionCoefficient);
        this.effectiveHorizon = Math.sqrt(
            2 * effectiveRadius * this.cameraHeight + 
            this.cameraHeight ** 2
        );
        
        // Fade distances
        this.horizonFadeStart = this.effectiveHorizon * 0.85;
        this.horizonFadeEnd = this.effectiveHorizon;
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        
        data[0] = this.planetRadius;
        data[1] = this.refractionCoefficient;
        data[2] = this.cameraHeight;
        data[3] = this.cameraWorldY;
        
        data[4] = this.curvatureEnabled ? 1 : 0;
        data[5] = this.hullDownEnabled ? 1 : 0;
        data[6] = this.geometricHorizon;
        data[7] = this.effectiveHorizon;
        
        data[8] = this.horizonFadeStart;
        data[9] = this.horizonFadeEnd;
        
        // Precompute drop per meter: d²/2R for d=1
        data[10] = 1 / (2 * this.planetRadius);
        data[11] = 0;  // padding
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Set planet radius
     * @param {number} radiusKm - Radius in kilometers
     */
    setPlanetRadius(radiusKm) {
        this.planetRadius = radiusKm * 1000;
        this.recalculateHorizon();
        this.updateUniforms();
    }
    
    /**
     * Set camera height above surface
     * @param {number} height - Height in meters
     */
    setCameraHeight(height) {
        this.cameraHeight = height;
        this.recalculateHorizon();
        this.updateUniforms();
    }
    
    /**
     * Set refraction coefficient
     * @param {number} k - Coefficient (0.13-0.17 standard, up to 1.0 for mirages)
     */
    setRefractionCoefficient(k) {
        this.refractionCoefficient = Math.max(0, Math.min(0.99, k));
        this.recalculateHorizon();
        this.updateUniforms();
    }
    
    /**
     * Calculate curvature drop at a distance (CPU-side)
     * @param {number} distance - Horizontal distance in meters
     * @returns {number} - Drop in meters
     */
    calculateDrop(distance) {
        // drop = d² / (2R)
        return (distance ** 2) / (2 * this.planetRadius);
    }
    
    /**
     * Calculate hidden height of an object (CPU-side)
     * @param {number} objectDistance - Distance to object in meters
     * @param {number} objectHeight - Object height in meters
     * @returns {number} - Hidden portion in meters (0 if fully visible)
     */
    calculateHiddenHeight(objectDistance, objectHeight) {
        const effectiveRadius = this.planetRadius / (1 - this.refractionCoefficient);
        const horizonDist = Math.sqrt(2 * effectiveRadius * this.cameraHeight);
        
        if (objectDistance <= horizonDist) {
            return 0;  // Before horizon
        }
        
        // Distance beyond observer's horizon
        const beyondHorizon = objectDistance - horizonDist;
        
        // Drop at that distance
        const drop = (beyondHorizon ** 2) / (2 * effectiveRadius);
        
        // Hidden height
        return Math.max(0, drop - objectHeight);
    }
    
    /**
     * Check if an object is completely below horizon (hull-down)
     * @param {number} objectDistance - Distance in meters
     * @param {number} objectHeight - Object height above surface in meters
     * @returns {boolean}
     */
    isHullDown(objectDistance, objectHeight) {
        const effectiveRadius = this.planetRadius / (1 - this.refractionCoefficient);
        
        // Observer's horizon distance
        const observerHorizon = Math.sqrt(2 * effectiveRadius * this.cameraHeight);
        
        // Object's horizon distance (how far it can "see" back)
        const objectHorizon = Math.sqrt(2 * effectiveRadius * objectHeight);
        
        // Object is visible if combined horizons exceed distance
        return objectDistance > (observerHorizon + objectHorizon);
    }
    
    /**
     * Get visible fraction of an object
     * @param {number} objectDistance 
     * @param {number} objectHeight 
     * @returns {number} - 0-1 (1 = fully visible)
     */
    getVisibleFraction(objectDistance, objectHeight) {
        const hidden = this.calculateHiddenHeight(objectDistance, objectHeight);
        if (hidden >= objectHeight) return 0;
        return 1 - (hidden / objectHeight);
    }
    
    /**
     * Apply curvature displacement to a world position
     * @param {Array} worldPos - [x, y, z]
     * @param {Array} cameraPos - [x, y, z]
     * @returns {Array} - Displaced [x, y, z]
     */
    applyDisplacement(worldPos, cameraPos) {
        if (!this.curvatureEnabled) return [...worldPos];
        
        const dx = worldPos[0] - cameraPos[0];
        const dz = worldPos[2] - cameraPos[2];
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);
        
        const drop = this.calculateDrop(horizontalDist);
        
        return [worldPos[0], worldPos[1] - drop, worldPos[2]];
    }
    
    /**
     * Get horizon information
     */
    getHorizonInfo() {
        const dropAt1km = this.calculateDrop(1000);
        const dropAt10km = this.calculateDrop(10000);
        const dropAtHorizon = this.calculateDrop(this.effectiveHorizon);
        
        return {
            planetRadiusKm: this.planetRadius / 1000,
            observerHeightM: this.cameraHeight,
            refractionK: this.refractionCoefficient,
            geometricHorizonKm: this.geometricHorizon / 1000,
            effectiveHorizonKm: this.effectiveHorizon / 1000,
            refractionExtensionPercent: ((this.effectiveHorizon / this.geometricHorizon) - 1) * 100,
            dropAt1kmM: dropAt1km,
            dropAt10kmM: dropAt10km,
            dropAtHorizonM: dropAtHorizon,
        };
    }
    
    /**
     * Comparison with Earth
     */
    getEarthComparison() {
        const earthRadius = 6371000;  // meters
        const earthGeoHorizon = Math.sqrt(2 * earthRadius * this.cameraHeight);
        const earthEffHorizon = Math.sqrt(2 * (earthRadius / (1 - 0.14)) * this.cameraHeight);
        
        return {
            thisWorld: {
                radiusKm: this.planetRadius / 1000,
                horizonKm: this.effectiveHorizon / 1000,
            },
            earth: {
                radiusKm: earthRadius / 1000,
                horizonKm: earthEffHorizon / 1000,
            },
            ratio: {
                radius: this.planetRadius / earthRadius,
                horizon: this.effectiveHorizon / earthEffHorizon,
            },
        };
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
     * @param {Object} cfg - Config from [planet_curvature] section
     * @param {Object} planetCfg - Config from [planet] section
     */
    loadConfig(cfg, planetCfg) {
        if (planetCfg) {
            this.setPlanetRadius(parseFloat(planetCfg.radius_km) || 424);
            this.setRefractionCoefficient(parseFloat(planetCfg.refraction_coefficient) || 0.14);
        }
        
        if (cfg) {
            this.enabled = cfg.enabled !== false;
            this.curvatureEnabled = cfg.enabled !== false;
            this.hullDownEnabled = cfg.hull_down !== false;
        }
        
        this.updateUniforms();
    }
    
    /**
     * Get WGSL shader code
     */
    static getShaderCode() {
        return PLANET_CURVATURE_WGSL;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
        this.uniformBuffer = null;
    }
}

export default PlanetCurvature;
