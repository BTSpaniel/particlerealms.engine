// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/active-body/PhysicsMotor.js — extracted from ActiveBodySystem.js
// (Ragdoll Stack Consolidation Roadmap, Phase 7). Owns the pure
// physics-application layer for the humanoid Verlet/PBD ragdoll: initial
// walking-skeleton kinematic pose construction, pelvis anchoring, per-bone
// joint-torque drive, and hinge-limit computation/enforcement + compliance
// scaling. Separate concern from pose-TARGET computation (still in
// ActiveBodySystem.js) — this module only turns targets/limits into forces
// applied to the ragdoll's particles.

import {
  BONE_NAMES,
} from './ActiveBodySystem.js'

export const JOINT_STIFFNESS = {
  // Per-joint stiffness (Nm/rad equivalent). Higher = snappier motor.
  spine: 400, spine1: 350, chest: 300,
  neck: 200, head: 150,
  leftShoulder: 350, rightShoulder: 350,
  leftUpperArm: 250, rightUpperArm: 250,
  leftForearm: 200, rightForearm: 200,
  leftHand: 80, rightHand: 80,
  leftThigh: 500, rightThigh: 500,
  leftShin: 400, rightShin: 400,
  leftFoot: 250, rightFoot: 250,
}

export function buildWalkingSkeleton(anchor, nav, m) {
  const wx = anchor[0], wy = anchor[1], wz = anchor[2]

  // CRITICAL: bone particle distances MUST match PBDRagdoll._configureBoneLengths()
  // exactly, or distance constraints will fight the spawn pose. Each child is
  // placed at parent_position + offset_with_magnitude_equal_to_bone_length.

  // Bone lengths (from measurements, mirroring _configureBoneLengths):
  const spineLen     = m.torsoLength * 0.33    // pelvis → spine
  const spine1Len    = m.torsoLength * 0.33    // spine → spine1
  const chestLen     = m.torsoLength * 0.34    // spine1 → chest
  const neckLen      = m.neckLength             // chest → neck
  const headLen      = m.headRadius * 2         // neck → head
  const shoulderLen  = m.shoulderWidth * 0.3   // chest → shoulder
  const upperArmLen  = m.upperArmLength         // shoulder → upperArm
  const forearmLen   = m.forearmLength          // upperArm → forearm
  const handLen      = m.handLength             // forearm → hand
  const thighLen     = m.thighLength            // pelvis → thigh
  const shinLen      = m.shinLength             // thigh → shin
  const footLen      = m.footLength             // shin → foot

  const spawnMode = nav?.poseMode || nav?.spawnMode || 'drop'
  const groundedSpawn = spawnMode === 'stand' || spawnMode === 'grounded'

  // Spawn body 0.6m above ground, slightly tilted forward (+Z). The forward
  // lean immediately gives gravity a moment arm to tip the body, so it
  // doesn't balance perfectly upright in slow-mo before falling.
  //
  // Why 0.6m and not 0.3m: a classic PBD ragdoll failure mode is spawning
  // with feet at or near the ground plane. On the first solver step,
  // gravity drops the foot particles a few cm; if that takes them BELOW
  // y=0 (the ground plane collider), the penetration resolver fires a
  // large position correction in one frame, and the distance constraints
  // transmit that kick up the shin/thigh as huge velocities (the 88 m/s
  // pelvis explosion seen in debug logs). 0.6m gives enough clearance
  // that the body settles into ground contact gently over several
  // frames instead of punching through and bouncing back.
  const SPAWN_GAP = groundedSpawn ? 0.485 : 0.6
  const _hipOffset = m.hipWidth * 0.25
  const _thighDrop = Math.sqrt(Math.max(0, m.thighLength * m.thighLength - _hipOffset * _hipOffset))
  const pelvisY = wy + SPAWN_GAP + footLen + shinLen + _thighDrop
  const pelvisPos = [wx, pelvisY, wz]

  // Forward lean — each spine bone tilts forward 12° (sin=0.2). The total
  // 3D bone length stays exactly equal to the constraint rest length, so PBD
  // doesn't fire corrections at spawn. Forward lean creates a moment arm so
  // gravity tips the body immediately instead of balancing in slow-mo.
  const LEAN_SIN = groundedSpawn ? 0 : 0.20
  const LEAN_COS = Math.sqrt(1 - LEAN_SIN * LEAN_SIN)

  const spinePos   = [wx, pelvisY + spineLen * LEAN_COS, wz + spineLen * LEAN_SIN]
  const spine1Pos  = [wx, spinePos[1] + spine1Len * LEAN_COS, spinePos[2] + spine1Len * LEAN_SIN]
  const chestPos   = [wx, spine1Pos[1] + chestLen * LEAN_COS, spine1Pos[2] + chestLen * LEAN_SIN]
  const neckPos    = [wx, chestPos[1] + neckLen * LEAN_COS, chestPos[2] + neckLen * LEAN_SIN]
  const headPos    = [wx, neckPos[1] + headLen * LEAN_COS, neckPos[2] + headLen * LEAN_SIN]

  // Arms — slight forward bend at elbow so it hinges forward (toward +Z).
  // ELBOW_BEND ratio: 0.0 = straight, 0.2 = 11° pre-bent forward.
  // Each forearm position = upperArm + bone_length × (slight forward, mostly down).
  const ELBOW_BEND = 0.18
  const elbowSin = ELBOW_BEND
  const elbowCos = Math.sqrt(1 - elbowSin * elbowSin)

  const lShoulderPos  = [chestPos[0] - shoulderLen, chestPos[1], chestPos[2]]
  const lUpperArmPos  = [lShoulderPos[0], lShoulderPos[1] - upperArmLen, lShoulderPos[2]]
  const lForearmPos   = [lUpperArmPos[0], lUpperArmPos[1] - forearmLen * elbowCos, lUpperArmPos[2] + forearmLen * elbowSin]
  const lHandPos      = [lForearmPos[0], lForearmPos[1] - handLen * elbowCos, lForearmPos[2] + handLen * elbowSin]
  const rShoulderPos  = [chestPos[0] + shoulderLen, chestPos[1], chestPos[2]]
  const rUpperArmPos  = [rShoulderPos[0], rShoulderPos[1] - upperArmLen, rShoulderPos[2]]
  const rForearmPos   = [rUpperArmPos[0], rUpperArmPos[1] - forearmLen * elbowCos, rUpperArmPos[2] + forearmLen * elbowSin]
  const rHandPos      = [rForearmPos[0], rForearmPos[1] - handLen * elbowCos, rForearmPos[2] + handLen * elbowSin]

  // Legs — pelvis→thigh exactly thighLen. Knee pre-bent BACKWARD (shin goes
  // toward -Z = behind body) so knee hinges in correct direction.
  // KNEE_BEND ratio: 0.18 = ~11° backward bend.
  const hipOffset = m.hipWidth * 0.25
  const thighDrop = Math.sqrt(Math.max(0, thighLen * thighLen - hipOffset * hipOffset))
  const KNEE_BEND = 0.18
  const kneeSin = KNEE_BEND
  const kneeCos = Math.sqrt(1 - kneeSin * kneeSin)

  const lThighPos = [pelvisPos[0] - hipOffset, pelvisPos[1] - thighDrop, pelvisPos[2]]
  const lShinPos  = [lThighPos[0], lThighPos[1] - shinLen * kneeCos, lThighPos[2] - shinLen * kneeSin]
  const lFootPos  = [lShinPos[0], lShinPos[1] - footLen * kneeCos, lShinPos[2] - footLen * kneeSin + footLen * 0.5]
  const rThighPos = [pelvisPos[0] + hipOffset, pelvisPos[1] - thighDrop, pelvisPos[2]]
  const rShinPos  = [rThighPos[0], rThighPos[1] - shinLen * kneeCos, rThighPos[2] - shinLen * kneeSin]
  const rFootPos  = [rShinPos[0], rShinPos[1] - footLen * kneeCos, rShinPos[2] - footLen * kneeSin + footLen * 0.5]

  const positions = new Map([
    ['pelvis', pelvisPos],
    ['spine', spinePos], ['spine1', spine1Pos], ['chest', chestPos],
    ['neck', neckPos], ['head', headPos],
    ['leftShoulder', lShoulderPos], ['leftUpperArm', lUpperArmPos],
    ['leftForearm', lForearmPos], ['leftHand', lHandPos],
    ['rightShoulder', rShoulderPos], ['rightUpperArm', rUpperArmPos],
    ['rightForearm', rForearmPos], ['rightHand', rHandPos],
    ['leftThigh', lThighPos], ['leftShin', lShinPos], ['leftFoot', lFootPos],
    ['rightThigh', rThighPos], ['rightShin', rShinPos], ['rightFoot', rFootPos],
  ])

  return {
    getBoneWorldPosition(name) { return positions.get(name) || null },
  }
}

