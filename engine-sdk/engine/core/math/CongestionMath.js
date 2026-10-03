// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// CongestionMath.js - reusable congestion-window, pacing, Reno, QUIC, and CUBIC report helpers.

export const CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES = 1200;
export const CONGESTION_RENO_DECREASE_FACTOR = 0.5;
export const CONGESTION_RENO_MIN_WINDOW_SEGMENTS = 2;
export const CONGESTION_QUIC_INITIAL_PACKET_COUNT = 10;
export const CONGESTION_QUIC_MIN_WINDOW_PACKET_COUNT = 2;
export const CONGESTION_QUIC_INITIAL_WINDOW_MIN_BYTES = 14720;
export const CONGESTION_PERSISTENT_THRESHOLD = 3;
export const CONGESTION_DEFAULT_CLOCK_GRANULARITY_MS = 1;
export const CONGESTION_CUBIC_BETA = 0.7;
export const CONGESTION_CUBIC_C = 0.4;

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

function optionalPositive(value, name, fallback = null) {
  return value === undefined || value === null ? fallback : positiveNumber(value, name);
}

function boundedRatio(value, name) {
  const ratio = positiveNumber(value, name);
  if (ratio > 1) {
    throw new RangeError(`${name} must be less than or equal to 1`);
  }
  return ratio;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function bytesToSegments(bytes, segmentBytes) {
  return nonnegativeNumber(bytes, 'bytes') / positiveNumber(segmentBytes, 'segmentBytes');
}

function segmentsToBytes(segments, segmentBytes) {
  return nonnegativeNumber(segments, 'segments') * positiveNumber(segmentBytes, 'segmentBytes');
}

export function bandwidthDelayProductBytes(options = {}) {
  const bandwidthBps = nonnegativeNumber(options.bandwidthBps ?? options.bitrateBps ?? 0, 'bandwidthBps');
  const rttMs = nonnegativeNumber(options.rttMs ?? options.roundTripTimeMs ?? 0, 'rttMs');
  return (bandwidthBps * rttMs) / 8000;
}

export function congestionWindowLimitReport(options = {}) {
  const congestionWindowBytes = nonnegativeNumber(options.congestionWindowBytes ?? options.cwndBytes ?? 0, 'congestionWindowBytes');
  const receiveWindowBytes = optionalPositive(options.receiveWindowBytes ?? options.rwndBytes, 'receiveWindowBytes', null);
  const bytesInFlight = optionalNonnegative(options.bytesInFlight, 'bytesInFlight', 0);
  const maxDatagramBytes = positiveNumber(options.maxDatagramBytes ?? options.smssBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES, 'maxDatagramBytes');
  const effectiveWindowBytes = receiveWindowBytes === null
    ? congestionWindowBytes
    : Math.min(congestionWindowBytes, receiveWindowBytes);
  const availableBytes = Math.max(0, effectiveWindowBytes - bytesInFlight);
  return {
    congestionWindowBytes,
    receiveWindowBytes,
    effectiveWindowBytes,
    bytesInFlight,
    availableBytes,
    availableDatagrams: Math.floor(availableBytes / maxDatagramBytes),
    utilizationRatio: effectiveWindowBytes === 0 ? 0 : clamp01(bytesInFlight / effectiveWindowBytes),
    limitedBy: receiveWindowBytes !== null && receiveWindowBytes < congestionWindowBytes ? 'receive-window' : 'congestion-window',
    canSend: availableBytes >= maxDatagramBytes,
  };
}

export function quicInitialCongestionWindowBytes(maxDatagramBytes = CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES) {
  const datagramBytes = positiveNumber(maxDatagramBytes, 'maxDatagramBytes');
  return Math.min(
    CONGESTION_QUIC_INITIAL_PACKET_COUNT * datagramBytes,
    Math.max(2 * datagramBytes, CONGESTION_QUIC_INITIAL_WINDOW_MIN_BYTES),
  );
}

export function quicMinimumCongestionWindowBytes(maxDatagramBytes = CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES) {
  return CONGESTION_QUIC_MIN_WINDOW_PACKET_COUNT * positiveNumber(maxDatagramBytes, 'maxDatagramBytes');
}

export function renoSlowStartThresholdBytes(options = {}) {
  const flightSizeBytes = nonnegativeNumber(options.flightSizeBytes ?? options.bytesInFlight ?? 0, 'flightSizeBytes');
  const smssBytes = positiveNumber(options.smssBytes ?? options.maxDatagramBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES, 'smssBytes');
  return Math.max(flightSizeBytes * CONGESTION_RENO_DECREASE_FACTOR, CONGESTION_RENO_MIN_WINDOW_SEGMENTS * smssBytes);
}

export function renoSlowStartIncreaseBytes(acknowledgedBytes, smssBytes = CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES) {
  return Math.min(
    nonnegativeNumber(acknowledgedBytes, 'acknowledgedBytes'),
    positiveNumber(smssBytes, 'smssBytes'),
  );
}

export function renoCongestionAvoidanceIncreaseBytes(congestionWindowBytes, smssBytes = CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES) {
  const windowBytes = positiveNumber(congestionWindowBytes, 'congestionWindowBytes');
  const segmentBytes = positiveNumber(smssBytes, 'smssBytes');
  return Math.max(1, (segmentBytes * segmentBytes) / windowBytes);
}

export function renoAckWindowUpdateReport(options = {}) {
  const congestionWindowBytes = positiveNumber(options.congestionWindowBytes ?? options.cwndBytes, 'congestionWindowBytes');
  const slowStartThresholdBytes = optionalPositive(options.slowStartThresholdBytes ?? options.ssthreshBytes, 'slowStartThresholdBytes', Number.MAX_SAFE_INTEGER);
  const acknowledgedBytes = nonnegativeNumber(options.acknowledgedBytes ?? options.bytesAcked ?? 0, 'acknowledgedBytes');
  const smssBytes = positiveNumber(options.smssBytes ?? options.maxDatagramBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES, 'smssBytes');
  const phase = congestionWindowBytes < slowStartThresholdBytes ? 'slow-start' : 'congestion-avoidance';
  const increaseBytes = phase === 'slow-start'
    ? renoSlowStartIncreaseBytes(acknowledgedBytes, smssBytes)
    : renoCongestionAvoidanceIncreaseBytes(congestionWindowBytes, smssBytes);
  return {
    phase,
    congestionWindowBytes,
    slowStartThresholdBytes,
    acknowledgedBytes,
    smssBytes,
    increaseBytes,
    nextCongestionWindowBytes: congestionWindowBytes + increaseBytes,
  };
}

export function congestionLossResponseReport(options = {}) {
  const congestionWindowBytes = positiveNumber(options.congestionWindowBytes ?? options.cwndBytes, 'congestionWindowBytes');
  const flightSizeBytes = nonnegativeNumber(options.flightSizeBytes ?? options.bytesInFlight ?? congestionWindowBytes, 'flightSizeBytes');
  const smssBytes = positiveNumber(options.smssBytes ?? options.maxDatagramBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES, 'smssBytes');
  const decreaseFactor = boundedRatio(options.decreaseFactor ?? options.beta ?? CONGESTION_RENO_DECREASE_FACTOR, 'decreaseFactor');
  const eventType = options.eventType ?? 'loss';
  const minimumWindowBytes = positiveNumber(options.minimumWindowBytes ?? (CONGESTION_RENO_MIN_WINDOW_SEGMENTS * smssBytes), 'minimumWindowBytes');
  const slowStartThresholdBytes = Math.max(flightSizeBytes * decreaseFactor, minimumWindowBytes);
  const persistent = eventType === 'timeout' || eventType === 'persistent-congestion';
  const nextCongestionWindowBytes = persistent
    ? minimumWindowBytes
    : Math.max(slowStartThresholdBytes, minimumWindowBytes);
  return {
    eventType,
    congestionWindowBytes,
    flightSizeBytes,
    smssBytes,
    decreaseFactor,
    minimumWindowBytes,
    slowStartThresholdBytes,
    nextCongestionWindowBytes,
    reductionBytes: Math.max(0, congestionWindowBytes - nextCongestionWindowBytes),
    persistent,
  };
}

export function persistentCongestionDurationMs(options = {}) {
  const smoothedRttMs = nonnegativeNumber(options.smoothedRttMs ?? options.srttMs ?? 0, 'smoothedRttMs');
  const rttVariationMs = nonnegativeNumber(options.rttVariationMs ?? options.rttvarMs ?? 0, 'rttVariationMs');
  const maxAckDelayMs = optionalNonnegative(options.maxAckDelayMs, 'maxAckDelayMs', 0);
  const clockGranularityMs = positiveNumber(options.clockGranularityMs ?? CONGESTION_DEFAULT_CLOCK_GRANULARITY_MS, 'clockGranularityMs');
  const threshold = positiveNumber(options.persistentCongestionThreshold ?? CONGESTION_PERSISTENT_THRESHOLD, 'persistentCongestionThreshold');
  const baseDurationMs = smoothedRttMs + Math.max(4 * rttVariationMs, clockGranularityMs) + maxAckDelayMs;
  return baseDurationMs * threshold;
}

export function persistentCongestionReport(options = {}) {
  const oldestLostSentTimeMs = finiteNumber(options.oldestLostSentTimeMs, 'oldestLostSentTimeMs');
  const newestLostSentTimeMs = finiteNumber(options.newestLostSentTimeMs, 'newestLostSentTimeMs');
  if (newestLostSentTimeMs < oldestLostSentTimeMs) {
    throw new RangeError('newestLostSentTimeMs must be greater than or equal to oldestLostSentTimeMs');
  }
  const lostSpanMs = newestLostSentTimeMs - oldestLostSentTimeMs;
  const thresholdDurationMs = persistentCongestionDurationMs(options);
  const hasPriorRttSample = options.hasPriorRttSample !== false;
  const allBetweenLost = options.allBetweenLost !== false && options.anyAckedBetween !== true;
  return {
    oldestLostSentTimeMs,
    newestLostSentTimeMs,
    lostSpanMs,
    thresholdDurationMs,
    hasPriorRttSample,
    allBetweenLost,
    persistent: hasPriorRttSample && allBetweenLost && lostSpanMs > thresholdDurationMs,
  };
}

export function congestionPacingRateBps(options = {}) {
  const congestionWindowBytes = nonnegativeNumber(options.congestionWindowBytes ?? options.cwndBytes ?? 0, 'congestionWindowBytes');
  const rttMs = positiveNumber(options.rttMs ?? options.smoothedRttMs ?? options.srttMs, 'rttMs');
  const pacingGain = positiveNumber(options.pacingGain ?? 1, 'pacingGain');
  return (congestionWindowBytes * 8 * 1000 * pacingGain) / rttMs;
}

export function cubicKSeconds(options = {}) {
  const wMaxSegments = nonnegativeNumber(options.wMaxSegments ?? bytesToSegments(options.wMaxBytes ?? 0, options.smssBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES), 'wMaxSegments');
  const cwndEpochSegments = nonnegativeNumber(options.cwndEpochSegments ?? bytesToSegments(options.cwndEpochBytes ?? 0, options.smssBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES), 'cwndEpochSegments');
  const c = positiveNumber(options.c ?? options.cubicC ?? CONGESTION_CUBIC_C, 'c');
  return Math.cbrt(Math.max(0, wMaxSegments - cwndEpochSegments) / c);
}

export function cubicWindowSegments(options = {}) {
  const elapsedSeconds = nonnegativeNumber(options.elapsedSeconds ?? ((options.elapsedMs ?? 0) / 1000), 'elapsedSeconds');
  const wMaxSegments = nonnegativeNumber(options.wMaxSegments ?? bytesToSegments(options.wMaxBytes ?? 0, options.smssBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES), 'wMaxSegments');
  const cwndEpochSegments = nonnegativeNumber(options.cwndEpochSegments ?? bytesToSegments(options.cwndEpochBytes ?? 0, options.smssBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES), 'cwndEpochSegments');
  const c = positiveNumber(options.c ?? options.cubicC ?? CONGESTION_CUBIC_C, 'c');
  const kSeconds = options.kSeconds === undefined
    ? cubicKSeconds({ wMaxSegments, cwndEpochSegments, c })
    : nonnegativeNumber(options.kSeconds, 'kSeconds');
  return c * ((elapsedSeconds - kSeconds) ** 3) + wMaxSegments;
}

export function cubicRenoFriendlyAlpha(beta = CONGESTION_CUBIC_BETA) {
  const decreaseFactor = boundedRatio(beta, 'beta');
  return 3 * (1 - decreaseFactor) / (1 + decreaseFactor);
}

export function cubicRenoEstimateReport(options = {}) {
  const wEstSegments = nonnegativeNumber(options.wEstSegments, 'wEstSegments');
  const segmentsAcked = nonnegativeNumber(options.segmentsAcked ?? 0, 'segmentsAcked');
  const congestionWindowSegments = positiveNumber(options.congestionWindowSegments ?? options.cwndSegments, 'congestionWindowSegments');
  const beta = boundedRatio(options.beta ?? CONGESTION_CUBIC_BETA, 'beta');
  const cwndPriorSegments = optionalPositive(options.cwndPriorSegments, 'cwndPriorSegments', null);
  const alpha = cwndPriorSegments !== null && wEstSegments >= cwndPriorSegments
    ? 1
    : cubicRenoFriendlyAlpha(beta);
  const increaseSegments = alpha * segmentsAcked / congestionWindowSegments;
  return {
    wEstSegments,
    segmentsAcked,
    congestionWindowSegments,
    cwndPriorSegments,
    beta,
    alpha,
    increaseSegments,
    nextWEstSegments: wEstSegments + increaseSegments,
  };
}

export function cubicTargetWindowReport(options = {}) {
  const smssBytes = positiveNumber(options.smssBytes ?? options.maxDatagramBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES, 'smssBytes');
  const congestionWindowBytes = positiveNumber(options.congestionWindowBytes ?? options.cwndBytes, 'congestionWindowBytes');
  const congestionWindowSegments = bytesToSegments(congestionWindowBytes, smssBytes);
  const rttMs = nonnegativeNumber(options.rttMs ?? options.smoothedRttMs ?? 0, 'rttMs');
  const elapsedMs = nonnegativeNumber(options.elapsedMs ?? 0, 'elapsedMs');
  const wMaxSegments = nonnegativeNumber(options.wMaxSegments ?? bytesToSegments(options.wMaxBytes ?? congestionWindowBytes, smssBytes), 'wMaxSegments');
  const cwndEpochSegments = nonnegativeNumber(options.cwndEpochSegments ?? bytesToSegments(options.cwndEpochBytes ?? congestionWindowBytes, smssBytes), 'cwndEpochSegments');
  const c = positiveNumber(options.c ?? options.cubicC ?? CONGESTION_CUBIC_C, 'c');
  const targetSeconds = (elapsedMs + rttMs) / 1000;
  const rawTargetSegments = cubicWindowSegments({
    elapsedSeconds: targetSeconds,
    wMaxSegments,
    cwndEpochSegments,
    c,
  });
  const boundedTargetSegments = Math.min(
    congestionWindowSegments * 1.5,
    Math.max(congestionWindowSegments, rawTargetSegments),
  );
  const increaseSegments = Math.max(0, boundedTargetSegments - congestionWindowSegments);
  const region = congestionWindowSegments < wMaxSegments ? 'concave' : 'convex';
  return {
    congestionWindowBytes,
    smssBytes,
    congestionWindowSegments,
    rttMs,
    elapsedMs,
    wMaxSegments,
    cwndEpochSegments,
    c,
    kSeconds: cubicKSeconds({ wMaxSegments, cwndEpochSegments, c }),
    rawTargetSegments,
    boundedTargetSegments,
    targetBytes: segmentsToBytes(boundedTargetSegments, smssBytes),
    increaseSegments,
    increaseBytes: segmentsToBytes(increaseSegments, smssBytes),
    perAckIncreaseSegments: congestionWindowSegments === 0 ? 0 : increaseSegments / congestionWindowSegments,
    region,
  };
}

export function cubicLossResponseReport(options = {}) {
  const smssBytes = positiveNumber(options.smssBytes ?? options.maxDatagramBytes ?? CONGESTION_DEFAULT_MAX_DATAGRAM_BYTES, 'smssBytes');
  const congestionWindowBytes = positiveNumber(options.congestionWindowBytes ?? options.cwndBytes, 'congestionWindowBytes');
  const flightSizeBytes = nonnegativeNumber(options.flightSizeBytes ?? options.bytesInFlight ?? congestionWindowBytes, 'flightSizeBytes');
  const beta = boundedRatio(options.beta ?? CONGESTION_CUBIC_BETA, 'beta');
  const eventType = options.eventType ?? 'loss';
  const minimumSegments = eventType === 'ecn' ? 1 : CONGESTION_RENO_MIN_WINDOW_SEGMENTS;
  const minimumWindowBytes = minimumSegments * smssBytes;
  const ssthreshBytes = Math.max(flightSizeBytes * beta, minimumWindowBytes);
  const previousWMaxBytes = optionalPositive(options.wMaxBytes, 'wMaxBytes', null);
  const fastConvergence = options.fastConvergence === true;
  const wMaxBytes = fastConvergence && previousWMaxBytes !== null && congestionWindowBytes < previousWMaxBytes
    ? congestionWindowBytes * ((1 + beta) / 2)
    : congestionWindowBytes;
  return {
    eventType,
    congestionWindowBytes,
    flightSizeBytes,
    smssBytes,
    beta,
    fastConvergence,
    previousWMaxBytes,
    wMaxBytes,
    ssthreshBytes,
    nextCongestionWindowBytes: Math.max(ssthreshBytes, minimumWindowBytes),
    cwndPriorBytes: congestionWindowBytes,
    minimumWindowBytes,
  };
}
