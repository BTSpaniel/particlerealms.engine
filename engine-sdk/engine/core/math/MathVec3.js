// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathVec3.js - 3D Vector operations
// Depends on: MathConstants.js, MathScalar.js, MathRandom.js

import { EPSILON, TAU } from './MathConstants.js';
import { random } from './MathRandom.js';
import { clamp, fract, mod, sign, smoothstep } from './MathScalar.js';

// Creation
export const vec3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const vec3FromArray = (arr, offset = 0) => [arr[offset], arr[offset + 1], arr[offset + 2]];
export const vec3FromVec2 = (v, z = 0) => [v[0], v[1], z];
export const vec3FromScalar = (s) => [s, s, s];
export const vec3Zero = () => [0, 0, 0];
export const vec3One = () => [1, 1, 1];
export const vec3Up = () => [0, 1, 0];
export const vec3Down = () => [0, -1, 0];
export const vec3Left = () => [-1, 0, 0];
export const vec3Right = () => [1, 0, 0];
export const vec3Forward = () => [0, 0, -1];
export const vec3Back = () => [0, 0, 1];
export const vec3Clone = (v) => [v[0], v[1], v[2]];
export const vec3Copy = (out, v) => { out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; return out; };
export const vec3Set = (out, x, y, z) => { out[0] = x; out[1] = y; out[2] = z; return out; };

// Basic operations
export const vec3Add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vec3Sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vec3Mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const vec3Div = (a, b) => [a[0] / b[0], a[1] / b[1], a[2] / b[2]];
export const vec3Scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
export const vec3Negate = (v) => [-v[0], -v[1], -v[2]];
export const vec3Inverse = (v) => [1 / v[0], 1 / v[1], 1 / v[2]];
export const vec3AddScalar = (v, s) => [v[0] + s, v[1] + s, v[2] + s];
export const vec3SubScalar = (v, s) => [v[0] - s, v[1] - s, v[2] - s];

// In-place operations (mutating)
export const vec3AddInto = (out, a, b) => { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; };
export const vec3SubInto = (out, a, b) => { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; };
export const vec3MulInto = (out, a, b) => { out[0] = a[0] * b[0]; out[1] = a[1] * b[1]; out[2] = a[2] * b[2]; return out; };
export const vec3ScaleInto = (out, v, s) => { out[0] = v[0] * s; out[1] = v[1] * s; out[2] = v[2] * s; return out; };
export const vec3ScaleAndAdd = (out, a, b, s) => { out[0] = a[0] + b[0] * s; out[1] = a[1] + b[1] * s; out[2] = a[2] + b[2] * s; return out; };
export const vec3NegateInto = (out, v) => { out[0] = -v[0]; out[1] = -v[1]; out[2] = -v[2]; return out; };
export const vec3CrossInto = (out, a, b) => {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
};

// Products
export const vec3Dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vec3Cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
// Scalar triple product: a · (b × c)
export const vec3Triple = (a, b, c) => vec3Dot(a, vec3Cross(b, c));

// Length and distance
export const vec3LengthSq = (v) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
export const vec3Length = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
export const vec3DistanceSq = (a, b) => (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2;
export const vec3Distance = (a, b) => Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2);
export const vec3Manhattan = (a, b) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]);
export const vec3Chebyshev = (a, b) => Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]));
export const vec3ManhattanLength = (v) => Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]);

