// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'fire_impact',
  ambientLoop: 'fire_crackle',
  collisionSound: 'fire_burst',
  volume: 0.72,
  pitchRange: [0.8, 1.2],
  proceduralPatch: 'combustion',
  paramMap: {
    emitRate:    { target: 'combustion.crackleRate', scale: 1.8, offset: 20 },
    temperature: { target: 'combustion.brightness',  scale: 2.6, offset: 800 },
    avgVelocity: { target: 'combustion.hissLevel',   scale: 0.08, offset: 0.12 },
    density:     { target: 'combustion.rumbleLevel', scale: 0.02, offset: 0.1 },
  },
};
