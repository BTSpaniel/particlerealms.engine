// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathMat.js - Mat2, Mat3, extended Mat4 operations (column-major Float32Array)
// Supplements EngineMath.js with additional matrix operations
// Depends on: MathConstants.js, EngineMath.js

import { EPSILON, DEG2RAD } from './MathConstants.js';

// ============================================================================
// MAT2 - 2x2 Matrix (column-major)
// ============================================================================

export const mat2Identity = () => new Float32Array([1, 0, 0, 1]);
export const mat2 = (a, b, c, d) => new Float32Array([a, b, c, d]);
export const mat2Clone = (m) => new Float32Array(m);
export const mat2Copy = (out, m) => { out[0] = m[0]; out[1] = m[1]; out[2] = m[2]; out[3] = m[3]; return out; };

export const mat2Multiply = (a, b) => new Float32Array([
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
]);

export const mat2Determinant = (m) => m[0] * m[3] - m[2] * m[1];

export function mat2Inverse(m) {
  const det = mat2Determinant(m);
  if (Math.abs(det) < EPSILON) return mat2Identity();
  const inv = 1 / det;
  return new Float32Array([m[3] * inv, -m[1] * inv, -m[2] * inv, m[0] * inv]);
}

export const mat2Transpose = (m) => new Float32Array([m[0], m[2], m[1], m[3]]);

export const mat2FromRotation = (angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c, s, -s, c]);
};

export const mat2FromScale = (sx, sy) => new Float32Array([sx, 0, 0, sy]);

export const mat2TransformVec2 = (m, v) => [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];

// ============================================================================
// MAT3 - 3x3 Matrix (column-major)
// ============================================================================

export const mat3Identity = () => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
export const mat3Clone = (m) => new Float32Array(m);
export const mat3Copy = (out, m) => { for (let i = 0; i < 9; i++) out[i] = m[i]; return out; };

export const mat3FromMat4 = (m) => new Float32Array([
  m[0], m[1], m[2],
  m[4], m[5], m[6],
  m[8], m[9], m[10],
]);

export function mat3Multiply(a, b) {
  const out = new Float32Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[j * 3 + i] = a[i] * b[j * 3] + a[i + 3] * b[j * 3 + 1] + a[i + 6] * b[j * 3 + 2];
    }
  }
  return out;
}

export const mat3Determinant = (m) =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[3] * (m[1] * m[8] - m[2] * m[7]) +
  m[6] * (m[1] * m[5] - m[2] * m[4]);

export function mat3Inverse(m) {
  const det = mat3Determinant(m);
  if (Math.abs(det) < EPSILON) return mat3Identity();
  const inv = 1 / det;
  return new Float32Array([
    (m[4] * m[8] - m[5] * m[7]) * inv,
    (m[2] * m[7] - m[1] * m[8]) * inv,
    (m[1] * m[5] - m[2] * m[4]) * inv,
    (m[5] * m[6] - m[3] * m[8]) * inv,
    (m[0] * m[8] - m[2] * m[6]) * inv,
    (m[2] * m[3] - m[0] * m[5]) * inv,
    (m[3] * m[7] - m[4] * m[6]) * inv,
    (m[1] * m[6] - m[0] * m[7]) * inv,
    (m[0] * m[4] - m[1] * m[3]) * inv,
  ]);
}

export const mat3Transpose = (m) => new Float32Array([
  m[0], m[3], m[6],
  m[1], m[4], m[7],
  m[2], m[5], m[8],
]);

// Normal matrix from mat4 (inverse transpose of upper-left 3x3)
export function mat3NormalFromMat4(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(det) < EPSILON) return mat3Identity();
  det = 1 / det;
  return new Float32Array([
    b01 * det, (-a22 * a01 + a02 * a21) * det, (a12 * a01 - a02 * a11) * det,
    b11 * det, (a22 * a00 - a02 * a20) * det, (-a12 * a00 + a02 * a10) * det,
    b21 * det, (-a21 * a00 + a01 * a20) * det, (a11 * a00 - a01 * a10) * det,
  ]);
}

export const mat3FromRotationX = (angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, c, s, 0, -s, c]);
};

export const mat3FromRotationY = (angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]);
};

export const mat3FromRotationZ = (angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1]);
};

export function mat3FromQuat(q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return new Float32Array([
    1 - (yy + zz), xy + wz, xz - wy,
    xy - wz, 1 - (xx + zz), yz + wx,
    xz + wy, yz - wx, 1 - (xx + yy),
  ]);
}

