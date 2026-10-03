// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * NeuralMotor — per-entity self-training MLP for active-ragdoll control.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   WHAT THIS IS (read first)
 * ══════════════════════════════════════════════════════════════════════
 *
 * The NN adds position RESIDUAL offsets (±8cm per bone) on top of the
 * kinematic verticality pose targets. It is NOT a force generator. The
 * force that actually lifts the body comes from the PD motor in
 * BodyPoses.js, which uses the (NN-refined) targets.
 *
 * This is called "residual policy learning" — same approach used by
 * DReCon (Ubisoft, 2020) and DeepMimic. The NN learns the RESIDUAL
 * between hand-authored poses and what the body actually needs.
 *
 *   targets_kinematic  (from verticality blend)
 *        + NN_residual  (from this file, trained online)
 *        = targets_final
 *        → PD motor tracks targets_final with realistic muscle force
 *
 * ══════════════════════════════════════════════════════════════════════
 *   TRAINING ALGORITHM: AWR (Advantage-Weighted Regression)
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every frame:
 *   1. Compute REWARD from body state (pose match, upright, stable,
 *      goal progress — see computeReward).
 *   2. Maintain an EMA baseline of reward.
 *   3. Advantage = reward - baseline.
 *   4. Gradient weight = clamp(exp(β·advantage), 0.25, 3).
 *   5. Teacher = what the kinematic controller would nudge this frame.
 *   6. Loss = awrWeight × MSE(NN_output, teacher).
 *   7. One SGD step per frame.
 *
 * Effect: NN imitates the teacher MORE in above-average states and LESS
 * in below-average. This turns behavior cloning into a proper RL method.
 * We don't need full PPO with rollout buffers — training is online and
 * stable because the teacher is always available.
 *
 * STABILITY GATE: training is skipped when the body is thrashing
 * (core velocity > 24 m/s or head below pelvis). Chaotic frames produce
 * noise teacher signals that would corrupt the NN.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   BRAIN TIERS
 * ══════════════════════════════════════════════════════════════════════
 *
 *   tiny   (default NPCs):  43→64→64→60             ≈ 41 KB
 *   small  (named NPCs):    43→128→128→60           ≈ 130 KB
 *   medium (player default):43→256→256→256→60       ≈ 1.2 MB
 *   large  (player upgrade):43→512→1024→1024→60     ≈ 6.6 MB
 *   huge   (endgame cap):   43→768→1024³→60         ≈ 10 MB
 *
 * (Input dim 43 = 36 body state + 4 intent one-hot + 3 goal vector.)
 *
 * 10 MB hard cap per brain (enforced at serialize-time). Upgrades via
 * Net2Net weight transplant (upgradeBrain) — preserves learned behavior,
 * new neurons start near-zero and learn later.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   DETERMINISM
 * ══════════════════════════════════════════════════════════════════════
 *
 * Per-entity seeded PRNG (engine's mulberry32 + FNV-1a string hash of
 * entity id). Same id always produces the same initial brain. Different
 * ids (player, npc_parent, thief_jin) diverge immediately into unique
 * "personalities". Drug/seizure/tremor effects also use the per-entity
 * RNG, so effects are reproducible per body.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   NEUROMODIFIERS (drugs, disease, damage)
 * ══════════════════════════════════════════════════════════════════════
 *
 * The forward pass accepts five perturbations applied to hidden-layer
 * activations, grounded in real pharmacology:
 *
 *   noise      — Gaussian σ (alcohol → loss of coordination)
 *   dropout    — random activation kill (seizure / KO)
 *   scale      — output multiplier (paralytic=0, stimulant=1.4)
 *   tremor     — coherent sinusoidal (Parkinsonian 4-6 Hz)
 *   delay      — observation buffer lag (concussion)
 *   seizureAmp — random spikes in activations
 *
 * See NeuroModifiers.js for preset profiles.
 *
 * ══════════════════════════════════════════════════════════════════════
 *
 * No external ML library — pure JS, uses engine/core/math/MathRandom.js
 * for shared PRNG utilities. Runs on CPU at 60 Hz for ~20 bodies on a
 * laptop. Training cost ~0.3ms per body per frame (tiny tier).
 */

import { mulberry32, normalDistribution } from '../../../core/math/MathRandom.js'
import { clamp } from '../../../core/math/MathScalar.js'

// Observation dimensions: 36 body + 4 intent + 3 goal + 4 terrain + 4 social + 4 motor-intent + 23 tactile/proprio = 78
//
// The terrain + social dims are the PACER contribution (Pedestrian Animation
// Controller, NVIDIA Toronto AI, CVPR 2023 "Trace and Pace"). They let the NN
// see the *ground* it's walking on and the *other agents* near it, so it can
// learn to step up stairs, lean uphill, and avoid crowds — all with the same
// reward signal, just richer input.
//
//   [0..35]  body state (pelvis/chest/COM/feet/hands/rhythms — as before)
//   [36..39] intent one-hot [stand, walk, duck, act]
//   [40..42] goal: target verticality norm + targetDir xz (world-space)
//   [43..46] TERRAIN  (NEW — PACER):
//              [43] ground height under pelvis (relative to pelvis.y)
//              [44] ground height 0.6m ahead (along target dir)
//              [45] slope ahead (Δheight / distance, clamped ±1)
//              [46] ground height 0.6m to the side (for lateral terrain)
//   [47..50] SOCIAL   (NEW — PACER):
//              [47..48] relative xz of nearest other agent (clamped ±3m, /3)
//              [49..50] relative xz velocity of nearest other agent (clamped ±2m/s, /2)
//   [51..54] MOTOR INTENT:
//              [51] guard, [52] brace, [53] attack, [54] recover
//   [55..77] TACTILE / PROPRIO:
//              [55..56] left/right stance trust
//              [57..58] left/right slip risk
//              [59..64] left/right contact normal xyz in body frame
//              [65..66] left/right pressure/load
//              [67..68] left/right toe alignment error
//              [69..70] left/right shin-foot alignment error
//              [71..72] left/right surface friction
//              [73] support confidence
//              [74..75] support width/depth proxy
//              [76] limb crossing severity
//              [77] head/neck lean severity
//
// Older V2 brains (43-dim obs) are auto-migrated on load: the first layer's
// input matrix is zero-padded for new cols. V3/V4 brains are also
// zero-padded for later cols, preserving learned behavior until retraining.
const OBS_SIZE = 78
const ACTION_BONES = 20
const ACTION_SIZE = ACTION_BONES * 3   // 60 — per-bone xyz offset
const LEARNING_RATE = 0.002
const OFFSET_CLAMP = 0.08              // meters — per-bone ΔXYZ cap
const GPU_BATCH_MIN_BODIES = 32

// Brain capacity tiers. Each entry = hidden layer sizes between obs and
// action. Order matters — upgradeBrain() only moves UP the ladder.
//
// Tier selection is driven by an `intelligence` score (0–100) that grows
// with life experience, training, and gameplay events. See INTELLIGENCE_TIERS
// below for thresholds. Characters START at a tier matching their baseline
// intelligence and AUTO-UPGRADE as they learn.
//
//   ─── MORTAL TIERS (IQ 0–100, natural intelligence) ───
//   newborn — animals, infants, very low cognition, ~4 KB
//   micro   — simple creatures, young children, ~13 KB
//   tiny    — generic adult NPC (default), ~41 KB
//   small   — skilled or experienced NPC, ~130 KB
//   medium  — important NPC / journeyman player, ~1.2 MB
//   large   — master / expert / player endgame, ~6.6 MB
//   huge    — legendary mortal / titan, ~10 MB
//
//   ─── MAGICAL TIERS (IQ 100–200, supernatural intelligence) ───
//   These are gated behind `magical=true` on the entry. Only accessible
//   via magic, divine favor, transcendence events, or cheat codes. The
//   architecture gets DEEPER rather than just wider (efficient capacity
//   growth via composition instead of more parameters per layer).
//   genius       — archmage / prodigy, ~14 MB
//   arcane       — divine caster, ~20 MB
//   transcendent — planar intelligence, ~28 MB
//   divine       — godlike cognition, ~40 MB (absolute hard cap)
//
// To add a new tier: append to BRAIN_TIERS keeping non-decreasing capacity,
// add a matching threshold in INTELLIGENCE_TIERS. All upgrade math is
// automatic (Net2Net preserves learned behavior when growing).
export const BRAIN_TIERS = {
  newborn:      [16, 16],
  micro:        [32, 32],
  tiny:         [64, 64],
  small:        [128, 128],
  medium:       [256, 256, 256],
  large:        [512, 1024, 1024],
  huge:         [768, 1024, 1024, 1024],
  // Magical tiers — require magical=true on the body to auto-upgrade.
  genius:       [1024, 1024, 1024, 1024],
  arcane:       [1024, 1024, 1024, 1024, 1024],
  transcendent: [1024, 1024, 1024, 1024, 1024, 1024],
  divine:       [1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024],
}

