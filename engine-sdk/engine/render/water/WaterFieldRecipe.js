// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { fnv1aStringCodeUnit32 } from '../../core/math/ChecksumMath.js';
import { normalizeOceanSpectrum, createOceanSpectrumWGSL, OCEAN_SPECTRUM_TYPES_WGSL } from './OceanSpectrum.js';
import { WATER_FIELD_DENSITY_WGSL } from './WaterFieldShaders.js';

export const WATER_FIELD_VERSION = 2;
export const WATER_FIELD_DOMAINS = Object.freeze([256, 32, 4]);
export const WATER_FIELD_MAX_BYTES = 64 * 1024 * 1024;
export const WATER_FIELD_DEFAULT_RESOLUTION = 128;

const PARAMETER_BOUNDS = Object.freeze({
    significantWaveHeight: [0.8, 0, 20], windSpeed: [9, 0.5, 60], windDirection: [0.15, -Math.PI * 2, Math.PI * 2],
    directionalSpread: [0.65, 0, 1], minimumWavelength: [0.15, 0.1, 100], maximumWavelength: [80, 1, 256],
    depth: [60, 0.25, 10000], choppiness: [0.8, 0, 2], shortWaveDamping: [0.035, 0, 1],
});

export function normalizeWaterFieldParameters(value = {}) {
    for (const name of Object.keys(value)) if (!(name in PARAMETER_BOUNDS) && name !== 'flow') throw new TypeError(`Unknown water field parameter ${name}.`);
    const parameters = {};
    for (const [name, [fallback, minimum, maximum]] of Object.entries(PARAMETER_BOUNDS)) {
        const number = value[name] ?? fallback;
        if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum || number > maximum) {
            throw new RangeError(`Water field ${name} must be finite in [${minimum}, ${maximum}].`);
        }
        parameters[name] = number;
    }
    if (parameters.minimumWavelength >= parameters.maximumWavelength) throw new RangeError('Water field wavelengths must increase.');
    const flow = value.flow ?? [0, 0];
    if ((!Array.isArray(flow) && !ArrayBuffer.isView(flow)) || flow.length !== 2 || !Array.from(flow).every(v => Number.isFinite(v) && Math.abs(v) <= 100)) {
        throw new RangeError('Water field flow requires two finite velocities in [-100, 100] m/s.');
    }
    parameters.flow = Object.freeze(Array.from(flow));
    return Object.freeze(parameters);
}

/** Source, parameters and seed are saved authority. Normalization never
 * regenerates edited WGSL or converts continuous analytic modes to lattice k. */
export function normalizeWaterFieldRecipe(value) {
    if (!value || value.version !== WATER_FIELD_VERSION || !['spectral-wind-v2', 'analytic-cache-v2'].includes(value.model)) {
        throw new TypeError('Unsupported water field recipe.');
    }
    const supportedKeys = new Set(['version', 'model', 'seed', 'parameters', 'settings', 'sourceWGSL', 'sourceHash', 'algorithm', 'normalization', 'domains', 'cacheDomainLength', 'spectrum']);
    for (const key of Object.keys(value)) if (!supportedKeys.has(key)) throw new TypeError(`Unknown water field recipe property ${key}.`);
    if (value.algorithm !== undefined && value.algorithm !== 'seeded-gaussian-complementary-lattice-v2') throw new TypeError('Unsupported water field coefficient algorithm.');
    if (value.normalization !== undefined && value.normalization !== 'reference-density') throw new TypeError('Unsupported water field normalization.');
    const seed = value.seed ?? 5471;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Water field seed must be uint32.');
    const parameters = normalizeWaterFieldParameters(value.parameters ?? value.settings);
    if (value.domains !== undefined && (!Array.isArray(value.domains) || value.domains.length !== 3 || value.domains.some((length, index) => length !== WATER_FIELD_DOMAINS[index]))) {
        throw new RangeError('Spectral water domains are the versioned [256, 32, 4] metre ABI.');
    }
    const sourceWGSL = value.sourceWGSL;
    if (typeof sourceWGSL !== 'string' || sourceWGSL.length === 0 || sourceWGSL.length > 512 * 1024) throw new RangeError('Water field requires bounded saved WGSL source.');
    const entry = value.model === 'spectral-wind-v2' ? 'waterFieldSpectralDensity' : 'waterFieldSourceSample';
    if (!new RegExp(`\\bfn\\s+${entry}\\s*\\(`).test(sourceWGSL)) throw new TypeError(`Water field source requires ${entry}().`);
    if (/@(?:group|binding|compute|vertex|fragment)\b/.test(sourceWGSL)) throw new TypeError('Saved water field source must be resource-free functions.');
    const sourceHash = fnv1aStringCodeUnit32(sourceWGSL).toString(16).padStart(8, '0');
    if (value.sourceHash !== undefined && value.sourceHash !== sourceHash) throw new Error('Water field saved source hash does not match its source.');
    const cacheDomainLength = value.cacheDomainLength ?? 32;
    if (!Number.isFinite(cacheDomainLength) || cacheDomainLength < 0.25 || cacheDomainLength > 10000) throw new RangeError('Water analytic cache length must be in [0.25, 10000] m.');
    const spectrum = value.spectrum ? normalizeOceanSpectrum(value.spectrum) : undefined;
    return Object.freeze({ version: WATER_FIELD_VERSION, model: value.model, seed, parameters, sourceWGSL, sourceHash,
        algorithm: 'seeded-gaussian-complementary-lattice-v2', normalization: 'reference-density',
        domains: WATER_FIELD_DOMAINS, cacheDomainLength, ...(spectrum ? { spectrum } : {}) });
}

export function createWaterFieldRecipe(options = {}) {
    return normalizeWaterFieldRecipe({ ...options, version: WATER_FIELD_VERSION, model: 'spectral-wind-v2',
        sourceWGSL: options.sourceWGSL ?? WATER_FIELD_DENSITY_WGSL });
}

/** An explicit migration/cache opt-in. The legacy source and every authored
 * continuous coefficient survive verbatim; no FFT-bin approximation occurs. */
export function createAnalyticWaterFieldRecipe(options = {}) {
    let sourceWGSL = options.sourceWGSL;
    let spectrum;
    if (sourceWGSL === undefined && options.spectrum) {
        spectrum = normalizeOceanSpectrum(options.spectrum);
        sourceWGSL = `${OCEAN_SPECTRUM_TYPES_WGSL}\n${createOceanSpectrumWGSL(spectrum)}\n
fn waterFieldSourceSample(q: vec2f, time: f32) -> WaterFieldSourceSample {
 let s = oceanSpectrumSample(q, time, 0.0);
 return WaterFieldSourceSample(s.displacement, s.tangentX, s.tangentZ, s.velocity);
}`;
    }
    return normalizeWaterFieldRecipe({ ...options, ...(spectrum ? { spectrum } : {}), version: WATER_FIELD_VERSION,
        model: 'analytic-cache-v2', sourceWGSL });
}
