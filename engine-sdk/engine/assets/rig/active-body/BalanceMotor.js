// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/BalanceMotor.js — extracted from ActiveBodySystem.js
// (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns humanoid COM-based
// balance (Winter mass fractions) and the idle/locomotion/stumble/fallen/
// getup/ko state machine that reads it. Kept as one module per the Phase 7
// pre-work findings — the state machine and balance computation are tightly
// entangled (updateState reads balance.error/groundedFeet every frame) and
// splitting them would just add a needless import hop.

import {
  BONE_NAMES,
  yawDeg,
} from './ActiveBodySystem.js'
import { FOOT_PARTICLE_CONTACT_HEIGHT } from './ContactTelemetry.js'

export const MASS_FRACTIONS = {
  pelvis: 0.142, spine: 0.139, spine1: 0.108, chest: 0.108, neck: 0.04, head: 0.041,
  leftShoulder: 0.014, leftUpperArm: 0.028, leftForearm: 0.016, leftHand: 0.006,
  rightShoulder: 0.014, rightUpperArm: 0.028, rightForearm: 0.016, rightHand: 0.006,
  leftThigh: 0.100, leftShin: 0.0465, leftFoot: 0.0145,
  rightThigh: 0.100, rightShin: 0.0465, rightFoot: 0.0145,
}

export const STUMBLE_THRESHOLD = 0.28

export const FALL_THRESHOLD = 0.58

export const LOCOMOTION_STUMBLE_THRESHOLD = 0.40

export const LOCOMOTION_STUMBLE_TIME = 0.18

export const STUMBLE_FALL_TIME = 0.20

export function computeBalance(ragdoll) {
  // COM
  let comX = 0, comY = 0, comZ = 0, totalMass = 0
  for (const bone of ragdoll.bones) {
    if (!bone) continue
    const w = MASS_FRACTIONS[bone.name] || 0.02
    comX += bone.particle.x * w
    comY += bone.particle.y * w
    comZ += bone.particle.z * w
    totalMass += w
  }
  if (totalMass > 0) { comX /= totalMass; comY /= totalMass; comZ /= totalMass }

  // Support center (average of feet)
  const feet = ['leftFoot', 'rightFoot']
  let supX = 0, supZ = 0, footCount = 0
  const footContacts = { leftFoot: false, rightFoot: false }
  for (const name of feet) {
    const bone = ragdoll.boneMap?.get(name) || ragdoll.bones[BONE_NAMES.indexOf(name)]
    if (!bone) continue
    supX += bone.particle.x
    supZ += bone.particle.z
    footCount++
  }
  if (footCount > 0) { supX /= footCount; supZ /= footCount }

  // Grounded feet (within threshold of ground)
  let groundedFeet = 0
  for (const name of feet) {
    const bone = ragdoll.boneMap?.get(name) || ragdoll.bones[BONE_NAMES.indexOf(name)]
    if (bone && bone.particle.y < FOOT_PARTICLE_CONTACT_HEIGHT) {
      groundedFeet++
      footContacts[name] = true
    }
  }

  // Balance error = horizontal distance COM to support center
  const error = Math.hypot(comX - supX, comZ - supZ)

  return { error, groundedFeet, comX, comY, comZ, supX, supZ, footContacts }
}

export function makeBalanceState(entry, balance) {
  const dx = balance.comX - balance.supX
  const dz = balance.comZ - balance.supZ
  const d = Math.hypot(dx, dz)
  return {
    state: toBalanceControllerState(entry.state),
    bodyState: entry.state,
    balanceError: balance.error,
    groundedFeet: balance.groundedFeet,
    centerOfMass: [balance.comX, balance.comY, balance.comZ],
    supportCenter: [balance.supX, 0, balance.supZ],
    correction: d > 0.0001 ? [-dx / d * balance.error, 0, -dz / d * balance.error] : [0, 0, 0],
    footContacts: { ...balance.footContacts },
  }
}

export function toBalanceControllerState(state) {
  switch (state) {
    case 'stumble': return 'stumbling'
    case 'fallen': return 'fallen'
    case 'getup': return 'recovering'
    case 'ko': return 'knockedOut'
    default: return 'active'
  }
}

export function copyBalanceState(balance) {
  if (!balance) return null
  return {
    ...balance,
    centerOfMass: [...balance.centerOfMass],
    supportCenter: [...balance.supportCenter],
    correction: [...balance.correction],
    footContacts: { ...balance.footContacts },
  }
}

