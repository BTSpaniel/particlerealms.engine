// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkHistory.js - Undo/Redo System with Snapshots
 * 
 * Provides:
 * - Per-chunk operation history (undo/redo)
 * - Automatic snapshots at intervals
 * - Time-based rollback
 * - Entity change tracking
 * - Memory-efficient delta storage
 * 
 * Architecture:
 * - Operations: Individual block changes (small, many)
 * - Snapshots: Full chunk state (large, periodic)
 * - Entity Events: Spawn/despawn/modify tracking
 */

import { compressChunk, decompressChunk } from '../storage/VoxelCompression.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_OPS = 1000;        // Max operations per chunk
const DEFAULT_SNAPSHOT_INTERVAL = 100;  // Ops between snapshots
const DEFAULT_MAX_SNAPSHOTS = 10;    // Max snapshots per chunk
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;  // 24 hours

// Operation types
const OP_VOXEL_SET = 0x01;
const OP_VOXEL_FILL = 0x02;
const OP_ENTITY_SPAWN = 0x10;
const OP_ENTITY_DESPAWN = 0x11;
const OP_ENTITY_MOVE = 0x12;
const OP_ENTITY_MODIFY = 0x13;

// ============================================================================
// OPERATION CLASSES
// ============================================================================

/**
 * Single voxel change operation
 */
class VoxelOperation {
    constructor(index, oldValue, newValue, timestamp, playerId = 0) {
        this.type = OP_VOXEL_SET;
        this.index = index;
        this.oldValue = oldValue;
        this.newValue = newValue;
        this.timestamp = timestamp;
        this.playerId = playerId;
    }
    
    apply(voxels) {
        voxels[this.index] = this.newValue;
    }
    
    revert(voxels) {
        voxels[this.index] = this.oldValue;
    }
    
    serialize() {
        return {
            t: this.type,
            i: this.index,
            o: this.oldValue,
            n: this.newValue,
            ts: this.timestamp,
            p: this.playerId,
        };
    }
    
    static deserialize(data) {
        return new VoxelOperation(
            data.i, data.o, data.n, data.ts, data.p
        );
    }
}

/**
 * Fill operation (multiple voxels)
 */
class FillOperation {
    constructor(indices, oldValues, newValue, timestamp, playerId = 0) {
        this.type = OP_VOXEL_FILL;
        this.indices = indices;
        this.oldValues = oldValues;
        this.newValue = newValue;
        this.timestamp = timestamp;
        this.playerId = playerId;
    }
    
    apply(voxels) {
        for (const idx of this.indices) {
            voxels[idx] = this.newValue;
        }
    }
    
    revert(voxels) {
        for (let i = 0; i < this.indices.length; i++) {
            voxels[this.indices[i]] = this.oldValues[i];
        }
    }
    
    serialize() {
        return {
            t: this.type,
            idx: Array.from(this.indices),
            old: Array.from(this.oldValues),
            n: this.newValue,
            ts: this.timestamp,
            p: this.playerId,
        };
    }
    
    static deserialize(data) {
        return new FillOperation(
            new Uint32Array(data.idx),
            new Uint8Array(data.old),
            data.n,
            data.ts,
            data.p
        );
    }
}

/**
 * Entity operation base class
 */
class EntityOperation {
    constructor(type, entityId, timestamp, playerId = 0) {
        this.type = type;
        this.entityId = entityId;
        this.timestamp = timestamp;
        this.playerId = playerId;
    }
}

/**
 * Entity spawn operation
 */
class EntitySpawnOperation extends EntityOperation {
    constructor(entityId, entityData, timestamp, playerId = 0) {
        super(OP_ENTITY_SPAWN, entityId, timestamp, playerId);
        this.entityData = entityData;
    }
    
    apply(entities) {
        entities.set(this.entityId, { ...this.entityData });
    }
    
    revert(entities) {
        entities.delete(this.entityId);
    }
    
    serialize() {
        return {
            t: this.type,
            id: this.entityId,
            data: this.entityData,
            ts: this.timestamp,
            p: this.playerId,
        };
    }
    
