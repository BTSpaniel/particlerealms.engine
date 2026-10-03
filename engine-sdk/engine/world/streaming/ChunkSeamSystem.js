// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkSeamSystem.js - Cross-Chunk Structure & Seam Handling
 * 
 * Based on Minecraft's approach:
 * 1. structures_starts: Calculate structure origins and piece layout
 * 2. structures_references: Store references to nearby structures
 * 3. features: Place structure pieces that fall within chunk bounds
 * 
 * KEY CONCEPTS:
 * - Deterministic structure positions (derived from seed + coords)
 * - Structure references allow any chunk to know what extends into it
 * - Meshing waits for neighbors to prevent seam artifacts
 */

import {
    legacyStructureChunkSeed3D,
    legacyStructureHash3D,
    legacyStructurePositionSeed3D,
    legacyStructureSeededHash3D,
} from '../../core/math/MathBits.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const CHUNK_SIZE = 32;
const CHUNK_SIZE_SQ = CHUNK_SIZE * CHUNK_SIZE;

// Structure types that can span chunk boundaries
export const StructureType = {
    TREE: 'tree',
    BUILDING: 'building',
    ORE_VEIN: 'ore_vein',
    CAVE: 'cave',
    DUNGEON: 'dungeon',
};

// Maximum radius structures can extend from their origin (in blocks)
const STRUCTURE_RADII = {
    [StructureType.TREE]: 8,        // Tree canopy radius
    [StructureType.BUILDING]: 32,   // Large buildings
    [StructureType.ORE_VEIN]: 4,    // Ore blob radius
    [StructureType.CAVE]: 16,       // Cave carving radius
    [StructureType.DUNGEON]: 64,    // Dungeon complex
};

// ============================================================================
// DETERMINISTIC HASH FUNCTIONS
// ============================================================================

export function chunkSeamStructureHash3D(x, y, z) {
    return legacyStructureHash3D(x, y, z);
}

export function chunkSeamSeededStructureHash3D(x, y, z, seed) {
    return legacyStructureSeededHash3D(x, y, z, seed);
}

export function chunkSeamChunkSeed3D(cx, cy, cz, seed = 0) {
    return legacyStructureChunkSeed3D(cx, cy, cz, seed);
}

export function chunkSeamPositionSeed3D(x, y, z, seed = 0) {
    return legacyStructurePositionSeed3D(x, y, z, seed);
}

/**
 * Fast deterministic hash for 3D coordinates
 */
function hash3(x, y, z) {
    return chunkSeamStructureHash3D(x, y, z);
}

/**
 * Hash with seed
 */
function hashSeed(x, y, z, seed) {
    return chunkSeamSeededStructureHash3D(x, y, z, seed);
}

/**
 * Seeded random number generator
 */
function seededRandom(seed) {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
}

// ============================================================================
// STRUCTURE REFERENCE
// ============================================================================

/**
 * Reference to a structure that may extend into a chunk
 */
class StructureReference {
    constructor(type, originChunk, worldPos, seed) {
        this.type = type;
        this.originChunk = originChunk;  // {cx, cy, cz} where structure starts
        this.worldPos = worldPos;         // {x, y, z} world position
        this.seed = seed;                 // Deterministic seed for this structure
        this.radius = STRUCTURE_RADII[type] || 8;
        this.placed = false;              // True if already placed in world
    }
    
    /**
     * Check if this structure could extend into the given chunk
     */
    affectsChunk(cx, cy, cz) {
        const chunkMinX = cx * CHUNK_SIZE;
        const chunkMinY = cy * CHUNK_SIZE;
        const chunkMinZ = cz * CHUNK_SIZE;
        const chunkMaxX = chunkMinX + CHUNK_SIZE;
        const chunkMaxY = chunkMinY + CHUNK_SIZE;
        const chunkMaxZ = chunkMinZ + CHUNK_SIZE;
        
        // Check if structure's bounding sphere intersects chunk AABB
        const closestX = Math.max(chunkMinX, Math.min(this.worldPos.x, chunkMaxX));
        const closestY = Math.max(chunkMinY, Math.min(this.worldPos.y, chunkMaxY));
        const closestZ = Math.max(chunkMinZ, Math.min(this.worldPos.z, chunkMaxZ));
        
        const dx = this.worldPos.x - closestX;
        const dy = this.worldPos.y - closestY;
        const dz = this.worldPos.z - closestZ;
        
        return (dx * dx + dy * dy + dz * dz) <= (this.radius * this.radius);
    }
    
    /**
     * Get the key for this structure
     */
    get key() {
        return `${this.type}:${this.worldPos.x},${this.worldPos.y},${this.worldPos.z}`;
    }
}

