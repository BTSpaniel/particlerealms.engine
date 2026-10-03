// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/humanoid/HumanoidRig.js — canonical humanoid bone slots + rig
// schema (spec §12). A humanoid is NOT its skeleton: it's a mapping from the
// source skeleton's bones onto a canonical slot set (Unity Mecanim / VRM style)
// plus rest-pose + correction metadata, so animation can retarget and physics can
// build a ragdoll regardless of how the artist named or oriented the rig. Every
// mapping is a HINT with confidence; unmapped/ambiguous bones go to the editor.

// Canonical slots. Order matters for hierarchy disambiguation (spine chain).
export const HUMANOID_BONES = Object.freeze([
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
]);

// The minimum set that makes a credible humanoid (drives confidence + needsCorrection).
export const REQUIRED_BONES = Object.freeze([
  'hips', 'spine', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
]);

export const BODY_SIDE = Object.freeze({ LEFT: 'left', RIGHT: 'right', CENTER: 'center' });

/**
 * Create a humanoid rig descriptor.
 * @param {object} init
 * @returns {object}
 */
export function createHumanoidRig(init = {}) {
  init = init || {};
  return {
    // canonical slot → node id (only mapped slots are present)
    bones: init.bones ?? {},
    skeletonRoot: init.skeletonRoot ?? null, // node id of the hips (rig root)
    armatureNode: init.armatureNode ?? null, // node id of the armature/skeleton container, if any

    restPose: init.restPose ?? null,         // { nodeId -> {translation,rotation,scale} } snapshot
    poseType: init.poseType ?? 'unknown',    // 't-pose' | 'a-pose' | 'unknown'
    upAxis: init.upAxis ?? '+Y',

    source: init.source ?? 'name',           // 'name' | 'hierarchy' | 'mixed'
    confidence: init.confidence ?? 0,
    needsCorrection: init.needsCorrection ?? true,
    unmapped: init.unmapped ?? [],           // node ids that look like bones but didn't map
    missing: init.missing ?? [],             // required slots with no bone

    metadata: { ...(init.metadata || {}) },
  };
}

/** Is a canonical slot a left/right limb (vs a center/spine bone)? */
export function boneSide(slot) {
  if (/^left/.test(slot)) return BODY_SIDE.LEFT;
  if (/^right/.test(slot)) return BODY_SIDE.RIGHT;
  return BODY_SIDE.CENTER;
}

/** The mirrored slot for a left/right bone (e.g. leftHand ↔ rightHand), or null. */
export function mirrorBone(slot) {
  if (/^left/.test(slot)) return slot.replace(/^left/, 'right');
  if (/^right/.test(slot)) return slot.replace(/^right/, 'left');
  return null;
}
