// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PhotonicCrystal.js - Photonic Time Crystals and Temporal Metamaterials
 * 
 * Implements photonic time crystals - materials with periodically modulated
 * permittivity ε(t) that create temporal band gaps and enable:
 * - Time reflection (backward-propagating waves)
 * - Frequency conversion
 * - Temporal cloaking
 * - Non-reciprocal wave propagation
 * - Parametric amplification
 * 
 * Physics Background:
 * - Spatial photonic crystals: periodic ε(x) → spatial band gaps
 * - Temporal photonic crystals: periodic ε(t) → temporal band gaps
 * - Key insight: D = εE is conserved, but E = D/ε changes with ε(t)
 * - When ε jumps suddenly: creates time-reflected wave
 * - When ε modulates periodically: creates momentum gaps (not frequency gaps!)
 * 
 * References:
 * - Galiffi et al., "Photonics of Time-Varying Media" (2022)
 * - Lustig et al., "Topological aspects of photonic time crystals" (2018)
 */

import { FDTDSolver, TimeVaryingMaterial, MaterialType, PHYSICS } from './FDTDSolver.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Photonic crystal types */
export const CrystalType = {
    SPATIAL: 0,           // Periodic in space (traditional)
    TEMPORAL: 1,          // Periodic in time (time crystal)
    SPATIOTEMPORAL: 2,    // Periodic in both (space-time crystal)
};

/** Modulation waveforms */
export const ModulationWaveform = {
    SINUSOIDAL: 0,
    SQUARE: 1,
    SAWTOOTH: 2,
    TRIANGULAR: 3,
    PULSE_TRAIN: 4,
};

/** Time crystal effects */
export const TemporalEffect = {
    REFLECTION: 'reflection',         // Backward wave generation
    FREQUENCY_SHIFT: 'frequency_shift', // Doppler-like shift
    AMPLIFICATION: 'amplification',   // Parametric gain
    BAND_GAP: 'band_gap',             // Momentum gap
    CLOAKING: 'cloaking',             // Temporal invisibility
};

// ============================================================================
// DISPERSION RELATION
// ============================================================================

/**
 * Computes dispersion relation for time-varying medium
 * For photonic time crystal: ω(k) has gaps in k-space (momentum gaps)
 */
export class DispersionCalculator {
    constructor(baseEpsilon, baseMu, modDepth, modFrequency) {
        this.epsilon0 = baseEpsilon;
        this.mu0 = baseMu;
        this.deltaEpsilon = modDepth * baseEpsilon;
        this.omegaMod = 2 * Math.PI * modFrequency;
        
        // Base phase velocity
        this.c0 = PHYSICS.c / Math.sqrt(baseEpsilon * baseMu);
    }
    
    /**
     * Get effective permittivity at time t
     * ε(t) = ε₀(1 + Δε/ε₀ · cos(ωₘt))
     */
    epsilon(t) {
        return this.epsilon0 + this.deltaEpsilon * Math.cos(this.omegaMod * t);
    }
    
    /**
     * Check if frequency/momentum is in band gap
     * Temporal band gaps occur at k = n·ωₘ/(2c)
     */
    isInBandGap(k, tolerance = 0.1) {
        // Momentum gap locations
        const kGap = this.omegaMod / (2 * this.c0);
        const n = Math.round(k / kGap);
        
        if (n === 0) return false;
        
        const kExpected = n * kGap;
        const relativeDistance = Math.abs(k - kExpected) / kGap;
        
        // Gap width scales with modulation depth
        const gapWidth = this.deltaEpsilon / this.epsilon0;
        
        return relativeDistance < gapWidth * tolerance;
    }
    
