// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// AudioAutomationMath.js - pure AudioParam automation, envelope, and biquad helper math.

import { EPSILON, TAU } from './MathConstants.js';
import { clamp, finiteNumber, lerp } from './MathScalar.js';

export const AUDIO_BIQUAD_TYPES = Object.freeze([
  'lowpass',
  'highpass',
  'bandpass',
  'notch',
  'allpass',
  'peaking',
  'lowshelf',
  'highshelf',
]);

export function audioAutomationLinearRampValue(startValue, endValue, startTime, endTime, time) {
  const start = finiteAudioNumber(startValue, 'startValue');
  const end = finiteAudioNumber(endValue, 'endValue');
  const t0 = finiteAudioNumber(startTime, 'startTime');
  const t1 = finiteAudioNumber(endTime, 'endTime');
  const t = finiteAudioNumber(time, 'time');
  if (t1 <= t0) throw new RangeError('endTime must be greater than startTime');
  if (t <= t0) return start;
  if (t >= t1) return end;
  return lerp(start, end, (t - t0) / (t1 - t0));
}

export function audioAutomationExponentialRampValue(startValue, endValue, startTime, endTime, time) {
  const start = finiteAudioNumber(startValue, 'startValue');
  const end = finiteAudioNumber(endValue, 'endValue');
  const t0 = finiteAudioNumber(startTime, 'startTime');
  const t1 = finiteAudioNumber(endTime, 'endTime');
  const t = finiteAudioNumber(time, 'time');
  if (t1 <= t0) throw new RangeError('endTime must be greater than startTime');
  if (end === 0) throw new RangeError('endValue must be nonzero for exponential ramps');
  if (t <= t0) return start;
  if (t >= t1) return end;
  if (start === 0 || Math.sign(start) !== Math.sign(end)) return start;
  return start * Math.pow(end / start, (t - t0) / (t1 - t0));
}

export function audioAutomationSetTargetValue(initialValue, targetValue, startTime, timeConstant, time) {
  const initial = finiteAudioNumber(initialValue, 'initialValue');
  const target = finiteAudioNumber(targetValue, 'targetValue');
  const start = finiteAudioNumber(startTime, 'startTime');
  const tau = nonnegativeAudioNumber(timeConstant, 'timeConstant');
  const t = finiteAudioNumber(time, 'time');
  if (t <= start) return initial;
  if (tau <= EPSILON) return target;
  return target + (initial - target) * Math.exp(-(t - start) / tau);
}

export function audioAutomationValueCurveAtTime(curve, startTime, duration, time, options = {}) {
  const values = numericCurve(curve);
  const start = finiteAudioNumber(startTime, 'startTime');
  const span = positiveAudioNumber(duration, 'duration');
  const t = finiteAudioNumber(time, 'time');
  if (values.length === 1 || t <= start) return values[0];
  if (t >= start + span) return values[values.length - 1];

  const scaled = ((t - start) / span) * (values.length - 1);
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  if (options.interpolation === 'nearest') return values[Math.round(scaled)];
  return lerp(values[index], values[index + 1], fraction);
}

export function audioAdsrEnvelopeValue(time, options = {}) {
  const startTime = finiteAudioNumber(options.startTime ?? 0, 'startTime');
  const initialLevel = finiteAudioNumber(options.initialLevel ?? 0, 'initialLevel');
  const peakLevel = finiteAudioNumber(options.peakLevel ?? 1, 'peakLevel');
  const sustainLevel = finiteAudioNumber(options.sustainLevel ?? 0.7, 'sustainLevel');
  const attackTime = nonnegativeAudioNumber(options.attackTime ?? 0.01, 'attackTime');
  const decayTime = nonnegativeAudioNumber(options.decayTime ?? 0.1, 'decayTime');
  const releaseTime = nonnegativeAudioNumber(options.releaseTime ?? 0.2, 'releaseTime');
  const gateOffTime = options.gateOffTime === undefined ? Infinity : finiteOrInfinity(options.gateOffTime, 'gateOffTime');
  const t = finiteAudioNumber(time, 'time');

  if (t < startTime) return initialLevel;
  if (Number.isFinite(gateOffTime) && t >= gateOffTime) {
    const releaseStartLevel = options.releaseStartLevel === undefined
      ? audioAdsrEnvelopeValue(gateOffTime, { ...options, gateOffTime: Infinity })
      : finiteAudioNumber(options.releaseStartLevel, 'releaseStartLevel');
    if (releaseTime <= EPSILON) return initialLevel;
    const releaseT = clamp((t - gateOffTime) / releaseTime, 0, 1);
    return lerp(releaseStartLevel, initialLevel, releaseT);
  }

  const attackEnd = startTime + attackTime;
  if (attackTime > EPSILON && t < attackEnd) {
    return lerp(initialLevel, peakLevel, (t - startTime) / attackTime);
  }

  const decayStart = attackTime > EPSILON ? attackEnd : startTime;
  const decayEnd = decayStart + decayTime;
  if (decayTime > EPSILON && t < decayEnd) {
    return lerp(peakLevel, sustainLevel, (t - decayStart) / decayTime);
  }

  return sustainLevel;
}

