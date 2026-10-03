// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



// MathGeometry.js - SDF, intersections, bounds, frustum culling

// For collision detection, physics, rendering culling



import { EPSILON } from './MathConstants.js';
import { clamp, sign } from './MathScalar.js';
import { quatIsFinite, quatLengthSq, quatRotateVec3 } from './MathQuat.js';
import { vec2Dot, vec2Length, vec2Scale, vec2Sub } from './MathVec2.js';
import {
  vec3Add,
  vec3Cross,
  vec3Distance,
  vec3Dot,
  vec3Length,
  vec3LengthSq,
  vec3Max,
  vec3Min,
  vec3Scale,
  vec3Sub,
} from './MathVec3.js';

// ============================================================================
// VECTOR HELPERS
// ============================================================================

const vec3Normalize = (v) => { const l = vec3Length(v); return l < EPSILON ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l]; };


// ============================================================================

// 2D SIGNED DISTANCE FUNCTIONS

// ============================================================================



export const sdfCircle = (p, r) => vec2Length(p) - r;



export const sdfBox2D = (p, b) => {

  const d = [Math.abs(p[0]) - b[0], Math.abs(p[1]) - b[1]];

  return vec2Length([Math.max(d[0], 0), Math.max(d[1], 0)]) + Math.min(Math.max(d[0], d[1]), 0);

};



export const sdfSegment2D = (p, a, b) => {

  const pa = vec2Sub(p, a), ba = vec2Sub(b, a);

  const h = clamp(vec2Dot(pa, ba) / vec2Dot(ba, ba), 0, 1);

  return vec2Length(vec2Sub(pa, vec2Scale(ba, h)));

};



export const sdfRoundedBox2D = (p, b, r) => sdfBox2D(p, [b[0] - r, b[1] - r]) - r;



// ============================================================================

// 3D SIGNED DISTANCE FUNCTIONS

// ============================================================================



export const sdfSphere = (p, r) => vec3Length(p) - r;



export function sdfBox3D(p, b) {

  const q = [Math.abs(p[0]) - b[0], Math.abs(p[1]) - b[1], Math.abs(p[2]) - b[2]];

  return vec3Length([Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)]) +

         Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0);

}



export const sdfRoundBox = (p, b, r) => sdfBox3D(p, [b[0] - r, b[1] - r, b[2] - r]) - r;



export function sdfCylinder(p, h, r) {

  const d = [Math.sqrt(p[0] * p[0] + p[2] * p[2]) - r, Math.abs(p[1]) - h];

  return Math.min(Math.max(d[0], d[1]), 0) + vec2Length([Math.max(d[0], 0), Math.max(d[1], 0)]);

}



export function sdfCapsule(p, a, b, r) {

  const pa = vec3Sub(p, a), ba = vec3Sub(b, a);

  const h = clamp(vec3Dot(pa, ba) / vec3Dot(ba, ba), 0, 1);

  return vec3Length(vec3Sub(pa, vec3Scale(ba, h))) - r;

}



export function sdfTorus(p, R, r) {

  const q = [Math.sqrt(p[0] * p[0] + p[2] * p[2]) - R, p[1]];

  return vec2Length(q) - r;

}



export function sdfCone(p, angle, h) {

  const c = Math.cos(angle), s = Math.sin(angle);

  const q = Math.sqrt(p[0] * p[0] + p[2] * p[2]);

  return Math.max(c * q + s * p[1], -h - p[1]);

}



export const sdfPlane = (p, n, d) => vec3Dot(p, n) + d;



// ============================================================================

// SDF OPERATIONS

// ============================================================================



export const sdfUnion = (d1, d2) => Math.min(d1, d2);

export const sdfSubtract = (d1, d2) => Math.max(-d1, d2);

export const sdfIntersect = (d1, d2) => Math.max(d1, d2);



export const sdfSmoothUnion = (d1, d2, k) => {

  const h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0, 1);

  return d2 * (1 - h) + d1 * h - k * h * (1 - h);

};



export const sdfSmoothSubtract = (d1, d2, k) => {

  const h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0, 1);

  return d2 * (1 - h) + (-d1) * h + k * h * (1 - h);

};



export const sdfSmoothIntersect = (d1, d2, k) => {

  const h = clamp(0.5 - 0.5 * (d2 - d1) / k, 0, 1);

  return d2 * (1 - h) + d1 * h + k * h * (1 - h);

};



export const sdfRound = (d, r) => d - r;

