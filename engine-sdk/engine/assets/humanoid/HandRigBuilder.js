// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/humanoid/HandRigBuilder.js — build a hand rig for each hand of a
// humanoid. Priority: (1) use named finger bones if the skeleton has them; else
// (2) PROBE the hand mesh (vertices skinned to the hand joint) and GENERATE finger
// bones geometrically; else (3) a single paddle. Wrist + forward come from the
// humanoid rig (hand world position, and the lowerArm→hand direction).

import { createHandRig, HAND_SOURCE } from './HandRig.js';
import { mapFingers } from './FingerMapper.js';
import { generateFingers } from './FingerGenerator.js';
import { buildBindPose, jointPosition } from './SkinPose.js';
import { transformPoint } from '../vehicle/VehicleMath.js';
import { vec3Sub } from '../../core/math/MathVec3.js';

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Joint slot of a hand node within any skin (so we can find its skinned verts). */
function handJointIndex(model, handNodeId) {
  const idx = parseInt(String(handNodeId).replace('node:', ''), 10);
  if (Number.isNaN(idx)) return -1;
  for (const skin of model.skins || []) { const j = (skin.raw?.joints || []).indexOf(idx); if (j >= 0) return j; }
  return -1;
}

/** Vertices skinned (weight ≥ thresh) to the hand joint, in node-hierarchy SCENE
 * space (so they match the wrist + the rendered mesh). `pose` is a node→world map. */
export function extractHandVertices(model, handNodeId, thresh = 0.4, pose = null) {
  const j = handJointIndex(model, handNodeId);
  if (j < 0) return [];
  // mesh id → drawing node world matrix (the renderer draws verts through this).
  const meshWorld = new Map();
  if (pose) for (const n of model.nodes || []) if (n.mesh && pose.get(n.id)) meshWorld.set(n.mesh, pose.get(n.id));
  const out = [];
  for (const prim of model.primitives || []) {
    const pos = prim.attributes?.position; const joints = prim.attributes?.joints; const weights = prim.attributes?.weights;
    if (!pos || !joints || !weights) continue;
    // Baked-skinned primitives already hold scene-space verts; only raw (unbaked)
    // mesh-local verts need the mesh node's world transform applied.
    const mw = prim._skinnedBaked ? null : (meshWorld.get(prim.mesh) || null);
    const vc = pos.length / 3;
    for (let v = 0; v < vc; v++) {
      for (let k = 0; k < 4; k++) {
        if (joints[v * 4 + k] === j && weights[v * 4 + k] >= thresh) {
          const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
          out.push(mw ? transformPoint(mw, p) : p);
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Build a single hand rig.
 * @param {object} model EngineModel
 * @param {object} opts { side, handNode, lowerArmNode, world? }
 * @returns {object} HandRig
 */
export function buildHandRig(model, opts = {}) {
  const pose = opts.pose || buildBindPose(model); // bind-pose (IBM-derived) joint world
  const handNode = opts.handNode;
  const side = opts.side || 'right';
  const wristPosition = jointPosition(pose, handNode) || [0, 0, 0];
  const armPos = jointPosition(pose, opts.lowerArmNode);
  const forward = armPos ? norm(vec3Sub(wristPosition, armPos)) : [0, 0, 1];

  // (1) existing named finger bones
  const mapped = mapFingers(model, handNode);
  if (mapped.detected) {
    for (const fng of mapped.fingers) for (const jt of fng.joints) jt.position = jointPosition(pose, jt.nodeId) || wristPosition;
    return createHandRig({ side, wristNode: handNode, wristPosition, forward, fingers: mapped.fingers, source: HAND_SOURCE.SKELETON, fingerCount: mapped.count, generated: false, confidence: 0.9 });
  }

  // (2) generate from the hand mesh (verts in the same scene space as the wrist)
  const verts = extractHandVertices(model, handNode, 0.4, pose);
  if (verts.length >= 12) {
    const gen = generateFingers(verts, { wrist: wristPosition, forward, side });
    if (gen.detected) {
      return createHandRig({
        side, wristNode: handNode, wristPosition, forward: forward, palmNormal: gen.palmNormal,
        fingers: gen.fingers, source: HAND_SOURCE.GENERATED, fingerCount: gen.count, generated: true, confidence: 0.6,
        metadata: { handLength: gen.handLength },
      });
    }
  }

  // (3) paddle fallback (closed fist / no skinned hand mesh)
  return createHandRig({ side, wristNode: handNode, wristPosition, forward, fingers: [], source: HAND_SOURCE.PADDLE, fingerCount: 0, generated: false, confidence: 0.3 });
}

/**
 * Build both hands for a model that already has a humanoid rig; attaches them at
 * model.rigs.hand = { left, right } and humanoidRig.hands.
 * @returns {{left:object|null, right:object|null}}
 */
export function buildHands(model, opts = {}) {
  const hum = model.rigs?.humanoid;
  if (!hum) return { left: null, right: null };
  const pose = buildBindPose(model);
  const mk = (side) => {
    const handNode = hum.bones[`${side}Hand`];
    if (!handNode) return null;
    return buildHandRig(model, { side, handNode, lowerArmNode: hum.bones[`${side}LowerArm`], pose });
  };
  const hands = { left: mk('left'), right: mk('right') };
  model.rigs.hand = hands;
  hum.hands = hands;
  if (model.metadata) {
    model.metadata.hands = {
      left: hands.left ? { source: hands.left.source, fingers: hands.left.fingerCount } : null,
      right: hands.right ? { source: hands.right.source, fingers: hands.right.fingerCount } : null,
    };
  }
  return hands;
}
