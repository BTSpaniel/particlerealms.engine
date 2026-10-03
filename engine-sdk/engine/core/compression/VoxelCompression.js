// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelCompression.js - Voxel Data Compression
 * 
 * Compresses voxel data using:
 * - Run-Length Encoding (RLE): 80-95% reduction for sparse data
 * - Octree structure: Hierarchical compression
 * - Palette compression: Reuse common materials
 * - Delta encoding: Store chunk changes
 * 
 * Typical compression: 80-95% reduction for typical voxel worlds
 */

import {
    runLengthEncode,
    runLengthDecode,
    runLengthEncodeCompact,
    createPalette,
    decodePalette,
    deltaEncode,
    deltaDecode,
    packVLInt,
    unpackVLInt,
    getCompressionStats,
    formatBytes,
} from './CompressionUtils.js';

import {
    compressLossless,
    decompressLossless,
} from './LosslessCompression.js';

import {
    quantizationErrorReport,
} from '../math/QuantMath.js';

// ============================================================================
// VOXEL CHUNK COMPRESSION
// ============================================================================

/**
 * Compress voxel chunk data
 * @param {Uint8Array|Uint16Array} voxels - Flat array of voxel IDs
 * @param {Object} options - { size: [x,y,z], usePalette, useRLE, useOctree, lossless }
 * @returns {Object} Compressed chunk data
 */
export function compressVoxelChunk(voxels, options = {}) {
    const {
        size = [16, 16, 16],
        usePalette = true,
        useRLE = true,
        useOctree = false,
        lossless = false,
    } = options;
    
    const startTime = performance.now();
    const originalSize = voxels.byteLength;
    
    let compressed = {
        version: 1,
        size,
        method: [],
    };
    
    // LOSSLESS MODE: Zero quality loss, perfect reconstruction
    if (lossless) {
        compressed.lossless = true;
        compressed.data = compressLossless(voxels);
        compressed.method.push('lossless');
        
        const compressedSize = compressed.data.stats.compressedSize;
        compressed.stats = getCompressionStats(originalSize, compressedSize);
        compressed.stats.compressionTime = (performance.now() - startTime).toFixed(2) + 'ms';
        compressed.quality = createVoxelQualityReport(voxels, decompressLossless(compressed.data));
        compressed.stats.quality = compressed.quality;
        
        return compressed;
    }
    
    let data = Array.from(voxels);
    
    // Step 1: Palette compression (if many repeated values)
    if (usePalette) {
        const { palette, indices } = createPalette(data);
        
        // Only use palette if it saves space
        if (palette.length < data.length / 4) {
            compressed.palette = new Uint16Array(palette);
            data = indices;
            compressed.method.push('palette');
        }
    }
    
    // Step 2: Run-Length Encoding (for sparse data)
    if (useRLE) {
        const runs = runLengthEncode(data);
        
        // Only use RLE if it saves space
        if (runs.length < data.length / 2) {
            compressed.rle = runs;
            compressed.method.push('rle');
        } else {
            // RLE didn't help, store raw
            compressed.raw = new Uint16Array(data);
            compressed.method.push('raw');
        }
    } else {
        compressed.raw = new Uint16Array(data);
        compressed.method.push('raw');
    }
    
    // Step 3: Octree compression (optional, for very sparse data)
    if (useOctree && !compressed.rle) {
        const octree = buildOctree(data, size);
        if (octree.nodeCount < data.length / 8) {
            compressed.octree = octree;
            compressed.method = ['octree'];
        }
    }
    
    const compressedSize = calculateVoxelCompressedSize(compressed);
    compressed.stats = getCompressionStats(originalSize, compressedSize);
    compressed.stats.compressionTime = (performance.now() - startTime).toFixed(2) + 'ms';
    compressed.quality = createVoxelQualityReport(voxels, decompressVoxelChunk(compressed));
    compressed.stats.quality = compressed.quality;
    
    return compressed;
}

/**
 * Decompress voxel chunk data
 * @param {Object} compressed - Compressed chunk data
 * @returns {Uint16Array} Decompressed voxel data
 */
export function decompressVoxelChunk(compressed) {
    // LOSSLESS MODE: Perfect reconstruction
    if (compressed.lossless) {
        return decompressLossless(compressed.data);
    }
    
    // LOSSY MODE: Decompress with RLE/Octree/Palette
    let data;
    
    // Decompress based on method
    if (compressed.octree) {
        data = decompressOctree(compressed.octree, compressed.size);
    } else if (compressed.rle) {
        data = runLengthDecode(compressed.rle);
    } else if (compressed.raw) {
        data = Array.from(compressed.raw);
    } else {
        throw new Error('Unknown compression method');
    }
    
    // Apply palette if used
    if (compressed.palette) {
        data = decodePalette(Array.from(compressed.palette), data);
    }
    
    return new Uint16Array(data);
}

