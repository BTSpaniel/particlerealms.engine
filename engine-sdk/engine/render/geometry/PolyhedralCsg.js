// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PolyhedralCsg.js — EXACT boolean operations on planar polyhedra.
 *
 * SolidSdf.js meshes an implicit field, so its booleans carry a grid-resolution
 * error and round every sharp arris. That is the right tool for blends and
 * organic work, and the wrong one for a mortised stud or a drilled bracket,
 * where the dimensions and the sharp edges ARE the point.
 *
 * This is the exact alternative, using BSP-tree CSG (Naylor/Thibault): every
 * output face lies in an input face's plane, so planar geometry keeps its exact
 * dimensions, its flatness and its sharp edges. A box minus a box is dimensionally
 * exact rather than 0.5% out.
 *
 * Scope, stated honestly:
 *   - EXACT for solids bounded by planar faces (extrusions, plates, framing).
 *   - For tessellated curved input (cylinders, spheres) the result is exact with
 *     respect to that tessellation, not to the ideal surface. Raise the source
 *     tessellation for a closer answer; it never silently reduces it.
 *   - Inputs must be closed, consistently-wound, non-self-intersecting solids.
 *
 * Deterministic: tree construction follows input polygon order, and all
 * classification uses one fixed epsilon.
 */

const EPSILON = 1e-9;
const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

/**
 * Plane of a polygon by Newell's method.
 *
 * Deriving it from the first three vertices alone is not safe here: BSP splits
 * routinely produce rings whose leading vertices are collinear, and treating
 * those as degenerate would discard a polygon that has real area, leaving a
 * sliver hole that only shows up after many chained booleans. Newell's sum uses
 * every edge, so it is stable for any non-degenerate ring and its magnitude is
 * twice the polygon area.
 */
function planeFromRing(vertices) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const count = vertices.length;
  for (let index = 0; index < count; index++) {
    const current = vertices[index].position;
    const next = vertices[(index + 1) % count].position;
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
    cx += current[0];
    cy += current[1];
    cz += current[2];
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < EPSILON) return null;
  let normal = [nx / length, ny / length, nz / length];
  // Reference the centroid rather than one vertex so w is not skewed by a
  // single drifted split point.
  const centroid = [cx / count, cy / count, cz / count];
  let w = normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2];
  if (vertices.some(vertex => Math.abs(normal[0] * vertex.position[0] + normal[1] * vertex.position[1] + normal[2] * vertex.position[2] - w) > EPSILON)) {
    // A long thin split polygon far from the origin can lose its normal to
    // cancellation in Newell's sum. Its own plane then classifies the same
    // polygon as BACK forever during BSP construction. Recenter only this
    // unstable case, retaining established geometry for ordinary faces.
    const origin = vertices[0].position;
    nx = 0; ny = 0; nz = 0;
    for (let index = 0; index < count; index++) {
      const a = vertices[index].position.map((value, axis) => value - origin[axis]);
      const b = vertices[(index + 1) % count].position.map((value, axis) => value - origin[axis]);
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const stableLength = Math.hypot(nx, ny, nz);
    if (stableLength < EPSILON) return null;
    normal = [nx / stableLength, ny / stableLength, nz / stableLength];
    w = normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2];
  }
  return { normal, w };
}

function interpolate(a, b, t) {
  return {
    position: [
      a.position[0] + (b.position[0] - a.position[0]) * t,
      a.position[1] + (b.position[1] - a.position[1]) * t,
      a.position[2] + (b.position[2] - a.position[2]) * t,
    ],
    normal: [
      a.normal[0] + (b.normal[0] - a.normal[0]) * t,
      a.normal[1] + (b.normal[1] - a.normal[1]) * t,
      a.normal[2] + (b.normal[2] - a.normal[2]) * t,
    ],
  };
}

function flipVertex(vertex) {
  return {
    position: vertex.position,
    normal: [-vertex.normal[0], -vertex.normal[1], -vertex.normal[2]],
  };
}

function makePolygon(vertices) {
  const plane = planeFromRing(vertices);
  return plane == null ? null : { vertices, plane };
}

function flipPolygon(polygon) {
  return {
    vertices: [...polygon.vertices].reverse().map(flipVertex),
    plane: {
      normal: [-polygon.plane.normal[0], -polygon.plane.normal[1], -polygon.plane.normal[2]],
      w: -polygon.plane.w,
    },
  };
}

function signedDistance(plane, position) {
  return plane.normal[0] * position[0]
    + plane.normal[1] * position[1]
    + plane.normal[2] * position[2]
    - plane.w;
}

/**
 * Split `polygon` by `plane`, appending the pieces to the four buckets.
 * Coplanar faces are routed by normal agreement, which is what keeps shared
 * faces between two solids from being emitted twice.
 */
