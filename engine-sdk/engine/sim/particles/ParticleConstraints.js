// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleConstraints.js - GPU Constraint Solver for Rope/Wire/Cloth
 * 
 * Unified constraint system for particle-based physics:
 * - Distance constraints (maintain rest length between particles)
 * - Attachment constraints (pin particle to world position)
 * - Angle constraints (maintain angle between 3 particles) [future]
 * - Bending constraints (maintain curvature) [future]
 * 
 * Part of the Unified Rope-Particle System (Phase 2)
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer, destroyBuffers } from "../../core/gpu/GpuBuffer.js";
import { refreshConstraintSchedule } from "./ConstraintSchedule.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// Constraint type constants
export const CONSTRAINT_TYPE = {
    // Structural constraints
    DISTANCE: 0,           // Maintain distance between 2 particles
    ATTACHMENT: 1,         // Pin particle to world position
    ANGLE: 2,              // Maintain angle between 3 particles (bending)
    BENDING: 3,            // Bending resistance (alias for ANGLE)
    ROPE_INEXTENSIBLE: 4,  // Hard rope constraint with mass-aware solving
    DIHEDRAL: 5,           // Angle between 2 triangles (cloth folding)
    AREA: 6,               // Maintain triangle area (cloth)
    VOLUME: 7,             // Maintain tetrahedron volume (soft body)
    
    // Interaction constraints
    COLLISION: 10,         // Particle-particle/surface collision
    FRICTION: 11,          // Resist sliding motion on contact
    STICKY: 12,            // Adhesion - particles stick to surfaces
    COHESION: 13,          // Particles attract each other
    
    // Special constraints
    WELD: 20,              // Permanently join particles
    SPRING: 21,            // Spring connection (can compress & extend)
    PRESSURE: 22,          // Internal pressure (balloons)
};

// Interaction/material property flags (can be combined)
export const PARTICLE_FLAGS = {
    NONE: 0,
    STICKY: 1 << 0,        // Sticks to surfaces on contact
    BOUNCY: 1 << 1,        // High restitution
    SLIPPERY: 1 << 2,      // Low friction
    VISCOUS: 1 << 3,       // Resists flow
    COHESIVE: 1 << 4,      // Attracts same-type particles
    BREAKABLE: 1 << 5,     // Can break connections
    WELDABLE: 1 << 6,      // Can form new connections
    BUOYANT: 1 << 7,       // Affected by fluid buoyancy
};

// Chain physics defaults
export const CHAIN_PHYSICS_DEFAULTS = {
    chainStrength: Infinity,     // Max tension (N) before breaking
    chainStiffness: 1.0,         // How rigidly chain enforces length (0-1)
    tensionStiffness: 50.0,     // Force multiplier for soft coupling
    enableMassAware: true,      // Use mass-based correction distribution
};
/** @deprecated Use CHAIN_PHYSICS_DEFAULTS */
export const ROPE_PHYSICS_DEFAULTS = CHAIN_PHYSICS_DEFAULTS;

// Material presets for quick setup
export const PARTICLE_MATERIAL_PRESETS = {
    rope: { friction: 0.5, restitution: 0.1, flags: 0 },
    rubber: { friction: 0.8, restitution: 0.8, flags: PARTICLE_FLAGS.BOUNCY },
    slime: { friction: 0.3, restitution: 0.2, flags: PARTICLE_FLAGS.STICKY | PARTICLE_FLAGS.COHESIVE },
    water: { friction: 0.0, restitution: 0.0, flags: PARTICLE_FLAGS.COHESIVE | PARTICLE_FLAGS.SLIPPERY },
    honey: { friction: 0.9, restitution: 0.0, flags: PARTICLE_FLAGS.STICKY | PARTICLE_FLAGS.VISCOUS },
    cloth: { friction: 0.4, restitution: 0.1, flags: PARTICLE_FLAGS.BREAKABLE },
    chain: { friction: 0.3, restitution: 0.3, flags: 0 },
    web: { friction: 0.2, restitution: 0.0, flags: PARTICLE_FLAGS.STICKY | PARTICLE_FLAGS.BREAKABLE },
    balloon: { friction: 0.1, restitution: 0.6, flags: PARTICLE_FLAGS.BOUNCY },
    mud: { friction: 0.7, restitution: 0.0, flags: PARTICLE_FLAGS.STICKY | PARTICLE_FLAGS.VISCOUS | PARTICLE_FLAGS.COHESIVE },
};

// Phase constants
export const PHASE_SOLID = 0;
export const PHASE_LIQUID = 1;
export const PHASE_GAS = 2;
export const PHASE_PLASMA = 3;

// Thermal material presets - temperatures in Kelvin
// conductivity: heat transfer rate (W/mK normalized to 0-1)
// meltPoint: solid → liquid transition temperature
// boilPoint: liquid → gas transition temperature
// latentHeat: energy absorbed during phase change (slows transition)
export const THERMAL_MATERIAL_PRESETS = {
    water:  { conductivity: 0.6, meltPoint: 273, boilPoint: 373, latentHeat: 0.5 },
    ice:    { conductivity: 0.8, meltPoint: 273, boilPoint: 373, latentHeat: 0.5 },
    metal:  { conductivity: 1.0, meltPoint: 1800, boilPoint: 3000, latentHeat: 0.8 },
    wood:   { conductivity: 0.1, meltPoint: 600, boilPoint: 900, latentHeat: 0.2 },
    wax:    { conductivity: 0.3, meltPoint: 330, boilPoint: 600, latentHeat: 0.3 },
    lava:   { conductivity: 0.7, meltPoint: 1000, boilPoint: 2500, latentHeat: 0.9 },
    oil:    { conductivity: 0.2, meltPoint: 250, boilPoint: 500, latentHeat: 0.3 },
    glass:  { conductivity: 0.5, meltPoint: 1400, boilPoint: 2800, latentHeat: 0.7 },
    stone:  { conductivity: 0.4, meltPoint: 1500, boilPoint: 3000, latentHeat: 0.9 },
    plasma: { conductivity: 1.0, meltPoint: 0, boilPoint: 0, latentHeat: 0.0 },
    // Reaction-identity materials (indices 11-15, matching unified MATERIAL enum)
    fire:   { conductivity: 0.3, meltPoint: 0, boilPoint: 0, latentHeat: 0.0 },
    smoke:  { conductivity: 0.05, meltPoint: 0, boilPoint: 0, latentHeat: 0.0 },
    steam:  { conductivity: 0.4, meltPoint: 0, boilPoint: 373, latentHeat: 0.3 },
    sparks: { conductivity: 0.8, meltPoint: 1800, boilPoint: 3000, latentHeat: 0.5 },
    debris: { conductivity: 0.4, meltPoint: 1500, boilPoint: 3000, latentHeat: 0.9 },
};

// Reusable buffers for hot paths
const _constraintParamsF32 = new Float32Array(8);
const _constraintParamsU32 = new Uint32Array(_constraintParamsF32.buffer);

// ============================================================================
// ROPE CONSTRAINT SHADER
// ============================================================================

