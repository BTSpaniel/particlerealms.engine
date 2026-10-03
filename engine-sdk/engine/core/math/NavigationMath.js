// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * NavigationMath.js - pure navigation corridor, path, area-cost, and steering reports.
 */

import { clamp, finiteNumber, safeDiv } from './MathScalar.js';
import { pointInPolygon2D } from './MathGeometry.js';

const DEFAULT_REF_BITS = Object.freeze({ saltBits: 8, tileBits: 14, polyBits: 10 });
const EPSILON = 1e-6;

function readFinite(value, fallback = 0) {
  return finiteNumber(value, fallback);
}

function readNonNegative(value, fallback = 0) {
  const number = readFinite(value, fallback);
  return number >= 0 ? number : fallback;
}

function readPositive(value, fallback = 1) {
  const number = readFinite(value, fallback);
  return number > 0 ? number : fallback;
}

function integerInRange(value, name, min, max) {
  const number = Math.trunc(readFinite(value, Number.NaN));
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return number;
}

function freezeList(values) {
  return Object.freeze(values.map((value) => Object.freeze(value)));
}

function samePoint(a, b, epsilon = EPSILON) {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.z - b.z) <= epsilon;
}

function area2(a, b, c) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function normalizeWaypointList(waypoints, options = {}) {
  return Array.from(waypoints ?? [], (point) => navPoint2(point, options));
}

function pointFromPortalSide(portal, side, fallback, options = {}) {
  if (Array.isArray(portal) && portal.length >= 2) {
    return navPoint2(side === 'left' ? portal[0] : portal[1], options);
  }
  if (portal?.[side]) {
    return navPoint2(portal[side], options);
  }
  if (portal?.point) {
    return navPoint2(portal.point, options);
  }
  return navPoint2(fallback ?? portal, options);
}

function nearestPointOnSegment(point, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq <= EPSILON) return { ...a, t: 0 };
  const t = clamp(((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq, 0, 1);
  return {
    x: a.x + abx * t,
    z: a.z + abz * t,
    t,
  };
}

function pointInPolygon(point, vertices) { return pointInPolygon2D([point.x, point.z], vertices.map(p => [p.x, p.z])); }

function areaCostFromOptions(area, options = {}) {
  const table = options.areaCosts ?? options.costs;
  const key = String(area ?? 0);
  if (table instanceof Map && Number.isFinite(table.get(area))) return readPositive(table.get(area), 1);
  if (table && Number.isFinite(table[key])) return readPositive(table[key], 1);
  if (Number.isFinite(options.areaCost)) return readPositive(options.areaCost, 1);
  return 1;
}

function bitConfig(options = {}) {
  const saltBits = integerInRange(options.saltBits ?? DEFAULT_REF_BITS.saltBits, 'saltBits', 1, 30);
  const tileBits = integerInRange(options.tileBits ?? DEFAULT_REF_BITS.tileBits, 'tileBits', 1, 30);
  const polyBits = integerInRange(options.polyBits ?? DEFAULT_REF_BITS.polyBits, 'polyBits', 1, 30);
  if (saltBits + tileBits + polyBits > 52) {
    throw new RangeError('saltBits + tileBits + polyBits must fit in a safe integer');
  }
  return { saltBits, tileBits, polyBits };
}

export function navPoint2(point, options = {}) {
  if (Array.isArray(point) || ArrayBuffer.isView(point)) {
    const zIndex = point.length >= 3 && options.arrayZIndex !== 1 ? 2 : 1;
    return {
      x: readFinite(point[0], 0),
      z: readFinite(point[zIndex], 0),
    };
  }
  return {
    x: readFinite(point?.x, 0),
    z: readFinite(point?.z ?? point?.y, 0),
  };
}

export function navDistance2D(a, b, options = {}) {
  const pa = navPoint2(a, options);
  const pb = navPoint2(b, options);
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  return Math.hypot(dx, dz);
}

export function navPathLength(waypoints = [], options = {}) {
  const points = normalizeWaypointList(waypoints, options);
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += navDistance2D(points[i - 1], points[i]);
  }
  return length;
}

export function navPortalReport(portal, options = {}) {
  const left = pointFromPortalSide(portal, 'left', portal?.right, options);
  const right = pointFromPortalSide(portal, 'right', portal?.left, options);
  const width = navDistance2D(left, right);
  return {
    schema: 'particle-realms.nav-portal.v1',
    left,
    right,
    midpoint: Object.freeze({
      x: (left.x + right.x) * 0.5,
      z: (left.z + right.z) * 0.5,
    }),
    width,
    degenerate: width <= readPositive(options.epsilon, EPSILON),
  };
}

