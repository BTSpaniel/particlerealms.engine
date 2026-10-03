// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SolidSdf.js — analytic signed-distance CSG for the modelling vocabulary.
 *
 * This is the implicit counterpart to Profile2D/ProfileSolidGeometry. Where those
 * are exact and prismatic, this evaluates a boolean TREE of analytic primitives
 * and meshes the result, which buys the operations a profile sweep cannot express:
 *
 *   union / subtract / intersect      hard booleans
 *   smooth variants (blend radius)    true blend fillets between dissimilar solids
 *   shell                             hollow a solid, preserving wall thickness
 *   offset                            grow or shrink a solid
 *
 * Every leaf is analytic — including `extrude` and `revolve`, via an exact
 * polygon distance field — so there is no mesh voxelisation step and no
 * dependence on input tessellation. The only approximation is the final
 * meshing grid, whose `resolution` is therefore part of the geometry key: two
 * different resolutions are two different immutable geometries, and sealed
 * content hashes stay stable.
 *
 * Right-handed, +Y up. Cylinders/cones/capsules run along Y; tori lie in XZ.
 */

import {
  smin,
  sdfUnion,
  sdfSubtract,
  sdfIntersect,
} from '../../voxel/MarchingCubesMesher.js';
import { profileFromSpec } from './Profile2D.js';

const DEG = Math.PI / 180;
const EPSILON = 1e-9;

/** Smooth max, mirroring the engine's `smin` so blends stay consistent. */
function smax(a, b, k) {
  return -smin(-a, -b, k);
}

// ---------------------------------------------------------------------------
// Analytic primitive distance functions
// ---------------------------------------------------------------------------

function sdBox(x, y, z, half) {
  const qx = Math.abs(x) - half[0];
  const qy = Math.abs(y) - half[1];
  const qz = Math.abs(z) - half[2];
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
}

function sdCylinder(x, y, z, radius, height) {
  const radial = Math.hypot(x, z) - radius;
  const axial = Math.abs(y) - height / 2;
  return Math.min(Math.max(radial, axial), 0)
    + Math.hypot(Math.max(radial, 0), Math.max(axial, 0));
}

function sdCone(x, y, z, radius, height) {
  // Apex at +height/2, base at -height/2.
  const q = Math.hypot(x, z);
  const t = Math.min(Math.max((height / 2 - y) / height, 0), 1);
  const rAt = radius * t;
  const side = q - rAt;
  const base = -height / 2 - y;
  // Scale the lateral term by the cone's slant so the field stays near-metric.
  const slant = Math.hypot(height, radius) || 1;
  return Math.max(side * (height / slant), base);
}

function sdCapsule(x, y, z, radius, height) {
  const half = Math.max(0, height / 2);
  const clamped = Math.min(Math.max(y, -half), half);
  return Math.hypot(x, y - clamped, z) - radius;
}

function sdTorus(x, y, z, majorRadius, minorRadius) {
  return Math.hypot(Math.hypot(x, z) - majorRadius, y) - minorRadius;
}

/**
 * Exact signed distance to a closed polygon (winding-number sign).
 * Rings are traversed together so hole rings contribute their own winding.
 */
function sdPolygonRings(px, py, rings) {
  let best = Infinity;
  let sign = 1;
  for (const ring of rings) {
    const count = ring.length;
    for (let index = 0; index < count; index++) {
      const [ax, ay] = ring[index];
      const [bx, by] = ring[(index + 1) % count];
      const ex = bx - ax;
      const ey = by - ay;
      const wx = px - ax;
      const wy = py - ay;
      const lengthSquared = ex * ex + ey * ey || EPSILON;
      const t = Math.min(Math.max((wx * ex + wy * ey) / lengthSquared, 0), 1);
      const cx = wx - ex * t;
      const cy = wy - ey * t;
      best = Math.min(best, cx * cx + cy * cy);
      // Flip the sign each time the +Y ray crosses an edge.
      const crossesUp = py >= ay && py < by;
      const crossesDown = py < ay && py >= by;
      const leftOf = ex * wy - ey * wx;
      if ((crossesUp && leftOf > 0) || (crossesDown && leftOf < 0)) sign = -sign;
    }
  }
  return sign * Math.sqrt(best);
}

