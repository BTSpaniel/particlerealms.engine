// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/PoseAuthority.js — extracted from ActiveBodySystem.js
// (Ragdoll Stack Consolidation Roadmap, Phase 7). This is the hardest and
// last Phase 7 cluster: the humanoid standing/getup pose-target pipeline —
// applyStandingController (kinematic pose blending, walk-cycle overlay,
// balance correction, rhythm/breathing modulation, contact reflexes, brace
// protection, NN residual blending, training) and applyGetupController
// (orientation-aware rise sequencing), plus every helper they call
// (limb/shoulder/head stabilization, reflex classification, motor-authority
// mapping, pose-state resolution). Deliberately NOT split further — these
// helpers are tightly entangled with the two controller functions and with
// each other; see the Phase 7 pre-work notes in the roadmap doc.

import {
  clamp01,
  estimateAverageFatigue,
  round4,
  setParticleVelocity,
} from './ActiveBodySystem.js'
import {
  DEFAULT_POSE_STATES,
  resolveRequestedPoseState,
} from '../../../sim/physics/rig/PoseStateGraph.js'
import { FOOT_PARTICLE_SOLE_HEIGHT, enforceGroundContact } from './ContactTelemetry.js'
import { RHYTHM, createRhythmState, rhythmSample, stepRhythms } from './BodyRhythms.js'
import { RagdollBone } from '../../../sim/physics/PBDRagdoll.js'
import {
  applyKinematicBlend,
  blendPositionTargetMaps,
  blendWorldPoseTargets,
  getCachedPose,
  getPoseAtVerticality,
  getPoseTargetsAtVerticality,
  getPoseWorldPoseTargets,
  getPoseWorldTargets,
  getWalkCycleWorldPoseTargets,
  getWalkCycleWorldTargets,
  measureBodyVerticality,
} from './BodyPoses.js'
import {
  applyNeuralOffsets,
  buildObservation,
  computeReward,
  computeTeacherSignal,
  createNeuralMotor,
  neuralMotorForward,
  saveBrain,
  trainNeuralMotor,
} from './NeuralMotor.js'
import {
  computeNeuralRotationResidualHints,
  dampIdleNeuralOffsets,
  extractRotationTargets,
} from './NeuralResidualController.js'
import { ensureBrainLoaded, estimateNeuralMotorTrust } from './BrainProfile.js'
import { logLocomotionTargetTrace } from './OrientationAudit.js'
import { mixAniMotionTeacher } from './MotionPriorTraining.js'
import { lerp } from '../../../core/math/MathScalar.js'

export const WALK_HORIZONTAL_SCALE_BY_BONE = Object.freeze({
  chest: 0.35,
  neck: 0,
  head: 0,
  leftShoulder: 0,
  rightShoulder: 0,
  leftUpperArm: 0,
  rightUpperArm: 0,
  leftForearm: 0,
  rightForearm: 0,
  leftHand: 0,
  rightHand: 0,
  leftThigh: 0.32,
  rightThigh: 0.32,
  leftShin: 0.40,
  rightShin: 0.40,
  leftFoot: 0.55,
  rightFoot: 0.55,
})

export const WALK_HORIZONTAL_DAMPING_SCALE_BY_BONE = Object.freeze({
  chest: 0.04,
  neck: 0.14,
  head: 0.18,
  leftShoulder: 0.02,
  rightShoulder: 0.02,
  leftUpperArm: 0.03,
  rightUpperArm: 0.03,
  leftForearm: 0.03,
  rightForearm: 0.03,
  leftHand: 0.04,
  rightHand: 0.04,
  leftThigh: 0.10,
  rightThigh: 0.10,
  leftShin: 0.16,
  rightShin: 0.16,
  leftFoot: 0.20,
  rightFoot: 0.20,
})

export const IDLE_HORIZONTAL_SCALE_BY_BONE = Object.freeze({
  chest: 0.45,
  neck: 0.08,
  head: 0.08,
  leftShoulder: 0.04,
  rightShoulder: 0.04,
  leftUpperArm: 0,
  rightUpperArm: 0,
  leftForearm: 0,
  rightForearm: 0,
  leftHand: 0,
  rightHand: 0,
  leftThigh: 0.12,
  rightThigh: 0.12,
  leftShin: 0,
  rightShin: 0,
  leftFoot: 0,
  rightFoot: 0,
})

export const IDLE_HORIZONTAL_DAMPING_SCALE_BY_BONE = Object.freeze({
  chest: 0.08,
  neck: 0.18,
  head: 0.24,
  leftShoulder: 0.08,
  rightShoulder: 0.08,
  leftUpperArm: 0.10,
  rightUpperArm: 0.10,
  leftForearm: 0.12,
  rightForearm: 0.12,
  leftHand: 0.14,
  rightHand: 0.14,
  leftThigh: 0.10,
  rightThigh: 0.10,
  leftShin: 0.12,
  rightShin: 0.12,
  leftFoot: 0.14,
  rightFoot: 0.14,
})

export function coupleShoulderGirdleTargets(entry, ragdoll, targets, yaw) {
  const chestP = ragdoll?.boneMap?.get('chest')?.particle
  const lTarget = targets?.leftShoulder
  const rTarget = targets?.rightShoulder
  if (!chestP || !lTarget || !rTarget) return
  const sideX = Math.cos(yaw || 0)
  const sideZ = -Math.sin(yaw || 0)
  const fwdX = Math.sin(yaw || 0)
  const fwdZ = Math.cos(yaw || 0)
  const halfWidth = Math.max(0.05, (entry?.measurements?.shoulderWidth || 0.76) * 0.3)
  const avgY = (lTarget[1] + rTarget[1]) * 0.5
  const relLX = lTarget[0] - chestP.x
  const relLZ = lTarget[2] - chestP.z
  const relRX = rTarget[0] - chestP.x
  const relRZ = rTarget[2] - chestP.z
  const avgForward = ((relLX * fwdX + relLZ * fwdZ) + (relRX * fwdX + relRZ * fwdZ)) * 0.5
  lTarget[0] = chestP.x - sideX * halfWidth + fwdX * avgForward
  lTarget[1] = avgY
  lTarget[2] = chestP.z - sideZ * halfWidth + fwdZ * avgForward
  rTarget[0] = chestP.x + sideX * halfWidth + fwdX * avgForward
  rTarget[1] = avgY
  rTarget[2] = chestP.z + sideZ * halfWidth + fwdZ * avgForward
}

export function getBodySideAxis(entry, ragdoll, yaw = null, preferYaw = false) {
  if (preferYaw && Number.isFinite(yaw)) return { x: Math.cos(yaw), z: -Math.sin(yaw) }
  const map = ragdoll?.boneMap
  const left = map?.get('leftShoulder')?.particle
  const right = map?.get('rightShoulder')?.particle
  if (left && right) {
    const dx = right.x - left.x
    const dz = right.z - left.z
    const len = Math.hypot(dx, dz)
    if (len > 0.08) return { x: dx / len, z: dz / len }
  }
  const facing = Number.isFinite(yaw) ? yaw : (Number.isFinite(entry?.navState?.facing) ? entry.navState.facing : 0)
  return { x: Math.cos(facing), z: -Math.sin(facing) }
}

export function clampTargetToSide(targets, name, base, side, minSide, isLeft, strength = 1) {
  const t = targets?.[name]
  if (!t || !base) return
  const rel = (t[0] - base[0]) * side.x + (t[2] - base[2]) * side.z
  const limit = isLeft ? -minSide : minSide
  const violation = isLeft ? rel > limit : rel < limit
  if (!violation) return
  const move = (limit - rel) * strength
  t[0] += side.x * move
  t[2] += side.z * move
}

export function alignFootToeTargets(entry, targets, yaw, leftLegIsSwing = false, rightLegIsSwing = false, isWalking = false) {
  const fwdX = Math.sin(yaw || 0)
  const fwdZ = Math.cos(yaw || 0)
  const sideX = Math.cos(yaw || 0)
  const sideZ = -Math.sin(yaw || 0)
  const footForward = Math.max(0.045, Math.min(0.085, (entry?.measurements?.footLength || 0.22) * 0.32))
  const maxSide = Math.max(0.03, footForward * 0.85)
  const fix = (shin, foot, isSwing) => {
    if (!shin || !foot) return
    const relX = foot[0] - shin[0]
    const relZ = foot[2] - shin[2]
    const side = Math.max(-maxSide, Math.min(maxSide, relX * sideX + relZ * sideZ))
    const fwd = footForward * (isWalking && isSwing ? 1.2 : 1)
    const targetX = foot[0] - fwdX * fwd - sideX * side
    const targetZ = foot[2] - fwdZ * fwd - sideZ * side
    const strength = isWalking ? (isSwing ? 0.42 : 0.68) : 0.55
    shin[0] += (targetX - shin[0]) * strength
    shin[2] += (targetZ - shin[2]) * strength
  }
  fix(targets?.leftShin, targets?.leftFoot, leftLegIsSwing)
  fix(targets?.rightShin, targets?.rightFoot, rightLegIsSwing)
}

export function clampLimbSideTargets(entry, ragdoll, targets, yaw = null) {
  const map = ragdoll?.boneMap
  const pelvis = map?.get('pelvis')?.particle
  const chest = map?.get('chest')?.particle
  if (!pelvis || !chest) return
  const side = getBodySideAxis(entry, ragdoll, yaw, true)
  const hipMin = Math.max(0.07, (entry?.measurements?.hipWidth || 0.36) * 0.42)
  const armMin = Math.max(0.10, (entry?.measurements?.shoulderWidth || 0.76) * 0.28)
  const pelvisBase = [pelvis.x, pelvis.y, pelvis.z]
  const chestBase = [chest.x, chest.y, chest.z]
  clampTargetToSide(targets, 'leftThigh', pelvisBase, side, hipMin * 0.45, true, 0.8)
  clampTargetToSide(targets, 'rightThigh', pelvisBase, side, hipMin * 0.45, false, 0.8)
  clampTargetToSide(targets, 'leftShin', pelvisBase, side, hipMin * 0.72, true, 0.9)
  clampTargetToSide(targets, 'rightShin', pelvisBase, side, hipMin * 0.72, false, 0.9)
  clampTargetToSide(targets, 'leftFoot', pelvisBase, side, hipMin, true, 1)
  clampTargetToSide(targets, 'rightFoot', pelvisBase, side, hipMin, false, 1)
  clampTargetToSide(targets, 'leftUpperArm', chestBase, side, armMin * 0.45, true, 0.5)
  clampTargetToSide(targets, 'rightUpperArm', chestBase, side, armMin * 0.45, false, 0.5)
  clampTargetToSide(targets, 'leftForearm', chestBase, side, armMin * 0.72, true, 0.8)
  clampTargetToSide(targets, 'rightForearm', chestBase, side, armMin * 0.72, false, 0.8)
  clampTargetToSide(targets, 'leftHand', chestBase, side, armMin, true, 1)
  clampTargetToSide(targets, 'rightHand', chestBase, side, armMin, false, 1)
}

