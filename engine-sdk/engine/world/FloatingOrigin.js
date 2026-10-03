// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FloatingOrigin.js - Coordinate Precision Management for Infinite Worlds
 * 
 * Problem: 32-bit floats lose precision at large distances (>100k units).
 * At 100,000 units from origin, precision drops to ~0.01, causing:
 * - Visible jitter in movement
 * - Physics glitches (falling through floors)
 * - Rendering artifacts
 * 
 * Solution: Track absolute position with high precision (integers + fraction),
 * but render everything relative to a "local origin" near the player.
 * When player moves too far from local origin, rebase (shift everything back).
 * 
 * Extended: Now integrates with HierarchicalCoords for planet-scale support.
 * Sector-based addressing allows unlimited range while maintaining f32 precision.
 */

import { HierarchicalPosition, SECTOR_SIZE } from './HierarchicalCoords.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Distance from local origin at which to trigger a rebase (in world units) */
export const REBASE_THRESHOLD = 4096;

/** Chunk size for coordinate snapping during rebase */
export const REBASE_SNAP = 32; // Snap to chunk boundaries for cleaner math

/** Sector-based rebase threshold (rebase when crossing sector boundaries) */
export const SECTOR_REBASE_THRESHOLD = SECTOR_SIZE * 0.4; // 40% of sector size

// Prepared tokens are owned by one origin and consumed once. The synchronous
// legacy rebase path stays available for callers without an async native world.
const preparedRebases = new WeakMap();
const hierarchyFields = ['sectorX', 'sectorY', 'sectorZ', 'localX', 'localY', 'localZ'];
const originWritable = (origin, name) => {
    const field = Object.getOwnPropertyDescriptor(origin, name);
    if (!field || !('value' in field) || !field.writable) throw new TypeError(`Prepared origin ${name} must be writable owned data`);
    return field.value;
};

// ============================================================================
// FLOATING ORIGIN CLASS
// ============================================================================

export class FloatingOrigin {
    constructor() {
        // Absolute position tracked as integer + fractional parts
        // This gives us effectively infinite range with sub-unit precision
        // Integer part: whole units (can be arbitrarily large with BigInt fallback)
        // Fractional part: sub-unit position (0.0 to 1.0)
        this.absoluteX = 0;
        this.absoluteY = 0;
        this.absoluteZ = 0;
        
        // Local origin offset (subtracted from absolute to get render coords)
        // When we rebase, we add to this and subtract from all world objects
        this.originX = 0;
        this.originY = 0;
        this.originZ = 0;
        
        // Hierarchical position for planet-scale support
        this.hierarchicalPos = new HierarchicalPosition(0, 0, 0, 0, 0, 0);
        this.hierarchicalOrigin = new HierarchicalPosition(0, 0, 0, 0, 0, 0);
        this.useHierarchical = false; // Enable for planet-scale worlds
        
        // Rebase threshold
        this.rebaseThreshold = REBASE_THRESHOLD;
        
        // Statistics
        this.totalRebases = 0;
        this.lastRebaseTime = 0;
        
        // Callbacks for when rebase occurs
        this.onRebaseCallbacks = [];
        
        // Callbacks for sector change (planet-scale only)
        this.onSectorChangeCallbacks = [];
    }
    
    /**
     * Set absolute world position
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     */
    setAbsolutePosition(x, y, z) {
        this.absoluteX = x;
        this.absoluteY = y;
        this.absoluteZ = z;
        
        // Sync hierarchical position if enabled
        if (this.useHierarchical) {
            const oldSector = this.hierarchicalPos.getSectorKey();
            this.hierarchicalPos = HierarchicalPosition.fromWorld(x, y, z);
            const newSector = this.hierarchicalPos.getSectorKey();
            
            // Check for sector change
            if (oldSector !== newSector) {
                this._notifySectorChange(oldSector, newSector);
            }
        }
    }
    
