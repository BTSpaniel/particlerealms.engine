import { random } from '../../core/math/MathRandom.js';
import { createEngineModel, createEngineNode } from '../../assets/EngineModel.js';
import { deriveHumanoidJointLimits, JOINT_TYPE } from '../../assets/rig/JointLimits.js';
import { radiusRatio } from '../../assets/rig/RagdollBuilder.js';

/**
 * PBDRagdoll.js - Position-Based Dynamics Ragdoll System
 * 
 * Physics-driven skeletal ragdoll using PBD constraints:
 * - Distance constraints: Maintain bone lengths
 * - Angle constraints: Joint limits (elbows, knees, spine)
 * - Capsule colliders: Per-bone collision shapes
 * - Animation blending: Smooth transition to/from ragdoll
 * 
 * Bone Structure (15-20 bones):
 * - Pelvis (root)
 * - Spine (2-3 bones)
 * - Head
 * - Arms (shoulder, upper arm, forearm, hand × 2)
 * - Legs (thigh, shin, foot × 2)
 * 
 * Performance Target: <2ms for 10 ragdolls
 */

import { PBDSolver, PBDParticle, DistanceConstraint, AngleConstraint } from './PBDSolver.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Bone identifiers */
export const RagdollBone = {
    PELVIS: 0,
    SPINE: 1,
    SPINE1: 2,
    CHEST: 3,
    NECK: 4,
    HEAD: 5,
    LEFT_SHOULDER: 6,
    LEFT_UPPER_ARM: 7,
    LEFT_FOREARM: 8,
    LEFT_HAND: 9,
    RIGHT_SHOULDER: 10,
    RIGHT_UPPER_ARM: 11,
    RIGHT_FOREARM: 12,
    RIGHT_HAND: 13,
    LEFT_THIGH: 14,
    LEFT_SHIN: 15,
    LEFT_FOOT: 16,
    RIGHT_THIGH: 17,
    RIGHT_SHIN: 18,
    RIGHT_FOOT: 19,
    COUNT: 20,
};

/** Joint types */
export const JointType = {
    BALL: 0,     // Full rotation (shoulder, hip)
    HINGE: 1,    // Single axis (elbow, knee)
    SADDLE: 2,   // Two axes (wrist, ankle)
    TWIST: 3,    // Rotation around bone axis (spine)
};

/** Ragdoll states */
export const RagdollState = {
    ANIMATED: 0,    // Following animation
    BLENDING: 1,    // Transitioning to/from ragdoll
    RAGDOLL: 2,     // Full physics
    RECOVERING: 3,  // Getting up animation
};

/** Default humanoid measurements (meters) */
export const DEFAULT_MEASUREMENTS = {
    height: 1.8,
    shoulderWidth: 0.4,
    hipWidth: 0.3,
    torsoLength: 0.5,
    neckLength: 0.1,
    headRadius: 0.1,
    upperArmLength: 0.3,
    forearmLength: 0.25,
    handLength: 0.1,
    thighLength: 0.45,
    shinLength: 0.4,
    footLength: 0.15,
};

/** Joint angle limits (radians) */
export const JOINT_LIMITS = {
    // Spine - limited twist and bend
    spine: { minPitch: -0.3, maxPitch: 0.5, minRoll: -0.2, maxRoll: 0.2 },
    
    // Neck - more mobile
    neck: { minPitch: -0.5, maxPitch: 0.7, minRoll: -0.5, maxRoll: 0.5 },
    
    // Shoulder - ball joint
    shoulder: { coneAngle: 2.0 },
    
    // Elbow - hinge, no hyperextension
    elbow: { min: 0, max: 2.5 },
    
    // Wrist - saddle
    wrist: { minPitch: -1.0, maxPitch: 1.0, minRoll: -0.5, maxRoll: 0.5 },
    
    // Hip - ball joint, limited
    hip: { coneAngle: 1.5 },
    
    // Knee - hinge, no hyperextension
    knee: { min: 0, max: 2.5 },
    
    // Ankle - saddle
    ankle: { minPitch: -0.5, maxPitch: 0.7, minRoll: -0.3, maxRoll: 0.3 },
};

// ============================================================================
// CANONICAL JOINT LIMITS (sourced from the shared RagdollBuilder/JointLimits
// pipeline — the same anatomical profile used by the editor's PhysX ragdoll,
// ActiveRigController, and every other humanoid consumer). PBDRagdoll keeps
// its own bone names/enum/indices (Life's ActiveBodySystem.js and the AGI
// adapter depend on those exact identifiers), but no longer hand-duplicates
// joint type/swing/twist numbers — those are derived once here from the
// canonical per-slot anatomical profile so every consumer stays in sync.
// `JOINT_LIMITS` above is kept exported for backward compatibility but is no
// longer read internally.
// ============================================================================

// RagdollBone name → canonical HUMANOID_BONES slot (JointLimits.js/RagdollBuilder.js).
const RAGDOLL_BONE_TO_SLOT = {
    pelvis: 'hips',
    spine: 'spine',
    spine1: 'chest',
    chest: 'upperChest',
    neck: 'neck',
    head: 'head',
    leftShoulder: 'leftShoulder',
    leftUpperArm: 'leftUpperArm',
    leftForearm: 'leftLowerArm',
    leftHand: 'leftHand',
    rightShoulder: 'rightShoulder',
    rightUpperArm: 'rightUpperArm',
    rightForearm: 'rightLowerArm',
    rightHand: 'rightHand',
    leftThigh: 'leftUpperLeg',
    leftShin: 'leftLowerLeg',
    leftFoot: 'leftFoot',
    rightThigh: 'rightUpperLeg',
    rightShin: 'rightLowerLeg',
    rightFoot: 'rightFoot',
};

