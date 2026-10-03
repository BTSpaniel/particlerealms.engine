// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'lava_splash',
  ambientLoop: 'lava_bubble',
  collisionSound: 'lava_sizzle',
  volume: 0.68,
  pitchRange: [0.8, 1.0],
  proceduralPatch: 'combustion',
  paramMap: {
    emitRate:    { target: 'combustion.crackleRate', scale: 0.8, offset: 8 },
    temperature: { target: 'combustion.brightness',  scale: 2.1, offset: 950 },
    avgVelocity: { target: 'combustion.hissLevel',   scale: 0.04, offset: 0.08 },
    density:     { target: 'combustion.rumbleLevel', scale: 0.03, offset: 0.28 },
  },
};
