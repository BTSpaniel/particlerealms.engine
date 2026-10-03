// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { DisplayRefreshEstimator } from '../timing/DisplayRefreshEstimator.js';
import { planProgressiveWorkBudget } from './ProgressiveWorkBudget.js';

export const ADAPTIVE_QUALITY_TIERS = Object.freeze([
  Object.freeze({ name: 'ultra', renderScale: 1.0, maxTraceSteps: 192, maxCandidates: 96, residualMipBias: 0, mediumScale: 1.0, kernelRate: 1.0, surfaceCache: 'full', shadowLevel: 2, updateStride: 1, pathBounces: 8 }),
  Object.freeze({ name: 'high', renderScale: 0.9, maxTraceSteps: 144, maxCandidates: 64, residualMipBias: 0, mediumScale: 0.75, kernelRate: 0.75, surfaceCache: 'full', shadowLevel: 1, updateStride: 1, pathBounces: 6 }),
  Object.freeze({ name: 'balanced', renderScale: 0.75, maxTraceSteps: 96, maxCandidates: 48, residualMipBias: 1, mediumScale: 0.5, kernelRate: 0.5, surfaceCache: 'medium', shadowLevel: 1, updateStride: 2, pathBounces: 4 }),
  Object.freeze({ name: 'performance', renderScale: 0.6, maxTraceSteps: 64, maxCandidates: 32, residualMipBias: 2, mediumScale: 0.35, kernelRate: 0.35, surfaceCache: 'coarse', shadowLevel: 0, updateStride: 3, pathBounces: 2 }),
  Object.freeze({ name: 'emergency', renderScale: 0.5, maxTraceSteps: 40, maxCandidates: 16, residualMipBias: 3, mediumScale: 0.25, kernelRate: 0.25, surfaceCache: 'proxy', shadowLevel: 0, updateStride: 5, pathBounces: 1 }),
]);