export function navStringPull(portals = [], options = {}) {
  const normalized = Array.from(portals ?? [], (portal) => navPortalReport(portal, options));
  if (normalized.length === 0) {
    return {
      schema: 'particle-realms.nav-string-pull.v1',
      valid: false,
      portalCount: 0,
      waypoints: Object.freeze([]),
      length: 0,
      tightened: false,
    };
  }

  let apex = normalized[0].left;
  let left = normalized[0].left;
  let right = normalized[0].right;
  let apexIndex = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  const waypoints = [{ ...apex }];

  for (let i = 1; i < normalized.length; i++) {
    const nextLeft = normalized[i].left;
    const nextRight = normalized[i].right;

    if (area2(apex, right, nextRight) <= EPSILON) {
      if (samePoint(apex, right) || area2(apex, left, nextRight) > EPSILON) {
        right = nextRight;
        rightIndex = i;
      } else {
        waypoints.push({ ...left });
        apex = left;
        apexIndex = leftIndex;
        left = apex;
        right = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        i = apexIndex;
        continue;
      }
    }

    if (area2(apex, left, nextLeft) >= -EPSILON) {
      if (samePoint(apex, left) || area2(apex, right, nextLeft) < -EPSILON) {
        left = nextLeft;
        leftIndex = i;
      } else {
        waypoints.push({ ...right });
        apex = right;
        apexIndex = rightIndex;
        left = apex;
        right = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        i = apexIndex;
      }
    }
  }

  const end = normalized[normalized.length - 1].midpoint;
  if (!samePoint(waypoints[waypoints.length - 1], end)) {
    waypoints.push({ ...end });
  }

  return {
    schema: 'particle-realms.nav-string-pull.v1',
    valid: true,
    portalCount: normalized.length,
    waypointCount: waypoints.length,
    waypoints: freezeList(waypoints),
    length: navPathLength(waypoints),
    directLength: navDistance2D(waypoints[0], waypoints[waypoints.length - 1]),
    tightened: waypoints.length < normalized.length,
  };
}

export function navPathCorridorReport(portals = [], options = {}) {
  const pulled = navStringPull(portals, options);
  const portalReports = Array.from(portals ?? [], (portal) => navPortalReport(portal, options));
  const averagePortalWidth = safeDiv(
    portalReports.reduce((sum, portal) => sum + portal.width, 0),
    portalReports.length,
    0
  );
  return {
    schema: 'particle-realms.nav-path-corridor.v1',
    valid: pulled.valid,
    portalCount: portalReports.length,
    waypointCount: pulled.waypointCount ?? 0,
    averagePortalWidth,
    minPortalWidth: portalReports.reduce((min, portal) => Math.min(min, portal.width), Infinity),
    maxPortalWidth: portalReports.reduce((max, portal) => Math.max(max, portal.width), 0),
    pathLength: pulled.length,
    directLength: pulled.directLength ?? 0,
    straightnessRatio: pulled.length > 0 ? safeDiv(pulled.directLength, pulled.length, 0) : 1,
    stringPull: pulled,
  };
}

export function navAreaTraversalCost(distance, area = 0, options = {}) {
  const length = readNonNegative(distance, 0);
  const costScale = areaCostFromOptions(area, options);
  const flags = Number.isFinite(options.flags) ? Math.trunc(options.flags) : 0;
  const includeFlags = Number.isFinite(options.includeFlags) ? Math.trunc(options.includeFlags) : null;
  const excludeFlags = Number.isFinite(options.excludeFlags) ? Math.trunc(options.excludeFlags) : 0;
  const included = includeFlags === null || (flags & includeFlags) !== 0;
  const excluded = excludeFlags !== 0 && (flags & excludeFlags) !== 0;
  const passable = included && !excluded;
  return {
    schema: 'particle-realms.nav-area-traversal-cost.v1',
    distance: length,
    area,
    flags,
    costScale,
    passable,
    cost: passable ? length * costScale : Infinity,
  };
}

