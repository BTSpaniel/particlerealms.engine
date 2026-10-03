// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathPhysics.js - Physics utilities
// Kinematics, dynamics, collision response, constraints, rigid body

import { EPSILON } from './MathConstants.js';
import { clamp } from './MathScalar.js';
import {
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3LengthSq,
  vec3Scale,
  vec3Sub,
} from './MathVec3.js';

// ============================================================================
// VECTOR HELPERS
// ============================================================================

const vec3Normalize = (v) => { const l = vec3Length(v); return l < EPSILON ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l]; };

// ============================================================================
// KINEMATICS
// ============================================================================

// Linear motion with Velocity Verlet integration
export function linearMotion(position, velocity, acceleration, dt) {
  const newVelocity = vec3Add(velocity, vec3Scale(acceleration, dt));
  const avgVelocity = vec3Scale(vec3Add(velocity, newVelocity), 0.5);
  const newPosition = vec3Add(position, vec3Scale(avgVelocity, dt));
  return { position: newPosition, velocity: newVelocity };
}

// Simple Euler integration
export function eulerIntegrate(position, velocity, acceleration, dt) {
  const newVelocity = vec3Add(velocity, vec3Scale(acceleration, dt));
  const newPosition = vec3Add(position, vec3Scale(velocity, dt));
  return { position: newPosition, velocity: newVelocity };
}

// Semi-implicit Euler (symplectic)
export function semiImplicitEuler(position, velocity, acceleration, dt) {
  const newVelocity = vec3Add(velocity, vec3Scale(acceleration, dt));
  const newPosition = vec3Add(position, vec3Scale(newVelocity, dt));
  return { position: newPosition, velocity: newVelocity };
}

// Projectile motion
export function projectileMotion(position, velocity, gravity, dt) {
  const acceleration = [0, -gravity, 0];
  return linearMotion(position, velocity, acceleration, dt);
}

// Projectile trajectory point at time t
export function projectilePosition(start, velocity, gravity, t) {
  return [
    start[0] + velocity[0] * t,
    start[1] + velocity[1] * t - 0.5 * gravity * t * t,
    start[2] + velocity[2] * t,
  ];
}

// Time to reach max height
export function projectileTimeToApex(velocityY, gravity) {
  return velocityY / gravity;
}

// Max height of projectile
export function projectileMaxHeight(startY, velocityY, gravity) {
  return startY + (velocityY * velocityY) / (2 * gravity);
}

// Range of projectile (landing at same height)
export function projectileRange(speed, angle, gravity) {
  return (speed * speed * Math.sin(2 * angle)) / gravity;
}

// Launch angle for desired range
export function projectileLaunchAngle(range, speed, gravity) {
  const sin2theta = (range * gravity) / (speed * speed);
  if (Math.abs(sin2theta) > 1) return null; // Impossible
  return Math.asin(sin2theta) / 2;
}

// Velocity needed to hit target
export function projectileVelocityToTarget(start, target, gravity, preferHighArc = false) {
  const dx = target[0] - start[0];
  const dy = target[1] - start[1];
  const dz = target[2] - start[2];
  const horizDist = Math.sqrt(dx * dx + dz * dz);
  
  // Solve for launch angle
  const g = gravity;
  const v2 = horizDist * horizDist * g * g + 2 * dy * g * horizDist * horizDist;
  if (v2 < 0) return null; // Can't reach
  
  const v = Math.sqrt(v2);
  const angle1 = Math.atan2(v + Math.sqrt(v * v - g * (g * horizDist * horizDist + 2 * dy * v * v)), g * horizDist);
  const angle2 = Math.atan2(v - Math.sqrt(v * v - g * (g * horizDist * horizDist + 2 * dy * v * v)), g * horizDist);
  
  const angle = preferHighArc ? Math.max(angle1, angle2) : Math.min(angle1, angle2);
  const speed = horizDist / (Math.cos(angle) * (horizDist / (v * Math.cos(angle))));
  
  const horizDir = horizDist > EPSILON ? [dx / horizDist, 0, dz / horizDist] : [1, 0, 0];
  return [
    horizDir[0] * speed * Math.cos(angle),
    speed * Math.sin(angle),
    horizDir[2] * speed * Math.cos(angle),
  ];
}

