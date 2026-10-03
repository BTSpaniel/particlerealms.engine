// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { TRANSITION_TOPOLOGY_PROVENANCE } from './TransitionTopology.generated.js';
import {
  TRANSITION_FACE_ORDER,
  compareTransitionBoundarySignatures,
  createTransitionBoundarySignatures,
} from './TransitionBoundary.js';

function isArrayLike(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function point(values, index) {
  const offset = index * 3;
  return [Number(values[offset]), Number(values[offset + 1]), Number(values[offset + 2])];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lengthSquared(value) {
  return dot(value, value);
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function float64BitsHex(value) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, true);
  return `${view.getUint32(4, true).toString(16).padStart(8, '0')}${view.getUint32(0, true).toString(16).padStart(8, '0')}`;
}

function invalidReport(errors, warnings, counts = {}) {
  return Object.freeze({
    valid: false,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    counts: Object.freeze({
      vertices: 0,
      triangles: 0,
      edges: 0,
      boundaryEdges: 0,
      unexpectedBoundaryEdges: 0,
      nonManifoldEdges: 0,
      nonManifoldVertices: 0,
      inconsistentWindingEdges: 0,
      degenerateTriangles: 0,
      duplicateTriangles: 0,
      windingFailures: 0,
      ...counts,
    }),
    boundarySignatures: null,
  });
}

/**
 * Validate geometry, local manifoldness, winding, exact-2:1 metadata, and all
 * recorded boundary signatures.  Open edges are valid only on one of the six
 * transition-prism faces.
 */
export function validateTransitionInterface(mesh, options = {}) {
  const errors = [];
  const warnings = [];
  if (!mesh || typeof mesh !== 'object') return invalidReport(['A transition mesh object is required'], warnings);

  const positions = mesh.positions;
  const localPositions = mesh.localPositions;
  const indices = mesh.indices;
  const normals = mesh.normals;
  const triangleGradients = mesh.triangleGradients;
  if (!isArrayLike(positions) || !isArrayLike(localPositions) || !isArrayLike(indices)) {
    return invalidReport(['positions, localPositions, and indices must be arrays or typed arrays'], warnings);
  }
  if (positions.length % 3 !== 0) errors.push('Position length is not divisible by three');
  if (localPositions.length !== positions.length) errors.push('Local-position length does not match world positions');
  if (indices.length % 3 !== 0) errors.push('Index length is not divisible by three');
  if (errors.length) return invalidReport(errors, warnings);

  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  for (const value of positions) {
    if (!Number.isFinite(Number(value))) {
      errors.push('World positions contain a non-finite value');
      break;
    }
  }
  for (const value of localPositions) {
    if (!Number.isFinite(Number(value))) {
      errors.push('Local positions contain a non-finite value');
      break;
    }
  }
  if (isArrayLike(normals)) {
    if (normals.length !== positions.length) errors.push('Normal length does not match positions');
    else {
      let zeroNormals = 0;
      for (let index = 0; index < vertexCount; index++) {
        const normal = point(normals, index);
        if (!normal.every(Number.isFinite)) {
          errors.push('Normals contain a non-finite value');
          break;
        }
        if (lengthSquared(normal) <= 1e-20) zeroNormals++;
      }
      if (zeroNormals) warnings.push(`${zeroNormals} vertices have zero-length normals`);
    }
  } else if (vertexCount) {
    warnings.push('Vertex normals are not present');
  }

  const configuredAreaEpsilon = options.areaEpsilon ?? mesh.areaEpsilon;
  const areaEpsilon = Number.isFinite(configuredAreaEpsilon) && configuredAreaEpsilon >= 0 ? configuredAreaEpsilon : 1e-20;
  const relativeWindingEpsilon = Number.isFinite(options.relativeWindingEpsilon) && options.relativeWindingEpsilon >= 0
    ? options.relativeWindingEpsilon
    : 1e-8;
  const edges = new Map();
  const vertexLinks = Array.from({ length: vertexCount }, () => []);
  const triangleKeys = new Set();
  let degenerates = 0;
  let duplicates = 0;
  let windingFailures = 0;
  const hasGradientReferences = isArrayLike(triangleGradients) && triangleGradients.length === indices.length;
  if (triangleCount && !hasGradientReferences) warnings.push('Per-triangle scalar gradients are absent; outward scalar winding cannot be verified');
  if (isArrayLike(triangleGradients) && triangleGradients.length !== indices.length) errors.push('Triangle-gradient length does not match triangle count');

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    const offset = triangleIndex * 3;
    const triangle = [Number(indices[offset]), Number(indices[offset + 1]), Number(indices[offset + 2])];
    if (!triangle.every(index => Number.isInteger(index) && index >= 0 && index < vertexCount)) {
      errors.push(`Triangle ${triangleIndex} contains an out-of-range or non-integer index`);
      continue;
    }
    const canonicalTriangle = triangle.slice().sort((a, b) => a - b).join(':');
    if (triangleKeys.has(canonicalTriangle)) duplicates++;
    else triangleKeys.add(canonicalTriangle);

    const a = point(positions, triangle[0]);
    const b = point(positions, triangle[1]);
    const c = point(positions, triangle[2]);
    const faceNormal = cross(subtract(b, a), subtract(c, a));
    const areaSquared = lengthSquared(faceNormal);
    if (new Set(triangle).size !== 3 || !Number.isFinite(areaSquared) || areaSquared <= areaEpsilon) degenerates++;

    if (hasGradientReferences && areaSquared > areaEpsilon) {
      const gradient = point(triangleGradients, triangleIndex);
      const gradientSquared = lengthSquared(gradient);
      if (!gradient.every(Number.isFinite) || gradientSquared <= 1e-24) {
        windingFailures++;
      } else {
        const alignment = dot(faceNormal, gradient);
        const threshold = relativeWindingEpsilon * Math.sqrt(areaSquared * gradientSquared);
        if (!(alignment > threshold)) windingFailures++;
      }
    }

    vertexLinks[triangle[0]].push([triangle[1], triangle[2]]);
    vertexLinks[triangle[1]].push([triangle[2], triangle[0]]);
    vertexLinks[triangle[2]].push([triangle[0], triangle[1]]);

    for (const [start, end] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      const key = edgeKey(start, end);
      const direction = start < end ? 1 : -1;
      const incidence = edges.get(key);
      if (incidence) {
        incidence.count++;
        incidence.directionBalance += direction;
      } else {
        edges.set(key, { start, end, count: 1, directionBalance: direction });
      }
    }
  }

  const nonManifoldEdges = Array.from(edges.values()).filter(edge => edge.count > 2).length;
  const inconsistentWindingEdges = Array.from(edges.values()).filter(edge => edge.count === 2 && edge.directionBalance !== 0).length;
  const boundaryEdges = Array.from(edges.values()).filter(edge => edge.count === 1).length;
  const boundaryVertices = new Set();
  for (const edge of edges.values()) {
    if (edge.count === 1) {
      boundaryVertices.add(edge.start);
      boundaryVertices.add(edge.end);
    }
  }
  let nonManifoldVertices = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const linkEdges = vertexLinks[vertex];
    if (!linkEdges.length) {
      nonManifoldVertices++;
      continue;
    }
    const adjacency = new Map();
    for (const [a, b] of linkEdges) {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
    }
    const nodes = Array.from(adjacency.keys());
    const visited = new Set();
    const stack = nodes.length ? [nodes[0]] : [];
    while (stack.length) {
      const current = stack.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of adjacency.get(current) || []) if (!visited.has(neighbor)) stack.push(neighbor);
    }
    const degrees = nodes.map(node => adjacency.get(node).size);
    const connected = visited.size === nodes.length;
    const boundary = boundaryVertices.has(vertex);
    const validDegrees = boundary
      ? degrees.filter(degree => degree === 1).length === 2 && degrees.every(degree => degree === 1 || degree === 2)
      : degrees.every(degree => degree === 2);
    if (!connected || !validDegrees) nonManifoldVertices++;
  }
  if (degenerates) errors.push(`${degenerates} degenerate triangles detected`);
  if (duplicates) errors.push(`${duplicates} duplicate triangles detected`);
  if (nonManifoldEdges) errors.push(`${nonManifoldEdges} edges have more than two incident triangles`);
  if (nonManifoldVertices) errors.push(`${nonManifoldVertices} vertices have a non-manifold link`);
  if (inconsistentWindingEdges) errors.push(`${inconsistentWindingEdges} shared edges have inconsistent triangle winding`);
  if (windingFailures) errors.push(`${windingFailures} triangles fail outward scalar-gradient winding validation`);

  let boundaryReport = null;
  try {
    boundaryReport = createTransitionBoundarySignatures(mesh, {
      quantum: options.signatureQuantum ?? mesh.signatureQuantum,
      localTolerance: options.localBoundaryTolerance,
    });
    if (boundaryReport.unclassifiedEdges.length) {
      errors.push(`${boundaryReport.unclassifiedEdges.length} open edges do not lie on a transition-prism boundary face`);
    }
    if (mesh.boundarySignatures) {
      for (const face of TRANSITION_FACE_ORDER) {
        const comparison = compareTransitionBoundarySignatures(mesh.boundarySignatures[face], boundaryReport.signatures[face]);
        if (!comparison.compatible) errors.push(`Stored ${face} boundary signature is stale: ${comparison.reasons.join('; ')}`);
      }
    }
  } catch (error) {
    errors.push(`Boundary signature validation failed: ${error.message}`);
  }

  const fineDimensions = mesh.gridDimensions?.fine;
  const coarseDimensions = mesh.gridDimensions?.coarse;
  if (fineDimensions || coarseDimensions) {
    const validDimensions = isArrayLike(fineDimensions) && isArrayLike(coarseDimensions)
      && fineDimensions.length >= 2 && coarseDimensions.length >= 2
      && Number(fineDimensions[0]) === 2 * (Number(coarseDimensions[0]) - 1) + 1
      && Number(fineDimensions[1]) === 2 * (Number(coarseDimensions[1]) - 1) + 1;
    if (!validDimensions) errors.push('Grid metadata does not describe an exact 2:1 tangential sample ratio');
  } else {
    warnings.push('Grid dimensions are absent; exact 2:1 metadata cannot be verified');
  }

  if (mesh.provenance) {
    if (mesh.provenance.topologySha256 !== TRANSITION_TOPOLOGY_PROVENANCE.topologySha256) {
      errors.push('Topology provenance digest does not match the generated transition topology');
    }
    if (mesh.provenance.isoValueBits !== float64BitsHex(Number(mesh.isoValue))) errors.push('Provenance iso-value bits do not match the mesh isoValue');
    if (mesh.provenance.externalLookupTables !== false) errors.push('Provenance does not certify clean-room table-free construction');
    if (!Array.isArray(mesh.provenance.equivalenceClaims) || mesh.provenance.equivalenceClaims.length !== 0) {
      errors.push('Unverified transition-algorithm equivalence claims are present');
    }
  } else {
    warnings.push('Transition provenance metadata is absent');
  }

  const counts = Object.freeze({
    vertices: vertexCount,
    triangles: triangleCount,
    edges: edges.size,
    boundaryEdges,
    unexpectedBoundaryEdges: boundaryReport?.unclassifiedEdges.length ?? 0,
    nonManifoldEdges,
    nonManifoldVertices,
    inconsistentWindingEdges,
    degenerateTriangles: degenerates,
    duplicateTriangles: duplicates,
    windingFailures,
  });
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    counts,
    boundarySignatures: boundaryReport?.signatures || null,
  });
}