export function setRagdollPose(ragdoll, anchor, m, options = {}) {
  const skeleton = buildWalkingSkeleton(anchor, { velocity: [0, 0], walkPhase: 0, speed: 0, poseMode: options.mode || 'drop' }, m)
  for (let i = 0; i < BONE_NAMES.length; i++) {
    const pos = skeleton.getBoneWorldPosition(BONE_NAMES[i])
    if (pos) {
      ragdoll.bones[i]?.particle?.setPosition(pos[0], pos[1], pos[2])
    }
  }
}

export function currentPelvisPosition(ragdoll) {
  const pelvis = ragdoll?.bones?.[0]?.particle
  return pelvis ? [pelvis.x, pelvis.y, pelvis.z] : [0, 0, 0]
}

export function applyPelvisAnchor(ragdoll, skeleton, dt) {
  const pelvis = ragdoll.boneMap?.get('pelvis') || ragdoll.bones[0]
  if (!pelvis) return
  const target = skeleton.getBoneWorldPosition('pelvis')
  if (!target) return

  const p = pelvis.particle
  // Strong PD spring on pelvis — high stiffness, high damping for stability
  const STIFFNESS = 800        // N/m equivalent
  const DAMPING = 60           // Ns/m equivalent
  const fx = (target[0] - p.x) * STIFFNESS - p.vx * DAMPING
  const fy = (target[1] - p.y) * STIFFNESS - p.vy * DAMPING
  const fz = (target[2] - p.z) * STIFFNESS - p.vz * DAMPING

  // Clamp force magnitude to prevent explosion
  const fMag = Math.sqrt(fx * fx + fy * fy + fz * fz)
  const FMAX = 4000
  const scale = fMag > FMAX ? FMAX / fMag : 1

  p.vx += fx * scale * dt
  p.vy += fy * scale * dt
  p.vz += fz * scale * dt
}