// ============================================================================
// OCTREE COMPRESSION
// ============================================================================

/**
 * Build octree from voxel data
 * Recursively subdivides space, storing only non-empty nodes
 */
function buildOctree(voxels, size) {
    const [sx, sy, sz] = size;
    const root = buildOctreeNode(voxels, 0, 0, 0, sx, sy, sz, sx, sy);
    
    return {
        root,
        size,
        nodeCount: countOctreeNodes(root),
    };
}

function buildOctreeNode(voxels, x, y, z, w, h, d, sx, sy) {
    // Base case: single voxel
    if (w === 1 && h === 1 && d === 1) {
        const idx = x + y * sx + z * sx * sy;
        return { type: 'leaf', value: voxels[idx] };
    }
    
    // Check if all voxels are the same
    const firstValue = voxels[x + y * sx + z * sx * sy];
    let allSame = true;
    
    for (let dz = 0; dz < d && allSame; dz++) {
        for (let dy = 0; dy < h && allSame; dy++) {
            for (let dx = 0; dx < w && allSame; dx++) {
                const idx = (x + dx) + (y + dy) * sx + (z + dz) * sx * sy;
                if (voxels[idx] !== firstValue) {
                    allSame = false;
                }
            }
        }
    }
    
    if (allSame) {
        return { type: 'uniform', value: firstValue };
    }
    
    // Subdivide into 8 children
    const hw = Math.floor(w / 2);
    const hh = Math.floor(h / 2);
    const hd = Math.floor(d / 2);
    
    const children = [];
    for (let cz = 0; cz < 2; cz++) {
        for (let cy = 0; cy < 2; cy++) {
            for (let cx = 0; cx < 2; cx++) {
                const child = buildOctreeNode(
                    voxels,
                    x + cx * hw,
                    y + cy * hh,
                    z + cz * hd,
                    cx === 1 ? w - hw : hw,
                    cy === 1 ? h - hh : hh,
                    cz === 1 ? d - hd : hd,
                    sx, sy
                );
                children.push(child);
            }
        }
    }
    
    return { type: 'branch', children };
}

function countOctreeNodes(node) {
    if (node.type === 'leaf' || node.type === 'uniform') {
        return 1;
    }
    return 1 + node.children.reduce((sum, child) => sum + countOctreeNodes(child), 0);
}

/**
 * Decompress octree back to flat voxel array
 */
function decompressOctree(octree, size) {
    const [sx, sy, sz] = size;
    const voxels = new Array(sx * sy * sz).fill(0);
    
    decompressOctreeNode(octree.root, voxels, 0, 0, 0, sx, sy, sz, sx, sy);
    
    return voxels;
}

function decompressOctreeNode(node, voxels, x, y, z, w, h, d, sx, sy) {
    if (node.type === 'leaf' || node.type === 'uniform') {
        // Fill region with value
        for (let dz = 0; dz < d; dz++) {
            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    const idx = (x + dx) + (y + dy) * sx + (z + dz) * sx * sy;
                    voxels[idx] = node.value;
                }
            }
        }
        return;
    }
    
    // Recursively decompress children
    const hw = Math.floor(w / 2);
    const hh = Math.floor(h / 2);
    const hd = Math.floor(d / 2);
    
    let childIdx = 0;
    for (let cz = 0; cz < 2; cz++) {
        for (let cy = 0; cy < 2; cy++) {
            for (let cx = 0; cx < 2; cx++) {
                decompressOctreeNode(
                    node.children[childIdx++],
                    voxels,
                    x + cx * hw,
                    y + cy * hh,
                    z + cz * hd,
                    cx === 1 ? w - hw : hw,
                    cy === 1 ? h - hh : hh,
                    cz === 1 ? d - hd : hd,
                    sx, sy
                );
            }
        }
    }
}

// ============================================================================
// CHUNK DELTA COMPRESSION
// ============================================================================

/**
 * Compress changes between two chunk states
 * Perfect for multiplayer sync or undo/redo
 */
