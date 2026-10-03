// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Deterministic, tileable procedural PBR texture generation.
 *
 * The generator is deliberately data-only: callers choose one registered
 * pattern and one output channel. No script or callback crosses this boundary.
 * Identical descriptors always produce identical RGBA8 bytes.
 */

export const PROCEDURAL_PBR_GENERATOR_ID = 'engine.procedural-pbr';
export const PROCEDURAL_PBR_GENERATOR_VERSION = '1.0.0';

export const PROCEDURAL_PBR_PATTERNS = Object.freeze([
    'wood',
    'plywood',
    'osb',
    'brushed-metal',
    'galvanized-metal',
    'woven-fabric',
    'foam',
    'smooth-rubber',
    'ribbed-rubber',
    'block-tread-rubber',
    'fired-clay',
    'mortar',
    'concrete',
    'gypsum',
    'asphalt',
    'paint',
]);

export const PROCEDURAL_PBR_CHANNELS = Object.freeze([
    'baseColor',
    'normal',
    'metallicRoughness',
    'occlusion',
]);

const PATTERN_SET = new Set(PROCEDURAL_PBR_PATTERNS);
const CHANNEL_SET = new Set(PROCEDURAL_PBR_CHANNELS);

function finite(value, path, minimum, maximum) {
    if (typeof value !== 'number' || !Number.isFinite(value)
        || value < minimum || value > maximum) {
        throw new TypeError(`${path} must be finite in [${minimum}, ${maximum}]`);
    }
    return value;
}

function positiveInteger(value, path, maximum = 2048) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new TypeError(`${path} must be a positive safe integer no greater than ${maximum}`);
    }
    return value;
}

function byte(value) {
    return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function mix(left, right, amount) {
    return left + (right - left) * amount;
}

function smoothstep(edge0, edge1, value) {
    const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-9, edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function hash32(x, y, seed) {
    let value = (Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ seed) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d) >>> 0;
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b) >>> 0;
    value ^= value >>> 16;
    return value >>> 0;
}

function noise01(x, y, seed, periodX, periodY) {
    const wrappedX = ((x % periodX) + periodX) % periodX;
    const wrappedY = ((y % periodY) + periodY) % periodY;
    return hash32(wrappedX, wrappedY, seed) / 0xffffffff;
}

