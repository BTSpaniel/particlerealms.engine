// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// JitterMath.js - packet delay variation, RTP/WebRTC jitter, and adaptive buffer reports.

import {
  NETWORK_RTP_JITTER_GAIN,
  latencyJitterReport,
  rtpInterarrivalJitterUpdate,
} from './NetworkMetricMath.js';
import { clamp, lerp } from './MathScalar.js';
import { statsMean } from './MathStatistics.js';

export const JITTER_DEFAULT_EMA_ALPHA = 0.1;
export const JITTER_DEFAULT_TARGET_MS = 5;
export const JITTER_DEFAULT_MAX_MS = 100;
export const JITTER_DEFAULT_BUFFER_MULTIPLIER = 2;
export const JITTER_DEFAULT_MIN_BUFFER_DELAY_MS = 20;
export const JITTER_DEFAULT_MAX_BUFFER_DELAY_MS = 150;
export const JITTER_DEFAULT_SPIKE_FACTOR = 1;
export const JITTER_DEFAULT_RECOVER_RATE_MS = 1;
export const JITTER_DEFAULT_RECOVER_AFTER_FRAMES = 10;

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${name} must be finite`);
  }
  return number;
}

function nonnegativeNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number < 0) {
    throw new RangeError(`${name} must be nonnegative`);
  }
  return number;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function optionalFinite(value, name, fallback = null) {
  return value === undefined || value === null ? fallback : finiteNumber(value, name);
}

function optionalNonnegative(value, name, fallback = 0) {
  return value === undefined || value === null ? fallback : nonnegativeNumber(value, name);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function mean(values) {
  return statsMean(values);
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return 0;
  const index = clamp(Math.ceil(clamp01(ratio) * sortedValues.length) - 1, 0, sortedValues.length - 1);
  return sortedValues[index];
}

function normalizedSamples(samplesMs, name) {
  if (!samplesMs || typeof samplesMs[Symbol.iterator] !== 'function') {
    throw new TypeError(`${name} must be iterable`);
  }
  return Array.from(samplesMs, (sample, index) => nonnegativeNumber(sample, `${name}[${index}]`));
}

export function jitterQualityScore(jitterMs, options = {}) {
  const jitter = nonnegativeNumber(jitterMs, 'jitterMs');
  const targetJitterMs = positiveNumber(options.targetJitterMs ?? JITTER_DEFAULT_TARGET_MS, 'targetJitterMs');
  const maxJitterMs = positiveNumber(options.maxJitterMs ?? JITTER_DEFAULT_MAX_MS, 'maxJitterMs');
  if (maxJitterMs <= targetJitterMs) {
    throw new RangeError('maxJitterMs must be greater than targetJitterMs');
  }
  return 1 - clamp01((jitter - targetJitterMs) / (maxJitterMs - targetJitterMs));
}

export function packetDelayVariationMs(firstDelayMs, secondDelayMs) {
  return nonnegativeNumber(secondDelayMs, 'secondDelayMs') - nonnegativeNumber(firstDelayMs, 'firstDelayMs');
}

export function packetDelayVariationReport(samplesMs = [], options = {}) {
  const samples = normalizedSamples(samplesMs, 'samplesMs');
  const signedDeltasMs = [];
  const absoluteDeltasMs = [];
  for (let index = 1; index < samples.length; index += 1) {
    const delta = packetDelayVariationMs(samples[index - 1], samples[index]);
    signedDeltasMs.push(delta);
    absoluteDeltasMs.push(Math.abs(delta));
  }

  const meanDelayMs = mean(samples);
  const varianceMsSquared = samples.length === 0
    ? 0
    : mean(samples.map((sample) => {
      const offset = sample - meanDelayMs;
      return offset * offset;
    }));
  const sortedAbs = [...absoluteDeltasMs].sort((a, b) => a - b);
  const percentileRatio = optionalFinite(options.percentileRatio, 'percentileRatio', 0.95);
  return {
    count: samples.length,
    samplesMs: Object.freeze(samples),
    signedDeltasMs: Object.freeze(signedDeltasMs),
    absoluteDeltasMs: Object.freeze(absoluteDeltasMs),
    meanDelayMs,
    minDelayMs: samples.length === 0 ? 0 : Math.min(...samples),
    maxDelayMs: samples.length === 0 ? 0 : Math.max(...samples),
    stddevDelayMs: Math.sqrt(varianceMsSquared),
    meanVariationMs: mean(signedDeltasMs),
    meanAbsoluteVariationMs: mean(absoluteDeltasMs),
    rmsVariationMs: absoluteDeltasMs.length === 0 ? 0 : Math.sqrt(mean(absoluteDeltasMs.map((delta) => delta * delta))),
    maxAbsoluteVariationMs: absoluteDeltasMs.length === 0 ? 0 : Math.max(...absoluteDeltasMs),
    percentileRatio: clamp01(percentileRatio),
    percentileAbsoluteVariationMs: percentile(sortedAbs, percentileRatio),
    networkMetricSummary: latencyJitterReport(samples),
  };
}

export function rtpJitterUpdateReport(previous = null, packet = {}, options = {}) {
  const clockRateHz = positiveNumber(packet.clockRateHz ?? options.clockRateHz, 'clockRateHz');
  const gain = positiveNumber(options.gain ?? packet.gain ?? NETWORK_RTP_JITTER_GAIN, 'gain');
  if (gain > 1) throw new RangeError('gain must be less than or equal to 1');
  const update = rtpInterarrivalJitterUpdate(previous, { ...packet, clockRateHz, gain });
  return {
    ...update,
    jitterSeconds: update.jitterMs / 1000,
    jitterTimestampUnits: (update.jitterMs / 1000) * clockRateHz,
    clockRateHz,
    gain,
  };
}

export function rtpJitterReport(packets = [], options = {}) {
  if (!Array.isArray(packets)) throw new TypeError('packets must be an array');
  let previous = options.previous ?? null;
  const samples = packets.map((packet, index) => {
    const report = rtpJitterUpdateReport(previous, packet, {
      clockRateHz: packet.clockRateHz ?? options.clockRateHz,
      gain: packet.gain ?? options.gain,
    });
    previous = report;
    return Object.freeze({
      index,
      transitMs: report.transitMs,
      deltaMs: report.deltaMs,
      jitterMs: report.jitterMs,
      jitterTimestampUnits: report.jitterTimestampUnits,
    });
  });
  const final = samples.length === 0 ? null : samples[samples.length - 1];
  return {
    packetCount: samples.length,
    samples: Object.freeze(samples),
    final,
    jitterMs: final ? final.jitterMs : 0,
    jitterSeconds: final ? final.jitterMs / 1000 : 0,
    jitterTimestampUnits: final ? final.jitterTimestampUnits : 0,
  };
}

export function adaptiveJitterEstimateUpdate(previous = {}, intervalMs, options = {}) {
  const interval = nonnegativeNumber(intervalMs, 'intervalMs');
  const alpha = positiveNumber(options.alpha ?? JITTER_DEFAULT_EMA_ALPHA, 'alpha');
  const jitterAlpha = positiveNumber(options.jitterAlpha ?? alpha, 'jitterAlpha');
  if (alpha > 1 || jitterAlpha > 1) throw new RangeError('alpha and jitterAlpha must be less than or equal to 1');
  const previousAverage = optionalNonnegative(previous.avgIntervalMs ?? previous.averageIntervalMs, 'previous.avgIntervalMs', interval);
  const previousJitter = optionalNonnegative(previous.jitterMs ?? previous.jitterEstimateMs, 'previous.jitterMs', 0);
  const avgIntervalMs = previousAverage * (1 - alpha) + interval * alpha;
  const deviationMs = Math.abs(interval - avgIntervalMs);
  const jitterMs = previousJitter * (1 - jitterAlpha) + deviationMs * jitterAlpha;
  return {
    intervalMs: interval,
    avgIntervalMs,
    deviationMs,
    jitterMs,
    alpha,
    jitterAlpha,
  };
}

export function adaptiveJitterBufferReport(options = {}) {
  const avgIntervalMs = nonnegativeNumber(options.avgIntervalMs ?? options.intervalMs ?? 0, 'avgIntervalMs');
  const jitterMs = nonnegativeNumber(options.jitterMs ?? options.jitterEstimateMs ?? 0, 'jitterMs');
  const jitterMultiplier = nonnegativeNumber(options.jitterMultiplier ?? JITTER_DEFAULT_BUFFER_MULTIPLIER, 'jitterMultiplier');
  const safetyMarginMs = optionalNonnegative(options.safetyMarginMs, 'safetyMarginMs', 0);
  const minDelayMs = nonnegativeNumber(options.minDelayMs ?? JITTER_DEFAULT_MIN_BUFFER_DELAY_MS, 'minDelayMs');
  const maxDelayMs = positiveNumber(options.maxDelayMs ?? JITTER_DEFAULT_MAX_BUFFER_DELAY_MS, 'maxDelayMs');
  if (maxDelayMs < minDelayMs) throw new RangeError('maxDelayMs must be greater than or equal to minDelayMs');

  const targetDelayMs = clamp(avgIntervalMs + jitterMs * jitterMultiplier + safetyMarginMs, minDelayMs, maxDelayMs);
  const currentDelayMs = optionalNonnegative(options.currentDelayMs, 'currentDelayMs', null);
  const stableFrames = optionalNonnegative(options.stableFrames, 'stableFrames', 0);
  const recoverAfterFrames = nonnegativeNumber(options.recoverAfterFrames ?? JITTER_DEFAULT_RECOVER_AFTER_FRAMES, 'recoverAfterFrames');
  const recoverRateMs = nonnegativeNumber(options.recoverRateMs ?? JITTER_DEFAULT_RECOVER_RATE_MS, 'recoverRateMs');
  const spikeFactor = positiveNumber(options.spikeFactor ?? JITTER_DEFAULT_SPIKE_FACTOR, 'spikeFactor');
  if (spikeFactor > 1) throw new RangeError('spikeFactor must be less than or equal to 1');

  let adjustedDelayMs = targetDelayMs;
  let adjustment = 'target';
  if (currentDelayMs !== null) {
    if (targetDelayMs > currentDelayMs) {
      adjustedDelayMs = lerp(currentDelayMs, targetDelayMs, spikeFactor);
      adjustment = 'expand';
    } else if (stableFrames >= recoverAfterFrames) {
      adjustedDelayMs = Math.max(targetDelayMs, currentDelayMs - recoverRateMs);
      adjustment = 'recover';
    } else {
      adjustedDelayMs = currentDelayMs;
      adjustment = 'hold';
    }
  }

  return {
    avgIntervalMs,
    jitterMs,
    jitterMultiplier,
    safetyMarginMs,
    minDelayMs,
    maxDelayMs,
    targetDelayMs,
    currentDelayMs,
    adjustedDelayMs,
    stableFrames,
    recoverAfterFrames,
    recoverRateMs,
    spikeFactor,
    adjustment,
  };
}

export function peerRttJitterReport(rttSamplesMs = [], options = {}) {
  const variation = packetDelayVariationReport(rttSamplesMs, options);
  const avgJitterMs = variation.meanAbsoluteVariationMs;
  const score = variation.absoluteDeltasMs.length === 0
    ? optionalFinite(options.emptyScore, 'emptyScore', 0.5)
    : jitterQualityScore(avgJitterMs, options);
  return {
    sampleCount: variation.count,
    avgRttMs: variation.meanDelayMs,
    minRttMs: variation.minDelayMs,
    maxRttMs: variation.maxDelayMs,
    avgJitterMs,
    maxJitterMs: variation.maxAbsoluteVariationMs,
    p95JitterMs: variation.percentileAbsoluteVariationMs,
    jitterScore: clamp01(score),
    quality: score >= 0.85 ? 'excellent' : (score >= 0.65 ? 'good' : (score >= 0.4 ? 'weak' : 'poor')),
    variation,
  };
}

export function webRtcJitterBufferReport(stats = {}, options = {}) {
  if (!stats || typeof stats !== 'object') throw new TypeError('stats must be an object');
  const emittedCount = optionalNonnegative(
    stats.jitterBufferEmittedCount ?? stats.framesDecoded ?? stats.framesRendered ?? stats.totalSamplesReceived,
    'jitterBufferEmittedCount',
    0,
  );
  const jitterBufferDelaySeconds = optionalNonnegative(stats.jitterBufferDelay, 'jitterBufferDelay', 0);
  const jitterBufferTargetDelaySeconds = optionalNonnegative(stats.jitterBufferTargetDelay, 'jitterBufferTargetDelay', 0);
  const jitterBufferMinimumDelaySeconds = optionalNonnegative(stats.jitterBufferMinimumDelay, 'jitterBufferMinimumDelay', 0);
  const jitterSeconds = optionalNonnegative(stats.jitter, 'jitter', 0);
  const packetsDiscarded = optionalNonnegative(stats.packetsDiscarded, 'packetsDiscarded', 0);
  const packetsReceived = optionalNonnegative(stats.packetsReceived, 'packetsReceived', 0);
  const totalPackets = packetsReceived + packetsDiscarded;
  const targetJitterMs = positiveNumber(options.targetJitterMs ?? JITTER_DEFAULT_TARGET_MS, 'targetJitterMs');
  const maxJitterMs = positiveNumber(options.maxJitterMs ?? JITTER_DEFAULT_MAX_MS, 'maxJitterMs');
  const jitterMs = jitterSeconds * 1000;
  return {
    emittedCount,
    jitterMs,
    jitterQualityScore: jitterQualityScore(jitterMs, { targetJitterMs, maxJitterMs }),
    jitterBufferDelayMs: jitterBufferDelaySeconds * 1000,
    jitterBufferTargetDelayMs: jitterBufferTargetDelaySeconds * 1000,
    jitterBufferMinimumDelayMs: jitterBufferMinimumDelaySeconds * 1000,
    averageJitterBufferDelayMs: emittedCount === 0 ? null : (jitterBufferDelaySeconds / emittedCount) * 1000,
    averageTargetDelayMs: emittedCount === 0 ? null : (jitterBufferTargetDelaySeconds / emittedCount) * 1000,
    averageMinimumDelayMs: emittedCount === 0 ? null : (jitterBufferMinimumDelaySeconds / emittedCount) * 1000,
    packetsDiscarded,
    packetsReceived,
    discardRatio: totalPackets === 0 ? 0 : packetsDiscarded / totalPackets,
  };
}

export function interFrameDelayVariationReport(stats = {}) {
  if (!stats || typeof stats !== 'object') throw new TypeError('stats must be an object');
  const framesRendered = nonnegativeNumber(stats.framesRendered ?? stats.framesDecoded ?? 0, 'framesRendered');
  const totalInterFrameDelaySeconds = optionalNonnegative(stats.totalInterFrameDelay, 'totalInterFrameDelay', 0);
  const totalSquaredInterFrameDelaySeconds = optionalNonnegative(stats.totalSquaredInterFrameDelay, 'totalSquaredInterFrameDelay', 0);
  const varianceSecondsSquared = framesRendered === 0
    ? 0
    : Math.max(0, (totalSquaredInterFrameDelaySeconds - ((totalInterFrameDelaySeconds * totalInterFrameDelaySeconds) / framesRendered)) / framesRendered);
  const averageSeconds = framesRendered === 0 ? 0 : totalInterFrameDelaySeconds / framesRendered;
  return {
    framesRendered,
    totalInterFrameDelayMs: totalInterFrameDelaySeconds * 1000,
    totalSquaredInterFrameDelaySeconds,
    averageInterFrameDelayMs: averageSeconds * 1000,
    varianceSecondsSquared,
    stddevInterFrameDelayMs: Math.sqrt(varianceSecondsSquared) * 1000,
    estimatedFps: averageSeconds > 0 ? 1 / averageSeconds : 0,
  };
}

export default Object.freeze({
  JITTER_DEFAULT_BUFFER_MULTIPLIER,
  JITTER_DEFAULT_EMA_ALPHA,
  JITTER_DEFAULT_MAX_BUFFER_DELAY_MS,
  JITTER_DEFAULT_MAX_MS,
  JITTER_DEFAULT_MIN_BUFFER_DELAY_MS,
  JITTER_DEFAULT_RECOVER_AFTER_FRAMES,
  JITTER_DEFAULT_RECOVER_RATE_MS,
  JITTER_DEFAULT_SPIKE_FACTOR,
  JITTER_DEFAULT_TARGET_MS,
  adaptiveJitterBufferReport,
  adaptiveJitterEstimateUpdate,
  interFrameDelayVariationReport,
  jitterQualityScore,
  packetDelayVariationMs,
  packetDelayVariationReport,
  peerRttJitterReport,
  rtpJitterReport,
  rtpJitterUpdateReport,
  webRtcJitterBufferReport,
});
