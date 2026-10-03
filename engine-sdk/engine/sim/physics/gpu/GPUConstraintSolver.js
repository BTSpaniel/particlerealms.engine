/**
 * GPUConstraintSolver.js — GPU Compute XPBD/TGS Constraint Solver
 * 
 * Solves contact constraints and joint constraints on GPU.
 * Uses TGS_Soft approach (Erin Catto, Box2D v3):
 * - Sub-step contact separation update via local-frame anchors
 * - Accumulated impulse clamping (Sequential Impulses)
 * - Warm starting from previous frame's Lagrange multipliers
 * - Relaxation pass to drain bias energy
 * - Coulomb friction with tangent clamping
 * - Restitution via velocity-level bounce
 * 
 * Joint constraints use D6 as sole native type (PhysX 5 GPU best practice).
 * Ball, hinge, fixed, distance, prismatic are D6 presets.
 * 
 * Parallel solving via graph-colored Gauss-Seidel (Fratarcangeli et al.):
 * - CPU-side graph coloring groups non-conflicting constraints
 * - One GPU dispatch per color group
 * 
 * Based on:
 * - XPBD (Macklin 2016): Δλ = -(C + α̃·λ) / (w_a + w_b + α̃)
 * - Small Steps (Macklin 2019): sub-stepping > iteration
 * - Box2D v3 Solver2D: TGS_Soft, relaxation, accumulated impulse clamping
 * - PhysX 5 GPU: D6 joints native, soft constraint compliance
 */

import { MAX_CONTACTS, MAX_JOINTS } from './GPURigidBodyWorld.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const JOINT_BALL      = 0;
export const JOINT_HINGE     = 1;
export const JOINT_FIXED     = 2;
export const JOINT_DISTANCE  = 3;
export const JOINT_D6        = 4;
export const JOINT_PRISMATIC = 5;

export const D6_LOCKED = 0;
export const D6_LIMITED = 1;
export const D6_FREE = 2;

const JOINT_STRIDE = 128; // bytes per joint (see struct)

// ============================================================================
// WGSL SHADERS
// ============================================================================

