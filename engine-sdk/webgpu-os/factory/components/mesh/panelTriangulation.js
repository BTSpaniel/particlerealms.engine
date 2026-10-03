// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { orientation2DReport } from '../../../../engine/core/math/RobustNumericMath.js';
import { normalizePhysicalMesh, analyzePanelTopology, physicalEdgeId } from './physicalMesh.js';
import { checkPanelEmbedding } from './panelGeometry.js';
import { laplacianSmooth } from '../../../../engine/kaolin/ops/mesh/MeshOps.js';

const failure = message => Object.assign(new Error(message), { code: 'INVALID_TRIANGULATION' });

/** Improve a flat physical panel using constrained local Delaunay flips.
 * Retains every point, the outside boundary and authored internal edges. Only
 * derived face connectivity changes; this never alters a saved bent surface.
 */
export function improvePhysicalPanelTriangulation(value, { check = () => {}, maxFlips = 200000 } = {}) {
  check(); const mesh = normalizePhysicalMesh(value), topology = analyzePanelTopology(mesh);
  if (!topology.valid || !mesh.source2D || !Number.isSafeInteger(maxFlips) || maxFlips < 0 || maxFlips > 1000000) throw failure('Triangulation needs a valid physical source chart and a bounded flip count');
  const source = new Map(mesh.source2D.vertexIds.map((id, index) => [id, mesh.source2D.positions.slice(index * 2, index * 2 + 2)])), points = mesh.vertexIds.map(id => source.get(id));
  const shift = [mesh.positions[0] - points[0][0], mesh.positions[1] - points[0][1], mesh.positions[2]];
  if (points.some((point, index) => Math.hypot(mesh.positions[index * 3] - point[0] - shift[0], mesh.positions[index * 3 + 1] - point[1] - shift[1], mesh.positions[index * 3 + 2] - shift[2]) > 1e-7)) throw failure('Retriangulate the flat physical chart before posing or bending it');
  const orient = (a, b, c) => orientation2DReport(points[a], points[b], points[c]).determinant;
  const faces = mesh.faceIds.map((_, index) => mesh.triangles.slice(index * 3, index * 3 + 3));
  if (faces.some(face => orient(...face) <= 1e-10)) throw failure('Physical chart faces must have positive area');
  const edges = new Map(), key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const locked = new Set(topology.edges.filter(edge => edge.faces.length === 1).map(edge => key(edge.a, edge.b)));
  const byId = new Map(mesh.vertexIds.map((id, index) => [id, index]));
  for (const path of mesh.constraints?.paths || []) for (const edge of path.edges) for (let i = 1; i < edge.vertexIds.length; i++) {
    const a = byId.get(edge.vertexIds[i - 1]), b = byId.get(edge.vertexIds[i]);
    if (a == null || b == null || !topology.edges.some(value => value.id === physicalEdgeId(edge.vertexIds[i - 1], edge.vertexIds[i]))) throw failure('An internal constraint is absent from the physical mesh');
    locked.add(key(a, b));
  }
  const update = (faceIndex, add) => {
    const face = faces[faceIndex];
    for (let i = 0; i < 3; i++) { const a = face[i], b = face[(i + 1) % 3], id = key(a, b), entry = edges.get(id) || { a, b, faces: new Set() }; if (add) entry.faces.add(faceIndex); else entry.faces.delete(faceIndex); if (entry.faces.size) edges.set(id, entry); else edges.delete(id); }
  };
  faces.forEach((_, index) => update(index, true)); const queue = [...edges.keys()]; let flips = 0;
  const angle = (a, b, c) => { const p = points[a], q = points[b], r = points[c], x = p[0] - r[0], y = p[1] - r[1], u = q[0] - r[0], v = q[1] - r[1]; return Math.atan2(Math.abs(orient(c, a, b)), x * u + y * v); };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (cursor % 256 === 0) check(); const id = queue[cursor], edge = edges.get(id);
    if (!edge || edge.faces.size !== 2 || locked.has(id)) continue;
    const [left, right] = [...edge.faces], { a, b } = edge, c = faces[left].find(index => index !== a && index !== b), d = faces[right].find(index => index !== a && index !== b);
    if (c === d || edges.has(key(c, d)) || orient(c, d, a) * orient(c, d, b) >= -1e-20 || angle(a, b, c) + angle(a, b, d) <= Math.PI + 1e-10) continue;
    const replacement = [[c, d, a], [d, c, b]].map(face => orient(...face) < 0 ? [face[1], face[0], face[2]] : face);
    if (replacement.some(face => orient(...face) <= 1e-10)) continue;
    if (flips >= maxFlips) throw Object.assign(new Error('Physical triangulation reached its bounded flip count'), { code: 'MESH_BUDGET' });
    update(left, false); update(right, false); faces[left] = replacement[0]; faces[right] = replacement[1]; update(left, true); update(right, true); flips++;
    for (const index of [left, right]) { const face = faces[index]; mesh.faceIds[index] = `${mesh.id || 'panel'}:tri:${[...face].sort((a, b) => a - b).join(',')}`; for (let i = 0; i < 3; i++) queue.push(key(face[i], face[(i + 1) % 3])); }
  }
  mesh.triangles = faces.flat(); const checked = analyzePanelTopology(mesh), embedding = checkPanelEmbedding(mesh, points.flat(), { check });
  if (!checked.valid || !embedding.valid) throw failure(embedding.message || 'Improved triangulation failed topology verification');
  check(); console.debug('[Factory][panel-triangulation]', { vertices: mesh.vertexIds.length, triangles: faces.length, flips }); return mesh;
}

