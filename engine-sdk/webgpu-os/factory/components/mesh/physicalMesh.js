// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { HalfEdgeMesh, buildVertexAdjacency, buildVertexFaceAdjacency } from '../../../../engine/kaolin/ops/mesh/MeshOps.js';
import { cssColorParseReport } from '../../../../engine/core/math/MathColor.js';
import { normalizeWovenAppearance } from '../../../../engine/sim/cloth/FiberMaterials.js';

export const PHYSICAL_MESH_SCHEMA = 'factory.mesh.v1';
export const PHYSICAL_MESH_LIMITS = Object.freeze({ vertices: 20000, triangles: 40000, flattenTriangles: 20000 });
const finiteArray = value => (Array.isArray(value) || ArrayBuffer.isView(value)) && Array.from(value).every(Number.isFinite);
export const physicalEdgeId = (a, b) => `edge:${JSON.stringify([a, b].sort())}`;
export const meshPosition = (mesh, index) => mesh.positions.slice(index * 3, index * 3 + 3);

/** A physical mesh stores millimetres. UVs are intentionally never read as source2D. */
export function normalizePhysicalMesh(value) {
  if (!value || value.schema !== PHYSICAL_MESH_SCHEMA || value.unit !== 'mm') throw new TypeError('A physical mesh requires factory.mesh.v1 and millimetres');
  if (!finiteArray(value.positions) || value.positions.length < 9 || value.positions.length % 3 || value.positions.length / 3 > PHYSICAL_MESH_LIMITS.vertices) throw new RangeError('Invalid mesh vertices or vertex budget');
  const count = value.positions.length / 3;
  if (!finiteArray(value.triangles) || !value.triangles.length || value.triangles.length % 3 || value.triangles.length / 3 > PHYSICAL_MESH_LIMITS.triangles || Array.from(value.triangles).some(i => !Number.isSafeInteger(i) || i < 0 || i >= count)) throw new RangeError('Invalid triangle indices or triangle budget');
  if (typeof value.sourceRevision !== 'string' || !value.sourceRevision || value.sourceRevision.length > 256) throw new TypeError('Physical meshes require an explicit source revision');
  const mesh = { ...structuredClone(value), positions: Array.from(value.positions), triangles: Array.from(value.triangles) };
  for (const [key, size, prefix] of [['vertexIds', count, 'vertex'], ['faceIds', mesh.triangles.length / 3, 'face']]) {
    mesh[key] ??= Array.from({ length: size }, (_, i) => `${prefix}-${i + 1}`);
    if (!Array.isArray(mesh[key]) || mesh[key].length !== size || mesh[key].some(id => typeof id !== 'string' || !id || id.length > 512) || new Set(mesh[key]).size !== size) throw new TypeError(`Mesh ${key} must be unique stable references`);
  }
  if (mesh.source2D != null) {
    const source = mesh.source2D;
    if (!Array.isArray(source.vertexIds) || source.vertexIds.length !== count || new Set(source.vertexIds).size !== count || !source.vertexIds.every(id => mesh.vertexIds.includes(id)) || !finiteArray(source.positions) || source.positions.length !== count * 2 || typeof source.sourceRevision !== 'string' || !source.sourceRevision) throw new TypeError('Source 2D needs a complete explicit physical vertex correspondence and revision');
    source.positions = Array.from(source.positions);
  }
  if (mesh.uvs != null) {
    if (!finiteArray(mesh.uvs) || mesh.uvs.length !== count * 2) throw new TypeError('Mesh material coordinates must correspond to every vertex');
    mesh.uvs = Array.from(mesh.uvs);
  }
  if (mesh.materialCoordinatesMm != null) {
    if (!finiteArray(mesh.materialCoordinatesMm) || mesh.materialCoordinatesMm.length !== count * 2) throw new TypeError('Physical material coordinates must correspond to every vertex');
    mesh.materialCoordinatesMm = Array.from(mesh.materialCoordinatesMm);
  }
  if (mesh.materialAppearance != null) {
    if (!mesh.materialCoordinatesMm && !mesh.source2D) throw new TypeError('Woven appearance needs physical millimetre material coordinates');
    mesh.materialAppearance = normalizeWovenAppearance(mesh.materialAppearance, { parseColor(value, path) {
      if (typeof value !== 'string' || value.length > 128) throw new TypeError(`${path} must be a CSS color`);
      const parsed = cssColorParseReport(value); if (!parsed.valid) throw new TypeError(`${path} is not a valid CSS color`); return value;
    } });
  }
  return mesh;
}