export function compressVoxelDelta(oldChunk, newChunk) {
    const changes = [];
    
    for (let i = 0; i < oldChunk.length; i++) {
        if (oldChunk[i] !== newChunk[i]) {
            changes.push({ index: i, value: newChunk[i] });
        }
    }
    
    // If too many changes, just store full chunk
    if (changes.length > oldChunk.length / 2) {
        return {
            type: 'full',
            data: compressVoxelChunk(newChunk),
            quality: {
                policy: 'full-chunk-id-preserving',
                exact: true,
                changeCount: changes.length,
            },
        };
    }
    
    return {
        type: 'delta',
        changes: {
            indices: packVLInt(changes.map(c => c.index)),
            values: new Uint16Array(changes.map(c => c.value)),
        },
        changeCount: changes.length,
        quality: {
            policy: 'delta-id-preserving',
            exact: true,
            changeCount: changes.length,
        },
    };
}

/**
 * Apply delta to chunk
 */
export function applyVoxelDelta(chunk, delta) {
    if (delta.type === 'full') {
        return decompressVoxelChunk(delta.data);
    }
    
    const result = new Uint16Array(chunk);
    const indices = unpackVLInt(delta.changes.indices);
    
    for (let i = 0; i < indices.length; i++) {
        result[indices[i]] = delta.changes.values[i];
    }
    
    return result;
}

// ============================================================================
// WORLD COMPRESSION (Multiple Chunks)
// ============================================================================

/**
 * Compress entire voxel world
 * @param {Map} chunks - Map of chunk coordinates to voxel data
 * @returns {Object} Compressed world data
 */
export function compressVoxelWorld(chunks) {
    const compressed = {
        version: 1,
        chunkCount: chunks.size,
        chunks: new Map(),
    };
    
    let totalOriginal = 0;
    let totalCompressed = 0;
    let totalVoxels = 0;
    let totalFailures = 0;
    
    for (const [coord, voxels] of chunks) {
        const compressedChunk = compressVoxelChunk(voxels);
        compressed.chunks.set(coord, compressedChunk);
        
        totalOriginal += compressedChunk.stats.originalSize;
        totalCompressed += compressedChunk.stats.compressedSize;
        totalVoxels += compressedChunk.quality?.voxels?.count ?? 0;
        totalFailures += compressedChunk.quality?.voxels?.failures ?? 0;
    }
    
    compressed.stats = getCompressionStats(totalOriginal, totalCompressed);
    compressed.quality = {
        policy: 'lossless-id-preserving',
        chunkCount: chunks.size,
        voxels: {
            count: totalVoxels,
            failures: totalFailures,
            withinTolerance: totalFailures === 0,
        },
        exact: totalFailures === 0,
    };
    compressed.stats.quality = compressed.quality;
    
    console.log('[VoxelCompression] Compressed world:', chunks.size, 'chunks');
    console.log('  Original:', formatBytes(totalOriginal));
    console.log('  Compressed:', formatBytes(totalCompressed));
    console.log('  Ratio:', compressed.stats.ratio + 'x');
    
    return compressed;
}

/**
 * Decompress voxel world
 */
export function decompressVoxelWorld(compressed) {
    const chunks = new Map();
    
    for (const [coord, compressedChunk] of compressed.chunks) {
        chunks.set(coord, decompressVoxelChunk(compressedChunk));
    }
    
    return chunks;
}

// ============================================================================
// SIZE CALCULATION
// ============================================================================

function calculateVoxelCompressedSize(compressed) {
    let size = 0;
    
    if (compressed.palette) size += compressed.palette.byteLength;
    if (compressed.rle) size += compressed.rle.length * 8; // Estimate
    if (compressed.raw) size += compressed.raw.byteLength;
    if (compressed.octree) size += compressed.octree.nodeCount * 16; // Estimate
    
    size += 64; // Metadata overhead
    
    return size;
}

function createVoxelQualityReport(source, decoded) {
    const report = quantizationErrorReport(source, decoded, 0);
    return {
        policy: 'lossless-id-preserving',
        voxels: report,
        exact: report.withinTolerance,
    };
}

// ============================================================================
// STREAMING SUPPORT
// ============================================================================

/**
 * Compress chunk for streaming (progressive loading)
 */
export function compressVoxelChunkForStreaming(voxels, size) {
    // Create multiple LODs
    const lods = [
        compressVoxelChunk(voxels, { size, useRLE: true, usePalette: true }),
        // Could add lower resolution versions here
    ];
    
    return {
        lods,
        fullResolution: size,
    };
}

export default {
    compressVoxelChunk,
    decompressVoxelChunk,
    compressVoxelDelta,
    applyVoxelDelta,
    compressVoxelWorld,
    decompressVoxelWorld,
    compressVoxelChunkForStreaming,
};