const ROPE_CONSTRAINT_SHADER = `
// ============================================================================
// PARTICLE CONSTRAINT SHADER - UNTESTED - Based on PBD/XPBD research papers
// References:
// - "Position Based Dynamics" (Müller et al. 2007)
// - "XPBD: Position-Based Simulation of Compliant Constrained Dynamics" (Macklin 2016)
// - "Unified Particle Physics" (Macklin 2014)
// - "A Survey on Position Based Dynamics" (Bender, Müller, Macklin 2017)
// ============================================================================

// Constraint types - Structural
const CONSTRAINT_DISTANCE: u32 = 0u;
const CONSTRAINT_ATTACHMENT: u32 = 1u;
const CONSTRAINT_ANGLE: u32 = 2u;
const CONSTRAINT_BENDING: u32 = 3u;
const CONSTRAINT_ROPE_INEXTENSIBLE: u32 = 4u;
const CONSTRAINT_DIHEDRAL: u32 = 5u;   // Angle between 2 triangles (cloth)
const CONSTRAINT_AREA: u32 = 6u;       // Triangle area preservation
const CONSTRAINT_VOLUME: u32 = 7u;     // Tetrahedron volume

// Constraint types - Interaction
const CONSTRAINT_COLLISION: u32 = 10u;
const CONSTRAINT_FRICTION: u32 = 11u;
const CONSTRAINT_STICKY: u32 = 12u;    // Adhesion to surfaces
const CONSTRAINT_COHESION: u32 = 13u;  // Particle-particle attraction

// Constraint types - Special
const CONSTRAINT_WELD: u32 = 20u;      // Permanent join
const CONSTRAINT_SPRING: u32 = 21u;    // Compressible distance
const CONSTRAINT_PRESSURE: u32 = 22u;  // Internal pressure

// Particle flags (stored in velocity.w or positions.w upper bits)
const FLAG_BROKEN: u32 = 0x1u;
const FLAG_MASS_AWARE: u32 = 0x2u;
const FLAG_STICKY: u32 = 0x4u;
const FLAG_BOUNCY: u32 = 0x8u;

struct ConstraintParams {
    constraintCount: u32,
    substep: u32,
    dt: f32,
    compliance: f32,
    chainStiffness: f32,
    chainStrength: f32,
    tensionStiffness: f32,
    enableMassAware: u32,
}

// 64 bytes per constraint
struct Constraint {
    type_: u32,
    particleA: u32,
    particleB: u32,
    particleC: u32,      // For 3-particle constraints (bending, area)
    restValue: f32,      // Rest length/angle/area/volume
    stiffness: f32,
    compliance: f32,
    massA: f32,
    attachmentX: f32,    // Also: extra param 1 (friction, restitution)
    attachmentY: f32,    // Also: extra param 2 (cohesion strength)
    attachmentZ: f32,    // Also: extra param 3 (adhesion radius)
    massB: f32,
    chainStiffness: f32,
    tensionStiffness: f32,
    maxTension: f32,
    flags: u32,
}

@group(0) @binding(0) var<uniform> params: ConstraintParams;
@group(0) @binding(1) var<storage, read_write> constraints: array<Constraint>;
@group(0) @binding(2) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> thermalData: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> schedule: array<u32>;

// Per-material melt points (inline LUT matching THERMAL_MATERIAL_PRESETS)
// Index: 0=default(800), 1=water(273), 2=ice(273), 3=metal(1800), 4=wood(500),
//        5=wax(330), 6=lava(1500), 7=oil(600), 8=glass(1400), 9=stone(2000), 10=plasma(5000)
//        11=fire(0), 12=smoke(0), 13=steam(0), 14=sparks(1800), 15=debris(1500)
fn getMeltPointForMaterial(matIdx: u32) -> f32 {
    switch(matIdx) {
        case 1u, 2u: { return 273.0; }
        case 3u: { return 1800.0; }
        case 4u: { return 500.0; }
        case 5u: { return 330.0; }
        case 6u: { return 1500.0; }
        case 7u: { return 600.0; }
        case 8u: { return 1400.0; }
        case 9u: { return 2000.0; }
        case 10u: { return 5000.0; }
        case 11u, 12u, 13u: { return 0.0; }
        case 14u: { return 1800.0; }
        case 15u: { return 1500.0; }
        default: { return 800.0; }
    }
}

// Temperature-dependent stiffness: hot materials are softer
// Returns a multiplier 0.1 (very hot) to 1.0 (cold/room temp)
// Uses per-material melt point from thermalData.z material index
fn thermalStiffnessModifier(particleIdx: u32) -> f32 {
    let temp = thermalData[particleIdx].x;
    let phase = thermalData[particleIdx].y;
    // Liquid/gas/plasma constraints are always soft
    if (phase >= 1.0) { return 0.3; }
    // Decode material index from lower 8 bits of thermalData.z
    let matIdx = min(u32(thermalData[particleIdx].z) & 0xFFu, 10u);
    let meltPoint = getMeltPointForMaterial(matIdx);
    // Soften as temperature approaches melt point (start weakening at 80% of melt)
    let softenStart = meltPoint * 0.8;
    if (temp > softenStart) {
        return clamp(1.0 - (temp - softenStart) / (meltPoint - softenStart + 1.0), 0.1, 1.0);
    }
    return 1.0;
}

@compute @workgroup_size(256)
fn solveConstraints(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.constraintCount) { return; }
    let i = schedule[params.substep + gid.x];
    
    var c = constraints[i];
    
    // Skip broken constraints
    if ((c.flags & FLAG_BROKEN) != 0u) { return; }
    
    // Apply thermal stiffness modulation to constraint
    let thermalMod = thermalStiffnessModifier(c.particleA);
    c.stiffness = c.stiffness * thermalMod;
    
    switch (c.type_) {
        case CONSTRAINT_DISTANCE: { solveDistanceConstraint(c); }
        case CONSTRAINT_ATTACHMENT: { solveAttachmentConstraint(c); }
        case CONSTRAINT_ROPE_INEXTENSIBLE: { solveRopeInextensibleConstraint(i, &c); }
        case CONSTRAINT_ANGLE, CONSTRAINT_BENDING: { solveBendingConstraint(c); }
        case CONSTRAINT_SPRING: { solveSpringConstraint(c); }
        case CONSTRAINT_STICKY: { solveStickyConstraint(i, &c); }
        case CONSTRAINT_COHESION: { solveCohesionConstraint(c); }
        case CONSTRAINT_COLLISION: { solveCollisionConstraint(i, &c); }
        case CONSTRAINT_WELD: { solveWeldConstraint(c); }
        default: {}
    }
}

fn solveDistanceConstraint(c: Constraint) {
    let posA = positions[c.particleA].xyz;
    let posB = positions[c.particleB].xyz;
    
    let delta = posB - posA;
    let dist = length(delta);
    
    // Avoid division by zero
    if (dist < 0.0001) { return; }
    
    let diff = (dist - c.restValue) / dist;
    let correction = delta * diff * 0.5 * c.stiffness;
    
    // Apply position correction (equal mass assumption)
    positions[c.particleA] = vec4<f32>(posA + correction, positions[c.particleA].w);
    positions[c.particleB] = vec4<f32>(posB - correction, positions[c.particleB].w);
    
    // Apply velocity damping along constraint direction
    let velA = velocities[c.particleA].xyz;
    let velB = velocities[c.particleB].xyz;
    let relVel = velB - velA;
    let normalDir = delta / dist;
    let dampingFactor = 0.02; // Small damping to stabilize
    let dampingForce = dot(relVel, normalDir) * dampingFactor * normalDir;
    
    velocities[c.particleA] = vec4<f32>(velA + dampingForce * 0.5, velocities[c.particleA].w);
    velocities[c.particleB] = vec4<f32>(velB - dampingForce * 0.5, velocities[c.particleB].w);
}

fn solveAttachmentConstraint(c: Constraint) {
    let posA = positions[c.particleA].xyz;
    let attachPos = vec3<f32>(c.attachmentX, c.attachmentY, c.attachmentZ);
    
    // Hard constraint - move directly to attachment with stiffness
    let correction = (attachPos - posA) * c.stiffness;
    positions[c.particleA] = vec4<f32>(posA + correction, positions[c.particleA].w);
    
    // Kill velocity for attached particle (fully constrained)
    if (c.stiffness > 0.99) {
        velocities[c.particleA] = vec4<f32>(0.0, 0.0, 0.0, velocities[c.particleA].w);
    }
}

// Mass-aware rope inextensibility constraint
fn solveRopeInextensibleConstraint(constraintIdx: u32, c: ptr<function, Constraint>) {
    let posA = positions[(*c).particleA].xyz;
    let posB = positions[(*c).particleB].xyz;
    
    let delta = posB - posA;
    let dist = length(delta);
    
    if (dist < 0.0001) { return; }
    
    // Only apply constraint if stretched beyond rest length (rope, not spring)
    if (dist <= (*c).restValue) { return; }
    
    let excess = dist - (*c).restValue;
    let normalDir = delta / dist;
    
    // A zero mass denotes a pinned end. XPBD positional impulse / dt² is N.
    var invA = 1.0; var invB = 1.0;
    if (((*c).flags & FLAG_MASS_AWARE) != 0u) {
        invA = 0.0; invB = 0.0;
        if ((*c).massA > 0.0) { invA = 1.0 / (*c).massA; }
        if ((*c).massB > 0.0) { invB = 1.0 / (*c).massB; }
    }
    let weight = invA + invB;
    if (weight <= 0.0) { return; }
    let lambda = excess * (*c).chainStiffness * thermalStiffnessModifier((*c).particleA) / weight;
    let tension = lambda / max(params.dt * params.dt, 1e-12);
    if ((*c).maxTension > 0.0 && tension > (*c).maxTension) {
        constraints[constraintIdx].flags = (*c).flags | FLAG_BROKEN;
        return;
    }
    positions[(*c).particleA] = vec4<f32>(posA + normalDir * lambda * invA, positions[(*c).particleA].w);
    positions[(*c).particleB] = vec4<f32>(posB - normalDir * lambda * invB, positions[(*c).particleB].w);
    let velA = velocities[(*c).particleA].xyz;
    let velB = velocities[(*c).particleB].xyz;
    // One equal-and-opposite impulse removes separating relative velocity.
    // This conserves momentum and cannot increase kinetic energy.
    let impulse = max(0.0, dot(velB - velA, normalDir)) / weight;
    velocities[(*c).particleA] = vec4<f32>(velA + normalDir * impulse * invA, velocities[(*c).particleA].w);
    velocities[(*c).particleB] = vec4<f32>(velB - normalDir * impulse * invB, velocities[(*c).particleB].w);
}

// ============================================================================
// BENDING CONSTRAINT - UNTESTED
// Maintains angle between 3 particles (p0-p1-p2)
// Based on: C = acos(dot(e0, e1)) - restAngle
// where e0 = normalize(p0 - p1), e1 = normalize(p2 - p1)
// ============================================================================
fn solveBendingConstraint(c: Constraint) {
    let p0 = positions[c.particleA].xyz;
    let p1 = positions[c.particleB].xyz;  // Center particle
    let p2 = positions[c.particleC].xyz;
    
    let e0 = p0 - p1;
    let e1 = p2 - p1;
    let len0 = length(e0);
    let len1 = length(e1);
    
    if (len0 < 0.0001 || len1 < 0.0001) { return; }
    
    let n0 = e0 / len0;
    let n1 = e1 / len1;
    
    // Current angle via dot product
    let cosAngle = clamp(dot(n0, n1), -1.0, 1.0);
    let currentAngle = acos(cosAngle);
    let restAngle = c.restValue;
    
    // Angle difference
    let angleDiff = currentAngle - restAngle;
    if (abs(angleDiff) < 0.001) { return; }
    
    // Gradient approximation - push particles to restore angle
    // Use cross product for rotation axis
    let axis = cross(n0, n1);
    let axisLen = length(axis);
    if (axisLen < 0.0001) { return; }
    let axisNorm = axis / axisLen;
    
    // Apply correction perpendicular to edges
    let correction = angleDiff * c.stiffness * 0.5;
    let tangent0 = cross(axisNorm, n0);
    let tangent1 = cross(axisNorm, n1);
    
    // Move outer particles to adjust angle
    positions[c.particleA] = vec4<f32>(p0 - tangent0 * correction, positions[c.particleA].w);
    positions[c.particleC] = vec4<f32>(p2 + tangent1 * correction, positions[c.particleC].w);
}

// ============================================================================
// SPRING CONSTRAINT - UNTESTED
// Unlike distance constraint, springs can compress AND extend
// Uses Hooke's law: F = -k * (x - x0)
// ============================================================================
fn solveSpringConstraint(c: Constraint) {
    let posA = positions[c.particleA].xyz;
    let posB = positions[c.particleB].xyz;
    
    let delta = posB - posA;
    let dist = length(delta);
    
    if (dist < 0.0001) { return; }
    
    // Spring works in both directions (compression and extension)
    let diff = dist - c.restValue;
    let normalDir = delta / dist;
    
    // Apply Hooke's law with stiffness
    let springForce = diff * c.stiffness;
    let correction = normalDir * springForce * 0.5;
    
    // Mass-aware distribution
    var ratioA = 0.5;
    var ratioB = 0.5;
    if ((c.flags & FLAG_MASS_AWARE) != 0u && c.massA > 0.0 && c.massB > 0.0) {
        let invMassSum = (1.0 / c.massA) + (1.0 / c.massB);
        ratioA = (1.0 / c.massA) / invMassSum;
        ratioB = (1.0 / c.massB) / invMassSum;
    }
    
    positions[c.particleA] = vec4<f32>(posA + correction * ratioA, positions[c.particleA].w);
    positions[c.particleB] = vec4<f32>(posB - correction * ratioB, positions[c.particleB].w);
    
    // Velocity damping for springs (prevents oscillation)
    let velA = velocities[c.particleA].xyz;
    let velB = velocities[c.particleB].xyz;
    let relVel = velB - velA;
    let dampingCoeff = 0.1 * c.stiffness;  // Damping proportional to stiffness
    let dampingForce = dot(relVel, normalDir) * dampingCoeff * normalDir;
    
    velocities[c.particleA] = vec4<f32>(velA + dampingForce * ratioA, velocities[c.particleA].w);
    velocities[c.particleB] = vec4<f32>(velB - dampingForce * ratioB, velocities[c.particleB].w);
}

// ============================================================================
// STICKY CONSTRAINT - UNTESTED
// Adhesion - particle sticks to a surface or another particle
// Uses attachmentX/Y/Z as the stick target, or particleB if specified
// attachmentX also stores adhesion strength, attachmentY stores max break force
// ============================================================================
fn solveStickyConstraint(constraintIdx: u32, c: ptr<function, Constraint>) {
    let posA = positions[(*c).particleA].xyz;
    
    // Determine target position
    var targetPos: vec3<f32>;
    if ((*c).particleB != 0xFFFFFFFFu) {
        // Stick to another particle
        targetPos = positions[(*c).particleB].xyz;
    } else {
        // Stick to world position
        targetPos = vec3<f32>((*c).attachmentX, (*c).attachmentY, (*c).attachmentZ);
    }
    
    let delta = targetPos - posA;
    let dist = length(delta);
    
    // Adhesion strength (stored in tensionStiffness)
    let adhesionStrength = (*c).tensionStiffness;
    
    // Check break threshold (stored in maxTension)
    if ((*c).maxTension > 0.0 && dist > (*c).maxTension) {
        // Break the sticky bond
        constraints[constraintIdx].flags = (*c).flags | FLAG_BROKEN;
        return;
    }
    
    // Pull particle toward target
    if (dist > 0.0001) {
        let normalDir = delta / dist;
        let pullStrength = min(dist, adhesionStrength * (*c).stiffness);
        let correction = normalDir * pullStrength;
        
        positions[(*c).particleA] = vec4<f32>(posA + correction, positions[(*c).particleA].w);
        
        // Also slow down velocity when stuck
        let velA = velocities[(*c).particleA].xyz;
        let damping = 0.8;  // High damping for sticky particles
        velocities[(*c).particleA] = vec4<f32>(velA * damping, velocities[(*c).particleA].w);
    }
}

// ============================================================================
// COHESION CONSTRAINT - UNTESTED
// Particles attract each other (like water droplets)
// Based on SPH-style attraction within a radius
// restValue = cohesion radius, stiffness = attraction strength
// ============================================================================
fn solveCohesionConstraint(c: Constraint) {
    let posA = positions[c.particleA].xyz;
    let posB = positions[c.particleB].xyz;
    
    let delta = posB - posA;
    let dist = length(delta);
    let cohesionRadius = c.restValue;
    
    // Only attract within cohesion radius
    if (dist >= cohesionRadius || dist < 0.0001) { return; }
    
    let normalDir = delta / dist;
    
    // Attraction falls off with distance (smooth kernel)
    let t = dist / cohesionRadius;
    let falloff = (1.0 - t) * (1.0 - t);  // Quadratic falloff
    
    // Pull particles together
    let attractionForce = falloff * c.stiffness * 0.5;
    let correction = normalDir * attractionForce;
    
    // Mass-aware (heavier particles move less)
    var ratioA = 0.5;
    var ratioB = 0.5;
    if ((c.flags & FLAG_MASS_AWARE) != 0u && c.massA > 0.0 && c.massB > 0.0) {
        let invMassSum = (1.0 / c.massA) + (1.0 / c.massB);
        ratioA = (1.0 / c.massA) / invMassSum;
        ratioB = (1.0 / c.massB) / invMassSum;
    }
    
    positions[c.particleA] = vec4<f32>(posA + correction * ratioA, positions[c.particleA].w);
    positions[c.particleB] = vec4<f32>(posB - correction * ratioB, positions[c.particleB].w);
}

// ============================================================================
// COLLISION CONSTRAINT - UNTESTED
// Particle-particle collision with friction and restitution
// restValue = collision radius (sum of particle radii)
// attachmentX = friction coefficient (0-1)
// attachmentY = restitution/bounce coefficient (0-1)
// ============================================================================
fn solveCollisionConstraint(constraintIdx: u32, c: ptr<function, Constraint>) {
    let posA = positions[(*c).particleA].xyz;
    let posB = positions[(*c).particleB].xyz;
    
    let delta = posB - posA;
    let dist = length(delta);
    let minDist = (*c).restValue;  // Combined radii
    
    // No collision if particles are separated
    if (dist >= minDist || dist < 0.0001) { return; }
    
    let normalDir = delta / dist;
    let penetration = minDist - dist;
    
    // Separate particles (position correction)
    var ratioA = 0.5;
    var ratioB = 0.5;
    if (((*c).flags & FLAG_MASS_AWARE) != 0u && (*c).massA > 0.0 && (*c).massB > 0.0) {
        let invMassSum = (1.0 / (*c).massA) + (1.0 / (*c).massB);
        ratioA = (1.0 / (*c).massA) / invMassSum;
        ratioB = (1.0 / (*c).massB) / invMassSum;
    }
    
    let correction = normalDir * penetration * 0.5;
    positions[(*c).particleA] = vec4<f32>(posA - correction * ratioA, positions[(*c).particleA].w);
    positions[(*c).particleB] = vec4<f32>(posB + correction * ratioB, positions[(*c).particleB].w);
    
    // Velocity response
    let velA = velocities[(*c).particleA].xyz;
    let velB = velocities[(*c).particleB].xyz;
    let relVel = velA - velB;
    let normalVel = dot(relVel, normalDir);
    
    // Only respond if particles are approaching
    if (normalVel < 0.0) { return; }
    
    // Restitution (bounce)
    let restitution = (*c).attachmentY;  // 0 = no bounce, 1 = perfect bounce
    let friction = (*c).attachmentX;     // 0 = frictionless, 1 = full friction
    
    // Normal impulse (bounce)
    let normalImpulse = normalDir * normalVel * (1.0 + restitution);
    
    // Tangential velocity (for friction)
    let tangentVel = relVel - normalDir * normalVel;
    let tangentLen = length(tangentVel);
    var frictionImpulse = vec3<f32>(0.0);
    if (tangentLen > 0.0001) {
        let tangentDir = tangentVel / tangentLen;
        // Coulomb friction: limit friction by normal force
        let maxFriction = normalVel * friction;
        let frictionMag = min(tangentLen, maxFriction);
        frictionImpulse = tangentDir * frictionMag;
    }
    
    let totalImpulse = normalImpulse + frictionImpulse;
    
    velocities[(*c).particleA] = vec4<f32>(velA - totalImpulse * ratioA, velocities[(*c).particleA].w);
    velocities[(*c).particleB] = vec4<f32>(velB + totalImpulse * ratioB, velocities[(*c).particleB].w);
}

// ============================================================================
// WELD CONSTRAINT - UNTESTED
// Permanently joins two particles at their current relative offset
// restValue = rest distance, but weld enforces exact distance
// Can break if maxTension exceeded
// ============================================================================
fn solveWeldConstraint(c: Constraint) {
    let posA = positions[c.particleA].xyz;
    let posB = positions[c.particleB].xyz;
    
    let delta = posB - posA;
    let dist = length(delta);
    
    if (dist < 0.0001) { return; }
    
    // Weld enforces EXACT rest distance (stiffness = 1.0 effectively)
    let diff = dist - c.restValue;
    if (abs(diff) < 0.0001) { return; }
    
    let normalDir = delta / dist;
    let correction = normalDir * diff * 0.5;
    
    // Equal distribution for welds (rigid connection)
    positions[c.particleA] = vec4<f32>(posA + correction, positions[c.particleA].w);
    positions[c.particleB] = vec4<f32>(posB - correction, positions[c.particleB].w);
    
    // Match velocities for welded particles
    let velA = velocities[c.particleA].xyz;
    let velB = velocities[c.particleB].xyz;
    let avgVel = (velA + velB) * 0.5;
    
    velocities[c.particleA] = vec4<f32>(avgVel, velocities[c.particleA].w);
    velocities[c.particleB] = vec4<f32>(avgVel, velocities[c.particleB].w);
}
`;

