/**
 * SpeculativeContacts.js - Speculative Continuous Collision Detection
 * 
 * Based on "Speculative Contacts" (Bullet Physics) and PhysX eSPECULATIVE_CCD.
 * 
 * Traditional CCD is expensive as it requires time-of-impact (TOI) calculations.
 * Speculative contacts provide a cheaper alternative:
 * 
 * 1. Expand AABBs by velocity * dt to predict where objects will be
 * 2. Generate contacts for all potentially overlapping pairs
 * 3. Add velocity constraints to prevent future penetration
 * 
 * Benefits:
 * - Cheaper than sweep-based CCD
 * - Prevents tunneling for most cases
 * - Works well with iterative solvers
 * 
 * Limitations:
 * - Can cause "ghost collisions" with thin objects
 * - Not as accurate as full CCD for very fast objects
 */

/**
 * Expand AABB by velocity to get speculative bounds
 * @param {Object} aabb - Original AABB {minX, minY, minZ, maxX, maxY, maxZ}
 * @param {Array} velocity - Linear velocity [vx, vy, vz]
 * @param {number} dt - Time step
 * @param {number} margin - Extra margin for numerical safety
 * @returns {Object} Expanded AABB
 */
export function expandAABBByVelocity(aabb, velocity, dt, margin = 0.01) {
    const dx = velocity[0] * dt;
    const dy = velocity[1] * dt;
    const dz = velocity[2] * dt;
    
    return {
        minX: aabb.minX + Math.min(dx, 0) - margin,
        minY: aabb.minY + Math.min(dy, 0) - margin,
        minZ: aabb.minZ + Math.min(dz, 0) - margin,
        maxX: aabb.maxX + Math.max(dx, 0) + margin,
        maxY: aabb.maxY + Math.max(dy, 0) + margin,
        maxZ: aabb.maxZ + Math.max(dz, 0) + margin,
    };
}

/**
 * Calculate time of closest approach between two moving spheres
 * Used for speculative contact timing
 * 
 * @param {Array} posA - Position of sphere A
 * @param {Array} velA - Velocity of sphere A
 * @param {number} radiusA - Radius of sphere A
 * @param {Array} posB - Position of sphere B
 * @param {Array} velB - Velocity of sphere B
 * @param {number} radiusB - Radius of sphere B
 * @returns {number} Time of closest approach (0 to Infinity)
 */
export function timeOfClosestApproach(posA, velA, radiusA, posB, velB, radiusB) {
    // Relative position and velocity
    const relPosX = posB[0] - posA[0];
    const relPosY = posB[1] - posA[1];
    const relPosZ = posB[2] - posA[2];
    
    const relVelX = velB[0] - velA[0];
    const relVelY = velB[1] - velA[1];
    const relVelZ = velB[2] - velA[2];
    
    // Quadratic coefficients for distance squared
    const a = relVelX * relVelX + relVelY * relVelY + relVelZ * relVelZ;
    const b = 2 * (relPosX * relVelX + relPosY * relVelY + relPosZ * relVelZ);
    const c = relPosX * relPosX + relPosY * relPosY + relPosZ * relPosZ;
    
    const combinedRadius = radiusA + radiusB;
    
    // Already overlapping
    if (c < combinedRadius * combinedRadius) {
        return 0;
    }
    
    // Not moving relative to each other
    if (a < 1e-10) {
        return Infinity;
    }
    
    // Time of closest approach
    const tca = -b / (2 * a);
    
    // If closest approach is in the past, use 0
    if (tca < 0) {
        return Infinity;
    }
    
    // Check if they actually get close enough
    const distSqAtTCA = a * tca * tca + b * tca + c;
    if (distSqAtTCA > combinedRadius * combinedRadius) {
        return Infinity;
    }
    
    // Solve for actual collision time using quadratic formula
    // dist^2 = combinedRadius^2
    // a*t^2 + b*t + c - r^2 = 0
    const discriminant = b * b - 4 * a * (c - combinedRadius * combinedRadius);
    if (discriminant < 0) {
        return Infinity;
    }
    
    const sqrtD = Math.sqrt(discriminant);
    const t1 = (-b - sqrtD) / (2 * a);
    const t2 = (-b + sqrtD) / (2 * a);
    
    // Return earliest positive time
    if (t1 >= 0) return t1;
    if (t2 >= 0) return t2;
    return Infinity;
}