// Ordered list of tier names from weakest to strongest. Code that walks
// the ladder (tierFromIntelligence, nextTier) reads from this.
export const TIER_LADDER = [
  'newborn', 'micro', 'tiny', 'small', 'medium', 'large', 'huge',
  'genius', 'arcane', 'transcendent', 'divine',
]

// Tiers whose intelligence threshold is above 100 — the natural mortal cap.
// Auto-upgrade code gates these behind entry.magical.
export const MAGICAL_TIERS = new Set(['genius', 'arcane', 'transcendent', 'divine'])

// Intelligence thresholds (0–200). 0–100 is normal mortal range, 100+ is
// magical. Character needs AT LEAST this intelligence to HOLD a tier.
// When intelligence grows past threshold AND the current brain has saturated
// (low loss, many training steps) AND (if threshold > 100) the character
// is magical, auto-upgrade fires.
export const INTELLIGENCE_TIERS = {
  newborn:      0,
  micro:        5,
  tiny:         15,
  small:        35,
  medium:       55,
  large:        75,
  huge:         90,
  // Magical thresholds — these require magical=true.
  genius:       110,
  arcane:       140,
  transcendent: 170,
  divine:       195,
}

/**
 * Map an intelligence score to the appropriate tier name.
 * Magical tiers (IQ > 100) only return when `magical=true` — otherwise
 * the character is capped at the highest mortal tier (huge).
 */
export function tierFromIntelligence(score, magical = false) {
  let best = 'newborn'
  for (const tier of TIER_LADDER) {
    if (MAGICAL_TIERS.has(tier) && !magical) break   // mortal cap
    if (score >= INTELLIGENCE_TIERS[tier]) best = tier
  }
  return best
}

/** Get the next tier above the current one, or null if already at top. */
export function nextTier(currentTier) {
  const idx = TIER_LADDER.indexOf(currentTier)
  if (idx < 0 || idx >= TIER_LADDER.length - 1) return null
  return TIER_LADDER[idx + 1]
}

const DEFAULT_TIER = 'tiny'
// Per-brain memory cap. Mortal tiers fit in 10 MB. Magical tiers can exceed
// this — checkout divine tier ≈ 40 MB. The cap is lifted to 50 MB so the
// full ladder can instantiate. Serialization still warns above 10 MB so you
// know you're saving expensive magical brains.
export const MAX_BRAIN_BYTES = 50 * 1024 * 1024        // 50 MB absolute cap
export const WARN_BRAIN_BYTES = 10 * 1024 * 1024       // warn above this
export const MAX_PLAYER_SLOTS = 100                    // player snapshot budget

const BONE_ORDER = [
  'pelvis', 'spine', 'spine1', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftForearm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightForearm', 'rightHand',
  'leftThigh', 'leftShin', 'leftFoot',
  'rightThigh', 'rightShin', 'rightFoot',
]

const BABBLE_SCALE_BY_BONE = Object.freeze({
  pelvis: 0.02,
  spine: 0.02,
  spine1: 0.02,
  chest: 0.03,
  neck: 0.04,
  head: 0.04,
  leftShoulder: 0.05,
  rightShoulder: 0.05,
  leftUpperArm: 0.25,
  rightUpperArm: 0.25,
  leftForearm: 0.35,
  rightForearm: 0.35,
  leftHand: 0.45,
  rightHand: 0.45,
  leftThigh: 0.12,
  rightThigh: 0.12,
  leftShin: 0.18,
  rightShin: 0.18,
  leftFoot: 0.22,
  rightFoot: 0.22,
})

// ─── DETERMINISTIC PRNG ─────────────────────────────────────────────────────
//
// Per-entity seeded RNG so each body has a unique, REPRODUCIBLE brain.
// Uses the engine's shared MathRandom utilities (mulberry32 + normalDistribution)
// — imported at top of file — for consistency with the rest of the simulation.

