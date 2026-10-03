/**
 * SpatialIntegritySystem.js - Coordinate Validation & Correction
 * 
 * Ensures spatial integrity for planetary-scale worlds:
 * - O(1) position lookup via composite keys
 * - Fast checksum validation for corruption detection
 * - World-tick based temporal tracking
 * - Authority snapshots for rollback/sync
 * - Drift correction for network sync
 * 
 * Designed for minimal overhead while providing strong guarantees.
 */

import { legacyPrimeCoordinateXorHash3D } from '../../core/math/MathBits.js';

// ============================================================================
// CONSTANTS
// ============================================================================

// Validation thresholds
const DEFAULT_MAX_DRIFT = 0.001;          // Max position drift before correction
const DEFAULT_SNAPSHOT_INTERVAL = 100;    // Ticks between authority snapshots
const DEFAULT_MAX_SNAPSHOTS = 60;         // Keep ~1 minute of snapshots at 20 TPS
const DEFAULT_VALIDATION_BATCH = 100;     // Entities to validate per frame

// Entity types for categorized tracking
export const EntityCategory = {
    CHUNK: 'chunk',           // Voxel chunks
    STRUCTURE: 'structure',   // Cross-chunk structures  
    ENTITY: 'entity',         // Game entities (mobs, items)
    PLAYER: 'player',         // Player positions (highest priority)
    PARTICLE: 'particle',     // Particles (optional tracking)
    PROJECTILE: 'projectile', // Projectiles
};

// Validation results
export const ValidationResult = {
    VALID: 0,
    DRIFT: 1,           // Small drift, correctable
    MISMATCH: 2,        // Position mismatch
    MISSING: 3,         // Not registered
    CORRUPTED: 4,       // Checksum mismatch (data corruption)
};

// ============================================================================
// POSITION RECORD
// ============================================================================

/**
 * Compact position record with validation data
 */
class PositionRecord {
    constructor(id, x, y, z, category, tick) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.z = z;
        this.category = category;
        this.registeredTick = tick;
        this.lastValidatedTick = tick;
        this.lastModifiedTick = tick;
        this.checksum = PositionRecord.computeChecksum(x, y, z);
        this.validationCount = 0;
        this.correctionCount = 0;
    }
    
    /**
     * Update position and checksum
     */
    update(x, y, z, tick) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.checksum = PositionRecord.computeChecksum(x, y, z);
        this.lastModifiedTick = tick;
    }
    
    /**
     * Compute position checksum (fast hash)
     */
    static computeChecksum(x, y, z) {
        // Preserve 3-decimal precision before delegating the legacy prime-XOR mix.
        const ix = Math.floor(x * 1000);  // 3 decimal precision
        const iy = Math.floor(y * 1000);
        const iz = Math.floor(z * 1000);
        return legacyPrimeCoordinateXorHash3D(ix, iy, iz);
    }
    
    /**
     * Check if checksum matches current position
     */
    verifyChecksum() {
        return this.checksum === PositionRecord.computeChecksum(this.x, this.y, this.z);
    }
}

// ============================================================================
// AUTHORITY SNAPSHOT
// ============================================================================

/**
 * Snapshot of all positions at a specific tick
 * Used for rollback and sync verification
 */
class AuthoritySnapshot {
    constructor(tick) {
        this.tick = tick;
        this.positions = new Map();  // id -> {x, y, z, checksum}
        this.createdAt = Date.now();
    }
    
    /**
     * Add position to snapshot
     */
    add(id, x, y, z) {
        this.positions.set(id, {
            x, y, z,
            checksum: PositionRecord.computeChecksum(x, y, z),
        });
    }
    
    /**
     * Get position from snapshot
     */
    get(id) {
        return this.positions.get(id);
    }
    
    /**
     * Check if entity exists in snapshot
     */
    has(id) {
        return this.positions.has(id);
    }
    
    /**
     * Get memory size estimate
     */
    get byteSize() {
        // Rough estimate: 32 bytes per entry (id + 3 floats + checksum + overhead)
        return this.positions.size * 32;
    }
}

