// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { EARTH_GRAVITY, TAU } from '../../core/math/MathConstants.js';
import { smoothstep } from '../../core/math/MathScalar.js';
import { mulberry32, normalDistribution } from '../../core/math/MathRandom.js';
import { textureMipLevelCount, textureMipByteSize } from '../../core/math/TextureMath.js';
import { WATER_FIELD_DOMAINS, normalizeWaterFieldRecipe } from './WaterFieldRecipe.js';

const referenceRecipes = new WeakMap();

/** Partition of unity in k. Adjacent domains share a transition, never a
 * duplicated full-strength ripple family. Frequencies above the first two
 * domains' usable Nyquist move to the next, physically smaller domain. */
export function waterFieldBandWeights(k) {
    const middle = smoothstep(0.55, 0.95, k), short = smoothstep(4.4, 7.5, k);
    return [1 - middle, middle * (1 - short), middle * short];
}

/** Project-owned 2D wind density. k^-4 is a Cartesian density; unlike the
 * legacy log-k quadrature it does not include a polar integration measure. */
export function waterFieldSpectralDensity(kx, kz, parameters) {
    const p = parameters, k = Math.hypot(kx, kz);
    if (k < TAU / p.maximumWavelength || k > TAU / p.minimumWavelength) return 0;
    const windLength = p.windSpeed * p.windSpeed / EARTH_GRAVITY;
    const alignment = (kx * Math.cos(p.windDirection) + kz * Math.sin(p.windDirection)) / k;
    const direction = 0.025 + 0.975 * Math.max(0, (1 + alignment) * 0.5) ** (16 - 14.7 * p.directionalSpread);
    return Math.exp(-1 / (k * windLength) ** 2 - (k * p.shortWaveDamping) ** 2) * direction / k ** 4;
}

function gridResolution(value) {
    if (!Number.isSafeInteger(value) || value < 4 || value > 256 || (value & (value - 1)) !== 0) throw new RangeError('Water grid must be a power of two in [4, 256].');
    return value;
}

/** Gaussian draws keyed by signed physical lattice indices keep all common
 * coefficients and phases stable when resolution changes from128 to256. */
export function createWaterFieldSeedData(value, resolution = 128) {
    const recipe = normalizeWaterFieldRecipe(value), size = gridResolution(resolution), count = size * size;
    const data = new Float32Array(count * 3 * 4);
    let referenceVariance = 0;
    const slopeMoments = [0, 0, 0], domainVariance = [0, 0, 0];
    for (let layer = 0; layer < 3; layer++) {
        const step = TAU / WATER_FIELD_DOMAINS[layer];
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const nx = x < size / 2 ? x : x - size, nz = y < size / 2 ? y : y - size;
            const kx = nx * step, kz = nz * step, k = Math.hypot(kx, kz);
            // Drop the self-conjugate Nyquist row/column: their odd horizontal
            // derivative cannot be represented as a real periodic field.
            const weight = x === size / 2 || y === size / 2 ? 0 : waterFieldBandWeights(k)[layer];
            const density = waterFieldSpectralDensity(kx, kz, recipe.parameters) * weight * step * step;
            referenceVariance += density; domainVariance[layer] += density;
            slopeMoments[0] += density * kx * kx; slopeMoments[1] += density * kx * kz; slopeMoments[2] += density * kz * kz;
            const key = (recipe.seed ^ Math.imul(nx, 0x85ebca6b) ^ Math.imul(nz, 0xc2b2ae35) ^ Math.imul(layer + 1, 0x27d4eb2d)) >>> 0;
            const random = mulberry32(key), safeRandom = () => Math.max(random(), 1 / 4294967296);
            const offset = (layer * count + y * size + x) * 4;
            data[offset] = normalDistribution(0, 1, safeRandom); data[offset + 1] = normalDistribution(0, 1, safeRandom);
            data[offset + 2] = kx; data[offset + 3] = kz;
        }
    }
    const heightSigma = recipe.parameters.significantWaveHeight / 4;
    const normalization = referenceVariance > 0 ? heightSigma / Math.sqrt(referenceVariance) : 0;
    return { data, resolution: size, normalization, referenceVariance, heightSigma,
        domainVariance: domainVariance.map(v => v * normalization ** 2), slopeMoments: slopeMoments.map(v => v * normalization ** 2) };
}

/** All residency is counted before allocating candidates. GPU textures use
 * TextureMath's complete mip accounting; FFT scratch follows its complex ABI. */