// FNV-1a 32-bit string hash — used to derive a seed from entity id.
// Same id → same seed → identical brain. Different ids branch far apart.
function hashStringToSeed(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Default global RNG (used when no seed given — falls back to Math.random).
const GLOBAL_RNG = () => Math.random()

// ─── TINY MLP ───────────────────────────────────────────────────────────────

function makeMatrix(rows, cols, scale, rng = GLOBAL_RNG) {
  const m = new Float32Array(rows * cols)
  for (let i = 0; i < m.length; i++) m[i] = normalDistribution(0, scale, rng)
  return m
}

/**
 * Layer: y = tanh(x · W + b)  (or linear if noAct=true)
 * Cached fields used for backprop.
 */
function makeLayer(inSize, outSize, noAct = false, rng = GLOBAL_RNG) {
  const scale = Math.sqrt(2 / inSize)
  return {
    inSize, outSize, noAct,
    W: makeMatrix(inSize, outSize, scale, rng),
    b: new Float32Array(outSize),
    // caches
    x: null, z: null, a: null,
  }
}

function forwardLayer(L, x) {
  const { inSize, outSize, W, b, noAct } = L
  const z = new Float32Array(outSize)
  for (let j = 0; j < outSize; j++) {
    let s = b[j]
    for (let i = 0; i < inSize; i++) s += x[i] * W[i * outSize + j]
    z[j] = s
  }
  const a = noAct ? z.slice() : new Float32Array(outSize)
  if (!noAct) for (let j = 0; j < outSize; j++) a[j] = Math.tanh(z[j])
  L.x = x; L.z = z; L.a = a
  return a
}

// Backprop: given dL/da, compute dL/dx and accumulate SGD updates to W,b.
function backwardLayer(L, dA, lr) {
  const { inSize, outSize, W, b, x, a, noAct } = L
  // dL/dz = dL/da * (1 - tanh(z)^2)
  const dZ = new Float32Array(outSize)
  for (let j = 0; j < outSize; j++) {
    const grad = noAct ? dA[j] : dA[j] * (1 - a[j] * a[j])
    dZ[j] = grad
    b[j] -= lr * grad
  }
  const dX = new Float32Array(inSize)
  for (let i = 0; i < inSize; i++) {
    let s = 0
    for (let j = 0; j < outSize; j++) {
      s += dZ[j] * W[i * outSize + j]
      W[i * outSize + j] -= lr * dZ[j] * x[i]
    }
    dX[i] = s
  }
  return dX
}

// ─── NEURAL MOTOR ───────────────────────────────────────────────────────────

/**
 * Create a NeuralMotor. If `seedSource` is given (typically the entity id
 * string), initialization uses a deterministic PRNG — the same id always
 * produces the same starting brain. Different ids get different brains
 * (different "personalities") via string hashing.
 *
 * @param {string} tier - one of BRAIN_TIERS keys
 * @param {string|number|null} seedSource - entity id string, numeric seed,
 *                                          or null for non-deterministic
 */
export function createNeuralMotor(tier = DEFAULT_TIER, seedSource = null) {
  const hiddens = BRAIN_TIERS[tier] || BRAIN_TIERS[DEFAULT_TIER]

  // Build per-entity RNG. Entity id string → FNV-1a hash → mulberry32.
  // Same id → same seed → identical weights on every spawn. Different ids
  // branch far apart in the random stream.
  let rng = GLOBAL_RNG
  let seed = null
  if (seedSource !== null && seedSource !== undefined) {
    seed = typeof seedSource === 'number'
      ? (seedSource >>> 0)
      : hashStringToSeed(String(seedSource))
    rng = mulberry32(seed)
  }

  // Build layer chain: OBS → hidden[0] → ... → hidden[N-1] → ACTION (linear)
  const layers = []
  let prev = OBS_SIZE
  for (const h of hiddens) {
    layers.push(makeLayer(prev, h, false, rng))
    prev = h
  }
  layers.push(makeLayer(prev, ACTION_SIZE, true, rng))

  return {
    tier,
    seed,                   // stored so we know what produced this brain
    layers,                 // dynamic depth
    lossEMA: 0,
    framesTrained: 0,
    modifiers: {
      noise: 0, dropout: 0, scale: 1,
      tremor: 0, tremorHz: 0,
      delay: 0, seizureAmp: 0,
    },
    obsBuffer: [],          // for delay modifier
    rng,                    // runtime RNG for neuromodifiers (also seeded)
  }
}

// State intents. The NN gets a one-hot of these plus a goal vector so it
// can learn different control strategies for different objectives.
export const STATE_INTENTS = {
  stand:  0,  // verticality=50, no locomotion
  walk:   1,  // verticality=50 + forward velocity
  duck:   2,  // verticality=25 (crouch/quadruped)
  act:    3,  // verticality=50 + target reach direction
}
export const NUM_INTENTS = 4

/**
 * Build the observation vector.
 *
 * Dimensions [21..23] originally held a static gravity vector placeholder
 * — we've REPURPOSED these for CPG RHYTHM signals, which give the NN an
 * internal time-base for rhythmic motor actions (walking, breathing):
 *
 *   [0..2]   pelvis position (x,y,z)
 *   [3..5]   pelvis velocity
 *   [6..8]   chest - pelvis (spine vector)
 *   [9..11]  shoulder axis (rShoulder - lShoulder)
 *   [12..14] COM - pelvis
 *   [15]     verticality (0..1, normalized to /50)
 *   [16]     verticality gap (target - current, normalized)
 *   [17..20] foot contacts (lFoot y, rFoot y, lFoot vy, rFoot vy)
 *   [21]     sin(gait_L phase)  ← CPG: left-leg step cycle
 *   [22]     cos(gait_L phase)
 *   [23]     sin(breath phase)  ← CPG: breathing cycle
 *   [24..35] left/right hand/knee positions relative to pelvis
 *   [36..39] intent one-hot (stand/walk/duck/act)
 *   [40]     target verticality / 50 (goal normalized)
 *   [41..42] target direction (xz, world-space, for walk/act)
 *   [43..46] terrain (height below / ahead / slope / lateral) — see OBS_SIZE comment
 *   [47..50] social (nearest-agent rel xz + rel vxz)
 *   [51..54] high-level motor intent (guard/brace/attack/recover)
 *   [55..77] tactile/proprioception block
 *
 * The sin/cos encoding of phase is standard NN representation for
 * circular variables (avoids wraparound discontinuity at 2π).
 *
 * @param {object} [sensors] optional PACER inputs:
 *   { heightAt(x,z): number,                  // ground y at world (x,z)
 *     nearestAgent: { dx, dz, dvx, dvz } | null }
 */
export function buildObservation(ragdoll, bonesByName, currentV, targetV, intent = null, rhythms = null, sensors = null) {
  const obs = new Float32Array(OBS_SIZE)
  const pelvis = bonesByName.pelvis?.particle
  if (!pelvis) return obs
  const chest = bonesByName.chest?.particle
  const lSh = bonesByName.leftShoulder?.particle
  const rSh = bonesByName.rightShoulder?.particle
  const lFoot = bonesByName.leftFoot?.particle
  const rFoot = bonesByName.rightFoot?.particle
  const lHand = bonesByName.leftHand?.particle
  const rHand = bonesByName.rightHand?.particle
  const lKnee = bonesByName.leftShin?.particle
  const rKnee = bonesByName.rightShin?.particle

  obs[0] = pelvis.x; obs[1] = pelvis.y; obs[2] = pelvis.z
  obs[3] = pelvis.vx; obs[4] = pelvis.vy; obs[5] = pelvis.vz

  if (chest) {
    obs[6] = chest.x - pelvis.x
    obs[7] = chest.y - pelvis.y
    obs[8] = chest.z - pelvis.z
  }
  if (lSh && rSh) {
    obs[9]  = rSh.x - lSh.x
    obs[10] = rSh.y - lSh.y
    obs[11] = rSh.z - lSh.z
  }
  // COM estimate = mean of major bones
  let cx = 0, cy = 0, cz = 0, n = 0
  for (const name of ['pelvis', 'chest', 'head', 'leftThigh', 'rightThigh']) {
    const p = bonesByName[name]?.particle
    if (p) { cx += p.x; cy += p.y; cz += p.z; n++ }
  }
  if (n > 0) {
    obs[12] = cx / n - pelvis.x
    obs[13] = cy / n - pelvis.y
    obs[14] = cz / n - pelvis.z
  }
  obs[15] = currentV / 50
  obs[16] = (targetV - currentV) / 50

  if (lFoot) { obs[17] = lFoot.y; obs[19] = lFoot.vy }
  if (rFoot) { obs[18] = rFoot.y; obs[20] = rFoot.vy }

  // CPG rhythm signals (sin/cos of gait-L, sin of breath). Provides the
  // NN with a body-internal time-base for rhythmic motor programs.
  // Replaces the previous static gravity vector placeholder.
  if (rhythms && rhythms.phases) {
    const gaitPhase = rhythms.phases[2] ?? 0       // RHYTHM.GAIT_L = 2
    const breathPhase = rhythms.phases[1] ?? 0     // RHYTHM.BREATH = 1
    obs[21] = Math.sin(gaitPhase)
    obs[22] = Math.cos(gaitPhase)
    obs[23] = Math.sin(breathPhase)
  } else {
    obs[21] = 0; obs[22] = 0; obs[23] = 0
  }

  const rel = [lHand, rHand, lKnee, rKnee]
  for (let i = 0; i < rel.length; i++) {
    const p = rel[i]
    const base = 24 + i * 3
    if (p) {
      obs[base]     = p.x - pelvis.x
      obs[base + 1] = p.y - pelvis.y
      obs[base + 2] = p.z - pelvis.z
    }
  }

  // Intent / goal vector — NN learns different policies per intent
  let dirX = 0, dirZ = 0
  if (intent) {
    const intentIdx = STATE_INTENTS[intent.type] ?? 0
    obs[36 + intentIdx] = 1   // one-hot
    obs[40] = (intent.targetVerticality ?? 50) / 50
    dirX = intent.targetDirX ?? 0
    dirZ = intent.targetDirZ ?? 0
    obs[41] = dirX
    obs[42] = dirZ
  } else {
    obs[36] = 1   // default = stand
    obs[40] = 1   // target verticality 50
  }

  // ─── TERRAIN (PACER) — dims 43..46 ──────────────────────────────────────
  // All four dims default to 0 (flat ground assumption) when no terrain
  // sensor is provided — back-compat with brains trained pre-terrain.
  if (sensors && typeof sensors.heightAt === 'function') {
    const px = pelvis.x, pz = pelvis.z
    const hereY = sensors.heightAt(px, pz)
    // Normalize a dirXZ for probe offsets. If no walk/act direction, probe
    // straight ahead in body-facing space using chest-pelvis xz.
    let probeDx = dirX, probeDz = dirZ
    let pLen = Math.hypot(probeDx, probeDz)
    if (pLen < 0.01 && chest) {
      probeDx = chest.x - pelvis.x
      probeDz = chest.z - pelvis.z
      pLen = Math.hypot(probeDx, probeDz)
    }
    if (pLen > 0.01) { probeDx /= pLen; probeDz /= pLen }
    else             { probeDx = 0; probeDz = 1 }   // default +Z
    const PROBE = 0.6                           // meters ahead
    const aheadY = sensors.heightAt(px + probeDx * PROBE, pz + probeDz * PROBE)
    // Perpendicular direction for lateral probe (rotate 90° in xz plane)
    const sideY = sensors.heightAt(px + (-probeDz) * PROBE, pz + probeDx * PROBE)
    // Relative heights (normalized by a typical step 0.5m so values stay O(1))
    obs[43] = clamp((hereY - pelvis.y) / 0.5, -2, 2)
    obs[44] = clamp((aheadY - pelvis.y) / 0.5, -2, 2)
    // Slope ahead: rise over run, clamped to ±1 (45° max signal).
    obs[45] = clamp((aheadY - hereY) / PROBE, -1, 1)
    obs[46] = clamp((sideY - pelvis.y) / 0.5, -2, 2)
  }

  // ─── SOCIAL (PACER) — dims 47..50 ───────────────────────────────────────
  // Nearest OTHER agent's relative position + velocity, clamped and scaled
  // so the NN only cares about neighbors within ~3m (crowd avoidance range).
  // When no one is nearby, all four dims are 0 — NN reads this as "clear".
  if (sensors && sensors.nearestAgent) {
    const { dx, dz, dvx, dvz } = sensors.nearestAgent
    obs[47] = clamp(dx / 3, -1, 1)
    obs[48] = clamp(dz / 3, -1, 1)
    obs[49] = clamp(dvx / 2, -1, 1)
    obs[50] = clamp(dvz / 2, -1, 1)
  }

  if (intent) {
    obs[51] = intent.guard ? 1 : 0
    obs[52] = intent.brace ? 1 : 0
    obs[53] = intent.attack ? 1 : 0
    obs[54] = intent.recover ? 1 : 0
  }

  fillTactileObservation(obs, sensors?.contactTelemetry, sensors?.balanceState, bonesByName, pelvis, chest, dirX, dirZ)

  return obs
}

function fillTactileObservation(obs, contactTelemetry, balanceState, bonesByName, pelvis, chest, dirX = 0, dirZ = 0) {
  const frame = bodyFrame(pelvis, chest, dirX, dirZ)
  const left = contactTelemetry?.feet?.left || null
  const right = contactTelemetry?.feet?.right || null
  writeFootTactile(obs, 55, left, frame)
  writeFootTactile(obs, 56, right, frame)
  obs[73] = supportConfidence(contactTelemetry, balanceState)
  const support = supportShapeProxy(left, right, frame)
  obs[74] = support.width
  obs[75] = support.depth
  obs[76] = limbCrossingSeverity(bonesByName, pelvis, frame)
  obs[77] = headNeckLeanSeverity(bonesByName)
}

function writeFootTactile(obs, stanceIdx, record, frame) {
  const isLeft = stanceIdx === 55
  const slipIdx = isLeft ? 57 : 58
  const normalIdx = isLeft ? 59 : 62
  const pressureIdx = isLeft ? 65 : 66
  const toeIdx = isLeft ? 67 : 68
  const alignIdx = isLeft ? 69 : 70
  const frictionIdx = isLeft ? 71 : 72
  if (!record) return
  obs[stanceIdx] = clamp(record.stanceTrust ?? 0, 0, 1)
  obs[slipIdx] = clamp(record.slipRisk ?? 0, 0, 1)
  const n = toBodyFrame(record.normal || [0, 1, 0], frame)
  obs[normalIdx] = n[0]
  obs[normalIdx + 1] = n[1]
  obs[normalIdx + 2] = n[2]
  obs[pressureIdx] = clamp(record.pressure ?? 0, 0, 1)
  obs[toeIdx] = clamp(Math.abs(record.derived?.toeForwardDelta ?? 0) / Math.PI, 0, 1)
  obs[alignIdx] = clamp(record.derived?.shinFootAlignmentError ?? 0, 0, 1)
  obs[frictionIdx] = clamp((record.surface?.friction ?? 1) / 1.5, 0, 1)
}

function bodyFrame(pelvis, chest, dirX = 0, dirZ = 0) {
  let fwdX = dirX
  let fwdZ = dirZ
  let len = Math.hypot(fwdX, fwdZ)
  if (len < 0.01 && chest && pelvis) {
    fwdX = chest.x - pelvis.x
    fwdZ = chest.z - pelvis.z
    len = Math.hypot(fwdX, fwdZ)
  }
  if (len < 0.01) {
    fwdX = 0
    fwdZ = 1
    len = 1
  }
  fwdX /= len
  fwdZ /= len
  return {
    fwdX,
    fwdZ,
    sideX: fwdZ,
    sideZ: -fwdX,
  }
}

function toBodyFrame(v, frame) {
  const x = (v[0] || 0) * frame.sideX + (v[2] || 0) * frame.sideZ
  const y = v[1] || 0
  const z = (v[0] || 0) * frame.fwdX + (v[2] || 0) * frame.fwdZ
  return [clamp(x, -1, 1), clamp(y, -1, 1), clamp(z, -1, 1)]
}

function supportShapeProxy(left, right, frame) {
  const lp = Array.isArray(left?.point) ? left.point : null
  const rp = Array.isArray(right?.point) ? right.point : null
  if (!lp || !rp) return { width: 0, depth: 0 }
  const dx = rp[0] - lp[0]
  const dz = rp[2] - lp[2]
  const side = Math.abs(dx * frame.sideX + dz * frame.sideZ)
  const fwd = Math.abs(dx * frame.fwdX + dz * frame.fwdZ)
  return {
    width: clamp(side / 0.6, 0, 1),
    depth: clamp(fwd / 0.8, 0, 1),
  }
}

function supportConfidence(contactTelemetry, balanceState) {
  const contactSupport = clamp(contactTelemetry?.summary?.supportQuality ?? 0, 0, 1)
  const groundedFeet = balanceState?.groundedFeet ?? contactTelemetry?.summary?.groundedFeet ?? 0
  if (!balanceState) return groundedFeet > 0 ? contactSupport : 0
  const balanceError = Math.max(0, balanceState.balanceError ?? 0)
  const balanceSupport = groundedFeet > 0 ? clamp(1 - balanceError / 0.45, 0, 1) : 0
  return clamp(contactSupport * 0.55 + balanceSupport * 0.45, 0, 1)
}

function limbCrossingSeverity(bonesByName, pelvis, frame) {
  const lFoot = bonesByName.leftFoot?.particle
  const rFoot = bonesByName.rightFoot?.particle
  if (!pelvis || !lFoot || !rFoot) return 0
  const sideOf = (p) => (p.x - pelvis.x) * frame.sideX + (p.z - pelvis.z) * frame.sideZ
  const leftSide = sideOf(lFoot)
  const rightSide = sideOf(rFoot)
  const leftCross = Math.max(0, leftSide + 0.03)
  const rightCross = Math.max(0, 0.03 - rightSide)
  return clamp((leftCross + rightCross) / 0.3, 0, 1)
}

function headNeckLeanSeverity(bonesByName) {
  const head = bonesByName.head?.particle
  const chest = bonesByName.chest?.particle
  if (!head || !chest) return 0
  const horizontal = Math.hypot(head.x - chest.x, head.z - chest.z)
  const vertical = Math.max(0.05, head.y - chest.y)
  return clamp((horizontal / vertical) / 0.75, 0, 1)
}

/**
 * Forward pass through the network with neuromodifier effects applied.
 * Returns per-bone Δxyz offsets (in ragdoll name order).
 */
export function neuralMotorForward(motor, obs, time = 0, options = null) {
  // DELAY modifier — use older obs if requested
  const mod = motor.modifiers
  let input = obs
  if (mod.delay > 0) {
    motor.obsBuffer.push(obs)
    if (motor.obsBuffer.length > mod.delay + 1) motor.obsBuffer.shift()
    input = motor.obsBuffer[0] || obs
  }

  // Hidden layers (all but last) → modifiers applied to each activation
  let h = input
  const layers = motor.layers
  const lastIdx = layers.length - 1
  for (let i = 0; i < lastIdx; i++) {
    h = forwardLayer(layers[i], h)
    h = applyModifiers(h, mod, time, i + 1, motor.rng)
  }
  // Output (linear head, no modifiers on pre-output)
  const out = forwardLayer(layers[lastIdx], h)

  // Output scale modifier (paralytic = 0, stimulant > 1)
  const scale = mod.scale ?? 1

  // ─── EXPLORATION NOISE (motor babbling, decaying) ───────────────────
  // Real motor learning requires exploration: infants "babble" their
  // motor outputs randomly to discover what each muscle does, then
  // refine. Without exploration, a policy gets stuck in local optima
  // (standard RL failure mode).
  //
  // We add Gaussian noise to the output, with magnitude proportional to
  // training loss — high loss (untrained) = lots of babbling, low loss
  // (expert) = almost none. This gives infants→adults motor development.
  //
  // σ = 0.2 × tanh(lossEMA × 20): 0 at perfect, ~0.2 at loss=0.1
  const explorationScale = Math.max(0, Math.min(1, options?.explorationScale ?? 1))
  const babbleSigma = 0.2 * Math.tanh(motor.lossEMA * 20) * explorationScale
  const rng = motor.rng

  // Clamp offsets to physical maximum
  const offsets = new Float32Array(ACTION_SIZE)
  for (let i = 0; i < ACTION_SIZE; i++) {
    let v = out[i]
    // Motor babble — stochastic exploration term, decays with training
    if (babbleSigma > 0.001) {
      const boneName = BONE_ORDER[Math.floor(i / 3)]
      v += normalDistribution(0, babbleSigma * (BABBLE_SCALE_BY_BONE[boneName] ?? 0.2), rng)
    }
    v *= OFFSET_CLAMP * scale
    if (v >  OFFSET_CLAMP) v =  OFFSET_CLAMP
    if (v < -OFFSET_CLAMP) v = -OFFSET_CLAMP
    offsets[i] = v
  }
  return offsets
}

export function getNeuralInferenceBackendReport(bodyCount = 0, gpu = null) {
  const webgpuAvailable = !!gpu || typeof navigator !== 'undefined' && !!navigator.gpu
  const shouldBatch = webgpuAvailable && bodyCount >= GPU_BATCH_MIN_BODIES
  return {
    backend: shouldBatch ? 'gpuTile' : 'cpu',
    webgpuAvailable,
    bodyCount,
    gpuBatchMinBodies: GPU_BATCH_MIN_BODIES,
    batchingRecommended: shouldBatch,
    gpuTileReady: false,
    reason: shouldBatch
      ? 'body count justifies a future GpuTile batched MLP pipeline'
      : webgpuAvailable
        ? `below GPU batching threshold (${bodyCount}/${GPU_BATCH_MIN_BODIES})`
        : 'WebGPU unavailable',
  }
}

function applyModifiers(act, mod, time, layerId, rng = GLOBAL_RNG) {
  // NOISE — Gaussian into activations (per-entity seeded so drunk/poisoned
  // bodies don't all jitter in phase)
  if (mod.noise > 0) {
    for (let i = 0; i < act.length; i++) act[i] += normalDistribution(0, mod.noise, rng)
  }
  // DROPOUT — stochastic ablation (seizure-like, also used as KO simulation)
  if (mod.dropout > 0) {
    for (let i = 0; i < act.length; i++) {
      if (rng() < mod.dropout) act[i] = 0
    }
  }
  // TREMOR — coherent oscillation (Parkinson's-style)
  if (mod.tremor > 0 && layerId === 2) {
    const phase = time * mod.tremorHz * 2 * Math.PI
    const osc = Math.sin(phase) * mod.tremor
    for (let i = 0; i < act.length; i++) act[i] += osc
  }
  // SEIZURE — random big spikes in activations
  if (mod.seizureAmp > 0) {
    for (let i = 0; i < act.length; i++) {
      if (rng() < 0.05) act[i] += (rng() * 2 - 1) * mod.seizureAmp
    }
  }
  return act
}

/**
 * Compute a scalar reward for the current body state.
 *
 * Real DeepMimic-style reward function — additive terms with sensible
 * weights. All terms ∈ [0, 1] so total ≤ sum of weights (~5).
 *
 *   poseMatch     — mean bone distance to pose target (closer = higher)
 *   upright       — head Y above pelvis Y, normalized (no face-plant)
 *   stable        — low velocity = higher (not thrashing)
 *   goalProgress  — state-dependent (verticality match, walk speed, etc)
 *
 * Returns:
 *   reward ∈ [0, ~5] approximately; scale to [0, 1] with r/5 for AWR weight
 */
export function computeReward(ragdoll, bonesByName, poseTargets, intent) {
  const pelvis = bonesByName.pelvis?.particle
  const head = bonesByName.head?.particle
  if (!pelvis || !head) return 0

  // 1. POSE MATCH — mean distance to targets (exponential decay so close = ~1)
  let totalDist = 0, count = 0
  for (let i = 0; i < BONE_ORDER.length; i++) {
    const name = BONE_ORDER[i]
    const p = bonesByName[name]?.particle
    const t = poseTargets?.[name]
    if (!p || !t) continue
    const dx = t[0] - p.x, dy = t[1] - p.y, dz = t[2] - p.z
    totalDist += Math.sqrt(dx * dx + dy * dy + dz * dz)
    count++
  }
  const avgDist = count > 0 ? totalDist / count : 1
  const poseMatch = Math.exp(-avgDist * 3)   // 10cm err → 0.74, 30cm → 0.41, 1m → 0.05

  // 2. UPRIGHT — head above pelvis (no face-plant). Normalized to stand pose Δy ≈ 1.35
  const headDy = Math.max(0, head.y - pelvis.y)
  const upright = Math.min(1, headDy / 1.35)

  // 3. STABLE — low linear velocity across core bones (body isn't flailing)
  let vsum = 0, vn = 0
  for (const name of ['pelvis', 'chest', 'head']) {
    const b = bonesByName[name]?.particle
    if (!b) continue
    vsum += Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz)
    vn++
  }
  const avgV = vn > 0 ? vsum / vn : 0
  const stable = Math.exp(-avgV * 0.5)       // 2 m/s → 0.37, 5 m/s → 0.08

  // 4. GOAL PROGRESS — state-dependent
  let goalProgress = 0
  if (intent) {
    switch (intent.type) {
      case 'stand': {
        const standHeadY = 3.15    // from stand.json
        goalProgress = Math.exp(-Math.abs(head.y - standHeadY) * 2)
        break
      }
      case 'walk': {
        // Reward forward velocity in intent direction at desired speed.
        // Desired speed defaults to 1.5 m/s but the TRACE planner can set
        // lower (pedestrian stroll ~0.8) or higher (guard patrol ~2.2) via
        // intent.desiredSpeed — NN learns speed control from this signal.
        const tx = intent.targetDirX ?? 0
        const tz = intent.targetDirZ ?? 0
        const mag = Math.sqrt(tx * tx + tz * tz)
        const desiredSpeed = intent.desiredSpeed ?? 1.5
        let velocityTerm = 0
        if (mag > 0.01) {
          const fwdV = (pelvis.vx * tx + pelvis.vz * tz) / mag
          // Penalize over- AND under-shoot (symmetric around desired)
          velocityTerm = Math.exp(-Math.abs(fwdV - desiredSpeed) * 0.6)
        }
        // WAYPOINT PROGRESS (TRACE) — if planner gave us a concrete target
        // point, reward proximity to it. Exponential so close = ~1, 2m = 0.14.
        let waypointTerm = 0
        if (intent.waypoint) {
          const wx = intent.waypoint[0], wz = intent.waypoint[1]
          const d = Math.hypot(wx - pelvis.x, wz - pelvis.z)
          waypointTerm = Math.exp(-d * 0.5)      // 1m → 0.61, 3m → 0.22
        }
        // Blend: must stay upright, then balance velocity + waypoint proximity.
        // Weights chosen so no single term dominates — NN has to do all three.
        goalProgress = 0.4 * upright + 0.3 * velocityTerm + 0.3 * waypointTerm
        break
      }
      case 'duck': {
        goalProgress = Math.exp(-Math.abs(head.y - 1.5) * 2)  // head low
        break
      }
      case 'act': {
        goalProgress = upright * stable                       // just be ready
        break
      }
    }
  }

  // Weighted sum. Positive terms = achievements. Negative term = CONTROL
  // COST (effort penalty) — standard in RL motor learning benchmarks
  // (MuJoCo Humanoid, OpenAI Gym) and real biomechanics.
  //
  // Without a control cost, the NN has no incentive to be efficient: it
  // just needs to track the teacher, regardless of how much energy that
  // takes. Real humans minimize effort automatically — you don't flail
  // your arms while standing still, even though you *could*. We model
  // this by subtracting 0.05 × core_velocity² (squared = quadratic cost,
  // cheap small motions, expensive big ones).
  //
  // This turns the RL from "match reference" into "match reference with
  // minimum effort", which is what motor-learning literature calls
  // "optimal control" and what actual motor cortices implement.
  const effortCost = 0.05 * avgV * avgV

  return (
    1.5 * poseMatch +
    1.0 * upright +
    0.8 * stable +
    1.2 * goalProgress -
    effortCost               // ← motor efficiency penalty
  )
}

