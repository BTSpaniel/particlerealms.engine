// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BodyPoses — Data-driven pose library + biomechanical motor controller.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   POSE DATA
 * ══════════════════════════════════════════════════════════════════════
 *
 * Poses live in /data/poses/*.json. Each has:
 *   id, referenceHeight, rootBone, facing, bones{name:[x,y,z]}, rotations{name:[x,y,z,w]}
 *   verticality (0..100) — used by the blend space
 *
 * Sequences live in /data/sequences/*.json and chain poses, though the
 * NEW verticality system (see getPoseAtVerticality) supersedes discrete
 * sequence-time for getup — bodies blend continuously between adjacent
 * rungs of the verticality ladder:
 *
 *     0 ── 15 ── 25 ── 35 ── 45 ── 50 ── (>50 reserved)
 *   prone pushup quad  kneel half  stand   tiptoe/jump/reach
 *                            kneel
 *
 * The ladder is based on the clinical Postural Verticality Scale (PVS)
 * used in stroke rehab, cross-referenced with the Gross Motor Function
 * Measure (GMFM) and standard 1D animation blend trees.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   MOTOR: applyKinematicBlend — FOUR STACKED LAYERS
 * ══════════════════════════════════════════════════════════════════════
 *
 * For each bone we apply, in order:
 *
 *   1. SOFT POSITION NUDGE  (kinematic lerp, small % per frame)
 *      Guarantees pose convergence even when forces can't.
 *
 *   2. VELOCITY-CLAMPED PURSUIT  (capped at muscleSpeed m/s)
 *      Close to target = slower approach (ease-in). Far = full speed.
 *
 *   3. MASS-SCALED PD FORCE  (the one that actually does work)
 *         Kp = m · ω²
 *         Kd = 2 · m · ω · ζ          (ζ = dampingRatio)
 *         F  = Kp·(target - pos) - Kd·velocity
 *      Mass-scaled means a 20 kg pelvis and a 0.5 kg hand have the SAME
 *      natural frequency. Like real biological muscle — body parts reach
 *      their targets on the same time scale regardless of weight.
 *
 *   4. MUSCLE-TONE GRAVITY COMPENSATION  (postural)
 *      Bones above knee-height get 75% of their weight canceled so
 *      posture holds without the motor doing all the lifting. Real
 *      humans use passive muscle tone; we model the same.
 *
 *   + FORCE RISE-TIME FILTER (on the final force)
 *      Real muscles can't change force instantly. Rate-of-force-
 *      development (RFD) is 800-1500 N/s for untrained adults. Per-bone
 *      multipliers: thighs 0.7× (slow recruitment, biggest muscles),
 *      hands 1.4× (fast, small motor units). From EMG studies.
 *
 *   + ERROR-GATED DAMPING (near target)
 *      Within 5 cm of target, velocity is damped 30% per frame. Kills
 *      steady-state jitter where the PD motor fights imperceptible
 *      position deltas. Doesn't affect in-flight motion.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   BIOMECHANICAL CALIBRATION  (do not "fix" these without reading!)
 * ══════════════════════════════════════════════════════════════════════
 *
 *   forcePerKg = 15 × g    — untrained adult (not Olympic athlete)
 *                            peak quad ≈ 15g × 8kg = 1176 N (realistic)
 *
 *   maxForce = 1500 N      — absolute cap (big muscle groups)
 *
 *   forceRiseRate = 1200 N/s — typical RFD. Bumping this to 3000 makes
 *                              bodies feel robotic (athlete-level).
 *
 *   omega = 6-9 rad/s      — muscle response frequency (postural 5-7,
 *                            voluntary 8-12). Above 12 = twitchy.
 *
 *   dampingRatio = 0.7     — slight overshoot (natural muscle feel).
 *                            1.0 = critical, 1.2+ = sluggish/locked.
 *
 *   gravityTone = 0.75     — 75% of bone weight canceled via feedforward
 *                            for bones above toneYThreshold. Human
 *                            postural muscles do this automatically.
 *
 * ══════════════════════════════════════════════════════════════════════
 */

import { vec3Lerp } from '../../../core/math/MathVec3.js'

const POSE_CACHE = new Map()          // id → pose JSON
const SEQUENCE_CACHE = new Map()      // id → sequence JSON
const IDENTITY_QUAT = Object.freeze([0, 0, 0, 1])

function normalizeQuat(q) {
  if (!Array.isArray(q) || q.length !== 4) return [...IDENTITY_QUAT]
  const x = Number(q[0]) || 0
  const y = Number(q[1]) || 0
  const z = Number(q[2]) || 0
  const w = Number(q[3])
  const qw = Number.isFinite(w) ? w : 1
  const len = Math.hypot(x, y, z, qw)
  if (len <= 1e-8) return [...IDENTITY_QUAT]
  return [x / len, y / len, z / len, qw / len]
}

function quatFromYaw(yaw) {
  const h = yaw * 0.5
  return [0, Math.sin(h), 0, Math.cos(h)]
}

function quatMultiply(a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3]
  const bx = b[0], by = b[1], bz = b[2], bw = b[3]
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ])
}