export function applyJointTorques(ragdoll, skeleton, dt, state, driveByBone = null) {
  const strengthMul = state === 'stumble' ? 0.5 : 1.0

  for (const bone of ragdoll.bones) {
    if (!bone || bone.parentId < 0) continue
    const parent = ragdoll.bones[bone.parentId]
    if (!parent) continue

    const childTarget = skeleton.getBoneWorldPosition(bone.name)
    const parentTarget = skeleton.getBoneWorldPosition(parent.name)
    if (!childTarget || !parentTarget) continue

    const childP = bone.particle
    const parentP = parent.particle

    // Current bone direction (parent → child)
    let cdx = childP.x - parentP.x
    let cdy = childP.y - parentP.y
    let cdz = childP.z - parentP.z
    const cLen = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz)
    if (cLen < 0.001) continue
    cdx /= cLen; cdy /= cLen; cdz /= cLen

    // Target bone direction
    let tdx = childTarget[0] - parentTarget[0]
    let tdy = childTarget[1] - parentTarget[1]
    let tdz = childTarget[2] - parentTarget[2]
    const tLen = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz)
    if (tLen < 0.001) continue
    tdx /= tLen; tdy /= tLen; tdz /= tLen

    // Angle error vector (cross product) = axis × sin(angle)
    // This is perpendicular to current direction, points toward target rotation
    const ex = cdy * tdz - cdz * tdy
    const ey = cdz * tdx - cdx * tdz
    const ez = cdx * tdy - cdy * tdx

    // Torque = axis × current_direction = force at child end perpendicular to bone
    // This rotates the bone toward target direction
    const fx = ey * cdz - ez * cdy
    const fy = ez * cdx - ex * cdz
    const fz = ex * cdy - ey * cdx

    // Scale by stiffness × bone length × strength
    const drive = driveByBone?.get?.(bone.name)
    const k = (drive?.stiffness ?? JOINT_STIFFNESS[bone.name] ?? 200) * strengthMul
    const torqueScale = k * cLen

    // Velocity damping along the torque direction
    // (relative velocity of child vs parent perpendicular to bone)
    const relVx = childP.vx - parentP.vx
    const relVy = childP.vy - parentP.vy
    const relVz = childP.vz - parentP.vz
    const damping = drive?.damping ?? 8

    // Apply torque as opposite forces at child and parent
    const ax = (fx * torqueScale - relVx * damping)
    const ay = (fy * torqueScale - relVy * damping)
    const az = (fz * torqueScale - relVz * damping)

    // Clamp acceleration to prevent explosion
    const aMag = Math.sqrt(ax * ax + ay * ay + az * az)
    const AMAX = 2000
    const s = aMag > AMAX ? AMAX / aMag : 1

    // Apply at child (positive) and parent (negative reaction, scaled by mass ratio)
    const childMul = 1.0
    const parentMul = 0.3  // Parent moves less (it's anchored by its own parent)

    childP.vx += ax * s * dt * childMul
    childP.vy += ay * s * dt * childMul
    childP.vz += az * s * dt * childMul

    if (!parentP.isFixed() && parent.name !== 'pelvis') {
      parentP.vx -= ax * s * dt * parentMul
      parentP.vy -= ay * s * dt * parentMul
      parentP.vz -= az * s * dt * parentMul
    }
  }
}

