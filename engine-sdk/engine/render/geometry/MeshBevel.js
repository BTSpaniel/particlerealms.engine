// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MeshBevel.js — chamfer and fillet arbitrary EDGES of a solid.
 *
 * Profile2D treats corners before extrusion, which cannot touch the edges that
 * only exist once a solid is built (the ends of a stud, the rim of a drilled
 * hole, the arris left by a boolean). This does the real thing: pick edges on a
 * finished solid and roll them back.
 *
 * Method: each bevel is a set of LOCAL EXACT PLANE CUTS. A chamfer is one cut; a
 * fillet of radius r with n segments is n cuts, each on a plane tangent to the
 * rolling-ball cylinder, so the result converges on the true fillet surface from
 * outside while every other face stays bit-exact. Cuts are performed by
 * subtracting a bounded box through the tested BSP path in PolyhedralCsg, so no
 * new geometric kernel is involved and flat faces stay flat.
 *
 * Honest scope:
 *   - Edges are detected by dihedral angle on coplanar-merged facets, so a
 *     tessellated box has 12 edges, not 36 triangle edges.
 *   - Only CONVEX edges are beveled. Concave edges would need material added
 *     rather than removed; they are reported, not silently skipped.
 *   - The cutter is localised to the edge neighbourhood, so the bevel amount
 *     must be small relative to nearby features — the same assumption every CAD
 *     fillet makes. Oversized requests are clamped per edge.
 *   - This is a polygonal fillet, not a NURBS rolling-ball surface. It is exact
 *     per cut and refines with `segments`; it does not pretend to be G1.
 */

import { polyhedralSubtract } from './PolyhedralCsg.js';

const EPSILON = 1e-9;
const DEG = Math.PI / 180;

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length < EPSILON ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

function scale3(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function add3(...vectors) {
  return vectors.reduce((sum, v) => [sum[0] + v[0], sum[1] + v[1], sum[2] + v[2]], [0, 0, 0]);
}

/** Weld coincident vertices onto a quantised lattice so adjacency is findable. */
function weld(mesh, tolerance = 1e-7) {
  const map = new Map();
  const positions = [];
  const remap = [];
  const quantum = Math.max(tolerance, EPSILON);
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index];
    const y = mesh.positions[index + 1];
    const z = mesh.positions[index + 2];
    const key = `${Math.round(x / quantum)},${Math.round(y / quantum)},${Math.round(z / quantum)}`;
    let slot = map.get(key);
    if (slot === undefined) {
      slot = positions.length;
      positions.push([x, y, z]);
      map.set(key, slot);
    }
    remap.push(slot);
  }
  const triangles = [];
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = remap[mesh.indices[index]];
    const b = remap[mesh.indices[index + 1]];
    const c = remap[mesh.indices[index + 2]];
    if (a === b || b === c || a === c) continue;
    triangles.push([a, b, c]);
  }
  return { positions, triangles };
}

/**
 * Count edges used an odd number of times after welding.
 *
 * NOTE: this is a T-JUNCTION count, not a hole count. BSP output is a polygon
 * soup — each output polygon is fan-triangulated on its own, so a neighbouring
 * polygon's split vertex frequently lands part-way along an edge. The surface is
 * still geometrically closed (its area-weighted normals sum to zero), which is
 * the metric to trust for watertightness. T-junctions are harmless for rendering
 * because the geometry coincides exactly, but they matter to consumers that need
 * true edge adjacency, so they are reported rather than hidden.
 */