function quatNlerp(a, b, t) {
  const qa = normalizeQuat(a)
  let qb = normalizeQuat(b)
  const dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]
  if (dot < 0) qb = [-qb[0], -qb[1], -qb[2], -qb[3]]
  return normalizeQuat([
    qa[0] + (qb[0] - qa[0]) * t,
    qa[1] + (qb[1] - qa[1]) * t,
    qa[2] + (qb[2] - qa[2]) * t,
    qa[3] + (qb[3] - qa[3]) * t,
  ])
}

export function normalizePose(data) {
  if (!data || typeof data !== 'object') return data
  data.schema ??= 'life.pose.v1'
  data.rotations ??= Object.create(null)
  for (const boneId of Object.keys(data.bones || {})) {
    const bone = data.bones[boneId]
    if (bone && typeof bone === 'object' && !Array.isArray(bone)) {
      data.bones[boneId] = bone.position || [0, 0, 0]
      if (bone.rotation && !data.rotations[boneId]) data.rotations[boneId] = bone.rotation
    }
    data.rotations[boneId] = normalizeQuat(data.rotations[boneId])
  }
  return data
}

/**
 * Load a single pose by id. Cached after first fetch.
 * URL matches the BodyAssembler pattern (`/data/...`) since the server
 * roots `Life/data/` as `/data/`.
 */
export async function loadPose(id) {
  if (POSE_CACHE.has(id)) return POSE_CACHE.get(id)
  const res = await fetch(`/data/poses/${id}.json`)
  if (!res.ok) throw new Error(`Pose not found: ${id}`)
  const data = normalizePose(await res.json())
  POSE_CACHE.set(id, data)
  return data
}

/**
 * Load a sequence and pre-load all poses referenced by its phases.
 */
export async function loadSequence(id) {
  if (SEQUENCE_CACHE.has(id)) return SEQUENCE_CACHE.get(id)
  const res = await fetch(`/data/sequences/${id}.json`)
  if (!res.ok) throw new Error(`Sequence not found: ${id}`)
  const seq = await res.json()
  // Pre-load all poses referenced by the sequence
  await Promise.all(seq.phases.map(p => loadPose(p.pose)))
  SEQUENCE_CACHE.set(id, seq)
  return seq
}

/**
 * Warm-cache everything we need for the active controller.
 * Loads both prone (face-down) and supine (face-up) getup sequences so the
 * controller can pick the right one based on the body's orientation when it
 * decides to stand up.
 */
export const WALK_CYCLE_POSE_IDS = Object.freeze([
  'walk_cycle_q0',
  'walk_cycle_q1',
  'walk_cycle_q2',
  'walk_cycle_q3',
])

/** Align CPG gait phase (φ=0 toe-off) with walk_cycle_q* heel-strike keys. */
export const WALK_CYCLE_PHASE_OFFSET = Math.PI * 0.5

export async function preloadStandardPoses() {
  await Promise.all([
    loadPose('stand'),
    loadPose('kneel'),
    loadPose('pushup'),
    loadPose('prone'),
    loadPose('quadruped'),
    loadPose('half_kneel'),
    ...WALK_CYCLE_POSE_IDS.map((id) => loadPose(id)),
    loadSequence('getup_prone'),
    loadSequence('getup_supine'),
  ])
}

/**
 * Map gait phase (rad) to two adjacent walk-cycle poses and blend factor.
 */
export function bracketWalkCyclePhase(gaitPhase) {
  const count = WALK_CYCLE_POSE_IDS.length
  const tau = Math.PI * 2
  const wrapped = (((gaitPhase + WALK_CYCLE_PHASE_OFFSET) % tau) + tau) % tau
  const phaseT = (wrapped / tau) * count
  const i0 = Math.floor(phaseT) % count
  const i1 = (i0 + 1) % count
  return {
    lowerId: WALK_CYCLE_POSE_IDS[i0],
    upperId: WALK_CYCLE_POSE_IDS[i1],
    t: phaseT - Math.floor(phaseT),
  }
}

export function getWalkCycleWorldTargets(gaitPhase, measurements, anchor, yaw) {
  const br = bracketWalkCyclePhase(gaitPhase)
  const lower = getCachedPose(br.lowerId)
  const upper = getCachedPose(br.upperId)
  if (!lower || !upper) return null
  if (br.t <= 0) return getPoseWorldTargets(lower, measurements, anchor, yaw)
  if (br.t >= 1) return getPoseWorldTargets(upper, measurements, anchor, yaw)
  return interpolatePoses(lower, upper, br.t, measurements, anchor, yaw)
}

export function getWalkCycleWorldPoseTargets(gaitPhase, measurements, anchor, yaw) {
  const br = bracketWalkCyclePhase(gaitPhase)
  const lower = getCachedPose(br.lowerId)
  const upper = getCachedPose(br.upperId)
  if (!lower || !upper) return null
  if (br.t <= 0) return getPoseWorldPoseTargets(lower, measurements, anchor, yaw)
  if (br.t >= 1) return getPoseWorldPoseTargets(upper, measurements, anchor, yaw)
  return interpolatePoseTargets(lower, upper, br.t, measurements, anchor, yaw)
}

