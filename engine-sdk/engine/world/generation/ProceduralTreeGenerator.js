// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * ProceduralTreeGenerator.js - Transport-Oriented Growth Trees

 *

 * INTEGRATION:

 * - Uses WindSimulation for dynamic tree sway

 * - Uses SpatialHashCompute for wind field queries

 * - GPU particle system for falling leaves

 * - MaterialSchema for material IDs (single source of truth)

 *

 * Implements realistic procedural tree generation using:

 * - Binary branching with recursive growth

 * - Nutrient transport determining girth/length

 * - Leaf density seeking for natural shapes

 * - Space colonization for environment-aware growth

 * - Wind-reactive branch sway and leaf particles

 *

 * Based on: Nick McDonald's Transport-Oriented Growth

 * https://nickmcd.me/2020/10/19/transport-oriented-growth-and-procedural-trees/

 *

 * Key mechanics:

 * - Nutrients flow up, consumed for growth

 * - Only leaf branches grow in length

 * - Cross-sectional area conserved at splits

 * - Branches seek areas of highest light/space

 * - Wind affects branch angle and spawns leaf particles

 */



// Import material IDs from schema (single source of truth)
import { MATERIAL, getMaterialId } from '../../voxel/MaterialSchema.js';
import {
    LEGACY_PCG32_WGSL,
    LEGACY_WORLD_GENERATION_RUNTIME_PCG_HASH_WGSL,
    legacyPrimeCoordinateAdditiveSeed3D,
    legacyPrimeCoordinateXorHash3D,
    legacyPrimeCoordinateXorSeed2D,
} from '../../core/math/MathBits.js';


// ============================================================================

// TREE SPECIES PRESETS

// ============================================================================



export const TREE_SPECIES = {

    OAK: 0,

    PINE: 1,

    BIRCH: 2,

    PALM: 3,

    WILLOW: 4,

    CACTUS: 5,

    MUSHROOM: 6,

    DEAD: 7,

};



const SPECIES_DATA = {

    [TREE_SPECIES.OAK]: {

        name: 'Oak',

        splitSize: 8.0,

        splitDecay: 0.15,

        spreadAngle: 0.5,

        ratio: 0.5,

        passRatio: 0.7,

        maxDepth: 6,

        leafSize: 3.0,

        trunkMaterial: 'WOOD',

        leafMaterial: 'LEAVES',

        minHeight: 8,

        maxHeight: 15,

    },

    [TREE_SPECIES.PINE]: {

        name: 'Pine',

        splitSize: 6.0,

        splitDecay: 0.1,

        spreadAngle: 0.3,

        ratio: 0.3,  // Asymmetric - main trunk dominates

        passRatio: 0.6,

        maxDepth: 8,

        leafSize: 2.0,

        trunkMaterial: 'WOOD',

        leafMaterial: 'LEAVES',

        minHeight: 10,

        maxHeight: 20,

    },

    [TREE_SPECIES.BIRCH]: {

        name: 'Birch',

        splitSize: 5.0,

        splitDecay: 0.2,

        spreadAngle: 0.4,

        ratio: 0.5,

        passRatio: 0.75,

        maxDepth: 5,

        leafSize: 2.5,

        trunkMaterial: 'WOOD',  // Would be BIRCH_WOOD if available

        leafMaterial: 'LEAVES',

        minHeight: 6,

        maxHeight: 12,

    },

    [TREE_SPECIES.PALM]: {

        name: 'Palm',

        splitSize: 12.0,

        splitDecay: 0.05,

        spreadAngle: 0.8,

        ratio: 0.5,

        passRatio: 0.9,

        maxDepth: 2,  // Palm has few branches

        leafSize: 5.0,

        trunkMaterial: 'WOOD',

        leafMaterial: 'LEAVES',

        minHeight: 8,

        maxHeight: 14,

    },

    [TREE_SPECIES.WILLOW]: {

        name: 'Willow',

        splitSize: 4.0,

        splitDecay: 0.25,

        spreadAngle: 0.7,

        ratio: 0.5,

        passRatio: 0.8,

        maxDepth: 7,

        leafSize: 1.5,

        drooping: true,  // Branches droop down

        trunkMaterial: 'WOOD',

        leafMaterial: 'LEAVES',

        minHeight: 6,

        maxHeight: 10,

    },

    [TREE_SPECIES.CACTUS]: {

        name: 'Cactus',

        splitSize: 6.0,

        splitDecay: 0.3,

        spreadAngle: 0.1,

        ratio: 0.5,

        passRatio: 0.5,

        maxDepth: 3,

        leafSize: 0,  // No leaves

        trunkMaterial: 'CACTUS',

        leafMaterial: null,

        minHeight: 3,

        maxHeight: 8,

    },

    [TREE_SPECIES.MUSHROOM]: {

        name: 'Giant Mushroom',

        splitSize: 10.0,

        splitDecay: 0.4,

        spreadAngle: 0.6,

        ratio: 0.5,

        passRatio: 0.3,

        maxDepth: 2,

        leafSize: 6.0,  // Large cap

        trunkMaterial: 'MUSHROOM_STEM',

        leafMaterial: 'MUSHROOM_CAP',

        minHeight: 5,

        maxHeight: 12,

    },

    [TREE_SPECIES.DEAD]: {

        name: 'Dead Tree',

        splitSize: 6.0,

        splitDecay: 0.2,

        spreadAngle: 0.5,

        ratio: 0.5,

        passRatio: 0.6,

        maxDepth: 4,

        leafSize: 0,  // No leaves

        trunkMaterial: 'WOOD',

        leafMaterial: null,

        minHeight: 4,

        maxHeight: 8,

    },

};



// ============================================================================

// DETERMINISTIC RANDOM UTILITY (for multiplayer sync)

// ============================================================================



/**

 * Seeded random number generator (mulberry32)

 * Returns a function that generates deterministic random numbers 0-1

 */

function seededRandom(seed) {

    let state = seed >>> 0;

    return function() {

        state = (state + 0x6D2B79F5) | 0;

        let t = Math.imul(state ^ (state >>> 15), 1 | state);

        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;

    };

}



/**

 * Hash function for position-based determinism

 */

export function proceduralTreePositionHash3D(x, y, z) {
    return legacyPrimeCoordinateXorHash3D(x, y, z);
}

export function proceduralTreeDefaultSeed2D(x, z) {
    return legacyPrimeCoordinateXorSeed2D(x, z);
}

export function grassPatchBladeSeed3D(patchX, patchZ, bladeIndex) {
    return legacyPrimeCoordinateAdditiveSeed3D(patchX, patchZ, bladeIndex);
}

function positionHash(x, y, z) {
    return proceduralTreePositionHash3D(x, y, z);
}


// ============================================================================

// BRANCH CLASS

// ============================================================================



class Branch {

