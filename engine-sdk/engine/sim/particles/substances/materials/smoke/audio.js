// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: null,
  ambientLoop: 'smoke_hiss',
  collisionSound: null,
  volume: 0.3,
  pitchRange: [0.9, 1.1],
  proceduralPatch: 'hiss',
  paramMap: {
    emitRate:    { target: 'hiss.gustiness',  scale: 0.016, offset: 0.22 },
    avgVelocity: { target: 'hiss.whooshLevel', scale: 0.05, offset: 0.18 },
    temperature: { target: 'hiss.cutoff',     scale: 2.8, offset: 900 },
  },
};
