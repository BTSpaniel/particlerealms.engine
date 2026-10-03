// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'sand_thud',
  ambientLoop: null,
  collisionSound: 'sand_scrape',
  volume: 0.4,
  pitchRange: [0.85, 1.15],
  proceduralPatch: 'sand',
  paramMap: {
    avgVelocity: { target: 'sand.scatter',    scale: 0.12, offset: 0.55 },
    density:     { target: 'sand.bodyLevel',  scale: 0.004, offset: 0.45 },
    temperature: { target: 'sand.dryness',    scale: 0.0006, offset: 0.82 },
    emitRate:    { target: 'sand.gustiness',  scale: 0.012, offset: 0.18 },
  },
};
