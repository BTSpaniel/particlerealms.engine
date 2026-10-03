// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/CanonicalSpace.js — the engine's canonical coordinate frame.
//
//   Y = up, Z = forward, X = side (right), unit = meter, origin = logical root.
//
// Source files come from Blender/Maya/Max/CAD/Unity/Unreal/etc. with
// inconsistent axes, scale, and origin. We never trust source orientation and
// never rewrite it destructively — instead we compute a non-destructive axis
// correction (a quaternion + uniform scale) that maps the declared source frame
// into this canonical frame, and store it on the model's ImportTransform.

import { vec3Cross } from '../core/math/MathVec3.js';

export const CANONICAL = Object.freeze({
  up: [0, 1, 0],
  forward: [0, 0, 1],
  right: [1, 0, 0],
  unit: 'meter',
});

const AXIS_VECTORS = {
  '+X': [1, 0, 0], '-X': [-1, 0, 0],
  '+Y': [0, 1, 0], '-Y': [0, -1, 0],
  '+Z': [0, 0, 1], '-Z': [0, 0, -1],
};

/** Resolve an axis token ('+Y', '-Z', …) to a unit vector. */
export function axisVector(token) {
  const v = AXIS_VECTORS[String(token).toUpperCase()];
  if (!v) throw new Error(`CanonicalSpace: unknown axis '${token}'`);
  return v.slice();
}

/**
 * Quaternion (xyzw) that rotates a vector from a source frame (declared by its
 * up + forward axes) into the canonical Y-up / Z-forward frame.
 * @param {string} upAxis      e.g. '+Z' for Blender
 * @param {string} forwardAxis e.g. '-Y' for Blender
 * @returns {[number,number,number,number]}
 */
export function axisCorrectionQuat(upAxis = '+Y', forwardAxis = '+Z') {
  const su = axisVector(upAxis);
  const sf = axisVector(forwardAxis);
  const sr = vec3Cross(su, sf); // right-handed: up × forward = right
  // Change-of-basis B maps source axes → canonical axes; since the source basis
  // is orthonormal, B = [sr; su; sf] (rows). Convert that rotation to a quat.
  const m = [
    sr[0], sr[1], sr[2],
    su[0], su[1], su[2],
    sf[0], sf[1], sf[2],
  ];
  return mat3ToQuat(m);
}

/** Convert a row-major 3x3 rotation matrix to a quaternion (xyzw). */
export function mat3ToQuat(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

/** Rotate a 3-vector by a quaternion (xyzw). */
export function rotateVecByQuat(v, q) {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  // v + qw*t + cross(q.xyz, t)
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Common unit guesses for formats that don't carry units (e.g. STL). Returns a
 * scale factor to convert the source unit to meters. These are *guesses* — the
 * editor exposes an override per import.
 */
export const UNIT_TO_METERS = Object.freeze({
  meter: 1, m: 1,
  centimeter: 0.01, cm: 0.01,
  millimeter: 0.001, mm: 0.001,
  inch: 0.0254, in: 0.0254,
  foot: 0.3048, ft: 0.3048,
});

export function unitScaleToMeters(unit) {
  return UNIT_TO_METERS[String(unit).toLowerCase()] ?? 1;
}
