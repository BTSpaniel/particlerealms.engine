// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'blood_splat',
  ambientLoop: null,
  collisionSound: 'blood_drip',
  volume: 0.5,
  pitchRange: [0.85, 1.1],
  proceduralPatch: 'drop',
  paramMap: {
    avgVelocity: { target: 'drop.amplitude',    scale: 0.12, offset: 0.28 },
    emitRate:    { target: 'drop.rate',         scale: 0.22, offset: 0.9 },
    temperature: { target: 'drop.decay',        scale: 0.0005, offset: 0.22 },
    density:     { target: 'drop.bodyResonance', scale: 0.38, offset: 62 },
  },
};
