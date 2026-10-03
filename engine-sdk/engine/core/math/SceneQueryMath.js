// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// SceneQueryMath.js - pure ray/overlap/sweep query reports for engine callers.

import { EPSILON } from './MathConstants.js';
import { aabbCenter, aabbHalfSize } from './MathGeometry.js';
import { clamp } from './MathScalar.js';
import { vec3Add, vec3IsFinite, vec3Length, vec3Scale, vec3Sub } from './MathVec3.js';

const AXES = ['x', 'y', 'z'];

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteBound(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) || number === Infinity ? number : fallback;
}

function mask32(value, fallback = 0xffffffff) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) >>> 0 : fallback >>> 0;
}

function vec3From(value, fallback = [0, 0, 0]) {
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    return [
      finiteNumber(value[0], fallback[0]),
      finiteNumber(value[1], fallback[1]),
      finiteNumber(value[2], fallback[2]),
    ];
  }
  if (value && typeof value === 'object') {
    return [
      finiteNumber(value.x ?? value[0], fallback[0]),
      finiteNumber(value.y ?? value[1], fallback[1]),
      finiteNumber(value.z ?? value[2], fallback[2]),
    ];
  }
  return [...fallback];
}

function vec3Normalize(v, fallback = [0, 1, 0]) {
  const length = vec3Length(v);
  return length > EPSILON && Number.isFinite(length) ? vec3Scale(v, 1 / length) : [...fallback];
}

function aabbFromBounds(minValue, maxValue) {
  const min = vec3From(minValue);
  const max = vec3From(maxValue);
  const normalizedMin = [
    Math.min(min[0], max[0]),
    Math.min(min[1], max[1]),
    Math.min(min[2], max[2]),
  ];
  const normalizedMax = [
    Math.max(min[0], max[0]),
    Math.max(min[1], max[1]),
    Math.max(min[2], max[2]),
  ];
  const aabb = { min: normalizedMin, max: normalizedMax, center: null, extent: null, valid: false };
  aabb.center = aabbCenter(aabb);
  aabb.extent = aabbHalfSize(aabb);
  aabb.valid = vec3IsFinite(normalizedMin) && vec3IsFinite(normalizedMax);
  return aabb;
}

function aabbVolume(aabb) {
  const size = vec3Sub(aabb.max, aabb.min);
  return Math.max(0, size[0]) * Math.max(0, size[1]) * Math.max(0, size[2]);
}

export function sceneQueryHitReport(hit, options = {}) {
  const maxDistance = finiteBound(options.maxDistance, Infinity);
  const minDistance = Math.max(0, finiteNumber(options.minDistance, 0));
  const fraction = Number(hit?.fraction ?? hit?.time ?? hit?.toi);
  const distance = Number.isFinite(hit?.distance)
    ? Number(hit.distance)
    : Number.isFinite(hit?.t)
      ? Number(hit.t)
      : Number.isFinite(fraction) && Number.isFinite(maxDistance)
        ? fraction * maxDistance
        : Number.NaN;
  const hasPoint = hit?.point !== undefined || hit?.position !== undefined || hit?.impact !== undefined;
  const hasNormal = hit?.normal !== undefined;
  const point = hasPoint ? vec3From(hit.point ?? hit.position ?? hit.impact) : null;
  const normal = hasNormal ? sceneQueryContactNormalReport(hit.normal, { requireUnit: false }).normal : null;
  const validDistance = Number.isFinite(distance) && distance >= minDistance && distance <= maxDistance;
  const validPoint = !hasPoint || vec3IsFinite(point);
  const validNormal = !hasNormal || sceneQueryContactNormalReport(hit.normal, { requireUnit: false }).valid;
  const valid = Boolean(hit) && validDistance && validPoint && validNormal;

  return {
    valid,
    distance,
    t: distance,
    fraction: Number.isFinite(fraction) ? fraction : null,
    point,
    normal,
    objectId: hit?.objectId ?? hit?.entityId ?? hit?.id ?? null,
    faceIndex: Number.isInteger(hit?.faceIndex) ? hit.faceIndex : null,
    blocking: hit?.blocking !== false && hit?.block !== false,
    sourceIndex: Number.isInteger(options.sourceIndex) ? options.sourceIndex : -1,
  };
}