function profileRings(profile) {
  return [profile.outer, ...(profile.holes ?? [])];
}

// ---------------------------------------------------------------------------
// Node compilation: shape -> { distance(x,y,z), bounds }
// ---------------------------------------------------------------------------

function expandBounds(bounds, amount) {
  return {
    min: bounds.min.map(value => value - amount),
    max: bounds.max.map(value => value + amount),
  };
}

function ringBounds(rings) {
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      min[0] = Math.min(min[0], x); max[0] = Math.max(max[0], x);
      min[1] = Math.min(min[1], y); max[1] = Math.max(max[1], y);
    }
  }
  return { min, max };
}

function compileLeaf(node) {
  const shape = String(node.shape ?? '');
  switch (shape) {
    case 'box':
    case 'rounded-box': {
      const half = node.size.map(value => Math.max(EPSILON, value) / 2);
      const radius = shape === 'rounded-box'
        ? Math.min(Math.max(Number(node.radius) || 0, 0), Math.min(...half))
        : 0;
      const inner = half.map(value => Math.max(0, value - radius));
      return {
        distance: (x, y, z) => sdBox(x, y, z, inner) - radius,
        bounds: { min: half.map(v => -v), max: [...half] },
      };
    }
    case 'sphere': {
      const radius = Math.max(EPSILON, Number(node.radius) || 0);
      return {
        distance: (x, y, z) => Math.hypot(x, y, z) - radius,
        bounds: { min: [-radius, -radius, -radius], max: [radius, radius, radius] },
      };
    }
    case 'cylinder': {
      const radius = Math.max(EPSILON, Number(node.radius) || 0);
      const height = Math.max(EPSILON, Number(node.height) || 0);
      return {
        distance: (x, y, z) => sdCylinder(x, y, z, radius, height),
        bounds: { min: [-radius, -height / 2, -radius], max: [radius, height / 2, radius] },
      };
    }
    case 'cone': {
      const radius = Math.max(EPSILON, Number(node.radius) || 0);
      const height = Math.max(EPSILON, Number(node.height) || 0);
      return {
        distance: (x, y, z) => sdCone(x, y, z, radius, height),
        bounds: { min: [-radius, -height / 2, -radius], max: [radius, height / 2, radius] },
      };
    }
    case 'capsule': {
      const radius = Math.max(EPSILON, Number(node.radius) || 0);
      const height = Math.max(0, Number(node.height) || 0);
      const extent = height / 2 + radius;
      return {
        distance: (x, y, z) => sdCapsule(x, y, z, radius, height),
        bounds: { min: [-radius, -extent, -radius], max: [radius, extent, radius] },
      };
    }
    case 'torus': {
      const major = Math.max(EPSILON, Number(node.majorRadius) || 0);
      const minor = Math.max(EPSILON, Number(node.minorRadius) || 0);
      const extent = major + minor;
      return {
        distance: (x, y, z) => sdTorus(x, y, z, major, minor),
        bounds: { min: [-extent, -minor, -extent], max: [extent, minor, extent] },
      };
    }
    case 'extrude': {
      const profile = profileFromSpec(node.profile);
      const rings = profileRings(profile);
      const half = Math.max(EPSILON, Number(node.depth) || 1) / 2;
      const flat = ringBounds(rings);
      return {
        distance: (x, y, z) => {
          const planar = sdPolygonRings(x, y, rings);
          const axial = Math.abs(z) - half;
          return Math.min(Math.max(planar, axial), 0)
            + Math.hypot(Math.max(planar, 0), Math.max(axial, 0));
        },
        bounds: {
          min: [flat.min[0], flat.min[1], -half],
          max: [flat.max[0], flat.max[1], half],
        },
      };
    }
    case 'revolve': {
      const profile = profileFromSpec(node.profile);
      const rings = profileRings(profile);
      const flat = ringBounds(rings);
      const outer = Math.max(Math.abs(flat.min[0]), Math.abs(flat.max[0]));
      return {
        // Spun about +Y: evaluate the silhouette in (radius, height).
        distance: (x, y, z) => sdPolygonRings(Math.hypot(x, z), y, rings),
        bounds: {
          min: [-outer, flat.min[1], -outer],
          max: [outer, flat.max[1], outer],
        },
      };
    }
    default:
      throw new Error(`SolidSdf: unknown shape '${shape}'`);
  }
}

