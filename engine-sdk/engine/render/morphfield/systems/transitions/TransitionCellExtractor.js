// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { TRANSITION_TOPOLOGY, TRANSITION_TOPOLOGY_PROVENANCE } from './TransitionTopology.generated.js';
import { createTransitionBoundarySignatures } from './TransitionBoundary.js';
import { validateTransitionInterface } from './TransitionValidation.js';

export const TRANSITION_INTERFACE_SCHEMA = 'morphfield-transition-interface-v1';

export const TRANSITION_LIMITS = Object.freeze({
  MAX_CELLS: 262_144,
  MAX_TRIANGLES: 5_000_000,
});

export class TransitionExtractionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TransitionExtractionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new TransitionExtractionError(code, message, details);
}

function finiteVector(value, length, name, fallback) {
  const source = value ?? fallback;
  if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length < length) {
    throw new TypeError(`${name} requires ${length} numeric values`);
  }
  const result = Array.from(source).slice(0, length).map(Number);
  if (!result.every(Number.isFinite)) throw new RangeError(`${name} must contain finite numbers`);
  return result;
}

function positiveInteger(value, fallback, name, maximum) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate <= 0 || candidate > maximum) {
    throw new RangeError(`${name} must be an integer in [1, ${maximum}]`);
  }
  return candidate;
}

function uint32(value, fallback, name) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 0xffffffff) throw new RangeError(`${name} must be an unsigned 32-bit integer`);
  return candidate;
}

function float64BitsHex(value) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, true);
  return `${view.getUint32(4, true).toString(16).padStart(8, '0')}${view.getUint32(0, true).toString(16).padStart(8, '0')}`;
}

function normalizeGrid(grid, name) {
  if (!grid || typeof grid !== 'object') throw new TypeError(`${name} grid is required`);
  const dimensions = finiteVector(grid.dimensions, 2, `${name}.dimensions`).map(Number);
  if (!dimensions.every(value => Number.isInteger(value) && value >= 2)) {
    throw new RangeError(`${name}.dimensions must contain integer sample counts of at least two`);
  }
  if (!Array.isArray(grid.values) && !ArrayBuffer.isView(grid.values)) throw new TypeError(`${name}.values must be an array or typed array`);
  const required = dimensions[0] * dimensions[1];
  if (grid.values.length !== required) throw new RangeError(`${name}.values length ${grid.values.length} does not match ${required} samples`);
  const values = new Float64Array(required);
  for (let index = 0; index < required; index++) {
    const value = Number(grid.values[index]);
    if (!Number.isFinite(value)) throw new RangeError(`${name}.values contains a non-finite sample at index ${index}`);
    values[index] = value;
  }
  return Object.freeze({ dimensions: Object.freeze(dimensions), values });
}

