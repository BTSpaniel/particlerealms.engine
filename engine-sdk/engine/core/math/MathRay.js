// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathRay.js - Ray operations (Three.js/Unity parity)
// Ray represented as { origin: [x,y,z], direction: [x,y,z] }
// Consolidates: AIAiming.createRay, MathGeometry.ray*, ScreenRayCaster, Viewport.getPickRay

import { EPSILON } from './MathConstants.js';
import { clamp } from './MathScalar.js';
import {
  vec3Add as v3Add,
  vec3Cross as v3Cross,
  vec3Dot as v3Dot,
  vec3Length as v3Len,
  vec3LengthSq as v3LenSq,
  vec3Max as v3Max,
  vec3Min as v3Min,
  vec3Scale as v3Scale,
  vec3Sub as v3Sub,
} from './MathVec3.js';

// ============================================================================
// VECTOR HELPERS
// ============================================================================

const v3Norm = (v) => { const l = v3Len(v); return l < EPSILON ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l]; };

// ============================================================================
// CREATION
// ============================================================================

export function rayCreate(origin, direction) {
  const dir = v3Norm(direction);
  return { origin: [...origin], direction: dir };
}

export function rayFromPoints(a, b) {
  return rayCreate(a, v3Sub(b, a));
}

export function rayFromScreen(ndcX, ndcY, invViewProj) {
  const m = invViewProj;
  const nearW = m[3] * ndcX + m[7] * ndcY + m[11] * -1 + m[15];
  const nearX = (m[0] * ndcX + m[4] * ndcY + m[8] * -1 + m[12]) / nearW;
  const nearY = (m[1] * ndcX + m[5] * ndcY + m[9] * -1 + m[13]) / nearW;
  const nearZ = (m[2] * ndcX + m[6] * ndcY + m[10] * -1 + m[14]) / nearW;
  const farW = m[3] * ndcX + m[7] * ndcY + m[11] * 1 + m[15];
  const farX = (m[0] * ndcX + m[4] * ndcY + m[8] * 1 + m[12]) / farW;
  const farY = (m[1] * ndcX + m[5] * ndcY + m[9] * 1 + m[13]) / farW;
  const farZ = (m[2] * ndcX + m[6] * ndcY + m[10] * 1 + m[14]) / farW;
  return rayCreate([nearX, nearY, nearZ], [farX - nearX, farY - nearY, farZ - nearZ]);
}

export const rayClone = (ray) => ({ origin: [...ray.origin], direction: [...ray.direction] });

// ============================================================================
// QUERY
// ============================================================================

export const rayAt = (ray, t) => v3Add(ray.origin, v3Scale(ray.direction, t));

export function rayClosestPointToPoint(ray, point) {
  const diff = v3Sub(point, ray.origin);
  const t = Math.max(0, v3Dot(diff, ray.direction));
  return { point: rayAt(ray, t), t };
}

export function rayDistanceToPoint(ray, point) {
  const { point: closest } = rayClosestPointToPoint(ray, point);
  return v3Len(v3Sub(point, closest));
}

export function rayDistanceSqToPoint(ray, point) {
  const { point: closest } = rayClosestPointToPoint(ray, point);
  return v3LenSq(v3Sub(point, closest));
}

export function rayClosestPointToRay(ray1, ray2) {
  const w0 = v3Sub(ray1.origin, ray2.origin);
  const a = v3Dot(ray1.direction, ray1.direction);
  const b = v3Dot(ray1.direction, ray2.direction);
  const c = v3Dot(ray2.direction, ray2.direction);
  const d = v3Dot(ray1.direction, w0);
  const e = v3Dot(ray2.direction, w0);
  const denom = a * c - b * b;
  let s, t;
  if (Math.abs(denom) < EPSILON) {
    s = 0;
    t = e / c;
  } else {
    s = (b * e - c * d) / denom;
    t = (a * e - b * d) / denom;
  }
  s = Math.max(0, s);
  t = Math.max(0, t);
  const p1 = rayAt(ray1, s);
  const p2 = rayAt(ray2, t);
  return { point1: p1, point2: p2, t1: s, t2: t, distance: v3Len(v3Sub(p1, p2)) };
}