// Canonical joint type string (JointLimits.js JOINT_TYPE) → PBDRagdoll's own
// numeric JointType enum.
const CANONICAL_TO_JOINT_TYPE = {
    [JOINT_TYPE.BALL]: JointType.BALL,
    [JOINT_TYPE.HINGE]: JointType.HINGE,
    [JOINT_TYPE.SADDLE]: JointType.SADDLE,
    [JOINT_TYPE.TWIST]: JointType.TWIST,
};

/**
 * Build a representative T-pose EngineModel (generic proportions, not tied to
 * any one PBDRagdoll instance's `measurements`) purely so
 * `deriveHumanoidJointLimits` can compute anatomically correct joint types,
 * swing/twist ranges, and bend axes. Computed once at module load — these
 * values don't meaningfully vary with per-instance measurement scaling.
 */
function buildCanonicalJointLimits() {
    const STANCE = [
        ['hips', null, [0, 1.00, 0]],
        ['spine', 'hips', [0, 0.18, 0]],
        ['chest', 'spine', [0, 0.16, 0]],
        ['upperChest', 'chest', [0, 0.16, 0]],
        ['neck', 'upperChest', [0, 0.10, 0]],
        ['head', 'neck', [0, 0.12, 0]],
        ['leftShoulder', 'upperChest', [-0.17, 0.06, 0]],
        ['leftUpperArm', 'leftShoulder', [-0.15, -0.15, 0]],
        ['leftLowerArm', 'leftUpperArm', [-0.02, -0.25, 0]],
        ['leftHand', 'leftLowerArm', [0, -0.20, 0]],
        ['rightShoulder', 'upperChest', [0.17, 0.06, 0]],
        ['rightUpperArm', 'rightShoulder', [0.15, -0.15, 0]],
        ['rightLowerArm', 'rightUpperArm', [0.02, -0.25, 0]],
        ['rightHand', 'rightLowerArm', [0, -0.20, 0]],
        ['leftUpperLeg', 'hips', [-0.10, -0.35, 0]],
        ['leftLowerLeg', 'leftUpperLeg', [0, -0.38, 0]],
        ['leftFoot', 'leftLowerLeg', [0, -0.20, 0.08]],
        ['rightUpperLeg', 'hips', [0.10, -0.35, 0]],
        ['rightLowerLeg', 'rightUpperLeg', [0, -0.38, 0]],
        ['rightFoot', 'rightLowerLeg', [0, -0.20, 0.08]],
    ];
    const model = createEngineModel({ name: 'pbd_ragdoll_canonical_stance', sourceFormat: 'synthetic' });
    const nodeIdBySlot = {};
    STANCE.forEach(([slot], i) => { nodeIdBySlot[slot] = `node:${i}`; });
    STANCE.forEach(([slot, parentSlot, translation], i) => {
        const parentId = parentSlot ? nodeIdBySlot[parentSlot] : null;
        model.nodes.push(createEngineNode({ id: `node:${i}`, name: slot, parent: parentId, translation, children: [] }));
    });
    STANCE.forEach(([slot, parentSlot], i) => {
        if (!parentSlot) return;
        const parentIndex = STANCE.findIndex(([s]) => s === parentSlot);
        model.nodes[parentIndex].children.push(`node:${i}`);
    });
    model.rigs.humanoid = { bones: nodeIdBySlot };
    return deriveHumanoidJointLimits(model);
}

/** slot → { jointType, swingDeg, twistDeg, swingRad, twistRad, axis, ... } */
const CANONICAL_JOINT_LIMITS = buildCanonicalJointLimits();

// ============================================================================
// CAPSULE COLLIDER
// ============================================================================

export class CapsuleCollider {
    constructor(radius = 0.05, length = 0.2) {
        this.radius = radius;
        this.length = length;
        
        // Local offset from bone origin
        this.offsetX = 0;
        this.offsetY = 0;
        this.offsetZ = 0;
        
        // World position (updated during simulation)
        this.worldStart = [0, 0, 0];
        this.worldEnd = [0, 0, 0];
    }
    
    /**
     * Update world position from bone transform
     * @param {number[]} bonePos - Bone world position
     * @param {number[]} boneDir - Bone direction (unit vector)
     */
    updateWorld(bonePos, boneDir) {
        this.worldStart[0] = bonePos[0] + this.offsetX;
        this.worldStart[1] = bonePos[1] + this.offsetY;
        this.worldStart[2] = bonePos[2] + this.offsetZ;
        
        this.worldEnd[0] = this.worldStart[0] + boneDir[0] * this.length;
        this.worldEnd[1] = this.worldStart[1] + boneDir[1] * this.length;
        this.worldEnd[2] = this.worldStart[2] + boneDir[2] * this.length;
    }
    
