// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { degreesToRadians } from '../../core/math/UnitMath.js';
import {
    legacyPrimeCoordinateXorSeed2D,
    legacyWorldGeneratorHash3D,
} from '../../core/math/MathBits.js';

/**
 * WorldGenerator.js - Procedural World Generation System
 * 
 * Implements industry-standard terrain generation techniques from multiple sources:
 * 
 * DENSITY FIELD APPROACH (GPU Gems 3, Chapter 1)
 * - 3D density function: density >= 0 = solid, density < 0 = air
 * - Enables overhangs, arches, caves without separate carving pass
 * - Surface extracted at density = 0 boundary
 * 
 * MULTI-PARAMETER CLIMATE (Various open-world games)
 * - 5 parameters: temperature, humidity, continentalness, erosion, weirdness
 * - Biomes selected via weighted distance in parameter space
 * - Smooth transitions between biome types
 * 
 * NOISE COMPOSITION (Standard procedural generation)
 * - Fractal Brownian Motion (fBm) for natural terrain variation
 * - Multiple octaves with persistence/lacunarity control
 * - Domain warping for organic shapes
 * 
 * CAVE GENERATION (Perlin worms / ridged noise)
 * - Caverns: Large open spaces from 3D noise threshold
 * - Tunnels: Ridged noise intersection (creates connected passages)
 * - Passages: Fine network from high-frequency ridged noise
 * 
 * GEOLOGICAL LAYERS (Dwarf Fortress style)
 * - Depth tiers with different materials
 * - Ore veins clustered via 3D noise
 * - Stratified resource distribution
 * 
 * EROSION CONCEPTS (Unreal Engine, World Machine)
 * - Erosion parameter flattens terrain (high erosion = plains)
 * - Thermal erosion affects material distribution
 * 
 * Usage:
 *   const generator = new WorldGenerator({ seed: 42069 });
 *   generator.generateChunk(chunk);
 */

import { CHUNK_SIZE, CHUNK_SIZE_SQ, getDepthTier } from '../../voxel/VoxelConstants.js';
import { MATERIAL } from '../../voxel/MaterialSchema.js';
import { ProceduralTreeGenerator, TREE_SPECIES, BIOME_TREE_DENSITY } from './ProceduralTreeGenerator.js';
import {
  BIOME_TYPES,
  TERRAIN_SCHEMA,
  CLIMATE_PARAMS,
  createDefaultTerrain,
  validateTerrain,
  getBiomeFromClimate,
} from '../WorldSchema.js';

// ============================================================================
// NOISE FUNCTIONS
// ============================================================================

