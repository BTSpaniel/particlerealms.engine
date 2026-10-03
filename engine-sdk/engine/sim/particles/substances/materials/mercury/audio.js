// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'mercury_splat',
  ambientLoop: null,
  collisionSound: 'mercury_pool',
  volume: 0.4,
  pitchRange: [0.8, 1.0],
  proceduralPatch: 'drop',
  paramMap: {
    avgVelocity: { target: 'drop.amplitude',    scale: 0.1, offset: 0.22 },
    emitRate:    { target: 'drop.rate',         scale: 0.18, offset: 0.5 },
    temperature: { target: 'drop.decay',        scale: 0.00035, offset: 0.2 },
    density:     { target: 'drop.bodyResonance', scale: 0.5, offset: 90 },
  },
};
