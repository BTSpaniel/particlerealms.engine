// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkSerializer.js - Full Chunk Serialization with Entities
 * 
 * Serializes complete chunk state:
 * - Voxel data (compressed via VoxelCompression)
 * - Entity list (positions, components, state)
 * - Metadata (timestamps, flags, version)
 * 
 * Binary Format:
 * [Header][Voxel Section][Entity Section][CRC32]
 *
 * V2 stores AI target references as low/high uint32 words. V1 remains readable
 * and can only be emitted by explicitly selecting formatVersion: 1.
 */

import {
    crc32,
    verifyCRC32,
    compressChunk,
    decompressChunk,
    encodeDelta,
    decodeDelta,
} from './VoxelCompression.js';
import {
    joinEntityHandle,
    positiveSafeEntityHandleReport,
    splitEntityHandle,
} from '../../ecs/world/World.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const CHUNK_MAGIC = 0x4B4E4843;  // "CHNK" in little-endian
const CHUNK_LEGACY_VERSION = 1;
const CHUNK_VERSION = 2;
const CHUNK_SIZE = 32;

// Section types
const SECTION_VOXELS = 0x01;
const SECTION_ENTITIES = 0x02;
const SECTION_METADATA = 0x03;
const SECTION_DELTA = 0x04;
const SECTION_LAYERS = 0x05;  // For LayerMap stratigraphy

// Entity component flags
const COMP_POSITION = 0x01;
const COMP_ROTATION = 0x02;
const COMP_VELOCITY = 0x04;
const COMP_HEALTH = 0x08;
const COMP_INVENTORY = 0x10;
const COMP_AI_STATE = 0x20;
const COMP_CUSTOM = 0x80;

// ============================================================================
// BINARY WRITER HELPER
// ============================================================================

class BinaryWriter {
    constructor(initialSize = 1024) {
        this.buffer = new ArrayBuffer(initialSize);
        this.view = new DataView(this.buffer);
        this.uint8 = new Uint8Array(this.buffer);
        this.offset = 0;
    }
    
    ensureCapacity(needed) {
        if (this.offset + needed > this.buffer.byteLength) {
            const newSize = Math.max(this.buffer.byteLength * 2, this.offset + needed);
            const newBuffer = new ArrayBuffer(newSize);
            new Uint8Array(newBuffer).set(this.uint8);
            this.buffer = newBuffer;
            this.view = new DataView(this.buffer);
            this.uint8 = new Uint8Array(this.buffer);
        }
    }
    
    writeUint8(val) {
        this.ensureCapacity(1);
        this.uint8[this.offset++] = val;
    }
    
    writeUint16(val) {
        this.ensureCapacity(2);
        this.view.setUint16(this.offset, val, true);
        this.offset += 2;
    }
    
    writeUint32(val) {
        this.ensureCapacity(4);
        this.view.setUint32(this.offset, val, true);
        this.offset += 4;
    }
    
    writeInt32(val) {
        this.ensureCapacity(4);
        this.view.setInt32(this.offset, val, true);
        this.offset += 4;
    }
    
    writeFloat32(val) {
        this.ensureCapacity(4);
        this.view.setFloat32(this.offset, val, true);
        this.offset += 4;
    }
    
    writeFloat64(val) {
        this.ensureCapacity(8);
        this.view.setFloat64(this.offset, val, true);
        this.offset += 8;
    }
    
    writeBytes(data) {
        this.ensureCapacity(data.length);
        this.uint8.set(data, this.offset);
        this.offset += data.length;
    }
    
    writeString(str) {
        const encoded = new TextEncoder().encode(str);
        this.writeUint16(encoded.length);
        this.writeBytes(encoded);
    }
    
    getResult() {
        return new Uint8Array(this.buffer, 0, this.offset);
    }
}

// ============================================================================
// BINARY READER HELPER
// ============================================================================

class BinaryReader {
    constructor(data) {
        this.data = data;
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        this.offset = 0;
    }
    
    readUint8() {
        return this.data[this.offset++];
    }
    