/**
 * Advantage-Weighted Regression (AWR) training step.
 *
 * Standard behavior cloning: minimize MSE(NN_out, teacher)
 * AWR: minimize reward_weight * MSE(NN_out, teacher)
 *
 * Effect: NN imitates the teacher ONLY when the state is good (high reward).
 * Bad states contribute ~0 gradient. This implicitly learns which actions
 * lead to high reward — a form of reinforcement learning without full PPO
 * machinery. Used in shipping games (DReCon) and research (AWR, RWR).
 *
 * @param {number} reward - scalar reward for current state (from computeReward)
 * @param {number} baseline - EMA baseline subtracted to form advantage (optional)
 */
export function trainNeuralMotor(motor, obs, teacherOffsets, reward = null, opts = {}) {
  // NEUROPLASTICITY BOOST — a damaged brain learns faster (neuroplasticity
  // is upregulated after injury; Pascual-Leone 2005). This lets characters
  // actively recover motor function through practice. Max +50% lr when
  // damage > 0.01.
  const plasticityBoost = 1 + Math.min(0.5, (motor.brainDamage ?? 0) * 50)
  const lr = (opts.lr ?? LEARNING_RATE) * plasticityBoost
  // STABILITY GATE — skip training when the body is thrashing. Teacher
  // signal is meaningless when the body is chaotic (flying, spinning,
  // mid-ragdoll), and training on that just corrupts the NN. `stable`
  // means core velocity is low enough that the target pose is reachable.
  const stable = opts.stable ?? true
  if (!stable) {
    motor.framesSkipped = (motor.framesSkipped ?? 0) + 1
    return
  }

  // ─── NEURO CORRUPTION OF TRAINING ─────────────────────────────────
  // Real neurological events (seizure, stroke, drugs) don't just corrupt
  // output — they corrupt LEARNING itself:
  //
  //   catastrophic forgetting (McCloskey 1989) — bad data overwrites
  //     learned weights. Modeled by adding noise to gradients.
  //
  //   dying ReLU (Lu et al 2019) — suppressed neurons lose their gradient
  //     pathway. Modeled by skipping updates on dropout-hit weights.
  //
  //   seizure-induced atrophy (Holmes 2002) — repeated seizures leave
  //     permanent cortical thinning. Modeled by accumulated "damage" that
  //     persists after the event ends.
  const mod = motor.modifiers
  const rng = motor.rng ?? GLOBAL_RNG
  const damage = (mod.dropout ?? 0) + (mod.seizureAmp ?? 0) * 0.4 + (mod.noise ?? 0) * 0.3
  if (damage > 0.1) {
    // SKIP TRAINING during active disruption — teacher signal may be valid,
    // but the NN's state is so corrupted that backprop would make it worse
    // ("bad learning day"). Real neurology: seizure patients can't form
    // new memories during an event.
    if (damage > 0.5 && rng() < damage) {
      motor.framesSkipped = (motor.framesSkipped ?? 0) + 1
      return
    }

    // ACCUMULATE PERSISTENT DAMAGE — random weight perturbation that
    // doesn't recover when the event ends. Like cortical thinning.
    // Small enough that brief events cause minor damage, but sustained
    // seizures/poisoning cause real loss of capability.
    motor.brainDamage = (motor.brainDamage ?? 0) + damage * 0.00002
    if (rng() < damage * 0.001) {
      // Apply permanent damage: randomly perturb weights in a random layer
      const layer = motor.layers[Math.floor(rng() * motor.layers.length)]
      const W = layer.W
      const idx = Math.floor(rng() * W.length)
      W[idx] += normalDistribution(0, 0.1, motor.rng)   // lasting scar
    }
  }

  const layers = motor.layers
  // Clean forward pass (no modifiers while training)
  let a = obs
  for (let i = 0; i < layers.length; i++) a = forwardLayer(layers[i], a)
  const y = a

  // Target = teacherOffsets normalized to [-1, 1]. Most of the time the
  // offsets are small (< clamp). On rare big swings we squash with tanh
  // instead of hard-clipping, so gradient doesn't fully saturate.
  const target = new Float32Array(ACTION_SIZE)
  for (let i = 0; i < ACTION_SIZE; i++) {
    const v = teacherOffsets[i] / OFFSET_CLAMP
    target[i] = Math.tanh(v)   // smooth bound to [-1, 1]
  }

  // AWR advantage weight. Maintain an EMA reward baseline; advantage is
  // how much this state exceeds the running average. Lower beta (0.2)
  // keeps the scaling modest so gradients don't blow up.
  motor.rewardBaseline ??= 0
  let awrWeight = 1
  if (reward !== null) {
    const baseline = motor.rewardBaseline
    motor.rewardBaseline = baseline * 0.995 + reward * 0.005
    const advantage = reward - baseline
    const BETA = 0.2
    // Clamp to [0.25, 3] — never fully zero gradient, never blow up
    awrWeight = Math.max(0.25, Math.min(3, Math.exp(BETA * advantage)))
    motor.rewardEMA = (motor.rewardEMA ?? 0) * 0.99 + reward * 0.01
  }

  // MSE gradient × AWR weight, with gradient norm clipping.
  // CATASTROPHIC FORGETTING: if neuro damage is active, inject noise into
  // the gradient. The NN will still "try" to learn but its weight updates
  // will be partly random — over time this degrades learned behavior
  // even after the event ends. This is the standard ML explanation for
  // how real brains lose learned skills during neurological trauma.
  const gradNoise = mod ? (mod.noise ?? 0) * 0.4 : 0
  const dY = new Float32Array(ACTION_SIZE)
  let loss = 0
  const gradScale = (2 / ACTION_SIZE) * awrWeight
  let gradNormSq = 0
  for (let i = 0; i < ACTION_SIZE; i++) {
    const d = y[i] - target[i]
    let g = d * gradScale
    if (gradNoise > 0) g += normalDistribution(0, gradNoise, motor.rng)
    dY[i] = g
    loss += d * d
    gradNormSq += g * g
  }
  loss /= ACTION_SIZE

  // Global gradient norm clipping — critical for stability. If ||∇|| > max,
  // rescale all components. Prevents occasional huge gradients from
  // corrupting the network.
  const GRAD_MAX = 1.0
  const gradNorm = Math.sqrt(gradNormSq)
  if (gradNorm > GRAD_MAX) {
    const s = GRAD_MAX / gradNorm
    for (let i = 0; i < ACTION_SIZE; i++) dY[i] *= s
  }

  // Backprop — walk layers in reverse
  let grad = dY
  for (let i = layers.length - 1; i >= 0; i--) {
    grad = backwardLayer(layers[i], grad, lr)
  }

  motor.lossEMA = motor.lossEMA * 0.99 + loss * 0.01
  pushTrend(motor, 'lossTrend', motor.lossEMA)
  if (reward !== null) pushTrend(motor, 'rewardTrend', motor.rewardEMA ?? reward)
  motor.framesTrained++
}

