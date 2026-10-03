// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { crc32 as checksumCrc32 } from '../../core/math/ChecksumMath.js';

/**
 * VoxelCompression.js - Custom Compression Algorithms for Voxel Data
 *
 * Implements (no external libraries):
 * - Morton Codes (Z-order curves) for spatial locality
 * - Palette Compression (variable bit-width indices)
 * - Run-Length Encoding (RLE) with auto-trigger
 * - CRC32 checksums for data integrity
 *
 * Compression Pipeline:
 * Raw Voxels → Morton Linearization → Palette → RLE → Output
 */

// ============================================================================
// CRC32 - Cyclic Redundancy Check (IEEE polynomial 0xEDB88320)
// ============================================================================

/**
 * Calculate CRC32 checksum
 * @param {Uint8Array} data
 * @returns {number} 32-bit CRC
 */
export function crc32(data) {
    return checksumCrc32(data);
}

/**
 * Verify data integrity
 * @param {Uint8Array} data
 * @param {number} expectedCRC
 * @returns {boolean}
 */
export function verifyCRC32(data, expectedCRC) {
    return crc32(data) === expectedCRC;
}

// ============================================================================
// MORTON CODES - Z-Order Space-Filling Curve for 3D
// ============================================================================

// Spread bits for 10-bit input → 30-bit output (for 32³ chunks)
function spreadBits3D(x) {
    x = (x | (x << 16)) & 0x030000FF;
    x = (x | (x << 8))  & 0x0300F00F;
    x = (x | (x << 4))  & 0x030C30C3;
    x = (x | (x << 2))  & 0x09249249;
    return x;
}

// Compact bits: 30-bit input → 10-bit output
function compactBits3D(x) {
    x = x & 0x09249249;
    x = (x | (x >> 2))  & 0x030C30C3;
    x = (x | (x >> 4))  & 0x0300F00F;
    x = (x | (x >> 8))  & 0x030000FF;
    x = (x | (x >> 16)) & 0x000003FF;
    return x;
}

/**
 * Encode 3D coordinates to Morton code (Z-order)
 * @param {number} x - X coordinate (0-1023)
 * @param {number} y - Y coordinate (0-1023)
 * @param {number} z - Z coordinate (0-1023)
 * @returns {number} 30-bit Morton code
 */
export function encodeMorton3D(x, y, z) {
    return spreadBits3D(x) | (spreadBits3D(y) << 1) | (spreadBits3D(z) << 2);
}

/**
 * Decode Morton code to 3D coordinates
 * @param {number} morton
 * @returns {{x: number, y: number, z: number}}
 */
export function decodeMorton3D(morton) {
    return {
        x: compactBits3D(morton),
        y: compactBits3D(morton >> 1),
        z: compactBits3D(morton >> 2),
    };
}

/**
 * Generate Morton-order traversal indices for a cubic chunk
 * @param {number} size - Chunk dimension (e.g., 32)
 * @returns {Uint32Array} - Morton-ordered indices
 */
export function generateMortonIndices(size) {
    const count = size * size * size;
    const indices = new Uint32Array(count);

    for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const linearIdx = x + y * size + z * size * size;
                const mortonIdx = encodeMorton3D(x, y, z);
                indices[mortonIdx] = linearIdx;
            }
        }
    }

    return indices;
}

// Pre-computed Morton indices for common chunk sizes
const MORTON_CACHE = new Map();

/**
 * Get cached Morton indices for chunk size
 * @param {number} size
 * @returns {Uint32Array}
 */
export function getMortonIndices(size) {
    if (!MORTON_CACHE.has(size)) {
        MORTON_CACHE.set(size, generateMortonIndices(size));
    }
    return MORTON_CACHE.get(size);
}

/**
 * Reorder voxel data from linear to Morton order
 * @param {Uint8Array|Uint16Array} data - Linear voxel data
 * @param {number} size - Chunk dimension
 * @returns {Uint8Array|Uint16Array} - Morton-ordered data
 */