    /**
     * Compute Floquet exponent (Bloch theorem in time)
     * For determining band structure
     * 
     * Floquet theorem: E(t) = e^(μt) · P(t)
     * where μ is the Floquet exponent and P(t) is periodic
     * - Real μ → exponential growth/decay (in band gap)
     * - Imaginary μ → oscillatory (propagating wave)
     * 
     * @param {number} omega - Angular frequency
     * @returns {{ real: number, imag: number, inGap: boolean, growthRate: number }}
     */
    floquetExponent(omega) {
        const k = omega / this.c0;
        const delta = this.deltaEpsilon / this.epsilon0;
        
        // Momentum gap locations: k_gap = n·Ω/(2c₀)
        const kGap = this.omegaMod / (2 * this.c0);
        const n = Math.round(k / kGap);
        
        if (n === 0) {
            return { real: k, imag: 0, inGap: false, growthRate: 0 };
        }
        
        const kNearest = n * kGap;
        const distToGap = Math.abs(k - kNearest);
        const gapHalfWidth = delta * kGap * 0.5;
        
        if (distToGap < gapHalfWidth) {
            // In band gap: exponential growth/decay
            // Growth rate: μ ≈ Ω·δ/4 at gap center, decreases toward edges
            const gapPosition = distToGap / gapHalfWidth;  // 0 at center, 1 at edge
            const growthRate = this.omegaMod * delta * 0.25 * (1 - gapPosition * gapPosition);
            
            return { 
                real: growthRate,  // Real part = growth rate
                imag: 0, 
                inGap: true, 
                growthRate,
                gapIndex: n,
                gapPosition,
            };
        }
        
        // Outside gap: propagating (imaginary exponent = oscillation)
        return { real: 0, imag: k, inGap: false, growthRate: 0 };
    }
    
    /**
     * Get band gap boundaries for nth gap
     * @param {number} n - Gap index (1, 2, 3, ...)
     * @returns {{ lower: number, upper: number, center: number, width: number }}
     */
    getBandGapBounds(n) {
        const delta = this.deltaEpsilon / this.epsilon0;
        const kGap = this.omegaMod / (2 * this.c0);
        
        const center = n * kGap;
        const width = delta * kGap;
        
        return {
            lower: center - width * 0.5,
            upper: center + width * 0.5,
            center,
            width,
        };
    }
    
    /**
     * Compute parametric amplification factor
     * @param {number} k - Wave number
     * @param {number} dt - Time step
     * @returns {number} Amplification factor
     */
    getParametricGain(k, dt) {
        const floquet = this.floquetExponent(k * this.c0);
        
        if (!floquet.inGap) return 1;
        
        // Exponential growth: A(t+dt) = A(t) · e^(μ·dt)
        return Math.exp(floquet.growthRate * dt);
    }
    
    /**
     * Get transmission/reflection coefficients for time interface
     * When ε₁ → ε₂ suddenly
     */
    timeInterfaceCoefficients(epsilon1, epsilon2) {
        // Unlike spatial interface, time interface:
        // - Frequency is conserved
        // - Wavelength changes
        // - Creates forward AND backward waves
        
        const n1 = Math.sqrt(epsilon1);
        const n2 = Math.sqrt(epsilon2);
        
        // Transmission coefficient (forward wave)
        const t = (n1 + n2) / (2 * n2);
        
        // Reflection coefficient (backward wave!)
        const r = (n2 - n1) / (2 * n2);
        
        return { t, r };
    }
}

// ============================================================================
// PHOTONIC TIME CRYSTAL
// ============================================================================