// ============================================================================
// CHUNK SEAM SYSTEM
// ============================================================================

export class ChunkSeamSystem {
    constructor(options = {}) {
        this.seed = options.seed || 12345;
        
        // Structure references: chunkKey -> Set<StructureReference>
        this.structureRefs = new Map();
        
        // Pending blocks: chunkKey -> [{x, y, z, material, priority}]
        // Blocks from structures that extend into ungenerated chunks
        this.pendingBlocks = new Map();
        
        // Generation state tracking: chunkKey -> GenerationPhase
        this.chunkPhases = new Map();
        
        // Callbacks for structure generation
        this.structureGenerators = new Map();
        
        // External systems
        this.worldGenerator = null;
        this.chunkManager = null;
        
        // Config
        this.config = {
            // How many chunks to check for cross-chunk structures
            structureSearchRadius: 2,
            // Whether to defer meshing until neighbors are ready
            deferMeshingForNeighbors: true,
            // Minimum neighbor phase required before meshing
            minNeighborPhaseForMesh: GenerationPhase.TERRAIN,
        };
    }
    
    /**
     * Initialize with external systems
     */
    init(options = {}) {
        this.worldGenerator = options.worldGenerator;
        this.chunkManager = options.chunkManager;
        this.seed = options.seed || this.seed;
        
        // Register default structure generators
        this._registerDefaultGenerators();
        
        return this;
    }
    
    /**
     * Register default structure generators
     */
    _registerDefaultGenerators() {
        // Tree generator
        this.structureGenerators.set(StructureType.TREE, (ref, chunk) => {
            return this._generateTreeForChunk(ref, chunk);
        });
    }
    
    // ========================================================================
    // GENERATION PHASE TRACKING
    // ========================================================================
    
    /**
     * Set the generation phase for a chunk
     */
    setPhase(cx, cy, cz, phase) {
        const key = `${cx},${cy},${cz}`;
        this.chunkPhases.set(key, phase);
    }
    
    /**
     * Get the generation phase for a chunk
     */
    getPhase(cx, cy, cz) {
        const key = `${cx},${cy},${cz}`;
        return this.chunkPhases.get(key) || GenerationPhase.EMPTY;
    }
    
    /**
     * Check if chunk has reached at least the given phase
     */
    hasReachedPhase(cx, cy, cz, phase) {
        return this.getPhase(cx, cy, cz) >= phase;
    }
    
