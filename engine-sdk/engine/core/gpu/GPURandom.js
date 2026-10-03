// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    DETERMINISTIC_RNG_SEED32_V2_WGSL,
    deterministicRngEntitySeed32,
    deterministicRngEntitySeed32V1,
    deterministicRngInteractionSeed32,
    deterministicRngInteractionSeed32V1,
    LEGACY_DETERMINISTIC_RNG_SEED32_WGSL,
    LEGACY_PCG32_WGSL,
    legacyDeterministicRngPositionSeed32,
    legacyDeterministicRngTickSeed32,
    legacyPcgAdvanceState32,
    legacyPcgHash32,
    legacyPcgOutput32,
} from '../math/MathBits.js';

/**
 * GPURandom.js - Deterministic Random Number Generation for Multiplayer
 * 
 * Based on techniques from jakubg05/Laura path tracing engine.
 * 
 * ⚠️ MULTIPLAYER CRITICAL: All RNG in this file is DETERMINISTIC.
 * Given the same seed, the same sequence of numbers is produced.
 * This is REQUIRED for multiplayer synchronization.
 * 
 * Usage for Multiplayer Sync:
 * 1. Use world seed + tick number for world generation
 * 2. Use entity ID + tick for per-entity random (AI, particles, etc.)
 * 3. NEVER use Date.now() or Math.random() for gameplay - only for visuals
 * 
 * Features:
 * - PCG (Permuted Congruential Generator) hash - high quality, fast, deterministic
 * - Tick-based seeding for multiplayer synchronization
 * - Entity-based random streams (same entity = same random on all clients)
 * - Per-pixel seeded random for deterministic noise
 * - Box-Muller transform for normal distribution
 * - Hemisphere sampling for AO/GI
 * - Frame accumulation for progressive rendering
 */

// ============================================================================
// WGSL SHADER CODE - GPU RANDOM UTILITIES
// ============================================================================

/**
 * WGSL code for PCG hash and random number generation
 * Include this in your compute shaders for high-quality randomness
 */