const SOLVE_CONTACTS_SHADER = /* wgsl */`
// TGS_Soft contact constraint solver
// Per-substep: update contact separation from local anchors, solve with bias + friction
// Accumulated impulse clamping (Sequential Impulses pattern)

struct Contact {
    bodyA: u32,
    bodyB: u32,
    normalX: f32, normalY: f32, normalZ: f32,
    penetration: f32,
    pointX: f32, pointY: f32, pointZ: f32,
    lambda: f32,
    localAnchorAx: f32, localAnchorAy: f32, localAnchorAz: f32,
    localAnchorBx: f32, localAnchorBy: f32, localAnchorBz: f32,
    featureId: u32,
    _pad: u32,
}

struct Collider {
    shapeType: u32,
    halfExtentX: f32, halfExtentY: f32, halfExtentZ: f32,
    radius: f32, halfHeight: f32,
    localOffsetX: f32, localOffsetY: f32, localOffsetZ: f32,
    friction: f32, restitution: f32,
    _pad0: f32, _pad1: f32, _pad2: f32, _pad3: f32, _pad4: f32,
}

struct Params {
    dt: f32,
    invDt: f32,
    contactCount: u32,
    biasFactor: f32,      // Baumgarte/soft constraint bias (0.1-0.3)
    maxDepenetrationVel: f32,
    warmStartFactor: f32, // Scale for warm-started lambda (0.8)
    relaxation: u32,      // 0 = normal solve, 1 = relaxation pass (no bias)
    _pad: u32,
}

@group(0) @binding(0) var<storage, read_write> contacts: array<Contact>;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> rotations: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> angularVelocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> colliders: array<Collider>;
@group(0) @binding(6) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(7) var<uniform> params: Params;

fn rotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn crossMat(r: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
    return cross(r, n);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.contactCount) { return; }

    var contact = contacts[id];
    let bA = contact.bodyA;
    let bB = contact.bodyB;

    let isGround = (bB == 0xFFFFFFFFu);

    let invMassA = positions[bA].w;
    var invMassB: f32 = 0.0;
    if (!isGround) { invMassB = positions[bB].w; }

    // Skip if both are static/kinematic
    if (invMassA == 0.0 && invMassB == 0.0) { return; }

    let posA = positions[bA].xyz;
    let rotA = rotations[bA];
    var posB: vec3<f32>;
    var rotB: vec4<f32>;
    if (isGround) {
        posB = vec3<f32>(contact.localAnchorBx, contact.localAnchorBy, contact.localAnchorBz);
        rotB = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    } else {
        posB = positions[bB].xyz;
        rotB = rotations[bB];
    }

    // Recompute contact point from local anchors (TGS sub-step updating)
    let worldAnchorA = posA + rotateVec(vec3<f32>(contact.localAnchorAx, contact.localAnchorAy, contact.localAnchorAz), rotA);
    var worldAnchorB: vec3<f32>;
    if (isGround) {
        worldAnchorB = posB; // Ground anchor is already world-space
    } else {
        worldAnchorB = posB + rotateVec(vec3<f32>(contact.localAnchorBx, contact.localAnchorBy, contact.localAnchorBz), rotB);
    }

    let normal = vec3<f32>(contact.normalX, contact.normalY, contact.normalZ);

    // Updated separation (Catto TGS trick: separation = dot(pB + rB - pA - rA, n) + originalSep)
    let separation = dot(worldAnchorB - worldAnchorA, normal);

    // Lever arms
    let rA = worldAnchorA - posA;
    let rB = worldAnchorB - posB;

    // Relative velocity at contact point
    let velA = velocities[bA].xyz;
    let angVelA = angularVelocities[bA].xyz;
    var velB: vec3<f32> = vec3<f32>(0.0);
    var angVelB: vec3<f32> = vec3<f32>(0.0);
    if (!isGround) {
        velB = velocities[bB].xyz;
        angVelB = angularVelocities[bB].xyz;
    }

    let vpA = velA + cross(angVelA, rA);
    let vpB = velB + cross(angVelB, rB);
    let relVel = vpB - vpA;
    let vn = dot(relVel, normal);

    // Effective mass (normal direction)
    let rnA = cross(rA, normal);
    let rnB = cross(rB, normal);
    // Simplified: use scalar effective mass (ignoring inertia tensor rotation for perf)
    let kNormal = invMassA + invMassB + dot(rnA, rnA) * invMassA + dot(rnB, rnB) * invMassB;
    let effMass = select(1.0 / kNormal, 0.0, kNormal < 0.00001);

    // === NORMAL IMPULSE ===
    var bias: f32 = 0.0;
    if (params.relaxation == 0u) {
        // Baumgarte stabilization / soft constraint bias
        if (separation < 0.0) {
            bias = params.biasFactor * separation * params.invDt;
            // Clamp depenetration velocity
            bias = max(bias, -params.maxDepenetrationVel);
        }
        // Restitution
        let colA = colliders[bA];
        var restitution: f32 = colA.restitution;
        if (!isGround && bB < arrayLength(&colliders)) {
            let colB = colliders[bB];
            restitution = max(restitution, colB.restitution);
        }
        if (vn < -1.0) { // Only apply restitution for significant impact velocity
            bias += restitution * vn;
        }
    }

    let incrementalImpulse = effMass * (-vn + bias);

    // Accumulated impulse clamping (Sequential Impulses — Catto)
    let oldLambda = contact.lambda;
    let newLambda = max(0.0, oldLambda + incrementalImpulse);
    let appliedImpulse = newLambda - oldLambda;
    contact.lambda = newLambda;

    // Apply normal impulse
    let impulseN = normal * appliedImpulse;
    velocities[bA] = vec4<f32>(velA - impulseN * invMassA, 0.0);
    angularVelocities[bA] = vec4<f32>(angVelA - cross(rA, impulseN) * invMassA, 0.0);
    if (!isGround) {
        velocities[bB] = vec4<f32>(velB + impulseN * invMassB, 0.0);
        angularVelocities[bB] = vec4<f32>(angVelB + cross(rB, impulseN) * invMassB, 0.0);
    }

    // === FRICTION IMPULSE (Coulomb) ===
    if (params.relaxation == 0u && newLambda > 0.0) {
        // Recompute relative velocity after normal impulse
        let newVpA = velocities[bA].xyz + cross(angularVelocities[bA].xyz, rA);
        var newVpB: vec3<f32> = vec3<f32>(0.0);
        if (!isGround) {
            newVpB = velocities[bB].xyz + cross(angularVelocities[bB].xyz, rB);
        }
        let newRelVel = newVpB - newVpA;

        // Tangent velocity
        let vt = newRelVel - normal * dot(newRelVel, normal);
        let vtLen = length(vt);

        if (vtLen > 0.001) {
            let tangent = vt / vtLen;

            // Tangent effective mass
            let rtA = cross(rA, tangent);
            let rtB = cross(rB, tangent);
            let kTangent = invMassA + invMassB + dot(rtA, rtA) * invMassA + dot(rtB, rtB) * invMassB;
            let effMassT = select(1.0 / kTangent, 0.0, kTangent < 0.00001);

            var frictionImpulse = effMassT * vtLen;

            // Coulomb clamp: |f_t| <= μ * f_n
            let colA2 = colliders[bA];
            var mu: f32 = colA2.friction;
            if (!isGround && bB < arrayLength(&colliders)) {
                let colB2 = colliders[bB];
                mu = sqrt(mu * colB2.friction); // Geometric mean
            }
            let maxFriction = mu * newLambda;
            frictionImpulse = min(frictionImpulse, maxFriction);

            let impulseT = tangent * frictionImpulse;
            velocities[bA] = vec4<f32>(velocities[bA].xyz + impulseT * invMassA, 0.0);
            angularVelocities[bA] = vec4<f32>(angularVelocities[bA].xyz + cross(rA, impulseT) * invMassA, 0.0);
            if (!isGround) {
                velocities[bB] = vec4<f32>(velocities[bB].xyz - impulseT * invMassB, 0.0);
                angularVelocities[bB] = vec4<f32>(angularVelocities[bB].xyz - cross(rB, impulseT) * invMassB, 0.0);
            }
        }
    }

    // Write updated lambda back
    contacts[id] = contact;
}
`;