function periodicValueNoise(u, v, seed, cellsX, cellsY) {
    const x = u * cellsX;
    const y = v * cellsY;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep(0, 1, x - x0);
    const ty = smoothstep(0, 1, y - y0);
    const a = noise01(x0, y0, seed, cellsX, cellsY);
    const b = noise01(x0 + 1, y0, seed, cellsX, cellsY);
    const c = noise01(x0, y0 + 1, seed, cellsX, cellsY);
    const d = noise01(x0 + 1, y0 + 1, seed, cellsX, cellsY);
    return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

function periodicFbm(u, v, seed) {
    let value = 0;
    let amplitude = 0.58;
    let weight = 0;
    for (let octave = 0; octave < 4; octave += 1) {
        const cells = 4 << octave;
        value += periodicValueNoise(u, v, seed + octave * 1013, cells, cells) * amplitude;
        weight += amplitude;
        amplitude *= 0.5;
    }
    return value / weight;
}

function periodicCycles(scale, baseCycles) {
    return Math.max(1, Math.round(scale * baseCycles));
}

function patternHeight(pattern, u, v, seed, scale) {
    const tau = Math.PI * 2;
    const fine = periodicFbm(u, v, seed);
    if (pattern === 'wood') {
        const warp = (periodicValueNoise(u, v, seed + 17, 8, 8) - 0.5) * 1.6;
        return 0.5 + Math.sin((u * periodicCycles(scale, 7) + warp) * tau) * 0.18 + (fine - 0.5) * 0.20;
    }
    if (pattern === 'plywood') {
        const ply = Math.sin((v * periodicCycles(scale, 11) + Math.sin(u * tau * 2) * 0.12) * tau);
        return 0.5 + ply * 0.13 + (fine - 0.5) * 0.24;
    }
    if (pattern === 'osb') {
        const strandA = Math.abs(Math.sin((u * periodicCycles(scale, 10) + v * periodicCycles(scale, 2)) * tau));
        const strandB = Math.abs(Math.sin((u * periodicCycles(scale, 2) - v * periodicCycles(scale, 9)) * tau));
        return 0.30 + strandA * 0.32 + strandB * 0.18 + fine * 0.20;
    }
    if (pattern === 'brushed-metal') {
        return 0.46 + Math.sin(v * periodicCycles(scale, 48) * tau) * 0.08 + (fine - 0.5) * 0.08;
    }
    if (pattern === 'galvanized-metal') {
        const crystal = periodicValueNoise(u, v, seed + 31, 24, 24);
        return 0.38 + Math.abs(crystal - 0.5) * 0.76 + (fine - 0.5) * 0.10;
    }
    if (pattern === 'woven-fabric') {
        const weaveCycles = periodicCycles(scale, 18);
        const warp = Math.pow(0.5 + 0.5 * Math.sin(u * weaveCycles * tau), 6);
        const weft = Math.pow(0.5 + 0.5 * Math.sin(v * weaveCycles * tau), 6);
        return 0.28 + Math.max(warp, weft) * 0.54 + (fine - 0.5) * 0.08;
    }
    if (pattern === 'foam') return 0.34 + fine * 0.50;
    if (pattern === 'ribbed-rubber') {
        return 0.34 + smoothstep(0.48, 0.82, 0.5 + 0.5 * Math.sin(u * periodicCycles(scale, 6) * tau)) * 0.50;
    }
    if (pattern === 'block-tread-rubber') {
        const blockU = Math.abs(Math.sin(u * periodicCycles(scale, 5) * tau));
        const blockV = Math.abs(Math.sin(v * periodicCycles(scale, 8) * tau));
        return 0.30 + smoothstep(0.32, 0.62, Math.min(blockU, blockV)) * 0.58;
    }
    if (pattern === 'smooth-rubber') return 0.46 + (fine - 0.5) * 0.10;
    if (pattern === 'fired-clay') return 0.37 + fine * 0.38;
    if (pattern === 'mortar') return 0.42 + fine * 0.26;
    if (pattern === 'concrete') {
        const aggregate = noise01(Math.floor(u * 64), Math.floor(v * 64), seed + 47, 64, 64);
        return 0.36 + fine * 0.24 + (aggregate > 0.88 ? 0.28 : 0);
    }
    if (pattern === 'gypsum') return 0.48 + (fine - 0.5) * 0.08;
    if (pattern === 'asphalt') {
        const granule = noise01(Math.floor(u * 96), Math.floor(v * 96), seed + 79, 96, 96);
        return 0.22 + fine * 0.24 + granule * 0.36;
    }
    return 0.50 + (fine - 0.5) * 0.045;
}

export function normalizeProceduralPbrDescriptor(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('Procedural PBR descriptor must be a plain object');
    }
    const generatorId = input.generatorId ?? PROCEDURAL_PBR_GENERATOR_ID;
    const generatorVersion = input.generatorVersion ?? PROCEDURAL_PBR_GENERATOR_VERSION;
    if (generatorId !== PROCEDURAL_PBR_GENERATOR_ID || generatorVersion !== PROCEDURAL_PBR_GENERATOR_VERSION) {
        throw new TypeError('Procedural PBR descriptor names an unregistered generator');
    }
    const pattern = String(input.pattern ?? 'paint');
    const channel = String(input.channel ?? 'baseColor');
    if (!PATTERN_SET.has(pattern)) throw new TypeError(`Unsupported procedural PBR pattern '${pattern}'`);
    if (!CHANNEL_SET.has(channel)) throw new TypeError(`Unsupported procedural PBR channel '${channel}'`);
    const width = positiveInteger(input.width ?? 64, '$.width');
    const height = positiveInteger(input.height ?? 64, '$.height');
    const seed = input.seed ?? 0;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
        throw new TypeError('$.seed must be a uint32 safe integer');
    }
    const baseColor = input.baseColor ?? [0.5, 0.5, 0.5, 1];
    if (!Array.isArray(baseColor) || baseColor.length !== 4) throw new TypeError('$.baseColor must be RGBA');
    const normalizedColor = baseColor.map((value, index) => finite(value, `$.baseColor[${index}]`, 0, 1));
    return Object.freeze({
        generatorId,
        generatorVersion,
        pattern,
        channel,
        width,
        height,
        seed,
        baseColor: Object.freeze(normalizedColor),
        scale: finite(input.scale ?? 1, '$.scale', 0.125, 64),
        variation: finite(input.variation ?? 0.22, '$.variation', 0, 1),
        roughness: finite(input.roughness ?? 0.72, '$.roughness', 0, 1),
        metallic: finite(input.metallic ?? 0, '$.metallic', 0, 1),
        normalStrength: finite(input.normalStrength ?? 1, '$.normalStrength', 0, 8),
        occlusionStrength: finite(input.occlusionStrength ?? 0.35, '$.occlusionStrength', 0, 1),
    });
}

