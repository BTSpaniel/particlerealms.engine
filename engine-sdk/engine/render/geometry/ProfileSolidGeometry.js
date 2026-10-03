// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProfileSolidGeometry.js — extrude / revolve / sweep a Profile2D into a solid.
 *
 * These are the generative half of the exact modelling vocabulary:
 *
 *   extrudeProfile  profile + depth (+ draft taper)  -> prismatic solids
 *   revolveProfile  profile spun about an axis        -> solids of revolution
 *   sweepProfile    profile carried along a polyline  -> runs, trim, conduit
 *
 * Together with Profile2D's corner fillet/chamfer these cover the shapes that
 * matter for real parts: eased-edge lumber, I-beams, channels, angles, tubes,
 * nails, screws, bolts, washers, rods, gutters and handrails — all without a
 * tolerant B-rep edge solver, and all deterministic enough to sit behind sealed
 * content hashes.
 *
 * Profiles are authored in the XY plane. Extrusion runs along +Z and revolution
 * spins about +Y, matching the engine's right-handed, Y-up convention. Normals
 * are computed analytically per face family; walls are emitted with duplicated
 * vertices per segment so hard edges stay hard.
 */

import { triangulateRing, triangulateRingPair, ringSignedArea } from './Profile2D.js';

const EPSILON = 1e-12;
const DEG = Math.PI / 180;

function emptyMesh() {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function pushVertex(mesh, position, normal, uv) {
  mesh.positions.push(position[0], position[1], position[2]);
  mesh.normals.push(normal[0], normal[1], normal[2]);
  mesh.uvs.push(uv[0], uv[1]);
  return mesh.positions.length / 3 - 1;
}

function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length < EPSILON ? [0, 0, 0] : [vector[0] / length, vector[1] / length, vector[2] / length];
}

function ringPerimeter(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  return total;
}

/**
 * Emit one cap. `ring` order already encodes the outward winding for +normal;
 * `flip` reverses it for the opposite face.
 */
function emitCap(mesh, rings, z, normal, flip, scale) {
  const [outer, inner] = rings;
  const project = ([x, y]) => [x * scale, y * scale, z];
  if (inner) {
    const base = mesh.positions.length / 3;
    for (const point of outer) pushVertex(mesh, project(point), normal, [point[0], point[1]]);
    for (const point of inner) pushVertex(mesh, project(point), normal, [point[0], point[1]]);
    for (const [a, b, c] of triangulateRingPair(outer, inner)) {
      if (flip) mesh.indices.push(base + a, base + c, base + b);
      else mesh.indices.push(base + a, base + b, base + c);
    }
    return;
  }
  const base = mesh.positions.length / 3;
  for (const point of outer) pushVertex(mesh, project(point), normal, [point[0], point[1]]);
  for (const [a, b, c] of triangulateRing(outer)) {
    if (flip) mesh.indices.push(base + a, base + c, base + b);
    else mesh.indices.push(base + a, base + b, base + c);
  }
}

/**
 * Emit the side wall for one ring between two z levels.
 * `outward` is +1 for the outer boundary and -1 for holes.
 */
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function emitWall(mesh, ring, z0, z1, scale0, scale1, outward, vOffset, vScale) {
  const perimeter = ringPerimeter(ring) || 1;
  let travelled = 0;
  for (let index = 0; index < ring.length; index++) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const edge = [next[0] - current[0], next[1] - current[1]];
    const edgeLength = Math.hypot(edge[0], edge[1]);
    if (edgeLength < EPSILON) continue;
    // For a CCW ring the outward direction is the edge rotated -90 degrees.
    // `outward` flips it to point into the void for hole rings.
    const planar = [edge[1] * outward, -edge[0] * outward, 0];
    // The wall rises from (p * scale0, z0) to (p * scale1, z1), so with draft the
    // face tilts. Take the normal from the edge and that rise direction, then
    // orient it against the planar reference.
    const midpoint = [(current[0] + next[0]) / 2, (current[1] + next[1]) / 2];
    const rise = [midpoint[0] * (scale1 - scale0), midpoint[1] * (scale1 - scale0), z1 - z0];
    let normal = normalize3(cross3([edge[0], edge[1], 0], rise));
    if (normal[0] * planar[0] + normal[1] * planar[1] < 0) {
      normal = [-normal[0], -normal[1], -normal[2]];
    }
    if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) normal = normalize3(planar);
    // World-scale UVs: arc length along the profile, and true extrusion depth.
    // Normalising these to 0..1 made wall texel density depend on the part's
    // size and disagree with the caps, which are already in metres.
    const u0 = travelled;
    const u1 = travelled + edgeLength;
    travelled += edgeLength;
    void perimeter;
    const a = pushVertex(mesh, [current[0] * scale0, current[1] * scale0, z0], normal, [u0, z0 * vScale + vOffset]);
    const b = pushVertex(mesh, [next[0] * scale0, next[1] * scale0, z0], normal, [u1, z0 * vScale + vOffset]);
    const c = pushVertex(mesh, [current[0] * scale1, current[1] * scale1, z1], normal, [u0, z1 * vScale + vOffset]);
    const d = pushVertex(mesh, [next[0] * scale1, next[1] * scale1, z1], normal, [u1, z1 * vScale + vOffset]);
    mesh.indices.push(a, b, d, a, d, c);
  }
}

