// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathStatistics.js - Running statistics, array stats, exponential moving average
// Consolidates: PerformanceAnalyzer inline variance/stdDev, FramePacingController running average
// Welford's online algorithm for numerically stable running stats

// ============================================================================
// RUNNING STATISTICS (Welford's online algorithm)
// Numerically stable, single-pass, O(1) memory
// ============================================================================

export function runningStatsCreate() {
  return { n: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity };
}

export function runningStatsPush(stats, value) {
  stats.n++;
  const delta = value - stats.mean;
  stats.mean += delta / stats.n;
  const delta2 = value - stats.mean;
  stats.m2 += delta * delta2;
  if (value < stats.min) stats.min = value;
  if (value > stats.max) stats.max = value;
  return stats;
}

export function runningStatsRemove(stats, value) {
  if (stats.n <= 1) return runningStatsReset(stats);
  const oldMean = stats.mean;
  stats.n--;
  stats.mean = (oldMean * (stats.n + 1) - value) / stats.n;
  stats.m2 -= (value - stats.mean) * (value - oldMean);
  if (stats.m2 < 0) stats.m2 = 0;
  return stats;
}

export const runningStatsMean = (stats) => stats.mean;
export const runningStatsCount = (stats) => stats.n;
export const runningStatsMin = (stats) => stats.n > 0 ? stats.min : 0;
export const runningStatsMax = (stats) => stats.n > 0 ? stats.max : 0;
export const runningStatsRange = (stats) => stats.n > 0 ? stats.max - stats.min : 0;

export function runningStatsVariance(stats) {
  return stats.n > 1 ? stats.m2 / (stats.n - 1) : 0;
}

export function runningStatsPopulationVariance(stats) {
  return stats.n > 0 ? stats.m2 / stats.n : 0;
}

export function runningStatsStdDev(stats) {
  return Math.sqrt(runningStatsVariance(stats));
}

export function runningStatsMerge(a, b) {
  if (a.n === 0) return { ...b };
  if (b.n === 0) return { ...a };
  const n = a.n + b.n;
  const delta = b.mean - a.mean;
  const mean = (a.mean * a.n + b.mean * b.n) / n;
  const m2 = a.m2 + b.m2 + delta * delta * a.n * b.n / n;
  return { n, mean, m2, min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
}

export function runningStatsReset(stats) {
  stats.n = 0;
  stats.mean = 0;
  stats.m2 = 0;
  stats.min = Infinity;
  stats.max = -Infinity;
  return stats;
}

export function runningStatsClone(stats) {
  return { n: stats.n, mean: stats.mean, m2: stats.m2, min: stats.min, max: stats.max };
}

// ============================================================================
// ARRAY STATISTICS
// ============================================================================

export function statsMean(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

export function statsSum(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum;
}

export function statsVariance(arr) {
  if (arr.length < 2) return 0;
  const m = statsMean(arr);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    sum += d * d;
  }
  return sum / (arr.length - 1);
}

export function statsPopulationVariance(arr) {
  if (arr.length === 0) return 0;
  const m = statsMean(arr);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    sum += d * d;
  }
  return sum / arr.length;
}

export const statsStdDev = (arr) => Math.sqrt(statsVariance(arr));
export const statsPopulationStdDev = (arr) => Math.sqrt(statsPopulationVariance(arr));

export function statsMin(arr) {
  if (arr.length === 0) return 0;
  let m = arr[0];
  for (let i = 1; i < arr.length; i++) if (arr[i] < m) m = arr[i];
  return m;
}

export function statsMax(arr) {
  if (arr.length === 0) return 0;
  let m = arr[0];
  for (let i = 1; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

export const statsRange = (arr) => arr.length === 0 ? 0 : statsMax(arr) - statsMin(arr);

export function statsMedian(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function statsPercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function statsIQR(arr) {
  return statsPercentile(arr, 75) - statsPercentile(arr, 25);
}

// ============================================================================
// EXPONENTIAL MOVING AVERAGE (streaming)
// ============================================================================

export function emaCreate(alpha = 0.1) {
  return { alpha, value: 0, initialized: false };
}

export function emaPush(ema, value) {
  if (!ema.initialized) {
    ema.value = value;
    ema.initialized = true;
  } else {
    ema.value = ema.alpha * value + (1 - ema.alpha) * ema.value;
  }
  return ema.value;
}

export const emaGet = (ema) => ema.value;

export function emaReset(ema) {
  ema.value = 0;
  ema.initialized = false;
  return ema;
}

// ============================================================================
// WINDOWED STATISTICS (fixed-size circular buffer)
// ============================================================================

export function windowedStatsCreate(windowSize = 60) {
  return {
    buffer: new Float64Array(windowSize),
    size: windowSize,
    count: 0,
    index: 0,
    sum: 0,
  };
}

export function windowedStatsPush(ws, value) {
  if (ws.count >= ws.size) {
    ws.sum -= ws.buffer[ws.index];
  } else {
    ws.count++;
  }
  ws.buffer[ws.index] = value;
  ws.sum += value;
  ws.index = (ws.index + 1) % ws.size;
  return ws;
}

export const windowedStatsMean = (ws) => ws.count > 0 ? ws.sum / ws.count : 0;

export function windowedStatsVariance(ws) {
  if (ws.count < 2) return 0;
  const m = windowedStatsMean(ws);
  let sum = 0;
  for (let i = 0; i < ws.count; i++) {
    const d = ws.buffer[i] - m;
    sum += d * d;
  }
  return sum / (ws.count - 1);
}

export const windowedStatsStdDev = (ws) => Math.sqrt(windowedStatsVariance(ws));

export function windowedStatsReset(ws) {
  ws.count = 0;
  ws.index = 0;
  ws.sum = 0;
  ws.buffer.fill(0);
  return ws;
}
