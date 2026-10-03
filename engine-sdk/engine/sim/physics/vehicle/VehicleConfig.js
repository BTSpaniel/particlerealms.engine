// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function resolveVehicleConfig(options = {}) {
  const chassisDims = [...(options.chassisDims || [4.5, 1.4, 1.8])];
  const wheelBase = options.wheelBase ?? 2.8;
  const track = options.track ?? 1.6;
  const attachY = -chassisDims[1] * 0.25;
  return {
    chassisDims,
    mass: options.mass ?? 1500,
    wheelBase,
    track,
    wheelRadius: options.wheelRadius ?? 0.35,
    wheelWidth: options.wheelWidth ?? 0.3,
    wheelMass: options.wheelMass ?? 25,
    maxSteerRad: options.maxSteerRad ?? 0.55,
    peakTorque: options.peakTorque ?? 500,
    suspensionTravel: options.suspensionTravel ?? 0.25,
    suspensionFreqHz: options.suspensionFreqHz ?? 1.5,
    position: [...(options.position || [0, 0, 0])],
    yaw: options.yaw ?? 0,
    wheelOffsets: [
      [wheelBase / 2, attachY, track / 2],
      [wheelBase / 2, attachY, -track / 2],
      [-wheelBase / 2, attachY, track / 2],
      [-wheelBase / 2, attachY, -track / 2],
    ],
  };
}

export function arrayAt(owner, field, index) {
  if (typeof owner[`get_${field}`] === 'function') return owner[`get_${field}`](index);
  if (owner[field]?.at) return owner[field].at(index);
  return owner[field][index];
}
