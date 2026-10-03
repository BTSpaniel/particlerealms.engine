// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/ContactTelemetry.js — extracted from ActiveBodySystem.js
// (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns ground-contact
// resolution (Coulomb friction), per-bone/per-foot/per-sensor-anchor contact
// telemetry (humanoid AND animal — buildContactTelemetry dispatches to
// buildAnimalContactTelemetry internally so both paths share one entry
// point), and the contact-related debug overlay builders. Every function
// here takes its dependencies as explicit parameters, matching the same
// extraction pattern as AnimalLocomotion.js.

import {
  BONE_NAMES,
  clamp01,
  computeSignedAngleOnHorizontal,
  resolveFunctionalSensorAnchors,
  round4,
} from './ActiveBodySystem.js'

export const FOOT_PARTICLE_SOLE_HEIGHT = 0.5

export const FOOT_PARTICLE_CONTACT_HEIGHT = 0.58

export const CONTACT_SENSOR_BONES = [
  { id: 'pelvis', role: 'core' },
  { id: 'head', role: 'head' },
  { id: 'leftHand', role: 'hand' },
  { id: 'rightHand', role: 'hand' },
  { id: 'leftShin', role: 'knee' },
  { id: 'rightShin', role: 'knee' },
  { id: 'leftFoot', role: 'foot', side: 'left' },
  { id: 'rightFoot', role: 'foot', side: 'right' },
]

export function enforceGroundContact(ragdoll, groundY, dt = 1/60, sensors = null) {
  // Clamp Y to floor and apply Coulomb-style ground friction.
  //
  // Without friction the bipolar walking stride cannot propel the body —
  // the foot just slides backward through the ground when the PD pulls it
  // rearward in stance phase, never imparting forward force on the pelvis.
  // Real ground friction creates the reaction force that biological /
  // robotic walking depends on (Atlas, DeepMimic, Isaac Humanoid all set
  // μ ≈ 0.9 on foot↔ground contacts).
  //
  // Friction is implemented as Verlet-consistent velocity damping when the
  // particle is at or below ground level. Feet get high coefficient so
  // they "stick" once planted; other body parts get gentle friction so a
  // fallen body slides realistically (not like ice) but still settles.
  const FOOT_MU = 0.85    // strong — planted feet anchor the body
  const BODY_MU = 0.30    // gentle — fallen body slides to a stop, not pinned
  for (const bone of ragdoll.bones) {
    if (!bone) continue
    const p = bone.particle
    const isFoot = bone.name === 'leftFoot' || bone.name === 'rightFoot'
    const contactY = groundY + (isFoot ? FOOT_PARTICLE_SOLE_HEIGHT : 0)
    if (p.y < contactY) {
      p.y = contactY
      p.py = contactY        // sync prev so vertical Verlet velocity = 0
      if (p.vy < 0) p.vy = 0
      // Apply horizontal friction. Damping is per-frame so high mu means
      // most horizontal velocity is killed each contact frame — equivalent
      // to a stiff Coulomb friction model in the limit dt → 0.
      const surface = typeof sensors?.surfaceAt === 'function' ? sensors.surfaceAt(p.x, p.z) : null
      const frictionMul = clampSurfaceFriction(surface?.friction ?? surface?.frictionMul ?? 1)
      const mu = Math.min(0.98, (isFoot ? FOOT_MU : BODY_MU) * frictionMul)
      p.vx *= (1 - mu)
      p.vz *= (1 - mu)
      // Resync prev-position so the next Verlet integration step picks up
      // the damped velocity (otherwise position delta restores old vel).
      p.px = p.x - p.vx * dt
      p.pz = p.z - p.vz * dt
    }
  }
}

export function clampSurfaceFriction(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 1
  return Math.max(0.05, Math.min(1.5, v))
}