export class PhotonicTimeCrystal {
    /**
     * @param {Object} options 
     */
    constructor(options = {}) {
        // Geometry
        this.position = options.position ?? [0, 0, 0];
        this.size = options.size ?? [10, 10, 10];
        
        // Base material
        this.baseEpsilon = options.baseEpsilon ?? 4;  // Like glass
        this.baseMu = options.baseMu ?? 1;
        
        // Temporal modulation
        this.modulationDepth = options.modulationDepth ?? 0.3;  // Δε/ε
        this.modulationFrequency = options.modulationFrequency ?? 1e9;  // Hz
        this.modulationPhase = options.modulationPhase ?? 0;
        this.waveform = options.waveform ?? ModulationWaveform.SINUSOIDAL;
        
        // Crystal type
        this.type = options.type ?? CrystalType.TEMPORAL;
        
        // For spatiotemporal crystals
        this.spatialPeriod = options.spatialPeriod ?? null;
        
        // State
        this.active = true;
        this.activationTime = 0;
        
        // Effects tracking
        this.activeEffects = new Set();
        
        // Dispersion calculator
        this.dispersion = new DispersionCalculator(
            this.baseEpsilon,
            this.baseMu,
            this.modulationDepth,
            this.modulationFrequency
        );
    }
    
    /**
     * Get permittivity at position and time
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {number} t 
     * @returns {number}
     */
    getEpsilon(x, y, z, t) {
        if (!this.active) return this.baseEpsilon;
        if (!this.containsPoint(x, y, z)) return 1;  // Vacuum outside
        
        const relT = t - this.activationTime;
        if (relT < 0) return this.baseEpsilon;
        
        // Temporal modulation
        let temporalFactor = 0;
        const phase = 2 * Math.PI * this.modulationFrequency * relT + this.modulationPhase;
        
        switch (this.waveform) {
            case ModulationWaveform.SINUSOIDAL:
                temporalFactor = Math.sin(phase);
                break;
            case ModulationWaveform.SQUARE:
                temporalFactor = Math.sign(Math.sin(phase));
                break;
            case ModulationWaveform.SAWTOOTH:
                temporalFactor = 2 * ((phase / (2 * Math.PI)) % 1) - 1;
                break;
            case ModulationWaveform.TRIANGULAR:
                temporalFactor = 2 * Math.abs(2 * ((phase / (2 * Math.PI)) % 1) - 1) - 1;
                break;
            case ModulationWaveform.PULSE_TRAIN:
                temporalFactor = ((phase % (2 * Math.PI)) < 0.5) ? 1 : -1;
                break;
        }
        
        let epsilon = this.baseEpsilon * (1 + this.modulationDepth * temporalFactor);
        
        // Spatial modulation for spatiotemporal crystal
        if (this.type === CrystalType.SPATIOTEMPORAL && this.spatialPeriod) {
            const spatialPhase = 2 * Math.PI * (
                (x - this.position[0]) / this.spatialPeriod[0] +
                (y - this.position[1]) / this.spatialPeriod[1] +
                (z - this.position[2]) / this.spatialPeriod[2]
            );
            epsilon *= (1 + 0.1 * Math.cos(spatialPhase));
        }
        
        return Math.max(epsilon, 0.1);  // Prevent negative/zero epsilon
    }
    
    /**
     * Check if point is inside crystal
     */
    containsPoint(x, y, z) {
        return x >= this.position[0] && x <= this.position[0] + this.size[0] &&
               y >= this.position[1] && y <= this.position[1] + this.size[1] &&
               z >= this.position[2] && z <= this.position[2] + this.size[2];
    }
    
    /**
     * Activate the crystal (start modulation)
     * @param {number} time - Activation time
     */
    activate(time) {
        this.active = true;
        this.activationTime = time;
    }
    
    /**
     * Deactivate the crystal
     */
    deactivate() {
        this.active = false;
    }
    
    /**
     * Check if wave at given frequency/momentum will be in band gap
     */
    isInBandGap(frequency) {
        const omega = 2 * Math.PI * frequency;
        const k = omega / this.dispersion.c0;
        return this.dispersion.isInBandGap(k);
    }
    