export function updateState(entry, balance, dt) {
  entry.stateTimer += dt
  entry._spawnGraceTime = Math.max(0, (entry._spawnGraceTime || 0) - dt)
  const prev = entry.state
  const inSpawnGrace = entry._spawnGraceTime > 0

  // Detect severe neural disruption (seizure / paralysis / severe poison).
  // Body can't hold itself together — force into stumble/fallen states.
  const mod = entry.neuralMotor?.modifiers
  const neuroDisrupt = mod
    ? (mod.dropout ?? 0) + (mod.seizureAmp ?? 0) * 0.5 + Math.max(0, 1 - (mod.scale ?? 1))
    : 0
  const severelyDisrupted = neuroDisrupt > 0.6   // seizure/paralytic threshold

  switch (entry.state) {
    case 'idle':
      if (entry.navState.speed > 0.1) {
        entry.state = 'locomotion'
      } else if (!inSpawnGrace && balance.error > STUMBLE_THRESHOLD) {
        entry.state = 'stumble'
      }
      // Seizure/paralytic → skip stumble, go straight to fallen
      if (severelyDisrupted) entry.state = 'fallen'
      break

    case 'locomotion':
      if (entry.navState.speed < 0.05) entry.state = 'idle'
      if (entry.state === 'locomotion') {
        if (!inSpawnGrace && balance.error > LOCOMOTION_STUMBLE_THRESHOLD) {
          entry._locomotionStumbleTime = (entry._locomotionStumbleTime || 0) + dt
        } else {
          entry._locomotionStumbleTime = 0
        }
        if (entry._locomotionStumbleTime > LOCOMOTION_STUMBLE_TIME) entry.state = 'stumble'
      }
      if (severelyDisrupted) entry.state = 'fallen'
      break

    case 'stumble':
      if (balance.groundedFeet === 0 || (balance.error > FALL_THRESHOLD && entry.stateTimer > STUMBLE_FALL_TIME)) {
        entry.state = 'fallen'
      } else if (balance.error < STUMBLE_THRESHOLD * 0.6) {
        entry.state = entry.navState.speed > 0.1 ? 'locomotion' : 'idle'
      }
      break

    case 'fallen':
      // Trigger getup when body has been settled for 1.5s, OR after 4s of
      // being fallen (fallback — guards against perpetual PBD jitter).
      if (entry.fallenStillTime > 1.5 || entry.stateTimer > 4.0) {
        entry.state = 'getup'
        entry.fallenStillTime = 0
        // Snapshot body yaw (pelvis→chest horizontal direction) and up-axis
        // orientation (face-up vs face-down) at the moment getup begins.
        // Rising in the body's current spine direction minimizes twist and
        // matches how real getup animations are driven (Euphoria-style).
        snapshotGetupOrientation(entry)
      }
      break

    case 'getup': {
      // Exit getup only when the body has ACTUALLY stood up — measured
      // from live physics, not from the target-verticality setpoint.
      // Previously exited on target reaching 49 which fired even when the
      // body was still on the floor, dumping it into idle where it fell
      // over and re-triggered getup — an infinite loop.
      //
      // Three exit conditions:
      //   1. pelvis at stand height (Y > 1.5) AND core stable — success
      //   2. long timeout (12s) — give up, transition to idle either way
      //   3. body clearly failing (face-planted > 3s) — reset to fallen
      const pelvis = entry.ragdoll?.bones?.[0]?.particle
      const pelvisY = pelvis?.y ?? 0
      const pelvisV = pelvis
        ? Math.sqrt(pelvis.vx * pelvis.vx + pelvis.vy * pelvis.vy + pelvis.vz * pelvis.vz)
        : 0

      if (pelvisY > 1.5 && pelvisV < 2.0) {
        // Body is actually upright and stable — getup succeeded.
        entry.state = 'idle'
      } else if (entry.stateTimer > 12.0) {
        // Long timeout — body failed to get up. Transition to idle
        // anyway; standing controller will try to hold what it has.
        entry.state = 'idle'
      }
      // Otherwise stay in getup and keep trying.
      break
    }

    case 'ko':
      // Stay KO until externally cleared
      break
  }

  if (entry.state !== prev) {
    entry.stateTimer = 0
    entry._locomotionStumbleTime = 0
  }
}

export function snapshotGetupOrientation(entry) {
  const ragdoll = entry.ragdoll
  if (!ragdoll) return
  const pelvis = ragdoll.bones[0]?.particle
  const chest  = ragdoll.bones[3]?.particle
  const lSh    = ragdoll.bones[6]?.particle
  const rSh    = ragdoll.bones[10]?.particle
  if (!pelvis || !chest) {
    entry.getupYaw = entry.navState?.facing || 0
    entry.getupFaceUp = false
    return
  }

  // Lock the GETUP anchor at the body's CURRENT pelvis XZ position. This is
  // separate from `anchorPosition` (which the renderer uses as display
  // origin). Pose targets are anchored here so the body rises physically
  // from where it currently lies. Renderer is unaffected.
  entry.getupAnchor[0] = pelvis.x
  entry.getupAnchor[1] = entry.anchorPosition[1] || 0  // same ground level
  entry.getupAnchor[2] = pelvis.z

  // Horizontal spine direction (pelvis → chest projected onto XZ).
  let dx = chest.x - pelvis.x
  let dz = chest.z - pelvis.z
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len > 0.05) {
    // atan2(x, z) gives yaw where 0 rad = +Z forward (matches pose.facing).
    entry.getupYaw = Math.atan2(dx, dz)
  } else {
    // Spine nearly vertical (body seated or folded) — keep navState facing.
    entry.getupYaw = entry.navState?.facing || 0
  }

  // Face-up detection: cross(spineDir, shoulderDir).y tells us which way
  // the chest's "front" vector points. >0 = belly up (supine).
  if (lSh && rSh) {
    const sx = rSh.x - lSh.x
    const sz = rSh.z - lSh.z
    const vx = chest.x - pelvis.x
    const vz = chest.z - pelvis.z
    // Belly direction = shoulder × spine (Y component only)
    const bellyY = sz * vx - sx * vz
    entry.getupFaceUp = bellyY > 0
  } else {
    entry.getupFaceUp = false
  }

  // Reset verticality tracker so ramp starts fresh from wherever the body
  // actually is (prone ~0, pushup ~15, knocked-down-mid-stand ~30, etc).
  entry.targetVerticality = undefined
  entry._lastVLog = 0

  const variant = entry.getupFaceUp
    ? 'SUPINE (verticality: 5→50)'
    : 'PRONE (verticality: 0→50)'
  const yawDeg = (entry.getupYaw * 180 / Math.PI).toFixed(1)
  console.info(`[GETUP] ${entry.entityId} starting ${variant}, yaw=${yawDeg}°`)
}
