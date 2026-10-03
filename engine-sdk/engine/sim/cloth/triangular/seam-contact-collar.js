// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { clothError } from './materials.js';
import { addSeamContactPortals } from './seam-contact-portals.js';
import { addIntrinsicRestChartPaths } from './rest-chart-paths.js';

/** Local contact support follows the unstrained material and exact sewn seams.
 * No world coordinates are accepted: folded distant cloth and separate sheets
 * cannot become neighbors merely because their rendered surfaces touch.
 * All work is bounded and the input model is never mutated on failure.
 */
export function createSeamContactCollar({ rest, edges, vertexDof, thicknesses, triangles = [], seamEdges = [] }, { maxVisits = 2000000, maxPairs = 1000000, check = () => {} } = {}) {
  check(); const count = rest?.length;
  if (!Number.isSafeInteger(count) || count < 3 || count > 20000 || vertexDof?.length !== count || thicknesses?.length !== count || !Array.isArray(edges) || edges.length > 120000 || !Number.isSafeInteger(maxVisits) || maxVisits < 0 || maxVisits > 2000000 || !Number.isSafeInteger(maxPairs) || maxPairs < 0 || maxPairs > 1000000) throw clothError('INVALID_TOPOLOGY', 'Seam contact requires a bounded complete physical rest graph');
  const validId = id => Number.isSafeInteger(id) && id >= 0 && id < count;
  if (rest.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) || vertexDof.some(id => !validId(id) || vertexDof[id] !== id) || thicknesses.some(value => !Number.isFinite(value) || value < 0)) throw clothError('INVALID_TOPOLOGY', 'Invalid physical rest coordinates, exact seam classes or shell thickness');
  const groups = new Map(), graph = Array.from({ length: count }, () => []);
  for (let id = 0; id < count; id++) { const root = vertexDof[id]; if (!groups.has(root)) groups.set(root, []); groups.get(root).push(id); }
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2 || edge.some(id => !validId(id)) || edge[0] === edge[1]) throw clothError('INVALID_TOPOLOGY', 'A seam contact edge refers to invalid physical vertices');
    const [a, b] = edge, length = Math.hypot(rest[a][0] - rest[b][0], rest[a][1] - rest[b][1]);
    if (!(length > 0)) throw clothError('INVALID_TOPOLOGY', 'A seam contact edge has no physical rest length');
    graph[a].push({ id: b, length, seam: false }); graph[b].push({ id: a, length, seam: false });
  }
  const sewn = [];
  for (const ids of groups.values()) if (ids.length > 1) {
    sewn.push(...ids);
    for (const id of ids.slice(1)) { graph[ids[0]].push({ id, length: 0, seam: true }); graph[id].push({ id: ids[0], length: 0, seam: true }); }
  }
  const pairs = [], maximumThickness = Math.max(...thicknesses); let visited = 0;
  const portalNodes = addSeamContactPortals(graph, { rest, vertexDof, triangles, seamEdges, maximumDistance: maximumThickness, check });
  const visit = () => { if (++visited > maxVisits) throw clothError('CONTACT_BUDGET_EXHAUSTED', 'Physical seam contact neighborhoods exceeded their bounded graph work'); if (visited % 256 === 0) check(); };
  const chartPaths = addIntrinsicRestChartPaths(graph, { rest, edges, triangles, thicknesses, visit, check });
  // Shortest-path relaxation is bounded and uses nonnegative physical lengths.
  // Independent charts have no connection; only exact seams bridge cut pieces.
  for (let source = 0; source < count; source++) {
    check(); const limit = (thicknesses[source] + maximumThickness) / 2, distances = new Map([[source, 0]]), pending = [{ id: source, distance: 0 }];
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const current = pending[cursor];
      if (current.distance !== distances.get(current.id)) continue;
      for (const edge of graph[current.id]) {
        visit(); const distance = current.distance + edge.length;
        if (distance <= limit && distance < (distances.get(edge.id) ?? Infinity)) { distances.set(edge.id, distance); pending.push({ id: edge.id, distance }); }
      }
    }
    for (const [target, distance] of distances) {
      if (target <= source || target >= count || distance > (thicknesses[source] + thicknesses[target]) / 2) continue;
      if (pairs.length >= maxPairs) throw clothError('CONTACT_BUDGET_EXHAUSTED', 'Physical seam contact neighborhoods exceeded their bounded pair count');
      pairs.push([source, target]);
    }
  }
  check(); console.debug('[TriangularCloth][seam-contact-collar]', { vertices: count, exactSeamVertices: sewn.length, portalNodes, chartPaths, pairs: pairs.length, visited });
  return { pairs, metric: portalNodes || chartPaths ? 'rest-triangle-shortest-path' : 'rest-edge-shortest-path', radiusPolicy: 'sum-shell-radii', scope: 'intrinsic-material-neighborhood', portalNodes, chartPaths, visited };
}
