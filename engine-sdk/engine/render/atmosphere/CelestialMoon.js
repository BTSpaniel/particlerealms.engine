// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CelestialMoon.js - Moon configuration and rendering
 * Supports multiple moons (major and minor) with customizable properties
 */

/**
 * Moon type enumeration
 */
import { degreesToRadians } from '../../core/math/UnitMath.js';

export const MoonType = {
    MAJOR: 'major',     // Large, prominent moons
    MINOR: 'minor',     // Small, distant moons
};

/**
 * Default configurations for different moon types
 */
export const MoonDefaults = {
    major: {
        orbitPeriod: 30 * 60,           // 30 minute orbit
        orbitTilt: 5.0,                 // Low tilt
        orbitEccentricity: 0.05,        // Nearly circular
        angularRadius: 0.015,           // Larger apparent size
        color: [0.9, 0.9, 1.0],         // Slight blue tint
        brightness: 0.8,
        phaseSpeed: 1.0,                // Full phase cycle per orbit
        hasAtmosphere: false,
        atmosphereColor: [0.5, 0.6, 0.8],
        enabled: true,
    },
    minor: {
        orbitPeriod: 8 * 60,            // 8 minute orbit (faster)
        orbitTilt: 15.0,                // Higher tilt
        orbitEccentricity: 0.1,         // Slightly elliptical
        angularRadius: 0.005,           // Smaller apparent size
        color: [0.8, 0.75, 0.7],        // Warmer color
        brightness: 0.4,
        phaseSpeed: 1.0,
        hasAtmosphere: false,
        atmosphereColor: [0.6, 0.5, 0.4],
        enabled: true,
    },
};

/**
 * Preset moon configurations for the world
 */
export const MoonPresets = {
    // Major moon - large, slow orbit
    luna: {
        name: 'Luna',
        type: MoonType.MAJOR,
        orbitPeriod: 45 * 60,
        orbitTilt: 5.0,
        startAngle: 0,
        angularRadius: 0.018,
        color: [0.95, 0.93, 0.88],
        brightness: 1.0,
        enabled: true,
    },
    
    // Second major moon - reddish
    crimson: {
        name: 'Crimson',
        type: MoonType.MAJOR,
        orbitPeriod: 60 * 60,
        orbitTilt: 12.0,
        startAngle: Math.PI * 0.7,
        angularRadius: 0.012,
        color: [1.0, 0.6, 0.4],
        brightness: 0.7,
        enabled: true,
    },
    
    // Minor moon - small and fast
    swift: {
        name: 'Swift',
        type: MoonType.MINOR,
        orbitPeriod: 10 * 60,
        orbitTilt: 25.0,
        startAngle: Math.PI * 0.3,
        angularRadius: 0.004,
        color: [0.7, 0.8, 0.9],
        brightness: 0.3,
        enabled: true,
    },
    
    // Minor moon - tiny distant
    pale: {
        name: 'Pale',
        type: MoonType.MINOR,
        orbitPeriod: 15 * 60,
        orbitTilt: 40.0,
        startAngle: Math.PI * 1.2,
        angularRadius: 0.002,
        color: [0.9, 0.9, 0.95],
        brightness: 0.2,
        enabled: true,
    },
};

/**
 * WGSL shader code for moon rendering
 */
export const MoonWGSL = `
// Moon disc with phase rendering
fn moonDisc(
    direction: vec3<f32>,
    moonDir: vec3<f32>,
    angularRadius: f32,
    phase: f32,
    moonColor: vec3<f32>
) -> vec3<f32> {
    let cosAngle = dot(direction, moonDir);
    let moonCosRadius = cos(angularRadius);
    
    if (cosAngle < moonCosRadius) {
        return vec3<f32>(0.0);
    }
    
    // Calculate position on moon disc for phase
    let t = (cosAngle - moonCosRadius) / (1.0 - moonCosRadius);
    
    // Simple phase calculation
    // phase: 0 = new (dark), 0.5 = full (bright), 1 = new again
    let phaseFactor = abs(phase - 0.5) * 2.0;
    let lit = select(phaseFactor, 1.0 - phaseFactor, phase < 0.5);
    
    // Smooth edge
    let edgeFade = smoothstep(0.0, 0.3, t);
    
    return moonColor * edgeFade * max(0.1, lit);
}

// Moon with atmospheric glow
fn moonDiscWithGlow(
    direction: vec3<f32>,
    moonDir: vec3<f32>,
    angularRadius: f32,
    phase: f32,
    moonColor: vec3<f32>,
    glowColor: vec3<f32>,
    glowIntensity: f32
) -> vec3<f32> {
    let cosAngle = dot(direction, moonDir);
    let moonCosRadius = cos(angularRadius);
    
    // Main disc
    var color = vec3<f32>(0.0);
    if (cosAngle > moonCosRadius) {
        let t = (cosAngle - moonCosRadius) / (1.0 - moonCosRadius);
        let phaseFactor = abs(phase - 0.5) * 2.0;
        let lit = select(phaseFactor, 1.0 - phaseFactor, phase < 0.5);
        color = moonColor * smoothstep(0.0, 0.3, t) * max(0.1, lit);
    }
    
    // Atmospheric glow around moon
    let glowRadius = angularRadius * 2.5;
    let glowCosRadius = cos(glowRadius);
    if (cosAngle > glowCosRadius && cosAngle <= moonCosRadius) {
        let t = (cosAngle - glowCosRadius) / (moonCosRadius - glowCosRadius);
        color += glowColor * pow(t, 2.0) * glowIntensity;
    }
    
    return color;
}
`;

