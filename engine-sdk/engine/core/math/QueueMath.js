// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// QueueMath.js - reusable queue depth, delay, bucket, share, ramp, and backpressure helpers.

export const QUEUE_DEFAULT_TARGET_DELAY_MS = 5;
export const QUEUE_DEFAULT_INTERVAL_MS = 100;
export const QUEUE_BACKPRESSURE_LOW = 0.25;
export const QUEUE_BACKPRESSURE_MEDIUM = 0.5;
export const QUEUE_BACKPRESSURE_HIGH = 0.75;

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

function labelForBackpressure(score) {
  if (score >= QUEUE_BACKPRESSURE_HIGH) return 'critical';
  if (score >= QUEUE_BACKPRESSURE_MEDIUM) return 'high';
  if (score >= QUEUE_BACKPRESSURE_LOW) return 'medium';
  return 'low';
}

export function queueDepthReport(options = {}) {
  const queuedBytes = optionalNonnegative(options.queuedBytes, 'queuedBytes', 0);
  const queuedPackets = optionalNonnegative(options.queuedPackets, 'queuedPackets', 0);
  const capacityBytes = options.capacityBytes === undefined ? null : positiveNumber(options.capacityBytes, 'capacityBytes');
  const capacityPackets = options.capacityPackets === undefined ? null : positiveNumber(options.capacityPackets, 'capacityPackets');
  const byteOccupancyRatio = capacityBytes === null ? null : clamp01(queuedBytes / capacityBytes);
  const packetOccupancyRatio = capacityPackets === null ? null : clamp01(queuedPackets / capacityPackets);
  const occupancyInputs = [byteOccupancyRatio, packetOccupancyRatio].filter((value) => value !== null);
  const occupancyRatio = occupancyInputs.length === 0 ? 0 : Math.max(...occupancyInputs);
  return {
    queuedBytes,
    queuedPackets,
    capacityBytes,
    capacityPackets,
    byteOccupancyRatio,
    packetOccupancyRatio,
    occupancyRatio,
    availableBytes: capacityBytes === null ? null : Math.max(0, capacityBytes - queuedBytes),
    availablePackets: capacityPackets === null ? null : Math.max(0, capacityPackets - queuedPackets),
    full: occupancyRatio >= 1,
    empty: queuedBytes === 0 && queuedPackets === 0,
  };
}

export function queueDrainTimeMs(options = {}) {
  const queuedBytes = optionalNonnegative(options.queuedBytes, 'queuedBytes', 0);
  const queuedPackets = optionalNonnegative(options.queuedPackets, 'queuedPackets', 0);
  const serviceRateBps = options.serviceRateBps === undefined ? null : positiveNumber(options.serviceRateBps, 'serviceRateBps');
  const serviceRatePacketsPerSecond = options.serviceRatePacketsPerSecond === undefined
    ? null
    : positiveNumber(options.serviceRatePacketsPerSecond, 'serviceRatePacketsPerSecond');
  const byteDelayMs = serviceRateBps === null ? 0 : (queuedBytes * 8 * 1000) / serviceRateBps;
  const packetDelayMs = serviceRatePacketsPerSecond === null ? 0 : (queuedPackets * 1000) / serviceRatePacketsPerSecond;
  return Math.max(byteDelayMs, packetDelayMs);
}

export function queueDelayReport(options = {}) {
  const queuedBytes = optionalNonnegative(options.queuedBytes, 'queuedBytes', 0);
  const queuedPackets = optionalNonnegative(options.queuedPackets, 'queuedPackets', 0);
  const targetDelayMs = positiveNumber(options.targetDelayMs ?? QUEUE_DEFAULT_TARGET_DELAY_MS, 'targetDelayMs');
  const intervalMs = positiveNumber(options.intervalMs ?? QUEUE_DEFAULT_INTERVAL_MS, 'intervalMs');
  const delayMs = queueDrainTimeMs({
    queuedBytes,
    queuedPackets,
    serviceRateBps: options.serviceRateBps,
    serviceRatePacketsPerSecond: options.serviceRatePacketsPerSecond,
  });
  return {
    queuedBytes,
    queuedPackets,
    delayMs,
    targetDelayMs,
    intervalMs,
    targetExceeded: delayMs > targetDelayMs,
    intervalExceeded: delayMs > intervalMs,
    delayRatio: targetDelayMs === 0 ? 0 : delayMs / targetDelayMs,
    standingQueue: delayMs > targetDelayMs && delayMs >= intervalMs,
  };
}