export function computeHingeLimits(ragdoll, m, jointLimitsByBone = null) {
  const limits = []
  const map = ragdoll.boneMap || new Map(ragdoll.bones.filter(Boolean).map(b => [b.name, b]))
  const get = (name) => map.get(name) || ragdoll.bones.find(b => b?.name === name)
  const strength = complianceStrength(jointLimitsByBone)
  const strengthFor = (...names) => complianceStrengthFor(jointLimitsByBone, names, strength)
  const swingScaleFor = (names, defaultSwingDeg) => jointSwingScaleFor(jointLimitsByBone, names, defaultSwingDeg)

  // Each entry: { a, b, minDist, maxDist }
  // - maxDist prevents hyperextension (joint goes past straight)
  // - minDist prevents over-folding (joint folds in half completely)

  for (const side of ['left', 'right']) {
    const pelvis = get('pelvis')
    const shin = get(`${side}Shin`)
    const foot = get(`${side}Foot`)
    const shoulder = get(`${side}Shoulder`)
    const forearm = get(`${side}Forearm`)
    const hand = get(`${side}Hand`)

    // Knee: pelvis ↔ shin — knee can bend ~90° max (real anatomy)
    // Straight = thighLen + shinLen. 90° bend ≈ 70% of straight.
    if (pelvis && shin) {
      const straight = m.thighLength + m.shinLength
      limits.push({
        a: pelvis.particle, b: shin.particle,
        minDist: straight * 0.72,   // knee can bend ~90° max
        maxDist: straight * 0.96,   // can't hyperextend past 96%
        strength: strengthFor(`${side}Shin`),
      })
    }

    // Whole leg: pelvis ↔ foot — full leg length stays mostly extended
    if (pelvis && foot) {
      const straight = m.thighLength + m.shinLength + m.footLength
      limits.push({
        a: pelvis.particle, b: foot.particle,
        minDist: straight * 0.70,   // foot stays away from pelvis (no fetal curl)
        maxDist: straight * (0.94 + 0.03 * swingScaleFor([`${side}Thigh`, `${side}Foot`], 45)),
        strength: strengthFor(`${side}Shin`, `${side}Foot`),
      })
    }

    // Elbow: shoulder ↔ forearm — elbow can bend further than knee
    if (shoulder && forearm) {
      const straight = m.upperArmLength + m.forearmLength
      limits.push({
        a: shoulder.particle, b: forearm.particle,
        minDist: straight * 0.55,
        maxDist: straight * 0.96,
        strength: strengthFor(`${side}Forearm`),
      })
    }

    // Whole arm: shoulder ↔ hand
    if (shoulder && hand) {
      const straight = m.upperArmLength + m.forearmLength + m.handLength
      limits.push({
        a: shoulder.particle, b: hand.particle,
        minDist: straight * 0.50,
        maxDist: straight * (0.94 + 0.03 * swingScaleFor([`${side}Shoulder`, `${side}Hand`], 45)),
        strength: strengthFor(`${side}Forearm`, `${side}Hand`),
      })
    }
  }

  // Spine — RIGID like a real spinal column. The vertebrae are connected by
  // tight ligaments. Real spine has ~5° flexion per vertebra at most.
  // We treat the entire trunk as nearly rigid (95-100% of straight length).
  const pelvis = get('pelvis')
  const spine1 = get('spine1')
  const chest = get('chest')
  const neck = get('neck')
  const head = get('head')

  // Pelvis ↔ spine1 — RIGID (lower back)
  if (pelvis && spine1) {
    const straight = m.torsoLength * 0.66
    limits.push({
      a: pelvis.particle, b: spine1.particle,
      minDist: straight * 0.97, maxDist: straight * 1.0,
    })
  }

  // Pelvis ↔ chest — RIGID trunk
  if (pelvis && chest) {
    const straight = m.torsoLength
    limits.push({
      a: pelvis.particle, b: chest.particle,
      minDist: straight * 0.95, maxDist: straight * 1.0,
    })
  }

  // Pelvis ↔ neck — RIGID upper body
  if (pelvis && neck) {
    const straight = m.torsoLength + m.neckLength
    limits.push({
      a: pelvis.particle, b: neck.particle,
      minDist: straight * 0.93, maxDist: straight * 1.0,
    })
  }

  // Pelvis ↔ head — full spine, slight neck flex allowed
  if (pelvis && head) {
    const straight = m.torsoLength + m.neckLength + m.headRadius * 2
    limits.push({
      a: pelvis.particle, b: head.particle,
      minDist: straight * 0.90, maxDist: straight * 1.0,
    })
  }

  // Chest ↔ head — neck/head can tilt slightly forward only
  if (chest && head) {
    const straight = m.neckLength + m.headRadius * 2
    limits.push({
      a: chest.particle, b: head.particle,
      minDist: straight * 0.85, maxDist: straight * 1.0,
    })
  }

  // ─── TRUNK CROSS-BRACING (rigid with minor twist) ───────────────────────
  // Real spine rotation: ~30° thoracic + ~5° lumbar = ~35° total twist max.
  // We use a web of near-rigid distance constraints that triangulate the
  // torso in 3D. Slight slack (~1-2%) allows small twist; tighter slack
  // would lock it completely.
  //
  // Constraints:
  //   pelvis ↔ leftShoulder   (vertical edge)
  //   pelvis ↔ rightShoulder  (vertical edge)
  //   leftShoulder ↔ rightShoulder  (shoulder horizontal)
  //   leftThigh ↔ rightThigh  (hip horizontal)
  //   leftThigh ↔ rightShoulder    ← X-brace diagonal (the KEY for no twist)
  //   rightThigh ↔ leftShoulder    ← X-brace diagonal
  //
  // Without the X-diagonals the torso can still twist (the rectangle can
  // deform into a parallelogram). With diagonals the only motion left is
  // the tiny slack in the constraints → realistic minor twist.
  const lShoulder = get('leftShoulder')
  const rShoulder = get('rightShoulder')
  const lThigh = get('leftThigh')
  const rThigh = get('rightThigh')
  const spineStrength = strengthFor('spine', 'spine1', 'chest')
  const neckStrength = strengthFor('neck', 'head')
  const spineSlackScale = Math.max(
    swingScaleFor(['spine', 'spine1', 'chest'], 15),
    jointTwistScaleFor(jointLimitsByBone, ['spine', 'spine1', 'chest'], 25)
  )
  const neckSlackScale = Math.max(
    swingScaleFor(['neck', 'head'], 60),
    jointTwistScaleFor(jointLimitsByBone, ['neck', 'head'], 30)
  )

  const SLACK_LO = 1 - 0.015 * spineSlackScale
  const SLACK_HI = 1 + 0.015 * spineSlackScale

  const addBrace = (a, b) => {
    if (!a || !b) return
    const dx = b.particle.x - a.particle.x
    const dy = b.particle.y - a.particle.y
    const dz = b.particle.z - a.particle.z
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    limits.push({
      a: a.particle, b: b.particle,
      minDist: d * SLACK_LO, maxDist: d * SLACK_HI,
      strength: spineStrength,
    })
  }

  // Vertical edges (pelvis → shoulders)
  addBrace(pelvis, lShoulder)
  addBrace(pelvis, rShoulder)

  // Horizontal edges (hips and shoulders)
  addBrace(lThigh, rThigh)
  addBrace(lShoulder, rShoulder)

  // X-diagonals — THE critical constraint for preventing spine rotation.
  // Any twist of the shoulders relative to hips changes these diagonal
  // lengths, so locking them effectively locks trunk rotation.
  addBrace(lThigh, rShoulder)
  addBrace(rThigh, lShoulder)

  // ─── HEAD TRIANGULATION ─────────────────────────────────────────────────
  // Same principle as torso X-bracing: shoulder↔head diagonals prevent the
  // head from rotating freely. Real neck rotation is ±80° — we allow ~3%
  // slack which gives ~40° rotation before constraints kick in.
  const NECK_SLACK_LO = 1 - 0.05 * neckSlackScale
  const NECK_SLACK_HI = 1 + 0.05 * neckSlackScale
  const addNeckBrace = (a, b) => {
    if (!a || !b) return
    const dx = b.particle.x - a.particle.x
    const dy = b.particle.y - a.particle.y
    const dz = b.particle.z - a.particle.z
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    limits.push({
      a: a.particle, b: b.particle,
      minDist: d * NECK_SLACK_LO, maxDist: d * NECK_SLACK_HI,
      strength: neckStrength,
    })
  }
  addNeckBrace(lShoulder, head)
  addNeckBrace(rShoulder, head)

  // ─── DIRECTIONAL JOINT LIMITS (via cross-distance constraints) ──────────
  //
  // Standard PBD distance constraints only control how FAR two particles
  // are. To control joint DIRECTION (knee forward not backward, elbow
  // forward not hyperextending, etc.) we add cross-body constraints that
  // change length based on joint direction.
  //
  // Principle: pick an anchor far from the joint (e.g. opposite shoulder)
  // and measure distance. When the joint bends the "wrong way" the
  // distance blows past its rest value — cap it.

  const lShin = get('leftShin')
  const rShin = get('rightShin')
  const lFoot = get('leftFoot')
  const rFoot = get('rightFoot')
  const lUpArm = get('leftUpperArm')
  const rUpArm = get('rightUpperArm')
  const lForearm = get('leftForearm')
  const rForearm = get('rightForearm')
  const lHand = get('leftHand')
  const rHand = get('rightHand')

  // Helper: add a one-sided max constraint (locks upper bound only).
  const addMaxBrace = (a, b, scale = 1.12, limitStrength = strength) => {
    if (!a || !b) return
    const dx = b.particle.x - a.particle.x
    const dy = b.particle.y - a.particle.y
    const dz = b.particle.z - a.particle.z
    const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz)
    limits.push({
      a: a.particle, b: b.particle,
      minDist: d0 * 0.3,    // plenty of flex
      maxDist: d0 * scale,  // prevent bending wrong way
      strength: limitStrength,
    })
  }

  // KNEES — shin↔opposite shoulder: caps backward leg swing.
  // Flex forward (knee to belly) = shortens dist ✓
  // Hyperextend backward = lengthens dist ✗ → blocked by max
  addMaxBrace(lShin, rShoulder, 1.12, strengthFor('leftShin'))
  addMaxBrace(rShin, lShoulder, 1.12, strengthFor('rightShin'))

  // FEET — foot↔opposite shoulder: prevents feet splaying backward or
  // legs scissoring. Also keeps foot under the body when standing.
  addMaxBrace(lFoot, rShoulder, 1.15 * swingScaleFor(['leftFoot'], 30), strengthFor('leftFoot'))
  addMaxBrace(rFoot, lShoulder, 1.15 * swingScaleFor(['rightFoot'], 30), strengthFor('rightFoot'))

  // FEET lateral — foot↔opposite hip: prevents feet from crossing over
  // each other (leftFoot going too far right, vice versa). In rest
  // stance, leftFoot is near leftHip, far from rightHip. Going CLOSER
  // to rightHip means crossing body — we clamp min distance.
  if (lFoot && rThigh) {
    const dx = rThigh.particle.x - lFoot.particle.x
    const dy = rThigh.particle.y - lFoot.particle.y
    const dz = rThigh.particle.z - lFoot.particle.z
    const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz)
    limits.push({
      a: lFoot.particle, b: rThigh.particle,
      minDist: d0 * 0.4,   // prevent feet crossing completely
      maxDist: d0 * 2.0,   // allow wide leg stance
      strength: strengthFor('leftFoot', 'rightThigh'),
    })
  }
  if (rFoot && lThigh) {
    const dx = lThigh.particle.x - rFoot.particle.x
    const dy = lThigh.particle.y - rFoot.particle.y
    const dz = lThigh.particle.z - rFoot.particle.z
    const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz)
    limits.push({
      a: rFoot.particle, b: lThigh.particle,
      minDist: d0 * 0.4,
      maxDist: d0 * 2.0,
      strength: strengthFor('rightFoot', 'leftThigh'),
    })
  }

  // ELBOWS — forearm↔opposite shoulder: caps backward hyperextension.
  // Elbow flex (hand to shoulder) shortens dist ✓
  // Elbow hyperextension (arm locked backward) lengthens dist ✗
  addMaxBrace(lForearm, rShoulder, 1.10, strengthFor('leftForearm'))
  addMaxBrace(rForearm, lShoulder, 1.10, strengthFor('rightForearm'))

  // HANDS — hand↔opposite hip: limits arm behind-the-back reach.
  // Shoulder extension past ~50° (arm behind body) would push hand
  // away from opposite hip. Cap at 1.12× rest distance.
  if (lHand && rThigh) {
    const dx = rThigh.particle.x - lHand.particle.x
    const dy = rThigh.particle.y - lHand.particle.y
    const dz = rThigh.particle.z - lHand.particle.z
    const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz)
    limits.push({
      a: lHand.particle, b: rThigh.particle,
      minDist: d0 * 0.35,  // arms can cross in front of body
      maxDist: d0 * 1.12 * swingScaleFor(['leftHand'], 30),  // arms can't go too far behind
      strength: strengthFor('leftHand'),
    })
  }
  if (rHand && lThigh) {
    const dx = lThigh.particle.x - rHand.particle.x
    const dy = lThigh.particle.y - rHand.particle.y
    const dz = lThigh.particle.z - rHand.particle.z
    const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz)
    limits.push({
      a: rHand.particle, b: lThigh.particle,
      minDist: d0 * 0.35,
      maxDist: d0 * 1.12 * swingScaleFor(['rightHand'], 30),
      strength: strengthFor('rightHand'),
    })
  }

  // SHOULDERS / UPPER ARM rotation — upperArm to same-side hip: prevents
  // upper arm from rotating completely behind the body. At rest, upper
  // arm points down near the hip. If shoulder extends > 90° (arm behind
  // back), upperArm moves away from the same-side hip.
  if (lUpArm && lThigh) {
    const dx = lThigh.particle.x - lUpArm.particle.x
    const dy = lThigh.particle.y - lUpArm.particle.y
    const dz = lThigh.particle.z - lUpArm.particle.z
    const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz)
    limits.push({
      a: lUpArm.particle, b: lThigh.particle,
      minDist: d0 * 0.4,   // allow arm raising (upperArm up)
      maxDist: d0 * 1.25 * swingScaleFor(['leftShoulder', 'leftUpperArm'], 60),  // limit arm going backward
      strength: strengthFor('leftShoulder', 'leftUpperArm'),
    })
  }
  if (rUpArm && rThigh) {
    const dx = rThigh.particle.x - rUpArm.particle.x
    const dy = rThigh.particle.y - rUpArm.particle.y
    const dz = rThigh.particle.z - rUpArm.particle.z
    const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz)
    limits.push({
      a: rUpArm.particle, b: rThigh.particle,
      minDist: d0 * 0.4,
      maxDist: d0 * 1.25 * swingScaleFor(['rightShoulder', 'rightUpperArm'], 60),
      strength: strengthFor('rightShoulder', 'rightUpperArm'),
    })
  }

  for (const limit of limits) limit.strength ??= strength
  return limits
}