export function audioAdsrEnvelopeReport(options = {}) {
  const startTime = finiteAudioNumber(options.startTime ?? 0, 'startTime');
  const attackTime = nonnegativeAudioNumber(options.attackTime ?? 0.01, 'attackTime');
  const decayTime = nonnegativeAudioNumber(options.decayTime ?? 0.1, 'decayTime');
  const releaseTime = nonnegativeAudioNumber(options.releaseTime ?? 0.2, 'releaseTime');
  const gateOffTime = options.gateOffTime === undefined ? startTime + attackTime + decayTime : finiteAudioNumber(options.gateOffTime, 'gateOffTime');
  const duration = nonnegativeAudioNumber(options.duration ?? Math.max(0, gateOffTime + releaseTime - startTime), 'duration');
  const sampleRate = positiveAudioNumber(options.sampleRate ?? 48000, 'sampleRate');
  const includeSamples = options.includeSamples === true;
  const sampleCount = includeSamples ? Math.floor(duration * sampleRate) + 1 : 0;
  const values = [];

  for (let i = 0; i < sampleCount; i++) {
    const time = startTime + i / sampleRate;
    values.push(audioAdsrEnvelopeValue(time, { ...options, startTime, attackTime, decayTime, releaseTime, gateOffTime }));
  }

  return {
    startTime,
    attackTime,
    attackEndTime: startTime + attackTime,
    decayTime,
    decayEndTime: startTime + attackTime + decayTime,
    sustainLevel: finiteAudioNumber(options.sustainLevel ?? 0.7, 'sustainLevel'),
    gateOffTime,
    releaseTime,
    releaseEndTime: gateOffTime + releaseTime,
    duration,
    sampleRate,
    sampleCount,
    values: Object.freeze(values),
  };
}

export function audioBiquadComputedFrequency(frequency = 350, detune = 0, sampleRate = 48000) {
  const rate = positiveAudioNumber(sampleRate, 'sampleRate');
  const base = nonnegativeAudioNumber(frequency, 'frequency');
  const cents = finiteAudioNumber(detune, 'detune');
  return clamp(base * Math.pow(2, cents / 1200), 0, rate * 0.5);
}

