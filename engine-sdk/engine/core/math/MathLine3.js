// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathLine3.js - Line segment operations (Three.js Line3 parity)
// Segment represented as { a: [x,y,z], b: [x,y,z] }
// Consolidates: MathGeometry.closestPointOnSegment, ViewportRaycasting.raySegmentDistance,
//               PBDRagdoll.capsuleCollision segment-segment math

import { EPSILON } from './MathConstants.js';
import { clamp } from './MathScalar.js';
import {
  vec3Add as v3Add,
  vec3Dot as v3Dot,
  vec3Length as v3Len,
  vec3LengthSq as v3LenSq,
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

export const segmentCreate = (a, b) => ({ a: [...a], b: [...b] });

export function segmentFromPointDir(origin, direction, length) {
  return { a: [...origin], b: [origin[0] + direction[0] * length, origin[1] + direction[1] * length, origin[2] + direction[2] * length] };
}

export const segmentClone = (seg) => ({ a: [...seg.a], b: [...seg.b] });

// ============================================================================
// QUERY
// ============================================================================

export const segmentAt = (seg, t) => v3Lerp(seg.a, seg.b, t);
export const segmentCenter = (seg) => v3Lerp(seg.a, seg.b, 0.5);
export const segmentDelta = (seg) => v3Sub(seg.b, seg.a);
export const segmentDirection = (seg) => v3Norm(v3Sub(seg.b, seg.a));
export const segmentLength = (seg) => v3Len(v3Sub(seg.b, seg.a));
export const segmentLengthSq = (seg) => v3LenSq(v3Sub(seg.b, seg.a));

// ============================================================================
// CLOSEST POINT — POINT TO SEGMENT
// ============================================================================

export function segmentClosestPointToPoint(seg, point) {
  const ab = v3Sub(seg.b, seg.a);
  const ap = v3Sub(point, seg.a);
  const abLenSq = v3Dot(ab, ab);
  if (abLenSq < EPSILON) return { point: [...seg.a], t: 0 };
  const t = clamp(v3Dot(ap, ab) / abLenSq, 0, 1);
  return { point: v3Add(seg.a, v3Scale(ab, t)), t };
}

export function segmentDistanceToPoint(seg, point) {
  const { point: closest } = segmentClosestPointToPoint(seg, point);
  return v3Len(v3Sub(point, closest));
}

export function segmentDistanceSqToPoint(seg, point) {
  const { point: closest } = segmentClosestPointToPoint(seg, point);
  return v3LenSq(v3Sub(point, closest));
}

// ============================================================================
// CLOSEST POINT — SEGMENT TO SEGMENT
// Based on Ericson, "Real-Time Collision Detection" (Christer Ericson, 2004)
// This is the same algorithm used in PBDRagdoll.capsuleCollision
// ============================================================================

export function segmentClosestPointToSegment(seg1, seg2) {
  const dx=seg1.b[0]-seg1.a[0],dy=seg1.b[1]-seg1.a[1],dz=seg1.b[2]-seg1.a[2];
  const ex=seg2.b[0]-seg2.a[0],ey=seg2.b[1]-seg2.a[1],ez=seg2.b[2]-seg2.a[2];
  const rx=seg1.a[0]-seg2.a[0],ry=seg1.a[1]-seg2.a[1],rz=seg1.a[2]-seg2.a[2];

  const a=dx*dx+dy*dy+dz*dz;
  const e=ex*ex+ey*ey+ez*ez;
  const f=ex*rx+ey*ry+ez*rz;

  let s, t;

  if (a === 0 && e === 0) {
    s = t = 0;
  } else if (a === 0) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c=dx*rx+dy*ry+dz*rz;
    if (e === 0) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b=dx*ex+dy*ey+dz*ez;
      const denom = a * e - b * b;

      if (denom > Number.EPSILON * a * e) {
        s = clamp((b * f - c * e) / denom, 0, 1);
      } else {
        s = 0;
      }

      t = (b * s + f) / e;

      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const point1=[seg1.a[0]+dx*s,seg1.a[1]+dy*s,seg1.a[2]+dz*s];
  const point2=[seg2.a[0]+ex*t,seg2.a[1]+ey*t,seg2.a[2]+ez*t];
  const qx=point1[0]-point2[0],qy=point1[1]-point2[1],qz=point1[2]-point2[2],dist=Math.sqrt(qx*qx+qy*qy+qz*qz);

  return { point1, point2, s, t, distance: dist };
}

export function segmentDistanceToSegment(seg1, seg2) {
  return segmentClosestPointToSegment(seg1, seg2).distance;
}

export function segmentDistanceSqToSegment(seg1, seg2) {
  const { point1, point2 } = segmentClosestPointToSegment(seg1, seg2);
  return v3LenSq(v3Sub(point1, point2));
}

// ============================================================================
// CLOSEST POINT — SEGMENT TO RAY
// ============================================================================

export function segmentClosestPointToRay(seg, rayOrigin, rayDir) {
  const segDir = v3Sub(seg.b, seg.a);
  const w0 = v3Sub(rayOrigin, seg.a);
  const a = v3Dot(rayDir, rayDir);
  const b = v3Dot(rayDir, segDir);
  const c = v3Dot(segDir, segDir);
  const d = v3Dot(rayDir, w0);
  const e = v3Dot(segDir, w0);
  const denom = a * c - b * b;

  if (Math.abs(denom) < EPSILON) return null;

  let sc = (b * e - c * d) / denom;
  let tc = (a * e - b * d) / denom;

  tc = clamp(tc, 0, 1);
  sc = Math.max(0, (b * tc - d) / a);

  const pointOnRay = v3Add(rayOrigin, v3Scale(rayDir, sc));
  const pointOnSeg = v3Add(seg.a, v3Scale(segDir, tc));

  return {
    pointOnRay,
    pointOnSeg,
    rayT: sc,
    segT: tc,
    distance: v3Len(v3Sub(pointOnRay, pointOnSeg)),
  };
}

export function segmentDistanceToRay(seg, rayOrigin, rayDir) {
  const result = segmentClosestPointToRay(seg, rayOrigin, rayDir);
  return result ? result.distance : Infinity;
}

// ============================================================================
// COMPARISON
// ============================================================================

export function segmentEquals(a, b, eps = EPSILON) {
  return Math.abs(a.a[0] - b.a[0]) < eps && Math.abs(a.a[1] - b.a[1]) < eps && Math.abs(a.a[2] - b.a[2]) < eps &&
    Math.abs(a.b[0] - b.b[0]) < eps && Math.abs(a.b[1] - b.b[1]) < eps && Math.abs(a.b[2] - b.b[2]) < eps;
}
