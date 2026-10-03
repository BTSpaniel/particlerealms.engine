// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// SignalQualityMath.js - reusable signal/link health scoring for radio and WebRTC diagnostics.

import {
  rssiQualityScore,
  signalInterferenceNoiseRatioDb,
  snrQualityScore,
} from './RadioMath.js';

export const SIGNAL_QUALITY_DEFAULT_WEIGHTS = Object.freeze({
  rssi: 0.15,
  snr: 0.20,
  sinr: 0.20,
  margin: 0.10,
  delivery: 0.15,
  latency: 0.05,
  jitter: 0.05,
  bitrate: 0.10,
});

export const SIGNAL_QUALITY_DEFAULT_MAX_LOSS_RATIO = 0.1;
export const SIGNAL_QUALITY_DEFAULT_TARGET_RTT_MS = 100;
export const SIGNAL_QUALITY_DEFAULT_MAX_RTT_MS = 400;
export const SIGNAL_QUALITY_DEFAULT_TARGET_JITTER_MS = 20;
export const SIGNAL_QUALITY_DEFAULT_MAX_JITTER_MS = 100;

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

function optionalPositive(value, name, fallback) {
  return value === undefined || value === null ? fallback : positiveNumber(value, name);
}

function optionalFinite(value, name, fallback = null) {
  return value === undefined || value === null ? fallback : finiteNumber(value, name);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function qualityLabel(score) {
  if (score >= 0.85) return 'excellent';
  if (score >= 0.65) return 'good';
  if (score >= 0.4) return 'weak';
  return 'poor';
}

function normalizedAscendingScore(value, unusable, excellent) {
  if (excellent <= unusable) throw new RangeError('excellent threshold must be greater than unusable threshold');
  return clamp01((value - unusable) / (excellent - unusable));
}

function normalizedDescendingScore(value, target, maximum) {
  if (maximum <= target) throw new RangeError('maximum threshold must be greater than target threshold');
  return 1 - clamp01((value - target) / (maximum - target));
}

function maybeScore(score) {
  return score === null || score === undefined ? null : clamp01(finiteNumber(score, 'score'));
}

function hasDeliveryTelemetry(options = {}) {
  return (
    options.packetsReceived !== undefined ||
    options.receivedPackets !== undefined ||
    options.packetsLost !== undefined ||
    options.lostPackets !== undefined ||
    options.expectedPackets !== undefined ||
    options.lossRatio !== undefined ||
    options.duplicatePackets !== undefined ||
    options.retransmittedPackets !== undefined
  );
}

export function signalLevelQualityScore(valueDb, options = {}) {
  const value = finiteNumber(valueDb, 'valueDb');
  const unusable = finiteNumber(options.unusableDb ?? options.unusableDbm ?? 0, 'unusableDb');
  const excellent = finiteNumber(options.excellentDb ?? options.excellentDbm ?? 30, 'excellentDb');
  return normalizedAscendingScore(value, unusable, excellent);
}

export function signalDeliveryQualityScore(options = {}) {
  const packetsReceived = optionalNonnegative(options.packetsReceived ?? options.receivedPackets, 'packetsReceived', 0);
  const packetsLost = Math.max(0, optionalFinite(options.packetsLost ?? options.lostPackets, 'packetsLost', 0));
  const duplicatePackets = optionalNonnegative(options.duplicatePackets, 'duplicatePackets', 0);
  const retransmittedPackets = optionalNonnegative(options.retransmittedPackets, 'retransmittedPackets', 0);
  const expectedPackets = options.expectedPackets === undefined
    ? packetsReceived + packetsLost
    : nonnegativeNumber(options.expectedPackets, 'expectedPackets');
  const lossRatio = options.lossRatio === undefined
    ? (expectedPackets === 0 ? 0 : packetsLost / expectedPackets)
    : clamp01(finiteNumber(options.lossRatio, 'lossRatio'));
  const duplicateRatio = expectedPackets === 0 ? 0 : duplicatePackets / expectedPackets;
  const retransmitRatio = expectedPackets === 0 ? 0 : retransmittedPackets / expectedPackets;
  const maxLossRatio = positiveNumber(options.maxLossRatio ?? SIGNAL_QUALITY_DEFAULT_MAX_LOSS_RATIO, 'maxLossRatio');
  const maxDuplicateRatio = positiveNumber(options.maxDuplicateRatio ?? 0.1, 'maxDuplicateRatio');
  const maxRetransmitRatio = positiveNumber(options.maxRetransmitRatio ?? 0.1, 'maxRetransmitRatio');
  const lossScore = 1 - clamp01(lossRatio / maxLossRatio);
  const duplicateScore = 1 - clamp01(duplicateRatio / maxDuplicateRatio);
  const retransmitScore = 1 - clamp01(retransmitRatio / maxRetransmitRatio);
  const deliveryScore = clamp01(lossScore * 0.75 + duplicateScore * 0.10 + retransmitScore * 0.15);
  return {
    expectedPackets,
    packetsReceived,
    packetsLost,
    duplicatePackets,
    retransmittedPackets,
    lossRatio,
    duplicateRatio,
    retransmitRatio,
    lossScore,
    duplicateScore,
    retransmitScore,
    deliveryScore,
  };
}

export function signalLatencyQualityScore(rttMs, options = {}) {
  const rtt = nonnegativeNumber(rttMs, 'rttMs');
  const target = positiveNumber(options.targetRttMs ?? SIGNAL_QUALITY_DEFAULT_TARGET_RTT_MS, 'targetRttMs');
  const maximum = positiveNumber(options.maxRttMs ?? SIGNAL_QUALITY_DEFAULT_MAX_RTT_MS, 'maxRttMs');
  return normalizedDescendingScore(rtt, target, maximum);
}

export function signalJitterQualityScore(jitterMs, options = {}) {
  const jitter = nonnegativeNumber(jitterMs, 'jitterMs');
  const target = positiveNumber(options.targetJitterMs ?? SIGNAL_QUALITY_DEFAULT_TARGET_JITTER_MS, 'targetJitterMs');
  const maximum = positiveNumber(options.maxJitterMs ?? SIGNAL_QUALITY_DEFAULT_MAX_JITTER_MS, 'maxJitterMs');
  return normalizedDescendingScore(jitter, target, maximum);
}

export function signalBitrateQualityScore(bitrateBps, options = {}) {
  const bitrate = nonnegativeNumber(bitrateBps, 'bitrateBps');
  const target = positiveNumber(options.targetBitrateBps ?? options.targetGoodputBps ?? 1, 'targetBitrateBps');
  return clamp01(bitrate / target);
}

export function signalQualityReport(options = {}) {
  const rssiDbm = optionalFinite(options.rssiDbm ?? options.receivedPowerDbm, 'rssiDbm', null);
  const snrDb = optionalFinite(options.snrDb, 'snrDb', null);
  const sinrDb = options.sinrDb !== undefined
    ? finiteNumber(options.sinrDb, 'sinrDb')
    : (
      options.signalDbm !== undefined && options.noiseDbm !== undefined
        ? signalInterferenceNoiseRatioDb(options.signalDbm, options.noiseDbm, options.interferenceDbm ?? -Infinity)
        : null
    );
  const linkMarginDb = optionalFinite(options.linkMarginDb ?? options.marginDb, 'linkMarginDb', null);
  const rttMs = optionalFinite(options.rttMs ?? options.latencyMs, 'rttMs', null);
  const jitterMs = optionalFinite(options.jitterMs, 'jitterMs', null);
  const bitrateBps = optionalFinite(
    options.availableOutgoingBitrateBps ?? options.availableIncomingBitrateBps ?? options.goodputBps ?? options.throughputBps ?? options.bitrateBps,
    'bitrateBps',
    null,
  );

  const delivery = hasDeliveryTelemetry(options) ? signalDeliveryQualityScore(options) : null;
  const subScores = Object.freeze({
    rssi: rssiDbm === null ? null : rssiQualityScore(rssiDbm, options.rssi ?? options),
    snr: snrDb === null ? null : snrQualityScore(snrDb, options.snr ?? options),
    sinr: sinrDb === null ? null : signalLevelQualityScore(sinrDb, options.sinr ?? options),
    margin: linkMarginDb === null ? null : signalLevelQualityScore(linkMarginDb, {
      unusableDb: options.unusableMarginDb ?? 0,
      excellentDb: options.excellentMarginDb ?? 30,
    }),
    delivery: delivery === null ? null : delivery.deliveryScore,
    latency: rttMs === null ? null : signalLatencyQualityScore(rttMs, options),
    jitter: jitterMs === null ? null : signalJitterQualityScore(jitterMs, options),
    bitrate: bitrateBps === null ? null : signalBitrateQualityScore(bitrateBps, options),
  });

  const weights = { ...SIGNAL_QUALITY_DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
  let weightedSum = 0;
  let weightSum = 0;
  for (const [name, rawWeight] of Object.entries(weights)) {
    const score = maybeScore(subScores[name]);
    if (score === null) continue;
    const weight = nonnegativeNumber(rawWeight, `weights.${name}`);
    weightedSum += score * weight;
    weightSum += weight;
  }
  const qualityScore = weightSum === 0 ? 0 : clamp01(weightedSum / weightSum);
  return {
    rssiDbm,
    snrDb,
    sinrDb,
    linkMarginDb,
    rttMs,
    jitterMs,
    bitrateBps,
    packetLossRatio: delivery === null ? null : delivery.lossRatio,
    delivery,
    subScores,
    weights: Object.freeze({ ...weights }),
    qualityScore,
    score: Math.round(qualityScore * 1000),
    quality: qualityLabel(qualityScore),
  };
}

function statsEntries(stats) {
  if (!stats) return [];
  if (Array.isArray(stats)) return stats;
  if (typeof stats.values === 'function') return [...stats.values()];
  if (typeof stats.forEach === 'function') {
    const entries = [];
    stats.forEach((value) => entries.push(value));
    return entries;
  }
  if (typeof stats === 'object') return Object.values(stats);
  throw new TypeError('stats must be an array, map-like report, or object');
}

function selectCandidatePair(entries = []) {
  const pairs = entries.filter((entry) => entry?.type === 'candidate-pair');
  if (pairs.length === 0) return null;
  const nominated = pairs.find((entry) => entry.nominated && (entry.state === 'succeeded' || entry.state === 'in-progress'));
  if (nominated) return nominated;
  const selected = pairs.find((entry) => entry.selected || entry.state === 'succeeded');
  if (selected) return selected;
  return pairs[0];
}

export function webrtcStatsSignalReport(stats, options = {}) {
  const entries = statsEntries(stats);
  const inbound = entries.filter((entry) => entry?.type === 'inbound-rtp');
  const remoteInbound = entries.filter((entry) => entry?.type === 'remote-inbound-rtp');
  let packetsReceived = 0;
  let packetsLost = 0;
  let jitterWeightedSumMs = 0;
  let jitterWeight = 0;
  let maxJitterMs = 0;

  for (const entry of inbound) {
    const received = Math.max(0, Number(entry.packetsReceived ?? 0));
    const lost = Math.max(0, Number(entry.packetsLost ?? 0));
    const jitterMs = Math.max(0, Number(entry.jitter ?? 0) * 1000);
    packetsReceived += received;
    packetsLost += lost;
    maxJitterMs = Math.max(maxJitterMs, jitterMs);
    const weight = Math.max(1, received + lost);
    jitterWeightedSumMs += jitterMs * weight;
    jitterWeight += weight;
  }

  for (const entry of remoteInbound) {
    if (entry.packetsLost !== undefined) packetsLost += Math.max(0, Number(entry.packetsLost));
    if (entry.roundTripTime !== undefined && options.rttMs === undefined) {
      options = { ...options, rttMs: Math.max(0, Number(entry.roundTripTime) * 1000) };
    }
  }

  const pair = selectCandidatePair(entries);
  const rttMs = options.rttMs !== undefined
    ? optionalNonnegative(options.rttMs, 'rttMs', 0)
    : (pair?.currentRoundTripTime === undefined ? null : Math.max(0, Number(pair.currentRoundTripTime) * 1000));
  const availableOutgoingBitrateBps = pair?.availableOutgoingBitrate === undefined ? null : Math.max(0, Number(pair.availableOutgoingBitrate));
  const availableIncomingBitrateBps = pair?.availableIncomingBitrate === undefined ? null : Math.max(0, Number(pair.availableIncomingBitrate));
  const jitterMs = inbound.length === 0 ? null : (options.jitterMode === 'mean' ? jitterWeightedSumMs / jitterWeight : maxJitterMs);
  const report = signalQualityReport({
    ...options,
    packetsReceived,
    packetsLost,
    rttMs,
    jitterMs,
    availableOutgoingBitrateBps,
    availableIncomingBitrateBps,
  });
  return {
    ...report,
    statsCount: entries.length,
    inboundCount: inbound.length,
    remoteInboundCount: remoteInbound.length,
    candidatePairId: pair?.id ?? null,
    packetsReceived,
    packetsLost,
    jitterMs,
    maxJitterMs,
    meanJitterMs: jitterWeight === 0 ? 0 : jitterWeightedSumMs / jitterWeight,
    availableOutgoingBitrateBps,
    availableIncomingBitrateBps,
  };
}

export function signalQualityTrendReport(samples = [], options = {}) {
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
  const scores = samples.map((sample, index) => {
    if (typeof sample === 'number') return clamp01(finiteNumber(sample, `samples[${index}]`));
    if (sample?.qualityScore !== undefined) return clamp01(finiteNumber(sample.qualityScore, `samples[${index}].qualityScore`));
    return signalQualityReport(sample).qualityScore;
  });
  const count = scores.length;
  const firstScore = count === 0 ? 0 : scores[0];
  const lastScore = count === 0 ? 0 : scores[count - 1];
  const meanScore = count === 0 ? 0 : scores.reduce((sum, score) => sum + score, 0) / count;
  const minScore = count === 0 ? 0 : Math.min(...scores);
  const maxScore = count === 0 ? 0 : Math.max(...scores);
  const delta = lastScore - firstScore;
  const stableDelta = nonnegativeNumber(options.stableDelta ?? 0.03, 'stableDelta');
  const trend = Math.abs(delta) <= stableDelta ? 'stable' : (delta > 0 ? 'improving' : 'degrading');
  return {
    count,
    scores: Object.freeze(scores),
    firstScore,
    lastScore,
    meanScore,
    minScore,
    maxScore,
    delta,
    trend,
    quality: qualityLabel(lastScore),
  };
}

export default Object.freeze({
  SIGNAL_QUALITY_DEFAULT_MAX_JITTER_MS,
  SIGNAL_QUALITY_DEFAULT_MAX_LOSS_RATIO,
  SIGNAL_QUALITY_DEFAULT_MAX_RTT_MS,
  SIGNAL_QUALITY_DEFAULT_TARGET_JITTER_MS,
  SIGNAL_QUALITY_DEFAULT_TARGET_RTT_MS,
  SIGNAL_QUALITY_DEFAULT_WEIGHTS,
  signalBitrateQualityScore,
  signalDeliveryQualityScore,
  signalJitterQualityScore,
  signalLatencyQualityScore,
  signalLevelQualityScore,
  signalQualityReport,
  signalQualityTrendReport,
  webrtcStatsSignalReport,
});
