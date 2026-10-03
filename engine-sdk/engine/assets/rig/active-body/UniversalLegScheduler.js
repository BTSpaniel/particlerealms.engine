// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/UniversalLegScheduler.js — extracted from
// ActiveBodySystem.js (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns
// N-legged support-polygon analysis and gait-preset recommendation for the
// generic/readback-only "universal leg scheduler" — the leg discovery,
// phase, and support-polygon math shared conceptually with the animal gait
// system, but exposed here purely as debug/readback (ActiveBodySystem's
// getReadback() is the only call site; it does not drive live pose targets).

import {
  clamp01,
  normalizePhase01,
  normalizeRadians,
  round4,
  supportCenter,
} from './ActiveBodySystem.js'
import { RHYTHM } from './BodyRhythms.js'

export const UNIVERSAL_GAIT_PRESETS = Object.freeze({
  1: Object.freeze([
    Object.freeze({ id: 'monopodHop', name: 'dynamic hop', legCount: 1, support: 'point', phaseOffsets: [0], dutyFactor: 0.58 }),
  ]),
  2: Object.freeze([
    Object.freeze({ id: 'bipedWalk', name: 'biped walk', legCount: 2, support: 'alternating-line', phaseOffsets: [0, 0.5], dutyFactor: 0.62 }),
    Object.freeze({ id: 'bipedJog', name: 'biped jog', legCount: 2, support: 'alternating-point', phaseOffsets: [0, 0.5], dutyFactor: 0.48 }),
    Object.freeze({ id: 'bipedRun', name: 'biped run', legCount: 2, support: 'flight-cycle', phaseOffsets: [0, 0.5], dutyFactor: 0.38 }),
  ]),
  4: Object.freeze([
    Object.freeze({ id: 'quadrupedWalk', name: 'quadruped walk', legCount: 4, support: 'polygon', phaseOffsets: [0, 0.25, 0.5, 0.75], dutyFactor: 0.72 }),
    Object.freeze({ id: 'quadrupedTrot', name: 'quadruped trot', legCount: 4, support: 'diagonal-pairs', phaseOffsets: [0, 0.5, 0.5, 0], dutyFactor: 0.55 }),
    Object.freeze({ id: 'quadrupedPace', name: 'quadruped pace', legCount: 4, support: 'lateral-pairs', phaseOffsets: [0, 0, 0.5, 0.5], dutyFactor: 0.55 }),
    Object.freeze({ id: 'quadrupedBound', name: 'quadruped bound', legCount: 4, support: 'fore-hind-pairs', phaseOffsets: [0, 0.5, 0, 0.5], dutyFactor: 0.45 }),
    Object.freeze({ id: 'quadrupedGallop', name: 'quadruped gallop', legCount: 4, support: 'rolling-flight-cycle', phaseOffsets: [0, 0.15, 0.55, 0.72], dutyFactor: 0.42 }),
  ]),
  6: Object.freeze([
    Object.freeze({ id: 'hexapodWave', name: 'hexapod wave', legCount: 6, support: 'rolling-polygon', phaseOffsets: [0, 0.1667, 0.3333, 0.5, 0.6667, 0.8333], dutyFactor: 0.78 }),
    Object.freeze({ id: 'hexapodTetrapod', name: 'hexapod tetrapod', legCount: 6, support: 'four-leg-polygon', phaseOffsets: [0, 0.5, 0, 0.5, 0, 0.5], dutyFactor: 0.68 }),
    Object.freeze({ id: 'hexapodTripod', name: 'hexapod tripod', legCount: 6, support: 'alternating-tripods', phaseOffsets: [0, 0.5, 0.5, 0, 0.5, 0], dutyFactor: 0.52 }),
  ]),
  8: Object.freeze([
    Object.freeze({ id: 'octopodWave', name: 'octopod wave', legCount: 8, support: 'rolling-polygon', phaseOffsets: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875], dutyFactor: 0.82 }),
    Object.freeze({ id: 'octopodAlternatingTetrapod', name: 'octopod alternating tetrapod', legCount: 8, support: 'alternating-tetrapods', phaseOffsets: [0, 0.5, 0, 0.5, 0.5, 0, 0.5, 0], dutyFactor: 0.58 }),
  ]),
})

export function makeUniversalLegSchedulerReadback(entry, contactTelemetry) {
  const legs = discoverUniversalLegs(entry).map(leg => makeUniversalLegReadback(entry, leg, contactTelemetry))
  return {
    version: 1,
    mode: 'readbackOnly',
    legCount: legs.length,
    legs,
    support: makeUniversalSupportAnalysis(entry, legs),
    gaitPresets: {
      recommended: recommendUniversalGaitPreset(entry, legs.length),
      availableForLegCount: copyUniversalGaitPresets(legs.length),
      byLegCount: copyUniversalGaitPresetMap(),
    },
  }
}