export const GPU_RANDOM_CORE_WGSL = /* wgsl */ `
// ============================================================================
// PCG HASH - Permuted Congruential Generator
// High quality, fast hash function for GPU random number generation
// Based on: https://www.pcg-random.org
// ============================================================================

fn pcg_hash(v: u32) -> u32 {
    return legacyPcgHash32(v);
}

// Hash a 2D coordinate to a single u32
fn hash2D(x: u32, y: u32) -> u32 {
    return pcg_hash(x ^ (y * 15823u));
}

// Hash a 3D coordinate to a single u32
fn hash3D(x: u32, y: u32, z: u32) -> u32 {
    return pcg_hash(x ^ (y * 15823u) ^ (z * 53729u));
}

// ============================================================================
// SEEDED RANDOM STATE
// Deterministic random per pixel/frame/sample
// ============================================================================

fn initRngState(pixel: vec2<u32>, frame: u32, sampleIdx: u32) -> u32 {
    var s = (pixel.x * 1973u)
          ^ (pixel.y * 9277u)
          ^ (frame * 26699u)
          ^ (sampleIdx * 374761393u);
    s ^= 0x9E3779B9u; // Golden ratio constant
    return pcg_hash(s);
}

// Advance RNG state and return random float in [0, 1)
fn randomFloat(state: ptr<function, u32>) -> f32 {
    return legacyPcgRandomFloat01(state);
}

// Random float in range [min, max)
fn randomFloatRange(state: ptr<function, u32>, minVal: f32, maxVal: f32) -> f32 {
    return minVal + randomFloat(state) * (maxVal - minVal);
}

// Random integer in range [0, max)
fn randomInt(state: ptr<function, u32>, maxVal: u32) -> u32 {
    return u32(randomFloat(state) * f32(maxVal));
}

// ============================================================================
// NORMAL DISTRIBUTION (Box-Muller Transform)
// For Gaussian blur, scatter effects, etc.
// ============================================================================

const PI: f32 = 3.14159265359;
const TWO_PI: f32 = 6.28318530718;

fn randomNormal(state: ptr<function, u32>) -> f32 {
    let u1 = max(randomFloat(state), 1e-10); // Avoid log(0)
    let u2 = randomFloat(state);
    return sqrt(-2.0 * log(u1)) * cos(TWO_PI * u2);
}

// Random value from normal distribution with mean and stddev
fn randomGaussian(state: ptr<function, u32>, mean: f32, stddev: f32) -> f32 {
    return mean + stddev * randomNormal(state);
}

// ============================================================================
// DIRECTION SAMPLING
// For ambient occlusion, global illumination, soft shadows
// ============================================================================

// Random direction on unit sphere (uniform distribution)
fn randomDirection(state: ptr<function, u32>) -> vec3<f32> {
    let x = randomNormal(state);
    let y = randomNormal(state);
    let z = randomNormal(state);
    return normalize(vec3<f32>(x, y, z));
}

// Random direction in hemisphere around normal (uniform)
fn randomHemisphere(state: ptr<function, u32>, normal: vec3<f32>) -> vec3<f32> {
    let dir = randomDirection(state);
    return select(-dir, dir, dot(dir, normal) > 0.0);
}

// Cosine-weighted hemisphere sampling (for diffuse lighting)
// More samples near normal = more accurate diffuse approximation
fn cosineWeightedHemisphere(state: ptr<function, u32>, normal: vec3<f32>) -> vec3<f32> {
    return normalize(normal + randomDirection(state));
}

// Random point in unit disk (for DOF, area lights)
fn randomInDisk(state: ptr<function, u32>) -> vec2<f32> {
    let r = sqrt(randomFloat(state));
    let theta = TWO_PI * randomFloat(state);
    return vec2<f32>(r * cos(theta), r * sin(theta));
}

// Random point in unit sphere
fn randomInSphere(state: ptr<function, u32>) -> vec3<f32> {
    let r = pow(randomFloat(state), 1.0 / 3.0);
    return r * randomDirection(state);
}

// ============================================================================
// FRAME ACCUMULATION
// Progressive rendering with temporal averaging
// ============================================================================

// Compute accumulation weight for frame N (returns weight for new sample)
fn accumulationWeight(frameIndex: u32) -> f32 {
    return 1.0 / f32(frameIndex + 1u);
}

// Blend old and new color with accumulation
fn accumulateColor(oldColor: vec3<f32>, newColor: vec3<f32>, frameIndex: u32) -> vec3<f32> {
    let weight = accumulationWeight(frameIndex);
    return oldColor * (1.0 - weight) + newColor * weight;
}

// Accumulate with exponential moving average (for real-time, non-converging)
fn accumulateEMA(oldColor: vec3<f32>, newColor: vec3<f32>, alpha: f32) -> vec3<f32> {
    return mix(oldColor, newColor, alpha);
}

// ============================================================================
// SPECTRAL WAVELENGTH HEAT MAP
// Alternative to inferno - maps values to visible light spectrum
// ============================================================================

fn wavelengthToRGB(wavelength: f32) -> vec3<f32> {
    var color: vec3<f32>;
    let w = wavelength;
    
    if (w <= 380.0) { 
        color = vec3<f32>(0.0); 
    } else if (w <= 440.0) { 
        color = vec3<f32>((440.0 - w) / (440.0 - 380.0) / 3.0, 0.0, 0.8); 
    } else if (w <= 490.0) { 
        color = vec3<f32>(0.0, (w - 440.0) / (490.0 - 440.0), 1.0); 
    } else if (w <= 510.0) { 
        color = vec3<f32>(0.0, 1.0, (510.0 - w) / (510.0 - 490.0)); 
    } else if (w <= 580.0) { 
        color = vec3<f32>((w - 510.0) / (580.0 - 510.0), 1.0, 0.0); 
    } else if (w <= 645.0) { 
        color = vec3<f32>(1.0, (645.0 - w) / (645.0 - 580.0), 0.0); 
    } else if (w <= 780.0) { 
        color = vec3<f32>(1.0, 0.0, 0.0); 
    } else { 
        color = vec3<f32>(1.0); 
    }
    
    // Intensity correction
    var factor: f32;
    if (w >= 380.0 && w < 420.0) { 
        factor = 0.3 + 0.7 * (w - 380.0) / 40.0; 
    } else if (w >= 420.0 && w < 701.0) { 
        factor = 1.0; 
    } else if (w >= 701.0 && w < 781.0) { 
        factor = 0.3 + 0.7 * (780.0 - w) / 80.0; 
    } else { 
        factor = 0.0; 
    }
    
    return pow(factor * color, vec3<f32>(0.8)); // Gamma correction
}

// Map normalized value [0,1] to spectral color (violet to red)
fn spectralHeatMap(t: f32) -> vec3<f32> {
    let wavelength = 380.0 + 370.0 * clamp(t, 0.0, 1.0);
    return wavelengthToRGB(wavelength);
}

// Map count to spectral color with configurable cutoff
fn countToSpectral(count: u32, cutoff: u32) -> vec3<f32> {
    let t = clamp(f32(count) / max(1.0, f32(cutoff)), 0.0, 1.0);
    return spectralHeatMap(t);
}
`;

