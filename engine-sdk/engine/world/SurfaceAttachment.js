// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SurfaceAttachment.js - Entity Attachment to Planet Surface
 * 
 * Manages how entities attach to and move on planet surfaces:
 * - Standing on ground (gravity-aligned)
 * - Vehicle mounts (inherit vehicle motion)
 * - Grappling hooks (elastic constraint)
 * - Magnetic boots (force-based)
 * - Free fall (no attachment)
 * 
 * Handles:
 * - Attachment creation/destruction
 * - Surface-relative positioning
 * - Break conditions (force threshold, surface destroyed)
 * - Smooth transitions between states
 */

import { Planet } from './PlanetPhysics.js';
import { statsMean } from '../core/math/MathStatistics.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Attachment types */
export const AttachmentType = {
    NONE: 0,           // Free fall
    STANDING: 1,       // Feet on ground
    VEHICLE_MOUNT: 2,  // Seated in/on vehicle
    GRAPPLE: 3,        // Rope/cable attached
    MAGNETIC: 4,       // Magnetic boots/clamps
    CLIMBING: 5,       // Climbing wall/ladder
    SWIMMING: 6,       // In liquid
    FLYING: 7,         // Jetpack/wings (still affected by gravity)
};

/** Break conditions */
export const BreakCondition = {
    NONE: 0,
    FORCE_EXCEEDED: 1,
    SURFACE_DESTROYED: 2,
    MANUAL_RELEASE: 3,
    TIMEOUT: 4,
    OUT_OF_RANGE: 5,
};

/** Default attachment parameters */
export const DEFAULT_PARAMS = {
    standingFriction: 0.8,
    magneticStrength: 100,
    grappleStiffness: 500,
    grappleDamping: 50,
    breakForce: 1000,
    maxGrappleLength: 50,
    climbSpeed: 3,
};

// ============================================================================
// ATTACHMENT POINT
// ============================================================================

/**
 * Represents a point on a surface where attachment occurs
 */
export class AttachmentPoint {
    constructor() {
        // World position
        this.worldX = 0;
        this.worldY = 0;
        this.worldZ = 0;
        
        // Planet-local position (survives rotation)
        this.localX = 0;
        this.localY = 0;
        this.localZ = 0;
        
        // Surface normal (up direction at attachment)
        this.normalX = 0;
        this.normalY = 1;
        this.normalZ = 0;
        
        // Surface tangent basis
        this.tangentX = [1, 0, 0];
        this.tangentY = [0, 0, 1];
        
        // Reference planet
        this.planet = null;
        
        // Chunk/voxel reference (for destruction detection)
        this.chunkId = null;
        this.voxelIndex = -1;
        
        // Valid flag
        this.valid = false;
    }
    
    /**
     * Set from world position on a planet
     * @param {Planet} planet 
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     */
    setFromWorld(planet, x, y, z) {
        this.planet = planet;
        this.worldX = x;
        this.worldY = y;
        this.worldZ = z;
        
        // Convert to planet-local
        const local = planet.worldToPlanetLocal(x, y, z);
        this.localX = local[0];
        this.localY = local[1];
        this.localZ = local[2];
        
        // Get surface normal
        const up = planet.getUpVectorAt(x, y, z);
        this.normalX = up[0];
        this.normalY = up[1];
        this.normalZ = up[2];
        
        // Get tangent basis
        const basis = planet.getTangentBasisAt(x, y, z);
        this.tangentX = basis.north;
        this.tangentY = basis.east;
        
        this.valid = true;
    }
    
    /**
     * Update world position from planet-local (after rotation)
     */
    updateWorldPosition() {
        if (!this.planet || !this.valid) return;
        
        const world = this.planet.planetLocalToWorld(
            this.localX, this.localY, this.localZ
        );
        this.worldX = world[0];
        this.worldY = world[1];
        this.worldZ = world[2];
        
        // Update normal and tangents
        const up = this.planet.getUpVectorAt(this.worldX, this.worldY, this.worldZ);
        this.normalX = up[0];
        this.normalY = up[1];
        this.normalZ = up[2];
        
        const basis = this.planet.getTangentBasisAt(this.worldX, this.worldY, this.worldZ);
        this.tangentX = basis.north;
        this.tangentY = basis.east;
    }
    
