// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { normalizeVectorModel, vectorContours } from '../drawing/index.js';
import { ringSignedArea } from '../../../../engine/render/geometry/Profile2D.js';
import { normalizePhysicalMesh, analyzePanelTopology, physicalEdgeId, refinePhysicalMeshFaces } from './physicalMesh.js';
import { checkPanelEmbedding } from './panelGeometry.js';
import { improvePhysicalPanelTriangulation } from './panelTriangulation.js';
import { samplePhysicalPathEdges, prepareContourConstraints, partitionContourMesh, triangulatePhysicalRegion } from './contourConstraints.js';

const error = (code, message) => Object.assign(new Error(message), { code });
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Preserve authored curve/edge identities through a checked physical flat mesh.
 * This is a geometric reference, not an assembled or materially verified cloth.
 */
export function createPhysicalContourMesh(value, { sourceRevision, originMm = [0, 0], toleranceMm = .002, maxBoundarySegmentMm = 25, maxTriangleAreaMm2 = 2500, requiredFractions = {}, constraintPaths = [], timeBudgetMs = 30000, signal } = {}) {
  if (!Number.isFinite(timeBudgetMs) || timeBudgetMs <= 0 || timeBudgetMs > 30000) throw error('INVALID_BUDGET', 'Physical contour meshing needs a positive budget of at most 30 seconds');
  const started = performance.now(), check = () => { signal?.throwIfAborted(); if (performance.now() - started > timeBudgetMs) throw error('MESH_BUDGET', 'Physical contour meshing exhausted its time budget'); }; check();
  if (typeof sourceRevision !== 'string' || !sourceRevision || !Array.isArray(originMm) || originMm.length !== 2 || !originMm.every(Number.isFinite)) throw error('INVALID_SOURCE', 'A contour mesh needs a source revision and a physical origin');
  if (!Number.isFinite(toleranceMm) || toleranceMm < .0001 || toleranceMm > .05 || !Number.isFinite(maxBoundarySegmentMm) || maxBoundarySegmentMm < 1 || maxBoundarySegmentMm > 1000 || !Number.isFinite(maxTriangleAreaMm2) || maxTriangleAreaMm2 < 1 || maxTriangleAreaMm2 > 1e8) throw error('INVALID_RESOLUTION', 'Choose a bounded physical curve tolerance and mesh resolution');
  const item = normalizeVectorModel({ schema: 'factory.vector.v1', unit: 'mm', items: [value] }).items[0], contours = vectorContours(item, toleranceMm);
  if (contours.length !== 1 || !contours[0].closed) throw error('EXPLICIT_CUT_REQUIRED', 'This mesh requires one closed outline. Keep holes and separate contours until explicit panel cuts are supplied.');
  const prepared = prepareContourConstraints(item, constraintPaths, { toleranceMm, maxBoundarySegmentMm, requiredFractions, check });
  const edges = samplePhysicalPathEdges(item, { toleranceMm, maxBoundarySegmentMm, requiredFractions: prepared.boundaryFractions, check }), ring = [], vertexIds = [], mapped = [];
  for (const edge of edges) {
    check();
    const fractions = edge.fractions, ids = [];
    for (let i = 0; i < fractions.length; i++) {
      const t = fractions[i], position = edge.samples[i], point = [position.x - originMm[0], position.y - originMm[1]];
      if (ring.length && distance(point, ring.at(-1)) <= 1e-9) ids.push(vertexIds.at(-1));
      else {
        if (ring.length >= 1501) throw error('MESH_BUDGET', 'This outline exceeds the 1500 boundary-vertex budget. Split the panel or increase its tolerance.');
        const id = `${item.id}:boundary:${edge.edgeId}:${Number(t.toPrecision(14))}`; ring.push(point); vertexIds.push(id); ids.push(id);
      }
    }
    mapped.push({ edgeId: edge.edgeId, vertexIds: ids, fractions, sourceLengthMm: edge.length });
  }
  if (ring.length < 4 || distance(ring[0], ring.at(-1)) > 1e-7) throw error('OPEN_CONTOUR', 'The physical outline does not close');
  const lastId = vertexIds.pop(); ring.pop();
  for (const edge of mapped) edge.vertexIds = edge.vertexIds.map(id => id === lastId ? vertexIds[0] : id);
  const area = ringSignedArea(ring); if (Math.abs(area) <= 1e-8) throw error('DEGENERATE_CONTOUR', 'The outline has no physical area');
  const partition = partitionContourMesh(ring, vertexIds, prepared.constraints, { originMm, check });
  const points = partition.points, initial = partition.regions.flatMap(region => triangulatePhysicalRegion(region, points, { check }));
  check();
  const triangles = initial.flat(), faceIds = initial.map((_, i) => `${item.id}:face:${i}`);
  if (initial.some(face => ringSignedArea(face.map(i => points[i])) <= 1e-10)) throw error('DEGENERATE_TRIANGLE', 'The contour creates a collapsed or flipped triangle');
  const source2D = { vertexIds: [...vertexIds], positions: points.flat(), sourceRevision };
  let mesh = normalizePhysicalMesh({ schema: 'factory.mesh.v1', unit: 'mm', id: item.id, name: item.name || item.id, sourceRevision, positions: points.flatMap(point => [...point, 0]), triangles, vertexIds, faceIds, source2D, color: item.stroke || '#b5a483',
    boundary: { schema: 'factory.mesh-boundary.v1', sourceItemId: item.id, toleranceMm, originMm: [...originMm], edges: mapped }, constraints: { schema: 'factory.mesh-constraints.v1', paths: partition.paths }, readiness: { geometryEditable: true, assemblyEstablished: false, physicalFitVerified: false } });
  mesh = improvePhysicalPanelTriangulation(mesh, { check });
  for (let pass = 0; ; pass++) {
    check(); const selected = mesh.faceIds.filter((_, i) => ringSignedArea(mesh.triangles.slice(i * 3, i * 3 + 3).map(index => mesh.source2D.positions.slice(index * 2, index * 2 + 2))) > maxTriangleAreaMm2);
    if (!selected.length) break;
    if (pass >= 12) throw error('MESH_BUDGET', 'Physical contour refinement exhausted its bounded passes');
    mesh = improvePhysicalPanelTriangulation(refinePhysicalMeshFaces(mesh, { faceIds: selected }), { check });
  }
  const topology = analyzePanelTopology(mesh); if (!topology.valid || !topology.disk) throw error('INVALID_TOPOLOGY', topology.issues.map(issue => issue.message).join('; ') || 'The contour does not form one disk-shaped panel');
  const embedding = checkPanelEmbedding(mesh, mesh.source2D.positions, { check }); if (!embedding.valid) throw error('INVALID_EMBEDDING', embedding.message);
  const totalArea = mesh.faceIds.reduce((sum, _, i) => sum + ringSignedArea(mesh.triangles.slice(i * 3, i * 3 + 3).map(id => mesh.source2D.positions.slice(id * 2, id * 2 + 2))), 0);
  if (Math.abs(totalArea - Math.abs(area)) > Math.max(1e-7, Math.abs(area) * 1e-10)) throw error('AREA_MISMATCH', 'Meshed faces do not cover the original physical outline');
  const indices = new Map(mesh.vertexIds.map((id, i) => [id, i])), meshEdges = new Map(topology.edges.map(edge => [edge.id, edge]));
  for (const [role, edges] of [['boundary', mesh.boundary.edges], ['internal', mesh.constraints.paths.flatMap(path => path.edges)]]) for (const edge of edges) {
    check();
    edge.polylineLengthMm = 0;
    for (let i = 1; i < edge.vertexIds.length; i++) {
      const a = edge.vertexIds[i - 1], b = edge.vertexIds[i], physical = meshEdges.get(physicalEdgeId(a, b));
      if (physical?.faces.length !== (role === 'boundary' ? 1 : 2)) throw error('UNMAPPED_BOUNDARY', 'An authored edge lost its physical boundary or internal constraint segment');
      edge.polylineLengthMm += distance(mesh.source2D.positions.slice(indices.get(a) * 2, indices.get(a) * 2 + 2), mesh.source2D.positions.slice(indices.get(b) * 2, indices.get(b) * 2 + 2));
    }
    if (Math.abs(edge.polylineLengthMm - edge.sourceLengthMm) > Math.max(.01, edge.sourceLengthMm * 1e-6)) throw error('BOUNDARY_LENGTH_MISMATCH', 'A meshed boundary does not retain the source sewing length');
  }
  check();
  console.debug('[Factory][contour-mesh]', { vertices: mesh.vertexIds.length, triangles: mesh.faceIds.length, boundaryEdges: mapped.length });
  return mesh;
}
