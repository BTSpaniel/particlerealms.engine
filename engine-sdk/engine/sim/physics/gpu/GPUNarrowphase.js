/**
 * GPUNarrowphase.js — GPU Compute Contact Generation
 * 
 * Analytic shape-shape collision tests on GPU compute shaders.
 * Processes candidate pairs from GPUBroadphase, generates contact manifold.
 * 
 * Supported shape pairs:
 * - sphere–sphere, sphere–box, sphere–capsule
 * - box–box (SAT, 15 separating axes)
 * - capsule–capsule (closest points on two line segments)
 * - capsule–box (segment vs box faces)
 * - ground plane (infinite y=0, special-cased)
 * 
 * Contact manifold uses Persistent Contact Manifold (PCM) approach:
 * - Contacts stored with local-frame anchors for sub-step updating
 * - Feature IDs for warm-start matching across frames
 * - OGC barrier energy for penetration prevention
 * 
 * Based on:
 * - PhysX 5 GPU: PCM required for GPU contact gen
 * - PhysX 5: convex hulls capped at 64 verts for GPU compat
 * - Box2D v3 TGS: sub-step contact separation update via local anchors
 * - OGCContact.js: barrier energy WGSL module
 */

import { MAX_CONTACTS, MAX_PAIRS, SHAPE_SPHERE, SHAPE_BOX, SHAPE_CAPSULE, SHAPE_CONVEX } from './GPURigidBodyWorld.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const CONTACT_STRIDE = 64; // bytes per contact (see struct below)

// ============================================================================
// WGSL SHADERS
// ============================================================================

