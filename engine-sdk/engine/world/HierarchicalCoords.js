// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HierarchicalCoords.js - Planet-Scale Coordinate System
 * 
 * Problem: Standard floats lose precision beyond ~100k units.
 * Even with FloatingOrigin, we need a system that can address
 * positions across an entire planet (millions of units).
 * 
 * Solution: Hierarchical coordinates split position into:
 * - Sector: Large-scale grid cell (10km = 10,000 units per sector)
 * - Local: Position within sector (0 to SECTOR_SIZE, f32 safe)
 * 
 * This gives us:
 * - Exact standard sector identifiers through MAX_SAFE_SECTOR
 * - Larger sector identifiers through BigHierarchicalPosition
 * - Full f32 precision within each sector
 * - Clean integration with chunk systems
 * - GPU-safe local coordinates
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Size of one sector in world units (10km) */
export const SECTOR_SIZE = 10000;

/** Half sector size for boundary checks */
export const SECTOR_HALF = SECTOR_SIZE / 2;

/** Inverse for fast division */
export const SECTOR_INV = 1 / SECTOR_SIZE;

/** Maximum safe integer for sector coords (before BigInt needed) */
export const MAX_SAFE_SECTOR = Math.floor(Number.MAX_SAFE_INTEGER / SECTOR_SIZE);

// Normalize a detached value before publishing any axis. Sector identifiers
// must never pass through a 32-bit bitwise coercion or an unbounded carry loop.
function normalizedCoordinates(position, big = false) {
    const result = {};
    for (const axis of ['X', 'Y', 'Z']) {
        const sector = position[`sector${axis}`], local = position[`local${axis}`];
        if (big ? typeof sector !== 'bigint'
            : !Number.isSafeInteger(sector) || Math.abs(sector) > MAX_SAFE_SECTOR) {
            throw new RangeError('Sector must be an exact integer in its declared coordinate range');
        }
        if (typeof local !== 'number' || !Number.isFinite(local)) throw new RangeError('Local coordinates must be finite numbers');
        let carry = Math.floor(local / SECTOR_SIZE), remainder = local % SECTOR_SIZE;
        if (!Number.isSafeInteger(carry)) throw new RangeError('Local offset exceeds exact sector carry; provide a sector and bounded local offset');
        if (remainder < 0) remainder += SECTOR_SIZE;
        // Very small negative offsets can round up to the next sector boundary.
        if (remainder >= SECTOR_SIZE) { remainder = 0; carry += 1; }
        if (!Number.isSafeInteger(carry)) throw new RangeError('Local sector carry exceeds the exact integer range');
        const next = big ? sector + BigInt(carry) : sector + carry;
        if (!big && (!Number.isSafeInteger(next) || Math.abs(next) > MAX_SAFE_SECTOR)) {
            throw new RangeError('Position exceeds standard sector range; use BigHierarchicalPosition');
        }
        result[`sector${axis}`] = next;
        result[`local${axis}`] = remainder === 0 ? 0 : remainder;
    }
    return result;
}

// ============================================================================
// HIERARCHICAL POSITION CLASS
// ============================================================================

/**
 * Represents a position using sector + local coordinates
 * Sector is integer grid position, local is f32-safe offset within sector
 */
export class HierarchicalPosition {
    /**
     * @param {number} sectorX - Integer sector X
     * @param {number} sectorY - Integer sector Y  
     * @param {number} sectorZ - Integer sector Z
     * @param {number} localX - Local X within sector (0 to SECTOR_SIZE)
     * @param {number} localY - Local Y within sector (0 to SECTOR_SIZE)
     * @param {number} localZ - Local Z within sector (0 to SECTOR_SIZE)
     */
    constructor(sectorX = 0, sectorY = 0, sectorZ = 0, localX = 0, localY = 0, localZ = 0) {
        // Sector coordinates (integer)
        this.sectorX = sectorX;
        this.sectorY = sectorY;
        this.sectorZ = sectorZ;
        
        // Local coordinates within sector (0 to SECTOR_SIZE)
        this.localX = localX;
        this.localY = localY;
        this.localZ = localZ;
        
        // Normalize on construction
        this.normalize();
    }
    
    /**
     * Normalize coordinates so local stays within [0, SECTOR_SIZE)
     * Overflow/underflow adjusts sector accordingly
     */
    normalize() {
        Object.assign(this, normalizedCoordinates(this));
        return this;
    }
    
    /**
     * Create from flat world coordinates
     * @param {number} x - World X
     * @param {number} y - World Y
     * @param {number} z - World Z
     * @returns {HierarchicalPosition}
     */
    static fromWorld(x, y, z) {
        const sectorX = Math.floor(x * SECTOR_INV);
        const sectorY = Math.floor(y * SECTOR_INV);
        const sectorZ = Math.floor(z * SECTOR_INV);
        
        const localX = x - sectorX * SECTOR_SIZE;
        const localY = y - sectorY * SECTOR_SIZE;
        const localZ = z - sectorZ * SECTOR_SIZE;
        
        return new HierarchicalPosition(sectorX, sectorY, sectorZ, localX, localY, localZ);
    }
    
