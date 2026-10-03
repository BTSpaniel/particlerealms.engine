/**
 * GPUCharacterController.js — Kinematic Character Controller
 * 
 * PhysX-style character controller (CCT) for player/NPC movement.
 * Kinematic body that sweeps through the scene, resolves collisions,
 * handles ground detection, slope limits, step climbing, and skin width.
 * 
 * Based on:
 * - PhysX PxController: kinematic move with depenetration, auto-step, slope limit
 * - Quake/Source: slide-move along wall normals, stair stepping
 * - Jolt CharacterVirtual: predictive contacts, inner body shape
 * 
 * Architecture:
 * - CPU-driven (character movement is inherently sequential per-character)
 * - Uses GPURaycast (CPU fallback) for ground probes and sweep tests
 * - Applies final position to a kinematic body in GPURigidBodyWorld
 * - Supports capsule and box shapes
 * 
 * The controller does NOT use GPU compute shaders directly because
 * character movement is latency-sensitive (needs immediate response to input)
 * and typically only a handful of characters exist. CPU is the right choice here.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const CCT_SHAPE_CAPSULE = 0;
export const CCT_SHAPE_BOX     = 1;

export const CCT_GROUNDED      = 0;
export const CCT_SLIDING       = 1;
export const CCT_FALLING       = 2;

const DEFAULT_SKIN_WIDTH     = 0.08;
const DEFAULT_STEP_HEIGHT    = 0.35;
const DEFAULT_SLOPE_LIMIT    = 0.78; // ~45 degrees in radians
const DEFAULT_CONTACT_OFFSET = 0.1;
const DEFAULT_MIN_MOVE_DIST  = 0.001;
const MAX_SLIDE_ITERATIONS   = 4;
const GROUND_PROBE_DIST      = 0.15;

// ============================================================================
// CHARACTER CONTROLLER CLASS
// ============================================================================

export class GPUCharacterController {
    /**
     * @param {Object} options
     * @param {number} options.bodyHandle - Handle in GPURigidBodyWorld (must be kinematic)
     * @param {number} [options.height=1.8] - Total character height
     * @param {number} [options.radius=0.3] - Capsule radius (or box half-width)
     * @param {number} [options.shape=CCT_SHAPE_CAPSULE]
     * @param {number} [options.skinWidth=0.08] - Collision skin padding
     * @param {number} [options.stepHeight=0.35] - Max step-up height
     * @param {number} [options.slopeLimit=0.78] - Max walkable slope (radians)
     * @param {number} [options.gravity=-9.81] - Y-axis gravity
     */
    constructor(options = {}) {
        this.bodyHandle = options.bodyHandle ?? -1;
        this.height = options.height ?? 1.8;
        this.radius = options.radius ?? 0.3;
        this.shape = options.shape ?? CCT_SHAPE_CAPSULE;
        this.skinWidth = options.skinWidth ?? DEFAULT_SKIN_WIDTH;
        this.stepHeight = options.stepHeight ?? DEFAULT_STEP_HEIGHT;
        this.slopeLimit = options.slopeLimit ?? DEFAULT_SLOPE_LIMIT;
        this.contactOffset = options.contactOffset ?? DEFAULT_CONTACT_OFFSET;
        this.minMoveDistance = options.minMoveDistance ?? DEFAULT_MIN_MOVE_DIST;
        this.gravity = options.gravity ?? -9.81;
        this.entityId = options.entityId ?? null;

        // State
        this.position = [0, 0, 0];
        this.velocity = [0, 0, 0];
        this.groundState = CCT_FALLING;
        this.groundNormal = [0, 1, 0];
        this.groundDistance = Infinity;
        this.groundBodyIndex = -1;
        this.isGrounded = false;
        this.onSlope = false;

        // Accumulated move displacement
        this._pendingMove = [0, 0, 0];
        this._verticalVelocity = 0;

        // Collision contacts from last move
        this.contacts = [];

        // Stats
        this.stats = {
            slideIterations: 0,
            stepUps: 0,
            groundProbes: 0,
        };
    }

    /**
     * Sync position from world body state.
     * Call once after creating the body to initialize.
     */
    syncFromWorld(world) {
        if (this.bodyHandle < 0) return;
        const body = world.getBody(this.bodyHandle);
        if (body) {
            this.position[0] = body.position[0];
            this.position[1] = body.position[1];
            this.position[2] = body.position[2];
        }
    }

    /**
     * Main update: move the character by displacement.
     * Handles gravity, ground detection, slope sliding, step climbing.
     * 
     * @param {GPURigidBodyWorld} world
     * @param {number[]} displacement - Desired movement [dx, dy, dz] (usually from input * speed * dt)
     * @param {number} dt - Time step in seconds
     * @param {Function} [raycastFn] - Raycast function: (origin, dir, maxDist) => {hit, distance, normal, position, bodyIndex}
     */
    move(world, displacement, dt, raycastFn) {
        if (this.bodyHandle < 0 || !raycastFn) return;

        this.stats.slideIterations = 0;
        this.stats.stepUps = 0;
        this.stats.groundProbes = 0;
        this.contacts = [];

        // Apply gravity
        if (!this.isGrounded) {
            this._verticalVelocity += this.gravity * dt;
        } else {
            this._verticalVelocity = Math.min(this._verticalVelocity, 0);
        }

        // Total desired displacement
        let dx = displacement[0];
        let dy = displacement[1] + this._verticalVelocity * dt;
        let dz = displacement[2];

        const moveLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (moveLen < this.minMoveDistance) {
            this._probeGround(raycastFn);
            this._applyToWorld(world);
            return;
        }

        // ── Slide-move (Quake-style) ──────────────────────────────────────

        let remaining = [dx, dy, dz];
        let pos = [...this.position];

        for (let iter = 0; iter < MAX_SLIDE_ITERATIONS; iter++) {
            const remLen = _len(remaining);
            if (remLen < this.minMoveDistance) break;

            const dir = [remaining[0] / remLen, remaining[1] / remLen, remaining[2] / remLen];

            // Sweep test (raycast from character center in move direction)
            const sweepOrigin = [
                pos[0],
                pos[1] + this.height * 0.5, // Cast from character center
                pos[2],
            ];
            const sweepDist = remLen + this.skinWidth;
            const hit = raycastFn(sweepOrigin, dir, sweepDist);
            this.stats.slideIterations++;

            if (!hit.hit || hit.distance > remLen) {
                // No obstruction — move full distance
                pos[0] += remaining[0];
                pos[1] += remaining[1];
                pos[2] += remaining[2];
                break;
            }

            // Move up to hit point minus skin width
            const safeDist = Math.max(hit.distance - this.skinWidth, 0);
            pos[0] += dir[0] * safeDist;
            pos[1] += dir[1] * safeDist;
            pos[2] += dir[2] * safeDist;

            // Record contact
            this.contacts.push({
                normal: [...hit.normal],
                position: [...hit.position],
                bodyIndex: hit.bodyIndex,
                distance: hit.distance,
            });

            // ── Step climbing ─────────────────────────────────────────────

            const hitNormalY = hit.normal[1];
            const isWall = Math.abs(hitNormalY) < 0.3;
            const leftover = remLen - safeDist;

            if (isWall && leftover > this.minMoveDistance) {
                // Try step-up: cast down from stepHeight above current position
                const stepOrigin = [pos[0], pos[1] + this.stepHeight + this.height * 0.5, pos[2]];
                const stepForwardDir = [dir[0], 0, dir[2]];
                const stepFwdLen = Math.sqrt(stepForwardDir[0] ** 2 + stepForwardDir[2] ** 2);
                if (stepFwdLen > 0.001) {
                    stepForwardDir[0] /= stepFwdLen;
                    stepForwardDir[2] /= stepFwdLen;

                    const stepHit = raycastFn(stepOrigin, stepForwardDir, leftover + this.skinWidth);
                    if (!stepHit.hit || stepHit.distance > leftover) {
                        // Space above — check if we can land
                        const landOrigin = [
                            stepOrigin[0] + stepForwardDir[0] * leftover,
                            stepOrigin[1],
                            stepOrigin[2] + stepForwardDir[2] * leftover,
                        ];
                        const landHit = raycastFn(landOrigin, [0, -1, 0], this.stepHeight + 0.1);
                        if (landHit.hit) {
                            // Successful step-up
                            pos[0] = landOrigin[0];
                            pos[1] = landHit.position[1];
                            pos[2] = landOrigin[2];
                            this.stats.stepUps++;
                            break;
                        }
                    }
                }
            }

            // ── Slide along wall ──────────────────────────────────────────

            // Remove component of remaining velocity along hit normal
            const dot = remaining[0] * hit.normal[0] + remaining[1] * hit.normal[1] + remaining[2] * hit.normal[2];
            remaining[0] -= hit.normal[0] * dot;
            remaining[1] -= hit.normal[1] * dot;
            remaining[2] -= hit.normal[2] * dot;

            // Scale remaining to preserve leftover distance
            const newLen = _len(remaining);
            if (newLen > 0.001) {
                const scale = leftover / newLen;
                remaining[0] *= scale;
                remaining[1] *= scale;
                remaining[2] *= scale;
            } else {
                break;
            }
        }

        this.position[0] = pos[0];
        this.position[1] = pos[1];
        this.position[2] = pos[2];

        // ── Ground detection ──────────────────────────────────────────────

        this._probeGround(raycastFn);

        // Snap to ground if close (prevent floating)
        if (this.isGrounded && this.groundDistance < GROUND_PROBE_DIST && this._verticalVelocity <= 0) {
            this.position[1] -= this.groundDistance;
            this._verticalVelocity = 0;
        }

        // Slope check
        if (this.isGrounded) {
            const slopeAngle = Math.acos(Math.min(this.groundNormal[1], 1));
            this.onSlope = slopeAngle > this.slopeLimit;

            if (this.onSlope) {
                // Slide down slope
                this.groundState = CCT_SLIDING;
                const slideX = this.groundNormal[0] * this.gravity * dt * 0.5;
                const slideZ = this.groundNormal[2] * this.gravity * dt * 0.5;
                this.position[0] += slideX;
                this.position[2] += slideZ;
            } else {
                this.groundState = CCT_GROUNDED;
            }
        } else {
            this.groundState = CCT_FALLING;
            this.onSlope = false;
        }

        // Apply position to kinematic body
        this._applyToWorld(world);
    }

    /**
     * Jump: set vertical velocity.
     * @param {number} jumpSpeed - Upward velocity (m/s)
     */
    jump(jumpSpeed = 5.0) {
        if (this.isGrounded) {
            this._verticalVelocity = jumpSpeed;
            this.isGrounded = false;
            this.groundState = CCT_FALLING;
        }
    }

    /**
     * Teleport character to position.
     */
    teleport(world, x, y, z) {
        this.position[0] = x;
        this.position[1] = y;
        this.position[2] = z;
        this._verticalVelocity = 0;
        this._applyToWorld(world);
    }

    // ========================================================================
    // INTERNAL
    // ========================================================================

    _probeGround(raycastFn) {
        const probeOrigin = [
            this.position[0],
            this.position[1] + 0.1, // Slight offset up to avoid self-hit
            this.position[2],
        ];
        const hit = raycastFn(probeOrigin, [0, -1, 0], this.height * 0.5 + GROUND_PROBE_DIST + 0.1);
        this.stats.groundProbes++;

        if (hit.hit) {
            this.groundDistance = hit.distance - 0.1; // Compensate for probe offset
            this.groundNormal[0] = hit.normal[0];
            this.groundNormal[1] = hit.normal[1];
            this.groundNormal[2] = hit.normal[2];
            this.groundBodyIndex = hit.bodyIndex;
            this.isGrounded = this.groundDistance < GROUND_PROBE_DIST + 0.05;
        } else {
            this.groundDistance = Infinity;
            this.groundNormal[0] = 0; this.groundNormal[1] = 1; this.groundNormal[2] = 0;
            this.groundBodyIndex = -1;
            this.isGrounded = false;
        }
    }

    _applyToWorld(world) {
        if (this.bodyHandle < 0) return;
        world.setBodyPosition(this.bodyHandle, this.position[0], this.position[1], this.position[2]);
    }
}

