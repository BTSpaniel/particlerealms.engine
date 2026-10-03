// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { mulberry32 } from '../math/MathRandom.js';
import { bilinearSample } from '../math/MathGrid.js';
import { domMatrixInverse2DReport } from '../math/DOMGeometryMath.js';

/** Deterministic developer augmentation of observed ink, without text input. */
export function augmentHandwritingInk(pixels, { seed = 49137, strength = 1, signal } = {}) {
  signal?.throwIfAborted();
  if (!(pixels instanceof Uint8Array) || pixels.length !== 256 * 32 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isFinite(strength) || strength < 0 || strength > 1) throw new TypeError('Declare 256×32 ink pixels, an unsigned seed and augmentation strength in [0,1]');
  let left = 256, right = -1, top = 32, bottom = -1;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 256; x++) if (pixels[y * 256 + x]) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const identity = { method: 'bounded-affine-ink-augmentation', seed, strength, sourceToAugmented: [1, 0, 0, 1, 0, 0], contrast: 1, sourceInkBox: right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, transcriptUsed: false };
  if (!strength || right < left) return { pixels: pixels.slice(), provenance: identity };
  const random = mulberry32(seed), scaleX = 1 + (random() * .3 - .15) * strength, scaleY = 1 + (random() * .16 - .08) * strength, shear = (random() * .4 - .2) * strength;
  // Transform the complete observed pixel support, including half-pixel edges.
  // Fit that support inside the frame before sampling; no target word controls it.
  const corners = [[left - .5, top - .5], [right + .5, top - .5], [left - .5, bottom + .5], [right + .5, bottom + .5]].map(([x, y]) => [x * scaleX + y * shear, y * scaleY]);
  const x0 = Math.min(...corners.map(row => row[0])), x1 = Math.max(...corners.map(row => row[0])), y0 = Math.min(...corners.map(row => row[1])), y1 = Math.max(...corners.map(row => row[1]));
  const fit = Math.min(1, 252 / (x1 - x0), 28 / (y1 - y0)), width = (x1 - x0) * fit, height = (y1 - y0) * fit;
  const dx = 1.5 + random() * Math.min(3, 252 - width), dy = (31 - height) / 2 + (random() - .5) * Math.min(2, 28 - height), contrast = 1 + (random() * .3 - .2) * strength;
  const matrix = [scaleX * fit, 0, shear * fit, scaleY * fit, dx - x0 * fit, dy - y0 * fit], report = domMatrixInverse2DReport(matrix);
  if (!report.invertible) throw new Error('Bounded handwriting augmentation became non-invertible');
  const inverse = report.inverse, output = new Uint8Array(pixels.length);
  for (let y = 0; y < 32; y++) {
    signal?.throwIfAborted();
    for (let x = 0; x < 256; x++) {
      const sx = inverse.a * x + inverse.c * y + inverse.e, sy = inverse.b * x + inverse.d * y + inverse.f;
      if (sx < -.5 || sx > 255.5 || sy < -.5 || sy > 31.5) continue;
      output[y * 256 + x] = Math.max(0, Math.min(255, Math.round(bilinearSample(pixels, 256, 32, Math.max(0, Math.min(255, sx)), Math.max(0, Math.min(31, sy))) * contrast)));
    }
  }
  return { pixels: output, provenance: { ...identity, sourceToAugmented: matrix, contrast, transformedSupport: { x: dx, y: dy, width, height }, selected: { scaleX, scaleY, shear, fit } } };
}
