// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { EPSILON, TAU } from './MathConstants.js';
import { clamp, lerp, mod, saturate, wrapAnglePositive } from './MathScalar.js';

export const OSCILLATOR_SHAPES = Object.freeze([
  'sine',
  'triangle',
  'square',
  'saw',
  'reverseSaw',
  'pulse',
]);

export const DEFAULT_OSCILLATOR = Object.freeze({
  shape: 'sine',
  frequency: 1,
  amplitude: 1,
  phase: 0,
  offset: 0,
  dutyCycle: 0.5,
});

const _finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const _kuramotoSnapshots = new WeakMap();

function _snapshotKuramotoPhases(phases, count) {
  let snapshot = _kuramotoSnapshots.get(phases);
  const typed = ArrayBuffer.isView(phases);
  if (!snapshot || snapshot.length < count || (typed && snapshot.constructor !== phases.constructor)) {
    snapshot = typed ? new phases.constructor(count) : new Array(count);
    _kuramotoSnapshots.set(phases, snapshot);
  } else if (!typed) {
    snapshot.length = count;
  }
  for (let index = 0; index < count; index++) snapshot[index] = phases[index];
  return snapshot;
}

export function normalizePhase(phase) {
  return wrapAnglePositive(_finiteOr(phase, 0));
}

export function cyclesToRadians(cycles) {
  return _finiteOr(cycles, 0) * TAU;
}

export function radiansToCycles(radians) {
  return _finiteOr(radians, 0) / TAU;
}

export function phaseFromTime(frequency, time, phase = 0) {
  return normalizePhase(_finiteOr(phase, 0) + TAU * _finiteOr(frequency, 0) * _finiteOr(time, 0));
}

export function advancePhase(phase, frequency, dt) {
  return phaseFromTime(frequency, dt, phase);
}

export function createOscillator(config = {}) {
  return {
    shape: OSCILLATOR_SHAPES.includes(config.shape) ? config.shape : DEFAULT_OSCILLATOR.shape,
    frequency: _finiteOr(config.frequency, DEFAULT_OSCILLATOR.frequency),
    amplitude: _finiteOr(config.amplitude, DEFAULT_OSCILLATOR.amplitude),
    phase: normalizePhase(config.phase ?? DEFAULT_OSCILLATOR.phase),
    offset: _finiteOr(config.offset, DEFAULT_OSCILLATOR.offset),
    dutyCycle: clamp(_finiteOr(config.dutyCycle, DEFAULT_OSCILLATOR.dutyCycle), EPSILON, 1 - EPSILON),
  };
}

export function oscillatorCycle(phase) {
  return mod(_finiteOr(phase, 0), TAU) / TAU;
}

export function sampleWave(shape, phase, dutyCycle = 0.5) {
  const cycle = oscillatorCycle(phase);
  const duty = clamp(_finiteOr(dutyCycle, 0.5), EPSILON, 1 - EPSILON);
  switch (shape) {
    case 'triangle':
      return 1 - 4 * Math.abs(cycle - 0.5);
    case 'square':
      return cycle < 0.5 ? 1 : -1;
    case 'saw':
      return cycle * 2 - 1;
    case 'reverseSaw':
      return 1 - cycle * 2;
    case 'pulse':
      return cycle < duty ? 1 : -1;
    case 'sine':
    default:
      return Math.sin(_finiteOr(phase, 0));
  }
}

export function sampleOscillatorAtPhase(oscillator, phase) {
  const osc = createOscillator(oscillator);
  return osc.offset + osc.amplitude * sampleWave(osc.shape, phase, osc.dutyCycle);
}

export function sampleOscillator(oscillator, time) {
  const osc = createOscillator(oscillator);
  return sampleOscillatorAtPhase(osc, phaseFromTime(osc.frequency, time, osc.phase));
}

export function sampleOscillatorArray(oscillators, time, out = []) {
  out.length = oscillators.length;
  for (let i = 0; i < oscillators.length; i++) {
    out[i] = sampleOscillator(oscillators[i], time);
  }
  return out;
}

export function beatFrequency(a, b) {
  return Math.abs(_finiteOr(a, 0) - _finiteOr(b, 0));
}

export function resonanceWeight(a, b, bandwidth = 1) {
  const bw = Math.max(Math.abs(_finiteOr(bandwidth, 1)), EPSILON);
  return Math.exp(-beatFrequency(a, b) / bw);
}

export function applyAmplitudeModulation(sampleValue, modulatorValue, amount = 1, bipolar = false) {
  const mixAmount = saturate(_finiteOr(amount, 1));
  const modValue = _finiteOr(modulatorValue, 0);
  const gain = bipolar
    ? lerp(1, modValue, mixAmount)
    : lerp(1, saturate(modValue * 0.5 + 0.5), mixAmount);
  return _finiteOr(sampleValue, 0) * gain;
}