// ============================================================================
// CONSTRAINT SYSTEM CREATION
// ============================================================================

/**
 * Create rope/constraint solver system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} maxConstraints - Maximum number of constraints
 * @returns {Object} Constraint system object
 */
export function createRopeConstraintSystem(device, maxConstraints = 100000) {
    const shaderModule = device.createShaderModule({
        label: "RopeConstraint.shader",
        code: ROPE_CONSTRAINT_SHADER,
    });
    
    // Constraint buffer: 64 bytes per constraint (16 floats)
    const constraintBuffer = createStorageBuffer(device, maxConstraints * 64, {
        label: "RopeConstraint.constraints",
    });
    
    // Params buffer: 32 bytes (8 floats for extended params)
    const paramsBuffer = createUniformBuffer(device, 32, {
        label: "RopeConstraint.params",
    });
    
    const pipeline = device.createComputePipeline({
        label: "RopeConstraint.pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "solveConstraints" },
    });
    
    labelResource(constraintBuffer, "RopeConstraint.constraints");
    labelResource(paramsBuffer, "RopeConstraint.params");
    
    return {
        device, records: [], batches: [], scheduleDirty: true,
        scheduleBuffer: createStorageBuffer(device, maxConstraints * 4, { label: "RopeConstraint.schedule" }),
        shaderModule,
        constraintBuffer,
        paramsBuffer,
        pipeline,
        maxConstraints,
        constraintCount: 0,
        bindGroup: null,
        // Track constraint ranges per rope for efficient updates
        ropeConstraintRanges: new Map(), // entityId -> { start, count }
    };
}