    /**
     * Check collision with point
     * @returns {{ colliding: boolean, penetration: number, normal: number[] }}
     */
    pointCollision(px, py, pz) {
        // Find closest point on capsule axis
        const ax = this.worldStart[0], ay = this.worldStart[1], az = this.worldStart[2];
        const bx = this.worldEnd[0], by = this.worldEnd[1], bz = this.worldEnd[2];
        
        const abx = bx - ax, aby = by - ay, abz = bz - az;
        const apx = px - ax, apy = py - ay, apz = pz - az;
        
        const abLen2 = abx*abx + aby*aby + abz*abz;
        const t = Math.max(0, Math.min(1, (apx*abx + apy*aby + apz*abz) / Math.max(abLen2, 0.0001)));
        
        const closestX = ax + t * abx;
        const closestY = ay + t * aby;
        const closestZ = az + t * abz;
        
        const dx = px - closestX;
        const dy = py - closestY;
        const dz = pz - closestZ;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        if (dist < this.radius) {
            const penetration = this.radius - dist;
            const normal = dist > 0.0001 
                ? [dx/dist, dy/dist, dz/dist]
                : [0, 1, 0];
            return { colliding: true, penetration, normal };
        }
        
        return { colliding: false, penetration: 0, normal: [0, 0, 0] };
    }
    
    /**
     * Check collision with another capsule
     */
    capsuleCollision(other) {
        // Closest points between two line segments
        const p1 = this.worldStart, q1 = this.worldEnd;
        const p2 = other.worldStart, q2 = other.worldEnd;
        
        const d1 = [q1[0]-p1[0], q1[1]-p1[1], q1[2]-p1[2]];
        const d2 = [q2[0]-p2[0], q2[1]-p2[1], q2[2]-p2[2]];
        const r = [p1[0]-p2[0], p1[1]-p2[1], p1[2]-p2[2]];
        
        const a = d1[0]*d1[0] + d1[1]*d1[1] + d1[2]*d1[2];
        const e = d2[0]*d2[0] + d2[1]*d2[1] + d2[2]*d2[2];
        const f = d2[0]*r[0] + d2[1]*r[1] + d2[2]*r[2];
        
        let s, t;
        
        if (a < 0.0001 && e < 0.0001) {
            s = t = 0;
        } else if (a < 0.0001) {
            s = 0;
            t = Math.max(0, Math.min(1, f / e));
        } else {
            const c = d1[0]*r[0] + d1[1]*r[1] + d1[2]*r[2];
            if (e < 0.0001) {
                t = 0;
                s = Math.max(0, Math.min(1, -c / a));
            } else {
                const b = d1[0]*d2[0] + d1[1]*d2[1] + d1[2]*d2[2];
                const denom = a*e - b*b;
                
                if (denom !== 0) {
                    s = Math.max(0, Math.min(1, (b*f - c*e) / denom));
                } else {
                    s = 0;
                }
                
                t = (b*s + f) / e;
                
                if (t < 0) {
                    t = 0;
                    s = Math.max(0, Math.min(1, -c / a));
                } else if (t > 1) {
                    t = 1;
                    s = Math.max(0, Math.min(1, (b - c) / a));
                }
            }
        }
        
        const c1 = [p1[0] + s*d1[0], p1[1] + s*d1[1], p1[2] + s*d1[2]];
        const c2 = [p2[0] + t*d2[0], p2[1] + t*d2[1], p2[2] + t*d2[2]];
        
        const dx = c2[0] - c1[0];
        const dy = c2[1] - c1[1];
        const dz = c2[2] - c1[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        const combinedRadius = this.radius + other.radius;
        
        if (dist < combinedRadius) {
            const penetration = combinedRadius - dist;
            const normal = dist > 0.0001
                ? [dx/dist, dy/dist, dz/dist]
                : [0, 1, 0];
            return { colliding: true, penetration, normal, point1: c1, point2: c2 };
        }
        
        return { colliding: false, penetration: 0, normal: [0, 0, 0] };
    }
}

// ============================================================================
// RAGDOLL BONE
// ============================================================================

export class RagdollBoneData {
    constructor(id, name, parentId = -1) {
        this.id = id;
        this.name = name;
        this.parentId = parentId;
        
        // PBD particle
        this.particle = null;
        
        // Collider
        this.collider = new CapsuleCollider();
        
        // Joint to parent
        this.jointType = JointType.BALL;
        this.jointLimits = null;
        
        // Bone length (distance to parent)
        this.length = 0;
        
        // Mass distribution
        this.mass = 1;
    }
}

// ============================================================================
// PBD RAGDOLL
// ============================================================================

export class PBDRagdoll {
    /**
     * @param {Object} options 
     */
    constructor(options = {}) {
        this.measurements = { ...DEFAULT_MEASUREMENTS, ...options.measurements };
        
        // State
        this.state = RagdollState.ANIMATED;
        this.blendWeight = 0; // 0 = animation, 1 = ragdoll
        this.blendSpeed = options.blendSpeed ?? 5;
        
        // Bones
        this.bones = [];
        this.boneMap = new Map();
        
        // PBD solver
        this.solver = new PBDSolver({
            iterations: options.iterations ?? 8,
            substeps: options.substeps ?? 4,
            gravity: options.gravity ?? [0, -9.8, 0],
        });
        
        // Constraints
        this.distanceConstraints = [];
        this.angleConstraints = [];
        
        // Animation pose (for blending)
        this.animationPose = null;
        
        // Root position/rotation
        this.rootPosition = [0, 0, 0];
        this.rootRotation = [0, 0, 0, 1];
        
        // Initialize skeleton
        this._buildSkeleton();
    }
    