export const sdfOnion = (d, r) => Math.abs(d) - r;



// ============================================================================

// 2D INTERSECTION TESTS

// ============================================================================



export const pointInCircle = (point, center, radius) =>

  (point[0] - center[0]) ** 2 + (point[1] - center[1]) ** 2 <= radius * radius;



export const pointInRect = (point, rectMin, rectMax) =>

  point[0] >= rectMin[0] && point[0] <= rectMax[0] &&

  point[1] >= rectMin[1] && point[1] <= rectMax[1];



/** Odd/even containment for a simple 2D contour; callers validate boundary intersections. */
export function pointInPolygon2D(point, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInTriangle2D(p, a, b, c) {

  const v0 = vec2Sub(c, a), v1 = vec2Sub(b, a), v2 = vec2Sub(p, a);

  const dot00 = vec2Dot(v0, v0), dot01 = vec2Dot(v0, v1), dot02 = vec2Dot(v0, v2);

  const dot11 = vec2Dot(v1, v1), dot12 = vec2Dot(v1, v2);

  const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);

  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;

  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

  return u >= 0 && v >= 0 && u + v <= 1;

}



export const circleCircle = (c1, r1, c2, r2) =>

  (c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2 <= (r1 + r2) ** 2;



export const rectRect = (min1, max1, min2, max2) =>

  min1[0] <= max2[0] && max1[0] >= min2[0] &&

  min1[1] <= max2[1] && max1[1] >= min2[1];



export function lineLineIntersection(p1, p2, p3, p4) {

  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);

  if (Math.abs(d) < EPSILON) return null;

  const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d;

  const u = -((p1[0] - p2[0]) * (p1[1] - p3[1]) - (p1[1] - p2[1]) * (p1[0] - p3[0])) / d;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {

    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];

  }

  return null;

}



// ============================================================================

// 3D INTERSECTION TESTS

// ============================================================================



export const pointInSphere = (point, center, radius) =>

  vec3LengthSq(vec3Sub(point, center)) <= radius * radius;



export const pointInAABB = (point, aabbMin, aabbMax) =>

  point[0] >= aabbMin[0] && point[0] <= aabbMax[0] &&

  point[1] >= aabbMin[1] && point[1] <= aabbMax[1] &&

  point[2] >= aabbMin[2] && point[2] <= aabbMax[2];



export const sphereSphere = (c1, r1, c2, r2) =>

  vec3LengthSq(vec3Sub(c1, c2)) <= (r1 + r2) ** 2;



export const aabbAABB = (min1, max1, min2, max2) =>

  min1[0] <= max2[0] && max1[0] >= min2[0] &&

  min1[1] <= max2[1] && max1[1] >= min2[1] &&

  min1[2] <= max2[2] && max1[2] >= min2[2];



export function sphereAABB(center, radius, aabbMin, aabbMax) {

  const closest = [

    clamp(center[0], aabbMin[0], aabbMax[0]),

    clamp(center[1], aabbMin[1], aabbMax[1]),

    clamp(center[2], aabbMin[2], aabbMax[2]),

  ];

  return vec3LengthSq(vec3Sub(center, closest)) <= radius * radius;

}



// Ray-sphere intersection

export function raySphere(rayOrigin, rayDir, center, radius) {

  const oc = vec3Sub(rayOrigin, center);

  const a = vec3Dot(rayDir, rayDir);

  const b = 2 * vec3Dot(oc, rayDir);

  const c = vec3Dot(oc, oc) - radius * radius;

  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) return null;

  const sqrtD = Math.sqrt(discriminant);

  let t = (-b - sqrtD) / (2 * a);

  if (t < 0) t = (-b + sqrtD) / (2 * a);

  if (t < 0) return null;

  const point = vec3Add(rayOrigin, vec3Scale(rayDir, t));

  const normal = vec3Normalize(vec3Sub(point, center));

  return { t, point, normal };

}



// Ray-AABB intersection (slab method)

