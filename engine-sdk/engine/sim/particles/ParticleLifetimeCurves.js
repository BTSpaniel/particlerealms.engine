// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleLifetimeCurves.js - GPU N-point Bezier curves for particle properties over lifetime
 * 
 * Extends the color gradient LUT pattern to size, alpha, and velocity.
 * Generates a 1D RGBA16float texture (256 texels):
 *   R = size multiplier
 *   G = alpha multiplier  
 *   B = velocity multiplier
 *   A = reserved (1.0)
 * 
 * Sampled in vertex shader (size), fragment shader (alpha), and optionally sim shader (velocity).
 * Supports N-point curves with Catmull-Rom interpolation for smooth results.
 */

const LUT_WIDTH = 256;

// ============================================================================
// CURVE PRESETS
// ============================================================================

export const CURVE_PRESETS = {
  /** Constant 1.0 — no modulation */
  constant: [{ t: 0, v: 1 }, { t: 1, v: 1 }],

  /** Linear fade out */
  linearFadeOut: [{ t: 0, v: 1 }, { t: 1, v: 0 }],

  /** Fade in then out (bell curve) */
  fadeInOut: [{ t: 0, v: 0 }, { t: 0.15, v: 1 }, { t: 0.85, v: 1 }, { t: 1, v: 0 }],

  /** Quick fade in, slow fade out */
  quickInSlowOut: [{ t: 0, v: 0 }, { t: 0.05, v: 1 }, { t: 0.5, v: 0.8 }, { t: 1, v: 0 }],

  /** Grow then shrink */
  growShrink: [{ t: 0, v: 0.3 }, { t: 0.3, v: 1.2 }, { t: 0.7, v: 1.0 }, { t: 1, v: 0.1 }],

  /** Explode then decelerate */
  explodeDecel: [{ t: 0, v: 1 }, { t: 0.1, v: 0.6 }, { t: 0.5, v: 0.3 }, { t: 1, v: 0.05 }],

  /** Pulse (2 peaks) */
  pulse: [{ t: 0, v: 0 }, { t: 0.2, v: 1 }, { t: 0.4, v: 0.3 }, { t: 0.7, v: 0.9 }, { t: 1, v: 0 }],

  /** Smoke: grow continuously, alpha fades */
  smokeSize: [{ t: 0, v: 0.5 }, { t: 0.5, v: 1.0 }, { t: 1, v: 1.5 }],

  /** Sparks: bright start, fast decay */
  sparkAlpha: [{ t: 0, v: 1 }, { t: 0.1, v: 0.8 }, { t: 0.3, v: 0.3 }, { t: 1, v: 0 }],
};

// ============================================================================
// CURVE EVALUATION
// ============================================================================

/**
 * Evaluate an N-point curve at parameter t using Catmull-Rom interpolation.
 * @param {Array<{t: number, v: number}>} curve - Sorted control points
 * @param {number} t - Parameter 0-1
 * @returns {number} Interpolated value
 */
function evaluateCurve(curve, t) {
  if (!curve || curve.length === 0) return 1.0;
  if (curve.length === 1) return curve[0].v;

  t = Math.max(0, Math.min(1, t));

  // Find segment
  let i = 0;
  for (; i < curve.length - 1; i++) {
    if (t <= curve[i + 1].t) break;
  }
  i = Math.min(i, curve.length - 2);

  const p0 = curve[Math.max(0, i - 1)];
  const p1 = curve[i];
  const p2 = curve[i + 1];
  const p3 = curve[Math.min(curve.length - 1, i + 2)];

  const segLen = p2.t - p1.t;
  if (segLen < 1e-6) return p1.v;

  const localT = (t - p1.t) / segLen;
  const tt = localT * localT;
  const ttt = tt * localT;

  // Catmull-Rom coefficients
  const v = 0.5 * (
    (2 * p1.v) +
    (-p0.v + p2.v) * localT +
    (2 * p0.v - 5 * p1.v + 4 * p2.v - p3.v) * tt +
    (-p0.v + 3 * p1.v - 3 * p2.v + p3.v) * ttt
  );

  return v;
}