    /**
     * Check if all 6 face-neighbors have reached the given phase
     * Returns true if neighbor doesn't exist (will remesh when it loads)
     */
    neighborsAtPhase(cx, cy, cz, phase) {
        const neighbors = [
            [cx - 1, cy, cz], [cx + 1, cy, cz],
            [cx, cy - 1, cz], [cx, cy + 1, cz],
            [cx, cy, cz - 1], [cx, cy, cz + 1],
        ];
        
        for (const [nx, ny, nz] of neighbors) {
            const neighborPhase = this.getPhase(nx, ny, nz);
            // Allow meshing if neighbor doesn't exist (EMPTY) - we'll remesh when it loads
            // Only block if neighbor EXISTS but hasn't reached required phase
            if (neighborPhase !== GenerationPhase.EMPTY && neighborPhase < phase) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * Check if chunk can be meshed (neighbors ready)
     * NOTE: We now always allow meshing - gaps are worse than seam artifacts
     * Chunks will remesh when neighbors load to fix any edge issues
     */
    canMesh(cx, cy, cz) {
        // Always allow meshing - we'll remesh when neighbors load
        // This prevents gaps in terrain which look much worse than minor seam issues
        return true;
    }
    
    // ========================================================================
    // STRUCTURE STARTS - Calculate structure origins
    // ========================================================================
    
    /**
     * Calculate all structure starts for a chunk
     * This is deterministic based on seed + chunk coords
     */
    calculateStructureStarts(cx, cy, cz) {
        const starts = [];
        const chunkSeed = this._chunkSeed(cx, cy, cz);
        
        // Calculate tree positions for this chunk
        const trees = this._calculateTreeStarts(cx, cy, cz, chunkSeed);
        starts.push(...trees);
        
        return starts;
    }
    
    /**
     * Calculate deterministic tree positions for a chunk
     */
    _calculateTreeStarts(cx, cy, cz, chunkSeed) {
        const trees = [];
        const originX = cx * CHUNK_SIZE;
        const originY = cy * CHUNK_SIZE;
        const originZ = cz * CHUNK_SIZE;
        
        // Only surface-level chunks get trees
        if (originY < -10 || originY > 100) return trees;
        
        const rng = seededRandom(chunkSeed);
        const step = 8;  // Check every 8 blocks
        
        for (let lz = 0; lz < CHUNK_SIZE; lz += step) {
            for (let lx = 0; lx < CHUNK_SIZE; lx += step) {
                const wx = originX + lx;
                const wz = originZ + lz;
                
                // Deterministic position within grid cell
                const offsetX = Math.floor(rng() * step);
                const offsetZ = Math.floor(rng() * step);
                const treeX = wx + offsetX;
                const treeZ = wz + offsetZ;
                
                // Deterministic density check
                const density = rng();
                if (density > 0.15) continue;  // ~15% chance per grid cell
                
                // Get surface height (need worldGenerator for this)
                let surfaceY = 0;
                if (this.worldGenerator?.getHeight) {
                    surfaceY = Math.floor(this.worldGenerator.getHeight(treeX, treeZ));
                }
                
                // Only if surface is in this chunk
                if (surfaceY < originY || surfaceY >= originY + CHUNK_SIZE) continue;
                
                // Create structure reference
                const treeSeed = this._positionSeed(treeX, surfaceY, treeZ);
                trees.push(new StructureReference(
                    StructureType.TREE,
                    { cx, cy, cz },
                    { x: treeX, y: surfaceY + 1, z: treeZ },
                    treeSeed
                ));
            }
        }
        
        return trees;
    }
    
    // ========================================================================
    // STRUCTURE REFERENCES - Find structures that affect a chunk
    // ========================================================================
    
    /**
     * Get all structure references that may affect a chunk
     * This checks the origin chunk AND all nearby chunks
     */
    getStructureReferences(cx, cy, cz) {
        const key = `${cx},${cy},${cz}`;
        
        // Check cache
        if (this.structureRefs.has(key)) {
            return this.structureRefs.get(key);
        }
        
        const refs = new Set();
        const radius = this.config.structureSearchRadius;
        
        // Check all nearby chunks for structures that could extend here
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    const ncx = cx + dx;
                    const ncy = cy + dy;
                    const ncz = cz + dz;
                    
                    // Get structure starts from neighbor chunk
                    const starts = this.calculateStructureStarts(ncx, ncy, ncz);
                    
                    // Check which ones affect our chunk
                    for (const start of starts) {
                        if (start.affectsChunk(cx, cy, cz)) {
                            refs.add(start);
                        }
                    }
                }
            }
        }
        