export const GPU_RANDOM_WGSL = /* wgsl */ `
${LEGACY_PCG32_WGSL}
${GPU_RANDOM_CORE_WGSL}
`;

// ============================================================================
// CPU IMPLEMENTATIONS - JavaScript versions
// ============================================================================

/**
 * PCG hash function - high quality, fast
 * @param {number} v - Input value (32-bit integer)
 * @returns {number} Hashed value (32-bit integer)
 */
export function pcgHash(v) {
    return legacyPcgHash32(v);
}

/**
 * Hash 2D coordinates
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {number} Hash value
 */
export function hash2D(x, y) {
    return pcgHash((x >>> 0) ^ Math.imul(y >>> 0, 15823));
}

/**
 * Hash 3D coordinates
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} z - Z coordinate
 * @returns {number} Hash value
 */
export function hash3D(x, y, z) {
    return pcgHash((x >>> 0) ^ Math.imul(y >>> 0, 15823) ^ Math.imul(z >>> 0, 53729));
}

/**
 * Initialize RNG state for deterministic per-pixel random
 * @param {number} pixelX - Pixel X coordinate
 * @param {number} pixelY - Pixel Y coordinate
 * @param {number} frame - Frame number
 * @param {number} sampleIdx - Sample index within frame
 * @returns {number} Initial RNG state
 */
export function initRngState(pixelX, pixelY, frame, sampleIdx = 0) {
    let s = Math.imul(pixelX >>> 0, 1973)
          ^ Math.imul(pixelY >>> 0, 9277)
          ^ Math.imul(frame >>> 0, 26699)
          ^ Math.imul(sampleIdx >>> 0, 374761393);
    s ^= 0x9E3779B9; // Golden ratio
    return pcgHash(s >>> 0);
}

/**
 * RNG state wrapper for sequential random number generation
 */
export class PCGRandom {
    constructor(seed = Date.now()) {
        this.state = pcgHash(seed >>> 0);
    }
    
    /**
     * Seed the RNG for deterministic sequences
     * @param {number} seed - Seed value
     */
    seed(seed) {
        this.state = pcgHash(seed >>> 0);
    }
    
    /**
     * Seed from pixel/frame/sample for reproducible noise
     * @param {number} pixelX - Pixel X
     * @param {number} pixelY - Pixel Y
     * @param {number} frame - Frame number
     * @param {number} sampleIdx - Sample index
     */
    seedPixel(pixelX, pixelY, frame, sampleIdx = 0) {
        this.state = initRngState(pixelX, pixelY, frame, sampleIdx);
    }
    
    /**
     * Get next random float in [0, 1)
     * @returns {number} Random float
     */
    float() {
        this.state = legacyPcgAdvanceState32(this.state);
        return legacyPcgOutput32(this.state) / 4294967295;
    }
    
    /**
     * Get random float in range [min, max)
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {number} Random float in range
     */
    range(min, max) {
        return min + this.float() * (max - min);
    }
    
    /**
     * Get random integer in [0, max)
     * @param {number} max - Exclusive maximum
     * @returns {number} Random integer
     */
    int(max) {
        return Math.floor(this.float() * max);
    }
    