// Normalization
export const vec3Normalize = (v) => {
  const l = vec3Length(v);
  return !Number.isFinite(l) || l < EPSILON ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l];
};
export const vec3NormalizeInto = (out, v) => {
  const l = vec3Length(v);
  if (!Number.isFinite(l) || l < EPSILON) { out[0] = 0; out[1] = 0; out[2] = 0; }
  else { const inv = 1 / l; out[0] = v[0] * inv; out[1] = v[1] * inv; out[2] = v[2] * inv; }
  return out;
};
export const vec3SetLength = (v, len) => {
  const l = vec3Length(v);
  return !Number.isFinite(l) || !Number.isFinite(len) || l < EPSILON ? [0, 0, 0] : vec3Scale(v, len / l);
};
export const vec3ClampLength = (v, min, max) => {
  const l = vec3Length(v);
  return !Number.isFinite(l) || l < EPSILON ? [0, 0, 0] : vec3Scale(v, clamp(l, min, max) / l);
};
export const vec3Limit = (v, maxLen) => {
  const l = vec3Length(v);
  return l > maxLen ? vec3Scale(v, maxLen / l) : vec3Clone(v);
};
// Safe normalize: returns fallback if zero-length
export const vec3SafeNormalize = (v, fallback = [0, 1, 0]) => {
  const l = vec3Length(v);
  return !Number.isFinite(l) || l < EPSILON ? [...fallback] : [v[0] / l, v[1] / l, v[2] / l];
};

// Interpolation
export const vec3Lerp = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const vec3LerpInto = (out, a, b, t) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};
export const vec3SmoothStep = (a, b, t) => vec3Lerp(a, b, smoothstep(0, 1, t));

// Spherical linear interpolation (for direction vectors)
export function vec3Slerp(a, b, t) {
  let cosOmega = vec3Dot(a, b);
  cosOmega = clamp(cosOmega, -1, 1);
  if (cosOmega > 0.9999) return vec3Normalize(vec3Lerp(a, b, t));
  const omega = Math.acos(cosOmega);
  const sinOmega = Math.sin(omega);
  const sa = Math.sin((1 - t) * omega) / sinOmega;
  const sb = Math.sin(t * omega) / sinOmega;
  return [a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb];
}

// Hermite spline interpolation
export const vec3Hermite = (p0, t0, p1, t1, t) => {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return [
    p0[0] * h00 + t0[0] * h10 + p1[0] * h01 + t1[0] * h11,
    p0[1] * h00 + t0[1] * h10 + p1[1] * h01 + t1[1] * h11,
    p0[2] * h00 + t0[2] * h10 + p1[2] * h01 + t1[2] * h11,
  ];
};

// Quadratic Bezier
export const vec3Bezier2 = (p0, p1, p2, t) => {
  const mt = 1 - t;
  return [
    p0[0] * mt * mt + 2 * p1[0] * mt * t + p2[0] * t * t,
    p0[1] * mt * mt + 2 * p1[1] * mt * t + p2[1] * t * t,
    p0[2] * mt * mt + 2 * p1[2] * mt * t + p2[2] * t * t,
  ];
};

// Cubic Bezier
export const vec3Bezier3 = (p0, p1, p2, p3, t) => {
  const mt = 1 - t, mt2 = mt * mt, t2 = t * t;
  return [
    p0[0] * mt2 * mt + 3 * p1[0] * mt2 * t + 3 * p2[0] * mt * t2 + p3[0] * t2 * t,
    p0[1] * mt2 * mt + 3 * p1[1] * mt2 * t + 3 * p2[1] * mt * t2 + p3[1] * t2 * t,
    p0[2] * mt2 * mt + 3 * p1[2] * mt2 * t + 3 * p2[2] * mt * t2 + p3[2] * t2 * t,
  ];
};

// Catmull-Rom spline
export const vec3CatmullRom = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * t + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3),
  ];
};

// Min/max/clamp
export const vec3Min = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
export const vec3Max = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
export const vec3Clamp = (v, min, max) => [clamp(v[0], min[0], max[0]), clamp(v[1], min[1], max[1]), clamp(v[2], min[2], max[2])];
export const vec3ClampScalar = (v, min, max) => [clamp(v[0], min, max), clamp(v[1], min, max), clamp(v[2], min, max)];

