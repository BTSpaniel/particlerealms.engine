// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Deterministic CPU reference implementation for tetrahedral-cage ray tracing.
 *
 * Dense source triangles are clipped into rest-space tetrahedra once. Animation
 * then moves only the cage vertices. A ray is transformed from deformed space
 * back into each tetrahedron's rest space before traversing its static micro-BVH.
 * The packed buffers mirror storage-buffer layouts that can be consumed by WGSL.
 */

export const TETRAHEDRAL_CAGE_INVALID_INDEX = 0xffffffff;
export const TETRAHEDRAL_CAGE_ASSET_VERSION = 1;

/**
 * Clean-room boundary for this repository-native implementation. The module was
 * designed independently from public technique descriptions and uses original
 * APIs, data layouts, math, tests, and deterministic BVH construction. No third-
 * party source code, shader code, binary assets, or proprietary layouts are used.
 */
export const TETRAHEDRAL_CAGE_PROVENANCE = Object.freeze({
  implementation: 'particle-realms-independent-clean-room',
  designInput: 'public-technique-description',
  copiedThirdPartyCode: false,
  copiedThirdPartyAssets: false,
  copiedProprietaryLayouts: false,
});

export const TETRAHEDRAL_CAGE_GPU_LAYOUT = Object.freeze({
  restCageVertexStrideBytes: 16,
  deformedCageVertexStrideBytes: 16,
  tetrahedronStrideBytes: 16,
  tetrahedronMetadataStrideBytes: 16,
  microTriangleRangeStrideBytes: 16,
  bvhNodeStrideBytes: 32,
  microTriangleStrideBytes: 48,
  microTriangleMetadataStrideBytes: 16,
  microTriangleBarycentricStrideBytes: 48,
  transformStrideBytes: 96,
  transformRowsPerTetrahedron: 6,
});

const DEFAULT_EPSILON = 1e-9;
const DEFAULT_AREA_EPSILON = 1e-14;
const DEFAULT_MAX_LEAF_SIZE = 4;

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.name = 'TetrahedralCageError';
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

function finiteFlatArray(value, stride, name, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    fail('INVALID_ARRAY', `${name} must be an array or typed array`);
  }
  const result = Float64Array.from(value);
  if ((!allowEmpty && result.length === 0) || result.length % stride !== 0) {
    fail('INVALID_ARRAY_LENGTH', `${name} length must be a${allowEmpty ? ' possibly empty' : ' non-empty'} multiple of ${stride}`);
  }
  for (let index = 0; index < result.length; index++) {
    if (!Number.isFinite(result[index])) {
      fail('NON_FINITE_VALUE', `${name}[${index}] must be finite`);
    }
  }
  return result;
}

function indexArray(value, stride, name, upperBound) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    fail('INVALID_ARRAY', `${name} must be an array or typed array`);
  }
  if (value.length === 0 || value.length % stride !== 0) {
    fail('INVALID_ARRAY_LENGTH', `${name} length must be a non-empty multiple of ${stride}`);
  }
  const result = new Uint32Array(value.length);
  for (let index = 0; index < value.length; index++) {
    const entry = Number(value[index]);
    if (!Number.isSafeInteger(entry) || entry < 0 || entry >= upperBound) {
      fail('INDEX_OUT_OF_RANGE', `${name}[${index}] is outside [0, ${upperBound})`, { index, entry, upperBound });
    }
    result[index] = entry;
  }
  return result;
}

function vec3(array, index) {
  const offset = index * 3;
  return [array[offset], array[offset + 1], array[offset + 2]];
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

function length3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize3(value) {
  const length = length3(value);
  return length > DEFAULT_EPSILON
    ? [value[0] / length, value[1] / length, value[2] / length]
    : [0, 0, 0];
}

function triangleArea(a, b, c) {
  return length3(cross(subtract(b, a), subtract(c, a))) * 0.5;
}

function determinant3(matrix) {
  return matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7])
    - matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6])
    + matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6]);
}

function inverse3(matrix, minimumDeterminant, label) {
  const determinant = determinant3(matrix);
  // Dimensionless conditioning threshold, shared with the f32 GPU path. An
  // absolute determinant would incorrectly reject small but well-shaped cells.
  const scale = Math.hypot(matrix[0], matrix[3], matrix[6])
    * Math.hypot(matrix[1], matrix[4], matrix[7]) * Math.hypot(matrix[2], matrix[5], matrix[8]);
  if (!Number.isFinite(determinant) || !Number.isFinite(scale) || scale === 0
    || Math.abs(determinant) <= minimumDeterminant * scale) {
    fail('DEGENERATE_TETRAHEDRON', `${label} is singular or below the determinant threshold`, {
      determinant,
      minimumDeterminant,
    });
  }
  const inverseDeterminant = 1 / determinant;
  return {
    determinant,
    matrix: [
      (matrix[4] * matrix[8] - matrix[5] * matrix[7]) * inverseDeterminant,
      (matrix[2] * matrix[7] - matrix[1] * matrix[8]) * inverseDeterminant,
      (matrix[1] * matrix[5] - matrix[2] * matrix[4]) * inverseDeterminant,
      (matrix[5] * matrix[6] - matrix[3] * matrix[8]) * inverseDeterminant,
      (matrix[0] * matrix[8] - matrix[2] * matrix[6]) * inverseDeterminant,
      (matrix[2] * matrix[3] - matrix[0] * matrix[5]) * inverseDeterminant,
      (matrix[3] * matrix[7] - matrix[4] * matrix[6]) * inverseDeterminant,
      (matrix[1] * matrix[6] - matrix[0] * matrix[7]) * inverseDeterminant,
      (matrix[0] * matrix[4] - matrix[1] * matrix[3]) * inverseDeterminant,
    ],
  };
}

function multiply3(left, right) {
  const result = new Array(9);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      result[row * 3 + column] = left[row * 3] * right[column]
        + left[row * 3 + 1] * right[column + 3]
        + left[row * 3 + 2] * right[column + 6];
    }
  }
  return result;
}

function transformLinear(matrix, value) {
  return [
    matrix[0] * value[0] + matrix[1] * value[1] + matrix[2] * value[2],
    matrix[3] * value[0] + matrix[4] * value[1] + matrix[5] * value[2],
    matrix[6] * value[0] + matrix[7] * value[1] + matrix[8] * value[2],
  ];
}

function transformPoint12(matrix, value) {
  return [
    matrix[0] * value[0] + matrix[1] * value[1] + matrix[2] * value[2] + matrix[3],
    matrix[4] * value[0] + matrix[5] * value[1] + matrix[6] * value[2] + matrix[7],
    matrix[8] * value[0] + matrix[9] * value[1] + matrix[10] * value[2] + matrix[11],
  ];
}

function transformDirection12(matrix, value) {
  return [
    matrix[0] * value[0] + matrix[1] * value[1] + matrix[2] * value[2],
    matrix[4] * value[0] + matrix[5] * value[1] + matrix[6] * value[2],
    matrix[8] * value[0] + matrix[9] * value[1] + matrix[10] * value[2],
  ];
}

function basisFromTetrahedron(vertices) {
  const [p0, p1, p2, p3] = vertices;
  return [
    p1[0] - p0[0], p2[0] - p0[0], p3[0] - p0[0],
    p1[1] - p0[1], p2[1] - p0[1], p3[1] - p0[1],
    p1[2] - p0[2], p2[2] - p0[2], p3[2] - p0[2],
  ];
}

function affine12(linear, translation) {
  return [
    linear[0], linear[1], linear[2], translation[0],
    linear[3], linear[4], linear[5], translation[1],
    linear[6], linear[7], linear[8], translation[2],
  ];
}

function tetrahedronBounds(vertices, inflation = 0) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return {
    min: min.map(value => value - inflation),
    max: max.map(value => value + inflation),
  };
}

function triangleBounds(vertices) {
  return tetrahedronBounds(vertices);
}

function boundsOverlap(left, right, epsilon) {
  return left.min[0] <= right.max[0] + epsilon && left.max[0] + epsilon >= right.min[0]
    && left.min[1] <= right.max[1] + epsilon && left.max[1] + epsilon >= right.min[1]
    && left.min[2] <= right.max[2] + epsilon && left.max[2] + epsilon >= right.min[2];
}

function boundsUnion(indices, primitiveBounds) {
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const index of indices) {
    const source = primitiveBounds[index];
    for (let axis = 0; axis < 3; axis++) {
      bounds.min[axis] = Math.min(bounds.min[axis], source.min[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], source.max[axis]);
    }
  }
  return bounds;
}

