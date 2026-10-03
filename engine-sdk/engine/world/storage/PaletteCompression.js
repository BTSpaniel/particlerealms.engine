// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PaletteCompression.js - Palette-based Chunk Compression
 * 
 * Compresses voxel data using palette indirection.
 * Instead of storing full material IDs, store indices into a small palette.
 * 
 * Benefits:
 * - 4-8× memory savings for chunks with few unique materials
 * - Better cache locality
 * - Faster chunk serialization
 * 
 * Compression levels:
 * - 1 material:   0 bits per voxel (entire chunk is one material)
 * - 2 materials:  1 bit per voxel
 * - 3-4 materials: 2 bits per voxel
 * - 5-16 materials: 4 bits per voxel
 * - 17-256 materials: 8 bits per voxel (no compression)
 */

/**
 * Determine bits needed to represent palette size
 * @param {number} paletteSize 
 * @returns {number}
 */
function bitsNeeded(paletteSize) {
    if (paletteSize <= 1) return 0;
    if (paletteSize <= 2) return 1;
    if (paletteSize <= 4) return 2;
    if (paletteSize <= 16) return 4;
    return 8;
}

/**
 * CompressedChunk - Palette-compressed voxel storage
 */
export class CompressedChunk {
    constructor(size = 32) {
        this.size = size;
        this.volume = size * size * size;
        
        // Palette: maps index -> material ID
        this.palette = [];
        
        // Reverse lookup: maps material ID -> palette index
        this.paletteReverse = new Map();
        
        // Compressed data (varies based on palette size)
        this.data = null;
        this.bitsPerVoxel = 0;
        
        // Stats
        this.compressedSize = 0;
        this.uncompressedSize = this.volume;
    }
    
    /**
     * Compress raw voxel data
     * @param {Uint8Array} rawData - Uncompressed voxel data
     * @returns {CompressedChunk} - this
     */
    compress(rawData) {
        // Build palette from unique materials
        this.palette = [];
        this.paletteReverse.clear();
        
        for (let i = 0; i < rawData.length; i++) {
            const material = rawData[i];
            if (!this.paletteReverse.has(material)) {
                this.paletteReverse.set(material, this.palette.length);
                this.palette.push(material);
            }
        }
        
        // Determine compression level
        this.bitsPerVoxel = bitsNeeded(this.palette.length);
        
        // Single material - no data needed
        if (this.bitsPerVoxel === 0) {
            this.data = null;
            this.compressedSize = 1;  // Just palette
            return this;
        }
        
        // No compression possible
        if (this.bitsPerVoxel === 8) {
            this.data = new Uint8Array(rawData);
            this.compressedSize = rawData.length + this.palette.length;
            return this;
        }
        
        // Compress to packed bits
        const totalBits = this.volume * this.bitsPerVoxel;
        const byteCount = Math.ceil(totalBits / 8);
        this.data = new Uint8Array(byteCount);
        
        const voxelsPerByte = Math.floor(8 / this.bitsPerVoxel);
        const mask = (1 << this.bitsPerVoxel) - 1;
        
        for (let i = 0; i < rawData.length; i++) {
            const paletteIndex = this.paletteReverse.get(rawData[i]);
            const byteIndex = Math.floor(i / voxelsPerByte);
            const bitOffset = (i % voxelsPerByte) * this.bitsPerVoxel;
            this.data[byteIndex] |= (paletteIndex & mask) << bitOffset;
        }
        
        this.compressedSize = byteCount + this.palette.length;
        return this;
    }
    
    /**
     * Decompress to raw voxel data
     * @returns {Uint8Array}
     */
    decompress() {
        const rawData = new Uint8Array(this.volume);
        
        // Single material
        if (this.bitsPerVoxel === 0) {
            rawData.fill(this.palette[0] || 0);
            return rawData;
        }
        
        // No compression
        if (this.bitsPerVoxel === 8) {
            return new Uint8Array(this.data);
        }
        
        // Decompress packed bits
        const voxelsPerByte = Math.floor(8 / this.bitsPerVoxel);
        const mask = (1 << this.bitsPerVoxel) - 1;
        
        for (let i = 0; i < this.volume; i++) {
            const byteIndex = Math.floor(i / voxelsPerByte);
            const bitOffset = (i % voxelsPerByte) * this.bitsPerVoxel;
            const paletteIndex = (this.data[byteIndex] >> bitOffset) & mask;
            rawData[i] = this.palette[paletteIndex] || 0;
        }
        
        return rawData;
    }
    
    /**
     * Get voxel at position (without full decompression)
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {number} - Material ID
     */
    get(x, y, z) {
        const index = x + y * this.size + z * this.size * this.size;
        
        if (this.bitsPerVoxel === 0) {
            return this.palette[0] || 0;
        }
        
        if (this.bitsPerVoxel === 8) {
            return this.data[index];
        }
        
        const voxelsPerByte = Math.floor(8 / this.bitsPerVoxel);
        const mask = (1 << this.bitsPerVoxel) - 1;
        const byteIndex = Math.floor(index / voxelsPerByte);
        const bitOffset = (index % voxelsPerByte) * this.bitsPerVoxel;
        const paletteIndex = (this.data[byteIndex] >> bitOffset) & mask;
        
        return this.palette[paletteIndex] || 0;
    }
    