/**
 * Moon class for orbital mechanics and state management
 */
export class Moon {
    constructor(config = {}) {
        const typeDefaults = config.type === MoonType.MINOR 
            ? MoonDefaults.minor 
            : MoonDefaults.major;
        
        this.config = { ...typeDefaults, ...config };
        this.name = this.config.name || 'Moon';
        this.type = this.config.type || MoonType.MAJOR;
        this.angle = this.config.startAngle || 0;
        this.phase = 0;
        this.direction = [0, 1, 0];
    }
    
    /**
     * Update moon position and phase based on time
     */
    update(deltaTime, gameTime) {
        if (!this.config.enabled) return;
        
        const period = this.config.orbitPeriod;
        this.angle = ((gameTime + (this.config.startAngle || 0)) / period) * Math.PI * 2;
        
        // Calculate phase (synced to orbit by default)
        this.phase = ((this.angle / (Math.PI * 2)) * this.config.phaseSpeed) % 1.0;
        
        // Calculate direction with tilt
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
            phase: this.phase,
            color: this.config.color,
            brightness: this.config.brightness,
        };
    }
    
    /**
     * Check if moon is above horizon
     */
    isVisible() {
        return this.direction[1] > -0.1;
    }
}

/**
 * MoonSystem - Manages multiple moons
 */
export class MoonSystem {
    constructor() {
        this.moons = new Map();
        this.majorMoons = [];
        this.minorMoons = [];
    }
    
    /**
     * Add a moon to the system
     */
    addMoon(id, config) {
        const moon = new Moon(config);
        this.moons.set(id, moon);
        
        if (moon.type === MoonType.MAJOR) {
            this.majorMoons.push(moon);
        } else {
            this.minorMoons.push(moon);
        }
        
        return moon;
    }
    
    /**
     * Remove a moon from the system
     */
    removeMoon(id) {
        const moon = this.moons.get(id);
        if (moon) {
            this.moons.delete(id);
            
            if (moon.type === MoonType.MAJOR) {
                this.majorMoons = this.majorMoons.filter(m => m !== moon);
            } else {
                this.minorMoons = this.minorMoons.filter(m => m !== moon);
            }
        }
    }
    
    /**
     * Update all moons
     */
    update(deltaTime, gameTime) {
        for (const moon of this.moons.values()) {
            moon.update(deltaTime, gameTime);
        }
    }
    
    /**
     * Get all visible moons
     */
    getVisibleMoons() {
        return Array.from(this.moons.values()).filter(m => m.isVisible());
    }
    
    /**
     * Get uniform data for all moons (up to maxMoons)
     */
    getUniformData(maxMoons = 4) {
        const data = [];
        let count = 0;
        
        // Major moons first
        for (const moon of this.majorMoons) {
            if (count >= maxMoons) break;
            if (moon.config.enabled) {
                data.push(moon.getUniformData());
                count++;
            }
        }
        
        // Then minor moons
        for (const moon of this.minorMoons) {
            if (count >= maxMoons) break;
            if (moon.config.enabled) {
                data.push(moon.getUniformData());
                count++;
            }
        }
        
        return data;
    }
    
    /**
     * Load preset moons
     */
    loadPresets(presetIds = ['luna', 'crimson', 'swift']) {
        for (const id of presetIds) {
            if (MoonPresets[id]) {
                this.addMoon(id, MoonPresets[id]);
            }
        }
    }
}

export default Moon;