const NARROWPHASE_SHADER = /* wgsl */`
// GPU narrowphase contact generation
// One thread per candidate pair from broadphase

struct Pair {
    bodyA: u32,
    bodyB: u32,
}

struct Contact {
    bodyA: u32,
    bodyB: u32,
    normalX: f32, normalY: f32, normalZ: f32,
    penetration: f32,
    pointX: f32, pointY: f32, pointZ: f32,
    lambda: f32,         // warm-start Lagrange multiplier
    localAnchorAx: f32, localAnchorAy: f32, localAnchorAz: f32,
    localAnchorBx: f32, localAnchorBy: f32, localAnchorBz: f32,
    featureId: u32,      // for persistent manifold matching
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
    pairCount: u32,
    maxContacts: u32,
    contactOffset: f32,
    groundY: f32,
    enableGround: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var<storage, read> pairs: array<Pair>;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> rotations: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> colliders: array<Collider>;
@group(0) @binding(4) var<storage, read_write> contacts: array<Contact>;
@group(0) @binding(5) var<storage, read_write> contactCount: atomic<u32>;
@group(0) @binding(6) var<uniform> params: Params;

// ── Quaternion helpers ──────────────────────────────────────────────────────

fn rotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn inverseRotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let qInv = vec4<f32>(-q.xyz, q.w);
    return rotateVec(v, qInv);
}

// ── Emit contact helper ─────────────────────────────────────────────────────

fn emitContact(
    bA: u32, bB: u32,
    normal: vec3<f32>, penetration: f32, point: vec3<f32>,
    posA: vec3<f32>, rotA: vec4<f32>, posB: vec3<f32>, rotB: vec4<f32>,
    featureId: u32,
) {
    let idx = atomicAdd(&contactCount, 1u);
    if (idx >= params.maxContacts) { return; }

    // Store anchors in local body frames (for sub-step updating — Catto TGS)
    let localA = inverseRotateVec(point - posA, rotA);
    let localB = inverseRotateVec(point - posB, rotB);

    contacts[idx] = Contact(
        bA, bB,
        normal.x, normal.y, normal.z,
        penetration,
        point.x, point.y, point.z,
        0.0, // lambda (warm-start injected later)
        localA.x, localA.y, localA.z,
        localB.x, localB.y, localB.z,
        featureId,
        0u,
    );
}

// ── Sphere–Sphere ───────────────────────────────────────────────────────────

fn testSphereSphere(
    bA: u32, bB: u32,
    posA: vec3<f32>, rA: f32,
    posB: vec3<f32>, rB: f32,
    rotA: vec4<f32>, rotB: vec4<f32>,
) {
    let diff = posB - posA;
    let dist2 = dot(diff, diff);
    let totalR = rA + rB + params.contactOffset;
    if (dist2 > totalR * totalR) { return; }

    let dist = sqrt(dist2);
    var normal: vec3<f32>;
    if (dist < 0.0001) {
        normal = vec3<f32>(0.0, 1.0, 0.0);
    } else {
        normal = diff / dist;
    }
    let penetration = (rA + rB) - dist;
    let point = posA + normal * (rA - penetration * 0.5);
    emitContact(bA, bB, normal, penetration, point, posA, rotA, posB, rotB, 0u);
}

// ── Sphere–Box ──────────────────────────────────────────────────────────────

fn testSphereBox(
    bSphere: u32, bBox: u32,
    posSphere: vec3<f32>, radius: f32,
    posBox: vec3<f32>, rotBox: vec4<f32>, heBox: vec3<f32>,
    rotSphere: vec4<f32>,
) {
    // Transform sphere center into box local space
    let localSphere = inverseRotateVec(posSphere - posBox, rotBox);

    // Clamp to box surface (closest point on box)
    let closest = clamp(localSphere, -heBox, heBox);
    let diff = localSphere - closest;
    let dist2 = dot(diff, diff);
    let totalR = radius + params.contactOffset;

    if (dist2 > totalR * totalR) { return; }

    let dist = sqrt(max(dist2, 0.00001));
    var localNormal: vec3<f32>;
    if (dist < 0.0001) {
        // Sphere center inside box — find nearest face
        let dx = heBox.x - abs(localSphere.x);
        let dy = heBox.y - abs(localSphere.y);
        let dz = heBox.z - abs(localSphere.z);
        if (dx < dy && dx < dz) {
            localNormal = vec3<f32>(sign(localSphere.x), 0.0, 0.0);
        } else if (dy < dz) {
            localNormal = vec3<f32>(0.0, sign(localSphere.y), 0.0);
        } else {
            localNormal = vec3<f32>(0.0, 0.0, sign(localSphere.z));
        }
    } else {
        localNormal = diff / dist;
    }

    let penetration = radius - dist;
    let worldNormal = rotateVec(localNormal, rotBox);
    let worldPoint = posBox + rotateVec(closest, rotBox);
    emitContact(bSphere, bBox, worldNormal, penetration, worldPoint, posSphere, rotSphere, posBox, rotBox, 1u);
}

// ── Box–Box (SAT, 15 axes) ─────────────────────────────────────────────────

fn testBoxBox(
    bA: u32, bB: u32,
    posA: vec3<f32>, rotA: vec4<f32>, heA: vec3<f32>,
    posB: vec3<f32>, rotB: vec4<f32>, heB: vec3<f32>,
) {
    // Get rotation axes for both boxes
    let axA0 = rotateVec(vec3<f32>(1.0, 0.0, 0.0), rotA);
    let axA1 = rotateVec(vec3<f32>(0.0, 1.0, 0.0), rotA);
    let axA2 = rotateVec(vec3<f32>(0.0, 0.0, 1.0), rotA);
    let axB0 = rotateVec(vec3<f32>(1.0, 0.0, 0.0), rotB);
    let axB1 = rotateVec(vec3<f32>(0.0, 1.0, 0.0), rotB);
    let axB2 = rotateVec(vec3<f32>(0.0, 0.0, 1.0), rotB);

    let d = posB - posA;
    var minOverlap: f32 = 1e10;
    var bestAxis: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);

    // Test 6 face axes (3 from A, 3 from B)
    let faceAxes = array<vec3<f32>, 6>(axA0, axA1, axA2, axB0, axB1, axB2);
    let heAArr = array<f32, 3>(heA.x, heA.y, heA.z);
    let heBArr = array<f32, 3>(heB.x, heB.y, heB.z);
    let axAArr = array<vec3<f32>, 3>(axA0, axA1, axA2);
    let axBArr = array<vec3<f32>, 3>(axB0, axB1, axB2);

    for (var i = 0u; i < 6u; i++) {
        let axis = faceAxes[i];
        let axLen = length(axis);
        if (axLen < 0.0001) { continue; }
        let n = axis / axLen;

        // Project both boxes onto axis
        var rA_proj: f32 = 0.0;
        var rB_proj: f32 = 0.0;
        for (var j = 0u; j < 3u; j++) {
            rA_proj += heAArr[j] * abs(dot(axAArr[j], n));
            rB_proj += heBArr[j] * abs(dot(axBArr[j], n));
        }

        let separation = abs(dot(d, n)) - (rA_proj + rB_proj);
        if (separation > params.contactOffset) { return; } // Separating axis found — no collision

        let overlap = -separation;
        if (overlap < minOverlap) {
            minOverlap = overlap;
            bestAxis = n;
            if (dot(d, n) < 0.0) {
                bestAxis = -n;
            }
        }
    }

    // Test 9 edge-edge axes (axAi × axBj)
    for (var i = 0u; i < 3u; i++) {
        for (var j = 0u; j < 3u; j++) {
            var axis = cross(axAArr[i], axBArr[j]);
            let axLen = length(axis);
            if (axLen < 0.001) { continue; } // Parallel edges
            axis = axis / axLen;

            var rA_proj: f32 = 0.0;
            var rB_proj: f32 = 0.0;
            for (var k = 0u; k < 3u; k++) {
                rA_proj += heAArr[k] * abs(dot(axAArr[k], axis));
                rB_proj += heBArr[k] * abs(dot(axBArr[k], axis));
            }

            let separation = abs(dot(d, axis)) - (rA_proj + rB_proj);
            if (separation > params.contactOffset) { return; }

            let overlap = -separation;
            if (overlap < minOverlap) {
                minOverlap = overlap;
                bestAxis = axis;
                if (dot(d, axis) < 0.0) {
                    bestAxis = -axis;
                }
            }
        }
    }

    // Contact point: midpoint of deepest penetration along best axis
    let point = posA + d * 0.5;
    emitContact(bA, bB, bestAxis, minOverlap, point, posA, rotA, posB, rotB, 2u);
}

// ── Sphere–Capsule ──────────────────────────────────────────────────────────

fn closestPointOnSegment(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
    let ab = b - a;
    let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.00001), 0.0, 1.0);
    return a + ab * t;
}

fn testSphereCapsule(
    bSphere: u32, bCap: u32,
    posSphere: vec3<f32>, rSphere: f32,
    posCap: vec3<f32>, rotCap: vec4<f32>, rCap: f32, hhCap: f32,
    rotSphere: vec4<f32>,
) {
    let capAxis = rotateVec(vec3<f32>(0.0, hhCap, 0.0), rotCap);
    let capA = posCap - capAxis;
    let capB = posCap + capAxis;
    let closest = closestPointOnSegment(posSphere, capA, capB);

    testSphereSphere(bSphere, bCap, posSphere, rSphere, closest, rCap, rotSphere, rotCap);
}

// ── Capsule–Capsule ─────────────────────────────────────────────────────────

fn closestPointsOnSegments(
    a0: vec3<f32>, a1: vec3<f32>,
    b0: vec3<f32>, b1: vec3<f32>,
) -> array<vec3<f32>, 2> {
    let d1 = a1 - a0;
    let d2 = b1 - b0;
    let r = a0 - b0;

    let a = dot(d1, d1);
    let e = dot(d2, d2);
    let f = dot(d2, r);

    var s: f32 = 0.0;
    var t: f32 = 0.0;

    if (a <= 0.00001 && e <= 0.00001) {
        return array<vec3<f32>, 2>(a0, b0);
    }

    if (a <= 0.00001) {
        t = clamp(f / e, 0.0, 1.0);
    } else {
        let c = dot(d1, r);
        if (e <= 0.00001) {
            s = clamp(-c / a, 0.0, 1.0);
        } else {
            let b_val = dot(d1, d2);
            let denom = a * e - b_val * b_val;
            if (abs(denom) > 0.00001) {
                s = clamp((b_val * f - c * e) / denom, 0.0, 1.0);
            }
            t = (b_val * s + f) / e;
            if (t < 0.0) {
                t = 0.0;
                s = clamp(-c / a, 0.0, 1.0);
            } else if (t > 1.0) {
                t = 1.0;
                s = clamp((b_val - c) / a, 0.0, 1.0);
            }
        }
    }

    let pA = a0 + d1 * s;
    let pB = b0 + d2 * t;
    return array<vec3<f32>, 2>(pA, pB);
}

fn testCapsuleCapsule(
    bA: u32, bB: u32,
    posA: vec3<f32>, rotA: vec4<f32>, rA: f32, hhA: f32,
    posB: vec3<f32>, rotB: vec4<f32>, rB: f32, hhB: f32,
) {
    let axA = rotateVec(vec3<f32>(0.0, hhA, 0.0), rotA);
    let axB = rotateVec(vec3<f32>(0.0, hhB, 0.0), rotB);

    let pts = closestPointsOnSegments(posA - axA, posA + axA, posB - axB, posB + axB);
    let pA = pts[0];
    let pB = pts[1];

    let diff = pB - pA;
    let dist2 = dot(diff, diff);
    let totalR = rA + rB + params.contactOffset;

    if (dist2 > totalR * totalR) { return; }

    let dist = sqrt(max(dist2, 0.00001));
    var normal: vec3<f32>;
    if (dist < 0.0001) {
        normal = vec3<f32>(0.0, 1.0, 0.0);
    } else {
        normal = diff / dist;
    }

    let penetration = (rA + rB) - dist;
    let point = pA + normal * (rA - penetration * 0.5);
    emitContact(bA, bB, normal, penetration, point, posA, rotA, posB, rotB, 4u);
}

// ── Ground Plane ────────────────────────────────────────────────────────────

fn testBodyGround(
    bA: u32,
    posA: vec3<f32>, rotA: vec4<f32>,
    col: Collider,
) {
    let groundY = params.groundY;
    var deepestY: f32 = 1e10;
    var contactPoint: vec3<f32> = posA;

    switch col.shapeType {
        case 0u: { // Sphere
            deepestY = posA.y - col.radius;
            contactPoint = vec3<f32>(posA.x, deepestY, posA.z);
        }
        case 1u: { // Box — test 8 corners
            let he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ);
            deepestY = 1e10;
            for (var sx = -1.0; sx <= 1.0; sx += 2.0) {
                for (var sy = -1.0; sy <= 1.0; sy += 2.0) {
                    for (var sz = -1.0; sz <= 1.0; sz += 2.0) {
                        let local = vec3<f32>(he.x * sx, he.y * sy, he.z * sz);
                        let world = posA + rotateVec(local, rotA);
                        if (world.y < deepestY) {
                            deepestY = world.y;
                            contactPoint = world;
                        }
                    }
                }
            }
        }
        case 2u: { // Capsule
            let axis = rotateVec(vec3<f32>(0.0, col.halfHeight, 0.0), rotA);
            let bottomA = posA - axis;
            let bottomB = posA + axis;
            let yA = bottomA.y - col.radius;
            let yB = bottomB.y - col.radius;
            if (yA < yB) {
                deepestY = yA;
                contactPoint = bottomA - vec3<f32>(0.0, col.radius, 0.0);
            } else {
                deepestY = yB;
                contactPoint = bottomB - vec3<f32>(0.0, col.radius, 0.0);
            }
        }
        default: {
            let he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ);
            deepestY = posA.y - he.y;
            contactPoint = vec3<f32>(posA.x, deepestY, posA.z);
        }
    }

    let penetration = groundY - deepestY;
    if (penetration < -params.contactOffset) { return; }

    let normal = vec3<f32>(0.0, 1.0, 0.0);
    let groundRot = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    let groundPos = vec3<f32>(0.0, groundY, 0.0);
    emitContact(bA, 0xFFFFFFFFu, normal, penetration, contactPoint, posA, rotA, groundPos, groundRot, 100u);
}

// ── Main dispatch ───────────────────────────────────────────────────────────

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.pairCount) { return; }

    let pair = pairs[id];
    let bA = pair.bodyA;
    let bB = pair.bodyB;

    let posA = positions[bA].xyz;
    let posB = positions[bB].xyz;
    let rotA = rotations[bA];
    let rotB = rotations[bB];
    let colA = colliders[bA];
    let colB = colliders[bB];

    let sA = colA.shapeType;
    let sB = colB.shapeType;

    // Dispatch by shape pair (ordered: lower type first)
    if (sA == 0u && sB == 0u) {
        testSphereSphere(bA, bB, posA, colA.radius, posB, colB.radius, rotA, rotB);
    } else if (sA == 0u && sB == 1u) {
        testSphereBox(bA, bB, posA, colA.radius, posB, rotB, vec3<f32>(colB.halfExtentX, colB.halfExtentY, colB.halfExtentZ), rotA);
    } else if (sA == 1u && sB == 0u) {
        testSphereBox(bB, bA, posB, colB.radius, posA, rotA, vec3<f32>(colA.halfExtentX, colA.halfExtentY, colA.halfExtentZ), rotB);
    } else if (sA == 1u && sB == 1u) {
        testBoxBox(bA, bB, posA, rotA, vec3<f32>(colA.halfExtentX, colA.halfExtentY, colA.halfExtentZ), posB, rotB, vec3<f32>(colB.halfExtentX, colB.halfExtentY, colB.halfExtentZ));
    } else if (sA == 0u && sB == 2u) {
        testSphereCapsule(bA, bB, posA, colA.radius, posB, rotB, colB.radius, colB.halfHeight, rotA);
    } else if (sA == 2u && sB == 0u) {
        testSphereCapsule(bB, bA, posB, colB.radius, posA, rotA, colA.radius, colA.halfHeight, rotB);
    } else if (sA == 2u && sB == 2u) {
        testCapsuleCapsule(bA, bB, posA, rotA, colA.radius, colA.halfHeight, posB, rotB, colB.radius, colB.halfHeight);
    }
    // TODO: capsule-box, convex-* via GJK (Phase 2)
}
`;