export function discoverUniversalLegs(entry) {
  const authored = normalizeUniversalLegDescriptors(entry?.universalLegDescriptors, entry, false)
  if (authored.length > 0) return authored
  const candidates = [
    { id: 'leftLeg', name: 'left leg', side: 'left', order: 0, rootBone: 'leftThigh', midBone: 'leftShin', footBone: 'leftFoot', rhythmIndex: RHYTHM.GAIT_L, fallbackPhaseOffset: 0 },
    { id: 'rightLeg', name: 'right leg', side: 'right', order: 1, rootBone: 'rightThigh', midBone: 'rightShin', footBone: 'rightFoot', rhythmIndex: RHYTHM.GAIT_R, fallbackPhaseOffset: Math.PI },
  ]
  return candidates.filter(leg => hasBone(entry, leg.rootBone) && hasBone(entry, leg.midBone) && hasBone(entry, leg.footBone))
}

export function normalizeUniversalLegDescriptors(descriptors, entry, allowMetadataOnly = true) {
  if (!Array.isArray(descriptors)) return []
  const out = []
  for (let index = 0; index < descriptors.length; index++) {
    const descriptor = descriptors[index]
    if (!descriptor?.id || !descriptor?.rootBone || !descriptor?.midBone || !descriptor?.footBone) continue
    const hasRequiredBones = hasBone(entry, descriptor.rootBone) && hasBone(entry, descriptor.midBone) && hasBone(entry, descriptor.footBone)
    if (!allowMetadataOnly && !hasRequiredBones && !Array.isArray(descriptor.supportPoint)) continue
    out.push({
      id: descriptor.id,
      name: descriptor.name || descriptor.id,
      side: descriptor.side || 'unknown',
      order: Number.isFinite(descriptor.order) ? descriptor.order : index,
      rootBone: descriptor.rootBone,
      midBone: descriptor.midBone,
      footBone: descriptor.footBone,
      rhythmIndex: Number.isFinite(descriptor.rhythmIndex) ? descriptor.rhythmIndex : defaultUniversalLegRhythmIndex(descriptor),
      fallbackPhaseOffset: Number.isFinite(descriptor.fallbackPhaseOffset) ? descriptor.fallbackPhaseOffset : (Number.isFinite(descriptor.phaseOffset) ? descriptor.phaseOffset : index * Math.PI * 2 / descriptors.length),
      supportPoint: Array.isArray(descriptor.supportPoint) ? [...descriptor.supportPoint] : null,
      metadataOnly: !hasRequiredBones,
    })
  }
  return out.sort((a, b) => a.order - b.order)
}

export function defaultUniversalLegRhythmIndex(descriptor) {
  if (descriptor?.id === 'leftLeg' || descriptor?.side === 'left') return RHYTHM.GAIT_L
  if (descriptor?.id === 'rightLeg' || descriptor?.side === 'right') return RHYTHM.GAIT_R
  return undefined
}

export function makeUniversalLegReadback(entry, leg, contactTelemetry) {
  const record = contactTelemetry?.byBone?.[leg.footBone] || null
  const point = record?.point || particlePoint(entry, leg.footBone) || leg.supportPoint
  const phaseRad = getUniversalLegPhase(entry, leg)
  const normalizedPhase = normalizePhase01(phaseRad)
  const swingAmount = clamp01(Math.max(0, Math.sin(phaseRad)))
  const contact = !!record?.contact || (leg.metadataOnly && Array.isArray(leg.supportPoint))
  return {
    id: leg.id,
    name: leg.name,
    side: leg.side,
    order: leg.order,
    rootBone: leg.rootBone,
    midBone: leg.midBone,
    footBone: leg.footBone,
    phase: round4(normalizedPhase),
    phaseRad: round4(phaseRad),
    state: universalLegState(contact, swingAmount),
    contact,
    metadataOnly: !!leg.metadataOnly,
    stanceTrust: round4(record?.stanceTrust ?? 0),
    supportPoint: point ? point.map(round4) : null,
  }
}

export function makeUniversalSupportAnalysis(entry, legs) {
  const points = legs.filter(leg => leg.contact && Array.isArray(leg.supportPoint)).map(leg => ({ id: leg.id, point: leg.supportPoint }))
  const center = supportCenter(points)
  const com = entry?.balanceState?.centerOfMass || particlePoint(entry, 'pelvis') || [0, 0, 0]
  const margin = supportComMargin(com, points)
  const recovery = center ? recoveryDirection(com, center) : [0, 0, 0]
  return {
    mode: supportModeFor(points.length, legs.length),
    supportPointCount: points.length,
    groundedLegCount: points.length,
    supportPoints: points.map(point => ({ id: point.id, point: [...point.point] })),
    supportCenter: center ? center.map(round4) : null,
    centerOfMass: com.map(round4),
    comMargin: round4(margin),
    recoveryDirection: recovery.map(round4),
  }
}

