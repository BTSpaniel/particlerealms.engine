// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const SPECTRAL_RANGE = Object.freeze({ minNm: 360, maxNm: 830 });

export const SPECTRAL_DEFAULTS = Object.freeze({
  bandCount: 18,
  cameraWavelengths: 4,
  photonRadius: 0.18,
  progressiveGamma: 2 / 3,
});

export const SPECTRUM_KIND = Object.freeze({
  TABULATED: 'tabulated',
  BLACKBODY: 'blackbody',
  RGB_SIGMOID: 'rgb-sigmoid',
  CONSTANT: 'constant',
});

export function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function clampRange(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function createWavelengthPacket(lambda, pdf, activeMask = 1, hero = 0) {
  const wavelengths = ArrayBuffer.isView(lambda) ? Array.from(lambda) : (Array.isArray(lambda) ? lambda.slice() : [lambda]);
  const pdfs = ArrayBuffer.isView(pdf) ? Array.from(pdf) : (Array.isArray(pdf) ? pdf.slice() : [pdf]);
  return { lambda: wavelengths, pdf: pdfs, activeMask, hero, count: wavelengths.length };
}

export function createPhotonPacket(position, direction, lambdaNm, flux, flags = 0, normal = null) {
  return {
    position: [position[0] || 0, position[1] || 0, position[2] || 0],
    wi: [direction[0] || 0, direction[1] || 0, direction[2] || 0],
    normal: normal ? [normal[0] || 0, normal[1] || 0, normal[2] || 0] : [0, 1, 0],
    lambdaNm,
    flux,
    flags,
  };
}

export function createVisiblePoint(position, normal, materialId = 0, radius = SPECTRAL_DEFAULTS.photonRadius) {
  return {
    position: [position[0] || 0, position[1] || 0, position[2] || 0],
    normal: [normal[0] || 0, normal[1] || 1, normal[2] || 0],
    materialId,
    radius,
    tau: [0, 0, 0],
    photonCount: 0,
  };
}