    /**
     * Get world position
     * @returns {number[]}
     */
    getWorldPosition() {
        return [this.worldX, this.worldY, this.worldZ];
    }
    
    /**
     * Get surface normal
     * @returns {number[]}
     */
    getNormal() {
        return [this.normalX, this.normalY, this.normalZ];
    }
    
    /**
     * Invalidate (surface destroyed)
     */
    invalidate() {
        this.valid = false;
    }
}

// ============================================================================
// SURFACE ATTACHMENT
// ============================================================================

/**
 * Manages attachment state for a single entity
 */
export class SurfaceAttachment {
    /**
     * @param {Object} entity - Entity being attached
     */
    constructor(entity) {
        this.entity = entity;
        
        // Current attachment state
        this.type = AttachmentType.NONE;
        this.attachmentPoint = new AttachmentPoint();
        
        // Secondary attachment (e.g., two-handed grapple)
        this.secondaryPoint = null;
        
        // Physics state
        this.velocity = [0, 0, 0];
        this.angularVelocity = [0, 0, 0];
        
        // Attachment parameters
        this.params = { ...DEFAULT_PARAMS };
        
        // Forces accumulated this frame
        this.accumulatedForce = [0, 0, 0];
        this.accumulatedTorque = [0, 0, 0];
        
        // Break tracking
        this.breakCondition = BreakCondition.NONE;
        this.forceHistory = []; // For averaging
        
        // Transition state
        this.transitionProgress = 1.0; // 0 = transitioning, 1 = complete
        this.previousType = AttachmentType.NONE;
        
        // Grapple specific
        this.grappleLength = 0;
        this.grappleTargetLength = 0;
        
        // Callbacks
        this.onAttach = null;
        this.onDetach = null;
        this.onBreak = null;
    }
    
    /**
     * Attach to surface at world position
     * @param {Planet} planet 
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {number} type 
     */
    attachAt(planet, x, y, z, type = AttachmentType.STANDING) {
        this.previousType = this.type;
        this.type = type;
        
        this.attachmentPoint.setFromWorld(planet, x, y, z);
        
        // Reset physics state
        this.accumulatedForce = [0, 0, 0];
        this.accumulatedTorque = [0, 0, 0];
        this.breakCondition = BreakCondition.NONE;
        
        // Start transition
        this.transitionProgress = 0;
        
        // Grapple setup
        if (type === AttachmentType.GRAPPLE) {
            const ex = this.entity.x ?? 0;
            const ey = this.entity.y ?? 0;
            const ez = this.entity.z ?? 0;
            this.grappleLength = Math.sqrt(
                (x - ex)**2 + (y - ey)**2 + (z - ez)**2
            );
            this.grappleTargetLength = this.grappleLength;
        }
        
        if (this.onAttach) {
            this.onAttach(this, type);
        }
    }
    
    /**
     * Detach from surface
     * @param {number} condition 
     */
    detach(condition = BreakCondition.MANUAL_RELEASE) {
        if (this.type === AttachmentType.NONE) return;
        
        this.previousType = this.type;
        this.breakCondition = condition;
        
        if (condition !== BreakCondition.MANUAL_RELEASE && this.onBreak) {
            this.onBreak(this, condition);
        }
        
        if (this.onDetach) {
            this.onDetach(this, this.previousType);
        }
        
        this.type = AttachmentType.NONE;
        this.attachmentPoint.valid = false;
        this.transitionProgress = 0;
    }
    