    /**
     * Build the skeleton structure
     */
    _buildSkeleton() {
        const m = this.measurements;
        
        // Create bones
        this._addBone(RagdollBone.PELVIS, 'pelvis', -1, 5);
        this._addBone(RagdollBone.SPINE, 'spine', RagdollBone.PELVIS, 3);
        this._addBone(RagdollBone.SPINE1, 'spine1', RagdollBone.SPINE, 3);
        this._addBone(RagdollBone.CHEST, 'chest', RagdollBone.SPINE1, 4);
        this._addBone(RagdollBone.NECK, 'neck', RagdollBone.CHEST, 1);
        this._addBone(RagdollBone.HEAD, 'head', RagdollBone.NECK, 4);
        
        // Left arm
        this._addBone(RagdollBone.LEFT_SHOULDER, 'leftShoulder', RagdollBone.CHEST, 1);
        this._addBone(RagdollBone.LEFT_UPPER_ARM, 'leftUpperArm', RagdollBone.LEFT_SHOULDER, 2);
        this._addBone(RagdollBone.LEFT_FOREARM, 'leftForearm', RagdollBone.LEFT_UPPER_ARM, 1.5);
        this._addBone(RagdollBone.LEFT_HAND, 'leftHand', RagdollBone.LEFT_FOREARM, 0.5);
        
        // Right arm
        this._addBone(RagdollBone.RIGHT_SHOULDER, 'rightShoulder', RagdollBone.CHEST, 1);
        this._addBone(RagdollBone.RIGHT_UPPER_ARM, 'rightUpperArm', RagdollBone.RIGHT_SHOULDER, 2);
        this._addBone(RagdollBone.RIGHT_FOREARM, 'rightForearm', RagdollBone.RIGHT_UPPER_ARM, 1.5);
        this._addBone(RagdollBone.RIGHT_HAND, 'rightHand', RagdollBone.RIGHT_FOREARM, 0.5);
        
        // Left leg
        this._addBone(RagdollBone.LEFT_THIGH, 'leftThigh', RagdollBone.PELVIS, 4);
        this._addBone(RagdollBone.LEFT_SHIN, 'leftShin', RagdollBone.LEFT_THIGH, 3);
        this._addBone(RagdollBone.LEFT_FOOT, 'leftFoot', RagdollBone.LEFT_SHIN, 1);
        
        // Right leg
        this._addBone(RagdollBone.RIGHT_THIGH, 'rightThigh', RagdollBone.PELVIS, 4);
        this._addBone(RagdollBone.RIGHT_SHIN, 'rightShin', RagdollBone.RIGHT_THIGH, 3);
        this._addBone(RagdollBone.RIGHT_FOOT, 'rightFoot', RagdollBone.RIGHT_SHIN, 1);
        
        // Set bone lengths and colliders
        this._configureBoneLengths();
        this._configureColliders();
        this._configureJoints();
        
        // Build constraints
        this._buildConstraints();
    }
    
    _addBone(id, name, parentId, mass) {
        const bone = new RagdollBoneData(id, name, parentId);
        bone.mass = mass;
        bone.particle = this.solver.addParticle(0, 0, 0, 1 / mass);
        this.bones[id] = bone;
        this.boneMap.set(name, bone);
        return bone;
    }
    
    _configureBoneLengths() {
        const m = this.measurements;
        
        // Spine
        this.bones[RagdollBone.SPINE].length = m.torsoLength * 0.33;
        this.bones[RagdollBone.SPINE1].length = m.torsoLength * 0.33;
        this.bones[RagdollBone.CHEST].length = m.torsoLength * 0.34;
        this.bones[RagdollBone.NECK].length = m.neckLength;
        this.bones[RagdollBone.HEAD].length = m.headRadius * 2;
        
        // Arms
        this.bones[RagdollBone.LEFT_SHOULDER].length = m.shoulderWidth * 0.3;
        this.bones[RagdollBone.LEFT_UPPER_ARM].length = m.upperArmLength;
        this.bones[RagdollBone.LEFT_FOREARM].length = m.forearmLength;
        this.bones[RagdollBone.LEFT_HAND].length = m.handLength;
        
        this.bones[RagdollBone.RIGHT_SHOULDER].length = m.shoulderWidth * 0.3;
        this.bones[RagdollBone.RIGHT_UPPER_ARM].length = m.upperArmLength;
        this.bones[RagdollBone.RIGHT_FOREARM].length = m.forearmLength;
        this.bones[RagdollBone.RIGHT_HAND].length = m.handLength;
        
        // Legs
        this.bones[RagdollBone.LEFT_THIGH].length = m.thighLength;
        this.bones[RagdollBone.LEFT_SHIN].length = m.shinLength;
        this.bones[RagdollBone.LEFT_FOOT].length = m.footLength;
        
        this.bones[RagdollBone.RIGHT_THIGH].length = m.thighLength;
        this.bones[RagdollBone.RIGHT_SHIN].length = m.shinLength;
        this.bones[RagdollBone.RIGHT_FOOT].length = m.footLength;
    }
    
