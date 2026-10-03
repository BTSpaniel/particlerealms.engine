// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// PBD Constraint Solver - GPU Compute Shader
// Position-Based Dynamics with XPBD compliance
//
// Requires graph coloring: constraints with same color can be solved in parallel
// Each dispatch solves one color group, multiple dispatches per iteration
//
// Pipeline:
// 1. predict_positions - Apply gravity, store old positions
// 2. solve_distance_constraints - Per color group (repeated)
// 3. solve_angle_constraints - Per color group (repeated)
// 4. update_velocities - Derive velocity from position delta

// ============================================================================
// STRUCTURES
// ============================================================================

struct Particle {
    pos: vec3f,         // Current position
    invMass: f32,       // Inverse mass (0 = fixed)
    prevPos: vec3f,     // Previous position (for Verlet)
    radius: f32,        // Collision radius
}

struct DistanceConstraint {
    idxA: u32,          // Particle A index
    idxB: u32,          // Particle B index
    restLength: f32,    // Rest distance
    compliance: f32,    // XPBD compliance (α)
}

struct AngleConstraint {
    idxA: u32,          // End point 1
    idxB: u32,          // Pivot
    idxC: u32,          // End point 2
    minAngle: f32,      // Minimum angle (radians)
    maxAngle: f32,      // Maximum angle (radians)
    stiffness: f32,     // Constraint stiffness
    pad0: u32,
    pad1: u32,
}

struct Uniforms {
    gravity: vec3f,
    dt: f32,
    damping: f32,
    currentColor: u32,  // Which color group to solve
    numParticles: u32,
    numConstraints: u32,
    groundY: f32,
    friction: f32,
    pad0: u32,
    pad1: u32,
}

// ============================================================================
// BINDINGS
// ============================================================================

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> distanceConstraints: array<DistanceConstraint>;
@group(0) @binding(2) var<storage, read> angleConstraints: array<AngleConstraint>;
@group(0) @binding(3) var<storage, read> constraintColors: array<u32>;
@group(0) @binding(4) var<storage, read_write> lambdas: array<f32>; // XPBD multipliers
@group(0) @binding(5) var<uniform> uniforms: Uniforms;

// ============================================================================
// PREDICT POSITIONS (Verlet Integration)
// ============================================================================

@compute @workgroup_size(256)
fn predict_positions(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= uniforms.numParticles) { return; }

    var p = particles[idx];

    // Skip fixed particles
    if (p.invMass == 0.0) { return; }

    let dt = uniforms.dt;

    // Compute velocity from position delta
    var vel = (p.pos - p.prevPos) / dt;

    // Apply gravity
    vel += uniforms.gravity * dt;

    // Apply damping
    vel *= uniforms.damping;

    // Store previous position
    p.prevPos = p.pos;

    // Predict new position
    p.pos += vel * dt;

    particles[idx] = p;
}

// ============================================================================
// SOLVE DISTANCE CONSTRAINTS
// ============================================================================

@compute @workgroup_size(256)
fn solve_distance_constraints(@builtin(global_invocation_id) gid: vec3u) {
    let constraintIdx = gid.x;
    if (constraintIdx >= uniforms.numConstraints) { return; }

    // Check if this constraint belongs to current color
    if (constraintColors[constraintIdx] != uniforms.currentColor) { return; }

    let c = distanceConstraints[constraintIdx];

    var pA = particles[c.idxA];
    var pB = particles[c.idxB];

    // Skip if both fixed
    let w = pA.invMass + pB.invMass;
    if (w == 0.0) { return; }

    // Direction and distance
    let delta = pB.pos - pA.pos;
    let dist = length(delta);

    if (dist < 0.0001) { return; }

    // Constraint violation
    let C = dist - c.restLength;

    // XPBD: Include compliance
    let dt = uniforms.dt;
    let alpha = c.compliance / (dt * dt);

    // Load previous lambda
    let prevLambda = lambdas[constraintIdx];

    // Compute delta lambda
    let deltaLambda = (-C - alpha * prevLambda) / (w + alpha);

    // Store updated lambda
    lambdas[constraintIdx] = prevLambda + deltaLambda;

    // Compute position corrections
    let correction = delta * (deltaLambda / dist);

    // Apply corrections weighted by inverse mass
    if (pA.invMass > 0.0) {
        pA.pos += correction * pA.invMass;
        particles[c.idxA] = pA;
    }

    if (pB.invMass > 0.0) {
        pB.pos -= correction * pB.invMass;
        particles[c.idxB] = pB;
    }
}

// ============================================================================
// SOLVE ANGLE CONSTRAINTS
// ============================================================================

