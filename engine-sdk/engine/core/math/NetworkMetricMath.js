// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// NetworkMetricMath.js - reusable RTT, jitter, loss, throughput, goodput, and timeout helpers.

import { statsMean } from './MathStatistics.js';
import { lerp } from './MathScalar.js';

export const NETWORK_RTO_ALPHA = 1 / 8;
export const NETWORK_RTO_BETA = 1 / 4;
export const NETWORK_RTO_VARIANCE_MULTIPLIER = 4;
export const NETWORK_DEFAULT_MIN_TIMEOUT_MS = 1000;
export const NETWORK_DEFAULT_MAX_TIMEOUT_MS = 60000;
export const NETWORK_DEFAULT_CLOCK_GRANULARITY_MS = 1;
export const NETWORK_RTP_JITTER_GAIN = 1 / 16;

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

function optionalNonnegative(value, name, fallback = 0) {
  return value === undefined || value === null ? fallback : nonnegativeNumber(value, name);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function networkDurationSeconds(durationMs) {
  return positiveNumber(durationMs, 'durationMs') / 1000;
}

export function networkRatePerSecond(count, durationMs) {
  return nonnegativeNumber(count, 'count') / networkDurationSeconds(durationMs);
}

export function packetsPerSecond(packetCount, durationMs) {
  return networkRatePerSecond(packetCount, durationMs);
}

export function bitrateBps(byteCount, durationMs) {
  return networkRatePerSecond(nonnegativeNumber(byteCount, 'byteCount') * 8, durationMs);
}

export function throughputBps(byteCount, durationMs) {
  return bitrateBps(byteCount, durationMs);
}

export function goodputReport(options = {}) {
  const payloadBytes = nonnegativeNumber(options.payloadBytes ?? 0, 'payloadBytes');
  const totalBytes = nonnegativeNumber(options.totalBytes ?? payloadBytes, 'totalBytes');
  const durationMs = positiveNumber(options.durationMs, 'durationMs');
  if (totalBytes < payloadBytes) {
    throw new RangeError('totalBytes must be greater than or equal to payloadBytes');
  }
  const overheadBytes = totalBytes - payloadBytes;
  const throughput = throughputBps(totalBytes, durationMs);
  const goodput = throughputBps(payloadBytes, durationMs);
  return {
    payloadBytes,
    overheadBytes,
    totalBytes,
    durationMs,
    throughputBps: throughput,
    goodputBps: goodput,
    overheadRatio: totalBytes === 0 ? 0 : overheadBytes / totalBytes,
    efficiencyRatio: totalBytes === 0 ? 1 : payloadBytes / totalBytes,
  };
}

export function packetLossReport(options = {}) {
  const sentPackets = options.sentPackets === undefined ? null : nonnegativeNumber(options.sentPackets, 'sentPackets');
  const receivedPackets = options.receivedPackets === undefined ? null : nonnegativeNumber(options.receivedPackets, 'receivedPackets');
  const expectedPackets = options.expectedPackets === undefined
    ? (sentPackets ?? (receivedPackets === null ? 0 : receivedPackets + optionalNonnegative(options.lostPackets, 'lostPackets', 0)))
    : nonnegativeNumber(options.expectedPackets, 'expectedPackets');
  const lostPackets = options.lostPackets === undefined
    ? Math.max(0, expectedPackets - (receivedPackets ?? 0))
    : nonnegativeNumber(options.lostPackets, 'lostPackets');
  const deliveredPackets = receivedPackets ?? Math.max(0, expectedPackets - lostPackets);
  const duplicatePackets = optionalNonnegative(options.duplicatePackets, 'duplicatePackets', 0);
  const retransmittedPackets = optionalNonnegative(options.retransmittedPackets, 'retransmittedPackets', 0);
  const lossRatio = expectedPackets === 0 ? 0 : lostPackets / expectedPackets;
  return {
    expectedPackets,
    sentPackets: sentPackets ?? expectedPackets,
    deliveredPackets,
    receivedPackets: deliveredPackets,
    lostPackets,
    duplicatePackets,
    retransmittedPackets,
    lossRatio,
    deliveryRatio: expectedPackets === 0 ? 1 : deliveredPackets / expectedPackets,
    duplicateRatio: expectedPackets === 0 ? 0 : duplicatePackets / expectedPackets,
    retransmitRatio: expectedPackets === 0 ? 0 : retransmittedPackets / expectedPackets,
  };
}

export function rttSampleMs(options = {}) {
  const sentAtMs = finiteNumber(options.sentAtMs, 'sentAtMs');
  const ackReceivedAtMs = finiteNumber(options.ackReceivedAtMs ?? options.receivedAtMs, 'ackReceivedAtMs');
  const ackDelayMs = optionalNonnegative(options.ackDelayMs, 'ackDelayMs', 0);
  return Math.max(0, ackReceivedAtMs - sentAtMs - ackDelayMs);
}

export function oneWayLatencyEstimateMs(options = {}) {
  if (options.sendTimeMs !== undefined && options.receiveTimeMs !== undefined) {
    const sendTimeMs = finiteNumber(options.sendTimeMs, 'sendTimeMs');
    const receiveTimeMs = finiteNumber(options.receiveTimeMs, 'receiveTimeMs');
    const receiverClockOffsetMs = finiteNumber(options.receiverClockOffsetMs ?? options.clockOffsetMs ?? 0, 'receiverClockOffsetMs');
    return Math.max(0, receiveTimeMs - receiverClockOffsetMs - sendTimeMs);
  }
  const rttMs = nonnegativeNumber(options.rttMs, 'rttMs');
  const asymmetryRatio = finiteNumber(options.asymmetryRatio ?? 0.5, 'asymmetryRatio');
  if (asymmetryRatio < 0 || asymmetryRatio > 1) {
    throw new RangeError('asymmetryRatio must be between 0 and 1');
  }
  return rttMs * asymmetryRatio;
}

export function timeoutEstimateMs(estimator = {}, options = {}) {
  const smoothedRttMs = nonnegativeNumber(estimator.smoothedRttMs ?? estimator.srttMs ?? 0, 'smoothedRttMs');
  const rttVariationMs = nonnegativeNumber(estimator.rttVariationMs ?? estimator.rttvarMs ?? 0, 'rttVariationMs');
  const clockGranularityMs = positiveNumber(options.clockGranularityMs ?? NETWORK_DEFAULT_CLOCK_GRANULARITY_MS, 'clockGranularityMs');
  const varianceMultiplier = positiveNumber(options.varianceMultiplier ?? NETWORK_RTO_VARIANCE_MULTIPLIER, 'varianceMultiplier');
  const minTimeoutMs = nonnegativeNumber(options.minTimeoutMs ?? NETWORK_DEFAULT_MIN_TIMEOUT_MS, 'minTimeoutMs');
  const maxTimeoutMs = positiveNumber(options.maxTimeoutMs ?? NETWORK_DEFAULT_MAX_TIMEOUT_MS, 'maxTimeoutMs');
  if (maxTimeoutMs < minTimeoutMs) throw new RangeError('maxTimeoutMs must be greater than or equal to minTimeoutMs');
  const rawTimeoutMs = smoothedRttMs + Math.max(clockGranularityMs, varianceMultiplier * rttVariationMs);
  return Math.min(maxTimeoutMs, Math.max(minTimeoutMs, rawTimeoutMs));
}

export function rttEstimatorUpdate(sampleRttMs, previous = null, options = {}) {
  const sample = nonnegativeNumber(sampleRttMs, 'sampleRttMs');
  const alpha = positiveNumber(options.alpha ?? NETWORK_RTO_ALPHA, 'alpha');
  const beta = positiveNumber(options.beta ?? NETWORK_RTO_BETA, 'beta');
  if (alpha > 1 || beta > 1) throw new RangeError('alpha and beta must be less than or equal to 1');

  const hasPrevious = previous &&
    Number.isFinite(Number(previous.smoothedRttMs ?? previous.srttMs)) &&
    Number.isFinite(Number(previous.rttVariationMs ?? previous.rttvarMs));
  const previousSmoothed = hasPrevious ? nonnegativeNumber(previous.smoothedRttMs ?? previous.srttMs, 'previous.smoothedRttMs') : sample;
  const previousVariation = hasPrevious ? nonnegativeNumber(previous.rttVariationMs ?? previous.rttvarMs, 'previous.rttVariationMs') : sample / 2;
  const rttVariationMs = hasPrevious
    ? ((1 - beta) * previousVariation) + (beta * Math.abs(previousSmoothed - sample))
    : previousVariation;
  const smoothedRttMs = hasPrevious
    ? ((1 - alpha) * previousSmoothed) + (alpha * sample)
    : sample;
  const timeoutMs = timeoutEstimateMs({ smoothedRttMs, rttVariationMs }, options);

  return {
    initialized: true,
    sampleRttMs: sample,
    smoothedRttMs,
    rttVariationMs,
    timeoutMs,
    alpha,
    beta,
  };
}

export function quicProbeTimeoutMs(estimator = {}, options = {}) {
  const smoothedRttMs = nonnegativeNumber(estimator.smoothedRttMs ?? estimator.srttMs ?? 0, 'smoothedRttMs');
  const rttVariationMs = nonnegativeNumber(estimator.rttVariationMs ?? estimator.rttvarMs ?? 0, 'rttVariationMs');
  const clockGranularityMs = positiveNumber(options.clockGranularityMs ?? NETWORK_DEFAULT_CLOCK_GRANULARITY_MS, 'clockGranularityMs');
  const maxAckDelayMs = optionalNonnegative(options.maxAckDelayMs, 'maxAckDelayMs', 0);
  const ptoCount = optionalNonnegative(options.ptoCount, 'ptoCount', 0);
  const basePto = smoothedRttMs + Math.max(4 * rttVariationMs, clockGranularityMs) + maxAckDelayMs;
  return basePto * (2 ** ptoCount);
}

export function rtpTransitTimeMs(packet = {}) {
  const arrivalTimeMs = finiteNumber(packet.arrivalTimeMs, 'arrivalTimeMs');
  const rtpTimestamp = finiteNumber(packet.rtpTimestamp, 'rtpTimestamp');
  const clockRateHz = positiveNumber(packet.clockRateHz, 'clockRateHz');
  return arrivalTimeMs - (rtpTimestamp / clockRateHz) * 1000;
}

export function interarrivalJitterUpdate(previousTransitMs, currentTransitMs, previousJitterMs = 0, options = {}) {
  const previousTransit = finiteNumber(previousTransitMs, 'previousTransitMs');
  const currentTransit = finiteNumber(currentTransitMs, 'currentTransitMs');
  const previousJitter = nonnegativeNumber(previousJitterMs, 'previousJitterMs');
  const gain = positiveNumber(options.gain ?? NETWORK_RTP_JITTER_GAIN, 'gain');
  if (gain > 1) throw new RangeError('gain must be less than or equal to 1');
  const deltaMs = currentTransit - previousTransit;
  const jitterMs = lerp(previousJitter, Math.abs(deltaMs), gain);
  return {
    previousTransitMs: previousTransit,
    currentTransitMs: currentTransit,
    deltaMs,
    jitterMs,
  };
}

export function rtpInterarrivalJitterUpdate(previous = null, packet = {}) {
  const transitMs = rtpTransitTimeMs(packet);
  if (!previous || previous.transitMs === undefined) {
    return {
      transitMs,
      jitterMs: optionalNonnegative(previous?.jitterMs, 'previous.jitterMs', 0),
      deltaMs: 0,
      initialized: true,
    };
  }
  const update = interarrivalJitterUpdate(previous.transitMs, transitMs, previous.jitterMs ?? 0, packet);
  return {
    transitMs,
    jitterMs: update.jitterMs,
    deltaMs: update.deltaMs,
    initialized: true,
  };
}

export function latencyJitterReport(samplesMs = []) {
  if (!samplesMs || typeof samplesMs[Symbol.iterator] !== 'function') {
    throw new TypeError('samplesMs must be iterable');
  }
  const samples = Array.from(samplesMs, (sample, index) => nonnegativeNumber(sample, `samplesMs[${index}]`));
  const deltas = [];
  for (let i = 1; i < samples.length; i += 1) {
    deltas.push(Math.abs(samples[i] - samples[i - 1]));
  }
  const meanMs = statsMean(samples);
  const meanDeltaMs = statsMean(deltas);
  const rmsDeltaMs = deltas.length === 0 ? 0 : Math.sqrt(statsMean(deltas.map((value) => value * value)));
  return {
    count: samples.length,
    meanMs,
    minMs: samples.length === 0 ? 0 : Math.min(...samples),
    maxMs: samples.length === 0 ? 0 : Math.max(...samples),
    deltasMs: Object.freeze(deltas),
    meanDeltaMs,
    rmsDeltaMs,
    maxDeltaMs: deltas.length === 0 ? 0 : Math.max(...deltas),
  };
}

export function networkQualityReport(options = {}) {
  const rttMs = nonnegativeNumber(options.rttMs ?? options.latencyMs ?? 0, 'rttMs');
  const jitterMs = nonnegativeNumber(options.jitterMs ?? 0, 'jitterMs');
  const lossRatio = nonnegativeNumber(options.lossRatio ?? 0, 'lossRatio');
  const goodput = nonnegativeNumber(options.goodputBps ?? options.throughputBps ?? 0, 'goodputBps');
  const targetRttMs = positiveNumber(options.targetRttMs ?? 100, 'targetRttMs');
  const maxRttMs = positiveNumber(options.maxRttMs ?? 400, 'maxRttMs');
  const targetJitterMs = positiveNumber(options.targetJitterMs ?? 20, 'targetJitterMs');
  const maxJitterMs = positiveNumber(options.maxJitterMs ?? 100, 'maxJitterMs');
  const maxLossRatio = positiveNumber(options.maxLossRatio ?? 0.1, 'maxLossRatio');
  const targetGoodputBps = positiveNumber(options.targetGoodputBps ?? 1, 'targetGoodputBps');
  if (maxRttMs <= targetRttMs) throw new RangeError('maxRttMs must be greater than targetRttMs');
  if (maxJitterMs <= targetJitterMs) throw new RangeError('maxJitterMs must be greater than targetJitterMs');

  const latencyScore = 1 - clamp01((rttMs - targetRttMs) / (maxRttMs - targetRttMs));
  const jitterScore = 1 - clamp01((jitterMs - targetJitterMs) / (maxJitterMs - targetJitterMs));
  const lossScore = 1 - clamp01(lossRatio / maxLossRatio);
  const goodputScore = clamp01(goodput / targetGoodputBps);
  const qualityScore = (latencyScore + jitterScore + lossScore + goodputScore) / 4;
  return {
    rttMs,
    jitterMs,
    lossRatio,
    goodputBps: goodput,
    latencyScore,
    jitterScore,
    lossScore,
    goodputScore,
    qualityScore,
    quality: qualityScore >= 0.85 ? 'excellent' : (qualityScore >= 0.65 ? 'good' : (qualityScore >= 0.4 ? 'weak' : 'poor')),
  };
}

export default Object.freeze({
  NETWORK_DEFAULT_CLOCK_GRANULARITY_MS,
  NETWORK_DEFAULT_MAX_TIMEOUT_MS,
  NETWORK_DEFAULT_MIN_TIMEOUT_MS,
  NETWORK_RTO_ALPHA,
  NETWORK_RTO_BETA,
  NETWORK_RTO_VARIANCE_MULTIPLIER,
  NETWORK_RTP_JITTER_GAIN,
  bitrateBps,
  goodputReport,
  interarrivalJitterUpdate,
  latencyJitterReport,
  networkDurationSeconds,
  networkQualityReport,
  networkRatePerSecond,
  oneWayLatencyEstimateMs,
  packetLossReport,
  packetsPerSecond,
  quicProbeTimeoutMs,
  rtpInterarrivalJitterUpdate,
  rtpTransitTimeMs,
  rttEstimatorUpdate,
  rttSampleMs,
  throughputBps,
  timeoutEstimateMs,
});
