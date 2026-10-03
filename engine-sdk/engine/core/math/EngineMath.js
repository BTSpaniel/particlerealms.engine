// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// EngineMath - basic 3D vector and matrix helpers shared across engine and tests
// Pure math, no rendering or platform side effects.

// =============================
// Vec3 utilities - re-exported from MathVec3.js (single source of truth)
// =============================
import {
  vec3, vec3Add, vec3Sub, vec3Scale,
  vec3Dot, vec3Cross, vec3Length, vec3Normalize,
  vec3LengthSq, vec3Lerp,
} from './MathVec3.js';
import { degreesToRadians } from './UnitMath.js';
export {
  vec3, vec3Add, vec3Sub, vec3Scale,
  vec3Dot, vec3Cross, vec3Length, vec3Normalize,
  vec3LengthSq, vec3Lerp,
};

function isFiniteVec3(v) {
  return v &&
    v.length >= 3 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2]);
}

function isValidPerspectiveParams(fovRad, aspect, near, far) {
  return Number.isFinite(fovRad) &&
    Number.isFinite(aspect) &&
    Number.isFinite(near) &&
    Number.isFinite(far) &&
    fovRad > 0 &&
    fovRad < Math.PI &&
    aspect > 0 &&
    near > 0 &&
    far > near;
}

function isValidOrthographicParams(left, right, bottom, top, near, far) {
  return Number.isFinite(left) &&
    Number.isFinite(right) &&
    Number.isFinite(bottom) &&
    Number.isFinite(top) &&
    Number.isFinite(near) &&
    Number.isFinite(far) &&
    left !== right &&
    bottom !== top &&
    near > 0 &&
    far > near;
}

// =============================
// Quaternion utilities (plain arrays)
// =============================

export function quatRotateVec3(v, q) {
  const vx = v[0];
  const vy = v[1];
  const vz = v[2];
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];

  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);

  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

export function quatConjugate(q) {
  if (!Array.isArray(q) || q.length < 4) {
    return [0, 0, 0, 1];
  }
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatNormalize(q) {
  if (!Array.isArray(q) || q.length < 4) {
    return [0, 0, 0, 1];
  }
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];
  const lenSq = x * x + y * y + z * z + w * w;
  if (!Number.isFinite(lenSq) || lenSq === 0) {
    return [0, 0, 0, 1];
  }
  const invLen = 1 / Math.sqrt(lenSq);
  return [x * invLen, y * invLen, z * invLen, w * invLen];
}

export function quatMultiply(a, b) {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatInverse(q) {
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];
  const lenSq = x * x + y * y + z * z + w * w;
  if (!Number.isFinite(lenSq) || lenSq === 0) {
    return [0, 0, 0, 1];
  }
  const invLenSq = 1 / lenSq;
  return [-x * invLenSq, -y * invLenSq, -z * invLenSq, w * invLenSq];
}

// =============================
// Mat4 utilities (Float32Array)
// Column-major 4x4
// =============================

export function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4Multiply(a, b, out) {
  if (!out) out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i];
    const ai1 = a[i + 4];
    const ai2 = a[i + 8];
    const ai3 = a[i + 12];
    out[i]      = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
    out[i + 4]  = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
    out[i + 8]  = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
  return out;
}

export function mat4Translate(m, x, y, z) {
  const out = new Float32Array(m);
  out[12] = m[0] * x + m[4] * y + m[8]  * z + m[12];
  out[13] = m[1] * x + m[5] * y + m[9]  * z + m[13];
  out[14] = m[2] * x + m[6] * y + m[10] * z + m[14];
  out[15] = m[3] * x + m[7] * y + m[11] * z + m[15];
  return out;
}

export function mat4Scale(m, sx, sy, sz) {
  const out = new Float32Array(m);

  // Scale X axis
  out[0] *= sx; out[1] *= sx; out[2] *= sx; out[3] *= sx;
  // Scale Y axis
  out[4] *= sy; out[5] *= sy; out[6] *= sy; out[7] *= sy;
  // Scale Z axis
  out[8] *= sz; out[9] *= sz; out[10] *= sz; out[11] *= sz;

  return out;
}

// Perspective using radians FOV - OpenGL style (Z in [-1, 1])
// WARNING: WebGPU uses [0, 1] clip space Z - use mat4PerspectiveRadWebGPU for correct depth
export function mat4PerspectiveRad(fovRad, aspect, near, far) {
  if (!isValidPerspectiveParams(fovRad, aspect, near, far)) {
    return mat4Identity();
  }

  const f = 1 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  const out = mat4Identity();
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;  // OpenGL: maps near to -1, far to 1
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  out[15] = 0;
  return out;
}