export function buildContactTelemetry(entry, groundY = 0, sensors = null) {
  if (entry?.bodyKind === 'animal') return buildAnimalContactTelemetry(entry, groundY, sensors)
  const ragdoll = entry?.ragdoll
  if (!ragdoll) return null
  const byBone = Object.create(null)
  const feet = { left: null, right: null }
  const sensorAnchors = buildSensorAnchorTelemetry(entry, groundY, sensors)
  const summary = {
    contactCount: 0,
    groundedFeet: 0,
    totalPressure: 0,
    maxPressure: 0,
    maxSlipSpeed: 0,
    supportQuality: 0,
    sensorAnchorCount: sensorAnchors?.summary?.count || 0,
    functionalContactCount: sensorAnchors?.summary?.contactCount || 0,
    footStanceTrust: { left: 0, right: 0 },
  }
  for (const spec of CONTACT_SENSOR_BONES) {
    const bone = ragdoll.boneMap?.get(spec.id) || ragdoll.bones?.[BONE_NAMES.indexOf(spec.id)]
    if (!bone?.particle) {
      byBone[spec.id] = { id: spec.id, role: spec.role, missing: true }
      continue
    }
    const record = buildBoneContactRecord(entry, spec, bone.particle, groundY, sensors)
    byBone[spec.id] = record
    if (record.contact) {
      summary.contactCount++
      summary.totalPressure += record.pressure
      summary.maxPressure = Math.max(summary.maxPressure, record.pressure)
    }
    summary.maxSlipSpeed = Math.max(summary.maxSlipSpeed, record.slipSpeed)
    if (spec.side) {
      feet[spec.side] = record
      if (record.contact) summary.groundedFeet++
      summary.footStanceTrust[spec.side] = record.stanceTrust
    }
  }
  summary.totalPressure = round4(summary.totalPressure)
  summary.maxPressure = round4(summary.maxPressure)
  summary.maxSlipSpeed = round4(summary.maxSlipSpeed)
  summary.supportQuality = round4((summary.footStanceTrust.left + summary.footStanceTrust.right) * 0.5)
  return {
    version: 1,
    byBone,
    feet,
    sensorAnchors,
    summary,
  }
}

export function buildAnimalContactTelemetry(entry, groundY = 0, sensors = null) {
  const ragdoll = entry?.ragdoll
  if (!ragdoll) return null
  const byBone = Object.create(null)
  const feet = { left: null, right: null }
  const sensorAnchors = buildSensorAnchorTelemetry(entry, groundY, sensors)
  const summary = {
    contactCount: 0,
    groundedFeet: 0,
    totalPressure: 0,
    maxPressure: 0,
    maxSlipSpeed: 0,
    supportQuality: 0,
    sensorAnchorCount: sensorAnchors?.summary?.count || 0,
    functionalContactCount: sensorAnchors?.summary?.contactCount || 0,
    footStanceTrust: { left: 0, right: 0 },
  }
  const specs = []
  const root = ragdoll.bones?.[0]
  if (root) specs.push({ id: root.name, role: 'core' })
  for (const descriptor of entry.universalLegDescriptors || []) {
    if (!descriptor?.footBone) continue
    specs.push({ id: descriptor.footBone, role: 'foot', side: descriptor.side || null })
  }
  for (const spec of specs) {
    const bone = ragdoll.boneMap?.get(spec.id)
    if (!bone?.particle) {
      byBone[spec.id] = { id: spec.id, role: spec.role, missing: true }
      continue
    }
    const record = buildBoneContactRecord(entry, spec, bone.particle, groundY, sensors)
    byBone[spec.id] = record
    if (record.contact) {
      summary.contactCount++
      summary.totalPressure += record.pressure
      summary.maxPressure = Math.max(summary.maxPressure, record.pressure)
    }
    summary.maxSlipSpeed = Math.max(summary.maxSlipSpeed, record.slipSpeed)
    if (spec.side) {
      feet[spec.side] = record
      if (record.contact) summary.groundedFeet++
      summary.footStanceTrust[spec.side] = Math.max(summary.footStanceTrust[spec.side] || 0, record.stanceTrust)
    }
  }
  const footCount = Math.max(1, (entry.universalLegDescriptors || []).length)
  summary.totalPressure = round4(summary.totalPressure)
  summary.maxPressure = round4(summary.maxPressure)
  summary.maxSlipSpeed = round4(summary.maxSlipSpeed)
  summary.supportQuality = round4(summary.groundedFeet / footCount)
  return {
    version: 1,
    byBone,
    feet,
    sensorAnchors,
    summary,
  }
}

