// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { SPECTRAL_DEFAULTS } from './SpectralTypes.js';
import { createBlackbodySpectrum, createRgbSpectrum } from './SpectrumAsset.js';
import { samplePhotonWavelength, bandCenterWavelength } from './WavelengthSampling.js';
import { prismMinimumDeviation } from './SpectralScattering.js';
import { spectralSamplesToDisplayRgb } from './SpectralSensor.js';
import { SpectralPhotonStore } from './SpectralPhotonStore.js';

function hash01(seed) {
  let s = (seed >>> 0) + 0x9E3779B9;
  s = Math.imul(s ^ (s >>> 16), 0x85EBCA6B);
  s = Math.imul(s ^ (s >>> 13), 0xC2B2AE35);
  return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
}

export class SpectralPhotonMapper {
  constructor(options = {}) {
    this.bandCount = options.bandCount || SPECTRAL_DEFAULTS.bandCount;
    this.store = options.store || new SpectralPhotonStore({ bandCount: this.bandCount, radius: options.radius, maxPhotons: options.maxPhotons });
    this.lightSpectrum = options.lightSpectrum || createBlackbodySpectrum(5800, 1);
    this.filterSpectrum = options.filterSpectrum || createRgbSpectrum([0.95, 0.28, 0.16], 1);
    this.frame = 0;
    this.stats = { emitted: 0, stored: 0, gathered: 0 };
  }

  reset() {
    this.store.clear();
    this.frame = 0;
    this.stats = { emitted: 0, stored: 0, gathered: 0 };
  }

  emitPrismCausticPhotons(count = 2048) {
    let stored = 0;
    const baseSeed = this.frame * 1664525 + 1013904223;
    for (let i = 0; i < count; i += 1) {
      const s = baseSeed + i * 747796405;
      const sample = samplePhotonWavelength(this.lightSpectrum, s, this.bandCount);
      const lambda = sample.lambdaNm;
      const deviation = prismMinimumDeviation(lambda, Math.PI / 3);
      const spectralPower = this.lightSpectrum.evaluate(lambda) * this.filterSpectrum.evaluate(lambda) / Math.max(1e-6, sample.pdf);
      const spread = (hash01(s + 2) - 0.5) * 0.18;
      const line = (hash01(s + 3) - 0.5) * 1.9;
      const causticX = Math.sin(deviation - 0.62) * 4.2 + spread;
      const causticZ = Math.cos(deviation - 0.62) * 1.1 + line;
      const causticY = -1.4 + (hash01(s + 4) - 0.5) * 0.025;
      const normal = [0, 1, 0];
      const wi = [Math.sin(deviation), -0.85, Math.cos(deviation)];
      if (this.store.store([causticX, causticY, causticZ], wi, lambda, spectralPower / Math.max(1, count), 1, normal)) stored += 1;
    }
    this.frame += 1;
    this.stats.emitted += count;
    this.stats.stored += stored;
    this.store.stepProgressive(stored);
    return stored;
  }

  sampleCausticGrid(width = 96, height = 48, extentX = 5.5, extentZ = 3.2) {
    const pixels = new Float32Array(width * height * 4);
    let gathered = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const px = (x / Math.max(1, width - 1) * 2 - 1) * extentX;
        const pz = (y / Math.max(1, height - 1) * 2 - 1) * extentZ;
        const samples = [];
        let hits = 0;
        for (let b = 0; b < this.bandCount; b += 1) {
          const lambda = bandCenterWavelength(b, this.bandCount);
          const g = this.store.gather([px, -1.4, pz], [0, 1, 0], lambda, this.store.radius);
          if (g.hits > 0) samples.push({ lambdaNm: lambda, value: g.flux });
          hits += g.hits;
        }
        const rgb = spectralSamplesToDisplayRgb(samples, 5.5);
        const o = (y * width + x) * 4;
        pixels[o] = rgb[0];
        pixels[o + 1] = rgb[1];
        pixels[o + 2] = rgb[2];
        pixels[o + 3] = Math.min(1, hits / 24);
        gathered += hits;
      }
    }
    this.stats.gathered += gathered;
    return { width, height, pixels, gathered };
  }

  makeDebugPhotons(maxCount = 8192) {
    const data = [];
    for (let b = 0; b < this.store.bands.length && data.length < maxCount; b += 1) {
      const lambda = bandCenterWavelength(b, this.bandCount);
      const rgb = spectralSamplesToDisplayRgb([{ lambdaNm: lambda, value: 1 }], 1);
      for (const photon of this.store.bands[b]) {
        if (data.length >= maxCount) break;
        data.push({ position: photon.position, color: rgb, lambdaNm: photon.lambdaNm, flux: photon.flux });
      }
    }
    return data;
  }

  getStats() {
    return { ...this.stats, frame: this.frame, ...this.store.getStats() };
  }
}

export function createSpectralPhotonMapper(options) {
  return new SpectralPhotonMapper(options);
}