/**
 * Initialize constraint system bind group
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUBuffer} positionsBuffer - Particle positions buffer
 * @param {GPUBuffer} velocitiesBuffer - Particle velocities buffer
 */
export function initRopeConstraintBindGroup(system, device, positionsBuffer, velocitiesBuffer, thermalBuffer) {
    for (const batch of system.batches) batch.params.destroy();
    system.batches = []; system.scheduleDirty = true;
    system.bindingEntries = [
        { binding: 0, resource: { buffer: system.paramsBuffer } },
        { binding: 1, resource: { buffer: system.constraintBuffer } },
        { binding: 2, resource: { buffer: positionsBuffer } },
        { binding: 3, resource: { buffer: velocitiesBuffer } },
        { binding: 4, resource: { buffer: thermalBuffer } },
        { binding: 5, resource: { buffer: system.scheduleBuffer } },
    ];
    system.bindGroup = device.createBindGroup({
        label: "RopeConstraint.bindGroup",
        layout: system.pipeline.getBindGroupLayout(0),
        entries: system.bindingEntries,
    });
}

// ============================================================================
// CONSTRAINT MANAGEMENT
// ============================================================================

/**
 * Add a distance constraint between two particles
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleA - First particle index
 * @param {number} particleB - Second particle index
 * @param {number} restLength - Rest length
 * @param {number} stiffness - Stiffness (0-1)
 * @returns {number} Constraint index or -1 if failed
 */