export function stabilizeLimbSideFrame(entry, ragdoll, dt) {
  if (!['idle', 'locomotion', 'stumble', 'fallen', 'getup'].includes(entry?.state)) return
  const map = ragdoll?.boneMap
  const pelvis = map?.get('pelvis')?.particle
  const chest = map?.get('chest')?.particle
  if (!pelvis || !chest) return
  const side = getBodySideAxis(entry, ragdoll)
  const stateStrength = entry.state === 'fallen' || entry.state === 'getup'
    ? 0.55
    : entry.state === 'stumble'
      ? 0.42
      : entry.state === 'locomotion'
        ? 0.28
        : 0.22
  const hipMin = Math.max(0.07, (entry?.measurements?.hipWidth || 0.36) * 0.42)
  const armMin = Math.max(0.10, (entry?.measurements?.shoulderWidth || 0.76) * 0.28)
  const pushParticle = (name, base, minSide, isLeft, mul = 1) => {
    const p = map.get(name)?.particle
    if (!p) return
    const rel = (p.x - base.x) * side.x + (p.z - base.z) * side.z
    const limit = isLeft ? -minSide : minSide
    const violation = isLeft ? rel > limit : rel < limit
    if (!violation) return
    const move = (limit - rel) * stateStrength * mul
    const mx = side.x * move
    const mz = side.z * move
    p.x += mx
    p.z += mz
    p.px += mx
    p.pz += mz
    const sideVel = p.vx * side.x + p.vz * side.z
    const badVel = isLeft ? Math.max(0, sideVel) : Math.min(0, sideVel)
    if (Math.abs(badVel) > 0.01) {
      setParticleVelocity(p, p.vx - side.x * badVel * 0.75, p.vy, p.vz - side.z * badVel * 0.75, dt)
    }
  }
  pushParticle('leftThigh', pelvis, hipMin * 0.45, true, 0.55)
  pushParticle('rightThigh', pelvis, hipMin * 0.45, false, 0.55)
  pushParticle('leftShin', pelvis, hipMin * 0.72, true, 0.75)
  pushParticle('rightShin', pelvis, hipMin * 0.72, false, 0.75)
  pushParticle('leftFoot', pelvis, hipMin, true, 1)
  pushParticle('rightFoot', pelvis, hipMin, false, 1)
  pushParticle('leftUpperArm', chest, armMin * 0.45, true, 0.45)
  pushParticle('rightUpperArm', chest, armMin * 0.45, false, 0.45)
  pushParticle('leftForearm', chest, armMin * 0.72, true, 0.70)
  pushParticle('rightForearm', chest, armMin * 0.72, false, 0.70)
  pushParticle('leftHand', chest, armMin, true, 1)
  pushParticle('rightHand', chest, armMin, false, 1)
}

export function stabilizeShoulderGirdleFrame(entry, ragdoll) {
  if (!(entry?.state === 'idle' || entry?.state === 'locomotion')) return
  const map = ragdoll?.boneMap
  const chest = map?.get('chest')?.particle
  const left = map?.get('leftShoulder')?.particle
  const right = map?.get('rightShoulder')?.particle
  if (!chest || !left || !right) return
  const yaw = Number.isFinite(entry.navState?.facing) ? entry.navState.facing : 0
  const sideX = Math.cos(yaw)
  const sideZ = -Math.sin(yaw)
  const halfWidth = Math.max(0.05, (entry.measurements?.shoulderWidth || 0.76) * 0.3)
  const strength = entry.state === 'locomotion' ? 0.45 : 0.32
  const damp = entry.state === 'locomotion' ? 0.72 : 0.82
  const moveChain = (shoulder, names, tx, ty, tz) => {
    const dx = (tx - shoulder.x) * strength
    const dy = (ty - shoulder.y) * strength
    const dz = (tz - shoulder.z) * strength
    for (const name of names) {
      const p = map.get(name)?.particle
      if (!p) continue
      p.x += dx
      p.y += dy
      p.z += dz
      p.px += dx
      p.py += dy
      p.pz += dz
      const localDamp = p === shoulder ? damp : Math.max(damp, 0.90)
      p.vx *= localDamp
      p.vy *= localDamp
      p.vz *= localDamp
    }
  }
  moveChain(left, ['leftShoulder', 'leftUpperArm', 'leftForearm', 'leftHand'], chest.x - sideX * halfWidth, chest.y, chest.z - sideZ * halfWidth)
  moveChain(right, ['rightShoulder', 'rightUpperArm', 'rightForearm', 'rightHand'], chest.x + sideX * halfWidth, chest.y, chest.z + sideZ * halfWidth)
}

export function dampRelativeVelocity(child, parent, keep, dt) {
  setParticleVelocity(
    child,
    parent.vx + (child.vx - parent.vx) * keep,
    parent.vy + (child.vy - parent.vy) * keep,
    parent.vz + (child.vz - parent.vz) * keep,
    dt
  )
}

export function stabilizeHeadNeckFrame(entry, ragdoll, dt) {
  if (!(entry?.state === 'idle' || entry?.state === 'locomotion')) return
  const map = ragdoll?.boneMap
  const chest = map?.get('chest')?.particle
  const neck = map?.get('neck')?.particle
  const head = map?.get('head')?.particle
  if (!chest || !neck || !head) return
  const locomotion = entry.state === 'locomotion'
  dampRelativeVelocity(neck, chest, locomotion ? 0.58 : 0.48, dt)
  dampRelativeVelocity(head, neck, locomotion ? 0.50 : 0.40, dt)
  const leftShoulder = map.get('leftShoulder')?.particle
  const rightShoulder = map.get('rightShoulder')?.particle
  const baseX = leftShoulder && rightShoulder ? (leftShoulder.x + rightShoulder.x) * 0.5 : chest.x
  const baseZ = leftShoulder && rightShoulder ? (leftShoulder.z + rightShoulder.z) * 0.5 : chest.z
  const yaw = Number.isFinite(entry.navState?.facing) ? entry.navState.facing : 0
  const fwdX = Math.sin(yaw)
  const fwdZ = Math.cos(yaw)
  const sideX = Math.cos(yaw)
  const sideZ = -Math.sin(yaw)
  let dx = head.x - baseX
  let dz = head.z - baseZ
  const forward = dx * fwdX + dz * fwdZ
  const side = dx * sideX + dz * sideZ
  const desiredForward = locomotion ? 0.08 : 0.04
  const forwardErr = Math.max(0, desiredForward - forward)
  const sideErr = -side
  if (forwardErr > 0.01 || Math.abs(sideErr) > 0.08) {
    const postureStrength = locomotion ? 0.20 : 0.14
    const moveX = (fwdX * forwardErr + sideX * sideErr * 0.35) * postureStrength
    const moveZ = (fwdZ * forwardErr + sideZ * sideErr * 0.35) * postureStrength
    head.x += moveX
    head.z += moveZ
    head.px += moveX
    head.pz += moveZ
    neck.x += moveX * 0.45
    neck.z += moveZ * 0.45
    neck.px += moveX * 0.45
    neck.pz += moveZ * 0.45
    dx = head.x - baseX
    dz = head.z - baseZ
  }
  const lean = Math.hypot(dx, dz)
  const maxLean = locomotion ? 0.30 : 0.22
  if (lean > maxLean) {
    const s = maxLean / lean
    const targetX = baseX + dx * s
    const targetZ = baseZ + dz * s
    const moveX = (targetX - head.x) * (locomotion ? 0.34 : 0.42)
    const moveZ = (targetZ - head.z) * (locomotion ? 0.34 : 0.42)
    head.x += moveX
    head.z += moveZ
    head.px += moveX
    head.pz += moveZ
    neck.x += moveX * 0.35
    neck.z += moveZ * 0.35
    neck.px += moveX * 0.35
    neck.pz += moveZ * 0.35
  }
}

export function hasActiveMoveIntent(entry) {
  const navSpeed = Math.max(0, entry?.navState?.speed ?? 0)
  const intent = entry?.intent || null
  const dirMag = Math.hypot(intent?.targetDirX || 0, intent?.targetDirZ || 0)
  const desiredSpeed = intent?.desiredSpeed ?? (intent?.type === 'walk' ? 1 : 0)
  return navSpeed > 0.08 || (intent?.type === 'walk' && dirMag > 0.1 && desiredSpeed > 0.05)
}

export function applyGroundedNoIntentSettleBrake(entry, ragdoll, dt) {
  if (!(entry?.state === 'idle' || entry?.state === 'stumble')) return
  if (hasActiveMoveIntent(entry)) return
  if ((entry.groundedFeet ?? 0) < 2) return
  const map = ragdoll?.boneMap
  if (!map) return
  const coreXZKeep = Math.pow(entry.state === 'idle' ? 0.52 : 0.64, dt * 60)
  const coreYKeep = Math.pow(entry.state === 'idle' ? 0.58 : 0.72, dt * 60)
  const hipXZKeep = Math.pow(entry.state === 'idle' ? 0.62 : 0.72, dt * 60)
  const hipYKeep = Math.pow(entry.state === 'idle' ? 0.78 : 0.84, dt * 60)
  const dampVelocity = (name, xzKeep, yKeep) => {
    const p = map.get(name)?.particle
    if (!p) return
    setParticleVelocity(p, p.vx * xzKeep, p.vy * yKeep, p.vz * xzKeep, dt)
  }
  for (const name of ['pelvis', 'spine', 'spine1', 'chest']) dampVelocity(name, coreXZKeep, coreYKeep)
  dampVelocity('leftThigh', hipXZKeep, hipYKeep)
  dampVelocity('rightThigh', hipXZKeep, hipYKeep)
}

export function applyBalanceCorrectionToTargets(targets, balanceState, weight = 1) {
  if (!targets || !balanceState || balanceState.groundedFeet <= 0) return
  const correction = balanceState.correction
  if (!correction) return
  const amount = Math.max(0, weight) * Math.min(1.5, balanceState.balanceError || 0)
  if (amount <= 0) return
  const pelvis = targets.pelvis
  if (pelvis) {
    pelvis[0] += correction[0] * amount * 0.08
    pelvis[2] += correction[2] * amount * 0.08
  }
  const chest = targets.chest
  if (chest) {
    chest[0] += correction[0] * amount * 0.14
    chest[2] += correction[2] * amount * 0.14
  }
}