function buildDeterministicBvh(primitiveIndices, primitiveBounds, maxLeafSize) {
  if (primitiveIndices.length === 0) return { nodes: [], order: [], root: TETRAHEDRAL_CAGE_INVALID_INDEX };
  const nodes = [{}];
  const order = [];

  const buildNode = (nodeIndex, indices) => {
    const bounds = boundsUnion(indices, primitiveBounds);
    if (indices.length <= maxLeafSize) {
      const sorted = [...indices].sort((left, right) => left - right);
      nodes[nodeIndex] = { ...bounds, leftFirst: order.length, count: sorted.length };
      order.push(...sorted);
      return;
    }

    const centroidMin = [Infinity, Infinity, Infinity];
    const centroidMax = [-Infinity, -Infinity, -Infinity];
    for (const primitiveIndex of indices) {
      const primitive = primitiveBounds[primitiveIndex];
      for (let axis = 0; axis < 3; axis++) {
        const value = (primitive.min[axis] + primitive.max[axis]) * 0.5;
        centroidMin[axis] = Math.min(centroidMin[axis], value);
        centroidMax[axis] = Math.max(centroidMax[axis], value);
      }
    }
    const extents = centroidMax.map((value, axis) => value - centroidMin[axis]);
    let axis = 0;
    if (extents[1] > extents[axis]) axis = 1;
    if (extents[2] > extents[axis]) axis = 2;
    const sorted = [...indices].sort((left, right) => {
      const leftBounds = primitiveBounds[left];
      const rightBounds = primitiveBounds[right];
      const difference = (leftBounds.min[axis] + leftBounds.max[axis])
        - (rightBounds.min[axis] + rightBounds.max[axis]);
      return difference || left - right;
    });
    const middle = Math.floor(sorted.length / 2);
    const leftChild = nodes.length;
    nodes.push({}, {});
    nodes[nodeIndex] = { ...bounds, leftFirst: leftChild, count: 0 };
    buildNode(leftChild, sorted.slice(0, middle));
    buildNode(leftChild + 1, sorted.slice(middle));
  };

  buildNode(0, [...primitiveIndices]);
  return { nodes, order, root: 0 };
}

function appendBvh(targetNodes, targetOrder, local) {
  if (local.root === TETRAHEDRAL_CAGE_INVALID_INDEX) return TETRAHEDRAL_CAGE_INVALID_INDEX;
  const nodeOffset = targetNodes.length;
  const orderOffset = targetOrder.length;
  for (const node of local.nodes) {
    targetNodes.push({
      min: [...node.min],
      max: [...node.max],
      leftFirst: node.count > 0 ? node.leftFirst + orderOffset : node.leftFirst + nodeOffset,
      count: node.count,
    });
  }
  for (const index of local.order) targetOrder.push(index);
  return local.root + nodeOffset;
}

function makeTetrahedronData(cageVertices, tetrahedra, minimumDeterminant) {
  const count = tetrahedra.length / 4;
  const result = new Array(count);
  const cells = new Set();
  const faces = new Map();
  for (let tetrahedronIndex = 0; tetrahedronIndex < count; tetrahedronIndex++) {
    const offset = tetrahedronIndex * 4;
    const indices = Array.from(tetrahedra.subarray(offset, offset + 4));
    if (new Set(indices).size !== 4) {
      fail('DUPLICATE_TETRAHEDRON_VERTEX', `tetrahedra[${tetrahedronIndex}] repeats a cage vertex`, { indices });
    }
    const vertices = indices.map(index => vec3(cageVertices, index));
    const basis = basisFromTetrahedron(vertices);
    const inverse = inverse3(basis, minimumDeterminant, `tetrahedra[${tetrahedronIndex}]`);
    const cellKey = [...indices].sort((a, b) => a - b).join(',');
    if (cells.has(cellKey)) fail('DUPLICATE_TETRAHEDRON', `tetrahedra[${tetrahedronIndex}] duplicates a cage cell`);
    cells.add(cellKey);
    for (let opposite = 0; opposite < 4; opposite++) {
      const face = indices.filter((_, index) => index !== opposite).sort((a, b) => a - b);
      const points = face.map(index => vec3(cageVertices, index));
      const side = dot(cross(subtract(points[1], points[0]), subtract(points[2], points[0])), subtract(vertices[opposite], points[0]));
      const key = face.join(',');
      const prior = faces.get(key);
      if (prior && (prior.count > 1 || Math.sign(prior.side) === Math.sign(side))) {
        fail('NONCONFORMING_CAGE_FACE', `tetrahedra[${tetrahedronIndex}] shares a non-manifold or overlapping face`);
      }
      faces.set(key, { side, count: (prior?.count ?? 0) + 1 });
    }
    result[tetrahedronIndex] = {
      indices,
      vertices,
      origin: vertices[0],
      basis,
      inverseBasis: inverse.matrix,
      determinant: inverse.determinant,
      volume: Math.abs(inverse.determinant) / 6,
      bounds: tetrahedronBounds(vertices),
    };
  }
  return result;
}

function pointToBarycentric(point, tetrahedron) {
  const relative = subtract(point, tetrahedron.origin);
  const tail = transformLinear(tetrahedron.inverseBasis, relative);
  return [1 - tail[0] - tail[1] - tail[2], tail[0], tail[1], tail[2]];
}

function barycentricToPoint(barycentric, vertices) {
  return [
    barycentric[0] * vertices[0][0] + barycentric[1] * vertices[1][0]
      + barycentric[2] * vertices[2][0] + barycentric[3] * vertices[3][0],
    barycentric[0] * vertices[0][1] + barycentric[1] * vertices[1][1]
      + barycentric[2] * vertices[2][1] + barycentric[3] * vertices[3][1],
    barycentric[0] * vertices[0][2] + barycentric[1] * vertices[1][2]
      + barycentric[2] * vertices[2][2] + barycentric[3] * vertices[3][2],
  ];
}

function interpolateArray(left, right, amount) {
  return left.map((value, index) => value + (right[index] - value) * amount);
}

function canonicalBarycentric(value, epsilon) {
  const result = value.map(component => Math.abs(component) <= epsilon ? 0 : component);
  const total = result.reduce((sum, component) => sum + component, 0);
  return result.map(component => component / total);
}

function samePoint(left, right, epsilon) {
  return Math.abs(left[0] - right[0]) <= epsilon
    && Math.abs(left[1] - right[1]) <= epsilon
    && Math.abs(left[2] - right[2]) <= epsilon;
}

function deduplicatePolygon(polygon, epsilon) {
  const result = [];
  for (const vertex of polygon) {
    if (result.length === 0 || !samePoint(result[result.length - 1].position, vertex.position, epsilon)) {
      result.push(vertex);
    }
  }
  if (result.length > 1 && samePoint(result[0].position, result[result.length - 1].position, epsilon)) {
    result.pop();
  }
  return result;
}

/**
 * Clip one triangle against one rest-pose tetrahedron. Returned vertices retain
 * both cage and source-triangle barycentrics for deterministic attribute lookup.
 */
export function clipTriangleToTetrahedron(triangle, tetrahedronVertices, options = {}) {
  const epsilon = Number(options.epsilon ?? DEFAULT_EPSILON);
  const areaEpsilon = Number(options.areaEpsilon ?? DEFAULT_AREA_EPSILON);
  if (!(epsilon >= 0) || !Number.isFinite(epsilon) || !(areaEpsilon >= 0) || !Number.isFinite(areaEpsilon)) {
    fail('INVALID_TOLERANCE', 'Clipping tolerances must be finite and non-negative');
  }
  const triangleFlat = finiteFlatArray(triangle, 3, 'triangle');
  const tetrahedronFlat = finiteFlatArray(tetrahedronVertices, 3, 'tetrahedronVertices');
  if (triangleFlat.length !== 9 || tetrahedronFlat.length !== 12) {
    fail('INVALID_PRIMITIVE', 'triangle must contain 3 points and tetrahedronVertices must contain 4 points');
  }
  const vertices = [0, 1, 2, 3].map(index => vec3(tetrahedronFlat, index));
  const basis = basisFromTetrahedron(vertices);
  const inverse = inverse3(basis, Number(options.minimumDeterminant ?? 1e-7), 'tetrahedronVertices');
  const tetrahedron = {
    origin: vertices[0], vertices, basis, inverseBasis: inverse.matrix,
  };
  let polygon = [0, 1, 2].map(index => {
    const position = vec3(triangleFlat, index);
    const sourceBarycentric = [0, 0, 0];
    sourceBarycentric[index] = 1;
    return { position, barycentric: pointToBarycentric(position, tetrahedron), sourceBarycentric };
  });

  for (let plane = 0; plane < 4 && polygon.length > 0; plane++) {
    const clipped = [];
    let previous = polygon[polygon.length - 1];
    let previousDistance = previous.barycentric[plane];
    let previousInside = previousDistance >= -epsilon;
    for (const current of polygon) {
      const currentDistance = current.barycentric[plane];
      const currentInside = currentDistance >= -epsilon;
      if (previousInside !== currentInside) {
        const denominator = previousDistance - currentDistance;
        const amount = denominator === 0 ? 0 : previousDistance / denominator;
        const barycentric = canonicalBarycentric(
          interpolateArray(previous.barycentric, current.barycentric, amount),
          epsilon,
        );
        clipped.push({
          position: barycentricToPoint(barycentric, vertices),
          barycentric,
          sourceBarycentric: interpolateArray(previous.sourceBarycentric, current.sourceBarycentric, amount),
        });
      }
      if (currentInside) {
        const barycentric = canonicalBarycentric(current.barycentric, epsilon);
        clipped.push({
          position: barycentricToPoint(barycentric, vertices),
          barycentric,
          sourceBarycentric: [...current.sourceBarycentric],
        });
      }
      previous = current;
      previousDistance = currentDistance;
      previousInside = currentInside;
    }
    polygon = deduplicatePolygon(clipped, Math.max(epsilon, Number.EPSILON));
  }

  if (polygon.length < 3) return [];
  const fragments = [];
  for (let index = 1; index + 1 < polygon.length; index++) {
    const verticesForFragment = [polygon[0], polygon[index], polygon[index + 1]];
    if (triangleArea(...verticesForFragment.map(vertex => vertex.position)) <= areaEpsilon) continue;
    fragments.push({
      positions: verticesForFragment.map(vertex => [...vertex.position]),
      tetrahedronBarycentrics: verticesForFragment.map(vertex => [...vertex.barycentric]),
      sourceBarycentrics: verticesForFragment.map(vertex => [...vertex.sourceBarycentric]),
    });
  }
  return fragments;
}