/** Split selected faces once without moving their edges or physical source chart. */
export function refinePhysicalMeshFaces(value, { faceIds, sourceRevision = value.sourceRevision } = {}) {
  const mesh = normalizePhysicalMesh(value);
  if (!Array.isArray(faceIds) || new Set(faceIds).size !== faceIds.length || faceIds.some(id => !mesh.faceIds.includes(id))) throw new TypeError('Refinement requires distinct existing face identities');
  if (mesh.vertexIds.length + faceIds.length > PHYSICAL_MESH_LIMITS.vertices || mesh.faceIds.length + 2 * faceIds.length > PHYSICAL_MESH_LIMITS.triangles) throw new RangeError('Physical mesh refinement exceeds its vertex or triangle budget');
  if (typeof sourceRevision !== 'string' || !sourceRevision) throw new TypeError('Refined meshes require their source revision');
  const selected = new Set(faceIds), triangles = [], identities = [], sourceIndices = mesh.source2D ? new Map(mesh.source2D.vertexIds.map((id, index) => [id, index])) : null;
  for (let face = 0; face < mesh.faceIds.length; face++) {
    const id = mesh.faceIds[face], indices = mesh.triangles.slice(face * 3, face * 3 + 3);
    if (!selected.has(id)) { triangles.push(...indices); identities.push(id); continue; }
    const center = mesh.vertexIds.length, centerId = `${id}:center`;
    mesh.positions.push(...[0, 1, 2].map(axis => indices.reduce((sum, index) => sum + mesh.positions[index * 3 + axis], 0) / 3));
    for (const field of ['uvs', 'materialCoordinatesMm']) if (mesh[field]) {
      mesh[field].push(...[0, 1].map(axis => indices.reduce((sum, index) => sum + mesh[field][index * 2 + axis], 0) / 3));
    }
    if (mesh.source2D) {
      mesh.source2D.positions.push(...[0, 1].map(axis => indices.reduce((sum, index) => sum + mesh.source2D.positions[sourceIndices.get(mesh.vertexIds[index]) * 2 + axis], 0) / 3));
      mesh.source2D.vertexIds.push(centerId);
    }
    mesh.vertexIds.push(centerId);
    for (let side = 0; side < 3; side++) { triangles.push(indices[side], indices[(side + 1) % 3], center); identities.push(`${id}:${side}`); }
  }
  mesh.triangles = triangles; mesh.faceIds = identities; mesh.sourceRevision = sourceRevision;
  const result = normalizePhysicalMesh(mesh), topology = analyzePanelTopology(result);
  if (!topology.valid) throw new TypeError(`Physical refinement is invalid: ${topology.issues.map(issue => issue.message).join('; ')}`);
  console.debug('[Factory][mesh-refinement]', { selectedFaces: faceIds.length, vertices: result.vertexIds.length, triangles: result.faceIds.length });
  return result;
}

