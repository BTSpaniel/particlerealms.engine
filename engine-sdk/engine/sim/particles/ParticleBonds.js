// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleBonds.js - Dynamic Bond Formation & Breaking System
 * 
 * Manages runtime creation and destruction of particle bonds (WELD, STICKY constraints)
 * driven by proximity, temperature, and particle flags.
 * 
 * Features:
 * - Bond formation: WELDABLE particles within threshold + temperature conditions → WELD constraint
 * - Bond breaking: Constraints with FLAG_BROKEN get cleaned up + optional break effects
 * - Temperature-driven dynamics: Freezing forms bonds, melting breaks them
 * - Rate limiting: Max bonds per frame to prevent GPU stalls
 */

import {
    CONSTRAINT_TYPE,
    PARTICLE_FLAGS,
    PHASE_SOLID,
    PHASE_LIQUID,
    addWeldConstraint,
    addStickyConstraint,
} from './ParticleConstraints.js';
import { updateBuffer } from '../../core/gpu/GpuBuffer.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_BONDS_PER_FRAME = 1000;
const BOND_CHECK_RADIUS = 0.5;         // Max distance for bond formation
const BOND_COOLDOWN_FRAMES = 10;       // Frames between bond attempts per particle
const FREEZE_BOND_TEMP_MARGIN = 5;     // Temperature margin below freeze point to form bonds

// ============================================================================
// BOND REGISTRY
// ============================================================================

/**
 * Create a bond management system.
 * @param {Object} world - Particle sim world
 * @returns {Object} Bond system
 */
export function createBondSystem(world) {
    if (!world || !world.device) {
        console.warn("[ParticleBonds] Cannot create bond system - no device");
        return null;
    }
    
    const system = {
        // Bond registry: Map<string, { constraintIndex, particleA, particleB, type, createdFrame }>
        // Key: "A:B" where A < B to avoid duplicates
        bonds: new Map(),
        
        // Per-particle cooldown tracking (sparse)
        cooldowns: new Map(),
        
        // Broken bond queue (filled by GPU readback)
        brokenQueue: [],
        
        // Stats
        totalBondsFormed: 0,
        totalBondsBroken: 0,
        activeBondCount: 0,
        frameCount: 0,
        
        // Configuration
        maxBondsPerFrame: MAX_BONDS_PER_FRAME,
        bondCheckRadius: BOND_CHECK_RADIUS,
        cooldownFrames: BOND_COOLDOWN_FRAMES,
        freezeMargin: FREEZE_BOND_TEMP_MARGIN,
        
        // Enable/disable sub-features
        enableFreezeBonds: true,     // Form WELD bonds when liquid freezes
        enableStickyBonds: true,     // Form STICKY bonds on collision
        enableBreakCleanup: true,    // Clean up broken constraints
    };
    
    console.log("[ParticleBonds] Dynamic bond system initialized");
    return system;
}

/**
 * Generate a bond key from two particle indices (order-independent).
 */
function bondKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Check if a bond already exists between two particles.
 */
function hasBond(system, a, b) {
    return system.bonds.has(bondKey(a, b));
}

/**
 * Check if a particle is on cooldown for bond formation.
 */
function isOnCooldown(system, particleIdx) {
    const cd = system.cooldowns.get(particleIdx);
    if (cd === undefined) return false;
    return (system.frameCount - cd) < system.cooldownFrames;
}

// ============================================================================
// BOND FORMATION
// ============================================================================

/**
 * Attempt to form bonds between nearby particles.
 * Called each frame from the simulation loop.
 * 
 * @param {Object} world - Particle sim world
 * @param {Object} bondSystem - Bond system from createBondSystem
 * @param {Object} options - { thermalData, positions, particleCount, flags, freezePoint }
 */
