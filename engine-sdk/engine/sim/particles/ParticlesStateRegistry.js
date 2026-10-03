// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

let _activeParticlesState = null;

export function setActiveParticlesState(particlesState) {
  if (particlesState && typeof particlesState === "object") {
    _activeParticlesState = particlesState;
  } else {
    _activeParticlesState = null;
  }
}

export function getActiveParticlesState() {
  return _activeParticlesState;
}

export function clearActiveParticlesState() {
  _activeParticlesState = null;
}