    /**
     * Update attachment physics
     * @param {number} dt 
     * @param {number[]} gravity - Gravity vector at entity position
     */
    update(dt, gravity) {
        // Update transition
        if (this.transitionProgress < 1.0) {
            this.transitionProgress = Math.min(1.0, this.transitionProgress + dt * 5);
        }
        
        // Update attachment point world position (planet rotation)
        if (this.attachmentPoint.valid) {
            this.attachmentPoint.updateWorldPosition();
        }
        
        // Type-specific update
        switch (this.type) {
            case AttachmentType.STANDING:
                this._updateStanding(dt, gravity);
                break;
            case AttachmentType.GRAPPLE:
                this._updateGrapple(dt, gravity);
                break;
            case AttachmentType.MAGNETIC:
                this._updateMagnetic(dt, gravity);
                break;
            case AttachmentType.CLIMBING:
                this._updateClimbing(dt, gravity);
                break;
            case AttachmentType.NONE:
            case AttachmentType.FLYING:
                this._updateFreeFall(dt, gravity);
                break;
        }
        
        // Check break conditions
        this._checkBreakConditions();
        
        // Clear accumulated forces
        this.accumulatedForce = [0, 0, 0];
        this.accumulatedTorque = [0, 0, 0];
    }
    
    _updateStanding(dt, gravity) {
        if (!this.attachmentPoint.valid) {
            this.detach(BreakCondition.SURFACE_DESTROYED);
            return;
        }
        
        // Snap entity to surface
        const ap = this.attachmentPoint;
        const normal = ap.getNormal();
        
        // Entity position should be at attachment point + offset along normal
        const standHeight = this.entity.height ?? 1.8;
        
        if (this.entity.setPosition) {
            this.entity.setPosition(
                ap.worldX + normal[0] * standHeight * 0.5,
                ap.worldY + normal[1] * standHeight * 0.5,
                ap.worldZ + normal[2] * standHeight * 0.5
            );
        }
        
        // Align entity up with surface normal
        if (this.entity.setUpVector) {
            this.entity.setUpVector(normal[0], normal[1], normal[2]);
        }
        
        // Add surface velocity from planet rotation
        const planet = ap.planet;
        if (planet) {
            const surfaceVel = planet.getSurfaceVelocityAt(ap.worldX, ap.worldY, ap.worldZ);
            this.velocity[0] = surfaceVel[0];
            this.velocity[1] = surfaceVel[1];
            this.velocity[2] = surfaceVel[2];
        }
    }
    
    _updateGrapple(dt, gravity) {
        if (!this.attachmentPoint.valid) {
            this.detach(BreakCondition.SURFACE_DESTROYED);
            return;
        }
        
        const ap = this.attachmentPoint;
        const ex = this.entity.x ?? 0;
        const ey = this.entity.y ?? 0;
        const ez = this.entity.z ?? 0;
        
        // Vector from attachment to entity
        const dx = ex - ap.worldX;
        const dy = ey - ap.worldY;
        const dz = ez - ap.worldZ;
        const currentLength = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Check max length
        if (currentLength > this.params.maxGrappleLength) {
            this.detach(BreakCondition.OUT_OF_RANGE);
            return;
        }
        
        // Spring force toward target length
        const stretch = currentLength - this.grappleTargetLength;
        
        if (currentLength > 0.01) {
            const dirX = dx / currentLength;
            const dirY = dy / currentLength;
            const dirZ = dz / currentLength;
            
            // Spring force
            const springForce = -this.params.grappleStiffness * stretch;
            
            // Damping
            const relVelAlongRope = 
                this.velocity[0] * dirX + 
                this.velocity[1] * dirY + 
                this.velocity[2] * dirZ;
            const dampingForce = -this.params.grappleDamping * relVelAlongRope;
            
            const totalForce = springForce + dampingForce;
            
            this.accumulatedForce[0] += dirX * totalForce;
            this.accumulatedForce[1] += dirY * totalForce;
            this.accumulatedForce[2] += dirZ * totalForce;
        }
        
        // Apply gravity
        this.accumulatedForce[0] += gravity[0] * (this.entity.mass ?? 1);
        this.accumulatedForce[1] += gravity[1] * (this.entity.mass ?? 1);
        this.accumulatedForce[2] += gravity[2] * (this.entity.mass ?? 1);
        
        // Integrate
        const mass = this.entity.mass ?? 1;
        this.velocity[0] += this.accumulatedForce[0] / mass * dt;
        this.velocity[1] += this.accumulatedForce[1] / mass * dt;
        this.velocity[2] += this.accumulatedForce[2] / mass * dt;
        
        if (this.entity.setPosition) {
            this.entity.setPosition(
                ex + this.velocity[0] * dt,
                ey + this.velocity[1] * dt,
                ez + this.velocity[2] * dt
            );
        }
    }
    