export function linearToMorton(data, size) {
    const indices = getMortonIndices(size);
    const result = new data.constructor(data.length);

    for (let i = 0; i < indices.length; i++) {
        result[i] = data[indices[i]];
    }

    return result;
}

/**
 * Reorder voxel data from Morton to linear order
 * @param {Uint8Array|Uint16Array} data - Morton-ordered data
 * @param {number} size - Chunk dimension
 * @returns {Uint8Array|Uint16Array} - Linear data
 */
export function mortonToLinear(data, size) {
    const indices = getMortonIndices(size);
    const result = new data.constructor(data.length);

    for (let i = 0; i < indices.length; i++) {
        result[indices[i]] = data[i];
    }

    return result;
}

// ============================================================================
// PALETTE COMPRESSION - Variable Bit-Width Indices
// ============================================================================

/**
 * Build palette from voxel data
 * @param {Uint8Array|Uint16Array} data
 * @returns {{palette: number[], indexMap: Map<number, number>}}
 */
export function buildPalette(data) {
    const unique = new Set();
    for (let i = 0; i < data.length; i++) {
        unique.add(data[i]);
    }

    const palette = Array.from(unique).sort((a, b) => a - b);
    const indexMap = new Map();
    palette.forEach((val, idx) => indexMap.set(val, idx));

    return { palette, indexMap };
}

/**
 * Calculate bits needed for palette size
 * @param {number} paletteSize
 * @returns {number} - Bits per index (1, 2, 4, 8, or 16)
 */
export function bitsForPalette(paletteSize) {
    if (paletteSize <= 2) return 1;
    if (paletteSize <= 4) return 2;
    if (paletteSize <= 16) return 4;
    if (paletteSize <= 256) return 8;
    return 16;
}

/**
 * Compress voxels using palette compression
 * @param {Uint8Array|Uint16Array} data - Raw voxel data
 * @returns {{palette: number[], bits: number, packed: Uint8Array}}
 */
export function paletteCompress(data) {
    const { palette, indexMap } = buildPalette(data);

    // Special case: single value (homogeneous chunk)
    if (palette.length === 1) {
        return {
            palette,
            bits: 0,
            packed: new Uint8Array(0),
        };
    }

    const bits = bitsForPalette(palette.length);
    const indicesPerByte = Math.floor(8 / bits);
    const packedLength = Math.ceil(data.length / indicesPerByte);
    const packed = new Uint8Array(packedLength);

    const mask = (1 << bits) - 1;

    for (let i = 0; i < data.length; i++) {
        const idx = indexMap.get(data[i]);
        const bytePos = Math.floor(i / indicesPerByte);
        const bitPos = (i % indicesPerByte) * bits;
        packed[bytePos] |= (idx & mask) << bitPos;
    }

    return { palette, bits, packed };
}

/**
 * Decompress palette-compressed data
 * @param {number[]} palette
 * @param {number} bits
 * @param {Uint8Array} packed
 * @param {number} count - Number of voxels
 * @returns {Uint8Array}
 */
export function paletteDecompress(palette, bits, packed, count) {
    // Homogeneous chunk
    if (bits === 0) {
        const result = new Uint8Array(count);
        result.fill(palette[0]);
        return result;
    }

    const result = new Uint8Array(count);
    const indicesPerByte = Math.floor(8 / bits);
    const mask = (1 << bits) - 1;

    for (let i = 0; i < count; i++) {
        const bytePos = Math.floor(i / indicesPerByte);
        const bitPos = (i % indicesPerByte) * bits;
        const idx = (packed[bytePos] >> bitPos) & mask;
        result[i] = palette[idx];
    }

    return result;
}

// ============================================================================
// RUN-LENGTH ENCODING - Auto-Trigger Variant
// ============================================================================

const RLE_ESCAPE = 0xFF;  // Escape byte for runs
const RLE_MIN_RUN = 3;    // Minimum run length to encode

