// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { random } from '../../core/math/MathRandom.js';

/**
 * PhasorRays.js - Hybrid Ray Tracing with Wave Properties
 * 
 * Combines geometric ray tracing with wave optics for:
 * - Phasor representation (amplitude + phase)
 * - Frequency-dependent effects (dispersion, Doppler)
 * - Time reflection ray splitting
 * - Interference patterns
 * - Diffraction approximations
 * 
 * This hybrid approach allows:
 * - Fast ray tracing for primary visibility
 * - Wave effects at material boundaries
 * - Time crystal interactions (frequency shifts)
 * - Visual frequency-to-color mapping
 * 
 * Each ray carries: position, direction, amplitude, frequency, phase
 */

import { PHYSICS } from './FDTDSolver.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Base visible light frequencies */
export const VISIBLE_SPECTRUM = {
    RED: 4.3e14,      // ~700nm
    ORANGE: 5.0e14,   // ~600nm
    YELLOW: 5.2e14,   // ~580nm
    GREEN: 5.7e14,    // ~530nm
    CYAN: 6.1e14,     // ~490nm
    BLUE: 6.7e14,     // ~450nm
    VIOLET: 7.5e14,   // ~400nm
};

/** Ray interaction types */
export const RayInteraction = {
    NONE: 0,
    REFLECT: 1,
    REFRACT: 2,
    TIME_REFLECT: 3,    // Backward wave from temporal boundary
    ABSORB: 4,
    SCATTER: 5,
    DIFFRACT: 6,
};

/** Ray state */
export const RayState = {
    ACTIVE: 0,
    TERMINATED: 1,
    SPLIT: 2,
};

// ============================================================================
// PHASOR RAY
// ============================================================================

/**
 * Ray with wave properties (phasor representation)
 */
export class PhasorRay {
    constructor(options = {}) {
        // Geometric properties
        this.position = options.position ?? [0, 0, 0];
        this.direction = options.direction ?? [0, 0, 1];
        
        // Wave properties (phasor)
        this.amplitude = options.amplitude ?? 1;
        this.frequency = options.frequency ?? VISIBLE_SPECTRUM.GREEN;
        this.phase = options.phase ?? 0;  // 0 to 2π
        
        // Polarization (for EM waves)
        this.polarization = options.polarization ?? [1, 0, 0];
        
        // State
        this.state = RayState.ACTIVE;
        this.depth = options.depth ?? 0;  // Recursion depth
        this.pathLength = 0;
        
        // Current medium
        this.refractiveIndex = options.refractiveIndex ?? 1;
        
        // For tracking
        this.id = options.id ?? random().toString(36).substr(2, 9);
        this.parentId = options.parentId ?? null;
        this.isTimeReflected = options.isTimeReflected ?? false;
        
        // Normalize direction
        this._normalizeDirection();
    }
    
    _normalizeDirection() {
        const len = Math.sqrt(
            this.direction[0]**2 + 
            this.direction[1]**2 + 
            this.direction[2]**2
        );
        if (len > 0) {
            this.direction[0] /= len;
            this.direction[1] /= len;
            this.direction[2] /= len;
        }
    }
    
    /**
     * Advance ray by distance, accumulating phase
     * @param {number} distance 
     */
    advance(distance) {
        // Update position
        this.position[0] += this.direction[0] * distance;
        this.position[1] += this.direction[1] * distance;
        this.position[2] += this.direction[2] * distance;
        
        // Accumulate path length
        this.pathLength += distance;
        
        // Accumulate phase: φ += k * d = (2πf/c) * n * d
        const wavelength = PHYSICS.c / (this.frequency * this.refractiveIndex);
        const phaseChange = (2 * Math.PI * distance) / wavelength;
        this.phase = (this.phase + phaseChange) % (2 * Math.PI);
    }
    
    /**
     * Get wavelength in current medium
     */
    getWavelength() {
        return PHYSICS.c / (this.frequency * this.refractiveIndex);
    }
    