const SOLVE_JOINTS_SHADER = /* wgsl */`
// D6 joint constraint solver (all joint types are D6 presets)
// Positional + angular constraints with compliance (XPBD)

struct Joint {
    bodyA: u32,
    bodyB: u32,
    jointType: u32,
    flags: u32,
    anchorAx: f32, anchorAy: f32, anchorAz: f32, motorSpeed: f32,    // flags bit0 = motor enabled (hinge); target (wB-wA)·axis
    anchorBx: f32, anchorBy: f32, anchorBz: f32, motorMaxImpulse: f32, // per-substep angular-impulse cap (motor strength)
    axisAx: f32, axisAy: f32, axisAz: f32, _pad2: f32,
    axisBx: f32, axisby: f32, axisBz: f32, _pad3: f32,
    lowerLimit: f32, upperLimit: f32, compliance: f32, damping: f32,
    lambdaPos0: f32, lambdaPos1: f32, lambdaPos2: f32, _pad4: f32,
    lambdaAng0: f32, lambdaAng1: f32, lambdaAng2: f32, _pad5: f32,
}

struct Params {
    dt: f32,
    invDt: f32,
    jointCount: u32,
    _pad: u32,
}

@group(0) @binding(0) var<storage, read_write> joints: array<Joint>;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> rotations: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> angularVelocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(6) var<uniform> params: Params;

fn rotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn quatMul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    );
}

fn quatConj(q: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(-q.xyz, q.w);
}

// Apply positional constraint along direction n
// XPBD: Δλ = -(C + α̃·λ) / (w_a + w_b + α̃)
fn solvePositionalConstraint(
    bA: u32, bB: u32,
    rA: vec3<f32>, rB: vec3<f32>,
    n: vec3<f32>, C: f32,
    compliance: f32, dt: f32,
    prevLambda: f32,
) -> f32 {
    let invMassA = positions[bA].w;
    let invMassB = positions[bB].w;
    if (invMassA == 0.0 && invMassB == 0.0) { return prevLambda; }

    let rnA = cross(rA, n);
    let rnB = cross(rB, n);
    let w = invMassA + invMassB + dot(rnA, rnA) * invMassA + dot(rnB, rnB) * invMassB;
    let alpha_tilde = compliance / (dt * dt);

    let dlambda = -(C + alpha_tilde * prevLambda) / (w + alpha_tilde);
    let impulse = n * dlambda;

    // Apply as velocity change (TGS-compatible)
    let invDt = 1.0 / max(dt, 0.00001);
    velocities[bA] = vec4<f32>(velocities[bA].xyz - impulse * invMassA * invDt, 0.0);
    velocities[bB] = vec4<f32>(velocities[bB].xyz + impulse * invMassB * invDt, 0.0);
    angularVelocities[bA] = vec4<f32>(angularVelocities[bA].xyz - cross(rA, impulse) * invMassA * invDt, 0.0);
    angularVelocities[bB] = vec4<f32>(angularVelocities[bB].xyz + cross(rB, impulse) * invMassB * invDt, 0.0);

    return prevLambda + dlambda;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.jointCount) { return; }

    var joint = joints[id];
    let bA = joint.bodyA;
    let bB = joint.bodyB;

    let posA = positions[bA].xyz;
    let posB = positions[bB].xyz;
    let rotA = rotations[bA];
    let rotB = rotations[bB];

    let anchorA = vec3<f32>(joint.anchorAx, joint.anchorAy, joint.anchorAz);
    let anchorB = vec3<f32>(joint.anchorBx, joint.anchorBy, joint.anchorBz);

    // World-space anchor positions
    let rA = rotateVec(anchorA, rotA);
    let rB = rotateVec(anchorB, rotB);
    let worldA = posA + rA;
    let worldB = posB + rB;

    let dt = params.dt;
    let compliance = joint.compliance;

    // === POSITIONAL CONSTRAINT (ball joint core) ===
    // C = worldB - worldA = 0 (3 scalar constraints)
    let diff = worldB - worldA;

    // Solve each axis independently (Jacobi-safe)
    if (abs(diff.x) > 0.00001) {
        joint.lambdaPos0 = solvePositionalConstraint(bA, bB, rA, rB, vec3<f32>(1.0, 0.0, 0.0), diff.x, compliance, dt, joint.lambdaPos0);
    }
    if (abs(diff.y) > 0.00001) {
        joint.lambdaPos1 = solvePositionalConstraint(bA, bB, rA, rB, vec3<f32>(0.0, 1.0, 0.0), diff.y, compliance, dt, joint.lambdaPos1);
    }
    if (abs(diff.z) > 0.00001) {
        joint.lambdaPos2 = solvePositionalConstraint(bA, bB, rA, rB, vec3<f32>(0.0, 0.0, 1.0), diff.z, compliance, dt, joint.lambdaPos2);
    }

    // === ANGULAR CONSTRAINTS (for hinge, fixed) ===
    let jType = joint.jointType;

    if (jType == 2u) {
        // FIXED joint: lock all 3 angular DOFs
        let relQ = quatMul(quatConj(rotA), rotB);
        // Angular error = 2 * relQ.xyz (small angle approximation)
        let angError = relQ.xyz * 2.0 * select(1.0, -1.0, relQ.w < 0.0);

        let invMassA = positions[bA].w;
        let invMassB = positions[bB].w;
        if (invMassA > 0.0 || invMassB > 0.0) {
            let invDt = 1.0 / max(dt, 0.00001);
            // Simple angular correction (no inertia tensor for now)
            let w_total = invMassA + invMassB;
            let alpha_tilde = compliance / (dt * dt);
            let correction = angError / (w_total + alpha_tilde);

            angularVelocities[bA] = vec4<f32>(angularVelocities[bA].xyz + correction * invMassA * invDt, 0.0);
            angularVelocities[bB] = vec4<f32>(angularVelocities[bB].xyz - correction * invMassB * invDt, 0.0);
        }
    } else if (jType == 1u) {
        // HINGE joint: lock 2 angular DOFs, free around hinge axis
        let axisA = rotateVec(vec3<f32>(joint.axisAx, joint.axisAy, joint.axisAz), rotA);
        let axisB = rotateVec(vec3<f32>(joint.axisBx, joint.axisby, joint.axisBz), rotB);

        // Two perpendicular constraint axes
        var perp1: vec3<f32>;
        if (abs(axisA.y) < 0.9) {
            perp1 = normalize(cross(axisA, vec3<f32>(0.0, 1.0, 0.0)));
        } else {
            perp1 = normalize(cross(axisA, vec3<f32>(1.0, 0.0, 0.0)));
        }
        let perp2 = cross(axisA, perp1);

        let err1 = dot(axisB, perp1);
        let err2 = dot(axisB, perp2);

        let invMassA2 = positions[bA].w;
        let invMassB2 = positions[bB].w;
        if (invMassA2 > 0.0 || invMassB2 > 0.0) {
            let invDt2 = 1.0 / max(dt, 0.00001);
            let w_total2 = invMassA2 + invMassB2;
            let alpha_tilde2 = compliance / (dt * dt);

            let corr1 = perp1 * err1 / (w_total2 + alpha_tilde2);
            let corr2 = perp2 * err2 / (w_total2 + alpha_tilde2);
            let totalCorr = corr1 + corr2;

            angularVelocities[bA] = vec4<f32>(angularVelocities[bA].xyz + totalCorr * invMassA2 * invDt2, 0.0);
            angularVelocities[bB] = vec4<f32>(angularVelocities[bB].xyz - totalCorr * invMassB2 * invDt2, 0.0);
        }

        // === ANGULAR MOTOR (drive relative spin about the hinge axis) ===
        // Velocity-level constraint: push (wB - wA)·axis toward motorSpeed, with a
        // per-substep impulse cap (motorMaxImpulse) acting as the motor strength.
        // With a static axle body this simply spins the gear — the chain is then
        // carried by tooth↔link contacts (no slip), exactly like kool's PxRevolute.
        if ((joint.flags & 1u) != 0u) {
            let invMaM = positions[bA].w;
            let invMbM = positions[bB].w;
            let wsumM = invMaM + invMbM;
            if (wsumM > 0.0) {
                let wRel = dot(angularVelocities[bB].xyz - angularVelocities[bA].xyz, axisA);
                let cdot = wRel - joint.motorSpeed;
                let dl = clamp(-cdot / wsumM, -joint.motorMaxImpulse, joint.motorMaxImpulse);
                let imp = axisA * dl;
                angularVelocities[bA] = vec4<f32>(angularVelocities[bA].xyz - imp * invMaM, 0.0);
                angularVelocities[bB] = vec4<f32>(angularVelocities[bB].xyz + imp * invMbM, 0.0);
            }
        }
    } else if (jType == 3u) {
        // DISTANCE joint: maintain distance between anchors
        let dist = length(diff);
        let restDist = (joint.lowerLimit + joint.upperLimit) * 0.5;
        if (dist > 0.001) {
            let n = diff / dist;
            let C = dist - restDist;
            if (abs(C) > 0.0001) {
                joint.lambdaPos0 = solvePositionalConstraint(bA, bB, rA, rB, n, C, compliance, dt, joint.lambdaPos0);
            }
        }
    }
    // jointType 0 (BALL) — only positional, already handled above
    // jointType 4 (D6) — future: per-axis config
    // jointType 5 (PRISMATIC) — future: locked rotations + slide axis

    joints[id] = joint;
}
`;