function buildMicroForest(fragments, tetrahedronCount, maxLeafSize) {
  const nodes = [];
  const order = [];
  const roots = new Uint32Array(tetrahedronCount).fill(TETRAHEDRAL_CAGE_INVALID_INDEX);
  const nodeFirst = new Uint32Array(tetrahedronCount).fill(TETRAHEDRAL_CAGE_INVALID_INDEX);
  const nodeCounts = new Uint32Array(tetrahedronCount);
  const triangleFirst = new Uint32Array(tetrahedronCount).fill(TETRAHEDRAL_CAGE_INVALID_INDEX);
  const triangleCounts = new Uint32Array(tetrahedronCount);
  const byTetrahedron = Array.from({ length: tetrahedronCount }, () => []);
  const primitiveBounds = fragments.map(fragment => triangleBounds(fragment.positions));
  fragments.forEach((fragment, fragmentIndex) => byTetrahedron[fragment.tetrahedronIndex].push(fragmentIndex));
  for (let tetrahedronIndex = 0; tetrahedronIndex < tetrahedronCount; tetrahedronIndex++) {
    const fragmentIndices = byTetrahedron[tetrahedronIndex];
    if (fragmentIndices.length === 0) continue;
    nodeFirst[tetrahedronIndex] = nodes.length;
    triangleFirst[tetrahedronIndex] = order.length;
    triangleCounts[tetrahedronIndex] = fragmentIndices.length;
    const local = buildDeterministicBvh(fragmentIndices, primitiveBounds, maxLeafSize);
    roots[tetrahedronIndex] = appendBvh(nodes, order, local);
    nodeCounts[tetrahedronIndex] = local.nodes.length;
  }
  return {
    nodes,
    order: Uint32Array.from(order),
    roots,
    nodeFirst,
    nodeCounts,
    triangleFirst,
    triangleCounts,
  };
}

function assetMetrics({ cageVertices, tetrahedra, fragments, sourceTriangleCount, sourceVertexCount, sourceArea, coverageBySource }) {
  const microArea = fragments.reduce((sum, fragment) => sum + triangleArea(...fragment.positions), 0);
  let uncoveredSourceTriangleCount = 0;
  let splitSourceTriangleCount = 0;
  let maximumRelativeAreaError = 0;
  if (coverageBySource) {
    for (const coverage of coverageBySource) {
      if (coverage.fragmentCount === 0) uncoveredSourceTriangleCount++;
      if (coverage.fragmentCount > 1) splitSourceTriangleCount++;
      if (coverage.sourceArea > 0) {
        maximumRelativeAreaError = Math.max(
          maximumRelativeAreaError,
          Math.abs(coverage.fragmentArea - coverage.sourceArea) / coverage.sourceArea,
        );
      }
    }
  }
  return Object.freeze({
    cageVertexCount: cageVertices.length / 3,
    tetrahedronCount: tetrahedra.length / 4,
    sourceVertexCount,
    sourceTriangleCount,
    microTriangleCount: fragments.length,
    triangleInflationRatio: sourceTriangleCount > 0 ? fragments.length / sourceTriangleCount : 0,
    microVertexCount: fragments.length * 3,
    vertexInflationRatio: sourceVertexCount > 0 ? fragments.length * 3 / sourceVertexCount : 0,
    sourceArea,
    microArea,
    coverageAreaRatio: sourceArea > 0 ? microArea / sourceArea : 0,
    uncoveredSourceTriangleCount,
    splitSourceTriangleCount,
    maximumRelativeAreaError,
  });
}

function finalizeAsset({
  cageVertices,
  tetrahedra,
  tetrahedronData,
  fragments,
  sourceTriangleCount,
  sourceVertexCount,
  sourceArea,
  coverageBySource,
  maxLeafSize,
}) {
  const microBvh = buildMicroForest(fragments, tetrahedronData.length, maxLeafSize);
  const asset = {
    kind: 'tetrahedral-cage-accel-asset',
    version: TETRAHEDRAL_CAGE_ASSET_VERSION,
    provenance: TETRAHEDRAL_CAGE_PROVENANCE,
    restCageVertices: cageVertices,
    tetrahedra,
    tetrahedronData,
    fragments,
    microBvh,
    metrics: assetMetrics({
      cageVertices,
      tetrahedra,
      fragments,
      sourceTriangleCount,
      sourceVertexCount,
      sourceArea,
      coverageBySource,
    }),
  };
  const validation = validateTetrahedralCageAsset(asset);
  if (!validation.ok) {
    fail('INVALID_CAGE_ASSET', 'Generated tetrahedral cage asset failed validation', validation);
  }
  asset.validation = validation;
  return asset;
}

/** Build a static tetrahedral-cage asset by clipping an indexed triangle mesh. */
export function buildTetrahedralCageAsset(input, options = {}) {
  const epsilon = Number(options.epsilon ?? DEFAULT_EPSILON);
  const areaEpsilon = Number(options.areaEpsilon ?? DEFAULT_AREA_EPSILON);
  const minimumDeterminant = Number(options.minimumDeterminant ?? 1e-7);
  const maxLeafSize = Number(options.maxLeafSize ?? DEFAULT_MAX_LEAF_SIZE);
  if (!(epsilon >= 0) || !Number.isFinite(epsilon) || !(areaEpsilon >= 0) || !Number.isFinite(areaEpsilon)
    || !(minimumDeterminant > 0) || !Number.isFinite(minimumDeterminant)
    || !Number.isSafeInteger(maxLeafSize) || maxLeafSize < 1) {
    fail('INVALID_BUILD_OPTIONS', 'Cage build tolerances and maxLeafSize are invalid');
  }
  const cageVertices = finiteFlatArray(input?.cageVertices, 3, 'cageVertices');
  const tetrahedra = indexArray(input?.tetrahedra, 4, 'tetrahedra', cageVertices.length / 3);
  const vertices = finiteFlatArray(input?.vertices, 3, 'vertices');
  const indices = indexArray(input?.indices, 3, 'indices', vertices.length / 3);
  const tetrahedronData = makeTetrahedronData(cageVertices, tetrahedra, minimumDeterminant);
  const cageBounds = tetrahedronData.map(tetrahedron => tetrahedron.bounds);
  const cageSearch = buildDeterministicBvh(tetrahedronData.map((_, index) => index), cageBounds, 4);
  // A source surface may lie exactly on a shared cage face. Assign that
  // positive-area surface to the lowest-index adjacent tetrahedron, so clipping
  // does not duplicate it. Both adjacent affine maps agree on the shared face.
  const faceOwners = new Map();
  const ownedFaces = new Uint8Array(tetrahedra.length);
  for (let tetrahedronIndex = 0; tetrahedronIndex < tetrahedronData.length; tetrahedronIndex++) {
    for (let opposite = 0; opposite < 4; opposite++) {
      const ids = [0, 1, 2, 3].filter(index => index !== opposite)
        .map(index => tetrahedra[tetrahedronIndex * 4 + index]).sort((a, b) => a - b);
      const key = ids.join(',');
      if (!faceOwners.has(key)) { faceOwners.set(key, tetrahedronIndex); ownedFaces[tetrahedronIndex * 4 + opposite] = 1; }
    }
  }
  const fragments = [];
  const sourceTriangleCount = indices.length / 3;
  const coverageBySource = new Array(sourceTriangleCount);
  let sourceArea = 0;

  for (let sourceTriangleIndex = 0; sourceTriangleIndex < sourceTriangleCount; sourceTriangleIndex++) {
    const indexOffset = sourceTriangleIndex * 3;
    const triangleVertices = [
      vec3(vertices, indices[indexOffset]),
      vec3(vertices, indices[indexOffset + 1]),
      vec3(vertices, indices[indexOffset + 2]),
    ];
    const area = triangleArea(...triangleVertices);
    if (area <= areaEpsilon) {
      if (options.rejectDegenerateTriangles !== false) {
        fail('DEGENERATE_SOURCE_TRIANGLE', `Source triangle ${sourceTriangleIndex} has negligible area`, { area, areaEpsilon });
      }
      coverageBySource[sourceTriangleIndex] = { sourceArea: area, fragmentArea: 0, fragmentCount: 0 };
      continue;
    }
    sourceArea += area;
    const sourceBounds = triangleBounds(triangleVertices);
    let fragmentArea = 0;
    let fragmentOrdinal = 0;
    const candidates = [];
    const pending = [cageSearch.root];
    while (pending.length) {
      const node = cageSearch.nodes[pending.pop()];
      if (!boundsOverlap(sourceBounds, node, epsilon)) continue;
      if (node.count === 0) pending.push(node.leftFirst, node.leftFirst + 1);
      else for (let index = node.leftFirst; index < node.leftFirst + node.count; index++) {
        const candidate = cageSearch.order[index];
        if (boundsOverlap(sourceBounds, cageBounds[candidate], epsilon)) candidates.push(candidate);
      }
    }
    candidates.sort((left, right) => left - right);
    for (const tetrahedronIndex of candidates) {
      const tetrahedron = tetrahedronData[tetrahedronIndex];
      const clipped = clipTriangleToTetrahedron(
        triangleVertices.flat(),
        tetrahedron.vertices.flat(),
        { epsilon, areaEpsilon, minimumDeterminant },
      );
      for (const fragment of clipped) {
        if ([0, 1, 2, 3].some(plane => !ownedFaces[tetrahedronIndex * 4 + plane]
            && fragment.tetrahedronBarycentrics.every(value => Math.abs(value[plane]) <= epsilon))) continue;
        const clippedArea = triangleArea(...fragment.positions);
        fragmentArea += clippedArea;
        fragments.push({
          tetrahedronIndex,
          sourceTriangleIndex,
          fragmentOrdinal: fragmentOrdinal++,
          positions: fragment.positions,
          tetrahedronBarycentrics: fragment.tetrahedronBarycentrics,
          sourceBarycentrics: fragment.sourceBarycentrics,
        });
      }
    }
    coverageBySource[sourceTriangleIndex] = {
      sourceArea: area,
      fragmentArea,
      fragmentCount: fragmentOrdinal,
    };
  }

  const coverageTolerance = Number(options.coverageTolerance ?? 1e-5);
  if (!(coverageTolerance >= 0) || !Number.isFinite(coverageTolerance)) {
    fail('INVALID_TOLERANCE', 'coverageTolerance must be finite and non-negative');
  }
  if (options.requireCompleteCoverage !== false) {
    const incomplete = coverageBySource.findIndex(coverage => coverage.sourceArea > areaEpsilon
      && (coverage.fragmentCount === 0
        || Math.abs(coverage.fragmentArea - coverage.sourceArea) / coverage.sourceArea > coverageTolerance));
    if (incomplete >= 0) {
      fail('INCOMPLETE_CAGE_COVERAGE', `Tetrahedral cage does not cover source triangle ${incomplete} exactly enough`, {
        sourceTriangleIndex: incomplete,
        ...coverageBySource[incomplete],
        coverageTolerance,
      });
    }
  }

  return finalizeAsset({
    cageVertices,
    tetrahedra,
    tetrahedronData,
    fragments,
    sourceTriangleCount,
    sourceVertexCount: vertices.length / 3,
    sourceArea,
    coverageBySource,
    maxLeafSize,
  });
}