// ============================================================================
// ROTATIONAL KINEMATICS
// ============================================================================

// Point velocity from angular velocity
export function pointVelocityFromAngular(angularVelocity, centerOfRotation, point) {
  const r = vec3Sub(point, centerOfRotation);
  return vec3Cross(angularVelocity, r);
}

// Total velocity of point on rotating body
export function totalPointVelocity(linearVelocity, angularVelocity, centerOfMass, point) {
  return vec3Add(linearVelocity, pointVelocityFromAngular(angularVelocity, centerOfMass, point));
}

// ============================================================================
// DYNAMICS
// ============================================================================

// Force = mass * acceleration
export const forceFromAcceleration = (mass, acceleration) => vec3Scale(acceleration, mass);
export const accelerationFromForce = (mass, force) => vec3Scale(force, 1 / mass);

// Gravitational force between two masses
export function gravitationalForce(m1, m2, p1, p2, G = 6.674e-11) {
  const r = vec3Sub(p2, p1);
  const distSq = vec3LengthSq(r);
  if (distSq < EPSILON) return [0, 0, 0];
  const magnitude = (G * m1 * m2) / distSq;
  return vec3Scale(vec3Normalize(r), magnitude);
}

// Spring force (Hooke's law)
export function springForce(position, anchor, restLength, stiffness) {
  const displacement = vec3Sub(position, anchor);
  const currentLength = vec3Length(displacement);
  if (currentLength < EPSILON) return [0, 0, 0];
  const extension = currentLength - restLength;
  const direction = vec3Scale(displacement, -1 / currentLength);
  return vec3Scale(direction, stiffness * extension);
}

// Damped spring force
export function dampedSpringForce(position, velocity, anchor, restLength, stiffness, damping) {
  const spring = springForce(position, anchor, restLength, stiffness);
  const dampingForce = vec3Scale(velocity, -damping);
  return vec3Add(spring, dampingForce);
}

// Drag force (quadratic)
export function dragForce(velocity, dragCoefficient, area, fluidDensity = 1.225) {
  const speed = vec3Length(velocity);
  if (speed < EPSILON) return [0, 0, 0];
  const magnitude = 0.5 * fluidDensity * speed * speed * dragCoefficient * area;
  return vec3Scale(vec3Normalize(velocity), -magnitude);
}

// Linear drag force
export function linearDragForce(velocity, dragCoefficient) {
  return vec3Scale(velocity, -dragCoefficient);
}

// Friction force
export function frictionForce(velocity, normalForce, frictionCoefficient) {
  const speed = vec3Length(velocity);
  if (speed < EPSILON) return [0, 0, 0];
  const frictionMagnitude = frictionCoefficient * normalForce;
  return vec3Scale(vec3Normalize(velocity), -Math.min(frictionMagnitude, speed));
}

// Buoyancy force
export function buoyancyForce(submergedVolume, fluidDensity, gravity = 9.81) {
  return [0, submergedVolume * fluidDensity * gravity, 0];
}

// Torque from force at point
export function torqueFromForce(force, point, centerOfMass) {
  const r = vec3Sub(point, centerOfMass);
  return vec3Cross(r, force);
}

// Angular acceleration from torque (scalar inertia)
export function angularAccelerationFromTorque(torque, inertia) {
  if (typeof inertia === 'number') {
    return vec3Scale(torque, 1 / inertia);
  }
  // For diagonal inertia tensor
  return [torque[0] / inertia[0], torque[1] / inertia[1], torque[2] / inertia[2]];
}

// ============================================================================
// COLLISION RESPONSE
// ============================================================================

