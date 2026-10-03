/**
 * TreePhysics.js - Teardown-style Tree Physics System
 * 
 * Features:
 * - Trees must spawn on solid ground (validated placement)
 * - Root connection tracking (trees anchored at base)
 * - Structural integrity - cut trees fall realistically
 * - Physics body conversion when disconnected
 * 
 * Based on Teardown's structural integrity system where objects
 * fall when disconnected from anchors (ground).
 */

import { MATERIAL } from '../../voxel/MaterialSchema.js';
import { StructuralIntegritySolver, StructuralNode, ANCHOR_TYPE } from './StructuralIntegrity.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Wood material properties */
const WOOD_DENSITY = 600;  // kg/m³
const WOOD_STRENGTH = 0.6;

/** Root anchor depth (blocks below surface) */
const ROOT_DEPTH = 2;

/** Minimum solid blocks needed for valid tree placement */
const MIN_GROUND_BLOCKS = 4;

/** Physics conversion settings */
const FALL_VELOCITY_INITIAL = 0.5;  // m/s
const GRAVITY = 9.81;
const ROTATION_DAMPING = 0.98;

// ============================================================================
// TREE VOXEL DATA
// ============================================================================

/**
 * Represents a tree's voxel structure for physics
 */
export class TreeVoxelBody {
    constructor(treeId, origin, voxels) {
        this.id = treeId;
        this.origin = [...origin];  // World position of tree base
        this.voxels = voxels;       // Array of {x, y, z, material} relative to origin
        
        // Physics state
        this.isAnchored = true;     // Connected to ground?
        this.isFalling = false;     // Currently falling?
        this.isDestroyed = false;   // Fully destroyed?
        
        // Physics properties
        this.position = [...origin];
        this.velocity = [0, 0, 0];
        this.rotation = [0, 0, 0];       // Euler angles
        this.angularVelocity = [0, 0, 0];
        
        // Calculated properties
        this.mass = 0;
        this.centerOfMass = [0, 0, 0];
        this.boundingBox = { min: [0, 0, 0], max: [0, 0, 0] };
        
        // Root voxels (bottom layer, anchored to ground)
        this.rootVoxels = [];
        
        this._calculateProperties();
    }
    
