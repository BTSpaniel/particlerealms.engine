// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * NeuroModifiers — preset effect profiles that corrupt the NeuralMotor's
 * forward pass to produce realistic neurological symptoms.
 *
 * Each profile mutates the `motor.modifiers` bag on a NeuralMotor instance.
 * Multiple effects stack by summing noise/dropout and multiplying scale.
 *
 * Grounded in real pharmacology/neurology:
 *   - alcohol:   inhibits GABA → activation noise + slow reaction (delay)
 *   - paralytic: blocks ACh at NMJ → output scale → 0 (limp)
 *   - stimulant: excess catecholamines → amplified output, jitter
 *   - tranq:    dopamine block → output scale 0.4, delay 3
 *   - poison:   neural death → growing dropout + decreasing scale
 *   - seizure:  hypersynchronous discharge → huge activation spikes
 *   - tremor:   basal-ganglia dysfn (Parkinson) → coherent 4-6 Hz oscillation
 */

export const NEURO_PROFILES = {
  none: {
    noise: 0, dropout: 0, scale: 1,
    tremor: 0, tremorHz: 0,
    delay: 0, seizureAmp: 0,
  },

  // DRUNK — coordination loss, delayed reactions, random sway
  alcohol_mild: {
    noise: 0.15, dropout: 0, scale: 0.9,
    tremor: 0, tremorHz: 0,
    delay: 1, seizureAmp: 0,
  },
  alcohol_heavy: {
    noise: 0.40, dropout: 0.05, scale: 0.7,
    tremor: 0, tremorHz: 0,
    delay: 3, seizureAmp: 0,
  },

  // PARALYTIC — outputs fully suppressed (curare, botulinum)
  paralytic: {
    noise: 0, dropout: 0, scale: 0,
    tremor: 0, tremorHz: 0,
    delay: 0, seizureAmp: 0,
  },

  // STIMULANT — amplified, jittery movement (amphetamine)
  stimulant: {
    noise: 0.20, dropout: 0, scale: 1.4,
    tremor: 0.15, tremorHz: 8,
    delay: 0, seizureAmp: 0,
  },

  // TRANQUILIZER — sluggish, weak, delayed
  tranquilizer: {
    noise: 0.05, dropout: 0, scale: 0.4,
    tremor: 0, tremorHz: 0,
    delay: 4, seizureAmp: 0,
  },

  // PARKINSONIAN TREMOR — coherent 4-6 Hz oscillation in limbs at rest
  tremor_parkinsonian: {
    noise: 0.05, dropout: 0, scale: 0.95,
    tremor: 0.25, tremorHz: 5,
    delay: 0, seizureAmp: 0,
  },

  // POISON — progressive neural death (use setPoisonProgress to ramp)
  poison_early: {
    noise: 0.10, dropout: 0.05, scale: 0.85,
    tremor: 0, tremorHz: 0,
    delay: 1, seizureAmp: 0,
  },
  poison_advanced: {
    noise: 0.35, dropout: 0.25, scale: 0.45,
    tremor: 0.1, tremorHz: 3,
    delay: 4, seizureAmp: 0.3,
  },

  // SEIZURE — hypersynchronous discharge, wild thrashing
  seizure_tonic_clonic: {
    noise: 0.6, dropout: 0.35, scale: 1.3,
    tremor: 0.4, tremorHz: 12,
    delay: 0, seizureAmp: 1.5,
  },

  // CONCUSSION — reduced scale + noise, temporary dropout
  concussion: {
    noise: 0.20, dropout: 0.10, scale: 0.75,
    tremor: 0, tremorHz: 0,
    delay: 2, seizureAmp: 0,
  },
}

const TREMOR_GAIN_BY_BONE = Object.freeze({
  pelvis: 0,
  spine: 0,
  spine1: 0,
  chest: 0,
  neck: 0.05,
  head: 0.08,
  leftShoulder: 0.12,
  rightShoulder: 0.12,
  leftUpperArm: 0.45,
  rightUpperArm: 0.45,
  leftForearm: 0.75,
  rightForearm: 0.75,
  leftHand: 1,
  rightHand: 1,
  leftThigh: 0.12,
  rightThigh: 0.12,
  leftShin: 0.35,
  rightShin: 0.35,
  leftFoot: 0.45,
  rightFoot: 0.45,
})

const NOISE_GAIN_BY_BONE = Object.freeze({
  pelvis: 0.05,
  spine: 0.05,
  spine1: 0.05,
  chest: 0.08,
  neck: 0.10,
  head: 0.12,
  leftShoulder: 0.12,
  rightShoulder: 0.12,
  leftUpperArm: 0.35,
  rightUpperArm: 0.35,
  leftForearm: 0.55,
  rightForearm: 0.55,
  leftHand: 0.75,
  rightHand: 0.75,
  leftThigh: 0.18,
  rightThigh: 0.18,
  leftShin: 0.35,
  rightShin: 0.35,
  leftFoot: 0.45,
  rightFoot: 0.45,
})