// Elastic collision between two particles
export function elasticCollision(m1, v1, m2, v2) {
  const totalMass = m1 + m2;
  const v1New = vec3Add(
    vec3Scale(v1, (m1 - m2) / totalMass),
    vec3Scale(v2, (2 * m2) / totalMass)
  );
  const v2New = vec3Add(
    vec3Scale(v2, (m2 - m1) / totalMass),
    vec3Scale(v1, (2 * m1) / totalMass)
  );
  return { v1: v1New, v2: v2New };
}

// Inelastic collision (with restitution)
export function inelasticCollision(m1, v1, m2, v2, restitution = 0.5) {
  const relativeVelocity = vec3Sub(v1, v2);
  const totalMass = m1 + m2;
  const impulse = vec3Scale(relativeVelocity, -(1 + restitution) * m1 * m2 / totalMass);
  const v1New = vec3Add(v1, vec3Scale(impulse, -1 / m1));
  const v2New = vec3Add(v2, vec3Scale(impulse, 1 / m2));
  return { v1: v1New, v2: v2New };
}

// Sphere-sphere collision response
export function sphereCollisionResponse(p1, v1, m1, r1, p2, v2, m2, r2, restitution = 0.8) {
  const normal = vec3Normalize(vec3Sub(p1, p2));
  const relativeVelocity = vec3Sub(v1, v2);
  const normalVelocity = vec3Dot(relativeVelocity, normal);

  // Not colliding or separating
  if (normalVelocity > 0) return null;

  const j = -(1 + restitution) * normalVelocity / (1/m1 + 1/m2);
  const impulse = vec3Scale(normal, j);

  return {
    v1: vec3Add(v1, vec3Scale(impulse, 1/m1)),
    v2: vec3Sub(v2, vec3Scale(impulse, 1/m2)),
  };
}

// Wall/plane collision response
export function planeCollisionResponse(velocity, normal, restitution = 0.8) {
  const normalVelocity = vec3Dot(velocity, normal);
  if (normalVelocity >= 0) return velocity; // Not colliding
  const reflection = vec3Sub(velocity, vec3Scale(normal, (1 + restitution) * normalVelocity));
  return reflection;
}

// Collision with friction
export function collisionResponseWithFriction(velocity, normal, restitution, friction) {
  const normalVelocity = vec3Dot(velocity, normal);
  if (normalVelocity >= 0) return velocity;

  // Normal component
  const vn = vec3Scale(normal, normalVelocity);
  // Tangent component
  const vt = vec3Sub(velocity, vn);
  const vtLen = vec3Length(vt);

  // Apply restitution to normal
  const vnNew = vec3Scale(normal, -restitution * normalVelocity);

  // Apply friction to tangent
  let vtNew;
  if (vtLen < EPSILON) {
    vtNew = [0, 0, 0];
  } else {
    const frictionImpulse = friction * Math.abs(normalVelocity) * (1 + restitution);
    const vtNewLen = Math.max(0, vtLen - frictionImpulse);
    vtNew = vec3Scale(vec3Normalize(vt), vtNewLen);
  }

  return vec3Add(vnNew, vtNew);
}

// ============================================================================
// CONSTRAINTS
// ============================================================================

// Distance constraint (keep two points at fixed distance)
export function distanceConstraint(p1, p2, targetDistance, stiffness = 1) {
  const delta = vec3Sub(p2, p1);
  const currentDistance = vec3Length(delta);
  if (currentDistance < EPSILON) return { dp1: [0, 0, 0], dp2: [0, 0, 0] };

  const error = currentDistance - targetDistance;
  const correction = vec3Scale(delta, (error / currentDistance) * stiffness * 0.5);

  return { dp1: correction, dp2: vec3Scale(correction, -1) };
}