function optionalFlatArray(value, stride, name, expectedLength) {
  if (value === undefined || value === null) return null;
  const result = finiteFlatArray(value, stride, name, { allowEmpty: true });
  if (result.length !== expectedLength) {
    fail('INVALID_ARRAY_LENGTH', `${name} must contain ${expectedLength} values`);
  }
  return result;
}

/** Package already-clipped per-tetrahedron micro meshes with strict validation. */
export function packageTetrahedralMicroMeshes(input, options = {}) {
  const epsilon = Number(options.epsilon ?? 1e-7);
  const areaEpsilon = Number(options.areaEpsilon ?? DEFAULT_AREA_EPSILON);
  const minimumDeterminant = Number(options.minimumDeterminant ?? 1e-7);
  const maxLeafSize = Number(options.maxLeafSize ?? DEFAULT_MAX_LEAF_SIZE);
  if (!(epsilon >= 0) || !Number.isFinite(epsilon) || !(areaEpsilon >= 0) || !Number.isFinite(areaEpsilon)
    || !(minimumDeterminant > 0) || !Number.isFinite(minimumDeterminant)
    || !Number.isSafeInteger(maxLeafSize) || maxLeafSize < 1) {
    fail('INVALID_BUILD_OPTIONS', 'Micro-mesh packaging options are invalid');
  }
  const cageVertices = finiteFlatArray(input?.cageVertices, 3, 'cageVertices');
  const tetrahedra = indexArray(input?.tetrahedra, 4, 'tetrahedra', cageVertices.length / 3);
  const tetrahedronData = makeTetrahedronData(cageVertices, tetrahedra, minimumDeterminant);
  if (!Array.isArray(input?.microMeshes) || input.microMeshes.length !== tetrahedronData.length) {
    fail('INVALID_MICRO_MESHES', `microMeshes must contain one entry for each of ${tetrahedronData.length} tetrahedra`);
  }
  const fragments = [];
  const fragmentOrdinals = new Map();
  let sourceTriangleMaximum = -1;
  let sourceArea = 0;

  for (let tetrahedronIndex = 0; tetrahedronIndex < input.microMeshes.length; tetrahedronIndex++) {
    const microMesh = input.microMeshes[tetrahedronIndex] ?? {};
    const positions = finiteFlatArray(microMesh.positions ?? [], 9, `microMeshes[${tetrahedronIndex}].positions`, { allowEmpty: true });
    const triangleCount = positions.length / 9;
    const tetrahedronBarycentrics = optionalFlatArray(
      microMesh.tetrahedronBarycentrics,
      12,
      `microMeshes[${tetrahedronIndex}].tetrahedronBarycentrics`,
      triangleCount * 12,
    );
    const sourceBarycentrics = optionalFlatArray(
      microMesh.sourceBarycentrics,
      9,
      `microMeshes[${tetrahedronIndex}].sourceBarycentrics`,
      triangleCount * 9,
    );
    const sourceIndices = microMesh.sourceTriangleIndices === undefined
      ? Uint32Array.from({ length: triangleCount }, (_, index) => fragments.length + index)
      : indexArray(microMesh.sourceTriangleIndices, 1, `microMeshes[${tetrahedronIndex}].sourceTriangleIndices`, 0x100000000);
    if (sourceIndices.length !== triangleCount) {
      fail('INVALID_ARRAY_LENGTH', `microMeshes[${tetrahedronIndex}].sourceTriangleIndices must contain ${triangleCount} entries`);
    }
    const tetrahedron = tetrahedronData[tetrahedronIndex];
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
      const points = [0, 1, 2].map(vertexIndex => {
        const offset = triangleIndex * 9 + vertexIndex * 3;
        return Array.from(positions.subarray(offset, offset + 3));
      });
      const area = triangleArea(...points);
      if (area <= areaEpsilon) {
        fail('DEGENERATE_MICRO_TRIANGLE', `Micro triangle ${triangleIndex} in tetrahedron ${tetrahedronIndex} has negligible area`);
      }
      const cageBarycentrics = points.map((point, vertexIndex) => {
        const derived = canonicalBarycentric(pointToBarycentric(point, tetrahedron), epsilon);
        const provided = tetrahedronBarycentrics
          ? Array.from(tetrahedronBarycentrics.subarray(triangleIndex * 12 + vertexIndex * 4, triangleIndex * 12 + vertexIndex * 4 + 4))
          : derived;
        const sum = provided.reduce((total, component) => total + component, 0);
        if (provided.some(component => !Number.isFinite(component) || component < -epsilon)
          || Math.abs(sum - 1) > epsilon * 4) {
          fail('MICRO_VERTEX_OUTSIDE_TETRAHEDRON', `Micro triangle ${triangleIndex} has a vertex outside tetrahedron ${tetrahedronIndex}`);
        }
        const reconstructed = barycentricToPoint(provided, tetrahedron.vertices);
        if (length3(subtract(reconstructed, point)) > epsilon * Math.max(1, length3(point))) {
          fail('MICRO_BARYCENTRIC_MISMATCH', `Provided cage barycentrics do not reconstruct micro triangle ${triangleIndex}`);
        }
        return canonicalBarycentric(provided, epsilon);
      });
      const originalBarycentrics = sourceBarycentrics
        ? [0, 1, 2].map(vertexIndex => Array.from(sourceBarycentrics.subarray(
          triangleIndex * 9 + vertexIndex * 3,
          triangleIndex * 9 + vertexIndex * 3 + 3,
        )))
        : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      for (const barycentric of originalBarycentrics) {
        if (barycentric.some(component => !Number.isFinite(component) || component < -epsilon || component > 1 + epsilon)
          || Math.abs(barycentric[0] + barycentric[1] + barycentric[2] - 1) > epsilon * 3) {
          fail('INVALID_SOURCE_BARYCENTRIC', 'sourceBarycentrics must be finite, inside the source triangle, and sum to one');
        }
      }
      const sourceTriangleIndex = sourceIndices[triangleIndex];
      sourceTriangleMaximum = Math.max(sourceTriangleMaximum, sourceTriangleIndex);
      const fragmentOrdinal = fragmentOrdinals.get(sourceTriangleIndex) ?? 0;
      fragmentOrdinals.set(sourceTriangleIndex, fragmentOrdinal + 1);
      sourceArea += area;
      fragments.push({
        tetrahedronIndex,
        sourceTriangleIndex,
        fragmentOrdinal,
        positions: points,
        tetrahedronBarycentrics: cageBarycentrics,
        sourceBarycentrics: originalBarycentrics,
      });
    }
  }

  return finalizeAsset({
    cageVertices,
    tetrahedra,
    tetrahedronData,
    fragments,
    sourceTriangleCount: sourceTriangleMaximum + 1,
    sourceVertexCount: 0,
    sourceArea,
    coverageBySource: null,
    maxLeafSize,
  });
}

