// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/OrientationAudit.js — extracted from
// ActiveBodySystem.js (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns
// pure console.log debug tracing: per-frame locomotion-target deltas, the
// body-vs-particle-vs-facing orientation audit, and the authored-pose
// directional-consistency self-check (knees/elbows/toes/belly orientation).
// Distinct from DebugOverlay.js's structured readback data — this is
// developer-console tracing only, no return values consumed by callers.

import {
  computeSignedAngleOnHorizontal,
  yawDeg,
} from './ActiveBodySystem.js'
import { buildDirectionDiagnostics, dot2, normalize2 } from './DirectionDiagnostics.js'
import { getCachedPose } from './BodyPoses.js'

export function logLocomotionTargetTrace(entry, ragdoll, targets, meta) {
  const boneMap = ragdoll?.boneMap
  const delta = (name) => {
    const p = boneMap?.get(name)?.particle
    const t = targets?.[name]
    if (!p || !t) return `${name}=—`
    const dx = t[0] - p.x
    const dy = t[1] - p.y
    const dz = t[2] - p.z
    const xz = Math.hypot(dx, dz)
    const v = Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0)
    return `${name}=xz${xz.toFixed(2)} y${dy.toFixed(2)} v${v.toFixed(2)}`
  }
  console.log(
    `[TARGET-TRACE] frame=${meta.frame} ${entry.entityId} state=${entry.state} ` +
    `blend=${meta.locomotionBlend.toFixed(2)} legs=L:${meta.leftLegIsSwing ? 'swing' : 'stance'} R:${meta.rightLegIsSwing ? 'swing' : 'stance'} ` +
    `activity=${meta.activity.toFixed(2)} neuro=${meta.neuroAuthority.toFixed(2)} ` +
    `${delta('pelvis')} ${delta('chest')} ${delta('neck')} ${delta('head')} ${delta('leftShoulder')} ${delta('rightShoulder')} ${delta('leftHand')} ${delta('rightHand')} ${delta('leftFoot')} ${delta('rightFoot')}`
  )
}

