// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/AnimalLocomotion.js — extracted from ActiveBodySystem.js
// (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns the animal (quadruped/
// arachnid) active-body path: anatomy spec generation, PBD ragdoll assembly,
// per-frame locomotion (gait, leg targets, tail, neural residual blending),
// and animal-only debug tracing. Every function here takes its dependencies
// as explicit parameters (ragdoll/entry/skeleton/dt/...) — none of them close
// over ActiveBodySystem module state, so this extraction is a pure move, not
// a redesign. Shared helpers (contact telemetry, balance, small math/format
// utils) stay in ActiveBodySystem.js and are imported back here; the reverse
// (the handful of names ActiveBodySystem.js still calls into, e.g.
// stepAnimalActiveBody) are exported from here.

import {
  buildDirectionDiagnostics,
  clamp01,
  clampSigned,
  copyFunctionalSensorAnchor,
  groundYFromFoot,
  normalizePhase01,
  normalizeRadians,
  percentSignal,
  radiansToDebugDegrees,
  setParticleVelocity,
  signedAngularDelta,
  slewRadians,
  unitSignal,
  unitSignalDefault,
} from './ActiveBodySystem.js'
import {
  buildContactTelemetry,
  clampSurfaceFriction,
  scaledAnimalContactWindow,
} from './ContactTelemetry.js'
import {
  makeBalanceState,
} from './BalanceMotor.js'
import {
  applyHingeLimits,
} from './PhysicsMotor.js'
import { RagdollState } from '../../../sim/physics/PBDRagdoll.js'
import { PBDSolver } from '../../../sim/physics/PBDSolver.js'
import { vec3Lerp } from '../../../core/math/MathVec3.js'
import { applyNeuroJerks } from './NeuroModifiers.js'
import {
  buildObservation,
  neuralMotorForward,
  trainNeuralMotor,
  computeTeacherSignal,
  BONE_ORDER,
  tierFromIntelligence,
} from './NeuralMotor.js'

export const ANIMAL_DEBUG_ENTITY_IDS = new Set([
  'stray_dog_rook',
  'alley_cat_miso',
  'cellar_spider_skitter',
  'active_dog',
  'active_cat',
  'active_spider',
])

export function createAnimalAnatomySpec(skeleton) {
  if (skeleton?.bodyType === 'arachnid' || skeleton?.profileId === 'spider_arachnid') return createArachnidAnatomySpec(skeleton)
  return createQuadrupedAnatomySpec(skeleton)
}

export function createQuadrupedAnatomySpec(skeleton) {
  const species = skeleton?.profileId === 'cat_quadruped' ? 'cat' : 'dog'
  return {
    schema: 'life.body.v1',
    species,
    bodyType: skeleton?.bodyType || 'quadruped',
    thorax: {
      ribCage: { id: 'ribCage', attachmentBones: ['chest', 'lumbar'], collisionGroup: 'rib', protects: ['heart', 'leftLung', 'rightLung', 'liver', 'spleen'], respirationDriver: 'diaphragm' },
      sternum: { id: 'sternum', attachmentBones: ['chest'], collisionGroup: 'sternum' },
      diaphragm: { id: 'diaphragm', attachmentBones: ['chest', 'lumbar'], drives: ['respiration', 'intraAbdominalPressure'], collisionGroup: 'softTissue' },
    },
    organs: {
      brain: { container: 'cranialVault', side: 'center', vital: true, collisionGroup: 'organ', attachmentBones: ['head'] },
      spinalCord: { container: 'spinalCanal', side: 'center', vital: true, collisionGroup: 'nerve', attachmentBones: ['neck', 'chest', 'lumbar', 'hips'] },
      heart: { container: 'ribCage', side: 'center', vital: true, collisionGroup: 'organ', attachmentBones: ['chest'] },
      leftLung: { container: 'ribCage', side: 'left', vital: true, collisionGroup: 'organ', attachmentBones: ['chest'] },
      rightLung: { container: 'ribCage', side: 'right', vital: true, collisionGroup: 'organ', attachmentBones: ['chest'] },
      liver: { container: 'upperAbdomen', side: 'right', vital: true, collisionGroup: 'organ', attachmentBones: ['lumbar'] },
      spleen: { container: 'upperAbdomen', side: 'left', vital: false, collisionGroup: 'organ', attachmentBones: ['lumbar'] },
      stomach: { container: 'abdomen', side: 'left', vital: false, collisionGroup: 'organ', attachmentBones: ['lumbar'] },
      intestines: { container: 'abdomen', side: 'center', vital: false, collisionGroup: 'organ', attachmentBones: ['lumbar', 'hips'] },
      kidneys: { container: 'retroperitoneal', side: 'bilateral', vital: true, collisionGroup: 'organ', attachmentBones: ['lumbar'] },
      bladder: { container: 'pelvisBasin', side: 'center', vital: false, collisionGroup: 'organ', attachmentBones: ['hips'] },
      pancreas: { container: 'upperAbdomen', side: 'center', vital: false, collisionGroup: 'organ', attachmentBones: ['lumbar'] },
    },
    collisionShells: {
      skull: { shape: 'ellipsoid', centerBone: 'head', radius: species === 'cat' ? [0.075, 0.06, 0.085] : [0.095, 0.075, 0.13], group: 'bone' },
      ribCage: { shape: 'ellipsoid', centerBone: 'chest', radius: species === 'cat' ? [0.16, 0.11, 0.19] : [0.20, 0.14, 0.24], group: 'rib' },
      abdomen: { shape: 'ellipsoid', centerBone: 'lumbar', radius: species === 'cat' ? [0.15, 0.10, 0.18] : [0.19, 0.13, 0.23], group: 'softTissue' },
      pelvisBasin: { shape: 'ellipsoid', centerBone: 'hips', radius: species === 'cat' ? [0.14, 0.09, 0.14] : [0.18, 0.12, 0.17], group: 'softTissue' },
    },
  }
}

export function createArachnidAnatomySpec(skeleton) {
  return {
    schema: 'life.body.v1',
    species: 'spider',
    bodyType: skeleton?.bodyType || 'arachnid',
    thorax: {
      ribCage: { id: 'bookLungChamber', attachmentBones: ['abdomen'], collisionGroup: 'respiratoryBookLung', protects: ['heart', 'leftLung', 'rightLung'], respirationDriver: 'bookLungVentilator' },
      sternum: { id: 'sternalPlate', attachmentBones: ['cephalothorax'], collisionGroup: 'exoskeleton' },
      diaphragm: { id: 'bookLungVentilator', attachmentBones: ['abdomen', 'cephalothorax'], drives: ['respiration', 'hemolymphPressure'], collisionGroup: 'softTissue' },
    },
    organs: {
      brain: { container: 'cephalothorax', side: 'center', vital: true, collisionGroup: 'organ', attachmentBones: ['cephalothorax', 'ocularPlate'] },
      subesophagealGanglion: { container: 'cephalothorax', side: 'center', vital: true, collisionGroup: 'nerve', attachmentBones: ['cephalothorax'] },
      ventralNerveCord: { container: 'cephalothorax', side: 'center', vital: true, collisionGroup: 'nerve', attachmentBones: ['cephalothorax', 'abdomen'] },
      heart: { container: 'dorsalAbdomen', side: 'center', vital: true, collisionGroup: 'organ', attachmentBones: ['abdomen'] },
      leftLung: { container: 'bookLungChamber', side: 'left', vital: true, collisionGroup: 'organ', attachmentBones: ['abdomen'] },
      rightLung: { container: 'bookLungChamber', side: 'right', vital: true, collisionGroup: 'organ', attachmentBones: ['abdomen'] },
      liver: { container: 'digestiveGland', side: 'center', vital: true, collisionGroup: 'organ', attachmentBones: ['abdomen'] },
      stomach: { container: 'suckingStomach', side: 'center', vital: false, collisionGroup: 'organ', attachmentBones: ['cephalothorax'] },
      intestines: { container: 'midgut', side: 'center', vital: false, collisionGroup: 'organ', attachmentBones: ['abdomen'] },
      kidneys: { container: 'malpighianTubules', side: 'bilateral', vital: true, collisionGroup: 'organ', attachmentBones: ['abdomen'] },
      silkGlands: { container: 'spinneretComplex', side: 'bilateral', vital: false, collisionGroup: 'organ', attachmentBones: ['abdomen'] },
    },
    collisionShells: {
      cephalothorax: { shape: 'ellipsoid', centerBone: 'cephalothorax', radius: [0.13, 0.045, 0.16], group: 'exoskeleton' },
      abdomen: { shape: 'ellipsoid', centerBone: 'abdomen', radius: [0.15, 0.055, 0.18], group: 'softTissue' },
      ocularPlate: { shape: 'ellipsoid', centerBone: 'ocularPlate', radius: [0.075, 0.025, 0.045], group: 'exoskeleton' },
      bookLungChamber: { shape: 'ellipsoid', centerBone: 'abdomen', radius: [0.11, 0.035, 0.12], group: 'softTissue' },
    },
  }
}

export function createAnimalBrainProfile(skeleton, options = {}, entityId = 'animal') {
  const species = skeleton?.profileId === 'spider_arachnid' ? 'spider' : skeleton?.profileId === 'cat_quadruped' ? 'cat' : 'dog'
  const defaultIntelligence = species === 'spider' ? 6 : species === 'cat' ? 18 : 22
  const intelligence = options.intelligence ?? defaultIntelligence
  const magical = options.magical ?? false
  const tier = options.brainTier || tierFromIntelligence(intelligence, magical)
  return {
    species,
    archetype: species === 'spider' ? 'arachnid' : 'mammal',
    intelligence,
    tier,
    motorProfileKey: options.motorProfileKey || options.brainProfileKey || `shared:${skeleton?.profileId || species || 'animal'}:${tier}`,
  }
}

export function cloneAnimalSkeleton(skeleton) {
  if (!skeleton?.bones?.length) return null
  return {
    ...skeleton,
    partLoadout: { ...(skeleton.partLoadout || {}) },
    dimensions: { ...(skeleton.dimensions || {}) },
    tailBones: Array.isArray(skeleton.tailBones) ? [...skeleton.tailBones] : [],
    bones: skeleton.bones.map(bone => ({
      ...bone,
      local: Array.isArray(bone.local) ? [...bone.local] : [0, 0, 0],
    })),
    legDescriptors: Array.isArray(skeleton.legDescriptors)
      ? skeleton.legDescriptors.map(descriptor => ({
          ...descriptor,
          segmentBones: Array.isArray(descriptor.segmentBones) ? [...descriptor.segmentBones] : undefined,
          supportPoint: Array.isArray(descriptor.supportPoint) ? [...descriptor.supportPoint] : undefined,
        }))
      : [],
    sensorAnchors: Array.isArray(skeleton.sensorAnchors)
      ? skeleton.sensorAnchors.map(copyFunctionalSensorAnchor)
      : [],
  }
}