    /**
     * Set position using hierarchical coordinates (planet-scale)
     * @param {HierarchicalPosition} hpos 
     */
    setHierarchicalPosition(hpos) {
        const oldSector = this.hierarchicalPos.getSectorKey();
        this.hierarchicalPos.copyFrom(hpos);
        
        // Sync flat coordinates
        const world = hpos.toWorld();
        this.absoluteX = world[0];
        this.absoluteY = world[1];
        this.absoluteZ = world[2];
        
        // Check for sector change
        const newSector = this.hierarchicalPos.getSectorKey();
        if (oldSector !== newSector) {
            this._notifySectorChange(oldSector, newSector);
        }
    }
    
    /**
     * Get the current hierarchical position
     * @returns {HierarchicalPosition}
     */
    getHierarchicalPosition() {
        return this.hierarchicalPos.clone();
    }
    
    /**
     * Get current sector as [x, y, z]
     * @returns {[number, number, number]}
     */
    getCurrentSector() {
        return this.hierarchicalPos.getSector();
    }
    
    /**
     * Get current sector key for lookups
     * @returns {string}
     */
    getCurrentSectorKey() {
        return this.hierarchicalPos.getSectorKey();
    }
    
    /**
     * Get absolute world position (full precision)
     * @returns {[number, number, number]}
     */
    getAbsolutePosition() {
        return [this.absoluteX, this.absoluteY, this.absoluteZ];
    }
    
    /**
     * Get position relative to local origin (for rendering/physics)
     * This is what gets sent to the GPU - always near zero for precision
     * @returns {[number, number, number]}
     */
    getLocalPosition() {
        return [
            this.absoluteX - this.originX,
            this.absoluteY - this.originY,
            this.absoluteZ - this.originZ,
        ];
    }
    
    /**
     * Get the current origin offset
     * @returns {[number, number, number]}
     */
    getOrigin() {
        return [this.originX, this.originY, this.originZ];
    }
    
    /**
     * Convert absolute world coords to local coords
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {[number, number, number]}
     */
    worldToLocal(x, y, z) {
        return [
            x - this.originX,
            y - this.originY,
            z - this.originZ,
        ];
    }
    
    /**
     * Convert local coords back to absolute world coords
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {[number, number, number]}
     */
    localToWorld(x, y, z) {
        return [
            x + this.originX,
            y + this.originY,
            z + this.originZ,
        ];
    }
    
    /**
     * Register a callback for rebase events
     * Callback receives (shiftX, shiftY, shiftZ) - the amounts to subtract from positions
     * @param {Function} callback 
     */
    onRebase(callback) {
        this.onRebaseCallbacks.push(callback);
    }

    /** Prepare an externally selected shift without publishing a new origin.
     * Native consumers may impose a stricter grid alignment than REBASE_SNAP.
     */
    prepareRebase(shift) {
        if (!Array.isArray(shift) || shift.length !== 3 || !shift.every(Number.isFinite)) {
            throw new RangeError('A prepared origin shift must contain three finite metre values');
        }
        if (!Number.isSafeInteger(this.totalRebases) || this.totalRebases < 0 || this.totalRebases === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Origin coordinate epoch is exhausted');
        }
        const previous = this.getOrigin(), next = previous.map((value, axis) => value + shift[axis]);
        if (!previous.every(Number.isFinite) || !next.every(Number.isFinite)
            || next.some((value, axis) => shift[axis] !== 0 && value === previous[axis])) {
            throw new RangeError('Origin shift is not representable; use a hierarchical coordinate epoch');
        }
        for (const name of ['originX', 'originY', 'originZ', 'totalRebases', 'lastRebaseTime', 'hierarchicalOrigin']) originWritable(this, name);
        const mode = this.useHierarchical, hierarchy = this.hierarchicalOrigin;
        if (typeof mode !== 'boolean') throw new TypeError('Hierarchical coordinate mode must be boolean');
        let hierarchyBefore = null, hierarchyNext = null;
        if (mode) {
            if (!(hierarchy instanceof HierarchicalPosition)) throw new RangeError('This prepared protocol requires standard safe hierarchical coordinates');
            hierarchyBefore = hierarchyFields.map(name => hierarchy[name]);
            const normalized = hierarchy.clone();
            if (hierarchyFields.some((name, index) => normalized[name] !== hierarchyBefore[index])
                || normalized.toWorld().some((value, axis) => value !== previous[axis])) throw new RangeError('Flat and hierarchical origins must agree before preparation');
            hierarchyNext = normalized.add(...shift);
            if (hierarchyNext.toWorld().some((value, axis) => value !== next[axis])
                || hierarchyNext.toCameraRelative(hierarchy).some((value, axis) => value !== shift[axis])) {
                throw new RangeError('Prepared hierarchical shift loses local precision');
            }
        }
        const token = Object.freeze({ shift: Object.freeze([...shift]), origin: Object.freeze(next) });
        preparedRebases.set(token, { owner: this, previous, rebases: this.totalRebases, used: false, mode, hierarchy, hierarchyBefore, hierarchyNext });
        return token;
    }

