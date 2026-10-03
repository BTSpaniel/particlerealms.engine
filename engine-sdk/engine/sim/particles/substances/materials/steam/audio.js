// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: null,
  ambientLoop: 'steam_hiss',
  collisionSound: null,
  volume: 0.4,
  pitchRange: [0.9, 1.1],
  proceduralPatch: 'hiss',
  paramMap: {
    temperature: { target: 'hiss.cutoff',     scale: 4.8, offset: 1700 },
    avgVelocity: { target: 'hiss.whooshLevel', scale: 0.07, offset: 0.25 },
    emitRate:    { target: 'hiss.gustiness',  scale: 0.014, offset: 0.2 },
  },
};