export function buildBoneContactRecord(entry, spec, p, groundY, sensors) {
  const isFoot = spec.role === 'foot'
  const contactY = groundY + (isFoot && entry?.bodyKind !== 'animal' ? FOOT_PARTICLE_SOLE_HEIGHT : 0)
  const height = p.y - contactY
  const window = isFoot ? (entry?.bodyKind === 'animal' ? scaledAnimalContactWindow(entry, 0.08) : 0.08) : 0.045
  const contact = height <= window
  const depth = Math.max(0, -height)
  const normalVelocity = p.vy || 0
  const slipSpeed = Math.hypot(p.vx || 0, p.vz || 0)
  const surface = readContactSurface(sensors, p.x, p.z)
  const proximity = contact ? 1 - clamp01(Math.max(0, height) / window) : 0
  const pressure = contact ? clamp01(proximity * 0.85 + depth * 5 + Math.max(0, -normalVelocity) * 0.15) : 0
  const slipRisk = contact ? clamp01((slipSpeed / (isFoot ? 0.8 : 1.4)) * (1.15 - Math.min(1, surface.friction) * 0.25)) : 0
  const stanceTrust = isFoot && contact ? round4(clamp01(pressure * (1 - slipRisk) * clamp01(surface.friction))) : 0
  const record = {
    id: spec.id,
    role: spec.role,
    side: spec.side || null,
    contact,
    point: [round4(p.x), round4(p.y), round4(p.z)],
    normal: [0, 1, 0],
    height: round4(height),
    depth: round4(depth),
    normalVelocity: round4(normalVelocity),
    tangentialVelocity: [round4(p.vx || 0), 0, round4(p.vz || 0)],
    slipSpeed: round4(slipSpeed),
    pressure: round4(pressure),
    slipRisk: round4(slipRisk),
    stanceTrust,
    surface,
  }
  if (spec.side) record.derived = buildFootContactDerived(entry, spec.side, record)
  return record
}

export function buildSensorAnchorTelemetry(entry, groundY = 0, sensors = null) {
  const anchors = resolveFunctionalSensorAnchors(entry?.bodySpec, entry?.sensorAnchors)
  const byId = Object.create(null)
  const records = []
  const summary = { count: 0, contactCount: 0, footAnchorCount: 0, handAnchorCount: 0, approximateCount: 0 }
  for (const anchor of anchors) {
    const record = buildSensorAnchorRecord(entry, anchor, groundY, sensors)
    byId[anchor.id] = record
    records.push(record)
    if (!record.missing) {
      summary.count++
      if (record.contact) summary.contactCount++
      if (record.anchorClass === 'foot') summary.footAnchorCount++
      if (record.anchorClass === 'hand') summary.handAnchorCount++
      if (record.source === 'approximateFromDriver') summary.approximateCount++
    }
  }
  return { version: 1, anchors: records, byId, summary }
}

