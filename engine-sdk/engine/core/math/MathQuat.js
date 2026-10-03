// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathQuat.js - Extended Quaternion operations [x, y, z, w]
// Supplements the basic quat ops in EngineMath.js with advanced features
// Depends on: MathConstants.js, MathScalar.js

import { EPSILON, TAU, DEG2RAD, RAD2DEG } from './MathConstants.js';
import { random } from './MathRandom.js';
import { clamp } from './MathScalar.js';

// Creation
export const quat = (x = 0, y = 0, z = 0, w = 1) => [x, y, z, w];
export const quatIdentity = () => [0, 0, 0, 1];
export const quatClone = (q) => [q[0], q[1], q[2], q[3]];
export const quatCopy = (out, q) => { out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; out[3] = q[3]; return out; };
export const quatSet = (out, x, y, z, w) => { out[0] = x; out[1] = y; out[2] = z; out[3] = w; return out; };

// From axis-angle
export function quatFromAxisAngle(axis, angle) {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

// From Euler angles (radians)
export function quatFromEuler(x, y, z, order = 'XYZ') {
  const c1 = Math.cos(x * 0.5), c2 = Math.cos(y * 0.5), c3 = Math.cos(z * 0.5);
  const s1 = Math.sin(x * 0.5), s2 = Math.sin(y * 0.5), s3 = Math.sin(z * 0.5);
  switch (order) {
    case 'XYZ': return [s1*c2*c3+c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3+s1*s2*c3, c1*c2*c3-s1*s2*s3];
    case 'YXZ': return [s1*c2*c3+c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3-s1*s2*c3, c1*c2*c3+s1*s2*s3];
    case 'ZXY': return [s1*c2*c3-c1*s2*s3, c1*s2*c3+s1*c2*s3, c1*c2*s3+s1*s2*c3, c1*c2*c3-s1*s2*s3];
    case 'ZYX': return [s1*c2*c3-c1*s2*s3, c1*s2*c3+s1*c2*s3, c1*c2*s3-s1*s2*c3, c1*c2*c3+s1*s2*s3];
    case 'YZX': return [s1*c2*c3+c1*s2*s3, c1*s2*c3+s1*c2*s3, c1*c2*s3-s1*s2*c3, c1*c2*c3-s1*s2*s3];
    case 'XZY': return [s1*c2*c3-c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3+s1*s2*c3, c1*c2*c3+s1*s2*s3];
    default: return quatIdentity();
  }
}

// From Euler angles (degrees)
export const quatFromEulerDeg = (x, y, z, order = 'XYZ') =>
  quatFromEuler(x * DEG2RAD, y * DEG2RAD, z * DEG2RAD, order);

// To Euler angles (radians)
export function quatToEuler(q, order = 'XYZ') {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy;
  const m21 = xy + wz, m22 = 1 - (xx + zz), m23 = yz - wx;
  const m31 = xz - wy, m32 = yz + wx, m33 = 1 - (xx + yy);

  let ex, ey, ez;
  switch (order) {
    case 'XYZ':
      ey = Math.asin(clamp(m13, -1, 1));
      if (Math.abs(m13) < 0.9999999) { ex = Math.atan2(-m23, m33); ez = Math.atan2(-m12, m11); }
      else { ex = Math.atan2(m32, m22); ez = 0; }
      break;
    case 'YXZ':
      ex = Math.asin(-clamp(m23, -1, 1));
      if (Math.abs(m23) < 0.9999999) { ey = Math.atan2(m13, m33); ez = Math.atan2(m21, m22); }
      else { ey = Math.atan2(-m31, m11); ez = 0; }
      break;
    case 'ZXY':
      ex = Math.asin(clamp(m32, -1, 1));
      if (Math.abs(m32) < 0.9999999) { ey = Math.atan2(-m31, m33); ez = Math.atan2(-m12, m22); }
      else { ey = 0; ez = Math.atan2(m21, m11); }
      break;
    case 'ZYX':
      ey = Math.asin(-clamp(m31, -1, 1));
      if (Math.abs(m31) < 0.9999999) { ex = Math.atan2(m32, m33); ez = Math.atan2(m21, m11); }
      else { ex = 0; ez = Math.atan2(-m12, m22); }
      break;
    default: return [0, 0, 0];
  }
  return [ex, ey, ez];
}

// To Euler angles (degrees)
export const quatToEulerDeg = (q, order = 'XYZ') => {
  const e = quatToEuler(q, order);
  return [e[0] * RAD2DEG, e[1] * RAD2DEG, e[2] * RAD2DEG];
};

// From rotation matrix (column-major 4x4 or 3x3)
export function quatFromRotationMatrix(m) {
  const m11 = m[0], m12 = m[4] !== undefined ? m[4] : m[3], m13 = m[8] !== undefined ? m[8] : m[6];
  const m21 = m[1], m22 = m[5] !== undefined ? m[5] : m[4], m23 = m[9] !== undefined ? m[9] : m[7];
  const m31 = m[2], m32 = m[6] !== undefined ? m[6] : m[5], m33 = m[10] !== undefined ? m[10] : m[8];
  const trace = m11 + m22 + m33;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
  }
}