export function applyPhaseModulation(phase, modulatorValue, amount = 1) {
  return normalizePhase(_finiteOr(phase, 0) + _finiteOr(modulatorValue, 0) * _finiteOr(amount, 1));
}

export function waveInterference(a, b) {
  return _finiteOr(a, 0) + _finiteOr(b, 0);
}

export function ringModulate(a, b) {
  return _finiteOr(a, 0) * _finiteOr(b, 0);
}

export function sampleAmplitudeModulated(carrier, modulator, time, amount = 1, bipolar = false) {
  const carrierValue = sampleOscillator(carrier, time);
  const modValue = typeof modulator === 'number' ? modulator : sampleOscillator(modulator, time);
  return applyAmplitudeModulation(carrierValue, modValue, amount, bipolar);
}

export function samplePhaseModulated(carrier, modulator, time, amount = 1) {
  const osc = createOscillator(carrier);
  const basePhase = phaseFromTime(osc.frequency, time, osc.phase);
  const modValue = typeof modulator === 'number' ? modulator : sampleOscillator(modulator, time);
  return sampleOscillatorAtPhase(osc, applyPhaseModulation(basePhase, modValue, amount));
}

export function sampleRingModulated(a, b, time) {
  return ringModulate(sampleOscillator(a, time), sampleOscillator(b, time));
}

export function phaseCoherence(phases) {
  const count = phases.length;
  if (!count) return 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < count; i++) {
    const phase = _finiteOr(phases[i], 0);
    sumX += Math.cos(phase);
    sumY += Math.sin(phase);
  }
  return Math.hypot(sumX, sumY) / count;
}

export function stepKuramotoPhases(phases, naturalFrequencies, dt, coupling = 0.5, weights = null, out = null) {
  const count = Math.min(phases.length, naturalFrequencies.length);
  const next = out ?? new Array(count);
  // The pairwise solver must read one immutable phase snapshot. This also
  // makes the documented `out` reuse safe when the caller passes `phases`.
  const source = next === phases ? _snapshotKuramotoPhases(phases, count) : phases;
  const dtSafe = _finiteOr(dt, 0);
  const couplingSafe = _finiteOr(coupling, 0);
  for (let i = 0; i < count; i++) {
    const phaseI = _finiteOr(source[i], 0);
    let sum = 0;
    let norm = weights ? 0 : count;
    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      const weight = weights ? _finiteOr(weights[i]?.[j], 0) : 1;
      if (weight === 0) continue;
      sum += Math.sin(_finiteOr(source[j], 0) - phaseI) * weight;
      if (weights) norm += Math.abs(weight);
    }
    const natural = _finiteOr(naturalFrequencies[i], 0);
    const coupled = norm > EPSILON ? couplingSafe * (sum / norm) : 0;
    next[i] = normalizePhase(phaseI + dtSafe * (TAU * natural + coupled));
  }
  return next;
}

export function stepCoupledOscillators(oscillators, dt, coupling = 0.5, weights = null) {
  const count = oscillators.length;
  const phases = new Array(count);
  const freqs = new Array(count);
  for (let i = 0; i < count; i++) {
    const osc = createOscillator(oscillators[i]);
    phases[i] = osc.phase;
    freqs[i] = osc.frequency;
  }
  const nextPhases = stepKuramotoPhases(phases, freqs, dt, coupling, weights);
  const next = new Array(count);
  for (let i = 0; i < count; i++) {
    next[i] = { ...createOscillator(oscillators[i]), phase: nextPhases[i] };
  }
  return next;
}

/**
 * Kuramoto order parameter (complex form).
 * Computes collective synchronization r·e^(iψ) of N coupled phases.
 * r ≈ 0 = chaos/dissonance; r ≈ 1 = perfect lockstep.
 * Real-world: power-grid frequency lock, neural firing synchrony, firefly flashing, cardiac pacemakers, crowd footsteps (Millennium Bridge wobble).
 */
export function kuramotoOrderParameterComplex(phases) {
  const count = phases.length;
  if (!count) return { re: 0, im: 0, magnitude: 0, phase: 0 };
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < count; i++) {
    const phase = _finiteOr(phases[i], 0);
    sumX += Math.cos(phase);
    sumY += Math.sin(phase);
  }
  const re = sumX / count;
  const im = sumY / count;
  return { re, im, magnitude: Math.hypot(re, im), phase: Math.atan2(im, re) };
}

/**
 * Scalar synchronization metric r = |<e^(iθ)>|.
 * Game uses: swarm AI cohesion, rhythm-combat sync signals, magic ritual progress bars, ambient life pulse coherence.
 */
export function kuramotoOrderParameter(phases) {
  return kuramotoOrderParameterComplex(phases).magnitude;
}