    /**
     * Set voxel at position (may trigger recompression)
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {number} material 
     */
    set(x, y, z, material) {
        // Check if material is in palette
        let paletteIndex = this.paletteReverse.get(material);
        
        if (paletteIndex === undefined) {
            // Need to add to palette
            const newPaletteSize = this.palette.length + 1;
            const newBitsNeeded = bitsNeeded(newPaletteSize);
            
            if (newBitsNeeded > this.bitsPerVoxel) {
                // Need to re-compress with more bits
                const rawData = this.decompress();
                const index = x + y * this.size + z * this.size * this.size;
                rawData[index] = material;
                this.compress(rawData);
                return;
            }
            
            // Can add to existing palette
            paletteIndex = this.palette.length;
            this.palette.push(material);
            this.paletteReverse.set(material, paletteIndex);
        }
        
        // Update compressed data
        const index = x + y * this.size + z * this.size * this.size;
        
        if (this.bitsPerVoxel === 0) {
            // Was single material, now need data
            if (material !== this.palette[0]) {
                const rawData = this.decompress();
                rawData[index] = material;
                this.compress(rawData);
            }
            return;
        }
        
        if (this.bitsPerVoxel === 8) {
            this.data[index] = material;
            return;
        }
        
        // Update packed bits
        const voxelsPerByte = Math.floor(8 / this.bitsPerVoxel);
        const mask = (1 << this.bitsPerVoxel) - 1;
        const byteIndex = Math.floor(index / voxelsPerByte);
        const bitOffset = (index % voxelsPerByte) * this.bitsPerVoxel;
        
        // Clear old bits and set new
        this.data[byteIndex] &= ~(mask << bitOffset);
        this.data[byteIndex] |= (paletteIndex & mask) << bitOffset;
    }
    
    /**
     * Get compression ratio
     * @returns {number}
     */
    getCompressionRatio() {
        return this.uncompressedSize / Math.max(1, this.compressedSize);
    }
    
    /**
     * Serialize for storage/network
     * @returns {ArrayBuffer}
     */
    serialize() {
        // Format: [paletteSize:u8] [palette:u8[]] [bitsPerVoxel:u8] [data:u8[]]
        const paletteBytes = this.palette.length;
        const dataBytes = this.data ? this.data.length : 0;
        const totalSize = 1 + paletteBytes + 1 + dataBytes;
        
        const buffer = new ArrayBuffer(totalSize);
        const view = new Uint8Array(buffer);
        
        let offset = 0;
        view[offset++] = this.palette.length;
        for (const mat of this.palette) {
            view[offset++] = mat;
        }
        view[offset++] = this.bitsPerVoxel;
        if (this.data) {
            view.set(this.data, offset);
        }
        
        return buffer;
    }
    
    /**
     * Deserialize from storage/network
     * @param {ArrayBuffer} buffer 
     * @returns {CompressedChunk}
     */
    static deserialize(buffer, size = 32) {
        const chunk = new CompressedChunk(size);
        const view = new Uint8Array(buffer);
        
        let offset = 0;
        const paletteSize = view[offset++];
        
        chunk.palette = [];
        chunk.paletteReverse.clear();
        for (let i = 0; i < paletteSize; i++) {
            const mat = view[offset++];
            chunk.palette.push(mat);
            chunk.paletteReverse.set(mat, i);
        }
        
        chunk.bitsPerVoxel = view[offset++];
        
        if (chunk.bitsPerVoxel > 0) {
            const dataLength = view.length - offset;
            chunk.data = new Uint8Array(view.buffer, offset, dataLength);
        }
        
        chunk.compressedSize = view.length;
        
        return chunk;
    }
}

/**
 * ChunkCompressor - Manages compression for multiple chunks
 */
export class ChunkCompressor {
    constructor() {
        this.compressedChunks = new Map();
        this.stats = {
            totalUncompressed: 0,
            totalCompressed: 0,
            chunksCompressed: 0,
        };
    }
    
    /**
     * Compress and store a chunk
     * @param {string} key - Chunk key
     * @param {Uint8Array} rawData 
     * @param {number} size 
     * @returns {CompressedChunk}
     */
    compressChunk(key, rawData, size = 32) {
        const chunk = new CompressedChunk(size);
        chunk.compress(rawData);
        
        this.compressedChunks.set(key, chunk);
        
        this.stats.totalUncompressed += chunk.uncompressedSize;
        this.stats.totalCompressed += chunk.compressedSize;
        this.stats.chunksCompressed++;
        
        return chunk;
    }
    
    /**
     * Get compressed chunk
     * @param {string} key 
     * @returns {CompressedChunk|null}
     */
    getChunk(key) {
        return this.compressedChunks.get(key) || null;
    }
    
    /**
     * Decompress a chunk
     * @param {string} key 
     * @returns {Uint8Array|null}
     */
    decompressChunk(key) {
        const chunk = this.compressedChunks.get(key);
        return chunk ? chunk.decompress() : null;
    }
    
    /**
     * Remove a chunk
     * @param {string} key 
     */
    removeChunk(key) {
        const chunk = this.compressedChunks.get(key);
        if (chunk) {
            this.stats.totalUncompressed -= chunk.uncompressedSize;
            this.stats.totalCompressed -= chunk.compressedSize;
            this.stats.chunksCompressed--;
            this.compressedChunks.delete(key);
        }
    }
    
    /**
     * Get overall compression ratio
     * @returns {number}
     */
    getOverallRatio() {
        return this.stats.totalUncompressed / Math.max(1, this.stats.totalCompressed);
    }
    
    /**
     * Get stats
     */
    getStats() {
        return {
            ...this.stats,
            ratio: this.getOverallRatio(),
            memorySavedMB: (this.stats.totalUncompressed - this.stats.totalCompressed) / (1024 * 1024),
        };
    }
    
    /**
     * Clear all chunks
     */
    clear() {
        this.compressedChunks.clear();
        this.stats = {
            totalUncompressed: 0,
            totalCompressed: 0,
            chunksCompressed: 0,
        };
    }
}

export default ChunkCompressor;