    _configureColliders() {
        const m = this.measurements;

        // Torso/head capsules aren't bone-length-driven (pelvis/chest capsules
        // represent hip/shoulder WIDTH crossbars, not the vertical spine
        // segment length) — kept as literal measurement-derived shapes.
        this.bones[RagdollBone.PELVIS].collider = new CapsuleCollider(0.12, m.hipWidth);
        this.bones[RagdollBone.CHEST].collider = new CapsuleCollider(0.15, m.shoulderWidth);
        this.bones[RagdollBone.HEAD].collider = new CapsuleCollider(m.headRadius, m.headRadius);

        // Limb capsules: radius derived from the same canonical
        // RagdollBuilder.js radius-per-length ratio every other humanoid
        // consumer (editor PhysX ragdoll, ActiveRigController) uses, applied
        // to this bone's own PBD length (kept exactly as `measurements`
        // dictates — see _configureBoneLengths).
        const limbRadius = (boneId, slot) => radiusRatio(slot) * this.bones[boneId].length;
        this.bones[RagdollBone.LEFT_UPPER_ARM].collider = new CapsuleCollider(limbRadius(RagdollBone.LEFT_UPPER_ARM, 'leftUpperArm'), m.upperArmLength);
        this.bones[RagdollBone.LEFT_FOREARM].collider = new CapsuleCollider(limbRadius(RagdollBone.LEFT_FOREARM, 'leftLowerArm'), m.forearmLength);
        this.bones[RagdollBone.RIGHT_UPPER_ARM].collider = new CapsuleCollider(limbRadius(RagdollBone.RIGHT_UPPER_ARM, 'rightUpperArm'), m.upperArmLength);
        this.bones[RagdollBone.RIGHT_FOREARM].collider = new CapsuleCollider(limbRadius(RagdollBone.RIGHT_FOREARM, 'rightLowerArm'), m.forearmLength);

        this.bones[RagdollBone.LEFT_THIGH].collider = new CapsuleCollider(limbRadius(RagdollBone.LEFT_THIGH, 'leftUpperLeg'), m.thighLength);
        this.bones[RagdollBone.LEFT_SHIN].collider = new CapsuleCollider(limbRadius(RagdollBone.LEFT_SHIN, 'leftLowerLeg'), m.shinLength);
        this.bones[RagdollBone.RIGHT_THIGH].collider = new CapsuleCollider(limbRadius(RagdollBone.RIGHT_THIGH, 'rightUpperLeg'), m.thighLength);
        this.bones[RagdollBone.RIGHT_SHIN].collider = new CapsuleCollider(limbRadius(RagdollBone.RIGHT_SHIN, 'rightLowerLeg'), m.shinLength);
    }
    
    /**
     * Assign each bone's jointType + jointLimits from the canonical
     * RagdollBuilder/JointLimits anatomical profile (CANONICAL_JOINT_LIMITS,
     * keyed by canonical slot via RAGDOLL_BONE_TO_SLOT) instead of a
     * hand-duplicated local table — the single source of truth every other
     * humanoid ragdoll consumer already reads from.
     */
    _configureJoints() {
        for (const bone of this.bones) {
            if (!bone || bone.parentId < 0) continue;
            const slot = RAGDOLL_BONE_TO_SLOT[bone.name];
            const limit = slot && CANONICAL_JOINT_LIMITS.get(slot);
            if (!limit) continue;
            bone.jointType = CANONICAL_TO_JOINT_TYPE[limit.jointType] ?? JointType.BALL;
            bone.jointLimits = limit;
        }
    }
    
    _buildConstraints() {
        // Distance constraints between connected bones
        for (const bone of this.bones) {
            if (!bone || bone.parentId < 0) continue;
            
            const parent = this.bones[bone.parentId];
            if (!parent) continue;
            
            const constraint = this.solver.addDistanceConstraint(
                parent.particle,
                bone.particle,
                bone.length,
                1.0 // Stiffness
            );
            this.distanceConstraints.push(constraint);
        }
        
        // Angle constraints for joint limits. AngleConstraint measures the
        // angle at the pivot between (parent - pivot) and (child - pivot):
        // π = fully straight, 0 = fully folded. The canonical hinge profile's
        // twistRad is the anatomical bend RANGE from straight (e.g. an elbow
        // can fold up to ~145°), so the equivalent [min, max] here is
        // [π - twistRad, π] — cap how far the joint may fold, never restrict
        // straightening.
        const hingeAngleRange = (boneId) => {
            const twistRad = this.bones[boneId]?.jointLimits?.twistRad;
            return Number.isFinite(twistRad) ? [Math.PI - twistRad, Math.PI] : [0, 2.5];
        };

        // Elbows
        this._addAngleConstraint(
            RagdollBone.LEFT_SHOULDER, RagdollBone.LEFT_UPPER_ARM, RagdollBone.LEFT_FOREARM,
            ...hingeAngleRange(RagdollBone.LEFT_FOREARM)
        );
        this._addAngleConstraint(
            RagdollBone.RIGHT_SHOULDER, RagdollBone.RIGHT_UPPER_ARM, RagdollBone.RIGHT_FOREARM,
            ...hingeAngleRange(RagdollBone.RIGHT_FOREARM)
        );
        
        // Knees
        this._addAngleConstraint(
            RagdollBone.PELVIS, RagdollBone.LEFT_THIGH, RagdollBone.LEFT_SHIN,
            ...hingeAngleRange(RagdollBone.LEFT_SHIN)
        );
        this._addAngleConstraint(
            RagdollBone.PELVIS, RagdollBone.RIGHT_THIGH, RagdollBone.RIGHT_SHIN,
            ...hingeAngleRange(RagdollBone.RIGHT_SHIN)
        );
        
        // Build color groups for parallel solving
        this.solver.buildColorGroups();
    }
    
