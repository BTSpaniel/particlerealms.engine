// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RegionFile.js - Virtual File System for Chunk Storage
 * 
 * Implements Minecraft-style region files to avoid OS filesystem overhead.
 * Each region file contains a 32x32 grid of chunks (1024 chunks total).
 * 
 * Format:
 * [Header: 8KB]
 *   - Location Table: 4KB (1024 × 4 bytes) - offset/size for each chunk
 *   - Timestamp Table: 4KB (1024 × 4 bytes) - last modified time
 * [Sectors: variable]
 *   - 4KB sectors containing chunk data
 * 
 * Based on: Minecraft Anvil format with improvements from Linear format
 */

import { checksumHex32 } from '../../core/math/ChecksumMath.js';
import { crc32, verifyCRC32 } from './VoxelCompression.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const REGION_MAGIC = 0x4E474552;  // "REGN" in little-endian
const REGION_VERSION = 3;         // v3: Fixed header layout to prevent CRC collision

const REGION_SIZE = 32;           // 32x32 chunks per region (horizontal)
const CHUNKS_PER_REGION = REGION_SIZE * REGION_SIZE;  // 1024 per Y-layer

const SECTOR_SIZE = 4096;         // 4KB sectors
// v3 Header layout:
// - Sector 0 (0-4095): 16-byte metadata + padding
// - Sector 1 (4096-8191): Location table (4096 bytes)
// - Sector 2 (8192-12287): Timestamp table (4096 bytes)
const HEADER_SIZE = SECTOR_SIZE * 3;  // 12KB header for v3 (was 8KB in v1/v2)

const MAX_CHUNK_SECTORS = 255;    // Max sectors per chunk (1MB)
const EMPTY_LOCATION = 0;

// Robustness thresholds
const FRAGMENTATION_COMPACT_THRESHOLD = 0.3;  // Compact when 30%+ fragmented
const MAX_FREE_SECTORS_BEFORE_COMPACT = 256;  // Or when 256+ free sectors

// ============================================================================
// REGION FILE CLASS
// ============================================================================

/**
 * RegionFile - Manages a single region file containing 32x32 chunks
 */
export class RegionFile {
    /**
     * @param {number} regionX - Region X coordinate
     * @param {number} regionZ - Region Z coordinate  
     * @param {number} regionY - Region Y coordinate (for 3D worlds)
     */
    constructor(regionX, regionZ, regionY = 0) {
        this.regionX = regionX;
        this.regionZ = regionZ;
        this.regionY = regionY;
        
        // In-memory representation
        this.locations = new Uint32Array(CHUNKS_PER_REGION);   // offset:24 | size:8
        this.timestamps = new Uint32Array(CHUNKS_PER_REGION);  // Unix epoch seconds
        
        // Sector allocation
        this.sectors = [];           // Array of Uint8Array (each 4KB)
        this.freeSectors = [];       // Indices of free sectors
        this.sectorCount = 0;
        
        // File handle (for OPFS)
        this.fileHandle = null;
        this.dirty = false;
        this.loaded = false;
        
        // Stats
        this.stats = {
            chunksStored: 0,
            totalBytes: HEADER_SIZE,
            fragmentedSectors: 0,
            writeCount: 0,
            readCount: 0,
            crcErrors: 0,
            repairCount: 0,
        };
        
        // Health tracking
        this.lastCompactTime = 0;
        this.corruptChunks = new Set();  // Track chunks that failed CRC
    }
    
    /**
     * Get filename for this region
     * @returns {string}
     */
    getFilename() {
        if (this.regionY !== 0) {
            return `r.${this.regionX}.${this.regionY}.${this.regionZ}.vreg`;
        }
        return `r.${this.regionX}.${this.regionZ}.vreg`;
    }
    
    /**
     * Convert local chunk coordinates to index (2D per Y-layer)
     * @param {number} localX - 0-31
     * @param {number} localZ - 0-31
     * @returns {number} - 0-1023
     */
    chunkIndex(localX, localZ) {
        return (localX & 31) + (localZ & 31) * REGION_SIZE;
    }
    
