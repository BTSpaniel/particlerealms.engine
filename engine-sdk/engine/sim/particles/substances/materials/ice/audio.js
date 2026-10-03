// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  impactSound: 'ice_crack',
  ambientLoop: null,
  collisionSound: 'ice_clink',
  volume: 0.5,
  pitchRange: [0.9, 1.2],
  proceduralPatch: 'modal_impact_ice',
  paramMap: {
    avgVelocity: { target: 'ice.impactGain',   scale: 0.1, offset: 0.22 },
    temperature: { target: 'ice.brittleness',  scale: -0.001, offset: 1.55 },
  },
};