    /**
     * Convert to flat world coordinates
     * WARNING: May lose precision at extreme distances
     * @returns {[number, number, number]}
     */
    toWorld() {
        return [
            this.sectorX * SECTOR_SIZE + this.localX,
            this.sectorY * SECTOR_SIZE + this.localY,
            this.sectorZ * SECTOR_SIZE + this.localZ,
        ];
    }
    
    /**
     * Get position relative to a reference position (camera/player)
     * Result is f32-safe for GPU upload
     * @param {HierarchicalPosition} reference - Reference position (usually camera)
     * @returns {[number, number, number]} - Camera-relative position (f32 safe)
     */
    toCameraRelative(reference) {
        // Sector difference (could be large, but multiplied by SECTOR_SIZE)
        const dSectorX = this.sectorX - reference.sectorX;
        const dSectorY = this.sectorY - reference.sectorY;
        const dSectorZ = this.sectorZ - reference.sectorZ;
        
        // Local difference (always small, f32 safe)
        const dLocalX = this.localX - reference.localX;
        const dLocalY = this.localY - reference.localY;
        const dLocalZ = this.localZ - reference.localZ;
        
        // Combined relative position
        // Safe if sector difference is small (within view distance)
        return [
            dSectorX * SECTOR_SIZE + dLocalX,
            dSectorY * SECTOR_SIZE + dLocalY,
            dSectorZ * SECTOR_SIZE + dLocalZ,
        ];
    }
    
    /**
     * Get squared distance to another position
     * Uses hierarchical math for precision
     * @param {HierarchicalPosition} other 
     * @returns {number}
     */
    distanceSquaredTo(other) {
        const rel = other.toCameraRelative(this);
        return rel[0] * rel[0] + rel[1] * rel[1] + rel[2] * rel[2];
    }
    
    /**
     * Get distance to another position
     * @param {HierarchicalPosition} other 
     * @returns {number}
     */
    distanceTo(other) {
        return Math.sqrt(this.distanceSquaredTo(other));
    }
    
    /**
     * Add offset to position
     * @param {number} dx 
     * @param {number} dy 
     * @param {number} dz 
     * @returns {HierarchicalPosition} this (for chaining)
     */
    add(dx, dy, dz) {
        if ([dx, dy, dz].some(value => typeof value !== 'number' || !Number.isFinite(value))) {
            throw new RangeError('Position offsets must be finite numbers');
        }
        Object.assign(this, normalizedCoordinates({ ...this, localX: this.localX + dx,
            localY: this.localY + dy, localZ: this.localZ + dz }));
        return this;
    }
    
    /**
     * Set from another HierarchicalPosition
     * @param {HierarchicalPosition} other 
     * @returns {HierarchicalPosition} this
     */
    copyFrom(other) {
        Object.assign(this, normalizedCoordinates(other));
        return this;
    }
    
    /**
     * Clone this position
     * @returns {HierarchicalPosition}
     */
    clone() {
        return new HierarchicalPosition(
            this.sectorX, this.sectorY, this.sectorZ,
            this.localX, this.localY, this.localZ
        );
    }
    
    /**
     * Check if in same sector as another position
     * @param {HierarchicalPosition} other 
     * @returns {boolean}
     */
    sameSector(other) {
        return this.sectorX === other.sectorX &&
               this.sectorY === other.sectorY &&
               this.sectorZ === other.sectorZ;
    }
    
    /**
     * Get sector key for hashing/lookup
     * @returns {string}
     */
    getSectorKey() {
        return `${this.sectorX},${this.sectorY},${this.sectorZ}`;
    }
    
    /**
     * Get sector as array [x, y, z]
     * @returns {[number, number, number]}
     */
    getSector() {
        return [this.sectorX, this.sectorY, this.sectorZ];
    }
    
    /**
     * Get local position as array [x, y, z]
     * @returns {[number, number, number]}
     */
    getLocal() {
        return [this.localX, this.localY, this.localZ];
    }
    
    /**
     * Serialize to transferable object
     * @returns {Object}
     */
    serialize() {
        return {
            sx: this.sectorX,
            sy: this.sectorY,
            sz: this.sectorZ,
            lx: this.localX,
            ly: this.localY,
            lz: this.localZ,
        };
    }
    
    /**
     * Deserialize from object
     * @param {Object} data 
     * @returns {HierarchicalPosition}
     */
    static deserialize(data) {
        return new HierarchicalPosition(
            data.sx, data.sy, data.sz,
            data.lx, data.ly, data.lz
        );
    }
    