// Permutation table for Perlin noise
const PERM = new Uint8Array(512);
const GRAD3 = [
    [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
    [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
    [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
];

function initNoise(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    
    // Fisher-Yates shuffle with seed
    let s = seed;
    for (let i = 255; i > 0; i--) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const j = s % (i + 1);
        [p[i], p[j]] = [p[j], p[i]];
    }
    
    for (let i = 0; i < 512; i++) {
        PERM[i] = p[i & 255];
    }
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

function grad3(hash, x, y, z) {
    const g = GRAD3[hash % 12];
    return g[0] * x + g[1] * y + g[2] * z;
}

function noise3D(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    
    const A = PERM[X] + Y;
    const AA = PERM[A] + Z;
    const AB = PERM[A + 1] + Z;
    const B = PERM[X + 1] + Y;
    const BA = PERM[B] + Z;
    const BB = PERM[B + 1] + Z;
    
    return lerp(
        lerp(
            lerp(grad3(PERM[AA], x, y, z), grad3(PERM[BA], x - 1, y, z), u),
            lerp(grad3(PERM[AB], x, y - 1, z), grad3(PERM[BB], x - 1, y - 1, z), u),
            v
        ),
        lerp(
            lerp(grad3(PERM[AA + 1], x, y, z - 1), grad3(PERM[BA + 1], x - 1, y, z - 1), u),
            lerp(grad3(PERM[AB + 1], x, y - 1, z - 1), grad3(PERM[BB + 1], x - 1, y - 1, z - 1), u),
            v
        ),
        w
    );
}

function fbm(x, y, z, octaves, persistence, lacunarity) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
        value += amplitude * noise3D(x * frequency, y * frequency, z * frequency);
        maxValue += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    
    return value / maxValue;
}

function hash3(x, y, z) {
    return worldGeneratorHash3D(x, y, z);
}

export function worldGeneratorHash3D(x, y, z) {
    return legacyWorldGeneratorHash3D(x, y, z);
}

export function worldGeneratorDungeonSeed2D(centerX, centerZ) {
    return legacyPrimeCoordinateXorSeed2D(centerX, centerZ);
}

function ridgedNoise3D(x, y, z, seed = 0) {
    const n = noise3D(x + seed * 100, y + seed * 50, z + seed * 75);
    return 1.0 - Math.abs(n);  // Ridge at zero crossings
}

// ============================================================================
// BIOME DEFINITIONS
// ============================================================================

export const BIOME = {
    OCEAN: 0,
    BEACH: 1,
    PLAINS: 2,
    FOREST: 3,
    DESERT: 4,
    TUNDRA: 5,
    MOUNTAINS: 6,
    SWAMP: 7,
    JUNGLE: 8,
    TAIGA: 9,
    SAVANNA: 10,
    MESA: 11,
    ICE_PLAINS: 12,
    MUSHROOM: 13,
};

// Biome data with Minecraft-style depth/scale for terrain modulation
// depth = base terrain height, scale = height variation multiplier
// Climate targets: [temperature, humidity, continentalness, erosion, weirdness] (0-1 range)
const BIOME_DATA = {
    [BIOME.OCEAN]: {
        name: 'Ocean',
        surfaceMaterial: MATERIAL.SAND,
        subsurfaceMaterial: MATERIAL.SAND,
        depth: -0.5,         // Below sea level
        scale: 0.05,         // Very flat
        climate: [0.5, 0.5, 0.0, 0.5, 0.5],  // Low continentalness = ocean
    },
    [BIOME.BEACH]: {
        name: 'Beach',
        surfaceMaterial: MATERIAL.SAND,
        subsurfaceMaterial: MATERIAL.SAND,
        depth: 0.0,
        scale: 0.02,
        climate: [0.5, 0.5, 0.2, 0.8, 0.5],  // Low continent, high erosion
    },
    [BIOME.PLAINS]: {
        name: 'Plains',
        surfaceMaterial: MATERIAL.GRASS,
        subsurfaceMaterial: MATERIAL.DIRT,
        depth: 0.1,
        scale: 0.05,
        climate: [0.5, 0.3, 0.5, 0.7, 0.5],  // Mid temp, low humid, high erosion (flat)
    },
    [BIOME.FOREST]: {
        name: 'Forest',
        surfaceMaterial: MATERIAL.GRASS,
        subsurfaceMaterial: MATERIAL.DIRT,
        depth: 0.15,
        scale: 0.15,
        climate: [0.5, 0.6, 0.5, 0.5, 0.5],  // Mid temp, mid-high humid
    },
    [BIOME.DESERT]: {
        name: 'Desert',
        surfaceMaterial: MATERIAL.SAND,
        subsurfaceMaterial: MATERIAL.SAND,
        depth: 0.1,
        scale: 0.1,
        climate: [0.9, 0.1, 0.7, 0.6, 0.5],  // Hot, dry, inland
    },
    [BIOME.TUNDRA]: {
        name: 'Tundra',
        surfaceMaterial: MATERIAL.DIRT,
        subsurfaceMaterial: MATERIAL.STONE,
        depth: 0.05,
        scale: 0.05,
        climate: [0.1, 0.4, 0.5, 0.7, 0.5],  // Cold, mid humid, flat
    },
    [BIOME.MOUNTAINS]: {
        name: 'Mountains',
        surfaceMaterial: MATERIAL.STONE,
        subsurfaceMaterial: MATERIAL.STONE,
        depth: 0.8,          // High terrain
        scale: 0.6,          // Very varied
        climate: [0.3, 0.4, 0.8, 0.1, 0.5],  // Cold, inland, low erosion (peaks)
    },
    [BIOME.SWAMP]: {
        name: 'Swamp',
        surfaceMaterial: MATERIAL.GRASS,
        subsurfaceMaterial: MATERIAL.DIRT,
        depth: 0.0,
        scale: 0.02,
        climate: [0.6, 0.9, 0.4, 0.9, 0.5],  // Warm, wet, flat
    },
    [BIOME.JUNGLE]: {
        name: 'Jungle',
        surfaceMaterial: MATERIAL.GRASS,
        subsurfaceMaterial: MATERIAL.DIRT,
        depth: 0.2,
        scale: 0.25,
        climate: [0.9, 0.9, 0.6, 0.4, 0.5],  // Hot, wet, hilly
    },
    [BIOME.TAIGA]: {
        name: 'Taiga',
        surfaceMaterial: MATERIAL.GRASS,
        subsurfaceMaterial: MATERIAL.DIRT,
        depth: 0.15,
        scale: 0.2,
        climate: [0.2, 0.6, 0.6, 0.5, 0.5],  // Cold, humid
    },
    [BIOME.SAVANNA]: {
        name: 'Savanna',
        surfaceMaterial: MATERIAL.GRASS,
        subsurfaceMaterial: MATERIAL.DIRT,
        depth: 0.1,
        scale: 0.08,
        climate: [0.8, 0.2, 0.6, 0.6, 0.5],  // Hot, dry, flat
    },
    [BIOME.MESA]: {
        name: 'Mesa',
        surfaceMaterial: MATERIAL.SAND,
        subsurfaceMaterial: MATERIAL.DIRT,
        depth: 0.5,
        scale: 0.4,
        climate: [0.9, 0.1, 0.8, 0.3, 0.8],  // Hot, dry, inland, weird
    },
    [BIOME.ICE_PLAINS]: {
        name: 'Ice Plains',
        surfaceMaterial: MATERIAL.DIRT,
        subsurfaceMaterial: MATERIAL.STONE,
        depth: 0.05,
        scale: 0.03,
        climate: [0.0, 0.3, 0.5, 0.8, 0.5],  // Very cold, flat
    },
    [BIOME.MUSHROOM]: {
        name: 'Mushroom Island',
        surfaceMaterial: MATERIAL.MYCELIUM,
        subsurfaceMaterial: MATERIAL.DIRT,
        depth: 0.15,
        scale: 0.1,
        climate: [0.5, 0.7, 0.3, 0.5, 1.0],  // Max weirdness = rare
    },
};

// ============================================================================
// WORLD GENERATOR CLASS
// ============================================================================

export class WorldGenerator {
    constructor(config = {}) {
        this.seed = config.seed || 42069;
        this.initialized = false;
        
        // Noise parameters
        this.noiseOctaves = config.noiseOctaves || 6;
        this.noisePersistence = config.noisePersistence || 0.5;
        this.noiseLacunarity = config.noiseLacunarity || 2.0;
        
        // Terrain parameters
        this.seaLevel = config.seaLevel || 0;
        this.baseHeight = config.baseHeight || 0;
        this.heightScale = config.heightScale || 64;

        // 3D density shaping near surface (controls overhangs / floating blobs)
        // Default preserves existing behavior
        this.overhangStrength = (config.overhangStrength !== undefined) ? config.overhangStrength : 5;
        
        // Biome parameters
        this.biomeScale = config.biomeScale || 0.002;  // Larger = bigger biomes
        this.temperatureScale = config.temperatureScale || 0.001;
        this.humidityScale = config.humidityScale || 0.0015;
        
        // Cave parameters
        this.enableCaves = config.enableCaves !== false;
        this.caveScale = config.caveScale || 0.05;
        this.caveThreshold = config.caveThreshold || 0.65;
        this.caveDensityByDepth = config.caveDensityByDepth !== false;
        
        // Water parameters
        this.enableWater = config.enableWater !== false;
        this.waterLevel = config.waterLevel || 0;
        
        // Ore parameters
        this.enableOres = config.enableOres !== false;
        this.oreScale = config.oreScale || 0.1;
        
        // Structure parameters
        this.enableStructures = config.enableStructures !== false;
        this.structureCallbacks = new Map();
        
        // Lava parameters
        this.enableLava = config.enableLava !== false;
        this.lavaLevel = config.lavaLevel || -100;
        
        // Underground lakes
        this.enableUndergroundLakes = config.enableUndergroundLakes !== false;
        
        // Tree generation
        this.enableTrees = config.enableTrees !== false;
        this.treeDensityMultiplier = config.treeDensityMultiplier || 1.0;
        this.treesPerChunk = config.treesPerChunk || 4;
        this.treeGenerator = new ProceduralTreeGenerator({
            growthIterations: config.treeGrowthIterations || 50,
            nutrientRate: config.treeNutrientRate || 2.0,
        });
        
        // Terrain shaping parameters (hills, mountains, valleys)
        this.terrainPower = config.terrainPower || 1.5;        // Power redistribution (1=linear, 2=dramatic)
        this.ridgeStrength = config.ridgeStrength || 0.3;      // Ridged noise for mountains (0-1)
        this.ridgeScale = config.ridgeScale || 0.003;          // Ridge frequency
        this.warpStrength = config.warpStrength || 0.2;        // Domain warping strength (0-1)
        this.warpScale = config.warpScale || 0.005;            // Warp frequency
        this.mountainAmplify = config.mountainAmplify || 1.5;  // Peak amplification
        this.valleyDepth = config.valleyDepth || 1.0;          // Valley deepening
        this.plateauStrength = config.plateauStrength || 0.1;  // Plateau creation (0-1)
        this.plateauThreshold = config.plateauThreshold || 0.6; // Where plateaus form
        
        // Planetary scale parameters
        this.continentalScale = config.continentalScale || 0.0003;
        this.continentalOctaves = config.continentalOctaves || 4;
        this.landThreshold = config.landThreshold || 0.4;
        this.oceanDepth = config.oceanDepth || -40;
        this.shelfWidth = config.shelfWidth || 50;
        this.shelfDepth = config.shelfDepth || -10;
        this.tectonicStrength = config.tectonicStrength || 0.4;
        this.tectonicScale = config.tectonicScale || 0.0008;
        this.climateBands = config.climateBands !== false;
        this.polarExtent = config.polarExtent || 0.15;
        this.equatorHeat = config.equatorHeat || 0.3;
        this.rainfallVariance = config.rainfallVariance || 0.4;
        
        // Terrain offsets for variety
        this.offsetX = 0;
        this.offsetZ = 0;
        
        // Initialize
        this.init();
    }
    
    /**
     * Initialize the generator
     */
    init() {
        initNoise(this.seed);
        
        // Generate random offsets based on seed
        this.offsetX = Math.floor(hash3(this.seed, 0, 0) * 100000);
        this.offsetZ = Math.floor(hash3(0, this.seed, 0) * 100000);
        
        this.initialized = true;
        console.log(`[WorldGenerator] Initialized with seed ${this.seed}, offsets: (${this.offsetX}, ${this.offsetZ})`);
    }
    
    /**
     * Set the world seed
     */
    setSeed(seed) {
        this.seed = seed;
        this.init();
    }
    
    /**
     * Get 5 climate parameters at world coordinates
     * OPTIMIZED: Reduced octaves, uses single noise3D calls where possible
     * Returns: [temperature, humidity, continentalness, erosion, weirdness]
     */
    getClimate(wx, wz) {
        const x = wx + this.offsetX;
        const z = wz + this.offsetZ;
        
        // Use fewer octaves (2 instead of 3-4) for faster climate sampling
        // Temperature: varies globally
        const temperature = noise3D(x * 0.0008, 0, z * 0.0012) * 0.5 + 0.5;
        
        // Humidity: varies with different frequency
        const humidity = noise3D(x * 0.001 + 1000, 0, z * 0.0008 + 1000) * 0.5 + 0.5;
        
        // Continentalness: distance from ocean (large-scale) - keep 2 octaves for variety
        const continentalness = fbm(x * 0.0005, 0, z * 0.0005, 2, 0.6, 2.0) * 0.5 + 0.5;
        
        // Erosion: controls flatness vs peaks
        const erosion = noise3D(x * 0.002 + 2000, 0, z * 0.002 + 2000) * 0.5 + 0.5;
        
        // Weirdness: rare biome variants (single noise is fine)
        const weirdness = noise3D(x * 0.003 + 3000, 0, z * 0.003 + 3000) * 0.5 + 0.5;
        
        return [temperature, humidity, continentalness, erosion, weirdness];
    }
    
    /**
     * Get biome at world coordinates using climate matching
     * Finds the biome whose climate target is closest to the actual climate
     */
    getBiome(wx, wz) {
        const climate = this.getClimate(wx, wz);
        
        let bestBiome = BIOME.PLAINS;
        let bestDistance = Infinity;
        
        // Find biome with closest matching climate
        for (const [biomeId, biomeData] of Object.entries(BIOME_DATA)) {
            const target = biomeData.climate;
            if (!target) continue;
            
            // Weighted Euclidean distance in 5D climate space
            // Continentalness has highest weight (determines land vs ocean)
            const weights = [1.0, 1.0, 2.0, 1.5, 0.5];
            let distance = 0;
            for (let i = 0; i < 5; i++) {
                const diff = climate[i] - target[i];
                distance += diff * diff * weights[i];
            }
            
            if (distance < bestDistance) {
                bestDistance = distance;
                bestBiome = parseInt(biomeId);
            }
        }
        
        return bestBiome;
    }
    
    /**
     * Get continental value at position (0 = deep ocean, 1 = continental interior)
     * Used for land/ocean distribution and coastal effects
     */
    getContinentalness(wx, wz) {
        const x = wx + this.offsetX;
        const z = wz + this.offsetZ;
        
        // Large-scale continental noise
        const continental = fbm(
            x * this.continentalScale, 
            0, 
            z * this.continentalScale,
            this.continentalOctaves, 0.6, 2.0
        ) * 0.5 + 0.5;
        
        // Tectonic influence - creates mountain ranges at "plate boundaries"
        let tectonic = 0;
        if (this.tectonicStrength > 0) {
            const plate1 = noise3D(x * this.tectonicScale, 0, z * this.tectonicScale);
            const plate2 = noise3D(x * this.tectonicScale + 500, 0, z * this.tectonicScale + 500);
            // Boundaries where plates meet (ridged effect)
            tectonic = 1.0 - Math.abs(plate1 - plate2);
            tectonic = Math.pow(tectonic, 3) * this.tectonicStrength;
        }
        
        return Math.min(1, continental + tectonic * 0.3);
    }
    
    /**
     * Get terrain height at world coordinates with terrain shaping
     * Techniques: continental, tectonic, power redistribution, ridged noise, domain warping
     */
    getHeight(wx, wz) {
        let x = wx + this.offsetX;
        let z = wz + this.offsetZ;
        
        // ===== CONTINENTAL/OCEAN =====
        const continentalness = this.getContinentalness(wx, wz);
        const isOcean = continentalness < this.landThreshold;
        
        // ===== DOMAIN WARPING =====
        if (this.warpStrength > 0) {
            const warpX = noise3D(x * this.warpScale, 0, z * this.warpScale) * this.warpStrength * 50;
            const warpZ = noise3D(x * this.warpScale + 100, 0, z * this.warpScale + 100) * this.warpStrength * 50;
            x += warpX;
            z += warpZ;
        }
        
        // ===== OCEAN FLOOR =====
        if (isOcean) {
            // Distance from coast (0 at coast, 1 at deep ocean)
            const oceanDepthFactor = 1 - (continentalness / this.landThreshold);
            
            // Shelf near coast, then drops to ocean floor
            const shelfFactor = Math.min(1, oceanDepthFactor * 3);
            if (shelfFactor < 1) {
                // Continental shelf
                return this.shelfDepth * shelfFactor;
            } else {
                // Deep ocean with some variation
                const oceanVariation = noise3D(x * 0.01, 0, z * 0.01) * 10;
                return this.oceanDepth + oceanVariation;
            }
        }
        
        // Get biome
        const biome = this.getBiome(wx, wz);
        const biomeData = BIOME_DATA[biome];
        
        // ===== BASE TERRAIN NOISE =====
        const baseNoise = fbm(x * 0.008, 0, z * 0.008, 3, this.noisePersistence, this.noiseLacunarity);
        const detailNoise = noise3D(x * 0.03, 0, z * 0.03) * 0.3;
        
        // Combine into raw height (0-1 range approximately)
        let rawHeight = (baseNoise + detailNoise + 1) * 0.5;  // Normalize to 0-1
        
        // ===== RIDGED MULTIFRACTAL (mountains) =====
        if (this.ridgeStrength > 0) {
            const ridge = ridgedNoise3D(x * this.ridgeScale, 0, z * this.ridgeScale, 0);
            // Blend ridged noise for sharp mountain peaks
            rawHeight = rawHeight * (1 - this.ridgeStrength) + ridge * this.ridgeStrength;
        }
        
        // ===== POWER REDISTRIBUTION =====
        // Higher power = flatter valleys, sharper peaks
        if (this.terrainPower !== 1.0) {
            rawHeight = Math.pow(Math.max(0, rawHeight), this.terrainPower);
        }
        
        // ===== PLATEAU EFFECT =====
        // Flatten areas above a threshold
        if (this.plateauStrength > 0 && rawHeight > this.plateauThreshold) {
            const excess = rawHeight - this.plateauThreshold;
            const flattened = this.plateauThreshold + excess * (1 - this.plateauStrength);
            rawHeight = flattened;
        }
        
        // ===== MOUNTAIN AMPLIFICATION & VALLEY DEPTH =====
        // Amplify peaks, deepen valleys relative to base height
        const midpoint = 0.5;
        if (rawHeight > midpoint) {
            rawHeight = midpoint + (rawHeight - midpoint) * this.mountainAmplify;
        } else {
            rawHeight = midpoint - (midpoint - rawHeight) * this.valleyDepth;
        }
        
        // ===== EROSION =====
        const erosion = noise3D(x * 0.002 + 2000, 0, z * 0.002 + 2000) * 0.5 + 0.5;
        const erosionFactor = 1.0 - erosion * 0.7;
        
        // ===== FINAL HEIGHT =====
        const depth = biomeData.depth || 0.1;
        const scale = biomeData.scale || 0.1;
        
        // Convert normalized height back to world units
        return this.baseHeight + 
               (depth * this.heightScale) + 
               ((rawHeight - 0.5) * 2 * scale * this.heightScale * erosionFactor);
    }
    
    /**
     * Get 3D terrain density at world position
     * OPTIMIZED: Early-exit octave evaluation (KdotJPG technique)
     * Only compute 3D noise when height ± max_noise_range can cross threshold
     * density >= 0 = solid, density < 0 = air
     */
    getDensity(wx, wy, wz) {
        // Get the 2D base height (cached per column in generateChunk)
        const baseHeight = this._cachedHeight ?? this.getHeight(wx, wz);
        
        // Height-based density (threshold at 0)
        let density = baseHeight - wy;
        
        // Early-exit: if |density| > max possible noise contribution, skip noise
        // Max 3D noise contribution is ~6 units, so if |density| > 8, result is certain
        const MAX_NOISE_CONTRIBUTION = 8;
        
        if (density > MAX_NOISE_CONTRIBUTION) return density;   // Definitely solid
        if (density < -MAX_NOISE_CONTRIBUTION) return density;  // Definitely air
        
        // Only compute 3D noise in the "uncertain zone" near surface
        const x = wx + this.offsetX;
        const z = wz + this.offsetZ;
        
        // Single octave 3D noise (faster than fbm, good enough for overhangs)
        if (this.overhangStrength > 0) {
            const noise3d = noise3D(x * 0.025, wy * 0.035, z * 0.025);
            const depthFactor = Math.max(0, Math.min(1, (baseHeight - wy + 8) / 20));
            density += noise3d * this.overhangStrength * depthFactor;
        }
        
        // Squash at high altitudes (prevents floating islands)
        if (wy > 50) {
            density -= (wy - 50) * 0.1;
        }
        
        return density;
    }
    
    /**
     * Check if position is a cave
     * OPTIMIZED: Single noise check first, only compute expensive ridged noise if needed
     */
    isCave(wx, wy, wz) {
        if (!this.enableCaves) return false;
        
        const x = wx + this.offsetX;
        const z = wz + this.offsetZ;
        const freq = this.caveScale;
        
        // Fast pre-check: use simple noise to quickly reject most blocks
        // This avoids expensive ridged noise for ~70% of blocks
        const quickCheck = noise3D(x * freq * 0.5, wy * freq * 0.5, z * freq * 0.5);
        if (quickCheck < -0.3 || quickCheck > 0.3) return false;
        
        // Noodle caves: ridged noise intersection for tunnels
        const ridge1 = ridgedNoise3D(x * freq, wy * freq * 1.5, z * freq, 1);
        if (ridge1 < 0.5) return false;  // Early exit
        
        const ridge2 = ridgedNoise3D(x * freq + 50, wy * freq * 1.5 + 30, z * freq + 70, 2);
        const noodleCave = ridge1 * ridge2;
        
        if (noodleCave > this.caveThreshold) return true;
        
        // Spaghetti caves only if noodle didn't match
        const spaghetti = ridgedNoise3D(x * freq * 0.7, wy * freq * 0.5, z * freq * 0.7, 3);
        if (spaghetti * 0.6 > this.caveThreshold) return true;
        
        // Cheese caves only deep underground
        if (wy < -30) {
            const cheese = noise3D(x * freq * 0.3, wy * freq * 0.3, z * freq * 0.3);
            if (cheese > 0.55) return true;
        }
        
        return false;
    }
    
    /**
     * Fast cave check using 4x4x4 low-res sampling
     * Samples cave noise at grid points and uses simple threshold
     * 64x faster than full-res isCave for deep chunks
     */
    _fastCaveCheck(wx, wy, wz, lx, ly, lz) {
        if (!this.enableCaves) return false;
        
        // Sample at 4-block intervals (8 samples per 32-block chunk dimension)
        // Use local coords to determine if we're at a sample point
        const sampleX = (lx & 3) === 0;
        const sampleY = (ly & 3) === 0;
        const sampleZ = (lz & 3) === 0;
        
        // At sample points, compute full cave check and cache
        if (sampleX && sampleY && sampleZ) {
            return this.isCave(wx, wy, wz);
        }
        
        // Between sample points, use fast hash-based approximation
        // This creates blocky caves but is very fast
        const x = wx + this.offsetX;
        const z = wz + this.offsetZ;
        const freq = this.caveScale * 0.5;
        
        // Simple single-noise cave check
        const cave = noise3D(x * freq, wy * freq, z * freq);
        return cave > 0.4 && cave < 0.6;
    }
    
    /**
     * Get ore type at position (returns null if no ore)
     * Uses depth-based ore distribution with vein clustering
     */
    getOre(wx, wy, wz) {
        if (!this.enableOres) return null;
        
        const rng = hash3(wx, wy, wz);
        const x = wx + this.offsetX;
        const z = wz + this.offsetZ;
        
        // Ore vein clustering - ores appear in veins, not random single blocks
        const veinNoise = noise3D(x * 0.15, wy * 0.15, z * 0.15);
        if (veinNoise < 0.3) return null;  // Skip if not in a vein area
        
        // Crystal (Y: -100 to -60, very rare, glowing)
        if (wy < -60 && wy > -100 && rng < 0.003) {
            return MATERIAL.CRYSTAL;
        }
        
        // Magma (Y: -150 to -80, rare, near lava level)
        if (wy < -80 && wy > -150 && rng < 0.008) {
            return MATERIAL.MAGMA;
        }
        
        // Obsidian (Y: -120 to -60, uncommon)
        if (wy < -60 && wy > -120 && rng < 0.015) {
            return MATERIAL.OBSIDIAN;
        }
        
        // Deepstone (Y: -80 to -20, common transition stone)
        if (wy < -20 && wy > -80 && rng < 0.05) {
            return MATERIAL.DEEPSTONE;
        }
        
        // Metal ore (Y: -60 to 0, uncommon)
        if (wy < 0 && wy > -60 && rng < 0.012) {
            return MATERIAL.METAL;
        }
        
        // Energy ore (Y: -40 to -10, rare)
        if (wy < -10 && wy > -40 && rng < 0.005) {
            return MATERIAL.ENERGY;
        }
        
        // Also check depth tier for additional rare ores
        const tier = getDepthTier(wy);
        if (tier?.rareOre && rng < (tier?.oreChance || 0)) {
            return tier.rareOre;
        }
        
        return null;
    }
    
    /**
     * Check if position should be lava (deep underground pools)
     */
    isLava(wx, wy, wz) {
        if (!this.enableLava) return false;
        if (wy > this.lavaLevel) return false;
        
        // Lava pools form in caves below lava level
        const x = wx + this.offsetX;
        const z = wz + this.offsetZ;
        
        // Large lava lake noise
        const lakeNoise = noise3D(x * 0.02, wy * 0.05, z * 0.02);
        if (lakeNoise > 0.6 && this.isCave(wx, wy, wz)) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Check if position should be underground water
     */
    isUndergroundWater(wx, wy, wz) {
        if (!this.enableWater) return false;
        if (wy > -10 || wy < -60) return false;  // Only in mid-depths
        
        const x = wx + this.offsetX;
        const z = wz + this.offsetZ;
        
        // Underground lake noise
        const lakeNoise = noise3D(x * 0.03, wy * 0.08, z * 0.03);
        if (lakeNoise > 0.65 && this.isCave(wx, wy, wz)) {
            // Check if there's a floor below
            if (!this.isCave(wx, wy - 1, wz)) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Generate a chunk using optimized 3D density function
     * Optimizations:
     * - Cache biome/height per column (not per voxel)
     * - Fast path for fully underground chunks
     * - Reduced noise calls via early exits
     * - Inline critical calculations
     */
    generateChunk(chunk) {
        const [originX, originY, originZ] = chunk.getWorldOrigin();
        const chunkTopY = originY + CHUNK_SIZE;
        const chunkBottomY = originY;
        
        // Fast path: fully deep underground chunk (all stone, just check caves/ores)
        const isDeepChunk = chunkTopY < -30;
        // Fast path: fully above ground chunk (all air)
        const isHighChunk = chunkBottomY > 100;
        
        if (isHighChunk) {
            // All air - just fill and return
            chunk.voxels.fill(MATERIAL.AIR);
            chunk.solidCount = 0;
            chunk.saveOriginalState?.();
            chunk.isDirty = true;
            return;
        }
        
        // Pre-cache column data (biome, height) - avoids recalculating per Y
        const columnCache = new Float32Array(CHUNK_SIZE * CHUNK_SIZE * 3); // height, biome, underwater
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const wx = originX + lx;
                const wz = originZ + lz;
                const cacheIdx = (lx + lz * CHUNK_SIZE) * 3;
                
                const biome = this.getBiome(wx, wz);
                const height = this.getHeight(wx, wz);
                columnCache[cacheIdx] = height;
                columnCache[cacheIdx + 1] = biome;
                columnCache[cacheIdx + 2] = (this.enableWater && height < this.waterLevel) ? 1 : 0;
            }
        }
        
        // Main generation loop
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const wx = originX + lx;
                const wz = originZ + lz;
                const cacheIdx = (lx + lz * CHUNK_SIZE) * 3;
                
                const surfaceHeight = columnCache[cacheIdx];
                const biome = columnCache[cacheIdx + 1] | 0;
                const isUnderwater = columnCache[cacheIdx + 2] > 0;
                const biomeData = BIOME_DATA[biome];
                
                // Cache height for getDensity early-exit optimization
                this._cachedHeight = surfaceHeight;
                
                for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                    const wy = originY + ly;
                    const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
                    
                    // Fast path: well above surface = air
                    if (wy > surfaceHeight + 10 && wy > this.waterLevel) {
                        chunk.voxels[idx] = MATERIAL.AIR;
                        continue;
                    }
                    
                    // Fast path: deep underground = stone (check caves/ores only)
                    // Uses 4x4x4 low-res cave sampling with interpolation for speed
                    if (isDeepChunk && wy < surfaceHeight - 20) {
                        // Low-res cave check: sample every 4 blocks, interpolate
                        // This is 64x faster than full-res sampling
                        const caveResult = this._fastCaveCheck(wx, wy, wz, lx, ly, lz);
                        
                        if (caveResult) {
                            // Lava at bottom
                            if (this.enableLava && wy <= this.lavaLevel) {
                                chunk.voxels[idx] = MATERIAL.MAGMA;
                            } else {
                                chunk.voxels[idx] = MATERIAL.AIR;
                            }
                        } else {
                            // Ore check (simplified - skip expensive getOre for most blocks)
                            const rng = hash3(wx, wy, wz);
                            if (rng < 0.03) {
                                const ore = this.getOre(wx, wy, wz);
                                chunk.voxels[idx] = ore || MATERIAL.STONE;
                            } else {
                                chunk.voxels[idx] = MATERIAL.STONE;
                            }
                            chunk.solidCount++;
                        }
                        continue;
                    }
                    
                    // Standard path: use density function
                    const density = this.getDensity(wx, wy, wz);
                    const isSolid = density >= 0;
                    const inCave = this.enableCaves && wy < surfaceHeight - 5 && this.isCave(wx, wy, wz);
                    
                    if (!isSolid || inCave) {
                        // Air or cave
                        if (this.enableWater && wy <= this.waterLevel && wy > surfaceHeight) {
                            chunk.voxels[idx] = MATERIAL.WATER;
                            chunk.solidCount++;
                        } else {
                            chunk.voxels[idx] = MATERIAL.AIR;
                        }
                        continue;
                    }
                    
                    // Solid terrain - determine material
                    const depthFromSurface = surfaceHeight - wy;
                    
                    // Surface layer depth varies by biome (deeper for grass/dirt biomes)
                    const surfaceDepth = (biomeData.surfaceMaterial === MATERIAL.GRASS || 
                                          biomeData.surfaceMaterial === MATERIAL.SAND) ? 2 : 1;
                    const subsurfaceDepth = 8;  // Increased from 4 to reduce exposed stone on cliffs
                    
                    if (depthFromSurface <= surfaceDepth) {
                        // Surface layer
                        chunk.voxels[idx] = isUnderwater ? MATERIAL.SAND : biomeData.surfaceMaterial;
                    } else if (depthFromSurface < subsurfaceDepth) {
                        // Subsurface layer (dirt/sand under grass)
                        chunk.voxels[idx] = biomeData.subsurfaceMaterial;
                    } else {
                        // Stone layer
                        chunk.voxels[idx] = MATERIAL.STONE;
                    }
                    chunk.solidCount++;
                }
            }
        }
        
        // Finalize chunk
        chunk.saveOriginalState();
        chunk.isDirty = true;
        chunk.computeVisibility?.();
        chunk.tryCompress?.();
    }
    
    /**
     * Register a structure generator callback
     */
    registerStructure(name, callback) {
        this.structureCallbacks.set(name, callback);
    }
    
    /**
     * Generate structures for a chunk (called after terrain)
     */
    generateStructures(chunk) {
        if (!this.enableStructures) return;
        
        // Generate trees
        if (this.enableTrees) {
            this._generateTrees(chunk);
        }
        
        // Custom structure callbacks
        for (const [name, callback] of this.structureCallbacks) {
            try {
                callback(chunk, this);
            } catch (err) {
                console.warn(`[WorldGenerator] Structure '${name}' failed:`, err);
            }
        }
    }
    
    /**
     * Generate trees in a chunk based on biome
     * @private
     */
    _generateTrees(chunk) {
        // Guard: ensure chunk has voxels array (may be null if compressed/homogeneous)
        if (!chunk.voxels) {
            // Try to decompress if needed
            if (chunk.isHomogeneous || chunk.compressedData) {
                chunk.decompress?.();
            }
            // Still no voxels? Skip silently (chunk may be all-air which is fine)
            if (!chunk.voxels) return;
        }
        
        const [originX, originY, originZ] = chunk.getWorldOrigin();
        
        // Only generate trees at surface level chunks
        if (originY < -10 || originY > 100) return;
        
        // Deterministic tree positions based on chunk coordinates
        const chunkSeed = hash3(originX, originZ, this.seed);
        let treesPlaced = 0;
        
        // Sample a grid of potential tree positions
        // Use margin to avoid trees near chunk edges (prevents floating blocks from clipping)
        const step = 8;  // Check every 8 blocks
        const margin = 6;  // Skip trees within 6 blocks of chunk edge (tree canopy radius)
        for (let lz = margin; lz < CHUNK_SIZE - margin && treesPlaced < this.treesPerChunk; lz += step) {
            for (let lx = margin; lx < CHUNK_SIZE - margin && treesPlaced < this.treesPerChunk; lx += step) {
                const wx = originX + lx;
                const wz = originZ + lz;
                
                // Deterministic random for this position
                const rng = hash3(wx, wz, this.seed + 12345);
                
                // Get biome and tree species
                const biome = this.getBiome(wx, wz);
                const species = this.treeGenerator.getSpeciesForBiome(biome);
                
                // No trees for this biome
                if (species === null) continue;
                
                // Check tree density
                const baseDensity = BIOME_TREE_DENSITY[species] || 0.01;
                const density = baseDensity * this.treeDensityMultiplier;
                
                if (rng > density) continue;
                
                // Find surface height
                const surfaceY = Math.floor(this.getHeight(wx, wz));
                
                // Only generate tree if surface is in THIS chunk (prevents duplicate generation)
                if (surfaceY < originY || surfaceY >= originY + CHUNK_SIZE) continue;
                
                // Check if surface is above water
                if (surfaceY <= this.waterLevel) continue;
                
                // Validate tree has solid ground beneath (prevents floating trees)
                const groundCheck = this._validateTreeGround(wx, surfaceY, wz, chunk, originX, originY, originZ);
                if (!groundCheck.valid) continue;
                
                // Generate the tree
                const tree = this.treeGenerator.generateTree(wx, surfaceY + 1, wz, species, rng * 1000000);
                
                if (tree && tree.voxels.length > 0) {
                    // Register with tree physics system if available
                    if (this.treePhysics) {
                        this.treePhysics.registerTree(
                            [wx, surfaceY + 1, wz],
                            tree.voxels.map(v => ({
                                x: v.x - wx,
                                y: v.y - (surfaceY + 1),
                                z: v.z - wz,
                                material: v.material
                            }))
                        );
                    }
                    
                    // Place tree voxels in chunk
                    for (const v of tree.voxels) {
                        const vlx = v.x - originX;
                        const vly = v.y - originY;
                        const vlz = v.z - originZ;
                        
                        // Check bounds
                        if (vlx < 0 || vlx >= CHUNK_SIZE ||
                            vly < 0 || vly >= CHUNK_SIZE ||
                            vlz < 0 || vlz >= CHUNK_SIZE) continue;
                        
                        const idx = vlx + vly * CHUNK_SIZE + vlz * CHUNK_SIZE_SQ;
                        
                        // Only place in air
                        if (chunk.voxels[idx] === MATERIAL.AIR) {
                            chunk.voxels[idx] = v.material;
                        }
                    }
                    treesPlaced++;
                }
            }
        }
    }
    
    /**
     * Validate that a tree position has solid ground beneath
     * @private
     */
    _validateTreeGround(wx, surfaceY, wz, chunk, originX, originY, originZ) {
        // Check a 3x3 area beneath the tree for solid blocks
        let solidCount = 0;
        const checkRadius = 1;
        
        for (let dx = -checkRadius; dx <= checkRadius; dx++) {
            for (let dz = -checkRadius; dz <= checkRadius; dz++) {
                const checkX = wx + dx;
                const checkZ = wz + dz;
                const checkY = surfaceY;  // Ground level
                
                // Get local coords in chunk
                const lx = checkX - originX;
                const ly = checkY - originY;
                const lz = checkZ - originZ;
                
                // Skip if outside chunk bounds
                if (lx < 0 || lx >= CHUNK_SIZE ||
                    ly < 0 || ly >= CHUNK_SIZE ||
                    lz < 0 || lz >= CHUNK_SIZE) {
                    // Assume solid if outside chunk (neighbor chunk handles it)
                    solidCount++;
                    continue;
                }
                
                const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
                const material = chunk.voxels?.[idx];
                
                // Check if solid (not air, water, or leaves)
                if (material !== undefined && 
                    material !== MATERIAL.AIR && 
                    material !== MATERIAL.WATER &&
                    material !== MATERIAL.LEAVES) {
                    solidCount++;
                }
            }
        }
        
        // Need at least 4 of 9 blocks to be solid
        const minSolid = 4;
        return { valid: solidCount >= minSolid, solidCount };
    }
    
    /**
     * Set tree physics system reference
     */
    setTreePhysics(treePhysics) {
        this.treePhysics = treePhysics;
    }
    
    /**
     * Generate procedural dungeon in underground area
     * Based on: TinyKeepDev algorithm (separation + MST corridors)
     * https://www.gamedeveloper.com/programming/procedural-dungeon-generation-algorithm
     * @param {number} centerX - Dungeon center X
     * @param {number} centerY - Dungeon center Y (depth)
     * @param {number} centerZ - Dungeon center Z
     * @param {Object} config - Dungeon configuration
     */
    generateDungeon(centerX, centerY, centerZ, config = {}) {
        const roomCount = config.roomCount || 15;
        const minRoomSize = config.minRoomSize || 5;
        const maxRoomSize = config.maxRoomSize || 15;
        const spawnRadius = config.spawnRadius || 30;
        const corridorWidth = config.corridorWidth || 3;
        const seed = config.seed || worldGeneratorDungeonSeed2D(centerX, centerZ);
        
        // Seeded random
        let rng = seed;
        const random = () => {
            rng = (rng * 1103515245 + 12345) & 0x7fffffff;
            return rng / 0x7fffffff;
        };
        
        // Step 1: Generate rooms with random sizes in circular area
        const rooms = [];
        for (let i = 0; i < roomCount * 3; i++) {  // Generate extra, will filter
            const angle = random() * Math.PI * 2;
            const dist = random() * spawnRadius;
            
            const width = Math.floor(minRoomSize + random() * (maxRoomSize - minRoomSize));
            const height = Math.floor(minRoomSize + random() * (maxRoomSize - minRoomSize));
            const roomHeight = Math.floor(4 + random() * 4);
            
            rooms.push({
                x: Math.floor(centerX + Math.cos(angle) * dist),
                y: centerY,
                z: Math.floor(centerZ + Math.sin(angle) * dist),
                width,
                height,
                roomHeight,
                isMain: width * height > (maxRoomSize * maxRoomSize * 0.5),
            });
        }
        
        // Step 2: Separate overlapping rooms (physics simulation)
        for (let iter = 0; iter < 50; iter++) {
            let moved = false;
            for (let i = 0; i < rooms.length; i++) {
                for (let j = i + 1; j < rooms.length; j++) {
                    const a = rooms[i];
                    const b = rooms[j];
                    
                    // Check overlap
                    const overlapX = (a.width + b.width) / 2 - Math.abs(a.x - b.x);
                    const overlapZ = (a.height + b.height) / 2 - Math.abs(a.z - b.z);
                    
                    if (overlapX > 0 && overlapZ > 0) {
                        // Push apart
                        const pushX = overlapX / 2 + 1;
                        const pushZ = overlapZ / 2 + 1;
                        
                        if (a.x < b.x) { a.x -= pushX; b.x += pushX; }
                        else { a.x += pushX; b.x -= pushX; }
                        
                        if (a.z < b.z) { a.z -= pushZ; b.z += pushZ; }
                        else { a.z += pushZ; b.z -= pushZ; }
                        
                        moved = true;
                    }
                }
            }
            if (!moved) break;
        }
        
        // Step 3: Select main rooms (larger ones)
        const mainRooms = rooms.filter(r => r.isMain).slice(0, Math.min(roomCount, rooms.length));
        
        // Step 4: Create Delaunay triangulation (simplified - just connect nearby)
        const edges = [];
        for (let i = 0; i < mainRooms.length; i++) {
            const dists = mainRooms.map((r, j) => ({
                idx: j,
                dist: Math.sqrt((r.x - mainRooms[i].x) ** 2 + (r.z - mainRooms[i].z) ** 2)
            })).filter(d => d.idx !== i).sort((a, b) => a.dist - b.dist);
            
            // Connect to 2-3 nearest
            for (let k = 0; k < Math.min(3, dists.length); k++) {
                const edge = [Math.min(i, dists[k].idx), Math.max(i, dists[k].idx)];
                const key = `${edge[0]},${edge[1]}`;
                if (!edges.find(e => `${e[0]},${e[1]}` === key)) {
                    edges.push(edge);
                }
            }
        }
        
        // Step 5: Generate corridors along edges
        const corridors = [];
        for (const [i, j] of edges) {
            const a = mainRooms[i];
            const b = mainRooms[j];
            
            // L-shaped corridor
            if (random() < 0.5) {
                corridors.push({ x1: a.x, z1: a.z, x2: b.x, z2: a.z, width: corridorWidth, y: centerY });
                corridors.push({ x1: b.x, z1: a.z, x2: b.x, z2: b.z, width: corridorWidth, y: centerY });
            } else {
                corridors.push({ x1: a.x, z1: a.z, x2: a.x, z2: b.z, width: corridorWidth, y: centerY });
                corridors.push({ x1: a.x, z1: b.z, x2: b.x, z2: b.z, width: corridorWidth, y: centerY });
            }
        }
        
        return {
            rooms: mainRooms,
            corridors,
            bounds: {
                minX: Math.min(...mainRooms.map(r => r.x - r.width / 2)),
                maxX: Math.max(...mainRooms.map(r => r.x + r.width / 2)),
                minZ: Math.min(...mainRooms.map(r => r.z - r.height / 2)),
                maxZ: Math.max(...mainRooms.map(r => r.z + r.height / 2)),
            }
        };
    }
    
    /**
     * Carve dungeon into voxel chunk
     * @param {Object} chunk - Voxel chunk
     * @param {Object} dungeon - Dungeon from generateDungeon
     */
    carveDungeon(chunk, dungeon) {
        const [originX, originY, originZ] = chunk.getWorldOrigin();
        const CHUNK_SIZE = 32;  // Assuming 32
        
        // Carve rooms
        for (const room of dungeon.rooms) {
            const startX = Math.max(0, room.x - room.width / 2 - originX);
            const endX = Math.min(CHUNK_SIZE, room.x + room.width / 2 - originX);
            const startZ = Math.max(0, room.z - room.height / 2 - originZ);
            const endZ = Math.min(CHUNK_SIZE, room.z + room.height / 2 - originZ);
            const startY = Math.max(0, room.y - originY);
            const endY = Math.min(CHUNK_SIZE, room.y + room.roomHeight - originY);
            
            for (let y = startY; y < endY; y++) {
                for (let z = startZ; z < endZ; z++) {
                    for (let x = startX; x < endX; x++) {
                        const idx = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE;
                        chunk.voxels[idx] = 0;  // AIR
                    }
                }
            }
        }
        
        // Carve corridors
        for (const corr of dungeon.corridors) {
            const minX = Math.min(corr.x1, corr.x2) - corr.width / 2;
            const maxX = Math.max(corr.x1, corr.x2) + corr.width / 2;
            const minZ = Math.min(corr.z1, corr.z2) - corr.width / 2;
            const maxZ = Math.max(corr.z1, corr.z2) + corr.width / 2;
            
            const startX = Math.max(0, minX - originX);
            const endX = Math.min(CHUNK_SIZE, maxX - originX);
            const startZ = Math.max(0, minZ - originZ);
            const endZ = Math.min(CHUNK_SIZE, maxZ - originZ);
            const startY = Math.max(0, corr.y - originY);
            const endY = Math.min(CHUNK_SIZE, corr.y + 3 - originY);
            
            for (let y = startY; y < endY; y++) {
                for (let z = startZ; z < endZ; z++) {
                    for (let x = startX; x < endX; x++) {
                        const idx = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE;
                        chunk.voxels[idx] = 0;  // AIR
                    }
                }
            }
        }
    }
    
    /**
     * Load configuration from config object
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        // Noise parameters
        if (cfg.noise_octaves !== undefined) this.noiseOctaves = parseInt(cfg.noise_octaves);
        if (cfg.noise_persistence !== undefined) this.noisePersistence = parseFloat(cfg.noise_persistence);
        if (cfg.noise_lacunarity !== undefined) this.noiseLacunarity = parseFloat(cfg.noise_lacunarity);
        
        // Terrain
        if (cfg.sea_level !== undefined) this.seaLevel = parseInt(cfg.sea_level);
        if (cfg.base_height !== undefined) this.baseHeight = parseInt(cfg.base_height);
        if (cfg.height_scale !== undefined) this.heightScale = parseInt(cfg.height_scale);
        
        // Biomes
        if (cfg.biome_scale !== undefined) this.biomeScale = parseFloat(cfg.biome_scale);
        
        // Caves
        if (cfg.caves_enabled !== undefined) this.enableCaves = cfg.caves_enabled !== false;
        if (cfg.cave_scale !== undefined) this.caveScale = parseFloat(cfg.cave_scale);
        if (cfg.cave_threshold !== undefined) this.caveThreshold = parseFloat(cfg.cave_threshold);
        
        // Water
        if (cfg.water_enabled !== undefined) this.enableWater = cfg.water_enabled !== false;
        if (cfg.water_level !== undefined) this.waterLevel = parseInt(cfg.water_level);
        
        // Ores
        if (cfg.ores_enabled !== undefined) this.enableOres = cfg.ores_enabled !== false;
        
        // Lava
        if (cfg.lava_enabled !== undefined) this.enableLava = cfg.lava_enabled !== false;
        if (cfg.lava_level !== undefined) this.lavaLevel = parseInt(cfg.lava_level);
        
        // Underground lakes
        if (cfg.underground_lakes !== undefined) this.enableUndergroundLakes = cfg.underground_lakes !== false;
        
        // Structures
        if (cfg.structures_enabled !== undefined) this.enableStructures = cfg.structures_enabled !== false;
        
        // Terrain shaping
        if (cfg.terrain_power !== undefined) this.terrainPower = parseFloat(cfg.terrain_power);
        if (cfg.ridge_strength !== undefined) this.ridgeStrength = parseFloat(cfg.ridge_strength);
        if (cfg.ridge_scale !== undefined) this.ridgeScale = parseFloat(cfg.ridge_scale);
        if (cfg.warp_strength !== undefined) this.warpStrength = parseFloat(cfg.warp_strength);
        if (cfg.warp_scale !== undefined) this.warpScale = parseFloat(cfg.warp_scale);
        if (cfg.mountain_amplify !== undefined) this.mountainAmplify = parseFloat(cfg.mountain_amplify);
        if (cfg.valley_depth !== undefined) this.valleyDepth = parseFloat(cfg.valley_depth);
        if (cfg.plateau_strength !== undefined) this.plateauStrength = parseFloat(cfg.plateau_strength);
        if (cfg.plateau_threshold !== undefined) this.plateauThreshold = parseFloat(cfg.plateau_threshold);

        // Overhangs (3D density noise near surface)
        if (cfg.overhang_strength !== undefined) this.overhangStrength = parseFloat(cfg.overhang_strength);
        
        // Planetary scale
        if (cfg.continental_scale !== undefined) this.continentalScale = parseFloat(cfg.continental_scale);
        if (cfg.continental_octaves !== undefined) this.continentalOctaves = parseInt(cfg.continental_octaves);
        if (cfg.land_threshold !== undefined) this.landThreshold = parseFloat(cfg.land_threshold);
        if (cfg.ocean_depth !== undefined) this.oceanDepth = parseInt(cfg.ocean_depth);
        if (cfg.shelf_width !== undefined) this.shelfWidth = parseInt(cfg.shelf_width);
        if (cfg.shelf_depth !== undefined) this.shelfDepth = parseInt(cfg.shelf_depth);
        if (cfg.tectonic_strength !== undefined) this.tectonicStrength = parseFloat(cfg.tectonic_strength);
        if (cfg.tectonic_scale !== undefined) this.tectonicScale = parseFloat(cfg.tectonic_scale);
        if (cfg.climate_bands !== undefined) this.climateBands = cfg.climate_bands !== false;
        if (cfg.polar_extent !== undefined) this.polarExtent = parseFloat(cfg.polar_extent);
        if (cfg.equator_heat !== undefined) this.equatorHeat = parseFloat(cfg.equator_heat);
        if (cfg.rainfall_variance !== undefined) this.rainfallVariance = parseFloat(cfg.rainfall_variance);
        
        // Trees
        if (cfg.trees_enabled !== undefined) this.enableTrees = cfg.trees_enabled !== false;
        if (cfg.tree_density_multiplier !== undefined) this.treeDensityMultiplier = parseFloat(cfg.tree_density_multiplier);
        if (cfg.trees_per_chunk !== undefined) this.treesPerChunk = parseInt(cfg.trees_per_chunk);
        if (cfg.tree_growth_iterations !== undefined) {
            this.treeGenerator.config.growthIterations = parseInt(cfg.tree_growth_iterations);
        }
        if (cfg.tree_nutrient_rate !== undefined) {
            this.treeGenerator.config.nutrientRate = parseFloat(cfg.tree_nutrient_rate);
        }
        
        console.log('[WorldGenerator] Config loaded');
    }
    
    /**
     * Get biome name at world coordinates
     */
    getBiomeName(wx, wz) {
        const biome = this.getBiome(wx, wz);
        return BIOME_DATA[biome]?.name || 'Unknown';
    }
    
    /**
     * Get debug info for a position
     */
    getDebugInfo(wx, wy, wz) {
        return {
            biome: this.getBiomeName(wx, wz),
            height: this.getHeight(wx, wz),
            isCave: this.isCave(wx, wy, wz),
            tier: getDepthTier(wy)?.name || 'Unknown',
            ore: this.getOre(wx, wy, wz),
        };
    }
    
    // ========================================================================
    // NAVGRID INTEGRATION (for AI pathfinding)
    // ========================================================================
    
    /**
     * Bake navigation grid from generated terrain
     * @param {Object} navGrid - NavGrid from engine/sim/ai/NavGrid.js
     * @param {Object} options - {maxSlopeDegrees, minHeight, maxHeight}
     */
    bakeNavGrid(navGrid, options = {}) {
        if (!navGrid || !navGrid.walkable) return;
        
        const maxSlopeDegrees = options.maxSlopeDegrees || 45;
        const maxSlopeRad = degreesToRadians(Number(maxSlopeDegrees));
        const minHeight = options.minHeight ?? this.seaLevel;
        const maxHeight = options.maxHeight ?? Infinity;
        const cellSize = navGrid.cellSize || 1;
        
        for (let gz = 0; gz < navGrid.height; gz++) {
            for (let gx = 0; gx < navGrid.width; gx++) {
                const worldX = navGrid.originX + gx * cellSize + cellSize / 2;
                const worldZ = navGrid.originZ + gz * cellSize + cellSize / 2;
                
                // Get terrain height
                const height = this.getHeight(worldX, worldZ);
                const idx = gz * navGrid.width + gx;
                
                // Check height bounds
                if (height < minHeight || height > maxHeight) {
                    navGrid.walkable[idx] = 0;
                    continue;
                }
                
                // Check slope
                const hX = this.getHeight(worldX + cellSize, worldZ);
                const hZ = this.getHeight(worldX, worldZ + cellSize);
                const dx = hX - height;
                const dz = hZ - height;
                const slope = Math.sqrt(dx * dx + dz * dz) / cellSize;
                const slopeAngle = Math.atan(slope);
                
                if (slopeAngle > maxSlopeRad) {
                    navGrid.walkable[idx] = 0;
                    continue;
                }
                
                // Check if water (not walkable by default)
                const biome = this.getBiome(worldX, worldZ);
                if (biome === BIOME.OCEAN && height <= this.seaLevel) {
                    navGrid.walkable[idx] = 0;
                    continue;
                }
                
                navGrid.walkable[idx] = 1;
            }
        }
        
        console.log(`[WorldGenerator] NavGrid baked: ${navGrid.width}x${navGrid.height}`);
    }
    
    /**
     * Get AI terrain type at world position (for AITerrain.js)
     * Maps voxel materials/biomes to terrain types
     * @param {number} wx - World X
     * @param {number} wz - World Z
     * @returns {string} Terrain type from TERRAIN_TYPE enum
     */
    getTerrainType(wx, wz) {
        const biome = this.getBiome(wx, wz);
        const height = this.getHeight(wx, wz);
        
        // Water check
        if (height <= this.seaLevel) {
            const depth = this.seaLevel - height;
            return depth > 5 ? 'water_deep' : 'water_shallow';
        }
        
        // Biome-based terrain
        switch (biome) {
            case BIOME.PLAINS: return 'grass';
            case BIOME.FOREST: return 'forest';
            case BIOME.TAIGA: return 'snow';
            case BIOME.DESERT: return 'sand';
            case BIOME.JUNGLE: return 'forest';
            case BIOME.SWAMP: return 'swamp';
            case BIOME.MOUNTAINS: return 'rock';
            case BIOME.TUNDRA: return 'snow';
            case BIOME.BEACH: return 'sand';
            case BIOME.OCEAN: return 'water_deep';
            case BIOME.MUSHROOM: return 'grass';
            default: return 'dirt';
        }
    }
    
    /**
     * Get AI movement cost at position (integrates with AITerrain.js)
     * @param {number} wx - World X
     * @param {number} wz - World Z
     * @returns {number} Movement cost multiplier
     */
    getMovementCost(wx, wz) {
        const terrainType = this.getTerrainType(wx, wz);
        
        const MOVE_COSTS = {
            'road': 0.8,
            'grass': 1.0,
            'dirt': 1.0,
            'sand': 1.4,
            'snow': 1.3,
            'water_shallow': 1.5,
            'water_deep': 3.0,
            'mud': 2.0,
            'rock': 1.2,
            'forest': 1.3,
            'swamp': 2.5,
            'lava': 10.0,
            'ice': 1.1,
        };
        
        return MOVE_COSTS[terrainType] || 1.0;
    }
    
    /**
     * Get cover value at position (for AI combat)
     * @param {number} wx - World X
     * @param {number} wy - World Y  
     * @param {number} wz - World Z
     * @returns {number} Cover value 0-1
     */
    getCoverValue(wx, wy, wz) {
        const biome = this.getBiome(wx, wz);
        const height = this.getHeight(wx, wz);
        
        // Trees provide cover
        if (biome === BIOME.FOREST || biome === BIOME.JUNGLE) {
            return 0.6;
        }
        
        // Rocks provide partial cover
        if (biome === BIOME.MOUNTAINS) {
            return 0.3;
        }
        
        // Behind terrain provides cover
        const heightDiff = wy - height;
        if (heightDiff < 0) return 1.0;  // Underground = full cover
        if (heightDiff < 1) return 0.5;  // At ground level
        
        return 0;
    }
    
    /**
     * Generate heightmap for weather/AI systems
     * @param {number} originX - World origin X
     * @param {number} originZ - World origin Z
     * @param {number} size - Grid size
     * @param {number} cellSize - Cell size in world units
     * @returns {Float32Array} Heightmap grid
     */
    generateHeightmap(originX, originZ, size, cellSize = 1) {
        const heightmap = new Float32Array(size * size);
        
        for (let z = 0; z < size; z++) {
            for (let x = 0; x < size; x++) {
                const worldX = originX + x * cellSize;
                const worldZ = originZ + z * cellSize;
                heightmap[z * size + x] = this.getHeight(worldX, worldZ);
            }
        }
        
        return heightmap;
    }
    
    /**
     * Generate watermap for weather system
     * @param {number} originX - World origin X
     * @param {number} originZ - World origin Z
     * @param {number} size - Grid size
     * @param {number} cellSize - Cell size in world units
     * @returns {Float32Array} Water mask (1 = water)
     */
    generateWatermap(originX, originZ, size, cellSize = 1) {
        const watermap = new Float32Array(size * size);
        
        for (let z = 0; z < size; z++) {
            for (let x = 0; x < size; x++) {
                const worldX = originX + x * cellSize;
                const worldZ = originZ + z * cellSize;
                const height = this.getHeight(worldX, worldZ);
                watermap[z * size + x] = height <= this.seaLevel ? 1 : 0;
            }
        }
        
        return watermap;
    }
    
    // ========================================================================
    // DENSITY COLLISION QUERIES (GPU Gems 3 Style)
    // For physics objects to interact with procedural terrain
    // ========================================================================
    
    /**
     * Sample terrain density at world position
     * Negative = inside solid, Positive = outside (air)
     * @param {number} wx - World X
     * @param {number} wy - World Y
     * @param {number} wz - World Z
     * @returns {number} Signed distance (negative = solid)
     */
    sampleDensity(wx, wy, wz) {
        const surfaceHeight = this.getHeight(wx, wz);
        
        // Basic density: distance to surface
        let density = wy - surfaceHeight;
        
        // Cave carving
        if (this.isCave(wx, wy, wz)) {
            density = Math.max(density, 1); // Inside cave = air
        }
        
        return density;
    }
    
    /**
     * Ray march through density field to find surface intersection
     * @param {number} ox - Ray origin X
     * @param {number} oy - Ray origin Y
     * @param {number} oz - Ray origin Z
     * @param {number} dx - Ray direction X (normalized)
     * @param {number} dy - Ray direction Y (normalized)
     * @param {number} dz - Ray direction Z (normalized)
     * @param {number} maxDist - Maximum ray distance
     * @param {number} stepSize - Ray march step size
     * @returns {Object|null} {x, y, z, distance, normal} or null if no hit
     */
    raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist = 100, stepSize = 0.5) {
        let t = 0;
        let prevDensity = this.sampleDensity(ox, oy, oz);
        
        while (t < maxDist) {
            t += stepSize;
            const x = ox + dx * t;
            const y = oy + dy * t;
            const z = oz + dz * t;
            
            const density = this.sampleDensity(x, y, z);
            
            // Crossed surface (sign change)
            if (density < 0 && prevDensity >= 0) {
                // Binary search for precise intersection
                let tLow = t - stepSize;
                let tHigh = t;
                for (let i = 0; i < 8; i++) {
                    const tMid = (tLow + tHigh) / 2;
                    const px = ox + dx * tMid;
                    const py = oy + dy * tMid;
                    const pz = oz + dz * tMid;
                    if (this.sampleDensity(px, py, pz) < 0) {
                        tHigh = tMid;
                    } else {
                        tLow = tMid;
                    }
                }
                
                const hitT = (tLow + tHigh) / 2;
                const hitX = ox + dx * hitT;
                const hitY = oy + dy * hitT;
                const hitZ = oz + dz * hitT;
                
                return {
                    x: hitX,
                    y: hitY,
                    z: hitZ,
                    distance: hitT,
                    normal: this.getTerrainNormal(hitX, hitY, hitZ),
                };
            }
            
            prevDensity = density;
        }
        
        return null;
    }
    
    /**
     * Check sphere collision with terrain
     * @param {number} cx - Sphere center X
     * @param {number} cy - Sphere center Y
     * @param {number} cz - Sphere center Z
     * @param {number} radius - Sphere radius
     * @returns {Object|null} {penetration, normal} or null if no collision
     */
    sphereCollision(cx, cy, cz, radius) {
        const density = this.sampleDensity(cx, cy, cz);
        
        if (density < radius) {
            const penetration = radius - density;
            const normal = this.getTerrainNormal(cx, cy, cz);
            
            return {
                penetration,
                normal,
                // Push-out position
                pushX: cx + normal.x * penetration,
                pushY: cy + normal.y * penetration,
                pushZ: cz + normal.z * penetration,
            };
        }
        
        return null;
    }
    
    // ========================================================================
    // TERRAIN NORMAL SAMPLING (GPU Gems 3 Style)
    // For lighting foreign objects from terrain
    // ========================================================================
    
    /**
     * Get terrain surface normal at position using gradient of density
     * @param {number} wx - World X
     * @param {number} wy - World Y
     * @param {number} wz - World Z
     * @param {number} epsilon - Sample offset for gradient
     * @returns {{x: number, y: number, z: number}} Normalized surface normal
     */
    getTerrainNormal(wx, wy, wz, epsilon = 0.1) {
        // Central difference gradient of density field
        const dx = this.sampleDensity(wx + epsilon, wy, wz) - 
                   this.sampleDensity(wx - epsilon, wy, wz);
        const dy = this.sampleDensity(wx, wy + epsilon, wz) - 
                   this.sampleDensity(wx, wy - epsilon, wz);
        const dz = this.sampleDensity(wx, wy, wz + epsilon) - 
                   this.sampleDensity(wx, wy, wz - epsilon);
        
        // Normalize
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 0.0001) {
            return { x: 0, y: 1, z: 0 }; // Default up
        }
        
        return {
            x: dx / len,
            y: dy / len,
            z: dz / len,
        };
    }
    
    /**
     * Sample ambient lighting from terrain at position
     * Combines surface normal, sky visibility, and AO
     * @param {number} wx - World X
     * @param {number} wy - World Y
     * @param {number} wz - World Z
     * @param {Object} sunDir - Sun direction {x, y, z}
     * @returns {Object} {diffuse, ambient, shadow}
     */
    sampleTerrainLighting(wx, wy, wz, sunDir = { x: 0.5, y: 0.8, z: 0.3 }) {
        const normal = this.getTerrainNormal(wx, wy, wz);
        
        // Diffuse lighting (N dot L)
        const NdotL = Math.max(0, 
            normal.x * sunDir.x + 
            normal.y * sunDir.y + 
            normal.z * sunDir.z
        );
        
        // Simple sky visibility (ray up)
        const skyRay = this.raycastTerrain(wx, wy, wz, 0, 1, 0, 50, 1);
        const skyVisible = skyRay === null ? 1 : 0;
        
        // Ambient occlusion (sample density around point)
        let ao = 0;
        const aoSamples = 6;
        const aoRadius = 2;
        for (let i = 0; i < aoSamples; i++) {
            const angle = (i / aoSamples) * Math.PI * 2;
            const sx = wx + Math.cos(angle) * aoRadius;
            const sz = wz + Math.sin(angle) * aoRadius;
            const density = this.sampleDensity(sx, wy, sz);
            ao += density < 0 ? 1 : 0;
        }
        ao = 1 - (ao / aoSamples) * 0.5;
        
        return {
            diffuse: NdotL,
            ambient: 0.3 + skyVisible * 0.2,
            ao,
            combined: NdotL * 0.6 + (0.3 + skyVisible * 0.1) * ao,
        };
    }
    
    /**
     * Get lighting influence for an object at position
     * Used for dynamic objects to match terrain lighting
     * @param {number} wx - World X
     * @param {number} wy - World Y
     * @param {number} wz - World Z
     * @returns {Object} Lighting parameters for shaders
     */
    getObjectLighting(wx, wy, wz) {
        const surfaceHeight = this.getHeight(wx, wz);
        const isUnderground = wy < surfaceHeight;
        const biome = this.getBiome(wx, wz);
        
        // Get terrain normal at nearest surface point
        const surfaceNormal = this.getTerrainNormal(wx, surfaceHeight, wz);
        
        // Bounce light color from terrain
        const biomeColors = {
            plains: { r: 0.4, g: 0.6, b: 0.3 },
            forest: { r: 0.2, g: 0.4, b: 0.2 },
            desert: { r: 0.8, g: 0.7, b: 0.5 },
            snow: { r: 0.9, g: 0.95, b: 1.0 },
            swamp: { r: 0.3, g: 0.4, b: 0.3 },
        };
        const bounceColor = biomeColors[this.getTerrainType(wx, wz)] || 
                           { r: 0.5, g: 0.5, b: 0.5 };
        
        return {
            surfaceNormal,
            bounceColor,
            isUnderground,
            depthFactor: isUnderground ? Math.min(1, (surfaceHeight - wy) / 50) : 0,
            ambientBoost: isUnderground ? 0.1 : 0.3,
        };
    }
}

export default WorldGenerator;