// ============================================================================
// INTERSECTION — SPHERE
// ============================================================================

export function rayIntersectSphere(ray, center, radius) {
  const oc = v3Sub(ray.origin, center);
  const b = v3Dot(oc, ray.direction);
  const c = v3Dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  let t = -b - sqrtDisc;
  if (t < 0) t = -b + sqrtDisc;
  if (t < 0) return null;
  const point = rayAt(ray, t);
  const normal = v3Norm(v3Sub(point, center));
  return { t, point, normal };
}

// ============================================================================
// INTERSECTION — AABB (slab method)
// ============================================================================

export function rayIntersectAABB(ray, aabbMin, aabbMax) {
  const invDir = [
    1 / (Math.abs(ray.direction[0]) < EPSILON ? EPSILON : ray.direction[0]),
    1 / (Math.abs(ray.direction[1]) < EPSILON ? EPSILON : ray.direction[1]),
    1 / (Math.abs(ray.direction[2]) < EPSILON ? EPSILON : ray.direction[2]),
  ];
  const t1 = (aabbMin[0] - ray.origin[0]) * invDir[0];
  const t2 = (aabbMax[0] - ray.origin[0]) * invDir[0];
  const t3 = (aabbMin[1] - ray.origin[1]) * invDir[1];
  const t4 = (aabbMax[1] - ray.origin[1]) * invDir[1];
  const t5 = (aabbMin[2] - ray.origin[2]) * invDir[2];
  const t6 = (aabbMax[2] - ray.origin[2]) * invDir[2];
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
  if (tmax < 0 || tmin > tmax) return null;
  const t = tmin < 0 ? tmax : tmin;
  const point = rayAt(ray, t);
  const eps = 0.0001;
  let normal = [0, 0, 0];
  if (Math.abs(point[0] - aabbMin[0]) < eps) normal = [-1, 0, 0];
  else if (Math.abs(point[0] - aabbMax[0]) < eps) normal = [1, 0, 0];
  else if (Math.abs(point[1] - aabbMin[1]) < eps) normal = [0, -1, 0];
  else if (Math.abs(point[1] - aabbMax[1]) < eps) normal = [0, 1, 0];
  else if (Math.abs(point[2] - aabbMin[2]) < eps) normal = [0, 0, -1];
  else normal = [0, 0, 1];
  return { t, point, normal };
}

// ============================================================================
// INTERSECTION — PLANE
// ============================================================================

export function rayIntersectPlane(ray, planeNormal, planeD) {
  const denom = v3Dot(planeNormal, ray.direction);
  if (Math.abs(denom) < EPSILON) return null;
  const t = -(v3Dot(planeNormal, ray.origin) + planeD) / denom;
  if (t < 0) return null;
  return { t, point: rayAt(ray, t), normal: [...planeNormal] };
}

// ============================================================================
// INTERSECTION — TRIANGLE (Möller–Trumbore)
// ============================================================================

export function rayIntersectTriangle(ray, v0, v1, v2) {
  const edge1 = v3Sub(v1, v0);
  const edge2 = v3Sub(v2, v0);
  const h = v3Cross(ray.direction, edge2);
  const a = v3Dot(edge1, h);
  if (Math.abs(a) < EPSILON) return null;
  const f = 1 / a;
  const s = v3Sub(ray.origin, v0);
  const u = f * v3Dot(s, h);
  if (u < 0 || u > 1) return null;
  const q = v3Cross(s, edge1);
  const v = f * v3Dot(ray.direction, q);
  if (v < 0 || u + v > 1) return null;
  const t = f * v3Dot(edge2, q);
  if (t < EPSILON) return null;
  const point = rayAt(ray, t);
  const normal = v3Norm(v3Cross(edge1, edge2));
  return { t, point, normal, u, v };
}

// ============================================================================
// INTERSECTION — CAPSULE
// ============================================================================

