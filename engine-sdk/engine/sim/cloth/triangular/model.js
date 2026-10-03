// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../core/schema/StrictJsonValue.js';
import { vec3Sub as sub, vec3Cross as cross, vec3Length as length } from '../../../core/math/MathVec3.js';
import { UnionFind } from '../../../core/math/UnionFind.js';
import { clothError, clothNumber as number, normalizeClothMaterial } from './materials.js';
import { createSeamContactCollar } from './seam-contact-collar.js';
import { createRestChartContactSupport } from './rest-chart-paths.js';

export const TRIANGULAR_CLOTH_LIMITS = Object.freeze({ vertices: 20000, triangles: 40000, outerSteps: 1200, wallMs: 30000, substeps: 4, iterations: 12, maximumIterations: 48 });
const vector = (value, n, label) => {
  if (!Array.isArray(value) || value.length !== n) throw clothError('INVALID_INPUT', `${label} requires ${n} coordinates`);
  return value.map(x => number(x, label, -1e6, 1e6));
};
const index = (value, count, label) => {
  if (!Number.isInteger(value) || value < 0 || value >= count) throw clothError('INVALID_TOPOLOGY', `${label} refers to a missing vertex`);
  return value;
};
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const finiteInteger = (value, label, min, max) => { number(value, label, min, max); if (!Number.isInteger(value)) throw clothError('INVALID_INPUT', `${label} must be an integer`); return value; };

function colorConstraints(constraints, vertexDof) {
  const colors = [], occupied = [];
  for (const constraint of constraints) {
    let color = 0;
    while (occupied[color] && constraint.ids.some(id => occupied[color].has(vertexDof[id]))) color++;
    colors[color] ??= []; occupied[color] ??= new Set();
    colors[color].push(constraint); constraint.ids.forEach(id => occupied[color].add(vertexDof[id]));
  }
  return colors;
}

function boundarySamples(vertices, rest, edgeMap) {
  if (!Array.isArray(vertices) || vertices.length < 2 || vertices.length > 20000) throw clothError('INVALID_SEAM', 'A seam needs an ordered boundary polyline');
  const cumulative = [0];
  for (let i = 1; i < vertices.length; i++) {
    const a = index(vertices[i - 1], rest.length, 'seam'), b = index(vertices[i], rest.length, 'seam');
    if (edgeMap.get(edgeKey(a, b))?.length !== 1) throw clothError('INVALID_SEAM', 'Seam segments must be confirmed mesh boundary edges');
    const delta = Math.hypot(rest[b][0] - rest[a][0], rest[b][1] - rest[a][1]);
    if (delta <= 1e-9) throw clothError('INVALID_SEAM', 'A seam contains a degenerate boundary segment');
    cumulative.push(cumulative.at(-1) + delta);
  }
  return { vertices, cumulative, total: cumulative.at(-1) };
}
function sampleBoundary(boundary, fraction) {
  const target = fraction * boundary.total;
  let i = 1; while (i < boundary.cumulative.length - 1 && boundary.cumulative[i] < target) i++;
  const start = boundary.cumulative[i - 1], t = (target - start) / (boundary.cumulative[i] - start);
  return { ids: [boundary.vertices[i - 1], boundary.vertices[i]], weights: [1 - t, t] };
}

