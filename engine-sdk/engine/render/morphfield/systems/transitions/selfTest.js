// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { TRANSITION_TOPOLOGY, TRANSITION_TOPOLOGY_PROVENANCE } from './TransitionTopology.generated.js';
import {
  TransitionExtractionError,
  extractTransitionInterface,
  validateExact2To1GridPair,
} from './TransitionCellExtractor.js';
import {
  TRANSITION_FACE,
  compareTransitionBoundaries,
} from './TransitionBoundary.js';
import { validateTransitionInterface } from './TransitionValidation.js';

function assert(condition, message) {
  if (!condition) throw new Error(`MorphField transition self-test failed: ${message}`);
}

function typedArrayEqual(left, right) {
  return left.constructor === right.constructor
    && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
}

function worldPoint(frame, u, v, w) {
  return [
    frame.origin[0] + frame.uAxis[0] * u + frame.vAxis[0] * v + frame.wAxis[0] * w,
    frame.origin[1] + frame.uAxis[1] * u + frame.vAxis[1] * v + frame.wAxis[1] * w,
    frame.origin[2] + frame.uAxis[2] * u + frame.vAxis[2] * v + frame.wAxis[2] * w,
  ];
}

function gridValues(dimensions, w, frame, sample) {
  const result = new Float64Array(dimensions[0] * dimensions[1]);
  for (let v = 0; v < dimensions[1]; v++) {
    for (let u = 0; u < dimensions[0]; u++) {
      const normalizedU = u / (dimensions[0] - 1);
      const normalizedV = v / (dimensions[1] - 1);
      result[u + dimensions[0] * v] = sample(worldPoint(frame, normalizedU, normalizedV, w), [normalizedU, normalizedV, w]);
    }
  }
  return result;
}

function requestFor(frame, sample, dimensions = { fine: [5, 5], coarse: [3, 3] }) {
  return {
    fine: { dimensions: dimensions.fine, values: gridValues(dimensions.fine, 0, frame, sample) },
    coarse: { dimensions: dimensions.coarse, values: gridValues(dimensions.coarse, 1, frame, sample) },
    frame,
    signatureQuantum: 1e-7,
  };
}

function cloneForValidation(mesh, indices) {
  return {
    ...mesh,
    indices,
    boundarySignatures: mesh.boundarySignatures,
  };
}

