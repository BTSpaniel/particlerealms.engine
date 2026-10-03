/**
 * PBDSolver.js - Position-Based Dynamics Solver
 * 
 * Implements XPBD (Extended Position-Based Dynamics) for:
 * - Rope/cable physics (line segments)
 * - Soft body deformation
 * - Ragdoll skeletons
 * - Cloth simulation
 * 
 * Key Algorithms:
 * - Verlet integration (position-based)
 * - Gauss-Seidel constraint projection
 * - Graph coloring for GPU parallelization
 * - XPBD compliance for stable stiffness
 * 
 * **Small Substeps Approach (Miles Macklin, NVIDIA 2019):**
 * "n small timesteps with 1 iteration each > 1 large timestep with n iterations"
 * This provides better stability for stiff systems (ropes, cloth).
 * We use 8 substeps with 1 iteration each by default (equivalent to but more
 * stable than 1 substep with 8 iterations).
 * 
 * **OGC Contact Model (Chen et al., SIGGRAPH 2025):**
 * Uses Offset Geometric Contact for penetration-free collision.
 * Barrier energy prevents penetration before it occurs.
 * 
 * Performance Targets:
 * - 1000 particles + 3000 constraints: <5ms
 * - 8 substeps, 1 iteration per substep (small substeps approach)
 */

import { FIXED_SCALE } from '../../core/gpu/BufferLayouts.js';
import {
    DEFAULT_CONTACT_RADIUS,
    barrierForce,
    distanceToOffsetPlane,
    distanceToOffsetSphere,
    distanceToOffsetCapsule,
    distanceToOffsetBox,
    evaluateAnalyticSDF,
    OGCContactManager,
} from './OGCContact.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default solver iterations per substep (small substeps: use 1-2) */
export const DEFAULT_ITERATIONS = 1;

/** Default substeps per frame (small substeps: use 8-16 for stability) */
export const DEFAULT_SUBSTEPS = 8;

/** Constraint types */
export const ConstraintType = {
    DISTANCE: 0,
    ANGLE: 1,
    VOLUME: 2,
    COLLISION: 3,
    ATTACHMENT: 4,
};

/** Particle flags */
export const ParticleFlags = {
    NONE: 0,
    FIXED: 1 << 0,      // Immovable (infinite mass)
    SLEEPING: 1 << 1,   // Skip updates (optimization)
    COLLIDER: 1 << 2,   // Generate collisions
};

// Module-level scratch arrays for _generateGroundCollisions / _solveOGCColliders
// (NEVER add these as dynamic props on PBDSolver — causes V8 hidden class deopt)
const _gcScratchP = [0, 0, 0];
const _gcScratchPlaneP = [0, 0, 0];
const _gcScratchPlaneN = [0, 1, 0];
const _sdfNormalScratch = [0, 0, 0];

// ============================================================================
// PARTICLE
// ============================================================================

/**
 * PBD Particle with position, velocity, and inverse mass
 */
export class PBDParticle {
    constructor(x = 0, y = 0, z = 0, invMass = 1.0) {
        // Current position
        this.x = x;
        this.y = y;
        this.z = z;
        
        // Previous position (for Verlet)
        this.px = x;
        this.py = y;
        this.pz = z;
        
        // Velocity (derived from position delta)
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        
        // Inverse mass (0 = infinite mass = fixed)
        this.invMass = invMass;
        
        // Flags
        this.flags = ParticleFlags.NONE;
        
        // Collision radius
        this.radius = 0.5;
        
        // User data
        this.userData = null;
    }
    
    /**
     * Set position and sync previous
     */
    setPosition(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.px = x;
        this.py = y;
        this.pz = z;
    }
    
    /**
     * Set velocity (adjusts previous position)
     */
    setVelocity(vx, vy, vz, dt = 1/60) {
        this.vx = vx;
        this.vy = vy;
        this.vz = vz;
        this.px = this.x - vx * dt;
        this.py = this.y - vy * dt;
        this.pz = this.z - vz * dt;
    }
    
    /**
     * Check if particle is fixed
     */
    isFixed() {
        return this.invMass === 0 || (this.flags & ParticleFlags.FIXED) !== 0;
    }
}

// ============================================================================
// CONSTRAINTS
// ============================================================================

/**
 * Base constraint class
 */
export class PBDConstraint {
    constructor(type, stiffness = 1.0) {
        this.type = type;
        this.stiffness = stiffness;
        this.compliance = 0; // XPBD: α = 1/k, 0 = infinitely stiff
        this.lambda = 0; // XPBD Lagrange multiplier
        this.color = -1; // Graph coloring for parallel solve
    }
    
    /**
     * Set stiffness via compliance (XPBD)
     * Lower compliance = stiffer
     */
    setCompliance(compliance) {
        this.compliance = compliance;
        this.stiffness = compliance > 0 ? 1 / compliance : 1e10;
    }
}

/**
 * Distance constraint - maintains rest length between two particles
 */
export class DistanceConstraint extends PBDConstraint {
    constructor(particleA, particleB, restLength = null, stiffness = 1.0) {
        super(ConstraintType.DISTANCE, stiffness);
        this.particleA = particleA;
        this.particleB = particleB;
        
        // Wire stiffness into XPBD compliance so it actually affects solving
        // stiffness=1.0 → compliance=0 (infinitely stiff, inextensible)
        // stiffness=0.9 → compliance=0.0001 (very stiff, minimal give)
        // stiffness=0.5 → compliance=0.0005 (soft, stretchy)
        if (stiffness < 1.0) {
            this.compliance = (1.0 - stiffness) * 0.001;
        }
        
        // Auto-compute rest length if not provided
        if (restLength === null) {
            const dx = particleB.x - particleA.x;
            const dy = particleB.y - particleA.y;
            const dz = particleB.z - particleA.z;
            this.restLength = Math.sqrt(dx*dx + dy*dy + dz*dz);
        } else {
            this.restLength = restLength;
        }
        
        // Break threshold: when |lambda| exceeds this, the constraint tears.
        // XPBD lambda is the accumulated Lagrange multiplier and directly represents
        // the constraint force magnitude (Macklin et al. 2016, Section 3.3).
        // Default Infinity = unbreakable. Set to a finite value for tearable ropes.
        this.breakForce = Infinity;
        this.broken = false;
    }
    
    /**
     * Project constraint (Gauss-Seidel)
     */
    solve(dt) {
        if (this.broken) return; // Dead constraint — already torn

        const a = this.particleA;
        const b = this.particleB;
        
        if (a.isFixed() && b.isFixed()) return;
        
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < 0.0001) return;
        
        const diff = (dist - this.restLength) / dist;
        
        // XPBD: Include compliance
        const w = a.invMass + b.invMass;
        if (w === 0) return;
        
        const alpha = this.compliance / (dt * dt);
        const deltaLambda = (-diff * dist - alpha * this.lambda) / (w + alpha);
        this.lambda += deltaLambda;
        
        // Break detection: |lambda| represents accumulated constraint force.
        // When tension exceeds the material's break threshold, the constraint tears.
        // This is the standard XPBD tearing approach (Macklin et al. 2016).
        if (Math.abs(this.lambda) > this.breakForce) {
            this.broken = true;
            return; // Don't apply correction — constraint is dead
        }
        
        const correction = deltaLambda / dist;
        const cx = dx * correction;
        const cy = dy * correction;
        const cz = dz * correction;
        
        // XPBD position update: Δp = W ∇C Δλ
        // ∇C for particle a = -n (points away from b)
        // ∇C for particle b = +n (points toward a from b's perspective)
        // With Δλ < 0 for stretched constraint, we need:
        //   a moves toward b (in direction of n)
        //   b moves toward a (in direction of -n)
        if (!a.isFixed()) {
            a.x -= cx * a.invMass;
            a.y -= cy * a.invMass;
            a.z -= cz * a.invMass;
        }
        
        if (!b.isFixed()) {
            b.x += cx * b.invMass;
            b.y += cy * b.invMass;
            b.z += cz * b.invMass;
        }
    }
}

/**
 * Angle constraint - limits angle between three particles
 */
export class AngleConstraint extends PBDConstraint {
    constructor(particleA, particleB, particleC, minAngle = 0, maxAngle = Math.PI, stiffness = 0.5) {
        super(ConstraintType.ANGLE, stiffness);
        this.particleA = particleA; // End point 1
        this.particleB = particleB; // Pivot
        this.particleC = particleC; // End point 2
        this.minAngle = minAngle;
        this.maxAngle = maxAngle;
    }
    
    solve(dt) {
        const a = this.particleA;
        const b = this.particleB;
        const c = this.particleC;
        
        // Vectors from pivot
        const ba = [a.x - b.x, a.y - b.y, a.z - b.z];
        const bc = [c.x - b.x, c.y - b.y, c.z - b.z];
        
        const lenBA = Math.sqrt(ba[0]*ba[0] + ba[1]*ba[1] + ba[2]*ba[2]);
        const lenBC = Math.sqrt(bc[0]*bc[0] + bc[1]*bc[1] + bc[2]*bc[2]);
        
        if (lenBA < 0.0001 || lenBC < 0.0001) return;
        
        // Normalize
        ba[0] /= lenBA; ba[1] /= lenBA; ba[2] /= lenBA;
        bc[0] /= lenBC; bc[1] /= lenBC; bc[2] /= lenBC;
        
        // Current angle
        const dot = ba[0]*bc[0] + ba[1]*bc[1] + ba[2]*bc[2];
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        
        // Check limits
        let targetAngle = angle;
        if (angle < this.minAngle) targetAngle = this.minAngle;
        else if (angle > this.maxAngle) targetAngle = this.maxAngle;
        else return; // Within limits
        
        // Rotation axis
        const axis = [
            ba[1]*bc[2] - ba[2]*bc[1],
            ba[2]*bc[0] - ba[0]*bc[2],
            ba[0]*bc[1] - ba[1]*bc[0],
        ];
        const axisLen = Math.sqrt(axis[0]*axis[0] + axis[1]*axis[1] + axis[2]*axis[2]);
        if (axisLen < 0.0001) return;
        
        axis[0] /= axisLen; axis[1] /= axisLen; axis[2] /= axisLen;
        
        // Correction angle
        const correction = (targetAngle - angle) * this.stiffness * 0.5;
        
        // Rotate endpoints
        if (!a.isFixed()) {
            const rot = this._rotateAroundAxis(ba, axis, correction);
            a.x = b.x + rot[0] * lenBA;
            a.y = b.y + rot[1] * lenBA;
            a.z = b.z + rot[2] * lenBA;
        }
        
        if (!c.isFixed()) {
            const rot = this._rotateAroundAxis(bc, axis, -correction);
            c.x = b.x + rot[0] * lenBC;
            c.y = b.y + rot[1] * lenBC;
            c.z = b.z + rot[2] * lenBC;
        }
    }
    
    _rotateAroundAxis(v, axis, angle) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const t = 1 - c;
        
        const x = axis[0], y = axis[1], z = axis[2];
        
        return [
            (t*x*x + c)*v[0] + (t*x*y - s*z)*v[1] + (t*x*z + s*y)*v[2],
            (t*x*y + s*z)*v[0] + (t*y*y + c)*v[1] + (t*y*z - s*x)*v[2],
            (t*x*z - s*y)*v[0] + (t*y*z + s*x)*v[1] + (t*z*z + c)*v[2],
        ];
    }
}

/**
 * Attachment constraint - pins particle to world position
 * Simple and stable: directly moves particle toward target
 */
export class AttachmentConstraint extends PBDConstraint {
    constructor(particle, worldX, worldY, worldZ, stiffness = 1.0) {
        super(ConstraintType.ATTACHMENT, stiffness);
        this.particle = particle;
        this.worldX = worldX;
        this.worldY = worldY;
        this.worldZ = worldZ;
    }
    
    solve(dt) {
        const p = this.particle;
        if (p.isFixed()) return;
        
        // For stiffness = 1.0, snap directly to target (most stable)
        if (this.stiffness >= 1.0) {
            p.x = this.worldX;
            p.y = this.worldY;
            p.z = this.worldZ;
            return;
        }
        
        // For partial stiffness, interpolate toward target
        const dx = this.worldX - p.x;
        const dy = this.worldY - p.y;
        const dz = this.worldZ - p.z;
        
        p.x += dx * this.stiffness;
        p.y += dy * this.stiffness;
        p.z += dz * this.stiffness;
    }
    