    /**
     * Get location entry for a chunk
     * @param {number} index 
     * @returns {{offset: number, sectorCount: number}}
     */
    getLocation(index) {
        const loc = this.locations[index];
        return {
            offset: loc >>> 8,           // Top 24 bits
            sectorCount: loc & 0xFF,     // Bottom 8 bits
        };
    }
    
    /**
     * Set location entry for a chunk
     * @param {number} index 
     * @param {number} offset - Sector offset
     * @param {number} sectorCount - Number of sectors
     */
    setLocation(index, offset, sectorCount) {
        this.locations[index] = (offset << 8) | (sectorCount & 0xFF);
        this.dirty = true;
    }
    
    /**
     * Check if chunk exists in region
     * @param {number} localX 
     * @param {number} localZ 
     * @returns {boolean}
     */
    hasChunk(localX, localZ) {
        const idx = this.chunkIndex(localX, localZ);
        return this.locations[idx] !== EMPTY_LOCATION;
    }
    
    /**
     * Get chunk timestamp
     * @param {number} localX 
     * @param {number} localZ 
     * @returns {number} - Unix timestamp or 0
     */
    getTimestamp(localX, localZ) {
        return this.timestamps[this.chunkIndex(localX, localZ)];
    }
    
    /**
     * Allocate sectors for chunk data
     * @param {number} sectorsNeeded 
     * @returns {number} - Starting sector offset
     */
    allocateSectors(sectorsNeeded) {
        // Try to find contiguous free sectors
        if (this.freeSectors.length >= sectorsNeeded) {
            // Sort free sectors to find contiguous blocks
            this.freeSectors.sort((a, b) => a - b);
            
            for (let i = 0; i <= this.freeSectors.length - sectorsNeeded; i++) {
                let contiguous = true;
                for (let j = 1; j < sectorsNeeded; j++) {
                    if (this.freeSectors[i + j] !== this.freeSectors[i] + j) {
                        contiguous = false;
                        break;
                    }
                }
                
                if (contiguous) {
                    const startSector = this.freeSectors[i];
                    // Remove allocated sectors from free list
                    this.freeSectors.splice(i, sectorsNeeded);
                    return startSector;
                }
            }
        }
        
        // No contiguous free space, append at end
        const startSector = this.sectorCount;
        this.sectorCount += sectorsNeeded;
        
        // Ensure sectors array has space
        while (this.sectors.length < this.sectorCount) {
            this.sectors.push(new Uint8Array(SECTOR_SIZE));
        }
        
        return startSector;
    }
    
    /**
     * Free sectors used by a chunk
     * @param {number} index - Chunk index
     */
    freeSectorsForChunk(index) {
        const { offset, sectorCount } = this.getLocation(index);
        
        if (sectorCount > 0) {
            for (let i = 0; i < sectorCount; i++) {
                this.freeSectors.push(offset + i);
            }
            this.stats.fragmentedSectors += sectorCount;
        }
    }
    