// ============================================================================
// CONSTRAINT SOLVER CLASS
// ============================================================================

export class GPUConstraintSolver {
    constructor(device, options = {}) {
        this.device = device;
        this.maxContacts = options.maxContacts ?? MAX_CONTACTS;
        this.maxJoints = options.maxJoints ?? MAX_JOINTS;
        this.biasFactor = options.biasFactor ?? 0.2;
        this.maxDepenetrationVel = options.maxDepenetrationVel ?? 3.0;
        this.warmStartFactor = options.warmStartFactor ?? 0.8;
        this.enableRelaxation = options.enableRelaxation !== false;

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this._paramsF32 = new Float32Array(8);
        this._paramsU32 = new Uint32Array(this._paramsF32.buffer);

        // Joint management (CPU-side)
        this.jointCount = 0;
        this.jointDescriptions = [];
        this._cpuJoints = null;
        this._jointsDirty = false;
    }

    async init(worldBuffers, narrowphaseBuffers) {
        this._createBuffers();
        await this._createPipelines(worldBuffers, narrowphaseBuffers);
        console.log(`[GPUConstraintSolver] Initialized — maxJoints=${this.maxJoints}, relaxation=${this.enableRelaxation}`);
    }

    _createBuffers() {
        const d = this.device;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

        this._buffers.joints = b('CS_Joints', this.maxJoints * JOINT_STRIDE, SUW);
        this._buffers.contactSolveParams = b('CS_ContactParams', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.jointSolveParams = b('CS_JointParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

        // CPU joint data
        this._cpuJoints = new Float32Array(this.maxJoints * (JOINT_STRIDE / 4));
    }

    async _createPipelines(worldBuffers, npBuffers) {
        const d = this.device;
        const mkModule = (label, code) => d.createShaderModule({ label, code });
        const mkPipeline = async (label, module) => d.createComputePipelineAsync({
            label, layout: 'auto', compute: { module, entryPoint: 'main' },
        });

        const contactModule = mkModule('CS_SolveContacts', SOLVE_CONTACTS_SHADER);
        const jointModule = mkModule('CS_SolveJoints', SOLVE_JOINTS_SHADER);

        this._pipelines.solveContacts = await mkPipeline('CS_SolveContacts', contactModule);
        this._pipelines.solveJoints = await mkPipeline('CS_SolveJoints', jointModule);

        this._rebuildBindGroups(worldBuffers, npBuffers);
    }

    _rebuildBindGroups(wb, np) {
        const d = this.device;
        const B = this._buffers;
        const P = this._pipelines;

        this._bindGroups.solveContacts = d.createBindGroup({
            label: 'CS_SolveContacts_BG',
            layout: P.solveContacts.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: np.contacts } },
                { binding: 1, resource: { buffer: wb.positions } },
                { binding: 2, resource: { buffer: wb.rotations } },
                { binding: 3, resource: { buffer: wb.velocities } },
                { binding: 4, resource: { buffer: wb.angularVelocities } },
                { binding: 5, resource: { buffer: wb.colliders } },
                { binding: 6, resource: { buffer: wb.bodyFlags } },
                { binding: 7, resource: { buffer: B.contactSolveParams } },
            ],
        });