    static deserialize(data) {
        return new EntitySpawnOperation(data.id, data.data, data.ts, data.p);
    }
}

/**
 * Entity despawn operation
 */
class EntityDespawnOperation extends EntityOperation {
    constructor(entityId, entityData, timestamp, playerId = 0) {
        super(OP_ENTITY_DESPAWN, entityId, timestamp, playerId);
        this.entityData = entityData;  // Store for undo
    }
    
    apply(entities) {
        entities.delete(this.entityId);
    }
    
    revert(entities) {
        entities.set(this.entityId, { ...this.entityData });
    }
    
    serialize() {
        return {
            t: this.type,
            id: this.entityId,
            data: this.entityData,
            ts: this.timestamp,
            p: this.playerId,
        };
    }
    
    static deserialize(data) {
        return new EntityDespawnOperation(data.id, data.data, data.ts, data.p);
    }
}

/**
 * Entity move operation
 */
class EntityMoveOperation extends EntityOperation {
    constructor(entityId, oldPos, newPos, timestamp, playerId = 0) {
        super(OP_ENTITY_MOVE, entityId, timestamp, playerId);
        this.oldPos = oldPos;
        this.newPos = newPos;
    }
    
    apply(entities) {
        const entity = entities.get(this.entityId);
        if (entity) {
            entity.position = { ...this.newPos };
        }
    }
    
    revert(entities) {
        const entity = entities.get(this.entityId);
        if (entity) {
            entity.position = { ...this.oldPos };
        }
    }
    
    serialize() {
        return {
            t: this.type,
            id: this.entityId,
            op: this.oldPos,
            np: this.newPos,
            ts: this.timestamp,
            p: this.playerId,
        };
    }
    
    static deserialize(data) {
        return new EntityMoveOperation(data.id, data.op, data.np, data.ts, data.p);
    }
}

// ============================================================================
// SNAPSHOT CLASS
// ============================================================================

/**
 * Full chunk state snapshot
 */
class ChunkSnapshot {
    constructor(voxels, entities, opIndex, timestamp, chunkSize = 32) {
        this.opIndex = opIndex;
        this.timestamp = timestamp;
        this.chunkSize = chunkSize;
        
        // Compress voxels
        if (voxels) {
            const { compressed } = compressChunk(voxels, chunkSize);
            this.compressedVoxels = compressed;
        } else {
            this.compressedVoxels = null;
        }
        
        // Deep copy entities
        this.entities = entities ? new Map(
            Array.from(entities.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])
        ) : new Map();
    }
    
    /**
     * Restore voxels from snapshot
     * @returns {Uint8Array}
     */
    getVoxels() {
        if (!this.compressedVoxels) return null;
        return decompressChunk(this.compressedVoxels, this.chunkSize);
    }
    
    /**
     * Get entities map copy
     * @returns {Map}
     */
    getEntities() {
        return new Map(
            Array.from(this.entities.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])
        );
    }
    
    /**
     * Get memory usage estimate
     * @returns {number}
     */
    getMemoryUsage() {
        let size = 24;  // Base overhead
        if (this.compressedVoxels) {
            size += this.compressedVoxels.length;
        }
        size += this.entities.size * 200;  // Estimate per entity
        return size;
    }
    
    serialize() {
        return {
            opIndex: this.opIndex,
            timestamp: this.timestamp,
            chunkSize: this.chunkSize,
            voxels: this.compressedVoxels ? Array.from(this.compressedVoxels) : null,
            entities: Array.from(this.entities.entries()),
        };
    }
    
    static deserialize(data) {
        const snapshot = new ChunkSnapshot(null, null, data.opIndex, data.timestamp, data.chunkSize);
        snapshot.compressedVoxels = data.voxels ? new Uint8Array(data.voxels) : null;
        snapshot.entities = new Map(data.entities);
        return snapshot;
    }
}

// ============================================================================
// CHUNK HISTORY CLASS
// ============================================================================

/**
 * ChunkHistory - Manages history for a single chunk
 */