export function rayAABB(rayOrigin, rayDir, aabbMin, aabbMax) {

  const invDir = [1 / rayDir[0], 1 / rayDir[1], 1 / rayDir[2]];

  const t1 = (aabbMin[0] - rayOrigin[0]) * invDir[0];

  const t2 = (aabbMax[0] - rayOrigin[0]) * invDir[0];

  const t3 = (aabbMin[1] - rayOrigin[1]) * invDir[1];

  const t4 = (aabbMax[1] - rayOrigin[1]) * invDir[1];

  const t5 = (aabbMin[2] - rayOrigin[2]) * invDir[2];

  const t6 = (aabbMax[2] - rayOrigin[2]) * invDir[2];



  const tmin = Math.max(Math.max(Math.min(t1, t2), Math.min(t3, t4)), Math.min(t5, t6));

  const tmax = Math.min(Math.min(Math.max(t1, t2), Math.max(t3, t4)), Math.max(t5, t6));



  if (tmax < 0 || tmin > tmax) return null;



  const t = tmin < 0 ? tmax : tmin;

  const point = vec3Add(rayOrigin, vec3Scale(rayDir, t));



  // Calculate normal

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



// Ray-plane intersection

export function rayPlane(rayOrigin, rayDir, planeNormal, planeD) {

  const denom = vec3Dot(planeNormal, rayDir);

  if (Math.abs(denom) < EPSILON) return null;

  const t = -(vec3Dot(planeNormal, rayOrigin) + planeD) / denom;

  if (t < 0) return null;

  const point = vec3Add(rayOrigin, vec3Scale(rayDir, t));

  return { t, point, normal: planeNormal };

}



// Ray-triangle intersection (Möller–Trumbore)

export function rayTriangle(rayOrigin, rayDir, v0, v1, v2) {

  const edge1 = vec3Sub(v1, v0);

  const edge2 = vec3Sub(v2, v0);

  const h = vec3Cross(rayDir, edge2);

  const a = vec3Dot(edge1, h);



  if (Math.abs(a) < EPSILON) return null;



  const f = 1 / a;

  const s = vec3Sub(rayOrigin, v0);

  const u = f * vec3Dot(s, h);



  if (u < 0 || u > 1) return null;



  const q = vec3Cross(s, edge1);

  const v = f * vec3Dot(rayDir, q);



  if (v < 0 || u + v > 1) return null;



  const t = f * vec3Dot(edge2, q);

  if (t < EPSILON) return null;



  const point = vec3Add(rayOrigin, vec3Scale(rayDir, t));

  const normal = vec3Normalize(vec3Cross(edge1, edge2));

  return { t, point, normal, u, v };

}



// ============================================================================

// BOUNDING VOLUMES

// ============================================================================



export function aabbFromPoints(points) {

  if (points.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };

  let min = [...points[0]], max = [...points[0]];

  for (let i = 1; i < points.length; i++) {

    min = vec3Min(min, points[i]);

    max = vec3Max(max, points[i]);

  }

  return { min, max };

}



export const aabbCenter = (aabb) => [

  (aabb.min[0] + aabb.max[0]) / 2,

  (aabb.min[1] + aabb.max[1]) / 2,

  (aabb.min[2] + aabb.max[2]) / 2,

];



export const aabbSize = (aabb) => [

  aabb.max[0] - aabb.min[0],

  aabb.max[1] - aabb.min[1],

  aabb.max[2] - aabb.min[2],

];



export const aabbHalfSize = (aabb) => [
  (aabb.max[0] - aabb.min[0]) / 2,

  (aabb.max[1] - aabb.min[1]) / 2,

  (aabb.max[2] - aabb.min[2]) / 2,

];

/**
 * Convert a local AABB and entity TRS into a conservative world-space sphere.
 * Rotation moves the scaled local center but does not change the sphere radius.
 */
export function transformedAabbBoundingSphereReport(localMin, localMax, position, rotation, scale) {
  const vec3Valid = (value) => (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    value.length === 3 && Array.from(value).every(Number.isFinite);
  const quatValid = (Array.isArray(rotation) || ArrayBuffer.isView(rotation)) &&
    rotation.length === 4 && quatIsFinite(rotation);
  const ordered = vec3Valid(localMin) && vec3Valid(localMax) &&
    localMin.every((value, axis) => value <= localMax[axis]);
  const rotationLengthSq = quatValid ? quatLengthSq(rotation) : 0;
  const valid = ordered && vec3Valid(position) && vec3Valid(scale) &&
    quatValid && rotationLengthSq > EPSILON * EPSILON;
  if (!valid) return { valid, ordered, quatValid, rotationLengthSq };

  const inverseRotationLength = 1 / Math.sqrt(rotationLengthSq);
  const normalizedRotation = Array.from(rotation, value => value * inverseRotationLength);
  const localCenter = aabbCenter({ min: localMin, max: localMax });
  const localHalfSize = aabbHalfSize({ min: localMin, max: localMax });
  const scaledCenter = localCenter.map((value, axis) => value * scale[axis]);
  const rotatedCenter = quatRotateVec3(scaledCenter, normalizedRotation);
  const center = rotatedCenter.map((value, axis) => value + position[axis]);
  const halfSize = localHalfSize.map((value, axis) => value * Math.abs(scale[axis]));
  const radius = Math.hypot(...halfSize);
  const valuesValid = center.every(Number.isFinite) && halfSize.every(Number.isFinite) && Number.isFinite(radius);
  return valuesValid
    ? { valid: true, ordered, quatValid, rotationLengthSq, center, radius, halfSize }
    : { valid: false, ordered, quatValid, rotationLengthSq, valuesValid };
}


export const aabbExpand = (aabb, point) => ({

  min: vec3Min(aabb.min, point),

  max: vec3Max(aabb.max, point),

});



export const aabbMerge = (a, b) => ({

  min: vec3Min(a.min, b.min),

  max: vec3Max(a.max, b.max),

});



export const aabbGrow = (aabb, amount) => ({

  min: [aabb.min[0] - amount, aabb.min[1] - amount, aabb.min[2] - amount],

  max: [aabb.max[0] + amount, aabb.max[1] + amount, aabb.max[2] + amount],

});



export function aabbSurfaceArea(aabb) {

  const s = aabbSize(aabb);

  return 2 * (s[0] * s[1] + s[1] * s[2] + s[2] * s[0]);

}



export function aabbVolume(aabb) {

  const s = aabbSize(aabb);

  return s[0] * s[1] * s[2];

}



// Bounding sphere from points (Ritter's algorithm)

export function boundingSphereFromPoints(points) {

  if (points.length === 0) return { center: [0, 0, 0], radius: 0 };



  // Find extreme points

  let minX = points[0], maxX = points[0];

  let minY = points[0], maxY = points[0];

  let minZ = points[0], maxZ = points[0];



  for (const p of points) {

    if (p[0] < minX[0]) minX = p;

    if (p[0] > maxX[0]) maxX = p;

    if (p[1] < minY[1]) minY = p;

    if (p[1] > maxY[1]) maxY = p;

    if (p[2] < minZ[2]) minZ = p;

    if (p[2] > maxZ[2]) maxZ = p;

  }



  const dx = vec3Distance(minX, maxX);

  const dy = vec3Distance(minY, maxY);

  const dz = vec3Distance(minZ, maxZ);



  let p1, p2;

  if (dx >= dy && dx >= dz) { p1 = minX; p2 = maxX; }

  else if (dy >= dx && dy >= dz) { p1 = minY; p2 = maxY; }

  else { p1 = minZ; p2 = maxZ; }



  let center = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2];

  let radius = vec3Distance(center, p1);



  // Expand to include all points

  for (const p of points) {

    const dist = vec3Distance(center, p);

    if (dist > radius) {

      radius = (radius + dist) / 2;

      const ratio = (dist - radius) / dist;

      center = [

        center[0] + (p[0] - center[0]) * ratio,

        center[1] + (p[1] - center[1]) * ratio,

        center[2] + (p[2] - center[2]) * ratio,

      ];

    }

  }



  return { center, radius };

}



// ============================================================================

// FRUSTUM CULLING

// ============================================================================



/**

 * Extract frustum planes from a column-major view-projection matrix.

 *

 * Planes are `[nx, ny, nz, d]` where `nx*x + ny*y + nz*z + d = 0`, and a point

 * is inside when every plane evaluates non-negative (Gribb & Hartmann).

 *

 * ## The near plane depends on the clip-space convention

 *

 * Five of the six planes are the same either way. The near plane is not, and

 * getting it wrong is invisible in a screenshot:

 *

 * - **OpenGL** clips depth to `[-w, w]`, so near is `w + z` → `row3 + row2`.

 * - **WebGPU** and D3D clip depth to `[0, w]`, so near is `z` → `row2` alone.

 *

 * Using the OpenGL form on a WebGPU projection is too permissive, and by how

 * much depends entirely on the projection — measured, not reasoned about:

 *

 * - **Perspective**: the near plane lands at half its intended distance (0.04

 *   against 0.08 for a 0.08 near). Geometry behind the camera is still

 *   rejected correctly, so the practical effect is negligible.

 * - **Orthographic**: the near plane is **degenerate and accepts everything**,

 *   including geometry far behind the viewer, because the `w` row of an

 *   orthographic matrix is constant and adding it swamps the depth row.

 *

 * The orthographic case is the one that bites, and it is the case shadow

 * cascades and any top-down or isometric pass use.

 *

 * The default stays `'negative-one-to-one'` so existing callers are unaffected;

 * anything building its projection with `mat4PerspectiveRadWebGPU` or

 * `mat4OrthographicWebGPU` should pass `'zero-to-one'`.

 *

 * @param {number[]|Float32Array} m column-major view-projection matrix

 * @param {object} [options]

 * @param {'negative-one-to-one'|'zero-to-one'} [options.depthRange]

 */

export function frustumFromMatrix(m, { depthRange = 'negative-one-to-one' } = {}) {

  const zeroToOne = depthRange === 'zero-to-one';

  return {

    left:   [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],

    right:  [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],

    bottom: [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],

    top:    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],

    near:   zeroToOne

      ? [m[2], m[6], m[10], m[14]]

      : [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],

    far:    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],

  };

}