    /**
     * Get expected effects for incoming wave
     * @param {number} frequency - Wave frequency
     * @param {number[]} direction - Propagation direction
     */
    predictEffects(frequency, direction) {
        const effects = [];
        
        // Check band gap
        if (this.isInBandGap(frequency)) {
            effects.push({
                type: TemporalEffect.BAND_GAP,
                strength: this.modulationDepth,
                description: 'Wave cannot propagate - momentum gap',
            });
            effects.push({
                type: TemporalEffect.AMPLIFICATION,
                strength: Math.exp(this.modulationDepth * this.modulationFrequency * 1e-9),
                description: 'Exponential growth in gap region',
            });
        }
        
        // Time reflection always occurs with modulation
        if (this.modulationDepth > 0) {
            const { r } = this.dispersion.timeInterfaceCoefficients(
                this.baseEpsilon,
                this.baseEpsilon * (1 + this.modulationDepth)
            );
            
            effects.push({
                type: TemporalEffect.REFLECTION,
                strength: Math.abs(r),
                description: 'Backward wave generation',
            });
        }
        
        // Frequency shift from moving modulation
        if (this.type === CrystalType.SPATIOTEMPORAL) {
            effects.push({
                type: TemporalEffect.FREQUENCY_SHIFT,
                strength: this.modulationFrequency,
                description: 'Doppler-like frequency shift',
            });
        }
        
        return effects;
    }
    
    /**
     * Create TimeVaryingMaterial for FDTD solver
     */
    toTimeVaryingMaterial() {
        return new TimeVaryingMaterial({
            baseEpsilon: this.baseEpsilon,
            baseMu: this.baseMu,
            modulationType: this.waveform === ModulationWaveform.SINUSOIDAL ? 'sinusoidal' : 'square',
            modulationFrequency: this.modulationFrequency,
            modulationDepth: this.modulationDepth,
            modulationPhase: this.modulationPhase,
            region: {
                min: this.position,
                max: [
                    this.position[0] + this.size[0],
                    this.position[1] + this.size[1],
                    this.position[2] + this.size[2],
                ],
            },
        });
    }
    
    /**
     * Get visualization data
     */
    getVisualizationData(time) {
        return {
            position: this.position,
            size: this.size,
            currentEpsilon: this.getEpsilon(
                this.position[0] + this.size[0] / 2,
                this.position[1] + this.size[1] / 2,
                this.position[2] + this.size[2] / 2,
                time
            ),
            active: this.active,
            type: this.type,
            modulationPhase: (2 * Math.PI * this.modulationFrequency * (time - this.activationTime)) % (2 * Math.PI),
        };
    }
    
    // ========================================================================
    // PARAMETRIC AMPLIFICATION & SATURATION
    // ========================================================================
    
    /**
     * Apply parametric amplification to field amplitude with saturation
     * Prevents numerical explosion (NaN/Inf) from exponential growth
     * 
     * @param {number} amplitude - Current field amplitude
     * @param {number} frequency - Wave frequency
     * @param {number} dt - Time step
     * @param {Object} options - { saturationThreshold, maxGrowthPerStep }
     * @returns {number} Saturated amplitude
     */
    applyParametricAmplification(amplitude, frequency, dt, options = {}) {
        const saturationThreshold = options.saturationThreshold ?? 1e6;
        const maxGrowthPerStep = options.maxGrowthPerStep ?? 10;
        
        // Get Floquet exponent to determine growth rate
        const omega = 2 * Math.PI * frequency;
        const floquet = this.dispersion.floquetExponent(omega);
        
        if (!floquet.inGap) {
            return amplitude;  // No amplification outside band gap
        }
        
        // Clamp growth rate to prevent runaway
        const clampedGrowth = Math.min(floquet.growthRate * dt, maxGrowthPerStep);
        
        // Apply exponential growth
        let newAmplitude = amplitude * Math.exp(clampedGrowth);
        
        // Apply soft saturation: E_final = E_sat * tanh(E / E_sat)
        newAmplitude = this.saturateField(newAmplitude, saturationThreshold);
        
        return newAmplitude;
    }
    