    _addAngleConstraint(boneA, boneB, boneC, minAngle, maxAngle) {
        const a = this.bones[boneA];
        const b = this.bones[boneB];
        const c = this.bones[boneC];
        
        if (!a || !b || !c) return;
        
        const constraint = this.solver.addAngleConstraint(
            a.particle, b.particle, c.particle,
            minAngle, maxAngle, 0.5
        );
        this.angleConstraints.push(constraint);
    }
    
    /**
     * Initialize from animation pose
     * @param {Object} skeleton - Animation skeleton with bone transforms
     */
    initFromSkeleton(skeleton) {
        for (const bone of this.bones) {
            if (!bone) continue;
            
            const worldPos = skeleton.getBoneWorldPosition?.(bone.name);
            if (worldPos) {
                bone.particle.setPosition(worldPos[0], worldPos[1], worldPos[2]);
            }
        }
        
        // Store root position
        const pelvis = this.bones[RagdollBone.PELVIS];
        if (pelvis) {
            this.rootPosition = [pelvis.particle.x, pelvis.particle.y, pelvis.particle.z];
        }
    }
    
    /**
     * Activate ragdoll physics
     * @param {number[]} initialVelocity - Optional initial velocity
     */
    activate(initialVelocity = null) {
        this.state = RagdollState.BLENDING;
        this.blendWeight = 0;
        
        if (initialVelocity) {
            for (const bone of this.bones) {
                if (!bone) continue;
                bone.particle.setVelocity(
                    initialVelocity[0],
                    initialVelocity[1],
                    initialVelocity[2]
                );
            }
        }
    }
    
    /**
     * Deactivate ragdoll, return to animation
     */
    deactivate() {
        this.state = RagdollState.RECOVERING;
    }
    
    /**
     * Apply impulse to a bone
     * @param {number} boneId 
     * @param {number[]} impulse 
     */
    applyImpulse(boneId, impulse) {
        const bone = this.bones[boneId];
        if (!bone) return;
        
        const p = bone.particle;
        p.vx += impulse[0] / bone.mass;
        p.vy += impulse[1] / bone.mass;
        p.vz += impulse[2] / bone.mass;
    }
    
    /**
     * Apply explosion force
     * @param {number[]} origin 
     * @param {number} force 
     * @param {number} radius 
     */
    applyExplosion(origin, force, radius) {
        for (const bone of this.bones) {
            if (!bone) continue;
            
            const dx = bone.particle.x - origin[0];
            const dy = bone.particle.y - origin[1];
            const dz = bone.particle.z - origin[2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            if (dist < radius && dist > 0.01) {
                const falloff = 1 - dist / radius;
                const magnitude = force * falloff * falloff;
                
                const impulse = [
                    (dx / dist) * magnitude,
                    (dy / dist) * magnitude + magnitude * 0.5, // Add upward
                    (dz / dist) * magnitude
                ];
                
                this.applyImpulse(bone.id, impulse);
            }
        }
        
        // Auto-activate if not already ragdolling
        if (this.state === RagdollState.ANIMATED) {
            this.activate();
        }
    }
    
    /**
     * Update ragdoll physics
     * @param {number} dt 
     * @param {Object} skeleton - Animation skeleton for blending
     */
    update(dt, skeleton = null) {
        // Update blend weight
        switch (this.state) {
            case RagdollState.BLENDING:
                this.blendWeight = Math.min(1, this.blendWeight + dt * this.blendSpeed);
                if (this.blendWeight >= 1) {
                    this.state = RagdollState.RAGDOLL;
                }
                break;
                
            case RagdollState.RECOVERING:
                this.blendWeight = Math.max(0, this.blendWeight - dt * this.blendSpeed);
                if (this.blendWeight <= 0) {
                    this.state = RagdollState.ANIMATED;
                }
                break;
        }
        
        // Physics simulation
        if (this.blendWeight > 0) {
            this.solver.step(dt);
            this._solveCollisions();
        }
        
        // Blend with animation
        if (this.blendWeight < 1 && skeleton) {
            this._blendWithAnimation(skeleton);
        }
        
        // Update colliders
        this._updateColliders();
    }
    
    /**
     * @param {object} [options]
     * @param {Set<string>} [options.ignorePairs] - bone-pair keys "a|b" to skip
     * @param {boolean} [options.activeMode] - if true, also apply group-level exclusions
     * @param {Set<string>} [options.ignoreGroupsActive] - group-pair keys to skip in active mode
     * @param {Map<string,string>} [options.groupByBone] - bone id → collision group
     */
    _solveCollisions(options = {}) {
        const ignorePairs = options.ignorePairs;
        const ignoreGroupsActive = options.activeMode ? options.ignoreGroupsActive : null;
        const groupByBone = options.groupByBone;
        const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

        // Self-collision between non-adjacent bones
        for (let i = 0; i < this.bones.length; i++) {
            const boneA = this.bones[i];
            if (!boneA || !boneA.collider) continue;
            
            for (let j = i + 2; j < this.bones.length; j++) {
                const boneB = this.bones[j];
                if (!boneB || !boneB.collider) continue;
                
                // Skip adjacent bones
                if (boneA.parentId === j || boneB.parentId === i) continue;

                // Skip explicit ignore pairs (from body template)
                if (ignorePairs && ignorePairs.has(pairKey(boneA.name, boneB.name))) continue;

                // Skip group-level exclusions in active mode
                if (ignoreGroupsActive && groupByBone) {
                    const ga = groupByBone.get(boneA.name);
                    const gb = groupByBone.get(boneB.name);
                    if (ga && gb && ignoreGroupsActive.has(pairKey(ga, gb))) continue;
                }

                const result = boneA.collider.capsuleCollision(boneB.collider);
                if (result.colliding) {
                    // Push apart
                    const correction = result.penetration * 0.5;
                    const pa = boneA.particle;
                    const pb = boneB.particle;
                    
                    if (!pa.isFixed()) {
                        pa.x -= result.normal[0] * correction;
                        pa.y -= result.normal[1] * correction;
                        pa.z -= result.normal[2] * correction;
                    }
                    
                    if (!pb.isFixed()) {
                        pb.x += result.normal[0] * correction;
                        pb.y += result.normal[1] * correction;
                        pb.z += result.normal[2] * correction;
                    }
                }
            }
        }
    }
    
    _blendWithAnimation(skeleton) {
        const t = this.blendWeight;
        
        for (const bone of this.bones) {
            if (!bone) continue;
            
            const animPos = skeleton.getBoneWorldPosition?.(bone.name);
            if (!animPos) continue;
            
            const p = bone.particle;
            p.x = p.x * t + animPos[0] * (1 - t);
            p.y = p.y * t + animPos[1] * (1 - t);
            p.z = p.z * t + animPos[2] * (1 - t);
        }
    }
    
    _updateColliders() {
        for (const bone of this.bones) {
            if (!bone || !bone.collider) continue;
            
            const p = bone.particle;
            const parent = bone.parentId >= 0 ? this.bones[bone.parentId] : null;
            
            let dir = [0, 1, 0];
            if (parent) {
                const pp = parent.particle;
                dir = [
                    p.x - pp.x,
                    p.y - pp.y,
                    p.z - pp.z
                ];
                const len = Math.sqrt(dir[0]*dir[0] + dir[1]*dir[1] + dir[2]*dir[2]);
                if (len > 0.01) {
                    dir = [dir[0]/len, dir[1]/len, dir[2]/len];
                }
            }
            
            bone.collider.updateWorld([p.x, p.y, p.z], dir);
        }
    }
    
    /**
     * Get bone world position
     * @param {number} boneId 
     * @returns {number[]}
     */
    getBonePosition(boneId) {
        const bone = this.bones[boneId];
        if (!bone) return [0, 0, 0];
        return [bone.particle.x, bone.particle.y, bone.particle.z];
    }
    
    /**
     * Get all bone transforms for rendering
     * @returns {Float32Array} - 7 floats per bone (pos xyz + quat xyzw)
     */
    getBoneTransforms() {
        const data = new Float32Array(this.bones.length * 7);
        
        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];
            if (!bone) continue;
            
            const offset = i * 7;
            const p = bone.particle;
            
            // Position
            data[offset + 0] = p.x;
            data[offset + 1] = p.y;
            data[offset + 2] = p.z;
            
            // Compute rotation (look at child or parent)
            // Simplified: identity quaternion for now
            data[offset + 3] = 0;
            data[offset + 4] = 0;
            data[offset + 5] = 0;
            data[offset + 6] = 1;
        }
        