/** Validate geometry, barycentrics, and static micro-BVH references. */
export function validateTetrahedralCageAsset(asset, options = {}) {
  const epsilon = Number(options.epsilon ?? 1e-6);
  const errors = [];
  const warnings = [];
  if (!asset || asset.kind !== 'tetrahedral-cage-accel-asset') {
    return Object.freeze({ ok: false, errors: ['Asset kind is invalid'], warnings, metrics: null });
  }
  if (!Array.isArray(asset.fragments) || !Array.isArray(asset.microBvh?.nodes)
    || !Array.isArray(asset.tetrahedronData) || !asset.microBvh?.order) {
    return Object.freeze({ ok: false, errors: ['Asset geometry or BVH payload is missing'], warnings, metrics: null });
  }
  const tetrahedronCount = asset.tetrahedra?.length / 4;
  if (!Number.isSafeInteger(tetrahedronCount) || tetrahedronCount <= 0) errors.push('Asset has no valid tetrahedra');
  if (asset.tetrahedronData?.length !== tetrahedronCount) errors.push('Tetrahedron derived-data count mismatch');
  if (asset.microBvh?.roots?.length !== tetrahedronCount) errors.push('Micro-BVH root count mismatch');
  if (asset.microBvh?.nodeFirst?.length !== tetrahedronCount
    || asset.microBvh?.nodeCounts?.length !== tetrahedronCount
    || asset.microBvh?.triangleFirst?.length !== tetrahedronCount
    || asset.microBvh?.triangleCounts?.length !== tetrahedronCount) {
    errors.push('Micro-BVH ownership range count mismatch');
  } else {
    for (let tetrahedronIndex = 0; tetrahedronIndex < tetrahedronCount; tetrahedronIndex++) {
      const root = asset.microBvh.roots[tetrahedronIndex];
      const nodeFirst = asset.microBvh.nodeFirst[tetrahedronIndex];
      const nodeCount = asset.microBvh.nodeCounts[tetrahedronIndex];
      const triangleFirst = asset.microBvh.triangleFirst[tetrahedronIndex];
      const triangleCount = asset.microBvh.triangleCounts[tetrahedronIndex];
      if (nodeCount === 0 || triangleCount === 0) {
        if (root !== TETRAHEDRAL_CAGE_INVALID_INDEX
          || nodeFirst !== TETRAHEDRAL_CAGE_INVALID_INDEX
          || triangleFirst !== TETRAHEDRAL_CAGE_INVALID_INDEX
          || nodeCount !== 0 || triangleCount !== 0) {
          errors.push(`Empty tetrahedron ${tetrahedronIndex} has inconsistent micro-BVH ranges`);
        }
        continue;
      }
      const nodeEnd = nodeFirst + nodeCount;
      const triangleEnd = triangleFirst + triangleCount;
      if (![root, nodeFirst, nodeCount, triangleFirst, triangleCount].every(value => Number.isSafeInteger(value) && value >= 0)
        || root < nodeFirst || root >= nodeEnd || nodeEnd > asset.microBvh.nodes.length
        || triangleEnd > asset.microBvh.order.length) {
        errors.push(`Tetrahedron ${tetrahedronIndex} has an out-of-range micro-BVH ownership span`);
        continue;
      }
      const visited = new Set();
      const coveredOrder = new Set();
      const pending = [root];
      while (pending.length) {
        const nodeIndex = pending.pop();
        const node = asset.microBvh.nodes[nodeIndex];
        if (nodeIndex < nodeFirst || nodeIndex >= nodeEnd || visited.has(nodeIndex)
          || !node || node.min?.length !== 3 || node.max?.length !== 3
          || !Number.isSafeInteger(node.count) || node.count < 0
          || !Number.isSafeInteger(node.leftFirst) || node.leftFirst < 0
          || node.min.some((value, axis) => !Number.isFinite(value) || !Number.isFinite(node.max[axis]) || value > node.max[axis])) {
          errors.push(`Tetrahedron ${tetrahedronIndex} has invalid or cyclic micro-BVH topology`);
          break;
        }
        visited.add(nodeIndex);
        const enclosed = points => points?.every(point => point?.length === 3
          && point.every((value, axis) => Number.isFinite(value) && value >= node.min[axis] - epsilon && value <= node.max[axis] + epsilon));
        if (node.count === 0) {
          for (const childIndex of [node.leftFirst, node.leftFirst + 1]) {
            const child = asset.microBvh.nodes[childIndex];
            if (!child || !enclosed([child.min, child.max])) errors.push(`Micro-BVH node ${nodeIndex} does not enclose its child`);
            pending.push(childIndex);
          }
        } else if (node.leftFirst >= triangleFirst && node.leftFirst + node.count <= triangleEnd) {
          for (let orderIndex = node.leftFirst; orderIndex < node.leftFirst + node.count; orderIndex++) {
            if (coveredOrder.has(orderIndex)) errors.push(`Micro-BVH leaf ${nodeIndex} repeats a triangle-order entry`);
            coveredOrder.add(orderIndex);
            if (!enclosed(asset.fragments[asset.microBvh.order[orderIndex]]?.positions)) {
              errors.push(`Micro-BVH leaf ${nodeIndex} does not enclose its triangle`);
            }
          }
        }
      }
      if (visited.size !== nodeCount || coveredOrder.size !== triangleCount) {
        errors.push(`Tetrahedron ${tetrahedronIndex} has unreachable micro-BVH nodes or triangles`);
      }
      for (let nodeIndex = nodeFirst; nodeIndex < nodeEnd; nodeIndex++) {
        const node = asset.microBvh.nodes[nodeIndex];
        if (node.count === 0) {
          if (node.leftFirst < nodeFirst || node.leftFirst + 1 >= nodeEnd) {
            errors.push(`Tetrahedron ${tetrahedronIndex} has a micro-BVH child outside its owned nodes`);
            break;
          }
        } else if (node.leftFirst < triangleFirst || node.leftFirst + node.count > triangleEnd) {
          errors.push(`Tetrahedron ${tetrahedronIndex} has a micro-BVH leaf outside its triangle-order range`);
          break;
        }
      }
      for (let orderIndex = triangleFirst; orderIndex < triangleEnd; orderIndex++) {
        const fragmentIndex = asset.microBvh.order[orderIndex];
        if (asset.fragments[fragmentIndex]?.tetrahedronIndex !== tetrahedronIndex) {
          errors.push(`Tetrahedron ${tetrahedronIndex} owns a micro triangle from another tetrahedron`);
          break;
        }
      }
    }
  }
  for (let fragmentIndex = 0; fragmentIndex < (asset.fragments?.length ?? 0); fragmentIndex++) {
    const fragment = asset.fragments[fragmentIndex];
    if (!Number.isSafeInteger(fragment.tetrahedronIndex)
      || fragment.tetrahedronIndex < 0 || fragment.tetrahedronIndex >= tetrahedronCount) {
      errors.push(`Fragment ${fragmentIndex} references an invalid tetrahedron`);
      continue;
    }
    const tetrahedron = asset.tetrahedronData[fragment.tetrahedronIndex];
    if (fragment.positions?.length !== 3 || fragment.tetrahedronBarycentrics?.length !== 3
      || fragment.sourceBarycentrics?.length !== 3) {
      errors.push(`Fragment ${fragmentIndex} has an invalid vertex payload`);
      continue;
    }
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const source = fragment.sourceBarycentrics[vertexIndex];
      if (source?.length !== 3 || source.some(value => !Number.isFinite(value) || value < -epsilon || value > 1 + epsilon)
        || Math.abs(source.reduce((sum, value) => sum + value, 0) - 1) > epsilon * 3) {
        errors.push(`Fragment ${fragmentIndex} has invalid source barycentrics`);
        break;
      }
      const barycentric = fragment.tetrahedronBarycentrics[vertexIndex];
      if (barycentric.length !== 4 || barycentric.some(value => !Number.isFinite(value) || value < -epsilon)
        || Math.abs(barycentric.reduce((sum, value) => sum + value, 0) - 1) > epsilon * 4) {
        errors.push(`Fragment ${fragmentIndex} has invalid cage barycentrics`);
        break;
      }
      const reconstructed = barycentricToPoint(barycentric, tetrahedron.vertices);
      if (length3(subtract(reconstructed, fragment.positions[vertexIndex])) > epsilon) {
        errors.push(`Fragment ${fragmentIndex} cage barycentrics do not reconstruct its rest position`);
        break;
      }
    }
  }
  const order = asset.microBvh?.order;
  if (!(order instanceof Uint32Array) || order.length !== asset.fragments.length) {
    errors.push('Micro-BVH triangle order does not cover every fragment exactly once');
  } else if (new Set(order).size !== asset.fragments.length
    || Array.from(order).some(index => index >= asset.fragments.length)) {
    errors.push('Micro-BVH triangle order contains duplicates or invalid indices');
  }
  if (asset.metrics?.uncoveredSourceTriangleCount > 0) {
    warnings.push(`${asset.metrics.uncoveredSourceTriangleCount} source triangles are not covered by the cage`);
  }
  return Object.freeze({ ok: errors.length === 0, errors, warnings, metrics: asset.metrics ?? null });
}