/**
 * Linear blend of bone world positions (stand + walk-cycle additive layer).
 */
export function blendPositionTargetMaps(base, overlay, t) {
  const alpha = Math.max(0, Math.min(1, t))
  if (alpha <= 0) return base
  if (alpha >= 1) return overlay
  const out = Object.create(null)
  const ids = new Set([...Object.keys(base || {}), ...Object.keys(overlay || {})])
  for (const id of ids) {
    const a = base?.[id]
    const b = overlay?.[id]
    if (a && b) {
      out[id] = vec3Lerp(a, b, alpha)
    } else {
      out[id] = b || a
    }
  }
  return out
}

export function blendWorldPoseTargets(base, overlay, t) {
  const alpha = Math.max(0, Math.min(1, t))
  if (alpha <= 0) return base
  if (alpha >= 1) return overlay
  const out = Object.create(null)
  const ids = new Set([...Object.keys(base || {}), ...Object.keys(overlay || {})])
  for (const id of ids) {
    const a = base?.[id]
    const b = overlay?.[id]
    if (!a && !b) continue
    if (!a) { out[id] = b; continue }
    if (!b) { out[id] = a; continue }
    out[id] = {
      position: vec3Lerp(a.position, b.position, alpha),
      rotation: quatNlerp(a.rotation, b.rotation, alpha),
    }
  }
  return out
}

/**
 * Compute the world-space target position of a single bone for a given pose.
 * Applies scale (measurements.height / pose.referenceHeight), yaw rotation
 * around +Y (body facing direction), and translation to anchor.
 *
 * @param {object} pose - pose JSON
 * @param {string} boneId
 * @param {object} measurements - actor measurements (height, etc)
 * @param {number[]} anchor - [x, y, z] floor position of the body
 * @param {number} yaw - facing angle in radians (0 = +Z)
 * @returns {number[] | null} [wx, wy, wz] or null if bone not in pose
 */
export function getPoseBoneWorldPosition(pose, boneId, measurements, anchor, yaw) {
  const local = getPoseBoneLocalPosition(pose, boneId)
  if (!local) return null

  const scale = measurements.height / (pose.referenceHeight || 1.85)
  const lx = local[0] * scale
  const ly = local[1] * scale
  const lz = local[2] * scale

  // Yaw rotation around Y axis (pose authored facing +Z, so rotate to actor facing)
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const wx = anchor[0] + (cos * lx + sin * lz)
  const wy = anchor[1] + ly
  const wz = anchor[2] + (-sin * lx + cos * lz)

  return [wx, wy, wz]
}

export function getPoseBoneLocalPosition(pose, boneId) {
  const bone = pose?.bones?.[boneId]
  if (Array.isArray(bone)) return bone
  if (bone && typeof bone === 'object' && Array.isArray(bone.position)) return bone.position
  return null
}

export function getPoseBoneLocalRotation(pose, boneId) {
  const bone = pose?.bones?.[boneId]
  if (bone && typeof bone === 'object' && Array.isArray(bone.rotation)) return normalizeQuat(bone.rotation)
  return normalizeQuat(pose?.rotations?.[boneId] || IDENTITY_QUAT)
}

export function getPoseBoneWorldRotation(pose, boneId, yaw) {
  return quatMultiply(quatFromYaw(yaw), getPoseBoneLocalRotation(pose, boneId))
}

/**
 * Compute all target positions for a pose, keyed by bone id.
 */
export function getPoseWorldTargets(pose, measurements, anchor, yaw) {
  const targets = Object.create(null)
  for (const boneId of Object.keys(pose.bones)) {
    targets[boneId] = getPoseBoneWorldPosition(pose, boneId, measurements, anchor, yaw)
  }
  return targets
}

export function getPoseWorldPoseTargets(pose, measurements, anchor, yaw) {
  const targets = Object.create(null)
  for (const boneId of Object.keys(pose.bones)) {
    const position = getPoseBoneWorldPosition(pose, boneId, measurements, anchor, yaw)
    if (!position) continue
    targets[boneId] = {
      position,
      rotation: getPoseBoneWorldRotation(pose, boneId, yaw),
    }
  }
  return targets
}

/**
 * Interpolate between two poses. Returns a target-position map for all bones
 * that exist in both. Useful for smooth phase transitions within a sequence.
 *
 * @param {object} poseA
 * @param {object} poseB
 * @param {number} t - 0..1 interpolation factor (0 = poseA, 1 = poseB)
 */