export function applyRhythmPoseModulation(targets, rhythms, weight = 1, fatigue = 0) {
  if (!targets || !rhythms?.phases || weight <= 0) return
  const [breath] = rhythmSample(rhythms, RHYTHM.BREATH)
  const [heart] = rhythmSample(rhythms, RHYTHM.HEART)
  const breathEffort = 1 + Math.max(0, Math.min(1, fatigue)) * 1.4
  const breathLift = breath * 0.012 * weight * breathEffort
  const ribSpread = breath * 0.0045 * weight * breathEffort
  const heartBob = heart * 0.002 * weight
  if (targets.chest) targets.chest[1] += breathLift + heartBob
  if (targets.spine1) targets.spine1[1] += breathLift * 0.45
  if (targets.neck) targets.neck[1] += breathLift * 0.25 + heartBob * 0.5
  if (targets.head) targets.head[1] += breathLift * 0.18 + heartBob * 0.6
  if (targets.leftShoulder) {
    targets.leftShoulder[0] -= ribSpread
    targets.leftShoulder[1] += breathLift * 0.12
  }
  if (targets.rightShoulder) {
    targets.rightShoulder[0] += ribSpread
    targets.rightShoulder[1] += breathLift * 0.12
  }
}

export function makeReflexState() {
  return {
    version: 1,
    mode: 'none',
    active: false,
    gates: { idle: false, locomotion: false, getupLate: false, fallenStumble: false },
    signals: { confidence: 0, leftTrust: 0, rightTrust: 0, leftSlip: 0, rightSlip: 0, highPressureTime: 0 },
    adjustments: { swingClearance: 0, stanceRollback: 0, ankleToeAlignment: 0, handBrace: 0, headNeckProtection: 0, phaseBias: 0 },
  }
}

export function applyContactReflexTargets(entry, ragdoll, targets, options = {}) {
  const reflex = entry.reflexState || makeReflexState()
  const contactTelemetry = entry.contactTelemetry
  const mode = classifyReflexMode(entry, options)
  const gates = {
    idle: mode === 'idle',
    locomotion: mode === 'locomotion',
    getupLate: mode === 'getupLate',
    fallenStumble: mode === 'fallenStumble',
  }
  const authority = buildMotorAuthorityMap(entry, contactTelemetry)
  entry.motorAuthorityMap = authority
  const left = contactTelemetry?.feet?.left || null
  const right = contactTelemetry?.feet?.right || null
  const leftTrust = clamp01(left?.stanceTrust ?? 0)
  const rightTrust = clamp01(right?.stanceTrust ?? 0)
  const leftSlip = clamp01(left?.slipRisk ?? 0)
  const rightSlip = clamp01(right?.slipRisk ?? 0)
  const bothHighPressure = !!left?.contact && !!right?.contact && (left.pressure ?? 0) > 0.75 && (right.pressure ?? 0) > 0.75
  const dt = Math.max(0, options.dt ?? 0)
  const highPressureTime = bothHighPressure
    ? Math.min(1, (reflex.signals?.highPressureTime || 0) + dt)
    : Math.max(0, (reflex.signals?.highPressureTime || 0) - dt * 2)
  const confidence = reflexConfidence(contactTelemetry, mode, leftTrust, rightTrust)
  const adjustments = { swingClearance: 0, stanceRollback: 0, ankleToeAlignment: 0, handBrace: 0, headNeckProtection: 0, phaseBias: 0 }
  reflex.version = 1
  reflex.mode = mode || 'none'
  reflex.gates = gates
  reflex.signals = { confidence: round4(confidence), leftTrust, rightTrust, leftSlip, rightSlip, highPressureTime: round4(highPressureTime) }
  reflex.adjustments = adjustments
  reflex.active = false
  if (!targets || !mode || confidence <= 0 || !contactTelemetry) {
    entry.reflexState = reflex
    return reflex
  }
  const yaw = options.yaw ?? entry.navState?.facing ?? 0
  const fwdX = Math.sin(yaw)
  const fwdZ = Math.cos(yaw)
  const sideX = Math.cos(yaw)
  const sideZ = -Math.sin(yaw)
  applyFootReflexTarget(entry, targets, left, {
    prefix: 'left',
    isSwing: !!options.leftLegIsSwing,
    mode,
    confidence,
    authority,
    fwdX,
    fwdZ,
    sideX,
    sideZ,
    adjustments,
  })
  applyFootReflexTarget(entry, targets, right, {
    prefix: 'right',
    isSwing: !!options.rightLegIsSwing,
    mode,
    confidence,
    authority,
    fwdX,
    fwdZ,
    sideX,
    sideZ,
    adjustments,
  })
  if (highPressureTime > 0.12 && mode === 'locomotion') {
    const phaseSide = options.leftLegIsSwing ? 'left' : options.rightLegIsSwing ? 'right' : leftTrust <= rightTrust ? 'left' : 'right'
    const foot = targets[`${phaseSide}Foot`]
    const shin = targets[`${phaseSide}Shin`]
    const lift = Math.min(0.025, highPressureTime * 0.035) * confidence * authority.functions.swingLift
    if (foot && lift > 0) {
      foot[1] += lift
      if (shin) shin[1] += lift * 0.35
      adjustments.phaseBias = Math.max(adjustments.phaseBias, round4(lift))
    }
  }
  applyBraceProtectionTargets(contactTelemetry, targets, {
    mode,
    confidence,
    authority,
    adjustments,
  })
  reflex.active = Object.values(adjustments).some(value => value > 0)
  entry.reflexState = reflex
  return reflex
}

export function classifyReflexMode(entry, options) {
  if (entry?.state === 'idle') return 'idle'
  if (entry?.state === 'locomotion') return 'locomotion'
  if (entry?.state === 'getup' && (options.desiredVerticality ?? 0) > 35) return 'getupLate'
  if (entry?.state === 'fallen' || entry?.state === 'stumble') return 'fallenStumble'
  return null
}

export function reflexConfidence(contactTelemetry, mode, leftTrust, rightTrust) {
  if (!mode || !contactTelemetry) return 0
  const support = clamp01(contactTelemetry.summary?.supportQuality ?? ((leftTrust + rightTrust) * 0.5))
  const contactCount = contactTelemetry.summary?.contactCount ?? 0
  if (mode === 'locomotion') return clamp01(0.35 + support * 0.65)
  if (mode === 'idle') return clamp01(contactCount > 0 ? 0.45 + support * 0.4 : 0)
  if (mode === 'getupLate') return clamp01(contactCount > 0 ? 0.35 + support * 0.35 : 0.25)
  if (mode === 'fallenStumble') return clamp01(contactCount > 0 ? 0.55 : 0)
  return 0
}

export function buildMotorAuthorityMap(entry, contactTelemetry) {
  const nervous = entry.nervousSystem || null
  const motor = nervous?.motor || null
  const sensory = nervous?.sensory || null
  const authority = clamp01(motor?.authority ?? 1)
  const proprioception = clamp01(sensory?.proprioception ?? 1)
  const pain = clamp01(sensory?.pain ?? 0)
  const fatigue = clamp01(nervous?.physiology?.fatigue ?? motor?.fatigueLoad ?? 0)
  const reflexGain = Math.max(0.5, Math.min(1.5, nervous?.spinalCord?.reflexGain ?? 1))
  const reflexScale = Math.max(0.75, Math.min(1.12, 1 + (reflexGain - 1) * 0.22))
  const support = clamp01(contactTelemetry?.summary?.supportQuality ?? 0)
  const slip = Math.max(clamp01(contactTelemetry?.feet?.left?.slipRisk ?? 0), clamp01(contactTelemetry?.feet?.right?.slipRisk ?? 0))
  const stance = clamp01(motor?.stanceSupport ?? authority)
  const swing = clamp01(motor?.swingClearance ?? authority)
  const brace = clamp01(motor?.brace ?? authority)
  const protect = clamp01(motor?.protect ?? brace)
  const functions = {
    stanceSupport: round4(clamp01(stance * proprioception * (0.55 + support * 0.45))),
    swingLift: round4(clamp01(swing * proprioception * (1 - pain * 0.18) * reflexScale)),
    ankleToeAlignment: round4(clamp01(authority * proprioception * (1 - slip * 0.2))),
    handBrace: round4(clamp01(brace * (0.75 + pain * 0.25))),
    headNeckProtection: round4(clamp01(protect * (0.8 + pain * 0.2) * reflexScale)),
  }
  return { version: 1, functions, physiology: { fatigue: round4(fatigue), reflexGain: round4(reflexGain) }, status: authority < 0.35 ? 'impaired' : 'normal' }
}

export function applyFootReflexTarget(entry, targets, record, options) {
  if (!record) return
  const foot = targets[`${options.prefix}Foot`]
  const shin = targets[`${options.prefix}Shin`]
  const contactY = (entry.anchorPosition?.[1] || 0) + FOOT_PARTICLE_SOLE_HEIGHT
  const pressure = clamp01(record.pressure ?? 0)
  const slip = clamp01(record.slipRisk ?? 0)
  const trust = clamp01(record.stanceTrust ?? 0)
  if (options.isSwing || options.mode === 'getupLate') {
    const liftSignal = Math.max(pressure * 0.75, slip)
    const lift = Math.min(0.04, liftSignal * 0.035) * options.confidence * options.authority.functions.swingLift
    if (foot && lift > 0) {
      foot[1] = Math.max(foot[1], contactY + 0.045 + lift)
      if (shin) shin[1] += lift * 0.35
      options.adjustments.swingClearance = Math.max(options.adjustments.swingClearance, round4(lift))
    }
  } else if (options.mode === 'locomotion') {
    const lowTrust = clamp01((0.45 - trust) / 0.45)
    const rollback = lowTrust * 0.026 * options.confidence * options.authority.functions.stanceSupport
    if (foot && rollback > 0) {
      foot[0] += options.fwdX * rollback
      foot[2] += options.fwdZ * rollback
      if (shin) {
        shin[0] += options.fwdX * rollback * 0.35
        shin[2] += options.fwdZ * rollback * 0.35
      }
      options.adjustments.stanceRollback = Math.max(options.adjustments.stanceRollback, round4(rollback))
    }
  }
  const alignment = clamp01(record.derived?.shinFootAlignmentError ?? 0)
  if (foot && shin && alignment > 0.18) {
    const sideDelta = (foot[0] - shin[0]) * options.sideX + (foot[2] - shin[2]) * options.sideZ
    const correction = sideDelta * Math.min(0.18, alignment * 0.2) * options.confidence * options.authority.functions.ankleToeAlignment
    shin[0] += options.sideX * correction
    shin[2] += options.sideZ * correction
    options.adjustments.ankleToeAlignment = Math.max(options.adjustments.ankleToeAlignment, round4(Math.abs(correction)))
  }
}

