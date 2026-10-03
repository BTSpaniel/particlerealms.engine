// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { normalizeVectorModel, vectorContours, vectorEdges, pointOnVectorEdge, snapVectorPoint } from '../drawing/index.js';
import { closestPointOnSegment, lineLineIntersection, pointInPolygon2D } from '../../../../engine/core/math/MathGeometry.js';
import { ringSignedArea, triangulateRing } from '../../../../engine/render/geometry/Profile2D.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const EPSILON = 1e-7;

/** The same arc-length sampling retains outside and internal authored edges. */
export function samplePhysicalPathEdges(item, { toleranceMm, maxBoundarySegmentMm, requiredFractions = {}, check }) {
  const edges = vectorEdges(item, toleranceMm);
  if (Object.keys(requiredFractions).some(id => !edges.some(edge => edge.edgeId === id))) throw fail('ORPHAN_REFERENCE', 'A requested sewing position belongs to a removed edge');
  return edges.flatMap(edge => {
    check();
    if (edge.length <= 1e-9) { if (requiredFractions[edge.edgeId]?.length) throw fail('DEGENERATE_EDGE', 'A referenced edge has no physical length'); return []; }
    const required = requiredFractions[edge.edgeId] || [];
    if (!Array.isArray(required) || required.some(t => !Number.isFinite(t) || t < 0 || t > 1)) throw fail('INVALID_REFERENCE', 'Sewing locations must be arc-length fractions from zero to one');
    const retained = [0, 1, ...edge.lengths.map(length => length / edge.length), ...required].sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > 1e-12), fractions = [retained[0]];
    // Subdivide each retained interval. An unrelated uniform grid can create
    // almost coincident samples beside curve points and sewing references.
    for (let i = 1; i < retained.length; i++) {
      const start = retained[i - 1], end = retained[i], count = Math.ceil((end - start) * edge.length / maxBoundarySegmentMm);
      if (fractions.length + count > 1501) throw fail('MESH_BUDGET', 'This path needs more than 1500 vertices. Increase its mesh spacing.');
      for (let k = 1; k <= count; k++) fractions.push(start + (end - start) * k / count);
    }
    return [{ ...edge, fractions, samples: fractions.map(t => pointOnVectorEdge(edge, t)) }];
  });
}

/** Only explicit boundary-to-boundary paths can partition the chart. */
export function prepareContourConstraints(item, paths, { toleranceMm, maxBoundarySegmentMm, requiredFractions, check }) {
  if (!Array.isArray(paths) || paths.length > 64) throw fail('CONSTRAINT_BUDGET', 'A physical chart supports at most 64 internal constraint paths');
  const boundaryFractions = structuredClone(requiredFractions), seen = new Set();
  const constraints = paths.map(value => {
    check();
    const path = normalizeVectorModel({ schema: 'factory.vector.v1', unit: 'mm', items: [value.item] }).items[0], contours = vectorContours(path, toleranceMm);
    if (seen.has(path.id) || path.id === item.id) throw fail('DUPLICATE_CONSTRAINT', 'Internal constraint paths need distinct identities'); seen.add(path.id);
    if (contours.length !== 1 || contours[0].closed || contours[0].points.length < 2) throw fail('INVALID_CONSTRAINT', 'Each internal constraint must be one open path');
    const edges = samplePhysicalPathEdges(path, { toleranceMm, maxBoundarySegmentMm, requiredFractions: value.requiredFractions, check });
    if (!edges.length) throw fail('INVALID_CONSTRAINT', 'An internal constraint has no physical length');
    for (const point of [edges[0].samples[0], edges.at(-1).samples.at(-1)]) {
      const snapped = snapVectorPoint({ items: [item] }, point, { radius: EPSILON, tolerance: toleranceMm, kinds: ['path'] });
      if (!snapped.reference) throw fail('DANGLING_CONSTRAINT', 'Both ends of an internal path must meet the physical outline. Extend or split the path explicitly.');
      (boundaryFractions[snapped.reference.edgeId] ||= []).push(snapped.reference.t);
    }
    return { id: path.id, edges };
  });
  return { constraints, boundaryFractions };
}

function contacts(a, b, c, d) {
  const points = [], hit = lineLineIntersection(a, b, c, d); if (hit) points.push(hit);
  const on = (point, start, end) => distance(point, closestPointOnSegment([...point, 0], [...start, 0], [...end, 0])) <= EPSILON;
  for (const point of [a, b]) if (on(point, c, d)) points.push(point);
  for (const point of [c, d]) if (on(point, a, b)) points.push(point);
  return points;
}