export function universalLegState(contact, swingAmount) {
  if (contact && swingAmount <= 0.15) return 'stance'
  if (contact || (swingAmount > 0.15 && swingAmount <= 0.35)) return 'transfer'
  if (swingAmount > 0.35) return 'swing'
  return 'flight'
}

export function getUniversalLegPhase(entry, leg) {
  const phase = entry?.rhythms?.phases?.[leg.rhythmIndex]
  if (Number.isFinite(phase)) return normalizeRadians(phase)
  const base = Number.isFinite(entry?.navState?.walkPhase) ? entry.navState.walkPhase : 0
  return normalizeRadians(base + leg.fallbackPhaseOffset)
}

export function supportModeFor(pointCount, legCount) {
  if (pointCount >= 3) return 'polygon'
  if (pointCount === 2) return 'line'
  if (pointCount === 1) return legCount === 1 ? 'pointOrDynamicHop' : 'point'
  return legCount === 1 ? 'dynamicHop' : 'none'
}

export function supportComMargin(com, points) {
  if (points.length === 0) return -1
  if (points.length === 1) return 0.08 - distance2D(com, points[0].point)
  if (points.length === 2) return 0.12 - distancePointToSegment2D(com, points[0].point, points[1].point)
  return signedPolygonMargin2D(com, points.map(item => item.point))
}

export function recoveryDirection(com, center) {
  const dx = center[0] - com[0]
  const dz = center[2] - com[2]
  const len = Math.hypot(dx, dz)
  return len > 0.0001 ? [dx / len, 0, dz / len] : [0, 0, 0]
}

export function signedPolygonMargin2D(point, polygon) {
  let minDistance = Infinity
  for (let i = 0; i < polygon.length; i++) {
    minDistance = Math.min(minDistance, distancePointToSegment2D(point, polygon[i], polygon[(i + 1) % polygon.length]))
  }
  return (pointInPolygon2D(point, polygon) ? 1 : -1) * minDistance
}

export function pointInPolygon2D(point, polygon) {
  let inside = false
  const x = point[0]
  const z = point[2]
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]
    const zi = polygon[i][2]
    const xj = polygon[j][0]
    const zj = polygon[j][2]
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / ((zj - zi) || 0.000001) + xi) inside = !inside
  }
  return inside
}

export function distancePointToSegment2D(point, a, b) {
  const ax = a[0]
  const az = a[2]
  const bx = b[0]
  const bz = b[2]
  const px = point[0]
  const pz = point[2]
  const dx = bx - ax
  const dz = bz - az
  const denom = dx * dx + dz * dz
  const t = denom > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / denom)) : 0
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

export function distance2D(a, b) {
  return Math.hypot((a?.[0] || 0) - (b?.[0] || 0), (a?.[2] || 0) - (b?.[2] || 0))
}

export function particlePoint(entry, boneName) {
  const p = entry?.ragdoll?.boneMap?.get(boneName)?.particle
  return p ? [p.x, p.y, p.z] : null
}

export function hasBone(entry, boneName) {
  return !!entry?.ragdoll?.boneMap?.get(boneName)
}

export function recommendUniversalGaitPreset(entry, legCount) {
  const presets = UNIVERSAL_GAIT_PRESETS[legCount] || []
  if (presets.length === 0) return makeGenericOddLegWavePreset(legCount)
  const speed = Math.max(0, entry?.navState?.speed || 0)
  if (legCount === 2) {
    if (speed > 3.2) return { ...presets[2], phaseOffsets: [...presets[2].phaseOffsets] }
    if (speed > 1.8) return { ...presets[1], phaseOffsets: [...presets[1].phaseOffsets] }
  }
  return { ...presets[0], phaseOffsets: [...presets[0].phaseOffsets] }
}

export function copyUniversalGaitPresets(legCount) {
  const presets = UNIVERSAL_GAIT_PRESETS[legCount] || [makeGenericOddLegWavePreset(legCount)].filter(Boolean)
  return presets.map(preset => ({ ...preset, phaseOffsets: [...preset.phaseOffsets] }))
}

export function copyUniversalGaitPresetMap() {
  const out = {}
  for (const [legCount, presets] of Object.entries(UNIVERSAL_GAIT_PRESETS)) {
    out[legCount] = presets.map(preset => ({ ...preset, phaseOffsets: [...preset.phaseOffsets] }))
  }
  out.genericOdd = [makeGenericOddLegWavePreset(5)].filter(Boolean).map(preset => ({ ...preset, phaseOffsets: [...preset.phaseOffsets] }))
  return out
}

export function makeGenericOddLegWavePreset(legCount) {
  if (!Number.isFinite(legCount) || legCount < 1 || legCount % 2 === 0) return null
  return {
    id: 'genericOddLegWave',
    name: 'generic odd-leg wave',
    legCount,
    support: legCount === 1 ? 'dynamic-hop' : 'rolling-polygon',
    phaseOffsets: Array.from({ length: legCount }, (_, index) => round4(index / legCount)),
    dutyFactor: legCount === 1 ? 0.58 : 0.76,
  }
}