export function animalVerticalScaleFor(skeleton, scale = 1) {
  const bodyType = skeleton?.bodyType || ''
  if (bodyType === 'arachnid') return Math.max(scale, 1)
  if (bodyType === 'small_quadruped') return Math.max(scale, 0.68)
  return Math.max(scale, 1)
}

export function animalPoseVerticalScale(entry) {
  return entry?.verticalScale || entry?.scale || 1
}

export function animalLocalToWorldPosition(origin, yaw, scale, local, verticalScale = scale) {
  const rightX = Math.cos(yaw)
  const rightZ = -Math.sin(yaw)
  const fwdX = Math.sin(yaw)
  const fwdZ = Math.cos(yaw)
  return [
    origin[0] + (local[0] * rightX + local[2] * fwdX) * scale,
    origin[1] + local[1] * verticalScale,
    origin[2] + (local[0] * rightZ + local[2] * fwdZ) * scale,
  ]
}

export function createAnimalPbdRagdoll(skeleton, worldPosition, options = {}) {
  const scale = options.scale || 1
  const verticalScale = options.verticalScale || scale
  const facing = options.facing ?? 0
  const solver = new PBDSolver({
    gravity: [0, -9.8, 0],
    substeps: 1,
    iterations: skeleton.bodyType === 'arachnid' ? 14 : 16,
    maxVelocity: 10,
    damping: 0.985,
    enableGroundCollision: false,
    selfCollision: false,
    enableSleep: false,
  })
  const bones = []
  const boneMap = new Map()
  const sourceById = new Map(skeleton.bones.map((bone, index) => [bone.id, { bone, index }]))
  for (let index = 0; index < skeleton.bones.length; index++) {
    const source = skeleton.bones[index]
    const pos = animalLocalToWorldPosition(worldPosition, facing, scale, source.local, verticalScale)
    const mass = animalBoneMass(source, skeleton)
    const particle = solver.addParticle(pos[0], pos[1], pos[2], 1 / mass)
    particle.radius = animalBoneRadius(source, skeleton, scale)
    const parentId = source.parent && sourceById.has(source.parent) ? sourceById.get(source.parent).index : -1
    const runtime = {
      id: index,
      name: source.id,
      parentId,
      mass,
      role: source.role || null,
      side: source.side || null,
      local: [...source.local],
      particle,
      source,
    }
    bones.push(runtime)
    boneMap.set(source.id, runtime)
  }
  const distanceConstraints = []
  for (const bone of bones) {
    if (bone.parentId < 0) continue
    const parent = bones[bone.parentId]
    if (!parent?.particle) continue
    distanceConstraints.push(solver.addDistanceConstraint(parent.particle, bone.particle, null, animalParentConstraintStiffness(bone.source, parent.source, skeleton)))
  }
  for (const descriptor of skeleton.legDescriptors || []) {
    const root = boneMap.get(descriptor.rootBone)
    const foot = boneMap.get(descriptor.footBone)
    if (root?.particle && foot?.particle) distanceConstraints.push(solver.addDistanceConstraint(root.particle, foot.particle, null, animalLegSpanConstraintStiffness(skeleton)))
  }
  const structuralLimits = computeAnimalStructuralLimits(skeleton, boneMap)
  return {
    solver,
    bones,
    boneMap,
    distanceConstraints,
    structuralLimits,
    angleConstraints: [],
    state: RagdollState.ANIMATED,
    blendWeight: 0,
    getBonePosition(boneId) {
      const bone = typeof boneId === 'string' ? boneMap.get(boneId) : bones[boneId]
      const p = bone?.particle
      return p ? [p.x, p.y, p.z] : [0, 0, 0]
    },
    activate(initialVelocity = null) {
      this.state = RagdollState.RAGDOLL
      this.blendWeight = 1
      if (initialVelocity) {
        for (const bone of bones) bone.particle.setVelocity(initialVelocity[0], initialVelocity[1], initialVelocity[2])
      }
    },
    deactivate() {
      this.state = RagdollState.ANIMATED
      this.blendWeight = 0
    },
    applyImpulse(boneId, impulse) {
      const bone = typeof boneId === 'string' ? boneMap.get(boneId) : bones[boneId]
      if (!bone?.particle || !Array.isArray(impulse)) return
      bone.particle.vx += (impulse[0] || 0) / bone.mass
      bone.particle.vy += (impulse[1] || 0) / bone.mass
      bone.particle.vz += (impulse[2] || 0) / bone.mass
    },
    applyExplosion(origin, force, radius) {
      if (!Array.isArray(origin) || !Number.isFinite(force) || !Number.isFinite(radius) || radius <= 0) return
      for (const bone of bones) {
        const p = bone.particle
        const dx = p.x - origin[0]
        const dy = p.y - origin[1]
        const dz = p.z - origin[2]
        const dist = Math.hypot(dx, dy, dz)
        if (dist <= 0.001 || dist >= radius) continue
        const magnitude = force * (1 - dist / radius) * (1 - dist / radius)
        this.applyImpulse(bone.id, [dx / dist * magnitude, dy / dist * magnitude + magnitude * 0.35, dz / dist * magnitude])
      }
      this.activate()
    },
    _solveCollisions() {},
    _updateColliders() {},
  }
}

export function animalParentConstraintStiffness(bone, parent, skeleton) {
  const role = bone?.role || ''
  const parentRole = parent?.role || ''
  if (skeleton?.bodyType === 'arachnid') {
    if (role === 'abdomen' || parentRole === 'root') return 1
    if (role === 'pedipalp') return 0.86
    return 0.96
  }
  if (role === 'tail' || role === 'ear' || role === 'snout') return 0.82
  if (role === 'root' || role === 'spine' || role === 'chest' || role === 'neck' || role === 'head') return 1
  if (role === 'upperLeg' || role === 'lowerLeg' || role === 'paw') return 0.96
  return 0.92
}

export function animalLegSpanConstraintStiffness(skeleton) {
  return skeleton?.bodyType === 'arachnid' ? 0.91 : 0.96
}

export function computeAnimalStructuralLimits(skeleton, boneMap) {
  const limits = []
  const add = (aId, bId, minScale, maxScale, strength = 1) => {
    const a = boneMap.get(aId)
    const b = boneMap.get(bId)
    if (!a?.particle || !b?.particle) return
    const d = Math.hypot(
      b.particle.x - a.particle.x,
      b.particle.y - a.particle.y,
      b.particle.z - a.particle.z
    )
    if (d < 0.0001) return
    limits.push({ a: a.particle, b: b.particle, minDist: d * minScale, maxDist: d * maxScale, strength })
  }
  if (skeleton?.bodyType === 'arachnid') {
    add('cephalothorax', 'abdomen', 0.96, 1.03, 1)
    add('cephalothorax', 'ocularPlate', 0.92, 1.08, 0.9)
    add('abdomen', 'ocularPlate', 0.78, 1.16, 0.82)
    for (let index = 1; index <= 4; index++) {
      add(`leftLeg${index}Coxa`, `rightLeg${index}Coxa`, 0.94, 1.08, 0.9)
      add(`leftLeg${index}Femur`, `rightLeg${index}Femur`, 0.58, 1.42, 0.45)
    }
    for (const descriptor of skeleton.legDescriptors || []) {
      const chain = Array.isArray(descriptor.segmentBones) ? descriptor.segmentBones : []
      if (chain.length >= 6) {
        add(chain[0], chain[2], 0.72, 1.10, 0.82)
        add(chain[1], chain[4], 0.64, 1.18, 0.72)
        add(chain[0], chain[5], 0.58, 1.28, 0.58)
      }
    }
    return limits
  }
  add('hips', 'lumbar', 0.97, 1.03, 1)
  add('lumbar', 'chest', 0.97, 1.03, 1)
  add('hips', 'chest', 0.96, 1.04, 1)
  add('hips', 'neck', 0.88, 1.10, 0.86)
  add('chest', 'head', 0.78, 1.16, 0.72)
  add('leftHindHip', 'rightHindHip', 0.92, 1.10, 0.86)
  add('leftForeShoulder', 'rightForeShoulder', 0.92, 1.10, 0.86)
  add('leftHindHip', 'rightForeShoulder', 0.94, 1.08, 1)
  add('rightHindHip', 'leftForeShoulder', 0.94, 1.08, 1)
  add('hips', 'leftForeShoulder', 0.92, 1.10, 0.9)
  add('hips', 'rightForeShoulder', 0.92, 1.10, 0.9)
  add('chest', 'leftHindHip', 0.92, 1.10, 0.9)
  add('chest', 'rightHindHip', 0.92, 1.10, 0.9)
  for (const descriptor of skeleton.legDescriptors || []) {
    add(descriptor.rootBone, descriptor.midBone, 0.62, 1.08, 0.86)
    add(descriptor.midBone, descriptor.footBone, 0.66, 1.10, 0.86)
    add(descriptor.rootBone, descriptor.footBone, 0.70, 1.18, 0.82)
  }
  return limits
}

export function animalBoneMass(bone, skeleton) {
  const role = bone?.role || ''
  if (skeleton?.bodyType === 'arachnid') {
    if (role === 'abdomen') return 0.42
    if (role === 'root') return 0.36
    if (role === 'eyes') return 0.08
    if (role === 'pedipalp') return 0.04
    return 0.035
  }
  if (role === 'root' || role === 'chest' || role === 'spine') return 0.9
  if (role === 'head') return 0.34
  if (role === 'neck') return 0.22
  if (role === 'tail') return 0.08
  if (role === 'paw') return 0.09
  if (role === 'ear' || role === 'snout') return 0.04
  return 0.18
}

export function animalBoneRadius(bone, skeleton, scale) {
  const dims = skeleton?.dimensions || {}
  const role = bone?.role || ''
  if (skeleton?.bodyType === 'arachnid') {
    if (role === 'root') return scale * (dims.cephalothoraxHalf?.[0] || 0.13) * 0.45
    if (role === 'abdomen') return scale * (dims.abdomenHalf?.[0] || 0.15) * 0.45
    if (role === 'eyes') return scale * 0.035
    return scale * (dims.legRadius || 0.012)
  }
  if (role === 'root' || role === 'chest' || role === 'spine') return scale * (dims.bodyRadiusX || 0.10) * 0.55
  if (role === 'head') return scale * (dims.headHalf?.[0] || 0.08) * 0.55
  if (role === 'paw') return scale * (dims.pawHalf?.[0] || 0.04) * 0.45
  if (role === 'tail') return scale * (dims.tailRadius || 0.02)
  return scale * (dims.lowerLegRadius || 0.02)
}

