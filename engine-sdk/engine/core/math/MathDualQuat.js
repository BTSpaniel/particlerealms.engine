// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathDualQuat.js - Dual Quaternion operations for skinning & rigid body interpolation
// Dual quaternion = [real_x, real_y, real_z, real_w, dual_x, dual_y, dual_z, dual_w]
// Real part = rotation quaternion, Dual part encodes translation
// Used for: DQS (Dual Quaternion Skinning), rigid body interpolation, screw motion

import { EPSILON } from './MathConstants.js';

// ============================================================================
// CREATION
// ============================================================================

export const dqCreate = (rx, ry, rz, rw, dx, dy, dz, dw) => [rx, ry, rz, rw, dx, dy, dz, dw];

export const dqIdentity = () => [0, 0, 0, 1, 0, 0, 0, 0];

export const dqClone = (dq) => [dq[0], dq[1], dq[2], dq[3], dq[4], dq[5], dq[6], dq[7]];

export const dqCopy = (out, dq) => {
  out[0] = dq[0]; out[1] = dq[1]; out[2] = dq[2]; out[3] = dq[3];
  out[4] = dq[4]; out[5] = dq[5]; out[6] = dq[6]; out[7] = dq[7];
  return out;
};

export function dqFromRotationTranslation(q, t) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = t[0] * 0.5, ty = t[1] * 0.5, tz = t[2] * 0.5;
  return [
    qx, qy, qz, qw,
    tx * qw + ty * qz - tz * qy,
    -tx * qz + ty * qw + tz * qx,
    tx * qy - ty * qx + tz * qw,
    -tx * qx - ty * qy - tz * qz,
  ];
}

export function dqFromMat4(m) {
  // Extract rotation quaternion
  const trace = m[0] + m[5] + m[10];
  let qx, qy, qz, qw;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qw = 0.25 / s;
    qx = (m[6] - m[9]) * s;
    qy = (m[8] - m[2]) * s;
    qz = (m[1] - m[4]) * s;
  } else if (m[0] > m[5] && m[0] > m[10]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[5] - m[10]);
    qw = (m[6] - m[9]) / s;
    qx = 0.25 * s;
    qy = (m[1] + m[4]) / s;
    qz = (m[8] + m[2]) / s;
  } else if (m[5] > m[10]) {
    const s = 2 * Math.sqrt(1 + m[5] - m[0] - m[10]);
    qw = (m[8] - m[2]) / s;
    qx = (m[1] + m[4]) / s;
    qy = 0.25 * s;
    qz = (m[6] + m[9]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[10] - m[0] - m[5]);
    qw = (m[1] - m[4]) / s;
    qx = (m[8] + m[2]) / s;
    qy = (m[6] + m[9]) / s;
    qz = 0.25 * s;
  }
  return dqFromRotationTranslation([qx, qy, qz, qw], [m[12], m[13], m[14]]);
}

// ============================================================================
// EXTRACT
// ============================================================================

export const dqGetRotation = (dq) => [dq[0], dq[1], dq[2], dq[3]];

export function dqGetTranslation(dq) {
  const rx = dq[0], ry = dq[1], rz = dq[2], rw = dq[3];
  const dx = dq[4], dy = dq[5], dz = dq[6], dw = dq[7];
  return [
    2 * (-dw * rx + dx * rw - dy * rz + dz * ry),
    2 * (-dw * ry + dx * rz + dy * rw - dz * rx),
    2 * (-dw * rz - dx * ry + dy * rx + dz * rw),
  ];
}

