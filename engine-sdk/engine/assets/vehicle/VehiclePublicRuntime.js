// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// This is intentionally the public compatibility facade. Production asset code
// must not import protected vehicle implementation modules.
import { createPhysXVehicle, isPhysXVehicleSupported } from '../../sim/physics/PhysXVehicle.js';
import { vehicleProfileToPhysXOptions } from './VehicleBasisAdapter.js';

export const VEHICLE_PUBLIC_RUNTIME_CAPABILITY = 'vehicle.public-physx-facade-v1';
export const VEHICLE_PUBLIC_DRIVETRAIN_CAPABILITY = 'vehicle.public-physx-differential-ratios-v1';

const DIFFERENTIAL_METHODS = Object.freeze([
  'get_torqueRatios', 'set_torqueRatios',
  'get_aveWheelSpeedRatios', 'set_aveWheelSpeedRatios',
  'get_frontWheelIds', 'set_frontWheelIds',
  'get_rearWheelIds', 'set_rearWheelIds',
  'get_frontBias', 'set_frontBias',
  'get_rearBias', 'set_rearBias',
  'get_centerBias', 'set_centerBias',
  'get_rate', 'set_rate',
  'isValid',
]);

function unavailable(code, reason, driveMode = null) {
  return Object.freeze({
    supported: false,
    exact: false,
    capability: VEHICLE_PUBLIC_RUNTIME_CAPABILITY,
    drivetrainCapability: VEHICLE_PUBLIC_DRIVETRAIN_CAPABILITY,
    code,
    reason,
    ...(driveMode == null ? {} : { driveMode }),
  });
}

function differentialSurfaceAvailable(surface) {
  return surface != null && DIFFERENTIAL_METHODS.every(method => typeof surface[method] === 'function');
}

function exactReceipt(driveMode, ratios) {
  return Object.freeze({
    supported: true,
    exact: true,
    capability: VEHICLE_PUBLIC_RUNTIME_CAPABILITY,
    drivetrainCapability: VEHICLE_PUBLIC_DRIVETRAIN_CAPABILITY,
    driveMode,
    ratios,
  });
}

/** Fail-closed inspection of the WebIDL ratio surface used by Vehicle2. */
export function inspectPublicVehicleDrivetrain(world, driveMode) {
  const options = vehicleProfileToPhysXOptions({ driveMode });
  if (!options.exactDrivetrain || options.drivetrainRatios == null) {
    return unavailable(
      'RF_VEHICLE_DRIVETRAIN_MODE_UNSUPPORTED',
      `The public Vehicle2 runtime cannot represent authored '${options.authoredDriveMode}'.`,
      options.authoredDriveMode,
    );
  }
  const type = world?.module?.PxVehicleFourWheelDriveDifferentialParams;
  const surface = type?.prototype ?? type;
  if (!differentialSurfaceAvailable(surface)) {
    return unavailable(
      'RF_VEHICLE_DRIVETRAIN_RATIO_API_UNAVAILABLE',
      'The public Vehicle2 differential ratio and validation surface is incomplete.',
      options.authoredDriveMode,
    );
  }
  return exactReceipt(options.authoredDriveMode, options.drivetrainRatios);
}

function ratioReadbackMatches(differential, ratios) {
  const epsilon = 1e-7;
  for (let wheel = 0; wheel < 4; wheel++) {
    if (Math.abs(differential.get_torqueRatios(wheel) - ratios.torque[wheel]) > epsilon) return false;
    if (Math.abs(differential.get_aveWheelSpeedRatios(wheel)
      - ratios.averageWheelSpeed[wheel]) > epsilon) return false;
  }
  return differential.get_frontWheelIds(0) === 0
    && differential.get_frontWheelIds(1) === 1
    && differential.get_rearWheelIds(0) === 2
    && differential.get_rearWheelIds(1) === 3
    && differential.get_frontBias() === 0
    && differential.get_rearBias() === 0
    && differential.get_centerBias() === 0
    && differential.get_rate() === 0;
}