export function applyHingeLimits(limits) {
  if (!limits) return
  for (const lim of limits) {
    const a = lim.a, b = lim.b
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist < 0.0001) continue

    // Determine target distance (clamped to [min, max])
    let target = dist
    if (dist > lim.maxDist) target = lim.maxDist
    else if (lim.minDist != null && dist < lim.minDist) target = lim.minDist
    else continue   // within range, nothing to do

    const correction = (dist - target) * (lim.strength ?? 1)  // positive = too far, negative = too close
    const nx = dx / dist, ny = dy / dist, nz = dz / dist

    const wA = a.invMass, wB = b.invMass
    const wSum = wA + wB
    if (wSum === 0) continue
    const fracA = wA / wSum
    const fracB = wB / wSum

    if (!a.isFixed()) {
      a.x += nx * correction * fracA
      a.y += ny * correction * fracA
      a.z += nz * correction * fracA
    }
    if (!b.isFixed()) {
      b.x -= nx * correction * fracB
      b.y -= ny * correction * fracB
      b.z -= nz * correction * fracB
    }
  }
}

export function complianceStrength(jointLimitsByBone) {
  if (!jointLimitsByBone?.values) return 1
  let compliance = 0
  let count = 0
  for (const limits of jointLimitsByBone.values()) {
    if (!limits || typeof limits.compliance !== 'number') continue
    compliance += Math.max(0, limits.compliance)
    count++
  }
  if (count === 0) return 1
  return Math.max(0.25, Math.min(1, 1 / (1 + (compliance / count) * 1000)))
}

