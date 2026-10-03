// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { SPECTRAL_DEFAULTS, createPhotonPacket } from './SpectralTypes.js';
import { wavelengthToBand } from './WavelengthSampling.js';

function distanceSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

export class SpectralPhotonStore {
  constructor(options = {}) {
    this.bandCount = options.bandCount || SPECTRAL_DEFAULTS.bandCount;
    this.maxPhotons = options.maxPhotons || 200000;
    this.bands = Array.from({ length: this.bandCount }, () => []);
    this.count = 0;
    this.radius = options.radius || SPECTRAL_DEFAULTS.photonRadius;
    this.progressiveGamma = options.progressiveGamma || SPECTRAL_DEFAULTS.progressiveGamma;
    this.iteration = 0;
    this.effectivePhotonCount = 0;
  }

  clear() {
    for (const band of this.bands) band.length = 0;
    this.count = 0;
    this.iteration = 0;
    this.effectivePhotonCount = 0;
  }

  store(position, direction, lambdaNm, flux, flags = 0, normal = null) {
    if (this.count >= this.maxPhotons) return false;
    const photon = createPhotonPacket(position, direction, lambdaNm, flux, flags, normal);
    photon.band = wavelengthToBand(lambdaNm, this.bandCount);
    this.bands[photon.band].push(photon);
    this.count += 1;
    return true;
  }

  gather(position, normal, lambdaNm, radius = this.radius) {
    const band = wavelengthToBand(lambdaNm, this.bandCount);
    const r2 = radius * radius;
    let flux = 0;
    let hits = 0;
    for (let db = -1; db <= 1; db += 1) {
      const bi = band + db;
      if (bi < 0 || bi >= this.bandCount) continue;
      const spectralWeight = db === 0 ? 1 : 0.35;
      for (const photon of this.bands[bi]) {
        const d2 = distanceSq(position, photon.position);
        if (d2 > r2) continue;
        const normalWeight = Math.max(0, photon.normal[0] * normal[0] + photon.normal[1] * normal[1] + photon.normal[2] * normal[2]);
        const coneWeight = Math.max(0, 1 - Math.sqrt(d2) / Math.max(1e-6, radius));
        flux += photon.flux * spectralWeight * (0.25 + 0.75 * normalWeight) * coneWeight;
        hits += 1;
      }
    }
    return { flux: flux / Math.max(1e-6, Math.PI * r2), hits };
  }

  stepProgressive(matchCount) {
    const prevN = this.effectivePhotonCount;
    const nextN = prevN + this.progressiveGamma * Math.max(0, matchCount);
    if (prevN + matchCount > 0 && nextN > 0) this.radius *= Math.sqrt(nextN / Math.max(1e-6, prevN + matchCount));
    this.effectivePhotonCount = nextN;
    this.iteration += 1;
    return this.radius;
  }

  estimateBytes(bytesPerPhoton = 32) {
    return this.count * bytesPerPhoton;
  }

  getStats() {
    return {
      photonCount: this.count,
      bandCount: this.bandCount,
      radius: this.radius,
      iteration: this.iteration,
      effectivePhotonCount: this.effectivePhotonCount,
      bytesEstimate: this.estimateBytes(),
      bands: this.bands.map((b) => b.length),
    };
  }
}