export function stepAnimalActiveBody(entry, dt, groundY = 0, sensors = null) {
  const ragdoll = entry?.ragdoll
  const root = ragdoll?.bones?.[0]?.particle
  const skeleton = entry?.animalSkeleton
  if (!ragdoll || !root || !skeleton?.bones?.length) return
  entry._ageFrames = (entry._ageFrames ?? 0) + 1
  const motion = resolveAnimalMotion(entry, root)
  entry.animalMotionTrace = motion
  entry.navState.facing = slewRadians(entry.navState.facing ?? 0, motion.facing, dt * 6)
  entry.navState.facingTarget = motion.facing
  entry.navState.speed = motion.speed
  entry.navState.velocity = [root.vx || 0, root.vz || 0]
  entry.navState.walkPhase = normalizeRadians((entry.navState.walkPhase || 0) + animalGaitPhaseAdvance(entry, motion, dt))
  entry.state = motion.speed > 0.05 ? 'locomotion' : 'idle'

  applyAnimalPoseDrive(entry, dt, groundY, motion)
  if (entry.neuralMotor) applyNeuroJerks(ragdoll, entry.neuralMotor, (entry._ageFrames ?? 0) * dt, dt)
  ragdoll.solver.damping = motion.speed > 0.05 ? 0.986 : 0.94
  ragdoll.solver.gravity = [0, -9.8, 0]
  ragdoll.solver.step(dt)
  for (let pass = 0; pass < animalStructuralPasses(entry); pass++) {
    applyHingeLimits(entry.hingeLimits)
  }
  enforceAnimalGroundContact(entry, groundY, dt, sensors)
  enforceAnimalPlantedFootContacts(entry, groundY, dt, sensors, motion)
  applyAnimalWrongWayBrake(entry, dt, motion)
  applyAnimalNoIntentSettleBrake(entry, dt, motion)
  clampAnimalBoneVelocities(entry, dt)
  const rootAfter = ragdoll.bones[0]?.particle
  if (rootAfter) {
    entry.anchorPosition = [rootAfter.x, groundY, rootAfter.z]
    entry.navState.velocity = [rootAfter.vx || 0, rootAfter.vz || 0]
    entry.navState.speed = Math.hypot(rootAfter.vx || 0, rootAfter.vz || 0)
  }
  entry.contactTelemetry = buildContactTelemetry(entry, groundY, sensors)
  const balance = computeAnimalBalance(entry, groundY)
  entry.balanceError = balance.error
  entry.groundedFeet = balance.groundedFeet
  entry.balanceState = makeBalanceState(entry, balance)
}

export function resolveAnimalMotion(entry, root) {
  const intent = entry.intent || { type: 'stand' }
  let dx = Number(intent.targetDirX) || 0
  let dz = Number(intent.targetDirZ) || 0
  let targetDistance = Infinity
  if (Array.isArray(intent.waypoint)) {
    dx = intent.waypoint[0] - root.x
    dz = intent.waypoint[1] - root.z
    targetDistance = Math.hypot(dx, dz)
  }
  const len = Math.hypot(dx, dz)
  const moving = intent.type === 'walk' && len > 0.04 && targetDistance > 0.18
  const nx = moving ? dx / len : Math.sin(entry.navState?.facing ?? 0)
  const nz = moving ? dz / len : Math.cos(entry.navState?.facing ?? 0)
  const maxSpeed = entry.animalSkeleton?.bodyType === 'arachnid' ? 0.75 : 1.35
  const requestedSpeed = Number.isFinite(intent.desiredSpeed) ? intent.desiredSpeed : maxSpeed
  const motorAuthority = Math.max(0, Math.min(1, entry.nervousSystem?.motor?.authority ?? 1))
  const facing = moving ? Math.atan2(nx, nz) : (entry.navState?.facingTarget ?? entry.navState?.facing ?? 0)
  const currentFacing = entry.navState?.facing ?? facing
  const turnDelta = signedAngularDelta(facing, currentFacing)
  const turnAlignment = Math.max(-1, Math.min(1, Math.cos(turnDelta)))
  const lookThenMoveScale = moving ? Math.max(0, Math.min(1, (turnAlignment - 0.15) / 0.85)) : 0
  const desiredSpeed = moving ? Math.min(maxSpeed, Math.max(0, requestedSpeed)) * motorAuthority : 0
  const speed = desiredSpeed * lookThenMoveScale
  return {
    vx: nx * speed,
    vz: nz * speed,
    speed,
    desiredSpeed,
    facing,
    targetDistance,
    turnAlignment,
    pathSource: Array.isArray(intent.waypoint) ? 'waypoint' : (Number(intent.targetDirX) || Number(intent.targetDirZ) ? 'targetDir' : 'none'),
  }
}

export function animalGaitPhaseAdvance(entry, motion, dt) {
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  const cadence = bodyType === 'arachnid' ? 23 : (bodyType === 'small_quadruped' ? 13.5 : 11.5)
  return animalGaitDriveSpeed(entry, motion) * Math.max(0, dt || 0) * cadence
}

export function animalGaitDriveSpeed(entry, motion) {
  const desired = Math.max(0, motion?.desiredSpeed || 0)
  const planned = Math.max(0, motion?.speed || 0)
  if ((motion?.pathSource || 'none') === 'none') return planned
  return Math.max(planned, desired * 0.72)
}

export function animalIntendedSpeedScale(entry, motion) {
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  const maxSpeed = bodyType === 'arachnid' ? 0.75 : 1.35
  return Math.max(0, Math.min(1.4, animalGaitDriveSpeed(entry, motion) / Math.max(0.001, maxSpeed)))
}

export function animalMotionForwardVector(entry, motion) {
  const speed = Math.hypot(motion?.vx || 0, motion?.vz || 0)
  if (speed > 0.001) return [(motion.vx || 0) / speed, (motion.vz || 0) / speed]
  const yaw = Number.isFinite(motion?.facing) ? motion.facing : (entry?.navState?.facing ?? 0)
  return [Math.sin(yaw), Math.cos(yaw)]
}

export function animalRootForwardVelocityDot(entry, motion) {
  const root = entry?.ragdoll?.bones?.[0]?.particle
  if (!root) return 0
  const [fwdX, fwdZ] = animalMotionForwardVector(entry, motion)
  return (root.vx || 0) * fwdX + (root.vz || 0) * fwdZ
}

export function animalShouldReplantLegsForDirection(entry, motion, moving) {
  const state = entry?.animalLegState
  if (!state) return false
  const facing = Number.isFinite(motion?.facing) ? motion.facing : (entry?.navState?.facing ?? 0)
  if (!moving || (motion?.pathSource || 'none') === 'none') {
    state._lastMoveFacing = facing
    entry.animalReplantTrace = { replant: false, headingDelta: 0, wrongWayDot: 0 }
    return false
  }
  const previousFacing = Number.isFinite(state._lastMoveFacing) ? state._lastMoveFacing : facing
  const headingDelta = signedAngularDelta(facing, previousFacing)
  const wrongWayDot = animalRootForwardVelocityDot(entry, motion)
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  const headingLimit = bodyType === 'arachnid' ? 0.95 : 0.58
  const frame = entry?._ageFrames ?? 0
  const cooldownReady = frame - (state._lastDirectionReplantFrame ?? -999) > 10
  const replant = cooldownReady && (Math.abs(headingDelta) > headingLimit || wrongWayDot < -0.12)
  state._lastMoveFacing = facing
  if (replant) state._lastDirectionReplantFrame = frame
  entry.animalReplantTrace = { replant, headingDelta, wrongWayDot }
  return replant
}

export function isAnimalDebugTarget(entry) {
  return entry?.bodyKind === 'animal' && ANIMAL_DEBUG_ENTITY_IDS.has(entry.entityId)
}

export function logAnimalActiveBodyTrace(entry, frame, groundY = 0) {
  const ragdoll = entry?.ragdoll
  const root = ragdoll?.bones?.[0]?.particle
  if (!root) return
  const profile = entry.animalSkeleton?.profileId || entry.animalSkeleton?.bodyType || 'animal'
  const contact = entry.contactTelemetry?.summary || {}
  const axis = animalDebugBodyAxis(entry)
  const worst = animalDebugWorstBoneSpeed(entry)
  const rootSpeed = Math.hypot(root.vx || 0, root.vy || 0, root.vz || 0)
  const facingDeg = radiansToDebugDegrees(entry.navState?.facing ?? 0)
  const targetDeg = entry.navState?.facingTarget == null ? '—' : radiansToDebugDegrees(entry.navState.facingTarget)
  const bodyDeg = axis ? radiansToDebugDegrees(axis.yaw) : '—'
  const yawDelta = axis ? signedAnimalYawDeltaDegrees(axis.yaw, entry.navState?.facing ?? 0) : '—'
  const stanceY = animalRootTargetY(entry, groundY) - groundY
  const motion = entry.animalMotionTrace || {}
  console.log(
    `[ANIMAL-TRACE] frame=${frame} ${entry.entityId} profile=${profile} state=${entry.state} intent=${entry.intent?.type || 'stand'} ` +
    `root=(${root.x.toFixed(2)},${root.y.toFixed(2)},${root.z.toFixed(2)}) rootY=${(root.y - groundY).toFixed(2)} stanceY=${stanceY.toFixed(2)} v=${rootSpeed.toFixed(2)} ` +
    `speed=${(entry.navState?.speed || 0).toFixed(2)} desired=${Number(motion.desiredSpeed || 0).toFixed(2)} src=${motion.pathSource || 'none'} align=${Number(motion.turnAlignment ?? 1).toFixed(2)} facing=${facingDeg}° target=${targetDeg}° body=${bodyDeg}° yawΔ=${yawDelta}° ` +
    `pitch=${axis ? axis.pitchDeg.toFixed(1) : '—'}° dir=${formatAnimalDirectionDebug(entry)} balance=${(entry.balanceError || 0).toFixed(3)} grounded=${entry.groundedFeet || 0} ` +
    `contacts=${contact.contactCount ?? 0} support=${contact.supportQuality ?? 0} drive=stance-legs rootDrive=vertical-posture velDrive=off brace=${entry.hingeLimits?.length || 0} nn=${formatAnimalNeuralDebug(entry)} worst=${worst} tail=${formatAnimalTailDebug(entry, groundY)} legs=${formatAnimalLegDebug(entry, groundY)}`
  )
}