export function sceneQueryHitListReport(hits, options = {}) {
  const arrayLike = hits && typeof hits.length === 'number';
  const maxHits = Math.max(0, Math.trunc(finiteNumber(options.maxHits, Infinity)));
  const normalized = [];
  const invalid = [];

  if (arrayLike) {
    for (let i = 0; i < hits.length; i += 1) {
      const report = sceneQueryHitReport(hits[i], { ...options, sourceIndex: i });
      if (report.valid) normalized.push(report);
      else invalid.push(report);
    }
  }

  normalized.sort((a, b) => a.distance - b.distance || a.sourceIndex - b.sourceIndex);
  const selected = maxHits === 0 ? [] : normalized.slice(0, maxHits);
  const blockingHit = selected.find((hit) => hit.blocking) ?? null;

  return {
    valid: arrayLike,
    inputCount: arrayLike ? hits.length : 0,
    hitCount: normalized.length,
    selectedCount: selected.length,
    invalidCount: invalid.length,
    anyHit: normalized.length > 0,
    closest: selected[0] ?? null,
    blockingHit,
    hits: selected,
    invalidHits: invalid,
  };
}

export function sceneQueryFilterReport(query = {}, target = {}, options = {}) {
  const queryMask = mask32(query.queryMask ?? query.mask ?? options.queryMask);
  const objectMask = mask32(target.objectMask ?? target.mask ?? target.collisionMask);
  const includeMask = mask32(query.includeMask ?? options.includeMask);
  const excludeMask = mask32(query.excludeMask ?? options.excludeMask, 0);
  const enabled = query.enabled !== false && target.enabled !== false && target.queryEnabled !== false;
  const maskMatch = (queryMask & objectMask & includeMask) !== 0;
  const excluded = (objectMask & excludeMask) !== 0;
  const queryChannel = query.channel ?? options.channel ?? null;
  const targetChannel = target.channel ?? null;
  const channelMatch = queryChannel === null || targetChannel === null || queryChannel === targetChannel;
  const accepted = enabled && maskMatch && !excluded && channelMatch;

  return {
    accepted,
    enabled,
    queryMask,
    objectMask,
    includeMask,
    excludeMask,
    maskMatch,
    excluded,
    queryChannel,
    targetChannel,
    channelMatch,
  };
}