    /**
     * Get wave number k
     */
    getWaveNumber() {
        return (2 * Math.PI * this.frequency * this.refractiveIndex) / PHYSICS.c;
    }
    
    /**
     * Get complex phasor value
     * @returns {{ real: number, imag: number }}
     */
    getPhasor() {
        return {
            real: this.amplitude * Math.cos(this.phase),
            imag: this.amplitude * Math.sin(this.phase),
        };
    }
    
    /**
     * Get instantaneous E-field (for visualization)
     * @param {number} time 
     */
    getInstantaneousField(time) {
        const omega = 2 * Math.PI * this.frequency;
        return this.amplitude * Math.cos(omega * time + this.phase);
    }
    
    /**
     * Clone ray
     */
    clone() {
        return new PhasorRay({
            position: [...this.position],
            direction: [...this.direction],
            amplitude: this.amplitude,
            frequency: this.frequency,
            phase: this.phase,
            polarization: [...this.polarization],
            depth: this.depth,
            refractiveIndex: this.refractiveIndex,
            parentId: this.id,
        });
    }
    
    /**
     * Terminate ray
     */
    terminate() {
        this.state = RayState.TERMINATED;
    }
}

// ============================================================================
// RAY-MATERIAL INTERACTION
// ============================================================================

export class RayMaterialInteraction {
    /**
     * Compute Fresnel coefficients for interface
     * @param {number} n1 - Refractive index of incident medium
     * @param {number} n2 - Refractive index of transmitted medium
     * @param {number} cosTheta1 - Cosine of incident angle
     * @returns {{ rs: number, rp: number, ts: number, tp: number, R: number, T: number }}
     */
    static fresnel(n1, n2, cosTheta1) {
        const sinTheta1 = Math.sqrt(1 - cosTheta1 * cosTheta1);
        const sinTheta2 = (n1 / n2) * sinTheta1;
        
        // Total internal reflection
        if (sinTheta2 > 1) {
            return { rs: 1, rp: 1, ts: 0, tp: 0, R: 1, T: 0, totalReflection: true };
        }
        
        const cosTheta2 = Math.sqrt(1 - sinTheta2 * sinTheta2);
        
        // S-polarization (TE)
        const rs = (n1 * cosTheta1 - n2 * cosTheta2) / (n1 * cosTheta1 + n2 * cosTheta2);
        const ts = (2 * n1 * cosTheta1) / (n1 * cosTheta1 + n2 * cosTheta2);
        
        // P-polarization (TM)
        const rp = (n2 * cosTheta1 - n1 * cosTheta2) / (n2 * cosTheta1 + n1 * cosTheta2);
        const tp = (2 * n1 * cosTheta1) / (n2 * cosTheta1 + n1 * cosTheta2);
        
        // Average reflectance/transmittance for unpolarized light
        const R = 0.5 * (rs * rs + rp * rp);
        const T = 1 - R;
        
        return { rs, rp, ts, tp, R, T, cosTheta2, totalReflection: false };
    }
    
    /**
     * Compute time interface coefficients
     * When ε changes: t = (n1+n2)/(2n2), r = (n2-n1)/(2n2)
     * @param {number} n1 - Index before change
     * @param {number} n2 - Index after change
     */
    static timeInterface(n1, n2) {
        const t = (n1 + n2) / (2 * n2);
        const r = (n2 - n1) / (2 * n2);
        
        return {
            transmission: t,
            reflection: Math.abs(r),
            reflectionSign: Math.sign(r),
            // Wavelength changes but frequency preserved!
            wavelengthRatio: n1 / n2,
        };
    }
    
    /**
     * Compute reflected direction
     */
    static reflect(incident, normal) {
        const dot = incident[0] * normal[0] + incident[1] * normal[1] + incident[2] * normal[2];
        return [
            incident[0] - 2 * dot * normal[0],
            incident[1] - 2 * dot * normal[1],
            incident[2] - 2 * dot * normal[2],
        ];
    }
    