/**
 * Configure the live four-wheel differential as an exact open FWD, RWD, or
 * AWD differential. Zero-ratio wheels receive no drive torque and do not
 * contribute to clutch speed, as defined by the public Vehicle2 contract.
 */
export function configurePublicVehicleDrivetrain(controller, driveMode) {
  const options = vehicleProfileToPhysXOptions({ driveMode });
  const ratios = options.drivetrainRatios;
  if (ratios == null) {
    return unavailable(
      'RF_VEHICLE_DRIVETRAIN_MODE_UNSUPPORTED',
      `The public Vehicle2 runtime cannot represent authored '${options.authoredDriveMode}'.`,
      options.authoredDriveMode,
    );
  }
  const vehicle = controller?.vehicle;
  const differential = vehicle?.engineDriveParams?.fourWheelDifferentialParams;
  const axleDescription = vehicle?.baseParams?.axleDescription;
  if (!differentialSurfaceAvailable(differential) || axleDescription == null) {
    return unavailable(
      'RF_VEHICLE_DRIVETRAIN_RATIO_API_UNAVAILABLE',
      'The created Vehicle2 controller does not expose a complete differential ratio and axle-validation surface.',
      options.authoredDriveMode,
    );
  }

  try {
    differential.set_frontWheelIds(0, 0);
    differential.set_frontWheelIds(1, 1);
    differential.set_rearWheelIds(0, 2);
    differential.set_rearWheelIds(1, 3);
    differential.set_frontBias(0);
    differential.set_rearBias(0);
    differential.set_centerBias(0);
    differential.set_rate(0);
    for (let wheel = 0; wheel < 4; wheel++) {
      differential.set_torqueRatios(wheel, ratios.torque[wheel]);
      differential.set_aveWheelSpeedRatios(wheel, ratios.averageWheelSpeed[wheel]);
    }
    if (!ratioReadbackMatches(differential, ratios) || !differential.isValid(axleDescription)) {
      return unavailable(
        'RF_VEHICLE_DRIVETRAIN_CONFIGURATION_REJECTED',
        `Vehicle2 rejected the authored '${options.authoredDriveMode}' differential ratios.`,
        options.authoredDriveMode,
      );
    }
  } catch (error) {
    const detail = String(error?.message ?? error).slice(0, 240);
    return unavailable(
      'RF_VEHICLE_DRIVETRAIN_CONFIGURATION_FAILED',
      `Vehicle2 differential configuration failed: ${detail}`,
      options.authoredDriveMode,
    );
  }
  return exactReceipt(options.authoredDriveMode, ratios);
}

export function inspectPublicVehicleRuntime(world, profile) {
  if (!world?.ready || !isPhysXVehicleSupported(world)) {
    return unavailable(
      'RF_VEHICLE_RUNTIME_UNAVAILABLE',
      'The public PhysX Vehicle2 facade is not available in this runtime.',
    );
  }
  const options = vehicleProfileToPhysXOptions(profile);
  return inspectPublicVehicleDrivetrain(world, options.authoredDriveMode);
}

/** Create an exact runtime or return an honest unavailable receipt. */
export function createPublicVehicleRuntime(world, profile, options = {}) {
  const readiness = inspectPublicVehicleRuntime(world, profile);
  if (!readiness.supported) {
    return Object.freeze({ controller: null, readiness });
  }
  const physxOptions = vehicleProfileToPhysXOptions(profile, options);
  const controller = createPhysXVehicle(world, physxOptions);
  if (controller == null) {
    return Object.freeze({
      controller: null,
      readiness: unavailable(
        'RF_VEHICLE_RUNTIME_CREATE_FAILED',
        'The public PhysX Vehicle2 facade could not create the vehicle controller.',
        physxOptions.authoredDriveMode,
      ),
      options: physxOptions,
    });
  }
  const configured = configurePublicVehicleDrivetrain(controller, physxOptions.authoredDriveMode);
  if (!configured.supported || !configured.exact) {
    controller.destroy?.();
    return Object.freeze({ controller: null, readiness: configured, options: physxOptions });
  }
  return Object.freeze({
    controller,
    readiness: configured,
    options: physxOptions,
  });
}