/** Partition, never cut away fabric. All regions share the same constraint vertices. */
export function partitionContourMesh(ring, vertexIds, constraints, { originMm, check }) {
  const points = ring.map(point => [...point]), regions = [ring.map((_, i) => i)], paths = [], previousSegments = [];
  for (const constraint of constraints) {
    check(); const chain = [], edgeMaps = [];
    for (const edge of constraint.edges) {
      const ids = [];
      for (let index = 0; index < edge.samples.length; index++) {
        const sample = edge.samples[index], point = [sample.x - originMm[0], sample.y - originMm[1]], previous = chain.at(-1);
        if (previous != null && distance(points[previous], point) <= EPSILON) { ids.push(vertexIds[previous]); continue; }
        const boundary = ring.findIndex(candidate => distance(candidate, point) <= EPSILON);
        let vertex = boundary;
        if (vertex < 0) { vertex = points.length; points.push(point); vertexIds.push(`${constraint.id}:constraint:${edge.edgeId}:${Number(edge.fractions[index].toPrecision(14))}`); }
        if (points.length > 1500) throw fail('MESH_BUDGET', 'The complete outline and internal paths exceed the 1500-vertex meshing budget');
        chain.push(vertex); ids.push(vertexIds[vertex]);
      }
      edgeMaps.push({ edgeId: edge.edgeId, vertexIds: ids, fractions: edge.fractions, sourceLengthMm: edge.length });
    }
    if (chain.length < 2 || chain[0] >= ring.length || chain.at(-1) >= ring.length || chain[0] === chain.at(-1)) throw fail('INVALID_CONSTRAINT', 'An internal path needs two distinct points on the outside boundary');
    const segments = chain.slice(1).map((end, index) => [points[chain[index]], points[end]]), ends = [points[chain[0]], points[chain.at(-1)]];
    for (let i = 0; i < segments.length; i++) {
      check(); const [a, b] = segments[i], midpoint = a.map((v, axis) => (v + b[axis]) / 2);
      if (!pointInPolygon2D(midpoint, ring)) throw fail('OUTSIDE_CONSTRAINT', 'An internal path leaves or follows the outside boundary');
      for (let j = 0; j < ring.length; j++) if (contacts(a, b, ring[j], ring[(j + 1) % ring.length]).some(p => !ends.some(end => distance(p, end) <= EPSILON))) throw fail('CROSSING_CONSTRAINT', 'An internal path crosses or touches the boundary away from its endpoints');
      for (const [c, d] of previousSegments) if (contacts(a, b, c, d).length) throw fail('CROSSING_CONSTRAINT', 'Internal paths cross or share points. Supply an explicit junction before meshing.');
      for (let j = 0; j < i; j++) if (contacts(a, b, ...segments[j]).some(p => j !== i - 1 || distance(p, a) > EPSILON)) throw fail('CROSSING_CONSTRAINT', 'An internal path crosses or overlaps itself');
    }
    const regionIndex = regions.findIndex(region => region.includes(chain[0]) && region.includes(chain.at(-1)));
    if (regionIndex < 0) throw fail('CROSSING_CONSTRAINT', 'The path does not lie within one confirmed chart region');
    const region = regions[regionIndex], first = region.indexOf(chain[0]), last = region.indexOf(chain.at(-1));
    const arc = (a, b) => { const result = [region[a]]; for (let i = (a + 1) % region.length; i !== (b + 1) % region.length; i = (i + 1) % region.length) result.push(region[i]); return result; };
    const internal = chain.slice(1, -1), split = [arc(first, last).concat([...internal].reverse()), arc(last, first).concat(internal)];
    const before = Math.abs(ringSignedArea(region.map(i => points[i]))), after = split.map(part => Math.abs(ringSignedArea(part.map(i => points[i]))));
    if (after.some(area => area <= 1e-8) || Math.abs(after[0] + after[1] - before) > Math.max(1e-7, before * 1e-10)) throw fail('INVALID_CONSTRAINT', 'An internal path does not form two complete non-overlapping regions');
    regions.splice(regionIndex, 1, ...split); previousSegments.push(...segments); paths.push({ id: constraint.id, edges: edgeMaps });
  }
  return { points, regions, paths };
}

/** Keep collinear sampling out of ear selection, then restore every exact vertex. */
export function triangulatePhysicalRegion(region, points, { check }) {
  const oriented = ringSignedArea(region.map(i => points[i])) > 0 ? [...region] : [...region].reverse(), corners = [...oriented];
  let changed = true;
  while (changed && corners.length > 3) {
    changed = false; check();
    for (let i = 0; i < corners.length; i++) {
      const a = points[corners[(i - 1 + corners.length) % corners.length]], b = points[corners[i]], c = points[corners[(i + 1) % corners.length]];
      if (distance(a, c) <= EPSILON) throw fail('INVALID_CONSTRAINT', 'A region contains a reversed or touching edge');
      if (distance(b, closestPointOnSegment([...b, 0], [...a, 0], [...c, 0])) <= EPSILON) { corners.splice(i, 1); changed = true; break; }
    }
  }
  const result = triangulateRing(corners.map(i => points[i])).map(face => face.map(i => corners[i]));
  if (result.length !== corners.length - 2) throw fail('INCOMPLETE_TRIANGULATION', 'The chart region could not be completely meshed. Resolve crossing or touching edges.');
  for (let edge = 0; edge < corners.length; edge++) {
    check(); const a = corners[edge], b = corners[(edge + 1) % corners.length], chain = [a];
    for (let i = (oriented.indexOf(a) + 1) % oriented.length; oriented[i] !== b; i = (i + 1) % oriented.length) chain.push(oriented[i]);
    chain.push(b); if (chain.length === 2) continue;
    const at = result.findIndex(face => face.some((id, k) => id === a && face[(k + 1) % 3] === b));
    if (at < 0) throw fail('INCOMPLETE_TRIANGULATION', 'A retained chart edge lost its adjacent triangle');
    const face = result[at], third = face[(face.indexOf(a) + 2) % 3];
    result.splice(at, 1, ...chain.slice(1).map((end, i) => [chain[i], end, third]));
  }
  if (result.length !== oriented.length - 2) throw fail('INCOMPLETE_TRIANGULATION', 'The chart did not retain all physical sampling locations');
  return result;
}