    constructor(parent = null, config = {}) {

        this.parent = parent;

        this.childA = null;

        this.childB = null;

        this.isLeaf = true;



        // Growth parameters (inherited from parent or config)

        this.ratio = config.ratio ?? parent?.ratio ?? 0.5;

        this.spreadAngle = config.spreadAngle ?? parent?.spreadAngle ?? 0.5;

        this.splitSize = config.splitSize ?? parent?.splitSize ?? 8.0;

        this.splitDecay = config.splitDecay ?? parent?.splitDecay ?? 0.15;

        this.passRatio = config.passRatio ?? parent?.passRatio ?? 0.7;

        this.maxDepth = config.maxDepth ?? parent?.maxDepth ?? 6;

        this.drooping = config.drooping ?? parent?.drooping ?? false;



        // Depth in tree

        this.depth = parent ? parent.depth + 1 : 0;



        // Geometric properties

        this.direction = config.direction ?? [0, 1, 0];  // Initially pointing up

        this.baseDirection = [...(config.direction ?? [0, 1, 0])];  // Original direction (for wind reset)

        this.length = 0;

        this.radius = 0.1;

        this.area = 0.01;  // Cross-sectional area



        // World position (set during placement)

        this.position = config.position ?? [0, 0, 0];



        // Wind response parameters - deterministic based on branch ID and position

        this.id = Branch._nextId++;

        const phaseHash = positionHash(

            Math.floor(this.position[0] * 100),

            Math.floor(this.position[1] * 100) + this.id,

            Math.floor(this.position[2] * 100)

        );

        this.windPhase = (phaseHash % 1000) / 1000 * Math.PI * 2;  // Deterministic phase

        this.windFlexibility = 1.0 / (1 + this.depth * 0.5);  // Thinner = more flex

        this.currentSway = [0, 0, 0];  // Current sway offset



        // Seeded random for this branch (deterministic)

        this.rng = seededRandom(phaseHash + this.depth * 12345);

    }



    /**

     * Apply wind force to branch, returns sway offset

     * @param {Array} windVec - Wind velocity [x, y, z]

     * @param {number} time - Current time for oscillation

     * @param {number} strength - Wind strength multiplier

     */

    applyWind(windVec, time, strength = 1.0) {

        // Thinner branches sway more, trunk barely moves

        const flex = this.windFlexibility * strength;



        // Oscillation based on wind + branch phase

        const windMag = Math.sqrt(windVec[0] ** 2 + windVec[2] ** 2);

        const freq = 2.0 + windMag * 0.5;

        const osc = Math.sin(time * freq + this.windPhase);



        // Sway perpendicular to wind direction

        const swayAmount = flex * windMag * osc * 0.1;



        this.currentSway[0] = windVec[0] * flex * 0.05 + swayAmount * windVec[2];

        this.currentSway[1] = 0;

        this.currentSway[2] = windVec[2] * flex * 0.05 - swayAmount * windVec[0];



        // Update direction with sway

        this.direction[0] = this.baseDirection[0] + this.currentSway[0];

        this.direction[1] = this.baseDirection[1] + this.currentSway[1];

        this.direction[2] = this.baseDirection[2] + this.currentSway[2];



        // Normalize

        const len = Math.sqrt(

            this.direction[0] ** 2 +

            this.direction[1] ** 2 +

            this.direction[2] ** 2

        );

        if (len > 0) {

            this.direction[0] /= len;

            this.direction[1] /= len;

            this.direction[2] /= len;

        }



        return this.currentSway;

    }



    static _nextId = 0;



    /**

     * Grow the branch with given nutrients

     * @param {number} feed - Amount of nutrients

     */

    grow(feed) {

        // Update radius from area

        this.radius = Math.sqrt(this.area / Math.PI);



        if (this.isLeaf) {

            // Leaf branch: grow in length

            const lengthGrowth = Math.cbrt(feed);

            this.length += lengthGrowth;



            // Reduce feed by consumed amount

            feed -= lengthGrowth * this.area;



            // Grow in area with remainder

            if (this.length > 0) {

                this.area += feed / this.length;

            }



            // Check split condition

            const splitThreshold = this.splitSize * Math.exp(-this.splitDecay * this.depth);

            if (this.length > splitThreshold && this.depth < this.maxDepth) {

                this.split();

            }

        } else {

            // Non-leaf: grow in girth only, pass nutrients to children

            const consumed = feed * (1 - this.passRatio);

            if (this.length > 0) {

                this.area += consumed / this.length;

            }



            // Pass to children based on ratio

            const passed = feed * this.passRatio;

            if (this.childA) {

                this.childA.grow(passed * this.ratio);

            }

            if (this.childB) {

                this.childB.grow(passed * (1 - this.ratio));

            }

        }

    }



    /**

     * Split this branch into two child branches

     */

    split() {

        if (!this.isLeaf || this.depth >= this.maxDepth) return;



        this.isLeaf = false;



        // Calculate split directions

        const baseDir = this.direction;

        const spreadRad = this.spreadAngle;



        // Deterministic rotation around the branch direction (using branch's seeded RNG)

        const randomAngle = this.rng() * Math.PI * 2;



        // Create perpendicular vectors for rotation

        const up = [0, 1, 0];

        let perpX, perpY;



        if (Math.abs(baseDir[1]) > 0.9) {

            perpX = [1, 0, 0];

        } else {

            perpX = normalize(cross(baseDir, up));

        }

        perpY = normalize(cross(baseDir, perpX));



        // Child A direction: rotated one way

        const angleA = spreadRad * (0.5 + this.rng() * 0.5);

        const rotA = randomAngle;

        const dirA = normalize([

            baseDir[0] + Math.sin(angleA) * (Math.cos(rotA) * perpX[0] + Math.sin(rotA) * perpY[0]),

            baseDir[1] + Math.sin(angleA) * (Math.cos(rotA) * perpX[1] + Math.sin(rotA) * perpY[1]) - (this.drooping ? 0.2 : 0),

            baseDir[2] + Math.sin(angleA) * (Math.cos(rotA) * perpX[2] + Math.sin(rotA) * perpY[2]),

        ]);



        // Child B direction: rotated the other way

        const angleB = spreadRad * (0.5 + this.rng() * 0.5);

        const rotB = rotA + Math.PI;

        const dirB = normalize([

            baseDir[0] + Math.sin(angleB) * (Math.cos(rotB) * perpX[0] + Math.sin(rotB) * perpY[0]),

            baseDir[1] + Math.sin(angleB) * (Math.cos(rotB) * perpX[1] + Math.sin(rotB) * perpY[1]) - (this.drooping ? 0.2 : 0),

            baseDir[2] + Math.sin(angleB) * (Math.cos(rotB) * perpX[2] + Math.sin(rotB) * perpY[2]),

        ]);



        // Calculate child start positions

        const endPos = [

            this.position[0] + this.direction[0] * this.length,

            this.position[1] + this.direction[1] * this.length,

            this.position[2] + this.direction[2] * this.length,

        ];



        // Create children

        this.childA = new Branch(this, { direction: dirA, position: endPos });

        this.childB = new Branch(this, { direction: dirB, position: endPos });

    }



    /**

     * Get the end position of this branch

     */

    getEndPosition() {

        return [

            this.position[0] + this.direction[0] * this.length,

            this.position[1] + this.direction[1] * this.length,

            this.position[2] + this.direction[2] * this.length,

        ];

    }



    /**

     * Iterate over all branches in the tree

     * @param {Function} callback - Called with each branch

     */

    traverse(callback) {

        callback(this);

        if (this.childA) this.childA.traverse(callback);

        if (this.childB) this.childB.traverse(callback);

    }



    /**

     * Get all leaf branches

     */

    getLeaves() {

        const leaves = [];

        this.traverse(branch => {

            if (branch.isLeaf) leaves.push(branch);

        });

        return leaves;

    }

}