export function rayIntersectCapsule(ray, capA, capB, radius) {
  const ab = v3Sub(capB, capA);
  const ao = v3Sub(ray.origin, capA);
  const abDotD = v3Dot(ab, ray.direction);
  const abDotAO = v3Dot(ab, ao);
  const abLenSq = v3Dot(ab, ab);
  const m = abDotD / abLenSq;
  const n = abDotAO / abLenSq;
  const Q = v3Sub(ray.direction, v3Scale(ab, m));
  const R = v3Sub(ao, v3Scale(ab, n));
  const a = v3Dot(Q, Q);
  const b = 2 * v3Dot(Q, R);
  const c = v3Dot(R, R) - radius * radius;
  if (Math.abs(a) < EPSILON) {
    const s1 = rayIntersectSphere(ray, capA, radius);
    const s2 = rayIntersectSphere(ray, capB, radius);
    if (!s1 && !s2) return null;
    if (!s1) return s2;
    if (!s2) return s1;
    return s1.t < s2.t ? s1 : s2;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  let t = (-b - sqrtDisc) / (2 * a);
  if (t < 0) t = (-b + sqrtDisc) / (2 * a);
  if (t < 0) return null;
  const p = rayAt(ray, t);
  const proj = v3Dot(v3Sub(p, capA), ab) / abLenSq;
  if (proj >= 0 && proj <= 1) {
    const axisPoint = v3Add(capA, v3Scale(ab, proj));
    const normal = v3Norm(v3Sub(p, axisPoint));
    return { t, point: p, normal };
  }
  const s1 = rayIntersectSphere(ray, capA, radius);
  const s2 = rayIntersectSphere(ray, capB, radius);
  if (!s1 && !s2) return null;
  if (!s1) return s2;
  if (!s2) return s1;
  return s1.t < s2.t ? s1 : s2;
}

// ============================================================================
// INTERSECTION — OBB (Oriented Bounding Box)
// ============================================================================

export function rayIntersectOBB(ray, boxCenter, boxAxes, halfExtents) {
  const delta = v3Sub(ray.origin, boxCenter);
  let tMin = -Infinity, tMax = Infinity;
  let hitNormal = [0, 1, 0];
  for (let i = 0; i < 3; i++) {
    const axis = boxAxes[i];
    const e = halfExtents[i];
    const o = v3Dot(delta, axis);
    const d = v3Dot(ray.direction, axis);
    if (Math.abs(d) < EPSILON) {
      if (o < -e || o > e) return null;
      continue;
    }
    let t1 = (-e - o) / d;
    let t2 = (e - o) / d;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tMin) { tMin = t1; hitNormal = v3Scale(axis, sign); }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  if (tMin < 0) return null;
  return { t: tMin, point: rayAt(ray, tMin), normal: hitNormal };
}

// ============================================================================
// TRANSFORM
// ============================================================================

export function rayTransformMat4(ray, m) {
  const o = ray.origin;
  const d = ray.direction;
  const newOrigin = [
    m[0]*o[0] + m[4]*o[1] + m[8]*o[2] + m[12],
    m[1]*o[0] + m[5]*o[1] + m[9]*o[2] + m[13],
    m[2]*o[0] + m[6]*o[1] + m[10]*o[2] + m[14],
  ];
  const newDir = v3Norm([
    m[0]*d[0] + m[4]*d[1] + m[8]*d[2],
    m[1]*d[0] + m[5]*d[1] + m[9]*d[2],
    m[2]*d[0] + m[6]*d[1] + m[10]*d[2],
  ]);
  return { origin: newOrigin, direction: newDir };
}

export function rayEquals(a, b, eps = EPSILON) {
  return Math.abs(a.origin[0] - b.origin[0]) < eps &&
    Math.abs(a.origin[1] - b.origin[1]) < eps &&
    Math.abs(a.origin[2] - b.origin[2]) < eps &&
    Math.abs(a.direction[0] - b.direction[0]) < eps &&
    Math.abs(a.direction[1] - b.direction[1]) < eps &&
    Math.abs(a.direction[2] - b.direction[2]) < eps;
}
