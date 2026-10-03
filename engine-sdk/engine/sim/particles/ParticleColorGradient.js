// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleColorGradient.js - N-point color gradient for particles
 * 
 * Niagara/PopcornFX parity: arbitrary color ramps over particle lifetime.
 * Replaces the 2-point linear (color → colorEnd) with full gradient control.
 * 
 * CPU builds a 1D RGBA LUT texture, GPU samples with t = age/lifetime.
 * 
 * Usage:
 *   const grad = createColorGradient([
 *     { t: 0.0, color: [1, 0.6, 0.1, 0.0] },  // orange, transparent
 *     { t: 0.2, color: [1, 0.8, 0.2, 1.0] },  // bright yellow, full
 *     { t: 0.7, color: [0.8, 0.2, 0.0, 0.8] }, // red
 *     { t: 1.0, color: [0.3, 0.3, 0.3, 0.0] }, // grey smoke, fade out
 *   ]);
 *   const texture = uploadGradientTexture(device, grad);
 */

// ============================================================================
// GRADIENT DATA STRUCTURE
// ============================================================================

/**
 * Create a color gradient from an array of color stops
 * @param {Array<{t: number, color: number[]}>} stops - Color stops sorted by t (0-1)
 *   Each color is [r, g, b] or [r, g, b, a] with values 0-1
 * @param {number} resolution - LUT texture width (default 64, power of 2)
 * @returns {{ data: Float32Array, resolution: number, stops: Array }}
 */
export function createColorGradient(stops, resolution = 64) {
  if (!stops || stops.length === 0) {
    stops = [{ t: 0, color: [1, 1, 1, 1] }, { t: 1, color: [1, 1, 1, 1] }];
  }

  // Ensure stops are sorted by t
  const sorted = [...stops].sort((a, b) => a.t - b.t);

  // Ensure first stop is at t=0 and last at t=1
  if (sorted[0].t > 0) sorted.unshift({ t: 0, color: sorted[0].color });
  if (sorted[sorted.length - 1].t < 1) sorted.push({ t: 1, color: sorted[sorted.length - 1].color });

  // Normalize colors to RGBA
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i].color;
    sorted[i].color = [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1];
  }

  // Build LUT by sampling gradient at each texel
  const data = new Float32Array(resolution * 4);
  for (let i = 0; i < resolution; i++) {
    const t = i / (resolution - 1);
    const rgba = sampleGradient(sorted, t);
    data[i * 4 + 0] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }

  return { data, resolution, stops: sorted };
}

/**
 * Sample a color gradient at a given t value
 * @param {Array<{t: number, color: number[]}>} stops - Sorted color stops
 * @param {number} t - Position along gradient (0-1)
 * @returns {number[]} [r, g, b, a]
 */
export function sampleGradient(stops, t) {
  if (t <= stops[0].t) return [...stops[0].color];
  if (t >= stops[stops.length - 1].t) return [...stops[stops.length - 1].color];

  // Find the two stops that bracket t
  let lo = 0;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].t >= t) { lo = i - 1; break; }
  }
  const hi = lo + 1;
  const range = stops[hi].t - stops[lo].t;
  const frac = range > 0 ? (t - stops[lo].t) / range : 0;

  // Smooth interpolation (smoothstep for nicer transitions)
  const s = frac * frac * (3 - 2 * frac);

  const a = stops[lo].color;
  const b = stops[hi].color;
  return [
    a[0] + (b[0] - a[0]) * s,
    a[1] + (b[1] - a[1]) * s,
    a[2] + (b[2] - a[2]) * s,
    a[3] + (b[3] - a[3]) * s,
  ];
}

// ============================================================================
// PRESET GRADIENTS (common VFX patterns)
// ============================================================================