export function logOrientationAudit(entry, ragdoll) {
  const bones = ragdoll.bones
  const pelvis = bones[0]?.particle
  const chest  = bones[3]?.particle
  const head   = bones[5]?.particle
  const lSh    = bones[6]?.particle
  const rSh    = bones[10]?.particle
  const lUpArm = bones[7]?.particle
  const lForearm = bones[8]?.particle
  const lHand = bones[9]?.particle
  const rUpArm = bones[11]?.particle
  const rForearm = bones[12]?.particle
  const rHand = bones[13]?.particle
  const lThigh = bones[14]?.particle
  const lShin = bones[15]?.particle
  const lFoot = bones[16]?.particle
  const rThigh = bones[17]?.particle
  const rShin = bones[18]?.particle
  const rFoot = bones[19]?.particle
  if (!pelvis || !chest) return

  // Body forward (pelvis → chest horizontal projection)
  const bfX = chest.x - pelvis.x
  const bfZ = chest.z - pelvis.z
  const bfLen = Math.hypot(bfX, bfZ)
  let auditFwdX = bfX
  let auditFwdZ = bfZ
  let auditSource = 'spine'
  if (bfLen < 0.18) {
    const sx = lSh && rSh ? rSh.x - lSh.x : 0
    const sz = lSh && rSh ? rSh.z - lSh.z : 0
    const shoulderLen = Math.hypot(sx, sz)
    if (shoulderLen > 0.08) {
      auditFwdX = -sz / shoulderLen
      auditFwdZ = sx / shoulderLen
      auditSource = 'shoulders'
    } else if (Number.isFinite(entry.navState?.facing)) {
      auditFwdX = Math.sin(entry.navState.facing)
      auditFwdZ = Math.cos(entry.navState.facing)
      auditSource = 'nav'
    } else {
      auditFwdX = 0
      auditFwdZ = 1
      auditSource = 'fallback'
    }
  }
  const bodyYaw = Math.atan2(auditFwdX, auditFwdZ)

  // Belly direction (shoulder × spine axis y-component). +1 = belly up (supine)
  let bellySign = 0
  if (lSh && rSh && bfLen >= 0.18) {
    const sx = rSh.x - lSh.x
    const sz = rSh.z - lSh.z
    const vx = chest.x - pelvis.x
    const vz = chest.z - pelvis.z
    bellySign = Math.sign(sz * vx - sx * vz)
  }

  // Knee bend direction: (thigh - shin) horizontal = direction shin is pushed.
  // In standing pose with knees bent forward, shin is FORWARD of thigh.
  let lKneeYaw = null, rKneeYaw = null
  if (lThigh && lShin) {
    lKneeYaw = Math.atan2(lShin.x - lThigh.x, lShin.z - lThigh.z)
  }
  if (rThigh && rShin) {
    rKneeYaw = Math.atan2(rShin.x - rThigh.x, rShin.z - rThigh.z)
  }

  // Elbow bend: forearm direction relative to upper arm
  let lElbowYaw = null, rElbowYaw = null
  if (lUpArm && lForearm) {
    lElbowYaw = Math.atan2(lForearm.x - lUpArm.x, lForearm.z - lUpArm.z)
  }
  if (rUpArm && rForearm) {
    rElbowYaw = Math.atan2(rForearm.x - rUpArm.x, rForearm.z - rUpArm.z)
  }

  // Toe direction (foot extends from shin toward toe)
  let lToeYaw = null, rToeYaw = null
  if (lShin && lFoot) {
    lToeYaw = Math.atan2(lFoot.x - lShin.x, lFoot.z - lShin.z)
  }
  if (rShin && rFoot) {
    rToeYaw = Math.atan2(rFoot.x - rShin.x, rFoot.z - rShin.z)
  }

  // Hand direction (hand from forearm)
  let lHandYaw = null, rHandYaw = null
  if (lForearm && lHand) {
    lHandYaw = Math.atan2(lHand.x - lForearm.x, lHand.z - lForearm.z)
  }
  if (rForearm && rHand) {
    rHandYaw = Math.atan2(rHand.x - rForearm.x, rHand.z - rForearm.z)
  }

  // Angle deltas from body forward — absolute value indicates misalignment.
  const angleDelta = (yaw) => yaw == null ? null : computeSignedAngleOnHorizontal(auditFwdX, auditFwdZ, Math.sin(yaw), Math.cos(yaw))
  const lKneeDelta = angleDelta(lKneeYaw)
  const rKneeDelta = angleDelta(rKneeYaw)
  const lElbowDelta = angleDelta(lElbowYaw)
  const rElbowDelta = angleDelta(rElbowYaw)
  const lToeDelta = angleDelta(lToeYaw)
  const rToeDelta = angleDelta(rToeYaw)

  const belly = bellySign > 0 ? 'UP' : bellySign < 0 ? 'DOWN' : '?'

  console.log(
    `[ORIENT] ${entry.entityId} body_yaw=${yawDeg(bodyYaw)}° spineLen=${bfLen.toFixed(2)} yawSource=${auditSource} belly=${belly}`
  )
  const fmt = (v) => v == null ? '—' : yawDeg(v) + '°'
  console.log(
    `  knee Δ:  L=${fmt(lKneeDelta)} R=${fmt(rKneeDelta)}    ` +
    `elbow Δ: L=${fmt(lElbowDelta)} R=${fmt(rElbowDelta)}`
  )
  console.log(
    `  toe Δ:   L=${fmt(lToeDelta)} R=${fmt(rToeDelta)}    ` +
    `hand Δ:  L=${fmt(lHandDelta(lHandYaw, auditFwdX, auditFwdZ))} R=${fmt(lHandDelta(rHandYaw, auditFwdX, auditFwdZ))}`
  )

  // ─── KINEMATICS DIRECTION AUDIT ────────────────────────────────────────
  // Compare COMMANDED facing (where the user/AI wants the body to look),
  // ACTUAL pelvis velocity (where the body is physically moving), eye
  // direction (head's pose-front in world), and each limb's velocity.
  // The "facing vs motion" delta is the smoking gun for "walking
  // backwards" / "movement inverted" symptoms.
  const navYaw = entry.navState?.facing
  const navTarget = entry.navState?.facingTarget
  if (navYaw != null) {
    const fxCmd = Math.sin(navYaw), fzCmd = Math.cos(navYaw)
    // Pelvis velocity (horizontal)
    const pelvisP = ragdoll.bones[0]?.particle
    let velAngle = null, velMag = 0
    if (pelvisP) {
      velMag = Math.hypot(pelvisP.vx, pelvisP.vz)
      if (velMag > 0.05) velAngle = Math.atan2(pelvisP.vx, pelvisP.vz)
    }
    const facingVsMotion = velAngle == null ? null
      : computeSignedAngleOnHorizontal(fxCmd, fzCmd, Math.sin(velAngle), Math.cos(velAngle))
    const intent = entry.intent || {}
    const intentDx = intent.targetDirX ?? 0
    const intentDz = intent.targetDirZ ?? 0
    const intentMag = Math.hypot(intentDx, intentDz)
    const directionDiagnostics = buildDirectionDiagnostics(entry)
    console.log(
      `  [DIR-PARTICLE] cmd=${yawDeg(navYaw)}° tgt=${navTarget == null ? '—' : yawDeg(navTarget) + '°'} ` +
      `intent=(${intentDx.toFixed(2)},${intentDz.toFixed(2)})|${intentMag.toFixed(2)} ` +
      `pelV=(${pelvisP ? pelvisP.vx.toFixed(2) : '—'},${pelvisP ? pelvisP.vz.toFixed(2) : '—'})|${velMag.toFixed(2)} ` +
      `particleStatus=${directionDiagnostics?.particleStatus ?? 'unknown'} intent·particle=${directionDiagnostics?.dots?.intentParticleVelocity ?? '—'}`
    )
    if (facingVsMotion != null) {
      const deltaDeg = Math.abs(facingVsMotion) * 180 / Math.PI
      const tag = deltaDeg < 30 ? '✓ aligned' :
                  deltaDeg > 150 ? '✗ BACKWARDS' :
                  deltaDeg > 60 ? '⚠ sideways' : '~ off'
      console.log(`  [DIR-PARTICLE] facing→particle Δ = ${yawDeg(facingVsMotion)}° ${tag}`)
    }
  }

  // Eye direction (head's "forward" — derived from spine projection,
  // since head should face same way as torso). Approximated as horizontal
  // pelvis→head NORMALIZED — but for a leaning forward walk this still
  // points roughly forward.
  if (head && pelvis) {
    const hx = head.x - pelvis.x
    const hz = head.z - pelvis.z
    const hLen = Math.hypot(hx, hz)
    if (hLen > 0.02) {
      const eyeYaw = Math.atan2(hx, hz)
      console.log(`  [EYE] head→pelvis horizontal yaw = ${yawDeg(eyeYaw)}° (lean=${hLen.toFixed(2)}m)`)
    } else {
      console.log(`  [EYE] head over pelvis (lean<2cm) — eye dir = facing`)
    }
  }

  // Per-limb velocities (which way are feet/hands actually moving in world)
  const fmtVel = (p) => p ? `(${p.vx.toFixed(2)},${p.vz.toFixed(2)})|${Math.hypot(p.vx, p.vz).toFixed(2)}` : '—'
  console.log(
    `  [LIMB-V] lFoot=${fmtVel(lFoot)} rFoot=${fmtVel(rFoot)} ` +
    `lHand=${fmtVel(lHand)} rHand=${fmtVel(rHand)}`
  )
}