function splitPolygon(plane, polygon, coplanarFront, coplanarBack, front, back) {
  let polygonType = 0;
  const types = [];
  for (const vertex of polygon.vertices) {
    const distance = signedDistance(plane, vertex.position);
    const type = distance < -EPSILON ? BACK : (distance > EPSILON ? FRONT : COPLANAR);
    polygonType |= type;
    types.push(type);
  }

  if (polygonType === COPLANAR) {
    const agrees = plane.normal[0] * polygon.plane.normal[0]
      + plane.normal[1] * polygon.plane.normal[1]
      + plane.normal[2] * polygon.plane.normal[2] > 0;
    (agrees ? coplanarFront : coplanarBack).push(polygon);
    return;
  }
  if (polygonType === FRONT) { front.push(polygon); return; }
  if (polygonType === BACK) { back.push(polygon); return; }

  const frontVertices = [];
  const backVertices = [];
  const count = polygon.vertices.length;
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    const currentType = types[index];
    const nextType = types[next];
    const currentVertex = polygon.vertices[index];
    const nextVertex = polygon.vertices[next];
    if (currentType !== BACK) frontVertices.push(currentVertex);
    if (currentType !== FRONT) backVertices.push(currentVertex);
    if ((currentType | nextType) === SPANNING) {
      const dCurrent = signedDistance(plane, currentVertex.position);
      const dNext = signedDistance(plane, nextVertex.position);
      const t = dCurrent / (dCurrent - dNext);
      const split = interpolate(currentVertex, nextVertex, t);
      frontVertices.push(split);
      backVertices.push(split);
    }
  }
  if (frontVertices.length >= 3) {
    const built = makePolygon(frontVertices);
    if (built) front.push(built);
  }
  if (backVertices.length >= 3) {
    const built = makePolygon(backVertices);
    if (built) back.push(built);
  }
}

class BspNode {
  constructor(polygons = null) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons && polygons.length) this.build(polygons);
  }

  invert() {
    // Iterative to keep deep trees off the call stack.
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      node.polygons = node.polygons.map(flipPolygon);
      if (node.plane) {
        node.plane = {
          normal: [-node.plane.normal[0], -node.plane.normal[1], -node.plane.normal[2]],
          w: -node.plane.w,
        };
      }
      const swap = node.front;
      node.front = node.back;
      node.back = swap;
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
  }

  /** Remove the parts of `polygons` that fall inside this solid. */
  clipPolygons(polygons) {
    if (!this.plane) return [...polygons];
    let front = [];
    let back = [];
    for (const polygon of polygons) {
      splitPolygon(this.plane, polygon, front, back, front, back);
    }
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return [...front, ...back];
  }

  clipTo(other) {
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      node.polygons = other.clipPolygons(node.polygons);
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
  }

  allPolygons() {
    const out = [];
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      out.push(...node.polygons);
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
    return out;
  }

  build(polygons) {
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane;
    const front = [];
    const back = [];
    for (const polygon of polygons) {
      splitPolygon(this.plane, polygon, this.polygons, this.polygons, front, back);
    }
    if (front.length) {
      this.front ??= new BspNode();
      this.front.build(front);
    }
    if (back.length) {
      this.back ??= new BspNode();
      this.back.build(back);
    }
  }
}

/** Triangle-soup mesh -> polygon list. */
function meshToPolygons(mesh) {
  const positions = mesh.positions;
  const normals = mesh.normals ?? null;
  const indices = mesh.indices;
  const polygons = [];
  const vertexAt = index => ({
    position: [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]],
    normal: normals
      ? [normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]]
      : [0, 0, 0],
  });
  for (let offset = 0; offset < indices.length; offset += 3) {
    const built = makePolygon([
      vertexAt(indices[offset]),
      vertexAt(indices[offset + 1]),
      vertexAt(indices[offset + 2]),
    ]);
    if (built) polygons.push(built);
  }
  return polygons;
}

/**
 * Polygon list -> triangle-soup mesh. Output n-gons are convex by construction
 * (BSP splits of convex input), so a fan triangulation is valid. Vertex normals
 * are replaced by the exact face plane normal to keep flats flat.
 */
function polygonsToMesh(polygons) {
  const out = { positions: [], normals: [], uvs: [], indices: [] };
  for (const polygon of polygons) {
    const base = out.positions.length / 3;
    const { normal } = polygon.plane;
    for (const vertex of polygon.vertices) {
      out.positions.push(vertex.position[0], vertex.position[1], vertex.position[2]);
      out.normals.push(normal[0], normal[1], normal[2]);
      // Planar UVs from the dominant plane axis; deterministic.
      const ax = Math.abs(normal[0]);
      const ay = Math.abs(normal[1]);
      const az = Math.abs(normal[2]);
      if (ax >= ay && ax >= az) out.uvs.push(vertex.position[2], vertex.position[1]);
      else if (ay >= az) out.uvs.push(vertex.position[0], vertex.position[2]);
      else out.uvs.push(vertex.position[0], vertex.position[1]);
    }
    for (let index = 2; index < polygon.vertices.length; index++) {
      out.indices.push(base, base + index - 1, base + index);
    }
  }
  return out;
}

