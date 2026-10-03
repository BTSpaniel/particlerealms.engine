// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleCompression.js - Compression utilities for particle snapshots
 * Extracted from ParticleSnapshotDelta.js for modularity
 * 
 * Includes:
 * - Run-length encoding
 * - Variable-length integer packing
 * - PCA + DCT compression
 * - Position/velocity quantization
 * - Interpolation algorithms
 */

import {
    DEFAULT_PARTICLE_PACKING_RANGES,
    packParticlePositionAge,
    packParticleVelocityLifetime,
    packSignedRangeUNORM16,
    unpackParticlePositionAge,
    unpackParticleVelocityLifetime,
    unpackSignedRangeUNORM16,
} from '../../core/math/MathPacking.js';

// ============================================================================
// RUN-LENGTH ENCODING
// ============================================================================

export function runLengthEncode(indices) {
    if (!indices || indices.length === 0) return null;
    
    const runs = [];
    const singles = [];
    let i = 0;
    
    while (i < indices.length) {
        const start = indices[i];
        let count = 1;
        
        while (i + count < indices.length && indices[i + count] === start + count) {
            count++;
        }
        
        if (count >= 3) {
            runs.push([start, count]);
            i += count;
        } else {
            singles.push(start);
            i++;
        }
    }
    
    return { runs, singles };
}

export function runLengthDecode(encoded) {
    if (!encoded) return [];
    
    const indices = [];
    
    if (encoded.runs) {
        for (const [start, count] of encoded.runs) {
            for (let i = 0; i < count; i++) {
                indices.push(start + i);
            }
        }
    }
    
    if (encoded.singles) {
        indices.push(...encoded.singles);
    }
    
    return indices.sort((a, b) => a - b);
}

// ============================================================================
// VARIABLE-LENGTH INTEGER PACKING
// ============================================================================

export function packSmallIntegers(values) {
    if (!values || values.length === 0) return new Uint8Array(0);
    
    const packed = [];
    for (const val of values) {
        if (val < 128) {
            packed.push(val);
        } else if (val < 16384) {
            packed.push(128 | (val >> 8));
            packed.push(val & 0xFF);
        } else {
            packed.push(192 | (val >> 16));
            packed.push((val >> 8) & 0xFF);
            packed.push(val & 0xFF);
        }
    }
    
    return new Uint8Array(packed);
}

export function unpackSmallIntegers(packed) {
    if (!packed || packed.length === 0) return [];
    
    const values = [];
    let i = 0;
    
    while (i < packed.length) {
        const first = packed[i];
        
        if (first < 128) {
            values.push(first);
            i++;
        } else if (first < 192) {
            values.push(((first & 0x3F) << 8) | packed[i + 1]);
            i += 2;
        } else {
            values.push(((first & 0x3F) << 16) | (packed[i + 1] << 8) | packed[i + 2]);
            i += 3;
        }
    }
    
    return values;
}

// ============================================================================
// PCA + DCT COMPRESSION
// ============================================================================

export function computeCovarianceMatrix(trajectories) {
    const n = trajectories.length;
    if (n === 0) return null;
    
    const mean = [0, 0, 0];
    for (const [x, y, z] of trajectories) {
        mean[0] += x;
        mean[1] += y;
        mean[2] += z;
    }
    mean[0] /= n;
    mean[1] /= n;
    mean[2] /= n;
    
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const [x, y, z] of trajectories) {
        const dx = x - mean[0];
        const dy = y - mean[1];
        const dz = z - mean[2];
        
        cov[0][0] += dx * dx;
        cov[0][1] += dx * dy;
        cov[0][2] += dx * dz;
        cov[1][1] += dy * dy;
        cov[1][2] += dy * dz;
        cov[2][2] += dz * dz;
    }
    
    cov[1][0] = cov[0][1];
    cov[2][0] = cov[0][2];
    cov[2][1] = cov[1][2];
    
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            cov[i][j] /= (n - 1);
        }
    }
    
    return { cov, mean };
}