/**
 * RLE compress data (auto-trigger: only encodes when beneficial)
 * Format:
 *   Literal: byte (if byte != ESCAPE)
 *   Escape:  ESCAPE, 0, ESCAPE (literal escape byte)
 *   Run:     ESCAPE, count-3, value (run of count bytes)
 *
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function rleEncode(data) {
    if (data.length === 0) return new Uint8Array(0);

    const output = [];
    let i = 0;

    while (i < data.length) {
        const value = data[i];

        // Count run length
        let runLen = 1;
        while (i + runLen < data.length &&
               data[i + runLen] === value &&
               runLen < 258) {  // Max run = 255 + 3 = 258
            runLen++;
        }

        if (runLen >= RLE_MIN_RUN) {
            // Encode as run: ESCAPE, count-3, value
            output.push(RLE_ESCAPE, runLen - RLE_MIN_RUN, value);
            i += runLen;
        } else {
            // Literal bytes
            for (let j = 0; j < runLen; j++) {
                if (value === RLE_ESCAPE) {
                    // Escape the escape byte
                    output.push(RLE_ESCAPE, 0, RLE_ESCAPE);
                } else {
                    output.push(value);
                }
            }
            i += runLen;
        }
    }

    return new Uint8Array(output);
}

/**
 * RLE decompress data
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function rleDecode(data) {
    if (data.length === 0) return new Uint8Array(0);

    const output = [];
    let i = 0;

    while (i < data.length) {
        if (data[i] === RLE_ESCAPE && i + 2 < data.length) {
            const count = data[i + 1];
            const value = data[i + 2];

            if (count === 0 && value === RLE_ESCAPE) {
                // Literal escape byte
                output.push(RLE_ESCAPE);
            } else {
                // Run of count + 3 bytes
                const runLen = count + RLE_MIN_RUN;
                for (let j = 0; j < runLen; j++) {
                    output.push(value);
                }
            }
            i += 3;
        } else {
            output.push(data[i]);
            i++;
        }
    }

    return new Uint8Array(output);
}

// ============================================================================
// COMBINED COMPRESSION PIPELINE
// ============================================================================

/**
 * Full compression pipeline for voxel chunk
 * Pipeline: Morton → Palette → RLE
 *
 * @param {Uint8Array} voxels - Raw voxel data (linear order)
 * @param {number} chunkSize - Chunk dimension (e.g., 32)
 * @returns {{
 *   compressed: Uint8Array,
 *   palette: number[],
 *   bits: number,
 *   originalSize: number,
 *   compressedSize: number,
 *   ratio: number
 * }}
 */
export function compressChunk(voxels, chunkSize = 32) {
    // 1. Reorder to Morton for better locality
    const mortonOrdered = linearToMorton(voxels, chunkSize);

    // 2. Palette compression
    const { palette, bits, packed } = paletteCompress(mortonOrdered);

    // 3. RLE on palette-compressed data
    const rleCompressed = rleEncode(packed);

    // 4. Build final output with header
    // Header: [palette_count:2][bits:1][palette...][rle_data...]
    const paletteBytes = palette.length * 2;  // 16-bit palette entries
    const totalSize = 3 + paletteBytes + rleCompressed.length;
    const output = new Uint8Array(totalSize);
    const view = new DataView(output.buffer);

    // Write header
    view.setUint16(0, palette.length, true);  // Palette count
    output[2] = bits;                          // Bits per index

    // Write palette
    let offset = 3;
    for (const val of palette) {
        view.setUint16(offset, val, true);
        offset += 2;
    }

    // Write RLE data
    output.set(rleCompressed, offset);

    return {
        compressed: output,
        palette,
        bits,
        originalSize: voxels.length,
        compressedSize: output.length,
        ratio: voxels.length / output.length,
    };
}

