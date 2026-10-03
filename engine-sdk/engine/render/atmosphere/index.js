// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Atmosphere Module - Hillaire 2020 LUT-Based Atmospheric Rendering
 * 
 * Exports all atmosphere-related systems:
 * - HillaireLUT: 4-LUT system (Transmittance, Multi-Scatter, Sky-View, Aerial Perspective)
 * - Aurora: Volumetric aurora rendering (future)
 * - Weather: Spectral weather simulation (future)
 */

export { 
    HillaireLUT, 
    TRANSMITTANCE_COMPUTE_WGSL, 
    MULTISCATTER_COMPUTE_WGSL,
    SKYVIEW_COMPUTE_WGSL,
    AERIAL_PERSPECTIVE_COMPUTE_WGSL
} from './HillaireLUT.js';

export { AuroraPass, AURORA_WGSL } from './AuroraPass.js';
export { SpectralWeather, SPECTRAL_WEATHER_WGSL } from './SpectralWeather.js';
export { BlueNoiseTexture, BLUE_NOISE_WGSL } from './BlueNoise.js';
export { TemporalAccumulation, TEMPORAL_ACCUMULATION_WGSL } from './TemporalAccumulation.js';
export { 
    ATMOSPHERE_UTILS_WGSL, 
    MIE_ASYMMETRY, 
    ADAPTIVE_STEPS,
    getMieAsymmetryFromVisibility,
    getAdaptiveStepMultiplier 
} from './AtmosphereUtils.js';
