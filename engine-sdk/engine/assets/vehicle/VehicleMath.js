// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/vehicle/VehicleMath.js — minimal column-major 4x4 + quaternion
// helpers for vehicle rig assembly and the visual wheel transform chain. Kept
// local and dependency-free so the vehicle layer is self-contained and the math
// stays deterministic (and gate-testable without the renderer).

export function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** Column-major multiply: out = a * b. */
export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** Compose a TRS matrix (scale may be a number or [x,y,z]). */
export function composeTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = 1) {
  const [x, y, z, w] = q;
  const sx = Array.isArray(s) ? s[0] : s, sy = Array.isArray(s) ? s[1] : s, sz = Array.isArray(s) ? s[2] : s;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float32Array(16);
  m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
  m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
  m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

/** Quaternion (xyzw) from an axis + angle (radians). */
export function quatFromAxisAngle(axis, angle) {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2);
  return [(axis[0] / len) * s, (axis[1] / len) * s, (axis[2] / len) * s, Math.cos(angle / 2)];
}

/** Hamilton product a*b (xyzw). */
export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Transform a point (vec3) by a column-major 4x4. */
export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Local transform of a node (matrix override or TRS). */
export function nodeLocalMatrix(node) {
  if (node?.extras?.matrix) return new Float32Array(node.extras.matrix);
  return composeTRS(node?.translation, node?.rotation, node?.scale ?? 1);
}

/**
 * World matrices for every node, accumulating the parent chain. Returns a
 * Map(nodeId → Float32Array(16)).
 */
export function computeWorldMatrices(model) {
  const byId = new Map((model.nodes || []).map((n) => [n.id, n]));
  const world = new Map();
  const calc = (node, parent) => {
    const local = nodeLocalMatrix(node);
    const w = parent ? multiply(parent, local) : local;
    world.set(node.id, w);
    for (const c of node.children || []) { const cn = byId.get(c); if (cn) calc(cn, w); }
  };
  for (const n of model.nodes || []) if (!n.parent) calc(n, null);
  // any orphan nodes (shouldn't happen) get identity
  for (const n of model.nodes || []) if (!world.has(n.id)) world.set(n.id, identity());
  return world;
}