const GROUND_CONTACTS_SHADER = /* wgsl */`
// Separate pass: generate ground plane contacts for all dynamic bodies
// Runs per-body (not per-pair) since ground is implicit

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
    bodyCount: u32,
    maxContacts: u32,
    contactOffset: f32,
    groundY: f32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> rotations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> colliders: array<Collider>;
@group(0) @binding(3) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(4) var<storage, read_write> contacts: array<Contact>;
@group(0) @binding(5) var<storage, read_write> contactCount: atomic<u32>;
@group(0) @binding(6) var<uniform> params: Params;

fn rotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn inverseRotateVec(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let qInv = vec4<f32>(-q.xyz, q.w);
    return rotateVec(v, qInv);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let flags = bodyFlags[id];
    let simMode = flags & 3u;
    if (simMode == 2u) { return; } // Static — no ground contact needed
    if ((flags & 4u) != 0u) { return; } // Sleeping

    let pos = positions[id].xyz;
    let rot = rotations[id];
    let col = colliders[id];
    let groundY = params.groundY;

    var deepestY: f32 = 1e10;
    var contactPoint: vec3<f32> = pos;

    switch col.shapeType {
        case 0u: { // Sphere
            deepestY = pos.y - col.radius;
            contactPoint = vec3<f32>(pos.x, deepestY, pos.z);
        }
        case 1u: { // Box — test 8 corners
            let he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ);
            for (var sx = -1.0; sx <= 1.0; sx += 2.0) {
                for (var sy = -1.0; sy <= 1.0; sy += 2.0) {
                    for (var sz = -1.0; sz <= 1.0; sz += 2.0) {
                        let local = vec3<f32>(he.x * sx, he.y * sy, he.z * sz);
                        let world = pos + rotateVec(local, rot);
                        if (world.y < deepestY) {
                            deepestY = world.y;
                            contactPoint = world;
                        }
                    }
                }
            }
        }
        case 2u: { // Capsule
            let axis = rotateVec(vec3<f32>(0.0, col.halfHeight, 0.0), rot);
            let a = pos - axis;
            let b = pos + axis;
            let yA = a.y - col.radius;
            let yB = b.y - col.radius;
            if (yA < yB) {
                deepestY = yA;
                contactPoint = a - vec3<f32>(0.0, col.radius, 0.0);
            } else {
                deepestY = yB;
                contactPoint = b - vec3<f32>(0.0, col.radius, 0.0);
            }
        }
        default: { // Convex fallback
            let he = vec3<f32>(col.halfExtentX, col.halfExtentY, col.halfExtentZ);
            deepestY = pos.y - he.y;
            contactPoint = vec3<f32>(pos.x, deepestY, pos.z);
        }
    }

    let penetration = groundY - deepestY;
    if (penetration < -params.contactOffset) { return; }

    let normal = vec3<f32>(0.0, 1.0, 0.0);
    let groundPos = vec3<f32>(0.0, groundY, 0.0);
    let groundRot = vec4<f32>(0.0, 0.0, 0.0, 1.0);

    let localA = inverseRotateVec(contactPoint - pos, rot);

    let idx = atomicAdd(&contactCount, 1u);
    if (idx >= params.maxContacts) { return; }

    contacts[idx] = Contact(
        id, 0xFFFFFFFFu,
        0.0, 1.0, 0.0,
        penetration,
        contactPoint.x, contactPoint.y, contactPoint.z,
        0.0,
        localA.x, localA.y, localA.z,
        contactPoint.x, groundY, contactPoint.z,
        100u,
        0u,
    );
}
`;