const byName = new Map(ADAPTIVE_QUALITY_TIERS.map((tier, index) => [tier.name, index]));

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function optionalNonNegative(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

/**
 * Canonical engine-wide adaptive quality decision maker. It emits one immutable
 * decision per frame so downstream systems cannot independently compound
 * degradations. Correctness requirements are intentionally absent from tiers.
 */
export class AdaptiveQualityGovernor {
  constructor(options = {}) {
    const targetInput = options.targetFPS ?? 60;
    this.targetMode = options.targetMode === 'display' || targetInput === 'display' ? 'display' : 'fixed';
    const targetFPS = Number(targetInput === 'display' ? (options.initialDisplayHz ?? 60) : targetInput);
    if (!Number.isFinite(targetFPS) || targetFPS <= 0) throw new RangeError('targetFPS must be positive');
    this.targetFrameMs = Number(options.targetFrameMs ?? (1000 / targetFPS));
    if (!Number.isFinite(this.targetFrameMs) || this.targetFrameMs <= 0) {
      throw new RangeError('targetFrameMs must be positive');
    }
    this.displayRefreshEstimator = options.displayRefreshEstimator instanceof DisplayRefreshEstimator
      ? options.displayRefreshEstimator
      : new DisplayRefreshEstimator({ initialHz: targetFPS, ...(options.displayRefresh || {}) });
    this.renderBudgetMs = Number(options.renderBudgetMs ?? 6);
    this.historySize = Math.max(5, options.historySize ?? 45);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 2000);
    this.downgradeRatio = Number(options.downgradeRatio ?? 1.18);
    this.downgradeP97Ratio = Number(options.downgradeP97Ratio ?? 1.35);
    this.upgradeRatio = Number(options.upgradeRatio ?? 0.78);
    this.upgradeP97Ratio = Number(options.upgradeP97Ratio ?? 0.9);
    if (!Number.isFinite(this.downgradeRatio) || this.downgradeRatio <= 0
        || !Number.isFinite(this.downgradeP97Ratio) || this.downgradeP97Ratio <= 0
        || !Number.isFinite(this.upgradeRatio) || this.upgradeRatio <= 0
        || !Number.isFinite(this.upgradeP97Ratio) || this.upgradeP97Ratio <= 0) {
      throw new RangeError('quality percentile ratios must be positive finite numbers');
    }
    this.upgradeBackoffMs = Math.max(this.cooldownMs, Number(options.upgradeBackoffMs ?? 10000));
    this.minimumGpuSamples = Math.max(1, Math.floor(Number(options.minimumGpuSamples ?? 3)) || 3);
    this.queuePressureFrames = Math.max(1, Math.floor(Number(options.queuePressureFrames ?? 2)) || 2);
    this.mode = options.mode === 'fixed' ? 'fixed' : 'auto';
    this._tierIndex = byName.get(options.tier || options.initialTier || 'high') ?? 1;
    this._history = [];
    this._gpuHistory = [];
    this._lastChangeMs = -Infinity;
    this._changeCount = 0;
    this._residencyFrames = new Map(ADAPTIVE_QUALITY_TIERS.map((tier) => [tier.name, 0]));
    this._reason = 'initial';
    this._ema = this.targetFrameMs;
    this._lastTransitionDirection = 0;
    this._upgradeBackoffUntilMs = -Infinity;
    this._queuePressureStreak = 0;
    this._queueDowngradeStreak = 0;
    this._latestSignals = null;
    this._logger = typeof options.logger === 'function' ? options.logger : null;
  }

  recordFrame(sample = {}) {
    const displayIntervalMs = optionalNonNegative(sample.displayIntervalMs ?? sample.rafIntervalMs);
    if (this.targetMode === 'display' && displayIntervalMs !== null) {
      const display = this.displayRefreshEstimator.record(displayIntervalMs);
      if (display.ready
          && Math.abs(display.frameMs - this.targetFrameMs) / Math.max(display.frameMs, 0.001) >= 0.025) {
        this.targetFrameMs = display.frameMs;
        this._history.length = 0;
        this._gpuHistory.length = 0;
        this._ema = this.targetFrameMs;
        this._reason = 'display-refresh-changed';
        this._logger?.({
          type: 'quality-target-change',
          mode: this.targetMode,
          refreshHz: display.refreshHz,
          targetFrameMs: this.targetFrameMs,
        });
      }
    }
    const measuredCpuMs = optionalNonNegative(sample.cpuMs);
    const measuredGpuMs = optionalNonNegative(sample.gpuMs);
    const explicitTotalMs = optionalNonNegative(sample.totalMs);
    const frameMs = optionalNonNegative(sample.frameMs)
      ?? explicitTotalMs
      ?? Math.max(measuredCpuMs ?? 0, measuredGpuMs ?? 0);
    const measuredWork = [measuredCpuMs, measuredGpuMs].filter(value => value !== null);
    const totalMs = explicitTotalMs ?? (measuredWork.length > 0 ? Math.max(...measuredWork) : frameMs);
    const nowMs = Number.isFinite(sample.nowMs) ? sample.nowMs : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const passTimes = sample.passTimes && typeof sample.passTimes === 'object' ? { ...sample.passTimes } : {};
    const gpuTimingAvailable = sample.gpuTimingAvailable === true || measuredGpuMs !== null;
    const gpuSamplePending = Math.floor(finiteNonNegative(
      sample.gpuSamplePending ?? sample.gpuTimestampPending,
    ));
    const queueDepth = Math.floor(finiteNonNegative(sample.queueDepth));
    const queueCapacity = Math.max(1, Math.floor(finiteNonNegative(sample.queueCapacity, 1)));
    const queueThrottled = sample.queueThrottled === true;
    const presentationMs = optionalNonNegative(sample.presentationMs);
    const queueNearCapacity = queueDepth >= Math.max(1, queueCapacity - 1);
    const nextQueuePressureStreak = queueNearCapacity ? this._queuePressureStreak + 1 : 0;
    const queuePressureObserved = queueThrottled || queueDepth >= queueCapacity || queueNearCapacity;
    const queuePressure = queueThrottled
      || queueDepth >= queueCapacity
      || nextQueuePressureStreak >= this.queuePressureFrames;
    // Completion debt is a useful back-pressure signal, but a high-refresh
    // host can legitimately fill a small queue while still presenting faster
    // than the configured quality target. When the host supplies an actual
    // presentation interval, only use queue pressure as an immediate downgrade
    // trigger if delivered frames are also over budget. Presentation cadence
    // remains excluded from CPU/GPU work percentiles.
    const queueDowngradeCandidate = queuePressureObserved && (
      presentationMs === null
      || presentationMs / this.targetFrameMs > this.downgradeRatio
    );
    const nextQueueDowngradeStreak = queueDowngradeCandidate
      ? this._queueDowngradeStreak + 1
      : 0;
    const queuePressureDowngrade = nextQueueDowngradeStreak >= this.queuePressureFrames;
    const queueCompletionWallMs = optionalNonNegative(sample.queueCompletionWallMs);
    const timingSource = explicitTotalMs !== null && optionalNonNegative(sample.frameMs) === null
      ? 'explicit-total'
      : measuredGpuMs !== null
        ? (measuredCpuMs !== null ? 'cpu-and-gpu-timestamp' : 'gpu-timestamp')
        : (measuredCpuMs !== null ? 'cpu' : 'frame-cadence-fallback');
    const normalized = {
      cpuMs: measuredCpuMs ?? 0,
      gpuMs: measuredGpuMs ?? 0,
      frameMs,
      totalMs,
      nowMs,
      passTimes,
      hasCpuSample: measuredCpuMs !== null,
      hasGpuSample: measuredGpuMs !== null,
      gpuTimingAvailable,
      gpuSamplePending,
      queueDepth,
      queueCapacity,
      queueThrottled,
      queueNearCapacity,
      queuePressure,
      queuePressureDowngrade,
      presentationMs,
      queueCompletionWallMs,
      displayIntervalMs,
      timingSource,
    };
    this._latestSignals = normalized;
    this._queuePressureStreak = nextQueuePressureStreak;
    this._queueDowngradeStreak = nextQueueDowngradeStreak;
    this._history.push(normalized);
    if (this._history.length > this.historySize) this._history.shift();
    if (measuredGpuMs !== null) {
      this._gpuHistory.push(measuredGpuMs);
      if (this._gpuHistory.length > this.historySize) this._gpuHistory.shift();
    }
    this._ema += (totalMs - this._ema) * 0.1;
    this._residencyFrames.set(this.tier.name, (this._residencyFrames.get(this.tier.name) || 0) + 1);

    const cooldownReady = nowMs - this._lastChangeMs >= this.cooldownMs;
    if (this.mode === 'auto' && sample.memoryPressure === 'critical') {
      this._setTierIndex(ADAPTIVE_QUALITY_TIERS.length - 1, 'critical-memory', nowMs);
    } else if (this.mode === 'auto' && cooldownReady && queuePressureDowngrade) {
      this._setTierIndex(
        Math.min(ADAPTIVE_QUALITY_TIERS.length - 1, this._tierIndex + 1),
        'gpu-queue-pressure',
        nowMs,
      );
    } else if (this.mode === 'auto' && this._history.length >= this.historySize) {
      const stats = this._windowStats();
      const p95OverBudget = stats.p95 / this.targetFrameMs > this.downgradeRatio;
      const p97OverBudget = stats.p97 / this.targetFrameMs > this.downgradeP97Ratio;
      const gpuReady = stats.gpu.count >= this.minimumGpuSamples;
      const gpuP95OverBudget = gpuReady && stats.gpu.p95 / this.targetFrameMs > this.downgradeRatio;
      const gpuP97OverBudget = gpuReady && stats.gpu.p97 / this.targetFrameMs > this.downgradeP97Ratio;
      if (cooldownReady && (p95OverBudget || p97OverBudget || gpuP95OverBudget || gpuP97OverBudget)) {
        const reason = p95OverBudget
          ? 'frame-budget-overrun'
          : p97OverBudget
            ? 'frame-tail-overrun'
            : gpuP95OverBudget
              ? 'gpu-budget-overrun'
              : 'gpu-tail-overrun';
        this._setTierIndex(
          Math.min(ADAPTIVE_QUALITY_TIERS.length - 1, this._tierIndex + 1),
          reason,
          nowMs,
        );
      } else if (cooldownReady && nowMs >= this._upgradeBackoffUntilMs
          && this._qualityUpgradeSignalsReady(stats)
          && stats.p95 / this.targetFrameMs < this.upgradeRatio
          && stats.p97 / this.targetFrameMs < this.upgradeP97Ratio
          && (!this._latestSignals?.gpuTimingAvailable
            || (stats.gpu.p95 / this.targetFrameMs < this.upgradeRatio
              && stats.gpu.p97 / this.targetFrameMs < this.upgradeP97Ratio))) {
        this._setTierIndex(Math.max(0, this._tierIndex - 1), 'sustained-headroom', nowMs);
      }
    }
    return this.getDecision();
  }

  setMode(mode, tierName) {
    if (mode !== 'auto' && mode !== 'fixed') throw new RangeError("Quality mode must be 'auto' or 'fixed'");
    this.mode = mode;
    if (tierName !== undefined) this.setTier(tierName, 'manual');
    return this.getDecision();
  }

  setTier(name, reason = 'manual') {
    const index = byName.get(String(name));
    if (index === undefined) throw new RangeError(`Unknown quality tier '${name}'`);
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this._setTierIndex(index, reason, nowMs, true);
    return this.getDecision();
  }

  setTargetFPS(targetFPS, mode = 'fixed') {
    if (targetFPS === 'display' || mode === 'display') {
      this.targetMode = 'display';
      const display = this.displayRefreshEstimator.snapshot();
      this.targetFrameMs = display.frameMs;
    } else {
      const fps = Number(targetFPS);
      if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('targetFPS must be positive or display');
      this.targetMode = 'fixed';
      this.targetFrameMs = 1000 / fps;
    }
    this.reset();
    this._reason = 'target-changed';
    return this.getDecision();
  }

  get tier() { return ADAPTIVE_QUALITY_TIERS[this._tierIndex]; }

  getDecision() {
    const stats = this._windowStats();
    const signals = this._signalSnapshot(stats);
    const progressiveBudget = planProgressiveWorkBudget({
      targetFrameMs: this.targetFrameMs,
      gpuP95Ms: stats.gpu.p95,
      cpuP95Ms: stats.cpu.p95,
      queueDepth: signals.queueDepth,
      queueCapacity: signals.queueCapacity,
      timingReady: signals.performanceSignalsReady,
      requestedUnits: this.tier.pathBounces,
      unitCostMs: Math.max(0.1, this.targetFrameMs * 0.08),
    });
    return Object.freeze({
      ...this.tier,
      mode: this.mode,
      reason: this._reason,
      targetFrameMs: this.targetFrameMs,
      targetFPS: 1000 / this.targetFrameMs,
      targetMode: this.targetMode,
      displayRefresh: this.displayRefreshEstimator.snapshot(),
      renderBudgetMs: this.renderBudgetMs,
      frameP50Ms: stats.p50,
      frameP95Ms: stats.p95,
      frameP97Ms: stats.p97,
      frameP99Ms: stats.p99,
      frameMaxMs: stats.max,
      frameOverBudgetRatio: stats.overBudgetRatio,
      frameEmaMs: this._ema,
      cpuP95Ms: stats.cpu.p95,
      cpuP97Ms: stats.cpu.p97,
      cpuSamples: stats.cpu.count,
      gpuP95Ms: stats.gpu.p95,
      gpuP97Ms: stats.gpu.p97,
      gpuSamples: stats.gpu.count,
      ...signals,
      progressiveBudget,
      progressiveBudgetMs: progressiveBudget.availableMs,
      autoProgressiveEligible: this._tierIndex <= 1
        && signals.performanceSignalsReady
        && progressiveBudget.admittedUnits > 0,
    });
  }

  getStats() {
    const window = this._windowStats();
    // Tier transitions intentionally clear the rolling window, but callers still
    // need the transition clock to observe the active upgrade-hysteresis window.
    const latest = this._history[this._history.length - 1]
      || this._latestSignals
      || { cpuMs: 0, gpuMs: 0, totalMs: 0, passTimes: {} };
    const upgradeBackoffMsRemaining = Number.isFinite(latest.nowMs) && Number.isFinite(this._upgradeBackoffUntilMs)
      ? Math.max(0, this._upgradeBackoffUntilMs - latest.nowMs)
      : 0;
    return {
      mode: this.mode, tier: this.tier.name, reason: this._reason,
      targetMode: this.targetMode,
      targetFPS: 1000 / this.targetFrameMs,
      targetFrameMs: this.targetFrameMs, renderBudgetMs: this.renderBudgetMs,
      displayRefresh: this.displayRefreshEstimator.snapshot(),
      samples: this._history.length, emaMs: this._ema,
      p50Ms: window.p50, p95Ms: window.p95, p97Ms: window.p97, p99Ms: window.p99,
      maxMs: window.max, overBudgetCount: window.overBudgetCount, overBudgetRatio: window.overBudgetRatio,
      downgradeP97Ratio: this.downgradeP97Ratio, upgradeP97Ratio: this.upgradeP97Ratio,
      minimumGpuSamples: this.minimumGpuSamples,
      queuePressureFrames: this.queuePressureFrames,
      queuePressureStreak: this._queuePressureStreak,
      queueDowngradeStreak: this._queueDowngradeStreak,
      cpu: { ...window.cpu },
      gpu: { ...window.gpu },
      signals: this._signalSnapshot(window),
      latest: { ...latest, passTimes: { ...latest.passTimes } }, changes: this._changeCount,
      upgradeBackoffMsRemaining,
      residencyFrames: Object.fromEntries(this._residencyFrames),
    };
  }

  reset() {
    this._history.length = 0; this._ema = this.targetFrameMs; this._lastChangeMs = -Infinity;
    this._gpuHistory.length = 0;
    this._changeCount = 0; this._reason = 'reset';
    this._lastTransitionDirection = 0; this._upgradeBackoffUntilMs = -Infinity;
    this._queuePressureStreak = 0; this._queueDowngradeStreak = 0; this._latestSignals = null;
    for (const tier of ADAPTIVE_QUALITY_TIERS) this._residencyFrames.set(tier.name, 0);
  }

  _setTierIndex(index, reason, nowMs, force = false) {
    if (!force && index === this._tierIndex) return;
    const previousIndex = this._tierIndex;
    const previous = this.tier.name;
    const direction = Math.sign(index - previousIndex);
    if (!force && direction > 0) {
      // Every automatic downgrade establishes a full hysteresis window. The
      // previous reversal-only rule let a tier immediately upgrade again when
      // the first downgrade followed initialization or another downgrade.
      this._upgradeBackoffUntilMs = Math.max(
        this._upgradeBackoffUntilMs,
        nowMs + this.upgradeBackoffMs,
      );
    }
    this._tierIndex = index; this._reason = reason; this._lastChangeMs = nowMs; this._changeCount++;
    this._lastTransitionDirection = force ? 0 : direction;
    this._history.length = 0;
    this._gpuHistory.length = 0;
    this._ema = this.targetFrameMs;
    this._logger?.({ type: 'quality-tier-change', previous, current: this.tier.name, reason, nowMs });
  }

  _windowStats() {
    const sorted = this._history.map((entry) => entry.totalMs).sort((a, b) => a - b);
    const overBudgetCount = sorted.reduce(
      (count, value) => count + (value > this.targetFrameMs ? 1 : 0),
      0,
    );
    return {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p97: percentile(sorted, 0.97),
      p99: percentile(sorted, 0.99),
      max: sorted.length ? sorted[sorted.length - 1] : 0,
      overBudgetCount,
      overBudgetRatio: sorted.length ? overBudgetCount / sorted.length : 0,
      cpu: this._channelStats('cpuMs', 'hasCpuSample'),
      gpu: this._sampleStats(this._gpuHistory),
    };
  }

  _channelStats(valueName, presenceName) {
    const sorted = this._history
      .filter(entry => entry[presenceName])
      .map(entry => entry[valueName])
      .sort((a, b) => a - b);
    return this._sampleStats(sorted);
  }

  _sampleStats(samples) {
    const sorted = Array.from(samples).sort((a, b) => a - b);
    return {
      count: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p97: percentile(sorted, 0.97),
      p99: percentile(sorted, 0.99),
      max: sorted.length ? sorted[sorted.length - 1] : 0,
    };
  }

  _performanceSignalsReady(stats) {
    const latest = this._latestSignals;
    if (!latest) return true;
    if (latest.gpuSamplePending > 0 || latest.queuePressure) return false;
    return !latest.gpuTimingAvailable || stats.gpu.count >= this.minimumGpuSamples;
  }

  _qualityUpgradeSignalsReady(stats) {
    const latest = this._latestSignals;
    if (!latest) return true;
    if (latest.gpuSamplePending > 0 || latest.queuePressureDowngrade) return false;
    return !latest.gpuTimingAvailable || stats.gpu.count >= this.minimumGpuSamples;
  }

  _signalSnapshot(stats) {
    const latest = this._latestSignals;
    return {
      timingSource: latest?.timingSource || 'none',
      gpuTimingAvailable: latest?.gpuTimingAvailable === true,
      gpuSamplePending: latest?.gpuSamplePending || 0,
      queueDepth: latest?.queueDepth || 0,
      queueCapacity: latest?.queueCapacity || 1,
      queueThrottled: latest?.queueThrottled === true,
      queueNearCapacity: latest?.queueNearCapacity === true,
      queuePressure: latest?.queuePressure === true,
      queuePressureDowngrade: latest?.queuePressureDowngrade === true,
      queueDowngradeStreak: this._queueDowngradeStreak,
      presentationMs: latest?.presentationMs ?? 0,
      displayIntervalMs: latest?.displayIntervalMs ?? 0,
      queueCompletionWallMs: latest?.queueCompletionWallMs ?? 0,
      performanceSignalsReady: this._performanceSignalsReady(stats),
      qualityUpgradeSignalsReady: this._qualityUpgradeSignalsReady(stats),
    };
  }
}

export function createAdaptiveQualityGovernor(options) {
  return new AdaptiveQualityGovernor(options);
}
