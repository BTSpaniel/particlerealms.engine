// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'wax_thud',
  ambientLoop: null,
  collisionSound: 'wax_squish',
  volume: 0.3,
  pitchRange: [0.9, 1.1],
  proceduralPatch: 'drop',
  paramMap: {
    temperature: { target: 'drop.decay',        scale: 0.0004, offset: 0.23 },
    avgVelocity: { target: 'drop.amplitude',    scale: 0.08, offset: 0.11 },
    emitRate:    { target: 'drop.rate',         scale: 0.12, offset: 0.4 },
    density:     { target: 'drop.bodyResonance', scale: 0.28, offset: 50 },
  },
};