export function animalDebugBodyAxis(entry) {
  const boneMap = entry?.ragdoll?.boneMap
  const root = entry?.ragdoll?.bones?.[0]?.particle
  if (!boneMap || !root) return null
  const frontBone = entry.animalSkeleton?.bodyType === 'arachnid'
    ? (boneMap.get('ocularPlate') || boneMap.get('leftPedipalpBase') || boneMap.get('rightPedipalpBase'))
    : (boneMap.get('chest') || boneMap.get('neck') || boneMap.get('head'))
  const front = frontBone?.particle
  if (!front) return null
  const dx = front.x - root.x
  const dy = front.y - root.y
  const dz = front.z - root.z
  const flat = Math.hypot(dx, dz)
  if (flat < 0.01) return null
  return {
    yaw: Math.atan2(dx, dz),
    pitchDeg: Math.atan2(dy, flat) * 180 / Math.PI,
  }
}

export function animalDebugWorstBoneSpeed(entry) {
  let worstName = 'none'
  let worstSpeed = 0
  for (const bone of entry?.ragdoll?.bones || []) {
    const p = bone?.particle
    if (!p) continue
    const speed = Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0)
    if (speed > worstSpeed) {
      worstSpeed = speed
      worstName = bone.name || `bone${bone.id}`
    }
  }
  return `${worstName}:${worstSpeed.toFixed(2)}`
}

export function formatAnimalNeuralDebug(entry) {
  const trace = entry?.animalNeuralTrace
  if (!trace?.enabled) return 'off'
  return `${trace.tier || 'nn'} w${Number(trace.weight || 0).toFixed(2)} loss${Number(trace.loss || 0).toFixed(3)} rms${Number(trace.rms || 0).toFixed(3)} ${trace.stable ? 'stable' : 'skip'}`
}

export function formatAnimalDirectionDebug(entry) {
  const diagnostics = buildDirectionDiagnostics(entry)
  const replant = entry?.animalReplantTrace
  const dot = diagnostics?.dots?.intentVelocity
  const pDot = diagnostics?.dots?.intentParticleVelocity
  const parts = [
    diagnostics?.status || 'none',
    `d${dot == null ? '—' : Number(dot).toFixed(2)}`,
    `p${pDot == null ? '—' : Number(pDot).toFixed(2)}`,
  ]
  if (replant?.replant) parts.push('replant')
  if (Number.isFinite(replant?.headingDelta)) parts.push(`turn${(Math.abs(replant.headingDelta) * 180 / Math.PI).toFixed(0)}°`)
  if (Number.isFinite(replant?.wrongWayDot)) parts.push(`back${replant.wrongWayDot.toFixed(2)}`)
  return parts.join('/')
}

export function formatAnimalLegDebug(entry, groundY = 0) {
  const descriptors = Array.isArray(entry?.universalLegDescriptors) ? entry.universalLegDescriptors : []
  if (descriptors.length === 0) return 'none'
  const motion = entry?.animalMotionTrace || null
  const speedScale = motion ? animalIntendedSpeedScale(entry, motion) : Math.max(0, Math.min(1.4, (entry.navState?.speed || 0) / (entry.animalSkeleton?.bodyType === 'arachnid' ? 0.75 : 1.35)))
  const moving = motion ? animalGaitDriveSpeed(entry, motion) > 0.05 : (entry.navState?.speed || 0) > 0.05
  return descriptors.map(descriptor => {
    const bone = entry.ragdoll?.boneMap?.get(descriptor.footBone)
    const p = bone?.particle
    const phase = animalLegPhase(entry, descriptor, descriptors.length, speedScale)
    const duty = animalDutyFactor(entry, descriptors.length, speedScale)
    const swing = moving && phase >= duty
    const record = entry.contactTelemetry?.byBone?.[descriptor.footBone]
    const state = entry.animalLegState?.[descriptor.id]
    const drift = p && Array.isArray(state?.plant) ? Math.hypot(p.x - state.plant[0], p.z - state.plant[2]) : null
    const y = p ? (p.y - groundY).toFixed(2) : '—'
    const slip = record ? record.slipSpeed : 0
    const trust = record ? record.stanceTrust : 0
    return `${animalLegDebugLabel(descriptor)}:${swing ? 'sw' : 'st'}@${phase.toFixed(2)} ${record?.contact ? 'on' : 'off'} y${y} slip${Number(slip || 0).toFixed(2)} trust${Number(trust || 0).toFixed(2)}${drift == null ? '' : ` drift${drift.toFixed(2)}`}`
  }).join(' | ')
}

export function formatAnimalTailDebug(entry, groundY = 0) {
  const tailBones = Array.isArray(entry?.animalSkeleton?.tailBones) ? entry.animalSkeleton.tailBones : []
  if (tailBones.length === 0) return 'none'
  const affect = entry.animalTailState?.affect
  const tip = entry.ragdoll?.boneMap?.get(tailBones[tailBones.length - 1])?.particle
  const y = tip ? (tip.y - groundY).toFixed(2) : '—'
  if (!affect) return `idle y${y}`
  return `v${affect.valence.toFixed(2)} ar${affect.arousal.toFixed(2)} wag${affect.wag.toFixed(2)} tuck${affect.tuck.toFixed(2)} y${y}`
}

export function animalLegDebugLabel(descriptor) {
  const id = descriptor?.id || descriptor?.footBone || 'leg'
  if (/leftFore/i.test(id)) return 'LF'
  if (/rightFore/i.test(id)) return 'RF'
  if (/leftHind/i.test(id)) return 'LH'
  if (/rightHind/i.test(id)) return 'RH'
  const spider = id.match(/^(left|right)Leg(\d+)/i)
  if (spider) return `${spider[1][0].toUpperCase()}${spider[2]}`
  return id
}

export function signedAnimalYawDeltaDegrees(a, b) {
  return (signedAngularDelta(a, b) * 180 / Math.PI).toFixed(1)
}

export function applyAnimalPoseDrive(entry, dt, groundY, motion) {
  const ragdoll = entry.ragdoll
  const skeleton = entry.animalSkeleton
  const root = ragdoll.bones[0]?.particle
  if (!root) return
  const rootLocal = skeleton.bones[0]?.local || [0, 0, 0]
  const yaw = entry.navState?.facing ?? 0
  const motorAuthority = Math.max(0, Math.min(1, entry.nervousSystem?.motor?.authority ?? 1))
  const driveScale = (ragdoll.state === RagdollState.RAGDOLL ? 0.35 : 1) * motorAuthority
  const rightX = Math.cos(yaw)
  const rightZ = -Math.sin(yaw)
  const fwdX = Math.sin(yaw)
  const fwdZ = Math.cos(yaw)
  const basis = { rightX, rightZ, fwdX, fwdZ }
  const bodyRoot = animalSupportRoot(entry, root, groundY, motion, basis)
  const legTargets = computeAnimalLegTargets(entry, root, rootLocal, groundY, motion, basis)
  const tailTargets = computeAnimalTailTargets(entry, root, rootLocal, groundY, motion, basis, dt)
  applyAnimalNeuralMotor(entry, legTargets, tailTargets, motion, groundY, dt)
  for (const runtime of ragdoll.bones) {
    const p = runtime?.particle
    const source = runtime?.source
    if (!p || !source?.local) continue
    const dx = (source.local[0] - rootLocal[0]) * entry.scale
    const dy = (source.local[1] - rootLocal[1]) * animalPoseVerticalScale(entry)
    const dz = (source.local[2] - rootLocal[2]) * entry.scale
    const legTarget = legTargets.get(runtime.name)
    const tailTarget = tailTargets.get(runtime.name)
    const poseTarget = tailTarget || legTarget
    const role = source.role || ''
    const postureOffset = poseTarget ? null : animalBodyPostureOffset(entry, role, basis)
    const tx = poseTarget ? poseTarget[0] : bodyRoot.x + dx * rightX + dz * fwdX + postureOffset[0]
    const ty = poseTarget ? poseTarget[1] : bodyRoot.y + dy + postureOffset[1]
    const tz = poseTarget ? poseTarget[2] : bodyRoot.z + dx * rightZ + dz * fwdZ + postureOffset[2]
    const legInfo = legTargets._info?.get?.(runtime.name) || tailTargets._info?.get?.(runtime.name)
    const defaultGains = animalPoseDriveGains(role, runtime.id, skeleton.bodyType)
    const stiffness = legInfo?.stiffness ?? defaultGains.stiffness
    const damping = legInfo?.damping ?? defaultGains.damping
    const rootDrive = runtime.id === 0 || role === 'root'
    const horizontalWeight = rootDrive ? 0 : 1
    const verticalWeight = rootDrive ? animalRootVerticalDriveWeight(entry) : (legInfo ? 1 : defaultGains.verticalWeight)
    const targetVx = legInfo?.planted ? 0 : (p.vx || 0)
    const targetVz = legInfo?.planted ? 0 : (p.vz || 0)
    p.vx += ((tx - p.x) * stiffness + (targetVx - (p.vx || 0)) * damping) * dt * driveScale * horizontalWeight
    p.vy += ((ty - p.y) * stiffness + (0 - (p.vy || 0)) * damping) * dt * driveScale * verticalWeight
    p.vz += ((tz - p.z) * stiffness + (targetVz - (p.vz || 0)) * damping) * dt * driveScale * horizontalWeight
  }
}