/**
 * Decompress voxel chunk
 * @param {Uint8Array} compressed
 * @param {number} chunkSize
 * @returns {Uint8Array} - Linear-ordered voxel data
 */
export function decompressChunk(compressed, chunkSize = 32) {
    const view = new DataView(compressed.buffer, compressed.byteOffset);

    // Read header
    const paletteCount = view.getUint16(0, true);
    const bits = compressed[2];

    // Read palette
    const palette = [];
    let offset = 3;
    for (let i = 0; i < paletteCount; i++) {
        palette.push(view.getUint16(offset, true));
        offset += 2;
    }

    // Read RLE data
    const rleData = compressed.slice(offset);

    // Decompress RLE
    const packed = rleDecode(rleData);

    // Decompress palette
    const voxelCount = chunkSize * chunkSize * chunkSize;
    const mortonOrdered = paletteDecompress(palette, bits, packed, voxelCount);

    // Convert Morton to linear
    const linear = mortonToLinear(mortonOrdered, chunkSize);

    return linear;
}

// ============================================================================
// DELTA ENCODING - For modifications only
// ============================================================================

/**
 * Encode chunk modifications as delta
 * @param {Map<number, {old: number, new: number}>} modifications
 * @returns {Uint8Array}
 */
export function encodeDelta(modifications) {
    if (modifications.size === 0) {
        return new Uint8Array(0);
    }

    // Format: [count:4][index:4, oldVal:1, newVal:1]...
    const size = 4 + modifications.size * 6;
    const output = new Uint8Array(size);
    const view = new DataView(output.buffer);

    view.setUint32(0, modifications.size, true);

    let offset = 4;
    for (const [index, { old: oldVal, new: newVal }] of modifications) {
        view.setUint32(offset, index, true);
        output[offset + 4] = oldVal;
        output[offset + 5] = newVal;
        offset += 6;
    }

    return output;
}

/**
 * Decode delta modifications
 * @param {Uint8Array} data
 * @returns {Map<number, {old: number, new: number}>}
 */
export function decodeDelta(data) {
    const modifications = new Map();

    if (data.length === 0) return modifications;

    const view = new DataView(data.buffer, data.byteOffset);
    const count = view.getUint32(0, true);

    let offset = 4;
    for (let i = 0; i < count; i++) {
        const index = view.getUint32(offset, true);
        const oldVal = data[offset + 4];
        const newVal = data[offset + 5];
        modifications.set(index, { old: oldVal, new: newVal });
        offset += 6;
    }

    return modifications;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a compression statistics report
 * @param {Uint8Array} original
 * @param {Uint8Array} compressed
 * @returns {Object}
 */
export function compressionStats(original, compressed) {
    return {
        originalSize: original.length,
        compressedSize: compressed.length,
        ratio: (original.length / compressed.length).toFixed(2),
        savings: (100 * (1 - compressed.length / original.length)).toFixed(1) + '%',
    };
}

/**
 * Test compression roundtrip
 * @param {Uint8Array} data
 * @param {number} chunkSize
 * @returns {boolean}
 */
export function testRoundtrip(data, chunkSize = 32) {
    const { compressed } = compressChunk(data, chunkSize);
    const decompressed = decompressChunk(compressed, chunkSize);

    if (data.length !== decompressed.length) return false;

    for (let i = 0; i < data.length; i++) {
        if (data[i] !== decompressed[i]) return false;
    }

    return true;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    // CRC32
    crc32,
    verifyCRC32,

    // Morton codes
    encodeMorton3D,
    decodeMorton3D,
    getMortonIndices,
    linearToMorton,
    mortonToLinear,

    // Palette
    buildPalette,
    bitsForPalette,
    paletteCompress,
    paletteDecompress,

    // RLE
    rleEncode,
    rleDecode,

    // Combined pipeline
    compressChunk,
    decompressChunk,

    // Delta
    encodeDelta,
    decodeDelta,

    // Utilities
    compressionStats,
    testRoundtrip,
};