export function runMorphFieldTransitionSelfTests() {
  const checks = [];
  assert(TRANSITION_TOPOLOGY.samples.length === 14, 'generated topology has fourteen geometric samples');
  assert(TRANSITION_TOPOLOGY.tetrahedra.length === 22, 'generated topology has twenty-two star tetrahedra');
  assert(TRANSITION_TOPOLOGY.boundaryTriangles.length === 22, 'generated boundary has twenty-two triangles');
  assert(TRANSITION_TOPOLOGY_PROVENANCE.externalLookupTables === false, 'provenance rejects external lookup tables');
  assert(TRANSITION_TOPOLOGY_PROVENANCE.equivalenceClaims.length === 0, 'provenance contains no unverified equivalence claim');
  checks.push('clean-room generated topology metadata and counts');

  const validRatio = validateExact2To1GridPair(
    { dimensions: [5, 7], values: new Float64Array(35) },
    { dimensions: [3, 4], values: new Float64Array(12) },
  );
  const invalidRatio = validateExact2To1GridPair(
    { dimensions: [4, 7], values: new Float64Array(28) },
    { dimensions: [3, 4], values: new Float64Array(12) },
  );
  assert(validRatio.valid && !invalidRatio.valid, 'grid-pair validator enforces both exact 2:1 tangential axes');
  let ratioRejected = false;
  try {
    extractTransitionInterface({
      fine: { dimensions: [4, 3], values: new Float64Array(12) },
      coarse: { dimensions: [2, 2], values: new Float64Array(4) },
    });
  } catch (error) {
    ratioRejected = error instanceof TransitionExtractionError && error.code === 'INVALID_2_TO_1_RATIO';
  }
  assert(ratioRejected, 'extractor rejects non-2:1 grids before polygonization');
  checks.push('strict exact-2:1 grid validation');

  const unitFrame = {
    origin: [0, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    wAxis: [0, 0, 1],
  };
  const empty = extractTransitionInterface(requestFor(unitFrame, () => 1));
  assert(empty.vertexCount === 0 && empty.triangleCount === 0 && empty.validation.valid, 'constant positive grids produce a valid empty interface');
  checks.push('empty-interface handling');

  const planeRequest = requestFor(unitFrame, (_world, local) => local[2] - 0.37);
  const plane = extractTransitionInterface(planeRequest);
  assert(plane.triangleCount > 0 && plane.validation.valid, 'multi-cell affine plane produces a valid transition interface');
  assert(plane.validation.counts.unexpectedBoundaryEdges === 0, 'all affine-plane open edges are classified on the six prism faces');
  assert(plane.provenance.discardedDegenerateTriangles === 0, 'generic affine plane creates no degenerate triangles');
  checks.push('conforming multi-cell extraction and validation');

  const skewFrame = {
    origin: [2, -1, 0.5],
    uAxis: [-1e-4, 0, 0],
    vAxis: [2e-5, 1e-4, 0],
    wAxis: [0, 1e-5, 1e-4],
  };
  const skewRequest = requestFor(skewFrame, (_world, local) => local[0] + 0.2 * local[1] + 0.4 * local[2] - 0.63, { fine: [3, 3], coarse: [2, 2] });
  skewRequest.signatureQuantum = 1e-11;
  const skew = extractTransitionInterface(skewRequest);
  assert(skew.validation.valid && skew.frame.determinant < 0, 'small mirrored skew frame preserves valid winding and topology');
  checks.push('scale-relative mirrored-frame validation');

  const repeated = extractTransitionInterface(planeRequest);
  assert(typedArrayEqual(plane.positions, repeated.positions), 'repeated extraction has byte-identical positions');
  assert(typedArrayEqual(plane.indices, repeated.indices), 'repeated extraction has byte-identical indices');
  assert(typedArrayEqual(plane.triangleGradients, repeated.triangleGradients), 'repeated extraction has byte-identical winding references');
  assert(JSON.stringify(plane.boundarySignatures) === JSON.stringify(repeated.boundarySignatures), 'repeated extraction has identical boundary signatures');
  checks.push('deterministic extraction and signatures');

  const affineField = world => world[0] + 0.4 * world[1] + 0.3 * world[2] - 1.35;
  const leftFrame = unitFrame;
  const rightFrame = {
    origin: [1, 0, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    wAxis: [0, 0, 1],
  };
  const left = extractTransitionInterface(requestFor(leftFrame, affineField, { fine: [3, 3], coarse: [2, 2] }));
  const rightRequest = requestFor(rightFrame, affineField, { fine: [3, 3], coarse: [2, 2] });
  const right = extractTransitionInterface(rightRequest);
  const sharedBoundary = compareTransitionBoundaries(left, TRANSITION_FACE.U_MAX, right, TRANSITION_FACE.U_MIN);
  assert(sharedBoundary.compatible, `adjacent transition cells share canonical segment signatures: ${sharedBoundary.reasons.join('; ')}`);
  checks.push('world-space adjacent-boundary compatibility');

  const staleRevision = extractTransitionInterface({ ...rightRequest, sourceRevision: 1 });
  const staleContract = compareTransitionBoundaries(left, TRANSITION_FACE.U_MAX, staleRevision, TRANSITION_FACE.U_MIN);
  assert(!staleContract.compatible && staleContract.reasons.includes('Boundary contract metadata differs'), 'boundary contracts reject mixed source revisions');
  checks.push('boundary revision-contract validation');

  const mismatchedFine = new Float64Array(rightRequest.fine.values);
  mismatchedFine[0] += 2;
  const mismatch = extractTransitionInterface({
    ...rightRequest,
    fine: { ...rightRequest.fine, values: mismatchedFine },
    degeneratePolicy: 'validated-discard',
  });
  const rejectedBoundary = compareTransitionBoundaries(left, TRANSITION_FACE.U_MAX, mismatch, TRANSITION_FACE.U_MIN);
  assert(!rejectedBoundary.compatible, 'boundary signature comparison rejects a changed shared scalar boundary');
  checks.push('boundary mismatch detection');

  const reversed = new Uint32Array(plane.indices);
  [reversed[0], reversed[1]] = [reversed[1], reversed[0]];
  const windingReport = validateTransitionInterface(cloneForValidation(plane, reversed), { signatureQuantum: plane.signatureQuantum });
  assert(!windingReport.valid && windingReport.counts.windingFailures > 0, 'validator rejects reversed triangle winding');
  checks.push('scalar-gradient winding validation');

  const degenerate = new Uint32Array(plane.indices);
  degenerate[1] = degenerate[0];
  const degenerateReport = validateTransitionInterface(cloneForValidation(plane, degenerate), { signatureQuantum: plane.signatureQuantum });
  assert(!degenerateReport.valid && degenerateReport.counts.degenerateTriangles > 0, 'validator rejects degenerate triangles');
  checks.push('degenerate-triangle validation');

  const exactIsoFine = [];
  const exactIsoCoarse = [];
  for (let v = 0; v < 3; v++) for (let u = 0; u < 3; u++) exactIsoFine.push(u / 2 - 0.5);
  for (let v = 0; v < 2; v++) for (let u = 0; u < 2; u++) exactIsoCoarse.push(u - 0.5);
  let exactIsoRejected = false;
  try {
    extractTransitionInterface({
      fine: { dimensions: [3, 3], values: exactIsoFine },
      coarse: { dimensions: [2, 2], values: exactIsoCoarse },
    });
  } catch (error) {
    exactIsoRejected = error instanceof TransitionExtractionError && error.code === 'DEGENERATE_TRANSITION_CASE';
  }
  assert(exactIsoRejected, 'default policy fails closed on an iso-aligned degenerate sheet');
  checks.push('exact-iso degeneracy fail-closed policy');

  const staleProvenance = {
    ...plane,
    provenance: { ...plane.provenance, topologySha256: '0'.repeat(64) },
  };
  const provenanceReport = validateTransitionInterface(staleProvenance, { signatureQuantum: plane.signatureQuantum });
  assert(!provenanceReport.valid, 'validator rejects stale topology provenance');
  checks.push('topology provenance validation');

  return Object.freeze({
    passed: true,
    count: checks.length,
    checks: Object.freeze(checks),
    topologySha256: TRANSITION_TOPOLOGY_PROVENANCE.topologySha256,
  });
}