function transformBounds(bounds, rotate, translate) {
  if (!rotate && !translate) return bounds;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const xi of [bounds.min[0], bounds.max[0]]) {
    for (const yi of [bounds.min[1], bounds.max[1]]) {
      for (const zi of [bounds.min[2], bounds.max[2]]) {
        let point = [xi, yi, zi];
        if (rotate) point = rotateForward(point, rotate);
        if (translate) point = point.map((value, axis) => value + translate[axis]);
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
    }
  }
  return { min, max };
}

/** Rotate by Z, then Y, then X — matching AssemblyCompiler's composeTRS. */
function rotateForward([x, y, z], [rx, ry, rz]) {
  const cz = Math.cos(rz * DEG); const sz = Math.sin(rz * DEG);
  const cy = Math.cos(ry * DEG); const sy = Math.sin(ry * DEG);
  const cx = Math.cos(rx * DEG); const sx = Math.sin(rx * DEG);
  let px = cz * x - sz * y;
  let py = sz * x + cz * y;
  let pz = z;
  const qx = cy * px + sy * pz;
  const qz = -sy * px + cy * pz;
  px = qx; pz = qz;
  const ry2 = cx * py - sx * pz;
  const rz2 = sx * py + cx * pz;
  return [px, ry2, rz2];
}

/** Inverse of rotateForward, used to pull query points into local space. */
function rotateInverse([x, y, z], [rx, ry, rz]) {
  const cx = Math.cos(rx * DEG); const sx = Math.sin(rx * DEG);
  const cy = Math.cos(ry * DEG); const sy = Math.sin(ry * DEG);
  const cz = Math.cos(rz * DEG); const sz = Math.sin(rz * DEG);
  let py = cx * y + sx * z;
  let pz = -sx * y + cx * z;
  let px = x;
  const qx = cy * px - sy * pz;
  const qz = sy * px + cy * pz;
  px = qx; pz = qz;
  const rx2 = cz * px + sz * py;
  const ry2 = -sz * px + cz * py;
  return [rx2, ry2, pz];
}

const BOOLEAN_OPS = Object.freeze({
  union: { hard: sdfUnion, soft: (a, b, k) => smin(a, b, k) },
  intersect: { hard: sdfIntersect, soft: (a, b, k) => smax(a, b, k) },
  subtract: { hard: sdfSubtract, soft: (a, b, k) => smax(a, -b, k) },
});

/**
 * Compile a CSG tree into `{ distance, bounds }`.
 *
 * Nodes are either leaves (`shape`) or operations (`op`). Any node may carry
 * `translate` and `rotate` (degrees, Z*Y*X like the rest of the pipeline).
 */
