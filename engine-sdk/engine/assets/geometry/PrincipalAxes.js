// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/geometry/PrincipalAxes.js — Principal Component Analysis of an
// EngineModel node's geometry. Small, dependency-free, GPU-free, and reusable:
// any engine system can ask for the natural axes of a mesh (oriented bounds,
// alignment, the axle of a wheel disc, the long axis of a barrel, etc.).
//
// PCA finds the orthogonal axes of greatest → least variance of the vertex
// cloud. A disc/cylinder is thin along its axle, so its axle is the axis of
// LEAST variance — orientation- and mirror-proof, unlike axis-aligned guesses.

/** Jacobi eigen-decomposition of a symmetric 3×3 (row-major length-9 array). */
export function eigSym3(m) {
  const a = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-12) continue;
      const phi = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
      const c = Math.cos(phi), s = Math.sin(phi);
      for (let k = 0; k < 3; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < 3; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < 3; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
    }
  }
  return {
    values: [a[0][0], a[1][1], a[2][2]],
    vectors: [[v[0][0], v[1][0], v[2][0]], [v[0][1], v[1][1], v[2][1]], [v[0][2], v[1][2], v[2][2]]],
  };
}

/** Collect the mesh-local position arrays for a node (or null if none). */
function nodePositions(model, nodeId) {
  const node = (model.nodes || []).find((n) => n.id === nodeId);
  const mesh = node && (model.meshes || []).find((mm) => mm.id === node.mesh);
  if (!mesh) return null;
  const prims = mesh.primitives
    .map((pid) => (model.primitives || []).find((p) => p.id === pid))
    .filter((p) => p?.attributes?.position);
  return prims.length ? prims.map((p) => p.attributes.position) : null;
}

/**
 * PCA of a node's mesh-local vertex cloud.
 * @returns {{centroid:number[], axes:number[][], values:number[]}|null}
 *   axes/values are sorted by DESCENDING variance (axes[0] = major, axes[2] = minor).
 */
export function principalAxes(model, nodeId, opts = {}) {
  const arrays = nodePositions(model, nodeId);
  if (!arrays) return null;
  let n = 0; const c = [0, 0, 0];
  for (const a of arrays) for (let i = 0; i < a.length; i += 3) { c[0] += a[i]; c[1] += a[i + 1]; c[2] += a[i + 2]; n++; }
  if (n < (opts.minVerts ?? 8)) return null;
  c[0] /= n; c[1] /= n; c[2] /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - c[0], dy = a[i + 1] - c[1], dz = a[i + 2] - c[2];
      xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz;
    }
  }
  const { values, vectors } = eigSym3([xx / n, xy / n, xz / n, xy / n, yy / n, yz / n, xz / n, yz / n, zz / n]);
  const order = [0, 1, 2].sort((i, j) => values[j] - values[i]); // descending variance
  return {
    centroid: c,
    axes: order.map((i) => vectors[i]),
    values: order.map((i) => values[i]),
  };
}

/** Convenience: the axis of LEAST variance (e.g. a wheel/disc axle), or null. */
export function leastVarianceAxis(model, nodeId, opts = {}) {
  const pca = principalAxes(model, nodeId, opts);
  return pca ? { centroid: pca.centroid, axis: pca.axes[2] } : null;
}