export const mat3TransformVec3 = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

// 2D transformation matrix (translation in column 2)
export const mat3FromTranslation2D = (x, y) => new Float32Array([1, 0, 0, 0, 1, 0, x, y, 1]);
export const mat3FromScale2D = (sx, sy) => new Float32Array([sx, 0, 0, 0, sy, 0, 0, 0, 1]);
export const mat3FromRotation2D = (angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1]);
};

// ============================================================================
// MAT4 EXTENDED - Additional 4x4 operations
// (Basic mat4 ops are in EngineMath.js)
// ============================================================================

export const mat4Clone = (m) => new Float32Array(m);
export const mat4Copy = (out, m) => { for (let i = 0; i < 16; i++) out[i] = m[i]; return out; };

export const mat4Transpose = (m) => new Float32Array([
  m[0], m[4], m[8], m[12],
  m[1], m[5], m[9], m[13],
  m[2], m[6], m[10], m[14],
  m[3], m[7], m[11], m[15],
]);

export function mat4Determinant(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
}

// Multiply multiple matrices in order
export function mat4MultiplyMany(...matrices) {
  if (matrices.length === 0) return mat4Identity();
  let result = new Float32Array(matrices[0]);
  for (let i = 1; i < matrices.length; i++) {
    result = mat4MultiplyInto(new Float32Array(16), result, matrices[i]);
  }
  return result;
}

// In-place multiply
export function mat4MultiplyInto(out, a, b) {
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
    out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
    out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
    out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
  return out;
}

// Create from components
export const mat4FromTranslation = (x, y, z) => new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1,
]);
export const mat4FromTranslationVec3 = (v) => mat4FromTranslation(v[0], v[1], v[2]);

export const mat4FromScale = (sx, sy, sz) => new Float32Array([
  sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1,
]);
export const mat4FromScaleVec3 = (v) => mat4FromScale(v[0], v[1], v[2]);
export const mat4FromScaleUniform = (s) => mat4FromScale(s, s, s);

export const mat4FromRotationX = (angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
};

export const mat4FromRotationY = (angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
};

export const mat4FromRotationZ = (angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
};

export function mat4FromRotationAxis(axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const x = axis[0], y = axis[1], z = axis[2];
  return new Float32Array([
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4FromQuat(q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return new Float32Array([
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1,
  ]);
}

export function mat4FromRotationTranslationScale(q, t, s) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = s[0], sy = s[1], sz = s[2];
  return new Float32Array([
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ]);
}

export const mat4Compose = mat4FromRotationTranslationScale;

// Decompose matrix into translation, rotation, scale
export function mat4Decompose(m) {
  const translation = [m[12], m[13], m[14]];
  
  let sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
  const sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
  const sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
  
  // Check for negative scale
  if (mat4Determinant(m) < 0) sx = -sx;
  
  const scale = [sx, sy, sz];

  const absSx = Math.abs(sx);
  const absSy = Math.abs(sy);
  const absSz = Math.abs(sz);
  if (
    !Number.isFinite(absSx) || !Number.isFinite(absSy) || !Number.isFinite(absSz) ||
    absSx <= EPSILON || absSy <= EPSILON || absSz <= EPSILON
  ) {
    // A collapsed transform axis has no unique recoverable rotation.
    return { translation, rotation: [0, 0, 0, 1], scale };
  }
  
  // Extract rotation (normalized)
  const rotMat = new Float32Array([
    m[0] / sx, m[1] / sx, m[2] / sx, 0,
    m[4] / sy, m[5] / sy, m[6] / sy, 0,
    m[8] / sz, m[9] / sz, m[10] / sz, 0,
    0, 0, 0, 1,
  ]);
  
  // Convert to quaternion (import quatFromRotationMatrix if needed)
  const trace = rotMat[0] + rotMat[5] + rotMat[10];
  let rotation;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    rotation = [(rotMat[6] - rotMat[9]) * s, (rotMat[8] - rotMat[2]) * s, (rotMat[1] - rotMat[4]) * s, 0.25 / s];
  } else if (rotMat[0] > rotMat[5] && rotMat[0] > rotMat[10]) {
    const s = 2 * Math.sqrt(1 + rotMat[0] - rotMat[5] - rotMat[10]);
    rotation = [0.25 * s, (rotMat[1] + rotMat[4]) / s, (rotMat[8] + rotMat[2]) / s, (rotMat[6] - rotMat[9]) / s];
  } else if (rotMat[5] > rotMat[10]) {
    const s = 2 * Math.sqrt(1 + rotMat[5] - rotMat[0] - rotMat[10]);
    rotation = [(rotMat[1] + rotMat[4]) / s, 0.25 * s, (rotMat[6] + rotMat[9]) / s, (rotMat[8] - rotMat[2]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + rotMat[10] - rotMat[0] - rotMat[5]);
    rotation = [(rotMat[8] + rotMat[2]) / s, (rotMat[6] + rotMat[9]) / s, 0.25 * s, (rotMat[1] - rotMat[4]) / s];
  }
  
  return { translation, rotation, scale };
}

// Extract components
export const mat4GetTranslation = (m) => [m[12], m[13], m[14]];
export const mat4GetScale = (m) => [
  Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]),
  Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]),
  Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]),
];

