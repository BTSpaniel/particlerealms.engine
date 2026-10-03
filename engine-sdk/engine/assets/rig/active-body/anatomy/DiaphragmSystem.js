// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createDiaphragmState(anatomy = null) {
  const thorax = anatomy?.thorax || {}
  const diaphragm = thorax.diaphragm || {}
  const ribCage = thorax.ribCage || {}
  const sternum = thorax.sternum || {}
  return {
    present: !!diaphragm.id,
    id: diaphragm.id || 'diaphragm',
    attachmentBones: Array.isArray(diaphragm.attachmentBones) ? [...diaphragm.attachmentBones] : [],
    ribAttachmentBones: Array.isArray(ribCage.attachmentBones) ? [...ribCage.attachmentBones] : [],
    sternumAttachmentBones: Array.isArray(sternum.attachmentBones) ? [...sternum.attachmentBones] : [],
    phase: 0,
    contraction: 0,
    ribExpansion: 0,
    sternumLift: 0,
    abdominalPressure: 0,
    respirationRate: 0,
  }
}

export function stepDiaphragm(state, rhythms = null, dt = 0) {
  if (!state) return null
  const breathPhase = rhythms?.phases?.[1] ?? state.phase
  const breathRate = rhythms?.breathRate ?? state.respirationRate ?? 0
  const contraction = (Math.sin(breathPhase) + 1) * 0.5
  state.phase = breathPhase
  state.contraction = contraction
  state.ribExpansion = contraction * 0.035
  state.sternumLift = contraction * 0.018
  state.abdominalPressure = contraction * 0.12
  state.respirationRate = breathRate
  state.lastStepDt = dt
  return state
}

export function getDiaphragmReadback(state) {
  if (!state) return null
  return {
    present: state.present,
    id: state.id,
    attachmentBones: [...state.attachmentBones],
    ribAttachmentBones: [...state.ribAttachmentBones],
    sternumAttachmentBones: [...state.sternumAttachmentBones],
    phase: state.phase,
    contraction: state.contraction,
    ribExpansion: state.ribExpansion,
    sternumLift: state.sternumLift,
    abdominalPressure: state.abdominalPressure,
    respirationRate: state.respirationRate,
  }
}