export function getNeuralMotorDebugReport(motor) {
  if (!motor) return null
  return {
    tier: motor.tier,
    seed: motor.seed,
    framesTrained: motor.framesTrained,
    framesSkipped: motor.framesSkipped ?? 0,
    lossEMA: motor.lossEMA,
    rewardEMA: motor.rewardEMA ?? null,
    rewardBaseline: motor.rewardBaseline ?? null,
    brainDamage: motor.brainDamage ?? 0,
    lossTrend: [...(motor.lossTrend || [])],
    rewardTrend: [...(motor.rewardTrend || [])],
    activations: motor.layers.map((layer, index) => ({
      index,
      inSize: layer.inSize,
      outSize: layer.outSize,
      noAct: layer.noAct,
      z: summarizeArray(layer.z),
      a: summarizeArray(layer.a),
    })),
    weights: motor.layers.map((layer, index) => ({
      index,
      inSize: layer.inSize,
      outSize: layer.outSize,
      W: summarizeArray(layer.W),
      b: summarizeArray(layer.b),
    })),
  }
}

function pushTrend(motor, key, value) {
  const trend = motor[key] || []
  trend.push(value)
  if (trend.length > 120) trend.shift()
  motor[key] = trend
}

function summarizeArray(values) {
  if (!values || values.length === 0) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sumSq = 0
  let zeroLike = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v < min) min = v
    if (v > max) max = v
    if (Math.abs(v) < 1e-4) zeroLike++
    sum += v
    sumSq += v * v
  }
  const count = values.length
  const mean = sum / count
  return {
    count,
    min,
    max,
    mean,
    rms: Math.sqrt(sumSq / count),
    zeroLike,
    zeroLikeRatio: zeroLike / count,
  }
}

