// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'electric_zap',
  ambientLoop: 'plasma_hum',
  collisionSound: 'electric_arc',
  volume: 0.6,
  pitchRange: [0.7, 1.3],
  proceduralPatch: 'electric',
  paramMap: {
    temperature: { target: 'electric.buzzFreq',  scale: 0.06, offset: 46 },
    emitRate:    { target: 'electric.snapRate',  scale: 3.2, offset: 24 },
    avgVelocity: { target: 'electric.arcLevel',  scale: 0.08, offset: 0.3 },
    density:     { target: 'electric.impactGain', scale: 0.01, offset: 0.75 },
  },
};
