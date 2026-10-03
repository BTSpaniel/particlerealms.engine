/**
 * SeismicSystem.js - Tectonic Simulation and Earthquake Events
 * 
 * Simulates geological activity on the planet:
 * - Tectonic fault lines with stress accumulation
 * - Earthquake event triggering when stress exceeds threshold
 * - Seismic wave propagation (P-waves, S-waves, surface waves)
 * - Distance-based attenuation
 * - Character/entity response integration
 * 
 * Wave Types:
 * - P-waves (Primary): Compressional, fastest, travels through solids/liquids
 * - S-waves (Secondary): Shear, slower, solids only
 * - Surface waves: Slowest, most destructive, along surface
 */

import { random } from '../../core/math/MathRandom.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Wave types */
export const WaveType = {
    P_WAVE: 0,      // Primary (compressional) - fastest
    S_WAVE: 1,      // Secondary (shear) - medium
    SURFACE: 2,     // Rayleigh/Love waves - slowest, most damage
};

/** Wave speeds (m/s, scaled for game) */
export const WAVE_SPEEDS = {
    [WaveType.P_WAVE]: 6000,    // 6 km/s in rock
    [WaveType.S_WAVE]: 3500,    // 3.5 km/s in rock
    [WaveType.SURFACE]: 2500,  // ~2.5 km/s
};

/** Earthquake magnitude scales */
export const MagnitudeScale = {
    MICRO: 0,       // < 2.0 - Not felt
    MINOR: 1,       // 2.0-3.9 - Rarely felt
    LIGHT: 2,       // 4.0-4.9 - Noticeable shaking
    MODERATE: 3,    // 5.0-5.9 - Can cause damage
    STRONG: 4,      // 6.0-6.9 - Destructive
    MAJOR: 5,       // 7.0-7.9 - Serious damage
    GREAT: 6,       // 8.0+ - Catastrophic
};

/** Default seismic parameters */
export const DEFAULT_PARAMS = {
    // Stress accumulation
    stressRate: 0.01,           // Stress per second
    stressThreshold: 100,       // Triggers earthquake
    stressRelease: 0.8,         // Fraction released in quake
    
    // Wave propagation
    attenuationP: 0.001,        // P-wave attenuation per meter
    attenuationS: 0.002,        // S-wave attenuation
    attenuationSurface: 0.003,  // Surface wave attenuation
    
    // Effects
    shakeDuration: 10,          // Seconds of shaking
    aftershockProbability: 0.3, // Chance of aftershock
    aftershockMagnitudeRatio: 0.7, // Relative to main quake
    
    // Destruction
    destructionThreshold: 0.5,  // Wave amplitude to damage voxels
    collapseThreshold: 0.8,     // Wave amplitude for structure collapse
};

// ============================================================================
// FAULT LINE
// ============================================================================

/**
 * Represents a tectonic fault line
 */
export class FaultLine {
    /**
     * @param {number[]} start - Start point [x, y, z]
     * @param {number[]} end - End point [x, y, z]
     * @param {number} depth - Depth below surface
     */
    constructor(start, end, depth = 10000) {
        this.start = start;
        this.end = end;
        this.depth = depth;
        
        // Stress state
        this.stress = 0;
        this.maxStress = DEFAULT_PARAMS.stressThreshold;
        this.stressRate = DEFAULT_PARAMS.stressRate;
        
        // Fault properties
        this.slipRate = 0.01;    // m/year (scaled)
        this.locked = true;      // Stress accumulates when locked
        this.lastQuakeTime = 0;
        
        // Geometry
        this._computeGeometry();
    }
    
    _computeGeometry() {
        this.direction = [
            this.end[0] - this.start[0],
            this.end[1] - this.start[1],
            this.end[2] - this.start[2],
        ];
        this.length = Math.sqrt(
            this.direction[0]**2 + 
            this.direction[1]**2 + 
            this.direction[2]**2
        );
        
        if (this.length > 0) {
            this.direction[0] /= this.length;
            this.direction[1] /= this.length;
            this.direction[2] /= this.length;
        }
        
        this.center = [
            (this.start[0] + this.end[0]) / 2,
            (this.start[1] + this.end[1]) / 2 - this.depth,
            (this.start[2] + this.end[2]) / 2,
        ];
    }
    