// ============================================================================
// HELPERS
// ============================================================================

function _len(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

// ============================================================================
// CHARACTER CONTROLLER MANAGER (multi-character)
// ============================================================================

export class GPUCharacterControllerManager {
    constructor() {
        this.controllers = new Map(); // handle → GPUCharacterController
    }

    /**
     * Create a character controller.
     * @param {GPURigidBodyWorld} world
     * @param {Object} options
     * @returns {GPUCharacterController}
     */
    createController(world, options = {}) {
        // Create kinematic body for the character
        const bodyHeight = options.height ?? 1.8;
        const bodyRadius = options.radius ?? 0.3;
        const bodyHandle = options.bodyHandle ?? world.createBody({
            simMode: 'kinematic',
            position: options.position || [0, 0, 0],
            rotation: [0, 0, 0, 1],
            mass: options.mass ?? 80,
            collider: {
                shape: options.shape === CCT_SHAPE_BOX ? 'box' : 'capsule',
                halfExtents: [bodyRadius, bodyHeight * 0.5, bodyRadius],
                radius: bodyRadius,
                halfHeight: (bodyHeight - bodyRadius * 2) * 0.5,
                material: { dynamicFriction: 0, staticFriction: 0, restitution: 0 },
            },
            collisionLayer: options.collisionLayer ?? 0x02, // Player layer
            collisionMask: options.collisionMask ?? 0xFF,
            entityId: options.entityId,
        });

        const controller = new GPUCharacterController({
            ...options,
            bodyHandle,
        });
        controller.syncFromWorld(world);

        this.controllers.set(bodyHandle, controller);
        return controller;
    }

    /**
     * Remove a character controller.
     */
    removeController(controller) {
        if (!controller) return;
        this.controllers.delete(controller.bodyHandle);
    }

    /**
     * Get controller by body handle.
     */
    getByBodyHandle(handle) {
        return this.controllers.get(handle) || null;
    }

    /**
     * Update all controllers.
     * @param {GPURigidBodyWorld} world
     * @param {Function} raycastFn
     * @param {number} dt
     */
    updateAll(world, raycastFn, dt) {
        for (const controller of this.controllers.values()) {
            // Controllers are updated individually via controller.move()
            // This method is for any shared post-processing
        }
    }

    destroy() {
        this.controllers.clear();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createCharacterControllerManager() {
    return new GPUCharacterControllerManager();
}

export function destroyCharacterControllerManager(mgr) {
    if (mgr) mgr.destroy();
}