export function logFinalDirectionAudit(entry) {
  const d = buildDirectionDiagnostics(entry)
  const navYaw = entry.navState?.facing
  const navTarget = entry.navState?.facingTarget
  const intent = entry.intent || {}
  const intentDx = intent.targetDirX ?? 0
  const intentDz = intent.targetDirZ ?? 0
  const intentMag = Math.hypot(intentDx, intentDz)
  const velocity = entry.directionMotion?.velocity || [0, 0]
  const displacement = entry.directionMotion?.displacement || [0, 0]
  const rollingDisplacement = entry.directionMotion?.rollingDisplacement || [0, 0]
  console.log(
    `  [DIR-FINAL] cmd=${navYaw == null ? '—' : yawDeg(navYaw) + '°'} tgt=${navTarget == null ? '—' : yawDeg(navTarget) + '°'} ` +
    `intent=(${intentDx.toFixed(2)},${intentDz.toFixed(2)})|${intentMag.toFixed(2)} ` +
    `disp=(${displacement[0].toFixed(3)},${displacement[1].toFixed(3)}) ` +
    `dispV=(${velocity[0].toFixed(2)},${velocity[1].toFixed(2)})|${(d.speed ?? 0).toFixed(2)} ` +
    `directionStatus=${d.status} intent·disp=${d.dots?.intentVelocity ?? '—'} ` +
    `roll=(${rollingDisplacement[0].toFixed(3)},${rollingDisplacement[1].toFixed(3)})/${(d.rollingDt ?? 0).toFixed(2)}s ` +
    `rollStatus=${d.rollingStatus} intent·roll=${d.dots?.intentRollingVelocity ?? '—'} ` +
    `assist=${d.locomotionAssist ? `${d.locomotionAssist.fwdVel}->${d.locomotionAssist.targetSpeed} a=(${d.locomotionAssist.accel?.[0] ?? '—'},${d.locomotionAssist.accel?.[1] ?? '—'}) n=${d.locomotionAssist.drivenBones}` : 'off'} ` +
    `particleStatus=${d.particleStatus} intent·particle=${d.dots?.intentParticleVelocity ?? '—'} ` +
    `issues=${d.likelyIssues.length ? d.likelyIssues.join('|') : 'none'}`
  )
  const motionDir = normalize2(velocity)
  const facingDir = navYaw == null ? null : [Math.sin(navYaw), Math.cos(navYaw)]
  const facingDotMotion = facingDir && motionDir ? dot2(facingDir, motionDir) : null
  if (facingDotMotion != null) {
    const delta = Math.acos(Math.max(-1, Math.min(1, facingDotMotion))) * 180 / Math.PI
    const tag = delta < 30 ? '✓ aligned' : delta > 150 ? '✗ BACKWARDS' : delta > 60 ? '⚠ sideways' : '~ off'
    console.log(`  [DIR-FINAL] facing→displacement Δ = ${delta.toFixed(1)}° ${tag}`)
  }
}