/** Redistribute explicitly selected derived samples inside the same flat area.
 * Cutting boundaries and internal sewing features are always fixed. A proposed
 * Kaolin smoothing step is accepted only when its worst incident face improves.
 */
export function improvePhysicalPanelInterior(value, { vertexIds, iterations = 12, check = () => {} } = {}) {
  let mesh = improvePhysicalPanelTriangulation(value, { check });
  if (!Array.isArray(vertexIds) || new Set(vertexIds).size !== vertexIds.length || vertexIds.some(id => !mesh.vertexIds.includes(id)) || !Number.isSafeInteger(iterations) || iterations < 0 || iterations > 24) throw failure('Choose explicit derived interior samples and bounded smoothing passes');
  const selected = new Set(vertexIds), indices = mesh.vertexIds.map((id, index) => selected.has(id) ? index : -1).filter(index => index >= 0), pinned = new Set(mesh.vertexIds.map((id, index) => selected.has(id) ? -1 : index).filter(index => index >= 0));
  const topology = analyzePanelTopology(mesh), forbidden = new Set(topology.boundaries.flat().map(index => mesh.vertexIds[index]));
  for (const path of mesh.constraints?.paths || []) for (const edge of path.edges) for (const id of edge.vertexIds) forbidden.add(id);
  if (vertexIds.some(id => forbidden.has(id))) throw failure('Cutting edges and internal sewing references cannot move during remeshing');
  const sourceIndex = new Map(mesh.source2D.vertexIds.map((id, index) => [id, index])), shift = [mesh.positions[0] - mesh.source2D.positions[sourceIndex.get(mesh.vertexIds[0]) * 2], mesh.positions[1] - mesh.source2D.positions[sourceIndex.get(mesh.vertexIds[0]) * 2 + 1]];
  const quality = (face, changing, point) => {
    const p = face.map(index => index === changing ? point : mesh.positions.slice(index * 3, index * 3 + 2)), area = orientation2DReport(...p).determinant;
    if (!(area > 1e-10)) return -Infinity;
    const squared = p.reduce((sum, a, i) => sum + (a[0] - p[(i + 1) % 3][0]) ** 2 + (a[1] - p[(i + 1) % 3][1]) ** 2, 0);
    return 2 * Math.sqrt(3) * area / squared;
  };
  let moved = 0;
  for (let pass = 0; pass < iterations; pass++) {
    check(); const current = analyzePanelTopology(mesh), local = mesh.vertexIds.flatMap(id => [...mesh.source2D.positions.slice(sourceIndex.get(id) * 2, sourceIndex.get(id) * 2 + 2), 0]);
    const proposed = laplacianSmooth(new Float64Array(local), new Uint32Array(mesh.triangles), 1, 1, pinned); let changed = false;
    for (const index of indices) {
      check(); const faces = current.incident[index].map(f => mesh.triangles.slice(f * 3, f * 3 + 3)), point = mesh.positions.slice(index * 3, index * 3 + 2), before = Math.min(...faces.map(face => quality(face, index, point)));
      for (let amount = 1; amount >= 1 / 64; amount /= 2) {
        const sourcePoint = mesh.source2D.positions.slice(sourceIndex.get(mesh.vertexIds[index]) * 2, sourceIndex.get(mesh.vertexIds[index]) * 2 + 2), localCandidate = sourcePoint.map((value, axis) => value + amount * (proposed[index * 3 + axis] - value)), candidate = localCandidate.map((value, axis) => value + shift[axis]);
        if (Math.min(...faces.map(face => quality(face, index, candidate))) <= before + 1e-9) continue;
        for (let axis = 0; axis < 2; axis++) { mesh.positions[index * 3 + axis] = candidate[axis]; mesh.source2D.positions[sourceIndex.get(mesh.vertexIds[index]) * 2 + axis] = localCandidate[axis]; }
        changed = true; moved++; break;
      }
    }
    if (!changed) break; mesh = improvePhysicalPanelTriangulation(mesh, { check });
  }
  check(); console.debug('[Factory][panel-interior]', { selectedSamples: vertexIds.length, acceptedMoves: moved }); return mesh;
}