    /**
     * Get random value from normal distribution (Box-Muller)
     * @param {number} mean - Mean of distribution
     * @param {number} stddev - Standard deviation
     * @returns {number} Random normal value
     */
    gaussian(mean = 0, stddev = 1) {
        const u1 = Math.max(this.float(), 1e-10);
        const u2 = this.float();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return mean + stddev * z;
    }
    
    /**
     * Get random direction on unit sphere
     * @returns {number[]} [x, y, z] normalized direction
     */
    direction() {
        const x = this.gaussian();
        const y = this.gaussian();
        const z = this.gaussian();
        const len = Math.sqrt(x * x + y * y + z * z);
        return [x / len, y / len, z / len];
    }
    
    /**
     * Get random direction in hemisphere around normal
     * @param {number[]} normal - [x, y, z] normal vector
     * @returns {number[]} [x, y, z] random direction in hemisphere
     */
    hemisphere(normal) {
        const dir = this.direction();
        const dot = dir[0] * normal[0] + dir[1] * normal[1] + dir[2] * normal[2];
        if (dot < 0) {
            return [-dir[0], -dir[1], -dir[2]];
        }
        return dir;
    }
    
    /**
     * Get cosine-weighted hemisphere direction (for diffuse)
     * @param {number[]} normal - [x, y, z] normal vector
     * @returns {number[]} [x, y, z] cosine-weighted direction
     */
    cosineHemisphere(normal) {
        const rand = this.direction();
        const x = normal[0] + rand[0];
        const y = normal[1] + rand[1];
        const z = normal[2] + rand[2];
        const len = Math.sqrt(x * x + y * y + z * z);
        return [x / len, y / len, z / len];
    }
    
    /**
     * Get random point in unit disk
     * @returns {number[]} [x, y] point in disk
     */
    inDisk() {
        const r = Math.sqrt(this.float());
        const theta = 2 * Math.PI * this.float();
        return [r * Math.cos(theta), r * Math.sin(theta)];
    }
    
    /**
     * Get random point in unit sphere
     * @returns {number[]} [x, y, z] point in sphere
     */
    inSphere() {
        const r = Math.pow(this.float(), 1 / 3);
        const dir = this.direction();
        return [r * dir[0], r * dir[1], r * dir[2]];
    }
}

// ============================================================================
// FRAME ACCUMULATION UTILITIES
// ============================================================================

/**
 * Calculate accumulation weight for progressive rendering
 * @param {number} frameIndex - Current frame index (0-based)
 * @returns {number} Weight for new sample (1/(frameIndex+1))
 */
export function accumulationWeight(frameIndex) {
    return 1 / (frameIndex + 1);
}

/**
 * Accumulate color over frames (progressive rendering)
 * @param {number[]} oldColor - Previous accumulated color [r, g, b]
 * @param {number[]} newColor - New sample color [r, g, b]
 * @param {number} frameIndex - Current frame index
 * @returns {number[]} Accumulated color [r, g, b]
 */
export function accumulateColor(oldColor, newColor, frameIndex) {
    const w = accumulationWeight(frameIndex);
    return [
        oldColor[0] * (1 - w) + newColor[0] * w,
        oldColor[1] * (1 - w) + newColor[1] * w,
        oldColor[2] * (1 - w) + newColor[2] * w,
    ];
}

/**
 * Exponential moving average accumulation (real-time, non-converging)
 * @param {number[]} oldColor - Previous color [r, g, b]
 * @param {number[]} newColor - New color [r, g, b]
 * @param {number} alpha - Blend factor (0-1, higher = more new)
 * @returns {number[]} Blended color [r, g, b]
 */
export function accumulateEMA(oldColor, newColor, alpha) {
    return [
        oldColor[0] * (1 - alpha) + newColor[0] * alpha,
        oldColor[1] * (1 - alpha) + newColor[1] * alpha,
        oldColor[2] * (1 - alpha) + newColor[2] * alpha,
    ];
}

// ============================================================================
// SPECTRAL HEAT MAP
// ============================================================================