/** Bisect only selected interior edges, preserving the outside sewing boundary. */
export function refinePhysicalMeshEdges(value, { edgeIds, sourceRevision = value.sourceRevision } = {}) {
  const mesh = normalizePhysicalMesh(value), topology = analyzePanelTopology(mesh);
  if (!topology.valid) throw new TypeError('Interior refinement requires a valid physical mesh');
  const edges = new Map(topology.edges.map(edge => [edge.id, edge]));
  if (!Array.isArray(edgeIds) || new Set(edgeIds).size !== edgeIds.length || edgeIds.some(id => edges.get(id)?.faces.length !== 2)) throw new TypeError('Choose distinct existing interior edges; sewing boundaries cannot be subdivided here');
  if (mesh.vertexIds.length + edgeIds.length > PHYSICAL_MESH_LIMITS.vertices || mesh.faceIds.length + 2 * edgeIds.length > PHYSICAL_MESH_LIMITS.triangles) throw new RangeError('Interior refinement exceeds the physical mesh budget');
  const sourceIndices = mesh.source2D ? new Map(mesh.source2D.vertexIds.map((id, index) => [id, index])) : null;
  for (const edgeId of [...edgeIds].sort()) {
    const edge = edges.get(edgeId), index = mesh.vertexIds.length, id = `${mesh.id || 'mesh'}:edge-midpoint:${index}`, sourceIds = [mesh.vertexIds[edge.a], mesh.vertexIds[edge.b]];
    mesh.positions.push(...[0, 1, 2].map(axis => (mesh.positions[edge.a * 3 + axis] + mesh.positions[edge.b * 3 + axis]) / 2));
    for (const field of ['uvs', 'materialCoordinatesMm']) if (mesh[field]) {
      mesh[field].push(...[0, 1].map(axis => (mesh[field][edge.a * 2 + axis] + mesh[field][edge.b * 2 + axis]) / 2));
    }
    if (mesh.source2D) { mesh.source2D.positions.push(...[0, 1].map(axis => sourceIds.reduce((sum, key) => sum + mesh.source2D.positions[sourceIndices.get(key) * 2 + axis], 0) / 2)); mesh.source2D.vertexIds.push(id); }
    mesh.vertexIds.push(id); const triangles = [], faces = []; let split = 0;
    for (let f = 0; f < mesh.faceIds.length; f++) {
      const face = mesh.triangles.slice(f * 3, f * 3 + 3), side = face.findIndex((a, k) => (a === edge.a && face[(k + 1) % 3] === edge.b) || (a === edge.b && face[(k + 1) % 3] === edge.a));
      if (side < 0) { triangles.push(...face); faces.push(mesh.faceIds[f]); continue; }
      const [a, b, c] = [face[side], face[(side + 1) % 3], face[(side + 2) % 3]];
      triangles.push(a, index, c, index, b, c); faces.push(`${mesh.faceIds[f]}:bisect0`, `${mesh.faceIds[f]}:bisect1`); split++;
    }
    if (split !== 2) throw new TypeError('An interior refinement edge lost its two adjacent faces');
    mesh.triangles = triangles; mesh.faceIds = faces;
    for (const path of mesh.constraints?.paths || []) for (const mapped of path.edges) for (let i = mapped.vertexIds.length - 1; i > 0; i--) {
      if (physicalEdgeId(mapped.vertexIds[i - 1], mapped.vertexIds[i]) !== edgeId) continue;
      mapped.vertexIds.splice(i, 0, id); mapped.fractions.splice(i, 0, (mapped.fractions[i - 1] + mapped.fractions[i]) / 2);
    }
  }
  mesh.sourceRevision = sourceRevision; const result = normalizePhysicalMesh(mesh), checked = analyzePanelTopology(result);
  if (!checked.valid) throw new TypeError(`Interior refinement is invalid: ${checked.issues.map(issue => issue.message).join('; ')}`);
  console.debug('[Factory][mesh-edge-refinement]', { selectedEdges: edgeIds.length, vertices: result.vertexIds.length, triangles: result.faceIds.length });
  return result;
}