    setTarget(x, y, z) {
        this.worldX = x;
        this.worldY = y;
        this.worldZ = z;
    }
}

// ============================================================================
// NEW CONSTRAINT TYPES - UNTESTED
// Based on PBD/XPBD research papers (Müller et al., Macklin et al.)
// ============================================================================

/**
 * Bending constraint - maintains angle between 3 particles - UNTESTED
 * Used for hair, grass, stiff ropes
 */
export class BendingConstraint extends PBDConstraint {
    constructor(particleA, particleB, particleC, restAngle = Math.PI, stiffness = 0.5) {
        super(ConstraintType.ANGLE, stiffness);
        this.particleA = particleA; // First endpoint
        this.particleB = particleB; // Center (angle vertex)
        this.particleC = particleC; // Second endpoint
        this.restAngle = restAngle;
    }
    
    solve(dt) {
        const a = this.particleA;
        const b = this.particleB;
        const c = this.particleC;
        
        // Vectors from center
        const e0 = [a.x - b.x, a.y - b.y, a.z - b.z];
        const e1 = [c.x - b.x, c.y - b.y, c.z - b.z];
        
        const len0 = Math.sqrt(e0[0]*e0[0] + e0[1]*e0[1] + e0[2]*e0[2]);
        const len1 = Math.sqrt(e1[0]*e1[0] + e1[1]*e1[1] + e1[2]*e1[2]);
        
        if (len0 < 0.0001 || len1 < 0.0001) return;
        
        // Normalize
        const n0 = [e0[0]/len0, e0[1]/len0, e0[2]/len0];
        const n1 = [e1[0]/len1, e1[1]/len1, e1[2]/len1];
        
        // Current angle
        const dot = n0[0]*n1[0] + n0[1]*n1[1] + n0[2]*n1[2];
        const currentAngle = Math.acos(Math.max(-1, Math.min(1, dot)));
        
        const angleDiff = currentAngle - this.restAngle;
        if (Math.abs(angleDiff) < 0.001) return;
        
        // Rotation axis
        const axis = [
            n0[1]*n1[2] - n0[2]*n1[1],
            n0[2]*n1[0] - n0[0]*n1[2],
            n0[0]*n1[1] - n0[1]*n1[0],
        ];
        const axisLen = Math.sqrt(axis[0]*axis[0] + axis[1]*axis[1] + axis[2]*axis[2]);
        if (axisLen < 0.0001) return;
        
        axis[0] /= axisLen; axis[1] /= axisLen; axis[2] /= axisLen;
        
        const correction = angleDiff * this.stiffness * 0.5;
        
        // Tangent directions
        const tangent0 = [
            axis[1]*n0[2] - axis[2]*n0[1],
            axis[2]*n0[0] - axis[0]*n0[2],
            axis[0]*n0[1] - axis[1]*n0[0],
        ];
        const tangent1 = [
            axis[1]*n1[2] - axis[2]*n1[1],
            axis[2]*n1[0] - axis[0]*n1[2],
            axis[0]*n1[1] - axis[1]*n1[0],
        ];
        
        if (!a.isFixed()) {
            a.x -= tangent0[0] * correction;
            a.y -= tangent0[1] * correction;
            a.z -= tangent0[2] * correction;
        }
        if (!c.isFixed()) {
            c.x += tangent1[0] * correction;
            c.y += tangent1[1] * correction;
            c.z += tangent1[2] * correction;
        }
    }
}

/**
 * Spring constraint - UNTESTED
 * Unlike distance constraint, springs can compress AND extend (Hooke's law)
 */
export class SpringConstraint extends PBDConstraint {
    constructor(particleA, particleB, restLength = null, stiffness = 0.5) {
        super(ConstraintType.DISTANCE, stiffness);
        this.particleA = particleA;
        this.particleB = particleB;
        
        if (restLength === null) {
            const dx = particleB.x - particleA.x;
            const dy = particleB.y - particleA.y;
            const dz = particleB.z - particleA.z;
            this.restLength = Math.sqrt(dx*dx + dy*dy + dz*dz);
        } else {
            this.restLength = restLength;
        }
        this.dampingCoeff = 0.1;
    }
    
    solve(dt) {
        const a = this.particleA;
        const b = this.particleB;
        
        if (a.isFixed() && b.isFixed()) return;
        
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < 0.0001) return;
        
        // Spring works both ways (compression + extension)
        const diff = dist - this.restLength;
        const force = diff * this.stiffness;
        
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        
        const w = a.invMass + b.invMass;
        if (w === 0) return;
        
        const correction = force / w;
        
        if (!a.isFixed()) {
            a.x += nx * correction * a.invMass;
            a.y += ny * correction * a.invMass;
            a.z += nz * correction * a.invMass;
        }
        if (!b.isFixed()) {
            b.x -= nx * correction * b.invMass;
            b.y -= ny * correction * b.invMass;
            b.z -= nz * correction * b.invMass;
        }
        
        // Velocity damping
        const relVx = b.vx - a.vx;
        const relVy = b.vy - a.vy;
        const relVz = b.vz - a.vz;
        const relVelNormal = relVx*nx + relVy*ny + relVz*nz;
        const dampForce = relVelNormal * this.dampingCoeff * this.stiffness;
        
        if (!a.isFixed()) {
            a.vx += nx * dampForce * a.invMass;
            a.vy += ny * dampForce * a.invMass;
            a.vz += nz * dampForce * a.invMass;
        }
        if (!b.isFixed()) {
            b.vx -= nx * dampForce * b.invMass;
            b.vy -= ny * dampForce * b.invMass;
            b.vz -= nz * dampForce * b.invMass;
        }
    }
}

/**
 * Cohesion constraint - UNTESTED
 * Particles attract each other within a radius (like water droplets)
 */
export class CohesionConstraint extends PBDConstraint {
    constructor(particleA, particleB, cohesionRadius = 1.0, stiffness = 0.3) {
        super(ConstraintType.DISTANCE, stiffness);
        this.particleA = particleA;
        this.particleB = particleB;
        this.cohesionRadius = cohesionRadius;
    }
    
    solve(dt) {
        const a = this.particleA;
        const b = this.particleB;
        
        if (a.isFixed() && b.isFixed()) return;
        
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Only attract within cohesion radius
        if (dist >= this.cohesionRadius || dist < 0.0001) return;
        
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        
        // Quadratic falloff - stronger attraction when closer
        const t = dist / this.cohesionRadius;
        const falloff = (1 - t) * (1 - t);
        const attraction = falloff * this.stiffness * 0.5;
        
        const w = a.invMass + b.invMass;
        if (w === 0) return;
        
        if (!a.isFixed()) {
            a.x += nx * attraction * a.invMass / w;
            a.y += ny * attraction * a.invMass / w;
            a.z += nz * attraction * a.invMass / w;
        }
        if (!b.isFixed()) {
            b.x -= nx * attraction * b.invMass / w;
            b.y -= ny * attraction * b.invMass / w;
            b.z -= nz * attraction * b.invMass / w;
        }
    }
}

/**
 * Long Range Attachment (LRA) Constraint
 * Creates distance constraints from fixed/anchor particles to all particles in a rope.
 * This dramatically improves convergence for long ropes (100+ segments).
 * 
 * Reference: Kim et al. 2012 "Long Range Attachments - A Method to Simulate Inextensible Clothing in Computer Games"
 * Reference: Müller 2017 "Long Range Constraints for Rigid Body Simulations"
 * 
 * Key idea: Instead of only having adjacent distance constraints, we create
 * constraints from the anchor to every Nth particle along the rope. This allows
 * the solver to propagate length corrections globally in fewer iterations.
 */
export class LongRangeAttachmentConstraint extends PBDConstraint {
    constructor(anchorParticle, targetParticle, restLength = null, stiffness = 0.8) {
        super(ConstraintType.DISTANCE, stiffness);
        this.anchorParticle = anchorParticle;  // Fixed particle (anchor point)
        this.targetParticle = targetParticle;  // Target particle along rope
        
        // Rest length is the cumulative rest length from anchor to target
        if (restLength === null) {
            const dx = targetParticle.x - anchorParticle.x;
            const dy = targetParticle.y - anchorParticle.y;
            const dz = targetParticle.z - anchorParticle.z;
            this.restLength = Math.sqrt(dx*dx + dy*dy + dz*dz);
        } else {
            this.restLength = restLength;
        }
        
        // XPBD compliance (lower = stiffer)
        this.compliance = (1.0 - stiffness) * 0.001;
        this.lambda = 0;
    }
    
    solve(dt) {
        const anchor = this.anchorParticle;
        const target = this.targetParticle;
        
        // LRA only moves the target particle (anchor is typically fixed)
        if (target.isFixed()) return;
        
        const dx = target.x - anchor.x;
        const dy = target.y - anchor.y;
        const dz = target.z - anchor.z;
        
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < 0.0001) return;
        
        // LRA is a MAX constraint - only enforce if stretched beyond rest length
        // This prevents rope from becoming rigid/stuck
        if (dist <= this.restLength) return;
        
        const diff = (dist - this.restLength) / dist;
        
        // XPBD with compliance
        const w = target.invMass; // anchor is typically fixed (invMass = 0)
        if (w === 0) return;
        
        const alpha = this.compliance / (dt * dt);
        const deltaLambda = (-diff * dist - alpha * this.lambda) / (w + alpha);
        this.lambda += deltaLambda;
        
        const correction = deltaLambda / dist;
        
        // Only move target toward anchor (anchor is fixed)
        target.x += dx * correction * target.invMass;
        target.y += dy * correction * target.invMass;
        target.z += dz * correction * target.invMass;
    }
}

// ============================================================================
// N-PARTICLE CONSTRAINTS
// For arbitrary numbers of particles (soft bodies, fluids, etc.)
// Based on "Unified Particle Physics" (Macklin 2014) and SPH research
// ============================================================================

/**
 * Volume constraint - preserves volume of a tetrahedron (4 particles)
 * C = V - V0 = 0, where V = (1/6) * (p1-p0) · ((p2-p0) × (p3-p0))
 */
export class VolumeConstraint extends PBDConstraint {
    constructor(particles, restVolume = null, stiffness = 1.0) {
        super(ConstraintType.VOLUME, stiffness);
        if (particles.length !== 4) {
            throw new Error('VolumeConstraint requires exactly 4 particles');
        }
        this.particles = particles;
        this.restVolume = restVolume ?? this._computeVolume();
        
        // GAP 7 FIX: Wire stiffness into XPBD compliance (same pattern as DistanceConstraint)
        // stiffness=1.0 → compliance=0 (infinitely stiff, perfect volume preservation)
        // stiffness=0.5 → compliance=0.0005 (soft, volume can change)
        if (stiffness < 1.0) {
            this.compliance = (1.0 - stiffness) * 0.001;
        }
    }
    
    _computeVolume() {
        const [p0, p1, p2, p3] = this.particles;
        const e1 = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
        const e2 = [p2.x - p0.x, p2.y - p0.y, p2.z - p0.z];
        const e3 = [p3.x - p0.x, p3.y - p0.y, p3.z - p0.z];
        const cross = [
            e2[1]*e3[2] - e2[2]*e3[1],
            e2[2]*e3[0] - e2[0]*e3[2],
            e2[0]*e3[1] - e2[1]*e3[0],
        ];
        return (e1[0]*cross[0] + e1[1]*cross[1] + e1[2]*cross[2]) / 6.0;
    }
    