@compute @workgroup_size(256)
fn solve_angle_constraints(@builtin(global_invocation_id) gid: vec3u) {
    let constraintIdx = gid.x;
    if (constraintIdx >= uniforms.numConstraints) { return; }

    // Angle constraints use separate numbering

    let c = angleConstraints[constraintIdx];

    var pA = particles[c.idxA];
    var pB = particles[c.idxB]; // Pivot
    var pC = particles[c.idxC];

    // Vectors from pivot
    let ba = pA.pos - pB.pos;
    let bc = pC.pos - pB.pos;

    let lenBA = length(ba);
    let lenBC = length(bc);

    if (lenBA < 0.0001 || lenBC < 0.0001) { return; }

    // Normalize
    let nBA = ba / lenBA;
    let nBC = bc / lenBC;

    // Current angle
    let dotProduct = clamp(dot(nBA, nBC), -1.0, 1.0);
    let angle = acos(dotProduct);

    // Check limits
    var targetAngle = angle;
    if (angle < c.minAngle) {
        targetAngle = c.minAngle;
    } else if (angle > c.maxAngle) {
        targetAngle = c.maxAngle;
    } else {
        return; // Within limits
    }

    // Rotation axis
    var axis = cross(nBA, nBC);
    let axisLen = length(axis);
    if (axisLen < 0.0001) { return; }
    axis /= axisLen;

    // Correction angle
    let correction = (targetAngle - angle) * c.stiffness * 0.5;

    // Rotate endpoints using Rodrigues' formula
    if (pA.invMass > 0.0) {
        let rotatedBA = rotateAroundAxis(nBA, axis, correction);
        pA.pos = pB.pos + rotatedBA * lenBA;
        particles[c.idxA] = pA;
    }

    if (pC.invMass > 0.0) {
        let rotatedBC = rotateAroundAxis(nBC, axis, -correction);
        pC.pos = pB.pos + rotatedBC * lenBC;
        particles[c.idxC] = pC;
    }
}

// Rodrigues' rotation formula
fn rotateAroundAxis(v: vec3f, axis: vec3f, angle: f32) -> vec3f {
    let c = cos(angle);
    let s = sin(angle);
    let t = 1.0 - c;

    let x = axis.x;
    let y = axis.y;
    let z = axis.z;

    return vec3f(
        (t*x*x + c)*v.x + (t*x*y - s*z)*v.y + (t*x*z + s*y)*v.z,
        (t*x*y + s*z)*v.x + (t*y*y + c)*v.y + (t*y*z - s*x)*v.z,
        (t*x*z - s*y)*v.x + (t*y*z + s*x)*v.y + (t*z*z + c)*v.z
    );
}

// ============================================================================
// GROUND COLLISION
// ============================================================================

@compute @workgroup_size(256)
fn solve_ground_collision(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= uniforms.numParticles) { return; }

    var p = particles[idx];

    if (p.invMass == 0.0) { return; }

    let groundY = uniforms.groundY;
    let penetration = groundY + p.radius - p.pos.y;

    if (penetration > 0.0) {
        // Push out of ground
        p.pos.y = groundY + p.radius;

        // Apply friction to horizontal velocity
        let vel = p.pos - p.prevPos;
        if (vel.y < 0.0) {
            p.prevPos.x = p.pos.x - vel.x * uniforms.friction;
            p.prevPos.z = p.pos.z - vel.z * uniforms.friction;
        }

        particles[idx] = p;
    }
}

// ============================================================================
// PARTICLE-PARTICLE COLLISION
// ============================================================================

@compute @workgroup_size(256)
fn solve_particle_collision(@builtin(global_invocation_id) gid: vec3u) {
    let idxA = gid.x;
    if (idxA >= uniforms.numParticles) { return; }

    var pA = particles[idxA];
    if (pA.invMass == 0.0) { return; }

    // Simple O(n²) - for production, use spatial hash
    for (var idxB = idxA + 1u; idxB < uniforms.numParticles; idxB++) {
        var pB = particles[idxB];

        let delta = pB.pos - pA.pos;
        let dist = length(delta);
        let minDist = pA.radius + pB.radius;

        if (dist < minDist && dist > 0.0001) {
            let overlap = minDist - dist;
            let normal = delta / dist;

            let w = pA.invMass + pB.invMass;
            if (w == 0.0) { continue; }

            let correction = normal * overlap;

            pA.pos -= correction * (pA.invMass / w);
            pB.pos += correction * (pB.invMass / w);

            particles[idxB] = pB;
        }
    }

    particles[idxA] = pA;
}

// ============================================================================
// UPDATE VELOCITIES
// ============================================================================

@compute @workgroup_size(256)
fn update_velocities(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= uniforms.numParticles) { return; }

    var p = particles[idx];

    if (p.invMass == 0.0) { return; }

    // Velocity is implicitly stored as position delta
    // This kernel can be used for velocity clamping or other post-processing

    let vel = (p.pos - p.prevPos) / uniforms.dt;
    let speed = length(vel);

    // Clamp maximum velocity
    let maxSpeed = 100.0;
    if (speed > maxSpeed) {
        let clampedVel = vel * (maxSpeed / speed);
        p.prevPos = p.pos - clampedVel * uniforms.dt;
        particles[idx] = p;
    }
}

// ============================================================================
// RESET LAMBDAS (Call at start of each timestep)
// ============================================================================

@compute @workgroup_size(256)
fn reset_lambdas(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= uniforms.numConstraints) { return; }

    lambdas[idx] = 0.0;
}

// ============================================================================
// ATTACHMENT CONSTRAINT (Pin to world position)
// ============================================================================

struct AttachmentTarget {
    particleIdx: u32,
    targetPos: vec3f,
    stiffness: f32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
}

@group(1) @binding(0) var<storage, read> attachments: array<AttachmentTarget>;
@group(1) @binding(1) var<uniform> numAttachments: u32;

@compute @workgroup_size(256)
fn solve_attachments(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= numAttachments) { return; }

    let attachment = attachments[idx];
    var p = particles[attachment.particleIdx];

    if (p.invMass == 0.0) { return; }

    let delta = attachment.targetPos - p.pos;
    p.pos += delta * attachment.stiffness;

    particles[attachment.particleIdx] = p;
}
