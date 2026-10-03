// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Profile2D.js — closed 2D profiles, corner treatments, and cap triangulation.
 *
 * This is the exact (non-voxel) half of the modelling vocabulary. Chamfer and
 * fillet are applied to profile CORNERS here rather than to solid edges later,
 * which keeps them robust and deterministic: a chamfered stud is a chamfered
 * rectangle that gets extruded, and a nail is a revolved outline. No tolerant
 * B-rep edge solver is involved, so results are stable enough to sit behind the
 * content hashes and geometryKey caches that seal RealmForge assets.
 *
 * A profile is `{ outer: Ring, holes: Ring[] }` where a Ring is an array of
 * `[x, y]` pairs. Rings are implicitly closed (no duplicated last point).
 * `outer` is normalised counter-clockwise; holes are normalised clockwise.
 *
 * Everything here is deterministic: no randomness, no iteration-order
 * dependence, and no floating-point tolerance tuning beyond a fixed epsilon.
 */

const EPSILON = 1e-12;
const TAU = Math.PI * 2;

/** Twice the signed area; positive when the ring winds counter-clockwise. */
export function ringSignedArea(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    total += x0 * y1 - x1 * y0;
  }
  return total / 2;
}

function orient(ring, counterClockwise) {
  const area = ringSignedArea(ring);
  if (area === 0) return [...ring];
  return (area > 0) === counterClockwise ? [...ring] : [...ring].reverse();
}

/** Drop consecutive duplicates and exactly collinear spurs. */
function cleanRing(ring) {
  const points = [];
  for (const point of ring) {
    const previous = points[points.length - 1];
    if (previous && Math.abs(previous[0] - point[0]) < EPSILON && Math.abs(previous[1] - point[1]) < EPSILON) continue;
    points.push([Number(point[0]), Number(point[1])]);
  }
  while (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first[0] - last[0]) < EPSILON && Math.abs(first[1] - last[1]) < EPSILON) points.pop();
    else break;
  }
  return points;
}

/** Normalise a profile: CCW outer, CW holes, duplicates removed. */
export function makeProfile(outer, holes = []) {
  const cleanOuter = cleanRing(outer);
  if (cleanOuter.length < 3) throw new Error('Profile2D: outer ring needs at least 3 distinct points');
  return {
    outer: orient(cleanOuter, true),
    holes: holes.map(hole => {
      const clean = cleanRing(hole);
      if (clean.length < 3) throw new Error('Profile2D: hole ring needs at least 3 distinct points');
      return orient(clean, false);
    }),
  };
}

function normalize2(x, y) {
  const length = Math.hypot(x, y);
  return length < EPSILON ? [0, 0] : [x / length, y / length];
}

/**
 * Replace each corner with an arc (fillet) or a single cut (chamfer).
 *
 * `amount` is the requested radius (fillet) or leg length (chamfer). It is
 * clamped per corner so neighbouring treatments can never overrun a short edge,
 * which is what makes this safe to apply blindly to generated profiles.
 *
 * @param {Array<[number,number]>} ring
 * @param {number|Array<number>} amount Uniform value, or one entry per corner.
 * @param {object} [options]
 * @param {'fillet'|'chamfer'} [options.kind]
 * @param {number} [options.segments] Arc segments per fillet.
 */
export function treatRingCorners(ring, amount, { kind = 'fillet', segments = 4 } = {}) {
  const points = cleanRing(ring);
  const count = points.length;
  if (count < 3) return points;
  const arcSegments = Math.max(1, Math.floor(segments));
  const amountAt = index => Math.max(0, Number(Array.isArray(amount) ? amount[index] ?? 0 : amount) || 0);

  // Clamp every corner against half of each adjacent edge before emitting, so
  // two large adjacent treatments degrade gracefully instead of self-crossing.
  const edgeLength = index => {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % count];
    return Math.hypot(x1 - x0, y1 - y0);
  };

  const output = [];
  for (let index = 0; index < count; index++) {
    const previous = points[(index - 1 + count) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const [ux, uy] = normalize2(previous[0] - current[0], previous[1] - current[1]);
    const [vx, vy] = normalize2(next[0] - current[0], next[1] - current[1]);
    const cross = ux * vy - uy * vx;
    const dot = Math.max(-1, Math.min(1, ux * vx + uy * vy));
    const interior = Math.acos(dot);

    // Straight or reversed corner: nothing to cut.
    if (!(interior > EPSILON) || Math.abs(Math.PI - interior) < 1e-9 || Math.abs(cross) < EPSILON) {
      output.push(current);
      continue;
    }

    const half = interior / 2;
    const request = amountAt(index);
    if (request <= 0) {
      output.push(current);
      continue;
    }
    const maxLeg = Math.min(edgeLength((index - 1 + count) % count), edgeLength(index)) / 2;
    const leg = kind === 'chamfer'
      ? Math.min(request, maxLeg)
      : Math.min(request / Math.tan(half), maxLeg);
    if (leg <= EPSILON) {
      output.push(current);
      continue;
    }

    const start = [current[0] + ux * leg, current[1] + uy * leg];
    const end = [current[0] + vx * leg, current[1] + vy * leg];
    if (kind === 'chamfer') {
      output.push(start, end);
      continue;
    }

    const radius = leg * Math.tan(half);
    const [bx, by] = normalize2(ux + vx, uy + vy);
    const centreDistance = radius / Math.sin(half);
    const centre = [current[0] + bx * centreDistance, current[1] + by * centreDistance];
    const startAngle = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
    const endAngle = Math.atan2(end[1] - centre[1], end[0] - centre[0]);
    let sweep = endAngle - startAngle;
    // Take the minor arc, signed to follow the corner's turn direction.
    while (sweep <= -Math.PI) sweep += TAU;
    while (sweep > Math.PI) sweep -= TAU;
    for (let step = 0; step <= arcSegments; step++) {
      const angle = startAngle + (sweep * step) / arcSegments;
      output.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]);
    }
  }
  return cleanRing(output);
}