    /**
     * Accumulate stress over time
     * @param {number} dt 
     * @returns {boolean} True if earthquake triggered
     */
    update(dt) {
        if (!this.locked) return false;
        
        this.stress += this.stressRate * dt;
        
        if (this.stress >= this.maxStress) {
            return true; // Trigger earthquake
        }
        
        return false;
    }
    
    /**
     * Release stress (earthquake)
     * @returns {number} Released energy (magnitude proxy)
     */
    release() {
        const released = this.stress * DEFAULT_PARAMS.stressRelease;
        this.stress -= released;
        this.locked = false;
        
        // Relock after some time
        setTimeout(() => { this.locked = true; }, 1000);
        
        return released;
    }
    
    /**
     * Get closest point on fault to a position
     * @param {number[]} pos 
     * @returns {{ point: number[], distance: number, t: number }}
     */
    closestPoint(pos) {
        const ap = [
            pos[0] - this.start[0],
            pos[1] - this.start[1],
            pos[2] - this.start[2],
        ];
        
        const t = Math.max(0, Math.min(1,
            (ap[0] * this.direction[0] + 
             ap[1] * this.direction[1] + 
             ap[2] * this.direction[2]) / this.length
        ));
        
        const point = [
            this.start[0] + t * this.direction[0] * this.length,
            this.start[1] + t * this.direction[1] * this.length,
            this.start[2] + t * this.direction[2] * this.length,
        ];
        
        const dx = pos[0] - point[0];
        const dy = pos[1] - point[1];
        const dz = pos[2] - point[2];
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        return { point, distance, t };
    }
}

// ============================================================================
// SEISMIC WAVE
// ============================================================================

/**
 * Propagating seismic wave
 */
export class SeismicWave {
    /**
     * @param {number[]} epicenter - Wave origin
     * @param {number} magnitude - Richter scale (logarithmic)
     * @param {number} type - WaveType
     */
    constructor(epicenter, magnitude, type = WaveType.P_WAVE) {
        this.epicenter = [...epicenter];
        this.magnitude = magnitude;
        this.type = type;
        
        this.speed = WAVE_SPEEDS[type];
        this.attenuation = this._getAttenuation(type);
        
        // Wave state
        this.radius = 0;          // Current wavefront radius
        this.age = 0;             // Time since wave started
        this.active = true;
        
        // Energy (from magnitude, logarithmic scale)
        // E = 10^(1.5 * M + 4.8) joules (simplified)
        this.energy = Math.pow(10, 1.5 * magnitude + 4.8);
        this.amplitude = Math.sqrt(this.energy) * 0.001; // Scale for game
    }
    
    _getAttenuation(type) {
        switch (type) {
            case WaveType.P_WAVE: return DEFAULT_PARAMS.attenuationP;
            case WaveType.S_WAVE: return DEFAULT_PARAMS.attenuationS;
            case WaveType.SURFACE: return DEFAULT_PARAMS.attenuationSurface;
            default: return DEFAULT_PARAMS.attenuationP;
        }
    }
    
    /**
     * Update wave propagation
     * @param {number} dt 
     */
    update(dt) {
        if (!this.active) return;
        
        this.age += dt;
        this.radius = this.speed * this.age;
        
        // Check if wave has dissipated
        const currentAmplitude = this.getAmplitudeAt(this.radius);
        if (currentAmplitude < 0.001) {
            this.active = false;
        }
    }
    
    /**
     * Get wave amplitude at distance from epicenter
     * @param {number} distance 
     * @returns {number}
     */
    getAmplitudeAt(distance) {
        if (distance < 1) distance = 1;
        
        // Geometric spreading (1/r for surface, 1/r^2 for body waves)
        let spreading;
        if (this.type === WaveType.SURFACE) {
            spreading = 1 / Math.sqrt(distance);
        } else {
            spreading = 1 / distance;
        }
        
        // Exponential attenuation
        const attenuation = Math.exp(-this.attenuation * distance);
        
        return this.amplitude * spreading * attenuation;
    }
    