// From two vectors (rotation from 'from' to 'to')
export function quatFromVectors(from, to) {
  const r = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + 1;
  if (r < EPSILON) {
    // Vectors are opposite, need perpendicular axis
    if (Math.abs(from[0]) > Math.abs(from[2])) {
      return quatNormalize([-from[1], from[0], 0, 0]);
    }
    return quatNormalize([0, -from[2], from[1], 0]);
  }
  // Cross product
  const cx = from[1] * to[2] - from[2] * to[1];
  const cy = from[2] * to[0] - from[0] * to[2];
  const cz = from[0] * to[1] - from[1] * to[0];
  return quatNormalize([cx, cy, cz, r]);
}

// LookAt rotation (direction to look, up vector)
export function quatLookAt(direction, up = [0, 1, 0]) {
  // Normalize direction
  const dLen = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2);
  if (!Number.isFinite(dLen) || dLen < EPSILON) return quatIdentity();
  const fwd = [direction[0] / dLen, direction[1] / dLen, direction[2] / dLen];

  // Right = up × forward
  let rx = up[1] * fwd[2] - up[2] * fwd[1];
  let ry = up[2] * fwd[0] - up[0] * fwd[2];
  let rz = up[0] * fwd[1] - up[1] * fwd[0];
  const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (!Number.isFinite(rLen) || rLen < EPSILON) return quatIdentity();
  rx /= rLen; ry /= rLen; rz /= rLen;

  // Up = forward × right
  const ux = fwd[1] * rz - fwd[2] * ry;
  const uy = fwd[2] * rx - fwd[0] * rz;
  const uz = fwd[0] * ry - fwd[1] * rx;

  // Build rotation matrix and convert to quaternion
  const trace = rx + uy + fwd[2];
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(uz - fwd[1]) * s, (fwd[0] - rz) * s, (ry - ux) * s, 0.25 / s];
  } else if (rx > uy && rx > fwd[2]) {
    const s = 2 * Math.sqrt(1 + rx - uy - fwd[2]);
    return [0.25 * s, (ux + ry) / s, (fwd[0] + rz) / s, (uz - fwd[1]) / s];
  } else if (uy > fwd[2]) {
    const s = 2 * Math.sqrt(1 + uy - rx - fwd[2]);
    return [(ux + ry) / s, 0.25 * s, (fwd[1] + uz) / s, (fwd[0] - rz) / s];
  } else {
    const s = 2 * Math.sqrt(1 + fwd[2] - rx - uy);
    return [(fwd[0] + rz) / s, (fwd[1] + uz) / s, 0.25 * s, (ry - ux) / s];
  }
}

