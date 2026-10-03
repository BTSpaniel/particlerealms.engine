// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ProfileMath.js - reusable latency, frame-budget, and stage profile summaries.

import {
  statsMax,
  statsMean,
  statsMedian,
  statsMin,
  statsPercentile,
  statsPopulationStdDev,
} from './MathStatistics.js';
import { throughputReport } from './BenchmarkMath.js';
import { finiteArrayReport } from './MathValidation.js';

const MS_PER_SECOND = 1000;

function finiteValue(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${name} must be finite`);
  }
  return number;
}

function nonnegativeValue(value, name) {
  const number = finiteValue(value, name);
  if (number < 0) {
    throw new RangeError(`${name} must be nonnegative`);
  }
  return number;
}

function positiveValue(value, name) {
  const number = finiteValue(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function finiteLatencySamples(samplesMs) {
  const report = finiteArrayReport(samplesMs, { min: 0, allowEmpty: false });
  if (!report.valid) {
    throw new RangeError(`latency samples must be finite nonnegative numbers: ${report.errors.join('; ')}`);
  }
  return Array.from(samplesMs, Number);
}

export function latencyStatsReport(samplesMs, options = {}) {
  const samples = finiteLatencySamples(samplesMs);
  const targetMs = options.targetMs === undefined ? null : positiveValue(options.targetMs, 'targetMs');
  const withinBudgetCount = targetMs === null ? 0 : samples.reduce((count, value) => count + (value <= targetMs ? 1 : 0), 0);
  const p50 = statsPercentile(samples, 50);
  const p95 = statsPercentile(samples, 95);

  return {
    count: samples.length,
    minMs: statsMin(samples),
    maxMs: statsMax(samples),
    meanMs: statsMean(samples),
    medianMs: statsMedian(samples),
    p50Ms: p50,
    p90Ms: statsPercentile(samples, 90),
    p95Ms: p95,
    p99Ms: statsPercentile(samples, 99),
    stdDevMs: statsPopulationStdDev(samples),
    jitterMs: p95 - p50,
    targetMs,
    withinBudgetCount,
    overBudgetCount: targetMs === null ? 0 : samples.length - withinBudgetCount,
    budgetHitRatio: targetMs === null ? 0 : withinBudgetCount / samples.length,
  };
}

export function frameBudgetReport(frameTimeMs, options = {}) {
  const frameTime = nonnegativeValue(frameTimeMs, 'frameTimeMs');
  const targetFps = positiveValue(options.targetFps ?? 60, 'targetFps');
  const targetFrameMs = positiveValue(options.targetFrameMs ?? (MS_PER_SECOND / targetFps), 'targetFrameMs');
  const workTimeMs = nonnegativeValue(options.workTimeMs ?? frameTime, 'workTimeMs');
  const idleMs = Math.max(0, frameTime - workTimeMs);
  const estimatedFps = frameTime === 0 ? Infinity : MS_PER_SECOND / frameTime;

  return {
    frameTimeMs: frameTime,
    workTimeMs,
    idleMs,
    targetFps,
    targetFrameMs,
    estimatedFps,
    budgetShare: frameTime / targetFrameMs,
    workBudgetShare: workTimeMs / targetFrameMs,
    headroomMs: targetFrameMs - frameTime,
    overBudgetMs: Math.max(0, frameTime - targetFrameMs),
    withinBudget: frameTime <= targetFrameMs,
    droppedFrameRisk: frameTime > targetFrameMs * 2 ? 'high' : (frameTime > targetFrameMs ? 'medium' : 'low'),
  };
}

export function profileStageReport(stages, options = {}) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new RangeError('stages must be a non-empty array');
  }

  const normalized = stages.map((stage, index) => {
    const durationMs = nonnegativeValue(stage.durationMs ?? 0, `stages[${index}].durationMs`);
    const operationCount = nonnegativeValue(stage.operationCount ?? 0, `stages[${index}].operationCount`);
    const byteCount = nonnegativeValue(stage.byteCount ?? 0, `stages[${index}].byteCount`);
    return {
      name: String(stage.name ?? `stage-${index}`),
      durationMs,
      operationCount,
      byteCount,
    };
  });

  const totalDurationMs = normalized.reduce((sum, stage) => sum + stage.durationMs, 0);
  const totalOperationCount = normalized.reduce((sum, stage) => sum + stage.operationCount, 0);
  const totalByteCount = normalized.reduce((sum, stage) => sum + stage.byteCount, 0);
  let bottleneckStage = normalized[0];
  for (const stage of normalized) {
    if (stage.durationMs > bottleneckStage.durationMs) bottleneckStage = stage;
  }

  const stageReports = normalized.map((stage) => ({
    ...stage,
    durationShare: totalDurationMs > 0 ? stage.durationMs / totalDurationMs : 0,
    throughput: throughputReport({
      durationMs: stage.durationMs,
      operationCount: stage.operationCount,
      itemCount: stage.operationCount,
      byteCount: stage.byteCount,
    }),
  }));

  const targetMs = options.targetMs === undefined ? null : positiveValue(options.targetMs, 'targetMs');
  return {
    stageCount: normalized.length,
    totalDurationMs,
    totalOperationCount,
    totalByteCount,
    stages: stageReports,
    bottleneckStage: stageReports.find((stage) => stage.name === bottleneckStage.name),
    throughput: throughputReport({
      durationMs: totalDurationMs,
      operationCount: totalOperationCount,
      itemCount: totalOperationCount,
      byteCount: totalByteCount,
    }),
    targetMs,
    budgetShare: targetMs === null ? 0 : totalDurationMs / targetMs,
    withinBudget: targetMs === null ? true : totalDurationMs <= targetMs,
    overBudgetMs: targetMs === null ? 0 : Math.max(0, totalDurationMs - targetMs),
  };
}

export default {
  latencyStatsReport,
  frameBudgetReport,
  profileStageReport,
};