        return data;
    }
    
    /**
     * Check if currently ragdolling
     */
    isRagdolling() {
        return this.state === RagdollState.RAGDOLL || 
               this.state === RagdollState.BLENDING;
    }
    
    /**
     * Set gravity direction
     */
    setGravity(gx, gy, gz) {
        this.solver.gravity = [gx, gy, gz];
    }
    
    // ========================================================================
    // EARTHQUAKE RESPONSE
    // ========================================================================
    
    /**
     * Initialize earthquake response system
     */
    initEarthquakeResponse() {
        this.earthquakeState = {
            active: false,
            intensity: 0,
            frequency: 0,
            
            // Balance degradation
            balanceStrength: 1.0,
            balanceRecoveryRate: 0.5,
            
            // Sway accumulation
            swayAccumulator: [0, 0, 0],
            swayVelocity: [0, 0, 0],
            
            // Stumble tracking
            stumbleTimer: 0,
            stumbleCooldown: 0,
            
            // Ragdoll threshold
            ragdollThreshold: 0.8,
            currentStress: 0,
        };
    }
    
    /**
     * Apply earthquake shaking to ragdoll
     * @param {number[]} shakeVector - [x, y, z] shake displacement
     * @param {number} amplitude - Shake intensity (0-1+)
     * @param {number} frequency - Shake frequency in Hz
     * @param {number} dt - Delta time
     */
    applyEarthquake(shakeVector, amplitude, frequency, dt) {
        if (!this.earthquakeState) {
            this.initEarthquakeResponse();
        }
        
        const eq = this.earthquakeState;
        eq.active = amplitude > 0.01;
        eq.intensity = amplitude;
        eq.frequency = frequency;
        
        if (!eq.active) {
            // Recovery when no earthquake
            eq.balanceStrength = Math.min(1.0, eq.balanceStrength + eq.balanceRecoveryRate * dt);
            eq.currentStress = Math.max(0, eq.currentStress - dt * 0.5);
            return;
        }
        
        // Degrade balance based on intensity
        eq.balanceStrength = Math.max(0.1, eq.balanceStrength - amplitude * dt * 2);
        
        // Accumulate stress
        eq.currentStress += amplitude * dt;
        
        // Apply shake to all bones
        this._applyShakeForces(shakeVector, amplitude, dt);
        
        // Check for stumble
        this._checkStumble(amplitude, dt);
        
        // Check for ragdoll transition
        this._checkEarthquakeRagdoll();
    }
    
