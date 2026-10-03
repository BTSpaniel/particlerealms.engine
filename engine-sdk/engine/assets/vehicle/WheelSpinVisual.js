// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/vehicle/WheelSpinVisual.js — visual wheel-spin transforms for a
// rigged vehicle. Separated from physics (WheelPhysics) and detection so the
// importer/viewer, the editor preview, and the runtime can all reuse one correct
// implementation.
//
// Approach (matches Unity `transform.Rotate(..,Space.Self)` / Godot
// `rotate_object_local`): the spin is built in the wheel's MESH-LOCAL space from
// the detector's per-wheel hub (`localPivot`) and axle (`axleAxisLocal`), then
// the node hierarchy + import correction carry it to the right world position and
// orientation automatically (the renderer does `draw = baseDraw · spin_local`).
//
// This avoids transforming the axle into world space, PCA axis ambiguity on
// low-poly wheels, and pivot guessing — the failure modes of a world-space spin.
// The only world-space step is a per-wheel SIGN so mirrored wheels roll the same
// way; the axle vector itself stays the exact per-wheel local axis.

import { multiply, transformPoint, computeWorldMatrices, identity } from './VehicleMath.js';
import { vec3Add, vec3Clone, vec3Dot, vec3Negate, vec3Sub } from '../../core/math/MathVec3.js';

/** Column-major rotation about an arbitrary (unit-normalized) axis. */
export function rotAxis(axis, angle) {
  let [x, y, z] = axis; const len = Math.hypot(x, y, z) || 1; x /= len; y /= len; z /= len;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return new Float32Array([
    x * x * t + c, y * x * t + z * s, z * x * t - y * s, 0,
    x * y * t - z * s, y * y * t + c, z * y * t + x * s, 0,
    x * z * t + y * s, y * z * t - x * s, z * z * t + c, 0,
    0, 0, 0, 1,
  ]);
}

/** Spin about an axis through a pivot: T(pivot) · R(axis,angle) · T(-pivot). */
export function pivotSpin(pivot, axis, angle) {
  const R = rotAxis(axis, angle);
  // Bake the pivot translation directly into R's last column (cheaper than 3 muls).
  const m = new Float32Array(R);
  m[12] = pivot[0] - (R[0] * pivot[0] + R[4] * pivot[1] + R[8] * pivot[2]);
  m[13] = pivot[1] - (R[1] * pivot[0] + R[5] * pivot[1] + R[9] * pivot[2]);
  m[14] = pivot[2] - (R[2] * pivot[0] + R[6] * pivot[1] + R[10] * pivot[2]);
  return m;
}

/** Normalized direction of a local vector transformed by a matrix (translation ignored). */
function dirOf(M, v) {
  const a = transformPoint(M, v); const b = transformPoint(M, [0, 0, 0]);
  const d = vec3Sub(a, b);
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / L, d[1] / L, d[2] / L];
}

/**
 * Build a per-wheel spin descriptor map for a rigged model. Each entry carries
 * the wheel's MESH-LOCAL pivot + axle (so the renderer applies the spin in local
 * space: `draw = baseDraw · pivotSpin(pivot, axle, angle)`). The local axle is
 * pre-signed so every wheel rolls the same visual direction. Steerable wheels
 * also carry their local steer axis so the renderer can yaw them with input.
 * @param {object} model EngineModel (must be detected/rigged)
 * @param {Float32Array} importMatrix model importTransform matrix (local→world correction)
 * @param {object} rig VehicleAsset (model.rigs.vehicle) with wheelSlots
 * @returns {Map<string, {pivot:number[], axle:number[], radius:number, steer:boolean, steerAxis:number[]}>} keyed by visualNode id
 */
export function buildWheelSpinMap(model, importMatrix, rig) {
  const map = new Map();
  if (!rig || !rig.wheelSlots?.length) return map;
  const M = importMatrix || identity();
  const world = computeWorldMatrices(model);

  // Reference lateral (left↔right cluster), in WORLD space — used ONLY to give
  // every wheel a consistent roll direction, never as the axle itself.
  const mean = (arr) => (arr.length ? arr.reduce(vec3Add, [0, 0, 0]).map((v) => v / arr.length) : null);
  const lm = mean(rig.wheelSlots.filter((w) => /left|_l\b|\bl\b/.test(w.id)).map((w) => w.localCenter));
  const rm = mean(rig.wheelSlots.filter((w) => /right|_r\b|\br\b/.test(w.id)).map((w) => w.localCenter));
  const lateralWorld = dirOf(M, (lm && rm) ? vec3Sub(rm, lm) : [1, 0, 0]);

  for (const w of rig.wheelSlots) {
    const fullM = multiply(M, world.get(w.visualNode) || identity()); // mesh-local → final world
    // Hub + axle come straight from the detector in MESH-LOCAL space; no world
    // transform of the axle, no PCA, no pivot guessing.
    const pivot = w.localPivot || w.localCenter || [0, 0, 0];
    const localAxle = w.axleAxisLocal || [1, 0, 0];
    // Sign: flip the local axle for wheels whose world axle opposes the reference
    // lateral, so mirrored left/right wheels roll the same way under +angle.
    const worldAxle = dirOf(fullM, localAxle);
    const dot = vec3Dot(worldAxle, lateralWorld);
    const axle = dot < 0 ? vec3Negate(localAxle) : vec3Clone(localAxle);
    map.set(w.visualNode, {
      pivot, axle, radius: w.radius,
      steer: !!w.canSteer, steerAxis: w.steerAxisLocal || [0, 1, 0],
    });
  }
  return map;
}

/** Spin angle (radians) for a wheel that has rolled `distance` metres. */
export function rollAngle(distance, radius) {
  return distance / Math.max(radius, 0.05);
}