    /**
     * Write chunk to region
     * @param {number} localX - Local chunk X (0-31)
     * @param {number} localZ - Local chunk Z (0-31)
     * @param {Uint8Array} data - Serialized chunk data
     * @returns {boolean} - Success
     */
    writeChunk(localX, localZ, data) {
        const index = this.chunkIndex(localX, localZ);
        
        // Calculate sectors needed (data + 4 byte length + 4 byte CRC)
        const totalSize = data.length + 8;
        const sectorsNeeded = Math.ceil(totalSize / SECTOR_SIZE);
        
        if (sectorsNeeded > MAX_CHUNK_SECTORS) {
            console.error(`[RegionFile] Chunk too large: ${data.length} bytes`);
            return false;
        }
        
        // Free old sectors if chunk existed
        if (this.locations[index] !== EMPTY_LOCATION) {
            this.freeSectorsForChunk(index);
            this.stats.chunksStored--;
        }
        
        // Allocate new sectors
        const startSector = this.allocateSectors(sectorsNeeded);
        
        // Write data with header
        const chunkCRC = crc32(data);
        const header = new Uint8Array(8);
        const headerView = new DataView(header.buffer);
        headerView.setUint32(0, data.length, true);
        headerView.setUint32(4, chunkCRC, true);
        
        // Copy to sectors
        let offset = 0;
        for (let i = 0; i < sectorsNeeded; i++) {
            const sectorIdx = startSector + i;
            const sector = this.sectors[sectorIdx] || new Uint8Array(SECTOR_SIZE);
            this.sectors[sectorIdx] = sector;
            
            if (i === 0) {
                // First sector includes header
                sector.set(header, 0);
                const dataStart = 8;
                const dataLen = Math.min(data.length, SECTOR_SIZE - dataStart);
                sector.set(data.subarray(0, dataLen), dataStart);
                offset = dataLen;
            } else {
                const remaining = data.length - offset;
                const copyLen = Math.min(remaining, SECTOR_SIZE);
                sector.set(data.subarray(offset, offset + copyLen), 0);
                offset += copyLen;
            }
        }
        
        // Update location and timestamp
        this.setLocation(index, startSector, sectorsNeeded);
        this.timestamps[index] = Math.floor(Date.now() / 1000);
        
        this.stats.chunksStored++;
        this.stats.totalBytes = HEADER_SIZE + this.sectorCount * SECTOR_SIZE;
        this.dirty = true;
        
        return true;
    }
    
    /**
     * Read chunk data from region
     * @param {number} localX 
     * @param {number} localZ 
     * @returns {Uint8Array|null} - Chunk data or null if not found
     */
    readChunk(localX, localZ) {
        const index = this.chunkIndex(localX, localZ);
        const { offset, sectorCount } = this.getLocation(index);
        
        if (sectorCount === 0) {
            return null;  // Chunk doesn't exist
        }
        
        // Read header from first sector
        const firstSector = this.sectors[offset];
        if (!firstSector) {
            console.error(`[RegionFile] Missing sector at offset ${offset}`);
            return null;
        }
        
        const headerView = new DataView(firstSector.buffer, firstSector.byteOffset);
        const dataLength = headerView.getUint32(0, true);
        const storedCRC = headerView.getUint32(4, true);
        
        // Allocate and copy data
        const data = new Uint8Array(dataLength);
        let dataOffset = 0;
        
        for (let i = 0; i < sectorCount && dataOffset < dataLength; i++) {
            const sector = this.sectors[offset + i];
            if (!sector) break;
            
            if (i === 0) {
                // First sector has header, skip it
                const copyLen = Math.min(dataLength, SECTOR_SIZE - 8);
                data.set(sector.subarray(8, 8 + copyLen), 0);
                dataOffset = copyLen;
            } else {
                const remaining = dataLength - dataOffset;
                const copyLen = Math.min(remaining, SECTOR_SIZE);
                data.set(sector.subarray(0, copyLen), dataOffset);
                dataOffset += copyLen;
            }
        }
        
        // Verify CRC
        if (!verifyCRC32(data, storedCRC)) {
            console.error(`[RegionFile] CRC mismatch for chunk (${localX}, ${localZ})`);
            return null;
        }
        
        return data;
    }
    
    /**
     * Delete chunk from region
     * @param {number} localX 
     * @param {number} localZ 
     * @returns {boolean}
     */
    deleteChunk(localX, localZ) {
        const index = this.chunkIndex(localX, localZ);
        
        if (this.locations[index] === EMPTY_LOCATION) {
            return false;
        }
        
        this.freeSectorsForChunk(index);
        this.locations[index] = EMPTY_LOCATION;
        this.timestamps[index] = 0;
        this.stats.chunksStored--;
        this.dirty = true;
        
        return true;
    }
    
