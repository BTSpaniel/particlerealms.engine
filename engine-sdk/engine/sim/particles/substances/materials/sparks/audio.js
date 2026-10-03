// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'spark_ping',
  ambientLoop: null,
  collisionSound: 'spark_sizzle',
  volume: 0.4,
  pitchRange: [0.8, 1.4],
  proceduralPatch: 'crackle',
  paramMap: {
    emitRate:    { target: 'crackle.density',    scale: 3.2, offset: 12 },
    avgVelocity: { target: 'crackle.brightness', scale: 420, offset: 2300 },
    temperature: { target: 'crackle.thudLevel',  scale: -0.00035, offset: 1.2 },
  },
};