export function compileSolidSdf(node) {
  if (!node || typeof node !== 'object') throw new Error('SolidSdf: node must be an object');
  let compiled;
  if (node.op) {
    const op = String(node.op);
    if (op === 'shell' || op === 'offset') {
      const inner = compileSolidSdf(node.node);
      if (op === 'offset') {
        const distance = Number(node.distance) || 0;
        compiled = {
          distance: (x, y, z) => inner.distance(x, y, z) - distance,
          bounds: expandBounds(inner.bounds, Math.max(0, distance)),
        };
      } else {
        const thickness = Math.max(EPSILON, Number(node.thickness) || 0);
        // Hollow: keep a band of `thickness` around the original surface.
        compiled = {
          distance: (x, y, z) => Math.abs(inner.distance(x, y, z)) - thickness / 2,
          bounds: expandBounds(inner.bounds, thickness / 2),
        };
      }
    } else {
      const spec = BOOLEAN_OPS[op];
      if (!spec) throw new Error(`SolidSdf: unknown op '${op}'`);
      const children = (node.nodes ?? []).map(child => compileSolidSdf(child));
      if (children.length < 2) throw new Error(`SolidSdf: '${op}' needs at least 2 nodes`);
      const blend = Math.max(0, Number(node.blend) || 0);
      const combine = blend > 0
        ? (a, b) => spec.soft(a, b, blend)
        : (a, b) => spec.hard(a, b);
      compiled = {
        distance: (x, y, z) => children.reduce(
          (accumulated, child, index) => (index === 0
            ? child.distance(x, y, z)
            : combine(accumulated, child.distance(x, y, z))),
          0,
        ),
        bounds: boundsForOp(op, children, blend),
      };
    }
  } else {
    compiled = compileLeaf(node);
  }

  const translate = Array.isArray(node.translate) ? node.translate.map(Number) : null;
  const rotate = Array.isArray(node.rotate) ? node.rotate.map(Number) : null;
  if (!translate && !rotate) return compiled;
  const inner = compiled;
  return {
    distance: (x, y, z) => {
      let point = [x, y, z];
      if (translate) point = point.map((value, axis) => value - translate[axis]);
      if (rotate) point = rotateInverse(point, rotate);
      return inner.distance(point[0], point[1], point[2]);
    },
    bounds: transformBounds(inner.bounds, rotate, translate),
  };
}

function boundsForOp(op, children, blend) {
  if (op === 'subtract') return expandBounds(children[0].bounds, blend);
  if (op === 'intersect') {
    const min = [0, 1, 2].map(axis => Math.max(...children.map(child => child.bounds.min[axis])));
    const max = [0, 1, 2].map(axis => Math.min(...children.map(child => child.bounds.max[axis])));
    // A blended intersection can bulge slightly outside the shared box.
    return expandBounds({
      min: [0, 1, 2].map(axis => Math.min(min[axis], max[axis])),
      max: [0, 1, 2].map(axis => Math.max(min[axis], max[axis])),
    }, blend);
  }
  return expandBounds({
    min: [0, 1, 2].map(axis => Math.min(...children.map(child => child.bounds.min[axis]))),
    max: [0, 1, 2].map(axis => Math.max(...children.map(child => child.bounds.max[axis]))),
  }, blend);
}

/**
 * Mesh a CSG tree.
 *
 * `resolution` is voxels along the longest axis. It changes the output, so
 * callers MUST fold it into their geometry key.
 *
 * @returns {{positions:number[],normals:number[],uvs:number[],indices:number[]}}
 */