export function sceneQuerySweptAabbReport(movingMin, movingMax, staticMin, staticMax, delta, options = {}) {
  const moving = aabbFromBounds(movingMin, movingMax);
  const target = aabbFromBounds(staticMin, staticMax);
  const motion = vec3From(delta);
  const maxTime = Math.max(0, finiteNumber(options.maxTime, 1));
  const initial = sceneQueryAabbOverlapReport(moving.min, moving.max, target.min, target.max);
  const entryTimes = [-Infinity, -Infinity, -Infinity];
  const exitTimes = [Infinity, Infinity, Infinity];
  let separatingAxis = -1;
  let entryTime = -Infinity;
  let exitTime = Infinity;
  let hitNormal = [0, 1, 0];
  let possible = moving.valid && target.valid && vec3IsFinite(motion);

  for (let axis = 0; axis < 3; axis += 1) {
    const velocity = motion[axis];
    if (Math.abs(velocity) <= EPSILON) {
      const separated = moving.max[axis] < target.min[axis] || moving.min[axis] > target.max[axis];
      if (separated) possible = false;
      continue;
    }
    const entering = velocity > 0
      ? (target.min[axis] - moving.max[axis]) / velocity
      : (target.max[axis] - moving.min[axis]) / velocity;
    const exiting = velocity > 0
      ? (target.max[axis] - moving.min[axis]) / velocity
      : (target.min[axis] - moving.max[axis]) / velocity;
    entryTimes[axis] = entering;
    exitTimes[axis] = exiting;
    if (entering > entryTime) {
      entryTime = entering;
      separatingAxis = axis;
      hitNormal = [0, 0, 0];
      hitNormal[axis] = velocity > 0 ? -1 : 1;
    }
    exitTime = Math.min(exitTime, exiting);
  }

  if (initial.overlapping) {
    entryTime = 0;
    hitNormal = initial.normal;
  }

  const hit = possible && entryTime <= exitTime && exitTime >= 0 && entryTime <= maxTime;
  const time = hit ? clamp(Math.max(0, entryTime), 0, maxTime) : null;

  return {
    valid: moving.valid && target.valid && vec3IsFinite(motion),
    hit,
    initialOverlap: initial.overlapping,
    time,
    entryTime,
    exitTime,
    maxTime,
    normal: hit ? hitNormal : [0, 0, 0],
    entryTimes,
    exitTimes,
    separatingAxis: separatingAxis >= 0 ? AXES[separatingAxis] : null,
    motion,
  };
}

export function sceneQueryAabbOverlapReport(aMin, aMax, bMin, bMax, options = {}) {
  const a = aabbFromBounds(aMin, aMax);
  const b = aabbFromBounds(bMin, bMax);
  const tolerance = Math.max(0, finiteNumber(options.tolerance, 0));
  const includeTouch = options.includeTouch !== false;
  const overlap = [0, 0, 0];
  const gap = [0, 0, 0];
  let overlapping = a.valid && b.valid;

  for (let axis = 0; axis < 3; axis += 1) {
    overlap[axis] = Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
    gap[axis] = Math.max(a.min[axis] - b.max[axis], b.min[axis] - a.max[axis], 0);
    const axisOverlaps = includeTouch ? overlap[axis] >= -tolerance : overlap[axis] > tolerance;
    overlapping = overlapping && axisOverlaps;
  }

  const centerDelta = vec3Sub(b.center, a.center);
  const separationDistance = vec3Length(gap);
  let axisIndex = 0;
  if (overlapping) {
    if (overlap[1] < overlap[axisIndex]) axisIndex = 1;
    if (overlap[2] < overlap[axisIndex]) axisIndex = 2;
  } else {
    if (gap[1] > gap[axisIndex]) axisIndex = 1;
    if (gap[2] > gap[axisIndex]) axisIndex = 2;
  }
  const normal = [0, 0, 0];
  normal[axisIndex] = centerDelta[axisIndex] >= 0 ? 1 : -1;

  return {
    valid: a.valid && b.valid,
    overlapping,
    includeTouch,
    overlap,
    gap,
    penetrationDepth: overlapping ? Math.max(0, overlap[axisIndex]) : 0,
    separationDistance,
    normal,
    axis: AXES[axisIndex],
    centerDelta,
    aabbA: a,
    aabbB: b,
  };
}

export function sceneQuerySpherePenetrationReport(centerA, radiusA, centerB, radiusB, options = {}) {
  const a = vec3From(centerA);
  const b = vec3From(centerB);
  const rA = Math.max(0, finiteNumber(radiusA, 0));
  const rB = Math.max(0, finiteNumber(radiusB, 0));
  const tolerance = Math.max(0, finiteNumber(options.tolerance, 0));
  const includeTouch = options.includeTouch !== false;
  const delta = vec3Sub(b, a);
  const distance = vec3Length(delta);
  const radiusSum = rA + rB;
  const penetrationDepth = radiusSum - distance;
  const overlapping = includeTouch ? penetrationDepth >= -tolerance : penetrationDepth > tolerance;
  const normal = vec3Normalize(delta, vec3From(options.fallbackNormal, [0, 1, 0]));

  return {
    valid: vec3IsFinite(a) && vec3IsFinite(b) && Number.isFinite(radiusA) && Number.isFinite(radiusB) && rA >= 0 && rB >= 0,
    overlapping,
    includeTouch,
    centerA: a,
    centerB: b,
    radiusA: rA,
    radiusB: rB,
    distance,
    radiusSum,
    penetrationDepth: overlapping ? Math.max(0, penetrationDepth) : 0,
    separationDistance: overlapping ? 0 : Math.max(0, -penetrationDepth),
    normal,
    pointA: vec3Add(a, vec3Scale(normal, rA)),
    pointB: vec3Add(b, vec3Scale(normal, -rB)),
  };
}