    /**
     * Calculate mass, center of mass, bounding box
     */
    _calculateProperties() {
        if (this.voxels.length === 0) return;
        
        let totalMass = 0;
        let comX = 0, comY = 0, comZ = 0;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let minLocalY = Infinity;
        
        // First pass: find min Y (ground level)
        for (const v of this.voxels) {
            minLocalY = Math.min(minLocalY, v.y);
        }
        
        // Second pass: calculate properties and identify roots
        for (const v of this.voxels) {
            const voxelMass = WOOD_DENSITY * 1.0;  // 1m³ per voxel
            totalMass += voxelMass;
            
            comX += v.x * voxelMass;
            comY += v.y * voxelMass;
            comZ += v.z * voxelMass;
            
            minX = Math.min(minX, v.x);
            minY = Math.min(minY, v.y);
            minZ = Math.min(minZ, v.z);
            maxX = Math.max(maxX, v.x);
            maxY = Math.max(maxY, v.y);
            maxZ = Math.max(maxZ, v.z);
            
            // Root voxels are at or near ground level
            if (v.y <= minLocalY + ROOT_DEPTH) {
                this.rootVoxels.push(v);
            }
        }
        
        this.mass = totalMass;
        if (totalMass > 0) {
            this.centerOfMass = [comX / totalMass, comY / totalMass, comZ / totalMass];
        }
        this.boundingBox = {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ]
        };
    }
    
    /**
     * Check if tree has valid root connection to ground
     * @param {Function} isBlockSolid - Function(worldX, worldY, worldZ) => boolean
     */
    checkRootConnection(isBlockSolid) {
        if (this.rootVoxels.length === 0) {
            this.isAnchored = false;
            return false;
        }
        
        let solidRoots = 0;
        
        for (const root of this.rootVoxels) {
            const worldX = this.origin[0] + root.x;
            const worldY = this.origin[1] + root.y - 1;  // Block below root
            const worldZ = this.origin[2] + root.z;
            
            if (isBlockSolid(worldX, worldY, worldZ)) {
                solidRoots++;
            }
        }
        
        // Need at least some roots connected to solid ground
        this.isAnchored = solidRoots >= Math.min(MIN_GROUND_BLOCKS, this.rootVoxels.length);
        return this.isAnchored;
    }
    
    /**
     * Start falling (called when disconnected from ground)
     */
    startFalling() {
        if (this.isFalling || this.isDestroyed) return;
        
        this.isAnchored = false;
        this.isFalling = true;
        
        // Initial velocity - slight downward
        this.velocity = [0, -FALL_VELOCITY_INITIAL, 0];
        
        // Random rotation based on center of mass offset
        const comOffset = [
            this.centerOfMass[0],
            this.centerOfMass[1],
            this.centerOfMass[2]
        ];
        
        // Tree tends to fall in direction opposite to COM offset from base
        const fallAngle = Math.atan2(comOffset[0], comOffset[2]);
        this.angularVelocity = [
            Math.cos(fallAngle) * 0.5,
            0,
            Math.sin(fallAngle) * 0.5
        ];
        
        console.log(`[TreePhysics] Tree ${this.id} started falling`);
    }
    
    /**
     * Update physics simulation
     * @param {number} dt - Delta time in seconds
     * @param {Function} isBlockSolid - Collision check function
     */
    update(dt, isBlockSolid) {
        if (!this.isFalling || this.isDestroyed) return;
        
        // Apply gravity
        this.velocity[1] -= GRAVITY * dt;
        
        // Update position
        this.position[0] += this.velocity[0] * dt;
        this.position[1] += this.velocity[1] * dt;
        this.position[2] += this.velocity[2] * dt;
        
        // Update rotation
        this.rotation[0] += this.angularVelocity[0] * dt;
        this.rotation[2] += this.angularVelocity[2] * dt;
        
        // Dampen angular velocity
        this.angularVelocity[0] *= ROTATION_DAMPING;
        this.angularVelocity[2] *= ROTATION_DAMPING;
        
        // Ground collision check
        const groundY = this._findGroundY(isBlockSolid);
        if (this.position[1] <= groundY) {
            this.position[1] = groundY;
            this.velocity[1] = 0;
            
            // Stop if mostly upright and slow
            const speed = Math.sqrt(
                this.velocity[0] ** 2 + 
                this.velocity[1] ** 2 + 
                this.velocity[2] ** 2
            );
            const rotSpeed = Math.sqrt(
                this.angularVelocity[0] ** 2 + 
                this.angularVelocity[2] ** 2
            );
            
            if (speed < 0.1 && rotSpeed < 0.1) {
                this.isFalling = false;
                this._settleOnGround();
            }
        }
    }
    
    /**
     * Find ground Y level at current position
     */
    _findGroundY(isBlockSolid) {
        const baseX = Math.floor(this.position[0]);
        const baseZ = Math.floor(this.position[2]);
        
        // Scan downward to find ground
        for (let y = Math.floor(this.position[1]); y > -128; y--) {
            if (isBlockSolid(baseX, y, baseZ)) {
                return y + 1;
            }
        }
        return -128;
    }
    
    /**
     * Called when tree settles on ground after falling
     */
    _settleOnGround() {
        console.log(`[TreePhysics] Tree ${this.id} settled at`, this.position);
        // Could trigger particle effects, sound, etc.
    }
    
    /**
     * Get world positions of all voxels (accounting for physics transform)
     */
    getTransformedVoxels() {
        const result = [];
        const cos = Math.cos;
        const sin = Math.sin;
        
        // Rotation matrices (simplified - just X and Z rotation for tree tilt)
        const rx = this.rotation[0];
        const rz = this.rotation[2];
        
        for (const v of this.voxels) {
            // Translate to origin, rotate, translate back
            let x = v.x - this.centerOfMass[0];
            let y = v.y - this.centerOfMass[1];
            let z = v.z - this.centerOfMass[2];
            
            // Rotate around X axis
            const y1 = y * cos(rx) - z * sin(rx);
            const z1 = y * sin(rx) + z * cos(rx);
            y = y1;
            z = z1;
            
            // Rotate around Z axis
            const x2 = x * cos(rz) - y * sin(rz);
            const y2 = x * sin(rz) + y * cos(rz);
            x = x2;
            y = y2;
            
            // Translate back and apply position offset
            result.push({
                x: Math.round(this.position[0] + x + this.centerOfMass[0]),
                y: Math.round(this.position[1] + y + this.centerOfMass[1]),
                z: Math.round(this.position[2] + z + this.centerOfMass[2]),
                material: v.material
            });
        }
        
        return result;
    }
}