export function addDistanceConstraint(system, device, particleA, particleB, restLength, stiffness = 0.9) {
    if (system.constraintCount >= system.maxConstraints) {
        console.warn("[ChainConstraint] Max constraints reached");
        return -1;
    }
    
    // 64 bytes = 16 floats per constraint
    const constraintData = new Float32Array(16);
    const integers = new Uint32Array(constraintData.buffer);
    integers[0] = CONSTRAINT_TYPE.DISTANCE; // type
    integers[1] = particleA;                // particleA
    integers[2] = particleB;                // particleB
    integers[3] = 0;                        // particleC (unused)
    constraintData[4] = restLength;               // restValue
    constraintData[5] = stiffness;                // stiffness
    constraintData[6] = 0;                        // compliance
    constraintData[7] = 1.0;                      // massA (default 1.0)
    constraintData[8] = 0;                        // attachmentX
    constraintData[9] = 0;                        // attachmentY
    constraintData[10] = 0;                       // attachmentZ
    constraintData[11] = 1.0;                     // massB (default 1.0)
    constraintData[12] = 1.0;                     // chainStiffness
    constraintData[13] = 50.0;                    // tensionStiffness
    constraintData[14] = 0;                       // maxTension (0 = infinite)
    integers[15] = 0;                       // flags
    
    const offset = system.constraintCount * 64;
    updateBuffer(device, system.constraintBuffer, constraintData, offset);
    system.records[system.constraintCount] = integers.slice();
    system.scheduleDirty = true;
    
    system.constraintCount++;
    return system.constraintCount - 1;
}

/**
 * Add an attachment constraint (pin to world position)
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleIndex - Particle to attach
 * @param {Array<number>} worldPos - [x, y, z] world position
 * @param {number} stiffness - Stiffness (1.0 = hard constraint)
 * @returns {number} Constraint index or -1 if failed
 */
export function addAttachmentConstraint(system, device, particleIndex, worldPos, stiffness = 1.0) {
    if (system.constraintCount >= system.maxConstraints) {
        console.warn("[ChainConstraint] Max constraints reached");
        return -1;
    }
    
    // 64 bytes = 16 floats per constraint
    const constraintData = new Float32Array(16);
    const integers = new Uint32Array(constraintData.buffer);
    integers[0] = CONSTRAINT_TYPE.ATTACHMENT; // type
    integers[1] = particleIndex;               // particleA
    integers[2] = 0;                           // particleB (unused)
    integers[3] = 0;                           // particleC (unused)
    constraintData[4] = 0;                           // restValue (unused)
    constraintData[5] = stiffness;                   // stiffness
    constraintData[6] = 0;                           // compliance
    constraintData[7] = 1.0;                         // massA
    constraintData[8] = worldPos[0];                 // attachmentX
    constraintData[9] = worldPos[1];                 // attachmentY
    constraintData[10] = worldPos[2];                // attachmentZ
    constraintData[11] = 1.0;                        // massB
    constraintData[12] = 1.0;                        // chainStiffness
    constraintData[13] = 50.0;                       // tensionStiffness
    constraintData[14] = 0;                          // maxTension
    integers[15] = 0;                          // flags
    
    const offset = system.constraintCount * 64;
    updateBuffer(device, system.constraintBuffer, constraintData, offset);
    system.records[system.constraintCount] = integers.slice();
    system.scheduleDirty = true;
    
    system.constraintCount++;
    return system.constraintCount - 1;
}

/**
 * Add a rope inextensible constraint (mass-aware, with breaking support)
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleA - First particle index
 * @param {number} particleB - Second particle index
 * @param {number} restLength - Rest length
 * @param {Object} opts - Rope physics options
 * @returns {number} Constraint index or -1 if failed
 */
export function addRopeInextensibleConstraint(system, device, particleA, particleB, restLength, opts = {}) {
    if (system.constraintCount >= system.maxConstraints) {
        console.warn("[ChainConstraint] Max constraints reached");
        return -1;
    }
    
    const stiffness = opts.stiffness ?? 0.9;
    const massA = opts.massA ?? 1.0;
    const massB = opts.massB ?? 1.0;
    const chainStiffness = opts.chainStiffness ?? opts.ropeStiffness ?? CHAIN_PHYSICS_DEFAULTS.chainStiffness;
    const tensionStiffness = opts.tensionStiffness ?? CHAIN_PHYSICS_DEFAULTS.tensionStiffness;
    const maxTension = opts.chainStrength ?? opts.ropeStrength ?? 0; // 0 = infinite
    const enableMassAware = opts.enableMassAware ?? CHAIN_PHYSICS_DEFAULTS.enableMassAware;
    
    // Flags: 0x1 = broken, 0x2 = mass-aware
    let flags = 0;
    if (enableMassAware) flags |= 0x2;
    
    // 64 bytes = 16 floats per constraint
    const constraintData = new Float32Array(16);
    const integers = new Uint32Array(constraintData.buffer);
    integers[0] = CONSTRAINT_TYPE.ROPE_INEXTENSIBLE; // type
    integers[1] = particleA;                // particleA
    integers[2] = particleB;                // particleB
    integers[3] = 0;                        // particleC (unused)
    constraintData[4] = restLength;               // restValue
    constraintData[5] = stiffness;                // stiffness
    constraintData[6] = 0;                        // compliance
    constraintData[7] = massA;                    // massA
    constraintData[8] = 0;                        // attachmentX (unused)
    constraintData[9] = 0;                        // attachmentY (unused)
    constraintData[10] = 0;                       // attachmentZ (unused)
    constraintData[11] = massB;                   // massB
    constraintData[12] = chainStiffness;           // chainStiffness
    constraintData[13] = tensionStiffness;        // tensionStiffness
    constraintData[14] = maxTension;              // maxTension
    integers[15] = flags;                   // flags
    
    const offset = system.constraintCount * 64;
    updateBuffer(device, system.constraintBuffer, constraintData, offset);
    system.records[system.constraintCount] = integers.slice();
    system.scheduleDirty = true;
    
    system.constraintCount++;
    return system.constraintCount - 1;
}