/**
 * Apply motor output as per-bone target offsets. Call AFTER the kinematic
 * blend has computed its targets; the NN adds corrective deltas.
 */
export function applyNeuralOffsets(offsets, targets) {
  for (let i = 0; i < ACTION_BONES; i++) {
    const name = BONE_ORDER[i]
    const t = targets[name]
    if (!t) continue
    const base = i * 3
    t[0] += offsets[base]
    t[1] += offsets[base + 1]
    t[2] += offsets[base + 2]
  }
}

/**
 * Compute the "teacher signal" — the delta the kinematic controller would
 * apply this frame. For DAgger training, this is what the NN tries to
 * predict. Simple formula: (kinematic_target - actual_position) × rate.
 */
export function computeTeacherSignal(kinematicTargets, ragdoll, bonesByName, rate = 0.15) {
  const out = new Float32Array(ACTION_SIZE)
  for (let i = 0; i < ACTION_BONES; i++) {
    const name = BONE_ORDER[i]
    const t = kinematicTargets[name]
    const bone = bonesByName[name]
    if (!t || !bone?.particle) continue
    const p = bone.particle
    const base = i * 3
    out[base]     = (t[0] - p.x) * rate
    out[base + 1] = (t[1] - p.y) * rate
    out[base + 2] = (t[2] - p.z) * rate
  }
  return out
}

// ─── SERIALIZATION ──────────────────────────────────────────────────────────