    _updateMagnetic(dt, gravity) {
        if (!this.attachmentPoint.valid) {
            this.detach(BreakCondition.SURFACE_DESTROYED);
            return;
        }
        
        const ap = this.attachmentPoint;
        const normal = ap.getNormal();
        
        // Strong force toward surface
        const magnetForce = this.params.magneticStrength;
        
        this.accumulatedForce[0] -= normal[0] * magnetForce;
        this.accumulatedForce[1] -= normal[1] * magnetForce;
        this.accumulatedForce[2] -= normal[2] * magnetForce;
        
        // Gravity still applies
        this.accumulatedForce[0] += gravity[0] * (this.entity.mass ?? 1);
        this.accumulatedForce[1] += gravity[1] * (this.entity.mass ?? 1);
        this.accumulatedForce[2] += gravity[2] * (this.entity.mass ?? 1);
        
        // Position constraint: stay on surface
        const ex = this.entity.x ?? 0;
        const ey = this.entity.y ?? 0;
        const ez = this.entity.z ?? 0;
        
        // Project onto surface
        const toEntity = [ex - ap.worldX, ey - ap.worldY, ez - ap.worldZ];
        const normalDist = toEntity[0]*normal[0] + toEntity[1]*normal[1] + toEntity[2]*normal[2];
        
        const standHeight = this.entity.height ?? 1.8;
        const targetDist = standHeight * 0.5;
        
        if (this.entity.setPosition) {
            this.entity.setPosition(
                ex - normal[0] * (normalDist - targetDist),
                ey - normal[1] * (normalDist - targetDist),
                ez - normal[2] * (normalDist - targetDist)
            );
        }
    }
    
    _updateClimbing(dt, gravity) {
        // Similar to standing but allows vertical movement
        if (!this.attachmentPoint.valid) {
            this.detach(BreakCondition.SURFACE_DESTROYED);
            return;
        }
        
        // Entity stays attached to wall
        // Movement handled by input system
    }
    
    _updateFreeFall(dt, gravity) {
        // Apply gravity
        this.accumulatedForce[0] += gravity[0] * (this.entity.mass ?? 1);
        this.accumulatedForce[1] += gravity[1] * (this.entity.mass ?? 1);
        this.accumulatedForce[2] += gravity[2] * (this.entity.mass ?? 1);
        
        // Integrate
        const mass = this.entity.mass ?? 1;
        this.velocity[0] += this.accumulatedForce[0] / mass * dt;
        this.velocity[1] += this.accumulatedForce[1] / mass * dt;
        this.velocity[2] += this.accumulatedForce[2] / mass * dt;
        
        const ex = this.entity.x ?? 0;
        const ey = this.entity.y ?? 0;
        const ez = this.entity.z ?? 0;
        
        if (this.entity.setPosition) {
            this.entity.setPosition(
                ex + this.velocity[0] * dt,
                ey + this.velocity[1] * dt,
                ez + this.velocity[2] * dt
            );
        }
    }
    