// ============================================================================
// SPATIAL INTEGRITY SYSTEM
// ============================================================================

export class SpatialIntegritySystem {
    constructor(options = {}) {
        // Primary lookups - O(1)
        this.byPosition = new Map();     // "x,y,z" -> Set<id>
        this.byId = new Map();           // id -> PositionRecord
        this.byCategory = new Map();     // category -> Set<id>
        
        // Authority snapshots for rollback
        this.snapshots = [];             // Array of AuthoritySnapshot (circular buffer)
        this.lastSnapshotTick = 0n;
        
        // Configuration
        this.config = {
            maxDrift: options.maxDrift ?? DEFAULT_MAX_DRIFT,
            snapshotInterval: options.snapshotInterval ?? DEFAULT_SNAPSHOT_INTERVAL,
            maxSnapshots: options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS,
            validationBatch: options.validationBatch ?? DEFAULT_VALIDATION_BATCH,
            enableSnapshots: options.enableSnapshots !== false,
            enableAutoValidation: options.enableAutoValidation !== false,
            logCorrections: options.logCorrections !== false,
        };
        
        // External systems
        this.worldTime = null;
        
        // Validation state (for batched validation)
        this._validationIterator = null;
        this._validationIndex = 0;
        
        // Statistics
        this.stats = {
            registered: 0,
            unregistered: 0,
            validated: 0,
            corrections: 0,
            checksumFailures: 0,
            snapshotsTaken: 0,
            rollbacks: 0,
            memoryUsed: 0,
        };
        
        // Initialize category sets
        for (const cat of Object.values(EntityCategory)) {
            this.byCategory.set(cat, new Set());
        }
    }
    
    // ========================================================================
    // INITIALIZATION
    // ========================================================================
    
    /**
     * Initialize with external systems
     */
    init(options = {}) {
        this.worldTime = options.worldTime;
        
        if (options.config) {
            Object.assign(this.config, options.config);
        }
        
        console.log('[SpatialIntegrity] Initialized', {
            snapshotInterval: this.config.snapshotInterval,
            maxSnapshots: this.config.maxSnapshots,
            maxDrift: this.config.maxDrift,
        });
        
        return this;
    }
    
    /**
     * Get current tick from world time
     */
    get currentTick() {
        return this.worldTime?.totalTicks ?? 0n;
    }
    
    // ========================================================================
    // REGISTRATION
    // ========================================================================
    
    /**
     * Register an entity's position
     * @param {string|number} id - Unique entity identifier
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @param {string} category - Entity category (EntityCategory)
     */
    register(id, x, y, z, category = EntityCategory.ENTITY) {
        const tick = this.currentTick;
        
        // Remove old position if exists
        if (this.byId.has(id)) {
            this._removeFromPositionIndex(id);
        }
        
        // Create record
        const record = new PositionRecord(id, x, y, z, category, tick);
        
        // Store in lookups
        this.byId.set(id, record);
        this._addToPositionIndex(id, x, y, z);
        
        // Track by category
        const catSet = this.byCategory.get(category);
        if (catSet) catSet.add(id);
        
        this.stats.registered++;
        return record;
    }
    
    /**
     * Unregister an entity
     */
    unregister(id) {
        const record = this.byId.get(id);
        if (!record) return false;
        
        // Remove from position index
        this._removeFromPositionIndex(id);
        
        // Remove from category
        const catSet = this.byCategory.get(record.category);
        if (catSet) catSet.delete(id);
        
        // Remove record
        this.byId.delete(id);
        
        this.stats.unregistered++;
        return true;
    }
    
    /**
     * Update an entity's position
     */
    updatePosition(id, x, y, z) {
        const record = this.byId.get(id);
        if (!record) return false;
        
        // Remove from old position index
        this._removeFromPositionIndex(id);
        
        // Update record
        record.update(x, y, z, this.currentTick);
        
        // Add to new position index
        this._addToPositionIndex(id, x, y, z);
        
        return true;
    }
    
    // ========================================================================
    // POSITION INDEX HELPERS
    // ========================================================================
    