export function queueDrainReport(options = {}) {
  const queuedBytes = optionalNonnegative(options.queuedBytes, 'queuedBytes', 0);
  const queuedPackets = optionalNonnegative(options.queuedPackets, 'queuedPackets', 0);
  const elapsedMs = nonnegativeNumber(options.elapsedMs ?? 0, 'elapsedMs');
  const serviceRateBps = options.serviceRateBps === undefined ? null : positiveNumber(options.serviceRateBps, 'serviceRateBps');
  const serviceRatePacketsPerSecond = options.serviceRatePacketsPerSecond === undefined
    ? null
    : positiveNumber(options.serviceRatePacketsPerSecond, 'serviceRatePacketsPerSecond');
  const drainableBytes = serviceRateBps === null ? 0 : (serviceRateBps * elapsedMs) / 8000;
  const drainablePackets = serviceRatePacketsPerSecond === null ? 0 : (serviceRatePacketsPerSecond * elapsedMs) / 1000;
  const drainedBytes = Math.min(queuedBytes, drainableBytes);
  const drainedPackets = Math.min(queuedPackets, drainablePackets);
  return {
    queuedBytes,
    queuedPackets,
    elapsedMs,
    drainedBytes,
    drainedPackets,
    remainingBytes: Math.max(0, queuedBytes - drainedBytes),
    remainingPackets: Math.max(0, queuedPackets - drainedPackets),
    serviceRateBps,
    serviceRatePacketsPerSecond,
  };
}

export function tokenBucketRefill(tokens, options = {}) {
  const currentTokens = nonnegativeNumber(tokens, 'tokens');
  const capacity = positiveNumber(options.capacity ?? options.burstSize ?? currentTokens, 'capacity');
  const refillRatePerSecond = nonnegativeNumber(options.refillRatePerSecond ?? options.ratePerSecond ?? 0, 'refillRatePerSecond');
  const elapsedMs = nonnegativeNumber(options.elapsedMs ?? 0, 'elapsedMs');
  const addedTokens = (refillRatePerSecond * elapsedMs) / 1000;
  const tokensAfterRefill = Math.min(capacity, currentTokens + addedTokens);
  return {
    tokensBefore: currentTokens,
    tokensAfterRefill,
    addedTokens,
    capacity,
    refillRatePerSecond,
    elapsedMs,
  };
}

export function tokenBucketConsume(options = {}) {
  const cost = positiveNumber(options.cost ?? options.packetBytes ?? 1, 'cost');
  const refill = tokenBucketRefill(options.tokens ?? options.availableTokens ?? 0, options);
  const conforming = refill.tokensAfterRefill >= cost;
  const tokensAfter = conforming ? refill.tokensAfterRefill - cost : refill.tokensAfterRefill;
  const deficit = conforming ? 0 : cost - refill.tokensAfterRefill;
  return {
    ...refill,
    cost,
    conforming,
    tokensAfter,
    deficit,
    retryAfterMs: deficit === 0 || refill.refillRatePerSecond === 0
      ? 0
      : (deficit / refill.refillRatePerSecond) * 1000,
  };
}