    _checkBreakConditions() {
        if (this.type === AttachmentType.NONE) return;
        
        // Check force threshold
        const forceMag = Math.sqrt(
            this.accumulatedForce[0]**2 +
            this.accumulatedForce[1]**2 +
            this.accumulatedForce[2]**2
        );
        
        this.forceHistory.push(forceMag);
        if (this.forceHistory.length > 10) {
            this.forceHistory.shift();
        }
        
        const avgForce = statsMean(this.forceHistory);
        
        if (avgForce > this.params.breakForce) {
            this.detach(BreakCondition.FORCE_EXCEEDED);
        }
        
        // Check surface validity
        if (!this.attachmentPoint.valid) {
            this.detach(BreakCondition.SURFACE_DESTROYED);
        }
    }
    
    /**
     * Apply external force
     */
    applyForce(fx, fy, fz) {
        this.accumulatedForce[0] += fx;
        this.accumulatedForce[1] += fy;
        this.accumulatedForce[2] += fz;
    }
    
    /**
     * Check if currently attached
     */
    isAttached() {
        return this.type !== AttachmentType.NONE && this.attachmentPoint.valid;
    }
    
    /**
     * Get attachment type name
     */
    getTypeName() {
        return Object.keys(AttachmentType).find(k => AttachmentType[k] === this.type) || 'UNKNOWN';
    }
    
    /**
     * Retract grapple
     */
    retractGrapple(amount) {
        if (this.type !== AttachmentType.GRAPPLE) return;
        this.grappleTargetLength = Math.max(1, this.grappleTargetLength - amount);
    }
    
    /**
     * Extend grapple
     */
    extendGrapple(amount) {
        if (this.type !== AttachmentType.GRAPPLE) return;
        this.grappleTargetLength = Math.min(
            this.params.maxGrappleLength,
            this.grappleTargetLength + amount
        );
    }
}

// ============================================================================
// ATTACHMENT MANAGER
// ============================================================================

/**
 * Manages attachments for multiple entities
 */
export class AttachmentManager {
    constructor() {
        this.attachments = new Map(); // entityId → SurfaceAttachment
    }
    
    /**
     * Create attachment for entity
     * @param {Object} entity 
     * @returns {SurfaceAttachment}
     */
    createAttachment(entity) {
        const id = entity.id ?? entity;
        const attachment = new SurfaceAttachment(entity);
        this.attachments.set(id, attachment);
        return attachment;
    }
    
    /**
     * Get attachment for entity
     * @param {Object} entity 
     * @returns {SurfaceAttachment|null}
     */
    getAttachment(entity) {
        const id = entity.id ?? entity;
        return this.attachments.get(id) || null;
    }
    
    /**
     * Remove attachment
     * @param {Object} entity 
     */
    removeAttachment(entity) {
        const id = entity.id ?? entity;
        const attachment = this.attachments.get(id);
        if (attachment) {
            attachment.detach(BreakCondition.MANUAL_RELEASE);
        }
        this.attachments.delete(id);
    }
    
    /**
     * Update all attachments
     * @param {number} dt 
     * @param {Planet} planet - For gravity calculation
     */
    update(dt, planet) {
        for (const attachment of this.attachments.values()) {
            const entity = attachment.entity;
            const ex = entity.x ?? 0;
            const ey = entity.y ?? 0;
            const ez = entity.z ?? 0;
            
            const gravity = planet.getGravityVec3At(ex, ey, ez);
            attachment.update(dt, gravity);
        }
    }
    
    /**
     * Notify surface destruction at a voxel
     * @param {number} chunkId 
     * @param {number} voxelIndex 
     */
    notifySurfaceDestroyed(chunkId, voxelIndex) {
        for (const attachment of this.attachments.values()) {
            const ap = attachment.attachmentPoint;
            if (ap.valid && ap.chunkId === chunkId && ap.voxelIndex === voxelIndex) {
                ap.invalidate();
            }
        }
    }
}

export default SurfaceAttachment;