    validatePreparedRebase(token) {
        const state = preparedRebases.get(token);
        if (!state || state.owner !== this || state.used || state.rebases !== this.totalRebases
            || state.previous.some((value, axis) => value !== this.getOrigin()[axis])
            || state.mode !== this.useHierarchical || state.hierarchy !== this.hierarchicalOrigin
            || state.hierarchyBefore?.some((value, index) => value !== this.hierarchicalOrigin[hierarchyFields[index]])) {
            throw new Error('Prepared origin shift is stale, reused, or belongs to another origin');
        }
        for (const name of ['originX', 'originY', 'originZ', 'totalRebases', 'lastRebaseTime', 'hierarchicalOrigin']) originWritable(this, name);
        return true;
    }

    /** Publish only after all participating native commits have succeeded.
     * Callbacks are post-commit notifications, matching performRebase().
     */
    commitPreparedRebase(token) {
        this.validatePreparedRebase(token);
        preparedRebases.get(token).used = true;
        [this.originX, this.originY, this.originZ] = token.origin;
        const hierarchyNext = preparedRebases.get(token).hierarchyNext;
        if (hierarchyNext) this.hierarchicalOrigin = hierarchyNext;
        this.totalRebases++;
        this.lastRebaseTime = performance.now();
        for (const callback of this.onRebaseCallbacks) {
            try { callback(...token.shift); }
            catch (error) { console.error('Rebase callback error:', error); }
        }
        return { rebased: true, shift: [...token.shift], coordinateEpoch: this.totalRebases };
    }
    
    /**
     * Check if rebase is needed and perform it
     * Call this every frame after updating player position
     * @returns {{ rebased: boolean, shift: [number, number, number] }}
     */
    checkRebase() {
        const localPos = this.getLocalPosition();
        const distSq = localPos[0] * localPos[0] + 
                       localPos[1] * localPos[1] + 
                       localPos[2] * localPos[2];
        
        if (distSq > this.rebaseThreshold * this.rebaseThreshold) {
            return this.performRebase();
        }
        
        return { rebased: false, shift: [0, 0, 0] };
    }
    
    /**
     * Force a rebase to bring local origin to player position
     * @returns {{ rebased: boolean, shift: [number, number, number] }}
     */
    performRebase() {
        // Calculate shift amount (snap to chunk boundaries for cleaner math)
        const shiftX = Math.floor(this.absoluteX / REBASE_SNAP) * REBASE_SNAP - this.originX;
        const shiftY = Math.floor(this.absoluteY / REBASE_SNAP) * REBASE_SNAP - this.originY;
        const shiftZ = Math.floor(this.absoluteZ / REBASE_SNAP) * REBASE_SNAP - this.originZ;
        
        // Skip if shift is negligible
        if (Math.abs(shiftX) < REBASE_SNAP && 
            Math.abs(shiftY) < REBASE_SNAP && 
            Math.abs(shiftZ) < REBASE_SNAP) {
            return { rebased: false, shift: [0, 0, 0] };
        }
        
        // Update origin
        this.originX += shiftX;
        this.originY += shiftY;
        this.originZ += shiftZ;
        
        // Stats
        this.totalRebases++;
        this.lastRebaseTime = performance.now();
        
        // Notify all registered callbacks
        const shift = [shiftX, shiftY, shiftZ];
        for (const callback of this.onRebaseCallbacks) {
            try {
                callback(shiftX, shiftY, shiftZ);
            } catch (e) {
                console.error('Rebase callback error:', e);
            }
        }
        
        return { rebased: true, shift };
    }
    