export function buildSensorAnchorRecord(entry, anchor, groundY, sensors) {
  const driver = entry?.ragdoll?.boneMap?.get(anchor.driverBone)
  if (!driver?.particle) {
    return { id: anchor.id, role: anchor.role, side: anchor.side || null, driverBone: anchor.driverBone, missing: true }
  }
  const reference = entry?.ragdoll?.boneMap?.get(anchor.referenceBone || anchor.parent)
  const point = approximateSensorAnchorPoint(entry, anchor, driver.particle, reference?.particle)
  const anchorClass = isFootAnchor(anchor) ? 'foot' : isHandAnchor(anchor) ? 'hand' : 'body'
  const contactY = groundY + (anchorClass === 'foot' && entry?.bodyKind !== 'animal' ? FOOT_PARTICLE_SOLE_HEIGHT : 0)
  const height = point[1] - contactY
  const window = anchorClass === 'foot' ? (entry?.bodyKind === 'animal' ? scaledAnimalContactWindow(entry, 0.085) : 0.085) : 0.045
  const contact = height <= window
  const surface = readContactSurface(sensors, point[0], point[2])
  const slipSpeed = Math.hypot(driver.particle.vx || 0, driver.particle.vz || 0)
  const pressure = contact ? clamp01((1 - clamp01(Math.max(0, height) / window)) * 0.8 + Math.max(0, -height) * 4 + Math.max(0, -(driver.particle.vy || 0)) * 0.12) : 0
  const slipRisk = contact ? clamp01((slipSpeed / (anchorClass === 'foot' ? 0.8 : 1.4)) * (1.15 - Math.min(1, surface.friction) * 0.25)) : 0
  return {
    id: anchor.id,
    role: anchor.role,
    side: anchor.side || null,
    parent: anchor.parent || null,
    driverBone: anchor.driverBone,
    referenceBone: anchor.referenceBone || null,
    source: anchor.source || 'approximateFromDriver',
    anchorClass,
    contact,
    point: [round4(point[0]), round4(point[1]), round4(point[2])],
    normal: [0, 1, 0],
    height: round4(height),
    pressure: round4(pressure),
    slipRisk: round4(slipRisk),
    slipSpeed: round4(slipSpeed),
    surface,
    localOffset: Array.isArray(anchor.localOffset) ? [...anchor.localOffset] : [0, 0, 0],
    derived: {
      contactPatch: anchorContactPatch(anchor),
      scaleBy: anchor.scaleBy || null,
    },
  }
}

export function approximateSensorAnchorPoint(entry, anchor, driver, reference = null) {
  const local = Array.isArray(anchor.localOffset) ? anchor.localOffset : [0, 0, 0]
  const scale = Math.max(0.001, entry?.measurements?.[anchor.scaleBy] || 1)
  const basis = makeSensorAnchorBasis(entry, anchor, driver, reference)
  return [
    driver.x + basis.side[0] * local[0] * scale + basis.up[0] * local[1] * scale + basis.forward[0] * local[2] * scale,
    driver.y + basis.side[1] * local[0] * scale + basis.up[1] * local[1] * scale + basis.forward[1] * local[2] * scale,
    driver.z + basis.side[2] * local[0] * scale + basis.up[2] * local[1] * scale + basis.forward[2] * local[2] * scale,
  ]
}

export function makeSensorAnchorBasis(entry, anchor, driver, reference = null) {
  let fx = driver.x - (reference?.x ?? driver.x)
  let fy = isFootAnchor(anchor) ? 0 : driver.y - (reference?.y ?? driver.y)
  let fz = driver.z - (reference?.z ?? driver.z)
  let len = Math.hypot(fx, fy, fz)
  if (len < 0.001) {
    const yaw = entry?.navState?.facing ?? 0
    fx = Math.sin(yaw)
    fy = 0
    fz = Math.cos(yaw)
    len = 1
  }
  fx /= len
  fy /= len
  fz /= len
  const ux = 0
  const uy = 1
  const uz = 0
  let sx = fz
  let sy = 0
  let sz = -fx
  let slen = Math.hypot(sx, sy, sz)
  if (slen < 0.001) {
    sx = 1
    sy = 0
    sz = 0
    slen = 1
  }
  return {
    forward: [fx, fy, fz],
    up: [ux, uy, uz],
    side: [sx / slen, sy / slen, sz / slen],
  }
}