// Rounding
export const vec3Floor = (v) => [Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2])];
export const vec3Ceil = (v) => [Math.ceil(v[0]), Math.ceil(v[1]), Math.ceil(v[2])];
export const vec3Round = (v) => [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])];
export const vec3Trunc = (v) => [Math.trunc(v[0]), Math.trunc(v[1]), Math.trunc(v[2])];
export const vec3Fract = (v) => [fract(v[0]), fract(v[1]), fract(v[2])];
export const vec3Abs = (v) => [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
export const vec3Sign = (v) => [sign(v[0]), sign(v[1]), sign(v[2])];
export const vec3Snap = (v, step) => [Math.round(v[0] / step) * step, Math.round(v[1] / step) * step, Math.round(v[2] / step) * step];

// Angle operations
export const vec3AngleBetween = (a, b) => {
  const denom = Math.sqrt(vec3LengthSq(a) * vec3LengthSq(b));
  if (denom < EPSILON) return 0;
  return Math.acos(clamp(vec3Dot(a, b) / denom, -1, 1));
};
// Signed angle around axis (useful for rotation calculations)
export function vec3SignedAngle(from, to, axis) {
  const angle = vec3AngleBetween(from, to);
  const cross = vec3Cross(from, to);
  return vec3Dot(cross, axis) < 0 ? -angle : angle;
}

// Rotation around a point
export function vec3RotateX(v, origin, angle) {
  const p0 = v[0] - origin[0], p1 = v[1] - origin[1], p2 = v[2] - origin[2];
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p0 + origin[0], p1 * c - p2 * s + origin[1], p1 * s + p2 * c + origin[2]];
}
export function vec3RotateY(v, origin, angle) {
  const p0 = v[0] - origin[0], p1 = v[1] - origin[1], p2 = v[2] - origin[2];
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p0 * c + p2 * s + origin[0], p1 + origin[1], -p0 * s + p2 * c + origin[2]];
}
export function vec3RotateZ(v, origin, angle) {
  const p0 = v[0] - origin[0], p1 = v[1] - origin[1], p2 = v[2] - origin[2];
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p0 * c - p1 * s + origin[0], p0 * s + p1 * c + origin[1], p2 + origin[2]];
}
// Rotate around arbitrary axis (Rodrigues' rotation formula)
export function vec3RotateAxis(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const d = vec3Dot(v, axis);
  const cx = vec3Cross(axis, v);
  return [
    v[0] * c + cx[0] * s + axis[0] * d * t,
    v[1] * c + cx[1] * s + axis[1] * d * t,
    v[2] * c + cx[2] * s + axis[2] * d * t,
  ];
}

// Reflection and projection
export const vec3Reflect = (v, n) => {
  const d = 2 * vec3Dot(v, n);
  return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]];
};
export const vec3Project = (v, onto) => {
  const d = vec3Dot(onto, onto);
  if (d < EPSILON) return [0, 0, 0];
  const s = vec3Dot(v, onto) / d;
  return [onto[0] * s, onto[1] * s, onto[2] * s];
};
export const vec3Reject = (v, from) => vec3Sub(v, vec3Project(v, from));
export const vec3ProjectOnPlane = (v, planeNormal) => vec3Sub(v, vec3Project(v, planeNormal));
// Slide along surface: remove component along normal
export const vec3Slide = (v, normal) => {
  const d = vec3Dot(v, normal);
  return [v[0] - d * normal[0], v[1] - d * normal[1], v[2] - d * normal[2]];
};

// Movement
export const vec3MoveToward = (cur, tgt, maxDelta) => {
  const dx = tgt[0] - cur[0], dy = tgt[1] - cur[1], dz = tgt[2] - cur[2];
  const dSq = dx * dx + dy * dy + dz * dz;
  if (dSq < EPSILON || (maxDelta >= 0 && dSq <= maxDelta * maxDelta)) return [tgt[0], tgt[1], tgt[2]];
  const s = maxDelta / Math.sqrt(dSq);
  return [cur[0] + dx * s, cur[1] + dy * s, cur[2] + dz * s];
};

// Comparison
export const vec3Equals = (a, b, eps = EPSILON) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
export const vec3ExactEquals = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const vec3IsZero = (v, eps = EPSILON) =>
  Math.abs(v[0]) < eps && Math.abs(v[1]) < eps && Math.abs(v[2]) < eps;