class ChunkHistory {
    constructor(chunkKey, options = {}) {
        this.chunkKey = chunkKey;
        
        // Configuration
        this.maxOps = options.maxOps || DEFAULT_MAX_OPS;
        this.snapshotInterval = options.snapshotInterval || DEFAULT_SNAPSHOT_INTERVAL;
        this.maxSnapshots = options.maxSnapshots || DEFAULT_MAX_SNAPSHOTS;
        this.retentionMs = options.retentionMs || DEFAULT_RETENTION_MS;
        this.chunkSize = options.chunkSize || 32;
        
        // State
        this.operations = [];
        this.snapshots = [];
        this.head = 0;  // Current position in operation list
        this.baseSnapshot = null;  // Initial state
        
        // Stats
        this.stats = {
            totalOps: 0,
            undoCount: 0,
            redoCount: 0,
            snapshotCount: 0,
        };
    }
    
    /**
     * Set base snapshot (initial chunk state)
     * @param {Uint8Array} voxels 
     * @param {Map} entities 
     */
    setBaseState(voxels, entities) {
        this.baseSnapshot = new ChunkSnapshot(
            voxels,
            entities,
            0,
            Date.now(),
            this.chunkSize
        );
        this.operations = [];
        this.snapshots = [];
        this.head = 0;
    }
    
    /**
     * Record a voxel change
     * @param {number} index 
     * @param {number} oldValue 
     * @param {number} newValue 
     * @param {number} playerId 
     */
    recordVoxelChange(index, oldValue, newValue, playerId = 0) {
        if (oldValue === newValue) return;
        
        const op = new VoxelOperation(index, oldValue, newValue, Date.now(), playerId);
        this._addOperation(op);
    }
    
    /**
     * Record a fill operation
     * @param {Uint32Array} indices 
     * @param {Uint8Array} oldValues 
     * @param {number} newValue 
     * @param {number} playerId 
     */
    recordFill(indices, oldValues, newValue, playerId = 0) {
        const op = new FillOperation(indices, oldValues, newValue, Date.now(), playerId);
        this._addOperation(op);
    }
    
    /**
     * Record entity spawn
     * @param {number} entityId 
     * @param {Object} entityData 
     * @param {number} playerId 
     */
    recordEntitySpawn(entityId, entityData, playerId = 0) {
        const op = new EntitySpawnOperation(entityId, entityData, Date.now(), playerId);
        this._addOperation(op);
    }
    
    /**
     * Record entity despawn
     * @param {number} entityId 
     * @param {Object} entityData 
     * @param {number} playerId 
     */
    recordEntityDespawn(entityId, entityData, playerId = 0) {
        const op = new EntityDespawnOperation(entityId, entityData, Date.now(), playerId);
        this._addOperation(op);
    }
    
    /**
     * Record entity move
     * @param {number} entityId 
     * @param {Object} oldPos 
     * @param {Object} newPos 
     * @param {number} playerId 
     */
    recordEntityMove(entityId, oldPos, newPos, playerId = 0) {
        const op = new EntityMoveOperation(entityId, oldPos, newPos, Date.now(), playerId);
        this._addOperation(op);
    }
    
    /**
     * Add operation to history
     * @private
     */
    _addOperation(op) {
        // If we're not at the end, truncate future operations
        if (this.head < this.operations.length) {
            this.operations = this.operations.slice(0, this.head);
            // Remove snapshots after this point
            this.snapshots = this.snapshots.filter(s => s.opIndex <= this.head);
        }
        
        this.operations.push(op);
        this.head = this.operations.length;
        this.stats.totalOps++;
        
        // Prune old operations if over limit
        this._pruneOldOperations();
    }
    
    /**
     * Create snapshot at current state
     * @param {Uint8Array} voxels - Current voxel state
     * @param {Map} entities - Current entity state
     */
    createSnapshot(voxels, entities) {
        const snapshot = new ChunkSnapshot(
            voxels,
            entities,
            this.head,
            Date.now(),
            this.chunkSize
        );
        
        this.snapshots.push(snapshot);
        this.stats.snapshotCount++;
        
        // Prune old snapshots
        while (this.snapshots.length > this.maxSnapshots) {
            this.snapshots.shift();
        }
    }
    