/** Compute affine maps and a deterministic top-level BVH for one cage instance. */
export function computeTetrahedralCageFrame(asset, deformedCageVertices, options = {}) {
  const validation = validateTetrahedralCageAsset(asset);
  if (!validation.ok) fail('INVALID_CAGE_ASSET', 'Cannot deform an invalid tetrahedral cage asset', validation);
  const deformed = finiteFlatArray(deformedCageVertices, 3, 'deformedCageVertices');
  if (deformed.length !== asset.restCageVertices.length) {
    fail('CAGE_VERTEX_COUNT_MISMATCH', 'Deformed cage vertex count must match the rest cage');
  }
  const minimumDeterminant = Number(options.minimumDeterminant ?? 1e-7);
  const boundsInflation = Number(options.boundsInflation ?? 1e-7);
  const maxLeafSize = Number(options.maxLeafSize ?? 2);
  if (!(minimumDeterminant > 0) || !Number.isFinite(minimumDeterminant)
    || !(boundsInflation >= 0) || !Number.isFinite(boundsInflation)
    || !Number.isSafeInteger(maxLeafSize) || maxLeafSize < 1) {
    fail('INVALID_FRAME_OPTIONS', 'Frame tolerances and maxLeafSize are invalid');
  }
  const transforms = new Array(asset.tetrahedronData.length);
  const bounds = new Array(asset.tetrahedronData.length);
  let minimumJacobian = Infinity;
  let maximumJacobian = 0;
  let invertedTetrahedronCount = 0;

  for (let tetrahedronIndex = 0; tetrahedronIndex < asset.tetrahedronData.length; tetrahedronIndex++) {
    const rest = asset.tetrahedronData[tetrahedronIndex];
    const vertices = rest.indices.map(index => vec3(deformed, index));
    const deformedBasis = basisFromTetrahedron(vertices);
    const inverseDeformed = inverse3(deformedBasis, minimumDeterminant, `deformed tetrahedra[${tetrahedronIndex}]`);
    const restToDeformedLinear = multiply3(deformedBasis, rest.inverseBasis);
    const worldToRestLinear = multiply3(rest.basis, inverseDeformed.matrix);
    const restOriginMapped = transformLinear(restToDeformedLinear, rest.origin);
    const restToDeformedTranslation = subtract(vertices[0], restOriginMapped);
    const worldOriginMapped = transformLinear(worldToRestLinear, vertices[0]);
    const worldToRestTranslation = subtract(rest.origin, worldOriginMapped);
    const jacobian = inverseDeformed.determinant / rest.determinant;
    minimumJacobian = Math.min(minimumJacobian, Math.abs(jacobian));
    maximumJacobian = Math.max(maximumJacobian, Math.abs(jacobian));
    if (jacobian < 0) fail('INVERTED_TETRAHEDRON', `Deformation inverted tetrahedron ${tetrahedronIndex}`);
    transforms[tetrahedronIndex] = {
      restToDeformed: affine12(restToDeformedLinear, restToDeformedTranslation),
      deformedToRest: affine12(worldToRestLinear, worldToRestTranslation),
      jacobian,
    };
    bounds[tetrahedronIndex] = tetrahedronBounds(vertices, boundsInflation);
  }

  const activeTetrahedra = [];
  for (let index = 0; index < asset.microBvh.roots.length; index++) {
    if (asset.microBvh.roots[index] !== TETRAHEDRAL_CAGE_INVALID_INDEX) activeTetrahedra.push(index);
  }
  const tlas = buildDeterministicBvh(activeTetrahedra, bounds, maxLeafSize);
  return {
    kind: 'tetrahedral-cage-accel-frame',
    asset,
    deformedCageVertices: deformed,
    transforms,
    tetrahedronBounds: bounds,
    tlas: { ...tlas, order: Uint32Array.from(tlas.order) },
    metrics: Object.freeze({
      activeTetrahedronCount: activeTetrahedra.length,
      tlasNodeCount: tlas.nodes.length,
      minimumAbsoluteJacobian: minimumJacobian === Infinity ? 0 : minimumJacobian,
      maximumAbsoluteJacobian: maximumJacobian,
      invertedTetrahedronCount,
    }),
  };
}

function rayBoundsDistance(origin, direction, bounds, tMin, tMax) {
  let near = tMin;
  let far = tMax;
  for (let axis = 0; axis < 3; axis++) {
    const component = direction[axis];
    if (Math.abs(component) <= 1e-15) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) return Infinity;
      continue;
    }
    const inverse = 1 / component;
    let first = (bounds.min[axis] - origin[axis]) * inverse;
    let second = (bounds.max[axis] - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return Infinity;
  }
  return near;
}

function intersectTriangle(origin, direction, positions, tMin, tMax, cullBackfaces) {
  const edge1 = subtract(positions[1], positions[0]);
  const edge2 = subtract(positions[2], positions[0]);
  const perpendicular = cross(direction, edge2);
  const determinant = dot(edge1, perpendicular);
  if (cullBackfaces ? determinant <= DEFAULT_EPSILON : Math.abs(determinant) <= DEFAULT_EPSILON) return null;
  const inverseDeterminant = 1 / determinant;
  const originOffset = subtract(origin, positions[0]);
  const u = dot(originOffset, perpendicular) * inverseDeterminant;
  if (u < -DEFAULT_EPSILON || u > 1 + DEFAULT_EPSILON) return null;
  const q = cross(originOffset, edge1);
  const v = dot(direction, q) * inverseDeterminant;
  if (v < -DEFAULT_EPSILON || u + v > 1 + DEFAULT_EPSILON) return null;
  const distance = dot(edge2, q) * inverseDeterminant;
  if (distance < tMin || distance > tMax) return null;
  return { distance, barycentric: [1 - u - v, u, v] };
}

function isPreferredHit(candidate, current, tieEpsilon) {
  if (current === null || candidate.distance < current.distance - tieEpsilon) return true;
  if (Math.abs(candidate.distance - current.distance) > tieEpsilon) return false;
  return candidate.sourceTriangleIndex < current.sourceTriangleIndex
    || (candidate.sourceTriangleIndex === current.sourceTriangleIndex
      && (candidate.tetrahedronIndex < current.tetrahedronIndex
        || (candidate.tetrahedronIndex === current.tetrahedronIndex
          && candidate.fragmentIndex < current.fragmentIndex)));
}

function traverseMicroBvh(frame, tetrahedronIndex, worldOrigin, worldDirection, options, currentHit) {
  const asset = frame.asset;
  const root = asset.microBvh.roots[tetrahedronIndex];
  if (root === TETRAHEDRAL_CAGE_INVALID_INDEX) return currentHit;
  const transform = frame.transforms[tetrahedronIndex];
  const restOrigin = transformPoint12(transform.deformedToRest, worldOrigin);
  const restDirection = transformDirection12(transform.deformedToRest, worldDirection);
  const stack = [root];
  let closest = currentHit;
  while (stack.length > 0) {
    const nodeIndex = stack.pop();
    const node = asset.microBvh.nodes[nodeIndex];
    const maximum = closest?.distance ?? options.tMax;
    if (!Number.isFinite(rayBoundsDistance(restOrigin, restDirection, node, options.tMin, maximum))) continue;
    if (node.count === 0) {
      const left = node.leftFirst;
      const right = left + 1;
      const leftDistance = rayBoundsDistance(restOrigin, restDirection, asset.microBvh.nodes[left], options.tMin, maximum);
      const rightDistance = rayBoundsDistance(restOrigin, restDirection, asset.microBvh.nodes[right], options.tMin, maximum);
      if (leftDistance <= rightDistance) {
        if (Number.isFinite(rightDistance)) stack.push(right);
        if (Number.isFinite(leftDistance)) stack.push(left);
      } else {
        if (Number.isFinite(leftDistance)) stack.push(left);
        if (Number.isFinite(rightDistance)) stack.push(right);
      }
      continue;
    }
    for (let offset = 0; offset < node.count; offset++) {
      const fragmentIndex = asset.microBvh.order[node.leftFirst + offset];
      const fragment = asset.fragments[fragmentIndex];
      const hit = intersectTriangle(
        restOrigin,
        restDirection,
        fragment.positions,
        options.tMin,
        closest?.distance ?? options.tMax,
        options.cullBackfaces,
      );
      if (!hit) continue;
      const candidate = {
        distance: hit.distance,
        fragmentIndex,
        tetrahedronIndex,
        sourceTriangleIndex: fragment.sourceTriangleIndex,
        fragmentBarycentric: hit.barycentric,
      };
      if (isPreferredHit(candidate, closest, options.tieEpsilon)) closest = candidate;
    }
  }
  return closest;
}