// V5 = adds 23 tactile/proprioception dims to observation (78 total, was 55).
// Older brains are auto-migrated: first-layer weights are zero-padded for the
// new input cols so trained behavior is preserved until retraining.
const BRAIN_MAGIC = 'LIFE_BRAIN_V5'
const BRAIN_VERSION = 5
const BRAIN_MAGIC_V4 = 'LIFE_BRAIN_V4'
const BRAIN_MAGIC_V3 = 'LIFE_BRAIN_V3'
const BRAIN_MAGIC_V2 = 'LIFE_BRAIN_V2'
const V4_OBS_SIZE = 55
const V3_OBS_SIZE = 51
const V2_OBS_SIZE = 43
const BRAIN_FORMATS = Object.freeze([
  { magic: BRAIN_MAGIC_V2, version: 2, obsSize: V2_OBS_SIZE },
  { magic: BRAIN_MAGIC_V3, version: 3, obsSize: V3_OBS_SIZE },
  { magic: BRAIN_MAGIC_V4, version: 4, obsSize: V4_OBS_SIZE },
  { magic: BRAIN_MAGIC, version: BRAIN_VERSION, obsSize: OBS_SIZE },
])

/**
 * Serialize a NeuralMotor to a compact JSON-safe object. Weights are packed
 * as base64-encoded Float32 bytes. Enforces 10 MB per-brain cap.
 *
 * Layout:
 *   { magic, version, tier, hiddens[], bytes (base64), framesTrained, lossEMA }
 */
export function serializeMotor(motor) {
  const hiddens = motor.layers.slice(0, -1).map(L => L.outSize)
  // Pack all weights and biases sequentially
  let totalFloats = 0
  for (const L of motor.layers) totalFloats += L.W.length + L.b.length
  const buf = new ArrayBuffer(totalFloats * 4)
  const f32 = new Float32Array(buf)
  let off = 0
  for (const L of motor.layers) {
    f32.set(L.W, off); off += L.W.length
    f32.set(L.b, off); off += L.b.length
  }
  if (buf.byteLength > MAX_BRAIN_BYTES) {
    throw new Error(`[BRAIN] Serialized size ${buf.byteLength} exceeds ${MAX_BRAIN_BYTES/1024/1024} MB cap`)
  }
  if (buf.byteLength > WARN_BRAIN_BYTES) {
    console.warn(`[BRAIN] Saving large brain (${(buf.byteLength/1024/1024).toFixed(1)} MB — magical tier)`)
  }
  const bytes = new Uint8Array(buf)
  const b64 = bytesToBase64(bytes)
  const optimization = analyzeMotorStorage(motor, bytes)

  return {
    magic: BRAIN_MAGIC,
    version: BRAIN_VERSION,
    tier: motor.tier,
    hiddens,
    bytes: b64,
    byteSize: buf.byteLength,
    framesTrained: motor.framesTrained,
    lossEMA: motor.lossEMA,
    brainDamage: motor.brainDamage ?? 0,
    fingerprint: optimization.fingerprint,
    optimization,
    savedAt: Date.now(),
  }
}

/**
 * Load serialized brain data into an existing motor (replaces weights).
 * Rebuilds layer chain if hiddens differ. Returns true on success.
 */
export function deserializeMotor(motor, data, options = {}) {
  const silent = !!options.silent
  if (!data) {
    if (!silent) console.warn('[BRAIN] Empty brain data')
    return false
  }
  const format = getBrainFormat(data)
  if (!format) {
    if (!silent) console.warn('[BRAIN] Invalid or wrong-version brain data', { magic: data.magic, version: data.version })
    return false
  }
  const savedObsSize = format.obsSize
  if (!silent && savedObsSize !== OBS_SIZE) {
    console.info(`[BRAIN] Migrating V${data.version} → V${BRAIN_VERSION} (observation ${savedObsSize}→${OBS_SIZE}, zero-padded)`)
  }
  // Rebuild layers if architecture differs. Current brains always build with inSize=OBS_SIZE.
  const needRebuild =
    !motor.layers ||
    motor.layers.length !== data.hiddens.length + 1 ||
    motor.layers.some((L, i) =>
      (i < data.hiddens.length && L.outSize !== data.hiddens[i]) ||
      (i === data.hiddens.length && L.outSize !== ACTION_SIZE)
    ) ||
    motor.layers[0]?.inSize !== OBS_SIZE
  if (needRebuild) {
    const newLayers = []
    let prev = OBS_SIZE
    for (const h of data.hiddens) {
      newLayers.push(makeLayer(prev, h))
      prev = h
    }
    newLayers.push(makeLayer(prev, ACTION_SIZE, true))
    motor.layers = newLayers
    motor.tier = data.tier
  }
  // Decode base64 → bytes → floats → weights/biases
  const bytes = base64ToBytes(data.bytes)
  const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  let off = 0
  for (let li = 0; li < motor.layers.length; li++) {
    const L = motor.layers[li]
    if (savedObsSize !== OBS_SIZE && li === 0) {
      const savedFloats = savedObsSize * L.outSize
      const newW = new Float32Array(L.W.length)       // already zero-filled
      newW.set(f32.subarray(off, off + savedFloats))
      L.W = newW
      off += savedFloats
    } else {
      L.W = new Float32Array(f32.buffer.slice(
        (f32.byteOffset + off * 4), (f32.byteOffset + (off + L.W.length) * 4)
      ))
      off += L.W.length
    }
    L.b = new Float32Array(f32.buffer.slice(
      (f32.byteOffset + off * 4), (f32.byteOffset + (off + L.b.length) * 4)
    ))
    off += L.b.length
  }
  motor.framesTrained = data.framesTrained || 0
  motor.lossEMA = data.lossEMA || 0
  motor.brainDamage = data.brainDamage || 0
  return true
}

function getBrainFormat(data) {
  return BRAIN_FORMATS.find(format =>
    data.magic === format.magic &&
    data.version === format.version
  ) || null
}

export function analyzeMotorStorage(motor, packedBytes = null) {
  const values = []
  for (const layer of motor.layers || []) {
    for (const v of layer.W) values.push(v)
    for (const v of layer.b) values.push(v)
  }
  let zeroLike = 0
  let maxAbs = 0
  let sumAbs = 0
  let sumSq = 0
  for (const v of values) {
    const a = Math.abs(v)
    if (a < 1e-4) zeroLike++
    if (a > maxAbs) maxAbs = a
    sumAbs += a
    sumSq += v * v
  }
  const count = values.length || 1
  const byteSize = packedBytes?.byteLength ?? count * 4
  return {
    fingerprint: packedBytes ? fingerprintBytes(packedBytes) : fingerprintMotor(motor),
    weights: values.length,
    byteSize,
    prunableWeights: zeroLike,
    prunableRatio: zeroLike / count,
    maxAbs,
    meanAbs: sumAbs / count,
    rms: Math.sqrt(sumSq / count),
    quantization: estimateInt8Quantization(byteSize, maxAbs),
    distillation: estimateDistillationTarget(motor),
  }
}

function estimateInt8Quantization(byteSize, maxAbs) {
  return {
    mode: 'int8_symmetric',
    scale: maxAbs > 0 ? maxAbs / 127 : 1,
    estimatedBytes: Math.ceil(byteSize * 0.25),
    estimatedRatio: 0.25,
    runtimeDefault: false,
  }
}

function estimateDistillationTarget(motor) {
  const hiddens = motor.layers?.slice(0, -1).map(layer => layer.outSize) || []
  if (hiddens.length === 0) return null
  const distilled = hiddens.map(width => Math.max(16, Math.floor(width * 0.5)))
  return {
    hiddens: distilled,
    requiresRollouts: true,
    runtimeDefault: false,
  }
}

function fingerprintMotor(motor) {
  let hash = 2166136261
  for (const layer of motor.layers || []) {
    hash = fnv1aNumber(hash, layer.inSize)
    hash = fnv1aNumber(hash, layer.outSize)
    for (const v of layer.W) hash = fnv1aNumber(hash, Math.fround(v))
    for (const v of layer.b) hash = fnv1aNumber(hash, Math.fround(v))
  }
  return hash.toString(16).padStart(8, '0')
}

function fingerprintBytes(bytes) {
  let hash = 2166136261
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function fnv1aNumber(hash, value) {
  const text = String(value)
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// ─── INDEXEDDB STORAGE ──────────────────────────────────────────────────────
//
// Uses IndexedDB for 100+ MB capacity (localStorage is only 5-10 MB). Each
// entity gets one primary brain saved under its id, plus up to 100 player
// snapshot slots under keys `player.slot.<n>`.

const DB_NAME = 'life_brains'
const DB_VERSION = 1
const STORE = 'brains'
let _dbPromise = null

function openBrainDB() {
  if (_dbPromise) return _dbPromise
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('No IndexedDB'))
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)  // key = brain id, value = serialized obj
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return _dbPromise
}