    /**
     * Check if snapshot should be created
     * @returns {boolean}
     */
    shouldSnapshot() {
        if (this.snapshots.length === 0) return true;
        const lastSnapshot = this.snapshots[this.snapshots.length - 1];
        return this.head - lastSnapshot.opIndex >= this.snapshotInterval;
    }
    
    /**
     * Can undo?
     * @returns {boolean}
     */
    canUndo() {
        return this.head > 0;
    }
    
    /**
     * Can redo?
     * @returns {boolean}
     */
    canRedo() {
        return this.head < this.operations.length;
    }
    
    /**
     * Get next undo operation
     * @returns {Object|null}
     */
    getUndoOperation() {
        if (!this.canUndo()) return null;
        return this.operations[this.head - 1];
    }
    
    /**
     * Get next redo operation
     * @returns {Object|null}
     */
    getRedoOperation() {
        if (!this.canRedo()) return null;
        return this.operations[this.head];
    }
    
    /**
     * Move head back (after applying undo)
     */
    commitUndo() {
        if (this.canUndo()) {
            this.head--;
            this.stats.undoCount++;
        }
    }
    
    /**
     * Move head forward (after applying redo)
     */
    commitRedo() {
        if (this.canRedo()) {
            this.head++;
            this.stats.redoCount++;
        }
    }
    
    /**
     * Find nearest snapshot before given operation index
     * @param {number} opIndex 
     * @returns {ChunkSnapshot|null}
     */
    findNearestSnapshot(opIndex) {
        let best = this.baseSnapshot;
        
        for (const snapshot of this.snapshots) {
            if (snapshot.opIndex <= opIndex) {
                best = snapshot;
            } else {
                break;
            }
        }
        
        return best;
    }
    
    /**
     * Rollback to specific operation index
     * @param {number} targetOpIndex 
     * @param {Uint8Array} currentVoxels 
     * @param {Map} currentEntities 
     * @returns {{voxels: Uint8Array, entities: Map}}
     */
    rollbackToIndex(targetOpIndex, currentVoxels, currentEntities) {
        // Find nearest snapshot
        const snapshot = this.findNearestSnapshot(targetOpIndex);
        
        let voxels = snapshot ? snapshot.getVoxels() : new Uint8Array(currentVoxels);
        let entities = snapshot ? snapshot.getEntities() : new Map(currentEntities);
        
        const startOp = snapshot ? snapshot.opIndex : 0;
        
        // Replay operations from snapshot to target
        for (let i = startOp; i < targetOpIndex && i < this.operations.length; i++) {
            const op = this.operations[i];
            if (op.apply) {
                if (op.type < 0x10) {
                    op.apply(voxels);
                } else {
                    op.apply(entities);
                }
            }
        }
        
        this.head = targetOpIndex;
        
        return { voxels, entities };
    }
    
    /**
     * Rollback to specific timestamp
     * @param {number} timestamp 
     * @param {Uint8Array} currentVoxels 
     * @param {Map} currentEntities 
     * @returns {{voxels: Uint8Array, entities: Map}}
     */
    rollbackToTime(timestamp, currentVoxels, currentEntities) {
        // Find operation index at timestamp
        let targetIndex = 0;
        for (let i = 0; i < this.operations.length; i++) {
            if (this.operations[i].timestamp <= timestamp) {
                targetIndex = i + 1;
            } else {
                break;
            }
        }
        
        return this.rollbackToIndex(targetIndex, currentVoxels, currentEntities);
    }
    
    /**
     * Prune old operations beyond limit
     * @private
     */
    _pruneOldOperations() {
        if (this.operations.length <= this.maxOps) return;
        
        const removeCount = this.operations.length - this.maxOps;
        
        // Find earliest snapshot we can keep
        let minSnapshotIndex = removeCount;
        for (const snapshot of this.snapshots) {
            if (snapshot.opIndex >= removeCount) {
                minSnapshotIndex = Math.min(minSnapshotIndex, snapshot.opIndex);
                break;
            }
        }
        
        // Actually remove operations
        const actualRemove = Math.min(removeCount, minSnapshotIndex);
        if (actualRemove > 0) {
            this.operations = this.operations.slice(actualRemove);
            this.head -= actualRemove;
            
            // Adjust snapshot indices
            for (const snapshot of this.snapshots) {
                snapshot.opIndex -= actualRemove;
            }
            this.snapshots = this.snapshots.filter(s => s.opIndex >= 0);
        }
    }
    
