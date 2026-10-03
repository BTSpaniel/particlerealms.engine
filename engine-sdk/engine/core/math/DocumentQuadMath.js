// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { mat3Determinant, mat3Inverse, mat3Multiply, mat3TransformVec3 } from './MathMat.js';
import { orientation2DReport } from './RobustNumericMath.js';
import { bilinearSample } from './MathGrid.js';

const UNIT_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const UNIT_PROJECTIVE_BASIS_INVERSE = mat3Inverse([0, 0, -1, 1, 0, 1, 0, 1, 1]);

/** Map a unit rectangle into a convex, ordered document quadrilateral. */
export function documentQuadTransform(points) {
  if (!Array.isArray(points) || points.length !== 4 || points.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y) || Math.abs(point.x) > 32768 || Math.abs(point.y) > 32768)) throw new TypeError('Use four bounded document corners in reading order');
  const turns = points.map((point, index) => orientation2DReport(point, points[(index + 1) % 4], points[(index + 2) % 4]));
  if (turns.some(turn => !turn.stable || turn.orientation !== turns[0].orientation || Math.abs(turn.determinant) < 1e-3)) throw new RangeError('Document corners must form a non-degenerate convex quadrilateral');
  const [a, b, c, d] = points, basis = [a.x, a.y, 1, b.x, b.y, 1, d.x, d.y, 1];
  if (Math.abs(mat3Determinant(basis)) < 1e-3) throw new RangeError('Document corner basis is singular');
  const coefficients = mat3TransformVec3(mat3Inverse(basis), [c.x, c.y, 1]);
  const scaled = basis.map((value, index) => value * coefficients[Math.floor(index / 3)]), matrix = mat3Multiply(scaled, UNIT_PROJECTIVE_BASIS_INVERSE);
  if (!Number.isFinite(matrix[8]) || Math.abs(matrix[8]) < 1e-8) throw new RangeError('Document perspective has an unstable homogeneous scale');
  const normalized = Float64Array.from(matrix, value => value / matrix[8]);
  for (let index = 0; index < 4; index++) {
    const [u, v] = UNIT_CORNERS[index], [x, y, w] = mat3TransformVec3(normalized, [u, v, 1]);
    if (w < 1e-5 || Math.hypot(x / w - points[index].x, y / w - points[index].y) > .05) throw new RangeError('Document perspective failed its corner readback');
  }
  return { matrix: Array.from(normalized), corners: points.map(({ x, y }) => ({ x, y })), sourceWidth: (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - d.x, c.y - d.y)) / 2,
    sourceHeight: (Math.hypot(d.x - a.x, d.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y)) / 2, coordinateUnit: 'source-image-pixels' };
}

/** Bounded grayscale perspective sampling, shared by document and OCR callers. */
export function rectifyDocumentQuad(source, points, { width, height, signal } = {}) {
  signal?.throwIfAborted();
  if (!Number.isInteger(source?.width) || !Number.isInteger(source?.height) || source.width < 2 || source.height < 2 || source.width > 16384 || source.height > 16384 || source.width * source.height > 67108864 || !(source.data instanceof Float32Array || source.data instanceof Uint8Array || source.data instanceof Uint8ClampedArray) || source.data.length !== source.width * source.height) throw new TypeError('Use a bounded grayscale source raster');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 4096 || height > 4096 || width * height > 4194304) throw new RangeError('Declare a bounded rectified raster size');
  const transform = documentQuadTransform(points), matrix = transform.matrix, output = new Float32Array(width * height);
  // Coordinates denote source pixel edges. Sample output pixel centers and
  // convert back to scalar-grid centers before Engine bilinear interpolation.
  for (let y = 0; y < height; y++) {
    signal?.throwIfAborted();
    for (let x = 0; x < width; x++) {
      const [hx, hy, w] = mat3TransformVec3(matrix, [(x + .5) / width, (y + .5) / height, 1]), sx = hx / w - .5, sy = hy / w - .5;
      let value = 255;
      if (sx >= -.5 && sy >= -.5 && sx <= source.width - .5 && sy <= source.height - .5) value = bilinearSample(source.data, source.width, source.height, Math.max(0, Math.min(source.width - 1, sx)), Math.max(0, Math.min(source.height - 1, sy)));
      if (!Number.isFinite(value) || value < -.001 || value > 255.001) throw new RangeError('Document source contains invalid luminance');
      output[y * width + x] = Math.max(0, Math.min(255, value));
    }
  }
  return { width, height, data: output, transform: { ...transform, method: 'planar-projective-rectification', outputWidth: width, outputHeight: height, outsideSource: 'white' } };
}