export function applyBraceProtectionTargets(contactTelemetry, targets, options) {
  const handLift = (record, name) => {
    const target = targets[name]
    if (!target || !record?.contact) return
    const pressure = clamp01(record.pressure ?? 0)
    const adjust = Math.min(0.025, pressure * 0.018) * options.confidence * options.authority.functions.handBrace
    target[1] = Math.max(target[1], (record.point?.[1] ?? target[1]) + adjust)
    options.adjustments.handBrace = Math.max(options.adjustments.handBrace, round4(adjust))
  }
  handLift(contactTelemetry.byBone?.leftHand, 'leftHand')
  handLift(contactTelemetry.byBone?.rightHand, 'rightHand')
  const headRecord = contactTelemetry.byBone?.head
  if (headRecord?.contact && targets.head) {
    const pressure = clamp01(headRecord.pressure ?? 0)
    const adjust = Math.min(0.035, pressure * 0.028) * options.confidence * options.authority.functions.headNeckProtection
    targets.head[1] += adjust
    if (targets.neck) targets.neck[1] += adjust * 0.55
    options.adjustments.headNeckProtection = Math.max(options.adjustments.headNeckProtection, round4(adjust))
  }
}

export function resolveActivePoseState(entry) {
  const intent = entry.intent || {}
  const requested = entry.state === 'getup'
    ? 'getup'
    : entry.state === 'stumble'
      ? 'recover'
      : resolveRequestedPoseState(intent, 'idle_stand')
  return makePoseStateMeta(requested)
}

export function makePoseStateMeta(stateId) {
  const state = DEFAULT_POSE_STATES[stateId] || DEFAULT_POSE_STATES.idle_stand
  return {
    state: state.id,
    strengthScale: state.strengthScale ?? 1,
    dampingScale: state.dampingScale ?? 1,
    stiffnessScale: state.stiffnessScale ?? 1,
    blendMode: state.blendMode ?? 'linear',
    blendTime: state.blendTime ?? 0.18,
  }
}

