// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const JACOBI_ITERATIONS = 24;

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(length) || length <= 1e-12) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function jacobiEigenSymmetric3(matrix) {
  const a = matrix.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const idx = (r, c) => r * 3 + c;
  for (let iteration = 0; iteration < JACOBI_ITERATIONS; iteration++) {
    let p = 0; let q = 1; let largest = Math.abs(a[1]);
    if (Math.abs(a[2]) > largest) { p = 0; q = 2; largest = Math.abs(a[2]); }
    if (Math.abs(a[5]) > largest) { p = 1; q = 2; largest = Math.abs(a[5]); }
    if (largest < 1e-10) break;
    const app = a[idx(p, p)];
    const aqq = a[idx(q, q)];
    const apq = a[idx(p, q)];
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(angle); const s = Math.sin(angle);
    for (let k = 0; k < 3; k++) {
      const aik = a[idx(p, k)]; const aqk = a[idx(q, k)];
      a[idx(p, k)] = c * aik - s * aqk;
      a[idx(q, k)] = s * aik + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const aki = a[idx(k, p)]; const akq = a[idx(k, q)];
      a[idx(k, p)] = c * aki - s * akq;
      a[idx(k, q)] = s * aki + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const vip = v[idx(k, p)]; const viq = v[idx(k, q)];
      v[idx(k, p)] = c * vip - s * viq;
      v[idx(k, q)] = s * vip + c * viq;
    }
  }
  return { values: [a[0], a[4], a[8]], vectors: v };
}

/**
 * Rank-aware QEF solver using a Jacobi eigendecomposition of the local normal
 * covariance and a truncated pseudoinverse. Coordinates are translated to the
 * cell center before solving to preserve f32-compatible numerical scale.
 */
export function solveQef(intersections, normals, bounds, options = {}) {
  if (!Array.isArray(intersections) || !Array.isArray(normals) || intersections.length !== normals.length || !intersections.length) {
    throw new TypeError('QEF requires matching non-empty intersection and normal arrays');
  }
  if (!bounds || bounds.length < 6 || !Array.from(bounds).every(Number.isFinite)) throw new TypeError('QEF bounds must contain six finite values');
  const center = [(bounds[0] + bounds[3]) * 0.5, (bounds[1] + bounds[4]) * 0.5, (bounds[2] + bounds[5]) * 0.5];
  const ata = new Array(9).fill(0);
  const atb = [0, 0, 0];
  const mass = [0, 0, 0];
  let accepted = 0;
  for (let i = 0; i < intersections.length; i++) {
    const p = intersections[i]; const n = normalize3(normals[i]);
    if (!p || p.length < 3 || !Array.from(p).slice(0, 3).every(Number.isFinite) || !n) continue;
    const local = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    const b = n[0] * local[0] + n[1] * local[1] + n[2] * local[2];
    for (let r = 0; r < 3; r++) {
      atb[r] += n[r] * b;
      for (let c = 0; c < 3; c++) ata[r * 3 + c] += n[r] * n[c];
    }
    mass[0] += local[0]; mass[1] += local[1]; mass[2] += local[2]; accepted++;
  }
  if (!accepted) throw new Error('QEF contains no valid Hermite samples');
  mass[0] /= accepted; mass[1] /= accepted; mass[2] /= accepted;
  const { values, vectors } = jacobiEigenSymmetric3(ata);
  const maxEigen = Math.max(...values.map(Math.abs), 1e-12);
  const threshold = Math.max(options.absoluteThreshold ?? 1e-8, maxEigen * (options.relativeThreshold ?? 1e-4));
  const solution = mass.slice();
  let rank = 0;
  for (let column = 0; column < 3; column++) {
    const eigen = values[column];
    if (Math.abs(eigen) <= threshold) continue;
    rank++;
    const axis = [vectors[column], vectors[3 + column], vectors[6 + column]];
    const rhs = axis[0] * atb[0] + axis[1] * atb[1] + axis[2] * atb[2];
    const massProjection = axis[0] * mass[0] + axis[1] * mass[1] + axis[2] * mass[2];
    const delta = rhs / eigen - massProjection;
    solution[0] += axis[0] * delta; solution[1] += axis[1] * delta; solution[2] += axis[2] * delta;
  }
  let position = [solution[0] + center[0], solution[1] + center[1], solution[2] + center[2]];
  const outside = position[0] < bounds[0] || position[0] > bounds[3]
    || position[1] < bounds[1] || position[1] > bounds[4]
    || position[2] < bounds[2] || position[2] > bounds[5];
  if (outside || !position.every(Number.isFinite)) {
    position = [mass[0] + center[0], mass[1] + center[1], mass[2] + center[2]];
  }
  let error = 0;
  for (let i = 0; i < intersections.length; i++) {
    const n = normalize3(normals[i]); const p = intersections[i];
    if (!n || !p) continue;
    const d = n[0] * (position[0] - p[0]) + n[1] * (position[1] - p[1]) + n[2] * (position[2] - p[2]);
    error += d * d;
  }
  return Object.freeze({ position: Object.freeze(position), rank, error, usedMassPointFallback: outside });
}

