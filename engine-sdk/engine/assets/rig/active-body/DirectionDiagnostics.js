// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/DirectionDiagnostics.js — extracted from
// ActiveBodySystem.js (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns
// per-frame pelvis-displacement direction tracking (updateDirectionMotion)
// and the direction/facing diagnostics readback consumed by
// getDirectionDiagnostics()/getReadback() and the orientation-audit debug
// logging (still in ActiveBodySystem.js).

import {
  round4,
} from './ActiveBodySystem.js'
import { vec2Dot } from '../../../core/math/MathVec2.js'

export function updateDirectionMotion(entry, dt) {
  const pelvis = entry?.ragdoll?.bones?.[0]?.particle
  if (!pelvis || !(dt > 0)) return
  const last = entry._directionLastPelvis
  if (!last) {
    entry._directionLastPelvis = [pelvis.x, pelvis.y, pelvis.z]
    entry._directionMotionClock = 0
    entry._directionMotionSamples = [{ t: 0, x: pelvis.x, z: pelvis.z }]
    entry.directionMotion = {
      displacement: [0, 0],
      velocity: [0, 0],
      speed: 0,
      rollingDisplacement: [0, 0],
      rollingVelocity: [0, 0],
      rollingSpeed: 0,
      rollingDt: 0,
      dt,
      sampled: false,
    }
    return
  }
  const dx = pelvis.x - last[0]
  const dz = pelvis.z - last[2]
  const clock = (entry._directionMotionClock || 0) + dt
  entry._directionMotionClock = clock
  const intentDir = entry.intent?.type === 'walk' ? normalize2(resolveIntentDirection(entry, pelvis)) : null
  const prevIntentDir = Array.isArray(entry._directionMotionIntentDir) ? entry._directionMotionIntentDir : null
  let resetRolling = false
  if (intentDir) {
    resetRolling = !prevIntentDir || dot2(prevIntentDir, intentDir) < 0.86
    entry._directionMotionIntentDir = [intentDir[0], intentDir[1]]
  } else if (prevIntentDir) {
    resetRolling = true
    entry._directionMotionIntentDir = null
  }
  const samples = resetRolling ? [] : (Array.isArray(entry._directionMotionSamples) ? entry._directionMotionSamples : [])
  samples.push({ t: clock, x: pelvis.x, z: pelvis.z })
  while (samples.length > 2 && clock - samples[0].t > 1.5) samples.shift()
  entry._directionMotionSamples = samples
  const first = samples[0]
  const windowDt = first ? Math.max(0, clock - first.t) : 0
  const rollingDx = first ? pelvis.x - first.x : 0
  const rollingDz = first ? pelvis.z - first.z : 0
  const rollingVelocity = windowDt > 0 ? [rollingDx / windowDt, rollingDz / windowDt] : [0, 0]
  entry.directionMotion = {
    displacement: [dx, dz],
    velocity: [dx / dt, dz / dt],
    speed: Math.hypot(dx / dt, dz / dt),
    rollingDisplacement: [rollingDx, rollingDz],
    rollingVelocity,
    rollingSpeed: Math.hypot(rollingVelocity[0], rollingVelocity[1]),
    rollingDt: windowDt,
    dt,
    sampled: true,
  }
  last[0] = pelvis.x
  last[1] = pelvis.y
  last[2] = pelvis.z
}

