// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { clamp01 } from './SpectralTypes.js';

export function sellmeierIor(lambdaNm, coefficients = null) {
  const c = coefficients || [[1.03961212, 0.00600069867], [0.231792344, 0.0200179144], [1.01046945, 103.560653]];
  const l = Math.max(1e-6, lambdaNm * 0.001);
  const l2 = l * l;
  let n2 = 1;
  for (const [b, cc] of c) n2 += (b * l2) / Math.max(1e-8, l2 - cc);
  return Math.sqrt(Math.max(1, n2));
}

export function fresnelDielectric(cosThetaI, etaI, etaT) {
  let ci = Math.max(-1, Math.min(1, cosThetaI));
  let ei = etaI;
  let et = etaT;
  if (ci <= 0) {
    const tmp = ei;
    ei = et;
    et = tmp;
    ci = Math.abs(ci);
  }
  const sinThetaI = Math.sqrt(Math.max(0, 1 - ci * ci));
  const sinThetaT = ei / et * sinThetaI;
  if (sinThetaT >= 1) return 1;
  const ct = Math.sqrt(Math.max(0, 1 - sinThetaT * sinThetaT));
  const rPar = ((et * ci) - (ei * ct)) / ((et * ci) + (ei * ct));
  const rPer = ((ei * ci) - (et * ct)) / ((ei * ci) + (et * ct));
  return clamp01((rPar * rPar + rPer * rPer) * 0.5);
}

export function beerLambert(sigmaT, distance) {
  return Math.exp(-Math.min(80, Math.max(0, sigmaT) * Math.max(0, distance)));
}

export function henyeyGreenstein(cosTheta, g = 0) {
  const gg = Math.max(-0.98, Math.min(0.98, g));
  const denom = Math.pow(Math.max(1e-5, 1 + gg * gg + 2 * gg * cosTheta), 1.5);
  return (1 - gg * gg) / (4 * Math.PI * denom);
}

export function lambertBsdf(reflectance) {
  return Math.max(0, reflectance) / Math.PI;
}

export function prismMinimumDeviation(lambdaNm, apexRadians = Math.PI / 3, coefficients = null) {
  const n = sellmeierIor(lambdaNm, coefficients);
  return 2 * Math.asin(Math.min(1, n * Math.sin(apexRadians * 0.5))) - apexRadians;
}