/**
 * Speculative contact constraint
 */
class SpeculativeContact {
    constructor(bodyA, bodyB, options = {}) {
        this.bodyA = bodyA;
        this.bodyB = bodyB;
        
        this.normal = options.normal || [0, 1, 0];
        this.distance = options.distance || 0;      // Current distance (positive = separated)
        this.timeToContact = options.timeToContact || 0;
        this.contactPoint = options.contactPoint || [0, 0, 0];
        
        this.friction = options.friction || 0.5;
        this.restitution = options.restitution || 0.25;
        
        // Accumulated impulse for warm starting
        this.normalImpulse = 0;
        this.frictionImpulse1 = 0;
        this.frictionImpulse2 = 0;
        
        // Tangent vectors for friction
        this._computeTangents();
    }
    
    _computeTangents() {
        const n = this.normal;
        
        // Choose a vector not parallel to normal
        const up = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        
        // Tangent 1 = normal × up
        this.tangent1 = [
            n[1] * up[2] - n[2] * up[1],
            n[2] * up[0] - n[0] * up[2],
            n[0] * up[1] - n[1] * up[0],
        ];
        const len1 = Math.sqrt(this.tangent1[0] ** 2 + this.tangent1[1] ** 2 + this.tangent1[2] ** 2);
        if (len1 > 0) {
            this.tangent1[0] /= len1;
            this.tangent1[1] /= len1;
            this.tangent1[2] /= len1;
        }
        
        // Tangent 2 = normal × tangent1
        this.tangent2 = [
            n[1] * this.tangent1[2] - n[2] * this.tangent1[1],
            n[2] * this.tangent1[0] - n[0] * this.tangent1[2],
            n[0] * this.tangent1[1] - n[1] * this.tangent1[0],
        ];
    }
}

/**
 * Speculative contacts solver
 */
export class SpeculativeContactsSolver {
    constructor(options = {}) {
        this.contacts = [];
        this.iterations = options.iterations || 8;
        this.slop = options.slop || 0.005;
        this.baumgarte = options.baumgarte || 0.2;
        this.speculativeMargin = options.speculativeMargin || 0.1;
    }
    
    /**
     * Clear all contacts
     */
    clear() {
        this.contacts = [];
    }
    