export function frustumNormalizePlanes(frustum) {

  const normalize = (p) => {

    const len = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);

    return [p[0] / len, p[1] / len, p[2] / len, p[3] / len];

  };

  return {

    left: normalize(frustum.left),

    right: normalize(frustum.right),

    bottom: normalize(frustum.bottom),

    top: normalize(frustum.top),

    near: normalize(frustum.near),

    far: normalize(frustum.far),

  };

}



export function frustumContainsSphere(frustum, center, radius) {

  const planes = [frustum.left, frustum.right, frustum.bottom, frustum.top, frustum.near, frustum.far];

  for (const plane of planes) {

    const dist = plane[0] * center[0] + plane[1] * center[1] + plane[2] * center[2] + plane[3];

    const len = Math.sqrt(plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2]);

    if (dist / len < -radius) return false;

  }

  return true;

}



export function frustumContainsAABB(frustum, aabbMin, aabbMax) {

  const planes = [frustum.left, frustum.right, frustum.bottom, frustum.top, frustum.near, frustum.far];

  for (const plane of planes) {

    // P-vertex (most positive vertex relative to plane)

    const px = plane[0] > 0 ? aabbMax[0] : aabbMin[0];

    const py = plane[1] > 0 ? aabbMax[1] : aabbMin[1];

    const pz = plane[2] > 0 ? aabbMax[2] : aabbMin[2];

    if (plane[0] * px + plane[1] * py + plane[2] * pz + plane[3] < 0) {

      return false;

    }

  }

  return true;

}