export function audioBiquadCoefficients(type = 'lowpass', options = {}) {
  const filterType = normalizedBiquadType(type);
  const sampleRate = positiveAudioNumber(options.sampleRate ?? 48000, 'sampleRate');
  const frequency = audioBiquadComputedFrequency(options.frequency ?? 350, options.detune ?? 0, sampleRate);
  const gainDb = finiteAudioNumber(options.gain ?? 0, 'gain');
  const q = positiveAudioNumber(options.Q ?? options.q ?? 1, 'Q');
  const omega = TAU * frequency / sampleRate;
  const sinOmega = Math.sin(omega);
  const cosOmega = Math.cos(omega);
  const aGain = Math.pow(10, gainDb / 40);
  const alphaQ = sinOmega / (2 * q);
  const alphaQDb = sinOmega / (2 * Math.pow(10, q / 20));
  const alphaShelf = (sinOmega / 2) * Math.sqrt(2);
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;

  if (filterType === 'lowpass') {
    b0 = (1 - cosOmega) * 0.5;
    b1 = 1 - cosOmega;
    b2 = (1 - cosOmega) * 0.5;
    a0 = 1 + alphaQDb;
    a1 = -2 * cosOmega;
    a2 = 1 - alphaQDb;
  } else if (filterType === 'highpass') {
    b0 = (1 + cosOmega) * 0.5;
    b1 = -(1 + cosOmega);
    b2 = (1 + cosOmega) * 0.5;
    a0 = 1 + alphaQDb;
    a1 = -2 * cosOmega;
    a2 = 1 - alphaQDb;
  } else if (filterType === 'bandpass') {
    b0 = alphaQ;
    b1 = 0;
    b2 = -alphaQ;
    a0 = 1 + alphaQ;
    a1 = -2 * cosOmega;
    a2 = 1 - alphaQ;
  } else if (filterType === 'notch') {
    b0 = 1;
    b1 = -2 * cosOmega;
    b2 = 1;
    a0 = 1 + alphaQ;
    a1 = -2 * cosOmega;
    a2 = 1 - alphaQ;
  } else if (filterType === 'allpass') {
    b0 = 1 - alphaQ;
    b1 = -2 * cosOmega;
    b2 = 1 + alphaQ;
    a0 = 1 + alphaQ;
    a1 = -2 * cosOmega;
    a2 = 1 - alphaQ;
  } else if (filterType === 'peaking') {
    b0 = 1 + alphaQ * aGain;
    b1 = -2 * cosOmega;
    b2 = 1 - alphaQ * aGain;
    a0 = 1 + alphaQ / aGain;
    a1 = -2 * cosOmega;
    a2 = 1 - alphaQ / aGain;
  } else if (filterType === 'lowshelf') {
    const rootA = Math.sqrt(aGain);
    b0 = aGain * ((aGain + 1) - (aGain - 1) * cosOmega + 2 * rootA * alphaShelf);
    b1 = 2 * aGain * ((aGain - 1) - (aGain + 1) * cosOmega);
    b2 = aGain * ((aGain + 1) - (aGain - 1) * cosOmega - 2 * rootA * alphaShelf);
    a0 = (aGain + 1) + (aGain - 1) * cosOmega + 2 * rootA * alphaShelf;
    a1 = -2 * ((aGain - 1) + (aGain + 1) * cosOmega);
    a2 = (aGain + 1) + (aGain - 1) * cosOmega - 2 * rootA * alphaShelf;
  } else if (filterType === 'highshelf') {
    const rootA = Math.sqrt(aGain);
    b0 = aGain * ((aGain + 1) + (aGain - 1) * cosOmega + 2 * rootA * alphaShelf);
    b1 = -2 * aGain * ((aGain - 1) + (aGain + 1) * cosOmega);
    b2 = aGain * ((aGain + 1) + (aGain - 1) * cosOmega - 2 * rootA * alphaShelf);
    a0 = (aGain + 1) - (aGain - 1) * cosOmega + 2 * rootA * alphaShelf;
    a1 = 2 * ((aGain - 1) - (aGain + 1) * cosOmega);
    a2 = (aGain + 1) - (aGain - 1) * cosOmega - 2 * rootA * alphaShelf;
  }

  return normalizeBiquadCoefficients({
    type: filterType,
    sampleRate,
    frequency: nonnegativeAudioNumber(options.frequency ?? 350, 'frequency'),
    detune: finiteAudioNumber(options.detune ?? 0, 'detune'),
    computedFrequency: frequency,
    Q: q,
    gainDb,
    aGain,
    raw: Object.freeze({ b0, b1, b2, a0, a1, a2 }),
  });
}