/** Convenience wrappers matching the CAD verbs. */
export function filletRing(ring, radius, segments = 4) {
  return treatRingCorners(ring, radius, { kind: 'fillet', segments });
}

export function chamferRing(ring, distance) {
  return treatRingCorners(ring, distance, { kind: 'chamfer' });
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

/**
 * Ear-clipping triangulation of one simple CCW ring.
 * Returns index triples into `ring`.
 */
export function triangulateRing(ring) {
  const count = ring.length;
  if (count < 3) return [];
  const indices = Array.from({ length: count }, (_, index) => index);
  const triangles = [];
  let guard = 0;
  const limit = count * count + 16;

  while (indices.length > 3 && guard++ < limit) {
    let clipped = false;
    for (let position = 0; position < indices.length; position++) {
      const previous = indices[(position - 1 + indices.length) % indices.length];
      const current = indices[position];
      const next = indices[(position + 1) % indices.length];
      const [ax, ay] = ring[previous];
      const [bx, by] = ring[current];
      const [cx, cy] = ring[next];
      // Convex test for a CCW ring.
      if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= EPSILON) continue;
      let contains = false;
      for (const other of indices) {
        if (other === previous || other === current || other === next) continue;
        const [px, py] = ring[other];
        if (pointInTriangle(px, py, ax, ay, bx, by, cx, cy)) { contains = true; break; }
      }
      if (contains) continue;
      triangles.push([previous, current, next]);
      indices.splice(position, 1);
      clipped = true;
      break;
    }
    // Degenerate remainder (self-touching ring): stop rather than emit garbage.
    if (!clipped) break;
  }
  if (indices.length === 3) triangles.push([indices[0], indices[1], indices[2]]);
  return triangles;
}

/**
 * Triangulate the annular band between two matched concentric rings.
 *
 * Generated tube/washer/pipe profiles always come in matched ring pairs, so this
 * avoids a general hole-bridging pass while still producing exact caps. Both
 * rings must share a vertex count; the inner ring is expected clockwise.
 */
export function triangulateRingPair(outer, inner) {
  if (outer.length !== inner.length) {
    throw new Error('Profile2D: ring-pair caps need matching vertex counts');
  }
  const count = outer.length;
  const triangles = [];
  // The hole ring is stored clockwise while the outer ring is counter-clockwise,
  // so slot j of the outer ring corresponds to slot (count - j) of the inner one.
  // Pairing by raw index instead would tile the band with a twist.
  const innerAt = slot => count + ((count - (slot % count)) % count);
  for (let index = 0; index < count; index++) {
    const nextIndex = (index + 1) % count;
    triangles.push(
      [index, nextIndex, innerAt(nextIndex)],
      [index, innerAt(nextIndex), innerAt(index)],
    );
  }
  return triangles;
}

// ---------------------------------------------------------------------------
// Standard profile builders. Each returns a normalised profile.
// ---------------------------------------------------------------------------

export function rectangleProfile(width, height) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return makeProfile([
    [-halfWidth, -halfHeight], [halfWidth, -halfHeight],
    [halfWidth, halfHeight], [-halfWidth, halfHeight],
  ]);
}

/** Rectangle with filleted or chamfered corners — the eased-edge stud profile. */
export function roundedRectangleProfile(width, height, radius, { kind = 'fillet', segments = 4 } = {}) {
  return makeProfile(treatRingCorners(rectangleProfile(width, height).outer, radius, { kind, segments }));
}