export function powerIteration(matrix, iterations = 20) {
    let v = [1, 1, 1];
    
    for (let iter = 0; iter < iterations; iter++) {
        const Av = [
            matrix[0][0] * v[0] + matrix[0][1] * v[1] + matrix[0][2] * v[2],
            matrix[1][0] * v[0] + matrix[1][1] * v[1] + matrix[1][2] * v[2],
            matrix[2][0] * v[0] + matrix[2][1] * v[1] + matrix[2][2] * v[2]
        ];
        
        const norm = Math.sqrt(Av[0] * Av[0] + Av[1] * Av[1] + Av[2] * Av[2]);
        v = [Av[0] / norm, Av[1] / norm, Av[2] / norm];
    }
    
    const Av = [
        matrix[0][0] * v[0] + matrix[0][1] * v[1] + matrix[0][2] * v[2],
        matrix[1][0] * v[0] + matrix[1][1] * v[1] + matrix[1][2] * v[2],
        matrix[2][0] * v[0] + matrix[2][1] * v[1] + matrix[2][2] * v[2]
    ];
    const eigenvalue = v[0] * Av[0] + v[1] * Av[1] + v[2] * Av[2];
    
    return { vector: v, value: eigenvalue };
}

export function dct1d(signal) {
    const N = signal.length;
    const coeffs = new Float32Array(N);
    
    for (let k = 0; k < N; k++) {
        let sum = 0;
        for (let n = 0; n < N; n++) {
            sum += signal[n] * Math.cos((Math.PI / N) * (n + 0.5) * k);
        }
        coeffs[k] = sum * (k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N));
    }
    
    return coeffs;
}

export function idct1d(coeffs) {
    const N = coeffs.length;
    const signal = new Float32Array(N);
    
    for (let n = 0; n < N; n++) {
        let sum = coeffs[0] * Math.sqrt(1 / N);
        for (let k = 1; k < N; k++) {
            sum += coeffs[k] * Math.sqrt(2 / N) * Math.cos((Math.PI / N) * (n + 0.5) * k);
        }
        signal[n] = sum;
    }
    
    return signal;
}

export function quantizeDCT(coeffs, retention = 0.7) {
    const N = coeffs.length;
    const keepCount = Math.ceil(N * retention);
    
    const indexed = Array.from(coeffs).map((val, idx) => ({ val: Math.abs(val), idx, orig: val }));
    indexed.sort((a, b) => b.val - a.val);
    
    const quantized = new Float32Array(N);
    for (let i = 0; i < keepCount; i++) {
        quantized[indexed[i].idx] = indexed[i].orig;
    }
    
    return quantized;
}

// ============================================================================
// POSITION/VELOCITY QUANTIZATION
// ============================================================================

const POSITION_RANGE = DEFAULT_PARTICLE_PACKING_RANGES.position;
const VELOCITY_RANGE = DEFAULT_PARTICLE_PACKING_RANGES.velocity;
const AGE_RANGE = DEFAULT_PARTICLE_PACKING_RANGES.age;
const LIFETIME_RANGE = DEFAULT_PARTICLE_PACKING_RANGES.lifetime;

export function quantizeFloat(value, range) {
    return packSignedRangeUNORM16(value, range, 0);
}

export function dequantizeFloat(quantized, range) {
    return unpackSignedRangeUNORM16(quantized, range, 0);
}

export function quantizePosition(x, y, z, age) {
    return packParticlePositionAge(x, y, z, age);
}

export function quantizeVelocity(vx, vy, vz, lifetime) {
    return packParticleVelocityLifetime(vx, vy, vz, lifetime);
}

export function dequantizePosition(quantized) {
    return unpackParticlePositionAge(quantized);
}

export function dequantizeVelocity(quantized) {
    return unpackParticleVelocityLifetime(quantized);
}

export function quantizePositionArray(positions) {
    const count = positions.length / 4;
    const quantized = new Uint16Array(positions.length);
    
    for (let i = 0; i < count; i++) {
        const base = i * 4;
        quantized[base] = quantizeFloat(positions[base], POSITION_RANGE);
        quantized[base + 1] = quantizeFloat(positions[base + 1], POSITION_RANGE);
        quantized[base + 2] = quantizeFloat(positions[base + 2], POSITION_RANGE);
        quantized[base + 3] = quantizeFloat(positions[base + 3], AGE_RANGE);
    }
    
    return quantized;
}