export function sceneQueryContactNormalReport(normal, options = {}) {
  const n = vec3From(normal);
  const tolerance = Math.max(0, finiteNumber(options.tolerance, 1e-5));
  const zeroTolerance = Math.max(0, finiteNumber(options.zeroTolerance, EPSILON));
  const requireUnit = options.requireUnit !== false;
  const magnitude = vec3Length(n);
  const unitLengthError = Math.abs(magnitude - 1);
  const finite = vec3IsFinite(n);
  const nonzero = magnitude > zeroTolerance;
  const normalized = finite && nonzero && unitLengthError <= tolerance;
  const normalizedNormal = vec3Normalize(n, vec3From(options.fallbackNormal, [0, 1, 0]));

  return {
    valid: finite && nonzero && (!requireUnit || normalized),
    finite,
    nonzero,
    normal: n,
    normalizedNormal,
    magnitude,
    normalized,
    unitLengthError,
    tolerance,
    zeroTolerance,
    requireUnit,
  };
}

export function sceneQueryConvexRadiusReport(radius, options = {}) {
  const value = Number(radius);
  const min = Math.max(0, finiteNumber(options.min, 0));
  const max = finiteBound(options.max, Infinity);
  const allowZero = options.allowZero !== false;
  const finite = Number.isFinite(value);
  const nonnegative = finite && value >= 0;
  const inRange = finite && value >= min && value <= max;
  const valid = finite && nonnegative && inRange && (allowZero || value > 0);

  return {
    valid,
    radius: finite ? value : 0,
    finite,
    nonnegative,
    min,
    max,
    allowZero,
    inRange,
  };
}

export function sceneQueryBroadphasePairScore(aMin, aMax, bMin, bMax, options = {}) {
  const overlap = sceneQueryAabbOverlapReport(aMin, aMax, bMin, bMax, options);
  const aVolume = aabbVolume(overlap.aabbA);
  const bVolume = aabbVolume(overlap.aabbB);
  const centerDistance = vec3Length(overlap.centerDelta);
  const averageExtent = Math.max(EPSILON, (
    overlap.aabbA.extent[0] + overlap.aabbA.extent[1] + overlap.aabbA.extent[2] +
    overlap.aabbB.extent[0] + overlap.aabbB.extent[1] + overlap.aabbB.extent[2]
  ) / 6);
  const score = overlap.overlapping
    ? 1 + overlap.penetrationDepth / averageExtent
    : 1 / (1 + overlap.separationDistance);

  return {
    valid: overlap.valid,
    score,
    overlapping: overlap.overlapping,
    penetrationDepth: overlap.penetrationDepth,
    separationDistance: overlap.separationDistance,
    centerDistance,
    volumeA: aVolume,
    volumeB: bVolume,
    overlap,
  };
}

export default {
  sceneQueryHitReport,
  sceneQueryHitListReport,
  sceneQueryFilterReport,
  sceneQuerySweptAabbReport,
  sceneQueryAabbOverlapReport,
  sceneQuerySpherePenetrationReport,
  sceneQueryContactNormalReport,
  sceneQueryConvexRadiusReport,
  sceneQueryBroadphasePairScore,
};
