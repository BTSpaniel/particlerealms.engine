// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'glass_shatter',
  ambientLoop: null,
  collisionSound: 'glass_clink',
  volume: 0.6,
  pitchRange: [0.9, 1.3],
  proceduralPatch: 'modal_impact_glass',
  paramMap: {
    avgVelocity: { target: 'glass.impactGain',   scale: 0.1, offset: 0.24 },
    temperature: { target: 'glass.shimmerDepth', scale: 0.0006, offset: 0.92 },
  },
};
