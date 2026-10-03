// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'snow_crunch',
  ambientLoop: null,
  collisionSound: 'snow_puff',
  volume: 0.3,
  pitchRange: [0.9, 1.1],
  proceduralPatch: 'hiss',
  paramMap: {
    avgVelocity: { target: 'hiss.whooshLevel', scale: 0.03, offset: 0.1 },
    emitRate:    { target: 'hiss.gustiness',  scale: 0.008, offset: 0.08 },
    temperature: { target: 'hiss.cutoff',     scale: 1.6, offset: 520 },
  },
};