export function applyStandingController(ragdoll, entry, dt) {
  const pose = getCachedPose('stand')
  if (!pose) return
  const pelvisP = ragdoll.bones[0]?.particle
  if (!pelvisP) return

  // ─── PACER WALKING — POSE AS REWARD GUIDELINE ──────────────────────────
  // The body is NOT slid kinematically. Instead:
  //   1. The stand-pose anchor tracks the current pelvis each frame so
  //      pose targets are placed around where the body actually IS.
  //   2. The stride overlay (next block) offsets foot/shin/arm targets
  //      *ahead* of the pelvis following the CPG gait phase.
  //   3. PBD distance constraints (foot↔shin↔thigh↔pelvis) transmit the
  //      pull — when the foot target is ahead, the whole chain is yanked
  //      forward, which moves the pelvis via the hip joint. This is real
  //      mechanical walking: legs drag the body.
  //   4. The NN sees sin/cos(gait_phase) + waypoint direction in its obs;
  //      its ±8 cm residual refines timing and balance.
  //   5. The reward function pays for forward velocity toward the
  //      waypoint AND waypoint proximity AND upright posture, so AWR
  //      training reinforces whatever residuals produce clean steps.
  //
  // No anchor teleport. No fake slide. Pose is a *guideline*, not a cage.
  const intent = entry.intent
  const isWalking = intent?.type === 'walk'
  const locomotionBlend = isWalking
    ? Math.min(1, (Number.isFinite(entry.locomotionBlend) ? entry.locomotionBlend : 0) + dt * 3.5)
    : 0
  entry.locomotionBlend = locomotionBlend
  let locomotionSpeed = 0
  entry.locomotionAssist = null

  // When the body ISN'T walking, drain speed so the state machine falls
  // back to 'idle' and stepRhythms stops advancing the gait phase. Without
  // this, bodies keep "walking in place" after arriving at a waypoint.
  if (!isWalking && entry.navState) {
    entry.navState.speed = 0
    if (entry.navState.velocity) {
      entry.navState.velocity[0] = 0
      entry.navState.velocity[1] = 0
    }
  }

  // ─── YAW SLEW — always run ─────────────────────────────────────────────
  // Smoothly rotate navState.facing toward navState.facingTarget at 3 rad/s
  // (~170°/s) — a real human turns-in-place at about 180°/s max, so this is
  // the fastest believable spin rate. Previously 5 rad/s (~290°/s) made
  // bodies swivel unnaturally fast when player changed direction, which
  // gave the "twitchy" feel and also desynced the stride overlay (legs
  // couldn't keep up with the pelvis yaw).
  //
  // This runs whether walking or standing, so:
  //   - turn-in-place works (gameplay can call setFacingTarget without walking)
  //   - body never snaps to a new direction — always gradual
  //   - idle bodies hold their last heading instead of drifting to yaw=0
  if (entry.navState && entry.navState.facingTarget != null) {
    const cur = entry.navState.facing ?? entry.navState.facingTarget
    let delta = entry.navState.facingTarget - cur
    while (delta >  Math.PI) delta -= 2 * Math.PI
    while (delta < -Math.PI) delta += 2 * Math.PI
    const TURN_RATE = 3.0   // rad/s — human-scale turn-in-place speed
    const slew = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, delta))
    entry.navState.facing = cur + slew
  }

  if (isWalking) {
    // Anchor = pelvis xz (NOT sliding at desiredSpeed — the body moves
    // because physics drags it). This frees the pose targets to be
    // built around the current position, so stride offsets put feet
    // slightly ahead/behind the live pelvis rather than the spawn point.
    entry.anchorPosition[0] = pelvisP.x
    entry.anchorPosition[2] = pelvisP.z
    entry.getupAnchor[0] = 0; entry.getupAnchor[2] = 0

    // Derive forward direction for facing + rhythm activation. PREFER
    // targetDirX/Z (the user's / AI's intended heading) over the waypoint,
    // because waypoint = planner's next A* node which can be smoothed,
    // lag behind the pelvis, or route sideways around obstacles. Using
    // the waypoint for facing caused a bug where bodies visibly faced /
    // moved toward the planner node instead of the pressed direction.
    // Fall back to the waypoint-to-pelvis vector only if targetDir is
    // unset (purely planner-driven NPCs with no direction hint).
    let dx = intent.targetDirX ?? 0
    let dz = intent.targetDirZ ?? 0
    if ((Math.abs(dx) + Math.abs(dz)) < 1e-4 && intent.waypoint) {
      dx = intent.waypoint[0] - pelvisP.x
      dz = intent.waypoint[1] - pelvisP.z
    }
    const dLen = Math.hypot(dx, dz)
    if (dLen > 0.05) {
      const fwdX = dx / dLen
      const fwdZ = dz / dLen
      const desiredSpeed = intent.desiredSpeed ?? 1.5
      locomotionSpeed = desiredSpeed

      // Activate locomotion + gait CPG. stepRhythms() only advances
      // phases[GAIT_L] when state === 'locomotion', which the state
      // machine flips to when navState.speed > 0.1. Without this,
      // sin(gait_phase) stays frozen and the stride overlay produces
      // no cyclic motion.
      if (!entry.navState) entry.navState = {}
      entry.navState.speed = desiredSpeed
      entry.navState.velocity = [fwdX * desiredSpeed, fwdZ * desiredSpeed]
      if (entry.state === 'idle') entry.state = 'locomotion'

      // Face the walk direction. Just request the target — the global
      // slew block above handles interpolation at 5 rad/s every frame,
      // whether we're walking, turning in place, or idle.
      entry.navState.facingTarget = Math.atan2(fwdX, fwdZ)
      // On the very first frame of walking, seed facing to the current
      // value so the slew doesn't start from `undefined`.
      if (entry.navState.facing == null) entry.navState.facing = entry.navState.facingTarget
    }
  }

  // Use the fixed spawn anchor (or getupAnchor if body just got up). This
  // prevents drift: if anchor tracked pelvis every frame, any pelvis motion
  // would drag all other targets with it, causing the body to slide.
  // Standing bodies should hold their ground position.
  const anchor = entry.getupAnchor[0] !== 0 || entry.getupAnchor[2] !== 0
    ? entry.getupAnchor
    : entry.anchorPosition
  const yaw = entry.navState?.facing || 0

  const standTargets = getPoseWorldTargets(pose, entry.measurements, anchor, yaw)
  const standPoseTargets = getPoseWorldPoseTargets(pose, entry.measurements, anchor, yaw)
  let walkCycleWeight = 0
  let targets = standTargets
  let blendedPoseTargets = standPoseTargets

  if (isWalking && locomotionBlend > 0.12 && entry.rhythms?.phases) {
    const gaitPhase = entry.rhythms.phases[RHYTHM.GAIT_L] ?? 0
    const walkAnchor = [pelvisP.x, anchor[1], pelvisP.z]
    const walkTargets = getWalkCycleWorldTargets(gaitPhase, entry.measurements, walkAnchor, yaw)
    const walkPoseTargets = getWalkCycleWorldPoseTargets(gaitPhase, entry.measurements, walkAnchor, yaw)
    if (walkTargets) {
      walkCycleWeight = Math.min(0.92, locomotionBlend * 0.9)
      targets = blendPositionTargetMaps(standTargets, walkTargets, walkCycleWeight)
      if (walkPoseTargets) {
        blendedPoseTargets = blendWorldPoseTargets(standPoseTargets, walkPoseTargets, walkCycleWeight)
      }
    }
  }
  entry.walkCycleWeight = walkCycleWeight

  entry.rotationTargets = extractRotationTargets(blendedPoseTargets)
  entry.neuralRotationResiduals = computeNeuralRotationResidualHints(entry.rotationTargets, entry.poseState)
  applyBalanceCorrectionToTargets(targets, entry.balanceState, isWalking ? 0.6 : 1.0)
  applyRhythmPoseModulation(targets, entry.rhythms, isWalking ? 0.55 : 1.0, estimateAverageFatigue(entry))
  let leftLegIsSwing = false
  let rightLegIsSwing = false

  // ─── PACER WALKING STRIDE OVERLAY ──────────────────────────────────────
  // Pendulum stride driven by CPG gait phase. Left=φ, right=φ+π.
  // Forward offset uses cos(φ); lift uses max(0,-sin(φ)) — see detailed
  // gait-cycle comment in the block below for biomechanical mapping.
  //
  // Propulsion is physical: ground friction (μ≈0.85, set in
  // enforceGroundContact) plants the stance foot. The PD motor target
  // recedes backward through stance phase; the unresolved foot-to-target
  // error creates a rearward PD force; foot can't slide (friction); the
  // distance-constraint chain pelvis↔thigh↔shin↔foot transmits the
  // reaction as forward force on the pelvis. Same controller pattern as
  // Atlas / Isaac Humanoid / DeepMimic. The NN learns balance + timing.
  if (isWalking && entry.rhythms?.phases) {
    // Smaller amplitudes than a textbook stride. Real bodies bootstrap
    // from standing only when the leading foot stays close to under the
    // CoM at heel-strike — a 0.30m forward foot pivots a stationary body
    // backward via gravity. 0.18m gives the leg time to catch the falling
    // pelvis without overshooting.
    // When walk_cycle poses drive the skeleton, shrink procedural overlay so
    // the two layers do not fight (additive-style, like skinning bases).
    const strideMul = 1 - Math.min(0.85, walkCycleWeight * 0.9)
    const speedScale = Math.max(0.35, Math.min(1.2, locomotionSpeed / 1.5))
    const STRIDE = 0.18 * locomotionBlend * speedScale * strideMul
    const STEP_HEIGHT = 0.085 * locomotionBlend * Math.sqrt(speedScale) * strideMul
    const THIGH_SWING = 0.08 * locomotionBlend * speedScale * strideMul
    const gaitPhase = entry.rhythms.phases[2] ?? 0    // RHYTHM.GAIT_L = 2
    const lPh = gaitPhase
    const rPh = gaitPhase + Math.PI
    // Forward-world direction. yaw=0 → +Z, so fwd = (sin yaw, cos yaw).
    // Limbs stride forward in this direction so foot/hand velocity arrows
    // visibly move WITH the body's facing arrow, not against it.
    const fx = Math.sin(yaw), fz = Math.cos(yaw)

    // ─── PENDULUM STRIDE — propulsion-first gait cycle ────────────────
    //
    // Phase mapping (chosen so a STANDING-START body actually walks
    // forward, not backward):
    //   φ = 0       : TOE-OFF / late stance. Foot BEHIND, just lifting.
    //   φ = π/2     : MID-SWING.             Foot UNDER pelvis, in air.
    //   φ = π       : HEEL-STRIKE.           Foot AHEAD, lands on ground.
    //   φ = 3π/2    : MID-STANCE.            Foot UNDER pelvis, on ground.
    //   φ = 2π      : back to toe-off.
    //
    // Forward offset uses -cos(φ):  at φ=0 foot is BEHIND (-STRIDE),
    // at φ=π foot is AHEAD (+STRIDE). Lift uses max(0, sin(φ)) for
    // φ ∈ [0, π] (swing phase, foot in air).
    //
    // WHY THIS ORIENTATION (vs. the textbook "φ=0 = heel-strike"):
    // For a body with NO forward momentum (just starting to walk), foot-
    // ahead-of-CoM at heel-strike pivots the body BACKWARD around the
    // planted foot — gravity tips the unsupported torso the wrong way.
    // Starting with foot BEHIND CoM puts the support point behind the
    // body, so gravity tips the torso FORWARD over the foot — the
    // inverted-pendulum forward fall that real walkers use to bootstrap
    // momentum. After one cycle the body has velocity, and the
    // pendulum-on-pendulum gait sustains itself.
    //
    // This matches how DeepMimic / Isaac Humanoid policies learn to
    // start: from standing, they LEAN forward first (foot stays put),
    // then swing the back leg forward to catch the fall. Same dynamics.
    //
    // Propulsion mechanism unchanged: ground friction (μ≈0.85) plants
    // the stance foot, the moving target creates PD error, the chain
    // transmits the reaction as pelvis-forward force.
    const lCos  = Math.cos(lPh)
    const rCos  = Math.cos(rPh)
    const lSwing = Math.max(0, Math.sin(lPh))   // 1 mid-swing, 0 in stance
    const rSwing = Math.max(0, Math.sin(rPh))
    const lIsSwing = lSwing > 0.25
    const rIsSwing = rSwing > 0.25
    leftLegIsSwing = lIsSwing
    rightLegIsSwing = rIsSwing
    const STANCE_PUSH = 0.055 * locomotionBlend * speedScale
    const contactY = (entry.anchorPosition?.[1] || 0) + FOOT_PARTICLE_SOLE_HEIGHT
    const stanceFootY = contactY
    const lFwd  = lIsSwing ? -lCos * STRIDE : 0
    const rFwd  = rIsSwing ? -rCos * STRIDE : 0
    const lLift = lSwing * STEP_HEIGHT
    const rLift = rSwing * STEP_HEIGHT
    const lFootP = ragdoll.boneMap?.get('leftFoot')?.particle
    const rFootP = ragdoll.boneMap?.get('rightFoot')?.particle
    const lShinP = ragdoll.boneMap?.get('leftShin')?.particle
    const rShinP = ragdoll.boneMap?.get('rightShin')?.particle

    const lFoot = targets.leftFoot
    if (lFoot) {
      lFoot[0] += fx * lFwd
      lFoot[2] += fz * lFwd
      if (!lIsSwing && lFootP) {
        lFoot[0] = lFootP.x - fx * STANCE_PUSH
        lFoot[1] = Math.max(lFoot[1], stanceFootY)
        lFoot[2] = lFootP.z - fz * STANCE_PUSH
      } else if (lIsSwing) {
        lFoot[1] += lLift
        lFoot[1] = Math.max(lFoot[1], contactY + 0.035 + lSwing * STEP_HEIGHT)
      }
    }
    const rFoot = targets.rightFoot
    if (rFoot) {
      rFoot[0] += fx * rFwd
      rFoot[2] += fz * rFwd
      if (!rIsSwing && rFootP) {
        rFoot[0] = rFootP.x - fx * STANCE_PUSH
        rFoot[1] = Math.max(rFoot[1], stanceFootY)
        rFoot[2] = rFootP.z - fz * STANCE_PUSH
      } else if (rIsSwing) {
        rFoot[1] += rLift
        rFoot[1] = Math.max(rFoot[1], contactY + 0.035 + rSwing * STEP_HEIGHT)
      }
    }

    // ─── HIP PENDULUM (thigh swings about pelvis) ─────────────────────
    // Per the user's "swing legs not shimmy" — the leg should ROTATE
    // about the hip, not just translate the foot. Adding a forward offset
    // to the THIGH target makes the whole leg pivot, which is what a real
    // pendulum leg does. Amplitude is half-foot so the foot leads, the
    // thigh follows naturally through the chain. Knee bend then resolves
    // through the existing distance + angle constraints.
    //
    // Sign matches lFwd (= -lCos*STRIDE) so thigh pendulums in lockstep
    // with the foot — leg swings as a unit, not opposing parts.
    const lThigh = targets.leftThigh
    if (lThigh && lIsSwing) {
      const tFwd = -lCos * THIGH_SWING
      lThigh[0] += fx * tFwd
      lThigh[2] += fz * tFwd
    } else if (lThigh) {
      lThigh[0] += fx * STANCE_PUSH * 0.45
      lThigh[2] += fz * STANCE_PUSH * 0.45
    }
    const rThigh = targets.rightThigh
    if (rThigh && rIsSwing) {
      const tFwd = -rCos * THIGH_SWING
      rThigh[0] += fx * tFwd
      rThigh[2] += fz * tFwd
    } else if (rThigh) {
      rThigh[0] += fx * STANCE_PUSH * 0.45
      rThigh[2] += fz * STANCE_PUSH * 0.45
    }
    // Shins track at intermediate amplitude (between thigh and foot).
    // During swing they also lift partway so the knee follows the foot.
    const lShin = targets.leftShin
    if (lShin) {
      const sFwd = -lCos * (THIGH_SWING + STRIDE) * 0.5
      if (lIsSwing) {
        lShin[0] += fx * sFwd
        lShin[1] += lLift * 0.15
        lShin[2] += fz * sFwd
      }
      if (!lIsSwing && lShinP) {
        lShin[0] = lShinP.x - fx * STANCE_PUSH * 0.35
        lShin[2] = lShinP.z - fz * STANCE_PUSH * 0.35
      }
    }
    const rShin = targets.rightShin
    if (rShin) {
      const sFwd = -rCos * (THIGH_SWING + STRIDE) * 0.5
      if (rIsSwing) {
        rShin[0] += fx * sFwd
        rShin[1] += rLift * 0.15
        rShin[2] += fz * sFwd
      }
      if (!rIsSwing && rShinP) {
        rShin[0] = rShinP.x - fx * STANCE_PUSH * 0.35
        rShin[2] = rShinP.z - fz * STANCE_PUSH * 0.35
      }
    }
    // Counter-arm swing — CPG arm phases (antiphase to opposite leg). Full
    // walk_cycle poses already animate arms; add rhythm layer only when the
    // cycle blend is still ramping up.
    const lHand = targets.leftHand
    const rHand = targets.rightHand
    const lUpperArm = targets.leftUpperArm
    const rUpperArm = targets.rightUpperArm
    const ARM_SWING = walkCycleWeight > 0.55 ? 0 : 0.14 * locomotionBlend * strideMul
    if (ARM_SWING > 0) {
      const [armLSin] = rhythmSample(entry.rhythms, RHYTHM.ARM_L)
      const [armRSin] = rhythmSample(entry.rhythms, RHYTHM.ARM_R)
      const armFwdL = armLSin * ARM_SWING
      const armFwdR = armRSin * ARM_SWING
      if (lHand) { lHand[0] += fx * armFwdL; lHand[2] += fz * armFwdL }
      if (rHand) { rHand[0] += fx * armFwdR; rHand[2] += fz * armFwdR }
      if (lUpperArm) { lUpperArm[0] += fx * armFwdL * 0.45; lUpperArm[2] += fz * armFwdL * 0.45 }
      if (rUpperArm) { rUpperArm[0] += fx * armFwdR * 0.45; rUpperArm[2] += fz * armFwdR * 0.45 }
    }

    // ─── FORWARD LEAN BIAS ────────────────────────────────────────────
    // Critical for not-tipping-backward at heel-strike. With STRIDE=0.18,
    // the leading foot can be up to 0.18m ahead of pelvis. Gravity will
    // pivot the body about that foot in whichever direction the CoM lies.
    // Pushing chest 0.10m forward biases the upper-body mass toward the
    // leading foot, so gravity tips the torso FORWARD over the foot
    // (inverted pendulum forward fall) instead of rearward. Real human
    // walkers maintain about 5–8° of forward lean at normal pace.
    const LEAN = 0.06 * locomotionBlend
    const chest = targets.chest
    if (chest) { chest[0] += fx * LEAN; chest[2] += fz * LEAN }
    const head = targets.head
    if (head) { head[0] += fx * LEAN * 0.25; head[2] += fz * LEAN * 0.25 }
    const neck = targets.neck
    if (neck) { neck[0] += fx * LEAN * 0.45; neck[2] += fz * LEAN * 0.45 }
    // Spine bones also lean — keeps the whole torso column tilted forward
    // rather than only the chest, so the lean force is distributed.
    const spine = targets.spine
    if (spine) { spine[0] += fx * LEAN * 0.4; spine[2] += fz * LEAN * 0.4 }
    const spine1 = targets.spine1
    if (spine1) { spine1[0] += fx * LEAN * 0.7; spine1[2] += fz * LEAN * 0.7 }
  }

  // ─── NON-CROSSING FOOT BARRIER ──────────────────────────────────────
  // Project each foot onto the body's sideways axis. If the left foot has
  // drifted toward/past the midline or the right foot has drifted toward
  // the left side, snap its side component back to at least a minimum
  // stance half-width. This is how biomechanically-informed locomotion
  // controllers (ALIP step-placement, Boston Dynamics Atlas, Ragdoll
  // Dynamics foot IK) prevent the "crossed legs" look — they enforce a
  // minimum base of support below the pelvis regardless of gait phase
  // or pose-library output. Runs BOTH in walking (after stride overlay)
  // AND in idle (after stand pose lookup) so crossed legs are physically
  // impossible at the target level, which is what the PD motor drives.
  {
    const sideX = Math.cos(yaw)      // body-local +X in world
    const sideZ = -Math.sin(yaw)
    const MIN_STANCE = entry.measurements.hipWidth * 0.5   // ~9 cm each side
    const clampFoot = (foot, isLeft) => {
      if (!foot) return
      const px = foot[0] - pelvisP.x
      const pz = foot[2] - pelvisP.z
      const sideComp = px * sideX + pz * sideZ
      // Left foot should be at sideComp ≤ -MIN_STANCE, right foot ≥ +MIN_STANCE.
      const limit = isLeft ? -MIN_STANCE : MIN_STANCE
      const violating = isLeft ? (sideComp > limit) : (sideComp < limit)
      if (violating) {
        const correction = limit - sideComp
        foot[0] += sideX * correction
        foot[2] += sideZ * correction
      }
    }
    if (!isWalking || leftLegIsSwing) clampFoot(targets.leftFoot,  true)
    if (!isWalking || rightLegIsSwing) clampFoot(targets.rightFoot, false)
    // Pull shins toward their respective feet on the side-axis so the
    // knees don't kink inward while the feet are held apart.
    const clampShin = (shin, foot) => {
      if (!shin || !foot) return
      // Shins should sit at ~50% of the foot's side displacement from pelvis.
      const footSide = (foot[0] - pelvisP.x) * sideX + (foot[2] - pelvisP.z) * sideZ
      const shinSide = (shin[0] - pelvisP.x) * sideX + (shin[2] - pelvisP.z) * sideZ
      const target = footSide * 0.6
      const delta  = target - shinSide
      shin[0] += sideX * delta
      shin[2] += sideZ * delta
    }
    if (!isWalking || leftLegIsSwing) clampShin(targets.leftShin,  targets.leftFoot)
    if (!isWalking || rightLegIsSwing) clampShin(targets.rightShin, targets.rightFoot)
  }

  if (!isWalking) {
    const calmGroundedFoot = (name) => {
      const p = ragdoll.boneMap?.get(name)?.particle
      const t = targets[name]
      if (!p || !t) return
      const contactY = (entry.anchorPosition?.[1] || 0) + FOOT_PARTICLE_SOLE_HEIGHT
      if (p.y <= contactY + 0.08) {
        t[0] = p.x
        t[1] = Math.max(t[1], p.y)
        t[2] = p.z
      }
    }
    calmGroundedFoot('leftFoot')
    calmGroundedFoot('rightFoot')
  }
  alignFootToeTargets(entry, targets, yaw, leftLegIsSwing, rightLegIsSwing, isWalking)

  // ─── NN RESIDUAL PASS (same as getup) ──────────────────────────────
  // The NN adds ±8cm per-bone residual offsets on top of the stand pose.
  // This lets neuromodifiers (alcohol, drugs, tremor) affect the body
  // even when idle — the NN forward pass corrupts outputs and those
  // propagate into pose targets which drive the motor.
  const bonesByName = _bonesByName(ragdoll)

  // (rhythms are stepped globally in update() — not here)

  // Run NN if the body has one (created lazily on first getup).
  if (entry.neuralMotor) {
    const intent = entry.intent || { type: 'stand', targetVerticality: 50 }
    const currentV = measureBodyVerticality(ragdoll)
    const obs = buildObservation(ragdoll, bonesByName, currentV, 50, intent, entry.rhythms, entry._frameSensors)
    const nn = entry.neuralMotor
    const teacher = computeTeacherSignal(targets, ragdoll, bonesByName, isWalking ? 0.10 : 0.12)
    const reward = computeReward(ragdoll, bonesByName, targets, intent)
    const pel = bonesByName.pelvis?.particle
    const che = bonesByName.chest?.particle
    const hed = bonesByName.head?.particle
    let trainCoreV = 0
    for (const p of [pel, che, hed]) if (p) trainCoreV += Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0)
    const stable = currentV > 35 && trainCoreV < 10 && (!isWalking || (entry.groundedFeet || 0) > 0)
    entry._lastAniMotionPrior = mixAniMotionTeacher(teacher, entry._aniMotionPrior, entry, ragdoll, bonesByName, intent, { stable, rate: isWalking ? 0.09 : 0.08 })
    trainNeuralMotor(nn, obs, teacher, reward, { stable, lr: isWalking ? 0.0008 : 0.0006 })
    entry._brainSaveTimer = (entry._brainSaveTimer || 0) + dt
    if (entry._brainSaveTimer > 30) {
      entry._brainSaveTimer = 0
      saveBrain(entry.motorProfileKey || entry.entityId, nn).catch(() => {})
    }
    if (!isWalking) {
      const offsets = neuralMotorForward(nn, obs, entry.stateTimer, { explorationScale: 0 })
      // Gentler residual weight during idle — we're holding a pose, not
      // driving big transitions. Max 50% of NN output strength.
      const idleTrust = estimateNeuralMotorTrust(nn, { cap: 0.12 })
      const idleNNWeight = idleTrust.trust
      entry._lastBrainTrust = idleTrust
      entry.neuralRotationResiduals = computeNeuralRotationResidualHints(entry.rotationTargets, entry.poseState, offsets, idleNNWeight)
      if (idleNNWeight > 0) {
        for (let i = 0; i < offsets.length; i++) offsets[i] *= idleNNWeight
        dampIdleNeuralOffsets(offsets)
        applyNeuralOffsets(offsets, targets)
      }
    }
  }
  coupleShoulderGirdleTargets(entry, ragdoll, targets, yaw)
  applyContactReflexTargets(entry, ragdoll, targets, {
    dt,
    yaw,
    leftLegIsSwing,
    rightLegIsSwing,
  })

  // Measure core velocity — if body is ALREADY calm, reduce motor output
  // so we don't induce vibration. If body is being disturbed, full strength.
  const pelvis = ragdoll.bones[0]?.particle
  const chest = ragdoll.bones[3]?.particle
  const head = ragdoll.bones[5]?.particle
  let coreV = 0
  for (const p of [pelvis, chest, head]) {
    if (p) coreV += Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz)
  }
  // Motor activity with a WIDE dead-zone. Real standing humans don't
  // constantly twitch — they only fire corrective muscle action when
  // actually disturbed beyond a noticeable threshold (neuromotor
  // deadband). Previously the activity ramp started at coreV=0, so even
  // sub-cm PBD noise kept the motor at ~20% every frame, producing the
  // "shifty / stuttering" look the user reported. By stretching the
  // ramp — 35% minimum up to coreV≈2, then linear up to 100% at coreV≥8
  // — we get:
  //   • Fully-still body: motor sits at a calm 35% baseline, no twitch
  //   • Light disturbance (<2 m/s aggregated core velocity): still 35%
  //   • Real disturbance: activity climbs smoothly toward 100%
  // References: Winter's biomechanics textbook on postural sway, and
  // DeepMimic's "tracking deadband" trick for style-preserving policies.
  const DEADBAND = 2.0      // m/s below this, baseline motor only
  const RAMP_TO  = 8.0      // m/s at/above which motor is full authority
  const excess   = Math.max(0, coreV - DEADBAND)
  const activity = Math.max(0.35, Math.min(1.0, 0.35 + excess / (RAMP_TO - DEADBAND) * 0.65))

  // ─── NEURO DISRUPTION: DISABLE MOTOR CONTROL ─────────────────────────
  // Severe neural disruption (seizure, paralytic, heavy poison) should
  // PREVENT the motor from holding the body upright. The motor cortex is
  // the thing that fires these muscles — if the cortex is being hijacked
  // (seizure) or silenced (paralytic), standing reflex fails.
  //
  // Formula:
  //   neuroDisrupt = dropout + seizureAmp*0.5 + (1 - scale)
  // Higher = body less able to stand.
  // At 1.0+ disruption, motor strength approaches zero → body collapses.
  const mod = entry.neuralMotor?.modifiers
  let neuroDisrupt = 0
  if (mod) {
    neuroDisrupt = (mod.dropout ?? 0)
                 + (mod.seizureAmp ?? 0) * 0.5
                 + Math.max(0, 1 - (mod.scale ?? 1))
  }
  // Motor authority falls from 1.0 (healthy) to 0 (full disruption)
  const neuroAuthority = Math.max(0, 1 - neuroDisrupt)
  const poseState = entry.poseState || makePoseStateMeta('idle_stand')
  const strengthScale = poseState.strengthScale ?? 1
  const dampingScale = poseState.dampingScale ?? 1
  const stiffnessScale = poseState.stiffnessScale ?? 1
  const stiffnessOmega = Math.sqrt(Math.max(0.25, stiffnessScale))
  if ((isWalking || entry.state === 'idle') && entry._targetTraceFrame) {
    logLocomotionTargetTrace(entry, ragdoll, targets, {
      frame: entry._targetTraceFrame,
      locomotionBlend,
      leftLegIsSwing,
      rightLegIsSwing,
      activity,
      neuroAuthority,
    })
  }

  // Use the hybrid muscle motor for standing. Blend rate ramped from the
  // previous near-zero 0.004 to 0.025 — that was too weak to hold posture
  // against gravity, so bodies sagged forward (12° lean visible in
  // ORIENT logs) and the standing pose was effectively decorative. 0.025
  // gives ~1.5 m/s closing speed at 1m error, enough to actively maintain
  // the stand pose without inducing twitch (deadband + over-damping
  // suppress vibration in the small-error regime).
  applyKinematicBlend(ragdoll, targets, 0.025 * activity * neuroAuthority * stiffnessScale, {
    dt,
    horizontalScale: isWalking ? 0.8 : 1,
    horizontalDampingScale: isWalking ? 0.08 : 1,
    horizontalScaleByBone: isWalking ? WALK_HORIZONTAL_SCALE_BY_BONE : IDLE_HORIZONTAL_SCALE_BY_BONE,
    horizontalDampingScaleByBone: isWalking ? WALK_HORIZONTAL_DAMPING_SCALE_BY_BONE : IDLE_HORIZONTAL_DAMPING_SCALE_BY_BONE,
    muscleSpeed: 1.2,                     // calm adjustments, faster reach
    omega: 6 * stiffnessOmega,            // higher freq — actually tracks targets
    dampingRatio: 1.2 * dampingScale,     // OVER-damped — kills oscillation
    forcePerKg: 18 * 9.8 * activity * neuroAuthority,  // fails during seizure/paralysis
    strength: (entry.strength ?? 1.0) * strengthScale,
    adrenaline: entry.adrenaline ?? 0,
    maxForce: 1200 * activity * neuroAuthority,
    forceRiseRate: 1200,                  // moderate force changes
    gravityTone: 0.9 * neuroAuthority,    // even postural tone fails
    toneYThreshold: 0.35,
  })

  // ─── PELVIS Y STABILIZER (core posture spring) ──────────────────────
  // Real standing controllers (Atlas, Isaac Humanoid, even Half-Life 2's
  // ragdoll-getup) include a strong vertical hip-height regulator on top
  // of the per-bone pose tracking. Without it, gravity slowly drags the
  // pelvis down, the legs buckle, and the body collapses to a crouch.
  //
  // We apply a critically-damped spring on pelvis Y only — no horizontal
  // component (so the pelvis is free to move with steps) — pulling toward
  // the stand-pose pelvis height (1.80m * scale). Strong enough to defeat
  // gravity but only Y, so it doesn't fight horizontal walking forces.
  if (pelvis && entry.measurements) {
    const targetY = (pose.bones.pelvis?.[1] ?? 1.80) *
                    (entry.measurements.height / (pose.referenceHeight || 1.85))
    const errY = targetY - pelvis.y
    // Asymmetric stiffness: strong UP (resist falling), gentle DOWN
    // (don't fight a deliberate jump / step / squat). Damping is the
    // same direction-agnostic spring damping.
    const KP_UP   = 200 * activity * neuroAuthority * stiffnessScale
    const KP_DOWN = 60  * activity * neuroAuthority * stiffnessScale
    const KD_Y    = 28  * activity * neuroAuthority * dampingScale
    const KP = errY > 0 ? KP_UP : KP_DOWN
    let acc = errY * KP - pelvis.vy * KD_Y
    // Cap acceleration to ±30 m/s² (~3g). Above that the integrator
    // explodes and the cap is itself a fall-back — the per-bone motor
    // and gravity pick up the slack.
    const ACC_MAX = 30
    if (acc >  ACC_MAX) acc =  ACC_MAX
    if (acc < -ACC_MAX) acc = -ACC_MAX
    pelvis.vy += acc * dt
  }

}