    solve(dt) {
        const currentVolume = this._computeVolume();
        const C = currentVolume - this.restVolume;
        if (Math.abs(C) < 0.0001) return;
        
        const [p0, p1, p2, p3] = this.particles;
        const e1 = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
        const e2 = [p2.x - p0.x, p2.y - p0.y, p2.z - p0.z];
        const e3 = [p3.x - p0.x, p3.y - p0.y, p3.z - p0.z];
        
        const grad1 = [(e2[1]*e3[2] - e2[2]*e3[1])/6, (e2[2]*e3[0] - e2[0]*e3[2])/6, (e2[0]*e3[1] - e2[1]*e3[0])/6];
        const grad2 = [(e3[1]*e1[2] - e3[2]*e1[1])/6, (e3[2]*e1[0] - e3[0]*e1[2])/6, (e3[0]*e1[1] - e3[1]*e1[0])/6];
        const grad3 = [(e1[1]*e2[2] - e1[2]*e2[1])/6, (e1[2]*e2[0] - e1[0]*e2[2])/6, (e1[0]*e2[1] - e1[1]*e2[0])/6];
        const grad0 = [-(grad1[0]+grad2[0]+grad3[0]), -(grad1[1]+grad2[1]+grad3[1]), -(grad1[2]+grad2[2]+grad3[2])];
        
        let w = 0;
        const grads = [grad0, grad1, grad2, grad3];
        for (let i = 0; i < 4; i++) {
            const g = grads[i];
            w += this.particles[i].invMass * (g[0]*g[0] + g[1]*g[1] + g[2]*g[2]);
        }
        if (w < 0.0001) return;
        
        // GAP 7 FIX: XPBD with compliance and accumulated lambda
        // α̃ = α / dt² (Macklin et al. 2016, Section 3.3)
        // Δλ = (-C - α̃ · λ) / (w + α̃)
        const alpha = this.compliance / (dt * dt);
        const deltaLambda = (-C - alpha * this.lambda) / (w + alpha);
        this.lambda += deltaLambda;
        
        for (let i = 0; i < 4; i++) {
            const p = this.particles[i];
            if (p.isFixed()) continue;
            const g = grads[i];
            p.x += deltaLambda * p.invMass * g[0];
            p.y += deltaLambda * p.invMass * g[1];
            p.z += deltaLambda * p.invMass * g[2];
        }
    }
}

/**
 * Shape Matching constraint - restores N particles to their original shape
 * Based on "Meshless Deformations Based on Shape Matching" (Müller 2005)
 */
export class ShapeMatchingConstraint extends PBDConstraint {
    constructor(particles, stiffness = 0.5, rigid = false) {
        super(ConstraintType.DISTANCE, stiffness);
        this.particles = particles;
        this.rigid = rigid;
        this._computeRestShape();
    }
    
    _computeRestShape() {
        let totalMass = 0, cx = 0, cy = 0, cz = 0;
        for (const p of this.particles) {
            const m = 1.0 / (p.invMass || 1.0);
            cx += p.x * m; cy += p.y * m; cz += p.z * m;
            totalMass += m;
        }
        cx /= totalMass; cy /= totalMass; cz /= totalMass;
        
        this.restPositions = this.particles.map(p => ({
            x: p.x - cx, y: p.y - cy, z: p.z - cz,
            mass: 1.0 / (p.invMass || 1.0),
        }));
        this.totalMass = totalMass;
    }
    
    solve(dt) {
        const n = this.particles.length;
        if (n === 0) return;
        
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < n; i++) {
            const p = this.particles[i], m = this.restPositions[i].mass;
            cx += p.x * m; cy += p.y * m; cz += p.z * m;
        }
        cx /= this.totalMass; cy /= this.totalMass; cz /= this.totalMass;
        
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            if (p.isFixed()) continue;
            const rest = this.restPositions[i];
            const goalX = cx + rest.x, goalY = cy + rest.y, goalZ = cz + rest.z;
            const blend = this.rigid ? 1.0 : this.stiffness;
            p.x += (goalX - p.x) * blend;
            p.y += (goalY - p.y) * blend;
            p.z += (goalZ - p.z) * blend;
        }
    }
}

/**
 * Pressure constraint - internal pressure for closed meshes (balloons)
 * Works with N particles forming a closed surface
 */
export class PressureConstraint extends PBDConstraint {
    constructor(particles, triangles, restVolume = null, pressure = 1.0, stiffness = 1.0) {
        super(ConstraintType.VOLUME, stiffness);
        this.particles = particles;
        this.triangles = triangles; // Array of [i, j, k] indices
        this.pressure = pressure;
        this.restVolume = restVolume ?? this._computeVolume();
    }
    
    _computeVolume() {
        let volume = 0;
        for (const [i, j, k] of this.triangles) {
            const p0 = this.particles[i], p1 = this.particles[j], p2 = this.particles[k];
            volume += (p0.x*(p1.y*p2.z - p1.z*p2.y) + p1.x*(p2.y*p0.z - p2.z*p0.y) + p2.x*(p0.y*p1.z - p0.z*p1.y)) / 6.0;
        }
        return Math.abs(volume);
    }
    
    solve(dt) {
        const currentVolume = this._computeVolume();
        const targetVolume = this.restVolume * this.pressure;
        const volumeDiff = currentVolume - targetVolume;
        
        const forces = this.particles.map(() => ({x: 0, y: 0, z: 0}));
        
        for (const [i, j, k] of this.triangles) {
            const p0 = this.particles[i], p1 = this.particles[j], p2 = this.particles[k];
            const e1 = [p1.x-p0.x, p1.y-p0.y, p1.z-p0.z];
            const e2 = [p2.x-p0.x, p2.y-p0.y, p2.z-p0.z];
            const nx = e1[1]*e2[2] - e1[2]*e2[1];
            const ny = e1[2]*e2[0] - e1[0]*e2[2];
            const nz = e1[0]*e2[1] - e1[1]*e2[0];
            const f = -volumeDiff * this.stiffness / 3.0;
            forces[i].x += nx*f; forces[i].y += ny*f; forces[i].z += nz*f;
            forces[j].x += nx*f; forces[j].y += ny*f; forces[j].z += nz*f;
            forces[k].x += nx*f; forces[k].y += ny*f; forces[k].z += nz*f;
        }
        
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.isFixed()) continue;
            p.x += forces[i].x * p.invMass;
            p.y += forces[i].y * p.invMass;
            p.z += forces[i].z * p.invMass;
        }
    }
}

/**
 * SPH Density constraint - maintains constant density (fluids)
 * Based on "Position Based Fluids" (Macklin & Müller 2013)
 */
export class DensityConstraint extends PBDConstraint {
    constructor(particles, restDensity = 1000, kernelRadius = 0.1, stiffness = 1.0) {
        super(ConstraintType.COLLISION, stiffness);
        this.particles = particles;
        this.restDensity = restDensity;
        this.h = kernelRadius;
        this.h2 = kernelRadius * kernelRadius;
        this.poly6Coeff = 315.0 / (64.0 * Math.PI * Math.pow(kernelRadius, 9));
        this.spikyGradCoeff = -45.0 / (Math.PI * Math.pow(kernelRadius, 6));
    }
    
    _poly6(r2) {
        if (r2 >= this.h2) return 0;
        const diff = this.h2 - r2;
        return this.poly6Coeff * diff * diff * diff;
    }
    
    _spikyGrad(r, dx, dy, dz) {
        if (r >= this.h || r < 0.0001) return [0, 0, 0];
        const diff = this.h - r;
        const coeff = this.spikyGradCoeff * diff * diff / r;
        return [coeff * dx, coeff * dy, coeff * dz];
    }
    
    solve(dt) {
        const n = this.particles.length;
        const densities = new Float32Array(n);
        const lambdas = new Float32Array(n);
        const deltas = this.particles.map(() => ({x: 0, y: 0, z: 0}));
        
        // Compute densities
        for (let i = 0; i < n; i++) {
            const pi = this.particles[i];
            let density = 0;
            for (let j = 0; j < n; j++) {
                const pj = this.particles[j];
                const dx = pi.x - pj.x, dy = pi.y - pj.y, dz = pi.z - pj.z;
                density += (1.0 / (pj.invMass || 1.0)) * this._poly6(dx*dx + dy*dy + dz*dz);
            }
            densities[i] = density;
        }
        
        // Compute lambdas
        for (let i = 0; i < n; i++) {
            const pi = this.particles[i];
            const Ci = densities[i] / this.restDensity - 1.0;
            if (Math.abs(Ci) < 0.001) { lambdas[i] = 0; continue; }
            
            let sumGrad2 = 0;
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const pj = this.particles[j];
                const dx = pi.x - pj.x, dy = pi.y - pj.y, dz = pi.z - pj.z;
                const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
                const grad = this._spikyGrad(r, dx, dy, dz);
                sumGrad2 += (grad[0]*grad[0] + grad[1]*grad[1] + grad[2]*grad[2]) / (this.restDensity * this.restDensity);
            }
            lambdas[i] = -Ci / (sumGrad2 + 0.0001);
        }
        
        // Compute position deltas
        for (let i = 0; i < n; i++) {
            const pi = this.particles[i];
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const pj = this.particles[j];
                const dx = pi.x - pj.x, dy = pi.y - pj.y, dz = pi.z - pj.z;
                const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
                const grad = this._spikyGrad(r, dx, dy, dz);
                const scale = (lambdas[i] + lambdas[j]) / this.restDensity * this.stiffness;
                deltas[i].x += grad[0] * scale;
                deltas[i].y += grad[1] * scale;
                deltas[i].z += grad[2] * scale;
            }
        }
        
        // Apply deltas
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            if (p.isFixed()) continue;
            p.x += deltas[i].x * p.invMass;
            p.y += deltas[i].y * p.invMass;
            p.z += deltas[i].z * p.invMass;
        }
    }
}

// ============================================================================
// GRAPH COLORING FOR GPU PARALLELIZATION
// ============================================================================

/**
 * Greedy graph coloring for constraint parallelization
 * Constraints with same color can be solved in parallel
 */
export function colorConstraints(constraints, particles) {
    // Build adjacency: constraints sharing particles conflict
    const particleToConstraints = new Map();
    
    for (let i = 0; i < constraints.length; i++) {
        const c = constraints[i];
        const particleIndices = getConstraintParticles(c, particles);
        
        for (const pIdx of particleIndices) {
            if (!particleToConstraints.has(pIdx)) {
                particleToConstraints.set(pIdx, []);
            }
            particleToConstraints.get(pIdx).push(i);
        }
    }
    
    // Build constraint adjacency graph
    const adjacency = constraints.map(() => new Set());
    
    for (const constraintList of particleToConstraints.values()) {
        for (let i = 0; i < constraintList.length; i++) {
            for (let j = i + 1; j < constraintList.length; j++) {
                adjacency[constraintList[i]].add(constraintList[j]);
                adjacency[constraintList[j]].add(constraintList[i]);
            }
        }
    }
    
    // Greedy coloring
    const colors = new Int32Array(constraints.length).fill(-1);
    let maxColor = 0;
    
    for (let i = 0; i < constraints.length; i++) {
        const usedColors = new Set();
        
        for (const neighbor of adjacency[i]) {
            if (colors[neighbor] !== -1) {
                usedColors.add(colors[neighbor]);
            }
        }
        
        // Find smallest available color
        let color = 0;
        while (usedColors.has(color)) color++;
        
        colors[i] = color;
        constraints[i].color = color;
        maxColor = Math.max(maxColor, color);
    }
    
    return { colors, numColors: maxColor + 1 };
}

/**
 * Get particle indices for a constraint
 */
function getConstraintParticles(constraint, particles) {
    const indices = [];
    
    if (constraint.particleA) indices.push(particles.indexOf(constraint.particleA));
    if (constraint.particleB) indices.push(particles.indexOf(constraint.particleB));
    if (constraint.particleC) indices.push(particles.indexOf(constraint.particleC));
    if (constraint.particle) indices.push(particles.indexOf(constraint.particle));
    
    return indices.filter(i => i >= 0);
}

/**
 * Group constraints by color for batched dispatch
 */
export function groupByColor(constraints, numColors) {
    const groups = [];
    for (let c = 0; c < numColors; c++) {
        groups.push([]);
    }
    
    for (const constraint of constraints) {
        if (constraint.color >= 0) {
            groups[constraint.color].push(constraint);
        }
    }
    
    return groups;
}

// ============================================================================
// PBD SOLVER
// ============================================================================

