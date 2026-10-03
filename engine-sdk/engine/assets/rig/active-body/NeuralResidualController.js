// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/NeuralResidualController.js — extracted from
// ActiveBodySystem.js (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns
// the humanoid rotation-residual cluster: converting NN bone offsets into
// axis-angle residuals blended on top of kinematic rotation targets, and
// zeroing out idle-state NN drift on the horizontal (and, for a fixed set of
// upper-body bones, vertical) axes so a "resting" NN doesn't slowly walk the
// pose off-target. Pure functions — callers (the pose-target pipeline, still
// in ActiveBodySystem.js) own all the surrounding per-frame state.

import { BONE_ORDER } from './NeuralMotor.js'

export const IDLE_NEURAL_VERTICAL_BLOCK_BONES = Object.freeze([
  'leftShoulder',
  'rightShoulder',
  'leftHand',
  'rightHand',
  'leftFoot',
  'rightFoot',
])

export function dampIdleNeuralOffsets(offsets) {
  for (let i = 0; i < BONE_ORDER.length; i++) {
    const name = BONE_ORDER[i]
    const base = i * 3
    if (Number.isFinite(offsets[base])) offsets[base] = 0
    if (Number.isFinite(offsets[base + 2])) offsets[base + 2] = 0
    if (IDLE_NEURAL_VERTICAL_BLOCK_BONES.includes(name) && Number.isFinite(offsets[base + 1])) {
      offsets[base + 1] = 0
    }
  }
}

export function extractRotationTargets(poseTargets) {
  if (!poseTargets) return null
  const rotations = Object.create(null)
  let count = 0
  for (const [boneId, target] of Object.entries(poseTargets)) {
    if (!Array.isArray(target?.rotation) || target.rotation.length !== 4) continue
    rotations[boneId] = [...target.rotation]
    count++
  }
  return count > 0 ? rotations : null
}

export function computeNeuralRotationResidualHints(rotationTargets, poseState, neuralOffsets = null, weight = 1) {
  if (!rotationTargets) return null
  const residuals = Object.create(null)
  const gain = Math.max(0, Math.min(1, ((poseState?.stiffnessScale ?? 1) - 1) * 0.5 + Math.max(0, weight) * 0.25))
  for (const [boneId, rotation] of Object.entries(rotationTargets)) {
    const axisAngle = neuralOffsets ? neuralOffsetToAxisAngle(neuralOffsets, boneId, weight) : [0, 0, 0]
    residuals[boneId] = { targetRotation: [...rotation], residualAxisAngle: axisAngle, gain }
  }
  return residuals
}

export function neuralOffsetToAxisAngle(neuralOffsets, boneId, weight = 1) {
  const idx = BONE_ORDER.indexOf(boneId)
  if (idx < 0 || !neuralOffsets) return [0, 0, 0]
  const base = idx * 3
  const scale = Math.max(0, Math.min(1, weight)) * 0.35
  return [
    Math.max(-0.12, Math.min(0.12, (neuralOffsets[base + 1] || 0) * scale)),
    Math.max(-0.12, Math.min(0.12, (neuralOffsets[base] || 0) * scale)),
    Math.max(-0.12, Math.min(0.12, (neuralOffsets[base + 2] || 0) * scale)),
  ]
}