export function interpolatePoses(poseA, poseB, t, measurements, anchor, yaw) {
  const targets = Object.create(null)
  const ids = new Set([...Object.keys(poseA.bones), ...Object.keys(poseB.bones)])
  for (const id of ids) {
    const a = getPoseBoneWorldPosition(poseA, id, measurements, anchor, yaw)
    const b = getPoseBoneWorldPosition(poseB, id, measurements, anchor, yaw)
    if (a && b) {
      targets[id] = vec3Lerp(a, b, t)
    } else {
      targets[id] = a || b
    }
  }
  return targets
}
export function interpolatePoseTargets(poseA, poseB, t, measurements, anchor, yaw) {
  const targets = Object.create(null)
  const ids = new Set([...Object.keys(poseA.bones), ...Object.keys(poseB.bones)])
  for (const id of ids) {
    const aPos = getPoseBoneWorldPosition(poseA, id, measurements, anchor, yaw)
    const bPos = getPoseBoneWorldPosition(poseB, id, measurements, anchor, yaw)
    if (!aPos && !bPos) continue
    const position = aPos && bPos ? vec3Lerp(aPos, bPos, t) : (aPos || bPos)
    const aRot = getPoseBoneWorldRotation(poseA, id, yaw)
    const bRot = getPoseBoneWorldRotation(poseB, id, yaw)
    targets[id] = {
      position,
      rotation: quatNlerp(aRot, bRot, t),
    }
  }
  return targets
}

/**
 * Apply direct KINEMATIC blend — lerps particle positions toward targets at
 * a controlled rate per frame. Used for getup transitions where we need
 * reliable pose delivery (the physics-force approach tumbled chaotically).
 * Velocity is also zeroed so the body doesn't carry momentum from the blend.
 *
 * This is what commercial games do for active-ragdoll getups: kinematic
 * motion for the sequence, then hand off to physics-driven balance once
 * standing. Pure-physics-driven getup requires a DeepMimic-style trained
 * policy, which is out of scope.
 *
 * @param {PBDRagdoll} ragdoll
 * @param {Object<string, number[]>} targets - bone id → [wx, wy, wz]
 * @param {number} blendRate - 0..1 per frame, e.g. 0.08 for smooth blend
 */
/**
 * Hybrid muscle-motor blend — mixes kinematic pose delivery with PD-force
 * behavior to produce realistic active-ragdoll motion that FEELS muscular
 * rather than teleport-y.
 *
 * Four layers stacked per bone:
 *
 *   1. SOFT POSITION NUDGE — small kinematic lerp (2-4% per frame).
 *      Guarantees pose delivery; prevents drift from constraints/collisions.
 *
 *   2. VELOCITY-CLAMPED PURSUIT — computes a desired velocity toward the
 *      target and caps it at a "muscle speed" limit. Far bones move at
 *      max speed; close bones slow down (ease-in on arrival).
 *
 *   3. PD STABILIZATION — small spring-damper toward target adds subtle
 *      inertia/settling that pure position lerp lacks. Uses applyForce so
 *      gravity/collisions/distance constraints still dominate.
 *
 *   4. MUSCLE-TONE GRAVITY COMP — above-ground bones get 70% gravity
 *      cancellation (like real postural muscles keeping you upright).
 *
 * Per-bone activation timing: big postural muscles (pelvis, thighs, chest)
 * lead; smaller bones (hands, head) follow. Creates the "stage-by-stage
 * effort" look real people have when getting up.
 *
 * @param {PBDRagdoll} ragdoll
 * @param {Object<string, number[]>} targets - bone id → [wx, wy, wz]
 * @param {number} blendRate - base position lerp 0..1 (0.02-0.05 looks good)
 * @param {Object} options
 */