        this._bindGroups.solveJoints = d.createBindGroup({
            label: 'CS_SolveJoints_BG',
            layout: P.solveJoints.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.joints } },
                { binding: 1, resource: { buffer: wb.positions } },
                { binding: 2, resource: { buffer: wb.rotations } },
                { binding: 3, resource: { buffer: wb.velocities } },
                { binding: 4, resource: { buffer: wb.angularVelocities } },
                { binding: 5, resource: { buffer: wb.bodyFlags } },
                { binding: 6, resource: { buffer: B.jointSolveParams } },
            ],
        });
    }

    // ========================================================================
    // JOINT MANAGEMENT (CPU-side)
    // ========================================================================

    addJoint(desc = {}) {
        if (this.jointCount >= this.maxJoints) {
            console.warn(`[GPUConstraintSolver] MAX_JOINTS (${this.maxJoints}) exceeded`);
            return -1;
        }

        const handle = this.jointCount++;
        const jType = desc.type === 'hinge' ? JOINT_HINGE
            : desc.type === 'fixed' ? JOINT_FIXED
            : desc.type === 'distance' ? JOINT_DISTANCE
            : desc.type === 'd6' ? JOINT_D6
            : desc.type === 'prismatic' ? JOINT_PRISMATIC
            : JOINT_BALL;

        const anchorA = desc.anchorA || [0, 0, 0];
        const anchorB = desc.anchorB || [0, 0, 0];
        const axisA = desc.axisA || [0, 1, 0];
        const axisB = desc.axisB || [0, 1, 0];
        const compliance = desc.compliance ?? 0.0;
        const damping = desc.damping ?? 0.0;
        const lowerLimit = desc.lowerLimit ?? 0.0;
        const upperLimit = desc.upperLimit ?? 0.0;

        // Hinge angular motor (optional). desc.motor = { targetSpeed, maxImpulse, enabled }.
        // Stored in the formerly-padding slots; flags bit0 toggles it on the GPU.
        const motor = desc.motor || null;
        const motorEnabled = motor ? (motor.enabled !== false) : false;
        const motorSpeed = motor ? (motor.targetSpeed ?? 0.0) : 0.0;
        const motorMaxImpulse = motor ? (motor.maxImpulse ?? 0.0) : 0.0;
        let flags = (desc.flags ?? 0) >>> 0;
        if (motorEnabled) flags |= 1; else flags &= ~1;

        // Write to CPU buffer (32 floats = 128 bytes per joint)
        const offset = handle * 32;
        const u32View = new Uint32Array(this._cpuJoints.buffer);

        u32View[offset + 0] = desc.bodyA ?? 0;
        u32View[offset + 1] = desc.bodyB ?? 0;
        u32View[offset + 2] = jType;
        u32View[offset + 3] = flags;
        this._cpuJoints[offset + 4] = anchorA[0];
        this._cpuJoints[offset + 5] = anchorA[1];
        this._cpuJoints[offset + 6] = anchorA[2];
        this._cpuJoints[offset + 7] = motorSpeed;        // hinge motor target (wB-wA)·axis
        this._cpuJoints[offset + 8] = anchorB[0];
        this._cpuJoints[offset + 9] = anchorB[1];
        this._cpuJoints[offset + 10] = anchorB[2];
        this._cpuJoints[offset + 11] = motorMaxImpulse; // hinge motor per-substep impulse cap
        this._cpuJoints[offset + 12] = axisA[0];
        this._cpuJoints[offset + 13] = axisA[1];
        this._cpuJoints[offset + 14] = axisA[2];
        this._cpuJoints[offset + 15] = 0; // pad
        this._cpuJoints[offset + 16] = axisB[0];
        this._cpuJoints[offset + 17] = axisB[1];
        this._cpuJoints[offset + 18] = axisB[2];
        this._cpuJoints[offset + 19] = 0; // pad
        this._cpuJoints[offset + 20] = lowerLimit;
        this._cpuJoints[offset + 21] = upperLimit;
        this._cpuJoints[offset + 22] = compliance;
        this._cpuJoints[offset + 23] = damping;
        // lambdas initialized to 0 (warm start from previous frame)
        this._cpuJoints[offset + 24] = 0; this._cpuJoints[offset + 25] = 0;
        this._cpuJoints[offset + 26] = 0; this._cpuJoints[offset + 27] = 0;
        this._cpuJoints[offset + 28] = 0; this._cpuJoints[offset + 29] = 0;
        this._cpuJoints[offset + 30] = 0; this._cpuJoints[offset + 31] = 0;

        this._jointsDirty = true;
        this.jointDescriptions[handle] = desc;
        return handle;
    }

    removeJoint(handle) {
        if (handle < 0 || handle >= this.jointCount) return;
        // Zero out the joint (set bodyA = bodyB = 0xFFFFFFFF sentinel)
        const offset = handle * 32;
        const u32View = new Uint32Array(this._cpuJoints.buffer);
        u32View[offset + 0] = 0xFFFFFFFF;
        u32View[offset + 1] = 0xFFFFFFFF;
        this._jointsDirty = true;
        this.jointDescriptions[handle] = null;
    }

    /**
     * Update a hinge joint's angular motor at runtime (live tuning).
     * @param {number} handle
     * @param {Object} opts - { targetSpeed?, maxImpulse?, enabled? }
     */
    setJointMotor(handle, opts = {}) {
        if (handle < 0 || handle >= this.jointCount) return;
        const offset = handle * 32;
        const u32View = new Uint32Array(this._cpuJoints.buffer);
        if (opts.enabled !== undefined) {
            if (opts.enabled) u32View[offset + 3] |= 1; else u32View[offset + 3] &= ~1;
        }
        if (opts.targetSpeed !== undefined) this._cpuJoints[offset + 7] = opts.targetSpeed;
        if (opts.maxImpulse !== undefined) this._cpuJoints[offset + 11] = opts.maxImpulse;
        const d = this.jointDescriptions[handle];
        if (d) { d.motor = { ...(d.motor || {}), ...opts }; }
        this._jointsDirty = true;
    }

    // ========================================================================
    // DISPATCH
    // ========================================================================

    /**
     * Dispatch constraint solving into a command encoder.
     * Called per substep from GPURigidBodyWorld.step().
     */
    dispatch(encoder, substepIndex, substepDt, worldBuffers, narrowphase) {
        // Upload joints if dirty
        if (this._jointsDirty) {
            this.device.queue.writeBuffer(this._buffers.joints, 0, this._cpuJoints, 0, this.jointCount * 32);
            this._jointsDirty = false;
        }

        const contactCount = narrowphase?.contactCount || narrowphase?.maxContacts || 0;
        const invDt = substepDt > 0 ? 1.0 / substepDt : 0;

        // === SOLVE CONTACTS (with bias) ===
        if (contactCount > 0) {
            this._writeContactParams(substepDt, invDt, contactCount, 0); // relaxation=0
            const contactWG = Math.ceil(contactCount / 64);
            const contactPass = encoder.beginComputePass({ label: `CS_Contacts_s${substepIndex}` });
            contactPass.setPipeline(this._pipelines.solveContacts);
            contactPass.setBindGroup(0, this._bindGroups.solveContacts);
            contactPass.dispatchWorkgroups(contactWG);
            contactPass.end();
        }

        // === SOLVE JOINTS ===
        if (this.jointCount > 0) {
            this._writeJointParams(substepDt, invDt);
            const jointWG = Math.ceil(this.jointCount / 64);
            const jointPass = encoder.beginComputePass({ label: `CS_Joints_s${substepIndex}` });
            jointPass.setPipeline(this._pipelines.solveJoints);
            jointPass.setBindGroup(0, this._bindGroups.solveJoints);
            jointPass.dispatchWorkgroups(jointWG);
            jointPass.end();
        }

        // === RELAXATION PASS (contacts only, no bias) ===
        if (this.enableRelaxation && contactCount > 0) {
            this._writeContactParams(substepDt, invDt, contactCount, 1); // relaxation=1
            const relaxWG = Math.ceil(contactCount / 64);
            const relaxPass = encoder.beginComputePass({ label: `CS_Relax_s${substepIndex}` });
            relaxPass.setPipeline(this._pipelines.solveContacts);
            relaxPass.setBindGroup(0, this._bindGroups.solveContacts);
            relaxPass.dispatchWorkgroups(relaxWG);
            relaxPass.end();
        }
    }

    // ========================================================================
    // PARAM WRITING
    // ========================================================================

    _writeContactParams(dt, invDt, contactCount, relaxation) {
        this._paramsF32[0] = dt;
        this._paramsF32[1] = invDt;
        this._paramsU32[2] = contactCount;
        this._paramsF32[3] = this.biasFactor;
        this._paramsF32[4] = this.maxDepenetrationVel;
        this._paramsF32[5] = this.warmStartFactor;
        this._paramsU32[6] = relaxation;
        this._paramsU32[7] = 0;
        this.device.queue.writeBuffer(this._buffers.contactSolveParams, 0, this._paramsF32);
    }

    _writeJointParams(dt, invDt) {
        this._paramsF32[0] = dt;
        this._paramsF32[1] = invDt;
        this._paramsU32[2] = this.jointCount;
        this._paramsU32[3] = 0;
        this.device.queue.writeBuffer(this._buffers.jointSolveParams, 0, this._paramsF32, 0, 4);
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    destroy() {
        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        this._buffers = {};
        this._cpuJoints = null;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export async function createConstraintSolver(device, worldBuffers, narrowphaseBuffers, options = {}) {
    const solver = new GPUConstraintSolver(device, options);
    await solver.init(worldBuffers, narrowphaseBuffers);
    return solver;
}

export function destroyConstraintSolver(solver) {
    if (solver) solver.destroy();
}

export function gpuAddJoint(solver, desc) {
    return solver.addJoint(desc);
}

export function gpuRemoveJoint(solver, handle) {
    solver.removeJoint(handle);
}