// ============================================================================
// TREE PHYSICS SYSTEM
// ============================================================================

/**
 * Manages all tree physics in the world
 */
export class TreePhysicsSystem {
    constructor(options = {}) {
        this.trees = new Map();  // treeId -> TreeVoxelBody
        this.nextTreeId = 1;
        
        // Configuration
        this.config = {
            checkInterval: options.checkInterval || 500,  // ms between integrity checks
            maxFallingTrees: options.maxFallingTrees || 50,
            enablePhysics: options.enablePhysics !== false,
            ...options
        };
        
        // World reference (set externally)
        this.chunkManager = null;
        
        // Callbacks
        this.onTreeFall = null;      // Called when tree starts falling
        this.onTreeSettle = null;    // Called when tree lands
        this.onTreeDestroy = null;   // Called when tree is destroyed
        
        // Stats
        this.stats = {
            totalTrees: 0,
            anchoredTrees: 0,
            fallingTrees: 0,
            settledTrees: 0,
        };
        
        this._lastCheck = 0;
    }
    
    /**
     * Set chunk manager reference for world queries
     */
    setChunkManager(chunkManager) {
        this.chunkManager = chunkManager;
    }
    
    /**
     * Check if a world position has solid ground
     */
    isBlockSolid(x, y, z) {
        if (!this.chunkManager) return false;
        
        const material = this.chunkManager.getVoxel(
            Math.floor(x), 
            Math.floor(y), 
            Math.floor(z)
        );
        
        // Solid materials (not air, water, etc.)
        return material !== MATERIAL.AIR && 
               material !== MATERIAL.WATER &&
               material !== undefined;
    }
    
