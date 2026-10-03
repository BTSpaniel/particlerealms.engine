// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BodyRhythms — Coupled phase oscillators that generate body rhythms.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   WHAT THIS IS
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every living body has SYNCHRONIZED internal oscillators:
 *   - HEART      ~1.0-1.5 Hz resting (60-90 bpm)
 *   - BREATH     ~0.2-0.3 Hz resting (12-18 breaths/min)
 *   - GAIT_L     ~1.0 Hz walking cadence (left leg)
 *   - GAIT_R     ~1.0 Hz antiphase to left (π offset)
 *   - ARM_L      counter-swings with RIGHT leg (inphase with GAIT_R)
 *   - ARM_R      counter-swings with LEFT leg (inphase with GAIT_L)
 *
 * These are the output of CENTRAL PATTERN GENERATORS (CPGs) — spinal
 * neural circuits that don't need brain input to produce rhythm. They
 * sync via Kuramoto-like coupling so all the oscillators lock into
 * phase-locked relationships automatically.
 *
 * Engine provides the math (engine/core/math/MathOscillator.js):
 *   stepKuramotoPhases  — Euler step for coupled oscillator network
 *   phaseCoherence      — measure of synchrony (0=chaos, 1=lockstep)
 *   stepKuramotoDriven  — with external forcing (metronome, music, etc)
 *
 * ══════════════════════════════════════════════════════════════════════
 *   USES IN THE ACTIVE BODY SYSTEM
 * ══════════════════════════════════════════════════════════════════════
 *
 * 1. NN OBSERVATION INPUT
 *    The NN sees sin/cos of key phases, so it knows WHERE in the
 *    gait cycle the body is. This lets it learn rhythmic actions —
 *    step forward on left foot during gait_L peak, etc.
 *
 * 2. POSE MODULATION (future)
 *    When intent = walk, leg targets can be modulated by gait phase
 *    to produce a stepping motion automatically.
 *
 * 3. VISIBLE RHYTHM (future)
 *    Chest rises with breath, head bobs with heart, body sways with
 *    gait — alive-looking NPCs even when standing still.
 *
 * 4. DRUG/DISEASE EFFECTS
 *    Arrhythmia = desynchronized heart.
 *    Panic = tachycardia (faster heart + breath).
 *    Paralysis = no gait coupling.
 *    Loss of coherence (order parameter drops) indicates systemic failure.
 *
 * ══════════════════════════════════════════════════════════════════════
 *   COUPLING MATRIX  (who synchronizes with whom, how strongly)
 * ══════════════════════════════════════════════════════════════════════
 *
 *           HEART  BREATH  GAIT_L  GAIT_R  ARM_L  ARM_R
 *   HEART     -    0.3     0       0       0      0
 *   BREATH    0.3  -       0.1     0.1     0      0
 *   GAIT_L    0    0.1     -      -1.0    0      1.0      (antiphase L↔R, counter with arms)
 *   GAIT_R    0    0.1     -1.0    -       1.0   0
 *   ARM_L     0    0       0       1.0    -     -1.0
 *   ARM_R     0    0       1.0     0      -1.0  -
 *
 * Positive weight = inphase pull (synchronize), negative = antiphase.
 * Kuramoto coupling term: sin(phase_j - phase_i) × weight.
 */

import {
  stepKuramotoPhases,
  phaseCoherence,
  kuramotoOrderParameter,
} from '../../../core/math/MathOscillator.js'

// Index each oscillator in the phase/frequency arrays
export const RHYTHM = {
  HEART:   0,
  BREATH:  1,
  GAIT_L:  2,
  GAIT_R:  3,
  ARM_L:   4,
  ARM_R:   5,
}
export const NUM_RHYTHMS = 6

// Resting natural frequencies (Hz). Gait frequency is 0 at rest (no walking);
// it's set nonzero when intent=walk.
const RESTING_FREQ = [
  1.15,   // heart (69 bpm — healthy adult resting)
  0.25,   // breath (15 breaths/min)
  0,      // gait_L (0 = no walking)
  0,      // gait_R
  0,      // arm_L
  0,      // arm_R
]

// Coupling matrix (rows = target i, cols = source j)
// Entry [i][j] = how strongly phase_j pulls phase_i.
// Negative weight = antiphase (pulls toward π offset).
const COUPLING_MATRIX = [
  //   HRT  BRT  GL   GR   AL   AR
  [    0,   0.3, 0,   0,   0,   0   ],   // HEART
  [    0.3, 0,   0.1, 0.1, 0,   0   ],   // BREATH
  [    0,   0.1, 0,  -1.0, 0,   1.0 ],   // GAIT_L (antiphase to R, inphase with arm R)
  [    0,   0.1,-1.0, 0,   1.0, 0   ],   // GAIT_R (antiphase to L, inphase with arm L)
  [    0,   0,   0,   1.0, 0,  -1.0 ],   // ARM_L (inphase with GAIT_R, antiphase to ARM_R)
  [    0,   0,   1.0, 0,  -1.0, 0   ],   // ARM_R
]

