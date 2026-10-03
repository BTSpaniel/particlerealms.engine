// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CompressionUtils.js - Unified Compression Utilities
 * 
 * Provides compression techniques for various data types:
 * - Variable-Length Integer Encoding (VLInt)
 * - Quantization (Float32 → Int16/Int8)
 * - Run-Length Encoding (RLE)
 * - Delta Compression
 * - Octahedral Normal Encoding
 * - Quaternion Compression
 * 
 * Based on research from particle snapshot compression achieving 390x compression
 */

import {
    quantizeSignedFloatToInt16,
    dequantizeSignedInt16ToFloat,
    quantizeSignedFloatArrayToInt16,
    dequantizeSignedInt16ArrayToFloat32,
    quantizeSignedFloatToInt8,
    dequantizeSignedInt8ToFloat,
} from '../math/QuantMath.js';

// ============================================================================
// VARIABLE-LENGTH INTEGER ENCODING (VLInt)
// ============================================================================

/**
 * Pack small integers into fewer bytes using variable-length encoding
 * Most indices are small, so we can use 1-2 bytes instead of 4
 * 
 * Encoding:
 * - 1 byte: 0xxxxxxx (0-127)
 * - 2 bytes: 10xxxxxx xxxxxxxx (128-16,383)
 * - 3 bytes: 11xxxxxx xxxxxxxx xxxxxxxx (16,384-4,194,303)
 */
export function packVLInt(values) {
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

/**
 * Unpack variable-length encoded integers
 */
export function unpackVLInt(packed) {
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
// QUANTIZATION (Float → Int16/Int8)
// ============================================================================

/**
 * Quantize float to int16 within range [-range, +range]
 * Achieves 50% memory reduction with minimal precision loss
 */
export function quantizeFloat(value, range) {
    return quantizeSignedFloatToInt16(value, range);
}

/**
 * Dequantize int16 back to float
 */
export function dequantizeFloat(quantized, range) {
    return dequantizeSignedInt16ToFloat(quantized, range);
}

/**
 * Quantize array of floats to Int16Array
 */
export function quantizeFloatArray(floats, range) {
    return quantizeSignedFloatArrayToInt16(floats, range);
}

/**
 * Dequantize Int16Array back to Float32Array
 */
export function dequantizeFloatArray(quantized, range) {
    return dequantizeSignedInt16ArrayToFloat32(quantized, range);
}

/**
 * Quantize to int8 for even more compression (75% reduction)
 * Use for data that doesn't need high precision (normals, colors)
 */
export function quantizeToInt8(value, range) {
    return quantizeSignedFloatToInt8(value, range);
}

export function dequantizeFromInt8(quantized, range) {
    return dequantizeSignedInt8ToFloat(quantized, range);
}

// ============================================================================
// OCTAHEDRAL NORMAL ENCODING (66% reduction: 12 bytes → 4 bytes)
// ============================================================================

/**
 * Encode 3D unit normal to 2D octahedral coordinates
 * Industry-standard technique used in AAA games
 * Reference: "A Survey of Efficient Representations for Independent Unit Vectors"
 */
export function encodeOctahedralNormal(nx, ny, nz) {
    // Project to octahedron
    const l1norm = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
    let x = nx / l1norm;
    let y = ny / l1norm;
    
    // Fold negative hemisphere
    if (nz < 0) {
        const oldX = x;
        x = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1);
        y = (1 - Math.abs(oldX)) * (y >= 0 ? 1 : -1);
    }
    
    // Quantize to int16 (-1 to 1 → -32767 to 32767)
    return [
        Math.round(x * 32767) | 0,
        Math.round(y * 32767) | 0
    ];
}

/**
 * Decode octahedral coordinates back to 3D normal
 */
export function decodeOctahedralNormal(x, y) {
    // Dequantize
    x = x / 32767;
    y = y / 32767;
    
    // Reconstruct z
    let z = 1 - Math.abs(x) - Math.abs(y);
    
    // Unfold negative hemisphere
    if (z < 0) {
        const oldX = x;
        x = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1);
        y = (1 - Math.abs(oldX)) * (y >= 0 ? 1 : -1);
    }
    
    // Normalize
    const length = Math.sqrt(x * x + y * y + z * z);
    return [x / length, y / length, z / length];
}