    /**
     * Generate position key from coordinates
     */
    _posKey(x, y, z) {
        // Round to avoid floating point issues
        const rx = Math.round(x * 1000) / 1000;
        const ry = Math.round(y * 1000) / 1000;
        const rz = Math.round(z * 1000) / 1000;
        return `${rx},${ry},${rz}`;
    }
    
    /**
     * Add entity to position index
     */
    _addToPositionIndex(id, x, y, z) {
        const key = this._posKey(x, y, z);
        let set = this.byPosition.get(key);
        if (!set) {
            set = new Set();
            this.byPosition.set(key, set);
        }
        set.add(id);
    }
    
    /**
     * Remove entity from position index
     */
    _removeFromPositionIndex(id) {
        const record = this.byId.get(id);
        if (!record) return;
        
        const key = this._posKey(record.x, record.y, record.z);
        const set = this.byPosition.get(key);
        if (set) {
            set.delete(id);
            if (set.size === 0) {
                this.byPosition.delete(key);
            }
        }
    }
    
    // ========================================================================
    // VALIDATION
    // ========================================================================
    
    /**
     * Validate a single entity's position
     * @param {string|number} id - Entity ID
     * @param {number} actualX - Current actual X position
     * @param {number} actualY - Current actual Y position
     * @param {number} actualZ - Current actual Z position
     * @returns {ValidationResult}
     */
    validate(id, actualX, actualY, actualZ) {
        const record = this.byId.get(id);
        
        if (!record) {
            return ValidationResult.MISSING;
        }
        
        // Fast checksum check first
        const actualChecksum = PositionRecord.computeChecksum(actualX, actualY, actualZ);
        
        if (actualChecksum === record.checksum) {
            // Checksums match - likely valid
            record.lastValidatedTick = this.currentTick;
            record.validationCount++;
            this.stats.validated++;
            return ValidationResult.VALID;
        }
        
        // Checksums don't match - calculate actual drift
        const drift = Math.hypot(
            actualX - record.x,
            actualY - record.y,
            actualZ - record.z
        );
        
        if (drift <= this.config.maxDrift) {
            // Within tolerance - update record to actual
            record.update(actualX, actualY, actualZ, this.currentTick);
            record.lastValidatedTick = this.currentTick;
            record.validationCount++;
            this.stats.validated++;
            return ValidationResult.DRIFT;
        }
        
        // Significant mismatch
        this.stats.validated++;
        return ValidationResult.MISMATCH;
    }
    
    /**
     * Validate and auto-correct an entity
     * @returns {{result: ValidationResult, corrected: boolean, drift: number}}
     */
    validateAndCorrect(entity, getPosition, setPosition) {
        const pos = getPosition(entity);
        const result = this.validate(entity.id, pos.x, pos.y, pos.z);
        
        if (result === ValidationResult.MISMATCH) {
            const record = this.byId.get(entity.id);
            if (record) {
                const drift = Math.hypot(
                    pos.x - record.x,
                    pos.y - record.y,
                    pos.z - record.z
                );
                
                // Correct position
                setPosition(entity, record.x, record.y, record.z);
                record.correctionCount++;
                this.stats.corrections++;
                
                if (this.config.logCorrections) {
                    console.warn(`[SpatialIntegrity] Corrected ${entity.id}: drift=${drift.toFixed(3)}`);
                }
                
                return { result, corrected: true, drift };
            }
        }
        
        return { result, corrected: false, drift: 0 };
    }
    
    /**
     * Batch validate entities (call each frame)
     * Validates a subset of entities per frame for minimal overhead
     */
    validateBatch(getEntityById, getPosition, setPosition) {
        if (!this.config.enableAutoValidation) return;
        
        const ids = Array.from(this.byId.keys());
        if (ids.length === 0) return;
        
        const batchSize = Math.min(this.config.validationBatch, ids.length);
        const startIdx = this._validationIndex;
        
        let validated = 0;
        let corrected = 0;
        
        for (let i = 0; i < batchSize; i++) {
            const idx = (startIdx + i) % ids.length;
            const id = ids[idx];
            const entity = getEntityById(id);
            
            if (entity) {
                const result = this.validateAndCorrect(entity, getPosition, setPosition);
                validated++;
                if (result.corrected) corrected++;
            }
        }
        
        this._validationIndex = (startIdx + batchSize) % ids.length;
        
        return { validated, corrected };
    }
    