export function applyKinematicBlend(ragdoll, targets, blendRate = 0.04, options = {}) {
  const dt = options.dt ?? 1 / 60
  const horizontalScale = Number.isFinite(options.horizontalScale) ? Math.max(0, options.horizontalScale) : 1
  const horizontalDampingScale = Number.isFinite(options.horizontalDampingScale) ? Math.max(0, options.horizontalDampingScale) : horizontalScale
  const horizontalScaleByBone = options.horizontalScaleByBone && typeof options.horizontalScaleByBone === 'object' ? options.horizontalScaleByBone : null
  const horizontalDampingScaleByBone = options.horizontalDampingScaleByBone && typeof options.horizontalDampingScaleByBone === 'object' ? options.horizontalDampingScaleByBone : null
  const muscleSpeed = options.muscleSpeed ?? 2.5      // m/s max bone velocity
  // Natural frequency of the muscle response (rad/s). Real postural muscles
  // respond with ωn ≈ 6-10 rad/s. Kp/Kd are DERIVED from this per bone so
  // light bones respond fast, heavy bones respond slow — like real muscle.
  const omega = options.omega ?? 7                    // rad/s
  const dampingRatio = options.dampingRatio ?? 0.75   // 0.7-1.0 natural feel
  // Fallback scalars when per-bone mass unknown
  const kpFallback = options.kp ?? 50
  const kdFallback = options.kd ?? 14
  // Peak muscle force scales with bone mass. Real untrained human: ~15× g
  // per kg of muscle mass. Peak (max voluntary effort) ~25× g. Athlete ~40×.
  // We default to 15 × g — a "normal" person. Games wanting strong characters
  // can override via options.forcePerKg.
  //   thigh 8kg  → 1176 N peak (matches real quad output)
  //   shin  4kg  → 588 N peak
  //   pelvis 15kg → 2205 N peak (big muscle group supporting body weight)
  //   hand 0.5kg → 74 N peak
  //
  // FURTHER SCALED BY:
  //   strength   — per-entity multiplier (0.3-1.5, grows with practice).
  //                Bodies START at 0.5 and EARN strength through use.
  //   fatigue    — per-bone accumulator (0-1), reduces force up to 40%.
  //   adrenaline — temporary boost that can push past normal limits.
  const forcePerKg = options.forcePerKg ?? 15 * 9.8   // N/kg, BASE
  const strength = options.strength ?? 1.0            // entity-wide multiplier
  const adrenaline = options.adrenaline ?? 0          // 0..1, pushes past fatigue
  const maxForceAbs = options.maxForce ?? 1500        // absolute cap per bone
  // Force rise time — real "normal" untrained RFD is 800-1500 N/s. Athletes
  // 3000-5000 N/s. Using 1200 as default produces ~200ms to reach peak
  // (matches physiological muscle activation curves).
  const forceRiseRate = options.forceRiseRate ?? 1200 // N/s
  // Per-bone rise rate multipliers. Big muscles (legs, torso) activate
  // SLOWER than small muscles (arms, head) — more motor units, more
  // recruitment lag. This is measured in real EMG studies.
  const RISE_RATE_MUL = options.riseRateMul || {
    pelvis: 0.8, spine: 0.8, spine1: 0.8, chest: 0.85,
    leftThigh: 0.7, rightThigh: 0.7,          // slowest — biggest muscles
    leftShin: 0.75, rightShin: 0.75,
    leftFoot: 0.9, rightFoot: 0.9,
    leftShoulder: 1.0, rightShoulder: 1.0,
    leftUpperArm: 1.1, rightUpperArm: 1.1,    // arms faster
    leftForearm: 1.2, rightForearm: 1.2,
    leftHand: 1.4, rightHand: 1.4,            // hands fastest
    neck: 1.0, head: 1.1,
  }
  const gravityTone = options.gravityTone ?? 0.7      // postural muscle comp
  const toneYThreshold = options.toneYThreshold ?? 0.3
  const solver = ragdoll.solver

  // Postural priority — bigger = activates earlier. Core leads, extremities
  // follow. This is how real humans recruit muscles during getup.
  const PRIORITY = {
    pelvis: 1.0, spine: 1.0, spine1: 1.0, chest: 0.95,
    leftThigh: 0.95, rightThigh: 0.95,
    leftShin: 0.85, rightShin: 0.85,
    leftFoot: 0.75, rightFoot: 0.75,
    leftShoulder: 0.80, rightShoulder: 0.80,
    leftUpperArm: 0.70, rightUpperArm: 0.70,
    leftForearm: 0.60, rightForearm: 0.60,
    leftHand: 0.55, rightHand: 0.55,
    neck: 0.80, head: 0.75,
  }

  for (const bone of ragdoll.bones) {
    if (!bone) continue
    const target = targets[bone.name]
    if (!target) continue
    const p = bone.particle
    const mass = bone.mass || 1
    const pri = PRIORITY[bone.name] ?? 0.8
    const boneHorizontalScale = Number.isFinite(horizontalScaleByBone?.[bone.name]) ? Math.max(0, horizontalScaleByBone[bone.name]) : horizontalScale
    const boneHorizontalDampingScale = Number.isFinite(horizontalDampingScaleByBone?.[bone.name]) ? Math.max(0, horizontalDampingScaleByBone[bone.name]) : horizontalDampingScale

    const dx = (target[0] - p.x) * boneHorizontalScale
    const dy = target[1] - p.y
    const dz = (target[2] - p.z) * boneHorizontalScale
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    // ── LAYER 1: soft position nudge (scaled by priority) ────────────────
    const rate = blendRate * pri
    p.x += dx * rate
    p.y += dy * rate
    p.z += dz * rate

    // ── LAYER 2: velocity-clamped pursuit ────────────────────────────────
    // Compute desired velocity = direction * min(distance/dt, muscleSpeed).
    // Close to target → slow approach (ease-in). Far → capped at muscleSpeed.
    if (dist > 1e-4 && solver) {
      const speed = Math.min(dist / dt, muscleSpeed) * pri
      const invD = 1 / dist
      const targetVx = dx * invD * speed
      const targetVy = dy * invD * speed
      const targetVz = dz * invD * speed
      // Blend current velocity toward target velocity (0.3 = soft tracking)
      p.vx += (targetVx - p.vx) * 0.3 * boneHorizontalDampingScale
      p.vy += (targetVy - p.vy) * 0.3
      p.vz += (targetVz - p.vz) * 0.3 * boneHorizontalDampingScale
    }

    // ── LAYER 3: PD spring-damper force (inertia/settling) ───────────────
    // Mass-scaled critical damping:
    //   Kp = m·ω²        (so acceleration ≈ ω²·error, independent of mass)
    //   Kd = 2·√(Kp·m)·ζ = 2·m·ω·ζ
    // This makes a 20kg pelvis move at the same natural frequency as a
    // 0.5kg hand — just like biological muscle auto-scaling.
    if (solver) {
      const kp = mass * omega * omega
      const kd = 2 * mass * omega * dampingRatio
      let fx = kp * pri * dx - kd * pri * p.vx * boneHorizontalDampingScale
      let fy = kp * pri * dy - kd * pri * p.vy
      let fz = kp * pri * dz - kd * pri * p.vz * boneHorizontalDampingScale

      // ── LAYER 4: muscle-tone gravity compensation ──────────────────────
      if (p.y > toneYThreshold) {
        fy += mass * 9.8 * gravityTone * pri
      }

      // Per-bone mass-scaled force cap, then STRENGTH + FATIGUE scaling.
      //
      // boneMaxForce = min(absCap, forcePerKg · mass)
      //              × strength                      (learned per-entity)
      //              × (1 - fatigue × 0.4)           (exhaustion penalty)
      //              × (1 + adrenaline × 0.5)        (panic boost)
      //
      // Without strength, all bodies start identical. With it, weak bodies
      // literally cannot lift themselves on day 1 — they must train.
      // Fatigue means holding a pose drains you; you can't grind forever.
      // Adrenaline gives temporary superhuman output (flight response).
      const fatigue = p._fatigue ?? 0
      const baseMax = Math.min(maxForceAbs, forcePerKg * mass)
      const boneMaxForce = baseMax
        * strength
        * (1 - fatigue * 0.4)
        * (1 + adrenaline * 0.5)

      const fmag = Math.sqrt(fx * fx + fy * fy + fz * fz)
      if (fmag > boneMaxForce) {
        const s = boneMaxForce / fmag
        fx *= s; fy *= s; fz *= s
      }

      // ── FATIGUE ACCUMULATION ─────────────────────────────────────────
      // Real muscle fatigue: sustained high force depletes ATP in seconds.
      // Our model: fatigue grows proportional to force/max ratio each frame.
      // At full output, ~30s to reach 1.0 (max exhaustion). At rest,
      // recovers with 0.99 decay per frame (~10s to fully recover).
      const fmagFinal = Math.sqrt(fx * fx + fy * fy + fz * fz)
      const loadRatio = fmagFinal / (boneMaxForce + 1e-6)
      if (loadRatio > 0.3) {
        // Working — accumulate fatigue (scaled so 100% load for 30s → 1.0)
        p._fatigue = Math.min(1, fatigue + loadRatio * dt * 0.033)
      } else {
        // Resting — recover (10s to fully refresh)
        p._fatigue = fatigue * 0.99
      }

      // ── FORCE RISE-TIME FILTER ───────────────────────────────────────
      // Real muscles can't change force instantly — rate-of-force-development
      // varies by muscle group. Big muscles (thighs, core) ramp slower;
      // small muscles (hands, head) ramp faster. Per-bone multipliers
      // match real EMG-measured activation curves.
      const riseMul = RISE_RATE_MUL[bone.name] ?? 1.0
      const prev = p._muscleForce || (p._muscleForce = [0, 0, 0])
      if (boneHorizontalDampingScale < 1) {
        prev[0] *= boneHorizontalDampingScale
        prev[2] *= boneHorizontalDampingScale
      }
      const maxDelta = forceRiseRate * riseMul * dt
      const applyRateLimit = (target, prevV) => {
        const d = target - prevV
        if (d >  maxDelta) return prevV + maxDelta
        if (d < -maxDelta) return prevV - maxDelta
        return target
      }
      fx = applyRateLimit(fx, prev[0]); prev[0] = fx
      fy = applyRateLimit(fy, prev[1]); prev[1] = fy
      fz = applyRateLimit(fz, prev[2]); prev[2] = fz

      // ── ERROR-GATED DAMPING (kills steady-state oscillation) ─────────
      // When pose error is small, the PD motor over-reacts to tiny
      // position deltas, causing pelvis to jitter with 3-4 m/s velocity
      // readings while visibly still. Solution: if we're CLOSE to target
      // (dist < 5cm), add extra velocity damping to kill residual motion.
      if (dist < 0.05) {
        const damp = 0.7    // reduce velocity 30% each frame near target
        const horizontalDamp = 1 - (1 - damp) * boneHorizontalDampingScale
        p.vx *= horizontalDamp
        p.vy *= damp
        p.vz *= horizontalDamp
      }

      solver.applyForce(p, fx, fy, fz, dt)
    }
  }
}

