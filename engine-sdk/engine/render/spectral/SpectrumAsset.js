// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { SPECTRAL_RANGE, SPECTRUM_KIND, clamp01, clampRange } from './SpectralTypes.js';
import { lerp } from '../../core/math/MathScalar.js';

const C2 = 1.438776877e7;

function normalizeLambda(lambdaNm) {
  return (clampRange(lambdaNm, SPECTRAL_RANGE.minNm, SPECTRAL_RANGE.maxNm) - 595) / 235;
}

function sigmoidBounded(x) {
  return 0.5 + x / (2 * Math.sqrt(1 + x * x));
}

function evalTabulated(samples, lambdaNm) {
  if (!samples?.length) return 0;
  if (lambdaNm <= samples[0][0]) return samples[0][1];
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const next = samples[i];
    if (lambdaNm <= next[0]) {
      const t = (lambdaNm - prev[0]) / Math.max(1e-6, next[0] - prev[0]);
      return lerp(prev[1], next[1], t);
    }
  }
  return samples[samples.length - 1][1];
}

function blackbodyRelative(lambdaNm, temperatureK) {
  const lambdaM = Math.max(1e-9, lambdaNm * 1e-9);
  const x = C2 / Math.max(1, temperatureK) / lambdaNm;
  const v = 1 / (Math.pow(lambdaM, 5) * Math.max(1e-9, Math.exp(x) - 1));
  const ref = 1 / (Math.pow(560e-9, 5) * Math.max(1e-9, Math.exp(C2 / Math.max(1, temperatureK) / 560) - 1));
  return v / ref;
}

export class SpectrumAsset {
  constructor(options = {}) {
    this.kind = options.kind || SPECTRUM_KIND.CONSTANT;
    this.samples = (options.samples || []).map((s) => [Number(s[0]), Number(s[1])]).sort((a, b) => a[0] - b[0]);
    this.value = options.value ?? 1;
    this.rgb = options.rgb ? [clamp01(options.rgb[0]), clamp01(options.rgb[1]), clamp01(options.rgb[2])] : [1, 1, 1];
    this.scale = options.scale ?? 1;
    this.temperatureK = options.temperatureK || 6500;
    this.coefficients = options.coefficients || null;
  }

  evaluate(lambdaNm) {
    if (this.kind === SPECTRUM_KIND.TABULATED) return Math.max(0, evalTabulated(this.samples, lambdaNm) * this.scale);
    if (this.kind === SPECTRUM_KIND.BLACKBODY) return Math.max(0, blackbodyRelative(lambdaNm, this.temperatureK) * this.scale);
    if (this.kind === SPECTRUM_KIND.RGB_SIGMOID) return this.evaluateRgbSigmoid(lambdaNm) * this.scale;
    return Math.max(0, this.value * this.scale);
  }

  evaluateRgbSigmoid(lambdaNm) {
    const u = normalizeLambda(lambdaNm);
    const [r, g, b] = this.rgb;
    const lobeR = Math.exp(-Math.pow((lambdaNm - 650) / 72, 2));
    const lobeG = Math.exp(-Math.pow((lambdaNm - 535) / 58, 2));
    const lobeB = Math.exp(-Math.pow((lambdaNm - 460) / 48, 2));
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const a = (r - luminance) * 1.8;
    const c = (b - luminance) * 1.8;
    const x = luminance * 2 - 1 + a * (u * u) - c * u + (r * lobeR + g * lobeG + b * lobeB - luminance) * 0.85;
    return clamp01(sigmoidBounded(x * 2.2));
  }

  sampleBands(count = 18, minNm = SPECTRAL_RANGE.minNm, maxNm = SPECTRAL_RANGE.maxNm) {
    const bands = [];
    for (let i = 0; i < count; i += 1) {
      const t = count <= 1 ? 0.5 : (i + 0.5) / count;
      const lambda = lerp(minNm, maxNm, t);
      bands.push([lambda, this.evaluate(lambda)]);
    }
    return bands;
  }
}

export function createConstantSpectrum(value = 1, scale = 1) {
  return new SpectrumAsset({ kind: SPECTRUM_KIND.CONSTANT, value, scale });
}

export function createTabulatedSpectrum(samples, scale = 1) {
  return new SpectrumAsset({ kind: SPECTRUM_KIND.TABULATED, samples, scale });
}

export function createBlackbodySpectrum(temperatureK = 6500, scale = 1) {
  return new SpectrumAsset({ kind: SPECTRUM_KIND.BLACKBODY, temperatureK, scale });
}

export function createRgbSpectrum(rgb, scale = 1) {
  return new SpectrumAsset({ kind: SPECTRUM_KIND.RGB_SIGMOID, rgb, scale });
}
