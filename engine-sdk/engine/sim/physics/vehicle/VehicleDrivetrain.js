// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const GEAR_RATIOS = [-4.0, 0.0, 4.0, 2.0, 1.5, 1.1, 1.0];

export function configureVehicleDrivetrain(PhysX, vehicle) {
  const drive = vehicle.engineDriveParams;
  const gearbox = drive.gearBoxParams;
  gearbox.nbRatios = GEAR_RATIOS.length;
  for (let index = 0; index < GEAR_RATIOS.length; index++) gearbox.set_ratios(index, GEAR_RATIOS[index]);
  gearbox.neutralGear = 1;
  gearbox.finalRatio = 4.0;
  gearbox.switchTime = 0.35;

  const autobox = drive.autoboxParams;
  for (let index = 0; index < GEAR_RATIOS.length; index++) {
    autobox.set_upRatios(index, 0.65);
    autobox.set_downRatios(index, 0.5);
  }
  autobox.latency = 2.0;

  drive.clutchCommandResponseParams.maxResponse = 10;
  drive.clutchParams.accuracyMode = PhysX.PxVehicleClutchAccuracyModeEnum.eESTIMATE;
  drive.clutchParams.estimateIterations = 5;

  const differential = drive.fourWheelDifferentialParams;
  differential.setToDefault();
  for (let wheel = 0; wheel < 4; wheel++) {
    differential.set_torqueRatios(wheel, 0.25);
    differential.set_aveWheelSpeedRatios(wheel, 0.25);
  }
  differential.set_frontWheelIds(0, 0);
  differential.set_frontWheelIds(1, 1);
  differential.set_rearWheelIds(0, 2);
  differential.set_rearWheelIds(1, 3);

  return {
    automatic: PhysX.eAUTOMATIC_GEAR ?? 255,
    reverse: PhysX.eREVERSE ?? 0,
    neutral: gearbox.neutralGear,
  };
}