    /**
     * Prune by retention time
     */
    pruneByTime() {
        const cutoff = Date.now() - this.retentionMs;
        
        let pruneToIndex = 0;
        for (let i = 0; i < this.operations.length; i++) {
            if (this.operations[i].timestamp < cutoff) {
                pruneToIndex = i + 1;
            } else {
                break;
            }
        }
        
        if (pruneToIndex > 0 && pruneToIndex < this.head) {
            this.operations = this.operations.slice(pruneToIndex);
            this.head -= pruneToIndex;
            
            for (const snapshot of this.snapshots) {
                snapshot.opIndex -= pruneToIndex;
            }
            this.snapshots = this.snapshots.filter(s => s.opIndex >= 0);
        }
    }
    
    /**
     * Get history as list of events
     * @returns {Array}
     */
    getHistory() {
        return this.operations.map((op, idx) => ({
            index: idx,
            type: op.type,
            timestamp: op.timestamp,
            playerId: op.playerId,
            isCurrent: idx === this.head - 1,
        }));
    }
    
    /**
     * Get memory usage
     * @returns {number}
     */
    getMemoryUsage() {
        let size = 100;  // Base overhead
        size += this.operations.length * 20;  // Estimate per op
        
        for (const snapshot of this.snapshots) {
            size += snapshot.getMemoryUsage();
        }
        
        if (this.baseSnapshot) {
            size += this.baseSnapshot.getMemoryUsage();
        }
        
        return size;
    }
    
    /**
     * Serialize for storage
     */
    serialize() {
        return {
            chunkKey: this.chunkKey,
            head: this.head,
            operations: this.operations.map(op => op.serialize()),
            snapshots: this.snapshots.map(s => s.serialize()),
            baseSnapshot: this.baseSnapshot ? this.baseSnapshot.serialize() : null,
            stats: this.stats,
        };
    }
    
    /**
     * Deserialize from storage
     */
    static deserialize(data, options = {}) {
        const history = new ChunkHistory(data.chunkKey, options);
        history.head = data.head;
        history.stats = data.stats;
        
        // Deserialize operations
        history.operations = data.operations.map(opData => {
            switch (opData.t) {
                case OP_VOXEL_SET:
                    return VoxelOperation.deserialize(opData);
                case OP_VOXEL_FILL:
                    return FillOperation.deserialize(opData);
                case OP_ENTITY_SPAWN:
                    return EntitySpawnOperation.deserialize(opData);
                case OP_ENTITY_DESPAWN:
                    return EntityDespawnOperation.deserialize(opData);
                case OP_ENTITY_MOVE:
                    return EntityMoveOperation.deserialize(opData);
                default:
                    console.warn(`Unknown operation type: ${opData.t}`);
                    return null;
            }
        }).filter(Boolean);
        
        // Deserialize snapshots
        history.snapshots = data.snapshots.map(s => ChunkSnapshot.deserialize(s));
        
        if (data.baseSnapshot) {
            history.baseSnapshot = ChunkSnapshot.deserialize(data.baseSnapshot);
        }
        
        return history;
    }
}

// ============================================================================
// HISTORY MANAGER - Manages history for all chunks
// ============================================================================

/**
 * HistoryManager - Global history management
 */
export class HistoryManager {
    constructor(options = {}) {
        this.histories = new Map();  // chunkKey → ChunkHistory
        this.options = options;
        
        this.globalStats = {
            totalOps: 0,
            totalUndos: 0,
            totalRedos: 0,
            chunksWithHistory: 0,
        };
    }
    
    /**
     * Get or create history for chunk
     * @param {string} chunkKey 
     * @returns {ChunkHistory}
     */
    getHistory(chunkKey) {
        if (!this.histories.has(chunkKey)) {
            this.histories.set(chunkKey, new ChunkHistory(chunkKey, this.options));
            this.globalStats.chunksWithHistory++;
        }
        return this.histories.get(chunkKey);
    }
    