/** Validate provenance-bearing panel topology, then convert millimetres once. */
export function buildTriangularClothModel(input, { weldExactSeams = false } = {}) {
  const descriptor = cloneStrictJson(input);
  if (!['string', 'number'].includes(typeof descriptor.sourceRevision) || descriptor.sourceRevision === '' || (typeof descriptor.sourceRevision === 'number' && !Number.isFinite(descriptor.sourceRevision))) throw clothError('INVALID_REVISION', 'Cloth needs an explicit source revision');
  const count = descriptor.positionsMm?.length, triangleCount = descriptor.triangles?.length;
  finiteInteger(count, 'vertex count', 3, TRIANGULAR_CLOTH_LIMITS.vertices);
  finiteInteger(triangleCount, 'triangle count', 1, TRIANGULAR_CLOTH_LIMITS.triangles);
  if (descriptor.restPositions2dMm?.length !== count) throw clothError('INVALID_TOPOLOGY', 'Every cloth vertex requires its physical 2D rest coordinate');
  const positions = descriptor.positionsMm.map(v => vector(v, 3, 'positionsMm').map(x => x / 1000));
  const rest = descriptor.restPositions2dMm.map(v => vector(v, 2, 'restPositions2dMm').map(x => x / 1000));
  const materials = new Map((descriptor.materials || []).map(value => { const material = normalizeClothMaterial(value); return [material.id, material]; }));
  if (!materials.size || materials.size !== descriptor.materials.length) throw clothError('INVALID_INPUT', 'Materials require unique identities');
  for (const key of ['trianglePieceIds', 'grainDirections', 'triangleMaterialIds']) if (descriptor[key]?.length !== triangleCount) throw clothError('INVALID_TOPOLOGY', `Every triangle needs ${key}`);
  const masses = Array(count).fill(0), thicknesses = Array(count).fill(0), frictions = Array(count).fill(0), constraints = [], triangles = [], edgeMap = new Map();
  const vertexPieces = Array.from({ length: count }, () => new Set()), neighbors = Array.from({ length: count }, (_, i) => new Set([i]));
  const usedFaces = new Set();
  for (let t = 0; t < triangleCount; t++) {
    const ids = descriptor.triangles[t];
    if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3) throw clothError('INVALID_TOPOLOGY', 'Triangles need three distinct vertices');
    ids.forEach(id => index(id, count, 'triangle'));
    const face = [...ids].sort((a, b) => a - b).join(':'); if (usedFaces.has(face)) throw clothError('INVALID_TOPOLOGY', 'Duplicate triangles are not manifold'); usedFaces.add(face);
    const pieceId = descriptor.trianglePieceIds[t], material = materials.get(descriptor.triangleMaterialIds[t]);
    if (typeof pieceId !== 'string' || !pieceId || !material) throw clothError('INVALID_TOPOLOGY', 'Triangle piece/material identity is unresolved');
    const [a, b, c] = ids.map(id => rest[id]), du = [b[0] - a[0], b[1] - a[1]], dv = [c[0] - a[0], c[1] - a[1]], determinant = du[0] * dv[1] - du[1] * dv[0], area = Math.abs(determinant) / 2;
    if (area < 1e-12 || length(cross(sub(positions[ids[1]], positions[ids[0]]), sub(positions[ids[2]], positions[ids[0]]))) < 1e-12) throw clothError('INVALID_TOPOLOGY', 'Degenerate triangles cannot carry a physical strain frame');
    const grain = vector(descriptor.grainDirections[t], 2, 'grainDirections'), grainLength = Math.hypot(...grain);
    if (grainLength < 1e-9) throw clothError('INVALID_TOPOLOGY', 'Grain direction must be nonzero');
    const gx = grain[0] / grainLength, gy = grain[1] / grainLength;
    const weightsFor = (x, y) => { const u = (dv[1] * x - dv[0] * y) / determinant, v = (-du[1] * x + du[0] * y) / determinant; return [-u - v, u, v]; };
    const warp = weightsFor(gx, gy), weft = weightsFor(-gy, gx);
    const triangle = { ids, pieceId, material, area, warp, weft, index: t }; triangles.push(triangle);
    constraints.push({ kind: 'warp', ids, triangle, lambda: 0 }, { kind: 'weft', ids, triangle, lambda: 0 }, { kind: 'shear', ids, triangle, lambda: 0 });
    for (const id of ids) { masses[id] += area * material.mass / 3; thicknesses[id] = Math.max(thicknesses[id], material.thickness); frictions[id] = Math.max(frictions[id], material.friction); vertexPieces[id].add(pieceId); ids.forEach(other => neighbors[id].add(other)); }
    for (let k = 0; k < 3; k++) { const from = ids[k], to = ids[(k + 1) % 3], key = edgeKey(from, to); if (!edgeMap.has(key)) edgeMap.set(key, []); edgeMap.get(key).push({ from, to, other: ids[(k + 2) % 3], triangle }); }
  }
  if (masses.some(mass => mass <= 0)) throw clothError('INVALID_TOPOLOGY', 'Isolated vertices have no defined sheet mass');
  const edges = [];
  for (const incident of edgeMap.values()) {
    if (incident.length > 2 || (incident.length === 2 && incident[0].from !== incident[1].to)) throw clothError('INVALID_TOPOLOGY', 'Panels must be consistently oriented manifolds');
    const edge = incident[0]; edges.push([edge.from, edge.to]);
    if (incident.length === 2) {
      const second = incident[1];
      if (edge.triangle.pieceId !== second.triangle.pieceId) throw clothError('INVALID_TOPOLOGY', 'Different cut pieces must use separate boundary vertices and explicit seams');
      const edgeLength = Math.hypot(rest[edge.from][0] - rest[edge.to][0], rest[edge.from][1] - rest[edge.to][1]);
      const rigidity = (edge.triangle.material.bending + second.triangle.material.bending) / 2;
      if (rigidity > 0) constraints.push({ kind: 'bend', ids: [edge.from, edge.to, edge.other, second.other], compliance: (edge.triangle.area + second.triangle.area) / (1.5 * rigidity * edgeLength ** 2), lambda: 0 });
    }
  }
  const seams = [];
  const seamClasses = new UnionFind(count);
  const weldClasses = new UnionFind(count);
  const seamRoot = id => seamClasses.find(id);
  for (const seam of descriptor.seams || []) {
    if (typeof seam.id !== 'string' || !seam.id) throw clothError('INVALID_SEAM', 'A seam requires an identity');
    const a = boundarySamples(seam.a, rest, edgeMap), b = boundarySamples(seam.b, rest, edgeMap);
    const ease = number(seam.easeMm, 'declared seam ease mm') / 1000;
    if (Math.abs(b.total - a.total - ease) > Math.max(.0005, Math.max(a.total, b.total) * .001)) throw clothError('SEAM_EASE_MISMATCH', 'Boundary lengths do not match the declared seam ease', { seamId: seam.id, mismatchMm: (b.total - a.total - ease) * 1000 });
    const fractions = new Set([0, 1, ...a.cumulative.map(v => v / a.total), ...b.cumulative.map(v => v / b.total)]);
    for (const fraction of [...fractions].sort((a, b) => a - b)) {
      const left = sampleBoundary(a, fraction), right = sampleBoundary(b, fraction);
      const ids = [...left.ids, ...right.ids], weights = [...left.weights, ...right.weights.map(value => -value)];
      const constraint = { kind: 'seam', ids, weights, seamId: seam.id, compliance: number(seam.complianceMPerN ?? 0, 'seam compliance m/N', 0, 1), lambda: 0 };
      if (new Set(ids).size < ids.length) throw clothError('INVALID_SEAM', 'Seams must join independent cut boundaries');
      constraints.push(constraint); seams.push(constraint);
      const exactLeft = left.weights.findIndex(weight => weight > 1 - 1e-12), exactRight = right.weights.findIndex(weight => weight > 1 - 1e-12);
      if (exactLeft >= 0 && exactRight >= 0) seamClasses.union(left.ids[exactLeft], right.ids[exactRight]);
      if (weldExactSeams && constraint.compliance === 0 && exactLeft >= 0 && exactRight >= 0) weldClasses.union(left.ids[exactLeft], right.ids[exactRight]);
      for (const id of left.ids) for (const other of right.ids) { neighbors[id].add(other); neighbors[other].add(id); }
    }
  }
  // A sewn vertex can have several separate cut-panel representatives. Its
  // physical one-ring crosses every confirmed seam at the junction. Preserve
  // contact between distant parts; only this assembled topological one-ring is
  // excluded, rather than excluding whole pieces or extending a spatial radius.
  const assembledNeighbors = new Map(), representatives = new Map();
  for (let id = 0; id < count; id++) {
    const root = seamRoot(id);
    if (!representatives.has(root)) { representatives.set(root, []); assembledNeighbors.set(root, new Set()); }
    representatives.get(root).push(id);
    for (const neighbor of neighbors[id]) assembledNeighbors.get(root).add(seamRoot(neighbor));
  }
  for (let id = 0; id < count; id++) for (const root of assembledNeighbors.get(seamRoot(id))) for (const neighbor of representatives.get(root)) neighbors[id].add(neighbor);
  const inverseMasses = masses.map(mass => 1 / mass), pins = new Map();
  const attachments = [], attachmentIds = new Set(), triangleKeys = new Set(triangles.map(triangle => triangle.ids.join(',')));
  for (const attachment of descriptor.attachments || []) {
    if (typeof attachment.id !== 'string' || !attachment.id || attachmentIds.has(attachment.id)) throw clothError('INVALID_ATTACHMENT', 'Attachments require unique identities');
    attachmentIds.add(attachment.id);
    const vertex = index(attachment.vertex, count, 'attachment'), ids = attachment.triangle;
    if (!Array.isArray(ids) || ids.length !== 3 || ids.includes(vertex) || !triangleKeys.has(ids.join(','))) throw clothError('INVALID_ATTACHMENT', 'An attachment requires one separate vertex and an oriented existing parent triangle');
    const barycentric = vector(attachment.barycentric, 3, 'attachment barycentric');
    if (barycentric.some(value => value < -1e-9 || value > 1 + 1e-9) || Math.abs(barycentric.reduce((a, b) => a + b, 0) - 1) > 1e-8) throw clothError('INVALID_ATTACHMENT', 'Attachment barycentric weights must lie in the parent triangle');
    const record = { id: attachment.id, ids: [vertex, ...ids], barycentric, normalOffset: number(attachment.normalOffsetMm ?? 0, 'attachment normal offset mm', -100, 100) / 1000, compliance: number(attachment.complianceMPerN ?? 0, 'attachment compliance m/N', 0, 1) };
    for (let axis = 0; axis < 3; axis++) { const constraint = { ...record, kind: 'attachment', axis, lambda: 0 }; constraints.push(constraint); attachments.push(constraint); }
    for (const id of ids) { neighbors[vertex].add(id); neighbors[id].add(vertex); }
  }
  for (const pin of descriptor.pins || []) {
    const id = index(pin.vertex, count, 'pin'); if (pins.has(id)) throw clothError('CONFLICTING_PINS', 'A vertex has more than one pin');
    pins.set(id, pin.positionMm ? vector(pin.positionMm, 3, 'pin position').map(x => x / 1000) : [...positions[id]]); inverseMasses[id] = 0; positions[id] = [...pins.get(id)];
  }
  const vertexDof = Array.from({ length: count }, (_, id) => weldClasses.find(id)), groups = new Map();
  for (let id = 0; id < count; id++) { const root = vertexDof[id]; if (!groups.has(root)) groups.set(root, []); groups.get(root).push(id); }
  for (const [root, ids] of groups) {
    if (ids.length === 1) continue;
    const totalMass = ids.reduce((sum, id) => sum + masses[id], 0), fixed = ids.filter(id => pins.has(id));
    const position = fixed.length ? positions[fixed[0]] : [0, 1, 2].map(axis => ids.reduce((sum, id) => sum + positions[id][axis] * masses[id], 0) / totalMass);
    if (fixed.some(id => length(sub(positions[id], position)) > 1e-9)) throw clothError('CONFLICTING_PINS', 'Pins prescribe different positions for the same zero-compliance sewn vertex', { vertices: fixed });
    for (const id of ids) { inverseMasses[id] = fixed.length ? 0 : 1 / totalMass; positions[id] = position; }
    if (fixed.length) pins.set(root, position);
  }
  if (weldExactSeams) for (const triangle of triangles) if (length(cross(sub(positions[triangle.ids[1]], positions[triangle.ids[0]]), sub(positions[triangle.ids[2]], positions[triangle.ids[0]]))) < 1e-12) throw clothError('INVALID_SEAM', 'An exact seam would collapse a physical triangle');
  const seamEdges=(descriptor.seams||[]).filter(seam=>(seam.complianceMPerN??0)===0).flatMap(seam=>[seam.a,seam.b].flatMap(chain=>chain.slice(1).map((id,i)=>[chain[i],id])));
  const seamCollar=createSeamContactCollar({rest,edges,vertexDof,thicknesses,triangles:triangles.map(triangle=>triangle.ids),seamEdges});
  for(const [a,b] of seamCollar.pairs){neighbors[a].add(b);neighbors[b].add(a);}
  const seamContactCollar={metric:seamCollar.metric,radiusPolicy:seamCollar.radiusPolicy,pairCount:seamCollar.pairs.length,visited:seamCollar.visited,portalNodes:seamCollar.portalNodes||0};
  const restChartContact=createRestChartContactSupport({rest,edges,triangles:triangles.map(triangle=>triangle.ids)});
  const exclusions = new Set();
  for (const pair of descriptor.collisionExclusions || []) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(id => !descriptor.trianglePieceIds.includes(id))) throw clothError('INVALID_INPUT', 'Bonded-layer collision exclusions require two existing piece identities');
    exclusions.add([...pair].sort().join('\u0000'));
  }
  const options = descriptor.options || {}, configuration = {
    outerStepSeconds: number(options.outerStepSeconds ?? 1 / 60, 'outer step seconds', 1 / 1000, 1 / 30),
    substeps: finiteInteger(options.substeps ?? 4, 'substeps', 1, 16), iterations: finiteInteger(options.iterations ?? 12, 'iterations', 1, 48),
    gravity: vector(options.gravityMps2 ?? [0, -9.80665, 0], 3, 'gravity m/s²'),
    dampingPerSecond: number(options.dampingPerSecond ?? 2, 'damping per second', 0, 100),
    selfContact: options.selfContact !== false,
  };
  if (descriptor.velocitiesMmPerSecond && descriptor.velocitiesMmPerSecond.length !== count) throw clothError('INVALID_INPUT', 'Initial velocities require one vector per vertex');
  const velocities = positions.map((_, id) => pins.has(id) || !descriptor.velocitiesMmPerSecond ? [0, 0, 0] : vector(descriptor.velocitiesMmPerSecond[id], 3, 'velocity mm/s').map(value => value / 1000));
  for (const [root, ids] of groups) if (ids.length > 1) {
    const totalMass = ids.reduce((sum, id) => sum + masses[id], 0), velocity = inverseMasses[root] ? [0, 1, 2].map(axis => ids.reduce((sum, id) => sum + velocities[id][axis] * masses[id], 0) / totalMass) : [0, 0, 0];
    for (const id of ids) velocities[id] = velocity;
  }
  return { descriptor, sourceRevision: descriptor.sourceRevision, positions, rest, materials, triangles, edges, neighbors, vertexPieces, exclusions,
    masses, inverseMasses, thicknesses, frictions, constraints, colors: colorConstraints(constraints, vertexDof), seams, attachments, pins, configuration,
    clothVertexCount: count, colliders: descriptor.colliders || [], velocities, vertexDof, vertexGroups: groups, degreesOfFreedom: [...groups.keys()], weldedSeams: weldExactSeams, seamContactCollar, restChartContact };
}

/** Keep the retained cut-panel identities while moving one physical sewn DOF. */
export function setClothPosition(model, id, position) {
  for (const member of model.vertexGroups.get(model.vertexDof[id])) model.positions[member] = position;
}