export function dqToMat4(dq) {
  const len = Math.sqrt(dq[0]*dq[0] + dq[1]*dq[1] + dq[2]*dq[2] + dq[3]*dq[3]);
  if (len < EPSILON) return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const inv = 1 / len;
  const rx = dq[0]*inv, ry = dq[1]*inv, rz = dq[2]*inv, rw = dq[3]*inv;
  const dx = dq[4]*inv, dy = dq[5]*inv, dz = dq[6]*inv, dw = dq[7]*inv;

  const x2 = rx+rx, y2 = ry+ry, z2 = rz+rz;
  const xx = rx*x2, xy = rx*y2, xz = rx*z2;
  const yy = ry*y2, yz = ry*z2, zz = rz*z2;
  const wx = rw*x2, wy = rw*y2, wz = rw*z2;

  const tx = 2*(-dw*rx + dx*rw - dy*rz + dz*ry);
  const ty = 2*(-dw*ry + dx*rz + dy*rw - dz*rx);
  const tz = 2*(-dw*rz - dx*ry + dy*rx + dz*rw);

  return new Float32Array([
    1-(yy+zz), xy+wz,     xz-wy,     0,
    xy-wz,     1-(xx+zz), yz+wx,     0,
    xz+wy,     yz-wx,     1-(xx+yy), 0,
    tx,         ty,         tz,         1,
  ]);
}

// ============================================================================
// OPERATIONS
// ============================================================================

export function dqMultiply(a, b) {
  const ar = a, br = b;
  // Real = a_real * b_real
  const rw = ar[3]*br[3] - ar[0]*br[0] - ar[1]*br[1] - ar[2]*br[2];
  const rx = ar[3]*br[0] + ar[0]*br[3] + ar[1]*br[2] - ar[2]*br[1];
  const ry = ar[3]*br[1] - ar[0]*br[2] + ar[1]*br[3] + ar[2]*br[0];
  const rz = ar[3]*br[2] + ar[0]*br[1] - ar[1]*br[0] + ar[2]*br[3];
  // Dual = a_real * b_dual + a_dual * b_real
  const dw = ar[3]*br[7] - ar[0]*br[4] - ar[1]*br[5] - ar[2]*br[6]
           + a[7]*br[3] - a[4]*br[0] - a[5]*br[1] - a[6]*br[2];
  const dx = ar[3]*br[4] + ar[0]*br[7] + ar[1]*br[6] - ar[2]*br[5]
           + a[7]*br[0] + a[4]*br[3] + a[5]*br[2] - a[6]*br[1];
  const dy = ar[3]*br[5] - ar[0]*br[6] + ar[1]*br[7] + ar[2]*br[4]
           + a[7]*br[1] - a[4]*br[2] + a[5]*br[3] + a[6]*br[0];
  const dz = ar[3]*br[6] + ar[0]*br[5] - ar[1]*br[4] + ar[2]*br[7]
           + a[7]*br[2] + a[4]*br[1] - a[5]*br[0] + a[6]*br[3];
  return [rx, ry, rz, rw, dx, dy, dz, dw];
}

export const dqAdd = (a, b) => [
  a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3],
  a[4]+b[4], a[5]+b[5], a[6]+b[6], a[7]+b[7],
];

export const dqScale = (dq, s) => [
  dq[0]*s, dq[1]*s, dq[2]*s, dq[3]*s,
  dq[4]*s, dq[5]*s, dq[6]*s, dq[7]*s,
];

export function dqConjugate(dq) {
  return [-dq[0], -dq[1], -dq[2], dq[3], -dq[4], -dq[5], -dq[6], dq[7]];
}

export function dqNormalize(dq) {
  const len = Math.sqrt(dq[0]*dq[0] + dq[1]*dq[1] + dq[2]*dq[2] + dq[3]*dq[3]);
  if (len < EPSILON) return dqIdentity();
  const inv = 1 / len;
  const rx = dq[0]*inv, ry = dq[1]*inv, rz = dq[2]*inv, rw = dq[3]*inv;
  const dx = dq[4]*inv, dy = dq[5]*inv, dz = dq[6]*inv, dw = dq[7]*inv;
  // Ensure dual part is orthogonal to real part
  const dot = rx*dx + ry*dy + rz*dz + rw*dw;
  return [rx, ry, rz, rw, dx - rx*dot, dy - ry*dot, dz - rz*dot, dw - rw*dot];
}

export function dqInverse(dq) {
  const lenSq = dq[0]*dq[0] + dq[1]*dq[1] + dq[2]*dq[2] + dq[3]*dq[3];
  if (lenSq < EPSILON) return dqIdentity();
  const conj = dqConjugate(dq);
  const inv = 1 / lenSq;
  return dqScale(conj, inv);
}