// Basic operations
export const quatAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
export const quatScale = (q, s) => [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
export const quatConjugate = (q) => [-q[0], -q[1], -q[2], q[3]];
export const quatNegate = (q) => [-q[0], -q[1], -q[2], -q[3]];

export function quatMultiply(a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatInverse(q) {
  const lenSq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  if (!Number.isFinite(lenSq) || lenSq < EPSILON) return quatIdentity();
  const inv = 1 / lenSq;
  return [-q[0] * inv, -q[1] * inv, -q[2] * inv, q[3] * inv];
}

export function quatNormalize(q) {
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (!Number.isFinite(len) || len < EPSILON) return quatIdentity();
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

// Length
export const quatLength = (q) => Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
export const quatLengthSq = (q) => q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
export const quatDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

// Rotate vector by quaternion
export function quatRotateVec3(v, q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

// Interpolation
export const quatLerp = (a, b, t) => quatNormalize([
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  a[3] + (b[3] - a[3]) * t,
]);

export function quatSlerp(a, b, t) {
  let dot = quatDot(a, b);
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];

  // Take shorter path
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }

  // If very close, use lerp to avoid division by zero
  if (dot > 0.9995) {
    return quatNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }

  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
  const s1 = sinTheta / sinTheta0;

  return [
    a[0] * s0 + bx * s1,
    a[1] * s0 + by * s1,
    a[2] * s0 + bz * s1,
    a[3] * s0 + bw * s1,
  ];
}

// Squad interpolation (smooth spline through quaternions)
export const quatSquad = (q0, q1, q2, q3, t) => {
  const s0 = quatSlerp(q0, q3, t);
  const s1 = quatSlerp(q1, q2, t);
  return quatSlerp(s0, s1, 2 * t * (1 - t));
};

// Get axis and angle
export function quatGetAxis(q) {
  const sinHalf = Math.sqrt(1 - q[3] * q[3]);
  if (sinHalf < EPSILON) return [1, 0, 0];
  return [q[0] / sinHalf, q[1] / sinHalf, q[2] / sinHalf];
}

export const quatGetAngle = (q) => 2 * Math.acos(clamp(q[3], -1, 1));

// Angle between two quaternions
export const quatAngleBetween = (a, b) => 2 * Math.acos(clamp(Math.abs(quatDot(a, b)), 0, 1));

// Comparison
export function quatEquals(a, b, eps = EPSILON) {
  return (
    (Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps &&
     Math.abs(a[2] - b[2]) < eps && Math.abs(a[3] - b[3]) < eps) ||
    (Math.abs(a[0] + b[0]) < eps && Math.abs(a[1] + b[1]) < eps &&
     Math.abs(a[2] + b[2]) < eps && Math.abs(a[3] + b[3]) < eps)
  );
}

// Random uniform quaternion
export function quatRandom() {
  const u1 = random(), u2 = random(), u3 = random();
  const sq1 = Math.sqrt(1 - u1), sq2 = Math.sqrt(u1);
  return [
    sq1 * Math.sin(TAU * u2),
    sq1 * Math.cos(TAU * u2),
    sq2 * Math.sin(TAU * u3),
    sq2 * Math.cos(TAU * u3),
  ];
}

// Exponential and logarithm (for smooth interpolation)
export function quatExp(q) {
  const vLen = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2]);
  const expW = Math.exp(q[3]);
  if (vLen < EPSILON) return [0, 0, 0, expW];
  const s = expW * Math.sin(vLen) / vLen;
  return [q[0] * s, q[1] * s, q[2] * s, expW * Math.cos(vLen)];
}

export function quatLog(q) {
  const vLen = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2]);
  const qLen = quatLength(q);
  if (vLen < EPSILON) return [0, 0, 0, Math.log(qLen)];
  const s = Math.acos(clamp(q[3] / qLen, -1, 1)) / vLen;
  return [q[0] * s, q[1] * s, q[2] * s, Math.log(qLen)];
}

export const quatPow = (q, n) => quatExp(quatScale(quatLog(q), n));

// Rotate around axis
export const quatRotateX = (q, angle) => quatMultiply(q, quatFromAxisAngle([1, 0, 0], angle));
export const quatRotateY = (q, angle) => quatMultiply(q, quatFromAxisAngle([0, 1, 0], angle));
export const quatRotateZ = (q, angle) => quatMultiply(q, quatFromAxisAngle([0, 0, 1], angle));