// Distance constraint with masses
export function distanceConstraintMass(p1, m1, p2, m2, targetDistance, stiffness = 1) {
  const delta = vec3Sub(p2, p1);
  const currentDistance = vec3Length(delta);
  if (currentDistance < EPSILON) return { dp1: [0, 0, 0], dp2: [0, 0, 0] };

  const error = currentDistance - targetDistance;
  const totalMass = m1 + m2;
  const correction = vec3Scale(delta, (error / currentDistance) * stiffness);

  return {
    dp1: vec3Scale(correction, m2 / totalMass),
    dp2: vec3Scale(correction, -m1 / totalMass),
  };
}

// Point constraint (keep point at fixed position)
export function pointConstraint(position, target, stiffness = 1) {
  const delta = vec3Sub(target, position);
  return vec3Scale(delta, stiffness);
}

// Angle constraint (keep angle between three points)
export function angleConstraint(p1, p2, p3, targetAngle, stiffness = 1) {
  const v1 = vec3Normalize(vec3Sub(p1, p2));
  const v2 = vec3Normalize(vec3Sub(p3, p2));

  const currentAngle = Math.acos(clamp(vec3Dot(v1, v2), -1, 1));
  const error = currentAngle - targetAngle;

  const axis = vec3Normalize(vec3Cross(v1, v2));
  const correction = error * stiffness * 0.5;

  return {
    dp1: vec3Scale(vec3Cross(axis, v1), correction),
    dp3: vec3Scale(vec3Cross(axis, v2), -correction),
  };
}

// Collision constraint (keep objects separated)
export function collisionConstraint(p1, r1, p2, r2) {
  const delta = vec3Sub(p1, p2);
  const dist = vec3Length(delta);
  const minDist = r1 + r2;

  if (dist >= minDist || dist < EPSILON) return { dp1: [0, 0, 0], dp2: [0, 0, 0] };

  const overlap = minDist - dist;
  const normal = vec3Scale(delta, 1 / dist);
  const correction = vec3Scale(normal, overlap * 0.5);

  return { dp1: correction, dp2: vec3Scale(correction, -1) };
}

// ============================================================================
// VERLET INTEGRATION
// ============================================================================

// Position-based verlet particle
export function verletIntegrate(current, previous, acceleration, dt) {
  const dtSq = dt * dt;
  return vec3Add(
    vec3Sub(vec3Scale(current, 2), previous),
    vec3Scale(acceleration, dtSq)
  );
}

// Verlet with damping
export function verletIntegrateDamped(current, previous, acceleration, dt, damping = 0.99) {
  const velocity = vec3Scale(vec3Sub(current, previous), damping);
  return vec3Add(
    vec3Add(current, velocity),
    vec3Scale(acceleration, dt * dt)
  );
}

// Get velocity from verlet positions
export function verletVelocity(current, previous, dt) {
  return vec3Scale(vec3Sub(current, previous), 1 / dt);
}

// ============================================================================
// RIGID BODY UTILITIES
// ============================================================================

// Moment of inertia for common shapes (about center of mass)
export const inertiaBox = (mass, width, height, depth) => [
  (mass / 12) * (height * height + depth * depth),
  (mass / 12) * (width * width + depth * depth),
  (mass / 12) * (width * width + height * height),
];

export const inertiaSphere = (mass, radius) => {
  const i = (2 / 5) * mass * radius * radius;
  return [i, i, i];
};

export const inertiaSolidSphere = inertiaSphere;

export const inertiaHollowSphere = (mass, radius) => {
  const i = (2 / 3) * mass * radius * radius;
  return [i, i, i];
};

export const inertiaCylinder = (mass, radius, height) => {
  const iAxis = (1 / 2) * mass * radius * radius;
  const iPerp = (1 / 12) * mass * (3 * radius * radius + height * height);
  return [iPerp, iAxis, iPerp];
};

export const inertiaCapsule = (mass, radius, height) => {
  const cylinderMass = mass * height / (height + (4/3) * radius);
  const hemisphereMass = (mass - cylinderMass) / 2;

  const iCylinder = (1/12) * cylinderMass * (3 * radius * radius + height * height);
  const iHemisphere = (2/5) * hemisphereMass * radius * radius;

  return [
    iCylinder + 2 * iHemisphere,
    (1/2) * cylinderMass * radius * radius + (2/5) * 2 * hemisphereMass * radius * radius,
    iCylinder + 2 * iHemisphere,
  ];
};