export const vec3IsNormalized = (v, eps = EPSILON) => Math.abs(vec3LengthSq(v) - 1) < eps;
export const vec3IsFinite = (v) => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
export const vec3IsNaN = (v) => Number.isNaN(v[0]) || Number.isNaN(v[1]) || Number.isNaN(v[2]);

// Random (deterministic via MathRandom)
export const vec3Random = () => [random(), random(), random()];
export function vec3RandomDirection(scale = 1) {
  const z = random() * 2 - 1;
  const r = Math.sqrt(1 - z * z) * scale;
  const a = random() * TAU;
  return [Math.cos(a) * r, Math.sin(a) * r, z * scale];
}
export function vec3RandomInSphere(radius = 1) {
  const dir = vec3RandomDirection();
  const r = Math.cbrt(random()) * radius;
  return [dir[0] * r, dir[1] * r, dir[2] * r];
}
export const vec3RandomInBox = (w, h, d) => [random() * w, random() * h, random() * d];
export const vec3RandomInBoxCentered = (w, h, d) => [
  (random() - 0.5) * w,
  (random() - 0.5) * h,
  (random() - 0.5) * d,
];
// Random point on sphere surface
export function vec3RandomOnSphere(radius = 1) {
  return vec3RandomDirection(radius);
}
// Random in hemisphere (above plane with given normal)
export function vec3RandomInHemisphere(normal) {
  const dir = vec3RandomDirection();
  return vec3Dot(dir, normal) < 0 ? vec3Negate(dir) : dir;
}

// Spherical coordinates: [radius, polar/phi (0=up, PI=down), azimuthal/theta (0..TAU)]
export function vec3FromSpherical(radius, phi, theta) {
  const sinPhi = Math.sin(phi);
  return [
    radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta),
  ];
}
export function vec3ToSpherical(v) {
  const r = vec3Length(v);
  if (r < EPSILON) return [0, 0, 0];
  return [r, Math.acos(clamp(v[1] / r, -1, 1)), Math.atan2(v[2], v[0])];
}

// Cylindrical coordinates: [radius, theta, height]
export function vec3FromCylindrical(radius, theta, y) {
  return [radius * Math.cos(theta), y, radius * Math.sin(theta)];
}
export function vec3ToCylindrical(v) {
  return [Math.sqrt(v[0] * v[0] + v[2] * v[2]), Math.atan2(v[2], v[0]), v[1]];
}

// Transform by 3x3 matrix (column-major)
export const vec3TransformMat3 = (v, m) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

// Transform by 4x4 matrix as position (w=1, with perspective divide)
export function vec3TransformMat4(v, m) {
  const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15];
  const invW = Math.abs(w) < EPSILON ? 1 : 1 / w;
  return [
    (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) * invW,
    (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) * invW,
    (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) * invW,
  ];
}

// Transform direction (w=0, no translation, no perspective divide)
export const vec3TransformDirection = (v, m) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];

// Transform by normal matrix (inverse transpose of upper-left 3x3)
export const vec3TransformNormal = (v, normalMat) => vec3Normalize(vec3TransformMat3(v, normalMat));

// Transform by quaternion [x, y, z, w]
export function vec3TransformQuat(v, q) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

// Orthonormal basis from a single normal (Frisvad/Pixar method)
export function vec3OrthonormalBasis(n) {
  let tangent, bitangent;
  if (n[1] < -0.9999999) {
    tangent = [0, 0, -1];
    bitangent = [-1, 0, 0];
  } else {
    const a = 1 / (1 + n[1]);
    const b = -n[0] * n[2] * a;
    tangent = [1 - n[0] * n[0] * a, -n[0], b];
    bitangent = [b, -n[2], 1 - n[2] * n[2] * a];
  }
  return { tangent, bitangent, normal: vec3Clone(n) };
}

// Barycentric interpolation
export function vec3Barycentric(a, b, c, u, v) {
  const w = 1 - u - v;
  return [
    a[0] * w + b[0] * u + c[0] * v,
    a[1] * w + b[1] * u + c[1] * v,
    a[2] * w + b[2] * u + c[2] * v,
  ];
}

