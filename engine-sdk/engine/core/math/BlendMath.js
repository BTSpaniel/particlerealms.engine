// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { saturate } from './MathScalar.js';

const BAYER_4X4 = Object.freeze([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

function finiteOrDefault(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function colorChannel(color, index, fallback = 0) {
  return saturate(finiteOrDefault(color?.[index], fallback));
}

function alphaChannel(color, opacity = 1) {
  return saturate(colorChannel(color, 3, 1) * saturate(finiteOrDefault(opacity, 1)));
}

function normalizedMode(mode) {
  return String(mode || 'normal').toLowerCase().replace(/[_\s]+/g, '-');
}

function mod(value, divisor) {
  const n = Math.floor(finiteOrDefault(value));
  return ((n % divisor) + divisor) % divisor;
}

export function straightRgba(color, opacity = 1) {
  return [
    colorChannel(color, 0),
    colorChannel(color, 1),
    colorChannel(color, 2),
    alphaChannel(color, opacity),
  ];
}

export function premultiplyAlpha(color, opacity = 1) {
  const a = alphaChannel(color, opacity);
  return [
    colorChannel(color, 0) * a,
    colorChannel(color, 1) * a,
    colorChannel(color, 2) * a,
    a,
  ];
}

export function unpremultiplyAlpha(color) {
  const a = colorChannel(color, 3, 1);
  if (a <= 0) return [0, 0, 0, 0];
  return [
    saturate(finiteOrDefault(color?.[0]) / a),
    saturate(finiteOrDefault(color?.[1]) / a),
    saturate(finiteOrDefault(color?.[2]) / a),
    a,
  ];
}

export function alphaBlend(backdrop, source, opacity = 1) {
  const cb = straightRgba(backdrop);
  const cs = straightRgba(source, opacity);
  const outA = cs[3] + cb[3] * (1 - cs[3]);
  if (outA <= 0) return [0, 0, 0, 0];
  return [
    (cs[0] * cs[3] + cb[0] * cb[3] * (1 - cs[3])) / outA,
    (cs[1] * cs[3] + cb[1] * cb[3] * (1 - cs[3])) / outA,
    (cs[2] * cs[3] + cb[2] * cb[3] * (1 - cs[3])) / outA,
    outA,
  ];
}

export function premultipliedAlphaBlend(backdrop, source, opacity = 1) {
  const sourceOpacity = saturate(finiteOrDefault(opacity, 1));
  const csA = colorChannel(source, 3, 1) * sourceOpacity;
  const cbA = colorChannel(backdrop, 3, 1);
  return [
    saturate(finiteOrDefault(source?.[0]) * sourceOpacity + finiteOrDefault(backdrop?.[0]) * (1 - csA)),
    saturate(finiteOrDefault(source?.[1]) * sourceOpacity + finiteOrDefault(backdrop?.[1]) * (1 - csA)),
    saturate(finiteOrDefault(source?.[2]) * sourceOpacity + finiteOrDefault(backdrop?.[2]) * (1 - csA)),
    saturate(csA + cbA * (1 - csA)),
  ];
}

export function blendModeChannel(backdrop, source, mode = 'normal') {
  const cb = saturate(finiteOrDefault(backdrop));
  const cs = saturate(finiteOrDefault(source));
  switch (normalizedMode(mode)) {
    case 'multiply':
      return cb * cs;
    case 'screen':
      return cb + cs - cb * cs;
    case 'overlay':
      return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case 'darken':
    case 'min':
      return Math.min(cb, cs);
    case 'lighten':
    case 'max':
      return Math.max(cb, cs);
    case 'color-dodge':
      if (cb <= 0) return 0;
      if (cs >= 1) return 1;
      return Math.min(1, cb / (1 - cs));
    case 'color-burn':
      if (cb >= 1) return 1;
      if (cs <= 0) return 0;
      return 1 - Math.min(1, (1 - cb) / cs);
    case 'hard-light':
      return cs <= 0.5
        ? blendModeChannel(cb, 2 * cs, 'multiply')
        : blendModeChannel(cb, 2 * cs - 1, 'screen');
    case 'soft-light': {
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cs <= 0.5
        ? cb - (1 - 2 * cs) * cb * (1 - cb)
        : cb + (2 * cs - 1) * (d - cb);
    }
    case 'difference':
      return Math.abs(cb - cs);
    case 'exclusion':
      return cb + cs - 2 * cb * cs;
    case 'add':
    case 'plus':
    case 'plus-lighter':
    case 'lighter':
      return Math.min(1, cb + cs);
    case 'subtract':
      return Math.max(0, cb - cs);
    case 'normal':
    default:
      return cs;
  }
}

export function blendRgb(backdrop, source, mode = 'normal') {
  return [
    blendModeChannel(backdrop?.[0], source?.[0], mode),
    blendModeChannel(backdrop?.[1], source?.[1], mode),
    blendModeChannel(backdrop?.[2], source?.[2], mode),
  ];
}

export function blendCompositeStraight(backdrop, source, mode = 'normal', opacity = 1) {
  const cb = straightRgba(backdrop);
  const cs = straightRgba(source, opacity);
  const blended = blendRgb(cb, cs, mode);
  const overlap = cb[3] * cs[3];
  const outA = cs[3] + cb[3] * (1 - cs[3]);
  if (outA <= 0) return [0, 0, 0, 0];
  return [
    (cs[0] * cs[3] * (1 - cb[3]) + cb[0] * cb[3] * (1 - cs[3]) + blended[0] * overlap) / outA,
    (cs[1] * cs[3] * (1 - cb[3]) + cb[1] * cb[3] * (1 - cs[3]) + blended[1] * overlap) / outA,
    (cs[2] * cs[3] * (1 - cb[3]) + cb[2] * cb[3] * (1 - cs[3]) + blended[2] * overlap) / outA,
    outA,
  ];
}

export function coverageAlpha(coveredSamples, sampleCount = 1) {
  const samples = Math.max(1, Math.floor(finiteOrDefault(sampleCount, 1)));
  const covered = Math.max(0, Math.min(samples, Math.round(finiteOrDefault(coveredSamples))));
  return covered / samples;
}

export function alphaToCoverage(alpha, sampleCount = 1) {
  const samples = Math.max(1, Math.floor(finiteOrDefault(sampleCount, 1)));
  const value = saturate(finiteOrDefault(alpha));
  const coveredSamples = Math.max(0, Math.min(samples, Math.round(value * samples)));
  return {
    alpha: value,
    sampleCount: samples,
    coveredSamples,
    coverageAlpha: coveredSamples / samples,
  };
}

export function bayer4Threshold(x, y) {
  return (BAYER_4X4[mod(y, 4) * 4 + mod(x, 4)] + 0.5) / 16;
}

export function ditherAlpha(alpha, x = 0, y = 0, frame = 0) {
  const shift = Math.floor(finiteOrDefault(frame));
  return saturate(finiteOrDefault(alpha)) >= bayer4Threshold(x + shift, y + shift) ? 1 : 0;
}
