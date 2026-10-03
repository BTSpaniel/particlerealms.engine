// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'stone_thud',
  ambientLoop: null,
  collisionSound: 'stone_click',
  volume: 0.6,
  pitchRange: [0.8, 1.1],
  proceduralPatch: 'modal_impact_stone',
  paramMap: {
    avgVelocity: { target: 'stone.impactGain', scale: 0.09, offset: 0.24 },
    density:     { target: 'stone.hardness',   scale: 0.002, offset: 0.95 },
  },
};