export function singleRateThreeColorMarkerReport(options = {}) {
  const packetBytes = positiveNumber(options.packetBytes, 'packetBytes');
  const committedBurstBytes = positiveNumber(options.committedBurstBytes ?? options.cbs, 'committedBurstBytes');
  const excessBurstBytes = nonnegativeNumber(options.excessBurstBytes ?? options.ebs ?? 0, 'excessBurstBytes');
  const committedRateBytesPerSecond = nonnegativeNumber(options.committedRateBytesPerSecond ?? options.cirBytesPerSecond ?? 0, 'committedRateBytesPerSecond');
  const elapsedMs = nonnegativeNumber(options.elapsedMs ?? 0, 'elapsedMs');
  const committedBefore = nonnegativeNumber(options.committedTokens ?? committedBurstBytes, 'committedTokens');
  const excessBefore = nonnegativeNumber(options.excessTokens ?? excessBurstBytes, 'excessTokens');
  const committedAdded = Math.min(committedBurstBytes - Math.min(committedBefore, committedBurstBytes), (committedRateBytesPerSecond * elapsedMs) / 1000);
  const committedTokens = Math.min(committedBurstBytes, committedBefore + committedAdded);
  const excessAdded = Math.min(
    excessBurstBytes - Math.min(excessBefore, excessBurstBytes),
    Math.max(0, (committedRateBytesPerSecond * elapsedMs) / 1000 - committedAdded),
  );
  const excessTokens = Math.min(excessBurstBytes, excessBefore + excessAdded);
  let color = 'red';
  let committedTokensAfter = committedTokens;
  let excessTokensAfter = excessTokens;
  if (committedTokens >= packetBytes) {
    color = 'green';
    committedTokensAfter -= packetBytes;
  } else if (excessTokens >= packetBytes) {
    color = 'yellow';
    excessTokensAfter -= packetBytes;
  }
  return {
    color,
    packetBytes,
    committedBurstBytes,
    excessBurstBytes,
    committedRateBytesPerSecond,
    elapsedMs,
    committedTokens,
    excessTokens,
    committedTokensAfter,
    excessTokensAfter,
    conforming: color !== 'red',
  };
}

export function leakyBucketReport(options = {}) {
  const level = nonnegativeNumber(options.level ?? options.bucketLevel ?? 0, 'level');
  const capacity = positiveNumber(options.capacity, 'capacity');
  const leakRatePerSecond = nonnegativeNumber(options.leakRatePerSecond ?? options.drainRatePerSecond ?? 0, 'leakRatePerSecond');
  const elapsedMs = nonnegativeNumber(options.elapsedMs ?? 0, 'elapsedMs');
  const arrivalAmount = nonnegativeNumber(options.arrivalAmount ?? options.cost ?? 0, 'arrivalAmount');
  const leakedAmount = Math.min(level, (leakRatePerSecond * elapsedMs) / 1000);
  const levelAfterLeak = Math.max(0, level - leakedAmount);
  const levelAfterArrival = levelAfterLeak + arrivalAmount;
  const conforming = levelAfterArrival <= capacity;
  return {
    level,
    capacity,
    leakRatePerSecond,
    elapsedMs,
    arrivalAmount,
    leakedAmount,
    levelAfterLeak,
    levelAfterArrival: conforming ? levelAfterArrival : levelAfterLeak,
    overflowAmount: conforming ? 0 : levelAfterArrival - capacity,
    conforming,
    retryAfterMs: conforming || leakRatePerSecond === 0
      ? 0
      : ((levelAfterArrival - capacity) / leakRatePerSecond) * 1000,
  };
}

export function queueBudgetReport(options = {}) {
  const arrivalRateBps = nonnegativeNumber(options.arrivalRateBps ?? 0, 'arrivalRateBps');
  const serviceRateBps = positiveNumber(options.serviceRateBps, 'serviceRateBps');
  const queuedBytes = optionalNonnegative(options.queuedBytes, 'queuedBytes', 0);
  const capacityBytes = options.capacityBytes === undefined ? null : positiveNumber(options.capacityBytes, 'capacityBytes');
  const targetDelayMs = positiveNumber(options.targetDelayMs ?? QUEUE_DEFAULT_TARGET_DELAY_MS, 'targetDelayMs');
  const utilizationRatio = arrivalRateBps / serviceRateBps;
  const delayMs = queueDrainTimeMs({ queuedBytes, serviceRateBps });
  const targetQueueBytes = (serviceRateBps * targetDelayMs) / 8000;
  return {
    arrivalRateBps,
    serviceRateBps,
    queuedBytes,
    capacityBytes,
    targetDelayMs,
    utilizationRatio,
    stable: utilizationRatio <= 1,
    overloadBps: Math.max(0, arrivalRateBps - serviceRateBps),
    targetQueueBytes,
    queueDelayMs: delayMs,
    targetExceeded: delayMs > targetDelayMs,
    headroomBytes: capacityBytes === null ? null : Math.max(0, capacityBytes - queuedBytes),
  };
}

