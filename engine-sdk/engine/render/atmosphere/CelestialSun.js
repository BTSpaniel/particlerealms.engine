// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CelestialSun.js - Sun configuration and rendering
 * Customizable sun properties for the procedural sky
 */

/**
 * Sun configuration defaults
 * 
 * Time Integration:
 * - Sun position is calculated from gameTime (from TimeController)
 * - When time is rewound/slowed, sun moves accordingly
 * - orbitPeriod defines how many seconds for one full day
 */
import { degreesToRadians } from '../../core/math/UnitMath.js';

export const SunDefaults = {
    // Orbital parameters
    orbitPeriod: 6 * 60 * 60,       // Day length in seconds (6 hours = 1 day, matches ProceduralSky)
    orbitTilt: 23.5,                // Axial tilt in degrees
    startAngle: Math.PI * 0.5,      // Starting position (sunrise)
    
    // Visual properties
    angularRadius: 0.08,            // Angular radius (~4.5 degrees, larger for visibility)
    color: [1.0, 0.95, 0.8],        // Sun color (warm white)
    intensity: 25.0,                // Sun intensity for scattering
    coronaSize: 2.5,                // Corona glow multiplier
    coronaIntensity: 0.6,           // Corona brightness
    
    // Rendering
    enabled: true,
    castsShadows: true,
};

/**
 * WGSL shader code for sun rendering
 */
export const SunWGSL = `
// Sun disc rendering with corona glow
fn sunDisc(
    direction: vec3<f32>,
    sunDir: vec3<f32>,
    angularRadius: f32,
    sunColor: vec3<f32>,
    intensity: f32
) -> vec3<f32> {
    let cosAngle = dot(direction, sunDir);
    let sunCosRadius = cos(angularRadius);
    
    // Hard sun disc
    if (cosAngle > sunCosRadius) {
        return sunColor * intensity;
    }
    
    // Corona glow (exponential falloff)
    let coronaRadius = angularRadius * 3.0;
    let coronaCosRadius = cos(coronaRadius);
    if (cosAngle > coronaCosRadius) {
        let t = (cosAngle - coronaCosRadius) / (sunCosRadius - coronaCosRadius);
        let glow = pow(t, 3.0);
        return sunColor * intensity * glow * 0.3;
    }
    
    // Atmospheric glow around sun
    let glowRadius = angularRadius * 10.0;
    let glowCosRadius = cos(glowRadius);
    if (cosAngle > glowCosRadius) {
        let t = (cosAngle - glowCosRadius) / (coronaCosRadius - glowCosRadius);
        return sunColor * pow(t, 2.0) * 0.05;
    }
    
    return vec3<f32>(0.0);
}
`;

/**
 * Sun class for orbital mechanics and state management
 */
export class Sun {
    constructor(config = {}) {
        this.config = { ...SunDefaults, ...config };
        this.angle = this.config.startAngle;
        this.direction = [0, 1, 0];  // Normalized sun direction
    }
    
    /**
     * Update sun position based on time
     * @param {number} deltaTime - Time since last update in seconds
     * @param {number} gameTime - Total game time in seconds
     */
    update(deltaTime, gameTime) {
        if (!this.config.enabled) return;
        
        // Calculate sun angle based on game time
        const period = this.config.orbitPeriod;
        this.angle = (gameTime / period) * Math.PI * 2;
        
        // Calculate direction with axial tilt
        const tiltRad = degreesToRadians(this.config.orbitTilt);
        const y = Math.sin(this.angle);
        const xz = Math.cos(this.angle);
        
        this.direction = [
            xz * Math.sin(tiltRad),
            y,
            -xz * Math.cos(tiltRad)
        ];
        
        // Normalize
        const len = Math.sqrt(
            this.direction[0] ** 2 + 
            this.direction[1] ** 2 + 
            this.direction[2] ** 2
        );
        this.direction = this.direction.map(v => v / len);
    }
    
    /**
     * Get uniform data for GPU
     */
    getUniformData() {
        return {
            direction: this.direction,
            angularRadius: this.config.angularRadius,
            color: this.config.color,
            intensity: this.config.intensity,
        };
    }
    
    /**
     * Check if sun is above horizon
     */
    isVisible() {
        return this.direction[1] > -0.1;
    }
    
    /**
     * Get day factor (0 = night, 1 = full day)
     */
    getDayFactor() {
        return Math.max(0, Math.min(1, (this.direction[1] + 0.1) / 0.4));
    }
}

export default Sun;