    /**
     * Compute refracted direction (Snell's law)
     */
    static refract(incident, normal, n1, n2) {
        const eta = n1 / n2;
        const cosI = -(incident[0] * normal[0] + incident[1] * normal[1] + incident[2] * normal[2]);
        const sinT2 = eta * eta * (1 - cosI * cosI);
        
        if (sinT2 > 1) {
            return null; // Total internal reflection
        }
        
        const cosT = Math.sqrt(1 - sinT2);
        return [
            eta * incident[0] + (eta * cosI - cosT) * normal[0],
            eta * incident[1] + (eta * cosI - cosT) * normal[1],
            eta * incident[2] + (eta * cosI - cosT) * normal[2],
        ];
    }
    
    /**
     * Compute time-reflected direction (reverses!)
     */
    static timeReflect(incident) {
        return [-incident[0], -incident[1], -incident[2]];
    }
}

// ============================================================================
// PHASOR RAY TRACER
// ============================================================================

export class PhasorRayTracer {
    constructor(options = {}) {
        this.maxDepth = options.maxDepth ?? 10;
        this.minAmplitude = options.minAmplitude ?? 0.01;
        
        // Scene geometry (would be voxel world in practice)
        this.scene = options.scene ?? null;
        
        // Time-varying materials
        this.temporalMaterials = options.temporalMaterials ?? [];
        
        // Active rays
        this.rays = [];
        this.completedRays = [];
        
        // Time
        this.time = 0;
    }
    
    /**
     * Add temporal material region
     * @param {Object} material - { region, getEpsilon(t), getMu(t) }
     */
    addTemporalMaterial(material) {
        this.temporalMaterials.push(material);
    }
    
    /**
     * Spawn a new ray
     * @param {Object} options 
     * @returns {PhasorRay}
     */
    spawnRay(options) {
        const ray = new PhasorRay(options);
        this.rays.push(ray);
        return ray;
    }
    
    /**
     * Trace all active rays for one step
     * @param {number} dt 
     */
    step(dt) {
        this.time += dt;
        
        const newRays = [];
        
        for (const ray of this.rays) {
            if (ray.state !== RayState.ACTIVE) continue;
            
            // Find next intersection
            const hit = this._traceRay(ray);
            
            if (hit) {
                // Handle interaction
                const result = this._handleInteraction(ray, hit);
                
                if (result.newRays) {
                    newRays.push(...result.newRays);
                }
            } else {
                // Ray escaped scene
                ray.terminate();
                this.completedRays.push(ray);
            }
            
            // Check termination conditions
            if (ray.amplitude < this.minAmplitude || ray.depth > this.maxDepth) {
                ray.terminate();
            }
        }
        
        // Add new rays from interactions
        this.rays.push(...newRays);
        
        // Remove terminated rays
        this.rays = this.rays.filter(r => r.state === RayState.ACTIVE);
    }
    
    _traceRay(ray) {
        // Check temporal materials first (time boundaries)
        for (const material of this.temporalMaterials) {
            if (this._isInRegion(ray.position, material.region)) {
                // Check for temporal boundary (ε changing)
                const epsilonNow = material.getEpsilon(this.time);
                const epsilonPrev = material.getEpsilon(this.time - 0.001);
                
                if (Math.abs(epsilonNow - epsilonPrev) > 0.01) {
                    return {
                        type: RayInteraction.TIME_REFLECT,
                        distance: 0,
                        epsilonBefore: epsilonPrev,
                        epsilonAfter: epsilonNow,
                        material,
                    };
                }
            }
        }
        
        // Trace against scene geometry
        if (this.scene) {
            return this.scene.raycast(ray.position, ray.direction);
        }
        
        return null;
    }
    