export function generateProceduralPbrTexture(input = {}) {
    const descriptor = normalizeProceduralPbrDescriptor(input);
    const { width, height } = descriptor;
    const heights = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            heights[y * width + x] = Math.max(0, Math.min(1, patternHeight(
                descriptor.pattern,
                x / width,
                y / height,
                descriptor.seed,
                descriptor.scale,
            )));
        }
    }
    const sample = (x, y) => heights[(((y + height) % height) * width) + ((x + width) % width)];
    const bytes = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const heightValue = sample(x, y);
            const offset = (y * width + x) * 4;
            if (descriptor.channel === 'normal') {
                const dx = (sample(x + 1, y) - sample(x - 1, y)) * descriptor.normalStrength;
                const dy = (sample(x, y + 1) - sample(x, y - 1)) * descriptor.normalStrength;
                const inverseLength = 1 / Math.hypot(dx, dy, 1);
                bytes[offset] = byte((-dx * inverseLength) * 0.5 + 0.5);
                bytes[offset + 1] = byte((-dy * inverseLength) * 0.5 + 0.5);
                bytes[offset + 2] = byte(inverseLength * 0.5 + 0.5);
                bytes[offset + 3] = 255;
            } else if (descriptor.channel === 'metallicRoughness') {
                const roughnessVariation = (heightValue - 0.5) * descriptor.variation * 0.5;
                bytes[offset] = 255;
                bytes[offset + 1] = byte(Math.max(0.04, Math.min(1, descriptor.roughness + roughnessVariation)));
                bytes[offset + 2] = byte(descriptor.metallic);
                bytes[offset + 3] = 255;
            } else if (descriptor.channel === 'occlusion') {
                const ao = 1 - Math.max(0, 0.5 - heightValue) * 2 * descriptor.occlusionStrength;
                const value = byte(ao);
                bytes[offset] = value;
                bytes[offset + 1] = value;
                bytes[offset + 2] = value;
                bytes[offset + 3] = 255;
            } else {
                const multiplier = 1 + (heightValue - 0.5) * 2 * descriptor.variation;
                bytes[offset] = byte(descriptor.baseColor[0] * multiplier);
                bytes[offset + 1] = byte(descriptor.baseColor[1] * multiplier);
                bytes[offset + 2] = byte(descriptor.baseColor[2] * multiplier);
                bytes[offset + 3] = byte(descriptor.baseColor[3]);
            }
        }
    }
    return Object.freeze({ descriptor, bytes });
}

export default generateProceduralPbrTexture;