    /**
     * Record voxel change
     */
    recordVoxelChange(chunkKey, index, oldValue, newValue, playerId = 0) {
        this.getHistory(chunkKey).recordVoxelChange(index, oldValue, newValue, playerId);
        this.globalStats.totalOps++;
    }
    
    /**
     * Record entity spawn
     */
    recordEntitySpawn(chunkKey, entityId, entityData, playerId = 0) {
        this.getHistory(chunkKey).recordEntitySpawn(entityId, entityData, playerId);
        this.globalStats.totalOps++;
    }
    
    /**
     * Record entity despawn
     */
    recordEntityDespawn(chunkKey, entityId, entityData, playerId = 0) {
        this.getHistory(chunkKey).recordEntityDespawn(entityId, entityData, playerId);
        this.globalStats.totalOps++;
    }
    
    /**
     * Undo last operation in chunk
     * @param {string} chunkKey 
     * @param {Uint8Array} voxels 
     * @param {Map} entities 
     * @returns {{success: boolean, voxels: Uint8Array, entities: Map}}
     */
    undo(chunkKey, voxels, entities) {
        const history = this.histories.get(chunkKey);
        if (!history || !history.canUndo()) {
            return { success: false, voxels, entities };
        }
        
        const op = history.getUndoOperation();
        
        // Apply revert
        const newVoxels = new Uint8Array(voxels);
        const newEntities = new Map(entities);
        
        if (op.type < 0x10) {
            op.revert(newVoxels);
        } else {
            op.revert(newEntities);
        }
        
        history.commitUndo();
        this.globalStats.totalUndos++;
        
        return { success: true, voxels: newVoxels, entities: newEntities };
    }
    
    /**
     * Redo operation in chunk
     */
    redo(chunkKey, voxels, entities) {
        const history = this.histories.get(chunkKey);
        if (!history || !history.canRedo()) {
            return { success: false, voxels, entities };
        }
        
        const op = history.getRedoOperation();
        
        const newVoxels = new Uint8Array(voxels);
        const newEntities = new Map(entities);
        
        if (op.type < 0x10) {
            op.apply(newVoxels);
        } else {
            op.apply(newEntities);
        }
        
        history.commitRedo();
        this.globalStats.totalRedos++;
        
        return { success: true, voxels: newVoxels, entities: newEntities };
    }
    
    /**
     * Rollback chunk to timestamp
     */
    rollbackToTime(chunkKey, timestamp, voxels, entities) {
        const history = this.histories.get(chunkKey);
        if (!history) {
            return { voxels, entities };
        }
        
        return history.rollbackToTime(timestamp, voxels, entities);
    }
    
    /**
     * Create snapshot for chunk
     */
    createSnapshot(chunkKey, voxels, entities) {
        const history = this.getHistory(chunkKey);
        history.createSnapshot(voxels, entities);
    }
    
    /**
     * Prune old history
     */
    pruneAll() {
        for (const history of this.histories.values()) {
            history.pruneByTime();
        }
    }
    
    /**
     * Clear history for chunk
     */
    clearHistory(chunkKey) {
        this.histories.delete(chunkKey);
        this.globalStats.chunksWithHistory = this.histories.size;
    }
    
    /**
     * Get total memory usage
     */
    getMemoryUsage() {
        let total = 0;
        for (const history of this.histories.values()) {
            total += history.getMemoryUsage();
        }
        return total;
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.globalStats,
            memoryUsage: this.getMemoryUsage(),
        };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
    ChunkHistory,
    ChunkSnapshot,
    VoxelOperation,
    FillOperation,
    EntitySpawnOperation,
    EntityDespawnOperation,
    EntityMoveOperation,
    OP_VOXEL_SET,
    OP_VOXEL_FILL,
    OP_ENTITY_SPAWN,
    OP_ENTITY_DESPAWN,
    OP_ENTITY_MOVE,
};

export default {
    HistoryManager,
    ChunkHistory,
};