    // ========================================================================
    // AUTHORITY SNAPSHOTS
    // ========================================================================
    
    /**
     * Take a snapshot of all positions at current tick
     */
    takeSnapshot() {
        if (!this.config.enableSnapshots) return null;
        
        const tick = this.currentTick;
        const snapshot = new AuthoritySnapshot(tick);
        
        for (const [id, record] of this.byId) {
            snapshot.add(id, record.x, record.y, record.z);
        }
        
        // Add to circular buffer
        this.snapshots.push(snapshot);
        if (this.snapshots.length > this.config.maxSnapshots) {
            this.snapshots.shift();
        }
        
        this.lastSnapshotTick = tick;
        this.stats.snapshotsTaken++;
        
        return snapshot;
    }
    
    /**
     * Get snapshot at or before a specific tick
     */
    getSnapshotAtTick(tick) {
        // Find closest snapshot at or before tick
        for (let i = this.snapshots.length - 1; i >= 0; i--) {
            if (this.snapshots[i].tick <= tick) {
                return this.snapshots[i];
            }
        }
        return null;
    }
    
    /**
     * Rollback an entity to a previous snapshot
     */
    rollbackEntity(id, tick, setPosition) {
        const snapshot = this.getSnapshotAtTick(tick);
        if (!snapshot) return false;
        
        const pos = snapshot.get(id);
        if (!pos) return false;
        
        // Update our record
        const record = this.byId.get(id);
        if (record) {
            this._removeFromPositionIndex(id);
            record.update(pos.x, pos.y, pos.z, this.currentTick);
            this._addToPositionIndex(id, pos.x, pos.y, pos.z);
        }
        
        // Call setter to update actual entity
        setPosition(pos.x, pos.y, pos.z);
        
        this.stats.rollbacks++;
        return true;
    }
    
    // ========================================================================
    // UPDATE LOOP
    // ========================================================================
    
    /**
     * Call each frame to perform maintenance
     */
    update() {
        const tick = this.currentTick;
        
        // Take snapshot if interval elapsed
        if (this.config.enableSnapshots) {
            const ticksSinceSnapshot = Number(tick - this.lastSnapshotTick);
            if (ticksSinceSnapshot >= this.config.snapshotInterval) {
                this.takeSnapshot();
            }
        }
        
        // Update memory stats
        this._updateMemoryStats();
    }
    
    /**
     * Update memory usage statistics
     */
    _updateMemoryStats() {
        let bytes = 0;
        
        // Records: ~100 bytes each
        bytes += this.byId.size * 100;
        
        // Position index: ~50 bytes per key
        bytes += this.byPosition.size * 50;
        
        // Snapshots
        for (const snap of this.snapshots) {
            bytes += snap.byteSize;
        }
        
        this.stats.memoryUsed = bytes;
    }
    
    // ========================================================================
    // QUERIES
    // ========================================================================
    
    /**
     * Get all entities at a position
     */
    getEntitiesAt(x, y, z) {
        const key = this._posKey(x, y, z);
        const set = this.byPosition.get(key);
        return set ? Array.from(set) : [];
    }
    
    /**
     * Get entity's registered position
     */
    getPosition(id) {
        const record = this.byId.get(id);
        if (!record) return null;
        return { x: record.x, y: record.y, z: record.z };
    }
    
    /**
     * Get all entities in a category
     */
    getByCategory(category) {
        const set = this.byCategory.get(category);
        return set ? Array.from(set) : [];
    }
    
    /**
     * Check if position is occupied
     */
    isOccupied(x, y, z) {
        const key = this._posKey(x, y, z);
        const set = this.byPosition.get(key);
        return set && set.size > 0;
    }
    
    /**
     * Get record for entity
     */
    getRecord(id) {
        return this.byId.get(id);
    }
    
    // ========================================================================
    // STATISTICS & DEBUG
    // ========================================================================
    