export function circleProfile(radius, segments = 24) {
  const count = Math.max(3, Math.floor(segments));
  const ring = [];
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * TAU;
    ring.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return makeProfile(ring);
}

export function ellipseProfile(radiusX, radiusY, segments = 32) {
  const count = Math.max(3, Math.floor(segments));
  const ring = [];
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * TAU;
    ring.push([Math.cos(angle) * radiusX, Math.sin(angle) * radiusY]);
  }
  return makeProfile(ring);
}

export function regularPolygonProfile(radius, sides) {
  const count = Math.max(3, Math.floor(sides));
  const ring = [];
  for (let index = 0; index < count; index++) {
    // Flat-bottom orientation so hex nuts and prisms read naturally.
    const angle = (index / count) * TAU + Math.PI / 2 + Math.PI / count;
    ring.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return makeProfile(ring);
}

/** Obround slot: two semicircular ends joined by straights. */
export function slotProfile(length, width, segments = 8) {
  const radius = width / 2;
  const straight = Math.max(0, length / 2 - radius);
  const count = Math.max(2, Math.floor(segments));
  const ring = [];
  for (let index = 0; index <= count; index++) {
    const angle = -Math.PI / 2 + (index / count) * Math.PI;
    ring.push([straight + Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  for (let index = 0; index <= count; index++) {
    const angle = Math.PI / 2 + (index / count) * Math.PI;
    ring.push([-straight + Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return makeProfile(ring);
}

/** Tube / pipe / washer as a matched concentric ring pair. */
export function annulusProfile(outerRadius, innerRadius, segments = 24) {
  if (!(innerRadius > 0) || innerRadius >= outerRadius) {
    throw new Error('Profile2D: annulus needs 0 < innerRadius < outerRadius');
  }
  const outer = circleProfile(outerRadius, segments).outer;
  const inner = circleProfile(innerRadius, segments).outer;
  return makeProfile(outer, [inner]);
}

/** Symmetric I-beam / wide-flange section. */
export function iBeamProfile(height, flangeWidth, webThickness, flangeThickness) {
  const halfHeight = height / 2;
  const halfFlange = flangeWidth / 2;
  const halfWeb = webThickness / 2;
  const innerY = halfHeight - flangeThickness;
  return makeProfile([
    [-halfFlange, -halfHeight], [halfFlange, -halfHeight],
    [halfFlange, -innerY], [halfWeb, -innerY],
    [halfWeb, innerY], [halfFlange, innerY],
    [halfFlange, halfHeight], [-halfFlange, halfHeight],
    [-halfFlange, innerY], [-halfWeb, innerY],
    [-halfWeb, -innerY], [-halfFlange, -innerY],
  ]);
}

/** C / channel section, opening toward +X. */
export function channelProfile(height, flangeWidth, webThickness, flangeThickness) {
  const halfHeight = height / 2;
  const innerY = halfHeight - flangeThickness;
  return makeProfile([
    [0, -halfHeight], [flangeWidth, -halfHeight],
    [flangeWidth, -innerY], [webThickness, -innerY],
    [webThickness, innerY], [flangeWidth, innerY],
    [flangeWidth, halfHeight], [0, halfHeight],
  ]);
}

/** Equal or unequal L / angle section. */
export function angleProfile(legX, legY, thickness) {
  return makeProfile([
    [0, 0], [legX, 0], [legX, thickness],
    [thickness, thickness], [thickness, legY], [0, legY],
  ]);
}

/** T section with the stem pointing -Y. */
export function teeProfile(flangeWidth, height, webThickness, flangeThickness) {
  const halfFlange = flangeWidth / 2;
  const halfWeb = webThickness / 2;
  const topY = height / 2;
  const flangeBottom = topY - flangeThickness;
  return makeProfile([
    [-halfWeb, -topY], [halfWeb, -topY], [halfWeb, flangeBottom],
    [halfFlange, flangeBottom], [halfFlange, topY],
    [-halfFlange, topY], [-halfFlange, flangeBottom], [-halfWeb, flangeBottom],
  ]);
}

/** Right-triangle wedge/ramp cross-section. */
export function wedgeProfile(width, height) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return makeProfile([
    [-halfWidth, -halfHeight], [halfWidth, -halfHeight], [-halfWidth, halfHeight],
  ]);
}

/** Stepped stair cross-section; extrude along the run width. */
export function stairsProfile(steps, totalRise, totalRun) {
  const count = Math.max(1, Math.floor(steps));
  const rise = totalRise / count;
  const run = totalRun / count;
  const ring = [[0, 0]];
  for (let index = 0; index < count; index++) {
    ring.push([index * run, (index + 1) * rise]);
    ring.push([(index + 1) * run, (index + 1) * rise]);
  }
  ring.push([totalRun, 0]);
  return makeProfile(ring);
}

/** Every profile kind addressable from a declarative spec. */
export const PROFILE_KINDS = Object.freeze({
  rectangle: ['width', 'height'],
  'rounded-rectangle': ['width', 'height', 'radius'],
  circle: ['radius'],
  ellipse: ['radiusX', 'radiusY'],
  'regular-polygon': ['radius', 'sides'],
  polygon: ['points'],
  slot: ['length', 'width'],
  annulus: ['outerRadius', 'innerRadius'],
  'i-beam': ['height', 'flangeWidth', 'webThickness', 'flangeThickness'],
  channel: ['height', 'flangeWidth', 'webThickness', 'flangeThickness'],
  angle: ['legX', 'legY', 'thickness'],
  tee: ['flangeWidth', 'height', 'webThickness', 'flangeThickness'],
  wedge: ['width', 'height'],
  stairs: ['steps', 'totalRise', 'totalRun'],
});

/**
 * Build a profile from a declarative spec, then optionally treat its corners.
 *
 * This is the single entry point used by the ForgeSource `extrude` and `revolve`
 * primitives, so the same vocabulary is available to authored documents and to
 * generated stock products.
 *
 * @param {object} spec `{ kind, ...dimensions, edge?: { kind, amount, segments } }`
 */
export function profileFromSpec(spec) {
  const kind = String(spec?.kind ?? '');
  const segments = Math.max(3, Math.floor(Number(spec?.segments) || 24));
  const number = (field, fallback) => {
    const value = Number(spec?.[field]);
    if (!Number.isFinite(value)) {
      if (fallback === undefined) throw new Error(`Profile2D: '${kind}' requires numeric '${field}'`);
      return fallback;
    }
    return value;
  };
  let profile;
  switch (kind) {
    case 'rectangle':
      profile = rectangleProfile(number('width'), number('height'));
      break;
    case 'rounded-rectangle':
      profile = roundedRectangleProfile(number('width'), number('height'), number('radius'), {
        kind: spec?.cornerKind === 'chamfer' ? 'chamfer' : 'fillet',
        segments: Math.max(1, Math.floor(Number(spec?.cornerSegments) || 4)),
      });
      break;
    case 'circle':
      profile = circleProfile(number('radius'), segments);
      break;
    case 'ellipse':
      profile = ellipseProfile(number('radiusX'), number('radiusY'), segments);
      break;
    case 'regular-polygon':
      profile = regularPolygonProfile(number('radius'), number('sides'));
      break;
    case 'polygon':
      if (!Array.isArray(spec?.points)) throw new Error("Profile2D: 'polygon' requires a points array");
      profile = makeProfile(spec.points.map(point => [Number(point[0]), Number(point[1])]));
      break;
    case 'slot':
      profile = slotProfile(number('length'), number('width'), Math.max(2, Math.floor(Number(spec?.endSegments) || 8)));
      break;
    case 'annulus':
      profile = annulusProfile(number('outerRadius'), number('innerRadius'), segments);
      break;
    case 'i-beam':
      profile = iBeamProfile(number('height'), number('flangeWidth'), number('webThickness'), number('flangeThickness'));
      break;
    case 'channel':
      profile = channelProfile(number('height'), number('flangeWidth'), number('webThickness'), number('flangeThickness'));
      break;
    case 'angle':
      profile = angleProfile(number('legX'), number('legY'), number('thickness'));
      break;
    case 'tee':
      profile = teeProfile(number('flangeWidth'), number('height'), number('webThickness'), number('flangeThickness'));
      break;
    case 'wedge':
      profile = wedgeProfile(number('width'), number('height'));
      break;
    case 'stairs':
      profile = stairsProfile(number('steps'), number('totalRise'), number('totalRun'));
      break;
    default:
      throw new Error(`Profile2D: unknown profile kind '${kind}'`);
  }

  // Optional global edge treatment, applied to the outer ring only. Holes keep
  // their generated form so matched ring-pair caps stay valid.
  const edge = spec?.edge;
  if (edge && Number(edge.amount) > 0) {
    const treated = treatRingCorners(profile.outer, Number(edge.amount), {
      kind: edge.kind === 'chamfer' ? 'chamfer' : 'fillet',
      segments: Math.max(1, Math.floor(Number(edge.segments) || 4)),
    });
    profile = makeProfile(treated, profile.holes);
  }
  return profile;
}

export default makeProfile;
