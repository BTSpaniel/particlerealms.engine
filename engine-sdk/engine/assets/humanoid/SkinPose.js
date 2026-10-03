// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/humanoid/SkinPose.js — scene-space skeleton pose used by rig
// overlays + hand probing.
//
// IMPORTANT (verified with scripts/probe_skeleton.py across real rigs): the
// correct space for placing the skeleton so it lands on the RENDERED mesh is the
// NODE-HIERARCHY world, because the importer/renderer draw the (unskinned) mesh
// through that same node hierarchy + importTransform. `inverse(IBM)` instead lives
// in the armature-local / unscaled space (e.g. hips ≈ 0.03 while the node-hierarchy
// hips ≈ 2.77 with a ×100 mesh-node scale), so using it for the overlay either
// collapses the skeleton (missing node scale) or double-rotates it (re-applying
// the armature transform). We therefore use the node hierarchy here; the IBMs are
// still imported and available (invert4) for true-bind / retarget work later.

import { computeWorldMatrices } from '../vehicle/VehicleMath.js';

/** Invert a column-major 4×4 (returns a new Float32Array, or null if singular). */
export function invert4(m) {
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
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1.0 / det;
  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ]);
}

/**
 * Scene-space pose for every node = the node-hierarchy world (TRS composed down
 * the tree). This is exactly the space the renderer draws the mesh in, so the
 * skeleton overlay + hand probing align with the mesh for any export.
 * @param {object} model EngineModel
 * @returns {Map<string, Float32Array>} nodeId → 4×4 (column-major)
 */
export function buildBindPose(model) {
  return computeWorldMatrices(model);
}

/** World position of a node in a pose map (or null). */
export function jointPosition(pose, nodeId) {
  const m = nodeId && pose.get(nodeId);
  return m ? [m[12], m[13], m[14]] : null;
}