    readUint16() {
        const val = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return val;
    }
    
    readUint32() {
        const val = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return val;
    }
    
    readInt32() {
        const val = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return val;
    }
    
    readFloat32() {
        const val = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return val;
    }
    
    readFloat64() {
        const val = this.view.getFloat64(this.offset, true);
        this.offset += 8;
        return val;
    }
    
    readBytes(length) {
        const bytes = this.data.slice(this.offset, this.offset + length);
        this.offset += length;
        return bytes;
    }
    
    readString() {
        const length = this.readUint16();
        const bytes = this.readBytes(length);
        return new TextDecoder().decode(bytes);
    }
    
    hasMore() {
        return this.offset < this.data.length;
    }
}

// ============================================================================
// ENTITY SERIALIZATION
// ============================================================================

/**
 * Serialize a single entity
 * @param {Object} entity 
 * @param {BinaryWriter} writer 
 */
function serializeEntity(entity, writer, formatVersion) {
    // Entity ID (64-bit for large worlds)
    const entityWords = splitEntityHandle(entity.id);
    writer.writeUint32(entityWords.low);
    writer.writeUint32(entityWords.high);
    
    // Entity type
    writer.writeUint16(entity.type || 0);
    
    // Build component flags
    let flags = 0;
    if (entity.position) flags |= COMP_POSITION;
    if (entity.rotation) flags |= COMP_ROTATION;
    if (entity.velocity) flags |= COMP_VELOCITY;
    if (entity.health !== undefined) flags |= COMP_HEALTH;
    if (entity.inventory) flags |= COMP_INVENTORY;
    if (entity.aiState) flags |= COMP_AI_STATE;
    if (entity.custom) flags |= COMP_CUSTOM;
    
    writer.writeUint8(flags);
    
    // Position (3 x float64 for precision)
    if (flags & COMP_POSITION) {
        writer.writeFloat64(entity.position.x);
        writer.writeFloat64(entity.position.y);
        writer.writeFloat64(entity.position.z);
    }
    
    // Rotation (quaternion: 4 x float32)
    if (flags & COMP_ROTATION) {
        writer.writeFloat32(entity.rotation.x || 0);
        writer.writeFloat32(entity.rotation.y || 0);
        writer.writeFloat32(entity.rotation.z || 0);
        writer.writeFloat32(entity.rotation.w || 1);
    }
    
    // Velocity (3 x float32)
    if (flags & COMP_VELOCITY) {
        writer.writeFloat32(entity.velocity.x);
        writer.writeFloat32(entity.velocity.y);
        writer.writeFloat32(entity.velocity.z);
    }
    
    // Health
    if (flags & COMP_HEALTH) {
        writer.writeFloat32(entity.health);
        writer.writeFloat32(entity.maxHealth || entity.health);
    }
    
    // Inventory (simplified: array of item IDs and counts)
    if (flags & COMP_INVENTORY) {
        const inv = entity.inventory;
        writer.writeUint16(inv.length);
        for (const item of inv) {
            writer.writeUint16(item.id || 0);
            writer.writeUint16(item.count || 1);
            writer.writeUint8(item.slot || 0);
        }
    }
    
    // AI State (simplified: state ID + target)
    if (flags & COMP_AI_STATE) {
        writer.writeUint8(entity.aiState.state || 0);
        const target = entity.aiState.target ?? 0;
        if (target === 0) {
            writer.writeUint32(0);
            if (formatVersion >= CHUNK_VERSION) writer.writeUint32(0);
        } else {
            const targetReport = positiveSafeEntityHandleReport(target);
            if (!targetReport.valid) {
                throw new RangeError('Chunk AI target must be zero or a positive safe entity handle');
            }
            const targetWords = splitEntityHandle(targetReport.value);
            if (formatVersion === CHUNK_LEGACY_VERSION && targetWords.high !== 0) {
                throw new RangeError('Chunk v1 AI target exceeds the legacy unsigned 32-bit field');
            }
            writer.writeUint32(targetWords.low);
            if (formatVersion >= CHUNK_VERSION) writer.writeUint32(targetWords.high);
        }
        writer.writeFloat32(entity.aiState.timer || 0);
    }
    
    // Custom data (JSON stringified)
    if (flags & COMP_CUSTOM) {
        const json = JSON.stringify(entity.custom);
        writer.writeString(json);
    }
}