export function meshSolidSdf(tree, { resolution = 48, padding = null } = {}) {
  const compiled = compileSolidSdf(tree);
  const distance = compiled.distance;
  const steps = Math.max(8, Math.min(192, Math.floor(resolution)));
  const span = [0, 1, 2].map(axis => Math.max(EPSILON, compiled.bounds.max[axis] - compiled.bounds.min[axis]));
  const cell = Math.max(...span) / steps;
  // Pad by two cells so the surface never touches the grid boundary, which is
  // what leaves an open rim on the sampled region.
  const pad = padding ?? cell * 2;
  const origin = [0, 1, 2].map(axis => compiled.bounds.min[axis] - pad);
  const counts = [0, 1, 2].map(axis => Math.max(1, Math.ceil((span[axis] + pad * 2) / cell)));

  // 1. Sample the field on grid corners.
  const [nx, ny, nz] = counts;
  const strideY = nx + 1;
  const strideZ = strideY * (ny + 1);
  const field = new Float64Array((nx + 1) * (ny + 1) * (nz + 1));
  const at = (i, j, k) => field[i + j * strideY + k * strideZ];
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        field[i + j * strideY + k * strideZ] = distance(
          origin[0] + i * cell,
          origin[1] + j * cell,
          origin[2] + k * cell,
        );
      }
    }
  }

  // 2. One dual vertex per sign-changing cell, placed at the mean of its edge
  //    crossings. This is naive surface nets: manifold and watertight by
  //    construction, so no edge-dedup bookkeeping can crack the surface.
  const CELL_EDGES = [
    [0, 1], [1, 3], [3, 2], [2, 0],
    [4, 5], [5, 7], [7, 6], [6, 4],
    [0, 4], [1, 5], [3, 7], [2, 6],
  ];
  const CORNER_OFFSETS = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const positions = [];
  const normals = [];
  const gradient = (x, y, z) => {
    const h = cell * 0.5;
    const gx = distance(x + h, y, z) - distance(x - h, y, z);
    const gy = distance(x, y + h, z) - distance(x, y - h, z);
    const gz = distance(x, y, z + h) - distance(x, y, z - h);
    const length = Math.hypot(gx, gy, gz);
    return length < EPSILON ? [0, 1, 0] : [gx / length, gy / length, gz / length];
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const corners = CORNER_OFFSETS.map(([di, dj, dk]) => at(i + di, j + dj, k + dk));
        let inside = 0;
        for (const value of corners) if (value < 0) inside += 1;
        if (inside === 0 || inside === 8) continue;
        let sx = 0; let sy = 0; let sz = 0; let hits = 0;
        for (const [a, b] of CELL_EDGES) {
          const da = corners[a];
          const db = corners[b];
          if ((da < 0) === (db < 0)) continue;
          const t = da / (da - db);
          const [ax, ay, az] = CORNER_OFFSETS[a];
          const [bx, by, bz] = CORNER_OFFSETS[b];
          sx += ax + (bx - ax) * t;
          sy += ay + (by - ay) * t;
          sz += az + (bz - az) * t;
          hits += 1;
        }
        if (hits === 0) continue;
        const wx = origin[0] + (i + sx / hits) * cell;
        const wy = origin[1] + (j + sy / hits) * cell;
        const wz = origin[2] + (k + sz / hits) * cell;
        cellVertex[i + j * nx + k * nx * ny] = positions.length / 3;
        positions.push(wx, wy, wz);
        // Exact analytic gradient beats interpolated face normals.
        normals.push(...gradient(wx, wy, wz));
      }
    }
  }

  // 3. One quad per sign-changing grid edge, joining the 4 cells around it.
  //    Corner orders below are chosen so the quad winds counter-clockwise when
  //    viewed from outside; a sign flip reverses it.
  const indices = [];
  const vertexAt = (i, j, k) => (
    i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz
      ? -1
      : cellVertex[i + j * nx + k * nx * ny]
  );
  const emitQuad = (quad, flip) => {
    if (quad.some(index => index < 0)) return;
    const [a, b, c, d] = flip ? [quad[3], quad[2], quad[1], quad[0]] : quad;
    indices.push(a, b, c, a, c, d);
  };
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const base = at(i, j, k);
        if (i < nx && j >= 1 && k >= 1 && (base < 0) !== (at(i + 1, j, k) < 0)) {
          emitQuad([
            vertexAt(i, j - 1, k - 1), vertexAt(i, j, k - 1),
            vertexAt(i, j, k), vertexAt(i, j - 1, k),
          ], !(base < 0));
        }
        if (j < ny && i >= 1 && k >= 1 && (base < 0) !== (at(i, j + 1, k) < 0)) {
          emitQuad([
            vertexAt(i - 1, j, k - 1), vertexAt(i - 1, j, k),
            vertexAt(i, j, k), vertexAt(i, j, k - 1),
          ], !(base < 0));
        }
        if (k < nz && i >= 1 && j >= 1 && (base < 0) !== (at(i, j, k + 1) < 0)) {
          emitQuad([
            vertexAt(i - 1, j - 1, k), vertexAt(i, j - 1, k),
            vertexAt(i, j, k), vertexAt(i - 1, j, k),
          ], !(base < 0));
        }
      }
    }
  }

  // Deterministic triplanar UVs from the dominant normal axis.
  const uvs = [];
  for (let index = 0; index < positions.length; index += 3) {
    const ax = Math.abs(normals[index]);
    const ay = Math.abs(normals[index + 1]);
    const az = Math.abs(normals[index + 2]);
    if (ax >= ay && ax >= az) uvs.push(positions[index + 2], positions[index + 1]);
    else if (ay >= az) uvs.push(positions[index], positions[index + 2]);
    else uvs.push(positions[index], positions[index + 1]);
  }
  return { positions, normals, uvs, indices };
}

export default meshSolidSdf;