/**
 * Apply PD (proportional-derivative) motor FORCES to drive the ragdoll
 * toward a target pose. This is the proper active-ragdoll approach used in
 * DeepMimic / NaturalMotion Euphoria / Karl Sims creatures:
 *
 *     F = Kp * (target_pos - pos) - Kd * velocity
 *
 * Forces are applied via `solver.applyForce()` BEFORE the physics step so
 * they get integrated as acceleration through the Verlet solver. The body
 * rises by physically PUSHING against the ground (via collision friction on
 * its hands/feet) — not by teleporting particles to target positions.
 *
 * Key properties:
 *   - Mass matters: Kp scales per bone mass so acceleration is consistent.
 *   - Kd damps overshoot and oscillation (critical damping formula below).
 *   - Gravity, collisions, and distance constraints ALL still act normally.
 *   - Momentum is preserved — no teleportation.
 *
 * PHASE RAMP: `phaseBoost` multiplier scales stiffness over the phase
 * duration so the motor grows stronger as the body approaches the pose.
 *
 * ADAPTIVE GAIN: bones far from target get a proportional force boost — the
 * "ramp muscle output until it works" behavior. Still applied through PD
 * force, not position teleport.
 *
 * MAX FORCE CAP: prevents instability from runaway forces at large errors.
 *
 * @param {PBDRagdoll} ragdoll
 * @param {Object<string, number[]>} targets - bone id → [wx, wy, wz]
 * @param {object} options - { stiffness, boneBias, dt, phaseBoost, kp, kd, maxForce }
 */
