// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelConstants.js - Shared Voxel System Constants
 * 
 * Central location for voxel system constants used across multiple files.
 * This avoids circular dependencies and provides a single source of truth.
 */

import { MATERIAL } from './MaterialSchema.js';

// ============================================================================
// CHUNK SIZE CONSTANTS
// ============================================================================

export const CHUNK_SIZE = 32;           // 32³ voxels per chunk
export const CHUNK_SIZE_SQ = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

// ============================================================================
// DEPTH TIER CONFIGURATION
// ============================================================================

/**
 * Depth tiers define how terrain generation changes with depth.
 * Each tier has different noise parameters, materials, and features.
 */
export const DEPTH_TIERS = [
    {
        name: 'Surface',
        minY: -100,      // Starts at Y=-100
        maxY: Infinity,  // Up to surface and above
        // Terrain generation - caves only deep underground
        caveFrequency: 0.04,
        caveDensity: 0.85,  // Very high = very few caves near surface
        caveSize: 0.3,      // Tiny caves if any
        primaryStone: MATERIAL.STONE,
        secondaryStone: MATERIAL.DIRT,
        rareOre: null,
        oreChance: 0,
        // Physics parameters
        gravity: 1.0,       // Normal gravity
        timeScale: 1.0,     // Normal time
        dragCoefficient: 0.1,
        // Visual/audio
        ambientLight: 1.0,
        fogDensity: 0.008,
        fogColor: [0.35, 0.45, 0.55],
        // Environmental hazards
        heatDamage: 0,        // Damage per second from heat
        pressureEffect: 0,    // Movement slowdown (0-1)
        darknessLevel: 0,     // Screen vignette intensity (0-1)
        oxygenDrain: 0,       // Future: oxygen consumption rate
    },
    {
        name: 'Underground',
        minY: -500,
        maxY: -100,
        caveFrequency: 0.06,
        caveDensity: 0.55,
        caveSize: 1.2,
        primaryStone: MATERIAL.STONE,
        secondaryStone: MATERIAL.DEEPSTONE,
        rareOre: MATERIAL.CRYSTAL,
        oreChance: 0.002,
        // Water features
        hasAquifer: true,       // Underground water pools
        aquiferLevel: -200,     // Base Y level for water
        // Physics
        gravity: 0.95,      // Slightly lighter
        timeScale: 1.0,
        dragCoefficient: 0.12,
        // Visual
        ambientLight: 0.6,
        fogDensity: 0.015,
        fogColor: [0.2, 0.25, 0.35],
        // Environmental hazards
        heatDamage: 0,
        pressureEffect: 0.05,   // Slight pressure
        darknessLevel: 0.2,     // Mild darkness
        oxygenDrain: 0,
    },
    {
        name: 'Deep',
        minY: -2000,
        maxY: -500,
        caveFrequency: 0.07,
        caveDensity: 0.45,
        caveSize: 1.5,
        primaryStone: MATERIAL.DEEPSTONE,
        secondaryStone: MATERIAL.OBSIDIAN,
        rareOre: MATERIAL.CRYSTAL,
        oreChance: 0.005,
        hasFungus: true,
        // Physics - heavier, compressed
        gravity: 0.85,
        timeScale: 1.1,     // Time feels slightly slower
        dragCoefficient: 0.15,
        // Visual
        ambientLight: 0.3,
        fogDensity: 0.025,
        fogColor: [0.15, 0.12, 0.2],
        // Environmental hazards
        heatDamage: 0,
        pressureEffect: 0.15,  // Moderate pressure
        darknessLevel: 0.4,    // Dark
        oxygenDrain: 0.1,      // Starting to need oxygen
    },
    {
        name: 'Abyss',
        minY: -5000,
        maxY: -2000,
        caveFrequency: 0.04,  // Lower freq = larger caves
        caveDensity: 0.35,    // More open
        caveSize: 2.0,        // Vast caverns
        primaryStone: MATERIAL.OBSIDIAN,
        secondaryStone: MATERIAL.VOIDSTONE,
        rareOre: MATERIAL.MAGMA,
        oreChance: 0.01,
        hasFungus: true,
        // Lava features
        hasLava: true,          // Lava pools at bottom of caves
        lavaLevel: -3500,       // Base Y level for lava
        // Physics - strange, floaty
        gravity: 0.5,       // Much lighter - floaty
        timeScale: 1.3,     // Time distortion
        dragCoefficient: 0.2,
        // Visual
        ambientLight: 0.15,
        fogDensity: 0.04,
        fogColor: [0.08, 0.05, 0.12],
        // Environmental hazards
        heatDamage: 2,         // Heat from magma (damage per second)
        pressureEffect: 0.3,   // Heavy pressure - slow movement
        darknessLevel: 0.6,    // Very dark
        oxygenDrain: 0.3,
    },
    {
        name: 'Void',
        minY: -10000,
        maxY: -5000,
        caveFrequency: 0.03,
        caveDensity: 0.25,    // Very open
        caveSize: 3.0,        // Massive caverns
        primaryStone: MATERIAL.VOIDSTONE,
        secondaryStone: MATERIAL.OBSIDIAN,
        rareOre: MATERIAL.ENERGY,
        oreChance: 0.008,
        // Physics - chaotic
        gravity: 0.2,       // Near weightless
        timeScale: 1.8,     // Major time distortion
        dragCoefficient: 0.05, // Less resistance
        // Visual
        ambientLight: 0.05,
        fogDensity: 0.02,   // Less fog, can see far
        fogColor: [0.02, 0.01, 0.05],
        // Environmental hazards
        heatDamage: 5,         // Extreme heat
        pressureEffect: 0.5,   // Crushing pressure
        darknessLevel: 0.85,   // Almost pitch black
        oxygenDrain: 0.5,
    },
    {
        name: 'Core',
        minY: -Infinity,
        maxY: -10000,
        caveFrequency: 0.02,
        caveDensity: 0.15,    // Mostly open void
        caveSize: 5.0,
        primaryStone: MATERIAL.VOIDSTONE,
        secondaryStone: MATERIAL.ENERGY,
        rareOre: MATERIAL.ENERGY,
        oreChance: 0.02,
        // Physics - zero gravity (Shell Theorem)
        gravity: 0.0,       // Zero-G at center
        timeScale: 0.5,     // Time slows drastically
        dragCoefficient: 0.0, // Frictionless void
        // Visual
        ambientLight: 0.02,
        fogDensity: 0.005,
        fogColor: [0.0, 0.0, 0.02],
        // Environmental hazards
        heatDamage: 10,        // Lethal heat
        pressureEffect: 0.7,   // Extreme pressure
        darknessLevel: 0.95,   // Total darkness
        oxygenDrain: 1.0,      // Instant suffocation
    },
];

