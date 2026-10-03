// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { quatRotateVec3 } from '../../core/math/MathQuat.js';

const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Dissipative normal contact between SPH volumes and native rigid shapes.
 * Call after a fixed fluid/rigid step, then publish velocities to PhysX.
 * This is contact coupling, not a hydrodynamic boundary-density formulation.
 * Static axis-aligned floors may set oneSidedTop to retain their upper half-space
 * through a rigid overlap repair. Ordinary boxes remain two-sided.
 */
export function coupleFluidRigidContacts(particles, shapes, radius, module) {
    const states = new Map();
    // Reject distant shapes before allocating local-space vectors. Rotated boxes
    // require |R| * (halfExtents + contact radius), matching the narrow-phase
    // expanded local box even at rotated corners.
    const prepared = shapes.map(shape => {
        const q = shape.rotation;
        const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(axis => quatRotateVec3(axis, q));
        return { shape, inverse: [-q[0], -q[1], -q[2], q[3]],
            extent: [0, 1, 2].map(i => shape.radius ? radius + shape.radius
                : axes.reduce((sum, axis, k) => sum + Math.abs(axis[i]) * (shape.halfExtents[k] + radius), 0)) };
    });
    let contacts = 0, impulseMagnitude = 0;
    const fluidImpulse = [0, 0, 0], bodyImpulse = [0, 0, 0], supportImpulse = [0, 0, 0];
    const vector = new module.PxVec3(0, 0, 0);
    try {
        for (const shape of shapes) {
            const body = shape.body;
            if (states.has(body)) continue;
            const dynamic = body.simMode !== 'static';
            const inertia = dynamic ? body._actor.getMassSpaceInertiaTensor() : null;
            states.set(body, {
                dynamic, inverseMass: dynamic ? 1 / body.mass : 0,
                velocity: [...body.linearVelocity], angular: [...body.angularVelocity],
                inertia: inertia ? [inertia.x, inertia.y, inertia.z] : [Infinity, Infinity, Infinity],
            });
            // WebIDL wraps borrowed return-value storage, not an owned allocation.
        }
        for (const particle of particles) for (const { shape, inverse, extent } of prepared) {
            const point = particle.positionM, center = shape.position;
            if (Math.abs(point[0] - center[0]) > extent[0]
                || (shape.oneSidedTop ? point[1] - center[1] > extent[1] : Math.abs(point[1] - center[1]) > extent[1])
                || Math.abs(point[2] - center[2]) > extent[2]) continue;
            const body = shape.body, state = states.get(body);
            const rotation = shape.rotation;
            const delta = particle.positionM.map((n, i) => n - shape.position[i]);
            let normal, penetration;
            if (shape.oneSidedTop) {
                // Closed axis-aligned reservoir floors must keep water above them
                // even if a rigid overlap repair crossed the slab's mid-plane.
                normal = [0, 1, 0]; penetration = radius + shape.halfExtents[1] - delta[1];
            } else if (shape.radius) {
                const length = Math.hypot(...delta);
                penetration = radius + shape.radius - length;
                normal = length > 1e-9 ? delta.map(n => n / length) : [0, 1, 0];
            } else {
                const local = quatRotateVec3(delta, inverse);
                const gap = local.map((n, i) => Math.abs(n) - shape.halfExtents[i] - radius);
                if (gap.some(n => n >= 0)) continue;
                const axis = gap.indexOf(Math.max(...gap));
                const localNormal = [0, 0, 0]; localNormal[axis] = local[axis] >= 0 ? 1 : -1;
                normal = quatRotateVec3(localNormal, rotation); penetration = -gap[axis];
            }
            if (penetration <= 0) continue;
            contacts++;
            const arm = particle.positionM.map((n, i) => n - normal[i] * radius - body.position[i]);
            const spin = cross(state.angular, arm);
            const relative = particle.velocityMPerS.map((n, i) => n - state.velocity[i] - spin[i]);
            const approach = dot(relative, normal);
            // Position repair never turns overlap into a launch impulse.
            particle.positionM = particle.positionM.map((n, i) => n + normal[i] * penetration);
            if (approach >= 0) continue;
            const torqueAxis = cross(arm, normal);
            const inverseBodyRotation = [-body.rotation[0], -body.rotation[1], -body.rotation[2], body.rotation[3]];
            const localTorque = quatRotateVec3(torqueAxis, inverseBodyRotation);
            const inverseInertiaTorque = quatRotateVec3(localTorque.map((n, i) => n / state.inertia[i]), body.rotation);
            const effective = 1 / particle.massKg + state.inverseMass + dot(torqueAxis, inverseInertiaTorque);
            const impulse = -approach / effective;
            impulseMagnitude += impulse;
            for (let axis = 0; axis < 3; axis++) {
                const value = impulse * normal[axis];
                particle.velocityMPerS[axis] += value / particle.massKg;
                state.velocity[axis] -= value * state.inverseMass;
                state.angular[axis] -= impulse * inverseInertiaTorque[axis];
                fluidImpulse[axis] += value;
                (state.dynamic ? bodyImpulse : supportImpulse)[axis] -= value;
            }
        }
        for (const [body, state] of states) if (state.dynamic) {
            vector.set_x(state.velocity[0]); vector.set_y(state.velocity[1]); vector.set_z(state.velocity[2]);
            body._actor.setLinearVelocity(vector, true);
            vector.set_x(state.angular[0]); vector.set_y(state.angular[1]); vector.set_z(state.angular[2]);
            body._actor.setAngularVelocity(vector, true);
            body.linearVelocity = state.velocity; body.angularVelocity = state.angular;
        }
    } finally { module.destroy(vector); }
    return { contacts, impulseMagnitude, fluidImpulse, bodyImpulse, supportImpulse,
        momentumResidual: Math.hypot(...fluidImpulse.map((n, i) => n + bodyImpulse[i] + supportImpulse[i])) };
}