        // Cache and return
        this.structureRefs.set(key, refs);
        return refs;
    }
    
    // ========================================================================
    // STRUCTURE PLACEMENT - Place structures in chunks
    // ========================================================================
    
    /**
     * Place all structures that affect a chunk
     * Call this during the STRUCTURES phase
     */
    placeStructures(chunk) {
        const { cx, cy, cz } = chunk;
        const refs = this.getStructureReferences(cx, cy, cz);
        
        for (const ref of refs) {
            const generator = this.structureGenerators.get(ref.type);
            if (generator) {
                generator(ref, chunk);
            }
        }
        
        // Also apply any pending blocks from earlier structure generation
        this._applyPendingBlocks(chunk);
    }
    
    /**
     * Generate tree voxels for a chunk from a structure reference
     */
    _generateTreeForChunk(ref, chunk) {
        if (!this.worldGenerator?.treeGenerator) return;
        
        const { cx, cy, cz } = chunk;
        const originX = cx * CHUNK_SIZE;
        const originY = cy * CHUNK_SIZE;
        const originZ = cz * CHUNK_SIZE;
        
        // Get biome and species
        const biome = this.worldGenerator.getBiome?.(ref.worldPos.x, ref.worldPos.z) || 'forest';
        const species = this.worldGenerator.treeGenerator.getSpeciesForBiome?.(biome) || 'oak';
        
        if (!species) return;
        
        // Generate tree
        const tree = this.worldGenerator.treeGenerator.generateTree(
            ref.worldPos.x,
            ref.worldPos.y,
            ref.worldPos.z,
            species,
            ref.seed
        );
        
        if (!tree || !tree.voxels) return;
        
        // Place voxels that fall within this chunk
        for (const v of tree.voxels) {
            const lx = v.x - originX;
            const ly = v.y - originY;
            const lz = v.z - originZ;
            
            // Check bounds
            if (lx < 0 || lx >= CHUNK_SIZE ||
                ly < 0 || ly >= CHUNK_SIZE ||
                lz < 0 || lz >= CHUNK_SIZE) {
                // Store as pending for other chunks
                this._addPendingBlock(v.x, v.y, v.z, v.material, ref.type);
                continue;
            }
            
            const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
            
            // Only place in air (don't overwrite terrain)
            if (chunk.voxels && chunk.voxels[idx] === 0) {
                chunk.voxels[idx] = v.material;
            }
        }
    }
    
    // ========================================================================
    // PENDING BLOCKS - Deferred cross-chunk placement
    // ========================================================================
    
    /**
     * Add a pending block for a chunk that may not exist yet
     */
    _addPendingBlock(wx, wy, wz, material, structureType) {
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cy = Math.floor(wy / CHUNK_SIZE);
        const cz = Math.floor(wz / CHUNK_SIZE);
        const key = `${cx},${cy},${cz}`;
        
        if (!this.pendingBlocks.has(key)) {
            this.pendingBlocks.set(key, []);
        }
        
        this.pendingBlocks.get(key).push({
            x: wx, y: wy, z: wz,
            material,
            structureType,
            priority: structureType === StructureType.TREE ? 1 : 0,
        });
    }
    
    /**
     * Apply pending blocks to a chunk
     */
    _applyPendingBlocks(chunk) {
        const { cx, cy, cz } = chunk;
        const key = `${cx},${cy},${cz}`;
        
        const pending = this.pendingBlocks.get(key);
        if (!pending || pending.length === 0) return;
        
        const originX = cx * CHUNK_SIZE;
        const originY = cy * CHUNK_SIZE;
        const originZ = cz * CHUNK_SIZE;
        
        // Sort by priority (higher = placed later, wins conflicts)
        pending.sort((a, b) => a.priority - b.priority);
        
        for (const block of pending) {
            const lx = block.x - originX;
            const ly = block.y - originY;
            const lz = block.z - originZ;
            
            if (lx < 0 || lx >= CHUNK_SIZE ||
                ly < 0 || ly >= CHUNK_SIZE ||
                lz < 0 || lz >= CHUNK_SIZE) continue;
            
            const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
            
            // Only place in air
            if (chunk.voxels && chunk.voxels[idx] === 0) {
                chunk.voxels[idx] = block.material;
            }
        }
        
        // Clear pending
        this.pendingBlocks.delete(key);
    }
    
    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================
    
    /**
     * Generate deterministic seed for a chunk
     */
    _chunkSeed(cx, cy, cz) {
        return chunkSeamChunkSeed3D(cx, cy, cz, this.seed);
    }
    
    /**
     * Generate deterministic seed for a world position
     */
    _positionSeed(wx, wy, wz) {
        return chunkSeamPositionSeed3D(wx, wy, wz, this.seed);
    }
    
    /**
     * Clear references for a chunk (when unloading)
     */
    clearChunk(cx, cy, cz) {
        const key = `${cx},${cy},${cz}`;
        this.structureRefs.delete(key);
        this.pendingBlocks.delete(key);
        this.chunkPhases.delete(key);
    }
    
    /**
     * Get stats for debugging
     */
    getStats() {
        return {
            trackedChunks: this.chunkPhases.size,
            cachedRefs: this.structureRefs.size,
            pendingBlockChunks: this.pendingBlocks.size,
            totalPendingBlocks: Array.from(this.pendingBlocks.values())
                .reduce((sum, arr) => sum + arr.length, 0),
        };
    }
}

// ============================================================================
// GENERATION PHASES
// ============================================================================

export const GenerationPhase = {
    EMPTY: 0,               // Not loaded
    BIOMES: 1,              // Biome data calculated
    NOISE: 2,               // Base terrain shape
    SURFACE: 3,             // Surface blocks placed
    CARVERS: 4,             // Caves carved
    TERRAIN: 5,             // Terrain complete (safe for neighbor queries)
    STRUCTURE_REFS: 6,      // Structure references calculated
    STRUCTURES: 7,          // Structures placed
    FEATURES: 8,            // Decorations (grass, flowers)
    LIGHTING: 9,            // Light propagated
    READY: 10,              // Fully complete
};

export const GenerationPhaseNames = {
    [GenerationPhase.EMPTY]: 'EMPTY',
    [GenerationPhase.BIOMES]: 'BIOMES',
    [GenerationPhase.NOISE]: 'NOISE',
    [GenerationPhase.SURFACE]: 'SURFACE',
    [GenerationPhase.CARVERS]: 'CARVERS',
    [GenerationPhase.TERRAIN]: 'TERRAIN',
    [GenerationPhase.STRUCTURE_REFS]: 'STRUCTURE_REFS',
    [GenerationPhase.STRUCTURES]: 'STRUCTURES',
    [GenerationPhase.FEATURES]: 'FEATURES',
    [GenerationPhase.LIGHTING]: 'LIGHTING',
    [GenerationPhase.READY]: 'READY',
};

// ============================================================================
// EXPORTS
// ============================================================================

export default ChunkSeamSystem;
