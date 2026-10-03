// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Matrix-free preconditioned conjugate gradient. The caller supplies a symmetric positive operator. */
export async function solveSparsePositive({ multiply, diagonal, rhs, initial = null, maxIterations = 256, tolerance = 1e-10, checkpoint = async () => {} }) {
  if (typeof multiply !== 'function' || !rhs || diagonal?.length !== rhs.length || (initial && initial.length !== rhs.length) || !Number.isInteger(maxIterations) || maxIterations < 0 || maxIterations > 10000 || !Number.isFinite(tolerance) || tolerance <= 0 || Array.from(rhs).some(value => !Number.isFinite(value)) || Array.from(diagonal).some(value => !Number.isFinite(value) || value <= 0)) throw new TypeError('Sparse positive solve requires finite vectors, a positive diagonal and bounded iterations');
  const n = rhs.length, x = initial ? Float64Array.from(initial) : new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n);
  const applied = multiply(x); let rz = 0, rhsNorm = 0;
  for (let i = 0; i < n; i++) { r[i] = rhs[i] - applied[i]; z[i] = r[i] / Math.max(1e-15, diagonal[i]); p[i] = z[i]; rz += r[i] * z[i]; rhsNorm += rhs[i] ** 2; }
  const threshold = tolerance ** 2 * Math.max(1, rhsNorm);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    await checkpoint();
    let residual = 0; for (const value of r) residual += value ** 2;
    if (residual <= threshold) return { x, converged: true, iterations: iteration, residual: Math.sqrt(residual) };
    const ap = multiply(p); let denominator = 0; for (let i = 0; i < n; i++) denominator += p[i] * ap[i];
    if (!(denominator > 0) || !Number.isFinite(denominator) || !Number.isFinite(rz)) return { x, converged: false, iterations: iteration, residual: Math.sqrt(residual) };
    const alpha = rz / denominator; let nextRz = 0;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * ap[i]; z[i] = r[i] / Math.max(1e-15, diagonal[i]); nextRz += r[i] * z[i]; }
    const beta = nextRz / rz; for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]; rz = nextRz;
  }
  let squared = 0; for (const value of r) squared += value * value;
  return { x, converged: squared <= threshold, iterations: maxIterations, residual: Math.sqrt(squared) };
}
