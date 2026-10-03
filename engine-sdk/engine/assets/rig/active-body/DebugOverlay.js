// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/DebugOverlay.js — extracted from ActiveBodySystem.js
// (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns pure display/readback
// helpers: overlay toggle resolution and the make*Overlay builders consumed
// by ActiveBodySystem.getDebugOverlay()/getReadback(). Deliberately excludes
// buildMotorAuthorityMap — despite being overlay-adjacent, it's also
// consumed by live simulation (applyFootReflexTarget/applyBraceProtection
// Targets), so it stays with the reflex/motor-authority code, not here.

import {
  BONE_NAMES,
  clamp01,
  organStatusColor,
  round4,
  supportCenter,
} from './ActiveBodySystem.js'
import { getOrganReadback } from './anatomy/OrganSystem.js'

export const DEFAULT_ACTIVE_BODY_OVERLAY_TOGGLES = Object.freeze({
  contacts: true,
  nerves: true,
  blood: true,
  motorAuthority: true,
  fatigue: true,
  organStatus: true,
})

export function makeOverlayToggleMap(source = null, fallback = DEFAULT_ACTIVE_BODY_OVERLAY_TOGGLES) {
  const base = { ...DEFAULT_ACTIVE_BODY_OVERLAY_TOGGLES, ...(fallback || {}) }
  const input = source || {}
  return {
    contacts: resolveOverlayToggle(input.contacts, base.contacts),
    nerves: resolveOverlayToggle(input.nerves, base.nerves),
    blood: resolveOverlayToggle(input.blood ?? input.circulation ?? input.circulationFlow, base.blood),
    motorAuthority: resolveOverlayToggle(input.motorAuthority, base.motorAuthority),
    fatigue: resolveOverlayToggle(input.fatigue, base.fatigue),
    organStatus: resolveOverlayToggle(input.organStatus ?? input.organs, base.organStatus),
  }
}

export function resolveOverlayToggle(value, fallback) {
  if (value == null) return !!fallback
  return value !== false
}

export function makeComOverlay(balance) {
  if (!balance) return null
  return {
    point: [...balance.centerOfMass],
    supportCenter: [...balance.supportCenter],
    correction: [...balance.correction],
    balanceError: balance.balanceError,
    state: balance.state,
  }
}

export function makeSupportOverlay(entry) {
  const balance = entry?.balanceState
  if (!balance) return null
  const points = []
  for (const foot of getSupportFootBoneIds(entry)) {
    const bone = entry.ragdoll?.boneMap?.get(foot) || entry.ragdoll?.bones?.[BONE_NAMES.indexOf(foot)]
    const p = bone?.particle
    if (p) points.push({ id: foot, point: [p.x, p.y, p.z], grounded: !!balance.footContacts?.[foot] })
  }
  return {
    center: [...balance.supportCenter],
    groundedFeet: balance.groundedFeet,
    footContacts: { ...balance.footContacts },
    polygon: points,
  }
}

export function getSupportFootBoneIds(entry) {
  const authored = (entry?.universalLegDescriptors || [])
    .map(descriptor => descriptor?.footBone)
    .filter(Boolean)
  return authored.length > 0 ? authored : ['leftFoot', 'rightFoot']
}

export function makeFatigueOverlay(entry) {
  const bones = entry?.ragdoll?.bones || []
  const out = []
  let sum = 0
  let max = 0
  for (let i = 0; i < bones.length; i++) {
    const fatigue = clamp01(bones[i]?.particle?._fatigue ?? 0)
    sum += fatigue
    max = Math.max(max, fatigue)
    out.push({
      id: bones[i]?.name || BONE_NAMES[i] || `bone${i}`,
      fatigue: round4(fatigue),
      forceBudgetScale: round4(1 - fatigue * 0.4),
    })
  }
  const average = bones.length > 0 ? sum / bones.length : 0
  return {
    version: 1,
    bones: out,
    summary: {
      average: round4(average),
      max: round4(max),
      status: max > 0.75 ? 'exhausted' : average > 0.35 ? 'fatigued' : 'fresh',
    },
  }
}

export function makeOrganStatusOverlay(entry) {
  const organs = getOrganReadback(entry?.organs)
  if (!organs) return null
  const out = []
  let vitalWarningCount = 0
  let impairedCount = 0
  for (const organ of Object.values(organs)) {
    const integrity = clamp01(organ.integrity ?? 1)
    const perfusion = clamp01(organ.perfusion ?? 1)
    const oxygenation = organ.oxygenation == null ? null : clamp01(organ.oxygenation)
    const functionScale = clamp01(organ.function ?? 1)
    const status = organ.status || 'normal'
    if (status !== 'normal') impairedCount++
    if (organ.vital && status !== 'normal') vitalWarningCount++
    out.push({
      id: organ.id,
      container: organ.container,
      vital: !!organ.vital,
      integrity: round4(integrity),
      perfusion: round4(perfusion),
      oxygenation: oxygenation == null ? null : round4(oxygenation),
      function: round4(functionScale),
      status,
      color: organStatusColor(organ),
    })
  }
  return {
    version: 1,
    organs: out,
    summary: {
      count: out.length,
      impairedCount,
      vitalWarningCount,
      status: vitalWarningCount > 0 ? 'vitalWarning' : impairedCount > 0 ? 'impaired' : 'normal',
    },
  }
}

export function makePoseTargetOverlay(entry) {
  return {
    poseState: entry.poseState ? { ...entry.poseState } : null,
    rotationTargets: copyRotationTargetSummary(entry.rotationTargets),
    neuralRotationResiduals: copyRotationResidualSummary(entry.neuralRotationResiduals),
  }
}

export function makeJointErrorOverlay(entry) {
  const residuals = entry?.neuralRotationResiduals
  if (!residuals) return null
  const out = Object.create(null)
  for (const [boneId, residual] of Object.entries(residuals)) {
    const axisAngle = residual.residualAxisAngle || [0, 0, 0]
    out[boneId] = {
      residualMagnitude: Math.hypot(axisAngle[0] || 0, axisAngle[1] || 0, axisAngle[2] || 0),
      gain: residual.gain ?? 0,
    }
  }
  return out
}

export function copyRotationTargetSummary(rotationTargets) {
  if (!rotationTargets) return null
  const out = Object.create(null)
  for (const [boneId, rotation] of Object.entries(rotationTargets)) out[boneId] = [...rotation]
  return out
}

export function copyRotationResidualSummary(residuals) {
  if (!residuals) return null
  const out = Object.create(null)
  for (const [boneId, residual] of Object.entries(residuals)) {
    out[boneId] = {
      targetRotation: [...residual.targetRotation],
      residualAxisAngle: [...residual.residualAxisAngle],
      gain: residual.gain,
    }
  }
  return out
}

export function copyReflexState(reflexState) {
  if (!reflexState) return null
  return {
    ...reflexState,
    gates: { ...(reflexState.gates || {}) },
    signals: { ...(reflexState.signals || {}) },
    adjustments: { ...(reflexState.adjustments || {}) },
  }
}

export function copyMotorAuthorityMap(map) {
  if (!map) return null
  return {
    ...map,
    functions: { ...(map.functions || {}) },
  }
}