export function quantizeVelocityArray(velocities) {
    const count = velocities.length / 4;
    const quantized = new Uint16Array(velocities.length);
    
    for (let i = 0; i < count; i++) {
        const base = i * 4;
        quantized[base] = quantizeFloat(velocities[base], VELOCITY_RANGE);
        quantized[base + 1] = quantizeFloat(velocities[base + 1], VELOCITY_RANGE);
        quantized[base + 2] = quantizeFloat(velocities[base + 2], VELOCITY_RANGE);
        quantized[base + 3] = quantizeFloat(velocities[base + 3], LIFETIME_RANGE);
    }
    
    return quantized;
}

export function dequantizePositionArray(quantized) {
    const positions = new Float32Array(quantized.length);
    const count = quantized.length / 4;
    
    for (let i = 0; i < count; i++) {
        const base = i * 4;
        positions[base] = dequantizeFloat(quantized[base], POSITION_RANGE);
        positions[base + 1] = dequantizeFloat(quantized[base + 1], POSITION_RANGE);
        positions[base + 2] = dequantizeFloat(quantized[base + 2], POSITION_RANGE);
        positions[base + 3] = dequantizeFloat(quantized[base + 3], AGE_RANGE);
    }
    
    return positions;
}

export function dequantizeVelocityArray(quantized) {
    const velocities = new Float32Array(quantized.length);
    const count = quantized.length / 4;
    
    for (let i = 0; i < count; i++) {
        const base = i * 4;
        velocities[base] = dequantizeFloat(quantized[base], VELOCITY_RANGE);
        velocities[base + 1] = dequantizeFloat(quantized[base + 1], VELOCITY_RANGE);
        velocities[base + 2] = dequantizeFloat(quantized[base + 2], VELOCITY_RANGE);
        velocities[base + 3] = dequantizeFloat(quantized[base + 3], LIFETIME_RANGE);
    }
    
    return velocities;
}

// ============================================================================
// INTERPOLATION ALGORITHMS
// ============================================================================

export function catmullRomInterpolate(p0, p1, p2, p3, t, tension = 0.5) {
    const t2 = t * t;
    const t3 = t2 * t;
    
    const s = (1 - tension) / 2;
    
    const h1 = 2 * t3 - 3 * t2 + 1;
    const h2 = -2 * t3 + 3 * t2;
    const h3 = t3 - 2 * t2 + t;
    const h4 = t3 - t2;
    
    const m0 = s * (p2 - p0);
    const m1 = s * (p3 - p1);
    
    return h1 * p1 + h2 * p2 + h3 * m0 + h4 * m1;
}

export function hermiteInterpolate(p0, p1, v0, v1, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    
    return h00 * p0 + h10 * v0 + h01 * p1 + h11 * v1;
}

// ============================================================================
// ENTROPY ENCODING
// ============================================================================

export function entropyEncodeResiduals(residuals) {
    const histogram = new Map();
    for (const r of residuals) {
        histogram.set(r, (histogram.get(r) || 0) + 1);
    }
    
    const sorted = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
    const symbolTable = new Map();
    sorted.forEach(([symbol], idx) => symbolTable.set(symbol, idx));
    
    const encoded = new Uint16Array(residuals.length);
    for (let i = 0; i < residuals.length; i++) {
        encoded[i] = symbolTable.get(residuals[i]);
    }
    
    return {
        table: sorted.map(([symbol]) => symbol),
        data: encoded
    };
}

export function entropyDecodeResiduals(encoded, length) {
    if (!encoded || !encoded.table || !encoded.data) return new Int16Array(length);
    
    const residuals = new Int16Array(length);
    for (let i = 0; i < Math.min(length, encoded.data.length); i++) {
        residuals[i] = encoded.table[encoded.data[i]] || 0;
    }
    
    return residuals;
}