// Component-wise operations
export const vec3MinComponent = (v) => Math.min(v[0], v[1], v[2]);
export const vec3MaxComponent = (v) => Math.max(v[0], v[1], v[2]);
export const vec3Sum = (v) => v[0] + v[1] + v[2];
export const vec3Average = (v) => (v[0] + v[1] + v[2]) / 3;
export const vec3DominantAxis = (v) => {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
};

// Utility
export const vec3ToString = (v, precision = 3) =>
  `(${v[0].toFixed(precision)}, ${v[1].toFixed(precision)}, ${v[2].toFixed(precision)})`;
export const vec3ToArray = (v, out = [], offset = 0) => {
  out[offset] = v[0]; out[offset + 1] = v[1]; out[offset + 2] = v[2];
  return out;
};
export const vec3GetComponent = (v, index) => v[index];
export const vec3SetComponent = (v, index, value) => { const out = vec3Clone(v); out[index] = value; return out; };

// Pack/unpack for GPU buffers (vec3 → vec4 with w=0 or w=1)
export const vec3ToVec4Point = (v) => [v[0], v[1], v[2], 1];
export const vec3ToVec4Direction = (v) => [v[0], v[1], v[2], 0];

// ============================================================================
// DEEP AUDIT ADDITIONS — Godot, Unity, wgpu-matrix, WGSL, research papers
// ============================================================================

// --- Common game engine operations (Godot/Unity) ---

// Normalized direction from a to b (Godot: direction_to)
export const vec3DirectionTo = (from, to) => vec3Normalize(vec3Sub(to, from));

// Midpoint between two vectors (wgpu-matrix: midpoint)
export const vec3Midpoint = (a, b) => [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];

// Bounce off surface normal (Godot: bounce = -reflect)
export const vec3Bounce = (v, n) => {
  const d = 2 * vec3Dot(v, n);
  return [-v[0] + d * n[0], -v[1] + d * n[1], -v[2] + d * n[2]];
};

// Lerp without clamping t (Unity: LerpUnclamped)
export const vec3LerpUnclamped = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Per-component lerp with vector t (wgpu-matrix: lerpV)
export const vec3LerpV = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t[0],
  a[1] + (b[1] - a[1]) * t[1],
  a[2] + (b[2] - a[2]) * t[2],
];

// Rotate towards target direction (Unity: RotateTowards)
export function vec3RotateTowards(current, target, maxRadiansDelta, maxMagnitudeDelta) {
  const lenCur = vec3Length(current);
  const lenTgt = vec3Length(target);
  if (lenCur < EPSILON || lenTgt < EPSILON) return vec3Clone(target);

  const nCur = vec3Scale(current, 1 / lenCur);
  const nTgt = vec3Scale(target, 1 / lenTgt);
  const cosAngle = clamp(vec3Dot(nCur, nTgt), -1, 1);
  const angle = Math.acos(cosAngle);

  let dir;
  if (angle < EPSILON) {
    dir = nTgt;
  } else {
    const t = Math.min(1, maxRadiansDelta / angle);
    dir = vec3Normalize(vec3Slerp(nCur, nTgt, t));
  }

  const newLen = lenCur + clamp(lenTgt - lenCur, -maxMagnitudeDelta, maxMagnitudeDelta);
  return vec3Scale(dir, newLen);
}