// ============================================================================

// HELPER FUNCTIONS

// ============================================================================



function normalize(v) {

    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

    if (len < 0.0001) return [0, 1, 0];

    return [v[0] / len, v[1] / len, v[2] / len];

}



function cross(a, b) {

    return [

        a[1] * b[2] - a[2] * b[1],

        a[2] * b[0] - a[0] * b[2],

        a[0] * b[1] - a[1] * b[0],

    ];

}



// ============================================================================

// MAIN CLASS

// ============================================================================



export class ProceduralTreeGenerator {

    constructor(config = {}) {

        this.config = {

            defaultSpecies: config.defaultSpecies ?? TREE_SPECIES.OAK,

            growthIterations: config.growthIterations ?? 50,

            nutrientRate: config.nutrientRate ?? 2.0,

            windSwayStrength: config.windSwayStrength ?? 1.0,

            leafDropThreshold: config.leafDropThreshold ?? 5.0,  // Wind speed to drop leaves

            ...config,

        };



        // Material mapping - uses MaterialSchema as single source of truth

        this.materialMap = config.materialMap || {

            'WOOD': MATERIAL.WOOD,

            'LEAVES': MATERIAL.LEAVES,

            'CACTUS': MATERIAL.CACTUS,

            'MUSHROOM_STEM': MATERIAL.WOOD,

            'MUSHROOM_CAP': MATERIAL.LEAVES,

        };



        // External system references

        this.windSimulation = null;   // WindSimulation for wind field

        this.particleSystem = null;   // game.worldParticles for leaf particles

        this.spatialHash = null;      // SpatialHashCompute for queries



        // Active trees for wind updates

        this.activeTrees = new Map();  // treeId -> {tree, branches, position}

    }



    /**

     * Connect to wind simulation and particle system

     * @param {Object} options - {windSimulation, particleSystem, spatialHash}

     */

    setWindSystem(options) {

        if (options.windSimulation) this.windSimulation = options.windSimulation;

        if (options.particleSystem) this.particleSystem = options.particleSystem;

        if (options.spatialHash) this.spatialHash = options.spatialHash;

    }



    /**

     * Update all active trees with wind

     * @param {number} time - Current time

     */

    updateWind(time) {

        if (!this.windSimulation) return;



        const cfg = this.config;

        const leafParticles = [];



        for (const [treeId, treeData] of this.activeTrees) {

            const { tree, branches, position } = treeData;



            // Sample wind at tree position

            const windVec = this.windSimulation.sampleWind

                ? this.windSimulation.sampleWind(position[0], position[2])

                : this.windSimulation.config.windSpeed || [0.1, 0];



            // Convert 2D wind to 3D

            const wind3D = [windVec[0] || 0, 0, windVec[1] || 0];

            const windMag = Math.sqrt(wind3D[0] ** 2 + wind3D[2] ** 2);



            // Apply wind to each branch

            for (const branch of branches) {

                branch.applyWind(wind3D, time, cfg.windSwayStrength);



                // Strong wind drops leaves from leaf branches (deterministic using branch RNG)

                if (branch.isLeaf && windMag > cfg.leafDropThreshold && branch.rng() < 0.01) {

                    const leafPos = [

                        position[0] + branch.position[0],

                        position[1] + branch.position[1],

                        position[2] + branch.position[2],

                    ];



                    leafParticles.push({

                        x: leafPos[0] + (branch.rng() - 0.5) * 0.5,

                        y: leafPos[1] + (branch.rng() - 0.5) * 0.5,

                        z: leafPos[2] + (branch.rng() - 0.5) * 0.5,

                        vx: wind3D[0] * 0.5 + (branch.rng() - 0.5),

                        vy: -1 + branch.rng() * 0.5,

                        vz: wind3D[2] * 0.5 + (branch.rng() - 0.5),

                        material: this.materialMap['LEAVES'],

                        life: 5 + branch.rng() * 5,

                        mass: 0.01,

                    });

                }

            }

        }



        // Add leaf particles to shared system

        if (leafParticles.length > 0 && this.particleSystem) {

            for (const p of leafParticles) {

                this.particleSystem.push(p);

            }

        }



        return leafParticles;

    }



    /**

     * Register a tree for wind updates

     * @param {string} treeId - Unique tree identifier

     * @param {Object} tree - Generated tree data

     * @param {Array} position - World position [x, y, z]

     */

    registerTree(treeId, tree, position) {

        // Collect all branches

        const branches = [];

        const collectBranches = (branch) => {

            if (!branch) return;

            branches.push(branch);

            collectBranches(branch.childA);

            collectBranches(branch.childB);

        };

        collectBranches(tree.root);



        this.activeTrees.set(treeId, { tree, branches, position });

    }



    /**

     * Unregister a tree from wind updates

     * @param {string} treeId - Tree identifier

     */

    unregisterTree(treeId) {

        this.activeTrees.delete(treeId);

    }



    /**

     * Generate a tree at the given position

     * @param {number} x - World X position

     * @param {number} y - World Y position (ground level)

     * @param {number} z - World Z position

     * @param {number} species - Tree species from TREE_SPECIES enum

     * @param {number} seed - Random seed for this tree

     * @returns {Object} Tree data with branches and voxels

     */

    generateTree(x, y, z, species = null, seed = null) {
        species = species ?? this.config.defaultSpecies;
        seed = seed ?? proceduralTreeDefaultSeed2D(x, z);


        const speciesData = SPECIES_DATA[species];

        if (!speciesData) {

            console.warn(`[TreeGenerator] Unknown species: ${species}`);

            return null;

        }



        // Set random seed

        let rng = seed;

        const random = () => {

            rng = (rng * 1103515245 + 12345) & 0x7fffffff;

            return rng / 0x7fffffff;

        };



        // Randomize height within species range

        const heightScale = speciesData.minHeight +

            random() * (speciesData.maxHeight - speciesData.minHeight);



        // Create root branch

        Branch._nextId = 0;

        const root = new Branch(null, {

            position: [x, y, z],

            direction: [0, 1, 0],

            ...speciesData,

            splitSize: speciesData.splitSize * (heightScale / speciesData.maxHeight),

        });



        // Grow the tree

        for (let i = 0; i < this.config.growthIterations; i++) {

            root.grow(this.config.nutrientRate);

        }



        // Collect all branches

        const branches = [];

        root.traverse(branch => branches.push(branch));



        // Generate voxels

        const voxels = this._generateVoxels(root, speciesData);



        return {

            species,

            speciesName: speciesData.name,

            position: [x, y, z],

            branches,

            voxels,

            bounds: this._calculateBounds(branches),

        };

    }



    /**

     * Generate voxels for a tree

     * @private

     */