/**
 * Extrude a profile along +Z, centred on the origin.
 *
 * @param {{outer:Array,holes:Array}} profile
 * @param {object} [options]
 * @param {number} [options.depth] Total extrusion length.
 * @param {number} [options.draftDegrees] Per-side taper; positive shrinks the top.
 * @param {boolean} [options.capStart]
 * @param {boolean} [options.capEnd]
 */
export function extrudeProfile(profile, {
  depth = 1,
  draftDegrees = 0,
  capStart = true,
  capEnd = true,
} = {}) {
  const mesh = emptyMesh();
  const outer = profile.outer;
  const holes = profile.holes ?? [];
  const halfDepth = Math.max(EPSILON, depth) / 2;
  // Draft is expressed as a uniform radial scale at the far cap.
  const taper = Math.tan((Number(draftDegrees) || 0) * DEG) * depth;
  const reference = Math.sqrt(Math.abs(ringSignedArea(outer))) || 1;
  const endScale = Math.max(0.01, 1 - taper / reference);

  // Both rings are wound with material on the left (outer CCW, holes CW), so the
  // same edge-rotated-minus-90 rule already points away from the solid for each.
  emitWall(mesh, outer, -halfDepth, halfDepth, 1, endScale, 1, 0, 1);
  for (const hole of holes) emitWall(mesh, hole, -halfDepth, halfDepth, 1, endScale, 1, 0, 1);

  const capRings = holes.length === 1 ? [outer, holes[0]] : [outer, null];
  if (holes.length > 1) {
    throw new Error('ProfileSolidGeometry: caps support at most one hole ring');
  }
  if (capStart) emitCap(mesh, capRings, -halfDepth, [0, 0, -1], true, 1);
  if (capEnd) emitCap(mesh, capRings, halfDepth, [0, 0, 1], false, endScale);
  return mesh;
}

/**
 * Revolve a profile about the +Y axis.
 *
 * The profile's X coordinate is the radius and Y is the height, so a nail or
 * bolt is authored as its silhouette. For a full 360 degree revolution the seam
 * closes and no end caps are produced; a partial sweep caps both ends with the
 * flat profile.
 *
 * @param {{outer:Array,holes:Array}} profile
 * @param {object} [options]
 * @param {number} [options.angleDegrees]
 * @param {number} [options.segments]
 */
/**
 * Resample a closed ring to exactly `count` points, evenly spaced by ARC LENGTH.
 *
 * Lofting needs both rings to share a vertex count so corresponding points can be
 * joined. Matching by index alone would twist the surface whenever the two rings
 * have different vertex distributions, so arc length is used: a point half way
 * around one ring maps to the point half way around the other.
 */
/** Normalized (0..1) arc-length position of every vertex in a closed ring. */
function ringVertexParameters(ring) {
    const total = ring.length;
    const cumulative = [0];
    for (let index = 0; index < total; index++) {
        const current = ring[index];
        const next = ring[(index + 1) % total];
        cumulative.push(cumulative[index] + Math.hypot(next[0] - current[0], next[1] - current[1]));
    }
    const perimeter = cumulative[total];
    if (!(perimeter > 0)) throw new Error('resampleRing: ring has zero perimeter');
    return { cumulative, perimeter, parameters: cumulative.slice(0, total).map(value => value / perimeter) };
}