// More precise AABB-frustum test (returns 'inside', 'outside', 'intersect')

export function frustumTestAABB(frustum, aabbMin, aabbMax) {

  const planes = [frustum.left, frustum.right, frustum.bottom, frustum.top, frustum.near, frustum.far];

  let result = 'inside';

  

  for (const plane of planes) {

    const px = plane[0] > 0 ? aabbMax[0] : aabbMin[0];

    const py = plane[1] > 0 ? aabbMax[1] : aabbMin[1];

    const pz = plane[2] > 0 ? aabbMax[2] : aabbMin[2];

    const nx = plane[0] > 0 ? aabbMin[0] : aabbMax[0];

    const ny = plane[1] > 0 ? aabbMin[1] : aabbMax[1];

    const nz = plane[2] > 0 ? aabbMin[2] : aabbMax[2];

    

    if (plane[0] * px + plane[1] * py + plane[2] * pz + plane[3] < 0) {

      return 'outside';

    }

    if (plane[0] * nx + plane[1] * ny + plane[2] * nz + plane[3] < 0) {

      result = 'intersect';

    }

  }

  

  return result;

}



// ============================================================================

// TRIANGLE UTILITIES

// ============================================================================



export const triangleNormal = (a, b, c) => vec3Normalize(vec3Cross(vec3Sub(b, a), vec3Sub(c, a)));



export const triangleArea = (a, b, c) => vec3Length(vec3Cross(vec3Sub(b, a), vec3Sub(c, a))) * 0.5;



export function triangleBarycentric(p, a, b, c) {

  const v0 = vec3Sub(b, a), v1 = vec3Sub(c, a), v2 = vec3Sub(p, a);

  const d00 = vec3Dot(v0, v0), d01 = vec3Dot(v0, v1), d11 = vec3Dot(v1, v1);

  const d20 = vec3Dot(v2, v0), d21 = vec3Dot(v2, v1);

  const denom = d00 * d11 - d01 * d01;

  if (Math.abs(denom) < EPSILON) return [1, 0, 0];

  const v = (d11 * d20 - d01 * d21) / denom;

  const w = (d00 * d21 - d01 * d20) / denom;

  return [1 - v - w, v, w];

}