/**
 * Deserialize a single entity
 * @param {BinaryReader} reader 
 * @returns {Object}
 */
function deserializeEntity(reader, formatVersion) {
    const entity = {};
    
    // Entity ID
    const idLow = reader.readUint32();
    const idHigh = reader.readUint32();
    entity.id = idLow === 0 && idHigh === 0 ? 0 : joinEntityHandle(idLow, idHigh);
    
    // Entity type
    entity.type = reader.readUint16();
    
    // Component flags
    const flags = reader.readUint8();
    
    // Position
    if (flags & COMP_POSITION) {
        entity.position = {
            x: reader.readFloat64(),
            y: reader.readFloat64(),
            z: reader.readFloat64(),
        };
    }
    
    // Rotation
    if (flags & COMP_ROTATION) {
        entity.rotation = {
            x: reader.readFloat32(),
            y: reader.readFloat32(),
            z: reader.readFloat32(),
            w: reader.readFloat32(),
        };
    }
    
    // Velocity
    if (flags & COMP_VELOCITY) {
        entity.velocity = {
            x: reader.readFloat32(),
            y: reader.readFloat32(),
            z: reader.readFloat32(),
        };
    }
    
    // Health
    if (flags & COMP_HEALTH) {
        entity.health = reader.readFloat32();
        entity.maxHealth = reader.readFloat32();
    }
    
    // Inventory
    if (flags & COMP_INVENTORY) {
        const count = reader.readUint16();
        entity.inventory = [];
        for (let i = 0; i < count; i++) {
            entity.inventory.push({
                id: reader.readUint16(),
                count: reader.readUint16(),
                slot: reader.readUint8(),
            });
        }
    }
    
    // AI State
    if (flags & COMP_AI_STATE) {
        const state = reader.readUint8();
        const targetLow = reader.readUint32();
        const targetHigh = formatVersion >= CHUNK_VERSION ? reader.readUint32() : 0;
        entity.aiState = {
            state,
            target: targetLow === 0 && targetHigh === 0
                ? 0
                : joinEntityHandle(targetLow, targetHigh),
            timer: reader.readFloat32(),
        };
    }
    
    // Custom data
    if (flags & COMP_CUSTOM) {
        const json = reader.readString();
        try {
            entity.custom = JSON.parse(json);
        } catch (e) {
            entity.custom = {};
        }
    }
    
    return entity;
}

// ============================================================================
// FULL CHUNK SERIALIZATION
// ============================================================================

/**
 * Serialize complete chunk state
 * @param {Object} chunk - Chunk object with voxels, entities, metadata
 * @param {Object} options - Serialization options
 * @returns {Uint8Array} - Serialized binary data
 */