/**
 * Convert wavelength (nm) to RGB color
 * @param {number} wavelength - Wavelength in nanometers (380-780)
 * @returns {number[]} [r, g, b] in 0-1 range
 */
export function wavelengthToRGB(wavelength) {
    let r, g, b;
    const w = wavelength;
    
    if (w <= 380) {
        r = g = b = 0;
    } else if (w <= 440) {
        r = (440 - w) / (440 - 380) / 3;
        g = 0;
        b = 0.8;
    } else if (w <= 490) {
        r = 0;
        g = (w - 440) / (490 - 440);
        b = 1;
    } else if (w <= 510) {
        r = 0;
        g = 1;
        b = (510 - w) / (510 - 490);
    } else if (w <= 580) {
        r = (w - 510) / (580 - 510);
        g = 1;
        b = 0;
    } else if (w <= 645) {
        r = 1;
        g = (645 - w) / (645 - 580);
        b = 0;
    } else if (w <= 780) {
        r = 1;
        g = 0;
        b = 0;
    } else {
        r = g = b = 1;
    }
    
    // Intensity correction
    let factor;
    if (w >= 380 && w < 420) {
        factor = 0.3 + 0.7 * (w - 380) / 40;
    } else if (w >= 420 && w < 701) {
        factor = 1;
    } else if (w >= 701 && w < 781) {
        factor = 0.3 + 0.7 * (780 - w) / 80;
    } else {
        factor = 0;
    }
    
    const gamma = 0.8;
    return [
        Math.pow(factor * r, gamma),
        Math.pow(factor * g, gamma),
        Math.pow(factor * b, gamma),
    ];
}

/**
 * Map normalized value to spectral color (violet to red)
 * @param {number} t - Value in [0, 1]
 * @returns {number[]} [r, g, b] spectral color
 */
export function spectralHeatMap(t) {
    const wavelength = 380 + 370 * Math.max(0, Math.min(1, t));
    return wavelengthToRGB(wavelength);
}

/**
 * Map count to spectral color with cutoff
 * @param {number} count - Count value
 * @param {number} cutoff - Maximum expected count
 * @returns {number[]} [r, g, b] spectral color
 */
export function countToSpectral(count, cutoff) {
    const t = Math.min(1, count / Math.max(1, cutoff));
    return spectralHeatMap(t);
}

// ============================================================================
// BLUE NOISE UTILITIES
// ============================================================================

/**
 * Generate blue noise sample offset for a pixel
 * Uses R2 sequence (generalized golden ratio) for low-discrepancy sampling
 * @param {number} sampleIndex - Sample index
 * @returns {number[]} [x, y] offset in [0, 1)
 */
export function blueNoiseOffset(sampleIndex) {
    // Generalized golden ratio (R2 sequence)
    const g = 1.32471795724; // Plastic constant
    const a1 = 1 / g;
    const a2 = 1 / (g * g);
    
    return [
        (0.5 + a1 * sampleIndex) % 1,
        (0.5 + a2 * sampleIndex) % 1,
    ];
}

/**
 * R2 sequence for 3D sampling (quasi-random, low discrepancy)
 * @param {number} sampleIndex - Sample index
 * @returns {number[]} [x, y, z] in [0, 1)
 */
export function r2Sequence3D(sampleIndex) {
    const g = 1.22074408460575947536; // Generalized golden ratio for 3D
    const a1 = 1 / g;
    const a2 = 1 / (g * g);
    const a3 = 1 / (g * g * g);
    
    return [
        (0.5 + a1 * sampleIndex) % 1,
        (0.5 + a2 * sampleIndex) % 1,
        (0.5 + a3 * sampleIndex) % 1,
    ];
}

// ============================================================================
// HALTON SEQUENCE
// ============================================================================

/**
 * Halton sequence for quasi-random sampling
 * @param {number} index - Sample index
 * @param {number} base - Prime base (2, 3, 5, 7, etc.)
 * @returns {number} Value in [0, 1)
 */
export function halton(index, base) {
    let f = 1;
    let r = 0;
    let i = index;
    while (i > 0) {
        f = f / base;
        r = r + f * (i % base);
        i = Math.floor(i / base);
    }
    return r;
}