/** Point at a normalized arc-length position around a closed ring. */
function sampleRingAtParameter(ring, cumulative, perimeter, t) {
    const distance = Math.min(perimeter, Math.max(0, t * perimeter));
    let edge = 0;
    while (edge < ring.length - 1 && cumulative[edge + 1] < distance) edge += 1;
    const spanStart = cumulative[edge];
    const spanLength = cumulative[edge + 1] - spanStart;
    const local = spanLength > 1e-12 ? (distance - spanStart) / spanLength : 0;
    const current = ring[edge];
    const next = ring[(edge + 1) % ring.length];
    return [
        current[0] + (next[0] - current[0]) * local,
        current[1] + (next[1] - current[1]) * local,
    ];
}

/**
 * Resample a closed ring at the given normalized arc-length positions.
 *
 * Sampling at explicit parameters rather than at a uniform count is what keeps a
 * polygon's corners. Uniform arc-length resampling quietly rounds them off: a
 * 1 x 0.5 rectangle has perimeter 3, so four evenly spaced samples land at 0,
 * 0.75, 1.5 and 2.25 — none of which are corners — and the profile shrinks. A
 * square only survived because its perimeter divided evenly by chance.
 */
export function resampleRingAt(ring, parameters) {
    if (!(ring?.length >= 3)) throw new Error('resampleRing: a ring needs at least 3 points');
    if (!(parameters?.length >= 3)) throw new Error('resampleRing: needs at least 3 parameters');
    const { cumulative, perimeter } = ringVertexParameters(ring);
    return parameters.map(t => sampleRingAtParameter(ring, cumulative, perimeter, t));
}

/**
 * Resample a closed ring to `count` points evenly spaced by arc length.
 *
 * Retained for callers that genuinely want uniform spacing. Note that this DOES
 * round off corners unless the count happens to align with them; lofting uses
 * `resampleRingAt` with the union of both rings' vertex parameters instead.
 */
export function resampleRing(ring, count) {
    if (!(ring?.length >= 3)) throw new Error('resampleRing: a ring needs at least 3 points');
    if (!(count >= 3)) throw new Error('resampleRing: count must be at least 3');
    return resampleRingAt(ring, Array.from({ length: count }, (_, step) => step / count));
}

/**
 * Loft between two profiles: a solid whose cross-section blends from `startProfile`
 * to `endProfile` along +Z.
 *
 * This is the Tier 1 operation that neither extrude nor revolve can express — a
 * transition hopper, a tapered duct, a chair leg that changes section. Both rings
 * are arc-length resampled to a common vertex count so the surface cannot twist,
 * and each station is a genuine linear blend, so a loft between two copies of the
 * same profile is exactly an extrusion.
 *
 * Holes are not blended: a lofted ring pair would need a correspondence rule per
 * hole, which is a separate feature rather than a silent guess.
 *
 * @param {{outer:number[][], holes?:number[][][]}} startProfile
 * @param {{outer:number[][], holes?:number[][][]}} endProfile
 * @param {object} [options]
 * @param {number} [options.depth] Distance along +Z.
 * @param {number} [options.segments] Intermediate stations; 1 is a straight loft.
 * @param {(t:number)=>number} [options.ease] Blend curve, defaults to linear.
 */