export function isFootAnchor(anchor) {
  return anchor?.parent === 'leftFoot' || anchor?.parent === 'rightFoot' || ['heel', 'sole', 'toeBase', 'toeTip', 'foot', 'paw', 'tarsus'].includes(anchor?.role)
}

export function isHandAnchor(anchor) {
  return anchor?.parent === 'leftHand' || anchor?.parent === 'rightHand' || ['palm', 'thumbTip', 'fingerTip'].includes(anchor?.role)
}

export function anchorContactPatch(anchor) {
  if (anchor?.role === 'heel') return 'heel'
  if (anchor?.role === 'sole') return 'sole'
  if (anchor?.role === 'toeBase' || anchor?.role === 'toeTip') return 'forefoot'
  return null
}

export function readContactSurface(sensors, x, z) {
  let surface = null
  if (typeof sensors?.surfaceAt === 'function') {
    try { surface = sensors.surfaceAt(x, z) } catch { surface = null }
  }
  if (typeof surface === 'number') return { type: null, friction: round4(clampSurfaceFriction(surface)) }
  if (typeof surface === 'string') return { type: surface, friction: 1 }
  return {
    type: surface?.type ?? surface?.material ?? null,
    friction: round4(clampSurfaceFriction(surface?.friction ?? surface?.frictionMul ?? 1)),
  }
}

export function buildFootContactDerived(entry, side, record) {
  const prefix = side === 'left' ? 'left' : 'right'
  const shin = entry?.ragdoll?.boneMap?.get(`${prefix}Shin`)
  const foot = entry?.ragdoll?.boneMap?.get(`${prefix}Foot`)
  const sp = shin?.particle
  const fp = foot?.particle
  if (!sp || !fp) return null
  const dx = fp.x - sp.x
  const dz = fp.z - sp.z
  const len = Math.hypot(dx, dz)
  const yaw = entry?.navState?.facing || 0
  const fwdX = Math.sin(yaw)
  const fwdZ = Math.cos(yaw)
  const sideX = Math.cos(yaw)
  const sideZ = -Math.sin(yaw)
  const footLength = Math.max(0.001, entry?.measurements?.footLength || 0.22)
  const fwd = dx * fwdX + dz * fwdZ
  const sideOffset = dx * sideX + dz * sideZ
  const toeDelta = len > 0.0001 ? computeSignedAngleOnHorizontal(fwdX, fwdZ, dx / len, dz / len) : 0
  const patch = !record.contact ? 'none' : fwd > footLength * 0.18 ? 'forefoot' : fwd < -footLength * 0.08 ? 'heel' : 'sole'
  return {
    contactPatch: patch,
    toeForwardDelta: round4(toeDelta),
    toeForward: round4(fwd / footLength),
    shinFootAlignmentError: round4(clamp01(Math.abs(sideOffset) / Math.max(0.03, footLength * 0.5))),
  }
}

export function copyContactTelemetry(contactTelemetry) {
  if (!contactTelemetry) return null
  const byBone = Object.create(null)
  for (const [id, record] of Object.entries(contactTelemetry.byBone || {})) byBone[id] = copyContactRecord(record)
  return {
    version: contactTelemetry.version ?? 1,
    byBone,
    feet: {
      left: copyContactRecord(contactTelemetry.feet?.left),
      right: copyContactRecord(contactTelemetry.feet?.right),
    },
    sensorAnchors: copySensorAnchorTelemetry(contactTelemetry.sensorAnchors),
    summary: {
      ...contactTelemetry.summary,
      footStanceTrust: { ...(contactTelemetry.summary?.footStanceTrust || {}) },
    },
  }
}

