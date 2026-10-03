// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { SPECTRAL_RANGE, createWavelengthPacket, clampRange } from './SpectralTypes.js';
import { uniformDistribution } from '../../core/math/MathRandom.js';

function hash01(seed) {
  let s = (seed >>> 0) + 0x6D2B79F5;
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
}

export function visibleImportance(lambdaNm) {
  const x = Math.exp(-Math.pow((lambdaNm - 600) / 94, 2));
  const y = Math.exp(-Math.pow((lambdaNm - 555) / 72, 2));
  const z = Math.exp(-Math.pow((lambdaNm - 445) / 54, 2));
  return Math.max(1e-4, x + y + z);
}

export function wavelengthToBand(lambdaNm, bandCount = 18, minNm = SPECTRAL_RANGE.minNm, maxNm = SPECTRAL_RANGE.maxNm) {
  const t = (clampRange(lambdaNm, minNm, maxNm) - minNm) / Math.max(1e-6, maxNm - minNm);
  return Math.min(bandCount - 1, Math.max(0, Math.floor(t * bandCount)));
}

export function bandCenterWavelength(band, bandCount = 18, minNm = SPECTRAL_RANGE.minNm, maxNm = SPECTRAL_RANGE.maxNm) {
  return minNm + (Math.max(0, band) + 0.5) * (maxNm - minNm) / Math.max(1, bandCount);
}

export function sampleVisibleWavelength(u = uniformDistribution(0, 1, Math.random), minNm = SPECTRAL_RANGE.minNm, maxNm = SPECTRAL_RANGE.maxNm) {
  const bins = 96;
  let sum = 0;
  const cdf = new Float32Array(bins);
  for (let i = 0; i < bins; i += 1) {
    const lambda = minNm + (i + 0.5) * (maxNm - minNm) / bins;
    sum += visibleImportance(lambda);
    cdf[i] = sum;
  }
  const target = Math.max(0, Math.min(0.999999, u)) * sum;
  let idx = 0;
  while (idx < bins - 1 && cdf[idx] < target) idx += 1;
  const lambda = minNm + (idx + hash01(idx + Math.floor(u * 1e6))) * (maxNm - minNm) / bins;
  const pdf = visibleImportance(lambda) / (sum * ((maxNm - minNm) / bins));
  return { lambdaNm: clampRange(lambda, minNm, maxNm), pdf: Math.max(1e-6, pdf) };
}

export function sampleStratifiedVisiblePacket(seed = 1, count = 4) {
  const lambda = [];
  const pdf = [];
  for (let i = 0; i < count; i += 1) {
    const u = (i + hash01(seed + i * 977)) / count;
    const s = sampleVisibleWavelength(u);
    lambda.push(s.lambdaNm);
    pdf.push(s.pdf);
  }
  return createWavelengthPacket(lambda, pdf, (1 << Math.min(30, count)) - 1, 0);
}

export function samplePhotonWavelength(lightSpectrum, seed = 1, bandCount = 18) {
  let total = 0;
  const weights = new Float32Array(bandCount);
  for (let i = 0; i < bandCount; i += 1) {
    const lambda = bandCenterWavelength(i, bandCount);
    const w = Math.max(1e-5, (lightSpectrum?.evaluate ? lightSpectrum.evaluate(lambda) : 1) * visibleImportance(lambda));
    weights[i] = w;
    total += w;
  }
  const target = hash01(seed) * total;
  let acc = 0;
  let band = bandCount - 1;
  for (let i = 0; i < bandCount; i += 1) {
    acc += weights[i];
    if (acc >= target) {
      band = i;
      break;
    }
  }
  const lambdaNm = bandCenterWavelength(band, bandCount);
  return { lambdaNm, band, pdf: Math.max(1e-6, weights[band] / total) };
}
