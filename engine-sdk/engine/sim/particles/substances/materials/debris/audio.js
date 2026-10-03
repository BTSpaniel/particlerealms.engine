// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'debris_thud',
  ambientLoop: null,
  collisionSound: 'debris_clatter',
  volume: 0.6,
  pitchRange: [0.8, 1.2],
  proceduralPatch: 'crackle',
  paramMap: {
    emitRate:    { target: 'crackle.density',    scale: 2.0, offset: 6 },
    avgVelocity: { target: 'crackle.brightness', scale: 260, offset: 850 },
    density:     { target: 'crackle.thudLevel',  scale: 0.01, offset: 0.55 },
  },
};
