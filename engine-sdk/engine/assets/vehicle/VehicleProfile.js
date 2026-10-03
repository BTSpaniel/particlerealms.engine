// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Canonical vehicle authoring space: metres, +Y up, +Z forward, +X left. */
export const VEHICLE_AUTHORING_BASIS = Object.freeze({
  id: 'engine.vehicle-basis.y-up-z-forward-v1',
  upAxis: '+Y',
  forwardAxis: '+Z',
  lateralAxis: '+X',
});

export const VEHICLE_PROFILE_SCHEMA = 'engine.vehicle-profile';
export const VEHICLE_PROFILE_VERSION = '1.0.0';

const DRIVE_MODES = new Set(['none', 'front-wheel', 'rear-wheel', 'all-wheel']);
const DEFAULT_MAX_STEER = Math.PI / 4.4;

function finite(value, fallback) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function positive(value, fallback, minimum) {
  return Math.max(minimum, finite(value, fallback));
}

function driveMode(value, fallback = 'front-wheel') {
  const result = String(value ?? fallback);
  if (!DRIVE_MODES.has(result)) throw new TypeError(`Unsupported vehicle drive mode '${result}'`);
  return result;
}

/** Stable key shared by render pools, simulation projections, and receipts. */
export function vehicleProfileKey(profile) {
  return [
    profile.id,
    profile.length,
    profile.width,
    profile.height,
    profile.wheelBase,
    profile.track,
    profile.wheelRadius,
    profile.wheelWidth,
    profile.mass,
    profile.driveMode,
    profile.peakTorque,
  ].map(value => typeof value === 'number' ? value.toFixed(4) : String(value)).join(':');
}

/**
 * Resolve one immutable visual/physical profile. Legacy `wheelbaseMeters`,
 * `massKilograms`, and `peakTorqueNewtonMeters` spellings are accepted at the
 * boundary so importers and RealmForge contracts can share the same authority.
 */
export function resolveVehicleProfile(type = {}, overrides = {}) {
  const length = positive(overrides.length ?? overrides.lengthMeters ?? type.length ?? type.lengthMeters, 4.5, 0.5);
  const width = positive(overrides.width ?? overrides.widthMeters ?? type.width ?? type.widthMeters, 1.8, 0.25);
  const height = positive(overrides.height ?? overrides.heightMeters ?? type.height ?? type.heightMeters, 1.3, 0.25);
  const wheelRadius = positive(overrides.wheelRadius ?? overrides.wheelRadiusMeters
    ?? type.wheelRadius ?? type.wheelRadiusMeters, 0.32, 0.03);
  const wheelWidth = positive(overrides.wheelWidth ?? overrides.wheelWidthMeters
    ?? type.wheelWidth ?? type.wheelWidthMeters, 0.22, 0.01);
  const wheelBase = Math.min(
    Math.max(0.25, length - wheelRadius * 2),
    positive(overrides.wheelBase ?? overrides.wheelbaseMeters ?? type.wheelBase ?? type.wheelbaseMeters, 2.7, 0.25),
  );
  const track = Math.min(
    Math.max(0.2, width - wheelWidth),
    positive(overrides.track ?? overrides.trackMeters ?? type.track ?? type.trackMeters, 1.55, 0.2),
  );
  const mass = positive(overrides.mass ?? overrides.massKilograms
    ?? type.mass ?? type.massKilograms, 1400, 1);
  const peakTorque = positive(overrides.peakTorque ?? overrides.peakTorqueNewtonMeters
    ?? type.peakTorque ?? type.peakTorqueNewtonMeters, 330, 1);
  const maxSteerRad = Math.min(
    Math.PI / 2,
    positive(overrides.maxSteerRad ?? overrides.maxSteeringAngle
      ?? type.maxSteerRad ?? type.maxSteeringAngle, DEFAULT_MAX_STEER, 0.01),
  );
  const profile = {
    schema: VEHICLE_PROFILE_SCHEMA,
    schemaVersion: VEHICLE_PROFILE_VERSION,
    id: String(overrides.id ?? type.id ?? 'vehicle'),
    length,
    width,
    height,
    wheelBase,
    track,
    wheelRadius,
    wheelWidth,
    mass,
    driveMode: driveMode(overrides.driveMode ?? type.driveMode),
    peakTorque,
    maxSteerRad,
    authoringBasis: VEHICLE_AUTHORING_BASIS,
    // The public PhysX facade is +X-forward and names dimensions L/H/W.
    chassisDims: Object.freeze([length, height, width]),
  };
  profile.key = vehicleProfileKey(profile);
  return Object.freeze(profile);
}

/** Production Sedan 2.0 profile. Values are SI and intentionally exact. */
export const SEDAN_2_PROFILE = resolveVehicleProfile({
  id: 'sedan-2.0.0',
  length: 4.5,
  width: 1.8,
  height: 1.3,
  wheelBase: 2.7,
  track: 1.55,
  wheelRadius: 0.32,
  wheelWidth: 0.22,
  mass: 1400,
  driveMode: 'front-wheel',
  peakTorque: 330,
});

// Compatibility aliases for the original Car Drive import surface.
export const DEFAULT_CAR_PROFILE = SEDAN_2_PROFILE;
export const resolveCarProfile = resolveVehicleProfile;
export const carProfileKey = vehicleProfileKey;