const TAU = Math.PI * 2

/**
 * Create a new rhythm state for a body. Initial phases are seeded from a
 * per-entity RNG so different bodies aren't in lockstep (a crowd of NPCs
 * should look like independent individuals, not a marching band).
 */
export function createRhythmState(rng = Math.random) {
  const phases = new Array(NUM_RHYTHMS)
  for (let i = 0; i < NUM_RHYTHMS; i++) {
    phases[i] = rng() * TAU       // random initial phase
  }
  // Nudge left/right pairs toward their proper relative offset so they
  // sync quickly instead of chaotically.
  phases[RHYTHM.GAIT_R] = (phases[RHYTHM.GAIT_L] + Math.PI) % TAU
  phases[RHYTHM.ARM_L]  = (phases[RHYTHM.GAIT_R]) % TAU     // inphase w/ opp leg
  phases[RHYTHM.ARM_R]  = (phases[RHYTHM.GAIT_L]) % TAU

  return {
    phases,
    freqs: [...RESTING_FREQ],
    coupling: 1.5,                  // K — overall coupling strength
    coherence: 0,                   // last measured order parameter
    heartBPM: 69,                   // derived, for UI/debug
    breathRate: 15,
    gaitCadence: 0,
  }
}

/**
 * Advance the rhythm state by dt seconds using the Kuramoto model.
 * Modulates natural frequencies based on body state:
 *   - walking intent      → gait and arms non-zero
 *   - high adrenaline     → faster heart and breath
 *   - high fatigue        → slightly elevated heart, faster breath
 */
export function stepRhythms(state, dt, opts = {}) {
  const {
    walking = false,
    walkSpeed = 1.0,        // 0..1 relative cadence
    adrenaline = 0,         // 0..1
    fatigue = 0,            // 0..1
  } = opts

  // Update natural frequencies based on state
  const adrenBoost = 1 + adrenaline * 0.6     // up to +60% heart rate
  const fatBoost   = 1 + fatigue * 0.3        // tired = breathing heavier
  state.freqs[RHYTHM.HEART]  = 1.15 * adrenBoost * fatBoost
  state.freqs[RHYTHM.BREATH] = 0.25 * adrenBoost * fatBoost

  if (walking) {
    const cadence = 1.0 * walkSpeed          // ~1Hz normal walking
    state.freqs[RHYTHM.GAIT_L] = cadence
    state.freqs[RHYTHM.GAIT_R] = cadence
    state.freqs[RHYTHM.ARM_L]  = cadence
    state.freqs[RHYTHM.ARM_R]  = cadence
  } else {
    state.freqs[RHYTHM.GAIT_L] = 0
    state.freqs[RHYTHM.GAIT_R] = 0
    state.freqs[RHYTHM.ARM_L]  = 0
    state.freqs[RHYTHM.ARM_R]  = 0
  }

  // Step the Kuramoto network (engine math does the heavy lifting)
  state.phases = stepKuramotoPhases(
    state.phases,
    state.freqs,
    dt,
    state.coupling,
    COUPLING_MATRIX,
    state.phases,   // in-place output
  )

  // Update derived metrics
  state.coherence = kuramotoOrderParameter(state.phases)
  state.heartBPM = state.freqs[RHYTHM.HEART] * 60
  state.breathRate = state.freqs[RHYTHM.BREATH] * 60
  state.gaitCadence = state.freqs[RHYTHM.GAIT_L]
}

/**
 * Return sin/cos of a rhythm phase — what the NN sees. sin/cos pair is the
 * standard representation of a circular variable for neural networks (avoids
 * wraparound discontinuity at 2π).
 */
export function rhythmSample(state, rhythmIdx) {
  const phase = state.phases[rhythmIdx] ?? 0
  return [Math.sin(phase), Math.cos(phase)]
}

/**
 * Desynchronize rhythms (simulate arrhythmia / panic breakdown).
 * Adds random noise to phases and reduces coupling strength.
 */
export function shatterRhythm(state, severity = 0.5, rng = Math.random) {
  for (let i = 0; i < state.phases.length; i++) {
    state.phases[i] += (rng() - 0.5) * severity * TAU
  }
  state.coupling *= (1 - severity * 0.7)
}

/**
 * Re-establish healthy coupling after disruption (recovery).
 */
export function restoreRhythm(state) {
  state.coupling = 1.5
}

export { phaseCoherence, kuramotoOrderParameter }