export function loftProfiles(startProfile, endProfile, {
    depth = 1,
    segments = 1,
    ease = null,
} = {}) {
    if ((startProfile?.holes?.length ?? 0) > 0 || (endProfile?.holes?.length ?? 0) > 0) {
        throw new Error('loftProfiles: holes are not supported; loft the outer rings and subtract holes separately');
    }
    const stations = Math.max(1, Math.floor(segments));
    // Sample BOTH rings at the union of their vertex parameters. Every corner of
    // either profile therefore survives exactly, while correspondence stays
    // arc-length based so the side wall cannot twist.
    // Merge, then drop parameters that sit within a hair of the previous one:
    // two nearly-identical stations would emit a zero-area band whose normal is
    // numerically meaningless. Deduplicating by proximity rather than by rounding
    // keeps every retained parameter EXACT, so corners land where they belong.
    const sorted = [
        ...ringVertexParameters(startProfile.outer).parameters,
        ...ringVertexParameters(endProfile.outer).parameters,
    ].sort((left, right) => left - right);
    const merged = [];
    for (const value of sorted) {
        if (merged.length === 0 || value - merged[merged.length - 1] > 1e-9) merged.push(value);
    }
    if (merged.length >= 2 && 1 - merged[merged.length - 1] <= 1e-9) merged.pop();
    if (merged.length < 3) throw new Error('loftProfiles: profiles collapsed to fewer than 3 distinct stations');
    const start = resampleRingAt(startProfile.outer, merged);
    const end = resampleRingAt(endProfile.outer, merged);
    const count = merged.length;
    const blend = typeof ease === 'function' ? ease : (t => t);
    const half = depth / 2;

    const mesh = emptyMesh();
    const rings = [];
    for (let station = 0; station <= stations; station++) {
        const raw = station / stations;
        const t = Math.min(1, Math.max(0, Number(blend(raw)) || 0));
        const z = -half + depth * raw;
        rings.push(start.map((point, index) => [
            point[0] + (end[index][0] - point[0]) * t,
            point[1] + (end[index][1] - point[1]) * t,
            z,
        ]));
    }

    // Side wall: one quad band per station pair, wound outward.
    for (let station = 0; station < stations; station++) {
        const lower = rings[station];
        const upper = rings[station + 1];
        for (let index = 0; index < count; index++) {
            const next = (index + 1) % count;
            const a = lower[index];
            const b = lower[next];
            const c = upper[next];
            const d = upper[index];
            // Per-TRIANGLE normals, not one shared quad normal. A band running
            // from a straight edge to an arc is non-planar, so a single normal
            // taken from one corner leaves the other triangle facing backwards.
            for (const triangle of [[a, b, c], [a, c, d]]) {
                const [p0, p1, p2] = triangle;
                const normal = normalize3(cross3(
                    [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]],
                    [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]],
                ));
                // A degenerate triangle carries no surface and no usable normal.
                if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) continue;
                const base = mesh.positions.length / 3;
                for (const point of triangle) {
                    // Radius and height keep UV density even along both directions.
                    pushVertex(mesh, point, normal, [Math.hypot(point[0], point[1]), point[2]]);
                }
                mesh.indices.push(base, base + 1, base + 2);
            }
        }
    }

    // Caps, wound so both face outward along their own normal. emitCap takes a
    // [outer, inner] rings array and a uniform scale, matching extrudeProfile.
    emitCap(mesh, [start], -half, [0, 0, -1], true, 1);
    emitCap(mesh, [rings[stations].map(point => [point[0], point[1]])], half, [0, 0, 1], false, 1);
    return mesh;
}