// ============================================================================
// INTERPOLATION
// ============================================================================

export function dqLerp(a, b, t) {
  // Ensure shortest path
  let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  const sign = dot < 0 ? -1 : 1;
  const s = 1 - t;
  return dqNormalize([
    s*a[0] + t*sign*b[0], s*a[1] + t*sign*b[1], s*a[2] + t*sign*b[2], s*a[3] + t*sign*b[3],
    s*a[4] + t*sign*b[4], s*a[5] + t*sign*b[5], s*a[6] + t*sign*b[6], s*a[7] + t*sign*b[7],
  ]);
}

export function dqSclerp(a, b, t) {
  // Screw Linear Interpolation — constant-velocity screw motion
  const diff = dqMultiply(dqConjugate(a), b);
  // Log of unit dual quaternion
  const realLen = Math.sqrt(diff[0]*diff[0] + diff[1]*diff[1] + diff[2]*diff[2]);
  if (realLen < EPSILON) {
    return dqLerp(a, b, t);
  }
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, diff[3])));
  const pitchD = -2 * diff[7] / realLen;
  const dir = [diff[0] / realLen, diff[1] / realLen, diff[2] / realLen];
  const moment = [(diff[4] - dir[0] * pitchD * diff[3] * 0.5) / realLen,
                  (diff[5] - dir[1] * pitchD * diff[3] * 0.5) / realLen,
                  (diff[6] - dir[2] * pitchD * diff[3] * 0.5) / realLen];
  // Exp with scaled parameters
  const ta = angle * t;
  const td = pitchD * t;
  const sinHalf = Math.sin(ta * 0.5);
  const cosHalf = Math.cos(ta * 0.5);
  const real = [dir[0]*sinHalf, dir[1]*sinHalf, dir[2]*sinHalf, cosHalf];
  const dualW = -td * 0.5 * sinHalf;
  const dualXYZ = [
    sinHalf*moment[0] + td*0.5*cosHalf*dir[0],
    sinHalf*moment[1] + td*0.5*cosHalf*dir[1],
    sinHalf*moment[2] + td*0.5*cosHalf*dir[2],
  ];
  const step = [real[0], real[1], real[2], real[3], dualXYZ[0], dualXYZ[1], dualXYZ[2], dualW];
  return dqMultiply(a, step);
}

// ============================================================================
// TRANSFORM
// ============================================================================

export function dqTransformPoint(dq, point) {
  const px = point[0], py = point[1], pz = point[2];
  const rx = dq[0], ry = dq[1], rz = dq[2], rw = dq[3];
  // Rotate
  const tx = 2 * (ry * pz - rz * py);
  const ty = 2 * (rz * px - rx * pz);
  const tz = 2 * (rx * py - ry * px);
  const rotX = px + rw * tx + (ry * tz - rz * ty);
  const rotY = py + rw * ty + (rz * tx - rx * tz);
  const rotZ = pz + rw * tz + (rx * ty - ry * tx);
  // Translate
  const trans = dqGetTranslation(dq);
  return [rotX + trans[0], rotY + trans[1], rotZ + trans[2]];
}

export function dqTransformVec3(dq, vec) {
  const vx = vec[0], vy = vec[1], vz = vec[2];
  const rx = dq[0], ry = dq[1], rz = dq[2], rw = dq[3];
  const tx = 2 * (ry * vz - rz * vy);
  const ty = 2 * (rz * vx - rx * vz);
  const tz = 2 * (rx * vy - ry * vx);
  return [
    vx + rw * tx + (ry * tz - rz * ty),
    vy + rw * ty + (rz * tx - rx * tz),
    vz + rw * tz + (rx * ty - ry * tx),
  ];
}

// ============================================================================
// COMPARISON
// ============================================================================

export function dqEquals(a, b, eps = EPSILON) {
  for (let i = 0; i < 8; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}

export const dqDot = (a, b) =>
  a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];

export const dqLength = (dq) =>
  Math.sqrt(dq[0]*dq[0] + dq[1]*dq[1] + dq[2]*dq[2] + dq[3]*dq[3]);