/**
 * Encode array of normals (vec3) to Int16Array
 * Input: Float32Array [nx, ny, nz, nx, ny, nz, ...]
 * Output: Int16Array [x, y, x, y, ...] (66% smaller)
 */
export function encodeNormalArray(normals) {
    const count = normals.length / 3;
    const encoded = new Int16Array(count * 2);
    
    for (let i = 0; i < count; i++) {
        const [x, y] = encodeOctahedralNormal(
            normals[i * 3],
            normals[i * 3 + 1],
            normals[i * 3 + 2]
        );
        encoded[i * 2] = x;
        encoded[i * 2 + 1] = y;
    }
    
    return encoded;
}

/**
 * Decode array of normals back to Float32Array
 */
export function decodeNormalArray(encoded) {
    const count = encoded.length / 2;
    const normals = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
        const [nx, ny, nz] = decodeOctahedralNormal(
            encoded[i * 2],
            encoded[i * 2 + 1]
        );
        normals[i * 3] = nx;
        normals[i * 3 + 1] = ny;
        normals[i * 3 + 2] = nz;
    }
    
    return normals;
}

// ============================================================================
// QUATERNION COMPRESSION (37.5% reduction: 16 bytes → 10 bytes)
// ============================================================================

/**
 * Compress quaternion by dropping smallest component
 * Technique: Store 3 largest components + index of dropped component
 * Used in animation systems for skeletal rigs
 */
export function compressQuaternion(x, y, z, w) {
    // Find smallest component
    const abs = [Math.abs(x), Math.abs(y), Math.abs(z), Math.abs(w)];
    let minIdx = 0;
    let minVal = abs[0];
    
    for (let i = 1; i < 4; i++) {
        if (abs[i] < minVal) {
            minVal = abs[i];
            minIdx = i;
        }
    }
    
    // Ensure w is positive (flip if needed)
    const sign = w < 0 ? -1 : 1;
    const q = [x * sign, y * sign, z * sign, w * sign];
    
    // Pack 3 components (skip smallest) + index
    const packed = [];
    for (let i = 0; i < 4; i++) {
        if (i !== minIdx) {
            // Quantize to int16 (-1 to 1 → -32767 to 32767)
            packed.push(Math.round(q[i] * 32767) | 0);
        }
    }
    
    return { values: new Int16Array(packed), droppedIndex: minIdx };
}

/**
 * Decompress quaternion by reconstructing dropped component
 */
export function decompressQuaternion(compressed) {
    const { values, droppedIndex } = compressed;
    
    // Dequantize
    const q = [0, 0, 0, 0];
    let idx = 0;
    for (let i = 0; i < 4; i++) {
        if (i !== droppedIndex) {
            q[i] = values[idx++] / 32767;
        }
    }
    
    // Reconstruct dropped component (quaternion is unit length)
    const sumSq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    q[droppedIndex] = Math.sqrt(Math.max(0, 1 - sumSq));
    
    return q;
}

// ============================================================================
// RUN-LENGTH ENCODING (RLE)
// ============================================================================

/**
 * Run-Length Encode an array of values
 * Perfect for voxel data with large empty regions
 * Returns: [[value, count], [value, count], ...]
 */
export function runLengthEncode(values) {
    if (!values || values.length === 0) return [];
    
    const runs = [];
    let currentValue = values[0];
    let count = 1;
    
    for (let i = 1; i < values.length; i++) {
        if (values[i] === currentValue) {
            count++;
        } else {
            runs.push([currentValue, count]);
            currentValue = values[i];
            count = 1;
        }
    }
    
    // Push final run
    runs.push([currentValue, count]);
    
    return runs;
}