    /**
     * Get wave intensity at a position
     * @param {number[]} pos 
     * @returns {{ amplitude: number, inWavefront: boolean, phase: number }}
     */
    getIntensityAt(pos) {
        const dx = pos[0] - this.epicenter[0];
        const dy = pos[1] - this.epicenter[1];
        const dz = pos[2] - this.epicenter[2];
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Check if position is near wavefront
        const wavefrontThickness = 100; // meters
        const distFromWavefront = Math.abs(distance - this.radius);
        const inWavefront = distFromWavefront < wavefrontThickness;
        
        // Phase (for oscillation)
        const wavelength = this.speed / 2; // Assume ~2Hz frequency
        const phase = (distance / wavelength) * Math.PI * 2;
        
        const amplitude = inWavefront ? this.getAmplitudeAt(distance) : 0;
        
        return { amplitude, inWavefront, phase, distance };
    }
    
    /**
     * Get shaking vector at position
     * @param {number[]} pos 
     * @param {number} time 
     * @returns {number[]}
     */
    getShakeVector(pos, time) {
        const { amplitude, phase, distance } = this.getIntensityAt(pos);
        
        if (amplitude < 0.001) return [0, 0, 0];
        
        // Direction from epicenter
        const dx = pos[0] - this.epicenter[0];
        const dy = pos[1] - this.epicenter[1];
        const dz = pos[2] - this.epicenter[2];
        const dist = Math.max(distance, 1);
        const dirX = dx / dist;
        const dirY = dy / dist;
        const dirZ = dz / dist;
        
        // Oscillation
        const freq = 2; // Hz
        const oscillation = Math.sin(phase + time * freq * Math.PI * 2);
        
        // Different motion for different wave types
        let shakeX, shakeY, shakeZ;
        
        switch (this.type) {
            case WaveType.P_WAVE:
                // P-waves: motion along propagation direction
                shakeX = dirX * amplitude * oscillation;
                shakeY = dirY * amplitude * oscillation;
                shakeZ = dirZ * amplitude * oscillation;
                break;
                
            case WaveType.S_WAVE:
                // S-waves: motion perpendicular to propagation
                const perpX = -dirZ;
                const perpZ = dirX;
                shakeX = perpX * amplitude * oscillation;
                shakeY = amplitude * oscillation * 0.5;
                shakeZ = perpZ * amplitude * oscillation;
                break;
                
            case WaveType.SURFACE:
                // Surface waves: elliptical motion (Rayleigh)
                shakeX = dirX * amplitude * oscillation;
                shakeY = amplitude * Math.cos(phase + time * freq * Math.PI * 2);
                shakeZ = dirZ * amplitude * oscillation;
                break;
                
            default:
                shakeX = shakeY = shakeZ = 0;
        }
        
        return [shakeX, shakeY, shakeZ];
    }
}

// ============================================================================
// EARTHQUAKE EVENT
// ============================================================================

/**
 * Complete earthquake event with multiple wave types
 */
export class Earthquake {
    /**
     * @param {number[]} epicenter 
     * @param {number} magnitude - Richter scale
     * @param {FaultLine} fault - Source fault (optional)
     */
    constructor(epicenter, magnitude, fault = null) {
        this.epicenter = [...epicenter];
        this.hypocenter = [...epicenter]; // Deep origin
        this.magnitude = magnitude;
        this.fault = fault;
        
        this.startTime = 0;
        this.duration = DEFAULT_PARAMS.shakeDuration * (1 + magnitude * 0.2);
        this.active = true;
        
        // Create waves (P-wave first, then S-wave, then surface)
        this.waves = [
            new SeismicWave(epicenter, magnitude, WaveType.P_WAVE),
            new SeismicWave(epicenter, magnitude * 0.9, WaveType.S_WAVE),
            new SeismicWave(epicenter, magnitude * 0.8, WaveType.SURFACE),
        ];
        
        // Aftershocks
        this.aftershocks = [];
        this._scheduleAftershocks();
        
        // Stats
        this.peakAmplitude = 0;
        this.affectedRadius = 0;
    }
    