export const GRADIENT_PRESETS = {
  fire: [
    { t: 0.0, color: [1.0, 0.9, 0.4, 0.0] },
    { t: 0.1, color: [1.0, 0.7, 0.1, 1.0] },
    { t: 0.4, color: [0.9, 0.3, 0.0, 0.9] },
    { t: 0.7, color: [0.4, 0.1, 0.0, 0.5] },
    { t: 1.0, color: [0.15, 0.15, 0.15, 0.0] },
  ],
  smoke: [
    { t: 0.0, color: [0.6, 0.6, 0.6, 0.0] },
    { t: 0.15, color: [0.5, 0.5, 0.5, 0.6] },
    { t: 0.5, color: [0.4, 0.4, 0.42, 0.4] },
    { t: 1.0, color: [0.3, 0.3, 0.32, 0.0] },
  ],
  magic: [
    { t: 0.0, color: [0.3, 0.1, 1.0, 0.0] },
    { t: 0.2, color: [0.6, 0.2, 1.0, 1.0] },
    { t: 0.5, color: [0.2, 0.8, 1.0, 0.8] },
    { t: 0.8, color: [0.1, 0.5, 1.0, 0.4] },
    { t: 1.0, color: [0.0, 0.2, 0.5, 0.0] },
  ],
  explosion: [
    { t: 0.0, color: [1.0, 1.0, 0.9, 1.0] },
    { t: 0.05, color: [1.0, 0.9, 0.3, 1.0] },
    { t: 0.2, color: [1.0, 0.5, 0.0, 0.9] },
    { t: 0.5, color: [0.6, 0.2, 0.0, 0.6] },
    { t: 0.8, color: [0.2, 0.2, 0.2, 0.3] },
    { t: 1.0, color: [0.1, 0.1, 0.1, 0.0] },
  ],
  water: [
    { t: 0.0, color: [0.6, 0.85, 1.0, 0.2] },
    { t: 0.3, color: [0.3, 0.7, 1.0, 0.8] },
    { t: 0.7, color: [0.2, 0.5, 0.9, 0.6] },
    { t: 1.0, color: [0.1, 0.3, 0.7, 0.0] },
  ],
  spark: [
    { t: 0.0, color: [1.0, 1.0, 0.8, 1.0] },
    { t: 0.3, color: [1.0, 0.7, 0.2, 1.0] },
    { t: 0.7, color: [0.8, 0.3, 0.0, 0.6] },
    { t: 1.0, color: [0.3, 0.1, 0.0, 0.0] },
  ],
  snow: [
    { t: 0.0, color: [1.0, 1.0, 1.0, 0.0] },
    { t: 0.1, color: [0.98, 0.98, 1.0, 0.9] },
    { t: 0.8, color: [0.95, 0.95, 1.0, 0.8] },
    { t: 1.0, color: [0.9, 0.9, 1.0, 0.0] },
  ],
  plasma: [
    { t: 0.0, color: [0.5, 0.0, 1.0, 0.0] },
    { t: 0.15, color: [0.8, 0.2, 1.0, 1.0] },
    { t: 0.4, color: [1.0, 0.5, 0.8, 0.9] },
    { t: 0.7, color: [0.4, 0.1, 0.8, 0.5] },
    { t: 1.0, color: [0.1, 0.0, 0.3, 0.0] },
  ],
};

// ============================================================================
// GPU TEXTURE UPLOAD
// ============================================================================

/**
 * Upload a color gradient as a 1D GPU texture for shader sampling
 * @param {GPUDevice} device
 * @param {{ data: Float32Array, resolution: number }} gradient - From createColorGradient
 * @returns {{ texture: GPUTexture, view: GPUTextureView, sampler: GPUSampler }}
 */
export function uploadGradientTexture(device, gradient) {
  const { data, resolution } = gradient;

  // Convert Float32 RGBA to Uint8 RGBA for rgba8unorm texture
  const rgba8 = new Uint8Array(resolution * 4);
  for (let i = 0; i < resolution * 4; i++) {
    rgba8[i] = Math.max(0, Math.min(255, Math.round(data[i] * 255)));
  }

  const texture = device.createTexture({
    size: { width: resolution, height: 1, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    label: 'ParticleColorGradient',
  });

  device.queue.writeTexture(
    { texture },
    rgba8,
    { bytesPerRow: resolution * 4 },
    { width: resolution, height: 1 },
  );

  const view = texture.createView();
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
  });

  return { texture, view, sampler };
}

/**
 * Destroy a gradient texture
 */
export function destroyGradientTexture(gradientTexture) {
  if (gradientTexture?.texture) {
    gradientTexture.texture.destroy();
  }
}

// ============================================================================
// UTILITY: Convert legacy 2-point color to gradient
// ============================================================================

/**
 * Convert a legacy color/colorEnd pair to a gradient
 * @param {number[]} color - Start color [r, g, b]
 * @param {number[]} colorEnd - End color [r, g, b]
 * @param {number[]} alphaOverLife - [start, mid, end] alpha curve
 * @returns {Array<{t: number, color: number[]}>}
 */
export function gradientFromLegacy(color, colorEnd, alphaOverLife = [1, 1, 1]) {
  return [
    { t: 0.0, color: [color[0], color[1], color[2], alphaOverLife[0]] },
    { t: 0.5, color: [
      (color[0] + colorEnd[0]) * 0.5,
      (color[1] + colorEnd[1]) * 0.5,
      (color[2] + colorEnd[2]) * 0.5,
      alphaOverLife[1],
    ]},
    { t: 1.0, color: [colorEnd[0], colorEnd[1], colorEnd[2], alphaOverLife[2]] },
  ];
}