    /**
     * Soft clipping saturation to prevent NaN/Inf explosion
     * Uses tanh for smooth limiting: E_final = E_sat * tanh(E / E_sat)
     * 
     * @param {number} value - Field value to saturate
     * @param {number} threshold - Saturation threshold
     * @returns {number} Saturated value
     */
    saturateField(value, threshold = 1e6) {
        if (Math.abs(value) < threshold * 0.1) {
            return value;  // Linear region, no saturation needed
        }
        return threshold * Math.tanh(value / threshold);
    }
    
    /**
     * Saturate a 3D vector field
     * @param {number[]} field - [x, y, z] field components
     * @param {number} threshold - Saturation threshold
     * @returns {number[]} Saturated field
     */
    saturateFieldVector(field, threshold = 1e6) {
        return [
            this.saturateField(field[0], threshold),
            this.saturateField(field[1], threshold),
            this.saturateField(field[2], threshold),
        ];
    }
    
    /**
     * Get stability info for current parameters
     * @returns {Object} Stability analysis
     */
    getStabilityInfo() {
        const delta = this.modulationDepth;
        const omega = 2 * Math.PI * this.modulationFrequency;
        
        // Maximum growth rate in first band gap
        const maxGrowthRate = omega * delta * 0.25;
        
        // Time for amplitude to double
        const doublingTime = Math.log(2) / maxGrowthRate;
        
        // Recommended saturation threshold
        const recommendedSaturation = 1e6;
        
        // Maximum safe dt before saturation kicks in too hard
        const maxSafeDt = 10 / maxGrowthRate;
        
        return {
            maxGrowthRate,
            doublingTime,
            recommendedSaturation,
            maxSafeDt,
            isStable: delta < 0.5,  // Modulation depth > 50% may be unstable
        };
    }
    
    /**
     * Get Floquet analysis for debugging
     * @param {number} frequency 
     * @returns {Object}
     */
    getFloquetAnalysis(frequency) {
        const omega = 2 * Math.PI * frequency;
        const floquet = this.dispersion.floquetExponent(omega);
        
        return {
            ...floquet,
            frequency,
            omega,
            wavelength: PHYSICS.c / frequency,
            waveNumber: omega / this.dispersion.c0,
            bandGaps: [1, 2, 3, 4, 5].map(n => this.dispersion.getBandGapBounds(n)),
        };
    }
}

// ============================================================================
// TIME REFLECTION EVENT
// ============================================================================

/**
 * Represents a sudden change in ε that creates time reflection
 */
export class TimeReflectionEvent {
    /**
     * @param {Object} options 
     */
    constructor(options = {}) {
        this.position = options.position ?? [0, 0, 0];
        this.size = options.size ?? [10, 10, 10];
        
        // Before/after permittivity
        this.epsilonBefore = options.epsilonBefore ?? 1;
        this.epsilonAfter = options.epsilonAfter ?? 4;
        
        // Timing
        this.triggerTime = options.triggerTime ?? 0;
        this.transitionDuration = options.transitionDuration ?? 0;  // 0 = instantaneous
        
        // State
        this.triggered = false;
        
        // Computed coefficients
        this._computeCoefficients();
    }
    
    _computeCoefficients() {
        const n1 = Math.sqrt(this.epsilonBefore);
        const n2 = Math.sqrt(this.epsilonAfter);
        
        // Time interface transmission/reflection
        this.transmissionCoeff = (n1 + n2) / (2 * n2);
        this.reflectionCoeff = (n2 - n1) / (2 * n2);
        
        // Wavelength change
        this.wavelengthRatio = n1 / n2;
    }
    
    /**
     * Get permittivity at time t
     */
    getEpsilon(t) {
        if (t < this.triggerTime) {
            return this.epsilonBefore;
        }
        
        if (this.transitionDuration === 0 || t >= this.triggerTime + this.transitionDuration) {
            return this.epsilonAfter;
        }
        
        // Smooth transition
        const progress = (t - this.triggerTime) / this.transitionDuration;
        const smoothProgress = progress * progress * (3 - 2 * progress);  // Smoothstep
        
        return this.epsilonBefore + (this.epsilonAfter - this.epsilonBefore) * smoothProgress;
    }
    