export function computeAnimalLegTargets(entry, root, rootLocal, groundY, motion, basis) {
  const targets = new Map()
  const info = new Map()
  targets._info = info
  const descriptors = Array.isArray(entry.universalLegDescriptors) ? entry.universalLegDescriptors : []
  if (descriptors.length === 0) return targets
  if (!entry.animalLegState) entry.animalLegState = Object.create(null)
  const moving = animalGaitDriveSpeed(entry, motion) > 0.05
  const speedScale = animalIntendedSpeedScale(entry, motion)
  const verticalScale = animalPoseVerticalScale(entry)
  const supportRoot = animalSupportRoot(entry, root, groundY, motion, basis)
  const replantForDirection = animalShouldReplantLegsForDirection(entry, motion, moving)
  for (const descriptor of descriptors) {
    const phase = moving ? animalLegPhase(entry, descriptor, descriptors.length, speedScale) : 0
    const duty = animalDutyFactor(entry, descriptors.length, speedScale)
    const swing = moving && phase >= duty
    const standing = !moving
    const state = entry.animalLegState[descriptor.id] || (entry.animalLegState[descriptor.id] = {})
    if (replantForDirection) {
      delete state.plant
      state.swing = null
    }
    const footBone = entry.ragdoll?.boneMap?.get(descriptor.footBone)
    const footLocal = footBone?.source?.local
    if (!footBone?.particle || !footLocal) continue
    const footRest = animalRestWorld(supportRoot, rootLocal, footLocal, entry.scale, basis, verticalScale)
    if (!state.plant || standing || swing !== state.swing) {
      state.plant = standing
        ? [footRest[0], groundY, footRest[2]]
        : [footBone.particle.x - basis.fwdX * animalStanceRollback(entry, speedScale), groundY, footBone.particle.z - basis.fwdZ * animalStanceRollback(entry, speedScale)]
      state.swing = swing
    }
    if (!swing) {
      const maxDrift = 0.16 * entry.scale + speedScale * 0.08
      const drift = Math.hypot((state.plant[0] || 0) - footRest[0], (state.plant[2] || 0) - footRest[2])
      if (drift > maxDrift) state.plant = [
        footRest[0] - (moving ? basis.fwdX * animalStanceRollback(entry, speedScale) : 0),
        groundY,
        footRest[2] - (moving ? basis.fwdZ * animalStanceRollback(entry, speedScale) : 0),
      ]
    }
    const lift = swing ? Math.sin(((phase - duty) / Math.max(0.001, 1 - duty)) * Math.PI) : 0
    const stride = moving ? animalStrideLength(entry, speedScale) : 0
    const liftHeight = animalSwingLiftHeight(entry)
    const swingAhead = swing ? (phase - duty) / Math.max(0.001, 1 - duty) : 0
    const lateralSweep = swing ? animalSwingLateralSweep(entry, descriptor, lift, swingAhead) : 0
    const footTarget = swing
      ? [
          footRest[0] + basis.fwdX * stride * (swingAhead - 0.35) + basis.rightX * lateralSweep,
          groundY + lift * liftHeight,
          footRest[2] + basis.fwdZ * stride * (swingAhead - 0.35) + basis.rightZ * lateralSweep,
        ]
      : (standing ? [footRest[0], groundY, footRest[2]] : state.plant)
    targets.set(descriptor.footBone, footTarget)
    info.set(descriptor.footBone, { planted: !swing, stiffness: swing ? 72 : (standing ? 190 : 155), damping: swing ? 8.8 : (standing ? 24 : 21) })
    applyAnimalLegChainTargets(entry, targets, info, descriptor, supportRoot, rootLocal, footTarget, lift, swing, basis)
  }
  return targets
}

export function applyAnimalNeuralMotor(entry, legTargets, tailTargets, motion, groundY, dt) {
  const motor = entry?.neuralMotor
  const ragdoll = entry?.ragdoll
  if (!motor || !ragdoll?.boneMap) {
    entry.animalNeuralTrace = { enabled: false }
    return
  }
  const bonesByName = animalNeuralBonesByName(entry)
  const pelvis = bonesByName.pelvis?.particle
  if (!pelvis) {
    entry.animalNeuralTrace = { enabled: false }
    return
  }
  const targetV = 50
  const currentV = animalBodyVerticality(entry, groundY)
  const intent = {
    ...(entry.intent || {}),
    type: motion?.speed > 0.05 ? 'walk' : 'stand',
    targetVerticality: targetV,
    targetDirX: motion?.speed > 0.05 ? (motion.vx || 0) / Math.max(0.001, motion.speed || 0) : (entry.intent?.targetDirX || 0),
    targetDirZ: motion?.speed > 0.05 ? (motion.vz || 0) / Math.max(0.001, motion.speed || 0) : (entry.intent?.targetDirZ || 0),
    desiredSpeed: entry.intent?.desiredSpeed ?? motion?.speed ?? 0,
  }
  const targets = animalNeuralTargetAliases(entry, legTargets, tailTargets)
  const sensors = {
    heightAt: entry._frameSensors?.heightAt,
    nearestAgent: entry._frameSensors?.nearestAgent,
    contactTelemetry: entry.contactTelemetry,
    balanceState: entry.balanceState,
  }
  const obs = buildObservation(ragdoll, bonesByName, currentV, targetV, intent, entry.rhythms, sensors)
  const teacher = computeTeacherSignal(targets, ragdoll, bonesByName, 0.10)
  const core = [
    bonesByName.pelvis?.particle,
    bonesByName.chest?.particle,
    bonesByName.head?.particle,
  ]
  let coreV = 0
  for (const p of core) if (p) coreV += Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0)
  const stable = coreV < 18 && (entry.groundedFeet || 0) > 0 && (entry.balanceError ?? 0) < 0.45
  const reward = animalNeuralReward(entry, motion, currentV, targetV, coreV)
  trainNeuralMotor(motor, obs, teacher, reward, { stable, lr: 0.0012 })
  const offsets = neuralMotorForward(motor, obs, (entry._ageFrames ?? 0) * Math.max(0, dt || 0), { explorationScale: 0 })
  const cap = animalNeuralTierCap(motor.tier)
  const trustFromLoss = Math.max(0, Math.min(1, (0.28 - motor.lossEMA) / 0.26))
  const warmup = Math.max(0, Math.min(1, (motor.framesTrained || 0) / 120))
  const weight = Math.min(cap, trustFromLoss) * warmup * (stable ? 1 : 0.15)
  const rms = applyAnimalNeuralLegOffsets(entry, legTargets, offsets, weight)
  entry.animalNeuralTrace = {
    enabled: true,
    tier: motor.tier,
    loss: motor.lossEMA,
    weight,
    rms,
    stable,
  }
}

export function animalNeuralTierCap(tier) {
  if (tier === 'newborn') return 0.04
  if (tier === 'micro') return 0.06
  if (tier === 'tiny') return 0.08
  if (tier === 'small') return 0.12
  return 0.16
}

export function animalBodyVerticality(entry, groundY = 0) {
  const root = entry?.ragdoll?.bones?.[0]?.particle
  const target = Math.max(0.001, animalRootTargetY(entry, groundY) - groundY)
  return root ? Math.max(0, Math.min(50, (root.y - groundY) / target * 50)) : 0
}

export function animalNeuralReward(entry, motion, currentV, targetV, coreV) {
  const vertical = Math.exp(-Math.abs(targetV - currentV) / 18)
  const stable = Math.exp(-coreV * 0.35)
  const support = Math.max(0, Math.min(1, entry.contactTelemetry?.summary?.supportQuality ?? 0))
  const balance = Math.max(0, Math.min(1, 1 - (entry.balanceError ?? 1) / 0.45))
  const speed = Math.hypot(entry.ragdoll?.bones?.[0]?.particle?.vx || 0, entry.ragdoll?.bones?.[0]?.particle?.vz || 0)
  const desired = motion?.speed || 0
  const speedMatch = desired > 0.05 ? Math.exp(-Math.abs(speed - desired) * 0.9) : Math.exp(-speed * 1.4)
  return 1.2 * vertical + 1.0 * stable + 0.9 * support + 0.7 * balance + 0.7 * speedMatch
}

export function animalNeuralBonesByName(entry) {
  const map = entry?.ragdoll?.boneMap
  const descriptors = Array.isArray(entry?.universalLegDescriptors) ? entry.universalLegDescriptors : []
  const firstBySide = (side) => descriptors.find(descriptor => descriptor.side === side) || descriptors.find(descriptor => String(descriptor.id || '').toLowerCase().includes(side))
  const chainBone = (descriptor, index, fallback) => {
    const chain = Array.isArray(descriptor?.segmentBones) ? descriptor.segmentBones : [descriptor?.rootBone, descriptor?.midBone, descriptor?.footBone].filter(Boolean)
    return map?.get(chain[Math.min(index, Math.max(0, chain.length - 1))] || fallback)
  }
  const left = firstBySide('left')
  const right = firstBySide('right')
  const root = entry?.ragdoll?.bones?.[0]
  return {
    pelvis: root,
    spine: map?.get('lumbar') || map?.get('abdomen') || root,
    spine1: map?.get('chest') || map?.get('abdomen') || root,
    chest: map?.get('chest') || map?.get('ocularPlate') || map?.get('abdomen') || root,
    neck: map?.get('neck') || map?.get('ocularPlate') || map?.get('head') || root,
    head: map?.get('head') || map?.get('ocularPlate') || map?.get('snout') || root,
    leftShoulder: map?.get(left?.rootBone) || chainBone(left, 0),
    rightShoulder: map?.get(right?.rootBone) || chainBone(right, 0),
    leftUpperArm: chainBone(left, 0),
    rightUpperArm: chainBone(right, 0),
    leftForearm: chainBone(left, 1),
    rightForearm: chainBone(right, 1),
    leftHand: map?.get(left?.footBone) || chainBone(left, 2),
    rightHand: map?.get(right?.footBone) || chainBone(right, 2),
    leftThigh: chainBone(left, 0),
    rightThigh: chainBone(right, 0),
    leftShin: chainBone(left, 1),
    rightShin: chainBone(right, 1),
    leftFoot: map?.get(left?.footBone) || chainBone(left, 2),
    rightFoot: map?.get(right?.footBone) || chainBone(right, 2),
  }
}

export function animalNeuralTargetAliases(entry, legTargets, tailTargets) {
  const descriptors = Array.isArray(entry?.universalLegDescriptors) ? entry.universalLegDescriptors : []
  const firstBySide = (side) => descriptors.find(descriptor => descriptor.side === side) || descriptors.find(descriptor => String(descriptor.id || '').toLowerCase().includes(side))
  const targetFor = (boneId) => boneId ? (legTargets.get(boneId) || tailTargets.get(boneId)) : null
  const chainTarget = (descriptor, index) => {
    const chain = Array.isArray(descriptor?.segmentBones) ? descriptor.segmentBones : [descriptor?.rootBone, descriptor?.midBone, descriptor?.footBone].filter(Boolean)
    return targetFor(chain[Math.min(index, Math.max(0, chain.length - 1))])
  }
  const left = firstBySide('left')
  const right = firstBySide('right')
  return {
    pelvis: targetFor(entry?.ragdoll?.bones?.[0]?.name),
    spine: targetFor('lumbar') || targetFor('abdomen'),
    spine1: targetFor('chest') || targetFor('abdomen'),
    chest: targetFor('chest') || targetFor('ocularPlate') || targetFor('abdomen'),
    neck: targetFor('neck') || targetFor('ocularPlate'),
    head: targetFor('head') || targetFor('ocularPlate'),
    leftThigh: chainTarget(left, 0),
    rightThigh: chainTarget(right, 0),
    leftShin: chainTarget(left, 1),
    rightShin: chainTarget(right, 1),
    leftFoot: targetFor(left?.footBone),
    rightFoot: targetFor(right?.footBone),
  }
}

