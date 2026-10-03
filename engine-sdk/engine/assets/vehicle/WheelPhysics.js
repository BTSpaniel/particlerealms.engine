// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/vehicle/WheelPhysics.js — suspension, tire slip, and the visual
// wheel transform chain (spec §11). Deterministic CPU model used for the
// inspector/demo and gates; production deployments route the same WheelSlot data
// into the engine's GPUVehicle. Wheel visuals FOLLOW physics state:
//   chassisWorld · socket · suspension · steer · spin · meshCorrection.

import { composeTRS, quatFromAxisAngle, multiply } from './VehicleMath.js';
import { vec3Scale } from '../../core/math/MathVec3.js';

/**
 * Suspension spring + damper force.
 *   compression   = restLength - currentLength
 *   springForce   = stiffness * compression
 *   damperForce   = damping  * compressionVelocity
 *   normalLoad    = max(0, springForce + damperForce)
 * @returns {{ compression:number, springForce:number, damperForce:number, suspensionForce:number, normalLoad:number }}
 */
export function suspensionForce({ restLength, currentLength, stiffness, damping, compressionVelocity = 0 }) {
  const compression = restLength - currentLength;
  const springForce = stiffness * compression;
  const damperForce = damping * compressionVelocity;
  const suspensionForce = springForce + damperForce;
  return { compression, springForce, damperForce, suspensionForce, normalLoad: Math.max(0, suspensionForce) };
}

/**
 * A slip-based tire force (Pacejka-lite): linear near zero slip, saturating at
 * the friction limit `normalLoad * grip`. `slipStiffness` shapes the knee.
 */
export function tireForce(slip, normalLoad, grip, slipStiffness = 12) {
  return normalLoad * grip * Math.tanh(slipStiffness * slip);
}

/** Longitudinal slip ratio from wheel surface speed vs ground speed. */
export function longitudinalSlip(wheelAngularVel, radius, groundSpeed) {
  const wheelSurface = wheelAngularVel * radius;
  const denom = Math.max(Math.abs(groundSpeed), 1e-3);
  return (wheelSurface - groundSpeed) / denom;
}

/** Free-rolling angular velocity (rad/s) for a given ground speed. */
export function freeRollAngularVelocity(groundSpeed, radius) {
  return groundSpeed / Math.max(radius, 1e-3);
}

/**
 * Compose the visual world matrix for a wheel from chassis world + slot + state.
 * @param {Float32Array} chassisWorld column-major 4x4
 * @param {object} slot WheelSlot
 * @param {object} state { suspensionOffset, steerAngle, spinAngle }
 * @returns {Float32Array} column-major 4x4
 */
export function visualWheelMatrix(chassisWorld, slot, state = {}) {
  const suspensionOffset = state.suspensionOffset ?? 0;
  const steerAngle = state.steerAngle ?? 0;
  const spinAngle = state.spinAngle ?? 0;

  const socket = composeTRS(slot.localCenter, [0, 0, 0, 1], 1);
  const axis = slot.suspensionAxisLocal;
  const suspension = composeTRS(vec3Scale(axis, suspensionOffset), [0, 0, 0, 1], 1);
  const steer = composeTRS([0, 0, 0], quatFromAxisAngle(slot.steerAxisLocal, steerAngle), 1);
  const spin = composeTRS([0, 0, 0], quatFromAxisAngle(slot.axleAxisLocal, spinAngle), 1);
  const mesh = composeTRS([0, 0, 0], slot.meshCorrectionRotation, 1);

  // chassisWorld * socket * suspension * steer * spin * mesh
  return multiply(chassisWorld, multiply(socket, multiply(suspension, multiply(steer, multiply(spin, mesh)))));
}

/** Advance a wheel's spin angle from a ground speed (visual integration). */
export function advanceSpin(spinAngle, groundSpeed, radius, dt) {
  return spinAngle + freeRollAngularVelocity(groundSpeed, radius) * dt;
}