// Perspective using radians FOV - WebGPU/Vulkan/DirectX style (Z in [0, 1])
// This is the correct projection for WebGPU's clip space Z range
export function mat4PerspectiveRadWebGPU(fovRad, aspect, near, far) {
  if (!isValidPerspectiveParams(fovRad, aspect, near, far)) {
    return mat4Identity();
  }

  const f = 1 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  const out = mat4Identity();
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far * nf;           // WebGPU: maps near to 0, far to 1
  out[11] = -1;
  out[14] = far * near * nf;    // Note: no 2x multiplier
  out[15] = 0;
  return out;
}

// Perspective using degrees FOV - OpenGL style
export function mat4PerspectiveDeg(fovDeg, aspect, near, far) {
  const fovRad = degreesToRadians(fovDeg);
  return mat4PerspectiveRad(fovRad, aspect, near, far);
}

// Perspective using degrees FOV - WebGPU style (recommended for WebGPU)
export function mat4PerspectiveDegWebGPU(fovDeg, aspect, near, far) {
  const fovRad = degreesToRadians(fovDeg);
  return mat4PerspectiveRadWebGPU(fovRad, aspect, near, far);
}

// Orthographic projection - OpenGL style (Z in [-1, 1])
// WARNING: WebGPU uses [0, 1] clip space Z - use mat4OrthographicWebGPU for correct depth
export function mat4Orthographic(left, right, bottom, top, near, far) {
  if (!isValidOrthographicParams(left, right, bottom, top, near, far)) {
    return mat4Identity();
  }

  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  const out = mat4Identity();
  out[0] = -2 * lr;
  out[5] = -2 * bt;
  out[10] = 2 * nf;               // OpenGL: maps near to -1, far to 1
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = (far + near) * nf;    // OpenGL style
  return out;
}

// Orthographic projection - WebGPU/Vulkan/DirectX style (Z in [0, 1])
// This is the correct projection for WebGPU's clip space Z range
export function mat4OrthographicWebGPU(left, right, bottom, top, near, far) {
  if (!isValidOrthographicParams(left, right, bottom, top, near, far)) {
    return mat4Identity();
  }

  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  const out = mat4Identity();
  out[0] = -2 * lr;
  out[5] = -2 * bt;
  out[10] = nf;                   // WebGPU: maps near to 0, far to 1
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = near * nf;            // WebGPU style
  return out;
}

export function mat4LookAt(eye, center, up) {
  if (!isFiniteVec3(eye) || !isFiniteVec3(center) || !isFiniteVec3(up)) {
    return mat4Identity();
  }

  let z = vec3Normalize(vec3Sub(eye, center));
  if (vec3Length(z) < 1e-6) {
    z = [0, 0, 1];
  }

  let x = vec3Normalize(vec3Cross(up, z));
  if (vec3Length(x) < 1e-6) {
    const fallbackUp = Math.abs(z[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0];
    x = vec3Normalize(vec3Cross(fallbackUp, z));
  }

  const y = vec3Cross(z, x);

  const out = mat4Identity();
  out[0] = x[0]; out[1] = y[0]; out[2]  = z[0]; out[3]  = 0;
  out[4] = x[1]; out[5] = y[1]; out[6]  = z[1]; out[7]  = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -vec3Dot(x, eye);
  out[13] = -vec3Dot(y, eye);
  out[14] = -vec3Dot(z, eye);
  out[15] = 1;
  return out;
}

export function mat4Inverse(m, out) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-6) {
    if (!out) return mat4Identity();
    out[0]=1;out[1]=0;out[2]=0;out[3]=0;out[4]=0;out[5]=1;out[6]=0;out[7]=0;out[8]=0;out[9]=0;out[10]=1;out[11]=0;out[12]=0;out[13]=0;out[14]=0;out[15]=1;
    return out;
  }
  det = 1.0 / det;

  if (!out) out = new Float32Array(16);
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function mat4FromRotationTranslation(q, t) {
  if (!Array.isArray(q) || q.length < 4 || !Array.isArray(t) || t.length < 3) {
    return mat4Translate(mat4Identity(), t && t[0] || 0, t && t[1] || 0, t && t[2] || 0);
  }

  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];

  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;

  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  const out = mat4Identity();
  out[0] = 1 - (yy + zz);
  out[1] = xy + wz;
  out[2] = xz - wy;
  out[3] = 0;

  out[4] = xy - wz;
  out[5] = 1 - (xx + zz);
  out[6] = yz + wx;
  out[7] = 0;

  out[8] = xz + wy;
  out[9] = yz - wx;
  out[10] = 1 - (xx + yy);
  out[11] = 0;

  out[12] = t[0];
  out[13] = t[1];
  out[14] = t[2];
  out[15] = 1;

  return out;
}