export function complianceStrengthFor(jointLimitsByBone, names, fallback = 1) {
  if (!jointLimitsByBone?.get) return fallback
  let compliance = 0
  let count = 0
  for (const name of names) {
    const limits = jointLimitsByBone.get(name)
    if (!limits || typeof limits.compliance !== 'number') continue
    compliance += Math.max(0, limits.compliance)
    count++
  }
  if (count === 0) return fallback
  return Math.max(0.25, Math.min(1, 1 / (1 + (compliance / count) * 1000)))
}

export function jointSwingScaleFor(jointLimitsByBone, names, defaultSwingDeg) {
  if (!jointLimitsByBone?.get || !defaultSwingDeg) return 1
  let swingDeg = 0
  let count = 0
  for (const name of names) {
    const limits = jointLimitsByBone.get(name)
    const deg = typeof limits?.swingDeg === 'number'
      ? limits.swingDeg
      : typeof limits?.swingRad === 'number'
        ? limits.swingRad * 180 / Math.PI
        : null
    if (deg == null) continue
    swingDeg += Math.max(0, deg)
    count++
  }
  if (count === 0) return 1
  const ratio = (swingDeg / count) / defaultSwingDeg
  return Math.max(0.85, Math.min(1.15, ratio))
}

export function jointTwistScaleFor(jointLimitsByBone, names, defaultTwistDeg) {
  if (!jointLimitsByBone?.get || !defaultTwistDeg) return 1
  let twistDeg = 0
  let count = 0
  for (const name of names) {
    const limits = jointLimitsByBone.get(name)
    const deg = typeof limits?.twistDeg === 'number'
      ? limits.twistDeg
      : typeof limits?.twistRad === 'number'
        ? limits.twistRad * 180 / Math.PI
        : null
    if (deg == null) continue
    twistDeg += Math.max(0, deg)
    count++
  }
  if (count === 0) return 1
  const ratio = (twistDeg / count) / defaultTwistDeg
  return Math.max(0.85, Math.min(1.15, ratio))
}
