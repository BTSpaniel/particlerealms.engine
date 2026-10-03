// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'honey_splat',
  ambientLoop: null,
  collisionSound: 'honey_drip',
  volume: 0.3,
  pitchRange: [0.85, 1.05],
  proceduralPatch: 'drop',
  paramMap: {
    avgVelocity: { target: 'drop.amplitude',    scale: 0.07, offset: 0.12 },
    emitRate:    { target: 'drop.rate',         scale: 0.11, offset: 0.35 },
    temperature: { target: 'drop.decay',        scale: 0.00065, offset: 0.25 },
    density:     { target: 'drop.bodyResonance', scale: 0.3, offset: 55 },
  },
};
