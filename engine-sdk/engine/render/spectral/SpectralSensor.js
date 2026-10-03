// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { SPECTRAL_RANGE, clamp01 } from './SpectralTypes.js';

function cmfX(lambda) {
  return 1.056 * Math.exp(-0.5 * Math.pow((lambda - 599.8) / 37.9, 2)) + 0.362 * Math.exp(-0.5 * Math.pow((lambda - 442) / 16, 2)) - 0.065 * Math.exp(-0.5 * Math.pow((lambda - 501.1) / 20.4, 2));
}

function cmfY(lambda) {
  return 0.821 * Math.exp(-0.5 * Math.pow((lambda - 568.8) / 46.9, 2)) + 0.286 * Math.exp(-0.5 * Math.pow((lambda - 530.9) / 16.3, 2));
}

function cmfZ(lambda) {
  return 1.217 * Math.exp(-0.5 * Math.pow((lambda - 437) / 11.8, 2)) + 0.681 * Math.exp(-0.5 * Math.pow((lambda - 459) / 26, 2));
}

export function wavelengthToXyz(lambdaNm, value = 1) {
  return [Math.max(0, cmfX(lambdaNm)) * value, Math.max(0, cmfY(lambdaNm)) * value, Math.max(0, cmfZ(lambdaNm)) * value];
}

export function xyzToLinearSrgb(xyz) {
  const [x, y, z] = xyz;
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.2040 * y + 1.0570 * z,
  ];
}

export function encodeSrgbChannel(v) {
  const c = clamp01(v);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function acesToneMap(rgb, exposure = 1) {
  return rgb.map((v) => {
    const x = Math.max(0, v * exposure);
    return clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
  });
}

export function spectralSamplesToXyz(samples) {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (const sample of samples || []) {
    const lambda = sample.lambdaNm ?? sample.lambda ?? sample[0];
    const value = sample.value ?? sample.flux ?? sample[1] ?? 0;
    const xyz = wavelengthToXyz(lambda, value);
    x += xyz[0];
    y += xyz[1];
    z += xyz[2];
    n += 1;
  }
  const scale = n > 0 ? (SPECTRAL_RANGE.maxNm - SPECTRAL_RANGE.minNm) / n : 1;
  return [x * scale, y * scale, z * scale];
}

export function spectralSamplesToDisplayRgb(samples, exposure = 1) {
  const xyz = spectralSamplesToXyz(samples);
  const rgb = acesToneMap(xyzToLinearSrgb(xyz), exposure);
  return rgb.map(encodeSrgbChannel);
}

export function normalizeRgb(rgb) {
  const m = Math.max(1e-6, rgb[0], rgb[1], rgb[2]);
  return [rgb[0] / m, rgb[1] / m, rgb[2] / m];
}