/**
 * 2D Halton sequence
 * @param {number} index - Sample index
 * @returns {number[]} [x, y] in [0, 1)
 */
export function halton2D(index) {
    return [halton(index, 2), halton(index, 3)];
}

/**
 * 3D Halton sequence
 * @param {number} index - Sample index
 * @returns {number[]} [x, y, z] in [0, 1)
 */
export function halton3D(index) {
    return [halton(index, 2), halton(index, 3), halton(index, 5)];
}

// ============================================================================
// WGSL SNIPPETS FOR COMMON USE CASES
// ============================================================================

/** WGSL snippet for jittered sampling in TAA */
export const TAA_JITTER_WGSL = /* wgsl */ `
// Halton sequence for TAA jitter
fn halton(index: u32, base: u32) -> f32 {
    var f = 1.0;
    var r = 0.0;
    var i = index;
    while (i > 0u) {
        f = f / f32(base);
        r = r + f * f32(i % base);
        i = i / base;
    }
    return r;
}

fn getTAAJitter(frameIndex: u32) -> vec2<f32> {
    let idx = frameIndex % 16u; // 16-sample pattern
    return vec2<f32>(halton(idx, 2u), halton(idx, 3u)) - 0.5;
}
`;

/** WGSL snippet for stratified sampling */
export const STRATIFIED_SAMPLE_WGSL = /* wgsl */ `
// Stratified 2D sample with jitter
fn stratifiedSample2D(
    cellX: u32, cellY: u32, 
    gridSize: u32, 
    state: ptr<function, u32>
) -> vec2<f32> {
    let jitterX = randomFloat(state);
    let jitterY = randomFloat(state);
    return vec2<f32>(
        (f32(cellX) + jitterX) / f32(gridSize),
        (f32(cellY) + jitterY) / f32(gridSize)
    );
}
`;

// ============================================================================
// MULTIPLAYER DETERMINISTIC RNG
// ============================================================================

/**
 * Deterministic RNG for multiplayer synchronization.
 * All clients with the same seed produce identical sequences.
 * 
 * Usage:
 * - World generation: seed with worldSeed + chunkCoords
 * - AI decisions: seed with entityId + gameTick
 * - Combat rolls: seed with attackerId + defenderId + gameTick
 * - Loot drops: seed with containerId + gameTick
 */
export class DeterministicRNG {
    /**
     * Create a deterministic RNG
     * @param {number} worldSeed - Global world seed (shared by all clients)
     */
    constructor(worldSeed) {
        this.worldSeed = worldSeed >>> 0;
        this.state = pcgHash(this.worldSeed);
    }
    
    /**
     * Create RNG stream for a specific game tick
     * Use for time-based events that must sync across clients
     * @param {number} tick - Current game tick (synced across clients)
     * @returns {DeterministicRNG} New RNG seeded for this tick
     */
    forTick(tick) {
        const rng = new DeterministicRNG(this.worldSeed);
        rng.state = legacyDeterministicRngTickSeed32(this.worldSeed, tick);
        return rng;
    }
    
    /**
     * Create RNG stream for a specific entity
     * Use for per-entity random (AI, particles, animations)
     * @param {number} entityId - Unique entity ID
     * @param {number} tick - Current game tick
     * @returns {DeterministicRNG} New RNG seeded for this entity+tick
     */
    forEntity(entityId, tick) {
        const rng = new DeterministicRNG(this.worldSeed);
        rng.state = deterministicRngEntitySeed32(this.worldSeed, entityId, tick);
        return rng;
    }

    /**
     * Create a replay-compatible stream using the historical low-u32 seed.
     * @param {number} entityId - Legacy entity ID
     * @param {number} tick - Current game tick
     * @returns {DeterministicRNG} New RNG seeded with the v1 contract
     */
    forEntityV1(entityId, tick) {
        const rng = new DeterministicRNG(this.worldSeed);
        rng.state = deterministicRngEntitySeed32V1(this.worldSeed, entityId, tick);
        return rng;
    }
    