// Direction vectors
const _normalize = (v) => {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return l < EPSILON ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l];
};

export const mat4GetForward = (m) => _normalize([-m[8], -m[9], -m[10]]);
export const mat4GetRight = (m) => _normalize([m[0], m[1], m[2]]);
export const mat4GetUp = (m) => _normalize([m[4], m[5], m[6]]);
export const mat4GetBack = (m) => _normalize([m[8], m[9], m[10]]);

// Transform operations
export function mat4TransformPoint(m, v) {
  const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15];
  const invW = Math.abs(w) < EPSILON ? 1 : 1 / w;
  return [
    (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) * invW,
    (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) * invW,
    (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) * invW,
  ];
}

export const mat4TransformDirection = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];

// Lerp matrices element-wise
export function mat4Lerp(a, b, t) {
  const out = new Float32Array(16);
  for (let i = 0; i < 16; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

// Comparison
export function mat4Equals(a, b, eps = EPSILON) {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) >= eps) return false;
  return true;
}

// Is identity check
export function mat4IsIdentity(m, eps = EPSILON) {
  return Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3]) < eps &&
         Math.abs(m[4]) < eps && Math.abs(m[5] - 1) < eps && Math.abs(m[6]) < eps && Math.abs(m[7]) < eps &&
         Math.abs(m[8]) < eps && Math.abs(m[9]) < eps && Math.abs(m[10] - 1) < eps && Math.abs(m[11]) < eps &&
         Math.abs(m[12]) < eps && Math.abs(m[13]) < eps && Math.abs(m[14]) < eps && Math.abs(m[15] - 1) < eps;
}

// Frustum projection
export function mat4Frustum(left, right, bottom, top, near, far) {
  const rl = 1 / (right - left);
  const tb = 1 / (top - bottom);
  const nf = 1 / (near - far);
  return new Float32Array([
    near * 2 * rl, 0, 0, 0,
    0, near * 2 * tb, 0, 0,
    (right + left) * rl, (top + bottom) * tb, (far + near) * nf, -1,
    0, 0, far * near * 2 * nf, 0,
  ]);
}

// Infinite perspective (for reverse-Z)
export function mat4PerspectiveInfinite(fov, aspect, near) {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, -1, -1,
    0, 0, -2 * near, 0,
  ]);
}

// Reverse-Z perspective (better depth precision)
export function mat4PerspectiveReverseZ(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (far - near);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, near * nf, -1,
    0, 0, far * near * nf, 0,
  ]);
}

// Target-to (world-space transform looking at target)
export function mat4TargetTo(eye, target, up) {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
  const z = len < EPSILON ? [0, 0, 1] : [zx / len, zy / len, zz / len];
  
  let xx = up[1] * z[2] - up[2] * z[1];
  let xy = up[2] * z[0] - up[0] * z[2];
  let xz = up[0] * z[1] - up[1] * z[0];
  len = Math.sqrt(xx * xx + xy * xy + xz * xz);
  const x = len < EPSILON ? [1, 0, 0] : [xx / len, xy / len, xz / len];
  
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  
  return new Float32Array([
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    eye[0], eye[1], eye[2], 1,
  ]);
}

// Rotate existing matrix by angle around axis (gl-matrix: mat4.rotate)
export function mat4Rotate(m, axis, angle) {
  return mat4MultiplyInto(new Float32Array(16), m, mat4FromRotationAxis(axis, angle));
}

// Invert + transpose for normal transforms (common pipeline helper)
export function mat4InverseTranspose(m) {
  const inv = mat3Inverse(mat3FromMat4(m));
  return mat3Transpose(inv);
}

// Required identity function
function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
