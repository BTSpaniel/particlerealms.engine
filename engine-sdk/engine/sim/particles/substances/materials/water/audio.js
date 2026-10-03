// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'water_splash',
  ambientLoop: 'water_flow',
  collisionSound: 'water_drip',
  volume: 0.6,
  pitchRange: [0.9, 1.1],
  proceduralPatch: 'fluid',
  paramMap: {
    emitRate:    { target: 'fluid.splashRate', scale: 0.65, offset: 2.5 },
    avgVelocity: { target: 'fluid.dropPitch',  scale: 65, offset: 220 },
    temperature: { target: 'fluid.brightness', scale: 3.0, offset: 1700 },
    density:     { target: 'fluid.flowLevel',  scale: 0.014, offset: 0.12 },
  },
};