export function copySensorAnchorTelemetry(sensorAnchors) {
  if (!sensorAnchors) return null
  const byId = Object.create(null)
  for (const [id, record] of Object.entries(sensorAnchors.byId || {})) byId[id] = copyContactRecord(record)
  return {
    version: sensorAnchors.version ?? 1,
    anchors: (sensorAnchors.anchors || []).map(copyContactRecord),
    byId,
    summary: { ...(sensorAnchors.summary || {}) },
  }
}

export function copyContactRecord(record) {
  if (!record) return null
  return {
    ...record,
    point: Array.isArray(record.point) ? [...record.point] : null,
    normal: Array.isArray(record.normal) ? [...record.normal] : null,
    tangentialVelocity: Array.isArray(record.tangentialVelocity) ? [...record.tangentialVelocity] : null,
    localOffset: Array.isArray(record.localOffset) ? [...record.localOffset] : undefined,
    surface: record.surface ? { ...record.surface } : null,
    derived: record.derived ? { ...record.derived } : null,
  }
}

export function makeContactOverlay(contactTelemetry) {
  if (!contactTelemetry) return null
  const points = []
  for (const record of Object.values(contactTelemetry.byBone || {})) {
    if (!record || record.missing) continue
    points.push({
      id: record.id,
      role: record.role,
      point: [...record.point],
      contact: record.contact,
      pressure: record.pressure,
      slipSpeed: record.slipSpeed,
      stanceTrust: record.stanceTrust,
      color: contactOverlayColor(record),
    })
  }
  for (const record of contactTelemetry.sensorAnchors?.anchors || []) {
    if (!record || record.missing) continue
    points.push({
      id: record.id,
      role: record.role,
      point: [...record.point],
      contact: record.contact,
      pressure: record.pressure,
      slipSpeed: record.slipSpeed,
      stanceTrust: record.stanceTrust ?? 0,
      color: contactOverlayColor(record),
    })
  }
  return {
    summary: {
      ...contactTelemetry.summary,
      footStanceTrust: { ...(contactTelemetry.summary?.footStanceTrust || {}) },
    },
    feet: {
      left: makeContactFootOverlay(contactTelemetry.feet?.left),
      right: makeContactFootOverlay(contactTelemetry.feet?.right),
    },
    points,
  }
}

export function makeContactFootOverlay(record) {
  if (!record) return null
  return {
    contact: record.contact,
    point: [...record.point],
    pressure: record.pressure,
    slipRisk: record.slipRisk,
    stanceTrust: record.stanceTrust,
    contactPatch: record.derived?.contactPatch ?? null,
    toeForwardDelta: record.derived?.toeForwardDelta ?? null,
    shinFootAlignmentError: record.derived?.shinFootAlignmentError ?? null,
    color: contactOverlayColor(record),
  }
}

export function contactOverlayColor(record) {
  if (!record?.contact) return '#2196F3'
  if ((record.pressure ?? 0) > 0.92 || (record.normalVelocity ?? 0) < -1.5) return '#F44336'
  if ((record.slipRisk ?? 0) > 0.35) return '#FFC107'
  return '#4CAF50'
}

export function logContactTrace(entry) {
  const telemetry = entry?.contactTelemetry
  if (!telemetry) return
  const l = telemetry.feet?.left
  const r = telemetry.feet?.right
  console.log(
    `[CONTACT-TRACE] ${entry.entityId} ` +
    `L=${formatFootContactTrace(l)} R=${formatFootContactTrace(r)} ` +
    `contacts=${telemetry.summary.contactCount} support=${telemetry.summary.supportQuality}`
  )
}

export function formatFootContactTrace(record) {
  if (!record) return 'missing'
  return `${record.contact ? 'on' : 'off'} p=${record.pressure} slip=${record.slipSpeed} trust=${record.stanceTrust} patch=${record.derived?.contactPatch ?? 'none'}`
}

export function scaledAnimalContactWindow(entry, base) {
  const scale = Math.max(0.2, entry?.scale || 1)
  return Math.max(0.012, base * scale)
}
