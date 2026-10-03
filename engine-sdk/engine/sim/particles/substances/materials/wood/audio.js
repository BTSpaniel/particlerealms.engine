// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'wood_thud',
  ambientLoop: null,
  collisionSound: 'wood_crack',
  volume: 0.5,
  pitchRange: [0.85, 1.15],
  proceduralPatch: 'modal_impact_wood',
  paramMap: {
    avgVelocity: { target: 'wood.impactGain', scale: 0.1, offset: 0.18 },
    density:     { target: 'wood.hollow',     scale: 0.002, offset: 0.92 },
  },
};