    /**
     * Serialize region to binary for storage
     * @returns {Uint8Array}
     */
    serialize() {
        const totalSize = HEADER_SIZE + this.sectorCount * SECTOR_SIZE;
        const output = new Uint8Array(totalSize);
        const view = new DataView(output.buffer);
        
        // v3 Header layout (3 sectors = 12KB):
        // Sector 0 (0-4095): Metadata
        //   [0-3]   Magic (4 bytes)
        //   [4-5]   Version (2 bytes)
        //   [6-7]   Sector count (2 bytes)
        //   [8-9]   Chunks stored count (2 bytes)
        //   [10-11] Free sectors count (2 bytes)
        //   [12-15] Header checksum (4 bytes) - CRC32 of location table
        //   [16-4095] Reserved/padding
        // Sector 1 (4096-8191): Location table (1024 × 4 bytes)
        // Sector 2 (8192-12287): Timestamp table (1024 × 4 bytes)
        
        view.setUint32(0, REGION_MAGIC, true);
        view.setUint16(4, REGION_VERSION, true);
        view.setUint16(6, this.sectorCount, true);
        view.setUint16(8, this.stats.chunksStored, true);
        view.setUint16(10, this.freeSectors.length, true);
        // Checksum will be written after location table
        
        // Write location table (Sector 1, starting at byte 4096)
        const locationTableStart = SECTOR_SIZE;  // 4096
        for (let i = 0; i < CHUNKS_PER_REGION; i++) {
            view.setUint32(locationTableStart + i * 4, this.locations[i], true);
        }
        
        // Calculate and write header checksum (CRC32 of location table)
        const locationTable = output.subarray(locationTableStart, locationTableStart + CHUNKS_PER_REGION * 4);
        const headerCRC = crc32(locationTable);
        view.setUint32(12, headerCRC, true);
        
        // Write timestamp table (Sector 2, starting at byte 8192)
        const timestampOffset = SECTOR_SIZE * 2;  // 8192
        for (let i = 0; i < CHUNKS_PER_REGION; i++) {
            view.setUint32(timestampOffset + i * 4, this.timestamps[i], true);
        }
        
        // Write sectors
        for (let i = 0; i < this.sectorCount; i++) {
            const sector = this.sectors[i];
            if (sector) {
                output.set(sector, HEADER_SIZE + i * SECTOR_SIZE);
            }
        }
        
        return output;
    }
    