    /**
     * Get system statistics
     */
    getStats() {
        return {
            ...this.stats,
            totalTracked: this.byId.size,
            uniquePositions: this.byPosition.size,
            snapshotCount: this.snapshots.length,
            oldestSnapshotTick: this.snapshots[0]?.tick ?? 0n,
            newestSnapshotTick: this.snapshots[this.snapshots.length - 1]?.tick ?? 0n,
            memoryMB: (this.stats.memoryUsed / (1024 * 1024)).toFixed(2),
        };
    }
    
    /**
     * Print stats to console
     */
    printStats() {
        const s = this.getStats();
        console.log('[SpatialIntegrity] Stats:');
        console.log(`  Tracked: ${s.totalTracked} entities, ${s.uniquePositions} unique positions`);
        console.log(`  Validated: ${s.validated}, Corrections: ${s.corrections}`);
        console.log(`  Snapshots: ${s.snapshotCount} (${s.memoryMB} MB)`);
        console.log(`  Registered: ${s.registered}, Unregistered: ${s.unregistered}`);
        return s;
    }
    
    /**
     * Verify integrity of all records
     */
    verifyAllRecords() {
        let valid = 0;
        let invalid = 0;
        const issues = [];
        
        for (const [id, record] of this.byId) {
            if (record.verifyChecksum()) {
                valid++;
            } else {
                invalid++;
                issues.push({ id, record });
                this.stats.checksumFailures++;
            }
        }
        
        console.log(`[SpatialIntegrity] Verify: ${valid} valid, ${invalid} invalid`);
        return { valid, invalid, issues };
    }
    
    /**
     * Clear all data
     */
    clear() {
        this.byPosition.clear();
        this.byId.clear();
        this.snapshots = [];
        this.lastSnapshotTick = 0n;
        this._validationIndex = 0;
        
        // Re-initialize category sets
        for (const cat of Object.values(EntityCategory)) {
            this.byCategory.set(cat, new Set());
        }
        
        console.log('[SpatialIntegrity] Cleared');
    }
}

// ============================================================================
// CHUNK POSITION INTEGRITY (Specialized for chunks)
// ============================================================================

/**
 * Specialized integrity tracking for chunk positions
 * Uses integer coordinates for exact matching
 */
export class ChunkIntegrityTracker {
    constructor() {
        this.chunks = new Map();  // "cx,cy,cz" -> { registeredTick, checksum }
    }
    
    /**
     * Register a chunk
     */
    register(cx, cy, cz, tick) {
        const key = `${cx},${cy},${cz}`;
        const checksum = this._checksum(cx, cy, cz);
        this.chunks.set(key, { cx, cy, cz, registeredTick: tick, checksum });
    }
    
    /**
     * Unregister a chunk
     */
    unregister(cx, cy, cz) {
        const key = `${cx},${cy},${cz}`;
        return this.chunks.delete(key);
    }
    
    /**
     * Validate chunk position
     */
    validate(cx, cy, cz) {
        const key = `${cx},${cy},${cz}`;
        const record = this.chunks.get(key);
        
        if (!record) return ValidationResult.MISSING;
        
        const checksum = this._checksum(cx, cy, cz);
        if (checksum !== record.checksum) {
            return ValidationResult.CORRUPTED;
        }
        
        if (record.cx !== cx || record.cy !== cy || record.cz !== cz) {
            return ValidationResult.MISMATCH;
        }
        
        return ValidationResult.VALID;
    }
    
    /**
     * Check if chunk is registered
     */
    isRegistered(cx, cy, cz) {
        return this.chunks.has(`${cx},${cy},${cz}`);
    }
    
    /**
     * Get all registered chunk keys
     */
    getAllKeys() {
        return Array.from(this.chunks.keys());
    }
    
    /**
     * Compute checksum for chunk coordinates
     */
    _checksum(cx, cy, cz) {
        return legacyPrimeCoordinateXorHash3D(cx, cy, cz);
    }
    
    /**
     * Get stats
     */
    getStats() {
        return {
            totalChunks: this.chunks.size,
        };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default SpatialIntegritySystem;