function gridIndex(dimensions, u, v) {
  return u + dimensions[0] * v;
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

function length(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

function interpolate(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function normalizeFrame(frame = {}) {
  const origin = finiteVector(frame.origin, 3, 'frame.origin', [0, 0, 0]);
  const uAxis = finiteVector(frame.uAxis, 3, 'frame.uAxis', [1, 0, 0]);
  const vAxis = finiteVector(frame.vAxis, 3, 'frame.vAxis', [0, 1, 0]);
  const wAxis = finiteVector(frame.wAxis, 3, 'frame.wAxis', [0, 0, 1]);
  const determinant = dot(uAxis, cross(vAxis, wAxis));
  const axisLengths = [length(uAxis), length(vAxis), length(wAxis)];
  const lengthProduct = axisLengths[0] * axisLengths[1] * axisLengths[2];
  if (!Number.isFinite(determinant) || !Number.isFinite(lengthProduct) || lengthProduct === 0
    || Math.abs(determinant) <= Number.EPSILON * lengthProduct * 32) {
    throw new RangeError('Transition frame axes must form a non-degenerate three-dimensional prism');
  }
  return Object.freeze({
    origin: Object.freeze(origin),
    uAxis: Object.freeze(uAxis),
    vAxis: Object.freeze(vAxis),
    wAxis: Object.freeze(wAxis),
    determinant,
    maximumSpan: Math.max(...axisLengths),
  });
}

function toWorld(frame, local) {
  return [
    frame.origin[0] + frame.uAxis[0] * local[0] + frame.vAxis[0] * local[1] + frame.wAxis[0] * local[2],
    frame.origin[1] + frame.uAxis[1] * local[0] + frame.vAxis[1] * local[1] + frame.wAxis[1] * local[2],
    frame.origin[2] + frame.uAxis[2] * local[0] + frame.vAxis[2] * local[1] + frame.wAxis[2] * local[2],
  ];
}

function normalizedRequest(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Transition extraction request is required');
  const fine = normalizeGrid(input.fine, 'fine');
  const coarse = normalizeGrid(input.coarse, 'coarse');
  const expectedFine = [2 * (coarse.dimensions[0] - 1) + 1, 2 * (coarse.dimensions[1] - 1) + 1];
  if (fine.dimensions[0] !== expectedFine[0] || fine.dimensions[1] !== expectedFine[1]) {
    fail(
      'INVALID_2_TO_1_RATIO',
      `Fine sample dimensions must be ${expectedFine[0]}x${expectedFine[1]} for coarse dimensions ${coarse.dimensions[0]}x${coarse.dimensions[1]}`,
      { fine: fine.dimensions, coarse: coarse.dimensions, expectedFine },
    );
  }
  const cellsU = coarse.dimensions[0] - 1;
  const cellsV = coarse.dimensions[1] - 1;
  const cellCount = cellsU * cellsV;
  const maxCells = positiveInteger(input.maxCells, TRANSITION_LIMITS.MAX_CELLS, 'maxCells', TRANSITION_LIMITS.MAX_CELLS);
  if (cellCount > maxCells) fail('TRANSITION_CELL_LIMIT', `Transition request contains ${cellCount} cells; configured limit is ${maxCells}`);
  const maxTriangles = positiveInteger(input.maxTriangles, TRANSITION_LIMITS.MAX_TRIANGLES, 'maxTriangles', TRANSITION_LIMITS.MAX_TRIANGLES);
  const isoValue = Number(input.isoValue ?? 0);
  if (!Number.isFinite(isoValue)) throw new RangeError('isoValue must be finite');
  const frame = normalizeFrame(input.frame);
  const signatureQuantum = Number(input.signatureQuantum ?? frame.maximumSpan * 1e-7);
  if (!Number.isFinite(signatureQuantum) || signatureQuantum <= 0) throw new RangeError('signatureQuantum must be a positive finite number');
  const localBoundaryTolerance = Number(input.localBoundaryTolerance ?? 1e-7);
  if (!Number.isFinite(localBoundaryTolerance) || localBoundaryTolerance <= 0 || localBoundaryTolerance >= 0.25) {
    throw new RangeError('localBoundaryTolerance must be finite and in (0, 0.25)');
  }
  const defaultAreaEpsilon = frame.maximumSpan ** 4 * 1e-24;
  const areaEpsilon = Number(input.areaEpsilon ?? defaultAreaEpsilon);
  if (!Number.isFinite(areaEpsilon) || areaEpsilon < 0) throw new RangeError('areaEpsilon must be a finite non-negative squared-area threshold');
  let interiorValues = null;
  if (input.interiorValues !== undefined) {
    if (!Array.isArray(input.interiorValues) && !ArrayBuffer.isView(input.interiorValues)) {
      throw new TypeError('interiorValues must be an array or typed array');
    }
    if (input.interiorValues.length !== cellCount) throw new RangeError(`interiorValues requires exactly ${cellCount} samples`);
    interiorValues = new Float64Array(cellCount);
    for (let index = 0; index < cellCount; index++) {
      const value = Number(input.interiorValues[index]);
      if (!Number.isFinite(value)) throw new RangeError(`interiorValues contains a non-finite value at index ${index}`);
      interiorValues[index] = value;
    }
  }
  const degeneratePolicy = input.degeneratePolicy ?? 'reject';
  if (degeneratePolicy !== 'reject' && degeneratePolicy !== 'validated-discard') {
    throw new RangeError("degeneratePolicy must be 'reject' or 'validated-discard'");
  }
  return Object.freeze({
    fine,
    coarse,
    cellsU,
    cellsV,
    cellCount,
    isoValue,
    isoValueBits: float64BitsHex(isoValue),
    domainId: input.domainId === undefined ? null : String(input.domainId),
    sourceRevision: uint32(input.sourceRevision, 0, 'sourceRevision'),
    certificateRevision: uint32(input.certificateRevision, 0, 'certificateRevision'),
    frame,
    signatureQuantum,
    localBoundaryTolerance,
    areaEpsilon,
    interiorValues,
    maxTriangles,
    degeneratePolicy,
    interiorSampleRule: interiorValues ? 'explicit-per-cell' : 'average-of-fine-center-and-coarse-bilinear-center',
  });
}

export function validateExact2To1GridPair(fineInput, coarseInput) {
  const fine = normalizeGrid(fineInput, 'fine');
  const coarse = normalizeGrid(coarseInput, 'coarse');
  const expectedFine = [2 * (coarse.dimensions[0] - 1) + 1, 2 * (coarse.dimensions[1] - 1) + 1];
  const valid = fine.dimensions[0] === expectedFine[0] && fine.dimensions[1] === expectedFine[1];
  return Object.freeze({
    valid,
    fineDimensions: fine.dimensions,
    coarseDimensions: coarse.dimensions,
    expectedFineDimensions: Object.freeze(expectedFine),
    coarseCellCount: (coarse.dimensions[0] - 1) * (coarse.dimensions[1] - 1),
    ratio: Object.freeze([2, 2]),
  });
}

function tetraGradient(samples) {
  const origin = samples[0].world;
  const rows = [
    subtract(samples[1].world, origin),
    subtract(samples[2].world, origin),
    subtract(samples[3].world, origin),
  ];
  const rhs = [
    samples[1].value - samples[0].value,
    samples[2].value - samples[0].value,
    samples[3].value - samples[0].value,
  ];
  const determinant = dot(rows[0], cross(rows[1], rows[2]));
  const rowLengths = [length(rows[0]), length(rows[1]), length(rows[2])];
  const lengthProduct = rowLengths[0] * rowLengths[1] * rowLengths[2];
  if (!Number.isFinite(determinant) || !Number.isFinite(lengthProduct) || lengthProduct === 0
    || Math.abs(determinant) <= Number.EPSILON * lengthProduct * 32) {
    fail('DEGENERATE_TETRAHEDRON', 'Generated transition tetrahedron is numerically degenerate');
  }
  const term0 = cross(rows[1], rows[2]);
  const term1 = cross(rows[2], rows[0]);
  const term2 = cross(rows[0], rows[1]);
  return [
    (rhs[0] * term0[0] + rhs[1] * term1[0] + rhs[2] * term2[0]) / determinant,
    (rhs[0] * term0[1] + rhs[1] * term1[1] + rhs[2] * term2[1]) / determinant,
    (rhs[0] * term0[2] + rhs[1] * term1[2] + rhs[2] * term2[2]) / determinant,
  ];
}

function sampleId(role, coordinate, cellU, cellV) {
  if (role === 'fine-face') {
    return `F:${2 * cellU + Math.round(coordinate[0] * 2)}:${2 * cellV + Math.round(coordinate[1] * 2)}`;
  }
  if (role === 'coarse-face') {
    return `C:${cellU + Math.round(coordinate[0])}:${cellV + Math.round(coordinate[1])}`;
  }
  return `I:${cellU}:${cellV}`;
}

function sampleValue(request, role, coordinate, cellU, cellV, centerValue) {
  if (role === 'fine-face') {
    const u = 2 * cellU + Math.round(coordinate[0] * 2);
    const v = 2 * cellV + Math.round(coordinate[1] * 2);
    return request.fine.values[gridIndex(request.fine.dimensions, u, v)];
  }
  if (role === 'coarse-face') {
    const u = cellU + Math.round(coordinate[0]);
    const v = cellV + Math.round(coordinate[1]);
    return request.coarse.values[gridIndex(request.coarse.dimensions, u, v)];
  }
  return centerValue;
}

function centerValue(request, cellU, cellV) {
  const cellIndex = cellU + request.cellsU * cellV;
  if (request.interiorValues) return request.interiorValues[cellIndex];
  const fineCenter = request.fine.values[gridIndex(request.fine.dimensions, 2 * cellU + 1, 2 * cellV + 1)];
  const coarseCorners = [
    request.coarse.values[gridIndex(request.coarse.dimensions, cellU, cellV)],
    request.coarse.values[gridIndex(request.coarse.dimensions, cellU + 1, cellV)],
    request.coarse.values[gridIndex(request.coarse.dimensions, cellU, cellV + 1)],
    request.coarse.values[gridIndex(request.coarse.dimensions, cellU + 1, cellV + 1)],
  ];
  const coarseCenter = coarseCorners.reduce((sum, value) => sum + value, 0) * 0.25;
  return 0.5 * (fineCenter + coarseCenter);
}

function cellSamples(request, cellU, cellV) {
  const interior = centerValue(request, cellU, cellV);
  return TRANSITION_TOPOLOGY.samples.map(sample => {
    const coordinate = sample.coordinate;
    const local = [
      (cellU + coordinate[0]) / request.cellsU,
      (cellV + coordinate[1]) / request.cellsV,
      coordinate[2],
    ];
    return {
      id: sampleId(sample.role, coordinate, cellU, cellV),
      local,
      world: toWorld(request.frame, local),
      value: sampleValue(request, sample.role, coordinate, cellU, cellV, interior),
    };
  });
}

class MeshBuilder {
  constructor(request) {
    this.request = request;
    this.positions = [];
    this.localPositions = [];
    this.vertexKeys = [];
    this.normalSums = [];
    this.indices = [];
    this.triangleGradients = [];
    this.triangleSources = [];
    this.vertexByKey = new Map();
    this.discardedDegenerateTriangles = 0;
  }

  intersection(a, b) {
    const denominator = b.value - a.value;
    if (!Number.isFinite(denominator) || denominator === 0) fail('INVALID_EDGE_INTERPOLATION', 'A sign-changing edge has no finite scalar denominator');
    const unclamped = (this.request.isoValue - a.value) / denominator;
    const t = Math.max(0, Math.min(1, unclamped));
    let key;
    if (a.value === this.request.isoValue) key = `N:${a.id}`;
    else if (b.value === this.request.isoValue) key = `N:${b.id}`;
    else key = a.id < b.id ? `E:${a.id}|${b.id}` : `E:${b.id}|${a.id}`;
    const existing = this.vertexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = this.positions.length / 3;
    this.positions.push(...interpolate(a.world, b.world, t));
    this.localPositions.push(...interpolate(a.local, b.local, t));
    this.vertexKeys.push(key);
    this.normalSums.push(0, 0, 0);
    this.vertexByKey.set(key, index);
    return index;
  }

  triangle(a, b, c, gradient, cellU, cellV, tetrahedronIndex) {
    if (a === b || b === c || c === a) {
      this.discardedDegenerateTriangles++;
      return;
    }
    const pa = this.positions.slice(a * 3, a * 3 + 3);
    const pb = this.positions.slice(b * 3, b * 3 + 3);
    const pc = this.positions.slice(c * 3, c * 3 + 3);
    let normal = cross(subtract(pb, pa), subtract(pc, pa));
    const areaSquared = dot(normal, normal);
    if (!Number.isFinite(areaSquared) || areaSquared <= this.request.areaEpsilon) {
      this.discardedDegenerateTriangles++;
      return;
    }
    const gradientLength = length(gradient);
    if (!Number.isFinite(gradientLength) || gradientLength <= 1e-15) fail('UNRESOLVED_WINDING', 'Transition triangle has no usable scalar gradient');
    if (dot(normal, gradient) < 0) {
      [b, c] = [c, b];
      normal = [-normal[0], -normal[1], -normal[2]];
    }
    const alignment = dot(normal, gradient);
    if (!(alignment > 1e-10 * Math.sqrt(areaSquared) * gradientLength)) {
      fail('UNRESOLVED_WINDING', 'Transition triangle winding is numerically ambiguous', { cellU, cellV, tetrahedronIndex });
    }
    if (this.indices.length / 3 >= this.request.maxTriangles) {
      fail('TRANSITION_TRIANGLE_LIMIT', `Transition extraction exceeded ${this.request.maxTriangles} triangles`);
    }
    this.indices.push(a, b, c);
    this.triangleGradients.push(...gradient);
    this.triangleSources.push(cellU, cellV, tetrahedronIndex);
    const unitGradient = gradient.map(value => value / gradientLength);
    for (const vertex of [a, b, c]) {
      this.normalSums[vertex * 3] += unitGradient[0];
      this.normalSums[vertex * 3 + 1] += unitGradient[1];
      this.normalSums[vertex * 3 + 2] += unitGradient[2];
    }
  }

  finish() {
    const used = new Set(this.indices);
    const remap = new Int32Array(this.positions.length / 3).fill(-1);
    const positions = [];
    const localPositions = [];
    const normals = [];
    const vertexKeys = [];
    for (let oldIndex = 0; oldIndex < remap.length; oldIndex++) {
      if (!used.has(oldIndex)) continue;
      const newIndex = positions.length / 3;
      remap[oldIndex] = newIndex;
      positions.push(...this.positions.slice(oldIndex * 3, oldIndex * 3 + 3));
      localPositions.push(...this.localPositions.slice(oldIndex * 3, oldIndex * 3 + 3));
      const sum = this.normalSums.slice(oldIndex * 3, oldIndex * 3 + 3);
      const magnitude = length(sum);
      normals.push(...(magnitude > 1e-15 ? sum.map(value => value / magnitude) : [0, 0, 0]));
      vertexKeys.push(this.vertexKeys[oldIndex]);
    }
    const indices = new Uint32Array(this.indices.length);
    for (let index = 0; index < this.indices.length; index++) indices[index] = remap[this.indices[index]];
    return {
      positions: new Float32Array(positions),
      localPositions: new Float32Array(localPositions),
      normals: new Float32Array(normals),
      indices,
      triangleGradients: new Float32Array(this.triangleGradients),
      triangleSources: new Uint32Array(this.triangleSources),
      vertexKeys: Object.freeze(vertexKeys),
      discardedDegenerateTriangles: this.discardedDegenerateTriangles,
    };
  }
}

function polygonizeTetrahedron(builder, tetrahedron, cellU, cellV, tetrahedronIndex) {
  const inside = [];
  const outside = [];
  for (let index = 0; index < 4; index++) {
    if (tetrahedron[index].value < builder.request.isoValue) inside.push(index);
    else outside.push(index);
  }
  if (!inside.length || !outside.length) return;
  const gradient = tetraGradient(tetrahedron);
  const intersection = (a, b) => builder.intersection(tetrahedron[a], tetrahedron[b]);

  if (inside.length === 1) {
    const root = inside[0];
    builder.triangle(
      intersection(root, outside[0]),
      intersection(root, outside[1]),
      intersection(root, outside[2]),
      gradient,
      cellU,
      cellV,
      tetrahedronIndex,
    );
    return;
  }
  if (outside.length === 1) {
    const root = outside[0];
    builder.triangle(
      intersection(root, inside[0]),
      intersection(root, inside[1]),
      intersection(root, inside[2]),
      gradient,
      cellU,
      cellV,
      tetrahedronIndex,
    );
    return;
  }

  const [insideA, insideB] = inside;
  const [outsideA, outsideB] = outside;
  const a = intersection(insideA, outsideA);
  const b = intersection(insideA, outsideB);
  const c = intersection(insideB, outsideB);
  const d = intersection(insideB, outsideA);
  builder.triangle(a, b, c, gradient, cellU, cellV, tetrahedronIndex);
  builder.triangle(a, c, d, gradient, cellU, cellV, tetrahedronIndex);
}

function extractionProvenance(request, discardedDegenerateTriangles) {
  return Object.freeze({
    schema: 'morphfield-transition-provenance-v1',
    algorithm: 'conforming-prism-marching-tetrahedra',
    topologyRevision: TRANSITION_TOPOLOGY.revision,
    topologySha256: TRANSITION_TOPOLOGY_PROVENANCE.topologySha256,
    generator: TRANSITION_TOPOLOGY_PROVENANCE.generator,
    construction: TRANSITION_TOPOLOGY_PROVENANCE.construction,
    polygonization: TRANSITION_TOPOLOGY_PROVENANCE.polygonization,
    interpolation: 'piecewise-linear scalar interpolation on a conforming tetrahedral complex',
    insideConvention: 'strictly less than isoValue; exact equality is outside and endpoint intersections are welded',
    isoValueBits: request.isoValueBits,
    domainId: request.domainId,
    sourceRevision: request.sourceRevision,
    certificateRevision: request.certificateRevision,
    interiorSampleRule: request.interiorSampleRule,
    ratio: Object.freeze([2, 2]),
    cellCount: request.cellCount,
    discardedDegenerateTriangles,
    externalLookupTables: false,
    equivalenceClaims: Object.freeze([]),
  });
}

/** Extract a deterministic transition slab for one exact-2:1 grid pair. */
export function extractTransitionInterface(input) {
  const request = normalizedRequest(input);
  const builder = new MeshBuilder(request);
  for (let cellV = 0; cellV < request.cellsV; cellV++) {
    for (let cellU = 0; cellU < request.cellsU; cellU++) {
      const samples = cellSamples(request, cellU, cellV);
      for (let tetrahedronIndex = 0; tetrahedronIndex < TRANSITION_TOPOLOGY.tetrahedra.length; tetrahedronIndex++) {
        const tetrahedron = TRANSITION_TOPOLOGY.tetrahedra[tetrahedronIndex].map(index => samples[index]);
        polygonizeTetrahedron(builder, tetrahedron, cellU, cellV, tetrahedronIndex);
      }
    }
  }

  const geometry = builder.finish();
  const provenance = extractionProvenance(request, geometry.discardedDegenerateTriangles);
  const gridDimensions = Object.freeze({
    fine: Object.freeze(request.fine.dimensions.slice()),
    coarse: Object.freeze(request.coarse.dimensions.slice()),
  });
  const frame = Object.freeze({
    origin: request.frame.origin,
    uAxis: request.frame.uAxis,
    vAxis: request.frame.vAxis,
    wAxis: request.frame.wAxis,
    determinant: request.frame.determinant,
  });
  const draft = {
    schema: TRANSITION_INTERFACE_SCHEMA,
    domainId: request.domainId,
    sourceRevision: request.sourceRevision,
    certificateRevision: request.certificateRevision,
    isoValue: request.isoValue,
    gridDimensions,
    frame,
    signatureQuantum: request.signatureQuantum,
    areaEpsilon: request.areaEpsilon,
    positions: geometry.positions,
    localPositions: geometry.localPositions,
    normals: geometry.normals,
    indices: geometry.indices,
    triangleGradients: geometry.triangleGradients,
    triangleSources: geometry.triangleSources,
    vertexKeys: geometry.vertexKeys,
    provenance,
  };
  const boundaryReport = createTransitionBoundarySignatures(draft, {
    quantum: request.signatureQuantum,
    localTolerance: request.localBoundaryTolerance,
  });
  draft.boundarySignatures = boundaryReport.signatures;
  const validation = validateTransitionInterface(draft, {
    signatureQuantum: request.signatureQuantum,
    localBoundaryTolerance: request.localBoundaryTolerance,
    areaEpsilon: request.areaEpsilon,
  });
  if (!validation.valid) {
    fail('TRANSITION_VALIDATION_FAILED', `Transition interface validation failed: ${validation.errors.join('; ')}`, validation);
  }
  if (geometry.discardedDegenerateTriangles && request.degeneratePolicy === 'reject') {
    fail(
      'DEGENERATE_TRANSITION_CASE',
      `Transition polygonization discarded ${geometry.discardedDegenerateTriangles} degenerate triangles`,
      { discardedDegenerateTriangles: geometry.discardedDegenerateTriangles, validation },
    );
  }

  return Object.freeze({
    ...draft,
    boundarySignatures: validation.boundarySignatures,
    validation,
    vertexCount: geometry.positions.length / 3,
    triangleCount: geometry.indices.length / 3,
    indexCount: geometry.indices.length,
    bytes: geometry.positions.byteLength + geometry.localPositions.byteLength + geometry.normals.byteLength
      + geometry.indices.byteLength + geometry.triangleGradients.byteLength + geometry.triangleSources.byteLength,
  });
}

export class TransitionCellExtractor {
  extract(request) {
    return extractTransitionInterface(request);
  }

  validate(mesh, options = {}) {
    return validateTransitionInterface(mesh, options);
  }
}