/**
 * Decode run-length encoded data
 */
export function runLengthDecode(runs) {
    const values = [];
    
    for (const [value, count] of runs) {
        for (let i = 0; i < count; i++) {
            values.push(value);
        }
    }
    
    return values;
}

/**
 * RLE with VLInt encoding for maximum compression
 * Returns Uint8Array: [value, count, value, count, ...]
 */
export function runLengthEncodeCompact(values) {
    const runs = runLengthEncode(values);
    const packed = [];
    
    for (const [value, count] of runs) {
        // Pack value (assume 0-255 range for voxels)
        packed.push(value & 0xFF);
        
        // Pack count with VLInt
        if (count < 128) {
            packed.push(count);
        } else if (count < 16384) {
            packed.push(128 | (count >> 8));
            packed.push(count & 0xFF);
        } else {
            packed.push(192 | (count >> 16));
            packed.push((count >> 8) & 0xFF);
            packed.push(count & 0xFF);
        }
    }
    
    return new Uint8Array(packed);
}

// ============================================================================
// DELTA COMPRESSION
// ============================================================================

/**
 * Delta encode array (store differences instead of absolute values)
 * Great for temporal data or sorted indices
 */
export function deltaEncode(values) {
    if (!values || values.length === 0) return [];
    
    const deltas = [values[0]]; // First value is absolute
    
    for (let i = 1; i < values.length; i++) {
        deltas.push(values[i] - values[i - 1]);
    }
    
    return deltas;
}

/**
 * Decode delta-encoded array
 */
export function deltaDecode(deltas) {
    if (!deltas || deltas.length === 0) return [];
    
    const values = [deltas[0]];
    
    for (let i = 1; i < deltas.length; i++) {
        values.push(values[i - 1] + deltas[i]);
    }
    
    return values;
}

// ============================================================================
// PALETTE COMPRESSION (for voxels/textures)
// ============================================================================

/**
 * Create palette from array of values
 * Returns: { palette: unique values, indices: array of palette indices }
 */
export function createPalette(values) {
    const palette = [];
    const indexMap = new Map();
    const indices = [];
    
    for (const value of values) {
        if (!indexMap.has(value)) {
            indexMap.set(value, palette.length);
            palette.push(value);
        }
        indices.push(indexMap.get(value));
    }
    
    return { palette, indices };
}

/**
 * Decode palette-compressed data
 */
export function decodePalette(palette, indices) {
    return indices.map(idx => palette[idx]);
}

// ============================================================================
// COMPRESSION STATISTICS
// ============================================================================

/**
 * Calculate compression ratio and statistics
 */
export function getCompressionStats(originalSize, compressedSize) {
    const ratio = originalSize / compressedSize;
    const savings = ((originalSize - compressedSize) / originalSize) * 100;
    
    return {
        originalSize,
        compressedSize,
        ratio: ratio.toFixed(2),
        savings: savings.toFixed(1) + '%',
        savedBytes: originalSize - compressedSize,
    };
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

export default {
    // VLInt
    packVLInt,
    unpackVLInt,
    
    // Quantization
    quantizeFloat,
    dequantizeFloat,
    quantizeFloatArray,
    dequantizeFloatArray,
    quantizeToInt8,
    dequantizeFromInt8,
    
    // Normals
    encodeOctahedralNormal,
    decodeOctahedralNormal,
    encodeNormalArray,
    decodeNormalArray,
    
    // Quaternions
    compressQuaternion,
    decompressQuaternion,
    
    // RLE
    runLengthEncode,
    runLengthDecode,
    runLengthEncodeCompact,
    
    // Delta
    deltaEncode,
    deltaDecode,
    
    // Palette
    createPalette,
    decodePalette,
    
    // Stats
    getCompressionStats,
    formatBytes,
};