export const inertiaCone = (mass, radius, height) => {
  const iAxis = (3 / 10) * mass * radius * radius;
  const iPerp = (3 / 5) * mass * (radius * radius / 4 + height * height);
  return [iPerp, iAxis, iPerp];
};

// Parallel axis theorem
export function parallelAxisTheorem(inertia, mass, offset) {
  const d2 = vec3LengthSq(offset);
  return [inertia[0] + mass * d2, inertia[1] + mass * d2, inertia[2] + mass * d2];
}

// ============================================================================
// ENERGY
// ============================================================================

export const kineticEnergy = (mass, velocity) => 0.5 * mass * vec3LengthSq(velocity);
export const potentialEnergyGravity = (mass, height, g = 9.81) => mass * g * height;
export const springPotentialEnergy = (stiffness, displacement) => 0.5 * stiffness * displacement * displacement;
export const rotationalKineticEnergy = (inertia, angularVelocity) => {
  if (typeof inertia === 'number') return 0.5 * inertia * vec3LengthSq(angularVelocity);
  return 0.5 * (inertia[0] * angularVelocity[0] ** 2 + inertia[1] * angularVelocity[1] ** 2 + inertia[2] * angularVelocity[2] ** 2);
};

// Total mechanical energy
export function totalMechanicalEnergy(mass, velocity, height, g = 9.81) {
  return kineticEnergy(mass, velocity) + potentialEnergyGravity(mass, height, g);
}

// ============================================================================
// MOMENTUM
// ============================================================================

export const linearMomentum = (mass, velocity) => vec3Scale(velocity, mass);
export const angularMomentum = (inertia, angularVelocity) => {
  if (typeof inertia === 'number') return vec3Scale(angularVelocity, inertia);
  return [inertia[0] * angularVelocity[0], inertia[1] * angularVelocity[1], inertia[2] * angularVelocity[2]];
};

// ============================================================================
// HIGHER-ORDER INTEGRATORS (Film-quality / Houdini parity)
// ============================================================================

// Runge-Kutta 2nd order (Midpoint method)
// accelerationFn(position, velocity, t) → [ax, ay, az]
export function rk2Integrate(position, velocity, accelerationFn, t, dt) {
  const a0 = accelerationFn(position, velocity, t);
  const midVel = vec3Add(velocity, vec3Scale(a0, dt * 0.5));
  const midPos = vec3Add(position, vec3Scale(velocity, dt * 0.5));
  const aMid = accelerationFn(midPos, midVel, t + dt * 0.5);
  return {
    position: vec3Add(position, vec3Scale(midVel, dt)),
    velocity: vec3Add(velocity, vec3Scale(aMid, dt)),
  };
}

// Runge-Kutta 4th order (standard for film-quality particle sims)
// accelerationFn(position, velocity, t) → [ax, ay, az]
export function rk4Integrate(position, velocity, accelerationFn, t, dt) {
  // k1: evaluate at current state
  const a1 = accelerationFn(position, velocity, t);
  const v1 = velocity;

  // k2: evaluate at midpoint using k1
  const p2 = vec3Add(position, vec3Scale(v1, dt * 0.5));
  const v2 = vec3Add(velocity, vec3Scale(a1, dt * 0.5));
  const a2 = accelerationFn(p2, v2, t + dt * 0.5);

  // k3: evaluate at midpoint using k2
  const p3 = vec3Add(position, vec3Scale(v2, dt * 0.5));
  const v3 = vec3Add(velocity, vec3Scale(a2, dt * 0.5));
  const a3 = accelerationFn(p3, v3, t + dt * 0.5);

  // k4: evaluate at end using k3
  const p4 = vec3Add(position, vec3Scale(v3, dt));
  const v4 = vec3Add(velocity, vec3Scale(a3, dt));
  const a4 = accelerationFn(p4, v4, t + dt);

  // Combine: (k1 + 2*k2 + 2*k3 + k4) / 6
  const newPosition = vec3Add(position, vec3Scale(
    vec3Add(vec3Add(v1, vec3Scale(v2, 2)), vec3Add(vec3Scale(v3, 2), v4)), dt / 6
  ));
  const newVelocity = vec3Add(velocity, vec3Scale(
    vec3Add(vec3Add(a1, vec3Scale(a2, 2)), vec3Add(vec3Scale(a3, 2), a4)), dt / 6
  ));

  return { position: newPosition, velocity: newVelocity };
}

