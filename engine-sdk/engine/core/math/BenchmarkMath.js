// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// BenchmarkMath.js - reusable benchmark rate, memory, compression, and cost estimates.

import { qualitySizeScore } from './MathQuality.js';

const MS_PER_SECOND = 1000;
const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = 1024 * 1024;

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

function alignBytes(byteCount, alignment) {
  const bytes = nonnegativeValue(byteCount, 'byteCount');
  const align = Math.max(1, Math.trunc(positiveValue(alignment, 'alignment')));
  return Math.ceil(bytes / align) * align;
}

export function operationsPerSecond(operationCount, durationMs) {
  const operations = nonnegativeValue(operationCount, 'operationCount');
  const duration = nonnegativeValue(durationMs, 'durationMs');
  if (duration === 0) return operations > 0 ? Infinity : 0;
  return operations / (duration / MS_PER_SECOND);
}

export function throughputReport(options = {}) {
  const durationMs = nonnegativeValue(options.durationMs ?? 0, 'durationMs');
  const operationCount = nonnegativeValue(options.operationCount ?? 0, 'operationCount');
  const itemCount = nonnegativeValue(options.itemCount ?? operationCount, 'itemCount');
  const byteCount = nonnegativeValue(options.byteCount ?? 0, 'byteCount');
  const durationSeconds = durationMs / MS_PER_SECOND;
  const rate = (count) => durationMs === 0 ? (count > 0 ? Infinity : 0) : count / durationSeconds;
  const operationsPerSec = rate(operationCount);
  const itemsPerSecond = rate(itemCount);
  const bytesPerSecond = rate(byteCount);

  return {
    durationMs,
    durationSeconds,
    operationCount,
    itemCount,
    byteCount,
    operationsPerSecond: operationsPerSec,
    itemsPerSecond,
    bytesPerSecond,
    kibPerSecond: bytesPerSecond / BYTES_PER_KIB,
    mibPerSecond: bytesPerSecond / BYTES_PER_MIB,
    averageOperationMs: operationCount > 0 ? durationMs / operationCount : 0,
    averageItemMs: itemCount > 0 ? durationMs / itemCount : 0,
    bytesPerOperation: operationCount > 0 ? byteCount / operationCount : 0,
    bytesPerItem: itemCount > 0 ? byteCount / itemCount : 0,
  };
}

export function durationReport(startMs, endMs, options = {}) {
  const start = finiteValue(startMs, 'startMs');
  const end = finiteValue(endMs, 'endMs');
  const durationMs = end - start;
  if (durationMs < 0) {
    throw new RangeError('endMs must be greater than or equal to startMs');
  }
  return {
    startMs: start,
    endMs: end,
    ...throughputReport({ ...options, durationMs }),
  };
}

export function memoryEstimateReport(options = {}) {
  const elementCount = nonnegativeValue(options.elementCount ?? 0, 'elementCount');
  const bytesPerElement = nonnegativeValue(options.bytesPerElement ?? 0, 'bytesPerElement');
  const fixedBytes = nonnegativeValue(options.fixedBytes ?? 0, 'fixedBytes');
  const overheadBytes = nonnegativeValue(options.overheadBytes ?? 0, 'overheadBytes');
  const copies = Math.max(1, Math.trunc(positiveValue(options.copies ?? 1, 'copies')));
  const alignment = Math.max(1, Math.trunc(positiveValue(options.alignment ?? 1, 'alignment')));
  const payloadBytes = elementCount * bytesPerElement;
  const rawBytesPerCopy = payloadBytes + fixedBytes + overheadBytes;
  const alignedBytesPerCopy = alignBytes(rawBytesPerCopy, alignment);
  const totalBytes = alignedBytesPerCopy * copies;

  return {
    elementCount,
    bytesPerElement,
    payloadBytes,
    fixedBytes,
    overheadBytes,
    rawBytesPerCopy,
    alignment,
    alignedBytesPerCopy,
    paddingBytesPerCopy: alignedBytesPerCopy - rawBytesPerCopy,
    copies,
    totalBytes,
    totalKiB: totalBytes / BYTES_PER_KIB,
    totalMiB: totalBytes / BYTES_PER_MIB,
  };
}

export function compressionRatioReport(options = {}) {
  const inputBytes = nonnegativeValue(options.inputBytes ?? options.referenceBytes ?? 0, 'inputBytes');
  const outputBytes = nonnegativeValue(options.outputBytes ?? options.byteSize ?? 0, 'outputBytes');
  const referenceBytes = nonnegativeValue(options.referenceBytes ?? inputBytes, 'referenceBytes');
  const quality = finiteValue(options.quality ?? 1, 'quality');
  const compressionRatio = outputBytes === 0 ? (inputBytes > 0 ? Infinity : 1) : inputBytes / outputBytes;
  const expansionRatio = inputBytes === 0 ? (outputBytes > 0 ? Infinity : 1) : outputBytes / inputBytes;
  const savingsBytes = inputBytes - outputBytes;
  const savingsRatio = inputBytes > 0 ? savingsBytes / inputBytes : 0;
  const qualitySize = qualitySizeScore({ quality, byteSize: outputBytes, referenceByteSize: referenceBytes });

  return {
    inputBytes,
    outputBytes,
    referenceBytes,
    quality,
    compressionRatio,
    expansionRatio,
    savingsBytes,
    savingsRatio,
    qualitySizeScore: qualitySize.score,
    qualitySize,
  };
}

export function computeCostEstimateReport(options = {}) {
  const cpuMs = nonnegativeValue(options.cpuMs ?? 0, 'cpuMs');
  const gpuMs = nonnegativeValue(options.gpuMs ?? 0, 'gpuMs');
  const uploadBytes = nonnegativeValue(options.uploadBytes ?? 0, 'uploadBytes');
  const downloadBytes = nonnegativeValue(options.downloadBytes ?? 0, 'downloadBytes');
  const targetFrameMs = positiveValue(options.targetFrameMs ?? (MS_PER_SECOND / 60), 'targetFrameMs');
  const bandwidth = nonnegativeValue(options.transferBandwidthBytesPerSecond ?? 0, 'transferBandwidthBytesPerSecond');
  const transferBytes = uploadBytes + downloadBytes;
  const transferMs = bandwidth > 0 ? (transferBytes / bandwidth) * MS_PER_SECOND : 0;
  const serialMs = cpuMs + gpuMs + transferMs;
  const pipelinedMs = Math.max(cpuMs, gpuMs) + transferMs;
  const bottleneckMs = Math.max(cpuMs, gpuMs, transferMs);
  const bottleneck = bottleneckMs === gpuMs && gpuMs >= cpuMs && gpuMs >= transferMs
    ? 'gpu'
    : (bottleneckMs === cpuMs && cpuMs >= transferMs ? 'cpu' : 'transfer');

  return {
    cpuMs,
    gpuMs,
    uploadBytes,
    downloadBytes,
    transferBytes,
    transferBandwidthBytesPerSecond: bandwidth,
    transferMs,
    serialMs,
    pipelinedMs,
    targetFrameMs,
    budgetShare: pipelinedMs / targetFrameMs,
    headroomMs: targetFrameMs - pipelinedMs,
    overBudgetMs: Math.max(0, pipelinedMs - targetFrameMs),
    withinBudget: pipelinedMs <= targetFrameMs,
    bottleneck,
    bottleneckMs,
  };
}

export default {
  operationsPerSecond,
  throughputReport,
  durationReport,
  memoryEstimateReport,
  compressionRatioReport,
  computeCostEstimateReport,
};