// Spring-damper smooth follow (Unity: SmoothDamp — critically damped spring)
export function vec3SmoothDamp(current, target, currentVelocity, smoothTime, dt, maxSpeed = Infinity) {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  let dx = current[0] - target[0];
  let dy = current[1] - target[1];
  let dz = current[2] - target[2];

  // Clamp maximum speed
  const maxChange = maxSpeed * st;
  const maxChangeSq = maxChange * maxChange;
  const sqDist = dx * dx + dy * dy + dz * dz;
  if (sqDist > maxChangeSq) {
    const mag = Math.sqrt(sqDist);
    dx = dx / mag * maxChange;
    dy = dy / mag * maxChange;
    dz = dz / mag * maxChange;
  }

  const tx = (currentVelocity[0] + omega * dx) * dt;
  const ty = (currentVelocity[1] + omega * dy) * dt;
  const tz = (currentVelocity[2] + omega * dz) * dt;

  const newVelX = (currentVelocity[0] - omega * tx) * exp;
  const newVelY = (currentVelocity[1] - omega * ty) * exp;
  const newVelZ = (currentVelocity[2] - omega * tz) * exp;

  let outX = (current[0] - dx) + (dx + tx) * exp;
  let outY = (current[1] - dy) + (dy + ty) * exp;
  let outZ = (current[2] - dz) + (dz + tz) * exp;

  // Prevent overshoot
  const origMinusCurX = target[0] - current[0];
  const origMinusCurY = target[1] - current[1];
  const origMinusCurZ = target[2] - current[2];
  const outMinusOrigX = outX - target[0];
  const outMinusOrigY = outY - target[1];
  const outMinusOrigZ = outZ - target[2];
  if (origMinusCurX * outMinusOrigX + origMinusCurY * outMinusOrigY + origMinusCurZ * outMinusOrigZ > 0) {
    outX = target[0]; outY = target[1]; outZ = target[2];
    return { value: [outX, outY, outZ], velocity: [(target[0] - outX) / dt, (target[1] - outY) / dt, (target[2] - outZ) / dt] };
  }

  return { value: [outX, outY, outZ], velocity: [newVelX, newVelY, newVelZ] };
}

// Gram-Schmidt orthonormalize (Unity: OrthoNormalize)
export function vec3OrthoNormalize(normal, tangent) {
  const n = vec3Normalize(normal);
  const t = vec3Normalize(vec3Sub(tangent, vec3Scale(n, vec3Dot(tangent, n))));
  return { normal: n, tangent: t, bitangent: vec3Cross(n, t) };
}

// --- WGSL built-in parity ---

// faceForward: flip v to face same hemisphere as reference w.r.t. incident
export const vec3FaceForward = (v, incident, reference) =>
  vec3Dot(reference, incident) < 0 ? [v[0], v[1], v[2]] : [-v[0], -v[1], -v[2]];

// Snell's law refraction (WGSL: refract)
export function vec3Refract(incident, normal, eta) {
  const d = vec3Dot(normal, incident);
  const k = 1 - eta * eta * (1 - d * d);
  if (k < 0) return [0, 0, 0]; // Total internal reflection
  const f = eta * d + Math.sqrt(k);
  return [eta * incident[0] - f * normal[0], eta * incident[1] - f * normal[1], eta * incident[2] - f * normal[2]];
}

// Saturate: clamp all components to [0, 1]
export const vec3Saturate = (v) => [clamp(v[0], 0, 1), clamp(v[1], 0, 1), clamp(v[2], 0, 1)];

// Inverse sqrt per-component
export const vec3InverseSqrt = (v) => [1 / Math.sqrt(v[0]), 1 / Math.sqrt(v[1]), 1 / Math.sqrt(v[2])];

// Fused multiply-add: a * b + c per-component
export const vec3FMA = (a, b, c) => [a[0] * b[0] + c[0], a[1] * b[1] + c[1], a[2] * b[2] + c[2]];

// Step per-component (WGSL: step)
export const vec3Step = (edge, v) => [v[0] < edge[0] ? 0 : 1, v[1] < edge[1] ? 0 : 1, v[2] < edge[2] ? 0 : 1];
export const vec3StepScalar = (edge, v) => [v[0] < edge ? 0 : 1, v[1] < edge ? 0 : 1, v[2] < edge ? 0 : 1];

// Smoothstep per-component (WGSL: smoothstep)
export const vec3SmoothStepV = (low, high, v) => [smoothstep(low[0], high[0], v[0]), smoothstep(low[1], high[1], v[1]), smoothstep(low[2], high[2], v[2])];

// --- Godot additional ---