    /**
     * Get depth (negative Y in absolute coords)
     * Useful for depth-based game mechanics
     * @returns {number} Depth below Y=0 (positive = deeper)
     */
    getDepth() {
        return -this.absoluteY;
    }
    
    /**
     * Get depth tier based on absolute Y position
     * @returns {{ tier: number, name: string, ratio: number }}
     */
    getDepthTier() {
        const depth = this.getDepth();
        
        // Define depth tiers (in world units below Y=0)
        const tiers = [
            { maxDepth: 100, name: 'Surface', tier: 0 },
            { maxDepth: 500, name: 'Underground', tier: 1 },
            { maxDepth: 2000, name: 'Deep', tier: 2 },
            { maxDepth: 5000, name: 'Abyss', tier: 3 },
            { maxDepth: 10000, name: 'Void', tier: 4 },
            { maxDepth: Infinity, name: 'Core', tier: 5 },
        ];
        
        let prevMax = 0;
        for (const t of tiers) {
            if (depth < t.maxDepth) {
                const ratio = (depth - prevMax) / (t.maxDepth - prevMax);
                return { tier: t.tier, name: t.name, ratio: Math.min(1, Math.max(0, ratio)) };
            }
            prevMax = t.maxDepth;
        }
        
        return { tier: 5, name: 'Core', ratio: 1.0 };
    }
    
    /**
     * Debug info
     * @returns {string}
     */
    getDebugInfo() {
        const abs = this.getAbsolutePosition();
        const local = this.getLocalPosition();
        const tier = this.getDepthTier();
        
        return `Abs: (${abs[0].toFixed(1)}, ${abs[1].toFixed(1)}, ${abs[2].toFixed(1)}) | ` +
               `Local: (${local[0].toFixed(1)}, ${local[1].toFixed(1)}, ${local[2].toFixed(1)}) | ` +
               `Origin: (${this.originX}, ${this.originY}, ${this.originZ}) | ` +
               `Depth: ${tier.name} (${this.getDepth().toFixed(0)}m) | ` +
               `Rebases: ${this.totalRebases}`;
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [floating_origin] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.rebaseThreshold = parseFloat(cfg.rebase_threshold) || 5000;
        this.rebaseEntities = cfg.rebase_entities !== false;
        this.useHierarchical = cfg.use_hierarchical === true || cfg.planet_scale === true;
    }
    
    // ========================================================================
    // HIERARCHICAL COORDINATE METHODS (Planet-Scale Support)
    // ========================================================================
    
    /**
     * Enable hierarchical (planet-scale) coordinate mode
     * @param {boolean} enable 
     */
    setHierarchicalMode(enable) {
        this.useHierarchical = enable;
        if (enable) {
            // Sync hierarchical position from current absolute position
            this.hierarchicalPos = HierarchicalPosition.fromWorld(
                this.absoluteX, this.absoluteY, this.absoluteZ
            );
            this.hierarchicalOrigin = HierarchicalPosition.fromWorld(
                this.originX, this.originY, this.originZ
            );
        }
    }
    
    /**
     * Register callback for sector changes
     * Callback receives (oldSectorKey, newSectorKey, sectorDelta)
     * @param {Function} callback 
     */
    onSectorChange(callback) {
        this.onSectorChangeCallbacks.push(callback);
    }
    