    _generateVoxels(root, speciesData) {

        const voxels = [];

        const trunkMaterial = this.materialMap[speciesData.trunkMaterial] || 7;

        const leafMaterial = this.materialMap[speciesData.leafMaterial] || 8;



        // Voxelize branches

        root.traverse(branch => {

            if (branch.length < 0.5) return;



            const start = branch.position;

            const end = branch.getEndPosition();

            const radius = Math.max(0.5, branch.radius);



            // Bresenham-style line voxelization

            const steps = Math.ceil(branch.length);

            for (let i = 0; i <= steps; i++) {

                const t = i / steps;

                const px = Math.floor(start[0] + (end[0] - start[0]) * t);

                const py = Math.floor(start[1] + (end[1] - start[1]) * t);

                const pz = Math.floor(start[2] + (end[2] - start[2]) * t);



                // Add trunk voxels based on radius

                const r = Math.ceil(radius * (1 - t * 0.3));  // Taper

                for (let dx = -r; dx <= r; dx++) {

                    for (let dz = -r; dz <= r; dz++) {

                        if (dx * dx + dz * dz <= r * r) {

                            voxels.push({

                                x: px + dx,

                                y: py,

                                z: pz + dz,

                                material: trunkMaterial,

                            });

                        }

                    }

                }

            }



            // Add leaves at leaf branches

            if (branch.isLeaf && leafMaterial && speciesData.leafSize > 0) {

                const leafPos = branch.getEndPosition();

                const leafR = Math.ceil(speciesData.leafSize);



                for (let dx = -leafR; dx <= leafR; dx++) {

                    for (let dy = -leafR; dy <= leafR; dy++) {

                        for (let dz = -leafR; dz <= leafR; dz++) {

                            const dist = dx * dx + dy * dy + dz * dz;

                            if (dist <= leafR * leafR) {

                                // Deterministic randomness based on position (same tree = same shape)

                                const lx = Math.floor(leafPos[0]) + dx;

                                const ly = Math.floor(leafPos[1]) + dy;

                                const lz = Math.floor(leafPos[2]) + dz;

                                const hash = positionHash(lx, ly, lz);
                                if ((hash % 100) > 30) {

                                    voxels.push({

                                        x: lx,

                                        y: ly,

                                        z: lz,

                                        material: leafMaterial,

                                    });

                                }

                            }

                        }

                    }

                }

            }

        });



        // Remove duplicates (keep last occurrence)

        const voxelMap = new Map();

        for (const v of voxels) {

            const key = `${v.x},${v.y},${v.z}`;

            voxelMap.set(key, v);

        }



        return Array.from(voxelMap.values());

    }



    /**

     * Calculate bounding box of tree

     * @private

     */

    _calculateBounds(branches) {

        let minX = Infinity, minY = Infinity, minZ = Infinity;

        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;



        for (const branch of branches) {

            const end = branch.getEndPosition();

            minX = Math.min(minX, branch.position[0], end[0]);

            minY = Math.min(minY, branch.position[1], end[1]);

            minZ = Math.min(minZ, branch.position[2], end[2]);

            maxX = Math.max(maxX, branch.position[0], end[0]);

            maxY = Math.max(maxY, branch.position[1], end[1]);

            maxZ = Math.max(maxZ, branch.position[2], end[2]);

        }



        return { minX, minY, minZ, maxX, maxY, maxZ };

    }



    /**

     * Place a tree into a chunk's voxel array

     * @param {Object} chunk - Voxel chunk

     * @param {Object} tree - Tree data from generateTree

     */

    placeTreeInChunk(chunk, tree) {

        const [originX, originY, originZ] = chunk.getWorldOrigin();

        const CHUNK_SIZE = chunk.voxels.length ** (1/3);  // Assuming cubic



        for (const voxel of tree.voxels) {

            // Convert to local chunk coordinates

            const lx = voxel.x - originX;

            const ly = voxel.y - originY;

            const lz = voxel.z - originZ;



            // Check bounds

            if (lx < 0 || lx >= CHUNK_SIZE ||

                ly < 0 || ly >= CHUNK_SIZE ||

                lz < 0 || lz >= CHUNK_SIZE) {

                continue;

            }



            // Calculate index

            const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;



            // Only place if air

            if (chunk.voxels[idx] === 0) {

                chunk.voxels[idx] = voxel.material;

            }

        }

    }



    /**

     * Get appropriate tree species for a biome

     * @param {number} biome - Biome ID

     * @returns {number} Tree species

     */

    getSpeciesForBiome(biome) {

        // Biome-to-species mapping

        const biomeToSpecies = {

            0: TREE_SPECIES.OAK,      // PLAINS

            1: TREE_SPECIES.OAK,      // FOREST

            2: TREE_SPECIES.PINE,     // TAIGA

            3: TREE_SPECIES.CACTUS,   // DESERT

            4: TREE_SPECIES.PALM,     // JUNGLE

            5: TREE_SPECIES.BIRCH,    // SWAMP (could be willow)

            6: TREE_SPECIES.PINE,     // MOUNTAINS

            7: TREE_SPECIES.DEAD,     // TUNDRA

            8: TREE_SPECIES.PALM,     // BEACH

            9: null,                  // OCEAN (no trees)

            10: TREE_SPECIES.MUSHROOM, // MUSHROOM

        };



        return biomeToSpecies[biome] ?? TREE_SPECIES.OAK;

    }



    /**

     * Load configuration from config object

     */

    loadConfig(cfg) {

        if (!cfg) return;



        if (cfg.tree_growth_iterations !== undefined) {

            this.config.growthIterations = parseInt(cfg.tree_growth_iterations);

        }

        if (cfg.tree_nutrient_rate !== undefined) {

            this.config.nutrientRate = parseFloat(cfg.tree_nutrient_rate);

        }

    }

}



// ============================================================================

// BIOME TREE DENSITY

// ============================================================================



export const BIOME_TREE_DENSITY = {

    [TREE_SPECIES.OAK]: 0.02,       // 2% chance per valid surface block

    [TREE_SPECIES.PINE]: 0.03,

    [TREE_SPECIES.BIRCH]: 0.015,

    [TREE_SPECIES.PALM]: 0.01,

    [TREE_SPECIES.WILLOW]: 0.01,

    [TREE_SPECIES.CACTUS]: 0.005,

    [TREE_SPECIES.MUSHROOM]: 0.02,

    [TREE_SPECIES.DEAD]: 0.005,

};



// ============================================================================

// FLUFFY FOLIAGE SHADER (Billboard-like effect)

// Based on: https://douges.dev/blog/threejs-trees-1

// ============================================================================