    /**
     * Create RNG stream for a world position (chunk generation, etc.)
     * @param {number} x - World X coordinate
     * @param {number} y - World Y coordinate  
     * @param {number} z - World Z coordinate
     * @returns {DeterministicRNG} New RNG seeded for this position
     */
    forPosition(x, y, z) {
        const rng = new DeterministicRNG(this.worldSeed);
        rng.state = legacyDeterministicRngPositionSeed32(this.worldSeed, x, y, z);
        return rng;
    }
    
    /**
     * Create RNG for interaction between two entities (combat, trade, etc.)
     * @param {number} entityA - First entity ID
     * @param {number} entityB - Second entity ID
     * @param {number} tick - Current game tick
     * @returns {DeterministicRNG} New RNG for this interaction
     */
    forInteraction(entityA, entityB, tick) {
        const rng = new DeterministicRNG(this.worldSeed);
        rng.state = deterministicRngInteractionSeed32(this.worldSeed, entityA, entityB, tick);
        return rng;
    }

    /**
     * Create a replay-compatible interaction stream using v1 low-u32 seeds.
     * @param {number} entityA - First legacy entity ID
     * @param {number} entityB - Second legacy entity ID
     * @param {number} tick - Current game tick
     * @returns {DeterministicRNG} New RNG seeded with the v1 contract
     */
    forInteractionV1(entityA, entityB, tick) {
        const rng = new DeterministicRNG(this.worldSeed);
        rng.state = deterministicRngInteractionSeed32V1(this.worldSeed, entityA, entityB, tick);
        return rng;
    }
    
    /**
     * Get next random float in [0, 1)
     * @returns {number} Deterministic random float
     */
    float() {
        this.state = legacyPcgAdvanceState32(this.state);
        return legacyPcgOutput32(this.state) / 4294967295;
    }
    
    /**
     * Get random float in range [min, max)
     * @param {number} min - Minimum value (inclusive)
     * @param {number} max - Maximum value (exclusive)
     * @returns {number} Random float in range
     */
    range(min, max) {
        return min + this.float() * (max - min);
    }
    
    /**
     * Get random integer in [0, max)
     * @param {number} max - Exclusive maximum
     * @returns {number} Random integer
     */
    int(max) {
        return Math.floor(this.float() * max);
    }
    
    /**
     * Get random integer in [min, max]
     * @param {number} min - Inclusive minimum
     * @param {number} max - Inclusive maximum
     * @returns {number} Random integer in range
     */
    intRange(min, max) {
        return min + Math.floor(this.float() * (max - min + 1));
    }
    
    /**
     * Random boolean with probability
     * @param {number} probability - Chance of true (0-1)
     * @returns {boolean} Random boolean
     */
    chance(probability) {
        return this.float() < probability;
    }
    
    /**
     * Pick random element from array
     * @param {Array} array - Array to pick from
     * @returns {*} Random element
     */
    pick(array) {
        if (array.length === 0) return undefined;
        return array[this.int(array.length)];
    }
    
    /**
     * Shuffle array in place (Fisher-Yates)
     * @param {Array} array - Array to shuffle
     * @returns {Array} Same array, shuffled
     */
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
    
    /**
     * Get random value from normal distribution
     * @param {number} mean - Mean of distribution
     * @param {number} stddev - Standard deviation
     * @returns {number} Random normal value
     */
    gaussian(mean = 0, stddev = 1) {
        const u1 = Math.max(this.float(), 1e-10);
        const u2 = this.float();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return mean + stddev * z;
    }
    
    /**
     * Get random direction on unit sphere
     * @returns {number[]} [x, y, z] normalized direction
     */
    direction() {
        const x = this.gaussian();
        const y = this.gaussian();
        const z = this.gaussian();
        const len = Math.sqrt(x * x + y * y + z * z);
        return [x / len, y / len, z / len];
    }
    
    /**
     * Get random point in unit sphere
     * @returns {number[]} [x, y, z] point inside unit sphere
     */
    inSphere() {
        const r = Math.pow(this.float(), 1 / 3);
        const dir = this.direction();
        return [r * dir[0], r * dir[1], r * dir[2]];
    }
    