/** Trace a world-space ray through a deformed cage using the CPU reference path. */
export function traceTetrahedralCageRay(frame, originValue, directionValue, options = {}) {
  if (!frame || frame.kind !== 'tetrahedral-cage-accel-frame') {
    fail('INVALID_CAGE_FRAME', 'traceTetrahedralCageRay requires a computed cage frame');
  }
  const origin = Array.from(originValue ?? []);
  const directionInput = Array.from(directionValue ?? []);
  if (origin.length !== 3 || directionInput.length !== 3
    || origin.some(value => !Number.isFinite(value)) || directionInput.some(value => !Number.isFinite(value))) {
    fail('INVALID_RAY', 'Ray origin and direction must each contain three finite values');
  }
  const directionLength = length3(directionInput);
  if (!(directionLength > DEFAULT_EPSILON)) fail('INVALID_RAY', 'Ray direction cannot be zero');
  const direction = directionInput.map(value => value / directionLength);
  const traversalOptions = {
    tMin: Number(options.tMin ?? 1e-7),
    tMax: Number(options.tMax ?? Infinity),
    tieEpsilon: Number(options.tieEpsilon ?? 1e-7),
    cullBackfaces: options.cullBackfaces === true,
  };
  if (!(traversalOptions.tMin >= 0) || Number.isNaN(traversalOptions.tMin)
    || traversalOptions.tMax < traversalOptions.tMin || Number.isNaN(traversalOptions.tMax)
    || !(traversalOptions.tieEpsilon >= 0) || !Number.isFinite(traversalOptions.tieEpsilon)) {
    fail('INVALID_RAY_RANGE', 'Ray tMin, tMax, or tieEpsilon is invalid');
  }
  if (frame.tlas.root === TETRAHEDRAL_CAGE_INVALID_INDEX) return null;
  let closest = null;
  const stack = [frame.tlas.root];
  while (stack.length > 0) {
    const nodeIndex = stack.pop();
    const node = frame.tlas.nodes[nodeIndex];
    const maximum = closest?.distance ?? traversalOptions.tMax;
    if (!Number.isFinite(rayBoundsDistance(origin, direction, node, traversalOptions.tMin, maximum))) continue;
    if (node.count === 0) {
      const left = node.leftFirst;
      const right = left + 1;
      const leftDistance = rayBoundsDistance(origin, direction, frame.tlas.nodes[left], traversalOptions.tMin, maximum);
      const rightDistance = rayBoundsDistance(origin, direction, frame.tlas.nodes[right], traversalOptions.tMin, maximum);
      if (leftDistance <= rightDistance) {
        if (Number.isFinite(rightDistance)) stack.push(right);
        if (Number.isFinite(leftDistance)) stack.push(left);
      } else {
        if (Number.isFinite(leftDistance)) stack.push(left);
        if (Number.isFinite(rightDistance)) stack.push(right);
      }
      continue;
    }
    for (let offset = 0; offset < node.count; offset++) {
      const tetrahedronIndex = frame.tlas.order[node.leftFirst + offset];
      closest = traverseMicroBvh(
        frame,
        tetrahedronIndex,
        origin,
        direction,
        traversalOptions,
        closest,
      );
    }
  }
  if (!closest) return null;

  const fragment = frame.asset.fragments[closest.fragmentIndex];
  const weights = closest.fragmentBarycentric;
  const cageBarycentric = new Array(4).fill(0);
  const sourceBarycentric = new Array(3).fill(0);
  for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
    for (let component = 0; component < 4; component++) {
      cageBarycentric[component] += fragment.tetrahedronBarycentrics[vertexIndex][component] * weights[vertexIndex];
    }
    for (let component = 0; component < 3; component++) {
      sourceBarycentric[component] += fragment.sourceBarycentrics[vertexIndex][component] * weights[vertexIndex];
    }
  }
  const transform = frame.transforms[closest.tetrahedronIndex].restToDeformed;
  const deformedTriangle = fragment.positions.map(position => transformPoint12(transform, position));
  const normal = normalize3(cross(
    subtract(deformedTriangle[1], deformedTriangle[0]),
    subtract(deformedTriangle[2], deformedTriangle[0]),
  ));
  return Object.freeze({
    ...closest,
    position: origin.map((value, axis) => value + direction[axis] * closest.distance),
    normal,
    cageBarycentric,
    sourceBarycentric,
  });
}

function vec4Positions(flatPositions) {
  const result = new Float32Array(flatPositions.length / 3 * 4);
  for (let index = 0; index < flatPositions.length / 3; index++) {
    result[index * 4] = flatPositions[index * 3];
    result[index * 4 + 1] = flatPositions[index * 3 + 1];
    result[index * 4 + 2] = flatPositions[index * 3 + 2];
    result[index * 4 + 3] = 1;
    if (![result[index * 4], result[index * 4 + 1], result[index * 4 + 2]].every(Number.isFinite)) {
      fail('GPU_QUANTIZATION_OUT_OF_RANGE', 'Cage coordinates exceed the finite float32 range');
    }
  }
  return result;
}

function packBvhNodes(nodes) {
  const packed = new Float32Array(nodes.length * 8);
  const view = new DataView(packed.buffer);
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const floatOffset = index * 8;
    packed.set(node.min, floatOffset);
    view.setUint32((floatOffset + 3) * 4, node.leftFirst, true);
    packed.set(node.max, floatOffset + 4);
    if (![0, 1, 2, 4, 5, 6].every(offset => Number.isFinite(packed[floatOffset + offset]))) {
      fail('GPU_QUANTIZATION_OUT_OF_RANGE', 'BVH bounds exceed the finite float32 range');
    }
    view.setUint32((floatOffset + 7) * 4, node.count, true);
  }
  return packed;
}

/** Serialize immutable cage data to storage-buffer-ready typed arrays. */
export function serializeTetrahedralCageAssetForGPU(asset) {
  const validation = validateTetrahedralCageAsset(asset);
  if (!validation.ok) fail('INVALID_CAGE_ASSET', 'Cannot serialize an invalid tetrahedral cage asset', validation);
  const tetrahedronCount = asset.tetrahedra.length / 4;
  const tetrahedronMetadata = new Uint32Array(tetrahedronCount * 4);
  const microTriangleRanges = new Uint32Array(tetrahedronCount * 4);
  for (let index = 0; index < tetrahedronCount; index++) {
    tetrahedronMetadata[index * 4] = asset.microBvh.roots[index];
    tetrahedronMetadata[index * 4 + 1] = asset.microBvh.nodeFirst[index];
    tetrahedronMetadata[index * 4 + 2] = asset.microBvh.nodeCounts[index];
    microTriangleRanges[index * 4] = asset.microBvh.triangleFirst[index];
    microTriangleRanges[index * 4 + 1] = asset.microBvh.triangleCounts[index];
  }
  const microTriangles = new Float32Array(asset.fragments.length * 12);
  const tetrahedronBarycentrics = new Float32Array(asset.fragments.length * 12);
  const sourceBarycentrics = new Float32Array(asset.fragments.length * 12);
  const microTriangleMetadata = new Uint32Array(asset.fragments.length * 4);
  for (let fragmentIndex = 0; fragmentIndex < asset.fragments.length; fragmentIndex++) {
    const fragment = asset.fragments[fragmentIndex];
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const target = fragmentIndex * 12 + vertexIndex * 4;
      microTriangles.set(fragment.positions[vertexIndex], target);
      tetrahedronBarycentrics.set(fragment.tetrahedronBarycentrics[vertexIndex], target);
      sourceBarycentrics.set(fragment.sourceBarycentrics[vertexIndex], target);
    }
    microTriangleMetadata.set([
      fragment.tetrahedronIndex,
      fragment.sourceTriangleIndex,
      fragment.fragmentOrdinal,
      0,
    ], fragmentIndex * 4);
    const offset = fragmentIndex * 12;
    const positions = [0, 4, 8].map(index => microTriangles.subarray(offset + index, offset + index + 3));
    if (positions.some(point => !point.every(Number.isFinite)) || triangleArea(...positions) <= 0) {
      fail('GPU_QUANTIZATION_OUT_OF_RANGE', `Micro triangle ${fragmentIndex} is not representable in float32`);
    }
  }
  const buffers = {
    restCageVertices: vec4Positions(asset.restCageVertices),
    tetrahedra: new Uint32Array(asset.tetrahedra),
    tetrahedronMetadata,
    microRoots: new Uint32Array(asset.microBvh.roots),
    microTriangleRanges,
    microNodes: packBvhNodes(asset.microBvh.nodes),
    microTriangleOrder: new Uint32Array(asset.microBvh.order),
    microTriangles,
    microTriangleTetrahedronBarycentrics: tetrahedronBarycentrics,
    microTriangleSourceBarycentrics: sourceBarycentrics,
    microTriangleMetadata,
  };
  const byteLength = Object.values(buffers).reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const packedCage = new Float64Array(asset.restCageVertices.length);
  for (let index = 0; index < packedCage.length; index++) {
    packedCage[index] = buffers.restCageVertices[Math.floor(index / 3) * 4 + index % 3];
  }
  makeTetrahedronData(packedCage, asset.tetrahedra, 1e-7);
  return Object.freeze({
    ...buffers,
    byteLength,
    layout: TETRAHEDRAL_CAGE_GPU_LAYOUT,
    provenance: TETRAHEDRAL_CAGE_PROVENANCE,
  });
}

/** Serialize one deformed instance and its CPU-built TLAS for WGSL validation. */
export function serializeTetrahedralCageFrameForGPU(frame) {
  if (!frame || frame.kind !== 'tetrahedral-cage-accel-frame') {
    fail('INVALID_CAGE_FRAME', 'serializeTetrahedralCageFrameForGPU requires a computed cage frame');
  }
  const transforms = new Float32Array(frame.transforms.length * 24);
  for (let index = 0; index < frame.transforms.length; index++) {
    transforms.set(frame.transforms[index].restToDeformed, index * 24);
    transforms.set(frame.transforms[index].deformedToRest, index * 24 + 12);
  }
  const buffers = {
    deformedCageVertices: vec4Positions(frame.deformedCageVertices),
    transforms,
    tlasNodes: packBvhNodes(frame.tlas.nodes),
    tlasTetrahedronOrder: new Uint32Array(frame.tlas.order),
  };
  const byteLength = Object.values(buffers).reduce((sum, buffer) => sum + buffer.byteLength, 0);
  return Object.freeze({
    ...buffers,
    byteLength,
    layout: TETRAHEDRAL_CAGE_GPU_LAYOUT,
    provenance: TETRAHEDRAL_CAGE_PROVENANCE,
  });
}

