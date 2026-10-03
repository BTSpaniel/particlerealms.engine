// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathPlane.js - Plane operations (Three.js/Godot/Unity parity)
// Plane represented as [nx, ny, nz, d] where nx*x + ny*y + nz*z + d = 0
// Consolidates: MeshCutter.Plane, MathGeometry.rayPlane, MathGeometry.sdfPlane

import { EPSILON } from './MathConstants.js';
import {
  vec3Add as v3Add,
  vec3Cross as v3Cross,
  vec3Dot as v3Dot,
  vec3Length as v3Len,
  vec3Lerp as v3Lerp,
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

export const planeCreate = (nx, ny, nz, d) => [nx, ny, nz, d];

export function planeFromPointNormal(point, normal) {
  const n = v3Norm(normal);
  return [n[0], n[1], n[2], -v3Dot(n, point)];
}

export function planeFromPoints(a, b, c) {
  const v1 = v3Sub(b, a);
  const v2 = v3Sub(c, a);
  const n = v3Norm(v3Cross(v1, v2));
  return [n[0], n[1], n[2], -v3Dot(n, a)];
}

export const planeClone = (p) => [p[0], p[1], p[2], p[3]];

export const planeGetNormal = (p) => [p[0], p[1], p[2]];

// ============================================================================
// NORMALIZE
// ============================================================================

export function planeNormalize(p) {
  const len = v3Len(p);
  if (len < EPSILON) return [0, 0, 0, 0];
  const inv = 1 / len;
  return [p[0] * inv, p[1] * inv, p[2] * inv, p[3] * inv];
}

// ============================================================================
// QUERY
// ============================================================================

export const planeDistanceToPoint = (plane, point) =>
  plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3];

export function planeClassifyPoint(plane, point, eps = EPSILON) {
  const d = planeDistanceToPoint(plane, point);
  if (d > eps) return 1;   // Front
  if (d < -eps) return -1; // Back
  return 0;                 // On plane
}

export function planeProjectPoint(plane, point) {
  const d = planeDistanceToPoint(plane, point);
  return [point[0] - plane[0] * d, point[1] - plane[1] * d, point[2] - plane[2] * d];
}

export const planeClosestPoint = planeProjectPoint;

export const planeAbsDistanceToPoint = (plane, point) =>
  Math.abs(planeDistanceToPoint(plane, point));

// ============================================================================
// NEGATE / FLIP
// ============================================================================

export const planeNegate = (p) => [-p[0], -p[1], -p[2], -p[3]];

// ============================================================================
// INTERSECTION — RAY
// ============================================================================

export function planeIntersectRay(plane, rayOrigin, rayDir) {
  const denom = v3Dot(planeGetNormal(plane), rayDir);
  if (Math.abs(denom) < EPSILON) return null;
  const t = -(v3Dot(planeGetNormal(plane), rayOrigin) + plane[3]) / denom;
  if (t < 0) return null;
  return { t, point: v3Add(rayOrigin, v3Scale(rayDir, t)) };
}

// ============================================================================
// INTERSECTION — LINE SEGMENT
// ============================================================================

export function planeIntersectSegment(plane, p1, p2, parallelTolerance = EPSILON) {
  const d1 = planeDistanceToPoint(plane, p1);
  const d2 = planeDistanceToPoint(plane, p2);
  if (d1 === d2 || Math.abs(d1 - d2) < parallelTolerance) return null;
  const t = d1 / (d1 - d2);
  if (t < 0 || t > 1) return null;
  return {
    t,
    point: v3Lerp(p1, p2, t),
  };
}

// ============================================================================
// INTERSECTION — PLANE-PLANE (line of intersection)
// ============================================================================

export function planeIntersectPlane(p1, p2) {
  const n1 = planeGetNormal(p1);
  const n2 = planeGetNormal(p2);
  const dir = v3Cross(n1, n2);
  const lenSq = v3Dot(dir, dir);
  if (lenSq < EPSILON) return null; // Parallel
  const d1 = p1[3], d2 = p2[3];
  const det = lenSq;
  const origin = v3Scale(
    v3Add(v3Cross(dir, v3Scale(n2, d1)), v3Cross(v3Scale(n1, d2), dir)),
    1 / det
  );
  return { origin, direction: v3Norm(dir) };
}

// ============================================================================
// INTERSECTION — THREE PLANES (point)
// ============================================================================

export function planeIntersectThreePlanes(p1, p2, p3) {
  const n1 = planeGetNormal(p1), n2 = planeGetNormal(p2), n3 = planeGetNormal(p3);
  const denom = v3Dot(n1, v3Cross(n2, n3));
  if (Math.abs(denom) < EPSILON) return null;
  const inv = 1 / denom;
  return v3Scale(
    v3Add(v3Add(
      v3Scale(v3Cross(n2, n3), -p1[3]),
      v3Scale(v3Cross(n3, n1), -p2[3])),
      v3Scale(v3Cross(n1, n2), -p3[3])),
    inv
  );
}

// ============================================================================
// TRANSFORM
// ============================================================================

export function planeTransformMat4(plane, m) {
  const n = planeGetNormal(plane);
  const p = v3Scale(n, -plane[3]);
  const tp = [
    m[0]*p[0] + m[4]*p[1] + m[8]*p[2] + m[12],
    m[1]*p[0] + m[5]*p[1] + m[9]*p[2] + m[13],
    m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14],
  ];
  const tn = v3Norm([
    m[0]*n[0] + m[4]*n[1] + m[8]*n[2],
    m[1]*n[0] + m[5]*n[1] + m[9]*n[2],
    m[2]*n[0] + m[6]*n[1] + m[10]*n[2],
  ]);
  return [tn[0], tn[1], tn[2], -v3Dot(tn, tp)];
}

// ============================================================================
// COMPARISON
// ============================================================================

export function planeEquals(a, b, eps = EPSILON) {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps &&
    Math.abs(a[2] - b[2]) < eps && Math.abs(a[3] - b[3]) < eps;
}

// ============================================================================
// COPLANARITY TEST
// ============================================================================

export const planeCoplanarPoint = (plane) =>
  v3Scale(planeGetNormal(plane), -plane[3]);