    _applyShakeForces(shakeVector, amplitude, dt) {
        const eq = this.earthquakeState;
        
        // Update sway with spring-damper
        const springK = 50;
        const damping = 5;
        
        for (let i = 0; i < 3; i++) {
            // Spring force toward shake target
            const targetSway = shakeVector[i] * amplitude * 0.5;
            const springForce = (targetSway - eq.swayAccumulator[i]) * springK;
            const dampingForce = -eq.swayVelocity[i] * damping;
            
            eq.swayVelocity[i] += (springForce + dampingForce) * dt;
            eq.swayAccumulator[i] += eq.swayVelocity[i] * dt;
        }
        
        // Apply to bones with varying intensity
        const boneWeights = {
            [RagdollBone.PELVIS]: 0.3,
            [RagdollBone.SPINE]: 0.5,
            [RagdollBone.SPINE1]: 0.6,
            [RagdollBone.CHEST]: 0.7,
            [RagdollBone.NECK]: 0.8,
            [RagdollBone.HEAD]: 1.0,
            [RagdollBone.LEFT_UPPER_ARM]: 0.6,
            [RagdollBone.RIGHT_UPPER_ARM]: 0.6,
            [RagdollBone.LEFT_FOREARM]: 0.8,
            [RagdollBone.RIGHT_FOREARM]: 0.8,
        };
        
        for (const bone of this.bones) {
            if (!bone) continue;
            
            const weight = boneWeights[bone.id] ?? 0.3;
            const p = bone.particle;
            
            if (!p.isFixed()) {
                // Add sway displacement
                p.x += eq.swayAccumulator[0] * weight * dt * 10;
                p.y += eq.swayAccumulator[1] * weight * dt * 10;
                p.z += eq.swayAccumulator[2] * weight * dt * 10;
                
                // Add random jitter based on frequency
                if (amplitude > 0.3) {
                    const jitter = amplitude * 0.1 * (1 - eq.balanceStrength);
                    p.x += (random() - 0.5) * jitter;
                    p.y += (random() - 0.5) * jitter * 0.5;
                    p.z += (random() - 0.5) * jitter;
                }
            }
        }
    }
    
    _checkStumble(amplitude, dt) {
        const eq = this.earthquakeState;
        
        eq.stumbleCooldown = Math.max(0, eq.stumbleCooldown - dt);
        
        if (eq.stumbleCooldown > 0) return;
        
        // Chance of stumble based on intensity and balance
        const stumbleChance = amplitude * (1 - eq.balanceStrength) * dt;
        
        if (random() < stumbleChance) {
            this._triggerStumble();
            eq.stumbleCooldown = 1.0; // 1 second cooldown
        }
    }
    
    _triggerStumble() {
        // Apply random impulse to feet/legs
        const stumbleForce = 5 + random() * 10;
        const stumbleDir = [
            (random() - 0.5) * 2,
            0.2,
            (random() - 0.5) * 2,
        ];
        
        // Normalize
        const len = Math.sqrt(stumbleDir[0]**2 + stumbleDir[1]**2 + stumbleDir[2]**2);
        stumbleDir[0] /= len;
        stumbleDir[1] /= len;
        stumbleDir[2] /= len;
        
        // Apply to legs
        const legBones = [
            RagdollBone.LEFT_FOOT,
            RagdollBone.RIGHT_FOOT,
            RagdollBone.LEFT_SHIN,
            RagdollBone.RIGHT_SHIN,
        ];
        
        for (const boneId of legBones) {
            const bone = this.bones[boneId];
            if (bone) {
                this.applyImpulse(boneId, [
                    stumbleDir[0] * stumbleForce,
                    stumbleDir[1] * stumbleForce,
                    stumbleDir[2] * stumbleForce,
                ]);
            }
        }
    }
    
    _checkEarthquakeRagdoll() {
        const eq = this.earthquakeState;
        
        // Transition to ragdoll if stress exceeds threshold
        if (eq.currentStress > eq.ragdollThreshold && 
            this.state === RagdollState.ANIMATED) {
            this.activate();
        }
    }
    
    /**
     * Get earthquake response state
     */
    getEarthquakeState() {
        if (!this.earthquakeState) {
            this.initEarthquakeResponse();
        }
        return { ...this.earthquakeState };
    }
    
    /**
     * Set earthquake sensitivity
     * @param {number} threshold - Stress threshold for ragdoll (0-1)
     * @param {number} recoveryRate - Balance recovery speed
     */
    setEarthquakeSensitivity(threshold, recoveryRate = 0.5) {
        if (!this.earthquakeState) {
            this.initEarthquakeResponse();
        }
        this.earthquakeState.ragdollThreshold = threshold;
        this.earthquakeState.balanceRecoveryRate = recoveryRate;
    }
    
    /**
     * Integrate with SeismicSystem
     * @param {SeismicSystem} seismicSystem 
     * @param {number[]} position - Character position
     * @param {number} dt 
     */
    updateFromSeismicSystem(seismicSystem, position, dt) {
        const { shake, amplitude, frequency } = seismicSystem.getShakingAt(position);
        this.applyEarthquake(shake, amplitude, frequency, dt);
    }
}

export default PBDRagdoll;