export function applyMotorToTargets(ragdoll, targets, options = {}) {
  const stiffness = options.stiffness ?? 0.5
  const boneBias = options.boneBias || {}
  const dt = options.dt ?? 1 / 60
  const phaseBoost = options.phaseBoost ?? 1
  // PD gains — sized to match biological muscle forces (~50-150N per bone),
  // which is in the realistic range for human limbs. With Kp=60 and typical
  // error of 0.3m, force ≈ 18N (arm) to 45N (pelvis). Gravity on a 2.5kg
  // pelvis is 24.5N, so motor can lift it but not snap-teleport.
  //
  // Natural frequency ω = sqrt(Kp/m). For Kp=60, m=2.5: ω ≈ 4.9 rad/s →
  // response time ~0.6s. That's what gives the body visible "effort" during
  // the motion instead of snapping into place.
  const Kp = options.kp ?? 60
  const Kd = options.kd ?? 22       // ≈ 2*sqrt(Kp*m) for m~2 (critical damping)
  const maxForce = options.maxForce ?? 120  // N — cap per bone
  const gravityComp = options.gravityComp ?? 0  // 0=off, 1=full comp (floats!). Use 0.7-0.85 for realistic stand
  const gravityCompYThreshold = options.gravityCompYThreshold ?? 0.3  // only bones above this Y get lift — prevents feet flying

  const solver = ragdoll.solver
  if (!solver) return

  for (const bone of ragdoll.bones) {
    if (!bone) continue
    const target = targets[bone.name]
    if (!target) continue
    const bias = boneBias[bone.name] ?? 1
    const mass = bone.mass || 1

    const p = bone.particle
    const dx = target[0] - p.x
    const dy = target[1] - p.y
    const dz = target[2] - p.z

    // Apply stiffness/bias/phase as a single multiplier.
    const gain = stiffness * bias * phaseBoost

    // PD force: F = Kp*(target - pos) - Kd*velocity
    // NOT scaled by mass — heavier bones accelerate slower (realistic).
    let fx = Kp * gain * dx - Kd * gain * p.vx
    let fy = Kp * gain * dy - Kd * gain * p.vy
    let fz = Kp * gain * dz - Kd * gain * p.vz

    // Partial gravity compensation (feedforward). Only bones ABOVE the Y
    // threshold get lift — prevents feet/shins from flying upward off the
    // ground. `gravityComp` < 1.0 means body retains some weight so it
    // actually presses on the floor (no levitation).
    if (gravityComp > 0 && p.y > gravityCompYThreshold) {
      fy += mass * 9.8 * gravityComp
    }

    // Cap per-bone force.
    const fmag = Math.sqrt(fx * fx + fy * fy + fz * fz)
    if (fmag > maxForce) {
      const s = maxForce / fmag
      fx *= s; fy *= s; fz *= s
    }

    solver.applyForce(p, fx, fy, fz, dt)
  }
}

/**
 * Run one tick of a sequence. Returns progress info so the caller can
 * decide when the sequence completes or what phase is active.
 *
 * @param {object} sequence - sequence JSON
 * @param {number} elapsed - seconds since sequence started
 * @returns {{ phaseIndex: number, localT: number, done: boolean, pose: string, nextPose: string|null, stiffness: number, boneBias: object }}
 */
export function getSequenceState(sequence, elapsed) {
  let acc = 0
  for (let i = 0; i < sequence.phases.length; i++) {
    const phase = sequence.phases[i]
    const end = acc + phase.duration
    if (elapsed < end) {
      const localT = (elapsed - acc) / phase.duration
      const next = sequence.phases[i + 1] || null
      return {
        phaseIndex: i,
        localT,
        done: false,
        pose: phase.pose,
        nextPose: next?.pose || null,
        stiffness: phase.stiffness ?? 0.5,
        boneBias: phase.boneBias || {},
      }
    }
    acc = end
  }
  // Past the end — return terminal state on last phase
  const last = sequence.phases[sequence.phases.length - 1]
  return {
    phaseIndex: sequence.phases.length - 1,
    localT: 1,
    done: true,
    pose: last.pose,
    nextPose: null,
    stiffness: last.stiffness ?? 0.5,
    boneBias: last.boneBias || {},
  }
}