    /**
     * Debug string representation
     * @returns {string}
     */
    toString() {
        return `Sector(${this.sectorX}, ${this.sectorY}, ${this.sectorZ}) + ` +
               `Local(${this.localX.toFixed(2)}, ${this.localY.toFixed(2)}, ${this.localZ.toFixed(2)})`;
    }
}

// ============================================================================
// SECTOR UTILITIES
// ============================================================================

/**
 * Get all sector keys within radius of a position
 * @param {HierarchicalPosition} center 
 * @param {number} radiusSectors - Radius in sectors
 * @returns {string[]} Array of sector keys
 */
export function getSectorsInRadius(center, radiusSectors) {
    const keys = [];
    const r = Math.ceil(radiusSectors);
    
    for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dz = -r; dz <= r; dz++) {
                if (dx * dx + dy * dy + dz * dz <= radiusSectors * radiusSectors) {
                    keys.push(`${center.sectorX + dx},${center.sectorY + dy},${center.sectorZ + dz}`);
                }
            }
        }
    }
    
    return keys;
}

/**
 * Parse sector key back to coordinates
 * @param {string} key - Sector key "x,y,z"
 * @returns {[number, number, number]}
 */
export function parseSectorKey(key) {
    const parts = key.split(',');
    return [parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2])];
}

/**
 * Calculate sector-aligned chunk key
 * Useful for chunk loading that respects sector boundaries
 * @param {HierarchicalPosition} pos 
 * @param {number} chunkSize - Size of chunks in world units
 * @returns {string}
 */
export function getChunkKeyHierarchical(pos, chunkSize) {
    // Chunk position within the sector
    const chunkX = Math.floor(pos.localX / chunkSize);
    const chunkY = Math.floor(pos.localY / chunkSize);
    const chunkZ = Math.floor(pos.localZ / chunkSize);
    
    // Include sector in key for global uniqueness
    return `${pos.sectorX}:${pos.sectorY}:${pos.sectorZ}:${chunkX}:${chunkY}:${chunkZ}`;
}

// ============================================================================
// COORDINATE CONVERSION HELPERS
// ============================================================================

/**
 * Convert world coordinates to hierarchical
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @returns {HierarchicalPosition}
 */
export function worldToHierarchical(x, y, z) {
    return HierarchicalPosition.fromWorld(x, y, z);
}

/**
 * Convert hierarchical to world coordinates
 * @param {HierarchicalPosition} pos 
 * @returns {[number, number, number]}
 */
export function hierarchicalToWorld(pos) {
    return pos.toWorld();
}

/**
 * Get camera-relative coordinates (f32 safe for GPU)
 * @param {HierarchicalPosition} worldPos - Position to convert
 * @param {HierarchicalPosition} cameraPos - Camera position
 * @returns {[number, number, number]}
 */
export function toCameraSpace(worldPos, cameraPos) {
    return worldPos.toCameraRelative(cameraPos);
}

// ============================================================================
// BIGINT SUPPORT FOR EXTREME DISTANCES
// ============================================================================

/**
 * Extended hierarchical position using BigInt for extreme planet scales
 * Use only when sector coordinates exceed MAX_SAFE_SECTOR
 */
export class BigHierarchicalPosition {
    /**
     * @param {BigInt} sectorX 
     * @param {BigInt} sectorY 
     * @param {BigInt} sectorZ 
     * @param {number} localX 
     * @param {number} localY 
     * @param {number} localZ 
     */
    constructor(sectorX = 0n, sectorY = 0n, sectorZ = 0n, localX = 0, localY = 0, localZ = 0) {
        if ([sectorX, sectorY, sectorZ].some(value => typeof value === 'number' && !Number.isSafeInteger(value))) {
            throw new RangeError('Numeric BigInt sectors must be exact safe integers; use BigInt or a decimal string');
        }
        this.sectorX = BigInt(sectorX);
        this.sectorY = BigInt(sectorY);
        this.sectorZ = BigInt(sectorZ);
        this.localX = localX;
        this.localY = localY;
        this.localZ = localZ;
        this.normalize();
    }
    
    normalize() {
        Object.assign(this, normalizedCoordinates(this, true));
        return this;
    }
    
    /**
     * Convert to standard HierarchicalPosition if within safe range
     * @returns {HierarchicalPosition|null} null if out of range
     */
    toStandard() {
        const max = BigInt(MAX_SAFE_SECTOR);
        if (this.sectorX > max || this.sectorX < -max ||
            this.sectorY > max || this.sectorY < -max ||
            this.sectorZ > max || this.sectorZ < -max) {
            return null;
        }
        return new HierarchicalPosition(
            Number(this.sectorX), Number(this.sectorY), Number(this.sectorZ),
            this.localX, this.localY, this.localZ
        );
    }
    
    getSectorKey() {
        return `${this.sectorX},${this.sectorY},${this.sectorZ}`;
    }
}

export default HierarchicalPosition;