/**
 * Get the depth tier configuration for a given Y coordinate
 * @param {number} y - World Y coordinate
 * @returns {Object} Depth tier config
 */
export function getDepthTier(y) {
    for (const tier of DEPTH_TIERS) {
        if (y >= tier.minY && y < tier.maxY) {
            return tier;
        }
    }
    return DEPTH_TIERS[DEPTH_TIERS.length - 1]; // Default to deepest
}

/**
 * Interpolate between depth tiers for smooth transitions
 * @param {number} y - World Y coordinate
 * @returns {{ tier: Object, nextTier: Object|null, blend: number }}
 */
export function getDepthTierBlend(y) {
    for (let i = 0; i < DEPTH_TIERS.length; i++) {
        const tier = DEPTH_TIERS[i];
        if (y >= tier.minY && y < tier.maxY) {
            const nextTier = DEPTH_TIERS[i + 1] || null;
            if (nextTier && y < tier.minY + 50) {
                // Blend zone at bottom of tier (50 units)
                const blend = (y - tier.minY) / 50;
                return { tier, nextTier, blend };
            }
            return { tier, nextTier: null, blend: 0 };
        }
    }
    return { tier: DEPTH_TIERS[DEPTH_TIERS.length - 1], nextTier: null, blend: 0 };
}

// ============================================================================
// FACE NORMALS (for meshing and culling)
// ============================================================================

export const FACE_NORMALS = [
    [1, 0, 0],   // +X
    [-1, 0, 0],  // -X
    [0, 1, 0],   // +Y
    [0, -1, 0],  // -Y
    [0, 0, 1],   // +Z
    [0, 0, -1],  // -Z
];

export const FACE_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