export class PBDSolver {
    constructor(options = {}) {
        this.iterations = options.iterations ?? DEFAULT_ITERATIONS;
        this.substeps = options.substeps ?? DEFAULT_SUBSTEPS;
        this.gravity = options.gravity ?? [0, -9.8, 0];
        this.damping = options.damping ?? 0.99;
        this.friction = options.friction ?? 0.5;
        
        this.particles = [];
        this.constraints = [];
        this.colorGroups = null;
        this._gsPartitionDirty = true;
        this.numColors = 0;
        
        // Collision handling
        this.collisionConstraints = [];
        this.groundY = options.groundY ?? 0;
        this.enableGroundCollision = options.enableGroundCollision !== false;
        
        // OGC Contact parameters
        this.contactRadius = options.contactRadius ?? DEFAULT_CONTACT_RADIUS;
        this.barrierStiffness = options.barrierStiffness ?? 5000.0;
        this.useOGC = options.useOGC !== false; // Enable OGC by default
        
        // OGC colliders (spheres, planes, capsules, boxes, SDFs)
        this.ogcColliders = {
            spheres: [],
            planes: [],
            capsules: [],
            boxes: [],
            sdfs: [],
        };
        
        // === STABILITY IMPROVEMENTS (based on XPBD papers) ===
        
        // Velocity clamping - prevents numerical explosion
        this.maxVelocity = options.maxVelocity ?? 100.0; // m/s
        
        // Position bounds - prevents particles flying to infinity
        this.maxPosition = options.maxPosition ?? 10000.0; // meters from origin
        
        // Sleep detection - skip inactive particles for performance
        this.enableSleep = options.enableSleep ?? true;
        this.sleepThreshold = options.sleepThreshold ?? 0.01; // velocity threshold
        this.sleepFrames = options.sleepFrames ?? 60; // frames below threshold to sleep
        
        // Self-collision - particles collide with each other
        this.selfCollision = options.selfCollision ?? true;
        this.selfCollisionRadius = options.selfCollisionRadius ?? 0.05;
        this.selfCollisionSkip = options.selfCollisionSkip ?? 2; // Skip adjacent particles in chain
        this.selfCollisionStiffness = options.selfCollisionStiffness ?? 0.3; // Soft response reduces jiggle
        
        // === ADVANCED SOLVER OPTIONS (based on research papers) ===
        
        // Stiffness iteration correction - makes stiffness independent of iteration count
        // Formula: k' = 1 - (1-k)^(1/n) where n = iterations
        // Reference: "Position Based Dynamics" (Müller et al. 2007), Owlree blog
        this.useStiffnessCorrection = options.useStiffnessCorrection ?? true;
        
        // Hierarchical Multi-Grid solver - faster convergence for long ropes
        // Coarse-to-fine solving accelerates global propagation
        // Reference: Dylan Weeks rope simulation, MGPBD papers
        this.useHierarchicalSolver = options.useHierarchicalSolver ?? false;
        this.hierarchyLevels = options.hierarchyLevels ?? 3;
        this._hierarchyCache = null; // Lazy init
        
        // Per-vertex displacement bounds (OGC SIGGRAPH 2025)
        // Conservative bounds that guarantee penetration-free without CCD
        this.useDisplacementBounds = options.useDisplacementBounds ?? true;
        this.displacementBoundRatio = options.displacementBoundRatio ?? 0.45; // γp from paper
        
        // Over-relaxation (SOR) - accelerates convergence
        // omega=1.0 is standard Gauss-Seidel, omega>1.0 is over-relaxation
        // Optimal omega is typically 1.5-1.9 for cloth/rope (only when stable)
        // Reference: "Small Steps in Physics Simulation" (Macklin 2019)
        this.omega = options.omega ?? 1.0; // Default 1.0 for stability
        
        // Jacobi mode - all constraints computed in parallel, then averaged
        // Better for GPU but slower convergence than Gauss-Seidel
        // Use with higher omega (up to 1.9) to compensate
        this.useJacobi = options.useJacobi ?? false;
        
        // Warm starting - reuse Lagrange multipliers from previous frame
        // Can improve convergence but may cause instability if not tuned
        // Reference: XPBD paper (Macklin 2016)
        this.warmStart = options.warmStart ?? false; // Disabled by default for stability
        this.warmStartFactor = options.warmStartFactor ?? 0.5; // Conservative decay
        
        // Chebyshev acceleration - adaptive omega for faster convergence
        // Cycles omega between values for spectral acceleration
        // Reference: "Chebyshev Semi-Iterative Methods" (Golub & Varga)
        this.useChebyshev = options.useChebyshev ?? false;
        this.chebyshevRho = options.chebyshevRho ?? 0.95; // Spectral radius estimate
        this._chebyshevIteration = 0;
        
        // === ADVANCED ACCELERATION METHODS (Research: MGPBD, VBD, Anderson 2024-2025) ===
        
        // Alternating GS sweep direction counter (for chain/rope convergence)
        this._gsSweepForward = true;
        
        // Anderson Acceleration - momentum-based fixed-point acceleration
        // Uses history of residuals to extrapolate better solutions
        // Reference: Walker & Ni 2011, "Anderson Acceleration for Fixed-Point Iterations"
        // Dramatically improves convergence for stiff systems (ropes, cloth)
        this.useAnderson = options.useAnderson ?? false;
        this.andersonM = options.andersonM ?? 3; // History window size (m=3-5 typical)
        this._andersonHistory = null; // Lazy init
        
        // Nesterov/Momentum acceleration - uses velocity-like momentum term
        // Reference: Nesterov 1983, adapted for PBD by various papers
        // Simpler than Anderson but still effective
        // NOTE: Disabled by default - can cause drift/jitter when rope should be stable
        this.useMomentum = options.useMomentum ?? false;
        this.momentumBeta = options.momentumBeta ?? 0.8; // Momentum coefficient (0.7-0.9)
        this._momentumBuffer = null; // Lazy init
        
        // Adaptive relaxation - automatically tune omega based on convergence
        // Increases omega when converging well, decreases when oscillating
        this.useAdaptiveOmega = options.useAdaptiveOmega ?? false;
        this._prevConstraintError = Infinity;
        this._omegaAdaptRate = 0.05;
        
        // Post-substep callback — called after constraint solving, before velocity update
        // Used by rope clamp to enforce inextensibility per-substep (not just once per frame)
        this.postSubstepCallback = options.postSubstepCallback ?? null;
        
        // Constraint break callback — called when a distance constraint tears
        // Signature: (constraint, constraintIndex, breakPosition) => void
        // breakPosition is the midpoint between the two particles at the moment of tearing.
        this.onConstraintBreak = options.onConstraintBreak ?? null;
        
        // Statistics
        this.stats = {
            activeParticles: 0,
            sleepingParticles: 0,
            clampedVelocities: 0,
            nanRecoveries: 0,
            selfCollisions: 0,
            constraintError: 0, // Average constraint violation
        };
    }
    
    /**
     * Add a particle
     * @returns {PBDParticle}
     */
    addParticle(x, y, z, invMass = 1.0) {
        const p = new PBDParticle(x, y, z, invMass);
        this.particles.push(p);
        return p;
    }
    
    /**
     * Add a distance constraint
     * @returns {DistanceConstraint}
     */
    addDistanceConstraint(particleA, particleB, restLength = null, stiffness = 1.0) {
        const c = new DistanceConstraint(particleA, particleB, restLength, stiffness);
        this.constraints.push(c);
        this.colorGroups = null; // Invalidate coloring
        this._gsPartitionDirty = true;
        return c;
    }
    
    /**
     * Add an angle constraint
     * @returns {AngleConstraint}
     */
    addAngleConstraint(particleA, particleB, particleC, minAngle, maxAngle, stiffness = 0.5) {
        const c = new AngleConstraint(particleA, particleB, particleC, minAngle, maxAngle, stiffness);
        this.constraints.push(c);
        this.colorGroups = null;
        this._gsPartitionDirty = true;
        return c;
    }
    
    /**
     * Add attachment constraint
     * @returns {AttachmentConstraint}
     */
    addAttachmentConstraint(particle, worldX, worldY, worldZ, stiffness = 1.0) {
        const c = new AttachmentConstraint(particle, worldX, worldY, worldZ, stiffness);
        this.constraints.push(c);
        this._gsPartitionDirty = true;
        return c;
    }
    
    /**
     * Add Long Range Attachment (LRA) constraints for a rope/chain
     * This dramatically improves convergence for long ropes (100+ particles)
     * 
     * @param {PBDParticle[]} particles - Array of particles in order (first is anchor)
     * @param {number} segmentLength - Rest length per segment
     * @param {number} quality - Quality multiplier (0.1 = sparse, 1.0 = dense, 2.0 = very dense)
     * @param {number} stiffness - LRA stiffness (0-1)
     * @returns {LongRangeAttachmentConstraint[]} Array of created LRA constraints
     */
    addLongRangeAttachments(particles, segmentLength, quality = 1.0, stiffness = 0.8) {
        if (!particles || particles.length < 3) return [];
        
        const lraConstraints = [];
        const anchor = particles[0];
        
        // Skip distance based on quality (lower quality = skip more particles)
        // quality=0.1 → skip=10 (every 10th particle)
        // quality=1.0 → skip=2 (every 2nd particle)  
        // quality=2.0 → skip=1 (every particle)
        const skipDistance = Math.max(1, Math.round(2 / Math.max(0.1, quality)));
        
        // Only create LRA for particles that are at least skipDistance away from anchor
        for (let i = skipDistance; i < particles.length; i += skipDistance) {
            const target = particles[i];
            
            // Cumulative rest length from anchor to this particle
            const cumulativeLength = i * segmentLength;
            
            const lra = new LongRangeAttachmentConstraint(anchor, target, cumulativeLength, stiffness);
            this.constraints.push(lra);
            lraConstraints.push(lra);
        }
        
        // Also add LRA from end anchor if rope is fixed at both ends
        const lastParticle = particles[particles.length - 1];
        if (lastParticle.isFixed() && particles.length > 2 * skipDistance) {
            for (let i = particles.length - 1 - skipDistance; i > 0; i -= skipDistance) {
                const target = particles[i];
                const distFromEnd = (particles.length - 1 - i) * segmentLength;
                
                const lra = new LongRangeAttachmentConstraint(lastParticle, target, distFromEnd, stiffness);
                this.constraints.push(lra);
                lraConstraints.push(lra);
            }
        }
        
        this.colorGroups = null; // Invalidate coloring
        this._gsPartitionDirty = true;
        
        if (lraConstraints.length > 0) {
            console.log(`[PBDSolver] Added ${lraConstraints.length} LRA constraints (quality=${quality.toFixed(1)}, skip=${skipDistance})`);
        }
        
        return lraConstraints;
    }
    
    // ========================================================================
    // NEW CONSTRAINT TYPES - UNTESTED
    // ========================================================================
    
    /**
     * Add a bending constraint between 3 particles - UNTESTED
     * Maintains angle at center particle (particleB)
     * @param {PBDParticle} particleA - First endpoint
     * @param {PBDParticle} particleB - Center particle (angle vertex)
     * @param {PBDParticle} particleC - Second endpoint
     * @param {number} restAngle - Rest angle in radians (default: PI = straight)
     * @param {number} stiffness - Constraint stiffness (0-1)
     * @returns {BendingConstraint}
     */
    addBendingConstraint(particleA, particleB, particleC, restAngle = Math.PI, stiffness = 0.5) {
        const c = new BendingConstraint(particleA, particleB, particleC, restAngle, stiffness);
        this.constraints.push(c);
        this.colorGroups = null;
        this._gsPartitionDirty = true;
        return c;
    }
    
    /**
     * Add a spring constraint - UNTESTED
     * Unlike distance, springs can compress AND extend (Hooke's law)
     * @param {PBDParticle} particleA
     * @param {PBDParticle} particleB
     * @param {number} restLength
     * @param {number} stiffness
     * @returns {SpringConstraint}
     */
    addSpringConstraint(particleA, particleB, restLength = null, stiffness = 0.5) {
        const c = new SpringConstraint(particleA, particleB, restLength, stiffness);
        this.constraints.push(c);
        this.colorGroups = null;
        this._gsPartitionDirty = true;
        return c;
    }
    
    /**
     * Add a cohesion constraint
     * Particles attract each other within a radius
     */
    addCohesionConstraint(particleA, particleB, cohesionRadius = 1.0, stiffness = 0.3) {
        const c = new CohesionConstraint(particleA, particleB, cohesionRadius, stiffness);
        this.constraints.push(c);
        this.colorGroups = null;
        this._gsPartitionDirty = true;
        return c;
    }
    
    // ========================================================================
    // N-PARTICLE CONSTRAINT METHODS
    // ========================================================================
    