    _scheduleAftershocks() {
        // Simplified Omori's law for aftershock frequency
        const numAftershocks = Math.floor(Math.pow(10, this.magnitude - 4));
        
        for (let i = 0; i < numAftershocks; i++) {
            if (random() < DEFAULT_PARAMS.aftershockProbability) {
                const delay = 5 + random() * 60; // 5-65 seconds after
                const afterMag = this.magnitude * DEFAULT_PARAMS.aftershockMagnitudeRatio * 
                                 (0.5 + random() * 0.5);
                
                // Offset from main epicenter
                const offset = [
                    (random() - 0.5) * 1000,
                    (random() - 0.5) * 500,
                    (random() - 0.5) * 1000,
                ];
                
                this.aftershocks.push({
                    delay,
                    magnitude: afterMag,
                    epicenter: [
                        this.epicenter[0] + offset[0],
                        this.epicenter[1] + offset[1],
                        this.epicenter[2] + offset[2],
                    ],
                    triggered: false,
                });
            }
        }
    }
    
    /**
     * Update earthquake
     * @param {number} dt 
     * @param {number} currentTime 
     * @returns {Earthquake[]} New aftershocks to add
     */
    update(dt, currentTime) {
        if (!this.active) return [];
        
        // Update all waves
        for (const wave of this.waves) {
            wave.update(dt);
        }
        
        // Check if all waves done
        if (this.waves.every(w => !w.active)) {
            this.active = false;
        }
        
        // Trigger aftershocks
        const newQuakes = [];
        const elapsed = currentTime - this.startTime;
        
        for (const aftershock of this.aftershocks) {
            if (!aftershock.triggered && elapsed >= aftershock.delay) {
                aftershock.triggered = true;
                newQuakes.push(new Earthquake(
                    aftershock.epicenter,
                    aftershock.magnitude,
                    this.fault
                ));
            }
        }
        
        return newQuakes;
    }
    
    /**
     * Get combined shaking at position
     * @param {number[]} pos 
     * @param {number} time 
     * @returns {{ shake: number[], amplitude: number }}
     */
    getShakingAt(pos, time) {
        let totalShake = [0, 0, 0];
        let maxAmplitude = 0;
        
        for (const wave of this.waves) {
            if (!wave.active) continue;
            
            const shake = wave.getShakeVector(pos, time);
            totalShake[0] += shake[0];
            totalShake[1] += shake[1];
            totalShake[2] += shake[2];
            
            const { amplitude } = wave.getIntensityAt(pos);
            maxAmplitude = Math.max(maxAmplitude, amplitude);
        }
        
        return { shake: totalShake, amplitude: maxAmplitude };
    }
    
    /**
     * Get magnitude category
     */
    getMagnitudeScale() {
        if (this.magnitude < 2) return MagnitudeScale.MICRO;
        if (this.magnitude < 4) return MagnitudeScale.MINOR;
        if (this.magnitude < 5) return MagnitudeScale.LIGHT;
        if (this.magnitude < 6) return MagnitudeScale.MODERATE;
        if (this.magnitude < 7) return MagnitudeScale.STRONG;
        if (this.magnitude < 8) return MagnitudeScale.MAJOR;
        return MagnitudeScale.GREAT;
    }
}

// ============================================================================
// SEISMIC SYSTEM
// ============================================================================

export class SeismicSystem {
    constructor(options = {}) {
        this.params = { ...DEFAULT_PARAMS, ...options };
        
        // Fault lines
        this.faults = [];
        
        // Active earthquakes
        this.earthquakes = [];
        
        // Time tracking
        this.time = 0;
        
        // Listeners
        this.listeners = {
            onQuake: [],
            onWaveHit: [],
        };
        
        // Stats
        this.stats = {
            totalQuakes: 0,
            largestMagnitude: 0,
        };
    }
    
    /**
     * Add a fault line
     * @param {number[]} start 
     * @param {number[]} end 
     * @param {number} depth 
     * @returns {FaultLine}
     */
    addFault(start, end, depth = 10000) {
        const fault = new FaultLine(start, end, depth);
        this.faults.push(fault);
        return fault;
    }
    
    /**
     * Manually trigger an earthquake
     * @param {number[]} epicenter 
     * @param {number} magnitude 
     * @returns {Earthquake}
     */
    triggerQuake(epicenter, magnitude) {
        const quake = new Earthquake(epicenter, magnitude);
        quake.startTime = this.time;
        this.earthquakes.push(quake);
        
        this.stats.totalQuakes++;
        this.stats.largestMagnitude = Math.max(this.stats.largestMagnitude, magnitude);
        
        // Notify listeners
        for (const listener of this.listeners.onQuake) {
            listener(quake);
        }
        
        return quake;
    }
    