// Get forward/right/up vectors from quaternion
export const quatForward = (q) => quatRotateVec3([0, 0, -1], q);
export const quatRight = (q) => quatRotateVec3([1, 0, 0], q);
export const quatUp = (q) => quatRotateVec3([0, 1, 0], q);
export const quatBack = (q) => quatRotateVec3([0, 0, 1], q);

// Utility
export const quatToString = (q, precision = 3) =>
  `(${q[0].toFixed(precision)}, ${q[1].toFixed(precision)}, ${q[2].toFixed(precision)}, ${q[3].toFixed(precision)})`;

// ============================================================================
// DEEP AUDIT ADDITIONS — Unity, Godot, gl-matrix parity
// ============================================================================

// Rotate towards target quaternion with max angle step (Unity: RotateTowards)
export function quatRotateTowards(from, to, maxRadiansDelta) {
  const angle = quatAngleBetween(from, to);
  if (angle < EPSILON) return quatClone(to);
  const t = Math.min(1, maxRadiansDelta / angle);
  return quatSlerp(from, to, t);
}

// Slerp without clamping t (Unity: SlerpUnclamped)
export function quatSlerpUnclamped(a, b, t) {
  let dot = quatDot(a, b);
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dot > 0.9995) {
    return quatNormalize([a[0]+(bx-a[0])*t, a[1]+(by-a[1])*t, a[2]+(bz-a[2])*t, a[3]+(bw-a[3])*t]);
  }
  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
  const s1 = sinTheta / sinTheta0;
  return [a[0]*s0+bx*s1, a[1]*s0+by*s1, a[2]*s0+bz*s1, a[3]*s0+bw*s1];
}

// Delta rotation: returns q such that q * from = to → q = to * inverse(from)
export const quatDifference = (from, to) => quatMultiply(to, quatInverse(from));

// To axis-angle pair (combined convenience)
export function quatToAxisAngle(q) {
  const angle = 2 * Math.acos(clamp(q[3], -1, 1));
  const sinHalf = Math.sqrt(1 - q[3] * q[3]);
  const axis = sinHalf < EPSILON ? [1, 0, 0] : [q[0] / sinHalf, q[1] / sinHalf, q[2] / sinHalf];
  return { axis, angle };
}

// Swing-twist decomposition (useful for animation constraints)
export function quatSwingTwist(q, twistAxis) {
  const projection = q[0] * twistAxis[0] + q[1] * twistAxis[1] + q[2] * twistAxis[2];
  const twist = quatNormalize([twistAxis[0] * projection, twistAxis[1] * projection, twistAxis[2] * projection, q[3]]);
  const swing = quatMultiply(q, quatInverse(twist));
  return { swing, twist };
}

// Checks
export const quatIsIdentity = (q, eps = EPSILON) =>
  Math.abs(q[0]) < eps && Math.abs(q[1]) < eps && Math.abs(q[2]) < eps && Math.abs(q[3] - 1) < eps;
export const quatIsNormalized = (q, eps = EPSILON) => Math.abs(quatLengthSq(q) - 1) < eps;
export const quatIsFinite = (q) =>
  Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]) && Number.isFinite(q[3]);

// Integrate angular velocity (for physics: q' = q + 0.5 * [wx,wy,wz,0] * q * dt)
export function quatIntegrateAngularVelocity(q, angularVel, dt) {
  const hx = angularVel[0] * dt * 0.5;
  const hy = angularVel[1] * dt * 0.5;
  const hz = angularVel[2] * dt * 0.5;
  return quatNormalize([
    q[0] + (hx * q[3] + hy * q[2] - hz * q[1]),
    q[1] + (hy * q[3] + hz * q[0] - hx * q[2]),
    q[2] + (hz * q[3] + hx * q[1] - hy * q[0]),
    q[3] - (hx * q[0] + hy * q[1] + hz * q[2]),
  ]);
}
