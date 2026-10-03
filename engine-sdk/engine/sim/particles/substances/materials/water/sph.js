// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export default {
  restDensity: 1000,
  viscosity: 5.0,       // raised from 0.1 — water needs damping to pool stably
  surfaceTension: 1.5,  // raised from 0.5 — stronger cohesion for droplet formation
  gasConstant: 20,      // was 200 — 10× too high caused explosive pressure repulsion
  xsphFactor: 0.3,      // raised from 0.1 — more velocity smoothing for coherent flow
  internalPressure: 1.0,
  externalPressure: 0.0,
  vorticityBoost: 1.0,
  damping: 0.01,
};