export function _bonesByName(ragdoll) {
  if (ragdoll._bonesByName) return ragdoll._bonesByName
  const map = Object.create(null)
  for (const bone of ragdoll.bones) {
    if (bone?.name) map[bone.name] = bone
  }
  ragdoll._bonesByName = map
  return map
}

export function applyGetupController(ragdoll, entry, dt) {
  // ─── VERTICALITY-BASED CONTROL (PVS / 1D blend space) ──────────────────
  //
  // Instead of driving poses by phase-time, we drive the body by TARGET
  // verticality. Every frame:
  //   1. Measure current body verticality (pelvis height → 0..100)
  //   2. Ramp desired verticality toward 50 (= standing) at a muscle-paced
  //      speed. Body can be anywhere on the scale — we blend between
  //      adjacent poses automatically.
  //   3. Compute world-space pose targets at that verticality.
  //
  // Benefits over phase-time sequencing:
  //   • Self-correcting: if body gets knocked back to verticality=20, the
  //     ramp naturally goes back through quadruped→kneel→stand.
  //   • Smooth blends: no discrete pose transitions, just a continuous dial.
  //   • Simpler: one variable instead of phase/localT/boneBias tables.
  //   • Matches clinical PVS model (how physiotherapists score recovery).

  const pelvisP = ragdoll.bones[0]?.particle
  if (!pelvisP) return

  // Current body verticality (live physics measurement).
  const currentV = measureBodyVerticality(ragdoll)

  // Desired verticality ramps toward 50 at ~15 units/sec (stand from floor
  // in ~3.3s — matches real human getup time from supine).
  const RISE_RATE = 15
  const desiredV = Math.min(50, (entry.targetVerticality ?? currentV) + RISE_RATE * dt)
  entry.targetVerticality = desiredV

  // World-space pose targets at the desired verticality. The pose library
  // blends between the two adjacent ladder poses internally.
  const yaw = entry.getupYaw ?? entry.navState?.facing ?? 0
  const anchor = entry.getupAnchor
  const targets = getPoseAtVerticality(desiredV, entry.measurements, anchor, yaw)
  entry.rotationTargets = extractRotationTargets(getPoseTargetsAtVerticality(desiredV, entry.measurements, anchor, yaw))
  entry.neuralRotationResiduals = computeNeuralRotationResidualHints(entry.rotationTargets, entry.poseState)
  applyBalanceCorrectionToTargets(targets, entry.balanceState, 0.4)
  applyRhythmPoseModulation(targets, entry.rhythms, 0.35, estimateAverageFatigue(entry))

  // ─── ARM-DOMINANT GETUP BIAS ──────────────────────────────────────────
  // Real humans stand up supine/prone by FIRST pushing with their arms
  // to lever the torso, THEN tucking legs under. Isaac Gym's humanoid
  // GetUp task and DeepMimic's recovery-from-floor clips both reproduce
  // this arm-first pattern. Without it the controller tries to stand by
  // straightening the legs from a floor position — impossible because
  // the feet aren't under the COM yet, so the body flails.
  //
  // During low verticality (< 30 = below kneeling), we override the hand
  // targets to press DOWN into the ground flanking the pelvis. This
  // gives the PD motor something to push against (friction with the
  // floor) so the chest can lift. Above 30, the regular pose ladder
  // takes over and arms return to their normal swing positions.
  if (desiredV < 30 && targets.leftHand && targets.rightHand) {
    const pelvis = ragdoll.bones[0]?.particle
    if (pelvis) {
      // Hands at ~pelvis level, flanking the body at shoulder-width,
      // pushed slightly forward of the torso so they catch the floor.
      // cos/sin(yaw) rotate the "sideways" axis into world space.
      const sideX = Math.cos(yaw)
      const sideZ = -Math.sin(yaw)
      const fwdX  = Math.sin(yaw)
      const fwdZ  = Math.cos(yaw)
      const sw    = entry.measurements.shoulderWidth * 0.55   // slightly wider than shoulders
      const HAND_Y = 0.15                                     // just above ground
      const HAND_FWD = 0.20                                   // forward of pelvis
      const blend = (30 - desiredV) / 30                      // 0 at v=30, 1 at v=0
      // leftHand = pelvis + (-sw * side) + (+HAND_FWD * fwd), y ≈ HAND_Y
      const lhx = pelvis.x - sw * sideX + HAND_FWD * fwdX
      const lhz = pelvis.z - sw * sideZ + HAND_FWD * fwdZ
      const rhx = pelvis.x + sw * sideX + HAND_FWD * fwdX
      const rhz = pelvis.z + sw * sideZ + HAND_FWD * fwdZ
      targets.leftHand[0]  = lerp(targets.leftHand[0],  lhx, blend)
      targets.leftHand[1]  = lerp(targets.leftHand[1],  HAND_Y, blend)
      targets.leftHand[2]  = lerp(targets.leftHand[2],  lhz, blend)
      targets.rightHand[0] = lerp(targets.rightHand[0], rhx, blend)
      targets.rightHand[1] = lerp(targets.rightHand[1], HAND_Y, blend)
      targets.rightHand[2] = lerp(targets.rightHand[2], rhz, blend)
      // Pull the forearm/elbow targets partway toward the hand so the
      // whole arm chain commits to the push instead of dragging behind.
      if (targets.leftForearm) {
        const sx = targets.leftShoulder?.[0] ?? lhx
        const sz = targets.leftShoulder?.[2] ?? lhz
        targets.leftForearm[0] = lerp(targets.leftForearm[0], (targets.leftHand[0] + sx) * 0.5, blend * 0.7)
        targets.leftForearm[1] = lerp(targets.leftForearm[1], HAND_Y + 0.15, blend * 0.7)
        targets.leftForearm[2] = lerp(targets.leftForearm[2], (targets.leftHand[2] + sz) * 0.5, blend * 0.7)
      }
      if (targets.rightForearm) {
        const sx = targets.rightShoulder?.[0] ?? rhx
        const sz = targets.rightShoulder?.[2] ?? rhz
        targets.rightForearm[0] = lerp(targets.rightForearm[0], (targets.rightHand[0] + sx) * 0.5, blend * 0.7)
        targets.rightForearm[1] = lerp(targets.rightForearm[1], HAND_Y + 0.15, blend * 0.7)
        targets.rightForearm[2] = lerp(targets.rightForearm[2], (targets.rightHand[2] + sz) * 0.5, blend * 0.7)
      }
    }
  }

  // ─── NEURAL BRAIN ─────────────────────────────────────────────────────
  // Build observation, train on the kinematic teacher signal, then forward
  // through the NN and add its offsets to the pose targets. On first use,
  // create the brain at the entity's tier and try to load a saved copy.
  if (!entry.neuralMotor) {
    const tier = entry.brainTier || 'tiny'
    // Seed the brain with the entity id → deterministic init.
    // Same id → same starting brain across reloads. Different ids →
    // different "personalities" (different random weights).
    entry.neuralMotor = createNeuralMotor(tier, entry.entityId)
    entry._brainLoadAttempted = false
    // Initialize body rhythms using the SAME RNG as the brain so a given
    // entity has a deterministic internal pulse (heart rate, gait, etc).
    // Different entities get different starting phases → a crowd looks
    // like individuals, not robots marching in sync.
    entry.rhythms = createRhythmState(entry.neuralMotor.rng)
  }
  ensureBrainLoaded(entry)
  // Periodic auto-save (every 30s of training)
  entry._brainSaveTimer = (entry._brainSaveTimer || 0) + dt
  if (entry._brainSaveTimer > 30) {
    entry._brainSaveTimer = 0
    const profileKey = entry.motorProfileKey || entry.entityId
    saveBrain(profileKey, entry.neuralMotor).catch(err => {
      console.warn(`[BRAIN] autosave failed for ${entry.entityId} → ${profileKey}:`, err.message)
    })
  }
  const bonesByName = _bonesByName(ragdoll)

  // Rhythms are stepped globally in update() — not here.
  // (Still read fatigue for any downstream consumers.)
  const pelvisParticle = bonesByName.pelvis?.particle
  const lThighParticle = bonesByName.leftThigh?.particle
  const rThighParticle = bonesByName.rightThigh?.particle
  const avgFatigue = (
    (pelvisParticle?._fatigue ?? 0) +
    (lThighParticle?._fatigue ?? 0) +
    (rThighParticle?._fatigue ?? 0)
  ) / 3

  // State intent — what is this body trying to do? Defaults to 'stand' but
  // gameplay code can set entry.intent = { type, targetDirX, targetDirZ,
  // targetVerticality } for walk/duck/act states. NN reads this as input.
  const intent = entry.intent || { type: 'stand', targetVerticality: 50 }
  const obs = buildObservation(ragdoll, bonesByName, currentV, desiredV, intent, entry.rhythms, entry._frameSensors)

  // ─── REINFORCEMENT LEARNING LOOP ───────────────────────────────────
  // 1. Compute reward from current body state (pose match + upright +
  //    stable + goal progress).
  // 2. Teacher = kinematic "what would move body toward pose" — reference
  //    action the NN should learn to reproduce in HIGH-REWARD states.
  // 3. AWR training: gradient weighted by advantage = reward - baseline.
  //    NN imitates kinematic MORE in above-average states, LESS in below.
  // 4. NN output replaces kinematic with gradually increasing authority.
  const reward = computeReward(ragdoll, bonesByName, targets, intent)
  const teacher = computeTeacherSignal(targets, ragdoll, bonesByName)

  // STABILITY GATE — only train when body is coherent enough for the
  // teacher signal to make sense. Thrashing/spinning bodies produce noise
  // targets that destroy the NN. Require:
  //   - low core velocity (< 8 m/s combined pelvis + chest + head)
  //   - head above pelvis (belly-down but not face-plant) OR body actively
  //     rising (verticality gap shrinking)
  const pel = bonesByName.pelvis?.particle
  const che = bonesByName.chest?.particle
  const hed = bonesByName.head?.particle
  let coreV = 0
  for (const p of [pel, che, hed]) {
    if (p) coreV += Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz)
  }
  const stable = coreV < 24 && pel && hed && hed.y > pel.y - 0.3
  entry._lastAniMotionPrior = mixAniMotionTeacher(teacher, entry._aniMotionPrior, entry, ragdoll, bonesByName, intent, { stable, rate: 0.10 })
  trainNeuralMotor(entry.neuralMotor, obs, teacher, reward, { stable })

  // Forward pass — NN outputs Δxyz offsets per bone. Neuromodifiers
  // (if any) corrupt the activations and produce neurological effects.
  const now = entry.stateTimer
  const neuralOffsets = neuralMotorForward(entry.neuralMotor, obs, now, { explorationScale: 0.35 })

  // NN AUTHORITY ramps from 0 → 100% as training loss drops.
  // Formula: trust = clamp(1 - loss·K, 0, 1).  With loss ~0.02 well-trained,
  // K=30 gives trust ~0.4 at start and ~1.0 when loss < 0.005.
  // High-capacity brains (large/huge) can take full control; tiny brains
  // are capped at 70% because they have less expressive capacity.
  const nm = entry.neuralMotor
  const trust = estimateNeuralMotorTrust(nm)
  const nnWeight = stable ? trust.trust : trust.trust * 0.15
  entry._lastBrainTrust = { ...trust, trust: nnWeight }
  entry.neuralRotationResiduals = computeNeuralRotationResidualHints(entry.rotationTargets, entry.poseState, neuralOffsets, nnWeight)
  if (nnWeight > 0) {
    for (let i = 0; i < neuralOffsets.length; i++) neuralOffsets[i] *= nnWeight
    applyNeuralOffsets(neuralOffsets, targets)
  }
  clampLimbSideTargets(entry, ragdoll, targets, yaw)
  if (desiredV > 35) alignFootToeTargets(entry, targets, yaw)
  applyContactReflexTargets(entry, ragdoll, targets, {
    dt,
    yaw,
    desiredVerticality: desiredV,
  })

  // Effort ramps with how far we still need to go. Kinematic blend is now
  // a SOFT guide — the PD force layer (mass-scaled) does the real work.
  // Low blendRate = body is allowed to lag behind target slightly, which
  // kills the "being puppeted" feel.
  const gap = Math.max(0, 50 - currentV) / 50    // 0..1
  const blendRate = 0.005 + gap * 0.02           // 0.005..0.025 — very soft
  // ω controls muscle response frequency. Real humans ~6-10 rad/s; getting
  // up from floor we want slightly sluggish (struggling muscles).
  const omega = 6 + gap * 3                      // 6..9 rad/s
  const poseState = entry.poseState || makePoseStateMeta('getup')
  const strengthScale = poseState.strengthScale ?? 1
  const dampingScale = poseState.dampingScale ?? 1
  const stiffnessScale = poseState.stiffnessScale ?? 1
  const stiffnessOmega = Math.sqrt(Math.max(0.25, stiffnessScale))

  // Kinematic ALWAYS runs at full force. NN only ADDS small per-bone
  // offsets (±8cm max) on top of the kinematic pose targets. This is the
  // correct architecture — NN is a *learned refinement*, not a replacement.
  //
  // Rationale: NN outputs are position offsets, not forces. Even with 100%
  // "trust" the NN can only nudge target positions a few cm. Lifting the
  // body against gravity requires hundreds of newtons of sustained force,
  // which comes from the PD motor tracking the (NN-refined) targets.
  //
  // In DeepMimic / DReCon this is called the "residual policy" approach:
  //   target_final = target_kinematic + residual_from_NN
  //   force = PD(target_final, current_pos)
  // ─── KINEMATIC FADE-OUT (teacher wean-off) ─────────────────────────
  // As the NN learns (loss drops), the kinematic motor's force authority
  // fades — eventually the body stands on NN output alone. Real motor
  // development: scaffolding (training wheels) → independent execution.
  //
  // We fade between 100% kinematic (newborn) and 40% kinematic (expert).
  // Never below 40% because:
  //   - NN output is still small ±8cm offsets, not a full motor replacement
  //   - Floor for safety: body always has enough baseline force to not
  //     collapse catastrophically during exploration
  //
  // NN competence uses the same trust gate as residual authority.
  // Warm or unstable brains keep full kinematic support.
  const nnCompetence = nnWeight
  const kinematicScale = 1.0 - (nnCompetence * 0.6)    // 1.0..0.4

  // Strength grows with sustained success. Update each frame based on
  // how well the body is doing (reward EMA). Grows slowly — takes minutes
  // of play to go from 0.5 → 1.0 (like real muscle training).
  entry.strengthEMA = entry.strengthEMA * 0.999 + reward * 0.001
  // Target strength based on reward level: 0.5 base + up to +0.7 for
  // high reward = max 1.2 (above-average human).
  const targetStrength = 0.5 + Math.max(0, Math.min(0.7, (entry.strengthEMA - 1.5) * 0.3))
  entry.strength = entry.strength * 0.9999 + targetStrength * 0.0001

  // Decay adrenaline — wears off over its duration (default 10s)
  if (entry.adrenalineTimer > 0) {
    entry.adrenalineTimer -= dt
    if (entry.adrenalineTimer <= 0) {
      entry.adrenaline = 0
      entry.adrenalineTimer = 0
    } else {
      // Linear fade across the full duration
      const fadeFraction = entry.adrenalineTimer / 10
      entry.adrenaline = (entry.adrenaline ?? 0) * Math.max(0, Math.min(1, fadeFraction))
    }
  }

  applyKinematicBlend(ragdoll, targets, blendRate * kinematicScale * stiffnessScale, {
    dt,
    muscleSpeed: 1.8,
    omega: omega * stiffnessOmega,
    dampingRatio: 0.7 * dampingScale,
    // Scaled by strength AND kinematic fade. An untrained body starts at
    // 50% of the already-reduced 15g strength = 7.5g effective. Strong-
    // trained body: 1.2 × 15g = 18g. Both scale further by kinematicScale
    // as NN takes over, so the body is forced to use its own policy.
    forcePerKg: 15 * 9.8 * kinematicScale,
    strength: entry.strength * strengthScale,
    adrenaline: entry.adrenaline ?? 0,
    maxForce: 1500 * kinematicScale,
    forceRiseRate: 1200,
    gravityTone: 0.75,
    toneYThreshold: 0.35,
  })

  // Periodic log — player only by default. Set entry.logRL = true on any
  // body to get per-body logs. Throttled to 1Hz.
  const shouldLog = entry.entityId === 'player' || entry.logRL
  if (shouldLog && (!entry._lastVLog || (entry.stateTimer - entry._lastVLog) > 1.0)) {
    entry._lastVLog = entry.stateTimer
    const nnLoss = nm.lossEMA.toFixed(4)
    const nnSteps = nm.framesTrained
    const nnSkipped = nm.framesSkipped ?? 0
    const trust = (nnWeight * 100).toFixed(0)
    const adv = (reward - (nm.rewardBaseline ?? 0)).toFixed(2)
    const gateIcon = stable ? '✓' : '✗'
    const kinPct = (kinematicScale * 100).toFixed(0)
    const strPct = (entry.strength * 100).toFixed(0)
    // Sample fatigue from core bones (pelvis + thighs avg)
    const fatPelvis = ragdoll.bones[0]?.particle?._fatigue ?? 0
    const fatLThigh = ragdoll.bones[14]?.particle?._fatigue ?? 0
    const fatRThigh = ragdoll.bones[17]?.particle?._fatigue ?? 0
    const avgFat = ((fatPelvis + fatLThigh + fatRThigh) / 3 * 100).toFixed(0)
    const heartBPM = (entry.rhythms?.heartBPM ?? 0).toFixed(0)
    const coherence = (entry.rhythms?.coherence ?? 0).toFixed(2)
    const damage = (nm.brainDamage ?? 0).toFixed(3)
    const intel = (entry.intelligence ?? 0).toFixed(0)
    const mageMark = entry.magical ? '✨' : ''
    console.info(
      `[RL] ${entry.entityId} intent=${intent.type} v=${currentV.toFixed(0)}/${desiredV.toFixed(0)} ${gateIcon}` +
      ` | r=${reward.toFixed(2)} adv=${adv>=0?'+':''}${adv}` +
      ` | NN ${nm.tier}${mageMark} loss=${nnLoss} trust=${trust}% steps=${nnSteps}/${nnSkipped}skip` +
      ` | IQ=${intel} str=${strPct}% kin=${kinPct}% fat=${avgFat}% dmg=${damage} ♥${heartBPM}bpm sync=${coherence}`
    )
  }
}

export function getBoneRadius(boneId, m) {
  switch (boneId) {
    case RagdollBone.PELVIS: return 0.20
    case RagdollBone.CHEST: return 0.22
    case RagdollBone.HEAD: return m.headRadius * 1.1
    case RagdollBone.LEFT_UPPER_ARM: case RagdollBone.RIGHT_UPPER_ARM: return 0.07
    case RagdollBone.LEFT_FOREARM: case RagdollBone.RIGHT_FOREARM: return 0.06
    case RagdollBone.LEFT_THIGH: case RagdollBone.RIGHT_THIGH: return 0.11
    case RagdollBone.LEFT_SHIN: case RagdollBone.RIGHT_SHIN: return 0.08
    default: return 0.06
  }
}

export function stateToString(state) {
  return state || 'unknown'
}