    /**
     * Generate speculative contacts for potentially colliding pairs
     * @param {Array} bodyA - First body
     * @param {Array} bodyB - Second body
     * @param {number} dt - Time step
     * @returns {SpeculativeContact|null} Speculative contact or null if not needed
     */
    generateContact(bodyA, bodyB, dt) {
        // Skip if both static
        if (bodyA.isStatic && bodyB.isStatic) return null;
        
        const posA = bodyA.position || [0, 0, 0];
        const posB = bodyB.position || [0, 0, 0];
        const velA = bodyA.linearVelocity || [0, 0, 0];
        const velB = bodyB.linearVelocity || [0, 0, 0];
        
        // Get radii (simplified - assume spheres or use half-extents)
        const radiusA = bodyA.radius || (bodyA.halfExtents ? Math.max(...bodyA.halfExtents) : 0.5);
        const radiusB = bodyB.radius || (bodyB.halfExtents ? Math.max(...bodyB.halfExtents) : 0.5);
        
        // Current distance
        const dx = posB[0] - posA[0];
        const dy = posB[1] - posA[1];
        const dz = posB[2] - posA[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const separation = dist - radiusA - radiusB;
        
        // Time to contact
        const toi = timeOfClosestApproach(posA, velA, radiusA, posB, velB, radiusB);
        
        // Generate speculative contact if:
        // 1. Already touching, or
        // 2. Will touch within dt + margin
        const shouldGenerate = separation < 0 || (toi < dt + this.speculativeMargin);
        
        if (!shouldGenerate) return null;
        
        // Normal from A to B
        const invDist = dist > 1e-6 ? 1 / dist : 0;
        const normal = [dx * invDist, dy * invDist, dz * invDist];
        
        // Contact point (on surface of A towards B)
        const contactPoint = [
            posA[0] + normal[0] * radiusA,
            posA[1] + normal[1] * radiusA,
            posA[2] + normal[2] * radiusA,
        ];
        
        const contact = new SpeculativeContact(bodyA, bodyB, {
            normal,
            distance: separation,
            timeToContact: Math.max(0, toi),
            contactPoint,
            friction: Math.sqrt((bodyA.friction || 0.5) * (bodyB.friction || 0.5)),
            restitution: Math.max(bodyA.restitution || 0.25, bodyB.restitution || 0.25),
        });
        
        this.contacts.push(contact);
        return contact;
    }
    
    /**
     * Solve all speculative contacts
     * @param {number} dt - Time step
     */
    solve(dt) {
        if (this.contacts.length === 0) return;
        
        const invDt = dt > 0 ? 1 / dt : 0;
        
        for (let iter = 0; iter < this.iterations; iter++) {
            for (const contact of this.contacts) {
                this._solveContact(contact, dt, invDt);
            }
        }
    }
    
    /**
     * Solve a single speculative contact
     */
    _solveContact(contact, dt, invDt) {
        const bodyA = contact.bodyA;
        const bodyB = contact.bodyB;
        
        const invMassA = bodyA.isStatic ? 0 : 1 / (bodyA.mass || 1);
        const invMassB = bodyB.isStatic ? 0 : 1 / (bodyB.mass || 1);
        const effectiveMass = invMassA + invMassB;
        
        if (effectiveMass === 0) return;
        
        const velA = bodyA.linearVelocity || [0, 0, 0];
        const velB = bodyB.linearVelocity || [0, 0, 0];
        
        // Relative velocity along normal
        const relVelX = velB[0] - velA[0];
        const relVelY = velB[1] - velA[1];
        const relVelZ = velB[2] - velA[2];
        
        const normalVel = relVelX * contact.normal[0] + 
                          relVelY * contact.normal[1] + 
                          relVelZ * contact.normal[2];
        
        // For speculative contacts, we want to prevent penetration
        // Target velocity that would result in touching (not penetrating)
        let targetVel = 0;
        
        if (contact.distance < 0) {
            // Already penetrating - push apart with Baumgarte
            const bias = this.baumgarte * invDt * Math.max(0, -contact.distance - this.slop);
            targetVel = bias;
        } else if (contact.distance < this.speculativeMargin) {
            // Speculative - limit closing velocity to prevent penetration
            const maxClosingVel = contact.distance * invDt;
            if (normalVel < -maxClosingVel) {
                targetVel = -maxClosingVel;
            } else {
                return; // Already okay, no constraint needed
            }
        } else {
            return; // Too far, no constraint
        }
        
        // Impulse to achieve target velocity
        let j = (targetVel - normalVel) / effectiveMass;
        
        // Clamp accumulated impulse
        const oldImpulse = contact.normalImpulse;
        contact.normalImpulse = Math.max(oldImpulse + j, 0);
        j = contact.normalImpulse - oldImpulse;
        
        // Apply impulse
        if (!bodyA.isStatic && bodyA.linearVelocity) {
            bodyA.linearVelocity[0] -= contact.normal[0] * j * invMassA;
            bodyA.linearVelocity[1] -= contact.normal[1] * j * invMassA;
            bodyA.linearVelocity[2] -= contact.normal[2] * j * invMassA;
        }
        
        if (!bodyB.isStatic && bodyB.linearVelocity) {
            bodyB.linearVelocity[0] += contact.normal[0] * j * invMassB;
            bodyB.linearVelocity[1] += contact.normal[1] * j * invMassB;
            bodyB.linearVelocity[2] += contact.normal[2] * j * invMassB;
        }
        
        // Friction
        this._solveFriction(contact, invMassA, invMassB, effectiveMass);
    }
    
    /**
     * Solve friction for a contact
     */
    _solveFriction(contact, invMassA, invMassB, effectiveMass) {
        const bodyA = contact.bodyA;
        const bodyB = contact.bodyB;
        
        const velA = bodyA.linearVelocity || [0, 0, 0];
        const velB = bodyB.linearVelocity || [0, 0, 0];
        
        // Relative velocity
        const relVelX = velB[0] - velA[0];
        const relVelY = velB[1] - velA[1];
        const relVelZ = velB[2] - velA[2];
        
        // Friction limit
        const maxFriction = contact.friction * contact.normalImpulse;
        
        // Tangent 1
        const tangentVel1 = relVelX * contact.tangent1[0] + 
                            relVelY * contact.tangent1[1] + 
                            relVelZ * contact.tangent1[2];
        
        let jt1 = -tangentVel1 / effectiveMass;
        const oldFriction1 = contact.frictionImpulse1;
        contact.frictionImpulse1 = Math.max(-maxFriction, Math.min(maxFriction, oldFriction1 + jt1));
        jt1 = contact.frictionImpulse1 - oldFriction1;
        
        // Tangent 2
        const tangentVel2 = relVelX * contact.tangent2[0] + 
                            relVelY * contact.tangent2[1] + 
                            relVelZ * contact.tangent2[2];
        
        let jt2 = -tangentVel2 / effectiveMass;
        const oldFriction2 = contact.frictionImpulse2;
        contact.frictionImpulse2 = Math.max(-maxFriction, Math.min(maxFriction, oldFriction2 + jt2));
        jt2 = contact.frictionImpulse2 - oldFriction2;
        
        // Apply friction impulses
        const frictionX = contact.tangent1[0] * jt1 + contact.tangent2[0] * jt2;
        const frictionY = contact.tangent1[1] * jt1 + contact.tangent2[1] * jt2;
        const frictionZ = contact.tangent1[2] * jt1 + contact.tangent2[2] * jt2;
        
        if (!bodyA.isStatic && bodyA.linearVelocity) {
            bodyA.linearVelocity[0] -= frictionX * invMassA;
            bodyA.linearVelocity[1] -= frictionY * invMassA;
            bodyA.linearVelocity[2] -= frictionZ * invMassA;
        }
        
        if (!bodyB.isStatic && bodyB.linearVelocity) {
            bodyB.linearVelocity[0] += frictionX * invMassB;
            bodyB.linearVelocity[1] += frictionY * invMassB;
            bodyB.linearVelocity[2] += frictionZ * invMassB;
        }
    }
    
    /**
     * Get debug info
     */
    getDebugInfo() {
        return {
            contactCount: this.contacts.length,
            speculativeCount: this.contacts.filter(c => c.distance > 0).length,
            penetratingCount: this.contacts.filter(c => c.distance <= 0).length,
        };
    }
}

/**
 * Enable speculative CCD on a PhysX rigid body
 * This configures the PhysX-specific flags for speculative contacts
 * 
 * @param {Object} actor - PhysX rigid dynamic actor
 * @param {Object} PhysX - PhysX module
 */
export function enablePhysXSpeculativeCCD(actor, PhysX) {
    if (!actor || !PhysX) return false;
    
    try {
        // Check if actor is kinematic - CCD not supported on kinematic bodies
        const isKinematic = actor.getRigidBodyFlags && 
            (actor.getRigidBodyFlags() & (PhysX.PxRigidBodyFlagEnum?.eKINEMATIC || 0));
        
        if (isKinematic) {
            // Skip CCD for kinematic bodies to avoid PhysX warning
            return false;
        }
        
        // Get all shapes on the actor
        const numShapes = actor.getNbShapes ? actor.getNbShapes() : 0;
        
        for (let i = 0; i < numShapes; i++) {
            const shape = actor.getShapeAt ? actor.getShapeAt(i) : null;
            if (!shape) continue;
            
            // Enable speculative CCD flag on shape
            if (typeof shape.setFlag === 'function' && PhysX.PxShapeFlagEnum) {
                if (PhysX.PxShapeFlagEnum.eENABLE_SPECULATIVE_CCD !== undefined) {
                    shape.setFlag(PhysX.PxShapeFlagEnum.eENABLE_SPECULATIVE_CCD, true);
                }
            }
        }
        
        // Enable CCD on actor (only for dynamic bodies)
        if (typeof actor.setRigidBodyFlag === 'function' && PhysX.PxRigidBodyFlagEnum) {
            if (PhysX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD !== undefined) {
                actor.setRigidBodyFlag(PhysX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD, true);
            }
        }
        
        return true;
    } catch (e) {
        console.warn('[SpeculativeContacts] Failed to enable PhysX speculative CCD:', e);
        return false;
    }
}