export function revolveProfile(profile, { angleDegrees = 360, segments = 24 } = {}) {
  const mesh = emptyMesh();
  const ring = profile.outer;
  if ((profile.holes ?? []).length) {
    throw new Error('ProfileSolidGeometry: revolve does not support hole rings');
  }
  if (ring.some(([x]) => x < -EPSILON)) {
    throw new Error('ProfileSolidGeometry: revolve profiles must lie on x >= 0');
  }
  const sweep = Math.max(EPSILON, Math.min(360, Math.abs(Number(angleDegrees) || 360))) * DEG;
  const closed = Math.abs(sweep - Math.PI * 2) < 1e-9;
  const steps = Math.max(3, Math.floor(segments));
  const perimeter = ringPerimeter(ring) || 1;

  // Surface band: one quad per (profile edge, angular step).
  for (let step = 0; step < steps; step++) {
    const a0 = (sweep * step) / steps;
    const a1 = (sweep * (step + 1)) / steps;
    const cos0 = Math.cos(a0);
    const sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    let travelled = 0;
    for (let index = 0; index < ring.length; index++) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      const edge = [next[0] - current[0], next[1] - current[1]];
      const edgeLength = Math.hypot(edge[0], edge[1]);
      if (edgeLength < EPSILON) continue;
      // Outward normal of a CCW silhouette in the (radius, height) plane.
      const nr = edge[1] / edgeLength;
      const ny = -edge[0] / edgeLength;
      // World-scale UVs: v is arc length along the silhouette, u is arc length
      // around the revolution at this radius, so texel density stays uniform.
      const v0 = travelled;
      const v1 = travelled + edgeLength;
      travelled += edgeLength;
      void perimeter;
      const at = (point, cos, sin) => [point[0] * cos, point[1], -point[0] * sin];
      const normalAt = (cos, sin) => normalize3([nr * cos, ny, -nr * sin]);
      const n0 = normalAt(cos0, sin0);
      const n1 = normalAt(cos1, sin1);
      const meanRadius = (current[0] + next[0]) / 2;
      const u0 = a0 * meanRadius;
      const u1 = a1 * meanRadius;
      const p0 = pushVertex(mesh, at(current, cos0, sin0), n0, [u0, v0]);
      const p1 = pushVertex(mesh, at(next, cos0, sin0), n0, [u0, v1]);
      const p2 = pushVertex(mesh, at(current, cos1, sin1), n1, [u1, v0]);
      const p3 = pushVertex(mesh, at(next, cos1, sin1), n1, [u1, v1]);
      mesh.indices.push(p0, p2, p1, p1, p2, p3);
    }
  }

  if (!closed) {
    // Flat caps on the two cut planes. Sweeping +angle moves a point toward -Z,
    // so the start plane faces +(sin a, 0, cos a) and the end plane faces the
    // opposite way; the end cap therefore also reverses its triangle winding.
    for (const [angle, isEnd] of [[0, false], [sweep, true]]) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const outward = normalize3([sin, 0, cos]);
      const normal = isEnd ? [-outward[0], -outward[1], -outward[2]] : outward;
      const base = mesh.positions.length / 3;
      for (const point of ring) {
        pushVertex(mesh, [point[0] * cos, point[1], -point[0] * sin], normal, [point[0], point[1]]);
      }
      for (const [a, b, c] of triangulateRing(ring)) {
        if (isEnd) mesh.indices.push(base + a, base + c, base + b);
        else mesh.indices.push(base + a, base + b, base + c);
      }
    }
  }
  return mesh;
}

/**
 * Sweep a profile along an open or closed 3D polyline.
 *
 * Frames are built with a reference-vector (parallel transport style) approach so
 * the profile does not spin arbitrarily along the path. Intended for wires,
 * conduit, gutters, handrails and trim runs.
 *
 * @param {{outer:Array,holes:Array}} profile
 * @param {Array<[number,number,number]>} path
 * @param {object} [options]
 * @param {boolean} [options.closed]
 * @param {boolean} [options.caps]
 * @param {[number,number]} [options.spanRange] Open-path spans [first, end), keeping the complete path's frames.
 */