/**
 * Euler step for driven Kuramoto model.
 * dθᵢ/dt = 2π·ωᵢ + (K/N)Σⱼsin(θⱼ−θᵢ) + λ·sin(2π·f_drive·t − θᵢ)
 * The λ term is an external forcing function (e.g. Schumann resonance 7.83 Hz,
 * a metronome, a planetary frequency, a bassline tempo).
 * Applications: procedural music harmony, NPC swarm coordination, breathing/
 * idle animation sync, climate zone oscillations, magic aura pulse coupling.
 * @param {number[]} phases            current phase array (radians)
 * @param {number[]} naturalFrequencies  natural frequencies (Hz)
 * @param {number}   dt                time step (seconds)
 * @param {number}   t                 absolute time (seconds)
 * @param {number}   coupling           K — inter-oscillator coupling strength
 * @param {number}   driveFrequency     f_drive — external forcing frequency (Hz)
 * @param {number}   driveStrength      λ — external forcing amplitude
 * @param {number[][]|null} weights    optional pairwise coupling weights
 * @param {number[]|null} out          optional output array (avoids alloc)
 */
export function stepKuramotoDriven(phases, naturalFrequencies, dt, t, coupling = 0.5, driveFrequency = 1, driveStrength = 0, weights = null, out = null) {
  const count = Math.min(phases.length, naturalFrequencies.length);
  const next = out ?? new Array(count);
  const source = next === phases ? _snapshotKuramotoPhases(phases, count) : phases;
  const dtSafe = _finiteOr(dt, 0);
  const couplingSafe = _finiteOr(coupling, 0);
  const driveFreqSafe = _finiteOr(driveFrequency, 0);
  const driveStrengthSafe = _finiteOr(driveStrength, 0);
  const drivePhase = TAU * driveFreqSafe * _finiteOr(t, 0);
  for (let i = 0; i < count; i++) {
    const phaseI = _finiteOr(source[i], 0);
    let sum = 0;
    let norm = weights ? 0 : count;
    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      const weight = weights ? _finiteOr(weights[i]?.[j], 0) : 1;
      if (weight === 0) continue;
      sum += Math.sin(_finiteOr(source[j], 0) - phaseI) * weight;
      if (weights) norm += Math.abs(weight);
    }
    const natural = _finiteOr(naturalFrequencies[i], 0);
    const coupled = norm > EPSILON ? couplingSafe * (sum / norm) : 0;
    const driven = driveStrengthSafe * Math.sin(drivePhase - phaseI);
    next[i] = normalizePhase(phaseI + dtSafe * (TAU * natural + coupled + driven));
  }
  return next;
}

/**
 * Exact O(N) Euler step for the globally coupled, driven Kuramoto model.
 *
 * For uniform all-to-all coupling, the pair sum is exactly reducible through
 * Z = <exp(iθ)> = re + i·im:
 *   (K/N) Σⱼ sin(θⱼ-θᵢ) = K (im·cos θᵢ - re·sin θᵢ)
 *
 * This is mathematically equivalent to `stepKuramotoDriven(..., weights=null)`
 * while avoiding its O(N²) pair loop. `order` may be supplied when the caller
 * already computed the current order parameter for telemetry.
 */
export function stepKuramotoMeanFieldDriven(
  phases,
  naturalFrequencies,
  dt,
  t,
  coupling = 0.5,
  driveFrequency = 1,
  driveStrength = 0,
  out = null,
  order = null,
) {
  const count = Math.min(phases.length, naturalFrequencies.length);
  const next = out ?? new Array(count);
  const dtSafe = _finiteOr(dt, 0);
  const couplingSafe = _finiteOr(coupling, 0);
  const driveStrengthSafe = _finiteOr(driveStrength, 0);
  const drivePhase = TAU * _finiteOr(driveFrequency, 0) * _finiteOr(t, 0);
  const field = order ?? kuramotoOrderParameterComplex(phases.subarray?.(0, count) ?? phases.slice(0, count));
  const re = _finiteOr(field.re, 0);
  const im = _finiteOr(field.im, 0);

  for (let i = 0; i < count; i++) {
    const phase = _finiteOr(phases[i], 0);
    const natural = TAU * _finiteOr(naturalFrequencies[i], 0);
    const coupled = couplingSafe * (im * Math.cos(phase) - re * Math.sin(phase));
    const driven = driveStrengthSafe === 0 ? 0 : driveStrengthSafe * Math.sin(drivePhase - phase);
    next[i] = normalizePhase(phase + dtSafe * (natural + coupled + driven));
  }
  return next;
}

export function createOscillatorBank(count, factory = null) {
  const bank = new Array(Math.max(0, count | 0));
  for (let i = 0; i < bank.length; i++) {
    bank[i] = createOscillator(factory ? factory(i) : null);
  }
  return bank;
}
