// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RLECompression.js - Run-Length Encoding for Voxel Columns
 * 
 * Compresses vertical columns of voxels using run-length encoding.
 * Extremely effective for terrain (long runs of air above, stone below).
 * 
 * Benefits:
 * - 10-50× compression for typical terrain
 * - Fast encode/decode
 * - Great for network transfer
 * - Complements palette compression
 * 
 * Format:
 * [count:u8, material:u8, count:u8, material:u8, ...]
 * For runs > 255: [255, material, count-255, material, ...]
 */

/**
 * Encode a single column using RLE
 * @param {Uint8Array} column - Voxel data for one column
 * @returns {Uint8Array} - Compressed data
 */
export function encodeColumn(column) {
    if (column.length === 0) return new Uint8Array(0);
    
    const runs = [];
    let currentMaterial = column[0];
    let count = 1;
    
    for (let i = 1; i < column.length; i++) {
        if (column[i] === currentMaterial && count < 255) {
            count++;
        } else {
            runs.push(count, currentMaterial);
            currentMaterial = column[i];
            count = 1;
        }
    }
    runs.push(count, currentMaterial);
    
    return new Uint8Array(runs);
}

/**
 * Decode RLE column back to raw data
 * @param {Uint8Array} encoded 
 * @param {number} expectedLength - Expected output length
 * @returns {Uint8Array}
 */
export function decodeColumn(encoded, expectedLength) {
    const result = new Uint8Array(expectedLength);
    let outIndex = 0;
    
    for (let i = 0; i < encoded.length; i += 2) {
        const count = encoded[i];
        const material = encoded[i + 1];
        
        for (let j = 0; j < count && outIndex < expectedLength; j++) {
            result[outIndex++] = material;
        }
    }
    
    return result;
}

/**
 * RLEChunkCompressor - RLE compression for entire chunks
 */
export class RLEChunkCompressor {
    constructor() {
        this.stats = {
            totalUncompressed: 0,
            totalCompressed: 0,
            chunksCompressed: 0,
            avgCompressionRatio: 0,
        };
    }
    
    /**
     * Compress a chunk using column-based RLE
     * @param {Uint8Array} voxels - Flat voxel array
     * @param {number} sizeX 
     * @param {number} sizeY - Height (vertical)
     * @param {number} sizeZ 
     * @returns {Object} - { data: Uint8Array, columnOffsets: Uint32Array }
     */
    compressChunk(voxels, sizeX = 32, sizeY = 32, sizeZ = 32) {
        const numColumns = sizeX * sizeZ;
        const columnOffsets = new Uint32Array(numColumns + 1);
        const compressedColumns = [];
        
        let totalCompressedSize = 0;
        
        // Compress each vertical column
        for (let z = 0; z < sizeZ; z++) {
            for (let x = 0; x < sizeX; x++) {
                const colIndex = x + z * sizeX;
                columnOffsets[colIndex] = totalCompressedSize;
                
                // Extract column
                const column = new Uint8Array(sizeY);
                for (let y = 0; y < sizeY; y++) {
                    const voxelIndex = x + y * sizeX + z * sizeX * sizeY;
                    column[y] = voxels[voxelIndex];
                }
                
                // Compress column
                const compressed = encodeColumn(column);
                compressedColumns.push(compressed);
                totalCompressedSize += compressed.length;
            }
        }
        
        // Final offset (total size)
        columnOffsets[numColumns] = totalCompressedSize;
        
        // Combine all compressed columns
        const data = new Uint8Array(totalCompressedSize);
        let offset = 0;
        for (const col of compressedColumns) {
            data.set(col, offset);
            offset += col.length;
        }
        
        // Update stats
        const uncompressedSize = voxels.length;
        this.stats.totalUncompressed += uncompressedSize;
        this.stats.totalCompressed += totalCompressedSize + columnOffsets.byteLength;
        this.stats.chunksCompressed++;
        this.stats.avgCompressionRatio = this.stats.totalUncompressed / this.stats.totalCompressed;
        
        return {
            data,
            columnOffsets,
            sizeX,
            sizeY,
            sizeZ,
            uncompressedSize,
            compressedSize: totalCompressedSize,
            ratio: uncompressedSize / totalCompressedSize,
        };
    }
    
    /**
     * Decompress a chunk from RLE format
     * @param {Object} compressed - { data, columnOffsets, sizeX, sizeY, sizeZ }
     * @returns {Uint8Array} - Decompressed voxel data
     */
    decompressChunk(compressed) {
        const { data, columnOffsets, sizeX, sizeY, sizeZ } = compressed;
        const voxels = new Uint8Array(sizeX * sizeY * sizeZ);
        
        // Decompress each column
        for (let z = 0; z < sizeZ; z++) {
            for (let x = 0; x < sizeX; x++) {
                const colIndex = x + z * sizeX;
                const startOffset = columnOffsets[colIndex];
                const endOffset = columnOffsets[colIndex + 1];
                
                // Extract compressed column data
                const compressedCol = data.subarray(startOffset, endOffset);
                
                // Decode column
                const column = decodeColumn(compressedCol, sizeY);
                
                // Copy to voxel array
                for (let y = 0; y < sizeY; y++) {
                    const voxelIndex = x + y * sizeX + z * sizeX * sizeY;
                    voxels[voxelIndex] = column[y];
                }
            }
        }
        
        return voxels;
    }
    