    /**
     * Add volume constraint (4 particles forming tetrahedron)
     * Used for soft body simulation
     */
    addVolumeConstraint(particles, restVolume = null, stiffness = 1.0) {
        const c = new VolumeConstraint(particles, restVolume, stiffness);
        this.constraints.push(c);
        this.colorGroups = null;
        this._gsPartitionDirty = true;
        return c;
    }
    
    /**
     * Add shape matching constraint (N particles)
     * Restores particles to original shape - works with ANY number of particles
     * @param {PBDParticle[]} particles - Array of particles
     * @param {number} stiffness - Blend strength (0-1)
     * @param {boolean} rigid - If true, fully restore shape each step
     */
    addShapeMatchingConstraint(particles, stiffness = 0.5, rigid = false) {
        const c = new ShapeMatchingConstraint(particles, stiffness, rigid);
        this.constraints.push(c);
        this.colorGroups = null;
        this._gsPartitionDirty = true;
        return c;
    }
    
    /**
     * Add pressure constraint (N particles forming closed surface)
     * Used for balloons, inflatables
     * @param {PBDParticle[]} particles - All particles in the mesh
     * @param {number[][]} triangles - Array of [i,j,k] triangle indices
     * @param {number} pressure - Target pressure multiplier (1.0 = rest volume)
     */
    addPressureConstraint(particles, triangles, restVolume = null, pressure = 1.0, stiffness = 1.0) {
        const c = new PressureConstraint(particles, triangles, restVolume, pressure, stiffness);
        this.constraints.push(c);
        this.colorGroups = null;
        this._gsPartitionDirty = true;
        return c;
    }
    
    /**
     * Add SPH density constraint (N particles - fluid simulation)
     * Maintains constant density using SPH kernels
     * @param {PBDParticle[]} particles - All fluid particles
     * @param {number} restDensity - Target density (kg/m³)
     * @param {number} kernelRadius - SPH kernel radius
     */
    addDensityConstraint(particles, restDensity = 1000, kernelRadius = 0.1, stiffness = 1.0) {
        const c = new DensityConstraint(particles, restDensity, kernelRadius, stiffness);
        this.constraints.push(c);
        this.colorGroups = null;
        this._gsPartitionDirty = true;
        return c;
    }
    
    /**
     * Build color groups for parallel solving
     */
    buildColorGroups() {
        const { colors, numColors } = colorConstraints(this.constraints, this.particles);
        this.colorGroups = groupByColor(this.constraints, numColors);
        this.numColors = numColors;
        return numColors;
    }
    
    /**
     * Wake all sleeping particles (call when external forces applied)
     */
    wakeAll() {
        for (const p of this.particles) {
            p.flags &= ~ParticleFlags.SLEEPING;
            p._sleepCounter = 0;
        }
    }
    
    /**
     * Wake particles near a point (for localized disturbances)
     */
    wakeNear(x, y, z, radius) {
        const r2 = radius * radius;
        for (const p of this.particles) {
            const dx = p.x - x;
            const dy = p.y - y;
            const dz = p.z - z;
            if (dx * dx + dy * dy + dz * dz < r2) {
                p.flags &= ~ParticleFlags.SLEEPING;
                p._sleepCounter = 0;
            }
        }
    }
    
    /**
     * Get solver statistics
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Reset all particles to initial state
     */
    reset() {
        for (const p of this.particles) {
            p.vx = p.vy = p.vz = 0;
            p.flags &= ~ParticleFlags.SLEEPING;
            p._sleepCounter = 0;
        }
        for (const c of this.constraints) {
            c.lambda = 0;
        }
    }
    
    /**
     * Apply impulse to a particle (wakes it automatically)
     */
    applyImpulse(particle, ix, iy, iz) {
        if (particle.isFixed()) return;
        particle.vx += ix * particle.invMass;
        particle.vy += iy * particle.invMass;
        particle.vz += iz * particle.invMass;
        particle.flags &= ~ParticleFlags.SLEEPING;
        particle._sleepCounter = 0;
    }
    
    /**
     * Apply force to a particle over dt (wakes it automatically)
     */
    applyForce(particle, fx, fy, fz, dt = 1/60) {
        this.applyImpulse(particle, fx * dt, fy * dt, fz * dt);
    }
    
    /**
     * Step simulation
     * @param {number} dt - Delta time
     */
    step(dt) {
        const subDt = dt / this.substeps;
        const lastSub = this.substeps - 1;
        
        for (let sub = 0; sub < this.substeps; sub++) {
            this._substep(subDt, sub === lastSub);
        }
    }
    
    _substep(dt, isLastSubstep) {
        // Safety check for dt
        if (!Number.isFinite(dt) || dt <= 0 || dt > 1) {
            console.error(`[PBDSolver] Invalid dt: ${dt}`);
            return;
        }
        
        // Reset stats
        this.stats.activeParticles = 0;
        this.stats.sleepingParticles = 0;
        this.stats.clampedVelocities = 0;
        
        // Standard XPBD algorithm (Macklin et al.):
        // 1. Apply external forces to velocity (gravity, damping)
        // 2. Predict position from velocity
        // 3. Solve constraints (modifies positions)
        // 4. Update velocity from position change
        // 5. Apply velocity clamping and sleep detection
        
        const maxVel = this.maxVelocity;
        const maxVelSq = maxVel * maxVel;
        const maxPos = this.maxPosition;
        const gx = this.gravity[0] * dt;
        const gy = this.gravity[1] * dt;
        const gz = this.gravity[2] * dt;
        const dampFactor = Math.pow(this.damping, dt * 60); // Hoisted: same for all particles
        const sleepThreshSq = this.sleepThreshold * this.sleepThreshold;
        const doSleep = this.enableSleep;
        
        // 1. Apply external forces and predict positions
        for (const p of this.particles) {
            if (p.isFixed()) continue;
            
            // NaN recovery - reset particle to previous valid state
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
                this.stats.nanRecoveries++;
                p.x = Number.isFinite(p.px) ? p.px : 0;
                p.y = Number.isFinite(p.py) ? p.py : 0;
                p.z = Number.isFinite(p.pz) ? p.pz : 0;
                p.vx = p.vy = p.vz = 0;
                p.px = p.x;
                p.py = p.y;
                p.pz = p.z;
                continue;
            }
            
            // Sleep detection - skip nearly stationary particles
            if (doSleep && (p.flags & ParticleFlags.SLEEPING)) {
                const velSq = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
                if (velSq < sleepThreshSq) {
                    this.stats.sleepingParticles++;
                    continue;
                }
                // Wake up — also wake connected particles (prevents stiff spots in ropes
                // where a sleeping middle particle blocks constraint propagation)
                p.flags &= ~ParticleFlags.SLEEPING;
                p._sleepCounter = 0;
                for (const c of this.distanceConstraints) {
                    const other = c.particleA === p ? c.particleB : (c.particleB === p ? c.particleA : null);
                    if (other && (other.flags & ParticleFlags.SLEEPING)) {
                        other.flags &= ~ParticleFlags.SLEEPING;
                        other._sleepCounter = 0;
                    }
                }
            }
            
            this.stats.activeParticles++;
            
            // Apply gravity (hoisted multiplications)
            p.vx += gx;
            p.vy += gy;
            p.vz += gz;
            p.vx *= dampFactor;
            p.vy *= dampFactor;
            p.vz *= dampFactor;
            
            // Velocity clamping - prevent explosion
            const velSq = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
            if (velSq > maxVelSq) {
                const scale = maxVel / Math.sqrt(velSq);
                p.vx *= scale;
                p.vy *= scale;
                p.vz *= scale;
                this.stats.clampedVelocities++;
            }
            
            // Store previous position (before prediction)
            p.px = p.x;
            p.py = p.y;
            p.pz = p.z;
            
            // Predict position
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            
            // Position bounds clamping
            if (Math.abs(p.x) > maxPos || Math.abs(p.y) > maxPos || Math.abs(p.z) > maxPos) {
                p.x = Math.max(-maxPos, Math.min(maxPos, p.x));
                p.y = Math.max(-maxPos, Math.min(maxPos, p.y));
                p.z = Math.max(-maxPos, Math.min(maxPos, p.z));
                // Also reset velocity to prevent continued flying
                p.vx *= 0.1;
                p.vy *= 0.1;
                p.vz *= 0.1;
            }
        }
        
        // 2. Generate collision constraints
        if (this.enableGroundCollision) {
            this._generateGroundCollisions(dt);
        }
        
        // 2b. Self-collision detection (particle-particle)
        if (this.selfCollision) {
            this._solveSelfCollisions();
        }
        
        // 3. Reset or warm-start XPBD Lagrange multipliers
        if (this.warmStart) {
            // Warm starting: decay previous lambda values instead of resetting
            // This improves convergence for quasi-static scenarios
            for (const c of this.constraints) {
                c.lambda *= this.warmStartFactor;
            }
        } else {
            for (const c of this.constraints) {
                c.lambda = 0;
            }
        }
        
        // 4. Solve constraints iteratively
        // Supports: Gauss-Seidel (default), Jacobi, SOR, Chebyshev acceleration
        const useJacobi = this.useJacobi;
        let omega = this.omega;
        
        // Initialize momentum buffer if using momentum acceleration
        if (this.useMomentum && !this._momentumBuffer) {
            this._momentumBuffer = new Map();
            for (const p of this.particles) {
                this._momentumBuffer.set(p, { dx: 0, dy: 0, dz: 0 });
            }
        }
        
        // Initialize Anderson acceleration history if enabled
        if (this.useAnderson && !this._andersonHistory) {
            this._andersonHistory = {
                positions: [], // Ring buffer of position snapshots
                residuals: [], // Ring buffer of residuals (f(x) - x)
                index: 0,
            };
        }
        
        // Store pre-iteration positions for momentum/Anderson
        const preIterPositions = this.useMomentum || this.useAnderson 
            ? this.particles.map(p => ({ x: p.x, y: p.y, z: p.z }))
            : null;
        
        for (let iter = 0; iter < this.iterations; iter++) {
            // Chebyshev acceleration: vary omega per iteration for spectral acceleration
            if (this.useChebyshev && iter > 0) {
                const rho = this.chebyshevRho;
                if (iter === 1) {
                    omega = 1.0 / (1.0 - 0.5 * rho * rho);
                } else {
                    omega = 1.0 / (1.0 - 0.25 * rho * rho * omega);
                }
            }
            
            // Adaptive omega: adjust based on convergence
            if (this.useAdaptiveOmega && iter > 0) {
                omega = this._adaptOmega(omega);
            }
            
            if (this.useHierarchicalSolver && this.particles.length >= 50) {
                // Hierarchical multi-grid for long ropes (faster convergence)
                this._solveHierarchical(dt, omega);
            } else if (useJacobi) {
                // Jacobi mode: compute all corrections, then apply with averaging
                this._solveConstraintsJacobi(dt, omega);
            } else {
                // Gauss-Seidel mode with over-relaxation (SOR)
                this._solveConstraintsGaussSeidel(dt, omega);
            }
            
            // Solve collision constraints (always Gauss-Seidel)
            for (const c of this.collisionConstraints) {
                c.solve(dt);
            }
        }
        
        // Apply Nesterov/Momentum acceleration after constraint solving
        if (this.useMomentum && preIterPositions) {
            this._applyMomentumAcceleration(preIterPositions);
        }
        
        // Apply Anderson acceleration for better convergence
        if (this.useAnderson && preIterPositions) {
            this._applyAndersonAcceleration(preIterPositions);
        }
        
        // Track constraint error for debugging (only on last substep — saves 7× iteration per frame)
        if (isLastSubstep) this._computeConstraintError();
        
        // Broken constraint cleanup — remove torn constraints and fire callbacks
        // Deferred to after all iterations so break detection is stable
        if (this.onConstraintBreak) {
            for (let i = this.constraints.length - 1; i >= 0; i--) {
                const c = this.constraints[i];
                if (c.broken) {
                    // Compute break position (midpoint between the two particles)
                    const breakPos = [
                        (c.particleA.x + c.particleB.x) * 0.5,
                        (c.particleA.y + c.particleB.y) * 0.5,
                        (c.particleA.z + c.particleB.z) * 0.5,
                    ];
                    // Remove from solver
                    this.constraints.splice(i, 1);
                    this._gsPartitionDirty = true;
                    this.colorGroups = null;
                    // Fire callback (rope sim handles splitting)
                    try { this.onConstraintBreak(c, i, breakPos); } catch (_) {}
                }
            }
        }
        