    /**
     * Internal: Notify sector change listeners
     * @param {string} oldSector 
     * @param {string} newSector 
     */
    _notifySectorChange(oldSector, newSector) {
        const oldCoords = oldSector.split(',').map(Number);
        const newCoords = newSector.split(',').map(Number);
        const delta = [
            newCoords[0] - oldCoords[0],
            newCoords[1] - oldCoords[1],
            newCoords[2] - oldCoords[2],
        ];
        
        for (const callback of this.onSectorChangeCallbacks) {
            try {
                callback(oldSector, newSector, delta);
            } catch (e) {
                console.error('Sector change callback error:', e);
            }
        }
    }
    
    /**
     * Get camera-relative position for a world point (GPU-safe f32)
     * Uses hierarchical math for precision at any distance
     * @param {number} worldX 
     * @param {number} worldY 
     * @param {number} worldZ 
     * @returns {[number, number, number]}
     */
    worldToCameraRelative(worldX, worldY, worldZ) {
        if (this.useHierarchical) {
            const worldPos = HierarchicalPosition.fromWorld(worldX, worldY, worldZ);
            return worldPos.toCameraRelative(this.hierarchicalPos);
        }
        // Standard local-space conversion
        return this.worldToLocal(worldX, worldY, worldZ);
    }
    
    /**
     * Convert hierarchical position to camera-relative (GPU-safe f32)
     * @param {HierarchicalPosition} hpos 
     * @returns {[number, number, number]}
     */
    hierarchicalToCameraRelative(hpos) {
        return hpos.toCameraRelative(this.hierarchicalPos);
    }
    
    /**
     * Check if a sector is within render distance
     * @param {string} sectorKey 
     * @param {number} maxSectorDistance - Max sectors away to consider visible
     * @returns {boolean}
     */
    isSectorVisible(sectorKey, maxSectorDistance = 2) {
        const [sx, sy, sz] = sectorKey.split(',').map(Number);
        const [cx, cy, cz] = this.getCurrentSector();
        
        const dx = Math.abs(sx - cx);
        const dy = Math.abs(sy - cy);
        const dz = Math.abs(sz - cz);
        
        return dx <= maxSectorDistance && dy <= maxSectorDistance && dz <= maxSectorDistance;
    }
    
    /**
     * Get all visible sector keys within distance
     * @param {number} sectorRadius 
     * @returns {string[]}
     */
    getVisibleSectors(sectorRadius = 2) {
        const [cx, cy, cz] = this.getCurrentSector();
        const sectors = [];
        
        for (let dx = -sectorRadius; dx <= sectorRadius; dx++) {
            for (let dy = -sectorRadius; dy <= sectorRadius; dy++) {
                for (let dz = -sectorRadius; dz <= sectorRadius; dz++) {
                    sectors.push(`${cx + dx},${cy + dy},${cz + dz}`);
                }
            }
        }
        
        return sectors;
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Shift an array of objects by the rebase offset
 * Objects must have x, y, z properties
 * @param {Array<{x: number, y: number, z: number}>} objects 
 * @param {number} shiftX 
 * @param {number} shiftY 
 * @param {number} shiftZ 
 */
export function shiftObjects(objects, shiftX, shiftY, shiftZ) {
    for (const obj of objects) {
        if (obj && typeof obj.x === 'number') {
            obj.x -= shiftX;
            obj.y -= shiftY;
            obj.z -= shiftZ;
        }
    }
}

/**
 * Shift a position array [x, y, z] by the rebase offset
 * @param {number[]} pos 
 * @param {number} shiftX 
 * @param {number} shiftY 
 * @param {number} shiftZ 
 * @returns {number[]}
 */
export function shiftPosition(pos, shiftX, shiftY, shiftZ) {
    return [
        pos[0] - shiftX,
        pos[1] - shiftY,
        pos[2] - shiftZ,
    ];
}

export default FloatingOrigin;
