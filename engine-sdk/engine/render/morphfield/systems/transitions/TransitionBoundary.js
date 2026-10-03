// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const TRANSITION_BOUNDARY_SCHEMA = 'morphfield-transition-boundary-v1';

export const TRANSITION_FACE = Object.freeze({
  FINE: 'fine',
  COARSE: 'coarse',
  U_MIN: 'u-min',
  U_MAX: 'u-max',
  V_MIN: 'v-min',
  V_MAX: 'v-max',
});

const FACE_ORDER = Object.freeze([
  TRANSITION_FACE.FINE,
  TRANSITION_FACE.COARSE,
  TRANSITION_FACE.U_MIN,
  TRANSITION_FACE.U_MAX,
  TRANSITION_FACE.V_MIN,
  TRANSITION_FACE.V_MAX,
]);

function arrayLike(value, name) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new TypeError(`${name} must be an array or typed array`);
  return value;
}

function positiveFinite(value, name) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new RangeError(`${name} must be a positive finite number`);
  return result;
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function pointAt(values, index) {
  const offset = index * 3;
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function commonBoundaryFaces(a, b, tolerance) {
  const tests = [
    [TRANSITION_FACE.FINE, 2, 0],
    [TRANSITION_FACE.COARSE, 2, 1],
    [TRANSITION_FACE.U_MIN, 0, 0],
    [TRANSITION_FACE.U_MAX, 0, 1],
    [TRANSITION_FACE.V_MIN, 1, 0],
    [TRANSITION_FACE.V_MAX, 1, 1],
  ];
  const result = [];
  for (const [face, axis, expected] of tests) {
    if (Math.abs(a[axis] - expected) <= tolerance && Math.abs(b[axis] - expected) <= tolerance) result.push(face);
  }
  return result;
}

function quantizedPoint(point, quantum) {
  const values = point.map(value => Math.round(value / quantum));
  if (!values.every(Number.isSafeInteger)) {
    throw new RangeError('Boundary coordinates exceed the safe integer range at the requested signature quantum');
  }
  return values.join(',');
}

function canonicalSegment(a, b, quantum) {
  const qa = quantizedPoint(a, quantum);
  const qb = quantizedPoint(b, quantum);
  return qa < qb ? `${qa}>${qb}` : `${qb}>${qa}`;
}

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function canonicalContract(contract) {
  if (!contract) return 'null';
  return Object.keys(contract).sort().map(key => `${JSON.stringify(key)}:${JSON.stringify(contract[key])}`).join('|');
}

function freezeSignature(face, records, quantum, contract) {
  const frozenRecords = Object.freeze(records.slice().sort());
  return Object.freeze({
    schema: TRANSITION_BOUNDARY_SCHEMA,
    face,
    coordinateSpace: 'world',
    quantum,
    contract,
    segmentCount: frozenRecords.length,
    hash: fnv1a32(frozenRecords.join('|')),
    records: frozenRecords,
  });
}

/**
 * Build canonical signatures from the open edges of a transition mesh.
 *
 * Signatures contain complete sorted segment records as well as a compact hash;
 * comparisons therefore never rely on hash equality alone.  World-space
 * quantization makes opposite local face orientations compare identically.
 */
export function createTransitionBoundarySignatures(mesh, options = {}) {
  if (!mesh || typeof mesh !== 'object') throw new TypeError('A transition mesh is required');
  const positions = arrayLike(mesh.positions, 'positions');
  const localPositions = arrayLike(mesh.localPositions, 'localPositions');
  const indices = arrayLike(mesh.indices, 'indices');
  if (positions.length % 3 || localPositions.length !== positions.length || indices.length % 3) {
    throw new RangeError('Boundary signature input has invalid position or index lengths');
  }
  const quantum = positiveFinite(options.quantum ?? mesh.signatureQuantum ?? 1e-7, 'signature quantum');
  const localTolerance = positiveFinite(options.localTolerance ?? 1e-7, 'local boundary tolerance');
  const contractSource = options.contract ?? (mesh.provenance ? {
    topologySha256: mesh.provenance.topologySha256,
    isoValueBits: mesh.provenance.isoValueBits,
    insideConvention: mesh.provenance.insideConvention,
    sourceRevision: mesh.provenance.sourceRevision,
    certificateRevision: mesh.provenance.certificateRevision,
  } : null);
  const contract = contractSource ? Object.freeze({ ...contractSource }) : null;
  const vertexCount = positions.length / 3;
  const incidences = new Map();

  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [Number(indices[offset]), Number(indices[offset + 1]), Number(indices[offset + 2])];
    if (!triangle.every(index => Number.isInteger(index) && index >= 0 && index < vertexCount)) {
      throw new RangeError('Boundary signature input contains an out-of-range index');
    }
    for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      const key = edgeKey(a, b);
      const incidence = incidences.get(key);
      if (incidence) incidence.count++;
      else incidences.set(key, { a, b, count: 1 });
    }
  }

  const faceRecords = new Map(FACE_ORDER.map(face => [face, []]));
  const unclassifiedEdges = [];
  let boundaryEdgeCount = 0;
  for (const incidence of incidences.values()) {
    if (incidence.count !== 1) continue;
    boundaryEdgeCount++;
    const localA = pointAt(localPositions, incidence.a);
    const localB = pointAt(localPositions, incidence.b);
    const faces = commonBoundaryFaces(localA, localB, localTolerance);
    const worldA = pointAt(positions, incidence.a);
    const worldB = pointAt(positions, incidence.b);
    const record = canonicalSegment(worldA, worldB, quantum);
    if (!faces.length) {
      unclassifiedEdges.push(Object.freeze({ edge: Object.freeze([incidence.a, incidence.b]), record }));
      continue;
    }
    for (const face of faces) faceRecords.get(face).push(record);
  }

  const signatures = Object.fromEntries(FACE_ORDER.map(face => [face, freezeSignature(face, faceRecords.get(face), quantum, contract)]));
  return Object.freeze({
    signatures: Object.freeze(signatures),
    boundaryEdgeCount,
    unclassifiedEdges: Object.freeze(unclassifiedEdges),
  });
}