function runBoolean(meshA, meshB, operation) {
  const a = new BspNode(meshToPolygons(meshA));
  const b = new BspNode(meshToPolygons(meshB));
  if (operation === 'union') {
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
  } else if (operation === 'subtract') {
    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();
  } else if (operation === 'intersect') {
    a.invert();
    b.clipTo(a);
    b.invert();
    a.clipTo(b);
    b.clipTo(a);
    a.build(b.allPolygons());
    a.invert();
  } else {
    throw new Error(`PolyhedralCsg: unknown operation '${operation}'`);
  }
  return polygonsToMesh(a.allPolygons());
}

export function polyhedralUnion(meshA, meshB) {
  return runBoolean(meshA, meshB, 'union');
}

export function polyhedralSubtract(meshA, meshB) {
  return runBoolean(meshA, meshB, 'subtract');
}

export function polyhedralIntersect(meshA, meshB) {
  return runBoolean(meshA, meshB, 'intersect');
}

/** Fold a list of meshes left-to-right with one operation. */
export function polyhedralBoolean(operation, meshes) {
  if (!Array.isArray(meshes) || meshes.length < 2) {
    throw new Error('PolyhedralCsg: boolean needs at least 2 meshes');
  }
  return meshes.reduce((accumulated, mesh) => runBoolean(accumulated, mesh, operation));
}

function transformMeshInPlace(mesh, rotate, translate) {
  if (!rotate && !translate) return mesh;
  const cz = rotate ? Math.cos(rotate[2] * DEG) : 1;
  const sz = rotate ? Math.sin(rotate[2] * DEG) : 0;
  const cy = rotate ? Math.cos(rotate[1] * DEG) : 1;
  const sy = rotate ? Math.sin(rotate[1] * DEG) : 0;
  const cx = rotate ? Math.cos(rotate[0] * DEG) : 1;
  const sx = rotate ? Math.sin(rotate[0] * DEG) : 0;
  // Z then Y then X, matching AssemblyCompiler's composeTRS.
  const apply = (x, y, z) => {
    let px = cz * x - sz * y;
    let py = sz * x + cz * y;
    let pz = z;
    const qx = cy * px + sy * pz;
    const qz = -sy * px + cy * pz;
    px = qx; pz = qz;
    return [px, cx * py - sx * pz, sx * py + cx * pz];
  };
  const positions = [];
  const normals = [];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const rotated = apply(mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]);
    positions.push(
      rotated[0] + (translate ? translate[0] : 0),
      rotated[1] + (translate ? translate[1] : 0),
      rotated[2] + (translate ? translate[2] : 0),
    );
    const rotatedNormal = apply(mesh.normals[index], mesh.normals[index + 1], mesh.normals[index + 2]);
    normals.push(rotatedNormal[0], rotatedNormal[1], rotatedNormal[2]);
  }
  return { positions, normals, indices: mesh.indices };
}

const DEG = Math.PI / 180;

/**
 * Evaluate a CSG tree EXACTLY by building each leaf as a boundary mesh and
 * folding with BSP booleans. Shares its node vocabulary with SolidSdf so a
 * document can switch between the exact and implicit evaluators.
 *
 * `shell` and `offset` have no exact polyhedral form and are rejected here
 * rather than silently approximated — use the implicit evaluator for those.
 *
 * @param {object} tree
 * @param {object} [options]
 * @param {object} options.leafBuilders Map of shape name -> (node) => mesh.
 */
export function meshExactCsg(tree, { leafBuilders }) {
  if (!tree || typeof tree !== 'object') throw new Error('PolyhedralCsg: tree must be an object');
  const evaluate = node => {
    let mesh;
    if (node.op) {
      if (node.op === 'shell' || node.op === 'offset') {
        throw new Error(`PolyhedralCsg: '${node.op}' has no exact polyhedral form; use the implicit evaluator`);
      }
      if (node.blend > 0) {
        throw new Error("PolyhedralCsg: 'blend' is an implicit-only operation; use the implicit evaluator");
      }
      const children = (node.nodes ?? []).map(evaluate);
      if (children.length < 2) throw new Error(`PolyhedralCsg: '${node.op}' needs at least 2 nodes`);
      mesh = polyhedralBoolean(node.op, children);
    } else {
      const builder = leafBuilders?.[node.shape];
      if (!builder) throw new Error(`PolyhedralCsg: no exact builder for shape '${node.shape}'`);
      mesh = builder(node);
    }
    return transformMeshInPlace(
      mesh,
      Array.isArray(node.rotate) ? node.rotate.map(Number) : null,
      Array.isArray(node.translate) ? node.translate.map(Number) : null,
    );
  };
  const result = evaluate(tree);
  // Leaf builders may omit UVs; polygonsToMesh already supplies them for
  // boolean output, so only a bare single-leaf tree can arrive without.
  return result.uvs ? result : polygonsToMesh(meshToPolygons(result));
}

export default polyhedralBoolean;
