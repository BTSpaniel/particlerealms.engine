// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Compression Module - Unified Compression System
 * 
 * Provides compression for all engine data types:
 * - Particles: 390x compression (VLInt + Delta + Quantization + PCA/DCT)
 * - Meshes: 70-90% reduction (Quantization + Octahedral normals + VLInt indices)
 * - Voxels: 80-95% reduction (RLE + Octree + Palette)
 * - Animations: 60-80% reduction (Quaternion + DCT + Keyframe reduction)
 * 
 * All compression techniques are lossless or near-lossless with configurable quality.
 */

// Core utilities
export * from './CompressionUtils.js';

// Lossless compression (zero quality loss)
export * from './LosslessCompression.js';

// Hybrid compression (best of both worlds)
export * from './HybridCompression.js';

// Specialized compression systems
export * from './MeshCompression.js';
export * from './VoxelCompression.js';
export * from './AnimationCompression.js';

// Re-export commonly used functions
import {
    packVLInt,
    unpackVLInt,
    quantizeFloatArray,
    dequantizeFloatArray,
    encodeNormalArray,
    decodeNormalArray,
    getCompressionStats,
    formatBytes,
} from './CompressionUtils.js';

import {
    compressMesh,
    decompressMesh,
    compressMeshBatch,
} from './MeshCompression.js';

import {
    compressVoxelChunk,
    decompressVoxelChunk,
    compressVoxelWorld,
    decompressVoxelWorld,
} from './VoxelCompression.js';

import {
    compressSkeletalAnimation,
    decompressSkeletalAnimation,
    compressAnimationBatch,
    reduceKeyframes,
} from './AnimationCompression.js';

// Unified compression API
export default {
    // Utilities
    packVLInt,
    unpackVLInt,
    quantizeFloatArray,
    dequantizeFloatArray,
    encodeNormalArray,
    decodeNormalArray,
    getCompressionStats,
    formatBytes,
    
    // Mesh compression
    compressMesh,
    decompressMesh,
    compressMeshBatch,
    
    // Voxel compression
    compressVoxelChunk,
    decompressVoxelChunk,
    compressVoxelWorld,
    decompressVoxelWorld,
    
    // Animation compression
    compressSkeletalAnimation,
    decompressSkeletalAnimation,
    compressAnimationBatch,
    reduceKeyframes,
};