export function compareTransitionBoundarySignatures(left, right) {
  const reasons = [];
  if (!left || !right) reasons.push('Both boundary signatures are required');
  if (left?.schema !== TRANSITION_BOUNDARY_SCHEMA || right?.schema !== TRANSITION_BOUNDARY_SCHEMA) reasons.push('Boundary signature schema mismatch');
  if (left && right && left.quantum !== right.quantum) reasons.push(`Signature quantum mismatch: ${left.quantum} != ${right.quantum}`);
  if (left && right && canonicalContract(left.contract) !== canonicalContract(right.contract)) reasons.push('Boundary contract metadata differs');
  if (left && right && left.segmentCount !== right.segmentCount) reasons.push(`Segment count mismatch: ${left.segmentCount} != ${right.segmentCount}`);
  if (left && right && left.hash !== right.hash) reasons.push(`Boundary hash mismatch: ${left.hash} != ${right.hash}`);
  if (left && right) {
    const leftRecords = left.records || [];
    const rightRecords = right.records || [];
    if (leftRecords.length !== rightRecords.length || leftRecords.some((record, index) => record !== rightRecords[index])) {
      reasons.push('Canonical boundary segment records differ');
    }
  }
  return Object.freeze({ compatible: reasons.length === 0, reasons: Object.freeze(reasons) });
}

function signatureFor(value, face) {
  const signatures = value?.boundarySignatures || value?.signatures || value;
  const signature = signatures?.[face];
  if (!signature) throw new RangeError(`Boundary signature ${String(face)} is not present`);
  return signature;
}

export function compareTransitionBoundaries(left, leftFace, right, rightFace) {
  return compareTransitionBoundarySignatures(signatureFor(left, leftFace), signatureFor(right, rightFace));
}

export function assertTransitionBoundaryMatch(left, leftFace, right, rightFace) {
  const result = compareTransitionBoundaries(left, leftFace, right, rightFace);
  if (!result.compatible) {
    throw new Error(`Transition boundary mismatch (${leftFace} -> ${rightFace}): ${result.reasons.join('; ')}`);
  }
  return true;
}

export const TRANSITION_FACE_ORDER = FACE_ORDER;