/**
 * Update an attachment constraint's target position
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} constraintIndex - Constraint index
 * @param {Array<number>} worldPos - New [x, y, z] world position
 */
export function updateAttachmentTarget(system, device, constraintIndex, worldPos) {
    if (constraintIndex < 0 || constraintIndex >= system.constraintCount) return;
    
    // Only update the attachment position fields (offset 32-44 bytes in 64-byte struct)
    const posData = new Float32Array([worldPos[0], worldPos[1], worldPos[2], 1.0]); // include massB
    const offset = constraintIndex * 64 + 32; // Skip first 8 floats
    updateBuffer(device, system.constraintBuffer, posData, offset);
}

/**
 * Update rope constraint physics properties
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} constraintIndex - Constraint index
 * @param {Object} opts - { chainStiffness, tensionStiffness, maxTension, massA, massB }
 */
export function updateRopeConstraintPhysics(system, device, constraintIndex, opts) {
    if (constraintIndex < 0 || constraintIndex >= system.constraintCount) return;
    
    // Fracture flags are GPU-owned. A normal property edit must preserve them.
    const physicsData = new Float32Array([
        opts.chainStiffness ?? opts.ropeStiffness ?? 1.0,
        opts.tensionStiffness ?? 50.0,
        opts.maxTension ?? opts.chainStrength ?? 0,
    ]);
    const offset = constraintIndex * 64 + 48; // Skip first 12 floats
    updateBuffer(device, system.constraintBuffer, physicsData, offset);
    if (opts.flags !== undefined) {
        const flags = opts.flags >>> 0;
        updateBuffer(device, system.constraintBuffer, new Uint32Array([flags]), constraintIndex * 64 + 60);
        system.records[constraintIndex][15] = flags;
        system.scheduleDirty = true;
    }
    
    // Update masses if provided (bytes 28 and 44)
    if (opts.massA !== undefined) {
        const massAData = new Float32Array([opts.massA]);
        updateBuffer(device, system.constraintBuffer, massAData, constraintIndex * 64 + 28);
    }
    if (opts.massB !== undefined) {
        const massBData = new Float32Array([opts.massB]);
        updateBuffer(device, system.constraintBuffer, massBData, constraintIndex * 64 + 44);
    }
}

// ============================================================================
// NEW CONSTRAINT TYPE HELPERS - UNTESTED
// ============================================================================

/**
 * Add a bending/angle constraint between 3 particles - UNTESTED
 * Maintains angle at center particle (particleB)
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleA - First endpoint
 * @param {number} particleB - Center particle (angle vertex)
 * @param {number} particleC - Second endpoint
 * @param {number} restAngle - Rest angle in radians (default: PI = straight)
 * @param {Object} opts - { stiffness }
 * @returns {number} Constraint index or -1 if failed
 */
export function addBendingConstraint(system, device, particleA, particleB, particleC, restAngle = Math.PI, opts = {}) {
    if (system.constraintCount >= system.maxConstraints) {
        console.warn("[ParticleConstraints] Max constraints reached");
        return -1;
    }
    
    const stiffness = opts.stiffness ?? 0.5;
    
    const constraintData = new Float32Array(16);
    const integers = new Uint32Array(constraintData.buffer);
    integers[0] = CONSTRAINT_TYPE.BENDING;
    integers[1] = particleA;
    integers[2] = particleB;
    integers[3] = particleC;
    constraintData[4] = restAngle;
    constraintData[5] = stiffness;
    // Rest are defaults (0)
    
    const offset = system.constraintCount * 64;
    updateBuffer(device, system.constraintBuffer, constraintData, offset);
    system.records[system.constraintCount] = integers.slice();
    system.scheduleDirty = true;
    
    system.constraintCount++;
    console.log(`[ParticleConstraints] Added BENDING constraint (UNTESTED) idx=${system.constraintCount - 1}`);
    return system.constraintCount - 1;
}

/**
 * Add a spring constraint - UNTESTED
 * Unlike distance, springs can compress AND extend (Hooke's law)
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleA - First particle
 * @param {number} particleB - Second particle
 * @param {number} restLength - Rest length
 * @param {Object} opts - { stiffness, massA, massB }
 * @returns {number} Constraint index or -1 if failed
 */
export function addSpringConstraint(system, device, particleA, particleB, restLength, opts = {}) {
    if (system.constraintCount >= system.maxConstraints) {
        console.warn("[ParticleConstraints] Max constraints reached");
        return -1;
    }
    
    const stiffness = opts.stiffness ?? 0.5;
    const massA = opts.massA ?? 1.0;
    const massB = opts.massB ?? 1.0;
    const enableMassAware = opts.enableMassAware ?? true;
    
    let flags = 0;
    if (enableMassAware) flags |= 0x2;
    
    const constraintData = new Float32Array(16);
    const integers = new Uint32Array(constraintData.buffer);
    integers[0] = CONSTRAINT_TYPE.SPRING;
    integers[1] = particleA;
    integers[2] = particleB;
    integers[3] = 0;
    constraintData[4] = restLength;
    constraintData[5] = stiffness;
    constraintData[6] = 0;
    constraintData[7] = massA;
    constraintData[8] = 0;
    constraintData[9] = 0;
    constraintData[10] = 0;
    constraintData[11] = massB;
    constraintData[12] = 0;
    constraintData[13] = 0;
    constraintData[14] = 0;
    integers[15] = flags;
    
    const offset = system.constraintCount * 64;
    updateBuffer(device, system.constraintBuffer, constraintData, offset);
    system.records[system.constraintCount] = integers.slice();
    system.scheduleDirty = true;
    
    system.constraintCount++;
    console.log(`[ParticleConstraints] Added SPRING constraint (UNTESTED) idx=${system.constraintCount - 1}`);
    return system.constraintCount - 1;
}

/**
 * Add a sticky/adhesion constraint - UNTESTED
 * Particle sticks to a world position or another particle
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleA - Particle to make sticky
 * @param {Array<number>|number} target - [x,y,z] world position OR particle index
 * @param {Object} opts - { stiffness, adhesionStrength, breakDistance }
 * @returns {number} Constraint index or -1 if failed
 */
