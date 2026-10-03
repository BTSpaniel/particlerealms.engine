// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/BrainProfile.js — extracted from ActiveBodySystem.js
// (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns humanoid brain-profile
// creation/loading (NN tier, motor profile key resolution, lazy brain-file
// load) and the trust/anatomy/brain readback helpers consumed by
// getReadback().

import {
  resolveFunctionalSensorAnchors,
} from './ActiveBodySystem.js'
import { deserializeMotor, loadBrain, tierFromIntelligence } from './NeuralMotor.js'

export function createHumanoidBrainProfile(entityId, options = {}) {
  const preset = options.preset || 'HumanAverage'
  const intelligence = options.intelligence ?? (entityId === 'player' ? 55 : 35)
  const magical = options.magical ?? false
  const tier = options.brainTier || tierFromIntelligence(intelligence, magical)
  return {
    species: 'human',
    archetype: entityId === 'player' ? 'player' : 'npc',
    intelligence,
    magical,
    tier,
    motorProfileKey: options.motorProfileKey || options.brainProfileKey || defaultMotorProfileKey(entityId, preset, tier),
  }
}

export function neuralTierAuthorityCap(tier) {
  const caps = { newborn: 0.18, micro: 0.28, tiny: 0.5, small: 0.7, medium: 0.9, large: 1.0, huge: 1.0, genius: 1.0, arcane: 1.0, transcendent: 1.0, divine: 1.0 }
  return caps[tier] ?? 0.5
}

export function estimateNeuralMotorTrust(motor, options = {}) {
  if (!motor) return { trust: 0, lossTrust: 0, experienceTrust: 0, capacityCap: 0, learningState: 'missing' }
  const loss = Number.isFinite(motor.lossEMA) ? motor.lossEMA : 0.3
  const frames = motor.framesTrained ?? 0
  const skipped = motor.framesSkipped ?? 0
  const cap = Number.isFinite(options.cap) ? options.cap : neuralTierAuthorityCap(motor.tier)
  const lossTrust = Math.max(0, Math.min(1, (0.3 - loss) / 0.28))
  const experienceTrust = Math.max(0, Math.min(1, (frames - 30) / 360))
  const skipRatio = skipped > 0 ? skipped / Math.max(1, frames + skipped) : 0
  const stabilityTrust = Math.max(0.2, 1 - skipRatio * 1.5)
  const trust = Math.min(cap, lossTrust * experienceTrust * stabilityTrust)
  const learningState = frames < 30 ? 'warming'
    : trust < cap * 0.35 ? 'learning'
      : trust < cap * 0.8 ? 'competent'
        : 'fluent'
  return { trust, lossTrust, experienceTrust, stabilityTrust, capacityCap: cap, learningState, skipRatio }
}

export function getBrainReadback(entry) {
  const motor = entry?.neuralMotor
  if (!motor) return null
  const trust = entry?._lastBrainTrust || estimateNeuralMotorTrust(motor)
  return {
    tier: motor.tier,
    archetype: entry.brainProfile?.archetype || (entry.bodyKind === 'animal' ? 'animal' : 'humanoid'),
    species: entry.brainProfile?.species || null,
    intelligence: entry.intelligence ?? 0,
    profileKey: entry.motorProfileKey || entry.entityId,
    profileShared: String(entry.motorProfileKey || '').startsWith('shared:'),
    framesTrained: motor.framesTrained ?? 0,
    framesSkipped: motor.framesSkipped ?? 0,
    lossEMA: motor.lossEMA ?? 0,
    rewardEMA: motor.rewardEMA ?? null,
    rewardBaseline: motor.rewardBaseline ?? null,
    brainDamage: motor.brainDamage ?? 0,
    trust,
    motionPrior: entry._lastAniMotionPrior || null,
    modifiers: { ...(motor.modifiers || {}) },
  }
}

export function getAnatomyReadback(entry) {
  const anatomy = entry?.anatomy
  if (!anatomy) return null
  return {
    schema: anatomy.schema || null,
    species: anatomy.species || null,
    bodyType: anatomy.bodyType || null,
    organIds: Object.keys(anatomy.organs || {}),
    organCount: Object.keys(anatomy.organs || {}).length,
    thorax: anatomy.thorax ? {
      ribCage: anatomy.thorax.ribCage?.id || null,
      sternum: anatomy.thorax.sternum?.id || null,
      diaphragm: anatomy.thorax.diaphragm?.id || null,
    } : null,
    collisionShellIds: Object.keys(anatomy.collisionShells || {}),
  }
}

export function applyBodySpecMetadata(entry, bodySpec) {
  if (!entry || !bodySpec) return
  if (entry.bodyKind === 'animal') return
  entry.bodySpec = bodySpec
  entry.anatomy = bodySpec.anatomy || null
  entry.anatomyAttachments = bodySpec.attachments || null
  entry.skeletonExtensions = bodySpec.skeletonExtensions || null
  entry.sensorAnchors = resolveFunctionalSensorAnchors(bodySpec)
  entry.boneAliases = bodySpec.boneAliases || null
  entry.driveByBone = bodySpec.driveByBone || null
  entry.driveAxesByBone = bodySpec.driveAxesByBone || null
  entry.jointLimitsByBone = bodySpec.jointLimitsByBone || null
  entry.muscleModel = bodySpec.muscleModel || null
}

export function ensureBrainLoaded(entry) {
  if (!entry?.neuralMotor || entry._brainLoadAttempted) return
  entry._brainLoadAttempted = true
  const profileKey = entry.motorProfileKey || entry.entityId
  loadBrain(profileKey).then(data => {
    if (data && deserializeMotor(entry.neuralMotor, data, { silent: true })) {
      console.info(
        `[BRAIN] loaded ${entry.entityId} ← ${profileKey} ` +
        `tier=${data.tier} steps=${data.framesTrained} size=${(data.byteSize/1024).toFixed(1)}KB`
      )
    }
  }).catch(() => {})
}

export function defaultMotorProfileKey(entityId, preset, tier) {
  if (entityId === 'player') return entityId
  return `shared:${preset || 'HumanAverage'}:${tier || 'tiny'}`
}