export function audioBiquadFrequencyResponse(coefficients, frequencyHz, sampleRate = coefficients?.sampleRate ?? 48000) {
  const normalized = normalizedCoefficientObject(coefficients);
  const rate = positiveAudioNumber(sampleRate, 'sampleRate');
  const frequencies = Array.isArray(frequencyHz) || ArrayBuffer.isView(frequencyHz)
    ? Array.from(frequencyHz, (frequency, index) => finiteAudioNumber(frequency, `frequencyHz[${index}]`))
    : [finiteAudioNumber(frequencyHz, 'frequencyHz')];
  const magnitude = [];
  const phase = [];

  for (const frequency of frequencies) {
    if (frequency < 0 || frequency > rate * 0.5) {
      magnitude.push(Number.NaN);
      phase.push(Number.NaN);
      continue;
    }

    const omega = TAU * frequency / rate;
    const z1r = Math.cos(omega);
    const z1i = -Math.sin(omega);
    const z2r = Math.cos(2 * omega);
    const z2i = -Math.sin(2 * omega);
    const nr = normalized.b0 + normalized.b1 * z1r + normalized.b2 * z2r;
    const ni = normalized.b1 * z1i + normalized.b2 * z2i;
    const dr = 1 + normalized.a1 * z1r + normalized.a2 * z2r;
    const di = normalized.a1 * z1i + normalized.a2 * z2i;
    const denom = dr * dr + di * di;
    if (denom <= EPSILON) {
      magnitude.push(Number.POSITIVE_INFINITY);
      phase.push(Number.NaN);
      continue;
    }
    const hr = (nr * dr + ni * di) / denom;
    const hi = (ni * dr - nr * di) / denom;
    magnitude.push(Math.hypot(hr, hi));
    phase.push(Math.atan2(hi, hr));
  }

  return {
    sampleRate: rate,
    frequencyHz: Object.freeze(frequencies),
    magnitude: Object.freeze(magnitude),
    phase: Object.freeze(phase),
  };
}

function normalizeBiquadCoefficients(report) {
  const a0 = Math.abs(report.raw.a0) <= EPSILON ? EPSILON : report.raw.a0;
  const normalized = Object.freeze({
    b0: report.raw.b0 / a0,
    b1: report.raw.b1 / a0,
    b2: report.raw.b2 / a0,
    a0: 1,
    a1: report.raw.a1 / a0,
    a2: report.raw.a2 / a0,
  });
  return {
    ...report,
    normalized,
    b: Object.freeze([normalized.b0, normalized.b1, normalized.b2]),
    a: Object.freeze([normalized.a0, normalized.a1, normalized.a2]),
  };
}

function normalizedCoefficientObject(coefficients) {
  const source = coefficients?.normalized ?? coefficients;
  if (!source || typeof source !== 'object') throw new TypeError('coefficients must be an object');
  return {
    b0: finiteAudioNumber(source.b0, 'b0'),
    b1: finiteAudioNumber(source.b1, 'b1'),
    b2: finiteAudioNumber(source.b2, 'b2'),
    a1: finiteAudioNumber(source.a1, 'a1'),
    a2: finiteAudioNumber(source.a2, 'a2'),
  };
}

function normalizedBiquadType(type) {
  const value = String(type ?? 'lowpass').toLowerCase();
  if (!AUDIO_BIQUAD_TYPES.includes(value)) throw new RangeError(`unsupported biquad filter type: ${type}`);
  return value;
}

function numericCurve(curve) {
  if (!curve || typeof curve.length !== 'number') throw new TypeError('curve must be array-like');
  if (curve.length === 0) throw new RangeError('curve must contain at least one value');
  return Object.freeze(Array.from(curve, (value, index) => finiteAudioNumber(value, `curve[${index}]`)));
}

function finiteAudioNumber(value, name) {
  const number = finiteNumber(value, Number.NaN);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
  return number;
}

function nonnegativeAudioNumber(value, name) {
  const number = finiteAudioNumber(value, name);
  if (number < 0) throw new RangeError(`${name} must be nonnegative`);
  return number;
}

function positiveAudioNumber(value, name) {
  const number = finiteAudioNumber(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function finiteOrInfinity(value, name) {
  if (value === Infinity) return Infinity;
  return finiteAudioNumber(value, name);
}

export default {
  AUDIO_BIQUAD_TYPES,
  audioAutomationLinearRampValue,
  audioAutomationExponentialRampValue,
  audioAutomationSetTargetValue,
  audioAutomationValueCurveAtTime,
  audioAdsrEnvelopeValue,
  audioAdsrEnvelopeReport,
  audioBiquadComputedFrequency,
  audioBiquadCoefficients,
  audioBiquadFrequencyResponse,
};
