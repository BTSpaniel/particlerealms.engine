// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function configureVehicleEngine(vehicle, config) {
  const engine = vehicle.engineDriveParams.engineParams;
  engine.torqueCurve.clear();
  engine.torqueCurve.addPair(0.0, 0.72);
  engine.torqueCurve.addPair(0.22, 1.0);
  engine.torqueCurve.addPair(0.62, 0.94);
  engine.torqueCurve.addPair(1.0, 0.74);
  engine.peakTorque = config.peakTorque;
  engine.moi = 1;
  engine.idleOmega = 30;
  engine.maxOmega = 600;
  engine.dampingRateFullThrottle = 0.15;
  engine.dampingRateZeroThrottleClutchEngaged = 2.0;
  engine.dampingRateZeroThrottleClutchDisengaged = 0.35;
}