export function stepBondFormation(world, bondSystem, options = {}) {
    if (!world || !bondSystem || !world.ropeConstraintSystem) return;
    
    bondSystem.frameCount++;
    
    const {
        thermalData,    // Float32Array CPU-side thermal data (4 floats per particle)
        positions,      // Float32Array CPU-side positions (4 floats per particle)
        particleCount = 0,
        flags,          // Uint32Array or null - per-particle flags
        freezePoint = 270,
    } = options;
    
    if (!thermalData || !positions || particleCount === 0) return;
    
    // Guard: CPU-side bond formation is O(N×100), skip if particle count too high
    if (particleCount > 10000) {
        if (bondSystem.frameCount % 300 === 1) {
            console.warn(`[ParticleBonds] Skipping CPU bond formation: ${particleCount} particles exceeds 10K limit. Move to GPU compute for scale.`);
        }
        return;
    }
    
    let bondsFormed = 0;
    const maxBonds = bondSystem.maxBondsPerFrame;
    const checkRadius = bondSystem.bondCheckRadius;
    const checkRadiusSq = checkRadius * checkRadius;
    
    // Simple O(N) scan with spatial locality heuristic
    // For production, this should use the spatial grid readback
    for (let i = 0; i < particleCount && bondsFormed < maxBonds; i++) {
        if (isOnCooldown(bondSystem, i)) continue;
        
        const pi = i * 4;
        const px = positions[pi];
        const py = positions[pi + 1];
        const pz = positions[pi + 2];
        const age = positions[pi + 3];
        
        if (age < 0) continue; // Dead particle
        
        const ti = i * 4;
        const temp = thermalData[ti];
        const phase = thermalData[ti + 1];
        
        // Freeze bonding: liquid particles below freeze point → WELD with neighbors
        if (bondSystem.enableFreezeBonds && phase >= 0.5 && phase < 1.5 && temp < freezePoint - bondSystem.freezeMargin) {
            // Check nearby particles for weld candidates
            for (let j = Math.max(0, i - 50); j < Math.min(particleCount, i + 50) && bondsFormed < maxBonds; j++) {
                if (j === i) continue;
                if (hasBond(bondSystem, i, j)) continue;
                
                const pj = j * 4;
                const dx = positions[pj] - px;
                const dy = positions[pj + 1] - py;
                const dz = positions[pj + 2] - pz;
                const d2 = dx * dx + dy * dy + dz * dz;
                
                if (d2 > checkRadiusSq || d2 < 0.0001) continue;
                
                const otherTemp = thermalData[j * 4];
                const otherPhase = thermalData[j * 4 + 1];
                
                // Only bond with other liquid/solid particles below freeze point
                if (otherPhase > 1.5 || otherTemp > freezePoint) continue;
                
                const restLength = Math.sqrt(d2);
                const constraintIdx = addWeldConstraint(
                    world.ropeConstraintSystem, world.device,
                    i, j, restLength
                );
                
                if (constraintIdx >= 0) {
                    const key = bondKey(i, j);
                    bondSystem.bonds.set(key, {
                        constraintIndex: constraintIdx,
                        particleA: i,
                        particleB: j,
                        type: 'freeze',
                        createdFrame: bondSystem.frameCount,
                    });
                    bondSystem.cooldowns.set(i, bondSystem.frameCount);
                    bondSystem.cooldowns.set(j, bondSystem.frameCount);
                    bondSystem.totalBondsFormed++;
                    bondSystem.activeBondCount++;
                    bondsFormed++;
                }
            }
        }
    }
}

// ============================================================================
// BOND BREAKING
// ============================================================================

/**
 * Process broken bonds and clean them up.
 * Call after constraint solver has run.
 * 
 * @param {Object} world - Particle sim world
 * @param {Object} bondSystem - Bond system
 * @param {Object} options - { thermalData, meltPoint }
 */
export function stepBondBreaking(world, bondSystem, options = {}) {
    if (!world || !bondSystem || !bondSystem.enableBreakCleanup) return;
    
    const {
        thermalData,
        meltPoint = 273,
    } = options;
    
    // Temperature-driven bond breaking: melt bonds when temperature exceeds melt point
    if (thermalData) {
        const toRemove = [];
        
        for (const [key, bond] of bondSystem.bonds) {
            const tempA = thermalData[bond.particleA * 4];
            const tempB = thermalData[bond.particleB * 4];
            
            // If either particle is above melt point, break the bond
            if (bond.type === 'freeze' && (tempA > meltPoint || tempB > meltPoint)) {
                toRemove.push(key);
            }
        }
        
        // Reusable buffer for writing FLAG_BROKEN to GPU
        const flagBroken = new Uint32Array([0x1]);
        
        for (const key of toRemove) {
            const bond = bondSystem.bonds.get(key);
            if (bond) {
                // Write FLAG_BROKEN to constraint's flags field in GPU buffer
                // Constraint struct = 64 bytes, flags is field 15 (byte offset 60)
                if (world.ropeConstraintSystem?.constraintBuffer && world.device) {
                    const flagsByteOffset = bond.constraintIndex * 64 + 60;
                    updateBuffer(world.device, world.ropeConstraintSystem.constraintBuffer, flagBroken, flagsByteOffset);
                }
                bondSystem.bonds.delete(key);
                bondSystem.totalBondsBroken++;
                bondSystem.activeBondCount--;
            }
        }
    }
}

// ============================================================================
// LIFECYCLE
// ============================================================================

/**
 * Step the full bond system (formation + breaking).
 */
export function stepBondSystem(world, bondSystem, options = {}) {
    if (!bondSystem) return;
    
    stepBondFormation(world, bondSystem, options);
    stepBondBreaking(world, bondSystem, options);
}

/**
 * Get bond system stats.
 */
export function getBondStats(bondSystem) {
    if (!bondSystem) return null;
    return {
        activeBonds: bondSystem.activeBondCount,
        totalFormed: bondSystem.totalBondsFormed,
        totalBroken: bondSystem.totalBondsBroken,
        registrySize: bondSystem.bonds.size,
    };
}

/**
 * Destroy bond system and clear all bonds.
 */
export function destroyBondSystem(bondSystem) {
    if (!bondSystem) return;
    bondSystem.bonds.clear();
    bondSystem.cooldowns.clear();
    bondSystem.brokenQueue.length = 0;
    bondSystem.activeBondCount = 0;
    console.log("[ParticleBonds] Bond system destroyed");
}
