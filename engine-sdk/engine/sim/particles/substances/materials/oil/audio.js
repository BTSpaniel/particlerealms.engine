// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'oil_splat',
  ambientLoop: null,
  collisionSound: 'oil_drip',
  volume: 0.4,
  pitchRange: [0.85, 1.05],
  proceduralPatch: 'drop',
  paramMap: {
    avgVelocity: { target: 'drop.amplitude',    scale: 0.12, offset: 0.18 },
    emitRate:    { target: 'drop.rate',         scale: 0.24, offset: 0.7 },
    temperature: { target: 'drop.decay',        scale: 0.00045, offset: 0.19 },
    density:     { target: 'drop.bodyResonance', scale: 0.45, offset: 70 },
  },
};