export const FLUFFY_FOLIAGE_SHADER = /* wgsl */ `

struct FrameUniforms {

    viewProj: mat4x4<f32>,

    view: mat4x4<f32>,

    cameraPos: vec3<f32>,

    time: f32,

}



struct FoliageParams {

    effectBlend: f32,      // 0-1 billboard effect strength

    leafScale: f32,        // Leaf quad size

    windStrength: f32,     // Wind sway amount

    windFrequency: f32,    // Wind oscillation speed

    colorVariation: f32,   // Color randomness

    alphaThreshold: f32,   // Alpha cutoff

    _pad: vec2<f32>,

}



struct FoliageInstance {

    position: vec3<f32>,

    scale: f32,

    rotation: f32,

    leafDensity: f32,

    colorTint: vec2<f32>,  // Hue/saturation shift

}



@group(0) @binding(0) var<uniform> frame: FrameUniforms;

@group(0) @binding(1) var<uniform> params: FoliageParams;

@group(1) @binding(0) var<storage, read> instances: array<FoliageInstance>;

@group(2) @binding(0) var foliageTexture: texture_2d<f32>;

@group(2) @binding(1) var foliageSampler: sampler;



struct VertexOutput {

    @builtin(position) position: vec4<f32>,

    @location(0) uv: vec2<f32>,

    @location(1) color: vec3<f32>,

    @location(2) worldPos: vec3<f32>,

}



// Remap value from one range to another

fn remap(v: f32, prevMin: f32, prevMax: f32, newMin: f32, newMax: f32) -> f32 {

    let t = (v - prevMin) / (prevMax - prevMin);

    return mix(newMin, newMax, t);

}



// Simple wind noise

fn windNoise(pos: vec3<f32>, time: f32) -> vec2<f32> {

    let freq = params.windFrequency;

    let wx = sin(pos.x * 0.5 + time * freq) * cos(pos.z * 0.3 + time * freq * 0.7);

    let wz = cos(pos.x * 0.3 + time * freq * 0.8) * sin(pos.z * 0.5 + time * freq);

    return vec2<f32>(wx, wz) * params.windStrength;

}



// PCG hash - deterministic across all GPUs
${LEGACY_PCG32_WGSL}
${LEGACY_WORLD_GENERATION_RUNTIME_PCG_HASH_WGSL}

// Hash for color variation (deterministic)
fn hash(n: f32) -> f32 {
    return f32(pcg_h(bitcast<u32>(n))) / 4294967295.0;

}



@vertex

fn vs_foliage(

    @builtin(vertex_index) vertexIndex: u32,

    @builtin(instance_index) instanceIndex: u32

) -> VertexOutput {

    var output: VertexOutput;



    let instance = instances[instanceIndex];



    // Quad vertices (2 triangles)

    var corners = array<vec2<f32>, 4>(

        vec2<f32>(-0.5, -0.5),

        vec2<f32>(0.5, -0.5),

        vec2<f32>(0.5, 0.5),

        vec2<f32>(-0.5, 0.5)

    );

    var indices = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);



    let cornerIdx = indices[vertexIndex];

    let corner = corners[cornerIdx];



    // UV coordinates

    output.uv = corner + 0.5;



    // Fluffy billboard effect - offset vertices relative to camera

    var vertexOffset = vec2<f32>(

        remap(output.uv.x, 0.0, 1.0, -1.0, 1.0),

        remap(output.uv.y, 0.0, 1.0, -1.0, 1.0)

    );

    vertexOffset = normalize(vertexOffset) * params.leafScale * instance.scale;



    // Apply rotation

    let c = cos(instance.rotation);

    let s = sin(instance.rotation);

    let rotatedOffset = vec2<f32>(

        vertexOffset.x * c - vertexOffset.y * s,

        vertexOffset.x * s + vertexOffset.y * c

    );



    // Wind displacement

    let wind = windNoise(instance.position, frame.time);

    let windOffset = vec3<f32>(wind.x, 0.0, wind.y) * (1.0 - output.uv.y);  // More sway at top



    // World position with wind

    let worldPos = instance.position + windOffset;



    // Apply billboard effect in view space

    var viewPos = frame.view * vec4<f32>(worldPos, 1.0);

    viewPos.x += rotatedOffset.x * params.effectBlend;

    viewPos.y += rotatedOffset.y * params.effectBlend;



    // Also add some local offset for non-billboard mode

    let localOffset = vec3<f32>(rotatedOffset.x, rotatedOffset.y, 0.0) * (1.0 - params.effectBlend);

    viewPos.x += localOffset.x;

    viewPos.y += localOffset.y;



    output.position = frame.viewProj * vec4<f32>(worldPos + localOffset, 1.0);

    output.position = frame.viewProj * (inverse(frame.view) * viewPos);



    output.worldPos = worldPos;



    // Color variation per instance

    let colorVar = hash(f32(instanceIndex) * 17.3);

    let hueShift = (colorVar - 0.5) * params.colorVariation;

    output.color = vec3<f32>(

        0.3 + hueShift * 0.1 + instance.colorTint.x,

        0.6 + colorVar * 0.2,

        0.2 + hueShift * 0.05

    );



    return output;

}



@fragment

fn fs_foliage(input: VertexOutput) -> @location(0) vec4<f32> {

    let texColor = textureSample(foliageTexture, foliageSampler, input.uv);



    // Alpha test

    if (texColor.a < params.alphaThreshold) {

        discard;

    }



    // Apply color tint

    let finalColor = input.color * texColor.rgb;



    // Simple lighting (hemisphere)

    let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.3));

    let normal = vec3<f32>(0.0, 1.0, 0.0);  // Simplified up normal

    let light = max(dot(normal, lightDir), 0.3);



    return vec4<f32>(finalColor * light, texColor.a);

}

`;



// ============================================================================

// GPU GRASS INSTANCING

// Based on: AMD GPUOpen Mesh Shader Grass

// https://gpuopen.com/learn/mesh_shaders/mesh_shaders-procedural_grass_rendering/

// ============================================================================



export const GRASS_TYPES = {

    SHORT: 0,

    TALL: 1,

    WHEAT: 2,

    FERN: 3,

    FLOWER: 4,

};



const GRASS_DATA = {

    [GRASS_TYPES.SHORT]: { height: 0.3, width: 0.05, density: 1.0, color: [0.3, 0.6, 0.2] },

    [GRASS_TYPES.TALL]: { height: 0.8, width: 0.04, density: 0.6, color: [0.25, 0.5, 0.15] },

    [GRASS_TYPES.WHEAT]: { height: 1.0, width: 0.03, density: 0.4, color: [0.8, 0.7, 0.3] },

    [GRASS_TYPES.FERN]: { height: 0.5, width: 0.08, density: 0.3, color: [0.2, 0.45, 0.1] },

    [GRASS_TYPES.FLOWER]: { height: 0.4, width: 0.06, density: 0.1, color: [0.8, 0.3, 0.5] },

};



// ============================================================================

// STYLIZED GRASS BLADE SHADER

// Based on IQ's grass rendering technique with wind sway

// Creates organic tapered blades with smooth curves

// ============================================================================