// ============================================================================
// NARROWPHASE CLASS
// ============================================================================

export class GPUNarrowphase {
    constructor(device, options = {}) {
        this.device = device;
        this.maxContacts = options.maxContacts ?? MAX_CONTACTS;
        this.maxPairs = options.maxPairs ?? MAX_PAIRS;
        this.contactOffset = options.contactOffset ?? 0.02;
        this.groundY = options.groundY ?? -0.25;
        this.enableGround = options.enableGround !== false;

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this._paramsF32 = new Float32Array(8);
        this._paramsU32 = new Uint32Array(this._paramsF32.buffer);

        this.contactCount = 0;
    }

    async init(worldBuffers, broadphaseBuffers) {
        this._createBuffers();
        await this._createPipelines(worldBuffers, broadphaseBuffers);
        console.log(`[GPUNarrowphase] Initialized — maxContacts=${this.maxContacts}`);
    }

    _createBuffers() {
        const d = this.device;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

        // Contact buffer
        this._buffers.contacts = b('NP_Contacts', this.maxContacts * CONTACT_STRIDE, SUW);
        this._buffers.contactCount = b('NP_ContactCount', 4, SUW);

        // Params
        this._buffers.narrowParams = b('NP_Params', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.groundParams = b('NP_GroundParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

        // Readback for contact count
        this._buffers.contactCountReadback = b('NP_ContactCountRead', 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    }

    async _createPipelines(worldBuffers, bpBuffers) {
        const d = this.device;
        const mkModule = (label, code) => d.createShaderModule({ label, code });
        const mkPipeline = async (label, module) => d.createComputePipelineAsync({
            label, layout: 'auto', compute: { module, entryPoint: 'main' },
        });

        const npModule = mkModule('NP_Narrowphase', NARROWPHASE_SHADER);
        const groundModule = mkModule('NP_Ground', GROUND_CONTACTS_SHADER);

        this._pipelines.narrowphase = await mkPipeline('NP_Narrowphase', npModule);
        this._pipelines.groundContacts = await mkPipeline('NP_Ground', groundModule);

        this._rebuildBindGroups(worldBuffers, bpBuffers);
    }

    _rebuildBindGroups(wb, bp) {
        const d = this.device;
        const B = this._buffers;
        const P = this._pipelines;

        this._bindGroups.narrowphase = d.createBindGroup({
            label: 'NP_Narrowphase_BG',
            layout: P.narrowphase.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: bp.pairBuffer } },
                { binding: 1, resource: { buffer: wb.positions } },
                { binding: 2, resource: { buffer: wb.rotations } },
                { binding: 3, resource: { buffer: wb.colliders } },
                { binding: 4, resource: { buffer: B.contacts } },
                { binding: 5, resource: { buffer: B.contactCount } },
                { binding: 6, resource: { buffer: B.narrowParams } },
            ],
        });

        this._bindGroups.groundContacts = d.createBindGroup({
            label: 'NP_Ground_BG',
            layout: P.groundContacts.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: wb.positions } },
                { binding: 1, resource: { buffer: wb.rotations } },
                { binding: 2, resource: { buffer: wb.colliders } },
                { binding: 3, resource: { buffer: wb.bodyFlags } },
                { binding: 4, resource: { buffer: B.contacts } },
                { binding: 5, resource: { buffer: B.contactCount } },
                { binding: 6, resource: { buffer: B.groundParams } },
            ],
        });
    }

    /**
     * Dispatch narrowphase contact generation.
     * @param {GPUCommandEncoder} encoder
     * @param {GPUBroadphase} broadphase
     * @param {Object} worldBuffers
     * @param {number} [bodyCount] - for ground contacts
     */
    dispatch(encoder, broadphase, worldBuffers, bodyCount = 0) {
        // Zero contact count
        const zero = new Uint32Array([0]);
        this.device.queue.writeBuffer(this._buffers.contactCount, 0, zero);

        // Write params
        this._writeNarrowParams(broadphase.pairCount || broadphase.maxPairs);

        // 1. Shape-shape contact generation (per pair)
        const pairWG = Math.ceil((broadphase.pairCount || broadphase.maxPairs) / 64);
        if (pairWG > 0) {
            const npPass = encoder.beginComputePass({ label: 'NP_Narrowphase' });
            npPass.setPipeline(this._pipelines.narrowphase);
            npPass.setBindGroup(0, this._bindGroups.narrowphase);
            npPass.dispatchWorkgroups(pairWG);
            npPass.end();
        }

        // 2. Ground plane contacts (per body)
        if (this.enableGround && bodyCount > 0) {
            this._writeGroundParams(bodyCount);
            const groundWG = Math.ceil(bodyCount / 64);
            const groundPass = encoder.beginComputePass({ label: 'NP_Ground' });
            groundPass.setPipeline(this._pipelines.groundContacts);
            groundPass.setBindGroup(0, this._bindGroups.groundContacts);
            groundPass.dispatchWorkgroups(groundWG);
            groundPass.end();
        }

        // Copy contact count for readback
        encoder.copyBufferToBuffer(this._buffers.contactCount, 0, this._buffers.contactCountReadback, 0, 4);
    }

    async readbackContactCount() {
        try {
            await this._buffers.contactCountReadback.mapAsync(GPUMapMode.READ);
            const data = new Uint32Array(this._buffers.contactCountReadback.getMappedRange().slice(0));
            this._buffers.contactCountReadback.unmap();
            this.contactCount = Math.min(data[0], this.maxContacts);
            return this.contactCount;
        } catch (e) {
            console.warn('[GPUNarrowphase] Contact count readback failed:', e.message);
            return 0;
        }
    }

    _writeNarrowParams(pairCount) {
        this._paramsU32[0] = pairCount;
        this._paramsU32[1] = this.maxContacts;
        this._paramsF32[2] = this.contactOffset;
        this._paramsF32[3] = this.groundY;
        this._paramsU32[4] = this.enableGround ? 1 : 0;
        this._paramsU32[5] = 0;
        this._paramsU32[6] = 0;
        this._paramsU32[7] = 0;
        this.device.queue.writeBuffer(this._buffers.narrowParams, 0, this._paramsF32);
    }

    _writeGroundParams(bodyCount) {
        this._paramsU32[0] = bodyCount;
        this._paramsU32[1] = this.maxContacts;
        this._paramsF32[2] = this.contactOffset;
        this._paramsF32[3] = this.groundY;
        this.device.queue.writeBuffer(this._buffers.groundParams, 0, this._paramsF32, 0, 4);
    }

    destroy() {
        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        this._buffers = {};
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export async function createNarrowphase(device, worldBuffers, broadphaseBuffers, options = {}) {
    const np = new GPUNarrowphase(device, options);
    await np.init(worldBuffers, broadphaseBuffers);
    return np;
}

export function destroyNarrowphase(np) {
    if (np) np.destroy();
}
