// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveVehicleProfile, VEHICLE_AUTHORING_BASIS } from './VehicleProfile.js';

export const VEHICLE_PHYSX_BASIS = Object.freeze({
  id: 'physx.vehicle2.x-forward-v1',
  upAxis: '+Y',
  forwardAxis: '+X',
  lateralAxis: '+Z',
});

export const VEHICLE_BASIS_ADAPTER = Object.freeze({
  id: 'engine.vehicle-basis.z-forward-to-x-forward-v1',
  source: VEHICLE_AUTHORING_BASIS,
  target: VEHICLE_PHYSX_BASIS,
  localYawRadians: -Math.PI / 2,
});

const VEHICLE_DRIVETRAIN_RATIOS = Object.freeze({
  'front-wheel': Object.freeze({
    torque: Object.freeze([0.5, 0.5, 0, 0]),
    averageWheelSpeed: Object.freeze([0.5, 0.5, 0, 0]),
  }),
  'rear-wheel': Object.freeze({
    torque: Object.freeze([0, 0, 0.5, 0.5]),
    averageWheelSpeed: Object.freeze([0, 0, 0.5, 0.5]),
  }),
  'all-wheel': Object.freeze({
    torque: Object.freeze([0.25, 0.25, 0.25, 0.25]),
    averageWheelSpeed: Object.freeze([0.25, 0.25, 0.25, 0.25]),
  }),
});

/**
 * PhysX Vehicle2's multi-wheel differential represents FWD, RWD, and AWD by
 * assigning zero torque and clutch-speed contribution to disconnected wheels.
 */
export function vehicleDrivetrainRatios(driveMode) {
  return VEHICLE_DRIVETRAIN_RATIOS[String(driveMode)] ?? null;
}

/** Convert a semantic +Z-forward heading to PhysX Vehicle2 +X-forward yaw. */
export function vehicleHeadingToPhysXYaw(heading) {
  const value = Number(heading);
  if (!Number.isFinite(value)) throw new TypeError('Vehicle heading must be finite');
  return -value;
}

/**
 * Project a semantic profile to the public PhysXVehicle option surface. The
 * public runtime verifies and applies these ratios against the live Vehicle2
 * differential before it reports exact drivetrain readiness.
 */
export function vehicleProfileToPhysXOptions(profile, overrides = {}) {
  const resolved = resolveVehicleProfile(profile, overrides);
  const drivetrainRatios = vehicleDrivetrainRatios(resolved.driveMode);
  return Object.freeze({
    position: Object.freeze([...(overrides.position ?? [0, 0, 0])]),
    yaw: vehicleHeadingToPhysXYaw(overrides.heading ?? 0),
    chassisDims: resolved.chassisDims,
    mass: resolved.mass,
    wheelBase: resolved.wheelBase,
    track: resolved.track,
    wheelRadius: resolved.wheelRadius,
    wheelWidth: resolved.wheelWidth,
    maxSteerRad: resolved.maxSteerRad,
    peakTorque: resolved.peakTorque,
    authoredDriveMode: resolved.driveMode,
    runtimeDriveMode: drivetrainRatios == null ? null : resolved.driveMode,
    exactDrivetrain: drivetrainRatios != null,
    drivetrainRatios,
    basisAdapterId: VEHICLE_BASIS_ADAPTER.id,
  });
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      out[column * 4 + row] = a[row] * b[column * 4]
        + a[4 + row] * b[column * 4 + 1]
        + a[8 + row] * b[column * 4 + 2]
        + a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function rotationX(angle) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotationY(angle) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  return new Float32Array([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]);
}

function rotationZ(angle) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** World matrix for a +Z-authored model driven by an existing +X heading. */
export function composeXForwardVehicleWorld(position, heading, pitch = 0, roll = 0) {
  const world = multiply(rotationY(heading - Math.PI / 2), multiply(rotationZ(roll), rotationX(pitch)));
  world[12] = position[0];
  world[13] = position[1];
  world[14] = position[2];
  return world;
}