export const STYLIZED_GRASS_SHADER = /* wgsl */ `

struct FrameUniforms {

    viewProj: mat4x4<f32>,

    view: mat4x4<f32>,

    cameraPos: vec3<f32>,

    time: f32,

}



struct GrassParams {

    windStrength: f32,

    windFrequency: f32,

    windDirection: vec2<f32>,

    bladeWidth: f32,

    bladeCurve: f32,

    colorBase: vec3<f32>,

    colorTip: vec3<f32>,

    aoStrength: f32,

    swayAmount: f32,      // How much blades sway side-to-side

    heightVariation: f32, // Random height multiplier range

}



struct GrassBlade {

    position: vec3<f32>,

    height: f32,

    width: f32,

    phase: f32,           // Unique phase for wind variation

    seed: f32,            // Random seed for blade variation

    _pad: f32,

}



@group(0) @binding(0) var<uniform> frame: FrameUniforms;

@group(0) @binding(1) var<uniform> params: GrassParams;

@group(1) @binding(0) var<storage, read> blades: array<GrassBlade>;



struct VertexOutput {

    @builtin(position) position: vec4<f32>,

    @location(0) uv: vec2<f32>,

    @location(1) color: vec3<f32>,

    @location(2) worldPos: vec3<f32>,

    @location(3) bladeAlpha: f32,

}



// PCG hash - deterministic across all GPUs
${LEGACY_PCG32_WGSL}
${LEGACY_WORLD_GENERATION_RUNTIME_PCG_HASH_WGSL}

fn hash(n: f32) -> f32 {
    return f32(pcg_h(bitcast<u32>(n))) / 4294967295.0;

}



fn hash2(p: vec2<f32>) -> f32 {

    let seed = pcg_h(bitcast<u32>(p.x) + pcg_h(bitcast<u32>(p.y)));

    return f32(seed) / 4294967295.0;

}



// Noise for wind field

fn noise2D(p: vec2<f32>) -> f32 {

    let i = floor(p);

    let f = fract(p);

    let u = f * f * (3.0 - 2.0 * f);



    let a = hash2(i);

    let b = hash2(i + vec2(1.0, 0.0));

    let c = hash2(i + vec2(0.0, 1.0));

    let d = hash2(i + vec2(1.0, 1.0));



    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);

}



// IQ-style blade shape function

// Returns: x = signed distance to blade edge, y = alpha mask

fn bladeShape(p: vec2<f32>, seed: f32, time: f32) -> vec2<f32> {

    // Blade scale varies by seed

    let scale = mix(0.7, 1.3, 0.5 + sin(seed * 12.0) * 0.5);



    // Sway animation - more at top (p.y = 0 is base, 1 is tip)

    var pos = p;

    let swayPhase = seed * 0.5 + time * params.windFrequency;

    pos.x += pow(pos.y, 2.0) * params.swayAmount * cos(swayPhase);



    // Scale

    pos.x *= scale;

    pos.y = pos.y * scale;



    // Blade profile: tapered from base to tip

    // Width decreases as y increases

    let maxWidth = clamp(1.0 - pos.y * 1.5, 0.01, 0.6) * 0.2 * scale;



    // SDF to blade edge with smooth falloff

    let dist = pow(abs(pos.x) * 19.0, 1.5) + pos.y - 0.6;

    let mask = 1.0 - smoothstep(0.0, maxWidth, dist);



    // Fade out at base smoothly

    let baseFade = smoothstep(0.0, 0.1, pos.y);



    return vec2(dist, mask * baseFade);

}



// Wind displacement with gusts

fn windDisplacement(pos: vec3<f32>, height: f32, phase: f32, time: f32) -> vec3<f32> {

    let windPos = vec2(pos.x, pos.z) * 0.05 + params.windDirection * time * 0.5;



    // Multi-octave wind

    var wind = noise2D(windPos) * 0.6;

    wind += noise2D(windPos * 2.0 + phase) * 0.3;

    wind += noise2D(windPos * 4.0 + time * 0.1) * 0.1;



    // Gust ripples

    let gust = max(0.0, sin(time * 0.7 + phase + pos.x * 0.05) * 0.5 + 0.3);

    wind *= 1.0 + gust;



    // Height factor - quadratic so tip moves most

    let heightFactor = height * height;



    return vec3(

        params.windDirection.x * wind * heightFactor * params.windStrength,

        -abs(wind) * heightFactor * params.windStrength * 0.15,

        params.windDirection.y * wind * heightFactor * params.windStrength

    );

}



@vertex

fn vs_stylized_grass(

    @builtin(vertex_index) vertexIndex: u32,

    @builtin(instance_index) instanceIndex: u32

) -> VertexOutput {

    var output: VertexOutput;



    let blade = blades[instanceIndex];



    // 6 vertices per blade (2 triangles forming a quad)

    // We'll render multiple segments for smooth curve

    let segmentCount = 4u;

    let vertIdx = vertexIndex % 6u;

    let segmentIdx = vertexIndex / 6u;



    // Quad vertex mapping

    var quadVert: u32;

    if (vertIdx == 0u) { quadVert = 0u; }       // bottom-left

    else if (vertIdx == 1u) { quadVert = 1u; }  // bottom-right

    else if (vertIdx == 2u) { quadVert = 2u; }  // top-right

    else if (vertIdx == 3u) { quadVert = 0u; }  // bottom-left

    else if (vertIdx == 4u) { quadVert = 2u; }  // top-right

    else { quadVert = 3u; }                     // top-left



    let isRight = (quadVert == 1u || quadVert == 2u);

    let isTop = (quadVert == 2u || quadVert == 3u);



    // Height parameter t: 0 = base, 1 = tip

    var t = f32(segmentIdx) / f32(segmentCount);

    if (isTop) { t = f32(segmentIdx + 1u) / f32(segmentCount); }



    // Blade variation from seed

    let heightMult = mix(1.0 - params.heightVariation, 1.0 + params.heightVariation,

                         hash(blade.seed));

    let finalHeight = blade.height * heightMult;



    // Width tapers toward tip (IQ style)

    let taperFactor = 1.0 - t * 0.8;  // 80% taper at tip

    let width = blade.width * taperFactor;

    let xOffset = select(-width * 0.5, width * 0.5, isRight);



    // Curve and sway (IQ technique: pow for quadratic bend)

    let swayPhase = blade.phase + frame.time * params.windFrequency;

    let sway = pow(t, 2.0) * params.swayAmount * cos(swayPhase);



    // Natural curve (blade bends forward/backward)

    let curve = params.bladeCurve * t * t;



    // Wind displacement

    let wind = windDisplacement(blade.position, t, blade.phase, frame.time);



    // Build local position

    var localPos = vec3(

        xOffset + sway,

        t * finalHeight,

        curve * finalHeight * 0.5

    );



    // Apply wind

    localPos += wind;



    // Billboard rotation toward camera (optional - makes grass face camera)

    let toCam = normalize(vec2(frame.cameraPos.x - blade.position.x,

                                frame.cameraPos.z - blade.position.z));

    let rotatedX = localPos.x * toCam.y - localPos.z * toCam.x;

    let rotatedZ = localPos.x * toCam.x + localPos.z * toCam.y;

    localPos.x = rotatedX;

    localPos.z = rotatedZ;



    // World position

    let worldPos = blade.position + localPos;



    output.position = frame.viewProj * vec4(worldPos, 1.0);

    output.worldPos = worldPos;



    // UV for texture/alpha

    output.uv = vec2(select(0.0, 1.0, isRight), t);



    // Color gradient (IQ style: darker at base, brighter at tip)

    let ao = 1.0 - (1.0 - t) * (1.0 - t) * params.aoStrength;

    let baseColor = params.colorBase * vec3(0.3, 0.4, 0.2) * ao;

    let tipColor = params.colorTip * vec3(0.4, 0.8, 0.3);

    output.color = mix(baseColor, tipColor, t);



    // Alpha for smooth blade edges

    let edgeFade = 1.0 - abs(output.uv.x - 0.5) * 2.0;

    let tipFade = 1.0 - smoothstep(0.85, 1.0, t);

    output.bladeAlpha = edgeFade * tipFade;



    return output;

}



@fragment

fn fs_stylized_grass(input: VertexOutput) -> @location(0) vec4<f32> {

    // Compute blade shape mask (IQ technique)

    let bladeUV = vec2((input.uv.x - 0.5) * 2.0, input.uv.y);



    // Blade profile - tapered with smooth edges

    let widthAtHeight = mix(1.0, 0.15, input.uv.y);  // Taper from base to tip

    let dist = abs(bladeUV.x) / widthAtHeight;

    let mask = 1.0 - smoothstep(0.7, 1.0, dist);



    // Tip softness

    let tipMask = 1.0 - smoothstep(0.8, 1.0, input.uv.y);



    // Final alpha

    let alpha = mask * tipMask * input.bladeAlpha;

    if (alpha < 0.1) { discard; }



    // Lighting

    let lightDir = normalize(vec3(0.5, 0.9, 0.3));

    let normal = normalize(vec3(bladeUV.x * 0.5, 1.0, 0.2));

    let diffuse = max(dot(normal, lightDir), 0.3);



    // Subsurface scattering (light through blade)

    let viewDir = normalize(frame.cameraPos - input.worldPos);

    let sss = pow(max(dot(-viewDir, lightDir), 0.0), 3.0) * 0.4;



    // Rim lighting

    let rim = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0) * 0.2;



    // Final color

    var finalColor = input.color * (diffuse + sss) + vec3(0.1, 0.2, 0.05) * rim;



    // Slight color variation based on world position

    let colorNoise = hash2(input.worldPos.xz * 0.1) * 0.1;

    finalColor *= 1.0 + colorNoise;



    return vec4(finalColor, alpha);

}

`;