    /**
     * Get a single voxel from compressed data without full decompression
     * @param {Object} compressed 
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {number} - Material ID
     */
    getVoxel(compressed, x, y, z) {
        const { data, columnOffsets, sizeX, sizeY } = compressed;
        const colIndex = x + z * sizeX;
        const startOffset = columnOffsets[colIndex];
        const endOffset = columnOffsets[colIndex + 1];
        
        // Walk through RLE runs to find the voxel at height y
        let currentY = 0;
        for (let i = startOffset; i < endOffset; i += 2) {
            const count = data[i];
            const material = data[i + 1];
            
            if (currentY + count > y) {
                return material;
            }
            currentY += count;
        }
        
        return 0;  // Default to air
    }
    
    /**
     * Serialize compressed chunk for storage/network
     * @param {Object} compressed 
     * @returns {ArrayBuffer}
     */
    serialize(compressed) {
        const { data, columnOffsets, sizeX, sizeY, sizeZ } = compressed;
        
        // Header: sizeX, sizeY, sizeZ, dataLength (4 bytes each)
        const headerSize = 16;
        const offsetsSize = columnOffsets.byteLength;
        const totalSize = headerSize + offsetsSize + data.length;
        
        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        const uint8View = new Uint8Array(buffer);
        
        // Write header
        view.setUint32(0, sizeX, true);
        view.setUint32(4, sizeY, true);
        view.setUint32(8, sizeZ, true);
        view.setUint32(12, data.length, true);
        
        // Write column offsets
        uint8View.set(new Uint8Array(columnOffsets.buffer), headerSize);
        
        // Write data
        uint8View.set(data, headerSize + offsetsSize);
        
        return buffer;
    }
    
    /**
     * Deserialize compressed chunk from storage/network
     * @param {ArrayBuffer} buffer 
     * @returns {Object}
     */
    deserialize(buffer) {
        const view = new DataView(buffer);
        const uint8View = new Uint8Array(buffer);
        
        // Read header
        const sizeX = view.getUint32(0, true);
        const sizeY = view.getUint32(4, true);
        const sizeZ = view.getUint32(8, true);
        const dataLength = view.getUint32(12, true);
        
        const headerSize = 16;
        const numColumns = sizeX * sizeZ;
        const offsetsSize = (numColumns + 1) * 4;
        
        // Read column offsets
        const columnOffsets = new Uint32Array(
            buffer.slice(headerSize, headerSize + offsetsSize)
        );
        
        // Read data
        const data = new Uint8Array(
            buffer.slice(headerSize + offsetsSize)
        );
        
        return {
            data,
            columnOffsets,
            sizeX,
            sizeY,
            sizeZ,
            compressedSize: dataLength,
            uncompressedSize: sizeX * sizeY * sizeZ,
            ratio: (sizeX * sizeY * sizeZ) / dataLength,
        };
    }
    
    /**
     * Get compression stats
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Reset stats
     */
    resetStats() {
        this.stats = {
            totalUncompressed: 0,
            totalCompressed: 0,
            chunksCompressed: 0,
            avgCompressionRatio: 0,
        };
    }
}

/**
 * Hybrid compression: Palette + RLE
 * First applies palette compression, then RLE on the indices
 */
export class HybridChunkCompressor {
    constructor() {
        this.rleCompressor = new RLEChunkCompressor();
    }
    
    /**
     * Compress chunk using palette + RLE
     * @param {Uint8Array} voxels 
     * @param {number} sizeX 
     * @param {number} sizeY 
     * @param {number} sizeZ 
     * @returns {Object}
     */
    compress(voxels, sizeX = 32, sizeY = 32, sizeZ = 32) {
        // Build palette
        const palette = [];
        const paletteMap = new Map();
        
        for (let i = 0; i < voxels.length; i++) {
            const mat = voxels[i];
            if (!paletteMap.has(mat)) {
                paletteMap.set(mat, palette.length);
                palette.push(mat);
            }
        }
        
        // Convert to palette indices
        const indexed = new Uint8Array(voxels.length);
        for (let i = 0; i < voxels.length; i++) {
            indexed[i] = paletteMap.get(voxels[i]);
        }
        
        // Apply RLE to indexed data
        const rleCompressed = this.rleCompressor.compressChunk(indexed, sizeX, sizeY, sizeZ);
        
        return {
            ...rleCompressed,
            palette: new Uint8Array(palette),
            isPaletteCompressed: true,
        };
    }
    
    /**
     * Decompress palette + RLE compressed chunk
     * @param {Object} compressed 
     * @returns {Uint8Array}
     */
    decompress(compressed) {
        // Decompress RLE
        const indexed = this.rleCompressor.decompressChunk(compressed);
        
        // Convert palette indices back to materials
        const { palette } = compressed;
        const voxels = new Uint8Array(indexed.length);
        
        for (let i = 0; i < indexed.length; i++) {
            voxels[i] = palette[indexed[i]] || 0;
        }
        
        return voxels;
    }
}

export default RLEChunkCompressor;