export function lHandDelta(yaw, bfX, bfZ) {
  return yaw == null ? null : computeSignedAngleOnHorizontal(bfX, bfZ, Math.sin(yaw), Math.cos(yaw))
}

export function auditAllPoses() {
  const poseIds = ['stand', 'kneel', 'pushup', 'prone']
  console.group('[POSE AUDIT] Directional consistency check')
  for (const id of poseIds) {
    const pose = getCachedPose(id)
    if (pose) auditPose(pose)
  }
  console.groupEnd()
}

export function auditPose(pose) {
  const b = pose.bones
  const pelvis = b.pelvis
  const chest = b.chest
  if (!pelvis || !chest) {
    console.warn(`  [${pose.id}] missing pelvis or chest — skipping`)
    return
  }

  // Body forward = pelvis → chest projected on XZ, or if that's degenerate
  // (body is horizontal), use spine→head projection with Y component
  const bfX = chest[0] - pelvis[0]
  const bfY = chest[1] - pelvis[1]
  const bfZ = chest[2] - pelvis[2]
  const horizontalLen = Math.hypot(bfX, bfZ)

  const bodyYaw = horizontalLen > 0.05 ? Math.atan2(bfX, bfZ) : 0
  const bodyPitch = Math.atan2(bfY, Math.hypot(bfX, bfZ))  // + = head up (standing), - = head down

  // Belly direction (upright if spine goes up)
  const belly = bodyPitch > 0.3 ? 'UP (normal stance)' :
                bodyPitch < -0.3 ? 'DOWN (prone/pushup)' :
                'HORIZONTAL'

  console.log(`  [${pose.id}]  body_yaw=${yawDeg(bodyYaw)}° pitch=${yawDeg(bodyPitch)}° belly=${belly}`)

  // Knees: shin relative to thigh. For standing/kneeling, shin should go DOWN
  // (and very slightly forward). For pushup/prone, shin goes BACKWARD.
  const kneePair = (side) => {
    const thigh = b[`${side}Thigh`]
    const shin = b[`${side}Shin`]
    if (!thigh || !shin) return null
    return {
      dx: shin[0] - thigh[0],
      dy: shin[1] - thigh[1],
      dz: shin[2] - thigh[2],
    }
  }
  const L = kneePair('left'), R = kneePair('right')
  if (L && R) {
    const kneeForward = (L.dz + R.dz) / 2    // +Z = forward
    const kneeDown = -(L.dy + R.dy) / 2       // +Y = up, so -Y = down
    const kneeDir = kneeForward > 0.15 ? 'FORWARD' :
                    kneeForward < -0.15 ? 'BACKWARD' :
                    'STRAIGHT-DOWN'
    console.log(`           knee: ${kneeDir}  (z=${kneeForward.toFixed(2)}, down=${kneeDown.toFixed(2)})`)
  }

  // Elbows: forearm relative to upper arm
  const elbowPair = (side) => {
    const up = b[`${side}UpperArm`]
    const fa = b[`${side}Forearm`]
    if (!up || !fa) return null
    return { dx: fa[0] - up[0], dy: fa[1] - up[1], dz: fa[2] - up[2] }
  }
  const EL = elbowPair('left'), ER = elbowPair('right')
  if (EL && ER) {
    const elbowForward = (EL.dz + ER.dz) / 2
    const elbowDown = -(EL.dy + ER.dy) / 2
    const elbowDir = elbowForward > 0.15 ? 'FORWARD (pushup)' :
                     elbowForward < -0.15 ? 'BACKWARD (awkward)' :
                     'STRAIGHT-DOWN (standing)'
    console.log(`           elbow: ${elbowDir}  (z=${elbowForward.toFixed(2)}, down=${elbowDown.toFixed(2)})`)
  }

  // Toes: foot relative to shin
  const toePair = (side) => {
    const shin = b[`${side}Shin`]
    const foot = b[`${side}Foot`]
    if (!shin || !foot) return null
    return { dx: foot[0] - shin[0], dy: foot[1] - shin[1], dz: foot[2] - shin[2] }
  }
  const TL = toePair('left'), TR = toePair('right')
  if (TL && TR) {
    const toeForward = (TL.dz + TR.dz) / 2
    const toeDir = toeForward > 0.10 ? 'FORWARD' :
                   toeForward < -0.10 ? 'BACKWARD' :
                   'STRAIGHT-DOWN'
    console.log(`           toe:   ${toeDir}  (z=${toeForward.toFixed(2)})`)
  }

  // Symmetry check — left side should mirror right side (same Y, same |X|, same Z)
  const asymBones = []
  for (const name of Object.keys(b)) {
    if (!name.startsWith('left')) continue
    const rightName = 'right' + name.slice(4)
    const L = b[name], R = b[rightName]
    if (!L || !R) continue
    if (Math.abs(L[1] - R[1]) > 0.02) asymBones.push(`${name} Y`)
    if (Math.abs(L[2] - R[2]) > 0.02) asymBones.push(`${name} Z`)
    if (Math.abs(L[0] + R[0]) > 0.02) asymBones.push(`${name} X-mirror`)
  }
  if (asymBones.length > 0) {
    console.warn(`           ⚠ asymmetric bones: ${asymBones.join(', ')}`)
  } else {
    console.log(`           ✓ left-right symmetric`)
  }
}