/**
 * Convert a legacy 3-point array [start, mid, end] to a curve.
 */
export function curveFromLegacy3(arr) {
  if (!arr || arr.length < 3) return CURVE_PRESETS.constant;
  return [
    { t: 0.0, v: arr[0] },
    { t: 0.5, v: arr[1] },
    { t: 1.0, v: arr[2] },
  ];
}

// ============================================================================
// LUT GENERATION
// ============================================================================

/**
 * Generate the RGBA LUT data (Float16 or Float32 depending on use).
 * @param {Object} config
 * @param {Array} config.sizeCurve - N-point size curve (default: constant)
 * @param {Array} config.alphaCurve - N-point alpha curve (default: fadeInOut)
 * @param {Array} config.velocityCurve - N-point velocity curve (default: constant)
 * @returns {Float32Array} 256 × 4 floats (RGBA)
 */
export function generateCurveLUT(config = {}) {
  const sizeCurve = config.sizeCurve || CURVE_PRESETS.constant;
  const alphaCurve = config.alphaCurve || CURVE_PRESETS.fadeInOut;
  const velocityCurve = config.velocityCurve || CURVE_PRESETS.constant;

  const data = new Float32Array(LUT_WIDTH * 4);

  for (let i = 0; i < LUT_WIDTH; i++) {
    const t = i / (LUT_WIDTH - 1);
    data[i * 4 + 0] = Math.max(0, evaluateCurve(sizeCurve, t));
    data[i * 4 + 1] = Math.max(0, Math.min(1, evaluateCurve(alphaCurve, t)));
    data[i * 4 + 2] = Math.max(0, evaluateCurve(velocityCurve, t));
    data[i * 4 + 3] = 1.0;
  }

  return data;
}

// ============================================================================
// GPU TEXTURE UPLOAD
// ============================================================================

/**
 * Create a GPU 1D LUT texture for lifetime curves.
 * @param {GPUDevice} device
 * @param {Object} config - { sizeCurve, alphaCurve, velocityCurve }
 * @returns {Object} { texture, textureView, sampler }
 */
export function createCurveLUTTexture(device, config = {}) {
  const lutData = generateCurveLUT(config);

  const texture = device.createTexture({
    label: 'ParticleLifetimeCurves.LUT',
    size: [LUT_WIDTH, 1, 1],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  device.queue.writeTexture(
    { texture },
    lutData,
    { bytesPerRow: LUT_WIDTH * 16 },
    { width: LUT_WIDTH, height: 1 },
  );

  const textureView = texture.createView();
  const sampler = device.createSampler({
    magFilter: 'nearest',
    minFilter: 'nearest',
    addressModeU: 'clamp-to-edge',
  });

  return { texture, textureView, sampler };
}

/**
 * Update an existing LUT texture with new curve data.
 */
export function updateCurveLUTTexture(device, texture, config = {}) {
  const lutData = generateCurveLUT(config);
  device.queue.writeTexture(
    { texture },
    lutData,
    { bytesPerRow: LUT_WIDTH * 16 },
    { width: LUT_WIDTH, height: 1 },
  );
}

/**
 * Create a lifetime curves system for a particle world.
 * @param {GPUDevice} device
 * @param {Object} config
 * @returns {Object} System handle
 */
export function createLifetimeCurvesSystem(device, config = {}) {
  const lut = createCurveLUTTexture(device, config);

  return {
    device,
    texture: lut.texture,
    textureView: lut.textureView,
    sampler: lut.sampler,
    enabled: config.enabled !== false,
    config,
  };
}

/**
 * Update curves at runtime.
 */
export function setLifetimeCurves(system, config) {
  if (!system?.device || !system?.texture) return;
  Object.assign(system.config, config);
  updateCurveLUTTexture(system.device, system.texture, system.config);
}

/**
 * Destroy the system.
 */
export function destroyLifetimeCurvesSystem(system) {
  if (!system) return;
  if (system.texture) system.texture.destroy();
  system.texture = null;
  system.textureView = null;
  system.sampler = null;
}