// Adaptive RK4 with error estimation (Runge-Kutta-Fehlberg)
// Returns { position, velocity, error } — caller decides whether to accept step
export function rk4AdaptiveStep(position, velocity, accelerationFn, t, dt) {
  const full = rk4Integrate(position, velocity, accelerationFn, t, dt);
  const half1 = rk4Integrate(position, velocity, accelerationFn, t, dt * 0.5);
  const half2 = rk4Integrate(half1.position, half1.velocity, accelerationFn, t + dt * 0.5, dt * 0.5);
  const error = vec3Length(vec3Sub(full.position, half2.position));
  return { position: half2.position, velocity: half2.velocity, error };
}

// ============================================================================
// FORCE FIELD PRIMITIVES (CPU parity for GPU-only in ParticleSimWorld.js)
// ============================================================================

// Point attractor/repeller: pulls toward (strength > 0) or pushes from (strength < 0) a point
export function pointAttractorForce(position, attractorPos, strength, falloffRadius = 1) {
  const toAttractor = vec3Sub(attractorPos, position);
  const dist = vec3Length(toAttractor);
  if (dist < EPSILON) return [0, 0, 0];
  const falloff = Math.exp(-dist / Math.max(falloffRadius, EPSILON));
  return vec3Scale(vec3Scale(toAttractor, 1 / dist), strength * falloff);
}

// Point attractor with inverse-square falloff (more physically accurate)
export function pointAttractorForceInvSq(position, attractorPos, strength, minDist = 0.1) {
  const toAttractor = vec3Sub(attractorPos, position);
  const distSq = Math.max(vec3LengthSq(toAttractor), minDist * minDist);
  const dist = Math.sqrt(distSq);
  return vec3Scale(toAttractor, strength / (distSq * dist));
}

// Vortex force: spins particles around an axis (matches ParticleSimWorld.js GPU vortex)
export function vortexFieldForce(position, vortexPos, vortexAxis, strength, radius = 1) {
  const axis = vec3Normalize(vortexAxis);
  const toCenter = vec3Sub(position, vortexPos);
  const projected = vec3Sub(toCenter, vec3Scale(axis, vec3Dot(toCenter, axis)));
  const projDist = vec3Length(projected);
  if (projDist < EPSILON) return [0, 0, 0];
  const falloff = Math.exp(-projDist / Math.max(radius, EPSILON));
  const tangent = vec3Cross(axis, vec3Scale(projected, 1 / projDist));
  return vec3Scale(tangent, strength * falloff);
}

// Orbit force: centripetal + tangential for stable orbits around a point
export function orbitForce(position, centerPos, orbitSpeed, upAxis = [0, 1, 0]) {
  const toCenter = vec3Sub(centerPos, position);
  const dist = vec3Length(toCenter);
  if (dist < EPSILON) return [0, 0, 0];
  const dir = vec3Scale(toCenter, 1 / dist);
  const tangent = vec3Normalize(vec3Cross(upAxis, dir));
  const centripetal = vec3Scale(dir, orbitSpeed * orbitSpeed / dist);
  const tangentialForce = vec3Scale(tangent, orbitSpeed);
  return vec3Add(centripetal, tangentialForce);
}