export function countTJunctionEdges(mesh, tolerance = 1e-7) {
  const welded = weld(mesh, tolerance);
  const counts = new Map();
  for (const triangle of welded.triangles) {
    for (let corner = 0; corner < 3; corner++) {
      const a = triangle[corner];
      const b = triangle[(corner + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let boundary = 0;
  for (const count of counts.values()) if (count % 2 !== 0) boundary += 1;
  return boundary;
}

function trianglePlane(positions, triangle) {
  const [a, b, c] = triangle.map(index => positions[index]);
  const normal = normalize3(cross3(subtract3(b, a), subtract3(c, a)));
  return { normal, w: dot3(normal, a) };
}

/**
 * Merge coplanar, edge-connected triangles into facets. Without this, edge
 * detection would fire on every interior tessellation diagonal.
 */
function buildFacets(positions, triangles, angleTolerance = 1e-6) {
  const planes = triangles.map(triangle => trianglePlane(positions, triangle));
  const edgeToTriangles = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  triangles.forEach((triangle, index) => {
    for (let corner = 0; corner < 3; corner++) {
      const key = edgeKey(triangle[corner], triangle[(corner + 1) % 3]);
      const bucket = edgeToTriangles.get(key) ?? [];
      bucket.push(index);
      edgeToTriangles.set(key, bucket);
    }
  });

  const facetOf = new Int32Array(triangles.length).fill(-1);
  const facets = [];
  for (let seed = 0; seed < triangles.length; seed++) {
    if (facetOf[seed] !== -1) continue;
    const facetIndex = facets.length;
    const members = [];
    const stack = [seed];
    facetOf[seed] = facetIndex;
    const plane = planes[seed];
    while (stack.length) {
      const current = stack.pop();
      members.push(current);
      const triangle = triangles[current];
      for (let corner = 0; corner < 3; corner++) {
        const key = edgeKey(triangle[corner], triangle[(corner + 1) % 3]);
        for (const neighbour of edgeToTriangles.get(key) ?? []) {
          if (facetOf[neighbour] !== -1) continue;
          const other = planes[neighbour];
          if (Math.abs(dot3(other.normal, plane.normal) - 1) > angleTolerance) continue;
          if (Math.abs(other.w - plane.w) > 1e-7) continue;
          facetOf[neighbour] = facetIndex;
          stack.push(neighbour);
        }
      }
    }
    const vertexIndices = new Set();
    for (const triangleIndex of members) for (const corner of triangles[triangleIndex]) vertexIndices.add(corner);
    facets.push({ plane, triangleIndices: members, vertexIndices });
  }

  // Facet boundary edges appear exactly once among the facet's own triangles.
  for (const facet of facets) {
    const counts = new Map();
    for (const triangleIndex of facet.triangleIndices) {
      const triangle = triangles[triangleIndex];
      for (let corner = 0; corner < 3; corner++) {
        const key = edgeKey(triangle[corner], triangle[(corner + 1) % 3]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    facet.boundaryEdgeKeys = new Set([...counts].filter(([, n]) => n === 1).map(([key]) => key));
  }
  return { facets, facetOf, edgeToTriangles };
}

/**
 * Collect beveline edges: undirected vertex pairs shared by exactly two facets
 * whose dihedral angle exceeds the threshold.
 */
function collectEdges(positions, triangles, facetData, minDihedralDegrees) {
  const { facets, facetOf } = facetData;
  const edges = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  triangles.forEach((triangle, index) => {
    for (let corner = 0; corner < 3; corner++) {
      const a = triangle[corner];
      const b = triangle[(corner + 1) % 3];
      const key = edgeKey(a, b);
      const facetIndex = facetOf[index];
      const entry = edges.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), facets: new Set() };
      entry.facets.add(facetIndex);
      edges.set(key, entry);
    }
  });

  const result = [];
  const threshold = Math.cos(minDihedralDegrees * DEG);
  for (const [key, entry] of edges) {
    if (entry.facets.size !== 2) continue;
    const [firstIndex, secondIndex] = [...entry.facets];
    // Only true facet boundaries; interior diagonals were merged away.
    if (!facets[firstIndex].boundaryEdgeKeys.has(key)) continue;
    const first = facets[firstIndex].plane;
    const second = facets[secondIndex].plane;
    const alignment = dot3(first.normal, second.normal);
    if (alignment > threshold) continue;
    const start = positions[entry.a];
    const end = positions[entry.b];
    const direction = normalize3(subtract3(end, start));
    if (direction[0] === 0 && direction[1] === 0 && direction[2] === 0) continue;
    const midpoint = scale3(add3(start, end), 0.5);
    // Convexity by half-space test: for a convex edge each facet lies wholly on
    // the interior side of the other's plane. Vertex winding order cannot be
    // used for this, since the undirected edge key fixes an arbitrary direction.
    const offEdge = (facet, excludeA, excludeB) => {
      for (const vertexIndex of facet.vertexIndices) {
        if (vertexIndex === excludeA || vertexIndex === excludeB) continue;
        return positions[vertexIndex];
      }
      return null;
    };
    const probeB = offEdge(facets[secondIndex], entry.a, entry.b);
    const probeA = offEdge(facets[firstIndex], entry.a, entry.b);
    const scale = Math.max(1e-7, Math.hypot(...subtract3(end, start)) * 1e-6);
    const convex = probeA != null && probeB != null
      && (dot3(first.normal, probeB) - first.w) < -scale
      && (dot3(second.normal, probeA) - second.w) < -scale;
    result.push({
      key,
      aIndex: entry.a,
      bIndex: entry.b,
      start,
      end,
      direction,
      midpoint,
      length: Math.hypot(...subtract3(end, start)),
      planeA: first,
      planeB: second,
      dihedralDegrees: Math.acos(Math.max(-1, Math.min(1, alignment))) / DEG,
      convex,
    });
  }
  result.sort((left, right) => left.key.localeCompare(right.key));
  return result;
}

/** Axis-aligned-in-its-own-frame cutter box, emitted as a triangle soup. */
function cutterBox(centre, axisU, axisV, axisW, halfU, halfV, halfW) {
  const corners = [];
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      for (const sw of [-1, 1]) {
        corners.push(add3(
          centre,
          scale3(axisU, su * halfU),
          scale3(axisV, sv * halfV),
          scale3(axisW, sw * halfW),
        ));
      }
    }
  }
  // Corner order is (u, v, w) with w fastest.
  const idx = (u, v, w) => (u * 4) + (v * 2) + w;
  const quads = [
    [idx(1, 0, 0), idx(1, 1, 0), idx(1, 1, 1), idx(1, 0, 1)],
    [idx(0, 0, 0), idx(0, 0, 1), idx(0, 1, 1), idx(0, 1, 0)],
    [idx(0, 1, 0), idx(0, 1, 1), idx(1, 1, 1), idx(1, 1, 0)],
    [idx(0, 0, 0), idx(1, 0, 0), idx(1, 0, 1), idx(0, 0, 1)],
    [idx(0, 0, 1), idx(1, 0, 1), idx(1, 1, 1), idx(0, 1, 1)],
    [idx(0, 0, 0), idx(0, 1, 0), idx(1, 1, 0), idx(1, 0, 0)],
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  for (const quad of quads) {
    const [p0, p1, p2] = [corners[quad[0]], corners[quad[1]], corners[quad[2]]];
    const normal = normalize3(cross3(subtract3(p1, p0), subtract3(p2, p0)));
    const base = positions.length / 3;
    for (const cornerIndex of quad) {
      const point = corners[cornerIndex];
      positions.push(point[0], point[1], point[2]);
      normals.push(normal[0], normal[1], normal[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices };
}

/**
 * Cut planes for one edge.
 *
 * `n1`/`n2` are the outward face normals. For a chamfer we emit the single plane
 * through the two setback points. For a fillet we emit `segments` planes tangent
 * to the cylinder of radius r whose axis is the rolling-ball centre line.
 */
function bevelCutPlanes(edge, amount, kind, segments) {
  const n1 = edge.planeA.normal;
  const n2 = edge.planeB.normal;
  const e = edge.direction;
  // In-face directions pointing away from the edge, perpendicular to it.
  const a1 = normalize3(cross3(n1, e));
  const a2 = normalize3(cross3(e, n2));
  // Orient both to point INTO their own face (away from the other face).
  const inward1 = dot3(a1, n2) < 0 ? a1 : scale3(a1, -1);
  const inward2 = dot3(a2, n1) < 0 ? a2 : scale3(a2, -1);
  const planes = [];
  if (kind === 'chamfer') {
    const p1 = add3(edge.midpoint, scale3(inward1, amount));
    const p2 = add3(edge.midpoint, scale3(inward2, amount));
    const normal = normalize3(add3(n1, n2));
    planes.push({ normal, point: scale3(add3(p1, p2), 0.5) });
    return planes;
  }
  // Rolling-ball centre: back off `amount` along each face's inward direction
  // from the edge, i.e. the point equidistant from both planes.
  const half = Math.acos(Math.max(-1, Math.min(1, dot3(n1, n2)))) / 2;
  const bisector = normalize3(add3(n1, n2));
  const centreDistance = amount / Math.max(Math.cos(half), 1e-6);
  const axisPoint = add3(edge.midpoint, scale3(bisector, -centreDistance));
  const steps = Math.max(1, Math.floor(segments));
  // Sweep the tangent normal from n1 to n2 across the exterior angle.
  for (let step = 0; step < steps; step++) {
    const t = (step + 0.5) / steps;
    const normal = normalize3(add3(scale3(n1, 1 - t), scale3(n2, t)));
    planes.push({ normal, point: add3(axisPoint, scale3(normal, amount)) });
  }
  return planes;
}

function meshBounds(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], mesh.positions[index + axis]);
      max[axis] = Math.max(max[axis], mesh.positions[index + axis]);
    }
  }
  return { min, max };
}

/**
 * Chamfer or fillet the edges of a solid.
 *
 * @param {{positions:number[],normals:number[],indices:number[]}} mesh
 * @param {object} [options]
 * @param {number} [options.amount] Chamfer setback, or fillet radius.
 * @param {'chamfer'|'fillet'} [options.kind]
 * @param {number} [options.segments] Tangent cuts per fillet.
 * @param {number} [options.minDihedralDegrees] Only edges sharper than this.
 * @param {(edge:object)=>boolean} [options.select] Extra per-edge predicate.
 * @returns {{mesh:object, beveledEdgeCount:number, skipped:Array}}
 */
export function bevelMeshEdges(mesh, {
  amount = 0.01,
  kind = 'fillet',
  segments = 3,
  minDihedralDegrees = 20,
  select = null,
} = {}) {
  if (!(amount > 0)) return { mesh, beveledEdgeCount: 0, skipped: [] };
  const welded = weld(mesh);
  const facetData = buildFacets(welded.positions, welded.triangles);
  const edges = collectEdges(welded.positions, welded.triangles, facetData, minDihedralDegrees);
  const bounds = meshBounds(mesh);
  const diagonal = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ) || 1;

  const skipped = [];
  let result = mesh;
  let beveled = 0;
  for (const edge of edges) {
    if (select && !select(edge)) continue;
    if (!edge.convex) {
      skipped.push({ key: edge.key, reason: 'concave edge needs added material, not removed' });
      continue;
    }
    // Clamp so a cutter can never swallow the whole feature.
    const localAmount = Math.min(amount, edge.length / 2, diagonal / 4);
    if (!(localAmount > EPSILON)) {
      skipped.push({ key: edge.key, reason: 'edge too short for the requested bevel' });
      continue;
    }
    const planes = bevelCutPlanes(edge, localAmount, kind, segments);
    for (const plane of planes) {
      const axisU = edge.direction;
      const axisW = plane.normal;
      const axisV = normalize3(cross3(axisW, axisU));
      if (axisV[0] === 0 && axisV[1] === 0 && axisV[2] === 0) continue;
      // Local cutter: spans the edge plus a margin, and reaches just far enough
      // past the cut plane to remove the corner sliver and nothing else.
      const reach = localAmount * 4;
      const halfU = edge.length / 2 + localAmount * 2;
      const centre = add3(
        scale3(add3(edge.start, edge.end), 0.5),
        scale3(axisW, reach),
      );
      const projected = dot3(subtract3(centre, plane.point), axisW);
      const shifted = add3(centre, scale3(axisW, reach - projected));
      const cutter = cutterBox(shifted, axisU, axisV, axisW, halfU, reach, reach);
      result = polyhedralSubtract(result, cutter);
    }
    beveled += 1;
  }
  return { mesh: result, beveledEdgeCount: beveled, skipped, candidateEdgeCount: edges.length };
}

export default bevelMeshEdges;