export function fairShareRateReport(options = {}) {
  const capacityBps = nonnegativeNumber(options.capacityBps ?? 0, 'capacityBps');
  const flows = Array.from(options.flows ?? [], (flow, index) => {
    const id = flow.id ?? flow.peerId ?? flow.name ?? index;
    const weight = positiveNumber(flow.weight ?? 1, `flows[${index}].weight`);
    const demandBps = flow.demandBps === undefined ? null : nonnegativeNumber(flow.demandBps, `flows[${index}].demandBps`);
    return { id, weight, demandBps };
  });
  const totalWeight = flows.reduce((sum, flow) => sum + flow.weight, 0);
  const shares = flows.map((flow) => {
    const fairRateBps = totalWeight === 0 ? 0 : (capacityBps * flow.weight) / totalWeight;
    const allocatedBps = flow.demandBps === null ? fairRateBps : Math.min(fairRateBps, flow.demandBps);
    return Object.freeze({
      ...flow,
      fairRateBps,
      allocatedBps,
      unmetDemandBps: flow.demandBps === null ? 0 : Math.max(0, flow.demandBps - allocatedBps),
    });
  });
  return {
    capacityBps,
    flowCount: flows.length,
    totalWeight,
    allocatedBps: shares.reduce((sum, share) => sum + share.allocatedBps, 0),
    unusedBps: Math.max(0, capacityBps - shares.reduce((sum, share) => sum + share.allocatedBps, 0)),
    shares: Object.freeze(shares),
  };
}

export function rateRampReport(options = {}) {
  const currentRateBps = nonnegativeNumber(options.currentRateBps ?? 0, 'currentRateBps');
  const targetRateBps = nonnegativeNumber(options.targetRateBps ?? 0, 'targetRateBps');
  const elapsedMs = nonnegativeNumber(options.elapsedMs ?? 0, 'elapsedMs');
  const rampUpRateBpsPerSecond = nonnegativeNumber(options.rampUpRateBpsPerSecond ?? Number.MAX_SAFE_INTEGER, 'rampUpRateBpsPerSecond');
  const rampDownRateBpsPerSecond = nonnegativeNumber(options.rampDownRateBpsPerSecond ?? options.backoffRateBpsPerSecond ?? Number.MAX_SAFE_INTEGER, 'rampDownRateBpsPerSecond');
  const delta = targetRateBps - currentRateBps;
  const maxDelta = (delta >= 0 ? rampUpRateBpsPerSecond : rampDownRateBpsPerSecond) * elapsedMs / 1000;
  const appliedDelta = Math.sign(delta) * Math.min(Math.abs(delta), maxDelta);
  const nextRateBps = currentRateBps + appliedDelta;
  return {
    currentRateBps,
    targetRateBps,
    elapsedMs,
    rampUpRateBpsPerSecond,
    rampDownRateBpsPerSecond,
    appliedDeltaBps: appliedDelta,
    nextRateBps,
    complete: nextRateBps === targetRateBps,
  };
}

export function queueBackpressureReport(options = {}) {
  const depth = queueDepthReport(options);
  const delay = queueDelayReport(options);
  const lossRatio = clamp01(nonnegativeNumber(options.lossRatio ?? 0, 'lossRatio'));
  const retryAfterMs = optionalNonnegative(options.retryAfterMs, 'retryAfterMs', 0);
  const retryScore = clamp01(retryAfterMs / positiveNumber(options.retrySaturationMs ?? 1000, 'retrySaturationMs'));
  const delayScore = clamp01(delay.delayMs / delay.targetDelayMs);
  const occupancyScore = depth.occupancyRatio;
  const lossScore = clamp01(lossRatio / positiveNumber(options.lossSaturationRatio ?? 0.1, 'lossSaturationRatio'));
  const score = clamp01(
    (occupancyScore * 0.35) +
    (delayScore * 0.35) +
    (lossScore * 0.2) +
    (retryScore * 0.1),
  );
  return {
    score,
    level: labelForBackpressure(score),
    occupancyScore,
    delayScore,
    lossScore,
    retryScore,
    depth,
    delay,
    lossRatio,
    retryAfterMs,
    shouldBackoff: score >= QUEUE_BACKPRESSURE_MEDIUM,
    shouldDropOrDefer: score >= QUEUE_BACKPRESSURE_HIGH,
  };
}