    /**
     * Get random point in unit disk
     * @returns {number[]} [x, y] point inside unit disk
     */
    inDisk() {
        const r = Math.sqrt(this.float());
        const theta = 2 * Math.PI * this.float();
        return [r * Math.cos(theta), r * Math.sin(theta)];
    }
    
    /**
     * Weighted random selection
     * @param {Array} items - Array of items
     * @param {Array} weights - Array of weights (same length as items)
     * @returns {*} Selected item
     */
    weighted(items, weights) {
        let total = 0;
        for (const w of weights) total += w;
        
        let r = this.float() * total;
        for (let i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
    }
}

/**
 * WGSL code for multiplayer-deterministic random
 * Seeds with tick + entityId for synchronized random across clients
 */
export const MULTIPLAYER_RANDOM_CORE_WGSL = /* wgsl */ `
// Deterministic RNG for multiplayer - same seed = same results on all clients
fn initTickRng(worldSeed: u32, tick: u32) -> u32 {
    return legacyDeterministicRngTickSeed32(worldSeed, tick);
}

fn initMultiplayerRngV2(worldSeed: u32, entityId: vec2<u32>, tick: u32) -> u32 {
    return deterministicRngEntitySeed32V2(worldSeed, entityId, tick);
}

fn initMultiplayerRng(worldSeed: u32, entityId: vec2<u32>, tick: u32) -> u32 {
    return initMultiplayerRngV2(worldSeed, entityId, tick);
}

// For position-based random (terrain, loot spawns)
fn initPositionRng(worldSeed: u32, x: i32, y: i32, z: i32) -> u32 {
    return legacyDeterministicRngPositionSeed32(worldSeed, x, y, z);
}

// For interaction between two entities (order-independent)
fn initInteractionRngV2(worldSeed: u32, entityA: vec2<u32>, entityB: vec2<u32>, tick: u32) -> u32 {
    return deterministicRngInteractionSeed32V2(worldSeed, entityA, entityB, tick);
}

fn initInteractionRng(worldSeed: u32, entityA: vec2<u32>, entityB: vec2<u32>, tick: u32) -> u32 {
    return initInteractionRngV2(worldSeed, entityA, entityB, tick);
}
`;

export const MULTIPLAYER_RANDOM_WGSL = /* wgsl */ `
${LEGACY_PCG32_WGSL}
${LEGACY_DETERMINISTIC_RNG_SEED32_WGSL}
${DETERMINISTIC_RNG_SEED32_V2_WGSL}
${MULTIPLAYER_RANDOM_CORE_WGSL}
`;

export const MULTIPLAYER_RANDOM_V1_CORE_WGSL = /* wgsl */ `
fn initTickRng(worldSeed: u32, tick: u32) -> u32 {
    return legacyDeterministicRngTickSeed32(worldSeed, tick);
}

fn initMultiplayerRngV1(worldSeed: u32, entityId: u32, tick: u32) -> u32 {
    return legacyDeterministicRngEntitySeed32(worldSeed, entityId, tick);
}

fn initMultiplayerRng(worldSeed: u32, entityId: u32, tick: u32) -> u32 {
    return initMultiplayerRngV1(worldSeed, entityId, tick);
}

fn initPositionRng(worldSeed: u32, x: i32, y: i32, z: i32) -> u32 {
    return legacyDeterministicRngPositionSeed32(worldSeed, x, y, z);
}

fn initInteractionRngV1(worldSeed: u32, entityA: u32, entityB: u32, tick: u32) -> u32 {
    return legacyDeterministicRngInteractionSeed32(worldSeed, entityA, entityB, tick);
}

fn initInteractionRng(worldSeed: u32, entityA: u32, entityB: u32, tick: u32) -> u32 {
    return initInteractionRngV1(worldSeed, entityA, entityB, tick);
}
`;

export const MULTIPLAYER_RANDOM_V1_WGSL = /* wgsl */ `
${LEGACY_PCG32_WGSL}
${LEGACY_DETERMINISTIC_RNG_SEED32_WGSL}
${MULTIPLAYER_RANDOM_V1_CORE_WGSL}
`;

export default PCGRandom;