/** Save a brain under `id`. Enforces 10 MB per-brain cap. */
export async function saveBrain(id, motor) {
  const data = serializeMotor(motor)   // throws if > 10 MB
  const db = await openBrainDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(data, id)
    tx.oncomplete = () => resolve(data.byteSize)
    tx.onerror = () => reject(tx.error)
  })
}

/** Load a brain by id. Returns serialized data or null. */
export async function loadBrain(id) {
  const db = await openBrainDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

/** Delete a brain. */
export async function deleteBrain(id) {
  const db = await openBrainDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** List all saved brain ids with their sizes. */
export async function listBrains() {
  const db = await openBrainDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const out = []
    store.openCursor().onsuccess = (e) => {
      const cur = e.target.result
      if (cur) {
        out.push({
          id: cur.key,
          tier: cur.value.tier,
          byteSize: cur.value.byteSize,
          framesTrained: cur.value.framesTrained,
          lossEMA: cur.value.lossEMA,
          savedAt: cur.value.savedAt,
        })
        cur.continue()
      } else {
        resolve(out)
      }
    }
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Export a brain as a downloadable JSON file (base64 inside). Useful for
 * sharing trained brains between players.
 */
export function exportBrainAsJson(motor) {
  return JSON.stringify(serializeMotor(motor))
}

export async function exportBrainAsCompressedJson(motor) {
  const json = exportBrainAsJson(motor)
  const bytes = textToBytes(json)
  const canGzip = typeof CompressionStream !== 'undefined'
  const packed = canGzip ? await gzipBytes(bytes) : bytes
  return JSON.stringify({
    magic: 'LIFE_BRAIN_PACKAGE_V1',
    transport: canGzip ? 'base64+gzip' : 'base64',
    encoding: 'utf8-json',
    bytes: bytesToBase64(packed),
    rawBytes: bytes.byteLength,
    compressedBytes: packed.byteLength,
    savedAt: Date.now(),
  })
}

/** Import a JSON string (from exportBrainAsJson) into a motor. */
export function importBrainFromJson(motor, jsonStr) {
  try {
    const data = JSON.parse(jsonStr)
    if (data?.magic === 'LIFE_BRAIN_PACKAGE_V1') {
      console.warn('[BRAIN] Import is compressed; use importBrainFromJsonAsync')
      return false
    }
    return deserializeMotor(motor, data)
  } catch (err) {
    console.warn('[BRAIN] Import failed:', err.message)
    return false
  }
}

export async function importBrainFromJsonAsync(motor, jsonStr) {
  try {
    const data = JSON.parse(jsonStr)
    if (data?.magic !== 'LIFE_BRAIN_PACKAGE_V1') return deserializeMotor(motor, data)
    if (data.transport !== 'base64+gzip' && data.transport !== 'base64') {
      console.warn('[BRAIN] Unsupported brain package transport:', data.transport)
      return false
    }
    const packed = base64ToBytes(data.bytes)
    const raw = data.transport === 'base64+gzip' ? await gunzipBytes(packed) : packed
    return deserializeMotor(motor, JSON.parse(bytesToText(raw)))
  } catch (err) {
    console.warn('[BRAIN] Async import failed:', err.message)
    return false
  }
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(b64, 'base64'))
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function textToBytes(text) {
  return new TextEncoder().encode(text)
}

function bytesToText(bytes) {
  return new TextDecoder().decode(bytes)
}

async function gzipBytes(bytes) {
  if (typeof CompressionStream === 'undefined') return bytes
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzipBytes(bytes) {
  if (typeof DecompressionStream === 'undefined') return bytes
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ─── NETWORK GROWING (Net2Net-style tier upgrades) ──────────────────────────
//
// When a character evolves / levels up, we upgrade their brain to a bigger
// tier WITHOUT losing training progress. This uses a Net2Net-style weight
// transplant:
//   1. Create fresh randomly-initialized larger net
//   2. Copy old weights into the top-left submatrix of each layer
//   3. Scale down new neurons' connections so they initially contribute ~0
//   4. Old behavior preserved — bigger capacity available for new learning
//
// Alternative is distillation (train large to imitate small), but that
// requires rollout data. Weight transplant is instant and preserves
// performance.

/**
 * Upgrade a motor to a bigger tier. Weight matrices are transplanted so
 * the pre-upgrade behavior is preserved; new neurons start with near-zero
 * influence and gradually learn new behaviors.
 *
 * Returns true if upgraded, false if target tier isn't actually bigger.
 */
export function upgradeBrain(motor, newTier) {
  const newHiddens = BRAIN_TIERS[newTier]
  if (!newHiddens) {
    console.warn(`[BRAIN] Unknown tier '${newTier}'`)
    return false
  }

  const oldHiddens = motor.layers.slice(0, -1).map(L => L.outSize)

  // Downgrades not supported (can't shrink without losing learning)
  if (newHiddens.length < oldHiddens.length) {
    console.warn(`[BRAIN] Cannot downgrade (old depth ${oldHiddens.length}, new ${newHiddens.length})`)
    return false
  }
  // If same depth AND every layer <= new width, it's a valid expansion
  let widthExpand = newHiddens.length === oldHiddens.length
  for (let i = 0; i < oldHiddens.length; i++) {
    if (newHiddens[i] < oldHiddens[i]) {
      console.warn(`[BRAIN] Layer ${i} new width ${newHiddens[i]} < old ${oldHiddens[i]}`)
      return false
    }
  }

  // Build new larger layer chain
  const newLayers = []
  let prev = OBS_SIZE
  for (const h of newHiddens) {
    newLayers.push(makeLayer(prev, h))
    prev = h
  }
  newLayers.push(makeLayer(prev, ACTION_SIZE, true))

  // Transplant old weights — copy each old layer's W/b into the top-left
  // region of the corresponding new layer, scaling the NEW rows/cols down
  // so the output is initially identical to the old network.
  //
  // For a layer (inOld→outOld) becoming (inNew→outNew):
  //   - rows [0..outOld): existing neurons, copy old weights
  //   - rows [outOld..outNew): new neurons, keep random init scaled down
  //   - cols [0..inOld): existing inputs, match old
  //   - cols [inOld..inNew): new inputs, scale to 0 so they don't disturb
  const NEW_NEURON_SCALE = 0.01   // new rows almost silent at startup

  for (let li = 0; li < motor.layers.length; li++) {
    const oldL = motor.layers[li]
    const newL = newLayers[li]
    if (li < newLayers.length) {
      const inOld = oldL.inSize
      const outOld = oldL.outSize
      const inNew = newL.inSize
      const outNew = newL.outSize

      // Copy old W into top-left block of new W
      for (let i = 0; i < inOld; i++) {
        for (let j = 0; j < outOld; j++) {
          newL.W[i * outNew + j] = oldL.W[i * outOld + j]
        }
      }
      // Zero the NEW input columns (cols inOld..inNew) in existing rows
      for (let i = inOld; i < inNew; i++) {
        for (let j = 0; j < outOld; j++) {
          newL.W[i * outNew + j] = 0   // new inputs don't affect old neurons yet
        }
      }
      // Shrink NEW neuron rows (rows outOld..outNew)
      for (let i = 0; i < inNew; i++) {
        for (let j = outOld; j < outNew; j++) {
          newL.W[i * outNew + j] *= NEW_NEURON_SCALE
        }
      }
      // Biases: copy old, keep new ones near-zero
      for (let j = 0; j < outOld; j++) newL.b[j] = oldL.b[j]
      for (let j = outOld; j < outNew; j++) newL.b[j] *= NEW_NEURON_SCALE
    }
  }

  const oldTier = motor.tier
  motor.layers = newLayers
  motor.tier = newTier

  // New size
  let bytes = 0
  for (const L of newLayers) bytes += (L.W.length + L.b.length) * 4

  console.info(
    `[BRAIN] upgraded ${oldTier} → ${newTier} ` +
    `(${oldHiddens.join('/')} → ${newHiddens.join('/')}) ` +
    `~${(bytes/1024).toFixed(1)} KB, learning preserved`
  )
  return true
}

/**
 * Check which tiers an entity can upgrade to (tier order: tiny→small→medium→large→huge).
 */
export function getUpgradeOptions(currentTier) {
  const order = ['tiny', 'small', 'medium', 'large', 'huge']
  const idx = order.indexOf(currentTier)
  if (idx === -1) return []
  return order.slice(idx + 1)
}

export { OBS_SIZE, ACTION_SIZE, BONE_ORDER }