const SEIZURE_GAIN_BY_BONE = Object.freeze({
  pelvis: 0.55,
  spine: 0.60,
  spine1: 0.65,
  chest: 0.70,
  neck: 0.60,
  head: 0.60,
})

/**
 * Apply a preset profile to a NeuralMotor (replaces current modifiers).
 */
export function applyNeuroProfile(motor, profileName) {
  const profile = NEURO_PROFILES[profileName]
  if (!profile) {
    console.warn(`[NEURO] Unknown profile: ${profileName}`)
    return
  }
  Object.assign(motor.modifiers, profile)
  console.info(`[NEURO] applied '${profileName}':`, { ...profile })
}

/**
 * Blend toward a profile over time — e.g. poison progression.
 * `t` ∈ [0,1] is how far along the progression is.
 */
export function rampNeuroProfile(motor, profileName, t) {
  const profile = NEURO_PROFILES[profileName]
  if (!profile) return
  const m = motor.modifiers
  m.noise      = profile.noise * t
  m.dropout    = profile.dropout * t
  m.scale      = 1 + (profile.scale - 1) * t
  m.tremor     = profile.tremor * t
  m.tremorHz   = profile.tremorHz
  m.delay      = Math.round(profile.delay * t)
  m.seizureAmp = profile.seizureAmp * t
}

/**
 * Reset all neuromodifiers to healthy.
 */
export function clearNeuroModifiers(motor) {
  applyNeuroProfile(motor, 'none')
}

/**
 * Apply neuromodifier effects DIRECTLY to the ragdoll bones, bypassing
 * the NN. Needed because the NN only runs during `getup` state; seizures
 * etc. should be visible in ANY state (idle, fallen, walking).
 *
 * This is the physical manifestation of motor-cortex corruption:
 *   tremor      → coherent sinusoidal force (Parkinsonian shake)
 *   seizureAmp  → random large impulses (tonic-clonic thrashing)
 *   noise       → Gaussian jitter on force (alcohol wobble)
 *   scale       → global force multiplier (paralytic = 0 → body goes limp)
 *
 * Scales with bone mass so effects feel right (heavy pelvis thrashes
 * harder than hand). Called each frame in the main update loop.
 */
export function applyNeuroJerks(ragdoll, motor, time, dt) {
  if (!motor || !ragdoll?.solver) return
  const mod = motor.modifiers
  const rng = motor.rng || Math.random
  const solver = ragdoll.solver

  // Quick-out if no modifiers active
  if (
    mod.tremor <= 0 &&
    mod.seizureAmp <= 0 &&
    mod.noise <= 0 &&
    (mod.scale ?? 1) === 1
  ) return

  const tremorPhase = time * mod.tremorHz * 2 * Math.PI
  const tremorForce = Math.sin(tremorPhase) * mod.tremor * 200  // N

  for (const bone of ragdoll.bones) {
    const p = bone?.particle
    if (!p) continue
    const mass = bone.mass || 1

    // TREMOR — coherent oscillation, scaled by bone mass
    let fx = 0, fy = 0, fz = 0
    if (mod.tremor > 0) {
      // Tremor is horizontal (shake) — limb-biased, coherent phase
      const gain = TREMOR_GAIN_BY_BONE[bone.name] ?? 0.4
      fx += tremorForce * mass * 0.3 * gain
      fz += tremorForce * mass * 0.3 * gain
    }

    // SEIZURE — stochastic jerks on random bones, each frame
    if (mod.seizureAmp > 0 && rng() < 0.15) {
      const amp = mod.seizureAmp * 400 * mass * (SEIZURE_GAIN_BY_BONE[bone.name] ?? 1)   // big impulses
      fx += (rng() * 2 - 1) * amp
      fy += (rng() * 2 - 1) * amp
      fz += (rng() * 2 - 1) * amp
    }

    // NOISE — small random jitter (drunk / concussion)
    if (mod.noise > 0) {
      const sigma = mod.noise * 80 * mass * (NOISE_GAIN_BY_BONE[bone.name] ?? 0.4)
      fx += (rng() * 2 - 1) * sigma
      fy += (rng() * 2 - 1) * sigma
      fz += (rng() * 2 - 1) * sigma
    }

    if (fx !== 0 || fy !== 0 || fz !== 0) {
      solver.applyForce(p, fx, fy, fz, dt)
    }
  }
}