    _handleInteraction(ray, hit) {
        const newRays = [];
        
        switch (hit.type) {
            case RayInteraction.TIME_REFLECT:
                // TIME REFLECTION - the key temporal effect!
                return this._handleTimeReflection(ray, hit);
                
            case RayInteraction.REFLECT:
                return this._handleReflection(ray, hit);
                
            case RayInteraction.REFRACT:
                return this._handleRefraction(ray, hit);
                
            default:
                ray.terminate();
        }
        
        return { newRays };
    }
    
    /**
     * Handle time reflection (temporal boundary)
     * Creates backward-propagating ray while preserving frequency
     */
    _handleTimeReflection(ray, hit) {
        const n1 = Math.sqrt(hit.epsilonBefore);
        const n2 = Math.sqrt(hit.epsilonAfter);
        
        const { transmission, reflection, wavelengthRatio } = 
            RayMaterialInteraction.timeInterface(n1, n2);
        
        const newRays = [];
        
        // Transmitted ray (continues forward, wavelength changes)
        if (transmission > this.minAmplitude) {
            const transmitted = ray.clone();
            transmitted.amplitude *= transmission;
            transmitted.refractiveIndex = n2;
            // Frequency preserved! Only wavelength changes
            newRays.push(transmitted);
        }
        
        // Reflected ray (goes BACKWARD - time reflection!)
        if (reflection > this.minAmplitude) {
            const reflected = ray.clone();
            reflected.amplitude *= reflection;
            reflected.direction = RayMaterialInteraction.timeReflect(ray.direction);
            reflected.refractiveIndex = n2;
            reflected.isTimeReflected = true;
            reflected.depth = ray.depth + 1;
            // Phase shift on reflection
            reflected.phase = (reflected.phase + Math.PI) % (2 * Math.PI);
            newRays.push(reflected);
        }
        
        ray.terminate();
        
        return { newRays };
    }
    
    _handleReflection(ray, hit) {
        ray.advance(hit.distance);
        
        const reflected = ray.clone();
        reflected.direction = RayMaterialInteraction.reflect(ray.direction, hit.normal);
        reflected.depth = ray.depth + 1;
        
        // Fresnel reflectance
        const cosTheta = Math.abs(
            ray.direction[0] * hit.normal[0] +
            ray.direction[1] * hit.normal[1] +
            ray.direction[2] * hit.normal[2]
        );
        const { R } = RayMaterialInteraction.fresnel(ray.refractiveIndex, hit.n2 ?? 1.5, cosTheta);
        reflected.amplitude *= Math.sqrt(R);
        
        ray.terminate();
        
        return { newRays: [reflected] };
    }
    
    _handleRefraction(ray, hit) {
        ray.advance(hit.distance);
        
        const n1 = ray.refractiveIndex;
        const n2 = hit.n2 ?? 1.5;
        
        const cosTheta = Math.abs(
            ray.direction[0] * hit.normal[0] +
            ray.direction[1] * hit.normal[1] +
            ray.direction[2] * hit.normal[2]
        );
        
        const fresnel = RayMaterialInteraction.fresnel(n1, n2, cosTheta);
        const newRays = [];
        
        // Reflected ray
        if (fresnel.R > this.minAmplitude) {
            const reflected = ray.clone();
            reflected.direction = RayMaterialInteraction.reflect(ray.direction, hit.normal);
            reflected.amplitude *= Math.sqrt(fresnel.R);
            reflected.depth = ray.depth + 1;
            newRays.push(reflected);
        }
        
        // Refracted ray (if not total internal reflection)
        if (!fresnel.totalReflection && fresnel.T > this.minAmplitude) {
            const refracted = ray.clone();
            refracted.direction = RayMaterialInteraction.refract(ray.direction, hit.normal, n1, n2);
            if (refracted.direction) {
                refracted.amplitude *= Math.sqrt(fresnel.T);
                refracted.refractiveIndex = n2;
                refracted.depth = ray.depth + 1;
                newRays.push(refracted);
            }
        }
        
        ray.terminate();
        
        return { newRays };
    }
    