    /**
     * Deserialize region from binary data
     * @param {Uint8Array} data 
     * @returns {boolean} - Success
     */
    deserialize(data) {
        if (data.length < HEADER_SIZE) {
            console.error('[RegionFile] Data too small for header');
            return false;
        }
        
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        
        // Verify magic
        const magic = view.getUint32(0, true);
        if (magic !== REGION_MAGIC) {
            console.error(`[RegionFile] Invalid magic: ${magic.toString(16)}`);
            return false;
        }
        
        const version = view.getUint16(4, true);
        if (version > REGION_VERSION) {
            console.error(`[RegionFile] Unsupported version: ${version}`);
            return false;
        }
        
        this.sectorCount = view.getUint16(6, true);
        
        // Version-specific parsing
        // v1: location at byte 8, timestamps at 4096, header 8KB
        // v2: location at byte 16, timestamps at 4112 (BUGGY - had overlap), header 8KB  
        // v3: location at 4096, timestamps at 8192, header 12KB
        let locationTableStart = 8;
        let timestampTableStart = SECTOR_SIZE;
        let oldHeaderSize = SECTOR_SIZE * 2;  // 8KB for v1/v2
        let storedChunkCount = 0;
        let storedFreeSectors = 0;
        let storedHeaderCRC = 0;
        let isLegacyFormat = false;
        
        if (version === 1) {
            // v1 format - location table starts at byte 8, no CRC
            locationTableStart = 8;
            timestampTableStart = SECTOR_SIZE;  // 4096
            oldHeaderSize = SECTOR_SIZE * 2;
            isLegacyFormat = true;
            console.log(`[RegionFile] Loading v1 format region - will upgrade to v3 on save`);
        } else if (version === 2) {
            // v2 format - had a bug with overlapping location/timestamp tables
            // Location started at 16, timestamps at 4112, causing CRC issues
            storedChunkCount = view.getUint16(8, true);
            storedFreeSectors = view.getUint16(10, true);
            storedHeaderCRC = view.getUint32(12, true);
            locationTableStart = 16;
            timestampTableStart = 16 + CHUNKS_PER_REGION * 4;  // 4112
            oldHeaderSize = SECTOR_SIZE * 2;
            isLegacyFormat = true;
            console.log(`[RegionFile] Loading v2 format region (had CRC bug) - will upgrade to v3 on save`);
        } else if (version >= 3) {
            // v3 format - fixed layout with proper sector alignment
            storedChunkCount = view.getUint16(8, true);
            storedFreeSectors = view.getUint16(10, true);
            storedHeaderCRC = view.getUint32(12, true);
            locationTableStart = SECTOR_SIZE;  // 4096
            timestampTableStart = SECTOR_SIZE * 2;  // 8192
            oldHeaderSize = SECTOR_SIZE * 3;  // 12KB
        }
        
        // Read location table
        this.stats.chunksStored = 0;
        for (let i = 0; i < CHUNKS_PER_REGION; i++) {
            this.locations[i] = view.getUint32(locationTableStart + i * 4, true);
            if (this.locations[i] !== EMPTY_LOCATION) {
                this.stats.chunksStored++;
            }
        }
        
        // Verify header checksum (v3+ only - v2 had a bug so skip CRC check for it)
        if (version >= 3 && storedHeaderCRC !== 0) {
            const locationTable = data.subarray(locationTableStart, locationTableStart + CHUNKS_PER_REGION * 4);
            const computedCRC = crc32(locationTable);
            if (computedCRC !== storedHeaderCRC) {
                console.error(`[RegionFile] Header CRC mismatch! stored=${checksumHex32(storedHeaderCRC)}, computed=${checksumHex32(computedCRC)}`);
                console.warn('[RegionFile] Region may be corrupted');
                this.stats.crcErrors++;
            }
            
            // Validate chunk count
            if (storedChunkCount !== this.stats.chunksStored) {
                console.warn(`[RegionFile] Chunk count mismatch: header=${storedChunkCount}, actual=${this.stats.chunksStored}`);
            }
        }
        
        // Mark legacy regions for upgrade to v3
        if (isLegacyFormat) {
            this.dirty = true;
        }
        
        // Read timestamp table
        for (let i = 0; i < CHUNKS_PER_REGION; i++) {
            this.timestamps[i] = view.getUint32(timestampTableStart + i * 4, true);
        }
        
        // Read sectors - account for different header sizes in legacy formats
        const sectorDataStart = (version >= 3) ? HEADER_SIZE : oldHeaderSize;
        
        // Read sectors using correct header size for this version
        this.sectors = [];
        for (let i = 0; i < this.sectorCount; i++) {
            const sectorStart = sectorDataStart + i * SECTOR_SIZE;
            if (sectorStart + SECTOR_SIZE <= data.length) {
                this.sectors.push(data.slice(sectorStart, sectorStart + SECTOR_SIZE));
            } else {
                console.warn(`[RegionFile] Truncated sector ${i}, creating empty`);
                this.sectors.push(new Uint8Array(SECTOR_SIZE));
                this.stats.repairCount++;
            }
        }
        
        // Build free sector list
        this.freeSectors = [];
        const usedSectors = new Set();
        for (let i = 0; i < CHUNKS_PER_REGION; i++) {
            const { offset, sectorCount } = this.getLocation(i);
            for (let j = 0; j < sectorCount; j++) {
                usedSectors.add(offset + j);
            }
        }
        for (let i = 0; i < this.sectorCount; i++) {
            if (!usedSectors.has(i)) {
                this.freeSectors.push(i);
            }
        }
        
        this.stats.fragmentedSectors = this.freeSectors.length;
        this.stats.totalBytes = data.length;
        this.loaded = true;
        // Keep dirty=true if it was set for legacy format upgrade, otherwise false
        if (!isLegacyFormat) {
            this.dirty = false;
        }
        
        // Check if compaction is needed
        if (this.needsCompaction()) {
            console.log(`[RegionFile] Region (${this.regionX},${this.regionY},${this.regionZ}) needs compaction: ${this.freeSectors.length} free sectors`);
        }
        
        return true;
    }
    