/** Strong preflight before the existing half-edge traversals; bow-tie fans are not manifold. */
export function analyzePanelTopology(value) {
  let mesh;
  try { mesh = normalizePhysicalMesh(value); } catch (error) { return { valid: false, issues: [{ code: 'invalid-mesh', message: error.message }] }; }
  const issues = [], edges = new Map(), faces = new Set(), count = mesh.vertexIds.length;
  const indices = new Uint32Array(mesh.triangles), incident = buildVertexFaceAdjacency(indices, count);
  for (let f = 0; f < mesh.faceIds.length; f++) {
    const tri = mesh.triangles.slice(f * 3, f * 3 + 3), key = [...tri].sort((a, b) => a - b).join(',');
    if (faces.has(key)) issues.push({ code: 'duplicate-face', faceId: mesh.faceIds[f], message: 'Duplicate triangle' });
    faces.add(key);
    const [a, b, c] = tri.map(i => meshPosition(mesh, i)), ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]);
    if (Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) <= 1e-10) issues.push({ code: 'degenerate-face', faceId: mesh.faceIds[f], message: 'Triangle has zero physical area' });
    for (let k = 0; k < 3; k++) {
      const from = tri[k], to = tri[(k + 1) % 3], id = physicalEdgeId(mesh.vertexIds[from], mesh.vertexIds[to]);
      if (!edges.has(id)) edges.set(id, { id, a: Math.min(from, to), b: Math.max(from, to), faces: [], directions: [] });
      const edge = edges.get(id); edge.faces.push(f); edge.directions.push(from < to ? 1 : -1);
    }
  }
  const faceNeighbors = Array.from({ length: mesh.faceIds.length }, () => []);
  for (const edge of edges.values()) {
    if (edge.faces.length > 2) issues.push({ code: 'nonmanifold-edge', edgeId: edge.id, message: 'More than two faces meet at an edge' });
    if (edge.faces.length === 2) {
      if (edge.directions[0] === edge.directions[1]) issues.push({ code: 'inconsistent-winding', edgeId: edge.id, message: 'Adjacent faces have inconsistent orientation' });
      const [a, b] = edge.faces; faceNeighbors[a].push(b); faceNeighbors[b].push(a);
    }
    const a = meshPosition(mesh, edge.a), b = meshPosition(mesh, edge.b);
    edge.lengthMm = Math.hypot(...a.map((v, i) => b[i] - v));
  }
  for (let vertex = 0; vertex < count; vertex++) {
    const around = new Set(incident[vertex]);
    if (!around.size) { issues.push({ code: 'isolated-vertex', vertexId: mesh.vertexIds[vertex], message: 'Vertex is not part of a face' }); continue; }
    const queue = [incident[vertex][0]], seen = new Set(queue);
    for (let cursor = 0; cursor < queue.length; cursor++) for (const next of faceNeighbors[queue[cursor]]) if (around.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
    if (seen.size !== around.size) issues.push({ code: 'nonmanifold-vertex', vertexId: mesh.vertexIds[vertex], message: 'Disconnected triangle fans meet at one vertex' });
  }
  if (issues.length) return { valid: false, mesh, edges: [...edges.values()], issues };
  const halfEdges = new HalfEdgeMesh(new Float64Array(mesh.positions), indices), boundaries = halfEdges.boundaryLoops();
  const components = [], visited = new Set();
  for (let f = 0; f < mesh.faceIds.length; f++) if (!visited.has(f)) {
    const queue = [f]; visited.add(f);
    for (let cursor = 0; cursor < queue.length; cursor++) for (const next of faceNeighbors[queue[cursor]]) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    components.push(queue);
  }
  return { valid: true, mesh, edges: [...edges.values()], boundaries, components, faceNeighbors,
    adjacency: buildVertexAdjacency(indices, count), incident, euler: halfEdges.eulerCharacteristic(),
    disk: components.length === 1 && boundaries.length === 1 && halfEdges.eulerCharacteristic() === 1, issues: [] };
}