    _isInRegion(pos, region) {
        if (!region) return true;
        return pos[0] >= region.min[0] && pos[0] <= region.max[0] &&
               pos[1] >= region.min[1] && pos[1] <= region.max[1] &&
               pos[2] >= region.min[2] && pos[2] <= region.max[2];
    }
    
    /**
     * Get all rays for visualization
     */
    getAllRays() {
        return [...this.rays, ...this.completedRays];
    }
    
    /**
     * Get time-reflected rays only
     */
    getTimeReflectedRays() {
        return this.getAllRays().filter(r => r.isTimeReflected);
    }
    
    /**
     * Clear all rays
     */
    clear() {
        this.rays = [];
        this.completedRays = [];
    }
}

// ============================================================================
// FREQUENCY TO COLOR MAPPING
// ============================================================================

/**
 * Convert frequency to visible color (RGB)
 * @param {number} frequency - Frequency in Hz
 * @returns {number[]} RGB values [0-1]
 */
export function frequencyToColor(frequency) {
    // Visible spectrum: 4.3e14 Hz (red) to 7.5e14 Hz (violet)
    const minFreq = 4.3e14;
    const maxFreq = 7.5e14;
    
    // Clamp and normalize
    const t = Math.max(0, Math.min(1, (frequency - minFreq) / (maxFreq - minFreq)));
    
    let r, g, b;
    
    if (t < 0.2) {
        // Red to orange
        r = 1;
        g = t * 5 * 0.5;
        b = 0;
    } else if (t < 0.35) {
        // Orange to yellow
        r = 1;
        g = 0.5 + (t - 0.2) / 0.15 * 0.5;
        b = 0;
    } else if (t < 0.5) {
        // Yellow to green
        r = 1 - (t - 0.35) / 0.15;
        g = 1;
        b = 0;
    } else if (t < 0.65) {
        // Green to cyan
        r = 0;
        g = 1;
        b = (t - 0.5) / 0.15;
    } else if (t < 0.8) {
        // Cyan to blue
        r = 0;
        g = 1 - (t - 0.65) / 0.15;
        b = 1;
    } else {
        // Blue to violet
        r = (t - 0.8) / 0.2 * 0.5;
        g = 0;
        b = 1;
    }
    
    return [r, g, b];
}

/**
 * Convert wavelength to color
 * @param {number} wavelength - Wavelength in meters
 */
export function wavelengthToColor(wavelength) {
    const frequency = PHYSICS.c / wavelength;
    return frequencyToColor(frequency);
}

/**
 * Apply Doppler shift color
 * @param {number} baseFrequency 
 * @param {number} observedFrequency 
 * @returns {{ color: number[], shift: string }}
 */
export function dopplerColor(baseFrequency, observedFrequency) {
    const ratio = observedFrequency / baseFrequency;
    const color = frequencyToColor(observedFrequency);
    
    let shift;
    if (ratio > 1.01) {
        shift = 'blueshift';
    } else if (ratio < 0.99) {
        shift = 'redshift';
    } else {
        shift = 'none';
    }
    
    return { color, shift, ratio };
}

// ============================================================================
// RAY VISUALIZATION DATA
// ============================================================================

/**
 * Generate visualization data for rays
 * @param {PhasorRay[]} rays 
 * @param {number} time 
 * @returns {Object}
 */
export function generateRayVisualization(rays, time) {
    const segments = [];
    const points = [];
    
    for (const ray of rays) {
        const color = frequencyToColor(ray.frequency);
        const intensity = ray.amplitude;
        
        // Ray segment
        segments.push({
            start: [...ray.position],
            direction: [...ray.direction],
            length: ray.pathLength || 1,
            color,
            intensity,
            isTimeReflected: ray.isTimeReflected,
        });
        
        // Current position point
        points.push({
            position: [...ray.position],
            color,
            intensity,
            phase: ray.phase,
            isTimeReflected: ray.isTimeReflected,
        });
    }
    
    return { segments, points, time };
}

export { PhasorRayTracer as PhasorRays };

export default PhasorRayTracer;