    /**
     * Check if point is in event region
     */
    containsPoint(x, y, z) {
        return x >= this.position[0] && x <= this.position[0] + this.size[0] &&
               y >= this.position[1] && y <= this.position[1] + this.size[1] &&
               z >= this.position[2] && z <= this.position[2] + this.size[2];
    }
    
    /**
     * Trigger the time reflection
     * @param {number} time 
     */
    trigger(time) {
        this.triggerTime = time;
        this.triggered = true;
    }
    
    /**
     * Get expected output waves from input wave
     * @param {Object} inputWave - { amplitude, frequency, direction }
     */
    computeOutput(inputWave) {
        return {
            transmitted: {
                amplitude: inputWave.amplitude * this.transmissionCoeff,
                frequency: inputWave.frequency,  // Frequency conserved!
                wavelength: inputWave.wavelength * this.wavelengthRatio,
                direction: inputWave.direction,  // Same direction
            },
            reflected: {
                amplitude: inputWave.amplitude * Math.abs(this.reflectionCoeff),
                frequency: inputWave.frequency,  // Frequency conserved!
                wavelength: inputWave.wavelength * this.wavelengthRatio,
                direction: inputWave.direction.map(d => -d),  // Reversed!
            },
        };
    }
    
    /**
     * Create TimeVaryingMaterial for FDTD
     */
    toTimeVaryingMaterial() {
        return new TimeVaryingMaterial({
            baseEpsilon: this.epsilonBefore,
            stepTime: this.triggerTime,
            stepEpsilon: this.epsilonAfter,
            region: {
                min: this.position,
                max: [
                    this.position[0] + this.size[0],
                    this.position[1] + this.size[1],
                    this.position[2] + this.size[2],
                ],
            },
        });
    }
}

// ============================================================================
// TEMPORAL CLOAK
// ============================================================================

/**
 * Temporal cloaking using time lens approach
 * Opens and closes a gap in the time domain
 */
export class TemporalCloak {
    /**
     * @param {Object} options 
     */
    constructor(options = {}) {
        this.position = options.position ?? [0, 0, 0];
        this.size = options.size ?? [10, 10, 10];
        
        // Cloak timing
        this.openTime = options.openTime ?? 0;      // When gap opens
        this.gapDuration = options.gapDuration ?? 1e-9;  // Duration of hidden interval
        this.closeTime = options.closeTime ?? null;  // Auto-computed if null
        
        // Material params
        this.epsilonLow = options.epsilonLow ?? 1;
        this.epsilonHigh = options.epsilonHigh ?? 4;
        
        if (this.closeTime === null) {
            this.closeTime = this.openTime + this.gapDuration;
        }
        
        this.active = false;
    }
    
    /**
     * Get permittivity for temporal cloaking
     * Uses time-lens approach: slow down light before gap, speed up after
     */
    getEpsilon(t) {
        if (!this.active) return this.epsilonLow;
        
        // Before gap: increase ε (slow down light)
        if (t < this.openTime) {
            const approach = Math.exp(-(this.openTime - t) / (this.gapDuration * 0.5));
            return this.epsilonLow + (this.epsilonHigh - this.epsilonLow) * approach;
        }
        
        // During gap: high ε
        if (t < this.closeTime) {
            return this.epsilonHigh;
        }
        
        // After gap: decrease ε (speed up light to close gap)
        const departure = Math.exp(-(t - this.closeTime) / (this.gapDuration * 0.5));
        return this.epsilonLow + (this.epsilonHigh - this.epsilonLow) * departure;
    }
    
    activate(openTime) {
        this.openTime = openTime;
        this.closeTime = openTime + this.gapDuration;
        this.active = true;
    }
    
