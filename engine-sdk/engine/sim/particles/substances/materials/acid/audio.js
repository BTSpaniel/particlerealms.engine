// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'acid_sizzle',
  ambientLoop: 'acid_bubble',
  collisionSound: 'acid_hiss',
  volume: 0.5,
  pitchRange: [0.85, 1.15],
  proceduralPatch: 'hiss',
  paramMap: {
    emitRate:    { target: 'hiss.gustiness',  scale: 0.02, offset: 0.35 },
    avgVelocity: { target: 'hiss.whooshLevel', scale: 0.06, offset: 0.28 },
    temperature: { target: 'hiss.cutoff',     scale: 4.0, offset: 1400 },
  },
};