// ============================================================================

// FLUFFY GRASS SHADER

// Based on: https://github.com/thebenezer/FluffyGrass

// ============================================================================



export const FLUFFY_GRASS_SHADER = /* wgsl */ `

struct FrameUniforms {

    viewProj: mat4x4<f32>,

    view: mat4x4<f32>,

    cameraPos: vec3<f32>,

    time: f32,

}



struct GrassParams {

    windStrength: f32,

    windFrequency: f32,

    windDirection: vec2<f32>,

    bladeWidth: f32,

    bladeCurve: f32,      // How much blades curve

    colorBase: vec3<f32>,

    colorTip: vec3<f32>,

    aoStrength: f32,      // Ambient occlusion at base

    _pad: f32,

}



struct GrassBlade {

    position: vec3<f32>,

    height: f32,

    width: f32,

    phase: f32,           // Wind phase offset

    tilt: vec2<f32>,      // Base tilt direction

}



@group(0) @binding(0) var<uniform> frame: FrameUniforms;

@group(0) @binding(1) var<uniform> params: GrassParams;

@group(1) @binding(0) var<storage, read> blades: array<GrassBlade>;



struct VertexOutput {

    @builtin(position) position: vec4<f32>,

    @location(0) uv: vec2<f32>,

    @location(1) color: vec3<f32>,

    @location(2) worldNormal: vec3<f32>,

}



// PCG hash - deterministic across all GPUs
${LEGACY_PCG32_WGSL}
${LEGACY_WORLD_GENERATION_RUNTIME_PCG_HASH_WGSL}

fn hash2_branch(p: vec2<f32>) -> f32 {
    let seed = pcg_h(bitcast<u32>(p.x) + pcg_h(bitcast<u32>(p.y)));

    return f32(seed) / 4294967295.0;

}



// Perlin-like noise for wind

fn noise2D(p: vec2<f32>) -> f32 {

    let i = floor(p);

    let f = fract(p);

    let u = f * f * (3.0 - 2.0 * f);



    let a = hash2_branch(i);

    let b = hash2_branch(i + vec2<f32>(1.0, 0.0));

    let c = hash2_branch(i + vec2<f32>(0.0, 1.0));

    let d = hash2_branch(i + vec2<f32>(1.0, 1.0));



    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);

}



// Wind displacement with gusts

fn windDisplacement(pos: vec3<f32>, height: f32, phase: f32, time: f32) -> vec3<f32> {

    let windPos = vec2<f32>(pos.x, pos.z) * 0.1 + params.windDirection * time * params.windFrequency;



    // Multi-octave wind

    var wind = noise2D(windPos) * 0.5;

    wind += noise2D(windPos * 2.0 + phase) * 0.25;

    wind += noise2D(windPos * 4.0) * 0.125;



    // Gust effect

    let gust = max(0.0, sin(time * 0.5 + phase + pos.x * 0.1) * 0.5 + 0.5);

    wind *= 1.0 + gust * 0.5;



    // Apply wind in direction, more at tip

    let heightFactor = height * height;  // Quadratic - tip moves more

    return vec3<f32>(

        params.windDirection.x * wind * heightFactor * params.windStrength,

        -abs(wind) * heightFactor * params.windStrength * 0.2,  // Slight droop

        params.windDirection.y * wind * heightFactor * params.windStrength

    );

}



@vertex

fn vs_grass(

    @builtin(vertex_index) vertexIndex: u32,

    @builtin(instance_index) instanceIndex: u32

) -> VertexOutput {

    var output: VertexOutput;



    let blade = blades[instanceIndex];



    // Grass blade geometry: 3 quads stacked (6 vertices each)

    // Total 7 vertices per blade for smooth curve

    let segmentCount = 3u;

    let vertsPerSegment = 2u;

    let totalVerts = (segmentCount + 1u) * vertsPerSegment;



    // Determine which segment and side

    let vertIdx = vertexIndex % 6u;  // 6 verts per quad (2 triangles)

    var quadVertIdx: u32;

    if (vertIdx == 0u) { quadVertIdx = 0u; }

    else if (vertIdx == 1u) { quadVertIdx = 1u; }

    else if (vertIdx == 2u) { quadVertIdx = 2u; }

    else if (vertIdx == 3u) { quadVertIdx = 0u; }

    else if (vertIdx == 4u) { quadVertIdx = 2u; }

    else { quadVertIdx = 3u; }



    let segmentIdx = vertexIndex / 6u;

    let isRight = (quadVertIdx == 1u || quadVertIdx == 2u);

    let isTop = (quadVertIdx == 2u || quadVertIdx == 3u);



    // Height along blade (0 = base, 1 = tip)

    var t = f32(segmentIdx) / f32(segmentCount);

    if (isTop) { t = f32(segmentIdx + 1u) / f32(segmentCount); }



    // UV

    output.uv = vec2<f32>(select(0.0, 1.0, isRight), t);



    // Width tapers toward tip

    let width = blade.width * (1.0 - t * 0.7);

    let xOffset = select(-width * 0.5, width * 0.5, isRight);



    // Curve the blade (bend more at top)

    let curve = params.bladeCurve * t * t;

    let tiltX = blade.tilt.x + curve;

    let tiltZ = blade.tilt.y + curve * 0.5;



    // Wind displacement

    let wind = windDisplacement(blade.position, t, blade.phase, frame.time);



    // Build position

    var localPos = vec3<f32>(xOffset, t * blade.height, 0.0);



    // Apply tilt and curve

    localPos.x += tiltX * t * blade.height;

    localPos.z += tiltZ * t * blade.height;



    // Apply wind

    localPos += wind;



    // World position

    let worldPos = blade.position + localPos;



    output.position = frame.viewProj * vec4<f32>(worldPos, 1.0);



    // Normal (perpendicular to blade face)

    output.worldNormal = normalize(vec3<f32>(-tiltX, 1.0, -tiltZ));



    // Color gradient (darker at base for AO, lighter at tip)

    let ao = 1.0 - (1.0 - t) * params.aoStrength;

    output.color = mix(params.colorBase * ao, params.colorTip, t);



    return output;

}



@fragment

fn fs_grass(input: VertexOutput) -> @location(0) vec4<f32> {

    // Simple lighting

    let lightDir = normalize(vec3<f32>(0.4, 0.9, 0.2));

    let diffuse = max(dot(input.worldNormal, lightDir), 0.2);



    // Subsurface scattering approximation (light through blade)

    let viewDir = normalize(frame.cameraPos - input.worldNormal);

    let sss = pow(max(dot(-viewDir, lightDir), 0.0), 4.0) * 0.3;



    let finalColor = input.color * (diffuse + sss);



    // Soft alpha at tip

    let alpha = 1.0 - smoothstep(0.9, 1.0, input.uv.y);



    return vec4<f32>(finalColor, alpha);

}

`;