export function serializeChunk(chunk, options = {}) {
    const formatVersion = options.formatVersion ?? CHUNK_VERSION;
    if (formatVersion !== CHUNK_LEGACY_VERSION && formatVersion !== CHUNK_VERSION) {
        throw new RangeError(`Unsupported chunk write version: ${formatVersion}`);
    }
    const writer = new BinaryWriter(chunk.voxels ? chunk.voxels.length * 2 : 4096);
    
    // Header
    writer.writeUint32(CHUNK_MAGIC);
    writer.writeUint8(formatVersion);
    writer.writeUint8(options.deltaOnly ? 1 : 0);  // Flags
    
    // Chunk coordinates
    writer.writeInt32(chunk.x || 0);
    writer.writeInt32(chunk.y || 0);
    writer.writeInt32(chunk.z || 0);
    
    // Timestamps
    writer.writeFloat64(chunk.createdAt || Date.now());
    writer.writeFloat64(chunk.modifiedAt || Date.now());
    
    // Placeholder for section count (will write at end)
    const sectionCountOffset = writer.offset;
    writer.writeUint8(0);
    
    let sectionCount = 0;
    
    // === VOXEL SECTION ===
    if (chunk.voxels && !options.deltaOnly) {
        // Log pre-compression voxel details
        let nonAir = 0;
        const samples = [];
        for (let i = 0; i < chunk.voxels.length; i++) {
            if (chunk.voxels[i] !== 0) {
                nonAir++;
                if (samples.length < 5) {
                    const lx = i % 32;
                    const ly = Math.floor(i / 32) % 32;
                    const lz = Math.floor(i / 1024);
                    samples.push(`[${lx},${ly},${lz}]=${chunk.voxels[i]}`);
                }
            }
        }
        // Removed verbose logging - was major performance bottleneck
        
        const { compressed, ratio } = compressChunk(chunk.voxels, options.chunkSize || CHUNK_SIZE);
        
        writer.writeUint8(SECTION_VOXELS);
        writer.writeUint32(compressed.length);
        writer.writeBytes(compressed);
        sectionCount++;
    }
    
    // === DELTA SECTION (modifications only) ===
    if (chunk.modifications && chunk.modifications.size > 0) {
        const deltaData = encodeDelta(chunk.modifications);
        
        writer.writeUint8(SECTION_DELTA);
        writer.writeUint32(deltaData.length);
        writer.writeBytes(deltaData);
        sectionCount++;
    }
    
    // === ENTITY SECTION ===
    if (chunk.entities && chunk.entities.length > 0) {
        writer.writeUint8(SECTION_ENTITIES);
        
        // Placeholder for section size
        const sizeOffset = writer.offset;
        writer.writeUint32(0);
        
        const startOffset = writer.offset;
        
        // Entity count
        writer.writeUint16(chunk.entities.length);
        
        // Serialize each entity
        for (const entity of chunk.entities) {
            serializeEntity(entity, writer, formatVersion);
        }
        
        // Write actual section size
        const sectionSize = writer.offset - startOffset;
        writer.view.setUint32(sizeOffset, sectionSize, true);
        
        sectionCount++;
    }
    
    // === METADATA SECTION ===
    if (chunk.metadata) {
        const metaJson = JSON.stringify(chunk.metadata);
        const metaBytes = new TextEncoder().encode(metaJson);
        
        writer.writeUint8(SECTION_METADATA);
        writer.writeUint32(metaBytes.length);
        writer.writeBytes(metaBytes);
        sectionCount++;
    }
    
    // Write section count
    writer.uint8[sectionCountOffset] = sectionCount;
    
    // Calculate and append CRC32
    const dataWithoutCRC = writer.getResult();
    const checksum = crc32(dataWithoutCRC);
    writer.writeUint32(checksum);
    
    return writer.getResult();
}

/**
 * Deserialize chunk from binary data
 * @param {Uint8Array} data 
 * @param {Object} options 
 * @returns {Object} - Chunk object
 */