        // 5. Final position clamp after constraint solving (critical for stability)
        for (const p of this.particles) {
            if (p.isFixed()) continue;
            
            // Clamp positions that went out of bounds during constraint solving
            if (Math.abs(p.x) > maxPos || Math.abs(p.y) > maxPos || Math.abs(p.z) > maxPos) {
                // Reset to previous position if explosion detected
                p.x = Math.max(-maxPos, Math.min(maxPos, p.x));
                p.y = Math.max(-maxPos, Math.min(maxPos, p.y));
                p.z = Math.max(-maxPos, Math.min(maxPos, p.z));
                // Kill velocity to stop explosion
                p.vx = p.vy = p.vz = 0;
                p.px = p.x;
                p.py = p.y;
                p.pz = p.z;
            }
        }
        
        // 5b. Post-substep callback (e.g. rope overstretch clamp)
        // Runs per-substep so corrections don't accumulate across substeps
        if (this.postSubstepCallback) this.postSubstepCallback(dt);
        
        // 6. Update velocities from position change (includes constraint corrections)
        const invDt = 1.0 / dt; // Hoist division outside loop
        for (const p of this.particles) {
            if (p.isFixed()) continue;
            if (doSleep && (p.flags & ParticleFlags.SLEEPING)) continue;
            
            // Compute velocity from position delta (multiply by inverse to avoid per-particle division)
            p.vx = (p.x - p.px) * invDt;
            p.vy = (p.y - p.py) * invDt;
            p.vz = (p.z - p.pz) * invDt;
            
            // Final velocity clamp after constraint solving
            const velSq = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
            if (velSq > maxVelSq) {
                const scale = maxVel / Math.sqrt(velSq);
                p.vx *= scale;
                p.vy *= scale;
                p.vz *= scale;
            }
            
            // Sleep detection - mark nearly stationary particles
            if (doSleep && velSq < sleepThreshSq) {
                p._sleepCounter = (p._sleepCounter || 0) + 1;
                if (p._sleepCounter >= this.sleepFrames) {
                    p.flags |= ParticleFlags.SLEEPING;
                }
            } else {
                p._sleepCounter = 0;
            }
        }
    }
    
    /**
     * Gauss-Seidel constraint solving with over-relaxation (SOR)
     * @private
     */
    _solveConstraintsGaussSeidel(dt, omega) {
        // CRITICAL: Solve attachment constraints LAST so they aren't overridden
        // by distance constraints pulling attached particles away
        // Cache partition to avoid 2 array allocs × 8 substeps per frame
        if (!this._gsAttachments || this._gsPartitionDirty) {
            this._gsAttachments = [];
            this._gsOthers = [];
            for (const c of this.constraints) {
                if (c.type === ConstraintType.ATTACHMENT) {
                    this._gsAttachments.push(c);
                } else {
                    this._gsOthers.push(c);
                }
            }
            this._gsPartitionDirty = false;
        }
        const attachments = this._gsAttachments;
        const others = this._gsOthers;
        
        // Solve by color groups if available (parallel-safe order)
        if (this.colorGroups) {
            for (const group of this.colorGroups) {
                for (const c of group) {
                    if (c.type !== ConstraintType.ATTACHMENT) {
                        this._solveConstraintWithSOR(c, dt, omega);
                    }
                }
            }
        } else {
            // Alternating forward/backward sweep for chains/ropes
            // This doubles convergence speed by propagating corrections in both directions
            // Reference: Müller et al. 2007, standard technique for serial chain convergence
            if (this._gsSweepForward) {
                for (let i = 0; i < others.length; i++) {
                    this._solveConstraintWithSOR(others[i], dt, omega);
                }
            } else {
                for (let i = others.length - 1; i >= 0; i--) {
                    this._solveConstraintWithSOR(others[i], dt, omega);
                }
            }
            this._gsSweepForward = !this._gsSweepForward;
        }
        
        // Solve attachment constraints LAST (they should "win")
        for (const c of attachments) {
            c.solve(dt);
        }
    }
    
    /**
     * Jacobi constraint solving - compute all corrections then apply
     * Better for GPU parallelization but slower convergence
     * @private
     */
    _solveConstraintsJacobi(dt, omega) {
        // Store particle corrections
        const corrections = new Map();
        for (const p of this.particles) {
            corrections.set(p, { dx: 0, dy: 0, dz: 0, count: 0 });
        }
        
        // Compute all corrections without applying (skip attachments - they're solved last)
        for (const c of this.constraints) {
            if (c.type !== ConstraintType.ATTACHMENT) {
                this._computeConstraintCorrection(c, dt, corrections);
            }
        }
        
        // Apply averaged corrections with over-relaxation
        for (const p of this.particles) {
            if (p.isFixed()) continue;
            const corr = corrections.get(p);
            if (corr.count > 0) {
                const scale = omega / corr.count;
                p.x += corr.dx * scale;
                p.y += corr.dy * scale;
                p.z += corr.dz * scale;
            }
        }
        
        // Solve attachment constraints LAST (they should "win")
        for (const c of this.constraints) {
            if (c.type === ConstraintType.ATTACHMENT) {
                c.solve(dt);
            }
        }
    }
    
    /**
     * Solve a single constraint with SOR over-relaxation
     * @private
     */
    _solveConstraintWithSOR(c, dt, omega) {
        if (omega === 1.0) {
            // Standard solve without over-relaxation
            c.solve(dt);
            return;
        }
        
        // For distance constraints, apply over-relaxation
        if (c.particleA && c.particleB) {
            const a = c.particleA;
            const b = c.particleB;
            
            // Store old positions
            const oldAx = a.x, oldAy = a.y, oldAz = a.z;
            const oldBx = b.x, oldBy = b.y, oldBz = b.z;
            
            // Solve constraint
            c.solve(dt);
            
            // Apply over-relaxation
            if (!a.isFixed()) {
                a.x = oldAx + (a.x - oldAx) * omega;
                a.y = oldAy + (a.y - oldAy) * omega;
                a.z = oldAz + (a.z - oldAz) * omega;
            }
            if (!b.isFixed()) {
                b.x = oldBx + (b.x - oldBx) * omega;
                b.y = oldBy + (b.y - oldBy) * omega;
                b.z = oldBz + (b.z - oldBz) * omega;
            }
        } else if (c.particle) {
            // Attachment constraint
            const p = c.particle;
            const oldX = p.x, oldY = p.y, oldZ = p.z;
            c.solve(dt);
            if (!p.isFixed()) {
                p.x = oldX + (p.x - oldX) * omega;
                p.y = oldY + (p.y - oldY) * omega;
                p.z = oldZ + (p.z - oldZ) * omega;
            }
        } else {
            // Unknown constraint type, just solve normally
            c.solve(dt);
        }
    }
    
    /**
     * Compute correction for Jacobi mode without applying
     * @private
     */
    _computeConstraintCorrection(c, dt, corrections) {
        if (c.particleA && c.particleB) {
            const a = c.particleA;
            const b = c.particleB;
            
            if (a.isFixed() && b.isFixed()) return;
            
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = b.z - a.z;
            
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (dist < 0.0001) return;
            
            const restLen = c.restLength || dist;
            const diff = (dist - restLen) / dist;
            
            const w = a.invMass + b.invMass;
            if (w === 0) return;
            
            const alpha = (c.compliance || 0) / (dt * dt);
            const deltaLambda = (-diff * dist - alpha * c.lambda) / (w + alpha);
            c.lambda += deltaLambda;
            
            const correction = deltaLambda / dist;
            
            // Same sign fix as DistanceConstraint.solve()
            if (!a.isFixed()) {
                const corrA = corrections.get(a);
                corrA.dx -= dx * correction * a.invMass;
                corrA.dy -= dy * correction * a.invMass;
                corrA.dz -= dz * correction * a.invMass;
                corrA.count++;
            }
            
            if (!b.isFixed()) {
                const corrB = corrections.get(b);
                corrB.dx += dx * correction * b.invMass;
                corrB.dy += dy * correction * b.invMass;
                corrB.dz += dz * correction * b.invMass;
                corrB.count++;
            }
        }
    }
    
    /**
     * Compute average constraint error for debugging
     * @private
     */
    _computeConstraintError() {
        if (this.constraints.length === 0) {
            this.stats.constraintError = 0;
            return;
        }
        
        let totalError = 0;
        let count = 0;
        
        for (const c of this.constraints) {
            if (c.particleA && c.particleB && c.restLength !== undefined) {
                const dx = c.particleB.x - c.particleA.x;
                const dy = c.particleB.y - c.particleA.y;
                const dz = c.particleB.z - c.particleA.z;
                const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                totalError += Math.abs(dist - c.restLength);
                count++;
            }
        }
        
        this.stats.constraintError = count > 0 ? totalError / count : 0;
    }
    
    /**
     * Nesterov/Momentum acceleration - extrapolate positions based on previous corrections
     * Reference: Nesterov 1983, adapted for PBD
     * @private
     */
    _applyMomentumAcceleration(preIterPositions) {
        const beta = this.momentumBeta;
        
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.isFixed()) continue;
            
            const pre = preIterPositions[i];
            const momentum = this._momentumBuffer.get(p);
            
            // Current correction from constraint solving
            const corrX = p.x - pre.x;
            const corrY = p.y - pre.y;
            const corrZ = p.z - pre.z;
            
            // Apply momentum: new_pos = pos + beta * prev_momentum
            p.x += beta * momentum.dx;
            p.y += beta * momentum.dy;
            p.z += beta * momentum.dz;
            
            // Update momentum buffer for next iteration
            momentum.dx = corrX;
            momentum.dy = corrY;
            momentum.dz = corrZ;
        }
    }
    
    /**
     * Anderson Acceleration - uses history of residuals to extrapolate better solutions
     * Reference: Walker & Ni 2011, "Anderson Acceleration for Fixed-Point Iterations"
     * This dramatically improves convergence for stiff constraint systems
     * @private
     */
    _applyAndersonAcceleration(preIterPositions) {
        const m = this.andersonM;
        const history = this._andersonHistory;
        
        // Compute current residual (correction from constraint solving)
        const residual = [];
        const currentPos = [];
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const pre = preIterPositions[i];
            currentPos.push({ x: p.x, y: p.y, z: p.z });
            residual.push({
                x: p.x - pre.x,
                y: p.y - pre.y,
                z: p.z - pre.z,
            });
        }
        
        // Add to history
        history.positions.push(currentPos);
        history.residuals.push(residual);
        
        // Keep only last m entries
        while (history.positions.length > m) {
            history.positions.shift();
            history.residuals.shift();
        }
        
        // Need at least 2 entries for Anderson
        if (history.residuals.length < 2) return;
        
        const k = history.residuals.length;
        
        // Build difference matrices G_k (residual differences)
        // Solve least squares: min ||g_k - G_k * gamma||
        // Using simplified 1D approach for efficiency (average across all particles)
        
        // Compute average residual magnitude for weighting
        let avgResidual = 0;
        for (const r of residual) {
            avgResidual += r.x * r.x + r.y * r.y + r.z * r.z;
        }
        avgResidual = Math.sqrt(avgResidual / this.particles.length);
        
        if (avgResidual < 1e-10) return; // Already converged
        
        // Simplified Anderson: use last 2 residuals to compute mixing coefficient
        const prevResidual = history.residuals[k - 2];
        
        let dotGG = 0, dotGR = 0;
        for (let i = 0; i < this.particles.length; i++) {
            const curr = residual[i];
            const prev = prevResidual[i];
            const gx = curr.x - prev.x;
            const gy = curr.y - prev.y;
            const gz = curr.z - prev.z;
            dotGG += gx * gx + gy * gy + gz * gz;
            dotGR += gx * curr.x + gy * curr.y + gz * curr.z;
        }
        
        if (dotGG < 1e-12) return;
        
        // Optimal mixing coefficient
        const gamma = Math.max(-1, Math.min(1, dotGR / dotGG));
        
        // Apply Anderson extrapolation: x_new = x_k - gamma * (x_k - x_{k-1}) + (1-gamma)*g_k
        const prevPos = history.positions[k - 2];
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.isFixed()) continue;
            
            const prev = prevPos[i];
            const curr = currentPos[i];
            
            // Extrapolate position
            p.x = curr.x - gamma * (curr.x - prev.x);
            p.y = curr.y - gamma * (curr.y - prev.y);
            p.z = curr.z - gamma * (curr.z - prev.z);
        }
    }
    
    /**
     * Adaptive omega adjustment based on convergence behavior
     * Increases omega when converging, decreases when oscillating
     * @private
     */
    _adaptOmega(currentOmega) {
        const error = this.stats.constraintError;
        const prevError = this._prevConstraintError;
        
        let newOmega = currentOmega;
        
        if (error < prevError * 0.95) {
            // Converging well - try increasing omega
            newOmega = Math.min(1.95, currentOmega + this._omegaAdaptRate);
        } else if (error > prevError * 1.05) {
            // Oscillating or diverging - decrease omega
            newOmega = Math.max(0.5, currentOmega - this._omegaAdaptRate * 2);
        }
        
        this._prevConstraintError = error;
        return newOmega;
    }
    
    _generateGroundCollisions(dt) {
        this.collisionConstraints.length = 0; // Reuse array (no allocation)
        
        const r = this.contactRadius;
        const activationDist = 2 * r;
        const stiffness = this.barrierStiffness;
        
        // Module-level scratch arrays (no dynamic props on `this` — V8 hidden class safety)
        const sp = _gcScratchP;
        const spp = _gcScratchPlaneP;
        const spn = _gcScratchPlaneN;
        spp[1] = this.groundY;
        
        for (const p of this.particles) {
            if (p.isFixed()) continue;
            
            if (this.useOGC) {
                // OGC: Ground plane collision with offset geometry (zero-alloc)
                sp[0] = p.x; sp[1] = p.y; sp[2] = p.z;
                const result = distanceToOffsetPlane(sp, spp, spn, r + p.radius);
                // Read result immediately (cached object gets reused by next call)
                const dist = result.distance;
                const nx = result.normal[0], ny = result.normal[1], nz = result.normal[2];
                
                if (dist < activationDist) {
                    // Position correction
                    if (dist < 0) {
                        p.x += nx * (-dist);
                        p.y += ny * (-dist);
                        p.z += nz * (-dist);
                    }
                    
                    // Barrier force (smooth repulsion)
                    const forceMag = -barrierForce(dist, r) * stiffness;
                    const impulse = forceMag * dt * p.invMass;
                    p.vx += nx * impulse;
                    p.vy += ny * impulse;
                    p.vz += nz * impulse;
                    
                    // Friction
                    if (dist < r) {
                        p.vx *= (1 - this.friction * 0.1);
                        p.vz *= (1 - this.friction * 0.1);
                    }
                }
                
                // OGC: Check additional colliders
                this._solveOGCColliders(p, r, stiffness, dt);
            } else {
                // Legacy: Direct penetration resolution
                const penetration = this.groundY + p.radius - p.y;
                if (penetration > 0) {
                    p.y = this.groundY + p.radius;
                    const vy = p.y - p.py;
                    if (vy < 0) {
                        p.vx *= this.friction;
                        p.vz *= this.friction;
                    }
                }
            }
        }
    }
    
    /**
     * Solve OGC collisions for a particle against all registered colliders
     * @private
     */
    _solveOGCColliders(p, r, stiffness, dt) {
        // Module-level scratch array (no dynamic props on `this` — V8 hidden class safety)
        const pos = _gcScratchP;
        pos[0] = p.x; pos[1] = p.y; pos[2] = p.z;
        
        // Save original position — used to cap total displacement from all colliders
        const ox = p.x, oy = p.y, oz = p.z;
        
        // Sphere colliders (cached result — read dist/normal before next call)
        for (const sphere of this.ogcColliders.spheres) {
            const result = distanceToOffsetSphere(pos, sphere.center, sphere.radius, r + p.radius);
            this._applyOGCContact(p, result.distance, result.normal, r, stiffness, dt, sphere.friction);
        }
        
        // Plane colliders
        for (const plane of this.ogcColliders.planes) {
            const result = distanceToOffsetPlane(pos, plane.point, plane.normal, r + p.radius);
            this._applyOGCContact(p, result.distance, result.normal, r, stiffness, dt, plane.friction);
        }
        
        // Capsule colliders
        for (const capsule of this.ogcColliders.capsules) {
            const result = distanceToOffsetCapsule(pos, capsule.a, capsule.b, capsule.radius, r + p.radius);
            this._applyOGCContact(p, result.distance, result.normal, r, stiffness, dt, capsule.friction);
        }
        
        // Box colliders (OBB)
        for (const box of this.ogcColliders.boxes) {
            const result = distanceToOffsetBox(pos, box.center, box.halfExtents, box.rotation, r + p.radius);
            this._applyOGCContact(p, result.distance, result.normal, r, stiffness, dt, box.friction);
        }
        
        // SDF colliders (analytic signed distance fields from spawnable shapes)
        for (const sdf of this.ogcColliders.sdfs) {
            // Transform particle to entity local space
            let lx = pos[0] - sdf.position[0];
            let ly = pos[1] - sdf.position[1];
            let lz = pos[2] - sdf.position[2];
            
            // Inverse rotation (conjugate quaternion)
            const qx = sdf.rotation[0], qy = sdf.rotation[1], qz = sdf.rotation[2], qw = sdf.rotation[3];
            const nqx = -qx, nqy = -qy, nqz = -qz;
            const tx = 2 * (nqy * lz - nqz * ly);
            const ty = 2 * (nqz * lx - nqx * lz);
            const tz = 2 * (nqx * ly - nqy * lx);
            lx = lx + qw * tx + (nqy * tz - nqz * ty);
            ly = ly + qw * ty + (nqz * tx - nqx * tz);
            lz = lz + qw * tz + (nqx * ty - nqy * tx);
            
            // Inverse scale (divide by entity scale to get unit-space coordinates)
            lx *= sdf.invScale[0];
            ly *= sdf.invScale[1];
            lz *= sdf.invScale[2];
            
            // Evaluate analytic SDF in local space
            const sdfResult = evaluateAnalyticSDF(sdf.sdfShape, sdf.sdfParams, lx, ly, lz);
            
            // Scale distance back to world space (conservative: use min scale)
            const worldDist = sdfResult.distance * sdf.minScale - (r + p.radius);
            
            // Rotate normal back to world space
            let nx = sdfResult.normal[0], ny = sdfResult.normal[1], nz = sdfResult.normal[2];
            const t2x = 2 * (qy * nz - qz * ny);
            const t2y = 2 * (qz * nx - qx * nz);
            const t2z = 2 * (qx * ny - qy * nx);
            const wnx = nx + qw * t2x + (qy * t2z - qz * t2y);
            const wny = ny + qw * t2y + (qz * t2x - qx * t2z);
            const wnz = nz + qw * t2z + (qx * t2y - qy * t2x);
            
            // Reuse _sdfNormalScratch to avoid per-particle allocation
            _sdfNormalScratch[0] = wnx; _sdfNormalScratch[1] = wny; _sdfNormalScratch[2] = wnz;
            this._applyOGCContact(p, worldDist, _sdfNormalScratch, r, stiffness, dt, sdf.friction);
        }
        
        // Cap total displacement from ALL colliders combined.
        // Safety net for particles near multiple entity surfaces simultaneously.
        const dx = p.x - ox, dy = p.y - oy, dz = p.z - oz;
        const totalDispSq = dx * dx + dy * dy + dz * dz;
        const maxTotalDisp = 8 * r;
        if (totalDispSq > maxTotalDisp * maxTotalDisp) {
            const scale = maxTotalDisp / Math.sqrt(totalDispSq);
            p.x = ox + dx * scale;
            p.y = oy + dy * scale;
            p.z = oz + dz * scale;
        }
    }
    
    /**
     * Apply OGC contact correction to a particle
     * @private
     */
    _applyOGCContact(p, dist, normal, r, stiffness, dt, friction = 0.5) {
        const activationDist = 2 * r;
        if (dist >= activationDist) return;
        
        // Skip deep penetrations: particles far inside an entity are on rope paths
        // that intentionally cross entity volumes. Pushing them out every substep
        // creates persistent destabilizing forces → rope explosion.
        // Only respond to shallow contact (within r of surface).
        if (dist < -r) return;
        
        // Position correction for shallow penetration (-r < dist < 0)
        if (dist < 0) {
            p.x += normal[0] * (-dist);
            p.y += normal[1] * (-dist);
            p.z += normal[2] * (-dist);
        }
        
        // Barrier force (smooth repulsion for 0 < dist < 2r approach zone)
        const forceMag = -barrierForce(dist, r) * stiffness;
        const impulse = forceMag * dt * p.invMass;
        p.vx += normal[0] * impulse;
        p.vy += normal[1] * impulse;
        p.vz += normal[2] * impulse;
        
        // Friction
        if (dist < r) {
            const normalVel = p.vx * normal[0] + p.vy * normal[1] + p.vz * normal[2];
            const tangentX = p.vx - normal[0] * normalVel;
            const tangentY = p.vy - normal[1] * normalVel;
            const tangentZ = p.vz - normal[2] * normalVel;
            const frictionDamp = 1 - friction * 0.1;
            p.vx = normal[0] * normalVel + tangentX * frictionDamp;
            p.vy = normal[1] * normalVel + tangentY * frictionDamp;
            p.vz = normal[2] * normalVel + tangentZ * frictionDamp;
        }
    }
    
    /**
     * Solve self-collisions between particles
     * Uses position-based collision response for stability
     * Thread-aware: only skips adjacent particles on the SAME thread
     * @private
     */
    _solveSelfCollisions() {
        const n = this.particles.length;
        const skip = this.selfCollisionSkip;
        const minDist = this.selfCollisionRadius * 2;
        const minDistSq = minDist * minDist;
        
        this.stats.selfCollisions = 0;
        
        // O(n²) brute force - for small particle counts (<1000)
        // TODO: Use spatial hash for larger counts
        for (let i = 0; i < n; i++) {
            const pi = this.particles[i];
            if (pi.isFixed()) continue;
            
            for (let j = i + 1; j < n; j++) {
                const pj = this.particles[j];
                if (pj.isFixed()) continue;
                
                // Thread-aware skip: only skip adjacent particles on the SAME thread
                // For multi-thread ropes, particles on different threads should always collide
                const sameThread = (pi.threadIndex !== undefined && pi.threadIndex === pj.threadIndex);
                if (sameThread && Math.abs(i - j) <= skip) continue;
                
                // Distance check
                const dx = pj.x - pi.x;
                const dy = pj.y - pi.y;
                const dz = pj.z - pi.z;
                const distSq = dx * dx + dy * dy + dz * dz;
                
                if (distSq < minDistSq && distSq > 1e-10) {
                    const dist = Math.sqrt(distSq);
                    const overlap = minDist - dist;
                    
                    // Normalize direction
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const nz = dz / dist;
                    
                    // Mass-weighted correction with soft response to reduce jiggle
                    const w = pi.invMass + pj.invMass;
                    if (w === 0) continue;
                    
                    // Softer collision response (0.3 instead of 0.5) reduces jiggle
                    const stiffness = this.selfCollisionStiffness ?? 0.3;
                    const correctionI = overlap * (pi.invMass / w) * stiffness;
                    const correctionJ = overlap * (pj.invMass / w) * stiffness;
                    
                    // Push particles apart
                    pi.x -= nx * correctionI;
                    pi.y -= ny * correctionI;
                    pi.z -= nz * correctionI;
                    
                    pj.x += nx * correctionJ;
                    pj.y += ny * correctionJ;
                    pj.z += nz * correctionJ;
                    
                    this.stats.selfCollisions++;
                }
            }
        }
    }
    
    /**
     * Add OGC sphere collider
     */
    addSphereCollider(center, radius, friction = 0.5) {
        this.ogcColliders.spheres.push({ center: [...center], radius, friction });
    }
    
    /**
     * Add OGC plane collider
     */
    addPlaneCollider(point, normal, friction = 0.5) {
        const len = Math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2);
        this.ogcColliders.planes.push({
            point: [...point],
            normal: [normal[0]/len, normal[1]/len, normal[2]/len],
            friction,
        });
    }
    
    /**
     * Add OGC capsule collider
     */
    addCapsuleCollider(a, b, radius, friction = 0.5) {
        this.ogcColliders.capsules.push({ a: [...a], b: [...b], radius, friction });
    }
    
    /**
     * Add OGC box collider (OBB - oriented bounding box)
     * @param {Array} center - Box center [x, y, z]
     * @param {Array} halfExtents - Half-extents [hx, hy, hz]
     * @param {Array} rotation - Quaternion [x, y, z, w] (identity = [0,0,0,1])
     * @param {number} friction - Surface friction (0-1)
     */
    addBoxCollider(center, halfExtents, rotation = [0, 0, 0, 1], friction = 0.5) {
        this.ogcColliders.boxes.push({
            center: [...center],
            halfExtents: [...halfExtents],
            rotation: [...rotation],
            friction,
        });
    }
    
    /**
     * Add analytic SDF collider from a spawnable's sdfShape/sdfParams.
     * The SDF is evaluated in the entity's local space; the solver handles
     * world→local transform using position/rotation/scale.
     * @param {string} sdfShape - SDF shape type ('box','sphere','capsule','cylinder','torus',etc.)
     * @param {Array} sdfParams - Shape parameters [p0, p1, p2, p3]
     * @param {Array} position - Entity world position [x, y, z]
     * @param {Array} rotation - Entity rotation quaternion [x, y, z, w]
     * @param {Array} scale - Entity scale [sx, sy, sz]
     * @param {number} friction - Surface friction (0-1)
     */
    addSDFCollider(sdfShape, sdfParams, position, rotation, scale, friction = 0.4) {
        const sx = scale[0] || 1, sy = scale[1] || 1, sz = scale[2] || 1;
        this.ogcColliders.sdfs.push({
            sdfShape,
            sdfParams,
            position: [...position],
            rotation: [...rotation],
            invScale: [1 / sx, 1 / sy, 1 / sz],
            minScale: Math.min(sx, sy, sz),
            friction,
        });
    }
    
    /**
     * Clear all OGC colliders
     */
    clearColliders() {
        this.ogcColliders.spheres.length = 0;
        this.ogcColliders.planes.length = 0;
        this.ogcColliders.capsules.length = 0;
        this.ogcColliders.boxes.length = 0;
        this.ogcColliders.sdfs.length = 0;
    }
    
    /**
     * Set OGC contact parameters
     */
    setContactParams(contactRadius, barrierStiffness) {
        if (contactRadius !== undefined) this.contactRadius = contactRadius;
        if (barrierStiffness !== undefined) this.barrierStiffness = barrierStiffness;
    }
    
    /**
     * Create a rope/chain between two points
     * @returns {PBDParticle[]}
     */
    createRope(startX, startY, startZ, endX, endY, endZ, segments, stiffness = 1.0) {
        const particles = [];
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const x = startX + (endX - startX) * t;
            const y = startY + (endY - startY) * t;
            const z = startZ + (endZ - startZ) * t;
            
            const p = this.addParticle(x, y, z);
            particles.push(p);
            
            if (i > 0) {
                this.addDistanceConstraint(particles[i-1], particles[i], null, stiffness);
            }
        }
        
        return particles;
    }
    
    /**
     * Create a cloth grid
     * @returns {PBDParticle[][]}
     */
    createCloth(originX, originY, originZ, width, height, resX, resY, stiffness = 0.9) {
        const particles = [];
        const cellW = width / resX;
        const cellH = height / resY;
        
        // Create particles
        for (let y = 0; y <= resY; y++) {
            const row = [];
            for (let x = 0; x <= resX; x++) {
                const px = originX + x * cellW;
                const py = originY;
                const pz = originZ + y * cellH;
                row.push(this.addParticle(px, py, pz));
            }
            particles.push(row);
        }
        
        // Create constraints
        for (let y = 0; y <= resY; y++) {
            for (let x = 0; x <= resX; x++) {
                // Horizontal
                if (x < resX) {
                    this.addDistanceConstraint(particles[y][x], particles[y][x+1], null, stiffness);
                }
                // Vertical
                if (y < resY) {
                    this.addDistanceConstraint(particles[y][x], particles[y+1][x], null, stiffness);
                }
                // Diagonal (shear)
                if (x < resX && y < resY) {
                    this.addDistanceConstraint(particles[y][x], particles[y+1][x+1], null, stiffness * 0.5);
                    this.addDistanceConstraint(particles[y][x+1], particles[y+1][x], null, stiffness * 0.5);
                }
            }
        }
        
        return particles;
    }
    
    /**
     * Get GPU-ready particle data
     * @returns {Float32Array}
     */
    getParticleData() {
        const data = new Float32Array(this.particles.length * 8);
        
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const offset = i * 8;
            
            data[offset + 0] = p.x;
            data[offset + 1] = p.y;
            data[offset + 2] = p.z;
            data[offset + 3] = p.invMass;
            data[offset + 4] = p.px;
            data[offset + 5] = p.py;
            data[offset + 6] = p.pz;
            data[offset + 7] = p.radius;
        }
        
        return data;
    }
    
    /**
     * Get GPU-ready constraint data
     * @returns {Float32Array}
     */
    getConstraintData() {
        const distanceConstraints = this.constraints.filter(
            c => c.type === ConstraintType.DISTANCE
        );
        
        const data = new Float32Array(distanceConstraints.length * 4);
        
        for (let i = 0; i < distanceConstraints.length; i++) {
            const c = distanceConstraints[i];
            const offset = i * 4;
            
            data[offset + 0] = this.particles.indexOf(c.particleA);
            data[offset + 1] = this.particles.indexOf(c.particleB);
            data[offset + 2] = c.restLength;
            data[offset + 3] = c.compliance;
        }
        
        return data;
    }
    
    // ========================================================================
    // ADVANCED SOLVER METHODS (Research-based improvements)
    // ========================================================================
    
    /**
     * Compute iteration-corrected stiffness
     * Makes stiffness independent of iteration count
     * Formula: k' = 1 - (1-k)^(1/n)
     * Reference: Owlree blog, PBD paper Appendix
     * 
     * @param {number} stiffness - Original stiffness (0-1)
     * @param {number} iterations - Number of solver iterations
     * @returns {number} Corrected stiffness
     */
    getCorrectedStiffness(stiffness, iterations = null) {
        if (!this.useStiffnessCorrection) return stiffness;
        const n = iterations ?? (this.iterations * this.substeps);
        if (n <= 1) return stiffness;
        // k' = 1 - (1-k)^(1/n)
        return 1 - Math.pow(1 - stiffness, 1 / n);
    }
    
    /**
     * Build hierarchical constraint levels for multi-grid solving
     * Coarse levels contain every 2^level-th constraint
     * Reference: Dylan Weeks rope simulation, MGPBD papers
     * @private
     */
    _buildHierarchy() {
        if (this._hierarchyCache) return this._hierarchyCache;
        
        const levels = [];
        const distanceConstraints = this.constraints.filter(
            c => c.type === ConstraintType.DISTANCE && c.particleA && c.particleB
        );
        
        // Level 0: all constraints (finest)
        levels.push(distanceConstraints);
        
        // Build coarser levels (skip every 2^level constraints)
        for (let lvl = 1; lvl < this.hierarchyLevels; lvl++) {
            const skip = Math.pow(2, lvl);
            const coarseLevel = [];
            for (let i = 0; i < distanceConstraints.length; i += skip) {
                coarseLevel.push(distanceConstraints[i]);
            }
            if (coarseLevel.length > 0) {
                levels.push(coarseLevel);
            }
        }
        
        // Reverse so we solve coarse first, then fine
        this._hierarchyCache = levels.reverse();
        return this._hierarchyCache;
    }
    
    /**
     * Solve constraints using hierarchical multi-grid approach
     * Starts at coarsest level and works down to finest
     * Dramatically improves convergence for long ropes (500+ particles)
     * @param {number} dt - Time step
     * @param {number} omega - Over-relaxation factor
     * @private
     */
    _solveHierarchical(dt, omega) {
        const hierarchy = this._buildHierarchy();
        
        // Solve from coarse to fine
        for (const levelConstraints of hierarchy) {
            for (const c of levelConstraints) {
                this._solveConstraintWithSOR(c, dt, omega);
            }
        }
        
        // Solve attachment constraints last
        for (const c of this.constraints) {
            if (c.type === ConstraintType.ATTACHMENT) {
                c.solve(dt);
            }
        }
    }
    
    /**
     * Compute per-particle displacement bounds (OGC SIGGRAPH 2025)
     * Returns maximum safe displacement for each particle before collision check needed
     * @param {number} contactRadius - Contact radius r
     * @returns {Map<PBDParticle, number>} Displacement bound per particle
     */
    computeDisplacementBounds(contactRadius = null) {
        const r = contactRadius ?? this.contactRadius;
        const bounds = new Map();
        const gamma = this.displacementBoundRatio;
        
        for (const p of this.particles) {
            if (p.isFixed()) {
                bounds.set(p, 0);
                continue;
            }
            
            // Find minimum distance to any collider
            let minDist = Infinity;
            
            // Check OGC colliders
            for (const sphere of this.ogcColliders.spheres) {
                const dx = p.x - sphere.center[0];
                const dy = p.y - sphere.center[1];
                const dz = p.z - sphere.center[2];
                const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) - sphere.radius - r;
                minDist = Math.min(minDist, dist);
            }
            
            for (const plane of this.ogcColliders.planes) {
                const dx = p.x - plane.point[0];
                const dy = p.y - plane.point[1];
                const dz = p.z - plane.point[2];
                const dist = dx*plane.normal[0] + dy*plane.normal[1] + dz*plane.normal[2] - r;
                minDist = Math.min(minDist, dist);
            }
            
            // Ground collision
            if (this.enableGroundCollision) {
                const groundDist = p.y - this.groundY - p.radius - r;
                minDist = Math.min(minDist, groundDist);
            }
            
            // Self-collision with other particles
            if (this.selfCollision) {
                const pIdx = this.particles.indexOf(p);
                for (let i = 0; i < this.particles.length; i++) {
                    if (Math.abs(i - pIdx) <= this.selfCollisionSkip) continue;
                    const other = this.particles[i];
                    const dx = p.x - other.x;
                    const dy = p.y - other.y;
                    const dz = p.z - other.z;
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) - p.radius - other.radius - 2*r;
                    minDist = Math.min(minDist, dist);
                }
            }
            
            // Conservative bound: γ * minDist (γ=0.45 from paper)
            const bound = Math.max(0, gamma * minDist);
            bounds.set(p, bound);
        }
        
        return bounds;
    }
    
    /**
     * Clamp particle displacement to its conservative bound
     * Prevents penetration without expensive CCD
     * @param {PBDParticle} p - Particle
     * @param {number} bound - Maximum displacement
     * @param {number} px0 - Previous position x
     * @param {number} py0 - Previous position y
     * @param {number} pz0 - Previous position z
     */
    clampDisplacement(p, bound, px0, py0, pz0) {
        if (bound <= 0 || p.isFixed()) return;
        
        const dx = p.x - px0;
        const dy = p.y - py0;
        const dz = p.z - pz0;
        const disp = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        if (disp > bound && disp > 1e-8) {
            const scale = bound / disp;
            p.x = px0 + dx * scale;
            p.y = py0 + dy * scale;
            p.z = pz0 + dz * scale;
        }
    }
    
    /**
     * Invalidate hierarchy cache (call when constraints change)
     */
    invalidateHierarchy() {
        this._hierarchyCache = null;
    }
    
    /**
     * Add automatic bending constraints along a rope/chain
     * Creates bending constraints between every 3 consecutive particles
     * @param {PBDParticle[]} particles - Ordered particles
     * @param {number} stiffness - Bending stiffness (0-1)
     * @param {number} restAngle - Rest angle (default: PI = straight)
     * @returns {BendingConstraint[]} Created constraints
     */
    addBendingConstraintsForChain(particles, stiffness = 0.3, restAngle = Math.PI) {
        const constraints = [];
        for (let i = 0; i < particles.length - 2; i++) {
            const c = this.addBendingConstraint(
                particles[i],
                particles[i + 1],
                particles[i + 2],
                restAngle,
                stiffness
            );
            constraints.push(c);
        }
        if (constraints.length > 0) {
            console.log(`[PBDSolver] Added ${constraints.length} bending constraints (stiffness=${stiffness.toFixed(2)})`);
        }
        return constraints;
    }
}

export default PBDSolver;