export function addStickyConstraint(system, device, particleA, target, opts = {}) {
    if (system.constraintCount >= system.maxConstraints) {
        console.warn("[ParticleConstraints] Max constraints reached");
        return -1;
    }
    
    const stiffness = opts.stiffness ?? 0.8;
    const adhesionStrength = opts.adhesionStrength ?? 1.0;
    const breakDistance = opts.breakDistance ?? 0; // 0 = never breaks
    
    const constraintData = new Float32Array(16);
    const integers = new Uint32Array(constraintData.buffer);
    integers[0] = CONSTRAINT_TYPE.STICKY;
    integers[1] = particleA;
    
    if (typeof target === 'number') {
        // Stick to another particle
        integers[2] = target;
        constraintData[8] = 0;
        constraintData[9] = 0;
        constraintData[10] = 0;
    } else {
        // Stick to world position
        integers[2] = 0xFFFFFFFF; // Sentinel value for "no particle"
        constraintData[8] = target[0];
        constraintData[9] = target[1];
        constraintData[10] = target[2];
    }
    
    integers[3] = 0;
    constraintData[4] = 0;
    constraintData[5] = stiffness;
    constraintData[6] = 0;
    constraintData[7] = 1.0;
    constraintData[11] = 1.0;
    constraintData[12] = 0;
    constraintData[13] = adhesionStrength;
    constraintData[14] = breakDistance;
    integers[15] = 0;
    
    const offset = system.constraintCount * 64;
    updateBuffer(device, system.constraintBuffer, constraintData, offset);
    system.records[system.constraintCount] = integers.slice();
    system.scheduleDirty = true;
    
    system.constraintCount++;
    console.log(`[ParticleConstraints] Added STICKY constraint (UNTESTED) idx=${system.constraintCount - 1}`);
    return system.constraintCount - 1;
}

/**
 * Add a cohesion constraint - UNTESTED
 * Particles attract each other within a radius (like water droplets)
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleA - First particle
 * @param {number} particleB - Second particle
 * @param {Object} opts - { cohesionRadius, stiffness, massA, massB }
 * @returns {number} Constraint index or -1 if failed
 */
export function addCohesionConstraint(system, device, particleA, particleB, opts = {}) {
    if (system.constraintCount >= system.maxConstraints) {
        console.warn("[ParticleConstraints] Max constraints reached");
        return -1;
    }
    
    const cohesionRadius = opts.cohesionRadius ?? 1.0;
    const stiffness = opts.stiffness ?? 0.3;
    const massA = opts.massA ?? 1.0;
    const massB = opts.massB ?? 1.0;
    const enableMassAware = opts.enableMassAware ?? true;
    
    let flags = 0;
    if (enableMassAware) flags |= 0x2;
    
    const constraintData = new Float32Array(16);
    const integers = new Uint32Array(constraintData.buffer);
    integers[0] = CONSTRAINT_TYPE.COHESION;
    integers[1] = particleA;
    integers[2] = particleB;
    integers[3] = 0;
    constraintData[4] = cohesionRadius;
    constraintData[5] = stiffness;
    constraintData[6] = 0;
    constraintData[7] = massA;
    constraintData[8] = 0;
    constraintData[9] = 0;
    constraintData[10] = 0;
    constraintData[11] = massB;
    constraintData[12] = 0;
    constraintData[13] = 0;
    constraintData[14] = 0;
    integers[15] = flags;
    
    const offset = system.constraintCount * 64;
    updateBuffer(device, system.constraintBuffer, constraintData, offset);
    system.records[system.constraintCount] = integers.slice();
    system.scheduleDirty = true;
    
    system.constraintCount++;
    console.log(`[ParticleConstraints] Added COHESION constraint (UNTESTED) idx=${system.constraintCount - 1}`);
    return system.constraintCount - 1;
}

/**
 * Add a collision constraint - UNTESTED
 * Particle-particle collision with friction and restitution (bounce)
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleA - First particle
 * @param {number} particleB - Second particle
 * @param {Object} opts - { collisionRadius, friction, restitution, massA, massB }
 * @returns {number} Constraint index or -1 if failed
 */
export function addCollisionConstraint(system, device, particleA, particleB, opts = {}) {
    if (system.constraintCount >= system.maxConstraints) {
        console.warn("[ParticleConstraints] Max constraints reached");
        return -1;
    }
    
    const collisionRadius = opts.collisionRadius ?? 0.1; // Sum of particle radii
    const friction = opts.friction ?? 0.5;
    const restitution = opts.restitution ?? 0.3; // Bounce coefficient
    const massA = opts.massA ?? 1.0;
    const massB = opts.massB ?? 1.0;
    const enableMassAware = opts.enableMassAware ?? true;
    
    let flags = 0;
    if (enableMassAware) flags |= 0x2;
    
    const constraintData = new Float32Array(16);
    const integers = new Uint32Array(constraintData.buffer);
    integers[0] = CONSTRAINT_TYPE.COLLISION;
    integers[1] = particleA;
    integers[2] = particleB;
    integers[3] = 0;
    constraintData[4] = collisionRadius;
    constraintData[5] = 1.0; // stiffness
    constraintData[6] = 0;
    constraintData[7] = massA;
    constraintData[8] = friction;      // Stored in attachmentX
    constraintData[9] = restitution;   // Stored in attachmentY
    constraintData[10] = 0;
    constraintData[11] = massB;
    constraintData[12] = 0;
    constraintData[13] = 0;
    constraintData[14] = 0;
    integers[15] = flags;
    
    const offset = system.constraintCount * 64;
    updateBuffer(device, system.constraintBuffer, constraintData, offset);
    system.records[system.constraintCount] = integers.slice();
    system.scheduleDirty = true;
    
    system.constraintCount++;
    console.log(`[ParticleConstraints] Added COLLISION constraint (UNTESTED) idx=${system.constraintCount - 1}`);
    return system.constraintCount - 1;
}

/**
 * Add a weld constraint - UNTESTED
 * Permanently joins two particles (rigid connection)
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleA - First particle
 * @param {number} particleB - Second particle
 * @param {number} restDistance - Distance to maintain (0 = calculate from current positions)
 * @returns {number} Constraint index or -1 if failed
 */
export function addWeldConstraint(system, device, particleA, particleB, restDistance = 0) {
    if (system.constraintCount >= system.maxConstraints) {
        console.warn("[ParticleConstraints] Max constraints reached");
        return -1;
    }
    
    // If restDistance is 0, it should be calculated from current positions
    // This is a placeholder - actual distance would need to be read from particle buffer
    const actualRestDistance = restDistance || 0.1;
    
    const constraintData = new Float32Array(16);
    const integers = new Uint32Array(constraintData.buffer);
    integers[0] = CONSTRAINT_TYPE.WELD;
    integers[1] = particleA;
    integers[2] = particleB;
    integers[3] = 0;
    constraintData[4] = actualRestDistance;
    constraintData[5] = 1.0; // Stiffness is always 1.0 for welds
    // Rest are defaults
    
    const offset = system.constraintCount * 64;
    updateBuffer(device, system.constraintBuffer, constraintData, offset);
    system.records[system.constraintCount] = integers.slice();
    system.scheduleDirty = true;
    
    system.constraintCount++;
    console.log(`[ParticleConstraints] Added WELD constraint (UNTESTED) idx=${system.constraintCount - 1}`);
    return system.constraintCount - 1;
}

/**
 * Apply a material preset to particle constraints - UNTESTED
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {string} presetName - Preset name from PARTICLE_MATERIAL_PRESETS
 * @param {number[]} constraintIndices - Array of constraint indices to apply preset to
 */
export function applyMaterialPreset(system, device, presetName, constraintIndices) {
    const preset = PARTICLE_MATERIAL_PRESETS[presetName];
    if (!preset) {
        console.warn(`[ParticleConstraints] Unknown material preset: ${presetName}`);
        return;
    }
    
    console.log(`[ParticleConstraints] Applying preset '${presetName}' to ${constraintIndices.length} constraints (UNTESTED)`);
    
    for (const idx of constraintIndices) {
        if (idx < 0 || idx >= system.constraintCount || system.records[idx]?.[0] !== CONSTRAINT_TYPE.COLLISION) continue;
        
        // Update friction (attachmentX at offset 32)
        const frictionData = new Float32Array([preset.friction]);
        updateBuffer(device, system.constraintBuffer, frictionData, idx * 64 + 32);
        
        // Update restitution (attachmentY at offset 36)
        const restitutionData = new Float32Array([preset.restitution]);
        updateBuffer(device, system.constraintBuffer, restitutionData, idx * 64 + 36);
        
        // Particle material flags have a separate layout from constraint flags.
        // Never overwrite the GPU-owned BROKEN / MASS_AWARE bits here.
    }
}