export function deserializeChunk(data, options = {}) {
    // Verify CRC32
    const dataWithoutCRC = data.slice(0, data.length - 4);
    const storedCRC = new DataView(data.buffer, data.byteOffset + data.length - 4, 4).getUint32(0, true);
    
    if (!verifyCRC32(dataWithoutCRC, storedCRC)) {
        throw new Error('Chunk data corrupted: CRC32 mismatch');
    }
    
    const reader = new BinaryReader(dataWithoutCRC);
    
    // Header
    const magic = reader.readUint32();
    if (magic !== CHUNK_MAGIC) {
        throw new Error(`Invalid chunk magic: expected ${CHUNK_MAGIC}, got ${magic}`);
    }
    
    const version = reader.readUint8();
    if (version !== CHUNK_LEGACY_VERSION && version !== CHUNK_VERSION) {
        throw new Error(`Unsupported chunk version: ${version}`);
    }
    
    const flags = reader.readUint8();
    
    // Coordinates
    const chunk = {
        x: reader.readInt32(),
        y: reader.readInt32(),
        z: reader.readInt32(),
        createdAt: reader.readFloat64(),
        modifiedAt: reader.readFloat64(),
        voxels: null,
        entities: [],
        modifications: new Map(),
        metadata: {},
    };
    
    const sectionCount = reader.readUint8();
    
    // Read sections
    for (let i = 0; i < sectionCount; i++) {
        const sectionType = reader.readUint8();
        const sectionSize = reader.readUint32();
        const sectionData = reader.readBytes(sectionSize);
        
        switch (sectionType) {
            case SECTION_VOXELS:
                chunk.voxels = decompressChunk(sectionData, options.chunkSize || CHUNK_SIZE);
                // Log decompressed voxel details
                let nonAir = 0;
                const samples = [];
                for (let i = 0; i < chunk.voxels.length; i++) {
                    if (chunk.voxels[i] !== 0) {
                        nonAir++;
                        if (samples.length < 5) {
                            const lx = i % 32;
                            const ly = Math.floor(i / 32) % 32;
                            const lz = Math.floor(i / 1024);
                            samples.push(`[${lx},${ly},${lz}]=${chunk.voxels[i]}`);
                        }
                    }
                }
                // Removed verbose logging - was major performance bottleneck
                break;
                
            case SECTION_DELTA:
                chunk.modifications = decodeDelta(sectionData);
                break;
                
            case SECTION_ENTITIES: {
                const entityReader = new BinaryReader(sectionData);
                const entityCount = entityReader.readUint16();
                for (let j = 0; j < entityCount; j++) {
                    chunk.entities.push(deserializeEntity(entityReader, version));
                }
                break;
            }
            
            case SECTION_METADATA:
                try {
                    chunk.metadata = JSON.parse(new TextDecoder().decode(sectionData));
                } catch (e) {
                    chunk.metadata = {};
                }
                break;
                
            default:
                // Unknown section, skip
                console.warn(`Unknown chunk section type: ${sectionType}`);
        }
    }
    
    return chunk;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Apply delta modifications to voxel array
 * @param {Uint8Array} voxels 
 * @param {Map<number, {old: number, new: number}>} modifications 
 * @param {boolean} forward - true = apply new values, false = apply old values (undo)
 * @returns {Uint8Array}
 */
export function applyDelta(voxels, modifications, forward = true) {
    const result = new Uint8Array(voxels);
    
    for (const [index, { old: oldVal, new: newVal }] of modifications) {
        result[index] = forward ? newVal : oldVal;
    }
    
    return result;
}

/**
 * Create chunk key from coordinates
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @returns {string}
 */
export function chunkKey(x, y, z) {
    return `${x},${y},${z}`;
}

/**
 * Parse chunk key to coordinates
 * @param {string} key 
 * @returns {{x: number, y: number, z: number}}
 */
export function parseChunkKey(key) {
    const [x, y, z] = key.split(',').map(Number);
    return { x, y, z };
}

/**
 * Get serialized chunk size estimate
 * @param {Object} chunk 
 * @returns {number}
 */
export function estimateChunkSize(chunk) {
    let size = 64;  // Header overhead
    
    if (chunk.voxels) {
        // Estimate compression ratio of ~10x
        size += Math.ceil(chunk.voxels.length / 10);
    }
    
    if (chunk.modifications) {
        size += chunk.modifications.size * 6;
    }
    
    if (chunk.entities) {
        size += chunk.entities.length * 100;  // ~100 bytes per entity average
    }
    
    return size;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
    BinaryWriter,
    BinaryReader,
    CHUNK_SIZE,
    CHUNK_MAGIC,
    CHUNK_LEGACY_VERSION,
    CHUNK_VERSION,
    SECTION_VOXELS,
    SECTION_ENTITIES,
    SECTION_METADATA,
    SECTION_DELTA,
};

export default {
    serializeChunk,
    deserializeChunk,
    applyDelta,
    chunkKey,
    parseChunkKey,
    estimateChunkSize,
    BinaryWriter,
    BinaryReader,
};