    /**
     * Validate tree placement location
     * @returns {Object} { valid: boolean, surfaceY: number, reason: string }
     */
    validateTreePlacement(x, z, minY = -64, maxY = 256) {
        // Find surface Y
        let surfaceY = null;
        
        for (let y = maxY; y >= minY; y--) {
            if (this.isBlockSolid(x, y, z)) {
                surfaceY = y + 1;  // Place on top of solid
                break;
            }
        }
        
        if (surfaceY === null) {
            return { valid: false, surfaceY: 0, reason: 'No solid ground found' };
        }
        
        // Check for enough solid blocks around base
        let solidCount = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (this.isBlockSolid(x + dx, surfaceY - 1, z + dz)) {
                    solidCount++;
                }
            }
        }
        
        if (solidCount < MIN_GROUND_BLOCKS) {
            return { 
                valid: false, 
                surfaceY, 
                reason: `Not enough solid ground (${solidCount}/${MIN_GROUND_BLOCKS})` 
            };
        }
        
        // Check it's not underwater
        if (this.isWater(x, surfaceY, z)) {
            return { valid: false, surfaceY, reason: 'Location is underwater' };
        }
        
        return { valid: true, surfaceY, reason: 'OK' };
    }
    
    /**
     * Check if position is underwater
     */
    isWater(x, y, z) {
        if (!this.chunkManager) return false;
        const material = this.chunkManager.getVoxel(
            Math.floor(x), 
            Math.floor(y), 
            Math.floor(z)
        );
        return material === MATERIAL.WATER;
    }
    
    /**
     * Register a tree for physics tracking
     * @param {Array} origin - [x, y, z] world position of tree base
     * @param {Array} voxels - Array of {x, y, z, material} relative to origin
     * @returns {TreeVoxelBody}
     */
    registerTree(origin, voxels) {
        const id = this.nextTreeId++;
        const tree = new TreeVoxelBody(id, origin, voxels);
        
        // Initial root check
        tree.checkRootConnection((x, y, z) => this.isBlockSolid(x, y, z));
        
        this.trees.set(id, tree);
        this._updateStats();
        
        console.log(`[TreePhysics] Registered tree ${id} at`, origin, 
            `anchored=${tree.isAnchored}, roots=${tree.rootVoxels.length}`);
        
        return tree;
    }
    
    /**
     * Remove a tree from tracking
     */
    unregisterTree(treeId) {
        this.trees.delete(treeId);
        this._updateStats();
    }
    
    /**
     * Called when voxels are modified - check affected trees
     * @param {Array} positions - Array of [x, y, z] modified positions
     */
    onVoxelsModified(positions) {
        // Find trees that might be affected
        for (const tree of this.trees.values()) {
            if (tree.isFalling || tree.isDestroyed) continue;
            
            // Check if any modified position is near tree roots
            let affected = false;
            for (const pos of positions) {
                for (const root of tree.rootVoxels) {
                    const rootWorld = [
                        tree.origin[0] + root.x,
                        tree.origin[1] + root.y,
                        tree.origin[2] + root.z
                    ];
                    
                    const dist = Math.abs(pos[0] - rootWorld[0]) +
                                 Math.abs(pos[1] - rootWorld[1]) +
                                 Math.abs(pos[2] - rootWorld[2]);
                    
                    if (dist <= 2) {
                        affected = true;
                        break;
                    }
                }
                if (affected) break;
            }
            
            if (affected) {
                // Re-check root connection
                const wasAnchored = tree.isAnchored;
                tree.checkRootConnection((x, y, z) => this.isBlockSolid(x, y, z));
                
                if (wasAnchored && !tree.isAnchored) {
                    // Tree lost its anchor - start falling!
                    tree.startFalling();
                    if (this.onTreeFall) {
                        this.onTreeFall(tree);
                    }
                }
            }
        }
        
        this._updateStats();
    }
    
    /**
     * Update physics simulation
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.config.enablePhysics) return;
        
        const now = performance.now();
        
        // Periodic integrity check for all trees
        if (now - this._lastCheck > this.config.checkInterval) {
            this._lastCheck = now;
            this._checkAllTrees();
        }
        
        // Update falling trees
        let fallingCount = 0;
        for (const tree of this.trees.values()) {
            if (tree.isFalling) {
                tree.update(dt, (x, y, z) => this.isBlockSolid(x, y, z));
                fallingCount++;
                
                // Check if settled
                if (!tree.isFalling && this.onTreeSettle) {
                    this.onTreeSettle(tree);
                }
            }
        }
        
        this.stats.fallingTrees = fallingCount;
    }
    
    /**
     * Check all trees for root connection
     */
    _checkAllTrees() {
        for (const tree of this.trees.values()) {
            if (tree.isFalling || tree.isDestroyed) continue;
            
            const wasAnchored = tree.isAnchored;
            tree.checkRootConnection((x, y, z) => this.isBlockSolid(x, y, z));
            
            if (wasAnchored && !tree.isAnchored) {
                tree.startFalling();
                if (this.onTreeFall) {
                    this.onTreeFall(tree);
                }
            }
        }
        
        this._updateStats();
    }
    
    /**
     * Update statistics
     */
    _updateStats() {
        this.stats.totalTrees = this.trees.size;
        this.stats.anchoredTrees = 0;
        this.stats.fallingTrees = 0;
        this.stats.settledTrees = 0;
        
        for (const tree of this.trees.values()) {
            if (tree.isAnchored) this.stats.anchoredTrees++;
            if (tree.isFalling) this.stats.fallingTrees++;
            if (!tree.isAnchored && !tree.isFalling && !tree.isDestroyed) {
                this.stats.settledTrees++;
            }
        }
    }
    
    /**
     * Get all falling trees for rendering
     */
    getFallingTrees() {
        const result = [];
        for (const tree of this.trees.values()) {
            if (tree.isFalling) {
                result.push(tree);
            }
        }
        return result;
    }
    
    /**
     * Force a tree to fall (for testing or player actions)
     */
    forceTreeFall(treeId) {
        const tree = this.trees.get(treeId);
        if (tree && !tree.isFalling) {
            tree.startFalling();
            if (this.onTreeFall) {
                this.onTreeFall(tree);
            }
        }
    }
    
    /**
     * Get debug info
     */
    getDebugInfo() {
        return {
            ...this.stats,
            treeList: [...this.trees.values()].map(t => ({
                id: t.id,
                position: t.position,
                isAnchored: t.isAnchored,
                isFalling: t.isFalling,
                rootCount: t.rootVoxels.length,
                voxelCount: t.voxels.length,
            }))
        };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default TreePhysicsSystem;