export function waterFieldResourceByteSize(resolution = 128, model = 'spectral-wind-v2') {
    const size = gridResolution(resolution), levels = textureMipLevelCount(size), count = size * size;
    const fieldTextureBytes = 5 * textureMipByteSize(size, size, 8, levels, 3);
    // Compatibility mode cannot read and write different views of one texture
    // in a dispatch. One half-resolution output is copied into each linear mip.
    const mipScratchBytes = textureMipByteSize(size / 2, size / 2, 8, 1, 15);
    const textureBytes = fieldTextureBytes + mipScratchBytes;
    // Two real Hermitian fields share one complex transform. The three domains
    // reuse one six-batch scratch pair in encoder order.
    const fftBytes = model === 'spectral-wind-v2' ? 2 * count * 6 * 8 + 2 * (Math.log2(size) + 1) * 32 : 0;
    const seedBytes = model === 'spectral-wind-v2' ? count * 3 * 16 : 0;
    // Frame+evolution uniforms, and one independent32-byte mip dispatch uniform
    // per level. No same-buffer write is reused between recorded dispatches.
    const uniformBytes = 64 + 3 * 96 + (levels - 1) * 32;
    return { resolution: size, mipLevels: levels, fieldTextureBytes, mipScratchBytes, textureBytes, fftBytes, seedBytes, uniformBytes,
        totalBytes: textureBytes + fftBytes + seedBytes + uniformBytes };
}

/** Consume the host governor decision; this module owns no competing governor. */
export function waterFieldQuality(qualityDecision = {}, requestedResolution) {
    qualityDecision ??= {};
    const resolution = requestedResolution ?? qualityDecision.waterFieldResolution ?? 128;
    if (![128, 256].includes(resolution)) throw new RangeError('Water field runtime resolution must be128 or256.');
    const tier = qualityDecision.tier ?? qualityDecision.name ?? 'high';
    const activeLayers = Math.max(1, Math.min(3, Math.floor(qualityDecision.waterFieldLayers ?? (tier === 'emergency' ? 1 : tier === 'performance' ? 2 : 3))));
    return Object.freeze({ resolution, activeLayers, updateStride: Math.max(1, Math.floor(qualityDecision.updateStride ?? 1)), tier });
}

/** CPU reference for one evolved Hermitian coefficient, used by independent
 * derivative/energy checks. Edited WGSL density cannot be interpreted as JS. */
export function waterFieldFrequency(seed, recipeValue, layer, x, y, time) {
    let recipe = referenceRecipes.get(recipeValue);
    if (!recipe) {
        recipe = normalizeWaterFieldRecipe(recipeValue);
        if (Object.isFrozen(recipeValue)) referenceRecipes.set(recipeValue, recipe);
    }
    const p = recipe.parameters;
    const size = seed.resolution, count = size * size, offset = (layer * count + y * size + x) * 4;
    const opposite = (layer * count + ((size - y) % size) * size + (size - x) % size) * 4;
    const kx = seed.data[offset + 2], kz = seed.data[offset + 3], k = Math.hypot(kx, kz), step = TAU / WATER_FIELD_DOMAINS[layer];
    const gain = (index, ax, az) => Math.sqrt(Math.max(0, waterFieldSpectralDensity(ax, az, p) * waterFieldBandWeights(k)[layer]) * step * step / 4) * count * seed.normalization;
    const scale = x === size / 2 || y === size / 2 ? 0 : gain(offset, kx, kz), mirrorScale = x === size / 2 || y === size / 2 ? 0 : gain(opposite, -kx, -kz);
    const omega = Math.sqrt(EARTH_GRAVITY * k * Math.tanh(k * p.depth)), flowOmega = kx * p.flow[0] + kz * p.flow[1];
    const rotate = (re, im, phase) => [re * Math.cos(phase) - im * Math.sin(phase), re * Math.sin(phase) + im * Math.cos(phase)];
    const a = rotate(seed.data[offset] * scale, seed.data[offset + 1] * scale, (-omega - flowOmega) * time);
    const b = rotate(seed.data[opposite] * mirrorScale, -seed.data[opposite + 1] * mirrorScale, (omega - flowOmega) * time);
    const height = [a[0] + b[0], a[1] + b[1]];
    const velocity = [a[1] * (omega + flowOmega) - b[1] * (omega - flowOmega), -a[0] * (omega + flowOmega) + b[0] * (omega - flowOmega)];
    return { height, velocity, kx, kz, omega };
}
