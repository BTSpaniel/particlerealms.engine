// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/world/storage/index.js - World Storage Barrel Export
 */

// Core storage
export {
    WorldStorage,
    WORLD_METADATA_VERSION,
    WORLD_WAL_VERSION,
    parseWorldWal,
    parseWorldWalHeader,
    validateWorldMetadata,
} from './WorldStorage.js';

// Serialization
export {
    serializeChunk,
    deserializeChunk,
    applyDelta,
    chunkKey,
    parseChunkKey,
    estimateChunkSize,
    BinaryWriter,
    BinaryReader,
    CHUNK_LEGACY_VERSION,
    CHUNK_VERSION,
} from './ChunkSerializer.js';

// Compression
export { CompressedChunk, ChunkCompressor } from './PaletteCompression.js';
export { encodeColumn, decodeColumn, RLEChunkCompressor, HybridChunkCompressor } from './RLECompression.js';
export { crc32, verifyCRC32, linearToMorton, mortonToLinear, compressChunk, decompressChunk } from './VoxelCompression.js';

// Persistence
export { RegionFile, RegionManager } from './RegionFile.js';
export { ChunkPersistence } from './ChunkPersistence.js';
export { DiskMeshCache } from './DiskMeshCache.js';

// Networking
export {
    ChunkNetworking,
    CHUNK_NETWORK_PROTOCOL,
    CHUNK_NETWORK_WRITE_PROTOCOL,
    CHUNK_NETWORK_READ_PROTOCOLS,
} from './ChunkNetworking.js';