export function sweepProfile(profile, path, { closed = false, caps = true, spanRange = null } = {}) {
  const points = (path ?? []).map(point => [Number(point[0]), Number(point[1]), Number(point[2])]);
  if (points.length < 2) throw new Error('ProfileSolidGeometry: sweep needs at least 2 path points');
  const holes = profile.holes ?? [];
  if (holes.length > 1) throw new Error('ProfileSolidGeometry: sweep supports at most one hole ring');
  const ring = profile.outer;
  const mesh = emptyMesh();
  const count = points.length;

  const tangentAt = index => {
    const previous = points[(index - 1 + count) % count];
    const next = points[(index + 1) % count];
    if (!closed && index === 0) return normalize3([points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]]);
    if (!closed && index === count - 1) {
      const last = points[count - 1];
      const prior = points[count - 2];
      return normalize3([last[0] - prior[0], last[1] - prior[1], last[2] - prior[2]]);
    }
    return normalize3([next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]]);
  };

  // Seed an up reference that is not parallel to the first tangent.
  let reference = [0, 1, 0];
  const firstTangent = tangentAt(0);
  if (Math.abs(firstTangent[1]) > 0.9) reference = [1, 0, 0];

  const frames = [];
  for (let index = 0; index < count; index++) {
    const tangent = tangentAt(index);
    const binormal = normalize3([
      reference[1] * tangent[2] - reference[2] * tangent[1],
      reference[2] * tangent[0] - reference[0] * tangent[2],
      reference[0] * tangent[1] - reference[1] * tangent[0],
    ]);
    const normal = normalize3([
      tangent[1] * binormal[2] - tangent[2] * binormal[1],
      tangent[2] * binormal[0] - tangent[0] * binormal[2],
      tangent[0] * binormal[1] - tangent[1] * binormal[0],
    ]);
    frames.push({ origin: points[index], tangent, binormal, normal });
    // Carry the frame forward to minimise twist.
    reference = normal;
  }

  const place = (frame, [x, y]) => [
    frame.origin[0] + frame.binormal[0] * x + frame.normal[0] * y,
    frame.origin[1] + frame.binormal[1] * x + frame.normal[1] * y,
    frame.origin[2] + frame.binormal[2] * x + frame.normal[2] * y,
  ];
  const perimeter = ringPerimeter(ring) || 1;
  const spans = closed ? count : count - 1;
  if (spanRange != null && (closed || !Array.isArray(spanRange) || spanRange.length !== 2
    || !spanRange.every(Number.isInteger) || spanRange[0] < 0 || spanRange[0] >= spanRange[1] || spanRange[1] > spans)) {
    throw new RangeError('ProfileSolidGeometry: span range must select nonempty open-path spans');
  }
  const firstSpan = spanRange?.[0] ?? 0, endSpan = spanRange?.[1] ?? spans;
  for (let span = firstSpan; span < endSpan; span++) {
    const frameA = frames[span];
    const frameB = frames[(span + 1) % count];
    let travelled = 0;
    for (let index = 0; index < ring.length; index++) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      const edge = [next[0] - current[0], next[1] - current[1]];
      const edgeLength = Math.hypot(edge[0], edge[1]);
      if (edgeLength < EPSILON) continue;
      const localNormal = [edge[1] / edgeLength, -edge[0] / edgeLength];
      const worldNormal = frame => normalize3([
        frame.binormal[0] * localNormal[0] + frame.normal[0] * localNormal[1],
        frame.binormal[1] * localNormal[0] + frame.normal[1] * localNormal[1],
        frame.binormal[2] * localNormal[0] + frame.normal[2] * localNormal[1],
      ]);
      const u0 = travelled / perimeter;
      const u1 = (travelled + edgeLength) / perimeter;
      travelled += edgeLength;
      const nA = worldNormal(frameA);
      const nB = worldNormal(frameB);
      const a = pushVertex(mesh, place(frameA, current), nA, [u0, span / spans]);
      const b = pushVertex(mesh, place(frameA, next), nA, [u1, span / spans]);
      const c = pushVertex(mesh, place(frameB, current), nB, [u0, (span + 1) / spans]);
      const d = pushVertex(mesh, place(frameB, next), nB, [u1, (span + 1) / spans]);
      mesh.indices.push(a, b, d, a, d, c);
    }
  }

  for (const hole of holes) {
    // A clockwise inner ring emits inward normals and oppositely wound walls.
    const inner = sweepProfile({ outer: hole, holes: [] }, points, { closed, caps: false, spanRange });
    const offset = mesh.positions.length / 3;
    for (const value of inner.positions) mesh.positions.push(value);
    for (const value of inner.normals) mesh.normals.push(value);
    for (const value of inner.uvs) mesh.uvs.push(value);
    for (const index of inner.indices) mesh.indices.push(offset + index);
  }
  if (caps && !closed) {
    for (const [frameIndex, flip] of [[firstSpan, true], [endSpan, false]]) {
      const frame = frames[frameIndex];
      const normal = flip
        ? [-frame.tangent[0], -frame.tangent[1], -frame.tangent[2]]
        : frame.tangent;
      const base = mesh.positions.length / 3;
      for (const point of ring) pushVertex(mesh, place(frame, point), normal, [point[0], point[1]]);
      if (holes.length) for (const point of holes[0]) pushVertex(mesh, place(frame, point), normal, [point[0], point[1]]);
      const triangles = holes.length ? triangulateRingPair(ring, holes[0]) : triangulateRing(ring);
      for (const [a, b, c] of triangles) {
        if (flip) mesh.indices.push(base + a, base + c, base + b);
        else mesh.indices.push(base + a, base + b, base + c);
      }
    }
  }
  return mesh;
}

export default extrudeProfile;