function positiveIntegerOption(value, fallback, name, minimum = 1) {
  const resolved = Number(value ?? fallback);
  if (!Number.isSafeInteger(resolved) || resolved < minimum) {
    fail('INVALID_BENCHMARK_OPTIONS', `${name} must be an integer greater than or equal to ${minimum}`);
  }
  return resolved;
}

function positiveFiniteOption(value, fallback, name) {
  const resolved = Number(value ?? fallback);
  if (!(resolved > 0) || !Number.isFinite(resolved)) {
    fail('INVALID_BENCHMARK_OPTIONS', `${name} must be finite and greater than zero`);
  }
  return resolved;
}

/**
 * Create a deterministic dense ribbon inside a segmented tetrahedral prism.
 * This is a benchmark fixture, not an automatic tetrahedralizer. Every segment
 * contains six conforming tetrahedra around the same body diagonal.
 */
export function createSegmentedRibbonCageBenchmark(options = {}) {
  const segmentCount = positiveIntegerOption(options.segmentCount, 6, 'segmentCount', 2);
  const columns = positiveIntegerOption(options.columns, 12, 'columns');
  const rowsPerSegment = positiveIntegerOption(options.rowsPerSegment, 8, 'rowsPerSegment');
  const width = positiveFiniteOption(options.width, 1, 'width');
  const length = positiveFiniteOption(options.length, 4, 'length');
  const thickness = positiveFiniteOption(options.thickness, 0.25, 'thickness');
  const camber = Number(options.camber ?? thickness * 0.2);
  if (!Number.isFinite(camber) || Math.abs(camber) >= thickness) {
    fail('INVALID_BENCHMARK_OPTIONS', 'camber must be finite and smaller than thickness in magnitude');
  }

  const cageVertices = [];
  const cageVertexIndex = (level, xSide, zSide) => level * 4 + zSide * 2 + xSide;
  for (let level = 0; level <= segmentCount; level++) {
    const y = length * level / segmentCount;
    for (let zSide = 0; zSide < 2; zSide++) {
      const z = zSide === 0 ? -thickness : thickness;
      for (let xSide = 0; xSide < 2; xSide++) {
        const x = xSide === 0 ? -width * 0.5 : width * 0.5;
        cageVertices.push(x, y, z);
      }
    }
  }

  const tetrahedra = [];
  for (let segment = 0; segment < segmentCount; segment++) {
    const a = cageVertexIndex(segment, 0, 0);
    const b = cageVertexIndex(segment, 1, 0);
    const c = cageVertexIndex(segment + 1, 0, 0);
    const d = cageVertexIndex(segment + 1, 1, 0);
    const e = cageVertexIndex(segment, 0, 1);
    const f = cageVertexIndex(segment, 1, 1);
    const g = cageVertexIndex(segment + 1, 0, 1);
    const h = cageVertexIndex(segment + 1, 1, 1);
    tetrahedra.push(
      a, b, d, h,
      a, d, c, h,
      a, c, g, h,
      a, g, e, h,
      a, e, f, h,
      a, f, b, h,
    );
  }

  const rowCount = segmentCount * rowsPerSegment;
  const vertices = [];
  for (let row = 0; row <= rowCount; row++) {
    const longitudinal = row / rowCount;
    const y = longitudinal * length;
    for (let column = 0; column <= columns; column++) {
      const lateral = column / columns;
      const normalizedX = lateral * 2 - 1;
      const x = normalizedX * width * 0.5;
      const z = camber * Math.sin(Math.PI * longitudinal) * (1 - normalizedX * normalizedX);
      vertices.push(x, y, z);
    }
  }
  const sourceVertexIndex = (row, column) => row * (columns + 1) + column;
  const indices = [];
  for (let row = 0; row < rowCount; row++) {
    for (let column = 0; column < columns; column++) {
      const a = sourceVertexIndex(row, column);
      const b = sourceVertexIndex(row, column + 1);
      const c = sourceVertexIndex(row + 1, column);
      const d = sourceVertexIndex(row + 1, column + 1);
      if ((row + column) % 2 === 0) {
        indices.push(a, b, d, a, d, c);
      } else {
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const asset = buildTetrahedralCageAsset(
    { cageVertices, tetrahedra, vertices, indices },
    {
      epsilon: options.epsilon,
      areaEpsilon: options.areaEpsilon,
      coverageTolerance: options.coverageTolerance ?? 2e-5,
      maxLeafSize: options.maxLeafSize,
    },
  );
  return Object.freeze({
    kind: 'segmented-ribbon-cage-benchmark',
    asset,
    cageVertices: new Float64Array(cageVertices),
    tetrahedra: new Uint32Array(tetrahedra),
    vertices: new Float64Array(vertices),
    indices: new Uint32Array(indices),
    topology: Object.freeze({ segmentCount, columns, rowsPerSegment, width, length, thickness, camber }),
  });
}

/**
 * Deform a segmented-ribbon benchmark into a curved, twisted cage instance.
 * Cross-section transforms vary by cage level, producing piecewise-affine rather
 * than globally affine motion while retaining the benchmark's fixed topology.
 */
export function deformSegmentedRibbonCage(benchmark, options = {}) {
  if (!benchmark || benchmark.kind !== 'segmented-ribbon-cage-benchmark') {
    fail('INVALID_BENCHMARK', 'deformSegmentedRibbonCage requires a segmented ribbon benchmark');
  }
  const { segmentCount, length } = benchmark.topology;
  const bendRadians = Number(options.bendRadians ?? 0.65);
  const twistRadians = Number(options.twistRadians ?? 0.4);
  const stretch = Number(options.stretch ?? 1);
  const swayAmplitude = Number(options.swayAmplitude ?? 0);
  const phaseRadians = Number(options.phaseRadians ?? 0);
  if (![bendRadians, twistRadians, stretch, swayAmplitude, phaseRadians].every(Number.isFinite)
    || !(stretch > 0)) {
    fail('INVALID_DEFORMATION_OPTIONS', 'Ribbon deformation values must be finite and stretch must be positive');
  }
  const deformed = new Float64Array(benchmark.cageVertices.length);
  const bendMagnitude = Math.abs(bendRadians);
  const radius = bendMagnitude > 1e-9 ? length * stretch / bendRadians : 0;
  for (let level = 0; level <= segmentCount; level++) {
    const longitudinal = level / segmentCount;
    const bend = bendRadians * longitudinal;
    const centerX = bendMagnitude > 1e-9 ? radius * (1 - Math.cos(bend)) : 0;
    const centerY = bendMagnitude > 1e-9 ? radius * Math.sin(bend) : length * stretch * longitudinal;
    const sway = swayAmplitude * longitudinal * Math.sin(phaseRadians + longitudinal * Math.PI);
    const twist = twistRadians * longitudinal;
    const cosBend = Math.cos(bend);
    const sinBend = Math.sin(bend);
    const cosTwist = Math.cos(twist);
    const sinTwist = Math.sin(twist);
    for (let localVertex = 0; localVertex < 4; localVertex++) {
      const cageIndex = level * 4 + localVertex;
      const sourceOffset = cageIndex * 3;
      const localX = benchmark.cageVertices[sourceOffset];
      const localZ = benchmark.cageVertices[sourceOffset + 2];
      const twistedX = localX * cosTwist - localZ * sinTwist;
      const twistedZ = localX * sinTwist + localZ * cosTwist;
      deformed[sourceOffset] = centerX + sway + twistedX * cosBend;
      deformed[sourceOffset + 1] = centerY - twistedX * sinBend;
      deformed[sourceOffset + 2] = twistedZ;
    }
  }
  return deformed;
}

/** Stateful convenience wrapper around the functional build/deform/trace API. */
export class TetrahedralCageAccel {
  constructor(asset) {
    const validation = validateTetrahedralCageAsset(asset);
    if (!validation.ok) fail('INVALID_CAGE_ASSET', 'TetrahedralCageAccel requires a valid asset', validation);
    this.asset = asset;
    this.frame = null;
  }

  static fromMesh(input, options = {}) {
    return new TetrahedralCageAccel(buildTetrahedralCageAsset(input, options));
  }

  static fromMicroMeshes(input, options = {}) {
    return new TetrahedralCageAccel(packageTetrahedralMicroMeshes(input, options));
  }

  deform(deformedCageVertices, options = {}) {
    this.frame = computeTetrahedralCageFrame(this.asset, deformedCageVertices, options);
    return this.frame;
  }

  traceRay(origin, direction, options = {}) {
    if (!this.frame) fail('MISSING_CAGE_FRAME', 'Call deform() before traceRay()');
    return traceTetrahedralCageRay(this.frame, origin, direction, options);
  }

  serializeAssetForGPU() {
    return serializeTetrahedralCageAssetForGPU(this.asset);
  }

  serializeFrameForGPU() {
    if (!this.frame) fail('MISSING_CAGE_FRAME', 'Call deform() before serializing an instance frame');
    return serializeTetrahedralCageFrameForGPU(this.frame);
  }
}

export default TetrahedralCageAccel;