export function triangleClosestPoint(p, a, b, c) {
  return triangleClosestPointWithWeights(p, a, b, c).point;
}

/** Closest Voronoi region, including segment/point degeneracies, at any scale. */
export function triangleClosestPointWithWeights(p, a, b, c) {
  // Scalar intermediates keep this shared hot query free of temporary vectors.
  // Preserve the same Voronoi predicates and scale-aware degeneracy boundary.
  const abx=b[0]-a[0],aby=b[1]-a[1],abz=b[2]-a[2],acx=c[0]-a[0],acy=c[1]-a[1],acz=c[2]-a[2];
  const apx=p[0]-a[0],apy=p[1]-a[1],apz=p[2]-a[2],bcx=c[0]-b[0],bcy=c[1]-b[1],bcz=c[2]-b[2];
  const nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx;
  const result = weights => ({ weights, point: [weights[0]*a[0]+weights[1]*b[0]+weights[2]*c[0],weights[0]*a[1]+weights[1]*b[1]+weights[2]*c[1],weights[0]*a[2]+weights[1]*b[2]+weights[2]*c[2]] });
  const areaSquared=nx*nx+ny*ny+nz*nz,scale=Math.max(abx*abx+aby*aby+abz*abz,acx*acx+acy*acy+acz*acz,bcx*bcx+bcy*bcy+bcz*bcz);
  if (areaSquared <= Number.EPSILON ** 2 * scale ** 2) {
    let best = null, distance = Infinity;
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const vertices = [a, b, c], edge = vec3Sub(vertices[j], vertices[i]), squared = vec3LengthSq(edge);
      const t = squared === 0 ? 0 : clamp(vec3Dot(vec3Sub(p, vertices[i]), edge) / squared, 0, 1);
      const weights = [0, 0, 0]; weights[i] = 1 - t; weights[j] = t;
      const candidate = result(weights), d = vec3LengthSq(vec3Sub(p, candidate.point));
      if (d < distance) { best = candidate; distance = d; }
    }
    return best;
  }
  const d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;
  if (d1 <= 0 && d2 <= 0) return result([1, 0, 0]);
  const bpx=p[0]-b[0],bpy=p[1]-b[1],bpz=p[2]-b[2],d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
  if (d3 >= 0 && d4 <= d3) return result([0, 1, 0]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return result([1 - v, v, 0]); }
  const cpx=p[0]-c[0],cpy=p[1]-c[1],cpz=p[2]-c[2],d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
  if (d6 >= 0 && d5 <= d6) return result([0, 0, 1]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return result([1 - w, 0, w]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 >= d3 && d5 >= d6) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); return result([0, 1 - w, w]); }
  const inverse = 1 / (va + vb + vc), v = vb * inverse, w = vc * inverse;
  return result([1 - v - w, v, w]);
}



// ============================================================================

// CLOSEST POINT QUERIES

// ============================================================================



export function closestPointOnSegment(p, a, b) {

  const ab = vec3Sub(b, a);

  const t = clamp(vec3Dot(vec3Sub(p, a), ab) / vec3Dot(ab, ab), 0, 1);

  return vec3Add(a, vec3Scale(ab, t));

}



export function closestPointOnAABB(p, aabbMin, aabbMax) {

  return [

    clamp(p[0], aabbMin[0], aabbMax[0]),

    clamp(p[1], aabbMin[1], aabbMax[1]),

    clamp(p[2], aabbMin[2], aabbMax[2]),

  ];

}



export function closestPointOnSphere(p, center, radius) {

  const dir = vec3Normalize(vec3Sub(p, center));

  return vec3Add(center, vec3Scale(dir, radius));

}



// ============================================================================

// DISTANCE QUERIES

// ============================================================================



export const distancePointToSegment = (p, a, b) => vec3Distance(p, closestPointOnSegment(p, a, b));

export const distancePointToAABB = (p, aabbMin, aabbMax) => vec3Distance(p, closestPointOnAABB(p, aabbMin, aabbMax));

export const distancePointToSphere = (p, center, radius) => Math.max(0, vec3Distance(p, center) - radius);

export const distancePointToPlane = (p, normal, d) => Math.abs(vec3Dot(p, normal) + d);

