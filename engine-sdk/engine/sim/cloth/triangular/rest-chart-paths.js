// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { UnionFind } from '../../../core/math/UnionFind.js';
import { orientation2DReport } from '../../../core/math/RobustNumericMath.js';
import { triangleClosestPointWithWeights } from '../../../core/math/MathGeometry.js';
import { segmentClosestPointToSegment } from '../../../core/math/MathLine3.js';
import { clothError } from './materials.js';

/** Short local paths must be covered by connected physical rest triangles.
 * In particular a short line across a hole or cutting notch is not fabric.
 */
function createRestChartGeometry({ rest, edges, triangles }) {
  const count = rest.length, components = new UnionFind(count), incident = Array.from({ length: count }, () => []), edgeFaces = new Map(), adjacent = triangles.map(() => []);
  const key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`, orient = (a, b, c) => orientation2DReport(a, b, c).determinant;
  for (const [a, b] of edges) components.union(a, b);
  const signs = triangles.map((face, f) => {
    const area = orient(...face.map(id => rest[id])); if (Math.abs(area) < 2e-12) throw clothError('INVALID_TOPOLOGY', 'Rest chart paths require triangles with physical area');
    face.forEach(id => incident[id].push(f));
    for (let i = 0; i < 3; i++) { const id = key(face[i], face[(i + 1) % 3]); if (!edgeFaces.has(id)) edgeFaces.set(id, []); edgeFaces.get(id).push(f); }
    return Math.sign(area);
  });
  for (const faces of edgeFaces.values()) if (faces.length === 2) { adjacent[faces[0]].push(faces[1]); adjacent[faces[1]].push(faces[0]); }
  const inside = (p, q, startFaces, visit) => {
    const clipped = new Map();
    const interval = index => {
      if (clipped.has(index)) return clipped.get(index); visit(); let low = 0, high = 1; const face = triangles[index], sign = signs[index];
      for (let side = 0; side < 3; side++) {
        const a = rest[face[side]], b = rest[face[(side + 1) % 3]], start = sign * orient(a, b, p), end = sign * orient(a, b, q);
        if (start < 0 && end < 0) { clipped.set(index, null); return null; }
        if (start < 0) low = Math.max(low, start / (start - end));
        if (end < 0) high = Math.min(high, start / (start - end));
      }
      const result = low <= high + 1e-12 ? [low, high] : null; clipped.set(index, result); return result;
    };
    const queue = [], seen = new Set();
    for (const index of startFaces) { const range = interval(index); if (range && range[0] <= 1e-12) { queue.push({ index, range }); seen.add(index); } }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]; if (current.range[1] >= 1 - 1e-12) return true;
      for (const index of adjacent[current.index]) { if (seen.has(index)) continue; const range = interval(index); if (range && range[0] <= current.range[1] + 1e-12 && range[1] >= current.range[0] - 1e-12) { seen.add(index); queue.push({ index, range }); } }
    }
    return false;
  };
  return { count, components, incident, inside };
}

export function addIntrinsicRestChartPaths(graph, { rest, edges, triangles, thicknesses, visit, check }) {
  if (!triangles.length) return 0;
  const { count, components, incident, inside } = createRestChartGeometry({ rest, edges, triangles });
  const cell = Math.max(...thicknesses); if (!cell) return 0;
  const bins = new Map(), binKey = (root, x, y) => `${root}:${x}:${y}`;
  for (let id = 0; id < count; id++) { const [x, y] = rest[id].map(value => Math.floor(value / cell)), name = binKey(components.find(id), x, y); if (!bins.has(name)) bins.set(name, []); bins.get(name).push(id); }
  let added = 0;
  for (let source = 0; source < count; source++) {
    check(); const root = components.find(source), [x, y] = rest[source].map(value => Math.floor(value / cell)), direct = new Set(graph[source].map(edge => edge.id));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const target of bins.get(binKey(root, x + dx, y + dy)) || []) {
      if (target <= source || direct.has(target)) continue; visit();
      const length = Math.hypot(rest[source][0] - rest[target][0], rest[source][1] - rest[target][1]);
      if (length > (thicknesses[source] + thicknesses[target]) / 2 || !inside(rest[source], rest[target], incident[source], visit)) continue;
      graph[source].push({ id: target, length, seam: false }); graph[target].push({ id: source, length, seam: false }); added++;
    }
  }
  check(); return added;
}

/** Vertex neighborhoods alone miss a nearby interior of a long triangle.
 * This model-owned query uses actual rest features and the same covered paths.
 */
export function createRestChartContactSupport({ rest, edges, triangles }, { maxChecks = 10000, cacheSize = 20000 } = {}) {
  if (!Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 10000 || !Number.isSafeInteger(cacheSize) || cacheSize < 0 || cacheSize > 20000) throw clothError('INVALID_INPUT', 'Physical contact path queries require bounded work and caching');
  const { count, components, incident, inside } = createRestChartGeometry({ rest, edges, triangles }), points = rest.map(point => [...point, 0]), cache = new Map();
  return (left, right, radius) => {
    if (![left, right].every(ids => Array.isArray(ids) && ids.every(id => Number.isSafeInteger(id) && id >= 0 && id < count)) || !Number.isFinite(radius) || radius < 0) throw clothError('INVALID_TOPOLOGY', 'A contact path refers to invalid rest features');
    if (left.length === 3 && right.length === 1) [left, right] = [right, left];
    if (!((left.length === 1 && right.length === 3) || (left.length === 2 && right.length === 2))) throw clothError('INVALID_TOPOLOGY', 'Physical contact support needs a vertex/triangle or two edges');
    if (components.find(left[0]) !== components.find(right[0])) return false;
    const key = `${left.join(',')}|${right.join(',')}|${radius}`; if (cache.has(key)) return cache.get(key);
    let result = false;
    if (components.find(left[0]) === components.find(right[0])) {
      let a, b, distance;
      if (left.length === 1) { a = points[left[0]]; b = triangleClosestPointWithWeights(a, ...right.map(id => points[id])).point; distance = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      else { const closest = segmentClosestPointToSegment({ a: points[left[0]], b: points[left[1]] }, { a: points[right[0]], b: points[right[1]] }); a = closest.point1; b = closest.point2; distance = closest.distance; }
      if (distance <= radius) {
        let checks = 0; const visit = () => { if (++checks > maxChecks) throw clothError('CONTACT_BUDGET_EXHAUSTED', 'A physical contact path exceeded its triangle traversal budget'); };
        result = inside(a.slice(0, 2), b.slice(0, 2), new Set(left.flatMap(id => incident[id])), visit);
      }
    }
    if (cacheSize) { if (cache.size >= cacheSize) cache.delete(cache.keys().next().value); cache.set(key, result); }
    return result;
  };
}
