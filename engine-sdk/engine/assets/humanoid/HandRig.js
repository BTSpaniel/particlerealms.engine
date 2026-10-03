// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/humanoid/HandRig.js — hand + finger rig schema (spec §12). A hand
// is a wrist + up to five fingers, each a short bone chain. Fingers come from one
// of three sources: the source skeleton's named bones (`skeleton`), procedurally
// GENERATED from the hand mesh when the skeleton has none (`generated`), or a
// single paddle bone when the hand is a closed fist / too low-poly (`paddle`).

export const FINGERS = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);

// A finger's joints, palm→tip. Thumb commonly omits 'intermediate'.
export const FINGER_JOINTS = Object.freeze(['proximal', 'intermediate', 'distal', 'tip']);

export const HAND_SOURCE = Object.freeze({ SKELETON: 'skeleton', GENERATED: 'generated', PADDLE: 'paddle', NONE: 'none' });

/**
 * @param {object} init { name, joints:[{position,nodeId?}], source }
 */
export function createFinger(init = {}) {
  return {
    name: init.name ?? 'finger',
    joints: init.joints ?? [], // [{ position:[x,y,z], nodeId?:string|null }] palm→tip
    source: init.source ?? HAND_SOURCE.GENERATED,
  };
}

/**
 * @param {object} init
 * @returns {object} a hand rig
 */
export function createHandRig(init = {}) {
  init = init || {};
  return {
    side: init.side ?? 'right',           // 'left' | 'right'
    wristNode: init.wristNode ?? null,
    wristPosition: init.wristPosition ?? [0, 0, 0],
    forward: init.forward ?? [0, 0, 1],   // wrist → fingertips
    palmNormal: init.palmNormal ?? [0, 1, 0],

    fingers: init.fingers ?? [],          // Finger[]
    source: init.source ?? HAND_SOURCE.NONE,
    fingerCount: init.fingerCount ?? (init.fingers ? init.fingers.length : 0),
    generated: init.generated ?? false,   // true when fingers were synthesized
    confidence: init.confidence ?? 0,
    metadata: { ...(init.metadata || {}) },
  };
}