export function navNearestPolyScore(point, polygon, options = {}) {
  const target = navPoint2(point, options);
  const vertices = normalizeWaypointList(polygon?.vertices ?? polygon, options);
  if (vertices.length === 0) {
    return {
      schema: 'particle-realms.nav-nearest-poly-score.v1',
      valid: false,
      distance: Infinity,
      distanceSq: Infinity,
      score: Infinity,
      nearestPoint: Object.freeze({ x: 0, z: 0 }),
      inside: false,
    };
  }

  const inside = vertices.length >= 3 && pointInPolygon(target, vertices);
  let nearest = inside ? target : vertices[0];
  let distanceSq = inside ? 0 : Infinity;

  if (!inside) {
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const candidate = nearestPointOnSegment(target, a, b);
      const dx = target.x - candidate.x;
      const dz = target.z - candidate.z;
      const candidateDistanceSq = dx * dx + dz * dz;
      if (candidateDistanceSq < distanceSq) {
        distanceSq = candidateDistanceSq;
        nearest = candidate;
      }
    }
  }

  const distance = Math.sqrt(distanceSq);
  const area = polygon?.area ?? polygon?.areaId ?? 0;
  const costScale = areaCostFromOptions(area, options);
  return {
    schema: 'particle-realms.nav-nearest-poly-score.v1',
    valid: true,
    area,
    costScale,
    inside,
    nearestPoint: Object.freeze({ x: nearest.x, z: nearest.z }),
    distance,
    distanceSq,
    score: distance * costScale,
  };
}

export function navPackPolyRef(ref = {}, options = {}) {
  const bits = bitConfig(options);
  const saltMax = 2 ** bits.saltBits - 1;
  const tileMax = 2 ** bits.tileBits - 1;
  const polyMax = 2 ** bits.polyBits - 1;
  const salt = integerInRange(ref.salt ?? 0, 'salt', 0, saltMax);
  const tile = integerInRange(ref.tile ?? ref.tileIndex ?? 0, 'tile', 0, tileMax);
  const poly = integerInRange(ref.poly ?? ref.polyIndex ?? 0, 'poly', 0, polyMax);
  const tileBase = 2 ** bits.polyBits;
  const saltBase = 2 ** (bits.tileBits + bits.polyBits);
  const value = salt * saltBase + tile * tileBase + poly;
  return {
    schema: 'particle-realms.nav-poly-ref.v1',
    value,
    salt,
    tile,
    poly,
    ...bits,
  };
}

export function navUnpackPolyRef(value, options = {}) {
  const bits = bitConfig(options);
  const maxValue = 2 ** (bits.saltBits + bits.tileBits + bits.polyBits) - 1;
  let remaining = integerInRange(value, 'value', 0, maxValue);
  const polyBase = 2 ** bits.polyBits;
  const tileBase = 2 ** bits.tileBits;
  const poly = remaining % polyBase;
  remaining = Math.floor(remaining / polyBase);
  const tile = remaining % tileBase;
  const salt = Math.floor(remaining / tileBase);
  return {
    schema: 'particle-realms.nav-poly-ref.v1',
    value: Math.trunc(value),
    salt,
    tile,
    poly,
    ...bits,
  };
}

export function navSmoothPath(waypoints = [], smoothing = 0.5, options = {}) {
  const points = normalizeWaypointList(waypoints, options);
  if (points.length <= 2) return freezeList(points);
  const amount = clamp(readFinite(smoothing, 0.5), 0, 1);
  const result = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    result.push({
      x: curr.x + amount * ((prev.x + next.x) * 0.5 - curr.x),
      z: curr.z + amount * ((prev.z + next.z) * 0.5 - curr.z),
    });
  }
  result.push({ ...points[points.length - 1] });
  return freezeList(result);
}

export function navSteeringTargetReport(currentPosition, waypoints = [], options = {}) {
  const current = navPoint2(currentPosition, options);
  const points = normalizeWaypointList(waypoints, options);
  if (points.length === 0) {
    return {
      schema: 'particle-realms.nav-steering-target.v1',
      arrived: true,
      targetWaypoint: -1,
      target: null,
      direction: Object.freeze({ x: 0, z: 0 }),
      distance: 0,
    };
  }

  const lookahead = readNonNegative(options.lookahead, 1);
  let targetWaypoint = 0;
  let minDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const distance = navDistance2D(current, points[i]);
    if (distance < minDistance) {
      minDistance = distance;
      targetWaypoint = i;
    }
  }

  if (minDistance < lookahead && targetWaypoint < points.length - 1) {
    targetWaypoint += 1;
  }

  const target = points[targetWaypoint];
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  const distance = Math.hypot(dx, dz);
  const arrivalDistance = readNonNegative(options.arrivalDistance, 0.01);
  const arrived = distance <= arrivalDistance && targetWaypoint >= points.length - 1;
  return {
    schema: 'particle-realms.nav-steering-target.v1',
    arrived,
    targetWaypoint,
    target: Object.freeze({ ...target }),
    direction: Object.freeze({
      x: distance > EPSILON ? dx / distance : 0,
      z: distance > EPSILON ? dz / distance : 0,
    }),
    distance,
    nearestDistance: minDistance,
  };
}