/**
 * Read a cached pose without loading. Returns null if not loaded.
 */
export function getCachedPose(id) {
  return POSE_CACHE.get(id) || null
}

// ─── VERTICALITY BLEND SPACE ────────────────────────────────────────────────
//
// Inspired by:
//   • Postural Verticality Scale (PVS) used in stroke rehab (Bobath method)
//   • Gross Motor Function Measure (GMFM) used in pediatric PT
//   • 1D blend-tree animation (Unity/Unreal)
//
// Every pose is tagged with a verticality score 0..100. The body's CURRENT
// posture is measured continuously (pelvis height as fraction of standing
// height, clamped to scale). We blend between the two adjacent poses on the
// scale by linear interpolation of their world-space bone targets.
//
// Scale:
//     0  prone / supine (flat on ground)
//    15  pushup (chest off ground)
//    25  quadruped (all-fours)
//    35  kneel (both knees, torso up)
//    45  half-kneel (one foot down)
//    50  stand (neutral upright)
//   >50  reserved for tiptoe / reach / jump

/**
 * Return a sorted ladder of {verticality, pose} for every cached pose that
 * declares one. Sorted ascending by score.
 */
export function getVerticalityLadder() {
  const rungs = []
  for (const pose of POSE_CACHE.values()) {
    if (typeof pose.verticality === 'number') {
      rungs.push({ v: pose.verticality, pose })
    }
  }
  rungs.sort((a, b) => a.v - b.v)
  return rungs
}

/**
 * Find the two adjacent rungs bracketing verticality `v`, plus the
 * interpolation factor between them.
 * Returns { lower, upper, t } where t ∈ [0,1]; t=0 means exactly lower.
 * If v is below min or above max, clamps to end and t=0 or 1.
 */
export function bracketVerticality(v, ladder = null) {
  const L = ladder || getVerticalityLadder()
  if (L.length === 0) return null
  if (v <= L[0].v)          return { lower: L[0].pose, upper: L[0].pose, t: 0 }
  if (v >= L[L.length-1].v) return { lower: L[L.length-1].pose, upper: L[L.length-1].pose, t: 1 }
  for (let i = 0; i < L.length - 1; i++) {
    if (v >= L[i].v && v <= L[i + 1].v) {
      const span = L[i + 1].v - L[i].v
      const t = span > 0 ? (v - L[i].v) / span : 0
      return { lower: L[i].pose, upper: L[i + 1].pose, t }
    }
  }
  return { lower: L[L.length-1].pose, upper: L[L.length-1].pose, t: 1 }
}

/**
 * Get world-space bone targets for an arbitrary verticality score. Blends
 * between the two adjacent ladder poses, so the caller never has to know
 * which discrete pose is "current" — just "how vertical".
 *
 * @param {number} v - verticality score 0..100
 */
export function getPoseAtVerticality(v, measurements, anchor, yaw) {
  const br = bracketVerticality(v)
  if (!br) return Object.create(null)
  if (br.t === 0) return getPoseWorldTargets(br.lower, measurements, anchor, yaw)
  if (br.t === 1) return getPoseWorldTargets(br.upper, measurements, anchor, yaw)
  return interpolatePoses(br.lower, br.upper, br.t, measurements, anchor, yaw)
}
export function getPoseTargetsAtVerticality(v, measurements, anchor, yaw) {
  const br = bracketVerticality(v)
  if (!br) return Object.create(null)
  if (br.t === 0) return getPoseWorldPoseTargets(br.lower, measurements, anchor, yaw)
  if (br.t === 1) return getPoseWorldPoseTargets(br.upper, measurements, anchor, yaw)
  return interpolatePoseTargets(br.lower, br.upper, br.t, measurements, anchor, yaw)
}

/**
 * Measure the current body's verticality from live physics state.
 * Uses pelvis height as fraction of the stand-pose pelvis height, mapped
 * onto the scale so stand = 50. Below stand scales linearly; above stand
 * (for future jumping/reaching) grows proportionally.
 *
 * @param {PBDRagdoll} ragdoll
 * @returns {number} current verticality 0..100 (clamped)
 */
export function measureBodyVerticality(ragdoll) {
  const stand = POSE_CACHE.get('stand')
  if (!stand) return 0
  const standPelvisY = stand.bones.pelvis?.[1] ?? 1.80
  const pelvis = ragdoll.bones[0]?.particle
  if (!pelvis) return 0
  // Normalize: pelvis at stand height → 50; pelvis on floor → 0.
  const frac = pelvis.y / standPelvisY
  const v = frac * 50
  return Math.max(0, Math.min(100, v))
}

/**
 * Read a cached sequence without loading. Returns null if not loaded.
 */
export function getCachedSequence(id) {
  return SEQUENCE_CACHE.get(id) || null
}

/**
 * Compute total duration of a sequence in seconds.
 */
export function getSequenceDuration(sequence) {
  return sequence.phases.reduce((s, p) => s + p.duration, 0)
}