// Wind force: velocity-relative drag toward a target wind velocity
export function windForce(velocity, windVelocity, sensitivity = 0.1) {
  return vec3Scale(vec3Sub(windVelocity, velocity), sensitivity);
}

// ============================================================================
// CONTINUOUS COLLISION DETECTION
// ============================================================================

// Time of impact for moving sphere vs static sphere
export function sphereSphereTimeOfImpact(p1, v1, r1, p2, r2) {
  const d = vec3Sub(p1, p2);
  const sumRadius = r1 + r2;

  const a = vec3LengthSq(v1);
  const b = 2 * vec3Dot(d, v1);
  const c = vec3LengthSq(d) - sumRadius * sumRadius;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrtD = Math.sqrt(discriminant);
  const t1 = (-b - sqrtD) / (2 * a);
  const t2 = (-b + sqrtD) / (2 * a);

  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return null;
}

// Time of impact for two moving spheres
export function sphereSphereMovingTOI(p1, v1, r1, p2, v2, r2) {
  const relVel = vec3Sub(v1, v2);
  return sphereSphereTimeOfImpact(p1, relVel, r1, p2, r2);
}

// Swept sphere vs plane
export function spherePlaneTimeOfImpact(center, velocity, radius, planeNormal, planeD) {
  const dist = vec3Dot(center, planeNormal) + planeD;
  const denom = vec3Dot(velocity, planeNormal);

  if (Math.abs(denom) < EPSILON) return null;

  const t = (radius - dist) / denom;
  if (t >= 0 && t <= 1) return t;
  return null;
}

// Swept sphere vs AABB
export function sphereAABBTimeOfImpact(center, velocity, radius, aabbMin, aabbMax) {
  // Expand AABB by sphere radius
  const expandedMin = [aabbMin[0] - radius, aabbMin[1] - radius, aabbMin[2] - radius];
  const expandedMax = [aabbMax[0] + radius, aabbMax[1] + radius, aabbMax[2] + radius];

  // Ray-AABB intersection
  const invDir = [1 / velocity[0], 1 / velocity[1], 1 / velocity[2]];
  const t1 = (expandedMin[0] - center[0]) * invDir[0];
  const t2 = (expandedMax[0] - center[0]) * invDir[0];
  const t3 = (expandedMin[1] - center[1]) * invDir[1];
  const t4 = (expandedMax[1] - center[1]) * invDir[1];
  const t5 = (expandedMin[2] - center[2]) * invDir[2];
  const t6 = (expandedMax[2] - center[2]) * invDir[2];

  const tmin = Math.max(Math.max(Math.min(t1, t2), Math.min(t3, t4)), Math.min(t5, t6));
  const tmax = Math.min(Math.min(Math.max(t1, t2), Math.max(t3, t4)), Math.max(t5, t6));

  if (tmax < 0 || tmin > tmax || tmin > 1) return null;
  return tmin < 0 ? 0 : tmin;
}

// ============================================================================
// UTILITY
// ============================================================================

// Clamp velocity to max speed
export function clampVelocity(velocity, maxSpeed) {
  const speed = vec3Length(velocity);
  if (speed > maxSpeed) {
    return vec3Scale(velocity, maxSpeed / speed);
  }
  return velocity;
}

// Apply drag coefficient
export function applyDrag(velocity, drag, dt) {
  const factor = Math.pow(1 - drag, dt);
  return vec3Scale(velocity, factor);
}

// Separate overlapping spheres
export function separateSpheres(p1, r1, p2, r2) {
  const delta = vec3Sub(p1, p2);
  const dist = vec3Length(delta);
  const overlap = r1 + r2 - dist;

  if (overlap <= 0 || dist < EPSILON) return { p1, p2 };

  const normal = vec3Scale(delta, 1 / dist);
  const separation = vec3Scale(normal, overlap * 0.5);

  return {
    p1: vec3Add(p1, separation),
    p2: vec3Sub(p2, separation),
  };
}
