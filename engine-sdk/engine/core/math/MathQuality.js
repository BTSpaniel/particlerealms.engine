// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathQuality.js - reusable error, quality, signal, and size metrics.

import { saturate } from './MathScalar.js';

const DEFAULT_DATA_RANGE = 1;
const DEFAULT_PSNR_GOOD_DB = 40;

function assertArrayLikePair(reference, candidate) {
  if (!reference || !candidate || typeof reference.length !== 'number' || typeof candidate.length !== 'number') {
    throw new TypeError('quality metric inputs must be array-like');
  }
  if (reference.length !== candidate.length) {
    throw new RangeError('quality metric inputs must have matching lengths');
  }
  if (reference.length === 0) {
    throw new RangeError('quality metric inputs must be non-empty');
  }
  return reference.length;
}

function finiteValue(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${name} must be finite`);
  }
  return number;
}

function finiteNonnegative(value, name) {
  const number = finiteValue(value, name);
  if (number < 0) {
    throw new RangeError(`${name} must be nonnegative`);
  }
  return number;
}

function positiveFinite(value, name) {
  const number = finiteValue(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function positiveInteger(value, name) {
  const number = positiveFinite(value, name);
  if (!Number.isInteger(number)) {
    throw new RangeError(`${name} must be an integer`);
  }
  return number;
}

function finiteOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sliceArrayLike(values, start, end) {
  if (typeof values.subarray === 'function') return values.subarray(start, end);
  return Array.prototype.slice.call(values, start, end);
}

function inferImageDataRange(referenceData, candidateData, options) {
  if (options.dataRange !== undefined) return positiveFinite(options.dataRange, 'dataRange');
  if (
    referenceData instanceof Uint8Array ||
    referenceData instanceof Uint8ClampedArray ||
    candidateData instanceof Uint8Array ||
    candidateData instanceof Uint8ClampedArray
  ) {
    return 255;
  }
  return DEFAULT_DATA_RANGE;
}

function imageDataView(image, name, options = {}) {
  const isImageLike = image && typeof image === 'object' && image.data && typeof image.width === 'number' && typeof image.height === 'number';
  const data = isImageLike ? image.data : image;
  if (!data || typeof data.length !== 'number') {
    throw new TypeError(`${name} must be ImageData-like or array-like pixel data`);
  }

  const width = positiveInteger(isImageLike ? image.width : options.width, `${name}.width`);
  const height = positiveInteger(isImageLike ? image.height : options.height, `${name}.height`);
  const channelCount = positiveInteger(options.channelCount ?? image?.channelCount ?? image?.channels ?? 4, `${name}.channelCount`);
  const expectedLength = width * height * channelCount;
  if (data.length !== expectedLength) {
    throw new RangeError(`${name}.data length must equal width * height * channelCount`);
  }
  return { data, width, height, channelCount, pixelCount: width * height };
}

function weightedAverage(values, weights) {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const weight = Math.max(0, finiteOrDefault(weights[i], 0));
    weighted += values[i] * weight;
    total += weight;
  }
  return total > 0 ? weighted / total : 0;
}

export function pairwiseErrorStats(reference, candidate) {
  const count = assertArrayLikePair(reference, candidate);
  let sumError = 0;
  let sumAbsoluteError = 0;
  let sumSquaredError = 0;
  let peakAbsoluteError = 0;

  for (let i = 0; i < count; i++) {
    const expected = finiteValue(reference[i], `reference[${i}]`);
    const actual = finiteValue(candidate[i], `candidate[${i}]`);
    const error = actual - expected;
    const absoluteError = Math.abs(error);
    sumError += error;
    sumAbsoluteError += absoluteError;
    sumSquaredError += error * error;
    if (absoluteError > peakAbsoluteError) peakAbsoluteError = absoluteError;
  }

  const meanSquaredError = sumSquaredError / count;
  return {
    count,
    sumError,
    averageError: sumError / count,
    meanError: sumError / count,
    sumAbsoluteError,
    meanAbsoluteError: sumAbsoluteError / count,
    sumSquaredError,
    meanSquaredError,
    rootMeanSquaredError: Math.sqrt(meanSquaredError),
    peakAbsoluteError,
  };
}

export function meanSquaredError(reference, candidate) {
  return pairwiseErrorStats(reference, candidate).meanSquaredError;
}

export function rootMeanSquaredError(reference, candidate) {
  return pairwiseErrorStats(reference, candidate).rootMeanSquaredError;
}

export function meanAbsoluteError(reference, candidate) {
  return pairwiseErrorStats(reference, candidate).meanAbsoluteError;
}

export function averageError(reference, candidate) {
  return pairwiseErrorStats(reference, candidate).averageError;
}

export function peakAbsoluteError(reference, candidate) {
  return pairwiseErrorStats(reference, candidate).peakAbsoluteError;
}

export function signalToNoiseRatio(reference, candidate) {
  const count = assertArrayLikePair(reference, candidate);
  let signalPower = 0;
  let noisePower = 0;
  for (let i = 0; i < count; i++) {
    const expected = finiteValue(reference[i], `reference[${i}]`);
    const actual = finiteValue(candidate[i], `candidate[${i}]`);
    const noise = actual - expected;
    signalPower += expected * expected;
    noisePower += noise * noise;
  }
  signalPower /= count;
  noisePower /= count;

  if (noisePower === 0) return Infinity;
  if (signalPower === 0) return -Infinity;
  return 10 * Math.log10(signalPower / noisePower);
}

export function peakSignalToNoiseRatio(reference, candidate, options = {}) {
  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const mse = meanSquaredError(reference, candidate);
  if (mse === 0) return Infinity;
  return 10 * Math.log10((dataRange * dataRange) / mse);
}

export function structuralSimilarityLite(reference, candidate, options = {}) {
  const count = assertArrayLikePair(reference, candidate);
  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const k1 = positiveFinite(options.k1 ?? 0.01, 'k1');
  const k2 = positiveFinite(options.k2 ?? 0.03, 'k2');

  let meanReference = 0;
  let meanCandidate = 0;
  for (let i = 0; i < count; i++) {
    meanReference += finiteValue(reference[i], `reference[${i}]`);
    meanCandidate += finiteValue(candidate[i], `candidate[${i}]`);
  }
  meanReference /= count;
  meanCandidate /= count;

  let referenceVariance = 0;
  let candidateVariance = 0;
  let covariance = 0;
  for (let i = 0; i < count; i++) {
    const referenceDelta = Number(reference[i]) - meanReference;
    const candidateDelta = Number(candidate[i]) - meanCandidate;
    referenceVariance += referenceDelta * referenceDelta;
    candidateVariance += candidateDelta * candidateDelta;
    covariance += referenceDelta * candidateDelta;
  }
  const denominatorCount = options.sampleCovariance && count > 1 ? count - 1 : count;
  referenceVariance /= denominatorCount;
  candidateVariance /= denominatorCount;
  covariance /= denominatorCount;

  const c1 = (k1 * dataRange) ** 2;
  const c2 = (k2 * dataRange) ** 2;
  const numerator = (2 * meanReference * meanCandidate + c1) * (2 * covariance + c2);
  const denominator = (meanReference * meanReference + meanCandidate * meanCandidate + c1) * (referenceVariance + candidateVariance + c2);
  return denominator === 0 ? (meanSquaredError(reference, candidate) === 0 ? 1 : 0) : numerator / denominator;
}

export function windowedStructuralSimilarity(reference, candidate, options = {}) {
  const count = assertArrayLikePair(reference, candidate);
  const windowSize = positiveInteger(options.windowSize ?? Math.min(64, count), 'windowSize');
  const hopSize = positiveInteger(options.hopSize ?? windowSize, 'hopSize');
  const includePartial = options.includePartial !== false;
  if (!includePartial && windowSize > count) {
    throw new RangeError('windowSize must be <= sample count when includePartial is false');
  }

  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const minSimilarityThreshold = finiteOrDefault(options.minSimilarity ?? options.minSsim, -Infinity);
  const windows = [];
  let sumSimilarity = 0;
  let minSimilarity = Infinity;
  let maxSimilarity = -Infinity;
  let worstWindow = null;
  let bestWindow = null;

  for (let start = 0; start < count; start += hopSize) {
    const end = Math.min(count, start + windowSize);
    const sampleCount = end - start;
    if (sampleCount < windowSize && !includePartial) break;
    if (sampleCount <= 0) break;

    const similarity = structuralSimilarityLite(
      sliceArrayLike(reference, start, end),
      sliceArrayLike(candidate, start, end),
      { ...options, dataRange }
    );
    const window = {
      index: windows.length,
      start,
      end,
      sampleCount,
      similarity,
      passed: similarity >= minSimilarityThreshold,
    };
    windows.push(window);
    sumSimilarity += similarity;
    if (similarity < minSimilarity) {
      minSimilarity = similarity;
      worstWindow = window;
    }
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestWindow = window;
    }
  }

  const failingWindowCount = windows.reduce((countFailed, window) => countFailed + (window.passed ? 0 : 1), 0);
  return {
    sampleCount: count,
    windowSize,
    hopSize,
    includePartial,
    dataRange,
    minSimilarityThreshold,
    windowCount: windows.length,
    windows,
    meanSimilarity: windows.length > 0 ? sumSimilarity / windows.length : 0,
    minSimilarity: windows.length > 0 ? minSimilarity : 0,
    maxSimilarity: windows.length > 0 ? maxSimilarity : 0,
    worstWindow,
    bestWindow,
    failingWindowCount,
    passed: failingWindowCount === 0,
  };
}

export function channelQualityReport(reference, candidate, options = {}) {
  const count = assertArrayLikePair(reference, candidate);
  const channelCount = positiveInteger(options.channelCount ?? 4, 'channelCount');
  if (count % channelCount !== 0) {
    throw new RangeError('quality channel input length must be divisible by channelCount');
  }

  const pixelCount = count / channelCount;
  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const channelLabels = options.channelLabels ?? ['red', 'green', 'blue', 'alpha'];
  const includeWindowed = options.windowSize !== undefined;
  const channels = [];
  let mseSum = 0;
  let finitePsnrSum = 0;
  let finitePsnrCount = 0;
  let minSsimLite = Infinity;
  let maxPerceptualErrorScore = -Infinity;
  let worstChannel = null;

  for (let channel = 0; channel < channelCount; channel++) {
    const referenceChannel = new Float64Array(pixelCount);
    const candidateChannel = new Float64Array(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const sourceIndex = pixel * channelCount + channel;
      referenceChannel[pixel] = finiteValue(reference[sourceIndex], `reference[${sourceIndex}]`);
      candidateChannel[pixel] = finiteValue(candidate[sourceIndex], `candidate[${sourceIndex}]`);
    }

    const metrics = qualityMetricsReport(referenceChannel, candidateChannel, { ...options, dataRange });
    const report = {
      channel,
      label: channelLabels[channel] ?? `channel${channel}`,
      sampleCount: pixelCount,
      metrics,
      meanSquaredError: metrics.meanSquaredError,
      meanAbsoluteError: metrics.meanAbsoluteError,
      peakAbsoluteError: metrics.peakAbsoluteError,
      psnr: metrics.psnr,
      ssimLite: metrics.ssimLite,
      perceptualErrorScore: metrics.perceptualErrorScore,
    };
    if (includeWindowed) {
      report.windowedSsim = windowedStructuralSimilarity(referenceChannel, candidateChannel, { ...options, dataRange });
    }

    channels.push(report);
    mseSum += metrics.meanSquaredError;
    if (Number.isFinite(metrics.psnr)) {
      finitePsnrSum += metrics.psnr;
      finitePsnrCount++;
    }
    if (metrics.ssimLite < minSsimLite) minSsimLite = metrics.ssimLite;
    if (metrics.perceptualErrorScore > maxPerceptualErrorScore) {
      maxPerceptualErrorScore = metrics.perceptualErrorScore;
      worstChannel = report;
    }
  }

  return {
    sampleCount: count,
    pixelCount,
    channelCount,
    dataRange,
    channels,
    meanChannelMse: mseSum / channelCount,
    averagePsnr: finitePsnrCount > 0 ? finitePsnrSum / finitePsnrCount : Infinity,
    minSsimLite,
    maxPerceptualErrorScore,
    worstChannel,
    windowed: includeWindowed,
  };
}

export function imageQualityReport(referenceImage, candidateImage, options = {}) {
  const referenceView = imageDataView(referenceImage, 'referenceImage', options);
  const candidateView = imageDataView(candidateImage, 'candidateImage', options);
  if (referenceView.width !== candidateView.width || referenceView.height !== candidateView.height) {
    throw new RangeError('image quality inputs must have matching dimensions');
  }
  if (referenceView.channelCount !== candidateView.channelCount) {
    throw new RangeError('image quality inputs must have matching channel counts');
  }

  const dataRange = inferImageDataRange(referenceView.data, candidateView.data, options);
  const overall = qualityMetricsReport(referenceView.data, candidateView.data, { ...options, dataRange });
  const channelQuality = channelQualityReport(referenceView.data, candidateView.data, {
    ...options,
    channelCount: referenceView.channelCount,
    dataRange,
  });
  const report = {
    width: referenceView.width,
    height: referenceView.height,
    pixelCount: referenceView.pixelCount,
    sampleCount: referenceView.data.length,
    channelCount: referenceView.channelCount,
    dataRange,
    overall,
    channelQuality,
  };
  if (options.windowSize !== undefined) {
    report.windowedSsim = windowedStructuralSimilarity(referenceView.data, candidateView.data, { ...options, dataRange });
  }
  return report;
}

export function histogramDifference(referenceHistogram, candidateHistogram, options = {}) {
  if (!referenceHistogram || !candidateHistogram || referenceHistogram.length !== candidateHistogram.length) {
    throw new RangeError('histograms must have matching lengths');
  }
  if (referenceHistogram.length === 0) {
    throw new RangeError('histograms must be non-empty');
  }

  let referenceTotal = 0;
  let candidateTotal = 0;
  for (let i = 0; i < referenceHistogram.length; i++) {
    referenceTotal += finiteNonnegative(referenceHistogram[i], `referenceHistogram[${i}]`);
    candidateTotal += finiteNonnegative(candidateHistogram[i], `candidateHistogram[${i}]`);
  }

  const normalize = options.normalize !== false;
  const referenceScale = normalize && referenceTotal > 0 ? 1 / referenceTotal : 1;
  const candidateScale = normalize && candidateTotal > 0 ? 1 / candidateTotal : 1;
  let l1Distance = 0;
  let l2Squared = 0;
  let chiSquareDistance = 0;
  let intersection = 0;

  for (let i = 0; i < referenceHistogram.length; i++) {
    const a = Number(referenceHistogram[i]) * referenceScale;
    const b = Number(candidateHistogram[i]) * candidateScale;
    const diff = a - b;
    const abs = Math.abs(diff);
    l1Distance += abs;
    l2Squared += diff * diff;
    const denom = a + b;
    if (denom > 0) chiSquareDistance += (diff * diff) / denom;
    intersection += Math.min(a, b);
  }

  return {
    count: referenceHistogram.length,
    normalized: normalize,
    l1Distance,
    l2Distance: Math.sqrt(l2Squared),
    averageAbsoluteDifference: l1Distance / referenceHistogram.length,
    chiSquareDistance,
    intersection,
    intersectionDistance: normalize && referenceTotal === 0 && candidateTotal === 0 ? 0 : Math.max(0, 1 - intersection),
  };
}

export function audioRmsError(reference, candidate) {
  return rootMeanSquaredError(reference, candidate);
}

export function frameDifference(reference, candidate, options = {}) {
  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const stats = pairwiseErrorStats(reference, candidate);
  return {
    ...stats,
    psnr: stats.meanSquaredError === 0 ? Infinity : 10 * Math.log10((dataRange * dataRange) / stats.meanSquaredError),
    snr: signalToNoiseRatio(reference, candidate),
    ssimLite: structuralSimilarityLite(reference, candidate, { ...options, dataRange }),
  };
}

export function perceptualErrorScore(reference, candidate, options = {}) {
  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const ssim = structuralSimilarityLite(reference, candidate, { ...options, dataRange });
  const psnr = peakSignalToNoiseRatio(reference, candidate, { dataRange });
  const mae = meanAbsoluteError(reference, candidate);
  const ssimError = saturate((1 - ssim) / 2);
  const psnrGoodDb = positiveFinite(options.psnrGoodDb ?? DEFAULT_PSNR_GOOD_DB, 'psnrGoodDb');
  const psnrError = Number.isFinite(psnr) ? saturate(1 - psnr / psnrGoodDb) : 0;
  const maeError = saturate(mae / dataRange);
  return saturate(weightedAverage(
    [ssimError, psnrError, maeError],
    [options.ssimWeight ?? 0.6, options.psnrWeight ?? 0.2, options.maeWeight ?? 0.2]
  ));
}

export function qualityMetricsReport(reference, candidate, options = {}) {
  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const stats = pairwiseErrorStats(reference, candidate);
  return {
    ...stats,
    snr: signalToNoiseRatio(reference, candidate),
    psnr: stats.meanSquaredError === 0 ? Infinity : 10 * Math.log10((dataRange * dataRange) / stats.meanSquaredError),
    ssimLite: structuralSimilarityLite(reference, candidate, { ...options, dataRange }),
    perceptualErrorScore: perceptualErrorScore(reference, candidate, { ...options, dataRange }),
  };
}

export function qualitySizeScore({
  quality = 1,
  byteSize = 0,
  referenceByteSize = 0,
  byteBudget = Infinity,
  budgetBytes = byteBudget,
  qualityWeight = 0.7,
  sizeWeight = 0.3,
  budgetWeight,
} = {}) {
  const bytes = finiteNonnegative(byteSize, 'byteSize');
  const referenceBytes = finiteNonnegative(referenceByteSize, 'referenceByteSize');
  const savingsRatio = referenceBytes > 0 ? 1 - bytes / referenceBytes : 0;
  const compressionRatio = bytes > 0 ? referenceBytes / bytes : 0;
  const qualityScore = saturate(finiteOrDefault(quality, 1));
  const sizeScore = saturate(savingsRatio);
  const budget = finiteOrDefault(budgetBytes, Infinity);
  const hasBudget = Number.isFinite(budget) && budget > 0;
  const budgetScore = hasBudget ? saturate(1 - bytes / budget) : 0;
  const qWeight = Math.max(0, finiteOrDefault(qualityWeight, 0.7));
  const sWeight = Math.max(0, finiteOrDefault(sizeWeight, 0.3));
  const bWeight = Math.max(0, finiteOrDefault(budgetWeight, hasBudget ? 0.2 : 0));
  const totalWeight = Math.max(1e-9, qWeight + sWeight + bWeight);

  return {
    score: saturate((qualityScore * qWeight + sizeScore * sWeight + budgetScore * bWeight) / totalWeight),
    qualityScore,
    sizeScore,
    budgetScore,
    savingsRatio,
    compressionRatio,
    byteSize: bytes,
    referenceByteSize: referenceBytes,
    budgetBytes: hasBudget ? budget : Infinity,
    weights: {
      quality: qWeight,
      size: sWeight,
      budget: bWeight,
    },
  };
}

export default {
  pairwiseErrorStats,
  meanSquaredError,
  rootMeanSquaredError,
  meanAbsoluteError,
  averageError,
  peakAbsoluteError,
  signalToNoiseRatio,
  peakSignalToNoiseRatio,
  structuralSimilarityLite,
  windowedStructuralSimilarity,
  channelQualityReport,
  imageQualityReport,
  histogramDifference,
  audioRmsError,
  frameDifference,
  perceptualErrorScore,
  qualityMetricsReport,
  qualitySizeScore,
};
