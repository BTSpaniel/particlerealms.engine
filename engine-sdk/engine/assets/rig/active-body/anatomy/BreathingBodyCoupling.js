// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function getBreathingBodyCouplingReadback(diaphragm = null, rhythms = null) {
  if (!diaphragm) return null
  const contraction = clamp01(diaphragm.contraction ?? 0)
  const ribExpansion = diaphragm.ribExpansion ?? contraction * 0.035
  const sternumLift = diaphragm.sternumLift ?? contraction * 0.018
  const abdominalPressure = diaphragm.abdominalPressure ?? contraction * 0.12
  const breathRate = diaphragm.respirationRate ?? rhythms?.breathRate ?? 0
  return {
    phase: diaphragm.phase ?? rhythms?.phases?.[1] ?? 0,
    contraction,
    respirationRate: breathRate,
    attachments: {
      diaphragm: Array.isArray(diaphragm.attachmentBones) ? [...diaphragm.attachmentBones] : [],
      ribs: Array.isArray(diaphragm.ribAttachmentBones) ? [...diaphragm.ribAttachmentBones] : [],
      sternum: Array.isArray(diaphragm.sternumAttachmentBones) ? [...diaphragm.sternumAttachmentBones] : [],
    },
    ribCage: {
      expansion: round4(ribExpansion),
      lateralOffset: round4(ribExpansion * 0.5),
    },
    sternum: {
      lift: round4(sternumLift),
      forwardOffset: round4(sternumLift * 0.35),
    },
    shoulders: {
      lift: round4(sternumLift * 0.18),
      rollOut: round4(ribExpansion * 0.16),
    },
    abdomen: {
      pressure: round4(abdominalPressure),
      expansion: round4(abdominalPressure * 0.08),
    },
    poseOffsets: {
      chest: [0, round4(sternumLift), round4(ribExpansion * 0.12)],
      spine1: [0, round4(sternumLift * 0.45), 0],
      neck: [0, round4(sternumLift * 0.25), 0],
      head: [0, round4(sternumLift * 0.18), 0],
      leftShoulder: [round4(-ribExpansion * 0.08), round4(sternumLift * 0.18), 0],
      rightShoulder: [round4(ribExpansion * 0.08), round4(sternumLift * 0.18), 0],
      abdomen: [0, round4(-abdominalPressure * 0.015), round4(abdominalPressure * 0.08)],
    },
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
}

function round4(v) {
  return Math.round(v * 10000) / 10000
}