    /**
     * Check if region needs compaction based on fragmentation
     * @returns {boolean}
     */
    needsCompaction() {
        if (this.sectorCount === 0) return false;
        const fragmentationRatio = this.freeSectors.length / this.sectorCount;
        return fragmentationRatio >= FRAGMENTATION_COMPACT_THRESHOLD || 
               this.freeSectors.length >= MAX_FREE_SECTORS_BEFORE_COMPACT;
    }
    
    /**
     * Get region health status
     * @returns {Object}
     */
    getHealth() {
        const fragmentationRatio = this.sectorCount > 0 ? this.freeSectors.length / this.sectorCount : 0;
        return {
            chunksStored: this.stats.chunksStored,
            sectorCount: this.sectorCount,
            freeSectors: this.freeSectors.length,
            fragmentationPercent: (fragmentationRatio * 100).toFixed(1),
            needsCompaction: this.needsCompaction(),
            crcErrors: this.stats.crcErrors,
            repairCount: this.stats.repairCount,
            corruptChunks: this.corruptChunks.size,
            totalBytes: this.stats.totalBytes,
        };
    }
    
    /**
     * Defragment region file (compact sectors)
     * @returns {number} - Bytes saved
     */
    defragment() {
        if (this.freeSectors.length === 0) {
            return 0;
        }
        
        const oldSize = this.sectorCount * SECTOR_SIZE;
        
        // Build new sector array with only used sectors
        const newSectors = [];
        const sectorMapping = new Map();  // old index → new index
        
        for (let i = 0; i < CHUNKS_PER_REGION; i++) {
            const { offset, sectorCount } = this.getLocation(i);
            if (sectorCount === 0) continue;
            
            const newOffset = newSectors.length;
            
            for (let j = 0; j < sectorCount; j++) {
                const oldIdx = offset + j;
                sectorMapping.set(oldIdx, newSectors.length);
                newSectors.push(this.sectors[oldIdx] || new Uint8Array(SECTOR_SIZE));
            }
            
            // Update location with new offset
            this.setLocation(i, newOffset, sectorCount);
        }
        
        // Replace sectors
        this.sectors = newSectors;
        this.sectorCount = newSectors.length;
        this.freeSectors = [];
        this.stats.fragmentedSectors = 0;
        this.dirty = true;
        
        const newSize = this.sectorCount * SECTOR_SIZE;
        return oldSize - newSize;
    }
    
    /**
     * Get list of all chunk coordinates in this region
     * @returns {Array<{localX: number, localZ: number, timestamp: number}>}
     */
    listChunks() {
        const chunks = [];
        
        for (let z = 0; z < REGION_SIZE; z++) {
            for (let x = 0; x < REGION_SIZE; x++) {
                const idx = this.chunkIndex(x, z);
                if (this.locations[idx] !== EMPTY_LOCATION) {
                    chunks.push({
                        localX: x,
                        localZ: z,
                        timestamp: this.timestamps[idx],
                    });
                }
            }
        }
        
        return chunks;
    }
    
    /**
     * Get region statistics
     * @returns {Object}
     */
    getStats() {
        return {
            ...this.stats,
            sectorCount: this.sectorCount,
            freeSectorCount: this.freeSectors.length,
            fragmentation: this.sectorCount > 0 
                ? (this.freeSectors.length / this.sectorCount * 100).toFixed(1) + '%'
                : '0%',
        };
    }
}

// ============================================================================
// REGION MANAGER - Manages multiple region files
// ============================================================================