    deactivate() {
        this.active = false;
    }
    
    /**
     * Check if event at given time would be cloaked
     */
    isCloaked(eventTime) {
        return this.active && eventTime >= this.openTime && eventTime <= this.closeTime;
    }
}

// ============================================================================
// PHOTONIC CRYSTAL MANAGER
// ============================================================================

export class PhotonicCrystalManager {
    /**
     * @param {FDTDSolver} fdtdSolver 
     */
    constructor(fdtdSolver) {
        this.solver = fdtdSolver;
        
        this.crystals = [];
        this.reflectionEvents = [];
        this.cloaks = [];
        
        this.time = 0;
    }
    
    /**
     * Add a photonic time crystal
     * @param {PhotonicTimeCrystal} crystal 
     */
    addCrystal(crystal) {
        this.crystals.push(crystal);
        this.solver.addTimeVaryingMaterial(crystal.toTimeVaryingMaterial());
        return crystal;
    }
    
    /**
     * Create and add a new crystal
     * @param {Object} options 
     */
    createCrystal(options) {
        const crystal = new PhotonicTimeCrystal(options);
        return this.addCrystal(crystal);
    }
    
    /**
     * Schedule a time reflection event
     * @param {Object} options 
     */
    scheduleReflection(options) {
        const event = new TimeReflectionEvent(options);
        this.reflectionEvents.push(event);
        this.solver.addTimeVaryingMaterial(event.toTimeVaryingMaterial());
        return event;
    }
    
    /**
     * Create temporal cloak
     * @param {Object} options 
     */
    createCloak(options) {
        const cloak = new TemporalCloak(options);
        this.cloaks.push(cloak);
        return cloak;
    }
    
    /**
     * Update all photonic elements
     * @param {number} dt 
     */
    update(dt) {
        this.time += dt;
        
        // Update cloak states
        for (const cloak of this.cloaks) {
            // Cloak state handled internally by getEpsilon
        }
    }
    
    /**
     * Get all active effects at a position
     * @param {number[]} pos 
     */
    getEffectsAt(pos) {
        const effects = [];
        
        for (const crystal of this.crystals) {
            if (crystal.containsPoint(...pos) && crystal.active) {
                effects.push({
                    source: 'crystal',
                    type: CrystalType.TEMPORAL,
                    epsilon: crystal.getEpsilon(...pos, this.time),
                });
            }
        }
        
        for (const event of this.reflectionEvents) {
            if (event.containsPoint(...pos) && event.triggered) {
                effects.push({
                    source: 'reflection',
                    epsilon: event.getEpsilon(this.time),
                    coefficients: {
                        t: event.transmissionCoeff,
                        r: event.reflectionCoeff,
                    },
                });
            }
        }
        
        for (const cloak of this.cloaks) {
            if (cloak.active) {
                effects.push({
                    source: 'cloak',
                    isCloaked: cloak.isCloaked(this.time),
                    epsilon: cloak.getEpsilon(this.time),
                });
            }
        }
        
        return effects;
    }
    
    /**
     * Get visualization data for all elements
     */
    getVisualizationData() {
        return {
            crystals: this.crystals.map(c => c.getVisualizationData(this.time)),
            reflections: this.reflectionEvents.map(e => ({
                position: e.position,
                size: e.size,
                triggered: e.triggered,
                currentEpsilon: e.getEpsilon(this.time),
            })),
            cloaks: this.cloaks.map(c => ({
                position: c.position,
                size: c.size,
                active: c.active,
                isCloaking: c.isCloaked(this.time),
            })),
            time: this.time,
        };
    }
    
    /**
     * Remove all elements
     */
    clear() {
        this.crystals = [];
        this.reflectionEvents = [];
        this.cloaks = [];
    }
}

export { PhotonicCrystalManager as PhotonicCrystal };

export default PhotonicCrystalManager;