// Positive modulo (Godot: posmod/posmodv)
export const vec3PosMod = (v, m) => [mod(v[0], m), mod(v[1], m), mod(v[2], m)];
export const vec3PosModV = (v, m) => [mod(v[0], m[0]), mod(v[1], m[1]), mod(v[2], m[2])];

// Scalar min/max against all components (Godot: minf/maxf)
export const vec3MinScalar = (v, s) => [Math.min(v[0], s), Math.min(v[1], s), Math.min(v[2], s)];
export const vec3MaxScalar = (v, s) => [Math.max(v[0], s), Math.max(v[1], s), Math.max(v[2], s)];

// Snap with per-component step vector (Godot: snapped)
export const vec3SnapV = (v, step) => [
  Math.round(v[0] / step[0]) * step[0],
  Math.round(v[1] / step[1]) * step[1],
  Math.round(v[2] / step[2]) * step[2],
];

// Cubic Bezier derivative at t (Godot: bezier_derivative) — tangent vector on curve
export const vec3BezierDerivative = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  return [
    3 * (mt * mt * (p1[0] - p0[0]) + 2 * mt * t * (p2[0] - p1[0]) + t * t * (p3[0] - p2[0])),
    3 * (mt * mt * (p1[1] - p0[1]) + 2 * mt * t * (p2[1] - p1[1]) + t * t * (p3[1] - p2[1])),
    3 * (mt * mt * (p1[2] - p0[2]) + 2 * mt * t * (p2[2] - p1[2]) + t * t * (p3[2] - p2[2])),
  ];
};

// --- Octahedral normal encoding (Cigolle et al. 2014 / Godot octahedron_encode/decode) ---
// Compresses a unit normal vec3 → vec2, uniform precision, ideal for G-buffer/deferred

function _signNotZero2(v) {
  return [v[0] >= 0 ? 1 : -1, v[1] >= 0 ? 1 : -1];
}

export function vec3OctEncode(n) {
  const invL1 = 1 / (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]));
  let ox = n[0] * invL1;
  let oy = n[1] * invL1;
  if (n[2] < 0) {
    const s = _signNotZero2([ox, oy]);
    const tmpX = (1 - Math.abs(oy)) * s[0];
    const tmpY = (1 - Math.abs(ox)) * s[1];
    ox = tmpX;
    oy = tmpY;
  }
  return [ox * 0.5 + 0.5, oy * 0.5 + 0.5]; // Map to [0,1]
}

export function vec3OctDecode(uv) {
  let ox = uv[0] * 2 - 1;
  let oy = uv[1] * 2 - 1;
  const oz = 1 - Math.abs(ox) - Math.abs(oy);
  if (oz < 0) {
    const s = _signNotZero2([ox, oy]);
    const tmpX = (1 - Math.abs(oy)) * s[0];
    const tmpY = (1 - Math.abs(ox)) * s[1];
    ox = tmpX;
    oy = tmpY;
  }
  return vec3Normalize([ox, oy, oz]);
}

// --- Outer product (Godot: outer) → 3x3 matrix (column-major Float32Array) ---
export function vec3Outer(a, b) {
  return new Float32Array([
    a[0] * b[0], a[1] * b[0], a[2] * b[0],
    a[0] * b[1], a[1] * b[1], a[2] * b[1],
    a[0] * b[2], a[1] * b[2], a[2] * b[2],
  ]);
}

// --- Improved orthonormal basis (Duff et al. 2017, Pixar — more stable than Frisvad) ---
export function vec3OrthonormalBasisDuff(n) {
  const s = n[2] >= 0 ? 1 : -1;
  const a = -1 / (s + n[2]);
  const b = n[0] * n[1] * a;
  const tangent = [1 + s * n[0] * n[0] * a, s * b, -s * n[0]];
  const bitangent = [b, s + n[1] * n[1] * a, -n[1]];
  return { tangent, bitangent, normal: [n[0], n[1], n[2]] };
}

// --- Constants ---
export const vec3Infinity = () => [Infinity, Infinity, Infinity];
export const vec3NegInfinity = () => [-Infinity, -Infinity, -Infinity];