/**

 * GPU Grass Instancer - Generates millions of grass blades via mesh shaders

 *

 * INTEGRATION:

 * - Uses shared particle system for grass blade physics

 * - Uses SpatialHashCompute for wind field queries

 * - Uses WindSimulation for dynamic wind effects

 *

 * Uses indirect instancing with per-blade data generated on GPU:

 * - Position jittered from grid

 * - Height/width variation

 * - Wind animation parameters

 * - LOD based on camera distance

 */

export class GrassInstancer {

    constructor(config = {}) {

        this.config = {

            patchSize: config.patchSize || 32,

            bladesPerPatch: config.bladesPerPatch || 256,

            maxPatches: config.maxPatches || 1024,

            lodDistances: config.lodDistances || [50, 100, 200],

            windStrength: config.windStrength || 0.3,

            windFrequency: config.windFrequency || 2.0,

            ...config,

        };



        this.device = null;

        this.initialized = false;



        // External system references

        this.windSimulation = null;   // WindSimulation for wind field

        this.spatialHash = null;      // SpatialHashCompute for queries



        // Buffers

        this.instanceBuffer = null;

        this.patchBuffer = null;

        this.indirectBuffer = null;

    }



    /**

     * Connect to wind simulation for dynamic grass movement

     * @param {Object} options - {windSimulation, spatialHash}

     */

    setWindSystem(options) {

        if (options.windSimulation) this.windSimulation = options.windSimulation;

        if (options.spatialHash) this.spatialHash = options.spatialHash;

    }



    async init(device) {

        this.device = device;

        const cfg = this.config;



        // Instance data: position, height, width, phase, color

        const instanceStride = 32;  // 8 floats

        const maxBlades = cfg.maxPatches * cfg.bladesPerPatch;



        this.instanceBuffer = device.createBuffer({

            label: 'Grass Instances',

            size: maxBlades * instanceStride,

            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,

        });



        // Patch data: center position, LOD level, grass type, density

        const patchStride = 32;

        this.patchBuffer = device.createBuffer({

            label: 'Grass Patches',

            size: cfg.maxPatches * patchStride,

            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,

        });



        // Indirect draw buffer

        this.indirectBuffer = device.createBuffer({

            label: 'Grass Indirect',

            size: 16,

            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,

        });



        this.initialized = true;

        console.log(`[GrassInstancer] Initialized, max ${maxBlades} blades`);

    }



    /**

     * Generate grass blade data for visible patches

     * @param {Array} patches - Array of {x, z, grassType, density}

     * @param {Object} camera - Camera position {x, y, z}

     * @param {number} time - Animation time

     */

    generateGrassData(patches, camera, time) {

        if (!this.initialized) return [];



        const blades = [];

        const cfg = this.config;



        for (const patch of patches) {

            // Calculate LOD based on distance

            const dx = patch.x - camera.x;

            const dz = patch.z - camera.z;

            const dist = Math.sqrt(dx * dx + dz * dz);



            let lodFactor = 1.0;

            if (dist > cfg.lodDistances[2]) continue;  // Too far, skip

            if (dist > cfg.lodDistances[1]) lodFactor = 0.25;

            else if (dist > cfg.lodDistances[0]) lodFactor = 0.5;



            const grassData = GRASS_DATA[patch.grassType] || GRASS_DATA[GRASS_TYPES.SHORT];

            const bladesInPatch = Math.floor(cfg.bladesPerPatch * lodFactor * (patch.density || 1) * grassData.density);



            // Generate blades in patch
            for (let i = 0; i < bladesInPatch; i++) {
                // Deterministic position within patch
                const seed = grassPatchBladeSeed3D(patch.x, patch.z, i);
                const hash = (n) => {
                    let x = Math.sin(n) * 43758.5453;
                    return x - Math.floor(x);
                };



                const jitterX = (hash(seed) - 0.5) * cfg.patchSize;

                const jitterZ = (hash(seed + 1) - 0.5) * cfg.patchSize;



                const bladeX = patch.x + jitterX;

                const bladeZ = patch.z + jitterZ;



                // Height/width variation

                const heightVar = 0.7 + hash(seed + 2) * 0.6;

                const widthVar = 0.8 + hash(seed + 3) * 0.4;



                // Wind phase offset

                const windPhase = hash(seed + 4) * Math.PI * 2;



                blades.push({

                    x: bladeX,

                    y: patch.y || 0,

                    z: bladeZ,

                    height: grassData.height * heightVar,

                    width: grassData.width * widthVar,

                    phase: windPhase,

                    colorR: grassData.color[0] * (0.8 + hash(seed + 5) * 0.4),

                    colorG: grassData.color[1] * (0.8 + hash(seed + 6) * 0.4),

                });

            }

        }



        return blades;

    }



    /**

     * Get grass type for biome

     */

    getGrassTypeForBiome(biome) {

        const biomeGrass = {

            0: GRASS_TYPES.SHORT,   // PLAINS

            1: GRASS_TYPES.TALL,    // FOREST

            2: GRASS_TYPES.FERN,    // TAIGA

            3: null,                // DESERT (no grass)

            4: GRASS_TYPES.FERN,    // JUNGLE

            5: GRASS_TYPES.TALL,    // SWAMP

            6: GRASS_TYPES.SHORT,   // MOUNTAINS

            7: null,                // TUNDRA

            8: null,                // BEACH

            9: null,                // OCEAN

            10: null,               // MUSHROOM

        };

        return biomeGrass[biome];

    }



    /**

     * Upload grass blade data to GPU

     */

    uploadBlades(blades) {

        if (!this.initialized || blades.length === 0) return;



        const data = new Float32Array(blades.length * 8);

        for (let i = 0; i < blades.length; i++) {

            const b = blades[i];

            data[i * 8 + 0] = b.x;

            data[i * 8 + 1] = b.y;

            data[i * 8 + 2] = b.z;

            data[i * 8 + 3] = b.height;

            data[i * 8 + 4] = b.width;

            data[i * 8 + 5] = b.phase;

            data[i * 8 + 6] = b.colorR;

            data[i * 8 + 7] = b.colorG;

        }



        this.device.queue.writeBuffer(this.instanceBuffer, 0, data);



        // Update indirect draw

        const indirect = new Uint32Array([

            6,              // vertices per blade (2 triangles)

            blades.length,  // instance count

            0,              // first vertex

            0,              // first instance

        ]);

        this.device.queue.writeBuffer(this.indirectBuffer, 0, indirect);

    }



    getInstanceBuffer() { return this.instanceBuffer; }

    getIndirectBuffer() { return this.indirectBuffer; }



    destroy() {

        this.instanceBuffer?.destroy();

        this.patchBuffer?.destroy();

        this.indirectBuffer?.destroy();

        this.initialized = false;

    }

}
