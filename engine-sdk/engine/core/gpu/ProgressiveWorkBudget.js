// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function nonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/**
 * Plans optional refinement from measured spare GPU time. It never delays the
 * host frame, submits work, or changes correctness-critical work.
 */
export function planProgressiveWorkBudget(options = {}) {
  const targetFrameMs = Math.max(0.1, nonNegative(options.targetFrameMs, 1000 / 60));
  const reserveMs = Math.min(targetFrameMs, nonNegative(options.reserveMs, Math.max(0.5, targetFrameMs * 0.12)));
  const gpuP95Ms = nonNegative(options.gpuP95Ms);
  const cpuP95Ms = nonNegative(options.cpuP95Ms);
  const queueDepth = Math.floor(nonNegative(options.queueDepth));
  const queueCapacity = Math.max(1, Math.floor(nonNegative(options.queueCapacity, 1)));
  const timingReady = options.timingReady !== false;
  const dynamic = options.dynamic === true;
  const requestedUnits = Math.max(0, Math.floor(nonNegative(options.requestedUnits)));
  const unitCostMs = Math.max(0.01, nonNegative(options.unitCostMs, 0.25));
  const measuredWorkMs = Math.max(gpuP95Ms, cpuP95Ms);
  const queueBlocked = queueDepth >= Math.max(1, queueCapacity - 1);
  const availableMs = timingReady && !queueBlocked
    ? Math.max(0, targetFrameMs - reserveMs - measuredWorkMs)
    : 0;
  const dynamicScale = dynamic ? 0.25 : 1;
  const admittedUnits = Math.min(requestedUnits, Math.floor((availableMs * dynamicScale) / unitCostMs));
  const reason = !timingReady
    ? 'timing-warming'
    : queueBlocked
      ? 'queue-pressure'
      : availableMs < unitCostMs
        ? 'no-spare-budget'
        : dynamic
          ? 'dynamic-scene-quarter-budget'
          : 'measured-spare-budget';
  return Object.freeze({
    targetFrameMs,
    reserveMs,
    measuredWorkMs,
    availableMs,
    unitCostMs,
    requestedUnits,
    admittedUnits,
    queueBlocked,
    timingReady,
    dynamic,
    reason,
  });
}