/**
 * Create all constraints for a rope
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleStart - First particle index in rope
 * @param {number} particleCount - Number of particles in rope
 * @param {Object} opts - Rope options
 * @returns {Object} { constraintStart, constraintCount, startAttachment, endAttachment }
 */
export function createRopeConstraints(system, device, particleStart, particleCount, opts = {}) {
    const constraintStart = system.constraintCount;
    const segmentCount = particleCount - 1;
    
    // Calculate rest length
    const restLength = opts.restLength || (opts.length ? opts.length / segmentCount : 0.1);
    const stiffness = opts.stiffness ?? 0.9;
    
    // Chain physics options
    const chainPhysicsOpts = {
        stiffness,
        massA: opts.particleMass ?? 1.0,
        massB: opts.particleMass ?? 1.0,
        chainStiffness: opts.chainStiffness ?? opts.ropeStiffness ?? CHAIN_PHYSICS_DEFAULTS.chainStiffness,
        tensionStiffness: opts.tensionStiffness ?? CHAIN_PHYSICS_DEFAULTS.tensionStiffness,
        chainStrength: opts.chainStrength ?? opts.ropeStrength ?? 0, // 0 = infinite
        enableMassAware: opts.enableMassAware ?? CHAIN_PHYSICS_DEFAULTS.enableMassAware,
    };
    
    // Use rope inextensible constraints if rope physics is enabled
    const useRopePhysics = opts.useRopePhysics ?? true;
    
    // Add constraints between adjacent particles
    for (let i = 0; i < segmentCount; i++) {
        if (useRopePhysics) {
            addRopeInextensibleConstraint(
                system, device,
                particleStart + i,
                particleStart + i + 1,
                restLength,
                { ...chainPhysicsOpts, massA: i === 0 && opts.fixStart ? 0 : chainPhysicsOpts.massA,
                    massB: i === segmentCount - 1 && opts.fixEnd ? 0 : chainPhysicsOpts.massB }
            );
        } else {
            addDistanceConstraint(
                system, device,
                particleStart + i,
                particleStart + i + 1,
                restLength,
                stiffness
            );
        }
    }
    
    // Add attachment constraints if needed
    let startAttachmentIdx = -1;
    let endAttachmentIdx = -1;
    
    if (opts.fixStart && opts.startPos) {
        startAttachmentIdx = addAttachmentConstraint(
            system, device,
            particleStart,
            opts.startPos,
            1.0
        );
    }
    
    if (opts.fixEnd && opts.endPos) {
        endAttachmentIdx = addAttachmentConstraint(
            system, device,
            particleStart + particleCount - 1,
            opts.endPos,
            1.0
        );
    }
    
    const constraintCount = system.constraintCount - constraintStart;
    
    // Track constraint range for this rope
    if (opts.entityId != null) {
        system.ropeConstraintRanges.set(opts.entityId, {
            start: constraintStart,
            count: constraintCount,
            startAttachment: startAttachmentIdx,
            endAttachment: endAttachmentIdx,
            ropePhysics: chainPhysicsOpts,
        });
    }
    
    const constraintType = useRopePhysics ? 'rope-inextensible' : 'distance';
    console.log(`[ChainConstraint] Created ${constraintCount} constraints for chain (${segmentCount} ${constraintType} + ${(startAttachmentIdx >= 0 ? 1 : 0) + (endAttachmentIdx >= 0 ? 1 : 0)} attachment)`);
    
    return {
        constraintStart,
        constraintCount,
        startAttachment: startAttachmentIdx,
        endAttachment: endAttachmentIdx,
        ropePhysics: chainPhysicsOpts,
    };
}

// ============================================================================
// CONSTRAINT SOLVING
// ============================================================================

/**
 * Solve all constraints
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} iterations - Number of solver iterations
 * @param {number} dt - Time step
 */
/**
 * Solve all constraints with rope physics options
 * @param {Object} system - Constraint system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} iterations - Number of solver iterations
 * @param {number} dt - Time step
 * @param {Object} opts - Global rope physics options (overrides per-constraint)
 */
export function solveRopeConstraints(system, device, iterations = 8, dt = 1/60, opts = {}) {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isInteger(iterations) || iterations < 1) throw new RangeError('Invalid rope solver step');
    if (!system.bindGroup || system.constraintCount === 0) return;
    
    // Update params with extended rope physics
    refreshConstraintSchedule(system, device);

    _constraintParamsF32[2] = dt;
    _constraintParamsF32[3] = opts.compliance ?? 0;
    _constraintParamsF32[4] = opts.chainStiffness ?? opts.ropeStiffness ?? CHAIN_PHYSICS_DEFAULTS.chainStiffness;
    _constraintParamsF32[5] = opts.chainStrength ?? opts.ropeStrength ?? 0; // 0 = infinite
    _constraintParamsF32[6] = opts.tensionStiffness ?? CHAIN_PHYSICS_DEFAULTS.tensionStiffness;
    _constraintParamsU32[7] = opts.enableMassAware ? 1 : 0;
    for (const batch of system.batches) {
        _constraintParamsU32[0] = batch.count; _constraintParamsU32[1] = batch.offset;
        updateBuffer(device, batch.params, _constraintParamsF32, 0);
    }
    
    const encoder = device.createCommandEncoder({ label: "RopeConstraint.encoder" });
    
    // Multiple iterations for convergence
    for (let iter = 0; iter < iterations; iter++) {
        const pass = encoder.beginComputePass({ label: `RopeConstraint.iter${iter}` });
        pass.setPipeline(system.pipeline);
        for (const batch of system.batches) {
            pass.setBindGroup(0, batch.bindGroup);
            pass.dispatchWorkgroups(Math.ceil(batch.count / 256));
        }
        pass.end();
    }
    
    device.queue.submit([encoder.finish()]);
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Clear all constraints for a rope
 * @param {Object} system - Constraint system
 * @param {number} entityId - Entity ID of rope to clear
 */
export function clearRopeConstraints(system, entityId) {
    if (!system.ropeConstraintRanges.has(entityId)) return;
    
    const range = system.ropeConstraintRanges.get(entityId);
    for (let i = range.start; i < range.start + range.count; i++) {
        system.records[i][15] |= 1;
        updateBuffer(system.device, system.constraintBuffer, new Uint32Array([system.records[i][15]]), i * 64 + 60);
    }
    system.scheduleDirty = true;
    system.ropeConstraintRanges.delete(entityId);
    
    // Note: This doesn't actually free GPU memory - constraints are compacted on next rebuild
    console.log(`[ChainConstraint] Cleared constraints for entity ${entityId} (range ${range.start}-${range.start + range.count - 1})`);
}

/**
 * Destroy constraint system
 * @param {Object} system - Constraint system
 */
export function destroyRopeConstraintSystem(system) {
    if (!system) return;
    for (const batch of system.batches) batch.params.destroy();
    destroyBuffers([system.constraintBuffer, system.paramsBuffer, system.scheduleBuffer]);
    system.bindGroup = null;
    system.ropeConstraintRanges.clear();
    console.log("[ChainConstraint] Destroyed constraint system");
}