    /**
     * Update seismic simulation
     * @param {number} dt 
     */
    update(dt) {
        this.time += dt;
        
        // Update fault stress
        for (const fault of this.faults) {
            if (fault.update(dt)) {
                // Earthquake triggered!
                const energy = fault.release();
                const magnitude = (Math.log10(energy) - 4.8) / 1.5;
                this.triggerQuake(fault.center, magnitude);
            }
        }
        
        // Update earthquakes
        const newQuakes = [];
        for (const quake of this.earthquakes) {
            const aftershocks = quake.update(dt, this.time);
            newQuakes.push(...aftershocks);
        }
        
        // Add aftershocks
        for (const quake of newQuakes) {
            quake.startTime = this.time;
            this.earthquakes.push(quake);
            this.stats.totalQuakes++;
        }
        
        // Remove finished earthquakes
        this.earthquakes = this.earthquakes.filter(q => q.active);
    }
    
    /**
     * Get total shaking at a position
     * @param {number[]} pos 
     * @returns {{ shake: number[], amplitude: number, frequency: number }}
     */
    getShakingAt(pos) {
        let totalShake = [0, 0, 0];
        let maxAmplitude = 0;
        
        for (const quake of this.earthquakes) {
            const { shake, amplitude } = quake.getShakingAt(pos, this.time);
            totalShake[0] += shake[0];
            totalShake[1] += shake[1];
            totalShake[2] += shake[2];
            maxAmplitude = Math.max(maxAmplitude, amplitude);
        }
        
        // Approximate frequency based on wave types present
        const frequency = this.earthquakes.length > 0 ? 2 : 0;
        
        return { shake: totalShake, amplitude: maxAmplitude, frequency };
    }
    
    /**
     * Check if destruction should occur at position
     * @param {number[]} pos 
     * @returns {{ shouldDestroy: boolean, shouldCollapse: boolean, intensity: number }}
     */
    checkDestruction(pos) {
        const { amplitude } = this.getShakingAt(pos);
        
        return {
            shouldDestroy: amplitude > this.params.destructionThreshold,
            shouldCollapse: amplitude > this.params.collapseThreshold,
            intensity: amplitude,
        };
    }
    
    /**
     * Add event listener
     * @param {'onQuake'|'onWaveHit'} event 
     * @param {Function} callback 
     */
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }
    
    /**
     * Remove event listener
     */
    off(event, callback) {
        if (this.listeners[event]) {
            const idx = this.listeners[event].indexOf(callback);
            if (idx >= 0) {
                this.listeners[event].splice(idx, 1);
            }
        }
    }
    
    /**
     * Get nearest fault to position
     */
    getNearestFault(pos) {
        let nearest = null;
        let minDist = Infinity;
        
        for (const fault of this.faults) {
            const { distance } = fault.closestPoint(pos);
            if (distance < minDist) {
                minDist = distance;
                nearest = fault;
            }
        }
        
        return { fault: nearest, distance: minDist };
    }
    
    /**
     * Generate random fault network
     * @param {number[]} center 
     * @param {number} radius 
     * @param {number} count 
     */
    generateFaultNetwork(center, radius, count = 5) {
        for (let i = 0; i < count; i++) {
            const angle1 = random() * Math.PI * 2;
            const angle2 = angle1 + (random() - 0.5) * Math.PI;
            const dist1 = random() * radius;
            const dist2 = random() * radius;
            
            const start = [
                center[0] + Math.cos(angle1) * dist1,
                center[1],
                center[2] + Math.sin(angle1) * dist1,
            ];
            
            const end = [
                center[0] + Math.cos(angle2) * dist2,
                center[1],
                center[2] + Math.sin(angle2) * dist2,
            ];
            
            const depth = 5000 + random() * 20000;
            
            this.addFault(start, end, depth);
        }
    }
    
    /**
     * Get stats
     */
    getStats() {
        return {
            ...this.stats,
            activeFaults: this.faults.length,
            activeQuakes: this.earthquakes.length,
            totalStress: this.faults.reduce((sum, f) => sum + f.stress, 0),
        };
    }
}

export default SeismicSystem;