export function applyAnimalNeuralLegOffsets(entry, legTargets, offsets, weight) {
  if (!(weight > 0) || !offsets) return 0
  let sumSq = 0
  let count = 0
  for (const descriptor of entry?.universalLegDescriptors || []) {
    const sidePrefix = descriptor.side === 'right' || String(descriptor.id || '').toLowerCase().startsWith('right') ? 'right' : 'left'
    const chain = Array.isArray(descriptor.segmentBones) && descriptor.segmentBones.length > 0
      ? descriptor.segmentBones
      : [descriptor.rootBone, descriptor.midBone, descriptor.footBone].filter(Boolean)
    for (let i = 0; i < chain.length; i++) {
      const boneId = chain[i]
      const target = legTargets.get(boneId)
      if (!target) continue
      const t = chain.length <= 1 ? 1 : i / (chain.length - 1)
      const alias = t < 0.34 ? `${sidePrefix}Thigh` : (t < 0.72 ? `${sidePrefix}Shin` : `${sidePrefix}Foot`)
      const info = legTargets._info?.get?.(boneId)
      const footPlanted = info?.planted && i === chain.length - 1
      const scale = animalNeuralOffsetScale(entry, footPlanted)
      const applied = addAnimalNeuralOffset(target, offsets, alias, weight * scale, footPlanted)
      sumSq += applied * applied
      count++
    }
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0
}

export function animalNeuralOffsetScale(entry, footPlanted) {
  const base = entry?.animalSkeleton?.bodyType === 'arachnid' ? 0.32 : 0.42
  return footPlanted ? base * 0.18 : base
}

export function addAnimalNeuralOffset(target, offsets, alias, weight, footPlanted) {
  const index = BONE_ORDER.indexOf(alias)
  if (index < 0) return 0
  const base = index * 3
  const dx = (offsets[base] || 0) * weight
  const dy = (offsets[base + 1] || 0) * weight * (footPlanted ? 0.15 : 0.7)
  const dz = (offsets[base + 2] || 0) * weight
  if (!footPlanted) {
    target[0] += dx
    target[2] += dz
  }
  target[1] += dy
  return Math.hypot(dx, dy, dz)
}

export function computeAnimalTailTargets(entry, root, rootLocal, groundY, motion, basis, dt) {
  const targets = new Map()
  const info = new Map()
  targets._info = info
  const tailBones = Array.isArray(entry?.animalSkeleton?.tailBones) ? entry.animalSkeleton.tailBones : []
  if (tailBones.length === 0) return targets
  if (!entry.animalTailState) entry.animalTailState = Object.create(null)
  const affect = resolveAnimalTailAffect(entry, motion)
  const rootPose = { x: root.x, y: animalRootTargetY(entry, groundY), z: root.z }
  const state = entry.animalTailState
  if (!Number.isFinite(state.phase)) state.phase = typeof entry.neuralMotor?.rng === 'function' ? entry.neuralMotor.rng() * Math.PI * 2 : 0
  const wagHz = affect.species === 'cat'
    ? 0.55 + affect.flick * 1.8 + affect.arousal * 0.55
    : 0.85 + affect.wag * 3.2 + affect.arousal * 0.75
  state.phase = normalizeRadians(state.phase + Math.max(0, dt || 0) * Math.PI * 2 * wagHz)
  state.affect = affect
  const carry = animalTailCarryProfile(affect.species)
  const tailScale = animalTailDriveScale(entry)
  const countDenom = Math.max(1, tailBones.length - 1)
  for (let i = 0; i < tailBones.length; i++) {
    const id = tailBones[i]
    const bone = entry.ragdoll?.boneMap?.get(id)
    const local = bone?.source?.local
    if (!local) continue
    const rest = animalRestWorld(rootPose, rootLocal, local, entry.scale, basis, animalPoseVerticalScale(entry))
    const t = tailBones.length === 1 ? 1 : i / countDenom
    const response = 0.25 + t * 0.75
    const wag = Math.sin(state.phase + t * 1.35)
    const flick = Math.sin(state.phase * 2.35 + t * 2.1)
    const side = (wag * Math.max(affect.wag, carry.minWag) + flick * Math.max(affect.flick, carry.minFlick)) * tailScale * response
    const lift = (affect.lift + carry.lift - affect.tuck * carry.tuckLiftLoss) * tailScale * response
    const tuck = affect.tuck * carry.tuckForward * tailScale * response
    const carryBack = (carry.back + affect.stiff * 0.030) * tailScale * response
    targets.set(id, [
      rest[0] + basis.rightX * side + basis.fwdX * (tuck - carryBack),
      Math.max(groundY + carry.minHeight * tailScale, rest[1] + lift),
      rest[2] + basis.rightZ * side + basis.fwdZ * (tuck - carryBack),
    ])
    info.set(id, { planted: false, stiffness: carry.stiffness + affect.stiff * 18 + affect.arousal * 10, damping: carry.damping + affect.stiff * 3.2 })
  }
  return targets
}

export function resolveAnimalTailAffect(entry, motion) {
  const packet = entry?.intent?.animalAffect || entry?.intentMetadata?.animalAffect || {}
  const mood = packet.mood || {}
  const emotions = packet.emotions || {}
  const needs = packet.needs || {}
  const drives = packet.brainDrives || {}
  const species = animalTailSpecies(entry, packet)
  const joy = Math.max(unitSignal(emotions.joy), percentSignal(mood.joy), percentSignal(mood.hope) * 0.45)
  const trust = Math.max(unitSignal(emotions.trust), percentSignal(mood.loyalty), percentSignal(mood.morale) * 0.35, unitSignal(drives.follow) * 0.16, unitSignal(drives.protect) * 0.12)
  const fear = Math.max(unitSignal(emotions.fear), percentSignal(mood.fear), 1 - unitSignalDefault(needs.safety, 1), unitSignal(drives.flee) * 0.14)
  const anger = Math.max(unitSignal(emotions.anger), percentSignal(mood.anger), percentSignal(mood.resentment) * 0.75, unitSignal(drives.fight) * 0.12)
  const sadness = Math.max(unitSignal(emotions.sadness), percentSignal(mood.grief), Math.max(0, 0.5 - percentSignal(mood.hope)) * 0.45)
  const curiosity = Math.max(unitSignal(emotions.anticipation), percentSignal(mood.curiosity), unitSignalDefault(needs.fun, 0) * 0.35)
  const hunger = Math.max(percentSignal(mood.hunger), 1 - unitSignalDefault(needs.hunger, 1))
  const fatigue = Math.max(percentSignal(mood.fatigue), 1 - unitSignalDefault(needs.energy, 1))
  const moodValence = Number.isFinite(emotions.mood) ? Math.max(-1, Math.min(1, emotions.mood)) : 0
  const positive = clamp01(joy * 0.52 + trust * 0.45 + curiosity * 0.18 + moodValence * 0.35)
  const threat = clamp01(fear * 0.72 + anger * 0.26 + hunger * 0.12 + fatigue * 0.08 + sadness * 0.12)
  const speed = Math.max(0, motion?.speed || entry?.navState?.speed || 0)
  const arousal = clamp01(Math.max(positive, fear, anger, curiosity * 0.82, speed / 2.6))
  const quadrupedTail = species === 'dog' || species === 'cat'
  const tuck = quadrupedTail
    ? clamp01(fear * 0.62 + anger * 0.10 + sadness * 0.08 - trust * 0.30 - joy * 0.24)
    : clamp01(fear * 0.76 + hunger * 0.22 + fatigue * 0.32 + sadness * 0.22 - trust * 0.20 - joy * 0.16)
  const liftBase = species === 'cat'
    ? 0.58 + trust * 0.24 + curiosity * 0.24 + joy * 0.16 + Math.min(0.16, speed * 0.10) - fear * 0.22 - fatigue * 0.04
    : 0.40 + joy * 0.24 + trust * 0.18 + curiosity * 0.08 + Math.min(0.16, speed * 0.10) - fear * 0.20 - fatigue * 0.04
  const wagBase = species === 'cat'
    ? Math.max(0.08, curiosity * 0.090 + joy * 0.060 + trust * 0.045 + Math.min(0.08, speed * 0.04) - fear * 0.035)
    : Math.max(0.18, joy * 0.25 + trust * 0.20 + positive * 0.16 + Math.min(0.14, speed * 0.06) - fear * 0.10 - fatigue * 0.025)
  const flickBase = species === 'cat'
    ? Math.max(0.10, curiosity * 0.080 + anger * 0.060 + fear * 0.025 + arousal * 0.030 - joy * 0.010)
    : Math.max(0, anger * 0.025 + curiosity * 0.020 + fear * 0.012)
  return {
    species,
    valence: clampSigned(positive - threat),
    arousal,
    tuck,
    lift: clampSigned(liftBase),
    wag: clamp01(wagBase),
    flick: clamp01(flickBase),
    stiff: clamp01(fear * 0.35 + anger * 0.45 + fatigue * 0.18),
    joy,
    trust,
    fear,
    hunger,
  }
}

export function animalTailSpecies(entry, packet = null) {
  const raw = String(packet?.species || entry?.brainProfile?.species || entry?.speciesId || entry?.species || entry?.animalSkeleton?.profileId || entry?.animalSkeleton?.bodyType || '').toLowerCase()
  if (raw.includes('cat') || raw.includes('feline') || raw.includes('small_quadruped')) return 'cat'
  if (raw.includes('dog') || raw.includes('canine') || raw.includes('wolf') || raw.includes('quadruped')) return 'dog'
  return raw || 'animal'
}

export function animalTailDriveScale(entry) {
  const scale = entry?.scale || 1
  if (entry?.animalSkeleton?.bodyType === 'small_quadruped') return Math.max(scale, 0.56)
  if (entry?.animalSkeleton?.bodyType === 'quadruped') return Math.max(scale, 0.72)
  return scale
}

export function animalTailCarryProfile(species) {
  if (species === 'cat') return {
    lift: 0.14,
    back: 0.045,
    minHeight: 0.17,
    minWag: 0.08,
    minFlick: 0.10,
    tuckLiftLoss: 0.08,
    tuckForward: 0.06,
    stiffness: 52,
    damping: 8.4,
  }
  if (species === 'dog') return {
    lift: 0.12,
    back: 0.085,
    minHeight: 0.13,
    minWag: 0.22,
    minFlick: 0.015,
    tuckLiftLoss: 0.10,
    tuckForward: 0.08,
    stiffness: 56,
    damping: 8.8,
  }
  return {
    lift: 0.02,
    back: 0.025,
    minHeight: 0.04,
    minWag: 0,
    minFlick: 0,
    tuckLiftLoss: 0.22,
    tuckForward: 1,
    stiffness: 24,
    damping: 4.2,
  }
}

export function animalRootTargetY(entry, groundY = 0) {
  const rootLocal = entry?.animalSkeleton?.bones?.[0]?.local
  const rootY = Array.isArray(rootLocal) ? rootLocal[1] || 0 : 0
  const footY = animalLowestSupportFootLocalY(entry)
  return groundY + Math.max(0.02, rootY - footY) * animalPoseVerticalScale(entry)
}

export function animalLowestSupportFootLocalY(entry) {
  let footY = Infinity
  const map = entry?.ragdoll?.boneMap
  for (const descriptor of entry?.universalLegDescriptors || []) {
    const local = map?.get(descriptor.footBone)?.source?.local
    if (Array.isArray(local)) footY = Math.min(footY, local[1] || 0)
  }
  return Number.isFinite(footY) ? footY : 0
}

export function animalSupportRoot(entry, root, groundY, motion, basis) {
  return {
    x: root.x,
    y: animalRootTargetY(entry, groundY),
    z: root.z,
  }
}

export function animalRootVerticalDriveWeight(entry) {
  return entry?.animalSkeleton?.bodyType === 'arachnid' ? 3.8 : 2.9
}

export function animalBodyPostureOffset(entry, role, basis) {
  if (entry?.animalSkeleton?.bodyType !== 'arachnid') return [0, 0, 0]
  const scale = Math.max(entry?.scale || 1, 0.65)
  if (role === 'eyes') return [(basis?.fwdX || 0) * 0.010 * scale, 0.028 * scale, (basis?.fwdZ || 0) * 0.010 * scale]
  if (role === 'pedipalp') return [(basis?.fwdX || 0) * 0.008 * scale, 0.020 * scale, (basis?.fwdZ || 0) * 0.008 * scale]
  if (role === 'abdomen') return [-(basis?.fwdX || 0) * 0.012 * scale, 0.025 * scale, -(basis?.fwdZ || 0) * 0.012 * scale]
  return [0, 0, 0]
}

export function animalStrideLength(entry, speedScale) {
  const scale = entry?.scale || 1
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  const driveScale = animalStrideDriveScale(entry)
  if (bodyType === 'arachnid') return (0.115 + speedScale * 0.095) * driveScale
  if (bodyType === 'small_quadruped') return (0.13 + speedScale * 0.075) * Math.max(scale, 0.42)
  return (0.16 + speedScale * 0.095) * scale
}

export function animalStrideDriveScale(entry) {
  const scale = entry?.scale || 1
  return entry?.animalSkeleton?.bodyType === 'arachnid' ? Math.max(scale, 0.62) : scale
}

export function animalSwingLateralSweep(entry, descriptor, lift, swingAhead) {
  const scale = entry?.scale || 1
  const sideSign = descriptor?.side === 'left' ? -1 : 1
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  const centered = (swingAhead - 0.5)
  if (bodyType === 'arachnid') return sideSign * (0.018 + lift * 0.018 - Math.abs(centered) * 0.010) * scale
  return sideSign * (0.006 + lift * 0.006) * scale
}

export function animalSwingLiftHeight(entry) {
  const scale = entry?.scale || 1
  return entry?.animalSkeleton?.bodyType === 'arachnid'
    ? Math.max(0.055, 0.10 * animalStrideDriveScale(entry))
    : Math.max(0.052, 0.115 * scale)
}

export function animalPoseDriveGains(role, id, bodyType) {
  if (role === 'root') return bodyType === 'arachnid'
    ? { stiffness: 360, damping: 26, verticalWeight: 3.8 }
    : { stiffness: 285, damping: 22, verticalWeight: 2.9 }
  if (role === 'chest' || role === 'spine' || role === 'abdomen') return bodyType === 'arachnid'
    ? { stiffness: 150, damping: 12.5, verticalWeight: 1.38 }
    : { stiffness: 176, damping: 14.2, verticalWeight: 1.42 }
  if (bodyType === 'arachnid' && role === 'eyes') return { stiffness: 245, damping: 20, verticalWeight: 2.6 }
  if (bodyType === 'arachnid' && role === 'pedipalp') return { stiffness: 110, damping: 12, verticalWeight: 1.7 }
  if (role === 'neck' || role === 'head' || role === 'snout' || role === 'eyes') return { stiffness: 86, damping: 8.4, verticalWeight: 1.12 }
  if (role === 'tail' || role === 'ear' || role === 'pedipalp') return { stiffness: 16, damping: 3.2, verticalWeight: 0.8 }
  if (role === 'tarsus' || role === 'paw') return { stiffness: 38, damping: 7.2, verticalWeight: 1.08 }
  return { stiffness: id === 0 ? 100 : 58, damping: 7.8, verticalWeight: 1.08 }
}

export function animalRestWorld(root, rootLocal, local, scale, basis, verticalScale = scale) {
  const dx = (local[0] - rootLocal[0]) * scale
  const dy = (local[1] - rootLocal[1]) * verticalScale
  const dz = (local[2] - rootLocal[2]) * scale
  return [
    root.x + dx * basis.rightX + dz * basis.fwdX,
    root.y + dy,
    root.z + dx * basis.rightZ + dz * basis.fwdZ,
  ]
}

export function animalLegPhase(entry, descriptor, legCount, speedScale = null) {
  let offset = Number.isFinite(descriptor.phaseOffset)
    ? descriptor.phaseOffset
    : Number.isFinite(descriptor.fallbackPhaseOffset)
      ? descriptor.fallbackPhaseOffset
      : (descriptor.order || 0) * Math.PI * 2 / Math.max(1, legCount)
  if (entry.animalSkeleton?.bodyType === 'arachnid') {
    const match = String(descriptor.id || '').match(/^(left|right)Leg(\d+)/)
    if (match) {
      const index = Number(match[2]) || 0
      const groupA = (match[1] === 'left' && index % 2 === 1) || (match[1] === 'right' && index % 2 === 0)
      offset = groupA ? 0 : Math.PI
    }
  } else if (legCount === 4 && (speedScale ?? 0) > 0.55) {
    const id = String(descriptor.id || descriptor.name || descriptor.footBone || '')
    offset = /leftHind|rightFore/i.test(id) ? 0 : Math.PI
  }
  const base = entry.navState?.walkPhase || 0
  return normalizePhase01(base + offset)
}

export function animalDutyFactor(entry, legCount, speedScale) {
  if (entry.animalSkeleton?.bodyType === 'arachnid') return 0.66 - Math.min(0.08, speedScale * 0.05)
  if (legCount === 4 && speedScale > 0.65) return 0.62
  return 0.74
}

export function animalStanceRollback(entry, speedScale) {
  const scale = entry?.animalSkeleton?.bodyType === 'arachnid' ? animalStrideDriveScale(entry) : (entry?.scale || 1)
  if (entry?.animalSkeleton?.bodyType === 'arachnid') return (0.050 + speedScale * 0.045) * scale
  return (0.055 + speedScale * 0.045) * scale
}

export function applyAnimalLegChainTargets(entry, targets, info, descriptor, root, bodyRootLocal, footTarget, lift, swing, basis) {
  const chain = Array.isArray(descriptor.segmentBones) && descriptor.segmentBones.length >= 2
    ? descriptor.segmentBones
    : [descriptor.rootBone, descriptor.midBone, descriptor.footBone].filter(Boolean)
  if (chain.length < 2) return
  const verticalScale = animalPoseVerticalScale(entry)
  const rootBone = entry.ragdoll?.boneMap?.get(chain[0])
  const legRootLocal = rootBone?.source?.local
  const hipTarget = rootBone?.particle && legRootLocal
    ? animalRestWorld(root, bodyRootLocal, legRootLocal, entry.scale, basis, verticalScale)
    : null
  if (hipTarget) {
    const standing = !swing && (entry.navState?.speed || 0) <= 0.05
    const speedScale = animalCurrentSpeedScale(entry)
    const stanceDrive = (!swing && !standing) ? animalStanceRootPush(entry, descriptor, speedScale) : 0
    if (stanceDrive !== 0) {
      hipTarget[0] += basis.fwdX * stanceDrive
      hipTarget[2] += basis.fwdZ * stanceDrive
    }
    targets.set(chain[0], hipTarget)
    info.set(chain[0], { planted: false, stiffness: swing ? 90 : (standing ? 185 : 150), damping: swing ? 9.5 : (standing ? 22 : 18) })
  }
  const start = hipTarget || animalRestWorld(root, bodyRootLocal, entry.ragdoll?.boneMap?.get(chain[0])?.source?.local || bodyRootLocal, entry.scale, basis, verticalScale)
  const footBone = entry.ragdoll?.boneMap?.get(chain[chain.length - 1])
  const footRest = footBone?.source?.local
    ? animalRestWorld(root, bodyRootLocal, footBone.source.local, entry.scale, basis, verticalScale)
    : footTarget
  for (let i = 1; i < chain.length - 1; i++) {
    const bone = entry.ragdoll?.boneMap?.get(chain[i])
    const local = bone?.source?.local
    if (!local) continue
    const rest = animalRestWorld(root, bodyRootLocal, local, entry.scale, basis, verticalScale)
    const t = i / (chain.length - 1)
    const targetLine = vec3Lerp(start, footTarget, t)
    const restLine = vec3Lerp(start, footRest, t)
    const shapeWeight = animalLegShapeWeight(entry, descriptor, swing)
    const jointPulse = animalLegJointPulse(entry, descriptor, i, chain.length, lift, swing, basis)
    const target = [
      targetLine[0] + (rest[0] - restLine[0]) * shapeWeight + jointPulse[0],
      Math.max(groundYFromFoot(footTarget), targetLine[1] + (rest[1] - restLine[1]) * shapeWeight + jointPulse[1]),
      targetLine[2] + (rest[2] - restLine[2]) * shapeWeight + jointPulse[2],
    ]
    const blend = swing ? 0.84 : ((entry.navState?.speed || 0) <= 0.05 ? 0.78 : 0.70)
    targets.set(chain[i], [
      rest[0] * (1 - blend) + target[0] * blend,
      rest[1] * (1 - blend) + target[1] * blend,
      rest[2] * (1 - blend) + target[2] * blend,
    ])
    info.set(chain[i], { planted: false, stiffness: swing ? 118 : ((entry.navState?.speed || 0) <= 0.05 ? 165 : 142), damping: swing ? 10.5 : ((entry.navState?.speed || 0) <= 0.05 ? 20 : 17) })
  }
}

export function animalCurrentSpeedScale(entry) {
  if (entry?.animalMotionTrace) return animalIntendedSpeedScale(entry, entry.animalMotionTrace)
  const speed = entry?.navState?.speed || 0
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  return Math.max(0, Math.min(1.4, speed / (bodyType === 'arachnid' ? 0.75 : 1.35)))
}

export function animalStanceRootPush(entry, descriptor, speedScale) {
  const scale = animalStrideDriveScale(entry)
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  if (bodyType === 'arachnid') return (0.090 + speedScale * 0.075) * scale
  const id = String(descriptor?.id || descriptor?.name || descriptor?.footBone || '')
  const hind = /Hind/i.test(id)
  const base = hind ? 0.072 : 0.045
  const fast = hind ? 0.050 : 0.032
  return (base + speedScale * fast) * scale
}

export function animalLegShapeWeight(entry, descriptor, swing) {
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  const moving = (entry?.navState?.speed || 0) > 0.05
  if (bodyType === 'arachnid') return swing ? 1.55 : (moving ? 1.42 : 1.30)
  if (bodyType === 'small_quadruped') return swing ? 1.46 : (moving ? 1.28 : 1.16)
  return swing ? 1.42 : (moving ? 1.25 : 1.12)
}

export function animalLegJointPulse(entry, descriptor, jointIndex, chainLength, lift, swing, basis) {
  const scale = Math.max(entry?.scale || 1, 0.72)
  const verticalScale = animalPoseVerticalScale(entry)
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  const t = jointIndex / Math.max(1, chainLength - 1)
  const bell = Math.sin(t * Math.PI)
  const sideSign = descriptor?.side === 'left' ? -1 : 1
  if (bodyType === 'arachnid') {
    const outward = (swing ? 0.060 + lift * 0.040 : 0.045) * scale * bell
    const sweep = (swing ? (lift - 0.25) * 0.040 : -0.010) * scale * bell
    const up = (swing ? 0.045 + lift * 0.055 : 0.050) * verticalScale * bell
    return [
      basis.rightX * sideSign * outward + basis.fwdX * sweep,
      up,
      basis.rightZ * sideSign * outward + basis.fwdZ * sweep,
    ]
  }
  const id = String(descriptor?.id || descriptor?.name || descriptor?.footBone || '')
  const fore = /Fore/i.test(id)
  const backBend = (fore ? -0.030 : -0.052) * scale * bell
  const swingReach = swing ? (lift * (fore ? 0.042 : 0.058)) * scale * bell : 0
  const side = sideSign * (swing ? 0.015 : 0.007) * scale * bell
  const up = (swing ? (0.020 + lift * 0.065) : 0.020) * verticalScale * bell
  return [
    basis.fwdX * (backBend + swingReach) + basis.rightX * side,
    up,
    basis.fwdZ * (backBend + swingReach) + basis.rightZ * side,
  ]
}

export function animalStructuralPasses(entry) {
  return entry?.animalSkeleton?.bodyType === 'arachnid' ? 5 : 6
}

export function clampAnimalBoneVelocities(entry, dt) {
  const maxXZ = entry?.animalSkeleton?.bodyType === 'arachnid' ? 3.5 : 4.5
  const maxY = entry?.animalSkeleton?.bodyType === 'arachnid' ? 4.5 : 5.5
  for (const bone of entry?.ragdoll?.bones || []) {
    const p = bone?.particle
    if (!p) continue
    const xz = Math.hypot(p.vx || 0, p.vz || 0)
    let vx = p.vx || 0
    let vy = p.vy || 0
    let vz = p.vz || 0
    if (xz > maxXZ) {
      const s = maxXZ / xz
      vx *= s
      vz *= s
    }
    vy = Math.max(-maxY, Math.min(maxY, vy))
    setParticleVelocity(p, vx, vy, vz, dt)
  }
}

export function enforceAnimalGroundContact(entry, groundY, dt = 1/60, sensors = null) {
  const footBones = new Set((entry.universalLegDescriptors || []).map(descriptor => descriptor.footBone))
  for (const bone of entry.ragdoll?.bones || []) {
    const p = bone?.particle
    if (!p) continue
    if (p.y < groundY) {
      p.y = groundY
      p.py = groundY
      if (p.vy < 0) p.vy = 0
      const surface = typeof sensors?.surfaceAt === 'function' ? sensors.surfaceAt(p.x, p.z) : null
      const frictionMul = clampSurfaceFriction(surface?.friction ?? surface?.frictionMul ?? 1)
      const mu = Math.min(0.98, (footBones.has(bone.name) ? 0.84 : 0.28) * frictionMul)
      p.vx *= (1 - mu)
      p.vz *= (1 - mu)
      p.px = p.x - p.vx * dt
      p.pz = p.z - p.vz * dt
    }
  }
}

export function enforceAnimalPlantedFootContacts(entry, groundY, dt = 1/60, sensors = null, motion = null) {
  const moving = motion ? animalGaitDriveSpeed(entry, motion) > 0.05 : (entry?.navState?.speed || 0) > 0.05
  const hold = animalPlantedFootHold(entry, moving)
  const damping = animalPlantedFootDamping(entry, moving)
  for (const descriptor of entry?.universalLegDescriptors || []) {
    const state = entry.animalLegState?.[descriptor.id]
    if (!state?.plant || state.swing) continue
    const bone = entry.ragdoll?.boneMap?.get(descriptor.footBone)
    const p = bone?.particle
    if (!p) continue
    const surface = typeof sensors?.surfaceAt === 'function' ? sensors.surfaceAt(p.x, p.z) : null
    const frictionMul = clampSurfaceFriction(surface?.friction ?? surface?.frictionMul ?? 1)
    const localHold = Math.max(0, Math.min(0.92, hold * frictionMul))
    p.x += ((state.plant[0] || p.x) - p.x) * localHold
    p.z += ((state.plant[2] || p.z) - p.z) * localHold
    p.y = Math.max(p.y, groundY)
    if (p.y <= groundY + scaledAnimalContactWindow(entry, 0.045)) {
      p.y = groundY
      p.py = groundY
      const vx = (p.vx || 0) * Math.max(0, 1 - damping * frictionMul)
      const vz = (p.vz || 0) * Math.max(0, 1 - damping * frictionMul)
      setParticleVelocity(p, vx, Math.max(0, p.vy || 0) * 0.18, vz, dt)
    } else {
      p.px = p.x - (p.vx || 0) * dt
      p.pz = p.z - (p.vz || 0) * dt
    }
  }
}

export function animalPlantedFootHold(entry, moving) {
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  if (bodyType === 'arachnid') return moving ? 0.42 : 0.68
  if (bodyType === 'small_quadruped') return moving ? 0.36 : 0.62
  return moving ? 0.34 : 0.58
}

export function animalPlantedFootDamping(entry, moving) {
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  if (bodyType === 'arachnid') return moving ? 0.82 : 0.96
  if (bodyType === 'small_quadruped') return moving ? 0.76 : 0.94
  return moving ? 0.72 : 0.92
}

export function applyAnimalNoIntentSettleBrake(entry, dt = 1/60, motion = null) {
  if ((motion?.desiredSpeed || 0) > 0.05 || (motion?.pathSource || 'none') !== 'none') return
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  const bodyDamp = bodyType === 'arachnid' ? 0.60 : 0.68
  const limbDamp = bodyType === 'arachnid' ? 0.48 : 0.54
  for (const bone of entry?.ragdoll?.bones || []) {
    const p = bone?.particle
    if (!p) continue
    const role = bone.source?.role || ''
    const damp = role === 'root' || role === 'spine' || role === 'chest' || role === 'abdomen' || role === 'eyes' ? bodyDamp : limbDamp
    setParticleVelocity(p, (p.vx || 0) * damp, (p.vy || 0) * 0.72, (p.vz || 0) * damp, dt)
  }
}

export function applyAnimalWrongWayBrake(entry, dt = 1/60, motion = null) {
  if ((motion?.desiredSpeed || 0) <= 0.05 || (motion?.pathSource || 'none') === 'none') return
  const dot = animalRootForwardVelocityDot(entry, motion)
  if (dot >= -0.08) return
  const [fwdX, fwdZ] = animalMotionForwardVector(entry, motion)
  const bodyType = entry?.animalSkeleton?.bodyType || ''
  const bodyDamp = bodyType === 'arachnid' ? 0.72 : 0.58
  const limbDamp = bodyType === 'arachnid' ? 0.78 : 0.66
  for (const bone of entry?.ragdoll?.bones || []) {
    const p = bone?.particle
    if (!p) continue
    const role = bone.source?.role || ''
    const damp = role === 'root' || role === 'spine' || role === 'chest' || role === 'abdomen' || role === 'eyes' ? bodyDamp : limbDamp
    const vx = p.vx || 0
    const vz = p.vz || 0
    const fwdVel = vx * fwdX + vz * fwdZ
    if (fwdVel >= 0) continue
    const sideX = vx - fwdX * fwdVel
    const sideZ = vz - fwdZ * fwdVel
    const dampedBack = fwdVel * damp
    setParticleVelocity(p, sideX + fwdX * dampedBack, p.vy || 0, sideZ + fwdZ * dampedBack, dt)
  }
}

export function computeAnimalBalance(entry, groundY = 0) {
  let comX = 0
  let comY = 0
  let comZ = 0
  let totalMass = 0
  const footContacts = {}
  const supportPoints = []
  for (const bone of entry.ragdoll?.bones || []) {
    const p = bone?.particle
    if (!p) continue
    const mass = bone.mass || 0.1
    comX += p.x * mass
    comY += p.y * mass
    comZ += p.z * mass
    totalMass += mass
  }
  if (totalMass > 0) {
    comX /= totalMass
    comY /= totalMass
    comZ /= totalMass
  }
  for (const descriptor of entry.universalLegDescriptors || []) {
    const bone = entry.ragdoll?.boneMap?.get(descriptor.footBone)
    const p = bone?.particle
    if (!p) continue
    const contact = p.y <= groundY + scaledAnimalContactWindow(entry, 0.08)
    footContacts[descriptor.footBone] = contact
    if (contact) supportPoints.push([p.x, p.y, p.z])
  }
  let supX = comX
  let supZ = comZ
  if (supportPoints.length > 0) {
    supX = supportPoints.reduce((sum, point) => sum + point[0], 0) / supportPoints.length
    supZ = supportPoints.reduce((sum, point) => sum + point[2], 0) / supportPoints.length
  }
  const error = supportPoints.length > 0 ? Math.hypot(comX - supX, comZ - supZ) : 1
  return { error, groundedFeet: supportPoints.length, comX, comY, comZ, supX, supZ, footContacts }
}