/** Freeform edits create a revision while leaving source2D and the original mesh intact. */
export function editPhysicalMeshVertices(value, { vertexIds, deltaMm, expectedRevision, nextRevision }) {
  const mesh = normalizePhysicalMesh(value);
  if (mesh.sourceRevision !== expectedRevision) throw new Error('Mesh source revision changed');
  if (typeof nextRevision !== 'string' || !nextRevision || nextRevision === expectedRevision) throw new TypeError('A mesh edit requires a new revision');
  if (!Array.isArray(vertexIds) || !vertexIds.length || new Set(vertexIds).size !== vertexIds.length || vertexIds.some(id => !mesh.vertexIds.includes(id)) || !finiteArray(deltaMm) || deltaMm.length !== 3) throw new TypeError('Select retained vertices and a finite three-axis displacement');
  for (const id of vertexIds) { const index = mesh.vertexIds.indexOf(id); for (let axis = 0; axis < 3; axis++) mesh.positions[index * 3 + axis] += deltaMm[axis]; }
  mesh.sourceRevision = nextRevision;
  mesh.derivation = { status: 'needs-derivation', previousRevision: expectedRevision };
  const topology = analyzePanelTopology(mesh); if (!topology.valid) throw new TypeError(topology.issues.map(issue => issue.message).join('; '));
  return mesh;
}

/** Explicit cuts duplicate vertex fans along selected edges. Uncut concepts are never mutated. */
export function cutPhysicalMesh(value, { edgeIds, nextRevision }) {
  const topology = analyzePanelTopology(value); if (!topology.valid) throw new TypeError(topology.issues.map(issue => issue.message).join('; '));
  const { mesh, edges, incident } = topology;
  if (!Array.isArray(edgeIds) || !edgeIds.length || new Set(edgeIds).size !== edgeIds.length || edgeIds.some(id => !edges.some(edge => edge.id === id)) || typeof nextRevision !== 'string' || !nextRevision || nextRevision === mesh.sourceRevision) throw new TypeError('Cuts require existing edge IDs and a new revision');
  const cuts = new Set(edgeIds), adjacency = Array.from({ length: mesh.faceIds.length }, () => []);
  for (const edge of edges) if (edge.faces.length === 2 && !cuts.has(edge.id)) { const [a, b] = edge.faces; adjacency[a].push(b); adjacency[b].push(a); }
  const result = { ...mesh, positions: [], vertexIds: [], triangles: [...mesh.triangles], sourceRevision: nextRevision }, correspondence = [];
  for (const field of ['uvs', 'materialCoordinatesMm']) if (mesh[field]) result[field] = [];
  const sourceMap = mesh.source2D ? new Map(mesh.source2D.vertexIds.map((id, i) => [id, mesh.source2D.positions.slice(i * 2, i * 2 + 2)])) : null;
  if (sourceMap) result.source2D = { ...mesh.source2D, vertexIds: [], positions: [] };
  for (let v = 0; v < mesh.vertexIds.length; v++) {
    const left = new Set(incident[v]), fans = [];
    while (left.size) {
      const queue = [left.values().next().value]; left.delete(queue[0]);
      for (let cursor = 0; cursor < queue.length; cursor++) for (const f of adjacency[queue[cursor]]) if (left.has(f)) { left.delete(f); queue.push(f); }
      fans.push(queue);
    }
    fans.forEach((fan, part) => {
      const id = fans.length === 1 ? mesh.vertexIds[v] : `${mesh.vertexIds[v]}@cut:${JSON.stringify([nextRevision, part])}`, index = result.vertexIds.length;
      result.vertexIds.push(id); result.positions.push(...meshPosition(mesh, v)); correspondence.push({ vertexId: id, sourceVertexId: mesh.vertexIds[v] });
      for (const field of ['uvs', 'materialCoordinatesMm']) if (mesh[field]) result[field].push(...mesh[field].slice(v * 2, v * 2 + 2));
      if (sourceMap) { result.source2D.vertexIds.push(id); result.source2D.positions.push(...sourceMap.get(mesh.vertexIds[v])); }
      for (const f of fan) for (let k = 0; k < 3; k++) if (mesh.triangles[f * 3 + k] === v) result.triangles[f * 3 + k] = index;
    });
  }
  result.cuts = { sourceRevision: mesh.sourceRevision, edgeIds: [...edgeIds], correspondence };
  const checked = analyzePanelTopology(result); if (!checked.valid) throw new TypeError(checked.issues.map(issue => issue.message).join('; '));
  return { mesh: result, components: checked.components, correspondence };
}
