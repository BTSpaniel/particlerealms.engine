// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RoundedBoxGeometry.js — exact filleted box.
 *
 * The surface is the Minkowski sum of an inner box (half extents reduced by the
 * fillet radius) and a sphere of that radius, so it is emitted as three exact
 * families rather than an approximated/spherified cube:
 *
 *   6 flat faces            — the inner box faces pushed out by r
 *   12 quarter cylinders    — one per inner box edge, radius r
 *   8 sphere octants        — one per inner box corner, radius r
 *
 * Normals are analytic (never derived from adjacent triangles). UVs are a
 * world-scale triplanar projection along each vertex's dominant normal axis, so
 * texel density is uniform across the flat faces, the edge rounds and the corner
 * patches. Both are deterministic for the geometryKey caches downstream.
 *
 * Right-handed, +Y up. Winding is counter-clockwise viewed from outside.
 */

/** Right-handed cyclic tangent basis: axis → the two axes that follow it. */
const CYCLIC = [[1, 2], [2, 0], [0, 1]];

function axisVector(axis, scale = 1) {
  const vector = [0, 0, 0];
  vector[axis] = scale;
  return vector;
}

function combine(...terms) {
  const out = [0, 0, 0];
  for (const [vector, scale] of terms) {
    out[0] += vector[0] * scale;
    out[1] += vector[1] * scale;
    out[2] += vector[2] * scale;
  }
  return out;
}

/**
 * Emit one (rows x cols) quad patch. `vertexAt(u, v)` returns analytic position
 * and normal; `flip` reverses winding when the patch's parameter basis is
 * left-handed relative to its outward normal.
 */
function pushPatch(target, rows, cols, flip, vertexAt) {
  const base = target.positions.length / 3;
  // Evaluate the whole grid first so UVs can be measured in world arc length.
  const grid = [];
  for (let row = 0; row <= rows; row++) {
    const line = [];
    for (let col = 0; col <= cols; col++) line.push(vertexAt(col / cols, row / rows));
    grid.push(line);
  }
  // Arc length along the first row and first column. A per-vertex triplanar
  // projection cannot be used here: the dominant axis can differ between the
  // three corners of one triangle, which produces a garbage UV triangle and a
  // texel density blow-up right where a fillet meets a face. Arc length is
  // continuous across the patch and keeps density at ~1 texel per metre on flat
  // faces, edge rounds and corner patches alike.
  const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const uAt = [0];
  for (let col = 1; col <= cols; col++) {
    uAt.push(uAt[col - 1] + distance(grid[0][col - 1].position, grid[0][col].position));
  }
  const vAt = [0];
  for (let row = 1; row <= rows; row++) {
    vAt.push(vAt[row - 1] + distance(grid[row - 1][0].position, grid[row][0].position));
  }
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const { position, normal } = grid[row][col];
      target.positions.push(position[0], position[1], position[2]);
      target.normals.push(normal[0], normal[1], normal[2]);
      target.uvs.push(uAt[col], vAt[row]);
    }
  }
  const stride = cols + 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = base + row * stride + col;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      if (flip) target.indices.push(a, d, b, a, c, d);
      else target.indices.push(a, b, d, a, d, c);
    }
  }
}

/**
 * @param {[number,number,number]} size Full extents [width, height, depth].
 * @param {number} radius Fillet radius; clamped to half of the smallest extent.
 * @param {number} segments Quads per 90 degree arc.
 */
export function createRoundedBoxGeometry(size = [1, 1, 1], radius = 0.1, segments = 4) {
  const extents = [0, 1, 2].map(axis => Math.max(1e-6, Number(size?.[axis]) || 0) / 2);
  const limit = Math.min(...extents);
  const r = Math.min(Math.max(Number(radius) || 0, 0), limit);
  const arc = Math.max(1, Math.floor(Number(segments) || 1));
  const inner = extents.map(value => Math.max(0, value - r));
  const target = { positions: [], normals: [], uvs: [], indices: [] };

  // A zero radius degenerates every arc family; emit the plain box faces only.
  const HALF_PI = Math.PI / 2;

  // 6 flat faces: inner-box face pushed out by r along its own normal.
  for (let axis = 0; axis < 3; axis++) {
    const [uAxis, vAxis] = CYCLIC[axis];
    for (const sign of [1, -1]) {
      const normal = axisVector(axis, sign);
      // Swapping tangents for the negative face keeps u x v == outward normal.
      const first = sign > 0 ? uAxis : vAxis;
      const second = sign > 0 ? vAxis : uAxis;
      pushPatch(target, 1, 1, false, (u, v) => ({
        position: combine(
          [axisVector(axis, 1), sign * extents[axis]],
          [axisVector(first, 1), (2 * u - 1) * inner[first]],
          [axisVector(second, 1), (2 * v - 1) * inner[second]],
        ),
        normal,
      }));
    }
  }

  if (r <= 0) return target;

  // 12 quarter cylinders: one per inner-box edge, swept between the two faces.
  for (let axis = 0; axis < 3; axis++) {
    const [bAxis, cAxis] = CYCLIC[axis];
    for (const bSign of [1, -1]) {
      for (const cSign of [1, -1]) {
        pushPatch(target, 1, arc, bSign * cSign < 0, (u, v) => {
          const angle = u * HALF_PI;
          const normal = combine(
            [axisVector(bAxis, 1), bSign * Math.cos(angle)],
            [axisVector(cAxis, 1), cSign * Math.sin(angle)],
          );
          return {
            position: combine(
              [axisVector(axis, 1), (2 * v - 1) * inner[axis]],
              [axisVector(bAxis, 1), bSign * inner[bAxis]],
              [axisVector(cAxis, 1), cSign * inner[cAxis]],
              [normal, r],
            ),
            normal,
          };
        });
      }
    }
  }

  // 8 sphere octants: one per inner-box corner.
  for (const xSign of [1, -1]) {
    for (const ySign of [1, -1]) {
      for (const zSign of [1, -1]) {
        const signs = [xSign, ySign, zSign];
        pushPatch(target, arc, arc, xSign * ySign * zSign < 0, (u, v) => {
          const azimuth = u * HALF_PI;
          const polar = v * HALF_PI;
          const normal = [
            xSign * Math.sin(polar) * Math.cos(azimuth),
            ySign * Math.cos(polar),
            zSign * Math.sin(polar) * Math.sin(azimuth),
          ];
          return {
            position: [0, 1, 2].map(axis => signs[axis] * inner[axis] + normal[axis] * r),
            normal,
          };
        });
      }
    }
  }

  return target;
}

export default createRoundedBoxGeometry;
