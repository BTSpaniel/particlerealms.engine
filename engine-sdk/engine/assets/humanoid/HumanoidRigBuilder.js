// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/humanoid/HumanoidRigBuilder.js — assemble a HumanoidRig from a
// model's skeleton (spec §12). Maps bones (BoneMapper), snapshots the rest pose,
// classifies the pose (T vs A) from the arm direction, and flags needsCorrection
// when required bones are missing — never guessing past the evidence. The rig is
// the retarget/ragdoll target: it references the source nodes, it does not bake.

import { createHumanoidRig } from './HumanoidRig.js';
import { mapBones } from './BoneMapper.js';
import { buildBindPose, jointPosition } from './SkinPose.js';
import { healHumanoid } from './SkeletonHeal.js';
import { deriveHumanoidJointLimits } from '../rig/JointLimits.js';

function worldPos(world, id) {
  return jointPosition(world, id);
}

/**
 * Classify the rest pose from the left-arm direction (upperArm → hand):
 * mostly-horizontal = T-pose, angled-down = A-pose.
 * @returns {'t-pose'|'a-pose'|'unknown'}
 */
function classifyPose(world, bones) {
  const a = worldPos(world, bones.leftUpperArm);
  const b = worldPos(world, bones.leftHand) || worldPos(world, bones.leftLowerArm);
  if (!a || !b) return 'unknown';
  const dx = Math.abs(b[0] - a[0]); const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const droop = -dy / len; // 0 = level (T), ~0.4–0.7 = A-pose
  if (dx / len > 0.85 && droop < 0.25) return 't-pose';
  if (droop > 0.25) return 'a-pose';
  return 'unknown';
}

/**
 * Build a humanoid rig and attach it at model.rigs.humanoid.
 * @param {object} model EngineModel
 * @param {object} [opts]
 * @returns {object} the HumanoidRig
 */
export function buildHumanoidRig(model, opts = {}) {
  const map = mapBones(model, opts);
  const byId = new Map((model.nodes || []).map((n) => [n.id, n]));
  const world = buildBindPose(model); // bind-pose (IBM-derived) joint world

  // rest-pose snapshot of mapped bones (local TRS, as authored)
  const restPose = {};
  for (const slot of Object.keys(map.bones)) {
    const n = byId.get(map.bones[slot]);
    if (n) restPose[map.bones[slot]] = { translation: [...n.translation], rotation: [...n.rotation], scale: [...n.scale] };
  }

  const hips = byId.get(map.bones.hips);
  const armatureNode = hips?.parent || null;
  const poseType = classifyPose(world, map.bones);

  const rig = createHumanoidRig({
    bones: map.bones,
    skeletonRoot: map.skeletonRoot,
    armatureNode,
    restPose,
    poseType,
    upAxis: model.importTransform?.upAxis ?? '+Y',
    source: map.source,
    confidence: map.confidence,
    needsCorrection: map.missing.length > 0,
    unmapped: map.unmapped,
    missing: map.missing,
    metadata: { mappedCount: map.mappedCount, totalSlots: map.totalSlots },
  });

  model.rigs.humanoid = rig;
  // Anatomy heal: infer missing/mislabeled core bones (pelvis from legs, spine
  // interpolation, mirror a missing side) — non-destructive (rig.synthesized).
  const heal = healHumanoid(model, rig, world);
  // Auto-derive per-joint movement limits (ROM) from role + bind-pose geometry.
  rig.jointLimits = deriveHumanoidJointLimits(model, world);
  model.metadata.humanoid = {
    mapped: map.mappedCount, missing: map.missing.length, healed: heal.healed.length,
    confidence: map.confidence, poseType, needsCorrection: rig.needsCorrection,
  };
  return rig;
}
