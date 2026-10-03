// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function triangleAreaSquared(positions, a, b, c) {
  const ax = positions[a * 3]; const ay = positions[a * 3 + 1]; const az = positions[a * 3 + 2];
  const abx = positions[b * 3] - ax; const aby = positions[b * 3 + 1] - ay; const abz = positions[b * 3 + 2] - az;
  const acx = positions[c * 3] - ax; const acy = positions[c * 3 + 1] - ay; const acz = positions[c * 3 + 2] - az;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return cx * cx + cy * cy + cz * cz;
}

/**
 * Validate finite indexed triangle geometry and, when requested, prove an
 * oriented closed 2-manifold index topology. This is shared by authored
 * indexed Nexels and extracted surface-cache publication.
 */
export function validateIndexedTriangleMesh(mesh, options = {}) {
  const positions = mesh?.positions;
  const normals = mesh?.normals ?? null;
  const indices = mesh?.indices;
  const topologyRequirement = options.topologyRequirement || 'unspecified';
  const errors = [];
  const warnings = [];
  if ((!Array.isArray(positions) && !ArrayBuffer.isView(positions))
      || (!Array.isArray(indices) && !ArrayBuffer.isView(indices))) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(['Position and index buffers are required']),
      warnings: Object.freeze([]),
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      inconsistentWindingEdges: 0,
      degenerates: 0,
      duplicateTriangles: 0,
    });
  }
  if (positions.length % 3 !== 0 || indices.length % 3 !== 0) errors.push('Invalid vertex/index buffer lengths');
  if (normals && normals.length !== positions.length) errors.push('Normal buffer length does not match positions');
  for (const value of positions) {
    if (!Number.isFinite(Number(value))) {
      errors.push('Non-finite position');
      break;
    }
  }
  if (normals) {
    for (const value of normals) {
      if (!Number.isFinite(Number(value))) {
        errors.push('Non-finite normal');
        break;
      }
    }
  }
  const vertexCount = positions.length / 3;
  const edgeRecords = new Map();
  const triangles = new Set();
  let degenerates = 0;
  let duplicateTriangles = 0;
  let outOfRange = false;
  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const a = Number(indices[offset]);
    const b = Number(indices[offset + 1]);
    const c = Number(indices[offset + 2]);
    if (![a, b, c].every(index => Number.isSafeInteger(index) && index >= 0 && index < vertexCount)) {
      outOfRange = true;
      continue;
    }
    const canonicalTriangle = [a, b, c].sort((left, right) => left - right).join(':');
    if (triangles.has(canonicalTriangle)) duplicateTriangles += 1;
    else triangles.add(canonicalTriangle);
    if (a === b || b === c || c === a || triangleAreaSquared(positions, a, b, c) <= 1e-20) {
      degenerates += 1;
    }
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      const key = `${low}:${high}`;
      const record = edgeRecords.get(key) || { count: 0, orientation: 0 };
      record.count += 1;
      record.orientation += start < end ? 1 : -1;
      edgeRecords.set(key, record);
    }
  }
  if (outOfRange) errors.push('Index out of range');
  if (degenerates) errors.push(`${degenerates} degenerate triangles`);
  if (duplicateTriangles) errors.push(`${duplicateTriangles} duplicate triangles`);
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentWindingEdges = 0;
  for (const record of edgeRecords.values()) {
    if (record.count === 1) boundaryEdges += 1;
    if (record.count > 2) nonManifoldEdges += 1;
    if (record.count === 2 && record.orientation !== 0) inconsistentWindingEdges += 1;
  }
  if (nonManifoldEdges) errors.push(`${nonManifoldEdges} non-manifold edges`);
  if (inconsistentWindingEdges) errors.push(`${inconsistentWindingEdges} shared edges have inconsistent winding`);
  if (topologyRequirement === 'closed-2-manifold' && boundaryEdges) {
    errors.push(`${boundaryEdges} open boundary edges violate closed-2-manifold`);
  } else if (boundaryEdges) {
    warnings.push(`${boundaryEdges} open boundary edges`);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    boundaryEdges,
    nonManifoldEdges,
    inconsistentWindingEdges,
    degenerates,
    duplicateTriangles,
  });
}

export default validateIndexedTriangleMesh;