/**
 * RegionManager - High-level interface for region-based chunk storage
 */
export class RegionManager {
    constructor() {
        this.regions = new Map();  // key → RegionFile
        this.worldName = 'world';
        this.storageBackend = null;  // OPFS or IndexedDB adapter
        
        this.stats = {
            regionsLoaded: 0,
            totalChunks: 0,
            cacheHits: 0,
            cacheMisses: 0,
        };
    }
    
    /**
     * Get region key from region coordinates
     * @param {number} regionX 
     * @param {number} regionZ 
     * @param {number} regionY 
     * @returns {string}
     */
    regionKey(regionX, regionZ, regionY = 0) {
        return `${regionX},${regionZ},${regionY}`;
    }
    
    /**
     * Convert world chunk coordinates to region coordinates
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @returns {{regionX: number, regionZ: number, localX: number, localZ: number}}
     */
    chunkToRegion(chunkX, chunkZ) {
        return {
            regionX: Math.floor(chunkX / REGION_SIZE),
            regionZ: Math.floor(chunkZ / REGION_SIZE),
            localX: ((chunkX % REGION_SIZE) + REGION_SIZE) % REGION_SIZE,
            localZ: ((chunkZ % REGION_SIZE) + REGION_SIZE) % REGION_SIZE,
        };
    }
    
    /**
     * Get or create region file
     * @param {number} regionX 
     * @param {number} regionZ 
     * @param {number} regionY 
     * @returns {RegionFile}
     */
    getRegion(regionX, regionZ, regionY = 0) {
        const key = this.regionKey(regionX, regionZ, regionY);
        
        if (!this.regions.has(key)) {
            const region = new RegionFile(regionX, regionZ, regionY);
            this.regions.set(key, region);
            this.stats.regionsLoaded++;
        }
        
        return this.regions.get(key);
    }
    
    /**
     * Save chunk to appropriate region
     * @param {number} chunkX - World chunk X
     * @param {number} chunkZ - World chunk Z
     * @param {Uint8Array} data - Serialized chunk data
     * @param {number} chunkY - World chunk Y (optional, for 3D regions)
     * @returns {boolean}
     */
    saveChunk(chunkX, chunkZ, data, chunkY = 0) {
        const { regionX, regionZ, localX, localZ } = this.chunkToRegion(chunkX, chunkZ);
        // Each Y level gets its own region file to prevent collisions
        const regionY = chunkY;
        
        // Debug logging disabled - was major performance bottleneck
        
        const region = this.getRegion(regionX, regionZ, regionY);
        const success = region.writeChunk(localX, localZ, data);
        
        if (success) {
            this.stats.totalChunks++;
        }
        
        return success;
    }
    
    /**
     * Load chunk from appropriate region
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @param {number} chunkY 
     * @returns {Uint8Array|null}
     */
    loadChunk(chunkX, chunkZ, chunkY = 0) {
        const { regionX, regionZ, localX, localZ } = this.chunkToRegion(chunkX, chunkZ);
        // Each Y level gets its own region file to prevent collisions
        const regionY = chunkY;
        
        const key = this.regionKey(regionX, regionZ, regionY);
        
        // Debug logging disabled - was major performance bottleneck
        
        if (!this.regions.has(key)) {
            this.stats.cacheMisses++;
            return null;  // Region not loaded
        }
        
        this.stats.cacheHits++;
        const region = this.regions.get(key);
        return region.readChunk(localX, localZ);
    }
    
    /**
     * Check if chunk exists
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @param {number} chunkY 
     * @returns {boolean}
     */
    hasChunk(chunkX, chunkZ, chunkY = 0) {
        const { regionX, regionZ, localX, localZ } = this.chunkToRegion(chunkX, chunkZ);
        // Each Y level gets its own region file to prevent collisions
        const regionY = chunkY;
        
        const key = this.regionKey(regionX, regionZ, regionY);
        if (!this.regions.has(key)) return false;
        
        return this.regions.get(key).hasChunk(localX, localZ);
    }
    
