// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { clothError } from './materials.js';

/** Add valid paths through a triangle to its explicitly sewn boundary.
 * Portal distances use the original cut chart. They only shorten a graph
 * overestimate; they cannot cross empty space or change the shell radius.
 */
export function addSeamContactPortals(graph, { rest, vertexDof, triangles, seamEdges, maximumDistance, check }) {
  const count = rest.length, validId = id => Number.isSafeInteger(id) && id >= 0 && id < count, key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  if (!Array.isArray(triangles) || triangles.length > 40000 || !Array.isArray(seamEdges) || seamEdges.length > 120000) throw clothError('INVALID_TOPOLOGY', 'Seam portals require bounded physical triangles and explicit sewn edges');
  const allowed = new Set();
  for (const edge of seamEdges) { if (!Array.isArray(edge) || edge.length !== 2 || edge.some(id => !validId(id)) || edge[0] === edge[1]) throw clothError('INVALID_TOPOLOGY', 'A sewn portal edge is invalid'); allowed.add(key(...edge)); }
  const incident = new Map();
  for (let f = 0; f < triangles.length; f++) {
    if (f % 256 === 0) check(); const face = triangles[f];
    if (!Array.isArray(face) || face.length !== 3 || new Set(face).size !== 3 || face.some(id => !validId(id))) throw clothError('INVALID_TOPOLOGY', 'A seam portal triangle is invalid');
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], c = face[(i + 2) % 3], id = key(a, b);
      if (!allowed.has(id)) continue; if (!incident.has(id)) incident.set(id, []); incident.get(id).push({ a, b, c });
    }
  }
  const groups = new Map();
  if (triangles.length && [...allowed].some(id => !incident.has(id))) throw clothError('INVALID_TOPOLOGY', 'An explicitly sewn edge is absent from the supplied triangles');
  for (const [id, values] of incident) {
    if (values.length !== 1) throw clothError('INVALID_TOPOLOGY', 'Seam portals must lie on an actual cut boundary');
    const record = values[0]; let { a, b } = record;
    const ra = vertexDof[a], rb = vertexDof[b]; if (ra === rb) continue;
    if (ra > rb) [a, b] = [b, a];
    const group = key(ra, rb); if (!groups.has(group)) groups.set(group, []); groups.get(group).push({ ...record, a, b });
  }
  const connect = (a, b, length, seam = false) => { graph[a].push({ id: b, length, seam }); graph[b].push({ id: a, length, seam }); };
  let nodes = 0;
  for (const records of groups.values()) {
    check(); if (records.length < 2) continue;
    for (const record of records) {
      const [a, b, c] = [record.a, record.b, record.c].map(id => rest[id]), dx = b[0] - a[0], dy = b[1] - a[1], squared = dx * dx + dy * dy;
      if (!(squared > 0)) throw clothError('INVALID_TOPOLOGY', 'A sewn portal edge has no rest length');
      record.length = Math.sqrt(squared); record.t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / squared));
      record.distance = Math.hypot(c[0] - a[0] - record.t * dx, c[1] - a[1] - record.t * dy);
    }
    const fractions = [0, 1, ...records.filter(record => record.distance <= maximumDistance).map(record => record.t)].sort((a, b) => a - b).filter((value, index, all) => !index || value - all[index - 1] > 1e-12);
    if (fractions.length === 2) continue;
    if (nodes + records.length * (fractions.length - 2) > 120000) throw clothError('CONTACT_BUDGET_EXHAUSTED', 'Physical seam portals exceeded their bounded node count');
    const portals = records.map(record => fractions.map((fraction, index) => {
      if (index === 0) return record.a; if (index === fractions.length - 1) return record.b;
      const id = graph.length; graph.push([]); nodes++; return id;
    }));
    records.forEach((record, index) => {
      const ids = portals[index];
      for (let i = 1; i < ids.length; i++) connect(ids[i - 1], ids[i], (fractions[i] - fractions[i - 1]) * record.length);
      const at = fractions.findIndex(fraction => Math.abs(fraction - record.t) <= 1e-12);
      if (at >= 0 && record.distance <= maximumDistance) connect(record.c, ids[at], record.distance);
    });
    for (let i = 1; i < fractions.length - 1; i++) for (let part = 1; part < portals.length; part++) connect(portals[0][i], portals[part][i], 0, true);
  }
  check(); return nodes;
}