export function buildDirectionDiagnostics(entry) {
  const pelvis = entry?.ragdoll?.bones?.[0]?.particle
  const intent = entry?.intent || {}
  const nav = entry?.navState || {}
  const assist = entry?.locomotionAssist || null
  const intentRaw = resolveIntentDirection(entry, pelvis)
  const intentDir = normalize2(intentRaw)
  const facingDir = Number.isFinite(nav.facing) ? [Math.sin(nav.facing), Math.cos(nav.facing)] : null
  const facingTargetDir = Number.isFinite(nav.facingTarget) ? [Math.sin(nav.facingTarget), Math.cos(nav.facingTarget)] : null
  const particleVelocity = pelvis ? [pelvis.vx || 0, pelvis.vz || 0] : [0, 0]
  const motion = entry?.directionMotion
  const velocity = Array.isArray(motion?.velocity) ? motion.velocity : particleVelocity
  const displacement = Array.isArray(motion?.displacement) ? motion.displacement : [0, 0]
  const rollingVelocity = Array.isArray(motion?.rollingVelocity) ? motion.rollingVelocity : [0, 0]
  const rollingDisplacement = Array.isArray(motion?.rollingDisplacement) ? motion.rollingDisplacement : [0, 0]
  const velocityDir = normalize2(velocity)
  const rollingVelocityDir = normalize2(rollingVelocity)
  const particleVelocityDir = normalize2(particleVelocity)
  const navVelocity = Array.isArray(nav.velocity) ? [nav.velocity[0] || 0, nav.velocity[1] || 0] : null
  const navVelocityDir = normalize2(navVelocity)
  const speed = Math.hypot(velocity[0], velocity[1])
  const rollingSpeed = Math.hypot(rollingVelocity[0], rollingVelocity[1])
  const particleSpeed = Math.hypot(particleVelocity[0], particleVelocity[1])
  const intentDotVelocity = intentDir && velocityDir ? dot2(intentDir, velocityDir) : null
  const intentDotRollingVelocity = intentDir && rollingVelocityDir ? dot2(intentDir, rollingVelocityDir) : null
  const intentDotParticleVelocity = intentDir && particleVelocityDir ? dot2(intentDir, particleVelocityDir) : null
  const facingDotVelocity = facingDir && velocityDir ? dot2(facingDir, velocityDir) : null
  const facingDotRollingVelocity = facingDir && rollingVelocityDir ? dot2(facingDir, rollingVelocityDir) : null
  const targetDotVelocity = facingTargetDir && velocityDir ? dot2(facingTargetDir, velocityDir) : null
  const navDotVelocity = navVelocityDir && velocityDir ? dot2(navVelocityDir, velocityDir) : null
  const status = classifyDirectionStatus(intentDotVelocity, speed)
  const rollingStatus = classifyDirectionStatus(intentDotRollingVelocity, rollingSpeed)
  const particleStatus = classifyDirectionStatus(intentDotParticleVelocity, particleSpeed)
  const currentForward = status === 'forward' || (intentDotVelocity != null && intentDotVelocity > 0.35 && speed > 0.08)
  const particleForward = particleStatus === 'forward' || (intentDotParticleVelocity != null && intentDotParticleVelocity > 0.35 && particleSpeed > 0.08)
  const rollingIssueStale = currentForward && particleForward
  return {
    intentType: intent.type ?? null,
    source: intentRaw.source,
    intentDir: intentDir ? [round4(intentDir[0]), round4(intentDir[1])] : null,
    facingDir: facingDir ? [round4(facingDir[0]), round4(facingDir[1])] : null,
    strideForwardDir: facingDir ? [round4(facingDir[0]), round4(facingDir[1])] : null,
    facingTargetDir: facingTargetDir ? [round4(facingTargetDir[0]), round4(facingTargetDir[1])] : null,
    navVelocityDir: navVelocityDir ? [round4(navVelocityDir[0]), round4(navVelocityDir[1])] : null,
    displacement: [round4(displacement[0]), round4(displacement[1])],
    velocity: [round4(velocity[0]), round4(velocity[1])],
    rollingDisplacement: [round4(rollingDisplacement[0]), round4(rollingDisplacement[1])],
    rollingVelocity: [round4(rollingVelocity[0]), round4(rollingVelocity[1])],
    particleVelocity: [round4(particleVelocity[0]), round4(particleVelocity[1])],
    locomotionAssist: assist ? {
      targetSpeed: round4(assist.targetSpeed ?? 0),
      fwdVel: round4(assist.fwdVel ?? 0),
      sideVel: round4(assist.sideVel ?? 0),
      accel: Array.isArray(assist.accel) ? [round4(assist.accel[0]), round4(assist.accel[1])] : null,
      drivenBones: assist.drivenBones ?? 0,
    } : null,
    speed: round4(speed),
    rollingSpeed: round4(rollingSpeed),
    rollingDt: round4(motion?.rollingDt ?? 0),
    particleSpeed: round4(particleSpeed),
    sampled: motion?.sampled ?? false,
    dots: {
      intentVelocity: intentDotVelocity == null ? null : round4(intentDotVelocity),
      intentRollingVelocity: intentDotRollingVelocity == null ? null : round4(intentDotRollingVelocity),
      intentParticleVelocity: intentDotParticleVelocity == null ? null : round4(intentDotParticleVelocity),
      facingVelocity: facingDotVelocity == null ? null : round4(facingDotVelocity),
      facingRollingVelocity: facingDotRollingVelocity == null ? null : round4(facingDotRollingVelocity),
      facingTargetVelocity: targetDotVelocity == null ? null : round4(targetDotVelocity),
      navVelocityActual: navDotVelocity == null ? null : round4(navDotVelocity),
    },
    status,
    rollingStatus,
    particleStatus,
    likelyIssues: [
      ...(status === 'backwards' ? ['intent_displacement_reversed'] : []),
      ...(status === 'sideways' ? ['intent_displacement_sideways'] : []),
      ...(rollingStatus === 'backwards' && !rollingIssueStale ? ['intent_rolling_displacement_reversed'] : []),
      ...(rollingStatus === 'sideways' && !currentForward ? ['intent_rolling_displacement_sideways'] : []),
      ...(navDotVelocity != null && navDotVelocity < -0.35 ? ['nav_velocity_reversed'] : []),
      ...(intentDotVelocity != null && intentDotParticleVelocity != null && intentDotVelocity * intentDotParticleVelocity < -0.12 ? ['particle_velocity_disagrees_with_displacement'] : []),
    ],
  }
}

export function resolveIntentDirection(entry, pelvis) {
  const intent = entry?.intent || {}
  if (Number.isFinite(intent.targetDirX) || Number.isFinite(intent.targetDirZ)) {
    return {
      x: Number.isFinite(intent.targetDirX) ? intent.targetDirX : 0,
      z: Number.isFinite(intent.targetDirZ) ? intent.targetDirZ : 0,
      source: 'targetDir',
    }
  }
  if (Array.isArray(intent.waypoint) && pelvis) {
    return {
      x: (intent.waypoint[0] ?? pelvis.x) - pelvis.x,
      z: (intent.waypoint[1] ?? pelvis.z) - pelvis.z,
      source: 'waypoint',
    }
  }
  return { x: 0, z: 0, source: 'none' }
}

export function normalize2(v) {
  if (!v) return null
  const x = Array.isArray(v) ? v[0] : v.x
  const z = Array.isArray(v) ? v[1] : v.z
  const len = Math.hypot(x || 0, z || 0)
  if (len < 1e-5) return null
  return [(x || 0) / len, (z || 0) / len]
}

export function dot2(a, b) {
  return vec2Dot(a, b)
}

export function classifyDirectionStatus(intentDotVelocity, speed) {
  if (speed < 0.08 || intentDotVelocity == null) return 'noMotion'
  if (intentDotVelocity < -0.35) return 'backwards'
  if (Math.abs(intentDotVelocity) <= 0.35) return 'sideways'
  return 'forward'
}

export function boneNameForParticle(ragdoll, particle) {
  const bone = ragdoll.bones?.find(b => b?.particle === particle)
  return bone?.name || null
}
