// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'metal_clang',
  ambientLoop: null,
  collisionSound: 'metal_ping',
  volume: 0.7,
  pitchRange: [0.8, 1.2],
  proceduralPatch: 'modal_impact_metal',
  paramMap: {
    avgVelocity: { target: 'metal.impactGain', scale: 0.11, offset: 0.26 },
    temperature: { target: 'metal.brightness', scale: 0.0005, offset: 0.95 },
    emitRate:    { target: 'metal.ringTime',   scale: 0.02, offset: 0.82 },
  },
};