    /**
     * Delete chunk
     * @param {number} chunkX 
     * @param {number} chunkZ 
     * @param {number} chunkY 
     * @returns {boolean}
     */
    deleteChunk(chunkX, chunkZ, chunkY = 0) {
        const { regionX, regionZ, localX, localZ } = this.chunkToRegion(chunkX, chunkZ);
        // Each Y level gets its own region file to prevent collisions
        const regionY = chunkY;
        
        const key = this.regionKey(regionX, regionZ, regionY);
        if (!this.regions.has(key)) return false;
        
        const success = this.regions.get(key).deleteChunk(localX, localZ);
        if (success) this.stats.totalChunks--;
        
        return success;
    }
    
    /**
     * Get all dirty regions that need saving
     * @returns {RegionFile[]}
     */
    getDirtyRegions() {
        return Array.from(this.regions.values()).filter(r => r.dirty);
    }
    
    /**
     * Mark region as saved
     * @param {RegionFile} region 
     */
    markRegionClean(region) {
        region.dirty = false;
    }
    
    /**
     * Unload region from memory
     * @param {number} regionX 
     * @param {number} regionZ 
     * @param {number} regionY 
     * @returns {boolean}
     */
    unloadRegion(regionX, regionZ, regionY = 0) {
        const key = this.regionKey(regionX, regionZ, regionY);
        
        if (this.regions.has(key)) {
            const region = this.regions.get(key);
            if (region.dirty) {
                console.warn(`[RegionManager] Unloading dirty region ${key}`);
            }
            this.regions.delete(key);
            this.stats.regionsLoaded--;
            return true;
        }
        
        return false;
    }
    
    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        let totalBytes = 0;
        let totalChunks = 0;
        
        for (const region of this.regions.values()) {
            totalBytes += region.stats.totalBytes;
            totalChunks += region.stats.chunksStored;
        }
        
        return {
            ...this.stats,
            totalChunks,
            totalBytes,
            totalRegions: this.regions.size,
        };
    }
    
    /**
     * Get health status for all loaded regions
     * @returns {Object}
     */
    getHealthReport() {
        const report = {
            totalRegions: this.regions.size,
            healthyRegions: 0,
            needsCompaction: 0,
            totalCrcErrors: 0,
            totalCorruptChunks: 0,
            totalFragmentedSectors: 0,
            regionDetails: [],
        };
        
        for (const [key, region] of this.regions) {
            const health = region.getHealth();
            report.regionDetails.push({ key, ...health });
            
            if (health.needsCompaction) {
                report.needsCompaction++;
            } else {
                report.healthyRegions++;
            }
            
            report.totalCrcErrors += health.crcErrors;
            report.totalCorruptChunks += health.corruptChunks;
            report.totalFragmentedSectors += health.freeSectors;
        }
        
        return report;
    }
    
    /**
     * Compact all fragmented regions
     * @returns {Object} - { regionsCompacted, bytesSaved }
     */
    compactAll() {
        let regionsCompacted = 0;
        let bytesSaved = 0;
        
        for (const region of this.regions.values()) {
            if (region.needsCompaction()) {
                const saved = region.defragment();
                if (saved > 0) {
                    regionsCompacted++;
                    bytesSaved += saved;
                    console.log(`[RegionManager] Compacted region (${region.regionX},${region.regionY},${region.regionZ}): saved ${(saved/1024).toFixed(1)}KB`);
                }
            }
        }
        
        if (regionsCompacted > 0) {
            console.log(`[RegionManager] Compaction complete: ${regionsCompacted} regions, ${(bytesSaved/1024).toFixed(1)}KB saved`);
        }
        
        return { regionsCompacted, bytesSaved };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
    REGION_SIZE,
    CHUNKS_PER_REGION,
    SECTOR_SIZE,
    HEADER_SIZE,
};

export default {
    RegionFile,
    RegionManager,
    REGION_SIZE,
    CHUNKS_PER_REGION,
    SECTOR_SIZE,
};
